import { manifests, type SourceManifest } from "./manifests.ts";
import type { FetchState } from "./fetch.ts";
import { load } from "cheerio";

/** The accepted refresh report and fetch state must describe the same collection attempt. */
export function publicEvidenceBaseline(
  sourceId: string,
  sourceHash: string,
  state: FetchState,
  generatedAt: string,
  attemptOutcome: string | undefined,
) {
  const previous = state.sources[sourceId];
  const comparison =
    previous?.contentHash === undefined ||
    previous.checkedAt !== generatedAt ||
    !["changed", "unchanged", "parse_failed"].includes(attemptOutcome ?? "")
      ? "unavailable"
      : previous.contentHash === sourceHash
        ? "matching_refresh"
        : "changed_since_refresh";
  return {
    source_id: sourceId,
    generated_at: generatedAt,
    comparison,
    ...(previous === undefined
      ? {}
      : {
          checked_at: previous.checkedAt,
          source_hash: previous.contentHash,
          last_success_at: previous.lastSuccessAt,
        }),
  };
}

/** Reuse reviewed transport/host budgets; never turn agent-supplied URLs into crawl authority. */
export function reviewedPublicSource(sourceId: string, documentUrl?: string): SourceManifest {
  const source = manifests
    .flatMap<SourceManifest>(({ sources }) => sources)
    .find(({ id }) => id === sourceId);
  if (source === undefined) {
    const provider = manifests.find(({ provider }) => provider.id === sourceId);
    if (provider !== undefined)
      throw new Error(
        `Expected a source ID, received provider ID ${sourceId}. Public source IDs: ${
          provider.sources
            .filter((item: SourceManifest) => item.access === "public" && !item.auth)
            .map(({ id }) => id)
            .join(", ") || "none"
        }. Use an exact source ID; this is not an authentication failure.`,
      );
    throw new Error(`Unknown reviewed source ID: ${sourceId}`);
  }
  if (source.access !== "public" || source.auth)
    throw new Error("Evidence requires a reviewed public source without credentials");
  if (documentUrl === undefined) return source;
  if (documentUrl === "--index") {
    const { transport: _transport, linkedDocuments: crawl, ...plain } = source;
    if (crawl === undefined || _transport !== undefined)
      throw new Error(
        "Index evidence requires a reviewed linked-document source without a custom transport",
      );
    // Inspect the bytes that discovery rejected without changing collection admission.
    return {
      ...plain,
      maxResponseBytes: Math.min(
        source.maxResponseBytes,
        crawl.maxDocumentBytes ?? source.maxResponseBytes,
      ),
    };
  }
  const document = source.linkedDocuments?.documents?.find(({ url }) => url === documentUrl);
  if (!document) throw new Error("Evidence URL is not a fixed reviewed companion");
  // A single companion must not inherit a catalog transport or recursive crawl.
  const { transport: _transport, linkedDocuments: _linkedDocuments, ...plain } = source;
  return {
    ...plain,
    url: document.url,
    format: document.format ?? source.format,
    maxResponseBytes: Math.min(
      source.maxResponseBytes,
      document.maxResponseBytes ?? source.maxResponseBytes,
    ),
  };
}

/** One diagnostic hop from freshly fetched reviewed HTML; never a collection dependency. */
export function linkedPublicSource(
  parent: SourceManifest,
  body: string,
  targetUrl: string,
): SourceManifest {
  if (parent.access !== "public" || parent.auth || parent.format !== "html")
    throw new Error("Linked evidence requires a reviewed public HTML parent");
  const target = new URL(targetUrl);
  if (
    target.protocol !== "https:" ||
    target.username !== "" ||
    target.password !== "" ||
    target.port !== "" ||
    !parent.allowedHosts.includes(target.hostname)
  )
    throw new Error("Linked evidence left the reviewed public host boundary");
  target.hash = "";
  const linked = load(body)("a[href]")
    .toArray()
    .some((element) => {
      const href = element.attribs.href;
      if (href === undefined) return false;
      try {
        const candidate = new URL(href, parent.url);
        candidate.hash = "";
        return candidate.href === target.href;
      } catch {
        return false;
      }
    });
  if (!linked) throw new Error("Evidence URL is not linked by the fetched reviewed parent");
  const { transport: _transport, linkedDocuments: _linkedDocuments, ...plain } = parent;
  return {
    ...plain,
    url: target.href,
    maxResponseBytes: Math.min(parent.maxResponseBytes, 4 * 1024 * 1024),
  };
}
