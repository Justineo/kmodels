import { z } from "zod";
import {
  legacyWebsiteClaimDetailsSchema,
  modelClaimGroupSchema,
  modelClaimGroupsSchema,
  websiteClaimGroupSchema,
} from "./model-claim-details.ts";

const scope = z
  .string()
  .min(1)
  .max(768)
  .refine((value) => value.trim().length > 0);
export const triStateSchema = z.union([z.boolean(), z.literal("unknown")]);
export const modelCapabilitiesSchema = z.object({
  reasoning: triStateSchema,
  tool_call: triStateSchema,
  structured_output: triStateSchema,
  streaming: triStateSchema,
  batch: triStateSchema,
  prompt_cache: triStateSchema,
  fine_tuning: triStateSchema,
  citations: triStateSchema.default("unknown"),
  code_execution: triStateSchema.default("unknown"),
  context_management: triStateSchema.default("unknown"),
  effort_control: triStateSchema.default("unknown"),
  computer_use: triStateSchema.default("unknown"),
});
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

const applicability = z
  .strictObject({
    interface: scope.max(128),
    parameter: scope
      .max(128)
      .refine((value) => value.trim() === value)
      .optional(),
    condition: scope.optional(),
    /** Native route path in the provider's `api_endpoints` format, from the claim's own source. */
    endpoint: scope
      .max(256)
      .refine((value) => value.trim() === value)
      .optional(),
  })
  .optional();

const reasoningEffortSchema = z
  .strictObject({
    kind: z.literal("reasoning_effort"),
    scope,
    applicability,
    supported_values: nativeValues.optional(),
    default_value: nativeValue.optional(),
  })
  .refine(
    ({ supported_values, default_value }) =>
      supported_values !== undefined || default_value !== undefined,
    "An effort statement must report documented levels or a default",
  );

export const scopedCapabilitySchema = z.strictObject({
  kind: z.literal("capability_support"),
  capability: modelCapabilitiesSchema.keyof(),
  scope,
  applicability: applicability.unwrap(),
  supported: z.boolean(),
});
export const capabilityStatementSchema = z.discriminatedUnion("kind", [
  scopedCapabilitySchema,
  z.strictObject({
    kind: z.literal("prompt_cache"),
    scope,
    applicability,
    // Only a documented, usable mode is recorded; an unsupported mode stays absent.
    mode: z.enum(["implicit", "explicit"]),
  }),
  reasoningEffortSchema,
]);
export const capabilityDetailGroupSchema = modelClaimGroupSchema(capabilityStatementSchema);
export const capabilityDetailsSchema = modelClaimGroupsSchema(capabilityDetailGroupSchema, 10);
const websiteCapabilityDetailGroupSchema = websiteClaimGroupSchema(capabilityStatementSchema);
export const websiteCapabilityDetailsSchema = z.array(websiteCapabilityDetailGroupSchema).max(10);
export const legacyWebsiteCapabilityDetailsSchema = legacyWebsiteClaimDetailsSchema(
  capabilityStatementSchema,
  10,
);

export type CapabilityStatement = z.infer<typeof capabilityStatementSchema>;
export type CapabilityDetailGroup = z.infer<typeof capabilityDetailGroupSchema>;
export type WebsiteCapabilityDetailGroup = z.infer<typeof websiteCapabilityDetailGroupSchema>;

export function hasStructuredCapabilityDetails(
  groups: readonly Pick<CapabilityDetailGroup, "statements">[] | undefined,
): boolean {
  return (
    groups?.some(({ statements }) => statements.some((s) => s.applicability !== undefined)) ?? false
  );
}

export { capabilityStatementsConflict } from "./model-claim-helpers.ts";
