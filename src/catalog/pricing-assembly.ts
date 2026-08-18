import { canonicalJson, canonicalJsonBytes } from "./canonical-json.ts";
import { compareUtf8, compareUtf8Sequences } from "./canonical-value.ts";
import {
  applicabilitiesOverlap,
  applicabilityContainedIn,
  canonicalizeApplicability,
  unionApplicabilities,
} from "./pricing-canonical.ts";
import { pricingLimits } from "./pricing-constants.ts";
import { pricingBookId, pricingOfferId, pricingTermId } from "./pricing-identifiers.ts";
import {
  type BillingMode,
  type ChargeBinding,
  type ModelPricingDisposition,
  type NormalizedPriceObservation,
  type PriceAllowanceBenefit,
  type PriceAllowanceTarget,
  type PriceAllowanceVariant,
  type PriceContributionVariant,
  type PriceApplicability,
  type OfferRelation,
  type PriceMeter,
  type PriceRateVariant,
  type PriceScopeObservation,
  type PriceStateVariant,
  type PricingBook,
  type PricingOffer,
  type PricingScope,
  type PricingTerm,
  type ProviderPricingSnapshot,
  type ProviderPricingVocabulary,
  type PublishedValidity,
  type RawPriceObservation,
  type RawPricingVariant,
  type UnitPrice,
  type AllowanceReset,
  type PriceDispositionObservation,
} from "./pricing-schema.ts";
import { publishedValiditiesOverlap } from "./pricing-time.ts";

export interface AtomicProviderPricing {
  provider_id: string;
  observed_at: string;
  vocabulary: ProviderPricingVocabulary;
  dispositions: AtomicModelDisposition[];
  books: AtomicPricingBook[];
}

export interface AtomicModelDisposition {
  model_ref: string;
  observation: PriceDispositionObservation;
}

export interface AtomicPricingBook {
  book_key: string;
  name?: string;
  scope: PricingScope;
  scope_observations: PriceScopeObservation[];
  resource_edges?: PricingBook["resource_edges"];
  offers: AtomicPricingOffer[];
  source_refs: string[];
}

export interface AtomicPricingOffer {
  offer_key: string;
  name?: string;
  model_refs?: string[];
  billing_mode: BillingMode;
  states: AtomicPriceState[];
  enrollment?: PricingOffer["enrollment"];
  terms: AtomicPricingTerm[];
  relations: AtomicOfferRelation[];
  settlement?: PricingOffer["settlement"];
  source_refs: string[];
}

export type AtomicOfferRelation = OfferRelation;

export type AtomicPricingTerm =
  | AtomicRateTerm
  | AtomicAllowanceTerm
  | AtomicContributionTerm
  | AtomicRawTerm;

interface AtomicTermBase {
  term_key: string;
  source_refs: string[];
}

export interface AtomicRateTerm extends AtomicTermBase {
  kind: "rate";
  meter: PriceMeter;
  variants: AtomicRateVariant[];
  raw_variants: AtomicRawVariant[];
}

export interface AtomicAllowanceTerm extends AtomicTermBase {
  kind: "allowance";
  variants: AtomicAllowanceVariant[];
  raw_variants: AtomicRawVariant[];
}

export interface AtomicContributionTerm extends AtomicTermBase {
  kind: "contribution";
  variants: AtomicContributionVariant[];
  raw_variants: AtomicRawVariant[];
}

export interface AtomicRawTerm extends AtomicTermBase {
  kind: "raw";
  variants: AtomicRawVariant[];
}

export interface AtomicPriceState {
  state: PriceStateVariant["state"];
  applicability: PriceApplicability;
  validity?: PublishedValidity;
  observation: NormalizedPriceObservation;
}

export interface AtomicRateVariant {
  price: UnitPrice;
  applicability: PriceApplicability;
  resolution_policy?: string;
  validity?: PublishedValidity;
  charge_binding?: ChargeBinding;
  observation: NormalizedPriceObservation;
}

export interface AtomicAllowanceVariant {
  benefit: PriceAllowanceBenefit;
  target: PriceAllowanceTarget;
  reset: AllowanceReset;
  applicability: PriceApplicability;
  validity?: PublishedValidity;
  observation: NormalizedPriceObservation;
}

export interface AtomicContributionVariant {
  target_rate_refs: string[];
  applicability: PriceApplicability;
  validity?: PublishedValidity;
  charge_bindings: ChargeBinding[];
  observation: NormalizedPriceObservation;
}

export interface AtomicRawVariant {
  impact: RawPricingVariant["impact"];
  reason: RawPricingVariant["reason"];
  resolution_policy?: string;
  possible_scope?: PriceApplicability;
  validity?: PublishedValidity;
  observation: RawPriceObservation;
}

export interface ProviderPricingPartition {
  vocabulary: ProviderPricingVocabulary;
  snapshot: ProviderPricingSnapshot;
  model_dispositions: ModelPricingDisposition[];
  books: PricingBook[];
}

export function assembleProviderPricing(input: AtomicProviderPricing): ProviderPricingPartition {
  if (input.vocabulary.provider_id !== input.provider_id)
    throw new Error("Provider vocabulary ownership mismatch");
  rejectReservedAdapterOutput(input);
  const prepared = prepareProvider(input);
  assertPrecompactionLimit(prepared);
  const books = finalizeProviderTerms(prepared.books.map(assembleBook));
  return {
    vocabulary: sortVocabulary(input.vocabulary),
    snapshot: {
      provider_id: input.provider_id,
      observed_at: input.observed_at,
      publication: "fresh",
    },
    model_dispositions: assembleDispositions(input.dispositions),
    books: books.sort((left, right) => compareUtf8(left.id, right.id)),
  };
}

