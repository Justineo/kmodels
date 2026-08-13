import type {
  WebsiteDetailChunk,
  WebsiteModel,
  WebsiteModelDetail,
  WebsiteOfferChunk,
  WebsiteOfferReference,
  WebsitePricingOffer,
  WebsiteProvider,
  WebsiteProviderPricingDetail,
  WebsiteProviderPricingOffer,
  WebsiteStoredModelDetail,
} from "./website-schema.ts";

interface DetailTarget {
  providerId: string;
  chunk: number;
}

const parsedDetailChunks = new Map<string, Promise<WebsiteDetailChunk>>();
const storedDetailsByModel = new Map<string, WebsiteStoredModelDetail>();
const modelDetails = new Map<string, Promise<WebsiteModelDetail>>();
const offerChunks = new Map<string, Promise<WebsiteOfferChunk>>();
const providerPricingChunks = new Map<string, Promise<WebsiteProviderPricingDetail>>();
let schemaModule: Promise<typeof import("./website-schema.ts")> | undefined;

function websiteSchemas(): Promise<typeof import("./website-schema.ts")> {
  schemaModule ??= import("./website-schema.ts");
  return schemaModule;
}

export function preloadWebsiteSchemas(): Promise<void> {
  return websiteSchemas().then(() => undefined);
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

function offerUrl(dataVersion: string, providerId: string, chunk: number): string {
  return `/ui/offers/${encodeURIComponent(providerId)}/${chunk}.json?v=${encodeURIComponent(dataVersion)}`;
}

function providerPricingUrl(dataVersion: string, providerId: string, chunk: number): string {
  return `/ui/providers/${encodeURIComponent(providerId)}/pricing/${chunk}.json?v=${encodeURIComponent(dataVersion)}`;
}

async function responseSource(response: Response): Promise<string> {
  if (!response.ok) throw new Error(`Website asset request failed with ${response.status}`);
  return response.text();
}

function parseDetailChunk(target: DetailTarget, dataVersion: string): Promise<WebsiteDetailChunk> {
  const key = detailKey(dataVersion, target);
  return cachedRequest(parsedDetailChunks, key, () =>
    Promise.all([
      fetch(detailUrl(dataVersion, target), {
        cache: "no-cache",
        headers: { Accept: "application/json" },
      }).then(responseSource),
      websiteSchemas(),
    ]).then(([source, { websiteDetailChunkSchema }]) => {
      const value: unknown = JSON.parse(source);
      const chunk = websiteDetailChunkSchema.parse(value);
      if (
        chunk.data_version !== dataVersion ||
        chunk.provider_id !== target.providerId ||
        chunk.chunk !== target.chunk
      )
        throw new Error("Model detail chunk does not match the catalog");
      for (const detail of chunk.details)
        storedDetailsByModel.set(modelDetailKey(dataVersion, detail.model_ref), detail);
      return chunk;
    }),
  );
}

function loadOfferChunk(
  dataVersion: string,
  providerId: string,
  chunk: number,
): Promise<WebsiteOfferChunk> {
  const key = `${dataVersion}/${providerId}/${chunk}`;
  return cachedRequest(offerChunks, key, async () => {
    const [response, { websiteOfferChunkSchema }] = await Promise.all([
      fetch(offerUrl(dataVersion, providerId, chunk), {
        cache: "no-cache",
        headers: { Accept: "application/json" },
      }),
      websiteSchemas(),
    ]);
    const value: unknown = JSON.parse(await responseSource(response));
    const result = websiteOfferChunkSchema.parse(value);
    if (
      result.data_version !== dataVersion ||
      result.provider_id !== providerId ||
      result.chunk !== chunk
    )
      throw new Error("Pricing offers do not match the catalog");
    return result;
  });
}

async function loadOffer(
  dataVersion: string,
  providerId: string,
  [chunk, index]: WebsiteOfferReference,
): Promise<WebsitePricingOffer> {
  const offer = (await loadOfferChunk(dataVersion, providerId, chunk)).offers[index];
  if (offer === undefined) throw new Error("Pricing offer reference does not exist");
  return offer;
}

async function hydrateModelDetail(
  dataVersion: string,
  providerId: string,
  stored: WebsiteStoredModelDetail,
): Promise<WebsiteModelDetail> {
  const { pricing, ...detail } = stored;
  if (pricing === undefined) return detail;
  return {
    ...detail,
    pricing: {
      ...(pricing.snapshot === undefined ? {} : { snapshot: pricing.snapshot }),
      offers: await Promise.all(
        pricing.offer_refs.map((reference) => loadOffer(dataVersion, providerId, reference)),
      ),
    },
  };
}

export async function loadWebsiteModelDetail(
  dataVersion: string,
  model: WebsiteModel,
): Promise<WebsiteModelDetail> {
  const key = modelDetailKey(dataVersion, model.uid);
  return cachedRequest(modelDetails, key, async () => {
    let detail = storedDetailsByModel.get(key);
    if (detail === undefined) {
      await parseDetailChunk(
        { providerId: model.provider_id, chunk: model.detail_chunk },
        dataVersion,
      );
      detail = storedDetailsByModel.get(key);
    }
    if (detail === undefined) throw new Error("Model detail chunk does not contain this model");
    return hydrateModelDetail(dataVersion, model.provider_id, detail);
  });
}

export function loadWebsiteProviderPricing(
  dataVersion: string,
  provider: WebsiteProvider,
): Promise<WebsiteProviderPricingDetail> {
  if (provider.pricing_coverage.detail_chunks === 0)
    return Promise.reject(new Error("Provider pricing has no detail chunks"));
  return loadWebsiteProviderPricingChunk(dataVersion, provider.id, 0);
}

export function loadWebsiteProviderPricingChunk(
  dataVersion: string,
  providerId: string,
  chunk: number,
): Promise<WebsiteProviderPricingDetail> {
  const key = `${dataVersion}/${providerId}/${chunk}`;
  return cachedRequest(providerPricingChunks, key, async () => {
    const { websiteProviderPricingChunkSchema } = await websiteSchemas();
    const response = await fetch(providerPricingUrl(dataVersion, providerId, chunk), {
      cache: "no-cache",
      headers: { Accept: "application/json" },
    });
    const value: unknown = JSON.parse(await responseSource(response));
    const detail = websiteProviderPricingChunkSchema.parse(value);
    if (
      detail.data_version !== dataVersion ||
      detail.provider_id !== providerId ||
      detail.chunk !== chunk
    )
      throw new Error("Provider pricing does not match the catalog");
    return detail;
  });
}

export async function loadWebsiteProviderPricingOffer(
  dataVersion: string,
  providerId: string,
  offer: WebsiteProviderPricingOffer,
): Promise<WebsitePricingOffer> {
  const detail = mergeProviderOffer(
    await Promise.all(
      offer.offer_refs.map((reference) => loadOffer(dataVersion, providerId, reference)),
    ),
  );
  if (!sameOfferSummary(detail, offer))
    throw new Error("Provider pricing offer does not match its summary");
  return detail;
}

function mergeProviderOffer(fragments: WebsitePricingOffer[]): WebsitePricingOffer {
  const first = fragments[0];
  if (first === undefined) throw new Error("Provider pricing offer has no fragments");
  return fragments.slice(1).reduce((current, fragment) => {
    if (
      !sameOfferSummary(current, fragment) ||
      current.group !== fragment.group ||
      current.mechanism_refs?.join("\u0000") !== fragment.mechanism_refs?.join("\u0000") ||
      current.composition !== fragment.composition ||
      current.unnormalized_count !== fragment.unnormalized_count
    )
      throw new Error("Provider pricing offer fragments disagree");
    return {
      ...current,
      selectors: appendUnique(current.selectors, fragment.selectors),
      states: appendUnique(current.states, fragment.states),
      rates: appendUnique(current.rates, fragment.rates),
      allowances: appendUnique(current.allowances, fragment.allowances),
      contributions: appendUnique(current.contributions, fragment.contributions),
      enrollment: appendUnique(current.enrollment, fragment.enrollment),
      settlement: appendUnique(current.settlement, fragment.settlement),
      unnormalized: appendUnique(current.unnormalized, fragment.unnormalized),
    };
  }, first);
}

function sameOfferSummary(
  left: WebsitePricingOffer,
  right: Pick<WebsitePricingOffer, "id" | "title" | "billing_mode" | "state_summary">,
): boolean {
  return (
    left.id === right.id &&
    left.title === right.title &&
    left.state_summary === right.state_summary &&
    left.billing_mode.label === right.billing_mode.label &&
    left.billing_mode.description === right.billing_mode.description
  );
}

function appendUnique<Row extends { key: string }>(current: Row[], appended: Row[]): Row[] {
  const keys = new Set(current.map(({ key }) => key));
  if (appended.some(({ key }) => keys.has(key)))
    throw new Error("Provider pricing offer fragment repeats a row");
  return [...current, ...appended];
}
