import type {
  AtomicPricingBook,
  AtomicPricingOffer,
  AtomicPricingTerm,
  AtomicProviderPricing,
  AtomicRateVariant,
  AtomicRawVariant,
} from "./pricing-assembly.ts";
import { canonicalJson } from "./canonical-json.ts";
import { uniqueCanonicalValues as uniqueCanonical } from "./canonical-value.ts";
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
import type {
  ChargeBinding,
  PriceApplicability,
  PriceCondition,
  PriceDimension,
  PriceMeter,
  PriceSelectorSource,
  UnitExpression,
  UsageQuantityNode,
  UsageQuantityMethod,
  UsageSignal,
} from "./pricing-schema.ts";
import {
  emptyQuantityMethods as emptyMethods,
  indexPricingInputs,
  mergeQuantityMethods as mergeMethods,
  pricingInputFacts,
  pricingInputObservation,
  usageInputSources,
  type BoundQuantityMethods as MethodsAndFacts,
  type PricingInputIndex,
} from "./pricing-input.ts";
import type { SourcePricingInputFact } from "./pricing-source.ts";
import type { ProviderModel } from "./schema.ts";

type Mechanism = "sync" | "batch";
type PublishedModel = Pick<ProviderModel, "tasks" | "uid">;

const servedTier = { namespace: "kmodels", value: "served_service_tier" } as const;

export function applyGeminiCommercialTopology(
  input: AtomicProviderPricing,
  models: readonly PublishedModel[],
  pricingInputs: readonly SourcePricingInputFact[],
): AtomicProviderPricing {
  const inputIndex = indexPricingInputs(pricingInputs);
  const modelByRef = new Map(models.map((model) => [model.uid, model]));
  const modelOffers = new Map<string, string>();
  const books = input.books.map((book) => {
    if (book.scope.kind !== "models") return bindGroundingBook(book, input, inputIndex);
    const model =
      book.scope.model_refs.length === 1 ? modelByRef.get(book.scope.model_refs[0]!) : undefined;
    const migrated = splitModelBook(book, model, input, inputIndex);
    if (migrated.offers.some(({ offer_key }) => offer_key === "sync")) {
      const ref = pricingOfferId(pricingBookId(input.provider_id, book.book_key), "sync");
      for (const modelRef of book.scope.model_refs) modelOffers.set(modelRef, ref);
    }
    return migrated;
  });
  for (const book of books) bindGroundingRelations(book, modelOffers);
  return { ...input, books };
}

function splitModelBook(
  book: AtomicPricingBook,
  model: PublishedModel | undefined,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): AtomicPricingBook {
  return {
    ...book,
    offers: book.offers.flatMap((offer) => {
      if (offer.offer_key !== "usage") return [offer];
      return (["sync", "batch"] as const)
        .map((mechanism) => partitionOffer(offer, mechanism, model, input, inputIndex))
        .filter((candidate): candidate is AtomicPricingOffer => candidate !== undefined);
    }),
  };
}

function partitionOffer(
  offer: AtomicPricingOffer,
  mechanism: Mechanism,
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
    partitionTerm(term, mechanism, model, input, inputIndex, rateMeters),
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
      model,
      input,
      inputIndex,
      rateMeters,
    );
    const selector_sources = selectorSources(applicability, mechanism, model, inputIndex);
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
    const batch = values.includes("batch");
    if ((mechanism === "batch") !== batch) return [];
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
          definition: `Gemini response-reported served service tier ${JSON.stringify(value.value)}`,
          label: value.value.charAt(0).toUpperCase() + value.value.slice(1),
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

