import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { parseSource } from "./adapters.ts";
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
import { normalizeModelTypes } from "./task.ts";

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
    catalog?.models.filter((model) => model.provider_id === providerId).map(normalizeModelTypes) ??
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

type SourceGroup = { source: SourceManifest; models: ProviderModel[] };

function known<T extends boolean | "unknown">(current: T, incoming: T): T {
  return incoming === "unknown" ? current : incoming;
}

function applyFields(
  current: ProviderModel,
  incoming: ProviderModel,
  source: SourceManifest,
): ProviderModel {
  const fields = new Set(source.fields);
  const incomingModalities =
    incoming.modalities.input.length + incoming.modalities.output.length > 0;
  const incomingType = incoming.types.some((type) => type !== "other");
  const incomingPricing = incoming.pricing.length > 0 || incoming.pricing_status !== "unknown";
  return {
    ...current,
    name:
      fields.has("name") &&
      (incoming.name !== incoming.model_id || current.name === current.model_id)
        ? incoming.name
        : current.name,
    description:
      fields.has("description") && incoming.description !== undefined
        ? incoming.description
        : current.description,
    aliases: fields.has("aliases")
      ? [...new Set([...current.aliases, ...incoming.aliases])]
      : current.aliases,
    types:
      fields.has("types") && incomingType
        ? [...new Set([...current.types.filter((type) => type !== "other"), ...incoming.types])]
        : current.types,
    raw_type:
      fields.has("types") && incoming.raw_type !== undefined ? incoming.raw_type : current.raw_type,
    modalities:
      fields.has("modalities") && incomingModalities ? incoming.modalities : current.modalities,
    capabilities: fields.has("capabilities")
      ? {
          reasoning: known(current.capabilities.reasoning, incoming.capabilities.reasoning),
          tool_call: known(current.capabilities.tool_call, incoming.capabilities.tool_call),
          structured_output: known(
            current.capabilities.structured_output,
            incoming.capabilities.structured_output,
          ),
          streaming: known(current.capabilities.streaming, incoming.capabilities.streaming),
          batch: known(current.capabilities.batch, incoming.capabilities.batch),
          prompt_cache: known(
            current.capabilities.prompt_cache,
            incoming.capabilities.prompt_cache,
          ),
          fine_tuning: known(current.capabilities.fine_tuning, incoming.capabilities.fine_tuning),
          citations: known(current.capabilities.citations, incoming.capabilities.citations),
          code_execution: known(
            current.capabilities.code_execution,
            incoming.capabilities.code_execution,
          ),
          context_management: known(
            current.capabilities.context_management,
            incoming.capabilities.context_management,
          ),
          effort_control: known(
            current.capabilities.effort_control,
            incoming.capabilities.effort_control,
          ),
          computer_use: known(
            current.capabilities.computer_use,
            incoming.capabilities.computer_use,
          ),
        }
      : current.capabilities,
    limits: fields.has("limits") ? { ...current.limits, ...incoming.limits } : current.limits,
    release_date:
      fields.has("release_date") && incoming.release_date !== undefined
        ? incoming.release_date
        : current.release_date,
    updated_date:
      fields.has("updated_date") && incoming.updated_date !== undefined
        ? incoming.updated_date
        : current.updated_date,
    deprecated_at:
      fields.has("deprecated_at") && incoming.deprecated_at !== undefined
        ? incoming.deprecated_at
        : current.deprecated_at,
    retired_at:
      fields.has("retired_at") && incoming.retired_at !== undefined
        ? incoming.retired_at
        : current.retired_at,
    status:
      fields.has("status") && incoming.status !== "unknown" ? incoming.status : current.status,
    is_deprecated: fields.has("is_deprecated")
      ? known(current.is_deprecated, incoming.is_deprecated)
      : current.is_deprecated,
    replacement_model_ids: fields.has("replacement_model_ids")
      ? [...new Set([...current.replacement_model_ids, ...incoming.replacement_model_ids])]
      : current.replacement_model_ids,
    pricing_status:
      fields.has("pricing") && incomingPricing ? incoming.pricing_status : current.pricing_status,
    pricing: fields.has("pricing") && incomingPricing ? incoming.pricing : current.pricing,
    availability: fields.has("availability")
      ? [
          ...new Map(
            [...(current.availability ?? []), ...(incoming.availability ?? [])].map((item) => [
              `${item.region}\u0000${item.deployment_type}`,
              item,
            ]),
          ).values(),
        ].sort((left, right) =>
          `${left.deployment_type}\u0000${left.region}`.localeCompare(
            `${right.deployment_type}\u0000${right.region}`,
          ),
        )
      : current.availability,
    source_refs: [...new Set([...current.source_refs, ...incoming.source_refs])],
    observed_at: incoming.observed_at,
    last_seen_at: incoming.last_seen_at,
  };
}

