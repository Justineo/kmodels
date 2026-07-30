import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { validatePricingCatalogEnvelope } from "../src/catalog/pricing-envelope.ts";
import { readPricingMirrorSource } from "../src/catalog/pricing-publication.ts";
import { pricingCatalogEnvelopeSchema } from "../src/catalog/pricing-schema.ts";
import { catalogSchema, migrateCatalogStorage } from "../src/catalog/schema.ts";

describe("provider pricing calibration", () => {
  it("validates every committed provider pricing partition", async () => {
    const [catalogValue, pricingValue] = await Promise.all([
      readFile(new URL("../data/catalog.json", import.meta.url), "utf8"),
      readPricingMirrorSource(),
    ]);
    const catalog = catalogSchema.parse(migrateCatalogStorage(JSON.parse(catalogValue)));
    const pricing = pricingCatalogEnvelopeSchema.parse(JSON.parse(pricingValue));

    expect(() => validatePricingCatalogEnvelope(pricing, catalog)).not.toThrow();
    const providers = pricing.data.provider_snapshots.map(({ provider_id }) => provider_id);
    expect(providers).toEqual(
      expect.arrayContaining(["openai", "anthropic", "gemini", "vertex", "dashscope"]),
    );
    expect(providers.length).toBeGreaterThan(10);
  }, 90_000);
});
