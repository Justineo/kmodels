import { z } from "zod";

const diffSchema = z.object({
  current: z.number().int().nonnegative(),
  added: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  changed: z.number().int().nonnegative(),
  added_model_refs: z.array(z.string()).default([]),
  removed_model_refs: z.array(z.string()).default([]),
  changed_models: z
    .array(z.object({ model_ref: z.string(), fields: z.array(z.string()) }))
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

function refs(label: string, values: string[]): string[] {
  if (values.length === 0) return [];
  const shown = values.slice(0, 20).map((value) => `\`${value}\``);
  const remainder = values.length - shown.length;
  return [`- ${label}: ${shown.join(", ")}${remainder === 0 ? "" : ` (+${remainder} more)`}`];
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
    "| Provider | Publication | Models | Sources | Pricing | Duration | Signals |",
    "| --- | --- | ---: | ---: | --- | ---: | --- |",
    ...providers.map(
      ({ provider_id, publication: state, models, sources, pricing, signals }) =>
        `| ${[
          table(provider_id),
          state,
          `${models.current} (+${models.added} / −${models.removed} / ~${models.changed})`,
          `${sources.changed} changed`,
          table(pricing.outcome),
          durations.has(provider_id)
            ? `${((durations.get(provider_id) ?? 0) / 1000).toFixed(1)}s`
            : "—",
          table(signals.join(", ") || "—"),
        ].join(" | ")} |`,
    ),
  ];

  for (const provider of providers) {
    const failedSources =
      provider.attempt?.sources.filter(({ outcome: sourceOutcome }) =>
        ["fetch_failed", "parse_failed", "skipped_not_configured"].includes(sourceOutcome),
      ) ?? [];
    if (
      provider.models.added === 0 &&
      provider.models.removed === 0 &&
      provider.models.changed === 0 &&
      failedSources.length === 0 &&
      provider.attempt?.validation_issue === undefined &&
      provider.attempt?.pricing?.outcome !== "failed"
    )
      continue;
    lines.push("", `### ${provider.provider_id}`, "");
    lines.push(...refs("Added", provider.models.added_model_refs));
    lines.push(...refs("Removed", provider.models.removed_model_refs));
    lines.push(
      ...refs(
        "Changed",
        provider.models.changed_models.map(
          ({ model_ref, fields }) => `${model_ref} (${fields.join(", ")})`,
        ),
      ),
    );
    if (provider.models.added > 0 && provider.models.added_model_refs.length === 0)
      lines.push(`- Added: ${provider.models.added} models`);
    if (provider.models.removed > 0 && provider.models.removed_model_refs.length === 0)
      lines.push(`- Removed: ${provider.models.removed} models`);
    if (provider.models.changed > 0 && provider.models.changed_models.length === 0)
      lines.push(`- Changed: ${provider.models.changed} models`);
    if (failedSources.length > 0)
      lines.push(
        `- Source attempts: ${failedSources.map(({ source_id, outcome: sourceOutcome }) => `\`${source_id}\` ${sourceOutcome}`).join(", ")}`,
      );
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
        signals.map((signal) => `${provider_id}: ${signal}`),
      ),
      ...providers.flatMap(({ provider_id, attempt }) =>
        attempt?.pricing?.outcome === "failed"
          ? [`${provider_id}: pricing attempt ${attempt.pricing.failure_code ?? "failed"}`]
          : [],
      ),
    ],
  };
}
