import { describe, expect, it } from "vite-plus/test";
import { manifests, type ProviderManifest, type SourceManifest } from "../src/catalog/manifests.ts";
import {
  assembleParsedProviderPricing,
  isPricingDependencySource,
  isPricingInputSource,
  isPricingSource,
  isRequiredPricingSource,
} from "../src/catalog/pricing-adapter.ts";
import { validateAdoptedTopology } from "../src/catalog/pricing-adopted-topology.ts";
import {
  pricingBookId,
  pricingOfferId,
  pricingTermId,
} from "../src/catalog/pricing-identifiers.ts";
import { rawPricingFact } from "../src/catalog/pricing.ts";
import { modelPricingView } from "../src/catalog/pricing-presentation.ts";
import { sourcePricingReconciliation } from "../src/catalog/pricing-reconciliation.ts";
import type { PricingCatalog } from "../src/catalog/pricing-schema.ts";
import {
  sourcePriceFactSchema,
  type ParsedProviderModel,
  type SourceCommercialPricingFact,
  type SourcePriceFact,
  type SourcePricingInputFact,
} from "../src/catalog/pricing-source.ts";
import { validatePricingCatalog } from "../src/catalog/pricing-validation.ts";
import { unknownCapabilities, type Catalog, type SourceRecord } from "../src/catalog/schema.ts";

const providerId = "gemini";
const sourceRef = "gemini-pricing";
const modelRef = "gemini/test-model";
const observedAt = "2026-07-28T00:00:00.000Z";

function pricingManifest(): { provider: ProviderManifest; source: SourceManifest } {
  const provider = manifests.find((manifest) => manifest.provider.id === providerId);
  const source = provider?.sources.find(({ id }) => id === sourceRef);
  if (provider === undefined || source === undefined)
    throw new Error("Gemini pricing manifest is missing");
  return { provider, source };
}

