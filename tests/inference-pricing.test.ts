import { readFile } from "node:fs/promises";
import { load } from "cheerio";
import { beforeAll, expect, it } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";
import {
  assembleProviderPricing,
  type AtomicRateVariant,
} from "../src/catalog/pricing-assembly.ts";
import { publishedModel } from "../src/catalog/pricing-source.ts";
import { manifests, type SourceManifest } from "../src/catalog/manifests.ts";
import { sha256 } from "../src/catalog/io.ts";
import { priceDataExport } from "../src/catalog/pricing-lookup-export.ts";
import { createPricingCatalogEnvelope } from "../src/catalog/pricing-envelope.ts";
import { catalogSchema, type Catalog } from "../src/catalog/schema.ts";
import { createInferencePriceLookup } from "../src/pricing/inference.ts";
import { createCommercialPriceLookup } from "../src/pricing/commercial.ts";
import { validatePriceData } from "../src/pricing/validation.ts";
import type { InferencePriceMapping, InferencePriceRule } from "../src/pricing/inference-schema.ts";
import type { PriceDataEnvelope, Selector } from "../src/pricing/schema.ts";
import { prepareCatalogPair } from "../src/catalog/pricing-publication.ts";
import {
  websiteInferencePrices,
  websiteInferencePrice,
} from "../src/catalog/website-inference-pricing.ts";
import { websiteModelDetail, websitePublication } from "../src/catalog/website-data.ts";
import {
  restoreInferencePrices,
  storeInferencePrices,
} from "../src/catalog/website-inference-storage.ts";
import { projectCatalogPair } from "../src/catalog/projections.ts";
import type { PricingCatalogEnvelope, PriceCondition } from "../src/catalog/pricing-schema.ts";
import { renderComponent } from "./render-component.ts";
import InferencePrices from "../src/components/InferencePrices.vue";
import { lookupFixtureSchema } from "./pricing-lookup-fixture.ts";
import {
  inferencePriceExplanation,
  queryWebsiteInferencePrice,
} from "../src/catalog/inference-price-presentation.ts";
import { inferenceMatchData } from "../src/pricing/inference-matching-data.ts";
import { createPricingSnapshot } from "../src/pricing/snapshot.ts";
import { formatDimension } from "../src/catalog/pricing-presentation.ts";
import { pricingSelection } from "../src/catalog/pricing-selector-input.ts";
import {
  compatibleInferenceIds,
  inferenceIdConditionDomains,
  linkedConditionValues,
} from "../src/catalog/inference-price-options.ts";
import { multiplyRationals } from "../src/catalog/pricing-rational.ts";
import { canonicalJson, compareUtf8Sequences } from "../src/catalog/canonical-value.ts";
import { inferencePricingPublication } from "../src/catalog/inference-pricing.ts";
const at = "2026-10-30T00:00:00.000Z";
const fixture = (name: string) => readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const fixturePairs = new Map<
  string,
  {
    catalog: Catalog;
    envelope: PricingCatalogEnvelope;
  }
>();
async function prices(providerId: string, body: string): Promise<PriceDataEnvelope> {
  const manifest = manifests.find(({ provider }) => provider.id === providerId);
  const source: SourceManifest | undefined = manifest?.sources[0];
  if (!manifest || !source) throw new Error("Missing provider fixture manifest");
  const provider = { ...manifest.provider, source_ids: [source.id] };
  const parsed = parseSource({ provider, source, body, observedAt: at });
  const partition = assembleParsedProviderPricing(
    providerId,
    at,
    [{ source, ...parsed }],
    parsed.models,
  );
  if (!partition) throw new Error("Missing fixture price partition");
  const catalog: Catalog = {
    catalog_version: sha256(providerId),
    generated_at: at,
    providers: [provider],
    models: parsed.models.map(publishedModel),
    sources: [
      {
        id: source.id,
        provider_id: providerId,
        url: source.url,
        source: source.source ?? [source.type],
        stability: source.stability,
        scope: "global",
        exhaustive: false,
        role: "catalog",
        field_paths: source.fields,
        observed_at: at,
        content_hash: sha256(body),
        extractor_version: source.extractorVersion,
        ...(source.pricingEvidence === undefined
          ? {}
          : { pricing_evidence: source.pricingEvidence }),
      },
    ],
    coverage: [
      {
        provider_id: providerId,
        status: "fresh",
        model_count: parsed.models.length,
        pricing_term_count: partition.books.reduce(
          (count, book) =>
            count + book.offers.reduce((count, offer) => count + offer.terms.length, 0),
          0,
        ),
        checked_at: at,
      },
    ],
    warnings: [],
  };
  const envelope = createPricingCatalogEnvelope(
    {
      provider_vocabularies: [partition.vocabulary],
      provider_snapshots: [partition.snapshot],
      model_dispositions: partition.model_dispositions,
      books: partition.books,
    },
    catalogSchema.parse(JSON.parse(JSON.stringify(catalog))),
  );
  fixturePairs.set(providerId, { catalog, envelope });
  return priceDataExport(catalog, envelope);
}
let typesafe: PriceDataEnvelope;
let bedrock: PriceDataEnvelope;
beforeAll(async () => {
  typesafe = await prices(
    "typesafe",
    JSON.stringify({
      index: {
        url: "https://docs.typesafe.ai/models.md",
        body: await fixture("typesafe/models.md"),
      },
      documents: [
        { url: "https://docs.typesafe.ai/llms.txt", body: await fixture("typesafe/llms.txt") },
        { url: "https://docs.typesafe.ai/api.md", body: await fixture("typesafe/api.md") },
      ],
    }),
  );
  bedrock = await prices(
    "amazon-bedrock",
    JSON.stringify({
      index: {
        url: "https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards.md",
        body: "# Model cards",
      },
      documents: [
        {
          url: "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-astra.md",
          body: await fixture("bedrock/model-card-gpt6-context.md"),
        },
        {
          url: "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrockFoundationModels/current/index.json",
          body: await fixture("bedrock/context-price-list.json"),
        },
      ],
    }),
  );
});
function rule(
  data: PriceDataEnvelope,
  modelId: string,
  modelRef: string,
  fixed: Selector[] = [],
): InferencePriceRule {
  const provider = data.providers[0];
  const book = provider?.books.find(({ scope }) => scope.model_refs.includes(modelRef));
  const offer = book?.offers.find(({ offer_key }) =>
    ["systemone", "on-demand"].includes(offer_key),
  );
  const source = provider?.sources[0];
  if (!provider || !book || !offer || !source)
    throw new Error(`Missing fixture price for ${modelRef}`);
  return {
    provider_id: provider.snapshot.provider_id,
    model_id: modelId,
    model_ref: modelRef,
    offer_refs: [offer.id],
    fixed_selectors: fixed,
    evidence: [{ source_ref: source.id, locator: { kind: "fragment", value: modelId } }],
  };
}
function mapping(data: PriceDataEnvelope, rules: InferencePriceRule[]): InferencePriceMapping {
  return {
    core_catalog_version: data.snapshot.coreCatalogVersion,
    pricing_data_version: data.snapshot.pricingDataVersion,
    sources: [],
    rules,
  };
}
function typesafeRule(modelId = "jev-1.13.0") {
  return rule(typesafe, modelId, "typesafe/jev-1.13.0");
}
function conflictingPrices() {
  const pair = fixturePairs.get("typesafe");
  const book = pair?.envelope.data.books[0];
  const offer = book?.offers.find(({ offer_key }) => offer_key === "systemone");
  const rate = offer?.terms.find((term) => term.kind === "rate");
  const variant = rate?.variants[0];
  const observation = variant?.observations[0];
  const vocabulary = pair?.envelope.data.provider_vocabularies[0];
  if (!pair || !book || !offer || !rate || !variant || !observation || !vocabulary)
    throw new Error("Missing canonical price fixture");
  const partition = assembleProviderPricing({
    provider_id: vocabulary.provider_id,
    observed_at: at,
    vocabulary,
    dispositions: [],
    books: [
      {
        book_key: book.book_key,
        scope: book.scope,
        scope_observations: book.scope_observations,
        source_refs: book.source_refs,
        offers: [
          {
            offer_key: offer.offer_key,
            billing_mode: offer.billing_mode,
            source_refs: offer.source_refs,
            relations: [],
            states: [],
            terms: [
              {
                kind: "rate",
                term_key: rate.term_key,
                meter: rate.meter,
                source_refs: rate.source_refs,
                raw_variants: [],
                variants: ["1", "2"].map((numerator): AtomicRateVariant => ({
                  applicability: variant.applicability,
                  price: {
                    ...variant.price,
                    value: multiplyRationals(variant.price.value, { numerator, denominator: "1" }),
                  },
                  observation: {
                    ...observation,
                    locator: { kind: "table", value: `quote-${numerator}` },
                  },
                })),
              },
            ],
          },
        ],
      },
    ],
  });
  const accepted = prepareCatalogPair(pair.catalog, {
    provider_vocabularies: [partition.vocabulary],
    provider_snapshots: [partition.snapshot],
    model_dispositions: [],
    books: partition.books,
  });
  const data = priceDataExport(accepted.catalog, accepted.pricing);
  const term = data.providers[0]?.books[0]?.offers[0]?.terms.find((term) => term.kind === "rate");
  if (!term) throw new Error("Missing assembled conflict");
  expect(term.variants).toEqual([]);
  expect(term.raw_variants.map(({ reason }) => reason)).toEqual(["conflicting_values"]);
  expect(term.raw_variants[0]?.evidence.map(({ locator }) => locator.value)).toEqual([
    "quote-1",
    "quote-2",
  ]);
  return { data, rate: term, accepted };
}
function profileRule(scope: "us" | "global") {
  const selectors: Selector[] = [
    {
      kind: "categorical",
      dimension: { namespace: "kmodels", value: "deployment_scope" },
      value: {
        namespace: "provider",
        provider_id: "amazon-bedrock",
        value: scope === "us" ? "geo_cross_region" : "global_cross_region",
      },
    },
  ];
  if (scope === "us")
    selectors.push({
      kind: "categorical",
      dimension: { namespace: "kmodels", value: "inference_geo" },
      value: { namespace: "provider", provider_id: "amazon-bedrock", value: "us" },
    });
  return rule(
    bedrock,
    `${scope}.openai.gpt-6-astra`,
    "amazon-bedrock/openai.gpt-6-astra",
    selectors,
  );
}
it("finds actual TypeSafe ID and reviewed aliases without any invocation graph", () => {
  const lookup = createInferencePriceLookup(
    typesafe,
    mapping(typesafe, [typesafeRule(), typesafeRule("jev-latest"), typesafeRule("jev-preview")]),
  );
  for (const model_id of ["jev-1.13.0", "jev-latest", "jev-preview"]) {
    const result = lookup({ provider_id: "typesafe", model_id });
    expect(result.status).toBe("matched");
    expect(result.missing_conditions).toEqual([]);
    const rates = result.candidates.flatMap(({ offer }) =>
      offer.terms.flatMap((term) => (term.kind === "rate" ? term.variants : [])),
    );
    expect(rates.map(({ price }) => price.value)).toContainEqual({
      numerator: "21",
      denominator: "500000000",
    });
    expect(rates.map(({ price }) => price.value)).toContainEqual({
      numerator: "0",
      denominator: "1",
    });
  }
});

