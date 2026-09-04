import type {
  AtomicPricingBook,
  AtomicPricingTerm,
  AtomicProviderPricing,
  AtomicRateVariant,
  AtomicRawVariant,
} from "./pricing-assembly.ts";
import { rawEvidence, isStandardUnit } from "./pricing-commercial-assembly.ts";
import { applicabilityContainedIn } from "./pricing-canonical.ts";
import {
  includePricingInputSourceRefs,
  indexPricingInputs,
  pricingInputFacts,
  pricingInputObservation,
  usageInputSources,
  type PricingInputIndex,
} from "./pricing-input.ts";
import type {
  ChargeBinding,
  PriceApplicability,
  PriceSelectorSource,
  UsageSignal,
} from "./pricing-schema.ts";
import type { SourcePricingInputFact } from "./pricing-source.ts";

const nativePricingAuthorities = new Set([
  "featherless_native_price_over_huggingface_route_snapshot",
  "native_provider_price_over_huggingface_route_snapshot",
]);

export function applyHuggingFaceCommercialTopology(
  input: AtomicProviderPricing,
  pricingInputs: readonly SourcePricingInputFact[],
): AtomicProviderPricing {
  const inputIndex = indexPricingInputs(pricingInputs);
  return { ...input, books: input.books.flatMap((book) => modelBook(book, inputIndex)) };
}

function modelBook(book: AtomicPricingBook, inputIndex: PricingInputIndex): AtomicPricingBook[] {
  if (book.scope.kind !== "models") return [];
  const offers = book.offers.flatMap((offer) => {
    if (offer.offer_key !== "usage") return [];
    const states = [...offer.states];
    const terms = offer.terms.flatMap((term) => {
      if (term.kind === "raw" && term.term_key === "route_price_not_published") {
        const unresolved = term.variants.filter(
          (variant) => !nativeRoutePricingComplete(offer.terms, variant),
        );
        return unresolved.length === 0 ? [] : [{ ...term, variants: unresolved }];
      }
      if (term.kind === "raw" && term.term_key === "route_promotional_free") {
        const unresolved = term.variants.filter((variant) => {
          const { possible_scope } = variant;
          if (possible_scope === undefined) return true;
          states.push({
            state: "free",
            applicability: possible_scope,
            observation: {
              ...variant.observation,
              establishes_applicability: possible_scope,
            },
          });
          return false;
        });
        return unresolved.length === 0 ? [] : [{ ...term, variants: unresolved }];
      }
      return [bindTerm(term, inputIndex)];
    });
    return [
      {
        ...offer,
        offer_key: "routed-inference",
        name: "Routed inference",
        states,
        terms,
        enrollment: [],
        relations: [],
        settlement: [],
      },
    ];
  });
  return offers.length === 0
    ? []
    : [includePricingInputSourceRefs({ ...book, offers, resource_edges: [] })];
}

function nativeRoutePricingComplete(
  terms: readonly AtomicPricingTerm[],
  raw: AtomicRawVariant,
): boolean {
  const scope = raw.possible_scope;
  if (scope === undefined) return false;
  const rates = terms.filter((term) => term.kind === "rate");
  const covers = (meter: "input_text" | "output_text") =>
    rates.some(
      (term) =>
        term.meter.namespace === "kmodels" &&
        term.meter.value === meter &&
        term.variants.some((variant) => applicabilityContainedIn(scope, variant.applicability)),
    );
  return (
    covers("input_text") &&
    covers("output_text") &&
    rates.some((term) =>
      term.variants.some(
        (variant) =>
          variant.resolution_policy !== undefined &&
          nativePricingAuthorities.has(variant.resolution_policy) &&
          applicabilityContainedIn(scope, variant.applicability),
      ),
    )
  );
}

function bindTerm(term: AtomicPricingTerm, inputIndex: PricingInputIndex): AtomicPricingTerm {
  if (term.kind !== "rate" || term.meter.namespace !== "kmodels") return term;
  const direction =
    term.meter.value === "input_text"
      ? "input"
      : term.meter.value === "output_text"
        ? "output"
        : undefined;
  if (direction === undefined) return term;
  const signal = { namespace: "kmodels", value: `${direction}_tokens` } as const;
  return {
    ...term,
    variants: term.variants.map((variant) => {
      if (!isStandardUnit(variant.price.per, "token")) return variant;
      const selector_sources = routeSelectorSources(variant.applicability, inputIndex);
      return {
        ...variant,
        charge_binding: binding(direction, signal, variant, inputIndex),
        ...(selector_sources.length === 0 ? {} : { selector_sources }),
      };
    }),
  };
}

function binding(
  direction: "input" | "output",
  signal: UsageSignal,
  variant: AtomicRateVariant,
  inputIndex: PricingInputIndex,
): ChargeBinding {
  const facts = pricingInputFacts(inputIndex, [
    `chat.response.${direction === "input" ? "prompt" : "completion"}_tokens`,
    `chat.stream.${direction === "input" ? "prompt" : "completion"}_tokens`,
    `responses.response.${direction}_tokens`,
    `responses.stream.${direction}_tokens`,
  ]);
  return {
    signal,
    aggregation: "request",
    ...(facts.length === 0
      ? {}
      : { quantity_methods: [{ input_sources: usageInputSources(signal, facts) }] }),
    observations: [rawEvidence(variant.observation), ...facts.map(pricingInputObservation)],
  };
}

function routeSelectorSources(
  applicability: PriceApplicability,
  inputIndex: PricingInputIndex,
): PriceSelectorSource[] {
  const dimension = { namespace: "kmodels", value: "route_provider" } as const;
  const selectsRoute = applicability.any_of.some(({ all_of }) =>
    all_of.some(
      (condition) =>
        condition.kind === "categorical" &&
        condition.dimension.namespace === dimension.namespace &&
        condition.dimension.value === dimension.value,
    ),
  );
  if (!selectsRoute) return [];
  return pricingInputFacts(inputIndex, ["routing.pinned_provider"]).map((fact) => ({
    dimension,
    channel: fact.channel,
    locator: fact.locator,
    availability: fact.availability,
    observations: [pricingInputObservation(fact)],
  }));
}
