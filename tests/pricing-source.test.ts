import { describe, expect, it } from "vite-plus/test";
import {
  sourcePriceFactKey,
  sourcePriceFactSchema,
  sourceRawPricingFactKey,
  sourceRawPricingFactSchema,
  type SourcePriceFact,
  type SourceRawPricingFact,
} from "../src/catalog/pricing-source.ts";

const rate: SourcePriceFact = {
  meter: "input_text",
  price: "1",
  currency: "USD",
  unit: "million_tokens",
  conditions: { region: "us", service_tier: "standard" },
  source_ref: "test-pricing",
  derived: false,
};

const raw: SourceRawPricingFact = {
  term_key: "input",
  impact: "base_price",
  reason: "unsupported_structure",
  conditions: rate.conditions,
  source_ref: rate.source_ref,
  raw: { amount: "1", unit: "1M tokens" },
};

describe("parsed pricing fact boundary", () => {
  it("rejects unrecognized qualifiers instead of publishing an unconditional rate", () => {
    const conditions = { geographic_zone: "special" };
    expect(sourcePriceFactSchema.safeParse({ ...rate, conditions }).success).toBe(false);
    expect(sourceRawPricingFactSchema.safeParse({ ...raw, conditions }).success).toBe(false);
    expect(sourcePriceFactSchema.safeParse({ ...rate, multiplier: "2" }).success).toBe(false);
  });

  it("uses order-independent identities for normalized and raw source facts", () => {
    const conditions = { service_tier: "standard", region: "us", endpoint: undefined };
    expect(sourcePriceFactKey({ ...rate, conditions })).toBe(sourcePriceFactKey(rate));
    expect(
      sourceRawPricingFactKey({
        ...raw,
        conditions,
        raw: { unit: "1M tokens", amount: "1" },
      }),
    ).toBe(sourceRawPricingFactKey(raw));
    expect(sourcePriceFactKey({ ...rate, conditions: { region: "eu" } })).not.toBe(
      sourcePriceFactKey(rate),
    );
  });
});
