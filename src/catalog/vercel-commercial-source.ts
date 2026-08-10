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
  modelRefById: ReadonlyMap<string, string>;
  onPricingReconciliation?: (item: PricingReconciliationItem) => void;
}

type Fact = Omit<SourceCommercialPricingFact, "source_ref">;

const pricingPath = "/docs/ai-gateway/pricing.md";
const searchPath = "/docs/ai-gateway/models-and-providers/web-search.md";
const reportingPath = "/docs/ai-gateway/observability-and-spend/custom-reporting.md";
const modelAllowlistPath = "/docs/ai-gateway/security-and-compliance/model-allowlist.md";
const providerAllowlistPath = "/docs/ai-gateway/security-and-compliance/provider-allowlist.md";
const zdrPath = "/docs/ai-gateway/security-and-compliance/zdr.md";
const tracePath = "/docs/ai-gateway/observability-and-spend/trace-drains.md";
const drainsPath = "/docs/drains.md";
const byokPath = "/docs/ai-gateway/authentication-and-byok/byok.md";
const freeCreditPath =
  "/kb/guide/how-i-use-opencode-with-vercel-ai-gateway-to-build-features-fast.md";
const directoryPath = "/ai-gateway/models";
const sitemapPath = "/crawled-sitemap.xml";

export function vercelCommercialFacts(input: Input): SourceCommercialPricingFact[] {
  const facts: SourceCommercialPricingFact[] = [];
  const add = (fact: Fact): void => {
    facts.push({ source_ref: input.sourceId, ...fact });
  };

  claim(
    input,
    "generic_search_services",
    searchPath,
    [
      "can be used with any model regardless of the model provider or creator",
      "Perplexity web search requests are charged at $5 per 1,000 requests",
      "Exa web search requests are charged at $7 per 1,000 requests",
      "Additional requested results beyond 10 are charged",
      "Parallel web search requests are charged at $5 per 1,000 requests",
      "Additional results beyond 10 are charged",
    ],
    () => {
      add(
        commercialFact({
          bookKey: "service:perplexity-search",
          bookName: "Perplexity Search",
          resourceKey: "perplexity-search",
          modelRefs: input.modelRefs,
          offerKey: "search",
          offerName: "Perplexity Search",
          rates: [rate("web_search", "5", "thousand_requests", input.sourceId, searchPath)],
        }),
      );
      add(
        commercialFact({
          bookKey: "service:exa-search",
          bookName: "Exa Search",
          resourceKey: "exa-search",
          modelRefs: input.modelRefs,
          offerKey: "search",
          offerName: "Exa Search",
          rates: [
            rate("web_search", "7", "thousand_requests", input.sourceId, searchPath),
            rate("web_search", "1", "thousand_items", input.sourceId, searchPath, {
              operation: "additional_requested_results",
            }),
          ],
        }),
      );
      add(
        commercialFact({
          bookKey: "service:parallel-search",
          bookName: "Parallel Search",
          resourceKey: "parallel-search",
          modelRefs: input.modelRefs,
          offerKey: "search",
          offerName: "Parallel Search",
          rates: [
            rate("web_search", "5", "thousand_requests", input.sourceId, searchPath),
            rate("web_search", "1", "thousand_items", input.sourceId, searchPath, {
              operation: "additional_results",
            }),
          ],
        }),
      );
    },
  );

  claim(
    input,
    "custom_reporting_rates",
    pricingPath,
    [
      "$0.075 / 1,000 tag/user ID/quota entity ID writes",
      "$5 / 1,000 queries to the reporting endpoint",
      "Each unique tag, user ID, or quota entity ID within a single request scope",
    ],
    () => {
      add(
        commercialFact({
          bookKey: "service:custom-reporting",
          bookName: "Custom Reporting",
          resourceKey: "custom-reporting",
          offerKey: "writes",
          offerName: "Reporting writes",
          rates: [
            rate("custom_reporting", "0.075", "thousand_events", input.sourceId, pricingPath, {
              operation: "unique_dimension_write",
            }),
          ],
        }),
      );
      add(
        commercialFact({
          bookKey: "service:custom-reporting",
          bookName: "Custom Reporting",
          resourceKey: "custom-reporting",
          offerKey: "queries",
          offerName: "Spend-report queries",
          rates: [
            rate("custom_reporting", "5", "thousand_requests", input.sourceId, pricingPath, {
              operation: "report_query",
            }),
          ],
        }),
      );
    },
  );
  claim(
    input,
    "custom_reporting_accounting",
    reportingPath,
    ["It can take a few minutes", "`market_cost`", "`surcharge_cost`", "`gateway_cost`"],
    () => undefined,
  );

  claimAcross(
    input,
    "shared_restriction_surcharge",
    [
      [
        modelAllowlistPath,
        [
          "$0.10 per 1,000 successful requests",
          "a single restriction surcharge, not one per allowlist",
          "never billed twice",
        ],
      ],
      [
        providerAllowlistPath,
        [
          "$0.10 per 1,000 successful requests",
          "Requests blocked by the allowlist (`403`) and other failures are not charged",
        ],
      ],
    ],
    () => {
      add(
        commercialFact({
          bookKey: "account:model-allowlist",
          bookName: "Team-wide model allowlist",
          resourceKind: "account_resource_template",
          resourceKey: "model-allowlist",
          offerKey: "control",
          offerName: "Model allowlist control",
          state: "included",
          raw: [
            raw(
              "model-allowlist-control",
              "informational",
              "Team-wide model allowlist is an independent governance control",
              input.sourceId,
            ),
          ],
        }),
      );
      add(
        commercialFact({
          bookKey: "account:provider-allowlist",
          bookName: "Team-wide provider allowlist",
          resourceKind: "account_resource_template",
          resourceKey: "provider-allowlist",
          offerKey: "control",
          offerName: "Provider allowlist control",
          state: "included",
          raw: [
            raw(
              "provider-allowlist-control",
              "informational",
              "Team-wide provider allowlist is an independent governance control",
              input.sourceId,
            ),
          ],
        }),
      );
      add(
        commercialFact({
          bookKey: "service:team-restrictions",
          bookName: "Team-wide model/provider restrictions",
          resourceKey: "team-restrictions",
          offerKey: "restriction-surcharge",
          offerName: "Shared restriction surcharge",
          rates: [
            rate(
              "policy_enforcement",
              "0.10",
              "thousand_requests",
              input.sourceId,
              modelAllowlistPath,
            ),
          ],
          raw: [
            raw(
              "combined-trigger",
              "informational",
              "Either or both team-wide allowlists trigger one shared surcharge; enabling both never duplicates it",
              input.sourceId,
            ),
          ],
        }),
      );
    },
  );

  claim(
    input,
    "team_zdr_surcharge",
    zdrPath,
    [
      "Team-wide zero data retention",
      "$0.10 per 1,000 requests",
      "only charged on successful responses that return usage data",
      "Requests that fail or return errors are not charged",
    ],
    () =>
      add(
        commercialFact({
          bookKey: "service:team-wide-zdr",
          bookName: "Team-wide Zero Data Retention",
          resourceKey: "team-wide-zdr",
          offerKey: "zdr",
          offerName: "Team-wide ZDR",
          rates: [
            rate("zero_data_retention", "0.10", "thousand_requests", input.sourceId, zdrPath),
          ],
        }),
      ),
  );

  claimAcross(
    input,
    "trace_drain_topology",
    [
      [
        tracePath,
        [
          "bills on two meters",
          "single trace event for each drain that delivers it",
          "Failed deliveries don't incur a trace-event charge",
          "Charges begin with the first delivered trace and first byte of trace egress",
        ],
      ],
      [
        drainsPath,
        ["| Drains Volume | $0.50 |", "uncompressed JSON serialization of each drained record"],
      ],
    ],
    () => {
      add(
        commercialFact({
          bookKey: "service:trace-drains",
          bookName: "AI Gateway Trace Drains",
          resourceKey: "trace-drains",
          offerKey: "delivery",
          offerName: "Trace delivery and egress",
          state: "numeric",
          rates: [rate("data_transfer", "0.50", "gigabyte", input.sourceId, drainsPath)],
          raw: [
            raw(
              "trace-delivery",
              "base_price",
              "Delivered trace event rate is not publicly stated",
              input.sourceId,
              "unknown_amount",
            ),
          ],
        }),
      );
    },
  );

  claimAcross(
    input,
    "byok_settlement",
    [
      [
        pricingPath,
        [
          "With BYOK, there is no markup or fee from AI Gateway",
          "BYOK is available on the paid tier",
          "fallback usage is charged against your credits balance",
        ],
      ],
      [byokPath, ["no added markup", "system credentials", "actual costs may vary"]],
    ],
    () =>
      add(
        commercialFact({
          bookKey: "account:byok",
          bookName: "Bring Your Own Key",
          resourceKind: "account_resource_template",
          resourceKey: "byok",
          modelRefs: input.modelRefs,
          offerKey: "external-provider-billing",
          offerName: "Externally billed upstream route",
          state: "externally_billed",
        }),
      ),
  );

  const eligible = freeTierModelRefs(input);
  claimAcross(
    input,
    "free_tier_allowance",
    [
      [
        pricingPath,
        [
          "The free tier includes a subset of models",
          "free credits start when you make your first AI Gateway request",
        ],
      ],
      [freeCreditPath, ["$5 in free credits that reset every 30 days"]],
    ],
    () => {
      if (eligible.length === 0) {
        report(input, "unsupported", "free_tier_model_set_missing", directoryPath);
        return;
      }
      add(
        commercialFact({
          bookKey: "plan:free-tier",
          bookName: "AI Gateway free tier",
          resourceKind: "plan",
          resourceKey: "free-tier",
          modelRefs: eligible,
          offerKey: "credit-allowance",
          offerName: "$5 free-credit allowance",
          state: "included",
          raw: [
            {
              term_key: "free-credit-allowance",
              impact: "allowance",
              reason: "unsupported_structure",
              conditions: {},
              source_ref: input.sourceId,
              raw: {
                label: "Free-tier credit allowance",
                amount: "5",
                denomination: "USD",
                unit: "30 days",
              },
            },
            ...(input.documents
              .get(freeCreditPath)
              ?.includes("with no restrictions on which models you can use") === true
              ? [
                  raw(
                    "free-tier-eligibility-conflict",
                    "informational",
                    "The current pricing guide limits free credits to a selected model subset, while the official knowledge-base guide says there are no model restrictions; current directory eligibility controls the target set",
                    input.sourceId,
                    "unsupported_structure",
                  ),
                ]
              : []),
          ],
        }),
      );
    },
  );

  auditSitemap(input);
  return facts;
}

