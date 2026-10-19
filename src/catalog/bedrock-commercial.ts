import type {
  AtomicPricingBook,
  AtomicPricingOffer,
  AtomicPricingTerm,
  AtomicProviderPricing,
  AtomicRateVariant,
} from "./pricing-assembly.ts";
import { canonicalJson } from "./canonical-json.ts";
import { compareCanonicalValues } from "./canonical-value.ts";
import {
  applicabilitiesOverlap,
  canonicalizeApplicability,
  unconditionalApplicability,
} from "./pricing-canonical.ts";
import { publishedValiditiesOverlap } from "./pricing-time.ts";
import {
  addAtom,
  isStandardUnit,
  rawEvidence,
  standardSignal,
  withApplicability,
} from "./pricing-commercial-assembly.ts";
import {
  indexPricingInputs,
  pricingInputFacts,
  pricingInputObservation,
  uniquePricingInputFacts,
  usageInputSources,
  type PricingInputIndex,
} from "./pricing-input.ts";
import type {
  ChargeBinding,
  NormalizedPriceObservation,
  PriceApplicability,
  PriceCondition,
  PriceDimension,
  PriceMeter,
  PriceSelectorSource,
  UnitExpression,
  UsageSignal,
} from "./pricing-schema.ts";
import type { SourcePricingInputFact } from "./pricing-source.ts";
import type { ProviderModel } from "./schema.ts";

type Mechanism = "on-demand" | "batch";
type PublishedModel = Pick<ProviderModel, "api_endpoints" | "uid">;

const tokenUnit = standardUnit("token");
const invocationResources = new Set(["guardrails", "prompt-routing", "reranking", "web-search"]);

export function applyBedrockCommercialTopology(
  input: AtomicProviderPricing,
  models: readonly PublishedModel[],
  pricingInputs: readonly SourcePricingInputFact[],
): AtomicProviderPricing {
  const inputIndex = indexPricingInputs(pricingInputs);
  const modelByRef = new Map(models.map((model) => [model.uid, model]));
  const books: AtomicPricingBook[] = [];

  for (const book of input.books) {
    if (book.scope.kind === "models") {
      const supportsConverse = book.scope.model_refs.some((modelRef) =>
        modelByRef.get(modelRef)?.api_endpoints?.some(({ name }) => name === "Converse"),
      );
      const split = splitModelBook(book, input, inputIndex, supportsConverse);
      if (split.offers.length > 0) books.push(split);
      continue;
    }
    if (
      book.scope.kind === "provider_resource" &&
      (invocationResources.has(book.scope.resource_key) ||
        book.scope.resource_key.startsWith("nova-web-grounding:"))
    )
      books.push(book);
  }

  return { ...input, books };
}

function splitModelBook(
  book: AtomicPricingBook,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
  supportsConverse: boolean,
): AtomicPricingBook {
  const offers: AtomicPricingOffer[] = [];

  for (const offer of book.offers) {
    if (offer.offer_key !== "usage") continue;
    const onDemand = partitionOffer(offer, "on-demand", input, inputIndex, supportsConverse);
    const batch = partitionOffer(offer, "batch", input, inputIndex, supportsConverse);
    if (onDemand !== undefined) offers.push(onDemand);
    if (batch !== undefined) offers.push(batch);
  }

  return { ...book, offers };
}

function partitionOffer(
  offer: AtomicPricingOffer,
  mechanism: Mechanism,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
  supportsConverse: boolean,
): AtomicPricingOffer | undefined {
  const states = offer.states.flatMap((state) => {
    const applicability = mechanismApplicability(state.applicability, mechanism);
    return applicability === undefined
      ? []
      : [
          {
            ...state,
            applicability,
            observation: withApplicability(state.observation, applicability),
          },
        ];
  });
  const terms = offer.terms.flatMap((term) =>
    partitionTerm(term, mechanism, input, inputIndex, supportsConverse, offer.terms),
  );
  if (states.length === 0 && terms.length === 0) return;
  return {
    ...offer,
    offer_key: mechanism,
    name: mechanism === "batch" ? "Batch inference" : "On-demand inference",
    states,
    terms,
    relations: [],
  };
}

