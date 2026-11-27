import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vite-plus/test";
import { compressedAsset } from "../src/catalog/asset-pack.ts";
import { catalogExportAssets } from "../src/catalog/endpoints.ts";
import { sha256 } from "../src/catalog/io.ts";
import { manifests } from "../src/catalog/manifests.ts";
import { modelUid } from "../src/catalog/model.ts";
import {
  catalogIdentifiersSchema,
  catalogIdsSchema,
  catalogModelsSchema,
  catalogProvidersSchema,
  catalogSummarySchema,
} from "../src/catalog/publication-schema.ts";
import { readPublishedAssetProfile } from "../src/catalog/published-assets.ts";
import { catalogEnvelopeSchema } from "../src/catalog/schema.ts";
import { inferencePriceMappingSchema } from "../src/pricing/inference-schema.ts";
import { generatedData } from "./generated-data-context.ts";

const retiredHuggingFaceSourceHosts = new Map([
  ["huggingface-featherless", "api.featherless.ai"],
  ["huggingface-hub", "huggingface.co"],
  ["huggingface-native-pricing", "huggingface.co"],
  ["huggingface-router", "router.huggingface.co"],
]);

async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));
}

function expectUniqueValues<T>(actual: readonly T[], expected: Iterable<T>, label: string): void {
  const expectedValues = new Set(expected);
  expect(new Set(actual), label).toEqual(expectedValues);
  expect(actual, label).toHaveLength(expectedValues.size);
}

