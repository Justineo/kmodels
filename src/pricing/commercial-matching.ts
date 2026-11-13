import { canonicalJson, uniqueCanonicalValues } from "../catalog/canonical-value.ts";
import { evaluateApplicability, type PricingSelection } from "../catalog/pricing-applicability.ts";
import {
  applicabilitiesOverlap,
  applicabilityContainedIn,
  canonicalizeApplicability,
  clauseContainedIn,
  unconditionalApplicability,
} from "../catalog/pricing-canonical.ts";
import type { CommercialChoice, PriceApplicability } from "../catalog/pricing-schema.ts";
import type { InferenceMatchOffer } from "./inference-matching-schema.ts";
import { PricingError } from "./errors.ts";
import { validityGap } from "./selection.ts";
import { pricingLimits } from "../catalog/pricing-constants.ts";

type SelectionClaim = NonNullable<InferenceMatchOffer["selection"]>[number];
const claimIndexes = new WeakMap<
  SelectionClaim[],
  Map<CommercialChoice["dimension"], SelectionClaim[]>
>();
const declaredChoices = new WeakMap<
  SelectionClaim[],
  Omit<AvailableCommercialChoice, "offer_refs">[]
>();

/** Static vocabulary of an immutable selection graph; applicability remains query-specific. */
export function declaredCommercialChoices(
  selection: InferenceMatchOffer["selection"],
): readonly Omit<AvailableCommercialChoice, "offer_refs">[] {
  if (selection === undefined) return [];
  const cached = declaredChoices.get(selection);
  if (cached !== undefined) return cached;
  const choices = uniqueCanonicalValues(
    selection.flatMap((claim) =>
      claim.alternatives.map(({ value }) => ({ dimension: claim.dimension, value })),
    ),
  ).map((choice) => {
    const targets = [
      ...new Set(
        selection.flatMap((claim) =>
          claim.dimension === choice.dimension &&
          claim.target !== undefined &&
          claim.alternatives.some(
            ({ value }) => canonicalJson(value) === canonicalJson(choice.value),
          )
            ? [claim.target]
            : [],
        ),
      ),
    ];
    return { ...choice, ...(targets.length ? { targets } : {}) };
  });
  declaredChoices.set(selection, choices);
  return choices;
}

function indexedClaims(
  offer: InferenceMatchOffer,
  dimension: CommercialChoice["dimension"],
): SelectionClaim[] {
  const selection = offer.selection;
  if (selection === undefined) return [];
  let index = claimIndexes.get(selection);
  if (index === undefined) {
    index = new Map();
    claimIndexes.set(selection, index);
  }
  const cached = index.get(dimension);
  if (cached !== undefined) return cached;
  const groups = new Map<string, [SelectionClaim, ...SelectionClaim[]]>();
  for (const claim of selection) {
    if (claim.dimension !== dimension) continue;
    const key = canonicalJson({
      coverage: claim.coverage,
      alternatives: claim.alternatives,
      ...(claim.validity === undefined ? {} : { validity: claim.validity }),
      ...(claim.excluded_values === undefined ? {} : { excluded_values: claim.excluded_values }),
    });
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [claim]);
    else group.push(claim);
  }
  const claims = [...groups.values()].flatMap((group) => {
    const any_of = group.flatMap(({ applicability }) => applicability.any_of);
    if (group.length === 1 || any_of.length > pricingLimits.applicabilityClauses) return group;
    const normalized = canonicalizeApplicability({ any_of });
    // A OR (A AND B) adds no scope. Remove subsumed clauses before interactive evaluation.
    const retained: PriceApplicability["any_of"] = [];
    for (const clause of [...normalized.any_of].sort((a, b) => a.all_of.length - b.all_of.length)) {
      if (!retained.some((other) => clauseContainedIn(clause.all_of, other.all_of)))
        retained.push(clause);
    }
    return [
      {
        ...group[0],
        applicability: { any_of: normalized.any_of.filter((clause) => retained.includes(clause)) },
      },
    ];
  });
  index.set(dimension, claims);
  return claims;
}

export function intersectCommercialScope(
  left: PriceApplicability,
  right: PriceApplicability,
): PriceApplicability | undefined {
  if (left.any_of.some(({ all_of }) => all_of.length === 0)) return right;
  if (right.any_of.some(({ all_of }) => all_of.length === 0)) return left;
  if (applicabilityContainedIn(left, right)) return left;
  if (applicabilityContainedIn(right, left)) return right;
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
  targets?: ("book" | "offer" | "condition")[];
}

/** Automatic choices must preserve every possible price context, including other request modes. */
export function commercialBranchesCoverScopes(
  scopes: Iterable<PriceApplicability>,
  current: readonly CommercialBranch[],
  proposed: readonly CommercialBranch[],
): boolean {
  const prices = [...scopes];
  let hasContext = false;
  for (const branch of current) {
    const remaining = (scope: PriceApplicability): PriceApplicability => ({
      any_of: scope.any_of.flatMap((clause) =>
        evaluateApplicability({ any_of: [clause] }, branch.selectors).state === "false"
          ? []
          : [
              {
                all_of: clause.all_of.filter(
                  (condition) =>
                    evaluateApplicability({ any_of: [{ all_of: [condition] }] }, branch.selectors)
                      .state !== "true",
                ),
              },
            ],
      ),
    });
    const coverage = remaining({ any_of: proposed.flatMap(({ scope }) => scope.any_of) });
    for (const price of prices) {
      const scope = intersectCommercialScope(price, branch.scope);
      if (scope === undefined) continue;
      const context = remaining(scope);
      if (context.any_of.length === 0) continue;
      hasContext = true;
      if (!applicabilityContainedIn(context, coverage)) return false;
    }
  }
  return hasContext;
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
    const claims = indexedClaims(offer, choice.dimension);
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
    const grouped = new Map<string, [CommercialBranch, ...CommercialBranch[]]>();
    for (const branch of next) {
      const key = canonicalJson(uniqueCanonicalValues(branch.selectors));
      const previous = grouped.get(key);
      if (previous === undefined) grouped.set(key, [branch]);
      else previous.push(branch);
    }
    // Normalize each union once, rather than reprocessing its growing prefix for every claim.
    branches = [...grouped.values()].map((group) => {
      const first = group[0];
      return group.length === 1
        ? first
        : {
            selectors: first.selectors,
            scope: canonicalizeApplicability({
              any_of: uniqueCanonicalValues(group.flatMap(({ scope }) => scope.any_of)),
            }),
          };
    });
  }
  return { branches, unresolved: uniqueCanonicalValues(unresolved) };
}