interface PreparedProvider {
  input: AtomicProviderPricing;
  books: PreparedBook[];
}

interface PreparedBook {
  input: AtomicPricingBook;
  id: string;
  providerId: string;
  offers: PreparedOffer[];
}

interface PreparedOffer {
  input: AtomicPricingOffer;
  id: string;
  bookId: string;
  terms: PreparedTerm[];
}

interface PreparedTerm {
  input: AtomicPricingTerm;
  id: string;
  offerId: string;
}

function prepareProvider(input: AtomicProviderPricing): PreparedProvider {
  return {
    input,
    books: input.books.map((book) => {
      const id = pricingBookId(input.provider_id, book.book_key);
      return {
        input: book,
        id,
        providerId: input.provider_id,
        offers: book.offers.map((offer) => {
          const offerId = pricingOfferId(id, offer.offer_key);
          return {
            input: offer,
            id: offerId,
            bookId: id,
            terms: offer.terms.map((term) => ({
              input: term,
              id: pricingTermId(offerId, term.kind, term.term_key),
              offerId,
            })),
          };
        }),
      };
    }),
  };
}

function assembleBook(prepared: PreparedBook): PricingBook {
  const { input } = prepared;
  return {
    id: prepared.id,
    provider_id: prepared.providerId,
    book_key: input.book_key,
    ...optional("name", input.name),
    scope: canonicalScope(input.scope),
    scope_observations: sortUnique(
      input.scope_observations.map((observation) => ({
        ...observation,
        establishes: canonicalScope(observation.establishes),
      })),
      scopeObservationKey,
    ),
    resource_edges: sortByCanonicalKey(input.resource_edges ?? [], (edge) => edge),
    offers: prepared.offers
      .map((offer) => assembleOffer(offer, input.scope.model_refs))
      .sort((left, right) => compareUtf8(left.id, right.id)),
    source_refs: sortUniqueStrings(input.source_refs),
  };
}

function assembleOffer(prepared: PreparedOffer, bookModelRefs: readonly string[]): PricingOffer {
  const { input } = prepared;
  const stateResult = assembleStates(input.states);
  let states = stateResult.states;
  let terms = prepared.terms.map(assembleTerm);
  if (stateResult.fallbackReason !== undefined) {
    ({ states, terms } = applyBaseFallback(
      states,
      terms,
      input.states,
      stateResult.fallbackReason,
      prepared.id,
    ));
  } else if (hasBaseConflict(states, terms)) {
    ({ states, terms } = applyBaseFallback(
      states,
      terms,
      input.states,
      "conflicting_values",
      prepared.id,
    ));
  } else {
    terms = applyRateContainment(states, terms);
  }

  const modelRefs =
    input.model_refs === undefined ? undefined : sortUniqueStrings(input.model_refs);
  const base = {
    id: prepared.id,
    offer_key: input.offer_key,
    ...optional("name", input.name),
    ...optional(
      "model_refs",
      modelRefs !== undefined &&
        compareUtf8Sequences(modelRefs, sortUniqueStrings([...bookModelRefs])) === 0
        ? undefined
        : modelRefs,
    ),
    billing_mode: input.billing_mode,
    states: sortStates(states),
    enrollment: sortByCanonicalKey(input.enrollment ?? [], (variant) => variant),
    terms,
    relations: input.relations.map(canonicalRelation).sort(compareRelations),
    settlement: sortByCanonicalKey(input.settlement ?? [], (variant) => variant),
    source_refs: sortUniqueStrings(input.source_refs),
  };
  return base;
}

function compareRelations(left: OfferRelation, right: OfferRelation): number {
  return compareUtf8Sequences(relationKey(left), relationKey(right));
}

function relationKey(relation: OfferRelation): string[] {
  return [
    relation.kind,
    canonicalJson(relation.target),
    ...optionalValue(relation.validity).map(canonicalJson),
    canonicalJson(relation.applicability),
  ];
}

function assembleStates(states: AtomicPriceState[]): {
  states: PriceStateVariant[];
  fallbackReason?: "selector_limit";
} {
  const grouped = new Map<string, AtomicPriceState[]>();
  for (const state of states) {
    const normalized = normalizeAtomicApplicability(state);
    if (normalized === undefined) return { states: [], fallbackReason: "selector_limit" };
    const item = { ...state, ...normalized };
    append(grouped, canonicalJson([item.state, ...optionalValue(item.validity)]), item);
  }
  const result: PriceStateVariant[] = [];
  for (const group of grouped.values()) {
    const first = group[0]!;
    const chunks = groupedApplicabilityChunks(group);
    if (chunks === undefined) return { states: [], fallbackReason: "selector_limit" };
    for (const { applicability, observations } of chunks)
      result.push({
        state: first.state,
        applicability,
        ...optional("validity", first.validity),
        observations,
      });
  }
  return { states: result };
}

function assembleTerm(prepared: PreparedTerm): PricingTerm {
  const { input } = prepared;
  const base = {
    id: prepared.id,
    term_key: input.term_key,
    source_refs: sortUniqueStrings(input.source_refs),
  };
  if (input.kind === "rate") {
    const { variants, raw } = assembleRateVariants(input.variants);
    return {
      ...base,
      kind: "rate",
      meter: input.meter,
      variants,
      raw_variants: groupRaw([...input.raw_variants, ...raw]),
    };
  }
  if (input.kind === "allowance") {
    const { variants, raw } = assembleAllowanceVariants(input.variants);
    return {
      ...base,
      kind: "allowance",
      variants,
      raw_variants: groupRaw([...input.raw_variants, ...raw]),
    };
  }
  if (input.kind === "contribution") {
    const { variants, raw } = assembleContributionVariants(input.variants);
    return {
      ...base,
      kind: "contribution",
      variants,
      raw_variants: groupRaw([...input.raw_variants, ...raw]),
    };
  }
  return {
    ...base,
    kind: "raw",
    variants: groupRaw(input.variants),
  };
}

