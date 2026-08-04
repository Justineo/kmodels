import { describe, expect, it } from "vite-plus/test";
import { manifests, type ProviderManifest } from "../src/catalog/manifests.ts";
import {
  assembleParsedProviderPricing,
  isRequiredPricingSource,
} from "../src/catalog/pricing-adapter.ts";
import {
  pricingBookId,
  pricingOfferId,
  pricingTermId,
} from "../src/catalog/pricing-identifiers.ts";
import { sourcePricingReconciliation } from "../src/catalog/pricing-reconciliation.ts";
import type { PricingCatalog } from "../src/catalog/pricing-schema.ts";
import {
  sourcePriceFactSchema,
  type ParsedProviderModel,
  type SourcePriceFact,
} from "../src/catalog/pricing-source.ts";
import { validatePricingCatalog } from "../src/catalog/pricing-validation.ts";
import { unknownCapabilities, type Catalog, type SourceRecord } from "../src/catalog/schema.ts";

const providerId = "gemini";
const sourceRef = "gemini-models";
const modelRef = "gemini/test-model";
const observedAt = "2026-07-28T00:00:00.000Z";

function pricingManifest() {
  const provider = manifests.find((manifest) => manifest.provider.id === providerId);
  const source = provider?.sources.find(({ id }) => id === sourceRef);
  if (provider === undefined || source === undefined)
    throw new Error("Gemini pricing manifest is missing");
  return { provider, source };
}

function model(): ParsedProviderModel {
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
    pricing_state: "numeric",
    price_facts: [
      {
        meter: "input_text",
        price: "2",
        currency: "USD",
        unit: "million_tokens",
        conditions: { region: "us-central1", endpoint: undefined },
        source_ref: sourceRef,
        derived: false,
        raw_price: "2",
        raw_unit: "1M tokens",
      },
      {
        meter: "cache_storage",
        price: "3.6",
        currency: "USD",
        unit: "million_tokens_per_hour",
        conditions: {},
        source_ref: sourceRef,
        derived: false,
        raw_price: "3.6",
        raw_unit: "1M tokens per hour",
      },
      {
        meter: "output_text",
        price: "4",
        currency: "USD",
        unit: "million_tokens",
        conditions: {},
        source_ref: sourceRef,
        derived: true,
        derivation: "2 × input",
        raw_price: "4",
        raw_unit: "1M tokens",
      },
      {
        meter: "rerank_request",
        price: "7",
        currency: "USD",
        unit: "search_unit",
        conditions: {},
        source_ref: sourceRef,
        derived: false,
        raw_price: "7",
        raw_unit: "search unit",
      },
      {
        meter: "input_audio",
        price: "9".repeat(129),
        currency: "USD",
        unit: "minute",
        conditions: {},
        source_ref: sourceRef,
        derived: false,
        raw_price: "9".repeat(129),
        raw_unit: "minute",
      },
      {
        meter: "output_audio",
        price: "1",
        currency: "USD",
        unit: "minute",
        conditions: { effective_from: "2026-02-30" },
        source_ref: sourceRef,
        derived: false,
      },
    ],
    raw_price_facts: [],
    scope: "global_catalog",
    account_availability: "unknown",
    first_seen_at: observedAt,
    last_seen_at: observedAt,
    observed_at: observedAt,
    source_refs: [sourceRef],
  };
}

function tokenRate(price: string, conditions: SourcePriceFact["conditions"]): SourcePriceFact {
  return {
    meter: "input_text",
    price,
    currency: "USD",
    unit: "million_tokens",
    conditions,
    source_ref: sourceRef,
    derived: false,
    raw_price: price,
    raw_unit: "1M tokens",
  };
}

function source(): SourceRecord {
  return {
    id: sourceRef,
    provider_id: providerId,
    url: "https://ai.google.dev/gemini-api/docs/models",
    source: ["website"],
    stability: "documented",
    scope: "global",
    exhaustive: true,
    role: "catalog",
    field_paths: ["pricing"],
    observed_at: observedAt,
    content_hash: "1".repeat(64),
    extractor_version: "test",
  };
}

