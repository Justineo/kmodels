import type {
  AtomicAllowanceTerm,
  AtomicPricingBook,
  AtomicPricingOffer,
  AtomicPricingTerm,
  AtomicProviderPricing,
  AtomicRateVariant,
  AtomicRawVariant,
} from "./pricing-assembly.ts";
import { canonicalJson } from "./canonical-json.ts";
import { compareUtf8 } from "./canonical-value.ts";
import { canonicalizeApplicability, unconditionalApplicability } from "./pricing-canonical.ts";
import {
  addAtom,
  isStandardUnit,
  rawEvidence,
  withApplicability,
} from "./pricing-commercial-assembly.ts";
import { pricingBookId, pricingOfferId, pricingTermId } from "./pricing-identifiers.ts";
import { multiplyRationals, rationalFromDecimal } from "./pricing-rational.ts";
import type {
  ChargeBinding,
  PriceApplicability,
  PriceCondition,
  PriceDimension,
  PriceMeter,
  PriceSelectorSource,
  RawPriceObservation,
  UnitExpression,
  UsageSignal,
} from "./pricing-schema.ts";
import {
  indexPricingInputs,
  pricingInputFacts,
  pricingInputObservation,
  usageInputSources,
  type PricingInputIndex,
} from "./pricing-input.ts";
import type { SourcePricingInputFact } from "./pricing-source.ts";

type Mechanism = "sync" | "batch";

const tokenUnit: UnitExpression = {
  factors: [{ unit: { namespace: "kmodels", value: "token" }, power: 1 }],
};
const secondUnit: UnitExpression = {
  factors: [{ unit: { namespace: "kmodels", value: "second" }, power: 1 }],
};
const admittedResources = new Set(["web-search", "code-execution"]);

export function applyAnthropicCommercialTopology(
  input: AtomicProviderPricing,
  pricingInputs: readonly SourcePricingInputFact[],
): AtomicProviderPricing {
  const inputIndex = indexPricingInputs(pricingInputs);
  const books = input.books
    .filter(
      (book) =>
        book.scope.kind === "models" ||
        (book.scope.kind === "provider_resource" && admittedResources.has(book.scope.resource_key)),
    )
    .map((book) => (book.scope.kind === "models" ? splitModelBook(book, input, inputIndex) : book));
  for (const book of books) bindRequestService(book, input, inputIndex);
  return { ...input, books };
}

function splitModelBook(
  book: AtomicPricingBook,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): AtomicPricingBook {
  const offers = book.offers.flatMap((offer) => {
    if (offer.offer_key !== "usage") return [offer];
    return [
      partitionOffer(offer, "sync", input, inputIndex),
      partitionOffer(offer, "batch", input, inputIndex),
    ].filter(hasCommercialContent);
  });
  return { ...book, offers };
}

function partitionOffer(
  offer: AtomicPricingOffer,
  mechanism: Mechanism,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
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
  const terms = offer.terms.flatMap((term) => partitionTerm(term, mechanism, input, inputIndex));
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
  inputIndex: PricingInputIndex,
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
    const charge_binding = modelBinding(term.meter, next, mechanism, input, inputIndex);
    const selector_sources = selectorSources(next.applicability, inputIndex);
    return [
      {
        ...next,
        ...(charge_binding === undefined ? {} : { charge_binding }),
        ...(selector_sources.length === 0 ? {} : { selector_sources }),
      },
    ];
  });
  const raw_variants = term.raw_variants.flatMap((variant) => partitionRaw(variant, mechanism));
  if (term.meter.namespace === "kmodels" && term.meter.value === "cache_write_text") {
    return partitionCacheWriteTerms(term, variants, raw_variants);
  }
  return variants.length + raw_variants.length === 0 ? [] : [{ ...term, variants, raw_variants }];
}

function partitionCacheWriteTerms(
  term: Extract<AtomicPricingTerm, { kind: "rate" }>,
  variants: AtomicRateVariant[],
  raw_variants: AtomicRawVariant[],
): AtomicPricingTerm[] {
  const ttlTerms: AtomicPricingTerm[] = [];
  for (const ttl of [300, 3600] as const) {
    const bucket = variants
      .filter((variant) => exactCacheTtl(variant.applicability) === ttl)
      .map(removeCacheTtlSelector);
    if (bucket.length > 0)
      ttlTerms.push({
        ...term,
        term_key: `${term.term_key}:${ttl === 300 ? "5m" : "1h"}`,
        variants: bucket,
        raw_variants: [],
      });
  }
  const remaining = variants.filter(
    (variant) => exactCacheTtl(variant.applicability) === undefined,
  );
  if (remaining.length + raw_variants.length > 0)
    ttlTerms.push({ ...term, variants: remaining, raw_variants });
  return ttlTerms;
}

