import { load } from "cheerio";
import { z } from "zod";
import { linkedBundleSchema } from "./bundle.ts";
import { modelIdSchema } from "./identity.ts";
import { apiEndpointKey, baseModel } from "./model.ts";
import type { SourceManifest } from "./manifests.ts";
import { multiplyDecimal, publishedRate, scaleDecimal } from "./pricing.ts";
import {
  modalitySchema,
  type Modality,
  type ModelType,
  type PriceRate,
  type Provider,
  type ProviderModel,
  unknownCapabilities,
} from "./schema.ts";

interface ParseInput {
  provider: Provider;
  source: SourceManifest;
  body: string;
  observedAt: string;
}

type ApiEndpoint = NonNullable<ProviderModel["api_endpoints"]>[number];

const integerString = z.string().regex(/^\d+$/);
const upperModalitySchema = z.enum(["TEXT", "IMAGE", "AUDIO", "VIDEO"]);
const aliasesSchema = z.array(modelIdSchema).default([]);
const commonModelShape = {
  name: modelIdSchema,
  version: z.string().min(1),
  inputModalities: z.array(upperModalitySchema).min(1),
  outputModalities: z.array(upperModalitySchema).min(1),
  aliases: aliasesSchema,
};
const languageModelSchema = z.object({
  ...commonModelShape,
  promptTextTokenPrice: integerString,
  promptImageTokenPrice: integerString,
  promptTextTokenPriceLongContext: integerString,
  cachedPromptTokenPrice: integerString,
  cachedPromptTokenPriceLongContext: integerString,
  completionTextTokenPrice: integerString,
  completionTokenPriceLongContext: integerString,
  maxPromptLength: z.number().int().positive(),
  longContextThreshold: integerString.default("0"),
  batchDiscountPercent: z.number().int().min(0).max(100).default(0),
  features: z
    .object({
      functionCalling: z.boolean().optional(),
      structuredOutputs: z.boolean().optional(),
      reasoning: z.boolean().optional(),
      reasoningEffortOptions: z
        .object({
          supportedEfforts: z.array(z.string().min(1)).min(1),
          defaultEffort: z.string().min(1),
        })
        .optional(),
    })
    .default({}),
});
const embeddingModelSchema = z.object({
  name: modelIdSchema,
  version: z.string().min(1),
  inputModalities: z.array(upperModalitySchema).min(1),
  aliases: aliasesSchema,
  promptTextTokenPrice: integerString,
  promptImageTokenPrice: integerString,
});
const imageModelSchema = z.object({
  ...commonModelShape,
  imagePrice: integerString.optional(),
  resolutionPricing: z
    .array(
      z.object({
        resolution: z.enum(["IMAGE_RESOLUTION_1K", "IMAGE_RESOLUTION_2K", "IMAGE_RESOLUTION_4K"]),
        pricePerImage: integerString,
      }),
    )
    .min(1),
  pricePerInputImage: integerString.optional(),
});
const voiceEndpointSchema = z.discriminatedUnion("endpoint", [
  z.object({
    endpoint: z.literal("TTS"),
    basis: z.literal("REQUEST_RATE"),
    pricing: z.object({ perCharacter: integerString }),
  }),
  z.object({
    endpoint: z.literal("STT"),
    basis: z.literal("REQUEST_RATE"),
    pricing: z.object({
      perAudioSecond: integerString,
      perAudioSecondStreaming: integerString,
    }),
  }),
  z.object({
    endpoint: z.literal("REALTIME"),
    basis: z.literal("CONCURRENCY"),
    pricing: z.object({
      realtimeAudioSecondPrice: integerString,
      realtimeTextInputPrice: integerString,
    }),
  }),
]);
const voiceServiceSchema = z.object({
  ...commonModelShape,
  endpoints: z.array(voiceEndpointSchema).length(1),
});
const videoModelSchema = z.object({
  ...commonModelShape,
  resolutionPricing: z
    .array(
      z.object({
        resolution: z.enum([
          "VIDEO_RESOLUTION_480P",
          "VIDEO_RESOLUTION_720P",
          "VIDEO_RESOLUTION_1080P",
        ]),
        pricePerSecond: integerString,
      }),
    )
    .min(1),
  pricePerInputImage: integerString.optional(),
  pricePerInputVideoSecond: integerString.optional(),
});
const clusterSchema = z.object({
  clusterName: z.string().min(1),
  languageModels: z.array(languageModelSchema).default([]),
  embeddingModels: z.array(embeddingModelSchema).default([]),
  imageGenerationModels: z.array(imageModelSchema).default([]),
  audioModels: z.array(voiceServiceSchema).default([]),
  videoGenerationModels: z.array(videoModelSchema).default([]),
});
const publicModelsSchema = z.object({ clusterConfigs: z.array(clusterSchema).min(1) });

