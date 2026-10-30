import { z } from "zod";
import { priceCategoricalValueSchema, priceDimensionSchema } from "./pricing-schema.ts";

const reference = z.string().min(1).max(512);
const refs = z
  .array(reference)
  .min(1)
  .max(4096)
  .refine((values) => new Set(values).size === values.length, "Duplicate references");

export const invocationPricingBindingSchema = z.strictObject({
  target_ref: reference,
  case_ref: reference,
  offer_refs: refs,
  selectors: z
    .array(
      z.strictObject({
        dimension: priceDimensionSchema,
        value: z.discriminatedUnion("kind", [
          z.strictObject({ kind: z.literal("fixed"), value: priceCategoricalValueSchema }),
          z.strictObject({ kind: z.literal("context"), input: reference }),
          z.strictObject({ kind: z.literal("observed"), input_ref: reference }),
        ]),
        evidence_refs: refs,
      }),
    )
    .max(64),
  evidence_refs: refs,
});

export const sourceInvocationPriceLinkSchema = invocationPricingBindingSchema
  .omit({ offer_refs: true })
  .extend({
    model_ref: reference,
    source_ref: reference,
    offer_key: reference,
  });

export type InvocationPricingBinding = z.infer<typeof invocationPricingBindingSchema>;
export type SourceInvocationPriceLink = z.infer<typeof sourceInvocationPriceLinkSchema>;
