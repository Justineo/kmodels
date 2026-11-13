import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  assertCollectionBase,
  collectionPlanId,
  collectShard,
  createCollectionPlan,
  mergeCollectionShards,
  parseCollectionPlan,
  readCollectionShards,
  writeCollectionShard,
  type CollectionPlan,
  type CollectionShard,
} from "../src/catalog/collection-shards.ts";
import { collectProvider, collectProviders } from "../src/catalog/collector.ts";
import { manifests } from "../src/catalog/manifests.ts";
import { fetchSource, type FetchState } from "../src/catalog/fetch.ts";
import type { CollectionBatch, ProviderResult } from "../src/catalog/collection-result.ts";
import { composeCatalogPair, coreCatalogVersion } from "../src/catalog/pricing-pair-transition.ts";
import {
  failedPricingTransition,
  type ProviderPricingTransition,
} from "../src/catalog/pricing-transition.ts";
import { prepareCatalogPair } from "../src/catalog/pricing-publication.ts";
import { emptyPricingCatalog, type PricingCatalog } from "../src/catalog/pricing-schema.ts";
import { priceDataExport } from "../src/catalog/pricing-lookup-export.ts";
import type { Catalog } from "../src/catalog/schema.ts";
import { sha256 } from "../src/catalog/io.ts";
import { deepseekBundle } from "./deepseek-fixture.ts";

vi.mock("../src/catalog/fetch.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/catalog/fetch.ts")>()),
  fetchSource: vi.fn(),
}));
const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function temporary() {
  const directory = await mkdtemp(join(tmpdir(), "kmodels-shards-"));
  directories.push(directory);
  return directory;
}
const previousAt = "2026-11-12T00:00:00.000Z";
const observedAt = "2026-11-13T00:00:00.000Z";
const pointer = Buffer.from("accepted snapshot pointer");
const plan = () => createCollectionPlan("a".repeat(40), pointer, new Date(observedAt));
function normalized(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function emptyResult(id: string): ProviderResult {
  const manifest = manifests.find(({ provider }) => provider.id === id);
  if (manifest === undefined) throw new Error("Missing provider fixture");
  return {
    provider: { ...manifest.provider, source_ids: manifest.sources.map(({ id }) => id) },
    models: [],
    sources: [],
    warnings: [],
    coverage: {
      provider_id: id,
      status: "not_configured",
      model_count: 0,
      pricing_term_count: 0,
      checked_at: observedAt,
    },
    attempt: { provider_id: id, outcome: "not_configured", sources: [] },
  };
}
function emptyShards(current: CollectionPlan): CollectionShard[] {
  return current.shards.map(({ id, provider_ids }) => ({
    schema_version: 1,
    plan_id: collectionPlanId(current),
    shard_id: id,
    state: { sources: {} },
    batch: {
      results: provider_ids.map(emptyResult),
      durations: provider_ids.map((provider_id) => ({ provider_id, duration_ms: 1 })),
      sourceDurations: [],
    },
  }));
}
function catalog(results: ProviderResult[], at: string): Catalog {
  const providers = results
    .map(({ provider }) => provider)
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    catalog_version: coreCatalogVersion(providers),
    generated_at: at,
    providers,
    models: results.flatMap(({ models }) => models),
    sources: results.flatMap(({ sources }) => sources),
    coverage: results.map(({ coverage }) => coverage),
    warnings: results.flatMap(({ warnings }) => warnings),
  };
}
function publication(batch: CollectionBatch, prior: Catalog, priorPricing: PricingCatalog) {
  const transitions = batch.results.map((result): ProviderPricingTransition =>
    result.pricing === undefined
      ? failedPricingTransition(
          result.provider.id,
          observedAt,
          result.pricingFailure ?? "pricing_not_observed",
        )
      : { kind: "fresh", partition: result.pricing },
  );
  const composed = composeCatalogPair(
    prior,
    catalog(batch.results, observedAt),
    priorPricing,
    transitions,
  );
  return prepareCatalogPair(composed.catalog, composed.pricing);
}

it("assigns every current provider exactly once and binds the plan to code, snapshot and observation time", () => {
  const current = plan();
  expect(current.shards.map(({ id }) => id)).toEqual([
    "sagemaker",
    "bedrock",
    "azure",
    "nvidia",
    "other",
  ]);
  expect(current.shards.flatMap(({ provider_ids }) => provider_ids).sort()).toEqual(
    manifests.map(({ provider }) => provider.id).sort(),
  );
  expect(() => assertCollectionBase(current, "a".repeat(40), pointer)).not.toThrow();
  expect(() => assertCollectionBase(current, "b".repeat(40), pointer)).toThrow(
    "checked-out code and snapshot",
  );
  expect(() =>
    assertCollectionBase(current, "a".repeat(40), Buffer.from("different pointer")),
  ).toThrow("checked-out code and snapshot");
  expect(collectionPlanId({ ...current, observed_at: previousAt })).not.toBe(
    collectionPlanId(current),
  );
  expect(() => parseCollectionPlan({ ...current, shards: current.shards.slice(1) })).toThrow(
    "provider groups exactly",
  );
});

