import { describe, expect, it } from "vite-plus/test";
import { evaluateApplicability } from "../src/catalog/pricing-applicability.ts";
import { unconditionalApplicability } from "../src/catalog/pricing-canonical.ts";
import type { PriceApplicability, PriceCondition } from "../src/catalog/pricing-schema.ts";

const geo = { namespace: "kmodels", value: "inference_geo" } as const;
const ttl = { namespace: "kmodels", value: "cache_ttl_seconds" } as const;
const context = { namespace: "kmodels", value: "context_tokens" } as const;
const geography = (...values: string[]): PriceCondition => ({
  kind: "categorical",
  dimension: geo,
  values: values.map((value) => ({ namespace: "provider", provider_id: "test", value })),
});
const cacheTtl: PriceCondition = {
  kind: "decimal_range",
  dimension: ttl,
  unit: { factors: [{ unit: { namespace: "kmodels", value: "second" }, power: 1 }] },
  lower: { value: "300", inclusive: true },
  upper: { value: "300", inclusive: true },
};

const contextLimit = (value: string, inclusive: boolean): PriceCondition => ({
  kind: "decimal_range",
  dimension: context,
  unit: { factors: [{ unit: { namespace: "kmodels", value: "token" }, power: 1 }] },
  upper: { value, inclusive },
});

describe("pricing applicability", () => {
  it("does not request TTL from absorbed alternatives, regardless of clause or input order", () => {
    const global = geography("global");
    const scope: PriceApplicability = {
      any_of: [{ all_of: [global, cacheTtl] }, { all_of: [global] }],
    };
    const original = structuredClone(scope);
    const geoInput = {
      kind: "categorical" as const,
      dimension: geo,
      value: { namespace: "provider" as const, provider_id: "test", value: "global" },
    };
    const ttlInput = {
      kind: "decimal" as const,
      dimension: ttl,
      value: "3600",
      unit: cacheTtl.unit,
    };
    for (const any_of of [scope.any_of, scope.any_of.toReversed()]) {
      expect(evaluateApplicability({ any_of }, [])).toEqual({
        state: "missing",
        missing_dimensions: [geo],
      });
      expect(evaluateApplicability({ any_of }, [ttlInput])).toEqual({
        state: "missing",
        missing_dimensions: [geo],
      });
      for (const inputs of [[geoInput], [geoInput, ttlInput], [ttlInput, geoInput]])
        expect(evaluateApplicability({ any_of }, inputs)).toEqual({
          state: "true",
          missing_dimensions: [],
        });
    }
    expect(scope).toEqual(original);
  });

  it.each([
    { broad: geography("global", "us"), narrow: geography("global"), expected: [geo] },
    { broad: geography("global"), narrow: geography("us"), expected: [ttl, geo] },
    { broad: geography("global"), narrow: geography("global", "us"), expected: [ttl, geo] },
    { broad: contextLimit("2000", true), narrow: contextLimit("1000", true), expected: [context] },
    {
      broad: contextLimit("1000", false),
      narrow: contextLimit("1000", true),
      expected: [ttl, context],
    },
  ])(
    "uses predicate containment when reporting dependencies: $broad / $narrow",
    ({ broad, narrow, expected }) => {
      expect(
        evaluateApplicability(
          {
            any_of: [{ all_of: [narrow, cacheTtl] }, { all_of: [broad] }],
          },
          [],
        ),
      ).toEqual({ state: "missing", missing_dimensions: expected });
    },
  );

  it("removes newly redundant predicates after a supplied fact, keeping other contexts conditional", () => {
    const promotion: PriceCondition = {
      kind: "boolean",
      dimension: { namespace: "kmodels", value: "promotion" },
      value: true,
    };
    const scope: PriceApplicability = {
      any_of: [
        { all_of: [geography("global"), promotion] },
        { all_of: [geography("global"), cacheTtl] },
      ],
    };
    expect(
      evaluateApplicability(scope, [
        { kind: "boolean", dimension: promotion.dimension, value: true },
      ]),
    ).toEqual({ state: "missing", missing_dimensions: [geo] });
    expect(
      evaluateApplicability(scope, [
        { kind: "boolean", dimension: promotion.dimension, value: false },
      ]),
    ).toEqual({ state: "missing", missing_dimensions: [ttl, geo] });
  });

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
