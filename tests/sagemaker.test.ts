import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vite-plus/test";
import { manifests, type SourceManifest } from "../src/catalog/manifests.ts";
import { parseSource } from "../src/catalog/adapters.ts";
import { normalizeSagemakerMarketplace } from "../src/catalog/sagemaker-pricing.ts";
import { sagemakerPricingSpecs, sagemakerRows } from "../src/catalog/sagemaker.ts";
import { fetchSagemakerInventory } from "../src/catalog/sagemaker-api.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";
import { validatePricingCatalog } from "../src/catalog/pricing-validation.ts";
import { validateAdoptedTopology } from "../src/catalog/pricing-adopted-topology.ts";
import { evaluateRateCost } from "../src/catalog/pricing-calculation.ts";
import type { PricingReconciliationItem } from "../src/catalog/pricing-reconciliation.ts";

const aws = vi.hoisted(() => ({ send: vi.fn(), destroy: vi.fn() }));
vi.mock("@aws-sdk/client-sagemaker", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@aws-sdk/client-sagemaker")>()),
  SageMakerClient: class {
    send = aws.send;
    destroy = aws.destroy;
  },
}));

const manifest = manifests.find(({ provider }) => provider.id === "amazon-sagemaker");
if (manifest === undefined) throw new Error("SageMaker manifest missing");
const provider = { ...manifest.provider, source_ids: manifest.sources.map(({ id }) => id) };
const labels = manifest.pricingCategoricalLabels;
function source(id: string): SourceManifest {
  const result = manifest?.sources.find((source) => source.id === id);
  if (result === undefined) throw new Error(`Missing source ${id}`);
  return result;
}
const observedAt = "2026-09-21T00:00:00.000Z";
const catalog = await readFile(
  new URL("./fixtures/sagemaker-models.html", import.meta.url),
  "utf8",
);
const prices = await readFile(new URL("./fixtures/sagemaker-prices.json", import.meta.url), "utf8");
const specs = [
  { model_id: "fixture-speech", version: "0.0.1", listing_id: "prodview-speech" },
  { model_id: "fixture-embedding", version: "LLM 1.14", listing_id: "prodview-embedding" },
];

function card(price: string, overrides: object = {}) {
  return {
    dimensionKey: "inference.count.m.i.c",
    displayName: "Real-time inference",
    description: "Publisher-metered inference",
    unit: "Requests",
    price,
    dimensionLabels: [{ type: "SAGEMAKER_OPTION", value: "Model Real-Time Inference" }],
    regionalPrices: [],
    ...overrides,
  };
}
function term(cards: object[]) {
  return {
    termType: "UsageBasedPricingTerm",
    currencyCode: "USD",
    rateCards: cards,
    rateCardCount: cards.length,
    totalRateCards: cards.length,
  };
}
function page(id: string, terms: object[]) {
  return { id, body: JSON.stringify({ listing_id: id, terms }) };
}
function bundle(overrides: object = {}) {
  return JSON.stringify({
    catalog,
    prices,
    specs,
    listings: [
      page("prodview-speech", [
        term([
          card("6.00000000"),
          card("2", { dimensionKey: "ml.g5.2xlarge.m.i.h", unit: "HostHrs" }),
        ]),
      ]),
      page("prodview-embedding", [term([card("0.00000000")])]),
    ],
    ...overrides,
  });
}
function parsePricing(body = bundle(), items: PricingReconciliationItem[] = []) {
  return parseSource({
    provider,
    source: source("sagemaker-pricing"),
    body,
    observedAt,
    onPricingReconciliation: (item) => items.push(item),
  });
}

