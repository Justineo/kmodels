import { uniqueCanonicalValues } from "./canonical-value.ts";
import type { PriceCategoricalValue } from "./pricing-schema.ts";
import type {
  PriceDataBook,
  PriceDataEnvelope,
  PriceDataOffer,
  PriceDataProvider,
  PriceDataTerm,
} from "../pricing/schema.ts";
import { rawTermVariants } from "../pricing/snapshot.ts";

type ComponentCoverage = ReturnType<typeof componentCoverage>;

export function priceDataCoverage(envelope: PriceDataEnvelope) {
  return {
    schemaVersion: envelope.schemaVersion,
    snapshot: envelope.snapshot,
    providers: envelope.providers.map(providerCoverage),
  };
}

function providerCoverage(provider: PriceDataProvider) {
  const components: ComponentCoverage[] = [];
  const offerStates: Array<{
    offerRef: string;
    states: PriceDataOffer["states"][number]["state"][];
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

function componentCoverage(book: PriceDataBook, offer: PriceDataOffer, term: PriceDataTerm) {
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
    conditions: uniqueCanonicalValues(
      (term.kind === "raw" ? [] : term.variants).flatMap(({ applicability }) =>
        applicability.any_of.flatMap(({ all_of }) => all_of.map(({ dimension }) => dimension)),
      ),
    ),
    rawReasons: uniqueCanonicalValues(unsupportedVariants.map((variant) => variant.reason)),
    sourceRefs: term.source_refs,
  };
}

function termOperations(term: PriceDataTerm): PriceCategoricalValue[] {
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
