import { z } from "zod";
import { canonicalJson } from "../catalog/canonical-value.ts";
import { requiredUsageSignals } from "../catalog/pricing-calculation.ts";
import { canonicalizeInstant } from "../catalog/pricing-time.ts";
import type { PriceCondition } from "../catalog/pricing-schema.ts";
import {
  calculationRequestSchema,
  type CalculationComponent,
  type CalculationProvider,
  type Quantity,
  type Selector,
} from "./schema.ts";
import { PricingError } from "./errors.ts";
import { getOffer, termBindings, type IndexedOffer, type PricingSnapshot } from "./snapshot.ts";
import { signalUnit, validateCondition } from "./validation-vocabulary.ts";

export function parseRequest<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new PricingError("INVALID_REQUEST", parsed.error.message);
  return parsed.data;
}

export function prepareCalculationRequest(snapshot: PricingSnapshot, input: unknown) {
  const request = parseRequest(calculationRequestSchema, input);
  const evaluatedAt = parseEvaluationTime(request.evaluatedAt);
  const components = new Map<string, CalculationComponent>();
  for (const component of request.components) {
    if (components.has(component.id)) {
      throw new PricingError("DUPLICATE_COMPONENT", "Component IDs must be unique");
    }
    getOffer(snapshot, component.offerRef);
    components.set(component.id, component);
  }
  return { evaluatedAt, components };
}

function parseEvaluationTime(value: string): string {
  try {
    return canonicalizeInstant(value);
  } catch {
    throw new PricingError("INVALID_REQUEST", "evaluatedAt must be an RFC 3339 instant");
  }
}

export function componentInputs(component: CalculationComponent): {
  quantities: Quantity[];
  selectors: Selector[];
} {
  const quantities = [...component.quantities];
  const selectors = [...component.selectors];
  const suppliedSignals = new Set<string>();
  for (const quantity of quantities) {
    const signalKey = canonicalJson(quantity.signal);
    if (suppliedSignals.has(signalKey)) {
      throw new PricingError("DUPLICATE_SIGNAL", "Quantities repeat a signal");
    }
    suppliedSignals.add(signalKey);
  }
  for (const assumption of component.assumptions) {
    if (assumption.kind === "quantity") {
      const signalKey = canonicalJson(assumption.quantity.signal);
      if (suppliedSignals.has(signalKey)) {
        throw new PricingError(
          "ASSUMPTION_CONFLICT",
          "Assumptions cannot replace an observed or assumed quantity",
        );
      }
      suppliedSignals.add(signalKey);
      quantities.push(assumption.quantity);
      continue;
    }
    const dimensionKey = canonicalJson(assumption.selector.dimension);
    if (selectors.some((selector) => canonicalJson(selector.dimension) === dimensionKey)) {
      throw new PricingError(
        "ASSUMPTION_CONFLICT",
        "Assumptions cannot replace an observed or assumed selector",
      );
    }
    selectors.push(assumption.selector);
  }
  return { quantities, selectors };
}

export function validateOfferQuantities(quantities: Quantity[], owner: IndexedOffer): void {
  const bindings = owner.offer.terms.flatMap(termBindings);
  const admittedSignals = new Set(bindings.flatMap(requiredUsageSignals).map(canonicalJson));
  for (const quantity of quantities) {
    signalUnit(quantity.signal, owner.provider);
    if (!admittedSignals.has(canonicalJson(quantity.signal))) {
      throw new PricingError("INCOMPATIBLE_QUANTITY", "Quantity is not an input to this offer");
    }
  }
}

export function validateSelectorVocabulary(
  selectors: readonly Selector[],
  provider: CalculationProvider,
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
