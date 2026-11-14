import { readFile } from "node:fs/promises";
import { z } from "zod";
import { expect, it } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import { manifests } from "../src/catalog/manifests.ts";

it.each(["owned", "wrong-region", "duplicate", "wrong-index"])(
  "keeps the supplemental cache contract owned by its regional OpenAPI source (%s)",
  async (witness) => {
    const manifest = manifests.find(({ provider }) => provider.id === "kimi");
    const source = manifest?.sources.find(({ id }) => id === "kimi-openapi");
    if (!manifest || !source) throw Error("Missing source");
    const spec = await readFile(new URL("./fixtures/kimi/openapi.json", import.meta.url), "utf8");
    const cache = await readFile(
      new URL("./fixtures/kimi/cache-partition-en.txt", import.meta.url),
      "utf8",
    );
    const doc = {
      url: `https://platform.kimi.${witness === "wrong-region" ? "com" : "ai"}/docs/guide/context-caching.md`,
      body: cache,
    };
    const run = () =>
      parseSource({
        provider: { ...manifest.provider, source_ids: [source.id] },
        source,
        observedAt: "2026-11-15T00:00:00.000Z",
        body: JSON.stringify({
          index: {
            url: witness === "wrong-index" ? "https://example.test/openapi.json" : source.url,
            body: spec,
          },
          documents: witness === "duplicate" ? [doc, doc] : [doc],
        }),
      });

    if (witness === "wrong-index") {
      expect(run).toThrow("identity");
      return;
    }
    const result = run();
    expect(result.models.length).toBeGreaterThan(0);
    expect(
      result.pricing_inputs?.some(
        ({ key }) => key === "responses.input_tokens.cache_write_partition",
      ),
    ).toBe(witness === "owned");
  },
);

it("keeps documented API limits independent of unused SDK metadata", async () => {
  const manifest = manifests.find(({ provider }) => provider.id === "kimi");
  const source = manifest?.sources.find(({ id }) => id === "kimi-api");
  if (!manifest || !source) throw Error("Missing source");
  const root = z
    .object({ object: z.literal("list"), data: z.array(z.record(z.string(), z.unknown())) })
    .parse(
      JSON.parse(await readFile(new URL("./fixtures/kimi/api.json", import.meta.url), "utf8")),
    );
  for (const row of root.data)
    Object.assign(row, {
      permission: "SDK metadata",
      root: null,
      parent: null,
      limit: { context: 1048576 },
      modalities: { input: "SDK presentation" },
      tools: { dynamic_load: true },
      supports_dynamic_tools: true,
      think_efforts: { valid_efforts: ["low", "high", "max"] },
      reasoning_efforts: "SDK metadata",
      supports_thinking_type: null,
      reasoning: {},
    });
  const findings: unknown[] = [];
  const parsed = parseSource({
    provider: { ...manifest.provider, source_ids: [source.id] },
    source,
    body: JSON.stringify(root),
    observedAt: "2026-11-15T00:00:00.000Z",
    onContractFinding: (f) => findings.push(f),
  });
  expect(findings).toEqual([]);
  for (const model of parsed.models)
    expect(model.limits.context_tokens).toBe(
      root.data.find((row) => row.id === model.model_id)?.context_length,
    );
});