function assembleContributionVariants(variants: AtomicContributionVariant[]): {
  variants: PriceContributionVariant[];
  raw: AtomicRawVariant[];
} {
  const grouped = new Map<string, AtomicContributionVariant[]>();
  const raw: AtomicRawVariant[] = [];
  for (const variant of variants) {
    const normalized = normalizeAtomicApplicability(variant);
    if (normalized === undefined) {
      raw.push(toRawAtomic(variant, "base_price", "selector_limit"));
      continue;
    }
    const item = {
      ...variant,
      target_rate_refs: sortUniqueStrings(variant.target_rate_refs),
      charge_bindings: sortByCanonicalKey(variant.charge_bindings, (binding) => binding),
      ...normalized,
    };
    append(
      grouped,
      canonicalJson([item.target_rate_refs, item.charge_bindings, ...optionalValue(item.validity)]),
      item,
    );
  }
  const result: PriceContributionVariant[] = [];
  for (const group of grouped.values()) {
    const first = group[0]!;
    const chunks = groupedApplicabilityChunks(group);
    if (chunks === undefined) {
      raw.push(
        ...group.map((variant) =>
          toRawAtomic(variant, "base_price", "selector_limit", variant.applicability),
        ),
      );
      continue;
    }
    for (const { applicability, observations } of chunks)
      result.push({
        target_rate_refs: first.target_rate_refs,
        applicability,
        ...optional("validity", first.validity),
        charge_bindings: first.charge_bindings,
        observations,
      });
  }
  return { variants: result, raw };
}

function assembleRateVariants(variants: AtomicRateVariant[]): {
  variants: PriceRateVariant[];
  raw: AtomicRawVariant[];
} {
  const grouped = new Map<string, AtomicRateVariant[]>();
  const raw: AtomicRawVariant[] = [];
  const normalizedVariants: AtomicRateVariant[] = [];
  for (const variant of variants) {
    const normalized = normalizeAtomicApplicability(variant);
    if (normalized === undefined) {
      raw.push(toRawAtomic(variant, "base_price", "selector_limit"));
      continue;
    }
    normalizedVariants.push({ ...variant, ...normalized });
  }
  const resolution = resolveRatePrecedence(normalizedVariants);
  raw.push(...resolution.shadowed);
  const conflicts = conflictIndexes(resolution.retained, (variant) => canonicalJson(variant.price));
  for (const [index, item] of resolution.retained.entries()) {
    if (conflicts.has(index)) {
      raw.push(toRawAtomic(item, "base_price", "conflicting_values", item.applicability));
      continue;
    }
    append(grouped, canonicalJson([item.price, ...optionalValue(item.validity)]), item);
  }
  const result: PriceRateVariant[] = [];
  for (const group of grouped.values()) {
    const first = group[0]!;
    const chunks = groupedApplicabilityChunks(group);
    if (chunks === undefined) {
      raw.push(
        ...group.map((variant) =>
          toRawAtomic(variant, "base_price", "selector_limit", variant.applicability),
        ),
      );
      continue;
    }
    for (const { items, applicability, observations } of chunks)
      result.push({
        price: first.price,
        applicability,
        ...optional("validity", first.validity),
        ...optional("charge_binding", mergedChargeBinding(items)),
        observations,
      });
  }
  return { variants: result, raw };
}

function mergedChargeBinding(variants: AtomicRateVariant[]): ChargeBinding | undefined {
  const bindings = variants.flatMap(({ charge_binding }) =>
    charge_binding === undefined ? [] : [charge_binding],
  );
  const first = bindings[0];
  if (first === undefined) return;
  const identity = ({ observations: _observations, ...binding }: ChargeBinding) =>
    canonicalJson(binding);
  if (bindings.some((binding) => identity(binding) !== identity(first))) return;
  return {
    ...first,
    observations: sortUnique(
      bindings.flatMap(({ observations }) => observations),
      rawObservationKey,
    ),
  };
}

function resolveRatePrecedence(variants: AtomicRateVariant[]): {
  retained: AtomicRateVariant[];
  shadowed: AtomicRawVariant[];
} {
  const shadowed = new Map<number, string>();
  const payloads = variants.map(({ price }) => canonicalJson(price));
  for (const [index, variant] of variants.entries()) {
    if (variant.resolution_policy !== undefined) continue;
    const dominators = variants.flatMap((candidate, candidateIndex) => {
      const policy = candidate.resolution_policy;
      if (
        candidateIndex === index ||
        policy === undefined ||
        payloads[candidateIndex] === payloads[index] ||
        canonicalJson(optionalValue(candidate.validity)) !==
          canonicalJson(optionalValue(variant.validity)) ||
        !applicabilityContainedIn(variant.applicability, candidate.applicability)
      )
        return [];
      return [{ policy, payload: payloads[candidateIndex]! }];
    });
    if (dominators.length === 0) continue;
    if (
      new Set(dominators.map(({ payload }) => payload)).size !== 1 ||
      new Set(dominators.map(({ policy }) => policy)).size !== 1
    )
      continue;
    shadowed.set(index, dominators[0]!.policy);
  }
  return {
    retained: variants.filter((_variant, index) => !shadowed.has(index)),
    shadowed: variants.flatMap((variant, index) => {
      const policy = shadowed.get(index);
      return policy === undefined
        ? []
        : [
            {
              ...toRawAtomic(variant, "informational", "superseded_value", variant.applicability),
              resolution_policy: policy,
            },
          ];
    }),
  };
}

