import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { z } from "zod";
import {
  catalogRepairCandidates,
  type CatalogRepairCandidate,
} from "../../src/catalog/catalog-repair.ts";
import { manifests } from "../../src/catalog/manifests.ts";
import { sha256 } from "../../src/catalog/io.ts";
import { providerModelSchema } from "../../src/catalog/schema.ts";
import { sourceErrorMessage } from "../../src/catalog/source-failure.ts";
import { parseReplayContext, verifiedCatalogEvidence } from "../replay-catalog-evidence.ts";
import {
  evaluateBudget,
  parseBudgetLimitsFromEnv,
  readBudgetLedger,
  type BudgetLedger,
  type BudgetLimits,
} from "./budget.ts";

/**
 * Only source-level parse/contract/pricing-structure triggers can be verified offline via
 * single-source `replay-catalog-evidence.ts`. Provider assembly/validation (`provider_validation`,
 * `pricing_validation`) and dead-URL/404 location changes (`source_location_change`) cannot be
 * verified by replaying an existing source body alone.
 */
export const REPLAY_VERIFIABLE_TRIGGERS: ReadonlySet<string> = new Set([
  "source_parse_failure",
  "source_pricing_structure",
  "source_contract_change",
]);

/**
 * Public extractors whose live parse reads authenticated `inventoryModels` (which cannot
 * enter public repair artifacts). Offline replay without those inputs would diverge from
 * live collection, so self-heal treats them as non-replayable (`missing_evidence`).
 */
export const AUTH_CONTEXT_REQUIRED_EXTRACTORS: ReadonlySet<string> = new Set(["mistral-pricing"]);

/** Public extractors whose parser requires paired `catalogModels` context for faithful replay. */
const CATALOG_CONTEXT_REQUIRED_EXTRACTORS: ReadonlySet<string> = new Set([
  "anthropic-model-cards",
  "azure-claude-pricing",
  "azure-portal-catalog",
  "azure-public-pricing",
  "azure-retail-prices",
  "cohere-pricing",
  "gemini-pricing",
  "nvidia-nim-cards",
  "openai-changelog",
  "openai-data-residency",
  "openai-deprecations",
  "openai-model-pricing",
  "openai-pricing",
  "together-cards",
  "together-releases",
  "vertex-pricing",
]);

const sourceById = new Map(
  manifests.flatMap(({ sources }) => sources.map((source) => [source.id, source] as const)),
);
const providerIdBySourceId = new Map(
  manifests.flatMap(({ provider, sources }) =>
    sources.map((source) => [source.id, provider.id] as const),
  ),
);

export function sourceRequiresAuthInventoryContext(sourceId: string): boolean {
  const source = sourceById.get(sourceId);
  return source !== undefined && AUTH_CONTEXT_REQUIRED_EXTRACTORS.has(source.extractor.kind);
}

export function replayContextRequirementError(
  sourceId: string,
  entry: BoundEvidenceFile | undefined,
): string | undefined {
  const source = sourceById.get(sourceId);
  if (source === undefined) return undefined;
  if (AUTH_CONTEXT_REQUIRED_EXTRACTORS.has(source.extractor.kind)) {
    return `${sourceId} requires authenticated inventory context unavailable in public replay`;
  }
  if (source.extractor.kind === "azure-retail-prices") {
    if (entry?.context_relative_path === undefined || entry.context_kind !== "azure_retail") {
      return `${sourceId} requires structured replay context (catalog_models, previous_catalog_models, previous_retail_meters)`;
    }
    return undefined;
  }
  if (
    CATALOG_CONTEXT_REQUIRED_EXTRACTORS.has(source.extractor.kind) &&
    entry?.context_relative_path === undefined
  ) {
    return `${sourceId} requires paired public catalog context file for faithful replay`;
  }
  return undefined;
}

