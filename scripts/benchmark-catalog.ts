import { execFileSync } from "node:child_process";
import { readCatalogPairMirrors } from "../src/catalog/pricing-publication.ts";
import {
  compilePricingSnapshot,
  readPricingCompilationSnapshot,
} from "../src/catalog/pricing-compilation.ts";
import { projectCatalogPair } from "../src/catalog/projections.ts";
import { sha256 } from "../src/catalog/io.ts";

// Read-only offline replay. Run each sample in a fresh process; maxRSS is the process
// high-water mark (including worker threads), not a per-stage allocation delta.
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

console.log(
  JSON.stringify({
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    implementation_diff_sha256: sha256(execFileSync("git", ["diff", "HEAD", "--", "src"])),
  }),
);
const pair = await measure("read_validate_pair", () => readCatalogPairMirrors());
if (pair === undefined)
  throw new Error("No local catalog pair; hydrate the checked-out snapshot first");
console.log(
  JSON.stringify({
    input_pair_id: pair.pairId,
    providers: pair.catalog.providers.map(({ id }) => id),
    // Reading length does not flatten the publication's rope string. Computing
    // UTF-8 bytes here would change the allocation profile being measured.
    pricing_utf16_units: pair.pricingAssetSource.length,
  }),
);
const replay = await measure("read_validate_replay", () => readPricingCompilationSnapshot(pair));
if (replay === undefined) throw new Error("No bound pricing replay input");
const compiled = await measure("compile_validate_prepare", () =>
  compilePricingSnapshot(pair, replay),
);
console.log(
  JSON.stringify({
    output_pair_id: compiled.candidate.pairId,
    reused_pricing_graph: compiled.candidate.pricing === pair.pricing,
    reused_books: compiled.candidate.pricing.data.books.filter((book) =>
      pair.pricing.data.books.includes(book),
    ).length,
    replayed: compiled.replayedProviders,
    preserved: compiled.preservedProviders,
    replay_failures: compiled.replayFailures,
  }),
);
const projections = await measure("project_encode_compress", () =>
  projectCatalogPair(compiled.candidate),
);
for (const profile of ["ui", "exports"] as const) {
  const output = projections[profile];
  console.log(
    JSON.stringify({
      profile,
      pack_bytes: output.pack.byteLength,
      decoded_bytes: output.manifest.assets.reduce(
        (total, asset) => total + asset.source_length,
        0,
      ),
      pack_sha256: sha256(output.pack),
      manifest_sha256: sha256(output.manifestSource),
    }),
  );
}
