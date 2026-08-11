import type {
  AtomicPricingBook,
  AtomicContributionTerm,
  AtomicPricingOffer,
  AtomicPricingTerm,
  AtomicProviderPricing,
  AtomicRateTerm,
  AtomicRateVariant,
} from "./pricing-assembly.ts";
import { canonicalizeApplicability } from "./pricing-canonical.ts";
import { addAtom } from "./pricing-commercial-assembly.ts";
import { pricingBookId, pricingOfferId, pricingTermId } from "./pricing-identifiers.ts";
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

const tokenUnit: UnitExpression = {
  factors: [{ unit: { namespace: "kmodels", value: "token" }, power: 1 }],
};
const eventUnit: UnitExpression = {
  factors: [{ unit: { namespace: "kmodels", value: "event" }, power: 1 }],
};

export function applyOpenAiCommercialTopology(
  input: AtomicProviderPricing,
  models: readonly PublishedModel[],
): AtomicProviderPricing {
  if (input.provider_id !== "openai") return input;
  const modelByRef = new Map(models.map((model) => [model.uid, model]));
  const books = input.books.map((book) =>
    book.scope.kind === "models" ? splitModelBook(book, modelByRef) : bindResourceBook(book, input),
  );
  addServiceCompatibility(books);
  addSearchContributions(books, modelByRef);
  addFineTuningResourceEdges(books);
  return { ...input, books };
}

