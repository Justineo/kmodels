import {
  assembleProviderPricing,
  type AtomicModelDisposition,
  type AtomicPricingOffer,
  type AtomicPriceState,
  type AtomicProviderPricing,
  type AtomicRateTerm,
  type AtomicRawTerm,
  type AtomicRawVariant,
  type ProviderPricingPartition,
} from "./pricing-assembly.ts";
import { canonicalJson } from "./canonical-json.ts";
import { unconditionalApplicability } from "./pricing-canonical.ts";
import { rationalFromDecimal } from "./pricing-rational.ts";
import { canonicalizeInstant, isPublishedTime } from "./pricing-time.ts";
import {
  canonicalizeSourceUnit,
  canonicalizeUnitPrice,
  type CanonicalSourceUnit,
  type FixedUnitScale,
} from "./pricing-units.ts";
import type {
  PriceApplicability,
  PriceCondition,
  PriceDenomination,
  PriceDimension,
  PriceMeter,
  PriceSourceLocator,
  ProviderAtomRegistryEntry,
  PublishedValidity,
  RawPriceFact,
  UnitExpression,
  UnitPrice,
} from "./pricing-schema.ts";
import type { PricingCategoricalLabel, SourceManifest } from "./manifests.ts";
import { applyAnthropicCommercialTopology } from "./anthropic-commercial.ts";
import { applyAzureCommercialTopology } from "./azure-pricing-commercial.ts";
import { applyBedrockCommercialTopology } from "./bedrock-commercial.ts";
import { applyCerebrasCommercialTopology } from "./cerebras-commercial.ts";
import { applyCohereCommercialTopology } from "./cohere-commercial.ts";
import { applyDatabricksCommercialTopology } from "./databricks-commercial.ts";
import { applyDashscopeCommercialTopology } from "./dashscope-commercial.ts";
import { applyDeepseekCommercialTopology } from "./deepseek-commercial.ts";
import { applyGeminiCommercialTopology } from "./gemini-commercial.ts";
import { applyHuggingFaceCommercialTopology } from "./huggingface-commercial.ts";
import { applyKimiCommercialTopology } from "./kimi-commercial.ts";
import { applyLlamaCommercialTopology } from "./llama-commercial.ts";
import { applyMistralCommercialTopology } from "./mistral-commercial.ts";
import { applyOpenAiCommercialTopology } from "./openai-commercial.ts";
import { applyOllamaCommercialTopology } from "./ollama-commercial.ts";
import { applyVercelCommercialTopology } from "./vercel-commercial.ts";
import { applyVertexCommercialTopology } from "./vertex-commercial.ts";
import { applyXaiCommercialTopology } from "./xai-commercial.ts";
import {
  sourcePriceFactSchema,
  type ParsedPricingModel,
  type ParsedProviderModel,
  type SourcePriceFact,
  type SourceRawPricingFact,
  type SourceCommercialPricingFact,
} from "./pricing-source.ts";

export interface ParsedPricingSource {
  source: SourceManifest;
  models: ParsedPricingModel[];
}

export type PublishedPricingModel = Pick<
  ParsedProviderModel,
  | "api_endpoints"
  | "capabilities"
  | "model_id"
  | "name"
  | "service_families"
  | "status"
  | "tasks"
  | "uid"
  | "version"
>;

export function isPricingSource(source: SourceManifest): boolean {
  const declaresPricing = source.fields.includes("pricing");
  if (declaresPricing !== (source.pricingEvidence !== undefined))
    throw new Error(`Pricing source policy mismatch for ${source.id}`);
  return declaresPricing && !["account", "workspace", "runtime"].includes(source.scope ?? "global");
}

export function isRequiredPricingSource(source: SourceManifest): boolean {
  return (!source.optional || source.pricingRequired === true) && isPricingSource(source);
}

interface OfferBuilder {
  offerKey: string;
  name: string;
  billingMode: "usage" | "capacity" | "subscription" | "one_time" | "hybrid";
  states: AtomicPriceState[];
  terms: Map<string, AtomicRateTerm | AtomicRawTerm>;
  sourceRefs: Set<string>;
}

interface AdapterContext {
  providerId: string;
  bookKey: string;
  bookName: string;
  atoms: Map<string, ProviderAtomRegistryEntry>;
  categoricalLabels: ReadonlyMap<string, string>;
  scopeBySource: Map<string, Set<string>>;
  offers: Map<string, OfferBuilder>;
}

interface PricingBinding {
  bookKey: string;
  bookName: string;
  model: ParsedPricingModel;
  modelRefs: string[];
}

