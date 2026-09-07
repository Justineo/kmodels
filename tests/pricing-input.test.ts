import { expect, it } from "vite-plus/test";
import { evaluateChargeQuantity } from "../src/catalog/pricing-calculation.ts";
import {
  calculatedQuantityMethods,
  indexPricingInputs,
  mergeQuantityMethods,
  subtractQuantityMethods,
  sumQuantityMethods,
} from "../src/catalog/pricing-input.ts";
import type { ChargeBinding, UsageSignal } from "../src/catalog/pricing-schema.ts";
import type { SourcePricingInputFact } from "../src/catalog/pricing-source.ts";

const total: UsageSignal = { namespace: "kmodels", value: "input_tokens" };
const cached: UsageSignal = { namespace: "kmodels", value: "cached_input_tokens" };
const totalFact: SourcePricingInputFact = {
  key: "usage.total",
  channel: "response",
  locator: { kind: "json_pointer", value: "/usage/total" },
  availability: "terminal_only",
  source_ref: "pricing-inputs",
};
const cachedFact: SourcePricingInputFact = {
  ...totalFact,
  key: "usage.cached",
  locator: { kind: "json_pointer", value: "/usage/cached" },
};

it("keeps known cache arithmetic and surviving evidence when a locator disappears", () => {
  const complete = subtractQuantityMethods(
    total,
    [totalFact.key],
    cached,
    [cachedFact.key],
    indexPricingInputs([totalFact, cachedFact]),
  );
  const partial = subtractQuantityMethods(
    total,
    [totalFact.key],
    cached,
    [cachedFact.key],
    indexPricingInputs([totalFact]),
  );
  expect(partial.methods).toEqual([
    {
      calculation: complete.methods[0]?.calculation,
      input_sources: [
        {
          signal: total,
          channel: totalFact.channel,
          locator: totalFact.locator,
          availability: totalFact.availability,
        },
      ],
    },
  ]);
  expect(partial.facts).toEqual([totalFact]);
  const binding: ChargeBinding = {
    signal: { namespace: "kmodels", value: "uncached_input_tokens" },
    aggregation: "request",
    quantity_methods: partial.methods,
    observations: [],
  };
  expect(
    evaluateChargeQuantity(binding, [
      { signal: total, value: { numerator: "100", denominator: "1" } },
    ]),
  ).toEqual({ kind: "missing_input", alternatives: [[cached]] });
  expect(
    evaluateChargeQuantity(binding, [
      { signal: total, value: { numerator: "100", denominator: "1" } },
      { signal: cached, value: { numerator: "30", denominator: "1" } },
    ]),
  ).toEqual({ kind: "resolved", value: { numerator: "70", denominator: "1" } });
});

it("keeps a known sum without inventing any provider locators", () => {
  const result = sumQuantityMethods(
    [
      { signal: total, keys: [totalFact.key] },
      { signal: cached, keys: [cachedFact.key] },
    ],
    indexPricingInputs([]),
  );
  expect(result.methods).toHaveLength(1);
  expect(result.methods[0]?.calculation).toBeDefined();
  expect(result.methods[0]?.input_sources).toBeUndefined();
  expect(result.facts).toEqual([]);
});

it("omits a redundant bare formula while preserving distinct partial acquisition paths", () => {
  const complete = subtractQuantityMethods(
    total,
    [totalFact.key],
    cached,
    [cachedFact.key],
    indexPricingInputs([totalFact, cachedFact]),
  );
  const bare = subtractQuantityMethods(
    total,
    [totalFact.key],
    cached,
    [cachedFact.key],
    indexPricingInputs([]),
  );
  expect(mergeQuantityMethods([bare, complete])).toEqual(complete);
  expect(mergeQuantityMethods([complete, bare])).toEqual(complete);
  const partial = subtractQuantityMethods(
    total,
    [totalFact.key],
    cached,
    [cachedFact.key],
    indexPricingInputs([totalFact]),
  );
  const merged = mergeQuantityMethods([complete, partial]);
  expect(merged.methods).toHaveLength(2);
  expect(merged.facts).toEqual(complete.facts);
  expect(mergeQuantityMethods([partial, complete])).toEqual(merged);
});

it("preserves a source-independent constant without an empty acquisition contract", () => {
  const result = calculatedQuantityMethods(
    {
      nodes: [
        {
          op: "constant",
          value: { numerator: "10", denominator: "1" },
          unit: {
            factors: [{ unit: { namespace: "kmodels", value: "item" }, power: 1 }],
          },
        },
      ],
      result: 0,
    },
    [],
  );
  expect(result.methods).toHaveLength(1);
  expect(result.methods[0]?.input_sources).toBeUndefined();
});
