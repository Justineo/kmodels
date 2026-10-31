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
