import { spawnSync } from "node:child_process";
import { appendFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, sha256 } from "../../src/catalog/io.ts";
import {
  appendBudgetEntry,
  buildSettledBudgetEntry,
  evaluateBudget,
  parseBudgetLimitsFromEnv,
  readBudgetLedger,
  writeBudgetLedger,
  type BudgetOutcome,
  type RunUsageInput,
} from "./budget.ts";
import { classifyChangedPaths, parsePatchPaths, type DeliveryMode } from "./gate.ts";
import { proposalSchema, usageReportSchema, type SelfHealUsageReport } from "./generate.ts";
import {
  assertOutsideRepo,
  parseCliFlag,
  parsePositiveInt,
  SELF_HEAL_MAX_BUFFER,
} from "./runtime.ts";
import { readActionableTriage } from "./triage.ts";
import { verificationReceiptSchema, type VerificationReceipt } from "./verify.ts";

export interface PublishOutcome {
  outcome: BudgetOutcome;
  provider_id: string;
  patch_sha256?: string;
  published_sha?: string;
  mode?: DeliveryMode;
  violations: string[];
}

function runCommand(command: string, args: readonly string[], cwd: string): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: SELF_HEAL_MAX_BUFFER,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status}): ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
  return result.stdout.trim();
}

async function emitGithubOutputs(outcome: PublishOutcome): Promise<void> {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  const lines = [
    `outcome=${outcome.outcome}`,
    `provider=${outcome.provider_id}`,
    `patch_sha256=${outcome.patch_sha256 ?? ""}`,
    `published_sha=${outcome.published_sha ?? ""}`,
  ];
  await appendFile(outputPath, `${lines.join("\n")}\n`, "utf8");
}

/**
 * Trusted publish & budget-settlement job.
 * Security invariant: NEVER executes untrusted candidate code, parsers, or tests.
 * Only verifies the immutable verification receipt + exact patch digest + trusted budget,
 * applies the exact patch via `git apply`, stages ONLY `receipt.changed_files`, and publishes.
 * Settles paid usage even on generate failure, no-patch, or verify failure.
 */
