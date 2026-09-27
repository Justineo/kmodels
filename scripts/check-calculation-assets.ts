import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { calculationCoverage } from "../src/catalog/pricing-calculation-coverage.ts";
import { createCalculator, validatePriceData } from "../src/pricing/index.ts";

const directory = join(import.meta.dirname, "../dist/pricing/calculation");
async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(join(directory, file), "utf8"));
}

const index = validatePriceData(await readJson("index.json"));
assert.deepEqual(await readJson("coverage.json"), calculationCoverage(index));
for (const provider of index.providers) {
  const partition = await readJson(`providers/${provider.snapshot.provider_id}.json`);
  assert.deepEqual(partition, { ...index, providers: [provider] });
  createCalculator(partition);
}
console.log(
  `Verified built calculation index, coverage and ${index.providers.length} usable provider partitions.`,
);
