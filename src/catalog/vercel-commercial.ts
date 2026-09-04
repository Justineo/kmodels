import { canonicalJson } from "./canonical-json.ts";
import { compareCanonicalValues } from "./canonical-value.ts";
import type {
  AtomicPricingBook,
  AtomicPricingOffer,
  AtomicPricingTerm,
  AtomicProviderPricing,
  AtomicRateVariant,
} from "./pricing-assembly.ts";
import {
  addAtom,
  isStandardUnit,
  rawEvidence,
  standardSignal,
} from "./pricing-commercial-assembly.ts";
import {
  directQuantityMethods as directMethods,
  emptyQuantityMethods as emptyMethods,
  includePricingInputSourceRefs,
  indexPricingInputs,
  pricingInputFacts,
  pricingInputObservation,
  uniquePricingInputFacts,
  usageInputSources,
  type BoundQuantityMethods as MethodsAndFacts,
  type PricingInputIndex,
} from "./pricing-input.ts";
import type {
  ChargeBinding,
  PriceApplicability,
  PriceCategoricalValue,
  PriceDimension,
  PriceMeter,
  PriceSelectorSource,
  UnitExpression,
  UsageQuantityMethod,
  UsageSignal,
} from "./pricing-schema.ts";
import type { SourcePricingInputFact } from "./pricing-source.ts";

interface NativeOffer {
  modelRefs: string[];
  sourceBook: AtomicPricingBook;
  sourceOffer: AtomicPricingOffer;
  kind: "web-search" | "maps-search";
  terms: AtomicPricingTerm[];
}

const itemUnit = unit("item");

export function applyVercelCommercialTopology(
  input: AtomicProviderPricing,
  pricingInputs: readonly SourcePricingInputFact[],
): AtomicProviderPricing {
  const inputIndex = indexPricingInputs(uniquePricingInputFacts(pricingInputs));
  const native: NativeOffer[] = [];
  const books = input.books.map((book) =>
    book.scope.kind === "models"
      ? modelBook(book, native, input, inputIndex)
      : bindResourceBook(book, input, inputIndex),
  );
  books.push(...nativeBooks(native, input, inputIndex));
  return { ...input, books: books.map(includePricingInputSourceRefs) };
}

function modelBook(
  book: AtomicPricingBook,
  native: NativeOffer[],
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): AtomicPricingBook {
  const modelRefs = book.scope.kind === "models" ? book.scope.model_refs : [];
  const offers = book.offers.map((offer) => {
    if (offer.offer_key !== "usage") return offer;
    for (const kind of ["web-search", "maps-search"] as const) {
      const terms = offer.terms.filter((term) => serviceKind(term) === kind);
      if (terms.length > 0)
        native.push({ modelRefs, sourceBook: book, sourceOffer: offer, kind, terms });
    }
    const terms = offer.terms.filter((term) => serviceKind(term) === undefined);
    return {
      ...offer,
      name: "AI Gateway inference",
      states: statesForTerms(offer, terms),
      terms: terms.map((term) => bindModelTerm(term, terms, input, inputIndex)),
      relations: [],
      enrollment: [],
      settlement: [],
    };
  });
  return { ...book, offers };
}

function serviceKind(term: AtomicPricingTerm): NativeOffer["kind"] | undefined {
  if (term.kind === "rate" && term.meter.namespace === "kmodels") {
    if (term.meter.value === "web_search") return "web-search";
    if (term.meter.value === "maps_search") return "maps-search";
  }
  if (term.kind !== "raw") return;
  if (term.term_key.includes("web_search")) return "web-search";
  if (term.term_key.includes("maps_search")) return "maps-search";
}

function statesForTerms(
  source: AtomicPricingOffer,
  terms: readonly AtomicPricingTerm[],
): AtomicPricingOffer["states"] {
  return [
    ...source.states.filter(({ state }) => state !== "numeric"),
    ...terms.flatMap((term) =>
      term.kind === "raw"
        ? []
        : term.variants.map((variant) => {
            const { formula: _, ...raw } = variant.observation.raw;
            return {
              state: "numeric" as const,
              applicability: variant.applicability,
              ...(variant.validity === undefined ? {} : { validity: variant.validity }),
              observation: {
                ...variant.observation,
                raw,
                establishes_applicability: variant.applicability,
              },
            };
          }),
    ),
  ];
}

