import { modelLifecycles, modelReleaseStages, modelTasks } from "./catalog-vocabulary.ts";
import type { ModelLifecycle, ModelReleaseStage, ModelTask } from "./schema.ts";
import type {
  WebsiteCatalog,
  WebsiteCatalogIndexModel,
  WebsitePricingSummaries,
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
const providerKeys = new Set(["id", "name", "pricing_coverage"]);
const providerPricingCoverageKeys = new Set([
  "models",
  "representative_models",
  "offer_models",
  "unknown_models",
  "not_applicable_models",
  "standalone_resources",
  "detail_chunks",
]);
const pricingKeys = new Set(["schema_version", "data_version", "pricing"]);
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
const pricingSummaryKeys = new Set(["outcome", "status", "input", "cache", "output"]);
const pricingStatusKeys = new Set(["label", "description"]);
const pricingCellKeys = new Set([
  "meter",
  "amount",
  "displayUnit",
  "accessibleText",
  "showTooltip",
]);

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

function pricingCell(value: unknown, label: string): WebsitePricingSummary["input"] | undefined {
  if (value === undefined) return undefined;
  const item = record(value, label);
  exactKeys(item, pricingCellKeys, label);
  if (typeof item.showTooltip !== "boolean")
    throw new Error(`${label}.showTooltip must be a boolean`);
  return {
    meter: nonEmptyString(item.meter, `${label}.meter`),
    amount: nonEmptyString(item.amount, `${label}.amount`),
    displayUnit: nonEmptyString(item.displayUnit, `${label}.displayUnit`),
    accessibleText: nonEmptyString(item.accessibleText, `${label}.accessibleText`),
    showTooltip: item.showTooltip,
  };
}

function pricingOutcome(value: unknown, label: string): WebsitePricingSummary["outcome"] {
  switch (value) {
    case "not_applicable":
    case "unknown":
    case "offers":
      return value;
    default:
      throw new Error(`${label}.outcome is invalid`);
  }
}

function pricingStatus(value: unknown, label: string): WebsitePricingSummary["status"] | undefined {
  if (value === undefined) return undefined;
  const item = record(value, label);
  exactKeys(item, pricingStatusKeys, label);
  return {
    label: nonEmptyString(item.label, `${label}.label`),
    description: nonEmptyString(item.description, `${label}.description`),
  };
}

function pricingSummary(value: unknown, label: string): WebsitePricingSummary {
  const item = record(value, label);
  exactKeys(item, pricingSummaryKeys, label);
  const outcome = pricingOutcome(item.outcome, label);
  const status = pricingStatus(item.status, `${label}.status`);
  const input = pricingCell(item.input, `${label}.input`);
  const cache = pricingCell(item.cache, `${label}.cache`);
  const output = pricingCell(item.output, `${label}.output`);
  return {
    outcome,
    ...(status === undefined ? {} : { status }),
    ...(input === undefined ? {} : { input }),
    ...(cache === undefined ? {} : { cache }),
    ...(output === undefined ? {} : { output }),
  };
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

function providerPricingCoverage(value: unknown, label: string) {
  const coverage = record(value, label);
  exactKeys(coverage, providerPricingCoverageKeys, label);
  return {
    models: nonnegativeInteger(coverage.models, `${label}.models`),
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

function parseWebsitePricing(value: unknown): WebsitePricingSummaries {
  const pricing = record(value, "pricing");
  exactKeys(pricing, pricingKeys, "pricing");
  if (pricing.schema_version !== 1) throw new Error("Unsupported website pricing schema");
  const dataVersion = nonEmptyString(pricing.data_version, "pricing.data_version");
  if (!hashPattern.test(dataVersion)) throw new Error("pricing.data_version must be a hash");
  if (!Array.isArray(pricing.pricing)) throw new Error("pricing.pricing must be an array");
  return {
    schema_version: 1,
    data_version: dataVersion,
    pricing: pricing.pricing.map((value, index) =>
      pricingSummary(value, `pricing.pricing[${index}]`),
    ),
  };
}

export function parseWebsiteCatalog(catalogValue: unknown, pricingValue: unknown): WebsiteCatalog {
  const catalog = record(catalogValue, "catalog");
  exactKeys(catalog, catalogKeys, "catalog");
  if (catalog.schema_version !== 2) throw new Error("Unsupported website catalog schema");
  const dataVersion = nonEmptyString(catalog.data_version, "catalog.data_version");
  if (!hashPattern.test(dataVersion)) throw new Error("catalog.data_version must be a hash");
  if (!Array.isArray(catalog.providers)) throw new Error("catalog.providers must be an array");
  if (!Array.isArray(catalog.models)) throw new Error("catalog.models must be an array");
  const pricing = parseWebsitePricing(pricingValue);
  if (pricing.data_version !== dataVersion)
    throw new Error("Pricing summary does not match the catalog");
  if (pricing.pricing.length !== catalog.models.length)
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
  const providerIds = new Set(providers.map(({ id }) => id));
  const models = catalog.models.map((value, index) => {
    const model = parseModel(value, index);
    const summary = pricing.pricing[index];
    if (summary === undefined) throw new Error(`Missing pricing summary row ${index}`);
    if (!providerIds.has(model.provider_id))
      throw new Error(`models[${index}] references an unknown provider`);
    return {
      ...model,
      uid: `${model.provider_id}/${model.model_id}${
        model.version === undefined ? "" : `@${model.version}`
      }`,
      pricing: summary,
    };
  });

  return {
    schema_version: 2,
    data_version: dataVersion,
    generated_at: nonEmptyString(catalog.generated_at, "catalog.generated_at"),
    providers,
    models,
  };
}
