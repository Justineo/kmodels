import type { PricingCatalog } from "./pricing-schema.ts";
import {
  validatePricingCatalogTopology,
  validatePricingCatalogProvidersFromTopology,
  type PricingValidationCore,
} from "./pricing-validation.ts";
import { runWorkerPool } from "./worker-pool.ts";
import { selectorWeight, withPricingCanonicalCache } from "./pricing-canonical.ts";

interface ValidationTask {
  providerId: string;
  data: PricingCatalog;
  core: PricingValidationCore;
}

interface ValidationResult {
  providerId: string;
  error?: string;
}

// Overlap the most complex partition with in-process validation of the remaining
// owned graph. Only one partition is cloned, and its worker ends before return.
export async function validatePricingCatalogForRead(
  data: PricingCatalog,
  core: PricingValidationCore,
): Promise<void> {
  validatePricingCatalogTopology(data, core);
  const tasks = providerTasks(data, core);
  let remoteIndex = 0;
  let remoteWeight = -1;
  for (const [index, task] of tasks.entries()) {
    const weight = readValidationWeight(task);
    if (weight > remoteWeight) {
      remoteIndex = index;
      remoteWeight = weight;
    }
  }
  const largest = tasks[remoteIndex];
  if (largest === undefined) return;
  // A single provider has no independent work to overlap with transport.
  const remote =
    tasks.length === 1
      ? undefined
      : runWorkerPool(
          [largest],
          new URL("./pricing-validation-worker.ts", import.meta.url),
          validationResult,
          1,
        );
  let localFailure: { index: number; error: Error } | undefined;
  for (const [index, task] of tasks.entries()) {
    if (remote !== undefined && index === remoteIndex) continue;
    try {
      withPricingCanonicalCache(() =>
        validatePricingCatalogProvidersFromTopology(task.data, task.core),
      );
    } catch (error) {
      localFailure = {
        index,
        error: new Error(
          `${task.providerId}: ${error instanceof Error ? error.message : String(error)}`,
        ),
      };
      break;
    }
  }
  // Execution order can change without changing the original task/error order.
  // Always await teardown, including when an in-process provider fails first.
  let remoteFailure: { error: unknown } | undefined;
  try {
    await remote;
  } catch (error) {
    remoteFailure = { error };
  }
  if (localFailure !== undefined && localFailure.index < remoteIndex) throw localFailure.error;
  if (remoteFailure !== undefined) throw remoteFailure.error;
  if (localFailure !== undefined) throw localFailure.error;
}

function readValidationWeight(task: ValidationTask): number {
  let weight = validationWeight(task);
  for (const book of task.data.books)
    for (const offer of book.offers)
      for (const term of offer.terms) {
        for (const variant of term.variants) {
          if ("applicability" in variant) weight += selectorWeight(variant.applicability);
          else if ("possible_scope" in variant && variant.possible_scope !== undefined)
            weight += selectorWeight(variant.possible_scope);
        }
        if ("raw_variants" in term)
          for (const variant of term.raw_variants)
            if (variant.possible_scope !== undefined)
              weight += selectorWeight(variant.possible_scope);
      }
  return weight;
}

export function validatePricingCatalogInParallel(
  data: PricingCatalog,
  core: PricingValidationCore,
  workerCount: 2 | 3 = 3,
): Promise<void> {
  validatePricingCatalogTopology(data, core);
  const tasks = providerTasks(data, core);
  // Bound simultaneous provider graph copies. Every partition is still validated;
  // compilation keeps the worker pool's separate default concurrency.
  return runWorkerPool(
    tasks,
    new URL("./pricing-validation-worker.ts", import.meta.url),
    validationResult,
    workerCount,
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
