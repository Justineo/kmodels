import { load } from "cheerio";
import { mapConcurrent } from "./concurrency.ts";
import { writeJson } from "./io.ts";
import { manifests, type SourceManifest } from "./manifests.ts";
import { modelClaimFields, type ModelClaimField } from "./model-claim-details.ts";
import type { ProviderModel } from "./schema.ts";
import {
  maxSourceIconBytes,
  readSourceIconCache,
  sourceIconCachePath,
  sourceIconFormat,
} from "./source-icon-cache.ts";

const publicSources = new Map(
  manifests.flatMap(({ sources }) =>
    sources
      .filter(({ access, auth }: SourceManifest) => access === "public" && auth === undefined)
      .map(({ id, allowedHosts }) => [id, allowedHosts] as const),
  ),
);

export async function refreshSourceIcons(
  models: readonly Pick<ProviderModel, ModelClaimField>[],
  path = sourceIconCachePath,
): Promise<void> {
  const origins = new Set<string>();
  for (const model of models)
    for (const field of modelClaimFields)
      for (const { source_ref, statements, evidence } of model[field] ?? []) {
        const hosts = publicSources.get(source_ref);
        if (hosts === undefined || statements.length === 0) continue;
        for (const { document_url } of evidence) {
          const url = new URL(document_url);
          if (url.protocol === "https:" && hosts.includes(url.hostname)) origins.add(url.origin);
        }
      }

  const previous = await readSourceIconCache(path);
  const entries = await mapConcurrent([...origins], 4, async (origin) => {
    const icon = (await discoverSourceIcon(origin)) ?? previous[origin];
    return icon === undefined ? [] : [[origin, icon] as const];
  });
  await writeJson(path, Object.fromEntries(entries.flat()));
}

async function discoverSourceIcon(origin: string) {
  const signal = AbortSignal.timeout(8_000);
  const home = await fetchAtOrigin(new URL(origin), origin, "text/html", signal);
  const candidates = new Set<string>();
  if (home !== undefined) {
    const { response, url } = home;
    const head = await boundedBytes(response, 512 * 1024, true);
    if (head !== undefined) {
      const $ = load(head.toString("utf8"));
      const base = resolveUrl($("head base[href]").first().attr("href"), url) ?? url;
      for (const link of $("head link[rel~='icon' i][href]")) {
        const icon = resolveUrl($(link).attr("href"), base);
        if (icon?.protocol !== "https:" || icon.origin !== origin || icon.username || icon.password)
          continue;
        icon.hash = "";
        candidates.add(icon.href);
        if (candidates.size === 4) break;
      }
    }
  }
  candidates.add(`${origin}/favicon.ico`);
  for (const candidate of candidates) {
    const result = await fetchAtOrigin(
      new URL(candidate),
      origin,
      "image/png, image/x-icon, */*;q=0.1",
      signal,
    );
    if (result === undefined) continue;
    const bytes = await boundedBytes(result.response, maxSourceIconBytes);
    if (bytes === undefined) continue;
    if (sourceIconFormat(bytes) !== undefined) return bytes.toString("base64");
  }
  return undefined;
}

function resolveUrl(href: string | undefined, base: URL): URL | undefined {
  return href && URL.canParse(href, base) ? new URL(href, base) : undefined;
}

async function fetchAtOrigin(url: URL, origin: string, accept: string, signal: AbortSignal) {
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (
      url.protocol !== "https:" ||
      url.origin !== origin ||
      url.username ||
      url.password ||
      signal.aborted
    )
      return undefined;
    const response = await fetch(url, {
      headers: { Accept: accept },
      redirect: "manual",
      credentials: "omit",
      signal,
    }).catch(() => undefined);
    if (response === undefined) return undefined;
    if (response.ok) return { response, url };
    await response.body?.cancel().catch(() => undefined);
    if (![301, 302, 303, 307, 308].includes(response.status)) return undefined;
    const next = resolveUrl(response.headers.get("location") ?? undefined, url);
    if (next === undefined) return undefined;
    url = next;
  }
  return undefined;
}

async function boundedBytes(response: Response, limit: number, prefix = false) {
  const reader = response.body?.getReader();
  if (reader === undefined) return undefined;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks, size);
      const chunk = value.subarray(0, limit - size);
      if (!prefix && chunk.length < value.length) return undefined;
      chunks.push(chunk);
      size += chunk.length;
      if (prefix && size === limit) return Buffer.concat(chunks, size);
    }
  } catch {
    return undefined;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
