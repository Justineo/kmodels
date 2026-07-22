import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { normalizeModelTask, parseSource } from "./adapters.ts";
import { fetchSource, fetchStateSchema, type FetchState, type SourceState } from "./fetch.ts";
import {
  manifests,
  type CoverageField,
  type ProviderManifest,
  type SourceManifest,
} from "./manifests.ts";
import { readJson, rootDirectory, sha256, stableJson, writeJson } from "./io.ts";
import {
  catalogSchema,
  type Catalog,
  type CatalogWarning,
  type Coverage,
  type Provider,
  type ProviderModel,
  type SourceRecord,
} from "./schema.ts";
import { preserveMissing, validateProvider } from "./validation.ts";

const availabilityWarning: CatalogWarning = {
  code: "account_availability_unknown",
  message: "Global catalog presence does not imply availability to a specific account.",
};

interface ProviderResult {
  provider: Provider;
  models: ProviderModel[];
  sources: SourceRecord[];
  coverage: Coverage;
  warnings: CatalogWarning[];
  quarantine?: { provider_id: string; checked_at: string; reason: string };
}

interface CollectionOptions {
  now?: Date;
  jitterMs?: number;
  rebuild?: boolean;
}

function message(error: unknown): string {
  return error instanceof Error
    ? error.message.replace(/https?:\/\/\S+/g, "[source]")
    : "Unknown collection failure";
}

function previousModels(catalog: Catalog | undefined, providerId: string): ProviderModel[] {
  return (
    catalog?.models.filter((model) => model.provider_id === providerId).map(normalizeModelTask) ??
    []
  );
}

function previousSources(catalog: Catalog | undefined, providerId: string): SourceRecord[] {
  return catalog?.sources.filter((source) => source.provider_id === providerId) ?? [];
}

function previousCoverage(catalog: Catalog | undefined, providerId: string): Coverage | undefined {
  return catalog?.coverage.find((coverage) => coverage.provider_id === providerId);
}

function sourceState(
  result: Pick<
    Awaited<ReturnType<typeof fetchSource>>,
    "etag" | "lastModified" | "contentHash" | "snapshotUri"
  >,
  observedAt: string,
): SourceState {
  return {
    etag: result.etag,
    lastModified: result.lastModified,
    contentHash: result.contentHash,
    snapshotUri: result.snapshotUri,
    lastSuccessAt: observedAt,
    checkedAt: observedAt,
    consecutiveFailures: 0,
  };
}

function mergeFacts(groups: ProviderModel[][]): ProviderModel[] {
  const models = new Map<string, ProviderModel>();
  for (const group of groups) {
    for (const model of group) {
      const current = models.get(model.uid);
      if (current === undefined) {
        models.set(model.uid, model);
        continue;
      }
      models.set(model.uid, {
        ...current,
        source_refs: [...new Set([...current.source_refs, ...model.source_refs])],
        pricing: [...current.pricing, ...model.pricing],
      });
    }
  }
  return [...models.values()].sort((left, right) => left.uid.localeCompare(right.uid));
}

function applyOverlays(
  models: ProviderModel[],
  overlays: { source: SourceManifest; models: ProviderModel[] }[],
): ProviderModel[] {
  const byUid = new Map(models.map((model) => [model.uid, model]));
  for (const group of overlays) {
    for (const overlay of group.models) {
      const current = byUid.get(overlay.uid);
      if (current === undefined) continue;
      const fields = new Set(group.source.fields);
      byUid.set(overlay.uid, {
        ...current,
        aliases: fields.has("aliases")
          ? [...new Set([...current.aliases, ...overlay.aliases])]
          : current.aliases,
        status: fields.has("status") ? overlay.status : current.status,
        is_deprecated: fields.has("is_deprecated") ? overlay.is_deprecated : current.is_deprecated,
        retired_at: fields.has("retired_at") ? overlay.retired_at : current.retired_at,
        replacement_model_ids: fields.has("replacement_model_ids")
          ? [...new Set([...current.replacement_model_ids, ...overlay.replacement_model_ids])]
          : current.replacement_model_ids,
        source_refs: [...new Set([...current.source_refs, ...overlay.source_refs])],
      });
    }
  }
  return [...byUid.values()].sort((left, right) => left.uid.localeCompare(right.uid));
}

