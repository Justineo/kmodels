import { expect, it } from "vite-plus/test";
import {
  storeInferencePrices,
  restoreInferencePrices,
} from "../src/catalog/website-inference-storage.ts";
import { websiteInferencePriceSchema } from "../src/catalog/website-schema.ts";
import { queryWebsiteInferencePrice } from "../src/catalog/inference-price-presentation.ts";

const at = "2026-11-02T00:00:00.000Z";
function price(id: string, region: string) {
  return websiteInferencePriceSchema.parse({
    model_id: id,
    status: "candidates",
    explanation: "Select a region",
    missing_conditions: ["Region"],
    evidence_urls: [],
    candidates: [],
    pricing_options: [
      {
        kind: "boolean",
        key: "flag",
        label: "Flag",
        dimension: { namespace: "provider", provider_id: "test", value: "flag" },
      },
    ],
    matching: {
      generated_at: at,
      observed_at: at,
      rules: [
        {
          model_ref: "test/model",
          offer_refs: ["a".repeat(64)],
          fixed_selectors: [
            {
              kind: "categorical",
              dimension: { namespace: "kmodels", value: "region" },
              value: { namespace: "provider", provider_id: "test", value: region },
            },
          ],
        },
      ],
      offers: [
        {
          id: "a".repeat(64),
          states: [{ state: "numeric", semantics: 0, applicability: { any_of: [{ all_of: [] }] } }],
          relations: [],
          terms: [
            {
              id: "b".repeat(64),
              kind: "rate",
              variants: Array.from({ length: 500 }, (_, index) => ({
                semantics: index,
                applicability: {
                  any_of: [
                    {
                      all_of: [
                        {
                          kind: "categorical",
                          dimension: { namespace: "kmodels", value: "region" },
                          values: [
                            {
                              namespace: "provider",
                              provider_id: "test",
                              value: `region-${index}`,
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              })),
              raw_variants: [],
            },
          ],
        },
      ],
      referenced_rates: [],
    },
  });
}

it("stores shared ID tariffs once and restores each ID's own fixed selectors", () => {
  const prices = Array.from({ length: 40 }, (_, index) =>
    price(`model-${index}`, `region-${index}`),
  );
  const stored = storeInferencePrices(prices);
  expect(Buffer.byteLength(JSON.stringify(prices))).toBeGreaterThan(2 * 1024 * 1024);
  expect(Buffer.byteLength(JSON.stringify(stored))).toBeLessThan(128 * 1024);
  expect(stored[1]?.matching_ref).toBe(0);
  expect(stored[1]?.pricing_options_ref).toBe(0);
  expect(stored.every((value) => value.matching?.referenced_rates === undefined)).toBe(true);
  const restored = restoreInferencePrices(stored);
  expect(restored).toEqual(prices);
  for (const [index, value] of restored.entries()) {
    const original = prices[index];
    if (original === undefined) throw new Error("Missing original price");
    expect(queryWebsiteInferencePrice(value, [], at)).toEqual(
      queryWebsiteInferencePrice(original, [], at),
    );
  }
});

it("preserves condition kinds, validity, raw scopes and contribution references", () => {
  const original = price("qualified", "region-0");
  const matching = original.matching;
  const offer = matching?.offers[0];
  const term = offer?.terms[0];
  if (!matching || !offer || !term) throw new Error("Missing fixture matcher");
  const validity = { from: { value: "2026-11-01", precision: "date" as const, inclusive: false } };
  const applicability = {
    any_of: [
      {
        all_of: [
          {
            kind: "categorical" as const,
            dimension: { namespace: "kmodels" as const, value: "region" as const },
            values: [
              { namespace: "kmodels" as const, value: "global" },
              { namespace: "provider" as const, provider_id: "test", value: "region-0" },
            ],
          },
          {
            kind: "boolean" as const,
            dimension: { namespace: "provider" as const, provider_id: "test", value: "flag" },
            value: true,
          },
          {
            kind: "decimal_range" as const,
            dimension: { namespace: "kmodels" as const, value: "context_tokens" as const },
            unit: {
              factors: [
                { unit: { namespace: "kmodels" as const, value: "token" as const }, power: 1 },
              ],
            },
            lower: { value: "100001", inclusive: true },
            upper: { value: "200000", inclusive: false },
          },
        ],
      },
    ],
  };
  term.variants = [{ semantics: 7, applicability, validity, target_rate_refs: ["target"] }];
  term.raw_variants = [
    { impact: "base_price", reason: "unknown_amount", possible_scope: applicability, validity },
    { impact: "informational", reason: "unsupported_structure" },
  ];
  offer.states = [{ state: "numeric", semantics: 7, applicability, validity }];
  offer.relations = [{ semantics: 8, applicability, target_rate_refs: [] }];
  matching.referenced_rates = [{ ...term, id: "target", raw_variants: [] }];
  const checked = websiteInferencePriceSchema.parse(original);
  expect(restoreInferencePrices(storeInferencePrices([checked]))).toEqual([checked]);
});

it.each(["applicability", "condition", "options"])(
  "rejects a broken %s dictionary reference",
  (kind) => {
    const stored = storeInferencePrices([price("first", "region-0"), price("second", "region-1")]);
    const first = stored[0];
    const second = stored[1];
    if (!first || !second) throw new Error("Missing stored fixture");
    if (kind === "applicability") {
      const state = first.matching?.offers[0]?.states[0];
      if (!state) throw new Error("Missing stored state");
      state[2] = 9999;
    }
    if (kind === "condition") {
      const values = first.matching_applicabilities;
      if (!values) throw new Error("Missing applicability dictionary");
      values[0] = [[9999]];
    }
    if (kind === "options") second.pricing_options_ref = 1;
    expect(() => restoreInferencePrices(stored)).toThrow("reference is invalid");
  },
);

it.each(["forward", "missing", "chain", "clock", "duplicate"])(
  "rejects an invalid shared matching reference (%s)",
  (kind) => {
    const stored = storeInferencePrices([
      price("first", "region-0"),
      price("second", "region-1"),
      price("third", "region-2"),
    ]);
    const second = stored[1];
    if (second?.matching === undefined) throw new Error("Missing stored price");
    if (kind === "forward") second.matching_ref = 2;
    if (kind === "missing") second.matching_ref = 99;
    if (kind === "chain") {
      const third = stored[2];
      if (third === undefined) throw new Error("Missing stored price");
      third.matching_ref = 1;
    }
    if (kind === "clock") second.matching.observed_at = "2026-11-01T00:00:00.000Z";
    if (kind === "duplicate") second.matching.offers = stored[0]?.matching?.offers ?? [];
    expect(() => restoreInferencePrices(stored)).toThrow("matching reference is invalid");
  },
);
