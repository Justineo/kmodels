import type {
  AtomicPricingBook,
  AtomicPricingOffer,
  AtomicPricingTerm,
  AtomicProviderPricing,
  AtomicRateTerm,
  AtomicRateVariant,
} from "./pricing-assembly.ts";
import { canonicalJson } from "./canonical-json.ts";
import { compareUtf8, uniqueCanonicalValues as uniqueCanonical } from "./canonical-value.ts";
import { canonicalizeApplicability } from "./pricing-canonical.ts";
import {
  addAtom,
  isStandardUnit,
  rawEvidence,
  standardSignal,
  withApplicability,
} from "./pricing-commercial-assembly.ts";
import type {
  ChargeBinding,
  PriceApplicability,
  PriceCondition,
  PriceDimension,
  PriceMeter,
  PriceSelectorSource,
  RawPriceObservation,
  UnitExpression,
  UsageQuantityMethod,
  UsageSignal,
} from "./pricing-schema.ts";
import {
  indexPricingInputs,
  includePricingInputSourceRefs,
  pricingInputFacts,
  pricingInputObservation,
  uniquePricingInputFacts,
  usageInputSources,
  type PricingInputIndex,
} from "./pricing-input.ts";
import type { SourcePricingInputFact } from "./pricing-source.ts";
import type { ProviderModel } from "./schema.ts";

type PublishedModel = Pick<ProviderModel, "capabilities" | "tasks" | "uid">;

const eventUnit: UnitExpression = {
  factors: [{ unit: { namespace: "kmodels", value: "event" }, power: 1 }],
};
const tokenUnit: UnitExpression = {
  factors: [{ unit: { namespace: "kmodels", value: "token" }, power: 1 }],
};

export function applyOpenAiCommercialTopology(
  input: AtomicProviderPricing,
  models: readonly PublishedModel[],
  pricingInputs: readonly SourcePricingInputFact[],
): AtomicProviderPricing {
  const modelByRef = new Map(models.map((model) => [model.uid, model]));
  const inputIndex = indexPricingInputs(pricingInputs);
  const books = input.books
    .filter(admittedBook)
    .map((book) =>
      book.scope.kind === "models"
        ? splitModelBook(book, modelByRef, input, inputIndex)
        : bindResourceBook(book, input, inputIndex),
    )
    .map(includePricingInputSourceRefs);
  return { ...input, books };
}

function admittedBook(book: AtomicPricingBook): boolean {
  return (
    book.scope.kind === "models" ||
    ["containers", "file-search", "web-search"].includes(book.scope.resource_key) ||
    book.scope.resource_key.startsWith("fine-tuned-inference:")
  );
}

function splitModelBook(
  book: AtomicPricingBook,
  models: ReadonlyMap<string, PublishedModel>,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): AtomicPricingBook {
  const model =
    book.scope.model_refs.length === 1 ? models.get(book.scope.model_refs[0]!) : undefined;
  return partitionBook(
    preferPricingPage(book),
    "usage",
    modelMechanism(model).name,
    model,
    input,
    inputIndex,
  );
}

function preferPricingPage(book: AtomicPricingBook): AtomicPricingBook {
  return {
    ...book,
    offers: book.offers.map((offer) => ({
      ...offer,
      terms: offer.terms.map((term) => {
        if (term.kind !== "rate") return term;
        const authoritative: Array<{ applicability: PriceApplicability; price?: string }> = [
          ...term.variants.flatMap((variant) =>
            variant.observation.source_ref === "openai-pricing"
              ? [{ applicability: variant.applicability, price: JSON.stringify(variant.price) }]
              : [],
          ),
          ...term.raw_variants.flatMap((variant) =>
            variant.observation.source_ref === "openai-pricing" &&
            variant.reason === "conflicting_values" &&
            variant.possible_scope !== undefined
              ? [{ applicability: variant.possible_scope }]
              : [],
          ),
        ];
        if (authoritative.length === 0) return term;
        const removed = term.variants.filter(
          (variant) =>
            variant.observation.source_ref === "openai-overview" &&
            authoritative.some(({ applicability }) =>
              sameTier(variant.applicability, applicability),
            ),
        );
        if (removed.length === 0) return term;
        return {
          ...term,
          variants: term.variants.filter((variant) => !removed.includes(variant)),
          raw_variants: [
            ...term.raw_variants,
            ...removed.flatMap((variant) =>
              authoritative.some(
                ({ applicability, price }) =>
                  sameTier(variant.applicability, applicability) &&
                  price !== undefined &&
                  price !== JSON.stringify(variant.price),
              )
                ? [supersededCardRate(variant)]
                : [],
            ),
          ],
        };
      }),
    })),
  };
}

