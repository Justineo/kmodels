import { readdir, readFile } from "node:fs/promises";
import { posix } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { moduleDependencies } from "../scripts/module-dependencies.ts";
import { runAuthenticatedCurl } from "../src/catalog/transport/auth-fetch.ts";

const repoRoot = new URL("../", import.meta.url);

async function collectTsFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(new URL(dir, repoRoot), { withFileTypes: true })) {
    const rel = posix.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTsFiles(rel)));
    } else if (/\.(?:ts|vue)$/.test(entry.name)) {
      files.push(rel);
    }
  }
  return files;
}

const scanned = new Map<string, Promise<string[]>>();
function runtimeImports(file: string): Promise<string[]> {
  let imports = scanned.get(file);
  if (imports === undefined) {
    imports = readFile(new URL(file, repoRoot), "utf8").then((source) =>
      moduleDependencies(file, source, "runtime"),
    );
    scanned.set(file, imports);
  }
  return imports;
}

const coreFiles = Promise.all([collectTsFiles("src/catalog"), collectTsFiles("src/pricing")]).then(
  (groups) => groups.flat(),
);

async function transitiveClosure(entries: readonly string[]): Promise<Set<string>> {
  const seen = new Set<string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const current = queue.pop();
    if (current === undefined || seen.has(current)) continue;
    seen.add(current);
    if (!current.startsWith("src/") || !/\.(?:ts|vue)$/.test(current)) continue;
    for (const dep of await runtimeImports(current)) {
      if (!seen.has(dep)) queue.push(dep);
    }
  }
  return seen;
}

describe("architecture boundaries", () => {
  it("has zero runtime value-level import cycles in src/catalog and src/pricing", async () => {
    const files = await coreFiles;
    const graph = new Map<string, string[]>();
    for (const file of files) {
      graph.set(
        file,
        (await runtimeImports(file)).filter((dep) => dep.startsWith("src/")),
      );
    }
    const state = new Map<string, "visiting" | "done">();
    const cycles: string[] = [];
    function dfs(node: string, stack: string[]): void {
      state.set(node, "visiting");
      for (const next of graph.get(node) ?? []) {
        const nextState = state.get(next);
        if (nextState === "visiting") {
          cycles.push([...stack.slice(stack.indexOf(next)), next].join(" -> "));
        } else if (nextState === undefined && graph.has(next)) {
          dfs(next, [...stack, next]);
        }
      }
      state.set(node, "done");
    }
    for (const file of files) {
      if (!state.has(file)) dfs(file, [file]);
    }
    expect(cycles).toEqual([]);
  });

  it("keeps sealed src/catalog/transport/ free of provider parsers, manifests, and cheerio", async () => {
    const transportFiles = await collectTsFiles("src/catalog/transport");
    const closure = await transitiveClosure(transportFiles);
    expect(closure.has("cheerio")).toBe(false);
    expect(closure.has("src/catalog/manifests.ts")).toBe(false);
    expect(closure.has("src/catalog/fetch.ts")).toBe(false);
    expect(closure.has("src/catalog/bedrock.ts")).toBe(false);
    expect(closure.has("src/catalog/sagemaker.ts")).toBe(false);
    expect(closure.has("src/catalog/openai.ts")).toBe(false);
    expect(closure.has("src/catalog/anthropic.ts")).toBe(false);
    expect(closure.has("src/catalog/azure.ts")).toBe(false);
    expect(closure.has("src/catalog/vercel.ts")).toBe(false);
    // Auth headers must never be exported outside sealed transport/auth-fetch.ts.
    const authFetchSource = await readFile(
      new URL("src/catalog/transport/auth-fetch.ts", repoRoot),
      "utf8",
    );
    expect(authFetchSource).not.toMatch(/export\s+function\s+authHeaderFor\b/);

    // Credential-to-host allowlist is enforced inside auth-fetch.ts itself (fail-closed).
    const dummyCurlOpts = {
      headers: [],
      method: "GET" as const,
      maxResponseBytes: 1024,
      timeoutMs: 1000,
    };
    await expect(
      runAuthenticatedCurl(
        new URL("http://api.openai.com/v1/models"),
        { scheme: "bearer", env: "OPENAI_API_KEY" },
        dummyCurlOpts,
      ),
    ).rejects.toThrow(/HTTPS/i);
    await expect(
      runAuthenticatedCurl(
        new URL("https://evil.example.com/v1/models"),
        { scheme: "bearer", env: "OPENAI_API_KEY" },
        dummyCurlOpts,
      ),
    ).rejects.toThrow(/not allowed for host/i);
    await expect(
      runAuthenticatedCurl(
        new URL("https://api.openai.com/v1/models"),
        { scheme: "bearer", env: "UNREVIEWED_SECRET" },
        dummyCurlOpts,
      ),
    ).rejects.toThrow(/not allowed for host/i);
  });

  it("keeps AWS SDK and Smithy clients sealed inside src/catalog/transport/", async () => {
    const files = (await coreFiles).filter((file) => !file.startsWith("src/catalog/transport/"));
    const offenders: string[] = [];
    for (const file of files) {
      const sdkDeps = (await runtimeImports(file)).filter(
        (dep) => dep.startsWith("@aws-sdk/") || dep.startsWith("@smithy/"),
      );
      if (sdkDeps.length > 0) offenders.push(`${file}: ${sdkDeps.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });

  it("keeps browser entrypoints free of zod, node built-ins, and transport modules", async () => {
    const closure = await transitiveClosure(["src/main.ts", "src/details-app.ts"]);
    const forbidden = [...closure].filter(
      (dep) => dep === "zod" || dep.startsWith("node:") || dep.startsWith("src/catalog/transport/"),
    );
    expect(forbidden).toEqual([]);
  });

  it("keeps @kmodels/pricing portable runtime free of node built-ins and transport modules", async () => {
    const closure = await transitiveClosure(["src/pricing/index.ts"]);
    const forbidden = [...closure].filter(
      (dep) =>
        dep.startsWith("node:") ||
        dep.startsWith("src/catalog/transport/") ||
        dep === "src/catalog/fetch.ts",
    );
    expect(forbidden).toEqual([]);
  });
});
