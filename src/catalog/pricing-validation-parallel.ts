import { Worker } from "node:worker_threads";
import type { PricingCatalog } from "./pricing-schema.ts";
import {
  validatePricingCatalogTopology,
  type PricingValidationCore,
} from "./pricing-validation.ts";

const workerCount = 4;

interface ValidationTask {
  providerId: string;
  data: PricingCatalog;
  core: PricingValidationCore;
}

interface ValidationResult {
  providerId: string;
  error?: string;
}

export function validatePricingCatalogInParallel(
  data: PricingCatalog,
  core: PricingValidationCore,
): Promise<void> {
  validatePricingCatalogTopology(data, core);
  const tasks = providerTasks(data, core);
  let nextTask = 0;
  return Promise.all(
    Array.from({ length: Math.min(workerCount, tasks.length) }, async () => {
      const worker = new Worker(new URL("./pricing-validation-worker.ts", import.meta.url));
      try {
        while (nextTask < tasks.length) {
          const task = tasks[nextTask];
          nextTask += 1;
          if (task !== undefined) await validateTask(worker, task);
        }
      } finally {
        await worker.terminate();
      }
    }),
  ).then(() => undefined);
}

function providerTasks(data: PricingCatalog, core: PricingValidationCore): ValidationTask[] {
  const modelProviders = new Map(core.models.map(({ uid, provider_id }) => [uid, provider_id]));
  return data.provider_snapshots.map((snapshot) => ({
    providerId: snapshot.provider_id,
    data: {
      provider_vocabularies: data.provider_vocabularies.filter(
        (vocabulary) => vocabulary.provider_id === snapshot.provider_id,
      ),
      provider_snapshots: [snapshot],
      model_dispositions: data.model_dispositions.filter(
        ({ model_ref }) => modelProviders.get(model_ref) === snapshot.provider_id,
      ),
      books: data.books.filter((book) => book.provider_id === snapshot.provider_id),
    },
    core: {
      providers: core.providers.filter(({ id }) => id === snapshot.provider_id),
      models: core.models.filter((model) => model.provider_id === snapshot.provider_id),
      sources: core.sources.filter((source) => source.provider_id === snapshot.provider_id),
    },
  }));
}

function validateTask(worker: Worker, task: ValidationTask): Promise<void> {
  return new Promise((resolve, reject) => {
    const onMessage = (message: unknown) => {
      cleanup();
      if (!isValidationResult(message) || message.providerId !== task.providerId) {
        reject(new Error("Pricing validation worker returned an invalid result"));
        return;
      }
      if (message.error === undefined) resolve();
      else reject(new Error(message.error));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      worker.off("message", onMessage);
      worker.off("error", onError);
    };
    worker.once("message", onMessage);
    worker.once("error", onError);
    worker.postMessage(task);
  });
}

function isValidationResult(value: unknown): value is ValidationResult {
  return (
    value !== null &&
    typeof value === "object" &&
    "providerId" in value &&
    typeof value.providerId === "string" &&
    (!("error" in value) || value.error === undefined || typeof value.error === "string")
  );
}
