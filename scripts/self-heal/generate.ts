import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { sha256 } from "../../src/catalog/io.ts";
import {
  DEFAULT_CODEX_MODEL,
  buildCodexSandboxArgs,
  loadOpenAIPricingLookup,
  resolveCodexBinary,
  resolveOpenAIRateBand,
  runCodexAdapter,
  type OpenAIInferencePriceLookup,
} from "./adapters/codex.ts";
import {
  evaluateBudget,
  isValidUsd,
  parseBudgetLimitsFromEnv,
  readBudgetLedger,
  roundUsd,
} from "./budget.ts";
import { runSelfHealGate } from "./gate.ts";
import {
  assertOutsideRepo,
  parseCliFlag,
  parsePositiveInt,
  runGit,
  sanitizedUntrustedEnv,
  selfHealPrivateBaseDir,
} from "./runtime.ts";
import {
  filterEvidenceForTargetCandidates,
  inspectTargetReplayReadiness,
  type SelfHealTarget,
} from "./triage.ts";

export const proposalSchema = z.strictObject({
  version: z.literal(1),
  base_sha: z.string().regex(/^[0-9a-f]{40}$/),
  provider_id: z.string().min(1),
  trigger_run_id: z.string().min(1).optional(),
  trigger_run_attempt: z.number().int().positive().optional(),
  patch_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  changed_files: z.array(z.string().min(1)).min(1),
  generated_at: z.string().min(1),
});

export const usageReportSchema = z.strictObject({
  status: z.enum(["patch_ready", "no_patch", "generate_failed", "budget_exceeded", "deferred"]),
  generate_run_attempt: z.number().int().positive().optional(),
  usage_known: z.boolean(),
  input_tokens: z.number().int().nonnegative().nullable(),
  output_tokens: z.number().int().nonnegative().nullable(),
  estimated_usd: z.number().nonnegative().nullable(),
  attempts: z.number().int().nonnegative(),
  error: z.string().optional(),
});

export type SelfHealProposal = z.infer<typeof proposalSchema>;
export type SelfHealUsageReport = z.infer<typeof usageReportSchema>;

function buildTaskPrompt(target: SelfHealTarget, evidenceRoot: string, feedback?: string): string {
  const evidenceLines = target.evidence_files.map(
    ({ source_id, relative_path, sha256: hash, context_relative_path }) => {
      const fullPath = join(evidenceRoot, relative_path);
      const contextArg =
        context_relative_path === undefined ? "" : ` ${join(evidenceRoot, context_relative_path)}`;
      return `- ${source_id}: ${fullPath} (sha256: ${hash.slice(0, 12)}, replay: vp node scripts/replay-catalog-evidence.ts ${source_id} ${fullPath}${contextArg})`;
    },
  );
  const candidateLines = target.candidates.map(
    (c) =>
      `- [${c.trigger}] ${c.source_id ?? c.subject_id}: ${c.message}` +
      (c.diagnostics.length > 0
        ? `\n  diagnostics: ${JSON.stringify(c.diagnostics.slice(0, 5))}`
        : ""),
  );
  return [
    `Repair actionable catalog drift for provider "${target.provider_id}".`,
    "",
    "Rules:",
    `1. Read docs/self-heal.md and docs/providers/${target.provider_id}.md first.`,
    "2. Inspect the bound official public evidence bytes (or fetch reviewed public source via `vp node scripts/fetch-catalog-evidence.ts <source-id>`).",
    "3. Fix only the demonstrated root cause in this provider's parser/manifest and add a focused regression fixture & test.",
    "4. Never weaken or remove minModels/minDocuments thresholds, skip tests, use `any`, or touch `src/catalog/transport/`, `.github/`, `scripts/self-heal/`, `packages/`, or `data/`.",
    "5. Missing source facts must stay unknown (never zero/free).",
    "",
    `Quarantined: ${target.quarantined ? `yes (${target.quarantine_reason})` : "no"}`,
    "Failure candidates:",
    ...candidateLines,
    ...(evidenceLines.length > 0 ? ["", "Bound official evidence:", ...evidenceLines] : []),
    ...(feedback === undefined
      ? []
      : ["", "Previous local gate feedback (fix all issues):", feedback]),
  ].join("\n");
}

