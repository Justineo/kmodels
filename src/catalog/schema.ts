import { z } from "zod";

const dateTime = z.iso.datetime({ offset: true });
const decimal = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);

export const modelTypeSchema = z.enum([
  "text_generation",
  "embedding",
  "rerank",
  "moderation",
  "image_generation",
  "video_generation",
  "speech_to_text",
  "text_to_speech",
  "speech_to_speech",
  "computer_use",
  "classifier",
  "ocr",
  "other",
]);

const storedModelTypeSchema = z
  .enum([...modelTypeSchema.options, "language", "reasoning", "code", "realtime", "multimodal"])
  .transform((value): z.infer<typeof modelTypeSchema> => {
    switch (value) {
      case "language":
      case "reasoning":
      case "code":
      case "multimodal":
        return "text_generation";
      case "realtime":
        return "speech_to_speech";
      default:
        return value;
    }
  });

export const modalitySchema = z.enum(["text", "image", "audio", "video", "pdf", "embedding"]);
export const triStateSchema = z.union([z.boolean(), z.literal("unknown")]);

export const priceRateSchema = z.object({
  meter: z.enum([
    "input_text",
    "output_text",
    "cache_read_text",
    "cache_write_text",
    "cache_storage",
    "input_audio",
    "output_audio",
    "input_image",
    "output_image",
    "image_generation",
    "video_generation",
    "embedding",
    "rerank_request",
    "tool_call",
    "gpu_hour",
    "provisioned_throughput",
  ]),
  price: decimal,
  currency: z.string().min(1),
  unit: z.enum([
    "token",
    "thousand_tokens",
    "million_tokens",
    "request",
    "thousand_requests",
    "image",
    "second",
    "minute",
    "character",
    "thousand_characters",
    "page",
    "thousand_pages",
    "gpu_hour",
    "unit_hour",
  ]),
  conditions: z.object({
    region: z.string().optional(),
    deployment_scope: z.string().optional(),
    service_tier: z.string().optional(),
    route_provider: z.string().optional(),
    context_min_tokens: z.number().int().nonnegative().optional(),
    context_max_tokens: z.number().int().nonnegative().optional(),
    cache_ttl_seconds: z.number().int().nonnegative().optional(),
    modality: z.string().optional(),
    resolution: z.string().optional(),
    effective_from: z.string().optional(),
    effective_until: z.string().optional(),
    promotion: z.boolean().optional(),
  }),
  source_ref: z.string().min(1),
  derived: z.boolean(),
  derivation: z.string().optional(),
  raw_price: z.string().optional(),
  raw_unit: z.string().optional(),
});

export const providerModelSchema = z.object({
  provider_id: z.string().min(1),
  model_id: z.string().min(1),
  uid: z.string().min(3),
  id_kind: z.enum(["api_id", "alias", "sku", "display_name", "source_generated"]),
  name: z.string().min(1),
  description: z.string().optional(),
  aliases: z.array(z.string().min(1)),
  types: z
    .array(storedModelTypeSchema)
    .min(1)
    .transform((types) => [...new Set(types)]),
  raw_type: z.string().optional(),
  modalities: z.object({ input: z.array(modalitySchema), output: z.array(modalitySchema) }),
  capabilities: z.object({
    reasoning: triStateSchema,
    tool_call: triStateSchema,
    structured_output: triStateSchema,
    streaming: triStateSchema,
    batch: triStateSchema,
    prompt_cache: triStateSchema,
    fine_tuning: triStateSchema,
  }),
  limits: z.object({
    context_tokens: z.number().int().nonnegative().optional(),
    max_input_tokens: z.number().int().nonnegative().optional(),
    max_output_tokens: z.number().int().nonnegative().optional(),
    embedding_dimensions: z.array(z.number().int().positive()).optional(),
  }),
  release_date: z.string().optional(),
  deprecated_at: z.string().optional(),
  retired_at: z.string().optional(),
  status: z.enum(["active", "preview", "deprecated", "retired", "unknown"]),
  pricing_status: z.enum([
    "published",
    "derived",
    "not_published",
    "not_applicable",
    "custom_quote",
    "unknown",
  ]),
  pricing: z.array(priceRateSchema),
  scope: z.enum(["global_catalog", "regional_catalog", "runtime_observation"]),
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

export const sourceRecordSchema = z.object({
  id: z.string().min(1),
  provider_id: z.string().min(1),
  url: z.url(),
  source_type: z.enum([
    "official_public_api",
    "official_bulk_pricing",
    "official_openapi",
    "official_markdown",
    "official_html",
    "official_github",
    "runtime_api",
  ]),
  stability: z.enum(["documented", "semi_structured", "undocumented"]),
  field_paths: z.array(z.string()),
  observed_at: dateTime,
  etag: z.string().optional(),
  last_modified: z.string().optional(),
  content_hash: z.string().length(64),
  extractor_version: z.string().min(1),
  snapshot_uri: z.string().min(1),
});

export const coverageSchema = z.object({
  provider_id: z.string().min(1),
  status: z.enum(["fresh", "stale", "unavailable", "not_configured"]),
  model_count: z.number().int().nonnegative(),
  price_rate_count: z.number().int().nonnegative(),
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
  warnings: z.array(z.string()),
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
  warnings: z.array(z.string()),
});

export type Catalog = z.infer<typeof catalogSchema>;
export type Coverage = z.infer<typeof coverageSchema>;
export type ModelType = z.infer<typeof modelTypeSchema>;
export type Modality = z.infer<typeof modalitySchema>;
export type PriceRate = z.infer<typeof priceRateSchema>;
export type Provider = z.infer<typeof providerSchema>;
export type ProviderModel = z.infer<typeof providerModelSchema>;
export type SourceRecord = z.infer<typeof sourceRecordSchema>;

export function unknownCapabilities(): ProviderModel["capabilities"] {
  return {
    reasoning: "unknown",
    tool_call: "unknown",
    structured_output: "unknown",
    streaming: "unknown",
    batch: "unknown",
    prompt_cache: "unknown",
    fine_tuning: "unknown",
  };
}
