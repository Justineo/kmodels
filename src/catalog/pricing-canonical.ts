import {
  canonicalJsonFromValidated,
  canonicalJsonKey as canonicalKey,
  compareUtf8,
} from "./canonical-value.ts";
import { pricingLimits } from "./pricing-constants.ts";
import { compareRationals, rationalFromDecimal } from "./pricing-rational.ts";
import {
  type PriceApplicability,
  type PriceCategoricalValue,
  type PriceCondition,
  type PriceDimension,
  type UnitExpression,
} from "./pricing-schema.ts";

export const unconditionalApplicability: PriceApplicability = {
  any_of: [{ all_of: [] }],
};

const exactClauseIndexes = new WeakMap<PriceApplicability, ReadonlySet<string>>();
const overlapResults = new WeakMap<PriceApplicability, WeakMap<PriceApplicability, boolean>>();
const containmentResults = new WeakMap<PriceApplicability, WeakMap<PriceApplicability, boolean>>();
const conditionIndexes = new WeakMap<PriceCondition[], ReadonlyMap<string, PriceCondition>>();
const categoricalIndexes = new WeakMap<PriceCondition, ReadonlySet<string>>();

export function normalizeUnitExpression(expression: UnitExpression): UnitExpression {
  const factors = new Map<string, UnitExpression["factors"][number]>();
  for (const factor of expression.factors) {
    if (!Number.isSafeInteger(factor.power) || factor.power < 1)
      throw new Error("Unit factor power must be a positive safe integer");
    const key = canonicalKey(factor.unit);
    const previous = factors.get(key);
    const power = (previous?.power ?? 0) + factor.power;
    if (power > pricingLimits.unitFactorPower) throw new Error("Unit factor power limit exceeded");
    factors.set(key, { unit: factor.unit, power });
  }
  if (factors.size > pricingLimits.unitFactors) throw new Error("Unit factor limit exceeded");
  return {
    factors: [...factors.values()].sort((left, right) =>
      compareUtf8(canonicalKey(left.unit), canonicalKey(right.unit)),
    ),
  };
}

export function canonicalizeApplicability(value: PriceApplicability): PriceApplicability {
  const clauses = value.any_of.flatMap(({ all_of }) => {
    const conditions = normalizeClause(all_of);
    return conditions === undefined ? [] : [{ all_of: conditions }];
  });
  if (clauses.length === 0) throw new Error("Applicability has no satisfiable clause");
  if (clauses.length > pricingLimits.applicabilityClauses)
    throw new Error("Applicability clause limit exceeded");
  return {
    any_of: uniqueByCanonicalBytes(
      clauses.sort((left, right) => compareUtf8(canonicalKey(left), canonicalKey(right))),
    ),
  };
}

export function unionApplicabilities(values: PriceApplicability[]): PriceApplicability {
  return canonicalizeApplicability({
    any_of: values.flatMap(({ any_of }) => any_of),
  });
}

export function applicabilitiesOverlap(
  left: PriceApplicability,
  right: PriceApplicability,
): boolean {
  const cached = overlapResults.get(left)?.get(right);
  if (cached !== undefined) return cached;
  const result = left.any_of.some((leftClause) =>
    right.any_of.some((rightClause) => clausesOverlap(leftClause.all_of, rightClause.all_of)),
  );
  cacheRelation(overlapResults, left, right, result);
  cacheRelation(overlapResults, right, left, result);
  return result;
}

export function applicabilityContainedIn(
  child: PriceApplicability,
  parent: PriceApplicability,
): boolean {
  const cached = containmentResults.get(child)?.get(parent);
  if (cached !== undefined) return cached;
  const exactParentClauses = exactClauseIndex(parent);
  const result = child.any_of.every(
    (childClause) =>
      exactParentClauses.has(canonicalKey(childClause)) ||
      parent.any_of.some((parentClause) =>
        clauseContainedIn(childClause.all_of, parentClause.all_of),
      ),
  );
  cacheRelation(containmentResults, child, parent, result);
  return result;
}

function exactClauseIndex(value: PriceApplicability): ReadonlySet<string> {
  const current = exactClauseIndexes.get(value);
  if (current !== undefined) return current;
  const created = new Set(value.any_of.map(canonicalKey));
  exactClauseIndexes.set(value, created);
  return created;
}

export function selectorWeight(value: PriceApplicability): number {
  return value.any_of.reduce(
    (total, clause) =>
      total +
      1 +
      clause.all_of.reduce((weight, condition) => weight + conditionWeight(condition), 0),
    0,
  );
}