function commercialFact(input: {
  bookKey: string;
  bookName: string;
  resourceKind?: SourceCommercialPricingFact["resource_kind"];
  resourceKey: string;
  modelRefs?: readonly string[];
  offerKey: string;
  offerName: string;
  state?: SourceCommercialPricingFact["pricing_state"];
  rates?: SourcePriceFact[];
  raw?: SourceRawPricingFact[];
}): Fact {
  return {
    book_key: input.bookKey,
    book_name: input.bookName,
    resource_kind: input.resourceKind ?? "service",
    resource_key: input.resourceKey,
    model_refs: [...(input.modelRefs ?? [])],
    offer_key: input.offerKey,
    offer_name: input.offerName,
    billing_mode: "usage",
    pricing_state: input.state ?? "numeric",
    price_facts: input.rates ?? [],
    raw_price_facts: input.raw ?? [],
  };
}

function rate(
  meter: SourcePriceFact["meter"],
  price: string,
  unit: SourcePriceFact["unit"],
  sourceRef: string,
  sourcePath: string,
  conditions: SourcePriceFact["conditions"] = {},
): SourcePriceFact {
  return {
    meter,
    price,
    currency: "USD",
    unit,
    conditions,
    source_ref: sourceRef,
    source_locator: { kind: "fragment", value: sourcePath },
    derived: false,
    raw_price: price,
    raw_unit: unit,
  };
}

