import { z } from "zod";
import { pricingDecimalPattern, pricingLimits } from "./pricing-constants.ts";
import { isCanonicalInstant, isPublishedTime } from "./pricing-time.ts";
import {
  priceStates,
  pricingRefreshFailureCodes,
  publishedTimePrecisions,
  rawPricingImpacts,
  standardBillingUnits,
  standardPriceDimensions,
  standardPriceMeters,
} from "./pricing-vocabulary.ts";

const hash = z.string().regex(/^[0-9a-f]{64}$/);
const nonEmptyString = z.string().min(1);
const canonicalInteger = z
  .string()
  .regex(/^(?:0|[1-9]\d*)$/)
  .max(pricingLimits.exactIntegerDigits);
export const decimalSchema = z
  .string()
  .regex(pricingDecimalPattern)
  .refine((value) => value.replace(".", "").length <= pricingLimits.exactIntegerDigits, {
    message: "Decimal coefficient exceeds the exact-integer digit limit",
  });

export const standardPriceDimensionSchema = z.enum(standardPriceDimensions);

export const standardBillingUnitSchema = z.enum(standardBillingUnits);

export const standardPriceMeterSchema = z.enum(standardPriceMeters);

function providerOwned<T extends z.ZodType>(value: T) {
  return z.strictObject({
    namespace: z.literal("provider"),
    provider_id: nonEmptyString,
    value,
  });
}

export const priceDimensionSchema = z.discriminatedUnion("namespace", [
  z.strictObject({
    namespace: z.literal("kmodels"),
    value: standardPriceDimensionSchema,
  }),
  providerOwned(nonEmptyString),
]);

export const priceCategoricalValueSchema = z.discriminatedUnion("namespace", [
  z.strictObject({
    namespace: z.literal("kmodels"),
    value: nonEmptyString,
  }),
  providerOwned(nonEmptyString),
]);

export const billingUnitSchema = z.discriminatedUnion("namespace", [
  z.strictObject({
    namespace: z.literal("kmodels"),
    value: standardBillingUnitSchema,
  }),
  providerOwned(nonEmptyString),
]);

export const priceMeterSchema = z.discriminatedUnion("namespace", [
  z.strictObject({
    namespace: z.literal("kmodels"),
    value: standardPriceMeterSchema,
  }),
  providerOwned(nonEmptyString),
]);

export const billingModeSchema = z.discriminatedUnion("namespace", [
  z.strictObject({
    namespace: z.literal("kmodels"),
    value: z.enum(["usage", "capacity", "subscription", "one_time", "hybrid"]),
  }),
  providerOwned(nonEmptyString),
]);

export const allowanceResetSchema = z.discriminatedUnion("namespace", [
  z.strictObject({
    namespace: z.literal("kmodels"),
    value: z.enum(["none", "daily", "monthly", "annual"]),
  }),
  providerOwned(nonEmptyString),
]);

export const unitExpressionSchema = z.strictObject({
  factors: z
    .array(
      z.strictObject({
        unit: billingUnitSchema,
        power: z.number().int().min(1).max(pricingLimits.unitFactorPower),
      }),
    )
    .max(pricingLimits.unitFactors),
});

export const rationalSchema = z
  .strictObject({
    numerator: canonicalInteger,
    denominator: z
      .string()
      .regex(/^[1-9]\d*$/)
      .max(pricingLimits.exactIntegerDigits),
  })
  .superRefine(({ numerator, denominator }, context) => {
    if (numerator === "0" && denominator !== "1") {
      context.addIssue({ code: "custom", message: "Zero must use denominator 1" });
      return;
    }
    if (greatestCommonDivisor(BigInt(numerator), BigInt(denominator)) !== 1n)
      context.addIssue({ code: "custom", message: "Rational must be reduced" });
  });

