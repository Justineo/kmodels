import type { FetchPayload, FetchResult, FetchObservation } from "./fetch.ts";
import { mapConcurrent } from "./concurrency.ts";
import { sha256 } from "./io.ts";
import type { SourceManifest } from "./manifests.ts";
import { normalizeSagemakerMarketplace } from "./sagemaker-pricing.ts";
import { projectSagemakerSpec, sagemakerOpenSpecs } from "./sagemaker-sdk.ts";
import {
  sagemakerCacheUrl,
  sagemakerManifestUrl,
  sagemakerOpenManifestUrl,
  sagemakerPricesUrl,
  sagemakerPricingSpecs,
  sagemakerRows,
  sagemakerSpecSchema,
} from "./sagemaker.ts";

export async function fetchSagemakerPricing(
  source: SourceManifest,
  fetchPayload: (source: SourceManifest) => Promise<FetchPayload>,
): Promise<FetchResult> {
  const dependencies: FetchObservation[] = [];
  const read = async (
    key: string,
    url: string,
    maxMiB: number,
    format: SourceManifest["format"],
  ) => {
    const result = await fetchPayload({
      ...source,
      url,
      format,
      maxResponseBytes: maxMiB * 1024 * 1024,
    });
    dependencies.push({
      key: `${source.id}/${key}`,
      contentHash: result.contentHash,
      etag: result.etag,
      lastModified: result.lastModified,
    });
    return result.body;
  };
  const [catalog, manifest, openManifest, prices] = await Promise.all([
    read("catalog", source.url, 4, "html"),
    read("manifest", sagemakerManifestUrl, 4, "json"),
    read("open-manifest", sagemakerOpenManifestUrl, 32, "json"),
    read("prices", sagemakerPricesUrl, 128, "json"),
  ]);
  const headers = sagemakerPricingSpecs(manifest, sagemakerRows(catalog), true);
  const specs = await mapConcurrent(headers, 4, async (header) => {
    const key = `proprietary-models/${encodeURIComponent(header.model_id)}/${encodeURIComponent(`proprietary_specs_${header.version}.json`)}`;
    const body = await read(
      `spec/${header.model_id}/${sha256(header.version)}`,
      `${sagemakerCacheUrl}${key}`,
      2,
      "json",
    );
    const spec = sagemakerSpecSchema.parse(JSON.parse(body));
    if (spec.model_id !== header.model_id || spec.version !== header.version)
      throw new Error("SageMaker pricing spec identity changed");
    return spec;
  });
  const ids = [...new Set(specs.map((spec) => spec.listing_id))].sort();
  const listings = await mapConcurrent(ids, 4, async (id) => {
    const body = await read(
      `listing/${id}`,
      `https://aws.amazon.com/marketplace/pp/${id}`,
      4,
      "html",
    );
    return { id, body: normalizeSagemakerMarketplace(body, id) };
  });
  const body = JSON.stringify({
    catalog,
    openManifest,
    proprietaryManifest: manifest,
    prices,
    specs,
    listings,
  });
  if (Buffer.byteLength(body) > source.maxResponseBytes)
    throw new Error("SageMaker pricing bundle exceeded byte limit");
  return {
    body,
    contentHash: sha256(body),
    etag: undefined,
    lastModified: undefined,
    dependencies: dependencies.sort((a, b) => a.key.localeCompare(b.key)),
  };
}

export async function fetchSagemakerSdk(
  source: SourceManifest,
  fetchPayload: (source: SourceManifest) => Promise<FetchPayload>,
): Promise<FetchResult> {
  const dependencies: FetchObservation[] = [];
  const read = async (
    key: string,
    url: string,
    maxMiB: number,
    format: SourceManifest["format"],
  ) => {
    const result = await fetchPayload({
      ...source,
      url,
      format,
      maxResponseBytes: maxMiB * 1024 * 1024,
    });
    dependencies.push({
      key: `${source.id}/${key}`,
      contentHash: result.contentHash,
      etag: result.etag,
      lastModified: result.lastModified,
    });
    return result.body;
  };
  const [catalog, open, proprietary] = await Promise.all([
    read("catalog", source.url, 4, "html"),
    read("open-manifest", sagemakerOpenManifestUrl, 32, "json"),
    read("proprietary-manifest", sagemakerManifestUrl, 4, "json"),
  ]);
  const rows = sagemakerRows(catalog);
  const headers = [
    ...sagemakerOpenSpecs(open, rows),
    ...sagemakerPricingSpecs(proprietary, rows, true),
  ];
  const models = await mapConcurrent(headers, 8, async (header) => {
    const path = header.spec_key.split("/").map(encodeURIComponent).join("/");
    const body = await read(
      `spec/${header.model_id}/${sha256(header.version)}`,
      `${sagemakerCacheUrl}${path}`,
      4,
      "json",
    );
    try {
      return projectSagemakerSpec(body, header);
    } catch (error) {
      throw new Error(
        `SageMaker spec ${header.model_id}: ${error instanceof Error ? error.message : "invalid metadata"}`,
      );
    }
  });
  const body = JSON.stringify(models.sort((a, b) => a.id.localeCompare(b.id)));
  if (Buffer.byteLength(body) > source.maxResponseBytes)
    throw new Error("SageMaker metadata bundle exceeded byte limit");
  return {
    body,
    contentHash: sha256(body),
    etag: undefined,
    lastModified: undefined,
    dependencies: dependencies.sort((a, b) => a.key.localeCompare(b.key)),
  };
}
