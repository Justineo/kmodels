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
  subtractQuantityMethods as subtractionMethod,
  sumQuantityMethods as sumMethod,
  type BoundQuantityMethods as MethodsAndFacts,
  type PricingInputIndex,
} from "./pricing-input.ts";
import type {
  ChargeBinding,
  PriceApplicability,
  PriceCondition,
  PriceDimension,
  PriceMeter,
  PriceSelectorSource,
  UnitExpression,
  UsageSignal,
} from "./pricing-schema.ts";
import type { SourcePricingInputFact } from "./pricing-source.ts";
import type { PublishedPricingModel } from "./pricing-adapter.ts";

type Mechanism = "batch" | "direct" | "realtime" | "sync";

const tokenUnit: UnitExpression = {
  factors: [{ unit: { namespace: "kmodels", value: "token" }, power: 1 }],
};
const secondUnit: UnitExpression = {
  factors: [{ unit: { namespace: "kmodels", value: "second" }, power: 1 }],
};
const requestResources = new Set([
  "attachment-search",
  "code-execution",
  "collections-search",
  "image-generation-tool",
  "responses-policy",
  "speech-to-text",
  "text-to-speech",
  "web-search",
  "x-search",
  "x-search-posts",
  "x-search-profiles",
]);

export function applyXaiCommercialTopology(
  input: AtomicProviderPricing,
  publishedModels: readonly PublishedPricingModel[],
  pricingInputs: readonly SourcePricingInputFact[],
): AtomicProviderPricing {
  const published = new Map(publishedModels.map((model) => [model.uid, model]));
  const inputIndex = indexPricingInputs(pricingInputs);
  const books = input.books.flatMap((book) => {
    if (book.scope.kind !== "models")
      return book.scope.kind === "provider_resource" &&
        requestResources.has(book.scope.resource_key)
        ? [includePricingInputSourceRefs(resourceBook(book, input, inputIndex))]
        : [];
    return [
      includePricingInputSourceRefs(
        modelBook(book, published.get(book.scope.model_refs[0] ?? ""), input, inputIndex),
      ),
    ];
  });
  input.vocabulary.atoms = input.vocabulary.atoms.flatMap((atom) => {
    if (
      atom.kind !== "categorical_value" ||
      atom.dimension.namespace !== "kmodels" ||
      atom.dimension.value !== "service_tier"
    )
      return [atom];
    if (atom.key === "batch") return [];
    return [{ ...atom, dimension: { namespace: "kmodels", value: "served_service_tier" } }];
  });
  return { ...input, books };
}

function modelBook(
  book: AtomicPricingBook,
  model: PublishedPricingModel | undefined,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): AtomicPricingBook {
  const mechanisms = modelMechanisms(model);
  return {
    ...book,
    offers: book.offers.flatMap((offer) =>
      offer.offer_key !== "usage"
        ? [{ ...offer, settlement: [] }]
        : mechanisms.flatMap((mechanism) => {
            const next = modelOffer(offer, mechanism, model, input, inputIndex);
            return next.states.length + next.terms.length === 0 ? [] : [next];
          }),
    ),
  };
}

function modelMechanisms(model: PublishedPricingModel | undefined): Mechanism[] {
  if (model?.tasks.includes("speech_to_speech")) return ["realtime"];
  if (model?.tasks.some((task) => task === "image_generation" || task === "video_generation"))
    return ["direct", "batch"];
  if (model?.tasks.includes("text_generation")) return ["sync", "batch"];
  return ["sync"];
}

function modelOffer(
  offer: AtomicPricingOffer,
  mechanism: Mechanism,
  model: PublishedPricingModel | undefined,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): AtomicPricingOffer {
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
  const terms = offer.terms.flatMap((term) => modelTerm(term, mechanism, model, input, inputIndex));
  return {
    ...offer,
    offer_key: mechanism,
    name: mechanismName(mechanism),
    states,
    terms,
    relations: [],
    settlement: [],
  };
}

