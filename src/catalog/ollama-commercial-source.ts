import {
  attachCommercialFacts,
  commercialResource as resource,
  publishedRate,
  rawPricingFact as raw,
} from "./pricing.ts";
import type {
  ParsedProviderModel,
  SourceCommercialPricingFact,
  SourceRawPricingFact,
} from "./pricing-source.ts";

export interface OllamaCommercialEvidence {
  free: boolean;
  freeConcurrency?: number;
  pro?: { monthly: string; annual: string; usageMultiple?: number; concurrency?: number };
  max?: { monthly: string; closedToNew: boolean; usageMultiple?: number; concurrency?: number };
  team?: { seatMonthly: string; minimumSeats?: number; waitlist: boolean };
  enterprise: boolean;
  allowance: boolean;
  extraUsage: boolean;
  teamExtraUsage: boolean;
  teamAutomaticBilling: boolean;
  creditExpiry: boolean;
  webSearch: boolean;
  webFetch: boolean;
}

export function attachOllamaLocalCommercialFacts(
  models: ParsedProviderModel[],
  sourceId: string,
): void {
  const fact: SourceCommercialPricingFact = {
    ...resource(
      sourceId,
      "execution:local",
      "Ollama local execution",
      "service",
      "local-execution",
      models.map(({ uid }) => uid),
      "usage",
    ),
    offer_key: "local",
    offer_name: "Local execution",
    pricing_state: "externally_billed",
    price_facts: [],
    raw_price_facts: [
      raw(
        sourceId,
        "operator-compute",
        "base_price",
        "unknown_amount",
        "Ollama does not bill local inference; hardware, energy, administration, and external hosting remain operator costs",
      ),
    ],
  };
  attachCommercialFacts(models, [fact]);
}

export function attachOllamaCloudCommercialFacts(
  models: ParsedProviderModel[],
  sourceId: string,
  evidence: OllamaCommercialEvidence,
): void {
  const refs = models.map(({ uid }) => uid).sort();
  const facts: SourceCommercialPricingFact[] = [];
  if (evidence.free)
    facts.push(
      plan(
        sourceId,
        refs,
        "free",
        "Free",
        "free",
        [],
        evidence.allowance
          ? [
              raw(
                sourceId,
                "free-allowance",
                "allowance",
                "unknown_amount",
                `Free includes a bounded unpublished Cloud allowance${
                  evidence.freeConcurrency === undefined
                    ? ""
                    : ` and ${evidence.freeConcurrency} concurrent Cloud model`
                }`,
              ),
            ]
          : [],
      ),
    );
  if (evidence.pro !== undefined)
    facts.push(
      plan(
        sourceId,
        refs,
        "pro",
        "Pro",
        "numeric",
        [
          publishedRate("subscription", evidence.pro.monthly, "billing_month", sourceId, "month", {
            billing_period: "monthly",
          }),
          publishedRate("subscription", evidence.pro.annual, "billing_year", sourceId, "year", {
            billing_period: "annual",
          }),
        ],
        evidence.allowance
          ? [
              raw(
                sourceId,
                "pro-allowance",
                "allowance",
                "unknown_amount",
                `Pro includes unpublished Cloud usage${
                  evidence.pro.usageMultiple === undefined
                    ? ""
                    : ` at ${evidence.pro.usageMultiple} times Free`
                }${
                  evidence.pro.concurrency === undefined
                    ? ""
                    : ` and ${evidence.pro.concurrency} concurrent Cloud models`
                }${evidence.extraUsage ? ", with extra-usage eligibility" : ""}`,
              ),
            ]
          : [],
      ),
    );
  if (evidence.max !== undefined)
    facts.push(
      plan(
        sourceId,
        refs,
        "max",
        "Max",
        "numeric",
        [publishedRate("subscription", evidence.max.monthly, "billing_month", sourceId, "month")],
        [
          ...(evidence.allowance
            ? [
                raw(
                  sourceId,
                  "max-allowance",
                  "allowance",
                  "unknown_amount",
                  `Max includes unpublished Cloud usage${
                    evidence.max.usageMultiple === undefined
                      ? ""
                      : ` at ${evidence.max.usageMultiple} times Pro`
                  }${
                    evidence.max.concurrency === undefined
                      ? ""
                      : ` and ${evidence.max.concurrency} concurrent Cloud models`
                  }${evidence.extraUsage ? ", with extra-usage eligibility" : ""}`,
                ),
              ]
            : []),
          ...(evidence.max.closedToNew
            ? [
                raw(
                  sourceId,
                  "max-enrollment",
                  "informational",
                  "unsupported_structure",
                  "New Max sign-ups are paused while existing subscribers retain the plan",
                ),
              ]
            : []),
        ],
      ),
    );
  if (evidence.team !== undefined)
    facts.push(
      plan(
        sourceId,
        refs,
        "team",
        "Team",
        "numeric",
        [
          publishedRate(
            "subscription",
            evidence.team.seatMonthly,
            "seat_month",
            sourceId,
            "seat / month",
          ),
        ],
        [
          ...(evidence.team.minimumSeats === undefined
            ? []
            : [
                raw(
                  sourceId,
                  "team-minimum",
                  "base_price",
                  "requires_usage_aggregation",
                  `${evidence.team.minimumSeats}-seat minimum; each seat has included usage before the shared extra-usage balance`,
                ),
              ]),
          ...(evidence.team.waitlist
            ? [
                raw(
                  sourceId,
                  "team-enrollment",
                  "informational",
                  "unsupported_structure",
                  "Team enrollment is currently waitlisted",
                ),
              ]
            : []),
        ],
      ),
    );
  if (evidence.enterprise)
    facts.push(
      plan(
        sourceId,
        refs,
        "enterprise",
        "Enterprise",
        "custom_quote",
        [],
        [
          raw(
            sourceId,
            "enterprise-terms",
            "base_price",
            "unknown_amount",
            "Enterprise uses volume pricing and custom terms",
          ),
        ],
      ),
    );
  if (evidence.allowance)
    facts.push({
      ...resource(
        sourceId,
        "account:cloud-allowance",
        "Ollama Cloud included usage",
        "account_resource_template",
        "cloud-allowance",
        refs,
        "usage",
      ),
      offer_key: "account",
      offer_name: "Session and weekly usage allowance",
      pricing_state: "included",
      price_facts: [],
      raw_price_facts: [
        raw(
          sourceId,
          "allowance-weighting",
          "allowance",
          "unknown_amount",
          "Usage is weighted by model plus input, cached-input, and output tokens; session limits reset every five hours and weekly limits every seven days",
        ),
      ],
    });
  if (evidence.extraUsage)
    facts.push(
      balance(sourceId, refs, "personal", "Personal extra-usage balance", evidence.creditExpiry),
    );
  if (evidence.teamExtraUsage)
    facts.push(
      balance(
        sourceId,
        refs,
        "team",
        "Shared Team extra-usage balance",
        evidence.creditExpiry,
        evidence.teamAutomaticBilling,
      ),
    );
  if (evidence.webSearch)
    facts.push(service(sourceId, "web-search", "Ollama Web Search", "/api/web_search"));
  if (evidence.webFetch)
    facts.push(service(sourceId, "web-fetch", "Ollama Web Fetch", "/api/web_fetch"));
  attachCommercialFacts(models, facts);
}

