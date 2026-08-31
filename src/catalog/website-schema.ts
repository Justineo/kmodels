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
  applicabilityResolutionPhases,
  priceStates,
  publishedTimePrecisions,
  rawPricingImpacts,
  standardBillingUnits,
  standardPriceDimensions,
} from "./pricing-vocabulary.ts";
import { recurringTimeScheduleSchema } from "./pricing-temporal.ts";

const hash = z.string().regex(/^[0-9a-f]{64}$/);
const nonEmpty = z.string().min(1);
const modelDate = z.union([
  z.iso.date(),
  z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/),
  z.string().regex(/^\d{4}$/),
]);
const standardPriceDimensionSchema = z.enum(standardPriceDimensions);
const standardBillingUnitSchema = z.enum(standardBillingUnits);

function enumIndexSchema(values: readonly unknown[]) {
  return z
    .number()
    .int()
    .min(0)
    .max(values.length - 1);
}

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
  amount: z.string().min(1),
  displayUnit: z.string().min(1),
  accessibleText: z.string().min(1),
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

const websiteCatalogIndexModelSchema = z.tuple([
  z.number().int().nonnegative(),
  nonEmpty,
  nonEmpty.nullable(),
  nonEmpty.nullable(),
  z.array(enumIndexSchema(modelTasks)),
  modelDate.nullable(),
  enumIndexSchema(modelLifecycles),
  enumIndexSchema(modelReleaseStages),
  z.number().int().nonnegative().nullable(),
  z.number().int().positive().nullable(),
  z.array(nonEmpty),
]);

export const websiteCatalogIndexSchema = z
  .strictObject({
    schema_version: z.literal(4),
    data_version: hash,
    generated_at: z.string().min(1),
    providers: z.array(
      z.strictObject({
        id: z.string().min(1),
        name: z.string().min(1),
        pricing_coverage: z.strictObject({
          representative_models: z.number().int().nonnegative(),
          offer_models: z.number().int().nonnegative(),
          unknown_models: z.number().int().nonnegative(),
          not_applicable_models: z.number().int().nonnegative(),
          standalone_resources: z.number().int().nonnegative(),
          detail_chunks: z.number().int().nonnegative(),
        }),
      }),
    ),
    models: z.array(websiteCatalogIndexModelSchema),
  })
  .superRefine(({ providers, models }, context) => {
    for (const [index, model] of models.entries()) {
      if (model[0] < providers.length) continue;
      context.addIssue({
        code: "custom",
        message: `Model provider index ${model[0]} does not exist`,
        path: ["models", index, 0],
      });
    }
  });

const websitePricingStatusRowSchema = z.tuple([nonEmpty, nonEmpty]);
const websitePricingCellRowSchema = z.tuple([nonEmpty, nonEmpty, nonEmpty]);
const websitePricingSummaryRowSchema = z.tuple([
  z.union([z.literal(0), z.literal(1), z.literal(2)]),
  z.number().int().nonnegative().nullable(),
  z.number().int().nonnegative().nullable(),
  z.number().int().nonnegative().nullable(),
  z.number().int().nonnegative().nullable(),
]);

