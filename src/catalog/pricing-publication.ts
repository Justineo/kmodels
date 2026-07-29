import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { z } from "zod";
import { assertCanonicalJson, canonicalJson, parseIJson } from "./canonical-json.ts";
import { assertIJsonValue } from "./canonical-value.ts";
import { catalogJson } from "./endpoints.ts";
import { atomicWrite, rootDirectory, sha256, stableJson } from "./io.ts";
import {
  createPricingCatalogEnvelope,
  decodePricingCatalog,
  pricingCatalogJson,
  validatePricingCatalogEnvelope,
} from "./pricing-envelope.ts";
import { pricingLimits } from "./pricing-constants.ts";
import {
  emptyPricingCatalog,
  pricingCatalogEnvelopeSchema,
  type PricingCatalog,
  type PricingCatalogEnvelope,
} from "./pricing-schema.ts";
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
}

export interface CatalogPairIdentity {
  catalog_asset_sha256: string;
  pricing_asset_sha256: string;
}

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
};

export function prepareCatalogPair(
  catalog: Catalog,
  pricing: PricingCatalog | PricingCatalogEnvelope,
): CatalogPairCandidate {
  const catalogStorageSource = stableJson(catalogSchema.parse(catalog));
  const parsedCatalog = catalogSchema.parse(JSON.parse(catalogStorageSource));
  assertIJsonValue(parsedCatalog);
  const envelope =
    "pricing_data_version" in pricing
      ? pricing
      : createPricingCatalogEnvelope(pricing, parsedCatalog);
  const catalogAssetSource = catalogJson(parsedCatalog);
  const pricingAssetSource = pricingCatalogJson(envelope, parsedCatalog);
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
  return {
    catalog: parsedCatalog,
    pricing: envelope,
    catalogStorageSource,
    catalogAssetSource,
    pricingAssetSource,
    identity,
    pairId: pairId(identity),
  };
}

export async function recoverCatalogPair(
  paths: CatalogPairPaths = defaultCatalogPairPaths,
): Promise<CatalogPairCandidate | undefined> {
  const manifestBytes = await optionalRead(manifestPath(paths));
  if (manifestBytes === undefined) return loadMirrors(paths);

  const manifest = acceptedPairManifestSchema.parse(
    assertCanonicalJson(manifestBytes, pricingLimits.semanticStringBytes * 4),
  );
  if (manifest.pair_id !== pairId(manifest))
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

  await Promise.all([
    writeIfChanged(paths.catalogMirror, candidate.catalogStorageSource),
    writePricingMirrorIfChanged(paths.pricingMirrorGzip, candidate.pricingAssetSource),
  ]);
  return candidate;
}

export async function commitCatalogPair(
  candidate: CatalogPairCandidate,
  paths: CatalogPairPaths = defaultCatalogPairPaths,
): Promise<void> {
  const validated = prepareCatalogPair(candidate.catalog, candidate.pricing);
  if (
    validated.pairId !== candidate.pairId ||
    validated.catalogStorageSource !== candidate.catalogStorageSource ||
    validated.catalogAssetSource !== candidate.catalogAssetSource ||
    validated.pricingAssetSource !== candidate.pricingAssetSource
  )
    throw new Error("Catalog pair candidate changed after validation");

  const snapshot = snapshotDirectory(paths, validated.pairId);
  await mkdir(snapshot, { recursive: true });
  await Promise.all([
    writeIfChanged(join(snapshot, "catalog.json"), validated.catalogStorageSource),
    writeIfChanged(join(snapshot, "catalog-asset.json"), validated.catalogAssetSource),
    writeIfChanged(join(snapshot, "pricing.json"), validated.pricingAssetSource),
  ]);

  const manifest: AcceptedPairManifest = {
    version: 1,
    pair_id: validated.pairId,
    ...validated.identity,
  };
  await atomicWrite(manifestPath(paths), canonicalJson(manifest));

  await Promise.all([
    writeIfChanged(paths.catalogMirror, validated.catalogStorageSource),
    writePricingMirrorIfChanged(paths.pricingMirrorGzip, validated.pricingAssetSource),
  ]);
}

async function loadMirrors(paths: CatalogPairPaths): Promise<CatalogPairCandidate | undefined> {
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

function pairId(identity: CatalogPairIdentity): string {
  return sha256(
    canonicalJson({
      catalog_asset_sha256: identity.catalog_asset_sha256,
      pricing_asset_sha256: identity.pricing_asset_sha256,
    }),
  );
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

async function writePricingMirrorIfChanged(path: string, source: string): Promise<void> {
  const sourceBytes = utf8.encode(source);
  const current = await optionalRead(path);
  if (current !== undefined) {
    try {
      if (bytesEqual(decompressPricing(current), sourceBytes)) return;
    } catch {
      // A corrupt mirror is repaired from the accepted snapshot below.
    }
  }
  await atomicWrite(path, compressPricing(source));
}

function compressPricing(source: string): Uint8Array {
  return gzipSync(source);
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
