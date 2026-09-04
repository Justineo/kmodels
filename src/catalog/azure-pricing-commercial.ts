import { canonicalJson } from "./canonical-json.ts";
import { compareCanonicalValues } from "./canonical-value.ts";
import type {
  AtomicPricingBook,
  AtomicPricingOffer,
  AtomicPricingTerm,
  AtomicProviderPricing,
  AtomicRateVariant,
} from "./pricing-assembly.ts";
import { canonicalizeApplicability } from "./pricing-canonical.ts";
import {
  addAtom,
  isStandardUnit,
  rawEvidence,
  standardSignal,
  unitIdentityKey,
  withApplicability,
} from "./pricing-commercial-assembly.ts";
import {
  indexPricingInputs,
  includePricingInputSourceRefs,
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
  UsageSignal,
} from "./pricing-schema.ts";
import type { SourcePricingInputFact } from "./pricing-source.ts";
import type { ProviderModel } from "./schema.ts";

type PublishedModel = Pick<ProviderModel, "api_endpoints" | "model_id" | "tasks" | "uid">;
type Mechanism = "sync" | "batch";

interface SignalSpec {
  signal: UsageSignal;
  directKeys: string[];
}

const servedTier = { namespace: "kmodels" as const, value: "served_service_tier" as const };
const requestServices = new Set([
  "computer-use",
  "responses-code-interpreter",
  "responses-file-search",
  "responses-web-search",
]);

export function applyAzureCommercialTopology(
  input: AtomicProviderPricing,
  publishedModels: readonly PublishedModel[],
  pricingInputs: readonly SourcePricingInputFact[],
): AtomicProviderPricing {
  const models = new Map(publishedModels.map((model) => [model.uid, model]));
  const inputIndex = indexPricingInputs(pricingInputs);
  const books = input.books
    .flatMap((book): AtomicPricingBook[] => {
      if (book.scope.kind === "provider_resource")
        return admittedResource(book.scope.resource_key)
          ? [bindResourceBook(book, input, inputIndex)]
          : [];
      const migrated = migrateModelBook(book, input, models, inputIndex);
      return migrated.offers.length === 0 ? [] : [migrated];
    })
    .map(includePricingInputSourceRefs);
  return { ...input, books };
}

function admittedResource(key: string): boolean {
  return requestServices.has(key) || key.startsWith("unclassified-built-in:");
}

function bindResourceBook(
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
      relations: [],
      terms: offer.terms.map((term) => bindResourceTerm(resourceKey, term, input, inputIndex)),
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
      const spec = resourceSignal(resourceKey, term.meter, variant.price.per, input);
      const facts = pricingInputFacts(inputIndex, spec.directKeys);
      return {
        ...variant,
        charge_binding: directBinding(
          spec.signal,
          resourceAggregation(resourceKey, term.meter),
          facts,
          variant,
        ),
      };
    }),
  };
}

function resourceSignal(
  resourceKey: string,
  meter: PriceMeter,
  unit: UnitExpression,
  input: AtomicProviderPricing,
): SignalSpec {
  if (resourceKey === "computer-use" && isStandardUnit(unit, "token")) {
    if (isMeter(meter, "input_text"))
      return { signal: standardSignal("input_tokens"), directKeys: ["responses.input_tokens"] };
    if (isMeter(meter, "output_text"))
      return { signal: standardSignal("output_tokens"), directKeys: ["responses.output_tokens"] };
  }
  const key = `${resourceKey}_${meter.value}_${unitIdentityKey(unit)}`.replace(
    /[^a-zA-Z0-9_]+/g,
    "_",
  );
  return {
    signal: providerSignal(
      input,
      key,
      `Azure ${resourceKey} ${meter.value.replaceAll("_", " ")} billable quantity`,
      unit,
    ),
    directKeys: [],
  };
}

function resourceAggregation(resourceKey: string, meter: PriceMeter): ChargeBinding["aggregation"] {
  if (isMeter(meter, "code_execution")) return "session";
  return resourceKey === "computer-use" ? "attempt" : "result_item";
}