function raw(
  termKey: string,
  impact: SourceRawPricingFact["impact"],
  fragment: string,
  sourceRef: string,
  reason: SourceRawPricingFact["reason"] = "unsupported_structure",
): SourceRawPricingFact {
  return {
    term_key: termKey,
    impact,
    reason,
    conditions: {},
    source_ref: sourceRef,
    raw: { fragment },
  };
}

function claim(
  input: Input,
  reasonCode: string,
  path: string,
  markers: readonly string[],
  accept: () => void,
): void {
  const body = input.documents.get(path);
  if (body === undefined || markers.some((marker) => !body.includes(marker))) {
    report(input, "unsupported", `${reasonCode}_not_observed`, path);
    return;
  }
  accept();
  report(input, "normalized", reasonCode, path);
}

function claimAcross(
  input: Input,
  reasonCode: string,
  requirements: readonly (readonly [string, readonly string[]])[],
  accept: () => void,
): void {
  const missing = requirements.find(([path, markers]) => {
    const body = input.documents.get(path);
    return body === undefined || markers.some((marker) => !body.includes(marker));
  });
  if (missing !== undefined) {
    report(input, "unsupported", `${reasonCode}_not_observed`, missing[0]);
    return;
  }
  accept();
  report(input, "normalized", reasonCode, requirements.map(([path]) => path).join(" + "));
}

