import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { manifests } from "../src/catalog/manifests.ts";
import { modelUid } from "../src/catalog/model.ts";
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
      expect(model.uid).toBe(modelUid(model.provider_id, model.model_id, model.version));
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
      expect(source.source.length).toBeGreaterThan(0);
      expect(source).not.toHaveProperty("source_type");
      expect(source).not.toHaveProperty("access");
      expect(source).not.toHaveProperty("format");
    }
  });

  it("keeps the public envelope aligned with durable state", async () => {
    const catalog = catalogSchema.parse(await json("data/catalog.json"));
    const envelope = catalogEnvelopeSchema.parse(await json("public/v1/catalog/index.json"));
    expect(envelope.catalog_version).toBe(catalog.catalog_version);
    expect(envelope.data.models).toHaveLength(catalog.models.length);
    expect(envelope.data.providers).toEqual(catalog.providers);
  });

  it("does not collapse an exact catalog ID through another model's alias", async () => {
    const catalog = catalogSchema.parse(await json("data/catalog.json"));
    const o1 = catalog.models.find((model) => model.uid === "openai/o1");
    const preview = catalog.models.find((model) => model.uid === "openai/o1-preview");
    expect({
      name: o1?.name,
      description: o1?.description,
      context: o1?.limits.context_tokens,
    }).toEqual({
      name: "o1",
      description: "Previous full o-series reasoning model",
      context: 200_000,
    });
    expect(preview?.name).toBe("o1 Preview");
    expect(o1?.aliases).not.toContain("o1-preview-2024-09-12");
  });

  it("publishes the complete structured Vercel catalog without hiding missing prices", async () => {
    const catalog = catalogSchema.parse(await json("data/catalog.json"));
    const models = catalog.models.filter((model) => model.provider_id === "vercel");
    const rates = models.flatMap((model) => model.pricing);
    const embedding = models.find((model) => model.model_id === "alibaba/qwen3-embedding-0.6b");
    const realtime = models.find((model) => model.model_id === "openai/gpt-5.6-luna");
    expect(models.length).toBeGreaterThan(250);
    expect(rates.length).toBeGreaterThan(1_000);
    expect(models.every((model) => model.release_date !== undefined)).toBe(true);
    expect(embedding?.modalities.output).toEqual(["embedding"]);
    expect(realtime?.types).toEqual(["generate", "realtime"]);
    expect(
      catalog.warnings.some(
        (warning) =>
          warning.code === "missing_field" &&
          "provider_id" in warning &&
          warning.provider_id === "vercel" &&
          warning.field === "pricing",
      ),
    ).toBe(true);
  });
});
