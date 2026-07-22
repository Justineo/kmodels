import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { manifests } from "../src/catalog/manifests.ts";
import { catalogEnvelopeSchema, catalogSchema } from "../src/catalog/schema.ts";

async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));
}

describe("generated static catalog", () => {
  it("publishes every provider with coverage and resolvable provenance", async () => {
    const catalog = catalogSchema.parse(await json("data/catalog.json"));
    expect(catalog.providers).toHaveLength(19);
    expect(catalog.coverage).toHaveLength(19);
    expect(catalog.models.length).toBeGreaterThan(0);

    const sourceIds = new Set(catalog.sources.map((source) => source.id));
    const modelIds = new Set<string>();
    for (const model of catalog.models) {
      expect(modelIds.has(model.uid)).toBe(false);
      modelIds.add(model.uid);
      expect(model.uid).toBe(`${model.provider_id}/${model.model_id}`);
      expect(model.source_refs.every((source) => sourceIds.has(source))).toBe(true);
      expect(model.pricing.every((rate) => sourceIds.has(rate.source_ref))).toBe(true);
      expect(model.account_availability).toBe("unknown");
    }

    const manifestsBySource = new Map(
      manifests.flatMap((manifest) => manifest.sources.map((source) => [source.id, source])),
    );
    for (const source of catalog.sources) {
      const configured = manifestsBySource.get(source.id);
      expect(configured?.allowedHosts).toContain(new URL(source.url).hostname);
    }
  });

  it("keeps the public envelope aligned with durable state", async () => {
    const catalog = catalogSchema.parse(await json("data/catalog.json"));
    const envelope = catalogEnvelopeSchema.parse(await json("public/v1/catalog/index.json"));
    expect(envelope.catalog_version).toBe(catalog.catalog_version);
    expect(envelope.data.models).toHaveLength(catalog.models.length);
    expect(envelope.data.providers).toEqual(catalog.providers);
  });
});
