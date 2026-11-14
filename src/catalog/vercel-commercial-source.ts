import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import type {
  SourceCommercialPricingFact,
  SourcePriceFact,
  SourceRawPricingFact,
} from "./pricing-source.ts";

interface Input {
  documents: ReadonlyMap<string, string>;
  sourceId: string;
  onPricingReconciliation?: (item: PricingReconciliationItem) => void;
}

const searchPath = "/docs/ai-gateway/models-and-providers/web-search.md";

export function vercelCommercialFacts(input: Input): SourceCommercialPricingFact[] {
  const source = input.documents.get(searchPath);
  if (source === undefined) {
    report(input, "unsupported", "generic_search_guide_not_observed");
    return [];
  }

  const body = source.replace(/^\s*>[ \t]?/gm, "").replace(/\s+/g, " ");
  const facts = [
    ...perplexityFacts(input, body),
    ...exaFacts(input, body),
    ...takoFacts(input, body),
    ...parallelFacts(input, body),
    ...browserbaseFacts(input, body),
    ...deepseekFacts(input, body),
  ];
  const knownServices = ["perplexity-search", "exa-search", "tako-search", "parallel-search"];
  const complete = knownServices.every((key) =>
    facts.some(({ resource_key }) => resource_key === key),
  );
  report(
    input,
    complete ? "normalized" : "unsupported",
    complete ? "generic_search_services" : "generic_search_services_partial",
  );
  for (const [marker, key] of [
    ["browserbaseSearch", "browserbase-search"],
    ["browserbaseFetch", "browserbase-fetch"],
    ["deepseekSearch", "deepseek-search"],
    ["deepseekFetch", "deepseek-fetch"],
  ]) {
    if (
      marker !== undefined &&
      key !== undefined &&
      body.includes(marker) &&
      !facts.some(({ resource_key }) => resource_key === key)
    )
      report(input, "unsupported", `${key}_pricing_contract_unrecognized`);
  }
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
  const modes = has(
    body,
    /Exa web search requests are charged at \$7 per 1,000 `auto` or `fast` requests and \$4 per 1,000 `instant` requests/i,
    /includes up to 10 results/i,
    /\$1 per 1,000 additional results/i,
  );
  if (
    !has(body, /exaSearch/, /includes up to 10 results/i, /\$1 per 1,000 additional results/i) ||
    (!modes && !/Exa web search requests are charged at \$7 per 1,000 requests/i.test(body))
  )
    return [];
  return [
    commercialFact(
      input,
      "exa-search",
      "Exa Search",
      modes
        ? (["auto", "fast", "instant"] as const).map((mode) =>
            rate(
              "web_search",
              mode === "instant" ? "4" : "7",
              "thousand_requests",
              input.sourceId,
              { search_effort: mode },
            ),
          )
        : [rate("web_search", "7", "thousand_requests", input.sourceId)],
    ),
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
    ...(has(
      body,
      /sources\.data\.includeContents/,
      /variable export surcharges|A fee per card plus a rate per row/i,
    )
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
                    "Inline-data charges depend on each card's content.export_pricing and returned rows.",
                },
              },
            ],
            "data-export",
          ),
        ]
      : []),
    ...(has(body, /Variable-cost data \| A charge per variable-cost card/, /maxVariableCostUsd/)
      ? [
          commercialFact(
            input,
            "tako-search",
            "Tako Search",
            [],
            [
              {
                term_key: "variable_data_surcharge",
                impact: "base_price",
                reason: "unknown_amount",
                conditions: { operation: "variable_cost_data" },
                source_ref: input.sourceId,
                raw: {
                  label: "Tako variable-cost data",
                  fragment:
                    "Source-dependent charge per returned variable-cost card; the per-call cap is not a price.",
                },
              },
            ],
            "data-export",
          ),
        ]
      : []),
  ];
}

function browserbaseFacts(input: Input, body: string): SourceCommercialPricingFact[] {
  const search = has(
    body,
    /browserbaseSearch/,
    /Browserbase Search costs \$7 per 1,000 requests, regardless of how many results/i,
  )
    ? [
        commercialFact(input, "browserbase-search", "Browserbase Search", [
          rate("web_search", "7", "thousand_requests", input.sourceId),
        ]),
      ]
    : [];
  if (
    !has(
      body,
      /browserbaseFetch/,
      /A plain `raw` fetch costs \$1 per 1,000 requests/i,
      /Routing through proxies adds \$3 per 1,000/i,
      /extraction \(`markdown` or `json` format\) adds another \$3 per 1,000/i,
      /surcharges are billed from the options actually sent upstream/i,
    )
  )
    return search;
  const prices = (["raw", "markdown", "json"] as const).flatMap((format) =>
    [false, true].map((proxies) => ({
      ...rate(
        "retrieval",
        String(1 + (proxies ? 3 : 0) + (format === "raw" ? 0 : 3)),
        "thousand_requests",
        input.sourceId,
        { format, proxies },
      ),
      derived: true,
      derivation: "One base request plus the published proxy and extraction option surcharges.",
      raw_price: "1 base + 3 proxies + 3 extraction",
    })),
  );
  return [...search, commercialFact(input, "browserbase-fetch", "Browserbase Fetch", prices)];
}

function deepseekFacts(input: Input, body: string): SourceCommercialPricingFact[] {
  if (
    !has(
      body,
      /deepseekSearch/,
      /deepseekFetch/,
      /Tool \| Price per 1,000 billable requests/,
      /DeepSeek Search \| \$0\.75/,
      /DeepSeek Fetch \| \$0\.75/,
      /Search is billable when a successful request returns a nonempty results array/i,
      /Fetch is billable when a successful request returns nonempty page content/i,
      /Failed requests, timeouts, and empty results are not billed/i,
    )
  )
    return [];
  return [
    commercialFact(input, "deepseek-search", "DeepSeek Search", [
      rate("web_search", "0.75", "thousand_requests", input.sourceId),
    ]),
    commercialFact(input, "deepseek-fetch", "DeepSeek Fetch", [
      rate("retrieval", "0.75", "thousand_requests", input.sourceId),
    ]),
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
    model_refs: [],
    offer_key: offerKey,
    offer_name:
      offerKey === "search"
        ? name
        : offerKey === "additional-results"
          ? `${name} additional results`
          : `${name} data export`,
    billing_mode: "usage",
    pricing_state: rates.length > 0 ? "numeric" : "unknown",
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
