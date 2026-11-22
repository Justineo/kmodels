import { createAssetPack, type EncodedAssetPack } from "./asset-pack.ts";
import { catalogExportAssets, websiteAssets } from "./endpoints.ts";
import { sha256 } from "./io.ts";
import { priceDataExport, priceDataExportAssets } from "./pricing-lookup-export.ts";
import { validatePriceData } from "../pricing/validation.ts";
import type { PricingCatalogEnvelope } from "./pricing-schema.ts";
import type { Catalog } from "./schema.ts";
import { inferencePricingPath, type InferencePricingPublication } from "./inference-pricing.ts";
import { websiteInferencePrices } from "./website-inference-pricing.ts";
import { withPricingCanonicalCache } from "./pricing-canonical.ts";
import { hasClaimStatements } from "./model-claim-details.ts";

export interface ProjectionInput {
  pairId: string;
  catalog: Catalog;
  pricing: PricingCatalogEnvelope;
  catalogAssetSource: string;
  pricingAssetChunks: readonly string[];
  inference?: InferencePricingPublication | undefined;
}

export interface PairProjections {
  ui: EncodedAssetPack;
  exports: EncodedAssetPack;
}

export function hasScopedLimitDetails(catalog: Pick<Catalog, "models">): boolean {
  return catalog.models.some((model) => hasClaimStatements(model.limit_details));
}

export function websiteDataVersion(
  catalogVersion: string,
  pricingDataVersion: string,
  inferenceSource?: string,
  scopedLimitDetails = false,
  scopedCapabilityDetails = false,
): string {
  const identity = ["website-core-v7", catalogVersion, pricingDataVersion];
  if (inferenceSource !== undefined)
    identity.push("inference-matching-v3", sha256(inferenceSource));
  if (scopedLimitDetails) identity.push("model-limit-details-v8");
  if (scopedCapabilityDetails) identity.push("model-capability-details-v9");
  if (scopedLimitDetails || scopedCapabilityDetails || inferenceSource !== undefined)
    identity.push("model-details-v12");
  return sha256(identity.join("\0"));
}

export function websiteDataVersionForCatalog(
  catalog: Pick<Catalog, "catalog_version" | "models">,
  pricingDataVersion: string,
  inferenceSource?: string,
): string {
  return websiteDataVersion(
    catalog.catalog_version,
    pricingDataVersion,
    inferenceSource,
    hasScopedLimitDetails(catalog),
    catalog.models.some(({ capability_details }) => hasClaimStatements(capability_details)),
  );
}

export function websiteDataVersionForPair(
  input: Pick<ProjectionInput, "catalog" | "pricing" | "inference">,
): string {
  const version = websiteDataVersionForCatalog(
    input.catalog,
    input.pricing.pricing_data_version,
    input.inference?.source,
  );
  return input.pricing.data.books.length ? sha256(`${version}\0service-prices-v1`) : version;
}

export async function projectCatalogPair(input: ProjectionInput): Promise<PairProjections> {
  const dataVersion = websiteDataVersionForPair(input);
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
  const prices =
    input.pricing.data.provider_snapshots.length === 0
      ? undefined
      : validatePriceData(priceDataExport(input.catalog, input.pricing));
  const uiAssets = websiteAssets(
    input.catalog,
    input.pricing.data,
    dataVersion,
    input.inference === undefined
      ? undefined
      : websiteInferencePrices(input.catalog, input.pricing, input.inference.mapping, prices),
  );
  const exportAssets = [
    ...catalogExportAssets(input.catalog, input.catalogAssetSource),
    { fileName: "pricing/index.json", sourceChunks: input.pricingAssetChunks },
    ...(prices === undefined ? [] : priceDataExportAssets(prices)),
    ...(input.inference === undefined
      ? []
      : [{ fileName: inferencePricingPath, source: input.inference.source }]),
  ];
  return { uiAssets, exportAssets };
}
