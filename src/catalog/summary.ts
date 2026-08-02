import { isDeepStrictEqual } from "node:util";
import { canonicalJsonHash } from "./canonical-json.ts";
import { compareUtf8 } from "./canonical-value.ts";
import { commercialPricingProjection } from "./pricing-commercial.ts";
import { providerPartition } from "./pricing-transition.ts";
import type { PricingCatalog } from "./pricing-schema.ts";
import type { SourceContractEvidence } from "./source-contract.ts";
import type { Catalog, ProviderModel, SourceRecord } from "./schema.ts";
import type { ProviderValidationIssue } from "./validation.ts";

const semanticModelFields = [
  "id_kind",
  "name",
  "description",
  "aliases",
  "tasks",
  "task_evidence",
  "delivery_modes",
  "delivery_mode_evidence",
  "raw_type",
  "service_families",
  "api_endpoints",
  "routes",
  "modalities",
  "capabilities",
  "limits",
  "release_date",
  "updated_date",
  "deprecated_at",
  "retired_at",
  "status",
  "release_stage",
  "replacement_model_ids",
  "availability",
  "scope",
  "account_availability",
  "source_refs",
] as const satisfies readonly (keyof ProviderModel)[];

type SemanticModelField = (typeof semanticModelFields)[number];

interface ModelChangeSummary {
  model_ref: string;
  fields: SemanticModelField[];
  previous_status?: ProviderModel["status"];
  status?: ProviderModel["status"];
  previous_tasks?: ProviderModel["tasks"];
  tasks?: ProviderModel["tasks"];
}

interface ModelDiffSummary {
  previous: number;
  current: number;
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
  changed_fields: Partial<Record<SemanticModelField, number>>;
  added_model_refs: string[];
  removed_model_refs: string[];
  changed_models: ModelChangeSummary[];
}

interface SourceChangeSummary {
  source_id: string;
  content_changed: boolean;
  extractor_changed: boolean;
  field_paths_changed: boolean;
}

interface SourceDiffSummary {
  previous: number;
  current: number;
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
  added_source_ids: string[];
  removed_source_ids: string[];
  changed_sources: SourceChangeSummary[];
}

type SourceRefreshOutcome =
  | "changed"
  | "unchanged"
  | "fetch_failed"
  | "parse_failed"
  | "skipped_not_configured";

export interface SourceRefreshAttempt {
  source_id: string;
  outcome: SourceRefreshOutcome;
  parsed_models?: number;
  content_changed?: boolean;
  extractor_changed?: boolean;
  message?: string;
  consecutive_failures?: number;
  last_success_at?: string;
  contract_finding?: SourceContractEvidence;
}

export interface ProviderRefreshAttempt {
  provider_id: string;
  outcome: "accepted" | "rejected" | "not_configured";
  sources: SourceRefreshAttempt[];
  candidate_models?: ProviderModel[];
  validation_issue?: ProviderValidationIssue;
  failure?: { code: string; message: string };
  pricing?: { outcome: "accepted" | "failed" | "not_observed"; failure_code?: string };
}

interface ProviderAttemptSummary {
  outcome: ProviderRefreshAttempt["outcome"];
  sources: SourceRefreshAttempt[];
  models?: ModelDiffSummary;
  validation_issue?: ProviderValidationIssue;
  failure?: ProviderRefreshAttempt["failure"];
  pricing?: ProviderRefreshAttempt["pricing"];
}

type ProviderRefreshSignal =
  | "drift_guard_triggered"
  | "breaking_contract_mismatch"
  | "unreviewed_extension"
  | "coverage_regression"
  | "possible_structural_change"
  | "persistent_source_failure";

interface ProviderRefreshSummary {
  provider_id: string;
  status: "fresh" | "stale" | "unavailable" | "not_configured" | "removed";
  publication: "accepted" | "retained" | "withheld" | "not_configured" | "removed";
  models: ModelDiffSummary;
  sources: SourceDiffSummary;
  pricing: PricingDiffSummary;
  warning_codes: Record<string, number>;
  signals: ProviderRefreshSignal[];
  attempt?: ProviderAttemptSummary;
}

