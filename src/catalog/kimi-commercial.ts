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
  UsageSignal,
} from "./pricing-schema.ts";

type Mechanism = "sync" | "batch";

interface ModelOffers {
  sync?: string;
  batch?: string;
}

export function applyKimiCommercialTopology(input: AtomicProviderPricing): AtomicProviderPricing {
  if (input.provider_id !== "kimi") return input;
  const modelOffers = new Map<string, ModelOffers>();
  const books = input.books.map((book) => {
    if (book.scope.kind !== "models") return bindResourceBook(book, input);
    const migrated = splitModelBook(book);
    const bookId = pricingBookId(input.provider_id, book.book_key);
    const offers: ModelOffers = {};
    if (migrated.offers.some(({ offer_key }) => offer_key === "sync"))
      offers.sync = pricingOfferId(bookId, "sync");
    if (migrated.offers.some(({ offer_key }) => offer_key === "batch"))
      offers.batch = pricingOfferId(bookId, "batch");
    for (const modelRef of book.scope.model_refs) modelOffers.set(modelRef, offers);
    return migrated;
  });
  for (const book of books)
    if (book.scope.kind === "provider_resource") bindResourceRelations(book, modelOffers);
  return { ...input, books };
}

function splitModelBook(book: AtomicPricingBook): AtomicPricingBook {
  const offers = book.offers.flatMap((offer) => {
    if (offer.offer_key !== "usage") return [withSettlement(offer, "Kimi API usage")];
    const sync = partitionOffer(book, offer, "sync");
    const batch = partitionOffer(book, offer, "batch");
    const result = [sync, batch].filter(hasCommercialContent);
    if (sync !== undefined && batch !== undefined && result.length === 2) {
      const bookId = pricingBookId("kimi", book.book_key);
      sync.relations.push(
        relation(
          sync,
          "exclusive_with",
          [pricingOfferId(bookId, "batch")],
          "Synchronous and Batch inference are alternative execution mechanisms",
        ),
      );
      batch.relations.push(
        relation(
          batch,
          "exclusive_with",
          [pricingOfferId(bookId, "sync")],
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
): AtomicPricingOffer | undefined {
  const states = offer.states.flatMap((state) => {
    const applicability = mechanismApplicability(state.applicability, mechanism);
    return applicability === undefined
      ? []
      : [{ ...state, applicability, observation: normalized(state.observation, applicability) }];
  });
  const terms = offer.terms.flatMap((term) => partitionTerm(book, term, mechanism));
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
    mechanism === "batch" ? "Kimi Batch usage" : "Kimi synchronous usage",
  );
}

function partitionTerm(
  book: AtomicPricingBook,
  term: AtomicPricingTerm,
  mechanism: Mechanism,
): AtomicPricingTerm[] {
  if (term.kind === "raw") {
    const variants = term.variants.flatMap((variant) => partitionRaw(variant, mechanism));
    return variants.length === 0 ? [] : [{ ...term, variants }];
  }
  if (term.kind !== "rate") return mechanism === "sync" ? [term] : [];
  const variants = term.variants.flatMap((variant) => {
    const applicability = mechanismApplicability(variant.applicability, mechanism);
    if (applicability === undefined) return [];
    const charge_binding = modelBinding(book, term.meter, variant, mechanism);
    return [
      {
        ...variant,
        applicability,
        observation: normalized(variant.observation, applicability),
        ...(charge_binding === undefined ? {} : { charge_binding }),
      },
    ];
  });
  const raw_variants = term.raw_variants.flatMap((variant) => partitionRaw(variant, mechanism));
  return variants.length + raw_variants.length === 0 ? [] : [{ ...term, variants, raw_variants }];
}

function partitionRaw(variant: AtomicRawVariant, mechanism: Mechanism): AtomicRawVariant[] {
  if (variant.possible_scope === undefined) return mechanism === "sync" ? [variant] : [];
  const possible_scope = mechanismApplicability(variant.possible_scope, mechanism);
  return possible_scope === undefined ? [] : [{ ...variant, possible_scope }];
}

function mechanismApplicability(
  applicability: PriceApplicability,
  mechanism: Mechanism,
): PriceApplicability | undefined {
  const any_of = applicability.any_of.flatMap(({ all_of }) => {
    const tier = all_of.find(isServiceTier);
    const batch =
      tier?.kind === "categorical" && tier.values.some(({ value }) => value === "batch");
    if ((mechanism === "batch") !== batch) return [];
    return [{ all_of: tier === undefined ? all_of : all_of.filter((item) => item !== tier) }];
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
): ChargeBinding | undefined {
  if (meter.namespace !== "kmodels" || !isTokenUnit(variant.price.per)) return;
  const modelRef = book.scope.kind === "models" ? book.scope.model_refs[0] : undefined;
  if (modelRef === undefined) return;
  if (mechanism === "batch") {
    if (modelRef.endsWith("/kimi-k2.7-code") || meter.value !== "output_text") return;
    return standardBinding("output_tokens", "result_item", variant.observation, "batch:output");
  }
  const signal: Extract<UsageSignal, { namespace: "kmodels" }>["value"] | undefined =
    meter.value === "cache_read_text"
      ? "cached_input_tokens"
      : meter.value === "output_text"
        ? "output_tokens"
        : meter.value === "input_text"
          ? modelRef.includes("/moonshot-v1-")
            ? "input_tokens"
            : "uncached_input_tokens"
          : undefined;
  return signal === undefined
    ? undefined
    : standardBinding(signal, "request", variant.observation, `chat:${signal}`);
}

function standardBinding(
  signal: Extract<UsageSignal, { namespace: "kmodels" }>["value"],
  aggregation: ChargeBinding["aggregation"],
  evidence: RawPriceObservation,
  locator: string,
): ChargeBinding {
  return {
    signal: { namespace: "kmodels", value: signal },
    aggregation,
    observations: [{ ...rawEvidence(evidence), locator: { kind: "provider_key", value: locator } }],
  };
}

function bindResourceBook(
  book: AtomicPricingBook,
  input: AtomicProviderPricing,
): AtomicPricingBook {
  if (book.scope.kind !== "provider_resource") return book;
  const resourceKey = book.scope.resource_key;
  const offers = book.offers.map((offer) => ({
    ...withSettlement(offer, `Kimi ${book.name ?? book.book_key}`),
    terms: offer.terms.map((term) => {
      if (term.kind !== "rate") return term;
      return {
        ...term,
        variants: term.variants.map((variant) => {
          const charge_binding = resourceBinding(resourceKey, offer, variant, input);
          return charge_binding === undefined ? variant : { ...variant, charge_binding };
        }),
      };
    }),
  }));
  return { ...book, offers };
}

function resourceBinding(
  resourceKey: string,
  offer: AtomicPricingOffer,
  variant: AtomicRateVariant,
  input: AtomicProviderPricing,
): ChargeBinding | undefined {
  if (resourceKey !== "web-search" || !isEventUnit(variant.price.per)) return;
  const formula = offer.offer_key === "formula";
  return providerBinding(
    input,
    formula ? "formula_web_search_fiber_executions" : "emitted_builtin_web_search_calls",
    formula
      ? "Created moonshot/web-search:latest Fiber executions"
      : "Exact emitted $web_search items in responses whose finish_reason is tool_calls",
    variant.price.per,
    formula ? "resource" : "request",
    variant.observation,
    formula ? "formula:web-search-fiber" : "chat:built-in-web-search",
    "outcome",
  );
}

function bindResourceRelations(
  book: AtomicPricingBook,
  modelOffers: ReadonlyMap<string, ModelOffers>,
): void {
  if (book.scope.kind !== "provider_resource") return;
  const resourceKey = book.scope.resource_key;
  for (const offer of book.offers) {
    if (resourceKey === "web-search" && offer.offer_key.startsWith("built-in:")) {
      const target = modelOffers.get(offer.offer_key.slice("built-in:".length))?.sync;
      if (target !== undefined)
        offer.relations.push(
          relation(
            offer,
            "requires",
            [target],
            "Built-in web search adds to the exact synchronous model inference charge",
          ),
        );
      continue;
    }
    const targets = book.scope.model_refs.flatMap((modelRef) => {
      const current = modelOffers.get(modelRef);
      return resourceKey === "files"
        ? [current?.sync, current?.batch].filter((ref): ref is string => ref !== undefined)
        : current?.sync === undefined
          ? []
          : [current.sync];
    });
    if (targets.length > 0)
      offer.relations.push(
        relation(
          offer,
          "compatible_with",
          targets,
          resourceKey === "files"
            ? "Files can supply exact synchronous or Batch workflows while model usage remains separate"
            : "Formula execution is independently callable and compatible with the documented model loop",
        ),
      );
  }
}

function providerBinding(
  input: AtomicProviderPricing,
  key: string,
  definition: string,
  unit: UnitExpression,
  aggregation: ChargeBinding["aggregation"],
  evidence: RawPriceObservation,
  locator: string,
  resolutionPhase: "outcome" | "account",
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
        biller: "Moonshot AI",
        payment_sources: ["prepaid_balance", "provider_credit", "postpaid_invoice"],
        applicability: unconditionalApplicability,
        observations: [
          {
            ...rawEvidence(evidence),
            raw: { label: `${label} settles directly through the selected regional Kimi account` },
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
  targets: string[],
  label: string,
): OfferRelation {
  const offerRefs = [...new Set(targets)].sort();
  const evidence = offerEvidence(offer);
  return {
    kind,
    target: { kind: "offers", offer_refs: offerRefs },
    applicability: unconditionalApplicability,
    observations: [
      {
        ...rawEvidence(evidence),
        raw: { label },
        establishes_offer_refs: offerRefs,
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
  if (evidence === undefined) throw new Error(`Kimi offer ${offer.offer_key} has no evidence`);
  return evidence;
}

function normalized(
  observation: NormalizedPriceObservation,
  applicability: PriceApplicability,
): NormalizedPriceObservation {
  return { ...observation, establishes_applicability: applicability };
}

function isTokenUnit(unit: UnitExpression): boolean {
  return isUnit(unit, "token");
}

function isEventUnit(unit: UnitExpression): boolean {
  return isUnit(unit, "event");
}

function isUnit(unit: UnitExpression, expected: "event" | "token"): boolean {
  return (
    unit.factors.length === 1 &&
    unit.factors[0]?.power === 1 &&
    unit.factors[0].unit.namespace === "kmodels" &&
    unit.factors[0].unit.value === expected
  );
}

function hasCommercialContent(offer: AtomicPricingOffer | undefined): offer is AtomicPricingOffer {
  return offer !== undefined && (offer.states.length > 0 || offer.terms.length > 0);
}