export const priceDenominationSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("fiat"),
    currency: z.string().regex(/^[A-Z]{3}$/),
  }),
  z.strictObject({
    kind: z.literal("provider_credit"),
    provider_id: nonEmptyString,
    code: nonEmptyString,
  }),
]);

export const unitPriceSchema = z.strictObject({
  value: rationalSchema,
  denomination: priceDenominationSchema,
  per: unitExpressionSchema,
});

export const priceQuantitySchema = z.strictObject({
  value: rationalSchema,
  unit: unitExpressionSchema,
});

export const priceDecimalBoundSchema = z.strictObject({
  value: decimalSchema,
  inclusive: z.boolean(),
});

export const priceConditionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("categorical"),
    dimension: priceDimensionSchema,
    values: z
      .array(priceCategoricalValueSchema)
      .min(1)
      .max(pricingLimits.categoricalValuesPerCondition),
  }),
  z.strictObject({
    kind: z.literal("boolean"),
    dimension: priceDimensionSchema,
    value: z.boolean(),
  }),
  z
    .strictObject({
      kind: z.literal("decimal_range"),
      dimension: priceDimensionSchema,
      unit: unitExpressionSchema,
      lower: priceDecimalBoundSchema.optional(),
      upper: priceDecimalBoundSchema.optional(),
    })
    .refine(({ lower, upper }) => lower !== undefined || upper !== undefined, {
      message: "A decimal range must have a bound",
    }),
]);

export const priceConditionClauseSchema = z.strictObject({
  all_of: z.array(priceConditionSchema).max(pricingLimits.conditionsPerClause),
});

export const priceApplicabilitySchema = z.strictObject({
  any_of: z.array(priceConditionClauseSchema).min(1).max(pricingLimits.applicabilityClauses),
});

export const publishedTimeBoundarySchema = z
  .strictObject({
    value: nonEmptyString,
    precision: z.enum(publishedTimePrecisions),
    inclusive: z.boolean().optional(),
  })
  .superRefine(({ value, precision }, context) => {
    if (!isPublishedTime(value, precision))
      context.addIssue({ code: "custom", message: `Invalid ${precision} value` });
  });

export const publishedValiditySchema = z.union([
  z.strictObject({
    from: publishedTimeBoundarySchema,
    until: publishedTimeBoundarySchema.optional(),
  }),
  z.strictObject({
    from: publishedTimeBoundarySchema.optional(),
    until: publishedTimeBoundarySchema,
  }),
]);

export const rawPriceConditionSchema = z.strictObject({
  dimension: nonEmptyString,
  value: nonEmptyString,
});

export const rawPriceFactSchema = z
  .strictObject({
    label: nonEmptyString.optional(),
    amount: nonEmptyString.optional(),
    denomination: nonEmptyString.optional(),
    unit: nonEmptyString.optional(),
    meter: nonEmptyString.optional(),
    formula: nonEmptyString.optional(),
    validity: nonEmptyString.optional(),
    conditions: z.array(rawPriceConditionSchema).min(1).optional(),
    fragment: nonEmptyString.optional(),
  })
  .refine((fact) => Object.keys(fact).length > 0, { message: "Raw price fact is empty" });

export const priceSourceLocatorSchema = z.strictObject({
  kind: z.enum(["json_pointer", "sku", "table", "fragment", "provider_key"]),
  value: z.string(),
});

const priceObservationBaseShape = {
  source_ref: nonEmptyString,
  locator: priceSourceLocatorSchema,
  raw: rawPriceFactSchema,
};

export const normalizedPriceObservationSchema = z.strictObject({
  ...priceObservationBaseShape,
  establishes_applicability: priceApplicabilitySchema,
});

export const rawPriceObservationSchema = z.strictObject(priceObservationBaseShape);

export const priceDispositionObservationSchema = z.strictObject({
  source_ref: nonEmptyString,
  locator: priceSourceLocatorSchema,
  establishes_model_ref: nonEmptyString,
  raw: rawPriceFactSchema,
});