const apiPriceSchema = z.number().int().nonnegative();
const apiItemSchema = z.object({
  id: modelIdSchema,
  aliases: z.array(modelIdSchema),
  context_length: z.number().int().positive().nullable().optional(),
  created: z.number().int().nonnegative(),
  object: z.literal("model"),
  owned_by: z.string().min(1),
  prompt_text_token_price: apiPriceSchema.nullable().optional(),
  cached_prompt_text_token_price: apiPriceSchema.nullable().optional(),
  prompt_image_token_price: apiPriceSchema.nullable().optional(),
  completion_text_token_price: apiPriceSchema.nullable().optional(),
  prompt_text_token_price_long_context: apiPriceSchema.nullable().optional(),
  cached_prompt_text_token_price_long_context: apiPriceSchema.nullable().optional(),
  completion_text_token_price_long_context: apiPriceSchema.nullable().optional(),
  long_context_threshold: z.number().int().nonnegative().nullable().optional(),
  image_price: apiPriceSchema.nullable().optional(),
});
const apiListSchema = z.object({ data: z.array(apiItemSchema).min(1), object: z.literal("list") });
const detailedApiShape = {
  id: modelIdSchema,
  aliases: z.array(modelIdSchema),
  fingerprint: z.string().min(1),
  created: z.number().int().nonnegative(),
  object: z.literal("model"),
  owned_by: z.string().min(1),
  version: z.string().min(1),
  input_modalities: z.array(modalitySchema).min(1),
  output_modalities: z.array(modalitySchema).min(1),
};
const languageApiSchema = z.object({
  ...detailedApiShape,
  prompt_text_token_price: apiPriceSchema,
  cached_prompt_text_token_price: apiPriceSchema,
  prompt_image_token_price: apiPriceSchema,
  completion_text_token_price: apiPriceSchema,
  search_price: apiPriceSchema,
  prompt_text_token_price_long_context: apiPriceSchema,
  cached_prompt_text_token_price_long_context: apiPriceSchema,
  completion_text_token_price_long_context: apiPriceSchema,
  long_context_threshold: apiPriceSchema,
});
const imageApiSchema = z.object({
  ...detailedApiShape,
  image_price: apiPriceSchema,
  max_prompt_length: z.number().int().positive(),
});
const videoApiSchema = z.object(detailedApiShape);

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function upperModalities(values: z.infer<typeof upperModalitySchema>[]): Modality[] {
  return unique(
    values.map((value) => {
      switch (value) {
        case "TEXT":
          return "text";
        case "IMAGE":
          return "image";
        case "AUDIO":
          return "audio";
        case "VIDEO":
          return "video";
      }
    }),
  );
}

function model(input: ParseInput, id: string, values: Partial<ProviderModel>): ProviderModel {
  return {
    ...baseModel({
      providerId: input.provider.id,
      id,
      name: values.name ?? id,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    }),
    ...values,
  };
}

function exactRate(
  meter: PriceRate["meter"],
  raw: string,
  places: number,
  unit: PriceRate["unit"],
  sourceId: string,
  rawUnit: string,
  conditions: PriceRate["conditions"] = {},
): PriceRate {
  return {
    ...publishedRate(meter, scaleDecimal(raw, -places), unit, sourceId, rawUnit, conditions),
    raw_price: raw,
  };
}

function tierRate(rate: PriceRate, multiplier: string, tier: string, label: string): PriceRate {
  return {
    ...rate,
    price: multiplyDecimal(rate.price, multiplier),
    conditions: { ...rate.conditions, service_tier: tier },
    derived: true,
    derivation: `${label} × ${multiplier}`,
  };
}

function textRates(value: z.infer<typeof languageModelSchema>, sourceId: string): PriceRate[] {
  const threshold = Number(value.longContextThreshold);
  const standard = threshold > 0 ? { context_max_tokens: threshold - 1 } : {};
  const long = threshold > 0 ? { context_min_tokens: threshold } : {};
  const rate = (
    meter: PriceRate["meter"],
    raw: string,
    conditions: PriceRate["conditions"],
  ): PriceRate =>
    exactRate(meter, raw, 4, "million_tokens", sourceId, "USD cents / 100M tokens", conditions);
  const rates = [
    rate("input_text", value.promptTextTokenPrice, standard),
    rate("input_image", value.promptImageTokenPrice, standard),
    rate("cache_read_text", value.cachedPromptTokenPrice, standard),
    rate("output_text", value.completionTextTokenPrice, standard),
  ];
  if (threshold > 0)
    rates.push(
      rate("input_text", value.promptTextTokenPriceLongContext, long),
      rate("input_image", value.promptTextTokenPriceLongContext, long),
      rate("cache_read_text", value.cachedPromptTokenPriceLongContext, long),
      rate("output_text", value.completionTokenPriceLongContext, long),
    );
  const priority = rates.map((item) => tierRate(item, "2", "priority", "standard token price"));
  const multiplier = scaleDecimal(String(100 - value.batchDiscountPercent), -2);
  const batch =
    value.batchDiscountPercent === 0
      ? []
      : rates.map((item) => tierRate(item, multiplier, "batch", "standard token price"));
  return [...rates, ...batch, ...priority];
}

function mediaRate(
  meter: PriceRate["meter"],
  raw: string,
  unit: PriceRate["unit"],
  sourceId: string,
  conditions: PriceRate["conditions"] = {},
): PriceRate {
  return exactRate(meter, raw, 10, unit, sourceId, "USD ticks", conditions);
}

