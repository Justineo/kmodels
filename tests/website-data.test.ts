import { readFile } from "node:fs/promises";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vite-plus/test";
import { decodeAssetPackManifest, validateAssetPack } from "../src/catalog/asset-pack.ts";
import { canonicalJsonKey } from "../src/catalog/canonical-value.ts";
import { websitePublicationAssets } from "../src/catalog/endpoints.ts";
import { manifests, type ProviderManifest } from "../src/catalog/manifests.ts";
import { defaultProjectionPaths } from "../src/catalog/projection-paths.ts";
import type { PriceDimension } from "../src/catalog/pricing-schema.ts";
import { websiteDataVersion } from "../src/catalog/projections.ts";
import { WEBSITE_DETAIL_CHUNK_MAX_BYTES, websitePublication } from "../src/catalog/website-data.ts";
import { generatedData } from "./generated-data-context.ts";

const websiteDataBudgets = {
  catalogBytes: 1024 * 1024,
  pricingBytes: 1024 * 1024,
  compressedCatalogBytes: 64 * 1024,
  compressedPricingBytes: 32 * 1024,
};

const auditFields = new Set([
  "atom_contract_hash",
  "relation_observations",
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
    pricing: pricing.data,
    publication: websitePublication(catalog, pricing.data, dataVersion),
  };
}

function publicationData() {
  generatedPublication ??= loadGeneratedPublication();
  return generatedPublication;
}

function categoricalLabelIdentity(
  providerId: string,
  dimension: PriceDimension,
  value: string,
): string {
  return canonicalJsonKey([providerId, dimension, value]);
}