function removeCacheTtlSelector(variant: AtomicRateVariant): AtomicRateVariant {
  const clauses = variant.applicability.any_of.map(({ all_of }) => ({
    all_of: all_of.filter(
      (condition) =>
        condition.dimension.namespace !== "kmodels" ||
        condition.dimension.value !== "cache_ttl_seconds",
    ),
  }));
  const applicability = canonicalizeApplicability({ any_of: clauses });
  return {
    ...variant,
    applicability,
    observation: withApplicability(variant.observation, applicability),
  };
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
  inputIndex: PricingInputIndex,
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
  const boundSignal = providerSignal(signal.key);
  const facts = pricingInputFacts(inputIndex, [`messages.usage.${signal.key}`]);
  return {
    signal: boundSignal,
    aggregation: mechanism === "batch" ? "result_item" : "attempt",
    ...(facts.length === 0
      ? {}
      : {
          quantity_methods: [{ input_sources: usageInputSources(boundSignal, facts) }],
        }),
    observations: sortCanonical(
      facts.length === 0
        ? [rawEvidence(variant.observation)]
        : [rawEvidence(variant.observation), ...facts.map(pricingInputObservation)],
    ),
  };
}

function selectorSources(
  applicability: PriceApplicability,
  inputIndex: PricingInputIndex,
): PriceSelectorSource[] {
  const dimensions = new Map<string, PriceDimension>();
  for (const { all_of } of applicability.any_of)
    for (const { dimension } of all_of) dimensions.set(canonicalJson(dimension), dimension);
  const sources: PriceSelectorSource[] = [];
  for (const dimension of dimensions.values()) {
    if (dimension.namespace !== "kmodels") continue;
    const key =
      dimension.value === "inference_geo"
        ? "messages.usage.selector.inference_geo"
        : dimension.value === "served_service_tier"
          ? "messages.usage.selector.served_service_tier"
          : undefined;
    if (key === undefined) continue;
    for (const fact of pricingInputFacts(inputIndex, [key]))
      sources.push({
        dimension,
        channel: fact.channel,
        locator: fact.locator,
        availability: fact.availability,
        observations: [pricingInputObservation(fact)],
      });
  }
  return sortCanonical(sources);
}

