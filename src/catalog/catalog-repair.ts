import { z } from "zod";
import { manifests, type SourceManifest } from "./manifests.ts";

/** A successful agent process is not sufficient evidence of completed repair work. */
export function assertCatalogRepairOutcome(output: string): void {
  const items = output
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line) =>
      z
        .object({
          type: z.string(),
          reason: z.string().optional(),
          message: z.string().optional(),
          title: z.string().optional(),
          body: z.string().optional(),
        })
        .parse(JSON.parse(line)),
    );
  const incomplete = items.find(({ type }) =>
    ["missing_data", "missing_tool", "report_incomplete"].includes(type),
  );
  if (incomplete)
    throw new Error(
      `Catalog repair incomplete (${incomplete.type}): ${incomplete.reason ?? "Required evidence or tools are unavailable"}`,
    );
  const outcomes = items.filter(({ type }) => ["noop", "create_pull_request"].includes(type));
  if (outcomes.length !== 1)
    throw new Error("Catalog repair must report exactly one completed outcome");
  const outcome = outcomes[0];
  if (outcome?.type === "noop" && outcome.message?.trim()) return;
  if (outcome?.type === "create_pull_request" && outcome.title?.trim() && outcome.body?.trim())
    return;
  throw new Error("Catalog repair outcome is missing its explanation");
}

const diagnosticSchema = z.object({
  kind: z.string(),
  path: z.string(),
  expected: z.string().optional(),
  observed: z.string().optional(),
  affected_items: z.number().int().nonnegative(),
});

const sourceAttemptSchema = z.object({
  source_id: z.string(),
  outcome: z.enum([
    "changed",
    "unchanged",
    "fetch_failed",
    "parse_failed",
    "skipped_not_configured",
  ]),
  content_changed: z.boolean().optional(),
  message: z.string().optional(),
  consecutive_failures: z.number().int().nonnegative().optional(),
  pricing_reconciliation: z
    .object({
      reason_counts: z.record(z.string(), z.number().int().nonnegative()).optional(),
      diagnostics: z
        .array(z.object({ reason_code: z.string(), sample: z.string().optional() }))
        .optional(),
    })
    .optional(),
  contract_finding: z
    .object({
      disposition: z.enum(["reject", "accept_with_signal"]),
      diagnostics: z.array(diagnosticSchema),
    })
    .optional(),
});

