import { execFileSync } from "node:child_process";
import { readFile, mkdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";
import { z } from "zod";
import { atomicWrite, sha256 } from "../src/catalog/io.ts";

const repository = "Justineo/kmodels";
const releaseTag = "catalog-snapshots";
const transitionTag = "catalog-pre-cutover-audit";
const pointerFile = "catalog-snapshot.json";
const markerFile = ".catalog-hydrated";
const maxBytes = 128 * 1024 * 1024;
const retentionSeconds = 7 * 24 * 60 * 60;
export const snapshotFiles = [
  "catalog.json",
  "export-assets.json",
  "export-assets.pack",
  "fetch-state.json",
  "inference-pricing.json",
  "pricing-inputs.json.gz",
  "pricing.json.gz",
  "quarantine.json",
  "refresh-summary.json",
  "website-assets.json",
  "website-assets.pack",
] as const;
const optionalFile = "inference-pricing.json";
const magic = Buffer.from("KMS1");
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.number().int().min(1_000_000_000).max(9_999_999_999);
const pointerSchema = z.strictObject({
  version: z.literal(1),
  captured_at: timestamp,
  sha256: hash,
  bytes: z.number().int().positive().max(maxBytes),
});
const assetSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  digest: z.string().nullish(),
  size: z.number().int().nonnegative(),
  state: z.string(),
});
type Pointer = z.infer<typeof pointerSchema>;

function assetName(pointer: Pointer): string {
  return `catalog-${pointer.captured_at}-${pointer.sha256}.pack.gz`;
}

