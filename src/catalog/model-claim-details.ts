import { z } from "zod";

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
