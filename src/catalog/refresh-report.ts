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
  sources: z.object({
    added: z.number().int().nonnegative().default(0),
    removed: z.number().int().nonnegative().default(0),
    changed: z.number().int().nonnegative(),
  }),
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
type ProviderDetailRow = readonly [type: string, source: string, value: string];
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
    ...provider.models.added_model_refs.map((modelRef) => ["+", modelRef, "—"]),
    ...provider.models.changed_models.map((model) => [
      "~",
      model.model_ref,
      changedModelDetails(model),
    ]),
    ...provider.models.removed_model_refs.map((modelRef) => ["−", modelRef, "—"]),
  ];
  if (rows.length === 0) return [];
  return [
    "#### Model changes",
    "",
    "| Δ | Model | Details |",
    "| --- | --- | --- |",
    ...rows.map(
      ([change, modelRef, details]) =>
        `| ${change} | ${inlineCode(modelRef ?? "")} | ${details ?? "—"} |`,
    ),
  ];
}

function providerDetailTable(rows: ProviderDetailRow[]): string[] {
  if (rows.length === 0) return [];
  return [
    "#### Details",
    "",
    "| Type | Source | Value |",
    "| --- | --- | --- |",
    ...rows.map(
      ([type, source, value]) => `| ${table(type)} | ${table(source)} | ${table(value)} |`,
    ),
  ];
}

const legend = [
  "",
  "<details>",
  "<summary>Legend</summary>",
  "",
  "#### Deltas",
  "",
  "- `Models` is the current published count. In both delta columns, `+` means added, `−` removed, and `~` updated/changed since the previous accepted catalog.",
  "- Model `~`: the same model identity remains, but at least one published semantic field changed. Observation time alone is not compared.",
  "- Source `~`: the same accepted source record remains, but its content hash, extractor version, or declared field paths changed. A source change is input/evidence churn and does not necessarily change a model, so the two `~` counts need not match.",
  "",
  "#### Publication",
  "",
  "- `accepted`: the fresh candidate was published.",
  "- `retained`: the refresh did not replace this provider; its previous accepted data was kept.",
  "- `withheld`: no usable previous data was available and the candidate was not published.",
  "- `not_configured`: this provider is intentionally not configured for collection.",
  "- `removed`: this provider is no longer in the published catalog.",
  "",
  "#### Pricing",
  "",
  "- `none`: neither catalog has a pricing partition for this provider.",
  "- `added`: a pricing partition was added.",
  "- `removed`: a pricing partition was explicitly removed.",
  "- `commercial`: canonical commercial terms changed.",
  "- `provenance_only`: commercial terms stayed the same; only provenance, freshness, publication, or other non-commercial evidence changed.",
  "- `unchanged`: the complete pricing partition stayed the same.",
  "",
  "#### Signals",
  "",
  "- `drift_guard_triggered`: validation rejected an abrupt model-count drop.",
  "- `breaking_contract_mismatch`: a source field or value owned by the projection became uninterpretable.",
  "- `unreviewed_extension`: fresh data was accepted after an unrelated extension was stripped.",
  "- `coverage_regression`: reviewed item or field coverage fell below its threshold.",
  "- `possible_structural_change`: an unclassified parse failure may indicate a source-structure change.",
  "- `persistent_source_failure`: at least one source has failed twice or more consecutively.",
  "",
  "#### Coverage",
  "",
  "- Coverage uses `resolved/current · ?unknown`. Resolved means a public offer or an explicit not-applicable disposition.",
  "",
  "#### Provider details",
  "",
  "- Detail tables keep raw outcome and reason codes. Zero-valued counters are omitted.",
  "- `Extract` summarizes parsed model states; `facts N/R` means normalized/raw facts. `Reconcile` summarizes the reviewed source-item partition; `?N` is the unresolved finding count.",
  "- `Finding` gives disposition and reason code; bounded public samples are collapsed below the table. `Contract` gives disposition, mismatch kind and path, affected/observed items, expected and observed shapes, and fingerprint.",
  "- `Source`, `Validation`, `Failure`, and `Pricing` retain their machine-readable outcome or failure code.",
  "",
  "</details>",
];

function staleness(generatedAt: string, lastSuccessAt: string | undefined): string | undefined {
  if (lastSuccessAt === undefined) return undefined;
  const milliseconds = Date.parse(generatedAt) - Date.parse(lastSuccessAt);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return undefined;
  const hours = milliseconds / 3_600_000;
  return hours < 48 ? `${hours.toFixed(1)}h stale` : `${(hours / 24).toFixed(1)}d stale`;
}

