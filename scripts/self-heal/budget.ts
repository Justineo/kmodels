import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { atomicWrite, readJson } from "../../src/catalog/io.ts";

export const budgetOutcomeSchema = z.enum([
  "auto_push",
  "draft_pr",
  "rejected",
  "budget_rejected",
  "deferred",
  "generate_failed",
  "publish_failed",
  "no_patch",
  "dry_run",
]);

export type BudgetOutcome = z.infer<typeof budgetOutcomeSchema>;

export const budgetUsageEntrySchema = z.strictObject({
  run_id: z.string().min(1),
  run_attempt: z.number().int().positive().optional(),
  provider_id: z.string().min(1),
  recorded_at: z.string().min(1),
  usage_known: z.boolean(),
  input_tokens: z.number().int().nonnegative().nullable(),
  output_tokens: z.number().int().nonnegative().nullable(),
  estimated_usd: z.number().nonnegative(),
  /** Explicitly measured spend floor (omitted when estimated_usd is solely a conservative maxRunUsd reserve). */
  observed_usd: z.number().nonnegative().optional(),
  outcome: budgetOutcomeSchema,
});

export const budgetLedgerSchema = z.strictObject({
  version: z.literal(1),
  entries: z.array(budgetUsageEntrySchema),
});

export type BudgetUsageEntry = z.infer<typeof budgetUsageEntrySchema>;
export type BudgetLedger = z.infer<typeof budgetLedgerSchema>;

export interface BudgetLimits {
  maxRunUsd: number;
  maxRunTokens: number;
  maxWindowUsd: number;
  maxWindowRuns: number;
  windowHours: number;
  providerCooldownHours: number;
}

export const defaultBudgetLimits: BudgetLimits = {
  maxRunUsd: 2.0,
  maxRunTokens: 500_000,
  maxWindowUsd: 10.0,
  maxWindowRuns: 6,
  windowHours: 24,
  providerCooldownHours: 6,
};

export interface BudgetCheckResult {
  allowed: boolean;
  reasons: string[];
  window_usd: number;
  window_runs: number;
  cooldown_providers: Record<string, string>;
}

export interface RunUsageInput {
  usage_known: boolean;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_usd: number | null;
}

/** Upper bound ($1B) preventing `* 1_000_000` overflow to Infinity on corrupt agent usage receipts. */
const MAX_SAFE_USD = 1_000_000_000;

export function isValidUsd(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_SAFE_USD;
}