describe("SageMaker foundation catalog", () => {
  it("admits only the two foundation sections and preserves unknown task semantics", () => {
    const models = parseSource({
      provider,
      source: source("sagemaker-models"),
      body: catalog,
      observedAt,
    });
    expect(models.map(({ model_id }) => model_id)).toEqual([
      "meta-textgeneration-llama-3-1-8b-instruct",
      "fixture-forecast",
      "fixture-speech",
      "fixture-embedding",
    ]);
    expect(models[0]).toMatchObject({
      tasks: ["text_generation"],
      capabilities: { fine_tuning: true, streaming: "unknown" },
      modalities: { input: [], output: [] },
    });
    expect(models[1]).toMatchObject({ tasks: [], raw_type: "Forecasting" });
    expect(models[2]?.tasks).toEqual(["speech_synthesis"]);
    expect(models[3]?.tasks).toEqual(["embeddings"]);
    expect(
      models.every(
        (model) => model.version === undefined && model.account_availability === "unknown",
      ),
    ).toBe(true);
  });

  it("rejects missing sections, duplicate identities and truncated tables", () => {
    expect(() =>
      sagemakerRows(catalog.replace("open-weight-models-(2)", "open-weight-models-(3)")),
    ).toThrow("incomplete");
    expect(() => sagemakerRows(catalog.replace("proprietary-models-(2)", "other-(2)"))).toThrow(
      "section changed",
    );
    expect(() => sagemakerRows(catalog.replace("fixture-forecast", "fixture-speech"))).toThrow(
      "duplicated",
    );
  });

  it("uses the SDK version resolver only to discover exact listing-spec paths", () => {
    const headers = specs.map(({ model_id, version }) => ({
      model_id,
      version,
      spec_key: `proprietary-models/${model_id}/proprietary_specs_${version}.json`,
    }));
    expect(
      sagemakerPricingSpecs(JSON.stringify([...headers, headers[0]]), sagemakerRows(catalog)),
    ).toHaveLength(2);
    expect(() =>
      sagemakerPricingSpecs(
        JSON.stringify([{ ...headers[0], spec_key: "../../other.json" }, headers[1]]),
        sagemakerRows(catalog),
      ),
    ).toThrow("path changed identity");
    expect(() =>
      sagemakerPricingSpecs(JSON.stringify(headers.slice(1)), sagemakerRows(catalog)),
    ).toThrow("omitted");
    const speech = (version: string) => ({
      model_id: "fixture-speech",
      version,
      spec_key: `proprietary-models/fixture-speech/proprietary_specs_${version}.json`,
    });
    const resolve = (versions: string[]) =>
      sagemakerPricingSpecs(
        JSON.stringify([headers[1], ...versions.map(speech)]),
        sagemakerRows(catalog),
      ).find((header) => header.model_id === "fixture-speech")?.version;
    expect(resolve(["1.9", "1.10", "1.10rc1"])).toBe("1.10");
    expect(resolve(["v1.9", "v1.10", "SD3_5L_v1"])).toBe("v1.9");
    expect(resolve(["1.0", "1.0.0", "1.0"])).toBe("1.0");
    expect(resolve(["1.0.0", "1.0", "1.0.0"])).toBe("1.0.0");
  });
});