export function filterEvidenceForTargetCandidates(
  candidates: readonly CatalogRepairCandidate[],
  evidenceFiles: readonly BoundEvidenceFile[],
  ownedSources?: ReadonlySet<string>,
): BoundEvidenceFile[] {
  const candidateSourceIds = new Set(
    candidates
      .map((candidate) => candidate.source_id)
      .filter((id): id is string => id !== undefined),
  );
  // Provider-level assembly/validation failures (no source_id) must NEVER borrow unrelated
  // same-provider source evidence for source-only replay.
  if (candidateSourceIds.size === 0) return [];
  const expectedHashesBySource = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    if (candidate.source_id === undefined || candidate.source_hash === undefined) continue;
    const set = expectedHashesBySource.get(candidate.source_id) ?? new Set<string>();
    set.add(candidate.source_hash);
    expectedHashesBySource.set(candidate.source_id, set);
  }
  return evidenceFiles.filter((entry) => {
    if (ownedSources !== undefined && !ownedSources.has(entry.source_id)) return false;
    if (!candidateSourceIds.has(entry.source_id)) return false;
    const expectedHashes = expectedHashesBySource.get(entry.source_id);
    if (expectedHashes !== undefined && !expectedHashes.has(entry.source_hash)) return false;
    return true;
  });
}

const REDACTION_PLACEHOLDER_PATTERN = /\[(?:source|resource|account|identity|credential)\]/;
const GENERIC_PARSE_FAILURE_MESSAGES = new Set([
  "the reviewed source no longer satisfies its parser contract",
  "the source contains unresolved contract evidence; investigate before deciding whether a code repair is needed",
]);

/**
 * Inspect raw (pre-whitespace-collapse) message text so 1,024-char truncation by `sourceErrorMessage`
 * or redaction placeholders (`[source]`, etc.) are detected identically across triage, generate, and verify.
 */
export function mayBeRedactedOrTruncatedMessage(raw: string): boolean {
  const sanitized = sourceErrorMessage(new Error(raw));
  return (
    raw.length >= 1024 ||
    sanitized.length >= 1024 ||
    REDACTION_PLACEHOLDER_PATTERN.test(raw) ||
    REDACTION_PLACEHOLDER_PATTERN.test(sanitized)
  );
}

function primaryCandidateMessage(message: string): string {
  let primary = message;
  for (const marker of [
    " Missing reviewed source contracts:",
    " The source contains unresolved contract evidence",
    " Provider validation:",
  ]) {
    const idx = primary.indexOf(marker);
    if (idx >= 0) primary = primary.slice(0, idx);
  }
  return primary;
}

export function nonReplayVerifiableTriggers(
  candidates: readonly CatalogRepairCandidate[],
): string[] {
  const unsupported: string[] = [];
  for (const candidate of candidates) {
    const subject = candidate.source_id ?? candidate.subject_id;
    const allTriggers = candidate.triggers ?? [candidate.trigger];
    for (const trigger of allTriggers) {
      if (!REPLAY_VERIFIABLE_TRIGGERS.has(trigger)) {
        unsupported.push(`${trigger}(${subject})`);
      }
    }
    if (
      (candidate.dependency_failures_omitted ?? 0) > 0 ||
      candidate.message.includes("additional failures omitted")
    ) {
      unsupported.push(`omitted_dependency_failures(${subject})`);
    }
    const depParseCount = candidate.dependency_parse_failures?.length ?? 0;
    // Transport-layer dependency parse failures (e.g. Ollama `/index` substituted with `{}`)
    // do not preserve the raw failed dependency body in the assembled source bundle, so single-source
    // replay cannot faithfully reproduce them.
    if (
      depParseCount > 0 ||
      candidate.message.includes("Dependency evidence requires investigation:")
    ) {
      unsupported.push(`dependency_parse_failure(${subject})`);
    }
    // Reject source_parse_failure targets whose failure message is generic/unidentifiable OR
    // redacted/truncated without an error_fingerprint or source_hash binding — verify will
    // deterministically reject them, so triage & generate must never spend paid calls on them.
    if (allTriggers.includes("source_parse_failure")) {
      const primary = primaryCandidateMessage(candidate.message);
      const trimmed = primary.trim().replace(/\s+/g, " ").replace(/\.+$/, "");
      if (trimmed.length === 0 || GENERIC_PARSE_FAILURE_MESSAGES.has(trimmed.toLowerCase())) {
        unsupported.push(`unidentifiable_parse_failure(${subject})`);
      } else if (
        mayBeRedactedOrTruncatedMessage(primary) &&
        candidate.error_fingerprint === undefined &&
        candidate.source_hash === undefined
      ) {
        unsupported.push(`unbound_redacted_parse_failure(${subject})`);
      }
    }
  }
  return [...new Set(unsupported)];
}

