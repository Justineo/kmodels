import { z } from "zod";
import { modelIdSchema } from "./identity.ts";
import type { SourceManifest } from "./manifests.ts";
import { baseModel } from "./model.ts";
import { publishedRate, scaleDecimal } from "./pricing.ts";
import type { ParsedProviderModel as ProviderModel, SourcePriceFact } from "./pricing-source.ts";
import { modalitySchema, type ModelTask, type Provider, unknownCapabilities } from "./schema.ts";
import { classifyModelTasks, orderedTasks } from "./task.ts";

interface Input {
  provider: Provider;
  source: SourceManifest;
  body: string;
  observedAt: string;
}

const decimal = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);

const tierSchema = z
  .object({
    cost: decimal,
    min: z.number().int().nonnegative().optional(),
    max: z.number().int().positive().optional(),
  })
  .strict()
  .refine(({ min = 0, max }) => max === undefined || min < max, "Tier range is empty");

const servicePriceSchema = z
  .object({
    input: decimal.optional(),
    output: decimal.optional(),
    input_cache_read: decimal.optional(),
    input_cache_write: decimal.optional(),
  })
  .strict();

const tokenPriceSchema = servicePriceSchema.extend({
  input_tiers: z.array(tierSchema).optional(),
  output_tiers: z.array(tierSchema).optional(),
  input_cache_read_tiers: z.array(tierSchema).optional(),
  input_cache_write_tiers: z.array(tierSchema).optional(),
});

const regionalPriceSchema = tokenPriceSchema.extend({
  fast: servicePriceSchema.optional(),
});

const serviceTierSchema = servicePriceSchema.extend({
  long_context: servicePriceSchema
    .extend({ threshold: z.number().int().positive() })
    .strict()
    .optional(),
});

const imagePriceSchema = z
  .object({
    cost: decimal,
    operation: z.string().min(1).optional(),
    size: z.string().min(1).optional(),
    style: z.string().min(1).optional(),
  })
  .strict();

const videoPriceSchema = z
  .object({
    cost_per_second: decimal,
    resolution: z.string().min(1).optional(),
    mode: z.string().min(1).optional(),
    audio: z.boolean().optional(),
    voice_control: z.boolean().optional(),
  })
  .strict();

const videoTokenTierSchema = z.object({ cost_per_million_tokens: decimal }).strict();

const pricingSchema = tokenPriceSchema
  .extend({
    audio_input_token_cost: decimal.optional(),
    audio_output_token_cost: decimal.optional(),
    fast: servicePriceSchema.optional(),
    regional: z.partialRecord(z.enum(["eu", "us"]), regionalPriceSchema).optional(),
    service_tiers: z.record(z.string().min(1), serviceTierSchema).optional(),
    image: decimal.optional(),
    image_dimension_quality_pricing: z.array(imagePriceSchema).optional(),
    video_duration_pricing: z.array(videoPriceSchema).optional(),
    video_token_pricing: z
      .object({
        no_video_input: videoTokenTierSchema,
        with_video_input: videoTokenTierSchema,
        notes: z.string().min(1),
      })
      .strict()
      .optional(),
    speech_input_character_cost: decimal.optional(),
    transcription_duration_cost_per_second: decimal.optional(),
    realtime_client_message_cost: decimal.optional(),
    realtime_session_duration_cost_per_second: decimal.optional(),
    web_search: decimal.optional(),
    maps_search: decimal.optional(),
  })
  .strict();

const reasoningOptionSchema = z
  .object({
    type: z.enum(["toggle", "effort", "budget_tokens"]),
    values: z.array(z.string().min(1)).optional(),
    min: z.number().int().nonnegative().optional(),
    max: z.number().int().nonnegative().optional(),
  })
  .strict();

const videoOperationSchema = z.enum([
  "text-to-video",
  "image-to-video",
  "first-last-frame",
  "reference-to-video",
  "extend-video",
  "motion-control",
  "video-editing",
]);

const videoInputLimitSchema = z.record(z.string(), z.unknown());

