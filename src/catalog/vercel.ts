import { z } from "zod";
import { modelIdSchema } from "./identity.ts";
import type { SourceManifest } from "./manifests.ts";
import { baseModel } from "./model.ts";
import { publishedRate, scaleDecimal } from "./pricing.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import {
  sourcePriceFactKey,
  type ParsedProviderModel as ProviderModel,
  type SourcePriceFact,
  type SourceRawPricingFact,
} from "./pricing-source.ts";
import { assertItemCount, recognizeItems, type SourceContractEvidence } from "./source-contract.ts";
import {
  modalitySchema,
  type ModelRoute,
  type ModelTask,
  type Provider,
  unknownCapabilities,
} from "./schema.ts";
import { classifyModelTasks, orderedTasks } from "./task.ts";
import { vercelCommercialFacts } from "./vercel-commercial-source.ts";

interface Input {
  provider: Provider;
  source: SourceManifest;
  body: string;
  observedAt: string;
  onContractFinding?: (evidence: SourceContractEvidence) => void;
  onPricingReconciliation?: (item: PricingReconciliationItem) => void;
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
const videoTokenPairSchema = z
  .object({
    no_video_input: videoTokenTierSchema,
    with_video_input: videoTokenTierSchema,
  })
  .strict();
const videoTokenPricingSchema = z
  .union([
    videoTokenPairSchema.extend({ notes: z.string().min(1) }).strict(),
    z
      .object({
        tiers: z
          .array(
            videoTokenPairSchema
              .extend({ resolution: z.enum(["480p", "720p", "1080p", "4k"]) })
              .strict(),
          )
          .min(1)
          .refine(
            (tiers) => new Set(tiers.map(({ resolution }) => resolution)).size === tiers.length,
            "Video-token resolutions must be unique",
          ),
        notes: z.string().min(1),
      })
      .strict(),
  ])
  .transform((value) =>
    "tiers" in value
      ? value.tiers
      : [{ no_video_input: value.no_video_input, with_video_input: value.with_video_input }],
  );

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
    video_token_pricing: videoTokenPricingSchema.optional(),
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
    generate_audio: z.boolean().optional(),
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
  "free",
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

const itemSchema = z.object({
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
});

const listSchema = z.object({ object: z.literal("list"), data: z.array(z.unknown()) }).strict();

const endpointServicePriceSchema = z
  .object({
    prompt: decimal.optional(),
    completion: decimal.optional(),
    input_cache_read: decimal.optional(),
    input_cache_write: decimal.optional(),
  })
  .strict();

const endpointTokenPriceSchema = endpointServicePriceSchema.extend({
  prompt_tiers: z.array(tierSchema).optional(),
  completion_tiers: z.array(tierSchema).optional(),
  input_cache_read_tiers: z.array(tierSchema).optional(),
  input_cache_write_tiers: z.array(tierSchema).optional(),
});

const endpointServiceTierSchema = endpointServicePriceSchema.extend({
  long_context: endpointServicePriceSchema
    .extend({ threshold: z.number().int().positive() })
    .strict()
    .optional(),
});

const endpointPricingSchema = endpointTokenPriceSchema
  .extend({
    request: z.literal("0"),
    image: z.literal("0"),
    image_output: z.literal("0"),
    web_search: z.literal("0"),
    internal_reasoning: z.literal("0"),
    discount: z.literal(0),
    service_tiers: z.record(z.string().min(1), endpointServiceTierSchema).optional(),
    audio_input_token_cost: decimal.optional(),
    audio_output_token_cost: decimal.optional(),
    video_duration_pricing: z.array(videoPriceSchema).optional(),
    video_token_pricing: videoTokenPricingSchema.optional(),
    speech_input_character_cost: decimal.optional(),
    transcription_duration_cost_per_second: decimal.optional(),
    realtime_client_message_cost: decimal.optional(),
    realtime_session_duration_cost_per_second: decimal.optional(),
  })
  .strict();

const endpointRegionSchema = z
  .object({
    scope: z.enum(["specific", "zone"]),
    geo_region: z.enum(["eu", "us"]),
    provider_region: z.string().min(1).optional(),
    pricing: endpointTokenPriceSchema.optional(),
  })
  .strict()
  .superRefine(({ scope, provider_region: providerRegion }, context) => {
    if ((scope === "specific") !== (providerRegion !== undefined))
      context.addIssue({ code: "custom", message: "Provider region must match specific scope" });
  });

const endpointSchema = z
  .object({
    name: z.string().min(1),
    model_name: z.string().min(1),
    context_length: z.number().int().nonnegative().optional(),
    pricing: endpointPricingSchema,
    provider_name: z.string().min(1),
    tags: z.array(tagSchema).optional(),
    inference_regions: z.array(endpointRegionSchema).optional(),
    quantization: z.null(),
    max_completion_tokens: z.number().int().nonnegative().optional(),
    max_prompt_tokens: z.number().int().nonnegative().nullable().optional(),
    supported_parameters: z.array(supportedParameterSchema).optional(),
    status: z.literal(0),
    supports_implicit_caching: z.boolean(),
    deprecated_at: z.number().int().nonnegative().optional(),
  })
  .strict();

const endpointDocumentSchema = z
  .object({
    data: z
      .object({
        id: modelIdSchema,
        name: z.string().min(1),
        created: z.number().int().nonnegative(),
        released: z.number().int().nonnegative(),
        description: z.string(),
        architecture: z.unknown(),
        reasoning: z.unknown().optional(),
        capabilities: z.unknown().optional(),
        endpoints: z.array(endpointSchema).min(1),
      })
      .strict(),
  })
  .strict();

const modelPageDocumentSchema = z
  .object({
    title: z.string().min(1),
    provider: z.string().min(1),
    headers: z.array(z.string().min(1)).min(2),
    values: z.array(z.string()),
    titles: z.array(z.array(z.string().min(1))),
  })
  .strict()
  .refine(
    ({ headers, values, titles }) =>
      headers.length === values.length && values.length === titles.length,
    "Model-page pricing columns must align",
  );

const bundleSchema = z
  .object({
    index: z.object({ url: z.url(), body: z.string().min(1) }).strict(),
    documents: z.array(z.object({ url: z.url(), body: z.string().min(1) }).strict()),
  })
  .strict();

type Item = z.infer<typeof itemSchema>;
type Tier = z.infer<typeof tierSchema>;
type ServicePrice = z.infer<typeof servicePriceSchema>;
type TokenPrice = z.infer<typeof tokenPriceSchema>;
type Endpoint = z.infer<typeof endpointSchema>;
type EndpointPrice = z.infer<typeof endpointTokenPriceSchema>;
type ModelPageDocument = z.infer<typeof modelPageDocumentSchema>;

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
    for (const [index, tier] of tiers.entries()) {
      const previous = tiers[index - 1];
      const minimum =
        previous?.max !== undefined && tier.min === previous.max - 1 ? previous.max : tier.min;
      rates.push(
        tokenRate(meter, tier.cost, sourceId, {
          ...conditions,
          context_min_tokens: minimum,
          context_max_tokens: tier.max === undefined ? undefined : tier.max - 1,
        }),
      );
    }
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

function endpointTokenPrice(value: EndpointPrice): TokenPrice {
  return {
    input: value.prompt,
    output: value.completion,
    input_tiers: value.prompt_tiers,
    output_tiers: value.completion_tiers,
    input_cache_read: value.input_cache_read,
    input_cache_read_tiers: value.input_cache_read_tiers,
    input_cache_write: value.input_cache_write,
    input_cache_write_tiers: value.input_cache_write_tiers,
  };
}

function nonzero(value: string | undefined): string | undefined {
  return value === "0" ? undefined : value;
}

function videoTokenRates(
  tiers: z.infer<typeof videoTokenPricingSchema> | undefined,
  sourceId: string,
  conditions: SourcePriceFact["conditions"] = {},
): SourcePriceFact[] {
  if (tiers === undefined) return [];
  return tiers.flatMap((tier) =>
    (
      [
        [false, tier.no_video_input],
        [true, tier.with_video_input],
      ] as const
    ).map(([videoInput, price]) =>
      publishedRate(
        "video_generation",
        price.cost_per_million_tokens,
        "million_tokens",
        sourceId,
        "million video tokens",
        {
          ...conditions,
          ...("resolution" in tier ? { resolution: tier.resolution } : {}),
          video_input: videoInput,
        },
      ),
    ),
  );
}

function endpointUsagePrice(item: Item, value: EndpointPrice): TokenPrice {
  const allowFreeInput = item.pricing.input === "0";
  const allowFreeOutput = item.pricing.output === "0";
  return {
    ...endpointTokenPrice(value),
    input: allowFreeInput ? value.prompt : nonzero(value.prompt),
    output: allowFreeOutput ? value.completion : nonzero(value.completion),
  };
}

function endpointRates(item: Item, endpoint: Endpoint, sourceId: string): SourcePriceFact[] {
  const rates: SourcePriceFact[] = [];
  const value = endpoint.pricing;
  const regions = endpoint.inference_regions ?? [];
  const hasRegionalPricing =
    regions.length > 0 || Object.keys(item.pricing.regional ?? {}).length > 0;
  const hasFast =
    item.pricing.fast !== undefined ||
    Object.values(item.pricing.regional ?? {}).some(({ fast }) => fast !== undefined);
  const baseConditions: SourcePriceFact["conditions"] = {
    route_provider: endpoint.provider_name,
    region: hasRegionalPricing ? "default" : undefined,
    service_tier: hasFast ? "standard" : undefined,
  };
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
  if (transcriptionAudioPrice !== undefined)
    rates.push(tokenRate("input_audio", transcriptionAudioPrice, sourceId, baseConditions));
  addUsageRates(
    rates,
    endpointUsagePrice(item, value),
    sourceId,
    inputMeter,
    outputMeter,
    baseConditions,
    !specializedInput,
  );
  if (value.audio_input_token_cost !== undefined && transcriptionAudioPrice === undefined)
    rates.push(tokenRate("input_audio", value.audio_input_token_cost, sourceId, baseConditions));
  if (value.audio_output_token_cost !== undefined)
    rates.push(tokenRate("output_audio", value.audio_output_token_cost, sourceId, baseConditions));

  for (const [serviceTier, tier] of Object.entries(value.service_tiers ?? {})) {
    const contextMax = tier.long_context?.threshold;
    addServiceRates(
      rates,
      serviceTier,
      {
        input: tier.prompt,
        output: tier.completion,
        input_cache_read: tier.input_cache_read,
        input_cache_write: tier.input_cache_write,
      },
      sourceId,
      {
        route_provider: endpoint.provider_name,
        region: hasRegionalPricing ? "default" : undefined,
        ...(contextMax === undefined ? {} : { context_max_tokens: contextMax }),
      },
    );
    if (tier.long_context !== undefined)
      addServiceRates(
        rates,
        serviceTier,
        {
          input: tier.long_context.prompt,
          output: tier.long_context.completion,
          input_cache_read: tier.long_context.input_cache_read,
          input_cache_write: tier.long_context.input_cache_write,
        },
        sourceId,
        {
          route_provider: endpoint.provider_name,
          region: hasRegionalPricing ? "default" : undefined,
          context_min_tokens: tier.long_context.threshold + 1,
        },
      );
  }
  for (const region of regions) {
    if (region.pricing === undefined) continue;
    addUsageRates(
      rates,
      endpointUsagePrice(item, region.pricing),
      sourceId,
      inputMeter,
      outputMeter,
      {
        route_provider: endpoint.provider_name,
        region: region.provider_region ?? region.geo_region,
        deployment_scope: region.scope,
        service_tier: hasFast ? "standard" : undefined,
      },
      !specializedInput,
    );
  }

  const hasVoiceControl =
    value.video_duration_pricing?.some(({ voice_control }) => voice_control !== undefined) === true;
  for (const variant of value.video_duration_pricing ?? [])
    rates.push(
      publishedRate("video_generation", variant.cost_per_second, "second", sourceId, "second", {
        ...baseConditions,
        resolution: variant.resolution,
        quality: variant.mode,
        audio: variant.audio,
        voice_control: hasVoiceControl ? (variant.voice_control ?? false) : undefined,
      }),
    );
  rates.push(...videoTokenRates(value.video_token_pricing, sourceId, baseConditions));
  if (value.speech_input_character_cost !== undefined)
    rates.push(
      publishedRate(
        "input_text",
        value.speech_input_character_cost,
        "character",
        sourceId,
        "character",
        baseConditions,
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
        baseConditions,
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
        baseConditions,
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
        baseConditions,
      ),
    );
  return rates;
}

function routeComparableFact(fact: SourcePriceFact): string {
  const {
    route_provider: _routeProvider,
    deployment_scope: _scope,
    ...conditions
  } = fact.conditions;
  const stableConditions = Object.fromEntries(
    Object.entries(conditions).sort(([left], [right]) => left.localeCompare(right)),
  );
  return `${fact.meter}\0${fact.unit}\0${JSON.stringify(stableConditions)}`;
}

function mergedRates(
  catalogRates: SourcePriceFact[],
  routeRates: SourcePriceFact[],
): SourcePriceFact[] {
  const routedTerms = new Set(routeRates.map(routeComparableFact));
  return [
    ...new Map(
      [
        ...catalogRates.filter((rate) => !routedTerms.has(routeComparableFact(rate))),
        ...routeRates,
      ].map((rate) => [sourcePriceFactKey(rate), rate]),
    ).values(),
  ];
}

function rawPageRate(
  header: string,
  value: string,
  provider: string,
  sourceId: string,
): SourceRawPricingFact {
  return {
    term_key: `model_page_${header.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
    impact: "base_price",
    reason: "unknown_applicability",
    conditions: { route_provider: provider },
    source_ref: sourceId,
    raw: { label: header, denomination: "USD", fragment: value },
  };
}

function modelPageRates(
  item: Item,
  page: ModelPageDocument,
  sourceId: string,
): { rates: SourcePriceFact[]; raw: SourceRawPricingFact[]; free: boolean } {
  if (page.title !== item.name) throw new Error(`Vercel model page title disagreed for ${item.id}`);
  const cells = new Map(page.headers.map((header, index) => [header, page.values[index] ?? ""]));
  const titles = new Map(page.headers.map((header, index) => [header, page.titles[index] ?? []]));
  if (cells.get("Provider") === undefined)
    throw new Error(`Vercel model page omitted the provider column for ${item.id}`);
  const rates: SourcePriceFact[] = [];
  const raw: SourceRawPricingFact[] = [];
  const freeHeaders = ["Input", "Output"].filter((header) => cells.get(header) === "Free");
  const free = freeHeaders.length === 2;
  if (freeHeaders.length !== 0 && (!free || !item.tags?.includes("free")))
    throw new Error(`Vercel model page free pricing disagreed for ${item.id}`);
  const pricePattern = /^\$((?:0|[1-9]\d*)(?:\.\d+)?)\/(M|K|img|MP|sec)(\*)?(?:\+(\d+) more)?$/;
  for (const header of ["Input", "Output", "Cache", "Web Search"] as const) {
    const value = cells.get(header);
    if (value === undefined || value === "" || value === "—" || value === "Free") continue;
    const match = value.match(pricePattern);
    if (match?.[1] === undefined || match[2] === undefined)
      throw new Error(`Vercel model page price changed shape for ${item.id}: ${header}`);
    const [, amount, unit, star, alternatives] = match;
    if (star !== undefined || alternatives !== undefined) {
      raw.push(rawPageRate(header, value, page.provider, sourceId));
      continue;
    }
    const conditions = { route_provider: page.provider };
    if (item.type === "reranking" && header === "Input" && unit === "K") {
      if (!titles.get(header)?.includes("Per 1,000 queries"))
        throw new Error(`Vercel rerank unit lost its query disclosure for ${item.id}`);
      rates.push(
        publishedRate(
          "rerank_request",
          amount,
          "thousand_requests",
          sourceId,
          "1,000 queries",
          conditions,
        ),
      );
      continue;
    }
    if (item.type === "image" && header === "Output" && (unit === "img" || unit === "MP")) {
      rates.push(
        publishedRate(
          "image_generation",
          amount,
          unit === "img" ? "image" : "million_pixels",
          sourceId,
          unit === "img" ? "image" : "megapixel",
          conditions,
        ),
      );
      continue;
    }
    if (item.type === "video" && header === "Output" && unit === "sec") {
      rates.push(
        publishedRate("video_generation", amount, "second", sourceId, "second", conditions),
      );
      continue;
    }
    if (unit === "M" && (header === "Input" || header === "Output" || header === "Cache")) {
      const meter: SourcePriceFact["meter"] =
        header === "Input" ? "input_text" : header === "Output" ? "output_text" : "cache_read_text";
      rates.push(
        publishedRate(meter, amount, "million_tokens", sourceId, "million tokens", conditions),
      );
      continue;
    }
    if (header === "Web Search" && unit === "K") {
      rates.push(
        publishedRate("web_search", amount, "thousand_requests", sourceId, "1K requests", {
          ...conditions,
          operation: "web_search",
        }),
      );
      continue;
    }
    throw new Error(`Vercel model page price could not be normalized for ${item.id}: ${header}`);
  }
  if (rates.length === 0 && raw.length === 0 && !free)
    throw new Error(`Vercel model page contained no usable pricing for ${item.id}`);
  return { rates, raw, free };
}

function routes(item: Item, endpoints: readonly Endpoint[], sourceId: string): ModelRoute[] {
  return endpoints.map((endpoint) => ({
    source_ref: sourceId,
    provider: endpoint.provider_name,
    provider_model_id: item.id,
    task: item.type,
    status: "live",
  }));
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
  rates.push(...videoTokenRates(value.video_token_pricing, sourceId));
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
      publishedRate("web_search", value.web_search, "thousand_requests", sourceId, "1K requests", {
        operation: "web_search",
      }),
    );
  if (value.maps_search !== undefined)
    rates.push(
      publishedRate(
        "maps_search",
        value.maps_search,
        "thousand_requests",
        sourceId,
        "1K requests",
        {
          operation: "maps_search",
        },
      ),
    );
  return rates;
}

function validateDocumentation(documents: ReadonlyMap<string, string>): void {
  const requirements = new Map<string, string[]>([
    [
      "/docs/ai-gateway/models-and-providers.md",
      [
        "https://ai-gateway.vercel.sh/v1/models",
        "This endpoint requires no authentication",
        "GET /v1/models/{creator}/{model}/endpoints",
        "returns per-provider pricing, supported parameters, uptime, throughput, and latency",
      ],
    ],
    [
      "/docs/ai-gateway/models-and-providers/provider-options.md",
      ["`order`, `only`, and `sort`", "sort: 'cost'", "caching: 'auto'"],
    ],
    [
      "/docs/ai-gateway/models-and-providers/provider-filtering-and-ordering.md",
      [
        "The `gateway.cost` value is the inference cost for this request",
        "does not include other charges that may apply",
        "`'cost'`",
        "`'ttft'`",
        "`'tps'`",
        "providers are always sorted last, regardless",
      ],
    ],
    [
      "/docs/ai-gateway/models-and-providers/fast-mode.md",
      [
        "higher per-token cost",
        "falls back to the base model",
        "not merely routed to a fast variant slug",
        "weren't billed at the fast rate",
      ],
    ],
    [
      "/docs/ai-gateway/models-and-providers/service-tiers.md",
      [
        "best-effort routing hint, not a hard guarantee",
        "billed at the default rate",
        "bills the request at the tier the provider actually served",
      ],
    ],
    [
      "/docs/ai-gateway/security-and-compliance/regional-inference.md",
      [
        "Pinning a region can raise what a request costs.",
        "passes the provider's regional price straight through",
        "adds no AI Gateway markup",
      ],
    ],
    [
      "/docs/ai-gateway/authentication-and-byok/byok.md",
      [
        "fallback usage is billed against your credits balance",
        "Spend through your own credentials isn't counted in",
        "your actual costs may vary",
      ],
    ],
    [
      "/docs/ai-gateway/sdks-and-apis/rest-api.md",
      [
        "GET /v1/models/{creator}/{model}/endpoints",
        "GET /v1/generation?id={generation_id}",
        "Usage events are ingested asynchronously",
        "Allow a few seconds",
        "`total_cost`",
        "`upstream_inference_cost`",
        "`native_tokens_cached`",
        "`native_tokens_cache_creation`",
      ],
    ],
    [
      "/docs/ai-gateway/observability-and-spend/logs.md",
      ["refreshing every 5 seconds", "about 90 seconds", "Fallback Path", "Cache Write"],
    ],
    [
      "/docs/ai-gateway/observability-and-spend/usage.md",
      [
        "`GET /v1/credits`",
        "remaining credit balance and lifetime spend",
        "`GET /v1/generation`",
        "cost, latency, finish reason, and token usage",
      ],
    ],
  ]);
  for (const [path, markers] of requirements) {
    const body = documents.get(path);
    if (body === undefined) throw new Error(`Vercel bundle omitted ${path}`);
    for (const marker of markers)
      if (!body.includes(marker)) throw new Error(`Vercel policy changed at ${path}: ${marker}`);
  }
}

function model(
  item: Item,
  input: Input,
  endpointValues: readonly Endpoint[],
  page: ModelPageDocument | undefined,
): ProviderModel {
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
  const catalogRates = pricing(item, input.source.id);
  const routeRateGroups = endpointValues.map((endpoint) => ({
    endpoint,
    rates: endpointRates(item, endpoint, input.source.id),
  }));
  const routeRates = routeRateGroups.flatMap(({ rates: values }) => values);
  const pagePricing =
    page === undefined
      ? { rates: [], raw: [], free: false }
      : modelPageRates(item, page, input.source.id);
  const explicitlyFree = tags.includes("free");
  if (
    explicitlyFree &&
    (catalogRates.length > 0 ||
      routeRates.length > 0 ||
      pagePricing.rates.length > 0 ||
      pagePricing.raw.length > 0)
  )
    throw new Error(`Vercel free pricing conflicted with a paid offer for ${item.id}`);
  input.onPricingReconciliation?.(
    catalogRates.length === 0
      ? {
          disposition: "explicit_non_numeric",
          reason_code: explicitlyFree ? "catalog_price_free" : "catalog_price_empty",
          sample: item.id,
        }
      : { disposition: "normalized", reason_code: "catalog_price_object", sample: item.id },
  );
  for (const { endpoint, rates: endpointPriceFacts } of routeRateGroups)
    input.onPricingReconciliation?.(
      endpointPriceFacts.length === 0
        ? {
            disposition: "excluded",
            reason_code: "route_amount_not_published",
            sample: `${item.id}:${endpoint.provider_name}`,
          }
        : {
            disposition: "normalized",
            reason_code: "route_price_object",
            sample: `${item.id}:${endpoint.provider_name}`,
          },
    );
  for (const _rate of pagePricing.rates)
    input.onPricingReconciliation?.({
      disposition: "normalized",
      reason_code: "model_page_price",
      sample: item.id,
    });
  for (const _fact of pagePricing.raw)
    input.onPricingReconciliation?.({
      disposition: "raw",
      reason_code: "model_page_ambiguous_variants",
      sample: item.id,
    });
  if (pagePricing.free)
    input.onPricingReconciliation?.({
      disposition: "explicit_non_numeric",
      reason_code: "model_page_free",
      sample: item.id,
    });
  const rates = [
    ...new Map(
      [...mergedRates(catalogRates, routeRates), ...pagePricing.rates].map((rate) => [
        sourcePriceFactKey(rate),
        rate,
      ]),
    ).values(),
  ];
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
    routes: endpointValues.length === 0 ? undefined : routes(item, endpointValues, input.source.id),
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
        endpointValues.some(({ supports_implicit_caching: caching }) => caching) ||
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
    pricing_state: explicitlyFree
      ? "free"
      : rates.length > 0
        ? "numeric"
        : pagePricing.raw.length > 0
          ? "unknown"
          : "not_published",
    price_facts: rates,
    raw_price_facts: pagePricing.raw,
  };
}

export function parseVercelCatalog(input: Input): ProviderModel[] {
  if (input.source.extractor.kind !== "vercel-catalog")
    throw new Error("Vercel catalog used the wrong extractor");
  const value: unknown = JSON.parse(input.body);
  const bundled = bundleSchema.safeParse(value);
  if (input.source.transport?.kind === "vercel-models" && !bundled.success)
    throw new Error("Vercel models transport omitted its source bundle");
  const list = listSchema.parse(JSON.parse(bundled.success ? bundled.data.index.body : input.body));
  assertItemCount(
    "Vercel model catalog",
    list.data.length,
    input.source.extractor.minModels,
    input.source.extractor.maxModels,
    ["data"],
  );
  const parsed = recognizeItems({
    label: "Vercel model",
    items: list.data,
    schema: itemSchema,
    modelId: "id",
    rootKeys: Object.keys(itemSchema.shape),
    ...(input.onContractFinding === undefined ? {} : { onFinding: input.onContractFinding }),
  });
  if (!bundled.success) return parsed.map((item) => model(item, input, [], undefined));
  if (bundled.data.index.url !== input.source.url)
    throw new Error("Vercel bundle index URL changed");
  const byId = new Map(parsed.map((item) => [item.id, item]));
  const endpoints = new Map<string, Endpoint[]>();
  const pages = new Map<string, ModelPageDocument>();
  const documentation = new Map<string, string>();
  for (const document of bundled.data.documents) {
    const url = new URL(document.url);
    const endpointMatch = url.pathname.match(/^\/v1\/models\/([^/]+\/[^/]+)\/endpoints$/);
    if (url.hostname === "ai-gateway.vercel.sh" && endpointMatch?.[1] !== undefined) {
      const id = endpointMatch[1];
      const item = byId.get(id);
      if (item === undefined) throw new Error(`Vercel endpoint document had unknown model ${id}`);
      if (endpoints.has(id)) throw new Error(`Vercel endpoint document was duplicated for ${id}`);
      const parsedDocument = endpointDocumentSchema.parse(JSON.parse(document.body));
      if (parsedDocument.data.id !== id)
        throw new Error(`Vercel endpoint identity disagreed for ${id}`);
      if (
        new Set(
          parsedDocument.data.endpoints.map(({ provider_name: providerName }) => providerName),
        ).size !== parsedDocument.data.endpoints.length
      )
        throw new Error(`Vercel route provider was duplicated for ${id}`);
      for (const endpoint of parsedDocument.data.endpoints)
        if (
          endpoint.name !== `${endpoint.provider_name} | ${id}` ||
          endpoint.model_name !== parsedDocument.data.name
        )
          throw new Error(`Vercel route identity disagreed for ${id}`);
      endpoints.set(id, parsedDocument.data.endpoints);
      continue;
    }
    const pageMatch = url.pathname.match(/^\/ai-gateway\/models\/([^/]+)$/);
    if (url.hostname === "vercel.com" && pageMatch?.[1] !== undefined) {
      const slug = pageMatch[1];
      if (pages.has(slug)) throw new Error(`Vercel model page was duplicated for ${slug}`);
      pages.set(slug, modelPageDocumentSchema.parse(JSON.parse(document.body)));
      continue;
    }
    if (
      url.hostname === "vercel.com" &&
      (url.pathname.endsWith(".md") ||
        url.pathname === "/ai-gateway/models" ||
        url.pathname === "/crawled-sitemap.xml")
    ) {
      if (documentation.has(url.pathname))
        throw new Error(`Vercel documentation was duplicated at ${url.pathname}`);
      documentation.set(url.pathname, document.body);
      continue;
    }
    throw new Error(`Vercel bundle contained an unreviewed document ${document.url}`);
  }
  if (endpoints.size !== parsed.length)
    throw new Error(`Vercel bundle had ${endpoints.size}/${parsed.length} endpoint documents`);
  const missing = parsed.filter(({ pricing: value }) => Object.keys(value).length === 0);
  if (pages.size !== missing.length)
    throw new Error(`Vercel bundle had ${pages.size}/${missing.length} missing-price model pages`);
  for (const item of missing) {
    const slug = item.id.split("/")[1];
    if (slug === undefined || !pages.has(slug))
      throw new Error(`Vercel bundle omitted the pricing page for ${item.id}`);
  }
  validateDocumentation(documentation);
  for (const path of documentation.keys())
    input.onPricingReconciliation?.({
      disposition: "excluded",
      reason_code: "account_or_service_policy",
      sample: path,
    });
  const result = parsed.map((item) => {
    const slug = item.id.split("/")[1];
    return model(
      item,
      input,
      endpoints.get(item.id) ?? [],
      slug === undefined ? undefined : pages.get(slug),
    );
  });
  const commercialFacts = vercelCommercialFacts({
    documents: documentation,
    sourceId: input.source.id,
    modelRefs: result.map(({ uid }) => uid),
    modelRefById: new Map(result.map(({ model_id: id, uid }) => [id, uid])),
    ...(input.onPricingReconciliation === undefined
      ? {}
      : { onPricingReconciliation: input.onPricingReconciliation }),
  });
  const carrier = result.find(({ price_facts: rates }) => rates.length > 0) ?? result[0];
  if (carrier !== undefined && commercialFacts.length > 0)
    carrier.commercial_facts = commercialFacts;
  return result;
}
