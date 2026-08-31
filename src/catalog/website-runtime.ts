import { modelLifecycles, modelReleaseStages, modelTasks } from "./catalog-vocabulary.ts";
import type {
  WebsiteCatalog,
  WebsiteCatalogIndexModel,
  WebsitePricingSummary,
} from "./website-schema.ts";

const hashPattern = /^[0-9a-f]{64}$/;
const modelDatePattern =
  /^(?:\d{4}|\d{4}-(?:0[1-9]|1[0-2])|\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))$/;
const catalogKeys = new Set([
  "schema_version",
  "data_version",
  "generated_at",
  "providers",
  "models",
]);
const providerKeys = new Set(["id", "name", "pricing_coverage"]);
const providerPricingCoverageKeys = new Set([
  "representative_models",
  "offer_models",
  "unknown_models",
  "not_applicable_models",
  "standalone_resources",
  "detail_chunks",
]);
const pricingKeys = new Set(["schema_version", "data_version", "statuses", "cells", "pricing"]);

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

function tuple(value: unknown, length: number, label: string): unknown[] {
  if (!Array.isArray(value) || value.length !== length)
    throw new Error(`${label} must be a ${length}-item array`);
  return value;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`${label} must be a non-empty string`);
  return value;
}

function nullableNonEmptyString(value: unknown, label: string): string | undefined {
  return value === null ? undefined : nonEmptyString(value, label);
}

function modelDate(value: unknown, label: string): string | undefined {
  const date = nullableNonEmptyString(value, label);
  if (date !== undefined && !modelDatePattern.test(date))
    throw new Error(`${label} must be a model date`);
  return date;
}

function nonnegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0)
    throw new Error(`${label} must be a non-negative integer`);
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  const integer = nonnegativeInteger(value, label);
  if (integer === 0) throw new Error(`${label} must be a positive integer`);
  return integer;
}

function nullableNonnegativeInteger(value: unknown, label: string): number | undefined {
  return value === null ? undefined : nonnegativeInteger(value, label);
}

function enumValue<Value>(values: readonly Value[], value: unknown, label: string): Value {
  const index = nonnegativeInteger(value, label);
  const item = values[index];
  if (item === undefined) throw new Error(`${label} is invalid`);
  return item;
}

function dictionaryValue<Value>(
  value: unknown,
  values: readonly Value[],
  label: string,
): Value | undefined {
  if (value === null) return undefined;
  const index = nonnegativeInteger(value, label);
  const item = values[index];
  if (item === undefined) throw new Error(`${label} does not exist`);
  return item;
}

function providerPricingCoverage(value: unknown, label: string) {
  const coverage = record(value, label);
  exactKeys(coverage, providerPricingCoverageKeys, label);
  return {
    representative_models: nonnegativeInteger(
      coverage.representative_models,
      `${label}.representative_models`,
    ),
    offer_models: nonnegativeInteger(coverage.offer_models, `${label}.offer_models`),
    unknown_models: nonnegativeInteger(coverage.unknown_models, `${label}.unknown_models`),
    not_applicable_models: nonnegativeInteger(
      coverage.not_applicable_models,
      `${label}.not_applicable_models`,
    ),
    standalone_resources: nonnegativeInteger(
      coverage.standalone_resources,
      `${label}.standalone_resources`,
    ),
    detail_chunks: nonnegativeInteger(coverage.detail_chunks, `${label}.detail_chunks`),
  };
}

function parseModel(
  value: unknown,
  index: number,
  providerIds: readonly string[],
  taskLists: Map<string, WebsiteCatalogIndexModel["tasks"]>,
): WebsiteCatalogIndexModel {
  const label = `models[${index}]`;
  const item = tuple(value, 11, label);
  const providerIndex = nonnegativeInteger(item[0], `${label}[0]`);
  const providerId = providerIds[providerIndex];
  if (providerId === undefined) throw new Error(`${label} references an unknown provider`);
  const tasks = item[4];
  if (!Array.isArray(tasks)) throw new Error(`${label}[4] must be an array`);
  const parsedTasks = tasks.map((task, taskIndex) =>
    enumValue(modelTasks, task, `${label}[4][${taskIndex}]`),
  );
  const taskKey = parsedTasks.join("\0");
  const sharedTasks = taskLists.get(taskKey) ?? parsedTasks;
  taskLists.set(taskKey, sharedTasks);
  const version = nullableNonEmptyString(item[2], `${label}[2]`);
  const releaseDate = modelDate(item[5], `${label}[5]`);
  const contextTokens = nullableNonnegativeInteger(item[8], `${label}[8]`);
  const detailChunk = item[9] === null ? 0 : positiveInteger(item[9], `${label}[9]`);
  const modelId = nonEmptyString(item[1], `${label}[1]`);
  const name = nullableNonEmptyString(item[3], `${label}[3]`) ?? modelId;
  if (!Array.isArray(item[10])) throw new Error(`${label}[10] must be an array`);
  const aliases = item[10].map((alias, aliasIndex) =>
    nonEmptyString(alias, `${label}[10][${aliasIndex}]`),
  );

  return {
    provider_id: providerId,
    model_id: modelId,
    ...(version === undefined ? {} : { version }),
    name,
    aliases,
    tasks: sharedTasks,
    ...(releaseDate === undefined ? {} : { release_date: releaseDate }),
    status: enumValue(modelLifecycles, item[6], `${label}[6]`),
    release_stage: enumValue(modelReleaseStages, item[7], `${label}[7]`),
    ...(contextTokens === undefined ? {} : { context_tokens: contextTokens }),
    detail_chunk: detailChunk,
  };
}