export function assembleParsedProviderPricing(
  providerId: string,
  observedAt: string,
  sources: readonly ParsedPricingSource[],
  publishedModels: readonly PublishedPricingModel[],
  categoricalLabels: readonly PricingCategoricalLabel[] = [],
): ProviderPricingPartition | undefined {
  const publishedByUid = new Map(publishedModels.map((model) => [model.uid, model]));
  const publishedGroups = groupModelsById(publishedModels);
  const pricingSources = sources.filter(({ source }) => isPricingSource(source));
  const numericAuthorityByModel = new Map<string, number>();
  for (const { source, models } of pricingSources) {
    for (const model of models) {
      if (!model.price_facts.some((rate) => rateMode(rate) === "usage")) continue;
      const binding = pricingBinding(source, model, publishedByUid, publishedGroups);
      if (binding === undefined) continue;
      const authority = pricingEvidencePriority(source);
      for (const modelRef of binding.modelRefs)
        numericAuthorityByModel.set(
          modelRef,
          Math.max(numericAuthorityByModel.get(modelRef) ?? 0, authority),
        );
    }
  }
  const exactPriceRefs = new Set(
    pricingSources.flatMap(({ source, models }) =>
      source.pricingEvidence?.binding === "base_model_id"
        ? []
        : models.flatMap((model) => {
            if (model.price_facts.length === 0) return [];
            const published = resolvePublishedModel(model, publishedByUid, publishedGroups);
            return published === undefined ? [] : [published.uid];
          }),
    ),
  );
  const atoms = new Map<string, ProviderAtomRegistryEntry>();
  const labelIndex = categoricalLabelIndex(categoricalLabels);
  const contexts = new Map<string, AdapterContext>();
  const dispositions: AtomicModelDisposition[] = [];
  for (const { source, models } of pricingSources) {
    for (const model of models) {
      const binding = pricingBinding(source, model, publishedByUid, publishedGroups);
      if (binding === undefined) continue;
      const { bookKey, bookName, model: bound } = binding;
      const candidateModelRefs =
        source.pricingEvidence?.binding === "base_model_id"
          ? binding.modelRefs.filter((modelRef) => !exactPriceRefs.has(modelRef))
          : binding.modelRefs;
      const authority = pricingEvidencePriority(source);
      const modelRefs =
        bound.pricing_state === "not_published" && bound.price_facts.length === 0
          ? candidateModelRefs.filter(
              (modelRef) => (numericAuthorityByModel.get(modelRef) ?? 0) <= authority,
            )
          : candidateModelRefs;
      if (modelRefs.length === 0) continue;
      if (bound.pricing_state === "not_applicable") {
        for (const modelRef of modelRefs)
          dispositions.push({
            model_ref: modelRef,
            observation: {
              source_ref: source.id,
              locator: { kind: "provider_key", value: "pricing:model-state" },
              establishes_model_ref: modelRef,
              raw: { label: "No public hosted pricing offer" },
            },
          });
        continue;
      }
      const context = adapterContext(contexts, providerId, bookKey, bookName, atoms, labelIndex);
      addModelPricing(context, source.id, bound, modelRefs);
    }
  }
  const commercialFacts = pricingSources.flatMap(({ models }) =>
    models.flatMap(({ commercial_facts }) => commercial_facts ?? []),
  );
  const books = [
    ...[...contexts.values()].flatMap(pricingBooks),
    ...commercialPricingBooks(
      providerId,
      commercialFacts,
      new Set(publishedModels.map(({ uid }) => uid)),
      atoms,
      labelIndex,
    ),
  ];
  if (books.length === 0 && dispositions.length === 0) return undefined;
  const input = {
    provider_id: providerId,
    observed_at: observedAt,
    vocabulary: { provider_id: providerId, atoms: [...atoms.values()] },
    dispositions,
    books,
  } satisfies AtomicProviderPricing;
  const openai = applyOpenAiCommercialTopology(input, publishedModels);
  const anthropic = applyAnthropicCommercialTopology(openai);
  const bedrock = applyBedrockCommercialTopology(anthropic);
  const azure = applyAzureCommercialTopology(bedrock, publishedModels);
  const vercel = applyVercelCommercialTopology(azure);
  const databricks = applyDatabricksCommercialTopology(vercel);
  const gemini = applyGeminiCommercialTopology(databricks);
  const vertex = applyVertexCommercialTopology(gemini, publishedModels);
  const kimi = applyKimiCommercialTopology(vertex);
  const cohere = applyCohereCommercialTopology(kimi, publishedModels);
  const mistral = applyMistralCommercialTopology(cohere);
  const llama = applyLlamaCommercialTopology(mistral);
  const huggingFace = applyHuggingFaceCommercialTopology(llama);
  const dashscope = applyDashscopeCommercialTopology(huggingFace);
  const deepseek = applyDeepseekCommercialTopology(dashscope, publishedModels);
  const cerebras = applyCerebrasCommercialTopology(deepseek, publishedModels);
  const ollama = applyOllamaCommercialTopology(cerebras, publishedModels);
  return assembleProviderPricing(applyXaiCommercialTopology(ollama, publishedModels));
}

function pricingEvidencePriority(source: SourceManifest): number {
  switch (source.pricingEvidence?.kind) {
    case "billing_catalog":
    case "scoped_meter_inventory":
      return 4;
    case "price_book":
      return 3;
    case "model_catalog":
      return 2;
    case "commercial_terms":
      return 1;
    case undefined:
      return 0;
  }
}

function groupModelsById(
  models: readonly PublishedPricingModel[],
): Map<string, PublishedPricingModel[]> {
  const groups = new Map<string, PublishedPricingModel[]>();
  for (const model of models) {
    const group = groups.get(model.model_id) ?? [];
    group.push(model);
    groups.set(model.model_id, group);
  }
  return groups;
}

function pricingBinding(
  source: SourceManifest,
  model: ParsedPricingModel,
  publishedByUid: ReadonlyMap<string, PublishedPricingModel>,
  publishedGroups: ReadonlyMap<string, PublishedPricingModel[]>,
): PricingBinding | undefined {
  if (source.pricingEvidence?.binding === "base_model_id" && model.version === undefined) {
    const published = publishedGroups
      .get(model.model_id)
      ?.filter(({ status }) => status !== "retired");
    if (published === undefined || published.length === 0) return;
    const modelRefs = published.map(({ uid }) => uid);
    return {
      bookKey: modelRefs.length === 1 ? `model:${modelRefs[0]}` : `base-model:${model.uid}`,
      bookName:
        modelRefs.length === 1
          ? `Pricing for ${modelRefs[0]}`
          : `Pricing for base model ${model.uid}`,
      model,
      modelRefs,
    };
  }

  const published = resolvePublishedModel(model, publishedByUid, publishedGroups);
  if (published === undefined) return;
  const bound =
    published.uid === model.uid
      ? model
      : {
          ...model,
          model_id: published.model_id,
          uid: published.uid,
          ...(published.version === undefined ? {} : { version: published.version }),
        };
  return {
    bookKey: `model:${bound.uid}`,
    bookName: `Pricing for ${bound.uid}`,
    model: bound,
    modelRefs: [bound.uid],
  };
}