function freeTierModelRefs(input: Input): string[] {
  const body = input.documents.get(directoryPath);
  if (body === undefined) return [];
  const marker = 'copyString\\":\\"';
  const plainMarker = '"copyString":"';
  const chosen = body.includes(marker) ? marker : plainMarker;
  const terminator = chosen === marker ? '\\"' : '"';
  const eligible = new Set<string>();
  for (const segment of body.split(chosen).slice(1)) {
    const end = segment.indexOf(terminator);
    if (end < 1) continue;
    const modelId = segment.slice(0, end);
    const free =
      segment.includes('availableToFreeTier\\":true') ||
      segment.includes('"availableToFreeTier":true');
    if (!free) continue;
    const modelRef = input.modelRefById.get(modelId);
    if (modelRef === undefined) {
      report(input, "unsupported", "free_tier_unknown_model", modelId);
      continue;
    }
    eligible.add(modelRef);
  }
  return [...eligible].sort();
}

const reviewedSitemapPaths = new Set([
  "/docs/ai-gateway/pricing",
  "/docs/ai-gateway/authentication-and-byok/api-keys",
  "/docs/ai-gateway/authentication-and-byok/byok",
  "/docs/ai-gateway/authentication-and-byok/oidc",
  "/docs/ai-gateway/models-and-providers/automatic-caching",
  "/docs/ai-gateway/models-and-providers/fast-mode",
  "/docs/ai-gateway/models-and-providers/metrics",
  "/docs/ai-gateway/models-and-providers/model-fallbacks",
  "/docs/ai-gateway/models-and-providers/model-filtering",
  "/docs/ai-gateway/models-and-providers/provider-filtering-and-ordering",
  "/docs/ai-gateway/models-and-providers/provider-options",
  "/docs/ai-gateway/models-and-providers/provider-timeouts",
  "/docs/ai-gateway/models-and-providers/reasoning",
  "/docs/ai-gateway/models-and-providers/routing-rules",
  "/docs/ai-gateway/models-and-providers/service-tiers",
  "/docs/ai-gateway/models-and-providers/uptime",
  "/docs/ai-gateway/models-and-providers/web-search",
  "/docs/ai-gateway/observability-and-spend/budgets",
  "/docs/ai-gateway/observability-and-spend/custom-reporting",
  "/docs/ai-gateway/observability-and-spend/logs",
  "/docs/ai-gateway/observability-and-spend/observability",
  "/docs/ai-gateway/observability-and-spend/trace-drains",
  "/docs/ai-gateway/observability-and-spend/usage",
  "/docs/ai-gateway/security-and-compliance/disallow-prompt-training",
  "/docs/ai-gateway/security-and-compliance/model-allowlist",
  "/docs/ai-gateway/security-and-compliance/provider-allowlist",
  "/docs/ai-gateway/security-and-compliance/regional-inference",
  "/docs/ai-gateway/security-and-compliance/zdr",
]);

function auditSitemap(input: Input): void {
  const body = input.documents.get(sitemapPath);
  if (body === undefined) {
    report(input, "unsupported", "commercial_sitemap_missing", sitemapPath);
    return;
  }
  const urls = [...body.matchAll(/<loc>(https:\/\/vercel\.com\/[^<]+)<\/loc>/g)].flatMap((match) =>
    match[1] === undefined ? [] : [new URL(match[1]).pathname],
  );
  for (const path of urls) {
    if (!commercialArea(path) || reviewedSitemapPaths.has(path)) continue;
    report(input, "unsupported", "unreviewed_commercial_page", path);
  }
  report(input, "excluded", "commercial_sitemap_reviewed", `${urls.length} URLs`);
}

function commercialArea(path: string): boolean {
  return (
    path === "/docs/ai-gateway/pricing" ||
    path.startsWith("/docs/ai-gateway/authentication-and-byok/") ||
    path.startsWith("/docs/ai-gateway/observability-and-spend/") ||
    path.startsWith("/docs/ai-gateway/security-and-compliance/") ||
    path === "/docs/ai-gateway/models-and-providers/web-search"
  );
}

function report(
  input: Input,
  disposition: PricingReconciliationItem["disposition"],
  reasonCode: string,
  sample: string,
): void {
  input.onPricingReconciliation?.({ disposition, reason_code: reasonCode, sample });
}
