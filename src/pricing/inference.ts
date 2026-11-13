import { canonicalJson, uniqueCanonicalValues } from "../catalog/canonical-value.ts";
import type { PriceDimension } from "../catalog/pricing-schema.ts";
import type { ExecutionMode } from "./execution-mode.ts";
import type {
  AvailableCommercialChoice,
  UnresolvedCommercialChoice,
} from "./commercial-matching.ts";
import type { CommercialChoice } from "../catalog/pricing-schema.ts";
import { PricingError } from "./errors.ts";
import {
  inferencePriceMappingSchema,
  inferencePriceQuerySchema,
  type InferencePriceQuery,
  type InferencePriceMapping,
  type InferencePriceRule,
  type InferencePriceReason,
} from "./inference-schema.ts";
import { parseEvaluationTime, parseRequest, validateSelectorVocabulary } from "./request.ts";
import {
  selectorSchema,
  type PriceDataEnvelope,
  type PriceDataOffer,
  type PriceDataProvider,
  type PriceDataTerm,
  type Selector,
} from "./schema.ts";
import { inferenceMatchData } from "./inference-matching-data.ts";
import {
  inferenceSelectors,
  matchInferencePrices,
  type InferenceTermSelection,
} from "./inference-matching.ts";
import { validateSelectors, type Gap } from "./selection.ts";
import { createPricingSnapshot, offerApplicabilities, type PricingSnapshot } from "./snapshot.ts";

export interface InferencePriceCandidate {
  model_ref: string;
  book_ref: string;
  offer: PriceDataOffer;
  referenced_rates: Extract<PriceDataTerm, { kind: "rate" }>[];
  selectors: Selector[];
  evidence: InferencePriceRule["evidence"];
  missing_conditions: PriceDimension[];
  gaps: Gap[];
}

export interface InferencePriceResult {
  query: InferencePriceQuery;
  snapshot: PriceDataEnvelope["snapshot"];
  evaluated_at: string;
  status: "matched" | "candidates" | "unknown";
  reason?: InferencePriceReason;
  evidence: InferencePriceRule["evidence"];
  candidates: InferencePriceCandidate[];
  missing_conditions: PriceDimension[];
  requires_offer_choice: boolean;
  execution_modes: ExecutionMode[];
  requires_execution_mode_choice: boolean;
  available_choices: AvailableCommercialChoice[];
  missing_choices: CommercialChoice["dimension"][];
  unresolved_choices: UnresolvedCommercialChoice[];
  freshness?: PriceDataProvider["snapshot"];
}