function sameTier(left: PriceApplicability, right: PriceApplicability): boolean {
  const tiers = (applicability: PriceApplicability): Set<string> =>
    new Set(
      applicability.any_of.flatMap(({ all_of }) => {
        const tier = all_of.find(isServedTier);
        return tier?.kind === "categorical" ? tier.values.map(({ value }) => value) : ["standard"];
      }),
    );
  const rightTiers = tiers(right);
  return [...tiers(left)].some((tier) => rightTiers.has(tier));
}

function supersededCardRate(variant: AtomicRateVariant) {
  return {
    impact: "informational" as const,
    reason: "superseded_value" as const,
    resolution_policy: "openai_pricing_page_over_model_card",
    possible_scope: variant.applicability,
    observation: {
      source_ref: variant.observation.source_ref,
      locator: variant.observation.locator,
      raw: variant.observation.raw,
    },
  };
}

function partitionBook(
  book: AtomicPricingBook,
  sourceOfferKey: string,
  syncName: string,
  model: PublishedModel | undefined,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): AtomicPricingBook {
  const offers = book.offers.flatMap((offer) => {
    if (offer.offer_key !== sourceOfferKey) return [offer];
    const sync = partitionOffer(offer, "sync", syncName, "sync", model, input, inputIndex);
    const batch = partitionOffer(
      offer,
      "batch",
      "Batch inference",
      "batch",
      model,
      input,
      inputIndex,
    );
    return [sync, batch].filter((candidate): candidate is AtomicPricingOffer =>
      hasCommercialContent(candidate),
    );
  });
  return { ...book, offers };
}

function modelMechanism(model: PublishedModel | undefined): { name: string } {
  if (model?.tasks.includes("transcription")) return { name: "Transcription" };
  if (model?.tasks.includes("translation")) return { name: "Translation" };
  if (model?.tasks.includes("embeddings")) return { name: "Embedding" };
  if (model?.tasks.includes("moderation")) return { name: "Moderation" };
  if (model?.tasks.includes("image_generation")) return { name: "Image generation" };
  if (model?.tasks.includes("video_generation")) return { name: "Video generation" };
  if (model?.tasks.includes("speech_synthesis")) return { name: "Speech generation" };
  if (model?.tasks.includes("speech_to_speech")) return { name: "Realtime speech" };
  return { name: "Synchronous inference" };
}

function partitionOffer(
  offer: AtomicPricingOffer,
  offerKey: string,
  name: string,
  partition: "sync" | "batch",
  model: PublishedModel | undefined,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): AtomicPricingOffer | undefined {
  const states = offer.states.flatMap((state) => {
    const applicability = partitionApplicability(state.applicability, partition);
    if (applicability === undefined) return [];
    return [
      {
        ...state,
        applicability,
        observation: withApplicability(state.observation, applicability),
      },
    ];
  });
  const rateMeters = offer.terms.flatMap((term) => (term.kind === "rate" ? [term.meter] : []));
  const terms = offer.terms.flatMap((term) =>
    partitionTerm(term, partition, model, input, inputIndex, rateMeters),
  );
  if (states.length === 0 && terms.length === 0) return;
  return {
    ...offer,
    offer_key: offerKey,
    name,
    states,
    terms,
    relations: [],
  };
}

function partitionTerm(
  term: AtomicPricingTerm,
  partition: "sync" | "batch",
  model: PublishedModel | undefined,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
  rateMeters: readonly PriceMeter[],
): AtomicPricingTerm[] {
  if (term.kind === "raw") {
    const variants = term.variants.flatMap((variant) => {
      const possible = variant.possible_scope;
      if (possible === undefined) return partition === "sync" ? [variant] : [];
      const possible_scope = partitionApplicability(possible, partition);
      return possible_scope === undefined ? [] : [{ ...variant, possible_scope }];
    });
    return variants.length === 0 ? [] : [{ ...term, variants }];
  }
  if (term.kind !== "rate") return partition === "sync" ? [term] : [];
  const mapped = modelRateTerm(term, model);
  const variants = mapped.variants.flatMap((variant) => {
    const applicability = partitionApplicability(variant.applicability, partition);
    if (applicability === undefined) return [];
    const next = {
      ...variant,
      applicability,
      observation: withApplicability(variant.observation, applicability),
    };
    const charge_binding = modelChargeBinding(
      mapped.meter,
      next,
      partition,
      model,
      input,
      inputIndex,
      rateMeters,
    );
    const selector_sources = selectorSources(next.applicability, inputIndex, model);
    return [
      {
        ...next,
        ...(charge_binding === undefined ? {} : { charge_binding }),
        ...(selector_sources.length === 0 ? {} : { selector_sources }),
      },
    ];
  });
  const raw_variants = mapped.raw_variants.flatMap((variant) => {
    if (variant.possible_scope === undefined) return partition === "sync" ? [variant] : [];
    const possible_scope = partitionApplicability(variant.possible_scope, partition);
    return possible_scope === undefined ? [] : [{ ...variant, possible_scope }];
  });
  return variants.length + raw_variants.length === 0 ? [] : [{ ...mapped, variants, raw_variants }];
}

