import { z } from "zod";
import { invocationCatalogSchema } from "../../catalog/invocation-schema.ts";
import { invocationPricingBindingSchema } from "../../catalog/invocation-pricing-schema.ts";
import { sourceRecordSchema } from "../../catalog/schema.ts";
import { priceCategoricalValueSchema } from "../../catalog/pricing-schema.ts";
import {
  calculationEnvelopeSchema,
  calculationProviderSchema,
  calculationRequestSchema,
  componentSchema,
  selectionRequestSchema,
} from "../schema.ts";

export const calculationSchemaVersion = "2.0";
export const invocationSourceSchema = sourceRecordSchema
  .pick({
    id: true,
    provider_id: true,
    url: true,
    scope: true,
    observed_at: true,
    content_hash: true,
    extractor_version: true,
  })
  .extend({
    scope: sourceRecordSchema.shape.scope.unwrap(),
    content_hash: z.string().regex(/^[0-9a-f]{64}$/),
  });

export const calculationV2ProviderSchema = calculationProviderSchema.extend({
  invocation: invocationCatalogSchema,
  invocation_sources: z.array(invocationSourceSchema).max(100_000),
  invocation_bindings: z.array(invocationPricingBindingSchema).max(200_000),
});

export const calculationV2EnvelopeSchema = calculationEnvelopeSchema.extend({
  schemaVersion: z.literal(calculationSchemaVersion),
  snapshot: calculationEnvelopeSchema.shape.snapshot.extend({
    coreDataSha256: z.string().regex(/^[0-9a-f]{64}$/),
    pricingAssetSha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  providers: z.array(calculationV2ProviderSchema).min(1).max(256),
});

export type CalculationV2Envelope = z.infer<typeof calculationV2EnvelopeSchema>;
export type CalculationV2Provider = z.infer<typeof calculationV2ProviderSchema>;

const reference = z.string().min(1).max(512);
const values = z
  .record(reference, priceCategoricalValueSchema)
  .refine((record) => Object.keys(record).length <= 64);
export const invocationSelectionSchema = z.strictObject({
  targetRef: reference,
  caseRef: reference,
  inputs: values.default({}),
  observed: values.default({}),
});
export const selectionV2RequestSchema = selectionRequestSchema.extend({
  invocation: invocationSelectionSchema.optional(),
});
export const componentV2Schema = componentSchema.extend({
  invocation: invocationSelectionSchema.optional(),
});
export const calculationV2RequestSchema = calculationRequestSchema.extend({
  components: z.array(componentV2Schema).min(1).max(1024),
});

export type InvocationSelection = z.input<typeof invocationSelectionSchema>;
export type SelectionV2Request = z.input<typeof selectionV2RequestSchema>;
export type CalculationV2Request = z.input<typeof calculationV2RequestSchema>;
export type CalculationV2Component = z.input<typeof componentV2Schema>;
