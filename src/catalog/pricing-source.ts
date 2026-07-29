import { z } from "zod";
import { standardPriceMeters } from "./pricing-vocabulary.ts";
import { providerModelSchema, type ProviderModel } from "./schema.ts";

const decimal = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);

export const sourcePriceFactSchema = z
  .object({
    meter: z.enum(standardPriceMeters),
    price: decimal,
    currency: z.string().min(1),
    unit: z.enum([
      "token",
      "thousand_tokens",
      "million_tokens",
      "request",
      "thousand_requests",
      "thousand_search_units",
      "image",
      "second",
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
      "unit_month",
      "million_tokens_per_hour",
      "frame",
      "thousand_tokens_per_minute_hour",
    ]),
    conditions: z.object({
      region: z.string().optional(),
      endpoint: z.string().optional(),
      deployment_scope: z.string().optional(),
      service_tier: z.string().optional(),
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
      style: z.string().optional(),
      audio: z.boolean().optional(),
      voice_control: z.boolean().optional(),
      video_input: z.boolean().optional(),
      effective_from: z.string().optional(),
      effective_until: z.string().optional(),
      promotion: z.boolean().optional(),
    }),
    source_ref: z.string().min(1),
    derived: z.boolean(),
    derivation: z.string().optional(),
    raw_price: z.string().optional(),
    raw_unit: z.string().optional(),
    raw_validity: z.string().optional(),
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

export const parsedPricingStateSchema = z.enum([
  "numeric",
  "not_published",
  "not_applicable",
  "custom_quote",
  "unknown",
]);

export type SourcePriceFact = z.infer<typeof sourcePriceFactSchema>;
export type ParsedPricingState = z.infer<typeof parsedPricingStateSchema>;
export type ParsedProviderModel = ProviderModel & {
  pricing_state: ParsedPricingState;
  price_facts: SourcePriceFact[];
};

export function publishedModel(model: ParsedProviderModel): ProviderModel {
  const { pricing_state: _pricingState, price_facts: _priceFacts, ...published } = model;
  return providerModelSchema.parse(published);
}
