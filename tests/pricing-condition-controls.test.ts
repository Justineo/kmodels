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
