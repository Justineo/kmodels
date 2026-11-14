import { expect, it } from "vite-plus/test";
import { canonicalJson } from "../src/catalog/canonical-value.ts";
import {
  fixedInferenceCommercialChoices,
  fixedInferenceSelections,
  inferencePriceOptions,
} from "../src/catalog/inference-price-options.ts";
import { unconditionalApplicability } from "../src/catalog/pricing-canonical.ts";
import { formatConditionValue } from "../src/catalog/pricing-presentation.ts";
import type { CommercialChoice, PriceApplicability } from "../src/catalog/pricing-schema.ts";
import {
  commercialControlChoices,
  retainCommercialChoices,
} from "../src/catalog/pricing-selector-input.ts";
import { queryWebsiteCommercialOffer } from "../src/catalog/website-commercial-query.ts";
import type { WebsitePricingOffer, WebsitePricingSelector } from "../src/catalog/website-schema.ts";
import { matchInferencePrices } from "../src/pricing/inference-matching.ts";
import type { InferenceMatchData } from "../src/pricing/inference-matching-schema.ts";
import PricingControls from "../src/components/PricingControls.vue";
import InferencePrices from "../src/components/InferencePrices.vue";
import { renderComponent } from "./render-component.ts";

const at = "2026-11-01T00:00:00.000Z";
type TestChoice = CommercialChoice & { dimension: "service_tier" | "speed" };
const choice = (dimension: TestChoice["dimension"], value: string): TestChoice => ({
  dimension,
  value: { namespace: "kmodels", value },
});
const standard = choice("service_tier", "standard");
const priority = choice("service_tier", "priority");
const flex = choice("service_tier", "flex");
const normal = choice("speed", "standard");
const optimized = choice("speed", "optimized");
function scope(choices: TestChoice[]): PriceApplicability {
  return {
    any_of: [
      {
        all_of: choices.map(({ dimension, value }) => ({
          kind: "categorical",
          dimension: { namespace: "kmodels", value: dimension },
          values: [value],
        })),
      },
    ],
  };
}
const combinations = [[standard, normal], [standard, optimized], [priority], [flex]];
const claims = combinations.flatMap((choices) =>
  choices.map((selected) => ({
    dimension: selected.dimension,
    target: "condition" as const,
    coverage: "complete" as const,
    applicability: scope(choices),
    alternatives: [{ value: selected.value, applicability: scope([selected]) }],
  })),
);
const data: InferenceMatchData = {
  generated_at: at,
  observed_at: at,
  rules: [{ model_ref: "fixture/model", offer_refs: ["plan"], fixed_selectors: [] }],
  offers: [
    {
      id: "plan",
      states: [{ applicability: unconditionalApplicability, semantics: 0, state: "numeric" }],
      relations: [],
      selection: claims,
      terms: [
        {
          id: "input",
          kind: "rate",
          raw_variants: [],
          variants: combinations.map((choices, semantics) => ({
            applicability: scope(choices),
            semantics,
          })),
        },
      ],
    },
  ],
  referenced_rates: [],
};
const offer: WebsitePricingOffer = {
  id: "plan",
  title: "Public rates",
  group: "model_mechanism",
  billing_mode: { label: "Usage" },
  state_summary: "Metered pricing",
  selectors: [],
  states: [],
  allowances: [],
  contributions: [],
  enrollment: [],
  settlement: [],
  unnormalized_count: 0,
  unnormalized: [],
  commercial_selection: { observed_at: at, claims },
  rates: combinations.map((choices, index) => ({
    key: String(index),
    term_ref: "input",
    label: "Input",
    amount: `$${index + 1}`,
    unit: "per 1M tokens",
    accessible_text: `$${index + 1} per 1M tokens`,
    applicability: scope(choices),
    applicability_label: "Fixture conditions",
  })),
};

