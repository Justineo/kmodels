import { z } from "zod";
import { manifests, type SourceManifest } from "./manifests.ts";
import { compareUtf8 } from "./canonical-value.ts";
import { contractFindings, isContractDrift, maxContractFindings } from "./source-contract.ts";
import { dependencyFailureSchema, maxDependencyFailures } from "./source-failure.ts";

const diagnosticSchema = z.object({
  kind: z.string(),
  path: z.string(),
  expected: z.string().optional(),
  observed: z.string().optional(),
  affected_items: z.number().int().nonnegative(),
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
  http_status: z.number().int().min(100).max(599).optional(),
  dependency_failures: z.array(dependencyFailureSchema).max(maxDependencyFailures).optional(),
  dependency_failures_omitted: z.number().int().positive().optional(),
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
  contract_finding: contractFindingSchema.optional(),
  contract_findings: z.array(contractFindingSchema).min(1).max(maxContractFindings).optional(),
  contract_findings_omitted: z.number().int().positive().optional(),
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
  "public_price_shape_unsupported",
  "public_price_label_unsupported",
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
    | "pricing_validation"
    | "scheduled_provider_review"
    | "scheduled_architecture_review"
    | "semantic_coverage_review";
  message: string;
  diagnostics: z.infer<typeof diagnosticSchema>[];
}

/** Admit one error-driven provider per run, keeping the independent periodic review. */
export function catalogRepairBatch(
  candidates: readonly CatalogRepairCandidate[],
  at: Date,
): {
  selected: CatalogRepairCandidate[];
  deferred: CatalogRepairCandidate[];
} {
  if (!Number.isFinite(at.getTime())) throw new Error("Catalog repair batch requires a valid date");
  const periodic = (candidate: CatalogRepairCandidate) =>
    candidate.trigger === "scheduled_provider_review" ||
    candidate.trigger === "scheduled_architecture_review";
  const pending = new Set(
    candidates.filter((candidate) => !periodic(candidate)).map(({ provider_id }) => provider_id),
  );
  const providers = manifests.map(({ provider }) => provider.id).sort(compareUtf8);
  for (const providerId of pending)
    if (!providers.includes(providerId))
      throw new Error(`Unconfigured repair provider: ${providerId}`);
  const day = Math.floor(at.getTime() / 86_400_000);
  const start = ((day % providers.length) + providers.length) % providers.length;
  const providerId = Array.from(
    { length: providers.length },
    (_, offset) => providers[(start + offset) % providers.length],
  ).find((id) => id !== undefined && pending.has(id));
  return {
    selected: candidates.filter(
      (candidate) => periodic(candidate) || candidate.provider_id === providerId,
    ),
    deferred: candidates.filter(
      (candidate) => !periodic(candidate) && candidate.provider_id !== providerId,
    ),
  };
}

/** Build commands from reviewed source IDs, never from provider IDs or report prose. */
export function catalogRepairEvidenceCommands(
  candidates: readonly CatalogRepairCandidate[],
): string[] {
  const sources = new Set(
    candidates.flatMap((candidate) =>
      candidate.trigger === "scheduled_provider_review"
        ? (manifests
            .find(({ provider }) => provider.id === candidate.provider_id)
            ?.sources.map(({ id }) => id) ?? [])
        : (candidate.source_id ?? []),
    ),
  );
  return manifests.flatMap(({ sources: configured }) =>
    configured.flatMap((source: SourceManifest) =>
      sources.has(source.id) && source.access === "public" && !source.auth
        ? [`vp node scripts/fetch-catalog-evidence.ts ${source.id}`]
        : [],
    ),
  );
}

/** One provider per UTC day, followed by a global consistency review; independent of refresh errors. */
export function scheduledCatalogReview(at: Date): CatalogRepairCandidate {
  if (!Number.isFinite(at.getTime()))
    throw new Error("Periodic catalog review requires a valid date");
  const providers = manifests.map(({ provider }) => provider.id).sort(compareUtf8);
  const day = Math.floor(at.getTime() / 86_400_000);
  const cycleLength = providers.length + 1;
  const slot = ((day % cycleLength) + cycleLength) % cycleLength;
  const providerId = providers[slot];
  return {
    provider_id: providerId ?? "catalog",
    scope: "provider",
    subject_id: "scheduled-review",
    trigger:
      providerId === undefined ? "scheduled_architecture_review" : "scheduled_provider_review",
    message:
      providerId === undefined
        ? "Review global price-model consistency, source/parse/publication boundaries, repair feedback and shared simplification using current provider evidence. A healthy refresh is not proof of semantic completeness."
        : `Review ${providerId} end to end against current first-party evidence: discovery, identity/lifecycle, price inventory/scopes, accounting, retention/replay, calculator/display and simplicity. Do not limit investigation to existing error signals.`,
    diagnostics: [],
  };
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
    diagnostics: [
      ...contractFindings(attempt),
      ...(attempt.dependency_failures ?? []).flatMap((failure) => failure.contract_findings ?? []),
    ].flatMap(({ diagnostics }) => diagnostics),
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
        repeatedMissingSource(sourceAttempt)
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
      const dependencies = sourceAttempt.dependency_failures ?? [];
      const structural = dependencies.filter(({ outcome }) => outcome === "parse_failed");
      const relocated =
        source.access === "public" ? dependencies.filter(repeatedMissingSource) : [];
      if (
        ["changed", "unchanged"].includes(sourceAttempt.outcome) &&
        (structural.length > 0 ||
          relocated.length > 0 ||
          (sourceAttempt.dependency_failures_omitted ?? 0) > 0)
      ) {
        const value = sourceCandidate(
          provider.provider_id,
          source,
          {
            ...sourceAttempt,
            message: `Dependency evidence requires investigation: ${[...structural, ...relocated].map(({ dependency_id, message }) => `${dependency_id}: ${message}`).join("; ")}${(sourceAttempt.dependency_failures_omitted ?? 0) > 0 ? "; additional failures omitted" : ""}`,
          },
          structural.length > 0
            ? "source_parse_failure"
            : relocated.length > 0
              ? "source_location_change"
              : "source_contract_change",
          "Inspect failed source dependencies.",
        );
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
        const value = sourceCandidate(
          provider.provider_id,
          source,
          sourceAttempt,
          "source_pricing_structure",
          `Missing reviewed source contracts: ${missingContracts.map(([reason, count]) => `${reason}: ${count}`).join(", ")}.${details.length === 0 ? "" : ` ${details.join("; ")}`}`,
        );
        const key = `${value.provider_id}\0${value.subject_id}`;
        const existing = candidates.get(key);
        candidates.set(
          key,
          existing === undefined
            ? value
            : { ...value, message: `${existing.message} ${value.message}` },
        );
        continue;
      }
      const findings = contractFindings(sourceAttempt);
      const consumedContractDrift = findings.some(isContractDrift);
      const incompleteFindings =
        (sourceAttempt.contract_findings_omitted ?? 0) > 0 ||
        findings.some(
          ({ diagnostic_count, diagnostics }) =>
            (diagnostic_count ?? diagnostics.length) > diagnostics.length,
        );
      if (
        ["changed", "unchanged"].includes(sourceAttempt.outcome) &&
        (consumedContractDrift ||
          incompleteFindings ||
          (sourceAttempt.content_changed === true && findings.length > 0))
      ) {
        const value = sourceCandidate(
          provider.provider_id,
          source,
          sourceAttempt,
          "source_contract_change",
          "The source contains unresolved contract evidence; investigate before deciding whether a code repair is needed.",
        );
        const key = `${value.provider_id}\0${value.subject_id}`;
        const existing = candidates.get(key);
        candidates.set(
          key,
          existing === undefined
            ? value
            : { ...existing, message: `${existing.message} ${value.message}` },
        );
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
        const key = `${value.provider_id}\0${value.subject_id}`;
        const existing = candidates.get(key);
        candidates.set(
          key,
          existing === undefined
            ? value
            : {
                ...existing,
                message: `${existing.message} Provider validation: ${attempt.validation_issue.code}: ${attempt.validation_issue.message}`,
              },
        );
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
export function catalogRepairEvidenceIncomplete(
  input: unknown,
  providerIds?: ReadonlySet<string>,
): boolean {
  return refreshSummarySchema
    .parse(input)
    .providers.filter(
      ({ provider_id }) => providerIds === undefined || providerIds.has(provider_id),
    )
    .some(
      ({ attempt }) =>
        attempt?.sources.some(
          ({ outcome, dependency_failures, dependency_failures_omitted }) =>
            outcome === "fetch_failed" ||
            dependency_failures?.some(({ outcome }) => outcome === "fetch_failed") === true ||
            (dependency_failures_omitted ?? 0) > 0,
        ) === true ||
        (attempt?.pricing?.outcome === "failed" &&
          attempt.pricing.failure_code === "source_unavailable"),
    );
}

function repeatedMissingSource(
  attempt: Pick<SourceAttempt, "outcome" | "http_status" | "consecutive_failures" | "message">,
): boolean {
  if (attempt.outcome !== "fetch_failed" || (attempt.consecutive_failures ?? 0) < 2) return false;
  return attempt.http_status === undefined
    ? /^HTTP (?:404|410)$/.test(attempt.message ?? "")
    : attempt.http_status === 404 || attempt.http_status === 410;
}
