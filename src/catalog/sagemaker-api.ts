import { z } from "zod";
import { baseModel } from "./model.ts";
import { modalitySchema } from "./schema.ts";
import type { SourceParseInput, SourceParseResult } from "./source-parse.ts";
import { sagemakerModalities } from "./sagemaker-sdk.ts";
import { modelCardSchema } from "./model-metadata.ts";
import { modelIdSchema } from "./identity.ts";
import { fetchSagemakerPublicHubModels } from "./transport/sagemaker-fetch.ts";

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
  const rawModels = await fetchSagemakerPublicHubModels(region, admitted);
  const models = rawModels.map((row) => {
    const document = documentSchema.parse(JSON.parse(row.document));
    return modelSchema.parse({
      id: row.id,
      name: row.displayName ?? row.id,
      ...(row.description === undefined ? {} : { description: row.description }),
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
        row.hubContentStatus === "Available" &&
        row.supportStatus === "Supported" &&
        (document.SupportedInferenceInstanceTypes?.length ?? 0) > 0,
    });
  });
  const body = JSON.stringify({ region, models });
  if (Buffer.byteLength(body) > maxBytes)
    throw new Error("SageMaker inventory exceeded byte limit");
  return body;
}

export function parseSagemakerInventory(input: SourceParseInput): SourceParseResult {
  const data = inventorySchema.parse(JSON.parse(input.body));
  if (
    input.source.transport?.kind !== "aws-sagemaker" ||
    data.region !== input.source.transport.region
  )
    throw new Error("SageMaker inventory changed region");
  return {
    models: data.models.map((row) => {
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
      if (row.available) {
        model.status = "active";
        model.availability = [{ region: data.region, deployment_type: "jumpstart-endpoint" }];
      }
      return model;
    }),
  };
}
