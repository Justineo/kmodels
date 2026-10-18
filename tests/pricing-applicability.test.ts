import { describe, expect, it } from "vite-plus/test";
import { evaluateApplicability } from "../src/catalog/pricing-applicability.ts";
import { unconditionalApplicability } from "../src/catalog/pricing-canonical.ts";
import type { PriceApplicability } from "../src/catalog/pricing-schema.ts";

describe("pricing applicability", () => {
  it("short-circuits partial OR selectors and reports only live missing dimensions", () => {
    const selector: PriceApplicability = {
      any_of: [
        {
          all_of: [
            {
              kind: "categorical",
              dimension: { namespace: "kmodels", value: "region" },
              values: [{ namespace: "kmodels", value: "US" }],
            },
          ],
        },
        {
          all_of: [
            {
              kind: "categorical",
              dimension: { namespace: "kmodels", value: "service_tier" },
              values: [{ namespace: "kmodels", value: "batch" }],
            },
          ],
        },
      ],
    };
    expect(
      evaluateApplicability(selector, [
        {
          kind: "categorical",
          dimension: { namespace: "kmodels", value: "region" },
          value: { namespace: "kmodels", value: "US" },
        },
      ]),
    ).toEqual({ state: "true", missing_dimensions: [] });
    expect(
      evaluateApplicability(selector, [
        {
          kind: "categorical",
          dimension: { namespace: "kmodels", value: "region" },
          value: { namespace: "kmodels", value: "EU" },
        },
      ]),
    ).toEqual({
      state: "missing",
      missing_dimensions: [{ namespace: "kmodels", value: "service_tier" }],
    });
  });

  it("rejects decimal selections outside the canonical numeric bound", () => {
    expect(() =>
      evaluateApplicability(unconditionalApplicability, [
        {
          kind: "decimal",
          dimension: { namespace: "kmodels", value: "duration_seconds" },
          value: `0.${"0".repeat(127)}1`,
          unit: { factors: [] },
        },
      ]),
    ).toThrow("exact-integer digit limit");
  });

  it("evaluates interval selections without replacing them with representative points", () => {
    const dimension = { namespace: "kmodels" as const, value: "context_tokens" as const };
    const unit = {
      factors: [{ unit: { namespace: "kmodels" as const, value: "token" as const }, power: 1 }],
    };
    const applicability: PriceApplicability = {
      any_of: [
        {
          all_of: [
            {
              kind: "decimal_range",
              dimension,
              unit,
              upper: { value: "199999", inclusive: true },
            },
          ],
        },
      ],
    };

    expect(
      evaluateApplicability(applicability, [
        {
          kind: "decimal_range",
          dimension,
          unit,
          lower: { value: "0", inclusive: true },
          upper: { value: "199999", inclusive: true },
        },
      ]),
    ).toEqual({ state: "true", missing_dimensions: [] });
    expect(
      evaluateApplicability(applicability, [
        {
          kind: "decimal_range",
          dimension,
          unit,
          lower: { value: "200000", inclusive: true },
        },
      ]),
    ).toEqual({ state: "false", missing_dimensions: [] });

    const overlapping: PriceApplicability = {
      any_of: [
        {
          all_of: [
            {
              kind: "decimal_range",
              dimension,
              unit,
              lower: { value: "100000", inclusive: true },
            },
          ],
        },
      ],
    };
    expect(
      evaluateApplicability(overlapping, [
        {
          kind: "decimal_range",
          dimension,
          unit,
          lower: { value: "0", inclusive: true },
          upper: { value: "199999", inclusive: true },
        },
      ]),
    ).toEqual({ state: "missing", missing_dimensions: [dimension] });
  });
});
