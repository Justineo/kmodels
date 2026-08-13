import { execFile } from "node:child_process";
import { createSign } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import { promisify } from "node:util";
import { load } from "cheerio";
import { z } from "zod";
import { fetchBedrockInventory } from "./bedrock.ts";
import { armCostMeterId, azureArmSkuSchema } from "./azure-commercial.ts";
import { azureModelLocations } from "./azure-locations.ts";
import { mapConcurrent } from "./concurrency.ts";
import { modelIdSchema } from "./identity.ts";
import type { SourceManifest } from "./manifests.ts";
import { sha256 } from "./io.ts";
import { assertItemCount } from "./source-contract.ts";

const execute = promisify(execFile);

type AzureModelsTransport = Extract<
  NonNullable<SourceManifest["transport"]>,
  { kind: "azure-models" }
>;
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
type FeatherlessModelsTransport = Extract<
  NonNullable<SourceManifest["transport"]>,
  { kind: "featherless-models" }
>;
type GoogleModelGardenTransport = Extract<
  NonNullable<SourceManifest["transport"]>,
  { kind: "google-model-garden" }
>;

const azureTokenSchema = z.object({ access_token: z.string().min(1) });
const azureArmPageSchema = z.object({
  value: z.array(z.unknown()),
  nextLink: z.string().nullable().optional(),
});
const azureCommercialInventorySchema = z.object({
  model: z.object({
    skus: z.array(azureArmSkuSchema).optional(),
  }),
});
const azurePricesPageSchema = z.object({
  Items: z.array(z.unknown()),
  NextPageLink: z.string().nullable().optional(),
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
const googleServiceAccountSchema = z.object({
  type: z.literal("service_account"),
  project_id: z.string().min(1),
  private_key_id: z.string().min(1).optional(),
  private_key: z.string().min(1),
  client_email: z.email(),
  token_uri: z.literal("https://oauth2.googleapis.com/token"),
});
const googleTokenSchema = z.object({ access_token: z.string().min(1) });
const googleModelsPageSchema = z.object({
  publisherModels: z.array(z.unknown()).default([]),
  nextPageToken: z.string().min(1).optional(),
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
const featherlessModelsPageSchema = z.object({
  data: z.array(z.unknown()),
  total: z.number().int().nonnegative(),
  pagination: z.object({
    current_page: z.number().int().positive(),
    per_page: z.number().int().positive(),
    total_items: z.number().int().nonnegative(),
    total_pages: z.number().int().nonnegative(),
  }),
});
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

interface FetchPayload {
  body: string;
  contentHash: string;
  etag: string | undefined;
  lastModified: string | undefined;
}

interface StatusPayload extends FetchPayload {
  status: 200 | 404 | 410;
}

export type FetchObservation = Omit<FetchPayload, "body"> & { key: string };

export interface FetchResult extends FetchPayload {
  dependencies: FetchObservation[];
  omittedOptionalDependencies?: string[];
  omittedOptionalDocuments?: string[];
}

class TransientFetchError extends Error {
  retryAfter: number;

  constructor(message: string, retryAfter = 0) {
    super(message);
    this.retryAfter = retryAfter;
  }
}

async function retryTransient<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: Error = new Error("Source fetch failed");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unknown source fetch failure");
      if (!(lastError instanceof TransientFetchError) || attempt === 2) break;
      const delay = lastError.retryAfter || Math.floor(Math.random() * (500 * 2 ** attempt));
      await wait(delay);
    }
  }
  throw lastError;
}

function retryDelay(response: Response): number {
  const raw = response.headers.get("retry-after");
  if (raw === null) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 30_000);
  const date = Date.parse(raw);
  return Number.isNaN(date) ? 0 : Math.min(Math.max(date - Date.now(), 0), 30_000);
}

function checkedUrl(raw: string, source: SourceManifest): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("Only HTTPS sources are allowed");
  if (!source.allowedHosts.includes(url.hostname))
    throw new Error("Redirect left the reviewed host allowlist");
  return url;
}

function databricksSource(source: SourceManifest, hostEnv: string): SourceManifest {
  const raw = process.env[hostEnv];
  if (raw === undefined || raw.trim() === "") throw new Error(`Missing credential ${hostEnv}`);
  const origin = new URL(raw);
  const hostname = origin.hostname.toLowerCase();
  if (
    origin.protocol !== "https:" ||
    origin.port !== "" ||
    origin.username !== "" ||
    origin.password !== "" ||
    (origin.pathname !== "" && origin.pathname !== "/") ||
    origin.search !== "" ||
    origin.hash !== "" ||
    ![".cloud.databricks.com", ".azuredatabricks.net", ".gcp.databricks.com"].some((suffix) =>
      hostname.endsWith(suffix),
    )
  )
    throw new Error("DATABRICKS_HOST is not a reviewed Databricks workspace origin");
  const url = new URL("/api/2.0/serving-endpoints", origin);
  return { ...source, url: url.href, allowedHosts: [hostname] };
}

