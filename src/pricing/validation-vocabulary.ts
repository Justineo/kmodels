import { canonicalJson } from "../catalog/canonical-value.ts";
import {
  canonicalizeApplicability,
  normalizeUnitExpression,
} from "../catalog/pricing-canonical.ts";
import { standardDimensionKind } from "../catalog/pricing-dimension-kind.ts";
import { publishedValidityIsCoherent } from "../catalog/pricing-time.ts";
import type {
  PriceApplicability,
  PriceCategoricalValue,
  PriceCondition,
  PriceDenomination,
  PriceDimension,
  PublishedValidity,
  UnitExpression,
} from "../catalog/pricing-schema.ts";
import type {
  Evidence,
  PriceDataBook,
  PriceDataOffer,
  PriceDataProvider,
  PriceDataRaw,
  PriceDataTerm,
} from "./schema.ts";

interface VocabularyIndex {
  providerId: string;
  sourceIds: Set<string>;
  modelIds: Set<string>;
  atomsByKind: Map<string, Set<string>>;
  categoricalAtoms: Set<string>;
  creditDenominations: Set<string>;
  dimensionShapes: Map<string, string>;
  applicabilityCount: number;
  applicabilityModels: string[][];
}

function buildVocabularyIndex(provider: PriceDataProvider): VocabularyIndex {
  const atomsByKind = new Map<string, Set<string>>();
  const categoricalAtoms = new Set<string>();
  const creditDenominations = new Set<string>();
  for (const atom of provider.vocabulary.atoms) {
    if (atom.kind === "categorical_value") {
      categoricalAtoms.add(canonicalJson([atom.key, atom.dimension]));
    } else if (atom.kind === "credit_denomination") {
      creditDenominations.add(atom.key);
    } else {
      let keys = atomsByKind.get(atom.kind);
      if (keys === undefined) {
        keys = new Set();
        atomsByKind.set(atom.kind, keys);
      }
      keys.add(atom.key);
    }
  }
  return {
    providerId: provider.snapshot.provider_id,
    sourceIds: new Set(provider.sources.map((source) => source.id)),
    modelIds: new Set(provider.models.map((model) => model.model_ref)),
    atomsByKind,
    categoricalAtoms,
    creditDenominations,
    dimensionShapes: new Map(),
    applicabilityCount: provider.applicabilities.length,
    applicabilityModels: [],
  };
}

export function validateProviderProperties(provider: PriceDataProvider): void {
  const index = buildVocabularyIndex(provider);
  for (const atom of provider.vocabulary.atoms) {
    if (atom.kind === "usage_signal") validateUnitExpressionAtoms(atom.unit, index);
    else if (atom.kind === "categorical_value") validateAtom(atom.dimension, "dimension", index);
  }
  const seenApplicabilities = new Set<string>();
  for (const scope of provider.applicabilities) {
    const key = validateApplicabilityEntry(scope, index);
    if (seenApplicabilities.has(key)) throw new Error("Duplicate applicability entry");
    seenApplicabilities.add(key);
  }
  for (const book of provider.books) validateBookProperties(book, index);
}

function validateEvidence(entries: readonly Evidence[], index: VocabularyIndex): void {
  for (const entry of entries) {
    if (!index.sourceIds.has(entry.source_ref)) throw new Error("Missing evidence source");
  }
}

function validateSourceRefs(refs: readonly string[], index: VocabularyIndex): void {
  for (const ref of refs) {
    if (!index.sourceIds.has(ref)) throw new Error("Missing source reference");
  }
}

function validateValidity(validity: PublishedValidity | undefined): void {
  if (validity === undefined) return;
  if (!publishedValidityIsCoherent(validity.from, validity.until))
    throw new Error("Incoherent validity");
}

function validateUnitExpressionAtoms(unit: UnitExpression, index: VocabularyIndex): void {
  for (const factor of unit.factors) validateAtom(factor.unit, "unit", index);
}

function validateApplicabilityRef(
  id: number,
  index: VocabularyIndex,
  bookModels: ReadonlySet<string>,
): void {
  if (id < 0 || id >= index.applicabilityCount) {
    throw new Error("Applicability reference out of range");
  }
  const models = index.applicabilityModels[id];
  if (models === undefined) return;
  for (const modelRef of models) {
    if (!bookModels.has(modelRef)) throw new Error("Missing model selector reference");
  }
}

