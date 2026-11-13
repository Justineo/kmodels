import { expect, it } from "vite-plus/test";
import {
  fixedInferenceCommercialChoices,
  fixedInferenceSelections,
  inferencePriceOptions,
} from "../src/catalog/inference-price-options.ts";
import { unconditionalApplicability } from "../src/catalog/pricing-canonical.ts";
import type { PriceApplicability, PriceCategoricalValue } from "../src/catalog/pricing-schema.ts";
import type { WebsitePricingSelector } from "../src/catalog/website-schema.ts";
import { matchInferencePrices } from "../src/pricing/inference-matching.ts";
import type { CommercialChoice } from "../src/catalog/pricing-schema.ts";
import InferencePrices from "../src/components/InferencePrices.vue";
import { renderComponent } from "./render-component.ts";
import type { InferenceMatchData } from "../src/pricing/inference-matching-schema.ts";

const at = "2026-10-30T00:00:00.000Z";
const boundary = "2026-10-31T00:00:00.000Z";
const after = "2026-11-01T00:00:00.000Z";
const dimension = { namespace: "kmodels", value: "region" } as const;
const regions = ["eu", "us", "other", "unavailable"];
const region = (value: string): PriceCategoricalValue => ({
  namespace: "provider",
  provider_id: "fixture",
  value,
});
const option = {
  key: "region",
  label: "Region",
  dimension,
  kind: "categorical",
  values: regions.map((value) => ({ key: value, label: value, value: region(value) })),
} satisfies WebsitePricingSelector;
const scope = (value: string): PriceApplicability => ({
  any_of: [{ all_of: [{ dimension, kind: "categorical", values: [region(value)] }] }],
});

function fixture(rawScope?: PriceApplicability): InferenceMatchData {
  return {
    generated_at: at,
    observed_at: at,
    rules: [{ model_ref: "fixture/model", offer_refs: ["plan"], fixed_selectors: [] }],
    offers: [
      {
        id: "plan",
        states: [{ applicability: unconditionalApplicability, semantics: 0, state: "numeric" }],
        relations: [],
        terms: [
          {
            id: "input",
            kind: "rate",
            variants: [
              { applicability: scope("eu"), semantics: 0 },
              {
                applicability: scope("us"),
                semantics: 1,
                validity: { until: { value: boundary, precision: "datetime", inclusive: false } },
              },
            ],
            raw_variants: [
              { possible_scope: rawScope, impact: "informational", reason: "Fixture evidence" },
            ],
          },
        ],
      },
    ],
    referenced_rates: [],
  };
}

function menu(data: InferenceMatchData, time: string): string[] {
  const initial = matchInferencePrices(data, [], time, "plan");
  const [scoped] = inferencePriceOptions(data, initial, [option], time, "plan");
  return scoped?.kind === "categorical" ? scoped.values.map(({ key }) => key) : [];
}

it("indexes current price evidence and excludes an expired Region at its precise boundary", () => {
  const data = fixture(scope("other"));
  expect(menu(data, at)).toEqual(["eu", "us", "other"]);
  expect(menu(data, boundary)).toEqual(["eu", "other"]);
  expect(menu(data, after)).toEqual(["eu", "other"]);
});

it("admits every published choice when one compatible evidence clause omits the dimension", () => {
  expect(menu(fixture(), at)).toEqual(regions);
});

it("keeps a sole published Region conditional in lookup while allowing its schedule to be browsed", () => {
  const data = fixture();
  const term = data.offers[0]?.terms[0];
  const rule = data.rules[0];
  if (!term || !rule) throw new Error("Missing fixture data");
  term.variants = [{ applicability: scope("eu"), semantics: 0 }];
  term.raw_variants = [];

  const unresolved = matchInferencePrices(data, [], at);
  expect(unresolved.status).toBe("candidates");
  expect(unresolved.missing_conditions).toEqual([dimension]);
  const options = inferencePriceOptions(data, unresolved, [option], at);
  const priceScope = fixedInferenceSelections(options, unresolved);
  expect(priceScope).toEqual([{ kind: "categorical", dimension, value: region("eu") }]);
  expect(matchInferencePrices(data, priceScope, at).status).toBe("matched");

  // Browsing this schedule does not erase its predicate or establish runtime geography.
  expect(matchInferencePrices(data, [], at).missing_conditions).toEqual([dimension]);
  expect(
    matchInferencePrices(data, [{ kind: "categorical", dimension, value: region("us") }], at)
      .reason,
  ).toBe("no_applicable_price");
  rule.fixed_selectors = [{ kind: "categorical", dimension, value: region("eu") }];
  expect(matchInferencePrices(data, [], at).status).toBe("matched");
});

