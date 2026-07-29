import { modelLifecycles, modelReleaseStages, modelTasks } from "./catalog-vocabulary.ts";
import type { ModelLifecycle, ModelReleaseStage, ModelTask } from "./schema.ts";
import type {
  WebsiteCatalog,
  WebsiteCatalogIndexModel,
  WebsitePricingSummary,
} from "./website-schema.ts";

const hashPattern = /^[0-9a-f]{64}$/;
const modelDatePattern =
  /^(?:\d{4}|\d{4}-(?:0[1-9]|1[0-2])|\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))$/;
const modelTaskSet = new Set<string>(modelTasks);
const modelLifecycleSet = new Set<string>(modelLifecycles);
const modelReleaseStageSet = new Set<string>(modelReleaseStages);
const catalogKeys = new Set([
  "schema_version",
  "data_version",
  "generated_at",
  "providers",
  "models",
]);
const providerKeys = new Set(["id", "name"]);
const modelKeys = new Set([
  "provider_id",
  "model_id",
  "version",
  "name",
  "tasks",
  "release_date",
  "status",
  "release_stage",
  "context_tokens",
  "detail_chunk",
]);

const loadingPricing: WebsitePricingSummary = {
  outcome: "unknown",
  status: {
    label: "Loading",
    description: "Representative pricing is loading.",
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpected !== undefined) throw new Error(`${label} has unexpected field ${unexpected}`);
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`${label} must be a non-empty string`);
  return value;
}

function optionalNonEmptyString(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : nonEmptyString(value, label);
}

function modelDate(value: unknown, label: string): string | undefined {
  const date = optionalNonEmptyString(value, label);
  if (date !== undefined && !modelDatePattern.test(date))
    throw new Error(`${label} must be a model date`);
  return date;
}

function nonnegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0)
    throw new Error(`${label} must be a non-negative integer`);
  return value;
}

function optionalNonnegativeInteger(value: unknown, label: string): number | undefined {
  return value === undefined ? undefined : nonnegativeInteger(value, label);
}

function isModelTask(value: unknown): value is ModelTask {
  return typeof value === "string" && modelTaskSet.has(value);
}

function isModelLifecycle(value: unknown): value is ModelLifecycle {
  return typeof value === "string" && modelLifecycleSet.has(value);
}

function isModelReleaseStage(value: unknown): value is ModelReleaseStage {
  return typeof value === "string" && modelReleaseStageSet.has(value);
}

function parseModel(value: unknown, index: number): WebsiteCatalogIndexModel {
  const label = `models[${index}]`;
  const item = record(value, label);
  exactKeys(item, modelKeys, label);
  const providerId = nonEmptyString(item.provider_id, `${label}.provider_id`);
  const modelId = nonEmptyString(item.model_id, `${label}.model_id`);
  const version = optionalNonEmptyString(item.version, `${label}.version`);
  const tasks = item.tasks;
  if (!Array.isArray(tasks) || !tasks.every(isModelTask))
    throw new Error(`${label}.tasks contains an invalid task`);
  const status = item.status;
  if (!isModelLifecycle(status)) throw new Error(`${label}.status is invalid`);
  const releaseStage = item.release_stage;
  if (!isModelReleaseStage(releaseStage)) throw new Error(`${label}.release_stage is invalid`);
  const releaseDate = modelDate(item.release_date, `${label}.release_date`);
  const contextTokens = optionalNonnegativeInteger(item.context_tokens, `${label}.context_tokens`);

  return {
    provider_id: providerId,
    model_id: modelId,
    ...(version === undefined ? {} : { version }),
    name: nonEmptyString(item.name, `${label}.name`),
    tasks,
    ...(releaseDate === undefined ? {} : { release_date: releaseDate }),
    status,
    release_stage: releaseStage,
    ...(contextTokens === undefined ? {} : { context_tokens: contextTokens }),
    detail_chunk: nonnegativeInteger(item.detail_chunk, `${label}.detail_chunk`),
  };
}

export function parseWebsiteCatalog(value: unknown): WebsiteCatalog {
  const catalog = record(value, "catalog");
  exactKeys(catalog, catalogKeys, "catalog");
  if (catalog.schema_version !== 1) throw new Error("Unsupported website catalog schema");
  const dataVersion = nonEmptyString(catalog.data_version, "catalog.data_version");
  if (!hashPattern.test(dataVersion)) throw new Error("catalog.data_version must be a hash");
  if (!Array.isArray(catalog.providers)) throw new Error("catalog.providers must be an array");
  if (!Array.isArray(catalog.models)) throw new Error("catalog.models must be an array");

  const providers = catalog.providers.map((value, index) => {
    const label = `providers[${index}]`;
    const provider = record(value, label);
    exactKeys(provider, providerKeys, label);
    return {
      id: nonEmptyString(provider.id, `${label}.id`),
      name: nonEmptyString(provider.name, `${label}.name`),
    };
  });
  const providerIds = new Set(providers.map(({ id }) => id));
  const models = catalog.models.map((value, index) => {
    const model = parseModel(value, index);
    if (!providerIds.has(model.provider_id))
      throw new Error(`models[${index}] references an unknown provider`);
    return {
      ...model,
      uid: `${model.provider_id}/${model.model_id}${
        model.version === undefined ? "" : `@${model.version}`
      }`,
      pricing: loadingPricing,
    };
  });

  return {
    schema_version: 1,
    data_version: dataVersion,
    generated_at: nonEmptyString(catalog.generated_at, "catalog.generated_at"),
    providers,
    models,
  };
}
