import { canonicalJson } from "./canonical-json.ts";
import { uniqueCanonicalValues as uniqueCanonical } from "./canonical-value.ts";
import type {
  AtomicPricingBook,
  AtomicPricingOffer,
  AtomicPricingTerm,
  AtomicProviderPricing,
  AtomicRateVariant,
  AtomicRawVariant,
} from "./pricing-assembly.ts";
import { canonicalizeApplicability } from "./pricing-canonical.ts";
import {
  addAtom,
  isStandardUnit,
  rawEvidence,
  standardSignal,
  withApplicability,
} from "./pricing-commercial-assembly.ts";
import {
  directQuantityMethods as directMethods,
  emptyQuantityMethods as emptyMethods,
  includePricingInputSourceRefs,
  indexPricingInputs,
  mergeQuantityMethods as mergeMethods,
  pricingInputFacts,
  pricingInputObservation,
  usageInputSources,
  type BoundQuantityMethods as MethodsAndFacts,
  type PricingInputIndex,
} from "./pricing-input.ts";
import type {
  ChargeBinding,
  PriceApplicability,
  PriceCategoricalValue,
  PriceCondition,
  PriceDimension,
  PriceMeter,
  PriceSelectorSource,
  UnitExpression,
  UsageQuantityMethod,
  UsageSignal,
} from "./pricing-schema.ts";
import type { SourcePricingInputFact } from "./pricing-source.ts";

type Mechanism = "sync" | "batch";
type TokenPart =
  | "input_text"
  | "input_image"
  | "input_video"
  | "input_audio"
  | "output_text"
  | "output_audio";
type TokenParts = readonly [TokenPart, ...TokenPart[]];

const tokenUnit = unit("token");
const secondUnit = unit("second");
const eventUnit = unit("event");

const inputTextKeys = [
  "chat.input_text_tokens",
  "chat.stream.input_text_tokens",
  "native.input_text_tokens",
  "native.stream.input_text_tokens",
  "responses.detail.input_text_tokens",
  "responses.stream.detail.input_text_tokens",
];
const inputImageKeys = [
  "chat.input_image_tokens",
  "chat.stream.input_image_tokens",
  "native.input_image_tokens",
  "native.stream.input_image_tokens",
  "responses.detail.input_image_tokens",
  "responses.stream.detail.input_image_tokens",
];
const inputVideoKeys = [
  "chat.input_video_tokens",
  "chat.stream.input_video_tokens",
  "native.input_video_tokens",
  "native.stream.input_video_tokens",
];
const inputAudioKeys = [
  "chat.input_audio_tokens",
  "chat.stream.input_audio_tokens",
  "native.input_audio_tokens",
  "native.stream.input_audio_tokens",
];
const outputTextKeys = [
  "chat.output_text_tokens",
  "chat.stream.output_text_tokens",
  "native.output_text_tokens",
  "native.stream.output_text_tokens",
  "responses.detail.output_text_tokens",
  "responses.stream.detail.output_text_tokens",
];
const outputAudioKeys = [
  "chat.output_audio_tokens",
  "chat.stream.output_audio_tokens",
  "native.output_audio_tokens",
  "native.stream.output_audio_tokens",
  "tts.output_audio_tokens",
];
const tokenPartKeys = new Map<TokenPart, readonly string[]>([
  ["input_text", inputTextKeys],
  ["input_image", inputImageKeys],
  ["input_video", inputVideoKeys],
  ["input_audio", inputAudioKeys],
  ["output_text", outputTextKeys],
  ["output_audio", outputAudioKeys],
]);

export function applyDashscopeCommercialTopology(
  input: AtomicProviderPricing,
  pricingInputs: readonly SourcePricingInputFact[],
): AtomicProviderPricing {
  const inputIndex = indexPricingInputs(pricingInputs);
  return {
    ...input,
    books: input.books.map((book) =>
      includePricingInputSourceRefs(
        book.scope.kind === "models"
          ? splitModelBook(book, input, inputIndex)
          : bindResourceBook(book, input, inputIndex),
      ),
    ),
  };
}