function baseModelPricingSource(id = sourceRef): SourceManifest {
  const { source } = pricingManifest();
  if (source.pricingEvidence === undefined) throw new Error("Gemini pricing policy is missing");
  return {
    ...source,
    id,
    pricingEvidence: { ...source.pricingEvidence, binding: "base_model_id" },
  };
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

function geminiPricingInput(
  key: string,
  channel: SourcePricingInputFact["channel"],
  value: string,
): SourcePricingInputFact {
  return {
    key,
    channel,
    locator: { kind: "provider_field", value },
    availability: channel === "result" ? "success_only" : "terminal_only",
    source_ref: sourceRef,
  };
}

function bedrockPricingInput(
  key: string,
  channel: SourcePricingInputFact["channel"],
  value: string,
  availability: SourcePricingInputFact["availability"] = "terminal_only",
): SourcePricingInputFact {
  return {
    key,
    channel,
    locator: value.startsWith("/")
      ? { kind: "json_pointer", value }
      : { kind: "provider_field", value },
    availability,
    source_ref: sourceRef,
  };
}

function withPriceSource(value: ParsedProviderModel, sourceId: string): ParsedProviderModel {
  return {
    ...value,
    price_facts: value.price_facts.map((fact) => ({ ...fact, source_ref: sourceId })),
    source_refs: [sourceId],
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
      reason_counts: {
        bound: 1,
        identity_not_found: 1,
        not_base_inference: 1,
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

  it("treats accounting contracts as pricing dependencies without inventing rate authority", () => {
    const providerManifests: readonly ProviderManifest[] = manifests;
    const accounting = providerManifests
      .flatMap(({ sources }) => sources)
      .filter(({ fields }) => fields.includes("pricing_inputs"));
    expect(accounting.length).toBeGreaterThan(0);
    for (const source of accounting) {
      expect(isPricingInputSource(source)).toBe(true);
      expect(isPricingDependencySource(source)).toBe(true);
    }
    const openAiAccounting = accounting.find(({ id }) => id === "openai-accounting");
    expect(openAiAccounting?.pricingEvidence).toBeUndefined();
    expect(openAiAccounting === undefined ? true : isPricingSource(openAiAccounting)).toBe(false);
  });

  it("keeps Azure pricing overlays optional and account inventory outside pricing", () => {
    const providerManifests: readonly ProviderManifest[] = manifests;
    const azure = providerManifests.find(({ provider }) => provider.id === "azure");
    expect(azure?.sources.filter(isRequiredPricingSource)).toEqual([]);
    expect(
      azure?.sources
        .filter(({ fields }) => fields.includes("pricing"))
        .every(({ optional }) => optional === true),
    ).toBe(true);
    const accountInventory = azure?.sources.find(({ id }) => id === "azure-api");
    expect(accountInventory).toBeDefined();
    if (accountInventory === undefined) throw new Error("Azure account inventory is missing");
    expect(isPricingSource(accountInventory)).toBe(false);
  });

  it("retains omitted facts from the optional Hugging Face pricing overlay", () => {
    const huggingFace = manifests.find(({ provider }) => provider.id === "huggingface");
    const featherless = huggingFace?.sources.find(({ id }) => id === "huggingface-featherless");
    expect(featherless).toMatchObject({ optional: true, retainOmittedFacts: true });
    expect(featherless === undefined ? false : isRequiredPricingSource(featherless)).toBe(false);
  });

  it("requires explicit provenance for calculated source facts", () => {
    const calculated = model().price_facts[2]!;
    expect(sourcePriceFactSchema.safeParse(calculated).success).toBe(true);
    expect(sourcePriceFactSchema.safeParse({ ...calculated, derivation: undefined }).success).toBe(
      false,
    );
    expect(sourcePriceFactSchema.safeParse({ ...calculated, derived: false }).success).toBe(false);
  });

  it("uses a source-native commercial locator when one is available", () => {
    const { source: pricingSource } = pricingManifest();
    const parsedModel = model();
    parsedModel.price_facts = [
      {
        ...tokenRate("1", {}),
        source_locator: {
          kind: "meter",
          value: "11111111-1111-1111-1111-111111111111",
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
    expect(term?.kind === "rate" ? term.variants[0]?.observations[0]?.locator : undefined).toEqual({
      kind: "meter",
      value: "11111111-1111-1111-1111-111111111111",
    });
  });

  it("omits absent optional conditions before canonicalization", () => {
    const parsed = sourcePriceFactSchema.parse(model().price_facts[0]);
    expect(parsed.conditions).toEqual({ region: "us-central1" });
    expect(Object.hasOwn(parsed.conditions, "endpoint")).toBe(false);
  });

  it("attaches reviewed labels only to observed categorical values", () => {
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
        {
          dimension: { namespace: "kmodels", value: "operation" },
          value: "unused_operation",
          label: "Unused operation",
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
    const syncId = pricingOfferId(bookId, "sync");
    const sync = partition.books[0]?.offers.find(({ offer_key }) => offer_key === "sync");
    const input = sync?.terms.find(({ id }) => id === pricingTermId(syncId, "rate", "input_text"));
    const storage = sync?.terms.find(({ id }) => id === pricingTermId(syncId, "rate", "storage"));
    const output = sync?.terms.find(
      ({ id }) => id === pricingTermId(syncId, "rate", "output_text"),
    );
    const oversized = sync?.terms.find(
      ({ id }) => id === pricingTermId(syncId, "rate", "input_audio"),
    );
    const invalidValidity = sync?.terms.find(
      ({ id }) => id === pricingTermId(syncId, "rate", "output_audio"),
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

  it.each(["allowance", "informational"] as const)(
    "does not create an offer from %s raw facts alone",
    (impact) => {
      const { source: pricingSource } = pricingManifest();
      const parsedModel = model();
      parsedModel.pricing_state = "unknown";
      parsedModel.price_facts = [];
      parsedModel.raw_price_facts = [
        rawPricingFact(
          sourceRef,
          "non_base_fact",
          impact,
          "requires_usage_aggregation",
          "Unresolved non-base pricing fact",
        ),
      ];

      expect(
        assembleParsedProviderPricing(
          providerId,
          observedAt,
          [{ source: pricingSource, models: [parsedModel] }],
          [parsedModel],
        ),
      ).toBeUndefined();
    },
  );

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
    const book = partition?.books[0];
    const sync = book?.offers.find(({ offer_key }) => offer_key === "sync");
    const batch = book?.offers.find(({ offer_key }) => offer_key === "batch");
    const syncTerm = sync?.terms[0];
    const batchTerm = batch?.terms[0];
    if (syncTerm?.kind !== "rate" || batchTerm?.kind !== "rate")
      throw new Error("Input rate terms were not assembled");
    const dimensions = (term: typeof syncTerm, amount: string) =>
      term.variants
        .find(({ observations }) => observations[0]?.raw.amount === amount)
        ?.applicability.any_of[0]?.all_of.flatMap((condition) =>
          condition.kind === "categorical"
            ? [[condition.dimension.value, condition.values[0]?.value]]
            : [],
        );
    expect(dimensions(syncTerm, "0")).toEqual(
      expect.arrayContaining([
        ["account_eligibility", "free_tier"],
        ["served_service_tier", "standard"],
      ]),
    );
    expect(dimensions(batchTerm, "0.5")).toEqual([["account_eligibility", "paid_tier"]]);
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
    const book = partition?.books[0];
    const sync = book?.offers.find(({ offer_key }) => offer_key === "sync");
    const batch = book?.offers.find(({ offer_key }) => offer_key === "batch");
    const term = sync?.terms[0];
    if (term?.kind !== "rate") throw new Error("Input rate term was not assembled");
    expect(term.raw_variants).toEqual([]);
    expect(term.variants).toHaveLength(2);
    const batchTerm = batch?.terms[0];
    expect(
      batchTerm?.kind === "rate" ? batchTerm.variants[0]?.observations[0]?.raw.amount : undefined,
    ).toBe("0.5");

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
          dimension: { namespace: "kmodels", value: "served_service_tier" },
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

  it("separates Foundry synchronous, Batch, and router request rates", () => {
    const { source: pricingSource } = pricingManifest();
    const azure = (id: string, rates: SourcePriceFact[]): ParsedProviderModel => ({
      ...model(),
      provider_id: "azure",
      model_id: id,
      uid: `azure/${id}`,
      service_families: ["Azure OpenAI"],
      api_endpoints: [
        { name: "createBatch", path: "openai/v1/batches" },
        { name: "createChatCompletion", path: "openai/v1/chat/completions" },
        { name: "createResponse", path: "openai/v1/responses" },
      ],
      price_facts: rates,
    });
    const baseRates: SourcePriceFact[] = [
      tokenRate("2", { service_tier: "standard" }),
      tokenRate("4", { service_tier: "priority" }),
      tokenRate("1", { service_tier: "batch" }),
      {
        meter: "input_image",
        price: "3",
        currency: "USD",
        unit: "million_tokens",
        conditions: { operation: "vision" },
        source_ref: sourceRef,
        derived: false,
      },
      {
        meter: "input_image",
        price: "0.001",
        currency: "USD",
        unit: "page",
        conditions: { operation: "document_ocr" },
        source_ref: sourceRef,
        derived: false,
      },
      {
        meter: "provisioned_throughput",
        price: "10",
        currency: "USD",
        unit: "unit_hour",
        conditions: { deployment_scope: "GlobalProvisioned" },
        source_ref: sourceRef,
        derived: false,
      },
    ];
    const direct = azure("gpt-test", baseRates);
    const azureManifest = manifests.find(({ provider }) => provider.id === "azure");
    const accountingSource = azureManifest?.sources.find(({ id }) => id === "azure-accounting");
    if (accountingSource === undefined) throw new Error("Azure accounting source is missing");
    const accounting: ParsedProviderModel = {
      ...direct,
      pricing_state: "unknown",
      price_facts: [],
      pricing_inputs: [
        {
          key: "chat.input_tokens",
          channel: "response",
          locator: { kind: "json_pointer", value: "/usage/prompt_tokens" },
          availability: "terminal_only",
          source_ref: accountingSource.id,
        },
        {
          key: "chat.input_tokens",
          channel: "stream_event",
          locator: { kind: "json_pointer", value: "/usage/prompt_tokens" },
          availability: "terminal_only",
          source_ref: accountingSource.id,
        },
        {
          key: "responses.input_tokens",
          channel: "response",
          locator: { kind: "json_pointer", value: "/usage/input_tokens" },
          availability: "terminal_only",
          source_ref: accountingSource.id,
        },
        {
          key: "batch.input_tokens",
          channel: "result",
          locator: { kind: "json_pointer", value: "/usage/input_tokens" },
          availability: "terminal_only",
          source_ref: accountingSource.id,
        },
      ],
    };
    const router = azure("model-router", [tokenRate("0.1", {})]);
    const partition = assembleParsedProviderPricing(
      "azure",
      observedAt,
      [
        { source: pricingSource, models: [direct, router] },
        { source: accountingSource, models: [accounting] },
      ],
      [direct, router],
    );
    const books = partition?.books ?? [];
    const directBook = books.find(({ book_key }) => book_key === "model:azure/gpt-test");
    expect(directBook?.offers.map(({ offer_key }) => offer_key).sort()).toEqual(["batch", "sync"]);
    const sync = directBook?.offers.find(({ offer_key }) => offer_key === "sync");
    const batch = directBook?.offers.find(({ offer_key }) => offer_key === "batch");
    const syncInput = sync?.terms.find(({ term_key }) => term_key === "input_text");
    const batchInput = batch?.terms.find(({ term_key }) => term_key === "input_text");
    expect(batchInput?.source_refs).toEqual([accountingSource.id, sourceRef].sort());
    expect(
      syncInput?.kind === "rate"
        ? syncInput.variants.map(({ charge_binding, applicability }) => ({
            aggregation: charge_binding?.aggregation,
            tier: applicability.any_of[0]?.all_of.find(
              ({ dimension }) => dimension.value === "served_service_tier",
            ),
          }))
        : [],
    ).toEqual(
      expect.arrayContaining([
        {
          aggregation: "attempt",
          tier: expect.objectContaining({
            kind: "categorical",
            values: [expect.objectContaining({ value: "standard" })],
          }),
        },
        {
          aggregation: "attempt",
          tier: expect.objectContaining({
            kind: "categorical",
            values: [expect.objectContaining({ value: "priority" })],
          }),
        },
      ]),
    );
    expect(batchInput?.kind === "rate" ? batchInput.variants[0] : undefined).toMatchObject({
      charge_binding: {
        aggregation: "job",
        signal: {
          namespace: "kmodels",
          value: "uncached_input_tokens",
        },
        quantity_methods: [
          {
            input_sources: [
              expect.objectContaining({
                channel: "result",
                locator: { kind: "json_pointer", value: "/usage/input_tokens" },
              }),
            ],
          },
        ],
      },
    });
    expect(
      batchInput?.kind === "rate"
        ? batchInput.variants[0]?.applicability.any_of[0]?.all_of.some(
            ({ dimension }) => dimension.value === "service_tier",
          )
        : true,
    ).toBe(false);
    expect(sync).toMatchObject({ enrollment: [], relations: [], settlement: [] });
    const imageInput = sync?.terms.find(({ term_key }) => term_key === "input_image");
    expect(
      imageInput?.kind === "rate"
        ? imageInput.variants
            .map(({ charge_binding }) => charge_binding?.signal.value)
            .sort((left, right) => (left ?? "").localeCompare(right ?? ""))
        : [],
    ).toEqual(["input_image_tokens", "processed_pages"]);

    expect(books.some(({ scope }) => scope.kind === "provider_resource")).toBe(false);

    const routerBook = books.find(({ book_key }) => book_key === "model:azure/model-router");
    expect(routerBook?.offers[0]).toMatchObject({ offer_key: "router", name: "Model Router" });
    expect(routerBook?.offers[0]?.terms[0]).toMatchObject({
      kind: "rate",
      term_key: "model_router_input",
      meter: { namespace: "provider", provider_id: "azure", value: "model_router_input" },
      variants: [
        expect.objectContaining({
          charge_binding: expect.objectContaining({
            signal: {
              namespace: "provider",
              provider_id: "azure",
              value: "router_input_kmodels_token_p1",
            },
            quantity_methods: expect.any(Array),
          }),
        }),
      ],
    });
  });

  it("derives Azure text-token partitions only from complete endpoint-local usage", () => {
    const { source: pricingSource } = pricingManifest();
    const rate = (meter: SourcePriceFact["meter"], price: string): SourcePriceFact => ({
      meter,
      price,
      currency: "USD",
      unit: "million_tokens",
      conditions: { service_tier: "standard" },
      source_ref: sourceRef,
      derived: false,
    });
    const input = (
      key: string,
      pointer: string,
      channel: SourcePricingInputFact["channel"] = "response",
    ): SourcePricingInputFact => ({
      key,
      channel,
      locator: { kind: "json_pointer", value: pointer },
      availability: "terminal_only",
      source_ref: sourceRef,
    });
    const priced: ParsedProviderModel = {
      ...model(),
      provider_id: "azure",
      model_id: "gpt-audio-test",
      uid: "azure/gpt-audio-test",
      api_endpoints: [
        { name: "createChatCompletion", path: "openai/v1/chat/completions" },
        { name: "createResponse", path: "openai/v1/responses" },
      ],
      price_facts: [
        rate("input_text", "4"),
        rate("cache_read_text", "1"),
        rate("cache_write_text", "5"),
        rate("input_audio", "8"),
        rate("output_text", "16"),
        rate("output_audio", "32"),
      ],
      pricing_inputs: [
        input("chat.input_tokens", "/usage/prompt_tokens"),
        input("chat.cached_input_tokens", "/usage/prompt_tokens_details/cached_tokens"),
        input("chat.cache_write_tokens", "/usage/prompt_tokens_details/cache_write_tokens"),
        input("chat.input_audio_tokens", "/usage/prompt_tokens_details/audio_tokens"),
        input("chat.output_tokens", "/usage/completion_tokens"),
        input("chat.output_audio_tokens", "/usage/completion_tokens_details/audio_tokens"),
        input("responses.input_tokens", "/usage/input_tokens"),
        input("responses.cached_input_tokens", "/usage/input_tokens_details/cached_tokens"),
        input("responses.output_tokens", "/usage/output_tokens"),
      ],
    };
    const partition = assembleParsedProviderPricing(
      "azure",
      observedAt,
      [{ source: pricingSource, models: [priced] }],
      [priced],
    );
    const terms = partition?.books[0]?.offers[0]?.terms ?? [];
    const binding = (key: string) => {
      const term = terms.find(({ term_key }) => term_key === key);
      return term?.kind === "rate" ? term.variants[0]?.charge_binding : undefined;
    };
    expect(binding("input_text")).toMatchObject({
      signal: { namespace: "kmodels", value: "uncached_input_tokens" },
      quantity_methods: [
        {
          calculation: {
            nodes: [
              { op: "signal", signal: { namespace: "kmodels", value: "input_tokens" } },
              { op: "signal", signal: { namespace: "kmodels", value: "cached_input_tokens" } },
              { op: "subtract_floor_zero", minuend: 0, subtrahend: 1 },
              { op: "signal", signal: { namespace: "kmodels", value: "cache_write_tokens" } },
              { op: "subtract_floor_zero", minuend: 2, subtrahend: 3 },
              {
                op: "signal",
                signal: {
                  namespace: "provider",
                  provider_id: "azure",
                  value: "input_audio_tokens",
                },
              },
              { op: "subtract_floor_zero", minuend: 4, subtrahend: 5 },
            ],
            result: 6,
          },
        },
      ],
    });
    expect(binding("output_text")).toMatchObject({
      signal: { namespace: "kmodels", value: "output_tokens" },
      quantity_methods: [
        {
          calculation: {
            nodes: [
              { op: "signal", signal: { namespace: "kmodels", value: "output_tokens" } },
              {
                op: "signal",
                signal: {
                  namespace: "provider",
                  provider_id: "azure",
                  value: "output_audio_tokens",
                },
              },
              { op: "subtract_floor_zero", minuend: 0, subtrahend: 1 },
            ],
            result: 2,
          },
        },
      ],
    });
    expect(binding("cache_read_text")?.quantity_methods?.[0]?.input_sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          locator: { kind: "json_pointer", value: "/usage/prompt_tokens_details/cached_tokens" },
        }),
        expect.objectContaining({
          locator: { kind: "json_pointer", value: "/usage/input_tokens_details/cached_tokens" },
        }),
      ]),
    );

    const partial = {
      ...priced,
      pricing_inputs: priced.pricing_inputs?.filter(({ key }) => key !== "chat.input_audio_tokens"),
    };
    const partialPartition = assembleParsedProviderPricing(
      "azure",
      observedAt,
      [{ source: pricingSource, models: [partial] }],
      [partial],
    );
    const partialInput = partialPartition?.books[0]?.offers[0]?.terms.find(
      ({ term_key }) => term_key === "input_text",
    );
    expect(
      partialInput?.kind === "rate"
        ? partialInput.variants[0]?.charge_binding?.quantity_methods
        : undefined,
    ).toBeUndefined();
  });

  it("binds Azure image, audio-duration, and video quantities without synthetic locators", () => {
    const { source: pricingSource } = pricingManifest();
    const rate = (
      meter: SourcePriceFact["meter"],
      unit: SourcePriceFact["unit"],
      conditions: SourcePriceFact["conditions"] = {},
    ): SourcePriceFact => ({
      meter,
      price: "1",
      currency: "USD",
      unit,
      conditions,
      source_ref: sourceRef,
      derived: false,
    });
    const input = (
      key: string,
      pointer: string,
      reduction?: SourcePricingInputFact["reduction"],
    ): SourcePricingInputFact => ({
      key,
      channel: key.startsWith("video.") ? "result" : "response",
      locator: { kind: "json_pointer", value: pointer },
      ...(reduction === undefined ? {} : { reduction }),
      availability: "success_only",
      source_ref: sourceRef,
    });
    const image: ParsedProviderModel = {
      ...model(),
      provider_id: "azure",
      model_id: "image-test",
      uid: "azure/image-test",
      tasks: ["image_generation"],
      price_facts: [
        rate("input_text", "million_tokens"),
        rate("input_image", "million_tokens"),
        rate("output_image", "million_tokens"),
        rate("image_generation", "image", { quality: "low", resolution: "1024x1024" }),
      ],
      pricing_inputs: [
        input("images.input_text_tokens", "/usage/input_tokens_details/text_tokens"),
        input("images.input_image_tokens", "/usage/input_tokens_details/image_tokens"),
        input("images.output_image_tokens", "/usage/output_tokens"),
        input("images.generated_images", "/data", { kind: "array_length" }),
        input("images.quality", "/quality"),
        input("images.resolution", "/size"),
        input("embeddings.input_tokens", "/usage/prompt_tokens"),
        input("audio.transcription_seconds", "/duration"),
        input("video.generated_seconds", "/n_seconds"),
      ],
    };
    const transcription: ParsedProviderModel = {
      ...model(),
      provider_id: "azure",
      model_id: "transcription-test",
      uid: "azure/transcription-test",
      tasks: ["transcription"],
      price_facts: [rate("input_audio", "second")],
    };
    const embedding: ParsedProviderModel = {
      ...model(),
      provider_id: "azure",
      model_id: "embedding-test",
      uid: "azure/embedding-test",
      tasks: ["embeddings"],
      api_endpoints: [{ name: "createEmbedding", path: "openai/v1/embeddings" }],
      price_facts: [rate("embedding", "million_tokens")],
    };
    const video: ParsedProviderModel = {
      ...model(),
      provider_id: "azure",
      model_id: "video-test",
      uid: "azure/video-test",
      tasks: ["video_generation"],
      price_facts: [rate("video_generation", "second", { resolution: "720p" })],
    };
    const partition = assembleParsedProviderPricing(
      "azure",
      observedAt,
      [{ source: pricingSource, models: [image, transcription, embedding, video] }],
      [image, transcription, embedding, video],
    );
    const offer = (uid: string) =>
      partition?.books.find(({ book_key }) => book_key === `model:${uid}`)?.offers[0];
    const imageTerms = offer(image.uid)?.terms ?? [];
    const binding = (key: string) => {
      const term = imageTerms.find(({ term_key }) => term_key === key);
      return term?.kind === "rate" ? term.variants[0]?.charge_binding : undefined;
    };
    expect(binding("input_text")).toMatchObject({
      signal: { namespace: "kmodels", value: "uncached_input_tokens" },
      quantity_methods: [
        {
          input_sources: [
            expect.objectContaining({
              locator: {
                kind: "json_pointer",
                value: "/usage/input_tokens_details/text_tokens",
              },
            }),
          ],
        },
      ],
    });
    expect(binding("input_image")?.signal).toMatchObject({ value: "input_image_tokens" });
    expect(binding("output_image")?.signal).toMatchObject({ value: "output_image_tokens" });
    expect(binding("image_generation")?.signal).toEqual({
      namespace: "kmodels",
      value: "generated_images",
    });
    const generation = imageTerms.find(({ term_key }) => term_key === "image_generation");
    expect(generation?.kind === "rate" ? generation.variants[0]?.selector_sources : []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dimension: { namespace: "kmodels", value: "quality" },
          locator: { kind: "json_pointer", value: "/quality" },
        }),
        expect.objectContaining({
          dimension: { namespace: "kmodels", value: "resolution" },
          locator: { kind: "json_pointer", value: "/size" },
        }),
      ]),
    );
    expect(offer(transcription.uid)?.terms[0]).toMatchObject({
      kind: "rate",
      variants: [
        expect.objectContaining({
          charge_binding: expect.objectContaining({
            signal: { namespace: "kmodels", value: "processed_audio_seconds" },
            quantity_methods: expect.any(Array),
          }),
        }),
      ],
    });
    expect(offer(embedding.uid)?.terms[0]).toMatchObject({
      kind: "rate",
      variants: [
        expect.objectContaining({
          charge_binding: expect.objectContaining({
            signal: { namespace: "kmodels", value: "input_tokens" },
            quantity_methods: expect.any(Array),
          }),
        }),
      ],
    });
    expect(offer(video.uid)?.terms[0]).toMatchObject({
      kind: "rate",
      variants: [
        expect.objectContaining({
          charge_binding: expect.objectContaining({
            aggregation: "result_item",
            signal: { namespace: "kmodels", value: "generated_seconds" },
            quantity_methods: expect.any(Array),
          }),
        }),
      ],
    });
  });

  it("separates Gemini execution from provider-native grounding", () => {
    const { source: pricingSource } = pricingManifest();
    const gemini: ParsedProviderModel = {
      ...model(),
      pricing_inputs: [
        geminiPricingInput(
          "generate.prompt.text",
          "response",
          "GenerateContentResponse.usageMetadata.promptTokensDetails[modality=TEXT].tokenCount",
        ),
        geminiPricingInput(
          "generate.cache.text",
          "response",
          "GenerateContentResponse.usageMetadata.cacheTokensDetails[modality=TEXT].tokenCount",
        ),
        geminiPricingInput(
          "generate.service_tier",
          "response",
          "GenerateContentResponse.usageMetadata.serviceTier",
        ),
        geminiPricingInput(
          "generate.prompt.text",
          "result",
          "GenerateContentBatch.output.inlinedResponses.inlinedResponses[*].response.usageMetadata.promptTokensDetails[modality=TEXT].tokenCount",
        ),
        geminiPricingInput(
          "generate.cache.text",
          "result",
          "GenerateContentBatch.output.inlinedResponses.inlinedResponses[*].response.usageMetadata.cacheTokensDetails[modality=TEXT].tokenCount",
        ),
        geminiPricingInput(
          "interaction.grounding.google_search",
          "response",
          "Interaction.usage.grounding_tool_count[type=google_search].count",
        ),
      ],
      price_facts: [
        tokenRate("2", { service_tier: "standard" }),
        tokenRate("4", { service_tier: "priority" }),
        tokenRate("1", { service_tier: "batch" }),
      ],
      commercial_facts: [
        {
          book_key: "service:google-search",
          book_name: "Grounding with Google Search",
          resource_kind: "service",
          resource_key: "google-search",
          model_refs: [modelRef],
          offer_key: `grounding:${modelRef}`,
          offer_name: "Search grounding for Test model",
          billing_mode: "usage",
          pricing_state: "numeric",
          price_facts: [
            {
              meter: "web_search",
              price: "14",
              currency: "USD",
              unit: "thousand_search_units",
              conditions: { operation: "google_search" },
              source_ref: sourceRef,
              derived: false,
              raw_price: "$14",
              raw_unit: "1,000 search queries",
            },
          ],
          raw_price_facts: [],
          source_ref: sourceRef,
        },
      ],
    };
    const partition = assembleParsedProviderPricing(
      "gemini",
      observedAt,
      [{ source: pricingSource, models: [gemini] }],
      [gemini],
    );
    const books = partition?.books ?? [];
    const modelBook = books.find(({ book_key }) => book_key === `model:${modelRef}`);
    const sync = modelBook?.offers.find(({ offer_key }) => offer_key === "sync");
    const batch = modelBook?.offers.find(({ offer_key }) => offer_key === "batch");
    const syncInput = sync?.terms.find(({ term_key }) => term_key === "input_text");
    const batchInput = batch?.terms.find(({ term_key }) => term_key === "input_text");
    expect(modelBook?.offers.map(({ offer_key }) => offer_key).sort()).toEqual(["batch", "sync"]);
    expect(
      syncInput?.kind === "rate"
        ? syncInput.variants.map(({ applicability, charge_binding }) => ({
            aggregation: charge_binding?.aggregation,
            tier: applicability.any_of[0]?.all_of.find(
              ({ dimension }) => dimension.value === "served_service_tier",
            ),
          }))
        : [],
    ).toEqual(
      expect.arrayContaining([
        {
          aggregation: "request",
          tier: expect.objectContaining({
            kind: "categorical",
            values: [expect.objectContaining({ value: "standard" })],
          }),
        },
        {
          aggregation: "request",
          tier: expect.objectContaining({
            kind: "categorical",
            values: [expect.objectContaining({ value: "priority" })],
          }),
        },
      ]),
    );
    expect(batchInput?.kind === "rate" ? batchInput.variants[0] : undefined).toMatchObject({
      applicability: { any_of: [{ all_of: [] }] },
      charge_binding: {
        aggregation: "result_item",
        quantity_methods: [
          expect.objectContaining({
            calculation: expect.objectContaining({
              nodes: expect.arrayContaining([
                expect.objectContaining({ op: "subtract_floor_zero" }),
              ]),
            }),
            input_sources: expect.arrayContaining([expect.objectContaining({ channel: "result" })]),
          }),
        ],
        signal: {
          namespace: "provider",
          provider_id: "gemini",
          value: "uncached_input_text_tokens",
        },
      },
    });
    expect(sync?.settlement).toEqual([]);

    const syncRef = pricingOfferId(pricingBookId("gemini", `model:${modelRef}`), "sync");
    const search = books.find(({ book_key }) => book_key === "service:google-search");
    const searchOffer = search?.offers[0];
    const searchRate = searchOffer?.terms.find(({ term_key }) => term_key === "web_search");
    expect(
      searchRate?.kind === "rate" ? searchRate.variants[0]?.charge_binding : undefined,
    ).toMatchObject({
      aggregation: "request",
      signal: {
        namespace: "provider",
        provider_id: "gemini",
        value: "search_executed_queries",
      },
    });
    expect(searchOffer?.relations).toEqual([
      expect.objectContaining({
        kind: "compatible_with",
        target: { kind: "offers", offer_refs: [syncRef] },
      }),
    ]);
  });

  it("derives Gemini multimodal and embedding quantities from exact response partitions", () => {
    const { source: pricingSource } = pricingManifest();
    const rate = (
      meter: SourcePriceFact["meter"],
      price: string,
      unit: SourcePriceFact["unit"] = "million_tokens",
      conditions: SourcePriceFact["conditions"] = {},
    ): SourcePriceFact => ({
      meter,
      price,
      currency: "USD",
      unit,
      conditions,
      source_ref: sourceRef,
      derived: false,
    });
    const input = (
      key: string,
      value: string,
      options: Pick<SourcePricingInputFact, "absent_value" | "reduction"> = {},
    ): SourcePricingInputFact => ({
      ...geminiPricingInput(key, "response", value),
      ...options,
    });
    const multimodal: ParsedProviderModel = {
      ...model(),
      tasks: ["text_generation", "image_generation"],
      modalities: { input: ["text", "image", "pdf"], output: ["text", "image"] },
      price_facts: [
        rate("input_image", "2"),
        rate("cache_read_image", "0.2"),
        rate("output_text", "4"),
        rate("output_image", "8"),
        rate("image_generation", "0.04", "image"),
      ],
      pricing_inputs: [
        input(
          "generate.prompt.image",
          "GenerateContentResponse.usageMetadata.promptTokensDetails[modality=IMAGE].tokenCount",
          { absent_value: "zero" },
        ),
        input(
          "generate.prompt.document",
          "GenerateContentResponse.usageMetadata.promptTokensDetails[modality=DOCUMENT].tokenCount",
          { absent_value: "zero" },
        ),
        input(
          "generate.cache.image",
          "GenerateContentResponse.usageMetadata.cacheTokensDetails[modality=IMAGE].tokenCount",
          { absent_value: "zero" },
        ),
        input(
          "generate.cache.document",
          "GenerateContentResponse.usageMetadata.cacheTokensDetails[modality=DOCUMENT].tokenCount",
          { absent_value: "zero" },
        ),
        input(
          "generate.candidates.text",
          "GenerateContentResponse.usageMetadata.candidatesTokensDetails[modality=TEXT].tokenCount",
          { absent_value: "zero" },
        ),
        input(
          "generate.candidates.image",
          "GenerateContentResponse.usageMetadata.candidatesTokensDetails[modality=IMAGE].tokenCount",
          { absent_value: "zero" },
        ),
        input(
          "generate.candidates.total",
          "GenerateContentResponse.usageMetadata.candidatesTokenCount",
        ),
        input("generate.thoughts", "GenerateContentResponse.usageMetadata.thoughtsTokenCount"),
        input(
          "generate.output.images",
          "GenerateContentResponse.candidates[*].content.parts[*].inlineData[mimeType=image/*]",
          { absent_value: "zero", reduction: { kind: "array_length" } },
        ),
      ],
    };
    const embedding: ParsedProviderModel = {
      ...model(),
      uid: "gemini/embed-test",
      model_id: "embed-test",
      name: "Embed Test",
      tasks: ["embeddings"],
      modalities: { input: ["image", "pdf"], output: ["embedding"] },
      price_facts: [rate("input_image", "0.5")],
      pricing_inputs: [
        input(
          "embedding.prompt.image",
          "EmbedContentResponse.usageMetadata.promptTokenDetails[modality=IMAGE].tokenCount",
          { absent_value: "zero" },
        ),
        input(
          "embedding.prompt.document",
          "EmbedContentResponse.usageMetadata.promptTokenDetails[modality=DOCUMENT].tokenCount",
          { absent_value: "zero" },
        ),
      ],
    };
    const video: ParsedProviderModel = {
      ...model(),
      uid: "gemini/video-test",
      model_id: "video-test",
      name: "Video Test",
      tasks: ["video_generation"],
      modalities: { input: ["text", "image"], output: ["video"] },
      price_facts: [rate("video_generation", "0.4", "second", { audio: true, resolution: "720p" })],
      pricing_inputs: [
        {
          ...geminiPricingInput(
            "video.request.duration_seconds",
            "request",
            "GenerateVideosConfig.durationSeconds",
          ),
          availability: "conditional",
        },
        {
          ...geminiPricingInput(
            "video.request.resolution",
            "request",
            "GenerateVideosConfig.resolution",
          ),
          availability: "conditional",
        },
        {
          ...geminiPricingInput(
            "video.request.generate_audio",
            "request",
            "GenerateVideosConfig.generateAudio",
          ),
          availability: "conditional",
        },
      ],
    };
    const partition = assembleParsedProviderPricing(
      "gemini",
      observedAt,
      [{ source: pricingSource, models: [multimodal, embedding, video] }],
      [multimodal, embedding, video],
    );
    const offer = (uid: string) =>
      partition?.books
        .find(({ book_key }) => book_key === `model:${uid}`)
        ?.offers.find(({ offer_key }) => offer_key === "sync");
    const variant = (uid: string, termKey: string) => {
      const term = offer(uid)?.terms.find(({ term_key }) => term_key === termKey);
      return term?.kind === "rate" ? term.variants[0] : undefined;
    };
    const observationKeys = (uid: string, termKey: string) =>
      variant(uid, termKey)?.charge_binding?.observations.flatMap(({ locator }) =>
        locator.kind === "provider_key" && locator.value.startsWith("generate.")
          ? [locator.value]
          : [],
      ) ?? [];

    expect(variant(modelRef, "input_image")?.charge_binding).toMatchObject({
      signal: {
        namespace: "provider",
        provider_id: "gemini",
        value: "uncached_input_image_rate_tokens",
      },
      quantity_methods: [
        {
          calculation: {
            nodes: [
              expect.objectContaining({ op: "signal" }),
              expect.objectContaining({ op: "signal" }),
              { op: "subtract_floor_zero", minuend: 0, subtrahend: 1 },
              expect.objectContaining({ op: "signal" }),
              expect.objectContaining({ op: "signal" }),
              { op: "subtract_floor_zero", minuend: 3, subtrahend: 4 },
              { op: "sum", inputs: [2, 5] },
            ],
            result: 6,
          },
          input_sources: expect.arrayContaining([
            expect.objectContaining({ absent_value: "zero" }),
          ]),
        },
      ],
    });
    expect(observationKeys(modelRef, "output_text")).toEqual([
      "generate.candidates.text",
      "generate.thoughts",
    ]);
    expect(observationKeys(modelRef, "output_image")).toEqual(["generate.candidates.image"]);
    expect(variant(modelRef, "image_generation")?.charge_binding).toMatchObject({
      signal: { namespace: "kmodels", value: "generated_images" },
      quantity_methods: [
        {
          input_sources: [
            expect.objectContaining({
              reduction: { kind: "array_length" },
              absent_value: "zero",
            }),
          ],
        },
      ],
    });
    expect(variant("gemini/embed-test", "input_image")?.charge_binding).toMatchObject({
      signal: {
        namespace: "provider",
        provider_id: "gemini",
        value: "embedding_input_image_rate_tokens",
      },
      quantity_methods: [
        {
          calculation: {
            nodes: [
              expect.objectContaining({ op: "signal" }),
              expect.objectContaining({ op: "signal" }),
              { op: "sum", inputs: [0, 1] },
            ],
            result: 2,
          },
        },
      ],
    });
    expect(variant("gemini/video-test", "video_generation")).toMatchObject({
      charge_binding: {
        signal: { namespace: "kmodels", value: "generated_seconds" },
        aggregation: "result_item",
        quantity_methods: [
          {
            input_sources: [
              expect.objectContaining({
                channel: "request",
                locator: {
                  kind: "provider_field",
                  value: "GenerateVideosConfig.durationSeconds",
                },
              }),
            ],
          },
        ],
      },
      selector_sources: expect.arrayContaining([
        expect.objectContaining({
          dimension: { namespace: "kmodels", value: "resolution" },
          locator: { kind: "provider_field", value: "GenerateVideosConfig.resolution" },
        }),
        expect.objectContaining({
          dimension: { namespace: "kmodels", value: "request_audio" },
          locator: { kind: "provider_field", value: "GenerateVideosConfig.generateAudio" },
        }),
      ]),
    });
  });

  it("separates Vertex execution mechanisms and keeps only request-attributable resources", () => {
    const { source } = pricingManifest();
    const googleSource: SourceManifest = {
      ...source,
      id: "vertex-google-models",
      fields: [...source.fields, "pricing_inputs"],
    };
    const partnerSource = { ...source, id: "vertex-partner-models" };
    const rate = (
      meter: SourcePriceFact["meter"],
      price: string,
      conditions: SourcePriceFact["conditions"],
      source_ref: string,
      unit: SourcePriceFact["unit"] = "million_tokens",
    ): SourcePriceFact => ({
      meter,
      price,
      currency: "USD",
      unit,
      conditions,
      source_ref,
      derived: false,
    });
    const input = (
      key: string,
      channel: SourcePricingInputFact["channel"],
      value: string,
      options: Pick<SourcePricingInputFact, "absent_value" | "reduction"> = {},
    ): SourcePricingInputFact => ({
      key,
      channel,
      locator: { kind: "provider_field", value },
      availability: channel === "result" ? "success_only" : "terminal_only",
      source_ref: googleSource.id,
      ...options,
    });
    const google: ParsedProviderModel = {
      ...model(),
      provider_id: "vertex",
      uid: "vertex/gemini-test",
      model_id: "gemini-test",
      source_refs: [googleSource.id],
      service_families: ["publishers/google"],
      price_facts: [
        rate("input_text", "2", { service_tier: "standard" }, googleSource.id),
        rate("input_text", "4", { service_tier: "priority" }, googleSource.id),
        rate("input_text", "1", { service_tier: "batch" }, googleSource.id),
      ],
      pricing_inputs: [
        input("generate.prompt.text", "response", "response.prompt.text"),
        input("generate.cache.text", "response", "response.cache.text", {
          absent_value: "zero",
        }),
        input("generate.tool_prompt.text", "response", "response.toolPrompt.text", {
          absent_value: "zero",
        }),
        input("generate.service_tier", "response", "response.trafficType"),
        input("generate.prompt.text", "result", "result.prompt.text"),
        input("generate.cache.text", "result", "result.cache.text", {
          absent_value: "zero",
        }),
        input("generate.tool_prompt.text", "result", "result.toolPrompt.text", {
          absent_value: "zero",
        }),
        input("claude.input_tokens", "response", "response.usage.input_tokens"),
        input(
          "generate.grounding.google_image_search_queries",
          "response",
          "response.imageSearchQueries",
          { reduction: { kind: "count_unique_non_empty_strings" }, absent_value: "zero" },
        ),
      ],
      commercial_facts: [
        {
          source_ref: googleSource.id,
          book_key: "service:google-image-search",
          book_name: "Grounding with Google Image Search",
          resource_kind: "service",
          resource_key: "google-image-search",
          model_refs: ["vertex/gemini-test"],
          offer_key: "usage:vertex/gemini-test",
          offer_name: "Image Search for gemini-test",
          billing_mode: "usage",
          pricing_state: "numeric",
          price_facts: [
            rate(
              "image_search",
              "14",
              { operation: "google_image_search" },
              googleSource.id,
              "thousand_search_units",
            ),
          ],
          raw_price_facts: [],
        },
        {
          source_ref: googleSource.id,
          book_key: "service:explicit-cache-storage",
          book_name: "Explicit context cache storage",
          resource_kind: "service",
          resource_key: "explicit-cache-storage",
          model_refs: ["vertex/gemini-test"],
          offer_key: "storage:vertex/gemini-test",
          offer_name: "Explicit cache storage for gemini-test",
          billing_mode: "usage",
          pricing_state: "numeric",
          price_facts: [rate("cache_storage", "1", {}, googleSource.id, "million_tokens_per_hour")],
          raw_price_facts: [],
        },
        {
          source_ref: googleSource.id,
          book_key: "capacity:provisioned-throughput",
          book_name: "Provisioned Throughput",
          resource_kind: "capacity",
          resource_key: "provisioned-throughput",
          model_refs: [],
          offer_key: "commitment",
          offer_name: "Provisioned Throughput commitment",
          billing_mode: "capacity",
          pricing_state: "numeric",
          price_facts: [
            rate(
              "provisioned_throughput",
              "1200",
              { deployment_scope: "global", billing_period: "1_week_commit" },
              googleSource.id,
              "unit_week",
            ),
          ],
          raw_price_facts: [],
        },
        {
          source_ref: googleSource.id,
          book_key: "service:model-tuning",
          book_name: "Model Tuning",
          resource_kind: "service",
          resource_key: "model-tuning",
          model_refs: ["vertex/gemini-test"],
          offer_key: "training:vertex/gemini-test:supervised_fine_tuning",
          offer_name: "Supervised fine-tuning for gemini-test",
          billing_mode: "usage",
          pricing_state: "numeric",
          price_facts: [
            rate("training_input", "10", { operation: "supervised_fine_tuning" }, googleSource.id),
          ],
          raw_price_facts: [],
        },
        {
          source_ref: googleSource.id,
          book_key: "service:agent:gemini-deep-research-agent",
          book_name: "Gemini Deep Research Agent",
          resource_kind: "service",
          resource_key: "agent:gemini-deep-research-agent",
          model_refs: [],
          offer_key: "execution",
          offer_name: "Gemini Deep Research Agent execution",
          billing_mode: "usage",
          pricing_state: "numeric",
          price_facts: [
            rate("input_text", "2", { operation: "gemini-deep-research-agent" }, googleSource.id),
          ],
          raw_price_facts: [],
        },
        {
          source_ref: googleSource.id,
          book_key: "service:google-search",
          book_name: "Grounding with Google Search",
          resource_kind: "service",
          resource_key: "google-search",
          model_refs: [],
          offer_key: "agent:gemini-deep-research-agent",
          offer_name: "Google Search for Gemini Deep Research Agent",
          billing_mode: "usage",
          pricing_state: "numeric",
          price_facts: [
            rate(
              "web_search",
              "14",
              { operation: "google_search" },
              googleSource.id,
              "thousand_search_units",
            ),
          ],
          raw_price_facts: [],
        },
        {
          source_ref: googleSource.id,
          book_key: "service:codemender",
          book_name: "CodeMender",
          resource_kind: "service",
          resource_key: "codemender",
          model_refs: ["vertex/gemini-test"],
          offer_key: "codemender:vertex/gemini-test",
          offer_name: "CodeMender with gemini-test",
          billing_mode: "usage",
          pricing_state: "numeric",
          price_facts: [rate("input_text", "1", { operation: "codemender" }, googleSource.id)],
          raw_price_facts: [],
        },
        {
          source_ref: googleSource.id,
          book_key: "service:agent-search",
          book_name: "Agent Search",
          resource_kind: "service",
          resource_key: "agent-search",
          model_refs: [],
          offer_key: "general-standard",
          offer_name: "General Standard Edition",
          billing_mode: "usage",
          pricing_state: "numeric",
          price_facts: [
            rate(
              "retrieval",
              "1.5",
              { operation: "general_standard" },
              googleSource.id,
              "thousand_requests",
            ),
          ],
          raw_price_facts: [],
        },
      ],
    };
    const partner: ParsedProviderModel = {
      ...model(),
      provider_id: "vertex",
      uid: "vertex/claude-test",
      model_id: "claude-test",
      source_refs: [partnerSource.id],
      service_families: ["publishers/anthropic"],
      price_facts: [rate("input_text", "3", {}, partnerSource.id)],
      commercial_facts: [
        {
          source_ref: partnerSource.id,
          book_key: "service:claude-web-search",
          book_name: "Claude Web Search",
          resource_kind: "service",
          resource_key: "claude-web-search",
          model_refs: ["vertex/claude-test"],
          offer_key: "usage:vertex/claude-test",
          offer_name: "Claude Web Search for claude-test",
          billing_mode: "usage",
          pricing_state: "numeric",
          price_facts: [
            rate(
              "web_search",
              "10",
              { operation: "web_search" },
              partnerSource.id,
              "thousand_search_units",
            ),
          ],
          raw_price_facts: [],
        },
      ],
    };
    const partition = assembleParsedProviderPricing(
      "vertex",
      observedAt,
      [
        { source: googleSource, models: [google] },
        { source: partnerSource, models: [partner] },
      ],
      [google, partner],
    );
    const books = partition?.books ?? [];
    const googleBook = books.find(({ book_key }) => book_key === "model:vertex/gemini-test");
    const sync = googleBook?.offers.find(({ offer_key }) => offer_key === "sync");
    const batch = googleBook?.offers.find(({ offer_key }) => offer_key === "batch");
    expect(googleBook?.offers.map(({ offer_key }) => offer_key).sort()).toEqual(["batch", "sync"]);
    expect(
      sync?.terms[0]?.kind === "rate"
        ? sync.terms[0].variants.map(({ applicability, charge_binding }) => ({
            aggregation: charge_binding?.aggregation,
            signal: charge_binding?.signal.value,
            tier: applicability.any_of[0]?.all_of.find(
              ({ dimension }) => dimension.value === "served_service_tier",
            ),
          }))
        : [],
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          aggregation: "request",
          signal: "uncached_input_text_tokens",
          tier: expect.objectContaining({
            values: [expect.objectContaining({ value: "priority" })],
          }),
        }),
      ]),
    );
    expect(batch?.terms[0]).toMatchObject({
      kind: "rate",
      variants: [
        expect.objectContaining({
          applicability: { any_of: [{ all_of: [] }] },
          charge_binding: expect.objectContaining({
            aggregation: "result_item",
            quantity_methods: [
              expect.objectContaining({
                input_sources: expect.arrayContaining([
                  expect.objectContaining({ channel: "result" }),
                ]),
              }),
            ],
          }),
        }),
      ],
    });
    const priority =
      sync?.terms[0]?.kind === "rate"
        ? sync.terms[0].variants.find(({ applicability }) =>
            applicability.any_of.some(({ all_of }) =>
              all_of.some(
                (condition) =>
                  condition.kind === "categorical" &&
                  condition.values.some(({ value }) => value === "priority"),
              ),
            ),
          )
        : undefined;
    expect(priority).toMatchObject({
      charge_binding: {
        quantity_methods: [
          expect.objectContaining({
            calculation: expect.objectContaining({
              nodes: expect.arrayContaining([
                expect.objectContaining({ op: "subtract_floor_zero" }),
              ]),
            }),
          }),
        ],
      },
      selector_sources: [
        expect.objectContaining({
          dimension: { namespace: "kmodels", value: "served_service_tier" },
          normalization: {
            kind: "categorical_map",
            entries: expect.arrayContaining([
              expect.objectContaining({ source_value: "ON_DEMAND_PRIORITY" }),
            ]),
          },
        }),
      ],
    });
    expect(sync?.settlement).toEqual([]);

    const partnerOffer = books
      .find(({ book_key }) => book_key === "model:vertex/claude-test")
      ?.offers.find(({ offer_key }) => offer_key === "sync");
    expect(partnerOffer?.settlement).toEqual([]);
    expect(partnerOffer?.terms[0]).toMatchObject({
      kind: "rate",
      variants: [
        expect.objectContaining({
          charge_binding: expect.objectContaining({
            signal: expect.objectContaining({ value: "claude_input_tokens" }),
            quantity_methods: [
              expect.objectContaining({
                input_sources: expect.arrayContaining([
                  expect.objectContaining({
                    locator: {
                      kind: "provider_field",
                      value: "response.usage.input_tokens",
                    },
                  }),
                ]),
              }),
            ],
          }),
        }),
      ],
    });

    const imageSearch = books.find(({ book_key }) => book_key === "service:google-image-search");
    expect(imageSearch?.offers[0]).toMatchObject({
      relations: [],
      terms: [
        expect.objectContaining({
          kind: "rate",
          meter: { namespace: "kmodels", value: "image_search" },
          variants: [
            expect.objectContaining({
              charge_binding: expect.objectContaining({
                signal: expect.objectContaining({
                  value: "google_image_search_queries",
                }),
                quantity_methods: [
                  expect.objectContaining({
                    input_sources: [
                      expect.objectContaining({
                        reduction: { kind: "count_unique_non_empty_strings" },
                      }),
                    ],
                  }),
                ],
              }),
            }),
          ],
        }),
      ],
    });
    expect(books.some(({ book_key }) => book_key === "service:explicit-cache-storage")).toBe(false);
    expect(
      books.find(({ book_key }) => book_key === "service:claude-web-search")?.offers[0]?.terms[0],
    ).toMatchObject({
      kind: "rate",
      meter: { namespace: "kmodels", value: "web_search" },
      variants: [
        expect.objectContaining({
          charge_binding: expect.objectContaining({
            signal: expect.objectContaining({
              value: "claude_web_search_requests",
            }),
          }),
        }),
      ],
    });
    for (const bookKey of [
      "capacity:provisioned-throughput",
      "service:model-tuning",
      "service:agent:gemini-deep-research-agent",
      "service:codemender",
      "service:agent-search",
    ])
      expect(books.some(({ book_key }) => book_key === bookKey)).toBe(false);
  });

  it("binds Vertex partner, media, and Maps rates only to documented quantities", () => {
    const { source: baseSource } = pricingManifest();
    const pricingSource: SourceManifest = {
      ...baseSource,
      id: "vertex-pricing-test",
      fields: [...baseSource.fields, "pricing_inputs"],
    };
    const rate = (
      meter: SourcePriceFact["meter"],
      unit: SourcePriceFact["unit"],
      conditions: SourcePriceFact["conditions"] = {},
    ): SourcePriceFact => ({
      meter,
      price: "1",
      currency: "USD",
      unit,
      conditions,
      source_ref: pricingSource.id,
      derived: false,
    });
    const input = (
      key: string,
      channel: SourcePricingInputFact["channel"],
      value: string,
      options: Pick<SourcePricingInputFact, "absent_value" | "reduction"> = {},
    ): SourcePricingInputFact => ({
      key,
      channel,
      locator: { kind: "provider_field", value },
      availability: channel === "request" ? "conditional" : "terminal_only",
      source_ref: pricingSource.id,
      ...options,
    });
    const vertexModel = (
      id: string,
      tasks: ParsedProviderModel["tasks"],
      family: string,
      price_facts: SourcePriceFact[],
    ): ParsedProviderModel => ({
      ...model(),
      provider_id: "vertex",
      uid: `vertex/${id}`,
      model_id: id,
      name: id,
      tasks,
      service_families: [family],
      price_facts,
      source_refs: [pricingSource.id],
    });
    const xai = vertexModel("grok-test", ["text_generation"], "publishers/xai", [
      rate("input_text", "million_tokens", { service_tier: "priority" }),
      rate("cache_read_text", "million_tokens"),
      rate("output_text", "million_tokens"),
    ]);
    xai.pricing_inputs = [
      input("responses.input_tokens", "response", "Response.usage.input_tokens"),
      input(
        "responses.cached_input_tokens",
        "response",
        "Response.usage.input_tokens_details.cached_tokens",
        { absent_value: "zero" },
      ),
      input("responses.output_tokens", "response", "Response.usage.output_tokens"),
      input(
        "responses.served_service_tier",
        "response",
        "Response.usage.extra_properties.google.traffic_type",
      ),
      input("chat.input_tokens", "response", "ChatCompletion.usage.prompt_tokens"),
      input("chat.output_tokens", "response", "ChatCompletion.usage.completion_tokens"),
      input("imagen.response.images", "response", "PredictResponse.predictions", {
        reduction: { kind: "array_length" },
        absent_value: "zero",
      }),
      input("imagen.request.resolution", "request", "parameters.sampleImageSize"),
      input("video.request.duration_seconds", "request", "parameters.durationSeconds"),
      input("video.request.resolution", "request", "parameters.resolution"),
      input("video.request.generate_audio", "request", "parameters.generateAudio"),
      input("video.result.videos", "result", "Operation.response.videos", {
        reduction: { kind: "array_length" },
        absent_value: "zero",
      }),
      input(
        "generate.grounding.google_maps_result",
        "response",
        "GenerateContentResponse.groundingChunks.maps.placeId",
        { reduction: { kind: "presence" }, absent_value: "zero" },
      ),
    ];
    const chat = vertexModel("open-test", ["text_generation"], "endpoints/openapi/openai", [
      rate("input_text", "million_tokens"),
    ]);
    const image = vertexModel("imagen-test", ["image_generation"], "publishers/google", [
      rate("image_generation", "image", { resolution: "2k" }),
    ]);
    const video = vertexModel("veo-test", ["video_generation"], "publishers/google", [
      rate("video_generation", "second", { resolution: "1080p", audio: true }),
    ]);
    image.commercial_facts = [
      {
        source_ref: pricingSource.id,
        book_key: "service:google-maps",
        book_name: "Grounding with Google Maps",
        resource_kind: "service",
        resource_key: "google-maps",
        model_refs: [image.uid],
        offer_key: `request:${image.uid}`,
        offer_name: "Maps grounding",
        billing_mode: "usage",
        pricing_state: "numeric",
        price_facts: [
          rate("maps_search", "thousand_search_units", { operation: "query" }),
          rate("maps_search", "thousand_requests", { operation: "grounded_prompt" }),
        ],
        raw_price_facts: [],
      },
    ];
    const models = [xai, chat, image, video];
    const pricing = assembleParsedProviderPricing(
      "vertex",
      observedAt,
      [{ source: pricingSource, models }],
      models,
    );
    const modelVariant = (id: string, meter: string) => {
      const term = pricing?.books
        .find(({ book_key }) => book_key === `model:vertex/${id}`)
        ?.offers.find(({ offer_key }) => offer_key === "sync")
        ?.terms.find(
          (candidate) =>
            candidate.kind === "rate" &&
            candidate.meter.namespace === "kmodels" &&
            candidate.meter.value === meter,
        );
      return term?.kind === "rate" ? term.variants[0] : undefined;
    };

    expect(modelVariant("grok-test", "input_text")).toMatchObject({
      charge_binding: {
        signal: expect.objectContaining({ value: "responses_uncached_input_tokens" }),
        quantity_methods: [
          expect.objectContaining({
            calculation: {
              nodes: [
                expect.objectContaining({ op: "signal" }),
                expect.objectContaining({ op: "signal" }),
                { op: "subtract_floor_zero", minuend: 0, subtrahend: 1 },
              ],
              result: 2,
            },
          }),
        ],
      },
      selector_sources: [
        expect.objectContaining({
          normalization: expect.objectContaining({
            entries: expect.arrayContaining([
              expect.objectContaining({ source_value: "ON_DEMAND_PRIORITY" }),
            ]),
          }),
        }),
      ],
    });
    expect(modelVariant("open-test", "input_text")?.charge_binding).toMatchObject({
      signal: expect.objectContaining({ value: "chat_input_tokens" }),
      quantity_methods: [expect.objectContaining({ input_sources: [expect.any(Object)] })],
    });
    expect(modelVariant("imagen-test", "image_generation")).toMatchObject({
      charge_binding: {
        signal: { namespace: "kmodels", value: "generated_images" },
        quantity_methods: [
          expect.objectContaining({
            input_sources: [expect.objectContaining({ reduction: { kind: "array_length" } })],
          }),
        ],
      },
      selector_sources: [
        expect.objectContaining({
          dimension: { namespace: "kmodels", value: "resolution" },
          channel: "request",
        }),
      ],
    });
    expect(modelVariant("veo-test", "video_generation")).toMatchObject({
      charge_binding: {
        signal: { namespace: "kmodels", value: "generated_seconds" },
        aggregation: "job",
        quantity_methods: [
          expect.objectContaining({
            calculation: {
              nodes: [
                expect.objectContaining({ op: "signal" }),
                expect.objectContaining({ op: "signal" }),
                { op: "product", inputs: [0, 1] },
              ],
              result: 2,
            },
          }),
        ],
      },
      selector_sources: expect.arrayContaining([
        expect.objectContaining({
          dimension: { namespace: "kmodels", value: "resolution" },
        }),
        expect.objectContaining({
          dimension: { namespace: "kmodels", value: "request_audio" },
        }),
      ]),
    });
    const mapVariants = pricing?.books
      .find(({ book_key }) => book_key === "service:google-maps")
      ?.offers.flatMap(({ terms }) =>
        terms.flatMap((term) => (term.kind === "rate" ? term.variants : [])),
      );
    const mapVariant = (unit: string) =>
      mapVariants?.find(({ price }) => price.per.factors[0]?.unit.value === unit);
    expect(mapVariant("request")?.charge_binding).toMatchObject({
      quantity_methods: [
        expect.objectContaining({
          input_sources: [expect.objectContaining({ reduction: { kind: "presence" } })],
        }),
      ],
    });
    expect(mapVariant("search_unit")?.charge_binding).not.toHaveProperty("quantity_methods");
    if (pricing === undefined) throw new Error("Vertex pricing partition was not assembled");
    const vertex = manifests.find(({ provider }) => provider.id === "vertex");
    if (vertex === undefined) throw new Error("Vertex manifest is missing");
    expect(() =>
      validatePricingCatalog(
        {
          provider_vocabularies: [pricing.vocabulary],
          provider_snapshots: [pricing.snapshot],
          model_dispositions: pricing.model_dispositions,
          books: pricing.books,
        },
        {
          providers: [{ ...vertex.provider, source_ids: [pricingSource.id] }],
          models,
          sources: [{ ...source(), id: pricingSource.id, provider_id: "vertex", scope: "global" }],
        },
      ),
    ).not.toThrow();
  });

  it("keeps Bedrock request-priced execution and Nova grounding", () => {
    const { source: pricingSource } = pricingManifest();
    const bedrock: ParsedProviderModel = {
      ...model(),
      provider_id: "amazon-bedrock",
      uid: "amazon-bedrock/test-model",
      api_endpoints: [{ name: "Converse", path: "model/{modelId}/converse" }],
      price_facts: [
        tokenRate("1", { region: "us-east-1", service_tier: "standard" }),
        tokenRate("2", { region: "us-east-1", service_tier: "priority" }),
        tokenRate("0.5", { region: "us-east-1", service_tier: "batch" }),
        {
          meter: "provisioned_throughput",
          price: "3",
          currency: "USD",
          unit: "thousand_tokens_per_minute_hour",
          conditions: {
            region: "us-east-1",
            service_tier: "reserved_1_month",
            capacity: "input_tokens_per_minute",
          },
          source_ref: sourceRef,
          derived: false,
          raw_price: "3",
          raw_unit: "1K TPM Hour",
        },
        {
          meter: "tool_call",
          price: "0.03",
          currency: "USD",
          unit: "request",
          conditions: { region: "us-east-1", operation: "grounding" },
          source_ref: sourceRef,
          derived: false,
          raw_price: "0.03",
          raw_unit: "Requests",
        },
      ],
      pricing_inputs: [
        bedrockPricingInput(
          "runtime.converse.uncached_input_tokens",
          "response",
          "/usage/inputTokens",
        ),
        bedrockPricingInput(
          "batch.manifest.input_tokens",
          "result",
          "manifest.json.out.inputTokenCount",
        ),
        bedrockPricingInput(
          "runtime.invocation_log.input_tokens",
          "invocation_log",
          "/input/inputTokenCount",
          "reconciliation_only",
        ),
        bedrockPricingInput(
          "runtime.invocation_log.selector.region",
          "invocation_log",
          "/region",
          "reconciliation_only",
        ),
        bedrockPricingInput(
          "runtime.converse.selector.service_tier",
          "response",
          "/serviceTier/type",
        ),
      ],
    };
    const partition = assembleParsedProviderPricing(
      "amazon-bedrock",
      observedAt,
      [{ source: pricingSource, models: [bedrock] }],
      [bedrock],
    );
    const books = partition?.books ?? [];
    const modelBook = books.find(({ scope }) => scope.kind === "models");
    expect(modelBook?.offers.map(({ offer_key }) => offer_key).sort()).toEqual([
      "batch",
      "on-demand",
    ]);
    for (const offer of modelBook?.offers ?? []) {
      const input = offer.terms.find(({ term_key }) => term_key === "input_text");
      if (input?.kind !== "rate") throw new Error("Missing Bedrock input rate");
      expect(input.variants[0]?.charge_binding).toMatchObject({
        aggregation: offer.offer_key === "batch" ? "job" : "attempt",
        signal: {
          namespace: "kmodels",
          value: "input_tokens",
        },
        quantity_methods: [
          {
            input_sources: expect.arrayContaining([
              expect.objectContaining({
                channel: offer.offer_key === "batch" ? "result" : "response",
              }),
            ]),
          },
        ],
      });
      if (offer.offer_key === "on-demand")
        expect(input.variants[0]?.selector_sources).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              dimension: { namespace: "kmodels", value: "region" },
              channel: "invocation_log",
            }),
            expect.objectContaining({
              dimension: { namespace: "kmodels", value: "service_tier" },
              normalization: {
                kind: "categorical_map",
                entries: [
                  {
                    source_value:
                      input.variants[0]?.applicability.any_of[0]?.all_of.some(
                        (condition) =>
                          condition.kind === "categorical" &&
                          condition.dimension.value === "service_tier" &&
                          condition.values.some(({ value }) => value === "priority"),
                      ) === true
                        ? "priority"
                        : "default",
                    value: expect.any(Object),
                  },
                ],
              },
            }),
          ]),
        );
      const tiers = input.variants.flatMap(({ applicability }) =>
        applicability.any_of.flatMap(({ all_of }) =>
          all_of.flatMap((condition) =>
            condition.kind === "categorical" && condition.dimension.value === "service_tier"
              ? condition.values.map(({ value }) => value)
              : [],
          ),
        ),
      );
      expect(tiers.sort()).toEqual(offer.offer_key === "batch" ? [] : ["priority", "standard"]);
      expect(input.raw_variants).toEqual([]);
    }

    const capacity = books.find(
      ({ scope }) =>
        scope.kind === "provider_resource" &&
        scope.resource_kind.value === "capacity" &&
        scope.resource_key === "model-capacity:amazon-bedrock/test-model",
    );
    expect(capacity).toBeUndefined();

    const grounding = books.find(
      ({ scope }) =>
        scope.kind === "provider_resource" &&
        scope.resource_key === "nova-web-grounding:amazon-bedrock/test-model",
    );
    expect(grounding?.offers[0]?.terms[0]).toMatchObject({
      kind: "rate",
      meter: { namespace: "kmodels", value: "web_search" },
      variants: [
        expect.objectContaining({
          charge_binding: expect.objectContaining({
            signal: {
              namespace: "provider",
              provider_id: "amazon-bedrock",
              value: "nova_web_grounding_requests",
            },
          }),
        }),
      ],
    });
    expect(grounding?.offers[0]?.relations).toEqual([]);
    expect(
      modelBook?.offers
        .flatMap(({ terms }) => terms)
        .some(({ term_key }) => term_key.startsWith("tool_call")),
    ).toBe(false);
  });

  it("publishes only Bedrock services attributable to an upstream request", () => {
    const { source: pricingSource } = pricingManifest();
    const commercial = (
      resourceKey: string,
      termKey: string,
      amount: string,
      unit: string,
      attributes: Record<string, string>,
    ): SourceCommercialPricingFact => ({
      source_ref: sourceRef,
      book_key: `service:${resourceKey}`,
      book_name: resourceKey,
      resource_kind: "service",
      resource_key: resourceKey,
      model_refs: [],
      offer_key: "usage",
      offer_name: "Usage",
      billing_mode: "usage",
      pricing_state: "numeric",
      price_facts: [],
      raw_price_facts: [
        {
          term_key: termKey,
          impact: "base_price",
          reason: "unsupported_structure",
          conditions: { region: "us-east-1" },
          source_ref: sourceRef,
          raw: {
            amount,
            denomination: "USD",
            unit,
            fragment: unit === "TextUnit" ? "$0.15 per 1K text units" : `$${amount} per ${unit}`,
            conditions: Object.entries(attributes).map(([dimension, value]) => ({
              dimension,
              value,
            })),
          },
        },
      ],
    });
    const bedrock: ParsedProviderModel = {
      ...model(),
      provider_id: "amazon-bedrock",
      uid: "amazon-bedrock/test-model",
      price_facts: [tokenRate("1", {})],
      commercial_facts: [
        commercial("guardrails", "content", "0.15", "TextUnit", {
          operation: "ApplyGuardrail",
          policyType: "Content",
        }),
        commercial("web-search", "queries", "0.01", "Queries", {
          usagetype: "USE1-Bedrock-Websearch-Queries",
        }),
        commercial("prompt-routing", "requests", "0.001", "Requests", {
          feature: "Prompt Router",
        }),
        commercial("agentcore-browser", "cpu", "0.0895", "vCPU-Hours", {}),
        commercial("model-evaluation", "completed-task", "0.21", "Evaluations", {}),
      ],
      pricing_inputs: [
        bedrockPricingInput(
          "guardrails.apply.contentPolicyUnits",
          "response",
          "/usage/contentPolicyUnits",
        ),
      ],
    };
    const partition = assembleParsedProviderPricing(
      "amazon-bedrock",
      observedAt,
      [{ source: pricingSource, models: [bedrock] }],
      [bedrock],
    );
    const resources = (partition?.books ?? []).filter(
      ({ scope }) => scope.kind === "provider_resource",
    );
    expect(
      resources.map(({ scope }) => (scope.kind === "provider_resource" ? scope.resource_key : "")),
    ).toEqual(["guardrails", "web-search", "prompt-routing"]);

    const guardrail = resources.find(
      ({ scope }) => scope.kind === "provider_resource" && scope.resource_key === "guardrails",
    )?.offers[0]?.terms[0];
    expect(guardrail).toMatchObject({
      kind: "rate",
      meter: { namespace: "kmodels", value: "content_safety" },
      variants: [
        expect.objectContaining({
          price: expect.objectContaining({
            value: { numerator: "3", denominator: "20000" },
            denomination: { kind: "fiat", currency: "USD" },
          }),
          charge_binding: expect.objectContaining({
            aggregation: "request",
            signal: expect.objectContaining({ value: "guardrail_content_policy_units" }),
            quantity_methods: [
              {
                input_sources: [
                  expect.objectContaining({
                    channel: "response",
                    locator: { kind: "json_pointer", value: "/usage/contentPolicyUnits" },
                  }),
                ],
              },
            ],
          }),
        }),
      ],
    });

    for (const resourceKey of ["web-search", "prompt-routing"]) {
      const term = resources.find(
        ({ scope }) => scope.kind === "provider_resource" && scope.resource_key === resourceKey,
      )?.offers[0]?.terms[0];
      expect(term).toMatchObject({
        kind: "rate",
        variants: [
          expect.objectContaining({
            charge_binding: expect.objectContaining({ aggregation: "request" }),
          }),
        ],
      });
    }

    expect(
      resources.find(
        ({ scope }) => scope.kind === "provider_resource" && scope.resource_key === "guardrails",
      )?.scope,
    ).toMatchObject({ kind: "provider_resource", model_refs: [] });
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
    const book = partition?.books[0];
    const conditions = (offerKey: string, amount: string) => {
      const term = book?.offers.find(({ offer_key }) => offer_key === offerKey)?.terms[0];
      if (term?.kind !== "rate") throw new Error("Input rate term was not assembled");
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
    expect(conditions("batch", "0.5")).toEqual({
      speed: "standard",
      inference_geo: "global",
    });
    expect(conditions("sync", "2")).toEqual({
      service_tier: "standard",
      speed: "fast",
      inference_geo: "global",
    });
  });

  it("publishes OpenAI Batch and separately billed services as distinct offers", () => {
    const openAi = manifests.find(({ provider }) => provider.id === "openai");
    const pricingSource = openAi?.sources.find(({ id }) => id === "openai-pricing");
    const accountingSource = openAi?.sources.find(({ id }) => id === "openai-accounting");
    if (pricingSource === undefined || accountingSource === undefined)
      throw new Error("OpenAI pricing manifests are missing");
    const sourceId = pricingSource.id;
    const parsedModel: ParsedProviderModel = {
      ...model(),
      provider_id: "openai",
      model_id: "gpt-test",
      uid: "openai/gpt-test",
      source_refs: [sourceId],
      capabilities: { ...unknownCapabilities(), reasoning: true },
      price_facts: [
        {
          meter: "input_text",
          price: "2",
          currency: "USD",
          unit: "million_tokens",
          conditions: { service_tier: "standard" },
          source_ref: sourceId,
          derived: false,
        },
        {
          meter: "input_text",
          price: "1",
          currency: "USD",
          unit: "million_tokens",
          conditions: { service_tier: "batch" },
          source_ref: sourceId,
          derived: false,
        },
      ],
      commercial_facts: [
        {
          source_ref: sourceId,
          book_key: "service:file-search",
          book_name: "File Search",
          resource_kind: "service",
          resource_key: "file-search",
          model_refs: ["openai/gpt-test"],
          offer_key: "usage",
          offer_name: "File Search usage",
          billing_mode: "usage",
          pricing_state: "numeric",
          price_facts: [
            {
              meter: "file_search",
              price: "2.5",
              currency: "USD",
              unit: "thousand_events",
              conditions: {},
              source_ref: sourceId,
              derived: false,
            },
          ],
          raw_price_facts: [],
        },
        {
          source_ref: sourceId,
          book_key: "service:web-search",
          book_name: "Web Search",
          resource_kind: "service",
          resource_key: "web-search",
          model_refs: ["openai/gpt-test"],
          offer_key: "current",
          offer_name: "Web Search",
          billing_mode: "usage",
          pricing_state: "numeric",
          price_facts: [
            {
              meter: "web_search",
              price: "10",
              currency: "USD",
              unit: "thousand_events",
              conditions: { operation: "search" },
              source_ref: sourceId,
              derived: false,
            },
          ],
          raw_price_facts: [],
        },
        {
          source_ref: sourceId,
          book_key: "service:containers",
          book_name: "Code execution containers",
          resource_kind: "service",
          resource_key: "containers",
          model_refs: ["openai/gpt-test"],
          offer_key: "runtime",
          offer_name: "Code execution runtime",
          billing_mode: "usage",
          pricing_state: "numeric",
          price_facts: [
            {
              meter: "container_runtime",
              price: "0.03",
              currency: "USD",
              unit: "container_session",
              conditions: { capacity: "1 GiB" },
              source_ref: sourceId,
              derived: false,
            },
          ],
          raw_price_facts: [],
        },
        {
          source_ref: sourceId,
          book_key: "service:fine-tuning:gpt-test",
          book_name: "Fine-tuning gpt-test",
          resource_kind: "service",
          resource_key: "fine-tuning:gpt-test",
          model_refs: ["openai/gpt-test"],
          offer_key: "training",
          offer_name: "Fine-tuning training",
          billing_mode: "usage",
          pricing_state: "numeric",
          price_facts: [
            {
              meter: "training_input",
              price: "25",
              currency: "USD",
              unit: "million_tokens",
              conditions: {},
              source_ref: sourceId,
              derived: false,
            },
          ],
          raw_price_facts: [],
        },
        {
          source_ref: sourceId,
          book_key: "service:fine-tuned-inference:gpt-test",
          book_name: "Fine-tuned gpt-test inference",
          resource_kind: "service",
          resource_key: "fine-tuned-inference:gpt-test",
          model_refs: ["openai/gpt-test"],
          offer_key: "inference",
          offer_name: "Fine-tuned model inference",
          billing_mode: "usage",
          pricing_state: "numeric",
          price_facts: [
            {
              meter: "input_text",
              price: "3",
              currency: "USD",
              unit: "million_tokens",
              conditions: { service_tier: "standard" },
              source_ref: sourceId,
              derived: false,
            },
            {
              meter: "input_text",
              price: "1.5",
              currency: "USD",
              unit: "million_tokens",
              conditions: { service_tier: "batch" },
              source_ref: sourceId,
              derived: false,
            },
          ],
          raw_price_facts: [],
        },
      ],
    };
    const accountingModel: ParsedProviderModel = {
      ...parsedModel,
      pricing_state: "unknown",
      price_facts: [],
      raw_price_facts: [],
      commercial_facts: [],
      pricing_inputs: [
        {
          key: "responses.usage.input_tokens",
          channel: "response",
          locator: { kind: "json_pointer", value: "/usage/input_tokens" },
          availability: "terminal_only",
          source_ref: accountingSource.id,
        },
        {
          key: "responses.usage.cached_input_tokens",
          channel: "response",
          locator: {
            kind: "json_pointer",
            value: "/usage/input_tokens_details/cached_tokens",
          },
          availability: "terminal_only",
          source_ref: accountingSource.id,
        },
        {
          key: "responses.usage.cache_write_tokens",
          channel: "response",
          locator: {
            kind: "json_pointer",
            value: "/usage/input_tokens_details/cache_write_tokens",
          },
          availability: "terminal_only",
          source_ref: accountingSource.id,
        },
        {
          key: "responses.served_service_tier",
          channel: "response",
          locator: { kind: "json_pointer", value: "/service_tier" },
          availability: "terminal_only",
          source_ref: accountingSource.id,
        },
        {
          key: "organization.completions.input_uncached_tokens",
          channel: "account_report",
          locator: {
            kind: "provider_field",
            value: "organization.usage.completions.results[*].input_uncached_tokens",
          },
          availability: "reconciliation_only",
          source_ref: accountingSource.id,
        },
        {
          key: "organization.file_search_calls.num_requests",
          channel: "account_report",
          locator: {
            kind: "provider_field",
            value: "organization.usage.file_search_calls.results[*].num_requests",
          },
          availability: "reconciliation_only",
          source_ref: accountingSource.id,
        },
        {
          key: "organization.web_search_calls.num_requests",
          channel: "account_report",
          locator: {
            kind: "provider_field",
            value: "organization.usage.web_search_calls.results[*].num_requests",
          },
          availability: "reconciliation_only",
          source_ref: accountingSource.id,
        },
      ],
    };
    const partition = assembleParsedProviderPricing(
      "openai",
      observedAt,
      [
        { source: pricingSource, models: [parsedModel] },
        { source: accountingSource, models: [accountingModel] },
      ],
      [parsedModel],
    );
    const modelBook = partition?.books.find(({ book_key }) => book_key === "model:openai/gpt-test");
    expect(modelBook?.offers.map(({ offer_key }) => offer_key).sort()).toEqual(["batch", "sync"]);
    const sync = modelBook?.offers.find(({ offer_key }) => offer_key === "sync");
    const batch = modelBook?.offers.find(({ offer_key }) => offer_key === "batch");
    expect(sync?.terms[0]).toMatchObject({
      kind: "rate",
      variants: [
        {
          charge_binding: {
            signal: { namespace: "kmodels", value: "uncached_input_tokens" },
            aggregation: "request",
            quantity_methods: expect.arrayContaining([
              expect.objectContaining({
                input_sources: [expect.objectContaining({ channel: "account_report" })],
              }),
              expect.objectContaining({ calculation: expect.any(Object) }),
            ]),
          },
          selector_sources: [
            expect.objectContaining({
              dimension: { namespace: "kmodels", value: "served_service_tier" },
              locator: { kind: "json_pointer", value: "/service_tier" },
              normalization: {
                kind: "categorical_map",
                entries: [
                  {
                    source_value: "default",
                    value: {
                      namespace: "provider",
                      provider_id: "openai",
                      value: "standard",
                    },
                  },
                ],
              },
            }),
          ],
        },
      ],
    });
    expect(batch?.terms[0]).toMatchObject({
      kind: "rate",
      variants: [
        {
          applicability: { any_of: [{ all_of: [] }] },
          charge_binding: {
            signal: { namespace: "kmodels", value: "uncached_input_tokens" },
            aggregation: "result_item",
          },
        },
      ],
    });
    expect(sync?.relations).toEqual([]);
    expect(batch?.relations).toEqual([]);

    const service = partition?.books.find(({ book_key }) => book_key === "service:file-search");
    expect(service?.scope).toEqual({
      kind: "provider_resource",
      resource_kind: { namespace: "kmodels", value: "service" },
      resource_key: "file-search",
      model_refs: ["openai/gpt-test"],
    });
    expect(service?.offers[0]).toMatchObject({
      relations: [],
      terms: [
        {
          kind: "rate",
          meter: { namespace: "kmodels", value: "file_search" },
          variants: [
            {
              charge_binding: {
                signal: {
                  namespace: "provider",
                  provider_id: "openai",
                  value: "file_search_calls",
                },
                aggregation: "request",
                quantity_methods: [
                  expect.objectContaining({
                    input_sources: [expect.objectContaining({ channel: "account_report" })],
                  }),
                ],
              },
            },
          ],
        },
      ],
    });
    const search = partition?.books.find(({ book_key }) => book_key === "service:web-search");
    expect(search?.offers[0]?.relations).toEqual([]);
    expect(search?.offers[0]?.terms.some(({ kind }) => kind === "contribution")).toBe(false);
    expect(search?.offers[0]?.terms[0]).toMatchObject({
      kind: "rate",
      variants: [
        {
          charge_binding: {
            signal: {
              namespace: "provider",
              provider_id: "openai",
              value: "web_search_calls",
            },
          },
        },
      ],
    });
    const containers = partition?.books.find(({ book_key }) => book_key === "service:containers");
    expect(containers?.offers[0]?.terms[0]).toMatchObject({
      kind: "rate",
      variants: [
        {
          charge_binding: {
            signal: {
              namespace: "provider",
              provider_id: "openai",
              value: "container_session_blocks",
            },
            aggregation: "session",
          },
        },
      ],
    });
    if (containers?.offers[0]?.terms[0]?.kind !== "rate")
      throw new Error("OpenAI container rate is missing");
    expect(
      containers.offers[0].terms[0].variants[0]?.charge_binding?.quantity_methods,
    ).toBeUndefined();

    const training = partition?.books.find(
      ({ book_key }) => book_key === "service:fine-tuning:gpt-test",
    );
    const fineTuned = partition?.books.find(
      ({ book_key }) => book_key === "service:fine-tuned-inference:gpt-test",
    );
    expect(training).toBeUndefined();
    expect(fineTuned?.resource_edges).toEqual([]);
    expect(fineTuned?.offers.map(({ offer_key }) => offer_key).sort()).toEqual(["batch", "sync"]);
    expect(
      fineTuned?.offers.map(({ offer_key, terms }) => ({
        offer_key,
        aggregation:
          terms[0]?.kind === "rate" ? terms[0].variants[0]?.charge_binding?.aggregation : undefined,
      })),
    ).toEqual(
      expect.arrayContaining([
        { offer_key: "sync", aggregation: "request" },
        { offer_key: "batch", aggregation: "result_item" },
      ]),
    );
    if (partition === undefined) throw new Error("OpenAI pricing partition is missing");
    const view = modelPricingView(
      {
        provider_vocabularies: [partition.vocabulary],
        provider_snapshots: [partition.snapshot],
        model_dispositions: partition.model_dispositions,
        books: partition.books,
      },
      parsedModel,
    );
    expect(view.modelMechanisms.map(({ offer_key }) => offer_key).sort()).toEqual([
      "batch",
      "sync",
    ]);
    expect(view).toMatchObject({
      optionalServices: expect.arrayContaining([
        expect.objectContaining({ offer_key: "usage" }),
        expect.objectContaining({ offer_key: "current" }),
      ]),
      automaticComponents: [],
      plansAndCapacity: [],
      standaloneOffers: [],
    });
  });

  it("binds OpenAI modality, media, character, and duration rates to exact accounting inputs", () => {
    const openAi = manifests.find(({ provider }) => provider.id === "openai");
    const pricingSource = openAi?.sources.find(({ id }) => id === "openai-pricing");
    const accountingSource = openAi?.sources.find(({ id }) => id === "openai-accounting");
    if (pricingSource === undefined || accountingSource === undefined)
      throw new Error("OpenAI pricing manifests are missing");
    const rate = (
      meter: SourcePriceFact["meter"],
      unit: SourcePriceFact["unit"],
      conditions: SourcePriceFact["conditions"] = {},
    ): SourcePriceFact => ({
      meter,
      price: "1",
      currency: "USD",
      unit,
      conditions,
      source_ref: pricingSource.id,
      derived: false,
    });
    const pricedModel = (
      id: string,
      tasks: ParsedProviderModel["tasks"],
      priceFacts: SourcePriceFact[],
    ): ParsedProviderModel => ({
      ...model(),
      provider_id: "openai",
      model_id: id,
      uid: `openai/${id}`,
      tasks,
      source_refs: [pricingSource.id],
      price_facts: priceFacts,
    });
    const pricedModels = [
      pricedModel(
        "realtime-test",
        ["speech_to_speech"],
        [
          rate("input_text", "million_tokens"),
          rate("cache_read_text", "million_tokens"),
          rate("output_text", "million_tokens"),
          rate("input_audio", "million_tokens"),
          rate("cache_read_audio", "million_tokens"),
          rate("output_audio", "million_tokens"),
          rate("input_image", "million_tokens"),
          rate("output_image", "million_tokens"),
        ],
      ),
      pricedModel(
        "image-test",
        ["image_generation"],
        [
          rate("input_text", "million_tokens"),
          rate("cache_read_text", "million_tokens"),
          rate("input_image", "million_tokens"),
          rate("cache_read_image", "million_tokens"),
          rate("output_image", "million_tokens"),
          rate("image_generation", "image", { quality: "high", resolution: "1024x1024" }),
        ],
      ),
      pricedModel(
        "speech-test",
        ["speech_synthesis"],
        [rate("output_audio", "million_characters")],
      ),
      pricedModel("transcription-test", ["transcription"], [rate("input_audio", "minute")]),
      pricedModel(
        "video-test",
        ["video_generation"],
        [rate("video_generation", "second", { resolution: "720p" })],
      ),
      pricedModel("embedding-test", ["embeddings"], [rate("embedding", "million_tokens")]),
      pricedModel(
        "fast-test",
        ["text_generation"],
        [rate("input_text", "million_tokens", { service_tier: "fast" })],
      ),
    ];
    const input = (
      key: string,
      channel: "response" | "account_report",
      value: string,
    ): NonNullable<ParsedProviderModel["pricing_inputs"]>[number] => ({
      key,
      channel,
      locator:
        channel === "response"
          ? { kind: "json_pointer", value }
          : { kind: "provider_field", value },
      availability: channel === "response" ? "terminal_only" : "reconciliation_only",
      source_ref: accountingSource.id,
    });
    const accountingModel: ParsedProviderModel = {
      ...pricedModels[0]!,
      pricing_state: "unknown",
      price_facts: [],
      pricing_inputs: [
        input("responses.usage.input_tokens", "response", "/usage/input_tokens"),
        input(
          "responses.usage.cached_input_tokens",
          "response",
          "/usage/input_tokens_details/cached_tokens",
        ),
        input("responses.usage.output_tokens", "response", "/usage/output_tokens"),
        input("responses.served_service_tier", "response", "/service_tier"),
        input("organization.completions.input_text_tokens", "account_report", "input_text"),
        input(
          "organization.completions.input_cached_text_tokens",
          "account_report",
          "input_cached_text",
        ),
        input("organization.completions.output_text_tokens", "account_report", "output_text"),
        input("organization.completions.input_audio_tokens", "account_report", "input_audio"),
        input(
          "organization.completions.input_cached_audio_tokens",
          "account_report",
          "input_cached_audio",
        ),
        input("organization.completions.output_audio_tokens", "account_report", "output_audio"),
        input("organization.completions.input_image_tokens", "account_report", "input_image"),
        input("organization.completions.output_image_tokens", "account_report", "output_image"),
        input("responses.image_input_text_tokens", "response", "/usage/input/text_tokens"),
        input("responses.image_input_image_tokens", "response", "/usage/input/image_tokens"),
        input("responses.image_output_tokens", "response", "/usage/output/image_tokens"),
        input("responses.generated_images", "response", "/data"),
        input("organization.images.images", "account_report", "images"),
        input("responses.image_quality", "response", "/quality"),
        input("responses.image_resolution", "response", "/size"),
        input("organization.audio_speeches.characters", "account_report", "characters"),
        input("organization.audio_transcriptions.seconds", "account_report", "seconds"),
        input("organization.embeddings.input_tokens", "account_report", "embedding_tokens"),
        input("responses.generated_seconds", "response", "/seconds"),
        input("responses.video_resolution", "response", "/size"),
      ],
    };
    const partition = assembleParsedProviderPricing(
      "openai",
      observedAt,
      [
        { source: pricingSource, models: pricedModels },
        { source: accountingSource, models: [accountingModel] },
      ],
      pricedModels,
    );
    const variant = (modelId: string, meter: string) => {
      const term = partition?.books
        .find(({ book_key }) => book_key === `model:openai/${modelId}`)
        ?.offers.find(({ offer_key }) => offer_key === "sync")
        ?.terms.find((candidate) => candidate.kind === "rate" && candidate.meter.value === meter);
      if (term?.kind !== "rate") throw new Error(`${modelId}/${meter} rate is missing`);
      return term.variants[0]!;
    };
    const cases: Array<[string, string]> = [
      ["realtime-test", "input_text"],
      ["realtime-test", "cache_read_text"],
      ["realtime-test", "output_text"],
      ["realtime-test", "input_audio"],
      ["realtime-test", "cache_read_audio"],
      ["realtime-test", "output_audio"],
      ["realtime-test", "input_image"],
      ["realtime-test", "output_image"],
      ["image-test", "input_text"],
      ["image-test", "cache_read_text"],
      ["image-test", "input_image"],
      ["image-test", "cache_read_image"],
      ["image-test", "output_image"],
      ["image-test", "image_generation"],
      ["speech-test", "output_audio"],
      ["transcription-test", "transcription"],
      ["video-test", "video_generation"],
      ["embedding-test", "embedding"],
    ];
    expect(
      cases.map(([modelId, meter]) => {
        const charge = variant(modelId, meter).charge_binding;
        return [modelId, meter, charge?.signal.value, charge?.quantity_methods?.length];
      }),
    ).toEqual([
      ["realtime-test", "input_text", "uncached_input_tokens", 1],
      ["realtime-test", "cache_read_text", "cached_input_tokens", 1],
      ["realtime-test", "output_text", "output_tokens", 1],
      ["realtime-test", "input_audio", "uncached_input_audio_tokens", 1],
      ["realtime-test", "cache_read_audio", "cached_input_audio_tokens", 1],
      ["realtime-test", "output_audio", "output_audio_tokens", 1],
      ["realtime-test", "input_image", "uncached_input_image_tokens", 1],
      ["realtime-test", "output_image", "output_image_tokens", 1],
      ["image-test", "input_text", "uncached_image_prompt_text_tokens", undefined],
      ["image-test", "cache_read_text", "cached_image_prompt_text_tokens", undefined],
      ["image-test", "input_image", "uncached_input_image_tokens", undefined],
      ["image-test", "cache_read_image", "cached_image_prompt_image_tokens", undefined],
      ["image-test", "output_image", "output_image_tokens", 1],
      ["image-test", "image_generation", "generated_images", 1],
      ["speech-test", "output_audio", "input_characters", 1],
      ["transcription-test", "transcription", "processed_audio_seconds", 1],
      ["video-test", "video_generation", "generated_seconds", 1],
      ["embedding-test", "embedding", "input_tokens", 1],
    ]);
    for (const meter of ["input_text", "cache_read_text", "output_text"])
      expect(
        variant("realtime-test", meter).charge_binding?.quantity_methods?.flatMap(
          ({ input_sources }) => input_sources?.map(({ channel }) => channel) ?? [],
        ),
      ).toEqual(["account_report"]);
    expect(
      variant("image-test", "image_generation").selector_sources?.map(
        ({ dimension }) => dimension.value,
      ),
    ).toEqual(["quality", "resolution"]);
    expect(variant("video-test", "video_generation").selector_sources).toMatchObject([
      {
        dimension: { namespace: "kmodels", value: "resolution" },
        normalization: {
          kind: "categorical_map",
          entries: [
            {
              source_value: "1280x720",
              value: { namespace: "provider", provider_id: "openai", value: "720p" },
            },
            {
              source_value: "720x1280",
              value: { namespace: "provider", provider_id: "openai", value: "720p" },
            },
          ],
        },
      },
    ]);
    expect(variant("fast-test", "input_text").selector_sources).toMatchObject([
      {
        dimension: { namespace: "kmodels", value: "served_service_tier" },
        normalization: {
          kind: "categorical_map",
          entries: [
            {
              source_value: "priority",
              value: { namespace: "provider", provider_id: "openai", value: "fast" },
            },
          ],
        },
      },
    ]);
  });

  it("prefers OpenAI pricing-page rates to broader model-card fallbacks", () => {
    const openAi = manifests.find(({ provider }) => provider.id === "openai");
    const overview = openAi?.sources.find(({ id }) => id === "openai-overview");
    const pricing = openAi?.sources.find(({ id }) => id === "openai-pricing");
    if (overview === undefined || pricing === undefined)
      throw new Error("OpenAI pricing manifests are missing");
    const parsedModel: ParsedProviderModel = {
      ...model(),
      provider_id: "openai",
      model_id: "gpt-test",
      uid: "openai/gpt-test",
      source_refs: [overview.id, pricing.id],
      price_facts: [],
    };
    const rate = (
      source_ref: string,
      price: string,
      conditions: SourcePriceFact["conditions"],
    ): SourcePriceFact => ({
      meter: "input_text",
      price,
      currency: "USD",
      unit: "million_tokens",
      conditions: { service_tier: "standard", ...conditions },
      source_ref,
      derived: false,
    });
    const partition = assembleParsedProviderPricing(
      "openai",
      observedAt,
      [
        {
          source: overview,
          models: [{ ...parsedModel, price_facts: [rate(overview.id, "2", {})] }],
        },
        {
          source: pricing,
          models: [
            {
              ...parsedModel,
              price_facts: [
                rate(pricing.id, "3", { context_max_tokens: 272_000 }),
                rate(pricing.id, "4", { context_min_tokens: 272_001 }),
              ],
            },
          ],
        },
      ],
      [parsedModel],
    );
    const term = partition?.books[0]?.offers.find(({ offer_key }) => offer_key === "sync")
      ?.terms[0];
    if (term?.kind !== "rate") throw new Error("OpenAI input rate is missing");
    expect(term.variants.map(({ price }) => price.value)).toEqual([
      { numerator: "3", denominator: "1000000" },
      { numerator: "1", denominator: "250000" },
    ]);
    expect(
      term.variants.every(({ observations }) =>
        observations.every(({ source_ref }) => source_ref === pricing.id),
      ),
    ).toBe(true);
    expect(term.raw_variants).toEqual([
      expect.objectContaining({
        reason: "superseded_value",
        resolution_policy: "openai_pricing_page_over_model_card",
        observations: [expect.objectContaining({ source_ref: overview.id })],
      }),
    ]);
  });

  it("publishes Anthropic request rates and excludes unrelated commercial products", () => {
    const anthropic = manifests.find(({ provider }) => provider.id === "anthropic");
    const pricingSource = anthropic?.sources.find(({ id }) => id === "anthropic-models");
    if (pricingSource === undefined) throw new Error("Anthropic pricing manifest is missing");
    const sourceId = pricingSource.id;
    const modelRef = "anthropic/claude-test";
    const rate = (
      meter: SourcePriceFact["meter"],
      price: string,
      unit: SourcePriceFact["unit"],
      conditions: SourcePriceFact["conditions"] = {},
    ): SourcePriceFact => ({
      meter,
      price,
      currency: "USD",
      unit,
      conditions,
      source_ref: sourceId,
      derived: false,
    });
    const commercial = (
      resourceKey: string,
      offerKey: string,
      pricingState: SourceCommercialPricingFact["pricing_state"],
      priceFacts: SourcePriceFact[] = [],
      rawPriceFacts: SourceCommercialPricingFact["raw_price_facts"] = [],
      resourceKind: SourceCommercialPricingFact["resource_kind"] = "service",
    ): SourceCommercialPricingFact => ({
      source_ref: sourceId,
      book_key: `${resourceKind}:${resourceKey}`,
      book_name: resourceKey,
      resource_kind: resourceKind,
      resource_key: resourceKey,
      model_refs: [modelRef],
      offer_key: offerKey,
      offer_name: offerKey,
      billing_mode: resourceKind === "capacity" ? "capacity" : "usage",
      pricing_state: pricingState,
      price_facts: priceFacts,
      raw_price_facts: rawPriceFacts,
    });
    const raw = (
      termKey: string,
      impact: SourceCommercialPricingFact["raw_price_facts"][number]["impact"],
      reason: SourceCommercialPricingFact["raw_price_facts"][number]["reason"],
      fragment: string,
    ): SourceCommercialPricingFact["raw_price_facts"][number] => ({
      term_key: termKey,
      impact,
      reason,
      conditions: {},
      source_ref: sourceId,
      raw: { fragment },
    });
    const parsedModel: ParsedProviderModel = {
      ...model(),
      provider_id: "anthropic",
      model_id: "claude-test",
      uid: modelRef,
      source_refs: [sourceId],
      capabilities: { ...unknownCapabilities(), batch: true },
      price_facts: [
        rate("input_text", "2", "million_tokens", { service_tier: "standard" }),
        rate("output_text", "10", "million_tokens", { service_tier: "standard" }),
        rate("cache_write_text", "2.5", "million_tokens", {
          service_tier: "standard",
          cache_ttl_seconds: 300,
        }),
        rate("cache_read_text", "0.2", "million_tokens", { service_tier: "standard" }),
        rate("input_text", "1", "million_tokens", { service_tier: "batch" }),
        rate("output_text", "5", "million_tokens", { service_tier: "batch" }),
      ],
      commercial_facts: [
        commercial(
          "web-search",
          "usage",
          "numeric",
          [rate("web_search", "10", "thousand_events")],
          [],
        ),
        commercial(
          "web-fetch",
          "batch",
          "numeric",
          [rate("web_search", "10", "thousand_events")],
          [raw("usage-signal", "informational", "unsupported_structure", "web_search_requests")],
        ),
        commercial("web-fetch", "sync", "included"),
        commercial(
          "code-execution",
          "standalone",
          "numeric",
          [rate("container_runtime", "0.05", "hour")],
          [
            raw(
              "minimum-runtime",
              "informational",
              "unsupported_structure",
              "5-minute minimum execution time",
            ),
            raw(
              "monthly-container-allowance",
              "allowance",
              "unsupported_structure",
              "1,550 free container-hours per organization per month",
            ),
            raw(
              "runtime-observation",
              "informational",
              "requires_usage_aggregation",
              "response omits billable duration",
            ),
          ],
        ),
        commercial("code-execution", "web-assisted", "included"),
        commercial("managed-agents-runtime", "managed-agents", "included"),
        commercial(
          `advisor:${modelRef}`,
          "sync",
          "included",
          [],
          [raw("advisor-model-usage", "base_price", "target_rate_not_normalized", "iterations")],
        ),
        commercial(
          "managed-agents-runtime",
          "runtime",
          "numeric",
          [rate("session_runtime", "0.08", "hour")],
          [
            raw("runtime-signal", "informational", "unsupported_structure", "active_seconds"),
            raw("model-usage", "informational", "unsupported_structure", "model token rates"),
            raw(
              "session-list-cost",
              "informational",
              "requires_usage_aggregation",
              "authoritative list cost",
            ),
          ],
        ),
        commercial(
          `priority-tier:${modelRef}`,
          "commitment",
          "not_published",
          [],
          [
            raw("commitment", "base_price", "unknown_amount", "existing commitment"),
            raw(
              "closed-enrollment",
              "informational",
              "unsupported_structure",
              "closed to new commitments",
            ),
          ],
          "capacity",
        ),
        commercial(
          "fallback-credit-token",
          "redemption",
          "included",
          [],
          [
            raw(
              "fallback-rate-substitution",
              "allowance",
              "unsupported_structure",
              "cache writes become cache reads",
            ),
          ],
          "account_resource_template",
        ),
        commercial(
          "claude-platform-aws",
          "marketplace",
          "externally_billed",
          [],
          [raw("ccu", "informational", "unsupported_structure", "100 CCU = USD 1")],
          "distribution",
        ),
      ],
      pricing_inputs: [
        ...[
          ["uncached_input_tokens", "input_tokens"],
          ["cached_input_tokens", "cache_read_input_tokens"],
          ["output_tokens", "output_tokens"],
        ].flatMap(([signal, field]) => [
          {
            key: `messages.usage.${signal}`,
            channel: "response" as const,
            locator: { kind: "json_pointer" as const, value: `/usage/${field}` },
            availability: "conditional" as const,
            source_ref: sourceId,
          },
          {
            key: `messages.usage.${signal}`,
            channel: "response" as const,
            locator: {
              kind: "provider_field" as const,
              value: `usage.iterations[*].${field} grouped by usage.iterations[*].model`,
            },
            availability: "conditional" as const,
            source_ref: sourceId,
          },
        ]),
        {
          key: "messages.usage.successful_web_searches",
          channel: "response",
          locator: {
            kind: "json_pointer",
            value: "/usage/server_tool_use/web_search_requests",
          },
          availability: "terminal_only",
          source_ref: sourceId,
        },
      ],
    };
    const partition = assembleParsedProviderPricing(
      "anthropic",
      observedAt,
      [{ source: pricingSource, models: [parsedModel] }],
      [parsedModel],
      anthropic?.pricingCategoricalLabels,
    );
    const modelBook = partition?.books.find(({ book_key }) => book_key === `model:${modelRef}`);
    const sync = modelBook?.offers.find(({ offer_key }) => offer_key === "sync");
    const batch = modelBook?.offers.find(({ offer_key }) => offer_key === "batch");
    const inputRate = (offer: typeof sync) =>
      offer?.terms.find(
        (term) =>
          term.kind === "rate" &&
          term.meter.namespace === "kmodels" &&
          term.meter.value === "input_text",
      );
    const syncInput = inputRate(sync);
    const batchInput = inputRate(batch);
    const cacheWrite = sync?.terms.find(
      (term) => term.kind === "rate" && term.meter.value === "cache_write_text",
    );
    expect({
      offers: modelBook?.offers.map(({ offer_key }) => offer_key).sort(),
      syncAggregation:
        syncInput?.kind === "rate" ? syncInput.variants[0]?.charge_binding?.aggregation : undefined,
      batchAggregation:
        batchInput?.kind === "rate"
          ? batchInput.variants[0]?.charge_binding?.aggregation
          : undefined,
      syncInputs:
        syncInput?.kind === "rate"
          ? syncInput.variants[0]?.charge_binding?.quantity_methods?.[0]?.input_sources
          : undefined,
      exclusive: sync?.relations[0]?.target,
    }).toEqual({
      offers: ["batch", "sync"],
      syncAggregation: "attempt",
      batchAggregation: "result_item",
      syncInputs: [
        {
          signal: {
            namespace: "provider",
            provider_id: "anthropic",
            value: "uncached_input_tokens",
          },
          channel: "response",
          locator: {
            kind: "json_pointer",
            value: "/usage/input_tokens",
          },
          availability: "conditional",
        },
        {
          signal: {
            namespace: "provider",
            provider_id: "anthropic",
            value: "uncached_input_tokens",
          },
          channel: "response",
          locator: {
            kind: "provider_field",
            value: "usage.iterations[*].input_tokens grouped by usage.iterations[*].model",
          },
          availability: "conditional",
        },
      ],
      exclusive: undefined,
    });
    expect(
      cacheWrite?.kind === "rate" ? cacheWrite.variants[0]?.charge_binding : undefined,
    ).toMatchObject({
      signal: {
        namespace: "provider",
        provider_id: "anthropic",
        value: "cache_write_5m_input_tokens",
      },
    });
    expect(
      cacheWrite?.kind === "rate"
        ? cacheWrite.variants[0]?.charge_binding?.quantity_methods?.[0]?.input_sources
        : undefined,
    ).toBeUndefined();

    const search = partition?.books.find(({ book_key }) => book_key === "service:web-search");
    expect(search?.offers).toEqual([
      expect.objectContaining({
        offer_key: "usage",
        relations: [],
        terms: [
          expect.objectContaining({
            kind: "rate",
            variants: [
              expect.objectContaining({
                charge_binding: expect.objectContaining({
                  signal: {
                    namespace: "provider",
                    provider_id: "anthropic",
                    value: "successful_web_searches",
                  },
                  aggregation: "request",
                  quantity_methods: [
                    {
                      input_sources: [
                        expect.objectContaining({
                          channel: "response",
                          locator: {
                            kind: "json_pointer",
                            value: "/usage/server_tool_use/web_search_requests",
                          },
                          availability: "terminal_only",
                        }),
                      ],
                    },
                  ],
                }),
              }),
            ],
          }),
        ],
      }),
    ]);

    const code = partition?.books.find(({ book_key }) => book_key === "service:code-execution");
    const allowance = code?.offers
      .find(({ offer_key }) => offer_key === "standalone")
      ?.terms.find(({ kind }) => kind === "allowance");
    expect(allowance).toMatchObject({
      kind: "allowance",
      variants: [
        {
          benefit: {
            kind: "quantity",
            quantity: { value: { numerator: "5580000", denominator: "1" } },
          },
          reset: { namespace: "kmodels", value: "monthly" },
        },
      ],
    });
    const codeRate = code?.offers
      .find(({ offer_key }) => offer_key === "standalone")
      ?.terms.find(({ kind }) => kind === "rate");
    expect(
      codeRate?.kind === "rate" ? codeRate.variants[0]?.charge_binding : undefined,
    ).toMatchObject({
      signal: {
        namespace: "provider",
        provider_id: "anthropic",
        value: "code_execution_billable_seconds",
      },
      aggregation: {
        namespace: "provider",
        provider_id: "anthropic",
        value: "code_execution_container",
      },
      quantity_methods: [
        {
          calculation: {
            nodes: [
              {
                op: "signal",
                signal: {
                  namespace: "provider",
                  provider_id: "anthropic",
                  value: "code_execution_active_seconds",
                },
              },
              { op: "minimum", input: 0, value: { numerator: "300", denominator: "1" } },
            ],
            result: 1,
          },
        },
      ],
    });
    expect(
      code?.offers
        .find(({ offer_key }) => offer_key === "standalone")
        ?.terms.filter(({ kind }) => kind === "raw"),
    ).toEqual([]);
    expect(
      partition?.books
        .filter(({ scope }) => scope.kind === "provider_resource")
        .map(({ scope }) => (scope.kind === "provider_resource" ? scope.resource_key : ""))
        .sort(),
    ).toEqual(["code-execution", "web-search"]);
    if (partition === undefined) throw new Error("Anthropic pricing partition is missing");
    const incomplete = structuredClone(partition);
    const incompleteCode = incomplete.books.find(
      ({ book_key }) => book_key === "service:code-execution",
    );
    if (incompleteCode === undefined) throw new Error("Anthropic Code Execution book is missing");
    for (const offer of incompleteCode.offers)
      offer.terms = offer.terms.filter(({ kind }) => kind !== "allowance");
    expect(() => validateAdoptedTopology(incomplete)).toThrow(
      "anthropic commercial topology changed",
    );
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

  it("shares explicitly base-model pricing across every published version", () => {
    const source = baseModelPricingSource();
    const sourceModel = model();
    const published = ["2026-01-01", "2026-02-01"].map((version) => ({
      ...sourceModel,
      uid: `${modelRef}@${version}`,
      version,
    }));
    const retired = {
      ...sourceModel,
      uid: `${modelRef}@2025-01-01`,
      version: "2025-01-01",
      status: "retired" as const,
    };
    const partition = assembleParsedProviderPricing(
      providerId,
      observedAt,
      [{ source, models: [sourceModel] }],
      [...published, retired],
    );
    expect(partition?.books).toEqual([
      expect.objectContaining({
        book_key: `base-model:${modelRef}`,
        scope: { kind: "models", model_refs: published.map(({ uid }) => uid) },
        scope_observations: [
          expect.objectContaining({
            establishes: { kind: "models", model_refs: published.map(({ uid }) => uid) },
          }),
        ],
      }),
    ]);
  });

  it("uses base-model pricing as a fallback when exact numeric evidence exists", () => {
    const { source: exactSource } = pricingManifest();
    const fallbackSource = baseModelPricingSource("gemini-base-model-pricing");
    const exact = model();
    const fallback = withPriceSource(model(), fallbackSource.id);
    const partition = assembleParsedProviderPricing(
      providerId,
      observedAt,
      [
        { source: exactSource, models: [exact] },
        { source: fallbackSource, models: [fallback] },
      ],
      [exact],
    );
    expect(partition?.books).toHaveLength(1);
    expect(partition?.books[0]?.source_refs).toEqual([exactSource.id]);
  });

  it("suppresses a lower-authority not-published state when an exact price book has rates", () => {
    const { source: exactSource } = pricingManifest();
    if (exactSource.pricingEvidence === undefined)
      throw new Error("Gemini pricing policy is missing");
    const commercialSource: SourceManifest = {
      ...exactSource,
      id: "gemini-commercial-terms",
      pricingEvidence: { ...exactSource.pricingEvidence, kind: "commercial_terms" },
    };
    const exact = model();
    const notPublished: ParsedProviderModel = {
      ...withPriceSource(model(), commercialSource.id),
      pricing_state: "not_published",
      price_facts: [],
    };
    const partition = assembleParsedProviderPricing(
      providerId,
      observedAt,
      [
        { source: commercialSource, models: [notPublished] },
        { source: exactSource, models: [exact] },
      ],
      [exact],
    );
    expect(partition?.books[0]?.source_refs).toEqual([exactSource.id]);
    expect(partition?.books[0]?.offers[0]?.states.every(({ state }) => state === "numeric")).toBe(
      true,
    );
  });

  it("keeps a higher-authority not-published state when only commercial terms have rates", () => {
    const { source: exactSource } = pricingManifest();
    if (exactSource.pricingEvidence === undefined)
      throw new Error("Gemini pricing policy is missing");
    const commercialSource: SourceManifest = {
      ...exactSource,
      id: "gemini-commercial-terms",
      pricingEvidence: { ...exactSource.pricingEvidence, kind: "commercial_terms" },
    };
    const numeric = withPriceSource(model(), commercialSource.id);
    const notPublished: ParsedProviderModel = {
      ...withPriceSource(model(), exactSource.id),
      pricing_state: "not_published",
      price_facts: [],
    };
    const partition = assembleParsedProviderPricing(
      providerId,
      observedAt,
      [
        { source: commercialSource, models: [numeric] },
        { source: exactSource, models: [notPublished] },
      ],
      [numeric],
    );
    expect(partition?.books[0]?.source_refs).toEqual([commercialSource.id, exactSource.id]);
  });

  it("limits shared base-model pricing to versions without exact numeric evidence", () => {
    const { source: exactSource } = pricingManifest();
    const fallbackSource = baseModelPricingSource("gemini-base-model-pricing");
    const exact = { ...model(), uid: `${modelRef}@2026-01-01`, version: "2026-01-01" };
    const sibling = { ...exact, uid: `${modelRef}@2026-02-01`, version: "2026-02-01" };
    const fallback = withPriceSource(model(), fallbackSource.id);
    const partition = assembleParsedProviderPricing(
      providerId,
      observedAt,
      [
        { source: exactSource, models: [exact] },
        { source: fallbackSource, models: [fallback] },
      ],
      [exact, sibling],
    );
    expect(partition?.books).toHaveLength(2);
    expect(
      partition?.books.find(({ book_key }) => book_key === `model:${exact.uid}`)?.scope,
    ).toEqual({ kind: "models", model_refs: [exact.uid] });
    expect(
      partition?.books.find(({ book_key }) => book_key === `base-model:${modelRef}`)?.scope,
    ).toEqual({ kind: "models", model_refs: [sibling.uid] });
  });

  it("publishes DashScope on-demand, Batch, cache, and web-search mechanisms separately", () => {
    const provider = manifests.find(({ provider }) => provider.id === "dashscope");
    const pricingSource = provider?.sources.find(({ id }) => id === "dashscope-pricing");
    if (pricingSource === undefined) throw new Error("DashScope pricing manifest is missing");
    const sourceId = pricingSource.id;
    const modelRef = "dashscope/qwen-test";
    const rate = (
      meter: SourcePriceFact["meter"],
      price: string,
      conditions: SourcePriceFact["conditions"],
    ): SourcePriceFact => ({
      meter,
      price,
      currency: "USD",
      unit:
        meter === "web_search"
          ? "thousand_requests"
          : meter === "speech_generation"
            ? "request"
            : "million_tokens",
      conditions,
      source_ref: sourceId,
      derived: false,
    });
    const parsed: ParsedProviderModel = {
      ...model(),
      provider_id: "dashscope",
      model_id: "qwen-test",
      uid: modelRef,
      source_refs: [sourceId],
      price_facts: [
        rate("input_text", "2", { region: "Singapore" }),
        rate("input_image", "0.3", { region: "Singapore", modality: "image/video" }),
        rate("output_text", "9", { region: "Singapore", modality: "text" }),
        rate("output_audio", "30", { region: "Singapore", modality: "audio" }),
        rate("speech_generation", "1", { region: "Singapore" }),
        rate("cache_write_text", "2.5", {
          region: "Singapore",
          operation: "explicit_cache",
        }),
        rate("cache_read_text", "0.2", {
          region: "Singapore",
          operation: "explicit_cache",
        }),
        rate("input_text", "1", { region: "Singapore", service_tier: "batch" }),
        rate("output_text", "4", { region: "Singapore", service_tier: "batch" }),
      ],
      raw_price_facts: [],
      pricing_inputs: [
        {
          key: "chat.input_tokens",
          channel: "response",
          locator: { kind: "json_pointer", value: "/usage/prompt_tokens" },
          availability: "terminal_only",
          source_ref: sourceId,
        },
        {
          key: "chat.cached_input_tokens",
          channel: "response",
          locator: {
            kind: "json_pointer",
            value: "/usage/prompt_tokens_details/cached_tokens",
          },
          availability: "terminal_only",
          source_ref: sourceId,
        },
        {
          key: "chat.output_tokens",
          channel: "response",
          locator: { kind: "json_pointer", value: "/usage/completion_tokens" },
          availability: "terminal_only",
          source_ref: sourceId,
        },
        {
          key: "chat.input_image_tokens",
          channel: "response",
          locator: { kind: "json_pointer", value: "/usage/prompt_tokens_details/image_tokens" },
          absent_value: "zero",
          availability: "terminal_only",
          source_ref: sourceId,
        },
        {
          key: "chat.input_video_tokens",
          channel: "response",
          locator: { kind: "json_pointer", value: "/usage/prompt_tokens_details/video_tokens" },
          absent_value: "zero",
          availability: "terminal_only",
          source_ref: sourceId,
        },
        {
          key: "chat.output_text_tokens",
          channel: "response",
          locator: {
            kind: "json_pointer",
            value: "/usage/completion_tokens_details/text_tokens",
          },
          absent_value: "zero",
          availability: "terminal_only",
          source_ref: sourceId,
        },
        {
          key: "chat.output_audio_tokens",
          channel: "response",
          locator: {
            kind: "json_pointer",
            value: "/usage/completion_tokens_details/audio_tokens",
          },
          absent_value: "zero",
          availability: "terminal_only",
          source_ref: sourceId,
        },
        {
          key: "chat.cache_creation_input_tokens",
          channel: "response",
          locator: {
            kind: "json_pointer",
            value: "/usage/prompt_tokens_details/cache_creation/cache_creation_input_tokens",
          },
          availability: "terminal_only",
          source_ref: sourceId,
        },
        {
          key: "batch.chat.input_tokens",
          channel: "result",
          locator: { kind: "json_pointer", value: "/response/body/usage/prompt_tokens" },
          availability: "success_only",
          source_ref: sourceId,
        },
        {
          key: "batch.chat.output_tokens",
          channel: "result",
          locator: { kind: "json_pointer", value: "/response/body/usage/completion_tokens" },
          availability: "success_only",
          source_ref: sourceId,
        },
        {
          key: "responses.web_search_count",
          channel: "response",
          locator: { kind: "json_pointer", value: "/usage/x_tools/web_search/count" },
          availability: "terminal_only",
          source_ref: sourceId,
        },
        {
          key: "request.resolved_region",
          channel: "request",
          locator: { kind: "provider_field", value: "HttpRequest.resolved_region" },
          availability: "always",
          source_ref: sourceId,
        },
      ],
      commercial_facts: [
        {
          source_ref: sourceId,
          book_key: "service:web-search",
          book_name: "Model Studio built-in web search",
          resource_kind: "service",
          resource_key: "web-search",
          model_refs: [modelRef],
          offer_key: "built-in:singapore",
          offer_name: "Built-in web search",
          billing_mode: "usage",
          pricing_state: "numeric",
          price_facts: [rate("web_search", "10", { region: "Singapore" })],
          raw_price_facts: [],
        },
      ],
    };
    const partition = assembleParsedProviderPricing(
      "dashscope",
      observedAt,
      [{ source: pricingSource, models: [parsed] }],
      [parsed],
      provider?.pricingCategoricalLabels,
    );
    const modelBook = partition?.books.find(({ book_key }) => book_key === `model:${modelRef}`);
    const sync = modelBook?.offers.find(({ offer_key }) => offer_key === "sync");
    const batch = modelBook?.offers.find(({ offer_key }) => offer_key === "batch");
    expect(modelBook?.offers.map(({ offer_key }) => offer_key).sort()).toEqual(["batch", "sync"]);
    expect(sync?.relations).toEqual([]);
    const voice = sync?.terms.find(
      (term) => term.kind === "rate" && term.meter.value === "speech_generation",
    );
    expect(voice).toMatchObject({ kind: "rate" });
    expect(voice?.kind === "rate" ? voice.variants[0]?.charge_binding : null).toBeUndefined();
    const syncInput = sync?.terms.find(
      (term) => term.kind === "rate" && term.meter.value === "input_text",
    );
    expect(
      syncInput?.kind === "rate" ? syncInput.variants[0]?.charge_binding : undefined,
    ).toMatchObject({
      signal: { namespace: "kmodels", value: "uncached_input_tokens" },
      aggregation: "request",
      quantity_methods: [
        {
          calculation: {
            nodes: [
              { op: "signal", signal: { namespace: "kmodels", value: "input_tokens" } },
              {
                op: "signal",
                signal: { namespace: "kmodels", value: "cached_input_tokens" },
              },
              {
                op: "signal",
                signal: { namespace: "kmodels", value: "cache_write_tokens" },
              },
              { op: "sum", inputs: [1, 2] },
              { op: "subtract_floor_zero", minuend: 0, subtrahend: 3 },
            ],
            result: 4,
          },
        },
      ],
    });
    const cacheRead = sync?.terms.find(
      (term) => term.kind === "rate" && term.meter.value === "cache_read_text",
    );
    expect(
      cacheRead?.kind === "rate"
        ? cacheRead.variants[0]?.charge_binding?.quantity_methods?.[0]?.input_sources
        : [],
    ).toEqual([
      {
        signal: { namespace: "kmodels", value: "cached_input_tokens" },
        channel: "response",
        locator: {
          kind: "json_pointer",
          value: "/usage/prompt_tokens_details/cached_tokens",
        },
        availability: "terminal_only",
      },
    ]);
    expect(
      sync?.terms.find((term) => term.kind === "rate" && term.meter.value === "cache_write_text"),
    ).toMatchObject({
      kind: "rate",
      variants: [
        {
          charge_binding: {
            signal: { namespace: "kmodels", value: "cache_write_tokens" },
            aggregation: "request",
          },
        },
      ],
    });
    const combinedInput = sync?.terms.find(
      (term) => term.kind === "rate" && term.meter.value === "input_image",
    );
    expect(
      combinedInput?.kind === "rate" ? combinedInput.variants[0]?.charge_binding : undefined,
    ).toMatchObject({
      signal: {
        namespace: "provider",
        provider_id: "dashscope",
        value: "input_image_video_tokens",
      },
      quantity_methods: [
        {
          calculation: {
            nodes: [
              expect.objectContaining({ op: "signal" }),
              expect.objectContaining({ op: "signal" }),
              { op: "sum", inputs: [0, 1] },
            ],
            result: 2,
          },
        },
      ],
    });
    const splitOutput = sync?.terms.find(
      (term) => term.kind === "rate" && term.meter.value === "output_text",
    );
    expect(
      splitOutput?.kind === "rate" ? splitOutput.variants[0]?.charge_binding : undefined,
    ).toMatchObject({
      signal: {
        namespace: "provider",
        provider_id: "dashscope",
        value: "output_text_tokens",
      },
    });
    expect(
      sync?.terms.find((term) => term.kind === "rate" && term.meter.value === "output_audio"),
    ).toMatchObject({
      kind: "rate",
      variants: [
        {
          charge_binding: {
            signal: {
              namespace: "provider",
              provider_id: "dashscope",
              value: "output_audio_tokens",
            },
          },
        },
      ],
    });
    const batchInput = batch?.terms.find(
      (term) => term.kind === "rate" && term.meter.value === "input_text",
    );
    expect(batchInput).toMatchObject({
      kind: "rate",
      variants: [
        {
          charge_binding: {
            signal: { namespace: "kmodels", value: "input_tokens" },
            aggregation: "result_item",
          },
        },
      ],
    });
    expect(
      batchInput?.kind === "rate"
        ? JSON.stringify(batchInput.variants[0]?.applicability)
        : "service_tier",
    ).not.toContain("service_tier");
    const search = partition?.books.find(({ book_key }) => book_key === "service:web-search");
    expect(search?.offers[0]).toMatchObject({
      relations: [],
      terms: [
        {
          kind: "rate",
          variants: [
            {
              charge_binding: {
                signal: { namespace: "kmodels", value: "successful_web_searches" },
                aggregation: "request",
                quantity_methods: [
                  {
                    input_sources: [
                      {
                        channel: "response",
                        locator: { kind: "json_pointer", value: "/usage/x_tools/web_search/count" },
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
      settlement: [],
    });
  });
});
