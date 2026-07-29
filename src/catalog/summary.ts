import { stableJson } from "./io.ts";
import { canonicalJson, canonicalJsonHash } from "./canonical-json.ts";
import { compareUtf8 } from "./canonical-value.ts";
import { commercialPricingProjection } from "./pricing-commercial.ts";
import { providerPartition } from "./pricing-transition.ts";
import type { PricingCatalog } from "./pricing-schema.ts";
import type { Catalog, ProviderModel, SourceRecord } from "./schema.ts";

const semanticModelFields = [
  "id_kind",
  "name",
  "description",
  "aliases",
  "tasks",
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
  status: "fresh" | "stale" | "unavailable" | "not_configured" | "removed";
  models: ModelDiffSummary;
  sources: SourceDiffSummary;
  pricing: PricingDiffSummary;
  warning_codes: Record<string, number>;
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

export function summarizeRefresh(
  previous: Catalog | undefined,
  current: Catalog,
  previousPricing: PricingCatalog,
  currentPricing: PricingCatalog,
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
  return {
    generated_at: current.generated_at,
    ...(previous === undefined ? {} : { previous_catalog_version: previous.catalog_version }),
    catalog_version: current.catalog_version,
    providers: providerIds.map((providerId) => {
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
          (current.providers.some(({ id }) => id === providerId) ? "unavailable" : "removed"),
        models: modelDiff(
          previous?.models.filter((model) => model.provider_id === providerId) ?? [],
          current.models.filter((model) => model.provider_id === providerId),
        ),
        sources: sourceDiff(
          previous?.sources.filter((source) => source.provider_id === providerId) ?? [],
          current.sources.filter((source) => source.provider_id === providerId),
        ),
        pricing: pricingDiff(pricing.previous, pricing.current, providerId),
        warning_codes: warningCodes,
      };
    }),
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
    outcome:
      canonicalJson(previousPartition) === canonicalJson(currentPartition)
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