function splitModelBook(
  book: AtomicPricingBook,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): AtomicPricingBook {
  const hasCache = book.offers.some((offer) =>
    offer.terms.some(
      (term) =>
        term.kind === "rate" &&
        term.meter.namespace === "kmodels" &&
        (term.meter.value === "cache_read_text" || term.meter.value === "cache_write_text"),
    ),
  );
  return {
    ...book,
    offers: book.offers.flatMap((offer) => {
      if (offer.offer_key !== "usage") return [{ ...offer, relations: [], settlement: [] }];
      return (["sync", "batch"] as const).flatMap((mechanism) => {
        const partition = partitionOffer(offer, mechanism, hasCache, input, inputIndex);
        return partition === undefined ? [] : [partition];
      });
    }),
    resource_edges: [],
  };
}

function partitionOffer(
  offer: AtomicPricingOffer,
  mechanism: Mechanism,
  hasCache: boolean,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
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
    partitionTerm(term, mechanism, hasCache, input, inputIndex),
  );
  if (states.length === 0 && terms.length === 0) return;
  return {
    ...offer,
    offer_key: mechanism,
    name: mechanism === "batch" ? "Batch inference" : "On-demand inference",
    states,
    terms,
    relations: [],
    settlement: [],
  };
}

function partitionTerm(
  term: AtomicPricingTerm,
  mechanism: Mechanism,
  hasCache: boolean,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
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
      observation: withApplicability(variant.observation, applicability),
    };
    const charge_binding = modelBinding(term.meter, next, mechanism, hasCache, input, inputIndex);
    const selector_sources = selectorSources(next.applicability, mechanism, inputIndex);
    return [
      {
        ...next,
        ...(charge_binding === undefined ? {} : { charge_binding }),
        ...(selector_sources.length === 0 ? {} : { selector_sources }),
      },
    ];
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
  hasCache: boolean,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): ChargeBinding | undefined {
  if (meter.namespace !== "kmodels") return;
  const aggregation: ChargeBinding["aggregation"] =
    mechanism === "batch"
      ? "result_item"
      : meter.value === "image_generation" || meter.value === "video_generation"
        ? "job"
        : "request";

  if (isStandardUnit(variant.price.per, "token")) {
    if (meter.value === "embedding") {
      const modality = categoricalValues(variant.applicability, "modality").map(
        ({ value }) => value,
      );
      if (modality.length === 1 && modality[0] === "text")
        return tokenPartsBinding(["input_text"], aggregation, input, inputIndex, variant);
      if (modality.length === 1 && modality[0] === "image/video")
        return tokenPartsBinding(
          ["input_image", "input_video"],
          aggregation,
          input,
          inputIndex,
          variant,
        );
      const signal = standardSignal("input_tokens");
      return quantityBinding(
        signal,
        aggregation,
        directMethods(signal, syncInputKeys, inputIndex),
        variant,
      );
    }
    const modality = tokenModalityBinding(
      meter.value,
      variant.applicability,
      mechanism,
      input,
      inputIndex,
    );
    if (modality !== undefined)
      return quantityBinding(modality.signal, aggregation, modality.mapped, variant);
    if (meter.value === "input_text") {
      if (mechanism === "batch") {
        const signal = standardSignal("input_tokens");
        return quantityBinding(
          signal,
          aggregation,
          directMethods(signal, batchInputKeys, inputIndex),
          variant,
        );
      }
      const signal = hasCache
        ? standardSignal("uncached_input_tokens")
        : standardSignal("input_tokens");
      const mapped = hasCache
        ? uncachedInputMethods(inputIndex)
        : directMethods(signal, directInputKeys, inputIndex);
      return quantityBinding(signal, aggregation, mapped, variant);
    }
    if (meter.value === "cache_read_text" && mechanism === "sync") {
      const signal = standardSignal("cached_input_tokens");
      return quantityBinding(
        signal,
        aggregation,
        directMethods(signal, cachedKeys, inputIndex),
        variant,
      );
    }
    if (meter.value === "cache_write_text" && mechanism === "sync") {
      const signal = standardSignal("cache_write_tokens");
      return quantityBinding(
        signal,
        aggregation,
        directMethods(signal, cacheWriteKeys, inputIndex),
        variant,
      );
    }
    if (meter.value === "output_text") {
      const signal = standardSignal("output_tokens");
      return quantityBinding(
        signal,
        aggregation,
        directMethods(signal, mechanism === "batch" ? batchOutputKeys : syncOutputKeys, inputIndex),
        variant,
      );
    }
  }

  if (meter.value === "input_text" && isStandardUnit(variant.price.per, "character")) {
    const signal = standardSignal("input_characters");
    return quantityBinding(
      signal,
      aggregation,
      directMethods(signal, ["tts.input_characters"], inputIndex),
      variant,
    );
  }
  if (meter.value === "input_audio" && isStandardUnit(variant.price.per, "second")) {
    const signal = standardSignal("processed_audio_seconds");
    return quantityBinding(
      signal,
      "job",
      directMethods(
        signal,
        ["asr.processed_audio_seconds", "asr.stream.processed_audio_seconds"],
        inputIndex,
      ),
      variant,
    );
  }
  if (meter.value === "output_audio" && isStandardUnit(variant.price.per, "second")) {
    const signal = standardSignal("generated_seconds");
    return quantityBinding(
      signal,
      "job",
      directMethods(signal, ["music.generated_seconds"], inputIndex),
      variant,
    );
  }
  if (meter.value === "image_generation" && isStandardUnit(variant.price.per, "image")) {
    const signal = standardSignal("generated_images");
    return quantityBinding(
      signal,
      "job",
      directMethods(signal, ["image.generated_images"], inputIndex),
      variant,
    );
  }
  if (meter.value === "input_video" && isStandardUnit(variant.price.per, "second")) {
    const signal = providerSignal(
      input,
      "input_video_seconds",
      "Provider-reported input video duration used by a DashScope media job",
      secondUnit,
      "outcome",
    );
    return quantityBinding(
      signal,
      "job",
      directMethods(signal, ["video.input_seconds"], inputIndex),
      variant,
    );
  }
  if (meter.value === "video_generation" && isStandardUnit(variant.price.per, "second")) {
    const signal = providerSignal(
      input,
      "billable_video_seconds",
      "Provider-reported video duration to which a DashScope generation rate applies",
      secondUnit,
      "outcome",
    );
    return quantityBinding(
      signal,
      "job",
      directMethods(signal, ["video.billable_seconds", "video.output_seconds"], inputIndex),
      variant,
    );
  }
}

