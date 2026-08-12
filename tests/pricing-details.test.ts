import { createSSRApp, type Component } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vite-plus/test";
import PricingDetails from "../src/components/PricingDetails.vue";
import type {
  WebsiteModel,
  WebsitePriceApplicability,
  WebsitePricingDetail,
  WebsitePricingOffer,
} from "../src/catalog/website-schema.ts";

const model = {
  provider_id: "test",
  model_id: "model",
  name: "Model",
  tasks: [],
  status: "active",
  release_stage: "stable",
  detail_chunk: 0,
  uid: "test/model",
  pricing: { outcome: "offers" },
} satisfies WebsiteModel;

function ssrComponent(value: unknown): Component {
  if (typeof value !== "object" || value === null || !("ssrRender" in value))
    throw new Error("Vapor component is missing its SSR renderer");
  return value;
}

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
    title: "On-demand inference",
    group: "model_mechanism",
    billing_mode: { label: "Usage" },
    state_summary: "Metered pricing",
    selectors: [
      {
        key: JSON.stringify({ namespace: "kmodels", value: "region" }),
        label: "Region",
        dimension: { namespace: "kmodels", value: "region" },
        kind: "categorical",
        values: ["eu", "us"].map((value) => ({
          key: JSON.stringify({ namespace: "provider", provider_id: "test", value }),
          label: value.toUpperCase(),
          value: { namespace: "provider", provider_id: "test", value },
        })),
      },
    ],
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
      term_ref: "a".repeat(64),
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

async function render(offers: WebsitePricingOffer[]): Promise<string> {
  const detail = { offers } satisfies WebsitePricingDetail;
  return renderToString(
    createSSRApp(ssrComponent(PricingDetails), { model, detail, loading: false }),
  );
}

describe("model pricing details", () => {
  it("shows invariant regional rates without making the user choose a region", async () => {
    const html = await render([offer([{ amount: "$2", scope: region("us", "eu") }])]);

    expect(html).toContain("Published rates");
    expect(html).toContain("$2");
    expect(html).toContain("Same across available Region options");
    expect(html).not.toContain("Price options");
    expect(html).not.toContain("Choose an offer");
  });

  it("asks only for context that changes the price", async () => {
    const html = await render([
      offer([
        { amount: "$2", scope: region("us") },
        { amount: "$3", scope: region("eu") },
      ]),
    ]);

    expect(html).toContain("Price options");
    expect(html).toContain("Choose Region to see rates");
    expect(html).not.toContain("$2");
    expect(html).not.toContain("$3");
  });
});
