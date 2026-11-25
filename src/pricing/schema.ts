import { z } from "zod";
import {
  billingModeSchema,
  commercialSelectionScopeSchema,
  decimalSchema,
  offerRelationSchema,
  priceAllowanceVariantSchema,
  priceApplicabilitySchema,
  priceCategoricalValueSchema,
  priceContributionVariantSchema,
  priceDimensionSchema,
  priceMeterSchema,
  priceRateVariantSchema,
  priceSourceLocatorSchema,
  priceStateVariantSchema,
  pricingBookSchema,
  pricingOfferSchema,
  pricingScopeSchema,
  providerPricingFreshnessSchema,
  providerPricingVocabularySchema,
  rawPricingVariantSchema,
  unitExpressionSchema,
} from "../catalog/pricing-schema.ts";
import { isCanonicalInstant } from "../catalog/pricing-time.ts";

export const priceDataSchemaVersion = "3.0";
const id = z.string().regex(/^[0-9a-f]{64}$/);
const text = z.string().min(1).max(4096);
const instant = z.string().refine(isCanonicalInstant);
const applicabilityId = z.number().int().nonnegative();

export const evidenceSchema = z.strictObject({
  source_ref: text,
  locator: priceSourceLocatorSchema,
});
const evidence = z.array(evidenceSchema).min(1);

const priceDataSelectionAlternativeSchema = z.strictObject({
  value: priceCategoricalValueSchema,
  applicability_id: applicabilityId,
});
export const priceDataSelectionSchema = commercialSelectionScopeSchema
  .omit({ applicability: true, alternatives: true })
  .extend({
    applicability_id: applicabilityId,
    alternatives: z.array(priceDataSelectionAlternativeSchema).max(128),
    evidence,
  });

const priceDataAllowanceSchema = priceAllowanceVariantSchema
  .omit({ observations: true, applicability: true })
  .extend({ applicability_id: applicabilityId, evidence });
const priceDataContributionSchema = priceContributionVariantSchema
  .omit({ observations: true, applicability: true, charge_bindings: true })
  .extend({ applicability_id: applicabilityId, evidence });
export const priceDataRateSchema = priceRateVariantSchema
  .omit({
    observations: true,
    applicability: true,
    charge_binding: true,
    selector_sources: true,
  })
  .extend({ applicability_id: applicabilityId, evidence });
export const priceDataRawSchema = rawPricingVariantSchema
  .omit({ observations: true, possible_scope: true })
  .extend({ possible_scope_id: applicabilityId.optional(), evidence });
const rawVariants = z.array(priceDataRawSchema);
const termBase = { id, term_key: text, source_refs: z.array(text).min(1) };
const priceDataStateSchema = priceStateVariantSchema
  .omit({ observations: true, applicability: true })
  .extend({ applicability_id: applicabilityId, evidence });
const priceDataRelationSchema = offerRelationSchema
  .omit({ observations: true, applicability: true })
  .extend({ applicability_id: applicabilityId, evidence });

export const priceDataSourceSchema = z.strictObject({
  id: text,
  url: z.url(),
  observed_at: instant,
  content_hash: id,
  extractor_version: text,
});

const rawPriceDataTermSchema = z.discriminatedUnion("kind", [
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
const rawPriceDataOfferSchema = pricingOfferSchema
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
    states: z.array(priceDataStateSchema),
    selection: z.array(priceDataSelectionSchema).max(1024).optional(),
    terms: z.array(rawPriceDataTermSchema),
    relations: z.array(priceDataRelationSchema),
  });
const rawPriceDataBookSchema = pricingBookSchema
  .omit({ scope_observations: true, resource_edges: true, offers: true })
  .extend({
    evidence,
    offers: z.array(rawPriceDataOfferSchema).min(1),
  });
const rawPriceDataProviderSchema = z.strictObject({
  snapshot: providerPricingFreshnessSchema,
  vocabulary: providerPricingVocabularySchema,
  applicabilities: z.array(priceApplicabilitySchema),
  models: z.array(
    z.strictObject({
      model_ref: text,
      disposition: z.enum(["offers", "unknown", "not_applicable"]),
    }),
  ),
  sources: z.array(priceDataSourceSchema),
  books: z.array(rawPriceDataBookSchema),
});
const rawPriceDataEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(priceDataSchemaVersion),
  snapshot: z.strictObject({
    pricingDataVersion: id,
    coreCatalogVersion: id,
    generatedAt: instant,
  }),
  providers: z.array(rawPriceDataProviderSchema).min(1).max(256),
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

export type Evidence = z.infer<typeof evidenceSchema>;
export type PriceDataSelection = z.infer<typeof priceDataSelectionSchema>;
export type PriceDataRate = z.infer<typeof priceDataRateSchema>;
export type PriceDataRaw = z.infer<typeof priceDataRawSchema>;
export type PriceDataAllowance = z.infer<typeof priceDataAllowanceSchema>;
export type PriceDataContribution = z.infer<typeof priceDataContributionSchema>;
export type Selector = z.infer<typeof selectorSchema>;

type PriceDataMeter = z.infer<typeof priceMeterSchema>;
type PriceDataBillingMode = z.infer<typeof billingModeSchema>;
type PriceDataScope = z.infer<typeof pricingScopeSchema>;
type PriceDataApplicability = z.infer<typeof priceApplicabilitySchema>;
type PriceDataFreshness = z.infer<typeof providerPricingFreshnessSchema>;
type PriceDataVocabulary = z.infer<typeof providerPricingVocabularySchema>;
type PriceDataState = z.infer<typeof priceDataStateSchema>;
type PriceDataRelation = z.infer<typeof priceDataRelationSchema>;
type PriceDataSource = z.infer<typeof priceDataSourceSchema>;