function modelTerm(
  term: AtomicPricingTerm,
  mechanism: Mechanism,
  model: PublishedPricingModel | undefined,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): AtomicPricingTerm[] {
  if (term.kind === "raw") {
    const variants = term.variants.flatMap((variant) => rawVariant(variant, mechanism));
    return variants.length === 0 ? [] : [{ ...term, variants }];
  }
  if (term.kind !== "rate") return mechanism === "batch" ? [] : [term];
  const meter =
    mechanism === "realtime" &&
    term.meter.namespace === "kmodels" &&
    term.meter.value === "output_audio"
      ? providerMeter(
          input,
          "realtime_audio",
          "xAI Speech-to-Speech audio seconds sent or received without a direction-specific rate",
        )
      : term.meter;
  const variants = term.variants.flatMap((variant) => {
    const applicability = mechanismApplicability(variant.applicability, mechanism);
    if (applicability === undefined) return [];
    const next = {
      ...variant,
      applicability,
      observation: withApplicability(variant.observation, applicability),
    };
    const charge_binding = modelBinding(meter, next, mechanism, model, input, inputIndex);
    const selector_sources = selectorSources(next.applicability, mechanism, model, inputIndex);
    return [
      {
        ...next,
        ...(charge_binding === undefined ? {} : { charge_binding }),
        ...(selector_sources.length === 0 ? {} : { selector_sources }),
      },
    ];
  });
  const raw_variants = term.raw_variants.flatMap((variant) => rawVariant(variant, mechanism));
  return variants.length + raw_variants.length === 0
    ? []
    : [
        {
          ...term,
          ...(meter === term.meter ? {} : { term_key: "realtime_audio", meter }),
          variants,
          raw_variants,
        },
      ];
}

function modelBinding(
  meter: PriceMeter,
  variant: AtomicRateVariant,
  mechanism: Mechanism,
  model: PublishedPricingModel | undefined,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): ChargeBinding | undefined {
  const aggregation =
    mechanism === "batch" ? "result_item" : mechanism === "realtime" ? "session" : "request";
  if (meter.namespace === "provider" && meter.value === "realtime_audio") {
    const signal = providerSignal(
      input,
      "billed_realtime_audio_seconds",
      "Accepted input audio seconds plus emitted output audio seconds in an xAI realtime session",
      secondUnit,
      "outcome",
    );
    const mapped = sumMethod(
      [
        {
          signal: providerSignal(
            input,
            "realtime_input_audio_seconds",
            "Accepted input audio duration in an xAI realtime session",
            secondUnit,
            "request",
          ),
          keys: [],
        },
        {
          signal: providerSignal(
            input,
            "realtime_output_audio_seconds",
            "Emitted output audio duration in an xAI realtime session",
            secondUnit,
            "outcome",
          ),
          keys: [],
        },
      ],
      inputIndex,
    );
    return quantityBinding(signal, aggregation, mapped, variant);
  }
  if (meter.namespace !== "kmodels") return;
  if (meter.value === "input_text" && isStandardUnit(variant.price.per, "token")) {
    const signal = providerSignal(
      input,
      "uncached_input_text_tokens",
      "Billable uncached text-input tokens",
      tokenUnit,
      "outcome",
    );
    return quantityBinding(
      signal,
      aggregation,
      uncachedTextMethods(mechanism, model, input, inputIndex),
      variant,
    );
  }
  if (meter.value === "cache_read_text" && isStandardUnit(variant.price.per, "token")) {
    const signal = providerSignal(
      input,
      "cached_input_text_tokens",
      "Billable cached text-input tokens",
      tokenUnit,
      "outcome",
    );
    return quantityBinding(
      signal,
      aggregation,
      directMethods(signal, cachedKeys(mechanism, model), inputIndex),
      variant,
    );
  }
  if (meter.value === "output_text" && isStandardUnit(variant.price.per, "token")) {
    const signal = providerSignal(
      input,
      "output_text_tokens",
      "Billable text-output tokens including reasoning",
      tokenUnit,
      "outcome",
    );
    return quantityBinding(
      signal,
      aggregation,
      outputTextMethods(signal, mechanism, model, input, inputIndex),
      variant,
    );
  }
  if (meter.value === "input_image" && isStandardUnit(variant.price.per, "token")) {
    const signal = providerSignal(
      input,
      "input_image_tokens",
      "xAI billable prompt image tokens",
      variant.price.per,
      "outcome",
    );
    return quantityBinding(
      signal,
      aggregation,
      directMethods(signal, imageTokenKeys(mechanism, model), inputIndex),
      variant,
    );
  }
  if (meter.value === "image_generation" && isStandardUnit(variant.price.per, "image")) {
    const signal = standardSignal("generated_images");
    return quantityBinding(
      signal,
      aggregation,
      directMethods(
        signal,
        mechanism !== "batch" && hasEndpoint(model, "/v1/images/generations")
          ? ["image.generated_images"]
          : [],
        inputIndex,
      ),
      variant,
    );
  }
  if (meter.value === "video_generation" && isStandardUnit(variant.price.per, "second")) {
    const signal = standardSignal("generated_seconds");
    return quantityBinding(
      signal,
      aggregation,
      directMethods(
        signal,
        mechanism !== "batch" &&
          model?.api_endpoints?.some(({ path }) => path.startsWith("/v1/videos/")) === true
          ? ["video.generated_seconds"]
          : [],
        inputIndex,
      ),
      variant,
    );
  }
  if (meter.value === "input_image" && isStandardUnit(variant.price.per, "image")) {
    const signal = standardSignal("processed_images");
    return quantityBinding(signal, aggregation, emptyMethods(), variant);
  }
  if (meter.value === "input_video" && isStandardUnit(variant.price.per, "second")) {
    const signal = providerSignal(
      input,
      "submitted_input_video_seconds",
      "Accepted source-video duration billed by xAI Imagine",
      variant.price.per,
      "request",
    );
    return quantityBinding(signal, aggregation, emptyMethods(), variant);
  }
  if (meter.value === "input_text" && isStandardUnit(variant.price.per, "request")) {
    const signal = providerSignal(
      input,
      "realtime_text_input_events",
      "Accepted conversation.item.create events excluding function outputs and audio-only items",
      variant.price.per,
      "request",
    );
    return quantityBinding(signal, aggregation, emptyMethods(), variant);
  }
}

