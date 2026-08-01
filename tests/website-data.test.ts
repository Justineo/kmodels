import { readFile } from "node:fs/promises";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vite-plus/test";
import { decodeAssetPackManifest, validateAssetPack } from "../src/catalog/asset-pack.ts";
import { websitePublicationAssets } from "../src/catalog/endpoints.ts";
import { baseModel } from "../src/catalog/model.ts";
import { defaultProjectionPaths } from "../src/catalog/projection-paths.ts";
import { websiteDataVersion } from "../src/catalog/projections.ts";
import {
  WEBSITE_DETAIL_CHUNK_MAX_BYTES,
  websiteModelDetail,
  websitePublication,
} from "../src/catalog/website-data.ts";
import { generatedData } from "./generated-data-context.ts";

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

let generatedPublication: ReturnType<typeof loadGeneratedPublication> | undefined;

async function loadGeneratedPublication() {
  const { catalog, pricing } = await generatedData();
  const dataVersion = websiteDataVersion(catalog.catalog_version, pricing.pricing_data_version);
  return {
    catalog,
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
    ).toBe("2 offers");
    expect(summary("openai", "gpt-5.2-pro")?.status?.label).toBe("Varies");
    expect(summary("openai", "chat-latest")).toMatchObject({
      input: { amount: "$5" },
      output: { amount: "$30" },
    });
    expect(summary("openai", "chat-latest")?.status).toBeUndefined();
    expect(summary("openai", "gpt-realtime-translate")?.input).toMatchObject({
      amount: "$0.034",
      displayUnit: "minute",
    });
    expect(summary("openai", "omni-moderation-latest")?.status).toEqual({
      label: "No offer",
      description: "No public hosted pricing offer applies to this model.",
    });
    expect(summary("amazon-bedrock", "amazon.titan-embed-g1-text-02")?.status).toEqual({
      label: "Unknown",
      description: "Available sources do not establish whether pricing applies.",
    });
    expect(summary("vercel", "bfl/flux-2-flex")?.status).toEqual({
      label: "Unpublished",
      description: "A hosted offer exists, but its price is not publicly available.",
    });
    expect(
      publication.pricing.pricing.flatMap(({ input, cache, output }) =>
        [input, cache, output].flatMap((price) => (price === undefined ? [] : [price.amount])),
      ),
    ).not.toEqual(expect.arrayContaining([expect.stringMatching(/\d\/\d/)]));
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
    expect(
      details
        .find(({ model_ref }) => model_ref === "openai/gpt-realtime-translate")
        ?.pricing?.offers.flatMap(({ rates }) => rates),
    ).toContainEqual(
      expect.objectContaining({
        amount: "$0.034",
        unit: "per minute",
        accessible_text: "USD 0.034 per minute",
      }),
    );
    expect(
      details.flatMap(
        ({ pricing }) =>
          pricing?.offers.flatMap(({ rates }) => rates.map(({ amount }) => amount)) ?? [],
      ),
    ).not.toEqual(expect.arrayContaining([expect.stringMatching(/\d\/\d/)]));
    expect(
      details.flatMap(
        ({ pricing }) =>
          pricing?.offers.flatMap(({ allowances }) => allowances.map(({ value }) => value)) ?? [],
      ),
    ).not.toEqual(expect.arrayContaining([expect.stringMatching(/\d\/\d/)]));
  }, 90_000);

  it("projects singleton numeric domains as choices and retains genuine ranges", async () => {
    const details = (await publicationData()).publication.details.flatMap((chunk) => chunk.details);
    const fableFive = details.find(
      ({ model_ref }) => model_ref === "amazon-bedrock/anthropic.claude-fable-5",
    );
    expect(
      fableFive?.pricing?.offers[0]?.selectors.find(
        ({ dimension }) =>
          dimension.namespace === "kmodels" && dimension.value === "cache_ttl_seconds",
      ),
    ).toMatchObject({ kind: "decimal_values", values: ["300", "3600"] });

    const selectors = details.flatMap(
      ({ pricing }) => pricing?.offers.flatMap((offer) => offer.selectors) ?? [],
    );
    expect(selectors.some(({ kind }) => kind === "decimal_range")).toBe(true);
    expect(
      selectors.every(
        (selector) =>
          selector.kind !== "decimal_range" ||
          selector.ranges.some(
            ({ lower, upper }) =>
              lower === undefined ||
              upper === undefined ||
              !lower.inclusive ||
              !upper.inclusive ||
              lower.value !== upper.value,
          ),
      ),
    ).toBe(true);
  }, 90_000);

  it("keeps the checked-in development pack bound to the audit-free projection", async () => {
    const [{ publication, dataVersion }, manifest, pack] = await Promise.all([
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
    expect(actual).toEqual(websitePublicationAssets(publication));
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
