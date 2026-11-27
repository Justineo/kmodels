import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { priceDataCoverage } from "../src/catalog/pricing-coverage.ts";
import { prepareInferencePriceLookup } from "../src/pricing/inference.ts";
import { inferencePriceMappingSchema } from "../src/pricing/inference-schema.ts";
import { indexValidatedPriceData } from "../src/pricing/snapshot.ts";
import { validatePriceData } from "../src/pricing/validation.ts";

const directory = join(import.meta.dirname, "../dist/pricing/lookup");
async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(join(directory, file), "utf8"));
}

const index = validatePriceData(await readJson("index.json"));
assert(
  isDeepStrictEqual(await readJson("coverage.json"), priceDataCoverage(index)),
  "Built price coverage does not match the validated index",
);
const inference = await readJson("../inference.json").catch((error: unknown) => {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
  throw error;
});
for (const provider of index.providers) {
  const providerId = provider.snapshot.provider_id;
  const partition = await readJson(`providers/${providerId}.json`);
  assert(
    isDeepStrictEqual(partition, { ...index, providers: [provider] }),
    `Built price partition does not match the validated index: ${providerId}`,
  );
}
// Partition equality and global rule validation share the same validated price data.
if (inference !== undefined) {
  const { lookup } = prepareInferencePriceLookup(indexValidatedPriceData(index), inference);
  if (process.argv.includes("--list-inference-gaps")) {
    const { rules } = inferencePriceMappingSchema.parse(inference);
    const seen = new Set<string>();
    for (const { provider_id: providerId, model_id: modelId } of rules) {
      const key = JSON.stringify([providerId, modelId]);
      if (seen.has(key)) continue;
      seen.add(key);
      const result = lookup({ provider_id: providerId, model_id: modelId });
      const reasons = new Set(
        result.candidates.flatMap(({ gaps }) =>
          gaps
            .filter(({ code }) => result.reason !== undefined || code !== "outside_validity")
            .map(({ code, reason }) => reason ?? code),
        ),
      );
      if (result.reason !== undefined || reasons.size > 0)
        console.log(
          JSON.stringify({
            providerId,
            modelId,
            outcome: result.reason ?? result.status,
            reasons: [...reasons],
          }),
        );
    }
  }
}
console.log(
  `Verified built price index, coverage, ${index.providers.length} partitions and inference references.`,
);
