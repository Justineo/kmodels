import {
  matchInferencePrices,
  type InferenceMatchCandidate,
  type InferenceMatchResult,
} from "../pricing/inference-matching.ts";
import type {
  InferenceMatchData,
  InferenceMatchOffer,
} from "../pricing/inference-matching-schema.ts";
import { canonicalJsonKey } from "./canonical-value.ts";
import { evaluatePricingCondition, type PricingSelection } from "./pricing-applicability.ts";
import { unconditionalApplicability } from "./pricing-canonical.ts";
import type { PriceCondition, PublishedValidity } from "./pricing-schema.ts";
import { pricingSelection } from "./pricing-selector-input.ts";
import { publishedValidityStatus } from "./pricing-time.ts";
import type { WebsitePricingSelector } from "./website-schema.ts";

interface ChoiceDomain {
  clauses: number;
  lastClause: number;
  categories: Set<string>;
  predicates: PriceCondition[];
}

export function inferencePriceOptions(
  data: InferenceMatchData,
  initial: InferenceMatchResult,
  options: readonly WebsitePricingSelector[],
  evaluatedAt: string,
  offerRef?: string,
): WebsitePricingSelector[] {
  const missing = new Set(initial.missing_conditions.map(canonicalJsonKey));
  const required = options.filter(({ dimension }) => missing.has(canonicalJsonKey(dimension)));
  const dimensions = new Set(
    required.flatMap((option) => ("values" in option ? [canonicalJsonKey(option.dimension)] : [])),
  );
  if (dimensions.size === 0) return required;
  const indexes = indexCurrentChoices(data, initial, dimensions, evaluatedAt);
  const isAvailable = (selection: PricingSelection) => {
    if (indexes !== undefined) return indexes.some((matches) => matches(selection));
    const { reason } = matchInferencePrices(data, [selection], evaluatedAt, offerRef);
    return reason !== "incompatible_conditions" && reason !== "no_applicable_price";
  };
  return required.flatMap<WebsitePricingSelector>((option) =>
    "values" in option ? retainAvailableValues(option, isAvailable) : [option],
  );
}

function retainAvailableValues<
  Option extends Extract<WebsitePricingSelector, { values: unknown[] }>,
>(option: Option, isAvailable: (selection: PricingSelection) => boolean): Option[] {
  const values = option.values.filter((value) => {
    const selection = pricingSelection(option, typeof value === "string" ? value : value.key);
    return selection !== undefined && isAvailable(selection);
  });
  return values.length === 0 ? [] : [{ ...option, values }];
}

function indexCurrentChoices(
  data: InferenceMatchData,
  initial: InferenceMatchResult,
  dimensions: ReadonlySet<string>,
  evaluatedAt: string,
): Array<(selection: PricingSelection) => boolean> | undefined {
  // A time gap can change whether a surviving row counts as price evidence.
  if (
    publishedValidityStatus(
      { from: { value: data.observed_at, precision: "datetime" } },
      evaluatedAt,
    ) !== "current"
  )
    return;
  const notCurrent = ({ validity }: { validity?: PublishedValidity | undefined }) =>
    validity !== undefined && publishedValidityStatus(validity, evaluatedAt) !== "current";
  const hasTimeGap = (term: InferenceMatchOffer["terms"][number]) =>
    term.variants.some(notCurrent) || term.raw_variants.some(notCurrent);
  if (data.referenced_rates.some(hasTimeGap)) return;

  const offers = new Map(data.offers.map((offer) => [offer.id, offer]));
  const indexes: Array<(selection: PricingSelection) => boolean> = [];
  for (const candidate of initial.candidates) {
    const offer = offers.get(candidate.offer_ref);
    if (offer === undefined) throw new Error(`Missing mapped offer ${candidate.offer_ref}`);
    if (
      offer.states.some(notCurrent) ||
      offer.relations.some(notCurrent) ||
      offer.terms.some(hasTimeGap)
    )
      return;
    const matches = indexOfferChoices(offer, candidate, dimensions);
    if (matches === undefined) return;
    indexes.push(matches);
  }
  return indexes;
}

function* evidenceScopes(offer: InferenceMatchOffer, candidate: InferenceMatchCandidate) {
  // With terms present, a numeric state alone does not sustain a price candidate.
  for (const index of candidate.states) {
    const state = offer.states[index];
    if (state !== undefined && (state.state !== "numeric" || offer.terms.length === 0))
      yield state.applicability;
  }
  for (const selected of candidate.terms) {
    const term = offer.terms.find(({ id }) => id === selected.id);
    if (term === undefined) throw new Error(`Missing matched term ${selected.id}`);
    for (const index of selected.variants) {
      const variant = term.variants[index];
      if (variant !== undefined) yield variant.applicability;
    }
    for (const index of selected.raw_variants) {
      const variant = term.raw_variants[index];
      if (variant !== undefined) yield variant.possible_scope ?? unconditionalApplicability;
    }
  }
}

function indexOfferChoices(
  offer: InferenceMatchOffer,
  candidate: InferenceMatchCandidate,
  dimensions: ReadonlySet<string>,
): ((selection: PricingSelection) => boolean) | undefined {
  const fixed = new Map(
    candidate.selectors.map((selection) => [canonicalJsonKey(selection.dimension), selection]),
  );
  const domains = new Map<string, ChoiceDomain>();
  let clauses = 0;
  for (const scope of evidenceScopes(offer, candidate)) {
    for (const { all_of } of scope.any_of) {
      if (
        all_of.some(
          (condition) =>
            evaluatePricingCondition(
              condition,
              fixed.get(canonicalJsonKey(condition.dimension)),
            ) === "false",
        )
      )
        continue;
      clauses++;
      for (const condition of all_of) {
        const key = canonicalJsonKey(condition.dimension);
        if (!dimensions.has(key) || fixed.has(key)) continue;
        const domain = domains.get(key) ?? {
          clauses: 0,
          lastClause: 0,
          categories: new Set<string>(),
          predicates: [],
        };
        if (domain.lastClause === clauses) return;
        domain.clauses++;
        domain.lastClause = clauses;
        if (condition.kind === "categorical")
          for (const value of condition.values) domain.categories.add(canonicalJsonKey(value));
        else domain.predicates.push(condition);
        domains.set(key, domain);
      }
    }
  }
  return (selection) => {
    if (clauses === 0) return false;
    const key = canonicalJsonKey(selection.dimension);
    const bound = fixed.get(key);
    if (bound !== undefined) return canonicalJsonKey(bound) === canonicalJsonKey(selection);
    const domain = domains.get(key);
    // One compatible clause that omits a dimension admits all its values.
    if (domain?.clauses !== clauses) return true;
    return selection.kind === "categorical"
      ? domain.categories.has(canonicalJsonKey(selection.value))
      : domain.predicates.some(
          (condition) => evaluatePricingCondition(condition, selection) !== "false",
        );
  };
}
