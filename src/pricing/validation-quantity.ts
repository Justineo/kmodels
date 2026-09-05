import { canonicalJson } from "../catalog/canonical-value.ts";
import {
  requiredUsageSignals,
  requiredUsageSignalsForMethod,
  validateUsageQuantityCalculation,
} from "../catalog/pricing-calculation.ts";
import type {
  UnitExpression,
  UsageQuantityCalculation,
  UsageQuantityMethod,
  UsageQuantityNode,
} from "../catalog/pricing-schema.ts";
import type { CalculationBinding, CalculationProvider } from "./schema.ts";
import { signalUnit, unitKey } from "./validation-vocabulary.ts";

const itemUnitKey = unitKey({
  factors: [{ unit: { namespace: "kmodels", value: "item" }, power: 1 }],
});

export function validateBinding(
  binding: CalculationBinding,
  provider: CalculationProvider,
  expectedUnit: UnitExpression,
): void {
  const outputUnit = unitKey(signalUnit(binding.signal, provider));
  if (outputUnit !== unitKey(expectedUnit))
    throw new Error("Charge signal unit differs from rate denominator");
  for (const signal of requiredUsageSignals(binding)) unitKey(signalUnit(signal, provider));
  for (const method of binding.quantity_methods ?? []) {
    validateMethodSources(binding, method);
    if (method.calculation !== undefined)
      validateCalculationUnits(method.calculation, provider, outputUnit);
  }
}

function validateMethodSources(binding: CalculationBinding, method: UsageQuantityMethod): void {
  if (method.input_sources === undefined) return;
  const requiredSignals = new Set(
    requiredUsageSignalsForMethod(binding, method).map(canonicalJson),
  );
  const mappedSignals = new Set(method.input_sources.map((source) => canonicalJson(source.signal)));
  if (
    requiredSignals.size !== mappedSignals.size ||
    [...requiredSignals].some((signal) => !mappedSignals.has(signal))
  ) {
    throw new Error("Input sources do not exactly cover a quantity method");
  }
}

function validateCalculationUnits(
  calculation: UsageQuantityCalculation,
  provider: CalculationProvider,
  expectedUnit: string,
): void {
  validateUsageQuantityCalculation(calculation);
  const computedUnits: string[] = [];
  for (const node of calculation.nodes) computedUnits.push(nodeUnit(node, computedUnits, provider));
  if (referencedUnit(computedUnits, calculation.result) !== expectedUnit)
    throw new Error("Calculation output has incompatible units");
}

function nodeUnit(
  node: UsageQuantityNode,
  computedUnits: string[],
  provider: CalculationProvider,
): string {
  switch (node.op) {
    case "constant":
      return unitKey(node.unit);
    case "signal":
      return unitKey(signalUnit(node.signal, provider));
    case "sum":
      return commonInputUnit(node.inputs, computedUnits);
    case "subtract_floor_zero":
      return commonInputUnit([node.minuend, node.subtrahend], computedUnits);
    case "product": {
      const dimensionalUnits = node.inputs
        .map((input) => referencedUnit(computedUnits, input))
        .filter((unit) => unit !== itemUnitKey);
      const quantityUnit = dimensionalUnits[0];
      if (quantityUnit === undefined || dimensionalUnits.length !== 1)
        throw new Error("Product needs one quantity and item counts");
      return quantityUnit;
    }
    case "multiply":
    case "minimum":
    case "round_up":
      return referencedUnit(computedUnits, node.input);
  }
}

function commonInputUnit(inputs: number[], computedUnits: string[]): string {
  const firstInput = inputs[0];
  if (firstInput === undefined) throw new Error("Calculation combines incompatible quantities");
  const expectedUnit = referencedUnit(computedUnits, firstInput);
  if (inputs.some((input) => referencedUnit(computedUnits, input) !== expectedUnit))
    throw new Error("Calculation combines incompatible quantities");
  return expectedUnit;
}

function referencedUnit(computedUnits: string[], index: number): string {
  const unit = computedUnits[index];
  if (unit === undefined) throw new Error("Invalid calculation reference");
  return unit;
}
