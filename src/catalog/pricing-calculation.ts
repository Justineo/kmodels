import { canonicalJson, compareCanonicalValues, uniqueCanonicalValues } from "./canonical-value.ts";
import {
  addRationals,
  compareRationals,
  multiplyRationals,
  subtractRationalsFloorZero,
  roundUpRational,
} from "./pricing-rational.ts";
import type {
  ChargeBinding,
  PriceRateVariant,
  Rational,
  UsageQuantityCalculation,
  UsageQuantityMethod,
  UsageQuantityNode,
  UsageSignal,
} from "./pricing-schema.ts";

export interface ObservedUsageQuantity {
  signal: UsageSignal;
  value: Rational;
}

export type QuantityBinding = Omit<ChargeBinding, "observations">;

export class UsageQuantityConflictError extends Error {
  constructor() {
    super("Quantity methods resolved to conflicting values");
    this.name = "UsageQuantityConflictError";
  }
}

export type ChargeQuantityEvaluation =
  | { kind: "resolved"; value: Rational }
  | { kind: "missing_input"; alternatives: UsageSignal[][] };

export type RateCostEvaluation =
  | { kind: "resolved"; amount: Rational; denomination: PriceRateVariant["price"]["denomination"] }
  | { kind: "missing_input"; alternatives: UsageSignal[][] }
  | { kind: "unbound" };

export function validateUsageQuantityCalculation(calculation: UsageQuantityCalculation): void {
  if (calculation.result !== calculation.nodes.length - 1)
    throw new Error("Quantity calculation result must be its final node");

  const signals = new Set<string>();
  for (const [index, node] of calculation.nodes.entries()) {
    for (const reference of nodeReferences(node))
      if (reference >= index)
        throw new Error("Quantity calculation nodes may reference only earlier nodes");
    if (node.op === "sum" || node.op === "product") {
      for (let input = 1; input < node.inputs.length; input++)
        if (node.inputs[input - 1]! >= node.inputs[input]!)
          throw new Error(`Quantity calculation ${node.op} inputs must be sorted and unique`);
    }
    if (
      (node.op === "multiply" && node.factor.numerator === "0") ||
      (node.op === "minimum" && node.value.numerator === "0")
    )
      throw new Error(`Quantity calculation ${node.op} value must be positive`);
    if (node.op === "round_up" && node.increment.numerator === "0")
      throw new Error("Billing increment must be positive");
    if (node.op === "signal") {
      const key = canonicalJson(node.signal);
      if (signals.has(key)) throw new Error("Quantity calculation repeats a usage signal");
      signals.add(key);
    }
  }

  const reachable = new Set<number>();
  const pending = [calculation.result];
  while (pending.length > 0) {
    const index = pending.pop();
    if (index === undefined || reachable.has(index)) continue;
    const node = calculation.nodes[index];
    if (node === undefined) throw new Error("Quantity calculation result is out of range");
    reachable.add(index);
    pending.push(...nodeReferences(node));
  }
  if (reachable.size !== calculation.nodes.length)
    throw new Error("Quantity calculation contains unused nodes");
}

export function requiredUsageSignals(binding: QuantityBinding): UsageSignal[] {
  return uniqueCanonicalValues(
    quantityMethods(binding).flatMap((method) => methodUsageSignals(binding, method)),
  );
}

export function requiredUsageSignalAlternatives(binding: QuantityBinding): UsageSignal[][] {
  return uniqueCanonicalValues(
    quantityMethods(binding).map((method) => methodUsageSignals(binding, method)),
  );
}

export function requiredUsageSignalsForMethod(
  binding: QuantityBinding,
  method: UsageQuantityMethod,
): UsageSignal[] {
  return methodUsageSignals(binding, method);
}

