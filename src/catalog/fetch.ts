import { setTimeout as wait } from "node:timers/promises";
import { load } from "cheerio";
import { fireworksConsoleTargets, fireworksModelPaths } from "./fireworks.ts";
import { nvidiaNimCandidateSlugs, nvidiaNimCardUrls } from "./nvidia-nim.ts";
import { nvidiaBuildPage, nvidiaBuildUrl, nvidiaEndpointBase } from "./nvidia-build.ts";
import { togetherCatalogIds, togetherMissingCacheIds } from "./together.ts";
import { togetherLibraryPage, togetherNextLibraryPage } from "./together-metadata.ts";
import { z } from "zod";
import { bedrockFoundationMapUrls } from "./bedrock-geo-pricing.ts";
import { fetchSagemakerPricing, fetchSagemakerSdk } from "./sagemaker-fetch.ts";
import { fetchSagemakerInventory } from "./sagemaker-api.ts";
import { fetchSagemakerMarketplaceApi } from "./sagemaker-marketplace-api.ts";
import {
  sagemakerCatalogUrl,
  sagemakerOpenManifestUrl,
  sagemakerManifestUrl,
  sagemakerPricesUrl,
  sagemakerPricingSpecs,
  sagemakerRows,
} from "./sagemaker.ts";
import { sagemakerOpenSpecs } from "./sagemaker-sdk.ts";
import { mapConcurrent } from "./concurrency.ts";
import { modelIdSchema } from "./identity.ts";
import { geminiStudioMarkdown } from "./gemini.ts";
import type { SourceManifest } from "./manifests.ts";
import { sha256 } from "./io.ts";
import {
  assertItemCount,
  assertSourceConstraint,
  parseSourceJson,
  recognizeValue,
} from "./source-contract.ts";
import {
  SourceFetchError,
  sourceFailure,
  sourceErrorMessage,
  type DependencyFailure,
} from "./source-failure.ts";
import {
  checkedUrl,
  cloudJson,
  curlResponse,
  curlTransportFailure,
  readLimited,
  retryDelay,
  retryTransient,
  runCurl,
  sourceRetryBudgetMs,
  TransientFetchError,
} from "./transport/http.ts";
import {
  databricksSource,
  fetchAzureModels,
  fetchBedrockInventory,
  fetchGoogleModelGarden,
  runAuthenticatedCurl,
} from "./transport/auth-fetch.ts";
import { cohereModelDocumentUrls } from "./cohere-documents.ts";
import { ollamaPricedModelPageIds, ollamaPricingUrl } from "./ollama-pricing.ts";
import { vercelPageSearchPrices, vercelPricingContracts } from "./vercel-pricing-contracts.ts";
import {
  dashscopeMarketRegions,
  dashscopeMarketRequest,
  dashscopeMarketPage,
  dashscopeMarketIdentity,
} from "./dashscope-market.ts";
import { linkedBundleSchema } from "./bundle.ts";
import { xaiLanguageCardPaths } from "./xai.ts";

export { curlResponse };

type AzurePortalModelsTransport = Extract<
  NonNullable<SourceManifest["transport"]>,
  { kind: "azure-portal-models" }
>;
type GeminiModelsTransport = Extract<
  NonNullable<SourceManifest["transport"]>,
  { kind: "gemini-models" }
>;
type CohereModelsTransport = Extract<
  NonNullable<SourceManifest["transport"]>,
  { kind: "cohere-models" }
>;
type DashscopeDeployableModelsTransport = Extract<
  NonNullable<SourceManifest["transport"]>,
  { kind: "dashscope-deployable-models" }
>;

const azurePricesPageSchema = z.object({
  Count: z.number().int().min(1).max(1_000),
  Items: z.array(z.unknown()).min(1).max(1_000),
  NextPageLink: z.url().nullable(),
});
const emptyAzurePortalErrorMapSchema = z
  .record(z.string(), z.unknown())
  .refine((value) => Object.keys(value).length === 0, "Azure portal search was partial");
const azurePortalPageSchema = z.object({
  indexEntitiesResponse: z.object({
    totalCount: z.number().int().nonnegative(),
    value: z.array(z.unknown()),
    continuationToken: z.string().nullable(),
    resourcesNotQueriedReasons: emptyAzurePortalErrorMapSchema,
    numberOfEntityContainersNotQueried: z.null(),
    shardErrors: z.null(),
  }),
  regionalErrors: emptyAzurePortalErrorMapSchema,
  resourceSkipReasons: emptyAzurePortalErrorMapSchema,
  shardErrors: emptyAzurePortalErrorMapSchema,
  numberOfResourcesNotIncludedInSearch: z.literal(0),
});
const geminiModelsPageSchema = z.object({
  models: z.array(z.unknown()).default([]),
  nextPageToken: z.string().min(1).optional(),
});
const cohereModelsPageSchema = z.object({
  models: z.array(z.unknown()),
  next_page_token: z.string().min(1).optional(),
});
const dashscopeDeploymentPageSchema = z.strictObject({
  request_id: z.string().min(1).optional(),
  output: z.strictObject({
    page_no: z.number().int().min(1),
    page_size: z.number().int().min(1).max(100),
    total: z.number().int().nonnegative(),
    models: z.array(
      z.strictObject({
        model_name: modelIdSchema,
        plans: z.array(
          z.strictObject({
            plan: z.enum(["mu", "cu", "ptu", "ptu_v2", "lora"]),
            templates: z.array(z.unknown()).optional(),
          }),
        ),
      }),
    ),
  }),
});
const huggingFaceModelsPageSchema = z.array(z.unknown());

const ollamaListSchema = z.object({ models: z.array(z.unknown()) }).passthrough();
const vercelModelsTransportSchema = z.strictObject({
  object: z.literal("list"),
  data: z.array(
    z
      .object({
        id: modelIdSchema.refine((value) => value.split("/").length === 2),
        pricing: z.record(z.string(), z.unknown()),
      })
      .passthrough(),
  ),
});
const vercelEndpointTransportSchema = z.strictObject({
  data: z
    .object({
      id: modelIdSchema,
      endpoints: z.array(
        z
          .object({
            name: z.string().min(1),
            provider_name: z.string().min(1),
            uptime_last_15m: z.number().nullable().optional(),
            uptime_last_1h: z.number().nullable().optional(),
            uptime_last_1d: z.number().nullable().optional(),
            latency_last_1h: z.unknown().nullable().optional(),
            throughput_last_1h: z.unknown().nullable().optional(),
          })
          .passthrough(),
      ),
    })
    .passthrough(),
});

export const sourceStateSchema = z.object({
  etag: z.string().optional(),
  lastModified: z.string().optional(),
  contentHash: z.string().length(64).optional(),
  lastSuccessAt: z.iso.datetime({ offset: true }).optional(),
  checkedAt: z.iso.datetime({ offset: true }),
  consecutiveFailures: z.number().int().nonnegative(),
});

export const fetchStateSchema = z.object({
  sources: z.record(z.string(), sourceStateSchema),
});

export type FetchState = z.infer<typeof fetchStateSchema>;
export type SourceState = z.infer<typeof sourceStateSchema>;

export interface FetchPayload {
  body: string;
  contentHash: string;
  etag: string | undefined;
  lastModified: string | undefined;
}

export interface StatusPayload extends FetchPayload {
  status: 200 | 404 | 410;
}

export type FetchObservation = Omit<FetchPayload, "body"> & { key: string };

export interface FetchResult extends FetchPayload {
  dependencies: FetchObservation[];
  dependencyFailures?: DependencyFailure[];
}

async function curlRequest(url: URL, source: SourceManifest, json?: string): Promise<Response> {
  const headers: string[] = [
    source.format === "json"
      ? "Accept: application/json"
      : source.format === "markdown"
        ? "Accept: text/markdown, text/plain;q=0.9"
        : source.format === "html"
          ? "Accept: text/html"
          : "Accept: */*",
  ];
  for (const header of source.headers ?? []) headers.push(`${header.name}: ${header.value}`);
  const requestOptions = {
    headers,
    maxResponseBytes: source.maxResponseBytes,
    maxTimeSeconds: url.href === sagemakerPricesUrl ? 150 : 60,
    connectTimeoutSeconds: 30,
    ...(json === undefined ? {} : { json }),
    retryHttp11: true,
  };
  try {
    return source.auth !== undefined
      ? await runAuthenticatedCurl(url, source.auth, requestOptions)
      : await runCurl(url, requestOptions);
  } catch (error) {
    throw new TransientFetchError(`Transient ${curlTransportFailure(error)}`);
  }
}

async function fetchAzureRetailPrices(source: SourceManifest): Promise<string> {
  const label = "Azure Retail Prices";
  const first = new URL(source.url);
  first.searchParams.set("api-version", "2023-01-01-preview");
  first.searchParams.set("currencyCode", "USD");
  first.searchParams.set(
    "$filter",
    "serviceName eq 'Foundry Models' and priceType eq 'Consumption'",
  );
  const prices: unknown[] = [];
  let next = first;
  for (let pageNumber = 1; ; pageNumber += 1) {
    let cooldown = 0;
    const payload = await cloudJson(
      label,
      next,
      source.maxResponseBytes,
      ["Accept: application/json"],
      {
        onSuccess(response) {
          if (
            response.headers.get("x-ms-ratelimit-remaining-retailprices-requests")?.trim() === "0"
          )
            cooldown = retryDelay(response) || 60_000;
        },
      },
    ).catch((error: unknown) => {
      if (error instanceof SourceFetchError && error.status === 429)
        throw new Error(`${error.message} on page ${pageNumber}`, { cause: error });
      throw error;
    });
    const page: z.infer<typeof azurePricesPageSchema> = recognizeValue(
      label,
      azurePricesPageSchema,
      payload,
    );
    assertSourceConstraint(
      `${label} page ${pageNumber} reported an inconsistent item count`,
      page.Count === page.Items.length,
      page.Count,
      ["Count"],
    );
    prices.push(...page.Items);
    if (page.NextPageLink === null) break;
    next = new URL(page.NextPageLink);
    const expected = new URL(first);
    expected.searchParams.set("$skip", String(prices.length));
    expected.searchParams.sort();
    const continuationQuery = new URLSearchParams(next.searchParams);
    continuationQuery.sort();
    assertSourceConstraint(
      `${label} page ${pageNumber} continuation changed endpoint, query scope or offset`,
      next.origin === expected.origin &&
        next.pathname === expected.pathname &&
        next.username === "" &&
        next.password === "" &&
        next.hash === "" &&
        continuationQuery.toString() === expected.searchParams.toString(),
      page.NextPageLink,
      ["NextPageLink"],
    );
    if (pageNumber === 50) throw new Error("Azure Retail Prices API exceeded page limit");
    if (cooldown > 0) {
      if (cooldown > sourceRetryBudgetMs)
        throw new Error(
          `Azure Retail Prices cooldown exceeded the budget after page ${pageNumber}`,
        );
      await wait(cooldown);
    }
  }
  const body = JSON.stringify({ prices });
  if (Buffer.byteLength(body) > source.maxResponseBytes)
    throw new Error("Azure Retail Prices bundle exceeded byte limit");
  return body;
}