function assembleAllowanceVariants(variants: AtomicAllowanceVariant[]): {
  variants: PriceAllowanceVariant[];
  raw: AtomicRawVariant[];
} {
  const grouped = new Map<string, AtomicAllowanceVariant[]>();
  const raw: AtomicRawVariant[] = [];
  const normalizedVariants: AtomicAllowanceVariant[] = [];
  for (const variant of variants) {
    const normalized = normalizeAtomicApplicability(variant);
    if (normalized === undefined) {
      raw.push(toRawAtomic(variant, "allowance", "selector_limit"));
      continue;
    }
    normalizedVariants.push({
      ...variant,
      target:
        variant.target.kind === "rate_terms"
          ? {
              ...variant.target,
              term_refs: sortUniqueStrings(variant.target.term_refs),
            }
          : {
              ...variant.target,
              offer_refs: sortUniqueStrings(variant.target.offer_refs),
            },
      benefit:
        variant.benefit.kind === "rate_substitution"
          ? {
              ...variant.benefit,
              replaced_term_refs: sortUniqueStrings(variant.benefit.replaced_term_refs),
              replacement_term_refs: sortUniqueStrings(variant.benefit.replacement_term_refs),
            }
          : variant.benefit,
      ...normalized,
    });
  }
  const conflicts = conflictIndexes(normalizedVariants, (variant) =>
    canonicalJson([variant.benefit, variant.target, variant.reset]),
  );
  for (const [index, item] of normalizedVariants.entries()) {
    if (conflicts.has(index)) {
      raw.push(toRawAtomic(item, "allowance", "conflicting_values", item.applicability));
      continue;
    }
    append(
      grouped,
      canonicalJson([item.benefit, item.target, item.reset, ...optionalValue(item.validity)]),
      item,
    );
  }
  const result: PriceAllowanceVariant[] = [];
  for (const group of grouped.values()) {
    const first = group[0]!;
    const chunks = groupedApplicabilityChunks(group);
    if (chunks === undefined) {
      raw.push(
        ...group.map((variant) =>
          toRawAtomic(variant, "allowance", "selector_limit", variant.applicability),
        ),
      );
      continue;
    }
    for (const { applicability, observations } of chunks)
      result.push({
        benefit: first.benefit,
        target: first.target,
        reset: first.reset,
        applicability,
        ...optional("validity", first.validity),
        observations,
      });
  }
  return { variants: result, raw };
}

function applyBaseFallback(
  states: PriceStateVariant[],
  terms: PricingTerm[],
  atomicStates: AtomicPriceState[],
  reason: "conflicting_values" | "selector_limit",
  offerId: string,
): { states: PriceStateVariant[]; terms: PricingTerm[] } {
  const stateRaw =
    states.length > 0
      ? states.map((state) => normalizedVariantToRaw(state, "base_price", reason))
      : atomicStates.map((state) =>
          toRawAtomic(state, "base_price", reason, boundedApplicability(state.applicability)),
        );
  const converted = terms.map((term) => {
    if (term.kind !== "rate" || term.variants.length === 0) return term;
    return {
      ...term,
      variants: [],
      raw_variants: groupRaw([
        ...term.raw_variants.flatMap(expandRaw),
        ...term.variants.flatMap((variant) =>
          expandRaw(normalizedVariantToRaw(variant, "base_price", reason)),
        ),
      ]),
    };
  });
  const observations = stateRaw.flatMap((variant) =>
    "observation" in variant ? [variant.observation] : variant.observations,
  );
  if (observations.length > 0) {
    converted.push({
      id: pricingTermId(offerId, "raw", "kmodels.offer-state"),
      term_key: "kmodels.offer-state",
      kind: "raw",
      source_refs: sortUniqueStrings(observations.map(({ source_ref }) => source_ref)),
      variants: groupRaw(stateRaw.flatMap(expandRaw)),
    });
  }
  return { states: [], terms: converted };
}

function applyRateContainment(states: PriceStateVariant[], terms: PricingTerm[]): PricingTerm[] {
  const numeric: PriceApplicability = {
    any_of: states
      .filter(({ state }) => state === "numeric")
      .flatMap(({ applicability }) => applicability.any_of),
  };
  return terms.map((term) => {
    if (term.kind !== "rate") return term;
    const retained: PriceRateVariant[] = [];
    const raw = term.raw_variants.flatMap(expandRaw);
    for (const variant of term.variants) {
      if (numeric.any_of.length > 0 && applicabilityContainedIn(variant.applicability, numeric))
        retained.push(variant);
      else
        raw.push(
          ...expandRaw(normalizedVariantToRaw(variant, "base_price", "unsupported_structure")),
        );
    }
    return { ...term, variants: retained, raw_variants: groupRaw(raw) };
  });
}

function conflictIndexes<
  T extends {
    applicability: PriceApplicability;
    validity?: PublishedValidity | undefined;
  },
>(variants: T[], payload: (variant: T) => string): Set<number> {
  const conflicts = new Set<number>();
  const variantsByPayload = new Map<string, { index: number; variant: T }[]>();
  for (const [index, variant] of variants.entries()) {
    const key = payload(variant);
    const group = variantsByPayload.get(key);
    if (group === undefined) variantsByPayload.set(key, [{ index, variant }]);
    else group.push({ index, variant });
  }

  const groups = [...variantsByPayload.values()];
  for (const [leftGroupIndex, leftGroup] of groups.entries()) {
    for (
      let rightGroupIndex = leftGroupIndex + 1;
      rightGroupIndex < groups.length;
      rightGroupIndex++
    ) {
      const rightGroup = groups[rightGroupIndex];
      if (rightGroup === undefined) continue;
      for (const left of leftGroup) {
        for (const right of rightGroup) {
          if (variantsOverlap(left.variant, right.variant)) {
            conflicts.add(left.index);
            conflicts.add(right.index);
          }
        }
      }
    }
  }

  const pending = variants.filter((_variant, index) => conflicts.has(index));
  while (pending.length > 0) {
    const conflict = pending.pop();
    if (conflict === undefined) break;
    for (const [candidateIndex, candidate] of variants.entries()) {
      if (conflicts.has(candidateIndex) || !variantsOverlap(conflict, candidate)) continue;
      conflicts.add(candidateIndex);
      pending.push(candidate);
    }
  }
  return conflicts;
}

