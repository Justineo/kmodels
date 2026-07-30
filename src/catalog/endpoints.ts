import type { AssetSource } from "./asset-pack.ts";
import { stableCompactJson, stableJson } from "./io.ts";
import { catalogIds, catalogModels } from "./publication.ts";
import { catalogProvidersSchema } from "./publication-schema.ts";
import type { PricingCatalog } from "./pricing-schema.ts";
import type { Catalog, CatalogEnvelope } from "./schema.ts";
import { websitePublication } from "./website-data.ts";

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

export function catalogExportAssets(
  catalog: Catalog,
  catalogAssetSource = catalogJson(catalog),
): AssetSource[] {
  const models = catalogModels(catalog);
  const providerEntries = Object.entries(models.providers);
  const metadata = {
    catalog_version: catalog.catalog_version,
    generated_at: catalog.generated_at,
  };
  const providers = catalogProvidersSchema.parse({
    schema_version: 1,
    profile: "providers",
    ...metadata,
    providers: Object.fromEntries(
      providerEntries.map(([id, { models: _, ...provider }]) => [id, provider]),
    ),
  });
  return [
    {
      fileName: "catalog/index.json",
      source: catalogAssetSource,
    },
    {
      fileName: "catalog/ids.json",
      source: stableCompactJson(catalogIds(catalog)),
    },
    {
      fileName: "catalog/models.json",
      source: stableCompactJson(models),
    },
    {
      fileName: "providers/index.json",
      source: stableCompactJson(providers),
    },
    ...providerEntries.flatMap(([providerId, { models: providerModels, ...provider }]) => [
      {
        fileName: `providers/${providerId}/index.json`,
        source: stableCompactJson({
          schema_version: 1,
          profile: "provider",
          ...metadata,
          provider_id: providerId,
          provider,
        }),
      },
      {
        fileName: `providers/${providerId}/models/index.json`,
        source: stableCompactJson({
          schema_version: 1,
          profile: "provider-models",
          ...metadata,
          provider_id: providerId,
          models: providerModels,
        }),
      },
    ]),
  ];
}

export function websiteAssets(
  catalog: Catalog,
  pricing: PricingCatalog,
  dataVersion: string,
): AssetSource[] {
  const website = websitePublication(catalog, pricing, dataVersion);
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
