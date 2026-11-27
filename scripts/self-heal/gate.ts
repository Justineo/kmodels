import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { sha256 } from "../../src/catalog/io.ts";
import { sourceErrorMessage } from "../../src/catalog/source-failure.ts";
import {
  repairableReconciliationReasons,
  type CatalogRepairCandidate,
} from "../../src/catalog/catalog-repair.ts";
import { moduleDependencies } from "../module-dependencies.ts";
import { runGit, sanitizedUntrustedEnv, SELF_HEAL_MAX_BUFFER } from "./runtime.ts";
import {
  hasOmittedDependencyFailure,
  inspectTargetReplayReadiness,
  isGenericParseFailureMessage,
  mayBeRedactedOrTruncatedMessage,
  nonReplayVerifiableTriggers,
  primaryCandidateMessage,
  type BoundEvidenceFile,
} from "./triage.ts";

export type DeliveryMode = "auto_push" | "draft_pr" | "rejected";

export interface GateVerdict {
  ok: boolean;
  mode: DeliveryMode;
  target_provider?: string;
  changed_files: string[];
  protected_files: string[];
  forbidden_files: string[];
  violations: string[];
  replayed_sources: string[];
  replay_unavailable?: true;
}

const HARD_FORBIDDEN_PATTERNS: readonly RegExp[] = [
  /^\.github\//,
  /^scripts\/self-heal\//,
  /^scripts\/replay-catalog-evidence\.ts$/,
  /^scripts\/validate-changes\.ts$/,
  /^scripts\/deployment-receipt\.ts$/,
  /^src\/catalog\/transport\//,
  /^data\//,
  /^packages\//,
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^vite\.config\.ts$/,
  /^tsconfig[^/]*\.json$/,
];

const PROTECTED_CORE_CATALOG_FILES = new Set([
  "src/catalog/collector.ts",
  "src/catalog/collection-shards.ts",
  "src/catalog/fetch.ts",
  "src/catalog/io.ts",
  "src/catalog/manifests.ts",
  "src/catalog/pricing-adapter.ts",
  "src/catalog/pricing-assembly.ts",
  "src/catalog/pricing-canonical.ts",
  "src/catalog/pricing-constants.ts",
  "src/catalog/pricing-envelope.ts",
  "src/catalog/pricing-lookup-export.ts",
  "src/catalog/pricing-publication.ts",
  "src/catalog/pricing-schema.ts",
  "src/catalog/pricing-validation.ts",
  "src/catalog/sagemaker-marketplace-api.ts",
  "src/catalog/schema.ts",
  "src/catalog/source-contract.ts",
]);

/** Central registries that naturally import every provider module; excluded from cross-provider sharing checks. */
const CENTRAL_PROVIDER_REGISTRIES = new Set([
  "src/catalog/adapters.ts",
  "src/catalog/manifests.ts",
  "src/catalog/pricing-adapter.ts",
  "src/catalog/fetch.ts",
  "src/catalog/collector.ts",
  "src/catalog/commercial-selection-policies.ts",
  "src/catalog/inference-pricing-source.ts",
]);

/** Exact provider ID -> owned file stems across src/catalog/, docs/providers/, and tests/. */
export const PROVIDER_OWNED_STEMS: Readonly<Record<string, readonly string[]>> = {
  "amazon-bedrock": ["amazon-bedrock", "bedrock"],
  "amazon-sagemaker": ["amazon-sagemaker", "sagemaker"],
  anthropic: ["anthropic"],
  azure: ["azure"],
  cerebras: ["cerebras"],
  cohere: ["cohere"],
  dashscope: ["dashscope"],
  databricks: ["databricks"],
  deepseek: ["deepseek"],
  fireworks: ["fireworks"],
  gemini: ["gemini"],
  huggingface: ["huggingface"],
  kimi: ["kimi"],
  meta: ["meta"],
  mistral: ["mistral"],
  nvidia: ["nvidia", "nvidia-nim"],
  ollama: ["ollama"],
  openai: ["openai"],
  together: ["together"],
  typesafe: ["typesafe"],
  vercel: ["vercel"],
  vertex: ["vertex"],
  xai: ["xai"],
};

function matchesProviderStem(name: string, stems: readonly string[]): boolean {
  return stems.some((stem) => name === stem || name.startsWith(`${stem}-`));
}

/**
 * Inspect actual `src/catalog/*.ts` runtime/static imports to detect cross-provider sharing
 * (for example `databricks.ts` importing `gemini.ts`, or `azure.ts` importing `anthropic-price-row.ts`).
 * Any file imported by another provider's code is NOT exclusively owned by `targetProviderId`.
 */
