import { z } from "zod";
import { manifests, type SourceManifest } from "./manifests.ts";
import { contractFindings, isContractDrift, maxContractFindings } from "./source-contract.ts";
import { dependencyFailureSchema, maxDependencyFailures } from "./source-failure.ts";

const diagnosticSchema = z.object({
  kind: z.string(),
  path: z.string(),
  expected: z.string().optional(),
  observed: z.string().optional(),
  affected_items: z.number().int().nonnegative(),
  disposition: z.enum(["reject", "accept_with_signal"]).optional(),
});

const contractFindingSchema = z.object({
  disposition: z.enum(["reject", "accept_with_signal"]),
  diagnostic_count: z.number().int().positive().optional(),
  diagnostics: z.array(diagnosticSchema),
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
  content_hash: z
    .string()
    .regex(/^[0-9a-f]{64}$/u)
    .optional(),
  http_status: z.number().int().min(100).max(599).optional(),
  dependency_failures: z.array(dependencyFailureSchema).max(maxDependencyFailures).optional(),
  dependency_failures_omitted: z.number().int().positive().optional(),
  message: z.string().optional(),
  error_fingerprint: z
    .string()
    .regex(/^[0-9a-f]{16}$/u)
    .optional(),
  consecutive_failures: z.number().int().nonnegative().optional(),
  last_success_at: z.iso.datetime({ offset: true }).optional(),
  pricing_reconciliation: z
    .object({
      reason_counts: z.record(z.string(), z.number().int().nonnegative()).optional(),
      diagnostics: z
        .array(z.object({ reason_code: z.string(), sample: z.string().optional() }))
        .optional(),
    })
    .optional(),
  contract_finding: contractFindingSchema.optional(),
  contract_findings: z.array(contractFindingSchema).min(1).max(maxContractFindings).optional(),
  contract_findings_omitted: z.number().int().positive().optional(),
  contract_findings_extensions_only: z.boolean().optional(),
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
export const repairableReconciliationReasons: ReadonlySet<string> = new Set([
  "unknown_public_pricing_card",
  "public_price_shape_unsupported",
  "public_price_label_unsupported",
  "unsupported_pricing_cell_preserved",
  "retail_meter_or_unit_unsupported",
  "optional_catalog_source_drifted",
  "pricing_input_contract_partial",
  "pricing_input_contract_drift",
  "pricing_policy_unavailable",
  "pricing_context_scope_unresolved",
  "pricing_location_scope_unresolved",
  "pricing_model_scope_unresolved",
  "served_tier_contract_unavailable",
  "endpoint_reference_drift",
  "endpoint_model_list_drift",
  "model_card_identity_drift",
  "model_card_price_scope_unresolved",
  "model_card_price_cell_unreadable",
  "model_card_input_price_drift",
  "model_card_output_price_drift",
  "public_price_claim_drift",
  "cache_pricing_policy_drift",
  "cache_multiplier_drift",
  "model_card_service_tier_scope_unresolved",
  "inference_geo_contract_drift",
  "inference_geo_multiplier_drift",
  "inference_geo_eligibility_conflict",
  "open_model_pricing_rejected",
  "partner_model_pricing_rejected",
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
    | "pricing_validation";
  /** All distinct triggers merged into this candidate when multiple obligations co-occur on the same subject. */
  triggers?: CatalogRepairCandidate["trigger"][];
  /** Individual dependency parse failures recorded alongside this source candidate. */
  dependency_parse_failures?: Array<{ dependency_id: string; message: string }>;
  /** Count of additional dependency failures omitted from the bounded 16-item summary. */
  dependency_failures_omitted?: number;
  /** Redaction-safe SHA-256 prefix of the unredacted failure error recorded at collection time. */
  error_fingerprint?: string;
  /** Content SHA-256 of the source body observed when the failure occurred. */
  source_hash?: string;
  message: string;
  diagnostics: z.infer<typeof diagnosticSchema>[];
  reconciliation_reasons?: Record<string, number>;
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
  message: string,
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
    ...(attempt.error_fingerprint === undefined
      ? {}
      : { error_fingerprint: attempt.error_fingerprint }),
    ...(attempt.content_hash === undefined ? {} : { source_hash: attempt.content_hash }),
    message,
    diagnostics: [
      ...contractFindings(attempt),
      ...(attempt.dependency_failures ?? []).flatMap((failure) => failure.contract_findings ?? []),
    ].flatMap((finding) =>
      finding.diagnostics.map((diagnostic) => ({
        ...diagnostic,
        ...(finding.disposition === "reject" ? { disposition: "reject" as const } : {}),
      })),
    ),
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

function mergeTriggers(
  existing: CatalogRepairCandidate,
  nextTrigger: CatalogRepairCandidate["trigger"],
): CatalogRepairCandidate["trigger"][] {
  return [...new Set([...(existing.triggers ?? [existing.trigger]), nextTrigger])];
}

export function catalogRepairCandidates(input: unknown): CatalogRepairCandidate[] {
  const report = refreshSummarySchema.parse(input);
  const sources = sourceIndex();
  const candidates = new Map<string, CatalogRepairCandidate>();
  for (const provider of report.providers) {
    const attempt = provider.attempt;
    if (attempt === undefined) continue;
    const stalePricingFailure = (
      failure: Pick<SourceAttempt, "outcome" | "consecutive_failures" | "last_success_at">,
    ): boolean =>
      attempt.pricing?.outcome === "failed" &&
      failure.outcome === "fetch_failed" &&
      (failure.consecutive_failures ?? 0) >= 3 &&
      failure.last_success_at !== undefined &&
      Date.parse(report.generated_at) - Date.parse(failure.last_success_at) >= 86_400_000;
    for (const sourceAttempt of attempt.sources) {
      const source = reviewedSource(sources, provider.provider_id, sourceAttempt.source_id);
      if (source === undefined) continue;
      if (
        source.access === "public" &&
        sourceAttempt.outcome === "fetch_failed" &&
        (repeatedMissingSource(sourceAttempt) || stalePricingFailure(sourceAttempt))
      ) {
        const value = sourceCandidate(
          provider.provider_id,
          source,
          sourceAttempt,
          "source_location_change",
          sourceAttempt.message ??
            "The reviewed public source is repeatedly unavailable and may be retaining stale pricing; investigate acquisition and first-party successors before deciding whether code can repair it.",
        );
        candidates.set(`${value.provider_id}\0${value.subject_id}`, value);
        continue;
      }
      const dependencies = sourceAttempt.dependency_failures ?? [];
      const structural = dependencies.filter(({ outcome }) => outcome === "parse_failed");
      const relocated =
        source.access === "public"
          ? dependencies.filter(
              (failure) =>
                repeatedMissingSource(failure) ||
                (failure.impact === "bundle" && stalePricingFailure(failure)),
            )
          : [];
      const omittedDeps = sourceAttempt.dependency_failures_omitted ?? 0;
      const dependencyParseFailures = structural.map(({ dependency_id, message }) => ({
        dependency_id,
        message,
      }));
      const dependencySuffix =
        structural.length > 0 || relocated.length > 0 || omittedDeps > 0
          ? `Dependency evidence requires investigation: ${[...structural, ...relocated].map(({ dependency_id, message }) => `${dependency_id}: ${message}`).join("; ")}${omittedDeps > 0 ? "; additional failures omitted" : ""}`
          : undefined;
      if (sourceAttempt.outcome === "parse_failed") {
        const mergedTriggers: CatalogRepairCandidate["trigger"][] = [
          "source_parse_failure",
          ...(relocated.length > 0 ? (["source_location_change"] as const) : []),
          ...(omittedDeps > 0 ? (["source_contract_change"] as const) : []),
        ];
        const baseMessage =
          sourceAttempt.message ?? "The reviewed source no longer satisfies its parser contract.";
        const value: CatalogRepairCandidate = {
          ...sourceCandidate(
            provider.provider_id,
            source,
            sourceAttempt,
            "source_parse_failure",
            dependencySuffix === undefined ? baseMessage : `${baseMessage} ${dependencySuffix}`,
          ),
          ...(mergedTriggers.length > 1 ? { triggers: mergedTriggers } : {}),
          ...(dependencyParseFailures.length > 0
            ? { dependency_parse_failures: dependencyParseFailures }
            : {}),
          ...(omittedDeps > 0 ? { dependency_failures_omitted: omittedDeps } : {}),
        };
        candidates.set(`${value.provider_id}\0${value.subject_id}`, value);
        continue;
      }
      if (
        ["changed", "unchanged"].includes(sourceAttempt.outcome) &&
        (structural.length > 0 || relocated.length > 0 || omittedDeps > 0)
      ) {
        const dependencyTriggers: CatalogRepairCandidate["trigger"][] = [
          ...(structural.length > 0 ? (["source_parse_failure"] as const) : []),
          ...(relocated.length > 0 ? (["source_location_change"] as const) : []),
          ...(omittedDeps > 0 ? (["source_contract_change"] as const) : []),
        ];
        const value: CatalogRepairCandidate = {
          ...sourceCandidate(
            provider.provider_id,
            source,
            sourceAttempt,
            dependencyTriggers[0] ?? "source_contract_change",
            dependencySuffix ?? "Dependency evidence requires investigation.",
          ),
          ...(dependencyTriggers.length > 1 ? { triggers: dependencyTriggers } : {}),
          ...(dependencyParseFailures.length > 0
            ? { dependency_parse_failures: dependencyParseFailures }
            : {}),
          ...(omittedDeps > 0 ? { dependency_failures_omitted: omittedDeps } : {}),
        };
        candidates.set(`${value.provider_id}\0${value.subject_id}`, value);
        // The reconciliation branch below may add independent native price evidence.
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
        const missingReasonMap = Object.fromEntries(missingContracts);
        const value: CatalogRepairCandidate = {
          ...sourceCandidate(
            provider.provider_id,
            source,
            sourceAttempt,
            "source_pricing_structure",
            `Missing reviewed source contracts: ${missingContracts.map(([reason, count]) => `${reason}: ${count}`).join(", ")}.${details.length === 0 ? "" : ` ${details.join("; ")}`}`,
          ),
          reconciliation_reasons: missingReasonMap,
        };
        upsertCandidate(candidates, value, value.message, {
          reconciliation_reasons: (existing) => ({
            ...existing.reconciliation_reasons,
            ...missingReasonMap,
          }),
        });
        continue;
      }
      const findings = contractFindings(sourceAttempt);
      const consumedContractDrift = findings.some(isContractDrift);
      const incompleteFindings =
        sourceAttempt.contract_findings_extensions_only !== true &&
        ((sourceAttempt.contract_findings_omitted ?? 0) > 0 ||
          findings.some(
            ({ diagnostic_count, diagnostics }) =>
              (diagnostic_count ?? diagnostics.length) > diagnostics.length,
          ));
      if (
        ["changed", "unchanged"].includes(sourceAttempt.outcome) &&
        (consumedContractDrift || incompleteFindings)
      ) {
        const value = sourceCandidate(
          provider.provider_id,
          source,
          sourceAttempt,
          "source_contract_change",
          sourceAttempt.message ??
            "The source contains unresolved contract evidence; investigate before deciding whether a code repair is needed.",
        );
        upsertCandidate(candidates, value, value.message);
      }
    }

    if (attempt.outcome === "rejected" && attempt.validation_issue !== undefined) {
      const changedSources = attempt.sources.filter(
        ({ outcome, content_changed }) => outcome === "changed" && content_changed === true,
      );
      for (const sourceAttempt of changedSources) {
        const source = reviewedSource(sources, provider.provider_id, sourceAttempt.source_id);
        if (source === undefined) continue;
        const issueMessage = `${attempt.validation_issue.code}: ${attempt.validation_issue.message}`;
        const value = sourceCandidate(
          provider.provider_id,
          source,
          sourceAttempt,
          "provider_validation",
          issueMessage,
        );
        upsertCandidate(candidates, value, `Provider validation: ${issueMessage}`);
      }
      if (
        changedSources.length === 0 &&
        (attempt.sources.some(({ outcome }) => ["changed", "unchanged"].includes(outcome)) ||
          !attempt.sources.some(({ outcome }) =>
            ["fetch_failed", "skipped_not_configured"].includes(outcome),
          ))
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

function upsertCandidate(
  candidates: Map<string, CatalogRepairCandidate>,
  value: CatalogRepairCandidate,
  mergedSuffix: string,
  extra?: {
    reconciliation_reasons?: (existing: CatalogRepairCandidate) => Record<string, number>;
  },
): void {
  const key = `${value.provider_id}\0${value.subject_id}`;
  const existing = candidates.get(key);
  if (existing === undefined) {
    candidates.set(key, value);
    return;
  }
  candidates.set(key, {
    ...existing,
    triggers: mergeTriggers(existing, value.trigger),
    message: `${existing.message} ${mergedSuffix}`,
    ...(extra?.reconciliation_reasons === undefined
      ? {}
      : { reconciliation_reasons: extra.reconciliation_reasons(existing) }),
  });
}

function repeatedMissingSource(
  attempt: Pick<SourceAttempt, "outcome" | "http_status" | "consecutive_failures" | "message">,
): boolean {
  if (attempt.outcome !== "fetch_failed" || (attempt.consecutive_failures ?? 0) < 2) return false;
  return attempt.http_status === undefined
    ? /^HTTP (?:404|410)$/.test(attempt.message ?? "")
    : attempt.http_status === 404 || attempt.http_status === 410;
}
