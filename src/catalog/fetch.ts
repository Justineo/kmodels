import { execFile } from "node:child_process";
import { createSign } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import { promisify } from "node:util";
import { load } from "cheerio";
import { z } from "zod";
import { fetchBedrockInventory } from "./bedrock.ts";
import { mapConcurrent } from "./concurrency.ts";
import { modelIdSchema } from "./identity.ts";
import type { SourceManifest } from "./manifests.ts";
import { sha256 } from "./io.ts";
import { assertItemCount } from "./source-contract.ts";

const execute = promisify(execFile);

const azureTokenSchema = z.object({ access_token: z.string().min(1) });
const azureModelsPageSchema = z.object({
  value: z.array(z.unknown()),
  nextLink: z.string().nullable().optional(),
});
const azureMeterSchema = z.object({
  model: z.object({
    skus: z
      .array(
        z.object({
          cost: z.array(z.object({ meterId: z.string().min(1) })).optional(),
        }),
      )
      .optional(),
  }),
});
const azurePricesPageSchema = z.object({
  Items: z.array(z.unknown()),
  NextPageLink: z.string().nullable().optional(),
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
const huggingFaceModelsPageSchema = z.array(z.unknown());
const ollamaListSchema = z
  .object({
    models: z.array(z.object({ model: modelIdSchema }).passthrough()),
  })
  .passthrough();
const ollamaErrorSchema = z.strictObject({ error: z.string().min(1) });
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
    const result = await execute("curl", args, {
      encoding: "utf8",
      maxBuffer: source.maxResponseBytes + 64 * 1024,
    });
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
  subscriptionEnv: string,
  locationEnv: string,
): Promise<string> {
  const auth = source.auth;
  if (auth?.scheme !== "azure") throw new Error("Azure transport requires Azure credentials");
  const [tenantEnv, clientEnv, secretEnv] = auth.envs;
  const tenant = environment(tenantEnv);
  const client = environment(clientEnv);
  const secret = environment(secretEnv);
  const subscription = environment(subscriptionEnv);
  const location = environment(locationEnv);
  if (!/^[0-9a-f-]{36}$/i.test(tenant) || !/^[0-9a-f-]{36}$/i.test(client))
    throw new Error("Azure tenant and client IDs must be GUIDs");
  if (!/^[0-9a-f-]{36}$/i.test(subscription) || !/^[a-z0-9-]+$/i.test(location))
    throw new Error("Azure subscription or location is invalid");

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
  const path = `/subscriptions/${subscription}/providers/Microsoft.CognitiveServices/locations/${location}/models`;
  let next: URL | undefined = new URL(
    `${path}?api-version=2025-06-01`,
    "https://management.azure.com",
  );
  const models: unknown[] = [];
  for (let pageCount = 0; next !== undefined && pageCount < 20; pageCount += 1) {
    const page = azureModelsPageSchema.parse(
      await cloudJson("Azure", next, source.maxResponseBytes, [
        "Accept: application/json",
        `Authorization: Bearer ${token.access_token}`,
      ]),
    );
    models.push(...page.value);
    if (models.length > 5_000) throw new Error("Azure Models API exceeded item limit");
    next =
      page.nextLink === undefined || page.nextLink === null
        ? undefined
        : azurePageUrl(page.nextLink, path);
    if (pageCount === 19 && next !== undefined)
      throw new Error("Azure Models API exceeded page limit");
  }
  if (models.length === 0) throw new Error("Azure Models API returned no models");

  const meterIds = unique(
    models.flatMap((item) => {
      const parsed = azureMeterSchema.safeParse(item);
      return parsed.success
        ? (parsed.data.model.skus ?? []).flatMap((sku) =>
            (sku.cost ?? []).map((cost) => cost.meterId),
          )
        : [];
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
  const body = JSON.stringify({ location, models, prices });
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
  publishers: string[],
): Promise<string> {
  const credential = await googleAccessToken(source);
  const results = await Promise.all(
    publishers.map(async (publisher) => {
      if (!/^[a-z0-9-]+$/.test(publisher)) throw new Error("Invalid Model Garden publisher");
      const models: unknown[] = [];
      let pageToken: string | undefined;
      for (let pageCount = 0; pageCount < 20; pageCount += 1) {
        const url = new URL(
          `/v1beta1/publishers/${publisher}/models`,
          "https://aiplatform.googleapis.com",
        );
        url.searchParams.set("pageSize", "300");
        url.searchParams.set("view", "PUBLISHER_MODEL_VIEW_BASIC");
        if (pageToken !== undefined) url.searchParams.set("pageToken", pageToken);
        const page = googleModelsPageSchema.parse(
          await cloudJson("Google", url, source.maxResponseBytes, [
            "Accept: application/json",
            `Authorization: Bearer ${credential.token}`,
            `x-goog-user-project: ${credential.project}`,
          ]),
        );
        models.push(...page.publisherModels);
        if (models.length > 5_000) throw new Error("Model Garden publisher exceeded item limit");
        pageToken = page.nextPageToken;
        if (pageToken === undefined) break;
        if (pageCount === 19) throw new Error("Model Garden publisher exceeded page limit");
      }
      return { publisher, models };
    }),
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
  if (indexFormat === "markdown")
    for (const match of body.matchAll(/(?<!!)\[[^\]]+\]\(([^)\s]+)\)/g)) add(match[1]);
  if (indexFormat === "typescript")
    for (const match of body.matchAll(
      /^\s*import\s+(?:[^'"\n]+\s+from\s+)?['"]([^'"]+)['"];?\s*$/gm,
    ))
      add(match[1]);
  if (indexFormat === "html") {
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

interface FetchedDocument {
  key: string;
  url: string;
  payload: FetchPayload;
}

async function fetchConfiguredDocuments(
  source: SourceManifest,
  label: string,
): Promise<FetchedDocument[]> {
  const crawl = source.linkedDocuments;
  if (
    crawl === undefined ||
    crawl.nestedIndexes !== undefined ||
    crawl.minDocuments !== 0 ||
    crawl.maxDocuments !== 0
  )
    throw new Error(`${label} documentation bundle is not reviewed`);
  return mapConcurrent(crawl.documents ?? [], crawl.concurrency, async (document) => {
    const key = `${source.id}/${document.id}`;
    const url = checkedUrl(document.url, source);
    const payload = await fetchPayload(
      requestSource(source, key, url, document.format ?? source.format, document.maxResponseBytes),
    );
    return { key, url: url.href, payload };
  });
}

async function fetchVercelModels(source: SourceManifest): Promise<FetchResult> {
  const transport = source.transport;
  const extractor = source.extractor;
  if (transport?.kind !== "vercel-models" || extractor.kind !== "vercel-catalog")
    throw new Error("Invalid Vercel models transport");
  const indexKey = `${source.id}/index`;
  const index = await fetchPayload(
    requestSource(
      source,
      indexKey,
      checkedUrl(source.url, source),
      "json",
      source.maxResponseBytes,
    ),
  );
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
    const raw = await fetchPayload(
      requestSource(source, key, url, "json", transport.maxEndpointBytes),
    );
    const body = normalizeVercelEndpointResponse(raw.body);
    const payload = { ...raw, body, contentHash: sha256(body) };
    return { key, url: url.href, payload };
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
    const raw = await fetchPayload(
      requestSource(source, key, url, "html", transport.maxModelPageBytes),
    );
    const body = normalizeVercelModelPage(raw.body);
    const payload = { ...raw, body, contentHash: sha256(body) };
    return { key, url: url.href, payload };
  });

  const documentation = await fetchConfiguredDocuments(source, "Vercel");
  const documents = [...endpointDocuments, ...modelPages, ...documentation];
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
    if (match?.[1] === undefined) throw new Error("Ollama cloud catalog link changed shape");
    ids.add(modelIdSchema.parse(match[1]));
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
  const titles = cells.toArray().map((cell) =>
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
  const list = ollamaListSchema.parse(json(body));
  return JSON.stringify({
    ...list,
    models: list.models.sort((left, right) => left.model.localeCompare(right.model)),
  });
}

export function normalizeOllamaResponse(status: 200 | 404 | 410, body: string): unknown {
  const value = json(body);
  if (status !== 410) return value;
  const { error } = ollamaErrorSchema.parse(value);
  const match = error.match(/^(.*) \(ref: [0-9a-f-]{36}\)$/);
  if (match?.[1] === undefined)
    throw new Error("Ollama cloud retirement response omitted its request reference");
  return { error: match[1] };
}

function directOllamaCloudId(value: string): string | undefined {
  const id = value.endsWith("-cloud")
    ? value.slice(0, -"-cloud".length)
    : value.endsWith(":cloud")
      ? value.slice(0, -":cloud".length)
      : undefined;
  return id === undefined ? undefined : modelIdSchema.parse(id);
}

export function normalizeOllamaModelPage(model: string, body: string): string {
  const family = modelIdSchema.parse(model);
  const $ = load(body);
  if (normalizedText($("title").first().text()) !== family)
    throw new Error("Ollama model page identity changed shape");
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
      if (texts.some((text) => /\bUsage\b/i.test(text)) && labels.size !== 1)
        throw new Error("Ollama cloud usage level changed shape");
      const [label] = labels;
      return {
        model: id,
        ...(label === undefined ? {} : { label }),
      };
    })
    .sort((left, right) => left.model.localeCompare(right.model));
  if (tags.length === 0) throw new Error("Ollama cloud model page omitted Cloud tags");

  const page = normalizedText($.root().text());
  const cost = page.match(
    /\bCost \/1M tokens \$((?:0|[1-9]\d*)(?:\.\d+)?)\s*input \$((?:0|[1-9]\d*)(?:\.\d+)?)\s*cached \$((?:0|[1-9]\d*)(?:\.\d+)?)\s*output\b/,
  );
  if (/\bCost \/1M tokens\b/.test(page) && cost === null)
    throw new Error("Ollama cloud model cost changed shape");
  if (
    cost !== null &&
    !/requires a Pro or Max subscription, and consumes extra usage credits/i.test(page)
  )
    throw new Error("Ollama cloud model cost applicability changed");
  return JSON.stringify({
    model: family,
    tags,
    ...(cost === null
      ? {}
      : {
          cost: {
            input: cost[1],
            cached: cost[2],
            output: cost[3],
            unit: "1M tokens",
            accountEligibility: "extra_usage_balance",
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
  const [rawIndex, catalog] = await Promise.all([
    fetchPayload(indexSource),
    fetchPayload(catalogSource),
  ]);
  const indexBody = normalizeOllamaList(rawIndex.body);
  const index = {
    ...rawIndex,
    body: indexBody,
    contentHash: sha256(indexBody),
  };
  const list = ollamaListSchema.parse(json(index.body));
  const listed = new Set(list.models.map((item) => item.model));
  if (listed.size !== list.models.length) throw new Error("Ollama cloud list identity drift");
  assertItemCount(
    "Ollama cloud transport models",
    listed.size,
    transport.minModels,
    transport.maxModels,
  );
  const catalogIds = ollamaCloudIds(catalog.body);
  assertItemCount(
    "Ollama cloud transport catalog",
    catalogIds.length,
    transport.minModels,
    transport.maxModels,
  );
  const modelIds = [...new Set([...listed, ...catalogIds])].sort();
  const details = await mapConcurrent(modelIds, transport.concurrency, async (model) => {
    const key = `${source.id}/show/${sha256(model)}`;
    const showSource = {
      ...requestSource(source, key, new URL("https://ollama.com/api/show"), "json", 256 * 1024),
    } satisfies SourceManifest;
    const payload = await fetchPost(showSource, JSON.stringify({ model }));
    if (listed.has(model) && payload.status !== 200)
      throw new Error("Ollama cloud listed model details were unavailable");
    const body = JSON.stringify(normalizeOllamaResponse(payload.status, payload.body));
    return { key, model, payload: { ...payload, body, contentHash: sha256(body) } };
  });
  const modelPageBase = checkedUrl(transport.modelPageBaseUrl, source);
  if (modelPageBase.href !== "https://ollama.com/library/")
    throw new Error("Ollama model-page base URL is not reviewed");
  const pages = await mapConcurrent(catalogIds, transport.concurrency, async (model) => {
    const key = `${source.id}/model-page/${sha256(model)}`;
    const url = checkedUrl(new URL(model, modelPageBase).href, source);
    if (url.hostname !== "ollama.com" || url.pathname !== `/library/${model}`)
      throw new Error("Ollama model page left the reviewed path");
    const raw = await fetchPayload(
      requestSource(source, key, url, "html", transport.maxModelPageBytes),
    );
    const body = normalizeOllamaModelPage(model, raw.body);
    return { key, model, url: url.href, payload: { ...raw, body, contentHash: sha256(body) } };
  });
  const documents = await fetchConfiguredDocuments(source, "Ollama");
  const body = JSON.stringify({
    list: json(index.body),
    catalog: { url: catalogUrl.href, body: catalog.body },
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
      observation(indexKey, index),
      observation(catalogKey, catalog),
      ...pages.map(({ key, payload }) => observation(key, payload)),
      ...details.map(({ key, payload }) => observation(key, payload)),
      ...documents.map(({ key, payload }) => observation(key, payload)),
    ],
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
  if (source.transport?.kind === "azure-retail-prices") {
    const body = await fetchAzureRetailPrices(source);
    return generatedFetchResult(body);
  }
  if (source.transport?.kind === "azure-models") {
    const body = await fetchAzureModels(
      source,
      source.transport.subscriptionEnv,
      source.transport.locationEnv,
    );
    return generatedFetchResult(body);
  }
  if (source.transport?.kind === "google-model-garden") {
    const body = await fetchGoogleModelGarden(source, source.transport.publishers);
    return generatedFetchResult(body);
  }
  if (source.transport?.kind === "huggingface-models") return fetchHuggingFaceModels(source);
  if (source.transport?.kind === "vercel-models") return fetchVercelModels(source);
  if (source.transport?.kind === "ollama-cloud") return fetchOllamaCloud(source);

  const crawl = source.linkedDocuments;
  if (crawl === undefined) {
    const payload = await fetchPayload(source);
    return { ...payload, dependencies: [] };
  }

  const indexKey = `${source.id}/index`;
  const indexSource = linkedSource(source, indexKey, new URL(source.url));
  const index = await fetchPayload(indexSource);
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
      const filename = url.pathname.split("/").at(-1);
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
  const discovered = discoveredUrls.map((url) => {
    const filename = url.pathname.split("/").at(-1);
    if (filename === undefined) throw new Error("Linked document URL omitted a filename");
    const stem = filename.replace(/\.(?:md|ts)$/, "");
    return {
      key: `${source.id}/${stem}`,
      url,
      format: source.format,
      maxResponseBytes: crawl.maxDocumentBytes ?? source.maxResponseBytes,
    };
  });
  const configured = (crawl.documents ?? []).map((document) => {
    const url = checkedUrl(document.url, source);
    if (
      url.port !== "" ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== ""
    )
      throw new Error("Reviewed companion URL contained unsupported URL components");
    return {
      key: `${source.id}/${document.id}`,
      url,
      format: document.format ?? source.format,
      maxResponseBytes: document.maxResponseBytes,
    };
  });
  const entries = [...discovered, ...configured];
  if (new Set(entries.map((entry) => entry.key)).size !== entries.length)
    throw new Error("Linked document keys must be unique");
  const documents = await mapConcurrent(entries, crawl.concurrency, async (entry) => {
    try {
      const payload = await fetchPayload(
        linkedSource(source, entry.key, entry.url, entry.maxResponseBytes, entry.format),
      );
      return { key: entry.key, url: entry.url.href, payload };
    } catch (error) {
      throw new Error(
        `Linked document ${entry.key} failed: ${
          error instanceof Error ? error.message : "unknown fetch failure"
        }`,
      );
    }
  });
  const body = JSON.stringify({
    index: { url: source.url, body: index.body },
    documents: [...nestedIndexes, ...documents].map((document) => ({
      url: document.url,
      body: document.payload.body,
    })),
  });
  if (Buffer.byteLength(body) > source.maxResponseBytes)
    throw new Error("Linked documents exceeded aggregate byte limit");
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
  };
}
