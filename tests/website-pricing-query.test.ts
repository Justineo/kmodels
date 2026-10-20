import { describe, expect, it } from "vite-plus/test";
import {
  projectWebsitePricingNotes,
  projectWebsitePricingTimeline,
  projectWebsiteRateQuery,
} from "../src/catalog/website-pricing-query.ts";
import { unconditionalApplicability } from "../src/catalog/pricing-canonical.ts";
import type {
  WebsitePriceApplicability,
  WebsitePricingOffer,
  WebsitePublishedValidity,
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
  validity?: WebsitePublishedValidity,
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
        ...(validity === undefined ? {} : { validity }),
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
      ...(validity === undefined ? {} : { validity }),
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
  it("requires context that changes a standalone service's pricing state", () => {
    const data = offer([]);
    data.states = [
      { ...data.states[0]!, state: "numeric", applicability: region("us") },
      { ...data.states[0]!, state: "free", applicability: region("eu") },
    ];
    expect(projectWebsiteRateQuery(data, undefined, []).unresolved_dimensions).toEqual([
      { namespace: "kmodels", value: "region" },
    ]);
    expect(
      projectWebsiteRateQuery(data, undefined, [
        {
          kind: "categorical",
          dimension: { namespace: "kmodels", value: "region" },
          value: { namespace: "provider", provider_id: "test", value: "eu" },
        },
      ]).unresolved_dimensions,
    ).toEqual([]);
  });

  it("merges identical notes and omits scope only when it covers the complete offer", () => {
    const data = offer([]);
    data.unnormalized = ["us", "eu"].map((value) => ({
      key: value,
      label: "Published billing policy",
      reason: "Other",
      impact: "informational",
      details: ["Same rule"],
      possible_scope: region(value),
    }));
    const projected = projectWebsitePricingNotes(data);
    expect(projected).toHaveLength(1);
    expect(projected[0]?.possible_scope).toEqual(unconditionalApplicability);
    expect(data.unnormalized).toHaveLength(2);

    data.states[0]!.applicability = region("us", "eu", "apac");
    const partial = projectWebsitePricingNotes(data);
    expect(partial).toHaveLength(1);
    expect(partial[0]?.possible_scope).not.toEqual(unconditionalApplicability);
  });

  it("retains different content, validity, impact and unknown scope as distinct notes", () => {
    const data = offer([]);
    const row = {
      key: "original",
      label: "Published billing policy",
      reason: "Other",
      impact: "informational" as const,
      details: ["Rule"],
      possible_scope: region("us"),
    };
    const { possible_scope: _scope, ...unknown } = row;
    data.unnormalized = [
      row,
      { ...row, key: "different", details: ["Another rule"] },
      {
        ...row,
        key: "dated",
        validity: { from: { value: "2026-11-01", precision: "date" } },
      },
      { ...row, key: "impact", impact: "base_price" },
      { ...unknown, key: "unknown" },
    ];
    expect(projectWebsitePricingNotes(data)).toHaveLength(5);
  });

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

  it("keeps context when equal unit prices use different quantity rules", () => {
    const value = offer([
      { amount: "$2", scope: region("us") },
      { amount: "$2", scope: region("eu") },
    ]);
    for (const [index, row] of value.rates.entries())
      row.driver = {
        label: "Active runtime",
        definition: "Billable runtime",
        aggregation: "Request",
        resolution_phase: "outcome",
        quantity_key: String(index + 1).repeat(64),
      };
    const unresolved = projectWebsiteRateQuery(value, modelRef, []);
    expect(unresolved.rates).toEqual([]);
    expect(unresolved.unresolved_dimensions).toEqual([{ namespace: "kmodels", value: "region" }]);

    const selected = projectWebsiteRateQuery(value, modelRef, [
      {
        kind: "categorical",
        dimension: { namespace: "kmodels", value: "region" },
        value: { namespace: "provider", provider_id: "test", value: "eu" },
      },
    ]);
    expect(selected.rates).toHaveLength(1);
    expect(selected.rates[0]?.row.key).toBe(value.rates[1]?.key);
    expect(selected.unresolved_dimensions).toEqual([]);

    const [us, eu] = value.rates;
    if (us?.driver === undefined || eu === undefined) throw new Error("fixture rates are missing");
    eu.driver = us.driver;
    const invariant = projectWebsiteRateQuery(value, modelRef, []);
    expect(invariant.rates).toHaveLength(1);
    expect(invariant.unresolved_dimensions).toEqual([]);
  });

  it("projects current and next exact-datetime rate plans", () => {
    const transition = "2026-08-16T16:00:00.000Z";
    const current = offer([{ amount: "$2", scope: region("us", "eu") }], {
      until: { value: transition, precision: "datetime", inclusive: false },
    });
    const future = offer([{ amount: "$3", scope: region("us", "eu") }], {
      from: { value: transition, precision: "datetime" },
    });
    const persistent = offer([{ amount: "$1", scope: region("us", "eu") }], {
      from: { value: "2026-08-01T00:00:00.000Z", precision: "datetime" },
      until: { value: "2026-09-01T00:00:00.000Z", precision: "datetime" },
    });
    const versioned = {
      ...current,
      states: [...current.states, ...future.states],
      rates: [...current.rates, ...future.rates, ...persistent.rates],
    };

    const before = projectWebsitePricingTimeline(versioned, "2026-08-15T00:00:00.000Z");
    expect(before.current.rates.map(({ amount }) => amount)).toEqual(["$2", "$1"]);
    expect(before.upcoming?.offer.rates.map(({ amount }) => amount)).toEqual(["$3", "$1"]);
    expect(before.next_change_at).toBe(transition);

    const after = projectWebsitePricingTimeline(versioned, transition);
    expect(after.current.rates.map(({ amount }) => amount)).toEqual(["$3", "$1"]);
    expect(after.upcoming).toBeUndefined();
    expect(after.next_change_at).toBe("2026-09-01T00:00:00.000Z");
  });

  it("reports a future exact end even without a successor plan", () => {
    const transition = "2026-08-16T16:00:00.000Z";
    const versioned = offer([{ amount: "$2", scope: region("us", "eu") }], {
      until: { value: transition, precision: "datetime", inclusive: false },
    });

    const timeline = projectWebsitePricingTimeline(versioned, "2026-08-15T00:00:00.000Z");
    expect(timeline.upcoming).toBeUndefined();
    expect(timeline.next_change_at).toBe(transition);

    const ended = projectWebsitePricingTimeline(versioned, transition);
    expect(ended.current.state_summary).toBe("No matching state");
  });

  it("preserves an incomplete summary while a raw base price is visible", () => {
    const incomplete = offer([{ amount: "$2", scope: region("us", "eu") }]);
    incomplete.state_summary = "Incomplete";
    incomplete.unnormalized = [
      { key: "raw", label: "Raw price", impact: "base_price", reason: "Unsupported structure" },
    ];

    const timeline = projectWebsitePricingTimeline(incomplete, "2026-08-15T00:00:00.000Z");
    expect(timeline.current.state_summary).toBe("Incomplete");
  });
});
