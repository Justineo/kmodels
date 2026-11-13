import { createAssetPack, type EncodedAssetPack } from "./asset-pack.ts";
import { catalogExportAssets, websiteAssets } from "./endpoints.ts";
import { sha256 } from "./io.ts";
import { priceDataExportAssets } from "./pricing-lookup-export.ts";
import type { PricingCatalogEnvelope } from "./pricing-schema.ts";
import type { Catalog } from "./schema.ts";
import { inferencePricingPath, type InferencePricingPublication } from "./inference-pricing.ts";
import { websiteInferencePrices } from "./website-inference-pricing.ts";
import { withPricingCanonicalCache } from "./pricing-canonical.ts";

export interface ProjectionInput {
  pairId: string;
  catalog: Catalog;
  pricing: PricingCatalogEnvelope;
  catalogAssetSource: string;
  pricingAssetSource: string;
  pricingAssetChunks?: readonly string[];
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
    `website-core-v5\u0000${catalogVersion}\u0000${pricingDataVersion}${inferenceSource === undefined ? "" : `\u0000inference-matching-v3\u0000${sha256(inferenceSource)}`}`,
  );
}

export async function projectCatalogPair(input: ProjectionInput): Promise<PairProjections> {
  const dataVersion = websiteDataVersion(
    input.catalog.catalog_version,
    input.pricing.pricing_data_version,
    input.inference?.source,
  );
  // Projection indexes are temporary even when the caller retains the old pair.
  // End the synchronous cache scope before asynchronous encoding/compression.
  const { uiAssets, exportAssets } = withPricingCanonicalCache(() =>
    projectionAssets(input, dataVersion),
  );
  const [ui, exports] = await Promise.all([
    createAssetPack("ui", input.pairId, dataVersion, uiAssets),
    createAssetPack("exports", input.pairId, input.pairId, exportAssets),
  ]);
  return { ui, exports };
}

function projectionAssets(input: ProjectionInput, dataVersion: string) {
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
    input.pricingAssetChunks === undefined
      ? { fileName: "pricing/index.json", source: input.pricingAssetSource }
      : { fileName: "pricing/index.json", sourceChunks: input.pricingAssetChunks },
    ...priceDataExportAssets(input.catalog, input.pricing),
    ...(input.inference === undefined
      ? []
      : [{ fileName: inferencePricingPath, source: input.inference.source }]),
  ];
  return { uiAssets, exportAssets };
}
