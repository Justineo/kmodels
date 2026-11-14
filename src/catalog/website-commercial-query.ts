import { canonicalJson, uniqueCanonicalValues } from "./canonical-value.ts";
import type { CommercialChoice, PriceApplicability } from "./pricing-schema.ts";
import { evaluateApplicability, type PricingSelection } from "./pricing-applicability.ts";
import type { WebsitePricingOffer } from "./website-schema.ts";
import {
  intersectCommercialScope,
  commercialBranchesCoverScopes,
  resolveCommercialChoices,
  type AvailableCommercialChoice,
} from "../pricing/commercial-matching.ts";
import type { InferenceMatchOffer } from "../pricing/inference-matching-schema.ts";
import { fixedCommercialChoices, filterPricingSelectorValues } from "./pricing-selector-input.ts";
import { unconditionalApplicability } from "./pricing-canonical.ts";

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
    .map((choice) => ({
      ...choice,
      offer_refs: [offer.id],
      targets: [
        ...new Set(
          (subject.selection ?? []).flatMap((claim) =>
            claim.dimension === choice.dimension && claim.target !== undefined
              ? [claim.target]
              : [],
          ),
        ),
      ],
    }));
  const selectors = resolved.branches[0]?.selectors.filter((selector) =>
    resolved.branches.every((branch) =>
      branch.selectors.some((other) => canonicalJson(other) === canonicalJson(selector)),
    ),
  ) ?? [...supplied];
  // Retaining a row must also retain the scope that made it applicable. A cache
  // tariff without Speed cannot widen a selected Speed's regional coverage.
  function projectRows<T extends { applicability: PriceApplicability }>(rows: readonly T[]): T[] {
    return rows.flatMap((row) => {
      const scopes = resolved.branches.flatMap((branch) => {
        const scope = intersectCommercialScope(row.applicability, branch.scope);
        return scope !== undefined &&
          evaluateApplicability(scope, branch.selectors).state !== "false"
          ? [scope]
          : [];
      });
      if (scopes.length === 0) return [];
      if (scopes.includes(row.applicability)) return [row];
      return [
        {
          ...row,
          applicability: { any_of: uniqueCanonicalValues(scopes.flatMap(({ any_of }) => any_of)) },
        },
      ];
    });
  }
  const rates = projectRows(offer.rates);
  const states = projectRows(offer.states);
  const priceScopes = [
    ...rates,
    ...states.filter(({ state }) => state !== "numeric" || offer.rates.length === 0),
    ...projectRows(
      offer.unnormalized.map(({ possible_scope }) => ({
        applicability: possible_scope ?? unconditionalApplicability,
      })),
    ),
  ];
  return {
    available_choices: available,
    fixed_choices: fixedCommercialChoices(available, [offer.id]).filter((choice) => {
      const previous = choices.filter(({ dimension }) => dimension !== choice.dimension);
      const proposed = resolve([...previous, choice]);
      return (
        proposed.unresolved.length === 0 &&
        commercialBranchesCoverScopes(
          [
            ...offer.rates.map(({ applicability }) => applicability),
            ...offer.states
              .filter(({ state }) => state !== "numeric" || offer.rates.length === 0)
              .map(({ applicability }) => applicability),
            ...offer.allowances.map(({ applicability }) => applicability),
            ...offer.contributions.map(({ applicability }) => applicability),
            ...offer.unnormalized
              .filter(({ impact }) => impact !== "informational")
              .map(({ possible_scope }) => possible_scope ?? unconditionalApplicability),
          ],
          resolve(previous).branches,
          proposed.branches,
        )
      );
    }),
    unresolved_choices: resolved.unresolved,
    selectors,
    offer: {
      ...offer,
      selectors: offer.selectors.map((selector) => {
        if (!("values" in selector)) return selector;
        return filterPricingSelectorValues(selector, (selection) =>
          priceScopes.some(
            ({ applicability }) =>
              evaluateApplicability(applicability, [selection]).state !== "false",
          ),
        );
      }),
      rates,
      states,
      allowances: projectRows(offer.allowances),
      contributions: projectRows(offer.contributions),
    },
  };
}
