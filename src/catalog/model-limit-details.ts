import { z } from "zod";
import {
  legacyWebsiteClaimDetailsSchema,
  modelClaimGroupSchema,
  modelClaimGroupsSchema,
  websiteClaimGroupSchema,
} from "./model-claim-details.ts";

const statementShape = {
  quantity: z.enum(["context_tokens", "output_tokens", "text_output_tokens"]),
  measurement: z.enum(["per_response", "per_hop", "per_interaction", "shared_context"]),
  scope: z.string().min(1).max(768),
  account_tier: z.string().min(1).max(128).optional(),
  applicability: z
    .strictObject({
      endpoint: z.string().min(1).max(256),
      beta_header: z
        .strictObject({
          name: z
            .string()
            .regex(/^[a-z0-9-]+$/)
            .max(64),
          value: z
            .string()
            .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
            .max(128),
          present: z.boolean(),
        })
        .optional(),
    })
    .optional(),
};
const tokens = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const limitStatementSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...statementShape, kind: z.literal("maximum"), tokens }),
  z.strictObject({
    ...statementShape,
    kind: z.literal("published_maximum_label"),
    label: z.string().min(1).max(64),
  }),
  z.strictObject({ ...statementShape, kind: z.literal("default"), tokens }),
  z.strictObject({ ...statementShape, kind: z.literal("no_separate_cap") }),
]);

export const limitDetailGroupSchema = modelClaimGroupSchema(limitStatementSchema);
export const limitDetailsSchema = modelClaimGroupsSchema(limitDetailGroupSchema, 8);
const websiteLimitDetailGroupSchema = websiteClaimGroupSchema(limitStatementSchema);
export const websiteLimitDetailsSchema = z.array(websiteLimitDetailGroupSchema).max(8);
export const legacyWebsiteLimitDetailsSchema = legacyWebsiteClaimDetailsSchema(
  limitStatementSchema,
  8,
);

export type LimitStatement = z.infer<typeof limitStatementSchema>;
export type LimitDetailGroup = z.infer<typeof limitDetailGroupSchema>;
export type WebsiteLimitDetailGroup = z.infer<typeof websiteLimitDetailGroupSchema>;

export function limitScopeKey({ applicability, scope, account_tier }: LimitStatement): string {
  if (account_tier) return JSON.stringify([account_tier, applicability ?? null]);
  if (applicability === undefined) return scope;
  const { endpoint, beta_header: beta } = applicability;
  return JSON.stringify([endpoint, beta?.name, beta?.value, beta?.present]);
}

export function limitStatementsConflict(left: LimitStatement, right: LimitStatement): boolean {
  if (
    left.quantity !== right.quantity ||
    left.measurement !== right.measurement ||
    limitScopeKey(left) !== limitScopeKey(right)
  )
    return false;
  if (left.kind === "default" || right.kind === "default")
    return left.kind === "default" && right.kind === "default" && left.tokens !== right.tokens;
  if (left.kind === "no_separate_cap" || right.kind === "no_separate_cap")
    return left.kind !== right.kind;
  if (left.kind === "published_maximum_label" || right.kind === "published_maximum_label")
    return (
      left.kind === "published_maximum_label" &&
      right.kind === "published_maximum_label" &&
      left.label !== right.label
    );
  return left.tokens !== right.tokens;
}

export { validateModelDetailSources as validateLimitDetailSources } from "./model-claim-details.ts";
