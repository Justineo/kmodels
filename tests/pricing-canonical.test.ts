import { describe, expect, it } from "vite-plus/test";
import {
  applicabilitiesOverlap,
  applicabilityContainedIn,
  canonicalizeApplicability,
  normalizeUnitExpression,
  selectorWeight,
  unionApplicabilities,
} from "../src/catalog/pricing-canonical.ts";
import {
  pricingBookId,
  pricingOfferId,
  pricingTermId,
} from "../src/catalog/pricing-identifiers.ts";
import {
  divideRationals,
  multiplyRationals,
  normalizeRational,
  rationalFromDecimal,
} from "../src/catalog/pricing-rational.ts";
import type {
  PriceApplicability,
  PriceCondition,
  PriceDimension,
} from "../src/catalog/pricing-schema.ts";

const region: PriceDimension = { namespace: "kmodels", value: "region" };
const tier: PriceDimension = { namespace: "kmodels", value: "service_tier" };

function categorical(dimension: PriceDimension, ...values: string[]): PriceCondition {
  return {
    kind: "categorical",
    dimension,
    values: values.map((value) => ({
      namespace: "provider",
      provider_id: "test",
      value,
    })),
  };
}

function applicability(...clauses: PriceCondition[][]): PriceApplicability {
  return { any_of: clauses.map((all_of) => ({ all_of })) };
}

describe("canonical pricing canonical primitives", () => {
  it("derives stable domain-separated resource IDs", () => {
    const book = pricingBookId("test", "public");
    const offer = pricingOfferId(book, "usage");
    const term = pricingTermId(offer, "input-text");
    expect([book, offer, term].every((id) => /^[0-9a-f]{64}$/.test(id))).toBe(true);
    expect(new Set([book, offer, term])).toHaveLength(3);
    expect(pricingTermId(offer, "input-text")).toBe(term);
  });

  it("normalizes and bounds exact rational arithmetic", () => {
    expect(rationalFromDecimal("60.00")).toEqual({ numerator: "60", denominator: "1" });
    expect(normalizeRational(2n, 120n)).toEqual({ numerator: "1", denominator: "60" });
    expect(
      multiplyRationals(
        { numerator: "1", denominator: "60" },
        { numerator: "3600", denominator: "1" },
      ),
    ).toEqual({ numerator: "60", denominator: "1" });
    expect(
      divideRationals(
        { numerator: "60", denominator: "1" },
        { numerator: "3600", denominator: "1" },
      ),
    ).toEqual({ numerator: "1", denominator: "60" });
    expect(() => normalizeRational(BigInt("9".repeat(129)))).toThrow("digit limit");
  });

  it("combines repeated unit identities before sorting", () => {
    expect(
      normalizeUnitExpression({
        factors: [
          { unit: { namespace: "kmodels", value: "token" }, power: 1 },
          { unit: { namespace: "kmodels", value: "second" }, power: 1 },
          { unit: { namespace: "kmodels", value: "token" }, power: 2 },
        ],
      }),
    ).toEqual({
      factors: [
        { unit: { namespace: "kmodels", value: "second" }, power: 1 },
        { unit: { namespace: "kmodels", value: "token" }, power: 3 },
      ],
    });
  });

  it("intersects repeated conditions, removes false disjuncts, and preserves correlation", () => {
    const normalized = canonicalizeApplicability(
      applicability(
        [categorical(region, "US", "EU"), categorical(region, "EU")],
        [categorical(region, "CA"), categorical(region, "US")],
        [categorical(region, "US"), categorical(tier, "standard")],
      ),
    );
    expect(normalized.any_of).toHaveLength(2);
    expect(normalized.any_of).toContainEqual({ all_of: [categorical(region, "EU")] });
    expect(normalized.any_of).toContainEqual({
      all_of: [categorical(region, "US"), categorical(tier, "standard")],
    });
  });

  it("rejects an all-contradictory selector", () => {
    expect(() =>
      canonicalizeApplicability(
        applicability([categorical(region, "US"), categorical(region, "EU")]),
      ),
    ).toThrow("no satisfiable clause");
    expect(() =>
      canonicalizeApplicability(
        applicability([
          {
            kind: "decimal_range",
            dimension: { namespace: "kmodels", value: "duration_seconds" },
            unit: {
              factors: [{ unit: { namespace: "kmodels", value: "second" }, power: 1 }],
            },
            lower: { value: "2", inclusive: true },
            upper: { value: "1", inclusive: true },
          },
        ]),
      ),
    ).toThrow("no satisfiable clause");
  });

  it("uses conservative overlap and single-parent containment", () => {
    const usStandard = canonicalizeApplicability(
      applicability([categorical(region, "US"), categorical(tier, "standard")]),
    );
    const usOrEu = canonicalizeApplicability(
      applicability([categorical(region, "US")], [categorical(region, "EU")]),
    );
    const usAndEuValues = canonicalizeApplicability(
      applicability([categorical(region, "US", "EU")]),
    );

    expect(applicabilitiesOverlap(usStandard, usOrEu)).toBe(true);
    expect(applicabilityContainedIn(usStandard, usOrEu)).toBe(true);
    expect(applicabilityContainedIn(usAndEuValues, usOrEu)).toBe(false);
    expect(unionApplicabilities([usStandard, usStandard])).toEqual(usStandard);
  });

  it("computes the exact selector weight", () => {
    expect(
      selectorWeight(
        applicability([
          categorical(region, "US", "EU"),
          { kind: "boolean", dimension: { namespace: "kmodels", value: "promotion" }, value: true },
          {
            kind: "decimal_range",
            dimension: { namespace: "kmodels", value: "context_tokens" },
            unit: {
              factors: [{ unit: { namespace: "kmodels", value: "token" }, power: 1 }],
            },
            lower: { value: "1", inclusive: true },
          },
        ]),
      ),
    ).toBe(9);
  });
});