function modelRateTerm(term: AtomicRateTerm, model: PublishedModel | undefined): AtomicRateTerm {
  const durationRate = term.variants.some(({ price }) => isStandardUnit(price.per, "second"));
  if (
    durationRate &&
    term.meter.namespace === "kmodels" &&
    term.meter.value === "input_audio" &&
    model?.tasks.some((task) => task === "transcription" || task === "translation")
  )
    return {
      ...term,
      term_key: "transcription",
      meter: { namespace: "kmodels", value: "transcription" },
    };
  return term;
}

function partitionApplicability(
  applicability: PriceApplicability,
  partition: "sync" | "batch",
): PriceApplicability | undefined {
  const any_of = applicability.any_of.flatMap(({ all_of }) => {
    const tier = all_of.find(isServedTier);
    const isBatch =
      tier?.kind === "categorical" && tier.values.some(({ value }) => value === "batch");
    if ((partition === "batch") !== isBatch) return [];
    return [
      { all_of: partition === "batch" ? all_of.filter((condition) => condition !== tier) : all_of },
    ];
  });
  return any_of.length === 0 ? undefined : canonicalizeApplicability({ any_of });
}

function isServedTier(condition: PriceCondition): boolean {
  return (
    condition.dimension.namespace === "kmodels" &&
    condition.dimension.value === "served_service_tier"
  );
}

function modelChargeBinding(
  meter: PriceMeter,
  variant: AtomicRateVariant,
  partition: "sync" | "batch",
  model: PublishedModel | undefined,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
  rateMeters: readonly PriceMeter[],
): ChargeBinding | undefined {
  const spec = modelSignal(meter, variant.price.per, model, input, rateMeters);
  if (spec === undefined) return;
  const quantity =
    partition === "batch" ? { methods: [], facts: [] } : quantityMethods(spec, inputIndex);
  return {
    signal: spec.signal,
    aggregation: partition === "batch" ? "result_item" : "request",
    ...(quantity.methods.length === 0 ? {} : { quantity_methods: quantity.methods }),
    observations: uniqueObservations([
      rawEvidence(variant.observation),
      ...quantity.facts.map(pricingInputObservation),
    ]),
  };
}

interface ModelSignalSpec {
  signal: UsageSignal;
  directKeys: string[];
  derivedUncached?: boolean;
}

