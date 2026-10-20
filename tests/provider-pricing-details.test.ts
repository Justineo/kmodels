import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import ProviderPricingDetails from "../src/components/ProviderPricingDetails.vue";
import PricingOfferBreakdown from "../src/components/PricingOfferBreakdown.vue";
import type {
  WebsitePricingOffer,
  WebsiteProvider,
  WebsiteProviderPricingDetail,
  WebsiteProviderPricingOffer,
} from "../src/catalog/website-schema.ts";
import { renderComponent } from "./render-component.ts";

afterEach(() => vi.useRealTimers());

function promotion(value: boolean): WebsitePricingOffer["states"][number]["applicability"] {
  return {
    any_of: [
      {
        all_of: [
          {
            kind: "boolean",
            dimension: { namespace: "kmodels", value: "promotion" },
            value,
          },
        ],
      },
    ],
  };
}

const allContexts: WebsitePricingOffer["states"][number]["applicability"] = {
  any_of: [{ all_of: [] }],
};
const billingPeriodDimension = {
  namespace: "kmodels" as const,
  value: "billing_period" as const,
};
const billingPeriodValues = [
  {
    key: "off-peak",
    label: "Off-peak",
    value: { namespace: "provider" as const, provider_id: "test", value: "off_peak" },
    schedule: { kind: "weekly_time_remainder" as const, time_zone: "UTC" as const },
  },
  {
    key: "peak",
    label: "Peak",
    value: { namespace: "provider" as const, provider_id: "test", value: "peak" },
    schedule: {
      kind: "weekly_time_windows" as const,
      time_zone: "UTC" as const,
      days: [
        "monday" as const,
        "tuesday" as const,
        "wednesday" as const,
        "thursday" as const,
        "friday" as const,
      ],
      windows: [
        { from: "01:00", until: "04:00" },
        { from: "06:00", until: "10:00" },
      ],
    },
  },
];
const billingPeriodSelector = {
  key: '{"namespace":"kmodels","value":"billing_period"}',
  label: "Billing period",
  dimension: billingPeriodDimension,
  kind: "categorical" as const,
  values: billingPeriodValues,
} satisfies WebsitePricingOffer["selectors"][number];

function billingPeriodRates(
  validity?: WebsitePricingOffer["rates"][number]["validity"],
): WebsitePricingOffer["rates"] {
  return billingPeriodValues.map(({ value, label }, index) => ({
    key: `rate:${index}`,
    term_ref: "c".repeat(64),
    label: "Input text",
    amount: index === 0 ? "$0.22" : "$0.44",
    unit: "per 1M tokens",
    accessible_text: `${label} input text rate`,
    applicability: {
      any_of: [
        {
          all_of: [{ kind: "categorical", dimension: billingPeriodDimension, values: [value] }],
        },
      ],
    },
    applicability_label: `Billing period: ${label}`,
    ...(validity === undefined ? {} : { validity }),
  }));
}

function pricingOffer(): WebsitePricingOffer {
  return {
    id: "b".repeat(64),
    title: "Genie Agents",
    group: "standalone",
    billing_mode: { label: "Hybrid" },
    state_summary: "2 pricing states",
    selectors: [
      {
        key: '{"namespace":"kmodels","value":"promotion"}',
        kind: "boolean",
        label: "Promotion",
        dimension: { namespace: "kmodels", value: "promotion" },
      },
    ],
    states: [
      {
        key: "state:0",
        state: "free",
        label: "Free",
        applicability: promotion(true),
        applicability_label: "Promotion",
      },
      {
        key: "state:1",
        state: "numeric",
        label: "Numeric",
        applicability: promotion(false),
        applicability_label: "No promotion",
      },
    ],
    rates: [],
    allowances: [],
    contributions: [],
    enrollment: [],
    settlement: [],
    unnormalized_count: 0,
    unnormalized: [],
  };
}

