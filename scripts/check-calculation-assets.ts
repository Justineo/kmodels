import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { calculationCoverage } from "../src/catalog/pricing-calculation-coverage.ts";
import { createCalculator, validatePriceData } from "../src/pricing/index.ts";
import { calculationV2Coverage } from "../src/catalog/pricing-calculator-v2-export.ts";
import { publicationManifestSchema } from "../src/catalog/publication-v2-schema.ts";
import { sha256 } from "../src/catalog/io.ts";
import {
  createCalculator as createV2Calculator,
  validatePriceData as validateV2PriceData,
} from "../src/pricing/v2/index.ts";

export async function verifyCalculationAssets(
  root: string,
): Promise<{ legacyProviders: number; v2Providers?: number }> {
  const directory = join(root, "pricing/calculation");
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

  const manifestSource = await readFile(join(root, "catalog/publication.json"), "utf8").catch(
    (error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
      throw error;
    },
  );
  if (manifestSource !== undefined) {
    const manifest = publicationManifestSchema.parse(JSON.parse(manifestSource));
    const pair = manifest.pairs[1];
    const v2Directory = join(root, "pricing/v2/calculation");
    const v2Index = await validateV2PriceData(
      JSON.parse(await readFile(join(v2Directory, "index.json"), "utf8")),
    );
    assert.equal(v2Index.snapshot.coreCatalogVersion, pair.catalog_version);
    assert.equal(v2Index.snapshot.pricingDataVersion, pair.pricing_data_version);
    assert.equal(v2Index.snapshot.generatedAt, manifest.generated_at);
    assert.equal(
      v2Index.snapshot.pricingAssetSha256,
      sha256(await readFile(join(root, pair.pricing_path))),
    );
    assert.deepEqual(
      JSON.parse(await readFile(join(v2Directory, "coverage.json"), "utf8")),
      calculationV2Coverage(v2Index),
    );
    for (const provider of v2Index.providers) {
      const partition: unknown = JSON.parse(
        await readFile(
          join(v2Directory, `providers/${provider.snapshot.provider_id}.json`),
          "utf8",
        ),
      );
      assert.deepEqual(partition, { ...v2Index, providers: [provider] });
      await createV2Calculator(partition);
    }
    return { legacyProviders: index.providers.length, v2Providers: v2Index.providers.length };
  }

  return { legacyProviders: index.providers.length };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const counts = await verifyCalculationAssets(join(import.meta.dirname, "../dist"));
  console.log(
    `Verified built calculation index, coverage and ${counts.legacyProviders} usable provider partitions.`,
  );
  if (counts.v2Providers !== undefined)
    console.log(
      `Verified built v2 calculation index, coverage and ${counts.v2Providers} usable provider partitions.`,
    );
}
