import { execFile } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { promisify } from "node:util";
import { invalidJsonContractEvidence, SourceContractError } from "../source-contract.ts";
import { SourceFetchError, SourceRetryError, type SourceRetryFailure } from "../source-failure.ts";

const execute = promisify(execFile);
export const sourceRetryBudgetMs = 5 * 60_000;

export type TransportAuth =
  | { scheme: "bearer"; env: string }
  | { scheme: "header"; env: string; header: string }
  | { scheme: "aws"; envs: [string, string] }
  | { scheme: "azure"; envs: [string, string, string] }
  | { scheme: "google-service-account"; env: string };

export interface TransportSource {
  id: string;
  url: string;
  access: "public" | "authenticated" | "configured";
  format: "json" | "html" | "markdown" | "mixed";
  allowedHosts: readonly string[];
  maxResponseBytes: number;
  auth?: TransportAuth | undefined;
  headers?: readonly { name: string; value: string }[] | undefined;
}

export class TransientFetchError extends SourceFetchError {
  retryAfter: number;

  constructor(message: string, retryAfter = 0, status?: number) {
    super(message, status);
    this.retryAfter = retryAfter;
  }
}

export async function retryTransient<T>(
  operation: (attempt: number) => Promise<T>,
  request?: string,
): Promise<T> {
  const deadline = Date.now() + sourceRetryBudgetMs;
  for (let attempts = 1; ; attempts += 1) {
    try {
      return await operation(attempts);
    } catch (error) {
      if (!(error instanceof TransientFetchError))
        throw error instanceof Error ? error : new Error("Unknown source fetch failure");
      let detail: Omit<SourceRetryFailure, "request" | "attempts"> = { reason: "attempt_limit" };
      if (attempts < 3) {
        const delay = error.retryAfter || Math.floor(Math.random() * (500 * 2 ** (attempts - 1)));
        const remaining = deadline - Date.now();
        if (delay <= remaining) {
          await wait(delay);
          continue;
        }
        detail = {
          reason: error.retryAfter > 0 ? "retry_after_exceeds_budget" : "backoff_exceeds_budget",
          ...(Number.isSafeInteger(delay) ? { delay_ms: delay } : {}),
          remaining_budget_ms: Math.max(remaining, 0),
        };
      }
      if (request === undefined) throw error;
      throw new SourceRetryError(error, { ...detail, request, attempts });
    }
  }
}

export function retryDelay(response: Response): number {
  let delay = 0;
  for (const header of ["retry-after", "x-ms-ratelimit-retailprices-retry-after"]) {
    const raw = response.headers.get(header)?.trim();
    if (raw === undefined) continue;
    if (/^\d+(?:\s*,\s*\d+)*$/.test(raw)) {
      for (const seconds of raw.split(",")) delay = Math.max(delay, Number(seconds) * 1000);
    } else if (header === "retry-after" && /^[A-Za-z]/.test(raw)) {
      const date = Date.parse(raw);
      if (Number.isFinite(date)) delay = Math.max(delay, date - Date.now());
    }
  }
  return delay;
}

export function checkedUrl(
  raw: string,
  source: Pick<TransportSource, "access" | "auth" | "allowedHosts">,
): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("Only HTTPS sources are allowed");
  if (!source.allowedHosts.includes(url.hostname))
    throw new Error(
      source.access === "public" && source.auth === undefined
        ? `Redirect left the reviewed host allowlist: ${url.hostname}`
        : "Redirect left the reviewed host allowlist",
    );
  return url;
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

export function curlTransportFailure(error: unknown): string {
  const rawCode = error instanceof Error && "code" in error ? String(error.code) : "";
  const code = /^(?:[1-9]\d{0,2}|ERR_CHILD_PROCESS_STDIO_MAXBUFFER)$/.test(rawCode)
    ? rawCode
    : "unknown";
  const stderr =
    error instanceof Error && "stderr" in error && typeof error.stderr === "string"
      ? error.stderr
      : "";
  const reasons = new Map([
    ["5", "proxy DNS resolution failed"],
    ["6", "DNS resolution failed"],
    ["7", "connection failed"],
    [
      "28",
      /SSL connection timeout/i.test(stderr)
        ? "TLS handshake timed out"
        : /Resolving timed out/i.test(stderr)
          ? "DNS resolution timed out"
          : "request timed out",
    ],
    ["35", "TLS handshake failed"],
    ["56", "response receive failed"],
    ["60", "TLS certificate validation failed"],
    ["92", "HTTP/2 stream failed"],
    ["ERR_CHILD_PROCESS_STDIO_MAXBUFFER", "response exceeded byte limit"],
  ]);
  const reason = reasons.get(code);
  return `transport failure (curl ${code}${reason === undefined ? "" : `: ${reason}`})`;
}

