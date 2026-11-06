import { bedrockProfileGeography, type BedrockEndpoint } from "./bedrock-model-ids.ts";
import { markdownSection } from "./markdown.ts";

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
