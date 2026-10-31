import { z } from "zod";
import { inferencePriceRuleSchema } from "../pricing/inference-schema.ts";
import { pricingSourceRecordSchema } from "./pricing-schema.ts";
import type { ParsedPricingSource } from "./pricing-adapter.ts";
import type { SourceRecord } from "./schema.ts";

// Provider parsers name a reviewed commercial offer; assembly resolves its canonical references.
export const sourceInferencePriceSchema = inferencePriceRuleSchema
  .omit({ provider_id: true, offer_refs: true })
  .extend({ offer_key: z.string().min(1), source_ref: z.string().min(1) });

export const inferencePriceSourceSchema = z
  .strictObject({
    record: pricingSourceRecordSchema.extend({ provider_id: z.string().min(1) }),
    rules: z.array(sourceInferencePriceSchema),
  })
  .superRefine(({ record, rules }, context) => {
    if (
      rules.some(
        (rule) =>
          rule.source_ref !== record.id ||
          rule.evidence.some(({ source_ref }) => source_ref !== record.id),
      )
    )
      context.addIssue({
        code: "custom",
        message: "Inference price evidence must belong to its captured source",
      });
  });

export type InferencePriceSource = z.infer<typeof inferencePriceSourceSchema>;

export function captureInferencePriceSources(
  inputs: readonly ParsedPricingSource[],
  records: readonly SourceRecord[],
): InferencePriceSource[] {
  return inputs.flatMap(({ source, inference_prices }) => {
    if (inference_prices === undefined || source.access !== "public" || source.auth !== undefined)
      return [];
    const record = records.find(({ id }) => id === source.id);
    if (record === undefined) throw new Error(`Missing inference price source ${source.id}`);
    return [
      inferencePriceSourceSchema.parse({
        record: {
          id: record.id,
          url: record.url,
          observed_at: record.observed_at,
          content_hash: record.content_hash,
          extractor_version: record.extractor_version,
          provider_id: record.provider_id,
        },
        rules: inference_prices,
      }),
    ];
  });
}