describe("generated static catalog", () => {
  it("commits inference mappings for the same catalog and price versions", async () => {
    const [{ catalog, pricing }, input] = await Promise.all([
      generatedData(),
      json("data/inference-pricing.json"),
    ]);
    const mapping = inferencePriceMappingSchema.parse(input);
    expect(mapping.core_catalog_version).toBe(catalog.catalog_version);
    expect(mapping.pricing_data_version).toBe(pricing.pricing_data_version);
  });

  it("publishes every provider with coverage and resolvable provenance", async () => {
    const { catalog } = await generatedData();
    const providerIds = catalog.providers.map(({ id }) => id);
    const configuredProviderIds = manifests.map(({ provider }) => provider.id);
    const coverageProviderIds = catalog.coverage.map(({ provider_id }) => provider_id);
    // Registering a source does not retroactively collect it into an accepted snapshot.
    expect(providerIds.every((id) => configuredProviderIds.includes(id))).toBe(true);
    expect(new Set(providerIds).size).toBe(providerIds.length);
    expectUniqueValues(coverageProviderIds, providerIds, "provider coverage");

    const sourceIds = new Set(catalog.sources.map((source) => source.id));
    const sourceProviders = new Map(
      catalog.sources.map(({ id, provider_id }) => [id, provider_id]),
    );
    const sourceRoles = new Map(catalog.sources.map((source) => [source.id, source.role]));
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
        model.source_refs.some((source) => {
          const role = sourceRoles.get(source);
          return role === "catalog" || role === "supplement";
        }),
      ).toBe(true);
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
      expect(model).not.toHaveProperty("pricing");
      for (const ref of model.source_refs)
        expect(sourceProviders.get(ref), `${model.uid}: ${ref}`).toBe(model.provider_id);
    }

    const manifestsBySource = new Map(
      manifests.flatMap((manifest) => manifest.sources.map((source) => [source.id, source])),
    );
    for (const source of catalog.sources) {
      expect(providerIds, source.id).toContain(source.provider_id);
      const configured = manifestsBySource.get(source.id);
      const host = new URL(source.url).hostname;
      if (configured === undefined && source.provider_id === "huggingface") {
        // Accepted and stale snapshots can still reference the previous routed catalog.
        expect(host, source.id).toBe(retiredHuggingFaceSourceHosts.get(source.id));
      } else {
        expect(configured?.allowedHosts, source.id).toContain(host);
      }
      expect(source.source.length).toBeGreaterThan(0);
      expect(source).not.toHaveProperty("source_type");
      expect(source).not.toHaveProperty("access");
      expect(source).not.toHaveProperty("format");
      expect(source).not.toHaveProperty("snapshot_uri");
    }
  });

  it("keeps published catalog endpoints synchronized with the catalog and their public contracts", async () => {
    const { catalog } = await generatedData();
    const publishedExports = await readPublishedAssetProfile("exports");
    const entries = new Map(
      publishedExports.manifest.assets.map((entry) => [entry.file_name, entry]),
    );
    const assets = new Map<string, string>();
    for (const asset of catalogExportAssets(catalog)) {
      const entry = entries.get(asset.fileName);
      if (entry === undefined) throw new Error(`Missing catalog export ${asset.fileName}`);
      const source = gunzipSync(compressedAsset(publishedExports.pack, entry)).toString("utf8");
      expect(sha256(source), asset.fileName).toBe(entry.source_sha256);
      expect(sha256(asset.source), asset.fileName).toBe(entry.source_sha256);
      assets.set(asset.fileName, source);
    }
    function read(path: string): unknown {
      const source = assets.get(path);
      if (source === undefined) throw new Error(`Missing catalog export ${path}`);
      return JSON.parse(source);
    }

    const envelope = catalogEnvelopeSchema.parse(read("catalog/index.json"));
    const ids = catalogIdsSchema.parse(read("catalog/ids.json"));
    const identifiers = catalogIdentifiersSchema.parse(read("catalog/identifiers.json"));
    const published = catalogModelsSchema.parse(read("catalog/models.json"));
    const summary = catalogSummarySchema.parse(read("catalog/summary.json"));
    catalogProvidersSchema.parse(read("providers/index.json"));
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
      expect(read(`providers/${provider.id}/index.json`), provider.id).toMatchObject({
        profile: "provider",
        provider_id: provider.id,
      });
      expect(read(`providers/${provider.id}/models/index.json`), provider.id).toMatchObject({
        profile: "provider-models",
        provider_id: provider.id,
      });
      const publishedModelIds = ids.providers[provider.id];
      const publishedIdentifiers = identifiers.providers[provider.id];
      const publishedProvider = published.providers[provider.id];
      expect(publishedModelIds, provider.id).toBeDefined();
      expect(publishedIdentifiers, provider.id).toBeDefined();
      expect(publishedProvider, provider.id).toBeDefined();
      if (
        publishedModelIds === undefined ||
        publishedIdentifiers === undefined ||
        publishedProvider === undefined
      )
        continue;
      expectUniqueValues(publishedModelIds, expectedModelIds, provider.id);
      expectUniqueValues(
        Object.keys(publishedIdentifiers),
        sourceModels.flatMap(({ model_id, aliases }) => [model_id, ...aliases]),
        `${provider.id} identifiers`,
      );
      for (const [value, targets] of Object.entries(publishedIdentifiers)) {
        const expectedTargets = sourceModels.flatMap((model) => [
          ...(model.model_id === value ? [{ model, kind: "model_id" as const }] : []),
          ...(model.aliases.includes(value) ? [{ model, kind: "alias" as const }] : []),
        ]);
        expect(targets, `${provider.id}/${value}`).toEqual(
          expectedTargets
            .map(({ model, kind }) => ({
              model_ref: model.uid,
              kind,
            }))
            .sort(
              (left, right) =>
                left.model_ref.localeCompare(right.model_ref) ||
                left.kind.localeCompare(right.kind),
            ),
        );
      }
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
    expect(assets.get("catalog/models.json")).not.toMatch(
      /"(?:task_evidence|delivery_mode_evidence|raw_type|routes|source_refs|observed_at|first_seen_at|last_seen_at|warnings)"/,
    );
    for (const [path, source] of assets) {
      if (!path.startsWith("providers/")) continue;
      expect(source, path).not.toMatch(
        /"(?:task_evidence|delivery_mode_evidence|raw_type|routes|source_refs|source_ids|observed_at|first_seen_at|last_seen_at|warnings)"/,
      );
    }
  }, 15_000);

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
});
