import { join } from "node:path";
import { z } from "zod";
import { sourceIconDirectory, sourceIconIndexPath } from "../source-icon-paths.ts";
import { readJson, rootDirectory, sha256 } from "./io.ts";

export const sourceIconCacheFile = "source-icons.json";
export const sourceIconCachePath = join(rootDirectory, "data", sourceIconCacheFile);
export const maxSourceIconBytes = 128 * 1024;

const originSchema = z.string().refine((value) => {
  const url = URL.parse(value);
  return url?.protocol === "https:" && url.origin === value;
});
const cacheSchema = z.record(originSchema, z.base64().max(Math.ceil(maxSourceIconBytes / 3) * 4));

export function sourceIconFormat(bytes: Buffer): "png" | "ico" | undefined {
  if (bytes.length > maxSourceIconBytes) return undefined;
  if (
    bytes.length >= 45 &&
    bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) &&
    bytes.toString("ascii", 12, 16) === "IHDR" &&
    bytes.subarray(-12).equals(Buffer.from("0000000049454e44ae426082", "hex"))
  )
    return "png";
  if (bytes.length < 22 || bytes.readUInt32LE() !== 0x00010000) return undefined;
  const count = bytes.readUInt16LE(4);
  const directoryEnd = 6 + 16 * count;
  if (count === 0 || directoryEnd >= bytes.length) return undefined;
  for (let entry = 6; entry < directoryEnd; entry += 16) {
    const size = bytes.readUInt32LE(entry + 8);
    const offset = bytes.readUInt32LE(entry + 12);
    if (size === 0 || offset < directoryEnd || offset + size > bytes.length) return undefined;
  }
  return "ico";
}

export async function readSourceIconCache(path = sourceIconCachePath) {
  return cacheSchema.parse((await readJson(path)) ?? {});
}

export async function sourceIconAssets(cachePath = sourceIconCachePath) {
  const assets = new Map<string, Buffer>();
  const index: Record<string, string> = {};
  for (const [origin, base64] of Object.entries(await readSourceIconCache(cachePath))) {
    const bytes = Buffer.from(base64, "base64");
    const format = sourceIconFormat(bytes);
    if (format === undefined) continue;
    const path = `${sourceIconDirectory}${sha256(bytes)}.${format}`;
    assets.set(path, bytes);
    index[origin] = path;
  }
  assets.set(sourceIconIndexPath, Buffer.from(JSON.stringify(index)));
  return assets;
}