export function findCrossProviderImporters(
  filePath: string,
  targetProviderId: string,
  repoRoot = resolve("."),
): string[] {
  if (!filePath.startsWith("src/catalog/") || !filePath.endsWith(".ts")) return [];
  const stems = PROVIDER_OWNED_STEMS[targetProviderId];
  if (stems === undefined) return [];
  const catalogDir = join(repoRoot, "src", "catalog");
  if (!existsSync(catalogDir)) return [];

  const importers: string[] = [];
  for (const entry of readdirSync(catalogDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
    const candidatePath = `src/catalog/${entry.name}`;
    if (candidatePath === filePath || CENTRAL_PROVIDER_REGISTRIES.has(candidatePath)) continue;
    const stemName = entry.name.slice(0, -3);
    if (matchesProviderStem(stemName, stems)) continue;
    try {
      const source = readFileSync(join(catalogDir, entry.name), "utf8");
      const deps = moduleDependencies(candidatePath, source);
      if (deps.includes(filePath)) importers.push(candidatePath);
    } catch {
      // Ignore unreadable files.
    }
  }
  return importers.sort();
}

export function isAutoPushAllowedPath(
  path: string,
  targetProviderId?: string,
  options: { repoRoot?: string; checkReverseDeps?: boolean } = {},
): boolean {
  if (!targetProviderId) return false;
  const stems = PROVIDER_OWNED_STEMS[targetProviderId];
  if (stems === undefined || stems.length === 0) return false;

  const docMatch = path.match(/^docs\/providers\/([^/]+)\.md$/);
  if (docMatch?.[1] !== undefined) {
    return stems.includes(docMatch[1]);
  }

  const catalogMatch = path.match(/^src\/catalog\/([^/]+)\.ts$/);
  if (catalogMatch?.[1] !== undefined) {
    if (PROTECTED_CORE_CATALOG_FILES.has(path)) return false;
    if (!matchesProviderStem(catalogMatch[1], stems)) return false;
    if (options.checkReverseDeps !== false) {
      const crossImporters = findCrossProviderImporters(
        path,
        targetProviderId,
        options.repoRoot ?? resolve("."),
      );
      if (crossImporters.length > 0) return false;
    }
    return true;
  }

  const testMatch = path.match(/^tests\/([^/]+)\.test\.ts$/);
  if (testMatch?.[1] !== undefined) {
    return matchesProviderStem(testMatch[1], stems);
  }

  const fixtureMatch = path.match(/^tests\/fixtures\/([^/]+)\/.+$/);
  if (fixtureMatch?.[1] !== undefined) {
    return matchesProviderStem(fixtureMatch[1], stems);
  }

  return false;
}

export function classifyChangedPaths(
  paths: readonly string[],
  targetProviderId?: string,
  options: { repoRoot?: string; checkReverseDeps?: boolean } = {},
): {
  mode: DeliveryMode;
  forbidden_files: string[];
  protected_files: string[];
} {
  if (paths.length === 0) {
    return { mode: "rejected", forbidden_files: [], protected_files: [] };
  }
  const forbidden_files: string[] = [];
  const protected_files: string[] = [];
  for (const path of paths) {
    if (HARD_FORBIDDEN_PATTERNS.some((pattern) => pattern.test(path))) {
      forbidden_files.push(path);
    } else if (!isAutoPushAllowedPath(path, targetProviderId, options)) {
      protected_files.push(path);
    }
  }
  if (forbidden_files.length > 0) {
    return { mode: "rejected", forbidden_files, protected_files };
  }
  return {
    mode: protected_files.length > 0 ? "draft_pr" : "auto_push",
    forbidden_files,
    protected_files,
  };
}

/** Extract exact repo-relative file paths touched by a unified git patch. */
export function parsePatchPaths(patchText: string): string[] {
  const paths = new Set<string>();
  for (const line of patchText.split("\n")) {
    const diffMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (diffMatch !== null) {
      const left = diffMatch[1];
      const right = diffMatch[2];
      if (left !== undefined && left !== "/dev/null") paths.add(left);
      if (right !== undefined && right !== "/dev/null") paths.add(right);
    }
  }
  return [...paths].sort();
}

const THRESHOLD_ASSIGNMENT_RE =
  /\b(minModels|minDocuments|minProducts|minCards|minModelDocuments)\s*:\s*(\d+)/g;
const THRESHOLD_DIFF_RE =
  /^([+-]).*\b(minModels|minDocuments|minProducts|minCards|minModelDocuments)\s*:\s*(\d+)/;

/**
 * Extract numeric collection thresholds keyed by owning source identity (`id: "..."` or
 * enclosing function/block scope) so independent sources in the same file are compared
 * individually rather than via file-wide min/max.
 */
export function extractSourceThresholds(source: string): Map<string, number> {
  const result = new Map<string, number>();
  let currentScope = "<module>";
  const occurrenceByKey = new Map<string, number>();
  for (const line of source.split("\n")) {
    const idMatch = line.match(/\bid\s*:\s*["'`]([a-z0-9._:/-]+)["'`]/i);
    if (idMatch?.[1] !== undefined) {
      currentScope = idMatch[1];
    } else {
      const fnMatch = line.match(/\bfunction\s+([A-Za-z0-9_]+)\s*\(/);
      if (fnMatch?.[1] !== undefined) {
        currentScope = `fn:${fnMatch[1]}`;
      }
    }
    for (const match of line.matchAll(THRESHOLD_ASSIGNMENT_RE)) {
      const field = match[1];
      const rawValue = match[2];
      if (field === undefined || rawValue === undefined) continue;
      const baseKey = `${currentScope}:${field}`;
      const count = occurrenceByKey.get(baseKey) ?? 0;
      occurrenceByKey.set(baseKey, count + 1);
      const key = count === 0 ? baseKey : `${baseKey}#${count}`;
      result.set(key, Number(rawValue));
    }
  }
  return result;
}

function auditAddedContent(filePath: string, addedLines: readonly string[]): string[] {
  const violations: string[] = [];
  for (const added of addedLines) {
    if (
      filePath.startsWith("tests/") &&
      /\b(?:it|test|describe)\.(?:skip|only|todo)\b/.test(added)
    ) {
      violations.push(`${filePath}: cannot skip or focus tests`);
    }
    if (/\.(?:ts|vue)$/.test(filePath) && filePath !== "tests/fixtures/pricing/consumer.ts.txt") {
      if (/(?::\s*any\b|\bas\s+any\b)/.test(added)) {
        violations.push(`${filePath}: cannot introduce 'any' type`);
      }
      if (/@ts-(?:ignore|nocheck)\b|eslint-disable|oxlint-disable/.test(added)) {
        violations.push(`${filePath}: cannot suppress type or lint checks`);
      }
    }
    if (
      filePath.startsWith("src/") &&
      !filePath.startsWith("src/catalog/transport/") &&
      /\bprocess\.env\b/.test(added)
    ) {
      violations.push(`${filePath}: cannot read process.env outside src/catalog/transport/`);
    }
  }
  return violations;
}

/**
 * Audit a unified git diff plus optional full before/after file snapshots and untracked files
 * for policy weakenings.
 */
export function auditDiffSafety(
  unifiedDiff: string,
  options: {
    untrackedFiles?: Readonly<Record<string, string>>;
    beforeFiles?: Readonly<Record<string, string>>;
    afterFiles?: Readonly<Record<string, string>>;
  } = {},
): string[] {
  const violations: string[] = [];
  let currentFile = "";
  const addedByFile = new Map<string, string[]>();
  const removedFallback = new Map<string, number>();
  const addedFallback = new Map<string, number>();

  for (const line of unifiedDiff.split("\n")) {
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice(6);
      continue;
    }
    if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("@@")) continue;

    if (options.beforeFiles === undefined && options.afterFiles === undefined) {
      const thresholdMatch = line.match(THRESHOLD_DIFF_RE);
      if (thresholdMatch !== null) {
        const [, sign, field, rawValue] = thresholdMatch;
        const value = Number(rawValue);
        const key = `${currentFile}:${field}`;
        if (sign === "-") {
          removedFallback.set(key, Math.max(removedFallback.get(key) ?? 0, value));
        } else if (sign === "+") {
          const previous = addedFallback.get(key);
          addedFallback.set(key, previous === undefined ? value : Math.min(previous, value));
        }
      }
    }

    if (!line.startsWith("+")) continue;
    const list = addedByFile.get(currentFile) ?? [];
    list.push(line.slice(1));
    addedByFile.set(currentFile, list);
  }

  for (const [filePath, lines] of addedByFile) {
    violations.push(...auditAddedContent(filePath, lines));
  }

  for (const [filePath, content] of Object.entries(options.untrackedFiles ?? {})) {
    violations.push(...auditAddedContent(filePath, content.split("\n")));
  }

  if (options.beforeFiles !== undefined && options.afterFiles !== undefined) {
    for (const [filePath, beforeContent] of Object.entries(options.beforeFiles)) {
      if (!filePath.endsWith(".ts")) continue;
      const afterContent = options.afterFiles[filePath] ?? "";
      const beforeThresholds = extractSourceThresholds(beforeContent);
      const afterThresholds = extractSourceThresholds(afterContent);
      for (const [key, oldMin] of beforeThresholds) {
        const newMin = afterThresholds.get(key);
        if (newMin === undefined) {
          violations.push(`${filePath}:${key}: removed collection threshold (was ${oldMin})`);
        } else if (newMin < oldMin) {
          violations.push(`${filePath}:${key}: lowered threshold from ${oldMin} to ${newMin}`);
        }
      }
    }
  } else {
    for (const [key, oldMin] of removedFallback) {
      const newMin = addedFallback.get(key);
      if (newMin === undefined) {
        violations.push(`${key}: removed collection threshold (was ${oldMin})`);
      } else if (newMin < oldMin) {
        violations.push(`${key}: lowered threshold from ${oldMin} to ${newMin}`);
      }
    }
  }

  return [...new Set(violations)];
}

const replayContractDiagnosticSchema = z.object({
  kind: z.string().min(1),
  path: z.string().optional(),
  affected_items: z.number().int().nonnegative().optional(),
});

const replayStructuredFindingSchema = z.object({
  disposition: z.enum(["reject", "accept_with_signal"]).optional(),
  diagnostics: z.array(replayContractDiagnosticSchema),
});

const replayContractFindingSchema = z.union([
  replayStructuredFindingSchema,
  replayContractDiagnosticSchema,
]);

const replaySummarySchema = z.object({
  schema_version: z.literal(1),
  stage: z.literal("parse"),
  source_id: z.string().min(1),
  source_hash: z.string().optional(),
  models: z.array(z.unknown()),
  contract_findings: z.array(replayContractFindingSchema).optional(),
  contract_findings_omitted: z.number().int().nonnegative().optional(),
  contract_findings_total: z.number().int().nonnegative().optional(),
  contract_reject_findings: z.number().int().nonnegative().optional(),
  contract_diagnostic_counts: z.record(z.string(), z.number().int().nonnegative()).optional(),
  contract_reject_diagnostic_counts: z
    .record(z.string(), z.number().int().nonnegative())
    .optional(),
  reconciliation: z
    .object({
      reason_counts: z.record(z.string(), z.number().int().nonnegative()).optional(),
    })
    .nullable()
    .optional(),
});

type ReplaySummary = z.infer<typeof replaySummarySchema>;

function contractDiagnosticKey(diagnostic: { kind: string; path?: string | undefined }): string {
  return `${diagnostic.kind}:${diagnostic.path ?? "/"}`;
}

function buildDiagnosticCounts(
  precomputed: Readonly<Record<string, number>> | undefined,
  findings: ReplaySummary["contract_findings"],
  rejectOnly: boolean,
): Map<string, number> {
  const counts = new Map<string, number>();
  if (precomputed !== undefined) {
    for (const [key, value] of Object.entries(precomputed)) {
      if (value > 0) counts.set(key, value);
    }
    return counts;
  }
  for (const finding of findings ?? []) {
    if (rejectOnly && (!("disposition" in finding) || finding.disposition !== "reject")) continue;
    const items = "diagnostics" in finding ? finding.diagnostics : [finding];
    for (const diagnostic of items) {
      const key = contractDiagnosticKey(diagnostic);
      const weight =
        diagnostic.affected_items !== undefined && diagnostic.affected_items > 0
          ? diagnostic.affected_items
          : 1;
      counts.set(key, (counts.get(key) ?? 0) + weight);
    }
  }
  return counts;
}

function contractDiagnosticCounts(summary: ReplaySummary): Map<string, number> {
  return buildDiagnosticCounts(
    summary.contract_diagnostic_counts,
    summary.contract_findings,
    false,
  );
}

function totalContractFindings(summary: ReplaySummary): number {
  return (
    summary.contract_findings_total ??
    (summary.contract_findings?.length ?? 0) + (summary.contract_findings_omitted ?? 0)
  );
}

function isUnknownFieldKey(key: string): boolean {
  return key === "unknown_field" || key.startsWith("unknown_field:");
}

function rejectContractDiagnosticCounts(summary: ReplaySummary): Map<string, number> {
  return buildDiagnosticCounts(
    summary.contract_reject_diagnostic_counts,
    summary.contract_findings,
    true,
  );
}

function nonExtensionContractDiagnosticKeys(counts: ReadonlyMap<string, number>): string[] {
  return [...counts.entries()]
    .filter(([key, count]) => count > 0 && !isUnknownFieldKey(key))
    .map(([key]) => key)
    .sort();
}

function extractTargetContractDiagnosticKeys(
  candidates: readonly CatalogRepairCandidate[],
): Set<string> {
  const keys = new Set<string>();
  for (const candidate of candidates) {
    for (const diagnostic of candidate.diagnostics) {
      // `unknown_field` from accept_with_signal is informational (not contract drift);
      // however `unknown_field` with disposition="reject" (strict schema rejection) IS a required failure path.
      if (diagnostic.kind === "unknown_field" && diagnostic.disposition !== "reject") continue;
      keys.add(contractDiagnosticKey(diagnostic));
    }
  }
  return keys;
}

function repairableReasonCounts(summary: z.infer<typeof replaySummarySchema>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [reason, value] of Object.entries(summary.reconciliation?.reason_counts ?? {})) {
    if (repairableReconciliationReasons.has(reason) && value > 0) {
      counts.set(reason, value);
    }
  }
  return counts;
}

function countRepairableDiagnostics(summary: z.infer<typeof replaySummarySchema>): number {
  let count = summary.contract_findings?.length ?? 0;
  for (const value of repairableReasonCounts(summary).values()) {
    count += value;
  }
  return count;
}

function extractTargetReconciliationReasons(
  candidates: readonly CatalogRepairCandidate[],
): Set<string> {
  const reasons = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.reconciliation_reasons !== undefined) {
      for (const [reason, count] of Object.entries(candidate.reconciliation_reasons)) {
        if (count > 0 && repairableReconciliationReasons.has(reason)) {
          reasons.add(reason);
        }
      }
    }
    const summaryMatch = candidate.message.match(/Missing reviewed source contracts:\s*([^.]+)/);
    if (summaryMatch?.[1] !== undefined) {
      for (const part of summaryMatch[1].split(",")) {
        const code = part.split(":")[0]?.trim();
        if (code && repairableReconciliationReasons.has(code)) {
          reasons.add(code);
        }
      }
    }
  }
  return reasons;
}