export function roundUsd(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function emptyBudgetLedger(): BudgetLedger {
  return { version: 1, entries: [] };
}

export function parsePositiveNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseBudgetLimitsFromEnv(env: NodeJS.ProcessEnv = process.env): BudgetLimits {
  return {
    maxRunUsd: parsePositiveNumber(env.SELF_HEAL_MAX_RUN_USD, defaultBudgetLimits.maxRunUsd),
    maxRunTokens: parsePositiveNumber(
      env.SELF_HEAL_MAX_RUN_TOKENS,
      defaultBudgetLimits.maxRunTokens,
    ),
    maxWindowUsd: parsePositiveNumber(
      env.SELF_HEAL_MAX_WINDOW_USD,
      defaultBudgetLimits.maxWindowUsd,
    ),
    maxWindowRuns: parsePositiveNumber(
      env.SELF_HEAL_MAX_WINDOW_RUNS,
      defaultBudgetLimits.maxWindowRuns,
    ),
    windowHours: parsePositiveNumber(env.SELF_HEAL_WINDOW_HOURS, defaultBudgetLimits.windowHours),
    providerCooldownHours: parsePositiveNumber(
      env.SELF_HEAL_COOLDOWN_HOURS,
      defaultBudgetLimits.providerCooldownHours,
    ),
  };
}

/**
 * Convert raw or missing agent usage into a conservative ledger entry.
 * Unknown/unreported usage is never treated as $0 and never under-reports known spend —
 * it charges `max(known_usd, limits.maxRunUsd)` and records `usage_known: false` so failed
 * or partially reported runs still count accurately against rolling spend caps and cooldowns.
 */
export function buildSettledBudgetEntry(params: {
  run_id: string;
  run_attempt?: number;
  provider_id: string;
  recorded_at?: string;
  usage: RunUsageInput;
  outcome: BudgetOutcome;
  limits?: BudgetLimits;
}): BudgetUsageEntry {
  const limits = params.limits ?? defaultBudgetLimits;
  const known =
    params.usage.usage_known &&
    params.usage.estimated_usd !== null &&
    params.usage.input_tokens !== null &&
    params.usage.output_tokens !== null;
  const knownFloorUsd =
    params.usage.estimated_usd !== null && Number.isFinite(params.usage.estimated_usd)
      ? params.usage.estimated_usd
      : 0;
  const settledUsd = known ? knownFloorUsd : Math.max(limits.maxRunUsd, knownFloorUsd);
  const observedUsd = known || knownFloorUsd > 0 ? Number(knownFloorUsd.toFixed(6)) : undefined;
  return budgetUsageEntrySchema.parse({
    run_id: params.run_id,
    ...(params.run_attempt === undefined ? {} : { run_attempt: params.run_attempt }),
    provider_id: params.provider_id,
    recorded_at: params.recorded_at ?? new Date().toISOString(),
    usage_known: known,
    input_tokens: params.usage.input_tokens,
    output_tokens: params.usage.output_tokens,
    estimated_usd: Number(settledUsd.toFixed(6)),
    ...(observedUsd === undefined ? {} : { observed_usd: observedUsd }),
    outcome: params.outcome,
  });
}

/**
 * Evaluate rolling-window spend/run limits and pre-call reservation or post-run actual usage.
 * Pre-call checks reserve `limits.maxRunUsd` so a run cannot start unless the rolling window
 * can absorb a full per-run ceiling.
 */
export function evaluateBudget(
  ledger: BudgetLedger,
  options: {
    nowMs?: number;
    limits?: BudgetLimits;
    reserveRun?: boolean;
    runUsage?: RunUsageInput;
    existingRunKey?: { run_id: string; run_attempt?: number };
  } = {},
): BudgetCheckResult {
  const nowMs = options.nowMs ?? Date.now();
  const limits = options.limits ?? defaultBudgetLimits;
  const windowStartMs = nowMs - limits.windowHours * 3_600_000;
  const cooldownMs = limits.providerCooldownHours * 3_600_000;

  const recentEntries = ledger.entries.filter((entry) => {
    if (entry.outcome === "deferred") return false;
    const recorded = Date.parse(entry.recorded_at);
    return Number.isFinite(recorded) && recorded >= windowStartMs;
  });

  // Search the full retained ledger (not just the current rolling window) so re-evaluating
  // an existing run after >windowHours preserves its original timestamp and per-run spend floor.
  const existingMatch =
    options.existingRunKey === undefined
      ? undefined
      : ledger.entries.find(
          (entry) =>
            entry.outcome !== "deferred" &&
            entry.run_id === options.existingRunKey!.run_id &&
            (entry.run_attempt ?? 1) === (options.existingRunKey!.run_attempt ?? 1),
        );
  const existingInWindow =
    existingMatch !== undefined &&
    Number.isFinite(Date.parse(existingMatch.recorded_at)) &&
    Date.parse(existingMatch.recorded_at) >= windowStartMs;
  const windowUsd = roundUsd(recentEntries.reduce((sum, entry) => sum + entry.estimated_usd, 0));
  const otherWindowUsd =
    existingMatch !== undefined && existingInWindow
      ? roundUsd(Math.max(0, windowUsd - existingMatch.estimated_usd))
      : windowUsd;
  const maxWindowUsd = roundUsd(limits.maxWindowUsd);
  const maxRunUsd = roundUsd(limits.maxRunUsd);
  const windowRuns = recentEntries.length;
  const reasons: string[] = [];

  const runKnownUsd =
    options.runUsage !== undefined &&
    options.runUsage.estimated_usd !== null &&
    Number.isFinite(options.runUsage.estimated_usd)
      ? roundUsd(options.runUsage.estimated_usd)
      : 0;
  const additionalUsd =
    options.runUsage !== undefined
      ? options.runUsage.usage_known && options.runUsage.estimated_usd !== null
        ? roundUsd(options.runUsage.estimated_usd)
        : roundUsd(Math.max(maxRunUsd, runKnownUsd))
      : options.reserveRun === true
        ? maxRunUsd
        : 0;

  let projectedUsd: number;
  let effectiveObservedUsd = runKnownUsd;
  let effectiveTotalTokens =
    (options.runUsage?.input_tokens ?? 0) + (options.runUsage?.output_tokens ?? 0);
  if (existingMatch !== undefined && options.runUsage !== undefined) {
    const candidateEntry = buildSettledBudgetEntry({
      run_id: existingMatch.run_id,
      ...(existingMatch.run_attempt === undefined
        ? {}
        : { run_attempt: existingMatch.run_attempt }),
      provider_id: existingMatch.provider_id,
      usage: options.runUsage,
      outcome: existingMatch.outcome,
      limits,
    });
    const mergedRun = mergeBudgetEntries(existingMatch, candidateEntry);
    // An existing run whose original recorded_at predates the current window keeps its original
    // timestamp upon merge and does NOT add spend into the current rolling window.
    projectedUsd = existingInWindow
      ? roundUsd(otherWindowUsd + mergedRun.estimated_usd)
      : windowUsd;
    // Enforce per-run caps against the merged observed spend (never a pure conservative reserve)
    // and merged token counts regardless of whether the original entry aged out of the rolling window.
    effectiveObservedUsd = roundUsd(
      mergedRun.observed_usd ?? (mergedRun.usage_known ? mergedRun.estimated_usd : 0),
    );
    effectiveTotalTokens = Math.max(
      effectiveTotalTokens,
      (mergedRun.input_tokens ?? 0) + (mergedRun.output_tokens ?? 0),
    );
  } else {
    projectedUsd = roundUsd(windowUsd + additionalUsd);
  }
  if ((existingMatch === undefined && windowUsd >= maxWindowUsd) || projectedUsd > maxWindowUsd) {
    reasons.push(
      `Rolling ${limits.windowHours}h spend (${projectedUsd.toFixed(4)} USD) exceeds cap (${limits.maxWindowUsd.toFixed(2)} USD)`,
    );
  }
  if (options.runUsage === undefined && windowRuns >= limits.maxWindowRuns) {
    reasons.push(
      `Rolling ${limits.windowHours}h run count (${windowRuns}) reached cap (${limits.maxWindowRuns})`,
    );
  }
  if (options.runUsage !== undefined) {
    // Enforce per-run caps on any merged observed spend/tokens (ignoring pure conservative reserves).
    if (effectiveObservedUsd > maxRunUsd) {
      reasons.push(
        `Run spend (${effectiveObservedUsd.toFixed(4)} USD) exceeds per-run cap (${limits.maxRunUsd.toFixed(2)} USD)`,
      );
    }
    if (effectiveTotalTokens > limits.maxRunTokens) {
      reasons.push(
        `Run token count (${effectiveTotalTokens}) exceeds per-run cap (${limits.maxRunTokens})`,
      );
    }
  }

  const cooldownProviders: Record<string, string> = {};
  for (const entry of ledger.entries) {
    if (entry.outcome === "dry_run" || entry.outcome === "deferred") continue;
    const recorded = Date.parse(entry.recorded_at);
    if (!Number.isFinite(recorded)) continue;
    const expiresAt = recorded + cooldownMs;
    if (expiresAt > nowMs) {
      const existing = cooldownProviders[entry.provider_id];
      const candidate = new Date(expiresAt).toISOString();
      if (existing === undefined || candidate > existing) {
        cooldownProviders[entry.provider_id] = candidate;
      }
    }
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    window_usd: Number(windowUsd.toFixed(6)),
    window_runs: windowRuns,
    cooldown_providers: cooldownProviders,
  };
}

function maxOptionalInt(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

function mergeBudgetEntries(
  existingMatch: BudgetUsageEntry,
  validated: BudgetUsageEntry,
): BudgetUsageEntry {
  const earliestRecordedAt =
    Date.parse(existingMatch.recorded_at) <= Date.parse(validated.recorded_at)
      ? existingMatch.recorded_at
      : validated.recorded_at;
  const base = { ...validated, recorded_at: earliestRecordedAt };
  const mergedInputTokens = maxOptionalInt(existingMatch.input_tokens, validated.input_tokens);
  const mergedOutputTokens = maxOptionalInt(existingMatch.output_tokens, validated.output_tokens);
  if (existingMatch.usage_known && validated.usage_known) {
    const usd = Number(Math.max(existingMatch.estimated_usd, validated.estimated_usd).toFixed(6));
    return budgetUsageEntrySchema.parse({
      ...base,
      usage_known: true,
      input_tokens: mergedInputTokens,
      output_tokens: mergedOutputTokens,
      estimated_usd: usd,
      observed_usd: usd,
    });
  }
  if (existingMatch.usage_known || validated.usage_known) {
    const knownSide = existingMatch.usage_known ? existingMatch : validated;
    const unknownSide = existingMatch.usage_known ? validated : existingMatch;
    const knownObserved = knownSide.observed_usd ?? knownSide.estimated_usd;
    const unknownObserved = unknownSide.observed_usd ?? 0;
    // Preserve an explicitly observed spend floor (even without tokens) when it exceeds the known entry;
    // never confuse a pure conservative maxRunUsd reserve (`observed_usd === undefined`) with actual spend.
    if (unknownObserved > knownObserved) {
      return budgetUsageEntrySchema.parse({
        ...base,
        usage_known: false,
        input_tokens: mergedInputTokens,
        output_tokens: mergedOutputTokens,
        estimated_usd: Number(Math.max(unknownSide.estimated_usd, unknownObserved).toFixed(6)),
        observed_usd: Number(unknownObserved.toFixed(6)),
      });
    }
    return budgetUsageEntrySchema.parse({
      ...base,
      usage_known: true,
      input_tokens: mergedInputTokens,
      output_tokens: mergedOutputTokens,
      estimated_usd: knownSide.estimated_usd,
      observed_usd: Number(knownObserved.toFixed(6)),
    });
  }
  const maxObserved = Math.max(existingMatch.observed_usd ?? 0, validated.observed_usd ?? 0);
  return budgetUsageEntrySchema.parse({
    ...base,
    usage_known: false,
    input_tokens: mergedInputTokens,
    output_tokens: mergedOutputTokens,
    estimated_usd: Number(
      Math.max(existingMatch.estimated_usd, validated.estimated_usd, maxObserved).toFixed(6),
    ),
    ...(maxObserved > 0 ? { observed_usd: Number(maxObserved.toFixed(6)) } : {}),
  });
}

export function appendBudgetEntry(
  ledger: BudgetLedger,
  entry: BudgetUsageEntry,
  options: { nowMs?: number; retentionDays?: number } = {},
): BudgetLedger {
  const nowMs = options.nowMs ?? Date.now();
  const cutoffMs = nowMs - (options.retentionDays ?? 14) * 86_400_000;
  const validated = budgetUsageEntrySchema.parse(entry);
  const entryAttempt = validated.run_attempt ?? 1;
  let existingMatch: BudgetUsageEntry | undefined;
  const kept = ledger.entries.filter((item) => {
    const ts = Date.parse(item.recorded_at);
    if (!Number.isFinite(ts) || ts < cutoffMs) return false;
    if (item.run_id === validated.run_id && (item.run_attempt ?? 1) === entryAttempt) {
      existingMatch = item;
      return false;
    }
    return true;
  });
  const merged =
    existingMatch === undefined ? validated : mergeBudgetEntries(existingMatch, validated);
  return { version: 1, entries: [...kept, merged] };
}

export async function readBudgetLedger(path: string): Promise<BudgetLedger> {
  const raw = await readJson(path);
  return raw === undefined ? emptyBudgetLedger() : budgetLedgerSchema.parse(raw);
}

export async function writeBudgetLedger(path: string, ledger: BudgetLedger): Promise<void> {
  await atomicWrite(path, `${JSON.stringify(budgetLedgerSchema.parse(ledger), null, 2)}\n`);
}

async function main(): Promise<void> {
  const [command, ledgerPath, usagePath] = process.argv.slice(2);
  if (!command || !ledgerPath) {
    throw new Error("Usage: budget.ts check <ledger.json> [usage.json]");
  }
  const ledger = await readBudgetLedger(resolve(ledgerPath));
  const limits = parseBudgetLimitsFromEnv();
  if (command === "check") {
    const runUsage: RunUsageInput | undefined =
      usagePath === undefined
        ? undefined
        : z
            .object({
              usage_known: z.boolean().default(true),
              input_tokens: z.number().int().nonnegative().nullable(),
              output_tokens: z.number().int().nonnegative().nullable(),
              estimated_usd: z.number().nonnegative().nullable(),
            })
            .parse(JSON.parse(await readFile(resolve(usagePath), "utf8")));
    const result = evaluateBudget(ledger, {
      limits,
      reserveRun: runUsage === undefined,
      ...(runUsage === undefined ? {} : { runUsage }),
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.allowed) process.exitCode = 1;
    return;
  }
  throw new Error(`Unknown budget command: ${command}`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
