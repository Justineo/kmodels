import { describe, expect, it } from "vite-plus/test";
import { baseModel } from "../src/catalog/model.ts";
import { manifests, type ProviderManifest } from "../src/catalog/manifests.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";
import { publishedRate } from "../src/catalog/pricing.ts";
import {
  evaluateApplicability,
  type PricingSelection,
} from "../src/catalog/pricing-applicability.ts";
import type { SourcePriceFact } from "../src/catalog/pricing-source.ts";
import { validatePricingCatalog } from "../src/catalog/pricing-validation.ts";

const observedAt = "2026-07-21T00:00:00.000Z";
const rate = (
  price: string,
  conditions: SourcePriceFact["conditions"] = {},
  unit: SourcePriceFact["unit"] = "million_tokens",
): SourcePriceFact =>
  publishedRate("input_text", price, unit, "replaced", unit, {
    service_tier: "standard",
    ...conditions,
  });

function assemble(cards: SourcePriceFact[], prices: SourcePriceFact[]) {
  const manifest: ProviderManifest | undefined = manifests.find(
    ({ provider }) => provider.id === "openai",
  );
  const overview = manifest?.sources.find(({ id }) => id === "openai-overview");
  const pricing = manifest?.sources.find(({ id }) => id === "openai-pricing");
  if (manifest === undefined || overview === undefined || pricing === undefined)
    throw new Error("Missing OpenAI sources");
  const model = baseModel({
    providerId: "openai",
    id: "gpt-test",
    name: "Test",
    sourceId: overview.id,
    observedAt,
  });
  const partition = assembleParsedProviderPricing(
    "openai",
    observedAt,
    [
      {
        source: overview,
        models: [
          { ...model, price_facts: cards.map((fact) => ({ ...fact, source_ref: overview.id })) },
        ],
      },
      {
        source: pricing,
        models: [
          {
            ...model,
            price_facts: prices.map((fact) => ({ ...fact, source_ref: pricing.id })),
          },
        ],
      },
    ],
    [model],
  );
  const offer = partition?.books[0]?.offers.find(({ offer_key }) => offer_key === "sync");
  if (partition === undefined) throw new Error("Missing pricing partition");
  validatePricingCatalog(
    {
      provider_vocabularies: [partition.vocabulary],
      provider_snapshots: [partition.snapshot],
      books: partition.books,
      model_dispositions: partition.model_dispositions,
    },
    {
      providers: [{ ...manifest.provider, source_ids: [overview.id, pricing.id] }],
      models: [model],
      sources: [overview, pricing].map((source) => ({
        id: source.id,
        provider_id: "openai",
        url: source.url,
        source: source.source ?? [source.type],
        stability: source.stability,
        scope: "global",
        exhaustive: false,
        role: source.role ?? "catalog",
        field_paths: source.fields,
        observed_at: observedAt,
        content_hash: "1".repeat(64),
        extractor_version: source.extractorVersion,
        ...(source.pricingEvidence === undefined
          ? {}
          : { pricing_evidence: source.pricingEvidence }),
      })),
    },
  );
  const term = offer?.terms.find((term) => term.kind === "rate");
  if (term?.kind !== "rate") throw new Error("Missing input term");
  return { term, offer };
}

const tier: PricingSelection = {
  dimension: { namespace: "kmodels", value: "served_service_tier" },
  kind: "categorical",
  value: { namespace: "provider", provider_id: "openai", value: "standard" },
};
function atTokens(tokens: string): PricingSelection[] {
  return [
    tier,
    {
      dimension: { namespace: "kmodels", value: "context_tokens" },
      kind: "decimal",
      value: tokens,
      unit: { factors: [{ unit: { namespace: "kmodels", value: "token" }, power: 1 }] },
    },
  ];
}