function embeddedModels(body: string): z.infer<typeof publicModelsSchema> {
  const $ = load(body);
  const prefix = "globalThis.__XAI_PUBLIC_MODELS__=";
  const scripts = $("script")
    .toArray()
    .map((element) => $(element).text().trim())
    .filter((text) => text.startsWith(prefix));
  if (scripts.length !== 1) throw new Error("xAI catalog requires one public models payload");
  const script = scripts[0];
  if (script === undefined || !script.endsWith(";"))
    throw new Error("xAI public models payload was malformed");
  return publicModelsSchema.parse(JSON.parse(script.slice(prefix.length, -1)));
}

function distinct<T extends { name: string }>(values: T[], category: string): T[] {
  const models = new Map<string, T>();
  for (const value of values) {
    const current = models.get(value.name);
    if (current !== undefined && JSON.stringify(current) !== JSON.stringify(value))
      throw new Error(`xAI ${category} model differs across public clusters`);
    models.set(value.name, value);
  }
  return [...models.values()];
}

function companion(bundle: z.infer<typeof linkedBundleSchema>, pathname: string): string {
  const matches = bundle.documents.filter(({ url }) => new URL(url).pathname === pathname);
  if (matches.length !== 1) throw new Error(`xAI bundle requires exactly one ${pathname}`);
  return matches[0]?.body ?? "";
}

function section(body: string, pathname: string): string {
  const marker = `===${pathname}===`;
  const start = body.indexOf(marker);
  if (start < 0 || body.indexOf(marker, start + marker.length) >= 0)
    throw new Error(`xAI llms.txt requires one ${pathname} section`);
  const end = body.indexOf("\n\n===", start + marker.length);
  return body.slice(start + marker.length, end < 0 ? undefined : end).trim();
}

function documentedEndpoint(
  body: string,
  modelId: string,
  name: string,
  path: string,
  requestUrl = `https://api.x.ai${path}`,
): ApiEndpoint {
  const quoted = [`"${modelId}"`, `'${modelId}'`, `\`${modelId}\``];
  if (!quoted.some((value) => body.includes(value)) || !body.includes(requestUrl))
    throw new Error(`xAI ${name} evidence changed for ${modelId}`);
  return { name, path };
}

const endpointEvidence = [
  ["/developers/model-capabilities/text/generate-text", "grok-4.5", "Responses", "/v1/responses"],
  [
    "/developers/model-capabilities/legacy/chat-completions",
    "grok-4.5",
    "Chat Completions",
    "/v1/chat/completions",
  ],
  [
    "/developers/model-capabilities/text/multi-agent",
    "grok-4.20-multi-agent",
    "Responses",
    "/v1/responses",
  ],
  [
    "/developers/model-capabilities/images/generation",
    "grok-imagine-image-quality",
    "Image Generations",
    "/v1/images/generations",
  ],
  [
    "/developers/model-capabilities/images/editing",
    "grok-imagine-image-quality",
    "Image Edits",
    "/v1/images/edits",
  ],
  [
    "/developers/model-capabilities/video/generation",
    "grok-imagine-video",
    "Video Generations",
    "/v1/videos/generations",
  ],
  [
    "/developers/model-capabilities/imagine",
    "grok-imagine-video-1.5",
    "Video Generations",
    "/v1/videos/generations",
  ],
] as const;

function endpointFacts(
  llms: string,
  models: { name: string; aliases: string[] }[],
): Map<string, ApiEndpoint[]> {
  const endpoints = new Map<string, ApiEndpoint[]>();
  for (const [pathname, modelId, name, path] of endpointEvidence) {
    const matches = models.filter(
      (model) => model.name === modelId || model.aliases.includes(modelId),
    );
    const model = matches[0];
    if (model === undefined || matches.length > 1)
      throw new Error(`xAI endpoint model ${modelId} did not resolve exactly once`);
    const endpoint = documentedEndpoint(section(llms, pathname), modelId, name, path);
    endpoints.set(model.name, [...(endpoints.get(model.name) ?? []), endpoint]);
  }
  for (const values of endpoints.values())
    values.sort((left, right) => apiEndpointKey(left).localeCompare(apiEndpointKey(right)));
  return endpoints;
}

