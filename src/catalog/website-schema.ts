import { z } from "zod";
import {
  deliveryModes,
  modalities,
  modelLifecycles,
  modelReleaseStages,
  modelScopes,
  modelTasks,
} from "./catalog-vocabulary.ts";
import {
  priceStates,
  publishedTimePrecisions,
  rawPricingImpacts,
  standardBillingUnits,
  standardPriceDimensions,
} from "./pricing-vocabulary.ts";

const hash = z.string().regex(/^[0-9a-f]{64}$/);
const nonEmpty = z.string().min(1);
const modelDate = z.union([
  z.iso.date(),
  z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/),
  z.string().regex(/^\d{4}$/),
]);
const modelTaskSchema = z.enum(modelTasks);
const standardPriceDimensionSchema = z.enum(standardPriceDimensions);
const standardBillingUnitSchema = z.enum(standardBillingUnits);

function providerOwned<T extends z.ZodType>(value: T) {
  return z.strictObject({
    namespace: z.literal("provider"),
    provider_id: nonEmpty,
    value,
  });
}

const priceDimensionSchema = z.discriminatedUnion("namespace", [
  z.strictObject({
    namespace: z.literal("kmodels"),
    value: standardPriceDimensionSchema,
  }),
  providerOwned(nonEmpty),
]);
const priceCategoricalValueSchema = z.discriminatedUnion("namespace", [
  z.strictObject({
    namespace: z.literal("kmodels"),
    value: nonEmpty,
  }),
  providerOwned(nonEmpty),
]);
const billingUnitSchema = z.discriminatedUnion("namespace", [
  z.strictObject({
    namespace: z.literal("kmodels"),
    value: standardBillingUnitSchema,
  }),
  providerOwned(nonEmpty),
]);
const unitExpressionSchema = z.strictObject({
  factors: z.array(
    z.strictObject({
      unit: billingUnitSchema,
      power: z.number().int().positive(),
    }),
  ),
});
const decimalBoundSchema = z.strictObject({
  value: nonEmpty,
  inclusive: z.boolean(),
});
const priceConditionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("categorical"),
    dimension: priceDimensionSchema,
    values: z.array(priceCategoricalValueSchema).min(1),
  }),
  z.strictObject({
    kind: z.literal("boolean"),
    dimension: priceDimensionSchema,
    value: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal("decimal_range"),
    dimension: priceDimensionSchema,
    unit: unitExpressionSchema,
    lower: decimalBoundSchema.optional(),
    upper: decimalBoundSchema.optional(),
  }),
]);
const priceApplicabilitySchema = z.strictObject({
  any_of: z.array(z.strictObject({ all_of: z.array(priceConditionSchema) })).min(1),
});
const publishedTimeBoundarySchema = z.strictObject({
  value: nonEmpty,
  precision: z.enum(publishedTimePrecisions),
  inclusive: z.boolean().optional(),
});
const publishedValiditySchema = z.union([
  z.strictObject({
    from: publishedTimeBoundarySchema,
    until: publishedTimeBoundarySchema.optional(),
  }),
  z.strictObject({
    from: publishedTimeBoundarySchema.optional(),
    until: publishedTimeBoundarySchema,
  }),
]);

const websitePricingCellSchema = z.strictObject({
  meter: z.string().min(1),
  amount: z.string().min(1),
  displayUnit: z.string().min(1),
  accessibleText: z.string().min(1),
  showTooltip: z.boolean(),
});

const websitePricingSnapshotSchema = z.discriminatedUnion("publication", [
  z.strictObject({
    observed_at: z.string().min(1),
    publication: z.literal("fresh"),
  }),
  z.strictObject({
    observed_at: z.string().min(1),
    publication: z.literal("retained"),
    refresh_failure: z.strictObject({
      attempted_at: z.string().min(1),
      message: z.string().min(1),
    }),
  }),
]);

export const websitePricingSummarySchema = z.strictObject({
  outcome: z.enum(["not_applicable", "unknown", "offers"]),
  status: z
    .strictObject({
      label: nonEmpty,
      description: nonEmpty,
    })
    .optional(),
  input: websitePricingCellSchema.optional(),
  cache: websitePricingCellSchema.optional(),
  output: websitePricingCellSchema.optional(),
});

