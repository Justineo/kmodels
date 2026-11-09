import { describe, expect, it } from "vite-plus/test";
import PricingDetails from "../src/components/PricingDetails.vue";
import PricingServiceOffer from "../src/components/PricingServiceOffer.vue";
import { pricingSelection, retainPricingInputs } from "../src/catalog/pricing-selector-input.ts";
import { inferencePricingContext } from "../src/catalog/website-pricing-context.ts";
import type {
  WebsiteModel,
  WebsitePriceApplicability,
  WebsitePricingDetail,
  WebsitePricingOffer,
  WebsiteProvider,
} from "../src/catalog/website-schema.ts";
import { renderComponent } from "./render-component.ts";

const model = {
  provider_id: "test",
  model_id: "model",
  name: "Model",
  aliases: [],
  tasks: [],
  status: "active",
  release_stage: "stable",
  detail_chunk: 0,
  uid: "test/model",
  pricing: { outcome: "offers" },
} satisfies WebsiteModel;

const pricingDetailsContext = {
  model,
  provider: undefined,
  dataVersion: "a".repeat(64),
  loading: false,
  error: undefined,
};

const allContexts: WebsitePriceApplicability = { any_of: [{ all_of: [] }] };
type TestDimension = "inference_geo" | "region";

function categoricalContext(
  dimension: TestDimension,
  ...values: string[]
): WebsitePriceApplicability {
  return {
    any_of: values.map((value) => ({
      all_of: [
        {
          kind: "categorical",
          dimension: { namespace: "kmodels", value: dimension },
          values: [{ namespace: "provider", provider_id: "test", value }],
        },
      ],
    })),
  };
}

function region(...values: string[]): WebsitePriceApplicability {
  return categoricalContext("region", ...values);
}