function uncachedTextMethods(
  mechanism: Mechanism,
  model: PublishedPricingModel | undefined,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): MethodsAndFacts {
  const methods: MethodsAndFacts[] = [];
  if (hasEndpoint(model, "/v1/chat/completions") && textOnlyInput(model))
    methods.push(
      subtractionMethod(
        providerSignal(
          input,
          "reported_prompt_text_tokens",
          "xAI prompt text tokens including the cached text partition",
          tokenUnit,
          "outcome",
        ),
        chatKeys(mechanism, "usage.prompt_text_tokens"),
        standardSignal("cached_input_tokens"),
        chatKeys(mechanism, "usage.cached_prompt_text_tokens"),
        inputIndex,
      ),
    );
  if (hasEndpoint(model, "/v1/responses") && textOnlyInput(model)) {
    const responsesPrefix = mechanism === "batch" ? "batch.responses" : "responses";
    methods.push(
      subtractionMethod(
        standardSignal("input_tokens"),
        [`${responsesPrefix}.usage.input_tokens`],
        standardSignal("cached_input_tokens"),
        [`${responsesPrefix}.usage.cached_input_tokens`],
        inputIndex,
      ),
    );
  }
  return mergeMethods(methods);
}

function outputTextMethods(
  result: UsageSignal,
  mechanism: Mechanism,
  model: PublishedPricingModel | undefined,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): MethodsAndFacts {
  const values: MethodsAndFacts[] = [];
  if (hasEndpoint(model, "/v1/chat/completions"))
    values.push(
      sumMethod(
        [
          {
            signal: providerSignal(
              input,
              "completion_tokens_excluding_reasoning",
              "xAI completion tokens excluding the separately reported reasoning subset",
              tokenUnit,
              "outcome",
            ),
            keys: chatKeys(mechanism, "usage.completion_tokens"),
          },
          {
            signal: standardSignal("reasoning_output_tokens"),
            keys: chatKeys(mechanism, "usage.reasoning_tokens"),
          },
        ],
        inputIndex,
      ),
    );
  if (mechanism === "sync" && hasEndpoint(model, "/v1/responses"))
    values.push(
      sumMethod(
        [
          {
            signal: providerSignal(
              input,
              "agent_completion_tokens_excluding_reasoning",
              "xAI SDK agent completion tokens excluding reasoning",
              tokenUnit,
              "outcome",
            ),
            keys: ["sdk.agent.completion_tokens"],
          },
          {
            signal: standardSignal("reasoning_output_tokens"),
            keys: ["sdk.agent.reasoning_tokens"],
          },
        ],
        inputIndex,
      ),
    );
  if (hasEndpoint(model, "/v1/responses")) {
    const prefix = mechanism === "batch" ? "batch.responses" : "responses";
    values.push(directMethods(result, [`${prefix}.usage.output_tokens`], inputIndex));
  }
  return mergeMethods(values);
}

