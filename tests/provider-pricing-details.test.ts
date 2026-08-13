import { createSSRApp, type Component } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vite-plus/test";
import ProviderPricingDetails from "../src/components/ProviderPricingDetails.vue";
import ProviderPricingOfferDetails from "../src/components/ProviderPricingOfferDetails.vue";
import type {
  WebsitePricingOffer,
  WebsiteProvider,
  WebsiteProviderPricingDetail,
  WebsiteProviderPricingOffer,
} from "../src/catalog/website-schema.ts";

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