describe("SageMaker price books", () => {
  it("keeps numeric and raw infrastructure rates in their respective service books", () => {
    const items: PricingReconciliationItem[] = [];
    const models = parsePricing(
      bundle({
        prices: prices.replace('"USD": "0.00004"', '"USD": "0.00004", "EUR": "Contact sales"'),
      }),
      items,
    );
    const facts = models.flatMap((model) => model.commercial_facts ?? []);
    const data = facts.find((fact) => fact.resource_key === "endpoint-data-processing");
    const serverless = facts.find((fact) => fact.resource_key === "serverless-inference");
    if (data === undefined || serverless === undefined)
      throw new Error("Missing infrastructure books");
    expect(data.raw_price_facts).toEqual([]);
    expect(data.price_facts.map(({ meter, price, unit }) => ({ meter, price, unit }))).toEqual([
      { meter: "input_data", price: "0.016", unit: "sagemaker_data_gb" },
      { meter: "output_data", price: "0.016", unit: "sagemaker_data_gb" },
    ]);
    expect(serverless.price_facts.map(({ price, conditions }) => ({ price, conditions }))).toEqual([
      {
        price: "0.00004",
        conditions: {
          region: "us-east-1",
          effective_from: "2026-09-01T00:00:00Z",
          endpoint: "InvokeEndpoint",
          operation: "memory-2gb",
          service_tier: "on_demand",
        },
      },
      {
        price: "0.0000233",
        conditions: {
          region: "us-east-1",
          effective_from: "2026-09-01T00:00:00Z",
          endpoint: "InvokeEndpoint",
          operation: "memory-2gb",
          service_tier: "provisioned_execution",
        },
      },
    ]);
    expect(serverless.raw_price_facts).toHaveLength(1);
    expect(serverless.raw_price_facts[0]?.raw).toMatchObject({
      amount: "Contact sales",
      denomination: "EUR",
      unit: "seconds",
    });
    expect(items.slice(0, 4)).toEqual([
      { disposition: "normalized", reason_code: "sagemaker_public_invocation_meter" },
      { disposition: "normalized", reason_code: "sagemaker_public_invocation_meter" },
      { disposition: "raw", reason_code: "sagemaker_public_inference_structure" },
      { disposition: "normalized", reason_code: "sagemaker_public_invocation_meter" },
    ]);
  });

  it("keeps service charges separate, excludes capacity/training, and binds billable quantities", () => {
    const items: PricingReconciliationItem[] = [];
    const models = parsePricing(bundle(), items);
    const s = source("sagemaker-pricing");
    const partition = assembleParsedProviderPricing(
      provider.id,
      observedAt,
      [{ source: s, models }],
      models,
      labels,
    );
    if (partition === undefined) throw new Error("Missing SageMaker pricing partition");
    validateAdoptedTopology(partition);
    validatePricingCatalog(
      {
        provider_vocabularies: [partition.vocabulary],
        provider_snapshots: [partition.snapshot],
        model_dispositions: partition.model_dispositions,
        books: partition.books,
      },
      {
        providers: [provider],
        models,
        sources: [
          {
            id: s.id,
            provider_id: provider.id,
            url: s.url,
            source: s.source ?? [s.type],
            stability: s.stability,
            scope: "global",
            exhaustive: false,
            role: "overlay",
            field_paths: s.fields,
            ...(s.pricingEvidence === undefined ? {} : { pricing_evidence: s.pricingEvidence }),
            observed_at: observedAt,
            content_hash: "1".repeat(64),
            extractor_version: s.extractorVersion,
          },
        ],
      },
    );
    expect(partition.books).toHaveLength(4);
    const serverless = partition.books.find(
      (book) =>
        book.scope.kind === "provider_resource" &&
        book.scope.resource_key === "serverless-inference",
    );
    expect(serverless?.scope.model_refs).toEqual([]);
    expect(items.filter(({ disposition }) => disposition === "excluded")).toHaveLength(5);
    const speech = partition.books.find(
      (book) =>
        book.scope.kind === "provider_resource" &&
        book.scope.resource_key === "marketplace-prodview-speech",
    );
    expect(speech?.scope.model_refs).toEqual(["amazon-sagemaker/fixture-speech"]);
    const rate = speech?.offers
      .flatMap(({ terms }) => terms)
      .flatMap((term) => (term.kind === "rate" ? term.variants : []))[0];
    if (rate?.charge_binding === undefined) throw new Error("Missing inference charge binding");
    expect(
      evaluateRateCost(rate, [
        { signal: rate.charge_binding.signal, value: { numerator: "3", denominator: "1" } },
      ]),
    ).toMatchObject({ kind: "resolved", amount: { numerator: "18", denominator: "1" } });
    expect(evaluateRateCost(rate, [])).toMatchObject({ kind: "missing_input" });
    expect(models.every(({ pricing_state }) => pricing_state === "unknown")).toBe(true);
  });

  it("keeps unavailable public pricing unknown and preserves an unsupported inference unit as raw", () => {
    const items: PricingReconciliationItem[] = [];
    const models = parsePricing(
      bundle({
        listings: [
          page("prodview-speech", []),
          page("prodview-embedding", [term([card("0.22", { unit: "Tokens" })])]),
        ],
      }),
      items,
    );
    expect(items).toContainEqual({
      disposition: "unresolved",
      reason_code: "sagemaker_marketplace_public_pricing_unavailable",
    });
    expect(items).toContainEqual({
      disposition: "raw",
      reason_code: "sagemaker_marketplace_inference_structure",
    });
    const facts = models.flatMap((model) => model.commercial_facts ?? []);
    expect(facts.flatMap((fact) => fact.raw_price_facts)).toHaveLength(1);
    expect(
      facts.flatMap((fact) => fact.price_facts).some(({ meter }) => meter === "inference"),
    ).toBe(false);
  });

  it("rejects version-dependent listing joins, incomplete bundles, and truncated rate cards", () => {
    expect(() =>
      parsePricing(
        bundle({
          specs: [
            ...specs,
            { model_id: "fixture-speech", version: "2.0", listing_id: "prodview-other" },
          ],
        }),
      ),
    ).toThrow("association changed");
    expect(() => parsePricing(bundle({ listings: [] }))).toThrow("incomplete");
    expect(() =>
      parsePricing(
        bundle({
          listings: [
            page("prodview-speech", [{ ...term([card("6")]), totalRateCards: 2 }]),
            page("prodview-embedding", []),
          ],
        }),
      ),
    ).toThrow("truncated");
    const changed = parsePricing(
      bundle({ prices: prices.replace('"unit": "seconds"', '"unit": "Hours"') }),
    );
    expect(
      changed
        .flatMap((model) => model.commercial_facts ?? [])
        .flatMap((fact) => fact.raw_price_facts),
    ).toHaveLength(1);
  });

  it("extracts only the exact pricing query from Marketplace SSR state", () => {
    const state = {
      routeParams: { listingId: "prodview-speech" },
      sessionToken: "PRIVATE_FIXTURE",
      dehydratedState: {
        queries: [
          {
            queryKey: [
              "disco",
              "get-listing-view",
              { listingId: "prodview-speech", queryName: "Pricing" },
            ],
            state: {
              data: { summary: { terms: [term([card("6")])] }, agreementToken: "PRIVATE_FIXTURE" },
            },
          },
        ],
      },
    };
    const html = `<script id="vike_pageContext" type="application/json">${JSON.stringify(state)}</script>`;
    const normalized = normalizeSagemakerMarketplace(html, "prodview-speech");
    expect(normalized).not.toContain("PRIVATE_FIXTURE");
    expect(JSON.parse(normalized)).toMatchObject({
      listing_id: "prodview-speech",
      terms: [{ termType: "UsageBasedPricingTerm" }],
    });
    expect(() => normalizeSagemakerMarketplace(html, "prodview-other")).toThrow("identity changed");
    expect(() =>
      normalizeSagemakerMarketplace(html.replace('"terms":', '"missing":'), "prodview-speech"),
    ).toThrow();
    const unavailable = `<title>AWS Marketplace</title><script id="vike_pageContext">${JSON.stringify(
      {
        routeParams: { locale: "en" },
        pageId: "/lib/frontend/pages/ppV2/default",
        urlPathname: "/en/pp/default/index.html",
        dehydratedState: { queries: [] },
      },
    )}</script>`;
    expect(JSON.parse(normalizeSagemakerMarketplace(unavailable, "prodview-speech"))).toEqual({
      listing_id: "prodview-speech",
      terms: [],
    });
  });
});

