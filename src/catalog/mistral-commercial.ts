import type {
  AtomicPricingBook,
  AtomicPricingOffer,
  AtomicPricingTerm,
  AtomicProviderPricing,
  AtomicRateVariant,
  AtomicRawVariant,
} from "./pricing-assembly.ts";
import { canonicalizeApplicability, unconditionalApplicability } from "./pricing-canonical.ts";
import { pricingBookId, pricingOfferId } from "./pricing-identifiers.ts";
import type {
  ChargeBinding,
  NormalizedPriceObservation,
  OfferRelation,
  PriceApplicability,
  PriceCondition,
  PriceMeter,
  ProviderAtomRegistryEntry,
  RawPriceObservation,
  UnitExpression,
} from "./pricing-schema.ts";

type Mechanism = "sync" | "batch";

interface ModelOffers {
  sync?: string;
  batch?: string;
}

export function applyMistralCommercialTopology(
  input: AtomicProviderPricing,
): AtomicProviderPricing {
  if (input.provider_id !== "mistral") return input;
  const modelOffers = new Map<string, ModelOffers>();
  const books = input.books.map((book) => {
    if (book.scope.kind !== "models") return resourceBook(book, input);
    const migrated = splitModelBook(book, input);
    const bookId = pricingBookId(input.provider_id, book.book_key);
    const offers: ModelOffers = {};
    if (migrated.offers.some(({ offer_key }) => offer_key === "sync"))
      offers.sync = pricingOfferId(bookId, "sync");
    if (migrated.offers.some(({ offer_key }) => offer_key === "batch"))
      offers.batch = pricingOfferId(bookId, "batch");
    for (const modelRef of book.scope.model_refs) modelOffers.set(modelRef, offers);
    return migrated;
  });
  bindResourceRelations(books, modelOffers);
  return { ...input, books };
}