function resolvePublishedModel(
  model: Pick<ParsedPricingModel, "model_id" | "uid" | "version">,
  byUid: ReadonlyMap<string, PublishedPricingModel>,
  groups: ReadonlyMap<string, PublishedPricingModel[]>,
): PublishedPricingModel | undefined {
  const exact = byUid.get(model.uid);
  if (exact !== undefined || model.version !== undefined) return exact;
  const matches = groups.get(model.model_id);
  return matches?.length === 1 ? matches[0] : undefined;
}

function adapterContext(
  contexts: Map<string, AdapterContext>,
  providerId: string,
  key: string,
  name: string,
  atoms: Map<string, ProviderAtomRegistryEntry>,
  categoricalLabels: ReadonlyMap<string, string>,
): AdapterContext {
  const current = contexts.get(key);
  if (current !== undefined) return current;
  const created: AdapterContext = {
    providerId,
    bookKey: key,
    bookName: name,
    atoms,
    categoricalLabels,
    scopeBySource: new Map(),
    offers: new Map(),
  };
  contexts.set(key, created);
  return created;
}

function addModelPricing(
  context: AdapterContext,
  sourceRef: string,
  model: ParsedPricingModel,
  modelRefs: readonly string[],
  forcedOffer?: {
    key: string;
    name: string;
    billingMode: OfferBuilder["billingMode"];
  },
): void {
  const rates = normalizedSourceFacts(context.providerId, model.price_facts);
  const hasUsageRate = model.price_facts.some((rate) => rateMode(rate) === "usage");
  const state = model.pricing_state;
  const publishesState =
    !hasUsageRate && (state === "free" || state === "custom_quote" || state === "not_published");
  if (rates.length === 0 && model.raw_price_facts.length === 0 && !publishesState) return;

  addScope(context, sourceRef, modelRefs);
  for (const { sourceRate, normalizedRate } of rates)
    addRate(context, sourceRef, model, sourceRate, normalizedRate, forcedOffer);
  for (const fact of model.raw_price_facts) addRaw(context, sourceRef, model, fact, forcedOffer);
  if (publishesState) addState(context, sourceRef, state, forcedOffer);
}

function commercialPricingBooks(
  providerId: string,
  facts: readonly SourceCommercialPricingFact[],
  publishedModelRefs: ReadonlySet<string>,
  atoms: Map<string, ProviderAtomRegistryEntry>,
  categoricalLabels: ReadonlyMap<string, string>,
): AtomicProviderPricing["books"] {
  const groups = new Map<
    string,
    {
      context: AdapterContext;
      resourceKind: SourceCommercialPricingFact["resource_kind"];
      resourceKey: string;
    }
  >();
  for (const fact of facts) {
    if (
      [...fact.price_facts, ...fact.raw_price_facts].some(
        ({ source_ref }) => source_ref !== fact.source_ref,
      )
    )
      throw new Error(`Commercial fact ${fact.book_key} has mixed sources`);
    const sourceRef = fact.source_ref;
    const current = groups.get(fact.book_key);
    if (
      current !== undefined &&
      (current.resourceKind !== fact.resource_kind || current.resourceKey !== fact.resource_key)
    )
      throw new Error(`Commercial book ${fact.book_key} changes resource identity`);
    const context =
      current?.context ??
      adapterContext(
        new Map(),
        providerId,
        fact.book_key,
        fact.book_name,
        atoms,
        categoricalLabels,
      );
    if (current === undefined)
      groups.set(fact.book_key, {
        context,
        resourceKind: fact.resource_kind,
        resourceKey: fact.resource_key,
      });
    const modelRefs = fact.model_refs.filter((modelRef) => publishedModelRefs.has(modelRef));
    const model = {
      provider_id: providerId,
      model_id: `resource:${fact.resource_key}`,
      uid: `${providerId}/resource:${fact.resource_key}`,
      pricing_state:
        fact.pricing_state === "included" || fact.pricing_state === "externally_billed"
          ? ("unknown" as const)
          : fact.pricing_state,
      price_facts: fact.price_facts,
      raw_price_facts: fact.raw_price_facts,
    };
    addModelPricing(context, sourceRef, model, modelRefs, {
      key: fact.offer_key,
      name: fact.offer_name,
      billingMode: fact.billing_mode,
    });
    if (fact.pricing_state === "included" || fact.pricing_state === "externally_billed") {
      addScope(context, sourceRef, modelRefs);
      addState(context, sourceRef, fact.pricing_state, {
        key: fact.offer_key,
        name: fact.offer_name,
        billingMode: fact.billing_mode,
      });
    }
  }
  return [...groups.values()].flatMap(({ context, resourceKind, resourceKey }) => {
    const sourceRefs = [...context.scopeBySource.keys()];
    if (sourceRefs.length === 0) return [];
    const modelRefs = [
      ...new Set([...context.scopeBySource.values()].flatMap((refs) => [...refs])),
    ];
    return [
      {
        book_key: context.bookKey,
        name: context.bookName,
        scope: {
          kind: "provider_resource" as const,
          resource_kind: { namespace: "kmodels" as const, value: resourceKind },
          resource_key: resourceKey,
          model_refs: modelRefs,
        },
        scope_observations: [...context.scopeBySource].map(([sourceRef, refs]) => ({
          source_ref: sourceRef,
          locator: { kind: "provider_key" as const, value: `resource:${resourceKey}` },
          establishes: {
            kind: "provider_resource" as const,
            resource_kind: { namespace: "kmodels" as const, value: resourceKind },
            resource_key: resourceKey,
            model_refs: [...refs],
          },
          raw: { label: context.bookName },
        })),
        offers: [...context.offers.values()].map(pricingOffer),
        source_refs: sourceRefs,
      },
    ];
  });
}

