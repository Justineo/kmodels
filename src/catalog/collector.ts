import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { parseSource } from "./adapters.ts";
import { fetchSource, fetchStateSchema, type FetchState, type SourceState } from "./fetch.ts";
import { manifests, type ProviderManifest } from "./manifests.ts";
import { readJson, rootDirectory, sha256, stableJson, writeJson } from "./io.ts";
import {
  catalogSchema,
  type Catalog,
  type Coverage,
  type Provider,
  type ProviderModel,
  type SourceRecord,
} from "./schema.ts";
import { preserveMissing, validateProvider } from "./validation.ts";

const warning = "Public catalog data does not represent account-specific availability.";

interface ProviderResult {
  provider: Provider;
  models: ProviderModel[];
  sources: SourceRecord[];
  coverage: Coverage;
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
  return catalog?.models.filter((model) => model.provider_id === providerId) ?? [];
}

function previousSources(catalog: Catalog | undefined, providerId: string): SourceRecord[] {
  return catalog?.sources.filter((source) => source.provider_id === providerId) ?? [];
}

function previousCoverage(catalog: Catalog | undefined, providerId: string): Coverage | undefined {
  return catalog?.coverage.find((coverage) => coverage.provider_id === providerId);
}

function sourceState(
  result: Awaited<ReturnType<typeof fetchSource>>,
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
  const oldSources = previousSources(previous, manifest.provider.id);
  const oldCoverage = previousCoverage(previous, manifest.provider.id);

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
    };
  }

  try {
    const groups: ProviderModel[][] = [];
    const sources: SourceRecord[] = [];
    for (const source of manifest.sources) {
      try {
        const result = await fetchSource(manifest.provider.id, source, state.sources[source.id]);
        groups.push(
          parseSource({
            provider: providerRecord(manifest, [], undefined),
            source,
            body: result.body,
            observedAt,
          }),
        );
        sources.push({
          id: source.id,
          provider_id: manifest.provider.id,
          url: source.url,
          source_type: source.type,
          stability: source.stability,
          field_paths: source.fields,
          observed_at: observedAt,
          etag: result.etag,
          last_modified: result.lastModified,
          content_hash: result.contentHash,
          extractor_version: source.extractorVersion,
          snapshot_uri: result.snapshotUri,
        });
        state.sources[source.id] = sourceState(result, observedAt);
      } catch (error) {
        const oldState = state.sources[source.id];
        if (oldState !== undefined) {
          state.sources[source.id] = {
            ...oldState,
            checkedAt: observedAt,
            consecutiveFailures: oldState.consecutiveFailures + 1,
          };
        }
        throw error;
      }
    }

    const candidate = mergeFacts(groups);
    const validation = validateProvider(candidate, oldModels);
    if (!validation.ok) throw new Error(validation.reason ?? "Provider validation failed");
    const models = preserveMissing(candidate, oldModels);
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
    warnings: [warning],
  });

  await writeJson(join(rootDirectory, "data/fetch-state.json"), state);
  await writeJson(
    join(rootDirectory, "data/quarantine.json"),
    results.flatMap((result) => (result.quarantine === undefined ? [] : [result.quarantine])),
  );
  await publish(catalog);
  return catalog;
}