function modelSignal(
  meter: PriceMeter,
  unit: UnitExpression,
  model: PublishedModel | undefined,
  input: AtomicProviderPricing,
  rateMeters: readonly PriceMeter[],
): ModelSignalSpec | undefined {
  const standard = (
    value: Extract<UsageSignal, { namespace: "kmodels" }>["value"],
    directKeys: string[],
    derivedUncached = false,
  ): ModelSignalSpec => ({
    signal: { namespace: "kmodels", value },
    directKeys,
    ...(derivedUncached ? { derivedUncached: true } : {}),
  });
  const provider = (key: string, definition: string, directKeys: string[]): ModelSignalSpec => {
    addAtom(input, {
      kind: "usage_signal",
      key,
      definition,
      unit: tokenUnit,
      resolution_phase: "outcome",
    });
    return {
      signal: { namespace: "provider", provider_id: "openai", value: key },
      directKeys,
    };
  };
  if (meter.namespace === "provider") {
    if (meter.provider_id !== "openai" || !isStandardUnit(unit, "token")) return;
    if (meter.value === "cache_read_audio")
      return provider("cached_input_audio_tokens", "Billable cached audio-input tokens", [
        "organization.completions.input_cached_audio_tokens",
      ]);
    if (meter.value === "cache_read_image")
      return model?.tasks.includes("image_generation") === true
        ? provider(
            "cached_image_prompt_image_tokens",
            "Billable cached image-input tokens for an image-generation response",
            [],
          )
        : provider("cached_input_image_tokens", "Billable cached image-input tokens", [
            "organization.completions.input_cached_image_tokens",
          ]);
    return;
  }
  if (meter.value === "input_text" && isStandardUnit(unit, "token")) {
    const partitioned = hasMeter(rateMeters, "input_audio") || hasMeter(rateMeters, "input_image");
    return model?.tasks.includes("image_generation")
      ? provider(
          "uncached_image_prompt_text_tokens",
          "Billable uncached text-input tokens for an image-generation response",
          [],
        )
      : standard(
          "uncached_input_tokens",
          [
            partitioned
              ? "organization.completions.input_text_tokens"
              : "organization.completions.input_uncached_tokens",
          ],
          !partitioned,
        );
  }
  if (meter.value === "cache_read_text" && isStandardUnit(unit, "token")) {
    if (model?.tasks.includes("image_generation") === true)
      return provider(
        "cached_image_prompt_text_tokens",
        "Billable cached text-input tokens for an image-generation response",
        [],
      );
    const partitioned =
      hasMeter(rateMeters, "cache_read_audio") || hasMeter(rateMeters, "cache_read_image");
    return standard("cached_input_tokens", [
      ...(partitioned ? [] : ["responses.usage.cached_input_tokens"]),
      partitioned
        ? "organization.completions.input_cached_text_tokens"
        : "organization.completions.input_cached_tokens",
    ]);
  }
  if (meter.value === "cache_write_text" && isStandardUnit(unit, "token"))
    return standard("cache_write_tokens", [
      "responses.usage.cache_write_tokens",
      "organization.completions.input_cache_write_tokens",
    ]);
  if (meter.value === "output_text" && isStandardUnit(unit, "token")) {
    const partitioned =
      hasMeter(rateMeters, "output_audio") || hasMeter(rateMeters, "output_image");
    return standard("output_tokens", [
      ...(partitioned ? [] : ["responses.usage.output_tokens"]),
      partitioned
        ? "organization.completions.output_text_tokens"
        : "organization.completions.output_tokens",
    ]);
  }
  if (meter.value === "input_audio" && isStandardUnit(unit, "token"))
    return provider("uncached_input_audio_tokens", "Billable uncached audio-input tokens", [
      "organization.completions.input_audio_tokens",
    ]);
  if (meter.value === "output_audio" && isStandardUnit(unit, "token"))
    return provider("output_audio_tokens", "Billable audio-output tokens", [
      "organization.completions.output_audio_tokens",
    ]);
  if (meter.value === "input_image" && isStandardUnit(unit, "token"))
    return provider(
      "uncached_input_image_tokens",
      "Billable uncached image-input tokens",
      model?.tasks.includes("image_generation")
        ? []
        : ["organization.completions.input_image_tokens"],
    );
  if (meter.value === "output_image" && isStandardUnit(unit, "token"))
    return provider(
      "output_image_tokens",
      "Billable image-output tokens",
      model?.tasks.includes("image_generation")
        ? ["responses.image_output_tokens"]
        : ["organization.completions.output_image_tokens"],
    );
  if (meter.value === "output_audio" && isStandardUnit(unit, "character"))
    return standard("input_characters", ["organization.audio_speeches.characters"]);
  if (meter.value === "embedding" && isStandardUnit(unit, "token"))
    return standard("input_tokens", [
      "responses.embedding_input_tokens",
      "organization.embeddings.input_tokens",
    ]);
  if (meter.value === "image_generation" && isStandardUnit(unit, "image"))
    return standard("generated_images", [
      "responses.generated_images",
      "organization.images.images",
    ]);
  if (meter.value === "video_generation" && isStandardUnit(unit, "second"))
    return standard("generated_seconds", ["responses.generated_seconds"]);
  if (meter.value === "transcription" && isStandardUnit(unit, "second"))
    return standard("processed_audio_seconds", ["organization.audio_transcriptions.seconds"]);
}

function hasMeter(meters: readonly PriceMeter[], value: string): boolean {
  return meters.some((meter) => meter.value === value);
}

