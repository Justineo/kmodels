import { describe, expect, it, vi } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import { collectProvider } from "../src/catalog/collector.ts";
import { fetchSource } from "../src/catalog/fetch.ts";
import { sha256 } from "../src/catalog/io.ts";
import { manifests, type ProviderManifest } from "../src/catalog/manifests.ts";
import { baseModel } from "../src/catalog/model.ts";
import type { ProviderPricingPartition } from "../src/catalog/pricing-assembly.ts";
import { composeCatalogPair } from "../src/catalog/pricing-pair-transition.ts";
import { failedPricingTransition } from "../src/catalog/pricing-transition.ts";
import type { Catalog, ProviderModel, SourceRecord } from "../src/catalog/schema.ts";
import type { PricingCatalog } from "../src/catalog/pricing-schema.ts";

vi.mock("../src/catalog/adapters.ts", () => ({ parseSource: vi.fn() }));
vi.mock("../src/catalog/fetch.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/catalog/fetch.ts")>()),
  fetchSource: vi.fn(),
}));

const providerId = "azure";
const catalogSource = "azure-models";
const priceSource = "azure-retail-prices";
const accountingSource = "azure-accounting";
const previousAt = "2026-11-06T00:06:55.265Z";
const currentAt = "2026-11-06T01:03:43.717Z";

function azureManifest(sourceIds: readonly string[]): ProviderManifest {
  const manifest = manifests.find(({ provider }) => provider.id === providerId);
  if (manifest === undefined) throw new Error("Missing Azure manifest");
  const sources = sourceIds.map((id) => {
    const source = manifest.sources.find((candidate) => candidate.id === id);
    if (source === undefined) throw new Error(`Missing Azure source ${id}`);
    return source;
  });
  const last = sources.at(-1);
  if (last === undefined) throw new Error("Empty Azure source selection");
  return { ...manifest, sources: [...sources.slice(0, -1), last] };
}

function respond(retailFailure: boolean): void {
  vi.mocked(fetchSource).mockImplementation(async (source) => {
    if (retailFailure && source.id === priceSource) throw new Error("HTTP 429");
    return {
      body: `${source.id} body`,
      contentHash: sha256(source.id),
      etag: undefined,
      lastModified: undefined,
      dependencies: [],
    };
  });
  vi.mocked(parseSource).mockImplementation(({ source, observedAt }) => ({
    models:
      source.id === catalogSource
        ? [
            baseModel({
              providerId,
              id: "gpt-5",
              name: "GPT-5",
              sourceId: source.id,
              observedAt,
            }),
          ]
        : [],
  }));
}

function record(id: string, at: string): SourceRecord {
  return {
    id,
    provider_id: providerId,
    url: `https://example.com/${id}`,
    source: ["website"],
    stability: "documented",
    scope: "global",
    exhaustive: false,
    role: id === catalogSource ? "catalog" : "supplement",
    field_paths: [],
    observed_at: at,
    content_hash: sha256(id),
    extractor_version: "1",
  };
}

function model(at: string): ProviderModel {
  return {
    provider_id: providerId,
    model_id: "gpt-5",
    uid: `${providerId}/gpt-5`,
    id_kind: "api_id",
    name: "GPT-5",
    aliases: [],
    tasks: [],
    modalities: { input: [], output: [] },
    capabilities: {
      reasoning: "unknown",
      tool_call: "unknown",
      structured_output: "unknown",
      streaming: "unknown",
      batch: "unknown",
      prompt_cache: "unknown",
      fine_tuning: "unknown",
      citations: "unknown",
      code_execution: "unknown",
      context_management: "unknown",
      effort_control: "unknown",
      computer_use: "unknown",
    },
    limits: {},
    status: "active",
    release_stage: "stable",
    replacement_model_ids: [],
    scope: "global_catalog",
    account_availability: "unknown",
    first_seen_at: at,
    last_seen_at: at,
    observed_at: at,
    source_refs: [catalogSource],
  };
}

