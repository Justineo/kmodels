import type {
  AtomicPricingBook,
  AtomicPricingOffer,
  AtomicPricingTerm,
  AtomicProviderPricing,
  AtomicRateVariant,
  AtomicRawVariant,
} from "./pricing-assembly.ts";
import { canonicalizeApplicability, unconditionalApplicability } from "./pricing-canonical.ts";
import { addAtom, rawEvidence, unitIdentityKey } from "./pricing-commercial-assembly.ts";
import { pricingBookId, pricingOfferId } from "./pricing-identifiers.ts";
import type {
  ChargeBinding,
  NormalizedPriceObservation,
  OfferRelation,
  PriceApplicability,
  PriceCondition,
  PriceMeter,
  RawPriceObservation,
  UnitExpression,
} from "./pricing-schema.ts";
import type { ParsedProviderModel } from "./pricing-source.ts";

type Mechanism = "sync" | "batch";

type PublishedModel = Pick<ParsedProviderModel, "service_families" | "uid">;

const servedTier = { namespace: "kmodels", value: "served_service_tier" } as const;

export function applyVertexCommercialTopology(
  input: AtomicProviderPricing,
  publishedModels: readonly PublishedModel[],
): AtomicProviderPricing {
  if (input.provider_id !== "vertex") return input;
  const models = new Map(publishedModels.map((model) => [model.uid, model]));
  const syncOffers = new Map<string, string>();
  const books = input.books.map((book) => {
    if (book.scope.kind !== "models") return bindResourceBook(book, input);
    const migrated = splitModelBook(book, input, models);
    const sync = migrated.offers.find(({ offer_key }) => offer_key === "sync");
    if (sync !== undefined) {
      const ref = pricingOfferId(pricingBookId(input.provider_id, book.book_key), sync.offer_key);
      for (const modelRef of book.scope.model_refs) syncOffers.set(modelRef, ref);
    }
    return migrated;
  });
  const resourceOffers = new Map<string, string>();
  for (const book of books) {
    if (book.scope.kind !== "provider_resource" || !book.scope.resource_key.startsWith("agent:"))
      continue;
    const execution = book.offers.find(({ offer_key }) => offer_key === "execution");
    if (execution !== undefined)
      resourceOffers.set(
        book.scope.resource_key,
        pricingOfferId(pricingBookId(input.provider_id, book.book_key), execution.offer_key),
      );
  }
  for (const book of books)
    if (book.scope.kind === "provider_resource")
      bindResourceRelations(book, syncOffers, resourceOffers);
  return { ...input, books };
}

function splitModelBook(
  book: AtomicPricingBook,
  input: AtomicProviderPricing,
  models: ReadonlyMap<string, PublishedModel>,
): AtomicPricingBook {
  const offers = book.offers.flatMap((offer) => {
    if (offer.offer_key !== "usage") return [withSettlement(offer, "Vertex AI usage")];
    const sync = partitionOffer(book, offer, "sync", input, models);
    const batch = partitionOffer(book, offer, "batch", input, models);
    const result = [sync, batch].filter(hasCommercialContent);
    if (sync !== undefined && batch !== undefined && result.length === 2) {
      const bookId = pricingBookId(input.provider_id, book.book_key);
      sync.relations.push(
        relation(
          sync,
          "exclusive_with",
          pricingOfferId(bookId, "batch"),
          "Synchronous and Batch inference are alternative execution mechanisms",
        ),
      );
      batch.relations.push(
        relation(
          batch,
          "exclusive_with",
          pricingOfferId(bookId, "sync"),
          "Batch and synchronous inference are alternative execution mechanisms",
        ),
      );
    }
    return result;
  });
  return { ...book, offers };
}

function partitionOffer(
  book: AtomicPricingBook,
  offer: AtomicPricingOffer,
  mechanism: Mechanism,
  input: AtomicProviderPricing,
  models: ReadonlyMap<string, PublishedModel>,
): AtomicPricingOffer | undefined {
  const states = offer.states.flatMap((state) => {
    const applicability = mechanismApplicability(state.applicability, mechanism, input);
    return applicability === undefined
      ? []
      : [{ ...state, applicability, observation: normalized(state.observation, applicability) }];
  });
  const terms = offer.terms.flatMap((term) => partitionTerm(book, term, mechanism, input, models));
  if (states.length === 0 && terms.length === 0) return;
  return withSettlement(
    {
      ...offer,
      offer_key: mechanism,
      name: mechanism === "batch" ? "Batch inference" : "Synchronous inference",
      states,
      terms,
      relations: [],
    },
    mechanism === "batch" ? "Vertex AI Batch usage" : "Vertex AI synchronous usage",
  );
}

