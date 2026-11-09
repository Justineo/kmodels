import { canonicalJsonKey } from "./canonical-value.ts";
import {
  evaluateApplicability,
  evaluateModelApplicability,
  withModelSelection,
  type PricingSelection,
} from "./pricing-applicability.ts";
import type { WebsiteInferenceCandidate } from "./inference-price-presentation.ts";
import { isModelDimension } from "./pricing-presentation.ts";
import { publishedValidityStatus } from "./pricing-time.ts";
import type {
  WebsitePriceApplicability,
  WebsitePricingOffer,
  WebsitePricingSelector,
} from "./website-schema.ts";

export type PricingRegion = Extract<PricingSelection, { kind: "categorical" }>;

export interface WebsitePricingContext {
  modelRef: string;
  offerRefs: readonly string[];
  selections: readonly PricingSelection[];
}

export function inferencePricingContext(
  modelRef: string,
  candidates: readonly WebsiteInferenceCandidate[],
  chosen: readonly PricingSelection[],
): WebsitePricingContext {
  const [first, ...others] = candidates;
  const shared = others.map(({ selectors }) => new Set(selectors.map(canonicalJsonKey)));
  return {
    modelRef,
    offerRefs: [...new Set(candidates.map(({ offer_ref }) => offer_ref))],
    selections: (first?.selectors ?? chosen).filter(
      (selection) =>
        !isModelDimension(selection.dimension) &&
        shared.every((values) => values.has(canonicalJsonKey(selection))),
    ),
  };
}

export function preferredPricingRegion(
  context: WebsitePricingContext | undefined,
  providerId: string,
): PricingRegion | undefined {
  return context?.selections.find(
    (selection): selection is PricingRegion =>
      selection.kind === "categorical" &&
      selection.dimension.namespace === "kmodels" &&
      selection.dimension.value === "region" &&
      selection.value.namespace === "provider" &&
      selection.value.provider_id === providerId,
  );
}

export function linkedPricingSelections(
  offer: WebsitePricingOffer,
  context: WebsitePricingContext,
  evaluatedAt: string,
): PricingSelection[] {
  if (context.offerRefs.length !== 1 || !offer.mechanism_links) return [];
  const [offerRef] = context.offerRefs;
  const shared = new Set<string>();
  for (const link of offer.mechanism_links) {
    const { offer_ref, kind, applicability, validity, shared_dimensions } = link;
    if (
      offer_ref !== offerRef ||
      kind === "exclusive_with" ||
      shared_dimensions === undefined ||
      publishedValidityStatus(validity, evaluatedAt) !== "current" ||
      evaluateModelApplicability(applicability, context.modelRef, context.selections).state !==
        "true"
    )
      continue;
    for (const dimension of shared_dimensions) shared.add(canonicalJsonKey(dimension));
  }
  return context.selections.filter(({ dimension }) => shared.has(canonicalJsonKey(dimension)));
}

export function serviceRegionPreference(
  offer: WebsitePricingOffer,
  selectors: readonly WebsitePricingSelector[],
  region: PricingRegion,
  modelRef: string | undefined,
  fixed: readonly PricingSelection[],
): { key: string; value: string; label: string } | undefined {
  const dimension = canonicalJsonKey(region.dimension);
  const selector = selectors.find((option) => canonicalJsonKey(option.dimension) === dimension);
  if (selector?.kind !== "categorical") return;
  const value = selector.values.find(
    (option) => canonicalJsonKey(option.value) === canonicalJsonKey(region.value),
  );
  if (value === undefined) return;
  const selections =
    modelRef === undefined ? [...fixed, region] : withModelSelection([...fixed, region], modelRef);
  const admitsRegion = ({ any_of }: WebsitePriceApplicability) =>
    any_of.some(
      (clause) =>
        clause.all_of.some((condition) => canonicalJsonKey(condition.dimension) === dimension) &&
        evaluateApplicability({ any_of: [clause] }, selections).state !== "false",
    );
  const supported =
    [offer.rates, offer.allowances, offer.contributions].some((rows) =>
      rows.some(({ applicability }) => admitsRegion(applicability)),
    ) ||
    offer.unnormalized.some(({ possible_scope }) =>
      possible_scope === undefined ? false : admitsRegion(possible_scope),
    ) ||
    offer.states.some(
      ({ state, applicability }) =>
        (state === "free" || state === "included") && admitsRegion(applicability),
    );
  return supported ? { key: selector.key, value: value.key, label: value.label } : undefined;
}
