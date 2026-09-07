import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { ProviderManifest, SourceManifest } from "../src/catalog/manifests.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";
import { validateAdoptedTopology } from "../src/catalog/pricing-adopted-topology.ts";
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

function xaiReplayCase(publication: "fresh" | "retained", includeAcceptedResource = true) {
  const id = "xai";
  const source: SourceManifest = { ...sourceManifest, id: "xai-pricing" };
  const manifest: ProviderManifest = {
    provider: { ...providerManifest.provider, id },
    sources: [source],
  };
  const model: ProviderModel = {
    ...published(),
    provider_id: id,
    uid: "xai/test-model",
    source_refs: [source.id],
  };
  const replayModel: ParsedPricingModel = {
    ...parsed("1"),
    provider_id: id,
    uid: model.uid,
    price_facts: parsed("1").price_facts.map((fact) => ({ ...fact, source_ref: source.id })),
  };
  const completeModel: ParsedPricingModel = {
    ...replayModel,
    commercial_facts: [
      {
        source_ref: source.id,
        book_key: "service:web-search",
        book_name: "Web search",
        resource_kind: "service",
        resource_key: "web-search",
        model_refs: [model.uid],
        offer_key: "execution",
        offer_name: "Web search execution",
        billing_mode: "usage",
        pricing_state: "numeric",
        price_facts: [
          {
            meter: "web_search",
            price: "5",
            currency: "USD",
            unit: "thousand_events",
            conditions: {},
            source_ref: source.id,
            derived: false,
          },
        ],
        raw_price_facts: [],
      },
    ],
  };
  const partition = assembleParsedProviderPricing(
    id,
    observedAt,
    [{ source, models: [includeAcceptedResource ? completeModel : replayModel] }],
    [model],
  );
  if (partition === undefined) throw new Error("Missing xAI test pricing");
  if (includeAcceptedResource) validateAdoptedTopology(partition);
  const original = candidate("1").catalog;
  const attemptedAt = "2026-07-30T01:00:00.000Z";
  const current = prepareCatalogPair(
    {
      ...original,
      generated_at: publication === "retained" ? attemptedAt : observedAt,
      providers: original.providers.map((provider) => ({
        ...provider,
        id,
        source_ids: [source.id],
      })),
      models: [model],
      sources: [{ ...sourceRecord(), id: source.id, provider_id: id }],
      coverage: original.coverage.map((coverage) => ({ ...coverage, provider_id: id })),
    },
    {
      provider_vocabularies: [partition.vocabulary],
      provider_snapshots: [
        publication === "fresh"
          ? partition.snapshot
          : {
              ...partition.snapshot,
              publication,
              refresh_failure: {
                attempted_at: attemptedAt,
                code: "pricing_validation_failed",
              },
            },
      ],
      model_dispositions: partition.model_dispositions,
      books: partition.books,
    },
  );
  const snapshot = createPricingCompilationSnapshot(current, [
    {
      provider_id: id,
      sources: [
        {
          source_id: source.id,
          extractor_version: source.extractorVersion,
          content_hash: contentHash,
          models: [replayModel],
        },
      ],
    },
  ]);
  return { current, snapshot, manifest };
}

