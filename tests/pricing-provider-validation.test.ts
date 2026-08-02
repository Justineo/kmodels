import { describe, expect, it } from "vite-plus/test";
import { validatePricingCatalogEnvelopeMetadata } from "../src/catalog/pricing-envelope.ts";
import { validatePricingCatalogInParallel } from "../src/catalog/pricing-validation-parallel.ts";
import { generatedData } from "./generated-data-context.ts";

describe("provider pricing validation", () => {
  it("validates every committed provider pricing partition", async () => {
    const { catalog, pricing, pricingDataHash } = await generatedData();

    expect(() =>
      validatePricingCatalogEnvelopeMetadata(pricing, catalog, pricingDataHash),
    ).not.toThrow();
    await expect(validatePricingCatalogInParallel(pricing.data, catalog)).resolves.toBeUndefined();
  }, 90_000);
});
