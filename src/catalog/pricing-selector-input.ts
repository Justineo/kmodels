import { isPricingDecimal } from "./pricing-constants.ts";
import { canonicalJsonKey } from "./canonical-value.ts";
import { isWholeNumberDimension } from "./pricing-presentation.ts";
import { evaluateApplicability, type PricingSelection } from "./pricing-applicability.ts";
import type { WebsitePricingSelector } from "./website-schema.ts";
import type { AvailableCommercialChoice } from "../pricing/commercial-matching.ts";
import type { CommercialChoice } from "./pricing-schema.ts";

/** Keep every alternative of a relevant dimension editable, including inferred selections. */
export function commercialControlChoices(
  all: readonly AvailableCommercialChoice[],
  applicable: readonly AvailableCommercialChoice[],
  selected: readonly CommercialChoice[],
): AvailableCommercialChoice[] {
  return all.filter(
    (choice) =>
      selected.some(({ dimension }) => dimension === choice.dimension) ||
      applicable.some((current) => current.dimension === choice.dimension),
  );
}

/** The edited value takes precedence; retain other choices whenever their joint scope survives. */
export function retainCommercialChoices(
  previous: readonly CommercialChoice[],
  next: readonly CommercialChoice[],
  accepts: (choices: CommercialChoice[]) => boolean,
): CommercialChoice[] {
  const unchanged = (choice: CommercialChoice) =>
    previous.some((old) => canonicalJsonKey(old) === canonicalJsonKey(choice));
  const retained = next.filter((choice) => !unchanged(choice));
  for (const choice of next.filter(unchanged)) {
    if (accepts([...retained, choice])) retained.push(choice);
  }
  return retained;
}

export function fixedCommercialChoices(
  choices: readonly AvailableCommercialChoice[],
  candidateRefs: readonly string[],
): AvailableCommercialChoice[] {
  return choices.filter(
    (choice) =>
      choice.dimension !== "account_plan" &&
      choices.filter(({ dimension }) => dimension === choice.dimension).length === 1 &&
      candidateRefs.length > 0 &&
      candidateRefs.every((ref) => choice.offer_refs.includes(ref)),
  );
}

type DecimalRangeSelector = Extract<WebsitePricingSelector, { kind: "decimal_range" }>;

/** A sole published scope for browsing prices, not evidence of the caller's actual usage. */
export function fixedPricingSelection(
  selector: WebsitePricingSelector,
): PricingSelection | undefined {
  if (
    (selector.kind === "categorical" || selector.kind === "decimal_buckets") &&
    selector.values.length === 1
  )
    return pricingSelection(selector, selector.values[0]?.key ?? "");
  if (selector.kind === "decimal_values" && selector.values.length === 1)
    return pricingSelection(selector, selector.values[0] ?? "");
  return undefined;
}

export function fixedPricingSelections(
  selectors: readonly WebsitePricingSelector[],
  bound: readonly PricingSelection[] = [],
): PricingSelection[] {
  return selectors.flatMap((selector) => {
    const fixed = fixedPricingSelection(selector);
    return fixed !== undefined &&
      bound.every(
        (value) =>
          canonicalJsonKey(value.dimension) !== canonicalJsonKey(fixed.dimension) ||
          canonicalJsonKey(value) === canonicalJsonKey(fixed),
      )
      ? [fixed]
      : [];
  });
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

export function retainPricingInputs(
  previous: readonly WebsitePricingSelector[],
  next: readonly WebsitePricingSelector[],
  inputs: Readonly<Record<string, string>>,
  accepts: (selection: PricingSelection) => boolean = () => true,
): Record<string, string> {
  const oldByDimension = new Map(
    previous.map((selector) => [canonicalJsonKey(selector.dimension), selector]),
  );
  return Object.fromEntries(
    next.flatMap((selector) => {
      const old = oldByDimension.get(canonicalJsonKey(selector.dimension));
      if (old === undefined) return [];
      const input = inputs[old.key] ?? "";
      const before = pricingSelection(old, input);
      const after = pricingSelection(selector, input);
      return before !== undefined &&
        after !== undefined &&
        canonicalJsonKey(before) === canonicalJsonKey(after) &&
        accepts(after)
        ? [[selector.key, input]]
        : [];
    }),
  );
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
