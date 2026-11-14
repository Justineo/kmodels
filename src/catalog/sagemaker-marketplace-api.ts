import { SageMakerClient } from "@aws-sdk/client-sagemaker";
import { mapConcurrent } from "./concurrency.ts";
import type { FetchPayload, FetchResult, FetchObservation, StatusPayload } from "./fetch.ts";
import { sha256 } from "./io.ts";
import type { SourceManifest } from "./manifests.ts";
import { normalizeSagemakerMarketplaceApi } from "./sagemaker-pricing.ts";
import {
  sagemakerCatalogUrl,
  sagemakerManifestUrl,
  sagemakerPricingSpecs,
  sagemakerRows,
  sagemakerCacheUrl,
  sagemakerSpecSchema,
} from "./sagemaker.ts";

const endpoint = "https://discovery.marketplace.us-east-1.amazonaws.com/GetListingView";

export async function fetchSagemakerMarketplaceApi(
  source: SourceManifest,
  readPublic: (source: SourceManifest) => Promise<FetchPayload>,
  post: (body: string, send: () => Promise<Response>) => Promise<StatusPayload>,
): Promise<FetchResult> {
  if (
    source.url !== endpoint ||
    !source.allowedHosts.includes(new URL(endpoint).hostname) ||
    source.auth?.scheme !== "aws"
  )
    throw new Error("SageMaker Marketplace API escaped its reviewed origin");
  const { auth: _auth, ...publicSource } = source;
  void _auth;
  const dependencies: FetchObservation[] = [];
  const read = async (
    key: string,
    url: string,
    format: SourceManifest["format"],
    maxMiB: number,
  ) => {
    const result = await readPublic({
      ...publicSource,
      access: "public",
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
  const [catalog, manifest] = await Promise.all([
    read("catalog", sagemakerCatalogUrl, "html", 4),
    read("manifest", sagemakerManifestUrl, "json", 4),
  ]);
  const headers = sagemakerPricingSpecs(manifest, sagemakerRows(catalog), true);
  if (headers.length > 512)
    throw new Error("SageMaker Marketplace model discovery exceeded its bound");
  const specs = await mapConcurrent(headers, 4, async (header) => {
    const path = `proprietary-models/${encodeURIComponent(header.model_id)}/${encodeURIComponent(`proprietary_specs_${header.version}.json`)}`;
    const body = await read(
      `spec/${header.model_id}/${sha256(header.version)}`,
      `${sagemakerCacheUrl}${path}`,
      "json",
      2,
    );
    const spec = sagemakerSpecSchema.parse(JSON.parse(body));
    if (spec.model_id !== header.model_id || spec.version !== header.version)
      throw new Error("SageMaker Marketplace spec identity changed");
    return spec;
  });
  const ids = [...new Set(specs.map(({ listing_id }) => listing_id))].sort();
  const client = new SageMakerClient({ region: "us-east-1" });
  try {
    const signer = await client.config.signer();
    const host = new URL(endpoint).hostname;
    const listings = await mapConcurrent(ids, 4, async (id) => {
      const body = JSON.stringify({
        ViewQuery: { Name: "listingPricingSummaryByListingId", Version: 1 },
        Parameters: JSON.stringify({ listingId: id, id }),
        RequestContext: { IntegrationId: "integ-v27la47re4rlo", Locale: "en" },
        ExecutionSemantics: "ALL_OR_NOTHING",
      });
      const response = await post(body, async () => {
        const signed = await signer.sign(
          {
            protocol: "https:",
            hostname: host,
            method: "POST",
            path: "/GetListingView",
            headers: { host, "content-type": "application/json" },
            body,
          },
          { signingRegion: "us-east-1", signingService: "aws-marketplace" },
        );
        return fetch(endpoint, {
          method: "POST",
          headers: signed.headers,
          body,
          redirect: "error",
          signal: AbortSignal.timeout(30_000),
        });
      });
      const normalized =
        response.status === 200
          ? normalizeSagemakerMarketplaceApi(JSON.parse(response.body), id)
          : JSON.stringify({ listing_id: id, terms: [], status: "unavailable" });
      // Persist only the consumed default-listing pricing projection, never account/session data.
      dependencies.push({
        key: `${source.id}/listing/${id}`,
        contentHash: sha256(normalized),
        etag: undefined,
        lastModified: undefined,
      });
      return { id, body: normalized };
    });
    const body = JSON.stringify({ specs, listings });
    if (Buffer.byteLength(body) > source.maxResponseBytes)
      throw new Error("SageMaker Marketplace API bundle exceeded byte limit");
    return {
      body,
      contentHash: sha256(body),
      etag: undefined,
      lastModified: undefined,
      dependencies: dependencies.sort((a, b) => a.key.localeCompare(b.key)),
    };
  } finally {
    client.destroy();
  }
}
