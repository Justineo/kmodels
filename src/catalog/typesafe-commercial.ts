import type { AtomicProviderPricing, AtomicRateVariant } from "./pricing-assembly.ts";
import {
  bindRateTerm,
  isStandardUnit,
  rawEvidence,
  standardSignal,
} from "./pricing-commercial-assembly.ts";
import {
  directQuantityMethods,
  includePricingInputSourceRefs,
  indexPricingInputs,
  pricingInputObservation,
  type PricingInputIndex,
} from "./pricing-input.ts";
import type { ChargeBinding, PriceMeter } from "./pricing-schema.ts";
import type { SourcePricingInputFact } from "./pricing-source.ts";

export function applyTypesafeCommercialTopology(
  input: AtomicProviderPricing,
  pricingInputs: readonly SourcePricingInputFact[],
): AtomicProviderPricing {
  const index = indexPricingInputs(pricingInputs);
  return {
    ...input,
    books: input.books.map((book) =>
      includePricingInputSourceRefs({
        ...book,
        offers: book.offers.map((offer) => ({
          ...offer,
          offer_key: "systemone",
          name: "System One evaluation",
          terms: offer.terms.map((term) =>
            bindRateTerm(term, (meter, variant) => tokenBinding(meter, variant, index)),
          ),
        })),
      }),
    ),
  };
}

function tokenBinding(
  meter: PriceMeter,
  variant: AtomicRateVariant,
  index: PricingInputIndex,
): ChargeBinding | undefined {
  if (!isStandardUnit(variant.price.per, "token")) return;
  let key: "input_tokens" | "output_tokens";
  if (meter.namespace === "kmodels" && meter.value === "input_text") key = "input_tokens";
  else if (
    meter.namespace === "provider" &&
    meter.provider_id === "typesafe" &&
    meter.value === "output_data"
  )
    key = "output_tokens";
  else return;

  const signal = standardSignal(key);
  const mapped = directQuantityMethods(signal, [`systemone.${key}`], index);
  return {
    signal,
    aggregation: "request",
    ...(mapped.methods.length === 0 ? {} : { quantity_methods: mapped.methods }),
    observations: [rawEvidence(variant.observation), ...mapped.facts.map(pricingInputObservation)],
  };
}