function tokenModalityBinding(
  meter: string,
  applicability: PriceApplicability,
  mechanism: Mechanism,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): { signal: UsageSignal; mapped: MethodsAndFacts } | undefined {
  if (mechanism === "batch") return;
  if (meter === "input_audio") return tokenParts(["input_audio"], input, inputIndex);
  if (meter === "input_video") return tokenParts(["input_video"], input, inputIndex);
  if (meter === "output_audio") return tokenParts(["output_audio"], input, inputIndex);
  const modalities = categoricalValues(applicability, "modality").map(({ value }) => value);
  if (meter === "input_image")
    return tokenParts(
      modalities.some((value) => /^image\/video(?:\b|$)/.test(value))
        ? ["input_image", "input_video"]
        : ["input_image"],
      input,
      inputIndex,
    );
  if (meter === "input_text" && modalities.length > 0) {
    const combinations = uniqueCanonical(
      modalities.map((value): TokenParts =>
        /^text\/image\/video(?:\b|$)/.test(value)
          ? ["input_text", "input_image", "input_video"]
          : /^text\/image(?:\b|$)/.test(value)
            ? ["input_text", "input_image"]
            : ["input_text"],
      ),
    );
    const combination = combinations.length === 1 ? combinations[0] : undefined;
    return combination === undefined ? undefined : tokenParts(combination, input, inputIndex);
  }
  return meter === "output_text" && modalities.length > 0
    ? tokenParts(["output_text"], input, inputIndex)
    : undefined;
}

