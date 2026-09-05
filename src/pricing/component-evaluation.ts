import { canonicalJson, uniqueCanonicalValues } from "../catalog/canonical-value.ts";
import {
  evaluateChargeQuantity,
  type ChargeQuantityEvaluation,
} from "../catalog/pricing-calculation.ts";
import { evaluateApplicability } from "../catalog/pricing-presentation.ts";
import { multiplyRationals } from "../catalog/pricing-rational.ts";
import type {
  CalculationBinding,
  CalculationComponent,
  CalculationContributionTerm,
  CalculationOffer,
  CalculationRate,
  CalculationRateTerm,
  CalculationTerm,
  NormalizedVariant,
  Quantity,
  Selector,
} from "./schema.ts";
import type { Charge } from "./types.ts";
import type { PendingAllowance } from "./allowances.ts";
import { PricingError } from "./errors.ts";
import {
  selectVariants,
  validateSelectors,
  validityGap,
  pricingSemantics,
  type Gap,
  type Qualified,
} from "./selection.ts";
import {
  getOffer,
  offerApplicabilities,
  rawTermVariants,
  variantBindings,
  type IndexedOffer,
  type PricingSnapshot,
} from "./snapshot.ts";
import { componentInputs, validateOfferQuantities, validateSelectorVocabulary } from "./request.ts";
import { componentsAreLinked, relatedComponents } from "./composition.ts";

export interface ComponentResult {
  charges: Charge[];
  gaps: Gap[];
  allowances: PendingAllowance[];
  hasKnownAmount: boolean;
}

export function evaluateComponent(
  snapshot: PricingSnapshot,
  component: CalculationComponent,
  components: ReadonlyMap<string, CalculationComponent>,
  evaluatedAt: string,
): ComponentResult {
  return new ComponentEvaluator(snapshot, component, components, evaluatedAt).evaluate();
}

class ComponentEvaluator {
  private readonly snapshot: PricingSnapshot;
  private readonly component: CalculationComponent;
  private readonly components: ReadonlyMap<string, CalculationComponent>;
  private readonly evaluatedAt: string;
  private readonly owner: IndexedOffer;
  private readonly quantities: Quantity[];
  private readonly selectors: Selector[];
  private readonly chargedBindings = new Set<string>();
  private readonly result: ComponentResult = {
    charges: [],
    gaps: [],
    allowances: [],
    hasKnownAmount: false,
  };
  private state: CalculationOffer["states"][number] | undefined;
  private aggregation: CalculationBinding["aggregation"] | undefined;

  constructor(
    snapshot: PricingSnapshot,
    component: CalculationComponent,
    components: ReadonlyMap<string, CalculationComponent>,
    evaluatedAt: string,
  ) {
    this.snapshot = snapshot;
    this.component = component;
    this.components = components;
    this.evaluatedAt = evaluatedAt;
    this.owner = getOffer(snapshot, component.offerRef);
    const inputs = componentInputs(component);
    this.quantities = inputs.quantities;
    this.selectors = inputs.selectors;
  }

  evaluate(): ComponentResult {
    validateSelectorVocabulary(this.selectors, this.owner.provider);
    validateSelectors(this.selectors, offerApplicabilities(this.snapshot, this.owner.offer));
    validateOfferQuantities(this.quantities, this.owner);
    this.selectOfferState();
    this.aggregation = this.resolveAggregation();

    for (const term of this.owner.offer.terms) {
      this.recordRawGaps(term);
      if (term.kind === "rate") this.evaluateRate(term);
      if (term.kind === "contribution") this.evaluateContribution(term);
    }
    this.collectAllowances();
    this.checkOfferRelations();
    if (
      this.state?.state === "numeric" &&
      this.result.charges.length === 0 &&
      this.result.gaps.length === 0
    ) {
      this.recordGap("unknown_price");
    }
    return this.result;
  }

  private selectOfferState(): void {
    const selection = selectVariants(
      this.currentVariants(this.owner.offer.states),
      this.selectors,
      (variant) => variant.state,
    );
    if (selection.gap !== undefined)
      this.recordGap(selection.gap, undefined, { dimensions: selection.dimensions });
    this.state = selection.variant;
    const selectedState = this.state?.state;
    switch (selectedState) {
      case "numeric":
        return;
      case "free":
      case "included":
        this.result.hasKnownAmount = true;
        return;
      case undefined:
        this.recordGap("unknown_price");
        return;
      default:
        this.recordGap("unknown_price", undefined, { reason: selectedState });
    }
  }

