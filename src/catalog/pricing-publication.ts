import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { z } from "zod";
import {
  compressedAsset,
  decodeAssetPack,
  type AssetPackManifest,
  type EncodedAssetPack,
} from "./asset-pack.ts";
import { assertCanonicalJson, canonicalJson, parseIJson } from "./canonical-json.ts";
import { assertIJsonValue, canonicalJsonChunksFromValidated } from "./canonical-value.ts";
import { catalogJson } from "./endpoints.ts";
import { atomicWrite, rootDirectory, sha256, sha256Chunks, stableJson } from "./io.ts";
import { catalogPairId, type CatalogPairIdentity } from "./pair-identity.ts";
import {
  createPricingCatalogEnvelope,
  createPricingCatalogEnvelopeFromValidatedData,
  pricingCatalogJsonChunks,
  validatePricingCatalogEnvelopeMetadata,
} from "./pricing-envelope.ts";
import { pricingLimits } from "./pricing-constants.ts";
import {
  emptyPricingCatalog,
  pricingBookSchema,
  pricingCatalogSchema,
  pricingCatalogEnvelopeSchema,
  type PricingCatalog,
  type PricingCatalogEnvelope,
} from "./pricing-schema.ts";
import { validatePricingCatalogInParallel } from "./pricing-validation-parallel.ts";
import { validatePricingCatalog } from "./pricing-validation.ts";
import { defaultProjectionPaths, type ProjectionPaths } from "./projection-paths.ts";
import { projectCatalogPair, pairWebsiteDataVersion, type PairProjections } from "./projections.ts";
import { catalogSchema, migrateCatalogStorage, type Catalog } from "./schema.ts";
import {
  createV2PublicationFromValidatedPair,
  v2PairId,
  type V2Publication,
} from "./publication-v2.ts";
import { pricingV2EnvelopeSchema, type InvocationPricingBinding } from "./publication-v2-schema.ts";

const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const utf8 = new TextEncoder();
const legacyAcceptedPairManifestSchema = z.strictObject({
  version: z.literal(1),
  pair_id: hashSchema,
  catalog_asset_sha256: hashSchema,
  pricing_asset_sha256: hashSchema,
});
const acceptedPairManifestSchema = z.union([
  legacyAcceptedPairManifestSchema,
  legacyAcceptedPairManifestSchema.extend({
    version: z.literal(2),
    v2_catalog_asset_sha256: hashSchema,
    v2_pricing_asset_sha256: hashSchema,
  }),
]);

type AcceptedPairManifest = z.infer<typeof acceptedPairManifestSchema>;

export interface CatalogPairPaths {
  stateDirectory: string;
  catalogMirror: string;
  pricingMirrorGzip: string;
  pricingV2MirrorGzip: string;
  projections: ProjectionPaths;
}

export type { CatalogPairIdentity } from "./pair-identity.ts";

export interface CatalogPairCandidate {
  catalog: Catalog;
  pricing: PricingCatalogEnvelope;
  catalogStorageSource: string;
  catalogAssetSource: string;
  pricingAssetSource: string;
  identity: CatalogPairIdentity;
  pairId: string;
  v2?: V2Publication;
}

const defaultCatalogPairPaths: CatalogPairPaths = {
  stateDirectory: join(rootDirectory, "data/.catalog-state"),
  catalogMirror: join(rootDirectory, "data/catalog.json"),
  pricingMirrorGzip: join(rootDirectory, "data/pricing.json.gz"),
  pricingV2MirrorGzip: join(rootDirectory, "data/pricing-v2.json.gz"),
  projections: defaultProjectionPaths,
};
const preparedCandidates = new WeakSet<CatalogPairCandidate>();
const pricingHeaderSchema = pricingCatalogSchema.extend({ books: z.array(z.unknown()) });

export function prepareCatalogPair(
  catalog: Catalog,
  pricing: PricingCatalog | PricingCatalogEnvelope,
  invocationBindings: readonly InvocationPricingBinding[] = [],
): CatalogPairCandidate {
  const catalogStorageSource = stableJson(catalogSchema.parse(catalog));
  const parsedCatalog = catalogSchema.parse(JSON.parse(catalogStorageSource));
  assertIJsonValue(parsedCatalog);
  const data = pricingData(pricing);
  validatePricingCatalog(data, parsedCatalog);
  const canonicalDataChunks = canonicalJsonChunksFromValidated(data);
  const canonicalDataHash = sha256Chunks(canonicalDataChunks);
  const envelope = pricingEnvelope(pricing, parsedCatalog, canonicalDataHash);
  return catalogPairCandidate(
    parsedCatalog,
    envelope,
    catalogStorageSource,
    canonicalDataChunks,
    invocationBindings,
  );
}

