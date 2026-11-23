import { canonicalJson, uniqueCanonicalValues } from "./canonical-value.ts";
import {
  applicabilitiesOverlap,
  canonicalizeApplicability,
  clauseContainedIn,
  unconditionalApplicability,
} from "./pricing-canonical.ts";
import { pricingLimits } from "./pricing-constants.ts";
import type {
  CommercialSelection,
  PriceApplicability,
  PriceCategoricalValue,
  PriceCondition,
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
        request.some((evidence) => evidence.length > 0) &&
        realtime.every((evidence) => evidence.length === 0)
      ) {
        modes = ["request"];
        coverage = "complete";
        executionEvidence = request.flat().slice(0, 1);
      }
      if (
        rates.length > 0 &&
        realtime.some((evidence) => evidence.length > 0) &&
        request.every((evidence) => evidence.length === 0)
      ) {
        modes = ["realtime"];
        coverage = "complete";
        executionEvidence = realtime.flat().slice(0, 1);
      }
      // A surviving owned contract establishes this source context even when sibling rates
      // lack quantity acquisition. Conflicting mechanisms and no positive evidence stay partial.
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
          const matchedObservations = evidence.filter((observation) =>
            applicabilitiesOverlap(observation.establishes_applicability, { any_of: [clause] }),
          );
          result.push({
            dimension,
            coverage: "complete",
            applicability: { any_of: [clause] },
            ...(variant.validity === undefined ? {} : { validity: variant.validity }),
            observations: matchedObservations.length > 0 ? matchedObservations : evidence,
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
  return compactCommercialSelections(result);
}

type Clause = PriceApplicability["any_of"][number];

function factorCategoricalClauses(clauses: readonly Clause[]): Clause[] {
  let current = [...clauses];
  const dimensionKeys = uniqueCanonicalValues(
    current.flatMap((clause) =>
      clause.all_of
        .filter((condition) => condition.kind === "categorical")
        .map((condition) => condition.dimension),
    ),
  );
  // Factor `region` first so geographic unions stay intact before cross-dimension factoring.
  dimensionKeys.sort((left, right) => {
    const leftRegion = left.namespace === "kmodels" && left.value === "region" ? 0 : 1;
    const rightRegion = right.namespace === "kmodels" && right.value === "region" ? 0 : 1;
    return leftRegion - rightRegion;
  });
  for (const dimension of dimensionKeys) {
    const dimKey = canonicalJson(dimension);
    const groups = new Map<
      string,
      {
        rest: PriceCondition[];
        values: PriceCategoricalValue[];
        clauses: Clause[];
      }
    >();
    const untouched: Clause[] = [];
    for (const clause of current) {
      const targetIndex = clause.all_of.findIndex(
        (condition) =>
          condition.kind === "categorical" && canonicalJson(condition.dimension) === dimKey,
      );
      if (targetIndex === -1) {
        untouched.push(clause);
        continue;
      }
      const target = clause.all_of[targetIndex];
      if (target?.kind !== "categorical") {
        untouched.push(clause);
        continue;
      }
      const rest = clause.all_of.filter((_, index) => index !== targetIndex);
      const restKey = canonicalJson(rest);
      const group = groups.get(restKey) ?? { rest, values: [], clauses: [] };
      group.values.push(...target.values);
      group.clauses.push(clause);
      groups.set(restKey, group);
    }
    const next: Clause[] = [...untouched];
    for (const group of groups.values()) {
      if (group.clauses.length === 1) {
        next.push(...group.clauses);
        continue;
      }
      const mergedValues = uniqueCanonicalValues(group.values);
      if (mergedValues.length > pricingLimits.categoricalValuesPerCondition) {
        next.push(...group.clauses);
        continue;
      }
      const canonical = canonicalizeApplicability({
        any_of: [
          {
            all_of: [
              ...group.rest,
              {
                kind: "categorical",
                dimension,
                values: mergedValues,
              },
            ],
          },
        ],
      });
      next.push(...canonical.any_of);
    }
    current = next;
  }
  return current;
}

function splitApplicabilityClauses(clauses: readonly Clause[]): PriceApplicability[] {
  const result: PriceApplicability[] = [];
  let bucket: Clause[] = [];
  let bucketBytes = 12;
  for (const clause of clauses) {
    const clauseBytes = Buffer.byteLength(JSON.stringify(clause)) + 1;
    if (
      bucket.length > 0 &&
      (bucket.length >= pricingLimits.applicabilityClauses ||
        bucketBytes + clauseBytes > pricingLimits.applicabilityBytes)
    ) {
      result.push(canonicalizeApplicability({ any_of: bucket }));
      bucket = [];
      bucketBytes = 12;
    }
    bucket.push(clause);
    bucketBytes += clauseBytes;
  }
  if (bucket.length > 0) result.push(canonicalizeApplicability({ any_of: bucket }));
  return result;
}

export function compactCommercialSelections(
  input: readonly CommercialSelection[],
): CommercialSelection[] {
  const groups = new Map<
    string,
    {
      template: Omit<CommercialSelection, "applicability" | "observations">;
      clauses: Clause[];
      observations: RawPriceObservation[];
    }
  >();
  for (const rawClaim of input) {
    const applicability = canonicalizeApplicability(rawClaim.applicability);
    const alternatives = rawClaim.alternatives.map((alternative) => ({
      ...alternative,
      applicability: canonicalizeApplicability(alternative.applicability),
    }));
    const template: Omit<CommercialSelection, "applicability" | "observations"> = {
      dimension: rawClaim.dimension,
      ...(rawClaim.target === undefined ? {} : { target: rawClaim.target }),
      coverage: rawClaim.coverage,
      ...(rawClaim.excluded_values === undefined
        ? {}
        : { excluded_values: rawClaim.excluded_values }),
      ...(rawClaim.validity === undefined ? {} : { validity: rawClaim.validity }),
      alternatives,
    };
    const key = canonicalJson(template);
    const group = groups.get(key) ?? { template, clauses: [], observations: [] };
    group.clauses.push(...applicability.any_of);
    for (const { source_ref, locator, raw } of rawClaim.observations) {
      group.observations.push({ source_ref, locator, raw });
    }
    groups.set(key, group);
  }
  const compacted: CommercialSelection[] = [];
  for (const group of groups.values()) {
    const uniqueClauses = uniqueCanonicalValues(group.clauses);
    const factored = factorCategoricalClauses(uniqueClauses);
    const retained: Clause[] = [];
    for (const clause of [...factored].sort((a, b) => a.all_of.length - b.all_of.length)) {
      if (!retained.some((other) => clauseContainedIn(clause.all_of, other.all_of))) {
        retained.push(clause);
      }
    }
    const uniqueObservations = uniqueCanonicalValues(group.observations);
    for (const applicability of splitApplicabilityClauses(retained)) {
      compacted.push({
        ...group.template,
        applicability,
        observations: uniqueObservations,
      });
    }
  }
  return uniqueCanonicalValues(compacted);
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