function sourceAttemptValue(source: SourceAttempt, generatedAt: string): string {
  const details = [
    source.consecutive_failures === undefined
      ? undefined
      : `${source.consecutive_failures} consecutive`,
    staleness(generatedAt, source.last_success_at),
  ].filter((value): value is string => value !== undefined);
  return `\`${source.outcome}\`${details.length === 0 ? "" : ` · ${details.join(" · ")}`}`;
}

function contractFindingRows(source: SourceAttempt): ProviderDetailRow[] {
  const evidence = source.contract_finding;
  if (evidence === undefined) return [];
  const rows: ProviderDetailRow[] = evidence.diagnostics.map((diagnostic) => {
    const observed = `${diagnostic.observed}${diagnostic.observed_value === undefined ? "" : ` \`${diagnostic.observed_value}\``}`;
    const samples = diagnostic.sample_model_ids?.map((id) => `\`${id}\``).join(", ");
    return [
      "Contract",
      `\`${source.source_id}\``,
      `\`${evidence.disposition}\` · \`${diagnostic.kind}\` · \`${diagnostic.path}\` · ${diagnostic.affected_items}/${evidence.observed_items} · expected ${diagnostic.expected ?? "reviewed shape"} · observed ${observed}${samples === undefined ? "" : ` · ${samples}`} · \`${diagnostic.fingerprint}\``,
    ];
  });
  const omitted = evidence.diagnostic_count - evidence.diagnostics.length;
  if (omitted > 0)
    rows.push([
      "Contract",
      `\`${source.source_id}\``,
      `\`${evidence.disposition}\` · +${omitted} diagnostics omitted`,
    ]);
  return rows;
}

function pricingExtractionRows(source: SourceAttempt): ProviderDetailRow[] {
  const pricing = source.pricing_extraction;
  if (pricing === undefined) return [];
  const counts = [
    `${pricing.model_records} models`,
    pricing.numeric_models === 0 ? undefined : `${pricing.numeric_models} numeric`,
    pricing.raw_models === 0 ? undefined : `${pricing.raw_models} raw`,
    pricing.free_models === 0 ? undefined : `${pricing.free_models} free`,
    pricing.custom_quote_models === 0 ? undefined : `${pricing.custom_quote_models} quote`,
    pricing.not_published_models === 0 ? undefined : `${pricing.not_published_models} unpublished`,
    pricing.not_applicable_models === 0 ? undefined : `${pricing.not_applicable_models} N/A`,
    pricing.unknown_models === 0 ? undefined : `?${pricing.unknown_models}`,
    pricing.normalized_facts === 0 && pricing.raw_facts === 0
      ? undefined
      : `facts ${pricing.normalized_facts}/${pricing.raw_facts}`,
  ].filter((value): value is string => value !== undefined);
  return [["Extract", `\`${source.source_id}\``, counts.join(" · ")]];
}

function pricingReconciliationRows(source: SourceAttempt): ProviderDetailRow[] {
  const evidence = source.pricing_reconciliation;
  if (evidence === undefined) return [];
  const counts = evidence.disposition_counts;
  const summary = [
    `\`${evidence.basis}\``,
    `${evidence.observed_items} items`,
    counts.normalized === 0 ? undefined : `${counts.normalized} normalized`,
    counts.raw === 0 ? undefined : `${counts.raw} raw`,
    counts.explicit_non_numeric === 0 ? undefined : `${counts.explicit_non_numeric} non-numeric`,
    counts.excluded === 0 ? undefined : `${counts.excluded} excluded`,
    evidence.diagnostic_count === 0 ? undefined : `?${evidence.diagnostic_count}`,
  ].filter((value): value is string => value !== undefined);
  const rows: ProviderDetailRow[] = [
    ["Reconcile", `\`${source.source_id}\``, summary.join(" · ")],
    ...evidence.diagnostics.map(
      ({ disposition, reason_code }): ProviderDetailRow => [
        "Finding",
        `\`${source.source_id}\``,
        `\`${disposition}\` · \`${reason_code}\``,
      ],
    ),
  ];
  const omitted = evidence.diagnostic_count - evidence.diagnostics.length;
  if (omitted > 0) rows.push(["Finding", `\`${source.source_id}\``, `+${omitted} omitted`]);
  return rows;
}

