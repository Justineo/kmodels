import { z } from "zod";
import {
  priceSourceLocatorSchema,
  rawPriceFactSchema,
  rawPricingReasonSchema,
  usageInputLocatorSchema,
  usageInputReductionSchema,
  usageInputSourceSchema,
} from "./pricing-schema.ts";
import { rawPricingImpacts } from "./pricing-vocabulary.ts";
import { providerModelSchema, type ProviderModel } from "./schema.ts";

const decimal = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);

const resolutionPolicySchema = z.string().regex(/^[a-z][a-z0-9_]*$/);

export const sourcePriceMeters = [
  "input_text",
  "output_text",
  "cache_read_text",
  "cache_write_text",
  "cache_read_audio",
  "cache_write_audio",
  "cache_read_image",
  "cache_write_image",
  "cache_read_video",
  "cache_write_video",
  "cache_storage",
  "input_audio",
  "output_audio",
  "input_image",
  "output_image",
  "input_video",
  "output_video",
  "image_generation",
  "video_generation",
  "embedding",
  "rerank_request",
  "speech_generation",
  "tool_call",
  "realtime_client_message",
  "realtime_session_duration",
  "session_runtime",
  "gpu_hour",
  "provisioned_throughput",
  "batch_inference",
  "web_search",
  "image_search",
  "maps_search",
  "file_search",
  "retrieval",
  "grounded_generation",
  "storage",
  "data_transfer",
  "custom_reporting",
  "policy_enforcement",
  "zero_data_retention",
  "trace_delivery",
  "container_runtime",
  "code_execution",
  "content_safety",
  "training_input",
  "training_compute",
  "evaluation",
  "compute",
  "subscription",
] as const;

const sourcePriceConditionsInputSchema = z.object({
  region: z.string().optional(),
  endpoint: z.string().optional(),
  deployment_scope: z.string().optional(),
  service_tier: z.string().optional(),
  speed: z.string().optional(),
  inference_geo: z.string().optional(),
  route_provider: z.string().optional(),
  context_min_tokens: z.number().int().nonnegative().optional(),
  context_max_tokens: z.number().int().nonnegative().optional(),
  context_tier: z.string().optional(),
  cache_ttl_seconds: z.number().int().nonnegative().optional(),
  capacity: z.string().optional(),
  modality: z.string().optional(),
  operation: z.string().optional(),
  resolution: z.string().optional(),
  quality: z.string().optional(),
  search_effort: z.string().optional(),
  style: z.string().optional(),
  billing_period: z.string().optional(),
  billing_currency: z.string().optional(),
  account_eligibility: z.string().optional(),
  audio: z.boolean().optional(),
  voice_control: z.boolean().optional(),
  video_input: z.boolean().optional(),
  effective_from: z.string().optional(),
  effective_until: z.string().optional(),
  promotion: z.boolean().optional(),
});

const sourcePriceConditionsSchema = sourcePriceConditionsInputSchema.transform((conditions) =>
  sourcePriceConditionsInputSchema.parse(
    Object.fromEntries(Object.entries(conditions).filter(([, value]) => value !== undefined)),
  ),
);

export const sourcePriceFactSchema = z
  .object({
    meter: z.enum(sourcePriceMeters),
    price: decimal,
    currency: z.string().min(1),
    unit: z.enum([
      "token",
      "thousand_tokens",
      "million_tokens",
      "million_pixels",
      "request",
      "thousand_requests",
      "thousand_items",
      "thousand_search_units",
      "image",
      "second",
      "hour",
      "minute",
      "character",
      "thousand_characters",
      "million_characters",
      "page",
      "thousand_pages",
      "search_unit",
      "video",
      "gpu_hour",
      "unit_hour",
      "unit_week",
      "unit_month",
      "unit_year",
      "billing_month",
      "billing_year",
      "seat_month",
      "million_tokens_per_hour",
      "frame",
      "thousand_tokens_per_minute_hour",
      "event",
      "thousand_events",
      "byte_day",
      "gigabyte_day",
      "gibibyte_day",
      "gigabyte",
      "gibibyte",
      "container_session",
      "session",
      "unit",
    ]),
    conditions: sourcePriceConditionsSchema,
    source_ref: z.string().min(1),
    source_locator: priceSourceLocatorSchema.optional(),
    derived: z.boolean(),
    derivation: z.string().optional(),
    raw_price: z.string().optional(),
    raw_unit: z.string().optional(),
    raw_validity: z.string().optional(),
    resolution_policy: resolutionPolicySchema.optional(),
  })
  .superRefine(({ derived, derivation }, context) => {
    if (
      (derived && (derivation === undefined || derivation.trim().length === 0)) ||
      (!derived && derivation !== undefined)
    )
      context.addIssue({
        code: "custom",
        message: "Derivation must be present exactly when pricing is derived",
      });
  });

export const sourceRawPricingFactSchema = z.strictObject({
  term_key: z.string().min(1),
  impact: z.enum(rawPricingImpacts),
  reason: rawPricingReasonSchema,
  conditions: sourcePriceConditionsSchema,
  source_ref: z.string().min(1),
  raw: rawPriceFactSchema,
  resolution_policy: resolutionPolicySchema.optional(),
});

