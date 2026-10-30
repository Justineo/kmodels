import { z } from "zod";
import { invocationCatalogSchema } from "./invocation-schema.ts";
import { catalogEnvelopeSchema } from "./schema.ts";
import { pricingCatalogSchema, pricingCatalogEnvelopeSchema } from "./pricing-schema.ts";

import { invocationPricingBindingSchema } from "./invocation-pricing-schema.ts";
export {
  invocationPricingBindingSchema,
  type InvocationPricingBinding,
} from "./invocation-pricing-schema.ts";

export const catalogV2EnvelopeSchema = catalogEnvelopeSchema
  .extend({
    schema_version: z.literal(2),
    data: catalogEnvelopeSchema.shape.data.extend(invocationCatalogSchema.shape).strict(),
  })
  .strict();

export const pricingV2DataSchema = pricingCatalogSchema.extend({
  invocation_bindings: z.array(invocationPricingBindingSchema).max(200_000),
});

export const pricingV2EnvelopeSchema = pricingCatalogEnvelopeSchema.extend({
  schema_version: z.literal(2),
  data: pricingV2DataSchema,
});

const hash = z.string().regex(/^[0-9a-f]{64}$/);
export const publicationManifestSchema = z.strictObject({
  schema_version: z.literal(1),
  generated_at: z.iso.datetime({ offset: true }),
  pairs: z.tuple([
    z.strictObject({
      schema_version: z.literal(1),
      pair_id: hash,
      catalog_version: hash,
      pricing_data_version: hash,
      catalog_path: z.literal("catalog/index.json"),
      pricing_path: z.literal("pricing/index.json"),
    }),
    z.strictObject({
      schema_version: z.literal(2),
      pair_id: hash,
      catalog_version: hash,
      pricing_data_version: hash,
      catalog_path: z.literal("catalog/v2/index.json"),
      pricing_path: z.literal("pricing/v2/index.json"),
    }),
  ]),
  resources: z.array(z.strictObject({ path: z.string().min(1), sha256: hash })).min(4),
});

export type CatalogV2Envelope = z.infer<typeof catalogV2EnvelopeSchema>;
export type PricingV2Envelope = z.infer<typeof pricingV2EnvelopeSchema>;
export type PublicationManifest = z.infer<typeof publicationManifestSchema>;
