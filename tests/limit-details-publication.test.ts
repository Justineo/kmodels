import { publicCatalog } from "./catalog-export-fixture.ts";
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
import * as projections from "../src/catalog/projections.ts";
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
import { foundAuditFields } from "./website-audit-fields.ts";
import { websiteDetailChunkSchema } from "../src/catalog/website-schema.ts";

const observedAt = "2026-07-28T00:00:00.000Z";
const directories: string[] = [];
const utf8 = new TextEncoder();

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

function catalog(tokens?: number, capability?: boolean | "withdrawn"): Catalog {
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
    ...(capability === undefined
      ? {}
      : {
          capability_details: [
            {
              source_ref: "test-source",
              claim: "responses_cache",
              statements:
                capability === "withdrawn"
                  ? []
                  : [
                      {
                        kind: "prompt_cache",
                        // The flag only varies the stored claim between documented modes.
                        mode: capability ? "implicit" : "explicit",
                        scope: "Example Responses API",
                      },
                    ],
              evidence: [
                {
                  document_url: "https://example.com/models",
                  locator: "Responses caching",
                  observed_at: observedAt,
                  content_hash: "b".repeat(64),
                  excerpt: "Responses caching declaration.",
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
            field_paths: ["model_id", "limit_details", "capability_details"],
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
  it.each(["foreign", "missing", "undeclared", "inventory"])(
    "rejects %s detail ownership at both full-pair preparation boundaries",
    async (failure) => {
      const full = catalog(300);
      if (failure === "foreign") {
        const provider = full.providers[0];
        if (provider === undefined) throw new Error("Missing fixture provider");
        full.providers.push({ ...provider, id: "other", source_ids: ["test-source"] });
        full.sources = full.sources.map((source) => ({ ...source, provider_id: "other" }));
      } else if (failure === "missing") full.sources = [];
      else if (failure === "undeclared")
        full.sources = full.sources.map((source) => ({ ...source, field_paths: ["model_id"] }));
      else full.sources = full.sources.map((source) => ({ ...source, role: "inventory" }));

      expect(() => prepareCatalogPair(full, emptyPricingCatalog())).toThrow(
        "Unowned limit detail source",
      );
      await expect(prepareCatalogPairInParallel(full, emptyPricingCatalog())).rejects.toThrow(
        "Unowned limit detail source",
      );
    },
  );

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

describe("scoped capability publication compatibility", () => {
  it.each(["foreign", "missing", "undeclared", "inventory"])(
    "rejects %s capability ownership at both full-pair preparation boundaries",
    async (failure) => {
      const full = catalog(undefined, true);
      if (failure === "foreign")
        full.sources = full.sources.map((source) => ({ ...source, provider_id: "other" }));
      else if (failure === "missing") full.sources = [];
      else if (failure === "undeclared")
        full.sources = full.sources.map((source) => ({
          ...source,
          field_paths: ["limit_details"],
        }));
      else full.sources = full.sources.map((source) => ({ ...source, role: "inventory" }));

      expect(() => prepareCatalogPair(full, emptyPricingCatalog())).toThrow(
        /Unowned .* detail source/,
      );
      await expect(prepareCatalogPairInParallel(full, emptyPricingCatalog())).rejects.toThrow(
        /Unowned .* detail source/,
      );
    },
  );

  it("omits both detail fields from legacy schemas and binds pricing to the published core", () => {
    const full = catalog(300, true);
    const expected = {
      ...full,
      models: full.models.map(
        ({ limit_details: _limits, capability_details: _capabilities, ...model }) => model,
      ),
    };
    expect(catalogExportAssets(full)).toEqual(catalogExportAssets(expected));
    const { data, ...metadata } = catalogEnvelopeSchema.parse({
      catalog_version: full.catalog_version,
      generated_at: full.generated_at,
      data: full,
      warnings: full.warnings,
    });
    expect({ ...metadata, ...data }).toEqual(expected);
    const variant = catalogModels(full).providers.test?.models[0]?.variants[0];
    expect(variant).toBeDefined();
    expect(
      publishedModelVariantSchema.safeParse({
        ...variant,
        capability_details: full.models[0]?.capability_details,
      }).success,
    ).toBe(false);

    const candidate = prepareCatalogPair(full, emptyPricingCatalog());
    expect(publicCatalog(candidate.catalogAssetSource)).toEqual(expected);
    const publicPrices = decodePricingCatalog(utf8.encode(candidate.pricingAssetSource), expected);
    expect(publicPrices).toEqual(createPricingCatalogEnvelope(candidate.pricing.data, expected));
    expect(publicPrices.pricing_data_version).toBe(candidate.pricing.pricing_data_version);
    expect(() => validatePricingCatalogEnvelope(publicPrices, full)).toThrow("core data hash");
    expect(candidate.catalog.models).toEqual(full.models);
  });

  it.each([
    { tokens: undefined, capability: undefined, wire: 7, manifest: 1 },
    { tokens: 300, capability: undefined, wire: 11, manifest: 2 },
    { tokens: undefined, capability: "withdrawn", wire: 7, manifest: 2 },
    { tokens: 300, capability: "withdrawn", wire: 11, manifest: 2 },
    { tokens: undefined, capability: true, wire: 11, manifest: 2 },
    { tokens: 300, capability: false, wire: 11, manifest: 2 },
  ] as const)(
    "recovers v$wire assets with capability receipt $capability and private manifest v$manifest",
    async ({ tokens, capability, wire, manifest }) => {
      const full = catalog(tokens, capability);
      const candidate = prepareCatalogPair(full, emptyPricingCatalog());
      const output = await paths();
      await commitCatalogPair(candidate, output);

      expect(
        JSON.parse(await readFile(join(output.stateDirectory, "current.json"), "utf8")),
      ).toMatchObject({
        version: manifest,
        ...(manifest === 2 ? { core_data_sha256: candidate.pricing.core_data_sha256 } : {}),
      });
      const published = await readPublishedAssets(output.projections);
      const source = readCompressedProfileAsset(published.ui, "/ui/details/test/0.json");
      if (source === undefined) throw new Error("Missing model detail asset");
      const { schema_version, data_version, details } = websiteDetailChunkSchema.parse(
        JSON.parse(gunzipSync(source).toString("utf8")),
      );
      expect(schema_version).toBe(wire);
      const scopedCapability = capability === true || capability === false;
      const salt =
        (tokens === undefined ? "" : "\0model-limit-details-v8") +
        (scopedCapability ? "\0model-capability-details-v9" : "") +
        (wire === 11 ? "\0model-claim-sources-v11" : "");
      expect(data_version).toBe(
        sha256(
          `website-core-v7\0${full.catalog_version}\0${candidate.pricing.pricing_data_version}${salt}`,
        ),
      );
      expect(foundAuditFields(details, "model-details")).toEqual([]);
      const citedDetails = (field: "limit_details" | "capability_details") =>
        full.models[0]?.[field]?.map(({ evidence, ...group }) => ({
          ...group,
          evidence: evidence.map(({ document_url, locator, observed_at }) => ({
            document_url,
            locator,
            observed_at,
          })),
        }));
      if (scopedCapability) {
        expect(details[0]).toHaveProperty("capability_details", citedDetails("capability_details"));
      } else {
        expect(details[0]).not.toHaveProperty("capability_details");
      }
      if (tokens !== undefined)
        expect(details[0]).toHaveProperty("limit_details", citedDetails("limit_details"));

      const rebuild = vi.spyOn(projections, "projectCatalogPair");
      expect(await recoverCatalogPair(output)).toEqual(candidate);
      expect(rebuild).not.toHaveBeenCalled();
      await rm(output.stateDirectory, { recursive: true });
      expect(await recoverCatalogPair(output)).toEqual(candidate);
      expect(rebuild).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, true] as const)(
    "guards the accepted core before writes and after tampering (original capability: %s)",
    async (capability) => {
      const accepted = prepareCatalogPair(catalog(undefined, capability), emptyPricingCatalog());
      const changed = prepareCatalogPair(
        { ...accepted.catalog, models: catalog(undefined, false).models },
        accepted.pricing.data,
      );
      expect(changed.pairId).toBe(accepted.pairId);
      expect(changed.pricing.core_data_sha256).not.toBe(accepted.pricing.core_data_sha256);
      const output = await paths();
      await commitCatalogPair(accepted, output);
      const pointerPath = join(output.stateDirectory, "current.json");
      const pointer = await readFile(pointerPath);
      const snapshot = join(output.stateDirectory, "snapshots", accepted.pairId);
      const before = await snapshotBytes(snapshot);

      await expect(commitCatalogPair(changed, output)).rejects.toThrow("different complete core");
      expect(await readFile(pointerPath)).toEqual(pointer);
      expect(await snapshotBytes(snapshot)).toEqual(before);

      const wrongOwner = {
        ...changed.catalog,
        sources: changed.catalog.sources.map((source) => ({
          ...source,
          field_paths: ["limit_details"],
        })),
      };
      await writeFile(join(snapshot, "catalog.json"), stableJson(wrongOwner));
      await expect(recoverCatalogPair(output)).rejects.toThrow(/Unowned .* detail source/);

      await writeFile(join(snapshot, "catalog.json"), changed.catalogStorageSource);
      await writeFile(join(snapshot, "pricing.json"), changed.pricingStorageChunks.join(""));
      await expect(recoverCatalogPair(output)).rejects.toThrow(
        capability === undefined ? "Legacy accepted manifest" : "complete core",
      );
      expect(await readFile(pointerPath)).toEqual(pointer);
    },
  );
});
