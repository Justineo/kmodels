import {
  attachCommercialFacts,
  commercialResource as resource,
  publishedRate,
  rawPricingFact as raw,
} from "./pricing.ts";
import type { ParsedProviderModel, SourceCommercialPricingFact } from "./pricing-source.ts";

export interface CerebrasCodePlan {
  key: string;
  name: string;
  monthlyPrice: string;
  dailyTokens: string;
  closedToNew: boolean;
}

export interface CerebrasCommercialEvidence {
  accountSubscriptions: boolean;
  batch: boolean;
  batchFiles: boolean;
  codePlans: readonly CerebrasCodePlan[];
  costReporting: boolean;
  dedicated: boolean;
  freeTrial: boolean;
  marketplace: boolean;
  metrics: boolean;
  projectQuotas: boolean;
  training: boolean;
}

export function attachCerebrasCommercialFacts(
  models: ParsedProviderModel[],
  sourceId: string,
  evidence: CerebrasCommercialEvidence,
): void {
  const facts: SourceCommercialPricingFact[] = [];
  const allRefs = models.map(({ uid }) => uid).sort();

  if (evidence.freeTrial)
    facts.push({
      ...resource(
        sourceId,
        "plan:free-trial",
        "Cerebras Free Trial",
        "plan",
        "free-trial",
        allRefs,
        "hybrid",
      ),
      offer_key: "credit",
      offer_name: "Thirty-day trial credit",
      pricing_state: "included",
      price_facts: [],
      raw_price_facts: [
        raw(
          sourceId,
          "free-trial-credit",
          "allowance",
          "unsupported_structure",
          "USD 5 of credit applies across public models and expires 30 days after grant",
        ),
        raw(
          sourceId,
          "free-trial-enrollment",
          "informational",
          "unsupported_structure",
          "A verified payment method is required; access stops after credit expiry or exhaustion until PAYG credit is purchased",
        ),
      ],
    });

  if (evidence.accountSubscriptions)
    for (const model of models)
      facts.push({
        ...resource(
          sourceId,
          "plan:inference-subscription",
          "Cerebras per-model inference subscriptions",
          "plan",
          "inference-subscription",
          [model.uid],
          "subscription",
        ),
        offer_key: `model:${model.uid}`,
        offer_name: `Account subscription for ${model.model_id}`,
        pricing_state: "not_published",
        price_facts: [],
        raw_price_facts: [
          raw(
            sourceId,
            "subscription-amount",
            "base_price",
            "unknown_amount",
            "The console publishes multiple monthly tiers per model only inside the account",
          ),
          raw(
            sourceId,
            "subscription-coverage",
            "allowance",
            "unsupported_structure",
            "Requests covered by an active monthly subscription are excluded from usage-based billing",
          ),
        ],
      });

  for (const plan of evidence.codePlans)
    facts.push({
      ...resource(
        sourceId,
        "plan:cerebras-code",
        "Cerebras Code",
        "plan",
        "cerebras-code",
        [],
        "subscription",
      ),
      offer_key: plan.key,
      offer_name: plan.name,
      pricing_state: "numeric",
      price_facts: [
        publishedRate("subscription", plan.monthlyPrice, "unit_month", sourceId, "month", {
          account_eligibility: plan.key,
          billing_period: "monthly",
        }),
      ],
      raw_price_facts: [
        raw(
          sourceId,
          "daily-token-allowance",
          "allowance",
          "unknown_applicability",
          `Up to ${plan.dailyTokens} tokens per day; current model route, token direction, reset boundary, and overage behavior are not published`,
        ),
        ...(plan.closedToNew
          ? [
              raw(
                sourceId,
                "closed-enrollment",
                "informational",
                "unsupported_structure",
                "The current pricing page marks this plan sold out",
              ),
            ]
          : []),
      ],
    });

  if (evidence.batch)
    for (const model of models.filter(({ api_endpoints }) =>
      api_endpoints?.some(({ path }) => path.endsWith("/chat/completions")),
    ))
      facts.push({
        ...resource(
          sourceId,
          "service:batch",
          "Cerebras Batch",
          "service",
          "batch",
          [model.uid],
          "usage",
        ),
        offer_key: `execution:${model.uid}`,
        offer_name: `Batch inference for ${model.model_id}`,
        pricing_state: "not_published",
        price_facts: [],
        raw_price_facts: [
          raw(
            sourceId,
            "batch-rate",
            "base_price",
            "unknown_amount",
            "Batch is Private Preview and publishes no current amount or discount",
          ),
          raw(
            sourceId,
            "batch-charge-trigger",
            "informational",
            "requires_usage_aggregation",
            "Only completed result items are charged and each successful result returns ordinary prompt and completion usage",
          ),
        ],
      });

  if (evidence.batchFiles)
    facts.push({
      ...resource(
        sourceId,
        "account:batch-file",
        "Cerebras Batch input files",
        "account_resource_template",
        "batch-file",
        [],
        "one_time",
      ),
      offer_key: "input",
      offer_name: "Batch-purpose JSONL file",
      pricing_state: "not_published",
      price_facts: [],
      raw_price_facts: [
        raw(
          sourceId,
          "batch-file-retention",
          "informational",
          "unsupported_structure",
          "Batch-purpose files expire after 7 days by default; no independent storage amount is published",
        ),
      ],
    });

  if (evidence.dedicated)
    facts.push({
      ...resource(
        sourceId,
        "capacity:dedicated-endpoint",
        "Cerebras Dedicated Endpoint",
        "capacity",
        "dedicated-endpoint",
        [],
        "capacity",
      ),
      offer_key: "enterprise",
      offer_name: "Reserved organization endpoint",
      pricing_state: "custom_quote",
      price_facts: [],
      raw_price_facts: [
        raw(
          sourceId,
          "dedicated-capacity",
          "base_price",
          "unknown_unit",
          "Dedicated Inference reserves organization-exclusive capacity under an enterprise contract",
        ),
        raw(
          sourceId,
          "dedicated-model-boundary",
          "informational",
          "unknown_applicability",
          "Account endpoint IDs, supported weight repositories, and uploaded versions are not global public model IDs",
        ),
      ],
    });

  if (evidence.training)
    facts.push({
      ...resource(
        sourceId,
        "service:model-development",
        "Cerebras enterprise model services",
        "service",
        "model-development",
        [],
        "capacity",
      ),
      offer_key: "enterprise",
      offer_name: "Fine-tuning and training services",
      pricing_state: "custom_quote",
      price_facts: [],
      raw_price_facts: [],
    });

  if (evidence.marketplace)
    facts.push({
      ...resource(
        sourceId,
        "distribution:aws-marketplace",
        "Cerebras through AWS Marketplace",
        "distribution",
        "aws-marketplace",
        allRefs,
        "usage",
      ),
      offer_key: "settlement",
      offer_name: "AWS Marketplace settlement",
      pricing_state: "externally_billed",
      price_facts: [],
      raw_price_facts: [
        raw(
          sourceId,
          "marketplace-routing",
          "informational",
          "unsupported_structure",
          "The X-Cerebras-3rd-Party-Integration header routes normal API usage to monthly AWS billing",
        ),
        raw(
          sourceId,
          "marketplace-reporting",
          "informational",
          "unsupported_structure",
          "The USD 0.01 Marketplace SKU converts API charges one-to-one and charges can appear after 24–48 hours; it is not an added fee",
        ),
      ],
    });

  if (evidence.costReporting)
    facts.push(
      accountFact(
        sourceId,
        "cost-report",
        "Cerebras console cost reporting",
        allRefs,
        "Cost and CSV reports can lag by 10 minutes and exclude requests covered by active monthly subscriptions",
      ),
    );
  if (evidence.projectQuotas)
    facts.push(
      accountFact(
        sourceId,
        "project-quota",
        "Cerebras project and organization quotas",
        allRefs,
        "Requests are checked against project and organization limits while billing remains aggregated at the organization",
      ),
    );
  if (evidence.metrics)
    facts.push(
      accountFact(
        sourceId,
        "dedicated-metrics",
        "Cerebras Dedicated Metrics",
        [],
        "Opt-in dedicated metrics report aggregate requests, tokens, cache reads, and latency for the last complete minute, not request cost",
      ),
    );

  attachCommercialFacts(models, facts);
}

function accountFact(
  source_ref: string,
  resource_key: string,
  book_name: string,
  model_refs: string[],
  fragment: string,
): SourceCommercialPricingFact {
  return {
    ...resource(
      source_ref,
      `account:${resource_key}`,
      book_name,
      "account_resource_template",
      resource_key,
      model_refs,
      "one_time",
    ),
    offer_key: "account",
    offer_name: book_name,
    pricing_state: "not_published",
    price_facts: [],
    raw_price_facts: [
      raw(source_ref, resource_key, "informational", "unsupported_structure", fragment),
    ],
  };
}
