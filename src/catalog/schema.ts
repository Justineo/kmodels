import { z } from "zod";
import {
  deliveryModes,
  modalities,
  modelLifecycles,
  modelLimitFields,
  modelReleaseStages,
  modelScopes,
  modelTasks,
} from "./catalog-vocabulary.ts";
import { sourcePricingEvidenceSchema } from "./source-pricing-policy.ts";

const dateTime = z.iso.datetime({ offset: true });
const modelDate = z.union([
  z.iso.date(),
  z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/),
  z.string().regex(/^\d{4}$/),
]);

export const modelTaskSchema = z.enum(modelTasks);

export const taskEvidenceSchema = z.object({
  task: modelTaskSchema,
  source_ref: z.string().min(1),
  namespace: z.string().min(1),
  raw_value: z.string().min(1),
  kind: z.enum(["provider_task", "provider_type"]),
});
export const deliveryModeSchema = z.enum(deliveryModes);
export const deliveryModeEvidenceSchema = z.object({
  mode: deliveryModeSchema,
  source_ref: z.string().min(1),
  namespace: z.string().min(1),
  raw_value: z.string().min(1),
  kind: z.enum(["capability", "endpoint", "provider_type"]),
});
export const modalitySchema = z.enum(modalities);
export const triStateSchema = z.union([z.boolean(), z.literal("unknown")]);
export const modelLifecycleSchema = z.enum(modelLifecycles);
export const modelReleaseStageSchema = z.enum(modelReleaseStages);
export const sourceKindSchema = z.enum(["api", "website", "repository"]);
export const sourceAccessSchema = z.enum(["public", "authenticated", "configured"]);
export const sourceFormatSchema = z.enum(["json", "html", "markdown", "mixed"]);
export const modelRouteSchema = z.object({
  source_ref: z.string().min(1),
  provider: z.string().min(1),
  provider_model_id: z.string().min(1),
  task: z.string().min(1),
  status: z.literal("live"),
});

const modelLimitsShape = {
  context_tokens: z.number().int().nonnegative().optional(),
  max_input_tokens: z.number().int().nonnegative().optional(),
  max_output_tokens: z.number().int().nonnegative().optional(),
  embedding_dimensions: z.array(z.number().int().positive()).optional(),
  embedding_dimension_range: z
    .object({ min: z.number().int().positive(), max: z.number().int().positive() })
    .optional(),
  recommended_embedding_dimensions: z.array(z.number().int().positive()).optional(),
} satisfies Record<(typeof modelLimitFields)[number], z.ZodType>;

export const providerModelSchema = z.object({
  provider_id: z.string().min(1),
  model_id: z.string().min(1),
  version: z.string().min(1).optional(),
  uid: z.string().min(3),
  id_kind: z.enum(["api_id", "alias", "sku", "display_name", "source_generated"]),
  name: z.string().min(1),
  description: z.string().optional(),
  aliases: z.array(z.string().min(1)),
  tasks: z.array(modelTaskSchema).transform((tasks) => [...new Set(tasks)]),
  task_evidence: z.array(taskEvidenceSchema).optional(),
  delivery_modes: z
    .array(deliveryModeSchema)
    .transform((modes) => [...new Set(modes)])
    .optional(),
  delivery_mode_evidence: z.array(deliveryModeEvidenceSchema).optional(),
  raw_type: z.string().optional(),
  service_families: z.array(z.string().min(1)).min(1).optional(),
  api_endpoints: z
    .array(
      z.object({
        name: z.string().min(1),
        path: z.string().min(1),
      }),
    )
    .optional(),
  routes: z.array(modelRouteSchema).optional(),
  modalities: z.object({ input: z.array(modalitySchema), output: z.array(modalitySchema) }),
  capabilities: z.object({
    reasoning: triStateSchema,
    tool_call: triStateSchema,
    structured_output: triStateSchema,
    streaming: triStateSchema,
    batch: triStateSchema,
    prompt_cache: triStateSchema,
    fine_tuning: triStateSchema,
    citations: triStateSchema.default("unknown"),
    code_execution: triStateSchema.default("unknown"),
    context_management: triStateSchema.default("unknown"),
    effort_control: triStateSchema.default("unknown"),
    computer_use: triStateSchema.default("unknown"),
  }),
  limits: z.object(modelLimitsShape),
  release_date: modelDate.optional(),
  updated_date: modelDate.optional(),
  deprecated_at: z.string().optional(),
  retired_at: z.string().optional(),
  status: modelLifecycleSchema,
  release_stage: modelReleaseStageSchema,
  replacement_model_ids: z.array(z.string().min(1)).default([]),
  availability: z
    .array(
      z.object({
        region: z.string().min(1),
        deployment_type: z.string().min(1),
      }),
    )
    .optional(),
  scope: z.enum(modelScopes),
  account_availability: z.literal("unknown"),
  first_seen_at: dateTime,
  last_seen_at: dateTime,
  observed_at: dateTime,
  source_refs: z.array(z.string().min(1)).min(1),
});

export const providerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["hosted", "gateway", "cloud_platform", "model_publisher", "local_runtime"]),
  homepage: z.url(),
  docs_url: z.url().optional(),
  catalog_scope: z.enum(["global", "regional", "runtime", "mixed"]),
  regions: z.array(z.string()).optional(),
  source_ids: z.array(z.string()),
  last_successful_sync_at: dateTime.optional(),
  catalog_version: z.string().optional(),
});

