import { canonicalJson, uniqueCanonicalValues } from "../catalog/canonical-value.ts";
import { evaluateApplicability, type PricingSelection } from "../catalog/pricing-applicability.ts";
import type {
  CommercialChoice,
  PriceApplicability,
  PriceDimension,
} from "../catalog/pricing-schema.ts";
import {
  resolveCommercialChoices,
  type AvailableCommercialChoice,
  type UnresolvedCommercialChoice,
} from "./commercial-matching.ts";
import { PricingError } from "./errors.ts";
import { unconditionalApplicability } from "../catalog/pricing-canonical.ts";
import type { InferencePriceReason } from "./inference-schema.ts";
import type { ExecutionMode } from "./execution-mode.ts";
import type {
  InferenceMatchData,
  InferenceMatchOffer,
  InferenceMatchTerm,
} from "./inference-matching-schema.ts";
import { validateSelectors, validityGap, type Gap, type Qualified } from "./selection.ts";

export interface InferenceTermSelection {
  id: string;
  variants: number[];
  raw_variants: number[];
}
export interface InferenceMatchCandidate {
  rule_indexes: number[];
  model_ref?: string;
  offer_ref: string;
  selectors: PricingSelection[];
  states: number[];
  relations: number[];
  terms: InferenceTermSelection[];
  referenced_rates: InferenceTermSelection[];
  missing_conditions: PriceDimension[];
  gaps: Gap[];
}
export interface InferenceMatchResult {
  status: "matched" | "candidates" | "unknown";
  reason?: InferencePriceReason;
  candidates: InferenceMatchCandidate[];
  missing_conditions: PriceDimension[];
  requires_offer_choice: boolean;
  execution_modes: ExecutionMode[];
  requires_execution_mode_choice: boolean;
  available_choices: AvailableCommercialChoice[];
  missing_choices: CommercialChoice["dimension"][];
  unresolved_choices: UnresolvedCommercialChoice[];
}

