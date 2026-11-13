import { describe, expect, it } from "vite-plus/test";
import {
  createPricingCatalogEnvelope,
  createPricingCatalogEnvelopeFromValidatedData,
  decodePricingCatalog,
  pricingCatalogJson,
  validatePricingCatalogEnvelope,
} from "../src/catalog/pricing-envelope.ts";
import type { PricingCatalog, ProviderPricingSnapshot } from "../src/catalog/pricing-schema.ts";
import type { Catalog } from "../src/catalog/schema.ts";

const emptyPricing: PricingCatalog = {
  provider_vocabularies: [],
  provider_snapshots: [],
  model_dispositions: [],
  books: [],
};

const catalog: Catalog = {
  catalog_version: "1".repeat(64),
  generated_at: "2026-07-28T00:00:00.000Z",
  providers: [],
  models: [],
  sources: [],
  coverage: [],
  warnings: [],
};

describe("canonical pricing envelope", () => {
  it.each(["fresh", "retained"] as const)(
    "preserves an untouched %s provider's clock in a targeted publication",
    (publication) => {
      const observed_at = "2026-07-26T00:00:00.000Z";
      const snapshot: ProviderPricingSnapshot =
        publication === "fresh"
          ? { provider_id: "unchanged", publication, observed_at }
          : {
              provider_id: "unchanged",
              publication,
              observed_at,
              refresh_failure: {
                attempted_at: "2026-07-27T00:00:00.000Z",
                code: "provider_refresh_failed",
              },
            };
      const make = (snapshot: ProviderPricingSnapshot) =>
        createPricingCatalogEnvelopeFromValidatedData(
          { ...emptyPricing, provider_snapshots: [snapshot] },
          catalog,
          "a".repeat(64),
        );
      expect(make(snapshot).data.provider_snapshots).toEqual([snapshot]);
      const future = "2026-07-29T00:00:00.000Z";
      expect(() =>
        make(
          snapshot.publication === "fresh"
            ? { ...snapshot, observed_at: future }
            : {
                ...snapshot,
                refresh_failure: { ...snapshot.refresh_failure, attempted_at: future },
              },
        ),
      ).toThrow("refresh time after publication");
    },
  );
  it("binds canonical pricing data to the exact core catalog data", () => {
    const envelope = createPricingCatalogEnvelope(emptyPricing, catalog);
    expect(envelope.core_catalog_version).toBe(catalog.catalog_version);
    expect(envelope.core_data_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(envelope.pricing_data_version).toMatch(/^[0-9a-f]{64}$/);
    expect(() => validatePricingCatalogEnvelope(envelope, catalog)).not.toThrow();
  });

  it("round-trips only exact canonical public bytes", () => {
    const envelope = createPricingCatalogEnvelope(emptyPricing, catalog);
    const json = pricingCatalogJson(envelope, catalog);
    expect(decodePricingCatalog(new TextEncoder().encode(json), catalog)).toEqual(envelope);
    expect(() => decodePricingCatalog(new TextEncoder().encode(`${json}\n`), catalog)).toThrow(
      "not in RFC 8785 canonical form",
    );
  });

  it("rejects a mismatched catalog binding or pricing-data hash", () => {
    const envelope = createPricingCatalogEnvelope(emptyPricing, catalog);
    expect(() =>
      validatePricingCatalogEnvelope({ ...envelope, core_data_sha256: "0".repeat(64) }, catalog),
    ).toThrow("core data hash");
    expect(() =>
      validatePricingCatalogEnvelope(
        { ...envelope, pricing_data_version: "0".repeat(64) },
        catalog,
      ),
    ).toThrow("Pricing data version");
  });
});
