import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { calculationCoverage } from "../src/catalog/pricing-calculation-coverage.ts";
import {
  createCalculator,
  createInferencePriceLookup,
  inferencePriceMappingSchema,
  validatePriceData,
} from "../src/pricing/index.ts";

const directory = join(import.meta.dirname, "../dist/pricing/calculation");
async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(join(directory, file), "utf8"));
}

const index = validatePriceData(await readJson("index.json"));
assert.deepEqual(await readJson("coverage.json"), calculationCoverage(index));
const inference = await readJson("../inference.json").then(
  (value) => inferencePriceMappingSchema.parse(value),
  (error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  },
);
const providerIds = new Set(index.providers.map(({ snapshot }) => snapshot.provider_id));
assert(
  (inference?.rules ?? []).every(({ provider_id }) => providerIds.has(provider_id)),
  "Inference mappings reference absent calculation partitions",
);
const summary = new Map<string, Record<string, number>>();
const inferenceGaps: Array<{
  providerId: string;
  modelId: string;
  outcome: string;
  reasons: string[];
}> = [];
let inferenceIds = 0;
for (const provider of index.providers) {
  const providerId = provider.snapshot.provider_id;
  const partition = await readJson(`providers/${providerId}.json`);
  assert.deepEqual(partition, { ...index, providers: [provider] });
  createCalculator(partition);
  if (inference === undefined) continue;
  const rules = inference.rules.filter(({ provider_id }) => provider_id === providerId);
  if (rules.length === 0) continue;
  const lookup = createInferencePriceLookup(partition, {
    ...inference,
    rules,
    sources: inference.sources.filter(({ provider_id }) => provider_id === providerId),
  });
  const counts: Record<string, number> = {};
  for (const modelId of new Set(rules.map(({ model_id }) => model_id))) {
    inferenceIds++;
    const result = lookup({ provider_id: providerId, model_id: modelId });
    const reasons = new Set(
      result.candidates.flatMap(({ gaps }) =>
        gaps
          .filter(({ code }) => result.reason !== undefined || code !== "outside_validity")
          .map(({ code, reason }) => reason ?? code),
      ),
    );
    if (result.reason === undefined && reasons.size === 0) continue;
    const outcome = result.reason ?? result.status;
    counts[outcome] = (counts[outcome] ?? 0) + 1;
    inferenceGaps.push({ providerId, modelId, outcome, reasons: [...reasons] });
  }
  if (Object.keys(counts).length > 0) summary.set(providerId, counts);
}
console.log(
  `Verified built calculation index, coverage and ${index.providers.length} usable provider partitions.`,
);
if (inference !== undefined) {
  console.log(
    `Replayed ${inferenceIds} mapped inference IDs. Review signals by provider: ${JSON.stringify(Object.fromEntries(summary))}`,
  );
  if (process.argv.includes("--list-inference-gaps"))
    for (const entry of inferenceGaps) console.log(JSON.stringify(entry));
}
