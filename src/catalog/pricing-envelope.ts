import { assertCanonicalJson, canonicalJsonHash } from "./canonical-json.ts";
import { canonicalJsonFromValidated } from "./canonical-value.ts";
import { sha256 } from "./io.ts";
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
  const dataSource = validatedPricingDataSource(data, catalog);
  return createPricingCatalogEnvelopeFromValidatedData(data, catalog, sha256(dataSource));
}

export function createPricingCatalogEnvelopeFromValidatedData(
  data: PricingCatalog,
  catalog: Catalog,
  canonicalDataHash: string,
): PricingCatalogEnvelope {
  const envelope: PricingCatalogEnvelope = {
    pricing_data_version: canonicalDataHash,
    core_catalog_version: catalog.catalog_version,
    core_data_sha256: canonicalJsonHash(catalogCoreData(catalog)),
    generated_at: catalog.generated_at,
    data,
  };
  validateSnapshotTimes(envelope);
  return envelope;
}

export function validatePricingCatalogEnvelope(
  envelope: PricingCatalogEnvelope,
  catalog: Catalog,
): void {
  validatedEnvelopeDataSource(envelope, catalog);
}

function validatedEnvelopeDataSource(envelope: PricingCatalogEnvelope, catalog: Catalog): string {
  const source = validatedPricingDataSource(envelope.data, catalog);
  validatePricingCatalogEnvelopeMetadata(envelope, catalog, sha256(source));
  return source;
}

function validatedPricingDataSource(data: PricingCatalog, catalog: Catalog): string {
  validatePricingCatalog(data, catalog);
  return canonicalJsonFromValidated(data);
}

export function validatePricingCatalogEnvelopeMetadata(
  envelope: PricingCatalogEnvelope,
  catalog: Catalog,
  canonicalDataHash: string,
): void {
  if (envelope.pricing_data_version !== canonicalDataHash)
    throw new Error("Pricing data version does not match canonical data");
  if (envelope.core_catalog_version !== catalog.catalog_version)
    throw new Error("Pricing core catalog version does not match the catalog");
  if (envelope.core_data_sha256 !== canonicalJsonHash(catalogCoreData(catalog)))
    throw new Error("Pricing core data hash does not match the catalog");
  if (envelope.generated_at !== catalog.generated_at)
    throw new Error("Pricing generation time does not match the catalog");
  validateSnapshotTimes(envelope);
}

function validateSnapshotTimes(envelope: PricingCatalogEnvelope): void {
  for (const snapshot of envelope.data.provider_snapshots) {
    const currentAt =
      snapshot.publication === "fresh"
        ? snapshot.observed_at
        : snapshot.refresh_failure.attempted_at;
    if (currentAt !== envelope.generated_at)
      throw new Error(`Provider ${snapshot.provider_id} has the wrong refresh time`);
  }
}

export function pricingCatalogJson(envelope: PricingCatalogEnvelope, catalog: Catalog): string {
  const parsed = pricingCatalogEnvelopeSchema.parse(envelope);
  return pricingCatalogJsonFromValidatedData(parsed, validatedEnvelopeDataSource(parsed, catalog));
}

export function pricingCatalogJsonFromValidatedData(
  envelope: PricingCatalogEnvelope,
  canonicalDataSource: string,
): string {
  return `{"core_catalog_version":${JSON.stringify(envelope.core_catalog_version)},"core_data_sha256":${JSON.stringify(envelope.core_data_sha256)},"data":${canonicalDataSource},"generated_at":${JSON.stringify(envelope.generated_at)},"pricing_data_version":${JSON.stringify(envelope.pricing_data_version)}}`;
}

export function decodePricingCatalog(input: Uint8Array, catalog: Catalog): PricingCatalogEnvelope {
  const value = assertCanonicalJson(input, pricingLimits.pricingInputBytes);
  const envelope = pricingCatalogEnvelopeSchema.parse(value);
  validatePricingCatalogEnvelope(envelope, catalog);
  return envelope;
}
