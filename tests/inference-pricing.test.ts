import { readFile } from "node:fs/promises";
import { beforeAll, expect, it } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";
import { publishedModel } from "../src/catalog/pricing-source.ts";
import { manifests, type SourceManifest } from "../src/catalog/manifests.ts";
import { sha256 } from "../src/catalog/io.ts";
import { calculationExport } from "../src/catalog/pricing-calculator-export.ts";
import { createPricingCatalogEnvelope } from "../src/catalog/pricing-envelope.ts";
import { catalogSchema, type Catalog } from "../src/catalog/schema.ts";
import { createInferencePriceLookup } from "../src/pricing/inference.ts";
import type { InferencePriceMapping, InferencePriceRule } from "../src/pricing/inference-schema.ts";
import type { CalculationEnvelope, Selector } from "../src/pricing/schema.ts";
import { prepareCatalogPair } from "../src/catalog/pricing-publication.ts";
import {
  websiteInferencePrices,
  websiteInferencePrice,
} from "../src/catalog/website-inference-pricing.ts";
import { websitePublication } from "../src/catalog/website-data.ts";
import { projectCatalogPair } from "../src/catalog/projections.ts";
import type { PricingCatalogEnvelope } from "../src/catalog/pricing-schema.ts";
import { renderComponent } from "./render-component.ts";
import InferencePrices from "../src/components/InferencePrices.vue";
import { conformanceSchema } from "./pricing-conformance.ts";
import { queryWebsiteInferencePrice } from "../src/catalog/inference-price-presentation.ts";
import { inferenceMatchData } from "../src/pricing/inference-matching-data.ts";
import { createPricingSnapshot } from "../src/pricing/snapshot.ts";
import { formatDimension } from "../src/catalog/pricing-presentation.ts";
import { pricingSelection } from "../src/catalog/pricing-selector-input.ts";

const at = "2026-10-30T00:00:00.000Z";
const fixture = (name: string) => readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const fixturePairs = new Map<string, { catalog: Catalog; envelope: PricingCatalogEnvelope }>();

async function prices(providerId: string, body: string): Promise<CalculationEnvelope> {
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
  return calculationExport(catalog, envelope);
}

let typesafe: CalculationEnvelope;
let bedrock: CalculationEnvelope;
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
  data: CalculationEnvelope,
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

function mapping(data: CalculationEnvelope, rules: InferencePriceRule[]): InferencePriceMapping {
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

it("does not require usage acquisition or charge binding just to identify a published price", () => {
  const data = structuredClone(typesafe);
  for (const provider of data.providers)
    for (const book of provider.books)
      for (const offer of book.offers)
        for (const term of offer.terms) {
          if (term.kind === "rate")
            for (const variant of term.variants) delete variant.charge_binding;
        }
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

it("returns all commercial offers when the ID alone does not choose one", () => {
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
  const result = createInferencePriceLookup(
    data,
    mapping(data, [association]),
  )({ provider_id: "typesafe", model_id: "jev-1.13.0" });
  expect(result.status).toBe("candidates");
  expect(result.requires_offer_choice).toBe(true);
  expect(result.candidates.map(({ offer }) => offer.id).sort()).toEqual(
    [original.id, alternative.id].sort(),
  );
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

it("isolates reusable lookup inputs and results from caller mutation", () => {
  const data = structuredClone(typesafe);
  const associations = mapping(data, [typesafeRule()]);
  const lookup = createInferencePriceLookup(data, associations);
  const query = { provider_id: "typesafe", model_id: "jev-1.13.0" };
  const original = lookup(query);
  const changed = lookup(query);
  changed.candidates.length = 0;
  associations.rules.length = 0;
  data.providers.length = 0;
  expect(lookup(query)).toEqual(original);
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
  const sourceUrls = new Map(
    bedrock.providers.flatMap(({ sources }) => sources.map(({ id, url }) => [id, url] as const)),
  );
  for (const [result, title] of [
    [excluded, "No applicable prices"],
    [unknown, "Price mapping unknown"],
  ] as const) {
    const projected = websiteInferencePrice(result, sourceUrls);
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
  expect(rows?.find(({ model_id }) => model_id === "openai.gpt-6-astra")?.status).toBe("unknown");
  const website = websitePublication(pair.catalog, pair.envelope.data, "a".repeat(64), results);
  const detail = website.details
    .flatMap(({ details }) => details)
    .find(({ model_ref }) => model_ref === "amazon-bedrock/openai.gpt-6-astra");
  expect(detail?.inference_prices).toEqual(rows);
  if (!regional) throw new Error("Missing regional result");
  const html = await renderComponent(InferencePrices, {
    modelRef: "amazon-bedrock/openai.gpt-6-astra",
    prices: [regional],
    offers: website.offers.flatMap(({ offers }) => offers),
  });
  expect(html).toContain("us.openai.gpt-6-astra");
  expect(html).toContain("Candidate prices");
  expect(html).toContain("$66");
  expect(html).toContain("Geo cross region");
  expect(html).toContain("Mapping evidence");
  expect(html).not.toContain("Inspect target");
  expect(html).not.toContain("Task and documented scope");
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
  for (const model_id of [
    "us.openai.gpt-6-astra",
    "global.openai.gpt-6-astra",
    "openai.gpt-6-astra",
  ]) {
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

it("preserves accounting conflicts and time exclusions in the audit-free UI matcher", () => {
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
      ...websiteInferencePrice(result, new Map()),
      matching: inferenceMatchData(createPricingSnapshot(data), [rule]),
    };
    const ui = queryWebsiteInferencePrice(price, [], at);
    expect(ui.status).toBe(result.status);
    expect(ui.reason).toBe(result.reason);
    if (scenario === "conflict") expect(ui.explanation).toContain("conflict");
    if (scenario === "expired") expect(ui.candidates).toEqual([]);
    if (scenario === "imprecise") expect(ui.explanation).toContain("incomplete");
  }
});

it("returns the underlying rates for a contribution and retains unresolved target evidence", async () => {
  const suite = conformanceSchema.parse(JSON.parse(await fixture("calculator/conformance.json")));
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
        expect.objectContaining({ code: "unsupported_structure" }),
      );
    }
  }
});