function parseWebsitePricing(value: unknown): {
  dataVersion: string;
  summaries: WebsitePricingSummary[];
} {
  const pricing = record(value, "pricing");
  exactKeys(pricing, pricingKeys, "pricing");
  if (pricing.schema_version !== 3) throw new Error("Unsupported website pricing schema");
  const dataVersion = nonEmptyString(pricing.data_version, "pricing.data_version");
  if (!hashPattern.test(dataVersion)) throw new Error("pricing.data_version must be a hash");
  if (!Array.isArray(pricing.statuses)) throw new Error("pricing.statuses must be an array");
  if (!Array.isArray(pricing.cells)) throw new Error("pricing.cells must be an array");
  if (!Array.isArray(pricing.pricing)) throw new Error("pricing.pricing must be an array");

  const statuses = pricing.statuses.map((value, index) => {
    const item = tuple(value, 2, `pricing.statuses[${index}]`);
    return {
      label: nonEmptyString(item[0], `pricing.statuses[${index}][0]`),
      description: nonEmptyString(item[1], `pricing.statuses[${index}][1]`),
    };
  });
  const cells = pricing.cells.map((value, index) => {
    const label = `pricing.cells[${index}]`;
    const item = tuple(value, 3, label);
    return {
      amount: nonEmptyString(item[0], `${label}[0]`),
      displayUnit: nonEmptyString(item[1], `${label}[1]`),
      accessibleText: nonEmptyString(item[2], `${label}[2]`),
    };
  });
  const summaries = pricing.pricing.map((value, index): WebsitePricingSummary => {
    const label = `pricing.pricing[${index}]`;
    const item = tuple(value, 5, label);
    const outcome = enumValue(
      ["not_applicable", "unknown", "offers"] as const,
      item[0],
      `${label}[0]`,
    );
    const status = dictionaryValue(item[1], statuses, `${label}[1]`);
    const input = dictionaryValue(item[2], cells, `${label}[2]`);
    const cache = dictionaryValue(item[3], cells, `${label}[3]`);
    const output = dictionaryValue(item[4], cells, `${label}[4]`);
    return {
      outcome,
      ...(status === undefined ? {} : { status }),
      ...(input === undefined ? {} : { input }),
      ...(cache === undefined ? {} : { cache }),
      ...(output === undefined ? {} : { output }),
    };
  });
  return { dataVersion, summaries };
}

export function parseWebsiteCatalog(catalogValue: unknown, pricingValue: unknown): WebsiteCatalog {
  const catalog = record(catalogValue, "catalog");
  exactKeys(catalog, catalogKeys, "catalog");
  if (catalog.schema_version !== 4) throw new Error("Unsupported website catalog schema");
  const dataVersion = nonEmptyString(catalog.data_version, "catalog.data_version");
  if (!hashPattern.test(dataVersion)) throw new Error("catalog.data_version must be a hash");
  if (!Array.isArray(catalog.providers)) throw new Error("catalog.providers must be an array");
  if (!Array.isArray(catalog.models)) throw new Error("catalog.models must be an array");
  const pricing = parseWebsitePricing(pricingValue);
  if (pricing.dataVersion !== dataVersion)
    throw new Error("Pricing summary does not match the catalog");
  if (pricing.summaries.length !== catalog.models.length)
    throw new Error("Pricing summary row count does not match the catalog");

  const providers = catalog.providers.map((value, index) => {
    const label = `providers[${index}]`;
    const provider = record(value, label);
    exactKeys(provider, providerKeys, label);
    return {
      id: nonEmptyString(provider.id, `${label}.id`),
      name: nonEmptyString(provider.name, `${label}.name`),
      pricing_coverage: providerPricingCoverage(
        provider.pricing_coverage,
        `${label}.pricing_coverage`,
      ),
    };
  });
  const providerIds = providers.map(({ id }) => id);
  if (new Set(providerIds).size !== providerIds.length)
    throw new Error("Catalog contains duplicate provider IDs");
  const taskLists = new Map<string, WebsiteCatalogIndexModel["tasks"]>();
  const models = catalog.models.map((value, index) => {
    const model = parseModel(value, index, providerIds, taskLists);
    const summary = pricing.summaries[index];
    if (summary === undefined) throw new Error(`Missing pricing summary row ${index}`);
    return {
      ...model,
      uid: `${model.provider_id}/${model.model_id}${
        model.version === undefined ? "" : `@${model.version}`
      }`,
      pricing: summary,
    };
  });

  return {
    data_version: dataVersion,
    generated_at: nonEmptyString(catalog.generated_at, "catalog.generated_at"),
    providers,
    models,
  };
}
