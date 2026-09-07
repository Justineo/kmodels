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
  providerPricingSnapshotSchema,
  providerPricingVocabularySchema,
  rationalSchema,
  settlementVariantSchema,
  rawPricingVariantSchema,
  unitExpressionSchema,
  usageSignalSchema,
} from "../catalog/pricing-schema.ts";
import { isCanonicalInstant } from "../catalog/pricing-time.ts";

export const calculationSchemaVersion = "1.0";
const id = z.string().regex(/^[0-9a-f]{64}$/);
const text = z.string().min(1).max(4096);
const explanation = text.refine((value) => value.trim().length > 0);
const instant = z.string().refine(isCanonicalInstant);
export const evidenceSchema = z.strictObject({
  source_ref: text,
  locator: priceSourceLocatorSchema,
});
const evidence = z.array(evidenceSchema).min(1);
export const calculationBindingSchema = chargeBindingSchema
  .omit({ observations: true })
  .extend({ evidence });
const calculationSelectorSourceSchema = priceSelectorSourceSchema
  .omit({ observations: true })
  .extend({ evidence });
const calculationAllowanceSchema = priceAllowanceVariantSchema
  .omit({ observations: true })
  .extend({ evidence });
const calculationContributionSchema = priceContributionVariantSchema
  .omit({ observations: true, charge_bindings: true })
  .extend({ evidence, charge_bindings: z.array(calculationBindingSchema) });

export const calculationRateSchema = priceRateVariantSchema
  .omit({ observations: true, charge_binding: true, selector_sources: true })
  .extend({
    evidence,
    charge_binding: calculationBindingSchema.optional(),
    selector_sources: z.array(calculationSelectorSourceSchema).min(1).optional(),
  });
export const calculationRawSchema = rawPricingVariantSchema
  .omit({ observations: true })
  .extend({ evidence });
const rawVariants = z.array(calculationRawSchema);
const termBase = { id, term_key: text, source_refs: z.array(text).min(1) };
export const calculationTermSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...termBase,
    kind: z.literal("rate"),
    meter: priceMeterSchema,
    variants: z.array(calculationRateSchema),
    raw_variants: rawVariants,
  }),
  z.strictObject({
    ...termBase,
    kind: z.literal("allowance"),
    variants: z.array(calculationAllowanceSchema),
    raw_variants: rawVariants,
  }),
  z.strictObject({
    ...termBase,
    kind: z.literal("contribution"),
    variants: z.array(calculationContributionSchema),
    raw_variants: rawVariants,
  }),
  z.strictObject({ ...termBase, kind: z.literal("raw"), variants: rawVariants.min(1) }),
]);
export const calculationOfferSchema = pricingOfferSchema
  .omit({ states: true, enrollment: true, terms: true, relations: true, settlement: true })
  .extend({
    states: z.array(priceStateVariantSchema.omit({ observations: true }).extend({ evidence })),
    enrollment: z
      .array(priceEnrollmentVariantSchema.omit({ observations: true }).extend({ evidence }))
      .default([]),
    settlement: z
      .array(settlementVariantSchema.omit({ observations: true }).extend({ evidence }))
      .default([]),
    terms: z.array(calculationTermSchema),
    relations: z.array(offerRelationSchema.omit({ observations: true }).extend({ evidence })),
  });
export const calculationBookSchema = pricingBookSchema
  .omit({ scope_observations: true, resource_edges: true, offers: true })
  .extend({
    evidence,
    offers: z.array(calculationOfferSchema).min(1),
    resource_edges: z.array(
      pricingBookSchema.shape.resource_edges.element
        .omit({ observations: true })
        .extend({ evidence }),
    ),
  });
export const calculationProviderSchema = z.strictObject({
  snapshot: providerPricingSnapshotSchema,
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
  books: z.array(calculationBookSchema),
});
export const calculationEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(calculationSchemaVersion),
  snapshot: z.strictObject({
    pricingDataVersion: id,
    coreCatalogVersion: id,
    generatedAt: instant,
  }),
  providers: z.array(calculationProviderSchema).min(1).max(256),
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
export const quantitySchema = z.strictObject({ signal: usageSignalSchema, value: rationalSchema });
export const selectionRequestSchema = z.strictObject({
  offerRef: id,
  selectors: z.array(selectorSchema).max(128).default([]),
});
export const componentSchema = z.strictObject({
  id: text,
  offerRef: id,
  selectors: z.array(selectorSchema).max(128).default([]),
  quantities: z.array(quantitySchema).max(1024),
  aggregation: chargeBindingSchema.shape.aggregation.optional(),
  assumptions: z
    .array(
      z.discriminatedUnion("kind", [
        z.strictObject({
          kind: z.literal("quantity"),
          quantity: quantitySchema,
          explanation,
        }),
        z.strictObject({
          kind: z.literal("selector"),
          selector: selectorSchema,
          explanation,
        }),
      ]),
    )
    .max(1024)
    .default([]),
  relatedComponents: z.array(text).max(256).default([]),
});
const rfc3339Instant = z
  .string()
  .max(64)
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/);
export const calculationRequestSchema = z.strictObject({
  evaluatedAt: rfc3339Instant,
  components: z.array(componentSchema).min(1).max(1024),
});

export type CalculationEnvelope = z.infer<typeof calculationEnvelopeSchema>;
export type CalculationProvider = z.infer<typeof calculationProviderSchema>;
export type CalculationBook = z.infer<typeof calculationBookSchema>;
export type CalculationOffer = z.infer<typeof calculationOfferSchema>;
export type CalculationTerm = z.infer<typeof calculationTermSchema>;
export type CalculationRate = z.infer<typeof calculationRateSchema>;
export type CalculationBinding = z.infer<typeof calculationBindingSchema>;
export type CalculationRaw = z.infer<typeof calculationRawSchema>;
export type Selector = z.infer<typeof selectorSchema>;
export type Quantity = z.infer<typeof quantitySchema>;
export type CalculationRequest = z.input<typeof calculationRequestSchema>;
export type CalculationComponent = z.infer<typeof componentSchema>;
export type SelectionRequest = z.input<typeof selectionRequestSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;

export type CalculationRateTerm = Extract<CalculationTerm, { kind: "rate" }>;
export type CalculationAllowanceTerm = Extract<CalculationTerm, { kind: "allowance" }>;
export type CalculationContributionTerm = Extract<CalculationTerm, { kind: "contribution" }>;
export type CalculationAllowance = CalculationAllowanceTerm["variants"][number];
export type CalculationContribution = CalculationContributionTerm["variants"][number];
export type NormalizedVariant = CalculationRate | CalculationAllowance | CalculationContribution;
