import { parentPort } from "node:worker_threads";
import type { PricingCatalog } from "./pricing-schema.ts";
import {
  validatePricingCatalogProvidersFromTopology,
  type PricingValidationCore,
} from "./pricing-validation.ts";

interface ValidationTask {
  providerId: string;
  data: PricingCatalog;
  core: PricingValidationCore;
}

const port = parentPort;
if (port === null) throw new Error("Pricing validation worker has no parent port");
port.on("message", (message: unknown) => {
  if (!isValidationTask(message))
    throw new Error("Pricing validation worker received invalid work");
  try {
    validatePricingCatalogProvidersFromTopology(message.data, message.core);
    port.postMessage({ providerId: message.providerId });
  } catch (error) {
    port.postMessage({
      providerId: message.providerId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

function isValidationTask(value: unknown): value is ValidationTask {
  return (
    value !== null &&
    typeof value === "object" &&
    "providerId" in value &&
    typeof value.providerId === "string" &&
    "data" in value &&
    value.data !== null &&
    typeof value.data === "object" &&
    "core" in value &&
    value.core !== null &&
    typeof value.core === "object"
  );
}
