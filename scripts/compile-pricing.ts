import {
  compilePricingSnapshot,
  readPricingCompilationSnapshot,
} from "../src/catalog/pricing-compilation.ts";
import { commitCatalogPair, recoverCatalogPair } from "../src/catalog/pricing-publication.ts";

const pair = await recoverCatalogPair();
if (pair === undefined) throw new Error("No accepted catalog pair is available");

const input = await readPricingCompilationSnapshot(pair);
if (input === undefined) throw new Error("No pricing compilation input is available");

const result = compilePricingSnapshot(pair, input);
if (result.replayedProviders.length > 0) await commitCatalogPair(result.candidate);
console.log(
  [
    `${result.replayedProviders.length === 0 ? "Canonical pricing unchanged at" : "Compiled canonical pricing for"} pair ${result.candidate.pairId.slice(0, 12)}`,
    `${result.replayedProviders.length} replayed`,
    `${result.preservedProviders.length} preserved`,
  ].join("; "),
);
