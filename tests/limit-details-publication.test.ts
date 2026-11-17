import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import * as canonicalValues from "../src/catalog/canonical-value.ts";
import { canonicalJson } from "../src/catalog/canonical-json.ts";
import { catalogExportAssets, catalogJson } from "../src/catalog/endpoints.ts";
import { sha256, stableJson } from "../src/catalog/io.ts";
import { baseModel } from "../src/catalog/model.ts";
import { coreCatalogVersion } from "../src/catalog/pricing-pair-transition.ts";
import {
  createPricingCatalogEnvelope,
  decodePricingCatalog,
  pricingCatalogJson,
  validatePricingCatalogEnvelope,
} from "../src/catalog/pricing-envelope.ts";
import {
  commitCatalogPair,
  prepareCatalogPair,
  prepareCatalogPairInParallel,
  recoverCatalogPair,
  type CatalogPairPaths,
} from "../src/catalog/pricing-publication.ts";
import { emptyPricingCatalog } from "../src/catalog/pricing-schema.ts";
import {
  readPublishedAssets,
  readCompressedProfileAsset,
} from "../src/catalog/published-assets.ts";
import { catalogModels, catalogSummary } from "../src/catalog/publication.ts";
import { publishedModelVariantSchema } from "../src/catalog/publication-schema.ts";
import {
  catalogEnvelopeSchema,
  catalogSchema,
  providerModelSchema,
  type Catalog,
} from "../src/catalog/schema.ts";

const observedAt = "2026-07-28T00:00:00.000Z";
const directories: string[] = [];
const utf8 = new TextEncoder();

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

function catalog(tokens?: number): Catalog {
  const model = providerModelSchema.parse({
    ...baseModel({
      providerId: "test",
      id: "model",
      name: "Model",
      sourceId: "test-source",
      observedAt,
    }),
    tasks: ["text_generation"],
    limits: { max_output_tokens: 100 },
    ...(tokens === undefined
      ? {}
      : {
          limit_details: [
            {
              source_ref: "test-source",
              claim: "batch_output",
              statements: [
                {
                  quantity: "output_tokens",
                  kind: "maximum",
                  tokens,
                  measurement: "per_response",
                  scope: "Batch API with the documented beta header only",
                },
              ],
              evidence: [
                {
                  document_url: "https://example.com/models",
                  locator: "Batch output limits",
                  observed_at: observedAt,
                  content_hash: "a".repeat(64),
                  excerpt: "Batch output requires the documented beta header.",
                },
              ],
            },
          ],
        }),
  });
  const providers = [
    {
      id: "test",
      name: "Test",
      kind: "hosted",
      homepage: "https://example.com",
      catalog_scope: "global",
      source_ids: ["test-source"],
      catalog_version: sha256(stableJson([model])),
    },
  ];
  return catalogSchema.parse(
    JSON.parse(
      JSON.stringify({
        catalog_version: coreCatalogVersion(catalogSchema.shape.providers.parse(providers)),
        generated_at: observedAt,
        providers,
        models: [model],
        sources: [
          {
            id: "test-source",
            provider_id: "test",
            url: "https://example.com/models",
            source: ["website"],
            stability: "documented",
            field_paths: ["model_id", "limit_details"],
            observed_at: observedAt,
            content_hash: "a".repeat(64),
            extractor_version: "1",
          },
        ],
        coverage: [
          {
            provider_id: "test",
            status: "fresh",
            model_count: 1,
            pricing_term_count: 0,
            checked_at: observedAt,
          },
        ],
        warnings: [],
      }),
    ),
  );
}

function publicCatalog(source: string): Catalog {
  const { data, ...metadata } = catalogEnvelopeSchema.parse(JSON.parse(source));
  return { ...metadata, ...data };
}

async function paths(): Promise<CatalogPairPaths> {
  const directory = await mkdtemp(join(tmpdir(), "kmodels-limit-publication-"));
  directories.push(directory);
  return {
    stateDirectory: join(directory, "state"),
    catalogMirror: join(directory, "catalog.json"),
    pricingMirrorGzip: join(directory, "pricing.json.gz"),
    projections: {
      uiManifest: join(directory, "ui-assets.json"),
      uiPack: join(directory, "ui-assets.pack"),
      exportManifest: join(directory, "export-assets.json"),
      exportPack: join(directory, "export-assets.pack"),
    },
  };
}

async function snapshotBytes(directory: string) {
  return Promise.all(
    (await readdir(directory))
      .sort()
      .map(async (file) => [file, await readFile(join(directory, file))]),
  );
}

