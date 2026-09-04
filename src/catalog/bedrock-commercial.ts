import type {
  AtomicPricingBook,
  AtomicPricingOffer,
  AtomicPricingTerm,
  AtomicProviderPricing,
  AtomicRateTerm,
  AtomicRateVariant,
  AtomicRawTerm,
  AtomicRawVariant,
} from "./pricing-assembly.ts";
import { canonicalJson } from "./canonical-json.ts";
import { compareCanonicalValues } from "./canonical-value.ts";
import { canonicalizeApplicability, unconditionalApplicability } from "./pricing-canonical.ts";
import {
  addAtom,
  isStandardUnit,
  rawEvidence,
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
import { rationalFromDecimal } from "./pricing-rational.ts";
import { canonicalizeSourceUnit, canonicalizeUnitPrice } from "./pricing-units.ts";
import type {
  ChargeBinding,
  NormalizedPriceObservation,
  PriceApplicability,
  PriceCondition,
  PriceDimension,
  PriceMeter,
  PriceSelectorSource,
  RawPriceObservation,
  UnitExpression,
  UsageSignal,
} from "./pricing-schema.ts";
import type { SourcePricingInputFact } from "./pricing-source.ts";
import type { ProviderModel } from "./schema.ts";

type Mechanism = "on-demand" | "batch";
type PublishedModel = Pick<ProviderModel, "api_endpoints" | "uid">;

const tokenUnit = standardUnit("token");
const requestUnit = standardUnit("request");
const invocationResources = new Set(["guardrails", "prompt-routing", "reranking", "web-search"]);

export function applyBedrockCommercialTopology(
  input: AtomicProviderPricing,
  models: readonly PublishedModel[],
  pricingInputs: readonly SourcePricingInputFact[],
): AtomicProviderPricing {
  const inputIndex = indexPricingInputs(pricingInputs);
  const modelByRef = new Map(models.map((model) => [model.uid, model]));
  const books: AtomicPricingBook[] = [];
  const grounding: AtomicPricingBook[] = [];

  for (const book of input.books) {
    if (book.scope.kind === "models") {
      const supportsConverse = book.scope.model_refs.some((modelRef) =>
        modelByRef.get(modelRef)?.api_endpoints?.some(({ name }) => name === "Converse"),
      );
      const split = splitModelBook(book, input, inputIndex, supportsConverse);
      if (split.model.offers.length > 0) books.push(split.model);
      grounding.push(...split.grounding);
      continue;
    }
    if (book.scope.kind === "provider_resource" && invocationResources.has(book.scope.resource_key))
      books.push(normalizeServiceBook(book, input, inputIndex));
  }

  return { ...input, books: [...books, ...grounding] };
}

function splitModelBook(
  book: AtomicPricingBook,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
  supportsConverse: boolean,
): { model: AtomicPricingBook; grounding: AtomicPricingBook[] } {
  const offers: AtomicPricingOffer[] = [];
  const grounding: AtomicPricingBook[] = [];

  for (const offer of book.offers) {
    if (offer.offer_key !== "usage") continue;
    const onDemand = partitionOffer(offer, "on-demand", input, inputIndex, supportsConverse);
    const batch = partitionOffer(offer, "batch", input, inputIndex, supportsConverse);
    if (onDemand !== undefined) offers.push(onDemand);
    if (batch !== undefined) offers.push(batch);
    grounding.push(...groundingBooks(book, offer, input));
  }

  return { model: { ...book, offers }, grounding };
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
  const hasCacheRates = offer.terms.some(
    (term) =>
      term.kind === "rate" &&
      term.meter.namespace === "kmodels" &&
      ["cache_read_text", "cache_write_text"].includes(term.meter.value),
  );
  const terms = offer.terms.flatMap((term) =>
    partitionTerm(term, mechanism, input, inputIndex, supportsConverse, hasCacheRates),
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
  hasCacheRates: boolean,
): AtomicPricingTerm[] {
  if (term.kind === "raw") {
    if (term.term_key === "tool_call:grounding") return [];
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
      hasCacheRates,
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

function groundingBooks(
  modelBook: AtomicPricingBook,
  source: AtomicPricingOffer,
  input: AtomicProviderPricing,
): AtomicPricingBook[] {
  if (modelBook.scope.kind !== "models") return [];
  const raw = source.terms.find(
    (term): term is AtomicRawTerm => term.kind === "raw" && term.term_key === "tool_call:grounding",
  );
  if (raw === undefined) return [];

  return modelBook.scope.model_refs.flatMap((modelRef) => {
    const variants = raw.variants.flatMap((variant) => groundingVariant(variant, input));
    if (variants.length === 0) return [];
    const resourceKey = `nova-web-grounding:${modelRef}`;
    const rate: AtomicRateTerm = {
      term_key: "web_search",
      kind: "rate",
      meter: { namespace: "kmodels", value: "web_search" },
      variants,
      raw_variants: [],
      source_refs: [...new Set(variants.map(({ observation }) => observation.source_ref))],
    };
    return [
      {
        book_key: `service:${resourceKey}`,
        name: `${modelRef} Nova Web Grounding`,
        scope: {
          kind: "provider_resource",
          resource_kind: { namespace: "kmodels", value: "service" },
          resource_key: resourceKey,
          model_refs: [modelRef],
        },
        scope_observations: modelBook.scope_observations.map((observation) => ({
          ...observation,
          establishes: {
            kind: "provider_resource",
            resource_kind: { namespace: "kmodels", value: "service" },
            resource_key: resourceKey,
            model_refs: [modelRef],
          },
          raw: { label: `${modelRef} Nova Web Grounding` },
        })),
        offers: [
          {
            offer_key: "grounding",
            name: "Nova Web Grounding",
            billing_mode: { namespace: "kmodels", value: "usage" },
            states: variants.map((variant) => ({
              state: "numeric",
              applicability: variant.applicability,
              observation: variant.observation,
            })),
            terms: [rate],
            relations: [],
            source_refs: rate.source_refs,
          },
        ],
        source_refs: rate.source_refs,
      },
    ];
  });
}

function groundingVariant(
  variant: AtomicRawVariant,
  input: AtomicProviderPricing,
): AtomicRateTerm["variants"] {
  const { amount, denomination, unit } = variant.observation.raw;
  if (
    amount === undefined ||
    denomination !== "USD" ||
    !["Requests", "request"].includes(unit ?? "")
  )
    return [];

  addUsageSignal(
    input,
    "nova_web_grounding_requests",
    "Nova Web Grounding requests realized by Amazon Bedrock",
    requestUnit,
    "outcome",
  );
  const applicability = variant.possible_scope ?? unconditionalApplicability;
  return [
    {
      price: {
        value: rationalFromDecimal(amount),
        denomination: { kind: "fiat", currency: "USD" },
        per: requestUnit,
      },
      applicability,
      charge_binding: {
        signal: providerSignal(input, "nova_web_grounding_requests"),
        aggregation: "request",
        observations: [rawEvidence(variant.observation)],
      },
      observation: {
        ...variant.observation,
        establishes_applicability: applicability,
      },
    },
  ];
}

function normalizeServiceBook(
  book: AtomicPricingBook,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): AtomicPricingBook {
  return {
    ...book,
    offers: book.offers.map((offer) => {
      const terms = offer.terms.flatMap((term) =>
        term.kind === "raw" ? normalizeServiceTerm(book, offer, term, input, inputIndex) : [term],
      );
      return { ...offer, terms };
    }),
  };
}

function normalizeServiceTerm(
  book: AtomicPricingBook,
  offer: AtomicPricingOffer,
  term: AtomicRawTerm,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): AtomicPricingTerm[] {
  const variants: AtomicRateTerm["variants"] = [];
  const raw_variants: AtomicRawVariant[] = [];
  let meter: PriceMeter | undefined;

  for (const variant of term.variants) {
    const normalized = serviceVariant(book, variant, input, inputIndex);
    if (normalized === undefined) {
      raw_variants.push(variant);
      continue;
    }
    meter = normalized.meter;
    variants.push(normalized.variant);
  }
  if (meter === undefined) return [term];

  for (const variant of variants)
    offer.states.push({
      state: "numeric",
      applicability: variant.applicability,
      ...(variant.validity === undefined ? {} : { validity: variant.validity }),
      observation: { ...variant.observation, raw: { label: "Published numeric rate" } },
    });

  return [
    {
      term_key: term.term_key,
      kind: "rate",
      meter,
      variants,
      raw_variants,
      source_refs: term.source_refs,
    },
  ];
}

function serviceVariant(
  book: AtomicPricingBook,
  variant: AtomicRawVariant,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): { meter: PriceMeter; variant: AtomicRateTerm["variants"][number] } | undefined {
  if (book.scope.kind !== "provider_resource") return;
  const raw = variant.observation.raw;
  if (raw.amount === undefined || raw.denomination !== "USD" || raw.unit === undefined) return;
  const unit = serviceUnit(raw.unit, raw.fragment, input);
  if (unit === undefined) return;
  const applicability = variant.possible_scope ?? unconditionalApplicability;
  const meter = serviceMeter(book.scope.resource_key, input);
  const observation: NormalizedPriceObservation = {
    ...variant.observation,
    locator:
      raw.label === undefined ? variant.observation.locator : { kind: "sku", value: raw.label },
    establishes_applicability: applicability,
  };
  const charge_binding = serviceChargeBinding(
    book.scope.resource_key,
    raw,
    unit.unit,
    observation,
    input,
    inputIndex,
  );

  return {
    meter,
    variant: {
      price: canonicalizeUnitPrice(
        rationalFromDecimal(raw.amount),
        { kind: "fiat", currency: "USD" },
        unit,
      ),
      applicability,
      ...(variant.validity === undefined ? {} : { validity: variant.validity }),
      ...(charge_binding === undefined ? {} : { charge_binding }),
      observation,
    },
  };
}

function serviceUnit(
  rawUnit: string,
  fragment: string | undefined,
  input: AtomicProviderPricing,
): ReturnType<typeof canonicalizeSourceUnit> | undefined {
  const thousand = fragment !== undefined && /per 1K\b/i.test(fragment) ? "thousand" : undefined;
  if (rawUnit === "TextUnit")
    return canonicalizeSourceUnit([
      {
        unit: providerUnit(
          input,
          "guardrail_text_unit",
          "One Amazon Bedrock Guardrail text unit of up to 1,000 characters",
        ),
        power: 1,
        ...(thousand === undefined ? {} : { scale: thousand }),
      },
    ]);
  if (rawUnit === "Images Processed")
    return canonicalizeSourceUnit([
      {
        unit: standardAtom("image"),
        power: 1,
        ...(thousand === undefined ? {} : { scale: thousand }),
      },
    ]);
  if (rawUnit === "Search Units")
    return canonicalizeSourceUnit([
      {
        unit: providerUnit(
          input,
          "search_unit",
          "One provider-published search or rerank billing unit",
        ),
        power: 1,
      },
    ]);
  if (
    ["API Calls", "Invocations", "Queries", "Requests", "Text Requests"].includes(rawUnit) ||
    /^Per 1000 requests$/i.test(rawUnit)
  )
    return canonicalizeSourceUnit([
      {
        unit: standardAtom("request"),
        power: 1,
        ...(thousand === undefined && !/^Per 1000 requests$/i.test(rawUnit)
          ? {}
          : { scale: "thousand" }),
      },
    ]);
}

function serviceMeter(resource: string, input: AtomicProviderPricing): PriceMeter {
  if (resource === "guardrails") return { namespace: "kmodels", value: "content_safety" };
  if (resource === "reranking") return { namespace: "kmodels", value: "rerank" };
  if (resource === "web-search") return { namespace: "kmodels", value: "web_search" };
  addAtom(input, {
    kind: "meter",
    key: "prompt_routing",
    definition: "Amazon Bedrock intelligent prompt-routing requests",
  });
  return { namespace: "provider", provider_id: input.provider_id, value: "prompt_routing" };
}

function serviceChargeBinding(
  resource: string,
  raw: RawPriceObservation["raw"],
  unit: UnitExpression,
  observation: NormalizedPriceObservation,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): ChargeBinding | undefined {
  const operation = rawCondition(raw, "operation");
  const policyType = rawCondition(raw, "policyType");

  if (resource === "guardrails") {
    const field =
      operation === "InvokeGuardrailChecks"
        ? {
            GuardrailContentChecks: "contentFilter.textUnits",
            GuardrailPromptAttackChecks: "promptAttack.textUnits",
            GuardrailSensitiveInfoChecks: "sensitiveInformation.textUnits",
          }[policyType ?? ""]
        : {
            AutomatedReasoning: "automatedReasoningPolicyUnits",
            Content: "contentPolicyUnits",
            ContentPolicyImage: "contentPolicyImageUnits",
            ContextualGrounding: "contextualGroundingPolicyUnits",
            GuardrailContent: "contentPolicyUnits",
            GuardrailSensitiveInfo: "sensitiveInformationPolicyUnits",
            GuardrailTopic: "topicPolicyUnits",
            GuardrailWordPolicy: "wordPolicyUnits",
            SensitiveInfo: "sensitiveInformationPolicyUnits",
            SensitiveInfoFree: "sensitiveInformationPolicyFreeUnits",
            Topic: "topicPolicyUnits",
            WordPolicy: "wordPolicyUnits",
          }[policyType ?? ""];
    if (field === undefined) return;
    const key = `guardrail_${field.replace(/[A-Z.]/g, (value) =>
      value === "." ? "_" : `_${value.toLowerCase()}`,
    )}`;
    const factKey =
      operation === "InvokeGuardrailChecks"
        ? `guardrails.checks.${field}`
        : `guardrails.apply.${field}`;
    const facts = pricingInputFacts(inputIndex, [factKey]);
    addUsageSignal(input, key, `Amazon Bedrock Guardrails billable ${field}`, unit, "outcome");
    return directBinding(providerSignal(input, key), "request", facts, observation);
  }

  const binding =
    resource === "reranking"
      ? {
          key: "rerank_search_units",
          definition:
            "Amazon Bedrock rerank search units after provider-defined document-chunk expansion",
          phase: "request" as const,
        }
      : resource === "web-search"
        ? {
            key: "web_search_queries",
            definition: "Amazon Bedrock Web Search queries actually issued by the server-side tool",
            phase: "outcome" as const,
          }
        : resource === "prompt-routing"
          ? {
              key: "prompt_routing_requests",
              definition: "Model invocations addressed to an Amazon Bedrock prompt router",
              phase: "request" as const,
            }
          : undefined;
  if (binding === undefined) return;
  addUsageSignal(input, binding.key, binding.definition, unit, binding.phase);
  return {
    signal: providerSignal(input, binding.key),
    aggregation: "request",
    observations: [rawEvidence(observation)],
  };
}

function modelChargeBinding(
  meter: PriceMeter,
  variant: AtomicRateVariant,
  mechanism: Mechanism,
  observation: NormalizedPriceObservation,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
  supportsConverse: boolean,
  hasCacheRates: boolean,
): ChargeBinding | undefined {
  if (meter.namespace !== "kmodels") return;
  const unit = variant.price.per;
  if (isStandardUnit(unit, "token")) {
    const token = tokenBindingSpec(meter, variant.applicability, mechanism, hasCacheRates, input);
    if (token === undefined) return;
    const facts = tokenInputFacts(
      token.keys,
      mechanism,
      inputIndex,
      supportsConverse && permitsRuntime(variant.applicability),
      token.includeInvocationLog && permitsRuntime(variant.applicability),
    );
    return directBinding(token.signal, token.aggregation, facts, observation);
  }

  const factor = unit.factors.length === 1 ? unit.factors[0] : undefined;
  if (factor?.power !== 1) return;
  const value = factor.unit.value;
  const signal = semanticModelSignal(meter, value, unit, input);
  if (signal === undefined) return;
  return {
    signal,
    aggregation: mechanism === "batch" ? "job" : "attempt",
    observations: [rawEvidence(observation)],
  };
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
  const suffix = ttl === 300 ? "5m" : "1h";
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
  if (!["search_unit", "video"].includes(unitValue)) return;
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
  const runtime = permitsRuntime(applicability);
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

function permitsRuntime(applicability: PriceApplicability): boolean {
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

function exactCacheTtl(applicability: PriceApplicability): 300 | 3600 | undefined {
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
  return value === 300 || value === 3600 ? value : undefined;
}

function rawCondition(raw: RawPriceObservation["raw"], name: string): string | undefined {
  return raw.conditions?.find(({ dimension }) => dimension === name)?.value;
}

function providerUnit(
  input: AtomicProviderPricing,
  key: string,
  definition: string,
): UnitExpression["factors"][number]["unit"] {
  addAtom(input, { kind: "unit", key, definition });
  return { namespace: "provider", provider_id: input.provider_id, value: key };
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

function standardSignal(
  value:
    | "accepted_requests"
    | "cached_input_tokens"
    | "cache_write_tokens"
    | "generated_images"
    | "generated_seconds"
    | "input_tokens"
    | "output_tokens"
    | "processed_audio_seconds"
    | "processed_images"
    | "processed_pages"
    | "uncached_input_tokens",
): UsageSignal {
  return { namespace: "kmodels", value };
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
