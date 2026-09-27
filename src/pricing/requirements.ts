import { uniqueCanonicalValues } from "../catalog/canonical-value.ts";
import { requiredUsageSignalAlternatives } from "../catalog/pricing-calculation.ts";
import { evaluateApplicability } from "../catalog/pricing-presentation.ts";
import {
  selectionRequestSchema,
  type CalculationTerm,
  type NormalizedVariant,
  type SelectionRequest,
  type Selector,
} from "./schema.ts";
import type { ChargeRequirement, ReferencedRateRequirement, Requirements } from "./types.ts";
import {
  getOffer,
  offerApplicabilities,
  rawTermVariants,
  variantBindings,
  type PricingSnapshot,
} from "./snapshot.ts";
import { validateSelectors } from "./selection.ts";
import { parseRequest, validateSelectorVocabulary } from "./request.ts";

export function discoverRequirements(
  snapshot: PricingSnapshot,
  input: SelectionRequest,
): Requirements {
  const request = parseRequest(selectionRequestSchema, input);
  const { offer, provider, book } = getOffer(snapshot, request.offerRef);
  const scopes = offerApplicabilities(snapshot, offer);
  validateSelectorVocabulary(request.selectors, provider);
  validateSelectors(request.selectors, scopes);

  const result: Requirements = {
    offerRef: offer.id,
    states: offer.states,
    selectors: uniqueCanonicalValues(
      scopes.flatMap((scope) => evaluateApplicability(scope, request.selectors).missing_dimensions),
    ),
    charges: [],
    aggregationBoundaries: [],
    relatedCharges: offer.relations,
    resourceEdges: book.resource_edges,
    gaps: [],
  };
  for (const term of offer.terms)
    collectTermRequirements(snapshot, result, term, request.selectors);
  for (const state of offer.states) {
    if (["numeric", "free", "included"].includes(state.state)) continue;
    if (evaluateApplicability(state.applicability, request.selectors).state === "false") continue;
    result.gaps.push({ offerRef: offer.id, code: "unknown_price", reason: state.state });
  }
  result.aggregationBoundaries = uniqueCanonicalValues(result.aggregationBoundaries);
  return structuredClone(result);
}

function collectTermRequirements(
  snapshot: PricingSnapshot,
  result: Requirements,
  term: CalculationTerm,
  selectors: Selector[],
): void {
  collectRawGaps(result, term, term.id, selectors);
  if (term.kind === "raw") return;
  for (const variant of term.variants) {
    if (evaluateApplicability(variant.applicability, selectors).state === "false") continue;
    collectVariantRequirements(snapshot, result, term.id, variant, selectors);
    if (!("target_rate_refs" in variant)) continue;
    for (const rateRef of variant.target_rate_refs) {
      const rateTerm = snapshot.rates.get(rateRef);
      if (rateTerm !== undefined) collectRawGaps(result, rateTerm, term.id, selectors);
    }
  }
}

function collectRawGaps(
  result: Requirements,
  term: CalculationTerm,
  gapTermRef: string,
  selectors: Selector[],
): void {
  for (const variant of rawTermVariants(term)) {
    if (variant.impact === "informational") continue;
    if (
      variant.possible_scope !== undefined &&
      evaluateApplicability(variant.possible_scope, selectors).state === "false"
    )
      continue;
    result.gaps.push({
      offerRef: result.offerRef,
      termRef: gapTermRef,
      code: "unsupported_structure",
      reason: variant.reason,
    });
  }
}

function collectVariantRequirements(
  snapshot: PricingSnapshot,
  result: Requirements,
  termRef: string,
  variant: NormalizedVariant,
  selectors: Selector[],
): void {
  const common = {
    termRef,
    applicability: variant.applicability,
    ...(variant.validity === undefined ? {} : { validity: variant.validity }),
    alternatives: [],
  };
  if ("benefit" in variant) {
    result.charges.push({
      ...common,
      kind: "allowance",
      benefit: variant.benefit,
      target: variant.target,
      reset: variant.reset,
    });
    if (variant.reset.namespace !== "kmodels" || variant.reset.value !== "none") {
      result.gaps.push({
        offerRef: result.offerRef,
        termRef,
        code: "unsupported_aggregation",
        reason: "Allowance resets beyond this billing component",
      });
    }
    if (variant.benefit.kind === "rate_substitution") {
      result.gaps.push({
        offerRef: result.offerRef,
        termRef,
        code: "unsupported_structure",
        reason: "Allowance rate substitution is not supported",
      });
    }
    return;
  }
  const chargeRequirement: ChargeRequirement =
    "price" in variant
      ? { ...common, kind: "rate", selectorSources: variant.selector_sources ?? [] }
      : {
          ...common,
          kind: "contribution",
          targetRateRefs: variant.target_rate_refs,
          referencedRates: referencedRateRequirements(
            snapshot,
            variant.target_rate_refs,
            selectors,
          ),
        };
  const bindings = variantBindings(variant);
  if (bindings.length === 0) {
    result.charges.push(chargeRequirement);
    result.gaps.push({ offerRef: result.offerRef, termRef, code: "unbound_charge" });
    return;
  }
  for (const binding of bindings) {
    result.charges.push({
      ...chargeRequirement,
      binding,
      alternatives: requiredUsageSignalAlternatives(binding),
    });
    result.aggregationBoundaries.push(binding.aggregation);
  }
}

function referencedRateRequirements(
  snapshot: PricingSnapshot,
  rateRefs: string[],
  selectors: Selector[],
): ReferencedRateRequirement[] {
  return rateRefs.flatMap((rateTermRef) => {
    const term = snapshot.rates.get(rateTermRef);
    if (term === undefined) return [];
    return term.variants
      .filter(
        (variant) => evaluateApplicability(variant.applicability, selectors).state !== "false",
      )
      .map((variant) => ({
        rateTermRef,
        applicability: variant.applicability,
        ...(variant.validity === undefined ? {} : { validity: variant.validity }),
        selectorSources: variant.selector_sources ?? [],
      }));
  });
}