  private resolveAggregation(): CalculationBinding["aggregation"] | undefined {
    const boundaries: CalculationBinding["aggregation"][] = [];
    for (const term of this.owner.offer.terms) {
      if (term.kind !== "rate" && term.kind !== "contribution") continue;
      for (const variant of this.currentVariants<NormalizedVariant>(term.variants, term.id)) {
        boundaries.push(...variantBindings(variant).map((binding) => binding.aggregation));
      }
    }
    const distinctBoundaries = uniqueCanonicalValues(boundaries);
    if (this.component.aggregation !== undefined) return this.component.aggregation;
    if (distinctBoundaries.length === 1) return distinctBoundaries[0];
    return undefined;
  }

  private evaluateRate(term: CalculationRateTerm): void {
    const variants = this.currentVariants(term.variants, term.id, this.state?.state === "numeric");
    const selection = selectVariants(
      variants,
      this.selectors,
      pricingSemantics,
      this.state?.applicability,
    );
    if (selection.gap !== undefined)
      this.recordGap(selection.gap, term.id, { dimensions: selection.dimensions });
    if (selection.variant === undefined) return;
    if (this.state?.state === "free" || this.state?.state === "included") {
      this.recordGap("conflicting_variants", term.id);
      return;
    }
    this.recordCharge(term.id, term.id, selection.variant, selection.variant.charge_binding);
  }

  private evaluateContribution(term: CalculationContributionTerm): void {
    const variants = this.currentVariants(term.variants, term.id, this.state?.state === "numeric");
    const selection = selectVariants(
      variants,
      this.selectors,
      pricingSemantics,
      this.state?.applicability,
    );
    if (selection.gap !== undefined)
      this.recordGap(selection.gap, term.id, { dimensions: selection.dimensions });
    const contribution = selection.variant;
    if (contribution === undefined) return;
    if (contribution.charge_bindings.length === 0) this.recordGap("unbound_charge", term.id);

    for (const rateRef of contribution.target_rate_refs) {
      const rateTerm = this.snapshot.rates.get(rateRef);
      if (rateTerm === undefined)
        throw new PricingError("INVALID_DATA", "Missing contribution target");
      const currentRates = this.currentVariants(rateTerm.variants, term.id, true);
      const selectedRate = selectVariants(currentRates, this.selectors, (rate) => rate.price);
      if (selectedRate.gap !== undefined) {
        this.recordGap(selectedRate.gap, term.id, { dimensions: selectedRate.dimensions });
      } else if (selectedRate.variant === undefined) {
        this.recordGap("unknown_price", term.id);
      } else {
        for (const binding of contribution.charge_bindings) {
          this.recordCharge(term.id, rateRef, selectedRate.variant, binding);
        }
      }
    }
  }

  private recordCharge(
    termRef: string,
    rateTermRef: string,
    rate: CalculationRate,
    binding?: CalculationBinding,
  ): void {
    if (binding === undefined) {
      this.recordGap("unbound_charge", termRef);
      return;
    }
    if (
      this.aggregation === undefined ||
      canonicalJson(this.aggregation) !== canonicalJson(binding.aggregation)
    ) {
      if (!this.hasLinkedAggregation(binding.aggregation))
        this.recordGap("unsupported_aggregation", termRef);
      return;
    }
    const chargeKey = canonicalJson([rateTermRef, pricingSemantics(binding)]);
    if (this.chargedBindings.has(chargeKey)) {
      throw new PricingError(
        "INVALID_COMPOSITION",
        "The same rate and quantity binding would be charged twice",
      );
    }
    this.chargedBindings.add(chargeKey);

    const quantity = calculateBoundQuantity(binding, this.quantities);
    if (quantity.kind === "missing_input") {
      this.recordGap("missing_quantity", termRef, { alternatives: quantity.alternatives });
      return;
    }
    const amount = multiplyRationals(rate.price.value, quantity.value);
    this.result.charges.push({
      componentId: this.component.id,
      offerRef: this.owner.offer.id,
      termRef,
      rateTermRef,
      quantity: quantity.value,
      grossAmount: amount,
      amount,
      denomination: rate.price.denomination,
      evidence: uniqueCanonicalValues([...rate.evidence, ...binding.evidence]),
      allowances: [],
    });
    this.result.hasKnownAmount = true;
  }