function addRaw(
  context: AdapterContext,
  sourceRef: string,
  model: ParsedPricingModel,
  fact: SourceRawPricingFact,
  forcedOffer?: Parameters<typeof addModelPricing>[4],
): void {
  const offer = forcedOfferBuilder(context, forcedOffer, "usage");
  const term = rawTerm(offer, fact.term_key);
  const validity = publishedValidity(fact.conditions);
  offer.sourceRefs.add(sourceRef);
  term.source_refs.push(sourceRef);
  term.variants.push({
    impact: fact.impact,
    reason: validity === false ? "unsupported_structure" : fact.reason,
    possible_scope: rateApplicability(context, fact.conditions),
    ...(validity === undefined || validity === false ? {} : { validity }),
    observation: {
      source_ref: sourceRef,
      locator: {
        kind: "provider_key",
        value: JSON.stringify([model.uid, fact.term_key, fact.conditions, fact.raw]),
      },
      raw: fact.raw,
    },
  });
}

function addState(
  context: AdapterContext,
  sourceRef: string,
  state: "free" | "included" | "externally_billed" | "custom_quote" | "not_published",
  forcedOffer?: Parameters<typeof addModelPricing>[4],
): void {
  const offer = forcedOfferBuilder(context, forcedOffer, "usage");
  const applicability = unconditionalApplicability;
  offer.sourceRefs.add(sourceRef);
  offer.states.push({
    state,
    applicability,
    observation: normalizedObservation(
      sourceRef,
      { kind: "provider_key", value: "pricing:model-state" },
      {
        label:
          state === "free"
            ? "Free"
            : state === "included"
              ? "Included"
              : state === "externally_billed"
                ? "Externally billed"
                : state === "custom_quote"
                  ? "Custom quote"
                  : "Price not published",
      },
      applicability,
    ),
  });
}

function addRate(
  context: AdapterContext,
  sourceRef: string,
  model: ParsedPricingModel,
  sourceRate: SourcePriceFact,
  normalizedRate: SourcePriceFact,
  forcedOffer?: Parameters<typeof addModelPricing>[4],
): void {
  const mode = rateMode(sourceRate);
  const offer = forcedOfferBuilder(context, forcedOffer, mode);
  const fact = rawFact(sourceRate);
  const locator = rateLocator(model, sourceRate);
  const meter = canonicalMeter(context, sourceRate);
  if (meter === undefined) {
    const term = rawTerm(
      offer,
      `${sourceRate.meter}${
        sourceRate.conditions.operation === undefined ? "" : `:${sourceRate.conditions.operation}`
      }`,
    );
    offer.sourceRefs.add(sourceRef);
    term.source_refs.push(sourceRef);
    term.variants.push({
      impact: "base_price",
      reason: "unknown_meter",
      possible_scope: rateApplicability(context, sourceRate.conditions),
      observation: { source_ref: sourceRef, locator, raw: fact },
    });
    return;
  }
  const term = rateTerm(offer, meterKey(meter), meter);
  const normalized = normalizeRate(context, normalizedRate);
  offer.sourceRefs.add(sourceRef);
  term.source_refs.push(sourceRef);

  if (normalized.kind === "raw") {
    term.raw_variants.push({
      impact: "base_price",
      reason: normalized.reason,
      possible_scope: normalized.applicability,
      ...(normalized.validity === undefined ? {} : { validity: normalized.validity }),
      observation: { source_ref: sourceRef, locator, raw: fact },
    });
    return;
  }

  const stateFact = { ...fact };
  delete stateFact.formula;
  offer.states.push({
    state: "numeric",
    applicability: normalized.applicability,
    ...(normalized.validity === undefined ? {} : { validity: normalized.validity }),
    observation: normalizedObservation(sourceRef, locator, stateFact, normalized.applicability),
  });
  term.variants.push({
    price: normalized.price,
    applicability: normalized.applicability,
    ...(sourceRate.resolution_policy === undefined
      ? {}
      : { resolution_policy: sourceRate.resolution_policy }),
    ...(normalized.validity === undefined ? {} : { validity: normalized.validity }),
    observation: normalizedObservation(sourceRef, locator, fact, normalized.applicability),
  });
}

function normalizedSourceFacts(
  providerId: string,
  rates: readonly SourcePriceFact[],
): Array<{ sourceRate: SourcePriceFact; normalizedRate: SourcePriceFact }> {
  const normalized = rates.map((rate) => sourcePriceFactSchema.parse(rate));
  const contextGroups = groupRates(normalized, (rate) => {
    const conditions = { ...rate.conditions };
    delete conditions.context_min_tokens;
    delete conditions.context_max_tokens;
    return canonicalJson([rate.meter, rate.currency, rate.unit, conditions]);
  });
  for (const group of contextGroups.values()) {
    const minimums = new Set(
      group.flatMap(({ conditions }) =>
        conditions.context_min_tokens === undefined ? [] : [conditions.context_min_tokens],
      ),
    );
    const maximums = new Set(
      group.flatMap(({ conditions }) =>
        conditions.context_max_tokens === undefined ? [] : [conditions.context_max_tokens],
      ),
    );
    const open = group.filter(
      ({ conditions }) =>
        conditions.context_min_tokens === undefined && conditions.context_max_tokens === undefined,
    );
    if (minimums.size === 1 && maximums.size === 0) {
      const minimum = [...minimums][0]!;
      if (Number.isSafeInteger(minimum) && minimum > 0)
        for (const rate of open) rate.conditions.context_max_tokens = minimum - 1;
    } else if (maximums.size === 1 && minimums.size === 0) {
      const maximum = [...maximums][0]!;
      if (Number.isSafeInteger(maximum) && maximum < Number.MAX_SAFE_INTEGER)
        for (const rate of open) rate.conditions.context_min_tokens = maximum + 1;
    }
  }

  completeReviewedDefault(normalized, "service_tier", "standard");
  if (providerId === "anthropic" || providerId === "amazon-bedrock")
    completeReviewedDefault(normalized, "speed", "standard");
  if (providerId === "anthropic") {
    completeReviewedDefault(normalized, "inference_geo", "global");
  }
  if (providerId === "azure") completeReviewedDefault(normalized, "context_tier", "standard");
  if (providerId === "vertex") completeReviewedDefault(normalized, "region", "default");
  if (providerId === "databricks" || providerId === "vertex")
    completeReviewedDefault(normalized, "promotion", false);

  return rates.map((sourceRate, index) => ({
    sourceRate,
    normalizedRate: normalized[index]!,
  }));
}

