import { markdownSection } from "./markdown.ts";

export interface OpenAiRegionalInvocation {
  modelId: string;
  path: string;
  region: string;
  origin: string;
}

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((value) => value.trim());
}

function table(body: string, heading: string, headers: readonly string[]): string[][] {
  const lines = markdownSection(body, 4, heading)?.split(/\r?\n/) ?? [];
  const starts = lines.flatMap((line, index) =>
    cells(line).join("\0") === headers.join("\0") ? [index] : [],
  );
  const start = starts[0];
  if (starts.length !== 1 || start === undefined) return [];
  const separator = cells(lines[start + 1] ?? "");
  if (separator.length !== headers.length || !separator.every((value) => /^:?-{3,}:?$/.test(value)))
    return [];
  const rows: string[][] = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.trim().startsWith("|")) break;
    const row = cells(line);
    if (row.length === headers.length) rows.push(row);
  }
  return rows;
}

const regions = new Map([
  ["United States", "us.api.openai.com"],
  ["Europe (EEA + Switzerland)", "eu.api.openai.com"],
  ["United Arab Emirates", "ae.api.openai.com"],
]);

function codeValues(cell: string): string[] {
  return [...cell.matchAll(/`([^`]+)`/g)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

/** Preserve model × operation × processing-region evidence before any model-level union. */
export function openAiRegionalInvocations(body: string): OpenAiRegionalInvocation[] {
  const regionRows = table(body, "Support by region", [
    "Region",
    "Domain prefix",
    "Regional storage",
    "Regional processing",
    "MAM or ZDR required",
    "Supported modes",
    "Storage services",
    "Processing services",
  ]);
  const supportedRegions = new Map<string, { origin: string; services: string } | null>();
  for (const row of regionRows) {
    const region = (row[0] ?? "").replace(/\\?\*+$/, "");
    const domain = regions.get(region);
    if (domain === undefined) continue;
    // Duplicate region declarations cannot silently replace an earlier restriction.
    if (supportedRegions.has(region)) {
      supportedRegions.set(region, null);
      continue;
    }
    supportedRegions.set(
      region,
      row[1] === `\`${domain}\`` && row[3] === "Yes"
        ? { origin: `https://${domain}`, services: row[7] ?? "" }
        : null,
    );
  }
  const modelRows = table(body, "API Endpoint, tool and model support", [
    "Endpoint or feature",
    "Service",
    "Storage regions",
    "Processing regions",
    "Supported models and snapshots",
    "Regional processing snapshot exceptions",
    "Notes",
  ]);
  const claims = new Map<string, OpenAiRegionalInvocation | null>();
  for (const row of modelRows) {
    const paths = codeValues(row[0] ?? "");
    // Combined audio rows establish a set of services, not every model/service combination.
    if (paths.length !== 1 || !/^\/v1\/[a-z_/]+$/.test(paths[0] ?? "")) continue;
    const path = paths[0];
    if (path === undefined) continue;
    const modelIds = codeValues(row[4] ?? "");
    const exception = row[5] ?? "";
    const exceptions = codeValues(exception);
    const reviewedException =
      exception === "None" ||
      (exception.startsWith("United Arab Emirates:") &&
        exceptions.length > 0 &&
        exceptions.every((id) => modelIds.includes(id)));
    for (const modelId of modelIds) {
      for (const [region, support] of supportedRegions) {
        const key = JSON.stringify([modelId, path, region]);
        const service = support?.services
          .split(/<br\s*\/?\s*>/)
          .find((value) => codeValues(value)[0] === path);
        const serviceModels = codeValues(service ?? "").slice(1);
        const eligible =
          reviewedException &&
          support !== null &&
          support !== undefined &&
          service !== undefined &&
          (serviceModels.length === 0 || serviceModels.includes(modelId)) &&
          (row[3] ?? "").split(", ").includes(region) &&
          (region !== "United Arab Emirates" ||
            exception === "None" ||
            (exception.startsWith("United Arab Emirates:") && exceptions.includes(modelId)));
        // A repeated tuple, even one that loses eligibility, is withheld for review.
        claims.set(
          key,
          claims.has(key) || !eligible ? null : { modelId, path, region, origin: support.origin },
        );
      }
    }
  }
  return [...claims.values()].flatMap((claim) => (claim === null ? [] : [claim]));
}