function modelBinding(
  meter: PriceMeter,
  variant: AtomicRateVariant,
  mechanism: Mechanism,
  model: PublishedModel | undefined,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
  rateMeters: readonly PriceMeter[],
): ChargeBinding | undefined {
  const aggregation = mechanism === "batch" ? "result_item" : "request";
  if (meter.namespace !== "kmodels") return;
  if (isStandardUnit(variant.price.per, "image") && meter.value === "image_generation") {
    const signal = standardSignal("generated_images");
    return quantityBinding(
      signal,
      aggregation,
      directMethods(signal, ["generate.output.images"], mechanism, inputIndex),
      variant,
    );
  }
  if (isStandardUnit(variant.price.per, "second") && meter.value === "video_generation")
    return quantityBinding(
      standardSignal("generated_seconds"),
      "result_item",
      directMethods(
        standardSignal("generated_seconds"),
        ["video.request.duration_seconds"],
        mechanism,
        inputIndex,
      ),
      variant,
    );
  if (!isStandardUnit(variant.price.per, "token")) return;

  if (meter.value.startsWith("input_")) {
    const modality = meter.value.slice("input_".length);
    const embedding = model?.tasks.includes("embeddings") === true;
    const signal = providerSignal(
      input,
      `${embedding ? "embedding" : "uncached"}_input_${
        modality === "image" ? "image_rate" : modality
      }_tokens`,
      modality === "image"
        ? `Gemini ${embedding ? "embedding " : "uncached "}image and document tokens billed at the image input rate`
        : `Gemini ${embedding ? "embedding" : "uncached"} ${modality} input tokens`,
      variant.price.per,
    );
    return quantityBinding(
      signal,
      aggregation,
      embedding
        ? embeddingInputMethods(signal, modality, mechanism, input, inputIndex, variant.price.per)
        : uncachedInputMethods(modality, mechanism, input, inputIndex, variant.price.per),
      variant,
    );
  }
  if (meter.value.startsWith("cache_read_")) {
    const modality = meter.value.slice("cache_read_".length);
    const signal = providerSignal(
      input,
      modality === "image" ? "cached_input_image_rate_tokens" : `cached_input_${modality}_tokens`,
      modality === "image"
        ? "Cached Gemini image and document tokens billed at the image cache-read rate"
        : `Cached Gemini ${modality} input tokens`,
      variant.price.per,
    );
    return quantityBinding(
      signal,
      aggregation,
      cachedInputMethods(modality, mechanism, input, inputIndex, variant.price.per),
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
      `Gemini ${modality} candidate-output tokens`,
      variant.price.per,
    );
    return quantityBinding(
      signal,
      aggregation,
      directFamilyMethods(signal, "candidates", modality, mechanism, inputIndex),
      variant,
    );
  }
}

function quantityBinding(
  signal: UsageSignal,
  aggregation: "request" | "result_item",
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
  const facts = pricingInputs(inputIndex, keys, mechanism);
  return facts.length === 0
    ? emptyMethods()
    : { methods: [{ input_sources: usageInputSources(signal, facts) }], facts };
}

function directFamilyMethods(
  signal: UsageSignal,
  category: "cache" | "candidates",
  modality: string,
  mechanism: Mechanism,
  inputIndex: PricingInputIndex,
): MethodsAndFacts {
  return mergeMethods(
    sourceFamilies(mechanism).map((family) =>
      directMethods(signal, [`${family}.${category}.${modality}`], mechanism, inputIndex),
    ),
  );
}

