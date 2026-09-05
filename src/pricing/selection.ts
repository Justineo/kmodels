import { canonicalJson, uniqueCanonicalValues } from "../catalog/canonical-value.ts";
import {
  applicabilityContainedIn,
  unionApplicabilities,
  unconditionalApplicability,
} from "../catalog/pricing-canonical.ts";
import { evaluateApplicability } from "../catalog/pricing-presentation.ts";
import { publishedValidityStatus } from "../catalog/pricing-time.ts";
import {
  addRationals,
  divideRationals,
  compareRationals,
  rationalFromDecimal,
  rationalToFiniteDecimal,
} from "../catalog/pricing-rational.ts";
import type {
  PriceApplicability,
  PriceCondition,
  PriceDimension,
  PublishedValidity,
  Rational,
  UsageSignal,
} from "../catalog/pricing-schema.ts";
import type { Selector } from "./schema.ts";
import { PricingError } from "./errors.ts";

const maximumApplicabilityCells = 4096;
const nonPricingFields = new Set(["evidence", "applicability", "validity", "selector_sources"]);

export interface Qualified {
  applicability: PriceApplicability;
  validity?: PublishedValidity | undefined;
}

export type GapCode =
  | "missing_selector"
  | "missing_quantity"
  | "unbound_charge"
  | "unsupported_structure"
  | "conflicting_variants"
  | "unresolved_validity"
  | "historical_evidence_missing"
  | "missing_related_component"
  | "unsupported_aggregation"
  | "unknown_price"
  | "outside_validity";

export interface Gap {
  code: GapCode;
  componentId?: string;
  offerRef: string;
  termRef?: string;
  dimensions?: PriceDimension[];
  alternatives?: UsageSignal[][];
  relatedOfferRef?: string;
  reason?: string;
}

interface VariantSelection<T> {
  variant?: T;
  gap?: "missing_selector" | "conflicting_variants";
  dimensions: PriceDimension[];
}

export function validateSelectors(
  selectors: readonly Selector[],
  scopes: readonly PriceApplicability[],
): void {
  const suppliedDimensions = new Set<string>();
  const conditions = scopes.flatMap((scope) => scope.any_of.flatMap((clause) => clause.all_of));
  for (const selector of selectors) {
    const dimensionKey = canonicalJson(selector.dimension);
    if (suppliedDimensions.has(dimensionKey)) {
      throw new PricingError("DUPLICATE_SELECTOR", "Selectors repeat a dimension");
    }
    suppliedDimensions.add(dimensionKey);
    for (const condition of conditions) {
      if (canonicalJson(condition.dimension) !== dimensionKey) continue;
      if (!selectorMatchesConditionType(selector, condition)) {
        throw new PricingError(
          "INVALID_REQUEST",
          "Selector kind or unit conflicts with its dimension",
        );
      }
    }
  }
}

function selectorMatchesConditionType(selector: Selector, condition: PriceCondition): boolean {
  if (condition.kind !== "decimal_range") return selector.kind === condition.kind;
  return (
    selector.kind === "decimal" && canonicalJson(condition.unit) === canonicalJson(selector.unit)
  );
}

export function selectVariants<T extends Qualified>(
  variants: readonly T[],
  selectors: readonly Selector[],
  semantics: (variant: T) => unknown,
  offerScope: PriceApplicability = unconditionalApplicability,
): VariantSelection<T> {
  const possibleVariants = variants.filter(
    (variant) => evaluateApplicability(variant.applicability, selectors).state !== "false",
  );
  const representative = possibleVariants[0];
  if (representative === undefined) return { dimensions: [] };

  const matchedVariants = possibleVariants.filter(
    (variant) => evaluateApplicability(variant.applicability, selectors).state === "true",
  );
  const representativeSemantics = canonicalJson(semantics(representative));
  const haveSameSemantics = possibleVariants.every(
    (variant) => canonicalJson(semantics(variant)) === representativeSemantics,
  );
  if (haveSameSemantics && matchedVariants[0] !== undefined)
    return { variant: matchedVariants[0], dimensions: [] };

  const missingDimensions = uniqueCanonicalValues(
    possibleVariants.flatMap(
      (variant) => evaluateApplicability(variant.applicability, selectors).missing_dimensions,
    ),
  );
  if (!haveSameSemantics) {
    return {
      gap: matchedVariants.length > 1 ? "conflicting_variants" : "missing_selector",
      dimensions: missingDimensions,
    };
  }

  const remainingOfferScope = remainingScope(offerScope, selectors);
  const remainingVariantScopes: PriceApplicability[] = [];
  for (const variant of possibleVariants) {
    const scope = remainingScope(variant.applicability, selectors);
    if (scope !== undefined) remainingVariantScopes.push(scope);
  }
  if (
    remainingOfferScope !== undefined &&
    variantsCoverScope(remainingOfferScope, remainingVariantScopes)
  ) {
    return { variant: representative, dimensions: [] };
  }
  return { gap: "missing_selector", dimensions: missingDimensions };
}

