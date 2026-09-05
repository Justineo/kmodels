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
      z.strictObject({
        name: z.string(),
        dataset: z.string().optional(),
        data: z.unknown().optional(),
        request: z.unknown().optional(),
        expectedCode: z.enum(errorCodes),
      }),
    )
    .default([]),
});

export type ConformanceSuite = z.infer<typeof conformanceSchema>;