/** The same decision is used by portable lookup and interactive UI; no evidence or price copies. */
export function matchInferencePrices(
  data: InferenceMatchData,
  supplied: readonly PricingSelection[] = [],
  evaluatedAt = data.generated_at,
  offerRef?: string,
  executionMode?: ExecutionMode,
  commercialChoices: readonly CommercialChoice[] = [],
): InferenceMatchResult {
  validateSelectors(supplied, []);
  const requested = [...commercialChoices];
  if (executionMode !== undefined) {
    const existing = requested.find(({ dimension }) => dimension === "execution");
    const value = { namespace: "kmodels" as const, value: executionMode };
    if (existing && canonicalJson(existing.value) !== canonicalJson(value))
      throw new PricingError("INVALID_REQUEST", "Conflicting execution choices");
    if (!existing) requested.push({ dimension: "execution", value });
  }
  if (new Set(requested.map(({ dimension }) => dimension)).size !== requested.length)
    throw new PricingError("INVALID_REQUEST", "Repeated commercial dimension");
  const result: InferenceMatchResult = {
    status: "unknown",
    candidates: [],
    missing_conditions: [],
    requires_offer_choice: false,
    execution_modes: [],
    requires_execution_mode_choice: false,
    available_choices: [],
    missing_choices: [],
    unresolved_choices: [],
  };
  if (data.rules.length === 0) return { ...result, reason: "unreviewed_id" };
  if (new Set(data.rules.map(({ model_ref }) => model_ref)).size > 1)
    return { ...result, reason: "ambiguous_identity" };
  let compatible = false;
  const modes = new Set<ExecutionMode>();
  const selected = new Map<string, InferenceMatchCandidate>();
  for (const [rule_index, rule] of data.rules.entries()) {
    const selectors = inferenceSelectors(rule, supplied);
    if (selectors === undefined) continue;
    compatible = true;
    for (const ref of rule.offer_refs) {
      if (offerRef !== undefined && ref !== offerRef) continue;
      const offer = data.offers.find(({ id }) => id === ref);
      if (offer === undefined) throw new Error(`Missing mapped offer ${ref}`);
      if (
        selectOffer(data, offer, rule_index, rule.model_ref, selectors, evaluatedAt) === undefined
      )
        continue;
      const resolution = resolveCommercialChoices(
        offer,
        selectors,
        requested,
        evaluatedAt,
        data.observed_at,
      );
      result.unresolved_choices.push(...resolution.unresolved);
      for (const branch of resolution.branches) {
        const candidate = selectOffer(
          data,
          offer,
          rule_index,
          rule.model_ref,
          branch.selectors,
          evaluatedAt,
          branch.scope,
        );
        if (candidate === undefined) continue;
        const { rule_indexes: _indexes, ...selection } = candidate;
        const key = canonicalJson(selection);
        const prior = selected.get(key);
        if (prior === undefined) {
          selected.set(key, candidate);
          result.candidates.push(candidate);
        } else if (!prior.rule_indexes.includes(rule_index)) prior.rule_indexes.push(rule_index);
      }
      // Each dimension is discovered under the other choices, retaining correlated scopes.
      for (const choice of uniqueCanonicalValues(
        (offer.selection ?? []).flatMap((claim) =>
          claim.alternatives.map(({ value }) => ({ dimension: claim.dimension, value })),
        ),
      )) {
        const others = requested.filter(({ dimension }) => dimension !== choice.dimension);
        const probe = resolveCommercialChoices(
          offer,
          selectors,
          [...others, choice],
          evaluatedAt,
          data.observed_at,
        );
        if (
          !probe.branches.some(
            (branch) =>
              selectOffer(
                data,
                offer,
                rule_index,
                rule.model_ref,
                branch.selectors,
                evaluatedAt,
                branch.scope,
              ) !== undefined,
          )
        )
          continue;
        const previous = result.available_choices.find(
          (item) =>
            item.dimension === choice.dimension &&
            canonicalJson(item.value) === canonicalJson(choice.value),
        );
        if (previous === undefined) result.available_choices.push({ ...choice, offer_refs: [ref] });
        else if (!previous.offer_refs.includes(ref)) previous.offer_refs.push(ref);
        if (
          choice.dimension === "execution" &&
          choice.value.namespace === "kmodels" &&
          (choice.value.value === "request" ||
            choice.value.value === "batch" ||
            choice.value.value === "realtime")
        )
          modes.add(choice.value.value);
      }
    }
  }
  const dimensions = uniqueCanonicalValues(
    result.candidates.flatMap(({ selectors }) => selectors.map(({ dimension }) => dimension)),
  );
  const choices = dimensions.filter((dimension) => {
    const key = canonicalJson(dimension);
    return (
      new Set(
        result.candidates.map(({ selectors }) => {
          const value = selectors.find((selector) => canonicalJson(selector.dimension) === key);
          return value === undefined ? "unspecified" : canonicalJson(value);
        }),
      ).size > 1
    );
  });
  for (const candidate of result.candidates)
    candidate.missing_conditions = uniqueCanonicalValues([
      ...candidate.missing_conditions,
      ...choices,
    ]);
  result.missing_conditions = uniqueCanonicalValues(
    result.candidates.flatMap(({ missing_conditions }) => missing_conditions),
  );
  result.requires_offer_choice =
    new Set(result.candidates.map(({ offer_ref }) => offer_ref)).size > 1;
  result.execution_modes = [...modes].sort();
  result.unresolved_choices = uniqueCanonicalValues(result.unresolved_choices);
  result.missing_choices = [
    ...new Set(result.available_choices.map(({ dimension }) => dimension)),
  ].filter(
    (dimension) =>
      !requested.some((choice) => choice.dimension === dimension) &&
      (result.available_choices.filter((choice) => choice.dimension === dimension).length > 1 ||
        result.missing_conditions.some(
          (condition) => condition.namespace === "kmodels" && condition.value === dimension,
        )),
  );
  result.requires_execution_mode_choice = result.missing_choices.includes("execution");
  if (!compatible) return { ...result, reason: "incompatible_conditions" };
  if (
    requested.length > 0 &&
    result.candidates.length === 0 &&
    result.unresolved_choices.length > 0
  )
    return {
      ...result,
      reason:
        executionMode === undefined ? "unreviewed_commercial_choice" : "unreviewed_execution_mode",
    };
  if (result.candidates.length === 0) return { ...result, reason: "no_applicable_price" };
  const usable = result.candidates.some((candidate) => {
    const offer = data.offers.find(({ id }) => id === candidate.offer_ref);
    return (
      candidate.terms.some(
        (term) =>
          term.variants.length > 0 &&
          offer?.terms.find(({ id }) => id === term.id)?.kind === "rate",
      ) ||
      candidate.referenced_rates.some(({ variants }) => variants.length > 0) ||
      candidate.states.some((index) =>
        ["free", "included"].includes(offer?.states[index]?.state ?? ""),
      )
    );
  });
  if (!usable) {
    const gaps = result.candidates.flatMap(({ gaps }) => gaps);
    return {
      ...result,
      reason:
        gaps.length > 0 && gaps.every(({ code }) => code === "outside_validity")
          ? "no_applicable_price"
          : "unresolved_price",
    };
  }
  result.status =
    result.missing_conditions.length > 0 ||
    result.requires_offer_choice ||
    result.missing_choices.length > 0 ||
    result.unresolved_choices.length > 0 ||
    result.candidates.some(({ gaps }) => gaps.length > 0)
      ? "candidates"
      : "matched";
  return result;
}