function completeReviewedDefault<K extends keyof SourcePriceFact["conditions"]>(
  rates: SourcePriceFact[],
  key: K,
  value: NonNullable<SourcePriceFact["conditions"][K]>,
): void {
  for (const group of groupRates(rates, ({ meter }) => meter).values()) {
    const explicit = group.filter(({ conditions }) => conditions[key] !== undefined);
    const missing = group.filter(({ conditions }) => conditions[key] === undefined);
    if (
      explicit.length === 0 ||
      missing.length === 0 ||
      !missing.some((left) =>
        explicit.some((right) => ratePayloadKey(left) !== ratePayloadKey(right)),
      )
    )
      continue;
    for (const rate of missing) rate.conditions[key] = value;
  }
}

function groupRates(
  rates: readonly SourcePriceFact[],
  key: (rate: SourcePriceFact) => string,
): Map<string, SourcePriceFact[]> {
  const groups = new Map<string, SourcePriceFact[]>();
  for (const rate of rates) {
    const value = key(rate);
    const group = groups.get(value) ?? [];
    group.push(rate);
    groups.set(value, group);
  }
  return groups;
}

function ratePayloadKey(rate: SourcePriceFact): string {
  return canonicalJson([rate.price, rate.currency, rate.unit]);
}

function pricingBooks(context: AdapterContext): AtomicProviderPricing["books"] {
  const modelRefs = [...new Set([...context.scopeBySource.values()].flatMap((refs) => [...refs]))];
  if (modelRefs.length === 0) return [];
  const sourceRefs = [...context.scopeBySource.keys()];
  return [
    {
      book_key: context.bookKey,
      name: context.bookName,
      scope: { kind: "models", model_refs: modelRefs },
      scope_observations: [...context.scopeBySource].map(([sourceRef, refs]) => ({
        source_ref: sourceRef,
        locator: { kind: "provider_key", value: "pricing:model-scope" },
        establishes: { kind: "models", model_refs: [...refs] },
        raw: { label: "Models with public pricing facts" },
      })),
      offers: [...context.offers.values()].map(pricingOffer),
      source_refs: sourceRefs,
    },
  ];
}

function pricingOffer(value: OfferBuilder): AtomicPricingOffer {
  return {
    offer_key: value.offerKey,
    name: value.name,
    billing_mode: { namespace: "kmodels", value: value.billingMode },
    states: value.states,
    terms: [...value.terms.values()],
    relations: [],
    source_refs: [...value.sourceRefs],
  };
}

function offerBuilder(
  context: AdapterContext,
  key: string,
  billingMode: OfferBuilder["billingMode"],
  name: string,
): OfferBuilder {
  const current = context.offers.get(key);
  if (current !== undefined) return current;
  const created: OfferBuilder = {
    offerKey: key,
    name,
    billingMode,
    states: [],
    terms: new Map(),
    sourceRefs: new Set(),
  };
  context.offers.set(key, created);
  return created;
}

function forcedOfferBuilder(
  context: AdapterContext,
  forced: Parameters<typeof addModelPricing>[4],
  fallback: "usage" | "capacity",
): OfferBuilder {
  return forced === undefined
    ? offerBuilder(
        context,
        fallback,
        fallback,
        fallback === "usage" ? "Usage pricing" : "Capacity pricing",
      )
    : offerBuilder(context, forced.key, forced.billingMode, forced.name);
}

function rateTerm(offer: OfferBuilder, key: string, meter: PriceMeter): AtomicRateTerm {
  const current = offer.terms.get(key);
  if (current !== undefined) {
    if (current.kind !== "rate") throw new Error(`Pricing term ${key} changed kind`);
    return current;
  }
  const created: AtomicRateTerm = {
    term_key: key,
    kind: "rate",
    meter,
    variants: [],
    raw_variants: [],
    source_refs: [],
  };
  offer.terms.set(key, created);
  return created;
}

function rawTerm(offer: OfferBuilder, key: string): AtomicRawTerm {
  const current = offer.terms.get(key);
  if (current !== undefined) {
    if (current.kind !== "raw") throw new Error(`Pricing term ${key} changed kind`);
    return current;
  }
  const created: AtomicRawTerm = {
    term_key: key,
    kind: "raw",
    variants: [],
    source_refs: [],
  };
  offer.terms.set(key, created);
  return created;
}

type NormalizedRate =
  | {
      kind: "normalized";
      price: UnitPrice;
      applicability: PriceApplicability;
      validity?: PublishedValidity;
    }
  | {
      kind: "raw";
      reason: AtomicRawVariant["reason"];
      applicability: PriceApplicability;
      validity?: PublishedValidity;
    };

