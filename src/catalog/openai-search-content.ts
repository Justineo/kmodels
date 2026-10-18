import { pricingBookId, pricingOfferId, pricingTermId } from "./pricing-identifiers.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import type {
  PriceApplicability,
  PriceContributionTerm,
  PriceContributionVariant,
  ProviderAtomRegistryEntry,
  RawPriceObservation,
  UnitExpression,
  UsageSignal,
} from "./pricing-schema.ts";
import type { SourceCommercialPricingFact } from "./pricing-source.ts";

const tokens: UnitExpression = {
  factors: [{ unit: { namespace: "kmodels", value: "token" }, power: 1 }],
};
const calls: Extract<UsageSignal, { namespace: "provider" }> = {
  namespace: "provider",
  provider_id: "openai",
  value: "fixed_search_content_calls",
};
const content: Extract<UsageSignal, { namespace: "provider" }> = {
  namespace: "provider",
  provider_id: "openai",
  value: "fixed_search_content_tokens",
};
const applicability: PriceApplicability = {
  any_of: [
    {
      all_of: [
        {
          kind: "categorical",
          dimension: { namespace: "kmodels", value: "operation" },
          values: [{ namespace: "provider", provider_id: "openai", value: "search" }],
        },
      ],
    },
  ],
};

/** Each quote belongs to the reviewed Tools section and names these exact two models. */
export function openAiSearchContent(
  modelIds: readonly ("gpt-4o-mini" | "gpt-4.1-mini")[],
  sourceRef: string,
  quotes: readonly string[],
): {
  facts: SourceCommercialPricingFact[];
  vocabulary: ProviderAtomRegistryEntry[];
  items: PricingReconciliationItem[];
} {
  const variants: Omit<PriceContributionVariant, "target_rate_refs">[] = [];
  const raw: PriceContributionTerm["raw_variants"] = [];
  const items: PricingReconciliationItem[] = [];
  const amounts = new Set<string>();
  for (const fragment of quotes) {
    const observation: RawPriceObservation = {
      source_ref: sourceRef,
      locator: { kind: "fragment", value: "/api/docs/pricing.md#tools" },
      raw: { label: "Fixed search content block", fragment },
    };
    const amount = fragment.match(
      /^For gpt-4o-mini and gpt-4\.1-mini with the non-preview web search tool, search content tokens are billed as a fixed block of ([1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+) input tokens per call\.$/,
    )?.[1];
    items.push({
      disposition: modelIds.length === 0 ? "unbound" : amount === undefined ? "raw" : "normalized",
      reason_code: "fixed_search_content_rule",
      sample: fragment.slice(0, 256),
    });
    if (amount === undefined) {
      raw.push({
        impact: "base_price",
        reason: "unsupported_structure",
        possible_scope: applicability,
        observations: [observation],
      });
      continue;
    }
    amounts.add(amount.replaceAll(",", ""));
    variants.push({
      applicability,
      observations: [{ ...observation, establishes_applicability: applicability }],
      charge_bindings: [
        {
          signal: content,
          aggregation: "request",
          quantity_methods: [
            {
              calculation: {
                nodes: [
                  { op: "signal", signal: calls },
                  {
                    op: "constant",
                    value: { numerator: amount.replaceAll(",", ""), denominator: "1" },
                    unit: tokens,
                  },
                  { op: "product", inputs: [0, 1] },
                ],
                result: 2,
              },
            },
          ],
          observations: [observation],
        },
      ],
    });
  }
  if (amounts.size > 1)
    for (const item of items) if (item.disposition === "normalized") item.disposition = "ambiguous";
  const vocabulary: ProviderAtomRegistryEntry[] = [];
  if (modelIds.length > 0) {
    vocabulary.push({
      kind: "categorical_value",
      key: "search",
      dimension: { namespace: "kmodels", value: "operation" },
      label: "Web Search",
      definition: "The non-preview Web Search operation covered by the fixed-content rule",
    });
    if (variants.length > 0)
      vocabulary.push(
        {
          kind: "usage_signal",
          key: calls.value,
          definition:
            "Count of billable non-preview Web Search call instances whose fixed content blocks are excluded from separately priced model input usage",
          unit: { factors: [{ unit: { namespace: "kmodels", value: "item" }, power: 1 }] },
          resolution_phase: "outcome",
        },
        {
          kind: "usage_signal",
          key: content.value,
          definition:
            "Fixed Web Search content tokens contributed to the compatible model input rate",
          unit: tokens,
          resolution_phase: "outcome",
        },
      );
  }
  return {
    facts: modelIds.map((modelId) => {
      const modelRef = `openai/${modelId}`;
      const resourceKey = `web-search-content:${modelId}`;
      const bookKey = `service:${resourceKey}`;
      const term: PriceContributionTerm = {
        id: pricingTermId(
          pricingOfferId(pricingBookId("openai", bookKey), "current"),
          "contribution",
          "fixed-search-content",
        ),
        term_key: "fixed-search-content",
        kind: "contribution",
        source_refs: [sourceRef],
        variants: variants.map((variant) => ({
          ...variant,
          target_rate_refs: [
            pricingTermId(
              pricingOfferId(pricingBookId("openai", `model:${modelRef}`), "sync"),
              "rate",
              "input_text",
            ),
          ],
        })),
        raw_variants: raw,
      };
      return {
        source_ref: sourceRef,
        book_key: bookKey,
        book_name: `Web Search fixed content (${modelId})`,
        resource_kind: "service",
        resource_key: resourceKey,
        model_refs: [modelRef],
        offer_key: "current",
        offer_name: "Non-preview search content blocks",
        billing_mode: "usage",
        pricing_state: "numeric",
        price_facts: [],
        raw_price_facts: [],
        terms: [term],
      };
    }),
    vocabulary,
    items,
  };
}
