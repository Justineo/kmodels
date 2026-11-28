import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { sha256 } from "../../src/catalog/io.ts";
import { parsePatchPaths, runSelfHealGate } from "./gate.ts";
import { proposalSchema } from "./generate.ts";
import { assertOutsideRepo, parseCliFlag, runGit } from "./runtime.ts";
import { readActionableTriage } from "./triage.ts";

export const verificationReceiptSchema = z.strictObject({
  version: z.literal(1),
  ok: z.boolean(),
  mode: z.enum(["auto_push", "draft_pr", "rejected"]),
  base_sha: z.string().regex(/^[0-9a-f]{40}$/),
  provider_id: z.string().min(1),
  trigger_run_id: z.string().min(1).optional(),
  trigger_run_attempt: z.number().int().positive().optional(),
  patch_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  changed_files: z.array(z.string().min(1)),
  protected_files: z.array(z.string().min(1)),
  replayed_sources: z.array(z.string().min(1)),
  violations: z.array(z.string()),
  verification_blocked: z.literal(true).optional(),
  verified_at: z.string().min(1),
});

export type VerificationReceipt = z.infer<typeof verificationReceiptSchema>;

/**
 * Isolated, read-only candidate verification job.
 * Runs untrusted candidate code, before/after evidence replay, and `validate-changes.ts`
 * WITHOUT any write credentials or LLM secrets, then emits an exact-patch receipt for `publish.ts`.
 */
export async function runVerify(options: {
  cwd?: string;
  triageFile: string;
  evidenceRoot: string;
  proposalDir: string;
  outputDir: string;
  skipValidation?: boolean;
  skipBaselineCompare?: boolean;
  requireEvidenceReplay?: boolean;
  allowInsideRepoForTest?: boolean;
}): Promise<VerificationReceipt> {
  const cwd = resolve(options.cwd ?? ".");
  const resolvedProposalDir = resolve(options.proposalDir);
  const resolvedEvidenceRoot = resolve(options.evidenceRoot);
  const resolvedOut = resolve(options.outputDir);
  if (options.allowInsideRepoForTest !== true) {
    assertOutsideRepo(cwd, options.triageFile, "--triage-file");
    assertOutsideRepo(cwd, resolvedEvidenceRoot, "--evidence-root");
    assertOutsideRepo(cwd, resolvedProposalDir, "--proposal-dir");
    assertOutsideRepo(cwd, resolvedOut, "--output-dir");
  }
  await mkdir(resolvedOut, { recursive: true });

  const [target, proposalRaw, patchBytes] = await Promise.all([
    readActionableTriage(options.triageFile),
    readFile(join(resolvedProposalDir, "proposal.json"), "utf8"),
    readFile(join(resolvedProposalDir, "candidate.patch")),
  ]);
  const proposal = proposalSchema.parse(JSON.parse(proposalRaw));

  const violations: string[] = [];
  if (proposal.provider_id !== target.provider_id) {
    violations.push(
      `Proposal provider (${proposal.provider_id}) does not match triage target (${target.provider_id})`,
    );
  }
  const actualPatchHash = sha256(patchBytes);
  if (actualPatchHash !== proposal.patch_sha256) {
    violations.push(
      `Candidate patch digest mismatch: expected ${proposal.patch_sha256}, got ${actualPatchHash}`,
    );
  }
  const headSha = runGit(["rev-parse", "HEAD"], cwd).trim();
  if (headSha !== proposal.base_sha) {
    violations.push(
      `Verify checkout HEAD (${headSha}) does not match proposal base_sha (${proposal.base_sha})`,
    );
  }
  const patchPaths = parsePatchPaths(patchBytes.toString("utf8"));
  const expectedPaths = [...proposal.changed_files].sort();
  if (JSON.stringify(patchPaths) !== JSON.stringify(expectedPaths)) {
    violations.push(
      `Patch file set (${patchPaths.join(", ")}) does not match proposal.changed_files (${expectedPaths.join(", ")})`,
    );
  }

  let ok = false;
  let blocked = false;
  let mode: VerificationReceipt["mode"] = "rejected";
  let protectedFiles: string[] = [];
  let replayedSources: string[] = [];
  let finalViolations = violations;

  if (violations.length === 0) {
    runGit(["apply", "--whitespace=nowarn", join(resolvedProposalDir, "candidate.patch")], cwd);

    const verdict = runSelfHealGate({
      cwd,
      base: proposal.base_sha,
      targetProvider: target.provider_id,
      targetCandidates: target.candidates,
      evidenceRoot: resolvedEvidenceRoot,
      evidenceFiles: target.evidence_files,
      ...(options.requireEvidenceReplay === undefined
        ? {}
        : { requireEvidenceReplay: options.requireEvidenceReplay }),
      compareBaselineReplay:
        options.skipBaselineCompare !== true && target.evidence_files.length > 0,
      skipValidation: options.skipValidation === true,
    });

    finalViolations = [...verdict.violations];
    blocked = verdict.replay_unavailable === true || verdict.validation_unavailable === true;
    if (JSON.stringify(verdict.changed_files) !== JSON.stringify(expectedPaths)) {
      blocked = false;
      finalViolations.push(
        `Applied working tree files (${verdict.changed_files.join(", ")}) drifted from proposal files (${expectedPaths.join(", ")})`,
      );
    }
    ok = verdict.ok && finalViolations.length === 0;
    mode = ok ? verdict.mode : "rejected";
    protectedFiles = verdict.protected_files;
    replayedSources = verdict.replayed_sources;
  }

  const receipt = verificationReceiptSchema.parse({
    version: 1,
    ok,
    mode,
    base_sha: proposal.base_sha,
    provider_id: target.provider_id,
    ...(proposal.trigger_run_id === undefined ? {} : { trigger_run_id: proposal.trigger_run_id }),
    ...(proposal.trigger_run_attempt === undefined
      ? {}
      : { trigger_run_attempt: proposal.trigger_run_attempt }),
    patch_sha256: proposal.patch_sha256,
    changed_files: expectedPaths,
    protected_files: protectedFiles,
    replayed_sources: replayedSources,
    violations: finalViolations,
    ...(blocked ? { verification_blocked: true } : {}),
    verified_at: new Date().toISOString(),
  });

  await writeFile(
    join(resolvedOut, "verification-receipt.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  return receipt;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const triageFile = parseCliFlag(args, "--triage-file");
  const evidenceRoot = parseCliFlag(args, "--evidence-root");
  const proposalDir = parseCliFlag(args, "--proposal-dir");
  const outputDir = parseCliFlag(args, "--output-dir");
  if (!triageFile || !evidenceRoot || !proposalDir || !outputDir) {
    throw new Error(
      "Usage: verify.ts --triage-file <target.json> --evidence-root <dir> --proposal-dir <dir> --output-dir <dir>",
    );
  }
  const receipt = await runVerify({
    triageFile,
    evidenceRoot,
    proposalDir,
    outputDir,
    skipValidation: args.includes("--skip-validation"),
    skipBaselineCompare: args.includes("--skip-baseline-compare"),
  });
  console.log(JSON.stringify(receipt, null, 2));
  // EX_TEMPFAIL tells the workflow to retry verification, not generation.
  if (!receipt.ok) process.exitCode = receipt.verification_blocked === true ? 75 : 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
