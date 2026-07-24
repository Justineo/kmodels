import { describe, expect, it } from "vite-plus/test";
import {
  formatRateUnit,
  formatTableRateUnit,
  perMillionTokenRate,
} from "../src/catalog/presentation.ts";
import type { PriceRate } from "../src/catalog/schema.ts";

function rate(price: string, unit: PriceRate["unit"]): PriceRate {
  return {
    meter: "input_text",
    price,
    currency: "USD",
    unit,
    conditions: {},
    source_ref: "test",
    derived: false,
  };
}

describe("rate presentation", () => {
  it("normalizes comparable token prices to one million tokens", () => {
    expect(perMillionTokenRate(rate("0.000002", "token"))).toMatchObject({
      price: "2",
      unit: "million_tokens",
    });
    expect(perMillionTokenRate(rate("0.003", "thousand_tokens"))).toMatchObject({
      price: "3",
      unit: "million_tokens",
    });
  });

  it("preserves rates that do not use a directly comparable token unit", () => {
    const value = rate("4", "million_characters");
    expect(perMillionTokenRate(value)).toBe(value);
  });

  it("uses compact, explicit unit labels", () => {
    expect(formatRateUnit(rate("2", "million_tokens"))).toBe("/1M tokens");
    expect(formatRateUnit(rate("4", "million_characters"))).toBe("/1M characters");
  });

  it("omits the table default while preserving exceptional units", () => {
    expect(formatTableRateUnit(rate("2", "million_tokens"))).toBe("");
    expect(formatTableRateUnit(rate("4", "million_characters"))).toBe("/1M characters");
  });
});
