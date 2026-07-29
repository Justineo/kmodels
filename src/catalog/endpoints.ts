import { sha256, stableCompactJson, stableJson } from "./io.ts";
import { pricingCatalogJson } from "./pricing-envelope.ts";
import type { PricingCatalogEnvelope } from "./pricing-schema.ts";
import { catalogIds, catalogModels } from "./publication.ts";
import type { Catalog, CatalogEnvelope } from "./schema.ts";
import { websitePublication } from "./website-data.ts";

export interface CatalogAsset {
  fileName: string;
  source: string;
}

function catalogEnvelope(catalog: Catalog): CatalogEnvelope {
  const metadata = {
    catalog_version: catalog.catalog_version,
    generated_at: catalog.generated_at,
  };
  return {
    ...metadata,
    data: {
      providers: catalog.providers,
      models: catalog.models,
      sources: catalog.sources,
      coverage: catalog.coverage,
    },
    warnings: catalog.warnings,
  };
}

export function catalogJson(catalog: Catalog): string {
  return stableJson(catalogEnvelope(catalog));
}

export function catalogApiAssets(catalog: Catalog): CatalogAsset[] {
  const metadata = {
    catalog_version: catalog.catalog_version,
    generated_at: catalog.generated_at,
  };
  return [
    {
      fileName: "catalog/index.json",
      source: catalogJson(catalog),
    },
    {
      fileName: "catalog/ids.json",
      source: stableCompactJson(catalogIds(catalog)),
    },
    {
      fileName: "catalog/models.json",
      source: stableCompactJson(catalogModels(catalog)),
    },
    {
      fileName: "providers/index.json",
      source: stableJson({
        ...metadata,
        data: catalog.providers,
        warnings: catalog.warnings,
      }),
    },
    ...catalog.providers.flatMap((provider) => [
      {
        fileName: `providers/${provider.id}/index.json`,
        source: stableJson({
          ...metadata,
          data: provider,
          warnings: catalog.warnings,
        }),
      },
      {
        fileName: `providers/${provider.id}/models/index.json`,
        source: stableJson({
          ...metadata,
          data: catalog.models.filter((model) => model.provider_id === provider.id),
          warnings: catalog.warnings,
        }),
      },
    ]),
  ];
}

export function catalogAssets(catalog: Catalog, pricing: PricingCatalogEnvelope): CatalogAsset[] {
  return [
    ...catalogApiAssets(catalog),
    {
      fileName: "pricing/index.json",
      source: pricingCatalogJson(pricing, catalog),
    },
    ...websiteAssets(catalog, pricing),
  ];
}

export function websiteAssets(catalog: Catalog, pricing: PricingCatalogEnvelope): CatalogAsset[] {
  const dataVersion = sha256(`${catalog.catalog_version}\u0000${pricing.pricing_data_version}`);
  const website = websitePublication(catalog, pricing.data, dataVersion);
  return [
    {
      fileName: "ui/catalog/index.json",
      source: JSON.stringify(website.catalog),
    },
    {
      fileName: "ui/catalog/pricing.json",
      source: JSON.stringify(website.pricing),
    },
    ...website.details.map((detail) => ({
      fileName: `ui/details/${detail.provider_id}/${detail.chunk}.json`,
      source: JSON.stringify(detail),
    })),
  ];
}
