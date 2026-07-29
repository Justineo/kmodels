import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { baseModel } from "../src/catalog/model.ts";
import { readPricingMirrorSource } from "../src/catalog/pricing-publication.ts";
import { pricingCatalogEnvelopeSchema } from "../src/catalog/pricing-schema.ts";
import { catalogSchema, migrateCatalogStorage } from "../src/catalog/schema.ts";
import {
  websiteCatalog,
  websiteModelDetail,
  websiteModelDetails,
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

describe("website data", () => {
  it("keeps initial catalog data compact and excludes audit fields", async () => {
    const { catalog, pricing } = await generatedData();
    const website = websiteCatalog(catalog, pricing);
    const source = JSON.stringify(website);

    expect(Buffer.byteLength(source)).toBeLessThan(2 * 1024 * 1024);
    expect(foundAuditFields(JSON.parse(source))).toEqual([]);
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
  });

  it("publishes audit-free model details as lazy assets", async () => {
    const { catalog, pricing } = await generatedData();
    const details = websiteModelDetails(catalog, pricing);
    expect(details.size).toBe(catalog.models.length);
    expect(foundAuditFields([...details.values()])).toEqual([]);
    expect(
      [...details.values()].find(
        ({ model_ref }) => model_ref === "amazon-bedrock/anthropic.claude-haiku-4-5-20251001-v1:0",
      )?.pricing?.offers.length,
    ).toBeGreaterThan(0);
    const bedrockOffer = [...details.values()].find(
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
      [...details.values()]
        .find(({ model_ref }) => model_ref === "mistral/codestral-embed-2505@25.05")
        ?.pricing?.offers.flatMap(({ rates }) => rates.map(({ amount }) => amount)),
    ).toContain("$0.075");
  });

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