export async function runCurl(
  url: URL,
  options: {
    headers: readonly string[];
    maxResponseBytes: number;
    maxTimeSeconds?: number;
    connectTimeoutSeconds?: number;
    json?: string;
    form?: readonly { name: string; value: string }[];
    retryHttp11?: boolean;
  },
): Promise<Response> {
  const args = [
    "--silent",
    "--show-error",
    "--include",
    "--compressed",
    "--max-time",
    String(options.maxTimeSeconds ?? 60),
    "--connect-timeout",
    String(options.connectTimeoutSeconds ?? 30),
    "--max-redirs",
    "0",
    "--proto",
    "=https",
    "--user-agent",
    "kmodels/0.1 (+https://github.com/Justineo/kmodels)",
  ];
  for (const header of options.headers) args.push("--header", header);
  for (const field of options.form ?? [])
    args.push("--data-urlencode", `${field.name}=${field.value}`);
  if (options.json !== undefined)
    args.push(
      "--request",
      "POST",
      "--header",
      "Content-Type: application/json",
      "--data-binary",
      options.json,
    );
  args.push(url.href);
  const run = (requestArgs: string[]) =>
    execute("curl", requestArgs, {
      encoding: "utf8",
      maxBuffer: options.maxResponseBytes + 64 * 1024,
    });
  let result;
  try {
    result = await run(args);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : "unknown";
    if (!options.retryHttp11 || !["56", "92"].includes(code)) throw error;
    result = await run([...args.slice(0, -1), "--http1.1", url.href]);
  }
  return curlResponse(result.stdout);
}

export async function cloudJson(
  label: string,
  url: URL,
  maxResponseBytes: number,
  headers: readonly string[],
  options: {
    form?: readonly { name: string; value: string }[];
    authentication?: true;
    onSuccess?: (response: Response) => void;
  } = {},
): Promise<unknown> {
  return retryTransient(async () => {
    let response: Response;
    try {
      response = await runCurl(url, {
        headers,
        maxResponseBytes,
        maxTimeSeconds: 60,
        connectTimeoutSeconds: 10,
        ...(options.form === undefined ? {} : { form: options.form }),
      });
    } catch (error) {
      throw new TransientFetchError(`${label} ${curlTransportFailure(error)}`);
    }
    const body = await response.text();
    if (Buffer.byteLength(body) > maxResponseBytes)
      throw new Error("Cloud response exceeded byte limit");
    if (response.status === 429 || response.status >= 500)
      throw new TransientFetchError(
        `${label} HTTP ${response.status}`,
        retryDelay(response),
        response.status,
      );
    if (!response.ok) {
      let code: string | undefined;
      try {
        const parsed: unknown = JSON.parse(body);
        if (parsed !== null && typeof parsed === "object") {
          const error = Reflect.get(parsed, "error");
          if (typeof error === "string" && /^[a-z][a-z0-9_]+$/.test(error)) code = error;
        }
      } catch {
        // The status remains sufficient when the error body is not JSON.
      }
      throw new SourceFetchError(
        `${label} HTTP ${response.status}${code === undefined ? "" : ` (${code})`}`,
        response.status,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      if (/^Too many requests\b/i.test(body.trim()))
        throw new TransientFetchError(`${label} was throttled`, retryDelay(response));
      if (options.authentication === true)
        throw new Error("Authentication service returned invalid JSON");
      throw new SourceContractError(label, invalidJsonContractEvidence());
    }
    options.onSuccess?.(response);
    return parsed;
  });
}

export async function readLimited(response: Response, limit: number): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel();
    throw new Error("Response exceeded byte limit");
  }
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read().catch(() => {
        throw new TransientFetchError("Source response body transfer failed or timed out");
      });
      if (result.done) break;
      total += result.value.byteLength;
      if (total > limit) {
        await reader.cancel("Response exceeded byte limit");
        throw new Error("Response exceeded byte limit");
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total).toString("utf8");
}