export const sourceCommercialPricingFactSchema = z.strictObject({
  source_ref: z.string().min(1),
  book_key: z.string().min(1),
  book_name: z.string().min(1),
  resource_kind: z.enum([
    "service",
    "plan",
    "capacity",
    "distribution",
    "account_resource_template",
  ]),
  resource_key: z.string().min(1),
  model_refs: z.array(z.string().min(1)),
  offer_key: z.string().min(1),
  offer_name: z.string().min(1),
  billing_mode: z.enum(["usage", "capacity", "subscription", "one_time", "hybrid"]),
  pricing_state: z.enum([
    "numeric",
    "free",
    "included",
    "externally_billed",
    "custom_quote",
    "not_published",
  ]),
  price_facts: z.array(sourcePriceFactSchema),
  raw_price_facts: z.array(sourceRawPricingFactSchema),
});

export const sourcePricingInputFactSchema = z.strictObject({
  key: z.string().min(1),
  channel: usageInputSourceSchema.shape.channel,
  locator: usageInputLocatorSchema,
  reduction: usageInputReductionSchema.optional(),
  absent_value: usageInputSourceSchema.shape.absent_value,
  selector_absent_value: z.string().min(1).optional(),
  availability: usageInputSourceSchema.shape.availability,
  source_ref: z.string().min(1),
});

export const parsedPricingStateSchema = z.enum([
  "numeric",
  "free",
  "not_published",
  "not_applicable",
  "custom_quote",
  "unknown",
]);
export const parsedPricingModelSchema = providerModelSchema
  .pick({
    provider_id: true,
    model_id: true,
    version: true,
    uid: true,
    api_endpoints: true,
    capabilities: true,
    service_families: true,
    status: true,
    tasks: true,
  })
  .extend({
    pricing_state: parsedPricingStateSchema,
    price_facts: z.array(sourcePriceFactSchema),
    raw_price_facts: z.array(sourceRawPricingFactSchema),
    commercial_facts: z.array(sourceCommercialPricingFactSchema).optional(),
    pricing_inputs: z.array(sourcePricingInputFactSchema).optional(),
  })
  .strict();

export type SourcePriceFact = z.infer<typeof sourcePriceFactSchema>;
export type SourceRawPricingFact = z.infer<typeof sourceRawPricingFactSchema>;
export type SourceCommercialPricingFact = z.infer<typeof sourceCommercialPricingFactSchema>;
export type SourcePricingInputFact = z.infer<typeof sourcePricingInputFactSchema>;
export type ParsedPricingState = z.infer<typeof parsedPricingStateSchema>;
export type ParsedPricingModel = z.infer<typeof parsedPricingModelSchema>;
export type ParsedProviderModel = ProviderModel & {
  pricing_state: ParsedPricingState;
  price_facts: SourcePriceFact[];
  raw_price_facts: SourceRawPricingFact[];
  commercial_facts?: SourceCommercialPricingFact[];
  pricing_inputs?: SourcePricingInputFact[];
};

export function sourcePriceFactKey(fact: SourcePriceFact): string {
  return `${fact.meter}\0${fact.currency}\0${fact.unit}\0${JSON.stringify(fact.conditions)}`;
}

export function sourceRawPricingFactKey(fact: SourceRawPricingFact): string {
  return `${fact.term_key}\0${fact.impact}\0${fact.reason}\0${fact.resolution_policy ?? ""}\0${JSON.stringify(fact.conditions)}\0${JSON.stringify(fact.raw)}`;
}

function parsedPriceFact(fact: SourcePriceFact): SourcePriceFact {
  const {
    derivation,
    raw_price,
    raw_unit,
    raw_validity,
    resolution_policy,
    source_locator,
    ...required
  } = fact;
  return sourcePriceFactSchema.parse({
    ...required,
    ...(resolution_policy === undefined ? {} : { resolution_policy }),
    ...(source_locator === undefined ? {} : { source_locator }),
    ...(derivation === undefined ? {} : { derivation }),
    ...(raw_price === undefined ? {} : { raw_price }),
    ...(raw_unit === undefined ? {} : { raw_unit }),
    ...(raw_validity === undefined ? {} : { raw_validity }),
  });
}

export function parsedPricingModel(model: ParsedPricingModel): ParsedPricingModel {
  return parsedPricingModelSchema.parse({
    provider_id: model.provider_id,
    model_id: model.model_id,
    ...(model.version === undefined ? {} : { version: model.version }),
    uid: model.uid,
    ...(model.api_endpoints === undefined ? {} : { api_endpoints: model.api_endpoints }),
    capabilities: model.capabilities,
    ...(model.service_families === undefined ? {} : { service_families: model.service_families }),
    status: model.status,
    tasks: model.tasks,
    pricing_state: model.pricing_state,
    price_facts: model.price_facts.map(parsedPriceFact),
    raw_price_facts: model.raw_price_facts.map((fact) => sourceRawPricingFactSchema.parse(fact)),
    ...(model.commercial_facts === undefined
      ? {}
      : {
          commercial_facts: model.commercial_facts.map((fact) =>
            sourceCommercialPricingFactSchema.parse(fact),
          ),
        }),
    ...(model.pricing_inputs === undefined
      ? {}
      : {
          pricing_inputs: model.pricing_inputs.map((fact) =>
            sourcePricingInputFactSchema.parse(fact),
          ),
        }),
  });
}

export function publishedModel(model: ParsedProviderModel): ProviderModel {
  const {
    pricing_state: _pricingState,
    price_facts: _priceFacts,
    raw_price_facts: _rawPriceFacts,
    commercial_facts: _commercialFacts,
    pricing_inputs: _pricingInputs,
    ...published
  } = model;
  return providerModelSchema.parse(published);
}
