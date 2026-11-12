import { canonicalJson, uniqueCanonicalValues } from "../catalog/canonical-value.ts";
import { evaluateApplicability, type PricingSelection } from "../catalog/pricing-applicability.ts";
import {
  applicabilitiesOverlap,
  canonicalizeApplicability,
  unconditionalApplicability,
} from "../catalog/pricing-canonical.ts";
import type { CommercialChoice, PriceApplicability } from "../catalog/pricing-schema.ts";
import type { InferenceMatchOffer } from "./inference-matching-schema.ts";
import { PricingError } from "./errors.ts";
import { validityGap } from "./selection.ts";

export function intersectCommercialScope(
  left: PriceApplicability,
  right: PriceApplicability,
): PriceApplicability | undefined {
  if (left.any_of.some(({ all_of }) => all_of.length === 0)) return right;
  if (right.any_of.some(({ all_of }) => all_of.length === 0)) return left;
  if (!applicabilitiesOverlap(left, right)) return;
  return canonicalizeApplicability({
    any_of: uniqueCanonicalValues(
      left.any_of.flatMap((a) =>
        right.any_of
          .filter((b) => applicabilitiesOverlap({ any_of: [a] }, { any_of: [b] }))
          .map((b) => ({ all_of: uniqueCanonicalValues([...a.all_of, ...b.all_of]) })),
      ),
    ),
  });
}

export interface CommercialBranch {
  selectors: PricingSelection[];
  scope: PriceApplicability;
}
export interface UnresolvedCommercialChoice {
  offer_ref: string;
  dimension: CommercialChoice["dimension"];
  reason: "unreviewed" | "partial" | "validity";
}
export interface AvailableCommercialChoice extends CommercialChoice {
  offer_refs: string[];
}

/** Bind exact native predicates while retaining the complete correlated scope of every claim. */
export function resolveCommercialChoices(
  offer: InferenceMatchOffer,
  supplied: readonly PricingSelection[],
  choices: readonly CommercialChoice[],
  evaluatedAt: string,
  observedAt: string,
): { branches: CommercialBranch[]; unresolved: UnresolvedCommercialChoice[] } {
  let branches: CommercialBranch[] = [
    { selectors: [...supplied], scope: unconditionalApplicability },
  ];
  const unresolved: UnresolvedCommercialChoice[] = [];
  for (const choice of choices) {
    if (branches.length === 0) break;
    const claims = (offer.selection ?? []).filter(
      ({ dimension }) => dimension === choice.dimension,
    );
    if (claims.length === 0)
      unresolved.push({ offer_ref: offer.id, dimension: choice.dimension, reason: "unreviewed" });
    const next: CommercialBranch[] = [];
    for (const branch of branches)
      for (const claim of claims) {
        if (evaluateApplicability(claim.applicability, branch.selectors).state === "false")
          continue;
        const gap = validityGap(claim, evaluatedAt, observedAt);
        if (gap !== undefined) {
          if (gap !== "outside_validity")
            unresolved.push({
              offer_ref: offer.id,
              dimension: choice.dimension,
              reason: "validity",
            });
          continue;
        }
        if (
          claim.excluded_values?.some(
            (value) => canonicalJson(value) === canonicalJson(choice.value),
          )
        )
          continue;
        if (claim.coverage === "partial")
          unresolved.push({ offer_ref: offer.id, dimension: choice.dimension, reason: "partial" });
        for (const alternative of claim.alternatives) {
          if (canonicalJson(alternative.value) !== canonicalJson(choice.value)) continue;
          const claimScope = intersectCommercialScope(
            claim.applicability,
            alternative.applicability,
          );
          const scope = claimScope && intersectCommercialScope(branch.scope, claimScope);
          if (scope === undefined) continue;
          for (const clause of alternative.applicability.any_of) {
            const selectors = new Map(
              branch.selectors.map((selector) => [canonicalJson(selector.dimension), selector]),
            );
            const exactScope = intersectCommercialScope(scope, { any_of: [clause] });
            if (exactScope === undefined) continue;
            if (evaluateApplicability(exactScope, [...selectors.values()]).state === "false")
              continue;
            for (const condition of clause.all_of) {
              const key = canonicalJson(condition.dimension);
              if (selectors.has(key)) continue;
              if (
                condition.kind === "categorical" &&
                condition.values.length === 1 &&
                condition.values[0]
              )
                selectors.set(key, {
                  dimension: condition.dimension,
                  kind: "categorical",
                  value: condition.values[0],
                });
              if (condition.kind === "boolean")
                selectors.set(key, {
                  dimension: condition.dimension,
                  kind: "boolean",
                  value: condition.value,
                });
            }
            next.push({ selectors: [...selectors.values()], scope: exactScope });
            if (next.length > 4096)
              throw new PricingError(
                "INVALID_REQUEST",
                "Commercial selection exceeds the supported scope limit",
              );
          }
        }
      }
    const grouped = new Map<string, CommercialBranch>();
    for (const branch of next) {
      const key = canonicalJson(uniqueCanonicalValues(branch.selectors));
      const previous = grouped.get(key);
      if (previous === undefined) grouped.set(key, branch);
      else
        previous.scope = canonicalizeApplicability({
          any_of: uniqueCanonicalValues([...previous.scope.any_of, ...branch.scope.any_of]),
        });
    }
    branches = [...grouped.values()];
  }
  return { branches, unresolved: uniqueCanonicalValues(unresolved) };
}
