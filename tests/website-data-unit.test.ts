import { describe, expect, it } from "vite-plus/test";
import { baseModel } from "../src/catalog/model.ts";
import { unconditionalApplicability } from "../src/catalog/pricing-canonical.ts";
import {
  pricingBookId,
  pricingOfferId,
  pricingTermId,
} from "../src/catalog/pricing-identifiers.ts";
import type {
  ChargeBinding,
  PriceApplicability,
  PriceCondition,
  PricingCatalog,
  PricingOffer,
  ProviderAtomRegistryEntry,
  RawPricingVariant,
  UnitExpression,
} from "../src/catalog/pricing-schema.ts";
import { websiteModelDetail } from "../src/catalog/website-data.ts";

const providerId = "test";
const modelId = "model";
const modelRef = `${providerId}/${modelId}`;
const sourceId = "test-pricing";
const observedAt = "2026-07-28T00:00:00.000Z";
const bookId = pricingBookId(providerId, "public");
const offerId = pricingOfferId(bookId, "usage");
const durationDimension = { namespace: "kmodels" as const, value: "duration_seconds" as const };
const secondUnit: UnitExpression = {
  factors: [{ unit: { namespace: "kmodels", value: "second" }, power: 1 }],
};

function normalizedObservation(establishes: PriceApplicability) {
  return {
    source_ref: sourceId,
    locator: { kind: "table" as const, value: "row" },
    raw: { label: "Price" },
    establishes_applicability: establishes,
  };
}

function bindingObservation() {
  return {
    source_ref: sourceId,
    locator: { kind: "table" as const, value: "usage" },
    raw: { label: "Usage" },
  };
}

type DecimalCondition = Extract<PriceCondition, { kind: "decimal_range" }>;

function numericDetail(ranges: Array<Omit<DecimalCondition, "dimension" | "kind" | "unit">>) {
  const conditions = ranges.map((range): DecimalCondition => ({
    kind: "decimal_range",
    dimension: durationDimension,
    unit: secondUnit,
    ...range,
  }));
  return detail(conditions);
}

function detail(
  conditions: PriceCondition[],
  atoms: ProviderAtomRegistryEntry[] = [],
  options: {
    rateBinding?: ChargeBinding;
    contributionBindings?: ChargeBinding[];
    enrollment?: PricingOffer["enrollment"];
    relations?: PricingOffer["relations"];
    rawVariants?: RawPricingVariant[];
    settlement?: PricingOffer["settlement"];
  } = {},
) {
  const applicability = conditions.map((condition) => ({ any_of: [{ all_of: [condition] }] }));
  const pricing: PricingCatalog = {
    provider_vocabularies: [{ provider_id: providerId, atoms }],
    provider_snapshots: [
      { provider_id: providerId, observed_at: observedAt, publication: "fresh" },
    ],
    model_dispositions: [],
    books: [
      {
        id: bookId,
        provider_id: providerId,
        book_key: "public",
        scope: { kind: "models", model_refs: [modelRef] },
        scope_observations: [
          {
            source_ref: sourceId,
            locator: { kind: "table", value: "heading" },
            establishes: { kind: "models", model_refs: [modelRef] },
            raw: { label: "Pricing" },
          },
        ],
        resource_edges: [],
        offers: [
          {
            id: offerId,
            offer_key: "usage",
            billing_mode: { namespace: "kmodels", value: "usage" },
            states: [
              {
                state: "numeric",
                applicability: unconditionalApplicability,
                observations: [normalizedObservation(unconditionalApplicability)],
              },
            ],
            terms: [
              {
                id: pricingTermId(offerId, "rate", "input"),
                term_key: "input",
                kind: "rate",
                meter: { namespace: "kmodels", value: "input_text" },
                source_refs: [sourceId],
                variants: applicability.map((scope, index) => ({
                  price: {
                    value: { numerator: String(index + 1), denominator: "1" },
                    denomination: { kind: "fiat", currency: "USD" },
                    per: secondUnit,
                  },
                  applicability: scope,
                  ...(options.rateBinding === undefined
                    ? {}
                    : { charge_binding: options.rateBinding }),
                  observations: [normalizedObservation(scope)],
                })),
                raw_variants: options.rawVariants ?? [],
              },
              ...(options.contributionBindings === undefined
                ? []
                : [
                    {
                      id: pricingTermId(offerId, "contribution", "additional-input"),
                      term_key: "additional-input",
                      kind: "contribution" as const,
                      source_refs: [sourceId],
                      variants: [
                        {
                          target_rate_refs: [pricingTermId(offerId, "rate", "input")],
                          applicability: unconditionalApplicability,
                          charge_bindings: options.contributionBindings,
                          observations: [normalizedObservation(unconditionalApplicability)],
                        },
                      ],
                      raw_variants: [],
                    },
                  ]),
            ],
            relations: options.relations ?? [],
            enrollment: options.enrollment ?? [],
            settlement: options.settlement ?? [],
            source_refs: [sourceId],
          },
        ],
        source_refs: [sourceId],
      },
    ],
  };
  return websiteModelDetail(
    pricing,
    baseModel({
      providerId,
      id: modelId,
      name: "Model",
      sourceId,
      observedAt,
    }),
  );
}

