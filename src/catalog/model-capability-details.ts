import { z } from "zod";
import { modelClaimGroupSchema, modelClaimGroupsSchema } from "./model-claim-details.ts";

const scope = z
  .string()
  .min(1)
  .max(768)
  .refine((value) => value.trim().length > 0);
const nativeValue = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => value.trim() === value);
const nativeValues = z
  .array(nativeValue)
  .min(1)
  .max(16)
  .refine((values) => new Set(values).size === values.length, "Duplicate native effort value");

const reasoningEffortSchema = z
  .strictObject({
    kind: z.literal("reasoning_effort"),
    scope,
    supported_values: nativeValues.optional(),
    unsupported_values: nativeValues.optional(),
    default_value: nativeValue.optional(),
  })
  .superRefine(({ supported_values, unsupported_values, default_value }, context) => {
    if (
      supported_values === undefined &&
      unsupported_values === undefined &&
      default_value === undefined
    )
      context.addIssue({
        code: "custom",
        message: "An effort statement must report a documented fact",
      });
    if (
      unsupported_values?.some(
        (value) => supported_values?.includes(value) || default_value === value,
      )
    )
      context.addIssue({ code: "custom", message: "Contradictory native effort values" });
  });

export const capabilityStatementSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("prompt_cache"),
    scope,
    mode: z.enum(["implicit", "explicit"]),
    supported: z.boolean(),
  }),
  reasoningEffortSchema,
]);

export const capabilityDetailGroupSchema = modelClaimGroupSchema(capabilityStatementSchema);
export const capabilityDetailsSchema = modelClaimGroupsSchema(capabilityDetailGroupSchema);

export type CapabilityStatement = z.infer<typeof capabilityStatementSchema>;
export type CapabilityDetailGroup = z.infer<typeof capabilityDetailGroupSchema>;