export type PriceDataRateTerm = {
  id: string;
  term_key: string;
  source_refs: string[];
  kind: "rate";
  meter: PriceDataMeter;
  variants: PriceDataRate[];
  raw_variants: PriceDataRaw[];
};
export type PriceDataAllowanceTerm = {
  id: string;
  term_key: string;
  source_refs: string[];
  kind: "allowance";
  variants: PriceDataAllowance[];
  raw_variants: PriceDataRaw[];
};
export type PriceDataContributionTerm = {
  id: string;
  term_key: string;
  source_refs: string[];
  kind: "contribution";
  variants: PriceDataContribution[];
  raw_variants: PriceDataRaw[];
};
export type PriceDataRawTerm = {
  id: string;
  term_key: string;
  source_refs: string[];
  kind: "raw";
  variants: PriceDataRaw[];
};
export type PriceDataTerm =
  | PriceDataRateTerm
  | PriceDataAllowanceTerm
  | PriceDataContributionTerm
  | PriceDataRawTerm;

export interface PriceDataOffer {
  id: string;
  offer_key: string;
  name?: string | undefined;
  model_refs?: string[] | undefined;
  billing_mode: PriceDataBillingMode;
  states: PriceDataState[];
  selection?: PriceDataSelection[] | undefined;
  terms: PriceDataTerm[];
  relations: PriceDataRelation[];
  source_refs: string[];
}

export interface PriceDataBook {
  id: string;
  provider_id: string;
  book_key: string;
  name?: string | undefined;
  scope: PriceDataScope;
  evidence: Evidence[];
  offers: PriceDataOffer[];
  source_refs: string[];
}

export interface PriceDataProvider {
  snapshot: PriceDataFreshness;
  vocabulary: PriceDataVocabulary;
  applicabilities: PriceDataApplicability[];
  models: { model_ref: string; disposition: "offers" | "unknown" | "not_applicable" }[];
  sources: PriceDataSource[];
  books: PriceDataBook[];
}

export interface PriceDataEnvelope {
  schemaVersion: typeof priceDataSchemaVersion;
  snapshot: {
    pricingDataVersion: string;
    coreCatalogVersion: string;
    generatedAt: string;
  };
  providers: PriceDataProvider[];
}

/** Hydrated candidate types returned by lookup functions with inline applicability predicates. */
export type ResolvedPriceRate = Omit<PriceDataRate, "applicability_id"> & {
  applicability: PriceDataApplicability;
};
export type ResolvedPriceAllowance = Omit<PriceDataAllowance, "applicability_id"> & {
  applicability: PriceDataApplicability;
};
export type ResolvedPriceContribution = Omit<PriceDataContribution, "applicability_id"> & {
  applicability: PriceDataApplicability;
};
export type ResolvedPriceRaw = Omit<PriceDataRaw, "possible_scope_id"> & {
  possible_scope?: PriceDataApplicability | undefined;
};
export type ResolvedPriceState = Omit<PriceDataState, "applicability_id"> & {
  applicability: PriceDataApplicability;
};
export type ResolvedPriceRelation = Omit<PriceDataRelation, "applicability_id"> & {
  applicability: PriceDataApplicability;
};
export type ResolvedPriceSelection = Omit<
  PriceDataSelection,
  "applicability_id" | "alternatives"
> & {
  applicability: PriceDataApplicability;
  alternatives: Array<{
    value: PriceDataSelection["alternatives"][number]["value"];
    applicability: PriceDataApplicability;
  }>;
};
export type ResolvedPriceRateTerm = {
  id: string;
  term_key: string;
  source_refs: string[];
  kind: "rate";
  meter: PriceDataMeter;
  variants: ResolvedPriceRate[];
  raw_variants: ResolvedPriceRaw[];
};
export type ResolvedPriceAllowanceTerm = {
  id: string;
  term_key: string;
  source_refs: string[];
  kind: "allowance";
  variants: ResolvedPriceAllowance[];
  raw_variants: ResolvedPriceRaw[];
};
export type ResolvedPriceContributionTerm = {
  id: string;
  term_key: string;
  source_refs: string[];
  kind: "contribution";
  variants: ResolvedPriceContribution[];
  raw_variants: ResolvedPriceRaw[];
};
export type ResolvedPriceRawTerm = {
  id: string;
  term_key: string;
  source_refs: string[];
  kind: "raw";
  variants: ResolvedPriceRaw[];
};
export type ResolvedPriceTerm =
  | ResolvedPriceRateTerm
  | ResolvedPriceAllowanceTerm
  | ResolvedPriceContributionTerm
  | ResolvedPriceRawTerm;

export interface ResolvedPriceOffer {
  id: string;
  offer_key: string;
  name?: string | undefined;
  model_refs?: string[] | undefined;
  billing_mode: PriceDataBillingMode;
  states: ResolvedPriceState[];
  selection?: ResolvedPriceSelection[] | undefined;
  terms: ResolvedPriceTerm[];
  relations: ResolvedPriceRelation[];
  source_refs: string[];
}

export const priceDataEnvelopeSchema: z.ZodType<PriceDataEnvelope, PriceDataEnvelope> =
  rawPriceDataEnvelopeSchema;
