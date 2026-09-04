import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { z } from "zod";
import { assertCanonicalJson, canonicalJsonBytes } from "./canonical-json.ts";
import { compareUtf8 } from "./canonical-value.ts";
import { atomicWrite, rootDirectory } from "./io.ts";
import { manifests, type ProviderManifest } from "./manifests.ts";
import {
  isPricingDependencySource,
  isRequiredPricingSource,
  type ParsedPricingSource,
  type PublishedPricingModel,
} from "./pricing-adapter.ts";
import type { ProviderPricingPartition } from "./pricing-assembly.ts";
import { pricingLimits } from "./pricing-constants.ts";
import { prepareCatalogPairInParallel, type CatalogPairCandidate } from "./pricing-publication.ts";
import {
  emptyPricingCatalog,
  type PricingCatalog,
  type ProviderPricingSnapshot,
} from "./pricing-schema.ts";
import { parsedPricingModel, parsedPricingModelSchema } from "./pricing-source.ts";
import { providerPartition } from "./pricing-transition.ts";
import type { SourceRecord } from "./schema.ts";
import { runWorkerPool } from "./worker-pool.ts";

const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const pricingReplaySourceSchema = z.strictObject({
  source_id: z.string().min(1),
  extractor_version: z.string().min(1),
  content_hash: hashSchema,
  models: z.array(parsedPricingModelSchema),
});
const pricingReplayProviderSchema = z.strictObject({
  provider_id: z.string().min(1),
  sources: z.array(pricingReplaySourceSchema).min(1),
});
export const pricingCompilationSnapshotSchema = z
  .strictObject({
    schema_version: z.literal(1),
    core_catalog_version: hashSchema,
    core_data_sha256: hashSchema,
    providers: z.array(pricingReplayProviderSchema),
  })
  .superRefine(({ providers }, context) => {
    assertSortedUnique(
      providers,
      ({ provider_id }) => provider_id,
      "pricing compilation providers",
      context,
    );
    for (const [providerIndex, provider] of providers.entries()) {
      assertSortedUnique(
        provider.sources,
        ({ source_id }) => source_id,
        `pricing compilation sources for ${provider.provider_id}`,
        context,
        ["providers", providerIndex, "sources"],
      );
      for (const [sourceIndex, source] of provider.sources.entries()) {
        assertSortedUnique(
          source.models,
          ({ uid }) => uid,
          `pricing compilation models for ${source.source_id}`,
          context,
          ["providers", providerIndex, "sources", sourceIndex, "models"],
        );
        for (const [modelIndex, model] of source.models.entries()) {
          if (model.provider_id !== provider.provider_id)
            context.addIssue({
              code: "custom",
              path: [
                "providers",
                providerIndex,
                "sources",
                sourceIndex,
                "models",
                modelIndex,
                "provider_id",
              ],
              message: "Pricing compilation model ownership mismatch",
            });
          for (const [factIndex, fact] of model.price_facts.entries())
            if (fact.source_ref !== source.source_id)
              context.addIssue({
                code: "custom",
                path: [
                  "providers",
                  providerIndex,
                  "sources",
                  sourceIndex,
                  "models",
                  modelIndex,
                  "price_facts",
                  factIndex,
                  "source_ref",
                ],
                message: "Pricing compilation fact provenance mismatch",
              });
          for (const [factIndex, fact] of model.raw_price_facts.entries())
            if (fact.source_ref !== source.source_id)
              context.addIssue({
                code: "custom",
                path: [
                  "providers",
                  providerIndex,
                  "sources",
                  sourceIndex,
                  "models",
                  modelIndex,
                  "raw_price_facts",
                  factIndex,
                  "source_ref",
                ],
                message: "Pricing compilation raw fact provenance mismatch",
              });
          for (const [commercialIndex, commercial] of (model.commercial_facts ?? []).entries())
            if (commercial.source_ref !== source.source_id)
              context.addIssue({
                code: "custom",
                path: [
                  "providers",
                  providerIndex,
                  "sources",
                  sourceIndex,
                  "models",
                  modelIndex,
                  "commercial_facts",
                  commercialIndex,
                  "source_ref",
                ],
                message: "Pricing compilation commercial fact provenance mismatch",
              });
            else
              for (const [factIndex, fact] of [
                ...commercial.price_facts,
                ...commercial.raw_price_facts,
              ].entries())
                if (fact.source_ref !== source.source_id)
                  context.addIssue({
                    code: "custom",
                    path: [
                      "providers",
                      providerIndex,
                      "sources",
                      sourceIndex,
                      "models",
                      modelIndex,
                      "commercial_facts",
                      commercialIndex,
                      "facts",
                      factIndex,
                      "source_ref",
                    ],
                    message: "Pricing compilation commercial fact provenance mismatch",
                  });
          for (const [inputIndex, pricingInput] of (model.pricing_inputs ?? []).entries())
            if (pricingInput.source_ref !== source.source_id)
              context.addIssue({
                code: "custom",
                path: [
                  "providers",
                  providerIndex,
                  "sources",
                  sourceIndex,
                  "models",
                  modelIndex,
                  "pricing_inputs",
                  inputIndex,
                  "source_ref",
                ],
                message: "Pricing compilation input provenance mismatch",
              });
        }
      }
    }
  });

