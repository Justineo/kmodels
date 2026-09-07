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
import type { Requirements } from "./types.ts";
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
    collectVariantRequirements(result, term, variant);
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
  result: Requirements,
  term: CalculationTerm,
  variant: NormalizedVariant,
): void {
  const chargeRequirement = {
    termRef: term.id,
    kind: term.kind,
    applicability: variant.applicability,
    ...(variant.validity === undefined ? {} : { validity: variant.validity }),
    ...("target_rate_refs" in variant ? { targetRateRefs: variant.target_rate_refs } : {}),
  };
  const bindings = variantBindings(variant);
  if (bindings.length === 0) {
    result.charges.push({ ...chargeRequirement, alternatives: [] });
    if (term.kind !== "allowance") {
      result.gaps.push({ offerRef: result.offerRef, termRef: term.id, code: "unbound_charge" });
    }
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
