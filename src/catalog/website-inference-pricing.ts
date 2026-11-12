import { createInferencePriceLookup, type InferencePriceResult } from "../pricing/inference.ts";
import type { InferencePriceMapping } from "../pricing/inference-schema.ts";
import { calculationExport } from "./pricing-calculator-export.ts";
import { formatDimension } from "./pricing-presentation.ts";
import type { PricingCatalogEnvelope } from "./pricing-schema.ts";
import type { Catalog } from "./schema.ts";
import type { WebsiteInferencePrice } from "./website-schema.ts";
import { inferenceMatchData } from "../pricing/inference-matching-data.ts";
import { indexValidatedPriceData, offerApplicabilities } from "../pricing/snapshot.ts";
import { inferencePricingOptions } from "./website-data.ts";
import { inferencePriceExplanation } from "./inference-price-presentation.ts";

/** Resolve IDs with the public matcher; the UI only selects and displays these price candidates. */
export function websiteInferencePrices(
  catalog: Catalog,
  pricing: PricingCatalogEnvelope,
  mapping: InferencePriceMapping,
): Map<string, WebsiteInferencePrice[]> {
  const results = new Map<string, WebsiteInferencePrice[]>();
  for (const provider of pricing.data.provider_snapshots) {
    const providerId = provider.provider_id;
    const prices = calculationExport(catalog, pricing, [providerId]);
    const rules = mapping.rules.filter(({ provider_id }) => provider_id === providerId);
    const sources = mapping.sources.filter(({ provider_id }) => provider_id === providerId);
    const lookup = createInferencePriceLookup(prices, { ...mapping, rules, sources });
    const snapshot = indexValidatedPriceData(prices);
    const sourceUrls = new Map([
      ...prices.providers.flatMap(({ sources }) =>
        sources.map(({ id, url }) => [id, url] as const),
      ),
      ...sources.map(({ id, url }) => [id, url] as const),
    ]);
    for (const model of catalog.models.filter(({ provider_id }) => provider_id === providerId)) {
      const modelRules = rules.filter(({ model_ref }) => model_ref === model.uid);
      const ids = new Set([
        ...(modelRules.some(({ model_id }) => model_id === model.model_id) ? [model.model_id] : []),
        ...modelRules.map(({ model_id }) => model_id),
      ]);
      if (ids.size === 0) ids.add(model.model_id);
      results.set(
        model.uid,
        [...ids].map((model_id) => {
          const result = lookup({ provider_id: providerId, model_id });
          const matching = inferenceMatchData(
            snapshot,
            rules.filter((rule) => rule.model_id === model_id),
            mapping.offer_selections,
          );
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
          return { ...websiteInferencePrice(result, sourceUrls), matching, pricing_options };
        }),
      );
    }
  }
  return results;
}

export function websiteInferencePrice(
  result: InferencePriceResult,
  sourceUrls: ReadonlyMap<string, string>,
): WebsiteInferencePrice {
  return {
    model_id: result.query.model_id,
    status: result.status,
    ...(result.reason === undefined ? {} : { reason: result.reason }),
    explanation: inferencePriceExplanation(result),
    missing_conditions: result.missing_conditions.map(formatDimension),
    evidence_urls: [
      ...new Set(
        result.evidence.flatMap(({ source_ref }) => {
          const url = sourceUrls.get(source_ref);
          return url === undefined ? [] : [url];
        }),
      ),
    ],
    candidates:
      result.status === "unknown"
        ? []
        : result.candidates.map(({ offer, selectors }) => ({ offer_ref: offer.id, selectors })),
  };
}