function tokenPartsBinding(
  parts: TokenParts,
  aggregation: ChargeBinding["aggregation"],
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
  variant: AtomicRateVariant,
): ChargeBinding {
  const mapped = tokenParts(parts, input, inputIndex);
  return quantityBinding(mapped.signal, aggregation, mapped.mapped, variant);
}

function tokenParts(
  parts: TokenParts,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): { signal: UsageSignal; mapped: MethodsAndFacts } {
  const specifications = parts.map((part) => tokenPart(part, input));
  if (specifications.length === 1) {
    const value = specifications[0];
    if (value !== undefined)
      return { signal: value.signal, mapped: directMethods(value.signal, value.keys, inputIndex) };
  }
  const direction = parts.every((part) => part.startsWith("output_")) ? "output" : "input";
  const modalities = parts.map((part) => part.replace(/^(?:input|output)_/, ""));
  const signal = providerSignal(
    input,
    `${direction}_${modalities.join("_")}_tokens`,
    `Sum of DashScope ${direction} ${modalities.join(" and ")} tokens`,
    tokenUnit,
    "outcome",
  );
  return {
    signal,
    mapped: sumMethod(
      specifications.map(({ signal: partSignal, keys }) => ({ signal: partSignal, keys })),
      inputIndex,
    ),
  };
}

function tokenPart(
  part: TokenPart,
  input: AtomicProviderPricing,
): { signal: UsageSignal; keys: readonly string[] } {
  const keys = tokenPartKeys.get(part);
  if (keys === undefined) throw new Error(`Unsupported DashScope token part ${part}`);
  return {
    signal: providerSignal(
      input,
      `${part}_tokens`,
      `DashScope ${part.replace("_", " ")} tokens`,
      tokenUnit,
      "outcome",
    ),
    keys,
  };
}

const syncInputKeys = [
  "chat.input_tokens",
  "chat.stream.input_tokens",
  "native.input_tokens",
  "native.stream.input_tokens",
  "responses.input_tokens",
  "responses.stream.input_tokens",
  "responses.detail.input_tokens",
  "responses.stream.detail.input_tokens",
];
const anthropicInputKeys = ["anthropic.input_tokens", "anthropic.stream.input_tokens"];
const directInputKeys = [...syncInputKeys, ...anthropicInputKeys];
const syncOutputKeys = [
  "chat.output_tokens",
  "chat.stream.output_tokens",
  "native.output_tokens",
  "native.stream.output_tokens",
  "responses.output_tokens",
  "responses.stream.output_tokens",
  "responses.detail.output_tokens",
  "responses.stream.detail.output_tokens",
  "anthropic.output_tokens",
  "anthropic.stream.output_tokens",
];
const cachedKeys = [
  "chat.cached_input_tokens",
  "chat.stream.cached_input_tokens",
  "native.cached_input_tokens",
  "native.stream.cached_input_tokens",
  "responses.cached_input_tokens",
  "responses.stream.cached_input_tokens",
  "responses.session_cached_input_tokens",
  "responses.stream.session_cached_input_tokens",
  "anthropic.cached_input_tokens",
  "anthropic.stream.cached_input_tokens",
];
const cacheWriteKeys = [
  "chat.cache_creation_input_tokens",
  "chat.stream.cache_creation_input_tokens",
  "native.cache_creation_input_tokens",
  "native.stream.cache_creation_input_tokens",
  "responses.session_cache_creation_input_tokens",
  "responses.stream.session_cache_creation_input_tokens",
  "anthropic.cache_creation_input_tokens",
  "anthropic.stream.cache_creation_input_tokens",
];
const batchInputKeys = ["batch.chat.input_tokens", "batch.responses.input_tokens"];
const batchOutputKeys = ["batch.chat.output_tokens", "batch.responses.output_tokens"];

