import { attachCommercialFacts } from "./pricing.ts";
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
): void {
  const groups = new Map<
    string,
    { modelRefs: Set<string>; rate: SourcePriceFact; scope: string }
  >();
  for (const { modelId, scope, rate } of rates) {
    const model = models.get(modelId);
    if (model === undefined) continue;
    const key = JSON.stringify([scope, rate.price, rate.currency, rate.unit, rate.conditions]);
    const group = groups.get(key) ?? { modelRefs: new Set(), rate, scope };
    group.modelRefs.add(model.uid);
    groups.set(key, group);
  }
  const facts = [...groups.values()].map(
    ({ modelRefs, rate, scope }): SourceCommercialPricingFact => ({
      source_ref: sourceId,
      book_key: "service:web-search",
      book_name: "Model Studio built-in web search",
      resource_kind: "service",
      resource_key: "web-search",
      model_refs: [...modelRefs].sort(),
      offer_key: `built-in:${slug(scope)}`,
      offer_name: `Built-in web search in ${scope}`,
      billing_mode: "usage",
      pricing_state: "numeric",
      price_facts: [{ ...rate, meter: "web_search" }],
      raw_price_facts: [],
    }),
  );
  attachCommercialFacts([...models.values()], facts);
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
