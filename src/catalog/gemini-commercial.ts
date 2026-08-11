import type {
  AtomicPricingBook,
  AtomicPricingOffer,
  AtomicPricingTerm,
  AtomicProviderPricing,
  AtomicRateVariant,
  AtomicRawVariant,
} from "./pricing-assembly.ts";
import { canonicalizeApplicability, unconditionalApplicability } from "./pricing-canonical.ts";
import { addAtom, rawEvidence } from "./pricing-commercial-assembly.ts";
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

type Mechanism = "sync" | "batch";

const servedTier = { namespace: "kmodels", value: "served_service_tier" } as const;

export function applyGeminiCommercialTopology(input: AtomicProviderPricing): AtomicProviderPricing {
  if (input.provider_id !== "gemini") return input;
  const modelOffers = new Map<string, string>();
  const books = input.books.map((book) => {
    if (book.scope.kind !== "models") return bindResourceBook(book, input);
    const migrated = splitModelBook(book, input);
    const sync = migrated.offers.find(({ offer_key }) => offer_key === "sync");
    if (sync !== undefined) {
      const ref = pricingOfferId(pricingBookId(input.provider_id, book.book_key), sync.offer_key);
      for (const modelRef of book.scope.model_refs) modelOffers.set(modelRef, ref);
    }
    return migrated;
  });
  for (const book of books)
    if (book.scope.kind === "provider_resource") bindResourceRelations(book, modelOffers);
  return { ...input, books };
}

function splitModelBook(book: AtomicPricingBook, input: AtomicProviderPricing): AtomicPricingBook {
  const offers = book.offers.flatMap((offer) => {
    if (offer.offer_key !== "usage") return [withSettlement(offer, "Gemini API usage")];
    const sync = partitionOffer(offer, "sync", input);
    const batch = partitionOffer(offer, "batch", input);
    const result = [sync, batch].filter(hasCommercialContent);
    if (sync !== undefined && batch !== undefined && result.length === 2) {
      const bookId = pricingBookId(input.provider_id, book.book_key);
      sync.relations.push(
        exclusiveRelation(
          sync,
          pricingOfferId(bookId, "batch"),
          "Synchronous and Batch execution are alternatives",
        ),
      );
      batch.relations.push(
        exclusiveRelation(
          batch,
          pricingOfferId(bookId, "sync"),
          "Batch and synchronous execution are alternatives",
        ),
      );
    }
    return result;
  });
  return { ...book, offers };
}

function partitionOffer(
  offer: AtomicPricingOffer,
  mechanism: Mechanism,
  input: AtomicProviderPricing,
): AtomicPricingOffer | undefined {
  const states = offer.states.flatMap((state) => {
    const applicability = mechanismApplicability(state.applicability, mechanism, input);
    return applicability === undefined
      ? []
      : [{ ...state, applicability, observation: normalized(state.observation, applicability) }];
  });
  const terms = offer.terms.flatMap((term) => partitionTerm(term, mechanism, input));
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
    mechanism === "batch" ? "Gemini API Batch usage" : "Gemini API synchronous usage",
  );
}

