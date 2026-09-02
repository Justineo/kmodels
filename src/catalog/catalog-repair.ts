import { z } from "zod";
import { manifests, type SourceManifest } from "./manifests.ts";

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
    | "source_contract_change"
    | "provider_validation"
    | "pricing_validation";
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
      const hasSourceCandidate = [...candidates.values()].some(
        ({ provider_id, scope }) => provider_id === provider.provider_id && scope === "source",
      );
      if (!hasSourceCandidate) {
        const value = providerCandidate(
          provider.provider_id,
          "pricing_validation",
          attempt.pricing.message ??
            `${attempt.pricing.failure_code ?? "pricing_failed"}: pricing publication failed`,
        );
        candidates.set(`${value.provider_id}\0${value.subject_id}`, value);
      }
    }
  }
  return [...candidates.values()].sort((left, right) =>
    `${left.provider_id}\0${left.subject_id}`.localeCompare(
      `${right.provider_id}\0${right.subject_id}`,
    ),
  );
}
