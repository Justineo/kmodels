// Adopts stored capability statements that predate "usable options only": removes unsupported
// prompt-cache modes and effort `unsupported_values`, then rebinds the pair identities derived
// from the catalog core. Pricing data, inference rules and replay inputs are unchanged.
import assert from "node:assert/strict";
import { constants, copyFile, mkdir, readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { gunzipSync } from "node:zlib";
import { stableJson, sha256 } from "../src/catalog/io.ts";
import { coreCatalogVersion } from "../src/catalog/pricing-pair-transition.ts";
import {
  createPricingCompilationSnapshot,
  pricingCompilationPath,
  pricingCompilationSnapshotSchema,
  writePricingCompilationSnapshot,
} from "../src/catalog/pricing-compilation.ts";
import { pricingCatalogEnvelopeSchema } from "../src/catalog/pricing-schema.ts";
import {
  commitCatalogPair,
  prepareCatalogPair,
  readPricingMirrorSource,
} from "../src/catalog/pricing-publication.ts";
import { catalogSchema, migrateCatalogStorage } from "../src/catalog/schema.ts";
import { inferencePriceMappingSchema } from "../src/pricing/inference-schema.ts";

const raw: unknown = JSON.parse(await readFile("data/catalog.json", "utf8"));
const { before, groups: beforeGroups } = storedCatalog(raw);
const migrated = catalogSchema.parse(migrateCatalogStorage(raw));
const providers = migrated.providers.map((provider) => {
  const models = migrated.models.filter(({ provider_id }) => provider_id === provider.id);
  // Same derivation as collection: a provider version hashes its stored models.
  return { ...provider, catalog_version: models.length ? sha256(stableJson(models)) : undefined };
});
const catalog = catalogSchema.parse({
  ...migrated,
  providers,
  catalog_version: coreCatalogVersion(providers),
});
assert.deepEqual(withoutCapabilityState(catalog), withoutCapabilityState(before), "Core changed");
for (const [index, model] of catalog.models.entries())
  for (const group of model.capability_details ?? []) {
    const old = beforeGroups[index]?.find(
      ({ source_ref, claim }) => source_ref === group.source_ref && claim === group.claim,
    );
    assert.ok(old, `New capability group ${model.uid}/${group.claim}`);
    assert.deepEqual(group.evidence, old.evidence, `Evidence changed ${model.uid}/${group.claim}`);
  }

const pricing = pricingCatalogEnvelopeSchema.parse(JSON.parse(await readPricingMirrorSource()));
const inference = inferencePriceMappingSchema.parse(
  JSON.parse(await readFile("data/inference-pricing.json", "utf8")),
);
assert.equal(inference.core_catalog_version, before.catalog_version, "Inference is not bound");
assert.equal(inference.pricing_data_version, pricing.pricing_data_version, "Inference is stale");
const next = prepareCatalogPair(catalog, pricing.data, {
  ...inference,
  core_catalog_version: catalog.catalog_version,
});
assert.equal(next.pricing.pricing_data_version, pricing.pricing_data_version, "Pricing changed");
const replay = pricingCompilationSnapshotSchema.parse(
  JSON.parse(gunzipSync(await readFile(pricingCompilationPath)).toString("utf8")),
);
assert.equal(replay.core_catalog_version, before.catalog_version, "Replay input is not bound");
const rebound = createPricingCompilationSnapshot(next, replay.providers);

const changed = providers.filter(
  (provider, index) => !isDeepStrictEqual(provider, before.providers[index]),
);
console.log(
  "Catalog",
  before.catalog_version,
  "->",
  catalog.catalog_version,
  "providers",
  changed.map(({ id }) => id).join(", ") || "none",
);
if (process.argv.includes("--write")) {
  const backup = "capability-statements.local/before";
  await mkdir(backup, { recursive: true });
  for (const name of [
    "catalog.json",
    "pricing.json.gz",
    "inference-pricing.json",
    "pricing-inputs.json.gz",
  ])
    await copyFile(`data/${name}`, `${backup}/${name}`, constants.COPYFILE_EXCL);
  await commitCatalogPair(next);
  await writePricingCompilationSnapshot(rebound);
  console.log("Adopted pair", next.pairId, "and rebuilt projections; no sources fetched.");
} else console.log("Dry run; pass --write to adopt.");

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * The stored catalog before migration. Capability details are set aside because their retired
 * statement fields no longer parse; their group keys and evidence are kept for comparison.
 */
function storedCatalog(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.models)) throw new Error("Malformed catalog");
  const models: unknown[] = value.models;
  const before = catalogSchema.parse({
    ...value,
    models: models.map((model) => {
      if (!isRecord(model)) return model;
      const { capability_details: _details, ...rest } = model;
      return rest;
    }),
  });
  const groups = models.map((model) =>
    isRecord(model) && Array.isArray(model.capability_details)
      ? model.capability_details.flatMap((group: unknown) =>
          isRecord(group) && typeof group.source_ref === "string" && typeof group.claim === "string"
            ? [{ source_ref: group.source_ref, claim: group.claim, evidence: group.evidence }]
            : [],
        )
      : [],
  );
  return { before, groups };
}

function withoutCapabilityState(value: {
  catalog_version: string;
  providers: readonly object[];
  models: readonly object[];
}) {
  return {
    ...value,
    catalog_version: undefined,
    providers: value.providers.map((provider) => ({ ...provider, catalog_version: undefined })),
    models: value.models.map((model) => ({ ...model, capability_details: undefined })),
  };
}