/**
 * Match the repository's built-in OpenAI Codex adapter command so `generate.ts` invokes
 * `runCodexAdapter` directly in-process using already-loaded immutable modules rather than
 * reloading scripts or `node_modules` from the writable candidate workspace on retry.
 */
export function isBuiltinCodexAdapterCommand(agentCommand: string): boolean {
  return /^(?:vp\s+node|node)\s+(?:\.\/)?scripts\/self-heal\/adapters\/codex\.ts$/.test(
    agentCommand.trim(),
  );
}

/**
 * Capture both modified tracked files and newly created untracked files into one git patch
 * so the isolated verify and publish jobs apply the exact same diff onto a clean checkout.
 */
function captureCandidatePatch(
  cwd: string,
  baseSha: string,
  changedFiles: readonly string[],
): string {
  const untracked = runGit(["ls-files", "--others", "--exclude-standard", "-z"], cwd)
    .split("\0")
    .filter((file) => file.length > 0 && changedFiles.includes(file));
  if (untracked.length > 0) {
    runGit(["add", "-N", "--", ...untracked], cwd);
  }
  const patch = runGit(["diff", "--binary", baseSha, "--", ...changedFiles], cwd);
  if (untracked.length > 0) {
    runGit(["reset", "--", ...untracked], cwd);
  }
  return patch;
}

async function readAgentUsage(path: string): Promise<{
  known: boolean;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_usd: number | null;
}> {
  try {
    const raw: unknown = JSON.parse(await readFile(path, "utf8"));
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return { known: false, input_tokens: null, output_tokens: null, estimated_usd: null };
    }
    const record = raw as Record<string, unknown>;
    const parseNonNegInt = (value: unknown): number | null =>
      typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
    const parseNonNegNum = (value: unknown): number | null => (isValidUsd(value) ? value : null);
    const inputTokens = parseNonNegInt(record.input_tokens);
    const outputTokens = parseNonNegInt(record.output_tokens);
    const estimatedUsd = parseNonNegNum(record.estimated_usd);
    // Preserve every valid reported field independently so partial receipts still retain
    // observed spend/token floors while marking overall usage_known=false.
    return {
      known: inputTokens !== null && outputTokens !== null && estimatedUsd !== null,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      estimated_usd: estimatedUsd,
    };
  } catch {
    return { known: false, input_tokens: null, output_tokens: null, estimated_usd: null };
  }
}