function missingCredential(source: SourceManifest): boolean {
  if (source.auth === undefined) return false;
  const value = process.env[source.auth.env];
  return value === undefined || value.trim() === "";
}

function sourceWarning(
  code: string,
  providerId: string,
  sourceId: string,
  detail: string,
): CatalogWarning {
  return { code, provider_id: providerId, source_id: sourceId, message: detail };
}

function missingFieldWarning(
  field: CoverageField,
  models: ProviderModel[],
  providerId: string,
  sourceId: string,
): CatalogWarning | undefined {
  const count = models.filter((model) =>
    field === "limits.context_tokens"
      ? model.limits.context_tokens === undefined
      : model.pricing_status === "unknown",
  ).length;
  if (count === 0) return undefined;
  const fact =
    field === "limits.context_tokens"
      ? "a token context limit"
      : "machine-readable pricing on their model page";
  return {
    code: "missing_field",
    provider_id: providerId,
    source_id: sourceId,
    field,
    message: `${count} models do not publish ${fact}.`,
  };
}

function providerRecord(
  manifest: ProviderManifest,
  models: ProviderModel[],
  lastSuccessfulSyncAt: string | undefined,
): Provider {
  return {
    ...manifest.provider,
    source_ids: manifest.sources.map((source) => source.id),
    last_successful_sync_at: lastSuccessfulSyncAt,
    catalog_version: models.length === 0 ? undefined : sha256(stableJson(models)),
  };
}

