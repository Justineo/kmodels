import type { PriceApplicability } from "../catalog/pricing-schema.ts";
import type {
  CalculationBinding,
  CalculationBook,
  CalculationEnvelope,
  CalculationOffer,
  CalculationProvider,
  CalculationRateTerm,
  CalculationRaw,
  CalculationTerm,
  NormalizedVariant,
} from "./schema.ts";
import { PricingError } from "./errors.ts";
import { validatePriceData } from "./validation.ts";

export interface IndexedOffer {
  provider: CalculationProvider;
  book: CalculationBook;
  offer: CalculationOffer;
}

export interface PricingSnapshot {
  data: CalculationEnvelope;
  offers: ReadonlyMap<string, IndexedOffer>;
  rates: ReadonlyMap<string, CalculationRateTerm>;
}

export function createPricingSnapshot(priceData: unknown): PricingSnapshot {
  const data = freezeRecursively(validatePriceData(priceData));
  const offers = new Map<string, IndexedOffer>();
  const rates = new Map<string, CalculationRateTerm>();
  for (const provider of data.providers) {
    for (const book of provider.books) {
      for (const offer of book.offers) {
        offers.set(offer.id, { provider, book, offer });
        for (const term of offer.terms) {
          if (term.kind === "rate") rates.set(term.id, term);
        }
      }
    }
  }
  return { data, offers, rates };
}

export function getOffer(snapshot: PricingSnapshot, offerRef: string): IndexedOffer {
  const offer = snapshot.offers.get(offerRef);
  if (offer === undefined) {
    throw new PricingError("UNKNOWN_OFFER", "Offer is not present in this snapshot");
  }
  return offer;
}

export function offerApplicabilities(
  snapshot: PricingSnapshot,
  offer: CalculationOffer,
): PriceApplicability[] {
  const scopes = [
    ...offer.states.map((variant) => variant.applicability),
    ...offer.relations.map((relation) => relation.applicability),
  ];
  for (const term of offer.terms) {
    if (term.kind !== "raw") {
      scopes.push(...term.variants.map((variant) => variant.applicability));
    }
    for (const variant of rawTermVariants(term)) {
      if (variant.possible_scope !== undefined) scopes.push(variant.possible_scope);
    }
  }
  for (const term of offer.terms) {
    if (term.kind !== "contribution") continue;
    for (const variant of term.variants) {
      for (const rateRef of variant.target_rate_refs) {
        const rate = snapshot.rates.get(rateRef);
        if (rate !== undefined)
          scopes.push(...rate.variants.map((variant) => variant.applicability));
      }
    }
  }
  return scopes;
}

export function rawTermVariants(term: CalculationTerm): CalculationRaw[] {
  return term.kind === "raw" ? term.variants : term.raw_variants;
}

export function variantBindings(variant: NormalizedVariant): CalculationBinding[] {
  if ("charge_binding" in variant && variant.charge_binding !== undefined) {
    return [variant.charge_binding];
  }
  if ("charge_bindings" in variant) return variant.charge_bindings;
  return [];
}

export function termBindings(term: CalculationTerm): CalculationBinding[] {
  if (term.kind === "raw") return [];
  return term.variants.flatMap(variantBindings);
}

function freezeRecursively<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) freezeRecursively(child);
    Object.freeze(value);
  }
  return value;
}