export function curlResponse(value: string): Response {
  let cursor = 0;
  let status = 0;
  let headers = new Headers();
  while (value.startsWith("HTTP/", cursor)) {
    const windowsEnd = value.indexOf("\r\n\r\n", cursor);
    const unixEnd = value.indexOf("\n\n", cursor);
    const end = windowsEnd >= 0 ? windowsEnd : unixEnd;
    if (end < 0) throw new Error("curl returned malformed response headers");
    const separatorLength = windowsEnd >= 0 ? 4 : 2;
    const lines = value.slice(cursor, end).split(/\r?\n/);
    const statusMatch = lines[0]?.match(/^HTTP\/\S+\s+(\d{3})/);
    if (statusMatch?.[1] === undefined) throw new Error("curl returned a malformed status line");
    status = Number(statusMatch[1]);
    headers = new Headers();
    for (const line of lines.slice(1)) {
      const colon = line.indexOf(":");
      if (colon > 0) headers.append(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
    }
    cursor = end + separatorLength;
  }
  if (status === 0) throw new Error("curl returned no HTTP response");
  const body = value.slice(cursor);
  return new Response(status === 204 || status === 304 ? null : body, { status, headers });
}

async function curlRequest(url: URL, source: SourceManifest, json?: string): Promise<Response> {
  const args = [
    "--silent",
    "--show-error",
    "--include",
    "--compressed",
    "--max-time",
    "60",
    "--connect-timeout",
    "30",
    "--max-redirs",
    "0",
    "--proto",
    "=https",
    "--user-agent",
    "kmodels/0.1 (+https://github.com/Justineo/kmodels)",
    "--header",
    source.format === "json"
      ? "Accept: application/json"
      : source.format === "markdown"
        ? "Accept: text/markdown, text/plain;q=0.9"
        : source.format === "html"
          ? "Accept: text/html"
          : "Accept: */*",
  ];
  if (source.auth !== undefined) {
    if (
      source.auth.scheme === "aws" ||
      source.auth.scheme === "azure" ||
      source.auth.scheme === "google-service-account"
    )
      throw new Error("Cloud sources require their reviewed authenticated transport");
    const credential = process.env[source.auth.env];
    if (credential === undefined || credential.trim() === "")
      throw new Error(`Missing credential ${source.auth.env}`);
    args.push(
      "--header",
      source.auth.scheme === "bearer"
        ? `Authorization: Bearer ${credential}`
        : `${source.auth.header}: ${credential}`,
    );
  }
  for (const header of source.headers ?? [])
    args.push("--header", `${header.name}: ${header.value}`);
  if (json !== undefined)
    args.push(
      "--request",
      "POST",
      "--header",
      "Content-Type: application/json",
      "--data-binary",
      json,
    );
  args.push(url.href);
  try {
    const run = (requestArgs: string[]) =>
      execute("curl", requestArgs, {
        encoding: "utf8",
        maxBuffer: source.maxResponseBytes + 64 * 1024,
      });
    let result;
    try {
      result = await run(args);
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String(error.code) : "unknown";
      if (!["56", "92"].includes(code)) throw error;
      result = await run([...args.slice(0, -1), "--http1.1", url.href]);
    }
    return curlResponse(result.stdout);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : "unknown";
    throw new TransientFetchError(`Transient transport failure (${code})`);
  }
}

function environment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") throw new Error(`Missing credential ${name}`);
  return value;
}

async function cloudJson(
  label: string,
  url: URL,
  maxResponseBytes: number,
  headers: string[],
  form: { name: string; value: string }[] = [],
): Promise<unknown> {
  const args = [
    "--silent",
    "--show-error",
    "--include",
    "--compressed",
    "--max-time",
    "60",
    "--connect-timeout",
    "10",
    "--max-redirs",
    "0",
    "--proto",
    "=https",
    "--user-agent",
    "kmodels/0.1 (+https://github.com/Justineo/kmodels)",
  ];
  for (const header of headers) args.push("--header", header);
  for (const field of form) args.push("--data-urlencode", `${field.name}=${field.value}`);
  args.push(url.href);
  return retryTransient(async () => {
    let response: Response;
    try {
      const result = await execute("curl", args, {
        encoding: "utf8",
        maxBuffer: maxResponseBytes + 64 * 1024,
      });
      response = curlResponse(result.stdout);
    } catch {
      throw new TransientFetchError(`${label} transport failure`);
    }
    if (response.status === 429 || response.status >= 500)
      throw new TransientFetchError(`${label} HTTP ${response.status}`, retryDelay(response));
    if (!response.ok) throw new Error(`${label} HTTP ${response.status}`);
    const body = await response.text();
    if (Buffer.byteLength(body) > maxResponseBytes)
      throw new Error("Cloud response exceeded byte limit");
    try {
      return JSON.parse(body);
    } catch {
      if (/^Too many requests\b/i.test(body.trim()))
        throw new TransientFetchError(`${label} was throttled`);
      throw new Error(`${label} returned invalid JSON`);
    }
  });
}

function azurePageUrl(raw: string, pathPrefix: string): URL {
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "management.azure.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    !url.pathname.toLowerCase().startsWith(pathPrefix.toLowerCase())
  )
    throw new Error("Azure pagination left the reviewed ARM endpoint");
  return url;
}

async function fetchAzureArmItems(
  source: SourceManifest,
  label: string,
  first: URL,
  path: string,
  headers: string[],
  limits: { items: number; pages: number },
): Promise<unknown[]> {
  const items: unknown[] = [];
  let next: URL | undefined = first;
  let pages = 0;
  while (next !== undefined) {
    if (pages === limits.pages) throw new Error(`${label} exceeded page limit`);
    const page = azureArmPageSchema.parse(
      await cloudJson(label, next, source.maxResponseBytes, headers),
    );
    items.push(...page.value);
    if (items.length > limits.items) throw new Error(`${label} exceeded item limit`);
    next =
      page.nextLink === undefined || page.nextLink === null
        ? undefined
        : azurePageUrl(page.nextLink, path);
    pages += 1;
  }
  return items;
}

function retailPageUrl(raw: string): URL {
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "prices.azure.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/api/retail/prices"
  )
    throw new Error("Azure pricing pagination left the reviewed endpoint");
  return url;
}

async function fetchAzureRetailPages(
  source: SourceManifest,
  label: string,
  first: URL,
  limits: { items: number; pages: number },
): Promise<unknown[]> {
  const prices: unknown[] = [];
  let next: URL | undefined = first;
  for (let pageCount = 0; next !== undefined && pageCount < limits.pages; pageCount += 1) {
    const page = azurePricesPageSchema.parse(
      await cloudJson(label, next, source.maxResponseBytes, ["Accept: application/json"]),
    );
    prices.push(...page.Items);
    if (prices.length > limits.items)
      throw new Error("Azure Retail Prices API exceeded item limit");
    next =
      page.NextPageLink === undefined || page.NextPageLink === null
        ? undefined
        : retailPageUrl(page.NextPageLink);
    if (pageCount === limits.pages - 1 && next !== undefined)
      throw new Error("Azure Retail Prices API exceeded page limit");
  }
  return prices;
}

