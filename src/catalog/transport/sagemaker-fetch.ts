import {
  DescribeHubContentCommand,
  ListHubContentsCommand,
  SageMakerClient,
} from "@aws-sdk/client-sagemaker";
import { DefaultRateLimiter } from "@smithy/core/retry";
import { mapConcurrent } from "../concurrency.ts";

export interface RawSagemakerHubModel {
  id: string;
  version: string;
  displayName?: string;
  description?: string;
  document: string;
  hubContentStatus?: string;
  supportStatus?: string;
}

export const sagemakerMarketplaceEndpoint =
  "https://discovery.marketplace.us-east-1.amazonaws.com/GetListingView";

/**
 * Sealed AWS SDK transport for listing and describing reviewed SageMaker Public Hub models.
 * Must remain free of HTML/document parsers, manifests, and catalog assembly logic.
 */
export async function fetchSagemakerPublicHubModels(
  region: string,
  admitted: ReadonlySet<string>,
): Promise<RawSagemakerHubModel[]> {
  const client = new SageMakerClient({ region, maxAttempts: 3, retryMode: "adaptive" });
  const common = { HubName: "SageMakerPublicHub", HubContentType: "Model" as const };
  try {
    const selected = new Map<string, { id: string; version: string }>();
    const tokens = new Set<string>();
    let next: string | undefined;
    let finished = false;
    for (let page = 0; page < 100; page += 1) {
      const result = await client.send(
        new ListHubContentsCommand({
          ...common,
          MaxResults: 100,
          ...(next === undefined ? {} : { NextToken: next }),
        }),
        { abortSignal: AbortSignal.timeout(90_000) },
      );
      for (const row of result.HubContentSummaries ?? []) {
        if (row.HubContentName === undefined || !admitted.has(row.HubContentName)) continue;
        if (!row.HubContentVersion || selected.has(row.HubContentName))
          throw new Error("SageMaker public hub summary identity changed");
        selected.set(row.HubContentName, {
          id: row.HubContentName,
          version: row.HubContentVersion,
        });
      }
      next = result.NextToken;
      if (!next) {
        finished = true;
        break;
      }
      if (tokens.has(next)) throw new Error("SageMaker public hub pagination repeated a token");
      tokens.add(next);
    }
    if (!finished || selected.size === 0)
      throw new Error("SageMaker public hub inventory was incomplete");
    return await mapConcurrent([...selected.values()], 2, async ({ id, version }) => {
      const result = await client.send(
        new DescribeHubContentCommand({
          ...common,
          HubContentName: id,
          HubContentVersion: version,
        }),
        { abortSignal: AbortSignal.timeout(90_000) },
      );
      if (
        result.HubContentName !== id ||
        result.HubContentVersion !== version ||
        !result.HubContentDocument
      )
        throw new Error("SageMaker public hub detail identity changed");
      return {
        id,
        version,
        ...(result.HubContentDisplayName === undefined
          ? {}
          : { displayName: result.HubContentDisplayName }),
        ...(result.HubContentDescription === undefined
          ? {}
          : { description: result.HubContentDescription }),
        document: result.HubContentDocument,
        ...(result.HubContentStatus === undefined
          ? {}
          : { hubContentStatus: result.HubContentStatus }),
        ...(result.SupportStatus === undefined ? {} : { supportStatus: result.SupportStatus }),
      };
    });
  } finally {
    client.destroy();
  }
}

export interface SagemakerMarketplaceTransport {
  postListingView(body: string): Promise<Response>;
  destroy(): void;
}

/**
 * Sealed AWS SigV4 transport hardcoded exclusively to the reviewed AWS Marketplace
 * GetListingView endpoint. Callers cannot redirect signed credentials to any other URL.
 */
export async function createSagemakerMarketplaceTransport(): Promise<SagemakerMarketplaceTransport> {
  const client = new SageMakerClient({ region: "us-east-1" });
  const rateLimiter = new DefaultRateLimiter();
  const signer = await client.config.signer();
  const host = new URL(sagemakerMarketplaceEndpoint).hostname;
  return {
    async postListingView(body: string): Promise<Response> {
      await rateLimiter.getSendToken();
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
      const response = await fetch(sagemakerMarketplaceEndpoint, {
        method: "POST",
        headers: signed.headers,
        body,
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
      rateLimiter.updateClientSendingRate(
        response.status === 429 ? { errorType: "THROTTLING" } : {},
      );
      return response;
    },
    destroy(): void {
      client.destroy();
    },
  };
}
