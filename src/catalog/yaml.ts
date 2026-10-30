export function yamlBlock(body: string, label: string, indentation: number): string | undefined {
  const lines = body.split(/\r?\n/);
  const marker = `${" ".repeat(indentation)}${label}:`;
  const indexes = lines.flatMap((line, index) => (line === marker ? [index] : []));
  const start = indexes[0];
  if (indexes.length !== 1 || start === undefined) return undefined;
  const end = lines.findIndex((line, index) => {
    if (index <= start || line.trim() === "" || line.trimStart().startsWith("#")) return false;
    return (line.match(/^ */)?.[0].length ?? 0) <= indentation;
  });
  return lines.slice(start, end < 0 ? undefined : end).join("\n");
}

/** Follow one unambiguous block-style mapping path, accepting quoted YAML keys. */
export function yamlPath(body: string, path: readonly string[]): string | undefined {
  let block: string | undefined = body;
  for (const [depth, label] of path.entries()) {
    if (block === undefined) return;
    const matches: string[] = [];
    for (const key of [label, `'${label}'`, `"${label}"`]) {
      const value = yamlBlock(block, key, depth * 2);
      if (value !== undefined) matches.push(value);
    }
    block = matches.length === 1 ? matches[0] : undefined;
  }
  return block;
}
