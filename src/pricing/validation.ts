import { assertIJsonValue, canonicalJson } from "../catalog/canonical-value.ts";
import { pricingLimits } from "../catalog/pricing-constants.ts";
import {
  calculationEnvelopeSchema,
  calculationSchemaVersion,
  type CalculationAllowance,
  type CalculationBook,
  type CalculationContribution,
  type CalculationEnvelope,
  type CalculationOffer,
  type CalculationProvider,
  type CalculationTerm,
} from "./schema.ts";
import { PricingError } from "./errors.ts";
import { pricingSemantics } from "./selection.ts";
import { validateBinding } from "./validation-quantity.ts";
import { unitKey, validateProviderProperties } from "./validation-vocabulary.ts";

interface ProviderReferences {
  provider: CalculationProvider;
  modelIds: Set<string>;
  bookIds: Set<string>;
  offerIds: Set<string>;
  terms: Map<string, CalculationTerm>;
  exposedModelIds: Set<string>;
  variantCount: number;
  globalIds: Set<string>;
}

export function validatePriceData(input: unknown): CalculationEnvelope {
  if (
    typeof input === "object" &&
    input !== null &&
    "schemaVersion" in input &&
    input.schemaVersion !== calculationSchemaVersion
  ) {
    throw new PricingError("UNSUPPORTED_SCHEMA", "Supported calculation schema: 1.0");
  }
  try {
    assertIJsonValue(input);
    const parsed = calculationEnvelopeSchema.safeParse(input);
    if (!parsed.success) throw new Error(parsed.error.message);
    requireUniqueIds(parsed.data.providers.map(({ snapshot }) => snapshot.provider_id));
    const globalIds = new Set<string>();
    for (const provider of parsed.data.providers) validateProvider(provider, globalIds);
    return parsed.data;
  } catch (error) {
    throw new PricingError(
      "INVALID_DATA",
      error instanceof Error ? error.message : "Invalid pricing semantics",
    );
  }
}

function validateProvider(provider: CalculationProvider, globalIds: Set<string>): void {
  validateProviderIdentities(provider);
  const references = collectProviderReferences(provider, globalIds);
  validateProviderLimits(references);
  validateModelDispositions(references);
  for (const book of provider.books) validateBook(book, references);
  validateProviderProperties(provider);
}

function validateProviderIdentities(provider: CalculationProvider): void {
  if (provider.vocabulary.provider_id !== provider.snapshot.provider_id) {
    throw new Error("Vocabulary belongs to another provider");
  }
  requireUniqueIds(provider.models.map((model) => model.model_ref));
  requireUniqueIds(provider.sources.map((source) => source.id));
  const atomIds = provider.vocabulary.atoms.map((atom) =>
    canonicalJson([atom.kind, atom.key, atom.kind === "categorical_value" ? atom.dimension : null]),
  );
  requireUniqueIds(atomIds);
}

function collectProviderReferences(
  provider: CalculationProvider,
  globalIds: Set<string>,
): ProviderReferences {
  const references: ProviderReferences = {
    provider,
    globalIds,
    modelIds: new Set(provider.models.map((model) => model.model_ref)),
    bookIds: new Set(),
    offerIds: new Set(),
    terms: new Map(),
    exposedModelIds: new Set(),
    variantCount: 0,
  };
  for (const book of provider.books) {
    references.bookIds.add(book.id);
    for (const offer of book.offers) {
      references.offerIds.add(offer.id);
      for (const modelRef of offer.model_refs ?? book.scope.model_refs)
        references.exposedModelIds.add(modelRef);
      for (const term of offer.terms) {
        references.terms.set(term.id, term);
        references.variantCount += term.variants.length;
        if (term.kind !== "raw") references.variantCount += term.raw_variants.length;
      }
    }
  }
  return references;
}

function validateProviderLimits(references: ProviderReferences): void {
  if (
    references.bookIds.size > pricingLimits.booksPerProvider ||
    references.offerIds.size > pricingLimits.offersPerProvider ||
    references.terms.size > pricingLimits.termsPerProvider ||
    references.variantCount > pricingLimits.variantsPerProvider
  ) {
    throw new Error("Provider calculation budget exceeded");
  }
}

function validateModelDispositions(references: ProviderReferences): void {
  for (const model of references.provider.models) {
    if ((model.disposition === "offers") !== references.exposedModelIds.has(model.model_ref)) {
      throw new Error("Model disposition does not match the complete provider partition");
    }
    if (!model.model_ref.startsWith(`${references.provider.snapshot.provider_id}/`)) {
      throw new Error("Model belongs to another provider");
    }
  }
}

