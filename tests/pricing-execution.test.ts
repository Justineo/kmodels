import { expect, it } from "vite-plus/test";
import {
  batchInferenceAssociations,
  splitBatchModelOffers,
} from "../src/catalog/batch-model-offers.ts";
import { commercialSelection } from "../src/catalog/commercial-selection.ts";
import type { AtomicProviderPricing, AtomicRateVariant } from "../src/catalog/pricing-assembly.ts";
import { assembleProviderPricing } from "../src/catalog/pricing-assembly.ts";
import type { PriceApplicability } from "../src/catalog/pricing-schema.ts";
import type { ProviderModel } from "../src/catalog/schema.ts";

const model: Pick<ProviderModel, "uid" | "tasks" | "api_endpoints" | "delivery_mode_evidence"> = {
  uid: "test/model",
  tasks: ["text_generation"],
};

it("requires adapter-owned commercial evidence and supports several mechanisms on one offer", () => {
  const book = assembleProviderPricing(input()).books[0];
  const offer = book?.offers[0];
  if (!book || !offer) throw new Error("Missing fixture");
  expect(
    commercialSelection(offer, book.scope).find(({ dimension }) => dimension === "execution"),
  ).toMatchObject({ coverage: "partial", alternatives: [] });
  const selection = commercialSelection(offer, book.scope, {
    offers: { usage: ["request", "realtime"] },
    values: {},
  });
  expect(
    selection
      .find(({ dimension }) => dimension === "execution")
      ?.alternatives.map(({ value }) => value.value),
  ).toEqual(["request", "realtime"]);
  expect(offer.offer_key).toBe("usage");
  expect(
    commercialSelection(offer, book.scope, {
      offers: { usage: { request: ["responses."], realtime: ["realtime."] } },
      values: {},
    }).find(({ dimension }) => dimension === "execution"),
  ).toMatchObject({ coverage: "partial", alternatives: [] });
});

function scope(operation: string): PriceApplicability {
  return {
    any_of: [
      {
        all_of: [
          {
            kind: "categorical",
            dimension: { namespace: "kmodels", value: "operation" },
            values: [{ namespace: "provider", provider_id: "vercel", value: operation }],
          },
          {
            kind: "categorical",
            dimension: { namespace: "kmodels", value: "region" },
            values: [{ namespace: "provider", provider_id: "vercel", value: "us" }],
          },
        ],
      },
    ],
  };
}
function rate(operation: string): AtomicRateVariant {
  const applicability = scope(operation);
  return {
    applicability,
    validity: { from: { value: "2026-01-01T00:00:00Z", precision: "datetime" } },
    price: {
      value: { numerator: "1", denominator: "1000000" },
      denomination: { kind: "fiat", currency: "USD" },
      per: { factors: [{ unit: { namespace: "kmodels", value: "token" }, power: 1 }] },
    },
    observation: {
      source_ref: "catalog",
      locator: { kind: "table", value: operation },
      raw: { amount: "1", fragment: operation },
      establishes_applicability: applicability,
    },
    charge_binding: {
      signal: { namespace: "kmodels", value: "input_tokens" },
      aggregation: "request",
      observations: [],
    },
  };
}
function input(): AtomicProviderPricing {
  return {
    provider_id: "vercel",
    observed_at: "2026-01-01T00:00:00Z",
    vocabulary: { provider_id: "vercel", atoms: [] },
    dispositions: [],
    books: [
      {
        book_key: "model",
        scope: { kind: "models", model_refs: [model.uid] },
        scope_observations: [],
        source_refs: ["catalog"],
        offers: [
          {
            offer_key: "usage",
            billing_mode: { namespace: "kmodels", value: "usage" },
            states: [],
            relations: [],
            source_refs: ["catalog"],
            terms: [
              {
                kind: "rate",
                term_key: "input",
                meter: { namespace: "kmodels", value: "input_text" },
                source_refs: ["catalog"],
                variants: [rate("sync"), rate("batch"), rate("web_search")],
                raw_variants: [],
              },
            ],
          },
        ],
      },
    ],
  };
}