function uncachedInputMethods(inputIndex: PricingInputIndex): MethodsAndFacts {
  return mergeMethods([
    directMethods(standardSignal("uncached_input_tokens"), anthropicInputKeys, inputIndex),
    subtractionMethod(
      standardSignal("input_tokens"),
      ["chat.input_tokens", "chat.stream.input_tokens"],
      [
        {
          signal: standardSignal("cached_input_tokens"),
          keys: ["chat.cached_input_tokens", "chat.stream.cached_input_tokens"],
        },
        {
          signal: standardSignal("cache_write_tokens"),
          keys: ["chat.cache_creation_input_tokens", "chat.stream.cache_creation_input_tokens"],
        },
      ],
      inputIndex,
    ),
    subtractionMethod(
      standardSignal("input_tokens"),
      ["responses.input_tokens", "responses.stream.input_tokens"],
      [
        {
          signal: standardSignal("cached_input_tokens"),
          keys: ["responses.cached_input_tokens", "responses.stream.cached_input_tokens"],
        },
      ],
      inputIndex,
    ),
    subtractionMethod(
      standardSignal("input_tokens"),
      ["responses.input_tokens", "responses.stream.input_tokens"],
      [
        {
          signal: standardSignal("cached_input_tokens"),
          keys: [
            "responses.session_cached_input_tokens",
            "responses.stream.session_cached_input_tokens",
          ],
        },
        {
          signal: standardSignal("cache_write_tokens"),
          keys: [
            "responses.session_cache_creation_input_tokens",
            "responses.stream.session_cache_creation_input_tokens",
          ],
        },
      ],
      inputIndex,
    ),
    subtractionMethod(
      standardSignal("input_tokens"),
      ["native.input_tokens", "native.stream.input_tokens"],
      [
        {
          signal: standardSignal("cached_input_tokens"),
          keys: ["native.cached_input_tokens", "native.stream.cached_input_tokens"],
        },
        {
          signal: standardSignal("cache_write_tokens"),
          keys: ["native.cache_creation_input_tokens", "native.stream.cache_creation_input_tokens"],
        },
      ],
      inputIndex,
    ),
  ]);
}

function subtractionMethod(
  totalSignal: UsageSignal,
  totalKeys: readonly string[],
  exclusions: ReadonlyArray<{ signal: UsageSignal; keys: readonly string[] }>,
  inputIndex: PricingInputIndex,
): MethodsAndFacts {
  const total = pricingInputFacts(inputIndex, totalKeys);
  const excluded = exclusions.map(({ signal, keys }) => ({
    signal,
    facts: pricingInputFacts(inputIndex, keys),
  }));
  if (total.length === 0 || excluded.some(({ facts }) => facts.length === 0)) return emptyMethods();
  const nodes: NonNullable<UsageQuantityMethod["calculation"]>["nodes"] = [
    { op: "signal", signal: totalSignal },
    ...excluded.map(({ signal }) => ({ op: "signal" as const, signal })),
  ];
  const excludedIndex =
    excluded.length === 1
      ? 1
      : nodes.push({
          op: "sum",
          inputs: excluded.map((_value, index) => index + 1),
        }) - 1;
  nodes.push({ op: "subtract_floor_zero", minuend: 0, subtrahend: excludedIndex });
  const facts = [...total, ...excluded.flatMap(({ facts: values }) => values)];
  return {
    methods: [
      {
        calculation: { nodes, result: nodes.length - 1 },
        input_sources: uniqueCanonical([
          ...usageInputSources(totalSignal, total),
          ...excluded.flatMap(({ signal, facts: values }) => usageInputSources(signal, values)),
        ]),
      },
    ],
    facts,
  };
}