function partitionTerm(
  term: AtomicPricingTerm,
  mechanism: Mechanism,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
  supportsConverse: boolean,
  terms: readonly AtomicPricingTerm[],
): AtomicPricingTerm[] {
  if (term.kind === "raw") {
    const variants = term.variants.flatMap((variant) => {
      const possible_scope =
        variant.possible_scope === undefined
          ? mechanism === "on-demand"
            ? unconditionalApplicability
            : undefined
          : mechanismApplicability(variant.possible_scope, mechanism);
      return possible_scope === undefined ? [] : [{ ...variant, possible_scope }];
    });
    return variants.length === 0 ? [] : [{ ...term, variants }];
  }
  if (term.kind !== "rate") return mechanism === "on-demand" ? [term] : [];
  if (term.meter.namespace === "kmodels" && term.meter.value === "provisioned_capacity") return [];

  const variants = term.variants.flatMap((variant) => {
    const applicability = mechanismApplicability(variant.applicability, mechanism);
    if (applicability === undefined) return [];
    const observation = withApplicability(variant.observation, applicability);
    const charge_binding = modelChargeBinding(
      term.meter,
      variant,
      mechanism,
      observation,
      input,
      inputIndex,
      supportsConverse,
      overlappingRateMeters(terms, variant, mechanism),
    );
    const selector_sources = modelSelectorSources(
      applicability,
      mechanism,
      inputIndex,
      supportsConverse,
    );
    return [
      {
        ...variant,
        applicability,
        observation,
        ...(charge_binding === undefined ? {} : { charge_binding }),
        ...(selector_sources.length === 0 ? {} : { selector_sources }),
      },
    ];
  });
  const raw_variants = term.raw_variants.flatMap((variant) => {
    if (variant.possible_scope === undefined) return mechanism === "on-demand" ? [variant] : [];
    const possible_scope = mechanismApplicability(variant.possible_scope, mechanism);
    return possible_scope === undefined ? [] : [{ ...variant, possible_scope }];
  });
  return variants.length + raw_variants.length === 0 ? [] : [{ ...term, variants, raw_variants }];
}

function mechanismApplicability(
  applicability: PriceApplicability,
  mechanism: Mechanism,
): PriceApplicability | undefined {
  const any_of = applicability.any_of.flatMap(({ all_of }) => {
    const tier = tierCondition(all_of);
    const value = tierValue(tier);
    if (value?.startsWith("reserved_") === true || value?.startsWith("provisioned_") === true)
      return [];
    if ((mechanism === "batch") !== (value === "batch")) return [];
    return [
      {
        all_of:
          mechanism === "batch" && tier !== undefined
            ? all_of.filter((item) => item !== tier)
            : all_of,
      },
    ];
  });
  return any_of.length === 0 ? undefined : canonicalizeApplicability({ any_of });
}

function tierCondition(conditions: readonly PriceCondition[]): PriceCondition | undefined {
  return conditions.find(
    (condition) =>
      condition.kind === "categorical" &&
      condition.dimension.namespace === "kmodels" &&
      condition.dimension.value === "service_tier",
  );
}

function tierValue(condition: PriceCondition | undefined): string | undefined {
  if (condition?.kind !== "categorical" || condition.values.length !== 1) return;
  return condition.values[0]?.value;
}

