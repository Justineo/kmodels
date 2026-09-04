import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import type {
  SourceCommercialPricingFact,
  SourcePriceFact,
  SourceRawPricingFact,
} from "./pricing-source.ts";

interface Input {
  documents: ReadonlyMap<string, string>;
  sourceId: string;
  modelRefs: readonly string[];
  onPricingReconciliation?: (item: PricingReconciliationItem) => void;
}

const searchPath = "/docs/ai-gateway/models-and-providers/web-search.md";

export function vercelCommercialFacts(input: Input): SourceCommercialPricingFact[] {
  const body = input.documents.get(searchPath);
  if (body === undefined) {
    report(input, "unsupported", "generic_search_guide_not_observed");
    return [];
  }

  const facts = [
    ...perplexityFacts(input, body),
    ...exaFacts(input, body),
    ...takoFacts(input, body),
    ...parallelFacts(input, body),
  ];
  report(
    input,
    facts.length === 9 ? "normalized" : "unsupported",
    facts.length === 9 ? "generic_search_services" : "generic_search_services_partial",
  );
  return facts;
}

function perplexityFacts(input: Input, body: string): SourceCommercialPricingFact[] {
  if (
    !has(
      body,
      /perplexitySearch/,
      /Perplexity web search requests are charged at \$5 per 1,000 requests/i,
    )
  )
    return [];
  return [
    commercialFact(input, "perplexity-search", "Perplexity Search", [
      rate("web_search", "5", "thousand_requests", input.sourceId),
    ]),
  ];
}

function exaFacts(input: Input, body: string): SourceCommercialPricingFact[] {
  if (
    !has(
      body,
      /exaSearch/,
      /Exa web search requests are charged at \$7 per 1,000 requests/i,
      /includes up to 10 results/i,
      /\$1 per 1,000 additional results/i,
    )
  )
    return [];
  return [
    commercialFact(input, "exa-search", "Exa Search", [
      rate("web_search", "7", "thousand_requests", input.sourceId),
    ]),
    commercialFact(
      input,
      "exa-search",
      "Exa Search",
      [
        rate("web_search", "1", "thousand_items", input.sourceId, {
          operation: "additional_requested_results",
        }),
      ],
      [],
      "additional-results",
    ),
  ];
}

function takoFacts(input: Input, body: string): SourceCommercialPricingFact[] {
  if (
    !has(
      body,
      /takoSearch/,
      /\$7 per 1,000 instant or fast requests/i,
      /\$12 per 1,000 deep requests/i,
    )
  )
    return [];
  return [
    ...(["instant", "fast"] as const).map((effort) =>
      commercialFact(input, "tako-search", "Tako Search", [
        rate("web_search", "7", "thousand_requests", input.sourceId, {
          search_effort: effort,
        }),
      ]),
    ),
    commercialFact(input, "tako-search", "Tako Search", [
      rate("web_search", "12", "thousand_requests", input.sourceId, {
        search_effort: "deep",
      }),
    ]),
    ...(has(body, /sources\.data\.includeContents/, /variable export surcharges/i)
      ? [
          commercialFact(
            input,
            "tako-search",
            "Tako Search",
            [],
            [
              {
                term_key: "data_export_surcharge",
                impact: "base_price",
                reason: "unknown_amount",
                conditions: { operation: "data_export" },
                source_ref: input.sourceId,
                raw: {
                  label: "Tako data export surcharge",
                  fragment:
                    "Variable export surcharge depends on requested rows and each card's content.export_pricing.",
                },
              },
            ],
            "data-export",
          ),
        ]
      : []),
  ];
}

function parallelFacts(input: Input, body: string): SourceCommercialPricingFact[] {
  if (
    !has(
      body,
      /parallelSearch/,
      /Parallel web search requests are charged at \$5 per 1,000 requests/i,
      /includes up to 10 results per request/i,
      /\$1 per 1,000 additional results/i,
    )
  )
    return [];
  return [
    commercialFact(input, "parallel-search", "Parallel Search", [
      rate("web_search", "5", "thousand_requests", input.sourceId),
    ]),
    commercialFact(
      input,
      "parallel-search",
      "Parallel Search",
      [
        rate("web_search", "1", "thousand_items", input.sourceId, {
          operation: "additional_results",
        }),
      ],
      [],
      "additional-results",
    ),
  ];
}

function commercialFact(
  input: Input,
  key: string,
  name: string,
  rates: SourcePriceFact[],
  rawRates: SourceRawPricingFact[] = [],
  offerKey = "search",
): SourceCommercialPricingFact {
  return {
    source_ref: input.sourceId,
    book_key: `service:${key}`,
    book_name: name,
    resource_kind: "service",
    resource_key: key,
    model_refs: [...input.modelRefs],
    offer_key: offerKey,
    offer_name:
      offerKey === "search"
        ? name
        : offerKey === "additional-results"
          ? `${name} additional results`
          : `${name} data export`,
    billing_mode: "usage",
    pricing_state: rates.length > 0 ? "numeric" : "not_published",
    price_facts: rates,
    raw_price_facts: rawRates,
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

function has(body: string, ...markers: RegExp[]): boolean {
  return markers.every((marker) => marker.test(body));
}

function report(
  input: Input,
  disposition: PricingReconciliationItem["disposition"],
  reasonCode: string,
): void {
  input.onPricingReconciliation?.({ disposition, reason_code: reasonCode, sample: searchPath });
}
