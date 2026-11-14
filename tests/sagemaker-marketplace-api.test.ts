import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";
import { load } from "cheerio";
import { manifests, type SourceManifest } from "../src/catalog/manifests.ts";
import { parseSource } from "../src/catalog/adapters.ts";
import { normalizeSagemakerMarketplaceApi } from "../src/catalog/sagemaker-pricing.ts";
import { fetchSagemakerMarketplaceApi } from "../src/catalog/sagemaker-marketplace-api.ts";
import { sha256 } from "../src/catalog/io.ts";
import { projectSagemakerSpec } from "../src/catalog/sagemaker-sdk.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";
import { providerModelSchema } from "../src/catalog/schema.ts";
import { websiteModelDetail } from "../src/catalog/website-data.ts";
import { prepareCatalogPair } from "../src/catalog/pricing-publication.ts";
import { priceDataExport } from "../src/catalog/pricing-lookup-export.ts";
import { createCommercialPriceLookup } from "../src/pricing/commercial.ts";
import type { PricingReconciliationItem } from "../src/catalog/pricing-reconciliation.ts";

const aws = vi.hoisted(() => ({ sign: vi.fn(), destroy: vi.fn() }));
vi.mock("@aws-sdk/client-sagemaker", () => ({
  SageMakerClient: class {
    config = { signer: async () => ({ sign: aws.sign }) };
    destroy = aws.destroy;
  },
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const manifest = manifests.find(({ provider }) => provider.id === "amazon-sagemaker");
if (!manifest) throw new Error("Missing SageMaker manifest");
const provider = { ...manifest.provider, source_ids: manifest.sources.map(({ id }) => id) };
const apiSource = manifest.sources.find(({ id }) => id === "sagemaker-marketplace-api");
const sdkSource = manifest.sources.find(({ id }) => id === "sagemaker-sdk");
if (!apiSource || !sdkSource) throw new Error("Missing SageMaker sources");
const source: SourceManifest = apiSource;
const sdk: SourceManifest = sdkSource;
const observedAt = "2026-11-14T00:00:00.000Z";
const fixture = z
  .object({ listingId: z.string(), summary: z.record(z.string(), z.unknown()) })
  .parse(
    JSON.parse(
      await readFile(new URL("./fixtures/sagemaker-polyai-pricing.json", import.meta.url), "utf8"),
    ),
  );
const generation = z
  .object({
    manifest: z.array(z.unknown()),
    spec: z
      .object({
        model_id: z.string(),
        version: z.string(),
        listing_id: z.string(),
      })
      .passthrough(),
  })
  .parse(
    JSON.parse(
      await readFile(
        new URL("./fixtures/sagemaker-polyai-generation.json", import.meta.url),
        "utf8",
      ),
    ),
  );
const catalog = await readFile(
  new URL("./fixtures/sagemaker-models.html", import.meta.url),
  "utf8",
);
const models = parseSource({
  provider,
  source: sdk,
  body: JSON.stringify([
    projectSagemakerSpec(JSON.stringify(generation.spec), {
      ...generation.spec,
      search_keywords: ["Audio2Text", "Generation"],
    }),
  ]),
  observedAt,
}).models;
function wire(summary: unknown = fixture.summary, extra: object = {}, id = fixture.listingId) {
  return {
    ViewQuery: { Name: "listingPricingSummaryByListingId", Version: 1 },
    ListingView: JSON.stringify({
      data: { listing: { id, listingDetail: { pricing: { summary } } } },
      ...extra,
    }),
  };
}
function parse(
  body = normalizeSagemakerMarketplaceApi(wire(), fixture.listingId),
  items: PricingReconciliationItem[] = [],
) {
  return parseSource({
    provider,
    source,
    observedAt,
    catalogModels: models,
    body: JSON.stringify({ specs: [generation.spec], listings: [{ id: fixture.listingId, body }] }),
    onPricingReconciliation: (item) => items.push(item),
  });
}
describe("SageMaker default Marketplace API pricing", () => {
  it("strips agreement/session metadata and preserves exact public monetary fields", () => {
    const body = normalizeSagemakerMarketplaceApi(
      wire({
        ...fixture.summary,
        agreementToken: "PRIVATE_FIXTURE_TOKEN",
        offerId: "PRIVATE_FIXTURE_OFFER",
        authoredDate: "2026-11-01T00:00:00Z",
      }),
      fixture.listingId,
    );
    expect(body).not.toContain("PRIVATE_FIXTURE");
    expect(body).not.toContain("authoredDate");
    expect(JSON.parse(body)).toMatchObject({ status: "available", terms: fixture.summary.terms });
  });
  it.each([
    { sourceAgreementId: "PRIVATE_FIXTURE_AGREEMENT" },
    { amendmentAgreementId: "PRIVATE_FIXTURE_AMENDMENT" },
    { offerSetSummary: { offers: [] } },
    { offerName: "Private offer" },
    { badges: [{ badgeName: "PrivateOffer", badgeValue: "true" }] },
    { availabilityEndDate: "2026-12-01T00:00:00Z" },
  ])("withholds a quote with unresolved default scope: %j", (patch) => {
    const body = normalizeSagemakerMarketplaceApi(
      wire({ ...fixture.summary, ...patch }),
      fixture.listingId,
    );
    expect(JSON.parse(body)).toEqual({
      listing_id: fixture.listingId,
      terms: [],
      status: "scope_unresolved",
    });
    const items: PricingReconciliationItem[] = [];
    expect(parse(body, items).commercial_facts).toEqual([]);
    expect(items).toContainEqual({
      disposition: "unresolved",
      reason_code: "sagemaker_marketplace_default_scope_unresolved",
    });
  });
  it("distinguishes an upfront-only contract, unavailable data and an unknown term", () => {
    for (const [terms, status] of [
      [[{ termType: "FixedUpfrontPricingTerm" }], "no_usage_tariff"],
      [[{ termType: "LegalTerm" }], "unavailable"],
      [[{ termType: "FuturePricingTerm" }], "scope_unresolved"],
    ]) {
      const body = normalizeSagemakerMarketplaceApi(
        wire({ ...fixture.summary, terms }),
        fixture.listingId,
      );
      expect(JSON.parse(body).status).toBe(status);
      expect(parse(body).commercial_facts).toEqual([]);
    }
    expect(
      JSON.parse(normalizeSagemakerMarketplaceApi(wire(null), fixture.listingId)),
    ).toMatchObject({ status: "unavailable", terms: [] });
  });
  it("retains an explicit coverage gap when a usage term has no rate cards", () => {
    const body = normalizeSagemakerMarketplaceApi(
      wire({
        ...fixture.summary,
        terms: [
          {
            termType: "UsageBasedPricingTerm",
            currencyCode: "USD",
            rateCards: [],
            rateCardCount: 0,
            totalRateCards: 0,
          },
        ],
      }),
      fixture.listingId,
    );
    const items: PricingReconciliationItem[] = [];
    expect(parse(body, items).commercial_facts).toEqual([]);
    expect(items).toContainEqual({
      disposition: "unresolved",
      reason_code: "sagemaker_marketplace_public_pricing_unavailable",
    });
  });
  it("requires exact query/listing identity and complete known arrays", () => {
    expect(() =>
      normalizeSagemakerMarketplaceApi(
        { ...wire(), ViewQuery: { Name: "listingWithOfferDetail", Version: 1 } },
        fixture.listingId,
      ),
    ).toThrow();
    expect(() =>
      normalizeSagemakerMarketplaceApi(
        wire(fixture.summary, {}, "prodview-other"),
        fixture.listingId,
      ),
    ).toThrow(/identity/);
    expect(() =>
      normalizeSagemakerMarketplaceApi(
        wire(fixture.summary, { errors: [{ message: "partial" }] }),
        fixture.listingId,
      ),
    ).toThrow(/partial/);
    const body = JSON.parse(normalizeSagemakerMarketplaceApi(wire(), fixture.listingId));
    body.terms[0].totalRateCards++;
    expect(() => parse(JSON.stringify(body))).toThrow(/truncated/);
    expect(() =>
      parseSource({
        provider,
        source,
        observedAt,
        catalogModels: [],
        body: JSON.stringify({ specs: [generation.spec], listings: [] }),
      }),
    ).toThrow(/catalog scope/);
  });
  it("keeps known usage siblings when a new non-usage term appears", () => {
    const terms = z.array(z.unknown()).parse(fixture.summary.terms);
    const body = normalizeSagemakerMarketplaceApi(
      wire({ ...fixture.summary, terms: [...terms, { termType: "FuturePricingTerm" }] }),
      fixture.listingId,
    );
    const items: PricingReconciliationItem[] = [];
    expect(parse(body, items).commercial_facts?.flatMap((f) => f.price_facts)).toHaveLength(2);
    expect(items).toContainEqual({
      disposition: "unsupported",
      reason_code: "sagemaker_marketplace_non_usage_term",
    });
  });
  it("publishes PolyAI software capacity through canonical lookup and model details", () => {
    const parsed = parse();
    expect(parsed.models).toEqual([]);
    expect(parsed.commercial_facts?.flatMap((f) => f.price_facts).map((f) => f.price)).toEqual([
      "45.00000000",
      "110.00000000",
    ]);
    const partition = assembleParsedProviderPricing(
      provider.id,
      observedAt,
      [{ source, ...parsed }],
      models,
      manifest.pricingCategoricalLabels,
    );
    if (!partition) throw new Error("Missing pricing partition");
    const pricing = {
      provider_vocabularies: [partition.vocabulary],
      provider_snapshots: [partition.snapshot],
      model_dispositions: partition.model_dispositions,
      books: partition.books,
    };
    const core = {
      catalog_version: "a".repeat(64),
      generated_at: observedAt,
      providers: [provider],
      models: models.map((m) => providerModelSchema.parse(m)),
      sources: [source, sdk].map((entry) => ({
        id: entry.id,
        provider_id: provider.id,
        url: entry.url,
        source: entry.source ?? [entry.type],
        stability: entry.stability,
        scope: "global" as const,
        exhaustive: false,
        role: entry.role ?? "catalog",
        field_paths: entry.fields,
        observed_at: observedAt,
        content_hash: "1".repeat(64),
        extractor_version: entry.extractorVersion,
        ...(entry.pricingEvidence === undefined ? {} : { pricing_evidence: entry.pricingEvidence }),
      })),
      coverage: [],
      warnings: [],
    };
    const pair = prepareCatalogPair(core, pricing);
    const lookup = createCommercialPriceLookup(priceDataExport(pair.catalog, pair.pricing), {
      core_catalog_version: pair.catalog.catalog_version,
      pricing_data_version: pair.pricing.pricing_data_version,
      sources: [],
      rules: [],
    });
    const book = partition.books.find(
      (b) =>
        b.scope.kind === "provider_resource" &&
        b.scope.resource_key === `marketplace-software-${fixture.listingId}`,
    );
    if (!book) throw new Error("Missing software capacity");
    const answer = lookup({
      subject: { kind: "resource", provider_id: provider.id, book_ref: book.id },
    });
    expect(answer.candidates).toHaveLength(1);
    const model = core.models.find((m) => m.model_id === "polyai-dialog-rsn-1");
    if (!model) throw new Error("Missing PolyAI model");
    const detail = websiteModelDetail(pricing, model).pricing;
    expect(detail?.offers.filter((o) => o.group === "capacity")).toHaveLength(1);
    expect(detail?.offers[0]?.rates).toHaveLength(2);
    expect(JSON.stringify(detail)).not.toContain("120.00000000");
    expect(JSON.stringify(detail)).toContain("ml.p4d.24xlarge");
    expect(JSON.stringify(detail)).toContain("ml.p5.48xlarge");
  });
});

it.each([200, 404] as const)(
  "acquires the bounded SDK-selected default listing with HTTP %s",
  async (status) => {
    const publicReads: object[] = [];
    const $ = load(catalog);
    const panel = $("dd[tab-id^='proprietary-models-']");
    panel.attr("tab-id", "proprietary-models-(0)");
    panel
      .find("tr")
      .filter((_index, row) => $(row).find("td").length > 0)
      .remove();
    const read = async (input: typeof source) => {
      publicReads.push(input);
      const body =
        input.url === source.url
          ? ""
          : input.url.includes("proprietary-sdk-manifest")
            ? JSON.stringify(generation.manifest)
            : input.url.includes("proprietary_specs_")
              ? JSON.stringify(generation.spec)
              : $.html();
      return { body, contentHash: sha256(body), etag: undefined, lastModified: undefined };
    };
    aws.sign.mockImplementation(async (request) => ({
      ...request,
      headers: { ...request.headers, authorization: "PRIVATE_FIXTURE_SIGNATURE" },
    }));
    const nativeFetch = vi.fn(async () => new Response(JSON.stringify(wire()), { status }));
    vi.stubGlobal("fetch", nativeFetch);
    const queries: unknown[] = [];
    const fetched = await fetchSagemakerMarketplaceApi(source, read, async (body, send) => {
      queries.push(JSON.parse(body));
      const response = await send();
      return {
        body: await response.text(),
        contentHash: "b".repeat(64),
        etag: undefined,
        lastModified: undefined,
        status,
      };
    });
    expect(publicReads).toHaveLength(3);
    expect(publicReads.every((input) => !Object.hasOwn(input, "auth"))).toBe(true);
    expect(queries).toEqual([
      {
        ViewQuery: { Name: "listingPricingSummaryByListingId", Version: 1 },
        Parameters: JSON.stringify({ listingId: fixture.listingId, id: fixture.listingId }),
        RequestContext: { IntegrationId: "integ-v27la47re4rlo", Locale: "en" },
        ExecutionSemantics: "ALL_OR_NOTHING",
      },
    ]);
    expect(aws.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        hostname: "discovery.marketplace.us-east-1.amazonaws.com",
        path: "/GetListingView",
        method: "POST",
      }),
      { signingRegion: "us-east-1", signingService: "aws-marketplace" },
    );
    expect(nativeFetch).toHaveBeenCalledWith(
      source.url,
      expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) }),
    );
    expect(fetched.body).not.toContain("PRIVATE_FIXTURE");
    expect(fetched.dependencies).toHaveLength(4);
    expect(JSON.parse(JSON.parse(fetched.body).listings[0].body).status).toBe(
      status === 200 ? "available" : "unavailable",
    );
    expect(aws.destroy).toHaveBeenCalledOnce();
  },
);
