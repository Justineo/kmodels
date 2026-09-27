import { manifests, type SourceManifest } from "./manifests.ts";
import type { FetchState } from "./fetch.ts";

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
  if (!source || source.access !== "public" || source.auth)
    throw new Error("Evidence requires a reviewed public source without credentials");
  if (documentUrl === undefined) return source;
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
