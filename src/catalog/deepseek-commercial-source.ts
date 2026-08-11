import {
  attachCommercialFacts,
  commercialResource as resource,
  rawPricingFact as raw,
} from "./pricing.ts";
import type { ParsedProviderModel, SourceCommercialPricingFact } from "./pricing-source.ts";

export interface DeepseekCommercialEvidence {
  anthropicRouting: boolean;
  balance: boolean;
  concurrency: boolean;
  faq: boolean;
  webSearchModels: ReadonlySet<string>;
  webSearchTokenCost: boolean;
}

export function attachDeepseekCommercialFacts(
  models: ParsedProviderModel[],
  sourceId: string,
  evidence: DeepseekCommercialEvidence,
): void {
  const facts: SourceCommercialPricingFact[] = [];
  const allRefs = models.map(({ uid }) => uid).sort();
  const searchModels = models.filter(({ model_id }) => evidence.webSearchModels.has(model_id));

  for (const model of searchModels)
    facts.push({
      ...resource(
        sourceId,
        "service:web-search",
        "DeepSeek built-in web search",
        "service",
        "web-search",
        [model.uid],
        "usage",
      ),
      offer_key: `execution:${model.uid}`,
      offer_name: `Provider-executed web search for ${model.model_id}`,
      pricing_state: "not_published",
      price_facts: [],
      raw_price_facts: [
        raw(
          sourceId,
          "web_search_amount_not_published",
          "base_price",
          "unknown_amount",
          "DeepSeek publishes the provider-executed web-search service but no distinct search-call amount or denominator",
        ),
        ...(evidence.webSearchTokenCost
          ? [
              raw(
                sourceId,
                "web_search_additional_model_usage",
                "informational",
                "requires_usage_aggregation",
                "A built-in web search generates additional model requests whose tokens are charged at the applicable model rates",
              ),
            ]
          : [
              raw(
                sourceId,
                "web_search_model_usage_unbound",
                "informational",
                "unknown_applicability",
                "The official integration evidence for additional model-token charges is missing or drifted",
              ),
            ]),
      ],
    });

  if (evidence.balance)
    facts.push({
      ...resource(
        sourceId,
        "account:balance",
        "DeepSeek account balance",
        "account_resource_template",
        "balance",
        allRefs,
        "one_time",
      ),
      offer_key: "settlement",
      offer_name: "Topped-up and granted balance",
      pricing_state: "not_published",
      price_facts: [],
      raw_price_facts: [
        raw(
          sourceId,
          "balance_components",
          "informational",
          "unsupported_structure",
          "The balance API reports total, granted, and topped-up balances in CNY or USD; it does not select a public price book for the credential",
        ),
        raw(
          sourceId,
          "granted_balance_allowance",
          "allowance",
          "unknown_amount",
          "Unexpired granted balance is an account-specific allowance and is preferred before topped-up balance",
        ),
        ...(evidence.faq
          ? [
              raw(
                sourceId,
                "topped_up_balance_terms",
                "informational",
                "unsupported_structure",
                "Topped-up balance does not expire and unused balance is refundable; granted-balance expiry remains account specific",
              ),
            ]
          : []),
      ],
    });

  if (evidence.concurrency)
    facts.push({
      ...resource(
        sourceId,
        "account:concurrency",
        "DeepSeek account concurrency",
        "account_resource_template",
        "concurrency",
        allRefs,
        "capacity",
      ),
      offer_key: "entitlement",
      offer_name: "Account concurrency entitlement",
      pricing_state: "not_published",
      price_facts: [],
      raw_price_facts: [
        raw(
          sourceId,
          "account_concurrency",
          "informational",
          "unsupported_structure",
          "Published concurrency is account scoped; approved expansion has no additional fee but no universally purchasable quantity or capacity rate is published",
        ),
      ],
    });

  if (evidence.anthropicRouting)
    facts.push({
      ...resource(
        sourceId,
        "distribution:anthropic-routing",
        "DeepSeek Anthropic-compatible routing",
        "distribution",
        "anthropic-routing",
        allRefs,
        "usage",
      ),
      offer_key: "mapping",
      offer_name: "Anthropic request-name mapping",
      pricing_state: "included",
      price_facts: [],
      raw_price_facts: [
        raw(
          sourceId,
          "anthropic_model_mapping",
          "informational",
          "unsupported_structure",
          "claude-opus* routes to deepseek-v4-pro; claude-haiku*, claude-sonnet*, and other unsupported names route to deepseek-v4-flash",
        ),
      ],
    });

  attachCommercialFacts(models, facts);
}
