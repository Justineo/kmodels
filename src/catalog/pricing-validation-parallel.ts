import type { PricingCatalog } from "./pricing-schema.ts";
import {
  validatePricingCatalogTopology,
  type PricingValidationCore,
} from "./pricing-validation.ts";
import { runWorkerPool } from "./worker-pool.ts";

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
  return runWorkerPool(
    tasks,
    new URL("./pricing-validation-worker.ts", import.meta.url),
    validationResult,
  ).then(() => undefined);
}

function providerTasks(data: PricingCatalog, core: PricingValidationCore): ValidationTask[] {
  const modelProviders = new Map(core.models.map(({ uid, provider_id }) => [uid, provider_id]));
  const vocabularies = groupBy(data.provider_vocabularies, ({ provider_id }) => provider_id);
  const dispositions = groupBy(data.model_dispositions, ({ model_ref }) =>
    modelProviders.get(model_ref),
  );
  const books = groupBy(data.books, ({ provider_id }) => provider_id);
  const providers = groupBy(core.providers, ({ id }) => id);
  const models = groupBy(core.models, ({ provider_id }) => provider_id);
  const sources = groupBy(core.sources, ({ provider_id }) => provider_id);
  return data.provider_snapshots
    .map((snapshot) => ({
      providerId: snapshot.provider_id,
      data: {
        provider_vocabularies: vocabularies.get(snapshot.provider_id) ?? [],
        provider_snapshots: [snapshot],
        model_dispositions: dispositions.get(snapshot.provider_id) ?? [],
        books: books.get(snapshot.provider_id) ?? [],
      },
      core: {
        providers: providers.get(snapshot.provider_id) ?? [],
        models: models.get(snapshot.provider_id) ?? [],
        sources: sources.get(snapshot.provider_id) ?? [],
      },
    }))
    .map((task) => ({ task, weight: validationWeight(task) }))
    .sort((left, right) => right.weight - left.weight)
    .map(({ task }) => task);
}

function validationWeight(task: ValidationTask): number {
  let weight =
    task.core.models.length +
    task.core.sources.length +
    task.data.model_dispositions.length +
    task.data.provider_vocabularies.reduce((sum, { atoms }) => sum + atoms.length, 0);
  for (const book of task.data.books) {
    weight +=
      1 +
      book.scope.model_refs.length +
      book.scope_observations.length +
      book.resource_edges.length;
    for (const offer of book.offers) {
      weight +=
        1 +
        (offer.model_refs?.length ?? 0) +
        offer.states.length +
        offer.enrollment.length +
        offer.settlement.length +
        offer.relations.length;
      for (const term of offer.terms)
        weight +=
          1 + term.variants.length + ("raw_variants" in term ? term.raw_variants.length : 0);
    }
  }
  return weight;
}

function groupBy<Key, Value>(
  values: readonly Value[],
  key: (value: Value) => Key | undefined,
): Map<Key, Value[]> {
  const groups = new Map<Key, Value[]>();
  for (const value of values) {
    const valueKey = key(value);
    if (valueKey === undefined) continue;
    const group = groups.get(valueKey);
    if (group === undefined) groups.set(valueKey, [value]);
    else group.push(value);
  }
  return groups;
}

function validationResult(message: unknown, task: ValidationTask): void {
  if (!isValidationResult(message) || message.providerId !== task.providerId)
    throw new Error("Pricing validation worker returned an invalid result");
  if (message.error !== undefined) throw new Error(`${task.providerId}: ${message.error}`);
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
