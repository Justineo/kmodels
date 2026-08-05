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
      message: z.string().optional(),
      consecutive_failures: z.number().int().positive().optional(),
      last_success_at: z.iso.datetime({ offset: true }).optional(),
      contract_finding: sourceContractEvidenceSchema.optional(),
      pricing_extraction: sourcePricingExtractionSchema.optional(),
      pricing_reconciliation: sourcePricingReconciliationSchema.optional(),
    }),
  ),
  validation_issue: z.object({ code: z.string(), message: z.string().optional() }).optional(),
  failure: z.object({ code: z.string(), message: z.string().optional() }).optional(),
  pricing: z
    .object({
      outcome: z.enum(["accepted", "failed", "not_observed"]),
      failure_code: z.string().optional(),
      message: z.string().optional(),
    })
    .optional(),
});

const providerSchema = z.object({
  provider_id: z.string(),
  status: z.enum(["fresh", "stale", "unavailable", "not_configured", "removed"]),
  publication: z.enum(["accepted", "retained", "withheld", "not_configured", "removed"]).optional(),
  pricing_publication: z
    .enum(["accepted", "retained", "withheld", "not_observed", "removed"])
    .optional(),
  models: diffSchema,
  sources: z.object({
    current: z.number().int().nonnegative().optional(),
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
      delta: z
        .object({
          resolved_models: z.number().int(),
          unknown_models: z.number().int(),
        })
        .optional(),
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
const publicationDisplay: Record<NonNullable<Provider["publication"]>, string> = {
  accepted: "✅",
  retained: "⚠️",
  withheld: "⛔",
  not_configured: "⏭️",
  removed: "➖",
};
type PricingPublication = NonNullable<Provider["pricing_publication"]>;
const pricingPublicationDisplay: Record<PricingPublication, string> = {
  accepted: "✅",
  retained: "⚠️",
  withheld: "⛔",
  not_observed: "⏭️",
  removed: "➖",
};
const pricingDisplay: Record<string, string> = {
  none: "⭕",
  added: "➕",
  removed: "➖",
  commercial: "💰",
  provenance_only: "🧾",
  unchanged: "🟰",
};
const signalDisplay: Record<string, string> = {
  drift_guard_triggered: "🛡️",
  breaking_contract_mismatch: "⚠️",
  unreviewed_extension: "🧩",
  coverage_regression: "📉",
  possible_structural_change: "🧱",
  persistent_source_failure: "🔁",
};
const outcomeDisplay = {
  changed: "🔄",
  evidence_only: "🧾",
  unchanged: "🟰",
} as const;
const runPublicationDisplay = { complete: "✅", partial: "⚠️" } as const;

function inferredPricingPublication(provider: Provider): PricingPublication {
  if (provider.pricing_publication !== undefined) return provider.pricing_publication;
  if (provider.pricing.outcome === "removed") return "removed";
  if (provider.attempt?.pricing?.outcome === "accepted") return "accepted";
  if (provider.attempt?.pricing?.outcome === "failed")
    return provider.pricing.outcome === "none" ? "withheld" : "retained";
  if (provider.attempt?.pricing?.outcome === "not_observed") return "not_observed";
  return provider.pricing.outcome === "none" ? "not_observed" : "accepted";
}

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

function signedDelta(value: number): string {
  return value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : "0";
}

function diffValue(added: number, removed: number, changed: number): string {
  const parts = [
    added === 0 ? undefined : `+${added}`,
    removed === 0 ? undefined : `−${removed}`,
    changed === 0 ? undefined : `~${changed}`,
  ].filter((value): value is string => value !== undefined);
  return parts.join(" · ") || "—";
}

function coverageValue(coverage: NonNullable<Provider["pricing_coverage"]>): string {
  const resolved = coverage.offer_models + coverage.not_applicable_models;
  return `✅ ${resolved}/${coverage.current_models} · ❓ ${coverage.unknown_models}`;
}

function coverageDeltaValue(coverage: NonNullable<Provider["pricing_coverage"]>): string {
  const delta = coverage.delta;
  if (delta === undefined) return "—";
  if (delta.resolved_models === 0 && delta.unknown_models === 0) return "0";
  const parts = [
    delta.resolved_models === 0 ? undefined : `✅ ${signedDelta(delta.resolved_models)}`,
    delta.unknown_models === 0 ? undefined : `❓ ${signedDelta(delta.unknown_models)}`,
  ].filter((value): value is string => value !== undefined);
  return parts.join(" · ");
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

type RenderedProvider = Provider & {
  publication: NonNullable<Provider["publication"]>;
  pricing_publication: PricingPublication;
};
type UnacceptedCandidateRow = readonly [
  boundary: string,
  decision: string,
  failedAt: string,
  reason: string,
  published: string,
];

function reasonValue(code: string | undefined, message: string | undefined): string {
  const parts = [
    code === undefined ? undefined : inlineCode(code),
    message === undefined ? undefined : inlineCode(message),
  ].filter((value): value is string => value !== undefined);
  return parts.join("<br>") || "<em>No detailed reason recorded</em>";
}

function failedSourceValue(provider: RenderedProvider): string | undefined {
  const sources =
    provider.attempt?.sources.filter(({ outcome }) =>
      ["fetch_failed", "parse_failed"].includes(outcome),
    ) ?? [];
  if (sources.length === 0) return undefined;
  return sources
    .map(({ source_id, outcome }) => `${inlineCode(source_id)} · ${inlineCode(outcome)}`)
    .join("<br>");
}

function unacceptedCandidateTable(provider: RenderedProvider): string[] {
  const rows: UnacceptedCandidateRow[] = [];
  const failedSources =
    provider.attempt?.sources.filter(({ outcome }) =>
      ["fetch_failed", "parse_failed"].includes(outcome),
    ) ?? [];
  const catalogPublished =
    provider.publication === "retained" ? "Previous accepted catalog slice" : "No catalog slice";

  if (provider.publication === "retained" || provider.publication === "withheld") {
    if (failedSources.length > 0) {
      for (const source of failedSources)
        rows.push([
          "Catalog",
          publicationDisplay[provider.publication],
          `${inlineCode(source.source_id)} · ${inlineCode(source.outcome)}`,
          reasonValue(
            provider.attempt?.failure?.code,
            source.message ?? provider.attempt?.failure?.message,
          ),
          catalogPublished,
        ]);
    } else if (provider.attempt?.validation_issue !== undefined) {
      rows.push([
        "Catalog",
        publicationDisplay[provider.publication],
        "Provider validation",
        reasonValue(
          provider.attempt.validation_issue.code,
          provider.attempt.validation_issue.message ?? provider.attempt.failure?.message,
        ),
        catalogPublished,
      ]);
    } else {
      rows.push([
        "Catalog",
        publicationDisplay[provider.publication],
        "Provider refresh",
        reasonValue(provider.attempt?.failure?.code, provider.attempt?.failure?.message),
        catalogPublished,
      ]);
    }
  }

  if (provider.pricing_publication === "retained" || provider.pricing_publication === "withheld") {
    const pricing = provider.attempt?.pricing;
    const failedAt =
      pricing?.failure_code === "pricing_validation_failed"
        ? "Pricing validation"
        : (failedSourceValue(provider) ??
          (provider.attempt?.validation_issue === undefined
            ? "Provider refresh"
            : "Provider validation"));
    rows.push([
      "Pricing",
      pricingPublicationDisplay[provider.pricing_publication],
      failedAt,
      reasonValue(pricing?.failure_code, pricing?.message ?? provider.attempt?.failure?.message),
      provider.pricing_publication === "retained"
        ? "Previous accepted pricing partition"
        : "No pricing partition",
    ]);
  }

  if (rows.length === 0) return [];
  return [
    "#### Unaccepted candidates",
    "",
    "| Boundary | Decision | Failed at | Reason | Published |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map(
      ([boundary, decision, failedAt, reason, published]) =>
        `| ${table(boundary)} | ${decision} | ${table(failedAt)} | ${table(reason)} | ${table(published)} |`,
    ),
  ];
}

const legend = [
  "",
  "<details>",
  "<summary>Legend</summary>",
  "",
  "#### Run",
  "",
  "| Position | Icon | Meaning |",
  "| --- | --- | --- |",
  "| Outcome | 🔄 | Published model or commercial-pricing data changed |",
  "| Outcome | 🧾 | Only source, provenance, freshness, publication, or other evidence changed |",
  "| Outcome | 🟰 | No accepted data or evidence changed |",
  "| Completeness | ✅ | Every candidate advanced or had no observation |",
  "| Completeness | ⚠️ | At least one catalog or pricing candidate was retained or withheld |",
  "",
  "#### Counts and deltas",
  "",
  "| Token | Models | Sources |",
  "| --- | --- | --- |",
  "| count | Current published models | Current accepted source records |",
  "| `+` | Added identity | Added source |",
  "| `−` | Removed identity | Removed source |",
  "| `~` | Same identity; semantic field changed | Same source; content, extractor, or field paths changed |",
  "| `—` | No change | No change |",
  "",
  "#### Publication",
  "",
  "| Icon | Catalog | Pricing |",
  "| --- | --- | --- |",
  "| ✅ | Fresh validated slice published | Fresh validated partition published |",
  "| ⚠️ | Previous accepted slice retained after candidate failure | Previous accepted partition retained after attempt failure |",
  "| ⛔ | Candidate failed; no previous slice to publish | Attempt failed; no previous partition to publish |",
  "| ⏭️ | Collection not configured | No partition observed or configured |",
  "| ➖ | Provider intentionally removed | Partition removed by validated transition |",
  "",
  "| Boundary | Atomic unit | Failure behavior |",
  "| --- | --- | --- |",
  "| Catalog | Required provider catalog inputs | Retain together; avoids false removals, identities, and provenance |",
  "| Pricing | Provider pricing partition | Retain independently; Catalog ✅ can coexist with Pricing ⚠️ |",
  "| Optional/scoped source | One optional inventory | May skip without retaining the catalog |",
  "",
  "#### Pricing Δ",
  "",
  "| Icon | Meaning |",
  "| --- | --- |",
  "| ⭕ | No partition in either accepted pair |",
  "| ➕ | Partition added |",
  "| ➖ | Partition removed |",
  "| 💰 | Canonical commercial terms changed |",
  "| 🧾 | Commercial terms unchanged; provenance, freshness, publication, or attempt evidence changed |",
  "| 🟰 | Complete accepted partition unchanged |",
  "",
  "#### Signals",
  "",
  "| Icon | Signal | Meaning |",
  "| --- | --- | --- |",
  "| 🛡️ | Drift guard | Abrupt model-count drop rejected |",
  "| ⚠️ | Contract mismatch | Owned source field or value became uninterpretable |",
  "| 🧩 | Unreviewed extension | Fresh data accepted after unrelated extension was stripped |",
  "| 📉 | Coverage regression | Reviewed item or field coverage fell below threshold |",
  "| 🧱 | Possible structural change | Unclassified parse failure |",
  "| 🔁 | Persistent failure | A source failed at least twice consecutively |",
  "| ❓ | Unknown | Signal is not recognized by this renderer |",
  "",
  "#### Coverage",
  "",
  "| Token | Coverage | Coverage Δ |",
  "| --- | --- | --- |",
  "| ✅ | Resolved/current; public offer or explicit not-applicable | Change in resolved models |",
  "| ❓ | Unresolved models | Change in unresolved models |",
  "| `0` | — | Neither count changed |",
  "| `—` | No coverage data | No comparable baseline |",
  "",
  "#### Provider details",
  "",
  "| Section | Content |",
  "| --- | --- |",
  "| Unaccepted candidates | Boundary, decision, failed stage/source, exact reason, published fallback |",
  "| Model changes | One row per model with leaf-level before/after values |",
  "| Extract | Parsed model states; `facts N/R` = normalized/raw facts |",
  "| Reconcile / Finding | Source-item partition and bounded unresolved diagnostics |",
  "| Contract | Disposition, mismatch, path, counts, shapes, fingerprint |",
  "| Details | Exact machine-readable outcomes and reason codes; zero counters omitted |",
  "| Duration | Provider wall-clock seconds; `—` when not recorded |",
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
    pricing.unknown_models === 0 ? undefined : `❓ ${pricing.unknown_models}`,
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
    evidence.diagnostic_count === 0 ? undefined : `❓ ${evidence.diagnostic_count}`,
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
    pricing_publication: inferredPricingPublication(provider),
  }));
  const catalogRetained = providers.filter(
    ({ publication: state }) => state === "retained" || state === "withheld",
  );
  const pricingRetained = providers.filter(
    ({ pricing_publication: state }) => state === "retained" || state === "withheld",
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
  const publicationState =
    catalogRetained.length > 0 || pricingRetained.length > 0
      ? "partial"
      : (report.publication ?? "complete");
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
    `**${outcomeDisplay[outcome]}** · ${runPublicationDisplay[publicationState]} · ${report.generated_at} · \`${report.catalog_version.slice(0, 12)}\``,
    "",
    "| Provider | Catalog | Models | Model Δ | Sources | Source Δ | Pricing | Pricing Δ | Coverage | Coverage Δ | Duration | Signals |",
    "| --- | --- | ---: | --- | ---: | --- | --- | --- | --- | --- | ---: | --- |",
    ...providers.map(
      ({
        provider_id,
        publication: state,
        pricing_publication: pricingState,
        models,
        sources,
        pricing,
        pricing_coverage: coverage,
        signals,
      }) =>
        `| ${[
          table(provider_id),
          publicationDisplay[state],
          String(models.current),
          diffValue(models.added, models.removed, models.changed),
          sources.current === undefined ? "—" : String(sources.current),
          diffValue(sources.added, sources.removed, sources.changed),
          pricingPublicationDisplay[pricingState],
          pricingDisplay[pricing.outcome] ?? "❓",
          coverage === undefined ? "—" : coverageValue(coverage),
          coverage === undefined ? "—" : coverageDeltaValue(coverage),
          durations.has(provider_id)
            ? `${((durations.get(provider_id) ?? 0) / 1000).toFixed(1)}s`
            : "—",
          table(signals.map((signal) => signalDisplay[signal] ?? "❓").join(" ") || "—"),
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
      detailRows.push(["Pricing coverage", "—", coverageValue(pricingCoverage)]);
      if (examples.length > 0 || omitted > 0)
        detailNotes.push(
          "<details>",
          `<summary>❓ Pricing examples (${pricingCoverage.unknown_models}/${pricingCoverage.current_models})</summary>`,
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

    const unacceptedTable = unacceptedCandidateTable(provider);
    const modelTable = modelChangeTable(provider);
    const detailTable = providerDetailTable(detailRows);
    const sections = [unacceptedTable, modelTable, detailTable].filter(
      (section) => section.length > 0,
    );
    lines.push("", `### ${provider.provider_id}`);
    for (const section of sections) lines.push("", ...section);
    if (detailNotes.length > 0) lines.push("", ...detailNotes);
  }

  return {
    markdown: `${lines.join("\n")}\n`,
    warnings: [
      ...catalogRetained.map(
        ({ provider_id, publication: state }) => `${provider_id} catalog publication was ${state}`,
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