export const websitePricingSummariesSchema = z
  .strictObject({
    schema_version: z.literal(3),
    data_version: hash,
    statuses: z.array(websitePricingStatusRowSchema),
    cells: z.array(websitePricingCellRowSchema),
    pricing: z.array(websitePricingSummaryRowSchema),
  })
  .superRefine(({ statuses, cells, pricing }, context) => {
    for (const [rowIndex, row] of pricing.entries()) {
      const indexes = [
        [row[1], statuses.length],
        [row[2], cells.length],
        [row[3], cells.length],
        [row[4], cells.length],
      ] as const;
      for (const [columnIndex, [index, length]] of indexes.entries()) {
        if (index === null || index < length) continue;
        context.addIssue({
          code: "custom",
          message: `Pricing dictionary index ${index} does not exist`,
          path: ["pricing", rowIndex, columnIndex + 1],
        });
      }
    }
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
          schedule: recurringTimeScheduleSchema.optional(),
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
  applicability_label: nonEmpty,
  validity: publishedValiditySchema.optional(),
};

const websiteStateRowSchema = z.strictObject({
  key: z.string().min(1),
  state: z.enum(priceStates),
  label: z.string().min(1),
  ...scopeFields,
});

const websiteChargeDriverSchema = z.strictObject({
  label: nonEmpty,
  definition: nonEmpty,
  aggregation: nonEmpty,
  aggregation_definition: nonEmpty.optional(),
  resolution_phase: z.enum(applicabilityResolutionPhases),
});

const websiteRateRowSchema = z.strictObject({
  key: z.string().min(1),
  term_ref: hash,
  label: z.string().min(1),
  amount: z.string().min(1),
  unit: z.string().min(1),
  accessible_text: z.string().min(1),
  driver: websiteChargeDriverSchema.optional(),
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
  drivers: z.array(websiteChargeDriverSchema),
  ...scopeFields,
});

const websiteEnrollmentRowSchema = z.strictObject({
  key: nonEmpty,
  label: nonEmpty,
  ...scopeFields,
});

const websiteSettlementRowSchema = z.strictObject({
  key: nonEmpty,
  channel: nonEmpty,
  biller: nonEmpty,
  payment_sources: z.array(nonEmpty).min(1),
  ...scopeFields,
});

const websiteUnnormalizedRowSchema = z.strictObject({
  key: z.string().min(1),
  label: z.string().min(1),
  impact: z.enum(rawPricingImpacts),
  reason: z.string().min(1),
  details: z.array(nonEmpty).min(1).optional(),
  possible_scope: priceApplicabilitySchema.optional(),
  validity: publishedValiditySchema.optional(),
});

const websiteBillingModeSchema = z.strictObject({
  label: nonEmpty,
  description: nonEmpty.optional(),
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
  mechanism_refs: z.array(hash).min(1).optional(),
  billing_mode: websiteBillingModeSchema,
  composition: z.string().min(1).optional(),
  state_summary: z.string().min(1),
  selectors: z.array(websitePricingSelectorSchema),
  states: z.array(websiteStateRowSchema),
  rates: z.array(websiteRateRowSchema),
  allowances: z.array(websiteAllowanceRowSchema),
  contributions: z.array(websiteContributionRowSchema),
  enrollment: z.array(websiteEnrollmentRowSchema),
  settlement: z.array(websiteSettlementRowSchema),
  unnormalized_count: z.number().int().nonnegative(),
  unnormalized: z.array(websiteUnnormalizedRowSchema),
});

export const websitePricingDetailSchema = z.strictObject({
  snapshot: websitePricingSnapshotSchema.optional(),
  offers: z.array(websitePricingOfferSchema),
});

const websiteOfferReferenceSchema = z.tuple([
  z.number().int().nonnegative(),
  z.number().int().nonnegative(),
]);

export const websiteOfferChunkSchema = z.strictObject({
  schema_version: z.literal(3),
  data_version: hash,
  provider_id: nonEmpty,
  chunk: z.number().int().nonnegative(),
  offers: z.array(websitePricingOfferSchema).min(1),
});

const websiteProviderPricingResourceShape = {
  id: hash,
  title: nonEmpty,
  kind: nonEmpty,
  raw_only: z.boolean(),
};

export const websiteProviderPricingChunkSchema = z.strictObject({
  schema_version: z.literal(3),
  data_version: hash,
  provider_id: nonEmpty,
  chunk: z.number().int().nonnegative(),
  snapshot: websitePricingSnapshotSchema.optional(),
  resources: z.array(
    z.strictObject({
      ...websiteProviderPricingResourceShape,
      offers: z
        .array(
          z.strictObject({
            id: hash,
            title: nonEmpty,
            billing_mode: websiteBillingModeSchema,
            state_summary: nonEmpty,
            offer_refs: z.array(websiteOfferReferenceSchema).min(1),
          }),
        )
        .min(1),
    }),
  ),
});

const websiteModelDetailShape = {
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
  deployment_availability: z
    .array(
      z.strictObject({
        deployment_type: nonEmpty,
        regions: z.array(nonEmpty).min(1),
      }),
    )
    .optional(),
};

export const websiteModelDetailSchema = z.strictObject({
  ...websiteModelDetailShape,
  pricing: websitePricingDetailSchema.optional(),
});

const websiteStoredModelDetailSchema = z.strictObject({
  ...websiteModelDetailShape,
  pricing: z
    .strictObject({
      snapshot: websitePricingSnapshotSchema.optional(),
      offer_refs: z.array(websiteOfferReferenceSchema),
    })
    .optional(),
});

export const websiteDetailChunkSchema = z.strictObject({
  schema_version: z.literal(6),
  data_version: hash,
  provider_id: nonEmpty,
  chunk: z.number().int().nonnegative(),
  details: z.array(websiteStoredModelDetailSchema),
});

export type WebsiteCatalogIndex = z.infer<typeof websiteCatalogIndexSchema>;
export type WebsitePricingSummaries = z.infer<typeof websitePricingSummariesSchema>;
export type WebsitePricingSummary = z.infer<typeof websitePricingSummarySchema>;
export type WebsiteDetailChunk = z.infer<typeof websiteDetailChunkSchema>;
export type WebsiteOfferChunk = z.infer<typeof websiteOfferChunkSchema>;
export type WebsiteOfferReference = z.infer<typeof websiteOfferReferenceSchema>;
export interface WebsiteCatalogIndexModel {
  provider_id: string;
  model_id: string;
  version?: string;
  name: string;
  aliases: string[];
  tasks: (typeof modelTasks)[number][];
  release_date?: string;
  status: (typeof modelLifecycles)[number];
  release_stage: (typeof modelReleaseStages)[number];
  context_tokens?: number;
  detail_chunk: number;
}

export type WebsiteModel = WebsiteCatalogIndexModel & {
  uid: string;
  pricing: WebsitePricingSummary;
};
export type WebsiteCatalog = Omit<WebsiteCatalogIndex, "models" | "schema_version"> & {
  models: WebsiteModel[];
};
export type WebsiteModelDetail = z.infer<typeof websiteModelDetailSchema>;
export type WebsiteStoredModelDetail = z.infer<typeof websiteStoredModelDetailSchema>;
export type WebsitePricingDetail = z.infer<typeof websitePricingDetailSchema>;
export type WebsiteProviderPricingChunk = z.infer<typeof websiteProviderPricingChunkSchema>;
export type WebsiteProviderPricingDetail = WebsiteProviderPricingChunk;
export type WebsiteProviderPricingOffer =
  WebsiteProviderPricingChunk["resources"][number]["offers"][number];
export type WebsiteProvider = WebsiteCatalogIndex["providers"][number];
export type WebsitePricingOffer = z.infer<typeof websitePricingOfferSchema>;
export type WebsitePricingSelector = z.infer<typeof websitePricingSelectorSchema>;
export type WebsitePriceApplicability = z.infer<typeof priceApplicabilitySchema>;
export type WebsitePriceCategoricalValue = z.infer<typeof priceCategoricalValueSchema>;
export type WebsitePriceCondition = z.infer<typeof priceConditionSchema>;
export type WebsitePriceDimension = z.infer<typeof priceDimensionSchema>;
export type WebsitePublishedValidity = z.infer<typeof publishedValiditySchema>;