/** Exact ID lookup over existing prices; no invocation protocol or account configuration. */
export function createInferencePriceLookup(priceData: unknown, mappingData: unknown) {
  const snapshot = createPricingSnapshot(priceData);
  const mapping = inferencePriceMappingSchema.parse(mappingData);
  if (
    mapping.pricing_data_version !== snapshot.data.snapshot.pricingDataVersion ||
    mapping.core_catalog_version !== snapshot.data.snapshot.coreCatalogVersion
  )
    throw new PricingError("INVALID_DATA", "Inference mappings belong to another price snapshot");
  if (new Set(mapping.sources.map(({ id }) => id)).size !== mapping.sources.length)
    throw new PricingError("INVALID_DATA", "Inference evidence repeats a source identity");
  if (
    new Set(mapping.offer_selections?.map(({ offer_ref }) => offer_ref)).size !==
    (mapping.offer_selections?.length ?? 0)
  )
    throw new PricingError("INVALID_DATA", "Commercial selection repeats an offer identity");
  for (const projection of mapping.offer_selections ?? []) {
    const owner = snapshot.offers.get(projection.offer_ref);
    // A provider partition may consume the complete snapshot's bound selection resource.
    if (owner === undefined) continue;
    for (const claim of projection.selection) {
      if (
        (claim.coverage === "complete" && claim.alternatives.length === 0) ||
        (claim.coverage === "not_applicable" && claim.alternatives.length > 0) ||
        claim.excluded_values?.some((value) =>
          claim.alternatives.some(
            (alternative) => canonicalJson(value) === canonicalJson(alternative.value),
          ),
        )
      )
        throw new PricingError(
          "INVALID_DATA",
          "Commercial coverage disagrees with its alternatives",
        );
      if (
        claim.evidence.some(
          ({ source_ref }) =>
            !owner.provider.sources.some(({ id }) => id === source_ref) &&
            !mapping.sources.some(
              ({ id, provider_id }) =>
                id === source_ref && provider_id === owner.provider.snapshot.provider_id,
            ),
        )
      )
        throw new PricingError(
          "INVALID_DATA",
          "Commercial selection has an unknown evidence source",
        );
      const scopes = [
        claim.applicability,
        ...claim.alternatives.map(({ applicability }) => applicability),
      ];
      if (
        claim.dimension === "billing_mode" &&
        claim.alternatives.some(
          ({ value }) => canonicalJson(value) !== canonicalJson(owner.offer.billing_mode),
        )
      )
        throw new PricingError("INVALID_DATA", "Commercial selection changes the billing basis");
      if (
        claim.dimension === "resource_kind" &&
        (owner.book.scope.kind !== "provider_resource" ||
          claim.alternatives.some(
            ({ value }) =>
              canonicalJson(value) !==
              canonicalJson(
                owner.book.scope.kind === "provider_resource"
                  ? owner.book.scope.resource_kind
                  : undefined,
              ),
          ))
      )
        throw new PricingError("INVALID_DATA", "Commercial selection changes the resource kind");
      validateSelectors([], scopes);
      for (const scope of scopes)
        for (const clause of scope.any_of)
          for (const condition of clause.all_of) {
            if (condition.kind !== "categorical") continue;
            for (const value of condition.values)
              validateSelectorVocabulary(
                [{ kind: "categorical", dimension: condition.dimension, value }],
                owner.provider,
              );
          }
    }
  }
  const offerModes = new Map<string, ExecutionMode>();
  for (const rule of mapping.rules) {
    validateRule(snapshot, rule, mapping.sources);
    for (const choice of rule.execution_choices ?? []) {
      if (mapping.offer_selections?.some(({ offer_ref }) => offer_ref === choice.offer_ref))
        throw new PricingError(
          "INVALID_DATA",
          "Legacy and canonical commercial selections overlap",
        );
      const previous = offerModes.get(choice.offer_ref);
      if (previous !== undefined && previous !== choice.mode)
        throw new PricingError("INVALID_DATA", "Conflicting execution modes for one offer");
      offerModes.set(choice.offer_ref, choice.mode);
    }
  }

  return (input: InferencePriceQuery): InferencePriceResult => {
    const query = parseRequest(inferencePriceQuerySchema, input);
    const evaluatedAt =
      query.evaluated_at === undefined
        ? snapshot.data.snapshot.generatedAt
        : parseEvaluationTime(query.evaluated_at);
    validateSelectors(query.selectors, []);
    const rules = mapping.rules.filter(
      (rule) => rule.provider_id === query.provider_id && rule.model_id === query.model_id,
    );
    const result: InferencePriceResult = {
      query,
      snapshot: { ...snapshot.data.snapshot },
      evaluated_at: evaluatedAt,
      status: "unknown",
      evidence: [],
      candidates: [],
      missing_conditions: [],
      requires_offer_choice: false,
      execution_modes: [],
      requires_execution_mode_choice: false,
      available_choices: [],
      missing_choices: [],
      unresolved_choices: [],
    };
    if (rules.length === 0) return { ...result, reason: "unreviewed_id" };
    result.evidence = uniqueCanonicalValues(rules.flatMap(({ evidence }) => evidence));
    if (new Set(rules.map((rule) => rule.model_ref)).size > 1)
      return { ...result, reason: "ambiguous_identity" };

    const provider = snapshot.data.providers.find(
      ({ snapshot: source }) => source.provider_id === query.provider_id,
    );
    if (provider !== undefined) {
      for (const rule of rules) {
        const selectors = inferenceSelectors(rule, query.selectors);
        if (selectors === undefined) continue;
        validateSelectorVocabulary(selectorSchema.array().parse(selectors), provider);
        for (const ref of rule.offer_refs) {
          if (query.offer_ref !== undefined && ref !== query.offer_ref) continue;
          const owner = snapshot.offers.get(ref);
          if (owner !== undefined)
            validateSelectors(selectors, offerApplicabilities(snapshot, owner.offer));
        }
      }
      result.freshness = provider.snapshot;
    }
    const matched = matchInferencePrices(
      inferenceMatchData(snapshot, rules, mapping.offer_selections, query.meter),
      query.selectors,
      evaluatedAt,
      query.offer_ref,
      query.execution_mode,
      query.choices,
    );
    return structuredClone({
      ...result,
      ...matched,
      candidates: uniqueCanonicalValues(
        matched.candidates.map((candidate): InferencePriceCandidate => {
          const owner = snapshot.offers.get(candidate.offer_ref);
          const matchedRules = candidate.rule_indexes.map((index) => rules[index]);
          if (
            owner === undefined ||
            candidate.model_ref === undefined ||
            matchedRules.some((rule) => rule === undefined)
          )
            throw new PricingError("INVALID_DATA", "Missing matched offer or rule");
          return {
            model_ref: candidate.model_ref,
            book_ref: owner.book.id,
            selectors: selectorSchema.array().parse(candidate.selectors),
            evidence: uniqueCanonicalValues(
              matchedRules.flatMap((rule) => [
                ...(rule?.evidence ?? []),
                ...(mapping.offer_selections
                  ?.find(({ offer_ref }) => offer_ref === candidate.offer_ref)
                  ?.selection.flatMap(({ evidence }) => evidence) ?? []),
                ...(rule?.execution_choices ?? []).flatMap((choice) =>
                  choice.mode === query.execution_mode && choice.offer_ref === candidate.offer_ref
                    ? choice.evidence
                    : [],
                ),
              ]),
            ),
            missing_conditions: candidate.missing_conditions,
            gaps: candidate.gaps,
            offer: {
              ...owner.offer,
              states: owner.offer.states.filter((_, index) => candidate.states.includes(index)),
              relations: owner.offer.relations.filter((_, index) =>
                candidate.relations.includes(index),
              ),
              terms: owner.offer.terms.flatMap((term) => {
                const selection = candidate.terms.find(({ id }) => id === term.id);
                return selection === undefined ? [] : [selectedTerm(term, selection)];
              }),
            },
            referenced_rates: candidate.referenced_rates.flatMap((selection) => {
              const term = snapshot.rates.get(selection.id);
              if (term === undefined)
                throw new PricingError("INVALID_DATA", "Missing referenced price");
              const selected = selectedTerm(term, selection);
              return selected.kind === "rate" ? [selected] : [];
            }),
          };
        }),
      ),
    });
  };
}

