import type { WebsiteDetailChunk, WebsiteModel, WebsiteModelDetail } from "./website-schema.ts";

interface DetailTarget {
  providerId: string;
  chunk: number;
}

const detailSources = new Map<string, Promise<Blob>>();
const parsedDetailChunks = new Map<string, Promise<WebsiteDetailChunk>>();
const detailsByModel = new Map<string, WebsiteModelDetail>();
let schemaModule: Promise<typeof import("./website-schema.ts")> | undefined;

function websiteSchemas(): Promise<typeof import("./website-schema.ts")> {
  schemaModule ??= import("./website-schema.ts");
  return schemaModule;
}

function cachedRequest<T>(
  cache: Map<string, Promise<T>>,
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  const existing = cache.get(key);
  if (existing !== undefined) return existing;
  const request = load().catch((error: unknown) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, request);
  return request;
}

function targetKey({ providerId, chunk }: DetailTarget): string {
  return `${providerId}/${chunk}`;
}

function detailKey(dataVersion: string, target: DetailTarget): string {
  return `${dataVersion}/${targetKey(target)}`;
}

function modelDetailKey(dataVersion: string, modelRef: string): string {
  return `${dataVersion}/${modelRef}`;
}

function detailUrl(dataVersion: string, { providerId, chunk }: DetailTarget): string {
  return `/ui/details/${encodeURIComponent(providerId)}/${chunk}.json?v=${encodeURIComponent(dataVersion)}`;
}

async function responseBlob(response: Response): Promise<Blob> {
  if (!response.ok) throw new Error(`Model detail request failed with ${response.status}`);
  return response.blob();
}

function detailSource(dataVersion: string, target: DetailTarget): Promise<Blob> {
  const key = detailKey(dataVersion, target);
  return cachedRequest(detailSources, key, () =>
    fetch(detailUrl(dataVersion, target), {
      cache: "no-cache",
      headers: { Accept: "application/json" },
    }).then(responseBlob),
  );
}

function parseDetailChunk(target: DetailTarget, dataVersion: string): Promise<WebsiteDetailChunk> {
  const key = detailKey(dataVersion, target);
  return cachedRequest(parsedDetailChunks, key, () =>
    Promise.all([detailSource(dataVersion, target), websiteSchemas()])
      .then(async ([source, { websiteDetailChunkSchema }]) => {
        const value: unknown = JSON.parse(await source.text());
        const chunk = websiteDetailChunkSchema.parse(value);
        if (
          chunk.data_version !== dataVersion ||
          chunk.provider_id !== target.providerId ||
          chunk.chunk !== target.chunk
        )
          throw new Error("Model detail chunk does not match the catalog");
        for (const detail of chunk.details)
          detailsByModel.set(modelDetailKey(dataVersion, detail.model_ref), detail);
        return chunk;
      })
      .finally(() => detailSources.delete(key)),
  );
}

function detailTargets(models: readonly WebsiteModel[]): DetailTarget[] {
  const seen = new Set<string>();
  const targets: DetailTarget[] = [];
  for (const model of models) {
    const target = { providerId: model.provider_id, chunk: model.detail_chunk };
    const key = targetKey(target);
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(target);
  }
  return targets;
}

export function preloadWebsiteDetails(dataVersion: string, models: readonly WebsiteModel[]): void {
  for (const target of detailTargets(models))
    void detailSource(dataVersion, target).catch(() => undefined);
}

export async function loadWebsiteModelDetail(
  dataVersion: string,
  model: WebsiteModel,
): Promise<WebsiteModelDetail> {
  const cached = detailsByModel.get(modelDetailKey(dataVersion, model.uid));
  if (cached !== undefined) return cached;
  await parseDetailChunk({ providerId: model.provider_id, chunk: model.detail_chunk }, dataVersion);
  const detail = detailsByModel.get(modelDetailKey(dataVersion, model.uid));
  if (detail === undefined) throw new Error("Model detail chunk does not contain this model");
  return detail;
}
