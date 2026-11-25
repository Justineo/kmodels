import { deliveryModes, modalities, modelScopes } from "./catalog-vocabulary.ts";
import { priceStates, rawPricingImpacts } from "./pricing-vocabulary.ts";
import {
  detailRequiresWebsiteSchema13,
  hasStructuredCapabilityStatements,
  WEBSITE_CAPABILITY_KEYS,
  WEBSITE_DETAIL_CHUNK_MAX_BYTES,
  WEBSITE_INFERENCE_STATUSES,
  WEBSITE_OFFER_GROUPS,
  WEBSITE_SELECTOR_KINDS,
} from "./website-core.ts";
import { restoreInferencePrices } from "./website-inference-storage.ts";
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

const MAX_DETAIL_CHUNKS = 24;
const MAX_MODEL_DETAILS = 128;
const MAX_OFFER_CHUNKS = 48;
const MAX_PROVIDER_PRICING_CHUNKS = 24;

const hashPattern = /^[0-9a-f]{64}$/;
const validModalities = new Set<string>(modalities);
const validDeliveryModes = new Set<string>(deliveryModes);
const validModelScopes = new Set<string>(modelScopes);
const validOfferGroups = new Set<string>(WEBSITE_OFFER_GROUPS);
const validInferenceStatuses = new Set<string>(WEBSITE_INFERENCE_STATUSES);

const parsedDetailChunks = new Map<string, Promise<Map<string, WebsiteStoredModelDetail>>>();
const modelDetails = new Map<string, Promise<WebsiteModelDetail>>();
const offerChunks = new Map<string, Promise<WebsiteOfferChunk>>();
const providerPricingChunks = new Map<string, Promise<WebsiteProviderPricingDetail>>();
const textEncoder = new TextEncoder();