async function fetchAzurePortalModels(
  source: SourceManifest,
  transport: AzurePortalModelsTransport,
): Promise<string> {
  const extractor = source.extractor;
  if (extractor.kind !== "azure-portal-catalog")
    throw new Error("Azure portal transport requires the portal catalog extractor");
  const url = checkedUrl(source.url, source);
  if (
    url.href !== "https://ai.azure.com/api/westus2/ux/v1.0/entities/crossRegion" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== ""
  )
    throw new Error("Azure portal model search URL is not reviewed");
  if (
    transport.registries.length === 0 ||
    transport.registries.length > 32 ||
    new Set(transport.registries).size !== transport.registries.length ||
    transport.registries.some((registry) => !/^[A-Za-z0-9-]+$/.test(registry))
  )
    throw new Error("Azure portal registry set is invalid");
  if (
    !Number.isInteger(transport.pageSize) ||
    transport.pageSize < 1 ||
    transport.pageSize > 100 ||
    !Number.isInteger(transport.maxPages) ||
    transport.maxPages < 1 ||
    !Number.isInteger(transport.maxModels) ||
    transport.maxModels < transport.pageSize
  )
    throw new Error("Azure portal pagination limits are invalid");

  const models: unknown[] = [];
  const seenTokens = new Set<string>();
  let continuationToken: string | undefined;
  let expectedTotal: number | undefined;
  for (let pageCount = 0; pageCount < transport.maxPages; pageCount += 1) {
    const requestBody = JSON.stringify({
      resourceIds: transport.registries.map((resourceId) => ({
        resourceId,
        entityContainerType: "Registry",
      })),
      indexEntitiesRequest: {
        filters: [
          { field: "kind", operator: "eq", values: ["Versioned"] },
          { field: "properties/isAnonymous", operator: "ne", values: ["true"] },
          { field: "annotations/archived", operator: "ne", values: ["true"] },
          { field: "properties/userProperties/is-promptflow", operator: "notexists" },
          { field: "labels", operator: "eq", values: ["latest"] },
          {
            field: "annotations/tags/deploymentOptions",
            operator: "contains",
            values: ["UnifiedEndpointMaaS"],
          },
          { field: "type", operator: "eq", values: ["models"] },
        ],
        freeTextSearch: "",
        order: [{ field: "usage/popularity", direction: "Desc" }],
        pageSize: transport.pageSize,
        facets: [],
        includeTotalResultCount: true,
        searchBuilder: "AppendPrefix",
        ...(continuationToken === undefined ? {} : { continuationToken }),
      },
    });
    const response = await fetchPost(source, requestBody);
    if (response.status !== 200)
      throw new SourceFetchError(
        `Azure portal model search HTTP ${response.status}`,
        response.status,
      );
    const page = recognizeValue(
      "Azure portal model search",
      azurePortalPageSchema,
      parseSourceJson(response.body),
    );
    const { totalCount, value: items, continuationToken: rawToken } = page.indexEntitiesResponse;
    if (expectedTotal === undefined) {
      expectedTotal = totalCount;
      assertItemCount(
        "Azure portal model search",
        expectedTotal,
        extractor.minModels,
        extractor.maxModels,
      );
      if (expectedTotal > transport.maxModels)
        throw new Error("Azure portal model search exceeded item limit");
    } else {
      assertSourceConstraint(
        "Azure portal model-search total changed during pagination",
        totalCount === expectedTotal,
        totalCount,
        ["indexEntitiesResponse", "totalCount"],
      );
    }
    assertSourceConstraint(
      "Azure portal model search returned an empty intermediate page",
      items.length !== 0 || models.length >= expectedTotal,
      items,
      ["indexEntitiesResponse", "value"],
    );
    models.push(...items);
    assertSourceConstraint(
      "Azure portal model search exceeded its declared total",
      models.length <= expectedTotal && models.length <= transport.maxModels,
      models.length,
      ["indexEntitiesResponse", "value"],
    );
    const next = rawToken === null || rawToken.trim() === "" ? undefined : rawToken;
    if (models.length === expectedTotal) {
      assertSourceConstraint(
        "Azure portal model search continued past its declared total",
        next === undefined,
        next,
        ["indexEntitiesResponse", "continuationToken"],
      );
      const body = JSON.stringify({ models });
      if (Buffer.byteLength(body) > source.maxResponseBytes)
        throw new Error("Azure portal model bundle exceeded byte limit");
      return body;
    }
    assertSourceConstraint(
      "Azure portal model search ended before its declared total",
      next !== undefined,
      next,
      ["indexEntitiesResponse", "continuationToken"],
    );
    assertSourceConstraint(
      "Azure portal model search repeated a page token",
      !seenTokens.has(next),
      next,
      ["indexEntitiesResponse", "continuationToken"],
    );
    seenTokens.add(next);
    continuationToken = next;
  }
  throw new Error("Azure portal model search exceeded page limit");
}

async function request(source: SourceManifest, json?: string, usePool = true): Promise<Response> {
  let url = checkedUrl(source.url, source);
  for (let redirect = 0; redirect <= 4; redirect += 1) {
    // JumpStart has hundreds of small public specs on one reviewed S3 origin.
    // Native fetch reuses connections instead of starting a curl/TLS connection per spec.
    const pooledSageMaker =
      usePool &&
      source.auth === undefined &&
      json === undefined &&
      url.hostname === "jumpstart-cache-prod-us-west-2.s3.us-west-2.amazonaws.com" &&
      [
        "sagemaker-sdk",
        "sagemaker-pricing",
        "sagemaker-marketplace-pricing",
        "aws-sagemaker",
      ].includes(source.transport?.kind ?? "");
    const response = pooledSageMaker
      ? await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(60_000) }).catch(() => {
          throw new TransientFetchError("SageMaker public cache request failed");
        })
      : await curlRequest(url, source, json);
    if (response.status >= 300 && response.status < 400) {
      if (source.extractor.kind === "huggingface-hub")
        throw new Error("Hugging Face Hub redirected the reviewed query");
      const location = response.headers.get("location");
      if (location === null) throw new Error("Redirect response omitted Location");
      url = checkedUrl(new URL(location, url).href, source);
      continue;
    }
    return response;
  }
  throw new Error("Too many redirects");
}

async function attemptFetch(
  source: SourceManifest,
  attempt: number,
): Promise<{ payload: FetchPayload; link: string | undefined }> {
  const response = await request(source, undefined, attempt < 3);
  if (response.status === 429 || response.status >= 500)
    throw new TransientFetchError(
      `Transient HTTP ${response.status}`,
      retryDelay(response),
      response.status,
    );
  if (!response.ok) throw new SourceFetchError(`HTTP ${response.status}`, response.status);
  let body = await readLimited(response, source.maxResponseBytes);
  const host = new URL(source.url).hostname;
  if (
    source.access === "public" &&
    source.auth === undefined &&
    source.format === "html" &&
    (host === "cloud.google.com" || host === "docs.cloud.google.com")
  ) {
    // Google documentation embeds browser API keys unrelated to the catalog content.
    body = body.replace(/AIzaSy[0-9A-Za-z_-]{33}/g, "[redacted browser API key]");
  }
  if (body.trim() === "") throw new Error("Source returned an empty body");
  return {
    payload: {
      body,
      contentHash: sha256(body),
      etag: response.headers.get("etag") ?? undefined,
      lastModified: response.headers.get("last-modified") ?? undefined,
    },
    link: response.headers.get("link") ?? undefined,
  };
}

async function attemptPost(
  source: SourceManifest,
  body: string,
  send?: () => Promise<Response>,
): Promise<StatusPayload> {
  const response =
    send === undefined
      ? await request(source, body)
      : await send().catch(() => {
          throw new TransientFetchError("Signed source request failed");
        });
  if (response.status !== 200 && response.status !== 404 && response.status !== 410) {
    if (send !== undefined) void response.body?.cancel().catch(() => undefined);
    if (response.status === 429 || response.status >= 500)
      throw new TransientFetchError(
        `Transient HTTP ${response.status}`,
        retryDelay(response),
        response.status,
      );
    throw new SourceFetchError(`HTTP ${response.status}`, response.status);
  }
  const responseBody = await readLimited(response, source.maxResponseBytes);
  if (responseBody.trim() === "") throw new Error("Source returned an empty body");
  return {
    body: responseBody,
    contentHash: sha256(responseBody),
    etag: undefined,
    lastModified: undefined,
    status: response.status,
  };
}

async function fetchPost(
  source: SourceManifest,
  body: string,
  send?: () => Promise<Response>,
  request?: string,
): Promise<StatusPayload> {
  return retryTransient(() => attemptPost(source, body, send), request);
}

async function fetchResponse(
  source: SourceManifest,
): Promise<{ payload: FetchPayload; link: string | undefined }> {
  return retryTransient((attempt) => attemptFetch(source, attempt));
}

async function fetchPayload(source: SourceManifest): Promise<FetchPayload> {
  return (await fetchResponse(source)).payload;
}

function observation(key: string, payload: FetchPayload): FetchObservation {
  return {
    key,
    contentHash: payload.contentHash,
    etag: payload.etag,
    lastModified: payload.lastModified,
  };
}

function generatedFetchResult(body: string): FetchResult {
  return {
    body,
    contentHash: sha256(body),
    etag: undefined,
    lastModified: undefined,
    dependencies: [],
  };
}

