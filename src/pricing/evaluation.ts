import { canonicalJson, uniqueCanonicalValues } from "../catalog/canonical-value.ts";
import { addRationals, normalizeRational } from "../catalog/pricing-rational.ts";
import type { CalculationRequest } from "./schema.ts";
import type { CalculationResult, Charge, Subtotal } from "./types.ts";
import { applyAllowances, type PendingAllowance } from "./allowances.ts";
import { evaluateComponent } from "./component-evaluation.ts";
import { rejectDuplicateContributions } from "./composition.ts";
import { prepareCalculationRequest } from "./request.ts";
import { getOffer, type PricingSnapshot } from "./snapshot.ts";

export function evaluateRequest(
  snapshot: PricingSnapshot,
  input: CalculationRequest,
): CalculationResult {
  const { evaluatedAt, components } = prepareCalculationRequest(snapshot, input);
  const result: CalculationResult = {
    status: "unknown",
    evaluatedAt,
    snapshot: snapshot.data.snapshot,
    freshness: [],
    charges: [],
    subtotals: [],
    assumptions: [],
    unresolved: [],
  };
  const allowances: PendingAllowance[] = [];
  let hasKnownAmount = false;
  for (const component of components.values()) {
    const owner = getOffer(snapshot, component.offerRef);
    const evaluated = evaluateComponent(snapshot, component, components, evaluatedAt);
    result.freshness.push(owner.provider.snapshot);
    result.charges.push(...evaluated.charges);
    result.unresolved.push(...evaluated.gaps);
    for (const assumption of component.assumptions)
      result.assumptions.push({ componentId: component.id, assumption });
    allowances.push(...evaluated.allowances);
    hasKnownAmount ||= evaluated.hasKnownAmount;
  }
  rejectDuplicateContributions(result.charges, components);
  applyAllowances(snapshot, allowances, result.charges, result.unresolved);
  result.freshness = uniqueCanonicalValues(result.freshness);
  result.unresolved = uniqueCanonicalValues(result.unresolved);
  result.subtotals = denominationSubtotals(result.charges);
  result.status = calculationStatus(result, hasKnownAmount);
  if (result.unresolved.length === 0) result.totals = result.subtotals;
  return structuredClone(result);
}

function denominationSubtotals(charges: Charge[]): Subtotal[] {
  const subtotals = new Map<string, Subtotal>();
  for (const charge of charges) {
    const denominationKey = canonicalJson(charge.denomination);
    const previousAmount = subtotals.get(denominationKey)?.amount ?? normalizeRational(0n);
    subtotals.set(denominationKey, {
      denomination: charge.denomination,
      amount: addRationals(previousAmount, charge.amount),
    });
  }
  return [...subtotals.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, subtotal]) => subtotal);
}

function calculationStatus(
  result: CalculationResult,
  hasKnownAmount: boolean,
): CalculationResult["status"] {
  if (result.unresolved.length > 0) return hasKnownAmount ? "partial" : "unknown";
  return result.assumptions.length > 0 ? "estimated" : "calculated";
}