async function fetchAzureModels(
  source: SourceManifest,
  transport: AzureModelsTransport,
): Promise<string> {
  const auth = source.auth;
  if (auth?.scheme !== "azure") throw new Error("Azure transport requires Azure credentials");
  const [tenantEnv, clientEnv, secretEnv] = auth.envs;
  const tenant = environment(tenantEnv);
  const client = environment(clientEnv);
  const secret = environment(secretEnv);
  const subscription = environment(transport.subscriptionEnv);
  if (!/^[0-9a-f-]{36}$/i.test(tenant) || !/^[0-9a-f-]{36}$/i.test(client))
    throw new Error("Azure tenant and client IDs must be GUIDs");
  if (!/^[0-9a-f-]{36}$/i.test(subscription)) throw new Error("Azure subscription is invalid");

  const tokenUrl = new URL(`/${tenant}/oauth2/v2.0/token`, "https://login.microsoftonline.com");
  const token = azureTokenSchema.parse(
    await cloudJson(
      "Azure",
      tokenUrl,
      1024 * 1024,
      ["Accept: application/json"],
      [
        { name: "client_id", value: client },
        { name: "client_secret", value: secret },
        { name: "grant_type", value: "client_credentials" },
        { name: "scope", value: "https://management.azure.com/.default" },
      ],
    ),
  );
  const authorizationHeaders = [
    "Accept: application/json",
    `Authorization: Bearer ${token.access_token}`,
  ];
  const resourceTypesUrl = new URL(
    `/subscriptions/${subscription}/providers/Microsoft.CognitiveServices/resourceTypes?api-version=2021-04-01`,
    "https://management.azure.com",
  );
  const subscriptionLocationsPath = `/subscriptions/${subscription}/locations`;
  const subscriptionLocationsUrl = new URL(
    `${subscriptionLocationsPath}?api-version=2022-12-01`,
    "https://management.azure.com",
  );
  const subscriptionLocations = await fetchAzureArmItems(
    source,
    "Azure subscription locations",
    subscriptionLocationsUrl,
    subscriptionLocationsPath,
    authorizationHeaders,
    { items: 1_000, pages: 10 },
  );
  const resourceTypes = await cloudJson(
    "Azure Cognitive Services resource types",
    resourceTypesUrl,
    source.maxResponseBytes,
    authorizationHeaders,
  );
  const locations = azureModelLocations(resourceTypes, subscriptionLocations);
  if (locations.length > transport.maxLocations)
    throw new Error("Azure Models API exceeded location limit");

  const regions = await mapConcurrent(locations, transport.concurrency, async (location) => {
    const path = `/subscriptions/${subscription}/providers/Microsoft.CognitiveServices/locations/${location}/models`;
    const first = new URL(`${path}?api-version=2025-06-01`, "https://management.azure.com");
    const models = await fetchAzureArmItems(
      source,
      `Azure Models (${location})`,
      first,
      path,
      authorizationHeaders,
      { items: transport.maxModelsPerLocation, pages: 20 },
    );
    return { location, models };
  });
  const modelCount = regions.reduce((sum, { models }) => sum + models.length, 0);
  if (modelCount === 0) throw new Error("Azure Models API returned no models");
  if (modelCount > transport.maxModels)
    throw new Error("Azure Models API exceeded total item limit");

  const commercialCosts = regions.flatMap(({ models }) =>
    models.flatMap((item) => {
      const parsed = azureCommercialInventorySchema.safeParse(item);
      return parsed.success ? (parsed.data.model.skus ?? []).flatMap(({ costs }) => costs) : [];
    }),
  );
  const meterIds = unique(
    commercialCosts.flatMap((cost) => {
      const meterId = armCostMeterId(cost);
      return meterId === undefined ? [] : [meterId];
    }),
  );
  const prices: unknown[] = [];
  for (let start = 0; start < meterIds.length; start += 20) {
    const ids = meterIds.slice(start, start + 20);
    const filter = `serviceName eq 'Foundry Models' and (${ids
      .map((id) => `meterId eq '${id.replaceAll("'", "''")}'`)
      .join(" or ")})`;
    const url = new URL("https://prices.azure.com/api/retail/prices");
    url.searchParams.set("api-version", "2023-01-01-preview");
    url.searchParams.set("currencyCode", "USD");
    url.searchParams.set("$filter", filter);
    prices.push(
      ...(await fetchAzureRetailPages(source, "Azure", url, {
        items: 20_000 - prices.length,
        pages: 20,
      })),
    );
  }
  const body = JSON.stringify({ regions, prices });
  if (Buffer.byteLength(body) > source.maxResponseBytes)
    throw new Error("Azure inventory bundle exceeded byte limit");
  return body;
}

async function fetchAzureRetailPrices(source: SourceManifest): Promise<string> {
  const url = new URL(source.url);
  url.searchParams.set("api-version", "2023-01-01-preview");
  url.searchParams.set("currencyCode", "USD");
  url.searchParams.set("$filter", "serviceName eq 'Foundry Models' and priceType eq 'Consumption'");
  const prices = await fetchAzureRetailPages(source, "Azure Retail Prices", url, {
    items: 50_000,
    pages: 50,
  });
  if (prices.length === 0) throw new Error("Azure Retail Prices API returned no prices");
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
      throw new Error(`Azure portal model search HTTP ${response.status}`);
    let value: unknown;
    try {
      value = JSON.parse(response.body);
    } catch {
      throw new Error("Azure portal model search returned invalid JSON");
    }
    const page = azurePortalPageSchema.parse(value);
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
    } else if (totalCount !== expectedTotal) {
      throw new Error("Azure portal model-search total changed during pagination");
    }
    if (items.length === 0 && models.length < expectedTotal)
      throw new Error("Azure portal model search returned an empty intermediate page");
    models.push(...items);
    if (models.length > expectedTotal || models.length > transport.maxModels)
      throw new Error("Azure portal model search exceeded its declared total");
    const next = rawToken === null || rawToken.trim() === "" ? undefined : rawToken;
    if (models.length === expectedTotal) {
      if (next !== undefined)
        throw new Error("Azure portal model search continued past its declared total");
      const body = JSON.stringify({ models });
      if (Buffer.byteLength(body) > source.maxResponseBytes)
        throw new Error("Azure portal model bundle exceeded byte limit");
      return body;
    }
    if (next === undefined)
      throw new Error("Azure portal model search ended before its declared total");
    if (seenTokens.has(next)) throw new Error("Azure portal model search repeated a page token");
    seenTokens.add(next);
    continuationToken = next;
  }
  throw new Error("Azure portal model search exceeded page limit");
}

function base64url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

async function googleAccessToken(
  source: SourceManifest,
): Promise<{ token: string; project: string }> {
  const auth = source.auth;
  if (auth?.scheme !== "google-service-account")
    throw new Error("Google transport requires service-account credentials");
  let parsed: unknown;
  try {
    parsed = JSON.parse(environment(auth.env));
  } catch {
    throw new Error("Google service-account JSON is invalid");
  }
  const account = googleServiceAccountSchema.parse(parsed);
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(
    JSON.stringify({
      alg: "RS256",
      typ: "JWT",
      ...(account.private_key_id === undefined ? {} : { kid: account.private_key_id }),
    }),
  );
  const claim = base64url(
    JSON.stringify({
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: account.token_uri,
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${header}.${claim}`;
  const signature = createSign("RSA-SHA256").update(unsigned).end().sign(account.private_key);
  const assertion = `${unsigned}.${signature.toString("base64url")}`;
  const token = googleTokenSchema.parse(
    await cloudJson(
      "Google",
      new URL(account.token_uri),
      1024 * 1024,
      ["Accept: application/json"],
      [
        { name: "grant_type", value: "urn:ietf:params:oauth:grant-type:jwt-bearer" },
        { name: "assertion", value: assertion },
      ],
    ),
  );
  return { token: token.access_token, project: account.project_id };
}

