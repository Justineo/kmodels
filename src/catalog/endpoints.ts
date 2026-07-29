import { stableJson } from "./io.ts";
import { pricingCatalogJson } from "./pricing-envelope.ts";
import type { PricingCatalogEnvelope } from "./pricing-schema.ts";
import type { Catalog, CatalogEnvelope } from "./schema.ts";
import { websiteCatalog, websiteModelDetails } from "./website-data.ts";

interface CatalogAsset {
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

function websiteAssets(catalog: Catalog, pricing: PricingCatalogEnvelope): CatalogAsset[] {
  const website = websiteCatalog(catalog, pricing.data);
  return [
    {
      fileName: "ui/catalog/index.json",
      source: JSON.stringify(website),
    },
    ...[...websiteModelDetails(catalog, pricing.data)].map(([reference, detail]) => ({
      fileName: `ui/models/${reference}.json`,
      source: JSON.stringify(detail),
    })),
  ];
}
