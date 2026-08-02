import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vite-plus/test";
import type { AssetSource } from "../src/catalog/asset-pack.ts";
import { catalogExportAssets } from "../src/catalog/endpoints.ts";
import { sha256 } from "../src/catalog/io.ts";
import { manifests } from "../src/catalog/manifests.ts";
import { modelUid } from "../src/catalog/model.ts";
import { createPricingCatalogEnvelope } from "../src/catalog/pricing-envelope.ts";
import { prepareCatalogPair } from "../src/catalog/pricing-publication.ts";
import { projectCatalogPair } from "../src/catalog/projections.ts";
import {
  catalogIdsSchema,
  catalogModelsSchema,
  catalogProvidersSchema,
  catalogSummarySchema,
} from "../src/catalog/publication-schema.ts";
import { readPublishedAssetProfile } from "../src/catalog/published-assets.ts";
import { catalogEnvelopeSchema } from "../src/catalog/schema.ts";
import {
  websiteCatalogIndexSchema,
  websiteDetailChunkSchema,
  websitePricingSummariesSchema,
} from "../src/catalog/website-schema.ts";
import { generatedData } from "./generated-data-context.ts";

const generatedCatalogCalibrations = {
  huggingFace: { minimumModelsExclusive: 500, maximumModelsExclusive: 3_000 },
  vercel: { minimumModelsExclusive: 250, minimumPricingVariantsExclusive: 1_000 },
};

async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));
}

function expectUniqueValues<T>(actual: readonly T[], expected: Iterable<T>, label: string): void {
  const expectedValues = new Set(expected);
  expect(new Set(actual), label).toEqual(expectedValues);
  expect(actual, label).toHaveLength(expectedValues.size);
}

