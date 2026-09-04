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
  relation,
  standardSignal,
  withApplicability,
} from "./pricing-commercial-assembly.ts";
import { pricingBookId, pricingOfferId } from "./pricing-identifiers.ts";
import {
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
  PriceCondition,
  PriceDimension,
  PriceMeter,
  PriceSelectorSource,
  UnitExpression,
  UsageQuantityMethod,
  UsageQuantityNode,
  UsageSignal,
} from "./pricing-schema.ts";
import type { ParsedProviderModel, SourcePricingInputFact } from "./pricing-source.ts";

type Mechanism = "sync" | "batch";
type Family = "google" | "anthropic" | "responses" | "chat";
type PublishedModel = Pick<ParsedProviderModel, "service_families" | "tasks" | "uid">;

const servedTier = { namespace: "kmodels", value: "served_service_tier" } as const;
const requestServices = new Set([
  "claude-web-search",
  "google-image-search",
  "google-maps",
  "google-search",
  "grounded-generation",
  "web-grounding-enterprise",
]);

export function applyVertexCommercialTopology(
  input: AtomicProviderPricing,
  publishedModels: readonly PublishedModel[],
  pricingInputs: readonly SourcePricingInputFact[],
): AtomicProviderPricing {
  const models = new Map(publishedModels.map((model) => [model.uid, model]));
  const inputIndex = indexPricingInputs(pricingInputs);
  const modelOffers = new Map<string, string>();
  const books = input.books
    .flatMap((book) => {
      if (book.scope.kind === "models") {
        const migrated = splitModelBook(book, input, models, inputIndex);
        if (migrated.offers.some(({ offer_key }) => offer_key === "sync")) {
          const ref = pricingOfferId(pricingBookId(input.provider_id, book.book_key), "sync");
          for (const modelRef of book.scope.model_refs) modelOffers.set(modelRef, ref);
        }
        return [migrated];
      }
      return requestServices.has(book.scope.resource_key)
        ? [bindRequestService(book, input, inputIndex)]
        : [];
    })
    .map(includePricingInputSourceRefs);
  for (const book of books) bindServiceRelations(book, modelOffers);
  return { ...input, books };
}

function splitModelBook(
  book: AtomicPricingBook,
  input: AtomicProviderPricing,
  models: ReadonlyMap<string, PublishedModel>,
  inputIndex: PricingInputIndex,
): AtomicPricingBook {
  const model =
    book.scope.kind === "models" && book.scope.model_refs.length === 1
      ? models.get(book.scope.model_refs[0]!)
      : undefined;
  const family = modelFamily(model);
  return {
    ...book,
    offers: book.offers.flatMap((offer) => {
      if (offer.offer_key !== "usage") return [{ ...offer, settlement: [] }];
      return (["sync", "batch"] as const)
        .map((mechanism) => partitionOffer(offer, mechanism, family, model, input, inputIndex))
        .filter((candidate): candidate is AtomicPricingOffer => candidate !== undefined);
    }),
  };
}

