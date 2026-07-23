import { z } from "zod";
import { isCredentialLikeIdentifier, modelIdSchema } from "./identity.ts";
import { baseModel, modelRouteKey } from "./model.ts";
import type { SourceManifest } from "./manifests.ts";
import { publishedRate } from "./pricing.ts";
import {
  modalitySchema,
  type Modality,
  type ModelRoute,
  type ModelType,
  type PriceRate,
  type Provider,
  type ProviderModel,
  unknownCapabilities,
} from "./schema.ts";

interface Input {
  provider: Provider;
  source: SourceManifest;
  body: string;
  observedAt: string;
}

interface TaskFacts {
  types: ModelType[];
  input: Modality[];
  output: Modality[];
}

const decimal = z
  .union([z.string(), z.number().finite().nonnegative()])
  .transform((value) => String(value));
const hubIdSchema = modelIdSchema.refine((value) => {
  const parts = value.split("/");
  return parts.length === 2 && parts.every((part) => /^[a-z0-9][a-z0-9._-]*$/i.test(part));
}, "Expected a Hugging Face repository ID");
const mappingEntrySchema = z.object({
  _id: z.string().min(1),
  providerId: z.string().min(1),
  status: z.literal("live"),
  adapterType: z.literal("lora").optional(),
  tags: z.array(z.string().min(1)).min(1).optional(),
});
const mappingSchema = z.record(z.string().min(1), z.record(z.string().min(1), mappingEntrySchema));
const routeSchema = z.object({
  provider: z.string().min(1),
  status: z.enum(["live", "error"]),
  context_length: z.number().int().positive().optional(),
  pricing: z.object({ input: decimal.optional(), output: decimal.optional() }).optional(),
  is_free: z.boolean().optional(),
  supports_tools: z.boolean().optional(),
  supports_structured_output: z.boolean().optional(),
  first_token_latency_ms: z.number().finite().nonnegative().optional(),
  throughput: z.number().finite().nonnegative().optional(),
  is_model_author: z.boolean().optional(),
});
const routerItemSchema = z.object({
  id: hubIdSchema,
  object: z.literal("model"),
  created: z.number().int().nonnegative(),
  owned_by: z.string().min(1),
  architecture: z.object({
    input_modalities: z.array(modalitySchema),
    output_modalities: z.array(modalitySchema),
  }),
  providers: z.array(routeSchema).min(1),
});
const routerSchema = z.object({ data: z.array(routerItemSchema) });

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function facts(task: string): TaskFacts {
  switch (task) {
    case "conversational":
    case "text-generation":
    case "summarization":
    case "translation":
    case "question-answering":
    case "table-question-answering":
    case "fill-mask":
      return { types: ["generate"], input: ["text"], output: ["text"] };
    case "document-question-answering":
      return { types: ["generate"], input: ["text", "image"], output: ["text"] };
    case "image-to-text":
    case "visual-question-answering":
      return { types: ["generate"], input: ["image"], output: ["text"] };
    case "feature-extraction":
    case "sentence-similarity":
      return { types: ["embeddings"], input: ["text"], output: ["embedding"] };
    case "text-ranking":
      return { types: ["rerank"], input: ["text"], output: [] };
    case "automatic-speech-recognition":
      return { types: ["audio_transcription"], input: ["audio"], output: ["text"] };
    case "text-to-speech":
      return { types: ["audio_speech"], input: ["text"], output: ["audio"] };
    case "text-to-audio":
      return { types: ["audio_generation"], input: ["text"], output: ["audio"] };
    case "audio-to-audio":
      return { types: ["audio_generation"], input: ["audio"], output: ["audio"] };
    case "text-to-image":
      return { types: ["image"], input: ["text"], output: ["image"] };
    case "image-to-image":
      return { types: ["image"], input: ["image"], output: ["image"] };
    case "text-to-video":
      return { types: ["video"], input: ["text"], output: ["video"] };
    case "image-to-video":
      return { types: ["video"], input: ["image"], output: ["video"] };
    case "audio-classification":
      return { types: ["classification"], input: ["audio"], output: ["text"] };
    case "image-classification":
    case "zero-shot-image-classification":
      return { types: ["classification"], input: ["image"], output: ["text"] };
    case "image-segmentation":
      return { types: ["classification"], input: ["image"], output: ["image"] };
    case "object-detection":
      return { types: ["classification"], input: ["image"], output: [] };
    case "text-classification":
    case "token-classification":
    case "zero-shot-classification":
    case "tabular-classification":
      return { types: ["classification"], input: ["text"], output: ["text"] };
    default:
      return { types: ["other"], input: [], output: [] };
  }
}

function validateTagFilter(rawId: string, entry: z.infer<typeof mappingEntrySchema>): void {
  const filterTags = rawId.slice("tag-filter=".length).split(",");
  const entryTags = entry.tags ?? [];
  if (
    entry.adapterType !== "lora" ||
    filterTags.some((tag) => tag.length === 0) ||
    new Set(filterTags).size !== filterTags.length ||
    new Set(entryTags).size !== entryTags.length ||
    [...filterTags].sort().join("\0") !== [...entryTags].sort().join("\0")
  )
    throw new Error("Invalid Hugging Face tag filter contract");
}

