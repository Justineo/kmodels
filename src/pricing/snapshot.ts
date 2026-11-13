import type { PriceApplicability } from "../catalog/pricing-schema.ts";
import type {
  PriceDataBook,
  PriceDataEnvelope,
  PriceDataOffer,
  PriceDataProvider,
  PriceDataRateTerm,
  PriceDataRaw,
  PriceDataTerm,
} from "./schema.ts";
import { validatePriceData } from "./validation.ts";

export interface IndexedOffer {
  provider: PriceDataProvider;
  book: PriceDataBook;
  offer: PriceDataOffer;
}

export interface PricingSnapshot {
  data: PriceDataEnvelope;
  offers: ReadonlyMap<string, IndexedOffer>;
  rates: ReadonlyMap<string, PriceDataRateTerm>;
}

export function createPricingSnapshot(priceData: unknown): PricingSnapshot {
  return indexValidatedPriceData(validatePriceData(priceData));
}

/** Internal entry for readers that have already validated their complete partition. */
export function indexValidatedPriceData(validated: PriceDataEnvelope): PricingSnapshot {
  const data = freezeRecursively(validated);
  const offers = new Map<string, IndexedOffer>();
  const rates = new Map<string, PriceDataRateTerm>();
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

export function offerApplicabilities(
  snapshot: PricingSnapshot,
  offer: PriceDataOffer,
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

export function rawTermVariants(term: PriceDataTerm): PriceDataRaw[] {
  return term.kind === "raw" ? term.variants : term.raw_variants;
}

function freezeRecursively<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) freezeRecursively(child);
    Object.freeze(value);
  }
  return value;
}
