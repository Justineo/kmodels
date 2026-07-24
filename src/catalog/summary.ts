import { stableJson } from "./io.ts";
import type { Catalog, ProviderModel, SourceRecord } from "./schema.ts";

const semanticModelFields = [
  "id_kind",
  "name",
  "description",
  "aliases",
  "operations",
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
  "pricing_status",
  "pricing",
  "availability",
  "scope",
  "account_availability",
  "source_refs",
] as const satisfies readonly (keyof ProviderModel)[];

type SemanticModelField = (typeof semanticModelFields)[number];

interface ModelDiffSummary {
  previous: number;
  current: number;
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
  changed_fields: Partial<Record<SemanticModelField, number>>;
}

interface SourceDiffSummary {
  previous: number;
  current: number;
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
}

interface ProviderRefreshSummary {
  provider_id: string;
  status: "fresh" | "stale" | "unavailable" | "not_configured";
  models: ModelDiffSummary;
  sources: SourceDiffSummary;
  warning_codes: Record<string, number>;
}

export interface RefreshSummary {
  generated_at: string;
  previous_catalog_version?: string;
  catalog_version: string;
  providers: ProviderRefreshSummary[];
}

function sourceKey(source: SourceRecord): string {
  return `${source.provider_id}\0${source.id}`;
}

function sourceChanged(previous: SourceRecord, current: SourceRecord): boolean {
  return (
    previous.content_hash !== current.content_hash ||
    previous.extractor_version !== current.extractor_version ||
    stableJson(previous.field_paths) !== stableJson(current.field_paths)
  );
}

function modelDiff(previous: ProviderModel[], current: ProviderModel[]): ModelDiffSummary {
  const previousByUid = new Map(previous.map((model) => [model.uid, model]));
  const currentByUid = new Map(current.map((model) => [model.uid, model]));
  let changed = 0;
  let unchanged = 0;
  const changedFields: Partial<Record<SemanticModelField, number>> = {};
  for (const [uid, model] of currentByUid) {
    const old = previousByUid.get(uid);
    if (old === undefined) continue;
    const fields = semanticModelFields.filter(
      (field) => stableJson(old[field]) !== stableJson(model[field]),
    );
    if (fields.length === 0) {
      unchanged += 1;
      continue;
    }
    changed += 1;
    for (const field of fields) changedFields[field] = (changedFields[field] ?? 0) + 1;
  }
  return {
    previous: previous.length,
    current: current.length,
    added: [...currentByUid.keys()].filter((uid) => !previousByUid.has(uid)).length,
    removed: [...previousByUid.keys()].filter((uid) => !currentByUid.has(uid)).length,
    changed,
    unchanged,
    changed_fields: changedFields,
  };
}

function sourceDiff(previous: SourceRecord[], current: SourceRecord[]): SourceDiffSummary {
  const previousByKey = new Map(previous.map((source) => [sourceKey(source), source]));
  const currentByKey = new Map(current.map((source) => [sourceKey(source), source]));
  let changed = 0;
  let unchanged = 0;
  for (const [key, source] of currentByKey) {
    const old = previousByKey.get(key);
    if (old === undefined) continue;
    if (sourceChanged(old, source)) changed += 1;
    else unchanged += 1;
  }
  return {
    previous: previous.length,
    current: current.length,
    added: [...currentByKey.keys()].filter((key) => !previousByKey.has(key)).length,
    removed: [...previousByKey.keys()].filter((key) => !currentByKey.has(key)).length,
    changed,
    unchanged,
  };
}

export function summarizeRefresh(previous: Catalog | undefined, current: Catalog): RefreshSummary {
  return {
    generated_at: current.generated_at,
    ...(previous === undefined ? {} : { previous_catalog_version: previous.catalog_version }),
    catalog_version: current.catalog_version,
    providers: current.providers.map((provider) => {
      const providerId = provider.id;
      const warnings = current.warnings.filter(
        (warning) => "provider_id" in warning && warning.provider_id === providerId,
      );
      const warningCodes: Record<string, number> = {};
      for (const warning of warnings)
        warningCodes[warning.code] = (warningCodes[warning.code] ?? 0) + 1;
      return {
        provider_id: providerId,
        status:
          current.coverage.find((coverage) => coverage.provider_id === providerId)?.status ??
          "unavailable",
        models: modelDiff(
          previous?.models.filter((model) => model.provider_id === providerId) ?? [],
          current.models.filter((model) => model.provider_id === providerId),
        ),
        sources: sourceDiff(
          previous?.sources.filter((source) => source.provider_id === providerId) ?? [],
          current.sources.filter((source) => source.provider_id === providerId),
        ),
        warning_codes: warningCodes,
      };
    }),
  };
}
