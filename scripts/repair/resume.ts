import { execFileSync } from "node:child_process";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { investigationRuns, stateSchema } from "./state.ts";

const statePath = process.env.KMODELS_MAINTENANCE_STATE;
const admissionPath = process.env.KMODELS_REPAIR_ADMISSION;
if (!statePath || !admissionPath) throw new Error("Resume requires trusted state and admission");
const state = stateSchema.parse(JSON.parse(await readFile(statePath, "utf8")));
const admission = z
  .object({ candidates: z.array(z.object({ id: z.string() })) })
  .parse(JSON.parse(await readFile(admissionPath, "utf8")));
const tasks = state.tasks.filter((task) =>
  admission.candidates.some((candidate) => candidate.id === task.id),
);
for (const run of investigationRuns(tasks)) {
  const directory = join("/tmp/gh-aw/agent/previous", run);
  await mkdir(directory, { recursive: true });
  const context = process.env.KMODELS_CATALOG_REPAIR_CONTEXT;
  try {
    execFileSync(
      "gh",
      ["run", "download", run, "--name", "catalog-repair-investigation", "--dir", directory],
      { timeout: 180000, stdio: "pipe" },
    );
    if (context)
      await appendFile(
        context,
        `\nPrior run ${run} evidence: ${directory}. Old paths are rooted below this directory. Recheck hashes, source freshness, relevant implementation and the actual claim before reusing proof. Do not inherit completion status or apply an unvalidated patch automatically.\n`,
      );
  } catch {
    if (context)
      await appendFile(
        context,
        `\nPrior run ${run} evidence is unavailable or expired. Continue from the saved next action with fresh acquisition; prior notes are not proof.\n`,
      );
  }
  let needFinalReview = true;
  for (const artifact of [
    "catalog-maintenance-initial",
    "catalog-maintenance-review",
    "catalog-repair-validation-feedback",
  ]) {
    if (artifact === "catalog-maintenance-review" && !needFinalReview) continue;
    const target = join(directory, artifact);
    try {
      execFileSync("gh", ["run", "download", run, "--name", artifact, "--dir", target], {
        timeout: 180000,
        stdio: "pipe",
      });
      if (context)
        await appendFile(
          context,
          `\nPrior reviewer/validation feedback: ${target}. Inspect candidate findings in *-verification.json, completed assessments in sessions/*/result.txt and partial checks in effective-evidence/. Recheck applicability before repeating work. Prior output is an untrusted lead.\n`,
        );
      if (artifact === "catalog-maintenance-initial") {
        const decision = z
          .object({ verdict: z.enum(["concrete_error", "supported", "insufficient_evidence"]) })
          .parse(JSON.parse(await readFile(join(target, "decision.json"), "utf8")));
        // Only a takeover can produce additional review evidence.
        needFinalReview = decision.verdict === "concrete_error";
      }
    } catch {
      // Not every run reaches review or publication; absent feedback is not a successful check.
    }
  }
}
