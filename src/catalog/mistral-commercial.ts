import { uniqueCanonicalValues as unique } from "./canonical-value.ts";
import type {
  AtomicPricingBook,
  AtomicPricingOffer,
  AtomicPricingTerm,
  AtomicProviderPricing,
  AtomicRateVariant,
  AtomicRawVariant,
} from "./pricing-assembly.ts";
import type { PublishedPricingModel } from "./pricing-adapter.ts";
import { canonicalizeApplicability } from "./pricing-canonical.ts";
import { addAtom, isStandardUnit, rawEvidence } from "./pricing-commercial-assembly.ts";
import {
  directQuantityMethods as directMethods,
  emptyQuantityMethods as emptyMethods,
  includePricingInputSourceRefs,
  indexPricingInputs,
  mergeQuantityMethods as mergeMethods,
  pricingInputObservation,
  subtractQuantityMethods as subtractionMethod,
  sumQuantityMethods as sumMethod,
  type BoundQuantityMethods as MethodsAndFacts,
  type PricingInputIndex,
} from "./pricing-input.ts";
import type {
  ChargeBinding,
  NormalizedPriceObservation,
  PriceApplicability,
  PriceCondition,
  PriceMeter,
  UnitExpression,
  UsageSignal,
} from "./pricing-schema.ts";
import type { SourcePricingInputFact } from "./pricing-source.ts";

type Mechanism = "sync" | "batch";

const tokenUnit: UnitExpression = {
  factors: [{ unit: { namespace: "kmodels", value: "token" }, power: 1 }],
};
const requestServices = new Set([
  "code-execution",
  "web-search",
  "premium-news",
  "image-generation",
  "library-retrieval",
]);

export function applyMistralCommercialTopology(
  input: AtomicProviderPricing,
  publishedModels: readonly PublishedPricingModel[],
  pricingInputs: readonly SourcePricingInputFact[],
): AtomicProviderPricing {
  const published = new Map(publishedModels.map((model) => [model.uid, model]));
  const inputIndex = indexPricingInputs(pricingInputs);
  return {
    ...input,
    books: input.books.flatMap((book) => {
      if (book.scope.kind === "models")
        return [
          includePricingInputSourceRefs(
            splitModelBook(book, published.get(book.scope.model_refs[0] ?? ""), input, inputIndex),
          ),
        ];
      return book.scope.kind === "provider_resource" && requestServices.has(book.scope.resource_key)
        ? [
            includePricingInputSourceRefs(
              requestServiceBook(book, book.scope.resource_key, input, inputIndex),
            ),
          ]
        : [];
    }),
  };
}

function splitModelBook(
  book: AtomicPricingBook,
  model: PublishedPricingModel | undefined,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): AtomicPricingBook {
  return {
    ...book,
    offers: book.offers.flatMap((offer) => {
      if (offer.offer_key !== "usage") return [{ ...offer, relations: [], settlement: [] }];
      return (["sync", "batch"] as const).flatMap((mechanism) => {
        const partition = partitionOffer(offer, mechanism, model, input, inputIndex);
        return partition === undefined ? [] : [partition];
      });
    }),
  };
}

function partitionOffer(
  offer: AtomicPricingOffer,
  mechanism: Mechanism,
  model: PublishedPricingModel | undefined,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
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
  const terms = offer.terms.flatMap((term) =>
    partitionTerm(term, mechanism, model, input, inputIndex, hasCache),
  );
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
  model: PublishedPricingModel | undefined,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
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
    const charge_binding = modelBinding(
      term.meter,
      next,
      mechanism,
      model,
      input,
      inputIndex,
      hasCache,
    );
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
  model: PublishedPricingModel | undefined,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
  hasCache: boolean,
): ChargeBinding | undefined {
  if (meter.namespace !== "kmodels") return;
  const aggregation = mechanism === "batch" ? "result_item" : "request";
  if (
    ["input_text", "output_text", "cache_read_text", "embedding"].includes(meter.value) &&
    isStandardUnit(variant.price.per, "token")
  ) {
    const signal = tokenSignal(meter.value, mechanism, hasCache);
    if (signal === undefined) return;
    const mapped =
      mechanism === "batch"
        ? emptyMethods()
        : tokenMethods(meter.value, signal, model, input, inputIndex, hasCache);
    return quantityBinding(signal, aggregation, mapped, variant);
  }
  const media = mediaSignal(meter, variant, mechanism, model, inputIndex);
  return media === undefined
    ? undefined
    : quantityBinding(media.signal, aggregation, media.mapped, variant);
}