function acceptedCatalog(at: string, extraSourceId?: string): Catalog {
  const sources = [record(catalogSource, at), record(accountingSource, at)];
  if (extraSourceId !== undefined) sources.push(record(extraSourceId, at));
  return {
    catalog_version: "0".repeat(64),
    generated_at: at,
    providers: [
      {
        id: providerId,
        name: "Microsoft Foundry",
        kind: "hosted",
        homepage: "https://ai.azure.com/catalog/models",
        catalog_scope: "global",
        source_ids: sources.map(({ id }) => id),
        catalog_version: "0".repeat(64),
        last_successful_sync_at: at,
      },
    ],
    models: [model(at)],
    sources,
    coverage: [
      {
        provider_id: providerId,
        status: "fresh",
        model_count: 1,
        pricing_term_count: 0,
        checked_at: at,
        last_successful_sync_at: at,
      },
    ],
    warnings: [],
  };
}

function acceptedPricing(at: string, accountingRef: string): PricingCatalog {
  const partition: ProviderPricingPartition = {
    vocabulary: { provider_id: providerId, atoms: [] },
    snapshot: { provider_id: providerId, observed_at: at, publication: "fresh" },
    model_dispositions: [
      {
        model_ref: `${providerId}/gpt-5`,
        state: "not_applicable",
        observations: [
          {
            source_ref: accountingRef,
            locator: { kind: "table", value: "request accounting" },
            establishes_model_ref: `${providerId}/gpt-5`,
            raw: { label: "Caller-supplied quantity" },
          },
        ],
      },
    ],
    books: [],
  };
  return {
    provider_vocabularies: [partition.vocabulary],
    provider_snapshots: [partition.snapshot],
    model_dispositions: partition.model_dispositions,
    books: [],
  };
}

function core(result: Awaited<ReturnType<typeof collectProvider>>, at: string): Catalog {
  return {
    catalog_version: "1".repeat(64),
    generated_at: at,
    providers: [result.provider],
    models: result.models,
    sources: result.sources,
    coverage: [result.coverage],
    warnings: result.warnings,
  };
}

describe("Azure pricing provenance retention", () => {
  it("keeps a configured pricing-input source that observes no models of its own", async () => {
    respond(true);
    const result = await collectProvider(
      azureManifest([catalogSource, priceSource, accountingSource]),
      undefined,
      { sources: {} },
      currentAt,
    );
    expect(result.attempt.outcome).toBe("accepted");
    expect(result.coverage.status).toBe("fresh");
    expect(result.pricing).toBeUndefined();
    expect(result.pricingFailure).toBe("source_unavailable");
    expect(result.sources.map(({ id }) => id).sort()).toEqual([accountingSource, catalogSource]);
  });

  it("advances the catalog core when retained pricing cites that source", async () => {
    respond(true);
    const manifest = azureManifest([catalogSource, priceSource, accountingSource]);
    const result = await collectProvider(manifest, undefined, { sources: {} }, currentAt);
    const fresh = core(result, currentAt);
    const composed = composeCatalogPair(
      acceptedCatalog(previousAt),
      fresh,
      acceptedPricing(previousAt, accountingSource),
      [failedPricingTransition(providerId, currentAt, "source_unavailable")],
    );
    expect(
      composed.catalog.warnings.some(({ code }) => code === "retained_pricing_core_mismatch"),
    ).toBe(false);
    expect(composed.catalog.models).toEqual(fresh.models);
    expect(composed.catalog.coverage[0]).toMatchObject({
      provider_id: providerId,
      status: "fresh",
      checked_at: currentAt,
    });
    expect(composed.pricing.provider_snapshots[0]).toMatchObject({
      provider_id: providerId,
      publication: "retained",
      observed_at: previousAt,
      refresh_failure: { code: "source_unavailable", attempted_at: currentAt },
    });
  });

  it("still retains the core when retained pricing cites a source that is no longer configured", async () => {
    respond(true);
    const removed = "azure-withdrawn-pricing";
    const manifest = azureManifest([catalogSource, priceSource, accountingSource]);
    const result = await collectProvider(manifest, undefined, { sources: {} }, currentAt);
    const composed = composeCatalogPair(
      acceptedCatalog(previousAt, removed),
      core(result, currentAt),
      acceptedPricing(previousAt, removed),
      [failedPricingTransition(providerId, currentAt, "source_unavailable")],
    );
    expect(composed.catalog.warnings).toContainEqual(
      expect.objectContaining({
        code: "retained_pricing_core_mismatch",
        provider_id: providerId,
        message: `Retained pricing requires the previous catalog source: ${removed}`,
      }),
    );
    expect(composed.catalog.coverage[0]).toMatchObject({
      provider_id: providerId,
      status: "stale",
      reason: `Retained pricing requires the previous catalog source: ${removed}`,
    });
  });
});
