import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { sha256 } from "../src/catalog/io.ts";
import {
  commitCatalogPair,
  readCatalogPairMirrors,
  recoverCatalogPair,
  type CatalogPairPaths,
} from "../src/catalog/pricing-publication.ts";

// Exercise actual publication only in an isolated temporary directory. Never pass
// default paths to commit/recovery, and do not retain the original graph in recovery.
async function measure<T>(stage: string, operation: () => Promise<T>): Promise<T> {
  const started = performance.now();
  const cpu = process.cpuUsage();
  const result = await operation();
  console.log(
    JSON.stringify({
      stage,
      elapsed_ms: performance.now() - started,
      cpu_us: process.cpuUsage(cpu),
      memory_bytes: process.memoryUsage(),
      process_max_rss_bytes: process.resourceUsage().maxRSS * 1024,
    }),
  );
  return result;
}

async function publish(paths: CatalogPairPaths) {
  const pair = await measure("read_validate_pair", () => readCatalogPairMirrors());
  if (pair === undefined) throw new Error("No local catalog pair");
  await measure("project_write_commit", () => commitCatalogPair(pair, paths));
  return {
    pair_id: pair.pairId,
    identity: pair.identity,
    providers: pair.catalog.providers.map(({ id }) => id),
    pricing_providers: pair.pricing.data.provider_snapshots.map(({ provider_id }) => provider_id),
    books: pair.pricing.data.books.length,
  };
}

async function filesIn(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesIn(path)));
    else files.push(path);
  }
  return files.sort();
}

async function fileHash(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    if (!(chunk instanceof Uint8Array)) throw new Error("Unexpected file stream value");
    hash.update(chunk);
  }
  return hash.digest("hex");
}

console.log(
  JSON.stringify({
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    implementation_diff_sha256: sha256(execFileSync("git", ["diff", "HEAD", "--", "src"])),
  }),
);
const directory = await mkdtemp(join(tmpdir(), "kmodels-publication-benchmark-"));
const paths: CatalogPairPaths = {
  stateDirectory: join(directory, "state"),
  catalogMirror: join(directory, "catalog.json"),
  pricingMirrorGzip: join(directory, "pricing.json.gz"),
  inferenceMirror: join(directory, "inference-pricing.json"),
  projections: {
    uiManifest: join(directory, "website-assets.json"),
    uiPack: join(directory, "website-assets.pack"),
    exportManifest: join(directory, "export-assets.json"),
    exportPack: join(directory, "export-assets.pack"),
  },
};
try {
  const accepted = await publish(paths);
  console.log(JSON.stringify(accepted));
  const files = [];
  for (const path of await filesIn(directory))
    files.push({
      path: relative(directory, path),
      bytes: (await stat(path)).size,
      sha256: await fileHash(path),
    });
  console.log(JSON.stringify({ files }));
  const recovered = await measure("recover_validate_compare", () => recoverCatalogPair(paths));
  if (recovered?.pairId !== accepted.pair_id) throw new Error("Recovery changed the accepted pair");
  console.log(
    JSON.stringify({ recovered_pair_id: recovered.pairId, identity: recovered.identity }),
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
