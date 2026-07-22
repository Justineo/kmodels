import { execFile } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { promisify } from "node:util";
import { load } from "cheerio";
import { z } from "zod";
import { fetchBedrockInventory } from "./bedrock.ts";
import type { SourceManifest } from "./manifests.ts";
import { readSnapshot, rootDirectory, sha256, writeSnapshot } from "./io.ts";

const execute = promisify(execFile);

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
    source.type === "official_public_api" ||
    source.type === "official_authenticated_api" ||
    source.type === "runtime_api"
      ? "Accept: application/json"
      : "Accept: text/html, text/markdown;q=0.9",
  ];
  if (source.auth !== undefined) {
    if (source.auth.scheme === "aws")
      throw new Error("AWS sources require their reviewed signed transport");
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
  const response = await request(source, previous);
  if (response.status === 304) {
    if (previous?.snapshotUri === undefined)
      throw new Error("Received 304 without a previous snapshot");
    return {
      body: await readSnapshot(`${rootDirectory}${previous.snapshotUri}`),
      contentHash: previous.contentHash,
      snapshotUri: previous.snapshotUri,
      etag: response.headers.get("etag") ?? previous.etag,
      lastModified: response.headers.get("last-modified") ?? previous.lastModified,
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
        crawl.path.test(url.pathname)
      ) {
        if (crawl.markdownSuffix) url.pathname += ".md";
        urls.set(url.href, url);
      }
    } catch {
      return;
    }
  };
  if (source.type === "official_markdown" || source.type === "official_github")
    for (const match of body.matchAll(/(?<!!)\[[^\]]+\]\(([^)\s]+)\)/g)) add(match[1]);
  if (source.type === "official_html") {
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
    const stem = filename.endsWith(".md") ? filename.slice(0, -3) : filename;
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
