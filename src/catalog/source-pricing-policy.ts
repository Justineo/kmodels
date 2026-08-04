import { z } from "zod";

const sourcePricingEvidenceKinds = [
  "model_catalog",
  "price_book",
  "billing_catalog",
  "commercial_terms",
  "scoped_meter_inventory",
] as const;

const sourcePricingBindingMethods = [
  "exact_id",
  "exact_or_documented_alias",
  "reviewed_unique_join",
  "meter_id",
] as const;

const sourcePricingCurrentnessKinds = [
  "current_snapshot",
  "observed_current",
  "scoped_current",
] as const;

export const sourcePricingEvidenceSchema = z.strictObject({
  authority: z.literal("first_party"),
  kind: z.enum(sourcePricingEvidenceKinds),
  binding: z.enum(sourcePricingBindingMethods),
  currentness: z.enum(sourcePricingCurrentnessKinds),
});

export type SourcePricingEvidence = z.infer<typeof sourcePricingEvidenceSchema>;
