import { load } from "cheerio";
import { z } from "zod";
import { linkedBundleSchema } from "./bundle.ts";
import { modelIdSchema } from "./identity.ts";
import { apiEndpointKey, baseModel } from "./model.ts";
import type { SourceManifest } from "./manifests.ts";
import { orderedTasks } from "./task.ts";
import { multiplyDecimal, publishedRate, scaleDecimal } from "./pricing.ts";
import type { ParsedProviderModel as ProviderModel, SourcePriceFact } from "./pricing-source.ts";
import {
  modalitySchema,
  type Modality,
  type ModelTask,
  type Provider,
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
const publicModelsEnvelopeSchema = z.object({
  clusterConfigs: z.array(z.record(z.string(), z.unknown())).min(1),
});
const modelCategoryKeys = new Set([
  "languageModels",
  "embeddingModels",
  "imageGenerationModels",
  "audioModels",
  "videoGenerationModels",
]);

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
      ...(values.version === undefined ? {} : { version: values.version }),
      name: values.name ?? id,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    }),
    ...values,
  };
}

function exactRate(
  meter: SourcePriceFact["meter"],
  raw: string,
  places: number,
  unit: SourcePriceFact["unit"],
  sourceId: string,
  rawUnit: string,
  conditions: SourcePriceFact["conditions"] = {},
): SourcePriceFact {
  return {
    ...publishedRate(meter, scaleDecimal(raw, -places), unit, sourceId, rawUnit, conditions),
    raw_price: raw,
  };
}

function tierRate(
  rate: SourcePriceFact,
  multiplier: string,
  tier: string,
  label: string,
): SourcePriceFact {
  return {
    ...rate,
    price: multiplyDecimal(rate.price, multiplier),
    conditions: { ...rate.conditions, service_tier: tier },
    derived: true,
    derivation: `${label} × ${multiplier}`,
  };
}

function textRates(
  value: z.infer<typeof languageModelSchema>,
  sourceId: string,
  batchMultiplier: string | undefined,
  priorityMultiplier: string,
): SourcePriceFact[] {
  const threshold = Number(value.longContextThreshold);
  const standard = threshold > 0 ? { context_max_tokens: threshold - 1 } : {};
  const long = threshold > 0 ? { context_min_tokens: threshold } : {};
  const rate = (
    meter: SourcePriceFact["meter"],
    raw: string,
    conditions: SourcePriceFact["conditions"],
  ): SourcePriceFact =>
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
  const priority = rates.map((item) =>
    tierRate(item, priorityMultiplier, "priority", "standard token price"),
  );
  const batch =
    batchMultiplier === undefined
      ? []
      : rates.map((item) => tierRate(item, batchMultiplier, "batch", "standard token price"));
  return [...rates, ...batch, ...priority];
}