function uncachedInputMethods(
  modality: string,
  mechanism: Mechanism,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
  unit: UnitExpression,
): MethodsAndFacts {
  const billedModalities = modality === "image" ? ["image", "document"] : [modality];
  const inputs = billedModalities.map((value) => ({
    prompt: providerSignal(
      input,
      `reported_prompt_${value}_tokens`,
      `Gemini reported ${value} prompt tokens including cached content`,
      unit,
    ),
    cached: providerSignal(
      input,
      `reported_cached_${value}_tokens`,
      `Gemini reported cached ${value} prompt tokens`,
      unit,
    ),
  }));
  const nodes: UsageQuantityNode[] = inputs.flatMap(({ prompt, cached }, index) => {
    const offset = index * 3;
    return [
      { op: "signal" as const, signal: prompt },
      { op: "signal" as const, signal: cached },
      { op: "subtract_floor_zero" as const, minuend: offset, subtrahend: offset + 1 },
    ];
  });
  if (inputs.length > 1)
    nodes.push({
      op: "sum",
      inputs: inputs.map((_value, index) => index * 3 + 2),
    });
  const result = nodes.length - 1;
  return mergeMethods(
    sourceFamilies(mechanism).map((family) =>
      calculationMethod(
        { nodes, result },
        inputs.flatMap(({ prompt, cached }, index) => [
          { signal: prompt, keys: [`${family}.prompt.${billedModalities[index]}`] },
          { signal: cached, keys: [`${family}.cache.${billedModalities[index]}`] },
        ]),
        mechanism,
        inputIndex,
      ),
    ),
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
    "Gemini reported image embedding-input tokens",
    unit,
  );
  const document = providerSignal(
    input,
    "reported_embedding_document_tokens",
    "Gemini reported document embedding-input tokens",
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
  modality: string,
  mechanism: Mechanism,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
  unit: UnitExpression,
): MethodsAndFacts {
  if (modality !== "image")
    return directFamilyMethods(
      providerSignal(
        input,
        `cached_input_${modality}_tokens`,
        `Cached Gemini ${modality} input tokens`,
        unit,
      ),
      "cache",
      modality,
      mechanism,
      inputIndex,
    );
  const image = providerSignal(
    input,
    "reported_cached_image_tokens",
    "Gemini reported cached image tokens",
    unit,
  );
  const document = providerSignal(
    input,
    "reported_cached_document_tokens",
    "Gemini reported cached document tokens",
    unit,
  );
  const calculation = {
    nodes: [
      { op: "signal" as const, signal: image },
      { op: "signal" as const, signal: document },
      { op: "sum" as const, inputs: [0, 1] },
    ],
    result: 2,
  };
  return mergeMethods(
    sourceFamilies(mechanism).map((family) =>
      calculationMethod(
        calculation,
        [
          { signal: image, keys: [`${family}.cache.image`] },
          { signal: document, keys: [`${family}.cache.document`] },
        ],
        mechanism,
        inputIndex,
      ),
    ),
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
    "Gemini text candidate-output tokens excluding thoughts",
    unit,
  );
  const total = providerSignal(
    input,
    "candidate_output_tokens",
    "Gemini aggregate candidate-output tokens excluding thoughts",
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
  return mergeMethods(
    sourceFamilies(mechanism).flatMap((family) => [
      calculationMethod(
        calculation(text),
        [
          { signal: text, keys: [`${family}.candidates.text`] },
          { signal: thoughts, keys: [`${family}.thoughts`] },
        ],
        mechanism,
        inputIndex,
      ),
      ...(allowAggregate
        ? [
            calculationMethod(
              calculation(total),
              [
                { signal: total, keys: [`${family}.candidates.total`] },
                { signal: thoughts, keys: [`${family}.thoughts`] },
              ],
              mechanism,
              inputIndex,
            ),
          ]
        : []),
    ]),
  );
}

function calculationMethod(
  calculation: NonNullable<UsageQuantityMethod["calculation"]>,
  requirements: ReadonlyArray<{ signal: UsageSignal; keys: readonly string[] }>,
  mechanism: Mechanism,
  inputIndex: PricingInputIndex,
): MethodsAndFacts {
  const mapped = requirements.map(({ signal, keys }) => ({
    signal,
    facts: pricingInputs(inputIndex, keys, mechanism),
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

function sourceFamilies(mechanism: Mechanism): readonly ("generate" | "interaction")[] {
  return mechanism === "batch" ? ["generate"] : ["generate", "interaction"];
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

function bindGroundingBook(
  book: AtomicPricingBook,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): AtomicPricingBook {
  if (
    book.scope.kind !== "provider_resource" ||
    !["google-search", "google-maps"].includes(book.scope.resource_key)
  )
    return book;
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
            charge_binding: groundingBinding(resourceKey, variant, input, inputIndex),
          })),
        };
      }),
    })),
  };
}