it.each([
  { name: "alpha", values: 1, numeric: false, step: 17, amount: 7 },
  { name: "beta", values: 3, numeric: false, step: 941, amount: 13 },
  { name: "gamma", values: 2, numeric: true, step: 37, amount: 19 },
  { name: "delta", values: 1, numeric: true, step: 941, amount: 23 },
])(
  "carries new provider vocabulary through canonical validation, public lookup and UI: $name",
  async ({ name, values, numeric, step, amount }) => {
    const original = fixturePairs.get("typesafe");
    if (!original) throw new Error("Missing canonical fixture");
    const catalog = catalogSchema.parse(JSON.parse(JSON.stringify(original.catalog)));
    const canonical = structuredClone(original.envelope.data);
    const book = canonical.books.find(({ scope }) =>
      scope.model_refs.includes("typesafe/jev-1.13.0"),
    );
    const offer = book?.offers[0];
    const term = offer?.terms.find((entry) => entry.kind === "rate");
    const vocabulary = canonical.provider_vocabularies.find(
      ({ provider_id }) => provider_id === "typesafe",
    );
    const first = term?.kind === "rate" ? term.variants[0] : undefined;
    if (!book || !offer || term?.kind !== "rate" || !vocabulary || !first)
      throw new Error("Missing price fixture");
    const dimension = {
      namespace: "provider",
      provider_id: "typesafe",
      value: `new_dimension_${name}`,
    } as const;
    const meter = {
      namespace: "provider",
      provider_id: "typesafe",
      value: `new_charge_${name}`,
    } as const;
    const unit = {
      factors: [
        {
          unit: {
            namespace: "provider" as const,
            provider_id: "typesafe",
            value: `new_unit_${name}`,
          },
          power: 1,
        },
      ],
    };
    vocabulary.atoms.push(
      {
        kind: "dimension",
        key: dimension.value,
        definition: "Synthetic provider price selector",
        resolution_phase: "request",
      },
      { kind: "meter", key: meter.value, definition: "Synthetic independently defined charge" },
      { kind: "unit", key: `new_unit_${name}`, definition: "Synthetic provider billing unit" },
    );
    const cases = Array.from({ length: values }, (_, index) => {
      const value = {
        namespace: "provider",
        provider_id: "typesafe",
        value: `${name}_${index}`,
      } as const;
      if (!numeric)
        vocabulary.atoms.push({
          kind: "categorical_value",
          key: value.value,
          dimension,
          definition: `Synthetic option ${index}`,
          label: `Option ${name} ${index}`,
        });
      const condition: PriceCondition = numeric
        ? {
            kind: "decimal_range",
            dimension,
            unit,
            lower: { value: String(index * step), inclusive: index === 0 },
            upper: { value: String((index + 1) * step), inclusive: true },
          }
        : { kind: "categorical", dimension, values: [value] };
      const selector: Selector = numeric
        ? { kind: "decimal", dimension, unit, value: String((index + 1) * step) }
        : { kind: "categorical", dimension, value };
      return {
        condition,
        selector,
        price: { numerator: String(index + amount), denominator: "1" },
      };
    });
    const { charge_binding: _binding, selector_sources: _selectors, ...unbound } = first;
    term.meter = meter;
    term.variants = cases.map(({ condition, price }) => {
      const applicability = { any_of: [{ all_of: [condition] }] };
      return {
        ...unbound,
        price: { value: price, denomination: { kind: "fiat", currency: "USD" }, per: unit },
        applicability,
        observations: first.observations.map((observation) => ({
          ...observation,
          establishes_applicability: applicability,
        })),
      };
    });
    term.raw_variants = [];
    offer.terms = [term];
    offer.relations = [];
    offer.enrollment = [];
    offer.settlement = [];
    offer.selection = [];
    book.offers = [offer];
    canonical.books = [book];
    canonical.model_dispositions = [];
    if (!numeric)
      vocabulary.atoms.push({
        kind: "categorical_value",
        key: "unpriced_option",
        dimension,
        definition: "Synthetic option without a tariff for this subject",
      });
    const atomKey = (atom: (typeof vocabulary.atoms)[number]) => [
      atom.kind,
      ...("dimension" in atom ? ["1", canonicalJson(atom.dimension)] : ["0"]),
      atom.key,
    ];
    vocabulary.atoms.sort((left, right) => compareUtf8Sequences(atomKey(left), atomKey(right)));
    const envelope = createPricingCatalogEnvelope(canonical, catalog);
    const data = priceDataExport(catalog, envelope);
    const association: InferencePriceRule = {
      provider_id: "typesafe",
      model_id: `future-request-${name}`,
      model_ref: "typesafe/jev-1.13.0",
      offer_refs: [offer.id],
      fixed_selectors: [],
      evidence: [
        {
          source_ref: term.source_refs[0] ?? "",
          locator: { kind: "fragment", value: "Synthetic source mapping" },
        },
      ],
    };
    const associations = mapping(data, [association]);
    const lookup = createInferencePriceLookup(data, associations);
    const query = { provider_id: association.provider_id, model_id: association.model_id };
    expect(lookup(query).missing_conditions).toEqual([dimension]);
    const model = catalog.models.find(({ uid }) => uid === association.model_ref);
    const price = websiteInferencePrices(catalog, envelope, associations).get(
      association.model_ref,
    )?.[0];
    if (!model || !price) throw new Error("Missing generic UI mapping");
    for (const example of cases) {
      const result = lookup({ ...query, selectors: [example.selector] });
      expect(result.status).toBe("matched");
      expect(
        result.candidates
          .flatMap(({ offer }) => offer.terms)
          .flatMap((entry) =>
            entry.kind === "rate" ? entry.variants.map(({ price }) => price.value) : [],
          ),
      ).toEqual([example.price]);
      expect(queryWebsiteInferencePrice(price, [example.selector], at).status).toBe(result.status);
    }
    const unknown: Selector = numeric
      ? { kind: "decimal", dimension, unit, value: "9999" }
      : {
          kind: "categorical",
          dimension,
          value: { namespace: "provider", provider_id: "typesafe", value: "unpriced_option" },
        };
    expect(lookup({ ...query, selectors: [unknown] }).reason).toBe("no_applicable_price");
    expect(queryWebsiteInferencePrice(price, [unknown], at).reason).toBe("no_applicable_price");
    const html = await renderComponent(InferencePrices, {
      modelRef: model.uid,
      prices: [price],
      offers: websiteModelDetail(canonical, model).pricing?.offers ?? [],
    });
    expect(html).not.toContain('placeholder="Enter value"');
    expect(/<select\b|role="radiogroup"/.test(html)).toBe(values > 1);
    if (!numeric && values > 1)
      for (let index = 0; index < values; index++)
        expect(html).toContain(`Option ${name} ${index}`);
    if (values === 1) expect(html).toContain('class="exact-rate"');
  },
);
it("preserves same-ID tariff candidates and reports actual missing conditions", () => {
  const lookup = createInferencePriceLookup(bedrock, mapping(bedrock, [profileRule("us")]));
  const result = lookup({ provider_id: "amazon-bedrock", model_id: "us.openai.gpt-6-astra" });
  expect(result.status).toBe("candidates");
  expect(result.missing_conditions).toEqual(
    expect.arrayContaining([
      { namespace: "kmodels", value: "service_tier" },
      { namespace: "kmodels", value: "context_tokens" },
    ]),
  );
  expect(result.missing_conditions).not.toContainEqual({
    namespace: "kmodels",
    value: "inference_geo",
  });
  const input = result.candidates.flatMap(({ offer }) =>
    offer.terms.filter((term) => term.kind === "rate" && term.meter.value === "input_text"),
  );
  expect(input.reduce((count, { variants }) => count + variants.length, 0)).toBeGreaterThan(1);
});
it("does not infer a source Region from a profile prefix or invent a mapping for private IDs", () => {
  const lookup = createInferencePriceLookup(
    bedrock,
    mapping(bedrock, [profileRule("us"), profileRule("global")]),
  );
  const result = lookup({ provider_id: "amazon-bedrock", model_id: "us.openai.gpt-6-astra" });
  expect(
    result.candidates.every(
      ({ selectors }) => !selectors.some(({ dimension }) => dimension.value === "region"),
    ),
  ).toBe(true);
  for (const model_id of [
    "eu.openai.gpt-6-astra",
    "my-application-profile",
    "US.openai.gpt-6-astra",
    "us.openai.gpt-6-astra ",
  ]) {
    expect(lookup({ provider_id: "amazon-bedrock", model_id })).toMatchObject({
      status: "unknown",
      reason: "unreviewed_id",
      candidates: [],
    });
  }
  expect(
    lookup({ provider_id: "other-provider", model_id: "us.openai.gpt-6-astra" }),
  ).toMatchObject({ status: "unknown", reason: "unreviewed_id" });
});
it("explains contradictory supplied geography without replacing it", () => {
  const lookup = createInferencePriceLookup(bedrock, mapping(bedrock, [profileRule("us")]));
  expect(
    lookup({
      provider_id: "amazon-bedrock",
      model_id: "us.openai.gpt-6-astra",
      selectors: profileRule("global").fixed_selectors,
    }),
  ).toMatchObject({ status: "unknown", reason: "incompatible_conditions", candidates: [] });
});
it("resolves ID-fixed regional unit prices without changing catalog identity", async () => {
  const suite = lookupFixtureSchema.parse(JSON.parse(await fixture("pricing/lookup.json")));
  const data = suite.datasets.base;
  const provider = data?.providers[0];
  const book = provider?.books[0];
  const offer = book?.offers[0];
  const modelRef = book?.scope.model_refs[0];
  if (!data || !provider || !book || !offer || !modelRef)
    throw new Error("Missing regional runtime fixture");
  const dimension = { namespace: "kmodels", value: "region" } as const;
  const regions = ["eu-west-1", "us-east-1"].map((value) => ({
    namespace: "provider" as const,
    provider_id: provider.snapshot.provider_id,
    value,
  }));
  for (const region of regions)
    provider.vocabulary.atoms.push({
      kind: "categorical_value",
      key: region.value,
      dimension,
      definition: `Synthetic billing Region ${region.value}`,
    });
  const regionIds = regions.map((region) => {
    const id = provider.applicabilities.length;
    provider.applicabilities.push({
      any_of: [{ all_of: [{ kind: "categorical" as const, dimension, values: [region] }] }],
    });
    return id;
  });
  for (const term of offer.terms) {
    if (term.kind !== "rate") continue;
    term.variants = term.variants.flatMap((variant) =>
      regionIds.map((applicability_id, index) => ({
        ...structuredClone(variant),
        price: {
          ...variant.price,
          value: multiplyRationals(variant.price.value, {
            numerator: String(index + 1),
            denominator: "1",
          }),
        },
        applicability_id,
      })),
    );
  }
  const rules = regions.map((region): InferencePriceRule => ({
    provider_id: provider.snapshot.provider_id,
    model_id: `request-${region.value}`,
    model_ref: modelRef,
    offer_refs: [offer.id],
    fixed_selectors: [{ kind: "categorical", dimension, value: region }],
    evidence: book.evidence,
  }));
  const unscoped = rules[0];
  if (!unscoped) throw new Error("Missing regional association");
  const lookup = createInferencePriceLookup(
    data,
    mapping(data, [...rules, { ...unscoped, model_id: "unscoped-request", fixed_selectors: [] }]),
  );
  expect(lookup({ provider_id: "example", model_id: "unscoped-request" })).toMatchObject({
    status: "candidates",
    missing_conditions: [dimension],
  });
  for (const rule of rules) {
    const result = lookup({
      provider_id: rule.provider_id,
      model_id: rule.model_id,
      evaluated_at: data.snapshot.generatedAt,
    });
    expect(result).toMatchObject({
      status: "matched",
      snapshot: data.snapshot,
      missing_conditions: [],
    });
    expect(result.candidates).toHaveLength(1);
    const candidate = result.candidates[0];
    if (!candidate) throw new Error("Missing regional candidate");
    expect(candidate).toMatchObject({
      model_ref: modelRef,
      book_ref: book.id,
      offer: { id: offer.id },
    });
    expect(candidate.selectors).toEqual(expect.arrayContaining(rule.fixed_selectors));
    const conflicting = rules.find(({ model_id }) => model_id !== rule.model_id);
    if (!conflicting) throw new Error("Missing conflicting Region");
    expect(
      lookup({
        provider_id: rule.provider_id,
        model_id: rule.model_id,
        selectors: conflicting.fixed_selectors,
      }),
    ).toMatchObject({ status: "unknown", reason: "incompatible_conditions", candidates: [] });
  }
});
it("selects the separately published US and Global tariffs using the same commercial conditions", () => {
  const lookup = createInferencePriceLookup(
    bedrock,
    mapping(bedrock, [profileRule("us"), profileRule("global")]),
  );
  const selectors = regionalSelectors();
  for (const [scope, price] of [
    ["us", { numerator: "33", denominator: "500000" }],
    ["global", { numerator: "3", denominator: "50000" }],
  ] as const) {
    const result = lookup({
      provider_id: "amazon-bedrock",
      model_id: `${scope}.openai.gpt-6-astra`,
      selectors,
    });
    expect(result.status).toBe("matched");
    expect(result.missing_conditions).toEqual([]);
    const inputRates = result.candidates.flatMap(({ offer }) =>
      offer.terms.flatMap((term) =>
        term.kind === "rate" && term.meter.value === "input_text" ? term.variants : [],
      ),
    );
    expect(inputRates.length).toBeGreaterThan(0);
    expect(
      inputRates.every(
        ({ price: actual }) => JSON.stringify(actual.value) === JSON.stringify(price),
      ),
    ).toBe(true);
  }
});
function regionalSelectors(): Selector[] {
  return [
    ...(
      [
        ["region", "us-east-1"],
        ["endpoint", "bedrock-runtime"],
        ["operation", "responses"],
        ["service_tier", "ultrafast"],
      ] as const
    ).map(([dimension, value]): Selector => ({
      kind: "categorical",
      dimension: { namespace: "kmodels", value: dimension },
      value: { namespace: "provider", provider_id: "amazon-bedrock", value },
    })),
    {
      kind: "decimal",
      dimension: { namespace: "kmodels", value: "context_tokens" },
      value: "1000",
      unit: { factors: [{ unit: { namespace: "kmodels", value: "token" }, power: 1 }] },
    },
    {
      kind: "decimal",
      dimension: { namespace: "kmodels", value: "cache_ttl_seconds" },
      value: "1800",
      unit: { factors: [{ unit: { namespace: "kmodels", value: "second" }, power: 1 }] },
    },
  ];
}
it("rejects mismatched snapshots, unsupported evidence sources and unrelated offers", () => {
  const associations = mapping(typesafe, [typesafeRule()]);
  expect(() =>
    createInferencePriceLookup(typesafe, { ...associations, pricing_data_version: "0".repeat(64) }),
  ).toThrow(/another price snapshot/);
  const changed = typesafeRule();
  changed.evidence[0] = {
    source_ref: "unknown-source",
    locator: { kind: "fragment", value: "unknown" },
  };
  expect(() => createInferencePriceLookup(typesafe, mapping(typesafe, [changed]))).toThrow(
    /unknown owner or source/,
  );
  changed.evidence = typesafeRule().evidence;
  changed.offer_refs = profileRule("us").offer_refs;
  expect(() => createInferencePriceLookup(typesafe, mapping(typesafe, [changed]))).toThrow(
    /unrelated offer/,
  );
});
it("does not let a caller overwrite model identity or repeat a price condition", () => {
  const lookup = createInferencePriceLookup(typesafe, mapping(typesafe, [typesafeRule()]));
  const identity: Selector = {
    kind: "categorical",
    dimension: { namespace: "kmodels", value: "model" },
    value: { namespace: "kmodels", value: "some-other-model" },
  };
  expect(
    lookup({ provider_id: "typesafe", model_id: "jev-1.13.0", selectors: [identity] }),
  ).toMatchObject({ status: "unknown", reason: "incompatible_conditions" });
  expect(() =>
    lookup({ provider_id: "typesafe", model_id: "jev-1.13.0", selectors: [identity, identity] }),
  ).toThrow(/repeat a dimension/);
});
it("resolves unit prices and accepts equivalent duplicate rate variants", () => {
  const data = structuredClone(typesafe);
  const rate = data.providers[0]?.books[0]?.offers[0]?.terms.find((term) => term.kind === "rate");
  const original = rate?.variants[0];
  if (!rate || !original) throw new Error("Missing TypeSafe rate");
  const duplicate = structuredClone(original);
  rate.variants.push(duplicate);
  const query = { provider_id: "typesafe", model_id: "jev-1.13.0", meter: rate.meter };
  const lookup = createInferencePriceLookup(data, mapping(data, [typesafeRule()]));
  const matched = lookup(query);
  expect(matched.status).toBe("matched");
  expect(matched.missing_conditions).toEqual([]);
  expect(matched.candidates.flatMap(({ gaps }) => gaps)).toEqual([]);
  expect(matched.candidates.flatMap(({ offer }) => offer.terms)).toMatchObject([
    {
      kind: "rate",
      meter: rate.meter,
      variants: [{ price: original.price }, { price: original.price }],
    },
  ]);
  rate.variants = [duplicate];
  expect(createInferencePriceLookup(data, mapping(data, [typesafeRule()]))(query).status).toBe(
    "matched",
  );
  expect(
    lookup({ ...query, meter: { namespace: "kmodels", value: "cache_write_text" } }),
  ).toMatchObject({
    status: "unknown",
    reason: "no_applicable_price",
    candidates: [],
  });
});
it("retains conflicting prices instead of choosing the first rate", () => {
  const data = structuredClone(typesafe);
  const rate = data.providers[0]?.books[0]?.offers[0]?.terms.find((term) => term.kind === "rate");
  const variant = rate?.variants[0];
  if (!rate || !variant) throw new Error("Missing TypeSafe rate");
  rate.variants.push({
    ...structuredClone(variant),
    price: { ...variant.price, value: { numerator: "1", denominator: "1" } },
  });
  const result = createInferencePriceLookup(
    data,
    mapping(data, [typesafeRule()]),
  )({ provider_id: "typesafe", model_id: "jev-1.13.0" });
  expect(result.status).toBe("candidates");
  expect(result.candidates.flatMap(({ gaps }) => gaps)).toContainEqual(
    expect.objectContaining({ code: "conflicting_variants" }),
  );
  expect(
    result.candidates
      .flatMap(({ offer }) =>
        offer.terms.flatMap((term) => (term.kind === "rate" ? term.variants : [])),
      )
      .map(({ price }) => price.value),
  ).toContainEqual({ numerator: "1", denominator: "1" });
});
it("reports canonical raw conflicts through public model/resource lookup and website explanations", () => {
  const { data, accepted } = conflictingPrices();
  const association = typesafeRule();
  const associations = mapping(data, [association]);
  const args = { provider_id: association.provider_id, model_id: association.model_id };
  const result = createInferencePriceLookup(data, associations)(args);
  const commercial = createCommercialPriceLookup(
    data,
    associations,
  )({
    subject: { kind: "model", ...args },
  });
  const resourceData = structuredClone(data);
  const book = resourceData.providers[0]?.books[0];
  if (!book) throw new Error("Missing resource fixture");
  book.scope = {
    kind: "provider_resource",
    resource_kind: { namespace: "kmodels", value: "service" },
    resource_key: "test-service",
    model_refs: book.scope.model_refs,
  };
  const resource = createCommercialPriceLookup(
    resourceData,
    mapping(resourceData, []),
  )({
    subject: { kind: "resource", provider_id: args.provider_id, book_ref: book.id },
  });
  for (const query of [result, commercial, resource]) {
    expect(query.status).toBe("unknown");
    expect(query.reason).toBe("unresolved_price");
    expect(query.candidates.flatMap(({ gaps }) => gaps)).toEqual([
      expect.objectContaining({ code: "conflicting_variants", reason: "conflicting_values" }),
    ]);
    const selected = query.candidates.flatMap(({ offer }) => offer.terms);
    const wireTerms = data.providers[0]?.books[0]?.offers[0]?.terms ?? [];
    expect(selected.map(({ id, kind, term_key }) => ({ id, kind, term_key }))).toEqual(
      wireTerms.map(({ id, kind, term_key }) => ({ id, kind, term_key })),
    );
    expect(
      selected.flatMap((term) =>
        (term.kind === "raw" ? term.variants : term.raw_variants).map(
          ({ impact, reason, possible_scope }) => ({ impact, reason, possible_scope }),
        ),
      ),
    ).toEqual([
      {
        impact: "base_price",
        reason: "conflicting_values",
        possible_scope: { any_of: [{ all_of: [] }] },
      },
    ]);
    expect(inferencePriceExplanation(query)).toContain("Published prices conflict");
  }
  const price = websiteInferencePrice(result);
  const projected = websiteInferencePrices(accepted.catalog, accepted.pricing, associations).get(
    association.model_ref,
  );
  const restored = restoreInferencePrices(storeInferencePrices(projected ?? [])).find(
    ({ model_id }) => model_id === association.model_id,
  );
  if (!restored) throw new Error("Missing website conflict");
  expect(restored).toMatchObject({
    status: "unknown",
    reason: "unresolved_price",
    explanation: "The ID mapping is known, but the available price evidence is incomplete.",
  });
  const interactive = queryWebsiteInferencePrice(restored, [], at);
  expect(price.explanation).toContain("Published prices conflict");
  expect(interactive.status).toBe(result.status);
  expect(interactive.reason).toBe(result.reason);
  expect(interactive.explanation).toBe(price.explanation);
});