export interface UpstreamEvidenceReceipt {
  shard: string;
  attempt: number;
  artifact_id: string;
  artifact_name: string;
}

export interface UpstreamEvidenceManifest {
  version: 1;
  report_attempt: number;
  shards: UpstreamEvidenceReceipt[];
}

const upstreamEvidenceManifestSchema = z.object({
  version: z.literal(1),
  report_attempt: z.number().int().positive(),
  shards: z.array(
    z.object({
      shard: z.string().min(1),
      attempt: z.number().int().positive(),
      artifact_id: z.string(),
      artifact_name: z.string(),
    }),
  ),
});

/**
 * Select the exact upstream Refresh report artifact and its matching public evidence shards
 * from a `gh api --paginate --slurp` response. When `manifest` (bundled by `assemble`) is present,
 * verifies report attempt, shard identity, shard attempt <= report attempt, and exact GitHub
 * artifact ID + name linkage before returning ONLY the consumed shards; otherwise fallback shards
 * are strictly capped at `attempt <= selectedReport.attempt`.
 */
export function selectUpstreamRefreshArtifacts(
  slurpedPages: unknown,
  runId: string,
  maxAttempt: number,
  manifest?: unknown,
): {
  report: string;
  report_attempt: number | null;
  reports: Array<{ name: string; attempt: number }>;
  shards: string[];
} {
  const pages = Array.isArray(slurpedPages) ? slurpedPages : [slurpedPages];
  const artifacts: Array<{ id?: string; name: string; expired?: boolean }> = [];
  for (const page of pages) {
    if (typeof page !== "object" || page === null || !("artifacts" in page)) continue;
    const list = (page as { artifacts?: unknown }).artifacts;
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (
        typeof item === "object" &&
        item !== null &&
        "name" in item &&
        typeof item.name === "string"
      ) {
        const expired = "expired" in item && item.expired === true;
        if (expired) continue;
        const rawId = "id" in item ? item.id : undefined;
        const id =
          typeof rawId === "number" && Number.isFinite(rawId)
            ? String(rawId)
            : typeof rawId === "string" && rawId.trim().length > 0
              ? rawId.trim()
              : undefined;
        artifacts.push({ ...(id === undefined ? {} : { id }), name: item.name, expired });
      }
    }
  }

  const reportRe = new RegExp(`^catalog-refresh-${runId}-attempt-(\\d+)$`);
  const reportsByAttempt = new Map<number, { attempt: number; name: string }>();
  for (const artifact of artifacts) {
    const match = artifact.name.match(reportRe);
    if (match?.[1] === undefined) continue;
    const attempt = Number(match[1]);
    if (attempt <= maxAttempt && !reportsByAttempt.has(attempt)) {
      reportsByAttempt.set(attempt, { attempt, name: artifact.name });
    }
  }
  const reports = [...reportsByAttempt.values()].sort((a, b) => b.attempt - a.attempt);
  const bestReport = reports[0];
  if (bestReport === undefined) {
    return { report: "", report_attempt: null, reports: [], shards: [] };
  }

  if (manifest !== undefined) {
    const parsed = upstreamEvidenceManifestSchema.parse(manifest);
    if (parsed.report_attempt !== bestReport.attempt) {
      throw new Error(
        `Evidence manifest report_attempt (${parsed.report_attempt}) does not match selected report attempt (${bestReport.attempt})`,
      );
    }
    const seenShards = new Set<string>();
    const selectedShards: string[] = [];
    for (const receipt of parsed.shards) {
      if (seenShards.has(receipt.shard)) {
        throw new Error(`Evidence manifest contains duplicate shard receipt for ${receipt.shard}`);
      }
      seenShards.add(receipt.shard);
      if (receipt.attempt > bestReport.attempt) {
        throw new Error(
          `Evidence manifest shard ${receipt.shard} attempt (${receipt.attempt}) exceeds selected report attempt (${bestReport.attempt})`,
        );
      }
      const trimmedName = receipt.artifact_name.trim();
      const trimmedId = receipt.artifact_id.trim();
      if (trimmedName.length === 0 && trimmedId.length === 0) {
        continue;
      }
      if (trimmedName.length === 0 || trimmedId.length === 0) {
        throw new Error(
          `Evidence manifest shard ${receipt.shard} must specify both artifact_id and artifact_name or neither`,
        );
      }
      const expectedName = `catalog-public-evidence-${runId}-attempt-${receipt.attempt}-${receipt.shard}`;
      if (trimmedName !== expectedName) {
        throw new Error(
          `Evidence manifest shard ${receipt.shard} artifact_name (${trimmedName}) does not match expected ${expectedName}`,
        );
      }
      const matched = artifacts.find(
        (artifact) => artifact.name === trimmedName && artifact.id === trimmedId,
      );
      if (matched === undefined) {
        throw new Error(
          `Evidence manifest shard ${receipt.shard} artifact ${trimmedName} (id=${trimmedId}) does not match any non-expired GitHub API artifact`,
        );
      }
      selectedShards.push(matched.name);
    }
    return {
      report: bestReport.name,
      report_attempt: bestReport.attempt,
      reports,
      shards: [...new Set(selectedShards)].sort(),
    };
  }

  // Fallback for legacy reports without refresh-evidence-manifest.json:
  // strictly cap shard attempts at `bestReport.attempt` (never pair attempt-1 report with attempt-2 shards).
  const shardRe = new RegExp(`^catalog-public-evidence-${runId}-attempt-(\\d+)-(.+)$`);
  const bestShards = new Map<string, { attempt: number; name: string }>();
  for (const artifact of artifacts) {
    const match = artifact.name.match(shardRe);
    if (match?.[1] === undefined || match[2] === undefined) continue;
    const attempt = Number(match[1]);
    const shardKey = match[2];
    const prev = bestShards.get(shardKey);
    if (attempt <= bestReport.attempt && (prev === undefined || attempt > prev.attempt)) {
      bestShards.set(shardKey, { attempt, name: artifact.name });
    }
  }
  return {
    report: bestReport.name,
    report_attempt: bestReport.attempt,
    reports,
    shards: [...bestShards.values()].map((s) => s.name).sort(),
  };
}

