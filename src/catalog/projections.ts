import { createAssetPack, type EncodedAssetPack } from "./asset-pack.ts";
import { catalogExportAssets, websiteAssets } from "./endpoints.ts";
import { sha256 } from "./io.ts";
import { calculationExportAssets } from "./pricing-calculator-export.ts";
import type { PricingCatalogEnvelope } from "./pricing-schema.ts";
import type { Catalog } from "./schema.ts";
import { inferencePricingPath, type InferencePricingPublication } from "./inference-pricing.ts";
import { websiteInferencePrices } from "./website-inference-pricing.ts";

export interface ProjectionInput {
  pairId: string;
  catalog: Catalog;
  pricing: PricingCatalogEnvelope;
  catalogAssetSource: string;
  pricingAssetSource: string;
  inference?: InferencePricingPublication;
}

export interface PairProjections {
  ui: EncodedAssetPack;
  exports: EncodedAssetPack;
}

export function websiteDataVersion(
  catalogVersion: string,
  pricingDataVersion: string,
  inferenceSource?: string,
): string {
  return sha256(
    `website-core-v4\u0000${catalogVersion}\u0000${pricingDataVersion}${inferenceSource === undefined ? "" : `\u0000inference-matching-v2\u0000${sha256(inferenceSource)}`}`,
  );
}

export async function projectCatalogPair(input: ProjectionInput): Promise<PairProjections> {
  const dataVersion = websiteDataVersion(
    input.catalog.catalog_version,
    input.pricing.pricing_data_version,
    input.inference?.source,
  );
  const uiAssets = websiteAssets(
    input.catalog,
    input.pricing.data,
    dataVersion,
    input.inference === undefined
      ? undefined
      : websiteInferencePrices(input.catalog, input.pricing, input.inference.mapping),
  );
  const exportAssets = [
    ...catalogExportAssets(input.catalog, input.catalogAssetSource),
    { fileName: "pricing/index.json", source: input.pricingAssetSource },
    ...calculationExportAssets(input.catalog, input.pricing),
    ...(input.inference === undefined
      ? []
      : [{ fileName: inferencePricingPath, source: input.inference.source }]),
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
