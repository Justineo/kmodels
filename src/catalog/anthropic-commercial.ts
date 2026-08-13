import type {
  AtomicAllowanceTerm,
  AtomicPricingBook,
  AtomicPricingOffer,
  AtomicPricingTerm,
  AtomicProviderPricing,
  AtomicRateVariant,
  AtomicRawVariant,
} from "./pricing-assembly.ts";
import { canonicalizeApplicability, unconditionalApplicability } from "./pricing-canonical.ts";
import { addAtom, isStandardUnit, withApplicability } from "./pricing-commercial-assembly.ts";
import { pricingBookId, pricingOfferId, pricingTermId } from "./pricing-identifiers.ts";
import { multiplyRationals, rationalFromDecimal } from "./pricing-rational.ts";
import type {
  ChargeBinding,
  NormalizedPriceObservation,
  PriceApplicability,
  PriceCondition,
  PriceMeter,
  RawPriceObservation,
  UnitExpression,
} from "./pricing-schema.ts";

type Mechanism = "sync" | "batch";
type TokenSignal = NonNullable<ReturnType<typeof tokenSignal>>;

const tokenUnit: UnitExpression = {
  factors: [{ unit: { namespace: "kmodels", value: "token" }, power: 1 }],
};
const admittedResources = new Set(["web-search", "code-execution"]);

export function applyAnthropicCommercialTopology(
  input: AtomicProviderPricing,
): AtomicProviderPricing {
  const books = input.books
    .filter(
      (book) =>
        book.scope.kind === "models" ||
        (book.scope.kind === "provider_resource" && admittedResources.has(book.scope.resource_key)),
    )
    .map((book) => (book.scope.kind === "models" ? splitModelBook(book, input) : book));
  for (const book of books) bindRequestService(book, input);
  return { ...input, books };
}

function splitModelBook(book: AtomicPricingBook, input: AtomicProviderPricing): AtomicPricingBook {
  const offers = book.offers.flatMap((offer) => {
    if (offer.offer_key !== "usage") return [offer];
    return [partitionOffer(offer, "sync", input), partitionOffer(offer, "batch", input)].filter(
      hasCommercialContent,
    );
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
            observation: withApplicability(state.observation, applicability),
          },
        ];
  });
  const terms = offer.terms.flatMap((term) => partitionTerm(term, mechanism, input));
  if (states.length === 0 && terms.length === 0) return;
  return {
    ...offer,
    offer_key: mechanism,
    name: mechanism === "batch" ? "Message Batches" : "Messages",
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
    const variants = term.variants.flatMap((variant) => partitionRaw(variant, mechanism));
    return variants.length === 0 ? [] : [{ ...term, variants }];
  }
  if (term.kind !== "rate") return mechanism === "sync" ? [term] : [];
  const variants = term.variants.flatMap((variant) => {
    const applicability = partitionApplicability(variant.applicability, mechanism);
    if (applicability === undefined) return [];
    const next = {
      ...variant,
      applicability,
      observation: withApplicability(variant.observation, applicability),
    };
    const charge_binding = modelBinding(term.meter, next, mechanism, input);
    return [{ ...next, ...(charge_binding === undefined ? {} : { charge_binding }) }];
  });
  const raw_variants = term.raw_variants.flatMap((variant) => partitionRaw(variant, mechanism));
  return variants.length + raw_variants.length === 0 ? [] : [{ ...term, variants, raw_variants }];
}

function partitionRaw(variant: AtomicRawVariant, mechanism: Mechanism): AtomicRawVariant[] {
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
    if ((mechanism === "batch") !== (tier !== undefined)) return [];
    return [{ all_of: tier === undefined ? all_of : all_of.filter((value) => value !== tier) }];
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
  const signal = modelSignal(meter, variant);
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
    observations: signal.locators.map((locator) => rawObservation(variant.observation, locator)),
  };
}

