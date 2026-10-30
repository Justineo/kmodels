import { canonicalJson } from "./canonical-value.ts";
import type { InvocationCatalog } from "./invocation-schema.ts";
import type { InvocationOwners } from "./invocation-validation.ts";
import type { InvocationPricingBinding } from "./invocation-pricing-schema.ts";
import type {
  PriceSelectorSource,
  PricingBook,
  PricingOffer,
  ProviderPricingVocabulary,
} from "./pricing-schema.ts";
import type { CalculationBook, CalculationOffer, CalculationRate } from "../pricing/schema.ts";
import { standardDimensionKind } from "./pricing-dimension-kind.ts";

export type InvocationPriceSelectorSource =
  | PriceSelectorSource
  | NonNullable<CalculationRate["selector_sources"]>[number];

export function invocationSelectorContract(source: InvocationPriceSelectorSource) {
  if ("observations" in source) {
    const { observations: _observations, ...contract } = source;
    return contract;
  }
  const { evidence: _evidence, ...contract } = source;
  return contract;
}

/** Shared reference and selector validation for canonical and portable price books. */
export function validateInvocationPricing(
  invocation: InvocationCatalog,
  owners: InvocationOwners,
  books: readonly (PricingBook | CalculationBook)[],
  vocabularies: readonly ProviderPricingVocabulary[],
  bindings: readonly InvocationPricingBinding[],
  sourceRef: (offerRef: string, source: InvocationPriceSelectorSource) => string,
): void {
  const targets = new Map(invocation.invocation_targets.map((target) => [target.id, target]));
  const models = new Map(owners.models.map((model) => [model.uid, model]));
  const sources = new Map(owners.sources.map((source) => [source.id, source]));
  const evidence = new Map(invocation.invocation_evidence.map((item) => [item.id, item]));
  const surfaces = new Map(invocation.surfaces.map((surface) => [surface.id, surface]));
  const offers = new Map(
    books.flatMap((book) => book.offers.map((offer) => [offer.id, { book, offer }] as const)),
  );
  const seen = new Set<string>();
  const commercialDimensions = new Map<string, ReadonlySet<string>>();
  for (const binding of bindings) {
    const key = canonicalJson([binding.target_ref, binding.case_ref]);
    if (seen.has(key)) throw new Error("Duplicate invocation pricing binding");
    seen.add(key);
    const target = targets.get(binding.target_ref);
    const entry = target?.cases.find(({ id }) => id === binding.case_ref);
    if (target === undefined || entry === undefined)
      throw new Error("Invocation pricing references an unknown target or case");
    const model = models.get(target.model_ref);
    const provider = model?.provider_id;
    if (provider === undefined) throw new Error("Invocation pricing references an unknown model");
    if (entry.support.state !== "supported")
      throw new Error("Invocation pricing requires documented support");
    const surface = surfaces.get(target.surface_ref);
    const inputs = new Set([
      "request_region",
      "inference_mode",
      "inference_geo",
      "deployment_type",
      ...(surface?.inputs.map(({ name }) => name) ?? []),
    ]);
    const dimensions = new Set<string>();
    const vocabulary = vocabularies.find(({ provider_id }) => provider_id === provider);
    for (const selector of binding.selectors) {
      const dimension = canonicalJson(selector.dimension);
      if (dimensions.has(dimension)) throw new Error("Duplicate invocation price selector");
      dimensions.add(dimension);
      if (selector.dimension.namespace === "kmodels") {
        if (standardDimensionKind(selector.dimension.value) !== "categorical")
          throw new Error("Invocation selectors require a categorical price dimension");
        if (selector.dimension.value === "model" && selector.value.kind !== "fixed")
          throw new Error("Invocation price model selector must fix the target identity");
      } else if (
        selector.dimension.provider_id !== provider ||
        !vocabulary?.atoms.some(
          (atom) => atom.kind === "dimension" && atom.key === selector.dimension.value,
        )
      )
        throw new Error("Invocation price dimension has missing or foreign ownership");
      if (selector.value.kind === "fixed") {
        const value = selector.value.value;
        if (selector.dimension.namespace === "kmodels" && selector.dimension.value === "model") {
          if (
            value.namespace !== "kmodels" ||
            value.value !== (target.resolved_model_ref ?? target.model_ref)
          )
            throw new Error("Invocation price model selector contradicts its target");
        } else if (
          value.namespace !== "provider" ||
          value.provider_id !== provider ||
          !vocabulary?.atoms.some(
            (atom) =>
              atom.kind === "categorical_value" &&
              atom.key === value.value &&
              canonicalJson(atom.dimension) === dimension,
          )
        )
          throw new Error("Invocation price value has missing or foreign dimension ownership");
      }
      if (selector.value.kind === "context" && !inputs.has(selector.value.input))
        throw new Error("Invocation pricing references an undeclared context input");
      if (selector.value.kind === "observed") {
        const inputRef = selector.value.input_ref;
        // Acquisition contracts belong to an offer; check every linked offer below.
        for (const offerRef of binding.offer_refs)
          if (
            !offers
              .get(offerRef)
              ?.offer.terms.some(
                (term) =>
                  term.kind === "rate" &&
                  term.variants.some((variant) =>
                    variant.selector_sources?.some(
                      (source) =>
                        sourceRef(offerRef, source) === inputRef &&
                        canonicalJson(source.dimension) === dimension,
                    ),
                  ),
              )
          )
            throw new Error("Invocation pricing references an unknown observed input");
      }
    }
    for (const ref of [
      ...binding.evidence_refs,
      ...binding.selectors.flatMap(({ evidence_refs }) => evidence_refs),
    ]) {
      const item = evidence.get(ref);
      if (item === undefined || sources.get(item.source_ref)?.provider_id !== provider)
        throw new Error("Invocation pricing evidence is missing or belongs to another provider");
    }
    for (const ref of binding.offer_refs) {
      const match = offers.get(ref);
      if (
        match === undefined ||
        match.book.provider_id !== provider ||
        !(match.offer.model_refs ?? match.book.scope.model_refs).includes(
          target.resolved_model_ref ?? target.model_ref,
        )
      )
        throw new Error("Invocation pricing offer is missing or belongs to a different model");
      let consumed = commercialDimensions.get(ref);
      if (consumed === undefined) {
        consumed = offerDimensions(match.offer);
        commercialDimensions.set(ref, consumed);
      }
      for (const selector of binding.selectors) {
        // Model membership is already restricted by the canonical book/offer scope.
        if (selector.dimension.namespace === "kmodels" && selector.dimension.value === "model")
          continue;
        if (!consumed.has(canonicalJson(selector.dimension)))
          throw new Error(
            "Invocation price selector is absent from the offer's commercial applicability",
          );
      }
    }
  }
}

function offerDimensions(offer: PricingOffer | CalculationOffer): ReadonlySet<string> {
  const scopes = [
    ...offer.states,
    ...offer.enrollment,
    ...offer.settlement,
    ...offer.relations,
  ].map(({ applicability }) => applicability);
  for (const term of offer.terms) {
    if (term.kind !== "raw")
      for (const variant of term.variants) scopes.push(variant.applicability);
    const raw = term.kind === "raw" ? term.variants : term.raw_variants;
    for (const variant of raw)
      if (variant.possible_scope !== undefined) scopes.push(variant.possible_scope);
  }
  return new Set(
    scopes.flatMap(({ any_of }) =>
      any_of.flatMap(({ all_of }) => all_of.map(({ dimension }) => canonicalJson(dimension))),
    ),
  );
}
