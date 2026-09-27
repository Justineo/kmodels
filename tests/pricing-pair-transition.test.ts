import { describe, expect, it } from "vite-plus/test";
import type { ProviderPricingPartition } from "../src/catalog/pricing-assembly.ts";
import { pricingBookId, pricingOfferId } from "../src/catalog/pricing-identifiers.ts";
import { composeCatalogPair } from "../src/catalog/pricing-pair-transition.ts";
import { pricingCatalogSchema, type PricingCatalog } from "../src/catalog/pricing-schema.ts";
import { validatePricingCatalog } from "../src/catalog/pricing-validation.ts";
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

function partition(label = "Not offered"): ProviderPricingPartition {
  return {
    vocabulary: { provider_id: providerId, atoms: [] },
    snapshot: { provider_id: providerId, observed_at: observedAt, publication: "fresh" },
    model_dispositions: [
      {
        model_ref: modelRef,
        state: "not_applicable",
        observations: [
          {
            source_ref: sourceRef,
            locator: { kind: "table", value: "row" },
            establishes_model_ref: modelRef,
            raw: { label },
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

function bookPartition(): ProviderPricingPartition {
  return {
    ...partition(),
    model_dispositions: [],
    books: [
      {
        id: pricingBookId(providerId, "model"),
        provider_id: providerId,
        book_key: "model",
        scope: { kind: "models", model_refs: [modelRef] },
        source_refs: [sourceRef],
        scope_observations: [
          {
            source_ref: sourceRef,
            locator: { kind: "table", value: "row" },
            establishes: { kind: "models", model_refs: [modelRef] },
            raw: { label: "Model pricing" },
          },
        ],
        offers: [
          {
            id: pricingOfferId(pricingBookId(providerId, "model"), "standard"),
            offer_key: "standard",
            billing_mode: { namespace: "kmodels", value: "usage" },
            states: [
              {
                state: "not_published",
                applicability: { any_of: [{ all_of: [] }] },
                observations: [
                  {
                    source_ref: sourceRef,
                    locator: { kind: "table", value: "state" },
                    raw: { label: "Price not published" },
                    establishes_applicability: { any_of: [{ all_of: [] }] },
                  },
                ],
              },
            ],
            enrollment: [],
            terms: [],
            relations: [],
            settlement: [],
            source_refs: [sourceRef],
          },
        ],
        resource_edges: [],
      },
    ],
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
  it.each(["book", "disposition"])(
    "retains the matching core when retained %s pricing references a removed model",
    (kind) => {
      const prior = catalog("old");
      const fresh = catalog("new");
      fresh.generated_at = "2026-07-29T00:00:00.000Z";
      fresh.models = [
        { ...model("Replacement"), uid: "test/replacement", model_id: "replacement" },
      ];
      fresh.coverage = fresh.coverage.map((coverage) => ({
        ...coverage,
        checked_at: fresh.generated_at,
        last_successful_sync_at: fresh.generated_at,
      }));
      const acceptedPricing = pricing(kind === "book" ? bookPartition() : partition());
      pricingCatalogSchema.parse(acceptedPricing);
      validatePricingCatalog(acceptedPricing, prior);
      const result = composeCatalogPair(prior, fresh, acceptedPricing, []);

      expect(() => validatePricingCatalog(result.pricing, result.catalog)).not.toThrow();
      expect(result.catalog.models).toEqual(prior.models);
      expect(result.catalog.sources).toEqual(prior.sources);
      expect(result.catalog.providers).toEqual(prior.providers);
      expect(result.catalog.coverage[0]).toMatchObject({
        status: "stale",
        checked_at: fresh.generated_at,
        last_successful_sync_at: observedAt,
        model_count: prior.models.length,
        reason: expect.stringContaining(modelRef),
      });
      expect(result.catalog.warnings).toContainEqual({
        code: "retained_pricing_core_mismatch",
        provider_id: providerId,
        message: expect.stringContaining(modelRef),
      });
      expect(result.pricing.books).toEqual(acceptedPricing.books);
      expect(result.pricing.model_dispositions).toEqual(acceptedPricing.model_dispositions);
      expect(result.pricing.provider_snapshots[0]).toMatchObject({
        observed_at: observedAt,
        publication: "retained",
      });
      expect(() => composeCatalogPair(prior, fresh, acceptedPricing, [], safety("core"))).toThrow(
        "Unsafe accepted core",
      );
    },
  );

  it("retains core when pricing-only source provenance disappears", () => {
    const prior = catalog("old");
    const fresh = catalog("new");
    fresh.sources = [];
    const result = composeCatalogPair(prior, fresh, pricing(partition()), []);
    expect(result.catalog.sources).toEqual(prior.sources);
    expect(result.catalog.coverage[0]?.reason).toContain(sourceRef);
    expect(() => validatePricingCatalog(result.pricing, result.catalog)).not.toThrow();
  });

  it("allows removal of models not referenced by retained pricing", () => {
    const prior = catalog("old");
    prior.models.push({ ...model("Unpriced"), uid: "test/unpriced", model_id: "unpriced" });
    const fresh = catalog("new");
    const result = composeCatalogPair(prior, fresh, pricing(partition()), []);
    expect(result.catalog.models).toEqual(fresh.models);
    expect(result.catalog.coverage[0]?.status).toBe("fresh");
    expect(() => validatePricingCatalog(result.pricing, result.catalog)).not.toThrow();
  });

  it("checks resource-edge targets outside the book's own model scope", () => {
    const prior = catalog("old");
    prior.models.push({ ...model("Target"), uid: "test/target", model_id: "target" });
    const value = bookPartition();
    for (const book of value.books)
      book.resource_edges.push({
        kind: "derived_from",
        target: { kind: "models", model_refs: ["test/target"] },
        applicability: { any_of: [{ all_of: [] }] },
        observations: [
          {
            source_ref: sourceRef,
            locator: { kind: "table", value: "edge" },
            raw: { label: "Derived from target" },
          },
        ],
      });
    const acceptedPricing = pricing(value);
    validatePricingCatalog(acceptedPricing, prior);
    const result = composeCatalogPair(prior, catalog("new"), acceptedPricing, []);
    expect(result.catalog.models).toEqual(prior.models);
    expect(result.catalog.coverage[0]?.reason).toContain("test/target");
    expect(() => validatePricingCatalog(result.pricing, result.catalog)).not.toThrow();
  });

  it("keeps another provider's fresh catalog while retaining the incompatible provider", () => {
    const prior = catalog("old");
    const fresh = catalog("new");
    fresh.models = [];
    fresh.providers.push({
      id: "other",
      name: "Other",
      kind: "hosted",
      homepage: "https://example.com",
      catalog_scope: "global",
      source_ids: ["other-source"],
      catalog_version: "1".repeat(64),
    });
    fresh.models.push({
      ...model("Other"),
      provider_id: "other",
      uid: "other/model",
      source_refs: ["other-source"],
    });
    fresh.sources.push(
      ...catalog("new").sources.map((source) => ({
        ...source,
        provider_id: "other",
        id: "other-source",
      })),
    );
    const result = composeCatalogPair(prior, fresh, pricing(partition()), []);
    expect(result.catalog.models.find(({ uid }) => uid === modelRef)).toEqual(prior.models[0]);
    expect(result.catalog.models.find(({ uid }) => uid === "other/model")).toEqual(fresh.models[0]);
    expect(result.catalog.providers.find(({ id }) => id === "other")?.name).toBe("Other");
    expect(() => validatePricingCatalog(result.pricing, result.catalog)).not.toThrow();
  });

  it("retains pricing without holding back independently refreshed core data", () => {
    const result = composeCatalogPair(catalog("old"), catalog("new"), pricing(partition()), []);
    expect(result.catalog.providers[0]?.name).toBe("new");
    expect(result.catalog.models[0]?.name).toBe("new");
    expect(result.catalog.sources[0]?.content_hash).toBe("new".padEnd(64, "0"));
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

  it("retains pricing when the provider catalog refresh was rejected", () => {
    const prior = partition("Prior accepted pricing");
    const stale = catalog("old");
    stale.coverage = stale.coverage.map((coverage) => ({
      ...coverage,
      status: "stale",
      reason: "model count dropped by more than 10%",
    }));
    const result = composeCatalogPair(catalog("old"), stale, pricing(prior), [
      { kind: "fresh", partition: partition("Partial candidate pricing") },
    ]);
    expect(result.pricing.provider_snapshots[0]).toMatchObject({
      observed_at: prior.snapshot.observed_at,
      publication: "retained",
      refresh_failure: {
        attempted_at: observedAt,
        code: "provider_refresh_failed",
      },
    });
    expect(result.pricing.model_dispositions).toEqual(prior.model_dispositions);
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