interface PricingDiffSummary {
  outcome: "none" | "added" | "removed" | "commercial" | "provenance_only" | "unchanged";
  previous_commercial_hash?: string;
  commercial_hash?: string;
}

interface PricingComparison {
  data: PricingCatalog;
  owner: (modelRef: string) => string;
  commercialHashes: ReadonlyMap<string, string>;
}

export interface RefreshSummary {
  schema_version: 2;
  generated_at: string;
  previous_catalog_version?: string;
  catalog_version: string;
  outcome: "changed" | "evidence_only" | "unchanged";
  publication: "complete" | "partial";
  totals: {
    providers: number;
    accepted: number;
    retained: number;
    withheld: number;
    models: number;
    added_models: number;
    removed_models: number;
    changed_models: number;
    added_sources: number;
    removed_sources: number;
    changed_sources: number;
  };
  providers: ProviderRefreshSummary[];
}

function sourceKey(source: SourceRecord): string {
  return `${source.provider_id}\0${source.id}`;
}

function sourceChanges(previous: SourceRecord, current: SourceRecord): SourceChangeSummary {
  return {
    source_id: current.id,
    content_changed: previous.content_hash !== current.content_hash,
    extractor_changed: previous.extractor_version !== current.extractor_version,
    field_paths_changed: !isDeepStrictEqual(previous.field_paths, current.field_paths),
  };
}

function modelDiff(previous: ProviderModel[], current: ProviderModel[]): ModelDiffSummary {
  const previousByUid = new Map(previous.map((model) => [model.uid, model]));
  const currentByUid = new Map(current.map((model) => [model.uid, model]));
  let unchanged = 0;
  const changedFields: Partial<Record<SemanticModelField, number>> = {};
  const changedModels: ModelChangeSummary[] = [];
  for (const [uid, model] of currentByUid) {
    const old = previousByUid.get(uid);
    if (old === undefined) continue;
    const fields = semanticModelFields.filter(
      (field) => !isDeepStrictEqual(old[field], model[field]),
    );
    if (fields.length === 0) {
      unchanged += 1;
      continue;
    }
    for (const field of fields) changedFields[field] = (changedFields[field] ?? 0) + 1;
    changedModels.push({
      model_ref: uid,
      fields,
      ...(fields.includes("status") ? { previous_status: old.status, status: model.status } : {}),
      ...(fields.includes("tasks") ? { previous_tasks: old.tasks, tasks: model.tasks } : {}),
    });
  }
  const addedModelRefs = [...currentByUid.keys()]
    .filter((uid) => !previousByUid.has(uid))
    .sort(compareUtf8);
  const removedModelRefs = [...previousByUid.keys()]
    .filter((uid) => !currentByUid.has(uid))
    .sort(compareUtf8);
  return {
    previous: previous.length,
    current: current.length,
    added: addedModelRefs.length,
    removed: removedModelRefs.length,
    changed: changedModels.length,
    unchanged,
    changed_fields: changedFields,
    added_model_refs: addedModelRefs,
    removed_model_refs: removedModelRefs,
    changed_models: changedModels.sort((left, right) =>
      compareUtf8(left.model_ref, right.model_ref),
    ),
  };
}

function sourceDiff(previous: SourceRecord[], current: SourceRecord[]): SourceDiffSummary {
  const previousByKey = new Map(previous.map((source) => [sourceKey(source), source]));
  const currentByKey = new Map(current.map((source) => [sourceKey(source), source]));
  let unchanged = 0;
  const changedSources: SourceChangeSummary[] = [];
  for (const [key, source] of currentByKey) {
    const old = previousByKey.get(key);
    if (old === undefined) continue;
    const changes = sourceChanges(old, source);
    if (changes.content_changed || changes.extractor_changed || changes.field_paths_changed)
      changedSources.push(changes);
    else unchanged += 1;
  }
  const addedSourceIds = current
    .filter((source) => !previousByKey.has(sourceKey(source)))
    .map(({ id }) => id)
    .sort(compareUtf8);
  const removedSourceIds = previous
    .filter((source) => !currentByKey.has(sourceKey(source)))
    .map(({ id }) => id)
    .sort(compareUtf8);
  return {
    previous: previous.length,
    current: current.length,
    added: addedSourceIds.length,
    removed: removedSourceIds.length,
    changed: changedSources.length,
    unchanged,
    added_source_ids: addedSourceIds,
    removed_source_ids: removedSourceIds,
    changed_sources: changedSources.sort((left, right) =>
      compareUtf8(left.source_id, right.source_id),
    ),
  };
}

