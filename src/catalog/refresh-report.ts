import { z } from "zod";
import { modelLimitFields } from "./catalog-vocabulary.ts";
import { sourceContractEvidenceSchema } from "./source-contract.ts";
import {
  sourcePricingExtractionSchema,
  sourcePricingReconciliationSchema,
} from "./pricing-reconciliation.ts";

const fieldChangeSchema = z
  .object({
    path: z.string().min(1),
    previous: z.json().optional(),
    current: z.json().optional(),
  })
  .refine(({ previous, current }) => previous !== undefined || current !== undefined, {
    message: "Field change must retain a previous or current value",
  });

const legacyLimitValueSchema = z.union([
  z.number().int().nonnegative(),
  z.array(z.number().int().positive()),
  z.object({ min: z.number().int().positive(), max: z.number().int().positive() }),
]);

const legacyLimitChangeSchema = z
  .object({
    field: z.enum(modelLimitFields),
    previous: legacyLimitValueSchema.optional(),
    current: legacyLimitValueSchema.optional(),
  })
  .refine(({ previous, current }) => previous !== undefined || current !== undefined, {
    message: "Legacy limit change must retain a previous or current value",
  });

const diffSchema = z.object({
  current: z.number().int().nonnegative(),
  added: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  changed: z.number().int().nonnegative(),
  added_model_refs: z.array(z.string()).default([]),
  removed_model_refs: z.array(z.string()).default([]),
  changed_models: z
    .array(
      z.object({
        model_ref: z.string(),
        fields: z.array(z.string()),
        field_changes: z.array(fieldChangeSchema).default([]),
        limit_changes: z.array(legacyLimitChangeSchema).default([]),
        previous_status: z.string().optional(),
        status: z.string().optional(),
        previous_tasks: z.array(z.string()).optional(),
        tasks: z.array(z.string()).optional(),
      }),
    )
    .default([]),
});

const attemptSchema = z.object({
  outcome: z.enum(["accepted", "rejected", "not_configured"]),
  sources: z.array(
    z.object({
      source_id: z.string(),
      outcome: z.enum([
        "changed",
        "unchanged",
        "fetch_failed",
        "parse_failed",
        "skipped_not_configured",
      ]),
      consecutive_failures: z.number().int().positive().optional(),
      last_success_at: z.iso.datetime({ offset: true }).optional(),
      contract_finding: sourceContractEvidenceSchema.optional(),
      pricing_extraction: sourcePricingExtractionSchema.optional(),
      pricing_reconciliation: sourcePricingReconciliationSchema.optional(),
    }),
  ),
  validation_issue: z.object({ code: z.string() }).optional(),
  failure: z.object({ code: z.string() }).optional(),
  pricing: z
    .object({
      outcome: z.enum(["accepted", "failed", "not_observed"]),
      failure_code: z.string().optional(),
    })
    .optional(),
});

const providerSchema = z.object({
  provider_id: z.string(),
  status: z.enum(["fresh", "stale", "unavailable", "not_configured", "removed"]),
  publication: z.enum(["accepted", "retained", "withheld", "not_configured", "removed"]).optional(),
  models: diffSchema,
  sources: z.object({ changed: z.number().int().nonnegative() }),
  pricing: z.object({ outcome: z.string() }),
  pricing_coverage: z
    .object({
      current_models: z.number().int().nonnegative(),
      offer_models: z.number().int().nonnegative(),
      not_applicable_models: z.number().int().nonnegative(),
      unknown_models: z.number().int().nonnegative(),
      normalized_rate_models: z.number().int().nonnegative(),
      raw_fact_models: z.number().int().nonnegative(),
      unknown_model_refs: z.array(z.string()),
      unknown_model_refs_omitted: z.number().int().nonnegative(),
    })
    .optional(),
  signals: z.array(z.string()).default([]),
  attempt: attemptSchema.optional(),
});