it("promotes only mechanism predicates, preserving rates, regions, validity and unrelated operations", () => {
  const original = input();
  const result = splitBatchModelOffers(original, "sync");
  const offers = result.books[0]?.offers;
  expect(offers?.map(({ offer_key }) => offer_key)).toEqual(["usage", "batch"]);
  const request = offers?.[0]?.terms[0];
  const batch = offers?.[1]?.terms[0];
  if (request?.kind !== "rate" || batch?.kind !== "rate") throw new Error("Missing split rates");
  expect(request.variants).toHaveLength(2);
  expect(request.variants[1]?.applicability).toEqual(scope("web_search"));
  const variant = batch.variants[0];
  expect(variant).toBeDefined();
  expect(variant?.price).toEqual(rate("batch").price);
  expect(variant?.validity).toEqual(rate("batch").validity);
  expect(variant?.observation.raw).toEqual(rate("batch").observation.raw);
  expect(variant?.applicability.any_of[0]?.all_of.map(({ dimension }) => dimension.value)).toEqual([
    "region",
  ]);
  expect(variant?.observation.establishes_applicability).toEqual(variant?.applicability);
  expect(variant?.charge_binding?.aggregation).toBe("result_item");
  expect(request.variants[0]?.charge_binding?.aggregation).toBe("request");
  expect(original).toEqual(input());
  expect(splitBatchModelOffers(result, "sync")).toEqual(result);
});

it("keeps raw Batch evidence scoped and rejects unreviewed commercial relationships", () => {
  const original = input();
  const offer = original.books[0]?.offers[0];
  const term = offer?.terms[0];
  if (!offer || term?.kind !== "rate") throw new Error("Missing input");
  term.variants = [rate("sync")];
  term.raw_variants = [
    {
      impact: "base_price",
      reason: "unsupported_structure",
      possible_scope: scope("batch"),
      observation: {
        source_ref: "catalog",
        locator: { kind: "table", value: "Batch" },
        raw: { fragment: "Unresolved Batch price" },
      },
    },
  ];
  const batch = splitBatchModelOffers(original, "sync").books[0]?.offers[1]?.terms[0];
  expect(batch?.kind).toBe("rate");
  if (batch?.kind !== "rate") throw new Error("Missing raw Batch rate");
  expect(batch.variants).toEqual([]);
  expect(
    batch.raw_variants[0]?.possible_scope?.any_of[0]?.all_of.map(
      ({ dimension }) => dimension.value,
    ),
  ).toEqual(["region"]);
  offer.terms.push({
    kind: "allowance",
    term_key: "unreviewed",
    variants: [],
    raw_variants: [],
    source_refs: [],
  });
  expect(() => splitBatchModelOffers(original, "sync")).toThrow(/unreviewed allowance/);
});

it("moves an ID-fixed Batch mechanism to its offer without weakening independent fixed conditions", () => {
  const fixed_selectors = ["operation", "region"].map((value) => ({
    kind: "categorical" as const,
    dimension: {
      namespace: "kmodels" as const,
      value: value === "operation" ? ("operation" as const) : ("region" as const),
    },
    value: {
      namespace: "provider" as const,
      provider_id: "vercel",
      value: value === "operation" ? "batch" : "us",
    },
  }));
  const fact = {
    source_ref: "catalog",
    model_id: "literal-batch-id",
    model_ref: model.uid,
    offer_key: "usage",
    fixed_selectors,
    evidence: [{ source_ref: "catalog", locator: { kind: "table" as const, value: "Batch" } }],
  };
  expect(batchInferenceAssociations("vercel", fact)).toEqual([
    { ...fact, offer_key: "batch", fixed_selectors: [fixed_selectors[1]] },
  ]);
  expect(batchInferenceAssociations("unknown", fact)).toEqual([fact]);
});