function bindModelTerm(
  term: AtomicPricingTerm,
  terms: readonly AtomicPricingTerm[],
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): AtomicPricingTerm {
  if (term.kind !== "rate") return term;
  return {
    ...term,
    variants: term.variants.map((variant) => {
      const charge_binding = modelBinding(term.meter, variant, terms, input, inputIndex);
      const selector_sources = selectorSources(variant.applicability, inputIndex);
      return {
        ...variant,
        ...(charge_binding === undefined ? {} : { charge_binding }),
        ...(selector_sources.length === 0 ? {} : { selector_sources }),
      };
    }),
  };
}

function modelBinding(
  meter: PriceMeter,
  variant: AtomicRateVariant,
  terms: readonly AtomicPricingTerm[],
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): ChargeBinding | undefined {
  if (meter.namespace === "kmodels" && isStandardUnit(variant.price.per, "token")) {
    const signal = tokenSignal(meter.value, input, variant.price.per);
    if (signal === undefined) return;
    const mapped = tokenMethods(meter.value, signal, terms, inputIndex);
    return quantityBinding(signal, "attempt", mapped, variant);
  }
  if (meter.namespace === "kmodels" && meter.value === "input_text") {
    if (!isStandardUnit(variant.price.per, "character")) return;
    return quantityBinding(standardSignal("input_characters"), "attempt", emptyMethods(), variant);
  }
  if (meter.namespace === "kmodels" && meter.value === "input_audio") {
    if (!isStandardUnit(variant.price.per, "second")) return;
    const signal = standardSignal("processed_audio_seconds");
    return quantityBinding(
      signal,
      "attempt",
      directMethods(signal, ["transcription.input_audio_seconds"], inputIndex),
      variant,
    );
  }
  if (meter.namespace === "kmodels" && meter.value === "image_generation") {
    if (isStandardUnit(variant.price.per, "image")) {
      const signal = standardSignal("generated_images");
      return quantityBinding(
        signal,
        "attempt",
        directMethods(signal, ["image.generated_images"], inputIndex),
        variant,
      );
    }
    if (isStandardUnit(variant.price.per, "pixel")) {
      const signal = providerSignal(
        input,
        "generated_image_pixels",
        "Billable generated image pixels",
        variant.price.per,
        "outcome",
      );
      return quantityBinding(signal, "attempt", emptyMethods(), variant);
    }
    return;
  }
  if (meter.namespace === "kmodels" && meter.value === "video_generation") {
    if (!isStandardUnit(variant.price.per, "second")) return;
    const signal = standardSignal("generated_seconds");
    return quantityBinding(signal, "job", videoDurationMethods(input, inputIndex), variant);
  }
  if (meter.namespace === "kmodels" && meter.value === "rerank") {
    if (!isStandardUnit(variant.price.per, "request")) return;
    const signal = standardSignal("accepted_requests");
    return quantityBinding(
      signal,
      "request",
      directMethods(signal, ["rerank.successful_request"], inputIndex),
      variant,
    );
  }
  if (meter.namespace === "kmodels" && meter.value === "session_runtime") {
    if (!isStandardUnit(variant.price.per, "second")) return;
    return quantityBinding(standardSignal("active_seconds"), "session", emptyMethods(), variant);
  }
  if (
    meter.namespace === "provider" &&
    meter.provider_id === input.provider_id &&
    meter.value === "realtime_client_message" &&
    isStandardUnit(variant.price.per, "request")
  ) {
    const signal = providerSignal(
      input,
      "realtime_client_messages",
      "Billable realtime client messages",
      variant.price.per,
      "outcome",
    );
    return quantityBinding(signal, "session", emptyMethods(), variant);
  }
}

function tokenSignal(
  meter: PriceMeter["value"],
  input: AtomicProviderPricing,
  signalUnit: UnitExpression,
): UsageSignal | undefined {
  if (meter === "input_text") return standardSignal("uncached_input_tokens");
  if (meter === "embedding") return standardSignal("input_tokens");
  if (meter === "cache_read_text") return standardSignal("cached_input_tokens");
  if (meter === "cache_write_text") return standardSignal("cache_write_tokens");
  if (meter === "output_text") return standardSignal("output_tokens");
  if (
    ["input_audio", "input_image", "output_audio", "output_image", "video_generation"].includes(
      meter,
    )
  )
    return providerSignal(
      input,
      `billable_${meter}_tokens`,
      `Billable ${meter.replaceAll("_", " ")} tokens`,
      signalUnit,
      "outcome",
    );
}

