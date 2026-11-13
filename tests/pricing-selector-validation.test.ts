import { expect, it, vi } from "vite-plus/test";
import * as canonical from "../src/catalog/canonical-value.ts";
import type {
  PriceApplicability,
  PriceCondition,
  UnitExpression,
} from "../src/catalog/pricing-schema.ts";
import type { PricingSelection } from "../src/catalog/pricing-applicability.ts";
import { validateSelectors } from "../src/pricing/selection.ts";

const dimension = { namespace: "kmodels", value: "context_tokens" } as const;
const tokens: UnitExpression = {
  factors: [{ unit: { namespace: "kmodels", value: "token" }, power: 1 }],
};
const seconds: UnitExpression = {
  factors: [{ unit: { namespace: "kmodels", value: "second" }, power: 1 }],
};
const condition: PriceCondition = {
  kind: "decimal_range",
  dimension,
  unit: tokens,
  lower: { value: "0", inclusive: true },
};
const scope: PriceApplicability = { any_of: [{ all_of: [condition] }] };

it("validates a supplied unit once across repeated tariff scopes without caching caller input", () => {
  const selector: PricingSelection = {
    kind: "decimal",
    dimension,
    unit: structuredClone(tokens),
    value: "100",
  };
  const serialize = vi.spyOn(canonical, "canonicalJson");
  try {
    validateSelectors(
      [selector],
      Array.from({ length: 128 }, () => scope),
    );
    expect(serialize.mock.calls.filter(([value]) => value === selector.unit)).toHaveLength(1);
    selector.unit = seconds;
    expect(() => validateSelectors([selector], [scope])).toThrow("Selector kind or unit conflicts");
  } finally {
    serialize.mockRestore();
  }
});

it("retains late conflicts and duplicate-dimension checks", () => {
  const selector: PricingSelection = { kind: "decimal", dimension, unit: tokens, value: "100" };
  const conflict: PriceApplicability = { any_of: [{ all_of: [{ ...condition, unit: seconds }] }] };
  expect(() => validateSelectors([selector], [scope, conflict])).toThrow(
    "Selector kind or unit conflicts",
  );
  expect(() =>
    validateSelectors(
      [{ kind: "categorical", dimension, value: { namespace: "kmodels", value: "100" } }],
      [scope],
    ),
  ).toThrow("Selector kind or unit conflicts");
  expect(() => validateSelectors([selector, selector], [scope])).toThrow(
    "Selectors repeat a dimension",
  );
  expect(() => validateSelectors([selector], [])).not.toThrow();
});