function tokenSignal(
  meter: string,
  mechanism: Mechanism,
  hasCache: boolean,
): UsageSignal | undefined {
  if (meter === "cache_read_text") return standardSignal("cached_input_tokens");
  if (meter === "output_text") return standardSignal("output_tokens");
  if (meter === "embedding") return standardSignal("input_tokens");
  if (meter === "input_text")
    return standardSignal(
      hasCache && mechanism === "sync" ? "uncached_input_tokens" : "input_tokens",
    );
}

function tokenMethods(
  meter: string,
  signal: UsageSignal,
  model: PublishedPricingModel | undefined,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
  hasCache: boolean,
): MethodsAndFacts {
  const paths = endpointPaths(model);
  if (meter === "cache_read_text")
    return paths.has("/v1/chat/completions") || paths.has("/v1/fim/completions")
      ? directMethods(
          signal,
          ["completion.response.cached_tokens", "completion.stream.cached_tokens"],
          inputIndex,
        )
      : emptyMethods();
  if (meter === "embedding")
    return paths.has("/v1/embeddings")
      ? directMethods(signal, ["embedding.response.prompt_tokens"], inputIndex)
      : emptyMethods();

  const completionKeys =
    paths.has("/v1/chat/completions") || paths.has("/v1/fim/completions")
      ? [
          `completion.response.${meter === "output_text" ? "completion_tokens" : "prompt_tokens"}`,
          `completion.stream.${meter === "output_text" ? "completion_tokens" : "prompt_tokens"}`,
        ]
      : [];
  const completion =
    meter === "input_text" && hasCache
      ? subtractionMethod(
          standardSignal("input_tokens"),
          completionKeys,
          standardSignal("cached_input_tokens"),
          ["completion.response.cached_tokens", "completion.stream.cached_tokens"],
          inputIndex,
        )
      : directMethods(signal, completionKeys, inputIndex);
  const conversation = paths.has("/v1/conversations")
    ? meter === "output_text"
      ? directMethods(signal, ["conversation.response.completion_tokens"], inputIndex)
      : conversationInputMethod(input, inputIndex)
    : emptyMethods();
  return mergeMethods([completion, conversation]);
}

function conversationInputMethod(
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): MethodsAndFacts {
  const connector = providerSignal(
    input,
    "conversation_connector_tokens",
    "Connector tokens included in Mistral Conversation input billing",
    tokenUnit,
  );
  return sumMethod(
    [
      { signal: standardSignal("input_tokens"), keys: ["conversation.response.prompt_tokens"] },
      { signal: connector, keys: ["conversation.response.connector_tokens"] },
    ],
    inputIndex,
  );
}

function mediaSignal(
  meter: PriceMeter,
  variant: AtomicRateVariant,
  mechanism: Mechanism,
  model: PublishedPricingModel | undefined,
  inputIndex: PricingInputIndex,
): { signal: UsageSignal; mapped: MethodsAndFacts } | undefined {
  const paths = endpointPaths(model);
  if (meter.value === "input_image" && isStandardUnit(variant.price.per, "page")) {
    const signal = standardSignal("processed_pages");
    return {
      signal,
      mapped:
        mechanism === "sync" && paths.has("/v1/ocr")
          ? directMethods(signal, ["ocr.response.pages_processed"], inputIndex)
          : emptyMethods(),
    };
  }
  if (meter.value === "input_audio" && isStandardUnit(variant.price.per, "second")) {
    const signal = standardSignal("processed_audio_seconds");
    const keys = [
      ...(paths.has("/v1/audio/transcriptions")
        ? [
            "transcription.response.prompt_audio_seconds",
            "transcription.stream.prompt_audio_seconds",
          ]
        : []),
      ...(paths.has("/v1/chat/completions")
        ? ["completion.response.prompt_audio_seconds", "completion.stream.prompt_audio_seconds"]
        : []),
    ];
    return {
      signal,
      mapped: mechanism === "sync" ? directMethods(signal, keys, inputIndex) : emptyMethods(),
    };
  }
  if (meter.value === "output_audio" && isStandardUnit(variant.price.per, "character")) {
    const signal = standardSignal("input_characters");
    return {
      signal,
      mapped:
        mechanism === "sync" && paths.has("/v1/audio/speech")
          ? directMethods(signal, ["speech.request.input_characters"], inputIndex)
          : emptyMethods(),
    };
  }
}