function groundingBinding(
  resourceKey: string,
  variant: AtomicRateVariant,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): ChargeBinding {
  const maps = resourceKey === "google-maps";
  const request = isStandardUnit(variant.price.per, "request");
  const key = `${maps ? "maps" : "search"}_${request ? "grounded_prompts" : "executed_queries"}`;
  addAtom(input, {
    kind: "usage_signal",
    key,
    definition: request
      ? `Qualifying Gemini ${maps ? "Maps" : "Search"} grounded prompts reported by the interaction or generated result`
      : `Gemini ${maps ? "Maps" : "Search"} queries reported by the interaction or generated result`,
    unit: variant.price.per,
    resolution_phase: "outcome",
  });
  const signal = { namespace: "provider", provider_id: input.provider_id, value: key } as const;
  const keys = request
    ? [`generate.grounding.${maps ? "google_maps_result" : "google_search_result"}`]
    : [
        `interaction.grounding.${maps ? "google_maps" : "google_search"}`,
        ...(maps ? [] : ["generate.grounding.google_search_queries"]),
      ];
  const mechanism = applicabilityHasValue(variant.applicability, "service_tier", "batch")
    ? "batch"
    : "sync";
  return quantityBinding(
    signal,
    mechanism === "batch" ? "result_item" : "request",
    directMethods(signal, keys, mechanism, inputIndex),
    variant,
  );
}

function selectorSources(
  applicability: PriceApplicability,
  mechanism: Mechanism,
  model: PublishedModel | undefined,
  inputIndex: PricingInputIndex,
): PriceSelectorSource[] {
  const dimensions = new Map<string, PriceDimension>();
  for (const { all_of } of applicability.any_of)
    for (const { dimension } of all_of) dimensions.set(canonicalJson(dimension), dimension);
  return uniqueCanonical(
    [...dimensions.values()].flatMap((dimension): PriceSelectorSource[] => {
      if (dimension.namespace !== "kmodels") return [];
      const keys =
        dimension.value === "served_service_tier"
          ? ["generate.service_tier"]
          : dimension.value === "context_tokens"
            ? ["generate.prompt.total", "interaction.prompt.total"]
            : dimension.value === "resolution" && model?.tasks.includes("video_generation") === true
              ? ["video.request.resolution"]
              : dimension.value === "request_audio" &&
                  model?.tasks.includes("video_generation") === true
                ? ["video.request.generate_audio"]
                : [];
      const facts = pricingInputs(inputIndex, keys, mechanism);
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
  const entries = values.flatMap((value) => {
    if (value.value !== "standard" && value.value !== "flex" && value.value !== "priority")
      return [];
    return [
      ...(value.value === "standard" ? [{ source_value: "unspecified", value }] : []),
      { source_value: value.value, value },
    ];
  });
  return entries.length === 0
    ? {}
    : { normalization: { kind: "categorical_map", entries: uniqueCanonical(entries) } };
}

function pricingInputs(
  inputIndex: PricingInputIndex,
  keys: readonly string[],
  mechanism: Mechanism,
): SourcePricingInputFact[] {
  return pricingInputFacts(inputIndex, keys).filter(
    ({ channel }) => (mechanism === "batch") === (channel === "result"),
  );
}

function applicabilityHasValue(
  applicability: PriceApplicability,
  dimension: string,
  value: string,
): boolean {
  return applicability.any_of.some(({ all_of }) =>
    all_of.some(
      (condition) =>
        condition.kind === "categorical" &&
        condition.dimension.namespace === "kmodels" &&
        condition.dimension.value === dimension &&
        condition.values.some((candidate) => candidate.value === value),
    ),
  );
}

function bindGroundingRelations(
  book: AtomicPricingBook,
  modelOffers: ReadonlyMap<string, string>,
): void {
  if (
    book.scope.kind !== "provider_resource" ||
    !["google-search", "google-maps"].includes(book.scope.resource_key)
  )
    return;
  for (const offer of book.offers) {
    const modelRef = offer.offer_key.startsWith("grounding:")
      ? offer.offer_key.slice("grounding:".length)
      : undefined;
    const target = modelRef === undefined ? undefined : modelOffers.get(modelRef);
    if (target !== undefined)
      offer.relations.push(
        relation(
          offer,
          "compatible_with",
          [target],
          "Grounding is compatible with this model's online inference offer",
        ),
      );
  }
}