function modelSignal(
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
      key: `cache_write_${suffix}_input_tokens`,
      definition: `Billable ${suffix} cache-write input tokens for the selected model execution`,
      locators: [
        `openapi:usage.cache_creation.ephemeral_${suffix}_input_tokens`,
        `openapi:usage.iterations[*].cache_creation.ephemeral_${suffix}_input_tokens grouped by iterations[*].model`,
      ],
    };
  }
  const field = usageField(signal);
  return {
    key: signal,
    definition: `Billable ${signal.replaceAll("_", " ")} for the selected model; use top-level usage when iterations are absent, otherwise price each typed iteration by its model`,
    locators: [
      `openapi:usage.${field} when usage.iterations is absent`,
      `openapi:usage.iterations[*].${field} grouped by usage.iterations[*].model when iterations is present`,
    ],
  };
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
  if (meter.namespace !== "kmodels" || !isStandardUnit(unit, "token")) return;
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

function bindRequestService(book: AtomicPricingBook, input: AtomicProviderPricing): void {
  if (book.scope.kind !== "provider_resource") return;
  if (book.scope.resource_key === "web-search") {
    addAtom(input, {
      kind: "usage_signal",
      key: "successful_web_searches",
      definition: "Successful billable Anthropic server-side web searches",
      unit: { factors: [{ unit: { namespace: "kmodels", value: "event" }, power: 1 }] },
      resolution_phase: "outcome",
    });
    for (const offer of book.offers) {
      bindWebSearch(offer);
      offer.terms = offer.terms.filter(({ term_key }) => term_key !== "usage-signal");
    }
    return;
  }
  for (const offer of book.offers) bindCodeAllowance(book, offer);
}

function bindWebSearch(offer: AtomicPricingOffer): void {
  for (const term of offer.terms) {
    if (
      term.kind !== "rate" ||
      term.meter.namespace !== "kmodels" ||
      term.meter.value !== "web_search"
    )
      continue;
    term.variants = term.variants.map((variant) => ({
      ...variant,
      charge_binding: {
        signal: { namespace: "kmodels", value: "successful_web_searches" },
        aggregation: "request",
        observations: [
          rawObservation(variant.observation, "openapi:usage.server_tool_use.web_search_requests"),
        ],
      },
    }));
  }
}

function bindCodeAllowance(book: AtomicPricingBook, offer: AtomicPricingOffer): void {
  if (offer.offer_key !== "standalone") return;
  const raw = offer.terms.find(
    (term) => term.kind === "raw" && term.term_key === "monthly-container-allowance",
  );
  const observation = raw?.kind === "raw" ? raw.variants[0]?.observation : undefined;
  const fragment = observation?.raw["fragment"];
  const hours = typeof fragment === "string" ? fragment.match(/^([\d,]+) /)?.[1] : undefined;
  const offerId = pricingOfferId(pricingBookId("anthropic", book.book_key), offer.offer_key);
  const targets = offer.terms.flatMap((term) =>
    term.kind === "rate" &&
    term.meter.namespace === "kmodels" &&
    term.meter.value === "container_runtime"
      ? [pricingTermId(offerId, "rate", term.term_key)]
      : [],
  );
  if (observation === undefined || hours === undefined || targets.length === 0) return;
  const allowance: AtomicAllowanceTerm = {
    term_key: "monthly-container-allowance",
    kind: "allowance",
    variants: [
      {
        benefit: {
          kind: "quantity",
          quantity: {
            value: multiplyRationals(rationalFromDecimal(hours.replaceAll(",", "")), {
              numerator: "3600",
              denominator: "1",
            }),
            unit: { factors: [{ unit: { namespace: "kmodels", value: "second" }, power: 1 }] },
          },
        },
        target: { kind: "rate_terms", term_refs: targets },
        reset: { namespace: "kmodels", value: "monthly" },
        applicability: unconditionalApplicability,
        observation: { ...observation, establishes_applicability: unconditionalApplicability },
      },
    ],
    raw_variants: [],
    source_refs: [observation.source_ref],
  };
  offer.terms = [
    ...offer.terms.filter(({ term_key }) => term_key !== "monthly-container-allowance"),
    allowance,
  ];
}

function rawObservation(
  observation: NormalizedPriceObservation,
  locator: string,
): RawPriceObservation {
  return {
    source_ref: observation.source_ref,
    locator: { kind: "provider_key", value: locator },
    raw: { fragment: locator },
  };
}

function hasCommercialContent(offer: AtomicPricingOffer | undefined): offer is AtomicPricingOffer {
  return offer !== undefined && (offer.states.length > 0 || offer.terms.length > 0);
}
