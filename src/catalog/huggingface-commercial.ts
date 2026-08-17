import type {
  AtomicPricingBook,
  AtomicPricingTerm,
  AtomicProviderPricing,
  AtomicRateVariant,
  AtomicRawVariant,
} from "./pricing-assembly.ts";
import { rawEvidence } from "./pricing-commercial-assembly.ts";
import { applicabilityContainedIn } from "./pricing-canonical.ts";
import type { ChargeBinding } from "./pricing-schema.ts";

const featherlessAuthority = "featherless_native_price_over_huggingface_route_snapshot";
const nativeProviderAuthority = "native_provider_price_over_huggingface_route_snapshot";

export function applyHuggingFaceCommercialTopology(
  input: AtomicProviderPricing,
): AtomicProviderPricing {
  return { ...input, books: input.books.flatMap(modelBook) };
}

function modelBook(book: AtomicPricingBook): AtomicPricingBook[] {
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
      return [bindTerm(term)];
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
  return offers.length === 0 ? [] : [{ ...book, offers, resource_edges: [] }];
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
    rates.some(
      (term) =>
        term.variants.some(
          (variant) =>
            variant.resolution_policy === featherlessAuthority &&
            applicabilityContainedIn(scope, variant.applicability),
        ) ||
        term.variants.some(
          (variant) =>
            variant.resolution_policy === nativeProviderAuthority &&
            applicabilityContainedIn(scope, variant.applicability),
        ),
    )
  );
}

function bindTerm(term: AtomicPricingTerm): AtomicPricingTerm {
  if (term.kind !== "rate" || term.meter.namespace !== "kmodels") return term;
  const signal =
    term.meter.value === "input_text"
      ? "input_tokens"
      : term.meter.value === "output_text"
        ? "output_tokens"
        : undefined;
  if (signal === undefined) return term;
  return {
    ...term,
    variants: term.variants.map((variant) => ({
      ...variant,
      charge_binding: binding(signal, variant),
    })),
  };
}

function binding(
  signal: "input_tokens" | "output_tokens",
  variant: AtomicRateVariant,
): ChargeBinding {
  return {
    signal: { namespace: "kmodels", value: signal },
    aggregation: "request",
    observations: [
      {
        ...rawEvidence(variant.observation),
        locator: {
          kind: "provider_key",
          value:
            signal === "input_tokens"
              ? "response:usage.prompt_tokens"
              : "response:usage.completion_tokens",
        },
      },
    ],
  };
}
