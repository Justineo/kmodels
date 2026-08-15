import { createSSRApp, type Component } from "vue";
import { renderToString } from "vue/server-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import ProviderPricingDetails from "../src/components/ProviderPricingDetails.vue";
import ProviderPricingOfferDetails from "../src/components/ProviderPricingOfferDetails.vue";
import PricingOfferBreakdown from "../src/components/PricingOfferBreakdown.vue";
import type {
  WebsitePricingOffer,
  WebsiteProvider,
  WebsiteProviderPricingDetail,
  WebsiteProviderPricingOffer,
} from "../src/catalog/website-schema.ts";

afterEach(() => vi.useRealTimers());

function ssrComponent(value: unknown): Component {
  if (typeof value !== "object" || value === null || !("ssrRender" in value))
    throw new Error("Vapor component is missing its SSR renderer");
  return value;
}

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
    schedule: { kind: "daily_time_remainder" as const, time_zone: "UTC" as const },
  },
  {
    key: "peak",
    label: "Peak",
    value: { namespace: "provider" as const, provider_id: "test", value: "peak" },
    schedule: {
      kind: "daily_time_windows" as const,
      time_zone: "UTC" as const,
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
    selectors: [],
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
  it("renders every conditional pricing state", async () => {
    const html = await renderToString(
      createSSRApp(ssrComponent(ProviderPricingOfferDetails), { offer: pricingOffer() }),
    );

    expect(html).toContain('aria-label="Pricing states"');
    expect(html).toContain("Free");
    expect(html).toContain("Promotion");
    expect(html).toContain("Numeric");
    expect(html).toContain("No promotion");
    expect(html).not.toContain("/pricing/index.json");
  });

  it("shows a categorical billing-period selector with its daily rule", async () => {
    const offer = pricingOffer();
    offer.selectors = [billingPeriodSelector];
    offer.rates = billingPeriodRates();

    const html = await renderToString(
      createSSRApp(ssrComponent(PricingOfferBreakdown), { offer, modelRef: "test/model" }),
    );

    expect(html).toContain('<section class="pricing-context"');
    expect(html).toContain('aria-label="Pricing options"');
    expect(html).not.toContain(">Pricing options</h6>");
    expect(html).not.toContain("Select Billing period to see rates.");
    expect(html).toContain('<details class="schedule-rule"');
    expect(html).not.toContain('<details class="schedule-rule" open');
    expect(html).toContain("Daily rule · UTC");
    expect(html).toContain("01:00–04:00, 06:00–10:00");
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
    const before = await renderToString(
      createSSRApp(ssrComponent(PricingOfferBreakdown), { offer, modelRef: "test/model" }),
    );
    expect(before).toContain("New rates");
    expect(before).toContain(`datetime="${transition}"`);
    expect(before).toContain("$0.90");
    expect(before).not.toContain("Billing period");
    expect(before).not.toContain("Pricing states");
    expect(before).not.toContain("currentness not asserted");

    vi.setSystemTime(new Date(transition));
    const after = await renderToString(
      createSSRApp(ssrComponent(PricingOfferBreakdown), { offer, modelRef: "test/model" }),
    );
    expect(after).not.toContain("New rates");
    expect(after).not.toContain("$0.90");
    expect(after).toContain("Billing period");
    expect(after).toContain("Daily rule · UTC");
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

    const html = await renderToString(
      createSSRApp(ssrComponent(ProviderPricingDetails), {
        provider,
        detail,
        loading: false,
        error: undefined,
      }),
    );

    expect(html).toContain("Normalized resources");
    expect(html).toContain("Find a resource or offer");
    expect(html).toContain('type="search"');
    expect(html).toContain("Reviewed service");
    expect(html).toContain("Unresolved official rows");
    expect(html).toContain("Unmapped source row");
    expect(html.match(/\/pricing\/index\.json/gu)).toHaveLength(1);
  });
});