export type PricingReplaySource = z.infer<typeof pricingReplaySourceSchema>;
export type PricingReplayProvider = z.infer<typeof pricingReplayProviderSchema>;
export type PricingCompilationSnapshot = z.infer<typeof pricingCompilationSnapshotSchema>;

export interface PricingCompilationResult {
  candidate: CatalogPairCandidate;
  replayedProviders: string[];
  preservedProviders: string[];
}

interface CompilationTask {
  providerId: string;
  snapshot: ProviderPricingSnapshot;
  sources: ParsedPricingSource[];
  models: PublishedPricingModel[];
  categoricalLabels: ProviderManifest["pricingCategoricalLabels"];
}

type CompilationTaskResult =
  | { providerId: string; partition: ProviderPricingPartition }
  | { providerId: string; error: string };

export const pricingCompilationPath = join(rootDirectory, "data/pricing-inputs.json.gz");

function replayModels(models: ParsedPricingSource["models"]): PricingReplaySource["models"] {
  const byUid = new Map<string, PricingReplaySource["models"][number]>();
  for (const input of models) {
    const model = parsedPricingModel(input);
    const current = byUid.get(model.uid);
    if (current === undefined) {
      byUid.set(model.uid, model);
      continue;
    }
    let pricingState = current.pricing_state;
    if (pricingState === "unknown") pricingState = model.pricing_state;
    else if (model.pricing_state !== "unknown" && model.pricing_state !== pricingState)
      throw new Error(`Pricing compilation model ${model.uid} has conflicting states`);
    const facts = new Map(
      [...current.price_facts, ...model.price_facts].map((fact) => [JSON.stringify(fact), fact]),
    );
    const rawFacts = new Map(
      [...current.raw_price_facts, ...model.raw_price_facts].map((fact) => [
        JSON.stringify(fact),
        fact,
      ]),
    );
    const commercialFacts = new Map(
      [...(current.commercial_facts ?? []), ...(model.commercial_facts ?? [])].map((fact) => [
        JSON.stringify(fact),
        fact,
      ]),
    );
    const pricingInputs = new Map(
      [...(current.pricing_inputs ?? []), ...(model.pricing_inputs ?? [])].map((fact) => [
        JSON.stringify(fact),
        fact,
      ]),
    );
    byUid.set(model.uid, {
      ...current,
      pricing_state: pricingState,
      price_facts: [...facts]
        .sort(([left], [right]) => compareUtf8(left, right))
        .map(([, fact]) => fact),
      raw_price_facts: [...rawFacts]
        .sort(([left], [right]) => compareUtf8(left, right))
        .map(([, fact]) => fact),
      ...(commercialFacts.size === 0
        ? {}
        : {
            commercial_facts: [...commercialFacts]
              .sort(([left], [right]) => compareUtf8(left, right))
              .map(([, fact]) => fact),
          }),
      ...(pricingInputs.size === 0
        ? {}
        : {
            pricing_inputs: [...pricingInputs]
              .sort(([left], [right]) => compareUtf8(left, right))
              .map(([, fact]) => fact),
          }),
    });
  }
  return [...byUid.values()].sort((left, right) => compareUtf8(left.uid, right.uid));
}