function applyGroups(
  models: ProviderModel[],
  groups: SourceGroup[],
  create: boolean,
): ProviderModel[] {
  const byUid = new Map(models.map((model) => [model.uid, model]));
  const aliases = new Map<string, string | null>();
  const index = (model: ProviderModel): void => {
    for (const alias of model.aliases) {
      const current = aliases.get(alias);
      aliases.set(alias, current === undefined || current === model.uid ? model.uid : null);
    }
  };
  for (const model of models) index(model);
  for (const group of groups) {
    for (const incoming of group.models) {
      const aliasUid = aliases.get(incoming.model_id);
      const aliasModel =
        aliasUid === undefined || aliasUid === null ? undefined : byUid.get(aliasUid);
      const current = byUid.get(incoming.uid) ?? (create ? undefined : aliasModel);
      if (current === undefined) {
        if (create) {
          byUid.set(incoming.uid, incoming);
          index(incoming);
        }
        continue;
      }
      const next = applyFields(current, incoming, group.source);
      byUid.set(current.uid, next);
      index(next);
    }
  }
  const values = [...byUid.values()];
  const modelIds = new Set(values.map((model) => model.model_id));
  return (
    create
      ? values.map((model) => ({
          ...model,
          aliases: model.aliases.filter((alias) => !modelIds.has(alias)),
        }))
      : values
  ).sort((left, right) => left.uid.localeCompare(right.uid));
}

function missingCredential(source: SourceManifest): boolean {
  return requiredEnvs(source).some((env) => {
    const value = process.env[env];
    return value === undefined || value.trim() === "";
  });
}

function requiredEnvs(source: SourceManifest): string[] {
  const auth =
    source.auth === undefined
      ? []
      : source.auth.scheme === "aws" || source.auth.scheme === "azure"
        ? source.auth.envs
        : [source.auth.env];
  const transport =
    source.transport?.kind === "databricks"
      ? [source.transport.hostEnv]
      : source.transport?.kind === "azure-models"
        ? [source.transport.subscriptionEnv, source.transport.locationEnv]
        : [];
  return [...new Set([...auth, ...transport])];
}

function credentialLabel(source: SourceManifest): string {
  return requiredEnvs(source).join(" and ") || "Credential";
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
      : field === "pricing"
        ? model.pricing_status === "unknown" || model.pricing_status === "not_published"
        : model[field] === undefined,
  ).length;
  if (count === 0) return undefined;
  const fact =
    field === "limits.context_tokens"
      ? "a token context limit"
      : field === "pricing"
        ? "machine-readable pricing in the configured official sources"
        : field === "release_date"
          ? "an official release date"
          : "an official update date";
  return {
    code: "missing_field",
    provider_id: providerId,
    source_id: sourceId,
    field,
    message: `${count} ${count === 1 ? "model does" : "models do"} not publish ${fact}.`,
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
    const groups: SourceGroup[] = [];
    const overlays: SourceGroup[] = [];
    const inventories: SourceGroup[] = [];
    const sources: SourceRecord[] = [];
    for (const source of manifest.sources) {
      if (missingCredential(source)) {
        warnings.push(
          sourceWarning(
            "authentication_not_configured",
            manifest.provider.id,
            source.id,
            `Required credential(s) ${credentialLabel(source)} are not configured; the scoped inventory was skipped.`,
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
      if (role === "catalog") groups.push({ source, models: parsed });
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
    let candidate = applyGroups(applyGroups([], groups, true), overlays, false);
    const identity = (model: ProviderModel): string =>
      `${model.model_id}${model.version === undefined ? "" : `@${model.version}`}`;
    const catalogIdentities = new Set(
      candidate.flatMap((model) => [identity(model), ...model.aliases]),
    );
    for (const inventory of inventories) {
      const inventoryIds = new Set(inventory.models.map(identity));
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
      candidate = applyGroups(candidate, [inventory], false);
    }
    candidate = candidate.map(normalizeModelTypes);
    const warnOnMissing = manifest.warnOnMissing;
    if (warnOnMissing !== undefined)
      warnings.push(
        ...warnOnMissing.fields.flatMap((field) => {
          const warning = missingFieldWarning(
            field,
            warnOnMissing.statuses === undefined
              ? candidate
              : candidate.filter((model) => warnOnMissing.statuses?.includes(model.status)),
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