function variantsOverlap(
  left: { applicability: PriceApplicability; validity?: PublishedValidity | undefined },
  right: { applicability: PriceApplicability; validity?: PublishedValidity | undefined },
): boolean {
  return (
    applicabilitiesOverlap(left.applicability, right.applicability) &&
    publishedValiditiesOverlap(left.validity, right.validity)
  );
}

function finalizeProviderTerms(books: PricingBook[]): PricingBook[] {
  const byId = new Map(
    books.flatMap(({ offers }) =>
      offers.flatMap(({ terms }) => terms.map((term) => [term.id, term])),
    ),
  );
  return books.map((book) => ({
    ...book,
    offers: book.offers.map((offer) => ({
      ...offer,
      terms: applyAllowanceFallback(offer.terms, byId)
        .map(finalizeTerm)
        .sort((left, right) => compareUtf8(left.id, right.id)),
    })),
  }));
}

function applyAllowanceFallback(
  terms: PricingTerm[],
  byId: ReadonlyMap<string, PricingTerm>,
): PricingTerm[] {
  return terms.map((term) => {
    if (term.kind !== "allowance") return term;
    const invalid = term.variants.some((variant) => {
      if (variant.target.kind !== "rate_terms") return false;
      if (variant.benefit.kind !== "quantity") return false;
      const unit = canonicalJson(variant.benefit.quantity.unit);
      return variant.target.term_refs.some((ref) => {
        const rate = byId.get(ref);
        return (
          rate?.kind !== "rate" ||
          rate.variants.length === 0 ||
          rate.raw_variants.length > 0 ||
          rate.variants.some(({ price }) => canonicalJson(price.per) !== unit)
        );
      });
    });
    if (!invalid) return term;
    return {
      ...term,
      variants: [],
      raw_variants: groupRaw([
        ...term.raw_variants.flatMap(expandRaw),
        ...term.variants.flatMap((variant) =>
          expandRaw(normalizedVariantToRaw(variant, "allowance", "target_rate_not_normalized")),
        ),
      ]),
    };
  });
}

function finalizeTerm(term: PricingTerm): PricingTerm {
  if (term.kind === "rate")
    return {
      ...term,
      variants: sortRateVariants(term.variants),
      raw_variants: sortRawVariants(groupRaw(term.raw_variants.flatMap(expandRaw))),
    };
  if (term.kind === "allowance")
    return {
      ...term,
      variants: sortAllowanceVariants(term.variants),
      raw_variants: sortRawVariants(groupRaw(term.raw_variants.flatMap(expandRaw))),
    };
  if (term.kind === "contribution")
    return {
      ...term,
      variants: sortByCanonicalKey(term.variants, (variant) => [
        variant.target_rate_refs,
        variant.charge_bindings,
        ...optionalValue(variant.validity),
        variant.applicability,
      ]),
      raw_variants: sortRawVariants(groupRaw(term.raw_variants.flatMap(expandRaw))),
    };
  return {
    ...term,
    variants: sortRawVariants(groupRaw(term.variants.flatMap(expandRaw))),
  };
}

function groupRaw(variants: AtomicRawVariant[]): RawPricingVariant[] {
  const groups = new Map<string, AtomicRawVariant[]>();
  for (const variant of variants) {
    const scope =
      variant.possible_scope === undefined
        ? undefined
        : boundedApplicability(variant.possible_scope);
    const item = {
      ...variant,
      ...(scope === undefined ? { possible_scope: undefined } : { possible_scope: scope }),
    };
    append(
      groups,
      canonicalJson([
        item.impact,
        item.reason,
        ...optionalValue(item.resolution_policy),
        ...optionalValue(item.possible_scope),
        ...optionalValue(item.validity),
      ]),
      item,
    );
  }
  return [...groups.values()].map((group) => {
    const first = group[0]!;
    return {
      impact: first.impact,
      reason: first.reason,
      ...optional("resolution_policy", first.resolution_policy),
      ...optional("possible_scope", first.possible_scope),
      ...optional("validity", first.validity),
      observations: sortUnique(
        group.map(({ observation }) => observation),
        rawObservationKey,
      ),
    };
  });
}

function assembleDispositions(dispositions: AtomicModelDisposition[]): ModelPricingDisposition[] {
  const grouped = new Map<string, PriceDispositionObservation[]>();
  dispositions.forEach(({ model_ref, observation }) => append(grouped, model_ref, observation));
  return [...grouped]
    .map(([model_ref, observations]) => ({
      model_ref,
      state: "not_applicable" as const,
      observations: sortUnique(observations, dispositionObservationKey),
    }))
    .sort((left, right) => compareUtf8(left.model_ref, right.model_ref));
}

function hasBaseConflict(states: PriceStateVariant[], terms: PricingTerm[]): boolean {
  for (let left = 0; left < states.length; left += 1)
    for (let right = left + 1; right < states.length; right += 1)
      if (
        states[left]!.state !== states[right]!.state &&
        applicabilitiesOverlap(states[left]!.applicability, states[right]!.applicability) &&
        publishedValiditiesOverlap(states[left]!.validity, states[right]!.validity)
      )
        return true;
  const free = states.filter(({ state }) => state === "free");
  const rates = terms.flatMap((term) => (term.kind === "rate" ? term.variants : []));
  return free.some((state) =>
    rates.some(
      (rate) =>
        applicabilitiesOverlap(state.applicability, rate.applicability) &&
        publishedValiditiesOverlap(state.validity, rate.validity),
    ),
  );
}