it.each(["unsupported_structure", "unknown_amount", "superseded_value"] as const)(
  "preserves raw reasons without treating %s as a source conflict",
  (reason) => {
    const { data, rate } = conflictingPrices();
    for (const raw of rate.raw_variants) {
      raw.reason = reason;
      if (reason === "superseded_value") raw.impact = "informational";
    }
    const result = createInferencePriceLookup(
      data,
      mapping(data, [typesafeRule()]),
    )({
      provider_id: "typesafe",
      model_id: "jev-1.13.0",
    });
    expect(result.candidates.flatMap(({ gaps }) => gaps)).toEqual(
      reason === "superseded_value"
        ? []
        : [expect.objectContaining({ code: "unsupported_structure", reason })],
    );
    expect(inferencePriceExplanation(result)).not.toContain("prices conflict");
  },
);

it.each(["disjoint", "expired", "future", "informational"])(
  "ignores inactive raw conflicts beside a valid sibling: %s",
  (scenario) => {
    const { data, rate } = conflictingPrices();
    const original = typesafe.providers[0]?.books[0]?.offers[0]?.terms.find(
      (term) => term.kind === "rate",
    );
    if (!original) throw new Error("Missing rate fixture");
    rate.variants = structuredClone(original.variants);
    for (const raw of rate.raw_variants) {
      if (scenario === "disjoint") {
        const provider = data.providers[0];
        if (!provider) throw new Error("Missing fixture provider");
        const scopeId = provider.applicabilities.length;
        provider.applicabilities.push({
          any_of: [
            {
              all_of: [
                {
                  kind: "categorical",
                  dimension: { namespace: "kmodels", value: "execution" },
                  values: [{ namespace: "kmodels", value: "batch" }],
                },
              ],
            },
          ],
        });
        raw.possible_scope_id = scopeId;
      }
      if (scenario === "expired")
        raw.validity = { until: { value: "2026-01-01T00:00:00.000Z", precision: "datetime" } };
      if (scenario === "future")
        raw.validity = { from: { value: "2027-01-01T00:00:00.000Z", precision: "datetime" } };
      if (scenario === "informational") raw.impact = "informational";
    }
    const result = createInferencePriceLookup(
      data,
      mapping(data, [typesafeRule()]),
    )({
      provider_id: "typesafe",
      model_id: "jev-1.13.0",
      selectors: [
        {
          kind: "categorical",
          dimension: { namespace: "kmodels", value: "execution" },
          value: { namespace: "kmodels", value: "request" },
        },
      ],
    });
    expect(result.status).toBe("matched");
    expect(result.candidates.flatMap(({ gaps }) => gaps)).toEqual([]);
    expect(inferencePriceExplanation(result)).not.toContain("prices conflict");
  },
);