function plan(
  sourceId: string,
  refs: string[],
  key: string,
  name: string,
  state: SourceCommercialPricingFact["pricing_state"],
  priceFacts: SourceCommercialPricingFact["price_facts"],
  rawFacts: SourceRawPricingFact[],
): SourceCommercialPricingFact {
  return {
    ...resource(
      sourceId,
      "plan:ollama-cloud",
      "Ollama Cloud plans",
      "plan",
      "ollama-cloud",
      refs,
      "subscription",
    ),
    offer_key: key,
    offer_name: name,
    pricing_state: state,
    price_facts: priceFacts,
    raw_price_facts: rawFacts,
  };
}

function balance(
  sourceId: string,
  refs: string[],
  key: string,
  name: string,
  expires: boolean,
  automaticBilling = false,
): SourceCommercialPricingFact {
  return {
    ...resource(
      sourceId,
      "account:extra-usage-balance",
      "Ollama extra-usage balance",
      "account_resource_template",
      "extra-usage-balance",
      refs,
      "usage",
    ),
    offer_key: key,
    offer_name: name,
    pricing_state: "not_published",
    price_facts: [],
    raw_price_facts: [
      raw(
        sourceId,
        "balance-settlement",
        "informational",
        "unsupported_structure",
        key === "team"
          ? "Eligible Team overage uses the separate organization's shared balance after each seat allowance"
          : "Eligible personal overage uses purchased extra-usage balance after included usage unless an exact model card says otherwise",
      ),
      ...(expires
        ? [
            raw(
              sourceId,
              "balance-expiry",
              "informational",
              "unsupported_structure",
              "Purchased extra-usage credits expire one year after being added",
            ),
          ]
        : []),
      ...(automaticBilling
        ? [
            raw(
              sourceId,
              "automatic-billing",
              "informational",
              "unsupported_structure",
              "Team automatic usage billing can be disabled",
            ),
          ]
        : []),
    ],
  };
}

function service(
  sourceId: string,
  key: string,
  name: string,
  endpoint: string,
): SourceCommercialPricingFact {
  return {
    ...resource(
      sourceId,
      "service:ollama-web",
      "Ollama web services",
      "service",
      "ollama-web",
      [],
      "usage",
    ),
    offer_key: key,
    offer_name: name,
    pricing_state: "not_published",
    price_facts: [],
    raw_price_facts: [
      raw(
        sourceId,
        `${key}-price`,
        "base_price",
        "unknown_amount",
        `${endpoint} is an independently callable Ollama API with no published amount or billing denominator`,
      ),
    ],
  };
}
