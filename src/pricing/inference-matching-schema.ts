import { z } from "zod";
import { priceApplicabilitySchema, publishedValiditySchema } from "../catalog/pricing-schema.ts";
import { isCanonicalInstant } from "../catalog/pricing-time.ts";
import { priceStates, rawPricingImpacts } from "../catalog/pricing-vocabulary.ts";
import { selectorSchema } from "./schema.ts";

const identifier = z.string().min(1);
const instant = z.string().refine(isCanonicalInstant);
const qualified = {
  applicability: priceApplicabilitySchema,
  validity: publishedValiditySchema.optional(),
  // Local equivalence classes preserve accounting conflicts without copying prices or evidence.
  semantics: z.number().int().nonnegative(),
};
const variant = z.strictObject({
  ...qualified,
  target_rate_refs: z.array(identifier).optional(),
});
const raw = z.strictObject({
  possible_scope: priceApplicabilitySchema.optional(),
  validity: publishedValiditySchema.optional(),
  impact: z.enum(rawPricingImpacts),
  reason: identifier,
});
const term = z.strictObject({
  id: identifier,
  kind: z.enum(["rate", "allowance", "contribution", "raw"]),
  variants: z.array(variant),
  raw_variants: z.array(raw),
});
const offer = z.strictObject({
  id: identifier,
  states: z.array(z.strictObject({ ...qualified, state: z.enum(priceStates) })),
  relations: z.array(variant),
  terms: z.array(term),
});

/** Only applicability, time, equivalence and canonical references cross the UI boundary. */
export const inferenceMatchDataSchema = z.strictObject({
  generated_at: instant,
  observed_at: instant,
  rules: z.array(
    z.strictObject({
      model_ref: identifier,
      offer_refs: z.array(identifier).min(1),
      fixed_selectors: z.array(selectorSchema),
    }),
  ),
  offers: z.array(offer),
  referenced_rates: z.array(term),
});

export type InferenceMatchData = z.infer<typeof inferenceMatchDataSchema>;
export type InferenceMatchOffer = z.infer<typeof offer>;
export type InferenceMatchTerm = z.infer<typeof term>;