function modelChargeBinding(
  meter: PriceMeter,
  variant: AtomicRateVariant,
  mechanism: Mechanism,
  observation: NormalizedPriceObservation,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
  supportsConverse: boolean,
  rateMeters: readonly PriceMeter[],
): ChargeBinding | undefined {
  if (meter.namespace !== "kmodels") return;
  const unit = variant.price.per;
  if (isStandardUnit(unit, "token")) {
    const direction =
      meter.value === "input_text" || meter.value === "embedding"
        ? "input"
        : meter.value === "output_text"
          ? "output"
          : undefined;
    const partitioned =
      direction !== undefined &&
      rateMeters.some(
        (candidate) =>
          candidate.namespace === "kmodels" &&
          ["audio", "image", "video"].some(
            (modality) => candidate.value === `${direction}_${modality}`,
          ),
      );
    const hasCacheRates = rateMeters.some(
      (candidate) =>
        candidate.namespace === "kmodels" &&
        ["cache_read_text", "cache_write_text"].includes(candidate.value),
    );
    const token = partitioned
      ? undefined
      : tokenBindingSpec(meter, variant.applicability, mechanism, hasCacheRates, input);
    if (token !== undefined) {
      const runtime = permitsRuntimeUsage(variant.applicability);
      const facts = tokenInputFacts(
        token.keys,
        mechanism,
        inputIndex,
        supportsConverse && runtime,
        token.includeInvocationLog && runtime,
      );
      return directBinding(token.signal, token.aggregation, facts, observation);
    }
  }

  const factor = unit.factors.length === 1 ? unit.factors[0] : undefined;
  if (factor?.power !== 1) return;
  const value = factor.unit.value;
  const signal = semanticModelSignal(meter, value, unit, input);
  if (signal === undefined) return;
  return directBinding(signal, mechanism === "batch" ? "job" : "attempt", [], observation);
}

function overlappingRateMeters(
  terms: readonly AtomicPricingTerm[],
  variant: AtomicRateVariant,
  mechanism: Mechanism,
): PriceMeter[] {
  const applicability = mechanismApplicability(variant.applicability, mechanism);
  if (applicability === undefined) return [];
  return terms.flatMap((term) =>
    term.kind === "rate" &&
    term.variants.some((candidate) => {
      const scope = mechanismApplicability(candidate.applicability, mechanism);
      return (
        scope !== undefined &&
        canonicalJson(candidate.price.denomination) === canonicalJson(variant.price.denomination) &&
        applicabilitiesOverlap(scope, applicability) &&
        publishedValiditiesOverlap(candidate.validity, variant.validity)
      );
    })
      ? [term.meter]
      : [],
  );
}

interface TokenBindingSpec {
  signal: UsageSignal;
  aggregation: "attempt" | "job";
  keys: string[];
  includeInvocationLog: boolean;
}

function tokenBindingSpec(
  meter: PriceMeter,
  applicability: PriceApplicability,
  mechanism: Mechanism,
  hasCacheRates: boolean,
  input: AtomicProviderPricing,
): TokenBindingSpec | undefined {
  const batch = mechanism === "batch";
  if (meter.value === "input_text" || meter.value === "embedding") {
    const signal = standardSignal(
      batch || !hasCacheRates ? "input_tokens" : "uncached_input_tokens",
    );
    return {
      signal,
      aggregation: batch ? "job" : "attempt",
      keys: batch ? ["batch.manifest.input_tokens"] : ["runtime.converse.uncached_input_tokens"],
      includeInvocationLog: !batch && !hasCacheRates,
    };
  }
  if (meter.value === "output_text")
    return {
      signal: standardSignal("output_tokens"),
      aggregation: batch ? "job" : "attempt",
      keys: batch ? ["batch.manifest.output_tokens"] : ["runtime.converse.output_tokens"],
      includeInvocationLog: !batch,
    };
  if (meter.value === "cache_read_text")
    return {
      signal: standardSignal("cached_input_tokens"),
      aggregation: batch ? "job" : "attempt",
      keys: batch ? [] : ["runtime.converse.cached_input_tokens"],
      includeInvocationLog: false,
    };
  if (meter.value !== "cache_write_text") return;
  const ttl = exactCacheTtl(applicability);
  if (ttl === undefined)
    return {
      signal: standardSignal("cache_write_tokens"),
      aggregation: batch ? "job" : "attempt",
      keys: batch ? [] : ["runtime.converse.cache_write_tokens"],
      includeInvocationLog: false,
    };
  const suffix = ttl === 300 ? "5m" : ttl === 3600 ? "1h" : `${ttl}s`;
  const key = `cache_write_${suffix}_input_tokens`;
  addUsageSignal(
    input,
    key,
    `Amazon Bedrock cache-write input tokens billed at the ${suffix} TTL rate`,
    tokenUnit,
    "outcome",
  );
  return {
    signal: providerSignal(input, key),
    aggregation: batch ? "job" : "attempt",
    keys: batch ? [] : [`runtime.converse.${key}`],
    includeInvocationLog: false,
  };
}

