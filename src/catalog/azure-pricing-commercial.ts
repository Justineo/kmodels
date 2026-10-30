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
  applicabilitiesOverlap,
  applicabilityContainedIn,
  canonicalizeApplicability,
  unionApplicabilities,
} from "./pricing-canonical.ts";
import { publishedValiditiesOverlap } from "./pricing-time.ts";
import {
  addAtom,
  bindRateTerm,
  isStandardUnit,
  rawEvidence,
  standardSignal,
  unitIdentityKey,
  withApplicability,
} from "./pricing-commercial-assembly.ts";
import {
  calculatedQuantityMethods,
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
const quantityDependencies: Readonly<Record<string, readonly string[]>> = {
  input_text: [
    "cache_read_text",
    "cache_write_text",
    "input_audio",
    "input_image",
    "cache_read_audio",
    "cache_read_image",
    "cache_read_video",
    "cache_write_audio",
    "cache_write_image",
    "cache_write_video",
  ],
  cache_read_text: ["cache_read_audio", "cache_read_image", "cache_read_video"],
  cache_write_text: ["cache_write_audio", "cache_write_image", "cache_write_video"],
  input_audio: ["cache_read_audio", "cache_write_audio"],
  input_image: ["cache_read_image", "cache_write_image"],
  output_text: ["output_audio", "output_image", "output_video"],
};

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
      terms: offer.terms.map((term) =>
        bindRateTerm(term, (meter, variant) => {
          const spec = resourceSignal(resourceKey, meter, variant.price.per, input);
          return directBinding(
            spec.signal,
            resourceAggregation(resourceKey, meter),
            pricingInputFacts(inputIndex, spec.directKeys),
            variant,
          );
        }),
      ),
    })),
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
  const terms = source.terms.flatMap((term) =>
    partitionTerm(term, mechanism, input, router, model, inputIndex, source.terms),
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
  sourceTerms: readonly AtomicPricingTerm[],
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
      scopedMeters(sourceTerms, term.meter, variant, mechanism),
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
          label:
            value.value === "priority"
              ? "Priority"
              : value.value === "standard"
                ? "Standard"
                : value.value === "flex"
                  ? "Flex"
                  : value.value,
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

function scopedMeters(
  terms: readonly AtomicPricingTerm[],
  meter: PriceMeter,
  variant: AtomicRateVariant,
  mechanism: Mechanism,
): PriceMeter[] | undefined {
  const meters: PriceMeter[] = [];
  const dependencies =
    meter.namespace === "kmodels" ? (quantityDependencies[meter.value] ?? []) : [];
  for (const term of terms) {
    if (term.kind !== "rate" || !dependencies.some((value) => isMeter(term.meter, value))) continue;
    const overlapping = term.variants.filter(
      (candidate) =>
        permitsMechanism(candidate.applicability, mechanism) &&
        canonicalJson(candidate.price.denomination) === canonicalJson(variant.price.denomination) &&
        applicabilitiesOverlap(candidate.applicability, variant.applicability) &&
        publishedValiditiesOverlap(candidate.validity, variant.validity),
    );
    if (overlapping.length === 0) continue;
    if (
      !applicabilityContainedIn(
        variant.applicability,
        unionApplicabilities(overlapping.map(({ applicability }) => applicability)),
      ) ||
      overlapping.some(
        (candidate) =>
          candidate.validity !== undefined &&
          canonicalJson(candidate.validity) !== canonicalJson(variant.validity ?? null),
      ) ||
      (isStandardUnit(variant.price.per, "token") &&
        overlapping.some((candidate) => !isStandardUnit(candidate.price.per, "token")))
    )
      return;
    meters.push(term.meter);
  }
  return meters;
}

function modelChargeBinding(
  meter: PriceMeter,
  variant: AtomicRateVariant,
  mechanism: Mechanism,
  model: PublishedModel | undefined,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
  rateMeters: readonly PriceMeter[] | undefined,
): ChargeBinding {
  const spec = modelSignal(meter, variant.price.per, mechanism, model, input);
  const quantity =
    rateMeters === undefined
      ? { methods: [], facts: [] }
      : mergeMethods([
          quantityMethods(spec, meter, mechanism, model, rateMeters, inputIndex),
          ...(mechanism === "sync" &&
          isStandardUnit(variant.price.per, "token") &&
          hasEndpoint(model, "openai/v1/realtime/sessions")
            ? [
                realtimeQuantityMethods(
                  spec,
                  meter,
                  variant.price.per,
                  model,
                  rateMeters,
                  input,
                  inputIndex,
                ),
              ]
            : []),
        ]);
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
  // Scoped quantity dependencies can expose overlapping counters, not independent modalities.
  if (rateMeters.some(isModalityCache)) return { methods: [], facts: [] };
  if (isMeter(meter, "input_text") && isStandardSignal(spec.signal, "uncached_input_tokens"))
    return uncachedInputMethods(mechanism, model, rateMeters, inputIndex);
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
  return directQuantityMethods(spec.signal, pricingInputFacts(inputIndex, spec.directKeys));
}

function directQuantityMethods(
  signal: UsageSignal,
  facts: SourcePricingInputFact[],
): MethodsAndFacts {
  return {
    methods: facts.length === 0 ? [] : [{ input_sources: usageInputSources(signal, facts) }],
    facts,
  };
}

function realtimeQuantityMethods(
  spec: SignalSpec,
  meter: PriceMeter,
  unit: UnitExpression,
  model: PublishedModel | undefined,
  rateMeters: readonly PriceMeter[],
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): MethodsAndFacts {
  const modalities: ReadonlyArray<{ modality: string; cached: PriceMeter }> = [
    { modality: "text", cached: { namespace: "kmodels", value: "cache_read_text" } },
    {
      modality: "audio",
      cached: { namespace: "provider", provider_id: "azure", value: "cache_read_audio" },
    },
    {
      modality: "image",
      cached: { namespace: "provider", provider_id: "azure", value: "cache_read_image" },
    },
  ];
  for (const { modality, cached } of modalities) {
    if (isMeter(meter, `input_${modality}`)) {
      // Realtime reports cached subsets per modality, but no cache-write partition.
      if (rateMeters.some((candidate) => isMeter(candidate, `cache_write_${modality}`)))
        return { methods: [], facts: [] };
      return subtractionMethod(
        [
          {
            signal: providerSignal(
              input,
              `realtime_input_${modality}_tokens`,
              `Azure Realtime reported ${modality}-input tokens including cached tokens`,
              unit,
            ),
            key: `realtime.input_${modality}_tokens`,
          },
          {
            signal: modelSignal(cached, unit, "sync", model, input).signal,
            key: `realtime.cached_${modality}_tokens`,
          },
        ],
        inputIndex,
      );
    }
    if (isMeter(meter, cached.value))
      return directQuantityMethods(
        spec.signal,
        pricingInputFacts(inputIndex, [`realtime.cached_${modality}_tokens`]),
      );
  }
  const output = ["text", "audio"].find((modality) => isMeter(meter, `output_${modality}`));
  return directQuantityMethods(
    spec.signal,
    pricingInputFacts(inputIndex, output === undefined ? [] : [`realtime.output_${output}_tokens`]),
  );
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
    return directQuantityMethods(
      standardSignal("uncached_input_tokens"),
      pricingInputFacts(inputIndex, inputTextKeys(model, mechanism)),
    );
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
  const first = mapped[0];
  if (first === undefined) return { methods: [], facts: [] };
  const nodes: NonNullable<UsageQuantityMethod["calculation"]>["nodes"] = [
    { op: "signal", signal: first.signal },
  ];
  let result = 0;
  for (const { signal } of mapped.slice(1)) {
    nodes.push({ op: "signal", signal });
    nodes.push({ op: "subtract_floor_zero", minuend: result, subtrahend: nodes.length - 1 });
    result = nodes.length - 1;
  }
  return calculatedQuantityMethods({ nodes, result }, mapped);
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
  return meter.value === value && (meter.namespace === "kmodels" || isModalityCache(meter));
}

function isModalityCache(meter: PriceMeter): boolean {
  return (
    meter.namespace === "provider" &&
    meter.provider_id === "azure" &&
    /^cache_(?:read|write)_(?:audio|image|video)$/.test(meter.value)
  );
}