function tokenMethods(
  meter: PriceMeter["value"],
  signal: UsageSignal,
  terms: readonly AtomicPricingTerm[],
  inputIndex: PricingInputIndex,
): MethodsAndFacts {
  if (meter === "cache_read_text")
    return directMethods(signal, ["generation.native_cached_tokens"], inputIndex);
  if (meter === "cache_write_text")
    return directMethods(signal, ["generation.native_cache_creation_tokens"], inputIndex);
  if (!["input_text", "embedding", "output_text"].includes(meter)) return emptyMethods();
  const inputMeters = tokenMeters(terms).filter((value) =>
    ["input_text", "embedding", "input_audio", "input_image"].includes(value),
  );
  const outputMeters = tokenMeters(terms).filter((value) =>
    ["output_text", "output_audio", "output_image"].includes(value),
  );
  if (["input_text", "embedding", "input_audio", "input_image"].includes(meter)) {
    if (
      inputMeters.length !== 1 ||
      (meter === "input_text" &&
        tokenMeters(terms).some((value) => ["cache_read_text", "cache_write_text"].includes(value)))
    )
      return emptyMethods();
    return directMethods(signal, ["generation.native_prompt_tokens"], inputIndex);
  }
  if (["output_text", "output_audio", "output_image"].includes(meter))
    return outputMeters.length === 1
      ? directMethods(signal, ["generation.native_completion_tokens"], inputIndex)
      : emptyMethods();
  return emptyMethods();
}

function tokenMeters(terms: readonly AtomicPricingTerm[]): string[] {
  return [
    ...new Set(
      terms.flatMap((term) =>
        term.kind === "rate" &&
        term.meter.namespace === "kmodels" &&
        term.variants.some((variant) => isStandardUnit(variant.price.per, "token"))
          ? [term.meter.value]
          : [],
      ),
    ),
  ];
}

function videoDurationMethods(
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): MethodsAndFacts {
  const durationFacts = pricingInputFacts(inputIndex, ["video.requested_duration_seconds"]);
  const resultFacts = pricingInputFacts(inputIndex, ["video.generated_videos"]);
  if (durationFacts.length === 0 || resultFacts.length === 0) return emptyMethods();
  const duration = providerSignal(
    input,
    "requested_video_seconds",
    "Requested output duration in seconds for one generated video",
    unit("second"),
    "request",
  );
  const items = standardSignal("generated_items");
  return {
    methods: [
      {
        calculation: {
          nodes: [
            { op: "signal", signal: duration },
            { op: "signal", signal: items },
            { op: "product", inputs: [0, 1] },
          ],
          result: 2,
        },
        input_sources: [
          ...usageInputSources(duration, durationFacts),
          ...usageInputSources(items, resultFacts),
        ].sort(compareCanonicalValues),
      },
    ],
    facts: uniquePricingInputFacts([...durationFacts, ...resultFacts]),
  };
}

function nativeBooks(
  offers: readonly NativeOffer[],
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): AtomicPricingBook[] {
  return (["web-search", "maps-search"] as const).flatMap((kind) => {
    const selected = offers.filter((offer) => offer.kind === kind);
    if (selected.length === 0) return [];
    const modelRefs = unique(selected.flatMap(({ modelRefs: refs }) => refs));
    const sourceRefs = unique(selected.flatMap(({ sourceBook }) => sourceBook.source_refs));
    const scope = {
      kind: "provider_resource" as const,
      resource_kind: { namespace: "kmodels" as const, value: "service" as const },
      resource_key: `native-${kind}`,
      model_refs: modelRefs,
    };
    return [
      {
        book_key: `service:native-${kind}`,
        name: kind === "web-search" ? "Provider-native web search" : "Provider-native Maps search",
        scope,
        scope_observations: [
          {
            source_ref: sourceRefs[0]!,
            locator: { kind: "provider_key" as const, value: `resource:native-${kind}` },
            establishes: scope,
            raw: {
              label: kind === "web-search" ? "Native web-search pricing" : "Native Maps pricing",
            },
          },
        ],
        offers: selected.map(({ modelRefs: refs, sourceBook, sourceOffer, terms }) => ({
          offer_key: sourceBook.book_key,
          name: `${kind === "web-search" ? "Web search" : "Maps search"} for ${refs.join(", ")}`,
          ...(refs.length === 0 ? {} : { model_refs: refs }),
          billing_mode: { namespace: "kmodels" as const, value: "usage" as const },
          states: statesForTerms(sourceOffer, terms),
          terms: terms.map((term) => bindNativeServiceTerm(term, kind, input, inputIndex)),
          relations: [],
          enrollment: [],
          settlement: [],
          source_refs: sourceOffer.source_refs,
        })),
        source_refs: sourceRefs,
      },
    ];
  });
}