function tokenInputFacts(
  keys: readonly string[],
  mechanism: Mechanism,
  inputIndex: PricingInputIndex,
  includeConverse: boolean,
  includeInvocationLog: boolean,
): SourcePricingInputFact[] {
  if (mechanism === "batch") return pricingInputFacts(inputIndex, keys);
  return uniquePricingInputFacts([
    ...(includeConverse ? pricingInputFacts(inputIndex, keys) : []),
    ...(includeInvocationLog
      ? pricingInputFacts(inputIndex, [
          keys.some((key) => key.endsWith("output_tokens"))
            ? "runtime.invocation_log.output_tokens"
            : "runtime.invocation_log.input_tokens",
        ])
      : []),
  ]);
}

function directBinding(
  signal: UsageSignal,
  aggregation: ChargeBinding["aggregation"],
  facts: readonly SourcePricingInputFact[],
  observation: NormalizedPriceObservation,
): ChargeBinding {
  return {
    signal,
    aggregation,
    ...(facts.length === 0
      ? {}
      : { quantity_methods: [{ input_sources: usageInputSources(signal, facts) }] }),
    observations: sortCanonical([rawEvidence(observation), ...facts.map(pricingInputObservation)]),
  };
}

function semanticModelSignal(
  meter: PriceMeter,
  unitValue: string,
  unit: UnitExpression,
  input: AtomicProviderPricing,
): UsageSignal | undefined {
  if (unitValue === "image" && ["input_image", "embedding"].includes(meter.value))
    return standardSignal("processed_images");
  if (unitValue === "image" && ["output_image", "image_generation"].includes(meter.value))
    return standardSignal("generated_images");
  if (unitValue === "page" && ["input_text", "input_image", "embedding"].includes(meter.value))
    return standardSignal("processed_pages");
  if (unitValue === "request") return standardSignal("accepted_requests");
  if (unitValue === "second" && ["input_audio", "transcription"].includes(meter.value))
    return standardSignal("processed_audio_seconds");
  if (
    unitValue === "second" &&
    ["output_audio", "output_video", "video_generation"].includes(meter.value)
  )
    return standardSignal("generated_seconds");
  if (
    !["search_unit", "video"].includes(unitValue) &&
    !(unitValue === "second" && meter.value === "input_video") &&
    !(
      unitValue === "token" &&
      ["input_text", "output_text", "embedding", "input_audio", "output_audio"].includes(
        meter.value,
      )
    )
  )
    return;
  const key = `runtime_${meter.value}_${unitValue}`;
  addUsageSignal(
    input,
    key,
    `Amazon Bedrock ${meter.value.replaceAll("_", " ")} quantity measured in ${unitValue}`,
    unit,
    meter.value.startsWith("input_") || meter.value === "embedding" ? "request" : "outcome",
  );
  return providerSignal(input, key);
}

function modelSelectorSources(
  applicability: PriceApplicability,
  mechanism: Mechanism,
  inputIndex: PricingInputIndex,
  supportsConverse: boolean,
): PriceSelectorSource[] {
  const result: PriceSelectorSource[] = [];
  const runtime = permitsRuntimeUsage(applicability);
  for (const dimension of applicabilityDimensions(applicability)) {
    if (dimension.namespace !== "kmodels") continue;
    if (dimension.value === "region" && mechanism === "on-demand" && runtime) {
      for (const fact of pricingInputFacts(inputIndex, ["runtime.invocation_log.selector.region"]))
        result.push(selectorSource(dimension, fact));
      continue;
    }
    if (
      mechanism !== "on-demand" ||
      !runtime ||
      !supportsConverse ||
      !["service_tier", "speed"].includes(dimension.value)
    )
      continue;
    const values = categoricalValues(applicability, dimension);
    const entries: ReadonlyArray<readonly [sourceValue: string, value: string]> =
      dimension.value === "service_tier"
        ? [
            ["default", "standard"],
            ["priority", "priority"],
            ["flex", "flex"],
          ]
        : [
            ["standard", "standard"],
            ["optimized", "optimized"],
          ];
    const normalization = entries.flatMap(([source_value, value]) => {
      const target = values.find((candidate) => candidate.value === value);
      return target === undefined ? [] : [{ source_value, value: target }];
    });
    if (normalization.length === 0) continue;
    const key = `runtime.converse.selector.${dimension.value === "service_tier" ? "service_tier" : "speed"}`;
    for (const fact of pricingInputFacts(inputIndex, [key]))
      result.push(selectorSource(dimension, fact, normalization));
  }
  return sortCanonical(result);
}

