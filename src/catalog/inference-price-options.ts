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
import type {
  CommercialChoice,
  PriceApplicability,
  PriceCondition,
  PublishedValidity,
} from "./pricing-schema.ts";
import {
  fixedCommercialChoices,
  fixedPricingSelections,
  filterPricingSelectorValues,
} from "./pricing-selector-input.ts";
import {
  commercialBranchesCoverScopes,
  intersectCommercialScope,
  resolveCommercialChoices,
  type AvailableCommercialChoice,
} from "../pricing/commercial-matching.ts";
import { publishedValidityStatus } from "./pricing-time.ts";
import type { WebsiteInferencePrice, WebsitePricingSelector } from "./website-schema.ts";

interface ChoiceDomain {
  clauses: number;
  lastClause: number;
  categories: Set<string>;
  predicates: PriceCondition[];
}

export function fixedInferenceSelections(
  options: readonly WebsitePricingSelector[],
  current: InferenceMatchResult,
): PricingSelection[] {
  const missing = new Set(current.missing_conditions.map(canonicalJsonKey));
  return fixedPricingSelections(
    options.filter(({ dimension }) => missing.has(canonicalJsonKey(dimension))),
    current.candidates.flatMap(({ selectors }) => selectors),
  );
}

export function fixedInferenceCommercialChoices(
  data: InferenceMatchData,
  current: InferenceMatchResult,
  options: readonly AvailableCommercialChoice[],
  evaluatedAt: string,
  choices: readonly CommercialChoice[],
): AvailableCommercialChoice[] {
  return fixedCommercialChoices(
    options,
    current.candidates.map(({ offer_ref }) => offer_ref),
  ).filter((choice) => {
    // Explicit choices remain editable; their bindings cannot prove automatic applicability.
    if (choices.some(({ dimension }) => dimension === choice.dimension)) return false;
    return current.candidates.every((candidate) => {
      const offer = data.offers.find(({ id }) => id === candidate.offer_ref);
      if (offer === undefined) return false;
      const resolve = (selected: readonly CommercialChoice[]) =>
        resolveCommercialChoices(
          offer,
          candidate.selectors,
          selected,
          evaluatedAt,
          data.observed_at,
        );
      const proposed = resolve([...choices, choice]);
      return (
        proposed.unresolved.length === 0 &&
        commercialBranchesCoverScopes(
          inferenceCandidateScopes(offer, candidate),
          resolve(choices).branches,
          proposed.branches,
        )
      );
    });
  });
}

export function inferencePriceOptions(
  data: InferenceMatchData,
  initial: InferenceMatchResult,
  options: readonly WebsitePricingSelector[],
  evaluatedAt: string,
  offerRef?: string,
  choices: readonly CommercialChoice[] = [],
): WebsitePricingSelector[] {
  const missing = new Set(initial.missing_conditions.map(canonicalJsonKey));
  const required = options.filter(({ dimension }) => missing.has(canonicalJsonKey(dimension)));
  const dimensions = new Set(
    required.flatMap((option) => ("values" in option ? [canonicalJsonKey(option.dimension)] : [])),
  );
  if (dimensions.size === 0) return required;
  const indexes = indexCurrentChoices(data, initial, dimensions, evaluatedAt, choices);
  const isAvailable = (selection: PricingSelection) => {
    if (indexes !== undefined) return indexes.some((matches) => matches(selection));
    const { reason } = matchInferencePrices(
      data,
      [selection],
      evaluatedAt,
      offerRef,
      undefined,
      choices,
    );
    return reason !== "incompatible_conditions" && reason !== "no_applicable_price";
  };
  return required.flatMap<WebsitePricingSelector>((option) => {
    if (!("values" in option)) return [option];
    const filtered = filterPricingSelectorValues(option, isAvailable);
    return filtered.values.length === 0 ? [] : [filtered];
  });
}

function indexCurrentChoices(
  data: InferenceMatchData,
  initial: InferenceMatchResult,
  dimensions: ReadonlySet<string>,
  evaluatedAt: string,
  choices: readonly CommercialChoice[],
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
    const branches = resolveCommercialChoices(
      offer,
      candidate.selectors,
      choices,
      evaluatedAt,
      data.observed_at,
    ).branches;
    const scopes = Array.from(inferenceCandidateScopes(offer, candidate)).flatMap((price) =>
      branches.flatMap(({ scope }) => intersectCommercialScope(price, scope) ?? []),
    );
    const matches = indexOfferChoices(scopes, candidate, dimensions);
    if (matches === undefined) return;
    indexes.push(matches);
  }
  return indexes;
}