export function parseHuggingFaceMapping(input: Input): ProviderModel[] {
  const config = input.source.extractor;
  if (config.kind !== "huggingface-mapping")
    throw new Error("Invalid Hugging Face mapping extractor");
  const groups = mappingSchema.parse(JSON.parse(input.body));
  const models = new Map<string, ProviderModel>();
  for (const [task, entries] of Object.entries(groups)) {
    const observed = facts(task);
    for (const [rawId, entry] of Object.entries(entries)) {
      if (rawId.startsWith("tag-filter=")) {
        validateTagFilter(rawId, entry);
        continue;
      }
      if (isCredentialLikeIdentifier(rawId) || isCredentialLikeIdentifier(entry.providerId))
        continue;
      const id = hubIdSchema.parse(rawId);
      const current = models.get(id) ?? {
        ...baseModel({
          providerId: input.provider.id,
          id,
          name: id,
          sourceId: input.source.id,
          observedAt: input.observedAt,
        }),
        status: "active",
      };
      const route: ModelRoute = {
        source_ref: input.source.id,
        provider: config.provider,
        provider_model_id: entry.providerId,
        task,
        status: "live",
      };
      const routes = [...(current.routes ?? []), route].sort((left, right) =>
        modelRouteKey(left).localeCompare(modelRouteKey(right)),
      );
      const types = unique([...current.types, ...observed.types]);
      models.set(id, {
        ...current,
        types: types.some((type) => type !== "other")
          ? types.filter((type) => type !== "other")
          : types,
        routes,
        modalities: {
          input: unique([...current.modalities.input, ...observed.input]),
          output: unique([...current.modalities.output, ...observed.output]),
        },
      });
    }
  }
  if (models.size < config.minModels || models.size > config.maxModels)
    throw new Error("Hugging Face mapping count outside reviewed bounds");
  return [...models.values()].sort((left, right) => left.uid.localeCompare(right.uid));
}

function availability(values: (boolean | undefined)[]): boolean | "unknown" {
  if (values.some((value) => value === true)) return true;
  if (values.length > 0 && values.every((value) => value === false)) return false;
  return "unknown";
}

function routeRates(route: z.infer<typeof routeSchema>, sourceId: string): PriceRate[] {
  const conditions = { route_provider: route.provider };
  if (route.is_free === true) {
    if (
      [route.pricing?.input, route.pricing?.output].some(
        (price) => price !== undefined && !/^0(?:\.0+)?$/.test(price),
      )
    )
      throw new Error(`Hugging Face route ${route.provider} is both free and priced`);
    return ["input_text", "output_text"].map((meter) =>
      publishedRate(
        meter === "input_text" ? "input_text" : "output_text",
        "0",
        "million_tokens",
        sourceId,
        "currently free route",
        { ...conditions, promotion: true },
      ),
    );
  }
  const rates: PriceRate[] = [];
  if (route.pricing?.input !== undefined)
    rates.push(
      publishedRate(
        "input_text",
        route.pricing.input,
        "million_tokens",
        sourceId,
        "USD / million tokens",
        conditions,
      ),
    );
  if (route.pricing?.output !== undefined)
    rates.push(
      publishedRate(
        "output_text",
        route.pricing.output,
        "million_tokens",
        sourceId,
        "USD / million tokens",
        conditions,
      ),
    );
  return rates;
}

export function parseHuggingFaceRouter(input: Input): ProviderModel[] {
  const config = input.source.extractor;
  if (config.kind !== "huggingface-router")
    throw new Error("Invalid Hugging Face router extractor");
  const items = routerSchema.parse(JSON.parse(input.body)).data;
  const ids = new Set<string>();
  const models: ProviderModel[] = [];
  for (const item of items) {
    if (ids.has(item.id)) throw new Error(`Duplicate Hugging Face router model ${item.id}`);
    ids.add(item.id);
    const providers = new Set<string>();
    for (const route of item.providers) {
      if (providers.has(route.provider))
        throw new Error(`Duplicate Hugging Face route ${item.id}:${route.provider}`);
      providers.add(route.provider);
    }
    const routes = item.providers.filter((route) => route.status === "live");
    if (routes.length === 0) continue;
    const pricing = routes.flatMap((route) => routeRates(route, input.source.id));
    const contexts = routes.flatMap((route) =>
      route.context_length === undefined ? [] : [route.context_length],
    );
    models.push({
      ...baseModel({
        providerId: input.provider.id,
        id: item.id,
        name: item.id,
        sourceId: input.source.id,
        observedAt: input.observedAt,
      }),
      types: ["generate"],
      modalities: {
        input: unique(item.architecture.input_modalities),
        output: unique(item.architecture.output_modalities),
      },
      capabilities: {
        ...unknownCapabilities(),
        tool_call: availability(routes.map((route) => route.supports_tools)),
        structured_output: availability(routes.map((route) => route.supports_structured_output)),
      },
      limits: {
        context_tokens: contexts.length === 0 ? undefined : Math.max(...contexts),
      },
      pricing_status: pricing.length === 0 ? "unknown" : "published",
      pricing,
    });
  }
  if (models.length < config.minModels || models.length > config.maxModels)
    throw new Error("Hugging Face router count outside reviewed bounds");
  return models;
}