function splitModelBook(book: AtomicPricingBook, input: AtomicProviderPricing): AtomicPricingBook {
  const blocked = accountingGaps(book);
  const offers = book.offers.flatMap((offer) => {
    if (offer.offer_key !== "usage") return [directSettlement(offer, "Mistral API usage")];
    const sync = partitionOffer(offer, "sync", input, blocked);
    const batch = partitionOffer(offer, "batch", input, blocked);
    const result = [sync, batch].filter(hasCommercialContent);
    if (sync !== undefined && batch !== undefined && result.length === 2) {
      const bookId = pricingBookId(input.provider_id, book.book_key);
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
  offer: AtomicPricingOffer,
  mechanism: Mechanism,
  input: AtomicProviderPricing,
  blocked: ReadonlySet<string>,
): AtomicPricingOffer | undefined {
  const hasCache = offer.terms.some(
    (term) =>
      term.kind === "rate" &&
      term.meter.namespace === "kmodels" &&
      term.meter.value === "cache_read_text",
  );
  const states = offer.states.flatMap((state) => {
    const applicability = mechanismApplicability(state.applicability, mechanism);
    return applicability === undefined
      ? []
      : [{ ...state, applicability, observation: normalized(state.observation, applicability) }];
  });
  const terms = offer.terms.flatMap((term) =>
    partitionTerm(term, mechanism, input, blocked, hasCache),
  );
  if (states.length === 0 && terms.length === 0) return;
  return directSettlement(
    {
      ...offer,
      offer_key: mechanism,
      name: mechanism === "batch" ? "Batch inference" : "Synchronous inference",
      states,
      terms,
      relations: [],
    },
    mechanism === "batch" ? "Mistral Batch usage" : "Mistral synchronous API usage",
  );
}

function partitionTerm(
  term: AtomicPricingTerm,
  mechanism: Mechanism,
  input: AtomicProviderPricing,
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
    const charge_binding = modelBinding(term.meter, next, mechanism, input, blocked, hasCache);
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

function accountingGaps(book: AtomicPricingBook): Set<string> {
  return new Set(
    book.offers.flatMap(({ terms }) =>
      terms.flatMap(({ term_key }) =>
        term_key.startsWith("accounting_binding_unavailable:")
          ? [term_key.slice("accounting_binding_unavailable:".length)]
          : [],
      ),
    ),
  );
}

function modelBinding(
  meter: PriceMeter,
  variant: AtomicRateVariant,
  mechanism: Mechanism,
  input: AtomicProviderPricing,
  blocked: ReadonlySet<string>,
  hasCache: boolean,
): ChargeBinding | undefined {
  if (meter.namespace !== "kmodels") return;
  const aggregation = mechanism === "batch" ? "result_item" : "request";
  if (["input_text", "output_text", "cache_read_text", "embedding"].includes(meter.value)) {
    if (blocked.has("tokens") || !isUnit(variant.price.per, "token")) return;
    const signal =
      meter.value === "cache_read_text"
        ? "cached_input_tokens"
        : meter.value === "output_text"
          ? "output_tokens"
          : meter.value === "input_text" && hasCache && mechanism === "sync"
            ? "uncached_input_tokens"
            : "input_tokens";
    return standardBinding(signal, aggregation, variant.observation, `${mechanism}:${signal}`);
  }
  if (meter.value === "input_image" && !blocked.has("ocr") && isUnit(variant.price.per, "page"))
    return providerBinding(
      input,
      "pages_processed",
      "OCR pages reported by response usage_info.pages_processed",
      variant.price.per,
      aggregation,
      variant.observation,
      "response:usage_info.pages_processed",
      "outcome",
    );
  if (
    meter.value === "input_audio" &&
    !blocked.has("transcription") &&
    isUnit(variant.price.per, "second")
  )
    return providerBinding(
      input,
      "submitted_audio_seconds",
      "Submitted audio duration in billable seconds",
      variant.price.per,
      aggregation,
      variant.observation,
      "request:audio_duration_seconds",
      "outcome",
    );
  if (meter.value === "output_audio" && isUnit(variant.price.per, "character"))
    return providerBinding(
      input,
      "submitted_tts_characters",
      "Characters in text submitted to the speech synthesis request",
      variant.price.per,
      aggregation,
      variant.observation,
      "request:input.length",
      "request",
    );
}

function standardBinding(
  value: "cached_input_tokens" | "input_tokens" | "output_tokens" | "uncached_input_tokens",
  aggregation: ChargeBinding["aggregation"],
  evidence: RawPriceObservation,
  locator: string,
): ChargeBinding {
  return {
    signal: { namespace: "kmodels", value },
    aggregation,
    observations: [{ ...rawEvidence(evidence), locator: { kind: "provider_key", value: locator } }],
  };
}

function resourceBook(book: AtomicPricingBook, input: AtomicProviderPricing): AtomicPricingBook {
  if (book.scope.kind !== "provider_resource") return book;
  const scope = book.scope;
  return {
    ...book,
    offers: book.offers.map((offer) => {
      const accountResource = scope.resource_kind.value === "account_resource_template";
      const distribution = scope.resource_kind.value === "distribution";
      const custom = offer.states.some(({ state }) => state === "custom_quote");
      const terms = offer.terms.map((term) => bindResourceTerm(book, offer, term, input));
      const migrated = {
        ...offer,
        terms,
        ...(accountResource || custom
          ? {
              enrollment: [
                {
                  state: "account_scoped" as const,
                  applicability: unconditionalApplicability,
                  observations: [normalized(offerEvidence(offer), unconditionalApplicability)],
                },
              ],
            }
          : {}),
      };
      return distribution
        ? { ...migrated, settlement: [] }
        : directSettlement(migrated, `Mistral ${book.name ?? book.book_key}`);
    }),
  };
}

function bindResourceTerm(
  book: AtomicPricingBook,
  offer: AtomicPricingOffer,
  term: AtomicPricingTerm,
  input: AtomicProviderPricing,
): AtomicPricingTerm {
  if (
    term.kind !== "rate" ||
    offer.terms.some(
      (candidate) =>
        candidate.kind === "raw" && candidate.term_key === "charge_binding_unavailable",
    )
  )
    return term;
  return {
    ...term,
    variants: term.variants.map((variant) => {
      const signal = resourceSignal(
        book.scope.kind === "provider_resource" ? book.scope.resource_key : "",
        offer.offer_key,
        term.meter,
        variant,
      );
      return signal === undefined
        ? variant
        : {
            ...variant,
            charge_binding: providerBinding(
              input,
              signal.key,
              signal.definition,
              variant.price.per,
              signal.aggregation,
              variant.observation,
              signal.locator,
              signal.phase,
            ),
          };
    }),
  };
}

function resourceSignal(
  resourceKey: string,
  offerKey: string,
  meter: PriceMeter,
  variant: AtomicRateVariant,
):
  | {
      key: string;
      definition: string;
      aggregation: ChargeBinding["aggregation"];
      locator: string;
      phase: "account" | "outcome" | "request";
    }
  | undefined {
  if (resourceKey === "code-execution" && isUnit(variant.price.per, "request"))
    return {
      key: "completed_code_executions",
      definition: "Completed code_interpreter executions in final connector usage",
      aggregation: "request",
      locator: "response:usage.connectors.code_interpreter",
      phase: "outcome",
    };
  if (
    (resourceKey === "web-search" || resourceKey === "premium-news") &&
    isUnit(variant.price.per, "request")
  )
    return {
      key:
        resourceKey === "web-search" ? "completed_web_searches" : "completed_premium_news_searches",
      definition: "Completed provider-executed searches in final connector usage",
      aggregation: "request",
      locator: `response:usage.connectors.${resourceKey === "web-search" ? "web_search" : "web_search_premium"}`,
      phase: "outcome",
    };
  if (
    resourceKey === "image-generation" &&
    meter.namespace === "kmodels" &&
    meter.value === "image_generation"
  )
    return {
      key: "generated_images",
      definition: "Generated image outputs returned by image_generation tool executions",
      aggregation: "result_item",
      locator: "response:generated image files",
      phase: "outcome",
    };
  if (resourceKey === "library" && offerKey === "retrieval" && isUnit(variant.price.per, "request"))
    return {
      key: "document_library_calls",
      definition: "Completed document_library calls in final connector usage",
      aggregation: "request",
      locator: "response:usage.connectors.document_library",
      phase: "outcome",
    };
  if (meter.namespace === "kmodels" && meter.value === "subscription")
    return {
      key: "subscription_months",
      definition: "Provider-account subscription billing months",
      aggregation: "billing_period",
      locator: "account:subscription-period",
      phase: "account",
    };
}

function bindResourceRelations(
  books: AtomicPricingBook[],
  modelOffers: ReadonlyMap<string, ModelOffers>,
): void {
  const composable = new Set([
    "agent",
    "code-execution",
    "web-search",
    "premium-news",
    "image-generation",
    "library",
  ]);
  const toolOfferRefs = books.flatMap((book) =>
    book.scope.kind === "provider_resource" &&
    ["code-execution", "web-search", "premium-news", "image-generation", "library"].includes(
      book.scope.resource_key,
    )
      ? book.offers.map(({ offer_key }) =>
          pricingOfferId(pricingBookId("mistral", book.book_key), offer_key),
        )
      : [],
  );
  for (const book of books) {
    if (book.scope.kind !== "provider_resource" || !composable.has(book.scope.resource_key))
      continue;
    const targets = book.scope.model_refs.flatMap((modelRef) => {
      const sync = modelOffers.get(modelRef)?.sync;
      return sync === undefined ? [] : [sync];
    });
    const bookId = pricingBookId("mistral", book.book_key);
    for (const offer of book.offers) {
      if (
        targets.length > 0 &&
        !(book.scope.resource_key === "library" && offer.offer_key !== "retrieval")
      )
        offer.relations.push(
          relation(
            offer,
            "requires",
            targets,
            "This provider-executed resource composes with exact eligible synchronous model routes",
          ),
        );
      if (
        ["code-execution", "web-search", "premium-news", "image-generation", "library"].includes(
          book.scope.resource_key,
        )
      ) {
        const current = pricingOfferId(bookId, offer.offer_key);
        const peers = toolOfferRefs.filter((target) => target !== current);
        if (peers.length > 0)
          offer.relations.push(
            relation(
              offer,
              "compatible_with",
              peers,
              "Mistral built-in tools may be combined in one provider-executed route",
            ),
          );
      }
    }
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
  phase: "account" | "outcome" | "request",
): ChargeBinding {
  addAtom(input, { kind: "usage_signal", key, definition, unit, resolution_phase: phase });
  return {
    signal: { namespace: "provider", provider_id: input.provider_id, value: key },
    aggregation,
    observations: [{ ...rawEvidence(evidence), locator: { kind: "provider_key", value: locator } }],
  };
}

function directSettlement(offer: AtomicPricingOffer, label: string): AtomicPricingOffer {
  if (
    offer.states.some(({ state }) => state === "free") &&
    !offer.states.some(({ state }) => state === "numeric") &&
    !offer.terms.some((term) => term.kind === "rate" && term.variants.length > 0)
  )
    return { ...offer, settlement: [] };
  return {
    ...offer,
    settlement: [
      {
        channel: "direct",
        biller: "Mistral AI",
        payment_sources: ["provider_credit", "postpaid_invoice"],
        applicability: unconditionalApplicability,
        observations: [
          {
            ...rawEvidence(offerEvidence(offer)),
            raw: { label: `${label} settles through the Mistral account` },
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
  const offer_refs = [...new Set(targets)].sort();
  return {
    kind,
    target: { kind: "offers", offer_refs },
    applicability: unconditionalApplicability,
    observations: [
      {
        ...rawEvidence(offerEvidence(offer)),
        raw: { label },
        establishes_offer_refs: offer_refs,
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
  if (evidence === undefined) throw new Error(`Mistral offer ${offer.offer_key} has no evidence`);
  return evidence;
}

function normalized(
  observation: RawPriceObservation,
  applicability: PriceApplicability,
): NormalizedPriceObservation {
  return { ...rawEvidence(observation), establishes_applicability: applicability };
}

function rawEvidence(observation: RawPriceObservation): RawPriceObservation {
  return { source_ref: observation.source_ref, locator: observation.locator, raw: observation.raw };
}

function isUnit(unit: UnitExpression, value: string): boolean {
  const factor = unit.factors.length === 1 ? unit.factors[0] : undefined;
  return factor?.power === 1 && factor.unit.namespace === "kmodels" && factor.unit.value === value;
}

function hasCommercialContent(offer: AtomicPricingOffer | undefined): offer is AtomicPricingOffer {
  return offer !== undefined && (offer.states.length > 0 || offer.terms.length > 0);
}

function addAtom(input: AtomicProviderPricing, atom: ProviderAtomRegistryEntry): void {
  const current = input.vocabulary.atoms.find(
    (candidate) => candidate.kind === atom.kind && candidate.key === atom.key,
  );
  if (current === undefined) input.vocabulary.atoms.push(atom);
  else if (JSON.stringify(current) !== JSON.stringify(atom))
    throw new Error(`Mistral provider atom ${atom.kind}:${atom.key} conflicts`);
}
