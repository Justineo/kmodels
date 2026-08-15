import { describe, expect, it } from "vite-plus/test";
import PricingDetails from "../src/components/PricingDetails.vue";
import type {
  WebsiteModel,
  WebsitePriceApplicability,
  WebsitePricingDetail,
  WebsitePricingOffer,
} from "../src/catalog/website-schema.ts";
import { renderComponent } from "./render-component.ts";

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
  options: {
    id?: string;
    title?: string;
    group?: WebsitePricingOffer["group"];
    mechanismRefs?: string[];
  } = {},
): WebsitePricingOffer {
  return {
    id: options.id ?? "b".repeat(64),
    title: options.title ?? "On-demand inference",
    group: options.group ?? "model_mechanism",
    ...(options.mechanismRefs === undefined ? {} : { mechanism_refs: options.mechanismRefs }),
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
  return renderComponent(PricingDetails, {
    model,
    detail,
    loading: false,
    error: undefined,
  });
}

describe("model pricing details", () => {
  it("shows invariant regional rates without making the user choose a region", async () => {
    const html = await render([offer([{ amount: "$2", scope: region("us", "eu") }])]);

    expect(html).toContain("$2");
    expect(html).toContain("/ 1M tokens");
    expect(html).not.toContain(">per 1M tokens<");
    expect(html).not.toContain(">Rates<");
    expect(html).toContain('<dl class="rate-grid fact-grid"');
    expect(html).not.toContain("<table");
    expect(html).not.toContain("<thead");
    expect(html).not.toContain("Region");
    expect(html).not.toContain("Run mode");
  });

  it("shows only context that changes the price", async () => {
    const html = await render([
      offer([
        { amount: "$2", scope: region("us") },
        { amount: "$3", scope: region("eu") },
      ]),
    ]);

    expect(html).toContain(">Region");
    expect(html).not.toContain("Select Region to see rates");
    expect(html).not.toContain("$2");
    expect(html).not.toContain("$3");
  });

  it("expands optional services directly after the base model rates", async () => {
    const mechanism = offer([{ amount: "$2", scope: region("us", "eu") }]);
    const service = offer([{ amount: "$10", scope: region("us", "eu") }], {
      id: "c".repeat(64),
      title: "Web Search",
      group: "optional_service",
      mechanismRefs: [mechanism.id],
    });

    const html = await render([mechanism, service]);

    expect(html).not.toContain("Base model");
    expect(html).toContain("$2");
    expect(html).toContain("Optional");
    expect(html).toContain("Web Search");
    expect(html).toContain("$10");
    expect(html.indexOf("$2")).toBeLessThan(html.indexOf("Web Search"));
    expect(html.indexOf("Web Search")).toBeLessThan(html.indexOf("$10"));
    expect(html).not.toContain("Additional request costs");
  });

  it("labels automatic components separately", async () => {
    const mechanism = offer([{ amount: "$2", scope: region("us", "eu") }]);
    const component = offer([{ amount: "$0.10", scope: region("us", "eu") }], {
      id: "d".repeat(64),
      title: "Underlying agent execution",
      group: "automatic_component",
      mechanismRefs: [mechanism.id],
    });

    const html = await render([mechanism, component]);

    expect(html).toContain("Automatic");
    expect(html).toContain("Underlying agent execution");
    expect(html).toContain("$0.10");
  });

  it("shows only costs related to the selected run mode", async () => {
    const interactive = offer([{ amount: "$2", scope: region("us", "eu") }], {
      title: "Interactive",
    });
    const batch = offer([{ amount: "$1", scope: region("us", "eu") }], {
      id: "c".repeat(64),
      title: "Batch",
    });
    const service = offer([{ amount: "$9", scope: region("us", "eu") }], {
      id: "d".repeat(64),
      title: "Batch tools",
      group: "optional_service",
      mechanismRefs: [batch.id],
    });

    const html = await render([interactive, batch, service]);

    expect(html).toContain("Run mode");
    expect(html).toContain("Interactive");
    expect(html).toContain("Batch");
    expect(html.match(/>Interactive</g)).toEqual([">Interactive<"]);
    expect(html).toContain("$2");
    expect(html).not.toContain("$1");
    expect(html).not.toContain("Batch tools");
    expect(html).not.toContain("$9");
  });

  it("resolves fixed request context without surfacing non-actionable metadata", async () => {
    const pricedOffer = offer([{ amount: "$2", scope: region("us") }]);
    const selector = pricedOffer.selectors[0];
    if (selector?.kind !== "categorical") throw new Error("Missing categorical test selector");
    selector.values = selector.values.slice(1);

    const html = await render([pricedOffer]);

    expect(html).toContain("$2");
    expect(html).not.toContain("Region");
    expect(html).not.toContain("Billing details");
    expect(html).not.toContain("Usage");
  });

  it("omits account-level plans and capacity from the model cost breakdown", async () => {
    const mechanism = offer([{ amount: "$2", scope: region("us", "eu") }]);
    const capacity = offer([], {
      id: "e".repeat(64),
      title: "Reserved throughput",
      group: "plan_capacity",
      mechanismRefs: [mechanism.id],
    });

    const html = await render([mechanism, capacity]);

    expect(html).not.toContain("Reserved throughput");
  });

  it("keeps driver metadata out of the primary rate table", async () => {
    const pricedOffer = offer([{ amount: "$2", scope: region("us", "eu") }]);
    const rate = pricedOffer.rates[0];
    if (rate === undefined) throw new Error("Missing test rate");
    rate.driver = {
      label: "Runtime input tokens",
      definition: "Input tokens reported for the completed request",
      aggregation: "Request",
      resolution_phase: "outcome",
    };

    const html = await render([pricedOffer]);

    expect(html).toContain("Input text");
    expect(html).not.toContain("Meter details");
    expect(html).not.toContain("Runtime input tokens");
  });

  it("keeps a retryable pricing state when detail loading fails", async () => {
    const html = await renderComponent(PricingDetails, {
      model,
      detail: undefined,
      loading: false,
      error: "Model details are temporarily unavailable.",
    });

    expect(html).toContain("Pricing unavailable");
    expect(html).toContain("Model details are temporarily unavailable.");
    expect(html).toContain("Retry");
  });
});