export const pricingScopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("models"),
    model_refs: z.array(nonEmptyString).min(1),
  }),
  z.strictObject({
    kind: z.literal("provider_service"),
    service_key: nonEmptyString,
    model_refs: z.array(nonEmptyString),
  }),
]);

export const priceScopeObservationSchema = z.strictObject({
  source_ref: nonEmptyString,
  locator: priceSourceLocatorSchema,
  establishes: pricingScopeSchema,
  raw: rawPriceFactSchema,
});

export const priceAllowanceBenefitSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("usage"),
    quantity: priceQuantitySchema,
  }),
  z.strictObject({
    kind: z.literal("credit"),
    amount: rationalSchema,
    denomination: priceDenominationSchema,
  }),
]);

export const priceAllowanceTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("usage_rate_terms"),
    term_refs: z.array(nonEmptyString).min(1),
  }),
  z.strictObject({
    kind: z.literal("offer_credit"),
  }),
]);

export const rawPricingReasonSchema = z.enum([
  "unknown_amount",
  "unknown_denomination",
  "unknown_unit",
  "unknown_meter",
  "unknown_applicability",
  "requires_usage_aggregation",
  "target_rate_not_normalized",
  "selector_limit",
  "conflicting_values",
  "unsupported_structure",
]);

export const rawPricingVariantSchema = z.strictObject({
  impact: z.enum(rawPricingImpacts),
  reason: rawPricingReasonSchema,
  possible_scope: priceApplicabilitySchema.optional(),
  validity: publishedValiditySchema.optional(),
  observations: z.array(rawPriceObservationSchema).min(1),
});

export const priceRateVariantSchema = z.strictObject({
  price: unitPriceSchema,
  applicability: priceApplicabilitySchema,
  validity: publishedValiditySchema.optional(),
  observations: z.array(normalizedPriceObservationSchema).min(1),
});

export const priceAllowanceVariantSchema = z.strictObject({
  benefit: priceAllowanceBenefitSchema,
  target: priceAllowanceTargetSchema,
  reset: allowanceResetSchema,
  applicability: priceApplicabilitySchema,
  validity: publishedValiditySchema.optional(),
  observations: z.array(normalizedPriceObservationSchema).min(1),
});

const pricingTermBaseShape = {
  id: hash,
  term_key: nonEmptyString,
  source_refs: z.array(nonEmptyString).min(1),
};

export const priceRateTermSchema = z
  .strictObject({
    ...pricingTermBaseShape,
    kind: z.literal("rate"),
    meter: priceMeterSchema,
    variants: z.array(priceRateVariantSchema),
    raw_variants: z.array(rawPricingVariantSchema),
  })
  .refine(({ variants, raw_variants }) => variants.length + raw_variants.length > 0, {
    message: "Rate term has no variants",
  });

export const priceAllowanceTermSchema = z
  .strictObject({
    ...pricingTermBaseShape,
    kind: z.literal("allowance"),
    variants: z.array(priceAllowanceVariantSchema),
    raw_variants: z.array(rawPricingVariantSchema),
  })
  .refine(({ variants, raw_variants }) => variants.length + raw_variants.length > 0, {
    message: "Allowance term has no variants",
  });

export const rawPricingTermSchema = z.strictObject({
  ...pricingTermBaseShape,
  kind: z.literal("raw"),
  variants: z.array(rawPricingVariantSchema).min(1),
});

export const pricingTermSchema = z.union([
  priceRateTermSchema,
  priceAllowanceTermSchema,
  rawPricingTermSchema,
]);

export const priceStateVariantSchema = z.strictObject({
  state: z.enum(priceStates),
  applicability: priceApplicabilitySchema,
  validity: publishedValiditySchema.optional(),
  observations: z.array(normalizedPriceObservationSchema).min(1),
});

export const addOnCompatibilitySchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("all_base_offers_in_book"),
  }),
  z.strictObject({
    kind: z.literal("base_offers"),
    offer_refs: z.array(hash).min(1),
  }),
  z.strictObject({
    kind: z.literal("not_normalized"),
  }),
]);

