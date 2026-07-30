import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vite-plus/test";
import type { AssetSource } from "../src/catalog/asset-pack.ts";
import { catalogExportAssets } from "../src/catalog/endpoints.ts";
import { sha256 } from "../src/catalog/io.ts";
import { manifests } from "../src/catalog/manifests.ts";
import { modelUid } from "../src/catalog/model.ts";
import { createPricingCatalogEnvelope } from "../src/catalog/pricing-envelope.ts";
import { prepareCatalogPair, readPricingMirrorSource } from "../src/catalog/pricing-publication.ts";
import { pricingCatalogEnvelopeSchema } from "../src/catalog/pricing-schema.ts";
import { projectCatalogPair } from "../src/catalog/projections.ts";
import {
  catalogIdsSchema,
  catalogModelsSchema,
  catalogProvidersSchema,
  catalogSummarySchema,
} from "../src/catalog/publication-schema.ts";
import { readPublishedAssetProfile } from "../src/catalog/published-assets.ts";
import { catalogEnvelopeSchema, catalogSchema } from "../src/catalog/schema.ts";
import {
  websiteCatalogIndexSchema,
  websiteDetailChunkSchema,
  websitePricingSummariesSchema,
} from "../src/catalog/website-schema.ts";

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
    const candidate = prepareCatalogPair(catalog, pricing);
    const projections = projectCatalogPair(candidate);
    const assets: AssetSource[] = [projections.ui, projections.exports].flatMap(
      ({ manifest, pack }) =>
        manifest.assets.map(({ file_name, offset, length }) => ({
          fileName: file_name,
          source: gunzipSync(pack.subarray(offset, offset + length)).toString("utf8"),
        })),
    );
    const catalogAsset = assets.find(({ fileName }) => fileName === "catalog/index.json");
    const pricingAsset = assets.find(({ fileName }) => fileName === "pricing/index.json");
    const websiteAsset = assets.find(({ fileName }) => fileName === "ui/catalog/index.json");
    const websitePricingAsset = assets.find(
      ({ fileName }) => fileName === "ui/catalog/pricing.json",
    );
    const websiteDetailAssets = assets.filter(({ fileName }) => fileName.startsWith("ui/details/"));
    const idsAsset = assets.find(({ fileName }) => fileName === "catalog/ids.json");
    const modelsAsset = assets.find(({ fileName }) => fileName === "catalog/models.json");
    const summaryAsset = assets.find(({ fileName }) => fileName === "catalog/summary.json");
    const providersAsset = assets.find(({ fileName }) => fileName === "providers/index.json");
    const providerAsset = assets.find(({ fileName }) => fileName === "providers/openai/index.json");
    const providerModelsAsset = assets.find(
      ({ fileName }) => fileName === "providers/openai/models/index.json",
    );
    const envelope = catalogEnvelopeSchema.parse(JSON.parse(catalogAsset?.source ?? ""));
    const ids = catalogIdsSchema.parse(JSON.parse(idsAsset?.source ?? ""));
    const published = catalogModelsSchema.parse(JSON.parse(modelsAsset?.source ?? ""));
    const summary = catalogSummarySchema.parse(JSON.parse(summaryAsset?.source ?? ""));
    catalogProvidersSchema.parse(JSON.parse(providersAsset?.source ?? ""));
    expect(JSON.parse(providerAsset?.source ?? "")).toMatchObject({
      profile: "provider",
      provider_id: "openai",
    });
    expect(JSON.parse(providerModelsAsset?.source ?? "")).toMatchObject({
      profile: "provider-models",
      provider_id: "openai",
    });
    const distinctModelCount = new Set(
      catalog.models.map(({ provider_id, model_id }) => JSON.stringify([provider_id, model_id])),
    ).size;
    expect(envelope.catalog_version).toBe(catalog.catalog_version);
    expect(envelope.data.models).toHaveLength(catalog.models.length);
    expect(envelope.data.providers).toEqual(catalog.providers);
    expect(
      Object.values(ids.providers).reduce((count, modelIds) => count + modelIds.length, 0),
    ).toBe(distinctModelCount);
    expect(ids.providers.azure?.filter((modelId) => modelId === "gpt-4o")).toEqual(["gpt-4o"]);
    expect(
      Object.values(published.providers).reduce(
        (count, provider) => count + provider.models.length,
        0,
      ),
    ).toBe(distinctModelCount);
    expect(
      Object.values(published.providers).reduce(
        (count, provider) =>
          count +
          provider.models.reduce(
            (providerCount, model) => providerCount + model.variants.length,
            0,
          ),
        0,
      ),
    ).toBe(catalog.models.length);
    expect(
      published.providers.azure?.models.find(({ model_id }) => model_id === "gpt-4o")?.variants,
    ).toHaveLength(4);
    expect(summary.models).toHaveLength(catalog.models.length);
    expect(
      summary.models.filter(
        ({ provider, model_id }) => provider === "azure" && model_id === "gpt-4",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          version: "0125-Preview",
          tasks: ["text_generation"],
          status: "unknown",
        }),
        expect.objectContaining({
          version: "turbo-2024-04-09",
          tasks: ["text_generation"],
          status: "active",
        }),
      ]),
    );
    expect(modelsAsset?.source).not.toMatch(
      /"(?:task_evidence|delivery_mode_evidence|raw_type|routes|source_refs|observed_at|first_seen_at|last_seen_at|warnings)"/,
    );
    expect(
      assets
        .filter(
          ({ fileName }) =>
            fileName.startsWith("providers/") || fileName === "providers/index.json",
        )
        .map(({ source }) => source)
        .join(""),
    ).not.toMatch(
      /"(?:task_evidence|delivery_mode_evidence|raw_type|routes|source_refs|source_ids|observed_at|first_seen_at|last_seen_at|warnings)"/,
    );
    expect(pricingAsset?.source.endsWith("\n")).toBe(false);
    const website = websiteCatalogIndexSchema.parse(JSON.parse(websiteAsset?.source ?? ""));
    const websitePricing = websitePricingSummariesSchema.parse(
      JSON.parse(websitePricingAsset?.source ?? ""),
    );
    const websiteDetails = websiteDetailAssets.map(({ source }) =>
      websiteDetailChunkSchema.parse(JSON.parse(source)),
    );
    expect(website.data_version).toBe(websitePricing.data_version);
    expect(website.models).toHaveLength(catalog.models.length);
    expect(websitePricing.pricing).toHaveLength(catalog.models.length);
    expect(websiteDetails.flatMap(({ details }) => details)).toHaveLength(catalog.models.length);
    expect(assets).toHaveLength(8 + catalog.providers.length * 2 + websiteDetailAssets.length);
  });

  it("keeps checked-in catalog exports synchronized with their projection contracts", async () => {
    const catalog = catalogSchema.parse(await json("data/catalog.json"));
    const published = await readPublishedAssetProfile("exports");
    const actualHashes = new Map(
      published.manifest.assets.map(({ file_name, source_sha256 }) => [file_name, source_sha256]),
    );

    for (const asset of catalogExportAssets(catalog))
      expect(actualHashes.get(asset.fileName), asset.fileName).toBe(sha256(asset.source));
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
