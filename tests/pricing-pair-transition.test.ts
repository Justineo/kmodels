import { describe, expect, it } from "vite-plus/test";
import type { ProviderPricingPartition } from "../src/catalog/pricing-assembly.ts";
import { composeCatalogPair } from "../src/catalog/pricing-pair-transition.ts";
import type { PricingCatalog } from "../src/catalog/pricing-schema.ts";
import type { Catalog, ProviderModel } from "../src/catalog/schema.ts";

const providerId = "test";
const modelRef = "test/model";
const sourceRef = "test-pricing";
const observedAt = "2026-07-28T00:00:00.000Z";

function model(name: string): ProviderModel {
  return {
    provider_id: providerId,
    model_id: "model",
    uid: modelRef,
    id_kind: "api_id",
    name,
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
    first_seen_at: observedAt,
    last_seen_at: observedAt,
    observed_at: observedAt,
    source_refs: [sourceRef],
  };
}

function catalog(name: string): Catalog {
  return {
    catalog_version: "0".repeat(64),
    generated_at: observedAt,
    providers: [
      {
        id: providerId,
        name,
        kind: "hosted",
        homepage: "https://example.com",
        catalog_scope: "global",
        source_ids: [sourceRef],
        catalog_version: name.padEnd(64, "0").slice(0, 64),
      },
    ],
    models: [model(name)],
    sources: [
      {
        id: sourceRef,
        provider_id: providerId,
        url: "https://example.com/pricing",
        source: ["website"],
        stability: "documented",
        scope: "global",
        exhaustive: true,
        role: "catalog",
        field_paths: ["pricing"],
        observed_at: observedAt,
        content_hash: name.padEnd(64, "0").slice(0, 64),
        extractor_version: "1",
      },
    ],
    coverage: [
      {
        provider_id: providerId,
        status: "fresh",
        model_count: 1,
        pricing_term_count: 0,
        checked_at: observedAt,
        last_successful_sync_at: observedAt,
      },
    ],
    warnings: [],
  };
}

function partition(publication: "fresh" | "retained" = "fresh"): ProviderPricingPartition {
  return {
    vocabulary: { provider_id: providerId, atoms: [] },
    snapshot:
      publication === "fresh"
        ? { provider_id: providerId, observed_at: observedAt, publication }
        : {
            provider_id: providerId,
            observed_at: observedAt,
            publication,
            refresh_failure: {
              attempted_at: observedAt,
              code: "provider_refresh_failed",
            },
          },
    model_dispositions: [
      {
        model_ref: modelRef,
        state: "not_applicable",
        observations: [
          {
            source_ref: sourceRef,
            locator: { kind: "table", value: "row" },
            establishes_model_ref: modelRef,
            raw: { label: "Not offered" },
          },
        ],
      },
    ],
    books: [],
  };
}

function pricing(value?: ProviderPricingPartition): PricingCatalog {
  return {
    provider_vocabularies: value === undefined ? [] : [value.vocabulary],
    provider_snapshots: value === undefined ? [] : [value.snapshot],
    model_dispositions: value?.model_dispositions ?? [],
    books: value?.books ?? [],
  };
}

const safety = (
  affects: "core" | "pricing" | "both",
  cleared: { core?: true; pricing?: true } = {},
) => ({
  accepted_pair_id: "accepted-pair",
  safety_findings: [
    {
      provider_id: providerId,
      accepted_pair_id: "accepted-pair",
      affects,
      ...(cleared.core === true ? { replacement_core_cleared: true as const } : {}),
      ...(cleared.pricing === true ? { replacement_pricing_cleared: true as const } : {}),
    },
  ],
});

describe("paired core/pricing provider transition", () => {
  it("retains the exact prior core slice when an onboarded pricing provider fails", () => {
    const result = composeCatalogPair(catalog("old"), catalog("new"), pricing(partition()), []);
    expect(result.catalog.providers[0]?.name).toBe("old");
    expect(result.catalog.models[0]?.name).toBe("old");
    expect(result.catalog.sources[0]?.content_hash).toBe("old".padEnd(64, "0"));
    expect(result.pricing.provider_snapshots[0]).toMatchObject({
      publication: "retained",
      refresh_failure: {
        attempted_at: observedAt,
        code: "provider_refresh_failed",
      },
    });
  });

  it("does not hold back core data before a provider has a pricing partition", () => {
    const result = composeCatalogPair(catalog("old"), catalog("new"), pricing(), []);
    expect(result.catalog.providers[0]?.name).toBe("new");
    expect(result.pricing).toEqual(pricing());
  });

  it("advances or removes both sides only through explicit transitions", () => {
    const advanced = composeCatalogPair(catalog("old"), catalog("new"), pricing(partition()), [
      { kind: "fresh", partition: partition() },
    ]);
    expect(advanced.catalog.providers[0]?.name).toBe("new");
    expect(advanced.pricing.provider_snapshots[0]?.publication).toBe("fresh");

    const empty = composeCatalogPair(catalog("old"), catalog("new"), pricing(partition()), [
      { kind: "fresh_empty", provider_id: providerId },
    ]);
    expect(empty.catalog.providers[0]?.name).toBe("new");
    expect(empty.pricing).toEqual(pricing());
  });

  it("blocks unsafe retention and permits an explicit pricing withdrawal", () => {
    expect(() =>
      composeCatalogPair(catalog("old"), catalog("new"), pricing(partition()), [
        { kind: "withdraw_pricing", provider_id: providerId },
      ]),
    ).toThrow("withdrawal has no accepted-state safety finding");

    expect(() =>
      composeCatalogPair(
        catalog("old"),
        catalog("new"),
        pricing(partition()),
        [],
        safety("pricing"),
      ),
    ).toThrow("Unsafe accepted pricing");

    const withdrawn = composeCatalogPair(
      catalog("old"),
      catalog("new"),
      pricing(partition()),
      [{ kind: "withdraw_pricing", provider_id: providerId }],
      safety("pricing"),
    );
    expect(withdrawn.catalog.providers[0]?.name).toBe("old");
    expect(withdrawn.pricing).toEqual(pricing());
  });

  it("requires a cleared replacement for an implicated core side", () => {
    expect(() =>
      composeCatalogPair(
        catalog("old"),
        catalog("old"),
        pricing(partition()),
        [{ kind: "withdraw_pricing", provider_id: providerId }],
        safety("both", { core: true }),
      ),
    ).toThrow("Unsafe accepted core");

    const remediated = composeCatalogPair(
      catalog("old"),
      catalog("new"),
      pricing(partition()),
      [{ kind: "withdraw_pricing", provider_id: providerId }],
      safety("both", { core: true }),
    );
    expect(remediated.catalog.providers[0]?.name).toBe("new");
    expect(remediated.pricing).toEqual(pricing());
  });
});