describe("provider pricing details", () => {
  it("uses the shared context controls for conditional service pricing", async () => {
    const html = await renderComponent(PricingOfferBreakdown, {
      offer: pricingOffer(),
      explainCharges: true,
    });

    expect(html).toContain('aria-label="Pricing options"');
    expect(html).toContain("Promotion");
    expect(html).toContain("Yes");
    expect(html).toContain("No");
    expect(html).toContain("2 pricing states");
    expect(html).not.toContain("/pricing/index.json");
  });

  it("uses the current and upcoming timeline for standalone services without a model reference", async () => {
    vi.useFakeTimers();
    const transition = "2026-10-31T16:00:00.000Z";
    const offer = pricingOffer();
    offer.selectors = [];
    offer.states = [
      {
        key: "current",
        state: "numeric",
        label: "Metered pricing",
        applicability: allContexts,
        applicability_label: "All contexts",
        validity: { until: { value: transition, precision: "datetime", inclusive: false } },
      },
      {
        key: "next",
        state: "numeric",
        label: "Metered pricing",
        applicability: allContexts,
        applicability_label: "All contexts",
        validity: { from: { value: transition, precision: "datetime", inclusive: true } },
      },
    ];
    offer.rates = offer.states.map((state, index) => ({
      ...state,
      term_ref: "c".repeat(64),
      label: "Search",
      amount: index === 0 ? "$0" : "$0.75",
      unit: "per 1K requests",
      accessible_text: index === 0 ? "Free search" : "Paid search",
      driver: {
        label: "Search requests",
        definition: index === 0 ? "Current billing qualification" : "Future billing qualification",
        aggregation: "Request",
        resolution_phase: "outcome",
      },
    }));
    vi.setSystemTime(new Date("2026-10-20T00:00:00.000Z"));
    const before = await renderComponent(PricingOfferBreakdown, { offer, explainCharges: true });
    expect(before).toContain("$0<");
    expect(before).toContain(`datetime="${transition}"`);
    expect(before).not.toContain("$0.75");
    expect(before).toContain("Current billing qualification");
    expect(before).not.toContain("Future billing qualification");

    vi.setSystemTime(new Date(transition));
    const after = await renderComponent(PricingOfferBreakdown, { offer, explainCharges: true });
    expect(after).toContain("$0.75");
    expect(after).not.toContain("New rates");
    expect(after).not.toContain("Validity-qualified");
    expect(after).toContain("Future billing qualification");
    expect(after).not.toContain("Current billing qualification");
  });

  it("renders one informational note for all supported billing currencies", async () => {
    const offer = pricingOffer();
    const dimension = { namespace: "kmodels" as const, value: "billing_currency" as const };
    const scopes = ["USD", "CNY"].map((value) => ({
      any_of: [
        {
          all_of: [
            {
              kind: "categorical" as const,
              dimension,
              values: [{ namespace: "provider" as const, provider_id: "test", value }],
            },
          ],
        },
      ],
    }));
    offer.states = [
      { ...offer.states[0]!, applicability: { any_of: scopes.flatMap((s) => s.any_of) } },
    ];
    offer.unnormalized = scopes.map((possible_scope, index) => ({
      key: String(index),
      label: "Billing period applicability",
      reason: "Other",
      impact: "informational",
      details: ["Peak / Off-peak applicability"],
      possible_scope,
    }));
    const html = await renderComponent(PricingOfferBreakdown, { offer, modelRef: "test/model" });
    expect(html.match(/Billing period applicability/g)).toHaveLength(1);
    expect(html).not.toContain("Applies when");
    expect(html).not.toContain("Choose Billing currency");
  });

  it("shows a categorical billing-period selector with its daily rule", async () => {
    const offer = pricingOffer();
    offer.selectors = [billingPeriodSelector];
    offer.rates = billingPeriodRates();

    const html = await renderComponent(PricingOfferBreakdown, {
      offer,
      modelRef: "test/model",
    });

    expect(html).toContain('<section class="pricing-context"');
    expect(html).toContain('aria-label="Pricing options"');
    expect(html).not.toContain(">Pricing options</h6>");
    expect(html).not.toContain("Select Billing period to see rates.");
    expect(html).toContain('<details class="schedule-rule"');
    expect(html).not.toContain('<details class="schedule-rule" open');
    expect(html).toContain("Weekly rule · UTC");
    expect(html).toContain("Mon–Fri · 01:00–04:00, 06:00–10:00");
    expect(html).toContain("All other times");
    expect(html).not.toContain("current period");
  });

  it("shows the current rate plan before resolving a recurring schedule", async () => {
    vi.useFakeTimers();
    const offer = pricingOffer();
    const transition = "2026-08-16T16:00:00.000Z";
    offer.state_summary = "2 pricing states";
    offer.states = [
      {
        key: "state:current",
        state: "numeric",
        label: "Metered pricing",
        applicability: allContexts,
        applicability_label: "All contexts",
        validity: {
          until: { value: transition, precision: "datetime", inclusive: false },
        },
      },
      {
        key: "state:upcoming",
        state: "numeric",
        label: "Metered pricing",
        applicability: allContexts,
        applicability_label: "All contexts",
        validity: { from: { value: transition, precision: "datetime" } },
      },
    ];
    offer.selectors = [billingPeriodSelector];
    offer.rates = [
      {
        key: "rate:current",
        term_ref: "c".repeat(64),
        label: "Input text",
        amount: "$0.90",
        unit: "per 1M tokens",
        accessible_text: "Current input text rate",
        applicability: allContexts,
        applicability_label: "All contexts",
        validity: {
          until: { value: transition, precision: "datetime", inclusive: false },
        },
      },
      ...billingPeriodRates({ from: { value: transition, precision: "datetime" } }),
    ];

    vi.setSystemTime(new Date("2026-08-15T00:00:00.000Z"));
    const before = await renderComponent(PricingOfferBreakdown, {
      offer,
      modelRef: "test/model",
    });
    expect(before).toContain("New rates");
    expect(before).toContain(`datetime="${transition}"`);
    expect(before).toContain("$0.90");
    expect(before).not.toContain("Billing period");
    expect(before).not.toContain("Pricing states");
    expect(before).not.toContain("currentness not asserted");

    vi.setSystemTime(new Date(transition));
    const after = await renderComponent(PricingOfferBreakdown, {
      offer,
      modelRef: "test/model",
    });
    expect(after).not.toContain("New rates");
    expect(after).not.toContain("$0.90");
    expect(after).toContain("Billing period");
    expect(after).toContain("Weekly rule · UTC");
    expect(after).not.toContain("Pricing states");
  });

  it("separates normalized resources from raw-only official rows", async () => {
    const provider = {
      id: "test",
      name: "Test",
      pricing_coverage: {
        representative_models: 0,
        offer_models: 0,
        unknown_models: 0,
        not_applicable_models: 0,
        standalone_resources: 2,
        detail_chunks: 1,
      },
    } satisfies WebsiteProvider;
    const offer = pricingOffer();
    const summary = {
      id: offer.id,
      title: offer.title,
      billing_mode: offer.billing_mode,
      state_summary: offer.state_summary,
      offer_refs: [[0, 0]],
    } satisfies WebsiteProviderPricingOffer;
    const detail = {
      schema_version: 3,
      data_version: "a".repeat(64),
      provider_id: provider.id,
      chunk: 0,
      resources: [
        {
          id: "c".repeat(64),
          title: "Reviewed service",
          kind: "Service",
          raw_only: false,
          offers: [summary],
        },
        {
          id: "d".repeat(64),
          title: "Unmapped source row",
          kind: "Service",
          raw_only: true,
          offers: [summary],
        },
      ],
    } satisfies WebsiteProviderPricingDetail;

    const html = await renderComponent(ProviderPricingDetails, {
      provider,
      detail,
      loading: false,
      error: undefined,
    });

    expect(html).toContain("Services");
    expect(html).toContain("Find a resource or offer");
    expect(html).toContain('type="search"');
    expect(html).toContain("Reviewed service");
    expect(html).toContain("Pricing needing clarification");
    expect(html).toContain("Unmapped source row");
    expect(html.match(/\/pricing\/index\.json/gu)).toHaveLength(1);
  });
});
