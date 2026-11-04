/** Preserve offsets so fenced headings cannot change native document ownership. */
export function markdownProse(body: string): string {
  let fence: string | undefined;
  return body
    .split("\n")
    .map((line) => {
      const marker = line.match(/^ *(`{3,}|~{3,})(.*)$/u);
      const fenced = fence !== undefined;
      if (marker?.[1] !== undefined) {
        if (fence === undefined) fence = marker[1];
        else if (
          marker[1][0] === fence[0] &&
          marker[1].length >= fence.length &&
          marker[2]?.trim() === ""
        )
          fence = undefined;
      }
      return fenced || marker !== null ? " ".repeat(line.length) : line;
    })
    .join("\n");
}

export function markdownSection(body: string, depth: number, name: string): string | undefined {
  const headings = [...markdownProse(body).matchAll(/^(#{1,6}) ([^\r\n]+?)[ \t]*\r?$/gm)];
  const matches = headings.filter((heading) => heading[1]?.length === depth && heading[2] === name);
  const heading = matches[0];
  if (matches.length !== 1 || heading === undefined) return;
  const start = heading.index + heading[0].length;
  const end = headings.find(
    (other) => other.index > heading.index && (other[1]?.length ?? 0) <= depth,
  )?.index;
  return body.slice(start, end);
}

export function markdownTableRows(
  section: string,
  requiredColumns: readonly string[],
): Map<string, string>[] {
  const lines = markdownProse(section)
    .split("\n")
    .map((line) => line.trim());
  const cells = (line: string): string[] =>
    line
      .slice(1, -1)
      .split(/(?<!\\)\|/u)
      .map((cell) => cell.trim().replaceAll("\\|", "|"));
  const isRow = (line: string): boolean => line.startsWith("|") && line.endsWith("|");
  const headerIndex = lines.findIndex(isRow);
  const headerLine = lines[headerIndex];
  if (headerLine === undefined) throw new Error("Expected a Markdown table");
  const columns = cells(headerLine);
  if (
    new Set(columns).size !== columns.length ||
    requiredColumns.some((column) => !columns.includes(column))
  )
    throw new Error("Markdown table columns changed");
  const divider = lines[headerIndex + 1] ?? "";
  if (
    !isRow(divider) ||
    cells(divider).length !== columns.length ||
    !cells(divider).every((cell) => /^:?-+:?$/.test(cell))
  )
    throw new Error("Expected a Markdown table divider");
  const rows: Map<string, string>[] = [];
  for (const line of lines.slice(headerIndex + 2)) {
    if (!isRow(line)) break;
    const values = cells(line);
    if (values.length !== columns.length) throw new Error("Markdown table row changed width");
    rows.push(new Map(columns.map((column, index) => [column, values[index] ?? ""])));
  }
  if (rows.length === 0) throw new Error("Markdown table has no rows");
  return rows;
}