  private hasLinkedAggregation(aggregation: CalculationBinding["aggregation"]): boolean {
    for (const other of this.components.values()) {
      if (other.offerRef !== this.component.offerRef || other.aggregation === undefined) continue;
      if (
        componentsAreLinked(this.component, other) &&
        canonicalJson(other.aggregation) === canonicalJson(aggregation)
      )
        return true;
    }
    return false;
  }

  private collectAllowances(): void {
    for (const term of this.owner.offer.terms) {
      if (term.kind !== "allowance") continue;
      const selection = selectVariants(
        this.currentVariants(term.variants, term.id),
        this.selectors,
        pricingSemantics,
      );
      if (selection.gap !== undefined) {
        this.recordGap(selection.gap, term.id, { dimensions: selection.dimensions });
        continue;
      }
      const allowance = selection.variant;
      if (allowance === undefined) continue;
      if (allowance.reset.namespace !== "kmodels" || allowance.reset.value !== "none") {
        this.recordGap("unsupported_aggregation", term.id, {
          reason: "Allowance resets beyond this billing component",
        });
        continue;
      }
      this.result.allowances.push({
        component: this.component,
        termRef: term.id,
        variant: allowance,
      });
    }
  }

  private checkOfferRelations(): void {
    const related = relatedComponents(this.component, this.components);
    for (const relation of this.currentVariants(this.owner.offer.relations)) {
      if (relation.kind === "compatible_with") continue;
      const applicability = evaluateApplicability(relation.applicability, this.selectors);
      if (applicability.state === "missing") {
        this.recordGap("missing_selector", undefined, {
          dimensions: applicability.missing_dimensions,
        });
        continue;
      }
      for (const offerRef of relation.target.offer_refs) {
        const linked = related.some((target) => target.offerRef === offerRef);
        if (relation.kind === "exclusive_with" && linked) {
          throw new PricingError(
            "INVALID_COMPOSITION",
            "Exclusive offers cannot price the same event",
          );
        }
        if ((relation.kind === "requires" || relation.kind === "incurs") && !linked) {
          this.recordGap("missing_related_component", undefined, { relatedOfferRef: offerRef });
        }
      }
    }
  }

  private recordRawGaps(term: CalculationTerm): void {
    for (const variant of rawTermVariants(term)) {
      if (variant.impact === "informational") continue;
      const scope = {
        applicability: variant.possible_scope ?? { any_of: [{ all_of: [] }] },
        ...(variant.validity === undefined ? {} : { validity: variant.validity }),
      };
      if (this.currentVariants([scope], term.id).length > 0) {
        this.recordGap("unsupported_structure", term.id, { reason: variant.reason });
      }
    }
  }

  private currentVariants<T extends Qualified>(
    variants: readonly T[],
    termRef?: string,
    requireCurrent = false,
  ): T[] {
    const current: T[] = [];
    let hasOutsideValidity = false;
    for (const variant of variants) {
      if (evaluateApplicability(variant.applicability, this.selectors).state === "false") continue;
      const gap = validityGap(variant, this.evaluatedAt, this.owner.provider.snapshot.observed_at);
      if (gap === "outside_validity") {
        hasOutsideValidity = true;
      } else if (gap !== undefined) {
        this.recordGap(gap, termRef);
      } else {
        current.push(variant);
      }
    }
    if (requireCurrent && current.length === 0 && hasOutsideValidity)
      this.recordGap("outside_validity", termRef);
    return current;
  }

  private recordGap(code: Gap["code"], termRef?: string, details: Partial<Gap> = {}): void {
    this.result.gaps.push({
      code,
      componentId: this.component.id,
      offerRef: this.owner.offer.id,
      ...(termRef === undefined ? {} : { termRef }),
      ...details,
    });
  }
}

function calculateBoundQuantity(
  binding: CalculationBinding,
  quantities: Quantity[],
): ChargeQuantityEvaluation {
  try {
    return evaluateChargeQuantity(binding, quantities);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Quantity calculation failed";
    const code = message.includes("conflicting") ? "CONFLICTING_QUANTITIES" : "ARITHMETIC_LIMIT";
    throw new PricingError(code, message);
  }
}