function remainingScope(
  scope: PriceApplicability,
  selectors: readonly Selector[],
): PriceApplicability | undefined {
  const remainingClauses: PriceApplicability["any_of"] = [];
  for (const clause of scope.any_of) {
    if (evaluateApplicability({ any_of: [clause] }, selectors).state === "false") continue;
    const missingConditions = clause.all_of.filter(
      (condition) =>
        evaluateApplicability({ any_of: [{ all_of: [condition] }] }, selectors).state === "missing",
    );
    remainingClauses.push({ all_of: missingConditions });
  }
  return remainingClauses.length === 0 ? undefined : { any_of: remainingClauses };
}

function variantsCoverScope(target: PriceApplicability, variants: PriceApplicability[]): boolean {
  if (variants.length === 0) return false;
  if (applicabilityContainedIn(target, unionApplicabilities(variants))) return true;
  const cells = applicabilityCells([target, ...variants]);
  if (cells === undefined) return false;
  return cells.every((selectors) => {
    if (evaluateApplicability(target, selectors).state !== "true") return true;
    return variants.some((scope) => evaluateApplicability(scope, selectors).state === "true");
  });
}

function applicabilityCells(scopes: PriceApplicability[]): Selector[][] | undefined {
  let cells: Selector[][] = [[]];
  for (const conditions of groupConditionsByDimension(scopes).values()) {
    const choices = conditionCellChoices(conditions);
    if (choices === undefined || cells.length * choices.length > maximumApplicabilityCells)
      return undefined;
    cells = cells.flatMap((cell) => choices.map((choice) => [...cell, choice]));
  }
  return cells;
}

function groupConditionsByDimension(scopes: PriceApplicability[]): Map<string, PriceCondition[]> {
  const groups = new Map<string, PriceCondition[]>();
  for (const scope of scopes) {
    for (const clause of scope.any_of) {
      for (const condition of clause.all_of) {
        const dimensionKey = canonicalJson(condition.dimension);
        const group = groups.get(dimensionKey) ?? [];
        group.push(condition);
        groups.set(dimensionKey, group);
      }
    }
  }
  return groups;
}

function conditionCellChoices(conditions: PriceCondition[]): Selector[] | undefined {
  const first = conditions[0];
  if (first === undefined) return [];
  const dimension = first.dimension;
  switch (first.kind) {
    case "boolean":
      return [
        { kind: "boolean", dimension, value: false },
        { kind: "boolean", dimension, value: true },
      ];
    case "categorical":
      return categoricalCellChoices(dimension, conditions);
    case "decimal_range":
      return decimalCellChoices(first, conditions);
  }
}

function categoricalCellChoices(
  dimension: PriceDimension,
  conditions: PriceCondition[],
): Selector[] {
  const values = uniqueCanonicalValues(
    conditions.flatMap((condition) => (condition.kind === "categorical" ? condition.values : [])),
  );
  const choices: Selector[] = values.map((value) => ({ kind: "categorical", dimension, value }));
  let unlistedValue = "__unlisted__";
  while (values.some((value) => value.value === unlistedValue)) unlistedValue += "_";
  choices.push({
    kind: "categorical",
    dimension,
    value: { namespace: "kmodels", value: unlistedValue },
  });
  return choices;
}

function decimalCellChoices(
  first: Extract<PriceCondition, { kind: "decimal_range" }>,
  conditions: PriceCondition[],
): Selector[] | undefined {
  const boundaries = decimalBoundaries(conditions);
  const choices: Selector[] = [];
  for (const [index, boundary] of boundaries.entries()) {
    const nextBoundary = boundaries[index + 1];
    const intervalPoint =
      nextBoundary === undefined
        ? addRationals(boundary, { numerator: "1", denominator: "1" })
        : divideRationals(addRationals(boundary, nextBoundary), {
            numerator: "2",
            denominator: "1",
          });
    for (const point of [boundary, intervalPoint]) {
      const decimal = rationalToFiniteDecimal(point);
      if (decimal === undefined) return undefined;
      choices.push({
        kind: "decimal",
        dimension: first.dimension,
        unit: first.unit,
        value: decimal,
      });
    }
  }
  return choices;
}

function decimalBoundaries(conditions: PriceCondition[]): Rational[] {
  const boundaries: Rational[] = [{ numerator: "0", denominator: "1" }];
  for (const condition of conditions) {
    if (condition.kind !== "decimal_range") continue;
    if (condition.lower !== undefined) boundaries.push(rationalFromDecimal(condition.lower.value));
    if (condition.upper !== undefined) boundaries.push(rationalFromDecimal(condition.upper.value));
  }
  return uniqueCanonicalValues(boundaries).sort(compareRationals);
}

export function validityGap(
  variant: Qualified,
  evaluatedAt: string,
  observedAt: string,
): GapCode | undefined {
  const status = publishedValidityStatus(variant.validity, evaluatedAt);
  if (status === "expired" || status === "upcoming") return "outside_validity";
  if (status === "unresolved") return "unresolved_validity";
  const observationStatus = publishedValidityStatus(
    { from: { value: observedAt, precision: "datetime" } },
    evaluatedAt,
  );
  if (observationStatus === "upcoming" && variant.validity?.from?.precision !== "datetime")
    return "historical_evidence_missing";
  return undefined;
}

export function pricingSemantics(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(pricingSemantics);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !nonPricingFields.has(key))
      .map(([key, child]) => [key, pricingSemantics(child)]),
  );
}