const maxCaptureBytes = 64 * 1024 * 1024;

const quarantineSchema = z.array(
  z.object({
    provider_id: z.string().min(1),
    checked_at: z.string().min(1),
    reason: z.string().min(1),
  }),
);

export const boundEvidenceFileSchema = z.strictObject({
  source_id: z.string().min(1),
  /** Portable POSIX relative path inside the evidence directory (survives cross-job artifact moves). */
  relative_path: z.string().min(1),
  source_hash: z.string().regex(/^[0-9a-f]{64}$/),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  context_relative_path: z.string().min(1).optional(),
  context_sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  context_kind: z.enum(["catalog_models", "azure_retail"]).optional(),
});

export type BoundEvidenceFile = z.infer<typeof boundEvidenceFileSchema>;

export interface SelfHealTarget {
  provider_id: string;
  quarantined: boolean;
  quarantine_reason?: string;
  trigger_run_id?: string;
  trigger_run_attempt?: number;
  candidates: CatalogRepairCandidate[];
  evidence_files: BoundEvidenceFile[];
}

export interface SkippedProvider {
  provider_id: string;
  reason: "open_pr" | "cooldown" | "missing_evidence";
  detail?: string;
}

export interface TriageResult {
  status: "idle" | "actionable";
  idle_reason?: "no_candidates" | "all_deferred" | "budget_exhausted" | "missing_evidence";
  budget_reasons?: string[];
  target?: SelfHealTarget;
  total_candidates: number;
  skipped_providers: SkippedProvider[];
}

const triggerPriority: Readonly<Record<string, number>> = {
  provider_validation: 0,
  source_parse_failure: 1,
  source_contract_change: 2,
  pricing_validation: 3,
  source_location_change: 4,
  source_pricing_structure: 5,
};

function candidatePriority(candidate: CatalogRepairCandidate): number {
  return triggerPriority[candidate.trigger] ?? 10;
}