it("requires remaining conditions before presenting a scoped raw conflict as applicable", () => {
  const { data, rate } = conflictingPrices();
  const original = typesafe.providers[0]?.books[0]?.offers[0]?.terms.find(
    (term) => term.kind === "rate",
  );
  if (!original) throw new Error("Missing rate fixture");
  rate.variants = structuredClone(original.variants);
  const provider = data.providers[0];
  if (!provider) throw new Error("Missing fixture provider");
  const batchScopeId = provider.applicabilities.length;
  provider.applicabilities.push({
    any_of: [
      {
        all_of: [
          {
            kind: "categorical",
            dimension: { namespace: "kmodels", value: "execution" },
            values: [{ namespace: "kmodels", value: "batch" }],
          },
        ],
      },
    ],
  });
  for (const raw of rate.raw_variants) raw.possible_scope_id = batchScopeId;
  const query = createInferencePriceLookup(data, mapping(data, [typesafeRule()]));
  const result = query({ provider_id: "typesafe", model_id: "jev-1.13.0" });
  expect(result.status).toBe("candidates");
  expect(result.missing_conditions).toEqual([{ namespace: "kmodels", value: "execution" }]);
  expect(inferencePriceExplanation(result)).not.toContain("prices conflict");
  expect(query({ provider_id: "typesafe", model_id: "private-endpoint" })).toMatchObject({
    status: "unknown",
    reason: "unreviewed_id",
    candidates: [],
  });
});

