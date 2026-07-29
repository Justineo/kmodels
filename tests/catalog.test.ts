import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { catalogAssets } from "../src/catalog/endpoints.ts";
import { manifests } from "../src/catalog/manifests.ts";
import { modelUid } from "../src/catalog/model.ts";
import { createPricingCatalogEnvelope } from "../src/catalog/pricing-envelope.ts";
import { readPricingMirrorSource } from "../src/catalog/pricing-publication.ts";
import { pricingCatalogEnvelopeSchema } from "../src/catalog/pricing-schema.ts";
import { catalogEnvelopeSchema, catalogSchema } from "../src/catalog/schema.ts";

async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));
}

describe("generated static catalog", () => {
  it("publishes every provider with coverage and resolvable provenance", async () => {
    const catalog = catalogSchema.parse(await json("data/catalog.json"));
    expect(catalog.providers).toHaveLength(18);
    expect(catalog.coverage).toHaveLength(18);
    expect(catalog.models.length).toBeGreaterThan(0);

    const sourceIds = new Set(catalog.sources.map((source) => source.id));
    const referencedSourceIds = new Set(catalog.models.flatMap((model) => model.source_refs));
    const modelIds = new Set<string>();
    const manifestsByProvider = new Map(
      manifests.map((manifest) => [manifest.provider.id, manifest.provider]),
    );
    for (const provider of catalog.providers) {
      expect(provider.name).toBe(manifestsByProvider.get(provider.id)?.name);
    }
    for (const model of catalog.models) {
      expect(modelIds.has(model.uid)).toBe(false);
      modelIds.add(model.uid);
      expect(model.uid).toBe(modelUid(model.provider_id, model.model_id, model.version));
      expect(model.source_refs.every((source) => sourceIds.has(source))).toBe(true);
      expect(
        model.task_evidence?.every(
          (evidence) => sourceIds.has(evidence.source_ref) && model.tasks.includes(evidence.task),
        ) ?? true,
      ).toBe(true);
      expect(
        model.delivery_mode_evidence?.every(
          (evidence) =>
            sourceIds.has(evidence.source_ref) &&
            model.delivery_modes?.includes(evidence.mode) === true,
        ) ?? true,
      ).toBe(true);
      expect(
        model.routes?.every(
          (route) =>
            sourceIds.has(route.source_ref) && model.source_refs.includes(route.source_ref),
        ) ?? true,
      ).toBe(true);
      expect(model.account_availability).toBe("unknown");
    }

    const manifestsBySource = new Map(
      manifests.flatMap((manifest) => manifest.sources.map((source) => [source.id, source])),
    );
    for (const source of catalog.sources) {
      expect(referencedSourceIds.has(source.id)).toBe(true);
      const configured = manifestsBySource.get(source.id);
      expect(configured?.allowedHosts).toContain(new URL(source.url).hostname);
      expect(source.source.length).toBeGreaterThan(0);
      expect(source).not.toHaveProperty("source_type");
      expect(source).not.toHaveProperty("access");
      expect(source).not.toHaveProperty("format");
      expect(source).not.toHaveProperty("snapshot_uri");
    }
  });

  it("builds public endpoints from durable state", async () => {
    const catalog = catalogSchema.parse(await json("data/catalog.json"));
    const pricing = createPricingCatalogEnvelope(
      {
        provider_vocabularies: [],
        provider_snapshots: [],
        model_dispositions: [],
        books: [],
      },
      catalog,
    );
    const assets = catalogAssets(catalog, pricing);
    const catalogAsset = assets.find(({ fileName }) => fileName === "catalog/index.json");
    const pricingAsset = assets.find(({ fileName }) => fileName === "pricing/index.json");
    const websiteAsset = assets.find(({ fileName }) => fileName === "ui/catalog/index.json");
    const envelope = catalogEnvelopeSchema.parse(JSON.parse(catalogAsset?.source ?? ""));
    expect(envelope.catalog_version).toBe(catalog.catalog_version);
    expect(envelope.data.models).toHaveLength(catalog.models.length);
    expect(envelope.data.providers).toEqual(catalog.providers);
    expect(pricingAsset?.source.endsWith("\n")).toBe(false);
    expect(websiteAsset).toBeDefined();
    expect(assets).toHaveLength(4 + catalog.providers.length * 2 + catalog.models.length);
  });

  it("keeps Hugging Face within its operated-service boundary", async () => {
    const catalog = catalogSchema.parse(await json("data/catalog.json"));
    const models = catalog.models.filter(({ provider_id }) => provider_id === "huggingface");
    const sources = new Set(models.flatMap(({ source_refs }) => source_refs));
    expect(models.length).toBeGreaterThan(500);
    expect(models.length).toBeLessThan(3_000);
    expect([...sources].sort()).toEqual(["huggingface-hf-inference", "huggingface-router"]);
  });

  it("publishes Bedrock route evidence without duplicating shared endpoint facts", async () => {
    const catalog = catalogSchema.parse(await json("data/catalog.json"));
    const models = catalog.models.filter(({ provider_id }) => provider_id === "amazon-bedrock");
    const coverage = catalog.coverage.find(({ provider_id }) => provider_id === "amazon-bedrock");
    const deepseek = models.find(({ model_id }) => model_id === "deepseek.v3.2");
    expect(coverage?.status).toBe("fresh");
    expect(models.flatMap(({ api_endpoints }) => api_endpoints ?? []).length).toBeGreaterThan(200);
    expect(models.flatMap(({ availability }) => availability).length).toBeGreaterThan(1_500);
    expect(deepseek?.api_endpoints?.filter(({ name }) => name === "Chat Completions")).toEqual([
      { name: "Chat Completions", path: "v1/chat/completions" },
    ]);
  });

  it("keeps Azure OpenAI as a service family inside Microsoft Foundry", async () => {
    const catalog = catalogSchema.parse(await json("data/catalog.json"));
    const models = catalog.models.filter(({ provider_id }) => provider_id === "azure");
    const families = new Set(models.flatMap(({ service_families }) => service_families ?? []));
    expect(families).toEqual(
      new Set([
        "Azure OpenAI",
        "Foundry Models from partners and community",
        "Foundry Models sold by Azure",
      ]),
    );
  });

  it("publishes the repaired authenticated inventories without transport or schema failures", async () => {
    const catalog = catalogSchema.parse(await json("data/catalog.json"));
    const repairedSources = new Set([
      "cohere-api",
      "dashscope-deployable-api",
      "gemini-api",
      "kimi-api",
      "vertex-model-garden-api",
    ]);
    expect(
      catalog.warnings.filter(
        (warning) =>
          "source_id" in warning &&
          warning.source_id !== undefined &&
          repairedSources.has(warning.source_id) &&
          ["source_fetch_failed", "source_parse_failed"].includes(warning.code),
      ),
    ).toEqual([]);
  });

  it("does not publish credential identities in collection diagnostics", async () => {
    const catalog = catalogSchema.parse(await json("data/catalog.json"));
    const diagnostics = JSON.stringify({
      coverage: catalog.coverage,
      warnings: catalog.warnings,
      quarantine: await json("data/quarantine.json"),
      refresh: await json("data/refresh-summary.json"),
    });
    expect(diagnostics).not.toMatch(
      /\barn:aws(?:-[a-z0-9-]+)?:|\b\d{12}\b|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i,
    );
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

  it("publishes the complete Vercel catalog with canonical pricing", async () => {
    const catalog = catalogSchema.parse(await json("data/catalog.json"));
    const pricing = pricingCatalogEnvelopeSchema.parse(
      JSON.parse(await readPricingMirrorSource()),
    ).data;
    const models = catalog.models.filter((model) => model.provider_id === "vercel");
    const variants = pricing.books
      .filter(({ provider_id }) => provider_id === "vercel")
      .flatMap(({ offers }) => offers)
      .flatMap(({ terms }) => terms)
      .flatMap((term) =>
        term.kind === "raw" ? term.variants : [...term.variants, ...term.raw_variants],
      );
    const embedding = models.find((model) => model.model_id === "alibaba/qwen3-embedding-0.6b");
    const realtime = models.find((model) => model.model_id === "openai/gpt-5.6-luna");
    expect(models.length).toBeGreaterThan(250);
    expect(variants.length).toBeGreaterThan(1_000);
    expect(models.every((model) => !("pricing" in model))).toBe(true);
    expect(models.every((model) => model.release_date !== undefined)).toBe(true);
    expect(embedding?.modalities.output).toEqual(["embedding"]);
    expect(realtime?.tasks).toEqual(["text_generation"]);
  });
});
