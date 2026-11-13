import { canonicalJson, compareCanonicalValues, uniqueCanonicalValues } from "./canonical-value.ts";
import type {
  ChargeBinding,
  UsageQuantityCalculation,
  UsageQuantityMethod,
  UsageQuantityNode,
  UsageSignal,
} from "./pricing-schema.ts";

export type QuantityBinding = Omit<ChargeBinding, "observations">;

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
    quantityMethods(binding).flatMap((method) => requiredUsageSignalsForMethod(binding, method)),
  );
}

function quantityMethods(binding: QuantityBinding): UsageQuantityMethod[] {
  return binding.quantity_methods ?? [{}];
}

export function requiredUsageSignalsForMethod(
  binding: QuantityBinding,
  method: UsageQuantityMethod,
): UsageSignal[] {
  if (method.calculation === undefined) return [binding.signal];
  validateUsageQuantityCalculation(method.calculation);
  return method.calculation.nodes
    .flatMap((node) => (node.op === "signal" ? [node.signal] : []))
    .sort(compareCanonicalValues);
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
