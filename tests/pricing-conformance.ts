import { z } from "zod";
import { calculationEnvelopeSchema, calculationRequestSchema } from "../src/pricing/schema.ts";
import { priceDenominationSchema, rationalSchema } from "../src/catalog/pricing-schema.ts";
import { errorCodes } from "../src/pricing/errors.ts";

export const conformanceSchema = z.strictObject({
  description: z.string(),
  schemaVersion: z.literal("1.0"),
  datasets: z.record(z.string(), calculationEnvelopeSchema),
  cases: z.array(
    z.strictObject({
      name: z.string(),
      dataset: z.string(),
      request: calculationRequestSchema,
      expected: z.strictObject({
        status: z.enum(["calculated", "estimated", "partial", "unknown"]),
        subtotals: z.array(
          z.strictObject({ denomination: priceDenominationSchema, amount: rationalSchema }),
        ),
        unresolvedCodes: z.array(z.string()),
      }),
    }),
  ),
  errors: z
    .array(
      z
        .strictObject({
          name: z.string(),
          dataset: z.string().optional(),
          data: z.unknown().optional(),
          request: z.unknown().optional(),
          expectedCode: z.enum(errorCodes),
        })
        .refine((vector) => (vector.dataset === undefined) !== (vector.data === undefined), {
          message: "Error vectors name exactly one of dataset or data",
        }),
    )
    .default([]),
});

export type ConformanceSuite = z.infer<typeof conformanceSchema>;
export type ConformanceCase = ConformanceSuite["cases"][number];
export type ConformanceError = ConformanceSuite["errors"][number];

export function conformanceDataset(suite: ConformanceSuite, name: string): unknown {
  const dataset = suite.datasets[name];
  if (dataset === undefined) throw new Error(`Unknown conformance dataset: ${name}`);
  return dataset;
}

export function conformanceErrorData(suite: ConformanceSuite, vector: ConformanceError): unknown {
  return vector.dataset === undefined ? vector.data : conformanceDataset(suite, vector.dataset);
}