function migrateModelBook(
  book: AtomicPricingBook,
  input: AtomicProviderPricing,
  models: ReadonlyMap<string, PublishedModel>,
  inputIndex: PricingInputIndex,
): AtomicPricingBook {
  const model =
    book.scope.kind === "models" ? models.get(book.scope.model_refs[0] ?? "") : undefined;
  const offers = book.offers.flatMap((offer): AtomicPricingOffer[] => {
    if (offer.offer_key === "capacity") return [];
    if (offer.offer_key !== "usage")
      return [{ ...offer, enrollment: [], settlement: [], relations: [] }];
    return [
      partitionOffer(offer, "sync", input, model, inputIndex),
      partitionOffer(offer, "batch", input, model, inputIndex),
    ].filter((value): value is AtomicPricingOffer => value !== undefined);
  });
  return { ...book, resource_edges: [], offers };
}

function partitionOffer(
  source: AtomicPricingOffer,
  mechanism: Mechanism,
  input: AtomicProviderPricing,
  model: PublishedModel | undefined,
  inputIndex: PricingInputIndex,
): AtomicPricingOffer | undefined {
  const router = model?.model_id === "model-router" && mechanism === "sync";
  const states = source.states.flatMap((state) => {
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
  const rateMeters = source.terms.flatMap((term) =>
    term.kind === "rate" &&
    term.variants.some(({ applicability }) => permitsMechanism(applicability, mechanism))
      ? [term.meter]
      : [],
  );
  const terms = source.terms.flatMap((term) =>
    partitionTerm(term, mechanism, input, router, model, inputIndex, rateMeters),
  );
  if (states.length === 0 && terms.length === 0) return;
  return {
    ...source,
    offer_key: router ? "router" : mechanism,
    name: router
      ? "Model Router"
      : mechanism === "batch"
        ? "Batch inference"
        : "Synchronous PAYG inference",
    enrollment: [],
    settlement: [],
    relations: [],
    states,
    terms,
  };
}

function partitionTerm(
  term: AtomicPricingTerm,
  mechanism: Mechanism,
  input: AtomicProviderPricing,
  router: boolean,
  model: PublishedModel | undefined,
  inputIndex: PricingInputIndex,
  rateMeters: readonly PriceMeter[],
): AtomicPricingTerm[] {
  if (term.kind === "raw") {
    const variants = term.variants.flatMap((variant) => {
      if (variant.possible_scope === undefined) return mechanism === "sync" ? [variant] : [];
      const possible_scope = mechanismApplicability(variant.possible_scope, mechanism, input);
      return possible_scope === undefined ? [] : [{ ...variant, possible_scope }];
    });
    return variants.length === 0 ? [] : [{ ...term, variants }];
  }
  if (term.kind !== "rate") return mechanism === "sync" ? [term] : [];
  if (isMeter(term.meter, "provisioned_capacity")) return [];
  const meter = router && isMeter(term.meter, "input_text") ? routerMeter(input) : term.meter;
  const variants = term.variants.flatMap((variant) => {
    const applicability = mechanismApplicability(variant.applicability, mechanism, input);
    if (applicability === undefined) return [];
    const next = {
      ...variant,
      applicability,
      observation: withApplicability(variant.observation, applicability),
    };
    const charge_binding = modelChargeBinding(
      meter,
      next,
      mechanism,
      model,
      input,
      inputIndex,
      rateMeters,
    );
    const selector_sources = selectorSources(applicability, mechanism, model, inputIndex);
    return [
      {
        ...next,
        charge_binding,
        ...(selector_sources.length === 0 ? {} : { selector_sources }),
      },
    ];
  });
  const raw_variants = term.raw_variants.flatMap((variant) => {
    if (variant.possible_scope === undefined) return mechanism === "sync" ? [variant] : [];
    const possible_scope = mechanismApplicability(variant.possible_scope, mechanism, input);
    return possible_scope === undefined ? [] : [{ ...variant, possible_scope }];
  });
  if (variants.length + raw_variants.length === 0) return [];
  return [
    {
      ...term,
      term_key: router && isMeter(term.meter, "input_text") ? "model_router_input" : term.term_key,
      meter,
      variants,
      raw_variants,
    },
  ];
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
          definition: `Azure served service tier ${JSON.stringify(value.value)} that selects the published rate`,
          label: value.value === "priority" ? "Priority" : "Standard",
        });
        return value;
      }),
    };
    return [{ all_of: all_of.map((item) => (item === tier ? realized : item)) }];
  });
  return any_of.length === 0 ? undefined : canonicalizeApplicability({ any_of });
}