async function collectProvider(
  manifest: ProviderManifest,
  previous: Catalog | undefined,
  state: FetchState,
  observedAt: string,
): Promise<ProviderResult> {
  const oldModels = previousModels(previous, manifest.provider.id);
  const comparableOldModels = oldModels.filter(
    (model) =>
      !manifest.supersededIdKinds?.includes(model.id_kind) &&
      !manifest.supersededModelIds?.includes(model.model_id),
  );
  const oldSources = previousSources(previous, manifest.provider.id);
  const oldCoverage = previousCoverage(previous, manifest.provider.id);
  const warnings: CatalogWarning[] = [];

  if (manifest.sources.length === 0) {
    return {
      provider: providerRecord(manifest, oldModels, oldCoverage?.last_successful_sync_at),
      models: oldModels,
      sources: oldSources,
      coverage: {
        provider_id: manifest.provider.id,
        status: "not_configured",
        model_count: oldModels.length,
        price_rate_count: oldModels.reduce((count, model) => count + model.pricing.length, 0),
        checked_at: observedAt,
        last_successful_sync_at: oldCoverage?.last_successful_sync_at,
        reason: manifest.notConfiguredReason,
      },
      warnings,
    };
  }

  try {
    const groups: ProviderModel[][] = [];
    const overlays: { source: SourceManifest; models: ProviderModel[] }[] = [];
    const inventories: { source: SourceManifest; models: ProviderModel[] }[] = [];
    const sources: SourceRecord[] = [];
    for (const source of manifest.sources) {
      if (missingCredential(source)) {
        warnings.push(
          sourceWarning(
            "authentication_not_configured",
            manifest.provider.id,
            source.id,
            `${source.auth?.env ?? "Credential"} is not configured; the scoped inventory was skipped.`,
          ),
        );
        if (source.optional) continue;
        throw new Error(`Missing credential for ${source.id}`);
      }

      let result: Awaited<ReturnType<typeof fetchSource>>;
      try {
        result = await fetchSource(manifest.provider.id, source, state.sources);
      } catch (error) {
        const oldState = state.sources[source.id];
        if (oldState !== undefined) {
          state.sources[source.id] = {
            ...oldState,
            checkedAt: observedAt,
            consecutiveFailures: oldState.consecutiveFailures + 1,
          };
        }
        warnings.push(
          sourceWarning("source_fetch_failed", manifest.provider.id, source.id, message(error)),
        );
        if (source.optional) continue;
        throw error;
      }

      let parsed: ProviderModel[];
      try {
        parsed = parseSource({
          provider: providerRecord(manifest, [], undefined),
          source,
          body: result.body,
          observedAt,
        });
      } catch (error) {
        const oldState = state.sources[source.id];
        if (oldState !== undefined) {
          state.sources[source.id] = {
            ...oldState,
            checkedAt: observedAt,
            consecutiveFailures: oldState.consecutiveFailures + 1,
          };
        }
        warnings.push(
          sourceWarning("source_parse_failed", manifest.provider.id, source.id, message(error)),
        );
        if (source.optional) continue;
        throw error;
      }

      const role = source.role ?? "catalog";
      if (role === "catalog") groups.push(parsed);
      if (role === "overlay") overlays.push({ source, models: parsed });
      if (role === "inventory") inventories.push({ source, models: parsed });
      sources.push({
        id: source.id,
        provider_id: manifest.provider.id,
        url: source.url,
        source_type: source.type,
        stability: source.stability,
        scope: source.scope ?? "global",
        exhaustive: source.exhaustive ?? false,
        role,
        field_paths: source.fields,
        observed_at: observedAt,
        etag: result.etag,
        last_modified: result.lastModified,
        content_hash: result.contentHash,
        extractor_version: source.extractorVersion,
        snapshot_uri: result.snapshotUri,
      });
      state.sources[source.id] = sourceState(result, observedAt);
      const dependencyKeys = new Set(result.dependencies.map((dependency) => dependency.key));
      for (const dependency of result.dependencies)
        state.sources[dependency.key] = sourceState(dependency, observedAt);
      for (const key of Object.keys(state.sources))
        if (key.startsWith(`${source.id}/`) && !dependencyKeys.has(key)) delete state.sources[key];
    }

    if (groups.length === 0) throw new Error("No global catalog source succeeded");
    const candidate = applyOverlays(mergeFacts(groups), overlays);
    const catalogIdentities = new Set(
      candidate.flatMap((model) => [model.model_id, ...model.aliases]),
    );
    for (const inventory of inventories) {
      const inventoryIds = new Set(inventory.models.map((model) => model.model_id));
      const missing = [...catalogIdentities].filter((id) => !inventoryIds.has(id)).length;
      const extra = [...inventoryIds].filter((id) => !catalogIdentities.has(id)).length;
      warnings.push(
        sourceWarning(
          "scope_limited",
          manifest.provider.id,
          inventory.source.id,
          `Inventory is ${inventory.source.scope ?? "account"}-scoped and cannot define global catalog presence.`,
        ),
      );
      if (missing > 0 || extra > 0)
        warnings.push(
          sourceWarning(
            "catalog_api_set_mismatch",
            manifest.provider.id,
            inventory.source.id,
            `${missing} catalog identifiers were absent from the scoped inventory; ${extra} inventory identifiers were absent from the public catalog.`,
          ),
        );
    }
    const warnOnMissing = manifest.warnOnMissing;
    if (warnOnMissing !== undefined)
      warnings.push(
        ...warnOnMissing.fields.flatMap((field) => {
          const warning = missingFieldWarning(
            field,
            candidate,
            manifest.provider.id,
            warnOnMissing.sourceId,
          );
          return warning === undefined ? [] : [warning];
        }),
      );
    const validation = validateProvider(candidate, comparableOldModels);
    if (!validation.ok) throw new Error(validation.reason ?? "Provider validation failed");
    const models = preserveMissing(candidate, comparableOldModels);
    return {
      provider: providerRecord(manifest, models, observedAt),
      models,
      sources,
      coverage: {
        provider_id: manifest.provider.id,
        status: "fresh",
        model_count: models.length,
        price_rate_count: models.reduce((count, model) => count + model.pricing.length, 0),
        checked_at: observedAt,
        last_successful_sync_at: observedAt,
      },
      warnings,
    };
  } catch (error) {
    const reason = message(error);
    const hasPrevious = oldModels.length > 0;
    return {
      provider: providerRecord(manifest, oldModels, oldCoverage?.last_successful_sync_at),
      models: oldModels,
      sources: oldSources,
      coverage: {
        provider_id: manifest.provider.id,
        status: hasPrevious ? "stale" : "unavailable",
        model_count: oldModels.length,
        price_rate_count: oldModels.reduce((count, model) => count + model.pricing.length, 0),
        checked_at: observedAt,
        last_successful_sync_at: oldCoverage?.last_successful_sync_at,
        reason,
      },
      warnings,
      quarantine: { provider_id: manifest.provider.id, checked_at: observedAt, reason },
    };
  }
}

