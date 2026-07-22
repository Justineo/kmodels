import { execFile } from "node:child_process";
import { createSign } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import { promisify } from "node:util";
import { load } from "cheerio";
import { z } from "zod";
import { fetchBedrockInventory } from "./bedrock.ts";
import type { SourceManifest } from "./manifests.ts";
import { readSnapshot, rootDirectory, sha256, writeSnapshot } from "./io.ts";

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
  publisherModels: z.array(z.unknown()),
  nextPageToken: z.string().min(1).optional(),
});

export const sourceStateSchema = z.object({
  etag: z.string().optional(),
  lastModified: z.string().optional(),
  contentHash: z.string().length(64),
  snapshotUri: z.string().min(1).optional(),
  lastSuccessAt: z.iso.datetime({ offset: true }),
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
  snapshotUri: string | undefined;
  etag: string | undefined;
  lastModified: string | undefined;
  notModified: boolean;
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

async function curlRequest(
  url: URL,
  source: SourceManifest,
  previous: SourceState | undefined,
): Promise<Response> {
  const args = [
    "--silent",
    "--show-error",
    "--include",
    "--compressed",
    "--max-time",
    "20",
    "--connect-timeout",
    "10",
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
  if (previous?.snapshotUri !== undefined && previous.etag !== undefined)
    args.push("--header", `If-None-Match: ${previous.etag}`);
  if (previous?.snapshotUri !== undefined && previous.lastModified !== undefined)
    args.push("--header", `If-Modified-Since: ${previous.lastModified}`);
  args.push(url.href);
  try {
    const result = await execute("curl", args, {
      encoding: "utf8",
      maxBuffer: source.maxResponseBytes + 64 * 1024,
    });
    return curlResponse(result.stdout);
  } catch {
    throw new TransientFetchError("Transient transport failure");
  }
}

function environment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") throw new Error(`Missing credential ${name}`);
  return value;
}

async function cloudCurl(
  label: string,
  url: URL,
  maxResponseBytes: number,
  headers: string[],
  form: { name: string; value: string }[] = [],
): Promise<string> {
  const args = [
    "--silent",
    "--show-error",
    "--compressed",
    "--fail-with-body",
    "--max-time",
    "30",
    "--connect-timeout",
    "10",
    "--max-redirs",
    "0",
    "--proto",
    "=https",
    "--retry",
    "2",
    "--retry-all-errors",
    "--retry-max-time",
    "30",
    "--user-agent",
    "kmodels/0.1 (+https://github.com/Justineo/kmodels)",
  ];
  for (const header of headers) args.push("--header", header);
  for (const field of form) args.push("--data-urlencode", `${field.name}=${field.value}`);
  args.push(url.href);
  try {
    const result = await execute("curl", args, {
      encoding: "utf8",
      maxBuffer: maxResponseBytes + 64 * 1024,
    });
    if (Buffer.byteLength(result.stdout) > maxResponseBytes)
      throw new Error("Azure response exceeded byte limit");
    return result.stdout;
  } catch {
    throw new TransientFetchError(`${label} transport failure`);
  }
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
    JSON.parse(
      await cloudCurl(
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
      JSON.parse(
        await cloudCurl("Azure", next, source.maxResponseBytes, [
          "Accept: application/json",
          `Authorization: Bearer ${token.access_token}`,
        ]),
      ),
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
    let pricePage: URL | undefined = url;
    for (let pageCount = 0; pricePage !== undefined && pageCount < 20; pageCount += 1) {
      const page = azurePricesPageSchema.parse(
        JSON.parse(
          await cloudCurl("Azure", pricePage, source.maxResponseBytes, [
            "Accept: application/json",
          ]),
        ),
      );
      prices.push(...page.Items);
      if (prices.length > 20_000) throw new Error("Azure Retail Prices API exceeded item limit");
      pricePage =
        page.NextPageLink === undefined || page.NextPageLink === null
          ? undefined
          : retailPageUrl(page.NextPageLink);
      if (pageCount === 19 && pricePage !== undefined)
        throw new Error("Azure Retail Prices API exceeded page limit");
    }
  }
  const body = JSON.stringify({ location, models, prices });
  if (Buffer.byteLength(body) > source.maxResponseBytes)
    throw new Error("Azure inventory bundle exceeded byte limit");
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
    JSON.parse(
      await cloudCurl(
        "Google",
        new URL(account.token_uri),
        1024 * 1024,
        ["Accept: application/json"],
        [
          { name: "grant_type", value: "urn:ietf:params:oauth:grant-type:jwt-bearer" },
          { name: "assertion", value: assertion },
        ],
      ),
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
        url.searchParams.set("pageSize", "1000");
        url.searchParams.set("view", "PUBLISHER_MODEL_VIEW_BASIC");
        if (pageToken !== undefined) url.searchParams.set("pageToken", pageToken);
        const page = googleModelsPageSchema.parse(
          JSON.parse(
            await cloudCurl("Google", url, source.maxResponseBytes, [
              "Accept: application/json",
              `Authorization: Bearer ${credential.token}`,
              `x-goog-user-project: ${credential.project}`,
            ]),
          ),
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

async function request(
  source: SourceManifest,
  previous: SourceState | undefined,
): Promise<Response> {
  let url = checkedUrl(source.url, source);
  for (let redirect = 0; redirect <= 4; redirect += 1) {
    const response = await curlRequest(url, source, previous);
    if (response.status >= 300 && response.status < 400 && response.status !== 304) {
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
  providerId: string,
  source: SourceManifest,
  previous: SourceState | undefined,
): Promise<FetchPayload> {
  const reusable = source.snapshotPolicy === "none" ? undefined : previous;
  const response = await request(source, reusable);
  if (response.status === 304) {
    if (reusable?.snapshotUri === undefined)
      throw new Error("Received 304 without a previous snapshot");
    return {
      body: await readSnapshot(`${rootDirectory}${reusable.snapshotUri}`),
      contentHash: reusable.contentHash,
      snapshotUri: reusable.snapshotUri,
      etag: response.headers.get("etag") ?? reusable.etag,
      lastModified: response.headers.get("last-modified") ?? reusable.lastModified,
      notModified: true,
    };
  }
  if (response.status === 429 || response.status >= 500)
    throw new TransientFetchError(`Transient HTTP ${response.status}`, retryDelay(response));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await readLimited(response, source.maxResponseBytes);
  if (body.trim() === "") throw new Error("Source returned an empty body");
  const contentHash = sha256(body);
  const snapshotUri =
    source.snapshotPolicy === "none"
      ? undefined
      : `data/snapshots/${providerId}/${source.id}/${contentHash}.txt.gz`;
  if (snapshotUri !== undefined) await writeSnapshot(`${rootDirectory}${snapshotUri}`, body);
  return {
    body,
    contentHash,
    snapshotUri,
    etag: response.headers.get("etag") ?? undefined,
    lastModified: response.headers.get("last-modified") ?? undefined,
    notModified: false,
  };
}

async function fetchPayload(
  providerId: string,
  source: SourceManifest,
  previous: SourceState | undefined,
): Promise<FetchPayload> {
  let lastError: Error = new Error("Source fetch failed");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await attemptFetch(providerId, source, previous);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unknown source fetch failure");
      if (!(lastError instanceof TransientFetchError) || attempt === 2) break;
      await wait(lastError.retryAfter || 500 * 2 ** attempt + Math.floor(Math.random() * 250));
    }
  }
  throw lastError;
}

function observation(key: string, payload: FetchPayload): FetchObservation {
  return {
    key,
    contentHash: payload.contentHash,
    snapshotUri: payload.snapshotUri,
    etag: payload.etag,
    lastModified: payload.lastModified,
    notModified: payload.notModified,
  };
}

export function linkedDocumentUrls(body: string, source: SourceManifest): URL[] {
  const crawl = source.linkedDocuments;
  if (crawl === undefined) return [];
  const urls = new Map<string, URL>();
  const add = (target: string | undefined): void => {
    if (target === undefined) return;
    try {
      const url = new URL(target, source.url);
      if (
        url.protocol === "https:" &&
        source.allowedHosts.includes(url.hostname) &&
        url.port === "" &&
        url.username === "" &&
        url.password === "" &&
        url.search === "" &&
        url.hash === "" &&
        (() => {
          const path =
            crawl.pathSuffix !== undefined && url.pathname.endsWith(crawl.pathSuffix)
              ? url.pathname.slice(0, -crawl.pathSuffix.length)
              : url.pathname;
          if (!crawl.path.test(path)) return false;
          if (crawl.pathSuffix !== undefined) url.pathname = `${path}${crawl.pathSuffix}`;
          return true;
        })()
      ) {
        urls.set(url.href, url);
      }
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
  if (values.length < crawl.minDocuments || values.length > crawl.maxDocuments)
    throw new Error("Linked document count outside reviewed bounds");
  return values;
}

function linkedSource(
  source: SourceManifest,
  key: string,
  url: URL,
  maxResponseBytes = source.linkedDocuments?.maxDocumentBytes ?? source.maxResponseBytes,
): SourceManifest {
  const { linkedDocuments: _linkedDocuments, ...base } = source;
  void _linkedDocuments;
  return {
    ...base,
    id: key,
    url: url.href,
    maxResponseBytes,
  };
}

async function batches<T, R>(
  values: T[],
  concurrency: number,
  task: (value: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < values.length; index += concurrency)
    results.push(...(await Promise.all(values.slice(index, index + concurrency).map(task))));
  return results;
}

export async function fetchSource(
  providerId: string,
  source: SourceManifest,
  states: Record<string, SourceState>,
): Promise<FetchResult> {
  if (source.transport?.kind === "aws-bedrock") {
    const body = await fetchBedrockInventory(source.transport.region, source.maxResponseBytes);
    return {
      body,
      contentHash: sha256(body),
      snapshotUri: undefined,
      etag: undefined,
      lastModified: undefined,
      notModified: false,
      dependencies: [],
    };
  }
  if (source.transport?.kind === "databricks") {
    const configured = databricksSource(source, source.transport.hostEnv);
    const payload = await fetchPayload(providerId, configured, undefined);
    return { ...payload, dependencies: [] };
  }
  if (source.transport?.kind === "azure-models") {
    const body = await fetchAzureModels(
      source,
      source.transport.subscriptionEnv,
      source.transport.locationEnv,
    );
    return {
      body,
      contentHash: sha256(body),
      snapshotUri: undefined,
      etag: undefined,
      lastModified: undefined,
      notModified: false,
      dependencies: [],
    };
  }
  if (source.transport?.kind === "google-model-garden") {
    const body = await fetchGoogleModelGarden(source, source.transport.publishers);
    return {
      body,
      contentHash: sha256(body),
      snapshotUri: undefined,
      etag: undefined,
      lastModified: undefined,
      notModified: false,
      dependencies: [],
    };
  }

  const crawl = source.linkedDocuments;
  if (crawl === undefined) {
    const payload = await fetchPayload(providerId, source, states[source.id]);
    return { ...payload, dependencies: [] };
  }

  const indexKey = `${source.id}/index`;
  const indexSource = linkedSource(source, indexKey, new URL(source.url));
  const index = await fetchPayload(providerId, indexSource, states[indexKey] ?? states[source.id]);
  const urls = linkedDocumentUrls(index.body, source);
  const discovered = urls.map((url) => {
    const filename = url.pathname.split("/").at(-1);
    if (filename === undefined) throw new Error("Linked document URL omitted a filename");
    const stem = filename.replace(/\.(?:md|ts)$/, "");
    return {
      key: `${source.id}/${stem}`,
      url,
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
      maxResponseBytes: document.maxResponseBytes,
    };
  });
  const entries = [...discovered, ...configured];
  if (new Set(entries.map((entry) => entry.key)).size !== entries.length)
    throw new Error("Linked document keys must be unique");
  const documents = await batches(entries, crawl.concurrency, async (entry) => {
    const payload = await fetchPayload(
      providerId,
      linkedSource(source, entry.key, entry.url, entry.maxResponseBytes),
      states[entry.key],
    );
    return { key: entry.key, url: entry.url.href, payload };
  });
  const body = JSON.stringify({
    index: { url: source.url, body: index.body },
    documents: documents.map((document) => ({ url: document.url, body: document.payload.body })),
  });
  if (Buffer.byteLength(body) > source.maxResponseBytes)
    throw new Error("Linked documents exceeded aggregate byte limit");
  const contentHash = sha256(body);
  const snapshotUri = `data/snapshots/${providerId}/${source.id}/${contentHash}.txt.gz`;
  await writeSnapshot(`${rootDirectory}${snapshotUri}`, body);
  return {
    body,
    contentHash,
    snapshotUri,
    etag: index.etag,
    lastModified: index.lastModified,
    notModified: index.notModified && documents.every((document) => document.payload.notModified),
    dependencies: [
      observation(indexKey, index),
      ...documents.map((document) => observation(document.key, document.payload)),
    ],
  };
}