function linkedUrls(body: string, source: SourceManifest, pathPattern: RegExp): URL[] {
  const crawl = source.linkedDocuments;
  if (crawl === undefined) return [];
  if (source.extractor.kind === "gemini-catalog") body = geminiStudioMarkdown(body) ?? body;
  const urls = new Map<string, URL>();
  const add = (target: string | undefined): void => {
    if (target === undefined) return;
    try {
      const url = new URL(target, source.url);
      if (
        url.protocol !== "https:" ||
        !source.allowedHosts.includes(url.hostname) ||
        url.port !== "" ||
        url.username !== "" ||
        url.password !== "" ||
        url.search !== "" ||
        url.hash !== ""
      )
        return;
      const suffix = crawl.discoverySuffix;
      if (suffix !== undefined && !url.pathname.endsWith(suffix)) return;
      const path = suffix === undefined ? url.pathname : url.pathname.slice(0, -suffix.length);
      if (!pathPattern.test(path)) return;
      const requestSuffix = crawl.requestSuffix ?? "";
      url.pathname = path.endsWith(requestSuffix) ? path : `${path}${requestSuffix}`;
      urls.set(url.href, url);
    } catch {
      return;
    }
  };
  const indexFormat = crawl.indexFormat ?? source.format;
  if (source.extractor.kind === "xai-catalog") {
    for (const path of xaiLanguageCardPaths(body)) add(path);
    return [...urls.values()].sort((left, right) => left.href.localeCompare(right.href));
  }
  if (source.extractor.kind === "cohere-catalog")
    for (const url of cohereModelDocumentUrls(body, source.url)) add(url.href);
  else if (indexFormat === "markdown" || indexFormat === "mixed")
    for (const match of body.matchAll(/(?<!!)\[[^\]]+\]\(([^)\s]+)\)/g)) add(match[1]);
  if (source.extractor.kind === "gemini-catalog")
    for (const match of body.matchAll(/{% (?:button|card)\b[^%]*\bhref="([^"]+)"[^%]*%}/g))
      add(match[1]);
  if (indexFormat === "typescript")
    for (const match of body.matchAll(
      /^\s*import\s+(?:[^'"\n]+\s+from\s+)?['"]([^'"]+)['"];?\s*$/gm,
    ))
      add(match[1]);
  if (source.extractor.kind === "fireworks-serverless") {
    for (const path of fireworksModelPaths(body)) add(path);
  } else if (source.extractor.kind === "nvidia-nim-cards") {
    for (const url of nvidiaNimCardUrls(body)) add(url);
  } else if (indexFormat === "html" || indexFormat === "mixed") {
    const $ = load(body);
    $("a[href]").each((_index, element) => add($(element).attr("href")));
    if (crawl.includeScripts)
      $("script[src]").each((_index, element) => add($(element).attr("src")));
  }
  const values = [...urls.values()].sort((left, right) => left.href.localeCompare(right.href));
  return values;
}

export function linkedDocumentUrls(body: string, source: SourceManifest): URL[] {
  const crawl = source.linkedDocuments;
  if (crawl === undefined) return [];
  const values = linkedUrls(body, source, crawl.path);
  assertItemCount("Linked documents", values.length, crawl.minDocuments, crawl.maxDocuments);
  return values;
}

function requestSource(
  source: SourceManifest,
  key: string,
  url: URL,
  format: SourceManifest["format"],
  maxResponseBytes: number,
): SourceManifest {
  const { linkedDocuments: _linkedDocuments, ...base } = source;
  const { transport: _transport, ...plain } = base;
  void _linkedDocuments;
  void _transport;
  return {
    ...plain,
    id: key,
    url: url.href,
    format,
    maxResponseBytes,
  };
}

function linkedSource(
  source: SourceManifest,
  key: string,
  url: URL,
  maxResponseBytes = source.linkedDocuments?.maxDocumentBytes ?? source.maxResponseBytes,
  format = source.format,
): SourceManifest {
  return requestSource(source, key, url, format, maxResponseBytes);
}

function huggingFaceModelsUrl(raw: string, source: SourceManifest): URL {
  const url = checkedUrl(raw, source);
  const allowed = new Set(["inference_provider", "limit", "sort", "expand", "cursor"]);
  if (
    url.hostname !== "huggingface.co" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/api/models" ||
    url.hash !== "" ||
    [...url.searchParams.keys()].some((key) => !allowed.has(key)) ||
    url.searchParams.getAll("inference_provider").join("\0") !== "hf-inference" ||
    url.searchParams.getAll("limit").join("\0") !== "1000" ||
    url.searchParams.getAll("sort").join("\0") !== "createdAt" ||
    url.searchParams.getAll("expand").sort().join("\0") !==
      "inferenceProviderMapping\0lastModified" ||
    url.searchParams.getAll("cursor").length > 1
  )
    throw new Error("Hugging Face Hub pagination left the reviewed query");
  return url;
}

async function fetchHuggingFacePage(
  source: SourceManifest,
  key: string,
  url: URL,
): Promise<{ payload: FetchPayload; next: URL | undefined }> {
  const pageSource = requestSource(source, key, url, "json", source.maxResponseBytes);
  const { payload, link } = await fetchResponse(pageSource);
  const nextLinks = [...(link ?? "").matchAll(/<([^>]+)>;\s*rel="?next"?/g)];
  assertSourceConstraint(
    "Hugging Face Hub returned duplicate next links",
    nextLinks.length <= 1,
    nextLinks,
  );
  const nextRaw = nextLinks[0]?.[1];
  return {
    payload,
    next: nextRaw === undefined ? undefined : huggingFaceModelsUrl(nextRaw, source),
  };
}

async function fetchHuggingFaceModels(source: SourceManifest): Promise<FetchResult> {
  const transport = source.transport;
  if (transport?.kind !== "huggingface-models")
    throw new Error("Invalid Hugging Face Hub transport");
  const models: unknown[] = [];
  const pages: { key: string; payload: FetchPayload }[] = [];
  const cursors = new Set<string | null>();
  let next: URL | undefined = huggingFaceModelsUrl(source.url, source);
  while (next !== undefined) {
    if (pages.length >= transport.maxPages) throw new Error("Hugging Face Hub exceeded page limit");
    const cursor = next.searchParams.get("cursor");
    if (cursors.has(cursor)) throw new Error("Hugging Face Hub repeated a pagination cursor");
    cursors.add(cursor);
    const key = `${source.id}/page-${pages.length + 1}`;
    const page = await fetchHuggingFacePage(source, key, next);
    models.push(
      ...recognizeValue(
        "Hugging Face Hub page",
        huggingFaceModelsPageSchema,
        json(page.payload.body),
      ),
    );
    assertItemCount("Hugging Face Hub transport models", models.length, 0, transport.maxModels);
    pages.push({ key, payload: page.payload });
    next = page.next;
  }
  assertItemCount("Hugging Face Hub transport models", models.length, 1, transport.maxModels);
  const body = JSON.stringify({ models });
  if (Buffer.byteLength(body) > source.maxResponseBytes)
    throw new Error("Hugging Face Hub bundle exceeded byte limit");
  return {
    body,
    contentHash: sha256(body),
    etag: pages[0]?.payload.etag,
    lastModified: pages[0]?.payload.lastModified,
    dependencies: pages.map(({ key, payload }) => observation(key, payload)),
  };
}

interface TokenPage {
  models: unknown[];
  nextPageToken?: string;
}

async function fetchTokenPaginatedModels(
  source: SourceManifest,
  transport: { pageSize: number; maxPages: number; maxModels: number },
  name: string,
  pageUrl: (pageToken: string | undefined) => URL,
  parsePage: (body: string) => TokenPage,
): Promise<FetchResult> {
  if (
    !Number.isInteger(transport.pageSize) ||
    transport.pageSize < 1 ||
    transport.pageSize > 1000 ||
    !Number.isInteger(transport.maxPages) ||
    transport.maxPages < 1 ||
    !Number.isInteger(transport.maxModels) ||
    transport.maxModels < transport.pageSize
  )
    throw new Error(`Invalid ${name} pagination bounds`);

  const models: unknown[] = [];
  const pages: { key: string; payload: FetchPayload }[] = [];
  const tokens = new Set<string>();
  let pageToken: string | undefined;
  for (let index = 0; index < transport.maxPages; index += 1) {
    const key = `${source.id}/page-${index + 1}`;
    const payload = await fetchPayload(
      requestSource(source, key, pageUrl(pageToken), "json", source.maxResponseBytes),
    );
    const page = parsePage(payload.body);
    models.push(...page.models);
    assertItemCount(`${name} transport`, models.length, 0, transport.maxModels);
    pages.push({ key, payload });
    if (page.nextPageToken === undefined) {
      pageToken = undefined;
      break;
    }
    assertSourceConstraint(
      `${name} pagination repeated a token`,
      !tokens.has(page.nextPageToken),
      page.nextPageToken,
    );
    tokens.add(page.nextPageToken);
    pageToken = page.nextPageToken;
  }
  if (pageToken !== undefined) throw new Error(`${name} exceeded page limit`);
  assertItemCount(`${name} transport`, models.length, 1, transport.maxModels);
  const body = JSON.stringify({ models });
  if (Buffer.byteLength(body) > source.maxResponseBytes)
    throw new Error(`${name} bundle exceeded byte limit`);
  return {
    body,
    contentHash: sha256(body),
    etag: pages[0]?.payload.etag,
    lastModified: pages[0]?.payload.lastModified,
    dependencies: pages.map(({ key, payload }) => observation(key, payload)),
  };
}

function geminiModelsUrl(
  source: SourceManifest,
  transport: GeminiModelsTransport,
  pageToken: string | undefined,
): URL {
  const url = checkedUrl(source.url, source);
  if (
    url.hostname !== "generativelanguage.googleapis.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/v1beta/models" ||
    url.search !== "" ||
    url.hash !== ""
  )
    throw new Error("Gemini models pagination left the reviewed endpoint");
  url.searchParams.set("pageSize", String(transport.pageSize));
  if (pageToken !== undefined) url.searchParams.set("pageToken", pageToken);
  return url;
}

async function fetchGeminiModels(source: SourceManifest): Promise<FetchResult> {
  const transport = source.transport;
  if (transport?.kind !== "gemini-models") throw new Error("Invalid Gemini models transport");
  return fetchTokenPaginatedModels(
    source,
    transport,
    "Gemini models",
    (pageToken) => geminiModelsUrl(source, transport, pageToken),
    (body) => {
      const page = recognizeValue("Gemini models page", geminiModelsPageSchema, json(body));
      return {
        models: page.models,
        ...(page.nextPageToken === undefined ? {} : { nextPageToken: page.nextPageToken }),
      };
    },
  );
}

function cohereModelsUrl(
  source: SourceManifest,
  transport: CohereModelsTransport,
  pageToken: string | undefined,
): URL {
  const url = checkedUrl(source.url, source);
  if (
    url.hostname !== "api.cohere.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/v1/models" ||
    url.search !== "" ||
    url.hash !== ""
  )
    throw new Error("Cohere models pagination left the reviewed endpoint");
  url.searchParams.set("page_size", String(transport.pageSize));
  if (pageToken !== undefined) url.searchParams.set("page_token", pageToken);
  return url;
}

async function fetchCohereModels(source: SourceManifest): Promise<FetchResult> {
  const transport = source.transport;
  if (transport?.kind !== "cohere-models") throw new Error("Invalid Cohere models transport");
  return fetchTokenPaginatedModels(
    source,
    transport,
    "Cohere models",
    (pageToken) => cohereModelsUrl(source, transport, pageToken),
    (body) => {
      const page = recognizeValue("Cohere models page", cohereModelsPageSchema, json(body));
      assertSourceConstraint(
        "Cohere models pagination returned an empty intermediate page",
        page.models.length !== 0 || page.next_page_token === undefined,
        page.models,
        ["models"],
      );
      return {
        models: page.models,
        ...(page.next_page_token === undefined ? {} : { nextPageToken: page.next_page_token }),
      };
    },
  );
}

function dashscopeDeploymentUrl(
  source: SourceManifest,
  transport: DashscopeDeployableModelsTransport,
  pageNo: number,
): URL {
  const url = checkedUrl(source.url, source);
  const allowed = new Set(["page_no", "page_size", "version", "model_source"]);
  if (
    url.hostname !== "dashscope-intl.aliyuncs.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/api/v1/deployments/models" ||
    url.hash !== "" ||
    url.searchParams.size !== allowed.size ||
    [...url.searchParams.keys()].some((key) => !allowed.has(key)) ||
    url.searchParams.get("page_no") !== "1" ||
    url.searchParams.get("page_size") !== String(transport.pageSize) ||
    url.searchParams.get("version") !== "v1.0" ||
    url.searchParams.get("model_source") !== "base"
  )
    throw new Error("DashScope deployment pagination left the reviewed endpoint");
  url.searchParams.set("page_no", String(pageNo));
  return url;
}

async function fetchDashscopeDeployableModels(source: SourceManifest): Promise<FetchResult> {
  const transport = source.transport;
  const extractor = source.extractor;
  if (
    transport?.kind !== "dashscope-deployable-models" ||
    extractor.kind !== "dashscope-api" ||
    !Number.isInteger(transport.pageSize) ||
    transport.pageSize < 1 ||
    transport.pageSize > 100 ||
    !Number.isInteger(transport.maxPages) ||
    transport.maxPages < 1 ||
    !Number.isInteger(transport.maxModels) ||
    transport.maxModels < transport.pageSize ||
    transport.pageSize * transport.maxPages < transport.maxModels
  )
    throw new Error("Invalid DashScope deployment pagination bounds");

  const models: z.infer<typeof dashscopeDeploymentPageSchema>["output"]["models"] = [];
  const pages: { key: string; payload: FetchPayload }[] = [];
  const ids = new Set<string>();
  let expectedTotal: number | undefined;
  let requestId: string | undefined;
  for (let pageNo = 1; pageNo <= transport.maxPages; pageNo += 1) {
    const key = `${source.id}/page-${pageNo}`;
    const url = dashscopeDeploymentUrl(source, transport, pageNo);
    const payload = await fetchPayload(
      requestSource(source, key, url, "json", source.maxResponseBytes),
    );
    const page = recognizeValue(
      "DashScope deployment API",
      dashscopeDeploymentPageSchema,
      json(payload.body),
    );
    assertSourceConstraint(
      "DashScope deployment API contradicted the requested page",
      page.output.page_no === pageNo && page.output.page_size === transport.pageSize,
      page.output,
      ["output"],
    );
    if (expectedTotal === undefined) {
      expectedTotal = page.output.total;
      requestId = page.request_id;
      assertItemCount(
        "DashScope deployment API",
        expectedTotal,
        extractor.minModels,
        extractor.maxModels,
      );
      if (expectedTotal > transport.maxModels)
        throw new Error("DashScope deployment API exceeded item limit");
    } else {
      assertSourceConstraint(
        "DashScope deployment total changed during pagination",
        page.output.total === expectedTotal,
        page.output.total,
        ["output", "total"],
      );
    }
    const expectedPageItems = Math.min(transport.pageSize, expectedTotal - models.length);
    assertSourceConstraint(
      "DashScope deployment API returned a partial page",
      page.output.models.length === expectedPageItems,
      page.output.models,
      ["output", "models"],
    );
    for (const model of page.output.models) {
      assertSourceConstraint(
        "DashScope deployment API repeated a model ID",
        !ids.has(model.model_name),
        model.model_name,
        ["output", "models", "model_name"],
      );
      ids.add(model.model_name);
      models.push(model);
    }
    pages.push({ key, payload });
    if (models.length === expectedTotal) {
      const body = JSON.stringify({
        ...(requestId === undefined ? {} : { request_id: requestId }),
        output: {
          page_no: 1,
          page_size: Math.max(1, expectedTotal),
          total: expectedTotal,
          models,
        },
      });
      if (Buffer.byteLength(body) > source.maxResponseBytes)
        throw new Error("DashScope deployment bundle exceeded byte limit");
      return {
        body,
        contentHash: sha256(body),
        etag: pages[0]?.payload.etag,
        lastModified: pages[0]?.payload.lastModified,
        dependencies: pages.map(({ key: pageKey, payload: pagePayload }) =>
          observation(pageKey, pagePayload),
        ),
      };
    }
  }
  throw new Error("DashScope deployment API exceeded page limit");
}

interface FetchedDocument {
  key: string;
  url: string;
  payload: FetchPayload;
}

interface DocumentEntry {
  key: string;
  url: URL;
  format: SourceManifest["format"];
  maxResponseBytes: number;
  optional?: boolean;
  claimLocal?: boolean;
}

async function fetchDocumentEntry(
  source: SourceManifest,
  entry: DocumentEntry,
): Promise<FetchedDocument | DependencyFailure> {
  try {
    const payload = await fetchPayload(
      linkedSource(source, entry.key, entry.url, entry.maxResponseBytes, entry.format),
    );
    return { key: entry.key, url: entry.url.href, payload };
  } catch (error) {
    if (entry.optional === true)
      return {
        dependency_id: entry.key,
        impact: entry.claimLocal === true ? "claim" : "bundle",
        ...sourceFailure(error),
      };
    throw new Error(`Linked document ${entry.key} failed: ${sourceErrorMessage(error)}`, {
      cause: error,
    });
  }
}

function documentEntry(
  source: SourceManifest,
  document: NonNullable<NonNullable<SourceManifest["linkedDocuments"]>["documents"]>[number],
): DocumentEntry {
  const url = checkedUrl(document.url, source);
  return {
    key: `${source.id}/${document.id}`,
    url,
    format: document.format ?? source.format,
    maxResponseBytes: document.maxResponseBytes,
    ...(document.optional === undefined ? {} : { optional: document.optional }),
    ...(document.claimLocal === undefined ? {} : { claimLocal: document.claimLocal }),
  };
}

async function fetchMistralGuides(
  source: SourceManifest,
  archiveUrl: string,
  entries: readonly DocumentEntry[],
  concurrency: number,
): Promise<(FetchedDocument | DependencyFailure)[]> {
  const archive = await fetchPayload(
    linkedSource(
      source,
      `${source.id}/guide-archive`,
      checkedUrl(archiveUrl, source),
      8 * 1024 * 1024,
      "markdown",
    ),
  ).catch(() => undefined);
  const documents = new Map<string, string | undefined>();
  if (archive && /^# Mistral AI — full documentation\r?\n/.test(archive.body)) {
    const wanted = new Set(entries.map(({ url }) => url.href));
    const sections = archive.body.split(/^\[[^\r\n]+\]\r?\nSource: (\S+)\r?\n/m);
    for (let index = 1; index < sections.length; index += 2) {
      const url = sections[index];
      if (url === undefined || !wanted.has(url)) continue;
      const body = sections[index + 1]?.trim();
      documents.set(url, !documents.has(url) && body?.startsWith("# ") ? body : undefined);
    }
  }
  return mapConcurrent(entries, concurrency, (entry) => {
    const url = entry.url.href;
    const body = documents.get(url);
    return body === undefined || Buffer.byteLength(body) > entry.maxResponseBytes
      ? fetchDocumentEntry(source, entry)
      : Promise.resolve({ key: entry.key, url, payload: generatedFetchResult(body) });
  });
}

async function fetchTogetherModelLibrary(
  source: SourceManifest,
  catalogUrl: string,
  pricing?: { catalog: FetchPayload; ids: ReadonlySet<string> },
): Promise<FetchResult> {
  const catalogKey = `${source.id}/serverless`;
  const catalog =
    pricing?.catalog ??
    (await fetchPayload(
      requestSource(source, catalogKey, new URL(catalogUrl), "markdown", 1024 * 1024),
    ));
  const ids = pricing?.ids ?? togetherCatalogIds(catalog.body);
  const pages: FetchedDocument[] = [];
  const urls = new Set<string>();
  const maxPages = 16;
  let pageUrl: URL | undefined = new URL(source.url);
  while (pageUrl !== undefined && pages.length < maxPages) {
    const key = `${source.id}/index/${pages.length + 1}`;
    const payload = await fetchPayload(
      requestSource(source, key, pageUrl, "html", 2 * 1024 * 1024),
    );
    pages.push({ key, url: pageUrl.href, payload });
    const { cards, next } = togetherLibraryPage(payload.body);
    for (const card of cards) if (ids.has(card.id)) urls.add(card.url);
    pageUrl = next === undefined ? undefined : togetherNextLibraryPage(next, pageUrl);
  }
  if (pageUrl !== undefined)
    throw new Error("Together Model Library exceeded the reviewed page limit");
  assertItemCount("Together Serverless model cards", urls.size, pricing === undefined ? 1 : 0, 150);
  const [index, ...otherPages] = pages;
  if (index === undefined) throw new Error("Together Model Library omitted its index");
  const results = await mapConcurrent([...urls].sort(), 8, (href) => {
    const url = new URL(href);
    return fetchDocumentEntry(source, {
      key: `${source.id}${url.pathname}`,
      url,
      format: "html",
      maxResponseBytes: 1024 * 1024,
      optional: pricing === undefined,
      claimLocal: pricing === undefined,
    });
  });
  const documents = [
    ...otherPages,
    ...results.filter((result): result is FetchedDocument => "payload" in result),
  ];
  const body = JSON.stringify({
    index: { url: index.url, body: index.payload.body },
    documents: documents.map(({ url, payload }) => ({ url, body: payload.body })),
  });
  if (Buffer.byteLength(body) > source.maxResponseBytes)
    throw new Error("Together Model Library exceeded the aggregate byte limit");
  return {
    ...generatedFetchResult(body),
    dependencies: [
      observation(catalogKey, catalog),
      observation(index.key, index.payload),
      ...documents.map(({ key, payload }) => observation(key, payload)),
    ],
    dependencyFailures: results.filter(
      (result): result is DependencyFailure => "dependency_id" in result,
    ),
  };
}

async function fetchTogetherServerless(source: SourceManifest): Promise<FetchResult> {
  const { transport: _transport, ...documentsSource } = source;
  const documents = await fetchSource(documentsSource);
  const bundle = linkedBundleSchema.parse(json(documents.body));
  const ids = togetherMissingCacheIds(bundle.index.body);
  if (ids.size === 0) return documents;
  const library = await fetchTogetherModelLibrary(
    requestSource(
      source,
      `${source.id}/price-cards`,
      new URL("https://www.together.ai/models"),
      "html",
      source.maxResponseBytes,
    ),
    source.url,
    {
      catalog: { ...documents, body: bundle.index.body, contentHash: sha256(bundle.index.body) },
      ids,
    },
  );
  const cards = linkedBundleSchema.parse(json(library.body));
  const body = JSON.stringify({
    ...bundle,
    documents: [...bundle.documents, cards.index, ...cards.documents],
  });
  if (Buffer.byteLength(body) > source.maxResponseBytes)
    throw new Error("Together pricing evidence exceeded aggregate byte limit");
  return {
    ...generatedFetchResult(body),
    dependencies: [...documents.dependencies, ...library.dependencies],
    ...(documents.dependencyFailures === undefined
      ? {}
      : { dependencyFailures: documents.dependencyFailures }),
  };
}

async function fetchFireworksServerless(source: SourceManifest): Promise<FetchResult> {
  const { transport: _transport, ...documentsSource } = source;
  const documents = await fetchSource(documentsSource);
  const bundle = linkedBundleSchema.parse(json(documents.body));
  const targets = fireworksConsoleTargets(bundle);
  assertItemCount("Fireworks console profiles", targets.length, 1, 100);
  const profiles = await mapConcurrent(targets, 4, async ({ url }) => {
    const key = `${source.id}/console/${sha256(url)}`;
    const payload = await fetchPayload(
      requestSource(source, key, checkedUrl(url, source), "html", 4 * 1024 * 1024),
    );
    return { key, url, payload };
  });
  const body = JSON.stringify({
    ...bundle,
    documents: [
      ...bundle.documents,
      ...profiles.map(({ url, payload }) => ({ url, body: payload.body })),
    ],
  });
  if (Buffer.byteLength(body) > source.maxResponseBytes)
    throw new Error("Fireworks pricing evidence exceeded aggregate byte limit");
  return {
    ...documents,
    body,
    contentHash: sha256(body),
    dependencies: [
      ...documents.dependencies,
      ...profiles.map(({ key, payload }) => observation(key, payload)),
    ],
  };
}

async function fetchNvidiaCards(
  source: SourceManifest,
  previousModelIds: readonly string[],
): Promise<FetchResult> {
  const index = await fetchPayload(
    requestSource(source, `${source.id}/index`, new URL(source.url), "json", 1024 * 1024),
  );
  const documents: { url: string; body: string }[] = [];
  const dependencies = [observation(`${source.id}/index`, index)];
  const slugs = new Set(nvidiaNimCardUrls(index.body).map((url) => new URL(url).pathname.slice(1)));
  const names = new Set<string>();
  let pages = 1,
    total: number | undefined;
  for (let page = 0; page < pages; page++) {
    const url = checkedUrl(nvidiaBuildUrl(page).href, source);
    const payload = await fetchPayload(
      requestSource(source, `${source.id}/build/${page}`, url, "json", 4 * 1024 * 1024),
    );
    const parsed = nvidiaBuildPage(payload.body, page);
    assertSourceConstraint(
      "NVIDIA Build changed totals during pagination",
      total === undefined || total === parsed.total,
      page,
    );
    pages = parsed.pages;
    total = parsed.total;
    for (const name of parsed.names) {
      assertSourceConstraint(
        "NVIDIA Build repeated an endpoint across pages",
        !names.has(name),
        name,
      );
      names.add(name);
    }
    for (const slug of parsed.slugs) slugs.add(slug);
    documents.push({ url: url.href, body: payload.body });
    dependencies.push(observation(`${source.id}/build/${page}`, payload));
  }
  assertItemCount("NVIDIA endpoint profiles", slugs.size, 1, 180);
  const previous = previousModelIds.slice(0, 180);
  for (const slug of previous.flatMap(nvidiaNimCandidateSlugs)) {
    if (slugs.size === 180) break;
    slugs.add(slug);
  }
  // Endpoint names are unique within the public NGC namespace; publishers still qualify identity.
  const requests = new Map([...slugs].map((slug) => [slug.split("/")[1], slug]));
  const results = await mapConcurrent([...requests.values()], 8, async (slug) => {
    const name = slug.split("/")[1];
    const base = nvidiaEndpointBase + name;
    const key = `${source.id}/endpoint/${name}`;
    try {
      const metadata = await fetchPayload(
        requestSource(source, key, checkedUrl(base, source), "json", 1024 * 1024),
      );
      const spec = await fetchPayload(
        requestSource(
          source,
          key + "/spec",
          checkedUrl(base + "/spec", source),
          "json",
          4 * 1024 * 1024,
        ),
      );
      return {
        documents: [
          { url: base, body: metadata.body },
          { url: base + "/spec", body: spec.body },
        ],
        dependencies: [observation(key, metadata), observation(key + "/spec", spec)],
      };
    } catch {
      const url = checkedUrl(`https://build.nvidia.com/${slug}`, source);
      try {
        const payload = await fetchPayload(
          requestSource(source, key + "/card", url, "html", 4 * 1024 * 1024),
        );
        return {
          documents: [{ url: url.href, body: payload.body }],
          dependencies: [observation(key + "/card", payload)],
        };
      } catch (error) {
        return {
          failure: { dependency_id: key, impact: "claim" as const, ...sourceFailure(error) },
        };
      }
    }
  });
  for (const result of results)
    if (result.documents !== undefined && result.dependencies !== undefined) {
      documents.push(...result.documents);
      dependencies.push(...result.dependencies);
    }
  const body = JSON.stringify({
    index: { url: source.url, body: index.body },
    documents,
    ...(previous.length === 0 ? {} : { previousModelIds: previous }),
  });
  if (Buffer.byteLength(body) > source.maxResponseBytes)
    throw new Error("NVIDIA endpoint bundle exceeded aggregate byte limit");
  return {
    ...generatedFetchResult(body),
    dependencies,
    dependencyFailures: results.flatMap((result) => ("failure" in result ? [result.failure] : [])),
  };
}

async function fetchConfiguredDocuments(
  source: SourceManifest,
  label: string,
): Promise<{
  documents: FetchedDocument[];
  dependencyFailures: DependencyFailure[];
}> {
  const crawl = source.linkedDocuments;
  if (
    crawl === undefined ||
    crawl.nestedIndexes !== undefined ||
    crawl.minDocuments !== 0 ||
    crawl.maxDocuments !== 0
  )
    throw new Error(`${label} documentation bundle is not reviewed`);
  const entries = (crawl.documents ?? []).map((document) => documentEntry(source, document));
  const documents = await mapConcurrent(entries, crawl.concurrency, (entry) =>
    fetchDocumentEntry(source, entry),
  );
  return {
    documents: documents.filter((document): document is FetchedDocument => "payload" in document),
    dependencyFailures: documents.filter(
      (document): document is DependencyFailure => "dependency_id" in document,
    ),
  };
}

const vercelBatchGuidePath = "/docs/ai-gateway/models-and-providers/batch-processing.md";

function vercelBatchOnlyIds(
  ids: readonly string[],
  documents: readonly FetchedDocument[],
): string[] {
  const guide = documents.find(({ url }) => new URL(url).pathname === vercelBatchGuidePath);
  if (guide === undefined) return [];
  const prose = guide.payload.body.replace(/\s+/g, " ");
  if (
    !prose.includes("The IDs that end in `-batch` are the complete list of batch-capable models") ||
    !prose.includes("Synchronous requests don't accept `-batch` IDs")
  )
    return [];
  return ids.filter((id) => id.endsWith("-batch"));
}

async function fetchVercelModels(source: SourceManifest): Promise<FetchResult> {
  const transport = source.transport;
  const extractor = source.extractor;
  if (transport?.kind !== "vercel-models" || extractor.kind !== "vercel-catalog")
    throw new Error("Invalid Vercel models transport");
  const indexKey = `${source.id}/index`;
  const [index, documentation] = await Promise.all([
    fetchPayload(
      requestSource(
        source,
        indexKey,
        checkedUrl(source.url, source),
        "json",
        source.maxResponseBytes,
      ),
    ),
    fetchConfiguredDocuments(source, "Vercel"),
  ]);
  const list = recognizeValue("Vercel model index", vercelModelsTransportSchema, json(index.body));
  assertItemCount(
    "Vercel models transport",
    list.data.length,
    extractor.minModels,
    extractor.maxModels,
  );
  const ids = list.data.map(({ id }) => id);
  assertSourceConstraint("Vercel model IDs were not unique", new Set(ids).size === ids.length, ids);
  const slugOwners = new Map<string, string>();
  for (const id of ids) {
    const slug = id.split("/")[1];
    assertSourceConstraint("Vercel model ID omitted its slug", slug !== undefined, id);
    const owner = slugOwners.get(slug);
    assertSourceConstraint(
      `Vercel model page slug ${slug} was ambiguous`,
      owner === undefined || owner === id,
      id,
    );
    slugOwners.set(slug, id);
  }

  const batchOnlyIds = new Set(vercelBatchOnlyIds(ids, documentation.documents));
  const endpointDocuments = await mapConcurrent(
    ids.filter((id) => !batchOnlyIds.has(id)),
    transport.concurrency,
    async (id) => {
      const key = `${source.id}/endpoints/${sha256(id)}`;
      const url = checkedUrl(`${source.url}/${id}/endpoints`, source);
      if (url.hostname !== "ai-gateway.vercel.sh" || url.pathname !== `/v1/models/${id}/endpoints`)
        throw new Error("Vercel endpoint URL left the reviewed API path");
      try {
        const raw = await fetchPayload(
          requestSource(source, key, url, "json", transport.maxEndpointBytes),
        );
        const { body, searchModelId } = normalizeVercelEndpointResponse(raw.body);
        const payload = { ...raw, body, contentHash: sha256(body) };
        return { key, url: url.href, payload, searchModelId };
      } catch (error) {
        return { dependency_id: key, impact: "claim" as const, ...sourceFailure(error) };
      }
    },
  );

  const modelPageBase = checkedUrl(transport.modelPageBaseUrl, source);
  if (modelPageBase.href !== "https://vercel.com/ai-gateway/models/")
    throw new Error("Vercel model-page base URL is not reviewed");
  const searchModels = new Set(
    endpointDocuments.flatMap((document) =>
      "dependency_id" in document || document.searchModelId === undefined
        ? []
        : [document.searchModelId],
    ),
  );
  const missing = list.data.filter(
    ({ id, pricing }) =>
      Object.keys(pricing).every((key) => key === "request") || searchModels.has(id),
  );
  assertItemCount(
    "Vercel model pricing pages",
    missing.length,
    transport.minModelPages,
    transport.maxModelPages,
  );
  const modelPages = await mapConcurrent(
    missing,
    transport.concurrency,
    async ({ id, pricing }) => {
      const slug = id.split("/")[1];
      assertSourceConstraint("Vercel model ID omitted its page slug", slug !== undefined, id);
      const key = `${source.id}/model-page/${sha256(id)}`;
      const url = checkedUrl(new URL(slug, modelPageBase).href, source);
      if (url.hostname !== "vercel.com" || url.pathname !== `/ai-gateway/models/${slug}`)
        throw new Error("Vercel model page left the reviewed path");
      try {
        const raw = await fetchPayload(
          requestSource(source, key, url, "html", transport.maxModelPageBytes),
        );
        const body = normalizeVercelModelPage(
          raw.body,
          Object.keys(pricing).length > 0 && searchModels.has(id),
        );
        const payload = { ...raw, body, contentHash: sha256(body) };
        return { key, url: url.href, payload, rawBody: raw.body };
      } catch (error) {
        return { dependency_id: key, impact: "claim" as const, ...sourceFailure(error) };
      }
    },
  );

  const fetchedModelPages = modelPages.flatMap((document) =>
    "dependency_id" in document ? [] : [document],
  );
  const pricingScriptUrls = vercelPricingScriptUrls(
    fetchedModelPages.map(({ rawBody }) => rawBody),
    source,
  );
  assertItemCount(
    "Vercel model pricing scripts",
    pricingScriptUrls.length,
    0,
    transport.maxPricingScripts,
  );
  const pricingScriptCandidates = await mapConcurrent(
    pricingScriptUrls,
    transport.concurrency,
    async (url) => {
      const key = `${source.id}/model-page-pricing/${sha256(url.href)}`;
      try {
        const raw = await fetchPayload(
          requestSource(source, key, url, "mixed", transport.maxPricingScriptBytes),
        );
        const body = normalizeVercelPricingScript(raw.body);
        if (body === undefined) return undefined;
        return { key, url: url.href, payload: { ...raw, body, contentHash: sha256(body) } };
      } catch (error) {
        return { dependency_id: key, impact: "claim" as const, ...sourceFailure(error) };
      }
    },
  );
  const pricingScripts = pricingScriptCandidates.flatMap((document) =>
    document === undefined || "dependency_id" in document ? [] : [document],
  );
  const missingPricingRegistry =
    pricingScripts.length === 0 &&
    fetchedModelPages.some(({ rawBody }) => /\+\d+ more/u.test(rawBody));
  const pricingScriptFailures = pricingScriptCandidates.flatMap((document) =>
    document !== undefined && "dependency_id" in document ? [document] : [],
  );

  const fetched = [...endpointDocuments, ...modelPages, ...pricingScripts];
  const dependencyFailures: DependencyFailure[] = [
    ...documentation.dependencyFailures,
    ...fetched.flatMap((document) => ("dependency_id" in document ? [document] : [])),
    ...pricingScriptFailures,
    ...(missingPricingRegistry && pricingScriptFailures.length === 0
      ? [
          {
            dependency_id: `${source.id}/model-page-pricing`,
            impact: "claim" as const,
            outcome: "parse_failed" as const,
            message: "Expanded model pricing registry was not recognized",
          },
        ]
      : []),
  ];
  const documents = [
    ...fetched.flatMap((document) => ("dependency_id" in document ? [] : [document])),
    ...documentation.documents,
  ];
  const body = JSON.stringify({
    index: { url: source.url, body: index.body },
    documents: documents.map(({ url, payload }) => ({ url, body: payload.body })),
  });
  if (Buffer.byteLength(body) > source.maxResponseBytes)
    throw new Error("Vercel models bundle exceeded byte limit");
  return {
    body,
    contentHash: sha256(body),
    etag: index.etag,
    lastModified: index.lastModified,
    dependencies: [
      observation(indexKey, index),
      ...documents.map(({ key, payload }) => observation(key, payload)),
    ],
    ...(dependencyFailures.length === 0 ? {} : { dependencyFailures }),
  };
}

function ollamaCloudIds(body: string): string[] {
  const $ = load(body);
  const ids = new Set<string>();
  $('a[href^="/library/"]').each((_index, element) => {
    const anchor = $(element);
    if (
      !anchor
        .find('span[class*="bg-cyan"]')
        .toArray()
        .some((badge) => $(badge).text().trim() === "cloud")
    )
      return;
    const match = anchor.attr("href")?.match(/^\/library\/([a-z0-9][a-z0-9._-]*)$/i);
    if (match?.[1] === undefined) return;
    const id = modelIdSchema.safeParse(match[1]);
    if (id.success) ids.add(id.data);
  });
  return [...ids].sort();
}

function json(body: string): unknown {
  return parseSourceJson(body);
}

function normalizedText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeVercelModelPage(body: string, searchOnly = false): string {
  const $ = load(body);
  const title = normalizedText($("h1").first().text());
  const { prices: searchPrices, modelObserved } = vercelPageSearchPrices(body);
  if (searchOnly) {
    assertSourceConstraint(
      "Vercel model page omitted its backing-model pricing payload",
      title !== "" && modelObserved,
      body,
    );
    return JSON.stringify({ title, search_prices: searchPrices });
  }
  const tables = $("table");
  assertSourceConstraint(
    "Vercel model page changed its primary pricing table",
    title !== "" && tables.length >= 3 && normalizedText(tables.eq(0).text()) === "Provider",
    body,
  );
  const headers = [
    "Provider",
    ...tables
      .eq(1)
      .find("th,td")
      .map((_index, cell) => normalizedText($(cell).text()))
      .get(),
  ];
  const cells = tables.eq(2).find("td");
  const values = cells.map((_index, cell) => normalizedText($(cell).text())).get();
  if (headers.at(-1) === "" && values.at(-1) === "") {
    headers.pop();
    values.pop();
  }
  assertSourceConstraint(
    "Vercel model page pricing columns changed shape",
    headers.length === values.length &&
      headers.every((header) => header !== "") &&
      new Set(headers).size === headers.length,
    body,
  );
  const providerLinks = cells
    .eq(0)
    .find('a[href^="/ai-gateway/models/providers/"]')
    .map((_index, anchor) => $(anchor).attr("href"))
    .get();
  assertSourceConstraint(
    "Vercel model page omitted its route provider",
    providerLinks.length === 1,
    providerLinks,
  );
  const provider = providerLinks[0]?.match(/^\/ai-gateway\/models\/providers\/([^/]+)$/)?.[1];
  assertSourceConstraint(
    "Vercel model page route provider changed shape",
    provider !== undefined,
    providerLinks,
  );
  const titles = cells
    .toArray()
    .slice(0, values.length)
    .map((cell) =>
      $(cell)
        .find("[title]")
        .map((_titleIndex, titled) => normalizedText($(titled).attr("title") ?? ""))
        .get()
        .filter((value) => value !== ""),
    );
  const inputColumn = headers.indexOf("Input");
  if (inputColumn >= 0 && values[inputColumn] === "") {
    const [summary, duplicate] = $("dt")
      .filter(
        (_index, label) => normalizedText($(label).find('[aria-hidden="true"]').text()) === "Price",
      )
      .next("dd")
      .map((_index, price) => normalizedText($(price).children(".sr-only").text()))
      .get();
    const hourly = summary?.match(/^\$((?:0|[1-9]\d*)(?:\.\d+)?), Per hour of audio$/);
    if (hourly?.[1] !== undefined && duplicate === undefined) {
      values[inputColumn] = `$${hourly[1]}/hr`;
      titles[inputColumn] = ["Per hour of audio"];
    }
  }
  return JSON.stringify({
    title,
    provider,
    headers,
    values,
    titles,
    ...(searchPrices.length === 0 ? {} : { search_prices: searchPrices }),
  });
}

const vercelPricingScriptPath =
  /^\/vc-ap-vercel-marketing\/_next\/static\/immutable\/chunks\/[A-Za-z0-9_-]+\.js$/u;

function vercelPricingScriptUrls(bodies: readonly string[], source: SourceManifest): URL[] {
  const urls = new Map<string, URL>();
  for (const body of bodies) {
    const $ = load(body);
    $("script[src]").each((_index, element) => {
      const src = $(element).attr("src");
      if (src === undefined) return;
      try {
        const url = checkedUrl(new URL(src, "https://vercel.com").href, source);
        if (
          url.hostname !== "vercel.com" ||
          url.port !== "" ||
          url.username !== "" ||
          url.password !== "" ||
          url.search !== "" ||
          url.hash !== "" ||
          !vercelPricingScriptPath.test(url.pathname)
        )
          return;
        urls.set(url.href, url);
      } catch {
        return;
      }
    });
  }
  return [...urls.values()].sort((left, right) => left.href.localeCompare(right.href));
}

const vercelDecimalPattern = String.raw`(?:0|[1-9]\d*)(?:\.\d+)?`;

function exactObjectList<T>(
  body: string,
  pattern: RegExp,
  normalize: (match: RegExpMatchArray) => T | undefined,
): T[] | undefined {
  const matches = [...body.matchAll(pattern)];
  if (matches.length === 0 || matches.map((match) => match[0]).join(",") !== body) return undefined;
  const values: T[] = [];
  for (const match of matches) {
    const value = normalize(match);
    if (value === undefined) return undefined;
    values.push(value);
  }
  return values;
}

function setVercelPricingDetail(
  models: Map<string, Record<string, unknown>>,
  slug: string,
  key: string,
  value: unknown,
): void {
  const model = models.get(slug) ?? {};
  const previous = model[key];
  assertSourceConstraint(
    `Vercel pricing script disagreed for ${slug}:${key}`,
    previous === undefined || JSON.stringify(previous) === JSON.stringify(value),
    value,
  );
  model[key] = value;
  models.set(slug, model);
}

export function normalizeVercelPricingScript(body: string): string | undefined {
  const models = new Map<string, Record<string, unknown>>();
  const contracts = vercelPricingContracts(body);
  const videoRegistry = new RegExp(
    String.raw`(?:"([a-z0-9][a-z0-9._-]*)"|([a-z][a-z0-9_]*)):\{videoCost:"(${vercelDecimalPattern})",videoDimensionPricing:\[([^\]]+)\]\}`,
    "gu",
  );
  const videoItem = new RegExp(
    String.raw`\{quality:"([^"]+)"(?:,resolution:"([^"]+)")?,hasVideoInput:!(0|1),cost:"(${vercelDecimalPattern})",costUnit:"sec"\}`,
    "gu",
  );
  for (const registry of body.matchAll(videoRegistry)) {
    const slug = registry[1] ?? registry[2];
    const primary = registry[3];
    const rawItems = registry[4];
    if (slug === undefined || primary === undefined || rawItems === undefined) continue;
    const items = exactObjectList(rawItems, videoItem, (match) => {
      const quality = match[1];
      const resolution = match[2];
      const videoInput = match[3];
      const price = match[4];
      if (quality === undefined || videoInput === undefined || price === undefined)
        return undefined;
      return {
        price,
        quality,
        ...(resolution === undefined ? {} : { resolution }),
        video_input: videoInput === "0",
      };
    });
    if (items === undefined || items.length < 2 || !items.some(({ price }) => price === primary))
      continue;
    setVercelPricingDetail(models, slug, "video_generation", items);
  }

  const imageRegistries = [false, true].map(
    (wrapped) =>
      new RegExp(
        String.raw`(?:"([a-z0-9][a-z0-9._-]*)"|([a-z][a-z0-9_]*)):\{${wrapped ? "model:\\{" : ""}imageCost:"(${vercelDecimalPattern})",imageDimensionQualityPricing:\[([^\]]+)\]\}${wrapped ? "\\}" : ""}`,
        "gu",
      ),
  );
  const imageItem = new RegExp(
    String.raw`\{size:"([^"]+)",quality:"([^"]+)",cost:"(${vercelDecimalPattern})"\}`,
    "gu",
  );
  const imageRegistryMatches = imageRegistries
    .flatMap((pattern) => [...body.matchAll(pattern)])
    .sort((left, right) => left.index - right.index);
  let imageRegistryEnd = 0;
  for (const registry of imageRegistryMatches) {
    if (registry.index < imageRegistryEnd) continue;
    imageRegistryEnd = registry.index + registry[0].length;
    const slug = registry[1] ?? registry[2];
    const primary = registry[3];
    const rawItems = registry[4];
    if (slug === undefined || primary === undefined || rawItems === undefined) continue;
    const items = exactObjectList(rawItems, imageItem, (match) => {
      const resolution = match[1];
      const quality = match[2];
      const price = match[3];
      return resolution === undefined || quality === undefined || price === undefined
        ? undefined
        : { price, resolution, quality };
    });
    if (items === undefined || items.length < 2 || !items.some(({ price }) => price === primary))
      continue;
    setVercelPricingDetail(models, slug, "image_generation", items);
  }

  const searchRegistry = new RegExp(
    String.raw`(?:"([a-z0-9][a-z0-9._-]*)"|([a-z][a-z0-9_]*)):\{inputCost:"${vercelDecimalPattern}",outputCost:"${vercelDecimalPattern}",webSearchCallCost:"(${vercelDecimalPattern})",webSearchRequestPricing:\[([^\]]+)\]\}`,
    "gu",
  );
  const searchItem = new RegExp(
    String.raw`\{contextSize:"([^"]+)",cost:"(${vercelDecimalPattern})"\}`,
    "gu",
  );
  for (const registry of body.matchAll(searchRegistry)) {
    const slug = registry[1] ?? registry[2];
    const primary = registry[3];
    const rawItems = registry[4];
    if (slug === undefined || primary === undefined || rawItems === undefined) continue;
    const items = exactObjectList(rawItems, searchItem, (match) => {
      const contextTier = match[1];
      const price = match[2];
      return contextTier === undefined || price === undefined
        ? undefined
        : { price, context_tier: contextTier };
    });
    if (items === undefined || items.length < 2 || !items.some(({ price }) => price === primary))
      continue;
    setVercelPricingDetail(models, slug, "web_search", items);
  }

  if (models.size === 0 && Object.keys(contracts).length === 0) return undefined;
  return JSON.stringify({
    models: Object.fromEntries([...models].sort(([left], [right]) => left.localeCompare(right))),
    ...(Object.keys(contracts).length === 0 ? {} : { contracts }),
  });
}

export function normalizeVercelEndpointResponse(body: string): {
  body: string;
  searchModelId: string | undefined;
} {
  const parsed = recognizeValue(
    "Vercel endpoint response",
    vercelEndpointTransportSchema,
    json(body),
  );
  const endpoints = parsed.data.endpoints
    .map(
      ({
        uptime_last_15m: _uptime15m,
        uptime_last_1h: _uptime1h,
        uptime_last_1d: _uptime1d,
        latency_last_1h: _latency,
        throughput_last_1h: _throughput,
        ...stable
      }) => stable,
    )
    .sort((left, right) =>
      `${left.provider_name}\0${left.name}`.localeCompare(`${right.provider_name}\0${right.name}`),
    );
  const hasSearchPricing = endpoints.some(
    ({ pricing }) =>
      pricing !== null &&
      typeof pricing === "object" &&
      (Reflect.get(pricing, "x_search_post") !== undefined ||
        Reflect.get(pricing, "x_search_user") !== undefined),
  );
  return {
    body: JSON.stringify({ data: { ...parsed.data, endpoints } }),
    searchModelId: hasSearchPricing ? parsed.data.id : undefined,
  };
}

export function normalizeOllamaList(body: string): string {
  const value = json(body);
  const parsed = ollamaListSchema.safeParse(value);
  return JSON.stringify(parsed.success ? sortedOllamaList(parsed.data) : value);
}

function sortedOllamaList(list: z.infer<typeof ollamaListSchema>) {
  return {
    ...list,
    models: list.models.sort((left, right) =>
      ollamaListKey(left).localeCompare(ollamaListKey(right)),
    ),
  };
}

function ollamaListKey(value: unknown): string {
  if (value !== null && typeof value === "object") {
    const model = Reflect.get(value, "model");
    if (typeof model === "string") return `0\0${model}`;
  }
  return `1\0${JSON.stringify(value)}`;
}

export function normalizeOllamaResponse(status: 200 | 404 | 410, body: string): unknown {
  let value: unknown;
  try {
    value = json(body);
  } catch (error) {
    if (status !== 200) throw new SourceFetchError(`HTTP ${status}`, status);
    throw error;
  }
  if (status !== 410) return value;
  if (value === null || typeof value !== "object") return value;
  const error = Reflect.get(value, "error");
  if (typeof error !== "string") return value;
  return { ...value, error: error.replace(/ \(ref: [0-9a-f-]{36}\)$/, "") };
}

function directOllamaCloudId(value: string): string | undefined {
  const id = value.endsWith("-cloud")
    ? value.slice(0, -"-cloud".length)
    : value.endsWith(":cloud")
      ? value.slice(0, -":cloud".length)
      : undefined;
  if (id === undefined) return;
  const parsed = modelIdSchema.safeParse(id);
  return parsed.success ? parsed.data : undefined;
}

export function normalizeOllamaModelPage(model: string, body: string): string {
  const family = modelIdSchema.parse(model);
  const $ = load(body);
  const title = normalizedText($("title").first().text());
  const tagTexts = new Map<string, string[]>();
  $('a[href^="/library/"]').each((_index, element) => {
    const href = $(element).attr("href");
    const raw = href?.match(/^\/library\/([a-z0-9][a-z0-9._:-]*)$/i)?.[1];
    if (raw === undefined || !raw.startsWith(`${family}:`)) return;
    const id = directOllamaCloudId(raw);
    if (id === undefined) return;
    const values = tagTexts.get(id) ?? [];
    values.push(normalizedText($(element).text()));
    tagTexts.set(id, values);
  });
  const tags = [...tagTexts]
    .map(([id, texts]) => {
      const labels = new Set(
        texts.flatMap((text) => {
          const match = text.match(/\b(Low|Medium|High|Extra High) Usage\b/i)?.[1];
          return match === undefined ? [] : [match.toLowerCase()];
        }),
      );
      const [label] = labels;
      return {
        model: id,
        ...(label === undefined ? {} : { label }),
        ...(texts.some((text) => /\bUsage\b/i.test(text)) && labels.size !== 1
          ? { usageText: texts.join(" ") }
          : {}),
      };
    })
    .sort((left, right) => left.model.localeCompare(right.model));
  const page = normalizedText($.root().text());
  const inputOnlyBilling = $("#display > p")
    .toArray()
    .some((element) => {
      const paragraph = $(element);
      return (
        normalizedText(paragraph.text()).endsWith(
          "Usage is billed per input token at the listed price.",
        ) && paragraph.find('a[href="https://ollama.com/pricing"]').text() === "listed price"
      );
    });
  const apiModels = new Set(
    $("pre")
      .toArray()
      .flatMap((element) => {
        const code = $(element).text().trim();
        if (!/^curl\s+https:\/\/ollama\.com\/api\/(?:chat|generate)(?:\s|$)/.test(code)) return [];
        return [...code.matchAll(/"model"\s*:\s*"([a-z0-9][a-z0-9._:-]*)"/gi)].flatMap(
          (match) => match[1] ?? [],
        );
      }),
  );
  const [apiModel] = apiModels;
  const costCard = /\bCost \/1M tokens\b/.test(page);
  const fields = ["input", "cached", "output"] as const;
  const periods = new Map<string, Set<string>>();
  $("button[data-rate]").each((_index, element) => {
    const key = $(element).attr("data-rate")?.trim().toLowerCase();
    const label = normalizedText($(element).text()).toLowerCase();
    const period =
      label === "off-peak" ? "off_peak" : label === "peak" || label === "base" ? label : undefined;
    if (key === undefined) return;
    const labels = periods.get(key) ?? new Set();
    labels.add(period ?? "unrecognized");
    periods.set(key, labels);
  });
  const tiered = new Map<string, Partial<Record<(typeof fields)[number], string>>>();
  $(".pricing-rate[data-rate]").each((_index, element) => {
    const rate = $(element).attr("data-rate")?.trim().toLowerCase();
    const label = normalizedText($(element).parent().children("div").last().text()).toLowerCase();
    const field = fields.find((candidate) => candidate === label);
    const amount = normalizedText($(element).text()).match(/^\$((?:0|[1-9]\d*)(?:\.\d+)?)$/)?.[1];
    if (rate === undefined || !/^[a-z][a-z0-9_-]*$/.test(rate) || amount === undefined) return;
    if (field === undefined) return;
    const values = tiered.get(rate) ?? {};
    values[field] = amount;
    tiered.set(rate, values);
  });
  const variants =
    tiered.size > 0
      ? [...tiered]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, values]) => {
            const labels = periods.get(key);
            const [period] = labels ?? [];
            if (
              (tiered.size > 1 || periods.size > 0) &&
              (labels?.size !== 1 || period === undefined || period === "unrecognized")
            )
              throw new Error("Ollama pricing period labels were missing or ambiguous");
            return { ...(period === undefined ? {} : { billing_period: period }), ...values };
          })
      : [
          Object.fromEntries(
            fields.flatMap((field) => {
              const amount = page.match(
                new RegExp(`\\$((?:0|[1-9]\\d*)(?:\\.\\d+)?)\\s*${field}\\b`),
              )?.[1];
              return amount === undefined ? [] : [[field, amount]];
            }),
          ),
        ];
  return JSON.stringify({
    model: family,
    ...(title === "" ? {} : { title }),
    tags,
    ...(apiModels.size === 1 && apiModel !== undefined ? { apiModel } : {}),
    ...(inputOnlyBilling ? { billing: "total_input_tokens_only" } : {}),
    ...(!costCard
      ? {}
      : {
          cost: {
            unit: "1M tokens",
            variants,
          },
        }),
  });
}

