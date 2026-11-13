import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { z } from "zod";
import { canonicalJson, compareUtf8 } from "./canonical-value.ts";
import { parseIJson } from "./canonical-json.ts";
import { collectProviders } from "./collector.ts";
import {
  collectionBatchSchema,
  type CollectionBatch,
  type ProviderResult,
} from "./collection-result.ts";
import { fetchStateSchema, type FetchState } from "./fetch.ts";
import { manifests } from "./manifests.ts";
import { atomicWrite, readJson, sha256 } from "./io.ts";
import { pricingLimits } from "./pricing-constants.ts";
import { catalogSchema, migrateCatalogStorage } from "./schema.ts";

export const collectionShardIds = ["sagemaker", "bedrock", "azure", "nvidia", "other"] as const;
const shardIdSchema = z.enum(collectionShardIds);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const planSchema = z.strictObject({
  schema_version: z.literal(1),
  revision: z.string().regex(/^[a-f0-9]{40}$/),
  snapshot_sha256: hash,
  observed_at: z.iso.datetime(),
  shards: z.array(
    z.strictObject({ id: shardIdSchema, provider_ids: z.array(z.string().min(1)).min(1) }),
  ),
});
export type CollectionPlan = z.infer<typeof planSchema>;

const shardSchema = z.strictObject({
  schema_version: z.literal(1),
  plan_id: hash,
  shard_id: shardIdSchema,
  batch: collectionBatchSchema,
  state: fetchStateSchema,
});
export type CollectionShard = z.infer<typeof shardSchema>;

function shardForProvider(id: string): CollectionShard["shard_id"] {
  switch (id) {
    case "amazon-sagemaker":
      return "sagemaker";
    case "amazon-bedrock":
      return "bedrock";
    case "azure":
      return "azure";
    case "nvidia":
      return "nvidia";
    default:
      return "other";
  }
}

function groups(): CollectionPlan["shards"] {
  return collectionShardIds.map((id) => ({
    id,
    provider_ids: manifests
      .filter(({ provider }) => shardForProvider(provider.id) === id)
      .map(({ provider }) => provider.id)
      .sort(compareUtf8),
  }));
}

export function createCollectionPlan(
  revision: string,
  pointer: Uint8Array,
  now = new Date(),
): CollectionPlan {
  return planSchema.parse({
    schema_version: 1,
    revision,
    snapshot_sha256: sha256(pointer),
    observed_at: now.toISOString(),
    shards: groups(),
  });
}

export function parseCollectionPlan(input: unknown): CollectionPlan {
  const plan = planSchema.parse(input);
  if (canonicalJson(plan.shards) !== canonicalJson(groups()))
    throw new Error("Collection plan does not cover the current provider groups exactly");
  return plan;
}

export function collectionPlanId(plan: CollectionPlan): string {
  return sha256(canonicalJson(plan));
}

export function assertCollectionBase(
  plan: CollectionPlan,
  revision: string,
  pointer: Uint8Array,
): void {
  if (plan.revision !== revision || plan.snapshot_sha256 !== sha256(pointer))
    throw new Error("Collection plan does not match the checked-out code and snapshot");
}

function providerIds(plan: CollectionPlan, id: CollectionShard["shard_id"]): string[] {
  const group = plan.shards.find((shard) => shard.id === id);
  if (group === undefined) throw new Error(`Missing collection shard ${id}`);
  return group.provider_ids;
}

function sourceOwner(key: string): string | undefined {
  return manifests.find((manifest) =>
    manifest.sources.some((source) => key === source.id || key.startsWith(`${source.id}/`)),
  )?.provider.id;
}

function sameIds(actual: readonly string[], expected: readonly string[], label: string): void {
  if (
    canonicalJson([...actual].sort(compareUtf8)) !== canonicalJson([...expected].sort(compareUtf8))
  )
    throw new Error(`Collection shard has missing, duplicate or unexpected ${label}`);
}

function validateResult(result: ProviderResult, plan: CollectionPlan): void {
  const { pricing, quarantine } = result;
  const id = result.provider.id;
  const manifest = manifests.find(({ provider }) => provider.id === id);
  if (manifest === undefined) throw new Error("Collection shard has an unknown provider");
  sameIds(
    result.provider.source_ids,
    manifest.sources.map(({ id }) => id),
    "provider sources",
  );
  const ownModels = [
    ...result.models,
    ...(result.attempt.candidate_models ?? []),
    ...(result.pricingReplaySources ?? []).flatMap(({ models }) => models),
  ];
  if (
    result.coverage.provider_id !== id ||
    result.attempt.provider_id !== id ||
    result.coverage.checked_at !== plan.observed_at ||
    (quarantine !== undefined &&
      (quarantine.provider_id !== id || quarantine.checked_at !== plan.observed_at)) ||
    ownModels.some((model) => model.provider_id !== id) ||
    result.sources.some((source) => {
      const owner = sourceOwner(source.id);
      return source.provider_id !== id || (owner !== undefined && owner !== id);
    }) ||
    result.attempt.sources.some((source) => sourceOwner(source.source_id) !== id) ||
    (result.inferencePriceSources ?? []).some(({ record }) => record.provider_id !== id) ||
    (pricing !== undefined &&
      (pricing.snapshot.provider_id !== id ||
        (pricing.snapshot.publication === "fresh" &&
          pricing.snapshot.observed_at !== plan.observed_at) ||
        pricing.vocabulary.provider_id !== id ||
        pricing.books.some((book) => book.provider_id !== id)))
  )
    throw new Error(`Collection shard provider ownership or observation time mismatch: ${id}`);
}

