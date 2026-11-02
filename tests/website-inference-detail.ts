import { restoreInferencePrices } from "../src/catalog/website-inference-storage.ts";
import type { WebsiteStoredModelDetail } from "../src/catalog/website-schema.ts";

export function restoreWebsiteInferenceDetail({
  inference_prices,
  ...detail
}: WebsiteStoredModelDetail) {
  return {
    ...detail,
    ...(inference_prices === undefined
      ? {}
      : { inference_prices: restoreInferencePrices(inference_prices) }),
  };
}