export const priceCompatibilityObservationSchema = z.strictObject({
  source_ref: nonEmptyString,
  locator: priceSourceLocatorSchema,
  establishes_offer_refs: z.array(hash),
  raw: rawPriceFactSchema,
});

const pricingOfferBaseShape = {
  id: hash,
  offer_key: nonEmptyString,
  name: nonEmptyString.optional(),
  billing_mode: billingModeSchema,
  states: z.array(priceStateVariantSchema),
  terms: z.array(pricingTermSchema),
  source_refs: z.array(nonEmptyString).min(1),
};

export const basePricingOfferSchema = z.strictObject({
  ...pricingOfferBaseShape,
  role: z.literal("base"),
});

export const addOnPricingOfferSchema = z.strictObject({
  ...pricingOfferBaseShape,
  role: z.literal("add_on"),
  compatibility: addOnCompatibilitySchema,
  compatibility_observations: z.array(priceCompatibilityObservationSchema).min(1),
});

export const pricingOfferSchema = z.discriminatedUnion("role", [
  basePricingOfferSchema,
  addOnPricingOfferSchema,
]);

export const pricingBookSchema = z.strictObject({
  id: hash,
  provider_id: nonEmptyString,
  book_key: nonEmptyString,
  name: nonEmptyString.optional(),
  scope: pricingScopeSchema,
  scope_observations: z.array(priceScopeObservationSchema).min(1),
  offers: z.array(pricingOfferSchema).min(1),
  source_refs: z.array(nonEmptyString).min(1),
});

export const providerAtomRegistryEntrySchema = z.union([
  z.strictObject({
    kind: z.enum([
      "billing_mode",
      "credit_denomination",
      "unit",
      "meter",
      "dimension",
      "allowance_reset",
    ]),
    key: nonEmptyString,
    definition: nonEmptyString,
  }),
  z.strictObject({
    kind: z.literal("categorical_value"),
    key: nonEmptyString,
    dimension: priceDimensionSchema,
    definition: nonEmptyString,
  }),
]);

export const providerPricingVocabularySchema = z.strictObject({
  provider_id: nonEmptyString,
  atoms: z.array(providerAtomRegistryEntrySchema),
});

const providerPricingSnapshotBase = {
  provider_id: nonEmptyString,
  observed_at: nonEmptyString.refine((value) => isCanonicalInstant(value), {
    message: "Invalid canonical instant",
  }),
};

const pricingRefreshFailureSchema = z.strictObject({
  attempted_at: nonEmptyString.refine((value) => isCanonicalInstant(value), {
    message: "Invalid canonical instant",
  }),
  code: z.enum(pricingRefreshFailureCodes),
});

export const providerPricingSnapshotSchema = z.discriminatedUnion("publication", [
  z.strictObject({
    ...providerPricingSnapshotBase,
    publication: z.literal("fresh"),
  }),
  z.strictObject({
    ...providerPricingSnapshotBase,
    publication: z.literal("retained"),
    refresh_failure: pricingRefreshFailureSchema,
  }),
]);

export const modelPricingDispositionSchema = z.strictObject({
  model_ref: nonEmptyString,
  state: z.literal("not_applicable"),
  observations: z.array(priceDispositionObservationSchema).min(1),
});

export const pricingCatalogSchema = z.strictObject({
  provider_vocabularies: z.array(providerPricingVocabularySchema),
  provider_snapshots: z.array(providerPricingSnapshotSchema),
  model_dispositions: z.array(modelPricingDispositionSchema),
  books: z.array(pricingBookSchema),
});

export const pricingCatalogEnvelopeSchema = z.strictObject({
  pricing_data_version: hash,
  core_catalog_version: hash,
  core_data_sha256: hash,
  generated_at: nonEmptyString.refine((value) => isCanonicalInstant(value), {
    message: "Invalid canonical instant",
  }),
  data: pricingCatalogSchema,
});

