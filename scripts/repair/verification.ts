import { z } from "zod";
import { digest } from "./state.ts";
import { parseRepairOutcome, type RepairOutcome } from "../catalog-repair-publication.ts";

const takeoverResponse = z.object({
  type: z.enum(["commit_repair", "noop", "report_incomplete"]),
  summary: z.string().min(1).max(8000),
  body: z.string().max(30000),
});
export const takeoverOutputSchema = z.toJSONSchema(takeoverResponse);
export function readTakeoverResponse(
  text: string,
): RepairOutcome | { type: "report_incomplete"; reason: string } {
  const { type, summary, body } = takeoverResponse.parse(JSON.parse(text));
  if (type === "report_incomplete") return { type, reason: summary };
  return parseRepairOutcome(
    JSON.stringify(type === "noop" ? { type, message: summary } : { type, title: summary, body }),
  );
}

const explanation = z.string().min(10).max(8000);
const reference = z.object({
  path: z.string().max(1000),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export const proposalReviewSchema = z
  .object({
    admission_sha256: z.string(),
    candidates: z.array(
      z
        .object({
          id: z.string(),
          status: z.enum(["pending", "blocked", "repaired", "not_a_defect"]),
          reason: z.string(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
export const verificationSchema = z.object({
  candidates: z
    .array(
      z.object({
        id: z.string(),
        verdict: z.enum(["supported", "concrete_error", "insufficient_evidence"]),
        reason: explanation,
        expected: z.string().max(8000),
        actual: z.string().max(8000),
        evidence: z
          .array(reference)
          .max(20)
          .describe(
            "Hash original evidence files under /tmp/gh-aw/agent/. Session inputs may corroborate them.",
          ),
        checks: z
          .array(z.object({ kind: z.enum(["consumer", "counterexample"]), output: reference }))
          .max(10)
          .describe("Cite command receipts under /tmp/gh-aw/agent/."),
      }),
    )
    .max(100),
});
export type Verification = z.infer<typeof verificationSchema>;
// Operational leads only. Partial rows cannot be supplied to the publication decision.
export const progressSchema = z.object({
  candidates: z.array(z.object({ id: z.string().max(300), next_action: explanation })).max(100),
});
export function closedCandidates(review: unknown): string[] {
  return proposalReviewSchema
    .parse(review)
    .candidates.filter((row) => ["repaired", "not_a_defect"].includes(row.status))
    .map((row) => row.id);
}

// Session inputs are immutable context. Only independently gathered evidence follows the
// report into a later job, where these session-specific mounts no longer exist.
export async function checkSessionVerification(
  text: string,
  ids: readonly string[],
  inputs: ReadonlyMap<string, string>,
  read: (path: string) => Promise<string>,
): Promise<Verification> {
  const report = verificationSchema.parse(JSON.parse(text));
  for (const row of report.candidates) {
    row.evidence = row.evidence.filter((ref) => {
      const input = inputs.get(ref.path);
      if (input === undefined) return true;
      if (digest(input) !== ref.sha256) throw new Error("Verifier cited a changed session input");
      return false;
    });
  }
  return checkVerification(report, ids, (path) => {
    const prefix = "/tmp/gh-aw/agent/";
    if (
      !path.startsWith(prefix) ||
      path
        .slice(prefix.length)
        .split("/")
        .some((part) => !part || part === "." || part === "..")
    )
      throw new Error("Verification receipts must be files in the evidence directory");
    return read(path);
  });
}
export async function checkVerification(
  input: unknown,
  expectedIds: readonly string[],
  read: (path: string) => Promise<string>,
): Promise<Verification> {
  const report = verificationSchema.parse(input);
  const ids = report.candidates.map((row) => row.id);
  if (
    new Set(ids).size !== ids.length ||
    JSON.stringify([...ids].sort()) !== JSON.stringify([...expectedIds].sort())
  )
    throw new Error("Independent verification must cover every closed candidate exactly once");
  for (const row of report.candidates) {
    for (const ref of [...row.evidence, ...row.checks.map((check) => check.output)])
      if (digest(await read(ref.path)) !== ref.sha256)
        throw new Error("Independent verification evidence changed");
    if (row.verdict !== "insufficient_evidence" && row.evidence.length === 0)
      throw new Error("A verified conclusion requires original evidence");
    if (
      row.verdict === "concrete_error" &&
      (row.expected.trim().length < 10 ||
        row.actual.trim().length < 10 ||
        row.expected === row.actual)
    )
      throw new Error("Takeover requires a concrete expected/actual contradiction");
    if (row.verdict === "supported") {
      for (const kind of ["consumer", "counterexample"] as const) {
        const checks = row.checks.filter((check) => check.kind === kind);
        if (!checks.length) throw new Error(`Supported conclusion needs ${kind} proof`);
        for (const check of checks) {
          const receipt = z
            .object({ schema_version: z.literal(1), command: z.string(), exit_code: z.literal(0) })
            .parse(JSON.parse(await read(check.output.path)));
          if (/(?:fetch|replay)-catalog-evidence\.ts|codex-tools\.ts\s+fetch/.test(receipt.command))
            throw new Error("Source acquisition or parser-only replay is not consumer proof");
        }
      }
    }
  }
  return report;
}
export function verificationVerdict(
  report: Verification,
): "supported" | "concrete_error" | "insufficient_evidence" {
  if (report.candidates.some((row) => row.verdict === "concrete_error")) return "concrete_error";
  return report.candidates.every((row) => row.verdict === "supported")
    ? "supported"
    : "insufficient_evidence";
}

export const verificationOutputSchema = z.toJSONSchema(verificationSchema);

export async function checkTakeoverCheckpoint(options: {
  decision: unknown;
  report: unknown;
  admission: string;
  review: string;
  patch: string;
  read: (path: string) => Promise<string>;
}): Promise<Verification> {
  z.object({
    verdict: z.literal("concrete_error"),
    takeover_attempted: z.literal(false),
    admission_sha256: z.literal(digest(options.admission)),
    review_sha256: z.literal(digest(options.review)),
    patch_sha256: z.literal(digest(options.patch)),
  }).parse(options.decision);
  const report = await checkVerification(
    options.report,
    closedCandidates(JSON.parse(options.review)),
    options.read,
  );
  if (verificationVerdict(report) !== "concrete_error")
    throw new Error("Additional budget requires a verified concrete error");
  return report;
}
