import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import {
  compressedAsset,
  decodeAssetPack,
  type AssetPackManifest,
  type EncodedAssetPack,
} from "./asset-pack.ts";
import { assertCanonicalJson, canonicalJson, parseIJson } from "./canonical-json.ts";
import { assertIJsonValue, canonicalJsonFromValidated } from "./canonical-value.ts";
import { catalogJson } from "./endpoints.ts";
import { atomicWrite, rootDirectory, sha256, stableJson } from "./io.ts";
import { catalogPairId, type CatalogPairIdentity } from "./pair-identity.ts";
import {
  createPricingCatalogEnvelope,
  createPricingCatalogEnvelopeFromValidatedData,
  decodePricingCatalog,
  pricingCatalogJsonFromValidatedData,
  validatePricingCatalogEnvelope,
  validatePricingCatalogEnvelopeMetadata,
} from "./pricing-envelope.ts";
import { pricingLimits } from "./pricing-constants.ts";
import {
  emptyPricingCatalog,
  pricingCatalogEnvelopeSchema,
  type PricingCatalog,
  type PricingCatalogEnvelope,
} from "./pricing-schema.ts";
import { validatePricingCatalogInParallel } from "./pricing-validation-parallel.ts";
import { validatePricingCatalog } from "./pricing-validation.ts";
import { defaultProjectionPaths, type ProjectionPaths } from "./projection-paths.ts";
import { projectCatalogPair, websiteDataVersion, type PairProjections } from "./projections.ts";
import { catalogSchema, migrateCatalogStorage, type Catalog } from "./schema.ts";

const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const utf8 = new TextEncoder();
const acceptedPairManifestSchema = z.strictObject({
  version: z.literal(1),
  pair_id: hashSchema,
  catalog_asset_sha256: hashSchema,
  pricing_asset_sha256: hashSchema,
});

type AcceptedPairManifest = z.infer<typeof acceptedPairManifestSchema>;

export interface CatalogPairPaths {
  stateDirectory: string;
  catalogMirror: string;
  pricingMirrorGzip: string;
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
}

const defaultCatalogPairPaths: CatalogPairPaths = {
  stateDirectory: join(rootDirectory, "data/.catalog-state"),
  catalogMirror: join(rootDirectory, "data/catalog.json"),
  pricingMirrorGzip: join(rootDirectory, "data/pricing.json.gz"),
  projections: defaultProjectionPaths,
};
const preparedCandidates = new WeakSet<CatalogPairCandidate>();

export function prepareCatalogPair(
  catalog: Catalog,
  pricing: PricingCatalog | PricingCatalogEnvelope,
): CatalogPairCandidate {
  const catalogStorageSource = stableJson(catalogSchema.parse(catalog));
  const parsedCatalog = catalogSchema.parse(JSON.parse(catalogStorageSource));
  assertIJsonValue(parsedCatalog);
  const data = "pricing_data_version" in pricing ? pricing.data : pricing;
  validatePricingCatalog(data, parsedCatalog);
  const canonicalDataSource = canonicalJsonFromValidated(data);
  const canonicalDataHash = sha256(canonicalDataSource);
  const envelope = pricingEnvelope(pricing, parsedCatalog, canonicalDataHash);
  return catalogPairCandidate(parsedCatalog, envelope, catalogStorageSource, canonicalDataSource);
}

