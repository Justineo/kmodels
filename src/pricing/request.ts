import { z } from "zod";
import { assertIJsonValue } from "../catalog/canonical-value.ts";
import { canonicalizeInstant } from "../catalog/pricing-time.ts";
import type { PriceCondition } from "../catalog/pricing-schema.ts";
import type { PriceDataProvider, Selector } from "./schema.ts";
import { PricingError } from "./errors.ts";
import { validateCondition } from "./validation-vocabulary.ts";

export function parseRequest<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  try {
    assertIJsonValue(input);
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new Error(parsed.error.message);
    return parsed.data;
  } catch (error) {
    throw new PricingError(
      "INVALID_REQUEST",
      error instanceof Error ? error.message : "Invalid request",
    );
  }
}

export function parseEvaluationTime(value: string): string {
  try {
    return canonicalizeInstant(value);
  } catch {
    throw new PricingError("INVALID_REQUEST", "evaluated_at must be an RFC 3339 instant");
  }
}

export function validateSelectorVocabulary(
  selectors: readonly Selector[],
  provider: PriceDataProvider,
): void {
  try {
    for (const selector of selectors) validateCondition(selectorCondition(selector), provider);
  } catch (error) {
    throw new PricingError(
      "INVALID_REQUEST",
      error instanceof Error ? error.message : "Invalid selector",
    );
  }
}

function selectorCondition(selector: Selector): PriceCondition {
  switch (selector.kind) {
    case "boolean":
      return selector;
    case "categorical":
      return { kind: "categorical", dimension: selector.dimension, values: [selector.value] };
    case "decimal":
      return {
        kind: "decimal_range",
        dimension: selector.dimension,
        unit: selector.unit,
        lower: { value: selector.value, inclusive: true },
        upper: { value: selector.value, inclusive: true },
      };
  }
}
