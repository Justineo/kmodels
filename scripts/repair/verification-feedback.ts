import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { progressSchema, verificationSchema } from "./verification.ts";

// Operational leads only. Publication still requires a complete, verified report.
export async function verificationFeedback(directory: string) {
  const notes = new Map<string, string>();
  const initialErrors = new Set<string>();
  let interrupted: string | undefined;
  for (const [artifact, label] of [
    ["catalog-maintenance-initial", "initial"],
    ["catalog-maintenance-review", "revised"],
  ] as const) {
    const read = async (name: string): Promise<unknown> => {
      try {
        return JSON.parse(await readFile(join(directory, artifact, name), "utf8"));
      } catch {
        return undefined;
      }
    };
    const progress = progressSchema.safeParse(await read("progress.json"));
    for (const row of progress.data?.candidates ?? [])
      notes.set(row.id, [notes.get(row.id), row.next_action].filter(Boolean).join("\n"));
    const report = verificationSchema.safeParse(await read(`${label}-verification.json`));
    for (const row of report.data?.candidates ?? []) {
      if (label === "initial" && row.verdict === "concrete_error") initialErrors.add(row.id);
      if (row.verdict === "supported") notes.delete(row.id);
      else
        notes.set(
          row.id,
          [
            row.reason,
            row.expected && `Expected: ${row.expected}`,
            row.actual && `Observed: ${row.actual}`,
          ]
            .filter(Boolean)
            .join("\n"),
        );
    }
    const interruption = z
      .object({
        session: z.enum(["independent", "verify", "takeover"]),
        reason: z.string().max(8000).optional(),
      })
      .safeParse(await read("interruption.json"));
    if (interruption.success)
      interrupted = [
        `The ${interruption.data.session} session was interrupted. Inspect ${artifact}/sessions and its saved evidence.`,
        interruption.data.reason,
      ]
        .filter(Boolean)
        .join(" ");
  }
  return {
    initialErrors,
    nextAction: (id: string) => [notes.get(id), interrupted].filter(Boolean).join("\n"),
  };
}
