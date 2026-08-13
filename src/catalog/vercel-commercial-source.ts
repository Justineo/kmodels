import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import type { SourceCommercialPricingFact, SourcePriceFact } from "./pricing-source.ts";

interface Input {
  documents: ReadonlyMap<string, string>;
  sourceId: string;
  modelRefs: readonly string[];
  onPricingReconciliation?: (item: PricingReconciliationItem) => void;
}

const searchPath = "/docs/ai-gateway/models-and-providers/web-search.md";

export function vercelCommercialFacts(input: Input): SourceCommercialPricingFact[] {
  const body = input.documents.get(searchPath);
  const markers = [
    "can be used with any model regardless of the model provider or creator",
    "Perplexity web search requests are charged at $5 per 1,000 requests",
    "Exa web search requests are charged at $7 per 1,000 requests",
    "Additional requested results beyond 10 are charged",
    "Parallel web search requests are charged at $5 per 1,000 requests",
    "Additional results beyond 10 are charged",
  ];
  if (body === undefined || markers.some((marker) => !body.includes(marker))) {
    report(input, "unsupported", "generic_search_services_not_observed", searchPath);
    return [];
  }

  report(input, "normalized", "generic_search_services", searchPath);
  return [
    commercialFact(input, "perplexity-search", "Perplexity Search", [
      rate("web_search", "5", "thousand_requests", input.sourceId),
    ]),
    commercialFact(input, "exa-search", "Exa Search", [
      rate("web_search", "7", "thousand_requests", input.sourceId),
      rate("web_search", "1", "thousand_items", input.sourceId, {
        operation: "additional_requested_results",
      }),
    ]),
    commercialFact(input, "parallel-search", "Parallel Search", [
      rate("web_search", "5", "thousand_requests", input.sourceId),
      rate("web_search", "1", "thousand_items", input.sourceId, {
        operation: "additional_results",
      }),
    ]),
  ];
}

function commercialFact(
  input: Input,
  key: string,
  name: string,
  rates: SourcePriceFact[],
): SourceCommercialPricingFact {
  return {
    source_ref: input.sourceId,
    book_key: `service:${key}`,
    book_name: name,
    resource_kind: "service",
    resource_key: key,
    model_refs: [...input.modelRefs],
    offer_key: "search",
    offer_name: name,
    billing_mode: "usage",
    pricing_state: "numeric",
    price_facts: rates,
    raw_price_facts: [],
  };
}

function rate(
  meter: SourcePriceFact["meter"],
  price: string,
  unit: SourcePriceFact["unit"],
  sourceRef: string,
  conditions: SourcePriceFact["conditions"] = {},
): SourcePriceFact {
  return {
    meter,
    price,
    currency: "USD",
    unit,
    conditions,
    source_ref: sourceRef,
    source_locator: { kind: "fragment", value: searchPath },
    derived: false,
    raw_price: price,
    raw_unit: unit,
  };
}

function report(
  input: Input,
  disposition: PricingReconciliationItem["disposition"],
  reasonCode: string,
  sample: string,
): void {
  input.onPricingReconciliation?.({ disposition, reason_code: reasonCode, sample });
}
