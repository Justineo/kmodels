import type { AssetSource } from "./asset-pack.ts";
import type { WebsiteCatalogIndex, WebsitePricingSummaries } from "./website-schema.ts";

export const WEBSITE_CORE_CHUNK_MAX_BYTES = 128 * 1024;
export const WEBSITE_DETAIL_CHUNK_MAX_BYTES = 2 * 1024 * 1024;

export const WEBSITE_OFFER_GROUPS = [
  "model_mechanism",
  "optional_service",
  "automatic_component",
  "capacity",
  "plan",
  "standalone",
] as const;

export const WEBSITE_INFERENCE_STATUSES = ["matched", "candidates", "unknown"] as const;

export const WEBSITE_SELECTOR_KINDS = [
  "categorical",
  "boolean",
  "decimal_values",
  "decimal_buckets",
  "decimal_range",
] as const;

export const WEBSITE_CAPABILITY_KEYS = [
  "reasoning",
  "tool_call",
  "structured_output",
  "streaming",
  "batch",
  "prompt_cache",
  "fine_tuning",
  "citations",
  "code_execution",
  "context_management",
  "effort_control",
  "computer_use",
] as const;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Shared Zod-free check for schema 10+ structured capability applicability. */
export function hasStructuredCapabilityStatements(groups: unknown): boolean {
  return (
    Array.isArray(groups) &&
    groups.some(
      (group) =>
        isPlainRecord(group) &&
        Array.isArray(group.statements) &&
        group.statements.some((s) => isPlainRecord(s) && s.applicability !== undefined),
    )
  );
}

/** Shared Zod-free check for schema 13+ detail fields (access, scoped support, tier/max labels). */
export function detailRequiresWebsiteSchema13(detail: unknown): boolean {
  if (!isPlainRecord(detail)) return false;
  if (Array.isArray(detail.access_conditions) && detail.access_conditions.length > 0) return true;
  if (
    Array.isArray(detail.capability_details) &&
    detail.capability_details.some(
      (group) =>
        isPlainRecord(group) &&
        Array.isArray(group.statements) &&
        group.statements.some((s) => isPlainRecord(s) && s.kind === "capability_support"),
    )
  )
    return true;
  if (
    Array.isArray(detail.limit_details) &&
    detail.limit_details.some(
      (group) =>
        isPlainRecord(group) &&
        Array.isArray(group.statements) &&
        group.statements.some(
          (s) =>
            isPlainRecord(s) && (Boolean(s.account_tier) || s.kind === "published_maximum_label"),
        ),
    )
  )
    return true;
  return false;
}

interface WebsiteCoreChunk {
  schema_version: 1;
  data_version: string;
  chunk: number;
  models: WebsiteCatalogIndex["models"];
  pricing: WebsitePricingSummaries;
}

export function websiteCoreChunkPath(dataVersion: string, chunk: number): string {
  return `ui/catalog/chunks/${dataVersion}/${chunk}.json`;
}

export function websiteCoreAssets(
  catalog: WebsiteCatalogIndex,
  pricing: WebsitePricingSummaries,
): AssetSource[] {
  if (
    catalog.data_version !== pricing.data_version ||
    catalog.models.length !== pricing.pricing.length
  )
    throw new Error("Website core models and pricing do not match");
  const assets: AssetSource[] = [];
  const counts: number[] = [];
  const encoder = new TextEncoder();
  const createChunk = (): WebsiteCoreChunk => ({
    schema_version: 1,
    data_version: catalog.data_version,
    chunk: counts.length,
    models: [],
    pricing: {
      ...pricing,
      statuses: [],
      cells: [],
      pricing: [],
    },
  });
  let chunk = createChunk();
  let statusIndexes = new Map<number, number>();
  let cellIndexes = new Map<number, number>();
  const byteLength = (value: unknown) => encoder.encode(JSON.stringify(value)).byteLength;
  let sourceBytes = byteLength(chunk);

  function intern<T>(
    reference: number | null,
    source: T[],
    target: T[],
    indexes: Map<number, number>,
  ) {
    if (reference === null) return null;
    const existing = indexes.get(reference);
    if (existing !== undefined) return existing;
    const value = source[reference];
    if (value === undefined) throw new Error("Missing website pricing dictionary entry");
    const index = target.length;
    indexes.set(reference, index);
    sourceBytes += byteLength(value) + (index === 0 ? 0 : 1);
    target.push(value);
    return index;
  }

  function append(index: number): void {
    const model = catalog.models[index];
    const row = pricing.pricing[index];
    if (model === undefined || row === undefined) throw new Error("Missing website core row");
    chunk.models.push(model);
    const localRow: WebsitePricingSummaries["pricing"][number] = [
      row[0],
      intern(row[1], pricing.statuses, chunk.pricing.statuses, statusIndexes),
      intern(row[2], pricing.cells, chunk.pricing.cells, cellIndexes),
      intern(row[3], pricing.cells, chunk.pricing.cells, cellIndexes),
      intern(row[4], pricing.cells, chunk.pricing.cells, cellIndexes),
    ];
    chunk.pricing.pricing.push(localRow);
    sourceBytes += byteLength(model) + byteLength(localRow) + (chunk.models.length === 1 ? 0 : 2);
  }

  function publish(): void {
    assets.push({
      fileName: websiteCoreChunkPath(catalog.data_version, counts.length),
      source: JSON.stringify(chunk),
    });
    counts.push(chunk.models.length);
  }

  for (let index = 0; index < catalog.models.length; index += 1) {
    const statusCount = chunk.pricing.statuses.length;
    const cellCount = chunk.pricing.cells.length;
    append(index);
    if (sourceBytes > WEBSITE_CORE_CHUNK_MAX_BYTES) {
      if (chunk.models.length === 1) throw new Error("A website core row exceeds the chunk limit");
      chunk.models.pop();
      chunk.pricing.pricing.pop();
      chunk.pricing.statuses.length = statusCount;
      chunk.pricing.cells.length = cellCount;
      publish();
      chunk = createChunk();
      statusIndexes = new Map();
      cellIndexes = new Map();
      sourceBytes = byteLength(chunk);
      append(index);
      if (sourceBytes > WEBSITE_CORE_CHUNK_MAX_BYTES)
        throw new Error("A website core row exceeds the chunk limit");
    }
  }
  if (chunk.models.length > 0) publish();
  const manifest = JSON.stringify({
    schema_version: 1,
    data_version: catalog.data_version,
    generated_at: catalog.generated_at,
    providers: catalog.providers,
    chunks: counts,
  });
  if (encoder.encode(manifest).byteLength > WEBSITE_CORE_CHUNK_MAX_BYTES)
    throw new Error("Website core manifest exceeds the chunk limit");
  return [{ fileName: "ui/catalog/index.json", source: manifest }, ...assets];
}