function normalizeRate(context: AdapterContext, rate: SourcePriceFact): NormalizedRate {
  const modelScope = unconditionalApplicability;
  const validity = publishedValidity(rate.conditions);
  if (validity === false)
    return { kind: "raw", reason: "unsupported_structure", applicability: modelScope };
  const applicability = rateApplicability(context, rate.conditions);
  const unit = normalizedUnit(context, rate);
  if (unit === undefined)
    return {
      kind: "raw",
      reason:
        rate.unit === "thousand_tokens_per_minute_hour"
          ? "requires_usage_aggregation"
          : "unknown_unit",
      applicability,
      ...(validity === undefined ? {} : { validity }),
    };
  const denomination = priceDenomination(context, rate.currency);
  if (denomination === undefined)
    return {
      kind: "raw",
      reason: "unknown_denomination",
      applicability,
      ...(validity === undefined ? {} : { validity }),
    };
  try {
    return {
      kind: "normalized",
      price: canonicalizeUnitPrice(rationalFromDecimal(rate.price), denomination, unit),
      applicability,
      ...(validity === undefined ? {} : { validity }),
    };
  } catch {
    return {
      kind: "raw",
      reason: "unsupported_structure",
      applicability,
      ...(validity === undefined ? {} : { validity }),
    };
  }
}

function normalizedUnit(
  context: AdapterContext,
  rate: SourcePriceFact,
): CanonicalSourceUnit | undefined {
  const standard = (
    value:
      | "character"
      | "byte"
      | "event"
      | "frame"
      | "image"
      | "item"
      | "page"
      | "pixel"
      | "request"
      | "second"
      | "token",
  ) => ({
    namespace: "kmodels" as const,
    value,
  });
  const one = (value: Parameters<typeof standard>[0], scale?: FixedUnitScale) =>
    canonicalizeSourceUnit([
      {
        unit: standard(value),
        power: 1,
        ...(scale === undefined ? {} : { scale }),
      },
    ]);
  switch (rate.unit) {
    case "token":
      return one("token");
    case "thousand_tokens":
      return one("token", "thousand");
    case "million_tokens":
      return one("token", "million");
    case "million_pixels":
      return one("pixel", "million");
    case "character":
      return one("character");
    case "thousand_characters":
      return one("character", "thousand");
    case "million_characters":
      return one("character", "million");
    case "request":
      return one("request");
    case "thousand_requests":
      return one("request", "thousand");
    case "thousand_items":
      return one("item", "thousand");
    case "event":
      return one("event");
    case "thousand_events":
      return one("event", "thousand");
    case "byte_day":
      return canonicalizeSourceUnit([
        { unit: standard("byte"), power: 1 },
        { unit: standard("second"), power: 1, scale: "day" },
      ]);
    case "gigabyte_day":
      return canonicalizeSourceUnit([
        { unit: standard("byte"), power: 1, scale: "gigabyte" },
        { unit: standard("second"), power: 1, scale: "day" },
      ]);
    case "gibibyte_day":
      return canonicalizeSourceUnit([
        { unit: standard("byte"), power: 1, scale: "gibibyte" },
        { unit: standard("second"), power: 1, scale: "day" },
      ]);
    case "gigabyte":
      return one("byte", "gigabyte");
    case "gibibyte":
      return one("byte", "gibibyte");
    case "container_session":
      return canonicalizeSourceUnit([
        {
          unit: providerUnit(
            context,
            "container_session",
            "One provider-published 20-minute container session block",
          ),
          power: 1,
        },
      ]);
    case "session":
      return canonicalizeSourceUnit([
        {
          unit: providerUnit(context, "session", "One provider-defined service session"),
          power: 1,
        },
      ]);
    case "unit":
      return canonicalizeSourceUnit([
        {
          unit: providerUnit(context, "unit", "One provider-defined commercial unit"),
          power: 1,
        },
      ]);
    case "image":
      return one("image");
    case "page":
      return one("page");
    case "thousand_pages":
      return one("page", "thousand");
    case "second":
      return one("second");
    case "hour":
      return one("second", "hour");
    case "minute":
      return one("second", "minute");
    case "frame":
      return one("frame");
    case "video":
      return canonicalizeSourceUnit([
        {
          unit: providerUnit(context, "video", "One provider-published video item"),
          power: 1,
        },
      ]);
    case "thousand_search_units": {
      const providerUnit = searchUnit(context);
      return canonicalizeSourceUnit([{ unit: providerUnit, power: 1, scale: "thousand" }]);
    }
    case "search_unit":
      return canonicalizeSourceUnit([{ unit: searchUnit(context), power: 1 }]);
    case "million_tokens_per_hour":
      return canonicalizeSourceUnit([
        { unit: standard("token"), power: 1, scale: "million" },
        { unit: standard("second"), power: 1, scale: "hour" },
      ]);
    case "gpu_hour":
      return canonicalizeSourceUnit([
        { unit: { namespace: "kmodels", value: "accelerator" }, power: 1 },
        { unit: standard("second"), power: 1, scale: "hour" },
      ]);
    case "unit_hour":
      return canonicalizeSourceUnit([
        {
          unit: providerUnit(
            context,
            "unit_hour",
            "One provider-published capacity or service unit sustained for one hour",
          ),
          power: 1,
        },
      ]);
    case "unit_week":
      return canonicalizeSourceUnit([
        {
          unit: providerUnit(
            context,
            "unit_week",
            "One provider-published capacity or service unit sustained for one week",
          ),
          power: 1,
        },
      ]);
    case "unit_month":
      return canonicalizeSourceUnit([
        {
          unit: providerUnit(
            context,
            "unit_month",
            "One provider-published capacity or service unit sustained for one month",
          ),
          power: 1,
        },
      ]);
    case "unit_year":
      return canonicalizeSourceUnit([
        {
          unit: providerUnit(
            context,
            "unit_year",
            "One provider-published capacity or service unit sustained for one year",
          ),
          power: 1,
        },
      ]);
    case "billing_month":
      return canonicalizeSourceUnit([
        { unit: { namespace: "kmodels", value: "billing_month" }, power: 1 },
      ]);
    case "billing_year":
      return canonicalizeSourceUnit([
        { unit: { namespace: "kmodels", value: "billing_year" }, power: 1 },
      ]);
    case "seat_month":
      return canonicalizeSourceUnit([
        { unit: { namespace: "kmodels", value: "seat" }, power: 1 },
        { unit: { namespace: "kmodels", value: "billing_month" }, power: 1 },
      ]);
    case "thousand_tokens_per_minute_hour":
      return canonicalizeSourceUnit([
        {
          unit: providerUnit(
            context,
            "1k_tpm_hour",
            "One 1,000-tokens-per-minute capacity unit sustained for one hour",
          ),
          power: 1,
        },
      ]);
  }
}

