import { attachCommercialFacts, rawPricingFact as raw } from "./pricing.ts";
import type {
  ParsedProviderModel,
  SourceCommercialPricingFact,
  SourcePriceFact,
} from "./pricing-source.ts";

export interface DashscopeWebSearchRate {
  modelId: string;
  scope: string;
  rate: SourcePriceFact;
}

export function attachDashscopeWebSearchFacts(
  models: Map<string, ParsedProviderModel>,
  sourceId: string,
  rates: readonly DashscopeWebSearchRate[],
  accounting: boolean,
  settlement: boolean,
): void {
  const facts = rates.flatMap(({ modelId, scope, rate }): SourceCommercialPricingFact[] => {
    const model = models.get(modelId);
    if (model === undefined) return [];
    return [
      {
        source_ref: sourceId,
        book_key: "service:web-search",
        book_name: "Model Studio built-in web search",
        resource_kind: "service",
        resource_key: "web-search",
        model_refs: [model.uid],
        offer_key: `built-in:${model.uid}:${slug(scope)}`,
        offer_name: `Built-in web search for ${model.model_id} in ${scope}`,
        billing_mode: "usage",
        pricing_state: "numeric",
        price_facts: [{ ...rate, meter: "web_search" }],
        raw_price_facts: [
          raw(
            sourceId,
            "search_content_tokens",
            "informational",
            "requires_usage_aggregation",
            "Web-search content contributes ordinary model input tokens in addition to the executed search-call charge",
            rate.conditions,
          ),
          ...(accounting
            ? []
            : [
                raw(
                  sourceId,
                  "accounting_binding_unavailable:web_search",
                  "informational",
                  "requires_usage_aggregation",
                  "The web-search usage counter contract drifted; the public rate remains usable without automatic charge reconstruction",
                  rate.conditions,
                ),
              ]),
          ...(settlement
            ? []
            : [
                raw(
                  sourceId,
                  "accounting_binding_unavailable:settlement",
                  "informational",
                  "requires_usage_aggregation",
                  "The public settlement contract drifted; the web-search rate remains usable without an asserted payment route",
                  rate.conditions,
                ),
              ]),
        ],
      },
    ];
  });
  attachCommercialFacts([...models.values()], facts);
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