function normalizeRefreshTelemetry(input: unknown): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return input;
  if ("schema_version" in input) return input;
  return { schema_version: 2, ...input };
}

/**
 * Deterministically select one actionable provider target from refresh & quarantine telemetry,
 * reserving budget up front and skipping providers that already have an open self-heal PR or
 * an active cooldown window so persistent failures cannot starve other providers.
 */
export function selectSelfHealTarget(
  refreshTelemetry: unknown,
  quarantineInput: unknown,
  options: {
    providerFilter?: string;
    evidenceFiles?: readonly BoundEvidenceFile[];
    requireSourceEvidence?: boolean;
    openPrProviders?: ReadonlySet<string>;
    cooldownProviders?: Readonly<Record<string, string>>;
    nowMs?: number;
    budgetLedger?: BudgetLedger;
    budgetLimits?: BudgetLimits;
    triggerRunId?: string;
    triggerRunAttempt?: number;
  } = {},
): TriageResult {
  const nowMs = options.nowMs ?? Date.now();
  const cooldownProviders: Record<string, string> = { ...options.cooldownProviders };

  if (options.budgetLedger !== undefined) {
    const budget = evaluateBudget(options.budgetLedger, {
      nowMs,
      reserveRun: true,
      ...(options.budgetLimits === undefined ? {} : { limits: options.budgetLimits }),
    });
    Object.assign(cooldownProviders, budget.cooldown_providers);
    if (!budget.allowed) {
      return {
        status: "idle",
        idle_reason: "budget_exhausted",
        budget_reasons: budget.reasons,
        total_candidates: 0,
        skipped_providers: [],
      };
    }
  }

  const candidates = catalogRepairCandidates(normalizeRefreshTelemetry(refreshTelemetry));
  const quarantined = new Map(
    quarantineSchema.parse(quarantineInput).map((entry) => [entry.provider_id, entry.reason]),
  );

  const byProvider = new Map<string, CatalogRepairCandidate[]>();
  for (const candidate of candidates) {
    if (options.providerFilter !== undefined && candidate.provider_id !== options.providerFilter) {
      continue;
    }
    const group = byProvider.get(candidate.provider_id) ?? [];
    group.push(candidate);
    byProvider.set(candidate.provider_id, group);
  }

  for (const [providerId, reason] of quarantined) {
    if (options.providerFilter !== undefined && providerId !== options.providerFilter) continue;
    const group = byProvider.get(providerId) ?? [];
    if (!group.some((c) => c.subject_id === "provider_quarantined")) {
      group.push({
        provider_id: providerId,
        scope: "provider",
        subject_id: "provider_quarantined",
        trigger: "provider_validation",
        message: reason,
        diagnostics: [],
      });
    }
    byProvider.set(providerId, group);
  }

  if (byProvider.size === 0) {
    return {
      status: "idle",
      idle_reason: "no_candidates",
      total_candidates: 0,
      skipped_providers: [],
    };
  }

  const ranked = [...byProvider.entries()].sort(([leftId, left], [rightId, right]) => {
    const leftQuarantined = quarantined.has(leftId) ? 0 : 1;
    const rightQuarantined = quarantined.has(rightId) ? 0 : 1;
    if (leftQuarantined !== rightQuarantined) return leftQuarantined - rightQuarantined;
    const leftPriority = Math.min(...left.map(candidatePriority));
    const rightPriority = Math.min(...right.map(candidatePriority));
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    return leftId.localeCompare(rightId);
  });

  const openPrProviders = options.openPrProviders ?? new Set<string>();
  const skipped: SkippedProvider[] = [];
  const providerOwnedSources = new Map(
    manifests.map(({ provider, sources }) => [provider.id, new Set(sources.map((s) => s.id))]),
  );
  const selectEvidenceForProvider = (
    providerId: string,
    providerCandidates: readonly CatalogRepairCandidate[],
  ): BoundEvidenceFile[] => {
    const ownedSources = providerOwnedSources.get(providerId) ?? new Set<string>();
    return filterEvidenceForTargetCandidates(
      providerCandidates,
      options.evidenceFiles ?? [],
      ownedSources,
    );
  };

  let winner: [string, CatalogRepairCandidate[], BoundEvidenceFile[]] | undefined;

  for (const [providerId, providerCandidates] of ranked) {
    // Explicit --provider filter bypasses cooldown/open-PR deferral for manual dispatch.
    if (options.providerFilter === undefined) {
      if (openPrProviders.has(providerId)) {
        skipped.push({ provider_id: providerId, reason: "open_pr" });
        continue;
      }
      const cooldownUntil = cooldownProviders[providerId];
      if (cooldownUntil !== undefined && Date.parse(cooldownUntil) > nowMs) {
        skipped.push({ provider_id: providerId, reason: "cooldown", detail: cooldownUntil });
        continue;
      }
    }
    const evidenceFiles = selectEvidenceForProvider(providerId, providerCandidates);
    const candidateSourceIds = [
      ...new Set(
        providerCandidates.map((c) => c.source_id).filter((id): id is string => id !== undefined),
      ),
    ];
    const hasUnboundProviderCandidate = providerCandidates.some(
      (c) => c.scope === "provider" && c.source_id === undefined,
    );
    const unsupportedTriggers = nonReplayVerifiableTriggers(providerCandidates);
    if (options.requireSourceEvidence === true) {
      if (hasUnboundProviderCandidate || unsupportedTriggers.length > 0) {
        skipped.push({
          provider_id: providerId,
          reason: "missing_evidence",
          detail:
            unsupportedTriggers.length > 0
              ? `Trigger(s) cannot be verified via single-source offline replay: ${unsupportedTriggers.join(", ")}`
              : "Provider-level assembly or quarantine failure has no reproducible provider verification target",
        });
        continue;
      }
      const evidenceBySource = new Map(evidenceFiles.map((e) => [e.source_id, e]));
      const boundSourceIds = new Set(evidenceBySource.keys());
      const missingIds = candidateSourceIds.filter((id) => !boundSourceIds.has(id));
      const contextErrors = candidateSourceIds
        .map((id) => replayContextRequirementError(id, evidenceBySource.get(id)))
        .filter((msg): msg is string => msg !== undefined);
      if (missingIds.length > 0 || evidenceFiles.length === 0 || contextErrors.length > 0) {
        skipped.push({
          provider_id: providerId,
          reason: "missing_evidence",
          detail:
            contextErrors.length > 0
              ? contextErrors.join("; ")
              : missingIds.length > 0
                ? `Missing bound evidence for source(s): ${missingIds.join(", ")}`
                : "No bound evidence for reproducible verification",
        });
        continue;
      }
    }
    winner = [providerId, providerCandidates, evidenceFiles];
    break;
  }

  if (winner === undefined) {
    const onlyMissingEvidence =
      skipped.length > 0 && skipped.every((item) => item.reason === "missing_evidence");
    return {
      status: "idle",
      idle_reason: onlyMissingEvidence ? "missing_evidence" : "all_deferred",
      total_candidates: candidates.length,
      skipped_providers: skipped,
    };
  }

  const [providerId, providerCandidates, evidenceFiles] = winner;

  const quarantineReason = quarantined.get(providerId);
  return {
    status: "actionable",
    total_candidates: candidates.length,
    skipped_providers: skipped,
    target: {
      provider_id: providerId,
      quarantined: quarantineReason !== undefined,
      ...(quarantineReason === undefined ? {} : { quarantine_reason: quarantineReason }),
      ...(options.triggerRunId === undefined ? {} : { trigger_run_id: options.triggerRunId }),
      ...(options.triggerRunAttempt === undefined
        ? {}
        : { trigger_run_attempt: options.triggerRunAttempt }),
      candidates: providerCandidates,
      evidence_files: evidenceFiles,
    },
  };
}

