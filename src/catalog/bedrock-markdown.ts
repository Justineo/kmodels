import { bedrockProfileGeography, type BedrockEndpoint } from "./bedrock-model-ids.ts";
import { markdownProse, markdownSection } from "./markdown.ts";

export function bedrockProgrammaticSection(body: string): string | undefined {
  return (
    markdownSection(body, 2, "Programmatic Access") ?? markdownSection(body, 2, "Call the model")
  );
}

export function bedrockRegionalSection(body: string): string | undefined {
  return (
    markdownSection(body, 2, "Regional Availability") ??
    markdownSection(body, 2, "Supported Regions")
  );
}

export function bedrockAvailabilityBlocks(body: string): Array<{
  endpoint: BedrockEndpoint | undefined;
  body: string;
}> {
  const headings = [
    ...body.matchAll(
      /^\*\*(?:Availability using the|The) `(bedrock-runtime|bedrock-mantle)` endpoint\*\*$/gm,
    ),
  ];
  if (headings.length === 0) return [{ endpoint: undefined, body }];
  return headings.map((heading, index) => ({
    endpoint: heading[1] === "bedrock-runtime" ? "bedrock-runtime" : "bedrock-mantle",
    body: body.slice(heading.index + heading[0].length, headings[index + 1]?.index),
  }));
}

export function bedrockAvailabilityTable(body: string) {
  const table = markdownTable(body, ["In-Region"]);
  if (table === undefined || new Set(table.header).size !== table.header.length) return;
  const region = table.header.findIndex((label) => label === "Region" || label === "Source Region");
  const geoColumns = table.header.flatMap((label, index) => {
    const named = label.match(/^([A-Za-z]+) Geo CRIS$/)?.[1];
    return label === "Geo" ||
      label === "Geo CRIS" ||
      (named !== undefined && bedrockProfileGeography(named) !== undefined)
      ? [index]
      : [];
  });
  const geo = geoColumns.length === 1 ? geoColumns[0] : undefined;
  const global = table.header.findIndex((label) => label === "Global" || label === "Global CRIS");
  if (region < 0 || geo === undefined || global < 0) return;
  return { rows: table.rows, region, inRegion: table.header.indexOf("In-Region"), geo, global };
}

export function bedrockAvailabilitySupported(cell: string): boolean {
  return cell === "Supported" || (cell.includes("icon-yes.png") && !cell.includes("icon-no.png"));
}

// This overview states routing support, not a list of source or destination Regions.
export function bedrockAvailabilityScope(body: string) {
  const prose = markdownProse(body)
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n");
  const table = markdownTable(prose, ["Scope", "In-Region", "Geo", "Global"]);
  const row = table?.rows[0];
  if (
    table?.header.join("|") !== "Scope|In-Region|Geo|Global" ||
    table.rows.length !== 1 ||
    row?.[0] !== "US geographic and global inference" ||
    bedrockAvailabilitySupported(row[1] ?? "")
  )
    return;
  return {
    geo: bedrockAvailabilitySupported(row[2] ?? ""),
    global: bedrockAvailabilitySupported(row[3] ?? ""),
  };
}

export function bedrockModelGlobalRegions(body: string, cardUrl: string): string[] | undefined {
  const prose = markdownProse(body)
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n");
  const headings = [
    ...prose.matchAll(/^\*\*\[[^\n]+\]\((model-card-[a-z0-9-]+\.md)\)\*\*[ \t]*$/gm),
  ];
  const matches = headings.flatMap((heading, index) =>
    new URL(
      heading[1] ?? "",
      "https://docs.aws.amazon.com/bedrock/latest/userguide/models-region-compatibility.md",
    ).href === cardUrl
      ? [prose.slice(heading.index + heading[0].length, headings[index + 1]?.index)]
      : [],
  );
  if (matches.length !== 1 || matches[0] === undefined) return;
  const headers = [
    "Region",
    "In-Region (bedrock-mantle)",
    "In-Region (bedrock-runtime)",
    "Geo (bedrock-runtime)",
    "Global (bedrock-runtime)",
  ];
  let table: ReturnType<typeof markdownTable>;
  try {
    table = markdownTable(matches[0], headers);
  } catch {
    return;
  }
  if (
    !table ||
    table.header.join("|") !== headers.join("|") ||
    table.rows.length === 0 ||
    table.rows.length > 100
  )
    return;
  const seen = new Set<string>();
  const regions: string[] = [];
  for (const row of table.rows) {
    const region = row[0]?.match(/^([a-z]{2}(?:-[a-z0-9]+)+-\d)\b/)?.[1];
    if (!region || seen.has(region)) return;
    seen.add(region);
    if (bedrockAvailabilitySupported(row[4] ?? "")) regions.push(region);
  }
  return regions;
}

function markdownCells(line: string): string[] {
  const escapedPipe = "\u0000";
  const value = line.trim();
  if (!value.startsWith("|")) return [];
  return value
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .replaceAll("\\|", escapedPipe)
    .split("|")
    .map((cell) =>
      cell.replaceAll(escapedPipe, "|").replaceAll("**", "").replaceAll("`", "").trim(),
    );
}

export function markdownTable(
  body: string,
  requiredHeaders: string[],
): { header: string[]; rows: string[][] } | undefined {
  const lines = body.split(/\r?\n/);
  const matches: { header: string[]; rows: string[][] }[] = [];
  for (let index = 0; index + 1 < lines.length; index += 1) {
    const header = markdownCells(lines[index] ?? "");
    if (header.length === 0 || !requiredHeaders.every((required) => header.includes(required)))
      continue;
    const separator = markdownCells(lines[index + 1] ?? "");
    if (separator.length < header.length || !separator.every((cell) => /^:?-{3,}:?$/.test(cell)))
      continue;
    const rows: string[][] = [];
    let cursor = index + 2;
    while (lines[cursor]?.trim().startsWith("|")) {
      const cells = markdownCells(lines[cursor] ?? "");
      if (cells.length !== header.length)
        throw new Error("Bedrock Markdown table contained an irregular row");
      rows.push(cells);
      cursor += 1;
    }
    matches.push({ header, rows });
    index = cursor - 1;
  }
  if (matches.length > 1)
    throw new Error(`Bedrock document duplicated Markdown table: ${requiredHeaders.join(", ")}`);
  return matches[0];
}