describe("OpenAI scoped pricing authority", () => {
  it.each(["resolution", "region", "quality"] as const)(
    "preserves a disjoint %s fallback",
    (dimension) => {
      const { term } = assemble(
        [rate("1", { [dimension]: "first" }), rate("3", { [dimension]: "second" })],
        [rate("2", { [dimension]: "first" })],
      );
      expect(term.variants).toHaveLength(2);
      expect(
        term.variants.flatMap(({ observations }) => observations.map(({ raw }) => raw.amount)),
      ).toEqual(expect.arrayContaining(["2", "3"]));
    },
  );

  it("keeps independently denominated fallback prices", () => {
    const euro = { ...rate("3", { billing_currency: "EUR" }), currency: "EUR" };
    const { term } = assemble(
      [rate("1", { billing_currency: "USD" }), euro],
      [rate("2", { billing_currency: "USD" })],
    );
    expect(term.variants.map(({ price }) => price.denomination)).toEqual(
      expect.arrayContaining([
        { kind: "fiat", currency: "USD" },
        { kind: "fiat", currency: "EUR" },
      ]),
    );
  });

  it("preserves a different billing unit as independent source evidence", () => {
    const { term } = assemble([rate("1"), rate("3", {}, "image")], [rate("2")]);
    expect(
      term.raw_variants
        .filter(({ reason }) => reason === "superseded_value")
        .flatMap(({ observations }) => observations.map(({ raw }) => raw.unit)),
    ).not.toContain("image");
    expect(
      [
        ...term.variants.flatMap(({ observations }) => observations),
        ...term.raw_variants.flatMap(({ observations }) => observations),
      ].some(({ raw }) => raw.unit === "image"),
    ).toBe(true);
  });

  it("retains the exact integer-context remainder of a partial override", () => {
    const { term } = assemble([rate("1")], [rate("2", { context_max_tokens: 272000 })]);
    for (const [tokens, amount] of [
      ["272000", "2"],
      ["272001", "1"],
      ["1000000", "1"],
    ] as const) {
      const matches = term.variants.filter(
        ({ applicability }) =>
          evaluateApplicability(applicability, atTokens(tokens)).state === "true",
      );
      expect(matches).toHaveLength(1);
      expect(matches[0]?.observations.some(({ raw }) => raw.amount === amount)).toBe(true);
    }
  });

  it("coalesces equal prices with both observations", () => {
    const { term } = assemble([rate("2")], [rate("2")]);
    expect(term.variants).toHaveLength(1);
    expect(term.variants[0]?.observations.map(({ source_ref }) => source_ref).sort()).toEqual([
      "openai-overview",
      "openai-pricing",
    ]);
  });

  it("keeps the boolean remainder of an override", () => {
    const { term } = assemble([rate("1")], [rate("2", { eu_data_residency: false })]);
    expect(term.variants).toHaveLength(2);
    const fallback = term.variants.find(({ observations }) =>
      observations.some(({ raw }) => raw.amount === "1"),
    );
    expect(fallback?.applicability.any_of[0]?.all_of).toContainEqual(
      expect.objectContaining({
        kind: "boolean",
        value: true,
      }),
    );
  });

  it.each([false, true])(
    "removes a fully covered fallback independent of page order (%s)",
    (reverse) => {
      const prices = [
        rate("2", { context_max_tokens: 272000 }),
        rate("3", { context_min_tokens: 272001 }),
      ];
      const { term } = assemble([rate("1")], reverse ? prices.reverse() : prices);
      expect(term.variants).toHaveLength(2);
      expect(
        term.variants.every(({ observations }) =>
          observations.every(({ source_ref }) => source_ref === "openai-pricing"),
        ),
      ).toBe(true);
    },
  );

  it("does not replace different published validity with an inferred time boundary", () => {
    const { term } = assemble(
      [rate("1", { effective_from: "2026-01-01" })],
      [rate("2", { effective_from: "2026-02-01" })],
    );
    expect(term.raw_variants.filter(({ reason }) => reason === "superseded_value")).toEqual([]);
    expect(
      term.raw_variants.flatMap(({ observations }) =>
        observations.map(({ source_ref }) => source_ref),
      ),
    ).toEqual(expect.arrayContaining(["openai-overview", "openai-pricing"]));
  });

  it("does not restore a card tariff when the same page has conflicting values", () => {
    const { term } = assemble([rate("1")], [rate("2"), rate("3")]);
    expect(term.variants).toEqual([]);
    expect(
      term.raw_variants
        .filter(({ reason }) => reason === "conflicting_values")
        .flatMap(({ observations }) => observations.map(({ raw }) => raw.amount))
        .sort((left, right) => String(left).localeCompare(String(right))),
    ).toEqual(["2", "3"]);
  });

  it("retains an unrepresentable categorical remainder as bounded raw pricing", () => {
    const { term } = assemble([rate("1")], [rate("2", { region: "United States" })]);
    expect(term.variants).toHaveLength(1);
    expect(term.raw_variants).toContainEqual(
      expect.objectContaining({
        impact: "base_price",
        reason: "unknown_applicability",
        observations: expect.arrayContaining([
          expect.objectContaining({
            source_ref: "openai-overview",
            raw: expect.objectContaining({ amount: "1" }),
          }),
        ]),
      }),
    );
    expect(
      term.raw_variants.find(({ reason }) => reason === "unknown_applicability")?.observations[0]
        ?.raw,
    ).not.toHaveProperty("fragment");
  });
});