/**
 * Discover captured public source evidence files (`*.json.gz` from `captureRepairSource` and
 * `*.json` from `fetch-catalog-evidence.ts`) and emit portable relative paths + content hashes.
 */
export async function discoverEvidenceFiles(
  directory: string | undefined,
): Promise<BoundEvidenceFile[]> {
  if (directory === undefined) return [];
  const rootDir = resolve(directory);
  const results: BoundEvidenceFile[] = [];

  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const isGzip = entry.name.endsWith(".json.gz");
      const isJson = entry.name.endsWith(".json");
      if (!isGzip && !isJson) continue;
      if (entry.name.endsWith(".context.json.gz") || entry.name.endsWith(".context.json")) continue;
      if (
        entry.name === "refresh-report.json" ||
        entry.name === "refresh-summary.json" ||
        entry.name === "quarantine.json" ||
        entry.name === "manifest.json" ||
        entry.name === "target.json"
      )
        continue;
      try {
        const raw = await readFile(fullPath);
        const text = isGzip
          ? gunzipSync(raw, { maxOutputLength: maxCaptureBytes }).toString("utf8")
          : raw.toString("utf8");
        const parsed: unknown = JSON.parse(text);
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          "source_id" in parsed &&
          typeof parsed.source_id === "string" &&
          !("omitted" in parsed)
        ) {
          // Reuse replay-catalog-evidence's exact body/hash/URL/public-source verification BEFORE paid generation.
          const { evidence } = verifiedCatalogEvidence(parsed.source_id, parsed);
          const relPath = relative(rootDir, fullPath).split(sep).join(posix.sep);
          const stem = isGzip
            ? entry.name.slice(0, -".json.gz".length)
            : entry.name.slice(0, -".json".length);
          const expectedProviderId = providerIdBySourceId.get(evidence.source_id);
          let contextInfo:
            | {
                context_relative_path: string;
                context_sha256: string;
                context_kind: "catalog_models" | "azure_retail";
              }
            | undefined;
          for (const candidateName of [`${stem}.context.json.gz`, `${stem}.context.json`]) {
            const candidatePath = join(dirname(fullPath), candidateName);
            try {
              const contextRaw = await readFile(candidatePath);
              const contextText = candidateName.endsWith(".gz")
                ? gunzipSync(contextRaw, { maxOutputLength: maxCaptureBytes }).toString("utf8")
                : contextRaw.toString("utf8");
              const parsedCtx: unknown = JSON.parse(contextText);
              // Reuse the exact replay context schema and provider ownership check from replay-catalog-evidence.ts.
              const validated = parseReplayContext(parsedCtx, expectedProviderId);
              if (validated.catalogModels !== undefined) {
                contextInfo = {
                  context_relative_path: relative(rootDir, candidatePath)
                    .split(sep)
                    .join(posix.sep),
                  context_sha256: sha256(contextRaw),
                  context_kind: validated.kind,
                };
                break;
              }
            } catch {
              // Ignore missing or invalid companion context file.
            }
          }
          results.push(
            boundEvidenceFileSchema.parse({
              source_id: evidence.source_id,
              relative_path: relPath,
              source_hash: evidence.source_hash,
              sha256: sha256(raw),
              ...contextInfo,
            }),
          );
        }
      } catch {
        // Ignore malformed or non-capture JSON files in evidence directory.
      }
    }
  }
  await walk(rootDir);
  return results.sort(
    (a, b) =>
      a.source_id.localeCompare(b.source_id) || a.relative_path.localeCompare(b.relative_path),
  );
}