export function capturePricingReplaySources(
  sources: readonly ParsedPricingSource[],
  sourceRecords: readonly SourceRecord[],
): PricingReplaySource[] | undefined {
  const dependencies = sources.filter(({ source }) => isPricingDependencySource(source));
  if (
    dependencies.length === 0 ||
    dependencies.some(({ source }) => source.access !== "public" || source.auth !== undefined)
  )
    return undefined;

  const records = new Map(sourceRecords.map((source) => [source.id, source]));
  return dependencies
    .map(({ source, models }) => {
      const record = records.get(source.id);
      if (record === undefined)
        throw new Error(`Pricing compilation source record ${source.id} is missing`);
      if (models.some(({ provider_id }) => provider_id !== record.provider_id))
        throw new Error(`Pricing compilation source ${source.id} has mixed provider ownership`);
      if (
        models.some(
          ({ price_facts, raw_price_facts, commercial_facts }) =>
            price_facts.some(({ source_ref }) => source_ref !== source.id) ||
            raw_price_facts.some(({ source_ref }) => source_ref !== source.id) ||
            (commercial_facts ?? []).some(({ price_facts: rates, raw_price_facts: raw }) =>
              [...rates, ...raw].some(({ source_ref }) => source_ref !== source.id),
            ),
        )
      )
        throw new Error(`Pricing compilation source ${source.id} has mismatched provenance`);
      return pricingReplaySourceSchema.parse({
        source_id: source.id,
        extractor_version: source.extractorVersion,
        content_hash: record.content_hash,
        models: replayModels(models),
      });
    })
    .sort((left, right) => compareUtf8(left.source_id, right.source_id));
}

export function createPricingCompilationSnapshot(
  candidate: CatalogPairCandidate,
  providers: readonly PricingReplayProvider[],
): PricingCompilationSnapshot {
  const snapshot = pricingCompilationSnapshotSchema.parse({
    schema_version: 1,
    core_catalog_version: candidate.pricing.core_catalog_version,
    core_data_sha256: candidate.pricing.core_data_sha256,
    providers: [...providers].sort((left, right) =>
      compareUtf8(left.provider_id, right.provider_id),
    ),
  });
  validateCompilationBinding(snapshot, candidate);
  return snapshot;
}