function splitModelBook(
  book: AtomicPricingBook,
  models: ReadonlyMap<string, PublishedModel>,
): AtomicPricingBook {
  const model =
    book.scope.model_refs.length === 1 ? models.get(book.scope.model_refs[0]!) : undefined;
  return partitionBook(book, "usage", modelMechanism(model).name, model);
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
    const result = [sync, batch].filter((candidate): candidate is AtomicPricingOffer =>
      hasCommercialContent(candidate),
    );
    if (sync !== undefined && batch !== undefined && result.length === 2) {
      const bookId = pricingBookId("openai", book.book_key);
      const syncId = pricingOfferId(bookId, sync.offer_key);
      const batchId = pricingOfferId(bookId, batch.offer_key);
      sync.relations.push(exclusiveRelation(sync, batchId));
      batch.relations.push(exclusiveRelation(batch, syncId));
    }
    return result;
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
        observation: normalizedObservation(state.observation, applicability),
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
      observation: normalizedObservation(variant.observation, applicability),
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
  const durationRate = term.variants.some(({ price }) => isUnit(price.per, "second"));
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

function normalizedObservation(
  observation: NormalizedPriceObservation,
  applicability: PriceApplicability,
): NormalizedPriceObservation {
  return { ...observation, establishes_applicability: applicability };
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
  if (meter.value === "input_text" && isUnit(unit, "token")) return "uncached_input_tokens";
  if (meter.value === "cache_read_text" && isUnit(unit, "token")) return "cached_input_tokens";
  if (meter.value === "cache_write_text" && isUnit(unit, "token")) return "cache_write_tokens";
  if (meter.value === "output_text" && isUnit(unit, "token")) return "output_tokens";
  if (meter.value === "embedding" && isUnit(unit, "token")) return "input_tokens";
  if (meter.value === "image_generation" && isUnit(unit, "image")) return "generated_images";
  if (meter.value === "video_generation" && isUnit(unit, "second")) return "generated_seconds";
  if (meter.value === "transcription" && isUnit(unit, "second")) return "active_seconds";
}

function bindResourceBook(
  book: AtomicPricingBook,
  input: AtomicProviderPricing,
): AtomicPricingBook {
  if (book.scope.kind !== "provider_resource") return book;
  const resourceKey = book.scope.resource_key;
  const partitioned = resourceKey.startsWith("fine-tuned-model:")
    ? partitionBook(book, "inference", "Fine-tuned model inference", undefined)
    : book;
  const offers = partitioned.offers.map((offer) => ({
    ...offer,
    ...(resourceKey.startsWith("fine-tuning:")
      ? { enrollment: [closedFineTuningEnrollment(book)] }
      : {}),
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

function closedFineTuningEnrollment(book: AtomicPricingBook) {
  const observation = book.scope_observations[0];
  if (observation === undefined) throw new Error(`OpenAI book ${book.book_key} has no evidence`);
  const applicability: PriceApplicability = { any_of: [{ all_of: [] }] };
  return {
    state: "closed_to_new" as const,
    applicability,
    observations: [
      {
        source_ref: observation.source_ref,
        locator: observation.locator,
        establishes_applicability: applicability,
        raw: { label: "Fine-tuning is unavailable to new users" },
      },
    ],
  };
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
  if (resourceKey.startsWith("fine-tuning:") && isUnitTerm(term, "token"))
    return providerBinding(
      input,
      "trained_tokens",
      "Provider-reported billable fine-tuning training tokens",
      tokenUnit,
      "openapi:fine_tuning.job.trained_tokens",
    );
  if (resourceKey.startsWith("fine-tuned-model:"))
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

function addSearchContributions(
  books: AtomicPricingBook[],
  models: ReadonlyMap<string, PublishedModel>,
): void {
  const inputRates = new Map<string, string>();
  for (const book of books) {
    if (book.scope.kind !== "models") continue;
    const offer = book.offers.find(({ offer_key }) => offer_key === "sync");
    if (offer === undefined) continue;
    const term = offer.terms.find(
      (candidate) =>
        candidate.kind === "rate" &&
        candidate.meter.namespace === "kmodels" &&
        candidate.meter.value === "input_text",
    );
    if (term === undefined) continue;
    const termRef = pricingTermId(
      pricingOfferId(pricingBookId("openai", book.book_key), offer.offer_key),
      term.kind,
      term.term_key,
    );
    for (const modelRef of book.scope.model_refs) inputRates.set(modelRef, termRef);
  }

  for (const book of books) {
    if (book.scope.kind !== "provider_resource" || book.scope.resource_key !== "web-search")
      continue;
    for (const offer of book.offers) {
      const rates = offer.terms.flatMap((term) =>
        term.kind === "rate" &&
        term.meter.namespace === "kmodels" &&
        term.meter.value === "web_search"
          ? term.variants
          : [],
      );
      const variants: AtomicContributionTerm["variants"] = [];
      for (const rate of rates) {
        if (hasOperation(rate.applicability, "preview_non_reasoning")) continue;
        for (const modelRef of book.scope.model_refs) {
          if (
            hasOperation(rate.applicability, "preview_reasoning") &&
            models.get(modelRef)?.capabilities.reasoning !== true
          )
            continue;
          const target = inputRates.get(modelRef);
          if (target === undefined) continue;
          const applicability = withModel(rate.applicability, modelRef);
          variants.push({
            target_rate_refs: [target],
            applicability,
            charge_bindings: [],
            observation: {
              source_ref: rate.observation.source_ref,
              locator: rate.observation.locator,
              establishes_applicability: applicability,
              raw: { label: "Search content tokens are charged at the model input rate" },
            },
          });
        }
      }
      if (variants.length === 0) continue;
      offer.terms.push({
        term_key: "search-content-input",
        kind: "contribution",
        variants,
        raw_variants: [],
        source_refs: [...new Set(variants.map(({ observation }) => observation.source_ref))],
      });
    }
  }
}

function hasOperation(applicability: PriceApplicability, operation: string): boolean {
  return applicability.any_of.some(({ all_of }) =>
    all_of.some(
      (condition) =>
        condition.kind === "categorical" &&
        condition.dimension.namespace === "kmodels" &&
        condition.dimension.value === "operation" &&
        condition.values.some(({ value }) => value === operation),
    ),
  );
}

function withModel(applicability: PriceApplicability, modelRef: string): PriceApplicability {
  return canonicalizeApplicability({
    any_of: applicability.any_of.map(({ all_of }) => ({
      all_of: [
        ...all_of,
        {
          kind: "categorical" as const,
          dimension: { namespace: "kmodels" as const, value: "model" as const },
          values: [{ namespace: "kmodels" as const, value: modelRef }],
        },
      ],
    })),
  });
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

function addServiceCompatibility(books: AtomicPricingBook[]): void {
  const syncByModel = new Map<string, string[]>();
  for (const book of books) {
    if (book.scope.kind !== "models") continue;
    const bookId = pricingBookId("openai", book.book_key);
    const refs = book.offers
      .filter(({ offer_key }) => offer_key === "sync")
      .map(({ offer_key }) => pricingOfferId(bookId, offer_key));
    for (const modelRef of book.scope.model_refs) syncByModel.set(modelRef, refs);
  }
  for (const book of books) {
    if (
      book.scope.kind !== "provider_resource" ||
      book.scope.resource_kind.namespace !== "kmodels" ||
      book.scope.resource_kind.value !== "service" ||
      !["containers", "file-search", "web-search"].includes(book.scope.resource_key)
    )
      continue;
    const targets = [
      ...new Set(book.scope.model_refs.flatMap((modelRef) => syncByModel.get(modelRef) ?? [])),
    ];
    if (targets.length === 0) continue;
    for (const offer of book.offers)
      offer.relations.push({
        kind: "compatible_with",
        target: { kind: "offers", offer_refs: targets },
        applicability: { any_of: [{ all_of: [] }] },
        observations: [relationObservation(book, targets, "Compatible Responses model routes")],
      });
  }
}

function addFineTuningResourceEdges(books: AtomicPricingBook[]): void {
  const byKey = new Map(books.map((book) => [book.book_key, book]));
  for (const book of books) {
    if (
      book.scope.kind !== "provider_resource" ||
      !book.scope.resource_key.startsWith("fine-tuning:")
    )
      continue;
    const modelId = book.scope.resource_key.slice("fine-tuning:".length);
    const target = byKey.get(`account-resource:fine-tuned-model:${modelId}`);
    if (target === undefined) continue;
    book.resource_edges = [
      {
        kind: "produces_resource",
        target: { kind: "books", book_refs: [pricingBookId("openai", target.book_key)] },
        applicability: { any_of: [{ all_of: [] }] },
        observations: [resourceObservation(book, "Fine-tuning produces a derived model")],
      },
    ];
    if (target.scope.kind === "provider_resource" && target.scope.model_refs.length > 0)
      target.resource_edges = [
        {
          kind: "derived_from",
          target: { kind: "models", model_refs: target.scope.model_refs },
          applicability: { any_of: [{ all_of: [] }] },
          observations: [resourceObservation(target, "Fine-tuned model derives from a base model")],
        },
      ];
  }
}

function exclusiveRelation(source: AtomicPricingOffer, targetRef: string) {
  return {
    kind: "exclusive_with" as const,
    target: { kind: "offers" as const, offer_refs: [targetRef] },
    applicability: { any_of: [{ all_of: [] }] },
    observations: [
      {
        ...offerObservation(source, "Synchronous and Batch mechanisms are alternatives"),
        establishes_offer_refs: [targetRef],
        establishes_book_refs: [],
      },
    ],
  };
}

function relationObservation(book: AtomicPricingBook, targets: string[], label: string) {
  return {
    ...resourceObservation(book, label),
    establishes_offer_refs: targets,
    establishes_book_refs: [],
  };
}

function resourceObservation(book: AtomicPricingBook, label: string): RawPriceObservation {
  const observation = book.scope_observations[0];
  if (observation === undefined) throw new Error(`OpenAI book ${book.book_key} has no evidence`);
  return {
    source_ref: observation.source_ref,
    locator: observation.locator,
    raw: { label },
  };
}

function offerObservation(offer: AtomicPricingOffer, label: string): RawPriceObservation {
  const observation =
    offer.states[0]?.observation ??
    offer.terms.flatMap((term) =>
      term.kind === "raw"
        ? term.variants.map(({ observation: value }) => value)
        : [...term.variants, ...term.raw_variants].map(({ observation: value }) => value),
    )[0];
  if (observation === undefined) throw new Error(`OpenAI offer ${offer.offer_key} has no evidence`);
  return { source_ref: observation.source_ref, locator: observation.locator, raw: { label } };
}

function hasCommercialContent(offer: AtomicPricingOffer | undefined): offer is AtomicPricingOffer {
  return offer !== undefined && (offer.states.length > 0 || offer.terms.length > 0);
}

function isUnit(expression: UnitExpression, value: "event" | "image" | "second" | "token") {
  return (
    expression.factors.length === 1 &&
    expression.factors[0]?.power === 1 &&
    expression.factors[0].unit.namespace === "kmodels" &&
    expression.factors[0].unit.value === value
  );
}

function isUnitTerm(term: AtomicRateTerm, value: "event" | "token"): boolean {
  return term.variants.length > 0 && term.variants.every(({ price }) => isUnit(price.per, value));
}
