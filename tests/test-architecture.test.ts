import { readdir, readFile } from "node:fs/promises";
import { basename } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { generatedDataTests } from "./generated-data-tests.ts";

const generatedFiles = new Set(generatedDataTests.map((path) => basename(path)));

async function testSources(): Promise<Map<string, string>> {
  const directory = new URL("./", import.meta.url);
  const files = (await readdir(directory)).filter((file) => file.endsWith(".test.ts")).sort();
  return new Map(
    await Promise.all(
      files.map(async (file) => [file, await readFile(new URL(file, directory), "utf8")] as const),
    ),
  );
}

function imports(source: string): string[] {
  return [...source.matchAll(/\bfrom\s+["']([^"']+)["']/g)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

function urls(source: string): string[] {
  return [...source.matchAll(/\bnew URL\(\s*["']([^"']+)["']/g)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

describe("test project boundaries", () => {
  it("keeps durable catalog dependencies in the generated-data project", async () => {
    const sources = await testSources();
    for (const file of generatedFiles) expect(sources.has(file), file).toBe(true);

    for (const [file, source] of sources) {
      const dependencies = imports(source);
      if (generatedFiles.has(file)) {
        expect(dependencies, file).toContain("./generated-data-context.ts");
        continue;
      }
      expect(dependencies, file).not.toContain("./generated-data-context.ts");
      expect(
        urls(source).some((path) => path.startsWith("../data/")),
        file,
      ).toBe(false);
    }
  });
});