function bindNativeServiceTerm(
  term: AtomicPricingTerm,
  kind: NativeOffer["kind"],
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): AtomicPricingTerm {
  if (term.kind !== "rate") return term;
  return {
    ...term,
    variants: term.variants.map((variant) => {
      const charge_binding = (() => {
        if (kind !== "web-search" || !isStandardUnit(variant.price.per, "request")) return;
        const signal = providerSignal(
          input,
          "billable_native_web_search_requests",
          "Provider-reported billable native web-search requests",
          unit("request"),
          "outcome",
        );
        return quantityBinding(
          signal,
          "attempt",
          directMethods(signal, ["generation.billable_web_search_calls"], inputIndex),
          variant,
        );
      })();
      const selector_sources = selectorSources(variant.applicability, inputIndex);
      return {
        ...variant,
        ...(charge_binding === undefined ? {} : { charge_binding }),
        ...(selector_sources.length === 0 ? {} : { selector_sources }),
      };
    }),
  };
}

function bindResourceBook(
  book: AtomicPricingBook,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): AtomicPricingBook {
  if (book.scope.kind !== "provider_resource") return book;
  const resourceKey = book.scope.resource_key;
  const merged = mergeSearchComponents(book);
  return {
    ...merged,
    offers: merged.offers.map((offer) => ({
      ...offer,
      terms: offer.terms.map((term) =>
        term.kind === "rate"
          ? {
              ...term,
              variants: term.variants.map((variant) => {
                const charge_binding = resourceBinding(resourceKey, variant, input, inputIndex);
                const selector_sources = selectorSources(variant.applicability, inputIndex);
                return {
                  ...variant,
                  ...(charge_binding === undefined ? {} : { charge_binding }),
                  ...(selector_sources.length === 0 ? {} : { selector_sources }),
                };
              }),
            }
          : term,
      ),
      relations: [],
      enrollment: [],
      settlement: [],
    })),
  };
}

function mergeSearchComponents(book: AtomicPricingBook): AtomicPricingBook {
  if (book.scope.kind !== "provider_resource") return book;
  const resourceKey = book.scope.resource_key;
  if (!["exa-search", "parallel-search", "tako-search"].includes(resourceKey)) return book;
  const search = book.offers.find(({ offer_key: key }) => key === "search");
  if (search === undefined) return book;
  const additionKeys = new Set(["additional-results", "data-export"]);
  const additions = book.offers.filter(({ offer_key: key }) => additionKeys.has(key));
  if (additions.length === 0) return book;
  const merged = {
    ...search,
    terms: [
      ...search.terms,
      ...additions.flatMap((offer) =>
        offer.terms.map((term) => ({
          ...term,
          term_key:
            offer.offer_key === "additional-results"
              ? `${term.term_key}:${
                  resourceKey === "exa-search"
                    ? "additional_requested_results"
                    : "additional_results"
                }`
              : term.term_key,
        })),
      ),
    ],
    source_refs: unique([
      ...search.source_refs,
      ...additions.flatMap(({ source_refs: refs }) => refs),
    ]),
  };
  return {
    ...book,
    offers: [
      merged,
      ...book.offers.filter(({ offer_key: key }) => key !== "search" && !additionKeys.has(key)),
    ],
  };
}

function resourceBinding(
  key: string,
  variant: AtomicRateVariant,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): ChargeBinding | undefined {
  const operation = categorical(variant.applicability, "operation");
  if (
    ["perplexity-search", "exa-search", "tako-search", "parallel-search"].includes(key) &&
    operation === undefined &&
    isStandardUnit(variant.price.per, "request")
  ) {
    const service = key.replace("-search", "");
    const signal = providerSignal(
      input,
      `${service}_successful_search_requests`,
      `Successful billable ${service} search requests`,
      unit("request"),
      "outcome",
    );
    return quantityBinding(
      signal,
      "attempt",
      directMethods(signal, [`search.${service}.successful_calls`], inputIndex),
      variant,
    );
  }
  if (
    ["exa-search", "parallel-search"].includes(key) &&
    ["additional_requested_results", "additional_results"].includes(operation ?? "") &&
    isStandardUnit(variant.price.per, "item")
  )
    return additionalResultBinding(key, variant, input, inputIndex);
}

