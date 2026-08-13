import type {
  AtomicPricingBook,
  AtomicPricingTerm,
  AtomicProviderPricing,
} from "./pricing-assembly.ts";
import { canonicalizeApplicability } from "./pricing-canonical.ts";
import { isStandardUnit, withApplicability } from "./pricing-commercial-assembly.ts";
import type {
  ChargeBinding,
  NormalizedPriceObservation,
  PriceApplicability,
  PriceCondition,
  PriceMeter,
  RawPriceObservation,
  UnitExpression,
} from "./pricing-schema.ts";

export function applyDatabricksCommercialTopology(
  input: AtomicProviderPricing,
): AtomicProviderPricing {
  return { ...input, books: input.books.flatMap(modelBook) };
}

function modelBook(book: AtomicPricingBook): AtomicPricingBook[] {
  if (book.scope.kind !== "models") return [];
  const offers = book.offers.flatMap((offer) => {
    if (offer.offer_key !== "usage") return [];
    const states = offer.states.flatMap((state) => {
      const applicability = inferenceApplicability(state.applicability);
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
    const terms = offer.terms.flatMap(inferenceTerm);
    if (states.length + terms.length === 0) return [];
    return [
      {
        ...offer,
        offer_key: "pay-per-token",
        name: "Pay-per-token inference",
        states,
        terms,
        relations: [],
      },
    ];
  });
  return offers.length === 0 ? [] : [{ ...book, offers }];
}

function inferenceTerm(term: AtomicPricingTerm): AtomicPricingTerm[] {
  if (term.kind === "raw") {
    if (term.term_key === "batch_inference") return [];
    const variants = term.variants.flatMap((variant) => {
      if (variant.possible_scope === undefined) return [variant];
      const possible_scope = inferenceApplicability(variant.possible_scope);
      return possible_scope === undefined ? [] : [{ ...variant, possible_scope }];
    });
    return variants.length === 0 ? [] : [{ ...term, variants }];
  }
  if (term.kind !== "rate") return [];
  const variants = term.variants.flatMap((variant) => {
    const applicability = inferenceApplicability(variant.applicability);
    if (applicability === undefined) return [];
    const observation = withApplicability(variant.observation, applicability);
    const charge_binding = tokenBinding(term.meter, variant.price.per, observation);
    return [
      {
        ...variant,
        applicability,
        observation,
        ...(charge_binding === undefined ? {} : { charge_binding }),
      },
    ];
  });
  const raw_variants = term.raw_variants.flatMap((variant) => {
    if (variant.possible_scope === undefined) return [variant];
    const possible_scope = inferenceApplicability(variant.possible_scope);
    return possible_scope === undefined ? [] : [{ ...variant, possible_scope }];
  });
  return variants.length + raw_variants.length === 0 ? [] : [{ ...term, variants, raw_variants }];
}

function inferenceApplicability(applicability: PriceApplicability): PriceApplicability | undefined {
  const any_of = applicability.any_of.flatMap(({ all_of }) => {
    const tiers = all_of.filter(isServiceTier);
    if (tiers.some((condition) => categoricalValue(condition) === "batch")) return [];
    return [{ all_of }];
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

function categoricalValue(condition: PriceCondition): string | undefined {
  return condition.kind === "categorical" && condition.values.length === 1
    ? condition.values[0]?.value
    : undefined;
}

function tokenBinding(
  meter: PriceMeter,
  unit: UnitExpression,
  observation: NormalizedPriceObservation,
): ChargeBinding | undefined {
  if (!isStandardUnit(unit, "token") || meter.namespace !== "kmodels") return;
  const signal =
    meter.value === "input_text"
      ? "uncached_input_tokens"
      : meter.value === "embedding"
        ? "input_tokens"
        : meter.value === "cache_read_text"
          ? "cached_input_tokens"
          : meter.value === "cache_write_text"
            ? "cache_write_tokens"
            : meter.value === "output_text"
              ? "output_tokens"
              : undefined;
  if (signal === undefined) return;
  const field =
    signal === "uncached_input_tokens" || signal === "input_tokens"
      ? "input_tokens"
      : signal === "cached_input_tokens"
        ? "token_details.cache_read_input_tokens"
        : signal === "cache_write_tokens"
          ? "token_details.cache_creation_input_tokens"
          : "output_tokens";
  return {
    signal: { namespace: "kmodels", value: signal },
    aggregation: "attempt",
    observations: [usageObservation(observation, `response:usage.${field}`)],
  };
}

function usageObservation(observation: RawPriceObservation, value: string): RawPriceObservation {
  return {
    source_ref: observation.source_ref,
    locator: { kind: "meter", value },
    raw: observation.raw,
  };
}