for (const mode of ["inference", "offer"] as const) {
  const query = (choices: CommercialChoice[]) => {
    if (mode === "offer") {
      const current = queryWebsiteCommercialOffer(offer, [], choices, at);
      return {
        available: current.available_choices,
        inferred: current.fixed_choices,
        hasPrices: current.offer.rates.length > 0,
      };
    }
    const current = matchInferencePrices(data, [], at, undefined, undefined, choices);
    return {
      available: current.available_choices,
      inferred: fixedInferenceCommercialChoices(
        data,
        current,
        current.available_choices,
        at,
        choices,
      ),
      hasPrices: current.candidates.length > 0,
    };
  };
  const render = (selected: CommercialChoice[]) => {
    const current = query(selected);
    return renderComponent(PricingControls, {
      prefix: "fixture",
      selected,
      inferred: current.inferred,
      selectors: [],
      inputs: {},
      choices: commercialControlChoices(query([]).available, current.available, selected),
    });
  };
  const edit = (previous: CommercialChoice[], next: CommercialChoice) =>
    retainCommercialChoices(
      previous,
      [...previous.filter(({ dimension }) => dimension !== next.dimension), next],
      (choices) => query(choices).hasPrices,
    );

  it(`${mode}: keeps inferred tiers editable and gives both selection orders the same controls`, async () => {
    const speedFirst = edit([], normal);
    expect(query(speedFirst).inferred).toContainEqual(expect.objectContaining(standard));
    const implicit = await render(speedFirst);
    const explicit = await render(edit(edit([], standard), normal));
    expect(implicit).toBe(explicit);
    expect(implicit).toContain('id="fixture-service_tier"');
    expect(implicit).toContain('id="fixture-speed"');
    expect(implicit).toContain("Priority");
    expect(implicit).toContain("Flex");
    expect(implicit).toContain("Latency optimized");
    expect(implicit).not.toContain('aria-label="Price scope"');

    for (const tier of [priority, flex]) {
      const changed = edit(speedFirst, tier);
      expect(changed).toEqual([tier]);
      expect(query(changed).hasPrices).toBe(true);
      expect(await render(changed)).not.toContain('id="fixture-speed"');
      const restored = edit(changed, standard);
      expect(await render(restored)).toContain('id="fixture-speed"');
      expect(edit(restored, optimized)).toEqual([optimized, standard]);
    }
  });
}

it("distinguishes the original native domain from a dependent singleton", () => {
  const initial = matchInferencePrices(data, [], at);
  const native: WebsitePricingSelector = {
    key: "tier",
    label: "Service tier",
    kind: "categorical",
    dimension: { namespace: "kmodels", value: "service_tier" },
    values: [standard, priority, flex].map(({ value }) => ({
      key: canonicalJson(value),
      label: value.value,
      value,
    })),
  };
  const current = matchInferencePrices(data, [], at, undefined, undefined, [normal]);
  const original = inferencePriceOptions(data, initial, [native], at);
  expect(fixedInferenceSelections(original, current)).toEqual([]);
  expect(
    current.available_choices.filter(({ dimension }) => dimension === "service_tier"),
  ).toMatchObject([standard]);
});

it("disables native-incompatible commercial alternatives without making a dependent singleton readonly", async () => {
  const choices = [normal, optimized].map((choice) => ({ ...choice, offer_refs: ["plan"] }));
  const props = {
    prefix: "scope",
    choices,
    available: choices.slice(0, 1),
    selected: [],
    inferred: [normal],
    selectors: [],
    inputs: {},
  };
  const html = await renderComponent(PricingControls, props);
  expect(html).toContain("<select");
  expect(html).toMatch(/<option\b[^>]*disabled[^>]*>[\s\S]*?Latency optimized/);
  expect(html).not.toContain("<output");
  const absent = await renderComponent(PricingControls, { ...props, available: [] });
  expect(absent).not.toContain("<select");
});

it("uses the same speed labels for canonical controls, native choices and fixed scope", async () => {
  const speed: WebsitePricingSelector = {
    key: "speed",
    label: "Speed",
    kind: "categorical",
    dimension: { namespace: "kmodels", value: "speed" },
    values: [normal, optimized].map(({ value }) => ({
      key: value.value,
      label: value.value,
      value,
    })),
  };
  const props = { prefix: "native", choices: [], selected: [], inferred: [], inputs: {} };
  const editable = await renderComponent(PricingControls, { ...props, selectors: [speed] });
  expect(editable).toContain('value="optimized"');
  expect(editable).toContain("Latency optimized");
  expect(editable).toContain(">Standard<");
  expect(editable).not.toContain(">optimized<");

  const fixed = await renderComponent(PricingControls, {
    ...props,
    selectors: [{ ...speed, values: speed.values.slice(1) }],
  });
  const canonical = await renderComponent(PricingControls, {
    ...props,
    selectors: [],
    choices: [{ ...optimized, offer_refs: ["plan"] }],
    inferred: [optimized],
  });
  for (const html of [fixed, canonical]) {
    expect(html).toMatch(/<output\b[^>]*>Latency optimized<\/output>/);
    expect(html).not.toContain("<select");
  }
  expect(
    formatConditionValue(
      { namespace: "kmodels", value: "quality" },
      optimized.value,
      "Provider quality",
    ),
  ).toBe("Provider quality");
  expect(optimized.value.value).toBe("optimized");
});

