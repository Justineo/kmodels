import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { ProviderManifest, SourceManifest } from "../src/catalog/manifests.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";
import {
  capturePricingReplaySources,
  compilePricingSnapshot,
  createPricingCompilationSnapshot,
  readPricingCompilationSnapshot,
  writePricingCompilationSnapshot,
  type PricingReplaySource,
} from "../src/catalog/pricing-compilation.ts";
import { prepareCatalogPair } from "../src/catalog/pricing-publication.ts";
import type { PricingCatalog } from "../src/catalog/pricing-schema.ts";
import type { ParsedPricingModel, ParsedProviderModel } from "../src/catalog/pricing-source.ts";
import {
  catalogSchema,
  unknownCapabilities,
  type Catalog,
  type ProviderModel,
  type SourceRecord,
} from "../src/catalog/schema.ts";

const providerId = "test-provider";
const sourceId = "test-provider-pricing";
const modelRef = "test-provider/test-model";
const observedAt = "2026-07-30T00:00:00.000Z";
const contentHash = "1".repeat(64);
const directories: string[] = [];

const sourceManifest: SourceManifest = {
  id: sourceId,
  url: "https://example.com/pricing",
  type: "website",
  access: "public",
  format: "html",
  stability: "documented",
  extractor: { kind: "openai-catalog" },
  extractorVersion: "test-pricing-v1",
  pricingEvidence: {
    authority: "first_party",
    kind: "model_catalog",
    binding: "exact_id",
    currentness: "current_snapshot",
  },
  fields: ["model_id", "pricing"],
  allowedHosts: ["example.com"],
  maxResponseBytes: 1_024,
  scope: "global",
  exhaustive: true,
  role: "catalog",
};