export const sourceRecordSchema = z.strictObject({
  id: z.string().min(1),
  provider_id: z.string().min(1),
  url: z.url(),
  source: z
    .array(sourceKindSchema)
    .min(1)
    .transform((values) => [...new Set(values)]),
  stability: z.enum(["documented", "semi_structured", "undocumented"]),
  scope: z.enum(["global", "account", "region", "workspace", "runtime"]).default("global"),
  exhaustive: z.boolean().default(false),
  role: z.enum(["catalog", "supplement", "overlay", "inventory"]).default("catalog"),
  field_paths: z.array(z.string()),
  pricing_evidence: sourcePricingEvidenceSchema.optional(),
  observed_at: dateTime,
  etag: z.string().optional(),
  last_modified: z.string().optional(),
  content_hash: z.string().length(64),
  extractor_version: z.string().min(1),
});

export const catalogWarningSchema = z.union([
  z.string().transform((message) => ({ code: "legacy_notice", message })),
  z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    provider_id: z.string().min(1).optional(),
    source_id: z.string().min(1).optional(),
    field: z.string().min(1).optional(),
  }),
]);

export const coverageSchema = z.object({
  provider_id: z.string().min(1),
  status: z.enum(["fresh", "stale", "unavailable", "not_configured"]),
  model_count: z.number().int().nonnegative(),
  pricing_term_count: z.number().int().nonnegative(),
  checked_at: dateTime,
  last_successful_sync_at: dateTime.optional(),
  reason: z.string().optional(),
});

export const catalogSchema = z.object({
  catalog_version: z.string().length(64),
  generated_at: dateTime,
  providers: z.array(providerSchema),
  models: z.array(providerModelSchema),
  sources: z.array(sourceRecordSchema),
  coverage: z.array(coverageSchema),
  warnings: z.array(catalogWarningSchema),
});

export const catalogEnvelopeSchema = z.object({
  catalog_version: z.string().length(64),
  generated_at: dateTime,
  data: z.object({
    providers: z.array(providerSchema),
    models: z.array(providerModelSchema),
    sources: z.array(sourceRecordSchema),
    coverage: z.array(coverageSchema),
  }),
  warnings: z.array(catalogWarningSchema),
});

export type Catalog = z.infer<typeof catalogSchema>;
export type CatalogEnvelope = z.infer<typeof catalogEnvelopeSchema>;
export type CatalogWarning = z.infer<typeof catalogWarningSchema>;
export type Coverage = z.infer<typeof coverageSchema>;
export type ModelRoute = z.infer<typeof modelRouteSchema>;
export type ModelLifecycle = z.infer<typeof modelLifecycleSchema>;
export type ModelTask = z.infer<typeof modelTaskSchema>;
export type TaskEvidence = z.infer<typeof taskEvidenceSchema>;
export type DeliveryMode = z.infer<typeof deliveryModeSchema>;
export type DeliveryModeEvidence = z.infer<typeof deliveryModeEvidenceSchema>;
export type ModelReleaseStage = z.infer<typeof modelReleaseStageSchema>;
export type Modality = z.infer<typeof modalitySchema>;
export type Provider = z.infer<typeof providerSchema>;
export type ProviderModel = z.infer<typeof providerModelSchema>;
export type SourceRecord = z.infer<typeof sourceRecordSchema>;
export type SourceAccess = z.infer<typeof sourceAccessSchema>;
export type SourceFormat = z.infer<typeof sourceFormatSchema>;
export type SourceKind = z.infer<typeof sourceKindSchema>;

export function migrateCatalogEnvelope(value: unknown): unknown {
  if (
    value === null ||
    typeof value !== "object" ||
    !("data" in value) ||
    value.data === null ||
    typeof value.data !== "object"
  )
    return value;
  return {
    ...value,
    data: migrateCatalogStorage(value.data),
  };
}

export function migrateCatalogStorage(value: unknown): unknown {
  if (
    value === null ||
    typeof value !== "object" ||
    !("sources" in value) ||
    !Array.isArray(value.sources)
  )
    return value;
  return {
    ...value,
    ...("models" in value && Array.isArray(value.models)
      ? {
          models: value.models.map((model) => {
            if (model === null || typeof model !== "object" || Array.isArray(model)) return model;
            if ("tasks" in model || !("operations" in model)) return model;
            return Object.fromEntries(
              Object.entries({ ...model, tasks: model.operations }).filter(
                ([field]) => field !== "operations",
              ),
            );
          }),
        }
      : {}),
    sources: value.sources.map((source) => {
      if (source === null || typeof source !== "object" || Array.isArray(source)) return source;
      const entries = Object.entries(source)
        .filter(([field]) => field !== "snapshot_uri")
        .map(([field, item]) => [
          field,
          field === "field_paths" && Array.isArray(item)
            ? item.map((path) => (path === "operations" ? "tasks" : path))
            : item,
        ]);
      return Object.fromEntries(entries);
    }),
  };
}

export function unknownCapabilities(): ProviderModel["capabilities"] {
  return {
    reasoning: "unknown",
    tool_call: "unknown",
    structured_output: "unknown",
    streaming: "unknown",
    batch: "unknown",
    prompt_cache: "unknown",
    fine_tuning: "unknown",
    citations: "unknown",
    code_execution: "unknown",
    context_management: "unknown",
    effort_control: "unknown",
    computer_use: "unknown",
  };
}