it("hides fixed billing and request modes while retaining real request and cache choices", async () => {
  const request: CommercialChoice = {
    dimension: "execution",
    value: { namespace: "kmodels", value: "request" },
  };
  const billing: CommercialChoice = {
    dimension: "billing_mode",
    value: { namespace: "kmodels", value: "usage" },
  };
  const cache: WebsitePricingSelector = {
    key: "cache",
    label: "Cache mode",
    dimension: { namespace: "provider", provider_id: "dashscope", value: "cache_mode" },
    kind: "categorical",
    values: ["implicit", "explicit"].map((value) => ({
      key: value,
      label: value,
      value: { namespace: "provider", provider_id: "dashscope", value },
    })),
  };
  const props = {
    prefix: "modes",
    selected: [],
    inferred: [request, billing],
    choices: [request, billing].map((choice) => ({ ...choice, offer_refs: ["plan"] })),
    inputs: {},
    selectors: [{ ...cache, values: cache.values.slice(0, 1) }],
  };
  const fixed = await renderComponent(PricingControls, props);
  for (const label of ["Billing basis", "Request mode", "Cache mode", "Price scope"])
    expect(fixed).not.toContain(label);

  const selectable = await renderComponent(PricingControls, {
    ...props,
    selectors: [cache],
    choices: [
      ...props.choices,
      ...["batch", "realtime"].map((value) => ({
        ...request,
        value: { namespace: "kmodels" as const, value },
        offer_refs: ["plan"],
      })),
    ],
  });
  expect(selectable).toContain("Request mode");
  expect(selectable).toContain("Batch");
  expect(selectable).toContain("Realtime");
  expect(selectable).toContain("Cache mode");
  expect(selectable).toContain("explicit");
  expect(selectable).not.toContain("Billing basis");
});

it("still matches hidden singleton modes without repeating them beside inference rates", async () => {
  const execution = { namespace: "kmodels", value: "execution" } as const;
  const cache = { namespace: "provider", provider_id: "dashscope", value: "cache_mode" } as const;
  const modes: WebsitePricingSelector[] = [
    {
      key: "request",
      label: "Request mode",
      dimension: execution,
      kind: "categorical",
      values: [
        { key: "request", label: "Request", value: { namespace: "kmodels", value: "request" } },
      ],
    },
    {
      key: "cache",
      label: "Cache mode",
      dimension: cache,
      kind: "categorical",
      values: [
        {
          key: "implicit",
          label: "Implicit",
          value: { namespace: "provider", provider_id: "dashscope", value: "implicit" },
        },
      ],
    },
  ];
  const applicability: PriceApplicability = {
    any_of: [
      {
        all_of: [
          {
            kind: "categorical",
            dimension: execution,
            values: [{ namespace: "kmodels", value: "request" }],
          },
          {
            kind: "categorical",
            dimension: cache,
            values: [{ namespace: "provider", provider_id: "dashscope", value: "implicit" }],
          },
        ],
      },
    ],
  };
  const matching = structuredClone(data);
  const mappedOffer = matching.offers[0];
  const rate = offer.rates[0];
  if (!mappedOffer || !rate) throw new Error("Missing mode fixture");
  mappedOffer.selection = [];
  mappedOffer.terms = [
    { id: "input", kind: "rate", variants: [{ applicability, semantics: 0 }], raw_variants: [] },
  ];
  const html = await renderComponent(InferencePrices, {
    modelRef: "fixture/model",
    prices: [
      {
        model_id: "fixture-request",
        status: "candidates",
        explanation: "Fixture pricing",
        missing_conditions: [],
        evidence_urls: [],
        candidates: [],
        matching,
        pricing_options: modes,
      },
    ],
    offers: [{ ...offer, rates: [{ ...rate, key: "input:rate:0", applicability }] }],
  });
  expect(html).toContain("Applicable prices");
  expect(html).toContain("$1");
  expect(html).not.toContain("Request mode");
  expect(html).not.toContain("Cache mode");
  expect(html).not.toContain("Price scope");
  expect(
    matchInferencePrices(
      matching,
      [
        {
          kind: "categorical",
          dimension: cache,
          value: { namespace: "provider", provider_id: "dashscope", value: "explicit" },
        },
      ],
      at,
    ).candidates,
  ).toEqual([]);
});

it("explains the API region and inference scope with provider-specific meanings", async () => {
  const selectors: WebsitePricingSelector[] = ["region", "deployment_scope"].map((dimension) => ({
    key: dimension,
    label: dimension === "region" ? "Region" : "Deployment scope",
    dimension: {
      namespace: "kmodels",
      value: dimension === "region" ? "region" : "deployment_scope",
    },
    kind: "categorical",
    values: ["first", "second"].map((value) => ({
      key: value,
      label: value,
      value: { namespace: "provider", provider_id: "dashscope", value },
    })),
  }));
  const html = await renderComponent(PricingControls, {
    prefix: "geography",
    choices: [],
    selected: [],
    inferred: [],
    selectors,
    inputs: {},
  });
  expect(html).toContain("API access and data storage region");
  expect(html).toContain("Global can use compute outside the API region");
  expect(html).toContain('tabindex="0"');
});
