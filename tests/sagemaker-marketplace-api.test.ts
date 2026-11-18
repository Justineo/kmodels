import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";
import { load } from "cheerio";
import { manifests, type ProviderManifest, type SourceManifest } from "../src/catalog/manifests.ts";
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
import { collectProvider } from "../src/catalog/collector.ts";
import {
  composeCatalogPair,
  type ComposedCatalogPair,
} from "../src/catalog/pricing-pair-transition.ts";
import { emptyPricingCatalog } from "../src/catalog/pricing-schema.ts";
import { failedPricingTransition } from "../src/catalog/pricing-transition.ts";
import { summarizeRefresh } from "../src/catalog/summary.ts";
import { refreshReport } from "../src/catalog/refresh-report.ts";
import {
  sagemakerCatalogUrl,
  sagemakerOpenManifestUrl,
  sagemakerRows,
} from "../src/catalog/sagemaker.ts";

const aws = vi.hoisted(() => ({ sign: vi.fn(), destroy: vi.fn(), curl: vi.fn() }));
vi.mock("@aws-sdk/client-sagemaker", () => ({
  SageMakerClient: class {
    config = { signer: async () => ({ sign: aws.sign }) };
    destroy = aws.destroy;
  },
}));
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  execFile: aws.curl,
}));
vi.mock("node:timers/promises", () => ({
  setTimeout: (delay: number) => new Promise<void>((resolve) => setTimeout(resolve, delay)),
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
const manifest: ProviderManifest | undefined = manifests.find(
  ({ provider }) => provider.id === "amazon-sagemaker",
);
if (!manifest) throw new Error("Missing SageMaker manifest");
const provider = { ...manifest.provider, source_ids: manifest.sources.map(({ id }) => id) };
const apiSource = manifest.sources.find(({ id }) => id === "sagemaker-marketplace-api");
const sdkSource = manifest.sources.find(({ id }) => id === "sagemaker-sdk");
const catalogSource = manifest.sources.find(({ id }) => id === "sagemaker-models");
if (!apiSource || !sdkSource || !catalogSource) throw new Error("Missing SageMaker sources");
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
function publicInputs(count = 1) {
  const publicReads: SourceManifest[] = [];
  const $ = load(catalog);
  const panel = $("dd[tab-id^='proprietary-models-']");
  panel.attr("tab-id", "proprietary-models-(0)");
  panel
    .find("tr")
    .filter((_index, row) => $(row).find("td").length > 0)
    .remove();
  const specs = Array.from({ length: count }, (_, index) => ({
    ...generation.spec,
    model_id: count === 1 ? generation.spec.model_id : `${generation.spec.model_id}-${index}`,
    listing_id: count === 1 ? fixture.listingId : `${fixture.listingId}${index}`,
  }));
  const manifest =
    count === 1
      ? generation.manifest
      : specs.map(({ model_id, version }) => ({
          model_id,
          version,
          spec_key: `proprietary-models/${model_id}/proprietary_specs_${version}.json`,
          search_keywords: ["Audio2Text", "Generation"],
        }));
  const read = async (input: SourceManifest) => {
    publicReads.push(input);
    const spec = specs.find(({ model_id }) =>
      input.url.includes(`/proprietary-models/${model_id}/`),
    );
    const body =
      spec !== undefined
        ? JSON.stringify(spec)
        : input.url.includes("proprietary-sdk-manifest")
          ? JSON.stringify(manifest)
          : $.html();
    return { body, contentHash: sha256(body), etag: undefined, lastModified: undefined };
  };
  return { read, publicReads };
}
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
    const { publicReads, read } = publicInputs();
    aws.sign.mockImplementation(async (request) => ({
      ...request,
      headers: { ...request.headers, authorization: "PRIVATE_FIXTURE_SIGNATURE" },
    }));
    const nativeFetch = vi.fn(async () => new Response(JSON.stringify(wire()), { status }));
    vi.stubGlobal("fetch", nativeFetch);
    const queries: unknown[] = [];
    const fetched = await fetchSagemakerMarketplaceApi(
      source,
      read,
      async (_request, body, send) => {
        queries.push(JSON.parse(body));
        const response = await send();
        return {
          body: await response.text(),
          contentHash: "b".repeat(64),
          etag: undefined,
          lastModified: undefined,
          status,
        };
      },
    );
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

function useRetryTimers() {
  vi.useFakeTimers();
  // Match Node's minimum delay when the SDK schedules a fractional token wait.
  const schedule = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation((callback, delay, ...args) =>
    schedule(callback, Math.max(1, Math.trunc(delay ?? 1)), ...args),
  );
}

it("slows new listings as well as retries after Marketplace throttles one request", async () => {
  useRetryTimers();
  const { read } = publicInputs(6);
  aws.sign.mockImplementation(async (request: unknown) => request);
  const nativeFetch = vi.fn(async (_input: unknown, options?: RequestInit) => {
    if (typeof options?.body !== "string") throw new Error("Missing listing request");
    const query = z.object({ Parameters: z.string() }).parse(JSON.parse(options.body));
    const { listingId } = z.object({ listingId: z.string() }).parse(JSON.parse(query.Parameters));
    return nativeFetch.mock.calls.length === 1
      ? new Response("Rate exceeded", { status: 429, headers: { "Retry-After": "0, 0" } })
      : new Response(JSON.stringify(wire(fixture.summary, {}, listingId)));
  });
  vi.stubGlobal("fetch", nativeFetch);
  const result = fetchSagemakerMarketplaceApi(source, read, async (_request, _body, send) => {
    let response = await send();
    if (response.status === 429) response = await send();
    if (response.status !== 200) throw new Error("Listing retry did not recover");
    return {
      body: await response.text(),
      contentHash: "b".repeat(64),
      etag: undefined,
      lastModified: undefined,
      status: 200,
    };
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(nativeFetch).toHaveBeenCalledTimes(4);
  await vi.advanceTimersByTimeAsync(100);
  expect(nativeFetch).toHaveBeenCalledTimes(4);
  await vi.runAllTimersAsync();
  const bundle = z
    .object({ listings: z.array(z.object({ body: z.string() })) })
    .parse(JSON.parse((await result).body));
  expect(bundle.listings).toHaveLength(6);
  expect(
    bundle.listings.every(
      ({ body }) => z.object({ status: z.string() }).parse(JSON.parse(body)).status === "available",
    ),
  ).toBe(true);
  expect(nativeFetch).toHaveBeenCalledTimes(7);
});

it.each([
  {
    header: "0, 0",
    attempts: 3,
    reason: "attempt_limit",
    display: "3 attempts · retry attempts exhausted",
  },
  {
    header: "301",
    attempts: 1,
    reason: "retry_after_exceeds_budget",
    delay_ms: 301_000,
    remaining_budget_ms: 300_000,
    display: "1 attempt · Retry-After (301000 ms) exceeds remaining retry budget (300000 ms)",
  },
])(
  "reports $reason through refresh, retains prices and recovers",
  async ({ header, display, ...failure }) => {
    useRetryTimers();
    vi.setSystemTime(new Date(observedAt));
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    vi.stubEnv("AWS_ACCESS_KEY_ID", "PRIVATE_FIXTURE_KEY");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "PRIVATE_FIXTURE_SECRET");
    const selected: ProviderManifest = {
      ...manifest,
      sources: [catalogSource, sdk, source],
    };
    const { read } = publicInputs();
    const catalogBody = (await read({ ...source, url: sagemakerCatalogUrl })).body;
    const openHeaders = sagemakerRows(catalogBody)
      .filter(({ proprietary }) => !proprietary)
      .map(({ id }) => ({
        model_id: id,
        version: "1.0",
        spec_key: `models/${id}/specs_v1.0.json`,
      }));
    aws.curl.mockImplementation((_program, args: string[], _options, callback) => {
      expect(args.at(-1)).toBe(sagemakerCatalogUrl);
      callback(null, { stdout: `HTTP/1.1 200 OK\r\n\r\n${catalogBody}`, stderr: "" });
    });
    aws.sign.mockImplementation(async (request) => ({
      ...request,
      headers: { ...request.headers, authorization: "PRIVATE_FIXTURE_SIGNATURE" },
    }));
    const discard = vi.fn();
    const marketplace = vi.fn(() => new Response(JSON.stringify(wire())));
    vi.stubGlobal("fetch", async (url: string | URL) => {
      if (url === source.url) return marketplace();
      if (String(url) === sagemakerOpenManifestUrl)
        return new Response(JSON.stringify(openHeaders));
      const openSpec = openHeaders.find(({ spec_key }) => String(url).endsWith(`/${spec_key}`));
      return new Response(
        openSpec === undefined
          ? (await read({ ...source, url: String(url) })).body
          : JSON.stringify(openSpec),
      );
    });

    const state = { sources: {} };
    const collect = async (at: string, prior?: ComposedCatalogPair) => {
      const result = collectProvider(selected, prior?.catalog, state, at);
      await vi.runAllTimersAsync();
      const { attempt, provider, models, sources, coverage, warnings, pricing, pricingFailure } =
        await result;
      const previousPricing = prior?.pricing ?? emptyPricingCatalog();
      const pair = composeCatalogPair(
        prior?.catalog,
        {
          catalog_version: "a".repeat(64),
          generated_at: at,
          providers: [provider],
          models,
          sources,
          coverage: [coverage],
          warnings,
        },
        previousPricing,
        [
          pricing === undefined
            ? failedPricingTransition(provider.id, at, pricingFailure ?? "pricing_not_observed")
            : { kind: "fresh", partition: pricing },
        ],
      );
      return {
        pair,
        summary: summarizeRefresh(prior?.catalog, pair.catalog, previousPricing, pair.pricing, [
          attempt,
        ]),
      };
    };
    const initial = await collect(observedAt);
    expect(initial.pair.pricing.books.length).toBeGreaterThan(0);
    marketplace.mockClear().mockImplementation(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("PRIVATE_FIXTURE_RESPONSE"));
            },
            cancel: discard,
          }),
          {
            status: 429,
            headers: { "Retry-After": header, "x-aws-test": "PRIVATE_FIXTURE_HEADER" },
          },
        ),
    );
    const failed = await collect("2026-11-15T00:00:00.000Z", initial.pair);
    expect(marketplace).toHaveBeenCalledTimes(failure.attempts);
    expect(discard).toHaveBeenCalledTimes(failure.attempts);
    const request = `GetListingView/${fixture.listingId}`;
    expect(failed.summary.providers[0]).toMatchObject({
      publication: "accepted",
      pricing_publication: "retained",
      attempt: { pricing: { outcome: "failed", failure_code: "source_unavailable" } },
    });
    expect(failed.summary.providers[0]?.attempt?.sources).toContainEqual(
      expect.objectContaining({
        source_id: source.id,
        outcome: "fetch_failed",
        http_status: 429,
        consecutive_failures: 1,
        last_success_at: observedAt,
        retry_failure: { request, ...failure },
      }),
    );
    expect(failed.pair.pricing.books).toEqual(initial.pair.pricing.books);
    const summaryJson = JSON.stringify(failed.summary);
    expect(summaryJson).not.toContain("PRIVATE_FIXTURE");
    expect(refreshReport(JSON.parse(summaryJson)).markdown).toContain(
      `HTTP 429 · <code>${request}</code> · ${display}`,
    );

    marketplace.mockClear().mockImplementation(() => new Response(JSON.stringify(wire())));
    const recovered = await collect("2026-11-16T00:00:00.000Z", failed.pair);
    expect(marketplace).toHaveBeenCalledOnce();
    expect(recovered.summary.providers[0]?.pricing_publication).toBe("accepted");
    expect(
      recovered.summary.providers[0]?.attempt?.sources.find(
        ({ source_id }) => source_id === source.id,
      ),
    ).toMatchObject({ outcome: "unchanged" });
    expect(JSON.stringify(recovered.summary)).not.toContain("retry_failure");
  },
);

it("runs native timers after the throttled collection", async () => {
  await new Promise<void>((resolve) => setTimeout(resolve, 1));
});