describe("website data", () => {
  it("publishes all core table data in bounded parallel chunks", async () => {
    const { catalog, publication, dataVersion } = await publicationData();
    const catalogSource = JSON.stringify(publication.catalog);
    const pricingSource = JSON.stringify(publication.pricing);

    expect(Buffer.byteLength(catalogSource)).toBeLessThan(websiteDataBudgets.catalogBytes);
    expect(Buffer.byteLength(pricingSource)).toBeLessThan(websiteDataBudgets.pricingBytes);
    expect(gzipSync(catalogSource).byteLength).toBeLessThan(
      websiteDataBudgets.compressedCatalogBytes,
    );
    expect(gzipSync(pricingSource).byteLength).toBeLessThan(
      websiteDataBudgets.compressedPricingBytes,
    );
    expect(foundAuditFields(JSON.parse(catalogSource))).toEqual([]);
    expect(foundAuditFields(JSON.parse(pricingSource))).toEqual([]);
    expect(publication.catalog.models[0]).not.toHaveProperty("uid");
    expect(publication.catalog.models[0]).not.toHaveProperty("pricing");
    expect(publication.catalog.models[0]).not.toHaveProperty("detail_ref");
    expect(publication.catalog.data_version).toBe(dataVersion);
    expect(publication.pricing.data_version).toBe(dataVersion);
    expect(publication.catalog.models).toHaveLength(catalog.models.length);
    expect(publication.pricing.pricing).toHaveLength(catalog.models.length);
    for (const summary of publication.pricing.pricing) {
      const hasRepresentativeRate =
        summary.input !== undefined || summary.cache !== undefined || summary.output !== undefined;
      expect(summary.status === undefined).toBe(hasRepresentativeRate);
    }
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
    expect(new Set(details.map(({ model_ref }) => model_ref))).toEqual(
      new Set(catalog.models.map(({ uid }) => uid)),
    );
    expect(foundAuditFields(details)).toEqual([]);
    const offers = details.flatMap(({ pricing }) => pricing?.offers ?? []);
    expect(offers.length).toBeGreaterThan(0);
    for (const offer of offers) {
      expect(offer).not.toHaveProperty("book_title");
      expect(offer).not.toHaveProperty("mode");
    }
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

  it("projects exact numeric values and complete range partitions as choices", async () => {
    const details = (await publicationData()).publication.details.flatMap((chunk) => chunk.details);
    const selectors = details.flatMap(
      ({ pricing }) => pricing?.offers.flatMap((offer) => offer.selectors) ?? [],
    );
    for (const selector of selectors) {
      if (selector.kind === "decimal_values") {
        expect(new Set(selector.values).size, selector.key).toBe(selector.values.length);
        continue;
      }
      if (selector.kind === "decimal_buckets") {
        expect(new Set(selector.values.map(({ key }) => key)).size, selector.key).toBe(
          selector.values.length,
        );
        expect(selector.values.length, selector.key).toBeGreaterThan(1);
        continue;
      }
      if (selector.kind !== "decimal_range") continue;
      for (const { lower, upper } of selector.ranges)
        expect(
          lower === undefined ||
            upper === undefined ||
            !lower.inclusive ||
            !upper.inclusive ||
            lower.value !== upper.value,
          selector.key,
        ).toBe(true);
    }
    expect(selectors.some(({ kind }) => kind === "decimal_buckets")).toBe(true);
    expect(selectors.some(({ kind }) => kind === "decimal_range")).toBe(true);

    const grok = details.find(({ model_ref }) => model_ref === "xai/grok-4.5@1.0");
    expect(
      grok?.pricing?.offers[0]?.selectors.find(
        ({ dimension }) =>
          dimension.namespace === "kmodels" && dimension.value === "context_tokens",
      ),
    ).toMatchObject({
      kind: "decimal_buckets",
      values: [
        {
          label: "≤ 199,999",
          lower: { value: "0", inclusive: true },
          upper: { value: "199999", inclusive: true },
        },
        {
          label: "≥ 200,000",
          lower: { value: "200000", inclusive: true },
        },
      ],
    });

    const voice = details.find(
      ({ model_ref }) => model_ref === "xai/grok-voice-think-fast-2.0@1.0",
    );
    const operations = voice?.pricing?.offers[0]?.selectors.find(
      ({ dimension }) => dimension.namespace === "kmodels" && dimension.value === "operation",
    );
    expect(operations?.kind).toBe("categorical");
    expect(operations?.kind === "categorical" ? operations.values : []).toContainEqual(
      expect.objectContaining({
        label: "Text input",
        value: {
          namespace: "provider",
          provider_id: "xai",
          value: "conversation.item.create",
        },
      }),
    );
  }, 90_000);

  it("keeps configured provider labels current and selector choices unambiguous", async () => {
    const { pricing, publication } = await publicationData();
    const providerManifests: readonly ProviderManifest[] = manifests;
    const configuredLabels = new Map(
      providerManifests.flatMap((manifest) =>
        (manifest.pricingCategoricalLabels ?? []).map(
          ({ dimension, value, label }) =>
            [categoricalLabelIdentity(manifest.provider.id, dimension, value), label] as const,
        ),
      ),
    );
    const vocabularyAtoms = new Set<string>();
    for (const vocabulary of pricing.provider_vocabularies)
      for (const atom of vocabulary.atoms) {
        if (atom.kind !== "categorical_value") continue;
        vocabularyAtoms.add(
          categoricalLabelIdentity(vocabulary.provider_id, atom.dimension, atom.key),
        );
      }
    expect(
      [...configuredLabels.keys()].filter((identity) => !vocabularyAtoms.has(identity)),
    ).toEqual([]);

    const projectedLabels = new Map<string, string>();
    for (const detail of publication.details.flatMap((chunk) => chunk.details))
      for (const offer of detail.pricing?.offers ?? [])
        for (const selector of offer.selectors) {
          if (selector.kind !== "categorical") continue;
          expect(
            new Set(selector.values.map(({ label }) => label)).size,
            `${detail.model_ref}:${offer.id}:${selector.key}`,
          ).toBe(selector.values.length);
          for (const { label, value } of selector.values) {
            if (value.namespace !== "provider") continue;
            const identity = categoricalLabelIdentity(
              value.provider_id,
              selector.dimension,
              value.value,
            );
            const current = projectedLabels.get(identity);
            if (current !== undefined) expect(label, identity).toBe(current);
            projectedLabels.set(identity, label);
          }
        }

    for (const [identity, label] of configuredLabels)
      expect(projectedLabels.get(identity), identity).toBe(label);
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
});