function searchUnit(context: AdapterContext) {
  return providerUnit(
    context,
    "search_unit",
    "One provider-published search or rerank billing unit",
  );
}

function providerUnit(context: AdapterContext, key: string, definition: string) {
  const unit = {
    namespace: "provider" as const,
    provider_id: context.providerId,
    value: key,
  };
  addAtom(context, {
    kind: "unit",
    key: unit.value,
    definition,
  });
  return unit;
}

function priceDenomination(
  context: AdapterContext,
  currency: string,
): PriceDenomination | undefined {
  if (currency === "DBU") {
    addAtom(context, {
      kind: "credit_denomination",
      key: currency,
      definition: "Databricks billing unit",
    });
    return { kind: "provider_credit", provider_id: context.providerId, code: currency };
  }
  return /^[A-Z]{3}$/.test(currency) ? { kind: "fiat", currency } : undefined;
}

function rateApplicability(
  context: AdapterContext,
  conditions: SourcePriceFact["conditions"],
): PriceApplicability {
  const predicates: PriceCondition[] = [];
  const categorical = [
    "region",
    "endpoint",
    "deployment_scope",
    "speed",
    "inference_geo",
    "route_provider",
    "context_tier",
    "modality",
    "operation",
    "resolution",
    "quality",
    "style",
    "capacity",
    "billing_period",
    "billing_currency",
    "account_eligibility",
  ] as const;
  for (const key of categorical) {
    const value = conditions[key];
    if (value === undefined) continue;
    const dimension: PriceDimension = { namespace: "kmodels", value: key };
    const atom = providerCategorical(context, dimension, value);
    predicates.push({ kind: "categorical", dimension, values: [atom] });
  }
  if (conditions.service_tier !== undefined) {
    const dimension: PriceDimension =
      context.providerId === "openai"
        ? { namespace: "kmodels", value: "served_service_tier" }
        : { namespace: "kmodels", value: "service_tier" };
    predicates.push({
      kind: "categorical",
      dimension,
      values: [providerCategorical(context, dimension, conditions.service_tier)],
    });
  }
  for (const key of ["audio", "voice_control", "video_input", "promotion"] as const) {
    const value = conditions[key];
    if (value === undefined) continue;
    const dimension: PriceDimension = {
      namespace: "kmodels",
      value: key === "audio" ? "request_audio" : key,
    };
    predicates.push({ kind: "boolean", dimension, value });
  }
  const tokenRange = contextTokenRange(
    conditions.context_min_tokens,
    conditions.context_max_tokens,
  );
  if (tokenRange !== undefined) predicates.push(tokenRange);
  if (conditions.cache_ttl_seconds !== undefined) {
    const exact = String(conditions.cache_ttl_seconds);
    predicates.push({
      kind: "decimal_range",
      dimension: { namespace: "kmodels", value: "cache_ttl_seconds" },
      unit: standardUnit("second"),
      lower: { value: exact, inclusive: true },
      upper: { value: exact, inclusive: true },
    });
  }
  return { any_of: [{ all_of: predicates }] };
}

function contextTokenRange(
  lower: number | undefined,
  upper: number | undefined,
): PriceCondition | undefined {
  if (lower === undefined && upper === undefined) return undefined;
  return {
    kind: "decimal_range",
    dimension: { namespace: "kmodels", value: "context_tokens" },
    unit: standardUnit("token"),
    ...(lower === undefined ? {} : { lower: { value: String(lower), inclusive: true } }),
    ...(upper === undefined ? {} : { upper: { value: String(upper), inclusive: true } }),
  };
}

function publishedValidity(
  conditions: SourcePriceFact["conditions"],
): PublishedValidity | undefined | false {
  const from = timeBoundary(conditions.effective_from);
  const until = timeBoundary(conditions.effective_until);
  if (from === false || until === false) return false;
  if (from === undefined) return until === undefined ? undefined : { until };
  return until === undefined ? { from } : { from, until };
}

function timeBoundary(value: string | undefined): PublishedValidity["from"] | undefined | false {
  if (value === undefined) return undefined;
  const precision = /^\d{4}$/.test(value)
    ? "year"
    : /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value)
      ? "month"
      : /^\d{4}-(?:0[1-9]|1[0-2])-\d{2}$/.test(value)
        ? "date"
        : /^\d{4}-\d{2}-\d{2}T/.test(value)
          ? "datetime"
          : undefined;
  if (precision === undefined) return false;
  if (precision !== "datetime")
    return isPublishedTime(value, precision) ? { value, precision } : false;
  try {
    return { value: canonicalizeInstant(value), precision };
  } catch {
    return false;
  }
}

function providerCategorical(context: AdapterContext, dimension: PriceDimension, rawValue: string) {
  const key = rawValue.normalize("NFC");
  const label = context.categoricalLabels.get(categoricalLabelIdentity(dimension, key));
  addAtom(context, {
    kind: "categorical_value",
    key,
    dimension,
    definition: `Provider-published ${dimension.value} value ${JSON.stringify(key)}`,
    ...(label === undefined ? {} : { label }),
  });
  return {
    namespace: "provider" as const,
    provider_id: context.providerId,
    value: key,
  };
}

