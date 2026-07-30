import { describe, expect, it } from "vite-plus/test";
import {
  assembleProviderPricing,
  type AtomicProviderPricing,
  type AtomicRateVariant,
} from "../src/catalog/pricing-assembly.ts";
import { unconditionalApplicability } from "../src/catalog/pricing-canonical.ts";
import {
  pricingBookId,
  pricingOfferId,
  pricingTermId,
} from "../src/catalog/pricing-identifiers.ts";
import type {
  NormalizedPriceObservation,
  PriceApplicability,
  PricingCatalog,
} from "../src/catalog/pricing-schema.ts";
import { validatePricingCatalog } from "../src/catalog/pricing-validation.ts";
import type { Catalog } from "../src/catalog/schema.ts";

const providerId = "test";
const modelRef = "test/model";
const sourceRef = "test-pricing";
const instant = "2026-07-28T00:00:00.000Z";

const core = {
  providers: [{ id: providerId }],
  models: [
    {
      uid: modelRef,
      provider_id: providerId,
    },
  ],
  sources: [{ id: sourceRef, provider_id: providerId }],
} as unknown as Pick<Catalog, "models" | "providers" | "sources">;

function region(value: "EU" | "US"): PriceApplicability {
  return {
    any_of: [
      {
        all_of: [
          {
            kind: "categorical",
            dimension: { namespace: "kmodels", value: "region" },
            values: [{ namespace: "provider", provider_id: providerId, value }],
          },
        ],
      },
    ],
  };
}

function observation(
  applicability: PriceApplicability,
  locator: string,
  amount = "2",
): NormalizedPriceObservation {
  return {
    source_ref: sourceRef,
    locator: { kind: "table", value: locator },
    raw: { amount, denomination: "USD", unit: "million tokens" },
    establishes_applicability: applicability,
  };
}

function rate(
  applicability: PriceApplicability,
  locator: string,
  denominator = "500000",
): AtomicRateVariant {
  return {
    price: {
      value: { numerator: "1", denominator },
      denomination: { kind: "fiat", currency: "USD" },
      per: {
        factors: [{ unit: { namespace: "kmodels", value: "token" }, power: 1 }],
      },
    },
    applicability,
    observation: observation(applicability, locator),
  };
}

function input(rates: AtomicRateVariant[]): AtomicProviderPricing {
  return {
    provider_id: providerId,
    observed_at: instant,
    vocabulary: {
      provider_id: providerId,
      atoms: ["EU", "US"].map((key) => ({
        kind: "categorical_value" as const,
        key,
        dimension: { namespace: "kmodels" as const, value: "region" as const },
        definition: `${key} price region`,
      })),
    },
    dispositions: [],
    books: [
      {
        book_key: "public",
        scope: { kind: "models", model_refs: [modelRef] },
        scope_observations: [
          {
            source_ref: sourceRef,
            locator: { kind: "table", value: "heading" },
            establishes: { kind: "models", model_refs: [modelRef] },
            raw: { label: "Public model pricing" },
          },
        ],
        source_refs: [sourceRef],
        offers: [
          {
            role: "base",
            offer_key: "usage",
            billing_mode: { namespace: "kmodels", value: "usage" },
            states: [
              {
                state: "numeric",
                applicability: unconditionalApplicability,
                observation: {
                  source_ref: sourceRef,
                  locator: { kind: "table", value: "heading, usage" },
                  raw: { label: "Usage pricing" },
                  establishes_applicability: unconditionalApplicability,
                },
              },
            ],
            terms: [
              {
                kind: "rate",
                term_key: "input-text",
                meter: { namespace: "kmodels", value: "input_text" },
                variants: rates,
                raw_variants: [],
                source_refs: [sourceRef],
              },
            ],
            source_refs: [sourceRef],
          },
        ],
      },
    ],
  };
}

function assemble(value: AtomicProviderPricing) {
  const partition = assembleProviderPricing(value);
  const catalog: PricingCatalog = {
    provider_vocabularies: [partition.vocabulary],
    provider_snapshots: [partition.snapshot],
    model_dispositions: partition.model_dispositions,
    books: partition.books,
  };
  validatePricingCatalog(catalog, core);
  return partition;
}

