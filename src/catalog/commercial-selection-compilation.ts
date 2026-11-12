import type { InferencePriceMapping } from "../pricing/inference-schema.ts";
import type { PricingCatalogEnvelope } from "./pricing-schema.ts";

/** Project owned claims; offer names, endpoints and model capabilities have no role here. */
export function projectCommercialSelections(
  pricing: PricingCatalogEnvelope,
  mapping: InferencePriceMapping,
): InferencePriceMapping {
  return {
    ...mapping,
    rules: mapping.rules.map(({ execution_choices: _legacy, ...rule }) => rule),
    offer_selections: pricing.data.books.flatMap(({ offers }) =>
      offers.flatMap((offer) =>
        offer.selection === undefined
          ? []
          : [
              {
                offer_ref: offer.id,
                selection: offer.selection.map(({ observations, ...claim }) => ({
                  ...claim,
                  evidence: observations.map(({ source_ref, locator }) => ({
                    source_ref,
                    locator,
                  })),
                })),
              },
            ],
      ),
    ),
  };
}