describe("generated static catalog", () => {
  it("publishes every provider with coverage and resolvable provenance", async () => {
    const { catalog } = await generatedData();
    const providerIds = catalog.providers.map(({ id }) => id);
    const configuredProviderIds = manifests.map(({ provider }) => provider.id);
    const coverageProviderIds = catalog.coverage.map(({ provider_id }) => provider_id);
    expectUniqueValues(providerIds, configuredProviderIds, "providers");
    expectUniqueValues(coverageProviderIds, providerIds, "provider coverage");
    expect(catalog.models.length).toBeGreaterThan(0);

    const sourceIds = new Set(catalog.sources.map((source) => source.id));
    const sourceRoles = new Map(catalog.sources.map((source) => [source.id, source.role]));
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
      expect(model.source_refs.some((source) => sourceRoles.get(source) === "catalog")).toBe(true);
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
    const { catalog } = await generatedData();
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
    const sampleProviderId = catalog.providers[0]?.id;
    if (sampleProviderId === undefined) throw new Error("Generated catalog has no providers");
    const providerAsset = assets.find(
      ({ fileName }) => fileName === `providers/${sampleProviderId}/index.json`,
    );
    const providerModelsAsset = assets.find(
      ({ fileName }) => fileName === `providers/${sampleProviderId}/models/index.json`,
    );
    const envelope = catalogEnvelopeSchema.parse(JSON.parse(catalogAsset?.source ?? ""));
    const ids = catalogIdsSchema.parse(JSON.parse(idsAsset?.source ?? ""));
    const published = catalogModelsSchema.parse(JSON.parse(modelsAsset?.source ?? ""));
    const summary = catalogSummarySchema.parse(JSON.parse(summaryAsset?.source ?? ""));
    catalogProvidersSchema.parse(JSON.parse(providersAsset?.source ?? ""));
    expect(JSON.parse(providerAsset?.source ?? "")).toMatchObject({
      profile: "provider",
      provider_id: sampleProviderId,
    });
    expect(JSON.parse(providerModelsAsset?.source ?? "")).toMatchObject({
      profile: "provider-models",
      provider_id: sampleProviderId,
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
    for (const provider of catalog.providers) {
      const sourceModels = catalog.models.filter(({ provider_id }) => provider_id === provider.id);
      const expectedModelIds = new Set(sourceModels.map(({ model_id }) => model_id));
      const publishedModelIds = ids.providers[provider.id];
      const publishedProvider = published.providers[provider.id];
      expect(publishedModelIds, provider.id).toBeDefined();
      expect(publishedProvider, provider.id).toBeDefined();
      if (publishedModelIds === undefined || publishedProvider === undefined) continue;
      expectUniqueValues(publishedModelIds, expectedModelIds, provider.id);
      expectUniqueValues(
        publishedProvider.models.map(({ model_id }) => model_id),
        expectedModelIds,
        provider.id,
      );
      for (const group of publishedProvider.models) {
        const expectedUids = sourceModels
          .filter(({ model_id }) => model_id === group.model_id)
          .map(({ uid }) => uid)
          .sort();
        const publishedUids = group.variants.map(({ uid }) => uid).sort();
        expect(publishedUids, `${provider.id}/${group.model_id}`).toEqual(expectedUids);
      }
    }
    expect(summary.models).toEqual(
      catalog.models.map(({ provider_id, model_id, version, tasks, status }) => ({
        provider: provider_id,
        model_id,
        ...(version === undefined ? {} : { version }),
        tasks,
        status,
      })),
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
    const { catalog } = await generatedData();
    const published = await readPublishedAssetProfile("exports");
    const actualHashes = new Map(
      published.manifest.assets.map(({ file_name, source_sha256 }) => [file_name, source_sha256]),
    );

    for (const asset of catalogExportAssets(catalog))
      expect(actualHashes.get(asset.fileName), asset.fileName).toBe(sha256(asset.source));
  });

  it("keeps Hugging Face within its operated-service boundary", async () => {
    const { catalog } = await generatedData();
    const models = catalog.models.filter(({ provider_id }) => provider_id === "huggingface");
    const sources = new Set(models.flatMap(({ source_refs }) => source_refs));
    expect(models.length).toBeGreaterThan(
      generatedCatalogCalibrations.huggingFace.minimumModelsExclusive,
    );
    expect(models.length).toBeLessThan(
      generatedCatalogCalibrations.huggingFace.maximumModelsExclusive,
    );
    expect([...sources].sort()).toEqual([
      "huggingface-hf-inference",
      "huggingface-hub",
      "huggingface-router",
    ]);
  });

  it("keeps committed structured evidence duplicate-free", async () => {
    const { catalog } = await generatedData();
    for (const model of catalog.models) {
      const endpoints = model.api_endpoints ?? [];
      const endpointKeys = endpoints.map(({ name, path }) => JSON.stringify([name, path]));
      const availabilityKeys = (model.availability ?? []).map(({ region, deployment_type }) =>
        JSON.stringify([region, deployment_type]),
      );
      expect(new Set(endpointKeys).size, model.uid).toBe(endpointKeys.length);
      expect(new Set(availabilityKeys).size, model.uid).toBe(availabilityKeys.length);
    }
  });

  it("keeps Azure OpenAI as a service family inside Microsoft Foundry", async () => {
    const { catalog } = await generatedData();
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

  it("does not publish credential identities in collection diagnostics", async () => {
    const { catalog } = await generatedData();
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

  it("publishes the complete Vercel catalog with canonical pricing", async () => {
    const { catalog, pricing: pricingEnvelope } = await generatedData();
    const pricing = pricingEnvelope.data;
    const models = catalog.models.filter((model) => model.provider_id === "vercel");
    const variants = pricing.books
      .filter(({ provider_id }) => provider_id === "vercel")
      .flatMap(({ offers }) => offers)
      .flatMap(({ terms }) => terms)
      .flatMap((term) =>
        term.kind === "raw" ? term.variants : [...term.variants, ...term.raw_variants],
      );
    expect(models.length).toBeGreaterThan(
      generatedCatalogCalibrations.vercel.minimumModelsExclusive,
    );
    expect(variants.length).toBeGreaterThan(
      generatedCatalogCalibrations.vercel.minimumPricingVariantsExclusive,
    );
    expect(models.every((model) => !("pricing" in model))).toBe(true);
    expect(models.every((model) => model.release_date !== undefined)).toBe(true);
  });
});