const websiteCatalogIndexModelSchema = z.strictObject({
  provider_id: nonEmpty,
  model_id: nonEmpty,
  version: nonEmpty.optional(),
  name: nonEmpty,
  tasks: z.array(modelTaskSchema),
  release_date: modelDate.optional(),
  status: z.enum(modelLifecycles),
  release_stage: z.enum(modelReleaseStages),
  context_tokens: z.number().int().nonnegative().optional(),
  detail_chunk: z.number().int().nonnegative(),
});

export const websiteCatalogIndexSchema = z.strictObject({
  schema_version: z.literal(1),
  data_version: hash,
  generated_at: z.string().min(1),
  providers: z.array(
    z.strictObject({
      id: z.string().min(1),
      name: z.string().min(1),
    }),
  ),
  models: z.array(websiteCatalogIndexModelSchema),
});

export const websitePricingSummariesSchema = z.strictObject({
  schema_version: z.literal(1),
  data_version: hash,
  pricing: z.array(websitePricingSummarySchema),
});

const selectorBase = {
  key: z.string().min(1),
  label: z.string().min(1),
  dimension: priceDimensionSchema,
};
const decimalRangeShape = {
  lower: decimalBoundSchema.optional(),
  upper: decimalBoundSchema.optional(),
};
const websiteDecimalRangeSchema = z
  .strictObject(decimalRangeShape)
  .refine(({ lower, upper }) => lower !== undefined || upper !== undefined, {
    message: "A website decimal range must have a bound",
  });
const websiteDecimalBucketSchema = z
  .strictObject({
    key: nonEmpty,
    label: nonEmpty,
    ...decimalRangeShape,
  })
  .refine(({ lower, upper }) => lower !== undefined || upper !== undefined, {
    message: "A website decimal bucket must have a bound",
  });

const websitePricingSelectorSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...selectorBase,
    kind: z.literal("categorical"),
    values: z
      .array(
        z.strictObject({
          key: z.string().min(1),
          label: z.string().min(1),
          value: priceCategoricalValueSchema,
        }),
      )
      .min(1),
  }),
  z.strictObject({
    ...selectorBase,
    kind: z.literal("boolean"),
  }),
  z.strictObject({
    ...selectorBase,
    kind: z.literal("decimal_values"),
    unit: unitExpressionSchema,
    values: z.array(nonEmpty).min(1),
  }),
  z.strictObject({
    ...selectorBase,
    kind: z.literal("decimal_buckets"),
    unit: unitExpressionSchema,
    values: z.array(websiteDecimalBucketSchema).min(2),
  }),
  z.strictObject({
    ...selectorBase,
    kind: z.literal("decimal_range"),
    unit: unitExpressionSchema,
    ranges: z.array(websiteDecimalRangeSchema).min(1),
  }),
]);

const scopeFields = {
  applicability: priceApplicabilitySchema,
  validity: publishedValiditySchema.optional(),
};

const websiteStateRowSchema = z.strictObject({
  key: z.string().min(1),
  state: z.enum(priceStates),
  label: z.string().min(1),
  ...scopeFields,
});

const websiteRateRowSchema = z.strictObject({
  key: z.string().min(1),
  label: z.string().min(1),
  amount: z.string().min(1),
  unit: z.string().min(1),
  accessible_text: z.string().min(1),
  ...scopeFields,
});

const websiteAllowanceRowSchema = z.strictObject({
  key: z.string().min(1),
  value: z.string().min(1),
  target: z.string().min(1),
  reset: z.string().min(1),
  ...scopeFields,
});

const websiteContributionRowSchema = z.strictObject({
  key: z.string().min(1),
  label: z.string().min(1),
  target: z.string().min(1),
  ...scopeFields,
});

const websiteUnnormalizedRowSchema = z.strictObject({
  key: z.string().min(1),
  label: z.string().min(1),
  impact: z.enum(rawPricingImpacts),
  reason: z.string().min(1),
  possible_scope: priceApplicabilitySchema.optional(),
  validity: publishedValiditySchema.optional(),
});

