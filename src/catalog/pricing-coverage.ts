import { uniqueCanonicalValues } from "./canonical-value.ts";
import type { PriceApplicability, PriceCategoricalValue } from "./pricing-schema.ts";
import type {
  PriceDataBook,
  PriceDataEnvelope,
  PriceDataOffer,
  PriceDataProvider,
  PriceDataTerm,
} from "../pricing/schema.ts";
import { rawTermVariants, resolveApplicability } from "../pricing/snapshot.ts";

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
      for (const term of offer.terms)
        components.push(componentCoverage(provider, book, offer, term));
      const states: PriceDataOffer["states"][number]["state"][] = offer.states.map(
        (variant) => variant.state,
      );
      if (offer.terms.some((term) => term.kind === "rate" && term.variants.length > 0)) {
        states.push("numeric");
      }
      offerStates.push({
        offerRef: offer.id,
        states: uniqueCanonicalValues(states),
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

function componentCoverage(
  provider: PriceDataProvider,
  book: PriceDataBook,
  offer: PriceDataOffer,
  term: PriceDataTerm,
) {
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
    operations: termOperations(provider, term),
    normalizedVariants: term.kind === "raw" ? 0 : term.variants.length,
    conditions: uniqueCanonicalValues(
      (term.kind === "raw" ? [] : term.variants).flatMap(({ applicability_id }) =>
        resolveApplicability(provider, applicability_id).any_of.flatMap(({ all_of }) =>
          all_of.map(({ dimension }) => dimension),
        ),
      ),
    ),
    rawReasons: uniqueCanonicalValues(unsupportedVariants.map((variant) => variant.reason)),
    sourceRefs: term.source_refs,
  };
}

function termOperations(provider: PriceDataProvider, term: PriceDataTerm): PriceCategoricalValue[] {
  const scopes: PriceApplicability[] =
    term.kind === "raw"
      ? term.variants.flatMap((variant) =>
          variant.possible_scope_id === undefined
            ? []
            : [resolveApplicability(provider, variant.possible_scope_id)],
        )
      : term.variants.map((variant) => resolveApplicability(provider, variant.applicability_id));
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