export function evaluateChargeQuantity(
  binding: QuantityBinding,
  observed: readonly ObservedUsageQuantity[],
): ChargeQuantityEvaluation {
  const values = new Map<string, Rational>();
  for (const input of observed) {
    const key = canonicalJson(input.signal);
    if (values.has(key)) throw new Error("Observed usage contains a duplicate signal");
    values.set(key, input.value);
  }

  const resolved: Rational[] = [];
  const missing: UsageSignal[][] = [];
  for (const method of quantityMethods(binding)) {
    const absent = methodUsageSignals(binding, method).filter(
      (signal) => !values.has(canonicalJson(signal)),
    );
    if (absent.length > 0) {
      missing.push(absent);
      continue;
    }
    const quantity =
      method.calculation === undefined
        ? values.get(canonicalJson(binding.signal))
        : evaluateCalculation(method.calculation, values);
    if (quantity === undefined) throw new Error("Required usage value was not resolved");
    resolved.push(quantity);
  }
  if (resolved.length === 0)
    return {
      kind: "missing_input",
      alternatives: uniqueCanonicalValues(missing),
    };
  const quantity = resolved[0]!;
  if (resolved.some((value) => compareRationals(value, quantity) !== 0))
    throw new UsageQuantityConflictError();
  return {
    kind: "resolved",
    value: binding.scale === undefined ? quantity : multiplyRationals(quantity, binding.scale),
  };
}

function quantityMethods(binding: QuantityBinding): UsageQuantityMethod[] {
  return binding.quantity_methods ?? [{}];
}

function methodUsageSignals(binding: QuantityBinding, method: UsageQuantityMethod): UsageSignal[] {
  if (method.calculation === undefined) return [binding.signal];
  validateUsageQuantityCalculation(method.calculation);
  return method.calculation.nodes
    .flatMap((node) => (node.op === "signal" ? [node.signal] : []))
    .sort(compareCanonicalValues);
}

export function evaluateRateCost(
  variant: PriceRateVariant,
  observed: readonly ObservedUsageQuantity[],
): RateCostEvaluation {
  if (variant.charge_binding === undefined) return { kind: "unbound" };
  const quantity = evaluateChargeQuantity(variant.charge_binding, observed);
  if (quantity.kind === "missing_input") return quantity;
  return {
    kind: "resolved",
    amount: multiplyRationals(variant.price.value, quantity.value),
    denomination: variant.price.denomination,
  };
}

function evaluateCalculation(
  calculation: UsageQuantityCalculation,
  observed: ReadonlyMap<string, Rational>,
): Rational {
  const values: Rational[] = [];
  for (const node of calculation.nodes) {
    let value: Rational | undefined;
    switch (node.op) {
      case "constant":
        value = node.value;
        break;
      case "signal":
        value = observed.get(canonicalJson(node.signal));
        break;
      case "sum":
        value = node.inputs.reduce(
          (total, input) => addRationals(total, referencedValue(values, input)),
          { numerator: "0", denominator: "1" },
        );
        break;
      case "product":
        value = node.inputs.reduce(
          (total, input) => multiplyRationals(total, referencedValue(values, input)),
          { numerator: "1", denominator: "1" },
        );
        break;
      case "subtract_floor_zero":
        value = subtractRationalsFloorZero(
          referencedValue(values, node.minuend),
          referencedValue(values, node.subtrahend),
        );
        break;
      case "multiply":
        value = multiplyRationals(referencedValue(values, node.input), node.factor);
        break;
      case "minimum": {
        const input = referencedValue(values, node.input);
        value = compareRationals(input, node.value) < 0 ? node.value : input;
        break;
      }
      case "round_up":
        value = roundUpRational(referencedValue(values, node.input), node.increment);
        break;
    }
    if (value === undefined) throw new Error("Quantity calculation input was not resolved");
    values.push(value);
  }
  return referencedValue(values, calculation.result);
}

function referencedValue(values: readonly Rational[], index: number): Rational {
  const value = values[index];
  if (value === undefined) throw new Error("Quantity calculation reference is out of range");
  return value;
}

function nodeReferences(node: UsageQuantityNode): number[] {
  switch (node.op) {
    case "constant":
    case "signal":
      return [];
    case "sum":
    case "product":
      return node.inputs;
    case "subtract_floor_zero":
      return [node.minuend, node.subtrahend];
    case "multiply":
    case "minimum":
    case "round_up":
      return [node.input];
  }
}