function providerMeter(context: AdapterContext, key: string, definition: string): PriceMeter {
  addAtom(context, { kind: "meter", key, definition });
  return { namespace: "provider", provider_id: context.providerId, value: key };
}

function canonicalMeter(context: AdapterContext, rate: SourcePriceFact): PriceMeter | undefined {
  const standard = (value: Extract<PriceMeter, { namespace: "kmodels" }>["value"]): PriceMeter => ({
    namespace: "kmodels",
    value,
  });
  switch (rate.meter) {
    case "cache_storage":
      return standard("storage");
    case "rerank_request":
      return standard("rerank");
    case "realtime_session_duration":
      return standard("session_runtime");
    case "gpu_hour":
      return standard("compute");
    case "provisioned_throughput":
      return standard("provisioned_capacity");
    case "policy_enforcement":
      return providerMeter(
        context,
        "restriction_surcharge",
        "One Vercel team-wide model/provider restriction surcharge",
      );
    case "zero_data_retention":
      return providerMeter(
        context,
        "team_wide_zdr",
        "One Vercel team-wide zero-data-retention surcharge",
      );
    case "trace_delivery":
      return providerMeter(
        context,
        "trace_delivery",
        "One Vercel AI Gateway trace delivered to one configured drain",
      );
    case "tool_call":
      // A source operation name does not establish service ownership or a shared meter.
      // Provider migrations move exact operations into provider-resource books.
      return;
    case "batch_inference":
      return;
    case "realtime_client_message":
      return providerMeter(
        context,
        "realtime_client_message",
        "One provider-published realtime client message",
      );
    case "cache_read_audio":
    case "cache_write_audio":
    case "cache_read_image":
    case "cache_write_image":
    case "cache_read_video":
    case "cache_write_video":
      return providerMeter(
        context,
        rate.meter,
        `Provider-published ${rate.meter.replaceAll("_", " ")} usage`,
      );
    default:
      return standard(rate.meter);
  }
}

function meterKey(meter: PriceMeter): string {
  return meter.namespace === "kmodels" ? meter.value : `provider:${meter.value}`;
}

function categoricalLabelIndex(
  labels: readonly PricingCategoricalLabel[],
): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  for (const { dimension, value, label } of labels) {
    const identity = categoricalLabelIdentity(dimension, value.normalize("NFC"));
    const normalizedLabel = label.normalize("NFC");
    const current = result.get(identity);
    if (current !== undefined && current !== normalizedLabel)
      throw new Error(`Provider categorical value ${value} has conflicting labels`);
    result.set(identity, normalizedLabel);
  }
  return result;
}

function categoricalLabelIdentity(dimension: PriceDimension, value: string): string {
  return canonicalJson([dimension, value]);
}

function addAtom(context: AdapterContext, atom: ProviderAtomRegistryEntry): void {
  const dimension = "dimension" in atom ? canonicalJson(atom.dimension) : "";
  const identity = `${atom.kind}\0${dimension}\0${atom.key}`;
  const current = context.atoms.get(identity);
  if (current !== undefined && canonicalJson(current) !== canonicalJson(atom))
    throw new Error(`Provider atom ${atom.key} has conflicting definitions`);
  context.atoms.set(identity, atom);
}

function standardUnit(value: "second" | "token"): UnitExpression {
  return {
    factors: [{ unit: { namespace: "kmodels", value }, power: 1 }],
  };
}

function normalizedObservation(
  sourceRef: string,
  locator: PriceSourceLocator,
  raw: RawPriceFact,
  applicability: PriceApplicability,
) {
  return {
    source_ref: sourceRef,
    locator,
    raw,
    establishes_applicability: applicability,
  };
}

function rawFact(rate: SourcePriceFact): RawPriceFact {
  const rawConditions = Object.entries(rate.conditions)
    .filter(
      ([key, value]) =>
        value !== undefined && key !== "effective_from" && key !== "effective_until",
    )
    .map(([dimension, value]) => ({ dimension, value: String(value) }));
  return {
    amount: rate.raw_price ?? rate.price,
    denomination: rate.currency,
    unit: rate.raw_unit ?? rate.unit,
    meter: rate.meter,
    ...(rate.derivation === undefined ? {} : { formula: rate.derivation }),
    ...(rate.raw_validity === undefined &&
    rate.conditions.effective_from === undefined &&
    rate.conditions.effective_until === undefined
      ? {}
      : {
          validity:
            rate.raw_validity ??
            [rate.conditions.effective_from, rate.conditions.effective_until]
              .filter((value) => value !== undefined)
              .join(" – "),
        }),
    ...(rawConditions.length === 0 ? {} : { conditions: rawConditions }),
  };
}

function rateLocator(model: ParsedPricingModel, rate: SourcePriceFact): PriceSourceLocator {
  if (rate.source_locator !== undefined) return rate.source_locator;
  return {
    kind: "provider_key",
    value: JSON.stringify([
      model.uid,
      rate.meter,
      rate.conditions,
      rate.raw_price ?? rate.price,
      rate.raw_unit ?? rate.unit,
      rate.raw_validity,
    ]),
  };
}

function addScope(context: AdapterContext, sourceRef: string, modelRefs: readonly string[]): void {
  const refs = context.scopeBySource.get(sourceRef) ?? new Set<string>();
  for (const modelRef of modelRefs) refs.add(modelRef);
  context.scopeBySource.set(sourceRef, refs);
}

function rateMode(rate: SourcePriceFact): "usage" | "capacity" {
  if (rate.meter === "batch_inference") return "usage";
  return ["gpu_hour", "provisioned_throughput"].includes(rate.meter) ||
    [
      "unit_hour",
      "unit_week",
      "unit_month",
      "unit_year",
      "thousand_tokens_per_minute_hour",
    ].includes(rate.unit)
    ? "capacity"
    : "usage";
}
