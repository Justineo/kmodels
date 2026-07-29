import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { baseModel } from "../src/catalog/model.ts";
import { readPricingMirrorSource } from "../src/catalog/pricing-publication.ts";
import { pricingCatalogEnvelopeSchema } from "../src/catalog/pricing-schema.ts";
import { catalogSchema, migrateCatalogStorage } from "../src/catalog/schema.ts";
import {
  WEBSITE_DETAIL_CHUNK_MAX_BYTES,
  hydrateWebsiteCatalog,
  websiteModelDetail,
  websitePublication,
} from "../src/catalog/website-data.ts";

const dataVersion = "1".repeat(64);

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

function foundAuditFields(value: unknown): string[] {
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
      if (auditFields.has(field)) found.add(field);
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
    pricing: pricingCatalogEnvelopeSchema.parse(JSON.parse(pricingSource)).data,
  };
}

let generatedPublication: ReturnType<typeof loadGeneratedPublication> | undefined;

async function loadGeneratedPublication() {
  const { catalog, pricing } = await generatedData();
  return {
    catalog,
    publication: websitePublication(catalog, pricing, dataVersion),
  };
}

function publicationData() {
  generatedPublication ??= loadGeneratedPublication();
  return generatedPublication;
}

describe("website data", () => {
  it("keeps the initial catalog minimal and publishes pricing separately", async () => {
    const { publication } = await publicationData();
    const catalogSource = JSON.stringify(publication.catalog);
    const pricingSource = JSON.stringify(publication.pricing);
    const website = hydrateWebsiteCatalog(publication.catalog, publication.pricing.pricing);

    expect(Buffer.byteLength(catalogSource)).toBeLessThan(1024 * 1024);
    expect(Buffer.byteLength(pricingSource)).toBeLessThan(1024 * 1024);
    expect(foundAuditFields(JSON.parse(catalogSource))).toEqual([]);
    expect(foundAuditFields(JSON.parse(pricingSource))).toEqual([]);
    expect(publication.catalog.models[0]).not.toHaveProperty("uid");
    expect(publication.catalog.models[0]).not.toHaveProperty("pricing");
    expect(publication.catalog.models[0]).not.toHaveProperty("detail_ref");
    expect(publication.catalog.data_version).toBe(dataVersion);
    expect(publication.pricing.data_version).toBe(dataVersion);
    expect(
      website.models.find(
        ({ uid }) => uid === "amazon-bedrock/anthropic.claude-haiku-4-5-20251001-v1:0",
      )?.pricing.status?.label,
    ).toBe("Varies");
    expect(website.models.find(({ uid }) => uid === "openai/gpt-5.2-pro")?.pricing).toMatchObject({
      input: { amount: "$21" },
      output: { amount: "$168" },
    });
    expect(
      website.models.find(({ uid }) => uid === "openai/gpt-5.2-pro")?.pricing.status,
    ).toBeUndefined();
  }, 15_000);

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
  }, 15_000);

  it("projects a retained provider failure without audit details", () => {
    const verifiedAt = "2026-07-27T00:00:00.000Z";
    const attemptedAt = "2026-07-28T00:00:00.000Z";
    const detail = websiteModelDetail(
      {
        provider_vocabularies: [{ provider_id: "test", atoms: [] }],
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