function displayNames(html: string): Map<string, string> {
  const $ = load(html);
  const names = new Map<string, string>();
  $("a[href]").each((_index, element) => {
    const path = $(element).attr("href");
    const match = path?.match(/^\/developers\/models\/([a-z0-9._-]+)$/i);
    const spans = $(element)
      .find("span")
      .toArray()
      .map((span) => $(span).text().replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const id = match?.[1];
    const name = spans.length === 1 ? spans[0] : undefined;
    if (id === undefined || name === undefined) return;
    const current = names.get(id);
    if (current !== undefined && current !== name)
      throw new Error(`xAI model ${id} has conflicting display names`);
    names.set(id, name);
  });
  return names;
}

interface ReleaseSection {
  date: string;
  body: string;
}

const monthNumber = new Map([
  ["january", 1],
  ["february", 2],
  ["march", 3],
  ["april", 4],
  ["may", 5],
  ["june", 6],
  ["july", 7],
  ["august", 8],
  ["september", 9],
  ["october", 10],
  ["november", 11],
  ["december", 12],
]);

function releaseSections(notes: string): ReleaseSection[] {
  const headings = [
    ...notes.matchAll(
      /^## (January|February|March|April|May|June|July|August|September|October|November|December)(?: (\d{4}))?$/gim,
    ),
  ].map((match) => ({
    index: match.index,
    month: monthNumber.get(match[1]?.toLowerCase() ?? ""),
    explicitYear: match[2] === undefined ? undefined : Number(match[2]),
  }));
  if (headings.length === 0 || headings.some(({ month }) => month === undefined))
    throw new Error("xAI release notes omitted month headings");
  const dated: ReleaseSection[] = [];
  let nextMonth = 13;
  let year: number | undefined;
  for (let index = headings.length - 1; index >= 0; index -= 1) {
    const heading = headings[index];
    if (heading === undefined || heading.month === undefined) continue;
    if (heading.explicitYear !== undefined) year = heading.explicitYear;
    else if (year !== undefined && heading.month < nextMonth) year += 1;
    if (year === undefined) throw new Error("xAI release notes omitted a year anchor");
    const end = headings[index + 1]?.index ?? notes.length;
    dated.push({
      date: `${year}-${String(heading.month).padStart(2, "0")}`,
      body: notes.slice(heading.index, end),
    });
    nextMonth = heading.month;
  }
  return dated;
}

function releaseDate(
  releases: ReleaseSection[],
  id: string,
  name: string,
  aliases: string[] = [],
): string | undefined {
  const matches = releases.filter(({ body }) =>
    body
      .split(/^### /m)
      .slice(1)
      .some(
        (entry) =>
          entry.includes(id) ||
          (name !== id && entry.includes(name)) ||
          aliases.some((alias) => entry.includes(alias)),
      ),
  );
  return matches.map(({ date }) => date).sort()[0];
}

function updatedDate(aliases: string[]): string | undefined {
  const dates = aliases.flatMap((alias) => {
    const separated = alias.match(/-(\d{4}-\d{2}-\d{2})(?:$|-latest$)/)?.[1];
    if (separated !== undefined) return [separated];
    const compact = alias.match(/-(\d{4})(\d{2})(\d{2})(?:$|-latest$)/);
    return compact?.[1] === undefined || compact[2] === undefined || compact[3] === undefined
      ? []
      : [`${compact[1]}-${compact[2]}-${compact[3]}`];
  });
  return dates.sort().at(-1);
}

interface TextPrice {
  id: string;
  long: boolean;
  threshold: number;
  context: number;
  input: string;
  cached: string;
  output: string;
}

function count(value: string): number {
  const match = value.match(/^(\d+(?:\.\d+)?)([kM])$/);
  if (match?.[1] === undefined || match[2] === undefined)
    throw new Error(`Invalid xAI token count ${value}`);
  const result = Number(match[1]) * (match[2] === "M" ? 1_000_000 : 1_000);
  if (!Number.isSafeInteger(result)) throw new Error(`Invalid xAI token count ${value}`);
  return result;
}

function textPriceRows(pricing: string): TextPrice[] {
  return [
    ...pricing.matchAll(
      /^\|\s*([a-z0-9._-]+)\s+\((<|≥|>=)\s*(\d+)k prompt tokens\)\s*\|\s*([\d.]+[kM])\s*\|\s*\$([\d.]+)\s*\|\s*\$([\d.]+)\s*\|\s*\$([\d.]+)\s*\|$/gim,
    ),
  ].map((match) => {
    const [id, operator, threshold, context, input, cached, output] = match.slice(1);
    if (
      id === undefined ||
      operator === undefined ||
      threshold === undefined ||
      context === undefined ||
      input === undefined ||
      cached === undefined ||
      output === undefined
    )
      throw new Error("Invalid xAI text pricing row");
    return {
      id,
      long: operator !== "<",
      threshold: Number(threshold) * 1_000,
      context: count(context),
      input: scaleDecimal(input, 0),
      cached: scaleDecimal(cached, 0),
      output: scaleDecimal(output, 0),
    };
  });
}

function assertPublicPricing(
  pricing: string,
  language: z.infer<typeof languageModelSchema>[],
  images: z.infer<typeof imageModelSchema>[],
  videos: z.infer<typeof videoModelSchema>[],
): void {
  const rows = textPriceRows(pricing);
  if (rows.length !== language.length * 2)
    throw new Error("xAI text pricing does not cover the structured language catalog");
  for (const value of language) {
    const modelRows = rows.filter(({ id }) => id === value.name);
    const standard = modelRows.find(({ long }) => !long);
    const long = modelRows.find((row) => row.long);
    const threshold = Number(value.longContextThreshold);
    if (
      modelRows.length !== 2 ||
      standard === undefined ||
      long === undefined ||
      standard.context !== value.maxPromptLength ||
      long.context !== value.maxPromptLength ||
      standard.threshold !== threshold ||
      long.threshold !== threshold ||
      standard.input !== scaleDecimal(value.promptTextTokenPrice, -4) ||
      standard.cached !== scaleDecimal(value.cachedPromptTokenPrice, -4) ||
      standard.output !== scaleDecimal(value.completionTextTokenPrice, -4) ||
      long.input !== scaleDecimal(value.promptTextTokenPriceLongContext, -4) ||
      long.cached !== scaleDecimal(value.cachedPromptTokenPriceLongContext, -4) ||
      long.output !== scaleDecimal(value.completionTokenPriceLongContext, -4)
    )
      throw new Error(`xAI structured and published pricing differ for ${value.name}`);
  }
  const rowsById = new Map(
    [...pricing.matchAll(/^\|\s*([a-z0-9._-]+)\s*\|\s*\$([\d.]+)\s*\/\s*(image|sec)\s*\|$/gim)].map(
      (match) => [match[1] ?? "", scaleDecimal(match[2] ?? "", 0)],
    ),
  );
  if (rowsById.size !== images.length + videos.length)
    throw new Error("xAI Imagine pricing does not cover the structured catalog");
  for (const value of images) {
    const raw = value.imagePrice ?? value.resolutionPricing[0]?.pricePerImage;
    if (raw === undefined || rowsById.get(value.name) !== scaleDecimal(raw, -10))
      throw new Error(`xAI structured and published pricing differ for ${value.name}`);
  }
  for (const value of videos) {
    const raw = value.resolutionPricing[0]?.pricePerSecond;
    if (raw === undefined || rowsById.get(value.name) !== scaleDecimal(raw, -10))
      throw new Error(`xAI structured and published pricing differ for ${value.name}`);
  }
}

function toolRates(pricing: string, sourceId: string): PriceRate[] {
  const rates = [
    ...pricing.matchAll(
      /^\|\s*[^|]+\|\s*((?:`[^`]+`(?:,\s*)?)+)[^|]*\|[^|]+\|\s*\$([\d.]+)\s*\|$/gim,
    ),
  ].flatMap((match) => {
    const names = match[1];
    const price = match[2];
    if (names === undefined || price === undefined) return [];
    return [...names.matchAll(/`([^`]+)`/g)].flatMap((name) =>
      name[1] === undefined
        ? []
        : [
            publishedRate(
              "tool_call",
              scaleDecimal(price, 0),
              "thousand_requests",
              sourceId,
              "USD / 1k calls",
              { operation: name[1] },
            ),
          ],
    );
  });
  if (rates.length < 7) throw new Error("xAI tool pricing table was incomplete");
  return rates;
}

interface VoicePrices {
  realtime: string;
  text: string;
  speech: string;
  transcription: string;
  streamingTranscription: string;
}

function voicePrices(pricing: string): VoicePrices {
  const realtime = pricing.match(/^\| Realtime \| \$([\d.]+) \/ min/m)?.[1];
  const text = pricing.match(/^\| Realtime Text Input \| \$([\d.]+) \/ message/m)?.[1];
  const speech = pricing.match(/^\| Text to Speech \| \$([\d.]+) \/ 1M chars/m)?.[1];
  const transcription = pricing
    .match(/^\| Speech to Text \| \$([\d.]+) \/ hr \(REST\), \$([\d.]+) \/ hr \(Streaming\)/m)
    ?.slice(1);
  if (
    realtime === undefined ||
    text === undefined ||
    speech === undefined ||
    transcription?.[0] === undefined ||
    transcription[1] === undefined
  )
    throw new Error("xAI voice pricing table was incomplete");
  return {
    realtime: scaleDecimal(realtime, 0),
    text: scaleDecimal(text, 0),
    speech: scaleDecimal(speech, 0),
    transcription: scaleDecimal(transcription[0], 0),
    streamingTranscription: scaleDecimal(transcription[1], 0),
  };
}

function voiceRates(pricing: string, sourceId: string): PriceRate[] {
  const { realtime, text } = voicePrices(pricing);
  return [
    publishedRate("input_audio", realtime, "minute", sourceId, "USD / min"),
    publishedRate("output_audio", realtime, "minute", sourceId, "USD / min"),
    publishedRate("input_text", text, "request", sourceId, "USD / message", {
      operation: "conversation.item.create",
    }),
  ];
}

function assertVoiceServices(
  pricing: string,
  services: z.infer<typeof voiceServiceSchema>[],
): void {
  const prices = voicePrices(pricing);
  const endpoints = new Map(
    services.map((service) => [service.endpoints[0]?.endpoint, service.endpoints[0]]),
  );
  const tts = endpoints.get("TTS");
  const stt = endpoints.get("STT");
  const realtime = endpoints.get("REALTIME");
  if (
    services.length !== 3 ||
    endpoints.size !== 3 ||
    tts?.endpoint !== "TTS" ||
    stt?.endpoint !== "STT" ||
    realtime?.endpoint !== "REALTIME"
  )
    throw new Error("xAI voice service catalog was incomplete");
  const roundedCents = (ticksPerSecond: string, seconds: bigint): string =>
    ((BigInt(ticksPerSecond) * seconds + 50_000_000n) / 100_000_000n).toString();
  if (
    scaleDecimal(tts.pricing.perCharacter, -4) !== prices.speech ||
    roundedCents(stt.pricing.perAudioSecond, 3_600n) !== scaleDecimal(prices.transcription, 2) ||
    roundedCents(stt.pricing.perAudioSecondStreaming, 3_600n) !==
      scaleDecimal(prices.streamingTranscription, 2) ||
    roundedCents(realtime.pricing.realtimeAudioSecondPrice, 60n) !==
      scaleDecimal(prices.realtime, 2) ||
    scaleDecimal(realtime.pricing.realtimeTextInputPrice, -10) !== prices.text
  )
    throw new Error("xAI structured and published voice pricing differ");
}

function preview(id: string, aliases: string[], llms: string, releases: ReleaseSection[]): boolean {
  const multiAgent = section(llms, "/developers/model-capabilities/text/multi-agent");
  if (
    multiAgent.includes("currently in **beta**") &&
    [id, ...aliases].some((value) => multiAgent.includes(`\`${value}\``))
  )
    return true;
  return releases.some(({ body }) => body.includes(id) && /currently in early access/i.test(body));
}

function currentModels(
  input: ParseInput,
  catalog: z.infer<typeof publicModelsSchema>,
  html: string,
  llms: string,
): ProviderModel[] {
  const language = distinct(
    catalog.clusterConfigs.flatMap(({ languageModels }) => languageModels),
    "language",
  );
  const embeddings = distinct(
    catalog.clusterConfigs.flatMap(({ embeddingModels }) => embeddingModels),
    "embedding",
  );
  const images = distinct(
    catalog.clusterConfigs.flatMap(({ imageGenerationModels }) => imageGenerationModels),
    "image",
  );
  const voice = distinct(
    catalog.clusterConfigs.flatMap(({ audioModels }) => audioModels),
    "voice service",
  );
  const videos = distinct(
    catalog.clusterConfigs.flatMap(({ videoGenerationModels }) => videoGenerationModels),
    "video",
  );
  const endpoints = endpointFacts(llms, [...language, ...embeddings, ...images, ...videos]);
  const count = language.length + embeddings.length + images.length + voice.length + videos.length;
  const extractor = input.source.extractor;
  if (extractor.kind !== "xai-catalog") throw new Error("Invalid xAI catalog extractor");
  if (count < extractor.minModels || count > extractor.maxModels)
    throw new Error("xAI structured model count outside reviewed bounds");
  const pricing = section(llms, "/developers/pricing");
  assertPublicPricing(pricing, language, images, videos);
  if (voice.length > 0) assertVoiceServices(pricing, voice);
  const tools = toolRates(pricing, input.source.id);
  const names = displayNames(html);
  const releases = releaseSections(section(llms, "/developers/release-notes"));
  const details = (
    id: string,
    aliases: string[],
  ): Pick<ProviderModel, "name" | "release_date" | "updated_date"> => {
    const name = names.get(id) ?? id;
    return {
      name,
      release_date: releaseDate(releases, id, name, aliases),
      updated_date: updatedDate(aliases),
    };
  };
  const languageModels = language.map((value) => {
    const multiAgent = value.aliases.includes("grok-4.20-multi-agent");
    const status = preview(value.name, value.aliases, llms, releases) ? "preview" : "active";
    return model(input, value.name, {
      ...details(value.name, value.aliases),
      aliases: value.aliases,
      types: multiAgent ? ["generate", "agentic"] : ["generate"],
      api_endpoints: endpoints.get(value.name),
      modalities: {
        input: upperModalities(value.inputModalities),
        output: upperModalities(value.outputModalities),
      },
      capabilities: {
        ...unknownCapabilities(),
        reasoning: value.name.includes("non-reasoning")
          ? false
          : (value.features.reasoning ?? "unknown"),
        tool_call: value.features.functionCalling ?? "unknown",
        structured_output: value.features.structuredOutputs ?? "unknown",
        streaming: true,
        batch: true,
        prompt_cache: true,
        citations: multiAgent ? true : "unknown",
        code_execution: multiAgent ? true : "unknown",
        effort_control:
          multiAgent || value.features.reasoningEffortOptions !== undefined ? true : "unknown",
      },
      limits: { context_tokens: value.maxPromptLength },
      status,
      is_deprecated: false,
      pricing_status: "published",
      pricing: [...textRates(value, input.source.id), ...tools],
    });
  });
  const embeddingModels = embeddings.map((value) => {
    const rates = [
      exactRate(
        "input_text",
        value.promptTextTokenPrice,
        4,
        "million_tokens",
        input.source.id,
        "USD cents / 100M tokens",
      ),
      exactRate(
        "input_image",
        value.promptImageTokenPrice,
        4,
        "million_tokens",
        input.source.id,
        "USD cents / 100M tokens",
      ),
    ].filter(({ price }) => price !== "0");
    return model(input, value.name, {
      ...details(value.name, value.aliases),
      aliases: value.aliases,
      types: ["embeddings"],
      api_endpoints: endpoints.get(value.name),
      modalities: { input: upperModalities(value.inputModalities), output: ["embedding"] },
      status: "active",
      is_deprecated: false,
      pricing_status: rates.length > 0 ? "published" : "unknown",
      pricing: rates,
    });
  });
  const imageModels = images.map((value) => {
    const rates = value.resolutionPricing.map(({ resolution, pricePerImage }) =>
      mediaRate("image_generation", pricePerImage, "image", input.source.id, {
        resolution: resolution.replace("IMAGE_RESOLUTION_", ""),
      }),
    );
    if (value.pricePerInputImage !== undefined)
      rates.push(mediaRate("input_image", value.pricePerInputImage, "image", input.source.id));
    return model(input, value.name, {
      ...details(value.name, value.aliases),
      aliases: value.aliases,
      types: ["image"],
      api_endpoints: endpoints.get(value.name),
      modalities: {
        input: upperModalities(value.inputModalities),
        output: upperModalities(value.outputModalities),
      },
      capabilities: { ...unknownCapabilities(), batch: true },
      status: "active",
      is_deprecated: false,
      pricing_status: "published",
      pricing: rates,
    });
  });
  const videoModels = videos.map((value) => {
    const rates = value.resolutionPricing.map(({ resolution, pricePerSecond }) =>
      mediaRate("video_generation", pricePerSecond, "second", input.source.id, {
        resolution: resolution.replace("VIDEO_RESOLUTION_", "").toLowerCase(),
      }),
    );
    if (value.pricePerInputImage !== undefined)
      rates.push(mediaRate("input_image", value.pricePerInputImage, "image", input.source.id));
    if (value.pricePerInputVideoSecond !== undefined)
      rates.push(
        mediaRate("input_video", value.pricePerInputVideoSecond, "second", input.source.id),
      );
    return model(input, value.name, {
      ...details(value.name, value.aliases),
      aliases: value.aliases,
      types: ["video"],
      api_endpoints: endpoints.get(value.name),
      modalities: {
        input: upperModalities(value.inputModalities),
        output: upperModalities(value.outputModalities),
      },
      capabilities: { ...unknownCapabilities(), batch: true },
      status: "active",
      is_deprecated: false,
      pricing_status: "published",
      pricing: rates,
    });
  });
  return [...languageModels, ...embeddingModels, ...imageModels, ...videoModels];
}

function voiceModels(input: ParseInput, llms: string): ProviderModel[] {
  const voice = section(llms, "/developers/model-capabilities/audio/speech-to-speech");
  const latest = voice
    .match(/`(grok-voice-latest)` always points to the newest model \(currently `(grok-[^`]+)`\)/)
    ?.slice(1);
  const latestAlias = latest?.[0];
  const latestModel = latest?.[1];
  if (latestAlias === undefined || latestModel === undefined)
    throw new Error("xAI voice catalog omitted its latest alias");
  const tableStart = voice.indexOf("| Model | Description | |");
  const tableEnd = voice.indexOf("\n## ", tableStart);
  if (tableStart < 0) throw new Error("xAI voice model table was not found");
  const table = voice.slice(tableStart, tableEnd < 0 ? undefined : tableEnd);
  const rows = table.split("\n").flatMap((line) => {
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    const id = cells[0]?.match(/^`([^`]+)`$/)?.[1];
    return id === undefined || cells[1] === undefined
      ? []
      : [
          {
            id: modelIdSchema.parse(id),
            description: cells[1],
            deprecated: cells[2] === "deprecated",
          },
        ];
  });
  if (rows.length < 2 || !rows.some(({ id }) => id === latestModel))
    throw new Error("xAI voice model table was incomplete");
  const endpoint = documentedEndpoint(
    voice,
    latestAlias,
    "Realtime",
    "/v1/realtime",
    `wss://api.x.ai/v1/realtime?model=${latestAlias}`,
  );
  const pricing = section(llms, "/developers/pricing");
  const rates = [...voiceRates(pricing, input.source.id), ...toolRates(pricing, input.source.id)];
  const releases = releaseSections(section(llms, "/developers/release-notes"));
  return rows.map((row) => {
    const isLatest = row.id === latestModel;
    return model(input, row.id, {
      description: row.description,
      aliases: isLatest ? [latestAlias] : [],
      types: ["agentic", "realtime"],
      api_endpoints: [endpoint],
      modalities: { input: ["text", "audio"], output: ["text", "audio"] },
      capabilities: {
        ...unknownCapabilities(),
        reasoning: isLatest,
        tool_call: true,
        streaming: true,
        effort_control: isLatest,
      },
      release_date: releaseDate(releases, row.id, row.id),
      status: row.deprecated ? "deprecated" : "active",
      is_deprecated: row.deprecated,
      pricing_status: "published",
      pricing: rates,
    });
  });
}

function lifecycleModels(input: ParseInput, llms: string): ProviderModel[] {
  const lifecycle = section(llms, "/developers/migration/may-15-retirement");
  const dateMatch = lifecycle.match(/Effective (May) (\d{1,2}), (\d{4}) at 12:00 PM PT/);
  if (dateMatch?.[2] === undefined || dateMatch[3] === undefined)
    throw new Error("xAI retirement date was not found");
  const date = `${dateMatch[3]}-05-${dateMatch[2].padStart(2, "0")}`;
  const intro = lifecycle.slice(0, lifecycle.indexOf("### How the redirects work"));
  const retired = [...intro.matchAll(/^\* `([^`]+)`$/gm)].map((match) =>
    modelIdSchema.parse(match[1]),
  );
  const replacements = new Map(
    [...lifecycle.matchAll(/^\| `([^`]+)` \| `([^`]+)`/gm)].map((match) => [
      modelIdSchema.parse(match[1]),
      modelIdSchema.parse(match[2]),
    ]),
  );
  if (
    retired.length === 0 ||
    replacements.size !== retired.length ||
    retired.some((id) => !replacements.has(id))
  )
    throw new Error("xAI retirement model and replacement sets differ");
  const isRetired = input.observedAt.slice(0, 10) >= date;
  const releases = releaseSections(section(llms, "/developers/release-notes"));
  return retired.map((id) => {
    const image = id === "grok-imagine-image-pro";
    return model(input, id, {
      types: image ? ["image"] : ["generate"],
      release_date: releaseDate(releases, id, id),
      deprecated_at: date,
      retired_at: date,
      status: isRetired ? "retired" : "deprecated",
      is_deprecated: true,
      replacement_model_ids: [replacements.get(id) ?? ""].filter(Boolean),
    });
  });
}

function combine(models: ProviderModel[]): ProviderModel[] {
  const values = new Map<string, ProviderModel>();
  const known = <T extends boolean | "unknown">(left: T, right: T): T =>
    right === "unknown" ? left : right;
  const rank = new Map<ProviderModel["status"], number>([
    ["unknown", 0],
    ["active", 1],
    ["preview", 2],
    ["deprecated", 3],
    ["retired", 4],
  ]);
  for (const value of models) {
    const current = values.get(value.uid);
    if (current === undefined) {
      values.set(value.uid, value);
      continue;
    }
    values.set(value.uid, {
      ...current,
      name: current.name === current.model_id ? value.name : current.name,
      description: value.description ?? current.description,
      aliases: unique([...current.aliases, ...value.aliases]),
      types: unique([...current.types, ...value.types]),
      modalities: {
        input: unique([...current.modalities.input, ...value.modalities.input]),
        output: unique([...current.modalities.output, ...value.modalities.output]),
      },
      capabilities: {
        reasoning: known(current.capabilities.reasoning, value.capabilities.reasoning),
        tool_call: known(current.capabilities.tool_call, value.capabilities.tool_call),
        structured_output: known(
          current.capabilities.structured_output,
          value.capabilities.structured_output,
        ),
        streaming: known(current.capabilities.streaming, value.capabilities.streaming),
        batch: known(current.capabilities.batch, value.capabilities.batch),
        prompt_cache: known(current.capabilities.prompt_cache, value.capabilities.prompt_cache),
        fine_tuning: known(current.capabilities.fine_tuning, value.capabilities.fine_tuning),
        citations: known(current.capabilities.citations, value.capabilities.citations),
        code_execution: known(
          current.capabilities.code_execution,
          value.capabilities.code_execution,
        ),
        context_management: known(
          current.capabilities.context_management,
          value.capabilities.context_management,
        ),
        effort_control: known(
          current.capabilities.effort_control,
          value.capabilities.effort_control,
        ),
        computer_use: known(current.capabilities.computer_use, value.capabilities.computer_use),
      },
      limits: { ...current.limits, ...value.limits },
      release_date: current.release_date ?? value.release_date,
      updated_date: value.updated_date ?? current.updated_date,
      deprecated_at: value.deprecated_at ?? current.deprecated_at,
      retired_at: value.retired_at ?? current.retired_at,
      status:
        (rank.get(value.status) ?? 0) > (rank.get(current.status) ?? 0)
          ? value.status
          : current.status,
      is_deprecated: known(current.is_deprecated, value.is_deprecated),
      replacement_model_ids: unique([
        ...current.replacement_model_ids,
        ...value.replacement_model_ids,
      ]),
      pricing_status:
        current.pricing_status === "unknown" ? value.pricing_status : current.pricing_status,
      pricing: [
        ...new Map(
          [...current.pricing, ...value.pricing].map((rate) => [
            `${rate.meter}\0${rate.price}\0${rate.unit}\0${JSON.stringify(rate.conditions)}`,
            rate,
          ]),
        ).values(),
      ],
    });
  }
  return [...values.values()].sort((left, right) => left.uid.localeCompare(right.uid));
}

export function parseXaiCatalog(input: ParseInput): ProviderModel[] {
  const bundle = linkedBundleSchema.parse(JSON.parse(input.body));
  const llms = companion(bundle, "/llms.txt");
  return combine([
    ...currentModels(input, embeddedModels(bundle.index.body), bundle.index.body, llms),
    ...voiceModels(input, llms),
    ...lifecycleModels(input, llms),
  ]);
}

export function parseXaiApi(input: ParseInput): ProviderModel[] {
  const extractor = input.source.extractor;
  if (extractor.kind !== "xai-api") throw new Error("Invalid xAI API extractor");
  if (extractor.category === "all")
    return apiListSchema.parse(JSON.parse(input.body)).data.map((value) =>
      model(input, value.id, {
        aliases: value.aliases,
        limits: value.context_length === null ? {} : { context_tokens: value.context_length },
        scope: "runtime_observation",
      }),
    );
  const schema =
    extractor.category === "language"
      ? languageApiSchema
      : extractor.category === "image"
        ? imageApiSchema
        : videoApiSchema;
  const values = z.object({ models: z.array(schema).min(1) }).parse(JSON.parse(input.body)).models;
  const type: ModelType =
    extractor.category === "language"
      ? "generate"
      : extractor.category === "image"
        ? "image"
        : "video";
  return values.map((value) =>
    model(input, value.id, {
      aliases: value.aliases,
      types: [type],
      modalities: { input: value.input_modalities, output: value.output_modalities },
      scope: "runtime_observation",
    }),
  );
}