const ENVIRONMENT_ERROR_PATTERN =
  /ERR_MODULE_NOT_FOUND|Cannot find (?:package|module)|ENOENT: no such file|EACCES:|SyntaxError: Cannot use import statement|requires (?:the collected |the |parsed )?catalog/i;

export function needsBrowserPrerequisite(commands: readonly (readonly string[])[]): boolean {
  return commands.some(
    ([task, script]) =>
      task === "run" && (script === "test:e2e" || script === "test:pricing-performance"),
  );
}

/**
 * Preserve identifier casing (e.g. `Model-X` vs `model-x`) while canonicalizing collector/replay
 * redaction and whitespace so distinct case-sensitive registry keys remain distinguishable.
 */
function normalizeFailureMessage(raw: string): string {
  return sourceErrorMessage(new Error(raw)).trim().replace(/\s+/g, " ").replace(/\.+$/, "");
}

/**
 * Extract concrete parse-failure message(s) (both normalized for comparison and raw for truncation/redaction checks)
 * recorded on targeted `source_parse_failure` candidates.
 */
function extractTargetParseFailureMessages(candidates: readonly CatalogRepairCandidate[]): {
  normalized: Set<string>;
  raw: string[];
} {
  const normalized = new Set<string>();
  const raw: string[] = [];
  const record = (text: string) => {
    const norm = normalizeFailureMessage(text);
    if (norm.length > 0 && !isGenericParseFailureMessage(norm)) {
      normalized.add(norm);
      raw.push(text);
    }
  };
  for (const candidate of candidates) {
    const triggers = candidate.triggers ?? [candidate.trigger];
    if (!triggers.includes("source_parse_failure")) continue;
    for (const dep of candidate.dependency_parse_failures ?? []) {
      record(dep.message);
    }
    const primary = primaryCandidateMessage(candidate.message);
    const depPrefix = "Dependency evidence requires investigation:";
    const depIdx = primary.indexOf(depPrefix);
    if (depIdx >= 0) {
      const beforeDep = primary.slice(0, depIdx).trim();
      if (beforeDep.length > 0) record(beforeDep);
      const rest = primary.slice(depIdx + depPrefix.length);
      for (const segment of rest.split(";")) {
        const trimmed = segment.trim();
        if (!trimmed || trimmed === "additional failures omitted") continue;
        const colonIdx = trimmed.indexOf(":");
        const detail = colonIdx >= 0 ? trimmed.slice(colonIdx + 1) : trimmed;
        record(detail);
      }
      continue;
    }
    record(primary);
  }
  return { normalized, raw };
}