export async function runPublish(options: {
  cwd?: string;
  triageFile: string;
  proposalDir?: string;
  verifyDir?: string;
  verifyJobResult?: string;
  runId?: string;
  runAttempt?: number;
  generateAttempt?: number;
  budgetLedgerPath?: string;
  dryRun?: boolean;
  skipRemotePush?: boolean;
  allowInsideRepoForTest?: boolean;
}): Promise<PublishOutcome> {
  const cwd = resolve(options.cwd ?? ".");
  if (options.allowInsideRepoForTest !== true) {
    assertOutsideRepo(cwd, options.triageFile, "--triage-file");
    if (options.proposalDir !== undefined)
      assertOutsideRepo(cwd, options.proposalDir, "--proposal-dir");
    if (options.verifyDir !== undefined) assertOutsideRepo(cwd, options.verifyDir, "--verify-dir");
    if (options.budgetLedgerPath !== undefined)
      assertOutsideRepo(cwd, options.budgetLedgerPath, "--budget-ledger");
  }

  const target = await readActionableTriage(options.triageFile);

  const limits = parseBudgetLimitsFromEnv();
  const ledger =
    options.budgetLedgerPath === undefined
      ? undefined
      : await readBudgetLedger(resolve(options.budgetLedgerPath));

  let parsedUsage: SelfHealUsageReport | undefined;
  try {
    const rawUsage =
      options.proposalDir === undefined
        ? undefined
        : await readJson(join(resolve(options.proposalDir), "usage.json"));
    if (rawUsage !== undefined) parsedUsage = usageReportSchema.parse(rawUsage);
  } catch {
    // Truncated/corrupt usage.json falls back to conservative unknown-usage settlement.
    parsedUsage = undefined;
  }

  const runUsage: RunUsageInput = parsedUsage ?? {
    usage_known: false,
    input_tokens: null,
    output_tokens: null,
    estimated_usd: null,
  };

  const resolvedRunId = options.runId ?? process.env.GITHUB_RUN_ID ?? `local-${Date.now()}`;
  // Key settlement by `generate`'s attempt (from usage.json or upstream generate job output)
  // rather than publish's attempt, so re-running verify/publish alone never double-bills one generation.
  const resolvedRunAttempt =
    parsedUsage?.generate_run_attempt ??
    options.generateAttempt ??
    options.runAttempt ??
    parsePositiveInt(process.env.GITHUB_RUN_ATTEMPT);

  let ledgerSettled = false;
  const settleLedger = async (outcome: BudgetOutcome): Promise<void> => {
    if (ledgerSettled) return;
    ledgerSettled = true;
    if (options.budgetLedgerPath === undefined || ledger === undefined) return;
    const entry = buildSettledBudgetEntry({
      run_id: resolvedRunId,
      ...(resolvedRunAttempt === undefined ? {} : { run_attempt: resolvedRunAttempt }),
      provider_id: target.provider_id,
      ...(target.incident_fingerprint === undefined
        ? {}
        : { incident_fingerprint: target.incident_fingerprint }),
      usage: runUsage,
      outcome,
      limits,
    });
    const updated = appendBudgetEntry(ledger, entry);
    await writeBudgetLedger(resolve(options.budgetLedgerPath), updated);
  };

  const finish = async (
    outcome: BudgetOutcome,
    details: Omit<PublishOutcome, "outcome" | "provider_id">,
    settle = true,
  ): Promise<PublishOutcome> => {
    if (settle) await settleLedger(outcome);
    const result: PublishOutcome = {
      outcome,
      provider_id: target.provider_id,
      ...details,
    };
    await emitGithubOutputs(result);
    return result;
  };

  // Settle usage from attempts that produced no eligible patch.
  let rawProposal: unknown;
  let rawReceipt: unknown;
  try {
    rawProposal =
      options.proposalDir === undefined
        ? undefined
        : await readJson(join(resolve(options.proposalDir), "proposal.json"));
    rawReceipt =
      options.verifyDir === undefined
        ? undefined
        : await readJson(join(resolve(options.verifyDir), "verification-receipt.json"));
  } catch (error) {
    return finish("rejected", {
      violations: [
        `Could not read proposal or verification receipt: ${error instanceof Error ? error.message : String(error)}`,
      ],
    });
  }

  if (rawProposal === undefined) {
    if (
      parsedUsage !== undefined &&
      parsedUsage.attempts === 0 &&
      parsedUsage.usage_known &&
      parsedUsage.input_tokens === 0 &&
      parsedUsage.output_tokens === 0 &&
      parsedUsage.estimated_usd === 0 &&
      (parsedUsage.status === "deferred" || parsedUsage.status === "no_patch")
    ) {
      // A pre-call refusal never invoked the paid agent and leaves the spend ledger untouched.
      const outcome: BudgetOutcome = parsedUsage.status === "deferred" ? "deferred" : "no_patch";
      return finish(
        outcome,
        {
          violations: [
            parsedUsage.error ?? `Generation deferred before any paid call (${outcome})`,
          ],
        },
        false,
      );
    }
    const outcome: BudgetOutcome =
      parsedUsage?.status === "budget_exceeded"
        ? "budget_rejected"
        : parsedUsage?.status === "no_patch"
          ? "no_patch"
          : "generate_failed";
    return finish(outcome, {
      violations: [parsedUsage?.error ?? `No candidate proposal produced (${outcome})`],
    });
  }

  let proposal: ReturnType<typeof proposalSchema.parse>;
  let patchPath: string;
  let patchBytes: Buffer;
  let receipt: VerificationReceipt;
  try {
    proposal = proposalSchema.parse(rawProposal);
    patchPath = join(resolve(options.proposalDir!), "candidate.patch");
    patchBytes = await readFile(patchPath);
    if (rawReceipt === undefined) {
      return finish("rejected", {
        patch_sha256: proposal.patch_sha256,
        violations: ["Missing verification receipt from isolated verify job"],
      });
    }
    receipt = verificationReceiptSchema.parse(rawReceipt);
  } catch (error) {
    return finish("rejected", {
      violations: [
        `Malformed or incomplete delivery artifact: ${error instanceof Error ? error.message : String(error)}`,
      ],
    });
  }

  // Trusted invariant verification (zero candidate code execution).
  const violations: string[] = [...receipt.violations];
  if (options.verifyJobResult !== undefined && options.verifyJobResult !== "success") {
    violations.push(
      `Isolated verification job did not succeed (result: ${options.verifyJobResult})`,
    );
  }
  if (!receipt.ok) {
    violations.push("Isolated verification job rejected the candidate patch");
  }
  if (proposal.provider_id !== target.provider_id || receipt.provider_id !== target.provider_id) {
    violations.push("Proposal/receipt provider does not match triage target");
  }
  const actualPatchHash = sha256(patchBytes);
  if (actualPatchHash !== proposal.patch_sha256 || actualPatchHash !== receipt.patch_sha256) {
    violations.push("Patch SHA-256 does not match proposal and verification receipt");
  }
  const headSha = runCommand("git", ["rev-parse", "HEAD"], cwd);
  if (headSha !== proposal.base_sha || headSha !== receipt.base_sha) {
    violations.push(
      `Trusted checkout HEAD (${headSha}) does not match verified base_sha (${receipt.base_sha})`,
    );
  }
  const patchPaths = parsePatchPaths(patchBytes.toString("utf8"));
  const expectedFiles = [...receipt.changed_files].sort();
  if (
    JSON.stringify(patchPaths) !== JSON.stringify(expectedFiles) ||
    JSON.stringify([...proposal.changed_files].sort()) !== JSON.stringify(expectedFiles)
  ) {
    violations.push("Exact file set in candidate.patch does not match verification receipt");
  }

  // Re-verify path classification on the trusted clean checkout (including reverse-dependency ownership).
  const classification = classifyChangedPaths(expectedFiles, target.provider_id, { repoRoot: cwd });
  if (classification.mode === "rejected") {
    violations.push(
      `Trusted path classification rejected files: ${classification.forbidden_files.join(", ")}`,
    );
  }

  if (ledger !== undefined) {
    const budgetCheck = evaluateBudget(ledger, {
      limits,
      runUsage,
      existingRunKey: {
        run_id: resolvedRunId,
        ...(resolvedRunAttempt === undefined ? {} : { run_attempt: resolvedRunAttempt }),
      },
    });
    if (!budgetCheck.allowed) {
      return finish("budget_rejected", {
        patch_sha256: proposal.patch_sha256,
        violations: budgetCheck.reasons,
      });
    }
  }

  if (violations.length > 0) {
    return finish("rejected", {
      patch_sha256: proposal.patch_sha256,
      mode: "rejected",
      violations: [...new Set(violations)],
    });
  }

  if (options.dryRun === true) {
    return finish("dry_run", {
      patch_sha256: proposal.patch_sha256,
      mode: classification.mode,
      violations: [],
    });
  }

  // Apply ONLY the verified exact patch and stage ONLY the verified file set (zero candidate execution).
  // Settle usage even when push or PR creation fails.
  try {
    runCommand("git", ["apply", "--whitespace=nowarn", patchPath], cwd);
    runCommand("git", ["add", "--", ...expectedFiles], cwd);

    // Confirm staged files equal receipt.changed_files 1-to-1.
    const stagedFiles = runCommand("git", ["diff", "--cached", "--name-only", "-z"], cwd)
      .split("\0")
      .filter(Boolean)
      .sort();
    if (JSON.stringify(stagedFiles) !== JSON.stringify(expectedFiles)) {
      throw new Error(
        `Staged files (${stagedFiles.join(", ")}) drifted from verified patch files (${expectedFiles.join(", ")})`,
      );
    }

    const runUrl =
      process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
        ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
        : undefined;
    const commitMessage = [
      `fix(${target.provider_id}): repair catalog parser drift`,
      "",
      `Kmodels-Repair-Patch-Sha256: ${proposal.patch_sha256}`,
      ...(proposal.trigger_run_id === undefined
        ? []
        : [`Kmodels-Repair-Trigger-Run: ${proposal.trigger_run_id}`]),
      ...(runUrl === undefined ? [] : [`Kmodels-Repair-Run: ${runUrl}`]),
    ].join("\n");

    runCommand("git", ["commit", "-m", commitMessage], cwd);
    const commitSha = runCommand("git", ["rev-parse", "HEAD"], cwd);

    if (classification.mode === "auto_push") {
      if (options.skipRemotePush !== true) {
        runCommand("git", ["push", "origin", "HEAD:main"], cwd);
        const remoteMain = runCommand("git", ["ls-remote", "origin", "refs/heads/main"], cwd).split(
          /\s+/,
        )[0];
        if (remoteMain !== commitSha) {
          throw new Error(
            `Remote main (${remoteMain ?? "unknown"}) did not adopt pushed commit (${commitSha})`,
          );
        }
      }
      return finish("auto_push", {
        patch_sha256: proposal.patch_sha256,
        published_sha: commitSha,
        mode: "auto_push",
        violations: [],
      });
    }

    const branch =
      target.source_id === undefined
        ? `self-heal/${target.provider_id}-${resolvedRunId}`
        : `self-heal/${target.provider_id}/${target.source_id}/${resolvedRunId}`;
    if (options.skipRemotePush !== true) {
      runCommand("git", ["push", "origin", `HEAD:refs/heads/${branch}`], cwd);
      runCommand(
        "gh",
        [
          "pr",
          "create",
          "--draft",
          "--head",
          branch,
          "--title",
          `fix(${target.provider_id}): repair catalog drift (protected or shared files)`,
          "--body",
          [
            `Protected or shared files touched: ${classification.protected_files.join(", ")}.`,
            `Patch SHA-256: \`${proposal.patch_sha256}\``,
            `Verified by the isolated self-heal verification job.`,
          ].join("\n\n"),
        ],
        cwd,
      );
    }
    return finish("draft_pr", {
      patch_sha256: proposal.patch_sha256,
      published_sha: commitSha,
      mode: "draft_pr",
      violations: [],
    });
  } catch (error) {
    return finish("publish_failed", {
      patch_sha256: proposal.patch_sha256,
      mode: classification.mode,
      violations: [error instanceof Error ? error.message : String(error)],
    });
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const triageFile = parseCliFlag(args, "--triage-file");
  if (!triageFile) {
    throw new Error(
      "Usage: publish.ts --triage-file <target.json> [--proposal-dir <dir>] [--verify-dir <dir>] [--budget-ledger <ledger.json>] [--dry-run]",
    );
  }
  const proposalDir = parseCliFlag(args, "--proposal-dir");
  const verifyDir = parseCliFlag(args, "--verify-dir");
  const verifyJobResult =
    parseCliFlag(args, "--verify-job-result") ?? (process.env.VERIFY_JOB_RESULT || undefined);
  const generateAttempt = parsePositiveInt(
    parseCliFlag(args, "--generate-attempt") ?? (process.env.GENERATE_RUN_ATTEMPT || undefined),
  );
  const budgetLedgerPath = parseCliFlag(args, "--budget-ledger");
  const outcome = await runPublish({
    triageFile,
    ...(proposalDir === undefined ? {} : { proposalDir }),
    ...(verifyDir === undefined ? {} : { verifyDir }),
    ...(verifyJobResult === undefined ? {} : { verifyJobResult }),
    ...(generateAttempt === undefined ? {} : { generateAttempt }),
    ...(budgetLedgerPath === undefined ? {} : { budgetLedgerPath }),
    dryRun: args.includes("--dry-run"),
  });
  console.log(JSON.stringify(outcome, null, 2));
  if (
    outcome.outcome === "rejected" ||
    outcome.outcome === "budget_rejected" ||
    outcome.outcome === "generate_failed" ||
    outcome.outcome === "publish_failed"
  ) {
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
