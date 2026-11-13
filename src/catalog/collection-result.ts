import { z } from "zod";
import {
  catalogWarningSchema,
  coverageSchema,
  providerModelSchema,
  providerSchema,
  sourceRecordSchema,
} from "./schema.ts";
import { providerRefreshAttemptSchema } from "./refresh-attempt.ts";
import { pricingReplaySourceSchema } from "./pricing-compilation.ts";
import { inferencePriceSourceSchema } from "./inference-pricing-source.ts";
import {
  modelPricingDispositionSchema,
  pricingBookSchema,
  providerPricingSnapshotSchema,
  providerPricingVocabularySchema,
} from "./pricing-schema.ts";
import { pricingRefreshFailureCodes } from "./pricing-vocabulary.ts";

export const providerCollectionResultSchema = z.strictObject({
  provider: providerSchema,
  models: z.array(providerModelSchema),
  sources: z.array(sourceRecordSchema),
  coverage: coverageSchema,
  warnings: z.array(catalogWarningSchema),
  pricing: z
    .strictObject({
      vocabulary: providerPricingVocabularySchema,
      snapshot: providerPricingSnapshotSchema,
      model_dispositions: z.array(modelPricingDispositionSchema),
      books: z.array(pricingBookSchema),
    })
    .optional(),
  pricingReplaySources: z.array(pricingReplaySourceSchema).optional(),
  inferencePriceSources: z.array(inferencePriceSourceSchema).optional(),
  pricingFailure: z.enum(pricingRefreshFailureCodes).optional(),
  quarantine: z
    .object({ provider_id: z.string(), checked_at: z.iso.datetime(), reason: z.string() })
    .optional(),
  attempt: providerRefreshAttemptSchema,
});

export const collectionBatchSchema = z.strictObject({
  results: z.array(providerCollectionResultSchema),
  durations: z.array(
    z.object({ provider_id: z.string(), duration_ms: z.number().int().nonnegative() }),
  ),
  sourceDurations: z.array(
    z.object({
      provider_id: z.string(),
      source_id: z.string(),
      duration_ms: z.number().int().nonnegative(),
    }),
  ),
});

export type ProviderResult = z.infer<typeof providerCollectionResultSchema>;
export type CollectionBatch = z.infer<typeof collectionBatchSchema>;
