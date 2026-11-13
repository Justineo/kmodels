import { z } from "zod";
import { executionModeSchema } from "./execution-mode.ts";
import {
  commercialChoiceSchema,
  commercialSelectionScopeSchema,
  priceMeterSchema,
} from "../catalog/pricing-schema.ts";
import {
  priceDataProviderSchema,
  evaluationTimeSchema,
  evidenceSchema,
  selectorSchema,
} from "./schema.ts";

const identifier = z.string().min(1).max(4096);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
export const inferencePriceReasonSchema = z.enum([
  "unreviewed_id",
  "ambiguous_identity",
  "incompatible_conditions",
  "no_applicable_price",
  "unresolved_price",
  "unreviewed_execution_mode",
  "unreviewed_commercial_choice",
]);

export const executionChoiceSchema = z.strictObject({
  mode: executionModeSchema,
  offer_ref: hash,
  evidence: z.array(evidenceSchema).min(1),
});

export const inferencePriceRuleSchema = z.strictObject({
  provider_id: identifier,
  model_id: identifier,
  model_ref: identifier,
  offer_refs: z.array(hash).min(1),
  fixed_selectors: z.array(selectorSchema).max(128),
  evidence: z.array(evidenceSchema).min(1),
  execution_choices: z.array(executionChoiceSchema).min(1).optional(),
});

// Associations belong to the same accepted snapshot as their referenced prices and sources.
export const inferencePriceMappingSchema = z.strictObject({
  core_catalog_version: hash,
  pricing_data_version: hash,
  sources: z.array(
    priceDataProviderSchema.shape.sources.element.extend({ provider_id: identifier }),
  ),
  rules: z.array(inferencePriceRuleSchema),
  offer_selections: z
    .array(
      z.strictObject({
        offer_ref: hash,
        selection: z.array(
          commercialSelectionScopeSchema.extend({ evidence: z.array(evidenceSchema).min(1) }),
        ),
      }),
    )
    .optional(),
});

export const inferencePriceQuerySchema = z.strictObject({
  provider_id: identifier,
  model_id: identifier,
  meter: priceMeterSchema.optional(),
  offer_ref: hash.optional(),
  execution_mode: executionModeSchema.optional(),
  choices: z.array(commercialChoiceSchema).max(8).default([]),
  selectors: z.array(selectorSchema).max(128).default([]),
  evaluated_at: evaluationTimeSchema.optional(),
});

export type InferencePriceRule = z.infer<typeof inferencePriceRuleSchema>;
export type InferencePriceMapping = z.infer<typeof inferencePriceMappingSchema>;
export type InferencePriceQuery = z.input<typeof inferencePriceQuerySchema>;
export type InferencePriceReason = z.infer<typeof inferencePriceReasonSchema>;
export type ExecutionChoice = z.infer<typeof executionChoiceSchema>;