it.each([
  "missing shard",
  "duplicate shard",
  "missing provider",
  "different plan",
  "foreign state",
  "wrong provider",
  "wrong observation",
])("rejects incomplete or mixed acquisition evidence: %s", (scenario) => {
  const current = plan();
  const shards = emptyShards(current);
  const shard = shards[0];
  const result = shard?.batch.results[0];
  if (shard === undefined || result === undefined) throw new Error("Missing shard fixture");
  switch (scenario) {
    case "missing shard":
      shards.pop();
      break;
    case "duplicate shard":
      shards.push(shard);
      break;
    case "missing provider":
      shard.batch.results = [];
      break;
    case "different plan":
      shard.plan_id = "b".repeat(64);
      break;
    case "foreign state":
      shard.state.sources["azure-retail-prices"] = {
        checkedAt: observedAt,
        consecutiveFailures: 1,
      };
      break;
    case "wrong provider":
      result.attempt.provider_id = "azure";
      break;
    case "wrong observation":
      result.coverage.checked_at = previousAt;
      break;
  }
  expect(() => mergeCollectionShards(current, shards)).toThrow();
});

it("validates compressed result boundaries and rejects extra or malformed artifact files", async () => {
  const current = plan();
  const shards = emptyShards(current);
  const directory = await temporary();
  for (const shard of shards) await writeCollectionShard(directory, shard);
  const merged = await readCollectionShards(directory, current);
  expect(merged.results).toHaveLength(manifests.length);
  const first = shards[0];
  if (first === undefined) throw new Error("Missing shard");
  const path = join(directory, `${first.shard_id}.json.gz`);
  const decoded: unknown = JSON.parse(gunzipSync(await readFile(path)).toString());
  expect(normalized(decoded)).toEqual(normalized(first));
  await writeFile(
    path,
    gzipSync(
      JSON.stringify({
        ...first,
        batch: { ...first.batch, results: [{ body: "raw source bytes" }] },
      }),
    ),
  );
  await expect(readCollectionShards(directory, current)).rejects.toThrow();
  await writeCollectionShard(directory, first);
  await writeFile(join(directory, "unexpected.json.gz"), "extra");
  await expect(readCollectionShards(directory, current)).rejects.toThrow("shard files");
});

describe("fixture acquisition and publication parity", () => {
  it.each(["fresh", "retained"])(
    "matches normal collection, replay inputs and portable prices for %s pricing",
    async (mode) => {
      const manifest = manifests.find(({ provider }) => provider.id === "deepseek");
      const source = manifest?.sources.find(({ id }) => id === "deepseek-catalog");
      if (manifest === undefined || source === undefined)
        throw new Error("Missing DeepSeek source");
      vi.stubEnv("DEEPSEEK_API_KEY", "");
      const body = JSON.stringify(await deepseekBundle(source));
      const updates = await readFile(
        new URL("./fixtures/deepseek/updates.html", import.meta.url),
        "utf8",
      );
      let fail = false;
      vi.mocked(fetchSource).mockImplementation(async (source) => {
        if (source.id !== "deepseek-catalog" && source.id !== "deepseek-updates")
          throw new Error("Fixture source unavailable");
        if (fail) throw new Error("HTTP 503");
        const contents = source.id === "deepseek-catalog" ? body : updates;
        return {
          body: contents,
          contentHash: sha256(contents),
          etag: undefined,
          lastModified: undefined,
          dependencies: [],
        };
      });
      const initialState: FetchState = { sources: {} };
      const initial = await collectProvider(manifest, undefined, initialState, previousAt);
      if (initial.pricing === undefined) throw new Error(JSON.stringify(initial.attempt));
      const prior = catalog([initial], previousAt);
      const priorPricing = {
        ...emptyPricingCatalog(),
        provider_snapshots: [initial.pricing.snapshot],
        provider_vocabularies: [initial.pricing.vocabulary],
        model_dispositions: initial.pricing.model_dispositions,
        books: initial.pricing.books,
      };
      const directory = await temporary();
      const current = plan();
      const inputs = [JSON.stringify(prior), JSON.stringify(initialState)];
      await writeFile(join(directory, "catalog.json"), inputs[0] ?? "");
      await writeFile(join(directory, "fetch-state.json"), inputs[1] ?? "");
      fail = mode === "retained";
      const normalState = structuredClone(initialState);
      const normal = await collectProviders(prior, normalState, observedAt, undefined);
      const output = await temporary();
      for (const { id } of current.shards)
        await writeCollectionShard(output, await collectShard(current, id, directory));
      const merged = await readCollectionShards(output, current);
      expect(normalized(merged.results)).toEqual(normalized(normal.results));
      expect(merged.state).toEqual(normalState);
      expect(await readFile(join(directory, "catalog.json"), "utf8")).toBe(inputs[0]);
      expect(await readFile(join(directory, "fetch-state.json"), "utf8")).toBe(inputs[1]);
      const before = publication(normal, prior, priorPricing);
      const after = publication(merged, prior, priorPricing);
      expect(after.pairId).toBe(before.pairId);
      expect(after.pricing.data.books.length).toBeGreaterThan(0);
      expect(
        after.pricing.data.provider_snapshots.find(({ provider_id }) => provider_id === "deepseek")
          ?.publication,
      ).toBe(mode);
      expect(priceDataExport(after.catalog, after.pricing)).toEqual(
        priceDataExport(before.catalog, before.pricing),
      );
    },
  );
});