export async function prepareCatalogPairInParallel(
  catalog: Catalog,
  pricing: PricingCatalog | PricingCatalogEnvelope,
  invocationBindings: readonly InvocationPricingBinding[] = [],
): Promise<CatalogPairCandidate> {
  const catalogStorageSource = stableJson(catalogSchema.parse(catalog));
  const parsedCatalog = catalogSchema.parse(JSON.parse(catalogStorageSource));
  assertIJsonValue(parsedCatalog);
  const data = pricingData(pricing);
  const validation = validatePricingCatalogInParallel(data, parsedCatalog);
  const canonicalDataChunks = canonicalJsonChunksFromValidated(data);
  const canonicalDataHash = sha256Chunks(canonicalDataChunks);
  await validation;
  const envelope = pricingEnvelope(pricing, parsedCatalog, canonicalDataHash);
  return catalogPairCandidate(
    parsedCatalog,
    envelope,
    catalogStorageSource,
    canonicalDataChunks,
    invocationBindings,
  );
}

function pricingData(pricing: PricingCatalog | PricingCatalogEnvelope): PricingCatalog {
  const data = "pricing_data_version" in pricing ? pricing.data : pricing;
  // Keep Zod's temporary deep clones bounded to one book. Global semantic
  // validation still sees the complete graph before publication freezes it.
  const header = pricingHeaderSchema.parse(data);
  for (const [index, book] of header.books.entries()) {
    const parsed = pricingBookSchema.safeParse(book);
    if (!parsed.success)
      throw new z.ZodError(
        parsed.error.issues.map((issue) => ({
          ...issue,
          path: ["books", index, ...issue.path],
        })),
      );
  }
  return data;
}

function pricingEnvelope(
  pricing: PricingCatalog | PricingCatalogEnvelope,
  catalog: Catalog,
  canonicalDataHash: string,
): PricingCatalogEnvelope {
  if (!("pricing_data_version" in pricing))
    return createPricingCatalogEnvelopeFromValidatedData(pricing, catalog, canonicalDataHash);
  validatePricingCatalogEnvelopeMetadata(pricing, catalog, canonicalDataHash);
  return pricing;
}

function catalogPairCandidate(
  parsedCatalog: Catalog,
  envelope: PricingCatalogEnvelope,
  catalogStorageSource: string,
  canonicalDataChunks: readonly string[],
  invocationBindings: readonly InvocationPricingBinding[],
): CatalogPairCandidate {
  const catalogAssetSource = catalogJson(parsedCatalog);
  const pricingChunks = pricingCatalogJsonChunks(envelope, canonicalDataChunks);
  // Keep the full source as a rope; joining the chunks or passing the source to
  // Buffer.byteLength would flatten a catalog-sized string. Measure and hash chunks.
  let pricingAssetSource = "";
  let pricingBytes = 0;
  for (const chunk of pricingChunks) {
    pricingAssetSource += chunk;
    pricingBytes += Buffer.byteLength(chunk);
  }
  if (
    Buffer.byteLength(catalogStorageSource) > pricingLimits.coreInputBytes ||
    Buffer.byteLength(catalogAssetSource) > pricingLimits.coreInputBytes
  )
    throw new Error("catalog asset exceeds its encoded-input limit");
  if (pricingBytes > pricingLimits.pricingInputBytes)
    throw new Error("canonical pricing asset exceeds its encoded-input limit");
  const identity = {
    catalog_asset_sha256: sha256(catalogAssetSource),
    pricing_asset_sha256: sha256Chunks(pricingChunks),
  };
  if (parsedCatalog.invocation === undefined && invocationBindings.length > 0)
    throw new Error("Invocation pricing requires an invocation catalog");
  const v2 =
    parsedCatalog.invocation === undefined
      ? undefined
      : createV2PublicationFromValidatedPair(parsedCatalog, envelope, invocationBindings);
  const candidate = {
    catalog: parsedCatalog,
    pricing: envelope,
    catalogStorageSource,
    catalogAssetSource,
    pricingAssetSource,
    identity,
    pairId: v2?.pairId ?? catalogPairId(identity),
    ...(v2 === undefined ? {} : { v2 }),
  };
  deepFreeze(candidate);
  preparedCandidates.add(candidate);
  return candidate;
}

