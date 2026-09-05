import { canonicalJson, uniqueCanonicalValues } from "../catalog/canonical-value.ts";
import {
  compareRationals,
  multiplyRationals,
  normalizeRational,
  subtractRationalsFloorZero,
} from "../catalog/pricing-rational.ts";
import type { CalculationAllowance, CalculationComponent, CalculationRate } from "./schema.ts";
import type { Charge } from "./types.ts";
import type { Gap } from "./selection.ts";
import type { PricingSnapshot } from "./snapshot.ts";

export interface PendingAllowance {
  component: CalculationComponent;
  termRef: string;
  variant: CalculationAllowance;
}

interface AllowanceAllocation extends PendingAllowance {
  charges: Charge[];
  componentIds: Set<string>;
}

export function applyAllowances(
  snapshot: PricingSnapshot,
  allowances: PendingAllowance[],
  charges: Charge[],
  gaps: Gap[],
): void {
  const allocations = allowances.map((allowance) => allocateAllowance(allowance, charges));
  for (const allocation of allocations) {
    let problem = allocationProblem(allocation, allocations, gaps);
    if (problem === undefined) problem = applyBenefit(snapshot, allocation);
    if (problem !== undefined) {
      gaps.push({
        code: "unsupported_structure",
        componentId: allocation.component.id,
        offerRef: allocation.component.offerRef,
        termRef: allocation.termRef,
        reason: problem,
      });
      continue;
    }
    for (const charge of allocation.charges) {
      charge.allowances.push(allocation.termRef);
      charge.evidence = uniqueCanonicalValues([...charge.evidence, ...allocation.variant.evidence]);
    }
  }
}

function allocateAllowance(allowance: PendingAllowance, charges: Charge[]): AllowanceAllocation {
  const componentIds = new Set([allowance.component.id, ...allowance.component.relatedComponents]);
  const target = allowance.variant.target;
  const matchingCharges = charges.filter((charge) => {
    if (!componentIds.has(charge.componentId)) return false;
    if (target.kind === "offers") return target.offer_refs.includes(charge.offerRef);
    return target.term_refs.includes(charge.rateTermRef);
  });
  return { ...allowance, charges: matchingCharges, componentIds };
}

function allocationProblem(
  allocation: AllowanceAllocation,
  allocations: AllowanceAllocation[],
  gaps: Gap[],
): string | undefined {
  if (allocation.charges.length === 0) {
    return "Allowance target has no resolved charge in this component or its explicit links";
  }
  if (hasUnresolvedInputs(allocation, gaps)) {
    return "Allowance allocation needs all target charges to resolve";
  }
  if (
    allocations.some(
      (other) =>
        other !== allocation && other.charges.some((charge) => allocation.charges.includes(charge)),
    )
  ) {
    return "Overlapping allowances need a published ordering";
  }
  return undefined;
}

function hasUnresolvedInputs(allocation: AllowanceAllocation, gaps: Gap[]): boolean {
  const unresolvedInputCodes: Gap["code"][] = [
    "missing_quantity",
    "unbound_charge",
    "missing_selector",
    "unknown_price",
  ];
  return gaps.some(
    (gap) =>
      gap.componentId !== undefined &&
      allocation.componentIds.has(gap.componentId) &&
      unresolvedInputCodes.includes(gap.code),
  );
}

function applyBenefit(
  snapshot: PricingSnapshot,
  allocation: AllowanceAllocation,
): string | undefined {
  const benefit = allocation.variant.benefit;
  if (benefit.kind === "coverage") {
    for (const charge of allocation.charges) charge.amount = normalizeRational(0n);
    return undefined;
  }
  const charge = allocation.charges[0];
  if (allocation.charges.length !== 1 || charge === undefined) {
    return "Allowance allocation across multiple charges is not established";
  }
  if (benefit.kind === "quantity") {
    const rate = findChargedRate(snapshot, charge);
    if (
      rate === undefined ||
      canonicalJson(rate.price.per) !== canonicalJson(benefit.quantity.unit)
    ) {
      return "Allowance quantity unit does not match its target charge";
    }
    const billableQuantity = subtractRationalsFloorZero(charge.quantity, benefit.quantity.value);
    charge.amount = multiplyRationals(billableQuantity, rate.price.value);
    return undefined;
  }
  if (
    benefit.kind === "credit" &&
    canonicalJson(charge.denomination) === canonicalJson(benefit.denomination)
  ) {
    charge.amount = subtractRationalsFloorZero(charge.amount, benefit.amount);
    return undefined;
  }
  return "Allowance substitution or denomination is not established for this component";
}

function findChargedRate(snapshot: PricingSnapshot, charge: Charge): CalculationRate | undefined {
  const rateTerm = snapshot.rates.get(charge.rateTermRef);
  return rateTerm?.variants.find((rate) => {
    if (canonicalJson(rate.price.denomination) !== canonicalJson(charge.denomination)) return false;
    const grossAmount = multiplyRationals(rate.price.value, charge.quantity);
    return compareRationals(grossAmount, charge.grossAmount) === 0;
  });
}
