import { readFile } from "node:fs/promises";
import { sha256 } from "../src/catalog/io.ts";
import { readPricingMirrorSource } from "../src/catalog/pricing-publication.ts";
import { pricingCatalogEnvelopeSchema } from "../src/catalog/pricing-schema.ts";
import { catalogSchema, migrateCatalogStorage } from "../src/catalog/schema.ts";

let data: ReturnType<typeof loadGeneratedData> | undefined;

async function loadGeneratedData() {
  const [catalogSource, pricingSource] = await Promise.all([
    readFile(new URL("../data/catalog.json", import.meta.url), "utf8"),
    readPricingMirrorSource(),
  ]);
  const rawPricing: unknown = JSON.parse(pricingSource);
  if (rawPricing === null || typeof rawPricing !== "object")
    throw new Error("Pricing mirror is not an object");
  // JSON.parse preserves the canonical mirror's member order, avoiding a second full sort.
  const pricingDataSource = JSON.stringify(Reflect.get(rawPricing, "data"));
  if (pricingDataSource === undefined) throw new Error("Pricing mirror has no data");
  return {
    catalog: catalogSchema.parse(migrateCatalogStorage(JSON.parse(catalogSource))),
    pricing: pricingCatalogEnvelopeSchema.parse(rawPricing),
    pricingDataHash: sha256(pricingDataSource),
  };
}

export function generatedData() {
  data ??= loadGeneratedData();
  return data;
}