function offer(
  prices: Array<{ amount: string; scope: WebsitePriceApplicability }>,
  options: {
    id?: string;
    title?: string;
    group?: WebsitePricingOffer["group"];
    mechanismRefs?: string[];
    stateSummary?: WebsitePricingOffer["state_summary"];
    selector?: { dimension: TestDimension; values: Array<{ value: string; label: string }> };
  } = {},
): WebsitePricingOffer {
  const stateSummary = options.stateSummary ?? "Metered pricing";
  const selector = options.selector ?? {
    dimension: "region",
    values: [
      { value: "eu", label: "EU" },
      { value: "us", label: "US" },
    ],
  };
  return {
    id: options.id ?? "b".repeat(64),
    title: options.title ?? "On-demand inference",
    group: options.group ?? "model_mechanism",
    ...(options.mechanismRefs === undefined ? {} : { mechanism_refs: options.mechanismRefs }),
    billing_mode: { label: "Usage" },
    state_summary: stateSummary,
    selectors: [
      {
        key: JSON.stringify({ namespace: "kmodels", value: selector.dimension }),
        label: selector.dimension === "region" ? "Region" : "Inference geo",
        dimension: { namespace: "kmodels", value: selector.dimension },
        kind: "categorical",
        values: selector.values.map(({ value, label }) => ({
          key: JSON.stringify({ namespace: "provider", provider_id: "test", value }),
          label,
          value: { namespace: "provider", provider_id: "test", value },
        })),
      },
    ],
    states: [
      {
        key: "state:0",
        state: stateSummary === "Included" ? "included" : "numeric",
        label: stateSummary === "Included" ? "Included" : "Numeric",
        applicability: categoricalContext(
          selector.dimension,
          ...selector.values.map(({ value }) => value),
        ),
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
    ...pricingDetailsContext,
    detail,
  });
}

it("retains exact compatible inputs and drops values outside the destination options", () => {
  const original = offer([]).selectors;
  const regional = offer([], {
    selector: { dimension: "region", values: [{ value: "us", label: "United States" }] },
  }).selectors;
  const selector = original[0];
  if (selector?.kind !== "categorical") throw new Error("Missing Region fixture");
  const [eu, us] = selector.values;
  if (eu === undefined || us === undefined) throw new Error("Missing Region values");
  expect(retainPricingInputs(original, regional, { [selector.key]: us.key })).toEqual({
    [selector.key]: us.key,
  });
  expect(retainPricingInputs(original, regional, { [selector.key]: eu.key })).toEqual({});
});

it("shares only selectors on which all inference candidates agree", () => {
  const [selector] = offer([]).selectors;
  if (selector?.kind !== "categorical") throw new Error("Missing Region fixture");
  const [eu, us] = selector.values.map(({ key }) => pricingSelection(selector, key));
  if (eu === undefined || us === undefined) throw new Error("Missing Region values");
  const shared = inferencePricingContext(
    model.uid,
    [
      { offer_ref: "first", selectors: [us] },
      { offer_ref: "second", selectors: [us] },
    ],
    [],
  );
  expect(shared).toEqual({ modelRef: model.uid, offerRefs: ["first", "second"], selections: [us] });
  expect(
    inferencePricingContext(
      model.uid,
      [
        { offer_ref: "first", selectors: [us] },
        { offer_ref: "second", selectors: [eu] },
      ],
      [],
    ).selections,
  ).toEqual([]);
});

it("offers a supported Pricing Region as a local service preference", async () => {
  const service = offer([
    { amount: "$2", scope: region("us") },
    { amount: "$3", scope: region("eu") },
  ]);
  const [selector] = service.selectors;
  if (selector?.kind !== "categorical") throw new Error("Missing Region fixture");
  const us = selector.values[1];
  if (us === undefined) throw new Error("Missing US fixture");
  const preferredRegion = { dimension: selector.dimension, kind: "categorical", value: us.value };
  const html = await renderComponent(PricingServiceOffer, { offer: service, preferredRegion });
  expect(html).toContain("Pricing region · US");
  expect(html).toContain("$2");
  expect(html).not.toContain("$3");
  const unavailable = await renderComponent(PricingServiceOffer, {
    offer: service,
    preferredRegion: { ...preferredRegion, value: { ...us.value, value: "unavailable" } },
  });
  expect(unavailable).not.toContain("Pricing region");
  expect(unavailable).not.toContain('class="exact-rate"');
});

it("binds a reviewed condition only for one current compatible plan", async () => {
  const plan = "c".repeat(64);
  const service = offer([
    { amount: "$2", scope: region("us") },
    { amount: "$3", scope: region("eu") },
  ]);
  const [selector] = service.selectors;
  if (selector?.kind !== "categorical") throw new Error("Missing Region fixture");
  const us = selector.values[1];
  if (us === undefined) throw new Error("Missing US fixture");
  const selection = pricingSelection(selector, us.key);
  if (selection === undefined) throw new Error("Missing US selection");
  const context = { modelRef: model.uid, offerRefs: [plan], selections: [selection] };
  service.mechanism_links = [
    {
      offer_ref: plan,
      kind: "compatible_with",
      applicability: allContexts,
      shared_dimensions: [selector.dimension],
    },
  ];
  const linked = await renderComponent(PricingServiceOffer, {
    offer: service,
    pricingContext: context,
  });
  expect(linked).toContain("From Pricing");
  expect(linked).toContain("$2");
  expect(linked).not.toContain("$3");
  const unresolved = await renderComponent(PricingServiceOffer, {
    offer: service,
    pricingContext: { ...context, offerRefs: [plan, "d".repeat(64)] },
  });
  expect(unresolved).not.toContain("From Pricing");
  expect(unresolved).not.toContain('class="exact-rate"');
});

describe("model pricing details", () => {
  it("does not fall back to unfiltered catalog prices for known price exclusions", async () => {
    const html = await renderComponent(PricingDetails, {
      ...pricingDetailsContext,
      detail: { offers: [offer([{ amount: "$2", scope: region("us", "eu") }])] },
      inferencePrices: [
        {
          model_id: "model",
          status: "unknown",
          reason: "no_applicable_price",
          explanation: "No published price applies to these conditions at the evaluated time.",
          missing_conditions: [],
          evidence_urls: [],
          candidates: [],
        },
      ],
    });
    expect(html).toContain("No applicable prices");
    expect(html).toContain("Same as Catalog ID");
    expect(html).not.toContain("Copy inference model ID");
    expect(html).not.toContain("$2");
    expect(html).not.toContain("The catalog prices below");
  });

  it("preserves catalog prices when inference ID associations are unknown", async () => {
    const html = await renderComponent(PricingDetails, {
      ...pricingDetailsContext,
      detail: { offers: [offer([{ amount: "$2", scope: region("us", "eu") }])] },
      inferencePrices: [
        {
          model_id: "model",
          status: "unknown",
          reason: "unreviewed_id",
          explanation: "No verified inference price mapping is available for this identifier.",
          missing_conditions: [],
          evidence_urls: [],
          candidates: [],
        },
      ],
    });
    expect(html).toContain("Price mapping unknown");
    expect(html).toContain("The catalog prices below are not verified for an inference model ID.");
    expect(html).not.toContain("Catalog ID");
    expect(html).not.toContain("Inference model ID");
    expect(html).toContain("$2");
    expect(html).not.toContain("Applicable prices");
  });

  it("preserves catalog prices when the same ID is mapped to another catalog entry", async () => {
    const catalogOffer = offer([{ amount: "$2", scope: allContexts }]);
    const html = await renderComponent(PricingDetails, {
      ...pricingDetailsContext,
      detail: { offers: [catalogOffer] },
      inferencePrices: [
        {
          model_id: model.model_id,
          status: "matched",
          explanation: "The documented ID mapping identifies these prices.",
          missing_conditions: [],
          evidence_urls: [],
          candidates: [{ offer_ref: "c".repeat(64), selectors: [] }],
          matching: {
            generated_at: "2026-11-01T00:00:00.000Z",
            observed_at: "2026-11-01T00:00:00.000Z",
            rules: [
              {
                model_ref: "test/another-model",
                offer_refs: ["c".repeat(64)],
                fixed_selectors: [],
              },
            ],
            offers: [{ id: "c".repeat(64), states: [], relations: [], terms: [] }],
            referenced_rates: [],
          },
        },
      ],
    });
    expect(html).toContain("Price mapping unknown");
    expect(html).toContain("$2");
    expect(html).not.toContain("Inference model ID");
    expect(html).not.toContain("Same as Catalog ID");
  });

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
    expect(html).toContain("Run mode");
    expect(html).toContain("On-demand inference");
  });

  it("shows only context that changes the price", async () => {
    const html = await render([
      offer([
        { amount: "$2", scope: region("us") },
        { amount: "$3", scope: region("eu") },
      ]),
    ]);

    expect(html).toContain(">Region");
    expect(html).toContain("ui-select");
    expect(html).not.toContain('type="radio"');
    expect(html).toContain(">US<");
    expect(html).toContain(">EU<");
    expect(html).not.toContain("Select Region to see rates");
    expect(html).not.toContain("$2");
    expect(html).not.toContain("$3");
  });

  it("uses published geography labels without inventing defaults or rewriting their meaning", async () => {
    const pricedOffer = offer(
      [
        { amount: "$2", scope: categoricalContext("inference_geo", "global") },
        { amount: "$2.20", scope: categoricalContext("inference_geo", "us") },
      ],
      {
        selector: {
          dimension: "inference_geo",
          values: [
            { value: "global", label: "Worldwide inference" },
            { value: "us", label: "United States routing" },
          ],
        },
      },
    );

    const html = await render([pricedOffer]);

    expect(html).toContain("Worldwide inference");
    expect(html).toContain("United States routing");
    expect(html).not.toContain("(default)");
    expect(html).not.toContain("US-only");
    expect(html).toContain("ui-select");
    expect(html).not.toContain('type="radio"');
  });

  it("uses the same select for larger categorical choices", async () => {
    const values = ["apac", "eu", "other", "us"];
    const pricedOffer = offer(
      values.map((value, index) => ({
        amount: `$${index + 1}`,
        scope: categoricalContext("region", value),
      })),
      {
        selector: {
          dimension: "region",
          values: values.map((value) => ({ value, label: value.toUpperCase() })),
        },
      },
    );

    const html = await render([pricedOffer]);

    expect(html).toContain("ui-select");
    expect(html).not.toContain('type="radio"');
  });

  it("groups supplementary services after the base model rates", async () => {
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
    const panelId = html.match(
      /<button[^>]*class="detail-disclosure-trigger"[^>]*aria-expanded="false"[^>]*aria-controls="([^"]+)"/,
    )?.[1];
    if (panelId === undefined) throw new Error("Missing other charges disclosure button");
    expect(html).toContain(`id="${panelId}"`);
    expect(html).toContain("#ui-chevron-right");
    expect(html).toContain("Other charges &amp; services");
    expect(html).toContain("Service charge");
    expect(html).toContain("Web Search");
    expect(html).toContain("$10");
    expect(html.indexOf("$2")).toBeLessThan(html.indexOf("Web Search"));
    expect(html.indexOf("Web Search")).toBeLessThan(html.indexOf("$10"));
    expect(html).not.toContain("Optional");
  });

  it("uses one other-charges disclosure for both model and provider services", async () => {
    const mechanism = offer([{ amount: "$2", scope: allContexts }]);
    const service = offer([{ amount: "$10", scope: allContexts }], {
      id: "c".repeat(64),
      title: "Web Search",
      group: "optional_service",
    });
    const provider = {
      id: "test",
      name: "Test",
      pricing_coverage: {
        representative_models: 0,
        offer_models: 1,
        unknown_models: 0,
        not_applicable_models: 0,
        standalone_resources: 2,
        detail_chunks: 1,
      },
    } satisfies WebsiteProvider;
    const html = await renderComponent(PricingDetails, {
      ...pricingDetailsContext,
      provider,
      detail: { offers: [mechanism, service] },
    });
    expect(html.match(/Other charges &amp; services/g)).toHaveLength(1);
    expect(html.match(/class="detail-disclosure additional-costs"/g)).toHaveLength(1);
    expect(html).toContain("Web Search");
    expect(html).not.toContain("Test services");
    expect(html).not.toContain('class="provider-services"');
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

    expect(html).toContain("Automatic charge");
    expect(html).toContain("Underlying agent execution");
    expect(html).toContain("$0.10");
  });

  it("does not repeat the Included state for included features", async () => {
    const mechanism = offer([{ amount: "$2", scope: region("us", "eu") }]);
    const included = offer([], {
      id: "e".repeat(64),
      title: "Prompt caching",
      group: "optional_service",
      mechanismRefs: [mechanism.id],
      stateSummary: "Included",
    });

    const html = await render([mechanism, included]);

    expect(html).toContain("Included feature");
    expect(html).toContain("Prompt caching");
    expect(html).not.toContain("published-status");
    expect(html).not.toContain('<small class="offer-state">Included</small>');
  });

  it("presents allowances and raw provider conditions as plain-language pricing notes", async () => {
    const mechanism = offer([{ amount: "$2", scope: region("us", "eu") }]);
    const service = offer([{ amount: "$0.05", scope: region("us", "eu") }], {
      id: "f".repeat(64),
      title: "Code Execution",
      group: "optional_service",
      mechanismRefs: [mechanism.id],
    });
    service.allowances = [
      {
        key: "allowance:0",
        value: "1,550 hours",
        target: "Applies to Container runtime",
        reset: "Resets monthly",
        applicability: allContexts,
        applicability_label: "All contexts",
      },
    ];
    service.unnormalized_count = 2;
    service.unnormalized = [
      {
        key: "raw:0",
        label: "Minimum runtime",
        impact: "informational",
        reason: "Unsupported structure",
        possible_scope: allContexts,
      },
      {
        key: "raw:1",
        label: "Runtime observation",
        impact: "informational",
        reason: "Requires usage aggregation",
        possible_scope: allContexts,
      },
    ];

    const html = await render([mechanism, service]);

    expect(html).toContain("Included usage");
    expect(html).toContain("1,550 hours");
    expect(html).toContain("Applies to Container runtime · Resets monthly");
    expect(html).toContain("Pricing notes");
    expect(html).toContain("Exact cost depends on usage measured separately by the provider.");
    expect(html).not.toContain("Source exceptions");
    expect(html).not.toContain("Unsupported structure");
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

  it("shows linked capacity separately from model rates", async () => {
    const mechanism = offer([{ amount: "$2", scope: region("us", "eu") }]);
    const capacity = offer([], {
      id: "e".repeat(64),
      title: "Instance hosting",
      group: "capacity",
      mechanismRefs: [mechanism.id],
    });
    const plan = offer([], {
      id: "f".repeat(64),
      title: "Annual commitment",
      group: "plan",
      mechanismRefs: [mechanism.id],
    });

    const html = await render([mechanism, capacity, plan]);

    expect(html).toContain("Capacity charges");
    expect(html).toContain("Instance hosting");
    expect(html).not.toContain("Annual commitment");
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
      ...pricingDetailsContext,
      detail: undefined,
      error: "Model details are temporarily unavailable.",
    });

    expect(html).toContain("Pricing unavailable");
    expect(html).toContain("Model details are temporarily unavailable.");
    expect(html).toContain("Retry");
  });
});
