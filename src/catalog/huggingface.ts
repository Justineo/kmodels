import { z } from "zod";
import { modelIdSchema } from "./identity.ts";
import { baseModel } from "./model.ts";
import type { SourceManifest } from "./manifests.ts";
import { publishedRate } from "./pricing.ts";
import {
  modalitySchema,
  type Modality,
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
  adapterType: z.string().min(1).optional(),
  tags: z.array(z.string().min(1)).min(1).optional(),
});
const mappingSchema = z.record(z.string().min(1), z.record(z.string().min(1), mappingEntrySchema));
const routeSchema = z.object({
  provider: z.string().min(1),
  status: z.literal("live"),
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

function extractor(input: Input, kind: "huggingface-mapping" | "huggingface-router") {
  if (input.source.extractor.kind !== kind)
    throw new Error(`Invalid Hugging Face ${kind} extractor`);
  return input.source.extractor;
}

export function parseHuggingFaceMapping(input: Input): ProviderModel[] {
  const config = extractor(input, "huggingface-mapping");
  const groups = mappingSchema.parse(JSON.parse(input.body));
  const models = new Map<string, ProviderModel>();
  for (const [task, entries] of Object.entries(groups)) {
    const observed = facts(task);
    for (const [rawId, entry] of Object.entries(entries)) {
      if (rawId.startsWith("tag-filter=")) {
        if (entry.tags === undefined || entry.adapterType === undefined)
          throw new Error("Hugging Face tag filter omitted its adapter contract");
        continue;
      }
      const id = hubIdSchema.parse(rawId);
      const current = models.get(id);
      if (current === undefined) {
        models.set(id, {
          ...baseModel({
            providerId: input.provider.id,
            id,
            name: id,
            sourceId: input.source.id,
            observedAt: input.observedAt,
          }),
          types: observed.types,
          modalities: { input: observed.input, output: observed.output },
          status: "active",
        });
        continue;
      }
      models.set(id, {
        ...current,
        types: unique([...current.types, ...observed.types]),
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
  if (route.is_free === true)
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
  const config = extractor(input, "huggingface-router");
  const items = routerSchema.parse(JSON.parse(input.body)).data;
  if (items.length < config.minModels || items.length > config.maxModels)
    throw new Error("Hugging Face router count outside reviewed bounds");
  const ids = new Set<string>();
  return items.map((item) => {
    if (ids.has(item.id)) throw new Error(`Duplicate Hugging Face router model ${item.id}`);
    ids.add(item.id);
    const providers = new Set<string>();
    for (const route of item.providers) {
      if (providers.has(route.provider))
        throw new Error(`Duplicate Hugging Face route ${item.id}:${route.provider}`);
      providers.add(route.provider);
    }
    const pricing = item.providers.flatMap((route) => routeRates(route, input.source.id));
    const contexts = item.providers.flatMap((route) =>
      route.context_length === undefined ? [] : [route.context_length],
    );
    return {
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
        tool_call: availability(item.providers.map((route) => route.supports_tools)),
        structured_output: availability(
          item.providers.map((route) => route.supports_structured_output),
        ),
      },
      limits: {
        context_tokens: contexts.length === 0 ? undefined : Math.max(...contexts),
      },
      status: "active",
      pricing_status: pricing.length === 0 ? "unknown" : "published",
      pricing,
    } satisfies ProviderModel;
  });
}