function normalizeAtomicApplicability<
  T extends {
    applicability: PriceApplicability;
    observation: NormalizedPriceObservation;
  },
>(
  item: T,
): { applicability: PriceApplicability; observation: NormalizedPriceObservation } | undefined {
  const applicability = boundedApplicability(item.applicability);
  const established = boundedApplicability(item.observation.establishes_applicability);
  if (applicability === undefined || established === undefined) return undefined;
  if (canonicalJson(applicability) !== canonicalJson(established))
    throw new Error("Atomic observation applicability does not establish its claim");
  return {
    applicability,
    observation: { ...item.observation, establishes_applicability: established },
  };
}

function groupedApplicability(
  observations: NormalizedPriceObservation[],
): PriceApplicability | undefined {
  try {
    const applicability = unionApplicabilities(
      observations.map(({ establishes_applicability }) => establishes_applicability),
    );
    return selectorWithinLimit(applicability) ? applicability : undefined;
  } catch (error) {
    if (isSelectorLimit(error)) return undefined;
    throw error;
  }
}

interface ApplicabilityChunk<T> {
  items: T[];
  applicability: PriceApplicability;
  observations: NormalizedPriceObservation[];
}

function groupedApplicabilityChunks<T extends { observation: NormalizedPriceObservation }>(
  items: T[],
): ApplicabilityChunk<T>[] | undefined {
  const sorted = items
    .map((item) => ({ item, key: normalizedObservationKey(item.observation) }))
    .sort((left, right) => compareUtf8(left.key, right.key))
    .map(({ item }) => item);
  return compactApplicabilityChunk(sorted);
}

function compactApplicabilityChunk<T extends { observation: NormalizedPriceObservation }>(
  items: T[],
): ApplicabilityChunk<T>[] | undefined {
  const observations = sortUnique(
    items.map(({ observation }) => observation),
    normalizedObservationKey,
  );
  const applicability = groupedApplicability(observations);
  if (applicability !== undefined) return [{ items, applicability, observations }];
  if (items.length < 2) return;
  const middle = Math.ceil(items.length / 2);
  const left = compactApplicabilityChunk(items.slice(0, middle));
  const right = compactApplicabilityChunk(items.slice(middle));
  return left === undefined || right === undefined ? undefined : [...left, ...right];
}

function boundedApplicability(value: PriceApplicability): PriceApplicability | undefined {
  try {
    const normalized = canonicalizeApplicability(value);
    return selectorWithinLimit(normalized) ? normalized : undefined;
  } catch (error) {
    if (isSelectorLimit(error)) return undefined;
    throw error;
  }
}

function selectorWithinLimit(value: PriceApplicability): boolean {
  return canonicalJsonBytes(value).byteLength <= pricingLimits.applicabilityBytes;
}

function isSelectorLimit(error: unknown): boolean {
  return error instanceof Error && /limit exceeded/.test(error.message);
}

function normalizedVariantToRaw(
  variant: {
    applicability: PriceApplicability;
    validity?: PublishedValidity | undefined;
    observations: NormalizedPriceObservation[];
  },
  impact: RawPricingVariant["impact"],
  reason: RawPricingVariant["reason"],
): RawPricingVariant {
  return {
    impact,
    reason,
    possible_scope: variant.applicability,
    ...optional("validity", variant.validity),
    observations: variant.observations.map(toRawObservation),
  };
}

function toRawAtomic(
  variant: {
    validity?: PublishedValidity | undefined;
    observation: NormalizedPriceObservation;
  },
  impact: RawPricingVariant["impact"],
  reason: RawPricingVariant["reason"],
  possibleScope?: PriceApplicability,
): AtomicRawVariant {
  return {
    impact,
    reason,
    ...optional("possible_scope", possibleScope),
    ...optional("validity", variant.validity),
    observation: toRawObservation(variant.observation),
  };
}

function toRawObservation(observation: NormalizedPriceObservation): RawPriceObservation {
  return {
    source_ref: observation.source_ref,
    locator: observation.locator,
    raw: observation.raw,
  };
}

function expandRaw(variant: RawPricingVariant | AtomicRawVariant): AtomicRawVariant[] {
  if ("observation" in variant) return [variant];
  return variant.observations.map((observation) => ({
    impact: variant.impact,
    reason: variant.reason,
    ...optional("resolution_policy", variant.resolution_policy),
    ...optional("possible_scope", variant.possible_scope),
    ...optional("validity", variant.validity),
    observation,
  }));
}

function sortStates(states: PriceStateVariant[]): PriceStateVariant[] {
  return sortByCanonicalKey(states, ({ state, validity, applicability }) => [
    state,
    ...optionalValue(validity),
    applicability,
  ]);
}

function sortRateVariants(variants: PriceRateVariant[]): PriceRateVariant[] {
  return sortByCanonicalKey(variants, ({ price, validity, charge_binding, applicability }) => [
    price,
    ...optionalValue(validity),
    ...optionalValue(charge_binding),
    applicability,
  ]);
}

function sortAllowanceVariants(variants: PriceAllowanceVariant[]): PriceAllowanceVariant[] {
  return sortByCanonicalKey(variants, ({ benefit, target, reset, validity, applicability }) => [
    benefit,
    target,
    reset,
    ...optionalValue(validity),
    applicability,
  ]);
}