// The checked-in report advances only on live refresh, so a deployment must still render its
// immediately preceding generated shape.
const reportSchema = z.object({
  generated_at: z.iso.datetime({ offset: true }),
  catalog_version: z.string().min(12),
  outcome: z.enum(["changed", "evidence_only", "unchanged", "partially_retained"]).optional(),
  publication: z.enum(["complete", "partial"]).optional(),
  providers: z.array(providerSchema),
  operational: z
    .object({
      provider_durations: z.array(
        z.object({
          provider_id: z.string(),
          duration_ms: z.number().int().nonnegative(),
        }),
      ),
    })
    .optional(),
});

type Provider = z.infer<typeof providerSchema>;
type SourceAttempt = NonNullable<Provider["attempt"]>["sources"][number];
const publicationByStatus: Record<Provider["status"], NonNullable<Provider["publication"]>> = {
  fresh: "accepted",
  stale: "retained",
  unavailable: "withheld",
  not_configured: "not_configured",
  removed: "removed",
};

function table(value: string): string {
  return value.replaceAll("|", "\\|");
}

function inlineCode(value: string): string {
  return `<code>${value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("|", "&#124;")
    .replaceAll("\r", "")
    .replaceAll("\n", "&#10;")}</code>`;
}

function displayChangeValue(value: z.infer<typeof fieldChangeSchema>["previous"]): string {
  if (value === undefined) return "<em>missing</em>";
  const encoded = JSON.stringify(value);
  const bounded = encoded.length <= 240 ? encoded : `${encoded.slice(0, 239)}…`;
  return inlineCode(bounded);
}

function legacyChangeDetails(value: Provider["models"]["changed_models"][number]): string[] {
  const exactLimits = value.limit_changes.map(
    ({ field, previous, current }) =>
      `${inlineCode(`limits.${field}`)}: ${displayChangeValue(previous)} → ${displayChangeValue(current)}`,
  );
  const fields = value.fields
    .filter((field) => field !== "limits" || exactLimits.length === 0)
    .map((field) => {
      if (field === "status" && (value.previous_status !== undefined || value.status !== undefined))
        return `${inlineCode(field)}: ${displayChangeValue(value.previous_status)} → ${displayChangeValue(value.status)}`;
      if (field === "tasks" && (value.previous_tasks !== undefined || value.tasks !== undefined))
        return `${inlineCode(field)}: ${displayChangeValue(value.previous_tasks)} → ${displayChangeValue(value.tasks)}`;
      return inlineCode(field);
    });
  return [...exactLimits, ...fields];
}

function changedModelDetails(value: Provider["models"]["changed_models"][number]): string {
  const details =
    value.field_changes.length > 0
      ? value.field_changes.map(
          ({ path, previous, current }) =>
            `${inlineCode(path)}: ${displayChangeValue(previous)} → ${displayChangeValue(current)}`,
        )
      : legacyChangeDetails(value);
  return details.join("<br>") || "—";
}

function modelChangeTable(provider: Provider): string[] {
  const rows = [
    ...provider.models.added_model_refs.map((modelRef) => ["Added", modelRef, "—"]),
    ...provider.models.changed_models.map((model) => [
      "Updated",
      model.model_ref,
      changedModelDetails(model),
    ]),
    ...provider.models.removed_model_refs.map((modelRef) => ["Removed", modelRef, "—"]),
  ];
  if (rows.length === 0) return [];
  return [
    "#### Model changes",
    "",
    "| Change | Model | Details |",
    "| --- | --- | --- |",
    ...rows.map(
      ([change, modelRef, details]) =>
        `| ${change} | ${inlineCode(modelRef ?? "")} | ${details ?? "—"} |`,
    ),
  ];
}

function pricingOutcome(outcome: string): string {
  if (outcome === "none") return "not tracked";
  if (outcome === "added") return "pricing added";
  if (outcome === "removed") return "pricing removed";
  if (outcome === "commercial") return "commercial terms changed";
  if (outcome === "provenance_only") return "terms unchanged; evidence changed";
  if (outcome === "unchanged") return "unchanged";
  return outcome.replaceAll("_", " ");
}

