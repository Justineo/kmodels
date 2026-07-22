import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const compress = promisify(gzip);
const decompress = promisify(gunzip);

export const rootDirectory = fileURLToPath(new URL("../../", import.meta.url));

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
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

export async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

export async function atomicWrite(path: string, contents: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, contents);
  await rename(temporary, path);
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await atomicWrite(path, stableJson(value));
}

export async function writeSnapshot(path: string, body: string): Promise<void> {
  try {
    await access(path);
  } catch {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, await compress(body, { level: 9 }));
  }
}

export async function readSnapshot(path: string): Promise<string> {
  return (await decompress(await readFile(path))).toString("utf8");
}
