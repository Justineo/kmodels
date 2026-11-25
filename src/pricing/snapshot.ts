import type { PriceApplicability } from "../catalog/pricing-schema.ts";
import { PricingError } from "./errors.ts";
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
  ResolvedPriceRateTerm,
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

function resolveRawVariant(provider: PriceDataProvider, variant: PriceDataRaw): ResolvedPriceRaw {
  const { possible_scope_id, ...rest } = variant;
  return {
    ...rest,
    ...(possible_scope_id === undefined
      ? {}
      : { possible_scope: resolveApplicability(provider, possible_scope_id) }),
  };
}

function resolveQualifiedVariants<T extends { applicability_id: number }>(
  provider: PriceDataProvider,
  variants: readonly T[],
  indexes?: readonly number[],
): Array<Omit<T, "applicability_id"> & { applicability: PriceApplicability }> {
  const selected =
    indexes === undefined ? variants : variants.filter((_, index) => indexes.includes(index));
  return selected.map(({ applicability_id, ...variant }) => ({
    ...variant,
    applicability: resolveApplicability(provider, applicability_id),
  }));
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
        variants: resolveQualifiedVariants(provider, term.variants, variantIndexes),
      };
    case "allowance":
      return {
        ...term,
        raw_variants,
        variants: resolveQualifiedVariants(provider, term.variants, variantIndexes),
      };
    case "contribution":
      return {
        ...term,
        raw_variants,
        variants: resolveQualifiedVariants(provider, term.variants, variantIndexes),
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
    states: resolveQualifiedVariants(provider, offer.states, stateIndexes),
    ...(selection === undefined
      ? {}
      : {
          selection: selection.map((claim) => resolveSelectionClaim(provider, claim)),
        }),
    relations: resolveQualifiedVariants(provider, offer.relations, relationIndexes),
    terms,
  };
}

export interface SelectedTermReference {
  readonly id: string;
  readonly variants?: readonly number[] | undefined;
  readonly raw_variants?: readonly number[] | undefined;
}

export function resolveCandidateOffer(
  snapshot: PricingSnapshot,
  owner: IndexedOffer,
  candidate: {
    readonly states: readonly number[];
    readonly relations: readonly number[];
    readonly terms: readonly SelectedTermReference[];
    readonly referenced_rates: readonly SelectedTermReference[];
  },
): { offer: ResolvedPriceOffer; referenced_rates: ResolvedPriceRateTerm[] } {
  const offer = resolveOffer(
    owner.provider,
    owner.offer,
    candidate.states,
    candidate.relations,
    owner.offer.terms.flatMap((term) => {
      const selected = candidate.terms.find(({ id }) => id === term.id);
      return selected === undefined
        ? []
        : [resolveTerm(owner.provider, term, selected.variants, selected.raw_variants)];
    }),
  );
  const referenced_rates = candidate.referenced_rates.flatMap((selected) => {
    const rate = snapshot.rates.get(selected.id);
    if (rate === undefined) throw new PricingError("INVALID_DATA", "Missing referenced price");
    const resolved = resolveTerm(
      rate.provider,
      rate.term,
      selected.variants,
      selected.raw_variants,
    );
    return resolved.kind === "rate" ? [resolved] : [];
  });
  return { offer, referenced_rates };
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