async function fetchOllamaCloud(source: SourceManifest): Promise<FetchResult> {
  const transport = source.transport;
  if (transport?.kind !== "ollama-cloud") throw new Error("Invalid Ollama cloud transport");
  const indexKey = `${source.id}/index`;
  const catalogKey = `${source.id}/catalog`;
  const indexUrl = checkedUrl(source.url, source);
  const catalogUrl = checkedUrl(transport.catalogUrl, source);
  if (catalogUrl.href !== "https://ollama.com/search?c=cloud")
    throw new Error("Ollama cloud catalog URL is not reviewed");
  const [indexResult, catalogResult, documentation] = await Promise.all([
    fetchDocumentEntry(source, {
      key: indexKey,
      url: indexUrl,
      format: "json",
      maxResponseBytes: source.maxResponseBytes,
      optional: true,
      claimLocal: true,
    }),
    fetchDocumentEntry(source, {
      key: catalogKey,
      url: catalogUrl,
      format: "html",
      maxResponseBytes: source.maxResponseBytes,
      optional: true,
      claimLocal: true,
    }),
    fetchConfiguredDocuments(source, "Ollama"),
  ]);
  const rawIndex = "payload" in indexResult ? indexResult.payload : undefined;
  const catalog = "payload" in catalogResult ? catalogResult.payload : undefined;
  const dependencyFailures: DependencyFailure[] = [
    ...documentation.dependencyFailures,
    ...[indexResult, catalogResult].flatMap((result) =>
      "dependency_id" in result ? [result] : [],
    ),
  ];
  if (rawIndex === undefined && catalog === undefined)
    throw new Error("Ollama Cloud inventory witnesses were unavailable");
  let list: z.infer<typeof ollamaListSchema> | undefined;
  if (rawIndex !== undefined)
    try {
      list = sortedOllamaList(
        recognizeValue("Ollama cloud model list", ollamaListSchema, json(rawIndex.body)),
      );
    } catch (error) {
      dependencyFailures.push({
        dependency_id: indexKey,
        impact: "claim",
        ...sourceFailure(error, "parse_failed"),
      });
    }
  const indexBody = JSON.stringify(list ?? {});
  const index: FetchPayload = {
    body: indexBody,
    contentHash: sha256(indexBody),
    etag: rawIndex?.etag,
    lastModified: rawIndex?.lastModified,
  };
  const listed = new Set(
    (list?.models ?? []).flatMap((item) => {
      if (item === null || typeof item !== "object") return [];
      const parsed = modelIdSchema.safeParse(Reflect.get(item, "model"));
      return parsed.success ? [parsed.data] : [];
    }),
  );
  assertItemCount("Ollama cloud transport list upper bound", listed.size, 0, transport.maxModels);
  const catalogIds = catalog === undefined ? [] : ollamaCloudIds(catalog.body);
  assertItemCount(
    "Ollama cloud transport catalog upper bound",
    catalogIds.length,
    0,
    transport.maxModels,
  );
  assertItemCount(
    "Ollama cloud transport independent inventory",
    Math.max(listed.size, catalogIds.length),
    transport.minModels,
    transport.maxModels,
  );
  const modelIds = [...new Set([...listed, ...catalogIds])].sort();
  const detailResults = await mapConcurrent(modelIds, transport.concurrency, async (model) => {
    const key = `${source.id}/show/${sha256(model)}`;
    try {
      const showSource = {
        ...requestSource(source, key, new URL("https://ollama.com/api/show"), "json", 256 * 1024),
      } satisfies SourceManifest;
      const payload = await fetchPost(showSource, JSON.stringify({ model }));
      const body = JSON.stringify(normalizeOllamaResponse(payload.status, payload.body));
      return { key, model, payload: { ...payload, body, contentHash: sha256(body) } };
    } catch (error) {
      return { dependency_id: key, impact: "claim" as const, ...sourceFailure(error) };
    }
  });
  const details = detailResults.flatMap((item) => ("dependency_id" in item ? [] : [item]));
  dependencyFailures.push(...detailResults.filter((item) => "dependency_id" in item));
  const modelPageBase = checkedUrl(transport.modelPageBaseUrl, source);
  if (modelPageBase.href !== "https://ollama.com/library/")
    throw new Error("Ollama model-page base URL is not reviewed");
  const pricingDocument = documentation.documents.find(({ url }) => url === ollamaPricingUrl);
  const familyPages = [
    ...new Set([...catalogIds, ...ollamaPricedModelPageIds(pricingDocument?.payload.body ?? "")]),
  ].sort();
  assertItemCount(
    "Ollama cloud transport family pages",
    familyPages.length,
    0,
    transport.maxModels,
  );
  const taggedPages = [...listed].flatMap((id) => {
    const [family, tag] = id.split(":");
    return family !== undefined && tag !== undefined && familyPages.includes(family)
      ? [`${id}-cloud`]
      : [];
  });
  const pageIds = [...new Set([...familyPages, ...taggedPages])].sort();
  const pageResults = await mapConcurrent(pageIds, transport.concurrency, async (model) => {
    const key = `${source.id}/model-page/${sha256(model)}`;
    try {
      const url = checkedUrl(new URL(`/library/${model}`, modelPageBase).href, source);
      if (url.hostname !== "ollama.com" || url.pathname !== `/library/${model}`) return;
      const raw = await fetchPayload(
        requestSource(source, key, url, "html", transport.maxModelPageBytes),
      );
      const body = normalizeOllamaModelPage(model, raw.body);
      return { key, model, url: url.href, payload: { ...raw, body, contentHash: sha256(body) } };
    } catch (error) {
      return { dependency_id: key, impact: "claim" as const, ...sourceFailure(error) };
    }
  });
  const pages = pageResults.flatMap((item) =>
    item === undefined || "dependency_id" in item ? [] : [item],
  );
  dependencyFailures.push(
    ...pageResults.flatMap((item) => (item !== undefined && "dependency_id" in item ? [item] : [])),
  );
  const documents = documentation.documents;
  const body = JSON.stringify({
    list: list ?? {},
    ...(catalog === undefined ? {} : { catalog: { url: catalogUrl.href, body: catalog.body } }),
    pages: pages.map(({ model, url, payload }) => ({
      model,
      url,
      body: json(payload.body),
    })),
    details: details.map(({ model, payload }) => ({
      model,
      status: payload.status,
      body: json(payload.body),
    })),
    documents: documents.map(({ url, payload }) => ({ url, body: payload.body })),
  });
  if (Buffer.byteLength(body) > source.maxResponseBytes)
    throw new Error("Ollama cloud bundle exceeded byte limit");
  return {
    body,
    contentHash: sha256(body),
    etag: index.etag,
    lastModified: index.lastModified,
    dependencies: [
      ...(rawIndex === undefined ? [] : [observation(indexKey, index)]),
      ...(catalog === undefined ? [] : [observation(catalogKey, catalog)]),
      ...pages.map(({ key, payload }) => observation(key, payload)),
      ...details.map(({ key, payload }) => observation(key, payload)),
      ...documents.map(({ key, payload }) => observation(key, payload)),
    ],
    ...(dependencyFailures.length === 0 ? {} : { dependencyFailures }),
  };
}