it.each([
  "unreviewed_id",
  "ambiguous_identity",
  "incompatible_conditions",
  "no_applicable_price",
  "unreviewed_execution_mode",
  "unreviewed_commercial_choice",
] as const)("keeps identity and scope explanation precedence for %s", (reason) => {
  expect(
    inferencePriceExplanation({
      status: "unknown",
      reason,
      candidates: [{ gaps: [{ code: "conflicting_variants" }] }],
    }),
  ).not.toContain("prices conflict");
});
it.each(["conflicting_variants", "unresolved_validity", "historical_evidence_missing"])(
  "explains specific evidence before generic unresolved_price: %s",
  (code) => {
    const explanation = inferencePriceExplanation({
      status: "unknown",
      reason: "unresolved_price",
      candidates: [{ gaps: [{ code }] }],
    });
    expect(explanation).toContain(
      code === "conflicting_variants"
        ? "Published prices conflict"
        : "Price validity is not fully established",
    );
  },
);
it("identifies a published price without accounting fields in the portable schema", () => {
  const data = structuredClone(typesafe);
  const result = createInferencePriceLookup(
    data,
    mapping(data, [typesafeRule()]),
  )({ provider_id: "typesafe", model_id: "jev-1.13.0" });
  expect(result.status).toBe("matched");
  expect(result.candidates.flatMap(({ gaps }) => gaps)).toEqual([]);
});
it("keeps an expired sibling price from blocking a current price", () => {
  const data = structuredClone(typesafe);
  const rate = data.providers[0]?.books[0]?.offers[0]?.terms.find((term) => term.kind === "rate");
  const variant = rate?.variants[0];
  if (!rate || !variant) throw new Error("Missing TypeSafe rate");
  rate.variants.push({
    ...structuredClone(variant),
    validity: { until: { value: "2026-01-01T00:00:00.000Z", precision: "datetime" } },
  });
  const result = createInferencePriceLookup(
    data,
    mapping(data, [typesafeRule()]),
  )({ provider_id: "typesafe", model_id: "jev-1.13.0" });
  expect(result.status).toBe("matched");
  expect(result.candidates.flatMap(({ gaps }) => gaps)).toEqual([]);
});
it("never revives a withdrawn mapping from a similar catalog ID", () => {
  const lookup = createInferencePriceLookup(typesafe, mapping(typesafe, []));
  expect(lookup({ provider_id: "typesafe", model_id: "jev-1.13.0" })).toMatchObject({
    status: "unknown",
    reason: "unreviewed_id",
    candidates: [],
  });
});
it("requires reviewed execution metadata and never interprets an offer name or key in the runtime", () => {
  const association = typesafeRule();
  const query = {
    provider_id: "typesafe",
    model_id: "jev-1.13.0",
    execution_mode: "request",
  } as const;
  const unreviewed = structuredClone(typesafe);
  for (const provider of unreviewed.providers)
    for (const book of provider.books) for (const offer of book.offers) delete offer.selection;
  expect(
    createInferencePriceLookup(unreviewed, mapping(unreviewed, [association]))(query),
  ).toMatchObject({
    status: "unknown",
    reason: "unreviewed_execution_mode",
    candidates: [],
  });
  const source = mapping(typesafe, [association]);
  const lookup = createInferencePriceLookup(typesafe, source);
  const result = lookup(query);
  expect(result.status).toBe("matched");
  expect(
    lookup({
      provider_id: query.provider_id,
      model_id: query.model_id,
      choices: [
        { dimension: "execution", value: { namespace: "kmodels", value: "request" } },
        { dimension: "billing_mode", value: { namespace: "kmodels", value: "usage" } },
      ],
    }).candidates,
  ).toEqual(result.candidates);
  expect(result.execution_modes).toEqual(["request"]);
  expect(result.candidates.map(({ offer }) => offer.id)).toEqual(association.offer_refs);
  expect(lookup({ ...query, execution_mode: "realtime" })).toMatchObject({
    status: "unknown",
    reason: "no_applicable_price",
    candidates: [],
  });
  expect(lookup({ ...query, offer_ref: "0".repeat(64) }).candidates).toEqual([]);
});
it("resolves canonical served-tier selection to its native price condition", async () => {
  const suite = lookupFixtureSchema.parse(JSON.parse(await fixture("pricing/lookup.json")));
  const data = structuredClone(suite.datasets.tier);
  const provider = data?.providers[0];
  const book = provider?.books[0];
  const offer = book?.offers[0];
  const modelRef = book?.scope.model_refs[0];
  const dimension = { namespace: "kmodels", value: "served_service_tier" } as const;
  const tier = {
    kind: "categorical",
    dimension,
    value: { namespace: "provider", provider_id: "example", value: "priority" },
  } as const;
  if (!data || !provider || !book || !offer || !modelRef) throw new Error("Missing tier fixture");
  let unconditionalId = provider.applicabilities.findIndex(
    ({ any_of }) => any_of.length === 1 && any_of[0]?.all_of.length === 0,
  );
  if (unconditionalId === -1) {
    unconditionalId = provider.applicabilities.length;
    provider.applicabilities.push({ any_of: [{ all_of: [] }] });
  }
  const priorityId = provider.applicabilities.findIndex(
    ({ any_of }) =>
      any_of.length === 1 &&
      any_of[0]?.all_of.length === 1 &&
      any_of[0].all_of[0]?.kind === "categorical" &&
      any_of[0].all_of[0].dimension.value === "served_service_tier" &&
      any_of[0].all_of[0].values[0]?.value === "priority",
  );
  if (priorityId === -1) throw new Error("Missing priority applicability");
  offer.selection = [
    {
      dimension: "served_service_tier",
      coverage: "complete",
      applicability_id: unconditionalId,
      alternatives: [
        {
          value: { namespace: "kmodels", value: "priority" },
          applicability_id: priorityId,
        },
      ],
      evidence: book.evidence,
    },
  ];
  const associations = mapping(data, [
    {
      provider_id: provider.snapshot.provider_id,
      model_id: "tier-model",
      model_ref: modelRef,
      offer_refs: [offer.id],
      fixed_selectors: [],
      evidence: book.evidence,
    },
  ]);
  const selected = createInferencePriceLookup(
    data,
    associations,
  )({
    provider_id: provider.snapshot.provider_id,
    model_id: "tier-model",
    evaluated_at: data.snapshot.generatedAt,

    choices: [
      { dimension: "served_service_tier", value: { namespace: "kmodels", value: "priority" } },
    ],
  }).candidates[0];
  if (!selected) throw new Error("Missing canonical candidate");
  expect(selected.selectors).toContainEqual(tier);
});
it("returns the mechanism-selected offer with independent price conditions", async () => {
  const suite = lookupFixtureSchema.parse(JSON.parse(await fixture("pricing/lookup.json")));
  const data = suite.datasets.base;
  const provider = data?.providers[0];
  const book = provider?.books[0];
  const offer = book?.offers[0];
  const modelRef = book?.scope.model_refs[0];
  if (!data || !provider || !book || !offer || !modelRef)
    throw new Error("Missing mechanism fixture");
  const dimension = { namespace: "kmodels", value: "region" } as const;
  const operation = (value: string): Selector => ({
    kind: "categorical",
    dimension,
    value: { namespace: "provider", provider_id: provider.snapshot.provider_id, value },
  });
  for (const value of ["interactive", "deferred"])
    provider.vocabulary.atoms.push({
      kind: "categorical_value",
      key: value,
      dimension,
      definition: `Synthetic ${value} mechanism`,
    });
  const unconditionalId = provider.applicabilities.findIndex(
    ({ any_of }) => any_of.length === 1 && any_of[0]?.all_of.length === 0,
  );
  if (unconditionalId === -1) throw new Error("Missing unconditional applicability");
  const regionScopeIds = ["interactive", "deferred"].map((value) => {
    const id = provider.applicabilities.length;
    provider.applicabilities.push({
      any_of: [
        {
          all_of: [
            {
              kind: "categorical" as const,
              dimension,
              values: [
                {
                  namespace: "provider" as const,
                  provider_id: provider.snapshot.provider_id,
                  value,
                },
              ],
            },
          ],
        },
      ],
    });
    return id;
  });
  for (const term of offer.terms) {
    if (term.kind !== "rate") continue;
    term.variants = term.variants.flatMap((variant) =>
      regionScopeIds.map((applicability_id, index) => ({
        ...structuredClone(variant),
        price: {
          ...variant.price,
          value: multiplyRationals(variant.price.value, {
            numerator: "1",
            denominator: String(index + 1),
          }),
        },
        applicability_id,
      })),
    );
  }
  const executionClaim = (mode: "request" | "batch") => ({
    dimension: "execution" as const,
    coverage: "complete" as const,
    applicability_id: unconditionalId,
    alternatives: [
      { value: { namespace: "kmodels" as const, value: mode }, applicability_id: unconditionalId },
    ],
    evidence: book.evidence,
  });
  offer.selection = [executionClaim("request")];
  const association: InferencePriceRule = {
    provider_id: provider.snapshot.provider_id,
    model_id: "literal-id",
    model_ref: modelRef,
    offer_refs: [offer.id],
    fixed_selectors: [],
    evidence: book.evidence,
  };
  const batch = structuredClone(offer);
  batch.id = sha256("batch-offer");
  batch.offer_key = "batch";
  batch.selection = [executionClaim("batch")];
  batch.terms = batch.terms.map((term, index) => ({ ...term, id: sha256(`batch-term-${index}`) }));
  book.offers.push(batch);
  association.offer_refs.push(batch.id);
  const lookup = createInferencePriceLookup(data, mapping(data, [association]));
  const query = { provider_id: provider.snapshot.provider_id, model_id: "literal-id" };
  expect(lookup(query)).toMatchObject({
    execution_modes: ["batch", "request"],
    requires_execution_mode_choice: true,
  });
  const result = lookup({ ...query, execution_mode: "batch", selectors: [operation("deferred")] });
  expect(result.status).toBe("matched");
  const candidate = result.candidates[0];
  if (!candidate) throw new Error("Missing Batch candidate");
  expect(candidate.selectors).toContainEqual(operation("deferred"));
  const fixed = { ...association, fixed_selectors: [operation("deferred")] };
  expect(
    createInferencePriceLookup(
      data,
      mapping(data, [fixed]),
    )({ ...query, execution_mode: "batch", selectors: [operation("interactive")] }),
  ).toMatchObject({
    status: "unknown",
    reason: "incompatible_conditions",
    candidates: [],
  });
  const price = {
    ...websiteInferencePrice(result),
    matching: inferenceMatchData(createPricingSnapshot(data), [association]),
  };
  expect(
    queryWebsiteInferencePrice(
      price,
      [operation("deferred")],
      result.evaluated_at,
      undefined,
      "batch",
    ).candidates[0]?.selectors,
  ).toEqual(candidate.selectors);
  const unreviewedBatch = structuredClone(data);
  const unreviewedOffer = unreviewedBatch.providers[0]?.books[0]?.offers.find(
    ({ id }) => id === batch.id,
  );
  if (unreviewedOffer !== undefined) delete unreviewedOffer.selection;
  expect(
    createInferencePriceLookup(
      unreviewedBatch,
      mapping(unreviewedBatch, [association]),
    )({ ...query, offer_ref: batch.id, execution_mode: "batch" }),
  ).toMatchObject({
    status: "unknown",
    reason: "unreviewed_execution_mode",
    candidates: [],
  });
});
it("retains all commercial offers in lookup and prompts the inspector for a plan", async () => {
  const data = structuredClone(typesafe);
  const book = data.providers[0]?.books[0];
  const original = book?.offers[0];
  if (!book || !original) throw new Error("Missing TypeSafe offer");
  const alternative = structuredClone(original);
  alternative.id = "f".repeat(64);
  alternative.offer_key = "fixture-alternative";
  alternative.terms = alternative.terms.map((term, index) => ({
    ...term,
    id: sha256(`alternative-term-${index}`),
  }));
  book.offers.push(alternative);
  const association = typesafeRule();
  association.offer_refs.push(alternative.id);
  expect(
    createInferencePriceLookup(
      data,
      mapping(data, [association]),
    )({ provider_id: "typesafe", model_id: "jev-1.13.0", execution_mode: "request" }),
  ).toMatchObject({
    status: "candidates",
    requires_offer_choice: true,
    requires_execution_mode_choice: false,
  });
  const result = createInferencePriceLookup(
    data,
    mapping(data, [association]),
  )({ provider_id: "typesafe", model_id: "jev-1.13.0" });
  expect(result.status).toBe("candidates");
  expect(result.requires_offer_choice).toBe(true);
  expect(result.candidates.map(({ offer }) => offer.id).sort()).toEqual(
    [original.id, alternative.id].sort(),
  );
  const pair = fixturePairs.get("typesafe");
  if (pair === undefined) throw new Error("Missing TypeSafe fixture pair");
  const website = websitePublication(pair.catalog, pair.envelope.data, "a".repeat(64));
  const offer = website.offers.flatMap(({ offers }) => offers).find(({ id }) => id === original.id);
  if (offer === undefined) throw new Error("Missing original website offer");
  const price = {
    ...websiteInferencePrice(result),
    matching: inferenceMatchData(createPricingSnapshot(data), [association]),
  };
  expect(queryWebsiteInferencePrice(price, [], at).requires_offer_choice).toBe(true);
  expect(queryWebsiteInferencePrice(price, [], at, original.id).requires_offer_choice).toBe(false);
  const html = await renderComponent(InferencePrices, {
    modelRef: association.model_ref,
    prices: [price],
    offers: [offer, { ...offer, id: alternative.id, title: "Alternative plan" }],
  });
  expect(html).toContain('type="radio"');
  expect(html).toContain("Alternative plan");
  expect(html).toContain("to see rates.");
  expect(html).not.toContain('class="exact-rate"');
});
it("does not turn an expired tariff into a matched price", () => {
  const data = structuredClone(typesafe);
  for (const provider of data.providers)
    for (const book of provider.books)
      for (const offer of book.offers) {
        for (const term of offer.terms)
          if (term.kind !== "raw")
            for (const variant of term.variants)
              variant.validity = {
                until: { value: "2026-01-01T00:00:00.000Z", precision: "datetime" },
              };
      }
  const result = createInferencePriceLookup(
    data,
    mapping(data, [typesafeRule()]),
  )({ provider_id: "typesafe", model_id: "jev-1.13.0" });
  expect(result.status).toBe("unknown");
  expect(result.reason).toBe("no_applicable_price");
  expect(result.candidates.flatMap(({ gaps }) => gaps)).toContainEqual(
    expect.objectContaining({ code: "outside_validity" }),
  );
});
it("does not use resolved calendar validity as evidence for a price observed later", () => {
  const data = structuredClone(typesafe);
  for (const provider of data.providers)
    for (const book of provider.books)
      for (const offer of book.offers)
        for (const term of offer.terms)
          if (term.kind === "rate")
            for (const variant of term.variants)
              variant.validity = { from: { value: "2026-09-01", precision: "date" } };
  const result = createInferencePriceLookup(
    data,
    mapping(data, [typesafeRule()]),
  )({
    provider_id: "typesafe",
    model_id: "jev-1.13.0",
    evaluated_at: "2026-10-01T00:00:00Z",
  });
  expect(result.status).toBe("unknown");
  expect(result.candidates.flatMap(({ gaps }) => gaps)).toContainEqual(
    expect.objectContaining({ code: "historical_evidence_missing" }),
  );
});
it("keeps date-only rates visible as evidence near their boundary without prompting for a pricing input", async () => {
  const data = structuredClone(typesafe);
  const association = typesafeRule();
  const offer = data.providers[0]?.books
    .flatMap(({ offers }) => offers)
    .find(({ id }) => association.offer_refs.includes(id));
  if (offer === undefined) throw new Error("Missing TypeSafe offer");
  for (const term of offer.terms) {
    if (term.kind !== "rate") continue;
    for (const variant of term.variants)
      variant.validity = { until: { value: "2026-11-30", precision: "date" } };
  }
  const result = createInferencePriceLookup(
    data,
    mapping(data, [association]),
  )({
    provider_id: "typesafe",
    model_id: association.model_id,
    evaluated_at: "2026-11-30T00:00:00Z",
  });
  expect(result.status).toBe("candidates");
  expect(result.candidates.flatMap(({ gaps }) => gaps)).toContainEqual(
    expect.objectContaining({ code: "unresolved_validity" }),
  );
  expect(
    result.candidates.flatMap(({ offer }) =>
      offer.terms.flatMap((term) =>
        term.kind === "rate" ? term.variants.map(({ validity }) => validity) : [],
      ),
    ),
  ).toContainEqual({ until: { value: "2026-11-30", precision: "date" } });
  const projected = websiteInferencePrice(result);
  const matching = inferenceMatchData(createPricingSnapshot(data), [association]);
  expect(
    queryWebsiteInferencePrice({ ...projected, matching }, [], "2026-11-30T00:00:00.000Z"),
  ).toMatchObject({
    status: "candidates",
    explanation: expect.stringContaining("Price validity is not fully established"),
    candidates: [
      expect.objectContaining({
        row_keys: expect.arrayContaining([expect.stringContaining(":rate:")]),
      }),
    ],
  });
  const pair = fixturePairs.get("typesafe");
  if (pair === undefined) throw new Error("Missing TypeSafe fixture pair");
  const website = websitePublication(pair.catalog, pair.envelope.data, "a".repeat(64));
  const html = await renderComponent(InferencePrices, {
    modelRef: association.model_ref,
    prices: [projected],
    offers: website.offers.flatMap(({ offers }) => offers),
  });
  expect(html).toContain("Price evidence incomplete");
  expect(html).toContain("Price validity is not fully established");
  expect(html).toContain('class="exact-rate"');
  expect(html).not.toContain("to see rates.");
});
it("isolates reusable lookup inputs and results from caller mutation", () => {
  const data = structuredClone(typesafe);
  const associations = mapping(data, [typesafeRule()]);
  const lookup = createInferencePriceLookup(data, associations);
  const query = { provider_id: "typesafe", model_id: "jev-1.13.0" };
  const original = lookup(query);
  const changed = lookup(query);
  changed.candidates.length = 0;
  changed.snapshot.pricingDataVersion = "f".repeat(64);
  if (changed.freshness === undefined) throw new Error("Missing fixture freshness");
  changed.freshness.observed_at = "2026-01-01T00:00:00.000Z";
  associations.rules.length = 0;
  data.providers.length = 0;
  expect(lookup(query)).toEqual(original);
});
it("normalizes query time and retains snapshot identity for unknown IDs", () => {
  const lookup = createInferencePriceLookup(typesafe, mapping(typesafe, [typesafeRule()]));
  const evaluatedAt = "2026-10-30T08:00:00.00012300+08:00";
  const result = lookup({
    provider_id: "typesafe",
    model_id: "jev-1.13.0",
    evaluated_at: evaluatedAt,
  });
  const candidate = result.candidates[0];
  if (!candidate) throw new Error("Missing timed candidate");
  expect(result.query.evaluated_at).toBe(evaluatedAt);
  expect(result.evaluated_at).toBe("2026-10-30T00:00:00.000123Z");
  for (const invalid of ["2026-02-30T00:00:00Z", "2026-10-30T08:00:00-00:00"])
    expect(() =>
      lookup({ provider_id: "typesafe", model_id: "jev-1.13.0", evaluated_at: invalid }),
    ).toThrow(/RFC 3339/);
  const unknown = lookup({ provider_id: "typesafe", model_id: "unreviewed-id" });
  expect(unknown).toMatchObject({
    reason: "unreviewed_id",
    snapshot: typesafe.snapshot,
    evaluated_at: typesafe.snapshot.generatedAt,
  });
  unknown.snapshot.coreCatalogVersion = "f".repeat(64);
  expect(lookup({ provider_id: "typesafe", model_id: "unreviewed-id" }).snapshot).toEqual(
    typesafe.snapshot,
  );
});
it("distinguishes an unknown ID from known conditions that exclude every price in output and UI", async () => {
  const lookup = createInferencePriceLookup(bedrock, mapping(bedrock, [profileRule("us")]));
  const excluded = lookup({
    provider_id: "amazon-bedrock",
    model_id: "us.openai.gpt-6-astra",
    selectors: [
      {
        dimension: { namespace: "kmodels", value: "region" },
        kind: "categorical",
        value: { namespace: "provider", provider_id: "amazon-bedrock", value: "eu-north-1" },
      },
    ],
  });
  expect(excluded).toMatchObject({
    status: "unknown",
    reason: "no_applicable_price",
    candidates: [],
  });
  expect(excluded.evidence.length).toBeGreaterThan(0);
  const unknown = lookup({ provider_id: "amazon-bedrock", model_id: "private-deployment" });
  expect(unknown).toMatchObject({ status: "unknown", reason: "unreviewed_id", evidence: [] });
  for (const [result, title] of [
    [excluded, "No applicable prices"],
    [unknown, "Price mapping unknown"],
  ] as const) {
    const projected = websiteInferencePrice(result);
    const html = await renderComponent(InferencePrices, {
      modelRef: "amazon-bedrock/openai.gpt-6-astra",
      prices: [projected],
      offers: [],
    });
    expect(html).toContain(title);
    expect(projected).not.toHaveProperty("evidence");
    expect(projected).not.toHaveProperty("sources");
    expect(JSON.stringify(projected)).not.toContain("content_hash");
  }
});
it("binds ID evidence to its provider and to both accepted snapshots", () => {
  const source = typesafe.providers[0]?.sources[0];
  if (!source) throw new Error("Missing source");
  const association = typesafeRule();
  association.evidence = [
    {
      source_ref: "separate-model-id-document",
      locator: { kind: "fragment", value: "jev-1.13.0" },
    },
  ];
  const mapped = mapping(typesafe, [association]);
  mapped.sources.push({ ...source, id: "separate-model-id-document", provider_id: "typesafe" });
  expect(
    createInferencePriceLookup(
      typesafe,
      mapped,
    )({ provider_id: "typesafe", model_id: "jev-1.13.0" }).status,
  ).toBe("matched");
  expect(() =>
    createInferencePriceLookup(typesafe, { ...mapped, core_catalog_version: "f".repeat(64) }),
  ).toThrow(/another price snapshot/);
  mapped.sources = [
    { ...source, id: "separate-model-id-document", provider_id: "another-provider" },
  ];
  expect(() => createInferencePriceLookup(typesafe, mapped)).toThrow(/unknown owner or source/);
});
it("does not let an expired raw price qualification block current prices", () => {
  const data = structuredClone(typesafe);
  const rate = data.providers[0]?.books[0]?.offers[0]?.terms.find((term) => term.kind === "rate");
  const evidence = rate?.variants[0]?.evidence;
  if (!rate || !evidence) throw new Error("Missing rate evidence");
  rate.raw_variants.push({
    impact: "base_price",
    reason: "unsupported_structure",
    evidence,
    validity: { until: { value: "2026-01-01T00:00:00.000Z", precision: "datetime" } },
  });
  const result = createInferencePriceLookup(
    data,
    mapping(data, [typesafeRule()]),
  )({ provider_id: "typesafe", model_id: "jev-1.13.0" });
  expect(result.status).toBe("matched");
  expect(result.candidates.flatMap(({ gaps }) => gaps)).toEqual([]);
  rate.raw_variants = rate.raw_variants.map(({ impact, reason, evidence }) => ({
    impact,
    reason,
    evidence,
  }));
  expect(
    createInferencePriceLookup(
      data,
      mapping(data, [typesafeRule()]),
    )({ provider_id: "typesafe", model_id: "jev-1.13.0" }).status,
  ).toBe("candidates");
});
it("adds mapping output without changing either canonical price or catalog payload", async () => {
  const pair = fixturePairs.get("typesafe");
  if (!pair) throw new Error("Missing fixture pair");
  const legacy = prepareCatalogPair(pair.catalog, pair.envelope);
  const associations = mapping(typesafe, [typesafeRule(), typesafeRule("jev-latest")]);
  const mapped = prepareCatalogPair(pair.catalog, pair.envelope, associations);
  expect(mapped.catalogAssetSource).toBe(legacy.catalogAssetSource);
  expect(mapped.pricingAssetSource).toBe(legacy.pricingAssetSource);
  expect(mapped.pairId).not.toBe(legacy.pairId);
  const projected = await projectCatalogPair(mapped);
  expect(
    projected.exports.manifest.assets.filter(
      ({ file_name }) => file_name === "pricing/inference.json",
    ),
  ).toHaveLength(1);
  const source = typesafe.providers[0]?.sources[0];
  if (!source) throw new Error("Missing evidence");
  expect(() =>
    prepareCatalogPair(pair.catalog, pair.envelope, {
      ...associations,
      sources: [{ ...source, provider_id: "typesafe", content_hash: "f".repeat(64) }],
    }),
  ).toThrow(/unknown source revision/);
});
function mixedPublication() {
  const left = fixturePairs.get("amazon-bedrock");
  const right = fixturePairs.get("typesafe");
  if (!left || !right) throw new Error("Missing mixed-provider fixtures");
  const catalog = catalogSchema.parse(
    JSON.parse(
      JSON.stringify({
        ...left.catalog,
        catalog_version: sha256("mixed inference publication"),
        providers: [...left.catalog.providers, ...right.catalog.providers],
        models: [...left.catalog.models, ...right.catalog.models],
        sources: [...left.catalog.sources, ...right.catalog.sources],
        coverage: [...left.catalog.coverage, ...right.catalog.coverage],
      } satisfies Catalog),
    ),
  );
  const pricing = createPricingCatalogEnvelope(
    {
      provider_vocabularies: [
        ...left.envelope.data.provider_vocabularies,
        ...right.envelope.data.provider_vocabularies,
      ],
      provider_snapshots: [
        ...left.envelope.data.provider_snapshots,
        ...right.envelope.data.provider_snapshots,
      ],
      model_dispositions: [
        ...left.envelope.data.model_dispositions,
        ...right.envelope.data.model_dispositions,
      ],
      books: [...left.envelope.data.books, ...right.envelope.data.books].sort((a, b) =>
        a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
      ),
    },
    catalog,
  );
  const prices = priceDataExport(catalog, pricing);
  const associations = mapping(prices, [typesafeRule(), profileRule("us")]);
  return { catalog, pricing, prices, associations };
}
it("publishes complete mixed-provider mappings with equivalent partition lookups and owned data", () => {
  const { catalog, pricing, prices, associations } = mixedPublication();
  const original = structuredClone(associations);
  const published = inferencePricingPublication(catalog, pricing, associations);
  const full = createInferencePriceLookup(prices, published.mapping);
  for (const query of [
    { provider_id: "typesafe", model_id: "jev-1.13.0" },
    { provider_id: "amazon-bedrock", model_id: "us.openai.gpt-6-astra" },
  ]) {
    const partition = priceDataExport(catalog, pricing, [query.provider_id]);
    expect(
      createInferencePriceLookup(partition, {
        ...published.mapping,
        rules: published.mapping.rules.filter(
          ({ provider_id }) => provider_id === query.provider_id,
        ),
        sources: published.mapping.sources.filter(
          ({ provider_id }) => provider_id === query.provider_id,
        ),
      })(query),
    ).toEqual(full(query));
  }
  expect(associations).toEqual(original);
});