function validateRule(
  snapshot: PricingSnapshot,
  rule: InferencePriceRule,
  sources: InferencePriceMapping["sources"],
): void {
  const provider = snapshot.data.providers.find(
    ({ snapshot: source }) => source.provider_id === rule.provider_id,
  );
  if (
    provider === undefined ||
    !provider.models.some(({ model_ref }) => model_ref === rule.model_ref) ||
    rule.evidence.some(
      ({ source_ref }) =>
        !provider.sources.some(({ id }) => id === source_ref) &&
        !sources.some(
          ({ id, provider_id }) => id === source_ref && provider_id === rule.provider_id,
        ),
    )
  )
    throw new PricingError("INVALID_DATA", "Inference mapping has an unknown owner or source");
  validateSelectors(rule.fixed_selectors, []);
  validateSelectorVocabulary(rule.fixed_selectors, provider);
  if (rule.fixed_selectors.some(({ dimension }) => isModelDimension(dimension)))
    throw new PricingError("INVALID_DATA", "Inference mapping model identity belongs in model_ref");
  for (const ref of rule.offer_refs) {
    const owner = snapshot.offers.get(ref);
    if (
      owner === undefined ||
      owner.book.scope.kind !== "models" ||
      owner.provider.snapshot.provider_id !== rule.provider_id ||
      !(owner.offer.model_refs ?? owner.book.scope.model_refs).includes(rule.model_ref)
    )
      throw new PricingError("INVALID_DATA", "Inference mapping references an unrelated offer");
    const scopes = offerApplicabilities(snapshot, owner.offer);
    validateSelectors(rule.fixed_selectors, scopes);
    const dimensions = new Set(
      scopes.flatMap(({ any_of }) =>
        any_of.flatMap(({ all_of }) => all_of.map(({ dimension }) => canonicalJson(dimension))),
      ),
    );
    if (rule.fixed_selectors.some(({ dimension }) => !dimensions.has(canonicalJson(dimension))))
      throw new PricingError(
        "INVALID_DATA",
        `Inference mapping fixes an unused price condition (${rule.provider_id}/${rule.model_id}/${owner.offer.offer_key}: ${rule.fixed_selectors
          .filter(({ dimension }) => !dimensions.has(canonicalJson(dimension)))
          .map(({ dimension }) => dimension.value)
          .join(", ")})`,
      );
  }
  for (const choice of rule.execution_choices ?? []) {
    if (!rule.offer_refs.includes(choice.offer_ref))
      throw new PricingError("INVALID_DATA", "Execution choice references an unrelated offer");
    const owner = snapshot.offers.get(choice.offer_ref);
    if (owner === undefined) throw new PricingError("INVALID_DATA", "Missing execution offer");
    // Reuse the exact source, ownership and consumed-selector checks for the scoped association.
    validateRule(
      snapshot,
      {
        provider_id: rule.provider_id,
        model_id: rule.model_id,
        model_ref: rule.model_ref,
        offer_refs: [choice.offer_ref],
        fixed_selectors: rule.fixed_selectors,
        evidence: choice.evidence,
      },
      sources,
    );
  }
}

function isModelDimension(dimension: PriceDimension): boolean {
  return dimension.namespace === "kmodels" && dimension.value === "model";
}

export function selectedTerm(term: PriceDataTerm, selected: InferenceTermSelection): PriceDataTerm {
  if (term.kind === "raw")
    return {
      ...term,
      variants: term.variants.filter((_, index) => selected.raw_variants.includes(index)),
    };
  const raw_variants = term.raw_variants.filter((_, index) =>
    selected.raw_variants.includes(index),
  );
  switch (term.kind) {
    case "rate":
      return {
        ...term,
        raw_variants,
        variants: term.variants.filter((_, index) => selected.variants.includes(index)),
      };
    case "allowance":
      return {
        ...term,
        raw_variants,
        variants: term.variants.filter((_, index) => selected.variants.includes(index)),
      };
    case "contribution":
      return {
        ...term,
        raw_variants,
        variants: term.variants.filter((_, index) => selected.variants.includes(index)),
      };
  }
}
