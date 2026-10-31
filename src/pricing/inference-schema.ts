import { z } from "zod";
import { calculationProviderSchema, evidenceSchema, selectorSchema } from "./schema.ts";
import { isCanonicalInstant } from "../catalog/pricing-time.ts";

const identifier = z.string().min(1).max(4096);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
export const inferencePriceReasonSchema = z.enum([
  "unreviewed_id",
  "ambiguous_identity",
  "incompatible_conditions",
  "no_applicable_price",
  "unresolved_price",
]);

export const inferencePriceRuleSchema = z.strictObject({
  provider_id: identifier,
  model_id: identifier,
  model_ref: identifier,
  offer_refs: z.array(hash).min(1),
  fixed_selectors: z.array(selectorSchema).max(128),
  evidence: z.array(evidenceSchema).min(1),
});

// Associations belong to the same accepted snapshot as their referenced prices and sources.
export const inferencePriceMappingSchema = z.strictObject({
  core_catalog_version: hash,
  pricing_data_version: hash,
  sources: z.array(
    calculationProviderSchema.shape.sources.element.extend({ provider_id: identifier }),
  ),
  rules: z.array(inferencePriceRuleSchema),
});

export const inferencePriceQuerySchema = z.strictObject({
  provider_id: identifier,
  model_id: identifier,
  offer_ref: hash.optional(),
  selectors: z.array(selectorSchema).max(128).default([]),
  evaluated_at: z.string().refine(isCanonicalInstant).optional(),
});

export type InferencePriceRule = z.infer<typeof inferencePriceRuleSchema>;
export type InferencePriceMapping = z.infer<typeof inferencePriceMappingSchema>;
export type InferencePriceQuery = z.input<typeof inferencePriceQuerySchema>;
export type InferencePriceReason = z.infer<typeof inferencePriceReasonSchema>;
