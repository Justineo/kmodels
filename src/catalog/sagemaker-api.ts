import {
  DescribeHubContentCommand,
  ListHubContentsCommand,
  SageMakerClient,
} from "@aws-sdk/client-sagemaker";
import { z } from "zod";
import { setTimeout as sleep } from "node:timers/promises";
import { mapConcurrent } from "./concurrency.ts";
import type { SourceManifest } from "./manifests.ts";
import { baseModel } from "./model.ts";
import { modalitySchema, type Provider } from "./schema.ts";
import { sagemakerModalities } from "./sagemaker-sdk.ts";
import { modelCardSchema } from "./model-metadata.ts";
import { modelIdSchema } from "./identity.ts";

const documentSchema = z.object({
  InputModalities: z.array(z.string()).optional(),
  OutputModalities: z.array(z.string()).optional(),
  FineTuningSupported: z.boolean().optional(),
  SupportedInferenceInstanceTypes: z.array(z.string()).optional(),
  Provider: z.string().optional(),
  License: z.string().optional(),
  ModelSize: z.string().optional(),
  ContextWindow: z.string().optional(),
  Languages: z.array(z.string()).optional(),
  HuggingfaceId: z.string().optional(),
  ModelAccess: z.string().optional(),
  MlFramework: z.string().optional(),
});
const modelSchema = z.object({
  id: modelIdSchema,
  name: z.string().min(1),
  description: z.string().max(1023).optional(),
  input: z.array(modalitySchema),
  output: z.array(modalitySchema),
  fineTuning: z.boolean().optional(),
  available: z.boolean(),
  model_card: modelCardSchema.optional(),
});
const inventorySchema = z.object({ region: z.string(), models: z.array(modelSchema).max(3000) });

export async function fetchSagemakerInventory(
  region: string,
  admitted: ReadonlySet<string>,
  maxBytes: number,
): Promise<string> {
  const client = new SageMakerClient({ region, maxAttempts: 3, retryMode: "adaptive" });
  let nextRequestAt = 0;
  async function waitForRequestSlot(): Promise<void> {
    const now = Date.now();
    const delay = Math.max(0, nextRequestAt - now);
    nextRequestAt = Math.max(now, nextRequestAt) + 1000;
    if (delay > 0) await sleep(delay);
  }
  const common = { HubName: "SageMakerPublicHub", HubContentType: "Model" as const };
  try {
    const selected = new Map<string, { id: string; version: string }>();
    const tokens = new Set<string>();
    let next: string | undefined;
    let finished = false;
    for (let page = 0; page < 100; page += 1) {
      await waitForRequestSlot();
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
    const models = await mapConcurrent([...selected.values()], 2, async ({ id, version }) => {
      await waitForRequestSlot();
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
      const document = documentSchema.parse(JSON.parse(result.HubContentDocument));
      return modelSchema.parse({
        id,
        name: result.HubContentDisplayName ?? id,
        ...(result.HubContentDescription === undefined
          ? {}
          : { description: result.HubContentDescription }),
        input: sagemakerModalities(document.InputModalities),
        output: sagemakerModalities(document.OutputModalities),
        model_card: Object.fromEntries(
          [
            ["publisher", document.Provider],
            ["license", document.License],
            ["size", document.ModelSize],
            ["context_window", document.ContextWindow],
            ["languages", document.Languages],
            ["upstream_id", document.HuggingfaceId],
            ["access", document.ModelAccess],
            ["framework", document.MlFramework],
          ].filter(([, value]) => value !== undefined && value !== ""),
        ),
        ...(document.FineTuningSupported === undefined
          ? {}
          : { fineTuning: document.FineTuningSupported }),
        available:
          result.HubContentStatus === "Available" &&
          result.SupportStatus === "Supported" &&
          (document.SupportedInferenceInstanceTypes?.length ?? 0) > 0,
      });
    });
    const body = JSON.stringify({ region, models });
    if (Buffer.byteLength(body) > maxBytes)
      throw new Error("SageMaker inventory exceeded byte limit");
    return body;
  } finally {
    client.destroy();
  }
}

export function parseSagemakerInventory(input: {
  provider: Provider;
  source: SourceManifest;
  body: string;
  observedAt: string;
}) {
  const data = inventorySchema.parse(JSON.parse(input.body));
  if (
    input.source.transport?.kind !== "aws-sagemaker" ||
    data.region !== input.source.transport.region
  )
    throw new Error("SageMaker inventory changed region");
  return data.models.map((row) => {
    const model = baseModel({
      providerId: input.provider.id,
      id: row.id,
      name: row.name,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    });
    model.scope = "regional_catalog";
    if (row.description !== undefined) model.description = row.description;
    if (row.model_card !== undefined) model.model_card = row.model_card;
    model.modalities = { input: row.input, output: row.output };
    model.capabilities.fine_tuning = row.fineTuning ?? "unknown";
    if (row.available)
      model.availability = [{ region: data.region, deployment_type: "jumpstart-endpoint" }];
    return model;
  });
}
