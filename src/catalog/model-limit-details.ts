import { z } from "zod";
import type { Catalog } from "./schema.ts";
import {
  modelClaimGroupSchema,
  modelClaimGroupsSchema,
  type ModelDetailEvidence,
} from "./model-claim-details.ts";

const statementShape = {
  quantity: z.enum(["context_tokens", "output_tokens"]),
  measurement: z.enum(["per_response", "per_hop", "per_interaction", "shared_context"]),
  scope: z.string().min(1).max(768),
};
const tokens = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const limitStatementSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...statementShape, kind: z.literal("maximum"), tokens }),
  z.strictObject({ ...statementShape, kind: z.literal("default"), tokens }),
  z.strictObject({ ...statementShape, kind: z.literal("no_separate_cap") }),
]);

export const limitDetailGroupSchema = modelClaimGroupSchema(limitStatementSchema);
export const limitDetailsSchema = modelClaimGroupsSchema(limitDetailGroupSchema);

export type LimitEvidence = ModelDetailEvidence;
export type LimitStatement = z.infer<typeof limitStatementSchema>;
export type LimitDetailGroup = z.infer<typeof limitDetailGroupSchema>;

export function limitStatementsConflict(left: LimitStatement, right: LimitStatement): boolean {
  if (
    left.quantity !== right.quantity ||
    left.measurement !== right.measurement ||
    left.scope !== right.scope
  )
    return false;
  if (left.kind === "default" || right.kind === "default")
    return left.kind === "default" && right.kind === "default" && left.tokens !== right.tokens;
  if (left.kind === "no_separate_cap" || right.kind === "no_separate_cap")
    return left.kind !== right.kind;
  return left.tokens !== right.tokens;
}

export function validateLimitDetailSources(core: Pick<Catalog, "models" | "sources">): void {
  const sources = new Map(core.sources.map((source) => [source.id, source]));
  for (const model of core.models)
    for (const group of model.limit_details ?? []) {
      const source = sources.get(group.source_ref);
      if (
        !model.source_refs.includes(group.source_ref) ||
        source?.provider_id !== model.provider_id ||
        !source.field_paths.includes("limit_details") ||
        source.role === "inventory"
      )
        throw new Error(`Unowned limit detail source for ${model.uid}: ${group.source_ref}`);
    }
}
