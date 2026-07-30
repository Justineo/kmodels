import { readFile } from "node:fs/promises";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vite-plus/test";
import { decodeAssetPackManifest, validateAssetPack } from "../src/catalog/asset-pack.ts";
import { websiteAssets } from "../src/catalog/endpoints.ts";
import { baseModel } from "../src/catalog/model.ts";
import { readPricingMirrorSource } from "../src/catalog/pricing-publication.ts";
import { pricingCatalogEnvelopeSchema } from "../src/catalog/pricing-schema.ts";
import { defaultProjectionPaths } from "../src/catalog/projection-paths.ts";
import { websiteDataVersion } from "../src/catalog/projections.ts";
import { catalogSchema, migrateCatalogStorage } from "../src/catalog/schema.ts";
import {
  WEBSITE_DETAIL_CHUNK_MAX_BYTES,
  websiteModelDetail,
  websitePublication,
} from "../src/catalog/website-data.ts";

const auditFields = new Set([
  "atom_contract_hash",
  "compatibility_observations",
  "core_catalog_version",
  "core_data_sha256",
  "core_generated_at",
  "delivery_mode_evidence",
  "derivation",
  "fact_inventory_hash",
  "locator",
  "observations",
  "pricing_version",
  "raw",
  "raw_type",
  "scope_observations",
  "source_refs",
  "task_evidence",
  "term_key",
]);
function foundAuditFields(value: unknown, fields = auditFields): string[] {
  const found = new Set<string>();
  const pending = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    if (current === null || typeof current !== "object") continue;
    for (const [field, item] of Object.entries(current)) {
      if (fields.has(field)) found.add(field);
      pending.push(item);
    }
  }
  return [...found].sort();
}

async function generatedData() {
  const [catalogSource, pricingSource] = await Promise.all([
    readFile(new URL("../data/catalog.json", import.meta.url), "utf8"),
    readPricingMirrorSource(),
  ]);
  return {
    catalog: catalogSchema.parse(migrateCatalogStorage(JSON.parse(catalogSource))),
    pricing: pricingCatalogEnvelopeSchema.parse(JSON.parse(pricingSource)),
  };
}

let generatedPublication: ReturnType<typeof loadGeneratedPublication> | undefined;

async function loadGeneratedPublication() {
  const { catalog, pricing } = await generatedData();
  const dataVersion = websiteDataVersion(catalog.catalog_version, pricing.pricing_data_version);
  return {
    catalog,
    pricing,
    dataVersion,
    publication: websitePublication(catalog, pricing.data, dataVersion),
  };
}

function publicationData() {
  generatedPublication ??= loadGeneratedPublication();
  return generatedPublication;
}

