import { readdir, readFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vite-plus/test";
import { generatedDataTests } from "./generated-data-tests.ts";

const generatedFiles = new Set(generatedDataTests.map((path) => path.replace(/^tests\//, "")));

async function testSources(directory = ""): Promise<Map<string, string>> {
  const root = new URL("./", import.meta.url);
  const sources = new Map<string, string>();
  for (const entry of await readdir(new URL(directory, root), { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== "fixtures") {
      for (const [file, source] of await testSources(`${path}/`)) sources.set(file, source);
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      sources.set(path, await readFile(new URL(path, root), "utf8"));
    }
  }
  return sources;
}

function dependencies(file: string, source: string): string[] {
  const paths: string[] = [];
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.ESNext, true);
  function add(node: ts.Node | undefined): void {
    if (node === undefined) return;
    if (ts.isStringLiteralLike(node)) paths.push(node.text);
    else if (ts.isTemplateExpression(node)) paths.push(node.head.text);
  }
  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
      add(node.arguments[0]);
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "URL"
    )
      add(node.arguments?.[0]);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return paths
    .filter((path) => path.startsWith("."))
    .map((path) => normalize(join(dirname(file), path)));
}

function generatedDependency(
  file: string,
  graph: ReadonlyMap<string, string[]>,
  seen = new Set<string>(),
): boolean {
  if (seen.has(file)) return false;
  seen.add(file);
  return (graph.get(file) ?? []).some(
    (path) =>
      path === "generated-data-context.ts" ||
      path.startsWith("../data/") ||
      generatedDependency(path, graph, seen),
  );
}

describe("test project boundaries", () => {
  it.each([
    'import "../../data/catalog.json";',
    'export { generatedData } from "../generated-data-context.ts";',
    'const data = await import("../../data/catalog.json");',
    "const path = new URL(`../../data/${name}.json`, import.meta.url);",
  ])("detects a generated dependency through a nested helper: %s", (source) => {
    const graph = new Map([
      ["nested/case.test.ts", dependencies("nested/case.test.ts", 'import "./bridge.ts";')],
      ["nested/bridge.ts", dependencies("nested/bridge.ts", source)],
    ]);
    expect(generatedDependency("nested/case.test.ts", graph)).toBe(true);
  });

  it("keeps direct and helper-mediated durable catalog dependencies in the generated project", async () => {
    const sources = await testSources();
    const graph = new Map([...sources].map(([file, source]) => [file, dependencies(file, source)]));
    for (const file of generatedFiles) expect(sources.has(file), file).toBe(true);
    for (const file of sources.keys()) {
      if (!file.endsWith(".test.ts")) continue;
      expect(generatedDependency(file, graph), file).toBe(generatedFiles.has(file));
    }
  });
});
