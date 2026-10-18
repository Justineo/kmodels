import { canonicalJsonKey, compareUtf8 } from "./canonical-value.ts";
import { predicateContainedIn, predicatesOverlap } from "./pricing-canonical.ts";
import { assertPricingDecimal } from "./pricing-constants.ts";
import { compareRationals, rationalFromDecimal } from "./pricing-rational.ts";
import type {
  PriceApplicability,
  PriceCategoricalValue,
  PriceCondition,
  PriceDimension,
  Rational,
  UnitExpression,
} from "./pricing-schema.ts";

const modelDimension: PriceDimension = { namespace: "kmodels", value: "model" };

type ApplicabilityResult =
  | { state: "true" | "false"; missing_dimensions: [] }
  | { state: "missing"; missing_dimensions: PriceDimension[] };

export type PricingSelection =
  | {
      dimension: PriceDimension;
      kind: "categorical";
      value: PriceCategoricalValue;
    }
  | {
      dimension: PriceDimension;
      kind: "boolean";
      value: boolean;
    }
  | {
      dimension: PriceDimension;
      kind: "decimal";
      value: string;
      unit: UnitExpression;
    }
  | Extract<PriceCondition, { kind: "decimal_range" }>;

export function evaluateApplicability(
  applicability: PriceApplicability,
  selections: readonly PricingSelection[],
): ApplicabilityResult {
  const context = selectionMap(selections);
  const missing = new Map<string, PriceDimension>();
  let hasMissingClause = false;
  for (const clause of applicability.any_of) {
    let clauseMissing = false;
    let clauseFalse = false;
    const clauseDimensions: PriceDimension[] = [];
    for (const condition of clause.all_of) {
      const result = evaluateCondition(condition, context);
      if (result === "false") {
        clauseFalse = true;
        break;
      }
      if (result === "missing") {
        clauseMissing = true;
        clauseDimensions.push(condition.dimension);
      }
    }
    if (clauseFalse) continue;
    if (!clauseMissing) return { state: "true", missing_dimensions: [] };
    hasMissingClause = true;
    for (const dimension of clauseDimensions) missing.set(canonicalJsonKey(dimension), dimension);
  }
  if (!hasMissingClause) return { state: "false", missing_dimensions: [] };
  return {
    state: "missing",
    missing_dimensions: [...missing.values()].sort((left, right) =>
      compareUtf8(canonicalJsonKey(left), canonicalJsonKey(right)),
    ),
  };
}

export function evaluateModelApplicability(
  applicability: PriceApplicability,
  modelRef: string,
  selections: readonly PricingSelection[] = [],
): ApplicabilityResult {
  return evaluateApplicability(applicability, withModelSelection(selections, modelRef));
}

export function withModelSelection(
  selections: readonly PricingSelection[],
  modelRef: string,
): PricingSelection[] {
  const withoutModel = selections.filter(
    ({ dimension }) => canonicalJsonKey(dimension) !== canonicalJsonKey(modelDimension),
  );
  return [
    ...withoutModel,
    {
      dimension: modelDimension,
      kind: "categorical",
      value: { namespace: "kmodels", value: modelRef },
    },
  ];
}

function categoricalValuesEqual(
  left: PriceCategoricalValue,
  right: PriceCategoricalValue,
): boolean {
  return (
    left.namespace === right.namespace &&
    left.value === right.value &&
    (left.namespace !== "provider" ||
      (right.namespace === "provider" && left.provider_id === right.provider_id))
  );
}

function selectionMap(selections: readonly PricingSelection[]): Map<string, PricingSelection> {
  const result = new Map<string, PricingSelection>();
  for (const selection of selections) {
    const key = canonicalJsonKey(selection.dimension);
    if (result.has(key)) throw new Error(`Duplicate pricing selection for ${key}`);
    if (selection.kind === "decimal") assertPricingDecimal(selection.value);
    if (selection.kind === "decimal_range") {
      if (selection.lower === undefined && selection.upper === undefined)
        throw new Error("Decimal-range pricing selection has no bound");
      if (selection.lower !== undefined) assertPricingDecimal(selection.lower.value);
      if (selection.upper !== undefined) assertPricingDecimal(selection.upper.value);
    }
    result.set(key, selection);
  }
  return result;
}

function evaluateCondition(
  condition: PriceCondition,
  context: ReadonlyMap<string, PricingSelection>,
): "true" | "false" | "missing" {
  const selected = context.get(canonicalJsonKey(condition.dimension));
  if (selected === undefined) return "missing";
  if (condition.kind === "categorical")
    return selected.kind === "categorical" &&
      condition.values.some((value) => categoricalValuesEqual(value, selected.value))
      ? "true"
      : "false";
  if (condition.kind === "boolean")
    return selected.kind === "boolean" && condition.value === selected.value ? "true" : "false";
  if (
    (selected.kind !== "decimal" && selected.kind !== "decimal_range") ||
    canonicalJsonKey(selected.unit) !== canonicalJsonKey(condition.unit)
  )
    return "false";
  if (selected.kind === "decimal_range") {
    if (predicateContainedIn(selected, condition)) return "true";
    return predicatesOverlap(selected, condition) ? "missing" : "false";
  }
  const value = rationalFromDecimal(selected.value);
  if (
    condition.lower !== undefined &&
    !boundSatisfied(
      value,
      rationalFromDecimal(condition.lower.value),
      "lower",
      condition.lower.inclusive,
    )
  )
    return "false";
  if (
    condition.upper !== undefined &&
    !boundSatisfied(
      value,
      rationalFromDecimal(condition.upper.value),
      "upper",
      condition.upper.inclusive,
    )
  )
    return "false";
  return "true";
}

function boundSatisfied(
  value: Rational,
  bound: Rational,
  side: "lower" | "upper",
  inclusive: boolean,
): boolean {
  const comparison = compareRationals(value, bound);
  return side === "lower"
    ? inclusive
      ? comparison >= 0
      : comparison > 0
    : inclusive
      ? comparison <= 0
      : comparison < 0;
}
