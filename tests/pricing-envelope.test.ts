import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import {
  createPricingCatalogEnvelope,
  decodePricingCatalog,
  pricingCatalogJson,
  validatePricingCatalogEnvelope,
} from "../src/catalog/pricing-envelope.ts";
import type { PricingCatalog } from "../src/catalog/pricing-schema.ts";
import { catalogSchema } from "../src/catalog/schema.ts";

const emptyPricing: PricingCatalog = {
  provider_vocabularies: [],
  provider_snapshots: [],
  model_dispositions: [],
  books: [],
};

async function catalog() {
  return catalogSchema.parse(
    JSON.parse(await readFile(new URL("../data/catalog.json", import.meta.url), "utf8")),
  );
}

describe("canonical pricing envelope", () => {
  it("binds canonical pricing data to the exact core catalog data", async () => {
    const core = await catalog();
    const envelope = createPricingCatalogEnvelope(emptyPricing, core);
    expect(envelope.core_catalog_version).toBe(core.catalog_version);
    expect(envelope.core_data_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(envelope.pricing_data_version).toMatch(/^[0-9a-f]{64}$/);
    expect(() => validatePricingCatalogEnvelope(envelope, core)).not.toThrow();
  });

  it("round-trips only exact canonical public bytes", async () => {
    const core = await catalog();
    const envelope = createPricingCatalogEnvelope(emptyPricing, core);
    const json = pricingCatalogJson(envelope, core);
    expect(decodePricingCatalog(new TextEncoder().encode(json), core)).toEqual(envelope);
    expect(() => decodePricingCatalog(new TextEncoder().encode(`${json}\n`), core)).toThrow(
      "not in RFC 8785 canonical form",
    );
  });

  it("rejects a mismatched catalog binding or pricing-data hash", async () => {
    const core = await catalog();
    const envelope = createPricingCatalogEnvelope(emptyPricing, core);
    expect(() =>
      validatePricingCatalogEnvelope({ ...envelope, core_data_sha256: "0".repeat(64) }, core),
    ).toThrow("core data hash");
    expect(() =>
      validatePricingCatalogEnvelope({ ...envelope, pricing_data_version: "0".repeat(64) }, core),
    ).toThrow("Pricing data version");
  });
});