function sortRawVariants(variants: RawPricingVariant[]): RawPricingVariant[] {
  return sortByCanonicalKey(
    variants,
    ({ impact, reason, resolution_policy, possible_scope, validity, observations }) => [
      impact,
      reason,
      ...optionalValue(resolution_policy),
      ...optionalValue(possible_scope),
      ...optionalValue(validity),
      observations,
    ],
  );
}

function canonicalScope(scope: PricingScope): PricingScope {
  return {
    ...scope,
    model_refs: sortUniqueStrings(scope.model_refs),
  };
}

function canonicalRelation(relation: AtomicOfferRelation): OfferRelation {
  return {
    ...relation,
    target: { ...relation.target, offer_refs: sortUniqueStrings(relation.target.offer_refs) },
    applicability: canonicalizeApplicability(relation.applicability),
    observations: sortUnique(
      relation.observations.map((observation) => ({
        ...observation,
        establishes_offer_refs: sortUniqueStrings(observation.establishes_offer_refs),
        establishes_book_refs: [],
      })),
      relationObservationKey,
    ),
  };
}

function sortVocabulary(vocabulary: ProviderPricingVocabulary): ProviderPricingVocabulary {
  return {
    ...vocabulary,
    atoms: [...vocabulary.atoms].sort((left, right) => {
      const leftDimension = "dimension" in left ? ["1", canonicalJson(left.dimension)] : ["0"];
      const rightDimension = "dimension" in right ? ["1", canonicalJson(right.dimension)] : ["0"];
      return compareUtf8Sequences(
        [left.kind, ...leftDimension, left.key],
        [right.kind, ...rightDimension, right.key],
      );
    }),
  };
}

function precompactionProjection(prepared: PreparedProvider) {
  const { input } = prepared;
  return {
    provider_vocabulary: sortVocabulary(input.vocabulary),
    provider_snapshot: {
      provider_id: input.provider_id,
      observed_at: input.observed_at,
      publication: "retained" as const,
    },
    books: prepared.books
      .map((book) => ({
        id: book.id,
        provider_id: input.provider_id,
        book_key: book.input.book_key,
        ...optional("name", book.input.name),
        scope: canonicalScope(book.input.scope),
        source_refs: sortUniqueStrings(book.input.source_refs),
      }))
      .sort(byId),
    offers: prepared.books
      .flatMap(({ offers }) =>
        offers.map((offer) => ({
          id: offer.id,
          book_id: offer.bookId,
          offer_key: offer.input.offer_key,
          ...optional("name", offer.input.name),
          ...optional(
            "model_refs",
            offer.input.model_refs === undefined
              ? undefined
              : sortUniqueStrings(offer.input.model_refs),
          ),
          billing_mode: offer.input.billing_mode,
          source_refs: sortUniqueStrings(offer.input.source_refs),
          relations: offer.input.relations.map(canonicalRelation),
        })),
      )
      .sort(byId),
    terms: prepared.books
      .flatMap(({ offers }) =>
        offers.flatMap(({ terms }) =>
          terms.map((term) => ({
            id: term.id,
            offer_id: term.offerId,
            term_key: term.input.term_key,
            source_refs: sortUniqueStrings(term.input.source_refs),
            kind: term.input.kind,
            ...(term.input.kind === "rate" ? { meter: term.input.meter } : {}),
          })),
        ),
      )
      .sort(byId),
    scope_observations: sortAtomic(
      prepared.books.flatMap((book) =>
        book.input.scope_observations.map((observation) => ({
          book_id: book.id,
          observation,
        })),
      ),
    ),
    relation_observations: sortAtomic(
      prepared.books.flatMap(({ offers }) =>
        offers.flatMap((offer) =>
          offer.input.relations.flatMap((relation) =>
            relation.observations.map((observation) => ({ offer_id: offer.id, observation })),
          ),
        ),
      ),
    ),
    disposition_observations: sortAtomic(input.dispositions),
    states: sortAtomic(
      prepared.books.flatMap(({ offers }) =>
        offers.flatMap((offer) =>
          offer.input.states.map((state) => ({
            offer_id: offer.id,
            state: state.state,
            applicability: state.applicability,
            ...optional("validity", state.validity),
            observation: state.observation,
          })),
        ),
      ),
    ),
    rates: sortAtomic(
      prepared.books.flatMap(({ offers }) =>
        offers.flatMap(({ terms }) =>
          terms.flatMap((term) =>
            term.input.kind === "rate"
              ? term.input.variants.map((variant) => ({
                  term_id: term.id,
                  price: variant.price,
                  applicability: variant.applicability,
                  ...optional(
                    "charge_binding",
                    variant.charge_binding === undefined
                      ? undefined
                      : chargeBindingIdentity(variant.charge_binding),
                  ),
                  ...optional("validity", variant.validity),
                  observation: variant.observation,
                }))
              : [],
          ),
        ),
      ),
    ),
    charge_observations: sortAtomic(
      prepared.books.flatMap(({ offers }) =>
        offers.flatMap(({ terms }) =>
          terms.flatMap((term) =>
            term.input.kind === "rate"
              ? term.input.variants.flatMap(
                  (variant) =>
                    variant.charge_binding?.observations.map((observation) => ({
                      term_id: term.id,
                      observation,
                    })) ?? [],
                )
              : [],
          ),
        ),
      ),
    ),
    allowances: sortAtomic(
      prepared.books.flatMap(({ offers }) =>
        offers.flatMap(({ terms }) =>
          terms.flatMap((term) =>
            term.input.kind === "allowance"
              ? term.input.variants.map((variant) => ({
                  term_id: term.id,
                  benefit: variant.benefit,
                  target: variant.target,
                  reset: variant.reset,
                  applicability: variant.applicability,
                  ...optional("validity", variant.validity),
                  observation: variant.observation,
                }))
              : [],
          ),
        ),
      ),
    ),
    contributions: sortAtomic(
      prepared.books.flatMap(({ offers }) =>
        offers.flatMap(({ terms }) =>
          terms.flatMap((term) =>
            term.input.kind === "contribution"
              ? term.input.variants.map((variant) => ({
                  term_id: term.id,
                  target_rate_refs: variant.target_rate_refs,
                  charge_bindings: variant.charge_bindings.map(chargeBindingIdentity),
                  applicability: variant.applicability,
                  ...optional("validity", variant.validity),
                  observation: variant.observation,
                }))
              : [],
          ),
        ),
      ),
    ),
    raw_variants: sortAtomic(
      prepared.books.flatMap(({ offers }) =>
        offers.flatMap(({ terms }) =>
          terms.flatMap((term) =>
            rawAtomicVariants(term.input).map((variant) => ({
              term_id: term.id,
              impact: variant.impact,
              reason: variant.reason,
              ...optional("possible_scope", variant.possible_scope),
              ...optional("validity", variant.validity),
              observation: variant.observation,
            })),
          ),
        ),
      ),
    ),
  };
}

