import { promisify } from "node:util";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import { createGzip, gzip as gzipCallback } from "node:zlib";
import { z } from "zod";
import { canonicalJsonBytes, parseIJson } from "./canonical-json.ts";
import { compareUtf8 } from "./canonical-value.ts";
import { sha256 } from "./io.ts";
import { pricingLimits } from "./pricing-constants.ts";
import { mapConcurrent } from "./concurrency.ts";

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

interface ChunkedAssetSource {
  fileName: string;
  sourceChunks: readonly string[];
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
  sourceAssets: (AssetSource | ChunkedAssetSource)[],
): Promise<EncodedAssetPack> {
  const assets = [...sourceAssets].sort((left, right) =>
    compareUtf8(left.fileName, right.fileName),
  );
  // Encode only active jobs rather than retaining a UTF-8 copy for every queued
  // compression. Four jobs match the default libuv worker pool.
  const chunks = await mapConcurrent(assets, 4, async (asset) => {
    const { fileName } = asset;
    let chunk: Buffer;
    let sourceLength: number;
    let sourceHash: string;
    if ("sourceChunks" in asset) {
      ({ chunk, sourceLength, sourceHash } = await compressChunks(
        asset,
        ASSET_SOURCE_MAX_BYTES[profile],
      ));
    } else {
      if (Buffer.byteLength(asset.source) > ASSET_SOURCE_MAX_BYTES[profile])
        throw new Error(`${fileName} exceeds the decoded asset limit`);
      const sourceBytes = utf8Encoder.encode(asset.source);
      chunk = await gzip(sourceBytes);
      sourceLength = sourceBytes.byteLength;
      sourceHash = sha256(sourceBytes);
    }
    // Asset hashes must not depend on zlib's host-specific gzip metadata.
    chunk[GZIP_OS_OFFSET] = CANONICAL_GZIP_OS;
    return {
      fileName,
      chunk,
      sourceLength,
      sourceHash,
      gzipHash: sha256(chunk),
    };
  });
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

async function compressChunks({ fileName, sourceChunks }: ChunkedAssetSource, maxBytes: number) {
  const hash = createHash("sha256");
  let sourceLength = 0;
  function* encode() {
    let pending = "";
    for (const chunk of sourceChunks) {
      const source = pending + chunk;
      const last = source.charCodeAt(source.length - 1);
      const splitSurrogate = last >= 0xd800 && last <= 0xdbff;
      pending = splitSurrogate ? source.slice(-1) : "";
      const complete = splitSurrogate ? source.slice(0, -1) : source;
      sourceLength += Buffer.byteLength(complete);
      if (sourceLength > maxBytes) throw new Error(`${fileName} exceeds the decoded asset limit`);
      const bytes = utf8Encoder.encode(complete);
      hash.update(bytes);
      yield bytes;
    }
    if (pending !== "") {
      const bytes = utf8Encoder.encode(pending);
      sourceLength += bytes.byteLength;
      if (sourceLength > maxBytes) throw new Error(`${fileName} exceeds the decoded asset limit`);
      hash.update(bytes);
      yield bytes;
    }
  }
  const compressed: Uint8Array[] = [];
  // Backpressure bounds encoded input to the active stream buffers. No flushes
  // between chunks: compression sees exactly the same byte sequence as one buffer.
  await pipeline(Readable.from(encode()), createGzip(), async (output: AsyncIterable<unknown>) => {
    for await (const chunk of output) {
      if (!(chunk instanceof Uint8Array)) throw new Error("Unexpected gzip output");
      compressed.push(chunk);
    }
  });
  return { chunk: Buffer.concat(compressed), sourceLength, sourceHash: hash.digest("hex") };
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
