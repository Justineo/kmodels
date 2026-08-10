import { describe, expect, it } from "vite-plus/test";
import { baseModel } from "../src/catalog/model.ts";
import { unconditionalApplicability } from "../src/catalog/pricing-canonical.ts";
import {
  pricingBookId,
  pricingOfferId,
  pricingTermId,
} from "../src/catalog/pricing-identifiers.ts";
import type {
  PriceApplicability,
  PriceCondition,
  PricingCatalog,
  ProviderAtomRegistryEntry,
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

type DecimalCondition = Extract<PriceCondition, { kind: "decimal_range" }>;

function numericDetail(ranges: Array<Omit<DecimalCondition, "dimension" | "kind" | "unit">>) {
  const conditions = ranges.map(
    (range): DecimalCondition => ({
      kind: "decimal_range",
      dimension: durationDimension,
      unit: secondUnit,
      ...range,
    }),
  );
  return detail(conditions);
}

function detail(
  conditions: PriceCondition[],
  atoms: ProviderAtomRegistryEntry[] = [],
  includeContribution = false,
) {
  const applicability = conditions.map((condition) => ({ any_of: [{ all_of: [condition] }] }));
  const observation = (establishes: PriceApplicability) => ({
    source_ref: sourceId,
    locator: { kind: "table" as const, value: "row" },
    raw: { label: "Price" },
    establishes_applicability: establishes,
  });
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
                observations: [observation(unconditionalApplicability)],
              },
            ],
            enrollment: [],
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
                  observations: [observation(scope)],
                })),
                raw_variants: [],
              },
              ...(includeContribution
                ? [
                    {
                      id: pricingTermId(offerId, "contribution", "additional-input"),
                      term_key: "additional-input",
                      kind: "contribution" as const,
                      source_refs: [sourceId],
                      variants: [
                        {
                          target_rate_refs: [pricingTermId(offerId, "rate", "input")],
                          applicability: unconditionalApplicability,
                          charge_bindings: [],
                          observations: [observation(unconditionalApplicability)],
                        },
                      ],
                      raw_variants: [],
                    },
                  ]
                : []),
            ],
            relations: [],
            settlement: [],
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
  it("projects additional usage without copying its target rate", () => {
    expect(detail([], [], true).pricing?.offers[0]?.contributions).toEqual([
      expect.objectContaining({
        label: "Additional input",
        target: "Priced by Usage · Input text",
      }),
    ]);
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