async function fetchGoogleModelGarden(
  source: SourceManifest,
  transport: GoogleModelGardenTransport,
): Promise<string> {
  if (
    !Number.isInteger(transport.pageSize) ||
    transport.pageSize <= 0 ||
    !Number.isInteger(transport.maxPages) ||
    transport.maxPages <= 0 ||
    !Number.isInteger(transport.maxModelsPerPublisher) ||
    transport.maxModelsPerPublisher <= 0 ||
    !Number.isInteger(transport.concurrency) ||
    transport.concurrency <= 0
  )
    throw new Error("Invalid Model Garden transport bounds");
  const credential = await googleAccessToken(source);
  const results = await mapConcurrent(
    transport.publishers,
    transport.concurrency,
    async (publisher) => {
      if (!/^[a-z0-9-]+$/.test(publisher)) throw new Error("Invalid Model Garden publisher");
      const models: unknown[] = [];
      let pageToken: string | undefined;
      const requestedPageTokens = new Set<string>();
      for (let pageCount = 0; pageCount < transport.maxPages; pageCount += 1) {
        if (pageToken !== undefined) {
          if (requestedPageTokens.has(pageToken))
            throw new Error("Model Garden publisher repeated a page token");
          requestedPageTokens.add(pageToken);
        }
        const url = new URL(
          `/v1beta1/publishers/${publisher}/models`,
          "https://aiplatform.googleapis.com",
        );
        url.searchParams.set("pageSize", String(transport.pageSize));
        url.searchParams.set("view", "PUBLISHER_MODEL_VIEW_BASIC");
        url.searchParams.set("languageCode", "en");
        url.searchParams.set("listAllVersions", "false");
        if (pageToken !== undefined) url.searchParams.set("pageToken", pageToken);
        const page = googleModelsPageSchema.parse(
          await cloudJson("Google", url, source.maxResponseBytes, [
            "Accept: application/json",
            `Authorization: Bearer ${credential.token}`,
            `x-goog-user-project: ${credential.project}`,
          ]),
        );
        models.push(...page.publisherModels);
        if (models.length > transport.maxModelsPerPublisher)
          throw new Error("Model Garden publisher exceeded item limit");
        pageToken = page.nextPageToken;
        if (pageToken === undefined) break;
        if (pageCount === transport.maxPages - 1)
          throw new Error("Model Garden publisher exceeded page limit");
      }
      return { publisher, models };
    },
  );
  if (results.every((result) => result.models.length === 0))
    throw new Error("Vertex Model Garden API returned no models");
  const body = JSON.stringify({ publishers: results });
  if (Buffer.byteLength(body) > source.maxResponseBytes)
    throw new Error("Vertex Model Garden inventory exceeded byte limit");
  return body;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

async function request(source: SourceManifest, json?: string): Promise<Response> {
  let url = checkedUrl(source.url, source);
  for (let redirect = 0; redirect <= 4; redirect += 1) {
    const response = await curlRequest(url, source, json);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location === null) throw new Error("Redirect response omitted Location");
      url = checkedUrl(new URL(location, url).href, source);
      continue;
    }
    return response;
  }
  throw new Error("Too many redirects");
}

async function readLimited(response: Response, limit: number): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit)
    throw new Error("Response exceeded byte limit");
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.byteLength;
    if (total > limit) {
      await reader.cancel("Response exceeded byte limit");
      throw new Error("Response exceeded byte limit");
    }
    chunks.push(result.value);
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

async function attemptFetch(
  source: SourceManifest,
): Promise<{ payload: FetchPayload; link: string | undefined }> {
  const response = await request(source);
  if (response.status === 429 || response.status >= 500)
    throw new TransientFetchError(`Transient HTTP ${response.status}`, retryDelay(response));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await readLimited(response, source.maxResponseBytes);
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

async function attemptPost(source: SourceManifest, body: string): Promise<StatusPayload> {
  const response = await request(source, body);
  if (response.status === 429 || response.status >= 500)
    throw new TransientFetchError(`Transient HTTP ${response.status}`, retryDelay(response));
  if (![200, 404, 410].includes(response.status)) throw new Error(`HTTP ${response.status}`);
  const responseBody = await readLimited(response, source.maxResponseBytes);
  if (responseBody.trim() === "") throw new Error("Source returned an empty body");
  return {
    body: responseBody,
    contentHash: sha256(responseBody),
    etag: undefined,
    lastModified: undefined,
    status: response.status === 200 ? 200 : response.status === 404 ? 404 : 410,
  };
}

async function fetchPost(source: SourceManifest, body: string): Promise<StatusPayload> {
  return retryTransient(() => attemptPost(source, body));
}

async function fetchResponse(
  source: SourceManifest,
): Promise<{ payload: FetchPayload; link: string | undefined }> {
  return retryTransient(() => attemptFetch(source));
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
      url.pathname = `${path}${crawl.requestSuffix ?? ""}`;
      urls.set(url.href, url);
    } catch {
      return;
    }
  };
  const indexFormat = crawl.indexFormat ?? source.format;
  if (indexFormat === "markdown" || indexFormat === "mixed")
    for (const match of body.matchAll(/(?<!!)\[[^\]]+\]\(([^)\s]+)\)/g)) add(match[1]);
  if (indexFormat === "typescript")
    for (const match of body.matchAll(
      /^\s*import\s+(?:[^'"\n]+\s+from\s+)?['"]([^'"]+)['"];?\s*$/gm,
    ))
      add(match[1]);
  if (indexFormat === "html" || indexFormat === "mixed") {
    const $ = load(body);
    $("a[href]").each((_index, element) => add($(element).attr("href")));
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
    url.searchParams.get("inference_provider") !== "hf-inference" ||
    url.searchParams.get("limit") !== "1000" ||
    url.searchParams.get("sort") !== "createdAt" ||
    url.searchParams.getAll("expand").join("\0") !== "lastModified" ||
    url.searchParams.getAll("cursor").length > 1
  )
    throw new Error("Hugging Face Hub pagination left the reviewed query");
  return url;
}

