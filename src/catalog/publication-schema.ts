import { z } from "zod";
import { coverageSchema, providerModelSchema, providerSchema } from "./schema.ts";

const hash = z.string().regex(/^[0-9a-f]{64}$/);
const dateTime = z.iso.datetime({ offset: true });

export const catalogIdsSchema = z.strictObject({
  schema_version: z.literal(1),
  profile: z.literal("ids"),
  catalog_version: hash,
  generated_at: dateTime,
  providers: z.record(z.string().min(1), z.array(z.string().min(1))),
});

const catalogSummaryModelSchema = providerModelSchema
  .pick({
    model_id: true,
    version: true,
    tasks: true,
    status: true,
  })
  .extend({
    provider: z.string().min(1),
  })
  .strict();

export const catalogSummarySchema = z.strictObject({
  schema_version: z.literal(1),
  profile: z.literal("summary"),
  catalog_version: hash,
  generated_at: dateTime,
  models: z.array(catalogSummaryModelSchema),
});

export const publishedModelVariantSchema = providerModelSchema
  .omit({
    provider_id: true,
    model_id: true,
    task_evidence: true,
    delivery_mode_evidence: true,
    raw_type: true,
    routes: true,
    account_availability: true,
    first_seen_at: true,
    last_seen_at: true,
    observed_at: true,
    source_refs: true,
  })
  .strict();

export const publishedModelGroupSchema = z.strictObject({
  model_id: z.string().min(1),
  variants: z.array(publishedModelVariantSchema).min(1),
});

const publishedCoverageSchema = coverageSchema.omit({ provider_id: true }).strict();

export const publishedProviderMetadataSchema = providerSchema
  .omit({
    id: true,
    source_ids: true,
    last_successful_sync_at: true,
  })
  .extend({
    coverage: publishedCoverageSchema,
  })
  .strict();

const publishedProviderSchema = publishedProviderMetadataSchema
  .extend({
    models: z.array(publishedModelGroupSchema),
  })
  .strict();

export const catalogModelsSchema = z.strictObject({
  schema_version: z.literal(1),
  profile: z.literal("models"),
  catalog_version: hash,
  generated_at: dateTime,
  providers: z.record(z.string().min(1), publishedProviderSchema),
});

export const catalogProvidersSchema = z.strictObject({
  schema_version: z.literal(1),
  profile: z.literal("providers"),
  catalog_version: hash,
  generated_at: dateTime,
  providers: z.record(z.string().min(1), publishedProviderMetadataSchema),
});

export type CatalogIds = z.infer<typeof catalogIdsSchema>;
export type CatalogSummary = z.infer<typeof catalogSummarySchema>;
export type CatalogModels = z.infer<typeof catalogModelsSchema>;
export type PublishedModelVariant = z.infer<typeof publishedModelVariantSchema>;