function permitsMechanism(applicability: PriceApplicability, mechanism: Mechanism): boolean {
  return applicability.any_of.some(({ all_of }) => {
    const tier = all_of.find(isServiceTier);
    const batch =
      tier?.kind === "categorical" && tier.values.some(({ value }) => value === "batch");
    return (mechanism === "batch") === batch;
  });
}

function modelChargeBinding(
  meter: PriceMeter,
  variant: AtomicRateVariant,
  mechanism: Mechanism,
  model: PublishedModel | undefined,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
  rateMeters: readonly PriceMeter[],
): ChargeBinding {
  const spec = modelSignal(meter, variant.price.per, mechanism, model, input);
  const quantity = quantityMethods(spec, meter, mechanism, model, rateMeters, inputIndex);
  return {
    signal: spec.signal,
    aggregation:
      mechanism === "batch"
        ? "job"
        : isStandardUnit(variant.price.per, "second") &&
            (isMeter(meter, "video_generation") || isMeter(meter, "output_video"))
          ? "result_item"
          : "attempt",
    ...(quantity.methods.length === 0 ? {} : { quantity_methods: quantity.methods }),
    observations: [
      rawEvidence(variant.observation),
      ...quantity.facts.map(pricingInputObservation),
    ].sort(compareCanonicalValues),
  };
}

function modelSignal(
  meter: PriceMeter,
  unit: UnitExpression,
  mechanism: Mechanism,
  model: PublishedModel | undefined,
  input: AtomicProviderPricing,
): SignalSpec {
  if (meter.namespace === "provider" && meter.value === "model_router_input")
    return {
      signal: providerSignal(
        input,
        `router_input_${unitIdentityKey(unit)}`,
        "Azure Model Router input-token markup quantity",
        unit,
      ),
      directKeys: inputTokenKeys(model, mechanism),
    };
  if (isStandardUnit(unit, "token")) {
    if (isMeter(meter, "input_text"))
      return {
        signal: standardSignal("uncached_input_tokens"),
        directKeys: inputTextKeys(model, mechanism),
      };
    if (isMeter(meter, "cache_read_text"))
      return {
        signal: standardSignal("cached_input_tokens"),
        directKeys: cachedInputKeys(model, mechanism),
      };
    if (isMeter(meter, "cache_write_text"))
      return {
        signal: standardSignal("cache_write_tokens"),
        directKeys: mechanism === "sync" ? endpointKeys(model, "chat.cache_write_tokens", []) : [],
      };
    if (isMeter(meter, "output_text"))
      return {
        signal: standardSignal("output_tokens"),
        directKeys: outputTokenKeys(model, mechanism),
      };
    if (isMeter(meter, "embedding"))
      return {
        signal: standardSignal("input_tokens"),
        directKeys:
          mechanism === "sync" && hasEndpoint(model, "openai/v1/embeddings")
            ? ["embeddings.input_tokens"]
            : [],
      };
    if (isMeter(meter, "input_audio"))
      return providerModelSignal(
        input,
        "input_audio_tokens",
        "Billable audio-input tokens",
        unit,
        endpointKeys(model, "chat.input_audio_tokens", []),
      );
    if (isMeter(meter, "output_audio"))
      return providerModelSignal(
        input,
        "output_audio_tokens",
        "Billable audio-output tokens",
        unit,
        endpointKeys(model, "chat.output_audio_tokens", []),
      );
    if (isMeter(meter, "input_image"))
      return providerModelSignal(
        input,
        "input_image_tokens",
        "Billable image-input tokens",
        unit,
        model?.tasks.includes("image_generation") === true ? ["images.input_image_tokens"] : [],
      );
    if (isMeter(meter, "output_image"))
      return providerModelSignal(
        input,
        "output_image_tokens",
        "Billable image-output tokens",
        unit,
        model?.tasks.includes("image_generation") === true ? ["images.output_image_tokens"] : [],
      );
  }
  if (isStandardUnit(unit, "image")) {
    if (isMeter(meter, "input_image") || isMeter(meter, "embedding"))
      return { signal: standardSignal("processed_images"), directKeys: [] };
    if (isMeter(meter, "output_image") || isMeter(meter, "image_generation"))
      return {
        signal: standardSignal("generated_images"),
        directKeys:
          model?.tasks.includes("image_generation") === true ? ["images.generated_images"] : [],
      };
  }
  if (isStandardUnit(unit, "page"))
    return { signal: standardSignal("processed_pages"), directKeys: [] };
  if (isStandardUnit(unit, "request"))
    return { signal: standardSignal("accepted_requests"), directKeys: [] };
  if (isStandardUnit(unit, "character") && isMeter(meter, "output_audio"))
    return { signal: standardSignal("input_characters"), directKeys: [] };
  if (isStandardUnit(unit, "second")) {
    if (
      (isMeter(meter, "input_audio") || isMeter(meter, "transcription")) &&
      model?.tasks.some((task) => task === "transcription" || task === "translation")
    )
      return {
        signal: standardSignal("processed_audio_seconds"),
        directKeys: [
          ...(model.tasks.includes("transcription") ? ["audio.transcription_seconds"] : []),
          ...(model.tasks.includes("translation") ? ["audio.translation_seconds"] : []),
        ],
      };
    if (isMeter(meter, "video_generation") || isMeter(meter, "output_video"))
      return {
        signal: standardSignal("generated_seconds"),
        directKeys:
          model?.tasks.includes("video_generation") === true ? ["video.generated_seconds"] : [],
      };
  }
  const key = `${mechanism}_${meter.value}_${unitIdentityKey(unit)}`;
  return providerModelSignal(
    input,
    key,
    `Azure ${mechanism} ${meter.value.replaceAll("_", " ")} billable quantity`,
    unit,
    [],
  );
}