function quantityMethods(
  spec: ModelSignalSpec,
  inputIndex: PricingInputIndex,
): { methods: UsageQuantityMethod[]; facts: SourcePricingInputFact[] } {
  const methods: UsageQuantityMethod[] = [];
  const facts: SourcePricingInputFact[] = [];
  const direct = pricingInputFacts(inputIndex, spec.directKeys);
  if (direct.length > 0) {
    methods.push({ input_sources: usageInputSources(spec.signal, direct) });
    facts.push(...direct);
  }
  if (spec.derivedUncached === true) {
    const total = pricingInputFacts(inputIndex, ["responses.usage.input_tokens"]);
    const cached = pricingInputFacts(inputIndex, ["responses.usage.cached_input_tokens"]);
    const written = pricingInputFacts(inputIndex, ["responses.usage.cache_write_tokens"]);
    if (total.length > 0 && cached.length > 0 && written.length > 0) {
      const totalSignal = standardSignal("input_tokens");
      const cachedSignal = standardSignal("cached_input_tokens");
      const writtenSignal = standardSignal("cache_write_tokens");
      methods.push({
        calculation: {
          nodes: [
            { op: "signal", signal: totalSignal },
            { op: "signal", signal: cachedSignal },
            { op: "subtract_floor_zero", minuend: 0, subtrahend: 1 },
            { op: "signal", signal: writtenSignal },
            { op: "subtract_floor_zero", minuend: 2, subtrahend: 3 },
          ],
          result: 4,
        },
        input_sources: [
          ...usageInputSources(totalSignal, total),
          ...usageInputSources(cachedSignal, cached),
          ...usageInputSources(writtenSignal, written),
        ].sort(compareCanonical),
      });
      facts.push(...total, ...cached, ...written);
    }
  }
  return {
    methods: methods.sort(compareCanonical),
    facts: uniquePricingInputFacts(facts),
  };
}

function selectorSources(
  applicability: PriceApplicability,
  inputIndex: PricingInputIndex,
  model: PublishedModel | undefined,
): PriceSelectorSource[] {
  const dimensions = new Map<string, PriceDimension>();
  for (const { all_of } of applicability.any_of)
    for (const { dimension } of all_of) dimensions.set(canonicalJson(dimension), dimension);
  const result: PriceSelectorSource[] = [];
  for (const dimension of dimensions.values()) {
    if (dimension.namespace !== "kmodels") continue;
    const keys =
      dimension.value === "served_service_tier"
        ? ["responses.served_service_tier", "organization.completions.service_tier"]
        : dimension.value === "context_tokens"
          ? ["responses.usage.input_tokens"]
          : dimension.value === "quality"
            ? model?.tasks.includes("image_generation") === true
              ? ["responses.image_quality"]
              : []
            : dimension.value === "resolution"
              ? model?.tasks.includes("video_generation") === true
                ? ["responses.video_resolution"]
                : model?.tasks.includes("image_generation") === true
                  ? ["responses.image_resolution"]
                  : []
              : [];
    for (const fact of pricingInputFacts(inputIndex, keys))
      result.push({
        dimension,
        channel: fact.channel,
        locator: fact.locator,
        availability: fact.availability,
        ...optionalSelectorNormalization(dimension, applicability, model),
        observations: [pricingInputObservation(fact)],
      });
  }
  return result.sort(compareCanonical);
}

function optionalSelectorNormalization(
  dimension: PriceDimension,
  applicability: PriceApplicability,
  model: PublishedModel | undefined,
): Pick<PriceSelectorSource, "normalization"> | Record<never, never> {
  if (dimension.namespace !== "kmodels") return {};
  const entries = applicability.any_of.flatMap(({ all_of }) =>
    all_of.flatMap((condition) => {
      if (
        condition.kind !== "categorical" ||
        canonicalJson(condition.dimension) !== canonicalJson(dimension)
      )
        return [];
      return condition.values.flatMap((value) => {
        const sourceValues =
          dimension.value === "served_service_tier"
            ? value.value === "standard"
              ? ["default"]
              : value.value === "fast"
                ? ["priority"]
                : value.value === "flex"
                  ? ["flex"]
                  : []
            : dimension.value === "resolution" && model?.tasks.includes("video_generation") === true
              ? videoResolutionSourceValues(value.value)
              : [];
        return sourceValues.map((source_value) => ({ source_value, value }));
      });
    }),
  );
  return entries.length === 0
    ? {}
    : { normalization: { kind: "categorical_map", entries: uniqueCanonical(entries) } };
}

