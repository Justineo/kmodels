import { z } from "zod";
import type { Catalog } from "./schema.ts";

export const limitEvidenceSchema = z.strictObject({
  document_url: z
    .url()
    .max(1024)
    .refine((value) => {
      if (!URL.canParse(value)) return false;
      const url = new URL(value);
      return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
    }, "Limit evidence must use an HTTP URL without credentials"),
  locator: z.string().min(1).max(512),
  observed_at: z.iso.datetime({ offset: true }),
  content_hash: z.string().regex(/^[0-9a-f]{64}$/),
  excerpt: z.string().min(1).max(2048),
});

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

export const limitDetailGroupSchema = z.strictObject({
  source_ref: z.string().min(1).max(128),
  claim: z.string().min(1).max(128),
  // An evidenced empty observation withdraws this claim; omission does not.
  statements: z.array(limitStatementSchema).max(16),
  evidence: z.array(limitEvidenceSchema).min(1).max(3),
});

export const limitDetailsSchema = z
  .array(limitDetailGroupSchema)
  .max(8)
  .superRefine((groups, context) => {
    const keys = new Set<string>();
    for (const [index, group] of groups.entries()) {
      const key = JSON.stringify([group.source_ref, group.claim]);
      if (keys.has(key)) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: "Duplicate limit detail source/claim",
        });
      }
      keys.add(key);
    }
    if (new TextEncoder().encode(JSON.stringify(groups)).byteLength > 16 * 1024) {
      context.addIssue({ code: "custom", message: "Limit details exceed 16 KiB" });
    }
  });

export type LimitEvidence = z.infer<typeof limitEvidenceSchema>;
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