const replayParseErrorSchema = z.object({
  schema_version: z.literal(1),
  stage: z.enum(["input_error", "evidence_error", "context_error", "parse_error"]),
  source_id: z.string().min(1),
  source_hash: z.string().optional(),
  error_name: z.string().optional(),
  error_fingerprint: z
    .string()
    .regex(/^[0-9a-f]{16}$/u)
    .optional(),
  message: z.string().optional(),
  contract_finding: replayStructuredFindingSchema.optional(),
  contract_findings: z.array(replayContractFindingSchema).optional(),
  contract_diagnostic_counts: z.record(z.string(), z.number().int().nonnegative()).optional(),
});

function parseBaselineReplayError(
  output: string,
  expectedSourceId: string,
): {
  structured: boolean;
  stage?: "input_error" | "evidence_error" | "context_error" | "parse_error";
  sourceMismatch?: string;
  sourceHash?: string;
  errorFingerprint?: string;
  message?: string;
  keys: Set<string>;
} {
  const keys = new Set<string>();
  let structured = false;
  let stage: "input_error" | "evidence_error" | "context_error" | "parse_error" | undefined;
  let sourceMismatch: string | undefined;
  let sourceHash: string | undefined;
  let errorFingerprint: string | undefined;
  let message: string | undefined;
  for (const rawLine of output.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("{") || !line.endsWith("}")) continue;
    try {
      const parsed = replayParseErrorSchema.safeParse(JSON.parse(line));
      if (parsed.success) {
        structured = true;
        stage = parsed.data.stage;
        if (parsed.data.source_id !== expectedSourceId) {
          sourceMismatch = parsed.data.source_id;
          continue;
        }
        if (parsed.data.source_hash !== undefined) sourceHash = parsed.data.source_hash;
        if (parsed.data.error_fingerprint !== undefined) {
          errorFingerprint = parsed.data.error_fingerprint;
        }
        if (parsed.data.message !== undefined && parsed.data.message.trim().length > 0) {
          message = parsed.data.message;
        }
        if (parsed.data.stage === "parse_error") {
          if (parsed.data.contract_diagnostic_counts !== undefined) {
            for (const [key, count] of Object.entries(parsed.data.contract_diagnostic_counts)) {
              if (count > 0 && !isUnknownFieldKey(key)) {
                keys.add(key);
              }
            }
          }
          // `contract_finding` is always the thrown SourceContractError (disposition="reject"): retain all its diagnostics including strict `unknown_field` paths.
          for (const diagnostic of parsed.data.contract_finding?.diagnostics ?? []) {
            keys.add(contractDiagnosticKey(diagnostic));
          }
          for (const finding of parsed.data.contract_findings ?? []) {
            const isReject = "disposition" in finding && finding.disposition === "reject";
            const items = "diagnostics" in finding ? finding.diagnostics : [finding];
            for (const diagnostic of items) {
              if (diagnostic.kind === "unknown_field" && !isReject) continue;
              keys.add(contractDiagnosticKey(diagnostic));
            }
          }
        }
      }
    } catch {
      // Ignore non-JSON stderr lines.
    }
  }
  return {
    structured,
    ...(stage === undefined ? {} : { stage }),
    ...(sourceMismatch === undefined ? {} : { sourceMismatch }),
    ...(sourceHash === undefined ? {} : { sourceHash }),
    ...(errorFingerprint === undefined ? {} : { errorFingerprint }),
    ...(message === undefined ? {} : { message }),
    keys,
  };
}

