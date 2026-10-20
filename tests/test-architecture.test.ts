import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { moduleDependencies as dependencies } from "../scripts/module-dependencies.ts";
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