function staleness(generatedAt: string, lastSuccessAt: string | undefined): string | undefined {
  if (lastSuccessAt === undefined) return undefined;
  const milliseconds = Date.parse(generatedAt) - Date.parse(lastSuccessAt);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return undefined;
  const hours = milliseconds / 3_600_000;
  return hours < 48 ? `${hours.toFixed(1)}h stale` : `${(hours / 24).toFixed(1)}d stale`;
}

function sourceFailure(source: SourceAttempt, generatedAt: string): string {
  const details = [
    source.consecutive_failures === undefined
      ? undefined
      : `${source.consecutive_failures} consecutive`,
    staleness(generatedAt, source.last_success_at),
  ].filter((value): value is string => value !== undefined);
  return `\`${source.source_id}\` ${source.outcome}${details.length === 0 ? "" : ` (${details.join(", ")})`}`;
}

function contractFindingLines(source: SourceAttempt): string[] {
  const evidence = source.contract_finding;
  if (evidence === undefined) return [];
  const lines = evidence.diagnostics.map((diagnostic) => {
    const observed = `${diagnostic.observed}${diagnostic.observed_value === undefined ? "" : ` \`${diagnostic.observed_value}\``}`;
    const samples = diagnostic.sample_model_ids?.map((id) => `\`${id}\``).join(", ");
    return `- Contract ${evidence.disposition} \`${source.source_id}\` \`${diagnostic.path}\`: \`${diagnostic.kind}\`; expected ${diagnostic.expected ?? "reviewed shape"}, observed ${observed}; ${diagnostic.affected_items}/${evidence.observed_items} items${samples === undefined ? "" : `; examples ${samples}`}; fingerprint \`${diagnostic.fingerprint}\``;
  });
  const omitted = evidence.diagnostic_count - evidence.diagnostics.length;
  if (omitted > 0)
    lines.push(
      `- Contract ${evidence.disposition} \`${source.source_id}\`: ${omitted} additional diagnostics omitted`,
    );
  return lines;
}

function pricingExtractionLine(source: SourceAttempt): string[] {
  const pricing = source.pricing_extraction;
  if (pricing === undefined) return [];
  return [
    `- Pricing extraction \`${source.source_id}\`: ${pricing.model_records} model records; ${pricing.numeric_models} numeric, ${pricing.raw_models} with raw facts, ${pricing.free_models} free, ${pricing.custom_quote_models} custom quote, ${pricing.not_published_models} not published, ${pricing.not_applicable_models} not applicable, ${pricing.unknown_models} unresolved; ${pricing.normalized_facts} normalized facts and ${pricing.raw_facts} raw facts`,
  ];
}

function pricingReconciliationLine(source: SourceAttempt): string[] {
  const evidence = source.pricing_reconciliation;
  if (evidence === undefined) return [];
  const counts = evidence.disposition_counts;
  const line = `- Pricing reconciliation \`${source.source_id}\`: ${evidence.basis.replace("_", " ")} over ${evidence.observed_items} ${evidence.unit}s; ${counts.normalized} normalized, ${counts.raw} raw, ${counts.explicit_non_numeric} explicit non-numeric, ${counts.excluded} excluded, ${evidence.diagnostic_count} unresolved`;
  const diagnostics = evidence.diagnostics.map(
    ({ disposition, reason_code, sample }) =>
      `- Pricing finding \`${source.source_id}\`: \`${disposition}\` / \`${reason_code}\`${sample === undefined ? "" : `; \`${sample}\``}`,
  );
  const omitted = evidence.diagnostic_count - evidence.diagnostics.length;
  if (omitted > 0)
    diagnostics.push(
      `- Pricing finding \`${source.source_id}\`: ${omitted} additional unresolved items omitted`,
    );
  return [line, ...diagnostics];
}

function pricingReconciliationWarnings(providerId: string, source: SourceAttempt): string[] {
  const evidence = source.pricing_reconciliation;
  if (evidence === undefined || evidence.diagnostic_count === 0) return [];
  const counts = evidence.disposition_counts;
  return [
    `${providerId}/${source.source_id}: ${evidence.diagnostic_count}/${evidence.observed_items} pricing items unresolved (${counts.unbound} unbound, ${counts.ambiguous} ambiguous, ${counts.unsupported} unsupported, ${counts.unresolved} unresolved)`,
  ];
}

