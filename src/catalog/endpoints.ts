import { stableJson } from "./io.ts";
import type { Catalog } from "./schema.ts";

export interface CatalogAsset {
  fileName: string;
  source: string;
}

export function catalogAssets(catalog: Catalog): CatalogAsset[] {
  const metadata = {
    catalog_version: catalog.catalog_version,
    generated_at: catalog.generated_at,
  };
  return [
    {
      fileName: "v1/catalog/index.json",
      source: stableJson({
        ...metadata,
        data: {
          providers: catalog.providers,
          models: catalog.models,
          sources: catalog.sources,
          coverage: catalog.coverage,
        },
        warnings: catalog.warnings,
      }),
    },
    {
      fileName: "v1/providers/index.json",
      source: stableJson({
        ...metadata,
        data: catalog.providers,
        warnings: catalog.warnings,
      }),
    },
    ...catalog.providers.flatMap((provider) => [
      {
        fileName: `v1/providers/${provider.id}/index.json`,
        source: stableJson({
          ...metadata,
          data: provider,
          warnings: catalog.warnings,
        }),
      },
      {
        fileName: `v1/providers/${provider.id}/models/index.json`,
        source: stableJson({
          ...metadata,
          data: catalog.models.filter((model) => model.provider_id === provider.id),
          warnings: catalog.warnings,
        }),
      },
    ]),
  ];
}
