import { z } from "zod";
import type { ParsedProviderModel } from "./pricing-source.ts";

export const pricingReconciliationDispositions = [
  "normalized",
  "raw",
  "explicit_non_numeric",
  "excluded",
  "unbound",
  "ambiguous",
  "unsupported",
  "unresolved",
] as const;

const pricingReconciliationProblemSchema = z.enum([
  "unbound",
  "ambiguous",
  "unsupported",
  "unresolved",
]);
const pricingReconciliationReasonCodeSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);

export const pricingReconciliationItemSchema = z.strictObject({
  disposition: z.enum(pricingReconciliationDispositions),
  reason_code: pricingReconciliationReasonCodeSchema,
  sample: z.string().min(1).max(256).optional(),
});

const dispositionCountsSchema = z.strictObject({
  normalized: z.number().int().nonnegative(),
  raw: z.number().int().nonnegative(),
  explicit_non_numeric: z.number().int().nonnegative(),
  excluded: z.number().int().nonnegative(),
  unbound: z.number().int().nonnegative(),
  ambiguous: z.number().int().nonnegative(),
  unsupported: z.number().int().nonnegative(),
  unresolved: z.number().int().nonnegative(),
});

const reasonCountsSchema = z
  .record(pricingReconciliationReasonCodeSchema, z.number().int().positive())
  .refine((counts) => Object.keys(counts).length <= 64, {
    message: "Pricing reconciliation has too many reason codes",
  });

export const sourcePricingReconciliationSchema = z
  .strictObject({
    basis: z.enum(["source_item", "model_output"]),
    unit: z.string().min(1).max(96),
    observed_items: z.number().int().nonnegative(),
    disposition_counts: dispositionCountsSchema,
    reason_counts: reasonCountsSchema.optional(),
    diagnostic_count: z.number().int().nonnegative(),
    diagnostics: z
      .array(
        z.strictObject({
          disposition: pricingReconciliationProblemSchema,
          reason_code: pricingReconciliationReasonCodeSchema,
          sample: z.string().min(1).max(256).optional(),
        }),
      )
      .max(8),
  })
  .superRefine((value, context) => {
    const total = Object.values(value.disposition_counts).reduce((sum, count) => sum + count, 0);
    if (total !== value.observed_items)
      context.addIssue({
        code: "custom",
        path: ["observed_items"],
        message: "Pricing reconciliation dispositions must partition observed items",
      });
    if (
      value.reason_counts !== undefined &&
      Object.values(value.reason_counts).reduce((sum, count) => sum + count, 0) !==
        value.observed_items
    )
      context.addIssue({
        code: "custom",
        path: ["reason_counts"],
        message: "Pricing reconciliation reasons must partition observed items",
      });
    const problemCount =
      value.disposition_counts.unbound +
      value.disposition_counts.ambiguous +
      value.disposition_counts.unsupported +
      value.disposition_counts.unresolved;
    if (problemCount !== value.diagnostic_count)
      context.addIssue({
        code: "custom",
        path: ["diagnostic_count"],
        message: "Pricing reconciliation diagnostic count must equal unresolved dispositions",
      });
  });

export type PricingReconciliationItem = z.infer<typeof pricingReconciliationItemSchema>;
export type SourcePricingReconciliation = z.infer<typeof sourcePricingReconciliationSchema>;

export const sourcePricingExtractionSchema = z.strictObject({
  model_records: z.number().int().nonnegative(),
  numeric_models: z.number().int().nonnegative(),
  raw_models: z.number().int().nonnegative(),
  free_models: z.number().int().nonnegative(),
  custom_quote_models: z.number().int().nonnegative(),
  not_published_models: z.number().int().nonnegative(),
  not_applicable_models: z.number().int().nonnegative(),
  unknown_models: z.number().int().nonnegative(),
  normalized_facts: z.number().int().nonnegative(),
  raw_facts: z.number().int().nonnegative(),
});

export type SourcePricingExtraction = z.infer<typeof sourcePricingExtractionSchema>;

function emptyDispositionCounts(): SourcePricingReconciliation["disposition_counts"] {
  return {
    normalized: 0,
    raw: 0,
    explicit_non_numeric: 0,
    excluded: 0,
    unbound: 0,
    ambiguous: 0,
    unsupported: 0,
    unresolved: 0,
  };
}

function modelOutputItem(model: ParsedProviderModel): PricingReconciliationItem {
  if (model.price_facts.length > 0)
    return { disposition: "normalized", reason_code: "normalized_price_facts" };
  if (model.raw_price_facts.length > 0)
    return { disposition: "raw", reason_code: "preserved_raw_facts" };
  if (model.pricing_state !== "unknown")
    return { disposition: "explicit_non_numeric", reason_code: model.pricing_state };
  return {
    disposition: "unresolved",
    reason_code: "parser_output_unknown",
    sample: model.model_id,
  };
}

export function sourcePricingReconciliation(
  models: readonly ParsedProviderModel[],
  sourceItems: readonly PricingReconciliationItem[],
  allowSamples: boolean,
): SourcePricingReconciliation {
  const basis = sourceItems.length > 0 ? "source_item" : "model_output";
  const items = (sourceItems.length > 0 ? sourceItems : models.map(modelOutputItem)).map((item) =>
    pricingReconciliationItemSchema.parse(item),
  );
  const dispositionCounts = emptyDispositionCounts();
  const reasonCounts: Record<string, number> = {};
  for (const { disposition, reason_code } of items) {
    dispositionCounts[disposition] += 1;
    reasonCounts[reason_code] = (reasonCounts[reason_code] ?? 0) + 1;
  }
  const problems = items.filter(
    ({ disposition }) => pricingReconciliationProblemSchema.safeParse(disposition).success,
  );
  return sourcePricingReconciliationSchema.parse({
    basis,
    unit: basis === "source_item" ? "reviewed source pricing item" : "parsed model record",
    observed_items: items.length,
    disposition_counts: dispositionCounts,
    reason_counts: reasonCounts,
    diagnostic_count: problems.length,
    diagnostics: problems.slice(0, 8).map(({ disposition, reason_code, sample }) => ({
      disposition,
      reason_code,
      ...(allowSamples && sample !== undefined ? { sample } : {}),
    })),
  });
}

export function sourcePricingExtraction(
  models: readonly ParsedProviderModel[],
): SourcePricingExtraction {
  const stateCount = (state: ParsedProviderModel["pricing_state"]): number =>
    models.filter(({ pricing_state: value }) => value === state).length;
  return sourcePricingExtractionSchema.parse({
    model_records: models.length,
    numeric_models: stateCount("numeric"),
    raw_models: models.filter(({ raw_price_facts }) => raw_price_facts.length > 0).length,
    free_models: stateCount("free"),
    custom_quote_models: stateCount("custom_quote"),
    not_published_models: stateCount("not_published"),
    not_applicable_models: stateCount("not_applicable"),
    unknown_models: stateCount("unknown"),
    normalized_facts: models.reduce((count, { price_facts }) => count + price_facts.length, 0),
    raw_facts: models.reduce((count, { raw_price_facts }) => count + raw_price_facts.length, 0),
  });
}
