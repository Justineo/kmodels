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
