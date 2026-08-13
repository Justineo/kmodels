import type {
  AtomicPricingBook,
  AtomicPricingOffer,
  AtomicPricingTerm,
  AtomicProviderPricing,
  AtomicRateVariant,
  AtomicRawVariant,
} from "./pricing-assembly.ts";
import { canonicalizeApplicability } from "./pricing-canonical.ts";
import { addAtom, isStandardUnit, rawEvidence } from "./pricing-commercial-assembly.ts";
import type {
  ChargeBinding,
  NormalizedPriceObservation,
  PriceApplicability,
  PriceCondition,
  PriceMeter,
  RawPriceObservation,
  UnitExpression,
} from "./pricing-schema.ts";

type Mechanism = "sync" | "batch";

export function applyMistralCommercialTopology(
  input: AtomicProviderPricing,
): AtomicProviderPricing {
  return {
    ...input,
    books: input.books.flatMap((book) => {
      if (book.scope.kind === "models") return [splitModelBook(book, input)];
      const resource = requestServiceBook(book, input);
      return resource === undefined ? [] : [resource];
    }),
  };
}

function splitModelBook(book: AtomicPricingBook, input: AtomicProviderPricing): AtomicPricingBook {
  return {
    ...book,
    offers: book.offers.flatMap((offer) => {
      if (offer.offer_key !== "usage") return [{ ...offer, relations: [], settlement: [] }];
      return (["sync", "batch"] as const).flatMap((mechanism) => {
        const partition = partitionOffer(offer, mechanism, input);
        return partition === undefined ? [] : [partition];
      });
    }),
  };
}

function partitionOffer(
  offer: AtomicPricingOffer,
  mechanism: Mechanism,
  input: AtomicProviderPricing,
): AtomicPricingOffer | undefined {
  const hasCache = offer.terms.some(
    (term) =>
      term.kind === "rate" &&
      term.meter.namespace === "kmodels" &&
      term.meter.value === "cache_read_text",
  );
  const states = offer.states.flatMap((state) => {
    const applicability = mechanismApplicability(state.applicability, mechanism);
    return applicability === undefined
      ? []
      : [{ ...state, applicability, observation: normalized(state.observation, applicability) }];
  });
  const terms = offer.terms.flatMap((term) => partitionTerm(term, mechanism, input, hasCache));
  if (states.length === 0 && terms.length === 0) return;
  return {
    ...offer,
    offer_key: mechanism,
    name: mechanism === "batch" ? "Batch inference" : "On-demand inference",
    states,
    enrollment: [],
    terms,
    relations: [],
    settlement: [],
  };
}

function partitionTerm(
  term: AtomicPricingTerm,
  mechanism: Mechanism,
  input: AtomicProviderPricing,
  hasCache: boolean,
): AtomicPricingTerm[] {
  if (term.kind === "raw") {
    const variants = term.variants.flatMap((variant) => partitionRaw(variant, mechanism));
    return variants.length === 0 ? [] : [{ ...term, variants }];
  }
  if (term.kind !== "rate") return mechanism === "sync" ? [term] : [];
  const variants = term.variants.flatMap((variant) => {
    const applicability = mechanismApplicability(variant.applicability, mechanism);
    if (applicability === undefined) return [];
    const next = {
      ...variant,
      applicability,
      observation: normalized(variant.observation, applicability),
    };
    const charge_binding = modelBinding(term.meter, next, mechanism, input, hasCache);
    return [{ ...next, ...(charge_binding === undefined ? {} : { charge_binding }) }];
  });
  const raw_variants = term.raw_variants.flatMap((variant) => partitionRaw(variant, mechanism));
  return variants.length + raw_variants.length === 0 ? [] : [{ ...term, variants, raw_variants }];
}

function partitionRaw(variant: AtomicRawVariant, mechanism: Mechanism): AtomicRawVariant[] {
  if (variant.possible_scope === undefined) return mechanism === "sync" ? [variant] : [];
  const possible_scope = mechanismApplicability(variant.possible_scope, mechanism);
  return possible_scope === undefined ? [] : [{ ...variant, possible_scope }];
}

function mechanismApplicability(
  applicability: PriceApplicability,
  mechanism: Mechanism,
): PriceApplicability | undefined {
  const any_of = applicability.any_of.flatMap(({ all_of }) => {
    const tier = all_of.find(isBatchTier);
    if ((mechanism === "batch") !== (tier !== undefined)) return [];
    return [{ all_of: tier === undefined ? all_of : all_of.filter((item) => item !== tier) }];
  });
  return any_of.length === 0 ? undefined : canonicalizeApplicability({ any_of });
}

function isBatchTier(condition: PriceCondition): boolean {
  return (
    condition.kind === "categorical" &&
    condition.dimension.namespace === "kmodels" &&
    condition.dimension.value === "service_tier" &&
    condition.values.some(({ value }) => value === "batch")
  );
}

