import type { CalculationComponent } from "./schema.ts";
import type { Charge } from "./types.ts";
import { PricingError } from "./errors.ts";

export function componentsAreLinked(
  left: CalculationComponent,
  right: CalculationComponent,
): boolean {
  return left.relatedComponents.includes(right.id) || right.relatedComponents.includes(left.id);
}

export function relatedComponents(
  component: CalculationComponent,
  components: ReadonlyMap<string, CalculationComponent>,
): CalculationComponent[] {
  const related = component.relatedComponents.map((id) => {
    const target = components.get(id);
    if (target === undefined || id === component.id) {
      throw new PricingError("INVALID_COMPOSITION", "Invalid related component identity");
    }
    return target;
  });
  if (new Set(component.relatedComponents).size !== component.relatedComponents.length) {
    throw new PricingError("INVALID_COMPOSITION", "Related component identities must be unique");
  }
  return related;
}

export function rejectDuplicateContributions(
  charges: readonly Charge[],
  components: ReadonlyMap<string, CalculationComponent>,
): void {
  for (const charge of charges) {
    if (charge.termRef === charge.rateTermRef) continue;
    const component = components.get(charge.componentId);
    if (component === undefined) throw new PricingError("INVALID_COMPOSITION", "Missing component");
    for (const otherCharge of charges) {
      if (otherCharge === charge || otherCharge.rateTermRef !== charge.rateTermRef) continue;
      if (otherCharge.componentId === charge.componentId) {
        if (otherCharge.termRef === otherCharge.rateTermRef) {
          throw new PricingError(
            "INVALID_COMPOSITION",
            "A contribution and its referenced rate would charge the same component twice",
          );
        }
        continue;
      }
      const otherComponent = components.get(otherCharge.componentId);
      if (otherComponent !== undefined && componentsAreLinked(component, otherComponent)) {
        throw new PricingError(
          "INVALID_COMPOSITION",
          "A contribution and its referenced rate would charge the same linked event twice",
        );
      }
    }
  }
}
