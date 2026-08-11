import type {
  AtomicPricingBook,
  AtomicPricingOffer,
  AtomicPricingTerm,
  AtomicProviderPricing,
  AtomicRateVariant,
  AtomicRawVariant,
} from "./pricing-assembly.ts";
import { canonicalizeApplicability, unconditionalApplicability } from "./pricing-canonical.ts";
import {
  accountingGaps,
  isStandardUnit,
  offerEvidence,
  rawEvidence,
  relation,
} from "./pricing-commercial-assembly.ts";
import { pricingBookId, pricingOfferId } from "./pricing-identifiers.ts";
import type {
  ChargeBinding,
  NormalizedPriceObservation,
  PriceApplicability,
  PriceCondition,
  PriceMeter,
  UnitExpression,
  UsageSignal,
} from "./pricing-schema.ts";

type Mechanism = "sync" | "batch";

interface ModelOffers {
  sync?: string;
  batch?: string;
}

export function applyDashscopeCommercialTopology(
  input: AtomicProviderPricing,
): AtomicProviderPricing {
  if (input.provider_id !== "dashscope") return input;
  const modelOffers = new Map<string, ModelOffers>();
  const books = input.books.map((book) => {
    if (book.scope.kind !== "models") return bindResourceBook(book);
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
  const blocked = accountingGaps(book.offers.flatMap(({ terms }) => terms));
  const offers = book.offers.flatMap((offer) => {
    if (offer.offer_key !== "usage")
      return [withSettlement(offer, "Model Studio usage", blocked.has("settlement"))];
    const hasCache = offer.terms.some(
      (term) =>
        term.kind === "rate" &&
        term.meter.namespace === "kmodels" &&
        ["cache_read_text", "cache_write_text"].includes(term.meter.value),
    );
    const sync = partitionOffer(offer, "sync", blocked, hasCache);
    const batch = partitionOffer(offer, "batch", blocked, hasCache);
    const result = [sync, batch].filter(hasCommercialContent);
    if (sync !== undefined && batch !== undefined && result.length === 2) {
      const bookId = pricingBookId("dashscope", book.book_key);
      sync.relations.push(
        relation(
          sync,
          "exclusive_with",
          [pricingOfferId(bookId, "batch")],
          "Realtime and Batch inference are alternative execution mechanisms",
        ),
      );
      batch.relations.push(
        relation(
          batch,
          "exclusive_with",
          [pricingOfferId(bookId, "sync")],
          "Batch and realtime inference are alternative execution mechanisms",
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
  blocked: ReadonlySet<string>,
  hasCache: boolean,
): AtomicPricingOffer | undefined {
  const states = offer.states.flatMap((state) => {
    const applicability = mechanismApplicability(state.applicability, mechanism);
    return applicability === undefined
      ? []
      : [{ ...state, applicability, observation: normalized(state.observation, applicability) }];
  });
  const terms = offer.terms.flatMap((term) => partitionTerm(term, mechanism, blocked, hasCache));
  if (states.length === 0 && terms.length === 0) return;
  return withSettlement(
    {
      ...offer,
      offer_key: mechanism,
      name: mechanism === "batch" ? "Batch inference" : "Realtime inference",
      states,
      terms,
      relations: [],
    },
    mechanism === "batch" ? "Model Studio Batch usage" : "Model Studio realtime usage",
    blocked.has("settlement"),
  );
}

function partitionTerm(
  term: AtomicPricingTerm,
  mechanism: Mechanism,
  blocked: ReadonlySet<string>,
  hasCache: boolean,
): AtomicPricingTerm[] {
  if (term.kind === "raw") {
    const variants = term.variants.flatMap((variant) => partitionRaw(variant, mechanism));
    return variants.length === 0 ? [] : [{ ...term, variants }];
  }
  if (term.kind !== "rate") return mechanism === "sync" ? [term] : [];
  const variants = term.variants.flatMap((variant) => {
    const applicability = mechanismApplicability(variant.applicability, mechanism);
    if (applicability === undefined) return [];
    const next = {
      ...variant,
      applicability,
      observation: normalized(variant.observation, applicability),
    };
    const charge_binding = modelBinding(term.meter, next, mechanism, blocked, hasCache);
    return [{ ...next, ...(charge_binding === undefined ? {} : { charge_binding }) }];
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
    const tier = all_of.find(isBatchTier);
    if ((mechanism === "batch") !== (tier !== undefined)) return [];
    return [{ all_of: tier === undefined ? all_of : all_of.filter((item) => item !== tier) }];
  });
  return any_of.length === 0 ? undefined : canonicalizeApplicability({ any_of });
}

function isBatchTier(condition: PriceCondition): boolean {
  return (
    condition.kind === "categorical" &&
    condition.dimension.namespace === "kmodels" &&
    condition.dimension.value === "service_tier" &&
    condition.values.some(({ value }) => value === "batch")
  );
}

function modelBinding(
  meter: PriceMeter,
  variant: AtomicRateVariant,
  mechanism: Mechanism,
  blocked: ReadonlySet<string>,
  hasCache: boolean,
): ChargeBinding | undefined {
  if (
    blocked.has("tokens") ||
    (mechanism === "batch" && blocked.has("batch")) ||
    (blocked.has("cache") &&
      meter.namespace === "kmodels" &&
      ["cache_read_text", "cache_write_text"].includes(meter.value)) ||
    !isUnit(variant.price.per, "token")
  )
    return;
  const signal: Extract<UsageSignal, { namespace: "kmodels" }>["value"] | undefined =
    meter.namespace !== "kmodels"
      ? undefined
      : meter.value === "cache_read_text"
        ? "cached_input_tokens"
        : meter.value === "cache_write_text"
          ? "cache_write_tokens"
          : meter.value === "output_text"
            ? "output_tokens"
            : meter.value === "input_text"
              ? hasCache && mechanism === "sync"
                ? "uncached_input_tokens"
                : "input_tokens"
              : undefined;
  if (signal === undefined) return;
  return {
    signal: { namespace: "kmodels", value: signal },
    aggregation: mechanism === "batch" ? "result_item" : "request",
    observations: [
      {
        ...rawEvidence(variant.observation),
        locator: {
          kind: "provider_key",
          value: `${mechanism}:${usageField(signal)}`,
        },
      },
    ],
  };
}

function usageField(signal: Extract<UsageSignal, { namespace: "kmodels" }>["value"]): string {
  if (signal === "cache_write_tokens") return "cache_creation_input_tokens";
  if (signal === "cached_input_tokens") return "cached_tokens";
  if (signal === "uncached_input_tokens" || signal === "input_tokens") return "input_tokens";
  return "output_tokens";
}

function bindResourceBook(book: AtomicPricingBook): AtomicPricingBook {
  if (book.scope.kind !== "provider_resource") return book;
  return {
    ...book,
    offers: book.offers.map((offer) => ({
      ...withSettlement(
        offer,
        `Model Studio ${book.name ?? book.book_key}`,
        offer.terms.some(
          ({ term_key }) => term_key === "accounting_binding_unavailable:settlement",
        ),
      ),
      terms: offer.terms.map((term) => {
        if (
          book.scope.kind !== "provider_resource" ||
          book.scope.resource_key !== "web-search" ||
          term.kind !== "rate" ||
          offer.terms.some(
            ({ term_key }) => term_key === "accounting_binding_unavailable:web_search",
          )
        )
          return term;
        return {
          ...term,
          variants: term.variants.map(
            (variant): AtomicRateVariant =>
              isUnit(variant.price.per, "event") || isUnit(variant.price.per, "request")
                ? {
                    ...variant,
                    charge_binding: {
                      signal: { namespace: "kmodels", value: "successful_web_searches" },
                      aggregation: "request",
                      observations: [
                        {
                          ...rawEvidence(variant.observation),
                          locator: {
                            kind: "provider_key",
                            value: "response:usage.x_tools.web_search.count",
                          },
                        },
                      ],
                    },
                  }
                : variant,
          ),
        };
      }),
    })),
  };
}

function bindResourceRelations(
  book: AtomicPricingBook,
  modelOffers: ReadonlyMap<string, ModelOffers>,
): void {
  if (book.scope.kind !== "provider_resource" || book.scope.resource_key !== "web-search") return;
  for (const offer of book.offers) {
    const encoded = offer.offer_key.match(/^built-in:(.+):[^:]+$/)?.[1];
    const target = encoded === undefined ? undefined : modelOffers.get(encoded)?.sync;
    if (target !== undefined)
      offer.relations.push(
        relation(
          offer,
          "requires",
          [target],
          "Executed built-in web search adds to the exact realtime model inference charge",
        ),
      );
  }
}

function withSettlement(
  offer: AtomicPricingOffer,
  label: string,
  unavailable = false,
): AtomicPricingOffer {
  if (unavailable) return { ...offer, settlement: [] };
  return {
    ...offer,
    settlement: [
      {
        channel: "direct",
        biller: "Alibaba Cloud",
        payment_sources: ["prepaid_balance", "provider_credit", "postpaid_invoice"],
        applicability: unconditionalApplicability,
        observations: [
          {
            ...rawEvidence(offerEvidence(offer)),
            raw: { label: `${label} settles through the selected Model Studio account` },
            establishes_applicability: unconditionalApplicability,
          },
        ],
      },
    ],
  };
}

function normalized(
  observation: NormalizedPriceObservation,
  applicability: PriceApplicability,
): NormalizedPriceObservation {
  return { ...observation, establishes_applicability: applicability };
}

function isUnit(unit: UnitExpression, value: "event" | "request" | "token"): boolean {
  return isStandardUnit(unit, value);
}

function hasCommercialContent(offer: AtomicPricingOffer | undefined): offer is AtomicPricingOffer {
  return offer !== undefined && (offer.states.length > 0 || offer.terms.length > 0);
}