function huggingFacePartnerUrl(source: SourceManifest, provider: string): URL {
  const base = checkedUrl(source.url, source);
  if (
    base.hostname !== "huggingface.co" ||
    base.port !== "" ||
    base.username !== "" ||
    base.password !== "" ||
    base.pathname !== "/api/partners/hf-inference/models" ||
    base.hash !== "" ||
    base.searchParams.size !== 1 ||
    base.searchParams.get("status") !== "live" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(provider)
  )
    throw new Error("Hugging Face partner transport left the reviewed API contract");
  const url = new URL(base);
  url.pathname = `/api/partners/${provider}/models`;
  return url;
}

async function fetchHuggingFacePartnerModels(source: SourceManifest): Promise<FetchResult> {
  const transport = source.transport;
  const extractor = source.extractor;
  const crawl = source.linkedDocuments;
  const taskIndex = crawl?.documents?.[0];
  if (
    transport?.kind !== "huggingface-partner-models" ||
    extractor.kind !== "huggingface-mapping" ||
    !Number.isInteger(transport.concurrency) ||
    transport.concurrency < 1 ||
    transport.concurrency > transport.providers.length ||
    transport.providers.length > 64 ||
    !Number.isSafeInteger(transport.maxPartnerBytes) ||
    transport.maxPartnerBytes < 1 ||
    transport.maxPartnerBytes > source.maxResponseBytes ||
    new Set(transport.providers).size !== transport.providers.length ||
    transport.providers.join("\0") !== extractor.providers.join("\0") ||
    crawl === undefined ||
    crawl.indexFormat !== "mixed" ||
    crawl.requestSuffix !== ".md" ||
    crawl.discoverySuffix !== undefined ||
    crawl.nestedIndexes !== undefined ||
    crawl.documents?.length !== 1 ||
    taskIndex === undefined ||
    taskIndex.id !== "task-index" ||
    taskIndex.format !== "markdown" ||
    !Number.isSafeInteger(crawl.maxDocumentBytes) ||
    (crawl.maxDocumentBytes ?? 0) < 1
  )
    throw new Error("Invalid Hugging Face partner transport");
  const taskIndexKey = `${source.id}/${taskIndex.id}`;
  const taskIndexUrl = checkedUrl(taskIndex.url, source);
  if (
    taskIndexUrl.hostname !== "huggingface.co" ||
    taskIndexUrl.port !== "" ||
    taskIndexUrl.username !== "" ||
    taskIndexUrl.password !== "" ||
    taskIndexUrl.pathname !== "/docs/inference-providers/en/tasks/index.md" ||
    taskIndexUrl.search !== "" ||
    taskIndexUrl.hash !== ""
  )
    throw new Error("Hugging Face task index left the reviewed documentation path");
  const [partners, taskIndexPayload] = await Promise.all([
    mapConcurrent(transport.providers, transport.concurrency, async (provider) => {
      const key = `${source.id}/${provider}`;
      const url = huggingFacePartnerUrl(source, provider);
      const payload = await fetchPayload(
        requestSource(source, key, url, "json", transport.maxPartnerBytes),
      );
      const models = z.record(z.string(), z.unknown()).parse(JSON.parse(payload.body));
      return { provider, models, payload, key };
    }),
    fetchPayload(
      requestSource(
        source,
        taskIndexKey,
        taskIndexUrl,
        taskIndex.format,
        taskIndex.maxResponseBytes,
      ),
    ),
  ]);
  const taskUrls = linkedDocumentUrls(taskIndexPayload.body, {
    ...source,
    url: taskIndexUrl.href,
  });
  const taskDocuments = await mapConcurrent(taskUrls, crawl.concurrency, async (url) => {
    const slug = /\/([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/.exec(url.pathname)?.[1];
    if (slug === undefined)
      throw new Error("Hugging Face task document left the reviewed slug grammar");
    const key = `${source.id}/task/${slug}`;
    const payload = await fetchPayload(
      requestSource(
        source,
        key,
        url,
        "markdown",
        crawl.maxDocumentBytes ?? source.maxResponseBytes,
      ),
    );
    return { key, url: url.href, payload };
  });
  const body = JSON.stringify({
    partners: partners.map(({ provider, models }) => ({ provider, models })),
    documents: taskDocuments.map(({ url, payload }) => ({ url, body: payload.body })),
  });
  if (Buffer.byteLength(body) > source.maxResponseBytes)
    throw new Error("Hugging Face partner bundle exceeded byte limit");
  return {
    body,
    contentHash: sha256(body),
    etag: undefined,
    lastModified: undefined,
    dependencies: [
      ...partners.map(({ key, payload }) => observation(key, payload)),
      observation(taskIndexKey, taskIndexPayload),
      ...taskDocuments.map(({ key, payload }) => observation(key, payload)),
    ],
  };
}

async function fetchHuggingFacePage(
  source: SourceManifest,
  key: string,
  url: URL,
): Promise<{ payload: FetchPayload; next: URL | undefined }> {
  const pageSource = requestSource(source, key, url, "json", source.maxResponseBytes);
  const { payload, link } = await fetchResponse(pageSource);
  const nextLinks = [...(link ?? "").matchAll(/<([^>]+)>;\s*rel="?next"?/g)];
  if (nextLinks.length > 1) throw new Error("Hugging Face Hub returned duplicate next links");
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
  let next: URL | undefined = huggingFaceModelsUrl(source.url, source);
  for (let index = 0; next !== undefined && index < transport.maxPages; index += 1) {
    const key = `${source.id}/page-${index + 1}`;
    const page = await fetchHuggingFacePage(source, key, next);
    models.push(...huggingFaceModelsPageSchema.parse(JSON.parse(page.payload.body)));
    assertItemCount("Hugging Face Hub transport models", models.length, 0, transport.maxModels);
    pages.push({ key, payload: page.payload });
    next = page.next;
    if (index === transport.maxPages - 1 && next !== undefined)
      throw new Error("Hugging Face Hub exceeded page limit");
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

function featherlessModelsUrl(
  source: SourceManifest,
  transport: FeatherlessModelsTransport,
  page: number,
): URL {
  const url = checkedUrl(source.url, source);
  const allowed = new Set(["status", "page", "per_page"]);
  if (
    url.hostname !== "api.featherless.ai" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/v1/models" ||
    url.hash !== "" ||
    [...url.searchParams.keys()].some((key) => !allowed.has(key)) ||
    url.searchParams.get("status") !== "active"
  )
    throw new Error("Featherless pagination left the reviewed active-model query");
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(transport.pageSize));
  return url;
}

async function fetchFeatherlessModels(source: SourceManifest): Promise<FetchResult> {
  const transport = source.transport;
  if (transport?.kind !== "featherless-models")
    throw new Error("Invalid Featherless models transport");
  if (
    !Number.isInteger(transport.pageSize) ||
    transport.pageSize < 1 ||
    transport.pageSize > 1000 ||
    !Number.isInteger(transport.maxPages) ||
    transport.maxPages < 1 ||
    !Number.isInteger(transport.maxModels) ||
    transport.maxModels < 1 ||
    !Number.isInteger(transport.concurrency) ||
    transport.concurrency < 1 ||
    !Number.isInteger(transport.maxPageBytes) ||
    transport.maxPageBytes < 1
  )
    throw new Error("Invalid Featherless pagination bounds");
  const fetchPage = async (
    page: number,
  ): Promise<{
    key: string;
    payload: FetchPayload;
    parsed: z.infer<typeof featherlessModelsPageSchema>;
  }> => {
    const key = `${source.id}/page-${page}`;
    const url = featherlessModelsUrl(source, transport, page);
    const payload = await fetchPayload(
      requestSource(source, key, url, "json", transport.maxPageBytes),
    );
    const parsed = featherlessModelsPageSchema.parse(JSON.parse(payload.body));
    if (parsed.pagination.current_page !== page)
      throw new Error("Featherless returned a mismatched page number");
    return { key, payload, parsed };
  };

  const configured = source.linkedDocuments?.documents ?? [];
  const documentsPromise = mapConcurrent(
    configured,
    source.linkedDocuments?.concurrency ?? 1,
    async (document) => {
      const key = `${source.id}/${document.id}`;
      const url = checkedUrl(document.url, source);
      if (url.port !== "" || url.username !== "" || url.password !== "" || url.hash !== "")
        throw new Error("Featherless companion URL contained unsupported URL components");
      const payload = await fetchPayload(
        requestSource(source, key, url, document.format ?? "html", document.maxResponseBytes),
      );
      return { key, url: url.href, payload };
    },
  );
  const [first, documents] = await Promise.all([fetchPage(1), documentsPromise]);
  const totalPages = first.parsed.pagination.total_pages;
  if (totalPages < 1 || totalPages > transport.maxPages)
    throw new Error("Featherless models exceeded page limit");
  if (
    first.parsed.total > transport.maxModels ||
    first.parsed.pagination.total_items > transport.maxModels
  )
    throw new Error("Featherless models exceeded model limit");
  const remaining = await mapConcurrent(
    Array.from({ length: totalPages - 1 }, (_value, index) => index + 2),
    transport.concurrency,
    fetchPage,
  );
  const pages = [first, ...remaining];
  const models = pages.flatMap(({ parsed }) => parsed.data);
  assertItemCount("Featherless active models", models.length, 1, transport.maxModels);

  const body = JSON.stringify({
    index: {
      url: source.url,
      body: JSON.stringify({ data: models }),
    },
    documents: documents.map(({ url, payload }) => ({ url, body: payload.body })),
  });
  if (Buffer.byteLength(body) > source.maxResponseBytes)
    throw new Error("Featherless models bundle exceeded byte limit");
  return {
    body,
    contentHash: sha256(body),
    etag: first.payload.etag,
    lastModified: first.payload.lastModified,
    dependencies: [
      ...pages.map(({ key, payload }) => observation(key, payload)),
      ...documents.map(({ key, payload }) => observation(key, payload)),
    ],
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
    if (tokens.has(page.nextPageToken)) throw new Error(`${name} pagination repeated a token`);
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
      const page = geminiModelsPageSchema.parse(JSON.parse(body));
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
      const page = cohereModelsPageSchema.parse(JSON.parse(body));
      if (page.models.length === 0 && page.next_page_token !== undefined)
        throw new Error("Cohere models pagination returned an empty intermediate page");
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
    let value: unknown;
    try {
      value = JSON.parse(payload.body);
    } catch {
      throw new Error("DashScope deployment API returned invalid JSON");
    }
    const page = dashscopeDeploymentPageSchema.parse(value);
    if (page.output.page_no !== pageNo || page.output.page_size !== transport.pageSize)
      throw new Error("DashScope deployment API contradicted the requested page");
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
    } else if (page.output.total !== expectedTotal) {
      throw new Error("DashScope deployment total changed during pagination");
    }
    const expectedPageItems = Math.min(transport.pageSize, expectedTotal - models.length);
    if (page.output.models.length !== expectedPageItems)
      throw new Error("DashScope deployment API returned a partial page");
    for (const model of page.output.models) {
      if (ids.has(model.model_name))
        throw new Error("DashScope deployment API repeated a model ID");
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
): Promise<FetchedDocument | undefined> {
  try {
    const payload = await fetchPayload(
      linkedSource(source, entry.key, entry.url, entry.maxResponseBytes, entry.format),
    );
    return { key: entry.key, url: entry.url.href, payload };
  } catch (error) {
    if (entry.optional === true) return;
    throw new Error(
      `Linked document ${entry.key} failed: ${
        error instanceof Error ? error.message : "unknown fetch failure"
      }`,
    );
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

function omittedDocuments(
  entries: readonly DocumentEntry[],
  documents: readonly (FetchedDocument | undefined)[],
): Pick<FetchResult, "omittedOptionalDependencies" | "omittedOptionalDocuments"> {
  const omittedOptionalDependencies = entries.flatMap((entry, index) =>
    documents[index] === undefined && entry.claimLocal !== true ? [entry.key] : [],
  );
  const omittedOptionalDocuments = entries.flatMap((entry, index) =>
    documents[index] === undefined && entry.claimLocal === true ? [entry.key] : [],
  );
  return {
    ...(omittedOptionalDependencies.length === 0 ? {} : { omittedOptionalDependencies }),
    ...(omittedOptionalDocuments.length === 0 ? {} : { omittedOptionalDocuments }),
  };
}

async function fetchConfiguredDocuments(
  source: SourceManifest,
  label: string,
): Promise<{
  documents: FetchedDocument[];
  omittedDependencies: string[];
  omittedDocuments: string[];
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
  const omitted = omittedDocuments(entries, documents);
  return {
    documents: documents.filter((document): document is FetchedDocument => document !== undefined),
    omittedDependencies: (omitted.omittedOptionalDependencies ?? []).map((key) =>
      key.slice(`${source.id}/`.length),
    ),
    omittedDocuments: (omitted.omittedOptionalDocuments ?? []).map((key) =>
      key.slice(`${source.id}/`.length),
    ),
  };
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
  const list = vercelModelsTransportSchema.parse(json(index.body));
  assertItemCount(
    "Vercel models transport",
    list.data.length,
    extractor.minModels,
    extractor.maxModels,
  );
  const ids = list.data.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) throw new Error("Vercel model IDs were not unique");
  const slugOwners = new Map<string, string>();
  for (const id of ids) {
    const slug = id.split("/")[1];
    if (slug === undefined) throw new Error("Vercel model ID omitted its slug");
    const owner = slugOwners.get(slug);
    if (owner !== undefined && owner !== id)
      throw new Error(`Vercel model page slug ${slug} was ambiguous`);
    slugOwners.set(slug, id);
  }

  const endpointDocuments = await mapConcurrent(ids, transport.concurrency, async (id) => {
    const key = `${source.id}/endpoints/${sha256(id)}`;
    const url = checkedUrl(`${source.url}/${id}/endpoints`, source);
    if (url.hostname !== "ai-gateway.vercel.sh" || url.pathname !== `/v1/models/${id}/endpoints`)
      throw new Error("Vercel endpoint URL left the reviewed API path");
    try {
      const raw = await fetchPayload(
        requestSource(source, key, url, "json", transport.maxEndpointBytes),
      );
      const body = normalizeVercelEndpointResponse(raw.body);
      const payload = { ...raw, body, contentHash: sha256(body) };
      return { key, url: url.href, payload };
    } catch {
      return { omitted: key } as const;
    }
  });

  const modelPageBase = checkedUrl(transport.modelPageBaseUrl, source);
  if (modelPageBase.href !== "https://vercel.com/ai-gateway/models/")
    throw new Error("Vercel model-page base URL is not reviewed");
  const missing = list.data.filter(({ pricing }) => Object.keys(pricing).length === 0);
  assertItemCount(
    "Vercel model pricing pages",
    missing.length,
    transport.minModelPages,
    transport.maxModelPages,
  );
  const modelPages = await mapConcurrent(missing, transport.concurrency, async ({ id }) => {
    const slug = id.split("/")[1];
    if (slug === undefined) throw new Error("Vercel model ID omitted its page slug");
    const key = `${source.id}/model-page/${sha256(id)}`;
    const url = checkedUrl(new URL(slug, modelPageBase).href, source);
    if (url.hostname !== "vercel.com" || url.pathname !== `/ai-gateway/models/${slug}`)
      throw new Error("Vercel model page left the reviewed path");
    try {
      const raw = await fetchPayload(
        requestSource(source, key, url, "html", transport.maxModelPageBytes),
      );
      const body = normalizeVercelModelPage(raw.body);
      const payload = { ...raw, body, contentHash: sha256(body) };
      return { key, url: url.href, payload };
    } catch {
      return { omitted: key } as const;
    }
  });

  const fetched = [...endpointDocuments, ...modelPages];
  const omitted = fetched.flatMap((document) => ("omitted" in document ? [document.omitted] : []));
  const documents = [
    ...fetched.flatMap((document) => ("omitted" in document ? [] : [document])),
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
    ...(documentation.omittedDependencies.length === 0
      ? {}
      : { omittedOptionalDependencies: documentation.omittedDependencies }),
    ...(documentation.omittedDocuments.length + omitted.length === 0
      ? {}
      : { omittedOptionalDocuments: [...documentation.omittedDocuments, ...omitted].sort() }),
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
  return JSON.parse(body);
}

function normalizedText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeVercelModelPage(body: string): string {
  const $ = load(body);
  const title = normalizedText($("h1").first().text());
  const tables = $("table");
  if (title === "" || tables.length < 3 || normalizedText(tables.eq(0).text()) !== "Provider")
    throw new Error("Vercel model page changed its primary pricing table");
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
  if (
    headers.length !== values.length ||
    headers.some((header) => header === "") ||
    new Set(headers).size !== headers.length
  )
    throw new Error("Vercel model page pricing columns changed shape");
  const providerLinks = cells
    .eq(0)
    .find('a[href^="/ai-gateway/models/providers/"]')
    .map((_index, anchor) => $(anchor).attr("href"))
    .get();
  if (providerLinks.length !== 1) throw new Error("Vercel model page omitted its route provider");
  const provider = providerLinks[0]?.match(/^\/ai-gateway\/models\/providers\/([^/]+)$/)?.[1];
  if (provider === undefined) throw new Error("Vercel model page route provider changed shape");
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
  return JSON.stringify({ title, provider, headers, values, titles });
}

export function normalizeVercelEndpointResponse(body: string): string {
  const parsed = vercelEndpointTransportSchema.parse(json(body));
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
  return JSON.stringify({ data: { ...parsed.data, endpoints } });
}

export function normalizeOllamaList(body: string): string {
  const value = json(body);
  const parsed = ollamaListSchema.safeParse(value);
  if (!parsed.success) return JSON.stringify(value);
  const list = parsed.data;
  return JSON.stringify({
    ...list,
    models: list.models.sort((left, right) =>
      ollamaListKey(left).localeCompare(ollamaListKey(right)),
    ),
  });
}

function ollamaListKey(value: unknown): string {
  if (value !== null && typeof value === "object") {
    const model = Reflect.get(value, "model");
    if (typeof model === "string") return `0\0${model}`;
  }
  return `1\0${JSON.stringify(value)}`;
}

export function normalizeOllamaResponse(status: 200 | 404 | 410, body: string): unknown {
  const value = json(body);
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
  const costCard = /\bCost \/1M tokens\b/.test(page);
  const amount = (label: "input" | "cached" | "output"): string | undefined =>
    page.match(new RegExp(`\\$((?:0|[1-9]\\d*)(?:\\.\\d+)?)\\s*${label}\\b`))?.[1];
  const input = amount("input");
  const cached = amount("cached");
  const output = amount("output");
  return JSON.stringify({
    model: family,
    ...(title === "" ? {} : { title }),
    tags,
    ...(!costCard
      ? {}
      : {
          cost: {
            ...(input === undefined ? {} : { input }),
            ...(cached === undefined ? {} : { cached }),
            ...(output === undefined ? {} : { output }),
            unit: "1M tokens",
          },
        }),
  });
}

async function fetchOllamaCloud(source: SourceManifest): Promise<FetchResult> {
  const transport = source.transport;
  if (transport?.kind !== "ollama-cloud") throw new Error("Invalid Ollama cloud transport");
  const indexKey = `${source.id}/index`;
  const catalogKey = `${source.id}/catalog`;
  const indexSource = requestSource(
    source,
    indexKey,
    checkedUrl(source.url, source),
    "json",
    source.maxResponseBytes,
  );
  const catalogUrl = checkedUrl(transport.catalogUrl, source);
  if (catalogUrl.href !== "https://ollama.com/search?c=cloud")
    throw new Error("Ollama cloud catalog URL is not reviewed");
  const catalogSource = requestSource(
    source,
    catalogKey,
    catalogUrl,
    "html",
    source.maxResponseBytes,
  );
  const [rawIndex, catalog, documentation] = await Promise.all([
    fetchPayload(indexSource).catch(() => undefined),
    fetchPayload(catalogSource).catch(() => undefined),
    fetchConfiguredDocuments(source, "Ollama"),
  ]);
  if (rawIndex === undefined && catalog === undefined)
    throw new Error("Ollama Cloud inventory witnesses were unavailable");
  let indexBody = "{}";
  if (rawIndex !== undefined)
    try {
      indexBody = normalizeOllamaList(rawIndex.body);
    } catch {
      indexBody = "{}";
    }
  const index: FetchPayload = {
    body: indexBody,
    contentHash: sha256(indexBody),
    etag: rawIndex?.etag,
    lastModified: rawIndex?.lastModified,
  };
  const list = ollamaListSchema.safeParse(json(index.body));
  const listed = new Set(
    (list.success ? list.data.models : []).flatMap((item) => {
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
    try {
      const key = `${source.id}/show/${sha256(model)}`;
      const showSource = {
        ...requestSource(source, key, new URL("https://ollama.com/api/show"), "json", 256 * 1024),
      } satisfies SourceManifest;
      const payload = await fetchPost(showSource, JSON.stringify({ model }));
      const body = JSON.stringify(normalizeOllamaResponse(payload.status, payload.body));
      return { key, model, payload: { ...payload, body, contentHash: sha256(body) } };
    } catch {
      return;
    }
  });
  const details = detailResults.filter((item) => item !== undefined);
  const modelPageBase = checkedUrl(transport.modelPageBaseUrl, source);
  if (modelPageBase.href !== "https://ollama.com/library/")
    throw new Error("Ollama model-page base URL is not reviewed");
  const pageResults = await mapConcurrent(catalogIds, transport.concurrency, async (model) => {
    try {
      const key = `${source.id}/model-page/${sha256(model)}`;
      const url = checkedUrl(new URL(model, modelPageBase).href, source);
      if (url.hostname !== "ollama.com" || url.pathname !== `/library/${model}`) return;
      const raw = await fetchPayload(
        requestSource(source, key, url, "html", transport.maxModelPageBytes),
      );
      const body = normalizeOllamaModelPage(model, raw.body);
      return { key, model, url: url.href, payload: { ...raw, body, contentHash: sha256(body) } };
    } catch {
      return;
    }
  });
  const pages = pageResults.filter((item) => item !== undefined);
  const documents = documentation.documents;
  const body = JSON.stringify({
    list: json(index.body),
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
    ...(documentation.omittedDependencies.length === 0
      ? {}
      : { omittedOptionalDependencies: documentation.omittedDependencies }),
    ...(documentation.omittedDocuments.length === 0
      ? {}
      : { omittedOptionalDocuments: documentation.omittedDocuments }),
  };
}

export async function fetchSource(source: SourceManifest): Promise<FetchResult> {
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
  if (source.transport?.kind === "huggingface-partner-models")
    return fetchHuggingFacePartnerModels(source);
  if (source.transport?.kind === "huggingface-models") return fetchHuggingFaceModels(source);
  if (source.transport?.kind === "featherless-models") return fetchFeatherlessModels(source);
  if (source.transport?.kind === "vercel-models") return fetchVercelModels(source);
  if (source.transport?.kind === "ollama-cloud") return fetchOllamaCloud(source);

  const crawl = source.linkedDocuments;
  if (crawl === undefined) {
    const payload = await fetchPayload(source);
    return { ...payload, dependencies: [] };
  }

  const indexKey = `${source.id}/index`;
  const indexSource = linkedSource(source, indexKey, new URL(source.url));
  const configured = (crawl.documents ?? []).map((document) => documentEntry(source, document));
  if (
    configured.some(
      ({ url }) => url.port !== "" || url.username !== "" || url.password !== "" || url.hash !== "",
    )
  )
    throw new Error("Reviewed companion URL contained unsupported URL components");
  if (new Set(configured.map(({ key }) => key)).size !== configured.length)
    throw new Error("Linked document keys must be unique");
  const configuredPromise = mapConcurrent(configured, crawl.concurrency, (entry) =>
    fetchDocumentEntry(source, entry),
  );
  const [index, configuredDocuments] = await Promise.all([
    fetchPayload(indexSource),
    configuredPromise,
  ]);
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
        throw new Error(
          `Nested linked index ${key} failed: ${
            error instanceof Error ? error.message : "unknown fetch failure"
          }`,
        );
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
  assertItemCount(
    "Linked documents",
    discoveredUrls.length,
    crawl.minDocuments,
    crawl.maxDocuments,
  );
  const discovered = discoveredUrls.map((url): DocumentEntry => {
    const filename = url.pathname.split("/").filter(Boolean).at(-1);
    if (filename === undefined) throw new Error("Linked document URL omitted a filename");
    const stem = filename.replace(/\.(?:md|ts)$/, "");
    return {
      key: `${source.id}/${stem}`,
      url,
      format: source.format,
      maxResponseBytes: crawl.maxDocumentBytes ?? source.maxResponseBytes,
      ...(crawl.optionalDocuments === true ? { optional: true } : {}),
    };
  });
  const entries = [...discovered, ...configured];
  if (new Set(entries.map((entry) => entry.key)).size !== entries.length)
    throw new Error("Linked document keys must be unique");
  const discoveredDocuments = await mapConcurrent(discovered, crawl.concurrency, (entry) =>
    fetchDocumentEntry(source, entry),
  );
  const documents = [...discoveredDocuments, ...configuredDocuments].filter(
    (document): document is FetchedDocument => document !== undefined,
  );
  const body = JSON.stringify({
    index: { url: source.url, body: index.body },
    documents: [...nestedIndexes, ...documents].map((document) => ({
      url: document.url,
      body: document.payload.body,
    })),
  });
  if (Buffer.byteLength(body) > source.maxResponseBytes)
    throw new Error("Linked documents exceeded aggregate byte limit");
  const omittedDiscovered = discovered.flatMap((entry, index) =>
    discoveredDocuments[index] === undefined ? [entry.key] : [],
  );
  const configuredOmissions = omittedDocuments(configured, configuredDocuments);
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
    ...configuredOmissions,
    ...(omittedDiscovered.length === 0
      ? {}
      : {
          omittedOptionalDocuments: [
            ...omittedDiscovered,
            ...(configuredOmissions.omittedOptionalDocuments ?? []),
          ],
        }),
  };
}