function selectorSource(
  dimension: PriceDimension,
  fact: SourcePricingInputFact,
  entries?: NonNullable<PriceSelectorSource["normalization"]>["entries"],
): PriceSelectorSource {
  return {
    dimension,
    channel: fact.channel,
    locator: fact.locator,
    availability: fact.availability,
    ...(entries === undefined ? {} : { normalization: { kind: "categorical_map", entries } }),
    observations: [pricingInputObservation(fact)],
  };
}

function applicabilityDimensions(applicability: PriceApplicability): PriceDimension[] {
  const dimensions = new Map<string, PriceDimension>();
  for (const { all_of } of applicability.any_of)
    for (const { dimension } of all_of) dimensions.set(canonicalJson(dimension), dimension);
  return [...dimensions.values()];
}

function categoricalValues(
  applicability: PriceApplicability,
  dimension: PriceDimension,
): Extract<PriceCondition, { kind: "categorical" }>["values"] {
  const values = new Map<
    string,
    Extract<PriceCondition, { kind: "categorical" }>["values"][number]
  >();
  for (const { all_of } of applicability.any_of)
    for (const condition of all_of)
      if (
        condition.kind === "categorical" &&
        canonicalJson(condition.dimension) === canonicalJson(dimension)
      )
        for (const value of condition.values) values.set(canonicalJson(value), value);
  return [...values.values()].sort(compareCanonicalValues);
}

function permitsRuntimeUsage(applicability: PriceApplicability): boolean {
  // Existing accounting contracts describe Converse/Invoke. API-qualified rates need
  // their own usage and selector contracts, even when they share the Runtime endpoint.
  if (
    applicabilityDimensions(applicability).some(
      ({ namespace, value }) => namespace === "kmodels" && value === "operation",
    )
  )
    return false;
  return applicability.any_of.some(({ all_of }) => {
    const endpoint = all_of.find(
      (condition) =>
        condition.kind === "categorical" &&
        condition.dimension.namespace === "kmodels" &&
        condition.dimension.value === "endpoint",
    );
    return (
      endpoint === undefined ||
      (endpoint.kind === "categorical" &&
        endpoint.values.some(({ value }) => value === "bedrock-runtime"))
    );
  });
}

function exactCacheTtl(applicability: PriceApplicability): number | undefined {
  const values = new Set<number>();
  for (const { all_of } of applicability.any_of)
    for (const condition of all_of)
      if (
        condition.kind === "decimal_range" &&
        condition.dimension.namespace === "kmodels" &&
        condition.dimension.value === "cache_ttl_seconds" &&
        condition.lower?.inclusive === true &&
        condition.upper?.inclusive === true &&
        condition.lower.value === condition.upper.value
      )
        values.add(Number(condition.lower.value));
  if (values.size !== 1) return;
  const value = [...values][0];
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function addUsageSignal(
  input: AtomicProviderPricing,
  key: string,
  definition: string,
  unit: UnitExpression,
  resolution_phase: "request" | "outcome",
): void {
  addAtom(input, { kind: "usage_signal", key, definition, unit, resolution_phase });
}

function providerSignal(input: AtomicProviderPricing, value: string) {
  return { namespace: "provider" as const, provider_id: input.provider_id, value };
}

function standardAtom(
  value: "image" | "page" | "request" | "second" | "token",
): UnitExpression["factors"][number]["unit"] {
  return { namespace: "kmodels", value };
}

function standardUnit(value: "request" | "token"): UnitExpression {
  return { factors: [{ unit: standardAtom(value), power: 1 }] };
}

function sortCanonical<T>(values: T[]): T[] {
  return values.sort(compareCanonicalValues);
}
