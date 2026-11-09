import { isPricingDecimal } from "./pricing-constants.ts";
import { isWholeNumberDimension } from "./pricing-presentation.ts";
import { evaluateApplicability, type PricingSelection } from "./pricing-applicability.ts";
import type { WebsitePricingSelector } from "./website-schema.ts";
type DecimalRangeSelector = Extract<WebsitePricingSelector, { kind: "decimal_range" }>;

export function fixedPricingSelection(
  selector: WebsitePricingSelector,
): PricingSelection | undefined {
  if (selector.kind === "categorical" && selector.values.length === 1)
    return pricingSelection(selector, selector.values[0]?.key ?? "");
  if (selector.kind === "decimal_values" && selector.values.length === 1)
    return pricingSelection(selector, selector.values[0] ?? "");
  return undefined;
}

export function pricingSelection(
  selector: WebsitePricingSelector,
  value: string,
): PricingSelection | undefined {
  if (value === "") return undefined;
  if (selector.kind === "categorical") {
    const selected = selector.values.find(({ key }) => key === value);
    return selected === undefined
      ? undefined
      : { dimension: selector.dimension, kind: "categorical", value: selected.value };
  }
  if (selector.kind === "boolean")
    return value === "true" || value === "false"
      ? { dimension: selector.dimension, kind: "boolean", value: value === "true" }
      : undefined;
  if (selector.kind === "decimal_buckets") {
    const selected = selector.values.find(({ key }) => key === value);
    return selected === undefined
      ? undefined
      : {
          dimension: selector.dimension,
          kind: "decimal_range",
          unit: selector.unit,
          ...(selected.lower === undefined ? {} : { lower: selected.lower }),
          ...(selected.upper === undefined ? {} : { upper: selected.upper }),
        };
  }
  if (
    (selector.kind === "decimal_values" && !selector.values.includes(value)) ||
    (selector.kind === "decimal_range" && !isAcceptedDecimal(selector, value))
  )
    return undefined;
  return { dimension: selector.dimension, kind: "decimal", value, unit: selector.unit };
}

export function isIntegerSelector(selector: WebsitePricingSelector): boolean {
  return isWholeNumberDimension(selector.dimension);
}

function isAcceptedDecimal(selector: DecimalRangeSelector, value: string): boolean {
  if (!isPricingDecimal(value) || (isIntegerSelector(selector) && value.includes(".")))
    return false;
  return (
    evaluateApplicability(
      {
        any_of: selector.ranges.map((range) => ({
          all_of: [
            {
              kind: "decimal_range",
              dimension: selector.dimension,
              unit: selector.unit,
              ...range,
            },
          ],
        })),
      },
      [{ dimension: selector.dimension, kind: "decimal", value, unit: selector.unit }],
    ).state === "true"
  );
}

export function pricingInputError(
  selector: DecimalRangeSelector,
  value: string,
): string | undefined {
  if (value === "" || isAcceptedDecimal(selector, value)) return undefined;
  if (!isPricingDecimal(value)) return "Enter a non-negative number.";
  if (isIntegerSelector(selector) && value.includes(".")) return "Enter a whole number.";
  return "No published pricing range includes this value.";
}

export function decimalRangeLabel(selector: DecimalRangeSelector): string {
  return selector.ranges.map(({ lower, upper }) => rangeLabel(lower, upper)).join(" or ");
}

function rangeLabel(
  lower: { value: string; inclusive: boolean } | undefined,
  upper: { value: string; inclusive: boolean } | undefined,
): string {
  if (lower === undefined) return `${upper?.inclusive === true ? "≤" : "<"} ${upper?.value ?? ""}`;
  if (upper === undefined) return `${lower.inclusive ? "≥" : ">"} ${lower.value}`;
  if (lower.inclusive && upper.inclusive) return `${lower.value}–${upper.value}`;
  return `${lower.inclusive ? "≥" : ">"} ${lower.value} and ${upper.inclusive ? "≤" : "<"} ${upper.value}`;
}
