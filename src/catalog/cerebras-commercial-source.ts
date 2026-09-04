import { attachCommercialFacts, commercialResource } from "./pricing.ts";
import type { ParsedProviderModel } from "./pricing-source.ts";

export function attachCerebrasBatch(models: ParsedProviderModel[], sourceId: string): void {
  attachCommercialFacts(models, [
    {
      ...commercialResource(
        sourceId,
        "service:batch",
        "Cerebras Batch",
        "service",
        "batch",
        [],
        "usage",
      ),
      offer_key: "execution",
      offer_name: "Batch inference",
      pricing_state: "not_published",
      price_facts: [],
      raw_price_facts: [],
    },
  ]);
}