export type AddOnCompatibility = z.infer<typeof addOnCompatibilitySchema>;
export type AllowanceReset = z.infer<typeof allowanceResetSchema>;
export type BillingMode = z.infer<typeof billingModeSchema>;
export type BillingUnit = z.infer<typeof billingUnitSchema>;
export type ModelPricingDisposition = z.infer<typeof modelPricingDispositionSchema>;
export type NormalizedPriceObservation = z.infer<typeof normalizedPriceObservationSchema>;
export type PriceAllowanceBenefit = z.infer<typeof priceAllowanceBenefitSchema>;
export type PriceAllowanceTarget = z.infer<typeof priceAllowanceTargetSchema>;
export type PriceAllowanceTerm = z.infer<typeof priceAllowanceTermSchema>;
export type PriceAllowanceVariant = z.infer<typeof priceAllowanceVariantSchema>;
export type PriceApplicability = z.infer<typeof priceApplicabilitySchema>;
export type PriceCategoricalValue = z.infer<typeof priceCategoricalValueSchema>;
export type PriceCompatibilityObservation = z.infer<typeof priceCompatibilityObservationSchema>;
export type PriceCondition = z.infer<typeof priceConditionSchema>;
export type PriceDenomination = z.infer<typeof priceDenominationSchema>;
export type PriceDimension = z.infer<typeof priceDimensionSchema>;
export type PriceDispositionObservation = z.infer<typeof priceDispositionObservationSchema>;
export type PriceMeter = z.infer<typeof priceMeterSchema>;
export type PriceQuantity = z.infer<typeof priceQuantitySchema>;
export type PriceRateTerm = z.infer<typeof priceRateTermSchema>;
export type PriceRateVariant = z.infer<typeof priceRateVariantSchema>;
export type PriceScopeObservation = z.infer<typeof priceScopeObservationSchema>;
export type PriceSourceLocator = z.infer<typeof priceSourceLocatorSchema>;
export type PriceStateVariant = z.infer<typeof priceStateVariantSchema>;
export type PricingBook = z.infer<typeof pricingBookSchema>;
export type PricingCatalog = z.infer<typeof pricingCatalogSchema>;
export type PricingCatalogEnvelope = z.infer<typeof pricingCatalogEnvelopeSchema>;
export type PricingOffer = z.infer<typeof pricingOfferSchema>;
export type PricingScope = z.infer<typeof pricingScopeSchema>;
export type PricingTerm = z.infer<typeof pricingTermSchema>;
export type ProviderAtomRegistryEntry = z.infer<typeof providerAtomRegistryEntrySchema>;
export type ProviderPricingSnapshot = z.infer<typeof providerPricingSnapshotSchema>;
export type PricingRefreshFailure = z.infer<typeof pricingRefreshFailureSchema>;
export type PricingRefreshFailureCode = PricingRefreshFailure["code"];
export type ProviderPricingVocabulary = z.infer<typeof providerPricingVocabularySchema>;
export type PublishedValidity = z.infer<typeof publishedValiditySchema>;
export type Rational = z.infer<typeof rationalSchema>;
export type RawPriceFact = z.infer<typeof rawPriceFactSchema>;
export type RawPriceObservation = z.infer<typeof rawPriceObservationSchema>;
export type RawPricingVariant = z.infer<typeof rawPricingVariantSchema>;
export type StandardPriceMeter = z.infer<typeof standardPriceMeterSchema>;
export type UnitExpression = z.infer<typeof unitExpressionSchema>;
export type UnitPrice = z.infer<typeof unitPriceSchema>;

export function emptyPricingCatalog(): PricingCatalog {
  return {
    provider_vocabularies: [],
    provider_snapshots: [],
    model_dispositions: [],
    books: [],
  };
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  while (right !== 0n) [left, right] = [right, left % right];
  return left;
}