function cachedKeys(mechanism: Mechanism, model: PublishedPricingModel | undefined): string[] {
  const result: string[] = [];
  if (textOnlyInput(model) && hasEndpoint(model, "/v1/chat/completions"))
    result.push(...chatKeys(mechanism, "usage.cached_prompt_text_tokens"));
  if (textOnlyInput(model) && hasEndpoint(model, "/v1/responses"))
    result.push(
      `${mechanism === "batch" ? "batch.responses" : "responses"}.usage.cached_input_tokens`,
    );
  if (mechanism === "sync" && hasEndpoint(model, "/v1/responses"))
    result.push("sdk.agent.cached_prompt_text_tokens");
  return result;
}

function imageTokenKeys(mechanism: Mechanism, model: PublishedPricingModel | undefined): string[] {
  const result: string[] = [];
  if (hasEndpoint(model, "/v1/chat/completions"))
    result.push(...chatKeys(mechanism, "usage.prompt_image_tokens"));
  if (mechanism === "sync" && hasEndpoint(model, "/v1/responses"))
    result.push("sdk.agent.prompt_image_tokens");
  return result;
}

function selectorSources(
  applicability: PriceApplicability,
  mechanism: Mechanism,
  model: PublishedPricingModel | undefined,
  inputIndex: PricingInputIndex,
): PriceSelectorSource[] {
  const dimensions = new Map<string, PriceDimension>();
  for (const { all_of } of applicability.any_of)
    for (const { dimension } of all_of) dimensions.set(canonicalJson(dimension), dimension);
  const result: PriceSelectorSource[] = [];
  for (const dimension of dimensions.values()) {
    if (dimension.namespace !== "kmodels") continue;
    const keys = selectorKeys(dimension.value, mechanism, model);
    for (const fact of pricingInputFacts(inputIndex, keys)) {
      const normalization = fact.key.endsWith(".fast_priority_alias")
        ? tierNormalization(dimension, applicability)
        : undefined;
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

function tierNormalization(
  dimension: PriceDimension,
  applicability: PriceApplicability,
): PriceSelectorSource["normalization"] {
  const entries = applicability.any_of.flatMap(({ all_of }) =>
    all_of.flatMap((condition) =>
      condition.kind === "categorical" &&
      canonicalJson(condition.dimension) === canonicalJson(dimension)
        ? condition.values.flatMap((value) => [
            { source_value: value.value, value },
            ...(value.value === "priority" ? [{ source_value: "fast", value }] : []),
          ])
        : [],
    ),
  );
  return { kind: "categorical_map", entries: uniqueCanonical(entries) };
}

function selectorKeys(
  dimension: string,
  mechanism: Mechanism,
  model: PublishedPricingModel | undefined,
): string[] {
  if (dimension === "served_service_tier" && mechanism === "sync")
    return [
      ...(hasEndpoint(model, "/v1/chat/completions")
        ? ["chat.served_service_tier", "chat.served_service_tier.fast_priority_alias"]
        : []),
      ...(hasEndpoint(model, "/v1/responses")
        ? ["responses.served_service_tier", "responses.served_service_tier.fast_priority_alias"]
        : []),
    ];
  if (dimension === "context_tokens") {
    const prefix = mechanism === "batch" ? "batch." : "";
    return [
      ...(hasEndpoint(model, "/v1/chat/completions")
        ? chatKeys(mechanism, "usage.prompt_tokens")
        : []),
      ...(hasEndpoint(model, "/v1/responses") ? [`${prefix}responses.usage.input_tokens`] : []),
    ];
  }
  return [];
}

function resourceBook(
  book: AtomicPricingBook,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): AtomicPricingBook {
  if (book.scope.kind !== "provider_resource") return book;
  const resourceKey = book.scope.resource_key;
  return {
    ...book,
    resource_edges: [],
    offers: book.offers.map((offer) => ({
      ...offer,
      enrollment: [],
      relations: [],
      settlement: [],
      terms: offer.terms.map((term) => resourceTerm(resourceKey, offer, term, input, inputIndex)),
    })),
  };
}

function resourceTerm(
  resourceKey: string,
  offer: AtomicPricingOffer,
  term: AtomicPricingTerm,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): AtomicPricingTerm {
  if (term.kind !== "rate") return term;
  const meter =
    resourceKey === "x-search-posts"
      ? providerMeter(input, "x_search_posts", "X posts fetched, including parent and quoted posts")
      : resourceKey === "x-search-profiles"
        ? providerMeter(input, "x_search_profiles", "X user profiles fetched by user search")
        : resourceKey === "x-search"
          ? providerMeter(input, "x_search", "Successful xAI X Search executions")
          : resourceKey === "responses-policy"
            ? providerMeter(
                input,
                "pre_generation_usage_guideline_violation",
                "Responses requests rejected before generation for an xAI usage-guideline violation",
              )
            : resourceKey === "text-to-speech"
              ? ({ namespace: "kmodels", value: "speech_generation" } as const)
              : resourceKey === "speech-to-text"
                ? ({ namespace: "kmodels", value: "transcription" } as const)
                : term.meter;
  return {
    ...term,
    ...(meter === term.meter ? {} : { term_key: resourceKey, meter }),
    variants: term.variants.map((variant) => {
      const charge_binding =
        resourceKey === "image-generation-tool"
          ? modelBinding(meter, variant, "direct", undefined, input, inputIndex)
          : resourceBinding(resourceKey, offer, variant, input, inputIndex);
      return charge_binding === undefined ? variant : { ...variant, charge_binding };
    }),
  };
}

function resourceBinding(
  resourceKey: string,
  offer: AtomicPricingOffer,
  variant: AtomicRateVariant,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): ChargeBinding | undefined {
  const tool = toolSignal(resourceKey, variant, input);
  if (tool !== undefined)
    return quantityBinding(
      tool.signal,
      "request",
      directMethods(tool.signal, tool.keys, inputIndex),
      variant,
    );
  if (resourceKey === "text-to-speech") {
    addAtom(input, {
      kind: "aggregation",
      key: "tts_utterance",
      definition: "One xAI Text to Speech utterance across REST or streaming fragments",
    });
    const signal = standardSignal("input_characters");
    return quantityBinding(
      signal,
      { namespace: "provider", provider_id: input.provider_id, value: "tts_utterance" },
      emptyMethods(),
      variant,
    );
  }
  if (resourceKey === "speech-to-text") {
    const signal = standardSignal("processed_audio_seconds");
    return quantityBinding(
      signal,
      offer.offer_key === "streaming" ? "session" : "request",
      directMethods(
        signal,
        offer.offer_key === "streaming" ? [] : ["stt.rest.audio_seconds"],
        inputIndex,
      ),
      variant,
    );
  }
  if (resourceKey === "responses-policy") {
    const signal = providerSignal(
      input,
      "pre_generation_usage_guideline_violations",
      "Count of Responses requests rejected before generation for an xAI usage-guideline violation",
      variant.price.per,
      "outcome",
    );
    return quantityBinding(signal, "request", emptyMethods(), variant);
  }
}

function toolSignal(
  resourceKey: string,
  variant: AtomicRateVariant,
  input: AtomicProviderPricing,
): { signal: UsageSignal; keys: string[] } | undefined {
  if (resourceKey === "web-search")
    return {
      signal: standardSignal("successful_web_searches"),
      keys: ["sdk.server_side_tool_usage.web_search"],
    };
  const values = new Map<string, readonly [string, string, string[]]>([
    [
      "x-search-posts",
      [
        "fetched_x_posts",
        "Every X post fetched, including parent and quoted posts",
        ["responses.usage.x_posts_fetched"],
      ],
    ],
    [
      "x-search-profiles",
      [
        "fetched_x_profiles",
        "Every X user profile fetched by user search",
        ["responses.usage.x_users_fetched"],
      ],
    ],
    [
      "x-search",
      [
        "successful_x_searches",
        "Successful billable xAI X Search calls",
        ["sdk.server_side_tool_usage.x_search"],
      ],
    ],
    [
      "code-execution",
      [
        "successful_code_executions",
        "Successful billable xAI code-execution calls",
        ["sdk.server_side_tool_usage.code_execution"],
      ],
    ],
    [
      "collections-search",
      [
        "successful_collections_searches",
        "Successful billable xAI Collections Search calls",
        ["sdk.server_side_tool_usage.collections_search"],
      ],
    ],
    [
      "attachment-search",
      ["successful_attachment_searches", "Successful billable xAI attachment searches", []],
    ],
  ]);
  const value = values.get(resourceKey);
  if (value === undefined) return;
  return {
    signal: providerSignal(input, value[0], value[1], variant.price.per, "outcome"),
    keys: [...value[2]],
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

function mechanismApplicability(
  applicability: PriceApplicability,
  mechanism: Mechanism,
): PriceApplicability | undefined {
  if (mechanism === "realtime") return applicability;
  const any_of = applicability.any_of.flatMap(({ all_of }) => {
    const tier = all_of.find(isServiceTier);
    const batch =
      tier?.kind === "categorical" && tier.values.some(({ value }) => value === "batch");
    if ((mechanism === "batch") !== batch) return [];
    return [
      {
        all_of:
          mechanism === "batch" ? all_of.filter((item) => item !== tier) : all_of.map(servedTier),
      },
    ];
  });
  return any_of.length === 0 ? undefined : canonicalizeApplicability({ any_of });
}

function rawVariant(variant: AtomicRawVariant, mechanism: Mechanism): AtomicRawVariant[] {
  if (variant.possible_scope === undefined) return mechanism === "batch" ? [] : [variant];
  const possible_scope = mechanismApplicability(variant.possible_scope, mechanism);
  return possible_scope === undefined ? [] : [{ ...variant, possible_scope }];
}

function servedTier(condition: PriceCondition): PriceCondition {
  return isServiceTier(condition)
    ? { ...condition, dimension: { namespace: "kmodels", value: "served_service_tier" } }
    : condition;
}

function isServiceTier(
  condition: PriceCondition,
): condition is Extract<PriceCondition, { kind: "categorical" }> {
  return (
    condition.kind === "categorical" &&
    condition.dimension.namespace === "kmodels" &&
    condition.dimension.value === "service_tier"
  );
}

function providerMeter(input: AtomicProviderPricing, key: string, definition: string): PriceMeter {
  addAtom(input, { kind: "meter", key, definition });
  return { namespace: "provider", provider_id: input.provider_id, value: key };
}

function providerSignal(
  input: AtomicProviderPricing,
  key: string,
  definition: string,
  unit: UnitExpression,
  resolution_phase: "outcome" | "request",
): Extract<UsageSignal, { namespace: "provider" }> {
  addAtom(input, { kind: "usage_signal", key, definition, unit, resolution_phase });
  return { namespace: "provider", provider_id: input.provider_id, value: key };
}

function hasEndpoint(model: PublishedPricingModel | undefined, path: string): boolean {
  return (
    model !== undefined && model.api_endpoints?.some((endpoint) => endpoint.path === path) === true
  );
}

function chatKeys(mechanism: Mechanism, suffix: string): string[] {
  return mechanism === "batch" ? [] : [`chat.${suffix}`, `chat.stream.${suffix}`];
}

function textOnlyInput(model: PublishedPricingModel | undefined): boolean {
  return model?.modalities.input.every((modality) => modality === "text") === true;
}

function mechanismName(mechanism: Mechanism): string {
  switch (mechanism) {
    case "batch":
      return "Batch inference";
    case "direct":
      return "Direct inference";
    case "realtime":
      return "Realtime inference";
    case "sync":
      return "Synchronous inference";
  }
}