function bindResourceBook(
  book: AtomicPricingBook,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): AtomicPricingBook {
  if (book.scope.kind !== "provider_resource") return { ...book, resource_edges: [] };
  const resourceKey = book.scope.resource_key;
  return {
    ...book,
    offers: book.offers.map((offer) => ({
      ...offer,
      terms: offer.terms.map((term) => {
        if (term.kind !== "rate") return term;
        return {
          ...term,
          variants: term.variants.map((variant) => {
            const charge_binding = resourceBinding(
              resourceKey,
              term.meter,
              variant,
              input,
              inputIndex,
            );
            const selector_sources = selectorSources(variant.applicability, "sync", inputIndex);
            return {
              ...variant,
              ...(charge_binding === undefined ? {} : { charge_binding }),
              ...(selector_sources.length === 0 ? {} : { selector_sources }),
            };
          }),
        };
      }),
      relations: [],
      settlement: [],
    })),
    resource_edges: [],
  };
}

function resourceBinding(
  resourceKey: string,
  meter: PriceMeter,
  variant: AtomicRateVariant,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): ChargeBinding | undefined {
  if (meter.namespace !== "kmodels") return;
  if (resourceKey === "web-search" && meter.value === "web_search") {
    const signal = standardSignal("successful_web_searches");
    return quantityBinding(
      signal,
      "request",
      directMethods(
        signal,
        [
          "native.web_search_count",
          "responses.web_search_count",
          "responses.stream.web_search_count",
        ],
        inputIndex,
      ),
      variant,
    );
  }
  if (meter.value !== "image_search") return;
  const search =
    resourceKey === "image-search"
      ? {
          key: "successful_image_searches",
          definition: "Successful billable DashScope image-to-image search calls",
          inputs: ["responses.image_search_count", "responses.stream.image_search_count"],
        }
      : resourceKey === "text-to-image-search"
        ? {
            key: "successful_web_search_image_calls",
            definition: "Successful billable DashScope text-to-image search calls",
            inputs: ["responses.web_search_image_count", "responses.stream.web_search_image_count"],
          }
        : undefined;
  if (search !== undefined) {
    const signal = providerSignal(input, search.key, search.definition, eventUnit, "outcome");
    return quantityBinding(
      signal,
      "request",
      directMethods(signal, search.inputs, inputIndex),
      variant,
    );
  }
}

function selectorSources(
  applicability: PriceApplicability,
  mechanism: Mechanism,
  inputIndex: PricingInputIndex,
): PriceSelectorSource[] {
  const dimensions = new Map<string, PriceDimension>();
  for (const { all_of } of applicability.any_of)
    for (const { dimension } of all_of) dimensions.set(canonicalJson(dimension), dimension);
  const result: PriceSelectorSource[] = [];
  for (const dimension of dimensions.values()) {
    if (dimension.namespace !== "kmodels") continue;
    const keys = selectorKeys(dimension.value, mechanism, applicability);
    for (const fact of pricingInputFacts(inputIndex, keys)) {
      const normalization = selectorNormalization(dimension, applicability);
      result.push({
        dimension,
        channel: fact.channel,
        locator: fact.locator,
        availability: fact.availability,
        ...(normalization === undefined ? {} : { normalization }),
        observations: [pricingInputObservation(fact)],
      });
    }
  }
  return uniqueCanonical(result);
}

