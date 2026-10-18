import { yamlBlock } from "./yaml.ts";

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
  const value = (node.lines[start] ?? "").slice(prefix.length).trim();
  const list = value === "" && ["type", "allOf", "anyOf", "oneOf"].includes(key);
  const end = node.lines.findIndex(
    (line, index) =>
      index > start &&
      line.trim() !== "" &&
      !line.trimStart().startsWith("#") &&
      line.length - line.trimStart().length <= node.indentation &&
      !(list && line.startsWith(" ".repeat(node.indentation) + "- ")),
  );
  const lines = node.lines.slice(start + 1, end < 0 ? undefined : end);
  const first = lines.find((line) => line.trim() !== "" && !line.trimStart().startsWith("#"));
  const indentless = list && first?.startsWith(" ".repeat(node.indentation) + "- ") === true;
  return {
    value,
    node: {
      lines,
      indentation: node.indentation + (indentless ? 0 : 2),
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
// Properties, local references and compositions establish paths. Map values need an explicit
// additionalProperties schema and are requested separately from ordinary property lookup.
export function openApiYamlSchemaReader(
  body: string,
): (schema: string, path: readonly string[], member?: "map_value") => string[] {
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
    mapValue: boolean,
  ): string[] | undefined {
    if (ancestors.has(node) || ancestors.size > 64) return;
    const seen = new Set([...ancestors, node]);
    const type = entry(node, "type");
    const properties = entry(node, "properties");
    const reference = entry(node, "$ref");
    const map = mapValue && path.length === 0 ? entry(node, "additionalProperties") : undefined;
    if (type === null || properties === null || reference === null || map === null) return;
    const types = type === undefined ? [] : declaredTypes(type);
    if (type !== undefined && types.length === 0) return;
    if ((path.length > 0 || mapValue) && types.some((type) => type !== "object" && type !== "null"))
      return;
    const result = path.length === 0 && !mapValue ? types.filter((type) => type !== "null") : [];
    if (map !== undefined) {
      if (map.value !== "") return;
      const found = read(map.node, [], seen, false);
      if (found === undefined) return;
      result.push(...found);
    }
    const name = path[0];
    if (properties !== undefined && name !== undefined) {
      const property = entry(properties.node, name);
      if (property === null) return;
      if (property !== undefined) {
        const found = read(property.node, path.slice(1), seen, mapValue);
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
      const found = read(schema, path, seen, mapValue);
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
          declaredTypes(type).length > 0 &&
          declaredTypes(type).every((type) => type === "null")
        )
          continue;
        const found = read(alternative.node, path, seen, mapValue);
        if (found === undefined || (composition !== "allOf" && found.length === 0)) return;
        result.push(...found);
      }
    }
    return result;
  }
  return (schema, path, member) => {
    const node = schemaNodes.get(schema);
    return node === undefined
      ? []
      : [...new Set(read(node, path, new Set(), member === "map_value") ?? [])];
  };
}
