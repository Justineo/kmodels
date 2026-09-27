import { canonicalJson, uniqueCanonicalValues } from "../catalog/canonical-value.ts";
import {
  multiplyRationals,
  normalizeRational,
  subtractRationalsFloorZero,
} from "../catalog/pricing-rational.ts";
import type { CalculationAllowance, CalculationComponent } from "./schema.ts";
import type { EvaluatedCharge } from "./component-evaluation.ts";
import type { Gap } from "./selection.ts";

export interface PendingAllowance {
  component: CalculationComponent;
  termRef: string;
  variant: CalculationAllowance;
}

interface AllowanceAllocation extends PendingAllowance {
  charges: EvaluatedCharge[];
  componentIds: Set<string>;
}

export function applyAllowances(
  allowances: PendingAllowance[],
  charges: EvaluatedCharge[],
  gaps: Gap[],
): void {
  const unresolvedComponents = new Set(
    gaps.flatMap((gap) => (gap.componentId === undefined ? [] : [gap.componentId])),
  );
  const allocations = allowances.map((allowance) => allocateAllowance(allowance, charges));
  for (const allocation of allocations) {
    let problem = allocationProblem(allocation, allocations, unresolvedComponents);
    if (problem === undefined) problem = applyBenefit(allocation);
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

function allocateAllowance(
  allowance: PendingAllowance,
  charges: EvaluatedCharge[],
): AllowanceAllocation {
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
  unresolvedComponents: ReadonlySet<string>,
): string | undefined {
  if (allocation.charges.length === 0) {
    return "Allowance target has no resolved charge in this component or its explicit links";
  }
  if ([...allocation.componentIds].some((id) => unresolvedComponents.has(id))) {
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

function applyBenefit(allocation: AllowanceAllocation): string | undefined {
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
    if (canonicalJson(charge.price.per) !== canonicalJson(benefit.quantity.unit)) {
      return "Allowance quantity unit does not match its target charge";
    }
    const billableQuantity = subtractRationalsFloorZero(charge.quantity, benefit.quantity.value);
    charge.amount = multiplyRationals(billableQuantity, charge.price.value);
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