function additionalResultBinding(
  key: string,
  variant: AtomicRateVariant,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): ChargeBinding {
  const service = key === "exa-search" ? "exa" : "parallel";
  const result = providerSignal(
    input,
    `${service}_additional_requested_results`,
    `Requested ${service} search results above the ten-result included quantity`,
    itemUnit,
    "request",
  );
  const requested = providerSignal(
    input,
    `${service}_requested_results`,
    `Requested maximum ${service} search results`,
    itemUnit,
    "request",
  );
  const facts = pricingInputFacts(inputIndex, [`search.${service}.requested_results`]);
  const methods: UsageQuantityMethod[] = [
    {
      calculation: {
        nodes: [
          { op: "signal", signal: requested },
          { op: "constant", value: { numerator: "10", denominator: "1" }, unit: itemUnit },
          { op: "subtract_floor_zero", minuend: 0, subtrahend: 1 },
        ],
        result: 2,
      },
      ...(facts.length === 0 ? {} : { input_sources: usageInputSources(requested, facts) }),
    },
  ];
  return quantityBinding(result, "request", { methods, facts }, variant);
}

function selectorSources(
  applicability: PriceApplicability,
  inputIndex: PricingInputIndex,
): PriceSelectorSource[] {
  const dimensions = new Map<string, PriceDimension>();
  for (const { all_of } of applicability.any_of)
    for (const { dimension } of all_of) dimensions.set(canonicalJson(dimension), dimension);
  const result: PriceSelectorSource[] = [];
  for (const dimension of dimensions.values()) {
    if (dimension.namespace !== "kmodels") continue;
    const keys =
      dimension.value === "route_provider"
        ? ["generation.route_provider"]
        : dimension.value === "context_tokens"
          ? ["generation.native_prompt_tokens"]
          : dimension.value === "served_service_tier"
            ? ["gateway.served_service_tier"]
            : dimension.value === "speed"
              ? ["gateway.served_speed"]
              : dimension.value === "region"
                ? ["gateway.served_region"]
                : dimension.value === "search_effort"
                  ? ["search.tako.effort"]
                  : [];
    for (const fact of pricingInputFacts(inputIndex, keys)) {
      const absent_value = selectorAbsentValue(fact, dimension, applicability);
      result.push({
        dimension,
        channel: fact.channel,
        locator: fact.locator,
        availability: fact.availability,
        ...(absent_value === undefined ? {} : { absent_value }),
        observations: [pricingInputObservation(fact)],
      });
    }
  }
  return result.sort(compareCanonicalValues);
}

function selectorAbsentValue(
  fact: SourcePricingInputFact,
  dimension: PriceDimension,
  applicability: PriceApplicability,
): PriceCategoricalValue | undefined {
  if (fact.selector_absent_value === undefined) return;
  return applicability.any_of
    .flatMap(({ all_of }) => all_of)
    .flatMap((condition) =>
      condition.kind === "categorical" &&
      canonicalJson(condition.dimension) === canonicalJson(dimension)
        ? condition.values
        : [],
    )
    .find(({ value }) => value === fact.selector_absent_value);
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
    observations: [
      rawEvidence(variant.observation),
      ...mapped.facts.map(pricingInputObservation),
    ].sort(compareCanonicalValues),
  };
}

function providerSignal(
  input: AtomicProviderPricing,
  key: string,
  definition: string,
  signalUnit: UnitExpression,
  resolutionPhase: "request" | "outcome",
): UsageSignal {
  addAtom(input, {
    kind: "usage_signal",
    key,
    definition,
    unit: signalUnit,
    resolution_phase: resolutionPhase,
  });
  return { namespace: "provider", provider_id: input.provider_id, value: key };
}

function categorical(applicability: PriceApplicability, dimension: string): string | undefined {
  const values = new Set(
    applicability.any_of.flatMap(({ all_of }) =>
      all_of.flatMap((condition) =>
        condition.kind === "categorical" &&
        condition.dimension.namespace === "kmodels" &&
        condition.dimension.value === dimension
          ? condition.values.map(({ value }) => value)
          : [],
      ),
    ),
  );
  return values.size === 1 ? [...values][0] : undefined;
}

function unit(
  value: "character" | "image" | "item" | "request" | "second" | "token",
): UnitExpression {
  return { factors: [{ unit: { namespace: "kmodels", value }, power: 1 }] };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