function quantityMethods(
  spec: SignalSpec,
  meter: PriceMeter,
  mechanism: Mechanism,
  model: PublishedModel | undefined,
  rateMeters: readonly PriceMeter[],
  inputIndex: PricingInputIndex,
): MethodsAndFacts {
  if (isMeter(meter, "input_text") && isStandardSignal(spec.signal, "uncached_input_tokens"))
    return uncachedInputMethods(mechanism, model, rateMeters, inputIndex);
  if (
    isMeter(meter, "cache_read_text") &&
    rateMeters.some(
      (candidate) =>
        isMeter(candidate, "cache_read_audio") ||
        isMeter(candidate, "cache_read_image") ||
        isMeter(candidate, "cache_read_video"),
    )
  )
    return { methods: [], facts: [] };
  if (
    isMeter(meter, "cache_write_text") &&
    rateMeters.some(
      (candidate) =>
        isMeter(candidate, "cache_write_audio") ||
        isMeter(candidate, "cache_write_image") ||
        isMeter(candidate, "cache_write_video"),
    )
  )
    return { methods: [], facts: [] };
  if (
    isMeter(meter, "input_audio") &&
    rateMeters.some((candidate) => isMeter(candidate, "cache_read_audio"))
  )
    return { methods: [], facts: [] };
  if (
    isMeter(meter, "output_text") &&
    rateMeters.some(
      (candidate) => isMeter(candidate, "output_image") || isMeter(candidate, "output_video"),
    )
  )
    return { methods: [], facts: [] };
  if (
    isMeter(meter, "output_text") &&
    mechanism === "sync" &&
    rateMeters.some((candidate) => isMeter(candidate, "output_audio"))
  )
    return textOutputMethods(model, inputIndex);
  const facts = pricingInputFacts(inputIndex, spec.directKeys);
  return {
    methods: facts.length === 0 ? [] : [{ input_sources: usageInputSources(spec.signal, facts) }],
    facts,
  };
}