describe("local canonical pricing compilation", () => {
  it("rejects fresh replay that removes an adopted provider resource", async () => {
    const { current, snapshot, manifest } = xaiReplayCase("fresh");

    await expect(compilePricingSnapshot(current, snapshot, [manifest])).rejects.toThrow(
      "xai commercial topology changed",
    );
  });

  it("keeps an already retained accepted partition when replay loses its adopted resource", async () => {
    const { current, snapshot, manifest } = xaiReplayCase("retained");

    const compiled = await compilePricingSnapshot(current, snapshot, [manifest]);

    expect(compiled.replayedProviders).toEqual([]);
    expect(compiled.preservedProviders).toEqual(["xai"]);
    expect(compiled.replayFailures).toEqual([
      {
        provider_id: "xai",
        reason: "xai commercial topology changed: expected resource, binding, received binding",
      },
    ]);
    expect(compiled.candidate).toBe(current);
    expect(compiled.candidate.pricing.data.provider_snapshots).toEqual(
      current.pricing.data.provider_snapshots,
    );
  });

  it("does not retain an accepted partition that also fails its adopted topology", async () => {
    const { current, snapshot, manifest } = xaiReplayCase("retained", false);

    await expect(compilePricingSnapshot(current, snapshot, [manifest])).rejects.toThrow(
      "xai commercial topology changed",
    );
  });

  it("does not treat retained replay provenance failures as recoverable topology drift", async () => {
    const { current, snapshot, manifest } = xaiReplayCase("retained");
    const invalid = {
      ...current,
      catalog: {
        ...current.catalog,
        sources: current.catalog.sources.map((source) => ({ ...source, provider_id: "other" })),
      },
    };

    await expect(compilePricingSnapshot(invalid, snapshot, [manifest])).rejects.toThrow(
      "does not match the catalog",
    );
  });

  it("does not hide invalid observations behind a retained topology failure", async () => {
    const { current, snapshot, manifest } = xaiReplayCase("retained");
    const rate = snapshot.providers[0]?.sources[0]?.models[0]?.price_facts[0];
    if (rate === undefined) throw new Error("Missing replay test rate");
    rate.raw_price = "x".repeat(8_193);

    await expect(compilePricingSnapshot(current, snapshot, [manifest])).rejects.toThrow(
      "byte limit",
    );
  });

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

  it("requires accounting-only sources declared necessary for replay", async () => {
    const current = candidate("1");
    const snapshot = createPricingCompilationSnapshot(current, [
      { provider_id: providerId, sources: [replaySource("1")] },
    ]);
    const { pricingEvidence: _pricingEvidence, ...sourceBase } = sourceManifest;
    const requiredAccounting: SourceManifest = {
      ...sourceBase,
      id: `${sourceId}-accounting`,
      fields: ["pricing_inputs"],
    };

    await expect(
      compilePricingSnapshot(current, snapshot, [
        { ...providerManifest, sources: [sourceManifest, requiredAccounting] },
      ]),
    ).rejects.toThrow(`missing required source ${requiredAccounting.id}`);
  });

  it("does not revive retired catalog models from pricing-source placeholder metadata", async () => {
    const accepted = candidate("1");
    const current = prepareCatalogPair(
      {
        ...accepted.catalog,
        models: accepted.catalog.models.map((model) => ({ ...model, status: "retired" })),
      },
      accepted.pricing.data,
    );
    const snapshot = createPricingCompilationSnapshot(current, [
      { provider_id: providerId, sources: [replaySource("1")] },
    ]);
    const baseModelSource: SourceManifest = {
      ...sourceManifest,
      pricingEvidence: {
        authority: "first_party",
        kind: "price_book",
        binding: "base_model_id",
        currentness: "current_snapshot",
      },
    };

    await expect(
      compilePricingSnapshot(current, snapshot, [
        { ...providerManifest, sources: [baseModelSource] },
      ]),
    ).rejects.toThrow(`Pricing replay for ${providerId} produced nothing`);
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

  it("captures public accounting-only dependencies without rate authority", () => {
    const { pricingEvidence: _pricingEvidence, ...sourceBase } = sourceManifest;
    const accounting: SourceManifest = {
      ...sourceBase,
      id: `${sourceId}-accounting`,
      fields: ["pricing_inputs"],
    };
    const { pricing_evidence: _recordEvidence, ...recordBase } = sourceRecord();
    const record: SourceRecord = {
      ...recordBase,
      id: accounting.id,
      field_paths: accounting.fields,
    };
    const model: ParsedProviderModel = {
      ...published(),
      pricing_state: "unknown",
      price_facts: [],
      raw_price_facts: [],
      pricing_inputs: [
        {
          key: "response.input_tokens",
          channel: "response",
          locator: { kind: "json_pointer", value: "/usage/input_tokens" },
          availability: "terminal_only",
          source_ref: accounting.id,
        },
      ],
    };

    const captured = capturePricingReplaySources(
      [{ source: accounting, models: [model] }],
      [record],
    );

    expect(captured?.[0]).toMatchObject({
      source_id: accounting.id,
      models: [
        {
          pricing_inputs: [expect.objectContaining({ source_ref: accounting.id })],
        },
      ],
    });
  });

  it("rejects mismatched accounting provenance during capture", () => {
    const model: ParsedPricingModel = {
      ...parsed("1"),
      pricing_inputs: [
        {
          key: "response.input_tokens",
          channel: "response",
          locator: { kind: "json_pointer", value: "/usage/input_tokens" },
          availability: "terminal_only",
          source_ref: "another-source",
        },
      ],
    };

    expect(() =>
      capturePricingReplaySources([{ source: sourceManifest, models: [model] }], [sourceRecord()]),
    ).toThrow(`Pricing compilation source ${sourceId} has mismatched provenance`);
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