export async function recoverCatalogPair(
  paths: CatalogPairPaths = defaultCatalogPairPaths,
): Promise<CatalogPairCandidate | undefined> {
  const manifestBytes = await optionalRead(manifestPath(paths));
  if (manifestBytes === undefined) {
    const candidate = await readCatalogPairMirrors(paths);
    if (candidate === undefined) return undefined;
    await ensurePairProjections(candidate, paths.projections);
    return candidate;
  }

  const manifest = acceptedPairManifestSchema.parse(
    assertCanonicalJson(manifestBytes, pricingLimits.semanticStringBytes * 4),
  );
  if (
    manifest.pair_id !==
    (manifest.version === 1
      ? catalogPairId(manifest)
      : v2PairId(manifest.v2_catalog_asset_sha256, manifest.v2_pricing_asset_sha256))
  )
    throw new Error("Accepted catalog pair manifest identity is invalid");

  const snapshot = snapshotDirectory(paths, manifest.pair_id);
  const [catalogBytes, catalogAssetBytes, pricingAssetBytes] = await Promise.all([
    readFile(join(snapshot, "catalog.json")),
    readFile(join(snapshot, "catalog-asset.json")),
    readFile(join(snapshot, "pricing.json")),
  ]);
  const catalog = decodeCatalogStorage(catalogBytes);
  const pricing = decodePricingCatalogStorage(pricingAssetBytes);
  const v2Source =
    manifest.version === 1 ? undefined : await readFile(join(snapshot, "pricing-v2.json"));
  const v2Pricing =
    v2Source === undefined
      ? undefined
      : pricingV2EnvelopeSchema.parse(
          assertCanonicalJson(v2Source, pricingLimits.pricingInputBytes),
        );
  const candidate = await prepareCatalogPairInParallel(
    catalog,
    pricing,
    v2Pricing?.data.invocation_bindings,
  );
  if (
    candidate.pairId !== manifest.pair_id ||
    candidate.identity.catalog_asset_sha256 !== manifest.catalog_asset_sha256 ||
    candidate.identity.pricing_asset_sha256 !== manifest.pricing_asset_sha256
  )
    throw new Error("Accepted catalog pair snapshot does not match its manifest");
  if (
    manifest.version === 2 &&
    (candidate.v2 === undefined ||
      sha256(candidate.v2.catalogSource) !== manifest.v2_catalog_asset_sha256 ||
      sha256(candidate.v2.pricingSource) !== manifest.v2_pricing_asset_sha256 ||
      v2Source === undefined ||
      !bytesEqual(v2Source, utf8.encode(candidate.v2.pricingSource)))
  )
    throw new Error("Accepted v2 assets do not match their snapshot manifest");
  if (!bytesEqual(catalogAssetBytes, utf8.encode(candidate.catalogAssetSource)))
    throw new Error("Accepted catalog asset bytes do not match the snapshot catalog");
  if (!bytesEqual(pricingAssetBytes, utf8.encode(candidate.pricingAssetSource)))
    throw new Error("Accepted canonical pricing asset bytes do not match the snapshot envelope");

  const projections = await ensurePairProjections(candidate, snapshotProjectionPaths(snapshot));
  await writePairMirrors(candidate, projections, paths);
  await pruneSnapshots(paths, candidate.pairId);
  return candidate;
}

export async function commitCatalogPair(
  candidate: CatalogPairCandidate,
  paths: CatalogPairPaths = defaultCatalogPairPaths,
): Promise<void> {
  if (!preparedCandidates.has(candidate))
    throw new Error("Catalog pair candidate was not prepared");

  const projections = await projectCatalogPair(candidate);
  const snapshot = snapshotDirectory(paths, candidate.pairId);
  await mkdir(snapshot, { recursive: true });
  await Promise.all([
    writeIfChanged(join(snapshot, "catalog.json"), candidate.catalogStorageSource),
    writeIfChanged(join(snapshot, "catalog-asset.json"), candidate.catalogAssetSource),
    writeIfChanged(join(snapshot, "pricing.json"), candidate.pricingAssetSource),
    ...(candidate.v2 === undefined
      ? []
      : [writeIfChanged(join(snapshot, "pricing-v2.json"), candidate.v2.pricingSource)]),
    writePairProjections(snapshotProjectionPaths(snapshot), projections),
  ]);

  const manifest: AcceptedPairManifest = {
    ...(candidate.v2 === undefined
      ? { version: 1 as const }
      : {
          version: 2 as const,
          v2_catalog_asset_sha256: sha256(candidate.v2.catalogSource),
          v2_pricing_asset_sha256: sha256(candidate.v2.pricingSource),
        }),
    pair_id: candidate.pairId,
    ...candidate.identity,
  };
  await atomicWrite(manifestPath(paths), canonicalJson(manifest));

  await writePairMirrors(candidate, projections, paths);
  await pruneSnapshots(paths, candidate.pairId);
}