describe("website data projection", () => {
  it("summarizes broad offer relations instead of repeating every target", () => {
    const offerRefs = ["1", "2", "3", "4"].map((value) => value.repeat(64));
    expect(
      detail([], [], {
        relations: [
          {
            kind: "compatible_with",
            target: { kind: "offers", offer_refs: offerRefs },
            applicability: unconditionalApplicability,
            observations: [
              {
                source_ref: sourceId,
                locator: { kind: "table", value: "compatibility" },
                establishes_offer_refs: offerRefs,
                establishes_book_refs: [],
                raw: { label: "Compatible offers" },
              },
            ],
          },
        ],
      }).pricing?.offers[0]?.composition,
    ).toBe("Compatible with 4 offers");
  });

  it("projects structured cost parameters without source fragments", () => {
    const projected = detail([], [], {
      rawVariants: [
        {
          impact: "base_price",
          reason: "requires_usage_aggregation",
          observations: [
            {
              source_ref: sourceId,
              locator: { kind: "table", value: "row" },
              raw: {
                label: "Storage duration",
                amount: "0.10",
                denomination: "USD",
                unit: "GB-hour",
                meter: "storage",
                formula: "retained GB × hours",
                validity: "current",
                conditions: [{ dimension: "region", value: "global" }],
                fragment: "undigested source prose",
              },
            },
          ],
        },
      ],
    });

    expect(projected.pricing?.offers[0]?.unnormalized[0]?.details).toEqual([
      "Storage duration",
      "0.10 USD",
      "Unit: GB-hour",
      "Meter: storage",
      "Formula: retained GB × hours",
      "Validity: current",
      "region: global",
    ]);
  });

  it("projects additional usage without copying its target rate", () => {
    expect(detail([], [], { contributionBindings: [] }).pricing?.offers[0]?.contributions).toEqual([
      expect.objectContaining({
        label: "Additional input",
        target: "Priced by Usage · Input text",
        drivers: [],
      }),
    ]);
  });

  it("projects billing context and standard cost drivers without calculating usage", () => {
    const condition: DecimalCondition = {
      kind: "decimal_range",
      dimension: durationDimension,
      unit: secondUnit,
      lower: { value: "0", inclusive: true },
    };
    const binding: ChargeBinding = {
      signal: { namespace: "kmodels", value: "active_seconds" },
      aggregation: "session",
      observations: [bindingObservation()],
    };
    const settlementApplicability: PriceApplicability = {
      any_of: [
        {
          all_of: [
            {
              kind: "categorical",
              dimension: { namespace: "kmodels", value: "billing_currency" },
              values: [{ namespace: "kmodels", value: "USD" }],
            },
          ],
        },
      ],
    };
    const projected = detail([condition], [], {
      rateBinding: binding,
      contributionBindings: [binding],
      enrollment: [
        {
          state: "private_preview",
          applicability: unconditionalApplicability,
          observations: [normalizedObservation(unconditionalApplicability)],
        },
      ],
      settlement: [
        {
          channel: "marketplace",
          biller: "Example Marketplace",
          payment_sources: ["allowance", "marketplace_commitment"],
          applicability: settlementApplicability,
          observations: [normalizedObservation(settlementApplicability)],
        },
      ],
    }).pricing?.offers[0];

    expect(projected?.selectors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Billing currency",
          kind: "categorical",
        }),
      ]),
    );
    expect(projected).toMatchObject({
      billing_mode: { label: "Usage-based" },
      enrollment: [{ label: "Private preview" }],
      settlement: [
        {
          channel: "Marketplace",
          biller: "Example Marketplace",
          payment_sources: ["Allowance", "Marketplace commitment"],
        },
      ],
      rates: [
        {
          driver: {
            label: "Active runtime",
            definition: "Provider-reported active runtime",
            aggregation: "Session",
            resolution_phase: "outcome",
          },
        },
      ],
      contributions: [
        {
          drivers: [
            {
              label: "Active runtime",
              aggregation: "Session",
              resolution_phase: "outcome",
            },
          ],
        },
      ],
    });
  });

  it("uses reviewed provider definitions for provider-owned cost drivers", () => {
    const condition: DecimalCondition = {
      kind: "decimal_range",
      dimension: durationDimension,
      unit: secondUnit,
      lower: { value: "0", inclusive: true },
    };
    const atoms: ProviderAtomRegistryEntry[] = [
      {
        kind: "usage_signal",
        key: "billed_runtime",
        definition: "Runtime recorded by the provider billing ledger",
        unit: secondUnit,
        resolution_phase: "account",
      },
      {
        kind: "aggregation",
        key: "workspace",
        definition: "Usage aggregated for one workspace",
      },
    ];
    const projected = detail([condition], atoms, {
      rateBinding: {
        signal: { namespace: "provider", provider_id: providerId, value: "billed_runtime" },
        aggregation: { namespace: "provider", provider_id: providerId, value: "workspace" },
        observations: [bindingObservation()],
      },
    }).pricing?.offers[0]?.rates[0]?.driver;

    expect(projected).toEqual({
      label: "Billed runtime",
      definition: "Runtime recorded by the provider billing ledger",
      aggregation: "Workspace",
      aggregation_definition: "Usage aggregated for one workspace",
      resolution_phase: "account",
    });
  });

  it("uses reviewed provider vocabulary labels and keeps a generic fallback", () => {
    const dimension = { namespace: "kmodels" as const, value: "operation" as const };
    const value = {
      namespace: "provider" as const,
      provider_id: providerId,
      value: "provider.event.create",
    };
    const condition: PriceCondition = {
      kind: "categorical",
      dimension,
      values: [value],
    };
    const atom: ProviderAtomRegistryEntry = {
      kind: "categorical_value",
      key: value.value,
      dimension,
      definition: "A provider event",
      label: "Text input",
    };

    expect(detail([condition], [atom]).pricing?.offers[0]?.selectors[0]).toMatchObject({
      kind: "categorical",
      values: [{ label: "Text input", value }],
    });
    const { label: _, ...unlabeledAtom } = atom;
    expect(detail([condition], [unlabeledAtom]).pricing?.offers[0]?.selectors[0]).toMatchObject({
      kind: "categorical",
      values: [{ label: "provider.event.create" }],
    });
  });

  it("projects recurring billing rules with categorical selector values", () => {
    const dimension = { namespace: "kmodels" as const, value: "billing_period" as const };
    const values = [
      { namespace: "provider" as const, provider_id: providerId, value: "off_peak" },
      { namespace: "provider" as const, provider_id: providerId, value: "peak" },
    ];
    const atoms: ProviderAtomRegistryEntry[] = [
      {
        kind: "categorical_value",
        key: "off_peak",
        dimension,
        definition: "All other times",
        label: "Off-peak",
        schedule: { kind: "daily_time_remainder", time_zone: "UTC" },
      },
      {
        kind: "categorical_value",
        key: "peak",
        dimension,
        definition: "Peak billing windows",
        label: "Peak",
        schedule: {
          kind: "daily_time_windows",
          time_zone: "UTC",
          windows: [
            { from: "01:00", until: "04:00" },
            { from: "06:00", until: "10:00" },
          ],
        },
      },
    ];

    expect(
      detail([{ kind: "categorical", dimension, values }], atoms).pricing?.offers[0]?.selectors[0],
    ).toMatchObject({
      kind: "categorical",
      values: expect.arrayContaining([
        expect.objectContaining({
          label: "Off-peak",
          value: values[0],
          schedule: { kind: "daily_time_remainder", time_zone: "UTC" },
        }),
        expect.objectContaining({
          label: "Peak",
          value: values[1],
          schedule: {
            kind: "daily_time_windows",
            time_zone: "UTC",
            windows: [
              { from: "01:00", until: "04:00" },
              { from: "06:00", until: "10:00" },
            ],
          },
        }),
      ]),
    });
  });

  it("uses range choices only for a complete non-overlapping numeric partition", () => {
    const partition = numericDetail([
      { upper: { value: "10", inclusive: true } },
      { lower: { value: "10", inclusive: false } },
    ]);
    expect(partition.pricing?.offers[0]?.selectors[0]).toMatchObject({
      kind: "decimal_buckets",
      values: [{ label: "≤ 10" }, { label: "> 10" }],
    });

    const boundedPartition = numericDetail([
      { upper: { value: "10", inclusive: true } },
      {
        lower: { value: "10", inclusive: false },
        upper: { value: "20", inclusive: false },
      },
      { lower: { value: "20", inclusive: true } },
    ]);
    expect(boundedPartition.pricing?.offers[0]?.selectors[0]).toMatchObject({
      kind: "decimal_buckets",
      values: [{ label: "≤ 10" }, { label: "> 10 and < 20" }, { label: "≥ 20" }],
    });

    const gap = numericDetail([
      { upper: { value: "10", inclusive: true } },
      { lower: { value: "20", inclusive: true } },
    ]);
    expect(gap.pricing?.offers[0]?.selectors[0]).toMatchObject({ kind: "decimal_range" });
  });

  it("projects a retained provider failure without audit details", () => {
    const verifiedAt = "2026-07-27T00:00:00.000Z";
    const attemptedAt = "2026-07-28T00:00:00.000Z";
    const detail = websiteModelDetail(
      {
        provider_vocabularies: [],
        provider_snapshots: [
          {
            provider_id: "test",
            observed_at: verifiedAt,
            publication: "retained",
            refresh_failure: {
              attempted_at: attemptedAt,
              code: "source_schema_changed",
            },
          },
        ],
        model_dispositions: [],
        books: [],
      },
      baseModel({
        providerId: "test",
        id: "model",
        name: "Model",
        sourceId: "test-catalog",
        observedAt: attemptedAt,
      }),
    );

    expect(detail.pricing).toMatchObject({
      snapshot: {
        observed_at: verifiedAt,
        publication: "retained",
        refresh_failure: {
          attempted_at: attemptedAt,
          message: "A required public pricing source no longer matched its reviewed format.",
        },
      },
      offers: [],
    });
  });
});
