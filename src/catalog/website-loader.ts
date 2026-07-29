import type {
  WebsiteDetailChunk,
  WebsiteModel,
  WebsiteModelDetail,
  WebsitePricingSummary,
} from "./website-schema.ts";

interface DetailTarget {
  providerId: string;
  chunk: number;
}

const detailSources = new Map<string, Promise<Blob>>();
const parsedDetailChunks = new Map<string, Promise<WebsiteDetailChunk>>();
const detailsByModel = new Map<string, WebsiteModelDetail>();
let pricingRequest: Promise<WebsitePricingSummary[]> | undefined;
let schemaModule: Promise<typeof import("./website-schema.ts")> | undefined;

function websiteSchemas(): Promise<typeof import("./website-schema.ts")> {
  schemaModule ??= import("./website-schema.ts");
  return schemaModule;
}

function detailKey({ providerId, chunk }: DetailTarget): string {
  return `${providerId}/${chunk}`;
}

function detailUrl({ providerId, chunk }: DetailTarget): string {
  return `/ui/details/${encodeURIComponent(providerId)}/${chunk}.json`;
}

async function responseText(response: Response, label: string): Promise<string> {
  if (!response.ok) throw new Error(`${label} request failed with ${response.status}`);
  return response.text();
}

async function responseBlob(response: Response): Promise<Blob> {
  if (!response.ok) throw new Error(`Model detail request failed with ${response.status}`);
  return response.blob();
}

function detailSource(target: DetailTarget): Promise<Blob> {
  const key = detailKey(target);
  const existing = detailSources.get(key);
  if (existing !== undefined) return existing;
  const request = fetch(detailUrl(target), {
    cache: "no-cache",
    headers: { Accept: "application/json" },
  }).then(responseBlob);
  detailSources.set(key, request);
  return request;
}

function parseDetailChunk(target: DetailTarget, dataVersion: string): Promise<WebsiteDetailChunk> {
  const key = detailKey(target);
  const existing = parsedDetailChunks.get(key);
  if (existing !== undefined) return existing;
  const request = Promise.all([detailSource(target), websiteSchemas()]).then(
    async ([source, { websiteDetailChunkSchema }]) => {
      const text = await source.text();
      const value: unknown = JSON.parse(text);
      const chunk = websiteDetailChunkSchema.parse(value);
      if (
        chunk.data_version !== dataVersion ||
        chunk.provider_id !== target.providerId ||
        chunk.chunk !== target.chunk
      )
        throw new Error("Model detail chunk does not match the catalog");
      for (const detail of chunk.details) detailsByModel.set(detail.model_ref, detail);
      detailSources.delete(key);
      return chunk;
    },
  );
  parsedDetailChunks.set(key, request);
  return request;
}

function detailTargets(models: readonly WebsiteModel[]): DetailTarget[] {
  const seen = new Set<string>();
  const targets: DetailTarget[] = [];
  for (const model of models) {
    const target = { providerId: model.provider_id, chunk: model.detail_chunk };
    const key = detailKey(target);
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(target);
  }
  return targets;
}

export async function loadWebsitePricing(
  dataVersion: string,
  modelCount: number,
): Promise<WebsitePricingSummary[]> {
  pricingRequest ??= Promise.all([
    fetch("/ui/catalog/pricing.json", {
      cache: "no-cache",
      headers: { Accept: "application/json" },
    }).then((response) => responseText(response, "Pricing summary")),
    websiteSchemas(),
  ]).then(([source, { websitePricingSummariesSchema }]) => {
    const value: unknown = JSON.parse(source);
    const pricing = websitePricingSummariesSchema.parse(value);
    if (pricing.data_version !== dataVersion)
      throw new Error("Pricing summary does not match the catalog");
    if (pricing.pricing.length !== modelCount)
      throw new Error("Pricing summary row count does not match the catalog");
    return pricing.pricing;
  });
  return pricingRequest;
}

export function preloadWebsiteDetails(models: readonly WebsiteModel[]): void {
  for (const target of detailTargets(models)) void detailSource(target).catch(() => undefined);
}

export async function loadWebsiteModelDetail(
  dataVersion: string,
  model: WebsiteModel,
): Promise<WebsiteModelDetail> {
  const cached = detailsByModel.get(model.uid);
  if (cached !== undefined) return cached;
  await parseDetailChunk({ providerId: model.provider_id, chunk: model.detail_chunk }, dataVersion);
  const detail = detailsByModel.get(model.uid);
  if (detail === undefined) throw new Error("Model detail chunk does not contain this model");
  return detail;
}