function mediaRate(
  meter: SourcePriceFact["meter"],
  raw: string,
  unit: SourcePriceFact["unit"],
  sourceId: string,
  conditions: SourcePriceFact["conditions"] = {},
): SourcePriceFact {
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
  const value: unknown = JSON.parse(script.slice(prefix.length, -1));
  const envelope = publicModelsEnvelopeSchema.parse(value);
  const unknownCategories = unique(
    envelope.clusterConfigs.flatMap((cluster) =>
      Object.keys(cluster).filter((key) => key.endsWith("Models") && !modelCategoryKeys.has(key)),
    ),
  );
  if (unknownCategories.length > 0)
    throw new Error(`xAI public models payload added categories: ${unknownCategories.join(", ")}`);
  return publicModelsSchema.parse(value);
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

const endpointEvidence = [
  ["/developers/model-capabilities/text/generate-text", "Responses", "/v1/responses"],
  [
    "/developers/model-capabilities/legacy/chat-completions",
    "Chat Completions",
    "/v1/chat/completions",
  ],
  ["/developers/model-capabilities/text/multi-agent", "Responses", "/v1/responses"],
  [
    "/developers/model-capabilities/images/generation",
    "Image Generations",
    "/v1/images/generations",
  ],
  ["/developers/model-capabilities/images/editing", "Image Edits", "/v1/images/edits"],
  [
    "/developers/model-capabilities/video/generation",
    "Video Generations",
    "/v1/videos/generations",
  ],
  ["/developers/model-capabilities/imagine", "Video Generations", "/v1/videos/generations"],
] as const;

function requestModels(body: string, requestUrl: string): string[] {
  const ids = unique(
    [...body.matchAll(/```[^\n]*\n([\s\S]*?)```/g)]
      .flatMap((match) => (match[1]?.includes(requestUrl) ? [match[1]] : []))
      .flatMap((block) =>
        [...block.matchAll(/(?:"model"|model)\s*[:=]\s*["'](grok-[a-z0-9._-]+)["']/gi)].flatMap(
          (match) => (match[1] === undefined ? [] : [modelIdSchema.parse(match[1])]),
        ),
      ),
  );
  if (ids.length === 0) throw new Error(`xAI request example omitted a model for ${requestUrl}`);
  return ids;
}

function resolveModel(
  id: string,
  models: { name: string; aliases: string[] }[],
  evidence: string,
): string {
  const matches = models.filter((value) => value.name === id || value.aliases.includes(id));
  const value = matches[0];
  if (value === undefined || matches.length > 1)
    throw new Error(`xAI ${evidence} model ${id} did not resolve exactly once`);
  return value.name;
}

function endpointFacts(
  llms: string,
  models: { name: string; aliases: string[] }[],
): Map<string, ApiEndpoint[]> {
  const endpoints = new Map<string, ApiEndpoint[]>();
  for (const [pathname, name, path] of endpointEvidence) {
    for (const modelId of requestModels(section(llms, pathname), `https://api.x.ai${path}`)) {
      const id = resolveModel(modelId, models, "endpoint");
      endpoints.set(id, [...(endpoints.get(id) ?? []), { name, path }]);
    }
  }
  for (const [id, values] of endpoints)
    endpoints.set(
      id,
      [...new Map(values.map((value) => [apiEndpointKey(value), value])).values()].sort(
        (left, right) => apiEndpointKey(left).localeCompare(apiEndpointKey(right)),
      ),
    );
  return endpoints;
}

function multiAgentModels(
  llms: string,
  models: { name: string; aliases: string[] }[],
): Set<string> {
  const body = section(llms, "/developers/model-capabilities/text/multi-agent");
  if (!body.includes("currently in **beta**"))
    throw new Error("xAI Multi-agent release-stage evidence changed");
  return new Set(
    requestModels(body, "https://api.x.ai/v1/responses").map((id) =>
      resolveModel(id, models, "Multi-agent"),
    ),
  );
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
  const family = id.replace(/-\d{4}-(?:non-)?reasoning$/, "").replace(/-\d{4}$/, "");
  const ids = new Set([id, ...aliases]);
  const names = unique([name, family])
    .filter((value) => value !== id)
    .map((value) => value.toLowerCase().replaceAll("-", " "));
  const matches = releases.filter(({ body }) =>
    body
      .split(/^### /m)
      .slice(1)
      .some((entry) => {
        const heading = entry.split("\n", 1)[0]?.toLowerCase().replaceAll("-", " ") ?? "";
        const codes = new Set([...entry.matchAll(/`([^`]+)`/g)].map((match) => match[1]));
        return (
          [...ids].some((value) => codes.has(value)) ||
          names.some((value) => heading.includes(value))
        );
      }),
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

interface PricingTerms {
  batchMultipliers: Map<string, string>;
  priorityMultiplier: string;
}

function pricingTerms(
  pricing: string,
  models: { name: string; aliases: string[] }[],
): PricingTerms {
  const batch = pricing.slice(
    pricing.indexOf("## Batch API Pricing"),
    pricing.indexOf("## Priority Processing Pricing"),
  );
  const groups = [...batch.matchAll(/^\*\*(\d+)% off standard rates\*\*\n+((?:- [^\n]+\n?)+)/gm)];
  const batchMultipliers = new Map<string, string>();
  for (const match of groups) {
    const percent = match[1];
    const rows = match[2];
    if (percent === undefined || rows === undefined) continue;
    const value = Number(percent);
    if (!Number.isInteger(value) || value <= 0 || value >= 100)
      throw new Error("xAI batch discount was invalid");
    const multiplier = scaleDecimal(String(100 - value), -2);
    for (const row of rows.matchAll(/^- ([a-z0-9._-]+)$/gm)) {
      const rawId = row[1];
      if (rawId === undefined) throw new Error("xAI batch discount model was missing");
      const id = resolveModel(modelIdSchema.parse(rawId), models, "batch pricing");
      if (batchMultipliers.has(id)) throw new Error("xAI batch discount model was duplicated");
      batchMultipliers.set(id, multiplier);
    }
  }
  if (
    batchMultipliers.size === 0 ||
    !batch.includes("Models not listed above have no batch discount.") ||
    !batch.includes("The batch discount applies to all token types") ||
    !batch.includes(
      "Image and video generation are supported in the Batch API but are billed at standard rates.",
    )
  )
    throw new Error("xAI batch pricing terms were incomplete");

  const priority = pricing.slice(pricing.indexOf("## Priority Processing Pricing"));
  const multiplier = priority.match(/billed at a \*\*([\d.]+)x\*\* premium/)?.[1];
  if (
    multiplier === undefined ||
    !priority.includes(`| Token pricing | Standard rates | **${multiplier}x** standard rates |`) ||
    !priority.includes(`The ${multiplier}x multiplier applies to all token types`)
  )
    throw new Error("xAI priority pricing terms were incomplete");
  return { batchMultipliers, priorityMultiplier: scaleDecimal(multiplier, 0) };
}

function batchExclusions(llms: string, models: { name: string; aliases: string[] }[]): Set<string> {
  const body = section(llms, "/developers/advanced-api-usage/batch-api");
  const supported = [
    "/v1/chat/completions",
    "/v1/responses",
    "/v1/images/generations",
    "/v1/images/edits",
    "/v1/videos/generations",
    "/v1/videos/edits",
    "/v1/videos/extensions",
  ];
  if (supported.some((path) => !body.includes(`\`${path}\``)))
    throw new Error("xAI Batch API endpoint support changed");
  const ids = [
    ...body.matchAll(/`([^`]+)` is not currently supported for Batch API requests/g),
  ].flatMap((match) => (match[1] === undefined ? [] : [modelIdSchema.parse(match[1])]));
  if (ids.length === 0) throw new Error("xAI Batch API model exclusions changed");
  return new Set(ids.map((id) => resolveModel(id, models, "Batch API exclusion")));
}

function assertStreaming(llms: string): void {
  const body = section(llms, "/developers/model-capabilities/text/streaming");
  if (
    !body.includes("supported by all models with text output capability") ||
    !body.includes("not supported by models with image output capability")
  )
    throw new Error("xAI streaming support evidence changed");
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

function toolRates(pricing: string, sourceId: string): SourcePriceFact[] {
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
  realtime: Map<string, { audio: string; text: string }>;
  speech: string;
  transcription: string;
  streamingTranscription: string;
}

function voicePrices(pricing: string): VoicePrices {
  const realtime = new Map(
    [
      ...pricing.matchAll(
        /^\| Speech to Speech \(([^)]+)\) \| \$([\d.]+) \/ min \(\$[\d.]+ \/ hr\) audio<br\s*\/?>\$([\d.]+) \/ text input \|$/gim,
      ),
    ].map((match) => {
      const id = modelIdSchema.parse(match[1]);
      const audio = match[2];
      const text = match[3];
      if (audio === undefined || text === undefined)
        throw new Error("xAI voice pricing table was incomplete");
      return [id, { audio: scaleDecimal(audio, 0), text: scaleDecimal(text, 0) }] as const;
    }),
  );
  const speech = pricing.match(/^\| Text to Speech \| \$([\d.]+) \/ 1M chars/m)?.[1];
  const transcription = pricing
    .match(/^\| Speech to Text \| \$([\d.]+) \/ hr \(REST\), \$([\d.]+) \/ hr \(Streaming\)/m)
    ?.slice(1);
  if (
    realtime.size === 0 ||
    speech === undefined ||
    transcription?.[0] === undefined ||
    transcription[1] === undefined
  )
    throw new Error("xAI voice pricing table was incomplete");
  return {
    realtime,
    speech: scaleDecimal(speech, 0),
    transcription: scaleDecimal(transcription[0], 0),
    streamingTranscription: scaleDecimal(transcription[1], 0),
  };
}

function voiceRates(prices: VoicePrices, id: string, sourceId: string): SourcePriceFact[] {
  const rate = prices.realtime.get(id);
  if (rate === undefined) throw new Error(`xAI voice pricing omitted ${id}`);
  return [
    publishedRate("input_audio", rate.audio, "minute", sourceId, "USD / min"),
    publishedRate("output_audio", rate.audio, "minute", sourceId, "USD / min"),
    publishedRate("input_text", rate.text, "request", sourceId, "USD / text input", {
      operation: "conversation.item.create",
    }),
  ];
}

function assertVoiceServices(
  prices: VoicePrices,
  services: z.infer<typeof voiceServiceSchema>[],
): void {
  const endpoint = (name: "TTS" | "STT") => {
    const matches = services.flatMap((service) => {
      const value = service.endpoints[0];
      return value?.endpoint === name ? [value] : [];
    });
    return matches.length === 1 ? matches[0] : undefined;
  };
  const tts = endpoint("TTS");
  const stt = endpoint("STT");
  if (tts?.endpoint !== "TTS" || stt?.endpoint !== "STT")
    throw new Error("xAI voice service catalog was incomplete");
  const roundedCents = (ticksPerSecond: string, seconds: bigint): string =>
    ((BigInt(ticksPerSecond) * seconds + 50_000_000n) / 100_000_000n).toString();
  if (
    scaleDecimal(tts.pricing.perCharacter, -4) !== prices.speech ||
    roundedCents(stt.pricing.perAudioSecond, 3_600n) !== scaleDecimal(prices.transcription, 2) ||
    roundedCents(stt.pricing.perAudioSecondStreaming, 3_600n) !==
      scaleDecimal(prices.streamingTranscription, 2)
  )
    throw new Error("xAI structured and published voice pricing differ");
  const realtime = services.flatMap((service) => {
    const value = service.endpoints[0];
    return value?.endpoint === "REALTIME" ? [{ id: service.name, value }] : [];
  });
  if (realtime.length === 0) throw new Error("xAI voice service catalog was incomplete");
  for (const service of realtime) {
    const audio = roundedCents(service.value.pricing.realtimeAudioSecondPrice, 60n);
    const text = scaleDecimal(service.value.pricing.realtimeTextInputPrice, -10);
    const exact = prices.realtime.get(service.id);
    const matches = (published: { audio: string; text: string }): boolean =>
      audio === scaleDecimal(published.audio, 2) && text === published.text;
    const published = exact === undefined ? [...prices.realtime.values()] : [exact];
    if (!published.some(matches))
      throw new Error(`xAI structured and published voice pricing differ for ${service.id}`);
  }
}

function preview(
  id: string,
  aliases: string[],
  releases: ReleaseSection[],
  documentedBeta: boolean,
): boolean {
  return (
    documentedBeta ||
    releases.some(
      ({ body }) =>
        [id, ...aliases].some((value) => body.includes(value)) &&
        /currently in early access/i.test(body),
    )
  );
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
  const routable = [...language, ...embeddings, ...images, ...videos];
  const endpoints = endpointFacts(llms, routable);
  const multiAgent = multiAgentModels(llms, language);
  const excludedFromBatch = batchExclusions(llms, routable);
  assertStreaming(llms);
  const count = language.length + embeddings.length + images.length + voice.length + videos.length;
  const extractor = input.source.extractor;
  if (extractor.kind !== "xai-catalog") throw new Error("Invalid xAI catalog extractor");
  if (count < extractor.minModels || count > extractor.maxModels)
    throw new Error("xAI structured model count outside reviewed bounds");
  const pricing = section(llms, "/developers/pricing");
  assertPublicPricing(pricing, language, images, videos);
  const prices = voicePrices(pricing);
  if (voice.length > 0) assertVoiceServices(prices, voice);
  const terms = pricingTerms(pricing, language);
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
    const isMultiAgent = multiAgent.has(value.name);
    const releaseStage = preview(value.name, value.aliases, releases, isMultiAgent)
      ? "preview"
      : "unknown";
    return model(input, value.name, {
      ...details(value.name, value.aliases),
      version: value.version,
      aliases: value.aliases,
      tasks: ["text_generation"],
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
        batch: !excludedFromBatch.has(value.name),
        prompt_cache: true,
        citations: isMultiAgent ? true : "unknown",
        code_execution: isMultiAgent ? true : "unknown",
        effort_control:
          isMultiAgent || value.features.reasoningEffortOptions !== undefined ? true : "unknown",
      },
      limits: { context_tokens: value.maxPromptLength },
      status: "active",
      release_stage: releaseStage,
      pricing_state: "numeric",
      price_facts: [
        ...textRates(
          value,
          input.source.id,
          terms.batchMultipliers.get(value.name),
          terms.priorityMultiplier,
        ),
        ...tools,
      ],
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
      version: value.version,
      aliases: value.aliases,
      tasks: ["embeddings"],
      api_endpoints: endpoints.get(value.name),
      modalities: { input: upperModalities(value.inputModalities), output: ["embedding"] },
      status: "active",
      pricing_state: rates.length > 0 ? "numeric" : "unknown",
      price_facts: rates,
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
      version: value.version,
      aliases: value.aliases,
      tasks: ["image_generation"],
      api_endpoints: endpoints.get(value.name),
      modalities: {
        input: upperModalities(value.inputModalities),
        output: upperModalities(value.outputModalities),
      },
      capabilities: { ...unknownCapabilities(), streaming: false, batch: true },
      status: "active",
      pricing_state: "numeric",
      price_facts: rates,
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
      version: value.version,
      aliases: value.aliases,
      tasks: ["video_generation"],
      api_endpoints: endpoints.get(value.name),
      modalities: {
        input: upperModalities(value.inputModalities),
        output: upperModalities(value.outputModalities),
      },
      capabilities: { ...unknownCapabilities(), batch: true },
      status: "active",
      pricing_state: "numeric",
      price_facts: rates,
    });
  });
  return [
    ...languageModels,
    ...embeddingModels,
    ...imageModels,
    ...videoModels,
    ...voiceModels(input, llms, voice, prices, tools, releases),
  ];
}

function voiceModels(
  input: ParseInput,
  llms: string,
  services: z.infer<typeof voiceServiceSchema>[],
  prices: VoicePrices,
  tools: SourcePriceFact[],
  releases: ReleaseSection[],
): ProviderModel[] {
  const voice = section(llms, "/developers/model-capabilities/audio/speech-to-speech");
  const tableStart = voice.indexOf("| Model | Description | |");
  const currentTableStart = tableStart < 0 ? voice.indexOf("| Model | Description |") : tableStart;
  const tableEnd = voice.indexOf("\n## ", currentTableStart);
  if (currentTableStart < 0) throw new Error("xAI voice model table was not found");
  const table = voice.slice(currentTableStart, tableEnd < 0 ? undefined : tableEnd);
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
  const latestAlias = voice.match(
    /wss:\/\/api\.x\.ai\/v1\/realtime\?model=(grok-[a-z0-9._-]+)/i,
  )?.[1];
  if (latestAlias === undefined) throw new Error("xAI Realtime endpoint evidence changed");
  const alias = rows.find(({ id }) => id === latestAlias);
  const latestModel = alias?.description.match(/Alias for `(grok-[^`]+)`/)?.[1];
  const models = rows.filter(({ id }) => id !== latestAlias);
  if (
    latestModel === undefined ||
    models.length < 2 ||
    !models.some(({ id }) => id === latestModel)
  )
    throw new Error("xAI voice model table was incomplete");
  const latestServices = services.filter(({ aliases }) => aliases.includes(latestAlias));
  if (latestServices.length !== 1 || latestServices[0]?.name !== latestModel)
    throw new Error("xAI structured and documented voice aliases differ");
  const endpoint: ApiEndpoint = { name: "Realtime", path: "/v1/realtime" };
  return models.map((row) => {
    const matches = services.filter(({ name }) => name === row.id);
    const service = matches[0];
    if (
      service === undefined ||
      matches.length > 1 ||
      service.endpoints[0]?.endpoint !== "REALTIME"
    )
      throw new Error(`xAI structured voice model ${row.id} did not resolve exactly once`);
    return model(input, row.id, {
      version: service.version,
      description: row.description,
      aliases: service.aliases,
      tasks: ["text_generation", "speech_to_speech"],
      api_endpoints: [endpoint],
      modalities: {
        input: upperModalities(service.inputModalities),
        output: upperModalities(service.outputModalities),
      },
      capabilities: {
        ...unknownCapabilities(),
        reasoning: true,
        tool_call: true,
        streaming: true,
        effort_control: true,
      },
      release_date: releaseDate(releases, row.id, row.id),
      status: row.deprecated ? "deprecated" : "active",
      pricing_state: "numeric",
      price_facts: [...voiceRates(prices, row.id, input.source.id), ...tools],
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
  const redirected = [...intro.matchAll(/^\* `([^`]+)`$/gm)].map((match) =>
    modelIdSchema.parse(match[1]),
  );
  const replacements = new Map(
    [...lifecycle.matchAll(/^\| `([^`]+)` \| `([^`]+)`/gm)].map((match) => [
      modelIdSchema.parse(match[1]),
      modelIdSchema.parse(match[2]),
    ]),
  );
  if (
    redirected.length === 0 ||
    replacements.size !== redirected.length ||
    redirected.some((id) => !replacements.has(id)) ||
    !/continue to resolve/i.test(lifecycle) ||
    !/automatically redirect/i.test(lifecycle)
  )
    throw new Error("xAI redirect model and replacement evidence changed");
  const isLegacy = input.observedAt.slice(0, 10) >= date;
  const releases = releaseSections(section(llms, "/developers/release-notes"));
  return redirected.map((id) =>
    model(input, id, {
      release_date: releaseDate(releases, id, id),
      deprecated_at: date,
      status: isLegacy ? "legacy" : "deprecated",
      replacement_model_ids: [replacements.get(id) ?? ""].filter(Boolean),
    }),
  );
}

function combine(models: ProviderModel[]): ProviderModel[] {
  const values = new Map<string, ProviderModel>();
  const known = <T extends boolean | "unknown">(left: T, right: T): T =>
    right === "unknown" ? left : right;
  const rank = new Map<ProviderModel["status"], number>([
    ["unknown", 0],
    ["active", 1],
    ["legacy", 2],
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
      tasks: orderedTasks([...current.tasks, ...value.tasks]),
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
      release_stage:
        value.release_stage === "unknown" ? current.release_stage : value.release_stage,
      replacement_model_ids: unique([
        ...current.replacement_model_ids,
        ...value.replacement_model_ids,
      ]),
      pricing_state:
        current.pricing_state === "unknown" ? value.pricing_state : current.pricing_state,
      price_facts: [
        ...new Map(
          [...current.price_facts, ...value.price_facts].map((rate) => [
            `${rate.meter}\0${rate.price}\0${rate.unit}\0${JSON.stringify(rate.conditions)}`,
            rate,
          ]),
        ).values(),
      ],
    });
  }
  return [...values.values()].sort((left, right) => left.uid.localeCompare(right.uid));
}

function redirectedModels(models: ProviderModel[]): ProviderModel[] {
  const byId = new Map<string, ProviderModel[]>();
  for (const value of models)
    byId.set(value.model_id, [...(byId.get(value.model_id) ?? []), value]);
  return models.map((value) => {
    const replacement = value.replacement_model_ids[0];
    if (
      value.status !== "legacy" ||
      replacement === undefined ||
      value.replacement_model_ids.length !== 1
    )
      return value;
    const targets = byId.get(replacement) ?? [];
    const target = targets[0];
    if (
      target === undefined ||
      targets.length !== 1 ||
      target.pricing_state !== "numeric" ||
      target.price_facts.length === 0 ||
      value.deprecated_at === undefined
    )
      throw new Error(`xAI redirect target ${replacement} did not resolve to one priced model`);
    return {
      ...value,
      tasks: target.tasks,
      modalities: target.modalities,
      capabilities: target.capabilities,
      limits: target.limits,
      pricing_state: "numeric",
      price_facts: target.price_facts.map((rate) => ({
        ...rate,
        conditions: { ...rate.conditions, effective_from: value.deprecated_at },
        derived: true,
        derivation: `Redirects to ${replacement} from ${value.deprecated_at}; ${
          rate.derivation ?? "published target rate"
        }`,
      })),
    };
  });
}

export function parseXaiCatalog(input: ParseInput): ProviderModel[] {
  const bundle = linkedBundleSchema.parse(JSON.parse(input.body));
  const llms = companion(bundle, "/llms.txt");
  return redirectedModels(
    combine([
      ...currentModels(input, embeddedModels(bundle.index.body), bundle.index.body, llms),
      ...lifecycleModels(input, llms),
    ]),
  );
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
  const type: ModelTask =
    extractor.category === "language"
      ? "text_generation"
      : extractor.category === "image"
        ? "image_generation"
        : "video_generation";
  return values.map((value) =>
    model(input, value.id, {
      version: value.version,
      aliases: value.aliases,
      tasks: [type],
      modalities: { input: value.input_modalities, output: value.output_modalities },
      scope: "runtime_observation",
    }),
  );
}
