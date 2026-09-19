import { manifests, type SourceManifest } from "./manifests.ts";

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
