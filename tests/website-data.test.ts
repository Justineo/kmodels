import { gunzipSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import { compressedAsset } from "../src/catalog/asset-pack.ts";
import { canonicalJsonKey } from "../src/catalog/canonical-value.ts";
import { websitePublicationAssets } from "../src/catalog/endpoints.ts";
import { manifests, type ProviderManifest } from "../src/catalog/manifests.ts";
import { readPublishedAssetProfile } from "../src/catalog/published-assets.ts";
import type { PriceDimension } from "../src/catalog/pricing-schema.ts";
import { websiteDataVersionForPair } from "../src/catalog/projections.ts";
import { withPricingCanonicalCache } from "../src/catalog/pricing-canonical.ts";
import { fixedPricingSelection } from "../src/catalog/pricing-selector-input.ts";
import { websiteInferencePrices } from "../src/catalog/website-inference-pricing.ts";
import { restoreWebsiteInferenceDetail } from "./website-inference-detail.ts";
import {
  PROVIDER_UNNORMALIZED_PREVIEW_LIMIT,
  WEBSITE_APPLICABILITY_LABEL_MAX_LENGTH,
  WEBSITE_DETAIL_CHUNK_MAX_BYTES,
  websitePublication,
  type WebsitePublication,
} from "../src/catalog/website-data.ts";
import { loadWebsiteCatalog, parseWebsiteCatalog } from "../src/catalog/website-runtime.ts";
import { loadWebsiteModelDetail } from "../src/catalog/website-loader.ts";
import { WEBSITE_CORE_CHUNK_MAX_BYTES, websiteCoreAssets } from "../src/catalog/website-core.ts";
import type { WebsiteModelDetail, WebsitePricingOffer } from "../src/catalog/website-schema.ts";
import { generatedData } from "./generated-data-context.ts";
import { foundAuditFields } from "./website-audit-fields.ts";

let generatedPublication: ReturnType<typeof loadGeneratedPublication> | undefined;

async function loadGeneratedPublication() {
  const pair = await generatedData();
  const { catalog, pricing, inference } = pair;
  const dataVersion = websiteDataVersionForPair(pair);
  return {
    catalog,
    dataVersion,
    pricing: pricing.data,
    publication: withPricingCanonicalCache(() =>
      websitePublication(
        catalog,
        pricing.data,
        dataVersion,
        inference === undefined
          ? undefined
          : websiteInferencePrices(catalog, pricing, inference.mapping),
      ),
    ),
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
  return publication.details.flatMap(({ provider_id, details, snapshot: providerSnapshot }) =>
    details.map((stored) => {
      const { pricing, ...detail } = restoreWebsiteInferenceDetail(stored);
      if (pricing === undefined) return detail;
      const snapshot = pricing.snapshot ?? providerSnapshot;
      const offers = pricing.offer_refs.map(([chunk, index]) => {
        const offer = offerChunks.get(`${provider_id}/${chunk}`)?.[index];
        if (offer === undefined) throw new Error(`Missing website offer ${provider_id}/${chunk}`);
        return offer;
      });
      return {
        ...detail,
        pricing: {
          ...(snapshot === undefined ? {} : { snapshot }),
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
  // Rebuilding every provider's inference and website projections takes minutes on CI runners.
  // Keep that shared preparation outside individual consumer assertions, with a bounded budget.
  beforeAll(async () => {
    await publicationData();
  }, 300_000);

  it("publishes all core table data in bounded parallel chunks", async () => {
    const { catalog, publication, dataVersion } = await publicationData();
    const coreAssets = websiteCoreAssets(publication.catalog, publication.pricing);
    for (const asset of coreAssets)
      expect(Buffer.byteLength(asset.source)).toBeLessThanOrEqual(WEBSITE_CORE_CHUNK_MAX_BYTES);
    const loaded = await loadWebsiteCatalog(async (path) => {
      const asset = coreAssets.find(({ fileName }) => `/${fileName}` === path);
      if (asset === undefined) throw new Error(`Missing core asset ${path}`);
      return JSON.parse(asset.source);
    });
    const runtimeCatalog = parseWebsiteCatalog(publication.catalog, publication.pricing);
    expect(loaded).toEqual(runtimeCatalog);
    expect(foundAuditFields(publication.catalog)).toEqual([]);
    expect(foundAuditFields(publication.pricing)).toEqual([]);
    for (const model of publication.catalog.models) {
      expect(model).not.toHaveProperty("uid");
      expect(model).not.toHaveProperty("pricing");
      expect(model).not.toHaveProperty("detail_ref");
    }
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

  it("publishes model evidence and audit-free prices in bounded provider chunks", async () => {
    const { catalog, pricing, publication } = await publicationData();
    const details = publication.details.flatMap((chunk) => chunk.details);
    expect(details).toHaveLength(catalog.models.length);
    expect(publication.details.length).toBeLessThanOrEqual(catalog.models.length);
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
    const detailsByModel = new Map(details.map((detail) => [detail.model_ref, detail]));
    expect(detailsByModel.size).toBe(catalog.models.length);
    for (const model of catalog.models) {
      const detail = detailsByModel.get(model.uid);
      if (detail === undefined) throw new Error(`Missing website detail for ${model.uid}`);
      const projectedAvailability = (detail.deployment_availability ?? []).flatMap(
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
    expect(foundAuditFields(details)).toEqual([]);
    expect(foundAuditFields(publication.offers)).toEqual([]);
    const hydratedDetails = publishedModelDetails(publication);
    const offers = hydratedDetails.flatMap(({ pricing }) => pricing?.offers ?? []);
    for (const offer of offers) {
      expect(offer).not.toHaveProperty("book_title");
      expect(offer).not.toHaveProperty("mode");
    }
    const rates = offers.flatMap(({ rates }) => rates);
    expect(rates.map(({ amount }) => amount)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/\d\/\d/)]),
    );
    const allowances = hydratedDetails.flatMap(
      ({ pricing }) => pricing?.offers.flatMap((offer) => offer.allowances) ?? [],
    );
    for (const allowance of allowances) {
      expect(allowance.value).not.toMatch(/\d\/\d/);
      expect(allowance.target).not.toMatch(/^Offsets /);
      expect(allowance.reset).not.toMatch(/ reset$/);
    }
    expect(
      Math.max(...hydratedDetails.map(({ pricing }) => pricing?.offers.length ?? 0)),
    ).toBeLessThanOrEqual(32);
    const canonicalOffers = new Map(
      pricing.books.flatMap((book) =>
        book.offers.map((offer) => [offer.id, { book, offer }] as const),
      ),
    );
    const relatedByModel = new Map<string, Set<string>>();
    for (const book of pricing.books)
      for (const offer of book.offers) {
        if (offer.relations.length === 0) continue;
        const related = offer.relations.flatMap(({ target }) => target.offer_refs);
        for (const ref of book.scope.model_refs) {
          if (offer.model_refs !== undefined && !offer.model_refs.includes(ref)) continue;
          const refs = relatedByModel.get(ref) ?? new Set<string>();
          for (const id of related) refs.add(id);
          relatedByModel.set(ref, refs);
        }
      }
    for (const detail of hydratedDetails) {
      const related = relatedByModel.get(detail.model_ref);
      for (const offer of detail.pricing?.offers ?? []) {
        const canonical = canonicalOffers.get(offer.id);
        if (canonical === undefined) throw new Error(`Missing canonical website offer ${offer.id}`);
        expect(
          canonical.book.scope.model_refs.includes(detail.model_ref) ||
            related?.has(offer.id) === true,
          `${detail.model_ref}: ${offer.id}`,
        ).toBe(true);
        if (canonical.offer.model_refs !== undefined)
          expect(canonical.offer.model_refs, detail.model_ref).toContain(detail.model_ref);
      }
    }
  }, 90_000);

  it("keeps provider detail qualifiers readable and raw previews bounded", async () => {
    const offers = publishedProviderOffers((await publicationData()).publication);
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
        expect(selector.values.length, selector.key).toBeGreaterThan(0);
        if (selector.values.length === 1)
          expect(fixedPricingSelection(selector)?.kind, selector.key).toBe("decimal_range");
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

  it("keeps the published website pack bound to the projection and loadable for every model", async () => {
    const [{ publication, dataVersion }, published] = await Promise.all([
      publicationData(),
      readPublishedAssetProfile("ui"),
    ]);
    const { manifest, pack } = published;
    expect(manifest.data_version).toBe(dataVersion);
    const assetsByPath = new Map(
      websitePublicationAssets(publication).map(({ fileName, source }) => [`/${fileName}`, source]),
    );
    expect(manifest.assets).toHaveLength(assetsByPath.size);
    for (const entry of manifest.assets) {
      const source = gunzipSync(compressedAsset(pack, entry)).toString("utf8");
      if (source !== assetsByPath.get(`/${entry.file_name}`))
        throw new Error(`Website projection differs at ${entry.file_name}`);
    }

    // Verify the actual browser loader (`loadWebsiteModelDetail`) validates and hydrates
    // every single published model across all detail and offer chunks (100% coverage).
    const runtimeCatalog = parseWebsiteCatalog(publication.catalog, publication.pricing);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const rawUrl =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const pathname = new URL(rawUrl, "http://localhost").pathname;
      const body = assetsByPath.get(pathname);
      if (body === undefined) return new Response("Not Found", { status: 404 });
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    try {
      for (const model of runtimeCatalog.models) {
        const detail = await loadWebsiteModelDetail(dataVersion, model);
        expect(detail.model_ref, model.uid).toBe(model.uid);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 90_000);
});