export async function readCatalogPairMirrors(
  paths: CatalogPairPaths = defaultCatalogPairPaths,
): Promise<CatalogPairCandidate | undefined> {
  const catalogBytes = await optionalRead(paths.catalogMirror);
  if (catalogBytes === undefined) return undefined;
  const catalog = decodeCatalogStorage(catalogBytes);
  const pricingBytes = await optionalRead(paths.pricingMirrorGzip);
  const pricing =
    pricingBytes === undefined
      ? createPricingCatalogEnvelope(emptyPricingCatalog(), catalog)
      : decodePricingCatalogStorage(decompressPricing(pricingBytes));
  const v2Bytes = await optionalRead(paths.pricingV2MirrorGzip);
  const v2Pricing =
    v2Bytes === undefined
      ? undefined
      : pricingV2EnvelopeSchema.parse(
          assertCanonicalJson(decompressPricing(v2Bytes), pricingLimits.pricingInputBytes),
        );
  if (catalog.invocation === undefined && v2Pricing !== undefined)
    throw new Error("V2 pricing mirror has no matching invocation catalog");
  if (catalog.invocation !== undefined && v2Pricing === undefined)
    throw new Error("Invocation catalog is missing its v2 pricing mirror");
  const candidate = await prepareCatalogPairInParallel(
    catalog,
    pricing,
    v2Pricing?.data.invocation_bindings,
  );
  if (v2Pricing !== undefined && candidate.v2?.pricingSource !== canonicalJson(v2Pricing))
    throw new Error("V2 pricing mirror does not match the accepted catalog");
  return candidate;
}

function decodeCatalogStorage(input: Uint8Array): Catalog {
  return catalogSchema.parse(
    migrateCatalogStorage(parseIJson(input, pricingLimits.coreInputBytes)),
  );
}

function decodePricingCatalogStorage(input: Uint8Array): PricingCatalogEnvelope {
  return pricingCatalogEnvelopeSchema.parse(parseIJson(input, pricingLimits.pricingInputBytes));
}

function manifestPath(paths: CatalogPairPaths): string {
  return join(paths.stateDirectory, "current.json");
}

function snapshotDirectory(paths: CatalogPairPaths, id: string): string {
  hashSchema.parse(id);
  return join(paths.stateDirectory, "snapshots", id);
}

async function pruneSnapshots(paths: CatalogPairPaths, currentPairId: string): Promise<void> {
  const directory = join(paths.stateDirectory, "snapshots");
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          entry.name !== currentPairId &&
          hashSchema.safeParse(entry.name).success,
      )
      .map((entry) => rm(join(directory, entry.name), { recursive: true })),
  );
}

