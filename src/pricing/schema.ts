import { z } from "zod";
import {
  chargeBindingSchema,
  decimalSchema,
  offerRelationSchema,
  priceAllowanceVariantSchema,
  priceCategoricalValueSchema,
  priceContributionVariantSchema,
  priceDimensionSchema,
  priceEnrollmentVariantSchema,
  priceMeterSchema,
  priceRateVariantSchema,
  priceSelectorSourceSchema,
  priceSourceLocatorSchema,
  priceStateVariantSchema,
  pricingBookSchema,
  pricingOfferSchema,
  providerPricingFreshnessSchema,
  providerPricingVocabularySchema,
  settlementVariantSchema,
  rawPricingVariantSchema,
  unitExpressionSchema,
} from "../catalog/pricing-schema.ts";
import { isCanonicalInstant } from "../catalog/pricing-time.ts";

export const priceDataSchemaVersion = "2.0";
const id = z.string().regex(/^[0-9a-f]{64}$/);
const text = z.string().min(1).max(4096);
const instant = z.string().refine(isCanonicalInstant);
export const evidenceSchema = z.strictObject({
  source_ref: text,
  locator: priceSourceLocatorSchema,
});
const evidence = z.array(evidenceSchema).min(1);
export const priceDataBindingSchema = chargeBindingSchema
  .omit({ observations: true })
  .extend({ evidence });
const priceDataSelectorSourceSchema = priceSelectorSourceSchema
  .omit({ observations: true })
  .extend({ evidence });
const priceDataAllowanceSchema = priceAllowanceVariantSchema
  .omit({ observations: true })
  .extend({ evidence });
const priceDataContributionSchema = priceContributionVariantSchema
  .omit({ observations: true, charge_bindings: true })
  .extend({ evidence, charge_bindings: z.array(priceDataBindingSchema) });

export const priceDataRateSchema = priceRateVariantSchema
  .omit({ observations: true, charge_binding: true, selector_sources: true })
  .extend({
    evidence,
    charge_binding: priceDataBindingSchema.optional(),
    selector_sources: z.array(priceDataSelectorSourceSchema).min(1).optional(),
  });
export const priceDataRawSchema = rawPricingVariantSchema
  .omit({ observations: true })
  .extend({ evidence });
const rawVariants = z.array(priceDataRawSchema);
const termBase = { id, term_key: text, source_refs: z.array(text).min(1) };
export const priceDataTermSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...termBase,
    kind: z.literal("rate"),
    meter: priceMeterSchema,
    variants: z.array(priceDataRateSchema),
    raw_variants: rawVariants,
  }),
  z.strictObject({
    ...termBase,
    kind: z.literal("allowance"),
    variants: z.array(priceDataAllowanceSchema),
    raw_variants: rawVariants,
  }),
  z.strictObject({
    ...termBase,
    kind: z.literal("contribution"),
    variants: z.array(priceDataContributionSchema),
    raw_variants: rawVariants,
  }),
  z.strictObject({ ...termBase, kind: z.literal("raw"), variants: rawVariants.min(1) }),
]);
export const priceDataOfferSchema = pricingOfferSchema
  .omit({
    states: true,
    enrollment: true,
    terms: true,
    relations: true,
    settlement: true,
    selection: true,
    source_contexts: true,
  })
  .extend({
    states: z.array(priceStateVariantSchema.omit({ observations: true }).extend({ evidence })),
    enrollment: z
      .array(priceEnrollmentVariantSchema.omit({ observations: true }).extend({ evidence }))
      .default([]),
    settlement: z
      .array(settlementVariantSchema.omit({ observations: true }).extend({ evidence }))
      .default([]),
    terms: z.array(priceDataTermSchema),
    relations: z.array(offerRelationSchema.omit({ observations: true }).extend({ evidence })),
  });
export const priceDataBookSchema = pricingBookSchema
  .omit({ scope_observations: true, resource_edges: true, offers: true })
  .extend({
    evidence,
    offers: z.array(priceDataOfferSchema).min(1),
    resource_edges: z.array(
      pricingBookSchema.shape.resource_edges.element
        .omit({ observations: true })
        .extend({ evidence }),
    ),
  });
export const priceDataProviderSchema = z.strictObject({
  snapshot: providerPricingFreshnessSchema,
  vocabulary: providerPricingVocabularySchema,
  models: z.array(
    z.strictObject({
      model_ref: text,
      disposition: z.enum(["offers", "unknown", "not_applicable"]),
    }),
  ),
  sources: z.array(
    z.strictObject({
      id: text,
      url: z.url(),
      observed_at: instant,
      content_hash: id,
      extractor_version: text,
    }),
  ),
  books: z.array(priceDataBookSchema),
});
export const priceDataEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(priceDataSchemaVersion),
  snapshot: z.strictObject({
    pricingDataVersion: id,
    coreCatalogVersion: id,
    generatedAt: instant,
  }),
  providers: z.array(priceDataProviderSchema).min(1).max(256),
});
export const selectorSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    dimension: priceDimensionSchema,
    kind: z.literal("categorical"),
    value: priceCategoricalValueSchema,
  }),
  z.strictObject({
    dimension: priceDimensionSchema,
    kind: z.literal("boolean"),
    value: z.boolean(),
  }),
  z.strictObject({
    dimension: priceDimensionSchema,
    kind: z.literal("decimal"),
    value: decimalSchema,
    unit: unitExpressionSchema,
  }),
]);
export const evaluationTimeSchema = z
  .string()
  .max(64)
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/);
export type PriceDataEnvelope = z.infer<typeof priceDataEnvelopeSchema>;
export type PriceDataProvider = z.infer<typeof priceDataProviderSchema>;
export type PriceDataBook = z.infer<typeof priceDataBookSchema>;
export type PriceDataOffer = z.infer<typeof priceDataOfferSchema>;
export type PriceDataTerm = z.infer<typeof priceDataTermSchema>;
export type PriceDataRate = z.infer<typeof priceDataRateSchema>;
export type PriceDataBinding = z.infer<typeof priceDataBindingSchema>;
export type PriceDataRaw = z.infer<typeof priceDataRawSchema>;
export type Selector = z.infer<typeof selectorSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;

export type PriceDataRateTerm = Extract<PriceDataTerm, { kind: "rate" }>;
export type PriceDataAllowanceTerm = Extract<PriceDataTerm, { kind: "allowance" }>;
export type PriceDataContributionTerm = Extract<PriceDataTerm, { kind: "contribution" }>;
export type PriceDataAllowance = PriceDataAllowanceTerm["variants"][number];
export type PriceDataContribution = PriceDataContributionTerm["variants"][number];