function uncachedInputMethods(
  mechanism: Mechanism,
  model: PublishedModel | undefined,
  rateMeters: readonly PriceMeter[],
  inputIndex: PricingInputIndex,
): MethodsAndFacts {
  const subtractCached = rateMeters.some((meter) => isMeter(meter, "cache_read_text"));
  const subtractWritten = rateMeters.some((meter) => isMeter(meter, "cache_write_text"));
  const subtractAudio = rateMeters.some((meter) => isMeter(meter, "input_audio"));
  const separatelyPricedImage = rateMeters.some((meter) => isMeter(meter, "input_image"));
  if (separatelyPricedImage && model?.tasks.includes("image_generation") !== true)
    return { methods: [], facts: [] };
  if (!subtractCached && !subtractWritten && !subtractAudio) {
    const signal = standardSignal("uncached_input_tokens");
    const facts = pricingInputFacts(inputIndex, inputTextKeys(model, mechanism));
    return {
      methods: facts.length === 0 ? [] : [{ input_sources: usageInputSources(signal, facts) }],
      facts,
    };
  }

  const families = mechanism === "batch" ? ["batch"] : inferenceFamilies(model);
  return mergeMethods(
    families.map((family) => {
      const requirements = [
        { signal: standardSignal("input_tokens"), key: `${family}.input_tokens` },
        ...(subtractCached
          ? [
              {
                signal: standardSignal("cached_input_tokens"),
                key: `${family}.cached_input_tokens`,
              },
            ]
          : []),
        ...(subtractWritten
          ? [{ signal: standardSignal("cache_write_tokens"), key: `${family}.cache_write_tokens` }]
          : []),
        ...(subtractAudio
          ? [
              {
                signal: providerSignalValue("input_audio_tokens"),
                key: `${family}.input_audio_tokens`,
              },
            ]
          : []),
      ];
      return subtractionMethod(requirements, inputIndex);
    }),
  );
}

function textOutputMethods(
  model: PublishedModel | undefined,
  inputIndex: PricingInputIndex,
): MethodsAndFacts {
  return mergeMethods(
    inferenceFamilies(model).map((family) =>
      subtractionMethod(
        [
          { signal: standardSignal("output_tokens"), key: `${family}.output_tokens` },
          {
            signal: providerSignalValue("output_audio_tokens"),
            key: `${family}.output_audio_tokens`,
          },
        ],
        inputIndex,
      ),
    ),
  );
}

function subtractionMethod(
  requirements: ReadonlyArray<{ signal: UsageSignal; key: string }>,
  inputIndex: PricingInputIndex,
): MethodsAndFacts {
  const mapped = requirements.map(({ signal, key }) => ({
    signal,
    facts: pricingInputFacts(inputIndex, [key]),
  }));
  if (mapped.some(({ facts }) => facts.length === 0)) return { methods: [], facts: [] };
  const nodes: NonNullable<UsageQuantityMethod["calculation"]>["nodes"] = [
    { op: "signal", signal: mapped[0]!.signal },
  ];
  let result = 0;
  for (const { signal } of mapped.slice(1)) {
    nodes.push({ op: "signal", signal });
    nodes.push({ op: "subtract_floor_zero", minuend: result, subtrahend: nodes.length - 1 });
    result = nodes.length - 1;
  }
  const facts = mapped.flatMap(({ facts: values }) => values);
  return {
    methods: [
      {
        calculation: { nodes, result },
        input_sources: mapped
          .flatMap(({ signal, facts: values }) => usageInputSources(signal, values))
          .sort(compareCanonicalValues),
      },
    ],
    facts,
  };
}

function selectorSources(
  applicability: PriceApplicability,
  mechanism: Mechanism,
  model: PublishedModel | undefined,
  inputIndex: PricingInputIndex,
): PriceSelectorSource[] {
  const result: PriceSelectorSource[] = [];
  for (const dimension of applicabilityDimensions(applicability)) {
    if (dimension.namespace !== "kmodels") continue;
    const keys =
      dimension.value === "context_tokens"
        ? mechanism === "sync"
          ? inputTokenKeys(model, mechanism)
          : []
        : dimension.value === "quality" && model?.tasks.includes("image_generation") === true
          ? ["images.quality"]
          : dimension.value === "resolution" && model?.tasks.includes("image_generation") === true
            ? ["images.resolution"]
            : [];
    for (const fact of pricingInputFacts(inputIndex, keys))
      result.push({
        dimension,
        channel: fact.channel,
        locator: fact.locator,
        availability: fact.availability,
        observations: [pricingInputObservation(fact)],
      });
  }
  return result.sort(compareCanonicalValues);
}

function applicabilityDimensions(applicability: PriceApplicability): PriceDimension[] {
  return [
    ...new Map(
      applicability.any_of.flatMap(({ all_of }) =>
        all_of.map(({ dimension }) => [canonicalJson(dimension), dimension]),
      ),
    ).values(),
  ];
}

