import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, rm, writeFile, type FileHandle } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const rootDirectory = fileURLToPath(new URL("../../", import.meta.url));

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256Chunks(chunks: Iterable<string | Uint8Array>): string {
  const hash = createHash("sha256");
  for (const chunk of chunks) hash.update(chunk);
  return hash.digest("hex");
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

export function stableJson(value: unknown): string {
  return `${JSON.stringify(canonical(value), null, 2)}\n`;
}

export function stableCompactJson(value: unknown): string {
  return JSON.stringify(canonical(value));
}

export async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

export async function atomicWrite(
  path: string,
  contents: string | Uint8Array | Iterable<Uint8Array>,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, contents);
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

// Canonical serialization emits complete JSON tokens, never a split surrogate pair.
export function* encodeCanonicalChunks(chunks: readonly string[]): Generator<Uint8Array> {
  const encoder = new TextEncoder();
  for (const chunk of chunks) yield encoder.encode(chunk);
}

export async function writeCanonicalChunksIfChanged(
  path: string,
  chunks: readonly string[],
): Promise<void> {
  if (await fileMatchesCanonicalChunks(path, chunks)) return;
  await atomicWrite(path, encodeCanonicalChunks(chunks));
}

async function fileMatchesCanonicalChunks(
  path: string,
  chunks: readonly string[],
): Promise<boolean> {
  let file;
  try {
    file = await open(path, "r");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
  try {
    return await fileHandleMatchesCanonicalChunks(file, chunks);
  } finally {
    await file.close();
  }
}

// The caller owns the handle. Positional reads compare the original opened file
// from byte zero, independently of its current cursor or later path replacement.
export async function fileHandleMatchesCanonicalChunks(
  file: FileHandle,
  chunks: readonly string[],
): Promise<boolean> {
  const byteLength = chunks.reduce((sum, chunk) => sum + Buffer.byteLength(chunk), 0);
  if ((await file.stat()).size !== byteLength) return false;
  const buffer = Buffer.allocUnsafe(65_536);
  let position = 0;
  for (const chunk of encodeCanonicalChunks(chunks)) {
    let offset = 0;
    while (offset < chunk.byteLength) {
      const { bytesRead } = await file.read(
        buffer,
        0,
        Math.min(buffer.length, chunk.byteLength - offset),
        position,
      );
      if (
        bytesRead === 0 ||
        Buffer.compare(
          buffer.subarray(0, bytesRead),
          chunk.subarray(offset, offset + bytesRead),
        ) !== 0
      )
        return false;
      offset += bytesRead;
      position += bytesRead;
    }
  }
  return (await file.read(buffer, 0, 1, position)).bytesRead === 0;
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await atomicWrite(path, stableJson(value));
}