describe("scoped limit publication compatibility", () => {
  it("omits only new detail from legacy audit and strict v1 profiles", () => {
    const full = catalog(300);
    const expected = {
      ...full,
      models: full.models.map(({ limit_details: _details, ...model }) => model),
    };
    expect(catalogExportAssets(full)).toEqual(catalogExportAssets(expected));
    expect(publicCatalog(catalogJson(full))).toEqual(expected);
    const variant = catalogModels(full).providers.test?.models[0]?.variants[0];
    expect(variant).toBeDefined();
    expect(
      publishedModelVariantSchema.safeParse({
        ...variant,
        limit_details: full.models[0]?.limit_details,
      }).success,
    ).toBe(false);
    expect(catalogSummary(full)).toEqual(catalogSummary(expected));
    expect(full.models[0]?.limit_details).toHaveLength(1);
  });

  it("binds each envelope to its exact core while serializing pricing data once", async () => {
    const data = emptyPricingCatalog();
    const serialize = vi.spyOn(canonicalValues, "canonicalJsonChunksFromValidated");
    const full = catalog(300);
    const candidate = prepareCatalogPair(full, data);
    const projected = publicCatalog(candidate.catalogAssetSource);
    const published = decodePricingCatalog(utf8.encode(candidate.pricingAssetSource), projected);
    expect(serialize).toHaveBeenCalledTimes(1);
    expect(candidate.pricing.data).toBe(data);
    expect(published.data).toEqual(candidate.pricing.data);
    expect(published.pricing_data_version).toBe(candidate.pricing.pricing_data_version);
    expect(published.core_catalog_version).toBe(full.catalog_version);
    expect(published.generated_at).toBe(candidate.pricing.generated_at);
    expect(published.core_data_sha256).not.toBe(candidate.pricing.core_data_sha256);
    expect(() => validatePricingCatalogEnvelope(candidate.pricing, full)).not.toThrow();
    expect(() => decodePricingCatalog(utf8.encode(candidate.pricingAssetSource), full)).toThrow(
      "core data hash",
    );
    expect(() => validatePricingCatalogEnvelope(candidate.pricing, projected)).toThrow(
      "core data hash",
    );
    expect(() => prepareCatalogPair(full, published)).toThrow("core data hash");
    expect(() => prepareCatalogPair(projected, candidate.pricing)).toThrow("core data hash");
    await expect(prepareCatalogPairInParallel(full, published)).rejects.toThrow("core data hash");
    expect(candidate.pricingStorageChunks.join("")).toBe(
      pricingCatalogJson(candidate.pricing, full),
    );
    expect(() => prepareCatalogPair(catalog(301), candidate.pricing)).toThrow("catalog version");
  });

  it("keeps no-detail bytes, v1 state and canonical chunks shared", async () => {
    const full = catalog();
    const data = emptyPricingCatalog();
    const envelope = createPricingCatalogEnvelope(data, full);
    const candidate = prepareCatalogPair(full, envelope);
    expect(candidate.pricingStorageChunks).toBe(candidate.pricingAssetChunks);
    expect(candidate.pricingAssetSource).toBe(pricingCatalogJson(envelope, full));
    const output = await paths();
    await commitCatalogPair(candidate, output);
    expect(JSON.parse(await readFile(join(output.stateDirectory, "current.json"), "utf8"))).toEqual(
      {
        version: 1,
        pair_id: candidate.pairId,
        ...candidate.identity,
      },
    );
    expect((await recoverCatalogPair(output))?.identity).toEqual(candidate.identity);
  });

  it("round-trips full v2 storage, repairs mirrors and bootstraps without local state", async () => {
    const full = catalog(300);
    const candidate = prepareCatalogPair(full, emptyPricingCatalog());
    expect(await prepareCatalogPairInParallel(full, emptyPricingCatalog())).toEqual(candidate);
    const output = await paths();
    await commitCatalogPair(candidate, output);
    const pointer = JSON.parse(await readFile(join(output.stateDirectory, "current.json"), "utf8"));
    expect(pointer).toEqual({
      version: 2,
      pair_id: candidate.pairId,
      core_data_sha256: candidate.pricing.core_data_sha256,
      ...candidate.identity,
    });
    const snapshot = join(output.stateDirectory, "snapshots", candidate.pairId);
    expect(await readFile(join(snapshot, "catalog.json"), "utf8")).toBe(
      candidate.catalogStorageSource,
    );
    expect(await readFile(join(snapshot, "pricing.json"), "utf8")).toBe(
      candidate.pricingStorageChunks.join(""),
    );
    const published = await readPublishedAssets(output.projections);
    const publicPricing = readCompressedProfileAsset(published.exports, "/pricing/index.json");
    if (publicPricing === undefined) throw new Error("Missing public pricing asset");
    expect(gunzipSync(publicPricing).toString("utf8")).toBe(candidate.pricingAssetSource);
    await writeFile(output.catalogMirror, "{}");
    await writeFile(output.pricingMirrorGzip, "{}");
    const recovered = await recoverCatalogPair(output);
    expect(recovered).toEqual(candidate);
    const mirror = gunzipSync(await readFile(output.pricingMirrorGzip));
    expect(decodePricingCatalog(mirror, full)).toEqual(candidate.pricing);
    expect(() => decodePricingCatalog(mirror, publicCatalog(candidate.catalogAssetSource))).toThrow(
      "core data hash",
    );
    await rm(output.stateDirectory, { recursive: true });
    expect(await recoverCatalogPair(output)).toEqual(candidate);
  });

  it("advances the full model commitment without changing pricing facts", async () => {
    const first = prepareCatalogPair(catalog(300), emptyPricingCatalog());
    const changed = prepareCatalogPair(catalog(301), emptyPricingCatalog());
    expect(changed.catalog.catalog_version).not.toBe(first.catalog.catalog_version);
    expect(changed.pricing.core_data_sha256).not.toBe(first.pricing.core_data_sha256);
    expect(changed.pairId).not.toBe(first.pairId);
    expect(changed.pricing.data).toEqual(first.pricing.data);
    expect(changed.pricing.pricing_data_version).toBe(first.pricing.pricing_data_version);
    const output = await paths();
    await commitCatalogPair(first, output);
    await commitCatalogPair(changed, output);
    expect(await recoverCatalogPair(output)).toEqual(changed);
  });

  it.each([false, true])(
    "rejects hidden fact corruption (coordinated envelope change: %s)",
    async (rebind) => {
      const candidate = prepareCatalogPair(catalog(300), emptyPricingCatalog());
      const output = await paths();
      await commitCatalogPair(candidate, output);
      const pointerPath = join(output.stateDirectory, "current.json");
      const pointer = await readFile(pointerPath);
      const snapshot = join(output.stateDirectory, "snapshots", candidate.pairId);
      const changed = { ...candidate.catalog, models: catalog(301).models };
      await writeFile(join(snapshot, "catalog.json"), stableJson(changed));
      if (rebind) {
        const envelope = createPricingCatalogEnvelope(candidate.pricing.data, changed);
        await writeFile(join(snapshot, "pricing.json"), pricingCatalogJson(envelope, changed));
      }
      await expect(recoverCatalogPair(output)).rejects.toThrow(
        rebind ? "complete core" : "core data hash",
      );
      expect(await readFile(pointerPath)).toEqual(pointer);
    },
  );

  it("rejects a same-public-pair different full core before snapshot writes", async () => {
    const candidate = prepareCatalogPair(catalog(300), emptyPricingCatalog());
    const changed = prepareCatalogPair(
      { ...candidate.catalog, models: catalog(301).models },
      emptyPricingCatalog(),
    );
    expect(changed.pairId).toBe(candidate.pairId);
    expect(changed.pricing.core_data_sha256).not.toBe(candidate.pricing.core_data_sha256);
    const output = await paths();
    await commitCatalogPair(candidate, output);
    const pointerPath = join(output.stateDirectory, "current.json");
    const pointer = await readFile(pointerPath);
    const snapshot = join(output.stateDirectory, "snapshots", candidate.pairId);
    const before = await snapshotBytes(snapshot);
    await expect(commitCatalogPair(changed, output)).rejects.toThrow("different complete core");
    expect(await readFile(pointerPath)).toEqual(pointer);
    expect(await snapshotBytes(snapshot)).toEqual(before);
    await commitCatalogPair(candidate, output);
    expect(await snapshotBytes(snapshot)).toEqual(before);
  });

  it("rejects a hidden-detail collision with an accepted v1 pair before writing", async () => {
    const first = prepareCatalogPair(catalog(), emptyPricingCatalog());
    const changed = prepareCatalogPair(
      { ...first.catalog, models: catalog(300).models },
      emptyPricingCatalog(),
    );
    expect(changed.pairId).toBe(first.pairId);
    const output = await paths();
    await commitCatalogPair(first, output);
    const pointerPath = join(output.stateDirectory, "current.json");
    const pointer = await readFile(pointerPath);
    const snapshot = join(output.stateDirectory, "snapshots", first.pairId);
    const before = await snapshotBytes(snapshot);
    await expect(commitCatalogPair(changed, output)).rejects.toThrow("different complete core");
    expect(await readFile(pointerPath)).toEqual(pointer);
    expect(await snapshotBytes(snapshot)).toEqual(before);
  });

  it.each([" ", "\n"])("rejects noncanonical v2 storage bytes (%j)", async (suffix) => {
    const candidate = prepareCatalogPair(catalog(300), emptyPricingCatalog());
    const output = await paths();
    await commitCatalogPair(candidate, output);
    const snapshot = join(output.stateDirectory, "snapshots", candidate.pairId);
    await writeFile(
      join(snapshot, "pricing.json"),
      candidate.pricingStorageChunks.join("") + suffix,
    );
    await expect(recoverCatalogPair(output)).rejects.toThrow("canonical pricing asset bytes");
  });

  it("does not accept divergent storage under a legacy v1 manifest", async () => {
    const candidate = prepareCatalogPair(catalog(300), emptyPricingCatalog());
    const output = await paths();
    await commitCatalogPair(candidate, output);
    await writeFile(
      join(output.stateDirectory, "current.json"),
      canonicalJson({ version: 1, pair_id: candidate.pairId, ...candidate.identity }),
    );
    await expect(recoverCatalogPair(output)).rejects.toThrow("Legacy accepted manifest");
  });
});