function requestServiceBook(
  book: AtomicPricingBook,
  resourceKey: string,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): AtomicPricingBook {
  return {
    ...book,
    resource_edges: [],
    offers: book.offers.map((offer) => ({
      ...offer,
      enrollment: [],
      terms: offer.terms.map((term) => bindResourceTerm(resourceKey, term, input, inputIndex)),
      relations: [],
      settlement: [],
    })),
  };
}

function bindResourceTerm(
  resourceKey: string,
  term: AtomicPricingTerm,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): AtomicPricingTerm {
  if (term.kind !== "rate") return term;
  return {
    ...term,
    variants: term.variants.map((variant) => {
      const binding = resourceBinding(resourceKey, term.meter, variant, input, inputIndex);
      return binding === undefined ? variant : { ...variant, charge_binding: binding };
    }),
  };
}

function resourceBinding(
  resourceKey: string,
  meter: PriceMeter,
  variant: AtomicRateVariant,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): ChargeBinding | undefined {
  if (resourceKey === "image-generation" && meter.value === "image_generation") {
    const signal = standardSignal("generated_items");
    return quantityBinding(
      signal,
      "request",
      directMethods(signal, ["service.image_generation.generated_images"], inputIndex),
      variant,
    );
  }
  if (resourceKey === "code-execution" && isStandardUnit(variant.price.per, "request"))
    return providerResourceBinding(
      input,
      inputIndex,
      variant,
      "completed_code_executions",
      "Completed Mistral code_interpreter executions",
      ["service.code_interpreter.completed_calls"],
    );
  if (resourceKey === "web-search" && isStandardUnit(variant.price.per, "request"))
    return providerResourceBinding(
      input,
      inputIndex,
      variant,
      "completed_web_searches",
      "Completed Mistral web_search executions",
      ["service.web_search.completed_calls"],
    );
  if (resourceKey === "premium-news" && isStandardUnit(variant.price.per, "request"))
    return providerResourceBinding(
      input,
      inputIndex,
      variant,
      "completed_premium_news_searches",
      "Completed Mistral web_search_premium executions",
      [],
    );
  if (resourceKey === "library-retrieval" && isStandardUnit(variant.price.per, "request"))
    return providerResourceBinding(
      input,
      inputIndex,
      variant,
      "completed_document_library_calls",
      "Completed Mistral document_library calls",
      ["service.document_library.completed_calls"],
    );
}

function providerResourceBinding(
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
  variant: AtomicRateVariant,
  key: string,
  definition: string,
  inputKeys: readonly string[],
): ChargeBinding {
  const signal = providerSignal(input, key, definition, variant.price.per);
  return quantityBinding(signal, "request", directMethods(signal, inputKeys, inputIndex), variant);
}

function providerSignal(
  input: AtomicProviderPricing,
  key: string,
  definition: string,
  unit: UnitExpression,
): Extract<UsageSignal, { namespace: "provider" }> {
  addAtom(input, { kind: "usage_signal", key, definition, unit, resolution_phase: "outcome" });
  return { namespace: "provider", provider_id: input.provider_id, value: key };
}

function standardSignal(
  value:
    | "cached_input_tokens"
    | "generated_items"
    | "input_characters"
    | "input_tokens"
    | "output_tokens"
    | "processed_audio_seconds"
    | "processed_pages"
    | "uncached_input_tokens",
): Extract<UsageSignal, { namespace: "kmodels" }> {
  return { namespace: "kmodels", value };
}

function quantityBinding(
  signal: UsageSignal,
  aggregation: ChargeBinding["aggregation"],
  mapped: MethodsAndFacts,
  variant: AtomicRateVariant,
): ChargeBinding {
  return {
    signal,
    aggregation,
    ...(mapped.methods.length === 0 ? {} : { quantity_methods: mapped.methods }),
    observations: unique([
      rawEvidence(variant.observation),
      ...mapped.facts.map(pricingInputObservation),
    ]),
  };
}

function endpointPaths(model: PublishedPricingModel | undefined): ReadonlySet<string> {
  return new Set(model?.api_endpoints?.map(({ path }) => path) ?? []);
}

function normalized(
  observation: AtomicRateVariant["observation"],
  applicability: PriceApplicability,
): NormalizedPriceObservation {
  return { ...rawEvidence(observation), establishes_applicability: applicability };
}