// Shared only for one provider attempt. Retain the three public discovery inputs
// in memory so regional API discovery can overlap SDK detail acquisition.
export type SagemakerDiscoveryCache = Map<string, Promise<FetchPayload>>;

function sagemakerDiscoveryPayload(
  source: SourceManifest,
  cache: SagemakerDiscoveryCache | undefined,
): Promise<FetchPayload> {
  if (
    cache === undefined ||
    source.auth !== undefined ||
    source.access !== "public" ||
    ![sagemakerCatalogUrl, sagemakerOpenManifestUrl, sagemakerManifestUrl].includes(source.url)
  )
    return fetchPayload(source);
  const url = checkedUrl(source.url, source);
  const key = JSON.stringify([url.href, source.format, source.maxResponseBytes]);
  let payload = cache.get(key);
  if (payload === undefined) {
    // Sharing cannot widen another source's redirect policy.
    payload = fetchPayload({ ...source, allowedHosts: [url.hostname] });
    cache.set(key, payload);
  }
  return payload;
}

async function fetchDashscopePricing(source: SourceManifest): Promise<FetchResult> {
  const { transport, ...documentsSource } = source;
  if (transport?.kind !== "dashscope-pricing") throw new Error("Invalid DashScope transport");
  const documents = await fetchSource(documentsSource);
  const bundle = linkedBundleSchema.parse(json(documents.body));
  const regions = await mapConcurrent(
    dashscopeMarketRegions,
    transport.concurrency,
    async (region) => {
      const contexts = [];
      const dependencies: FetchObservation[] = [];
      for (const scope of region.scopes) {
        const models: unknown[] = [];
        const ids = new Set<string>();
        let total: number | undefined;
        for (let pageNo = 1; ; pageNo += 1) {
          assertItemCount("DashScope market pages", pageNo, 1, transport.maxPages);
          const request = dashscopeMarketRequest(region, scope, pageNo, transport.pageSize);
          const url = checkedUrl(request.url.href, source);
          const value = await cloudJson(
            "DashScope public market",
            url,
            source.maxResponseBytes,
            [],
            {
              form: request.form,
            },
          );
          const page = dashscopeMarketPage(value);
          total ??= page.total;
          assertItemCount("DashScope market models", total, 1, transport.maxModelsPerContext);
          assertSourceConstraint(
            "DashScope market pagination changed",
            page.total === total &&
              page.pageNo === pageNo &&
              page.pageSize === transport.pageSize &&
              page.list.length === Math.min(transport.pageSize, total - models.length),
            value,
            [],
          );
          for (const row of page.list) {
            const identity = dashscopeMarketIdentity(row);
            assertSourceConstraint(
              "DashScope market repeated or foreign model",
              !ids.has(identity.model) && identity.serviceSites.includes(scope.id),
              row,
              ["model"],
            );
            ids.add(identity.model);
            models.push(row);
          }
          dependencies.push({
            key: `${source.id}/market/${region.id}/${scope.id}/${pageNo}`,
            contentHash: sha256(JSON.stringify(value)),
            etag: undefined,
            lastModified: undefined,
          });
          if (models.length === total) break;
        }
        contexts.push({ region: region.id, scope: scope.id, models });
      }
      return { contexts, dependencies };
    },
  );
  const body = JSON.stringify({ ...bundle, market: regions.flatMap(({ contexts }) => contexts) });
  if (Buffer.byteLength(body) > source.maxResponseBytes)
    throw new Error("DashScope pricing bundle exceeded byte limit");
  return {
    ...generatedFetchResult(body),
    dependencies: [
      ...documents.dependencies,
      ...regions.flatMap(({ dependencies }) => dependencies),
    ],
    ...(documents.dependencyFailures === undefined
      ? {}
      : {
          dependencyFailures: documents.dependencyFailures,
        }),
  };
}