function videoResolutionSourceValues(value: string): string[] {
  if (value === "720p") return ["1280x720", "720x1280"];
  if (value === "1024p") return ["1024x1792", "1792x1024"];
  if (value === "1080p") return ["1080x1920", "1920x1080"];
  return [];
}

function uniqueObservations(observations: RawPriceObservation[]): RawPriceObservation[] {
  return uniqueCanonical(observations);
}

function compareCanonical(left: unknown, right: unknown): number {
  return compareUtf8(canonicalJson(left), canonicalJson(right));
}

function bindResourceBook(
  book: AtomicPricingBook,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): AtomicPricingBook {
  if (book.scope.kind !== "provider_resource") return book;
  const resourceKey = book.scope.resource_key;
  const partitioned = resourceKey.startsWith("fine-tuned-inference:")
    ? partitionBook(book, "inference", "Fine-tuned model inference", undefined, input, inputIndex)
    : book;
  const offers = partitioned.offers.map((offer) => ({
    ...offer,
    terms: offer.terms.map((term) => {
      if (term.kind !== "rate") return term;
      const binding = resourceChargeBinding(resourceKey, term, input, offer.offer_key, inputIndex);
      return binding === undefined
        ? term
        : {
            ...term,
            variants: term.variants.map((variant) => ({
              ...variant,
              charge_binding: binding(variant),
            })),
          };
    }),
  }));
  return { ...book, offers };
}

function resourceChargeBinding(
  resourceKey: string,
  term: AtomicRateTerm,
  input: AtomicProviderPricing,
  offerKey: string,
  inputIndex: PricingInputIndex,
): ((variant: AtomicRateVariant) => ChargeBinding) | undefined {
  if (
    resourceKey === "containers" &&
    term.meter.namespace === "kmodels" &&
    term.meter.value === "container_runtime"
  )
    return (variant) => {
      const key = "container_session_blocks";
      addAtom(input, {
        kind: "usage_signal",
        key,
        definition: "Provider-billed 20-minute container session blocks at the selected capacity",
        unit: variant.price.per,
        resolution_phase: "account",
      });
      return {
        signal: { namespace: "provider", provider_id: "openai", value: key },
        aggregation: "session",
        observations: [rawEvidence(variant.observation)],
      };
    };
  if (resourceKey === "file-search" && isUnitTerm(term, "event"))
    return providerBinding(
      input,
      "file_search_calls",
      "Provider-reported File Search call events",
      eventUnit,
      ["organization.file_search_calls.num_requests"],
      inputIndex,
    );
  if (resourceKey.startsWith("web-search") && isUnitTerm(term, "event"))
    return providerBinding(
      input,
      "web_search_calls",
      "Provider-reported billable Web Search call events",
      eventUnit,
      ["organization.web_search_calls.num_requests"],
      inputIndex,
    );
  if (resourceKey.startsWith("fine-tuned-inference:"))
    return (variant) => {
      const binding = modelChargeBinding(
        term.meter,
        variant,
        offerKey === "batch" ? "batch" : "sync",
        undefined,
        input,
        inputIndex,
        [term.meter],
      );
      if (binding === undefined) throw new Error("Fine-tuned inference rate has no exact binding");
      return binding;
    };
}

function providerBinding(
  input: AtomicProviderPricing,
  key: string,
  definition: string,
  unit: UnitExpression,
  keys: string[],
  inputIndex: PricingInputIndex,
): (variant: AtomicRateVariant) => ChargeBinding {
  addAtom(input, {
    kind: "usage_signal",
    key,
    definition,
    unit,
    resolution_phase: "outcome",
  });
  const signal = { namespace: "provider", provider_id: "openai", value: key } as const;
  return (variant) => {
    const facts = pricingInputFacts(inputIndex, keys);
    return {
      signal,
      aggregation: "request",
      ...(facts.length === 0
        ? {}
        : { quantity_methods: [{ input_sources: usageInputSources(signal, facts) }] }),
      observations: uniqueObservations([
        rawEvidence(variant.observation),
        ...facts.map(pricingInputObservation),
      ]),
    };
  };
}

function hasCommercialContent(offer: AtomicPricingOffer | undefined): offer is AtomicPricingOffer {
  return offer !== undefined && (offer.states.length > 0 || offer.terms.length > 0);
}

function isUnitTerm(term: AtomicRateTerm, value: "event" | "token"): boolean {
  return (
    term.variants.length > 0 && term.variants.every(({ price }) => isStandardUnit(price.per, value))
  );
}