it("shares a checked price export across website projection without changing owned inputs or output", () => {
  const { catalog, pricing, prices, associations } = mixedPublication();
  const original = structuredClone({ prices, associations });
  const isolated = websiteInferencePrices(catalog, pricing, associations);
  const shared = websiteInferencePrices(catalog, pricing, associations, validatePriceData(prices));
  expect(shared).toEqual(isolated);
  expect({ prices, associations }).toEqual(original);
});

it("isolates commercial queries over the shared snapshot from caller mutation", () => {
  const { prices, associations } = mixedPublication();
  const lookup = createCommercialPriceLookup(prices, associations);
  const modelQuery = {
    subject: { kind: "model" as const, provider_id: "typesafe", model_id: "jev-1.13.0" },
  };
  const siblingQuery = {
    subject: {
      kind: "model" as const,
      provider_id: "amazon-bedrock",
      model_id: "us.openai.gpt-6-astra",
    },
  };
  const originalModel = lookup(modelQuery);
  const originalSibling = lookup(siblingQuery);
  const changedModel = lookup(modelQuery);
  changedModel.candidates.length = 0;
  const changedSibling = lookup(siblingQuery);
  changedSibling.snapshot.pricingDataVersion = "f".repeat(64);
  prices.providers.length = 0;
  associations.rules.length = 0;
  expect(lookup(modelQuery)).toEqual(originalModel);
  expect(lookup(siblingQuery)).toEqual(originalSibling);
});
it("uses shared lookup candidates for the website and preserves raw regional IDs", async () => {
  const pair = fixturePairs.get("amazon-bedrock");
  if (!pair) throw new Error("Missing fixture pair");
  const mapped = mapping(bedrock, [profileRule("us"), profileRule("global")]);
  const results = websiteInferencePrices(pair.catalog, pair.envelope, mapped);
  const rows = results.get("amazon-bedrock/openai.gpt-6-astra");
  const regional = rows?.find(({ model_id }) => model_id === "us.openai.gpt-6-astra");
  const lookup = createInferencePriceLookup(
    bedrock,
    mapped,
  )({ provider_id: "amazon-bedrock", model_id: "us.openai.gpt-6-astra" });
  expect(regional?.status).toBe(lookup.status);
  expect(regional?.candidates).toEqual(
    lookup.candidates.map(({ offer, selectors }) => ({ offer_ref: offer.id, selectors })),
  );
  expect(rows?.map(({ model_id }) => model_id)).toEqual([
    "us.openai.gpt-6-astra",
    "global.openai.gpt-6-astra",
  ]);
  const website = websitePublication(pair.catalog, pair.envelope.data, "a".repeat(64), results);
  const detail = website.details
    .flatMap(({ details }) => details)
    .find(({ model_ref }) => model_ref === "amazon-bedrock/openai.gpt-6-astra");
  if (detail?.inference_prices === undefined) throw new Error("Missing stored inference prices");
  expect(restoreInferencePrices(detail.inference_prices)).toEqual(rows);
  const globalPrice = rows?.find(({ model_id }) => model_id === "global.openai.gpt-6-astra");
  if (!regional || !globalPrice)
    throw new Error("Missing inference prices for one of the profiles");
  const offers = website.offers.flatMap(({ offers }) => offers);
  const globalHtml = await renderComponent(InferencePrices, {
    modelRef: "amazon-bedrock/openai.gpt-6-astra",
    prices: [globalPrice],
    offers,
  });
  expect(globalHtml).toContain(">eu-west-1</span>");
  const html = await renderComponent(InferencePrices, {
    modelRef: "amazon-bedrock/openai.gpt-6-astra",
    prices: [regional],
    offers,
  });
  expect(html).toContain(">us-east-1</span>");
  expect(html).not.toContain(">eu-west-1</span>");
  expect(html).toContain("us.openai.gpt-6-astra");
  expect(html).toContain("Inference model ID");
  expect(html).toContain('aria-label="Copy inference model ID us.openai.gpt-6-astra"');
  expect(html).toContain("#ui-copy");
  expect(html).not.toContain(">Copy<");
  expect(html).toContain("to see rates.");
  expect(html).not.toContain("$66");
  expect(html).not.toContain('class="exact-rate"');
  expect(html).not.toContain("Sources ·");
  expect(html).not.toContain("Inspect target");
  expect(html).not.toContain("Task and documented scope");
});
it("uses single-value Bedrock conditions without asking the viewer", async () => {
  const pair = fixturePairs.get("amazon-bedrock");
  if (!pair) throw new Error("Missing Bedrock fixture pair");
  const regional = profileRule("us");
  const modelRef = regional.model_ref;
  const mapped = mapping(bedrock, [regional]);
  const results = websiteInferencePrices(pair.catalog, pair.envelope, mapped);
  const price = results.get(modelRef)?.find(({ model_id }) => model_id === regional.model_id);
  const operation = price?.pricing_options?.find(
    ({ dimension }) => dimension.value === "operation",
  );
  if (!price || operation?.kind !== "categorical") throw new Error("Missing Bedrock operation");
  expect(operation.values.map(({ value }) => value.value)).toEqual(["responses"]);
  const offers = websitePublication(
    pair.catalog,
    pair.envelope.data,
    "a".repeat(64),
  ).offers.flatMap(({ offers }) => offers);
  const pending = await renderComponent(InferencePrices, { modelRef, prices: [price], offers });
  expect(pending).toContain("to see rates.");
  const $ = load(pending);
  expect(
    $("label[for]")
      .map((_, label) => $(label).text().trim())
      .get(),
  ).toContain("Service tier");
  expect(pending).not.toContain("<output");
  expect(pending).not.toContain("Cache TTL");
  expect(pending).not.toContain('class="exact-rate"');
  const scopedPrice = {
    ...price,
    matching: inferenceMatchData(createPricingSnapshot(bedrock), [
      {
        ...regional,
        fixed_selectors: [
          ...regional.fixed_selectors,
          ...regionalSelectors().filter(
            ({ dimension }) => !["operation", "cache_ttl_seconds"].includes(dimension.value),
          ),
        ],
      },
    ]),
  };
  expect(queryWebsiteInferencePrice(scopedPrice, [], at).missing_conditions.toSorted()).toEqual([
    "Cache TTL",
    "Operation",
  ]);
  const resolved = await renderComponent(InferencePrices, {
    modelRef,
    prices: [scopedPrice],
    offers,
  });
  expect(resolved).toContain('class="exact-rate"');
  expect(resolved).not.toContain("Price scope");
  expect(resolved).not.toContain("<output");
  expect(resolved).not.toContain("Cache TTL");
  expect(resolved).toContain("$66");
  expect(resolved).not.toMatch(/<select\b|role="radiogroup"/);
  expect(resolved).not.toContain('aria-label="Pricing options"');
});
it("shares pricing across equivalent inference IDs and keeps different fixed scopes selectable", async () => {
  const pair = fixturePairs.get("amazon-bedrock");
  if (!pair) throw new Error("Missing Bedrock fixture pair");
  const us = profileRule("us");
  const alias = rule(bedrock, "us-profile-alias", us.model_ref, us.fixed_selectors);
  const global = profileRule("global");
  const results = websiteInferencePrices(
    pair.catalog,
    pair.envelope,
    mapping(bedrock, [us, alias, global]),
  );
  const prices = results.get(us.model_ref) ?? [];
  const website = websitePublication(pair.catalog, pair.envelope.data, "a".repeat(64), results);
  const offers = website.offers.flatMap(({ offers }) => offers);
  const equivalent = await renderComponent(InferencePrices, {
    modelRef: us.model_ref,
    prices: prices.filter(({ model_id }) => model_id !== global.model_id),
    offers,
  });
  expect(equivalent).not.toContain('id="inference-model-id"');
  expect(equivalent).toContain(`Copy inference model ID ${us.model_id}`);
  expect(equivalent).toContain(`Copy inference model ID ${alias.model_id}`);
  expect(equivalent).toContain("to see rates.");
  const mixed = await renderComponent(InferencePrices, {
    modelRef: us.model_ref,
    prices: prices.toReversed(),
    offers,
  });
  expect(mixed).toContain('id="inference-model-id"');
  for (const { model_id } of [global, us, alias]) {
    expect(mixed).toContain(`value="${model_id}"`);
  }
  expect(mixed).not.toContain("Choose inference model ID");
  expect(mixed).toContain(`aria-label="Copy inference model ID ${global.model_id}"`);
  expect(mixed).not.toContain(`aria-label="Copy inference model ID ${us.model_id}"`);
  expect(mixed).not.toContain(`>${global.model_id}</code>`);
  expect(mixed).toContain("#ui-copy");
  expect(mixed).not.toContain(">Copy<");
});
it("links a chosen condition value back to the inference IDs that publish it", () => {
  const pair = fixturePairs.get("amazon-bedrock");
  if (!pair) throw new Error("Missing Bedrock fixture pair");
  const us = profileRule("us");
  const global = profileRule("global");
  const prices =
    websiteInferencePrices(pair.catalog, pair.envelope, mapping(bedrock, [us, global])).get(
      us.model_ref,
    ) ?? [];
  const domains = inferenceIdConditionDomains(prices, at);
  const regions = (modelId: string) => {
    const option = domains.get(modelId)?.find(({ dimension }) => dimension.value === "region");
    return option?.kind === "categorical" ? option.values : [];
  };
  const usRegions = regions(us.model_id);
  const globalOnly = regions(global.model_id).find(
    ({ key }) => !usRegions.some((region) => region.key === key),
  );
  const shared = usRegions.find(({ key }) =>
    regions(global.model_id).some((region) => region.key === key),
  );
  if (shared === undefined || globalOnly === undefined)
    throw new Error("Bedrock fixture lacks shared and Global-only Regions");
  const dimension = { namespace: "kmodels", value: "region" } as const;
  const choose = ({ value }: { value: (typeof shared)["value"] }) => [
    { kind: "categorical" as const, dimension, value },
  ];

  expect(compatibleInferenceIds(prices, domains, [])).toEqual(
    prices.map(({ model_id }) => model_id),
  );
  expect(compatibleInferenceIds(prices, domains, choose(shared)).toSorted()).toEqual(
    [us.model_id, global.model_id].toSorted(),
  );
  expect(compatibleInferenceIds(prices, domains, choose(globalOnly))).toEqual([global.model_id]);

  // The US ID's Region control offers every linked value so a Global-only Region stays selectable.
  const usPrice = prices.find(({ model_id }) => model_id === us.model_id);
  const source = usPrice?.pricing_options?.find((option) => option.dimension.value === "region");
  const option = domains
    .get(us.model_id)
    ?.find((selector) => selector.dimension.value === "region");
  if (source === undefined || option === undefined) throw new Error("Missing US Region option");
  const linked = linkedConditionValues(source, option, domains);
  expect(linked.kind === "categorical" && linked.values.map(({ key }) => key)).toContain(
    globalOnly.key,
  );
});
it("keeps interactive regional selection, exclusions and displayed rows aligned with public lookup", () => {
  const pair = fixturePairs.get("amazon-bedrock");
  if (!pair) throw new Error("Missing Bedrock fixture pair");
  const mapped = mapping(bedrock, [profileRule("us"), profileRule("global")]);
  const lookup = createInferencePriceLookup(bedrock, mapped);
  const rows = websiteInferencePrices(pair.catalog, pair.envelope, mapped);
  const prices = rows.get("amazon-bedrock/openai.gpt-6-astra") ?? [];
  const website = websitePublication(pair.catalog, pair.envelope.data, "a".repeat(64), rows);
  const offers = website.offers.flatMap(({ offers }) => offers);
  const selected = regionalSelectors();
  const excluded = selected.map((selector): Selector =>
    selector.dimension.value === "region"
      ? {
          kind: "categorical",
          dimension: selector.dimension,
          value: { namespace: "provider", provider_id: "amazon-bedrock", value: "eu-north-1" },
        }
      : selector,
  );
  for (const model_id of ["us.openai.gpt-6-astra", "global.openai.gpt-6-astra"]) {
    const price = prices.find((price) => price.model_id === model_id);
    if (!price) throw new Error(`Missing ${model_id}`);
    for (const selectors of [[], selected.slice(0, 1), selected, excluded]) {
      const expected = lookup({
        provider_id: "amazon-bedrock",
        model_id,
        selectors,
        evaluated_at: at,
      });
      const actual = queryWebsiteInferencePrice(price, selectors, at);
      expect(actual.status).toBe(expected.status);
      expect(actual.reason).toBe(expected.reason);
      expect(actual.missing_conditions).toEqual(expected.missing_conditions.map(formatDimension));
      if (actual.status === "matched") {
        const rates = actual.candidates.flatMap(
          (candidate) =>
            offers
              .find(({ id }) => id === candidate.offer_ref)
              ?.rates.filter(
                ({ key, label }) => candidate.row_keys?.includes(key) && label === "Input text",
              ) ?? [],
        );
        expect(rates.length).toBeGreaterThan(0);
        expect(
          rates.every(({ amount }) => amount === (model_id.startsWith("us.") ? "$66" : "$60")),
        ).toBe(true);
      }
      if (actual.reason === "no_applicable_price") expect(actual.candidates).toEqual([]);
    }
    const serialized = JSON.stringify(price.matching);
    for (const forbidden of [
      "evidence",
      "content_hash",
      "source_ref",
      "observations",
      "locator",
      '"price"',
      '"charge_binding"',
    ])
      expect(serialized).not.toContain(forbidden);
  }
  const regional = prices.find(({ model_id }) => model_id === "us.openai.gpt-6-astra");
  const bucket = regional?.pricing_options?.find(
    ({ dimension, kind }) => dimension.value === "context_tokens" && kind === "decimal_buckets",
  );
  if (!regional || bucket?.kind !== "decimal_buckets" || bucket.values[0] === undefined)
    throw new Error("Missing published context bucket");
  const range = pricingSelection(bucket, bucket.values[0].key);
  if (!range) throw new Error("Missing range selection");
  const bucketResult = queryWebsiteInferencePrice(
    regional,
    [...selected.filter(({ dimension }) => dimension.value !== "context_tokens"), range],
    at,
  );
  expect(bucketResult.status).toBe("matched");
  expect(bucketResult.missing_conditions).toEqual([]);
});
it("preserves price conflicts and time exclusions in the audit-free UI matcher", () => {
  for (const scenario of ["conflict", "expired", "imprecise"] as const) {
    const data = structuredClone(typesafe);
    const offer = data.providers[0]?.books[0]?.offers[0];
    const rate = offer?.terms.find(
      (term) => term.kind === "rate" && term.meter.value === "input_text",
    );
    if (!offer || rate?.kind !== "rate") throw new Error("Missing test rate");
    const original = rate.variants[0];
    if (!original) throw new Error("Missing test variant");
    if (scenario === "conflict")
      rate.variants.push({
        ...structuredClone(original),
        price: { ...original.price, value: { numerator: "1", denominator: "1" } },
      });
    else
      for (const term of offer.terms) {
        if (term.kind !== "rate") continue;
        for (const variant of term.variants)
          variant.validity =
            scenario === "expired"
              ? { until: { value: "2026-01-01T00:00:00.000Z", precision: "datetime" } }
              : { from: { value: "2026-10", precision: "month" } };
      }
    const rule = typesafeRule();
    const result = createInferencePriceLookup(
      data,
      mapping(data, [rule]),
    )({ provider_id: "typesafe", model_id: rule.model_id, evaluated_at: at });
    const price = {
      ...websiteInferencePrice(result),
      matching: inferenceMatchData(createPricingSnapshot(data), [rule]),
    };
    const ui = queryWebsiteInferencePrice(price, [], at);
    expect(ui.status).toBe(result.status);
    expect(ui.reason).toBe(result.reason);
    if (scenario === "conflict") expect(ui.explanation).toContain("conflict");
    if (scenario === "expired") expect(ui.candidates).toEqual([]);
    if (scenario === "imprecise") {
      expect(ui.status).toBe("candidates");
      expect(ui.explanation).toContain("Price validity is not fully established");
    }
  }
});
it("returns the underlying rates for a contribution and retains unresolved target evidence", async () => {
  const suite = lookupFixtureSchema.parse(JSON.parse(await fixture("pricing/lookup.json")));
  for (const name of ["contribution", "contribution-raw-target"]) {
    const data = suite.datasets[name];
    const provider = data?.providers[0];
    const book = provider?.books[0];
    const offer = book?.offers[0];
    const modelRef = book?.scope.model_refs[0];
    if (!data || !provider || !book || !offer || !modelRef)
      throw new Error("Missing contributed price fixture");
    const result = createInferencePriceLookup(
      data,
      mapping(data, [
        {
          provider_id: provider.snapshot.provider_id,
          model_id: "actual-id",
          model_ref: modelRef,
          offer_refs: [offer.id],
          fixed_selectors: [],
          evidence: book.evidence,
        },
      ]),
    )({ provider_id: provider.snapshot.provider_id, model_id: "actual-id" });
    const referenced = result.candidates.flatMap(({ referenced_rates }) => referenced_rates);
    expect(referenced).toHaveLength(1);
    if (name === "contribution") {
      expect(referenced[0]?.variants.length).toBeGreaterThan(0);
      expect(result.candidates.flatMap(({ gaps }) => gaps)).not.toContainEqual(
        expect.objectContaining({ code: "unsupported_structure" }),
      );
    } else {
      expect(result.status).toBe("candidates");
      expect(result.candidates.flatMap(({ gaps }) => gaps)).toContainEqual(
        expect.objectContaining({ code: "conflicting_variants", reason: "conflicting_values" }),
      );
    }
  }
});