function parseReplaySummary(
  role: "Candidate" | "Baseline",
  stdout: string,
  sourceId: string,
): { ok: true; summary: ReplaySummary } | { ok: false; reason: string; replayUnavailable?: true } {
  let summary: ReplaySummary;
  try {
    summary = replaySummarySchema.parse(JSON.parse(stdout));
  } catch (error) {
    return {
      ok: false,
      replayUnavailable: true,
      reason: `${role} replay produced invalid summary JSON for ${sourceId} (${Buffer.byteLength(stdout)} stdout bytes): ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (summary.source_id !== sourceId) {
    return {
      ok: false,
      reason: `${role} replay summary belonged to ${summary.source_id}, expected ${sourceId}`,
    };
  }
  return { ok: true, summary };
}

function inspectBaselineNonZeroError(
  baseline: ReplayOutput,
  sourceId: string,
):
  | { ok: true; combined: string; parsed: ReturnType<typeof parseBaselineReplayError> }
  | { ok: false; reason: string } {
  const combined = `${baseline.stderr}\n${baseline.stdout}`.trim();
  if (combined.length === 0) {
    return {
      ok: false,
      reason: `Baseline replay for ${sourceId} exited ${baseline.status} with empty output; failure evidence missing`,
    };
  }
  if (ENVIRONMENT_ERROR_PATTERN.test(combined)) {
    return {
      ok: false,
      reason: `Baseline replay failed due to environment/context error for ${sourceId}: ${combined.slice(0, 300)}`,
    };
  }
  const parsed = parseBaselineReplayError(combined, sourceId);
  if (parsed.sourceMismatch !== undefined) {
    return {
      ok: false,
      reason: `Baseline parse error belonged to ${parsed.sourceMismatch}, expected ${sourceId}`,
    };
  }
  return { ok: true, combined, parsed };
}

function checkCandidateCleanAfterParseFailure(
  sourceId: string,
  candidateContractCounts: ReadonlyMap<string, number>,
  candidateReasons: ReadonlyMap<string, number>,
): { ok: boolean; reason?: string } {
  const candidateDriftKeys = nonExtensionContractDiagnosticKeys(candidateContractCounts);
  if (candidateDriftKeys.length > 0) {
    return {
      ok: false,
      reason: `Candidate replay for ${sourceId} contains unresolved/new contract diagnostic(s): ${candidateDriftKeys.join(", ")}`,
    };
  }
  if (candidateReasons.size > 0) {
    return {
      ok: false,
      reason: `Candidate replay for ${sourceId} contains unresolved/new reconciliation diagnostic(s): ${[...candidateReasons.keys()].sort().join(", ")}`,
    };
  }
  return { ok: true };
}

function checkNoMapRegression(
  sourceId: string,
  label: string,
  baseline: ReadonlyMap<string, number>,
  candidate: ReadonlyMap<string, number>,
): string | undefined {
  for (const [key, candCount] of candidate) {
    const baseCount = baseline.get(key) ?? 0;
    if (candCount > baseCount) {
      return `Candidate replay for ${sourceId} regressed ${label} ${key} (${baseCount} -> ${candCount})`;
    }
  }
  return undefined;
}

function checkTargetKeysReduced(
  sourceId: string,
  label: string,
  keys: ReadonlySet<string>,
  getBaselineCount: (key: string) => number,
  getCandidateCount: (key: string) => number,
): string | undefined {
  const unreproduced: string[] = [];
  const unresolved: string[] = [];
  for (const key of [...keys].sort()) {
    const baseCount = getBaselineCount(key);
    const candCount = getCandidateCount(key);
    if (baseCount === 0) unreproduced.push(key);
    else if (candCount >= baseCount) unresolved.push(`${key} (${baseCount} -> ${candCount})`);
  }
  if (unreproduced.length > 0) {
    return `Baseline replay for ${sourceId} did not reproduce ${label}: ${unreproduced.join(", ")}`;
  }
  if (unresolved.length > 0) {
    return `Candidate replay for ${sourceId} did not reduce ${label}: ${unresolved.join(", ")}`;
  }
  return undefined;
}

type ReplayOutput = { status: number | null; stdout: string; stderr: string };

function checkBaselineParseFailure(
  sourceId: string,
  baseline: ReplayOutput,
  matchingCandidates: readonly CatalogRepairCandidate[],
  fallbackSourceHash?: string,
): string | undefined {
  const targetContractKeys = extractTargetContractDiagnosticKeys(matchingCandidates);
  const targetParseMessages = extractTargetParseFailureMessages(matchingCandidates);
  if (matchingCandidates.some(hasOmittedDependencyFailure)) {
    return `Target for ${sourceId} includes omitted dependency failure(s) that cannot be completely verified via single-source replay`;
  }
  if (baseline.status === null) {
    return `Baseline replay for ${sourceId} terminated without a normal exit code (status: null)`;
  }
  if (baseline.status === 0) {
    return `Baseline replay for ${sourceId} exited 0 and did not reproduce source_parse_failure`;
  }
  const inspected = inspectBaselineNonZeroError(baseline, sourceId);
  if (!inspected.ok) return inspected.reason;
  const parsedError = inspected.parsed;
  if (!parsedError.structured) {
    return `Baseline replay for ${sourceId} did not emit a structured replay parse_error payload; original failure cannot be verified`;
  }
  if (parsedError.stage !== "parse_error") {
    return `Baseline replay for ${sourceId} failed at stage ${parsedError.stage ?? "unknown"} instead of parse_error`;
  }
  const targetFingerprints = new Set(
    matchingCandidates
      .map((c) => c.error_fingerprint)
      .filter((fp): fp is string => fp !== undefined),
  );
  const targetSourceHashes = new Set(
    matchingCandidates.map((c) => c.source_hash).filter((h): h is string => h !== undefined),
  );
  if (targetSourceHashes.size > 0) {
    const observedHash = parsedError.sourceHash ?? fallbackSourceHash;
    if (observedHash === undefined || !targetSourceHashes.has(observedHash)) {
      return `Replay evidence source_hash (${observedHash ?? "missing"}) does not match failing collection body hash for ${sourceId}`;
    }
  }
  if (targetFingerprints.size > 0) {
    if (
      parsedError.errorFingerprint === undefined ||
      !targetFingerprints.has(parsedError.errorFingerprint)
    ) {
      return `Baseline parse_error fingerprint (${parsedError.errorFingerprint ?? "missing"}) did not match targeted failure fingerprint for ${sourceId}`;
    }
  }
  if (targetContractKeys.size > 0) {
    // Target carries structured contract diagnostics: baseline MUST emit ALL of them in structured parse_error
    // (including findings accumulated via onContractFinding prior to the final throw).
    const missingFromBaseline = [...targetContractKeys]
      .sort()
      .filter((key) => !parsedError.keys.has(key));
    if (missingFromBaseline.length > 0) {
      return `Baseline parse error for ${sourceId} did not reproduce target contract diagnostic(s): ${missingFromBaseline.join(", ")}`;
    }
  }
  // Independently verify the final terminating exception message (even when pre-throw contract
  // diagnostics were also present, e.g. Vercel emitting `/name` before throwing a distinct error).
  const normalizedBaselineMessage =
    parsedError.message === undefined ? "" : normalizeFailureMessage(parsedError.message);
  if (targetParseMessages.normalized.size === 0 || normalizedBaselineMessage.length === 0) {
    return `Cannot identify original parse failure for ${sourceId}; refusing to treat arbitrary parse_error as verified`;
  }
  if (targetParseMessages.normalized.size > 1) {
    return `Target for ${sourceId} records ${targetParseMessages.normalized.size} distinct parse failures; single-source replay cannot verify all of them`;
  }
  if (!targetParseMessages.normalized.has(normalizedBaselineMessage)) {
    return `Baseline parse_error for ${sourceId} ("${parsedError.message}") did not match targeted failure message`;
  }
  // Check raw pre-normalized text for 1,024-char truncation or redaction placeholders.
  const hasAmbiguousRedactionOrTruncation =
    targetParseMessages.raw.some(mayBeRedactedOrTruncatedMessage) ||
    (parsedError.message !== undefined && mayBeRedactedOrTruncatedMessage(parsedError.message));
  if (
    hasAmbiguousRedactionOrTruncation &&
    targetFingerprints.size === 0 &&
    targetSourceHashes.size === 0
  ) {
    return `Redacted or truncated failure message for ${sourceId} lacks error_fingerprint or source_hash binding; refusing to match ambiguous redacted text`;
  }
  return undefined;
}

export function evaluateBeforeAfterReplay(params: {
  sourceId: string;
  baseline: ReplayOutput;
  candidate: ReplayOutput;
  targetCandidates?: readonly CatalogRepairCandidate[];
}): { ok: boolean; reason?: string; replayUnavailable?: true } {
  const { sourceId, baseline, candidate } = params;
  const allTargets = params.targetCandidates ?? [];
  const matchingCandidates = allTargets.filter((item) => item.source_id === sourceId);
  if (allTargets.length > 0 && matchingCandidates.length === 0) {
    return {
      ok: false,
      reason: `Source ${sourceId} is not a targeted source candidate; unrelated source replay cannot verify provider-level failure`,
    };
  }
  const unsupportedTriggers = nonReplayVerifiableTriggers(matchingCandidates);
  if (unsupportedTriggers.length > 0) {
    return {
      ok: false,
      reason: `Target trigger(s) cannot be verified via single-source offline replay: ${unsupportedTriggers.join(", ")}`,
    };
  }
  const targetReasons = extractTargetReconciliationReasons(matchingCandidates);
  const targetContractKeys = extractTargetContractDiagnosticKeys(matchingCandidates);
  const expectsContractFinding = matchingCandidates.some(
    (item) =>
      (item.triggers ?? [item.trigger]).includes("source_contract_change") ||
      item.diagnostics.some((d) => d.kind !== "unknown_field"),
  );
  const expectsParseFailure = matchingCandidates.some((item) =>
    (item.triggers ?? [item.trigger]).includes("source_parse_failure"),
  );

  if (candidate.status !== 0) {
    return {
      ok: false,
      reason: `Candidate replay failed for ${sourceId}: ${(candidate.stderr || candidate.stdout).trim().slice(0, 300)}`,
    };
  }
  const parsedCandidate = parseReplaySummary("Candidate", candidate.stdout, sourceId);
  if (!parsedCandidate.ok) return parsedCandidate;
  const candidateSummary = parsedCandidate.summary;

  const candidateContractCounts = contractDiagnosticCounts(candidateSummary);
  const candidateRejectContractCounts = rejectContractDiagnosticCounts(candidateSummary);
  const candidateReasons = repairableReasonCounts(candidateSummary);

  // Branch 1: `source_parse_failure` targets MUST reproduce a structured `parse_error` on baseline
  // matching the exact source, stage, and ALL targeted diagnostics or recorded error message(s),
  // AND candidate MUST parse cleanly with zero unresolved or newly introduced drift diagnostics.
  if (expectsParseFailure) {
    const baselineFailure = checkBaselineParseFailure(
      sourceId,
      baseline,
      matchingCandidates,
      candidateSummary.source_hash,
    );
    if (baselineFailure !== undefined) return { ok: false, reason: baselineFailure };

    if (targetContractKeys.size > 0) {
      const remainingOnCandidate = [...targetContractKeys].sort().filter((key) => {
        // For a `reject / unknown_field` target path, allow downgrading to a benign
        // `accept_with_signal / unknown_field` hint on candidate while still rejecting any
        // remaining `disposition: "reject"` finding or any non-extension drift.
        if (isUnknownFieldKey(key)) {
          return (candidateRejectContractCounts.get(key) ?? 0) > 0;
        }
        return (candidateContractCounts.get(key) ?? 0) > 0;
      });
      if (remainingOnCandidate.length > 0) {
        return {
          ok: false,
          reason: `Candidate replay for ${sourceId} still contains target contract diagnostic(s): ${remainingOnCandidate.join(", ")}`,
        };
      }
    }
    const candidateDriftKeys = nonExtensionContractDiagnosticKeys(candidateContractCounts);
    if (candidateDriftKeys.length > 0) {
      return {
        ok: false,
        reason: `Candidate replay for ${sourceId} contains unresolved/new contract diagnostic(s): ${candidateDriftKeys.join(", ")}`,
      };
    }
    const candidateHasRejectFinding =
      (candidateSummary.contract_reject_findings ?? 0) > 0 ||
      (candidateSummary.contract_findings ?? []).some(
        (finding) => "disposition" in finding && finding.disposition === "reject",
      );
    if (candidateHasRejectFinding) {
      return {
        ok: false,
        reason: `Candidate replay for ${sourceId} contains reject-disposition contract finding(s)`,
      };
    }
    // When full unbounded diagnostic counts AND reject-finding count confirm all findings (including
    // those omitted from the 16-item display summary) are benign `accept_with_signal` `unknown_field`
    // extensions, allow; conservatively reject omitted findings only on legacy/incomplete summaries.
    const hasCompleteCandidateCounts =
      candidateSummary.contract_diagnostic_counts !== undefined &&
      candidateSummary.contract_reject_findings !== undefined;
    if ((candidateSummary.contract_findings_omitted ?? 0) > 0 && !hasCompleteCandidateCounts) {
      return {
        ok: false,
        reason: `Candidate replay for ${sourceId} omitted ${candidateSummary.contract_findings_omitted} contract finding(s) without complete replay diagnostic counts`,
      };
    }
    if (candidateReasons.size > 0) {
      return {
        ok: false,
        reason: `Candidate replay for ${sourceId} contains unresolved/new reconciliation diagnostic(s): ${[...candidateReasons.keys()].sort().join(", ")}`,
      };
    }
    return { ok: true };
  }

  if (baseline.status === null) {
    return {
      ok: false,
      reason: `Baseline replay for ${sourceId} terminated without a normal exit code (status: null)`,
    };
  }
  if (baseline.status !== 0) {
    const inspected = inspectBaselineNonZeroError(baseline, sourceId);
    if (!inspected.ok) return inspected;
    // Non-parse-failure summary targets MUST exit 0 on baseline to reproduce their diagnostics.
    if (matchingCandidates.length > 0) {
      return {
        ok: false,
        reason: `Baseline replay for ${sourceId} exited non-zero instead of reproducing target summary diagnostics: ${inspected.combined.slice(0, 200)}`,
      };
    }
    if (!inspected.parsed.structured || inspected.parsed.stage !== "parse_error") {
      return {
        ok: false,
        reason: `Baseline replay for ${sourceId} failed without a structured parse_error payload`,
      };
    }
    return checkCandidateCleanAfterParseFailure(
      sourceId,
      candidateContractCounts,
      candidateReasons,
    );
  }

  const parsedBaseline = parseReplaySummary("Baseline", baseline.stdout, sourceId);
  if (!parsedBaseline.ok) return parsedBaseline;
  const baselineSummary = parsedBaseline.summary;

  const baselineContractCounts = contractDiagnosticCounts(baselineSummary);
  const baselineRejectContractCounts = rejectContractDiagnosticCounts(baselineSummary);
  const baselineContractFindings = totalContractFindings(baselineSummary);
  const candidateContractFindings = totalContractFindings(candidateSummary);
  const baselineReasons = repairableReasonCounts(baselineSummary);

  // Never allow a candidate patch to introduce or worsen any sibling diagnostic on the same source.
  const regression =
    checkNoMapRegression(
      sourceId,
      "reject contract diagnostic",
      baselineRejectContractCounts,
      candidateRejectContractCounts,
    ) ??
    checkNoMapRegression(
      sourceId,
      "contract diagnostic",
      baselineContractCounts,
      candidateContractCounts,
    ) ??
    (candidateContractFindings > baselineContractFindings
      ? `Candidate replay for ${sourceId} regressed contract_findings (${baselineContractFindings} -> ${candidateContractFindings})`
      : undefined) ??
    checkNoMapRegression(sourceId, "sibling diagnostic", baselineReasons, candidateReasons);
  if (regression !== undefined) return { ok: false, reason: regression };

  // Evaluate EVERY targeted reconciliation reason and contract diagnostic key individually.
  if (targetReasons.size > 0) {
    const reasonError = checkTargetKeysReduced(
      sourceId,
      "target diagnostic(s)",
      targetReasons,
      (key) => baselineReasons.get(key) ?? 0,
      (key) => candidateReasons.get(key) ?? 0,
    );
    if (reasonError !== undefined) return { ok: false, reason: reasonError };
  }

  if (targetContractKeys.size > 0) {
    const contractError = checkTargetKeysReduced(
      sourceId,
      "target contract diagnostic(s)",
      targetContractKeys,
      // `unknown_field` only enters targetContractKeys from `disposition: "reject"` findings;
      // compare reject counts so downgrading a strict rejection to `accept_with_signal` passes.
      (key) =>
        isUnknownFieldKey(key)
          ? (baselineRejectContractCounts.get(key) ?? 0)
          : (baselineContractCounts.get(key) ?? 0),
      (key) =>
        isUnknownFieldKey(key)
          ? (candidateRejectContractCounts.get(key) ?? 0)
          : (candidateContractCounts.get(key) ?? 0),
    );
    if (contractError !== undefined) return { ok: false, reason: contractError };
  }

  if (targetReasons.size > 0 || targetContractKeys.size > 0) {
    return { ok: true };
  }

  if (expectsContractFinding) {
    if (baselineContractFindings === 0) {
      return {
        ok: false,
        reason: `Baseline replay for ${sourceId} did not reproduce target contract_findings`,
      };
    }
    if (candidateContractFindings >= baselineContractFindings) {
      return {
        ok: false,
        reason: `Candidate replay for ${sourceId} did not reduce target contract_findings (${baselineContractFindings} -> ${candidateContractFindings})`,
      };
    }
    return { ok: true };
  }

  const baselineDiagnostics = countRepairableDiagnostics(baselineSummary);
  const candidateDiagnostics = countRepairableDiagnostics(candidateSummary);
  if (baselineDiagnostics === 0) {
    return {
      ok: false,
      reason: `Baseline replay for ${sourceId} succeeded with zero repairable diagnostics; failure was not reproduced`,
    };
  }
  if (candidateDiagnostics >= baselineDiagnostics) {
    return {
      ok: false,
      reason: `Candidate replay for ${sourceId} did not reduce target diagnostics (${baselineDiagnostics} -> ${candidateDiagnostics})`,
    };
  }
  return { ok: true };
}

function resolveEvidencePath(evidenceRoot: string, relativePath: string): string {
  const root = resolve(evidenceRoot);
  const full = resolve(root, relativePath);
  const rel = relative(root, full).split(sep).join(posix.sep);
  if (rel.startsWith("..") || rel === "") {
    throw new Error(`Evidence path escapes evidence root: ${relativePath}`);
  }
  return full;
}

function verifyBoundFile(
  evidenceRoot: string,
  relativePath: string,
  expectedSha256: string | undefined,
  sourceId: string,
  label: "Evidence" | "Evidence context",
): { ok: true; fullPath: string } | { ok: false; violation: string } {
  let fullPath: string;
  try {
    fullPath = resolveEvidencePath(evidenceRoot, relativePath);
  } catch (error) {
    return { ok: false, violation: error instanceof Error ? error.message : String(error) };
  }
  let actualHash: string;
  try {
    actualHash = sha256(readFileSync(fullPath));
  } catch {
    return { ok: false, violation: `${label} file unreadable for ${sourceId}: ${fullPath}` };
  }
  if (expectedSha256 && actualHash !== expectedSha256) {
    return {
      ok: false,
      violation: `${label} SHA-256 mismatch for ${sourceId}: expected ${expectedSha256}, got ${actualHash}`,
    };
  }
  return { ok: true, fullPath };
}

type ReplayCommandWrapper = (
  replayArgs: readonly string[],
  replayCwd: string,
) => { command: string; args: string[]; env?: NodeJS.ProcessEnv };

function boundReplayArgs(entry: BoundEvidenceFile, root: string) {
  const evidence = verifyBoundFile(
    root,
    entry.relative_path,
    entry.sha256,
    entry.source_id,
    "Evidence",
  );
  if (!evidence.ok) return evidence;
  const context =
    entry.context_relative_path === undefined
      ? undefined
      : verifyBoundFile(
          root,
          entry.context_relative_path,
          entry.context_sha256,
          entry.source_id,
          "Evidence context",
        );
  if (context?.ok === false) return context;
  return {
    ok: true as const,
    args: [
      "scripts/replay-catalog-evidence.ts",
      entry.source_id,
      evidence.fullPath,
      ...(context === undefined ? [] : [context.fullPath]),
    ],
  };
}

function runReplay(args: readonly string[], cwd: string, wrapper?: ReplayCommandWrapper) {
  const wrapped = wrapper?.(args, cwd);
  return spawnSync(wrapped?.command ?? process.execPath, wrapped?.args ?? args, {
    cwd,
    env: wrapped?.env ?? sanitizedUntrustedEnv(),
    encoding: "utf8",
    maxBuffer: SELF_HEAL_MAX_BUFFER,
    timeout: 120_000,
    killSignal: "SIGKILL",
  });
}

export function preflightEvidenceReplay(
  cwd: string,
  evidenceRoot: string,
  evidenceFiles: readonly BoundEvidenceFile[],
  candidates: readonly CatalogRepairCandidate[],
  wrapper: ReplayCommandWrapper,
): string | undefined {
  for (const entry of evidenceFiles) {
    const bound = boundReplayArgs(entry, evidenceRoot);
    if (!bound.ok) return bound.violation;
    const replay = runReplay(bound.args, cwd, wrapper);
    if (replay.error !== undefined || replay.status === null) {
      return `Replay process failed for ${entry.source_id}: ${replay.error?.message ?? replay.signal}`;
    }
    const targets = candidates.filter((candidate) => candidate.source_id === entry.source_id);
    const parseFailure = targets.some((candidate) =>
      (candidate.triggers ?? [candidate.trigger]).includes("source_parse_failure"),
    );
    if (parseFailure) {
      const failure = checkBaselineParseFailure(entry.source_id, replay, targets);
      if (failure !== undefined) return failure;
    } else {
      if (replay.status !== 0)
        return `Baseline replay failed for ${entry.source_id}: ${replay.stderr.trim().slice(0, 300)}`;
      const parsed = parseReplaySummary("Baseline", replay.stdout, entry.source_id);
      if (!parsed.ok) return parsed.reason;
      const baseline = parsed.summary;
      const contractCounts = contractDiagnosticCounts(baseline);
      const rejectContractCounts = rejectContractDiagnosticCounts(baseline);
      const reconciliation = repairableReasonCounts(baseline);
      const targetError =
        checkTargetKeysReduced(
          entry.source_id,
          "target diagnostic(s)",
          extractTargetReconciliationReasons(targets),
          (key) => reconciliation.get(key) ?? 0,
          () => 0,
        ) ??
        checkTargetKeysReduced(
          entry.source_id,
          "target contract diagnostic(s)",
          extractTargetContractDiagnosticKeys(targets),
          (key) => (isUnknownFieldKey(key) ? rejectContractCounts : contractCounts).get(key) ?? 0,
          () => 0,
        );
      if (targetError !== undefined) return targetError;
      if (countRepairableDiagnostics(baseline) === 0 && totalContractFindings(baseline) === 0) {
        return `Baseline replay no longer reproduces repairable diagnostics for ${entry.source_id}`;
      }
    }
  }
}

function git(args: readonly string[], cwd?: string): string {
  return runGit(args, cwd ?? process.cwd());
}

function gitOptionalShow(base: string, filePath: string, cwd?: string): string | undefined {
  const result = spawnSync("git", ["show", `${base}:${filePath}`], {
    encoding: "utf8",
    maxBuffer: SELF_HEAL_MAX_BUFFER,
    ...(cwd ? { cwd } : {}),
  });
  if (result.status !== 0) return undefined;
  return result.stdout;
}

export function runSelfHealGate(options: {
  base?: string;
  cwd?: string;
  targetProvider?: string;
  targetCandidates?: readonly CatalogRepairCandidate[];
  evidenceRoot?: string;
  evidenceFiles?: readonly BoundEvidenceFile[];
  requireEvidenceReplay?: boolean;
  skipEvidenceReplay?: boolean;
  replayCommandWrapper?: ReplayCommandWrapper;
  compareBaselineReplay?: boolean;
  installCiPrerequisites?: boolean;
  skipValidation?: boolean;
}): GateVerdict {
  const cwd = resolve(options.cwd ?? ".");
  const base = options.base ?? "HEAD";
  const trackedChanged = git(["diff", "--name-only", "-z", base, "--"], cwd)
    .split("\0")
    .filter(Boolean);
  const untrackedList = git(["ls-files", "--others", "--exclude-standard", "-z"], cwd)
    .split("\0")
    .filter(Boolean);
  const changed_files = [...new Set([...trackedChanged, ...untrackedList])].sort();

  const classification = classifyChangedPaths(changed_files, options.targetProvider, {
    repoRoot: cwd,
  });
  const violations: string[] = [];
  if (changed_files.length === 0) {
    violations.push("No files changed");
  }
  for (const file of classification.forbidden_files) {
    violations.push(`Forbidden path modified: ${file}`);
  }

  const diff = trackedChanged.length === 0 ? "" : git(["diff", "--unified=0", base, "--"], cwd);
  const untrackedFiles: Record<string, string> = {};
  for (const filePath of untrackedList) {
    try {
      untrackedFiles[filePath] = readFileSync(join(cwd, filePath), "utf8");
    } catch {
      violations.push(`Could not read untracked file for audit: ${filePath}`);
    }
  }

  const beforeFiles: Record<string, string> = {};
  const afterFiles: Record<string, string> = {};
  for (const filePath of trackedChanged) {
    if (!filePath.endsWith(".ts")) continue;
    const before = gitOptionalShow(base, filePath, cwd);
    if (before !== undefined) beforeFiles[filePath] = before;
    try {
      afterFiles[filePath] = readFileSync(join(cwd, filePath), "utf8");
    } catch {
      afterFiles[filePath] = "";
    }
  }

  violations.push(...auditDiffSafety(diff, { untrackedFiles, beforeFiles, afterFiles }));

  const replayed_sources: string[] = [];
  let unavailableReplays = 0;
  const evidenceFiles = options.evidenceFiles ?? [];
  const targetCandidates = options.targetCandidates ?? [];
  const readiness = inspectTargetReplayReadiness(targetCandidates, evidenceFiles);
  const mustReplay = options.requireEvidenceReplay ?? targetCandidates.length > 0;

  if (mustReplay && readiness.unsupportedTriggers.length > 0) {
    violations.push(
      `Target trigger(s) cannot be verified via single-source offline replay: ${readiness.unsupportedTriggers.join(", ")}`,
    );
  } else if (mustReplay && readiness.hasUnboundProviderCandidate) {
    violations.push(
      "Provider-level assembly or quarantine failure cannot be verified via source-only evidence replay",
    );
  } else if (mustReplay && readiness.missingSourceIds.length > 0) {
    violations.push(
      `Missing bound evidence for target source(s): ${readiness.missingSourceIds.join(", ")}`,
    );
  } else if (mustReplay && readiness.contextErrors.length > 0) {
    violations.push(...readiness.contextErrors);
  } else if (mustReplay && readiness.evidenceCount === 0) {
    violations.push(
      "Evidence replay is required for failure candidates but no bound evidence was provided",
    );
  }

  const untrustedEnv = sanitizedUntrustedEnv();

  if (violations.length === 0 && options.skipEvidenceReplay !== true && evidenceFiles.length > 0) {
    const evidenceRoot = options.evidenceRoot ?? cwd;
    let baselineDir: string | undefined;
    try {
      if (options.compareBaselineReplay === true) {
        baselineDir = mkdtempSync(join(tmpdir(), "kmodels-gate-base-"));
        git(["worktree", "add", "--detach", baselineDir, base], cwd);
        const nodeModulesSrc = join(cwd, "node_modules");
        const nodeModulesDst = join(baselineDir, "node_modules");
        if (existsSync(nodeModulesSrc) && !existsSync(nodeModulesDst)) {
          symlinkSync(nodeModulesSrc, nodeModulesDst, "dir");
        }
      }
      for (const entry of evidenceFiles) {
        const bound = boundReplayArgs(entry, evidenceRoot);
        if (!bound.ok) {
          violations.push(bound.violation);
          continue;
        }
        const replay = (replayCwd: string) =>
          runReplay(bound.args, replayCwd, options.replayCommandWrapper);
        const candidateReplay = replay(cwd);

        if (baselineDir !== undefined) {
          const baselineReplay = replay(baselineDir);
          const processError = candidateReplay.error ?? baselineReplay.error;
          if (
            processError !== undefined ||
            candidateReplay.status === null ||
            baselineReplay.status === null
          ) {
            violations.push(
              `Replay process failed for ${entry.source_id}: ${processError?.message ?? candidateReplay.signal ?? baselineReplay.signal}`,
            );
            unavailableReplays += 1;
            continue;
          }
          const comparison = evaluateBeforeAfterReplay({
            sourceId: entry.source_id,
            baseline: baselineReplay,
            candidate: candidateReplay,
            ...(options.targetCandidates === undefined
              ? {}
              : { targetCandidates: options.targetCandidates }),
          });
          if (!comparison.ok) {
            if (comparison.replayUnavailable === true) unavailableReplays += 1;
            violations.push(
              comparison.reason ?? `Before/after replay failed for ${entry.source_id}`,
            );
            continue;
          }
        } else if (candidateReplay.status !== 0) {
          const detail =
            candidateReplay.stderr ||
            candidateReplay.stdout ||
            candidateReplay.error?.message ||
            `exit status ${String(candidateReplay.status)}`;
          violations.push(
            `Evidence replay failed for ${entry.source_id}: ${detail.trim().slice(0, 300)}`,
          );
          continue;
        }
        replayed_sources.push(entry.source_id);
      }
    } finally {
      if (baselineDir !== undefined) {
        try {
          git(["worktree", "remove", "--force", baselineDir], cwd);
        } catch {
          rmSync(baselineDir, { recursive: true, force: true });
        }
      }
    }
  }

  if (violations.length === 0 && options.skipValidation !== true) {
    const shouldInstallPrereqs =
      options.installCiPrerequisites ?? process.env.GITHUB_ACTIONS === "true";
    if (shouldInstallPrereqs) {
      const planRun = spawnSync("vp", ["node", "scripts/validate-changes.ts", base, "--plan"], {
        cwd,
        env: untrustedEnv,
        encoding: "utf8",
        maxBuffer: SELF_HEAL_MAX_BUFFER,
      });
      if (planRun.status === 0) {
        try {
          const parsedPlan = z
            .object({ commands: z.array(z.array(z.string())) })
            .parse(JSON.parse(planRun.stdout));
          if (needsBrowserPrerequisite(parsedPlan.commands)) {
            const installBrowser = spawnSync(
              "vp",
              ["exec", "playwright", "install", "--with-deps", "chromium", "--only-shell"],
              { cwd, env: untrustedEnv, stdio: "inherit" },
            );
            if (installBrowser.status !== 0) {
              violations.push(
                "Failed to install Playwright Chromium for planned browser validation",
              );
            }
          }
        } catch {
          // If plan output cannot be parsed, let validate-changes itself run and report.
        }
      }
    }
    if (violations.length === 0) {
      const validation = spawnSync("vp", ["node", "scripts/validate-changes.ts", base], {
        cwd,
        env: untrustedEnv,
        stdio: "inherit",
      });
      if (validation.status !== 0) {
        violations.push("validate-changes failed");
      }
    }
  }

  const ok = violations.length === 0 && classification.mode !== "rejected";
  return {
    ok,
    mode: ok ? classification.mode : "rejected",
    ...(options.targetProvider === undefined ? {} : { target_provider: options.targetProvider }),
    changed_files,
    protected_files: classification.protected_files,
    forbidden_files: classification.forbidden_files,
    violations,
    replayed_sources,
    ...(unavailableReplays > 0 && unavailableReplays === violations.length
      ? { replay_unavailable: true }
      : {}),
  };
}

function main(): void {
  const args = process.argv.slice(2);
  let base = "HEAD";
  let targetProvider: string | undefined;
  let evidenceRoot: string | undefined;
  const evidenceFiles: BoundEvidenceFile[] = [];
  let skipValidation = false;
  let requireEvidenceReplay: boolean | undefined;
  let compareBaselineReplay = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--base" && args[i + 1] !== undefined) {
      base = args[i + 1] ?? "HEAD";
      i += 1;
    } else if (arg === "--provider" && args[i + 1] !== undefined) {
      targetProvider = args[i + 1];
      i += 1;
    } else if (arg === "--evidence-root" && args[i + 1] !== undefined) {
      evidenceRoot = args[i + 1];
      i += 1;
    } else if (arg === "--evidence" && args[i + 1] !== undefined) {
      const raw = args[i + 1] ?? "";
      const [sourceId, relPath, expectedHash] = raw.split("=");
      if (sourceId && relPath) {
        evidenceFiles.push({
          source_id: sourceId,
          relative_path: relPath,
          source_hash: "0".repeat(64),
          sha256: expectedHash ?? "",
        });
      }
      i += 1;
    } else if (arg === "--require-evidence-replay") {
      requireEvidenceReplay = true;
    } else if (arg === "--compare-baseline") {
      compareBaselineReplay = true;
    } else if (arg === "--skip-validation") {
      skipValidation = true;
    }
  }
  const verdict = runSelfHealGate({
    base,
    ...(targetProvider === undefined ? {} : { targetProvider }),
    ...(evidenceRoot === undefined ? {} : { evidenceRoot }),
    evidenceFiles,
    ...(requireEvidenceReplay === undefined ? {} : { requireEvidenceReplay }),
    compareBaselineReplay,
    skipValidation,
  });
  console.log(JSON.stringify(verdict, null, 2));
  if (!verdict.ok) process.exitCode = 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
