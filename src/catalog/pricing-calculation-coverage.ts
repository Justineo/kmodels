import { canonicalJson, uniqueCanonicalValues } from "./canonical-value.ts";
import type { PriceCategoricalValue, PriceDimension } from "./pricing-schema.ts";
import type {
  CalculationBook,
  CalculationEnvelope,
  CalculationOffer,
  CalculationProvider,
  CalculationRate,
  CalculationTerm,
} from "../pricing/schema.ts";
import { rawTermVariants, termBindings } from "../pricing/snapshot.ts";

type ComponentCoverage = ReturnType<typeof componentCoverage>;

export function calculationCoverage(envelope: CalculationEnvelope) {
  return {
    schemaVersion: envelope.schemaVersion,
    snapshot: envelope.snapshot,
    providers: envelope.providers.map(providerCoverage),
  };
}

function providerCoverage(provider: CalculationProvider) {
  const components: ComponentCoverage[] = [];
  const offerStates: Array<{
    offerRef: string;
    states: CalculationOffer["states"][number]["state"][];
  }> = [];
  for (const book of provider.books) {
    for (const offer of book.offers) {
      for (const term of offer.terms) components.push(componentCoverage(book, offer, term));
      offerStates.push({
        offerRef: offer.id,
        states: uniqueCanonicalValues(offer.states.map((variant) => variant.state)),
      });
    }
  }
  return {
    snapshot: provider.snapshot,
    modelDispositions: provider.models,
    components,
    offerStates,
  };
}

function componentCoverage(book: CalculationBook, offer: CalculationOffer, term: CalculationTerm) {
  const unsupportedVariants = rawTermVariants(term).filter(
    (variant) => variant.impact !== "informational",
  );
  return {
    bookRef: book.id,
    offerRef: offer.id,
    offerKey: offer.offer_key,
    modelRefs: offer.model_refs ?? book.scope.model_refs,
    termRef: term.id,
    termKey: term.term_key,
    kind: term.kind,
    ...(term.kind === "rate" ? { meter: term.meter } : {}),
    operations: termOperations(term),
    normalizedVariants: term.kind === "raw" ? 0 : term.variants.length,
    ...bindingCoverage(term),
    rawReasons: uniqueCanonicalValues(unsupportedVariants.map((variant) => variant.reason)),
    sourceRefs: term.source_refs,
  };
}

function termOperations(term: CalculationTerm): PriceCategoricalValue[] {
  const scopes =
    term.kind === "raw"
      ? term.variants.flatMap((variant) =>
          variant.possible_scope === undefined ? [] : [variant.possible_scope],
        )
      : term.variants.map((variant) => variant.applicability);
  const operations: PriceCategoricalValue[] = [];
  for (const scope of scopes) {
    for (const clause of scope.any_of) {
      for (const condition of clause.all_of) {
        if (
          condition.kind === "categorical" &&
          condition.dimension.namespace === "kmodels" &&
          condition.dimension.value === "operation"
        ) {
          operations.push(...condition.values);
        }
      }
    }
  }
  return uniqueCanonicalValues(operations);
}

function bindingCoverage(term: CalculationTerm) {
  const bindings = termBindings(term);
  const acquisitionCount = bindings.filter((binding) =>
    binding.quantity_methods?.some((method) => method.input_sources !== undefined),
  ).length;
  const unmappedSelectors =
    term.kind === "rate" ? term.variants.flatMap(selectorsWithoutAcquisition) : [];
  return {
    boundCharges: bindings.length,
    chargesWithAcquisition: acquisitionCount,
    chargesRequiringCallerInputs: bindings.length - acquisitionCount,
    aggregationBoundaries: uniqueCanonicalValues(bindings.map((binding) => binding.aggregation)),
    selectorsWithoutAcquisition: uniqueCanonicalValues(unmappedSelectors),
  };
}

function selectorsWithoutAcquisition(rate: CalculationRate): PriceDimension[] {
  const mappedDimensions = new Set(
    rate.selector_sources?.map((source) => canonicalJson(source.dimension)),
  );
  const missing: PriceDimension[] = [];
  for (const clause of rate.applicability.any_of) {
    for (const condition of clause.all_of) {
      if (!mappedDimensions.has(canonicalJson(condition.dimension)))
        missing.push(condition.dimension);
    }
  }
  return missing;
}
