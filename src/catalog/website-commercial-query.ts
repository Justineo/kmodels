import { canonicalJson, uniqueCanonicalValues } from "./canonical-value.ts";
import type { CommercialChoice, PriceApplicability } from "./pricing-schema.ts";
import { evaluateApplicability, type PricingSelection } from "./pricing-applicability.ts";
import type { WebsitePricingOffer } from "./website-schema.ts";
import {
  intersectCommercialScope,
  resolveCommercialChoices,
  type AvailableCommercialChoice,
} from "../pricing/commercial-matching.ts";
import type { InferenceMatchOffer } from "../pricing/inference-matching-schema.ts";

/** Resource and fallback offer controls use the same canonical-to-native resolver as ID lookup. */
export function queryWebsiteCommercialOffer(
  offer: WebsitePricingOffer,
  supplied: readonly PricingSelection[],
  choices: readonly CommercialChoice[],
  evaluatedAt: string,
) {
  const subject: InferenceMatchOffer = {
    id: offer.id,
    states: [],
    relations: [],
    terms: [],
    selection: offer.commercial_selection?.claims ?? [],
  };
  const observedAt = offer.commercial_selection?.observed_at ?? evaluatedAt;
  const resolve = (selected: readonly CommercialChoice[]) =>
    resolveCommercialChoices(subject, supplied, selected, evaluatedAt, observedAt);
  const resolved = resolve(choices);
  const applicable = (scope: PriceApplicability, branches = resolved.branches) =>
    branches.some((branch) => {
      const intersection = intersectCommercialScope(scope, branch.scope);
      return (
        intersection !== undefined &&
        evaluateApplicability(intersection, branch.selectors).state !== "false"
      );
    });
  const available: AvailableCommercialChoice[] = uniqueCanonicalValues(
    (subject.selection ?? []).flatMap(({ dimension, alternatives }) =>
      alternatives.map(({ value }) => ({ dimension, value })),
    ),
  )
    .filter((choice) => {
      const probe = resolve([
        ...choices.filter(({ dimension }) => dimension !== choice.dimension),
        choice,
      ]);
      return offer.rates.length > 0
        ? offer.rates.some(({ applicability }) => applicable(applicability, probe.branches))
        : offer.states.some(({ applicability }) => applicable(applicability, probe.branches));
    })
    .map((choice) => ({ ...choice, offer_refs: [offer.id] }));
  const selectors = resolved.branches[0]?.selectors.filter((selector) =>
    resolved.branches.every((branch) =>
      branch.selectors.some((other) => canonicalJson(other) === canonicalJson(selector)),
    ),
  ) ?? [...supplied];
  return {
    available_choices: available,
    unresolved_choices: resolved.unresolved,
    selectors,
    offer: {
      ...offer,
      rates: offer.rates.filter(({ applicability }) => applicable(applicability)),
      states: offer.states.filter(({ applicability }) => applicable(applicability)),
      allowances: offer.allowances.filter(({ applicability }) => applicable(applicability)),
      contributions: offer.contributions.filter(({ applicability }) => applicable(applicability)),
    },
  };
}
