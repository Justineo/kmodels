import { parentPort } from "node:worker_threads";
import {
  assembleParsedProviderPricing,
  type ParsedPricingSource,
  type PublishedPricingModel,
} from "./pricing-adapter.ts";
import type { PricingCategoricalLabel } from "./manifests.ts";
import type { ProviderPricingSnapshot } from "./pricing-schema.ts";
import { providerPricingPartitionHash } from "./pricing-assembly.ts";

interface CompilationTask {
  providerId: string;
  acceptedPartitionHash: string;
  snapshot: ProviderPricingSnapshot;
  sources: ParsedPricingSource[];
  models: PublishedPricingModel[];
  categoricalLabels?: PricingCategoricalLabel[];
}

const port = parentPort;
if (port === null) throw new Error("Pricing compilation worker has no parent port");
port.on("message", (message: unknown) => {
  if (!isCompilationTask(message))
    throw new Error("Pricing compilation worker received invalid work");
  try {
    const partition = assembleParsedProviderPricing(
      message.providerId,
      message.snapshot.observed_at,
      message.sources,
      message.models,
      message.categoricalLabels,
    );
    const complete = partition === undefined ? null : { ...partition, snapshot: message.snapshot };
    if (
      complete !== null &&
      providerPricingPartitionHash(complete) === message.acceptedPartitionHash
    )
      port.postMessage({
        providerId: message.providerId,
        acceptedPartitionHash: message.acceptedPartitionHash,
      });
    else port.postMessage({ providerId: message.providerId, partition: complete });
  } catch (error) {
    port.postMessage({
      providerId: message.providerId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

function isCompilationTask(value: unknown): value is CompilationTask {
  return (
    value !== null &&
    typeof value === "object" &&
    "providerId" in value &&
    typeof value.providerId === "string" &&
    "acceptedPartitionHash" in value &&
    typeof value.acceptedPartitionHash === "string" &&
    "snapshot" in value &&
    value.snapshot !== null &&
    typeof value.snapshot === "object" &&
    "sources" in value &&
    Array.isArray(value.sources) &&
    "models" in value &&
    Array.isArray(value.models) &&
    (!("categoricalLabels" in value) ||
      value.categoricalLabels === undefined ||
      Array.isArray(value.categoricalLabels))
  );
}