export function summarizeRefresh(
  previous: Catalog | undefined,
  current: Catalog,
  previousPricing: PricingCatalog,
  currentPricing: PricingCatalog,
  attempts: readonly ProviderRefreshAttempt[] = [],
): RefreshSummary {
  const providerIds = [
    ...new Set([
      ...(previous?.providers.map(({ id }) => id) ?? []),
      ...current.providers.map(({ id }) => id),
    ]),
  ].sort(compareUtf8);
  const pricing = {
    previous: pricingComparison(previousPricing, previous),
    current: pricingComparison(currentPricing, current),
  };
  const attemptByProvider = new Map(attempts.map((attempt) => [attempt.provider_id, attempt]));
  const providers = providerIds.map((providerId): ProviderRefreshSummary => {
    const warnings = current.warnings.filter(
      (warning) => "provider_id" in warning && warning.provider_id === providerId,
    );
    const warningCodes: Record<string, number> = {};
    for (const warning of warnings)
      warningCodes[warning.code] = (warningCodes[warning.code] ?? 0) + 1;
    const status =
      current.coverage.find((coverage) => coverage.provider_id === providerId)?.status ??
      (current.providers.some(({ id }) => id === providerId) ? "unavailable" : "removed");
    const attempt = attemptByProvider.get(providerId);
    const oldModels = previous?.models.filter((model) => model.provider_id === providerId) ?? [];
    const validationIssue = attempt?.validation_issue;
    const sourceAttempts = attempt?.sources ?? [];
    const countDropped = validationIssue?.code.endsWith("_count_drop") === true;
    const contractFindings = sourceAttempts.flatMap(({ contract_finding: finding }) =>
      finding === undefined ? [] : [finding],
    );
    const rejectedFindings = contractFindings.filter(({ disposition }) => disposition === "reject");
    const acceptedFindings = contractFindings.filter(
      ({ disposition }) => disposition === "accept_with_signal",
    );
    const coverageFinding = rejectedFindings.some(({ diagnostics }) =>
      diagnostics.some(({ kind }) =>
        ["count_outside_bounds", "coverage_below_threshold"].includes(kind),
      ),
    );
    const breakingFinding = rejectedFindings.some(({ diagnostics }) =>
      diagnostics.some(
        ({ kind }) => !["count_outside_bounds", "coverage_below_threshold"].includes(kind),
      ),
    );
    const signals: ProviderRefreshSignal[] = [];
    if (countDropped) signals.push("drift_guard_triggered");
    if (breakingFinding) signals.push("breaking_contract_mismatch");
    if (acceptedFindings.length > 0) signals.push("unreviewed_extension");
    if (countDropped || coverageFinding) signals.push("coverage_regression");
    if (
      sourceAttempts.some(
        ({ outcome, contract_finding: finding }) =>
          outcome === "parse_failed" && finding === undefined,
      )
    )
      signals.push("possible_structural_change");
    if (sourceAttempts.some(({ consecutive_failures: failures }) => (failures ?? 0) >= 2))
      signals.push("persistent_source_failure");
    return {
      provider_id: providerId,
      status,
      publication:
        status === "fresh"
          ? "accepted"
          : status === "stale"
            ? "retained"
            : status === "unavailable"
              ? "withheld"
              : status,
      models: modelDiff(
        oldModels,
        current.models.filter((model) => model.provider_id === providerId),
      ),
      sources: sourceDiff(
        previous?.sources.filter((source) => source.provider_id === providerId) ?? [],
        current.sources.filter((source) => source.provider_id === providerId),
      ),
      pricing: pricingDiff(pricing.previous, pricing.current, providerId),
      warning_codes: warningCodes,
      signals,
      ...(attempt === undefined
        ? {}
        : {
            attempt: {
              outcome: attempt.outcome,
              sources: attempt.sources,
              ...(attempt.candidate_models === undefined
                ? {}
                : { models: modelDiff(oldModels, attempt.candidate_models) }),
              ...(validationIssue === undefined ? {} : { validation_issue: validationIssue }),
              ...(attempt.failure === undefined ? {} : { failure: attempt.failure }),
              ...(attempt.pricing === undefined ? {} : { pricing: attempt.pricing }),
            },
          }),
    };
  });
  const totals = {
    providers: providers.length,
    accepted: providers.filter(({ publication }) => publication === "accepted").length,
    retained: providers.filter(({ publication }) => publication === "retained").length,
    withheld: providers.filter(({ publication }) => publication === "withheld").length,
    models: current.models.length,
    added_models: providers.reduce((total, provider) => total + provider.models.added, 0),
    removed_models: providers.reduce((total, provider) => total + provider.models.removed, 0),
    changed_models: providers.reduce((total, provider) => total + provider.models.changed, 0),
    added_sources: providers.reduce((total, provider) => total + provider.sources.added, 0),
    removed_sources: providers.reduce((total, provider) => total + provider.sources.removed, 0),
    changed_sources: providers.reduce((total, provider) => total + provider.sources.changed, 0),
  };
  const changed =
    totals.added_models > 0 ||
    totals.removed_models > 0 ||
    totals.changed_models > 0 ||
    providers.some(({ pricing: { outcome } }) =>
      ["added", "removed", "commercial"].includes(outcome),
    );
  const evidenceChanged =
    totals.added_sources > 0 ||
    totals.removed_sources > 0 ||
    totals.changed_sources > 0 ||
    providers.some(({ pricing: { outcome } }) => outcome === "provenance_only");
  return {
    schema_version: 2,
    generated_at: current.generated_at,
    ...(previous === undefined ? {} : { previous_catalog_version: previous.catalog_version }),
    catalog_version: current.catalog_version,
    outcome: changed ? "changed" : evidenceChanged ? "evidence_only" : "unchanged",
    publication: totals.retained > 0 || totals.withheld > 0 ? "partial" : "complete",
    totals,
    providers,
  };
}

