import { canonicalJson, uniqueCanonicalValues } from "./canonical-value.ts";
import {
  applicabilitiesOverlap,
  canonicalizeApplicability,
  unconditionalApplicability,
} from "./pricing-canonical.ts";
import type {
  CommercialSelection,
  PriceCategoricalValue,
  PricingOffer,
  PricingScope,
  RawPriceObservation,
} from "./pricing-schema.ts";
import type { ProviderPricingPartition } from "./pricing-assembly.ts";
import type { CommercialDimension } from "../pricing/commercial-vocabulary.ts";

export type Execution = "request" | "batch" | "realtime";
export interface CommercialSelectionPolicy {
  /** Adapter-owned tariff contracts. Accounting locators refer to bindings on these exact rates. */
  offers: Readonly<
    Record<
      string,
      readonly Execution[] | { request: readonly string[]; realtime: readonly string[] }
    >
  >;
  values: Partial<Record<CommercialDimension, readonly string[]>>;
  aliases?: Partial<Record<CommercialDimension, Readonly<Record<string, string>>>>;
  not_applicable?: Readonly<Record<string, readonly CommercialDimension[]>>;
  excluded_execution?: Readonly<Record<string, readonly Execution[]>>;
}
function observations(offer: PricingOffer): RawPriceObservation[] {
  return uniqueCanonicalValues(
    offer.terms
      .flatMap((term) =>
        (term.kind === "raw" ? term.variants : [...term.variants, ...term.raw_variants]).flatMap(
          (variant) => variant.observations,
        ),
      )
      .map(({ source_ref, locator, raw }) => ({ source_ref, locator, raw })),
  );
}

/** Claims are projected from owned contracts and native price predicates, never model capabilities. */
export function commercialSelection(
  offer: PricingOffer,
  scope: PricingScope,
  policy?: CommercialSelectionPolicy,
): CommercialSelection[] {
  const evidence = observations(offer);
  if (evidence.length === 0) evidence.push(...offer.states.flatMap((state) => state.observations));
  if (evidence.length === 0) return [];
  const base = { applicability: unconditionalApplicability, observations: evidence.slice(0, 1) };
  const fixed = (
    dimension: CommercialDimension,
    value: PriceCategoricalValue,
  ): CommercialSelection => ({
    ...base,
    dimension,
    coverage: "complete",
    alternatives: [{ value, applicability: unconditionalApplicability }],
  });
  const result: CommercialSelection[] = [fixed("billing_mode", offer.billing_mode)];
  if (scope.kind === "provider_resource") {
    result.push(fixed("resource_kind", scope.resource_kind));
    result.push({ ...base, dimension: "execution", coverage: "not_applicable", alternatives: [] });
  } else {
    const contract = policy?.offers[offer.offer_key];
    let modes: readonly Execution[] = [];
    let coverage: CommercialSelection["coverage"] = "partial";
    let executionEvidence = base.observations;
    if (contract !== undefined && "request" in contract) {
      const rates: RawPriceObservation[][] = offer.terms.flatMap((term) =>
        term.kind === "rate"
          ? term.variants.map(({ charge_binding }) => charge_binding?.observations ?? [])
          : [],
      );
      const matches = (bindings: RawPriceObservation[], prefixes: readonly string[]) =>
        bindings.filter(
          ({ locator }) =>
            locator.kind === "provider_key" &&
            prefixes.some((prefix) => locator.value.startsWith(prefix)),
        );
      const request = rates.map((observations) => matches(observations, contract.request));
      const realtime = rates.map((observations) => matches(observations, contract.realtime));
      if (
        rates.length > 0 &&
        request.every((evidence) => evidence.length > 0) &&
        realtime.every((evidence) => evidence.length === 0)
      ) {
        modes = ["request"];
        coverage = "complete";
        executionEvidence = request.flat().slice(0, 1);
      }
      if (
        rates.length > 0 &&
        realtime.every((evidence) => evidence.length > 0) &&
        request.every((evidence) => evidence.length === 0)
      ) {
        modes = ["realtime"];
        coverage = "complete";
        executionEvidence = realtime.flat().slice(0, 1);
      }
      // Mixed acquisition paths do not prove a shared tariff for both mechanisms.
    } else if (contract !== undefined) {
      modes = contract;
      coverage = "complete";
    }
    const excluded = policy?.excluded_execution?.[offer.offer_key];
    result.push({
      ...base,
      observations: executionEvidence,
      dimension: "execution",
      coverage,
      ...(excluded === undefined
        ? {}
        : {
            excluded_values: excluded.map((value) => ({
              namespace: "kmodels" as const,
              value,
            })),
          }),
      alternatives: modes.map((value) => ({
        value: { namespace: "kmodels", value },
        applicability: unconditionalApplicability,
      })),
    });
  }
  // Each native clause remains intact. Normalizing a value never creates new combinations.
  for (const term of offer.terms) {
    if (term.kind === "raw") continue;
    for (const variant of term.variants) {
      const evidence = variant.observations;
      for (const clause of variant.applicability.any_of) {
        for (const condition of clause.all_of) {
          if (condition.kind !== "categorical" || condition.dimension.namespace !== "kmodels")
            continue;
          const dimension = condition.dimension.value;
          if (
            dimension !== "service_tier" &&
            dimension !== "requested_service_tier" &&
            dimension !== "served_service_tier" &&
            dimension !== "speed"
          )
            continue;
          result.push({
            dimension,
            coverage: "complete",
            applicability: { any_of: [clause] },
            ...(variant.validity === undefined ? {} : { validity: variant.validity }),
            observations: evidence.filter((observation) =>
              applicabilitiesOverlap(observation.establishes_applicability, { any_of: [clause] }),
            ),
            alternatives: condition.values.map((value) => ({
              value:
                policy?.aliases?.[dimension]?.[value.value] !== undefined ||
                policy?.values[dimension]?.includes(value.value)
                  ? {
                      namespace: "kmodels",
                      value: policy?.aliases?.[dimension]?.[value.value] ?? value.value,
                    }
                  : value,
              applicability: { any_of: [{ all_of: [{ ...condition, values: [value] }] }] },
            })),
          });
        }
      }
    }
  }
  if (scope.kind === "models")
    for (const dimension of policy?.not_applicable?.[offer.offer_key] ?? []) {
      if (!result.some((claim) => claim.dimension === dimension))
        result.push({ ...base, dimension, coverage: "not_applicable", alternatives: [] });
    }
  const claims = new Map<string, CommercialSelection>();
  for (const input of result) {
    const claim = {
      ...input,
      applicability: canonicalizeApplicability(input.applicability),
      alternatives: input.alternatives.map((alternative) => ({
        ...alternative,
        applicability: canonicalizeApplicability(alternative.applicability),
      })),
    };
    const { observations: _observations, ...scope } = claim;
    const key = canonicalJson(scope);
    if (!claims.has(key))
      claims.set(key, {
        ...claim,
        observations: claim.observations.map(({ source_ref, locator, raw }) => ({
          source_ref,
          locator,
          raw,
        })),
      });
  }
  return uniqueCanonicalValues([...claims.values()]);
}

export function applyCommercialSelections(
  input: ProviderPricingPartition,
  policy?: CommercialSelectionPolicy,
): ProviderPricingPartition {
  return {
    ...input,
    books: input.books.map((book) => ({
      ...book,
      offers: book.offers.map((offer) => ({
        ...offer,
        selection: commercialSelection(offer, book.scope, policy),
      })),
    })),
  };
}
