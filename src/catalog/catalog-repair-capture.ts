import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import type { SourceManifest } from "./manifests.ts";
import { sha256 } from "./io.ts";

let capturedBytes = 0;
/** Capture public bytes before parsing; authenticated bodies never enter repair artifacts. */
export async function captureRepairSource(
  source: SourceManifest,
  body: string,
  observedAt: string,
): Promise<void> {
  const directory = process.env.KMODELS_REPAIR_CAPTURE_DIRECTORY;
  if (!directory || source.access !== "public" || source.auth) return;
  if (!/^[a-z0-9-]+$/.test(source.id)) throw new Error("Invalid evidence source ID");
  const bytes = Buffer.byteLength(body);
  const hash = sha256(body);
  const encodedBytes = Buffer.byteLength(JSON.stringify(body));
  const included =
    encodedBytes <= 32 * 1024 * 1024 && capturedBytes + encodedBytes <= 256 * 1024 * 1024;
  if (included) capturedBytes += encodedBytes;
  const receipt = {
    source_id: source.id,
    scope: "source",
    source_url: source.url,
    observed_at: observedAt,
    source_hash: hash,
    extractor_version: source.extractorVersion,
    ...(included
      ? { body }
      : { omitted: "Public response exceeds repair capture byte budget", bytes }),
  };
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, `${source.id}-${hash}.json.gz`),
    gzipSync(JSON.stringify(receipt)),
    { flag: "wx" },
  ).catch((error: unknown) => {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  });
}
