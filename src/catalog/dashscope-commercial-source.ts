import { attachCommercialFacts } from "./pricing.ts";
import type {
  ParsedProviderModel,
  SourceCommercialPricingFact,
  SourcePriceFact,
} from "./pricing-source.ts";

export interface DashscopeToolRate {
  modelId: string;
  scope: string;
  rate: SourcePriceFact;
}

export function attachDashscopeWebSearchFacts(
  models: Map<string, ParsedProviderModel>,
  sourceId: string,
  rates: readonly DashscopeToolRate[],
): void {
  attachToolFacts(models, sourceId, rates, {
    bookKey: "service:web-search",
    bookName: "Model Studio built-in web search",
    resourceKey: "web-search",
    offerPrefix: "Built-in web search",
  });
}

export function attachDashscopeImageSearchFacts(
  models: Map<string, ParsedProviderModel>,
  sourceId: string,
  rates: readonly DashscopeToolRate[],
): void {
  attachToolFacts(models, sourceId, rates, {
    bookKey: "service:image-search",
    bookName: "Model Studio built-in image search",
    resourceKey: "image-search",
    offerPrefix: "Built-in image search",
  });
}

export function attachDashscopeTextToImageSearchFacts(
  models: Map<string, ParsedProviderModel>,
  sourceId: string,
  rates: readonly DashscopeToolRate[],
): void {
  attachToolFacts(models, sourceId, rates, {
    bookKey: "service:text-to-image-search",
    bookName: "Model Studio text-to-image search",
    resourceKey: "text-to-image-search",
    offerPrefix: "Text-to-image search",
  });
}

function attachToolFacts(
  models: Map<string, ParsedProviderModel>,
  sourceId: string,
  rates: readonly DashscopeToolRate[],
  identity: {
    bookKey: string;
    bookName: string;
    resourceKey: string;
    offerPrefix: string;
  },
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
      book_key: identity.bookKey,
      book_name: identity.bookName,
      resource_kind: "service",
      resource_key: identity.resourceKey,
      model_refs: [...modelRefs].sort(),
      offer_key: `built-in:${slug(scope)}`,
      offer_name: `${identity.offerPrefix} in ${scope}`,
      billing_mode: "usage",
      pricing_state: "numeric",
      price_facts: [rate],
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