function normalizeClause(conditions: PriceCondition[]): PriceCondition[] | undefined {
  if (conditions.length > pricingLimits.conditionsPerClause)
    throw new Error("Condition-per-clause limit exceeded");

  const byDimension = new Map<string, PriceCondition>();
  for (const condition of conditions) {
    const normalized = normalizeCondition(condition);
    if (normalized === false) return undefined;
    if (normalized === undefined) continue;
    const key = canonicalKey(normalized.dimension);
    const previous = byDimension.get(key);
    const intersection =
      previous === undefined ? normalized : intersectConditions(previous, normalized);
    if (intersection === false) return undefined;
    if (intersection === undefined) byDimension.delete(key);
    else byDimension.set(key, intersection);
  }
  return [...byDimension.values()].sort(compareConditions);
}

function normalizeCondition(condition: PriceCondition): PriceCondition | false | undefined {
  if (condition.kind === "categorical") {
    if (condition.values.length > pricingLimits.categoricalValuesPerCondition)
      throw new Error("Categorical-value limit exceeded");
    const values = uniqueCategoricalValues(condition.dimension, condition.values);
    return values.length === 0 ? false : { ...condition, values };
  }
  if (condition.kind === "decimal_range") {
    const normalized = { ...condition, unit: normalizeUnitExpression(condition.unit) };
    if (normalized.lower === undefined && normalized.upper === undefined) return undefined;
    if (rangeIsEmpty(normalized)) return false;
    return normalized;
  }
  return condition;
}

function intersectConditions(
  left: PriceCondition,
  right: PriceCondition,
): PriceCondition | false | undefined {
  if (left.kind !== right.kind) throw new Error("One dimension uses incompatible predicate kinds");
  if (left.kind === "boolean" && right.kind === "boolean")
    return left.value === right.value ? left : false;
  if (left.kind === "categorical" && right.kind === "categorical") {
    const rightValues = new Set(right.values.map(categoricalKey));
    const values = left.values.filter((value) => rightValues.has(categoricalKey(value)));
    return values.length === 0 ? false : { ...left, values };
  }
  if (left.kind !== "decimal_range" || right.kind !== "decimal_range")
    throw new Error("Incompatible pricing predicates");
  if (canonicalKey(left.unit) !== canonicalKey(right.unit))
    throw new Error("One decimal dimension uses incompatible units");
  const result: PriceCondition = {
    kind: "decimal_range",
    dimension: left.dimension,
    unit: left.unit,
    ...optionalBound("lower", tighterLower(left.lower, right.lower)),
    ...optionalBound("upper", tighterUpper(left.upper, right.upper)),
  };
  return rangeIsEmpty(result) ? false : result;
}

function clausesOverlap(left: PriceCondition[], right: PriceCondition[]): boolean {
  const rightByDimension = conditionIndex(right);
  return left.every((condition) => {
    const other = rightByDimension.get(canonicalKey(condition.dimension));
    return other === undefined || predicatesOverlap(condition, other);
  });
}

function clauseContainedIn(child: PriceCondition[], parent: PriceCondition[]): boolean {
  const childByDimension = conditionIndex(child);
  return parent.every((condition) => {
    const childCondition = childByDimension.get(canonicalKey(condition.dimension));
    return childCondition !== undefined && predicateContainedIn(childCondition, condition);
  });
}

export function predicatesOverlap(left: PriceCondition, right: PriceCondition): boolean {
  if (left.kind !== right.kind) throw new Error("One dimension uses incompatible predicate kinds");
  if (left.kind === "boolean" && right.kind === "boolean") return left.value === right.value;
  if (left.kind === "categorical" && right.kind === "categorical") {
    const rightValues = categoricalIndex(right);
    return left.values.some((value) => rightValues.has(canonicalKey(value)));
  }
  if (left.kind !== "decimal_range" || right.kind !== "decimal_range")
    throw new Error("Incompatible pricing predicates");
  if (canonicalKey(left.unit) !== canonicalKey(right.unit))
    throw new Error("One decimal dimension uses incompatible units");
  return !rangesDisjoint(left, right);
}

export function predicateContainedIn(child: PriceCondition, parent: PriceCondition): boolean {
  if (child.kind !== parent.kind)
    throw new Error("One dimension uses incompatible predicate kinds");
  if (child.kind === "boolean" && parent.kind === "boolean") return child.value === parent.value;
  if (child.kind === "categorical" && parent.kind === "categorical") {
    const parentValues = categoricalIndex(parent);
    return child.values.every((value) => parentValues.has(canonicalKey(value)));
  }
  if (child.kind !== "decimal_range" || parent.kind !== "decimal_range")
    throw new Error("Incompatible pricing predicates");
  if (canonicalKey(child.unit) !== canonicalKey(parent.unit))
    throw new Error("One decimal dimension uses incompatible units");
  return lowerContains(parent.lower, child.lower) && upperContains(parent.upper, child.upper);
}

function rangesDisjoint(
  left: Extract<PriceCondition, { kind: "decimal_range" }>,
  right: Extract<PriceCondition, { kind: "decimal_range" }>,
): boolean {
  return upperBeforeLower(left.upper, right.lower) || upperBeforeLower(right.upper, left.lower);
}