function setBounded<T>(cache: Map<string, T>, key: string, value: T, maxEntries: number): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > maxEntries) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function cachedRequest<T>(
  cache: Map<string, Promise<T>>,
  key: string,
  maxEntries: number,
  load: () => Promise<T>,
): Promise<T> {
  const existing = cache.get(key);
  if (existing !== undefined) {
    cache.delete(key);
    cache.set(key, existing);
    return existing;
  }
  const request = load().catch((error: unknown) => {
    if (cache.get(key) === request) cache.delete(key);
    throw error;
  });
  setBounded(cache, key, request, maxEntries);
  return request;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && hashPattern.test(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isOfferReference(value: unknown): value is WebsiteOfferReference {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    isNonNegativeInteger(value[0]) &&
    isNonNegativeInteger(value[1])
  );
}

function assertSnapshot(value: unknown): void {
  if (value === undefined) return;
  if (!isRecord(value) || !isNonEmptyString(value.observed_at))
    throw new Error("Invalid pricing snapshot");
  if (value.publication === "fresh") return;
  if (
    value.publication === "retained" &&
    isRecord(value.refresh_failure) &&
    isNonEmptyString(value.refresh_failure.attempted_at) &&
    isNonEmptyString(value.refresh_failure.message)
  )
    return;
  throw new Error("Invalid pricing snapshot");
}

function assertBillingMode(value: unknown): void {
  if (!isRecord(value) || !isNonEmptyString(value.label))
    throw new Error("Invalid pricing billing mode");
  if (value.description !== undefined && !isNonEmptyString(value.description))
    throw new Error("Invalid pricing billing mode description");
}

function assertChunkEnvelope(
  value: unknown,
  expectedVersions: readonly number[],
  dataVersion: string,
  providerId: string,
  chunk: number,
  mismatchMessage: string,
): asserts value is Record<string, unknown> & { schema_version: number } {
  if (!isRecord(value)) throw new Error("Invalid website chunk payload");
  const version = value.schema_version;
  if (typeof version !== "number" || !expectedVersions.includes(version))
    throw new Error("Unsupported website chunk schema");
  if (
    value.data_version !== dataVersion ||
    value.provider_id !== providerId ||
    value.chunk !== chunk
  )
    throw new Error(mismatchMessage);
}

function normalizeLegacyInferencePrice(entry: unknown): unknown {
  if (!isRecord(entry) || !("evidence_urls" in entry)) return entry;
  const { evidence_urls: _omitted, ...rest } = entry;
  return rest;
}

function normalizeClaimGroups(groups: unknown, filterEmpty: boolean): unknown {
  if (!Array.isArray(groups)) throw new Error("Invalid claim detail groups");
  const normalized: Array<{ statements: unknown[] }> = [];
  for (const group of groups) {
    if (!isRecord(group) || !Array.isArray(group.statements))
      throw new Error("Invalid claim detail group");
    if (filterEmpty && group.statements.length === 0) continue;
    normalized.push({ statements: group.statements });
  }
  return normalized;
}

function assertStoredModelDetail(detail: Record<string, unknown>): void {
  if (!isNonEmptyString(detail.model_ref)) throw new Error("Invalid model detail reference");
  if (!isRecord(detail.modalities)) throw new Error("Model detail modalities are required");
  if (
    !Array.isArray(detail.modalities.input) ||
    !Array.isArray(detail.modalities.output) ||
    !detail.modalities.input.every((m) => typeof m === "string" && validModalities.has(m)) ||
    !detail.modalities.output.every((m) => typeof m === "string" && validModalities.has(m))
  )
    throw new Error("Invalid model detail modalities");
  if (!isRecord(detail.capabilities)) throw new Error("Model detail capabilities are required");
  for (const key of WEBSITE_CAPABILITY_KEYS) {
    const cap = detail.capabilities[key];
    if (typeof cap !== "boolean" && cap !== "unknown")
      throw new Error(`Invalid model detail capability: ${key}`);
  }
  if (typeof detail.scope !== "string" || !validModelScopes.has(detail.scope))
    throw new Error("Invalid model detail scope");
  if (
    detail.delivery_modes !== undefined &&
    (!Array.isArray(detail.delivery_modes) ||
      !detail.delivery_modes.every(
        (mode) => typeof mode === "string" && validDeliveryModes.has(mode),
      ))
  )
    throw new Error("Invalid model detail delivery modes");
  if (detail.pricing !== undefined) {
    if (
      !isRecord(detail.pricing) ||
      !Array.isArray(detail.pricing.offer_refs) ||
      !detail.pricing.offer_refs.every(isOfferReference)
    )
      throw new Error("Invalid model detail pricing references");
    assertSnapshot(detail.pricing.snapshot);
  }
  if (detail.inference_prices !== undefined) {
    if (!Array.isArray(detail.inference_prices))
      throw new Error("Invalid model detail inference prices");
    for (const entry of detail.inference_prices) {
      if (
        !isRecord(entry) ||
        !isNonEmptyString(entry.model_id) ||
        typeof entry.status !== "string" ||
        !validInferenceStatuses.has(entry.status) ||
        !isNonEmptyString(entry.explanation) ||
        !Array.isArray(entry.missing_conditions) ||
        !Array.isArray(entry.candidates)
      )
        throw new Error("Invalid model detail inference price record");
    }
  }
}

function assertDetailChunk(
  value: unknown,
  dataVersion: string,
  providerId: string,
  chunk: number,
): asserts value is WebsiteDetailChunk {
  assertChunkEnvelope(
    value,
    [7, 8, 9, 10, 11, 12, 13],
    dataVersion,
    providerId,
    chunk,
    "Model detail chunk does not match the catalog",
  );
  assertSnapshot(value.snapshot);
  if (!Array.isArray(value.details)) throw new Error("Model detail chunk details must be an array");
  const version = value.schema_version;
  let anyRequiresV13 = false;
  for (const detail of value.details) {
    if (!isRecord(detail)) throw new Error("Invalid model detail record");
    if (version === 7 && detail.limit_details !== undefined)
      throw new Error("Limit details require schema 8 or newer");
    if (version <= 8 && detail.capability_details !== undefined)
      throw new Error("Capability details require schema 9 or newer");
    if (version === 9 && hasStructuredCapabilityStatements(detail.capability_details))
      throw new Error("Structured capability applicability requires schema 10");
    if (version <= 12 && detail.access_conditions !== undefined)
      throw new Error("Access conditions require schema 13");
    if (version <= 11) {
      if (Array.isArray(detail.inference_prices))
        detail.inference_prices = detail.inference_prices.map(normalizeLegacyInferencePrice);
      const filterEmpty = version <= 10;
      if (detail.limit_details !== undefined)
        detail.limit_details = normalizeClaimGroups(detail.limit_details, filterEmpty);
      if (detail.capability_details !== undefined)
        detail.capability_details = normalizeClaimGroups(detail.capability_details, filterEmpty);
    }
    assertStoredModelDetail(detail);
    const requiresV13 = detailRequiresWebsiteSchema13(detail);
    if (version === 12 && requiresV13) throw new Error("Scoped support requires schema 13");
    if (requiresV13) anyRequiresV13 = true;
  }
  if (version === 13 && !anyRequiresV13)
    throw new Error("Version 13 requires scoped support, access or tier limits");
}

const validPriceStates = new Set<string>(priceStates);
const validRawImpacts = new Set<string>(rawPricingImpacts);
const validSelectorKinds = new Set<string>(WEBSITE_SELECTOR_KINDS);

function assertApplicability(value: unknown, label: string): void {
  if (!isRecord(value) || !Array.isArray(value.any_of) || value.any_of.length === 0)
    throw new Error(`Invalid applicability on ${label}`);
  for (const clause of value.any_of) {
    if (!isRecord(clause) || !Array.isArray(clause.all_of))
      throw new Error(`Invalid applicability clause on ${label}`);
    for (const condition of clause.all_of) {
      if (
        !isRecord(condition) ||
        !isNonEmptyString(condition.kind) ||
        !isRecord(condition.dimension) ||
        !isNonEmptyString(condition.dimension.namespace) ||
        !isNonEmptyString(condition.dimension.value)
      )
        throw new Error(`Invalid applicability condition on ${label}`);
    }
  }
}

function assertScopedRow(row: unknown, label: string): asserts row is Record<string, unknown> {
  if (!isRecord(row) || !isNonEmptyString(row.key) || !isNonEmptyString(row.applicability_label))
    throw new Error(`Invalid website pricing ${label} row`);
  assertApplicability(row.applicability, label);
}

function assertPricingOffer(offer: unknown): void {
  if (
    !isRecord(offer) ||
    !isHash(offer.id) ||
    !isNonEmptyString(offer.title) ||
    typeof offer.group !== "string" ||
    !validOfferGroups.has(offer.group) ||
    !isNonEmptyString(offer.state_summary) ||
    !Array.isArray(offer.selectors) ||
    !Array.isArray(offer.states) ||
    !Array.isArray(offer.rates) ||
    !Array.isArray(offer.allowances) ||
    !Array.isArray(offer.contributions) ||
    !Array.isArray(offer.enrollment) ||
    !Array.isArray(offer.settlement) ||
    !isNonNegativeInteger(offer.unnormalized_count) ||
    !Array.isArray(offer.unnormalized)
  )
    throw new Error("Invalid website pricing offer");
  assertBillingMode(offer.billing_mode);
  for (const selector of offer.selectors) {
    if (
      !isRecord(selector) ||
      !isNonEmptyString(selector.key) ||
      !isNonEmptyString(selector.label) ||
      typeof selector.kind !== "string" ||
      !validSelectorKinds.has(selector.kind) ||
      !isRecord(selector.dimension)
    )
      throw new Error("Invalid website pricing selector");
  }
  for (const state of offer.states) {
    assertScopedRow(state, "state");
    if (
      typeof state.state !== "string" ||
      !validPriceStates.has(state.state) ||
      !isNonEmptyString(state.label)
    )
      throw new Error("Invalid website pricing state");
  }
  for (const rate of offer.rates) {
    assertScopedRow(rate, "rate");
    if (
      !isHash(rate.term_ref) ||
      !isNonEmptyString(rate.label) ||
      !isNonEmptyString(rate.amount) ||
      !isNonEmptyString(rate.unit) ||
      !isNonEmptyString(rate.accessible_text)
    )
      throw new Error("Invalid website pricing rate");
  }
  for (const allowance of offer.allowances) {
    assertScopedRow(allowance, "allowance");
    if (
      !isNonEmptyString(allowance.value) ||
      !isNonEmptyString(allowance.target) ||
      !isNonEmptyString(allowance.reset)
    )
      throw new Error("Invalid website pricing allowance");
  }
  for (const contribution of offer.contributions) {
    assertScopedRow(contribution, "contribution");
    if (
      !isNonEmptyString(contribution.label) ||
      !isNonEmptyString(contribution.target) ||
      !Array.isArray(contribution.drivers)
    )
      throw new Error("Invalid website pricing contribution");
  }
  for (const enrollment of offer.enrollment) {
    assertScopedRow(enrollment, "enrollment");
    if (!isNonEmptyString(enrollment.label)) throw new Error("Invalid website pricing enrollment");
  }
  for (const settlement of offer.settlement) {
    assertScopedRow(settlement, "settlement");
    if (
      !isNonEmptyString(settlement.channel) ||
      !isNonEmptyString(settlement.biller) ||
      !Array.isArray(settlement.payment_sources) ||
      settlement.payment_sources.length === 0
    )
      throw new Error("Invalid website pricing settlement");
  }
  for (const note of offer.unnormalized) {
    if (
      !isRecord(note) ||
      !isNonEmptyString(note.key) ||
      !isNonEmptyString(note.label) ||
      typeof note.impact !== "string" ||
      !validRawImpacts.has(note.impact) ||
      !isNonEmptyString(note.reason)
    )
      throw new Error("Invalid website pricing unnormalized note");
    if (note.possible_scope !== undefined)
      assertApplicability(note.possible_scope, "unnormalized note");
  }
}

function assertOfferChunk(
  value: unknown,
  dataVersion: string,
  providerId: string,
  chunk: number,
): asserts value is WebsiteOfferChunk {
  assertChunkEnvelope(
    value,
    [3],
    dataVersion,
    providerId,
    chunk,
    "Pricing offers do not match the catalog",
  );
  if (!Array.isArray(value.offers) || value.offers.length === 0)
    throw new Error("Pricing offers must be a non-empty array");
  for (const offer of value.offers) assertPricingOffer(offer);
}

function assertProviderPricingChunk(
  value: unknown,
  dataVersion: string,
  providerId: string,
  chunk: number,
): asserts value is WebsiteProviderPricingDetail {
  assertChunkEnvelope(
    value,
    [3],
    dataVersion,
    providerId,
    chunk,
    "Provider pricing does not match the catalog",
  );
  assertSnapshot(value.snapshot);
  if (!Array.isArray(value.resources))
    throw new Error("Provider pricing resources must be an array");
  for (const resource of value.resources) {
    if (
      !isRecord(resource) ||
      !isHash(resource.id) ||
      !isNonEmptyString(resource.title) ||
      !isNonEmptyString(resource.kind) ||
      typeof resource.raw_only !== "boolean" ||
      !Array.isArray(resource.offers) ||
      resource.offers.length === 0
    )
      throw new Error("Invalid provider pricing resource");
    for (const offer of resource.offers) {
      if (
        !isRecord(offer) ||
        !isHash(offer.id) ||
        !isNonEmptyString(offer.title) ||
        !isNonEmptyString(offer.state_summary) ||
        !Array.isArray(offer.offer_refs) ||
        offer.offer_refs.length === 0 ||
        !offer.offer_refs.every(isOfferReference)
      )
        throw new Error("Invalid provider pricing offer summary");
      assertBillingMode(offer.billing_mode);
    }
  }
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

async function fetchJson(
  url: string,
  maxBytes?: number,
  oversizeMessage?: string,
): Promise<unknown> {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Website asset request failed with ${response.status}`);
  const source = await response.text();
  if (maxBytes !== undefined && textEncoder.encode(source).byteLength > maxBytes)
    throw new Error(oversizeMessage ?? "Website asset exceeds the size limit");
  return JSON.parse(source);
}

function parseDetailChunk(
  target: DetailTarget,
  dataVersion: string,
): Promise<Map<string, WebsiteStoredModelDetail>> {
  const key = `${dataVersion}/${target.providerId}/${target.chunk}`;
  return cachedRequest(parsedDetailChunks, key, MAX_DETAIL_CHUNKS, async () => {
    const value = await fetchJson(
      detailUrl(dataVersion, target),
      WEBSITE_DETAIL_CHUNK_MAX_BYTES,
      "Model detail chunk exceeds the size limit",
    );
    assertDetailChunk(value, dataVersion, target.providerId, target.chunk);
    const byModelRef = new Map<string, WebsiteStoredModelDetail>();
    for (const detail of value.details) {
      const { pricing } = detail;
      byModelRef.set(
        detail.model_ref,
        value.snapshot === undefined || pricing === undefined || pricing.snapshot !== undefined
          ? detail
          : { ...detail, pricing: { ...pricing, snapshot: value.snapshot } },
      );
    }
    return byModelRef;
  });
}

function loadOfferChunk(
  dataVersion: string,
  providerId: string,
  chunk: number,
): Promise<WebsiteOfferChunk> {
  const key = `${dataVersion}/${providerId}/${chunk}`;
  return cachedRequest(offerChunks, key, MAX_OFFER_CHUNKS, async () => {
    const value = await fetchJson(offerUrl(dataVersion, providerId, chunk));
    assertOfferChunk(value, dataVersion, providerId, chunk);
    return value;
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
  const { pricing, inference_prices, ...base } = stored;
  const detail = {
    ...base,
    ...(inference_prices === undefined
      ? {}
      : { inference_prices: restoreInferencePrices(inference_prices) }),
  };
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

export async function preloadWebsiteModelDetail(
  dataVersion: string,
  model: WebsiteModel,
): Promise<void> {
  const byModelRef = await parseDetailChunk(
    { providerId: model.provider_id, chunk: model.detail_chunk },
    dataVersion,
  );
  const stored = byModelRef.get(model.uid);
  const refs = stored?.pricing?.offer_refs;
  if (refs === undefined || refs.length === 0) return;
  const offerChunkIndexes = new Set(refs.map(([chunk]) => chunk));
  await Promise.all(
    [...offerChunkIndexes].map((chunk) => loadOfferChunk(dataVersion, model.provider_id, chunk)),
  );
}

export async function loadWebsiteModelDetail(
  dataVersion: string,
  model: WebsiteModel,
): Promise<WebsiteModelDetail> {
  const key = `${dataVersion}/${model.uid}`;
  return cachedRequest(modelDetails, key, MAX_MODEL_DETAILS, async () => {
    const byModelRef = await parseDetailChunk(
      { providerId: model.provider_id, chunk: model.detail_chunk },
      dataVersion,
    );
    const detail = byModelRef.get(model.uid);
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
  return cachedRequest(providerPricingChunks, key, MAX_PROVIDER_PRICING_CHUNKS, async () => {
    const value = await fetchJson(providerPricingUrl(dataVersion, providerId, chunk));
    assertProviderPricingChunk(value, dataVersion, providerId, chunk);
    return value;
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
      JSON.stringify(current.mechanism_links) !== JSON.stringify(fragment.mechanism_links) ||
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
