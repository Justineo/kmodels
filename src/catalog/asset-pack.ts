import { promisify } from "node:util";
import { gzip as gzipCallback } from "node:zlib";
import { z } from "zod";
import { canonicalJsonBytes, parseIJson } from "./canonical-json.ts";
import { compareUtf8 } from "./canonical-value.ts";
import { sha256 } from "./io.ts";
import { pricingLimits } from "./pricing-constants.ts";

const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const utf8Decoder = new TextDecoder();
const utf8Encoder = new TextEncoder();
const gzip = promisify(gzipCallback);
const assetProfileSchema = z.enum(["ui", "exports"]);
const assetEntrySchema = z.strictObject({
  file_name: z.string().min(1),
  offset: z.number().int().nonnegative(),
  length: z.number().int().positive(),
  source_length: z.number().int().nonnegative(),
  source_sha256: hashSchema,
  gzip_sha256: hashSchema,
});

export const assetPackManifestSchema = z
  .strictObject({
    schema_version: z.literal(1),
    profile: assetProfileSchema,
    pair_id: hashSchema,
    data_version: hashSchema,
    assets: z.array(assetEntrySchema),
  })
  .superRefine(({ profile, assets }, context) => {
    let previousPath: string | undefined;
    for (const [index, asset] of assets.entries()) {
      if (!validAssetPath(profile, asset.file_name))
        context.addIssue({
          code: "custom",
          path: ["assets", index, "file_name"],
          message: `Invalid ${profile} asset path`,
        });
      if (previousPath !== undefined && compareUtf8(previousPath, asset.file_name) >= 0)
        context.addIssue({
          code: "custom",
          path: ["assets", index, "file_name"],
          message: "Asset paths are not in canonical order",
        });
      previousPath = asset.file_name;
    }
  });

export type AssetPackManifest = z.infer<typeof assetPackManifestSchema>;
export type AssetPackProfile = z.infer<typeof assetProfileSchema>;
export type AssetPackEntry = AssetPackManifest["assets"][number];

export interface AssetSource {
  fileName: string;
  source: string;
}

export interface EncodedAssetPack {
  manifest: AssetPackManifest;
  manifestSource: string;
  pack: Uint8Array;
}

const ASSET_MANIFEST_MAX_BYTES = 1024 * 1024;
const ASSET_SOURCE_MAX_BYTES: Record<AssetPackProfile, number> = {
  ui: pricingLimits.coreInputBytes,
  exports: pricingLimits.pricingInputBytes,
};
const CANONICAL_GZIP_OS = 3;
const GZIP_OS_OFFSET = 9;
const PACK_MAX_BYTES: Record<AssetPackProfile, number> = {
  ui: 16 * 1024 * 1024,
  exports: 32 * 1024 * 1024,
};

export async function createAssetPack(
  profile: AssetPackProfile,
  pairId: string,
  dataVersion: string,
  sourceAssets: AssetSource[],
): Promise<EncodedAssetPack> {
  const assets = [...sourceAssets].sort((left, right) =>
    compareUtf8(left.fileName, right.fileName),
  );
  const chunks = await Promise.all(
    assets.map(async ({ fileName, source }) => {
      const sourceBytes = utf8Encoder.encode(source);
      if (sourceBytes.byteLength > ASSET_SOURCE_MAX_BYTES[profile])
        throw new Error(`${fileName} exceeds the decoded asset limit`);
      const chunk = await gzip(sourceBytes);
      // Asset hashes must not depend on zlib's host-specific gzip metadata.
      chunk[GZIP_OS_OFFSET] = CANONICAL_GZIP_OS;
      return {
        fileName,
        chunk,
        sourceLength: sourceBytes.byteLength,
        sourceHash: sha256(sourceBytes),
        gzipHash: sha256(chunk),
      };
    }),
  );
  let offset = 0;
  const manifest = assetPackManifestSchema.parse({
    schema_version: 1,
    profile,
    pair_id: pairId,
    data_version: dataVersion,
    assets: chunks.map(({ fileName, chunk, sourceLength, sourceHash, gzipHash }) => {
      const entry = {
        file_name: fileName,
        offset,
        length: chunk.byteLength,
        source_length: sourceLength,
        source_sha256: sourceHash,
        gzip_sha256: gzipHash,
      };
      offset += chunk.byteLength;
      return entry;
    }),
  });
  if (offset > PACK_MAX_BYTES[profile])
    throw new Error(`${profile} asset pack exceeds its encoded-input limit`);
  const pack = Buffer.concat(chunks.map(({ chunk }) => chunk));
  return {
    manifest,
    manifestSource: utf8Decoder.decode(canonicalJsonBytes(manifest)),
    pack,
  };
}

export function decodeAssetPackManifest(input: Uint8Array): AssetPackManifest {
  return assetPackManifestSchema.parse(parseIJson(input, ASSET_MANIFEST_MAX_BYTES));
}

export function validateAssetPack(manifest: AssetPackManifest, pack: Uint8Array): void {
  if (pack.byteLength > PACK_MAX_BYTES[manifest.profile])
    throw new Error(`${manifest.profile} asset pack exceeds its encoded-input limit`);
  let offset = 0;
  for (const asset of manifest.assets) {
    if (asset.offset !== offset) throw new Error("Asset pack has a non-contiguous index");
    const encoded = pack.subarray(asset.offset, asset.offset + asset.length);
    if (encoded.byteLength !== asset.length)
      throw new Error(`${asset.file_name} extends beyond the asset pack`);
    if (sha256(encoded) !== asset.gzip_sha256)
      throw new Error(`${asset.file_name} does not match its encoded hash`);
    offset += asset.length;
  }
  if (offset !== pack.byteLength) throw new Error("Asset pack length does not match its manifest");
}

export function decodeAssetPack(
  profile: AssetPackProfile,
  manifestBytes: Uint8Array,
  pack: Uint8Array,
): EncodedAssetPack {
  const manifest = decodeAssetPackManifest(manifestBytes);
  if (manifest.profile !== profile)
    throw new Error(`Expected a ${profile} asset manifest, received ${manifest.profile}`);
  validateAssetPack(manifest, pack);
  return {
    manifest,
    manifestSource: utf8Decoder.decode(manifestBytes),
    pack,
  };
}

export function compressedAsset(pack: Uint8Array, entry: AssetPackEntry): Uint8Array {
  return pack.subarray(entry.offset, entry.offset + entry.length);
}

function validAssetPath(profile: AssetPackProfile, path: string): boolean {
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  )
    return false;
  if (profile === "ui") return /^ui\/.+\.json$/u.test(path);
  return /^(?:catalog|pricing|providers)\/.+\.json$/u.test(path);
}
