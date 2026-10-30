import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, gunzipSync } from "node:zlib";
import {
  compressedAsset,
  decodeAssetPack,
  type AssetPackEntry,
  type AssetPackManifest,
} from "./asset-pack.ts";
import { catalogPairId } from "./pair-identity.ts";
import { defaultProjectionPaths, type ProjectionPaths } from "./projection-paths.ts";
import { assertCanonicalJson } from "./canonical-json.ts";
import { sha256 } from "./io.ts";
import { publicationManifestSchema } from "./publication-v2-schema.ts";
import { v2PairId } from "./publication-v2.ts";

export interface PublishedAssetProfile {
  manifest: AssetPackManifest;
  pack: Uint8Array;
  packPath: string;
}

export interface PublishedAssets {
  ui: PublishedAssetProfile;
  exports: PublishedAssetProfile;
}

export async function readPublishedAssetProfile(
  profile: "ui" | "exports",
  paths: ProjectionPaths = defaultProjectionPaths,
): Promise<PublishedAssetProfile> {
  const manifestPath = profile === "ui" ? paths.uiManifest : paths.exportManifest;
  const packPath = profile === "ui" ? paths.uiPack : paths.exportPack;
  const [manifestBytes, pack] = await Promise.all([readFile(manifestPath), readFile(packPath)]);
  const { manifest } = decodeAssetPack(profile, manifestBytes, pack);
  if (profile === "exports") validateExportIdentity(manifest, pack);
  return { manifest, pack, packPath };
}

export async function readPublishedAssets(
  paths: ProjectionPaths = defaultProjectionPaths,
): Promise<PublishedAssets> {
  const [ui, exports] = await Promise.all([
    readPublishedAssetProfile("ui", paths),
    readPublishedAssetProfile("exports", paths),
  ]);
  if (ui.manifest.pair_id !== exports.manifest.pair_id)
    throw new Error("UI and export assets do not belong to the same accepted pair");
  return { ui, exports };
}

export function readCompressedProfileAsset(
  published: PublishedAssetProfile,
  path: string,
): Uint8Array | undefined {
  const entry = published.manifest.assets.find(({ file_name }) => `/${file_name}` === path);
  return entry === undefined ? undefined : compressedAsset(published.pack, entry);
}

export async function materializePublishedAssets(
  published: PublishedAssets,
  outputDirectory: string,
): Promise<void> {
  for (const source of [published.ui, published.exports])
    for (const entry of source.manifest.assets) {
      await materializeEntry(source.packPath, entry, outputDirectory);
    }
}

function requiredEntry(manifest: AssetPackManifest, fileName: string): AssetPackEntry {
  const entry = manifest.assets.find(({ file_name }) => file_name === fileName);
  if (entry === undefined) throw new Error(`Published assets are missing ${fileName}`);
  return entry;
}

function validateExportIdentity(manifest: AssetPackManifest, pack: Uint8Array): void {
  if (manifest.data_version !== manifest.pair_id)
    throw new Error("Export assets have an invalid data version");
  const catalog = requiredEntry(manifest, "catalog/index.json");
  const pricing = requiredEntry(manifest, "pricing/index.json");
  const pairId = catalogPairId({
    catalog_asset_sha256: catalog.source_sha256,
    pricing_asset_sha256: pricing.source_sha256,
  });
  const hasV2 = manifest.assets.some(({ file_name }) => file_name.includes("/v2/"));
  if (hasV2) {
    const publicationEntry = requiredEntry(manifest, "catalog/publication.json");
    const source = gunzipSync(compressedAsset(pack, publicationEntry), {
      maxOutputLength: 5_000_000,
    });
    if (
      sha256(source) !== publicationEntry.source_sha256 ||
      source.byteLength !== publicationEntry.source_length
    )
      throw new Error("Publication manifest does not match its asset hash");
    const publication = publicationManifestSchema.parse(assertCanonicalJson(source, 5_000_000));
    const [legacy, current] = publication.pairs;
    const v2Catalog = requiredEntry(manifest, current.catalog_path);
    const v2Pricing = requiredEntry(manifest, current.pricing_path);
    if (
      legacy.pair_id !== pairId ||
      current.pair_id !== v2PairId(v2Catalog.source_sha256, v2Pricing.source_sha256) ||
      current.pair_id !== manifest.pair_id
    )
      throw new Error("Publication manifest mixes incompatible catalog pairs");
    const resources = new Map(
      publication.resources.map((resource) => [resource.path, resource.sha256]),
    );
    if (
      resources.size !== publication.resources.length ||
      resources.size !== manifest.assets.length - 1
    )
      throw new Error("Publication manifest has incomplete or duplicate resources");
    for (const entry of manifest.assets)
      if (entry !== publicationEntry && resources.get(entry.file_name) !== entry.source_sha256)
        throw new Error(`Publication resource hash mismatch: ${entry.file_name}`);
  } else if (pairId !== manifest.pair_id)
    throw new Error("Export assets do not match their accepted-pair identity");
}

async function materializeEntry(
  packPath: string,
  entry: AssetPackEntry,
  outputDirectory: string,
): Promise<void> {
  const outputPath = join(outputDirectory, entry.file_name);
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  const hash = createHash("sha256");
  let sourceLength = 0;
  const verifySource = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      sourceLength += chunk.byteLength;
      callback(undefined, chunk);
    },
  });
  await mkdir(dirname(outputPath), { recursive: true });
  try {
    await pipeline(
      createReadStream(packPath, {
        start: entry.offset,
        end: entry.offset + entry.length - 1,
      }),
      createGunzip(),
      verifySource,
      createWriteStream(temporaryPath),
    );
    if (sourceLength !== entry.source_length)
      throw new Error(`${entry.file_name} does not match its decoded length`);
    if (hash.digest("hex") !== entry.source_sha256)
      throw new Error(`${entry.file_name} does not match its decoded hash`);
    await rename(temporaryPath, outputPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}