function validateBook(book: CalculationBook, references: ProviderReferences): void {
  registerIdentity(references.globalIds, book.id);
  if (book.provider_id !== references.provider.snapshot.provider_id)
    throw new Error("Book belongs to another provider");
  for (const modelRef of book.scope.model_refs) {
    if (!references.modelIds.has(modelRef)) throw new Error("Missing model reference");
  }
  for (const edge of book.resource_edges) {
    const targetRefs =
      edge.target.kind === "books" ? edge.target.book_refs : edge.target.model_refs;
    const availableRefs = edge.target.kind === "books" ? references.bookIds : references.modelIds;
    if (targetRefs.some((ref) => !availableRefs.has(ref)))
      throw new Error("Missing resource edge target");
  }
  for (const offer of book.offers) validateOffer(offer, book, references);
}

function validateOffer(
  offer: CalculationOffer,
  book: CalculationBook,
  references: ProviderReferences,
): void {
  registerIdentity(references.globalIds, offer.id);
  if (offer.model_refs?.some((ref) => !book.scope.model_refs.includes(ref)))
    throw new Error("Offer model outside book scope");
  for (const relation of offer.relations) {
    if (
      relation.target.offer_refs.some((ref) => ref === offer.id || !references.offerIds.has(ref))
    ) {
      throw new Error("Missing or self-referencing relation target");
    }
  }
  for (const term of offer.terms) validateTerm(term, references);
}

function validateTerm(term: CalculationTerm, references: ProviderReferences): void {
  registerIdentity(references.globalIds, term.id);
  if (term.kind === "raw") return;
  if (term.variants.length + term.raw_variants.length === 0) throw new Error("Empty term");
  switch (term.kind) {
    case "rate":
      for (const rate of term.variants) {
        unitKey(rate.price.per);
        if (rate.charge_binding !== undefined)
          validateBinding(rate.charge_binding, references.provider, rate.price.per);
      }
      return;
    case "contribution":
      for (const contribution of term.variants) validateContribution(contribution, references);
      return;
    case "allowance":
      for (const allowance of term.variants) validateAllowance(allowance, references);
  }
}

function validateContribution(
  contribution: CalculationContribution,
  references: ProviderReferences,
): void {
  const bindingKeys = new Set<string>();
  for (const binding of contribution.charge_bindings) {
    const key = canonicalJson(pricingSemantics(binding));
    if (bindingKeys.has(key)) throw new Error("Contribution repeats a charge binding");
    bindingKeys.add(key);
  }
  for (const rateRef of contribution.target_rate_refs) {
    const targetRate = references.terms.get(rateRef);
    if (targetRate?.kind !== "rate" || targetRate.variants.length === 0)
      throw new Error("Missing contribution rate");
    for (const binding of contribution.charge_bindings) {
      for (const variant of targetRate.variants)
        validateBinding(binding, references.provider, variant.price.per);
    }
  }
}

function validateAllowance(allowance: CalculationAllowance, references: ProviderReferences): void {
  if (allowance.target.kind === "offers") {
    if (allowance.target.offer_refs.some((ref) => !references.offerIds.has(ref)))
      throw new Error("Missing allowance offer");
  } else {
    for (const rateRef of allowance.target.term_refs) {
      const targetRate = references.terms.get(rateRef);
      if (targetRate?.kind !== "rate" || targetRate.variants.length === 0)
        throw new Error("Missing allowance rate");
      if (allowance.benefit.kind === "quantity") {
        const allowanceUnit = unitKey(allowance.benefit.quantity.unit);
        if (targetRate.variants.some((rate) => unitKey(rate.price.per) !== allowanceUnit))
          throw new Error("Incompatible allowance unit");
      }
    }
  }
  if (allowance.benefit.kind === "rate_substitution") {
    const rateRefs = [
      ...allowance.benefit.replaced_term_refs,
      ...allowance.benefit.replacement_term_refs,
    ];
    if (rateRefs.some((ref) => references.terms.get(ref)?.kind !== "rate"))
      throw new Error("Missing substitution rate");
  }
}

function requireUniqueIds(ids: string[]): void {
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate pricing identity");
}

function registerIdentity(ids: Set<string>, id: string): void {
  if (ids.has(id)) throw new Error("Duplicate book, offer, or term identity");
  ids.add(id);
}