describe("website data", () => {
  it("publishes all core table data in bounded parallel chunks", async () => {
    const { publication, dataVersion } = await publicationData();
    const catalogSource = JSON.stringify(publication.catalog);
    const pricingSource = JSON.stringify(publication.pricing);
    const summary = (providerId: string, modelId: string) => {
      const index = publication.catalog.models.findIndex(
        ({ provider_id, model_id }) => provider_id === providerId && model_id === modelId,
      );
      return publication.pricing.pricing[index];
    };

    expect(Buffer.byteLength(catalogSource)).toBeLessThan(1024 * 1024);
    expect(Buffer.byteLength(pricingSource)).toBeLessThan(1024 * 1024);
    expect(gzipSync(catalogSource).byteLength).toBeLessThan(64 * 1024);
    expect(gzipSync(pricingSource).byteLength).toBeLessThan(32 * 1024);
    expect(foundAuditFields(JSON.parse(catalogSource))).toEqual([]);
    expect(foundAuditFields(JSON.parse(pricingSource))).toEqual([]);
    expect(publication.catalog.models[0]).not.toHaveProperty("uid");
    expect(publication.catalog.models[0]).not.toHaveProperty("pricing");
    expect(publication.catalog.models[0]).not.toHaveProperty("detail_ref");
    expect(publication.catalog.data_version).toBe(dataVersion);
    expect(publication.pricing.data_version).toBe(dataVersion);
    expect(
      summary("amazon-bedrock", "anthropic.claude-haiku-4-5-20251001-v1:0")?.status?.label,
    ).toBe("Varies");
    expect(summary("openai", "gpt-5.2-pro")).toMatchObject({
      input: { amount: "$21" },
      output: { amount: "$168" },
    });
    expect(summary("openai", "gpt-5.2-pro")?.status).toBeUndefined();
  }, 90_000);

  it("publishes audit-free details in bounded provider chunks", async () => {
    const { catalog, publication } = await publicationData();
    const details = publication.details.flatMap((chunk) => chunk.details);
    expect(details).toHaveLength(catalog.models.length);
    expect(publication.details.length).toBeLessThan(catalog.models.length);
    expect(
      Math.max(...publication.details.map((chunk) => Buffer.byteLength(JSON.stringify(chunk)))),
    ).toBeLessThanOrEqual(WEBSITE_DETAIL_CHUNK_MAX_BYTES);
    expect(new Set(details.map(({ model_ref }) => model_ref)).size).toBe(catalog.models.length);
    expect(foundAuditFields(details)).toEqual([]);
    expect(
      details.find(
        ({ model_ref }) => model_ref === "amazon-bedrock/anthropic.claude-haiku-4-5-20251001-v1:0",
      )?.pricing?.offers.length,
    ).toBeGreaterThan(0);
    const bedrockOffer = details.find(
      ({ model_ref }) => model_ref === "amazon-bedrock/amazon.nova-2-lite-v1:0",
    )?.pricing?.offers[0];
    expect(bedrockOffer).toMatchObject({
      title: "Usage pricing",
      role: "base",
      state_summary: "Metered pricing",
    });
    expect(Object.keys(bedrockOffer ?? {})).not.toContain("book_title");
    expect(Object.keys(bedrockOffer ?? {})).not.toContain("mode");
    expect(
      details
        .find(({ model_ref }) => model_ref === "mistral/codestral-embed-2505@25.05")
        ?.pricing?.offers.flatMap(({ rates }) => rates.map(({ amount }) => amount)),
    ).toContain("$0.075");
  }, 90_000);

  it("keeps the checked-in development pack bound to the audit-free projection", async () => {
    const [{ catalog, pricing, dataVersion }, manifest, pack] = await Promise.all([
      publicationData(),
      readFile(defaultProjectionPaths.uiManifest).then(decodeAssetPackManifest),
      readFile(defaultProjectionPaths.uiPack),
    ]);
    validateAssetPack(manifest, pack);
    const actual = manifest.assets.map(({ file_name, offset, length }) => ({
      fileName: file_name,
      source: gunzipSync(pack.subarray(offset, offset + length)).toString("utf8"),
    }));

    expect(manifest.data_version).toBe(dataVersion);
    expect(actual).toEqual(websiteAssets(catalog, pricing.data, dataVersion));
  }, 90_000);

  it("projects a retained provider failure without audit details", () => {
    const verifiedAt = "2026-07-27T00:00:00.000Z";
    const attemptedAt = "2026-07-28T00:00:00.000Z";
    const detail = websiteModelDetail(
      {
        provider_vocabularies: [],
        provider_snapshots: [
          {
            provider_id: "test",
            observed_at: verifiedAt,
            publication: "retained",
            refresh_failure: {
              attempted_at: attemptedAt,
              code: "source_schema_changed",
            },
          },
        ],
        model_dispositions: [],
        books: [],
      },
      baseModel({
        providerId: "test",
        id: "model",
        name: "Model",
        sourceId: "test-catalog",
        observedAt: attemptedAt,
      }),
    );

    expect(detail.pricing).toMatchObject({
      snapshot: {
        observed_at: verifiedAt,
        publication: "retained",
        refresh_failure: {
          attempted_at: attemptedAt,
          message: "A required public pricing source no longer matched its reviewed format.",
        },
      },
      offers: [],
    });
  });
});
