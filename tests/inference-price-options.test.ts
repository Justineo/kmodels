import { expect, it } from "vite-plus/test";
import { inferencePriceOptions } from "../src/catalog/inference-price-options.ts";
import { unconditionalApplicability } from "../src/catalog/pricing-canonical.ts";
import type { PriceApplicability, PriceCategoricalValue } from "../src/catalog/pricing-schema.ts";
import type { WebsitePricingSelector } from "../src/catalog/website-schema.ts";
import { matchInferencePrices } from "../src/pricing/inference-matching.ts";
import type { InferenceMatchData } from "../src/pricing/inference-matching-schema.ts";

const at = "2026-10-30T00:00:00.000Z";
const boundary = "2026-10-31T00:00:00.000Z";
const after = "2026-11-01T00:00:00.000Z";
const dimension = { namespace: "kmodels", value: "region" } as const;
const regions = ["eu", "us", "other", "unavailable"];
const region = (value: string): PriceCategoricalValue => ({
  namespace: "provider",
  provider_id: "fixture",
  value,
});
const option = {
  key: "region",
  label: "Region",
  dimension,
  kind: "categorical",
  values: regions.map((value) => ({ key: value, label: value, value: region(value) })),
} satisfies WebsitePricingSelector;
const scope = (value: string): PriceApplicability => ({
  any_of: [{ all_of: [{ dimension, kind: "categorical", values: [region(value)] }] }],
});

function fixture(rawScope?: PriceApplicability): InferenceMatchData {
  return {
    generated_at: at,
    observed_at: at,
    rules: [{ model_ref: "fixture/model", offer_refs: ["plan"], fixed_selectors: [] }],
    offers: [
      {
        id: "plan",
        states: [{ applicability: unconditionalApplicability, semantics: 0, state: "numeric" }],
        relations: [],
        terms: [
          {
            id: "input",
            kind: "rate",
            variants: [
              { applicability: scope("eu"), semantics: 0 },
              {
                applicability: scope("us"),
                semantics: 1,
                validity: { until: { value: boundary, precision: "datetime", inclusive: false } },
              },
            ],
            raw_variants: [
              { possible_scope: rawScope, impact: "informational", reason: "Fixture evidence" },
            ],
          },
        ],
      },
    ],
    referenced_rates: [],
  };
}

function menu(data: InferenceMatchData, time: string): string[] {
  const initial = matchInferencePrices(data, [], time, "plan");
  const [scoped] = inferencePriceOptions(data, initial, [option], time, "plan");
  return scoped?.kind === "categorical" ? scoped.values.map(({ key }) => key) : [];
}

it("indexes current price evidence and excludes an expired Region at its precise boundary", () => {
  const data = fixture(scope("other"));
  expect(menu(data, at)).toEqual(["eu", "us", "other"]);
  expect(menu(data, boundary)).toEqual(["eu", "other"]);
  expect(menu(data, after)).toEqual(["eu", "other"]);
});

it("admits every published choice when one compatible evidence clause omits the dimension", () => {
  expect(menu(fixture(), at)).toEqual(regions);
});
