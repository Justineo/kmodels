import { yamlBlock } from "./yaml.ts";

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

interface YamlNode {
  lines: readonly string[];
  indentation: number;
}
interface YamlEntry {
  value: string;
  node: YamlNode;
}

function entry(node: YamlNode, key: string): YamlEntry | null | undefined {
  const prefix = " ".repeat(node.indentation) + key + ":";
  const indexes = node.lines.flatMap((line, index) =>
    line.startsWith(prefix) &&
    (line.length === prefix.length || /\s/.test(line[prefix.length] ?? ""))
      ? [index]
      : [],
  );
  const start = indexes[0];
  if (indexes.length > 1) return null;
  if (start === undefined) return;
  const end = node.lines.findIndex(
    (line, index) =>
      index > start &&
      line.trim() !== "" &&
      !line.trimStart().startsWith("#") &&
      line.length - line.trimStart().length <= node.indentation,
  );
  return {
    value: (node.lines[start] ?? "").slice(prefix.length).trim(),
    node: {
      lines: node.lines.slice(start + 1, end < 0 ? undefined : end),
      indentation: node.indentation + 2,
    },
  };
}

function sequence(node: YamlNode): YamlEntry[] {
  const prefix = " ".repeat(node.indentation) + "- ";
  const starts = node.lines.flatMap((line, index) => (line.startsWith(prefix) ? [index] : []));
  return starts.map((start, index) => {
    const value = (node.lines[start] ?? "").slice(prefix.length);
    return {
      value,
      node: {
        lines: [
          " ".repeat(node.indentation + 2) + value,
          ...node.lines.slice(start + 1, starts[index + 1]),
        ],
        indentation: node.indentation + 2,
      },
    };
  });
}

function scalar(value: string): string {
  return value.replace(/^["']|["']$/g, "");
}

function declaredTypes(value: YamlEntry): string[] {
  if (value.value === "") return sequence(value.node).map(({ value }) => scalar(value));
  if (value.value.startsWith("[") && value.value.endsWith("]"))
    return value.value
      .slice(1, -1)
      .split(",")
      .map((part) => scalar(part.trim()));
  return [scalar(value.value)];
}

// This recognizes the reviewed block-style schema shapes, not arbitrary YAML.
// Only direct properties, local schema references and schema compositions establish paths.
export function openApiYamlSchemaReader(
  body: string,
): (schema: string, path: readonly string[]) => string[] {
  const components = yamlBlock(body, "components", 0);
  const schemas = components === undefined ? undefined : yamlBlock(components, "schemas", 2);
  const schemaNodes = new Map<string, YamlNode | undefined>();
  const lines = (schemas ?? "").split(/\r?\n/);
  const starts = lines.flatMap((line, index) => {
    const name = line.match(/^    ([A-Za-z0-9_-]+):$/)?.[1];
    return name === undefined ? [] : [{ name, index }];
  });
  for (const [position, { name, index }] of starts.entries()) {
    schemaNodes.set(
      name,
      schemaNodes.has(name)
        ? undefined
        : { lines: lines.slice(index + 1, starts[position + 1]?.index), indentation: 6 },
    );
  }
  function read(
    node: YamlNode,
    path: readonly string[],
    ancestors: ReadonlySet<YamlNode>,
  ): string[] | undefined {
    if (ancestors.has(node) || ancestors.size > 64) return;
    const seen = new Set([...ancestors, node]);
    const type = entry(node, "type");
    const properties = entry(node, "properties");
    const reference = entry(node, "$ref");
    if (type === null || properties === null || reference === null) return;
    const types = type === undefined ? [] : declaredTypes(type);
    if (path.length > 0 && types.some((type) => type !== "object" && type !== "null")) return;
    const result = path.length === 0 ? types.filter((type) => type !== "null") : [];
    const name = path[0];
    if (properties !== undefined && name !== undefined) {
      const property = entry(properties.node, name);
      if (property === null) return;
      if (property !== undefined) {
        const found = read(property.node, path.slice(1), seen);
        if (found === undefined) return;
        result.push(...found);
      }
    }
    if (reference !== undefined) {
      const target = scalar(reference.value).match(
        /^#\/components\/schemas\/([A-Za-z0-9_-]+)$/,
      )?.[1];
      const schema = target === undefined ? undefined : schemaNodes.get(target);
      if (schema === undefined) return;
      const found = read(schema, path, seen);
      if (found === undefined) return;
      result.push(...found);
    }
    for (const composition of ["allOf", "anyOf", "oneOf"]) {
      const group = entry(node, composition);
      if (group === null) return;
      if (group === undefined) continue;
      const alternatives = sequence(group.node);
      if (alternatives.length === 0) return;
      for (const alternative of alternatives) {
        const type = entry(alternative.node, "type");
        if (
          type !== undefined &&
          type !== null &&
          declaredTypes(type).every((type) => type === "null")
        )
          continue;
        const found = read(alternative.node, path, seen);
        if (found === undefined || (composition !== "allOf" && found.length === 0)) return;
        result.push(...found);
      }
    }
    return result;
  }
  return (schema, path) => {
    const node = schemaNodes.get(schema);
    return node === undefined ? [] : [...new Set(read(node, path, new Set()) ?? [])];
  };
}
