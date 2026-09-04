import { describe, expect, it } from "vite-plus/test";
import {
  chargeBindingSchema,
  decimalSchema,
  priceApplicabilitySchema,
  pricingCatalogEnvelopeSchema,
  providerAtomRegistryEntrySchema,
  providerPricingSnapshotSchema,
  publishedValiditySchema,
  rationalSchema,
  rawPriceFactSchema,
  rawPriceObservationSchema,
  unitExpressionSchema,
  usageQuantityCalculationSchema,
} from "../src/catalog/pricing-schema.ts";

const unconditional = { any_of: [{ all_of: [] }] };

describe("canonical pricing wire schema", () => {
  it("is closed at every public object boundary", () => {
    expect(() =>
      rawPriceObservationSchema.parse({
        source_ref: "pricing",
        locator: { kind: "table", value: "row 1" },
        raw: { amount: "2" },
        establishes_applicability: unconditional,
      }),
    ).toThrow();
    expect(() =>
      pricingCatalogEnvelopeSchema.parse({
        pricing_data_version: "a".repeat(64),
        core_catalog_version: "b".repeat(64),
        core_data_sha256: "c".repeat(64),
        generated_at: "2026-07-28T00:00:00.000Z",
        data: {
          provider_vocabularies: [],
          provider_snapshots: [],
          model_dispositions: [],
          books: [],
          extra: true,
        },
      }),
    ).toThrow();
  });

  it("records the latest failed attempt only on retained snapshots", () => {
    const base = {
      provider_id: "test",
      observed_at: "2026-07-27T00:00:00.000Z",
    };
    expect(
      providerPricingSnapshotSchema.parse({
        ...base,
        publication: "retained",
        refresh_failure: {
          attempted_at: "2026-07-28T00:00:00.000Z",
          code: "source_schema_changed",
        },
      }),
    ).toBeDefined();
    expect(() =>
      providerPricingSnapshotSchema.parse({ ...base, publication: "retained" }),
    ).toThrow();
    expect(() =>
      providerPricingSnapshotSchema.parse({
        ...base,
        publication: "fresh",
        refresh_failure: {
          attempted_at: "2026-07-28T00:00:00.000Z",
          code: "source_schema_changed",
        },
      }),
    ).toThrow();
  });

  it("accepts only non-empty raw facts", () => {
    expect(rawPriceFactSchema.parse({ amount: "2", unit: "million tokens" })).toEqual({
      amount: "2",
      unit: "million tokens",
    });
    expect(() => rawPriceFactSchema.parse({})).toThrow("Raw price fact is empty");
    expect(() => rawPriceFactSchema.parse({ amount: "" })).toThrow();
    expect(() => rawPriceFactSchema.parse({ conditions: [] })).toThrow();
  });

  it("accepts only canonical reduced rationals and bounded unit expressions", () => {
    expect(rationalSchema.parse({ numerator: "1", denominator: "60" })).toEqual({
      numerator: "1",
      denominator: "60",
    });
    expect(() => rationalSchema.parse({ numerator: "2", denominator: "120" })).toThrow(
      "Rational must be reduced",
    );
    expect(() => rationalSchema.parse({ numerator: "0", denominator: "2" })).toThrow(
      "denominator 1",
    );
    expect(() =>
      unitExpressionSchema.parse({
        factors: [
          {
            unit: { namespace: "kmodels", value: "token" },
            power: 9,
          },
        ],
      }),
    ).toThrow();
  });

  it("enforces the finite selector grammar", () => {
    expect(priceApplicabilitySchema.parse(unconditional)).toEqual(unconditional);
    expect(() => priceApplicabilitySchema.parse({ any_of: [] })).toThrow();
    expect(() =>
      priceApplicabilitySchema.parse({
        any_of: [
          {
            all_of: [
              {
                kind: "categorical",
                dimension: { namespace: "kmodels", value: "region" },
                values: [],
              },
            ],
          },
        ],
      }),
    ).toThrow();
  });

  it("bounds canonical decimal coefficients", () => {
    expect(decimalSchema.parse(`0.${"0".repeat(126)}1`)).toHaveLength(129);
    expect(() => decimalSchema.parse(`0.${"0".repeat(127)}1`)).toThrow("exact-integer digit limit");
  });

  it("accepts only closed and bounded quantity calculations", () => {
    const signal = { namespace: "kmodels" as const, value: "active_seconds" as const };
    const calculation = {
      nodes: [
        { op: "signal" as const, signal },
        {
          op: "minimum" as const,
          input: 0,
          value: { numerator: "300", denominator: "1" },
        },
      ],
      result: 1,
    };
    expect(usageQuantityCalculationSchema.parse(calculation)).toEqual(calculation);
    expect(() =>
      usageQuantityCalculationSchema.parse({
        nodes: [{ op: "script", source: "usage * 2" }],
        result: 0,
      }),
    ).toThrow();
    expect(() =>
      chargeBindingSchema.parse({
        signal,
        aggregation: "session",
        quantity_methods: [
          {
            input_sources: [
              {
                signal,
                channel: "telemetry",
                locator: {
                  kind: "otel_attribute",
                  value: "gen_ai.usage.active_seconds",
                  convention_version: "development-2026-09-03",
                },
                availability: "terminal_only",
              },
            ],
          },
        ],
        observations: [
          {
            source_ref: "pricing",
            locator: { kind: "table", value: "runtime" },
            raw: { fragment: "runtime" },
          },
        ],
        extra: true,
      }),
    ).toThrow();
  });

  it("validates closed calendar labels and canonical UTC instants", () => {
    expect(
      publishedValiditySchema.parse({
        from: { value: "2024-02-29", precision: "date" },
        until: { value: "2026-07-28T10:11:12.1234Z", precision: "datetime" },
      }),
    ).toBeDefined();
    expect(() => publishedValiditySchema.parse({})).toThrow();
    expect(() =>
      publishedValiditySchema.parse({
        from: { value: "2023-02-29", precision: "date" },
      }),
    ).toThrow("Invalid date value");
    expect(() =>
      publishedValiditySchema.parse({
        from: { value: "2026-07-28T10:11:12.1200Z", precision: "datetime" },
      }),
    ).toThrow("Invalid datetime value");
  });

  it("models recurring daily and weekly rules without evaluating the current time", () => {
    const atom = {
      kind: "categorical_value",
      key: "peak",
      dimension: { namespace: "kmodels", value: "billing_period" },
      definition: "Provider-published peak billing period",
      schedule: {
        kind: "daily_time_windows",
        time_zone: "UTC",
        windows: [
          { from: "01:00", until: "04:00" },
          { from: "06:00", until: "10:00" },
        ],
      },
    };
    expect(providerAtomRegistryEntrySchema.parse(atom)).toEqual(atom);
    expect(() =>
      providerAtomRegistryEntrySchema.parse({
        ...atom,
        schedule: {
          ...atom.schedule,
          windows: [
            { from: "06:00", until: "10:00" },
            { from: "01:00", until: "04:00" },
          ],
        },
      }),
    ).toThrow("sorted and non-overlapping");

    const weekly = {
      ...atom,
      schedule: {
        kind: "weekly_time_windows",
        time_zone: "UTC",
        days: ["monday", "tuesday", "wednesday", "thursday", "friday"],
        windows: atom.schedule.windows,
      },
    };
    expect(providerAtomRegistryEntrySchema.parse(weekly)).toEqual(weekly);
    expect(() =>
      providerAtomRegistryEntrySchema.parse({
        ...weekly,
        schedule: { ...weekly.schedule, days: ["friday", "monday"] },
      }),
    ).toThrow("sorted and unique");
  });
});