function partitionOffer(
  offer: AtomicPricingOffer,
  mechanism: Mechanism,
  family: Family,
  model: PublishedModel | undefined,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): AtomicPricingOffer | undefined {
  const states = offer.states.flatMap((state) => {
    const applicability = mechanismApplicability(state.applicability, mechanism, input);
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
  const rateMeters = offer.terms.flatMap((term) => (term.kind === "rate" ? [term.meter] : []));
  const terms = offer.terms.flatMap((term) =>
    partitionTerm(term, mechanism, family, model, input, inputIndex, rateMeters),
  );
  if (states.length === 0 && terms.length === 0) return;
  return {
    ...offer,
    offer_key: mechanism,
    name: mechanism === "batch" ? "Batch inference" : "Online inference",
    states,
    terms,
    relations: [],
    settlement: [],
  };
}

function partitionTerm(
  term: AtomicPricingTerm,
  mechanism: Mechanism,
  family: Family,
  model: PublishedModel | undefined,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
  rateMeters: readonly PriceMeter[],
): AtomicPricingTerm[] {
  if (term.kind === "raw") {
    const variants = term.variants.flatMap((variant) => partitionRaw(variant, mechanism, input));
    return variants.length === 0 ? [] : [{ ...term, variants }];
  }
  if (term.kind !== "rate") return mechanism === "sync" ? [term] : [];
  const variants = term.variants.flatMap((variant) => {
    const applicability = mechanismApplicability(variant.applicability, mechanism, input);
    if (applicability === undefined) return [];
    const observation = withApplicability(variant.observation, applicability);
    const charge_binding = modelBinding(
      term.meter,
      variant,
      mechanism,
      family,
      model,
      input,
      inputIndex,
      rateMeters,
    );
    const selector_sources = selectorSources(applicability, mechanism, family, model, inputIndex);
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
  const raw_variants = term.raw_variants.flatMap((variant) =>
    partitionRaw(variant, mechanism, input),
  );
  return variants.length + raw_variants.length === 0 ? [] : [{ ...term, variants, raw_variants }];
}

function partitionRaw(
  variant: AtomicRawVariant,
  mechanism: Mechanism,
  input: AtomicProviderPricing,
): AtomicRawVariant[] {
  if (variant.possible_scope === undefined) return mechanism === "sync" ? [variant] : [];
  const possible_scope = mechanismApplicability(variant.possible_scope, mechanism, input);
  return possible_scope === undefined ? [] : [{ ...variant, possible_scope }];
}

function mechanismApplicability(
  applicability: PriceApplicability,
  mechanism: Mechanism,
  input: AtomicProviderPricing,
): PriceApplicability | undefined {
  const any_of = applicability.any_of.flatMap(({ all_of }) => {
    const tier = all_of.find(isServiceTier);
    const values = tier?.kind === "categorical" ? tier.values.map(({ value }) => value) : [];
    if ((mechanism === "batch") !== values.includes("batch")) return [];
    if (mechanism === "batch" || tier === undefined)
      return [{ all_of: tier === undefined ? all_of : all_of.filter((item) => item !== tier) }];
    if (tier.kind !== "categorical") return [];
    const realized: Extract<PriceCondition, { kind: "categorical" }> = {
      ...tier,
      dimension: servedTier,
      values: tier.values.map((value) => {
        addAtom(input, {
          kind: "categorical_value",
          key: value.value,
          dimension: servedTier,
          definition: `Agent Platform response-reported served traffic type ${JSON.stringify(value.value)}`,
          label: title(value.value),
        });
        return value;
      }),
    };
    return [{ all_of: all_of.map((item) => (item === tier ? realized : item)) }];
  });
  return any_of.length === 0 ? undefined : canonicalizeApplicability({ any_of });
}

function isServiceTier(condition: PriceCondition): boolean {
  return (
    condition.kind === "categorical" &&
    condition.dimension.namespace === "kmodels" &&
    condition.dimension.value === "service_tier"
  );
}

function modelFamily(model: PublishedModel | undefined): Family {
  const families = new Set(model?.service_families ?? []);
  if (families.has("publishers/google")) return "google";
  if (families.has("publishers/anthropic")) return "anthropic";
  if (families.has("publishers/xai")) return "responses";
  return "chat";
}

function modelBinding(
  meter: PriceMeter,
  variant: AtomicRateVariant,
  mechanism: Mechanism,
  family: Family,
  model: PublishedModel | undefined,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
  rateMeters: readonly PriceMeter[],
): ChargeBinding | undefined {
  const aggregation = mechanism === "batch" ? "result_item" : "request";
  if (family === "google" && isStandardUnit(variant.price.per, "image")) {
    if (meter.namespace !== "kmodels" || meter.value !== "image_generation") return;
    const signal = standardSignal("generated_images");
    const mapped = mergeMethods(
      ["generate.output.images", "imagen.response.images"].map((key) =>
        directMethods(signal, [key], mechanism, inputIndex),
      ),
    );
    return quantityBinding(signal, aggregation, mapped, variant);
  }
  if (family === "google" && isStandardUnit(variant.price.per, "second")) {
    if (meter.namespace !== "kmodels" || meter.value !== "video_generation") return;
    const signal = standardSignal("generated_seconds");
    return quantityBinding(
      signal,
      "job",
      videoMethods(input, inputIndex, variant.price.per),
      variant,
    );
  }
  if (!isStandardUnit(variant.price.per, "token") || meter.namespace !== "kmodels") return;
  if (family === "google")
    return googleTokenBinding(
      meter,
      variant,
      mechanism,
      model,
      input,
      inputIndex,
      rateMeters,
      aggregation,
    );
  if (family === "anthropic")
    return directTokenBinding(
      meter,
      variant,
      mechanism,
      input,
      inputIndex,
      aggregation,
      {
        input_text: "claude.input_tokens",
        cache_write_text: "claude.cache_write_tokens",
        cache_read_text: "claude.cache_read_tokens",
        output_text: "claude.output_tokens",
      },
      "claude",
    );
  if (family === "responses")
    return responsesTokenBinding(meter, variant, mechanism, input, inputIndex, aggregation);
  return directTokenBinding(
    meter,
    variant,
    mechanism,
    input,
    inputIndex,
    aggregation,
    { input_text: "chat.input_tokens", output_text: "chat.output_tokens" },
    "chat",
  );
}

function googleTokenBinding(
  meter: Extract<PriceMeter, { namespace: "kmodels" }>,
  variant: AtomicRateVariant,
  mechanism: Mechanism,
  model: PublishedModel | undefined,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
  rateMeters: readonly PriceMeter[],
  aggregation: "request" | "result_item",
): ChargeBinding | undefined {
  if (meter.value.startsWith("input_")) {
    const modality = meter.value.slice("input_".length);
    const embedding = model?.tasks.includes("embeddings") === true;
    const signal = providerSignal(
      input,
      `${embedding ? "embedding" : "uncached"}_input_${modality === "image" ? "image_rate" : modality}_tokens`,
      modality === "image"
        ? `Agent Platform ${embedding ? "embedding" : "uncached"} image and document tokens billed at the image rate`
        : `Agent Platform ${embedding ? "embedding" : "uncached"} ${modality} input tokens`,
      variant.price.per,
    );
    const mapped = embedding
      ? embeddingInputMethods(signal, modality, mechanism, input, inputIndex, variant.price.per)
      : uncachedInputMethods(modality, mechanism, input, inputIndex, variant.price.per);
    return quantityBinding(signal, aggregation, mapped, variant);
  }
  if (meter.value.startsWith("cache_read_")) {
    const modality = meter.value.slice("cache_read_".length);
    const signal = providerSignal(
      input,
      modality === "image" ? "cached_input_image_rate_tokens" : `cached_input_${modality}_tokens`,
      modality === "image"
        ? "Cached Agent Platform image and document tokens billed at the image rate"
        : `Cached Agent Platform ${modality} input tokens`,
      variant.price.per,
    );
    return quantityBinding(
      signal,
      aggregation,
      cachedInputMethods(signal, modality, mechanism, input, inputIndex, variant.price.per),
      variant,
    );
  }
  if (meter.value === "output_text") {
    const signal = standardSignal("output_tokens");
    return quantityBinding(
      signal,
      aggregation,
      textOutputMethods(
        mechanism,
        input,
        inputIndex,
        variant.price.per,
        !rateMeters.some(
          (candidate) =>
            candidate.namespace === "kmodels" &&
            ["output_audio", "output_image", "output_video"].includes(candidate.value),
        ),
      ),
      variant,
    );
  }
  if (meter.value.startsWith("output_")) {
    const modality = meter.value.slice("output_".length);
    const signal = providerSignal(
      input,
      `output_${modality}_tokens`,
      `Agent Platform ${modality} candidate-output tokens`,
      variant.price.per,
    );
    return quantityBinding(
      signal,
      aggregation,
      directMethods(signal, [`generate.candidates.${modality}`], mechanism, inputIndex),
      variant,
    );
  }
}

function directTokenBinding(
  meter: Extract<PriceMeter, { namespace: "kmodels" }>,
  variant: AtomicRateVariant,
  mechanism: Mechanism,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
  aggregation: "request" | "result_item",
  keys: Partial<Record<Extract<PriceMeter, { namespace: "kmodels" }>["value"], string>>,
  prefix: string,
): ChargeBinding | undefined {
  const key = keys[meter.value];
  if (key === undefined) return;
  const signal = providerSignal(
    input,
    `${prefix}_${key.slice(key.indexOf(".") + 1)}`,
    `Billable Agent Platform ${prefix} ${meter.value.replaceAll("_", " ")} tokens`,
    variant.price.per,
  );
  return quantityBinding(
    signal,
    aggregation,
    directMethods(signal, [key], mechanism, inputIndex),
    variant,
  );
}

function responsesTokenBinding(
  meter: Extract<PriceMeter, { namespace: "kmodels" }>,
  variant: AtomicRateVariant,
  mechanism: Mechanism,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
  aggregation: "request" | "result_item",
): ChargeBinding | undefined {
  if (meter.value === "input_text") {
    const signal = providerSignal(
      input,
      "responses_uncached_input_tokens",
      "Agent Platform Responses input tokens excluding cached input",
      variant.price.per,
    );
    const total = providerSignal(
      input,
      "responses_reported_input_tokens",
      "Agent Platform Responses input tokens including cached input",
      variant.price.per,
    );
    const cached = providerSignal(
      input,
      "responses_reported_cached_input_tokens",
      "Agent Platform Responses cached input tokens",
      variant.price.per,
    );
    return quantityBinding(
      signal,
      aggregation,
      calculationMethod(
        {
          nodes: [
            { op: "signal", signal: total },
            { op: "signal", signal: cached },
            { op: "subtract_floor_zero", minuend: 0, subtrahend: 1 },
          ],
          result: 2,
        },
        [
          { signal: total, keys: ["responses.input_tokens"] },
          { signal: cached, keys: ["responses.cached_input_tokens"] },
        ],
        mechanism,
        inputIndex,
      ),
      variant,
    );
  }
  return directTokenBinding(
    meter,
    variant,
    mechanism,
    input,
    inputIndex,
    aggregation,
    {
      cache_read_text: "responses.cached_input_tokens",
      output_text: "responses.output_tokens",
    },
    "responses",
  );
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

function directMethods(
  signal: UsageSignal,
  keys: readonly string[],
  mechanism: Mechanism,
  inputIndex: PricingInputIndex,
): MethodsAndFacts {
  const facts = mechanismFacts(inputIndex, keys, mechanism);
  return facts.length === 0
    ? emptyMethods()
    : { methods: [{ input_sources: usageInputSources(signal, facts) }], facts };
}

function uncachedInputMethods(
  modality: string,
  mechanism: Mechanism,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
  unit: UnitExpression,
): MethodsAndFacts {
  const modalities = modality === "image" ? ["image", "document"] : [modality];
  const inputs = modalities.map((value) => ({
    prompt: providerSignal(
      input,
      `reported_prompt_${value}_tokens`,
      `Agent Platform reported ${value} prompt tokens including cached content`,
      unit,
    ),
    cached: providerSignal(
      input,
      `reported_cached_${value}_tokens`,
      `Agent Platform reported cached ${value} prompt tokens`,
      unit,
    ),
    tool: providerSignal(
      input,
      `reported_tool_prompt_${value}_tokens`,
      `Agent Platform reported ${value} tool-result tokens provided back to the model`,
      unit,
    ),
  }));
  const nodes: UsageQuantityNode[] = inputs.flatMap(({ prompt, cached, tool }, index) => [
    { op: "signal", signal: prompt },
    { op: "signal", signal: cached },
    { op: "subtract_floor_zero", minuend: index * 5, subtrahend: index * 5 + 1 },
    { op: "signal", signal: tool },
    { op: "sum", inputs: [index * 5 + 2, index * 5 + 3] },
  ]);
  if (inputs.length > 1)
    nodes.push({ op: "sum", inputs: inputs.map((_value, index) => index * 5 + 4) });
  return calculationMethod(
    { nodes, result: nodes.length - 1 },
    inputs.flatMap(({ prompt, cached, tool }, index) => [
      { signal: prompt, keys: [`generate.prompt.${modalities[index]}`] },
      { signal: cached, keys: [`generate.cache.${modalities[index]}`] },
      { signal: tool, keys: [`generate.tool_prompt.${modalities[index]}`] },
    ]),
    mechanism,
    inputIndex,
  );
}

function embeddingInputMethods(
  result: UsageSignal,
  modality: string,
  mechanism: Mechanism,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
  unit: UnitExpression,
): MethodsAndFacts {
  if (modality !== "image")
    return directMethods(result, [`embedding.prompt.${modality}`], mechanism, inputIndex);
  const image = providerSignal(
    input,
    "reported_embedding_image_tokens",
    "Agent Platform reported image embedding-input tokens",
    unit,
  );
  const document = providerSignal(
    input,
    "reported_embedding_document_tokens",
    "Agent Platform reported document embedding-input tokens",
    unit,
  );
  return calculationMethod(
    {
      nodes: [
        { op: "signal", signal: image },
        { op: "signal", signal: document },
        { op: "sum", inputs: [0, 1] },
      ],
      result: 2,
    },
    [
      { signal: image, keys: ["embedding.prompt.image"] },
      { signal: document, keys: ["embedding.prompt.document"] },
    ],
    mechanism,
    inputIndex,
  );
}

function cachedInputMethods(
  result: UsageSignal,
  modality: string,
  mechanism: Mechanism,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
  unit: UnitExpression,
): MethodsAndFacts {
  if (modality !== "image")
    return directMethods(result, [`generate.cache.${modality}`], mechanism, inputIndex);
  const image = providerSignal(
    input,
    "reported_cached_image_tokens",
    "Agent Platform reported cached image tokens",
    unit,
  );
  const document = providerSignal(
    input,
    "reported_cached_document_tokens",
    "Agent Platform reported cached document tokens",
    unit,
  );
  return calculationMethod(
    {
      nodes: [
        { op: "signal", signal: image },
        { op: "signal", signal: document },
        { op: "sum", inputs: [0, 1] },
      ],
      result: 2,
    },
    [
      { signal: image, keys: ["generate.cache.image"] },
      { signal: document, keys: ["generate.cache.document"] },
    ],
    mechanism,
    inputIndex,
  );
}

function textOutputMethods(
  mechanism: Mechanism,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
  unit: UnitExpression,
  allowAggregate: boolean,
): MethodsAndFacts {
  const text = providerSignal(
    input,
    "candidate_output_text_tokens",
    "Agent Platform text candidate-output tokens excluding thoughts",
    unit,
  );
  const total = providerSignal(
    input,
    "candidate_output_tokens",
    "Agent Platform aggregate candidate-output tokens excluding thoughts",
    unit,
  );
  const thoughts = standardSignal("reasoning_output_tokens");
  const calculation = (candidate: UsageSignal) => ({
    nodes: [
      { op: "signal" as const, signal: candidate },
      { op: "signal" as const, signal: thoughts },
      { op: "sum" as const, inputs: [0, 1] },
    ],
    result: 2,
  });
  return mergeMethods([
    calculationMethod(
      calculation(text),
      [
        { signal: text, keys: ["generate.candidates.text"] },
        { signal: thoughts, keys: ["generate.thoughts"] },
      ],
      mechanism,
      inputIndex,
    ),
    ...(allowAggregate
      ? [
          calculationMethod(
            calculation(total),
            [
              { signal: total, keys: ["generate.candidates.total"] },
              { signal: thoughts, keys: ["generate.thoughts"] },
            ],
            mechanism,
            inputIndex,
          ),
        ]
      : []),
  ]);
}

function videoMethods(
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
  unit: UnitExpression,
): MethodsAndFacts {
  const duration = providerSignal(
    input,
    "video_duration_seconds",
    "Requested seconds per Agent Platform generated video",
    unit,
  );
  const videos = providerSignal(
    input,
    "generated_video_count",
    "Successfully returned Agent Platform videos",
    { factors: [{ unit: { namespace: "kmodels", value: "item" }, power: 1 }] },
  );
  const durationFacts = pricingInputFacts(inputIndex, ["video.request.duration_seconds"]);
  const videoFacts = pricingInputFacts(inputIndex, ["video.result.videos"]);
  if (durationFacts.length === 0 || videoFacts.length === 0) return emptyMethods();
  return {
    methods: [
      {
        calculation: {
          nodes: [
            { op: "signal", signal: duration },
            { op: "signal", signal: videos },
            { op: "product", inputs: [0, 1] },
          ],
          result: 2,
        },
        input_sources: uniqueCanonical([
          ...usageInputSources(duration, durationFacts),
          ...usageInputSources(videos, videoFacts),
        ]),
      },
    ],
    facts: [...durationFacts, ...videoFacts],
  };
}

function calculationMethod(
  calculation: NonNullable<UsageQuantityMethod["calculation"]>,
  requirements: ReadonlyArray<{ signal: UsageSignal; keys: readonly string[] }>,
  mechanism: Mechanism,
  inputIndex: PricingInputIndex,
): MethodsAndFacts {
  const mapped = requirements.map(({ signal, keys }) => ({
    signal,
    facts: mechanismFacts(inputIndex, keys, mechanism),
  }));
  if (mapped.some(({ facts }) => facts.length === 0)) return emptyMethods();
  const facts = mapped.flatMap(({ facts: values }) => values);
  return {
    methods: [
      {
        calculation,
        input_sources: uniqueCanonical(
          mapped.flatMap(({ signal, facts: values }) => usageInputSources(signal, values)),
        ),
      },
    ],
    facts,
  };
}

function mechanismFacts(
  inputIndex: PricingInputIndex,
  keys: readonly string[],
  mechanism: Mechanism,
): SourcePricingInputFact[] {
  return pricingInputFacts(inputIndex, keys).filter(
    ({ channel }) => (mechanism === "batch") === (channel === "result"),
  );
}

function providerSignal(
  input: AtomicProviderPricing,
  key: string,
  definition: string,
  unit: UnitExpression,
): Extract<UsageSignal, { namespace: "provider" }> {
  addAtom(input, {
    kind: "usage_signal",
    key,
    definition,
    unit,
    resolution_phase: "outcome",
  });
  return { namespace: "provider", provider_id: input.provider_id, value: key };
}

function bindRequestService(
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
      settlement: [],
      terms: offer.terms.map((term) => {
        if (term.kind !== "rate") return term;
        return {
          ...term,
          variants: term.variants.map((variant) => ({
            ...variant,
            charge_binding: serviceBinding(resourceKey, variant, input, inputIndex),
          })),
        };
      }),
    })),
  };
}

function serviceBinding(
  resourceKey: string,
  variant: AtomicRateVariant,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): ChargeBinding {
  const request = isStandardUnit(variant.price.per, "request");
  const { key, inputKey, definition } = serviceSignal(resourceKey, request);
  const signal = providerSignal(input, key, definition, variant.price.per);
  return quantityBinding(
    signal,
    "request",
    inputKey === undefined ? emptyMethods() : directMethods(signal, [inputKey], "sync", inputIndex),
    variant,
  );
}

function serviceSignal(
  resourceKey: string,
  request: boolean,
): { key: string; inputKey?: string; definition: string } {
  if (resourceKey === "claude-web-search")
    return {
      key: "claude_web_search_requests",
      inputKey: "claude.web_search_requests",
      definition: "Successful billable Claude web-search tool requests on Agent Platform",
    };
  if (resourceKey === "google-image-search")
    return {
      key: "google_image_search_queries",
      inputKey: "generate.grounding.google_image_search_queries",
      definition: "Executed Google Image Search queries reported by Agent Platform",
    };
  if (resourceKey === "grounded-generation")
    return {
      key: "agent_search_grounded_requests",
      inputKey: "generate.grounding.agent_search_result",
      definition: "Agent Search grounded requests with a retrieved grounding result",
    };
  if (resourceKey === "google-maps")
    return {
      key: request ? "google_maps_grounded_requests" : "google_maps_queries",
      ...(request ? { inputKey: "generate.grounding.google_maps_result" } : {}),
      definition: request
        ? "Google Maps grounded requests with a returned Maps grounding result"
        : "Actual Google Maps queries, whose count is not exposed by Agent Platform responses",
    };
  const groundedPrompt = request;
  return {
    key: groundedPrompt
      ? `${resourceKey.replaceAll("-", "_")}_grounded_requests`
      : "google_search_queries",
    inputKey: groundedPrompt
      ? "generate.grounding.google_search_result"
      : "generate.grounding.google_search_queries",
    definition: groundedPrompt
      ? `Agent Platform ${resourceKey.replaceAll("-", " ")} requests with a returned web grounding result`
      : "Executed Google Search queries reported by Agent Platform",
  };
}

function selectorSources(
  applicability: PriceApplicability,
  mechanism: Mechanism,
  family: Family,
  model: PublishedModel | undefined,
  inputIndex: PricingInputIndex,
): PriceSelectorSource[] {
  const dimensions = new Map<string, PriceDimension>();
  for (const { all_of } of applicability.any_of)
    for (const { dimension } of all_of) dimensions.set(canonicalJson(dimension), dimension);
  return uniqueCanonical(
    [...dimensions.values()].flatMap((dimension): PriceSelectorSource[] => {
      if (dimension.namespace !== "kmodels") return [];
      const keys = selectorKeys(dimension.value, family, model);
      const facts = selectorFacts(inputIndex, keys, mechanism);
      return facts.map((fact) => ({
        dimension,
        channel: fact.channel,
        locator: fact.locator,
        availability: fact.availability,
        ...(dimension.value === "served_service_tier"
          ? tierNormalization(applicability, dimension)
          : {}),
        observations: [pricingInputObservation(fact)],
      }));
    }),
  );
}

function selectorFacts(
  inputIndex: PricingInputIndex,
  keys: readonly string[],
  mechanism: Mechanism,
): SourcePricingInputFact[] {
  return pricingInputFacts(inputIndex, keys).filter(({ channel }) =>
    mechanism === "batch" ? channel === "request" || channel === "result" : channel !== "result",
  );
}

function selectorKeys(
  dimension: PriceDimension["value"],
  family: Family,
  model: PublishedModel | undefined,
): string[] {
  if (dimension === "served_service_tier")
    return family === "google"
      ? ["generate.service_tier"]
      : family === "responses"
        ? ["responses.served_service_tier"]
        : [];
  if (dimension === "context_tokens" && family === "google") return ["generate.prompt.total"];
  if (dimension === "region") return ["request.location"];
  if (dimension === "resolution") {
    if (model?.tasks.includes("video_generation") === true) return ["video.request.resolution"];
    if (model?.tasks.includes("image_generation") === true) return ["imagen.request.resolution"];
  }
  if (dimension === "request_audio" && model?.tasks.includes("video_generation") === true)
    return ["video.request.generate_audio"];
  return [];
}

function tierNormalization(
  applicability: PriceApplicability,
  dimension: PriceDimension,
): Pick<PriceSelectorSource, "normalization"> | Record<never, never> {
  const values = applicability.any_of.flatMap(({ all_of }) =>
    all_of.flatMap((condition) =>
      condition.kind === "categorical" &&
      canonicalJson(condition.dimension) === canonicalJson(dimension)
        ? condition.values
        : [],
    ),
  );
  const sources = {
    standard: ["ON_DEMAND", "TRAFFIC_TYPE_UNSPECIFIED", "on_demand", "standard"],
    priority: ["ON_DEMAND_PRIORITY", "priority"],
    flex: ["ON_DEMAND_FLEX", "ON_DEMAND_OFFPEAK", "flex"],
  } as const;
  const entries = values.flatMap((value) =>
    value.value in sources
      ? sources[value.value as keyof typeof sources].map((source_value) => ({
          source_value,
          value,
        }))
      : [],
  );
  return entries.length === 0
    ? {}
    : { normalization: { kind: "categorical_map", entries: uniqueCanonical(entries) } };
}

function bindServiceRelations(
  book: AtomicPricingBook,
  modelOffers: ReadonlyMap<string, string>,
): void {
  if (book.scope.kind !== "provider_resource") return;
  for (const offer of book.offers) {
    const modelRef = offer.offer_key.startsWith("request:")
      ? offer.offer_key.slice("request:".length)
      : undefined;
    const target = modelRef === undefined ? undefined : modelOffers.get(modelRef);
    if (target !== undefined)
      offer.relations.push(
        relation(
          offer,
          "compatible_with",
          [target],
          "This request component is compatible with the model's online offer",
        ),
      );
  }
}

function title(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
