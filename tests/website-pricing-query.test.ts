import { describe, expect, it } from "vite-plus/test";
import { projectWebsiteRateQuery } from "../src/catalog/website-pricing-query.ts";
import type {
  WebsitePriceApplicability,
  WebsitePricingOffer,
} from "../src/catalog/website-schema.ts";

const modelRef = "test/model";
const termRef = "a".repeat(64);

function region(...values: string[]): WebsitePriceApplicability {
  return {
    any_of: values.map((value) => ({
      all_of: [
        {
          kind: "categorical",
          dimension: { namespace: "kmodels", value: "region" },
          values: [{ namespace: "provider", provider_id: "test", value }],
        },
      ],
    })),
  };
}

function offer(
  prices: Array<{ amount: string; scope: WebsitePriceApplicability }>,
): WebsitePricingOffer {
  return {
    id: "b".repeat(64),
    title: "Usage",
    group: "model_mechanism",
    billing_mode: { label: "Usage" },
    state_summary: "Metered pricing",
    selectors: [],
    states: [
      {
        key: "state:0",
        state: "numeric",
        label: "Numeric",
        applicability: region("us", "eu"),
        applicability_label: "US or EU",
      },
    ],
    rates: prices.map(({ amount, scope }, index) => ({
      key: `rate:${index}`,
      term_ref: termRef,
      label: "Input text",
      amount,
      unit: "per 1M tokens",
      accessible_text: `${amount} USD per 1M tokens`,
      applicability: scope,
      applicability_label: "Region",
    })),
    allowances: [],
    contributions: [],
    enrollment: [],
    settlement: [],
    unnormalized_count: 0,
    unnormalized: [],
  };
}

describe("website pricing query", () => {
  it("shows a rate immediately when it is invariant across the available context", () => {
    const result = projectWebsiteRateQuery(
      offer([{ amount: "$2", scope: region("us", "eu") }]),
      modelRef,
      [],
    );

    expect(result.rates).toHaveLength(1);
    expect(result.rates[0]?.invariant_dimensions).toEqual([
      { namespace: "kmodels", value: "region" },
    ]);
    expect(result.unresolved_dimensions).toEqual([]);
  });

  it("asks for context when the selected value changes the rate", () => {
    const result = projectWebsiteRateQuery(
      offer([
        { amount: "$2", scope: region("us") },
        { amount: "$3", scope: region("eu") },
      ]),
      modelRef,
      [],
    );

    expect(result.rates).toEqual([]);
    expect(result.unresolved_dimensions).toEqual([{ namespace: "kmodels", value: "region" }]);
  });

  it("does not present a partial-scope rate as invariant", () => {
    const result = projectWebsiteRateQuery(
      offer([{ amount: "$2", scope: region("us") }]),
      modelRef,
      [],
    );

    expect(result.rates).toEqual([]);
    expect(result.unresolved_dimensions).toEqual([{ namespace: "kmodels", value: "region" }]);
  });
});
