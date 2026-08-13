import type {
  AtomicPricingBook,
  AtomicPricingOffer,
  AtomicPricingTerm,
  AtomicProviderPricing,
  AtomicRateTerm,
  AtomicRawTerm,
  AtomicRawVariant,
} from "./pricing-assembly.ts";
import { canonicalizeApplicability, unconditionalApplicability } from "./pricing-canonical.ts";
import { addAtom, withApplicability } from "./pricing-commercial-assembly.ts";
import { rationalFromDecimal } from "./pricing-rational.ts";
import { canonicalizeSourceUnit, canonicalizeUnitPrice } from "./pricing-units.ts";
import type {
  ChargeBinding,
  NormalizedPriceObservation,
  PriceApplicability,
  PriceCondition,
  PriceMeter,
  RawPriceObservation,
  UnitExpression,
} from "./pricing-schema.ts";

type Mechanism = "on-demand" | "batch";

const tokenUnit = standardUnit("token");
const requestUnit = standardUnit("request");
const invocationResources = new Set(["guardrails", "prompt-routing", "reranking", "web-search"]);

export function applyBedrockCommercialTopology(
  input: AtomicProviderPricing,
): AtomicProviderPricing {
  const books: AtomicPricingBook[] = [];
  const grounding: AtomicPricingBook[] = [];

  for (const book of input.books) {
    if (book.scope.kind === "models") {
      const split = splitModelBook(book, input);
      if (split.model.offers.length > 0) books.push(split.model);
      grounding.push(...split.grounding);
      continue;
    }
    if (book.scope.kind === "provider_resource" && invocationResources.has(book.scope.resource_key))
      books.push(normalizeServiceBook(book, input));
  }

  return { ...input, books: [...books, ...grounding] };
}

function splitModelBook(
  book: AtomicPricingBook,
  input: AtomicProviderPricing,
): { model: AtomicPricingBook; grounding: AtomicPricingBook[] } {
  const offers: AtomicPricingOffer[] = [];
  const grounding: AtomicPricingBook[] = [];

  for (const offer of book.offers) {
    if (offer.offer_key !== "usage") continue;
    const onDemand = partitionOffer(offer, "on-demand", input);
    const batch = partitionOffer(offer, "batch", input);
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
  const terms = offer.terms.flatMap((term) => partitionTerm(term, mechanism, input));
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
      variant.price.per,
      mechanism,
      observation,
      input,
    );
    return [
      {
        ...variant,
        applicability,
        observation,
        ...(charge_binding === undefined ? {} : { charge_binding }),
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
        observations: [usageObservation(variant.observation, "response:Nova Web Grounding")],
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
): AtomicPricingBook {
  return {
    ...book,
    offers: book.offers.map((offer) => {
      const terms = offer.terms.flatMap((term) =>
        term.kind === "raw" ? normalizeServiceTerm(book, offer, term, input) : [term],
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
): AtomicPricingTerm[] {
  const variants: AtomicRateTerm["variants"] = [];
  const raw_variants: AtomicRawVariant[] = [];
  let meter: PriceMeter | undefined;

  for (const variant of term.variants) {
    const normalized = serviceVariant(book, variant, input);
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
    addUsageSignal(
      input,
      key,
      `Amazon Bedrock Guardrails response usage.${field}`,
      unit,
      "outcome",
    );
    return {
      signal: providerSignal(input, key),
      aggregation: "request",
      observations: [usageObservation(observation, `response:usage.${field}`)],
    };
  }

  const binding =
    resource === "reranking"
      ? {
          key: "rerank_search_units",
          definition: "Rerank queries sent to Amazon Bedrock",
          phase: "request" as const,
          locator: "request:Rerank.queries[0]",
        }
      : resource === "web-search"
        ? {
            key: "web_search_queries",
            definition: "Amazon Bedrock Web Search queries",
            phase: "request" as const,
            locator: "request:Bedrock Web Search query",
          }
        : resource === "prompt-routing"
          ? {
              key: "prompt_routing_requests",
              definition: "Model invocations addressed to an Amazon Bedrock prompt router",
              phase: "request" as const,
              locator: "request:modelId=prompt-router",
            }
          : undefined;
  if (binding === undefined) return;
  addUsageSignal(input, binding.key, binding.definition, unit, binding.phase);
  return {
    signal: providerSignal(input, binding.key),
    aggregation: "request",
    observations: [usageObservation(observation, binding.locator)],
  };
}

function modelChargeBinding(
  meter: PriceMeter,
  unit: UnitExpression,
  mechanism: Mechanism,
  observation: NormalizedPriceObservation,
  input: AtomicProviderPricing,
): ChargeBinding | undefined {
  if (meter.namespace !== "kmodels") return;

  const tokenField =
    sameUnit(unit, tokenUnit) && (meter.value === "input_text" || meter.value === "embedding")
      ? "inputTokens"
      : sameUnit(unit, tokenUnit) && meter.value === "output_text"
        ? "outputTokens"
        : sameUnit(unit, tokenUnit) && meter.value === "cache_read_text"
          ? "cacheReadInputTokens"
          : sameUnit(unit, tokenUnit) && meter.value === "cache_write_text"
            ? "cacheWriteInputTokens"
            : undefined;
  if (tokenField !== undefined) {
    const key = `runtime_${snakeCase(tokenField)}`;
    addUsageSignal(
      input,
      key,
      `${tokenField} reported by a completed Bedrock invocation or Batch result item`,
      tokenUnit,
      "outcome",
    );
    return {
      signal: providerSignal(input, key),
      aggregation: mechanism === "batch" ? "result_item" : "attempt",
      observations: [
        usageObservation(
          observation,
          mechanism === "batch"
            ? `batch-result:modelOutput.usage.${tokenField}`
            : `response:usage.${tokenField}`,
        ),
      ],
    };
  }

  const factor = unit.factors.length === 1 ? unit.factors[0] : undefined;
  if (factor?.power !== 1) return;
  const value = factor.unit.value;
  if (!["image", "page", "request", "search_unit", "second", "video"].includes(value)) return;

  const requestPhase =
    meter.value.startsWith("input_") || meter.value === "embedding" || meter.value === "rerank";
  const key = `runtime_${meter.value}_${value}`;
  addUsageSignal(
    input,
    key,
    `Amazon Bedrock ${meter.value.replaceAll("_", " ")} quantity measured in ${value}`,
    unit,
    requestPhase ? "request" : "outcome",
  );
  return {
    signal: providerSignal(input, key),
    aggregation: mechanism === "batch" ? "result_item" : "attempt",
    observations: [
      usageObservation(observation, `${requestPhase ? "request" : "response"}:${meter.value}`),
    ],
  };
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

function standardAtom(
  value: "image" | "page" | "request" | "second" | "token",
): UnitExpression["factors"][number]["unit"] {
  return { namespace: "kmodels", value };
}

function standardUnit(value: "request" | "token"): UnitExpression {
  return { factors: [{ unit: standardAtom(value), power: 1 }] };
}

function usageObservation(
  observation: RawPriceObservation | NormalizedPriceObservation,
  value: string,
): RawPriceObservation {
  return {
    source_ref: observation.source_ref,
    locator: { kind: "provider_key", value },
    raw: { fragment: value },
  };
}

function sameUnit(left: UnitExpression, right: UnitExpression): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function snakeCase(value: string): string {
  return value.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`);
}