function pricingDiff(
  previous: PricingComparison,
  current: PricingComparison,
  providerId: string,
): PricingDiffSummary {
  const previousPartition = providerPartition(previous.data, providerId, previous.owner);
  const currentPartition = providerPartition(current.data, providerId, current.owner);
  if (previousPartition === undefined && currentPartition === undefined) return { outcome: "none" };

  const previousCommercial = previous.commercialHashes.get(providerId);
  const currentCommercial = current.commercialHashes.get(providerId);
  if (previousCommercial === undefined) {
    if (currentCommercial === undefined) throw new Error("Pricing diff has no provider data");
    return { outcome: "added", commercial_hash: currentCommercial };
  }
  if (currentCommercial === undefined)
    return { outcome: "removed", previous_commercial_hash: previousCommercial };
  const hashes = {
    previous_commercial_hash: previousCommercial,
    commercial_hash: currentCommercial,
  };
  if (previousCommercial !== currentCommercial) return { outcome: "commercial", ...hashes };
  return {
    outcome: isDeepStrictEqual(previousPartition, currentPartition)
      ? "unchanged"
      : "provenance_only",
    ...hashes,
  };
}

function pricingComparison(
  pricing: PricingCatalog,
  catalog: Catalog | undefined,
): PricingComparison {
  const projection = commercialPricingProjection(pricing);
  const owner = modelOwner(catalog);
  return {
    data: pricing,
    owner,
    commercialHashes: new Map(
      pricing.provider_snapshots.map(({ provider_id }) => [
        provider_id,
        canonicalJsonHash({
          provider_atoms: projection.provider_atoms.filter(
            ({ provider_id: ownerId }) => ownerId === provider_id,
          ),
          model_dispositions: projection.model_dispositions.filter(
            ({ model_ref }) => owner(model_ref) === provider_id,
          ),
          books: projection.books.filter(({ provider_id: ownerId }) => ownerId === provider_id),
        }),
      ]),
    ),
  };
}

function modelOwner(catalog: Catalog | undefined): (modelRef: string) => string {
  const owners = new Map(catalog?.models.map(({ uid, provider_id }) => [uid, provider_id]) ?? []);
  return (modelRef) => owners.get(modelRef) ?? "";
}
