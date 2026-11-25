import {
  compilePricingSnapshot,
  readPricingCompilationSnapshot,
} from "../src/catalog/pricing-compilation.ts";
import { commitCatalogPair, readCatalogPairMirrors } from "../src/catalog/pricing-publication.ts";

const pair = await readCatalogPairMirrors();
if (pair === undefined) throw new Error("No checked-out catalog pair is available");

const input = await readPricingCompilationSnapshot(pair);
if (input === undefined) throw new Error("No pricing compilation input is available");

const result = await compilePricingSnapshot(pair, input);
for (const failure of result.replayFailures)
  console.warn(`Preserved ${failure.provider_id} accepted pricing: ${failure.reason}`);
const changed = result.replayedProviders.length > 0 || result.candidate.pairId !== pair.pairId;
if (changed) await commitCatalogPair(result.candidate);
console.log(
  [
    `${!changed ? "Canonical pricing unchanged at" : "Compiled canonical pricing for"} pair ${result.candidate.pairId.slice(0, 12)}`,
    `${result.replayedProviders.length} replayed`,
    `${result.preservedProviders.length} preserved`,
  ].join("; "),
);
