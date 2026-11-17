import { z } from "zod";
import type { Catalog, ProviderModel } from "./schema.ts";

export const modelClaimFields = ["limit_details", "capability_details"] as const;
export type ModelClaimField = (typeof modelClaimFields)[number];

const documentEvidenceSchema = z.strictObject({
  document_url: z
    .url()
    .max(1024)
    .refine((value) => {
      if (!URL.canParse(value)) return false;
      const url = new URL(value);
      return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
    }, "Detail evidence must use an HTTP URL without credentials"),
  locator: z.string().min(1).max(512),
  observed_at: z.iso.datetime({ offset: true }),
  content_hash: z.string().regex(/^[0-9a-f]{64}$/),
  excerpt: z.string().min(1).max(2048),
});

export type ModelDetailEvidence = z.infer<typeof documentEvidenceSchema>;
export interface ModelClaimGroup {
  source_ref: string;
  claim: string;
  statements: readonly unknown[];
  evidence: readonly ModelDetailEvidence[];
}

export function hasClaimStatements(groups: readonly ModelClaimGroup[] | undefined): boolean {
  return groups?.some(({ statements }) => statements.length > 0) ?? false;
}

export function filterModelClaims(
  model: ProviderModel,
  includes: (field: ModelClaimField, group: ModelClaimGroup) => boolean,
): Pick<ProviderModel, ModelClaimField> {
  const limitDetails = model.limit_details?.filter((group) => includes("limit_details", group));
  const capabilityDetails = model.capability_details?.filter((group) =>
    includes("capability_details", group),
  );
  return {
    limit_details: limitDetails?.length ? limitDetails : undefined,
    capability_details: capabilityDetails?.length ? capabilityDetails : undefined,
  };
}

export function validateModelDetailSources(core: Pick<Catalog, "models" | "sources">): void {
  const sources = new Map(core.sources.map((source) => [source.id, source]));
  for (const model of core.models)
    for (const field of modelClaimFields)
      for (const { source_ref } of model[field] ?? []) {
        const source = sources.get(source_ref);
        if (
          !model.source_refs.includes(source_ref) ||
          source?.provider_id !== model.provider_id ||
          !source.field_paths.includes(field) ||
          source.role === "inventory"
        ) {
          const subject = field === "limit_details" ? "limit" : "capability";
          throw new Error(`Unowned ${subject} detail source for ${model.uid}: ${source_ref}`);
        }
      }
}

export function modelClaimGroupSchema<Statement extends z.ZodType>(statement: Statement) {
  return z.strictObject({
    source_ref: z.string().min(1).max(128),
    claim: z.string().min(1).max(128),
    // An evidenced empty observation withdraws this claim; omission does not.
    statements: z.array(statement).max(16),
    evidence: z.array(documentEvidenceSchema).min(1).max(3),
  });
}

export function modelClaimGroupsSchema<
  Group extends z.ZodType<{ source_ref: string; claim: string }>,
>(group: Group) {
  return z
    .array(group)
    .max(8)
    .superRefine((groups, context) => {
      const keys = new Set<string>();
      for (const [index, { source_ref, claim }] of groups.entries()) {
        const key = JSON.stringify([source_ref, claim]);
        if (keys.has(key))
          context.addIssue({
            code: "custom",
            path: [index],
            message: "Duplicate detail source/claim",
          });
        keys.add(key);
      }
      if (new TextEncoder().encode(JSON.stringify(groups)).byteLength > 16 * 1024)
        context.addIssue({ code: "custom", message: "Details exceed 16 KiB" });
    });
}