async function optionalRead(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

export async function packSnapshot(directory: string, capturedAt: number) {
  const contents = await Promise.all(
    snapshotFiles.map((name) =>
      name === optionalFile ? optionalRead(join(directory, name)) : readFile(join(directory, name)),
    ),
  );
  const header = Buffer.alloc(magic.length + snapshotFiles.length * 4);
  magic.copy(header);
  let size = header.length;
  for (const [index, content] of contents.entries()) {
    if (!content?.length && snapshotFiles[index] !== optionalFile)
      throw new Error(`Empty catalog snapshot member: ${snapshotFiles[index]}`);
    header.writeUInt32BE(content?.length ?? 0, magic.length + index * 4);
    size += content?.length ?? 0;
  }
  if (size > maxBytes) throw new Error("Catalog snapshot exceeds its decoded size limit");
  const archive = gzipSync(
    Buffer.concat([header, ...contents.filter((file) => file !== undefined)]),
  );
  const pointer = pointerSchema.parse({
    version: 1,
    captured_at: capturedAt,
    sha256: sha256(archive),
    bytes: archive.length,
  });
  return { archive, pointer };
}

export async function restoreSnapshot(directory: string, input: unknown, archive: Buffer) {
  const pointer = pointerSchema.parse(input);
  if (archive.length !== pointer.bytes || sha256(archive) !== pointer.sha256)
    throw new Error("Catalog snapshot does not match the checked-out pointer");
  const decoded = gunzipSync(archive, { maxOutputLength: maxBytes });
  const headerBytes = magic.length + snapshotFiles.length * 4;
  if (decoded.length < headerBytes || !decoded.subarray(0, magic.length).equals(magic))
    throw new Error("Unrecognized catalog snapshot");
  let offset = headerBytes;
  const contents = snapshotFiles.map((name, index) => {
    const bytes = decoded.readUInt32BE(magic.length + index * 4);
    if (offset + bytes > decoded.length || (bytes === 0 && name !== optionalFile))
      throw new Error(`Invalid catalog snapshot member: ${name}`);
    const content = decoded.subarray(offset, offset + bytes);
    offset += bytes;
    return { name, content };
  });
  if (offset !== decoded.length) throw new Error("Unexpected trailing catalog snapshot bytes");
  await mkdir(directory, { recursive: true });
  await rm(join(directory, markerFile), { force: true });
  await rm(join(directory, ".catalog-state"), { recursive: true, force: true });
  for (const { name, content } of contents) {
    const path = join(directory, name);
    if (content.length === 0) await rm(path, { force: true });
    else await atomicWrite(path, content);
  }
  await atomicWrite(join(directory, markerFile), pointer.sha256);
}

async function readPointer(path: string): Promise<Pointer> {
  return pointerSchema.parse(JSON.parse(await readFile(path, "utf8")));
}

export async function snapshotFingerprint(directory: string): Promise<string> {
  const pointer = await readPointer(join(directory, pointerFile));
  const marker = await optionalRead(join(directory, markerFile));
  if (marker?.toString() !== pointer.sha256)
    throw new Error("Hydrated catalog snapshot does not match the checked-out pointer");
  const members = await Promise.all(
    snapshotFiles.map(async (name) => {
      const contents = await optionalRead(join(directory, name));
      if (contents === undefined && name !== optionalFile)
        throw new Error(`Hydrated catalog snapshot is missing ${name}`);
      return contents === undefined ? null : sha256(contents);
    }),
  );
  return sha256(JSON.stringify([pointer, members]));
}

async function downloadSnapshot(pointer: Pointer): Promise<Buffer> {
  const url = `https://github.com/${repository}/releases/download/${releaseTag}/${assetName(pointer)}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body)
    throw new Error(`Catalog snapshot download failed with HTTP ${response.status}`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > pointer.bytes) {
      await reader.cancel();
      throw new Error("Catalog snapshot download exceeded its expected size");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, size);
}

function gh(...args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
}

function releaseAssets() {
  const release = z
    .object({ id: z.number().int().positive() })
    .parse(JSON.parse(gh("api", `repos/${repository}/releases/tags/${releaseTag}`)));
  return z
    .array(z.array(assetSchema))
    .parse(
      JSON.parse(
        gh(
          "api",
          "--paginate",
          "--slurp",
          `repos/${repository}/releases/${release.id}/assets?per_page=100`,
        ),
      ),
    )
    .flat();
}

export function expiredAssets(
  assets: ReadonlyArray<{ id: number; name: string }>,
  current: string,
  now: number,
): number[] {
  return assets.flatMap(({ id, name }) => {
    const capture = /^catalog-(\d{10})-[a-f0-9]{64}\.pack\.gz$/.exec(name)?.[1];
    return capture !== undefined && name !== current && Number(capture) < now - retentionSeconds
      ? [id]
      : [];
  });
}

function pruneTransitionAudit(now: number) {
  const ref = `refs/tags/${transitionTag}`;
  const refs = z
    .array(
      z.object({
        ref: z.string(),
        object: z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/), type: z.string() }),
      }),
    )
    .parse(JSON.parse(gh("api", `repos/${repository}/git/matching-refs/tags/${transitionTag}`)));
  const tag = refs.find((entry) => entry.ref === ref);
  if (tag === undefined) return;
  if (tag.object.type !== "tag") throw new Error("Transition audit must be an annotated tag");
  const details = z
    .object({
      tagger: z.object({ date: z.iso.datetime({ offset: true }) }),
    })
    .parse(JSON.parse(gh("api", `repos/${repository}/git/tags/${tag.object.sha}`)));
  if (Date.parse(details.tagger.date) / 1000 < now - retentionSeconds)
    gh("api", "--method", "DELETE", `repos/${repository}/git/refs/tags/${transitionTag}`);
}

async function publish(directory: string, output: string, capturedAt: number) {
  const { archive, pointer } = await packSnapshot(directory, capturedAt);
  await publishArchive(archive, pointer, output);
}

export async function stageSnapshot(directory: string, output: string, capturedAt: number) {
  const { archive, pointer } = await packSnapshot(directory, capturedAt);
  await mkdir(output, { recursive: true });
  await atomicWrite(join(output, "snapshot.pack.gz"), archive);
  await atomicWrite(join(output, pointerFile), `${JSON.stringify(pointer, null, 2)}\n`);
}

async function stagedSnapshot(input: string) {
  const pointer = await readPointer(join(input, pointerFile));
  const archive = await readFile(join(input, "snapshot.pack.gz"));
  if (archive.length !== pointer.bytes || sha256(archive) !== pointer.sha256)
    throw new Error("Staged catalog snapshot does not match its pointer");
  return { archive, pointer };
}

export async function restoreStagedSnapshot(input: string, directory: string) {
  const { archive, pointer } = await stagedSnapshot(input);
  await restoreSnapshot(directory, pointer, archive);
  await atomicWrite(join(directory, pointerFile), `${JSON.stringify(pointer, null, 2)}\n`);
}

export async function publishStagedSnapshot(input: string, output: string) {
  const { archive, pointer } = await stagedSnapshot(input);
  await publishArchive(archive, pointer, output);
}

async function publishArchive(archive: Buffer, pointer: Pointer, output: string) {
  const name = assetName(pointer);
  await mkdir(output, { recursive: true });
  const path = join(output, name);
  await atomicWrite(path, archive);
  let asset = releaseAssets().find((entry) => entry.name === name);
  if (asset === undefined) {
    gh("release", "upload", releaseTag, path, "--repo", repository);
    asset = releaseAssets().find((entry) => entry.name === name);
  }
  if (
    asset?.digest !== `sha256:${pointer.sha256}` ||
    asset.size !== pointer.bytes ||
    asset.state !== "uploaded"
  )
    throw new Error("Uploaded catalog snapshot does not match its expected digest and size");
  await atomicWrite(join(output, pointerFile), `${JSON.stringify(pointer, null, 2)}\n`);
}

async function main() {
  const [command, argument, capture, source] = process.argv.slice(2);
  const directory = resolve("data");
  const now = Math.floor(Date.now() / 1000);
  if (command === "stage" && argument !== undefined) {
    await stageSnapshot(directory, resolve(argument), now);
    return;
  }
  if (command === "restore" && argument !== undefined) {
    await restoreStagedSnapshot(resolve(argument), directory);
    return;
  }
  if (command === "publish-staged" && argument !== undefined && capture !== undefined) {
    await publishStagedSnapshot(resolve(argument), resolve(capture));
    return;
  }
  if (command === "fingerprint") {
    console.log(await snapshotFingerprint(directory));
    return;
  }
  if (command === "hydrate") {
    const pointer = await readPointer(join(directory, pointerFile));
    const marker = await optionalRead(join(directory, markerFile));
    if (marker?.toString() === pointer.sha256 && argument !== "--force") {
      const complete = await Promise.all(
        snapshotFiles
          .filter((name) => name !== optionalFile)
          .map((name) =>
            stat(join(directory, name)).then(
              (entry) => entry.isFile(),
              () => false,
            ),
          ),
      );
      if (complete.every(Boolean)) return;
    }
    const archive =
      argument && argument !== "--force"
        ? await readFile(argument)
        : await downloadSnapshot(pointer);
    await restoreSnapshot(directory, pointer, archive);
    return;
  }
  if (command === "publish" && argument !== undefined) {
    await publish(
      resolve(source ?? directory),
      resolve(argument),
      capture === undefined ? now : Number(capture),
    );
    return;
  }
  if (command === "prune") {
    const pointer = await readPointer(join(directory, pointerFile));
    const assets = releaseAssets();
    const current = assetName(pointer);
    if (
      !assets.some(
        (asset) =>
          asset.name === current &&
          asset.digest === `sha256:${pointer.sha256}` &&
          asset.size === pointer.bytes &&
          asset.state === "uploaded",
      )
    )
      throw new Error("Current catalog snapshot is missing or invalid; refusing to prune");
    for (const id of expiredAssets(assets, current, now))
      gh("api", "--method", "DELETE", `repos/${repository}/releases/assets/${id}`);
    pruneTransitionAudit(now);
    return;
  }
  throw new Error(
    "Usage: catalog-snapshot hydrate [--force | archive] | fingerprint | stage OUTPUT | restore INPUT | publish-staged INPUT OUTPUT | publish OUTPUT [EPOCH [DATA_DIR]] | prune",
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
