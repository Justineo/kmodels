export function openApiYamlHasPropertyPath(
  body: string,
  schema: string,
  path: readonly string[],
): boolean {
  let block = schemaBlock(body, schema);
  if (block === undefined) return false;
  for (const property of path) {
    const next = propertyBlock(block, property);
    if (next === undefined) return false;
    block = next;
  }
  return true;
}

export function openApiYamlPropertyReferencesSchema(
  body: string,
  schema: string,
  property: string,
  referencedSchema: string,
): boolean {
  const block = schemaBlock(body, schema);
  const propertyValue = block === undefined ? undefined : propertyBlock(block, property);
  return propertyValue === undefined
    ? false
    : schemaReference(referencedSchema).test(propertyValue);
}

export function openApiYamlSchemaReferencesSchema(
  body: string,
  schema: string,
  referencedSchema: string,
): boolean {
  const block = schemaBlock(body, schema);
  return block === undefined ? false : schemaReference(referencedSchema).test(block);
}

function schemaReference(schema: string): RegExp {
  return new RegExp(`\\$ref:\\s*["']?#/components/schemas/${escapeRegExp(schema)}["']?`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function schemaBlock(body: string, schema: string): string | undefined {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `    ${schema}:`);
  if (start < 0) return;
  const end = lines.findIndex((line, index) => index > start && /^    [A-Za-z0-9_]+:$/.test(line));
  return lines.slice(start, end < 0 ? undefined : end).join("\n");
}

function propertyBlock(body: string, property: string): string | undefined {
  const lines = body.split("\n");
  for (const [propertiesIndex, line] of lines.entries()) {
    const marker = line.match(/^(\s*)properties:$/);
    if (marker === null) continue;
    const markerIndentation = marker[1]?.length ?? 0;
    const propertyIndentation = markerIndentation + 2;
    const target = `${" ".repeat(propertyIndentation)}${property}:`;
    let start = -1;
    for (let index = propertiesIndex + 1; index < lines.length; index += 1) {
      const candidate = lines[index]!;
      if (candidate.trim() === "") continue;
      const indentation = candidate.length - candidate.trimStart().length;
      if (indentation <= markerIndentation) break;
      if (candidate === target) {
        start = index;
        break;
      }
    }
    if (start < 0) continue;
    const end = lines.findIndex(
      (candidate, index) =>
        index > start &&
        candidate.trim() !== "" &&
        candidate.length - candidate.trimStart().length <= propertyIndentation,
    );
    return lines.slice(start, end < 0 ? undefined : end).join("\n");
  }
}