const providerManifest: ProviderManifest = {
  provider: {
    id: providerId,
    name: "Test Provider",
    kind: "hosted",
    homepage: "https://example.com/",
    catalog_scope: "global",
  },
  sources: [sourceManifest],
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

function published(): ProviderModel {
  return {
    provider_id: providerId,
    model_id: "test-model",
    uid: modelRef,
    id_kind: "api_id",
    name: "Test model",
    aliases: [],
    tasks: ["text_generation"],
    modalities: { input: ["text"], output: ["text"] },
    capabilities: unknownCapabilities(),
    limits: {},
    status: "active",
    release_stage: "stable",
    replacement_model_ids: [],
    scope: "global_catalog",
    account_availability: "unknown",
    first_seen_at: observedAt,
    last_seen_at: observedAt,
    observed_at: observedAt,
    source_refs: [sourceId],
  };
}

function parsed(price: string): ParsedPricingModel {
  return {
    provider_id: providerId,
    model_id: "test-model",
    uid: modelRef,
    tasks: ["text_generation"],
    capabilities: unknownCapabilities(),
    status: "active",
    pricing_state: "numeric",
    price_facts: [
      {
        meter: "input_text",
        price,
        currency: "USD",
        unit: "million_tokens",
        conditions: {},
        source_ref: sourceId,
        derived: false,
      },
    ],
    raw_price_facts: [],
  };
}

function sourceRecord(): SourceRecord {
  return {
    id: sourceId,
    provider_id: providerId,
    url: sourceManifest.url,
    source: ["website"],
    stability: "documented",
    scope: "global",
    exhaustive: true,
    role: "catalog",
    field_paths: sourceManifest.fields,
    pricing_evidence: sourceManifest.pricingEvidence,
    observed_at: observedAt,
    content_hash: contentHash,
    extractor_version: sourceManifest.extractorVersion,
  };
}

function candidate(price: string) {
  const model = published();
  const partition = assembleParsedProviderPricing(
    providerId,
    observedAt,
    [{ source: sourceManifest, models: [parsed(price)] }],
    [model],
  );
  if (partition === undefined) throw new Error("Test pricing partition was not assembled");
  const pricing: PricingCatalog = {
    provider_vocabularies: [partition.vocabulary],
    provider_snapshots: [partition.snapshot],
    model_dispositions: partition.model_dispositions,
    books: partition.books,
  };
  const catalog: Catalog = catalogSchema.parse({
    catalog_version: "2".repeat(64),
    generated_at: observedAt,
    providers: [
      {
        ...providerManifest.provider,
        source_ids: [sourceId],
        last_successful_sync_at: observedAt,
        catalog_version: "3".repeat(64),
      },
    ],
    models: [model],
    sources: [sourceRecord()],
    coverage: [
      {
        provider_id: providerId,
        status: "fresh",
        model_count: 1,
        pricing_term_count: 1,
        checked_at: observedAt,
        last_successful_sync_at: observedAt,
      },
    ],
    warnings: [],
  });
  return prepareCatalogPair(catalog, pricing);
}

function replaySource(price: string): PricingReplaySource {
  return {
    source_id: sourceId,
    extractor_version: sourceManifest.extractorVersion,
    content_hash: contentHash,
    models: [parsed(price)],
  };
}

describe("local canonical pricing compilation", () => {
  it("reassembles pricing from bounded parsed inputs without fetching", async () => {
    const current = candidate("1");
    const snapshot = createPricingCompilationSnapshot(current, [
      {
        provider_id: providerId,
        sources: [replaySource("2")],
      },
    ]);

    const compiled = await compilePricingSnapshot(current, snapshot, [providerManifest]);

    expect(compiled.replayedProviders).toEqual([providerId]);
    expect(compiled.preservedProviders).toEqual([]);
    expect(compiled.candidate.pricing.pricing_data_version).not.toBe(
      current.pricing.pricing_data_version,
    );
    const term = compiled.candidate.pricing.data.books[0]?.offers[0]?.terms[0];
    expect(term?.kind === "rate" ? term.variants[0]?.price.value : undefined).toEqual({
      numerator: "1",
      denominator: "500000",
    });
  });

  it("preserves a provider partition without replay input", async () => {
    const current = candidate("1");
    const snapshot = createPricingCompilationSnapshot(current, []);

    const compiled = await compilePricingSnapshot(current, snapshot, [providerManifest]);

    expect(compiled.replayedProviders).toEqual([]);
    expect(compiled.preservedProviders).toEqual([providerId]);
    expect(compiled.candidate.pricing).toEqual(current.pricing);
  });

  it("preserves accepted pricing when replay input uses an obsolete extractor", async () => {
    const current = candidate("1");
    const snapshot = createPricingCompilationSnapshot(current, [
      {
        provider_id: providerId,
        sources: [{ ...replaySource("1"), extractor_version: "test-pricing-v0" }],
      },
    ]);

    const compiled = await compilePricingSnapshot(current, snapshot, [providerManifest]);
    expect(compiled.replayedProviders).toEqual([]);
    expect(compiled.preservedProviders).toEqual([providerId]);
    expect(compiled.candidate.pricing).toEqual(current.pricing);
  });

  it("rejects replay input bound to another catalog core", async () => {
    const current = candidate("1");
    const snapshot = {
      ...createPricingCompilationSnapshot(current, []),
      core_data_sha256: "0".repeat(64),
    };

    await expect(compilePricingSnapshot(current, snapshot, [providerManifest])).rejects.toThrow(
      "does not match the accepted catalog core",
    );
  });

  it("requires every configured pricing source", async () => {
    const current = candidate("1");
    const snapshot = createPricingCompilationSnapshot(current, [
      { provider_id: providerId, sources: [replaySource("1")] },
    ]);
    const requiredSource = { ...sourceManifest, id: `${sourceId}-required` };

    await expect(
      compilePricingSnapshot(current, snapshot, [
        { ...providerManifest, sources: [sourceManifest, requiredSource] },
      ]),
    ).rejects.toThrow(`missing required source ${requiredSource.id}`);
  });

  it("replays retained inputs even when a failed refresh observed new source bytes", async () => {
    const accepted = candidate("1");
    const attemptedAt = "2026-07-30T01:00:00.000Z";
    const current = prepareCatalogPair(
      catalogSchema.parse({
        ...accepted.catalog,
        generated_at: attemptedAt,
        sources: accepted.catalog.sources.map((source) => ({
          ...source,
          observed_at: attemptedAt,
          content_hash: "4".repeat(64),
        })),
        coverage: accepted.catalog.coverage.map((coverage) => ({
          ...coverage,
          checked_at: attemptedAt,
        })),
      }),
      {
        ...accepted.pricing.data,
        provider_snapshots: [
          {
            provider_id: providerId,
            observed_at: observedAt,
            publication: "retained",
            refresh_failure: {
              attempted_at: attemptedAt,
              code: "pricing_validation_failed",
            },
          },
        ],
      },
    );
    const snapshot = createPricingCompilationSnapshot(current, [
      {
        provider_id: providerId,
        sources: [replaySource("1")],
      },
    ]);

    await expect(
      compilePricingSnapshot(current, snapshot, [providerManifest]),
    ).resolves.toBeDefined();
  });

  it("round-trips a catalog-bound canonical gzip snapshot", async () => {
    const current = candidate("1");
    const snapshot = createPricingCompilationSnapshot(current, []);
    const directory = await mkdtemp(join(tmpdir(), "kmodels-pricing-inputs-"));
    directories.push(directory);
    const path = join(directory, "pricing-inputs.json.gz");

    await writePricingCompilationSnapshot(snapshot, path);

    expect((await readFile(path)).subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]));
    expect(await readPricingCompilationSnapshot(current, path)).toEqual(snapshot);
  });

  it("captures only minimal public parsed pricing inputs", () => {
    const model: ParsedProviderModel = {
      ...published(),
      pricing_state: "numeric",
      price_facts: parsed("1").price_facts.map((fact) => ({
        ...fact,
        raw_price: undefined,
      })),
      raw_price_facts: [],
    };
    const captured = capturePricingReplaySources(
      [{ source: sourceManifest, models: [model] }],
      [sourceRecord()],
    );

    expect(captured).toEqual([replaySource("1")]);
    expect(captured?.[0]?.models[0]).not.toHaveProperty("name");
    expect(captured?.[0]?.models[0]?.price_facts[0]).not.toHaveProperty("raw_price");
    expect(
      capturePricingReplaySources(
        [
          {
            source: {
              ...sourceManifest,
              access: "authenticated",
              auth: { scheme: "bearer", env: "TEST_TOKEN" },
            },
            models: [model],
          },
        ],
        [sourceRecord()],
      ),
    ).toBeUndefined();
  });

  it("coalesces pricing split across duplicate source identities", () => {
    const model: ParsedProviderModel = {
      ...published(),
      pricing_state: "numeric",
      price_facts: parsed("1").price_facts,
      raw_price_facts: [],
    };
    const alternateFact = parsed("2").price_facts[0];
    if (alternateFact === undefined) throw new Error("Missing alternate pricing fact");
    const alternate: ParsedProviderModel = {
      ...model,
      price_facts: [
        {
          ...alternateFact,
          conditions: { operation: "transcription" },
        },
      ],
    };

    const captured = capturePricingReplaySources(
      [{ source: sourceManifest, models: [model, alternate] }],
      [sourceRecord()],
    );

    expect(captured?.[0]?.models).toHaveLength(1);
    expect(captured?.[0]?.models[0]?.price_facts).toHaveLength(2);
  });

  it("rejects conflicting states for a duplicate source identity", () => {
    const model: ParsedProviderModel = {
      ...published(),
      pricing_state: "numeric",
      price_facts: parsed("1").price_facts,
      raw_price_facts: [],
    };

    expect(() =>
      capturePricingReplaySources(
        [
          {
            source: sourceManifest,
            models: [model, { ...model, pricing_state: "not_published", price_facts: [] }],
          },
        ],
        [sourceRecord()],
      ),
    ).toThrow(`Pricing compilation model ${modelRef} has conflicting states`);
  });
});