export async function fetchSource(
  source: SourceManifest,
  discoveryCache?: SagemakerDiscoveryCache,
  previousModelIds: readonly string[] = [],
): Promise<FetchResult> {
  if (source.transport?.kind === "dashscope-pricing") return fetchDashscopePricing(source);
  if (source.transport?.kind === "together-serverless") return fetchTogetherServerless(source);
  if (source.transport?.kind === "fireworks-serverless") return fetchFireworksServerless(source);
  if (source.transport?.kind === "nvidia-nim-cards")
    return fetchNvidiaCards(source, previousModelIds);
  const readDiscovery = (input: SourceManifest) => sagemakerDiscoveryPayload(input, discoveryCache);
  if (source.transport?.kind === "sagemaker-marketplace-pricing")
    return fetchSagemakerMarketplaceApi(source, readDiscovery, (request, body, send) =>
      fetchPost({ ...source, maxResponseBytes: 4 * 1024 * 1024 }, body, send, request),
    );
  if (source.transport?.kind === "sagemaker-sdk") return fetchSagemakerSdk(source, readDiscovery);
  if (source.transport?.kind === "aws-sagemaker") {
    const { auth: _auth, ...publicSource } = source;
    const catalog = await readDiscovery({
      ...publicSource,
      url: sagemakerCatalogUrl,
      access: "public",
      format: "html",
      maxResponseBytes: 4 * 1024 * 1024,
    });
    const openManifest = await readDiscovery({
      ...publicSource,
      url: sagemakerOpenManifestUrl,
      access: "public",
      format: "json",
      maxResponseBytes: 32 * 1024 * 1024,
    });
    const rows = sagemakerRows(catalog.body);
    const proprietary = await readDiscovery({
      ...publicSource,
      url: sagemakerManifestUrl,
      access: "public",
      format: "json",
      maxResponseBytes: 4 * 1024 * 1024,
    });
    const ids = new Set([
      ...rows.map((row) => row.id),
      ...sagemakerOpenSpecs(openManifest.body, rows).map((header) => header.model_id),
      ...sagemakerPricingSpecs(proprietary.body, rows, true).map((header) => header.model_id),
    ]);
    const body = await fetchSagemakerInventory(
      source.transport.region,
      ids,
      source.maxResponseBytes,
    );
    return {
      ...generatedFetchResult(body),
      dependencies: [
        observation(`${source.id}/catalog`, catalog),
        observation(`${source.id}/open-manifest`, openManifest),
        observation(`${source.id}/proprietary-manifest`, proprietary),
      ],
    };
  }
  if (source.transport?.kind === "sagemaker-pricing")
    return fetchSagemakerPricing(source, readDiscovery);
  if (source.transport?.kind === "aws-bedrock") {
    const body = await fetchBedrockInventory(source.transport.region, source.maxResponseBytes);
    return generatedFetchResult(body);
  }
  if (source.transport?.kind === "databricks") {
    const configured = databricksSource(source, source.transport.hostEnv);
    const payload = await fetchPayload(configured);
    return { ...payload, dependencies: [] };
  }
  if (source.transport?.kind === "azure-portal-models") {
    const body = await fetchAzurePortalModels(source, source.transport);
    return generatedFetchResult(body);
  }
  if (source.transport?.kind === "azure-retail-prices") {
    const body = await fetchAzureRetailPrices(source);
    return generatedFetchResult(body);
  }
  if (source.transport?.kind === "azure-models") {
    const body = await fetchAzureModels(source, source.transport);
    return generatedFetchResult(body);
  }
  if (source.transport?.kind === "google-model-garden") {
    const body = await fetchGoogleModelGarden(source, source.transport);
    return generatedFetchResult(body);
  }
  if (source.transport?.kind === "gemini-models") return fetchGeminiModels(source);
  if (source.transport?.kind === "cohere-models") return fetchCohereModels(source);
  if (source.transport?.kind === "dashscope-deployable-models")
    return fetchDashscopeDeployableModels(source);
  if (source.transport?.kind === "huggingface-models") return fetchHuggingFaceModels(source);
  if (source.transport?.kind === "together-model-library")
    return fetchTogetherModelLibrary(source, source.transport.catalogUrl);
  if (source.transport?.kind === "vercel-models") return fetchVercelModels(source);
  if (source.transport?.kind === "ollama-cloud") return fetchOllamaCloud(source);

  const crawl = source.linkedDocuments;
  if (crawl === undefined) {
    const payload = await readDiscovery(source);
    return { ...payload, dependencies: [] };
  }

  const indexKey = `${source.id}/index`;
  const indexSource = linkedSource(
    source,
    indexKey,
    new URL(source.url),
    source.extractor.kind === "xai-catalog" ? source.maxResponseBytes : undefined,
  );
  const configured = (crawl.documents ?? []).map((document) => documentEntry(source, document));
  if (
    configured.some(
      ({ url }) => url.port !== "" || url.username !== "" || url.password !== "" || url.hash !== "",
    )
  )
    throw new Error("Reviewed companion URL contained unsupported URL components");
  if (new Set(configured.map(({ key }) => key)).size !== configured.length)
    throw new Error("Linked document keys must be unique");
  const mistralGuides =
    crawl.mistralGuideArchive === undefined
      ? []
      : configured.filter(
          ({ url }) => url.origin === "https://docs.mistral.ai" && url.pathname.endsWith(".md"),
        );
  const [directDocuments, archivedGuides, index] = await Promise.all([
    mapConcurrent(
      configured.filter((entry) => !mistralGuides.includes(entry)),
      crawl.concurrency,
      (entry) => fetchDocumentEntry(source, entry),
    ),
    crawl.mistralGuideArchive === undefined || mistralGuides.length === 0
      ? []
      : fetchMistralGuides(source, crawl.mistralGuideArchive, mistralGuides, crawl.concurrency),
    fetchPayload(indexSource),
  ]);
  const configuredDocuments = [...directDocuments, ...archivedGuides];
  if (source.extractor.kind === "bedrock-catalog") {
    const page = configuredDocuments.find(
      (d) => "payload" in d && d.url === "https://aws.amazon.com/bedrock/pricing/",
    );
    if (page && "payload" in page) {
      const maps = await mapConcurrent(
        bedrockFoundationMapUrls(page.payload.body),
        crawl.concurrency,
        (url) =>
          fetchDocumentEntry(source, {
            key: `${source.id}/geo-map/${url.split("/").at(-1)}`,
            url: checkedUrl(url, source),
            format: "json",
            maxResponseBytes: 4 * 1024 * 1024,
            optional: true,
          }),
      );
      configuredDocuments.push(...maps);
    }
  }
  const nestedIndexUrls =
    crawl.nestedIndexes === undefined
      ? []
      : linkedUrls(index.body, source, crawl.nestedIndexes.path);
  if (crawl.nestedIndexes !== undefined)
    assertItemCount(
      "Nested linked indexes",
      nestedIndexUrls.length,
      crawl.nestedIndexes.minDocuments,
      crawl.nestedIndexes.maxDocuments,
    );
  const nestedIndexes = await mapConcurrent(
    nestedIndexUrls.map((url) => {
      const filename = url.pathname.split("/").filter(Boolean).at(-1);
      if (filename === undefined) throw new Error("Nested linked index URL omitted a filename");
      return {
        key: `${source.id}/index/${filename.replace(/\.(?:md|ts)$/, "")}`,
        url,
      };
    }),
    crawl.concurrency,
    async ({ key, url }) => {
      try {
        const payload = await fetchPayload(linkedSource(source, key, url));
        return { key, url: url.href, payload };
      } catch (error) {
        throw new Error(`Nested linked index ${key} failed: ${sourceErrorMessage(error)}`, {
          cause: error,
        });
      }
    },
  );
  const urls = new Map<string, URL>();
  for (const url of linkedUrls(index.body, source, crawl.path)) urls.set(url.href, url);
  for (const nested of nestedIndexes)
    for (const url of linkedUrls(nested.payload.body, source, crawl.path)) urls.set(url.href, url);
  const discoveredUrls = [...urls.values()].sort((left, right) =>
    left.href.localeCompare(right.href),
  );
  const xaiCards = source.extractor.kind === "xai-catalog";
  let cardFailure =
    xaiCards && discoveredUrls.length > crawl.maxDocuments
      ? `xAI language model cards exceeded discovery limit (${discoveredUrls.length} > ${crawl.maxDocuments})`
      : undefined;
  const boundedUrls = cardFailure === undefined ? discoveredUrls : [];
  if (cardFailure === undefined)
    assertItemCount("Linked documents", boundedUrls.length, crawl.minDocuments, crawl.maxDocuments);
  const discovered = boundedUrls.map((url): DocumentEntry => {
    const filename = url.pathname.split("/").filter(Boolean).at(-1);
    if (filename === undefined) throw new Error("Linked document URL omitted a filename");
    const stem =
      source.extractor.kind === "nvidia-nim-cards" ||
      source.extractor.kind === "anthropic-model-cards"
        ? url.pathname.slice(1)
        : filename.replace(/\.(?:md|ts)$/, "");
    return {
      key: `${source.id}/${xaiCards ? `model-card/${stem}` : stem}`,
      url,
      format: source.format,
      maxResponseBytes: crawl.maxDocumentBytes ?? source.maxResponseBytes,
      ...(crawl.optionalDocuments === true ? { optional: true } : {}),
      claimLocal: true,
    };
  });
  let historicalCardFailure: string | undefined;
  if (source.extractor.kind === "gemini-catalog") {
    const directory = configuredDocuments.find(
      (d) => "key" in d && d.key.endsWith("/model-directory"),
    );
    const lifecycle = configuredDocuments.find(
      (d) => "key" in d && d.key.endsWith("/deprecations"),
    );
    if (directory && "payload" in directory && lifecycle && "payload" in lifecycle) {
      const ids = new Set(
        [
          ...(geminiStudioMarkdown(lifecycle.payload.body) ?? lifecycle.payload.body).matchAll(
            /(?:`|<code[^>]*>)([a-z0-9.-]+)(?:`|<\/code>)/g,
          ),
        ].map((match) => match[1]),
      );
      const known = new Set(
        discovered.map(({ url }) => url.pathname.split("/").at(-1)?.replace(/\.md$/, "")),
      );
      const companions = linkedUrls(
        directory.payload.body,
        source,
        /^\/docs\/models\/[a-z0-9.-]+\.md$/,
      )
        .filter((url) => url.origin === "https://aistudio.google.com")
        .flatMap((url): DocumentEntry[] => {
          const id = url.pathname.split("/").at(-1)?.replace(/\.md$/, "");
          return id && ids.has(id) && !known.has(id)
            ? [
                {
                  key: source.id + "/historical/" + id,
                  url,
                  format: "markdown",
                  maxResponseBytes: crawl.maxDocumentBytes ?? source.maxResponseBytes,
                  optional: true,
                  claimLocal: true,
                },
              ]
            : [];
        });
      if (companions.length <= crawl.maxDocuments) discovered.push(...companions);
      else
        historicalCardFailure = `Historical model card count exceeded discovery limit (${companions.length} > ${crawl.maxDocuments})`;
    }
  }
  const entries = [...discovered, ...configured];
  if (new Set(entries.map((entry) => entry.key)).size !== entries.length)
    throw new Error("Linked document keys must be unique");
  const discoveredDocuments = await mapConcurrent(discovered, crawl.concurrency, (entry) =>
    fetchDocumentEntry(source, entry),
  );
  const dependencyFailures = [...discoveredDocuments, ...configuredDocuments].filter(
    (document): document is DependencyFailure => "dependency_id" in document,
  );
  if (historicalCardFailure)
    dependencyFailures.push({
      dependency_id: source.id + "/historical-model-cards",
      impact: "claim",
      outcome: "fetch_failed",
      message: historicalCardFailure,
    });
  const fetched = (documents: (FetchedDocument | DependencyFailure)[]) =>
    documents.filter((document): document is FetchedDocument => "payload" in document);
  let documents = fetched([...discoveredDocuments, ...configuredDocuments]);
  const bundleBody = (documents: FetchedDocument[]) =>
    JSON.stringify({
      index: { url: source.url, body: index.body },
      documents: [...nestedIndexes, ...documents].map((document) => ({
        url: document.url,
        body: document.payload.body,
      })),
    });
  let body = bundleBody(documents);
  if (Buffer.byteLength(body) > source.maxResponseBytes && xaiCards) {
    documents = fetched(configuredDocuments);
    body = bundleBody(documents);
    cardFailure ??= "xAI language model cards exceeded aggregate byte limit";
  }
  if (Buffer.byteLength(body) > source.maxResponseBytes)
    throw new Error("Linked documents exceeded aggregate byte limit");
  if (cardFailure !== undefined)
    dependencyFailures.push({
      dependency_id: `${source.id}/model-cards`,
      impact: "claim",
      outcome: "fetch_failed",
      message: cardFailure,
    });
  return {
    body,
    contentHash: sha256(body),
    etag: index.etag,
    lastModified: index.lastModified,
    dependencies: [
      observation(indexKey, index),
      ...nestedIndexes.map((document) => observation(document.key, document.payload)),
      ...documents.map((document) => observation(document.key, document.payload)),
    ],
    ...(dependencyFailures.length === 0 ? {} : { dependencyFailures }),
  };
}
