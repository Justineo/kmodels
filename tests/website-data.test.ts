import { readFile } from "node:fs/promises";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vite-plus/test";
import { decodeAssetPackManifest, validateAssetPack } from "../src/catalog/asset-pack.ts";
import { canonicalJsonKey, compareUtf8 } from "../src/catalog/canonical-value.ts";
import { websitePublicationAssets } from "../src/catalog/endpoints.ts";
import { manifests, type ProviderManifest } from "../src/catalog/manifests.ts";
import { defaultProjectionPaths } from "../src/catalog/projection-paths.ts";
import type { PriceDimension } from "../src/catalog/pricing-schema.ts";
import { websiteDataVersion } from "../src/catalog/projections.ts";
import {
  PROVIDER_UNNORMALIZED_PREVIEW_LIMIT,
  WEBSITE_APPLICABILITY_LABEL_MAX_LENGTH,
  WEBSITE_DETAIL_CHUNK_MAX_BYTES,
  websitePublication,
  type WebsitePublication,
} from "../src/catalog/website-data.ts";
import { parseWebsiteCatalog } from "../src/catalog/website-runtime.ts";
import type { WebsiteModelDetail, WebsitePricingOffer } from "../src/catalog/website-schema.ts";
import { generatedData } from "./generated-data-context.ts";

const websiteDataBudgets = {
  catalogBytes: 320 * 1024,
  pricingBytes: 112 * 1024,
  compressedCatalogBytes: 48 * 1024,
  compressedPricingBytes: 10 * 1024,
  modelDetailBytes: 80 * 1024 * 1024,
};