const videoCapabilitiesSchema = z
  .object({
    supported_operations: z.array(videoOperationSchema).min(1),
    supported_resolutions: z.array(z.string().min(1)).min(1),
    supported_aspect_ratios: z.array(z.string().min(1)).min(1),
    supported_durations_seconds: z.array(z.number().positive()).min(1),
    generate_audio: z.boolean(),
    supported_fps: z.array(z.number().positive()).min(1),
    max_sample_count: z.number().int().positive().optional(),
    input_limits: z
      .object({
        text: videoInputLimitSchema.optional(),
        image: videoInputLimitSchema.optional(),
        video: videoInputLimitSchema.optional(),
        audio: videoInputLimitSchema.optional(),
        max_total_inputs: z.number().int().positive().optional(),
      })
      .strict(),
  })
  .strict();

const tagSchema = z.enum([
  "explicit-caching",
  "fast",
  "file-input",
  "image-generation",
  "implicit-caching",
  "reasoning",
  "tool-use",
  "video-generation",
  "vision",
  "web-search",
  "websocket-realtime",
  "websocket-transcription",
]);

const supportedParameterSchema = z.enum([
  "include_reasoning",
  "max_tokens",
  "reasoning",
  "stop",
  "temperature",
  "tool_choice",
  "tools",
]);

const itemSchema = z
  .object({
    id: modelIdSchema.refine((value) => value.split("/").length === 2),
    object: z.literal("model"),
    created: z.number().int().nonnegative(),
    released: z.number().int().nonnegative(),
    owned_by: z.string().min(1),
    name: z.string().min(1),
    description: z.string(),
    context_window: z.number().int().nonnegative().optional(),
    max_tokens: z.number().int().nonnegative().optional(),
    type: z.enum([
      "language",
      "embedding",
      "image",
      "video",
      "realtime",
      "reranking",
      "speech",
      "transcription",
    ]),
    tags: z.array(tagSchema).optional(),
    modalities: z
      .object({
        input: z.array(modalitySchema),
        output: z.array(modalitySchema),
      })
      .strict(),
    supported_parameters: z.array(supportedParameterSchema).optional(),
    supported_specifications: z.array(z.enum(["v2", "v3", "v4"])).min(1),
    deprecated_at: z.number().int().nonnegative().optional(),
    interleaved: z.boolean().optional(),
    knowledge: z
      .string()
      .regex(/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/)
      .optional(),
    reasoning_options: z.array(reasoningOptionSchema).optional(),
    regions: z
      .array(z.enum(["eu", "us"]))
      .min(1)
      .optional(),
    temperature: z.boolean().optional(),
    video_capabilities: videoCapabilitiesSchema.optional(),
    pricing: pricingSchema,
  })
  .strict();

const listSchema = z.object({ object: z.literal("list"), data: z.array(z.unknown()) }).strict();

type Item = z.infer<typeof itemSchema>;
type Tier = z.infer<typeof tierSchema>;
type ServicePrice = z.infer<typeof servicePriceSchema>;
type TokenPrice = z.infer<typeof tokenPriceSchema>;

function date(timestamp: number | undefined, milliseconds = false): string | undefined {
  if (timestamp === undefined) return undefined;
  const value = new Date(milliseconds ? timestamp : timestamp * 1000);
  return Number.isNaN(value.valueOf()) ? undefined : value.toISOString().slice(0, 10);
}