function rangeIsEmpty(condition: Extract<PriceCondition, { kind: "decimal_range" }>): boolean {
  return upperBeforeLower(condition.upper, condition.lower);
}

function upperBeforeLower(
  upper: { value: string; inclusive: boolean } | undefined,
  lower: { value: string; inclusive: boolean } | undefined,
): boolean {
  if (upper === undefined || lower === undefined) return false;
  const comparison = compareDecimals(upper.value, lower.value);
  return comparison < 0 || (comparison === 0 && (!upper.inclusive || !lower.inclusive));
}

function lowerContains(
  parent: { value: string; inclusive: boolean } | undefined,
  child: { value: string; inclusive: boolean } | undefined,
): boolean {
  if (parent === undefined) return true;
  if (child === undefined) return false;
  const comparison = compareDecimals(parent.value, child.value);
  return comparison < 0 || (comparison === 0 && (parent.inclusive || !child.inclusive));
}

function upperContains(
  parent: { value: string; inclusive: boolean } | undefined,
  child: { value: string; inclusive: boolean } | undefined,
): boolean {
  if (parent === undefined) return true;
  if (child === undefined) return false;
  const comparison = compareDecimals(parent.value, child.value);
  return comparison > 0 || (comparison === 0 && (parent.inclusive || !child.inclusive));
}

function tighterLower<T extends { value: string; inclusive: boolean }>(
  left: T | undefined,
  right: T | undefined,
): T | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  const comparison = compareDecimals(left.value, right.value);
  if (comparison > 0) return left;
  if (comparison < 0) return right;
  return { ...left, inclusive: left.inclusive && right.inclusive };
}

function tighterUpper<T extends { value: string; inclusive: boolean }>(
  left: T | undefined,
  right: T | undefined,
): T | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  const comparison = compareDecimals(left.value, right.value);
  if (comparison < 0) return left;
  if (comparison > 0) return right;
  return { ...left, inclusive: left.inclusive && right.inclusive };
}

function optionalBound<Key extends "lower" | "upper", Value>(
  key: Key,
  value: Value | undefined,
): { [Property in Key]?: Value } {
  return value === undefined ? {} : ({ [key]: value } as { [Property in Key]: Value });
}

function compareConditions(left: PriceCondition, right: PriceCondition): number {
  const dimension = compareUtf8(canonicalKey(left.dimension), canonicalKey(right.dimension));
  return dimension || compareUtf8(canonicalKey(left), canonicalKey(right));
}

function uniqueCategoricalValues(
  dimension: PriceDimension,
  values: PriceCategoricalValue[],
): PriceCategoricalValue[] {
  const sorted = [...values].sort((left, right) =>
    compareUtf8(categoricalSortKey(dimension, left), categoricalSortKey(dimension, right)),
  );
  return sorted.filter(
    (value, index) => index === 0 || categoricalKey(value) !== categoricalKey(sorted[index - 1]!),
  );
}

function categoricalSortKey(dimension: PriceDimension, value: PriceCategoricalValue): string {
  if (dimension.namespace === "kmodels" && dimension.value === "model") return value.value;
  return canonicalJsonFromValidated([
    value.namespace,
    ...(value.namespace === "provider" ? [value.provider_id] : []),
    value.value,
  ]);
}

function categoricalKey(value: PriceCategoricalValue): string {
  return canonicalKey(value);
}

function conditionIndex(conditions: PriceCondition[]): ReadonlyMap<string, PriceCondition> {
  const current = conditionIndexes.get(conditions);
  if (current !== undefined) return current;
  const created = new Map(
    conditions.map((condition) => [canonicalKey(condition.dimension), condition]),
  );
  conditionIndexes.set(conditions, created);
  return created;
}

function categoricalIndex(
  condition: Extract<PriceCondition, { kind: "categorical" }>,
): ReadonlySet<string> {
  const current = categoricalIndexes.get(condition);
  if (current !== undefined) return current;
  const created = new Set(condition.values.map(canonicalKey));
  categoricalIndexes.set(condition, created);
  return created;
}

function cacheRelation(
  cache: WeakMap<PriceApplicability, WeakMap<PriceApplicability, boolean>>,
  left: PriceApplicability,
  right: PriceApplicability,
  result: boolean,
): void {
  const relations = cache.get(left) ?? new WeakMap<PriceApplicability, boolean>();
  relations.set(right, result);
  cache.set(left, relations);
}

function conditionWeight(condition: PriceCondition): number {
  if (condition.kind === "boolean") return 2;
  if (condition.kind === "decimal_range") return 3;
  return 1 + condition.values.length;
}

function uniqueByCanonicalBytes<T extends object>(values: T[]): T[] {
  return values.filter(
    (value, index) => index === 0 || canonicalKey(value) !== canonicalKey(values[index - 1]!),
  );
}

function compareDecimals(left: string, right: string): number {
  return compareRationals(rationalFromDecimal(left), rationalFromDecimal(right));
}
