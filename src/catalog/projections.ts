import { createAssetPack, type EncodedAssetPack } from "./asset-pack.ts";
import { catalogExportAssets, websiteAssets } from "./endpoints.ts";
import { sha256 } from "./io.ts";
import { calculationExportAssets } from "./pricing-calculator-export.ts";
import { calculationV2ExportAssets } from "./pricing-calculator-v2-export.ts";
import type { PricingCatalogEnvelope } from "./pricing-schema.ts";
import type { Catalog } from "./schema.ts";
import { publicationManifestAsset, v2CatalogAssets, type V2Publication } from "./publication-v2.ts";

export interface ProjectionInput {
  pairId: string;
  catalog: Catalog;
  pricing: PricingCatalogEnvelope;
  catalogAssetSource: string;
  pricingAssetSource: string;
  v2?: V2Publication;
}

export interface PairProjections {
  ui: EncodedAssetPack;
  exports: EncodedAssetPack;
}

export function websiteDataVersion(catalogVersion: string, pricingDataVersion: string): string {
  return sha256(`website-core-v3\u0000${catalogVersion}\u0000${pricingDataVersion}`);
}

export function pairWebsiteDataVersion(input: ProjectionInput): string {
  return websiteDataVersion(
    input.v2?.catalog.catalog_version ?? input.catalog.catalog_version,
    input.v2?.pricing.pricing_data_version ?? input.pricing.pricing_data_version,
  );
}

export async function projectCatalogPair(input: ProjectionInput): Promise<PairProjections> {
  const dataVersion = pairWebsiteDataVersion(input);
  const uiAssets = websiteAssets(
    input.catalog,
    input.v2?.pricing.data ?? input.pricing.data,
    dataVersion,
    input.v2?.pricing.data.invocation_bindings,
  );
  const exportAssets = [
    ...catalogExportAssets(input.catalog, input.catalogAssetSource),
    { fileName: "pricing/index.json", source: input.pricingAssetSource },
    ...calculationExportAssets(input.catalog, input.pricing),
  ];
  if (input.v2 !== undefined) {
    exportAssets.push(...v2CatalogAssets(input.catalog, input.v2));
    exportAssets.push(...(await calculationV2ExportAssets(input.v2)));
    exportAssets.push(
      publicationManifestAsset(input.catalog, input.pricing, input.v2, exportAssets),
    );
  }
  const [ui, exports] = await Promise.all([
    createAssetPack("ui", input.pairId, dataVersion, uiAssets),
    createAssetPack("exports", input.pairId, input.pairId, exportAssets),
  ]);
  return {
    ui,
    exports,
  };
}
