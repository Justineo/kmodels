import { describe, expect, it } from "vite-plus/test";
import {
  canonicalizeDecimalBound,
  canonicalizeQuantity,
  canonicalizeSourceUnit,
  canonicalizeUnitPrice,
} from "../src/catalog/pricing-units.ts";

const usd = { kind: "fiat" as const, currency: "USD" };

describe("pricing fixed-unit conversion", () => {
  it("normalizes equivalent denominator prices to one value", () => {
    const hour = canonicalizeSourceUnit([
      {
        unit: { namespace: "kmodels", value: "second" },
        power: 1,
        scale: "hour",
      },
    ]);
    const minute = canonicalizeSourceUnit([
      {
        unit: { namespace: "kmodels", value: "second" },
        power: 1,
        scale: "minute",
      },
    ]);
    expect(canonicalizeUnitPrice({ numerator: "60", denominator: "1" }, usd, hour)).toEqual(
      canonicalizeUnitPrice({ numerator: "1", denominator: "1" }, usd, minute),
    );
    expect(canonicalizeUnitPrice({ numerator: "60", denominator: "1" }, usd, hour)).toEqual({
      value: { numerator: "1", denominator: "60" },
      denomination: usd,
      per: {
        factors: [{ unit: { namespace: "kmodels", value: "second" }, power: 1 }],
      },
    });
  });

  it("keeps storage token-time in the denominator", () => {
    const tokenHour = canonicalizeSourceUnit([
      {
        unit: { namespace: "kmodels", value: "token" },
        power: 1,
        scale: "million",
      },
      {
        unit: { namespace: "kmodels", value: "second" },
        power: 1,
        scale: "hour",
      },
    ]);
    expect(tokenHour).toEqual({
      scale: { numerator: "3600000000", denominator: "1" },
      unit: {
        factors: [
          { unit: { namespace: "kmodels", value: "second" }, power: 1 },
          { unit: { namespace: "kmodels", value: "token" }, power: 1 },
        ],
      },
    });
    expect(
      canonicalizeSourceUnit([
        {
          unit: { namespace: "kmodels", value: "byte" },
          power: 1,
          scale: "gibibyte",
        },
        {
          unit: { namespace: "kmodels", value: "second" },
          power: 1,
          scale: "day",
        },
      ]).scale,
    ).toEqual({ numerator: "92771293593600", denominator: "1" });
  });

  it("multiplies quantities and decimal bounds in the opposite direction", () => {
    const hour = canonicalizeSourceUnit([
      {
        unit: { namespace: "kmodels", value: "second" },
        power: 1,
        scale: "hour",
      },
    ]);
    expect(canonicalizeQuantity({ numerator: "1", denominator: "1" }, hour)).toEqual({
      value: { numerator: "3600", denominator: "1" },
      unit: {
        factors: [{ unit: { namespace: "kmodels", value: "second" }, power: 1 }],
      },
    });
    expect(canonicalizeDecimalBound("1.5", hour)).toBe("5400");
  });

  it("applies factor powers and rejects invalid scale/unit combinations", () => {
    expect(
      canonicalizeSourceUnit([
        {
          unit: { namespace: "kmodels", value: "token" },
          power: 2,
          scale: "thousand",
        },
      ]).scale,
    ).toEqual({ numerator: "1000000", denominator: "1" });
    expect(() =>
      canonicalizeSourceUnit([
        {
          unit: { namespace: "kmodels", value: "token" },
          power: 1,
          scale: "hour",
        },
      ]),
    ).toThrow("Time scale requires");
  });
});
