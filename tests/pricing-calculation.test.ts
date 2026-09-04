import { describe, expect, it } from "vite-plus/test";
import {
  evaluateChargeQuantity,
  evaluateRateCost,
  requiredUsageSignals,
  validateUsageQuantityCalculation,
} from "../src/catalog/pricing-calculation.ts";
import { rationalFromDecimal } from "../src/catalog/pricing-rational.ts";
import type {
  ChargeBinding,
  PriceRateVariant,
  UsageQuantityCalculation,
  UsageSignal,
} from "../src/catalog/pricing-schema.ts";

const total: UsageSignal = { namespace: "kmodels", value: "input_tokens" };
const cached: UsageSignal = { namespace: "kmodels", value: "cached_input_tokens" };
const uncached: UsageSignal = { namespace: "kmodels", value: "uncached_input_tokens" };
const active: UsageSignal = { namespace: "kmodels", value: "active_seconds" };

function binding(signal: UsageSignal, calculation?: UsageQuantityCalculation): ChargeBinding {
  return {
    signal,
    aggregation: "request",
    ...(calculation === undefined ? {} : { quantity_methods: [{ calculation }] }),
    observations: [
      {
        source_ref: "pricing",
        locator: { kind: "table", value: "usage" },
        raw: { fragment: "Usage contract" },
      },
    ],
  };
}

describe("usage quantity calculation", () => {
  it("derives an uncached partition without allowing a negative quantity", () => {
    const calculation: UsageQuantityCalculation = {
      nodes: [
        { op: "signal", signal: total },
        { op: "signal", signal: cached },
        { op: "subtract_floor_zero", minuend: 0, subtrahend: 1 },
      ],
      result: 2,
    };
    const contract = binding(uncached, calculation);

    expect(requiredUsageSignals(contract)).toEqual([cached, total]);
    expect(
      evaluateChargeQuantity(contract, [
        { signal: total, value: rationalFromDecimal("100") },
        { signal: cached, value: rationalFromDecimal("20") },
      ]),
    ).toEqual({ kind: "resolved", value: rationalFromDecimal("80") });
    expect(
      evaluateChargeQuantity(contract, [
        { signal: total, value: rationalFromDecimal("10") },
        { signal: cached, value: rationalFromDecimal("20") },
      ]),
    ).toEqual({ kind: "resolved", value: rationalFromDecimal("0") });
  });

  it("subtracts a unit-qualified included quantity", () => {
    const items: UsageSignal = { namespace: "kmodels", value: "generated_items" };
    const calculation: UsageQuantityCalculation = {
      nodes: [
        { op: "signal", signal: items },
        {
          op: "constant",
          value: rationalFromDecimal("10"),
          unit: {
            factors: [{ unit: { namespace: "kmodels", value: "item" }, power: 1 }],
          },
        },
        { op: "subtract_floor_zero", minuend: 0, subtrahend: 1 },
      ],
      result: 2,
    };
    const contract = binding(items, calculation);

    expect(requiredUsageSignals(contract)).toEqual([items]);
    expect(
      evaluateChargeQuantity(contract, [{ signal: items, value: rationalFromDecimal("14") }]),
    ).toEqual({ kind: "resolved", value: rationalFromDecimal("4") });
  });

  it("applies a minimum billable quantity", () => {
    const contract = binding(active, {
      nodes: [
        { op: "signal", signal: active },
        { op: "minimum", input: 0, value: rationalFromDecimal("300") },
      ],
      result: 1,
    });

    expect(
      evaluateChargeQuantity(contract, [{ signal: active, value: rationalFromDecimal("61") }]),
    ).toEqual({ kind: "resolved", value: rationalFromDecimal("300") });
    expect(
      evaluateChargeQuantity(contract, [{ signal: active, value: rationalFromDecimal("301") }]),
    ).toEqual({ kind: "resolved", value: rationalFromDecimal("301") });

    const variant: PriceRateVariant = {
      price: {
        value: rationalFromDecimal("0.001"),
        denomination: { kind: "fiat", currency: "USD" },
        per: {
          factors: [{ unit: { namespace: "kmodels", value: "second" }, power: 1 }],
        },
      },
      applicability: { any_of: [{ all_of: [] }] },
      charge_binding: contract,
      observations: [
        {
          source_ref: "pricing",
          locator: { kind: "table", value: "rate" },
          establishes_applicability: { any_of: [{ all_of: [] }] },
          raw: { amount: "0.001", unit: "second" },
        },
      ],
    };
    expect(
      evaluateRateCost(variant, [{ signal: active, value: rationalFromDecimal("61") }]),
    ).toEqual({
      kind: "resolved",
      amount: rationalFromDecimal("0.3"),
      denomination: { kind: "fiat", currency: "USD" },
    });
  });

  it("multiplies independently observed quantities", () => {
    const outputs: UsageSignal = { namespace: "kmodels", value: "generated_items" };
    const duration: UsageSignal = { namespace: "kmodels", value: "generated_seconds" };
    const contract = binding(duration, {
      nodes: [
        { op: "signal", signal: outputs },
        { op: "signal", signal: duration },
        { op: "product", inputs: [0, 1] },
      ],
      result: 2,
    });

    expect(
      evaluateChargeQuantity(contract, [
        { signal: outputs, value: rationalFromDecimal("3") },
        { signal: duration, value: rationalFromDecimal("8") },
      ]),
    ).toEqual({ kind: "resolved", value: rationalFromDecimal("24") });
  });

  it("reports the exact missing inputs and rejects non-canonical graphs", () => {
    const calculation: UsageQuantityCalculation = {
      nodes: [
        { op: "signal", signal: total },
        { op: "signal", signal: cached },
        { op: "sum", inputs: [0, 1] },
      ],
      result: 2,
    };
    expect(evaluateChargeQuantity(binding(total, calculation), [])).toEqual({
      kind: "missing_input",
      alternatives: [[cached, total]],
    });
    expect(() =>
      validateUsageQuantityCalculation({
        nodes: [
          { op: "signal", signal: total },
          { op: "sum", inputs: [0, 0] },
        ],
        result: 1,
      }),
    ).toThrow("sorted and unique");
    expect(() =>
      validateUsageQuantityCalculation({
        nodes: [
          { op: "signal", signal: total },
          { op: "signal", signal: cached },
        ],
        result: 1,
      }),
    ).toThrow("unused nodes");
  });

  it("selects any complete quantity method and rejects conflicting observations", () => {
    const contract: ChargeBinding = {
      ...binding(uncached),
      quantity_methods: [
        {
          input_sources: [
            {
              signal: uncached,
              channel: "response",
              locator: { kind: "json_pointer", value: "/usage/uncached" },
              availability: "terminal_only",
            },
          ],
        },
        {
          calculation: {
            nodes: [
              { op: "signal", signal: total },
              { op: "signal", signal: cached },
              { op: "subtract_floor_zero", minuend: 0, subtrahend: 1 },
            ],
            result: 2,
          },
        },
      ],
    };
    expect(
      evaluateChargeQuantity(contract, [
        { signal: total, value: rationalFromDecimal("100") },
        { signal: cached, value: rationalFromDecimal("20") },
      ]),
    ).toEqual({ kind: "resolved", value: rationalFromDecimal("80") });
    expect(() =>
      evaluateChargeQuantity(contract, [
        { signal: uncached, value: rationalFromDecimal("70") },
        { signal: total, value: rationalFromDecimal("100") },
        { signal: cached, value: rationalFromDecimal("20") },
      ]),
    ).toThrow("conflicting values");
  });
});
