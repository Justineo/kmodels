import { assertCanonicalJson, canonicalJson, canonicalJsonHash } from "./canonical-json.ts";
import { pricingLimits } from "./pricing-constants.ts";
import {
  pricingCatalogEnvelopeSchema,
  type PricingCatalog,
  type PricingCatalogEnvelope,
} from "./pricing-schema.ts";
import { validatePricingCatalog } from "./pricing-validation.ts";
import type { Catalog } from "./schema.ts";

function catalogCoreData(catalog: Catalog) {
  return {
    providers: catalog.providers,
    models: catalog.models,
    sources: catalog.sources,
    coverage: catalog.coverage,
  };
}

export function createPricingCatalogEnvelope(
  data: PricingCatalog,
  catalog: Catalog,
): PricingCatalogEnvelope {
  const envelope = pricingCatalogEnvelopeSchema.parse({
    pricing_data_version: canonicalJsonHash(data),
    core_catalog_version: catalog.catalog_version,
    core_data_sha256: canonicalJsonHash(catalogCoreData(catalog)),
    generated_at: catalog.generated_at,
    data,
  });
  validatePricingCatalogEnvelope(envelope, catalog);
  return envelope;
}

export function validatePricingCatalogEnvelope(
  envelope: PricingCatalogEnvelope,
  catalog: Catalog,
): void {
  if (envelope.pricing_data_version !== canonicalJsonHash(envelope.data))
    throw new Error("Pricing data version does not match canonical data");
  if (envelope.core_catalog_version !== catalog.catalog_version)
    throw new Error("Pricing core catalog version does not match the catalog");
  if (envelope.core_data_sha256 !== canonicalJsonHash(catalogCoreData(catalog)))
    throw new Error("Pricing core data hash does not match the catalog");
  if (envelope.generated_at !== catalog.generated_at)
    throw new Error("Pricing generation time does not match the catalog");
  for (const snapshot of envelope.data.provider_snapshots) {
    const currentAt =
      snapshot.publication === "fresh"
        ? snapshot.observed_at
        : snapshot.refresh_failure.attempted_at;
    if (currentAt !== envelope.generated_at)
      throw new Error(`Provider ${snapshot.provider_id} has the wrong refresh time`);
  }
  validatePricingCatalog(envelope.data, catalog);
}

export function pricingCatalogJson(envelope: PricingCatalogEnvelope, catalog: Catalog): string {
  pricingCatalogEnvelopeSchema.parse(envelope);
  validatePricingCatalogEnvelope(envelope, catalog);
  return canonicalJson(envelope);
}

export function decodePricingCatalog(input: Uint8Array, catalog: Catalog): PricingCatalogEnvelope {
  const value = assertCanonicalJson(input, pricingLimits.pricingInputBytes);
  const envelope = pricingCatalogEnvelopeSchema.parse(value);
  validatePricingCatalogEnvelope(envelope, catalog);
  return envelope;
}