describe("canonical pricing canonical assembly", () => {
  it("compacts equal regional observations without losing evidence", () => {
    const source = input([rate(region("US"), "US"), rate(region("EU"), "EU")]);
    const partition = assemble(source);
    const term = partition.books[0]!.offers[0]!.terms[0]!;
    if (term.kind !== "rate") throw new Error("fixture term is not a rate");
    expect(term.variants).toHaveLength(1);
    expect(term.variants[0]!.applicability.any_of).toHaveLength(2);
    expect(term.variants[0]!.observations).toHaveLength(2);
  });

  it("downgrades every value involved in an unequal overlap", () => {
    const source = input([
      rate(unconditionalApplicability, "standard"),
      rate(unconditionalApplicability, "conflict", "400000"),
    ]);
    const term = assemble(source).books[0]!.offers[0]!.terms[0]!;
    if (term.kind !== "rate") throw new Error("fixture term is not a rate");
    expect(term.variants).toEqual([]);
    expect(term.raw_variants).toHaveLength(1);
    expect(term.raw_variants[0]!.reason).toBe("conflicting_values");
    expect(term.raw_variants[0]!.observations).toHaveLength(2);
  });

  it("retains values outside an unequal-overlap component", () => {
    const source = input([
      rate(region("US"), "us-standard"),
      rate(region("US"), "us-conflict", "400000"),
      rate(region("EU"), "eu"),
    ]);
    const term = assemble(source).books[0]!.offers[0]!.terms[0]!;
    if (term.kind !== "rate") throw new Error("fixture term is not a rate");
    expect(term.variants).toHaveLength(1);
    expect(term.variants[0]!.observations[0]!.locator.value).toBe("eu");
    expect(term.raw_variants).toHaveLength(1);
    expect(term.raw_variants[0]!.reason).toBe("conflicting_values");
    expect(term.raw_variants[0]!.observations.map(({ locator }) => locator.value)).toEqual([
      "us-conflict",
      "us-standard",
    ]);
  });

  it("keeps unequal values in disjoint validity intervals", () => {
    const introductory = rate(unconditionalApplicability, "introductory");
    introductory.validity = { until: { value: "2026-08-31", precision: "date" } };
    const standard = rate(unconditionalApplicability, "standard", "400000");
    standard.validity = { from: { value: "2026-09-01", precision: "date" } };
    const term = assemble(input([introductory, standard])).books[0]!.offers[0]!.terms[0]!;
    if (term.kind !== "rate") throw new Error("fixture term is not a rate");
    expect(term.variants).toHaveLength(2);
    expect(term.raw_variants).toEqual([]);
  });

  it("contains a state/rate conflict in the complete base-price layer", () => {
    const source = input([rate(unconditionalApplicability, "rate")]);
    source.books[0]!.offers[0]!.states[0]!.state = "free";
    const offer = assemble(source).books[0]!.offers[0]!;
    expect(offer.states).toEqual([]);
    const stateTerm = offer.terms.find(({ term_key }) => term_key === "kmodels.offer-state");
    expect(stateTerm?.kind).toBe("raw");
    expect(
      offer.terms
        .filter((term) => term.kind === "rate")
        .flatMap((term) => term.raw_variants)
        .every(({ reason }) => reason === "conflicting_values"),
    ).toBe(true);
  });

  it("cascades a raw target rate into its dependent allowance", () => {
    const source = input([
      rate(unconditionalApplicability, "standard"),
      rate(unconditionalApplicability, "conflict", "400000"),
    ]);
    const offer = source.books[0]!.offers[0]!;
    const offerId = pricingOfferId(pricingBookId(providerId, "public"), "usage");
    offer.terms.push({
      kind: "allowance",
      term_key: "monthly-tokens",
      source_refs: [sourceRef],
      raw_variants: [],
      variants: [
        {
          benefit: {
            kind: "usage",
            quantity: {
              value: { numerator: "1000", denominator: "1" },
              unit: {
                factors: [{ unit: { namespace: "kmodels", value: "token" }, power: 1 }],
              },
            },
          },
          target: {
            kind: "usage_rate_terms",
            term_refs: [pricingTermId(offerId, "input-text")],
          },
          reset: { namespace: "kmodels", value: "monthly" },
          applicability: unconditionalApplicability,
          observation: observation(unconditionalApplicability, "allowance", "1000"),
        },
      ],
    });
    const allowance = assemble(source).books[0]!.offers[0]!.terms.find(
      ({ term_key }) => term_key === "monthly-tokens",
    );
    expect(allowance?.kind).toBe("allowance");
    if (allowance?.kind !== "allowance") return;
    expect(allowance.variants).toEqual([]);
    expect(allowance.raw_variants[0]!.reason).toBe("target_rate_not_normalized");
  });

  it("uses the conservative single-parent numeric-state containment rule", () => {
    const source = input([
      rate(
        {
          any_of: [
            {
              all_of: [
                {
                  kind: "categorical",
                  dimension: { namespace: "kmodels", value: "region" },
                  values: [
                    { namespace: "provider", provider_id: providerId, value: "EU" },
                    { namespace: "provider", provider_id: providerId, value: "US" },
                  ],
                },
              ],
            },
          ],
        },
        "combined",
      ),
    ]);
    source.books[0]!.offers[0]!.states = [
      {
        state: "numeric",
        applicability: region("US"),
        observation: observation(region("US"), "state US"),
      },
      {
        state: "numeric",
        applicability: region("EU"),
        observation: observation(region("EU"), "state EU"),
      },
    ];
    const term = assemble(source).books[0]!.offers[0]!.terms[0]!;
    if (term.kind !== "rate") throw new Error("fixture term is not a rate");
    expect(term.variants).toEqual([]);
    expect(term.raw_variants[0]!.reason).toBe("unsupported_structure");
  });

  it("rejects an all-contradictory atomic selector instead of widening it", () => {
    const contradictory: PriceApplicability = {
      any_of: [
        {
          all_of: [
            {
              kind: "categorical",
              dimension: { namespace: "kmodels", value: "region" },
              values: [{ namespace: "provider", provider_id: providerId, value: "EU" }],
            },
            {
              kind: "categorical",
              dimension: { namespace: "kmodels", value: "region" },
              values: [{ namespace: "provider", provider_id: providerId, value: "US" }],
            },
          ],
        },
      ],
    };
    expect(() => assembleProviderPricing(input([rate(contradictory, "false")]))).toThrow(
      "no satisfiable clause",
    );
  });
});