async function publish(catalog: Catalog): Promise<void> {
  const envelope = {
    catalog_version: catalog.catalog_version,
    generated_at: catalog.generated_at,
    data: {
      providers: catalog.providers,
      models: catalog.models,
      sources: catalog.sources,
      coverage: catalog.coverage,
    },
    warnings: catalog.warnings,
  };
  await writeJson(join(rootDirectory, "data/catalog.json"), catalog);
  await writeJson(join(rootDirectory, "public/data/catalog.json"), catalog);
  await writeJson(join(rootDirectory, "public/v1/catalog/index.json"), envelope);
  await writeJson(join(rootDirectory, "public/v1/providers/index.json"), {
    catalog_version: catalog.catalog_version,
    generated_at: catalog.generated_at,
    data: catalog.providers,
    warnings: catalog.warnings,
  });
  for (const provider of catalog.providers) {
    const models = catalog.models.filter((model) => model.provider_id === provider.id);
    await writeJson(join(rootDirectory, `public/v1/providers/${provider.id}/index.json`), {
      catalog_version: catalog.catalog_version,
      generated_at: catalog.generated_at,
      data: provider,
      warnings: catalog.warnings,
    });
    await writeJson(join(rootDirectory, `public/v1/providers/${provider.id}/models/index.json`), {
      catalog_version: catalog.catalog_version,
      generated_at: catalog.generated_at,
      data: models,
      warnings: catalog.warnings,
    });
  }
}

export async function collect(options: CollectionOptions = {}): Promise<Catalog> {
  const observedAt = (options.now ?? new Date()).toISOString();
  if ((options.jitterMs ?? 0) > 0) await wait(Math.floor(Math.random() * (options.jitterMs ?? 0)));

  const previousValue = await readJson(join(rootDirectory, "data/catalog.json"));
  const previousResult =
    previousValue === undefined ? undefined : catalogSchema.safeParse(previousValue);
  const previous = options.rebuild
    ? undefined
    : previousResult?.success
      ? previousResult.data
      : undefined;
  const stateValue = await readJson(join(rootDirectory, "data/fetch-state.json"));
  const stateResult = stateValue === undefined ? undefined : fetchStateSchema.safeParse(stateValue);
  const state: FetchState = stateResult?.success ? stateResult.data : { sources: {} };

  const results: ProviderResult[] = [];
  for (let index = 0; index < manifests.length; index += 4) {
    results.push(
      ...(await Promise.all(
        manifests
          .slice(index, index + 4)
          .map((manifest) => collectProvider(manifest, previous, state, observedAt)),
      )),
    );
  }

  const providers = results
    .map((result) => result.provider)
    .sort((left, right) => left.id.localeCompare(right.id));
  const models = results
    .flatMap((result) => result.models)
    .sort((left, right) => left.uid.localeCompare(right.uid));
  const sources = results
    .flatMap((result) => result.sources)
    .sort((left, right) => left.id.localeCompare(right.id));
  const coverage = results
    .map((result) => result.coverage)
    .sort((left, right) => left.provider_id.localeCompare(right.provider_id));
  const catalogVersion = sha256(
    stableJson(providers.map((provider) => [provider.id, provider.catalog_version])),
  );
  const catalog = catalogSchema.parse({
    catalog_version: catalogVersion,
    generated_at: observedAt,
    providers,
    models,
    sources,
    coverage,
    warnings: [availabilityWarning, ...results.flatMap((result) => result.warnings)],
  });

  await writeJson(join(rootDirectory, "data/fetch-state.json"), state);
  await writeJson(
    join(rootDirectory, "data/quarantine.json"),
    results.flatMap((result) => (result.quarantine === undefined ? [] : [result.quarantine])),
  );
  await publish(catalog);
  return catalog;
}