describe("parsed-source canonical pricing adapter", () => {
  it("canonicalizes megapixel rates without losing the pixel billing unit", () => {
    const { source: pricingSource } = pricingManifest();
    const parsedModel = model();
    parsedModel.price_facts = [
      {
        meter: "image_generation",
        price: "0.07",
        currency: "USD",
        unit: "million_pixels",
        conditions: {},
        source_ref: sourceRef,
        derived: false,
        raw_price: "0.07",
        raw_unit: "megapixel",
      },
    ];
    const partition = assembleParsedProviderPricing(
      providerId,
      observedAt,
      [{ source: pricingSource, models: [parsedModel] }],
      [parsedModel],
    );
    const term = partition?.books[0]?.offers[0]?.terms[0];
    expect(term?.kind === "rate" ? term.variants[0]?.price : undefined).toMatchObject({
      value: { numerator: "7", denominator: "100000000" },
      per: {
        factors: [{ unit: { namespace: "kmodels", value: "pixel" }, power: 1 }],
      },
    });
  });

  it("partitions every source pricing item into an explicit reconciliation disposition", () => {
    expect(
      sourcePricingReconciliation(
        [model()],
        [
          { disposition: "normalized", reason_code: "bound" },
          {
            disposition: "unbound",
            reason_code: "identity_not_found",
            sample: "public source row",
          },
          { disposition: "excluded", reason_code: "not_base_inference" },
        ],
        true,
      ),
    ).toEqual({
      basis: "source_item",
      unit: "reviewed source pricing item",
      observed_items: 3,
      disposition_counts: {
        normalized: 1,
        raw: 0,
        explicit_non_numeric: 0,
        excluded: 1,
        unbound: 1,
        ambiguous: 0,
        unsupported: 0,
        unresolved: 0,
      },
      diagnostic_count: 1,
      diagnostics: [
        {
          disposition: "unbound",
          reason_code: "identity_not_found",
          sample: "public source row",
        },
      ],
    });
  });

  it("falls back to parsed model outcomes and suppresses samples for private sources", () => {
    const unresolved = model();
    unresolved.pricing_state = "unknown";
    unresolved.price_facts = [];
    expect(sourcePricingReconciliation([unresolved], [], false)).toMatchObject({
      basis: "model_output",
      observed_items: 1,
      disposition_counts: { unresolved: 1 },
      diagnostic_count: 1,
      diagnostics: [{ disposition: "unresolved", reason_code: "parser_output_unknown" }],
    });
  });

  it("classifies every pricing source as reviewed first-party evidence", () => {
    const providerManifests: readonly ProviderManifest[] = manifests;
    for (const manifest of providerManifests)
      for (const source of manifest.sources) {
        if (source.fields.includes("pricing")) {
          expect(source.pricingEvidence, `${manifest.provider.id}/${source.id}`).toMatchObject({
            authority: "first_party",
          });
        } else {
          expect(source.pricingEvidence, `${manifest.provider.id}/${source.id}`).toBeUndefined();
        }
      }
  });

  it("does not make optional account inventory part of the required pricing bundle", () => {
    const azure = manifests.find(({ provider }) => provider.id === "azure");
    expect(azure?.sources.filter(isRequiredPricingSource).map(({ id }) => id)).toEqual([
      "azure-retail-prices",
      "azure-claude-pricing",
    ]);
  });

  it("requires explicit provenance for calculated source facts", () => {
    const calculated = model().price_facts[2]!;
    expect(sourcePriceFactSchema.safeParse(calculated).success).toBe(true);
    expect(sourcePriceFactSchema.safeParse({ ...calculated, derivation: undefined }).success).toBe(
      false,
    );
    expect(sourcePriceFactSchema.safeParse({ ...calculated, derived: false }).success).toBe(false);
  });

  it("omits absent optional conditions before canonicalization", () => {
    const parsed = sourcePriceFactSchema.parse(model().price_facts[0]);
    expect(parsed.conditions).toEqual({ region: "us-central1" });
    expect(Object.hasOwn(parsed.conditions, "endpoint")).toBe(false);
  });

  it("registers reviewed provider labels without changing canonical categorical values", () => {
    const { source: pricingSource } = pricingManifest();
    const parsedModel = model();
    parsedModel.price_facts = [
      tokenRate("1", { operation: "provider.event.create" }),
      tokenRate("2", { operation: "other_operation" }),
    ];
    const partition = assembleParsedProviderPricing(
      providerId,
      observedAt,
      [{ source: pricingSource, models: [parsedModel] }],
      [parsedModel],
      [
        {
          dimension: { namespace: "kmodels", value: "operation" },
          value: "provider.event.create",
          label: "Text input",
        },
      ],
    );

    expect(
      partition?.vocabulary.atoms.filter(
        (atom) => atom.kind === "categorical_value" && atom.dimension.value === "operation",
      ),
    ).toEqual([
      {
        kind: "categorical_value",
        key: "other_operation",
        dimension: { namespace: "kmodels", value: "operation" },
        definition: 'Provider-published operation value "other_operation"',
      },
      {
        kind: "categorical_value",
        key: "provider.event.create",
        dimension: { namespace: "kmodels", value: "operation" },
        definition: 'Provider-published operation value "provider.event.create"',
        label: "Text input",
      },
    ]);
  });

  it("normalizes exact calculated rates and fixed/provider units", () => {
    const { provider: providerManifest, source: pricingSource } = pricingManifest();
    const parsedModel = model();
    const partition = assembleParsedProviderPricing(
      providerId,
      observedAt,
      [{ source: pricingSource, models: [parsedModel] }],
      [parsedModel],
    );
    if (partition === undefined) throw new Error("Pricing partition was not assembled");
    const data: PricingCatalog = {
      provider_vocabularies: [partition.vocabulary],
      provider_snapshots: [partition.snapshot],
      model_dispositions: partition.model_dispositions,
      books: partition.books,
    };
    const core: Pick<Catalog, "providers" | "models" | "sources"> = {
      providers: [
        {
          ...providerManifest.provider,
          source_ids: providerManifest.sources.map(({ id }) => id),
        },
      ],
      models: [parsedModel],
      sources: [source()],
    };
    expect(() => validatePricingCatalog(data, core)).not.toThrow();

    const bookId = pricingBookId(providerId, `model:${modelRef}`);
    const usageId = pricingOfferId(bookId, "usage");
    const input = partition.books[0]?.offers[0]?.terms.find(
      ({ id }) => id === pricingTermId(usageId, "input_text"),
    );
    const storage = partition.books[0]?.offers[0]?.terms.find(
      ({ id }) => id === pricingTermId(usageId, "cache_storage"),
    );
    const output = partition.books[0]?.offers[0]?.terms.find(
      ({ id }) => id === pricingTermId(usageId, "output_text"),
    );
    const oversized = partition.books[0]?.offers[0]?.terms.find(
      ({ id }) => id === pricingTermId(usageId, "input_audio"),
    );
    const invalidValidity = partition.books[0]?.offers[0]?.terms.find(
      ({ id }) => id === pricingTermId(usageId, "output_audio"),
    );
    expect(input?.kind === "rate" ? input.variants[0]?.price.value : undefined).toEqual({
      numerator: "1",
      denominator: "500000",
    });
    expect(storage?.kind === "rate" ? storage.variants[0]?.price : undefined).toMatchObject({
      value: { numerator: "1", denominator: "1000000000" },
      per: {
        factors: [
          { unit: { namespace: "kmodels", value: "second" }, power: 1 },
          { unit: { namespace: "kmodels", value: "token" }, power: 1 },
        ],
      },
    });
    expect(output?.kind === "rate" ? output.variants[0]?.price.value : undefined).toEqual({
      numerator: "1",
      denominator: "250000",
    });
    expect(
      output?.kind === "rate" ? output.variants[0]?.observations[0]?.raw.formula : undefined,
    ).toBe("2 × input");
    expect(partition.vocabulary.atoms).toContainEqual({
      kind: "unit",
      key: "search_unit",
      definition: "One provider-published search or rerank billing unit",
    });
    expect(oversized?.kind === "rate" ? oversized.raw_variants[0]?.reason : undefined).toBe(
      "unsupported_structure",
    );
    expect(
      invalidValidity?.kind === "rate" ? invalidValidity.raw_variants[0]?.reason : undefined,
    ).toBe("unsupported_structure");
  });

  it("preserves source-native pricing formulas as raw terms", () => {
    const { source: pricingSource } = pricingManifest();
    const parsedModel = model();
    parsedModel.pricing_state = "unknown";
    parsedModel.price_facts = [];
    parsedModel.raw_price_facts = [
      {
        term_key: "agent_usage_formula",
        impact: "base_price",
        reason: "requires_usage_aggregation",
        conditions: {},
        source_ref: sourceRef,
        raw: {
          label: "Agent usage pricing",
          formula: "Underlying model inference plus tool usage",
        },
      },
    ];
    const partition = assembleParsedProviderPricing(
      providerId,
      observedAt,
      [{ source: pricingSource, models: [parsedModel] }],
      [parsedModel],
    );
    const term = partition?.books[0]?.offers[0]?.terms[0];
    expect(term).toMatchObject({
      kind: "raw",
      term_key: "agent_usage_formula",
      variants: [
        {
          impact: "base_price",
          reason: "requires_usage_aggregation",
          observations: [
            {
              raw: {
                label: "Agent usage pricing",
                formula: "Underlying model inference plus tool usage",
              },
            },
          ],
        },
      ],
    });
  });

  it("keeps account eligibility independent from inference service tiers", () => {
    const { source: pricingSource } = pricingManifest();
    const parsedModel = model();
    parsedModel.price_facts = [
      tokenRate("0", { account_eligibility: "free_tier" }),
      tokenRate("1", { account_eligibility: "paid_tier" }),
      tokenRate("0.5", {
        account_eligibility: "paid_tier",
        service_tier: "batch",
      }),
    ];
    const partition = assembleParsedProviderPricing(
      providerId,
      observedAt,
      [{ source: pricingSource, models: [parsedModel] }],
      [parsedModel],
    );
    const term = partition?.books[0]?.offers[0]?.terms[0];
    if (term?.kind !== "rate") throw new Error("Input rate term was not assembled");
    const dimensions = (amount: string) =>
      term.variants
        .find(({ observations }) => observations[0]?.raw.amount === amount)
        ?.applicability.any_of[0]?.all_of.flatMap((condition) =>
          condition.kind === "categorical"
            ? [[condition.dimension.value, condition.values[0]?.value]]
            : [],
        );
    expect(dimensions("0")).toContainEqual(["account_eligibility", "free_tier"]);
    expect(dimensions("0.5")).toEqual(
      expect.arrayContaining([
        ["account_eligibility", "paid_tier"],
        ["service_tier", "batch"],
      ]),
    );
  });

  it("keeps exact provider capacity units normalized", () => {
    const { source: pricingSource } = pricingManifest();
    const parsedModel = model();
    parsedModel.price_facts = [
      {
        meter: "provisioned_throughput",
        price: "0.198",
        currency: "USD",
        unit: "thousand_tokens_per_minute_hour",
        conditions: { capacity: "input_tokens_per_minute" },
        source_ref: sourceRef,
        derived: false,
        raw_price: "0.198",
        raw_unit: "1K TPM Hour",
      },
    ];
    const partition = assembleParsedProviderPricing(
      providerId,
      observedAt,
      [{ source: pricingSource, models: [parsedModel] }],
      [parsedModel],
    );
    const capacity = partition?.books[0]?.offers.find(({ offer_key }) => offer_key === "capacity");
    const term = capacity?.terms[0];
    expect(term?.kind === "rate" ? term.variants[0]?.price : undefined).toMatchObject({
      value: { numerator: "99", denominator: "500" },
      per: {
        factors: [
          {
            unit: { namespace: "provider", provider_id: providerId, value: "1k_tpm_hour" },
            power: 1,
          },
        ],
      },
    });
    expect(partition?.vocabulary.atoms).toContainEqual({
      kind: "unit",
      key: "1k_tpm_hour",
      definition: "One 1,000-tokens-per-minute capacity unit sustained for one hour",
    });
  });

  it("makes reviewed defaults and context tiers independently selectable", () => {
    const { source: pricingSource } = pricingManifest();
    const parsedModel = model();
    parsedModel.price_facts = [
      tokenRate("1", {}),
      tokenRate("2", { context_min_tokens: 200_001 }),
      tokenRate("0.5", { service_tier: "batch" }),
    ];

    const partition = assembleParsedProviderPricing(
      providerId,
      observedAt,
      [{ source: pricingSource, models: [parsedModel] }],
      [parsedModel],
    );
    const term = partition?.books[0]?.offers[0]?.terms[0];
    if (term?.kind !== "rate") throw new Error("Input rate term was not assembled");
    expect(term.raw_variants).toEqual([]);
    expect(term.variants).toHaveLength(3);

    const base = term.variants.find(({ observations }) =>
      observations.some(({ raw }) => raw.amount === "1"),
    );
    expect(base?.applicability.any_of[0]?.all_of).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "decimal_range",
          upper: { value: "200000", inclusive: true },
        }),
        expect.objectContaining({
          kind: "categorical",
          dimension: { namespace: "kmodels", value: "service_tier" },
          values: [{ namespace: "provider", provider_id: providerId, value: "standard" }],
        }),
      ]),
    );
    expect(base?.observations[0]?.raw.conditions).toBeUndefined();
  });

  it("applies provider defaults only where official alternatives establish them", () => {
    const { source: pricingSource } = pricingManifest();
    const scenarios = [
      {
        provider: "anthropic",
        key: "inference_geo",
        explicit: "us",
        expected: "global",
      },
      {
        provider: "anthropic",
        key: "speed",
        explicit: "fast",
        expected: "standard",
      },
      {
        provider: "amazon-bedrock",
        key: "speed",
        explicit: "optimized",
        expected: "standard",
      },
      {
        provider: "azure",
        key: "context_tier",
        explicit: "long_context",
        expected: "standard",
      },
      { provider: "databricks", key: "promotion", explicit: true, expected: false },
      { provider: "vertex", key: "promotion", explicit: true, expected: false },
    ] as const;

    for (const scenario of scenarios) {
      const base = model();
      const parsedModel: ParsedProviderModel = {
        ...base,
        provider_id: scenario.provider,
        uid: `${scenario.provider}/test-model`,
        price_facts: [tokenRate("1", {}), tokenRate("2", { [scenario.key]: scenario.explicit })],
      };
      const partition = assembleParsedProviderPricing(
        scenario.provider,
        observedAt,
        [{ source: pricingSource, models: [parsedModel] }],
        [parsedModel],
      );
      const term = partition?.books[0]?.offers[0]?.terms[0];
      if (term?.kind !== "rate") throw new Error("Input rate term was not assembled");
      expect(term.raw_variants).toEqual([]);
      const normalizedBase = term.variants.find(({ observations }) =>
        observations.some(({ raw }) => raw.amount === "1"),
      );
      const condition = normalizedBase?.applicability.any_of[0]?.all_of.find(
        ({ dimension }) => dimension.value === scenario.key,
      );
      expect(
        condition?.kind === "categorical"
          ? condition.values[0]?.value
          : condition?.kind === "boolean"
            ? condition.value
            : undefined,
      ).toBe(scenario.expected);
    }
  });

  it("keeps Anthropic speed, service tier, and inference geography independent", () => {
    const { source: pricingSource } = pricingManifest();
    const base = model();
    const parsedModel: ParsedProviderModel = {
      ...base,
      provider_id: "anthropic",
      uid: "anthropic/test-model",
      price_facts: [
        tokenRate("1", {}),
        tokenRate("0.5", { service_tier: "batch" }),
        tokenRate("2", { speed: "fast" }),
        tokenRate("1.1", { inference_geo: "us" }),
      ],
    };
    const partition = assembleParsedProviderPricing(
      "anthropic",
      observedAt,
      [{ source: pricingSource, models: [parsedModel] }],
      [parsedModel],
    );
    const term = partition?.books[0]?.offers[0]?.terms[0];
    if (term?.kind !== "rate") throw new Error("Input rate term was not assembled");
    const conditions = (amount: string) => {
      const variant = term.variants.find(({ observations }) =>
        observations.some(({ raw }) => raw.amount === amount),
      );
      return Object.fromEntries(
        (variant?.applicability.any_of[0]?.all_of ?? []).flatMap((condition) =>
          condition.kind === "categorical"
            ? [[condition.dimension.value, condition.values[0]?.value]]
            : [],
        ),
      );
    };
    expect(conditions("0.5")).toEqual({
      service_tier: "batch",
      speed: "standard",
      inference_geo: "global",
    });
    expect(conditions("2")).toEqual({
      service_tier: "standard",
      speed: "fast",
      inference_geo: "global",
    });
  });

  it("preserves explicit non-numeric source states", () => {
    const { source: pricingSource } = pricingManifest();
    const parsedModel = model();
    parsedModel.price_facts = [];
    parsedModel.pricing_state = "not_published";
    const partition = assembleParsedProviderPricing(
      providerId,
      observedAt,
      [{ source: pricingSource, models: [parsedModel] }],
      [parsedModel],
    );
    expect(partition?.books[0]?.offers[0]?.states).toEqual([
      expect.objectContaining({ state: "not_published" }),
    ]);
  });

  it("keeps a free usage offer alongside numeric capacity pricing", () => {
    const { source: pricingSource } = pricingManifest();
    const parsedModel = model();
    parsedModel.pricing_state = "free";
    parsedModel.price_facts = [
      {
        meter: "provisioned_throughput",
        price: "3.75",
        currency: "USD",
        unit: "unit_hour",
        conditions: { endpoint: "Model Vault" },
        source_ref: sourceRef,
        derived: false,
      },
    ];
    const partition = assembleParsedProviderPricing(
      providerId,
      observedAt,
      [{ source: pricingSource, models: [parsedModel] }],
      [parsedModel],
    );
    expect(
      partition?.books[0]?.offers
        .map(({ billing_mode, states }) => ({
          billing_mode: billing_mode.value,
          states: states.map(({ state }) => state),
        }))
        .sort((left, right) => left.billing_mode.localeCompare(right.billing_mode)),
    ).toEqual([
      { billing_mode: "capacity", states: ["numeric"] },
      { billing_mode: "usage", states: ["free"] },
    ]);
  });

  it("binds versionless pricing evidence only to one unambiguous model", () => {
    const { source: pricingSource } = pricingManifest();
    const sourceModel = model();
    const published = {
      ...sourceModel,
      uid: `${modelRef}@2026-01-01`,
      version: "2026-01-01",
    };
    const partition = assembleParsedProviderPricing(
      providerId,
      observedAt,
      [{ source: pricingSource, models: [sourceModel] }],
      [published],
    );
    expect(partition?.books[0]?.scope).toEqual({
      kind: "models",
      model_refs: [published.uid],
    });
    expect(
      assembleParsedProviderPricing(
        providerId,
        observedAt,
        [{ source: pricingSource, models: [sourceModel] }],
        [published, { ...published, uid: `${modelRef}@2026-02-01`, version: "2026-02-01" }],
      ),
    ).toBeUndefined();
  });
});