export function inferenceSelectors(
  rule: InferenceMatchData["rules"][number],
  supplied: readonly PricingSelection[],
): PricingSelection[] | undefined {
  const fixed: PricingSelection[] = [
    ...rule.fixed_selectors,
    ...(rule.model_ref === undefined
      ? []
      : [
          {
            dimension: { namespace: "kmodels", value: "model" },
            kind: "categorical",
            value: { namespace: "kmodels", value: rule.model_ref },
          } satisfies PricingSelection,
        ]),
  ];
  const selectors = new Map(supplied.map((value) => [canonicalJson(value.dimension), value]));
  for (const value of fixed) {
    const key = canonicalJson(value.dimension);
    const previous = selectors.get(key);
    if (previous !== undefined && canonicalJson(previous) !== canonicalJson(value)) return;
    selectors.set(key, value);
  }
  return [...selectors.values()];
}

function selectOffer(
  data: InferenceMatchData,
  offer: InferenceMatchOffer,
  rule_index: number,
  model_ref: string | undefined,
  selectors: PricingSelection[],
  evaluatedAt: string,
  scope: PriceApplicability = unconditionalApplicability,
): InferenceMatchCandidate | undefined {
  const commercialScope = evaluateApplicability(scope, selectors);
  if (commercialScope.state === "false") return;
  const offerRef = offer.id;
  const candidate: InferenceMatchCandidate = {
    rule_indexes: [rule_index],
    ...(model_ref === undefined ? {} : { model_ref }),
    offer_ref: offerRef,
    selectors,
    states: [],
    relations: [],
    terms: [],
    referenced_rates: [],
    missing_conditions: commercialScope.missing_dimensions,
    gaps: [],
  };
  const applicable = <T extends Qualified & { semantics: number }>(
    variants: T[],
    termRef?: string,
    retainUnresolvedRates = false,
  ): number[] => {
    validateSelectors(
      selectors,
      variants.map(({ applicability }) => applicability),
    );
    let outsideValidity = false;
    let matchedCount = 0;
    let firstSemantics: number | undefined;
    let competingSemantics = false;
    const indexes: number[] = [];
    for (const [index, variant] of variants.entries()) {
      const match = evaluateApplicability(variant.applicability, selectors);
      if (match.state === "false") continue;
      const gap = validityGap(variant, evaluatedAt, data.observed_at);
      if (gap !== undefined) {
        if (gap === "outside_validity") outsideValidity = true;
        else candidate.gaps.push({ offerRef, ...(termRef ? { termRef } : {}), code: gap });
        if (retainUnresolvedRates && gap === "unresolved_validity") {
          candidate.missing_conditions.push(...match.missing_dimensions);
          indexes.push(index);
        }
        continue;
      }
      if (match.state === "true") matchedCount += 1;
      firstSemantics ??= variant.semantics;
      competingSemantics ||= variant.semantics !== firstSemantics;
      candidate.missing_conditions.push(...match.missing_dimensions);
      indexes.push(index);
    }
    if (indexes.length === 0 && outsideValidity)
      candidate.gaps.push({ offerRef, ...(termRef ? { termRef } : {}), code: "outside_validity" });
    if (matchedCount > 1 && competingSemantics)
      candidate.gaps.push({
        offerRef,
        ...(termRef ? { termRef } : {}),
        code: "conflicting_variants",
      });
    return indexes;
  };
  candidate.states = applicable(offer.states);
  candidate.relations = offer.relations.flatMap((relation, index) =>
    applicable([relation]).length ? [index] : [],
  );
  function selectTerm(term: InferenceMatchTerm): InferenceTermSelection[] {
    const raw_variants = term.raw_variants.flatMap((variant, index) => {
      const rawScope = variant.possible_scope ?? unconditionalApplicability;
      validateSelectors(selectors, [rawScope]);
      const match = evaluateApplicability(rawScope, selectors);
      if (match.state === "false") return [];
      const gap = validityGap(
        { applicability: rawScope, ...variant },
        evaluatedAt,
        data.observed_at,
      );
      if (gap === "outside_validity") return [];
      if (variant.impact !== "informational") {
        candidate.missing_conditions.push(...match.missing_dimensions);
        if (gap !== undefined) candidate.gaps.push({ offerRef, termRef: term.id, code: gap });
        candidate.gaps.push({
          offerRef,
          termRef: term.id,
          code: "unsupported_structure",
          reason: variant.reason,
        });
      }
      return [index];
    });
    const variants = applicable(term.variants, term.id, term.kind === "rate");
    return variants.length + raw_variants.length === 0
      ? []
      : [{ id: term.id, variants, raw_variants }];
  }
  candidate.terms = offer.terms.flatMap(selectTerm);
  const references = new Set(
    candidate.terms.flatMap((selected) => {
      const term = offer.terms.find(({ id }) => id === selected.id);
      return term?.kind === "contribution"
        ? selected.variants.flatMap((index) => term.variants[index]?.target_rate_refs ?? [])
        : [];
    }),
  );
  for (const ref of references) {
    const rate = data.referenced_rates.find(({ id }) => id === ref);
    if (rate === undefined) throw new Error(`Missing referenced price ${ref}`);
    candidate.referenced_rates.push(...selectTerm(rate));
  }
  for (const index of candidate.states) {
    const state = offer.states[index]?.state;
    if (state !== undefined && !["numeric", "free", "included"].includes(state))
      candidate.gaps.push({ offerRef, code: "unknown_price", reason: state });
  }
  candidate.missing_conditions = uniqueCanonicalValues(candidate.missing_conditions);
  candidate.gaps = uniqueCanonicalValues(candidate.gaps);
  if (
    offer.terms.length > 0 &&
    candidate.terms.length === 0 &&
    candidate.gaps.length === 0 &&
    candidate.states.every((index) => offer.states[index]?.state === "numeric")
  )
    return;
  return candidate.states.length + candidate.terms.length + candidate.gaps.length === 0
    ? undefined
    : candidate;
}