function pricingFindingNotes(source: SourceAttempt): string[] {
  const diagnostics =
    source.pricing_reconciliation?.diagnostics.filter(
      (diagnostic): diagnostic is typeof diagnostic & { sample: string } =>
        diagnostic.sample !== undefined,
    ) ?? [];
  if (diagnostics.length === 0) return [];
  return [
    "<details>",
    `<summary>Pricing finding samples — ${inlineCode(source.source_id)} (${diagnostics.length})</summary>`,
    "",
    ...diagnostics.map(
      ({ disposition, reason_code, sample }) =>
        `- ${inlineCode(disposition)} · ${inlineCode(reason_code)} · ${inlineCode(sample)}`,
    ),
    "",
    "</details>",
  ];
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
      sources.added > 0 ||
      sources.removed > 0 ||
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
    "| Provider | Publication | Models | Model Δ | Source Δ | Pricing Δ | Coverage | Duration | Signals |",
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
          `+${models.added} / −${models.removed} / ~${models.changed}`,
          `+${sources.added} / −${sources.removed} / ~${sources.changed}`,
          table(pricing.outcome),
          coverage === undefined
            ? "—"
            : `${coverage.offer_models + coverage.not_applicable_models}/${coverage.current_models} · ?${coverage.unknown_models}`,
          durations.has(provider_id)
            ? `${((durations.get(provider_id) ?? 0) / 1000).toFixed(1)}s`
            : "—",
          table(signals.join(", ") || "—"),
        ].join(" | ")} |`,
    ),
    ...legend,
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
    const detailRows: ProviderDetailRow[] = [];
    const detailNotes: string[] = [];
    const pricingCoverage = provider.pricing_coverage;
    if (pricingCoverage !== undefined && pricingCoverage.unknown_models > 0) {
      const omitted = pricingCoverage.unknown_model_refs_omitted;
      const examples = pricingCoverage.unknown_model_refs
        .map((modelRef) => `\`${modelRef}\``)
        .join(", ");
      detailRows.push([
        "Coverage",
        "—",
        `${pricingCoverage.offer_models + pricingCoverage.not_applicable_models}/${pricingCoverage.current_models} resolved · ?${pricingCoverage.unknown_models}`,
      ]);
      if (examples.length > 0 || omitted > 0)
        detailNotes.push(
          "<details>",
          `<summary>Unknown pricing examples (${pricingCoverage.unknown_models}/${pricingCoverage.current_models})</summary>`,
          "",
          `${examples}${omitted === 0 ? "" : `${examples.length === 0 ? "" : " "}(+${omitted} more)`}`,
          "",
          "</details>",
        );
    }
    for (const source of pricingSources) detailRows.push(...pricingExtractionRows(source));
    for (const source of pricingSources) {
      detailRows.push(...pricingReconciliationRows(source));
      detailNotes.push(...pricingFindingNotes(source));
    }
    if (provider.models.added > 0 && provider.models.added_model_refs.length === 0)
      detailRows.push(["Model +", "—", `${provider.models.added} · identities unavailable`]);
    if (provider.models.removed > 0 && provider.models.removed_model_refs.length === 0)
      detailRows.push(["Model −", "—", `${provider.models.removed} · identities unavailable`]);
    if (provider.models.changed > 0 && provider.models.changed_models.length === 0)
      detailRows.push(["Model ~", "—", `${provider.models.changed} · details unavailable`]);
    for (const source of failedSources)
      detailRows.push([
        "Source",
        `\`${source.source_id}\``,
        sourceAttemptValue(source, report.generated_at),
      ]);
    for (const source of findingSources) detailRows.push(...contractFindingRows(source));
    if (provider.attempt?.validation_issue !== undefined)
      detailRows.push(["Validation", "—", `\`${provider.attempt.validation_issue.code}\``]);
    if (provider.attempt?.failure !== undefined)
      detailRows.push(["Failure", "—", `\`${provider.attempt.failure.code}\``]);
    if (provider.attempt?.pricing?.outcome === "failed")
      detailRows.push(["Pricing", "—", `\`${provider.attempt.pricing.failure_code ?? "failed"}\``]);

    const modelTable = modelChangeTable(provider);
    const detailTable = providerDetailTable(detailRows);
    lines.push("", `### ${provider.provider_id}`, "", ...modelTable);
    if (modelTable.length > 0 && detailTable.length > 0) lines.push("");
    lines.push(...detailTable);
    if (detailTable.length > 0 && detailNotes.length > 0) lines.push("");
    lines.push(...detailNotes);
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