function validateBookProperties(book: PriceDataBook, index: VocabularyIndex): void {
  const bookModels = new Set(book.scope.model_refs);
  validateEvidence(book.evidence, index);
  validateSourceRefs(book.source_refs, index);
  if (book.scope.kind === "provider_resource")
    validateAtom(book.scope.resource_kind, "resource_kind", index);
  for (const offer of book.offers) validateOfferProperties(offer, index, bookModels);
}

function validateOfferProperties(
  offer: PriceDataOffer,
  index: VocabularyIndex,
  bookModels: ReadonlySet<string>,
): void {
  validateAtom(offer.billing_mode, "billing_mode", index);
  validateSourceRefs(offer.source_refs, index);
  for (const state of offer.states) {
    validateApplicabilityRef(state.applicability_id, index, bookModels);
    validateValidity(state.validity);
    validateEvidence(state.evidence, index);
  }
  for (const claim of offer.selection ?? []) {
    validateApplicabilityRef(claim.applicability_id, index, bookModels);
    validateValidity(claim.validity);
    validateEvidence(claim.evidence, index);
    for (const alternative of claim.alternatives) {
      validateApplicabilityRef(alternative.applicability_id, index, bookModels);
    }
  }
  for (const relation of offer.relations) {
    validateApplicabilityRef(relation.applicability_id, index, bookModels);
    validateValidity(relation.validity);
    validateEvidence(relation.evidence, index);
  }
  for (const term of offer.terms) validateTermProperties(term, index, bookModels);
}

function validateRawVariants(
  variants: readonly PriceDataRaw[],
  index: VocabularyIndex,
  bookModels: ReadonlySet<string>,
): void {
  for (const variant of variants) {
    if (variant.possible_scope_id !== undefined)
      validateApplicabilityRef(variant.possible_scope_id, index, bookModels);
    validateValidity(variant.validity);
    validateEvidence(variant.evidence, index);
  }
}

function validateTermProperties(
  term: PriceDataTerm,
  index: VocabularyIndex,
  bookModels: ReadonlySet<string>,
): void {
  validateSourceRefs(term.source_refs, index);
  if (term.kind === "raw") {
    validateRawVariants(term.variants, index, bookModels);
    return;
  }
  validateRawVariants(term.raw_variants, index, bookModels);
  if (term.kind === "rate") {
    validateAtom(term.meter, "meter", index);
    for (const rate of term.variants) {
      validateApplicabilityRef(rate.applicability_id, index, bookModels);
      validateValidity(rate.validity);
      validateEvidence(rate.evidence, index);
      validateCreditDenomination(rate.price.denomination, index);
      validateUnitExpressionAtoms(rate.price.per, index);
    }
    return;
  }
  if (term.kind === "allowance") {
    for (const allowance of term.variants) {
      validateApplicabilityRef(allowance.applicability_id, index, bookModels);
      validateValidity(allowance.validity);
      validateEvidence(allowance.evidence, index);
      if (allowance.reset !== undefined) validateAtom(allowance.reset, "allowance_reset", index);
      if (allowance.benefit.kind === "quantity") {
        validateUnitExpressionAtoms(allowance.benefit.quantity.unit, index);
      } else if (allowance.benefit.kind === "credit") {
        validateCreditDenomination(allowance.benefit.denomination, index);
      }
    }
    return;
  }
  for (const contribution of term.variants) {
    validateApplicabilityRef(contribution.applicability_id, index, bookModels);
    validateValidity(contribution.validity);
    validateEvidence(contribution.evidence, index);
  }
}

function validateApplicabilityEntry(scope: PriceApplicability, index: VocabularyIndex): string {
  const key = canonicalJson(scope);
  if (canonicalJson(canonicalizeApplicability(scope)) !== key)
    throw new Error("Noncanonical applicability");
  const models: string[] = [];
  for (const clause of scope.any_of) {
    for (const condition of clause.all_of) {
      validateConditionWithIndex(condition, index, models);
      const dimensionKey = canonicalJson(condition.dimension);
      const dimensionShape = canonicalJson([
        condition.kind,
        condition.kind === "decimal_range" ? condition.unit : null,
      ]);
      const previousShape = index.dimensionShapes.get(dimensionKey);
      if (previousShape !== undefined && previousShape !== dimensionShape)
        throw new Error("Dimension changes kind or unit");
      index.dimensionShapes.set(dimensionKey, dimensionShape);
    }
  }
  index.applicabilityModels.push(models);
  return key;
}

