import type { AssetSource } from "./asset-pack.ts";
import type { WebsiteCatalogIndex, WebsitePricingSummaries } from "./website-schema.ts";

export const WEBSITE_CORE_CHUNK_MAX_BYTES = 128 * 1024;

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
  let acceptedSource = "";

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
    target.push(value);
    return index;
  }

  function append(index: number): string {
    const model = catalog.models[index];
    const row = pricing.pricing[index];
    if (model === undefined || row === undefined) throw new Error("Missing website core row");
    chunk.models.push(model);
    chunk.pricing.pricing.push([
      row[0],
      intern(row[1], pricing.statuses, chunk.pricing.statuses, statusIndexes),
      intern(row[2], pricing.cells, chunk.pricing.cells, cellIndexes),
      intern(row[3], pricing.cells, chunk.pricing.cells, cellIndexes),
      intern(row[4], pricing.cells, chunk.pricing.cells, cellIndexes),
    ]);
    return JSON.stringify(chunk);
  }

  function publish(source: string, count: number): void {
    assets.push({ fileName: websiteCoreChunkPath(catalog.data_version, counts.length), source });
    counts.push(count);
  }

  for (let index = 0; index < catalog.models.length; index += 1) {
    let source = append(index);
    if (encoder.encode(source).byteLength > WEBSITE_CORE_CHUNK_MAX_BYTES) {
      if (chunk.models.length === 1) throw new Error("A website core row exceeds the chunk limit");
      publish(acceptedSource, chunk.models.length - 1);
      chunk = createChunk();
      statusIndexes = new Map();
      cellIndexes = new Map();
      source = append(index);
      if (encoder.encode(source).byteLength > WEBSITE_CORE_CHUNK_MAX_BYTES)
        throw new Error("A website core row exceeds the chunk limit");
    }
    acceptedSource = source;
  }
  if (chunk.models.length > 0) publish(acceptedSource, chunk.models.length);
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
