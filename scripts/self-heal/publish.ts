import { spawnSync } from "node:child_process";
import { appendFile, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "../../src/catalog/io.ts";
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
import type { SelfHealTarget } from "./triage.ts";
import { verificationReceiptSchema, type VerificationReceipt } from "./verify.ts";

const GIT_MAX_BUFFER = 128 * 1024 * 1024;

export interface PublishOutcome {
  outcome: BudgetOutcome;
  provider_id: string;
  patch_sha256?: string;
  published_sha?: string;
  mode?: DeliveryMode;
  violations: string[];
}

function assertOutsideRepo(pathToCheck: string, repoRoot: string, label: string): void {
  const rel = relative(resolve(repoRoot), resolve(pathToCheck));
  if (rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"))) {
    throw new Error(`${label} (${pathToCheck}) must live outside the git repository checkout`);
  }
}

function runCommand(command: string, args: readonly string[], cwd: string): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: GIT_MAX_BUFFER,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status}): ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
  return result.stdout.trim();
}

async function optionalJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
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
 * Always settles budget & provider cooldown even on generate failure, no-patch, or verify failure.
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
    assertOutsideRepo(options.triageFile, cwd, "--triage-file");
    if (options.proposalDir !== undefined)
      assertOutsideRepo(options.proposalDir, cwd, "--proposal-dir");
    if (options.verifyDir !== undefined) assertOutsideRepo(options.verifyDir, cwd, "--verify-dir");
    if (options.budgetLedgerPath !== undefined)
      assertOutsideRepo(options.budgetLedgerPath, cwd, "--budget-ledger");
  }

  const triage = JSON.parse(await readFile(resolve(options.triageFile), "utf8")) as {
    status: string;
    target?: SelfHealTarget;
  };
  if (triage.status !== "actionable" || triage.target === undefined) {
    throw new Error("Triage file does not contain an actionable target");
  }
  const target = triage.target;

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
        : await optionalJson(join(resolve(options.proposalDir), "usage.json"));
    if (rawUsage !== undefined) parsedUsage = usageReportSchema.parse(rawUsage);
  } catch {
    // Truncated/corrupt usage.json falls back to conservative unknown-usage settlement.
    parsedUsage = undefined;
  }

  const runUsage: RunUsageInput =
    parsedUsage !== undefined
      ? {
          usage_known: parsedUsage.usage_known,
          input_tokens: parsedUsage.input_tokens,
          output_tokens: parsedUsage.output_tokens,
          estimated_usd: parsedUsage.estimated_usd,
        }
      : {
          usage_known: false,
          input_tokens: null,
          output_tokens: null,
          estimated_usd: null,
        };

  const envRunAttemptRaw = process.env.GITHUB_RUN_ATTEMPT;
  const envRunAttempt =
    envRunAttemptRaw !== undefined &&
    Number.isInteger(Number(envRunAttemptRaw)) &&
    Number(envRunAttemptRaw) > 0
      ? Number(envRunAttemptRaw)
      : undefined;
  const resolvedRunId = options.runId ?? process.env.GITHUB_RUN_ID ?? `local-${Date.now()}`;
  // Key settlement by `generate`'s attempt (from usage.json or upstream generate job output)
  // rather than publish's attempt, so re-running verify/publish alone never double-bills one generation.
  const resolvedRunAttempt =
    parsedUsage?.generate_run_attempt ??
    options.generateAttempt ??
    options.runAttempt ??
    envRunAttempt;

  let ledgerSettled = false;
  const settleLedger = async (outcome: BudgetOutcome): Promise<void> => {
    if (ledgerSettled) return;
    ledgerSettled = true;
    if (options.budgetLedgerPath === undefined || ledger === undefined) return;
    const entry = buildSettledBudgetEntry({
      run_id: resolvedRunId,
      ...(resolvedRunAttempt === undefined ? {} : { run_attempt: resolvedRunAttempt }),
      provider_id: target.provider_id,
      usage: runUsage,
      outcome,
      limits,
    });
    const updated = appendBudgetEntry(ledger, entry);
    await writeBudgetLedger(resolve(options.budgetLedgerPath), updated);
  };

  // Case 1: Generation failed, hit budget cap, or produced no patch -> settle budget & cooldown and exit.
  let rawProposal: unknown;
  let rawReceipt: unknown;
  try {
    rawProposal =
      options.proposalDir === undefined
        ? undefined
        : await optionalJson(join(resolve(options.proposalDir), "proposal.json"));
    rawReceipt =
      options.verifyDir === undefined
        ? undefined
        : await optionalJson(join(resolve(options.verifyDir), "verification-receipt.json"));
  } catch (error) {
    await settleLedger("rejected");
    const result: PublishOutcome = {
      outcome: "rejected",
      provider_id: target.provider_id,
      violations: [
        `Could not read proposal or verification receipt: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
    await emitGithubOutputs(result);
    return result;
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
      // Pre-call refusal (cooldown, rolling budget exhausted, or missing evidence) never invoked
      // the paid agent: do NOT append a ledger entry, restart cooldown, or consume a window run slot.
      const outcome: BudgetOutcome = parsedUsage.status === "deferred" ? "deferred" : "no_patch";
      const result: PublishOutcome = {
        outcome,
        provider_id: target.provider_id,
        violations: [parsedUsage.error ?? `Generation deferred before any paid call (${outcome})`],
      };
      await emitGithubOutputs(result);
      return result;
    }
    const outcome: BudgetOutcome =
      parsedUsage?.status === "budget_exceeded"
        ? "budget_rejected"
        : parsedUsage?.status === "no_patch"
          ? "no_patch"
          : "generate_failed";
    await settleLedger(outcome);
    const result: PublishOutcome = {
      outcome,
      provider_id: target.provider_id,
      violations: [parsedUsage?.error ?? `No candidate proposal produced (${outcome})`],
    };
    await emitGithubOutputs(result);
    return result;
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
      await settleLedger("rejected");
      const result: PublishOutcome = {
        outcome: "rejected",
        provider_id: target.provider_id,
        patch_sha256: proposal.patch_sha256,
        violations: ["Missing verification receipt from isolated verify job"],
      };
      await emitGithubOutputs(result);
      return result;
    }
    receipt = verificationReceiptSchema.parse(rawReceipt);
  } catch (error) {
    await settleLedger("rejected");
    const result: PublishOutcome = {
      outcome: "rejected",
      provider_id: target.provider_id,
      violations: [
        `Malformed or incomplete delivery artifact: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
    await emitGithubOutputs(result);
    return result;
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
      await settleLedger("budget_rejected");
      const result: PublishOutcome = {
        outcome: "budget_rejected",
        provider_id: target.provider_id,
        patch_sha256: proposal.patch_sha256,
        violations: budgetCheck.reasons,
      };
      await emitGithubOutputs(result);
      return result;
    }
  }

  if (violations.length > 0) {
    await settleLedger("rejected");
    const result: PublishOutcome = {
      outcome: "rejected",
      provider_id: target.provider_id,
      patch_sha256: proposal.patch_sha256,
      mode: "rejected",
      violations: [...new Set(violations)],
    };
    await emitGithubOutputs(result);
    return result;
  }

  if (options.dryRun === true) {
    await settleLedger("dry_run");
    const result: PublishOutcome = {
      outcome: "dry_run",
      provider_id: target.provider_id,
      patch_sha256: proposal.patch_sha256,
      mode: classification.mode,
      violations: [],
    };
    await emitGithubOutputs(result);
    return result;
  }

  // Apply ONLY the verified exact patch and stage ONLY the verified file set (zero candidate execution).
  // Wrap delivery so push/PR failures ALWAYS settle budget & cooldown before returning.
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
      await settleLedger("auto_push");
      const result: PublishOutcome = {
        outcome: "auto_push",
        provider_id: target.provider_id,
        patch_sha256: proposal.patch_sha256,
        published_sha: commitSha,
        mode: "auto_push",
        violations: [],
      };
      await emitGithubOutputs(result);
      return result;
    }

    const branch = `self-heal/${target.provider_id}-${process.env.GITHUB_RUN_ID ?? Date.now()}`;
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
    await settleLedger("draft_pr");
    const result: PublishOutcome = {
      outcome: "draft_pr",
      provider_id: target.provider_id,
      patch_sha256: proposal.patch_sha256,
      published_sha: commitSha,
      mode: "draft_pr",
      violations: [],
    };
    await emitGithubOutputs(result);
    return result;
  } catch (error) {
    await settleLedger("publish_failed");
    const result: PublishOutcome = {
      outcome: "publish_failed",
      provider_id: target.provider_id,
      patch_sha256: proposal.patch_sha256,
      mode: classification.mode,
      violations: [error instanceof Error ? error.message : String(error)],
    };
    await emitGithubOutputs(result);
    return result;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const triageFile = flag("--triage-file");
  if (!triageFile) {
    throw new Error(
      "Usage: publish.ts --triage-file <target.json> [--proposal-dir <dir>] [--verify-dir <dir>] [--budget-ledger <ledger.json>] [--dry-run]",
    );
  }
  const proposalDir = flag("--proposal-dir");
  const verifyDir = flag("--verify-dir");
  const verifyJobResult =
    flag("--verify-job-result") ?? (process.env.VERIFY_JOB_RESULT || undefined);
  const generateAttemptRaw =
    flag("--generate-attempt") ?? (process.env.GENERATE_RUN_ATTEMPT || undefined);
  const generateAttempt =
    generateAttemptRaw !== undefined &&
    Number.isInteger(Number(generateAttemptRaw)) &&
    Number(generateAttemptRaw) > 0
      ? Number(generateAttemptRaw)
      : undefined;
  const budgetLedgerPath = flag("--budget-ledger");
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
