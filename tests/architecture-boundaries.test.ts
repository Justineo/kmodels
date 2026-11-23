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

/** Extract runtime (non-`import type`) static import targets for cycle & boundary checks. */
function runtimeImports(file: string, source: string): string[] {
  const specifiers: string[] = [];
  const pattern =
    /\b(?:import|export)\s+(?!type\b)(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of source.matchAll(pattern)) {
    const raw = match[1] ?? match[2];
    if (raw === undefined) continue;
    if (raw.startsWith(".")) {
      specifiers.push(posix.normalize(posix.join(posix.dirname(file), raw)));
    } else {
      specifiers.push(raw);
    }
  }
  return specifiers;
}

async function transitiveClosure(
  entries: readonly string[],
  mode: "runtime" | "all",
): Promise<Set<string>> {
  const seen = new Set<string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const current = queue.pop();
    if (current === undefined || seen.has(current)) continue;
    seen.add(current);
    if (!current.startsWith("src/") || !/\.(?:ts|vue)$/.test(current)) continue;
    const source = await readFile(new URL(current, repoRoot), "utf8");
    const deps =
      mode === "runtime" ? runtimeImports(current, source) : moduleDependencies(current, source);
    for (const dep of deps) {
      if (!seen.has(dep)) queue.push(dep);
    }
  }
  return seen;
}

describe("architecture boundaries", () => {
  it("has zero runtime value-level import cycles in src/catalog and src/pricing", async () => {
    const files = [
      ...(await collectTsFiles("src/catalog")),
      ...(await collectTsFiles("src/pricing")),
    ];
    const graph = new Map<string, string[]>();
    for (const file of files) {
      const source = await readFile(new URL(file, repoRoot), "utf8");
      graph.set(
        file,
        runtimeImports(file, source).filter((dep) => dep.startsWith("src/")),
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
    expect(transportFiles.length).toBeGreaterThanOrEqual(3);
    const closure = await transitiveClosure(transportFiles, "runtime");
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
    const files = [
      ...(await collectTsFiles("src/catalog")),
      ...(await collectTsFiles("src/pricing")),
    ].filter((file) => !file.startsWith("src/catalog/transport/"));
    const offenders: string[] = [];
    for (const file of files) {
      const source = await readFile(new URL(file, repoRoot), "utf8");
      const sdkDeps = runtimeImports(file, source).filter(
        (dep) => dep.startsWith("@aws-sdk/") || dep.startsWith("@smithy/"),
      );
      if (sdkDeps.length > 0) offenders.push(`${file}: ${sdkDeps.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });

  it("keeps browser entrypoints free of zod, node built-ins, and transport modules", async () => {
    const closure = await transitiveClosure(["src/main.ts", "src/details-app.ts"], "runtime");
    const forbidden = [...closure].filter(
      (dep) => dep === "zod" || dep.startsWith("node:") || dep.startsWith("src/catalog/transport/"),
    );
    expect(forbidden).toEqual([]);
  });

  it("keeps @kmodels/pricing portable runtime free of node built-ins and transport modules", async () => {
    const closure = await transitiveClosure(["src/pricing/index.ts"], "runtime");
    const forbidden = [...closure].filter(
      (dep) =>
        dep.startsWith("node:") ||
        dep.startsWith("src/catalog/transport/") ||
        dep === "src/catalog/fetch.ts",
    );
    expect(forbidden).toEqual([]);
  });
});