function selectorKeys(
  dimension: string,
  mechanism: Mechanism,
  applicability: PriceApplicability,
): string[] {
  if (dimension === "region") return ["request.resolved_region"];
  if (dimension === "context_tokens") return mechanism === "batch" ? batchInputKeys : syncInputKeys;
  if (dimension === "resolution")
    return ["image.effective_size", "video.effective_resolution", "video.effective_size"];
  if (dimension !== "operation") return [];
  const values = categoricalValues(applicability, dimension).map(({ value }) => value);
  return [
    ...(values.some(
      (value) => /thinking/.test(value) && value !== "non_thinking_and_thinking_modes",
    )
      ? mechanism === "batch"
        ? ["batch.enable_thinking"]
        : ["chat.enable_thinking", "native.enable_thinking"]
      : []),
    ...(values.some((value) => value.startsWith("prompt_extend=")) ? ["native.prompt_extend"] : []),
  ];
}

function selectorNormalization(
  dimension: PriceDimension,
  applicability: PriceApplicability,
): PriceSelectorSource["normalization"] | undefined {
  if (dimension.namespace !== "kmodels") return;
  const values = categoricalValues(applicability, dimension.value);
  const entries: Array<{ source_value: string; value: PriceCategoricalValue }> = [];
  if (dimension.value === "operation") {
    for (const value of values) {
      if (/^prompt_extend=(?:true|false)$/.test(value.value))
        entries.push({ source_value: value.value.endsWith("true") ? "true" : "false", value });
      else if (value.value.startsWith("thinking_mode"))
        entries.push({ source_value: "true", value });
      else if (/^non_thinking_mode(?:_only)?$/.test(value.value))
        entries.push({ source_value: "false", value });
    }
  } else if (dimension.value === "resolution") {
    for (const value of values) {
      entries.push({ source_value: value.value, value });
      const lower = value.value.toLowerCase();
      if (lower !== value.value) entries.push({ source_value: lower, value });
    }
  }
  return entries.length === 0
    ? undefined
    : { kind: "categorical_map", entries: uniqueCanonical(entries) };
}

function categoricalValues(
  applicability: PriceApplicability,
  dimension: string,
): PriceCategoricalValue[] {
  return uniqueCanonical(
    applicability.any_of.flatMap(({ all_of }) =>
      all_of.flatMap((condition) =>
        condition.kind === "categorical" &&
        condition.dimension.namespace === "kmodels" &&
        condition.dimension.value === dimension
          ? condition.values
          : [],
      ),
    ),
  );
}

function sumMethod(
  requirements: ReadonlyArray<{ signal: UsageSignal; keys: readonly string[] }>,
  inputIndex: PricingInputIndex,
): MethodsAndFacts {
  const mapped = requirements.map(({ signal, keys }) => ({
    signal,
    facts: pricingInputFacts(inputIndex, keys),
  }));
  if (mapped.some(({ facts }) => facts.length === 0)) return emptyMethods();
  const facts = mapped.flatMap(({ facts: values }) => values);
  return {
    methods: [
      {
        calculation: {
          nodes: [
            ...mapped.map(({ signal }) => ({ op: "signal" as const, signal })),
            { op: "sum", inputs: mapped.map((_value, index) => index) },
          ],
          result: mapped.length,
        },
        input_sources: uniqueCanonical(
          mapped.flatMap(({ signal, facts: values }) => usageInputSources(signal, values)),
        ),
      },
    ],
    facts,
  };
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
    observations: uniqueCanonical([
      rawEvidence(variant.observation),
      ...mapped.facts.map(pricingInputObservation),
    ]),
  };
}

function providerSignal(
  input: AtomicProviderPricing,
  key: string,
  definition: string,
  signalUnit: UnitExpression,
  resolutionPhase: "request" | "outcome",
): Extract<UsageSignal, { namespace: "provider" }> {
  addAtom(input, {
    kind: "usage_signal",
    key,
    definition,
    unit: signalUnit,
    resolution_phase: resolutionPhase,
  });
  return { namespace: "provider", provider_id: input.provider_id, value: key };
}

function unit(value: "event" | "second" | "token"): UnitExpression {
  return { factors: [{ unit: { namespace: "kmodels", value }, power: 1 }] };
}
