import { describe, expect, it } from "vite-plus/test";
import { validateUsageQuantityCalculation } from "../src/catalog/pricing-calculation.ts";
import { rationalFromDecimal, roundUpRational } from "../src/catalog/pricing-rational.ts";
import type { UsageSignal } from "../src/catalog/pricing-schema.ts";

const half = { numerator: "1", denominator: "2" };
const ten = { numerator: "10", denominator: "1" };
const signal: UsageSignal = { namespace: "kmodels", value: "input_tokens" };

describe("roundUpRational", () => {
  it("rounds zero to zero and keeps exact multiples", () => {
    expect(roundUpRational(rationalFromDecimal("0"), ten)).toEqual(rationalFromDecimal("0"));
    expect(roundUpRational(rationalFromDecimal("20"), ten)).toEqual(rationalFromDecimal("20"));
    expect(roundUpRational(rationalFromDecimal("1.5"), half)).toEqual(rationalFromDecimal("1.5"));
  });
  it("ceilings to the next increment, including fractional increments", () => {
    expect(roundUpRational(rationalFromDecimal("7"), ten)).toEqual(rationalFromDecimal("10"));
    expect(roundUpRational(rationalFromDecimal("1.6"), half)).toEqual(rationalFromDecimal("2"));
    expect(roundUpRational(rationalFromDecimal("0.01"), half)).toEqual(rationalFromDecimal("0.5"));
  });
  it("rejects a zero increment", () => {
    expect(() =>
      roundUpRational(rationalFromDecimal("1"), { numerator: "0", denominator: "1" }),
    ).toThrow("Billing increment must be positive");
  });
});

describe("validateUsageQuantityCalculation", () => {
  it("rejects repeated signals", () => {
    expect(() =>
      validateUsageQuantityCalculation({
        nodes: [
          { op: "signal", signal },
          { op: "signal", signal },
          { op: "sum", inputs: [0, 1] },
        ],
        result: 2,
      }),
    ).toThrow("repeats a usage signal");
  });
  it("rejects a zero billing increment", () => {
    expect(() =>
      validateUsageQuantityCalculation({
        nodes: [
          { op: "signal", signal },
          { op: "round_up", input: 0, increment: { numerator: "0", denominator: "1" } },
        ],
        result: 1,
      }),
    ).toThrow("Billing increment must be positive");
  });
});