export async function runGenerate(options: {
  cwd?: string;
  triageFile: string;
  evidenceRoot: string;
  outputDir: string;
  budgetLedgerPath?: string;
  runAttempt?: number;
  agentCommand?: string;
  codexFetcher?: typeof fetch;
  codexPricingLookup?: OpenAIInferencePriceLookup;
  allowInsideRepoForTest?: boolean;
  allowZeroEvidenceForTest?: boolean;
}): Promise<{ hasPatch: boolean; usage: SelfHealUsageReport; proposal?: SelfHealProposal }> {
  const cwd = resolve(options.cwd ?? ".");
  const resolvedOut = resolve(options.outputDir);
  const resolvedEvidenceRoot = resolve(options.evidenceRoot);
  if (options.allowInsideRepoForTest !== true) {
    assertOutsideRepo(cwd, options.triageFile, "--triage-file");
    assertOutsideRepo(cwd, resolvedEvidenceRoot, "--evidence-root");
    assertOutsideRepo(cwd, resolvedOut, "--output-dir");
    if (options.budgetLedgerPath !== undefined) {
      assertOutsideRepo(cwd, options.budgetLedgerPath, "--budget-ledger");
    }
  }
  const generateRunAttempt = options.runAttempt ?? parsePositiveInt(process.env.GITHUB_RUN_ATTEMPT);

  await mkdir(resolvedOut, { recursive: true });
  const triage = JSON.parse(await readFile(resolve(options.triageFile), "utf8")) as {
    status: string;
    target?: SelfHealTarget;
  };
  if (triage.status !== "actionable" || triage.target === undefined) {
    const usage: SelfHealUsageReport = {
      status: "no_patch",
      usage_known: true,
      input_tokens: 0,
      output_tokens: 0,
      estimated_usd: 0,
      attempts: 0,
    };
    await writeFile(join(resolvedOut, "usage.json"), `${JSON.stringify(usage, null, 2)}\n`);
    return { hasPatch: false, usage };
  }
  const target = triage.target;

  const hashMatchedEvidence = filterEvidenceForTargetCandidates(
    target.candidates,
    target.evidence_files,
  );
  const readiness = inspectTargetReplayReadiness(target.candidates, hashMatchedEvidence);
  if (
    options.allowZeroEvidenceForTest !== true &&
    (readiness.unsupportedTriggers.length > 0 ||
      readiness.hasUnboundProviderCandidate ||
      readiness.missingSourceIds.length > 0 ||
      readiness.contextErrors.length > 0 ||
      readiness.evidenceCount === 0)
  ) {
    const reason =
      readiness.unsupportedTriggers.length > 0
        ? `Target trigger(s) cannot be verified via single-source offline replay (${readiness.unsupportedTriggers.join(", ")}); refusing paid generation`
        : readiness.hasUnboundProviderCandidate
          ? "Provider-level assembly or quarantine failure lacks reproducible provider verification; refusing paid generation"
          : readiness.missingSourceIds.length > 0
            ? `Missing bound official evidence for failing source(s): ${readiness.missingSourceIds.join(", ")}; refusing paid generation`
            : readiness.contextErrors.length > 0
              ? `${readiness.contextErrors.join("; ")}; refusing paid generation`
              : "Target has no bound official evidence for reproducible verification; refusing paid generation";
    const usage: SelfHealUsageReport = usageReportSchema.parse({
      status: "no_patch",
      ...(generateRunAttempt === undefined ? {} : { generate_run_attempt: generateRunAttempt }),
      usage_known: true,
      input_tokens: 0,
      output_tokens: 0,
      estimated_usd: 0,
      attempts: 0,
      error: reason,
    });
    await writeFile(join(resolvedOut, "usage.json"), `${JSON.stringify(usage, null, 2)}\n`);
    return { hasPatch: false, usage };
  }

  const limits = parseBudgetLimitsFromEnv();
  if (options.budgetLedgerPath !== undefined) {
    const nowMs = Date.now();
    const ledger = await readBudgetLedger(resolve(options.budgetLedgerPath));
    const budgetCheck = evaluateBudget(ledger, { nowMs, limits, reserveRun: true });
    const cooldownUntil = budgetCheck.cooldown_providers[target.provider_id];
    const inCooldown = cooldownUntil !== undefined && Date.parse(cooldownUntil) > nowMs;
    if (!budgetCheck.allowed || inCooldown) {
      const reasons = [
        ...budgetCheck.reasons,
        ...(inCooldown
          ? [`Provider ${target.provider_id} is in cooldown until ${cooldownUntil}`]
          : []),
      ];
      const usage: SelfHealUsageReport = usageReportSchema.parse({
        status: "deferred",
        ...(generateRunAttempt === undefined ? {} : { generate_run_attempt: generateRunAttempt }),
        usage_known: true,
        input_tokens: 0,
        output_tokens: 0,
        estimated_usd: 0,
        attempts: 0,
        error: `Rolling budget or cooldown blocked generation: ${reasons.join("; ")}`,
      });
      await writeFile(join(resolvedOut, "usage.json"), `${JSON.stringify(usage, null, 2)}\n`);
      return { hasPatch: false, usage };
    }
  }

  const agentCommand = (options.agentCommand ?? process.env.SELF_HEAL_AGENT_CMD)?.trim();
  if (!agentCommand) {
    throw new Error("SELF_HEAL_AGENT_CMD is required to generate a repair patch");
  }
  const usesBuiltinCodex = isBuiltinCodexAdapterCommand(agentCommand);

  const baseSha = runGit(["rev-parse", "HEAD"], cwd).trim();
  const runsBase = selfHealPrivateBaseDir("runs", cwd);
  await mkdir(runsBase, { recursive: true });
  const workDir = await mkdtemp(join(runsBase, "gen-"));
  const usageFile = join(workDir, "usage.json");
  let allUsageKnown = true;
  let anyInputTokens = false;
  let anyOutputTokens = false;
  let anyEstimatedUsd = false;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalEstimatedUsd = 0;
  let attempts = 0;
  let finalStatus: SelfHealUsageReport["status"] = "no_patch";
  let finalError: string | undefined;
  let producedProposal: SelfHealProposal | undefined;
  let finalUsage!: SelfHealUsageReport;

  try {
    let builtinApiKey: string | undefined;
    let codexModel: string | undefined;
    let codexBin: string | undefined;
    let codexPricingLookup: OpenAIInferencePriceLookup | undefined;
    let sandboxCodexHome: string | undefined;
    if (usesBuiltinCodex) {
      // Validate credentials, pre-load verified Kmodels pricing data, validate the configured model,
      // and resolve the Codex binary ONCE before attempt 1 so candidate workspace edits can never
      // tamper with pricing lookups or binary resolution. Any pre-call config/setup error emits a
      // verified $0 deferred receipt (attempts: 0) so `publish` never burns paid budget or starts
      // provider cooldown when zero agent calls were made.
      try {
        builtinApiKey = process.env.SELF_HEAL_API_KEY?.trim();
        if (!builtinApiKey) {
          throw new Error("Missing SELF_HEAL_API_KEY");
        }
        codexModel = process.env.SELF_HEAL_MODEL?.trim() || DEFAULT_CODEX_MODEL;
        codexPricingLookup = options.codexPricingLookup ?? (await loadOpenAIPricingLookup());
        resolveOpenAIRateBand(codexModel, 1, codexPricingLookup);
        codexBin = await resolveCodexBinary(
          options.codexFetcher === undefined ? undefined : { fetcher: options.codexFetcher },
        );
        sandboxCodexHome = join(workDir, "sandbox-codex-home");
        await mkdir(sandboxCodexHome, { recursive: true });
      } catch (error) {
        finalStatus = "deferred";
        finalError = `Pre-call Codex setup failed before any paid call: ${error instanceof Error ? error.message : String(error)}`;
        throw error;
      }
    }

    let feedback: string | undefined;
    const maxRunUsd = roundUsd(limits.maxRunUsd);
    const promptTarget: SelfHealTarget = { ...target, evidence_files: hashMatchedEvidence };
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const roundedTotalUsd = roundUsd(totalEstimatedUsd);
      const remainingUsd = roundUsd(Math.max(0, maxRunUsd - roundedTotalUsd));
      const remainingTokens = Math.max(
        0,
        limits.maxRunTokens - (totalInputTokens + totalOutputTokens),
      );
      if (attempt > 1 && (!allUsageKnown || remainingUsd <= 0 || remainingTokens <= 0)) {
        if (allUsageKnown && (remainingUsd <= 0 || remainingTokens <= 0)) {
          finalStatus = "budget_exceeded";
          finalError = `No remaining per-run budget before attempt ${attempt} (${roundedTotalUsd.toFixed(4)}/${limits.maxRunUsd.toFixed(2)} USD, ${totalInputTokens + totalOutputTokens}/${limits.maxRunTokens} tokens)`;
        }
        break;
      }

      attempts = attempt;
      const promptPath = join(workDir, `prompt-${attempt}.md`);
      await writeFile(
        promptPath,
        buildTaskPrompt(promptTarget, resolvedEvidenceRoot, feedback),
        "utf8",
      );
      await rm(usageFile, { force: true });

      let exitStatus: number | null = 0;
      let agentFailureDetail: string | undefined;
      if (usesBuiltinCodex && builtinApiKey !== undefined && codexBin !== undefined) {
        try {
          const codexResult = await runCodexAdapter({
            cwd,
            apiKey: builtinApiKey,
            promptFile: promptPath,
            usageFile,
            codexBin,
            ...(codexPricingLookup === undefined ? {} : { pricingLookup: codexPricingLookup }),
            ...(codexModel === undefined ? {} : { model: codexModel }),
            maxRunUsd: remainingUsd,
            maxRunTokens: remainingTokens,
            ...(options.codexFetcher === undefined ? {} : { fetcher: options.codexFetcher }),
          });
          if (codexResult.budgetExceeded) {
            exitStatus = 1;
            agentFailureDetail = "Codex adapter stopped because per-run budget cap was reached";
          } else {
            exitStatus = codexResult.exitCode;
          }
        } catch (error) {
          exitStatus = 1;
          agentFailureDetail = error instanceof Error ? error.message : String(error);
        }
      } else {
        // Strip any accidental write tokens from custom agent subprocess environments.
        const agentEnv: NodeJS.ProcessEnv = { ...process.env };
        delete agentEnv.GH_TOKEN;
        delete agentEnv.GITHUB_TOKEN;
        agentEnv.SELF_HEAL_PROMPT_FILE = promptPath;
        agentEnv.SELF_HEAL_PROVIDER = target.provider_id;
        agentEnv.SELF_HEAL_EVIDENCE_ROOT = resolvedEvidenceRoot;
        agentEnv.SELF_HEAL_USAGE_FILE = usageFile;
        agentEnv.SELF_HEAL_WORKDIR = cwd;
        agentEnv.SELF_HEAL_MAX_RUN_USD = String(remainingUsd);
        agentEnv.SELF_HEAL_MAX_RUN_TOKENS = String(remainingTokens);

        const agent = spawnSync("bash", ["-c", agentCommand], {
          cwd,
          stdio: "inherit",
          env: agentEnv,
        });
        exitStatus = agent.status;
      }
      const attemptUsage = await readAgentUsage(usageFile);
      if (!attemptUsage.known) {
        allUsageKnown = false;
      }
      if (attemptUsage.input_tokens !== null) {
        anyInputTokens = true;
        totalInputTokens += attemptUsage.input_tokens;
      }
      if (attemptUsage.output_tokens !== null) {
        anyOutputTokens = true;
        totalOutputTokens += attemptUsage.output_tokens;
      }
      if (attemptUsage.estimated_usd !== null) {
        anyEstimatedUsd = true;
        totalEstimatedUsd += attemptUsage.estimated_usd;
      }

      // Enforce per-run cap on the 6-decimal-rounded cumulative sum (avoiding both IEEE-754 drift
      // and premature per-attempt truncation on sub-microdollar fractions).
      const cumulativeUsd = roundUsd(totalEstimatedUsd);
      if (
        !isValidUsd(totalEstimatedUsd) ||
        cumulativeUsd > maxRunUsd ||
        totalInputTokens + totalOutputTokens > limits.maxRunTokens
      ) {
        finalStatus = "budget_exceeded";
        finalError = `Per-run budget exceeded (${cumulativeUsd.toFixed(4)} USD, ${totalInputTokens + totalOutputTokens} tokens)`;
        break;
      }

      if (exitStatus !== 0) {
        finalStatus = "generate_failed";
        feedback = agentFailureDetail ?? `Agent command exited with status ${exitStatus}`;
        finalError = feedback;
        if (!allUsageKnown) {
          finalError = `${feedback} (retry skipped because usage was unreported)`;
          break;
        }
        continue;
      }

      // Always run static diff/path/safety checks in `generate`. For the built-in Codex adapter,
      // also run deterministic candidate evidence replay inside a secret-free, read-only,
      // network-disabled `codex sandbox` so parse failures feed back into attempt 2 while keeping
      // the separate secret-free `verify` job authoritative for before/after replay and full validation.
      const sandboxedReplayWrapper =
        usesBuiltinCodex && codexBin !== undefined && sandboxCodexHome !== undefined
          ? (replayArgs: readonly string[]) => {
              const env = sanitizedUntrustedEnv();
              delete env.RUNNER_TEMP;
              env.CODEX_HOME = sandboxCodexHome;
              env.GIT_TERMINAL_PROMPT = "0";
              return {
                command: codexBin,
                args: buildCodexSandboxArgs({ cwd, command: ["vp", ...replayArgs] }),
                env,
              };
            }
          : undefined;
      const verdict = runSelfHealGate({
        cwd,
        base: baseSha,
        targetProvider: target.provider_id,
        targetCandidates: target.candidates,
        evidenceRoot: resolvedEvidenceRoot,
        evidenceFiles: hashMatchedEvidence,
        requireEvidenceReplay:
          sandboxedReplayWrapper !== undefined && options.allowZeroEvidenceForTest !== true,
        skipEvidenceReplay: sandboxedReplayWrapper === undefined,
        ...(sandboxedReplayWrapper === undefined
          ? {}
          : { replayCommandWrapper: sandboxedReplayWrapper }),
        skipValidation: true,
      });

      if (verdict.ok) {
        const patch = captureCandidatePatch(cwd, baseSha, verdict.changed_files);
        if (patch.trim().length === 0) {
          finalStatus = "no_patch";
          feedback = "Captured candidate patch was empty";
          finalError = feedback;
          if (!allUsageKnown) break;
          continue;
        }
        const patchBytes = Buffer.from(patch, "utf8");
        producedProposal = proposalSchema.parse({
          version: 1,
          base_sha: baseSha,
          provider_id: target.provider_id,
          ...(target.trigger_run_id === undefined ? {} : { trigger_run_id: target.trigger_run_id }),
          ...(target.trigger_run_attempt === undefined
            ? {}
            : { trigger_run_attempt: target.trigger_run_attempt }),
          patch_sha256: sha256(patchBytes),
          changed_files: verdict.changed_files,
          generated_at: new Date().toISOString(),
        });
        await Promise.all([
          writeFile(join(resolvedOut, "candidate.patch"), patchBytes),
          writeFile(
            join(resolvedOut, "proposal.json"),
            `${JSON.stringify(producedProposal, null, 2)}\n`,
          ),
        ]);
        finalStatus = "patch_ready";
        finalError = undefined;
        break;
      }

      finalStatus = "no_patch";
      feedback = `Local gate feedback:\n${verdict.violations.join("\n")}`;
      finalError = feedback;
      if (!allUsageKnown) {
        finalError = `${feedback}\n(retry skipped because usage was unreported)`;
        break;
      }
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
    const safeInputTokens =
      (allUsageKnown || anyInputTokens) && Number.isSafeInteger(totalInputTokens)
        ? totalInputTokens
        : null;
    const safeOutputTokens =
      (allUsageKnown || anyOutputTokens) && Number.isSafeInteger(totalOutputTokens)
        ? totalOutputTokens
        : null;
    const safeEstimatedUsd =
      (allUsageKnown || anyEstimatedUsd) && isValidUsd(totalEstimatedUsd)
        ? roundUsd(totalEstimatedUsd)
        : null;
    finalUsage = usageReportSchema.parse({
      status: finalStatus,
      ...(generateRunAttempt === undefined ? {} : { generate_run_attempt: generateRunAttempt }),
      usage_known:
        allUsageKnown &&
        safeInputTokens !== null &&
        safeOutputTokens !== null &&
        safeEstimatedUsd !== null,
      input_tokens: safeInputTokens,
      output_tokens: safeOutputTokens,
      estimated_usd: safeEstimatedUsd,
      attempts,
      ...(finalError === undefined ? {} : { error: finalError }),
    });
    await writeFile(join(resolvedOut, "usage.json"), `${JSON.stringify(finalUsage, null, 2)}\n`);
  }

  return {
    hasPatch: producedProposal !== undefined,
    usage: finalUsage,
    ...(producedProposal === undefined ? {} : { proposal: producedProposal }),
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const triageFile = parseCliFlag(args, "--triage-file");
  const evidenceRoot = parseCliFlag(args, "--evidence-root");
  const outputDir = parseCliFlag(args, "--output-dir");
  const budgetLedgerPath = parseCliFlag(args, "--budget-ledger");
  if (!triageFile || !evidenceRoot || !outputDir) {
    throw new Error(
      "Usage: generate.ts --triage-file <target.json> --evidence-root <dir> --output-dir <dir> [--budget-ledger <ledger.json>]",
    );
  }
  const result = await runGenerate({
    triageFile,
    evidenceRoot,
    outputDir,
    ...(budgetLedgerPath === undefined ? {} : { budgetLedgerPath }),
  });
  console.log(JSON.stringify({ has_patch: result.hasPatch, usage: result.usage }, null, 2));
  if (!result.hasPatch) process.exitCode = 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