function modelSignal(
  meter: PriceMeter,
  variant: AtomicRateVariant,
): { key: string; definition: string } | undefined {
  const signal = tokenSignal(meter, variant.price.per);
  if (signal === undefined) return;
  if (signal === "cache_write_tokens") {
    const ttl = exactCacheTtl(variant.applicability);
    if (ttl === undefined) return;
    const suffix = ttl === 300 ? "5m" : "1h";
    return {
      key: `cache_write_${suffix}_input_tokens`,
      definition: `Billable ${suffix} cache-write input tokens for the selected model execution`,
    };
  }
  return {
    key: signal,
    definition: `Billable ${signal.replaceAll("_", " ")} for the selected model; use top-level usage when iterations are absent, otherwise price each typed iteration by its model`,
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

function bindRequestService(
  book: AtomicPricingBook,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): void {
  if (book.scope.kind !== "provider_resource") return;
  if (book.scope.resource_key === "web-search") {
    for (const offer of book.offers) {
      const facts = pricingInputFacts(inputIndex, ["messages.usage.successful_web_searches"]);
      if (facts.length > 0) bindWebSearch(offer, facts, input);
    }
    return;
  }
  for (const offer of book.offers) {
    bindCodeRate(offer, input);
    bindCodeAllowance(book, offer);
  }
}

function bindWebSearch(
  offer: AtomicPricingOffer,
  facts: readonly SourcePricingInputFact[],
  input: AtomicProviderPricing,
): void {
  const signal = providerSignal("successful_web_searches");
  for (const term of offer.terms) {
    if (
      term.kind !== "rate" ||
      term.meter.namespace !== "kmodels" ||
      term.meter.value !== "web_search"
    )
      continue;
    addAtom(input, {
      kind: "usage_signal",
      key: "successful_web_searches",
      definition: "Successful billable Anthropic server-side web searches",
      unit: { factors: [{ unit: { namespace: "kmodels", value: "event" }, power: 1 }] },
      resolution_phase: "outcome",
    });
    term.variants = term.variants.map((variant) => ({
      ...variant,
      charge_binding: {
        signal,
        aggregation: "request",
        quantity_methods: [
          {
            input_sources: usageInputSources(signal, facts),
          },
        ],
        observations: sortCanonical([
          rawEvidence(variant.observation),
          ...facts.map(pricingInputObservation),
        ]),
      },
    }));
  }
}

function bindCodeRate(offer: AtomicPricingOffer, input: AtomicProviderPricing): void {
  if (offer.offer_key !== "standalone") return;
  const minimum = rawTermObservation(offer, "minimum-runtime");
  const runtime = rawTermObservation(offer, "runtime-observation");
  const minutes = minimum?.raw.fragment?.match(/^(\d+)-minute minimum execution time$/)?.[1];
  if (minimum === undefined || runtime === undefined || minutes === undefined) return;

  const rates = offer.terms.filter(isContainerRate);
  if (rates.length === 0) return;

  addAtom(input, {
    kind: "usage_signal",
    key: "code_execution_active_seconds",
    definition:
      "Standalone Code Execution duration tracked by Anthropic accounting but not reported by Messages usage",
    unit: secondUnit,
    resolution_phase: "account",
  });
  addAtom(input, {
    kind: "usage_signal",
    key: "code_execution_billable_seconds",
    definition: "Standalone Code Execution duration after the published per-container minimum",
    unit: secondUnit,
    resolution_phase: "account",
  });
  addAtom(input, {
    kind: "aggregation",
    key: "code_execution_container",
    definition: "One independently billed standalone Code Execution container",
  });

  const active = providerSignal("code_execution_active_seconds");
  const billable = providerSignal("code_execution_billable_seconds");
  const minimumSeconds = multiplyRationals(rationalFromDecimal(minutes), {
    numerator: "60",
    denominator: "1",
  });
  for (const term of rates) {
    term.variants = term.variants.map((variant) => ({
      ...variant,
      charge_binding: {
        signal: billable,
        aggregation: {
          namespace: "provider",
          provider_id: "anthropic",
          value: "code_execution_container",
        },
        quantity_methods: [
          {
            calculation: {
              nodes: [
                { op: "signal", signal: active },
                { op: "minimum", input: 0, value: minimumSeconds },
              ],
              result: 1,
            },
          },
        ],
        observations: [rawEvidence(variant.observation), minimum, runtime],
      },
    }));
  }
  offer.terms = offer.terms.filter(
    ({ term_key }) => !["minimum-runtime", "runtime-observation"].includes(term_key),
  );
}

function bindCodeAllowance(book: AtomicPricingBook, offer: AtomicPricingOffer): void {
  if (offer.offer_key !== "standalone") return;
  const observation = rawTermObservation(offer, "monthly-container-allowance");
  const fragment = observation?.raw["fragment"];
  const hours = typeof fragment === "string" ? fragment.match(/^([\d,]+) /)?.[1] : undefined;
  const offerId = pricingOfferId(pricingBookId("anthropic", book.book_key), offer.offer_key);
  const targets = offer.terms.flatMap((term) =>
    isContainerRate(term) ? [pricingTermId(offerId, "rate", term.term_key)] : [],
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
            unit: secondUnit,
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

function rawTermObservation(
  offer: AtomicPricingOffer,
  termKey: string,
): RawPriceObservation | undefined {
  const term = offer.terms.find(
    (candidate) => candidate.kind === "raw" && candidate.term_key === termKey,
  );
  return term?.kind === "raw" ? term.variants[0]?.observation : undefined;
}

function isContainerRate(
  term: AtomicPricingTerm,
): term is Extract<AtomicPricingTerm, { kind: "rate" }> {
  return (
    term.kind === "rate" &&
    term.meter.namespace === "kmodels" &&
    term.meter.value === "container_runtime"
  );
}

function providerSignal(value: string): Extract<UsageSignal, { namespace: "provider" }> {
  return { namespace: "provider", provider_id: "anthropic", value };
}

function sortCanonical<T>(values: T[]): T[] {
  return values.sort((left, right) => compareUtf8(canonicalJson(left), canonicalJson(right)));
}

function hasCommercialContent(offer: AtomicPricingOffer | undefined): offer is AtomicPricingOffer {
  return offer !== undefined && (offer.states.length > 0 || offer.terms.length > 0);
}