async function optionalRead(path: string): Promise<Uint8Array | undefined> {
  try {
    return await readFile(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function writeIfChanged(path: string, source: string): Promise<void> {
  await writeBytesIfChanged(path, utf8.encode(source));
}

async function writeBytesIfChanged(path: string, source: Uint8Array): Promise<void> {
  const current = await optionalRead(path);
  if (current !== undefined && bytesEqual(current, source)) return;
  await atomicWrite(path, source);
}

async function ensurePairProjections(
  candidate: CatalogPairCandidate,
  paths: ProjectionPaths,
): Promise<PairProjections> {
  const [uiManifestBytes, uiPack, exportManifestBytes, exportPack] = await Promise.all([
    optionalRead(paths.uiManifest),
    optionalRead(paths.uiPack),
    optionalRead(paths.exportManifest),
    optionalRead(paths.exportPack),
  ]);
  if (
    uiManifestBytes !== undefined &&
    uiPack !== undefined &&
    exportManifestBytes !== undefined &&
    exportPack !== undefined
  )
    try {
      const projections = {
        ui: decodeAssetPack("ui", uiManifestBytes, uiPack),
        exports: decodeAssetPack("exports", exportManifestBytes, exportPack),
      };
      validatePairProjections(projections, candidate);
      return projections;
    } catch {
      // Derived assets are regenerated from the authoritative accepted pair below.
    }

  const projections = await projectCatalogPair(candidate);
  await writePairProjections(paths, projections);
  return projections;
}

async function writePairMirrors(
  candidate: CatalogPairCandidate,
  projections: PairProjections,
  paths: CatalogPairPaths,
): Promise<void> {
  await Promise.all([
    writeIfChanged(paths.catalogMirror, candidate.catalogStorageSource),
    writeBytesIfChanged(paths.pricingMirrorGzip, compressedPricingProjection(projections.exports)),
    candidate.v2 === undefined
      ? rm(paths.pricingV2MirrorGzip, { force: true })
      : writeBytesIfChanged(paths.pricingV2MirrorGzip, gzipSync(candidate.v2.pricingSource)),
    writePairProjections(paths.projections, projections),
  ]);
}

async function writePairProjections(
  paths: ProjectionPaths,
  projections: PairProjections,
): Promise<void> {
  await Promise.all([
    writeIfChanged(paths.uiManifest, projections.ui.manifestSource),
    writeBytesIfChanged(paths.uiPack, projections.ui.pack),
    writeIfChanged(paths.exportManifest, projections.exports.manifestSource),
    writeBytesIfChanged(paths.exportPack, projections.exports.pack),
  ]);
}

function snapshotProjectionPaths(snapshot: string): ProjectionPaths {
  return {
    uiManifest: join(snapshot, "website-assets.json"),
    uiPack: join(snapshot, "website-assets.pack"),
    exportManifest: join(snapshot, "export-assets.json"),
    exportPack: join(snapshot, "export-assets.pack"),
  };
}

function validatePairProjections(
  projections: PairProjections,
  candidate: CatalogPairCandidate,
): void {
  if (
    projections.ui.manifest.pair_id !== candidate.pairId ||
    projections.exports.manifest.pair_id !== candidate.pairId
  )
    throw new Error("Projection assets do not match the accepted catalog pair");
  if (projections.ui.manifest.data_version !== pairWebsiteDataVersion(candidate))
    throw new Error("UI assets have an invalid data version");
  if (projections.exports.manifest.data_version !== candidate.pairId)
    throw new Error("Export assets have an invalid data version");
  const catalog = projectionEntry(projections.exports.manifest, "catalog/index.json");
  const pricing = projectionEntry(projections.exports.manifest, "pricing/index.json");
  if (
    catalog.source_sha256 !== candidate.identity.catalog_asset_sha256 ||
    pricing.source_sha256 !== candidate.identity.pricing_asset_sha256
  )
    throw new Error("Canonical export assets do not match the accepted catalog pair");
  if (
    candidate.v2 !== undefined &&
    (projectionEntry(projections.exports.manifest, "catalog/v2/index.json").source_sha256 !==
      sha256(candidate.v2.catalogSource) ||
      projectionEntry(projections.exports.manifest, "pricing/v2/index.json").source_sha256 !==
        sha256(candidate.v2.pricingSource))
  )
    throw new Error("Canonical v2 exports do not match the accepted catalog pair");
}

function compressedPricingProjection(projections: EncodedAssetPack): Uint8Array {
  return compressedAsset(
    projections.pack,
    projectionEntry(projections.manifest, "pricing/index.json"),
  );
}

function projectionEntry(manifest: AssetPackManifest, fileName: string) {
  const entry = manifest.assets.find(({ file_name }) => file_name === fileName);
  if (entry === undefined) throw new Error(`Projection assets are missing ${fileName}`);
  return entry;
}

function decompressPricing(source: Uint8Array): Uint8Array {
  if (source.byteLength > pricingLimits.pricingInputBytes)
    throw new Error("compressed pricing mirror exceeds its encoded-input limit");
  return gunzipSync(source, { maxOutputLength: pricingLimits.pricingInputBytes });
}

export async function readPricingMirrorSource(
  path = defaultCatalogPairPaths.pricingMirrorGzip,
): Promise<string> {
  return new TextDecoder().decode(decompressPricing(await readFile(path)));
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const item of Object.values(value)) deepFreeze(item);
}
