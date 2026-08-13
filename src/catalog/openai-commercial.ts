import type {
  AtomicPricingBook,
  AtomicPricingOffer,
  AtomicPricingTerm,
  AtomicProviderPricing,
  AtomicRateTerm,
  AtomicRateVariant,
} from "./pricing-assembly.ts";
import { canonicalizeApplicability } from "./pricing-canonical.ts";
import { addAtom, isStandardUnit, withApplicability } from "./pricing-commercial-assembly.ts";
import type {
  ChargeBinding,
  NormalizedPriceObservation,
  PriceApplicability,
  PriceCondition,
  PriceMeter,
  RawPriceObservation,
  UnitExpression,
} from "./pricing-schema.ts";
import type { ProviderModel } from "./schema.ts";

type PublishedModel = Pick<ProviderModel, "capabilities" | "tasks" | "uid">;

const eventUnit: UnitExpression = {
  factors: [{ unit: { namespace: "kmodels", value: "event" }, power: 1 }],
};

export function applyOpenAiCommercialTopology(
  input: AtomicProviderPricing,
  models: readonly PublishedModel[],
): AtomicProviderPricing {
  const modelByRef = new Map(models.map((model) => [model.uid, model]));
  const books = input.books
    .filter(admittedBook)
    .map((book) =>
      book.scope.kind === "models"
        ? splitModelBook(book, modelByRef)
        : bindResourceBook(book, input),
    );
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
): AtomicPricingBook {
  const model =
    book.scope.model_refs.length === 1 ? models.get(book.scope.model_refs[0]!) : undefined;
  return partitionBook(preferPricingPage(book), "usage", modelMechanism(model).name, model);
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
): AtomicPricingBook {
  const offers = book.offers.flatMap((offer) => {
    if (offer.offer_key !== sourceOfferKey) return [offer];
    const sync = partitionOffer(offer, "sync", syncName, "sync", model);
    const batch = partitionOffer(offer, "batch", "Batch inference", "batch", model);
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
  const terms = offer.terms.flatMap((term) => partitionTerm(term, partition, model));
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
    const charge_binding = modelChargeBinding(mapped.meter, next, partition);
    return [{ ...next, ...(charge_binding === undefined ? {} : { charge_binding }) }];
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
): ChargeBinding | undefined {
  const signal = standardModelSignal(meter, variant.price.per);
  if (signal === undefined) return;
  return {
    signal: { namespace: "kmodels", value: signal },
    aggregation: partition === "batch" ? "result_item" : "request",
    observations: [usageObservation(variant.observation, `openapi:${signal}`)],
  };
}

function standardModelSignal(
  meter: PriceMeter,
  unit: UnitExpression,
): Extract<ChargeBinding["signal"], { namespace: "kmodels" }>["value"] | undefined {
  if (meter.namespace !== "kmodels") return;
  if (meter.value === "input_text" && isStandardUnit(unit, "token")) return "uncached_input_tokens";
  if (meter.value === "cache_read_text" && isStandardUnit(unit, "token"))
    return "cached_input_tokens";
  if (meter.value === "cache_write_text" && isStandardUnit(unit, "token"))
    return "cache_write_tokens";
  if (meter.value === "output_text" && isStandardUnit(unit, "token")) return "output_tokens";
  if (meter.value === "embedding" && isStandardUnit(unit, "token")) return "input_tokens";
  if (meter.value === "image_generation" && isStandardUnit(unit, "image"))
    return "generated_images";
  if (meter.value === "video_generation" && isStandardUnit(unit, "second"))
    return "generated_seconds";
  if (meter.value === "transcription" && isStandardUnit(unit, "second")) return "active_seconds";
}

function bindResourceBook(
  book: AtomicPricingBook,
  input: AtomicProviderPricing,
): AtomicPricingBook {
  if (book.scope.kind !== "provider_resource") return book;
  const resourceKey = book.scope.resource_key;
  const partitioned = resourceKey.startsWith("fine-tuned-inference:")
    ? partitionBook(book, "inference", "Fine-tuned model inference", undefined)
    : book;
  const offers = partitioned.offers.map((offer) => ({
    ...offer,
    terms: offer.terms.map((term) => {
      if (term.kind !== "rate") return term;
      const binding = resourceChargeBinding(resourceKey, term, input, offer.offer_key);
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
): ((variant: AtomicRateVariant) => ChargeBinding) | undefined {
  if (resourceKey === "file-search" && isUnitTerm(term, "event"))
    return providerBinding(
      input,
      "file_search_calls",
      "Provider-reported File Search call events",
      eventUnit,
      "openapi:organization.usage.file_search_calls.num_requests",
    );
  if (resourceKey.startsWith("web-search") && isUnitTerm(term, "event"))
    return (variant) => ({
      signal: { namespace: "kmodels", value: "successful_web_searches" },
      aggregation: "request",
      observations: [
        usageObservation(variant.observation, "openapi:organization.usage.web_search_calls"),
      ],
    });
  if (resourceKey.startsWith("fine-tuned-inference:"))
    return (variant) => {
      const binding = modelChargeBinding(
        term.meter,
        variant,
        offerKey === "batch" ? "batch" : "sync",
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
  locator: string,
): (variant: AtomicRateVariant) => ChargeBinding {
  addAtom(input, {
    kind: "usage_signal",
    key,
    definition,
    unit,
    resolution_phase: "outcome",
  });
  return (variant) => ({
    signal: { namespace: "provider", provider_id: "openai", value: key },
    aggregation: "request",
    observations: [usageObservation(variant.observation, locator)],
  });
}

function usageObservation(rate: NormalizedPriceObservation, locator: string): RawPriceObservation {
  return {
    source_ref: rate.source_ref,
    locator: { kind: "provider_key", value: locator },
    raw: { fragment: locator },
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