export async function readPricingCompilationSnapshot(
  candidate: CatalogPairCandidate,
  path = pricingCompilationPath,
): Promise<PricingCompilationSnapshot | undefined> {
  let compressed: Uint8Array;
  try {
    compressed = await readFile(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
  if (compressed.byteLength > pricingLimits.pricingInputBytes)
    throw new Error("Compressed pricing compilation input exceeds its byte limit");
  const decoded = gunzipSync(compressed, { maxOutputLength: pricingLimits.pricingInputBytes });
  const snapshot = pricingCompilationSnapshotSchema.parse(
    assertCanonicalJson(decoded, pricingLimits.pricingInputBytes),
  );
  validateCompilationBinding(snapshot, candidate);
  return snapshot;
}

export async function writePricingCompilationSnapshot(
  snapshot: PricingCompilationSnapshot,
  path = pricingCompilationPath,
): Promise<void> {
  const parsed = pricingCompilationSnapshotSchema.parse(snapshot);
  await atomicWrite(path, gzipSync(canonicalJsonBytes(parsed)));
}

export async function compilePricingSnapshot(
  current: CatalogPairCandidate,
  snapshot: PricingCompilationSnapshot,
  providerManifests: readonly ProviderManifest[] = manifests,
): Promise<PricingCompilationResult> {
  validateCompilationBinding(snapshot, current);
  if (snapshot.providers.length === 0)
    return {
      candidate: current,
      replayedProviders: [],
      preservedProviders: current.pricing.data.provider_snapshots.map(
        ({ provider_id }) => provider_id,
      ),
    };
  const modelOwners = new Map(
    current.catalog.models.map(({ uid, provider_id }) => [uid, provider_id]),
  );
  const modelProvider = (modelRef: string): string => {
    const providerId = modelOwners.get(modelRef);
    if (providerId === undefined)
      throw new Error(`Pricing model ${modelRef} is not in the catalog`);
    return providerId;
  };
  const manifestByProvider = new Map(
    providerManifests.map((manifest) => [manifest.provider.id, manifest]),
  );
  const replayByProvider = new Map(
    snapshot.providers.map((provider) => [provider.provider_id, provider]),
  );
  const partitions = new Map<string, ProviderPricingPartition>();
  const tasks: CompilationTask[] = [];
  const replayedProviders: string[] = [];
  const preservedProviders: string[] = [];

  for (const providerSnapshot of current.pricing.data.provider_snapshots) {
    const providerId = providerSnapshot.provider_id;
    const replay = replayByProvider.get(providerId);
    const manifest = manifestByProvider.get(providerId);
    if (manifest === undefined) throw new Error(`Pricing provider ${providerId} is not configured`);
    if (replay === undefined || !replayUsesCurrentExtractors(replay, manifest)) {
      const partition = providerPartition(current.pricing.data, providerId, modelProvider);
      if (partition === undefined)
        throw new Error(`Pricing provider ${providerId} has no accepted partition`);
      partitions.set(providerId, partition);
      preservedProviders.push(providerId);
      continue;
    }

    tasks.push({
      providerId,
      snapshot: providerSnapshot,
      sources: replaySources(replay, manifest, providerSnapshot, current),
      models: replayPublishedModels(
        replay,
        current.catalog.models.filter(({ provider_id }) => provider_id === providerId),
      ),
      categoricalLabels: manifest.pricingCategoricalLabels,
    });
    replayedProviders.push(providerId);
  }

  for (const partition of await compileProviderPricing(
    tasks
      .map((task) => ({ task, weight: compilationWeight(task) }))
      .sort((left, right) => right.weight - left.weight)
      .map(({ task }) => task),
  ))
    partitions.set(partition.snapshot.provider_id, partition);

  const pricing = pricingCatalogFromPartitions(
    current.pricing.data.provider_snapshots.map(({ provider_id }) => {
      const partition = partitions.get(provider_id);
      if (partition === undefined)
        throw new Error(`Pricing provider ${provider_id} has no compiled partition`);
      return partition;
    }),
  );
  return {
    candidate: await prepareCatalogPairInParallel(current.catalog, pricing),
    replayedProviders,
    preservedProviders,
  };
}

function replayPublishedModels(
  replay: PricingReplayProvider,
  catalogModels: readonly PublishedPricingModel[],
): PublishedPricingModel[] {
  const models = new Map(catalogModels.map((model) => [model.uid, model]));
  for (const source of replay.sources)
    for (const model of source.models) {
      const current = models.get(model.uid);
      if (current === undefined) continue;
      models.set(model.uid, {
        model_id: model.model_id,
        uid: model.uid,
        name: current.name,
        ...(model.version === undefined ? {} : { version: model.version }),
        ...(model.api_endpoints === undefined ? {} : { api_endpoints: model.api_endpoints }),
        capabilities: model.capabilities,
        modalities: current.modalities,
        ...(model.service_families === undefined
          ? {}
          : { service_families: model.service_families }),
        status: model.status,
        tasks: model.tasks,
      });
    }
  return [...models.values()].sort((left, right) => compareUtf8(left.uid, right.uid));
}

function compilationWeight(task: CompilationTask): number {
  return task.sources.reduce(
    (weight, { models }) =>
      weight +
      models.reduce(
        (modelWeight, model) =>
          modelWeight +
          1 +
          model.price_facts.length +
          model.raw_price_facts.length +
          (model.commercial_facts?.reduce(
            (commercialWeight, fact) =>
              commercialWeight + 1 + fact.price_facts.length + fact.raw_price_facts.length,
            0,
          ) ?? 0),
        0,
      ),
    task.models.length,
  );
}

async function compileProviderPricing(
  tasks: readonly CompilationTask[],
): Promise<ProviderPricingPartition[]> {
  return runWorkerPool(
    tasks,
    new URL("./pricing-compilation-worker.ts", import.meta.url),
    compilationResult,
  );
}

function compilationResult(message: unknown, task: CompilationTask): ProviderPricingPartition {
  if (!isCompilationTaskResult(message) || message.providerId !== task.providerId)
    throw new Error("Pricing compilation worker returned an invalid result");
  if ("partition" in message) return message.partition;
  throw new Error(message.error);
}

function isCompilationTaskResult(value: unknown): value is CompilationTaskResult {
  if (
    value === null ||
    typeof value !== "object" ||
    !("providerId" in value) ||
    typeof value.providerId !== "string"
  )
    return false;
  return (
    ("partition" in value && value.partition !== null && typeof value.partition === "object") ||
    ("error" in value && typeof value.error === "string")
  );
}

function replayUsesCurrentExtractors(
  replay: PricingReplayProvider,
  manifest: ProviderManifest,
): boolean {
  const configured = new Map(manifest.sources.map((source) => [source.id, source]));
  return replay.sources.every((source) => {
    const current = configured.get(source.source_id);
    return current === undefined || current.extractorVersion === source.extractor_version;
  });
}

function replaySources(
  replay: PricingReplayProvider,
  manifest: ProviderManifest,
  snapshot: ProviderPricingSnapshot,
  current: CatalogPairCandidate,
): ParsedPricingSource[] {
  const manifestSources = new Map(manifest.sources.map((source) => [source.id, source]));
  const catalogSources = new Map(current.catalog.sources.map((source) => [source.id, source]));
  const replaySourceIds = new Set(replay.sources.map(({ source_id }) => source_id));
  const missingRequired = manifest.sources
    .filter(isRequiredPricingSource)
    .find(({ id }) => !replaySourceIds.has(id));
  if (missingRequired !== undefined)
    throw new Error(`Pricing replay is missing required source ${missingRequired.id}`);

  return replay.sources.map((source) => {
    const configured = manifestSources.get(source.source_id);
    if (configured === undefined || !isPricingDependencySource(configured))
      throw new Error(`Pricing replay source ${source.source_id} is not configured for pricing`);
    if (configured.access !== "public" || configured.auth !== undefined)
      throw new Error(`Pricing replay source ${source.source_id} is not public`);
    if (configured.extractorVersion !== source.extractor_version)
      throw new Error(`Pricing replay source ${source.source_id} uses a stale extractor`);
    const catalogSource = catalogSources.get(source.source_id);
    const hasClaims = source.models.some(
      ({ pricing_state, price_facts, raw_price_facts, commercial_facts, pricing_inputs }) =>
        pricing_state !== "unknown" ||
        price_facts.length > 0 ||
        raw_price_facts.length > 0 ||
        (commercial_facts?.length ?? 0) > 0 ||
        (pricing_inputs?.length ?? 0) > 0,
    );
    if (catalogSource === undefined) {
      if (hasClaims)
        throw new Error(`Pricing replay source ${source.source_id} is absent from the catalog`);
    } else if (
      catalogSource.provider_id !== replay.provider_id ||
      catalogSource.extractor_version !== source.extractor_version ||
      (snapshot.publication === "fresh" && catalogSource.content_hash !== source.content_hash)
    ) {
      throw new Error(`Pricing replay source ${source.source_id} does not match the catalog`);
    }
    return { source: configured, models: source.models };
  });
}

function pricingCatalogFromPartitions(
  partitions: readonly ProviderPricingPartition[],
): PricingCatalog {
  if (partitions.length === 0) return emptyPricingCatalog();
  return {
    provider_vocabularies: partitions
      .map(({ vocabulary }) => vocabulary)
      .sort((left, right) => compareUtf8(left.provider_id, right.provider_id)),
    provider_snapshots: partitions
      .map(({ snapshot }) => snapshot)
      .sort((left, right) => compareUtf8(left.provider_id, right.provider_id)),
    model_dispositions: partitions
      .flatMap(({ model_dispositions }) => model_dispositions)
      .sort((left, right) => compareUtf8(left.model_ref, right.model_ref)),
    books: partitions
      .flatMap(({ books }) => books)
      .sort((left, right) => compareUtf8(left.id, right.id)),
  };
}

function validateCompilationBinding(
  snapshot: PricingCompilationSnapshot,
  candidate: CatalogPairCandidate,
): void {
  if (
    snapshot.core_catalog_version !== candidate.pricing.core_catalog_version ||
    snapshot.core_data_sha256 !== candidate.pricing.core_data_sha256
  )
    throw new Error("Pricing compilation input does not match the accepted catalog core");

  const acceptedProviders = new Set(
    candidate.pricing.data.provider_snapshots.map(({ provider_id }) => provider_id),
  );
  const unexpected = snapshot.providers.find(
    ({ provider_id }) => !acceptedProviders.has(provider_id),
  );
  if (unexpected !== undefined)
    throw new Error(`Pricing compilation provider ${unexpected.provider_id} is not accepted`);
}

function assertSortedUnique<T>(
  values: readonly T[],
  key: (value: T) => string,
  label: string,
  context: z.core.$RefinementCtx,
  path: PropertyKey[] = ["providers"],
): void {
  let previous: string | undefined;
  for (const [index, value] of values.entries()) {
    const current = key(value);
    if (previous !== undefined && compareUtf8(previous, current) >= 0)
      context.addIssue({
        code: "custom",
        path: [...path, index],
        message: `${label} must be sorted and unique`,
      });
    previous = current;
  }
}