function partitionTerm(
  term: AtomicPricingTerm,
  mechanism: Mechanism,
  input: AtomicProviderPricing,
): AtomicPricingTerm[] {
  if (term.kind === "raw") {
    const variants = term.variants.flatMap((variant) => partitionRaw(variant, mechanism, input));
    return variants.length === 0 ? [] : [{ ...term, variants }];
  }
  if (term.kind !== "rate") return mechanism === "sync" ? [term] : [];
  const variants = term.variants.flatMap((variant) => {
    const applicability = mechanismApplicability(variant.applicability, mechanism, input);
    if (applicability === undefined) return [];
    const observation = normalized(variant.observation, applicability);
    const charge_binding = modelBinding(term.meter, variant, mechanism, input);
    return [
      {
        ...variant,
        applicability,
        observation,
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
          definition: `Gemini response-reported served service tier ${JSON.stringify(value.value)}`,
          label: tierLabel(value.value),
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

function tierLabel(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function modelBinding(
  meter: PriceMeter,
  variant: AtomicRateVariant,
  mechanism: Mechanism,
  input: AtomicProviderPricing,
): ChargeBinding | undefined {
  const signal = modelSignal(meter, variant.price.per);
  if (signal === undefined) return;
  const key = `${mechanism === "batch" ? "batch_result" : "response"}_${signal}`;
  return providerBinding(
    input,
    key,
    `Billable ${signal.replaceAll("_", " ")} reported for one Gemini ${mechanism === "batch" ? "Batch result item" : "API attempt"}`,
    variant.price.per,
    mechanism === "batch" ? "result_item" : "attempt",
    variant.observation,
    `usage:${key}`,
  );
}

function modelSignal(meter: PriceMeter, unit: UnitExpression): string | undefined {
  if (meter.namespace !== "kmodels") return;
  const billedUnit = singleUnit(unit);
  switch (meter.value) {
    case "input_text":
      return "uncached_input_tokens";
    case "input_audio":
      return `input_audio_${billedUnit}`;
    case "input_image":
      return `input_image_${billedUnit}`;
    case "cache_read_text":
      return "cached_input_tokens";
    case "output_text":
      return "output_tokens_including_thoughts";
    case "output_audio":
      return `output_audio_${billedUnit}`;
    case "image_generation":
      return `generated_image_${billedUnit}`;
    case "video_generation":
      return `generated_video_${billedUnit}`;
    case "embedding":
      return `embedding_input_${billedUnit}`;
    default:
      return `${meter.value}_${billedUnit}`;
  }
}

function bindResourceBook(
  book: AtomicPricingBook,
  input: AtomicProviderPricing,
): AtomicPricingBook {
  if (book.scope.kind !== "provider_resource") return book;
  const resourceKey = book.scope.resource_key;
  const offers = book.offers.map((offer) => {
    const terms = offer.terms.map((term) => {
      if (term.kind !== "rate") return term;
      return {
        ...term,
        variants: term.variants.map((variant) => {
          const binding = resourceBinding(resourceKey, term.meter, variant, input);
          return binding === undefined ? variant : { ...variant, charge_binding: binding };
        }),
      };
    });
    return withSettlement({ ...offer, terms }, `Gemini API ${book.name ?? book.book_key}`);
  });
  return { ...book, offers };
}

function resourceBinding(
  resourceKey: string,
  meter: PriceMeter,
  variant: AtomicRateVariant,
  input: AtomicProviderPricing,
): ChargeBinding | undefined {
  const key =
    resourceKey === "google-search"
      ? searchSignal("search", variant.price.per)
      : resourceKey === "google-maps"
        ? searchSignal("maps", variant.price.per)
        : resourceKey === "explicit-cache-storage" &&
            meter.namespace === "kmodels" &&
            meter.value === "storage"
          ? "explicit_cache_stored_token_time"
          : undefined;
  if (key === undefined) return;
  const storage = resourceKey === "explicit-cache-storage";
  return providerBinding(
    input,
    key,
    storage
      ? "Explicit cache token count integrated over its retained lifetime"
      : `Qualifying Gemini ${resourceKey === "google-search" ? "Search" : "Maps"} grounding executions`,
    variant.price.per,
    storage ? "resource" : "result_item",
    variant.observation,
    `usage:${key}`,
    storage ? "account" : "outcome",
  );
}

function searchSignal(kind: "search" | "maps", unit: UnitExpression): string {
  const request =
    unit.factors.length === 1 &&
    unit.factors[0]?.unit.namespace === "kmodels" &&
    unit.factors[0].unit.value === "request";
  return request ? `${kind}_grounded_prompts` : `${kind}_executed_queries`;
}

function singleUnit(unit: UnitExpression): string {
  const factor = unit.factors.length === 1 ? unit.factors[0] : undefined;
  if (factor?.power !== 1) return "quantity";
  return `${factor.unit.value}${factor.unit.value.endsWith("s") ? "" : "s"}`;
}

function bindResourceRelations(
  book: AtomicPricingBook,
  modelOffers: ReadonlyMap<string, string>,
): void {
  if (book.scope.kind !== "provider_resource") return;
  for (const offer of book.offers) {
    const modelRef = offerModelRef(offer.offer_key);
    const target = modelRef === undefined ? undefined : modelOffers.get(modelRef);
    if (target === undefined) continue;
    const grounding = ["google-search", "google-maps"].includes(book.scope.resource_key);
    offer.relations.push(
      relation(
        offer,
        grounding ? "requires" : "compatible_with",
        target,
        grounding
          ? "Grounding adds to the exact model's synchronous inference charge"
          : "Explicit cache storage remains bound to its exact model identity",
      ),
    );
  }
}

function offerModelRef(offerKey: string): string | undefined {
  for (const prefix of ["grounding:", "storage:"])
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
  resolutionPhase: "outcome" | "account" = "outcome",
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
  return {
    ...offer,
    settlement: [
      {
        channel: "direct",
        biller: "Google",
        payment_sources: ["allowance", "prepaid_balance", "provider_credit", "postpaid_invoice"],
        applicability: unconditionalApplicability,
        observations: [
          {
            ...evidence,
            raw: { label: `${label} settles directly through Google` },
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

function exclusiveRelation(
  offer: AtomicPricingOffer,
  target: string,
  label: string,
): OfferRelation {
  return relation(offer, "exclusive_with", target, label);
}

function offerEvidence(offer: AtomicPricingOffer): RawPriceObservation {
  const evidence =
    offer.states[0]?.observation ??
    offer.terms.flatMap((term) =>
      term.kind === "raw"
        ? term.variants.map(({ observation }) => observation)
        : [...term.variants, ...term.raw_variants].map(({ observation }) => observation),
    )[0];
  if (evidence === undefined) throw new Error(`Gemini offer ${offer.offer_key} has no evidence`);
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