export async function prepareCatalogPairInParallel(
  catalog: Catalog,
  pricing: PricingCatalog | PricingCatalogEnvelope,
): Promise<CatalogPairCandidate> {
  const catalogStorageSource = stableJson(catalogSchema.parse(catalog));
  const parsedCatalog = catalogSchema.parse(JSON.parse(catalogStorageSource));
  assertIJsonValue(parsedCatalog);
  const data = "pricing_data_version" in pricing ? pricing.data : pricing;
  const validation = validatePricingCatalogInParallel(data, parsedCatalog);
  const canonicalDataSource = canonicalJsonFromValidated(data);
  const canonicalDataHash = sha256(canonicalDataSource);
  await validation;
  const envelope = pricingEnvelope(pricing, parsedCatalog, canonicalDataHash);
  return catalogPairCandidate(parsedCatalog, envelope, catalogStorageSource, canonicalDataSource);
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
  canonicalDataSource: string,
): CatalogPairCandidate {
  const catalogAssetSource = catalogJson(parsedCatalog);
  const pricingAssetSource = pricingCatalogJsonFromValidatedData(envelope, canonicalDataSource);
  if (
    Buffer.byteLength(catalogStorageSource) > pricingLimits.coreInputBytes ||
    Buffer.byteLength(catalogAssetSource) > pricingLimits.coreInputBytes
  )
    throw new Error("catalog asset exceeds its encoded-input limit");
  if (Buffer.byteLength(pricingAssetSource) > pricingLimits.pricingInputBytes)
    throw new Error("canonical pricing asset exceeds its encoded-input limit");
  const identity = {
    catalog_asset_sha256: sha256(catalogAssetSource),
    pricing_asset_sha256: sha256(pricingAssetSource),
  };
  const candidate = {
    catalog: parsedCatalog,
    pricing: envelope,
    catalogStorageSource,
    catalogAssetSource,
    pricingAssetSource,
    identity,
    pairId: catalogPairId(identity),
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
  if (manifest.pair_id !== catalogPairId(manifest))
    throw new Error("Accepted catalog pair manifest identity is invalid");

  const snapshot = snapshotDirectory(paths, manifest.pair_id);
  const [catalogBytes, catalogAssetBytes, pricingAssetBytes] = await Promise.all([
    readFile(join(snapshot, "catalog.json")),
    readFile(join(snapshot, "catalog-asset.json")),
    readFile(join(snapshot, "pricing.json")),
  ]);
  const catalog = decodeCatalogStorage(catalogBytes);
  const pricing = decodePricingCatalog(pricingAssetBytes, catalog);
  const candidate = prepareCatalogPair(catalog, pricing);
  if (
    candidate.pairId !== manifest.pair_id ||
    candidate.identity.catalog_asset_sha256 !== manifest.catalog_asset_sha256 ||
    candidate.identity.pricing_asset_sha256 !== manifest.pricing_asset_sha256
  )
    throw new Error("Accepted catalog pair snapshot does not match its manifest");
  if (!bytesEqual(catalogAssetBytes, utf8.encode(candidate.catalogAssetSource)))
    throw new Error("Accepted catalog asset bytes do not match the snapshot catalog");
  if (!bytesEqual(pricingAssetBytes, utf8.encode(candidate.pricingAssetSource)))
    throw new Error("Accepted canonical pricing asset bytes do not match the snapshot envelope");

  const projections = await ensurePairProjections(candidate, snapshotProjectionPaths(snapshot));
  await writePairMirrors(candidate, projections, paths);
  return candidate;
}

export async function commitCatalogPair(
  candidate: CatalogPairCandidate,
  paths: CatalogPairPaths = defaultCatalogPairPaths,
): Promise<void> {
  if (!preparedCandidates.has(candidate))
    throw new Error("Catalog pair candidate was not prepared");

  const projections = projectCatalogPair(candidate);
  const snapshot = snapshotDirectory(paths, candidate.pairId);
  await mkdir(snapshot, { recursive: true });
  await Promise.all([
    writeIfChanged(join(snapshot, "catalog.json"), candidate.catalogStorageSource),
    writeIfChanged(join(snapshot, "catalog-asset.json"), candidate.catalogAssetSource),
    writeIfChanged(join(snapshot, "pricing.json"), candidate.pricingAssetSource),
    writePairProjections(snapshotProjectionPaths(snapshot), projections),
  ]);

  const manifest: AcceptedPairManifest = {
    version: 1,
    pair_id: candidate.pairId,
    ...candidate.identity,
  };
  await atomicWrite(manifestPath(paths), canonicalJson(manifest));

  await writePairMirrors(candidate, projections, paths);
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
      : decodePricingCatalogStorage(decompressPricing(pricingBytes), catalog);
  return prepareCatalogPair(catalog, pricing);
}

function decodeCatalogStorage(input: Uint8Array): Catalog {
  return catalogSchema.parse(
    migrateCatalogStorage(parseIJson(input, pricingLimits.coreInputBytes)),
  );
}

function decodePricingCatalogStorage(input: Uint8Array, catalog: Catalog): PricingCatalogEnvelope {
  const envelope = pricingCatalogEnvelopeSchema.parse(
    parseIJson(input, pricingLimits.pricingInputBytes),
  );
  validatePricingCatalogEnvelope(envelope, catalog);
  return envelope;
}

function manifestPath(paths: CatalogPairPaths): string {
  return join(paths.stateDirectory, "current.json");
}

function snapshotDirectory(paths: CatalogPairPaths, id: string): string {
  hashSchema.parse(id);
  return join(paths.stateDirectory, "snapshots", id);
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

  const projections = projectCatalogPair(candidate);
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
  if (
    projections.ui.manifest.data_version !==
    websiteDataVersion(candidate.catalog.catalog_version, candidate.pricing.pricing_data_version)
  )
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
