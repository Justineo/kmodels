import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import type { SourceManifest } from "./manifests.ts";
import type { ProviderModel } from "./schema.ts";
import { sha256 } from "./io.ts";

export interface ReplayCaptureContext {
  catalog_models?: readonly ProviderModel[];
  previous_catalog_models?: readonly ProviderModel[];
  previous_retail_meters?: readonly string[];
}

let capturedBytes = 0;
/** Capture public bytes before parsing; authenticated bodies never enter repair artifacts. */
export async function captureRepairSource(
  source: SourceManifest,
  body: string,
  observedAt: string,
  replayContext?: readonly ProviderModel[] | ReplayCaptureContext,
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
  const isReplayArray = (
    value: readonly ProviderModel[] | ReplayCaptureContext,
  ): value is readonly ProviderModel[] => Array.isArray(value);
  const hasContext =
    replayContext !== undefined &&
    (isReplayArray(replayContext)
      ? replayContext.length > 0
      : (replayContext.catalog_models?.length ?? 0) > 0 ||
        (replayContext.previous_catalog_models?.length ?? 0) > 0 ||
        (replayContext.previous_retail_meters?.length ?? 0) > 0);
  if (included && hasContext) {
    const contextJson = JSON.stringify(replayContext);
    const contextBytes = Buffer.byteLength(contextJson);
    if (contextBytes <= 32 * 1024 * 1024 && capturedBytes + contextBytes <= 256 * 1024 * 1024) {
      capturedBytes += contextBytes;
      await writeFile(
        join(directory, `${source.id}-${hash}.context.json.gz`),
        gzipSync(contextJson),
        { flag: "wx" },
      ).catch((error: unknown) => {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      });
    }
  }
}