function positive(value: number | undefined): number | undefined {
  return value === undefined || value === 0 ? undefined : value;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function supports<T>(values: readonly T[] | undefined, value: T): boolean | "unknown" {
  return values === undefined ? "unknown" : values.includes(value);
}

function modalities(item: Item): ProviderModel["modalities"] {
  const input = [...item.modalities.input];
  const limits = item.video_capabilities?.input_limits;
  if (limits?.text !== undefined) input.push("text");
  if (limits?.image !== undefined) input.push("image");
  if (limits?.video !== undefined) input.push("video");
  if (limits?.audio !== undefined) input.push("audio");
  return {
    input: unique(input),
    output: item.type === "embedding" ? ["embedding"] : unique(item.modalities.output),
  };
}

function tasks(item: Item, modelModalities: ProviderModel["modalities"]): ModelTask[] {
  const tagged: ModelTask[] = [];
  const tags = item.tags ?? [];
  if (tags.includes("image-generation") && modelModalities.output.includes("image"))
    tagged.push("image_generation");
  if (tags.includes("video-generation") && modelModalities.output.includes("video"))
    tagged.push("video_generation");
  if (
    tags.includes("websocket-realtime") &&
    modelModalities.input.includes("audio") &&
    modelModalities.output.includes("audio")
  )
    tagged.push("speech_to_speech");
  if (tags.includes("websocket-transcription")) tagged.push("transcription");
  return orderedTasks([
    ...classifyModelTasks({
      modelId: item.id,
      name: item.name,
      rawType: item.type,
      modalities: modelModalities,
    }),
    ...tagged,
  ]);
}

function tokenRate(
  meter: SourcePriceFact["meter"],
  price: string,
  sourceId: string,
  conditions: SourcePriceFact["conditions"] = {},
): SourcePriceFact {
  return {
    meter,
    price: scaleDecimal(price, 6),
    currency: "USD",
    unit: "million_tokens",
    conditions,
    source_ref: sourceId,
    derived: true,
    derivation: "source price per token × 1,000,000",
    raw_price: price,
    raw_unit: "token",
  };
}

function addTokenRates(
  rates: SourcePriceFact[],
  meter: SourcePriceFact["meter"],
  sourceId: string,
  price: string | undefined,
  tiers: Tier[] | undefined,
  conditions: SourcePriceFact["conditions"] = {},
): void {
  if (tiers !== undefined && tiers.length > 0) {
    for (const tier of tiers)
      rates.push(
        tokenRate(meter, tier.cost, sourceId, {
          ...conditions,
          context_min_tokens: tier.min,
          context_max_tokens: tier.max === undefined ? undefined : tier.max - 1,
        }),
      );
    return;
  }
  if (price !== undefined) rates.push(tokenRate(meter, price, sourceId, conditions));
}

function addServiceRates(
  rates: SourcePriceFact[],
  serviceTier: string,
  prices: ServicePrice,
  sourceId: string,
  context: SourcePriceFact["conditions"] = {},
): void {
  const conditions = { service_tier: serviceTier, ...context };
  if (prices.input !== undefined)
    rates.push(tokenRate("input_text", prices.input, sourceId, conditions));
  if (prices.output !== undefined)
    rates.push(tokenRate("output_text", prices.output, sourceId, conditions));
  if (prices.input_cache_read !== undefined)
    rates.push(tokenRate("cache_read_text", prices.input_cache_read, sourceId, conditions));
  if (prices.input_cache_write !== undefined)
    rates.push(tokenRate("cache_write_text", prices.input_cache_write, sourceId, conditions));
}

function addUsageRates(
  rates: SourcePriceFact[],
  prices: TokenPrice,
  sourceId: string,
  inputMeter: SourcePriceFact["meter"],
  outputMeter: SourcePriceFact["meter"],
  conditions: SourcePriceFact["conditions"],
  includeInput = true,
): void {
  if (includeInput)
    addTokenRates(rates, inputMeter, sourceId, prices.input, prices.input_tiers, conditions);
  addTokenRates(rates, outputMeter, sourceId, prices.output, prices.output_tiers, conditions);
  addTokenRates(
    rates,
    "cache_read_text",
    sourceId,
    prices.input_cache_read,
    prices.input_cache_read_tiers,
    conditions,
  );
  addTokenRates(
    rates,
    "cache_write_text",
    sourceId,
    prices.input_cache_write,
    prices.input_cache_write_tiers,
    conditions,
  );
}

function pricing(item: Item, sourceId: string): SourcePriceFact[] {
  const rates: SourcePriceFact[] = [];
  const value = item.pricing;
  const transcriptionAudioPrice =
    item.type === "transcription" ? value.audio_input_token_cost : undefined;
  const specializedInput =
    value.speech_input_character_cost !== undefined ||
    value.transcription_duration_cost_per_second !== undefined ||
    transcriptionAudioPrice !== undefined;
  const inputMeter: SourcePriceFact["meter"] =
    item.type === "embedding"
      ? "embedding"
      : item.type === "transcription"
        ? "input_audio"
        : "input_text";
  const outputMeter: SourcePriceFact["meter"] =
    item.type === "image" ? "output_image" : "output_text";
  const regional = Object.entries(value.regional ?? {});
  const hasFast =
    value.fast !== undefined || regional.some(([, prices]) => prices.fast !== undefined);
  const baseConditions: SourcePriceFact["conditions"] = {
    region: regional.length === 0 ? undefined : "default",
    service_tier: hasFast ? "standard" : undefined,
  };
  if (transcriptionAudioPrice !== undefined)
    rates.push(tokenRate("input_audio", transcriptionAudioPrice, sourceId, baseConditions));
  addUsageRates(rates, value, sourceId, inputMeter, outputMeter, baseConditions, !specializedInput);
  if (value.audio_input_token_cost !== undefined && transcriptionAudioPrice === undefined)
    rates.push(tokenRate("input_audio", value.audio_input_token_cost, sourceId, baseConditions));
  if (value.audio_output_token_cost !== undefined)
    rates.push(tokenRate("output_audio", value.audio_output_token_cost, sourceId, baseConditions));

  if (value.fast !== undefined)
    addUsageRates(rates, value.fast, sourceId, inputMeter, outputMeter, {
      region: regional.length === 0 ? undefined : "default",
      service_tier: "fast",
    });
  for (const [region, prices] of regional) {
    addUsageRates(rates, prices, sourceId, inputMeter, outputMeter, {
      region,
      service_tier: hasFast ? "standard" : undefined,
    });
    if (prices.fast !== undefined)
      addUsageRates(rates, prices.fast, sourceId, inputMeter, outputMeter, {
        region,
        service_tier: "fast",
      });
  }

  for (const [serviceTier, tier] of Object.entries(value.service_tiers ?? {})) {
    const contextMax = tier.long_context?.threshold;
    addServiceRates(
      rates,
      serviceTier,
      tier,
      sourceId,
      contextMax === undefined ? {} : { context_max_tokens: contextMax },
    );
    if (tier.long_context !== undefined)
      addServiceRates(rates, serviceTier, tier.long_context, sourceId, {
        context_min_tokens: tier.long_context.threshold + 1,
      });
  }

  const imageBaseConditions =
    value.image_dimension_quality_pricing?.some(({ style }) => style !== undefined) === true
      ? { style: "default" }
      : {};
  if (value.image !== undefined)
    rates.push(
      publishedRate(
        "image_generation",
        value.image,
        "image",
        sourceId,
        "image",
        imageBaseConditions,
      ),
    );
  for (const variant of value.image_dimension_quality_pricing ?? [])
    rates.push(
      publishedRate("image_generation", variant.cost, "image", sourceId, "image", {
        operation: variant.operation,
        resolution: variant.size,
        style: variant.style,
      }),
    );
  const hasVoiceControl =
    value.video_duration_pricing?.some(({ voice_control }) => voice_control !== undefined) === true;
  for (const variant of value.video_duration_pricing ?? [])
    rates.push(
      publishedRate("video_generation", variant.cost_per_second, "second", sourceId, "second", {
        resolution: variant.resolution,
        quality: variant.mode,
        audio: variant.audio,
        voice_control: hasVoiceControl ? (variant.voice_control ?? false) : undefined,
      }),
    );
  if (value.video_token_pricing !== undefined) {
    rates.push(
      publishedRate(
        "video_generation",
        value.video_token_pricing.no_video_input.cost_per_million_tokens,
        "million_tokens",
        sourceId,
        "million video tokens",
        { video_input: false },
      ),
      publishedRate(
        "video_generation",
        value.video_token_pricing.with_video_input.cost_per_million_tokens,
        "million_tokens",
        sourceId,
        "million video tokens",
        { video_input: true },
      ),
    );
  }
  if (value.speech_input_character_cost !== undefined)
    rates.push(
      publishedRate(
        "input_text",
        value.speech_input_character_cost,
        "character",
        sourceId,
        "character",
      ),
    );
  if (value.transcription_duration_cost_per_second !== undefined)
    rates.push(
      publishedRate(
        "input_audio",
        value.transcription_duration_cost_per_second,
        "second",
        sourceId,
        "second",
      ),
    );
  if (value.realtime_client_message_cost !== undefined)
    rates.push(
      publishedRate(
        "realtime_client_message",
        value.realtime_client_message_cost,
        "request",
        sourceId,
        "message",
      ),
    );
  if (value.realtime_session_duration_cost_per_second !== undefined)
    rates.push(
      publishedRate(
        "realtime_session_duration",
        value.realtime_session_duration_cost_per_second,
        "second",
        sourceId,
        "second",
      ),
    );
  if (value.web_search !== undefined)
    rates.push(
      publishedRate("tool_call", value.web_search, "thousand_requests", sourceId, "1K requests", {
        operation: "web_search",
      }),
    );
  if (value.maps_search !== undefined)
    rates.push(
      publishedRate("tool_call", value.maps_search, "thousand_requests", sourceId, "1K requests", {
        operation: "maps_search",
      }),
    );
  return rates;
}

function model(item: Item, input: Input): ProviderModel {
  const creator = item.id.split("/")[0];
  if (creator !== item.owned_by) throw new Error(`Vercel owner mismatch for ${item.id}`);
  const modelModalities = modalities(item);
  const tags = item.tags ?? [];
  const parameters = item.supported_parameters;
  const reasoning =
    tags.includes("reasoning") ||
    parameters?.includes("reasoning") === true ||
    (item.reasoning_options?.length ?? 0) > 0
      ? true
      : supports(parameters, "reasoning");
  const realtimeTag = tags.find(
    (tag) => tag === "websocket-realtime" || tag === "websocket-transcription",
  );
  const rates = pricing(item, input.source.id);
  const deprecatedAt = date(item.deprecated_at, true);
  const deprecated = deprecatedAt !== undefined && deprecatedAt <= input.observedAt.slice(0, 10);
  const preview = /(?:^|[\s/_-])preview(?:$|[\s/_-])/i.test(`${item.id} ${item.name}`);
  return {
    ...baseModel({
      providerId: input.provider.id,
      id: item.id,
      name: item.name,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    }),
    description: item.description || undefined,
    tasks: tasks(item, modelModalities),
    delivery_modes: realtimeTag === undefined ? undefined : ["realtime"],
    delivery_mode_evidence:
      realtimeTag === undefined
        ? undefined
        : [
            {
              mode: "realtime",
              source_ref: input.source.id,
              namespace: "vercel.tag",
              raw_value: realtimeTag,
              kind: "capability",
            },
          ],
    raw_type: item.type,
    modalities: modelModalities,
    capabilities: {
      ...unknownCapabilities(),
      reasoning,
      tool_call:
        tags.includes("tool-use") || parameters?.includes("tools") === true
          ? true
          : supports(parameters, "tools"),
      prompt_cache:
        tags.includes("implicit-caching") ||
        tags.includes("explicit-caching") ||
        rates.some((rate) => rate.meter === "cache_read_text" || rate.meter === "cache_write_text")
          ? true
          : "unknown",
      effort_control:
        item.reasoning_options?.some((option) => option.type === "effort") === true
          ? true
          : item.reasoning_options !== undefined || reasoning === false
            ? false
            : "unknown",
    },
    limits: {
      context_tokens: positive(item.context_window),
      max_output_tokens:
        item.type === "language" || item.type === "realtime"
          ? positive(item.max_tokens)
          : undefined,
    },
    release_date: date(item.released),
    deprecated_at: deprecatedAt,
    status: deprecated ? "deprecated" : "active",
    release_stage: preview ? "preview" : "unknown",
    availability: item.regions?.map((region) => ({
      region,
      deployment_type: "regional_inference",
    })),
    pricing_state: rates.length === 0 ? "not_published" : "numeric",
    price_facts: rates,
  };
}

export function parseVercelCatalog(input: Input): ProviderModel[] {
  if (input.source.extractor.kind !== "vercel-catalog")
    throw new Error("Vercel catalog used the wrong extractor");
  const list = listSchema.parse(JSON.parse(input.body));
  if (
    list.data.length < input.source.extractor.minModels ||
    list.data.length > input.source.extractor.maxModels
  )
    throw new Error("Vercel model count outside reviewed bounds");
  const parsed = list.data.map((item) => itemSchema.safeParse(item));
  const invalid = parsed.find((result) => !result.success);
  if (invalid !== undefined && !invalid.success)
    throw new Error(
      `Vercel model schema drift at ${invalid.error.issues[0]?.path.join(".") ?? "item"}`,
    );
  return parsed.flatMap((result) => (result.success ? [model(result.data, input)] : []));
}