function assertPrecompactionLimit(prepared: PreparedProvider): void {
  const projection = precompactionProjection(prepared);
  if (canonicalJsonBytes(projection).byteLength > pricingLimits.providerPrecompactionBytes)
    throw new Error("Provider precompaction byte limit exceeded");
  const counts = {
    books: projection.books.length,
    offers: projection.offers.length,
    terms: projection.terms.length,
    variants:
      projection.states.length +
      projection.rates.length +
      projection.allowances.length +
      projection.raw_variants.length,
    observations:
      projection.scope_observations.length +
      projection.relation_observations.length +
      projection.charge_observations.length +
      projection.disposition_observations.length +
      projection.states.length +
      projection.rates.length +
      projection.allowances.length +
      projection.raw_variants.length,
  };
  if (
    counts.books > pricingLimits.booksPerProvider ||
    counts.offers > pricingLimits.offersPerProvider ||
    counts.terms > pricingLimits.termsPerProvider ||
    counts.variants > pricingLimits.variantsPerProvider ||
    counts.observations > pricingLimits.observationsPerProvider
  )
    throw new Error("Provider precompaction resource limit exceeded");
}

function rejectReservedAdapterOutput(input: AtomicProviderPricing): void {
  for (const book of input.books)
    for (const offer of book.offers)
      for (const term of offer.terms) {
        if (term.term_key === "kmodels.offer-state")
          throw new Error("Adapter emitted the reserved offer-state term");
        for (const variant of rawAtomicVariants(term))
          if (
            ["selector_limit", "conflicting_values", "target_rate_not_normalized"].includes(
              variant.reason,
            )
          )
            throw new Error("Adapter emitted an assembly-reserved raw reason");
      }
}

function rawAtomicVariants(term: AtomicPricingTerm): AtomicRawVariant[] {
  return term.kind === "raw" ? term.variants : term.raw_variants;
}

function optional<Key extends string, Value>(
  key: Key,
  value: Value | undefined,
): { [Property in Key]?: Value } {
  return value === undefined ? {} : ({ [key]: value } as { [Property in Key]: Value });
}

function optionalValue(value: unknown): unknown[] {
  return value === undefined ? [0] : [1, value];
}

function append<Key, Value>(map: Map<Key, Value[]>, key: Key, value: Value): void {
  const values = map.get(key);
  if (values === undefined) map.set(key, [value]);
  else values.push(value);
}

function sortUniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort(compareUtf8);
}

function sortUnique<T>(values: T[], key: (value: T) => string): T[] {
  const sorted = values
    .map((value) => ({ value, key: key(value) }))
    .sort((left, right) => compareUtf8(left.key, right.key));
  return sorted
    .filter((item, index) => index === 0 || item.key !== sorted[index - 1]!.key)
    .map(({ value }) => value);
}

function sortAtomic<T>(values: T[]): T[] {
  return sortByCanonicalKey(values, (value) => value);
}

function sortByCanonicalKey<T>(values: T[], key: (value: T) => unknown): T[] {
  return values
    .map((value) => ({ value, key: canonicalJson(key(value)) }))
    .sort((left, right) => compareUtf8(left.key, right.key))
    .map(({ value }) => value);
}

function byId(left: { id: string }, right: { id: string }): number {
  return compareUtf8(left.id, right.id);
}

function normalizedObservationKey(observation: NormalizedPriceObservation): string {
  return canonicalJson([
    observation.source_ref,
    observation.locator,
    observation.establishes_applicability,
    observation.raw,
  ]);
}

function rawObservationKey(observation: RawPriceObservation): string {
  return canonicalJson([observation.source_ref, observation.locator, observation.raw]);
}

function scopeObservationKey(observation: PriceScopeObservation): string {
  return canonicalJson([
    observation.source_ref,
    observation.locator,
    observation.establishes,
    observation.raw,
  ]);
}

function relationObservationKey(observation: AtomicOfferRelation["observations"][number]): string {
  return canonicalJson([
    observation.source_ref,
    observation.locator,
    observation.establishes_offer_refs,
    observation.establishes_book_refs,
    observation.raw,
  ]);
}

function chargeBindingIdentity(binding: ChargeBinding): Omit<ChargeBinding, "observations"> {
  const { observations: _observations, ...identity } = binding;
  return identity;
}

function dispositionObservationKey(observation: PriceDispositionObservation): string {
  return canonicalJson([
    observation.source_ref,
    observation.locator,
    observation.establishes_model_ref,
    observation.raw,
  ]);
}