const auditFields = new Set([
  "atom_contract_hash",
  "charge_binding",
  "charge_bindings",
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

function publishedModelDetails(publication: WebsitePublication): WebsiteModelDetail[] {
  const offerChunks = new Map(
    publication.offers.map(({ provider_id, chunk, offers }) => [`${provider_id}/${chunk}`, offers]),
  );
  return publication.details.flatMap(({ provider_id, details }) =>
    details.map(({ pricing, ...detail }) => {
      if (pricing === undefined) return detail;
      const offers = pricing.offer_refs.map(([chunk, index]) => {
        const offer = offerChunks.get(`${provider_id}/${chunk}`)?.[index];
        if (offer === undefined) throw new Error(`Missing website offer ${provider_id}/${chunk}`);
        return offer;
      });
      return {
        ...detail,
        pricing: {
          ...(pricing.snapshot === undefined ? {} : { snapshot: pricing.snapshot }),
          offers,
        },
      };
    }),
  );
}

function publishedProviderOffers(
  publication: WebsitePublication,
): Array<{ providerId: string; fragments: WebsitePricingOffer[] }> {
  const chunks = new Map(
    publication.offers.map(({ provider_id, chunk, offers }) => [`${provider_id}/${chunk}`, offers]),
  );
  return publication.providerPricing.flatMap(({ provider_id, resources }) =>
    resources.flatMap(({ offers }) =>
      offers.map(({ offer_refs }) => ({
        providerId: provider_id,
        fragments: offer_refs.map(([chunk, index]) => {
          const offer = chunks.get(`${provider_id}/${chunk}`)?.[index];
          if (offer === undefined)
            throw new Error(`Missing provider offer ${provider_id}/${chunk}`);
          return offer;
        }),
      })),
    ),
  );
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
    expect(new Set(publication.pricing.statuses.map((value) => JSON.stringify(value))).size).toBe(
      publication.pricing.statuses.length,
    );
    expect(new Set(publication.pricing.cells.map((value) => JSON.stringify(value))).size).toBe(
      publication.pricing.cells.length,
    );
    const runtimeCatalog = parseWebsiteCatalog(publication.catalog, publication.pricing);
    expect(runtimeCatalog.models.map(({ aliases }) => aliases)).toEqual(
      catalog.models.map(({ aliases }) => aliases),
    );
    for (const { pricing } of runtimeCatalog.models) {
      const hasRepresentativeRate =
        pricing.input !== undefined || pricing.cache !== undefined || pricing.output !== undefined;
      expect(pricing.status === undefined).toBe(hasRepresentativeRate);
    }
    const amounts = runtimeCatalog.models.flatMap(({ pricing }) =>
      [pricing.input, pricing.cache, pricing.output].flatMap((cell) =>
        cell === undefined ? [] : [cell.amount],
      ),
    );
    expect(amounts).not.toEqual(expect.arrayContaining([expect.stringMatching(/\d\/\d/)]));
  }, 90_000);

  it("publishes audit-free details in bounded provider chunks", async () => {
    const { catalog, publication } = await publicationData();
    const details = publication.details.flatMap((chunk) => chunk.details);
    expect(details).toHaveLength(catalog.models.length);
    expect(publication.details.length).toBeLessThan(catalog.models.length);
    expect(
      Math.max(...publication.details.map((chunk) => Buffer.byteLength(JSON.stringify(chunk)))),
    ).toBeLessThanOrEqual(WEBSITE_DETAIL_CHUNK_MAX_BYTES);
    expect(
      Math.max(...publication.offers.map((chunk) => Buffer.byteLength(JSON.stringify(chunk)))),
    ).toBeLessThanOrEqual(WEBSITE_DETAIL_CHUNK_MAX_BYTES);
    expect(
      Math.max(
        ...publication.providerPricing.map((chunk) => Buffer.byteLength(JSON.stringify(chunk))),
      ),
    ).toBeLessThanOrEqual(WEBSITE_DETAIL_CHUNK_MAX_BYTES);
    for (const provider of publication.catalog.providers) {
      const chunks = publication.providerPricing.filter(
        ({ provider_id }) => provider_id === provider.id,
      );
      expect(chunks.map(({ chunk }) => chunk)).toEqual(chunks.map((_, index) => index));
      expect(provider.pricing_coverage.detail_chunks).toBe(chunks.length);
      expect(provider.pricing_coverage.standalone_resources).toBe(
        new Set(chunks.flatMap(({ resources }) => resources.map(({ id }) => id))).size,
      );
      expect(provider.pricing_coverage.representative_models).toBeLessThanOrEqual(
        provider.pricing_coverage.offer_models,
      );
      expect(
        provider.pricing_coverage.offer_models +
          provider.pricing_coverage.unknown_models +
          provider.pricing_coverage.not_applicable_models,
      ).toBe(catalog.models.filter(({ provider_id }) => provider_id === provider.id).length);
    }
    expect(new Set(details.map(({ model_ref }) => model_ref))).toEqual(
      new Set(catalog.models.map(({ uid }) => uid)),
    );
    for (const model of catalog.models) {
      const detail = details.find(({ model_ref }) => model_ref === model.uid);
      expect(detail, model.uid).toBeDefined();
      const projectedAvailability = (detail?.deployment_availability ?? []).flatMap(
        ({ deployment_type, regions }) =>
          regions.map((region) => JSON.stringify([region, deployment_type])),
      );
      expect(new Set(projectedAvailability), model.uid).toEqual(
        new Set(
          (model.availability ?? []).map(({ region, deployment_type }) =>
            JSON.stringify([region, deployment_type]),
          ),
        ),
      );
    }
    expect(
      [...publication.details, ...publication.offers].reduce(
        (bytes, chunk) => bytes + Buffer.byteLength(JSON.stringify(chunk)),
        0,
      ),
    ).toBeLessThan(websiteDataBudgets.modelDetailBytes);
    expect(foundAuditFields([details, publication.offers])).toEqual([]);
    const hydratedDetails = publishedModelDetails(publication);
    const offers = hydratedDetails.flatMap(({ pricing }) => pricing?.offers ?? []);
    expect(offers.length).toBeGreaterThan(0);
    for (const offer of offers) {
      expect(offer).not.toHaveProperty("book_title");
      expect(offer).not.toHaveProperty("mode");
    }
    const rates = offers.flatMap(({ rates }) => rates);
    expect(rates.some(({ driver }) => driver !== undefined)).toBe(true);
    expect(
      rates.some(
        ({ driver }) => driver?.resolution_phase === "outcome" && driver.definition.length > 0,
      ),
    ).toBe(true);
    expect(offers.some(({ settlement }) => settlement.length > 0)).toBe(true);
    expect(rates.map(({ amount }) => amount)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/\d\/\d/)]),
    );
    const allowances = hydratedDetails.flatMap(
      ({ pricing }) => pricing?.offers.flatMap((offer) => offer.allowances) ?? [],
    );
    expect(allowances.length).toBeGreaterThan(0);
    for (const allowance of allowances) {
      expect(allowance.value).not.toMatch(/\d\/\d/);
      expect(allowance.target).not.toMatch(/^Offsets /);
      expect(allowance.reset).not.toMatch(/ reset$/);
    }
    expect(
      Math.max(...hydratedDetails.map(({ pricing }) => pricing?.offers.length ?? 0)),
    ).toBeLessThanOrEqual(32);
    expect(
      hydratedDetails.find(({ model_ref }) => model_ref === "ollama/alfred")?.pricing?.offers,
    ).toEqual([]);
    expect(
      hydratedDetails.find(({ model_ref }) => model_ref === "ollama/kimi-k3")?.pricing?.offers,
    ).toEqual([expect.objectContaining({ title: "Ollama Cloud inference" })]);
    expect(
      hydratedDetails
        .find(({ model_ref }) => model_ref === "vercel/google/gemini-3-flash")
        ?.pricing?.offers.filter(({ title }) => /GPT|Claude|other Gemini/i.test(title)),
    ).toEqual([]);
  }, 90_000);

  it("keeps provider detail qualifiers readable and raw previews bounded", async () => {
    const offers = publishedProviderOffers((await publicationData()).publication);
    expect(offers.length).toBeGreaterThan(0);
    let conditionalRates = 0;
    for (const { providerId, fragments } of offers) {
      const rawRows = fragments.flatMap(({ unnormalized }) => unnormalized);
      expect(rawRows.length, providerId).toBeLessThanOrEqual(PROVIDER_UNNORMALIZED_PREVIEW_LIMIT);
      expect(new Set(fragments.map(({ unnormalized_count }) => unnormalized_count)).size).toBe(1);
      expect(fragments[0]?.unnormalized_count ?? 0).toBeGreaterThanOrEqual(rawRows.length);

      const rows = fragments.flatMap((offer) => [
        ...offer.states,
        ...offer.rates,
        ...offer.allowances,
        ...offer.contributions,
        ...offer.enrollment,
        ...offer.settlement,
      ]);
      for (const row of rows) {
        expect(row.applicability_label.trim(), providerId).not.toBe("");
        expect(row.applicability_label.length, providerId).toBeLessThanOrEqual(
          WEBSITE_APPLICABILITY_LABEL_MAX_LENGTH,
        );
        if (!row.applicability.any_of.some(({ all_of }) => all_of.length === 0)) {
          expect(row.applicability_label, providerId).not.toBe("All contexts");
          if ("amount" in row) conditionalRates += 1;
        }
      }
      for (const fragment of fragments) {
        expect(
          fragment.rates.map(({ label }) => label),
          providerId,
        ).not.toEqual(expect.arrayContaining([expect.stringMatching(/^provider-meter\(/)]));
        expect(
          fragment.allowances.map(({ value }) => value),
          providerId,
        ).not.toEqual(expect.arrayContaining([expect.stringMatching(/^provider-credit\(/)]));
      }
    }
    expect(conditionalRates).toBeGreaterThan(0);
  }, 90_000);

  it("projects exact numeric values and complete range partitions as choices", async () => {
    const details = publishedModelDetails((await publicationData()).publication);
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

  it("keeps projected provider labels consistent and selector choices unambiguous", async () => {
    const { publication } = await publicationData();
    const providerManifests: readonly ProviderManifest[] = manifests;
    const configuredLabels = new Map(
      providerManifests.flatMap((manifest) =>
        (manifest.pricingCategoricalLabels ?? []).map(
          ({ dimension, value, label }) =>
            [categoricalLabelIdentity(manifest.provider.id, dimension, value), label] as const,
        ),
      ),
    );

    const projectedLabels = new Map<string, string>();
    const projectedOffers = publication.offers.flatMap(({ offers }) => offers);
    for (const offer of projectedOffers)
      for (const selector of offer.selectors) {
        if (selector.kind !== "categorical") continue;
        expect(
          new Set(selector.values.map(({ label }) => label)).size,
          `${offer.id}:${selector.key}`,
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

    for (const [identity, label] of projectedLabels) {
      const configured = configuredLabels.get(identity);
      if (configured !== undefined) expect(label, identity).toBe(configured);
    }
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
    expect(actual).toEqual(
      websitePublicationAssets(publication).sort((left, right) =>
        compareUtf8(left.fileName, right.fileName),
      ),
    );
  }, 90_000);
});
