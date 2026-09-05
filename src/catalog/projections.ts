import { createAssetPack, type EncodedAssetPack } from "./asset-pack.ts";
import { catalogExportAssets, websiteAssets } from "./endpoints.ts";
import { sha256 } from "./io.ts";
import { calculationExportAssets } from "./pricing-calculator-export.ts";
import type { PricingCatalogEnvelope } from "./pricing-schema.ts";
import type { Catalog } from "./schema.ts";

export interface ProjectionInput {
  pairId: string;
  catalog: Catalog;
  pricing: PricingCatalogEnvelope;
  catalogAssetSource: string;
  pricingAssetSource: string;
}

export interface PairProjections {
  ui: EncodedAssetPack;
  exports: EncodedAssetPack;
}

export function websiteDataVersion(catalogVersion: string, pricingDataVersion: string): string {
  return sha256(`${catalogVersion}\u0000${pricingDataVersion}`);
}

export async function projectCatalogPair(input: ProjectionInput): Promise<PairProjections> {
  const dataVersion = websiteDataVersion(
    input.catalog.catalog_version,
    input.pricing.pricing_data_version,
  );
  const uiAssets = websiteAssets(input.catalog, input.pricing.data, dataVersion);
  const exportAssets = [
    ...catalogExportAssets(input.catalog, input.catalogAssetSource),
    { fileName: "pricing/index.json", source: input.pricingAssetSource },
    ...calculationExportAssets(input.catalog, input.pricing),
  ];
  const [ui, exports] = await Promise.all([
    createAssetPack("ui", input.pairId, dataVersion, uiAssets),
    createAssetPack("exports", input.pairId, input.pairId, exportAssets),
  ]);
  return {
    ui,
    exports,
  };
}
