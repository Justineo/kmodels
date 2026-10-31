import { canonicalJson, uniqueCanonicalValues } from "../catalog/canonical-value.ts";
import type { PriceDimension } from "../catalog/pricing-schema.ts";
import { PricingError } from "./errors.ts";
import {
  inferencePriceMappingSchema,
  inferencePriceQuerySchema,
  type InferencePriceQuery,
  type InferencePriceMapping,
  type InferencePriceRule,
  type InferencePriceReason,
} from "./inference-schema.ts";
import { parseRequest, validateSelectorVocabulary } from "./request.ts";
import {
  selectorSchema,
  type CalculationOffer,
  type CalculationProvider,
  type CalculationTerm,
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
  offer: CalculationOffer;
  referenced_rates: Extract<CalculationTerm, { kind: "rate" }>[];
  selectors: Selector[];
  evidence: InferencePriceRule["evidence"];
  missing_conditions: PriceDimension[];
  gaps: Gap[];
}

export interface InferencePriceResult {
  query: InferencePriceQuery;
  status: "matched" | "candidates" | "unknown";
  reason?: InferencePriceReason;
  evidence: InferencePriceRule["evidence"];
  candidates: InferencePriceCandidate[];
  missing_conditions: PriceDimension[];
  requires_offer_choice: boolean;
  freshness?: CalculationProvider["snapshot"];
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
  for (const rule of mapping.rules) validateRule(snapshot, rule, mapping.sources);

  return (input: InferencePriceQuery): InferencePriceResult => {
    const query = parseRequest(inferencePriceQuerySchema, input);
    validateSelectors(query.selectors, []);
    const rules = mapping.rules.filter(
      (rule) => rule.provider_id === query.provider_id && rule.model_id === query.model_id,
    );
    const result: InferencePriceResult = {
      query,
      status: "unknown",
      evidence: [],
      candidates: [],
      missing_conditions: [],
      requires_offer_choice: false,
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
      result.freshness = structuredClone(provider.snapshot);
    }
    const matched = matchInferencePrices(
      inferenceMatchData(snapshot, rules),
      query.selectors,
      query.evaluated_at ?? snapshot.data.snapshot.generatedAt,
      query.offer_ref,
    );
    return structuredClone({
      ...result,
      ...matched,
      candidates: uniqueCanonicalValues(
        matched.candidates.map((candidate): InferencePriceCandidate => {
          const owner = snapshot.offers.get(candidate.offer_ref);
          const matchedRules = candidate.rule_indexes.map((index) => rules[index]);
          if (owner === undefined || matchedRules.some((rule) => rule === undefined))
            throw new PricingError("INVALID_DATA", "Missing matched offer or rule");
          return {
            model_ref: candidate.model_ref,
            selectors: selectorSchema.array().parse(candidate.selectors),
            evidence: uniqueCanonicalValues(matchedRules.flatMap((rule) => rule?.evidence ?? [])),
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
      throw new PricingError("INVALID_DATA", "Inference mapping fixes an unused price condition");
  }
}

function isModelDimension(dimension: PriceDimension): boolean {
  return dimension.namespace === "kmodels" && dimension.value === "model";
}

function selectedTerm(term: CalculationTerm, selected: InferenceTermSelection): CalculationTerm {
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