async function readTelemetry(dataDir: string, requireRefreshReport: boolean): Promise<unknown> {
  const reportPath = join(dataDir, "refresh-report.json");
  try {
    return JSON.parse(await readFile(reportPath, "utf8"));
  } catch (error) {
    if (
      requireRefreshReport ||
      !(error instanceof Error && "code" in error && error.code === "ENOENT")
    ) {
      throw error;
    }
  }
  return JSON.parse(await readFile(join(dataDir, "refresh-summary.json"), "utf8"));
}

/**
 * Materialize a price-stripped public catalog context file for non-catalog replay sources
 * (such as `openai-pricing`) from a hydrated `catalog.json`, so manual dispatch can replay
 * overlay/pricing sources with the same public model context shape as live collection.
 */
export async function writeReplayContextFromCatalog(
  catalogPath: string,
  providerId: string,
  outputPath: string,
): Promise<number> {
  const catalog = z
    .object({ models: z.array(z.unknown()) })
    .parse(JSON.parse(await readFile(resolve(catalogPath), "utf8")));
  const publicSourceIds = new Set(
    manifests
      .find(({ provider }) => provider.id === providerId)
      ?.sources.filter((s) => s.access === "public" && !("auth" in s && s.auth !== undefined))
      .map((s) => s.id) ?? [],
  );
  const models = [];
  for (const rawModel of catalog.models) {
    const parsed = providerModelSchema.safeParse(rawModel);
    if (!parsed.success) continue;
    if (parsed.data.provider_id !== providerId) continue;
    if (!parsed.data.source_refs.some((ref) => publicSourceIds.has(ref))) continue;
    models.push(parsed.data);
  }
  const encoded = outputPath.endsWith(".gz")
    ? gzipSync(JSON.stringify(models))
    : Buffer.from(JSON.stringify(models), "utf8");
  await writeFile(resolve(outputPath), encoded);
  return models.length;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === "--select-upstream-artifacts") {
    const [, runId, maxAttemptRaw, manifestPath] = args;
    if (!runId || !maxAttemptRaw || !Number.isInteger(Number(maxAttemptRaw))) {
      throw new Error(
        "Usage: triage.ts --select-upstream-artifacts <run-id> <max-attempt> [manifest.json]",
      );
    }
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(
        typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk as Uint8Array),
      );
    }
    const stdinText = Buffer.concat(chunks).toString("utf8");
    const slurped: unknown = stdinText.trim().length === 0 ? [] : JSON.parse(stdinText);
    const manifest: unknown =
      manifestPath === undefined
        ? undefined
        : JSON.parse(await readFile(resolve(manifestPath), "utf8"));
    const selected = selectUpstreamRefreshArtifacts(
      slurped,
      runId,
      Number(maxAttemptRaw),
      manifest,
    );
    console.log(JSON.stringify(selected));
    return;
  }
  if (args[0] === "--write-context") {
    const [, catalogPath, providerId, outputPath] = args;
    if (!catalogPath || !providerId || !outputPath) {
      throw new Error(
        "Usage: triage.ts --write-context <catalog.json> <provider-id> <output.context.json.gz>",
      );
    }
    const count = await writeReplayContextFromCatalog(catalogPath, providerId, outputPath);
    console.log(JSON.stringify({ provider_id: providerId, model_count: count }, null, 2));
    return;
  }
  const flag = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const dataDir = resolve(flag("--data-dir") ?? "data");
  const evidenceDir = flag("--evidence-dir");
  const providerFilter = flag("--provider");
  const budgetLedgerPath = flag("--budget-ledger");
  const openPrsRaw = flag("--open-pr-providers");
  const triggerRunId = flag("--trigger-run-id");
  const triggerRunAttemptRaw = flag("--trigger-run-attempt");
  const requireRefreshReport = args.includes("--require-refresh-report");
  const requireSourceEvidence = args.includes("--require-source-evidence");

  const [refreshTelemetry, quarantineRaw, evidenceFiles, budgetLedger] = await Promise.all([
    readTelemetry(dataDir, requireRefreshReport),
    readFile(join(dataDir, "quarantine.json"), "utf8").catch(() => "[]"),
    discoverEvidenceFiles(evidenceDir),
    budgetLedgerPath === undefined ? undefined : readBudgetLedger(resolve(budgetLedgerPath)),
  ]);

  const openPrProviders = new Set(
    (openPrsRaw ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const triggerRunAttempt =
    triggerRunAttemptRaw !== undefined && Number.isInteger(Number(triggerRunAttemptRaw))
      ? Number(triggerRunAttemptRaw)
      : undefined;

  const result = selectSelfHealTarget(refreshTelemetry, JSON.parse(quarantineRaw), {
    ...(providerFilter === undefined ? {} : { providerFilter }),
    evidenceFiles,
    ...(requireSourceEvidence ? { requireSourceEvidence: true } : {}),
    openPrProviders,
    ...(budgetLedger === undefined
      ? {}
      : { budgetLedger, budgetLimits: parseBudgetLimitsFromEnv() }),
    ...(triggerRunId === undefined ? {} : { triggerRunId }),
    ...(triggerRunAttempt === undefined ? {} : { triggerRunAttempt }),
  });

  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