export function* inferenceCandidateScopes(
  offer: InferenceMatchOffer,
  candidate: InferenceMatchCandidate,
) {
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
  scopes: Iterable<PriceApplicability>,
  candidate: InferenceMatchCandidate,
  dimensions: ReadonlySet<string>,
): ((selection: PricingSelection) => boolean) | undefined {
  const fixed = new Map(
    candidate.selectors.map((selection) => [canonicalJsonKey(selection.dimension), selection]),
  );
  const domains = new Map<string, ChoiceDomain>();
  let clauses = 0;
  for (const scope of scopes) {
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

/**
 * Each inference ID publishes its own condition domain. Linking IDs through those domains lets a
 * caller start from a condition such as Region: the chosen value narrows the IDs to those whose
 * published prices or fixed ID scope admit it.
 */
export function inferenceIdConditionDomains(
  prices: readonly Pick<WebsiteInferencePrice, "model_id" | "matching" | "pricing_options">[],
  evaluatedAt: string,
  choices: readonly CommercialChoice[] = [],
): Map<string, WebsitePricingSelector[]> {
  const domains = new Map<string, WebsitePricingSelector[]>();
  for (const { model_id, matching, pricing_options } of prices) {
    if (matching === undefined) continue;
    const initial = matchInferencePrices(matching, [], evaluatedAt, undefined, undefined, choices);
    domains.set(
      model_id,
      initial.reason === "no_applicable_price" || initial.reason === "incompatible_conditions"
        ? []
        : inferencePriceOptions(
            matching,
            initial,
            pricing_options ?? [],
            evaluatedAt,
            undefined,
            choices,
          ),
    );
  }
  return domains;
}

export function inferenceIdAdmits(
  price: Pick<WebsiteInferencePrice, "model_id" | "matching">,
  domain: readonly WebsitePricingSelector[] | undefined,
  selection: PricingSelection,
): boolean {
  if (domain === undefined) return false;
  const dimension = canonicalJsonKey(selection.dimension);
  const fixed = (price.matching?.rules ?? [])
    .flatMap(({ fixed_selectors }) => fixed_selectors)
    .filter((selector) => canonicalJsonKey(selector.dimension) === dimension);
  if (fixed.length > 0)
    return fixed.some((selector) => canonicalJsonKey(selector) === canonicalJsonKey(selection));
  const option = domain.find((selector) => canonicalJsonKey(selector.dimension) === dimension);
  if (option === undefined) return true;
  return (
    option.kind === "categorical" &&
    selection.kind === "categorical" &&
    option.values.some(({ value }) => canonicalJsonKey(value) === canonicalJsonKey(selection.value))
  );
}

export function compatibleInferenceIds(
  prices: readonly Pick<WebsiteInferencePrice, "model_id" | "matching">[],
  domains: ReadonlyMap<string, readonly WebsitePricingSelector[]>,
  selections: readonly PricingSelection[],
): string[] {
  return prices
    .filter((price) =>
      selections.every((selection) =>
        inferenceIdAdmits(price, domains.get(price.model_id), selection),
      ),
    )
    .map(({ model_id }) => model_id);
}

/** Categorical values published by any linked ID, in the source option's order. */
export function linkedConditionValues(
  source: WebsitePricingSelector,
  option: WebsitePricingSelector,
  domains: ReadonlyMap<string, readonly WebsitePricingSelector[]>,
): WebsitePricingSelector {
  if (option.kind !== "categorical" || source.kind !== "categorical") return option;
  const dimension = canonicalJsonKey(option.dimension);
  const keys = new Set(option.values.map(({ key }) => key));
  for (const domain of domains.values())
    for (const selector of domain)
      if (selector.kind === "categorical" && canonicalJsonKey(selector.dimension) === dimension)
        for (const { key } of selector.values) keys.add(key);
  return { ...option, values: source.values.filter(({ key }) => keys.has(key)) };
}