function directBinding(
  signal: UsageSignal,
  aggregation: ChargeBinding["aggregation"],
  facts: readonly SourcePricingInputFact[],
  variant: AtomicRateVariant,
): ChargeBinding {
  return {
    signal,
    aggregation,
    ...(facts.length === 0
      ? {}
      : { quantity_methods: [{ input_sources: usageInputSources(signal, facts) }] }),
    observations: [rawEvidence(variant.observation), ...facts.map(pricingInputObservation)].sort(
      compareCanonicalValues,
    ),
  };
}

function inputTextKeys(model: PublishedModel | undefined, mechanism: Mechanism): string[] {
  if (mechanism === "batch") return ["batch.input_tokens"];
  if (model?.tasks.includes("image_generation") === true) return ["images.input_text_tokens"];
  return inputTokenKeys(model, mechanism);
}

function inputTokenKeys(model: PublishedModel | undefined, mechanism: Mechanism): string[] {
  if (mechanism === "batch") return ["batch.input_tokens"];
  if (model?.tasks.includes("image_generation") === true) return ["images.input_tokens"];
  return inferenceFamilies(model).map((family) => `${family}.input_tokens`);
}

function cachedInputKeys(model: PublishedModel | undefined, mechanism: Mechanism): string[] {
  return mechanism === "batch"
    ? ["batch.cached_input_tokens"]
    : inferenceFamilies(model).map((family) => `${family}.cached_input_tokens`);
}

function outputTokenKeys(model: PublishedModel | undefined, mechanism: Mechanism): string[] {
  return mechanism === "batch"
    ? ["batch.output_tokens"]
    : inferenceFamilies(model).map((family) => `${family}.output_tokens`);
}

function inferenceFamilies(model: PublishedModel | undefined): string[] {
  return [
    ...(hasEndpoint(model, "openai/v1/chat/completions") ||
    hasEndpoint(model, "openai/v1/completions")
      ? ["chat"]
      : []),
    ...(hasEndpoint(model, "openai/v1/responses") ? ["responses"] : []),
  ];
}

function endpointKeys(
  model: PublishedModel | undefined,
  chatKey: string,
  responseKeys: readonly string[],
): string[] {
  return [
    ...(hasEndpoint(model, "openai/v1/chat/completions") ||
    hasEndpoint(model, "openai/v1/completions")
      ? [chatKey]
      : []),
    ...(hasEndpoint(model, "openai/v1/responses") ? responseKeys : []),
  ];
}

function hasEndpoint(model: PublishedModel | undefined, path: string): boolean {
  return model?.api_endpoints?.some((endpoint) => endpoint.path === path) === true;
}

function providerModelSignal(
  input: AtomicProviderPricing,
  key: string,
  definition: string,
  unit: UnitExpression,
  directKeys: string[],
): SignalSpec {
  return { signal: providerSignal(input, key, definition, unit), directKeys };
}

function providerSignal(
  input: AtomicProviderPricing,
  key: string,
  definition: string,
  unit: UnitExpression,
): Extract<UsageSignal, { namespace: "provider" }> {
  addAtom(input, { kind: "usage_signal", key, definition, unit, resolution_phase: "outcome" });
  return providerSignalValue(key);
}

function providerSignalValue(key: string): Extract<UsageSignal, { namespace: "provider" }> {
  return { namespace: "provider", provider_id: "azure", value: key };
}

function isStandardSignal(
  signal: UsageSignal,
  value: Extract<UsageSignal, { namespace: "kmodels" }>["value"],
): boolean {
  return signal.namespace === "kmodels" && signal.value === value;
}

function routerMeter(input: AtomicProviderPricing): PriceMeter {
  addAtom(input, {
    kind: "meter",
    key: "model_router_input",
    definition: "Azure Model Router input-token markup; selected-model inference is additive",
  });
  return { namespace: "provider", provider_id: input.provider_id, value: "model_router_input" };
}

function isServiceTier(condition: PriceCondition): boolean {
  return (
    condition.dimension.namespace === "kmodels" && condition.dimension.value === "service_tier"
  );
}

function isMeter(meter: PriceMeter, value: string): boolean {
  return meter.namespace === "kmodels" && meter.value === value;
}
