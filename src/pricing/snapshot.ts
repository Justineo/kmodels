import type { PriceApplicability } from "../catalog/pricing-schema.ts";
import type {
  PriceDataBook,
  PriceDataEnvelope,
  PriceDataOffer,
  PriceDataProvider,
  PriceDataRateTerm,
  PriceDataRaw,
  PriceDataSelection,
  PriceDataTerm,
  ResolvedPriceOffer,
  ResolvedPriceRaw,
  ResolvedPriceSelection,
  ResolvedPriceTerm,
} from "./schema.ts";
import { validatePriceData } from "./validation.ts";

export interface IndexedOffer {
  provider: PriceDataProvider;
  book: PriceDataBook;
  offer: PriceDataOffer;
}

export interface IndexedRate {
  provider: PriceDataProvider;
  term: PriceDataRateTerm;
}

export interface PricingSnapshot {
  data: PriceDataEnvelope;
  offers: ReadonlyMap<string, IndexedOffer>;
  rates: ReadonlyMap<string, IndexedRate>;
}

export function createPricingSnapshot(priceData: unknown): PricingSnapshot {
  return indexValidatedPriceData(validatePriceData(priceData));
}

/** Internal entry for readers that have already validated their complete partition. */
export function indexValidatedPriceData(validated: PriceDataEnvelope): PricingSnapshot {
  const data = freezeRecursively(validated);
  const offers = new Map<string, IndexedOffer>();
  const rates = new Map<string, IndexedRate>();
  for (const provider of data.providers) {
    for (const book of provider.books) {
      for (const offer of book.offers) {
        offers.set(offer.id, { provider, book, offer });
        for (const term of offer.terms) {
          if (term.kind === "rate") rates.set(term.id, { provider, term });
        }
      }
    }
  }
  return { data, offers, rates };
}

export function resolveApplicability(
  provider: PriceDataProvider,
  applicabilityId: number,
): PriceApplicability {
  const scope = provider.applicabilities[applicabilityId];
  if (scope === undefined) {
    throw new Error(`Missing applicability entry ${applicabilityId}`);
  }
  return scope;
}

export function resolveRawVariant(
  provider: PriceDataProvider,
  variant: PriceDataRaw,
): ResolvedPriceRaw {
  const { possible_scope_id, ...rest } = variant;
  return {
    ...rest,
    ...(possible_scope_id === undefined
      ? {}
      : { possible_scope: resolveApplicability(provider, possible_scope_id) }),
  };
}

export function resolveSelectionClaim(
  provider: PriceDataProvider,
  claim: PriceDataSelection,
): ResolvedPriceSelection {
  const { applicability_id, alternatives, ...rest } = claim;
  return {
    ...rest,
    applicability: resolveApplicability(provider, applicability_id),
    alternatives: alternatives.map(({ applicability_id: altId, ...alt }) => ({
      ...alt,
      applicability: resolveApplicability(provider, altId),
    })),
  };
}

export function resolveTerm(
  provider: PriceDataProvider,
  term: PriceDataTerm,
  variantIndexes?: readonly number[],
  rawVariantIndexes?: readonly number[],
): ResolvedPriceTerm {
  const pickRaw = (variants: readonly PriceDataRaw[]) =>
    (rawVariantIndexes === undefined
      ? variants
      : variants.filter((_, index) => rawVariantIndexes.includes(index))
    ).map((variant) => resolveRawVariant(provider, variant));
  if (term.kind === "raw") {
    return { ...term, variants: pickRaw(term.variants) };
  }
  const raw_variants = pickRaw(term.raw_variants);
  switch (term.kind) {
    case "rate":
      return {
        ...term,
        raw_variants,
        variants: (variantIndexes === undefined
          ? term.variants
          : term.variants.filter((_, index) => variantIndexes.includes(index))
        ).map(({ applicability_id, ...variant }) => ({
          ...variant,
          applicability: resolveApplicability(provider, applicability_id),
        })),
      };
    case "allowance":
      return {
        ...term,
        raw_variants,
        variants: (variantIndexes === undefined
          ? term.variants
          : term.variants.filter((_, index) => variantIndexes.includes(index))
        ).map(({ applicability_id, ...variant }) => ({
          ...variant,
          applicability: resolveApplicability(provider, applicability_id),
        })),
      };
    case "contribution":
      return {
        ...term,
        raw_variants,
        variants: (variantIndexes === undefined
          ? term.variants
          : term.variants.filter((_, index) => variantIndexes.includes(index))
        ).map(({ applicability_id, ...variant }) => ({
          ...variant,
          applicability: resolveApplicability(provider, applicability_id),
        })),
      };
  }
}

export function resolveOffer(
  provider: PriceDataProvider,
  offer: PriceDataOffer,
  stateIndexes: readonly number[],
  relationIndexes: readonly number[],
  terms: ResolvedPriceTerm[],
): ResolvedPriceOffer {
  const { selection, ...rest } = offer;
  return {
    ...rest,
    states: offer.states
      .filter((_, index) => stateIndexes.includes(index))
      .map(({ applicability_id, ...state }) => ({
        ...state,
        applicability: resolveApplicability(provider, applicability_id),
      })),
    ...(selection === undefined
      ? {}
      : {
          selection: selection.map((claim) => resolveSelectionClaim(provider, claim)),
        }),
    relations: offer.relations
      .filter((_, index) => relationIndexes.includes(index))
      .map(({ applicability_id, ...relation }) => ({
        ...relation,
        applicability: resolveApplicability(provider, applicability_id),
      })),
    terms,
  };
}

export function offerApplicabilities(
  snapshot: PricingSnapshot,
  owner: IndexedOffer,
): PriceApplicability[] {
  const { provider, offer } = owner;
  const resolve = (id: number) => resolveApplicability(provider, id);
  const scopes: PriceApplicability[] = [
    ...offer.states.map((variant) => resolve(variant.applicability_id)),
    ...offer.relations.map((relation) => resolve(relation.applicability_id)),
  ];
  for (const term of offer.terms) {
    if (term.kind !== "raw") {
      scopes.push(...term.variants.map((variant) => resolve(variant.applicability_id)));
    }
    for (const variant of rawTermVariants(term)) {
      if (variant.possible_scope_id !== undefined) scopes.push(resolve(variant.possible_scope_id));
    }
  }
  for (const term of offer.terms) {
    if (term.kind !== "contribution") continue;
    for (const variant of term.variants) {
      for (const rateRef of variant.target_rate_refs) {
        const rate = snapshot.rates.get(rateRef);
        if (rate !== undefined)
          scopes.push(
            ...rate.term.variants.map((v) =>
              resolveApplicability(rate.provider, v.applicability_id),
            ),
          );
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
