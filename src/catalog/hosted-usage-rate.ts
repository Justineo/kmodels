import { standardSignal } from "./pricing-commercial-assembly.ts";
import type { PriceSourceLocator } from "./pricing-schema.ts";
import type { SourceInferencePrice } from "./inference-pricing-source.ts";
import { publishedRate } from "./pricing.ts";

type Rate = ReturnType<typeof publishedRate>;
type Signal = Parameters<typeof standardSignal>[0];

export function hostedUsageRate(rate: Rate, locator: PriceSourceLocator, signal: Signal): Rate {
  return {
    ...rate,
    source_locator: locator,
    charge_binding: {
      signal: standardSignal(signal),
      aggregation: "request",
      observations: [
        {
          source_ref: rate.source_ref,
          locator,
          raw: { meter: rate.meter, amount: rate.raw_price, unit: rate.raw_unit },
        },
      ],
    },
  };
}

export function usdAmount(cell: string): string | undefined {
  if (cell === "Free") return "0";
  return cell.match(/^\\?\$((?:0|[1-9]\d*)(?:\.\d+)?)$/u)?.[1];
}

export function hostedInferencePrice(
  model: { model_id: string; uid: string },
  source_ref: string,
  locator: PriceSourceLocator,
): SourceInferencePrice {
  return {
    model_id: model.model_id,
    model_ref: model.uid,
    source_ref,
    offer_key: "usage",
    fixed_selectors: [],
    evidence: [{ source_ref, locator }],
  };
}