const providerSummarySchema = z.object({
  provider_id: z.string(),
  signals: z.array(z.string()),
  attempt: z
    .object({
      outcome: z.enum(["accepted", "rejected", "not_configured"]),
      sources: z.array(sourceAttemptSchema),
      validation_issue: z
        .object({
          code: z.string(),
          message: z.string(),
        })
        .optional(),
      pricing: z
        .object({
          outcome: z.enum(["accepted", "failed", "not_observed"]),
          failure_code: z.string().optional(),
          message: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

const refreshSummarySchema = z.object({
  schema_version: z.literal(2),
  generated_at: z.string(),
  providers: z.array(providerSummarySchema),
});

type SourceAttempt = z.infer<typeof sourceAttemptSchema>;

// These report missing contracts owned by an extractor, not ordinary unknown prices.
const repairableReconciliationReasons = new Set([
  "unknown_public_pricing_card",
  "pricing_input_contract_partial",
  "pricing_input_contract_drift",
  "endpoint_reference_drift",
  "endpoint_model_list_drift",
  "model_card_identity_drift",
]);

export interface CatalogRepairCandidate {
  provider_id: string;
  scope: "source" | "provider";
  subject_id: string;
  source_id?: string;
  source_url?: string;
  source_access?: SourceManifest["access"];
  extractor?: string;
  trigger:
    | "source_parse_failure"
    | "source_location_change"
    | "source_contract_change"
    | "source_pricing_structure"
    | "provider_validation"
    | "pricing_validation"
    | "semantic_coverage_review";
  message: string;
  diagnostics: z.infer<typeof diagnosticSchema>[];
}

function sourceIndex(): ReadonlyMap<string, ReadonlyMap<string, SourceManifest>> {
  return new Map(
    manifests.map(({ provider, sources }) => [
      provider.id,
      new Map(sources.map((source) => [source.id, source])),
    ]),
  );
}

function reviewedSource(
  sources: ReadonlyMap<string, ReadonlyMap<string, SourceManifest>>,
  providerId: string,
  sourceId: string,
): SourceManifest | undefined {
  return sources.get(providerId)?.get(sourceId);
}

function sourceCandidate(
  providerId: string,
  source: SourceManifest,
  attempt: SourceAttempt,
  trigger: CatalogRepairCandidate["trigger"],
  fallbackMessage: string,
): CatalogRepairCandidate {
  return {
    provider_id: providerId,
    scope: "source",
    subject_id: source.id,
    source_id: source.id,
    source_url: source.url,
    source_access: source.access,
    extractor: source.extractor.kind,
    trigger,
    message: attempt.message ?? fallbackMessage,
    diagnostics: attempt.contract_finding?.diagnostics ?? [],
  };
}

function providerCandidate(
  providerId: string,
  trigger: "provider_validation" | "pricing_validation",
  message: string,
): CatalogRepairCandidate {
  return {
    provider_id: providerId,
    scope: "provider",
    subject_id: trigger,
    trigger,
    message,
    diagnostics: [],
  };
}

export function catalogRepairCandidates(input: unknown): CatalogRepairCandidate[] {
  const report = refreshSummarySchema.parse(input);
  const sources = sourceIndex();
  const candidates = new Map<string, CatalogRepairCandidate>();
  for (const provider of report.providers) {
    const attempt = provider.attempt;
    if (attempt === undefined) continue;
    for (const sourceAttempt of attempt.sources) {
      const source = reviewedSource(sources, provider.provider_id, sourceAttempt.source_id);
      if (source === undefined) continue;
      if (
        source.access === "public" &&
        sourceAttempt.outcome === "fetch_failed" &&
        (sourceAttempt.consecutive_failures ?? 0) >= 2 &&
        /^HTTP (?:404|410)$/.test(sourceAttempt.message ?? "")
      ) {
        const value = sourceCandidate(
          provider.provider_id,
          source,
          sourceAttempt,
          "source_location_change",
          "The reviewed public source is repeatedly absent; verify a first-party relocation before changing its manifest.",
        );
        candidates.set(`${value.provider_id}\0${value.subject_id}`, value);
        continue;
      }
      if (sourceAttempt.outcome === "parse_failed") {
        const value = sourceCandidate(
          provider.provider_id,
          source,
          sourceAttempt,
          "source_parse_failure",
          "The reviewed source no longer satisfies its parser contract.",
        );
        candidates.set(`${value.provider_id}\0${value.subject_id}`, value);
        continue;
      }
      const reconciliation = sourceAttempt.pricing_reconciliation;
      const missingContracts = Object.entries(reconciliation?.reason_counts ?? {}).filter(
        ([reason, count]) => count > 0 && repairableReconciliationReasons.has(reason),
      );
      if (["changed", "unchanged"].includes(sourceAttempt.outcome) && missingContracts.length > 0) {
        const details =
          reconciliation?.diagnostics
            ?.filter(({ reason_code }) => repairableReconciliationReasons.has(reason_code))
            .flatMap(({ sample }) => (sample === undefined ? [] : [sample])) ?? [];
        const value = sourceCandidate(
          provider.provider_id,
          source,
          sourceAttempt,
          "source_pricing_structure",
          `Missing reviewed source contracts: ${missingContracts.map(([reason, count]) => `${reason}: ${count}`).join(", ")}.${details.length === 0 ? "" : ` ${details.join("; ")}`}`,
        );
        candidates.set(`${value.provider_id}\0${value.subject_id}`, value);
        continue;
      }
      if (
        sourceAttempt.outcome === "changed" &&
        sourceAttempt.content_changed === true &&
        sourceAttempt.contract_finding !== undefined
      ) {
        const value = sourceCandidate(
          provider.provider_id,
          source,
          sourceAttempt,
          "source_contract_change",
          "The changed source contains a new reviewed contract finding.",
        );
        candidates.set(`${value.provider_id}\0${value.subject_id}`, value);
      }
    }

    if (attempt.outcome === "rejected" && attempt.validation_issue !== undefined) {
      const changedSources = attempt.sources.filter(
        ({ outcome, content_changed }) => outcome === "changed" && content_changed === true,
      );
      for (const sourceAttempt of changedSources) {
        const source = reviewedSource(sources, provider.provider_id, sourceAttempt.source_id);
        if (source === undefined) continue;
        const value = sourceCandidate(
          provider.provider_id,
          source,
          sourceAttempt,
          "provider_validation",
          `${attempt.validation_issue.code}: ${attempt.validation_issue.message}`,
        );
        candidates.set(`${value.provider_id}\0${value.subject_id}`, value);
      }
      if (
        changedSources.length === 0 &&
        !attempt.sources.some(({ outcome }) =>
          ["fetch_failed", "skipped_not_configured"].includes(outcome),
        )
      ) {
        const value = providerCandidate(
          provider.provider_id,
          "provider_validation",
          `${attempt.validation_issue.code}: ${attempt.validation_issue.message}`,
        );
        candidates.set(`${value.provider_id}\0${value.subject_id}`, value);
      }
    }

    if (
      attempt.pricing?.outcome === "failed" &&
      attempt.pricing.failure_code !== "source_unavailable"
    ) {
      const value = providerCandidate(
        provider.provider_id,
        "pricing_validation",
        attempt.pricing.message ??
          `${attempt.pricing.failure_code ?? "pricing_failed"}: pricing publication failed`,
      );
      candidates.set(`${value.provider_id}\0${value.subject_id}`, value);
    }
  }
  return [...candidates.values()].sort((left, right) =>
    `${left.provider_id}\0${left.subject_id}`.localeCompare(
      `${right.provider_id}\0${right.subject_id}`,
    ),
  );
}

/** Transport failure is not a parser repair, but also cannot establish a healthy no-op. */
export function catalogRepairEvidenceIncomplete(input: unknown): boolean {
  return refreshSummarySchema
    .parse(input)
    .providers.some(
      ({ attempt }) =>
        attempt?.sources.some(({ outcome }) => outcome === "fetch_failed") === true ||
        (attempt?.pricing?.outcome === "failed" &&
          attempt.pricing.failure_code === "source_unavailable"),
    );
}