const websitePricingOfferSchema = z.strictObject({
  id: hash,
  title: z.string().min(1),
  group: z.enum([
    "model_mechanism",
    "optional_service",
    "automatic_component",
    "plan_capacity",
    "standalone",
  ]),
  composition: z.string().min(1).optional(),
  state_summary: z.string().min(1),
  selectors: z.array(websitePricingSelectorSchema),
  states: z.array(websiteStateRowSchema),
  rates: z.array(websiteRateRowSchema),
  allowances: z.array(websiteAllowanceRowSchema),
  contributions: z.array(websiteContributionRowSchema),
  unnormalized: z.array(websiteUnnormalizedRowSchema),
});

export const websitePricingDetailSchema = z.strictObject({
  snapshot: websitePricingSnapshotSchema.optional(),
  offers: z.array(websitePricingOfferSchema),
});

export const websiteModelDetailSchema = z.strictObject({
  model_ref: nonEmpty,
  updated_date: modelDate.optional(),
  description: z.string().optional(),
  delivery_modes: z.array(z.enum(deliveryModes)).optional(),
  api_endpoints: z
    .array(
      z.strictObject({
        name: nonEmpty,
        path: nonEmpty,
      }),
    )
    .optional(),
  modalities: z.strictObject({
    input: z.array(z.enum(modalities)),
    output: z.array(z.enum(modalities)),
  }),
  capabilities: z.strictObject({
    reasoning: z.union([z.boolean(), z.literal("unknown")]),
    tool_call: z.union([z.boolean(), z.literal("unknown")]),
    structured_output: z.union([z.boolean(), z.literal("unknown")]),
    streaming: z.union([z.boolean(), z.literal("unknown")]),
    batch: z.union([z.boolean(), z.literal("unknown")]),
    prompt_cache: z.union([z.boolean(), z.literal("unknown")]),
    fine_tuning: z.union([z.boolean(), z.literal("unknown")]),
    citations: z.union([z.boolean(), z.literal("unknown")]),
    code_execution: z.union([z.boolean(), z.literal("unknown")]),
    context_management: z.union([z.boolean(), z.literal("unknown")]),
    effort_control: z.union([z.boolean(), z.literal("unknown")]),
    computer_use: z.union([z.boolean(), z.literal("unknown")]),
  }),
  max_output_tokens: z.number().int().nonnegative().optional(),
  scope: z.enum(modelScopes),
  availability_count: z.number().int().nonnegative().optional(),
  pricing: websitePricingDetailSchema.optional(),
});

export const websiteDetailChunkSchema = z.strictObject({
  schema_version: z.literal(3),
  data_version: hash,
  provider_id: nonEmpty,
  chunk: z.number().int().nonnegative(),
  details: z.array(websiteModelDetailSchema),
});

export type WebsiteCatalogIndex = z.infer<typeof websiteCatalogIndexSchema>;
export type WebsiteCatalogIndexModel = z.infer<typeof websiteCatalogIndexModelSchema>;
export type WebsitePricingSummaries = z.infer<typeof websitePricingSummariesSchema>;
export type WebsitePricingSummary = z.infer<typeof websitePricingSummarySchema>;
export type WebsiteDetailChunk = z.infer<typeof websiteDetailChunkSchema>;
export type WebsiteModel = WebsiteCatalogIndexModel & {
  uid: string;
  pricing: WebsitePricingSummary;
};
export type WebsiteCatalog = Omit<WebsiteCatalogIndex, "models"> & {
  models: WebsiteModel[];
};
export type WebsiteModelDetail = z.infer<typeof websiteModelDetailSchema>;
export type WebsitePricingDetail = z.infer<typeof websitePricingDetailSchema>;
export type WebsitePricingOffer = z.infer<typeof websitePricingOfferSchema>;
export type WebsitePricingSelector = z.infer<typeof websitePricingSelectorSchema>;
export type WebsitePriceApplicability = z.infer<typeof priceApplicabilitySchema>;
export type WebsitePriceCategoricalValue = z.infer<typeof priceCategoricalValueSchema>;
export type WebsitePriceCondition = z.infer<typeof priceConditionSchema>;
export type WebsitePriceDimension = z.infer<typeof priceDimensionSchema>;
export type WebsitePublishedValidity = z.infer<typeof publishedValiditySchema>;