function modelBinding(
  meter: PriceMeter,
  variant: AtomicRateVariant,
  mechanism: Mechanism,
  input: AtomicProviderPricing,
  hasCache: boolean,
): ChargeBinding | undefined {
  if (meter.namespace !== "kmodels") return;
  const aggregation = mechanism === "batch" ? "result_item" : "request";
  if (["input_text", "output_text", "cache_read_text", "embedding"].includes(meter.value)) {
    if (!isStandardUnit(variant.price.per, "token")) return;
    const signal =
      meter.value === "cache_read_text"
        ? "cached_input_tokens"
        : meter.value === "output_text"
          ? "output_tokens"
          : meter.value === "input_text" && hasCache && mechanism === "sync"
            ? "uncached_input_tokens"
            : "input_tokens";
    return standardBinding(signal, aggregation, variant.observation, `${mechanism}:${signal}`);
  }
  if (meter.value === "input_image" && isStandardUnit(variant.price.per, "page"))
    return providerBinding(
      input,
      "pages_processed",
      "OCR pages reported by response usage_info.pages_processed",
      variant.price.per,
      aggregation,
      variant.observation,
      "response:usage_info.pages_processed",
      "outcome",
    );
  if (meter.value === "input_audio" && isStandardUnit(variant.price.per, "second"))
    return providerBinding(
      input,
      "audio_seconds",
      "Billable audio seconds reported by response usage.prompt_audio_seconds",
      variant.price.per,
      aggregation,
      variant.observation,
      "response:usage.prompt_audio_seconds",
      "outcome",
    );
  if (meter.value === "output_audio" && isStandardUnit(variant.price.per, "character"))
    return providerBinding(
      input,
      "submitted_tts_characters",
      "Characters submitted in the speech synthesis input",
      variant.price.per,
      aggregation,
      variant.observation,
      "request:input.length",
      "request",
    );
}

function standardBinding(
  value: "cached_input_tokens" | "input_tokens" | "output_tokens" | "uncached_input_tokens",
  aggregation: ChargeBinding["aggregation"],
  evidence: RawPriceObservation,
  locator: string,
): ChargeBinding {
  return {
    signal: { namespace: "kmodels", value },
    aggregation,
    observations: [{ ...rawEvidence(evidence), locator: { kind: "provider_key", value: locator } }],
  };
}

const requestServices = new Set([
  "code-execution",
  "web-search",
  "premium-news",
  "image-generation",
  "library-retrieval",
]);

function requestServiceBook(
  book: AtomicPricingBook,
  input: AtomicProviderPricing,
): AtomicPricingBook | undefined {
  if (book.scope.kind !== "provider_resource" || !requestServices.has(book.scope.resource_key))
    return;
  const resourceKey = book.scope.resource_key;
  const blocked = book.offers.some((offer) =>
    offer.terms.some(
      (term) => term.kind === "raw" && term.term_key === "charge_binding_unavailable",
    ),
  );
  return {
    ...book,
    resource_edges: [],
    offers: book.offers.map((offer) => ({
      ...offer,
      enrollment: [],
      terms: offer.terms.map((term) => bindResourceTerm(resourceKey, term, input, blocked)),
      relations: [],
      settlement: [],
    })),
  };
}

function bindResourceTerm(
  resourceKey: string,
  term: AtomicPricingTerm,
  input: AtomicProviderPricing,
  blocked: boolean,
): AtomicPricingTerm {
  if (term.kind !== "rate" || blocked) return term;
  return {
    ...term,
    variants: term.variants.map((variant) => {
      const signal = resourceSignal(resourceKey, term.meter, variant);
      return signal === undefined
        ? variant
        : {
            ...variant,
            charge_binding: providerBinding(
              input,
              signal.key,
              signal.definition,
              variant.price.per,
              signal.aggregation,
              variant.observation,
              signal.locator,
              "outcome",
            ),
          };
    }),
  };
}

function resourceSignal(
  resourceKey: string,
  meter: PriceMeter,
  variant: AtomicRateVariant,
):
  | {
      key: string;
      definition: string;
      aggregation: ChargeBinding["aggregation"];
      locator: string;
    }
  | undefined {
  if (resourceKey === "code-execution" && isStandardUnit(variant.price.per, "request"))
    return {
      key: "completed_code_executions",
      definition: "Completed code_interpreter executions in final connector usage",
      aggregation: "request",
      locator: "response:usage.connectors.code_interpreter",
    };
  if (
    (resourceKey === "web-search" || resourceKey === "premium-news") &&
    isStandardUnit(variant.price.per, "request")
  )
    return {
      key:
        resourceKey === "web-search" ? "completed_web_searches" : "completed_premium_news_searches",
      definition: "Completed provider-executed searches in final connector usage",
      aggregation: "request",
      locator: `response:usage.connectors.${resourceKey === "web-search" ? "web_search" : "web_search_premium"}`,
    };
  if (
    resourceKey === "image-generation" &&
    meter.namespace === "kmodels" &&
    meter.value === "image_generation"
  )
    return {
      key: "generated_images",
      definition: "Generated image outputs returned by image_generation",
      aggregation: "result_item",
      locator: "response:generated image files",
    };
  if (resourceKey === "library-retrieval" && isStandardUnit(variant.price.per, "request"))
    return {
      key: "document_library_calls",
      definition: "Completed document_library calls in final connector usage",
      aggregation: "request",
      locator: "response:usage.connectors.document_library",
    };
}

function providerBinding(
  input: AtomicProviderPricing,
  key: string,
  definition: string,
  unit: UnitExpression,
  aggregation: ChargeBinding["aggregation"],
  evidence: RawPriceObservation,
  locator: string,
  phase: "outcome" | "request",
): ChargeBinding {
  addAtom(input, { kind: "usage_signal", key, definition, unit, resolution_phase: phase });
  return {
    signal: { namespace: "provider", provider_id: input.provider_id, value: key },
    aggregation,
    observations: [{ ...rawEvidence(evidence), locator: { kind: "provider_key", value: locator } }],
  };
}

function normalized(
  observation: RawPriceObservation,
  applicability: PriceApplicability,
): NormalizedPriceObservation {
  return { ...rawEvidence(observation), establishes_applicability: applicability };
}