export function mergeCollectionShards(
  plan: CollectionPlan,
  shards: readonly CollectionShard[],
): CollectionBatch & { state: FetchState } {
  sameIds(
    shards.map(({ shard_id }) => shard_id),
    plan.shards.map(({ id }) => id),
    "shards",
  );
  const results = new Map<string, ProviderResult>();
  const durations: CollectionBatch["durations"] = [];
  const sourceDurations: CollectionBatch["sourceDurations"] = [];
  const state: FetchState = { sources: {} };
  const planId = collectionPlanId(plan);
  for (const shard of shards) {
    if (shard.plan_id !== planId) throw new Error("Collection shard belongs to a different plan");
    const ids = providerIds(plan, shard.shard_id);
    sameIds(
      shard.batch.results.map(({ provider }) => provider.id),
      ids,
      "providers",
    );
    sameIds(
      shard.batch.durations.map(({ provider_id }) => provider_id),
      ids,
      "provider durations",
    );
    const sourceIds = shard.batch.sourceDurations.map(({ source_id }) => source_id);
    sameIds(sourceIds, [...new Set(sourceIds)], "source durations");
    for (const result of shard.batch.results) {
      validateResult(result, plan);
      results.set(result.provider.id, result);
    }
    for (const [key, value] of Object.entries(shard.state.sources)) {
      const owner = sourceOwner(key);
      if (owner === undefined || !ids.includes(owner) || Object.hasOwn(state.sources, key))
        throw new Error("Collection shard contains foreign or duplicate fetch state");
      state.sources[key] = value;
    }
    if (
      shard.batch.sourceDurations.some(
        ({ provider_id, source_id }) =>
          !ids.includes(provider_id) || sourceOwner(source_id) !== provider_id,
      )
    )
      throw new Error("Collection shard contains foreign source durations");
    durations.push(...shard.batch.durations);
    sourceDurations.push(...shard.batch.sourceDurations);
  }
  return {
    results: manifests.map(({ provider }) => {
      const result = results.get(provider.id);
      if (result === undefined) throw new Error(`Missing collected provider ${provider.id}`);
      return result;
    }),
    durations: durations.sort((left, right) => compareUtf8(left.provider_id, right.provider_id)),
    sourceDurations: sourceDurations.sort((left, right) =>
      compareUtf8(left.source_id, right.source_id),
    ),
    state,
  };
}

export async function collectShard(
  plan: CollectionPlan,
  id: CollectionShard["shard_id"],
  directory: string,
): Promise<CollectionShard> {
  const ids = providerIds(plan, id);
  // Shards need the accepted model catalog and fetch history, not the complete price graph.
  const previous = catalogSchema.parse(
    migrateCatalogStorage(
      parseIJson(await readFile(join(directory, "catalog.json")), pricingLimits.coreInputBytes),
    ),
  );
  const priorState = fetchStateSchema.parse(await readJson(join(directory, "fetch-state.json")));
  const state: FetchState = {
    sources: Object.fromEntries(
      Object.entries(priorState.sources).filter(([key]) => {
        const owner = sourceOwner(key);
        return owner !== undefined && ids.includes(owner);
      }),
    ),
  };
  const batch = await collectProviders(
    previous,
    state,
    plan.observed_at,
    undefined,
    manifests.filter(({ provider }) => ids.includes(provider.id)),
  );
  return { schema_version: 1, plan_id: collectionPlanId(plan), shard_id: id, batch, state };
}

export async function writeCollectionShard(
  directory: string,
  shard: CollectionShard,
): Promise<void> {
  const serialized = JSON.stringify(shard);
  if (Buffer.byteLength(serialized) > pricingLimits.pricingInputBytes)
    throw new Error("Collection shard exceeds its decoded byte limit");
  await atomicWrite(
    join(directory, `${shard.shard_id}.json.gz`),
    gzipSync(serialized, { level: 1 }),
  );
}

export async function readCollectionShards(
  directory: string,
  plan: CollectionPlan,
): Promise<CollectionBatch & { state: FetchState }> {
  const files = await readdir(directory);
  sameIds(
    files,
    plan.shards.map(({ id }) => `${id}.json.gz`),
    "shard files",
  );
  const shards: CollectionShard[] = [];
  for (const name of files.sort(compareUtf8)) {
    const path = join(directory, name);
    if ((await stat(path)).size > pricingLimits.pricingInputBytes)
      throw new Error("Collection shard exceeds its encoded byte limit");
    const decoded = gunzipSync(await readFile(path), {
      maxOutputLength: pricingLimits.pricingInputBytes,
    });
    shards.push(shardSchema.parse(parseIJson(decoded, pricingLimits.pricingInputBytes)));
  }
  return mergeCollectionShards(plan, shards);
}
