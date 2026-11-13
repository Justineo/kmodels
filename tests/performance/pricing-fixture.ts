import { canonicalJson } from "../../src/catalog/canonical-value.ts";
import { unconditionalApplicability } from "../../src/catalog/pricing-canonical.ts";
import type {
  CommercialChoice,
  PriceApplicability,
  PriceCondition,
} from "../../src/catalog/pricing-schema.ts";
import type {
  WebsiteInferencePrice,
  WebsitePricingOffer,
  WebsitePricingSelector,
} from "../../src/catalog/website-schema.ts";

export interface PricingPerformanceCase {
  name: string;
  modelRef: string;
  prices: WebsiteInferencePrice[];
  offers: WebsitePricingOffer[];
}

export const fixtureInstant = "2026-01-01T00:00:00.000Z";
export function commercialChoice(
  dimension: CommercialChoice["dimension"],
  value: string,
): CommercialChoice {
  return { dimension, value: { namespace: "kmodels", value } };
}
function category(
  dimension: "region" | "service_tier" | "speed" | "execution",
  value: string,
): PriceCondition {
  return {
    kind: "categorical",
    dimension: { namespace: "kmodels", value: dimension },
    values: [{ namespace: "kmodels", value }],
  };
}

/** Fixed scale and correlated scopes reproduce the regression without volatile provider prices. */
export function pricingPerformanceFixture(regionCount = 24): PricingPerformanceCase {
  const modelRef = "fixture/regional-model";
  const offerId = "a".repeat(64);
  const inputId = "b".repeat(64);
  const cacheId = "c".repeat(64);
  const regions = Array.from({ length: regionCount }, (_, i) => `region-${i}`);
  const modes = [
    [commercialChoice("service_tier", "standard"), commercialChoice("speed", "standard")],
    [commercialChoice("service_tier", "standard"), commercialChoice("speed", "optimized")],
    [commercialChoice("service_tier", "priority")],
    [commercialChoice("service_tier", "flex")],
  ];
  const contexts = regions.flatMap((region) =>
    modes.map((choices) => {
      const bindings = choices.map(({ dimension, value }) =>
        category(dimension === "speed" ? "speed" : "service_tier", value.value),
      );
      const applicability: PriceApplicability = {
        any_of: [
          { all_of: [category("region", region), category("execution", "request"), ...bindings] },
        ],
      };
      return { choices, applicability };
    }),
  );
  const ttl: PriceCondition = {
    kind: "decimal_range",
    dimension: { namespace: "kmodels", value: "cache_ttl_seconds" },
    unit: { factors: [{ unit: { namespace: "kmodels", value: "second" }, power: 1 }] },
    lower: { value: "300", inclusive: true },
    upper: { value: "300", inclusive: true },
  };
  const inputVariants = contexts.map(({ applicability }, semantics) => ({
    applicability,
    semantics,
  }));
  const cacheVariants = contexts.map(({ applicability }, semantics) => ({
    applicability: {
      any_of: applicability.any_of.map(({ all_of }) => ({ all_of: [...all_of, ttl] })),
    },
    semantics,
  }));
  const claims = contexts.flatMap(({ choices, applicability }, i) => {
    const cached = cacheVariants[i];
    if (cached === undefined) throw new Error("Missing fixture cache variant");
    return [applicability, cached.applicability].flatMap((scope) =>
      [...choices, commercialChoice("execution", "request")].map((choice) => ({
        dimension: choice.dimension,
        target: "condition" as const,
        coverage: "complete" as const,
        applicability: scope,
        alternatives: [
          {
            value: choice.value,
            applicability: {
              any_of: [
                {
                  all_of: [
                    category(
                      choice.dimension === "speed"
                        ? "speed"
                        : choice.dimension === "execution"
                          ? "execution"
                          : "service_tier",
                      choice.value.value,
                    ),
                  ],
                },
              ],
            },
          },
        ],
      })),
    );
  });
  const selectors: WebsitePricingSelector[] = [
    ...(
      [
        ["region", regions],
        ["service_tier", ["standard", "priority", "flex"]],
        ["speed", ["standard", "optimized"]],
        ["execution", ["request"]],
      ] as const
    ).map(([dimension, values]) => ({
      key: canonicalJson({ namespace: "kmodels", value: dimension }),
      label: dimension,
      dimension: { namespace: "kmodels" as const, value: dimension },
      kind: "categorical" as const,
      values: values.map((value) => ({
        key: canonicalJson({ namespace: "kmodels", value }),
        label: value,
        value: { namespace: "kmodels" as const, value },
      })),
    })),
    {
      key: canonicalJson(ttl.dimension),
      label: "Cache TTL",
      dimension: ttl.dimension,
      kind: "decimal_values",
      unit: ttl.unit,
      values: ["300"],
    },
  ];
  const terms = [
    { id: inputId, kind: "rate" as const, variants: inputVariants, raw_variants: [] },
    { id: cacheId, kind: "rate" as const, variants: cacheVariants, raw_variants: [] },
  ];
  const offer: WebsitePricingOffer = {
    id: offerId,
    title: "Public rates",
    group: "model_mechanism",
    billing_mode: { label: "Usage" },
    state_summary: "Metered pricing",
    commercial_selection: { observed_at: fixtureInstant, claims },
    selectors,
    states: [],
    allowances: [],
    contributions: [],
    enrollment: [],
    settlement: [],
    unnormalized_count: 0,
    unnormalized: [],
    rates: terms.flatMap((term) =>
      term.variants.map(({ applicability }, index) => ({
        key: `${term.id}:rate:${index}`,
        term_ref: term.id,
        label: term.id === inputId ? "Input" : "Cache write",
        amount: `$${Math.floor(index / modes.length) + 2}`,
        unit: "per 1M tokens",
        accessible_text: `$${Math.floor(index / modes.length) + 2} per 1M tokens`,
        applicability,
        applicability_label: "Regional tariff",
      })),
    ),
  };
  return {
    name: `synthetic-${regionCount}-regions`,
    modelRef,
    offers: [offer],
    prices: [
      {
        model_id: "fixture.model-v1",
        status: "candidates",
        explanation: "Select published conditions.",
        missing_conditions: ["Region", "Service tier", "Speed"],
        evidence_urls: [],
        candidates: [],
        pricing_options: selectors,
        matching: {
          generated_at: fixtureInstant,
          observed_at: fixtureInstant,
          rules: [{ model_ref: modelRef, offer_refs: [offerId], fixed_selectors: [] }],
          offers: [
            {
              id: offerId,
              selection: claims,
              states: [
                { state: "numeric", applicability: unconditionalApplicability, semantics: 0 },
              ],
              relations: [],
              terms,
            },
          ],
          referenced_rates: [],
        },
      },
    ],
  };
}
