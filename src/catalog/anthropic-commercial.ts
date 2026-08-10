import type {
  AtomicAllowanceTerm,
  AtomicContributionTerm,
  AtomicPricingBook,
  AtomicPricingOffer,
  AtomicPricingTerm,
  AtomicProviderPricing,
  AtomicRateVariant,
  AtomicRawVariant,
} from "./pricing-assembly.ts";
import { canonicalizeApplicability, unconditionalApplicability } from "./pricing-canonical.ts";
import { pricingBookId, pricingOfferId, pricingTermId } from "./pricing-identifiers.ts";
import { multiplyRationals, rationalFromDecimal } from "./pricing-rational.ts";
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
type TokenSignal = NonNullable<ReturnType<typeof tokenSignal>>;

const tokenUnit: UnitExpression = {
  factors: [{ unit: { namespace: "kmodels", value: "token" }, power: 1 }],
};

export function applyAnthropicCommercialTopology(
  input: AtomicProviderPricing,
): AtomicProviderPricing {
  if (input.provider_id !== "anthropic") return input;
  const books = input.books.map((book) =>
    book.scope.kind === "models" ? splitModelBook(book, input) : book,
  );
  applyResourceTopology(input, books);
  return { ...input, books };
}

function splitModelBook(book: AtomicPricingBook, input: AtomicProviderPricing): AtomicPricingBook {
  const offers = book.offers.flatMap((offer) => {
    if (offer.offer_key !== "usage") return [offer];
    const sync = partitionOffer(offer, "sync", input);
    const batch = partitionOffer(offer, "batch", input);
    const result = [sync, batch].filter(hasCommercialContent);
    if (sync !== undefined && batch !== undefined && result.length === 2) {
      const bookId = pricingBookId("anthropic", book.book_key);
      const syncId = pricingOfferId(bookId, "sync");
      const batchId = pricingOfferId(bookId, "batch");
      sync.relations.push(exclusiveRelation(sync, batchId));
      batch.relations.push(exclusiveRelation(batch, syncId));
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
    const applicability = partitionApplicability(state.applicability, mechanism);
    return applicability === undefined
      ? []
      : [
          {
            ...state,
            applicability,
            observation: normalizedObservation(state.observation, applicability),
          },
        ];
  });
  const terms = offer.terms.flatMap((term) => partitionTerm(term, mechanism, input));
  if (states.length === 0 && terms.length === 0) return;
  return {
    ...offer,
    offer_key: mechanism,
    name: mechanism === "batch" ? "Message Batches" : "Synchronous Messages",
    states,
    terms,
    relations: [],
  };
}

function partitionTerm(
  term: AtomicPricingTerm,
  mechanism: Mechanism,
  input: AtomicProviderPricing,
): AtomicPricingTerm[] {
  if (term.kind === "raw") {
    const variants = term.variants.flatMap((variant) => partitionRawVariant(variant, mechanism));
    return variants.length === 0 ? [] : [{ ...term, variants }];
  }
  if (term.kind !== "rate") return mechanism === "sync" ? [term] : [];
  const variants = term.variants.flatMap((variant) => {
    const applicability = partitionApplicability(variant.applicability, mechanism);
    if (applicability === undefined) return [];
    const next = {
      ...variant,
      applicability,
      observation: normalizedObservation(variant.observation, applicability),
    };
    const charge_binding = modelBinding(term.meter, next, mechanism, input);
    return [{ ...next, ...(charge_binding === undefined ? {} : { charge_binding }) }];
  });
  const raw_variants = term.raw_variants.flatMap((variant) =>
    partitionRawVariant(variant, mechanism),
  );
  return variants.length + raw_variants.length === 0 ? [] : [{ ...term, variants, raw_variants }];
}

function partitionRawVariant(variant: AtomicRawVariant, mechanism: Mechanism): AtomicRawVariant[] {
  if (variant.possible_scope === undefined) return mechanism === "sync" ? [variant] : [];
  const possible_scope = partitionApplicability(variant.possible_scope, mechanism);
  return possible_scope === undefined ? [] : [{ ...variant, possible_scope }];
}

function partitionApplicability(
  applicability: PriceApplicability,
  mechanism: Mechanism,
): PriceApplicability | undefined {
  const any_of = applicability.any_of.flatMap(({ all_of }) => {
    const tier = all_of.find(isBatchTier);
    const batch = tier !== undefined;
    if ((mechanism === "batch") !== batch) return [];
    return [{ all_of: batch ? all_of.filter((condition) => condition !== tier) : all_of }];
  });
  return any_of.length === 0 ? undefined : canonicalizeApplicability({ any_of });
}

function isBatchTier(condition: PriceCondition): boolean {
  return (
    condition.kind === "categorical" &&
    condition.dimension.namespace === "kmodels" &&
    ["service_tier", "served_service_tier"].includes(condition.dimension.value) &&
    condition.values.some(({ value }) => value === "batch")
  );
}

function modelBinding(
  meter: PriceMeter,
  variant: AtomicRateVariant,
  mechanism: Mechanism,
  input: AtomicProviderPricing,
): ChargeBinding | undefined {
  const signal = executorSignal(meter, variant);
  if (signal === undefined) return;
  addAtom(input, {
    kind: "usage_signal",
    key: signal.key,
    definition: signal.definition,
    unit: tokenUnit,
    resolution_phase: "outcome",
  });
  return {
    signal: { namespace: "provider", provider_id: "anthropic", value: signal.key },
    aggregation: mechanism === "batch" ? "result_item" : "attempt",
    observations: signal.locators.map((locator) => usageObservation(variant.observation, locator)),
  };
}

function executorSignal(
  meter: PriceMeter,
  variant: AtomicRateVariant,
): { key: string; definition: string; locators: string[] } | undefined {
  const signal = tokenSignal(meter, variant.price.per);
  if (signal === undefined) return;
  if (signal === "cache_write_tokens") {
    const ttl = exactCacheTtl(variant.applicability);
    if (ttl === undefined) return;
    const suffix = ttl === 300 ? "5m" : "1h";
    return {
      key: `executor_cache_write_${suffix}_tokens`,
      definition: `Billable ${suffix} cache-write tokens attributed to one Anthropic executor attempt; typed compaction iterations do not publish a TTL split`,
      locators: [`openapi:usage.cache_creation.ephemeral_${suffix}_input_tokens`],
    };
  }
  const field = usageField(signal);
  return {
    key: `executor_${signal}`,
    definition: `Billable ${signal.replaceAll("_", " ")} attributed to one Anthropic executor attempt; use top-level usage when iterations are absent, otherwise sum message and compaction iterations and exclude advisor_message`,
    locators: [
      `openapi:usage.${field} when usage.iterations is absent`,
      `openapi:sum(usage.iterations[type=message|compaction].${field}) when iterations is present`,
    ],
  };
}

function exactCacheTtl(applicability: PriceApplicability): 300 | 3600 | undefined {
  const values = new Set<number>();
  for (const { all_of } of applicability.any_of)
    for (const condition of all_of)
      if (
        condition.kind === "decimal_range" &&
        condition.dimension.namespace === "kmodels" &&
        condition.dimension.value === "cache_ttl_seconds" &&
        condition.lower?.inclusive === true &&
        condition.upper?.inclusive === true &&
        condition.lower.value === condition.upper.value
      )
        values.add(Number(condition.lower.value));
  if (values.size !== 1) return;
  const value = [...values][0];
  return value === 300 || value === 3600 ? value : undefined;
}

function tokenSignal(
  meter: PriceMeter,
  unit: UnitExpression,
):
  | "cached_input_tokens"
  | "cache_write_tokens"
  | "output_tokens"
  | "uncached_input_tokens"
  | undefined {
  if (meter.namespace !== "kmodels" || !isUnit(unit, "token")) return;
  if (meter.value === "input_text") return "uncached_input_tokens";
  if (meter.value === "cache_read_text") return "cached_input_tokens";
  if (meter.value === "cache_write_text") return "cache_write_tokens";
  if (meter.value === "output_text") return "output_tokens";
}

function usageField(signal: TokenSignal): string {
  if (signal === "cached_input_tokens") return "cache_read_input_tokens";
  if (signal === "cache_write_tokens") return "cache_creation_input_tokens";
  if (signal === "uncached_input_tokens") return "input_tokens";
  return "output_tokens";
}

function applyResourceTopology(input: AtomicProviderPricing, books: AtomicPricingBook[]): void {
  const booksByKey = new Map(books.map((book) => [book.book_key, book]));
  const offersByModel = modelOffers(books);
  for (const book of books) {
    if (book.scope.kind !== "provider_resource") continue;
    const key = book.scope.resource_key;
    if (["web-search", "web-fetch", "code-execution"].includes(key))
      bindEndpointService(book, offersByModel, booksByKey);
    else if (key === "managed-agents-runtime") bindManagedAgents(book, offersByModel);
    else if (key === "token-counting") bindTokenCounting(book, offersByModel);
    else if (key.startsWith("advisor:")) bindAdvisor(book, offersByModel, input);
    else if (key === "fallback-credit-token") bindFallbackCredit(book, offersByModel);
    else if (key.startsWith("priority-tier:")) closePriorityEnrollment(book, offersByModel);
    else if (key === "claude-platform-aws") bindAwsSettlement(book, offersByModel, booksByKey);
  }
}

interface ModelOffers {
  sync?: { offer: AtomicPricingOffer; ref: string };
  batch?: { offer: AtomicPricingOffer; ref: string };
}

function modelOffers(books: readonly AtomicPricingBook[]): Map<string, ModelOffers> {
  const result = new Map<string, ModelOffers>();
  for (const book of books) {
    if (book.scope.kind !== "models") continue;
    const bookId = pricingBookId("anthropic", book.book_key);
    for (const modelRef of book.scope.model_refs) {
      const current = result.get(modelRef) ?? {};
      for (const mechanism of ["sync", "batch"] as const) {
        const offer = book.offers.find(({ offer_key }) => offer_key === mechanism);
        if (offer !== undefined)
          current[mechanism] = {
            offer,
            ref: pricingOfferId(bookId, mechanism),
          };
      }
      result.set(modelRef, current);
    }
  }
  return result;
}

function bindEndpointService(
  book: AtomicPricingBook,
  offersByModel: ReadonlyMap<string, ModelOffers>,
  booksByKey: ReadonlyMap<string, AtomicPricingBook>,
): void {
  if (book.scope.kind !== "provider_resource") return;
  for (const offer of book.offers) {
    if (
      book.scope.resource_key === "code-execution" &&
      offer.offer_key === "organization-allowance"
    ) {
      bindCodeAllowance(book, offer);
      continue;
    }
    const mechanism = offer.offer_key.includes("batch") ? "batch" : "sync";
    const targets = serviceTargets(book, offersByModel, mechanism);
    if (targets.length > 0)
      offer.relations.push(relation(book, "requires", targets, "Exact model execution"));

    if (book.scope.resource_key === "web-search") {
      if (rawObservation(offer, "usage-signal") !== undefined) {
        bindRate(offer, "web_search", () => ({
          signal: { namespace: "kmodels", value: "successful_web_searches" },
          aggregation: mechanism === "batch" ? "result_item" : "request",
        }));
        offer.terms = offer.terms.filter(({ term_key }) => term_key !== "usage-signal");
      }
    } else if (
      book.scope.resource_key === "code-execution" &&
      offer.offer_key.startsWith("web-assisted")
    ) {
      const webOffers = ["service:web-search", "service:web-fetch"].flatMap((bookKey) => {
        const compatible = booksByKey.get(bookKey);
        if (compatible === undefined) return [];
        const compatibleId = pricingBookId("anthropic", compatible.book_key);
        return compatible.offers.flatMap((candidate) =>
          candidate.offer_key === mechanism
            ? [pricingOfferId(compatibleId, candidate.offer_key)]
            : [],
        );
      });
      if (webOffers.length > 0)
        offer.relations.push(
          relation(book, "requires", webOffers, "Included with a qualifying web tool"),
        );
    } else if (
      book.scope.resource_key === "code-execution" &&
      offer.offer_key === "managed-agents"
    ) {
      const runtime = booksByKey.get("service:managed-agents-runtime");
      const runtimeOffer = runtime?.offers.find(({ offer_key }) => offer_key === "runtime");
      if (runtime !== undefined && runtimeOffer !== undefined)
        offer.relations.push(
          relation(
            book,
            "requires",
            [pricingOfferId(pricingBookId("anthropic", runtime.book_key), runtimeOffer.offer_key)],
            "Included in Managed Agents runtime",
          ),
        );
    } else if (book.scope.resource_key === "code-execution") {
      const allowance = book.offers.find(({ offer_key }) => offer_key === "organization-allowance");
      if (allowance !== undefined) {
        const allowanceRef = pricingOfferId(
          pricingBookId("anthropic", book.book_key),
          allowance.offer_key,
        );
        offer.relations.push(
          relation(book, "requires", [allowanceRef], "Organization free-hours allowance"),
        );
      }
    }
  }
}

function bindRate(
  offer: AtomicPricingOffer,
  meter: Extract<PriceMeter, { namespace: "kmodels" }>["value"],
  binding: (variant: AtomicRateVariant) => Omit<ChargeBinding, "observations">,
): void {
  for (const term of offer.terms) {
    if (term.kind !== "rate" || term.meter.namespace !== "kmodels" || term.meter.value !== meter)
      continue;
    term.variants = term.variants.map((variant) => ({
      ...variant,
      charge_binding: {
        ...binding(variant),
        observations: [
          usageObservation(
            variant.observation,
            meter === "web_search"
              ? "openapi:usage.server_tool_use.web_search_requests"
              : "openapi:usage.active_seconds",
          ),
        ],
      },
    }));
  }
}

function bindCodeAllowance(book: AtomicPricingBook, offer: AtomicPricingOffer): void {
  const daily = rawObservation(offer, "daily-container-allowance");
  const observation = daily ?? rawObservation(offer, "monthly-container-allowance");
  const termKey = daily === undefined ? "monthly-container-allowance" : "daily-container-allowance";
  const fragment = observation?.raw["fragment"];
  const hours =
    typeof fragment === "string" ? fragment.match(/^([0-9]+(?:\.[0-9]+)?)/)?.[1] : undefined;
  const bookId = pricingBookId("anthropic", book.book_key);
  const rateRefs = book.offers.flatMap((candidate) => {
    if (!["sync", "batch"].includes(candidate.offer_key)) return [];
    const offerId = pricingOfferId(bookId, candidate.offer_key);
    return candidate.terms.flatMap((term) =>
      term.kind === "rate" &&
      term.meter.namespace === "kmodels" &&
      term.meter.value === "container_runtime"
        ? [pricingTermId(offerId, "rate", term.term_key)]
        : [],
    );
  });
  if (observation === undefined || hours === undefined || rateRefs.length === 0) return;
  const applicability = unconditionalApplicability;
  const allowance: AtomicAllowanceTerm = {
    term_key: termKey,
    kind: "allowance",
    variants: [
      {
        benefit: {
          kind: "quantity",
          quantity: {
            value: multiplyRationals(rationalFromDecimal(hours), {
              numerator: "3600",
              denominator: "1",
            }),
            unit: {
              factors: [{ unit: { namespace: "kmodels", value: "second" }, power: 1 }],
            },
          },
        },
        target: {
          kind: "rate_terms",
          term_refs: rateRefs,
        },
        reset: { namespace: "kmodels", value: daily === undefined ? "monthly" : "daily" },
        applicability,
        observation: {
          ...observation,
          establishes_applicability: applicability,
        },
      },
    ],
    raw_variants: [],
    source_refs: [observation.source_ref],
  };
  offer.terms = [...offer.terms.filter(({ term_key }) => term_key !== termKey), allowance];
}

function bindFallbackCredit(
  book: AtomicPricingBook,
  offersByModel: ReadonlyMap<string, ModelOffers>,
): void {
  if (book.scope.kind !== "provider_resource") return;
  const offer = book.offers.find(({ offer_key }) => offer_key === "redemption");
  if (offer === undefined) return;
  const observation = rawObservation(offer, "fallback-rate-substitution");
  if (observation === undefined) return;
  const variants: AtomicAllowanceTerm["variants"] = [];
  const targetOffers: string[] = [];
  for (const modelRef of book.scope.model_refs) {
    const target = offersByModel.get(modelRef)?.sync;
    if (target === undefined) continue;
    const write = target.offer.terms.find(
      (term) =>
        term.kind === "rate" &&
        term.meter.namespace === "kmodels" &&
        term.meter.value === "cache_write_text",
    );
    const read = target.offer.terms.find(
      (term) =>
        term.kind === "rate" &&
        term.meter.namespace === "kmodels" &&
        term.meter.value === "cache_read_text",
    );
    if (write === undefined || read === undefined) continue;
    const writeRef = pricingTermId(target.ref, "rate", write.term_key);
    const readRef = pricingTermId(target.ref, "rate", read.term_key);
    const applicability = withModel(unconditionalApplicability, modelRef);
    variants.push({
      benefit: {
        kind: "rate_substitution",
        replaced_term_refs: [writeRef],
        replacement_term_refs: [readRef],
      },
      target: { kind: "rate_terms", term_refs: [writeRef] },
      reset: { namespace: "kmodels", value: "none" },
      applicability,
      observation: {
        ...observation,
        establishes_applicability: applicability,
      },
    });
    targetOffers.push(target.ref);
  }
  if (variants.length === 0) return;
  offer.terms = [
    ...offer.terms.filter(({ term_key }) => term_key !== "fallback-rate-substitution"),
    {
      term_key: "fallback-rate-substitution",
      kind: "allowance",
      variants,
      raw_variants: [],
      source_refs: [observation.source_ref],
    },
  ];
  offer.relations.push(
    relation(book, "requires", [...new Set(targetOffers)], "Eligible fallback model inference"),
  );
}

function rawObservation(
  offer: AtomicPricingOffer,
  termKey: string,
): RawPriceObservation | undefined {
  const term = offer.terms.find(({ term_key }) => term_key === termKey);
  if (term === undefined) return;
  if (term.kind === "raw") return term.variants[0]?.observation;
  return term.raw_variants[0]?.observation;
}

function bindAdvisor(
  book: AtomicPricingBook,
  offersByModel: ReadonlyMap<string, ModelOffers>,
  input: AtomicProviderPricing,
): void {
  if (book.scope.kind !== "provider_resource") return;
  const advisorRef = book.scope.resource_key.slice("advisor:".length);
  for (const offer of book.offers) {
    const mechanism = offer.offer_key === "batch" ? "batch" : "sync";
    const executors = serviceTargets(book, offersByModel, mechanism);
    if (executors.length > 0)
      offer.relations.push(relation(book, "incurs", executors, "Executor model inference"));
    const advisor = offersByModel.get(advisorRef)?.[mechanism];
    if (advisor === undefined) continue;
    offer.relations.push(relation(book, "incurs", [advisor.ref], "Advisor model inference"));
    const variants: AtomicContributionTerm["variants"] = [];
    for (const term of advisor.offer.terms) {
      if (term.kind !== "rate") continue;
      const signal = tokenSignal(term.meter, term.variants[0]?.price.per ?? { factors: [] });
      if (signal === undefined) continue;
      const key = `advisor_${signal}`;
      addAtom(input, {
        kind: "usage_signal",
        key,
        definition: `${advisorRef} ${signal.replaceAll("_", " ")} reported in advisor_message iterations`,
        unit: { factors: [{ unit: { namespace: "kmodels", value: "token" }, power: 1 }] },
        resolution_phase: "outcome",
      });
      const applicability =
        signal === "cache_write_tokens"
          ? withCacheTtl(unconditionalApplicability, 300)
          : unconditionalApplicability;
      variants.push({
        target_rate_refs: [pricingTermId(advisor.ref, "rate", term.term_key)],
        applicability,
        charge_bindings: [
          {
            signal: { namespace: "provider", provider_id: "anthropic", value: key },
            aggregation: mechanism === "batch" ? "result_item" : "attempt",
            observations: [
              rawBookObservation(
                book,
                `openapi:usage.iterations[type=advisor_message][model=${advisorRef}].${usageField(signal)}`,
              ),
            ],
          },
        ],
        observation: normalizedBookObservation(
          book,
          applicability,
          `Advisor usage is billed at ${advisorRef} rates`,
        ),
      });
    }
    if (variants.length > 0)
      offer.terms = [
        ...offer.terms.filter(
          (term) => !(term.kind === "raw" && term.term_key === "advisor-model-usage"),
        ),
        {
          term_key: "advisor-model-usage",
          kind: "contribution",
          variants,
          raw_variants: [],
          source_refs: [...new Set(variants.map(({ observation }) => observation.source_ref))],
        },
      ];
  }
}

function bindManagedAgents(
  book: AtomicPricingBook,
  offersByModel: ReadonlyMap<string, ModelOffers>,
): void {
  if (book.scope.kind !== "provider_resource") return;
  for (const offer of book.offers) {
    if (rawObservation(offer, "runtime-signal") !== undefined)
      bindRate(offer, "session_runtime", () => ({
        signal: { namespace: "kmodels", value: "active_seconds" },
        aggregation: "session",
      }));
    if (rawObservation(offer, "model-usage") !== undefined) {
      for (const modelRef of book.scope.model_refs) {
        const target = offersByModel.get(modelRef)?.sync;
        if (target === undefined) continue;
        const applicability = withModel(unconditionalApplicability, modelRef);
        offer.relations.push({
          kind: "incurs",
          target: { kind: "offers", offer_refs: [target.ref] },
          applicability,
          observations: [
            {
              ...relationObservation(book, [target.ref], "Actual session model inference"),
              establishes_offer_refs: [target.ref],
            },
          ],
        });
      }
    }
    offer.terms = offer.terms.filter(
      ({ term_key }) => !["runtime-signal", "model-usage"].includes(term_key),
    );
  }
}

function bindTokenCounting(
  book: AtomicPricingBook,
  offersByModel: ReadonlyMap<string, ModelOffers>,
): void {
  const targets = serviceTargets(book, offersByModel, "sync");
  if (targets.length === 0) return;
  for (const offer of book.offers)
    offer.relations.push(relation(book, "compatible_with", targets, "Compatible model tokenizer"));
}

function closePriorityEnrollment(
  book: AtomicPricingBook,
  offersByModel: ReadonlyMap<string, ModelOffers>,
): void {
  const targets = serviceTargets(book, offersByModel, "sync");
  for (const offer of book.offers) {
    if (rawObservation(offer, "closed-enrollment") !== undefined) {
      const applicability = unconditionalApplicability;
      offer.enrollment = [
        {
          state: "closed_to_new",
          applicability,
          observations: [
            normalizedBookObservation(book, applicability, "Closed to new commitments"),
          ],
        },
      ];
      offer.terms = offer.terms.filter(({ term_key }) => term_key !== "closed-enrollment");
    }
    if (targets.length > 0)
      offer.relations.push(
        relation(book, "compatible_with", targets, "Exact model capacity commitment"),
      );
  }
}

function bindAwsSettlement(
  book: AtomicPricingBook,
  offersByModel: ReadonlyMap<string, ModelOffers>,
  booksByKey: ReadonlyMap<string, AtomicPricingBook>,
): void {
  const modelTargets = [
    ...new Set(
      book.scope.kind === "provider_resource"
        ? book.scope.model_refs.flatMap((modelRef) => {
            const offers = offersByModel.get(modelRef);
            return [offers?.sync?.ref, offers?.batch?.ref].filter(
              (value): value is string => value !== undefined,
            );
          })
        : [],
    ),
  ];
  const serviceTargets = ["service:web-search", "service:managed-agents-runtime"].flatMap(
    (bookKey) => {
      const target = booksByKey.get(bookKey);
      if (target === undefined) return [];
      const targetBookId = pricingBookId("anthropic", target.book_key);
      return target.offers.map(({ offer_key }) => pricingOfferId(targetBookId, offer_key));
    },
  );
  const targets = [...new Set([...modelTargets, ...serviceTargets])];
  for (const offer of book.offers) {
    if (targets.length > 0)
      offer.relations.push(
        relation(book, "compatible_with", targets, "Anthropic model and feature rates"),
      );
    const applicability = unconditionalApplicability;
    offer.settlement = [
      {
        channel: "marketplace",
        biller: "AWS Marketplace",
        payment_sources: ["postpaid_invoice", "marketplace_commitment"],
        applicability,
        observations: [
          normalizedBookObservation(book, applicability, "Hourly CCU marketplace metering"),
        ],
      },
    ];
  }
}

function serviceTargets(
  book: AtomicPricingBook,
  offersByModel: ReadonlyMap<string, ModelOffers>,
  mechanism: Mechanism,
): string[] {
  return book.scope.kind === "provider_resource"
    ? [
        ...new Set(
          book.scope.model_refs.flatMap((modelRef) => {
            const ref = offersByModel.get(modelRef)?.[mechanism]?.ref;
            return ref === undefined ? [] : [ref];
          }),
        ),
      ]
    : [];
}

function relation(
  book: AtomicPricingBook,
  kind: OfferRelation["kind"],
  targets: string[],
  label: string,
): OfferRelation {
  return {
    kind,
    target: { kind: "offers", offer_refs: targets },
    applicability: unconditionalApplicability,
    observations: [relationObservation(book, targets, label)],
  };
}

function exclusiveRelation(source: AtomicPricingOffer, targetRef: string): OfferRelation {
  const observation = offerObservation(source, "Synchronous and Batch mechanisms are alternatives");
  return {
    kind: "exclusive_with",
    target: { kind: "offers", offer_refs: [targetRef] },
    applicability: unconditionalApplicability,
    observations: [
      {
        ...observation,
        establishes_offer_refs: [targetRef],
        establishes_book_refs: [],
      },
    ],
  };
}

function relationObservation(book: AtomicPricingBook, targets: string[], label: string) {
  return {
    ...rawBookObservation(book, `topology:${label}`),
    raw: { label },
    establishes_offer_refs: targets,
    establishes_book_refs: [],
  };
}

function normalizedBookObservation(
  book: AtomicPricingBook,
  applicability: PriceApplicability,
  label: string,
) {
  return {
    ...rawBookObservation(book, `topology:${label}`),
    raw: { label },
    establishes_applicability: applicability,
  };
}

function rawBookObservation(book: AtomicPricingBook, locator: string): RawPriceObservation {
  const observation = book.scope_observations[0];
  if (observation === undefined) throw new Error(`Anthropic book ${book.book_key} has no evidence`);
  return {
    source_ref: observation.source_ref,
    locator: { kind: "provider_key", value: locator },
    raw: { fragment: locator },
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
  if (observation === undefined)
    throw new Error(`Anthropic offer ${offer.offer_key} has no evidence`);
  return { source_ref: observation.source_ref, locator: observation.locator, raw: { label } };
}

function usageObservation(
  observation: NormalizedPriceObservation,
  locator: string,
): RawPriceObservation {
  return {
    source_ref: observation.source_ref,
    locator: { kind: "provider_key", value: locator },
    raw: { fragment: locator },
  };
}

function normalizedObservation(
  observation: NormalizedPriceObservation,
  applicability: PriceApplicability,
): NormalizedPriceObservation {
  return { ...observation, establishes_applicability: applicability };
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

function withCacheTtl(applicability: PriceApplicability, seconds: number): PriceApplicability {
  const value = String(seconds);
  return canonicalizeApplicability({
    any_of: applicability.any_of.map(({ all_of }) => ({
      all_of: [
        ...all_of,
        {
          kind: "decimal_range" as const,
          dimension: { namespace: "kmodels" as const, value: "cache_ttl_seconds" as const },
          unit: {
            factors: [
              { unit: { namespace: "kmodels" as const, value: "second" as const }, power: 1 },
            ],
          },
          lower: { value, inclusive: true },
          upper: { value, inclusive: true },
        },
      ],
    })),
  });
}

function addAtom(input: AtomicProviderPricing, atom: ProviderAtomRegistryEntry): void {
  if (
    !input.vocabulary.atoms.some(
      (candidate) => candidate.kind === atom.kind && candidate.key === atom.key,
    )
  )
    input.vocabulary.atoms.push(atom);
}

function hasCommercialContent(offer: AtomicPricingOffer | undefined): offer is AtomicPricingOffer {
  return offer !== undefined && (offer.states.length > 0 || offer.terms.length > 0);
}

function isUnit(expression: UnitExpression, value: "token"): boolean {
  return (
    expression.factors.length === 1 &&
    expression.factors[0]?.power === 1 &&
    expression.factors[0].unit.namespace === "kmodels" &&
    expression.factors[0].unit.value === value
  );
}
