import type { InferencePriceReason } from "../pricing/inference-schema.ts";
import type { InferenceMatchResult } from "../pricing/inference-matching.ts";
import { matchInferencePrices } from "../pricing/inference-matching.ts";
import type { PricingSelection } from "./pricing-applicability.ts";
import { formatDimension } from "./pricing-presentation.ts";
import type { WebsiteInferencePrice } from "./website-schema.ts";

export function inferencePriceExplanation(result: {
  status: InferenceMatchResult["status"];
  reason?: InferencePriceReason;
  candidates: ReadonlyArray<{ gaps: ReadonlyArray<{ code: string }> }>;
  requires_offer_choice?: boolean;
}): string {
  const explanations: Record<InferencePriceReason, string> = {
    unreviewed_id: "No verified inference price mapping is available for this identifier.",
    ambiguous_identity:
      "This ID has more than one evidenced model identity; its price mapping is unresolved.",
    incompatible_conditions:
      "The selected conditions conflict with this ID's documented pricing scope.",
    no_applicable_price: "No published price applies to these conditions at the evaluated time.",
    unresolved_price: "The ID mapping is known, but the available price evidence is incomplete.",
  };
  if (result.reason !== undefined) return explanations[result.reason];
  if (
    result.candidates.some(({ gaps }) => gaps.some(({ code }) => code === "conflicting_variants"))
  )
    return "Published prices conflict under these conditions. No single price has been selected.";
  if (
    result.candidates.some(({ gaps }) =>
      gaps.some(
        ({ code }) => code === "unresolved_validity" || code === "historical_evidence_missing",
      ),
    )
  )
    return "Price validity is not fully established at the evaluated time. Review the available candidates.";
  if (result.requires_offer_choice)
    return "Choose a pricing plan and any remaining conditions to identify applicable prices.";
  return result.status === "matched"
    ? "The documented ID mapping identifies these prices."
    : "Prices depend on the conditions shown below. No single price has been selected.";
}

export interface WebsiteInferenceCandidate {
  offer_ref: string;
  selectors: PricingSelection[];
  row_keys?: string[];
}
export type WebsiteInferenceQuery = Omit<WebsiteInferencePrice, "candidates"> & {
  candidates: WebsiteInferenceCandidate[];
  requires_offer_choice: boolean;
};

export function queryWebsiteInferencePrice(
  price: WebsiteInferencePrice,
  selectors: readonly PricingSelection[],
  evaluatedAt: string,
  offerRef?: string,
): WebsiteInferenceQuery {
  if (price.matching === undefined)
    return {
      ...price,
      requires_offer_choice: new Set(price.candidates.map(({ offer_ref }) => offer_ref)).size > 1,
    };
  const result = matchInferencePrices(price.matching, selectors, evaluatedAt, offerRef);
  const { reason: _reason, ...base } = price;
  return {
    ...base,
    status: result.status,
    ...(result.reason === undefined ? {} : { reason: result.reason }),
    explanation: inferencePriceExplanation(result),
    missing_conditions: result.missing_conditions.map(formatDimension),
    requires_offer_choice: result.requires_offer_choice,
    candidates: (result.reason === "no_applicable_price" ? [] : result.candidates).map(
      (candidate) => {
        const offer = price.matching?.offers.find(({ id }) => id === candidate.offer_ref);
        return {
          offer_ref: candidate.offer_ref,
          selectors: candidate.selectors,
          row_keys: [
            ...candidate.states.map((index) => `state:${index}`),
            ...candidate.terms.flatMap((term) => [
              ...term.variants.map(
                (index) =>
                  `${term.id}:${offer?.terms.find(({ id }) => id === term.id)?.kind}:${index}`,
              ),
              ...term.raw_variants.map((index) => `${term.id}:raw:${index}`),
            ]),
          ],
        };
      },
    ),
  };
}