function validateConditionWithIndex(
  condition: PriceCondition,
  index: VocabularyIndex,
  collectedModels?: string[],
): void {
  const dimension = condition.dimension;
  validateAtom(dimension, "dimension", index);
  if (dimension.namespace === "kmodels") validateStandardCondition(condition, dimension.value);
  if (condition.kind === "decimal_range") {
    validateUnitExpressionAtoms(condition.unit, index);
    unitKey(condition.unit);
  }
  if (condition.kind === "categorical") {
    for (const value of condition.values)
      validateCategoricalValueWithIndex(value, dimension, index, collectedModels);
  }
}

const vocabularyIndexCache = new WeakMap<PriceDataProvider, VocabularyIndex>();

function cachedVocabularyIndex(provider: PriceDataProvider): VocabularyIndex {
  const existing = vocabularyIndexCache.get(provider);
  if (existing !== undefined) return existing;
  const index = buildVocabularyIndex(provider);
  vocabularyIndexCache.set(provider, index);
  return index;
}

export function validateCondition(condition: PriceCondition, provider: PriceDataProvider): void {
  validateConditionWithIndex(condition, cachedVocabularyIndex(provider));
}

function validateStandardCondition(
  condition: PriceCondition,
  dimension: Extract<PriceDimension, { namespace: "kmodels" }>["value"],
): void {
  if (condition.kind !== standardDimensionKind(dimension))
    throw new Error("Invalid standard dimension kind");
  if (condition.kind !== "decimal_range") return;
  const expectedUnit: UnitExpression = {
    factors: [
      {
        unit: { namespace: "kmodels", value: dimension.endsWith("_tokens") ? "token" : "second" },
        power: 1,
      },
    ],
  };
  if (unitKey(condition.unit) !== unitKey(expectedUnit))
    throw new Error("Invalid standard dimension unit");
}

function validateCategoricalValueWithIndex(
  value: PriceCategoricalValue,
  dimension: PriceDimension,
  index: VocabularyIndex,
  collectedModels?: string[],
): void {
  if (dimension.namespace === "kmodels" && dimension.value === "model") {
    if (value.namespace !== "kmodels" || !index.modelIds.has(value.value))
      throw new Error("Missing model selector reference");
    collectedModels?.push(value.value);
    return;
  }
  if (dimension.namespace === "kmodels" && dimension.value === "execution") {
    if (value.namespace !== "kmodels" || !["request", "batch", "realtime"].includes(value.value))
      throw new Error("Invalid canonical execution condition");
    return;
  }
  if (value.namespace !== "provider" || value.provider_id !== index.providerId)
    throw new Error("Unregistered categorical value");
  if (!index.categoricalAtoms.has(canonicalJson([value.value, dimension])))
    throw new Error("Unregistered categorical value");
}

function validateAtom(
  value:
    | { namespace: "kmodels"; value: string }
    | { namespace: "provider"; provider_id: string; value: string },
  kind: string,
  index: VocabularyIndex,
): void {
  if (value.namespace !== "provider") return;
  const belongsToProvider = value.provider_id === index.providerId;
  const registered = index.atomsByKind.get(kind)?.has(value.value) ?? false;
  if (!belongsToProvider || !registered) throw new Error(`Unregistered ${kind}`);
}

function validateCreditDenomination(value: PriceDenomination, index: VocabularyIndex): void {
  if (value.kind !== "provider_credit") return;
  if (value.provider_id !== index.providerId || !index.creditDenominations.has(value.code))
    throw new Error("Unregistered credit denomination");
}

export function unitKey(unit: UnitExpression): string {
  if (canonicalJson(normalizeUnitExpression(unit)) !== canonicalJson(unit))
    throw new Error("Noncanonical unit");
  return canonicalJson(unit);
}