function partitionTerm(
  book: AtomicPricingBook,
  term: AtomicPricingTerm,
  mechanism: Mechanism,
  input: AtomicProviderPricing,
  models: ReadonlyMap<string, PublishedModel>,
): AtomicPricingTerm[] {
  if (term.kind === "raw") {
    const variants = term.variants.flatMap((variant) => partitionRaw(variant, mechanism, input));
    return variants.length === 0 ? [] : [{ ...term, variants }];
  }
  if (term.kind !== "rate") return mechanism === "sync" ? [term] : [];
  const variants = term.variants.flatMap((variant) => {
    const applicability = mechanismApplicability(variant.applicability, mechanism, input);
    if (applicability === undefined) return [];
    const charge_binding = modelBinding(book, term.meter, variant, mechanism, input, models);
    return [
      {
        ...variant,
        applicability,
        observation: normalized(variant.observation, applicability),
        ...(charge_binding === undefined ? {} : { charge_binding }),
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
          definition: `Vertex response-reported served traffic type ${JSON.stringify(value.value)}`,
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

function modelBinding(
  book: AtomicPricingBook,
  meter: PriceMeter,
  variant: AtomicRateVariant,
  mechanism: Mechanism,
  input: AtomicProviderPricing,
  models: ReadonlyMap<string, PublishedModel>,
): ChargeBinding | undefined {
  const signal = modelSignal(book, meter, variant.price.per, models);
  if (signal === undefined) return;
  const key = `${mechanism === "batch" ? "batch_result" : "response"}_${signal}`;
  return providerBinding(
    input,
    key,
    `Billable ${signal.replaceAll("_", " ")} for one Vertex ${mechanism === "batch" ? "Batch result item" : "API attempt"}`,
    variant.price.per,
    mechanism === "batch" ? "result_item" : "attempt",
    variant.observation,
    `usage:${key}`,
  );
}

function modelSignal(
  book: AtomicPricingBook,
  meter: PriceMeter,
  unit: UnitExpression,
  models: ReadonlyMap<string, PublishedModel>,
): string | undefined {
  if (meter.namespace !== "kmodels" || book.scope.kind !== "models") return;
  const families = new Set(
    book.scope.model_refs.flatMap((ref) => models.get(ref)?.service_families ?? []),
  );
  const source = book.source_refs.includes("vertex-google-models")
    ? "gemini"
    : families.has("publishers/anthropic")
      ? "claude"
      : families.has("publishers/xai")
        ? "responses"
        : "chat";
  const billedUnit = singleUnit(unit);
  if (source === "gemini") {
    switch (meter.value) {
      case "input_text":
        return "usage_metadata_uncached_prompt_tokens";
      case "cache_read_text":
        return "usage_metadata_cached_content_tokens";
      case "output_text":
        return "usage_metadata_candidate_and_thought_tokens";
      case "image_generation":
        return `prediction_generated_image_${billedUnit}`;
      case "video_generation":
        return `prediction_generated_video_${billedUnit}`;
      default:
        return `usage_metadata_${meter.value}_${billedUnit}`;
    }
  }
  if (source === "claude") {
    switch (meter.value) {
      case "input_text":
        return "claude_usage_input_tokens";
      case "cache_read_text":
        return "claude_usage_cache_read_input_tokens";
      case "cache_write_text":
        return "claude_usage_cache_creation_input_tokens";
      case "output_text":
        return "claude_usage_output_tokens";
      default:
        return `claude_usage_${meter.value}_${billedUnit}`;
    }
  }
  const prefix = source === "responses" ? "responses_usage" : "chat_usage";
  if (meter.value === "input_text")
    return `${prefix}_${source === "responses" ? "input" : "prompt"}_tokens`;
  if (meter.value === "cache_read_text") return `${prefix}_cached_input_tokens`;
  if (meter.value === "output_text")
    return `${prefix}_${source === "responses" ? "output" : "completion"}_tokens`;
  return `${prefix}_${meter.value}_${billedUnit}`;
}

function bindResourceBook(
  book: AtomicPricingBook,
  input: AtomicProviderPricing,
): AtomicPricingBook {
  if (book.scope.kind !== "provider_resource") return book;
  const resourceKey = book.scope.resource_key;
  const offers = book.offers.map((offer) => ({
    ...withSettlement(offer, `Vertex AI ${book.name ?? book.book_key}`),
    terms: offer.terms.map((term) => {
      if (term.kind !== "rate") return term;
      return {
        ...term,
        variants: term.variants.map((variant) => {
          const charge_binding = resourceBinding(resourceKey, term.meter, variant, input);
          return charge_binding === undefined ? variant : { ...variant, charge_binding };
        }),
      };
    }),
  }));
  return { ...book, offers };
}

function resourceBinding(
  resourceKey: string,
  meter: PriceMeter,
  variant: AtomicRateVariant,
  input: AtomicProviderPricing,
): ChargeBinding | undefined {
  if (meter.namespace !== "kmodels") return;
  const baseKey =
    resourceKey === "explicit-cache-storage" && meter.value === "storage"
      ? "explicit_cache_stored_token_time"
      : resourceKey === "provisioned-throughput" && meter.value === "provisioned_capacity"
        ? "provisioned_gsu_commitment"
        : resourceKey === "model-tuning" && meter.value === "training_input"
          ? "training_dataset_tokens_times_epochs"
          : resourceKey === "agent-search" && meter.value === "retrieval"
            ? "agent_search_queries"
            : resourceKey === "agent-search" && meter.value === "grounded_generation"
              ? "agent_search_advanced_generative_answer_queries"
              : resourceKey.startsWith("agent:")
                ? `${resourceKey.slice("agent:".length).replaceAll("-", "_")}_${meter.value}`
                : resourceKey === "codemender" || resourceKey === "alphaevolve"
                  ? `${resourceKey}_${meter.value}`
                  : resourceKey === "claude-web-search"
                    ? "claude_server_tool_use_web_search_requests"
                    : resourceKey === "google-image-search"
                      ? "grounding_metadata_image_search_queries"
                      : resourceKey === "google-maps" && isRequestUnit(variant.price.per)
                        ? "grounding_metadata_maps_queries"
                        : resourceKey === "grounded-generation"
                          ? "grounded_generation_billable_requests"
                          : resourceKey === "google-search" ||
                              resourceKey === "web-grounding-enterprise"
                            ? isRequestUnit(variant.price.per)
                              ? "grounding_metadata_successful_grounded_prompts"
                              : "grounding_metadata_web_search_queries"
                            : undefined;
  if (baseKey === undefined) return;
  const key =
    baseKey === "provisioned_gsu_commitment"
      ? `${baseKey}_${unitIdentityKey(variant.price.per)}`
      : baseKey;
  const storage = resourceKey === "explicit-cache-storage";
  const capacity = resourceKey === "provisioned-throughput";
  const training = resourceKey === "model-tuning";
  const agent = resourceKey.startsWith("agent:");
  const compositeAgent = resourceKey === "codemender" || resourceKey === "alphaevolve";
  const request = resourceKey === "agent-search" || resourceKey === "grounded-generation";
  return providerBinding(
    input,
    key,
    storage
      ? "Explicit cache token count integrated over its retained lifetime"
      : `Billable ${key.replaceAll("_", " ")}`,
    variant.price.per,
    storage || capacity
      ? "resource"
      : training || agent || compositeAgent
        ? "job"
        : request
          ? "request"
          : isRequestUnit(variant.price.per)
            ? "attempt"
            : "result_item",
    variant.observation,
    `usage:${key}`,
    storage || capacity ? "account" : request ? "request" : "outcome",
  );
}

function bindResourceRelations(
  book: AtomicPricingBook,
  syncOffers: ReadonlyMap<string, string>,
  resourceOffers: ReadonlyMap<string, string>,
): void {
  if (book.scope.kind !== "provider_resource") return;
  for (const offer of book.offers) {
    if (offer.offer_key.startsWith("agent:")) {
      const target = resourceOffers.get(offer.offer_key);
      if (target !== undefined)
        offer.relations.push(
          relation(
            offer,
            "requires",
            target,
            "This tool charge adds to the exact managed-agent execution charge",
          ),
        );
      continue;
    }
    for (const prefix of ["codemender:", "alphaevolve:"]) {
      if (!offer.offer_key.startsWith(prefix)) continue;
      for (const modelRef of offer.offer_key.slice(prefix.length).split("+")) {
        const target = syncOffers.get(modelRef);
        if (target !== undefined)
          offer.relations.push(
            relation(
              offer,
              "requires",
              target,
              "The managed agent component adds to the exact selected model charge",
            ),
          );
      }
      continue;
    }
    const modelRef = offerModelRef(offer.offer_key);
    const target = modelRef === undefined ? undefined : syncOffers.get(modelRef);
    if (target === undefined) continue;
    const storage = book.scope.resource_key === "explicit-cache-storage";
    offer.relations.push(
      relation(
        offer,
        storage ? "compatible_with" : "requires",
        target,
        storage
          ? "Explicit cache storage remains bound to the exact model identity"
          : "This service charge adds to the exact model's synchronous inference charge",
      ),
    );
  }
}

function offerModelRef(offerKey: string): string | undefined {
  for (const prefix of ["usage:", "storage:"])
    if (offerKey.startsWith(prefix)) return offerKey.slice(prefix.length);
}

function providerBinding(
  input: AtomicProviderPricing,
  key: string,
  definition: string,
  unit: UnitExpression,
  aggregation: ChargeBinding["aggregation"],
  evidence: RawPriceObservation,
  locator: string,
  resolutionPhase: "request" | "outcome" | "account" = "outcome",
): ChargeBinding {
  addAtom(input, {
    kind: "usage_signal",
    key,
    definition,
    unit,
    resolution_phase: resolutionPhase,
  });
  return {
    signal: { namespace: "provider", provider_id: input.provider_id, value: key },
    aggregation,
    observations: [{ ...rawEvidence(evidence), locator: { kind: "provider_key", value: locator } }],
  };
}

function withSettlement(offer: AtomicPricingOffer, label: string): AtomicPricingOffer {
  const evidence = offerEvidence(offer);
  const reseller = offer.source_refs.some((source) =>
    ["vertex-partner-models", "vertex-open-models"].includes(source),
  );
  return {
    ...offer,
    settlement: [
      {
        channel: reseller ? "reseller" : "direct",
        biller: "Google Cloud",
        payment_sources: ["allowance", "provider_credit", "postpaid_invoice"],
        applicability: unconditionalApplicability,
        observations: [
          {
            ...rawEvidence(evidence),
            raw: {
              label: `${label} settles through Google Cloud${reseller ? " as the MaaS reseller" : ""}`,
            },
            establishes_applicability: unconditionalApplicability,
          },
        ],
      },
    ],
  };
}

function relation(
  offer: AtomicPricingOffer,
  kind: OfferRelation["kind"],
  target: string,
  label: string,
): OfferRelation {
  const evidence = offerEvidence(offer);
  return {
    kind,
    target: { kind: "offers", offer_refs: [target] },
    applicability: unconditionalApplicability,
    observations: [
      {
        ...rawEvidence(evidence),
        raw: { label },
        establishes_offer_refs: [target],
        establishes_book_refs: [],
      },
    ],
  };
}

function offerEvidence(offer: AtomicPricingOffer): RawPriceObservation {
  const evidence =
    offer.states[0]?.observation ??
    offer.terms.flatMap((term) =>
      term.kind === "raw"
        ? term.variants.map(({ observation }) => observation)
        : [...term.variants, ...term.raw_variants].map(({ observation }) => observation),
    )[0];
  if (evidence === undefined) throw new Error(`Vertex offer ${offer.offer_key} has no evidence`);
  return evidence;
}

function normalized(
  observation: NormalizedPriceObservation,
  applicability: PriceApplicability,
): NormalizedPriceObservation {
  return { ...observation, establishes_applicability: applicability };
}

function hasCommercialContent(offer: AtomicPricingOffer | undefined): offer is AtomicPricingOffer {
  return offer !== undefined && (offer.states.length > 0 || offer.terms.length > 0);
}

function singleUnit(unit: UnitExpression): string {
  const factor = unit.factors.length === 1 ? unit.factors[0] : undefined;
  if (factor?.power !== 1) return "quantity";
  return `${factor.unit.value}${factor.unit.value.endsWith("s") ? "" : "s"}`;
}

function isRequestUnit(unit: UnitExpression): boolean {
  return (
    unit.factors.length === 1 &&
    unit.factors[0]?.power === 1 &&
    unit.factors[0].unit.namespace === "kmodels" &&
    unit.factors[0].unit.value === "request"
  );
}

function title(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