it.each(["service_tier", "speed"] as const)(
  "resolves a sole native %s before canonical controls without excluding unqualified sibling prices",
  async (field) => {
    const data = fixture();
    const offer = data.offers[0];
    const term = offer?.terms[0];
    if (!offer || !term) throw new Error("Missing fixture offer");
    const dimension = { namespace: "kmodels", value: field } as const;
    const standard = { namespace: "provider", provider_id: "fixture", value: "standard" } as const;
    const nativeScope: PriceApplicability = {
      any_of: [{ all_of: [{ kind: "categorical", dimension, values: [standard] }] }],
    };
    const qualified: PriceApplicability = {
      any_of: [
        {
          all_of: [
            ...(scope("eu").any_of[0]?.all_of ?? []),
            ...nativeScope.any_of.flatMap((c) => c.all_of),
          ],
        },
      ],
    };
    offer.selection = [
      {
        dimension: field,
        coverage: "complete",
        target: "condition",
        applicability: qualified,
        alternatives: [
          { value: { namespace: "kmodels", value: "standard" }, applicability: nativeScope },
        ],
      },
    ];
    term.variants = [
      { applicability: qualified, semantics: 0 },
      { applicability: scope("us"), semantics: 1 },
    ];
    term.raw_variants = [];
    const native: WebsitePricingSelector = {
      key: field,
      label: field === "speed" ? "Speed" : "Service tier",
      dimension,
      kind: "categorical",
      values: [{ key: "standard", label: "Standard", value: standard }],
    };
    const initial = matchInferencePrices(data, [], at);
    const options = inferencePriceOptions(data, initial, [option, native], at);
    const automatic = fixedInferenceSelections(options, initial);
    const matched = matchInferencePrices(data, automatic, at);
    expect(matched.candidates[0]?.terms[0]?.variants).toEqual([0, 1]);
    expect(matched.missing_conditions.map(({ value }) => value)).toEqual(["region"]);
    const price = {
      model_id: "fixture-request",
      status: "candidates" as const,
      explanation: "Fixture pricing",
      missing_conditions: [],
      evidence_urls: [],
      candidates: [{ offer_ref: offer.id, selectors: [] }],
      matching: data,
      pricing_options: [option, native],
    };
    const html = await renderComponent(InferencePrices, {
      modelRef: "fixture/model",
      prices: [price],
      offers: [],
    });
    expect(html).toMatch(/<output\b[^>]*>Standard<\/output>/);
    const priceScope = html.match(
      /<section\b[^>]*aria-label="Price scope"[\s\S]*?<\/section>/u,
    )?.[0];
    expect(priceScope).toContain(">Standard</output>");
    expect(priceScope).not.toContain("<select");
    const conditions = html.match(/<fieldset\b[\s\S]*?<\/fieldset>/gu) ?? [];
    expect(conditions.some((section) => section.includes("Region"))).toBe(true);
    for (const section of conditions) expect(section).not.toContain(">Standard<");
    expect(html).toContain("Remaining conditions: Region.");
    for (const select of html.match(/<select\b[\s\S]*?<\/select>/gu) ?? [])
      expect(select).not.toContain(">Standard<");

    // A fully mapped native singleton must stay visible instead of being consumed twice.
    const variants = term.variants;
    term.variants = [{ applicability: qualified, semantics: 0 }];
    const fullyMapped = await renderComponent(InferencePrices, {
      modelRef: "fixture/model",
      prices: [price],
      offers: [],
    });
    expect(fullyMapped).toMatch(/<output\b[^>]*>Standard<\/output>/);
    term.variants = variants;

    // Multiple native values remain a real choice even when only one has a canonical mapping.
    if (native.kind !== "categorical") throw new Error("Missing categorical selector");
    native.values.push({ key: "fast", label: "Fast", value: { ...standard, value: "fast" } });
    const selectable = await renderComponent(InferencePrices, {
      modelRef: "fixture/model",
      prices: [price],
      offers: [],
    });
    expect(selectable).not.toMatch(/<output\b[^>]*>Standard<\/output>/);
  },
);

it("fixes mandatory singletons before selection without letting a scoped choice lock itself", () => {
  const data = fixture();
  const offer = data.offers[0];
  const term = offer?.terms[0];
  if (!offer || !term) throw new Error("Missing fixture offer");
  const speed: CommercialChoice = {
    dimension: "speed",
    value: { namespace: "kmodels", value: "standard" },
  };
  const scope: PriceApplicability = {
    any_of: [
      {
        all_of: [
          {
            kind: "categorical",
            dimension: { namespace: "kmodels", value: "speed" },
            values: [{ namespace: "provider", provider_id: "fixture", value: "default" }],
          },
        ],
      },
    ],
  };
  offer.selection = [
    {
      dimension: speed.dimension,
      coverage: "complete",
      applicability: unconditionalApplicability,
      alternatives: [{ value: speed.value, applicability: scope }],
    },
  ];
  term.variants = [{ applicability: scope, semantics: 0 }];
  term.raw_variants = [];
  const fixed = (choices: CommercialChoice[]) => {
    const current = matchInferencePrices(data, [], at, undefined, undefined, choices);
    return fixedInferenceCommercialChoices(data, current, current.available_choices, at, choices);
  };
  expect(fixed([])).toMatchObject([speed]);

  term.variants.push({ applicability: unconditionalApplicability, semantics: 1 });
  expect(fixed([])).toEqual([]);
  expect(fixed([speed])).toEqual([]);

  // An ID-fixed native predicate remains a valid reason to resolve the singleton automatically.
  const rule = data.rules[0];
  if (!rule) throw new Error("Missing fixture rule");
  rule.fixed_selectors = [
    {
      kind: "categorical",
      dimension: { namespace: "kmodels", value: "speed" },
      value: { namespace: "provider", provider_id: "fixture", value: "default" },
    },
  ];
  expect(fixed([])).toMatchObject([speed]);
});