function contractFindingWarnings(providerId: string, source: SourceAttempt): string[] {
  const evidence = source.contract_finding;
  const first = evidence?.diagnostics[0];
  return evidence === undefined || first === undefined
    ? []
    : [
        `${providerId}/${source.source_id}: ${evidence.disposition} ${first.kind} at ${first.path} (${first.affected_items}/${evidence.observed_items} items; ${first.fingerprint})`,
      ];
}

function persistentFailureWarning(
  providerId: string,
  source: SourceAttempt,
  generatedAt: string,
): string[] {
  const failures = source.consecutive_failures ?? 0;
  if (failures < 2) return [];
  const stale = staleness(generatedAt, source.last_success_at);
  return [
    `${providerId}/${source.source_id}: ${failures} consecutive failures${stale === undefined ? "" : `; ${stale}`}`,
  ];
}

interface RefreshReportOutput {
  markdown: string;
  warnings: string[];
}

export function refreshReport(value: unknown): RefreshReportOutput {
  const report = reportSchema.parse(value);
  const providers = report.providers.map((provider) => ({
    ...provider,
    publication: provider.publication ?? publicationByStatus[provider.status],
  }));
  const retained = providers.filter(
    ({ publication: state }) => state === "retained" || state === "withheld",
  );
  const changed = providers.filter(
    ({ models, sources, pricing }) =>
      models.added > 0 ||
      models.removed > 0 ||
      models.changed > 0 ||
      sources.changed > 0 ||
      ["added", "removed", "commercial", "provenance_only"].includes(pricing.outcome),
  );
  const publicationState = report.publication ?? (retained.length > 0 ? "partial" : "complete");
  const durations = new Map(
    report.operational?.provider_durations.map(({ provider_id, duration_ms }) => [
      provider_id,
      duration_ms,
    ]),
  );
  const outcome =
    report.outcome === "partially_retained"
      ? changed.length > 0
        ? "changed"
        : "unchanged"
      : (report.outcome ?? (changed.length > 0 ? "changed" : "unchanged"));
  const lines = [
    "## Catalog refresh",
    "",
    `**${outcome.replaceAll("_", " ")}** · ${publicationState} publication · ${report.generated_at} · \`${report.catalog_version.slice(0, 12)}\``,
    "",
    "Models now is the current published count. Model Δ lists added, removed, and updated model identities since the previous accepted catalog. Pricing Δ compares pricing semantics, not a price value.",
    "",
    "| Provider | Publication | Models now | Model Δ | Source Δ | Pricing Δ | Coverage | Duration | Signals |",
    "| --- | --- | ---: | --- | ---: | --- | --- | ---: | --- |",
    ...providers.map(
      ({
        provider_id,
        publication: state,
        models,
        sources,
        pricing,
        pricing_coverage: coverage,
        signals,
      }) =>
        `| ${[
          table(provider_id),
          state,
          String(models.current),
          `+${models.added} added · −${models.removed} removed · ~${models.changed} updated`,
          `${sources.changed} changed`,
          table(pricingOutcome(pricing.outcome)),
          coverage === undefined
            ? "—"
            : `${coverage.offer_models + coverage.not_applicable_models}/${coverage.current_models} resolved · ${coverage.unknown_models} unknown`,
          durations.has(provider_id)
            ? `${((durations.get(provider_id) ?? 0) / 1000).toFixed(1)}s`
            : "—",
          table(signals.join(", ") || "—"),
        ].join(" | ")} |`,
    ),
  ];

  for (const provider of providers) {
    const findingSources =
      provider.attempt?.sources.filter(({ contract_finding: finding }) => finding !== undefined) ??
      [];
    const pricingSources =
      provider.attempt?.sources.filter(
        ({ pricing_extraction: pricing }) => pricing !== undefined,
      ) ?? [];
    const failedSources =
      provider.attempt?.sources.filter(({ outcome: sourceOutcome }) =>
        ["fetch_failed", "parse_failed", "skipped_not_configured"].includes(sourceOutcome),
      ) ?? [];
    if (
      provider.models.added === 0 &&
      provider.models.removed === 0 &&
      provider.models.changed === 0 &&
      failedSources.length === 0 &&
      findingSources.length === 0 &&
      provider.attempt?.validation_issue === undefined &&
      provider.attempt?.pricing?.outcome !== "failed" &&
      (provider.pricing_coverage?.unknown_models ?? 0) === 0 &&
      pricingSources.every(({ pricing_extraction: pricing }) => pricing?.unknown_models === 0)
    )
      continue;
    lines.push("", `### ${provider.provider_id}`, "");
    lines.push(...modelChangeTable(provider));
    const pricingCoverage = provider.pricing_coverage;
    if (pricingCoverage !== undefined && pricingCoverage.unknown_models > 0) {
      const omitted = pricingCoverage.unknown_model_refs_omitted;
      lines.push(
        `- Unknown pricing: ${pricingCoverage.unknown_models}/${pricingCoverage.current_models} current models; examples ${pricingCoverage.unknown_model_refs.map((modelRef) => `\`${modelRef}\``).join(", ")}${omitted === 0 ? "" : ` (+${omitted} more)`}`,
      );
    }
    for (const source of pricingSources) lines.push(...pricingExtractionLine(source));
    for (const source of pricingSources) lines.push(...pricingReconciliationLine(source));
    if (provider.models.added > 0 && provider.models.added_model_refs.length === 0)
      lines.push(`- Added: ${provider.models.added} models (identities unavailable)`);
    if (provider.models.removed > 0 && provider.models.removed_model_refs.length === 0)
      lines.push(`- Removed: ${provider.models.removed} models (identities unavailable)`);
    if (provider.models.changed > 0 && provider.models.changed_models.length === 0)
      lines.push(`- Updated: ${provider.models.changed} models (details unavailable)`);
    if (failedSources.length > 0)
      lines.push(
        `- Source attempts: ${failedSources.map((source) => sourceFailure(source, report.generated_at)).join(", ")}`,
      );
    for (const source of findingSources) lines.push(...contractFindingLines(source));
    if (provider.attempt?.validation_issue !== undefined)
      lines.push(`- Validation: \`${provider.attempt.validation_issue.code}\``);
    if (provider.attempt?.failure !== undefined)
      lines.push(`- Failure: \`${provider.attempt.failure.code}\``);
    if (provider.attempt?.pricing?.outcome === "failed")
      lines.push(`- Pricing attempt: \`${provider.attempt.pricing.failure_code ?? "failed"}\``);
  }

  return {
    markdown: `${lines.join("\n")}\n`,
    warnings: [
      ...retained.map(
        ({ provider_id, publication: state }) => `${provider_id} publication was ${state}`,
      ),
      ...providers.flatMap(({ provider_id, signals }) =>
        signals
          .filter(
            (signal) =>
              ![
                "breaking_contract_mismatch",
                "unreviewed_extension",
                "persistent_source_failure",
              ].includes(signal),
          )
          .map((signal) => `${provider_id}: ${signal}`),
      ),
      ...providers.flatMap(
        ({ provider_id, attempt }) =>
          attempt?.sources.flatMap((source) => contractFindingWarnings(provider_id, source)) ?? [],
      ),
      ...providers.flatMap(
        ({ provider_id, attempt }) =>
          attempt?.sources.flatMap((source) =>
            pricingReconciliationWarnings(provider_id, source),
          ) ?? [],
      ),
      ...providers.flatMap(
        ({ provider_id, attempt }) =>
          attempt?.sources.flatMap((source) =>
            persistentFailureWarning(provider_id, source, report.generated_at),
          ) ?? [],
      ),
      ...providers.flatMap(({ provider_id, attempt }) =>
        attempt?.pricing?.outcome === "failed"
          ? [`${provider_id}: pricing attempt ${attempt.pricing.failure_code ?? "failed"}`]
          : [],
      ),
    ],
  };
}
