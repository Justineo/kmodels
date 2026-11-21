import { prepareInferencePriceLookup, type InferencePriceResult } from "../pricing/inference.ts";
import type { InferencePriceMapping, InferencePriceRule } from "../pricing/inference-schema.ts";
import { priceDataExport } from "./pricing-lookup-export.ts";
import { formatDimension } from "./pricing-presentation.ts";
import type { PricingCatalogEnvelope } from "./pricing-schema.ts";
import type { Catalog } from "./schema.ts";
import type { WebsiteInferencePrice } from "./website-schema.ts";
import { inferenceMatchData } from "../pricing/inference-matching-data.ts";
import {
  createPricingSnapshot,
  indexValidatedPriceData,
  offerApplicabilities,
} from "../pricing/snapshot.ts";
import type { PriceDataEnvelope } from "../pricing/schema.ts";
import { inferencePricingOptions } from "./website-data.ts";
import { inferencePriceExplanation } from "./inference-price-presentation.ts";

/** Resolve IDs with the public matcher; the UI only selects and displays these price candidates. */
export function websiteInferencePrices(
  catalog: Catalog,
  pricing: PricingCatalogEnvelope,
  mapping: InferencePriceMapping,
  validatedPrices?: PriceDataEnvelope,
): Map<string, WebsiteInferencePrice[]> {
  const results = new Map<string, WebsiteInferencePrice[]>();
  for (const [providerIndex, provider] of pricing.data.provider_snapshots.entries()) {
    const providerId = provider.provider_id;
    const priceSnapshot =
      validatedPrices === undefined
        ? createPricingSnapshot(priceDataExport(catalog, pricing, [providerId]))
        : indexValidatedPriceData({
            ...validatedPrices,
            providers: validatedPrices.providers.filter(
              ({ snapshot }) => snapshot.provider_id === providerId,
            ),
          });
    const rules = mapping.rules.filter(({ provider_id }) => provider_id === providerId);
    const sources = mapping.sources.filter(({ provider_id }) => provider_id === providerId);
    const offerIds = priceSnapshot.offers;
    // The first lookup checks the shared selection schema and duplicate identities.
    // Later providers need only their owned selection rows, with the same semantic checks.
    const { lookup, snapshot, selections } = prepareInferencePriceLookup(priceSnapshot, {
      ...mapping,
      rules,
      sources,
      ...(mapping.offer_selections === undefined
        ? {}
        : {
            offer_selections:
              providerIndex === 0
                ? mapping.offer_selections
                : mapping.offer_selections.filter(({ offer_ref }) => offerIds.has(offer_ref)),
          }),
    });
    const rulesByModel = groupRules(rules, "model_ref");
    const rulesById = groupRules(rules, "model_id");
    for (const model of catalog.models.filter(({ provider_id }) => provider_id === providerId)) {
      const modelRules = rulesByModel.get(model.uid) ?? [];
      const ids = new Set([
        ...(modelRules.some(({ model_id }) => model_id === model.model_id) ? [model.model_id] : []),
        ...modelRules.map(({ model_id }) => model_id),
      ]);
      if (ids.size === 0) ids.add(model.model_id);
      results.set(
        model.uid,
        [...ids].map((model_id) => {
          const result = lookup({ provider_id: providerId, model_id });
          const matching = inferenceMatchData(snapshot, rulesById.get(model_id) ?? [], selections);
          const pricing_options = inferencePricingOptions(
            [...new Set(matching.rules.flatMap(({ offer_refs }) => offer_refs))].flatMap((ref) => {
              const owner = snapshot.offers.get(ref);
              return owner === undefined
                ? []
                : offerApplicabilities(snapshot, owner.offer).flatMap(({ any_of }) =>
                    any_of.flatMap(({ all_of }) => all_of),
                  );
            }),
            pricing.data,
          );
          // Keep the stored explanation stable for precomputed packs. The inspector can
          // explain current conflicts and validity from the complete matcher.
          const explanation = inferencePriceExplanation(result, "publication");
          return {
            ...websiteInferencePrice(result, explanation),
            matching,
            pricing_options,
          };
        }),
      );
    }
  }
  return results;
}

function groupRules(rules: readonly InferencePriceRule[], key: "model_ref" | "model_id") {
  const groups = new Map<string, InferencePriceRule[]>();
  for (const rule of rules) {
    const group = groups.get(rule[key]);
    if (group === undefined) groups.set(rule[key], [rule]);
    else group.push(rule);
  }
  return groups;
}

export function websiteInferencePrice(
  result: InferencePriceResult,
  explanation = inferencePriceExplanation(result),
): WebsiteInferencePrice {
  return {
    model_id: result.query.model_id,
    status: result.status,
    ...(result.reason === undefined ? {} : { reason: result.reason }),
    explanation,
    missing_conditions: result.missing_conditions.map(formatDimension),
    candidates:
      result.status === "unknown"
        ? []
        : result.candidates.map(({ offer, selectors }) => ({ offer_ref: offer.id, selectors })),
  };
}