describe("SageMaker public-hub projection", () => {
  it("links SDK-only foundation models to service pricing without admitting classic ML", () => {
    const openManifest = JSON.stringify([
      ...sagemakerRows(catalog)
        .filter((row) => !row.proprietary)
        .map((row) => ({
          model_id: row.id,
          version: "1.0",
          spec_key: `community_models/${row.id}/specs_v1.0.json`,
        })),
      ...["new-video", "excluded-classic"].map((id) => ({
        model_id: id,
        version: "1.0",
        spec_key: `community_models/${id}/specs_v1.0.json`,
        deprecated: false,
        search_keywords:
          id === "new-video" ? ["Foundation Models", "Text-to-Video"] : ["Classification"],
      })),
    ]);
    const models = parsePricing(bundle({ openManifest }));
    expect(models.some((model) => model.model_id === "excluded-classic")).toBe(false);
    expect(models.some((model) => model.model_id === "new-video")).toBe(true);
    const partition = assembleParsedProviderPricing(
      provider.id,
      observedAt,
      [{ source: source("sagemaker-pricing"), models }],
      models,
      labels,
    );
    const book = partition?.books.find(
      (book) =>
        book.scope.kind === "provider_resource" &&
        book.scope.resource_key === "endpoint-data-processing",
    );
    expect(book).toBeDefined();
    expect(book?.scope.model_refs).toContain("amazon-sagemaker/new-video");
  });

  it("paginates and projects only admitted model metadata without account resource fields", async () => {
    aws.send.mockReset();
    aws.destroy.mockClear();
    aws.send
      .mockResolvedValueOnce({
        HubContentSummaries: [{ HubContentName: "excluded-pretrained", HubContentVersion: "1.0" }],
        NextToken: "next",
      })
      .mockResolvedValueOnce({
        HubContentSummaries: [{ HubContentName: "fixture-speech", HubContentVersion: "2.0" }],
      })
      .mockResolvedValueOnce({
        HubContentName: "fixture-speech",
        HubContentVersion: "2.0",
        HubContentDisplayName: "Speech",
        HubContentDescription: "Published speech model",
        HubContentStatus: "Available",
        SupportStatus: "Supported",
        HubContentArn: "PRIVATE_FIXTURE",
        HubContentDocument: JSON.stringify({
          InputModalities: ["Text"],
          OutputModalities: ["Audio"],
          FineTuningSupported: false,
          Provider: "Publisher",
          License: "MIT",
          ContextWindow: "<4K",
          SupportedInferenceInstanceTypes: ["ml.g5.2xlarge"],
          ModelPackageArn: "PRIVATE_FIXTURE",
        }),
      });
    const body = await fetchSagemakerInventory(
      "us-west-2",
      new Set(sagemakerRows(catalog).map((row) => row.id)),
      4096,
    );
    expect(body).not.toContain("PRIVATE_FIXTURE");
    expect(aws.send).toHaveBeenCalledTimes(3);
    expect(aws.destroy).toHaveBeenCalledOnce();
    const models = parseSource({
      provider,
      source: source("sagemaker-api-us-west-2"),
      body,
      observedAt,
    });
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      model_id: "fixture-speech",
      scope: "regional_catalog",
      modalities: { input: ["text"], output: ["audio"] },
      availability: [{ region: "us-west-2", deployment_type: "jumpstart-endpoint" }],
      account_availability: "unknown",
      description: "Published speech model",
      model_card: { publisher: "Publisher", license: "MIT", context_window: "<4K" },
    });
    expect(() =>
      parseSource({
        provider,
        source: source("sagemaker-api-us-west-2"),
        body: body.replace("us-west-2", "us-east-1"),
        observedAt,
      }),
    ).toThrow("changed region");
  });

  it("rejects repeated pagination and always releases the AWS client", async () => {
    aws.send.mockReset();
    aws.destroy.mockClear();
    aws.send.mockResolvedValue({ HubContentSummaries: [], NextToken: "cycle" });
    await expect(
      fetchSagemakerInventory(
        "us-west-2",
        new Set(sagemakerRows(catalog).map((row) => row.id)),
        4096,
      ),
    ).rejects.toThrow("repeated a token");
    expect(aws.destroy).toHaveBeenCalledOnce();
  });
});
