import { load } from "cheerio";
import { z } from "zod";
import { parseAnthropicApi, parseAnthropicCatalog } from "./anthropic.ts";
import { parseAzureApi, parseAzureCatalog } from "./azure.ts";
import { parseBedrockApi, parseBedrockCatalog } from "./bedrock.ts";
import { parseCohereApi, parseCohereCatalog } from "./cohere.ts";
import { parseDatabricksApi, parseDatabricksCatalog } from "./databricks.ts";
import { parseGeminiApi, parseGeminiCatalog } from "./gemini.ts";
import { parseLlamaApi, parseLlamaCatalog } from "./llama.ts";
import { parseMistralApi, parseMistralCatalog } from "./mistral.ts";
import { linkedBundleSchema } from "./bundle.ts";
import { modelIdSchema } from "./identity.ts";
import { baseModel } from "./model.ts";
import type { SourceManifest } from "./manifests.ts";
import { multiplyDecimal, publishedRate, scaleDecimal } from "./pricing.ts";
import { classifyModelTypes } from "./task.ts";
import { parseVercelCatalog } from "./vercel.ts";
import { parseVertexApi, parseVertexCatalog } from "./vertex.ts";
import {
  modalitySchema,
  type Modality,
  type ModelType,
  type PriceRate,
  type ProviderModel,
  type Provider,
  unknownCapabilities,
} from "./schema.ts";

export { multiplyDecimal, scaleDecimal } from "./pricing.ts";
export { classifyModelTypes, normalizeModelTypes } from "./task.ts";

const decimalValue = z
  .union([z.string(), z.number().finite().nonnegative()])
  .transform((value) => String(value));

const cerebrasItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  created: z.number().int().nonnegative().optional(),
  preview: z.boolean().optional(),
  deprecated: z.boolean().optional(),
  pricing: z
    .object({ prompt: decimalValue.optional(), completion: decimalValue.optional() })
    .optional(),
  capabilities: z
    .object({
      streaming: z.boolean().optional(),
      function_calling: z.boolean().optional(),
      structured_outputs: z.boolean().optional(),
      vision: z.boolean().optional(),
      reasoning: z.boolean().optional(),
    })
    .optional(),
  limits: z
    .object({
      max_context_length: z.number().int().nonnegative().nullable().optional(),
      max_completion_tokens: z.number().int().nonnegative().nullable().optional(),
    })
    .optional(),
});

const huggingFaceRouteSchema = z.object({
  provider: z.string().min(1),
  context_length: z.number().int().nonnegative().optional(),
  supports_tools: z.boolean().optional(),
  supports_structured_output: z.boolean().optional(),
  pricing: z.object({ input: decimalValue.optional(), output: decimalValue.optional() }).optional(),
});

const huggingFaceItemSchema = z.object({
  id: z.string().min(1),
  owned_by: z.string().optional(),
  created: z.number().int().nonnegative().optional(),
  architecture: z
    .object({
      input_modalities: z.array(z.string()).optional(),
      output_modalities: z.array(z.string()).optional(),
    })
    .optional(),
  providers: z.array(huggingFaceRouteSchema).min(1),
});

const ollamaItemSchema = z.object({
  name: z.string().min(1),
  model: z.string().min(1).optional(),
  modified_at: z.string().optional(),
});

const openAiItemSchema = z.object({
  id: modelIdSchema,
  object: z.literal("model"),
  created: z.number().int().nonnegative(),
  owned_by: z.string().min(1),
});

const listSchema = z.object({ data: z.array(z.unknown()) });
const ollamaListSchema = z.object({ models: z.array(z.unknown()) });
interface ParseInput {
  provider: Provider;
  source: SourceManifest;
  body: string;
  observedAt: string;
}

type LoadedDocument = ReturnType<typeof load>;
type Selection = ReturnType<LoadedDocument>;

function parseJson(body: string): unknown {
  return JSON.parse(body);
}

function unixDate(seconds: number | undefined): string | undefined {
  return seconds === undefined ? undefined : new Date(seconds * 1000).toISOString().slice(0, 10);
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function modalities(values: string[] | undefined): Modality[] {
  if (values === undefined) return [];
  return unique(
    values.flatMap((value) => {
      const parsed = modalitySchema.safeParse(value);
      return parsed.success ? [parsed.data] : [];
    }),
  );
}

function tokenRate(
  meter: PriceRate["meter"],
  value: string,
  sourceId: string,
  rawUnit: string,
  conditions: PriceRate["conditions"] = {},
  scale = true,
): PriceRate {
  return {
    meter,
    price: scale ? scaleDecimal(value, 6) : value,
    currency: "USD",
    unit: "million_tokens",
    conditions,
    source_ref: sourceId,
    derived: scale,
    derivation: scale ? "source price per token × 1,000,000" : undefined,
    raw_price: value,
    raw_unit: rawUnit,
  };
}

function normalizedText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sectionContent($: LoadedDocument, label: string): Selection {
  const heading = $("main div")
    .filter(
      (_index, element) =>
        $(element).children().length === 0 && normalizedText($(element).text()) === label,
    )
    .first();
  return heading.parent().children().eq(1);
}

function openAiModalities($: LoadedDocument): ProviderModel["modalities"] {
  const content = sectionContent($, "Modalities");
  if (content.length === 0) throw new Error("OpenAI model page omitted Modalities");
  const input: Modality[] = [];
  const output: Modality[] = [];
  content
    .find("div")
    .filter(
      (_index, element) =>
        $(element).children().length === 0 &&
        ["Text", "Image", "Audio", "Video"].includes(normalizedText($(element).text())),
    )
    .each((_index, element) => {
      const label = normalizedText($(element).text()).toLowerCase();
      const support = normalizedText($(element).parent().children().eq(1).text());
      const parsed = modalitySchema.safeParse(label);
      if (!parsed.success) return;
      if (support === "Input only" || support === "Input and output") input.push(parsed.data);
      if (support === "Output only" || support === "Input and output") output.push(parsed.data);
    });
  if (input.length === 0 && output.length === 0)
    throw new Error("OpenAI model page contained no supported modalities");
  return { input: unique(input), output: unique(output) };
}

function openAiFeatures($: LoadedDocument): ProviderModel["capabilities"] {
  const values = new Map<string, boolean>();
  const content = sectionContent($, "Features");
  content
    .find("div")
    .filter(
      (_index, element) =>
        $(element).children().length === 0 &&
        ["Streaming", "Function calling", "Structured outputs", "Fine-tuning"].includes(
          normalizedText($(element).text()),
        ),
    )
    .each((_index, element) => {
      const label = normalizedText($(element).text());
      const support = normalizedText($(element).parent().children().eq(1).text());
      if (support === "Supported") values.set(label, true);
      if (support === "Not supported") values.set(label, false);
    });
  const value = (label: string): boolean | "unknown" => values.get(label) ?? "unknown";
  return {
    ...unknownCapabilities(),
    reasoning: "unknown",
    tool_call: value("Function calling"),
    structured_output: value("Structured outputs"),
    streaming: value("Streaming"),
    batch: "unknown",
    prompt_cache: "unknown",
    fine_tuning: value("Fine-tuning"),
  };
}

function openAiTypes($: LoadedDocument, fallback: ModelType[]): ModelType[] {
  const labels = new Map<string, ModelType[]>([
    ["Chat Completions", ["generate"]],
    ["Responses", ["generate"]],
    ["Completions (legacy)", ["generate"]],
    ["Assistants", ["agentic"]],
    ["Embeddings", ["embeddings"]],
    ["Speech generation", ["audio_speech"]],
    ["Transcription", ["audio_transcription"]],
    ["Translation", ["audio_translation"]],
    ["Image generation", ["image"]],
    ["Image edit", ["image"]],
    ["Videos", ["video"]],
    ["Realtime", ["realtime"]],
    ["Realtime translation", ["realtime", "audio_translation"]],
    ["Realtime transcription", ["realtime", "audio_transcription"]],
    ["Moderation", ["moderation"]],
  ]);
  const observed: ModelType[] = [];
  sectionContent($, "Endpoints")
    .find("div")
    .filter((_index, element) => $(element).children().length === 0)
    .each((_index, element) => {
      if ($(element).hasClass("text-gray-400")) return;
      observed.push(...(labels.get(normalizedText($(element).text())) ?? []));
    });
  return observed.length > 0 ? unique(observed) : fallback;
}

function openAiAliases($: LoadedDocument, id: string): string[] {
  const content = sectionContent($, "Snapshots");
  const label = content
    .find("div")
    .filter(
      (_index, element) =>
        $(element).children().length === 0 && normalizedText($(element).text()) === id,
    )
    .first();
  const card = label
    .parents()
    .filter((_index, element) => {
      const parent = $(element).parent();
      return parent.hasClass("font-mono") && parent.hasClass("gap-8");
    })
    .first();
  const scope = card.length > 0 ? card : label.parent();
  if (scope.length === 0) throw new Error(`OpenAI model page omitted snapshot card for ${id}`);
  return unique(
    scope
      .find("*")
      .filter((_index, element) => $(element).children().length === 0)
      .map((_index, element) => normalizedText($(element).text()))
      .get()
      .filter(
        (value) =>
          value !== id && value === value.toLowerCase() && modelIdSchema.safeParse(value).success,
      ),
  ).sort();
}

function openAiMeter(
  group: string,
  label: string,
  types: ModelType[],
): PriceRate["meter"] | undefined {
  if (group === "Text tokens") {
    if (label === "Input") return "input_text";
    if (label === "Cached input") return "cache_read_text";
    if (label === "Output") return "output_text";
  }
  if (group === "Audio tokens") {
    if (label === "Input") return "input_audio";
    if (label === "Cached input") return "cache_read_audio";
    if (label === "Output") return "output_audio";
  }
  if (group === "Image tokens") {
    if (label === "Input") return "input_image";
    if (label === "Cached input") return "cache_read_image";
    if (label === "Output") return "output_image";
  }
  if (group === "Embeddings" && (label === "Cost" || label === "Price")) return "embedding";
  if (group === "Image generation") return "image_generation";
  if (group === "Video generation") return "video_generation";
  if (group === "Realtime audio duration" && label === "Price") {
    if (types.includes("audio_transcription") || types.includes("realtime")) return "input_audio";
    if (types.includes("audio_speech")) return "output_audio";
  }
}

function openAiPricing($: LoadedDocument, sourceId: string, types: ModelType[]): PriceRate[] {
  const content = sectionContent($, "Pricing");
  if (content.length === 0) return [];
  const rates: PriceRate[] = [];
  const groups = new Set([
    "Text tokens",
    "Audio tokens",
    "Image tokens",
    "Embeddings",
    "Image generation",
    "Video generation",
    "Realtime audio duration",
  ]);
  content
    .find("div")
    .filter(
      (_index, element) =>
        $(element).children().length === 0 && normalizedText($(element).text()).startsWith("Per "),
    )
    .each((_index, element) => {
      const unitNode = $(element);
      const header = unitNode
        .parents()
        .filter((_parentIndex, parent) => {
          const children = $(parent).children();
          return children.length >= 2 && groups.has(normalizedText(children.first().text()));
        })
        .first();
      const group = normalizedText(header.children().first().text());
      const rawUnit = normalizedText(unitNode.text());
      const serviceTier = normalizedText(unitNode.parent().text()).includes("Batch API price")
        ? "batch"
        : undefined;
      const unit: PriceRate["unit"] =
        rawUnit === "Per 1M tokens"
          ? "million_tokens"
          : rawUnit === "Per image"
            ? "image"
            : rawUnit === "Per second"
              ? "second"
              : rawUnit === "Per minute"
                ? "minute"
                : (() => {
                    throw new Error(`Unsupported OpenAI pricing unit: ${rawUnit}`);
                  })();
      const cards = header.next().children();
      let quality: string | undefined;
      cards.each((_cardIndex, card) => {
        const label = normalizedText($(card).children().first().text());
        const value = normalizedText($(card).children().last().text());
        if (label === "Quality" && !value.startsWith("$")) quality = value;
      });
      cards.each((_cardIndex, card) => {
        const label = normalizedText($(card).children().first().text());
        const rawPrice = normalizedText($(card).children().last().text());
        const match = rawPrice.match(/^\$((?:0|[1-9]\d*)(?:\.\d+)?)$/);
        if (match?.[1] === undefined) return;
        const meter = openAiMeter(group, label, types);
        if (meter === undefined)
          throw new Error(`Unsupported OpenAI pricing field: ${group}/${label}`);
        const conditions: PriceRate["conditions"] = {};
        if (serviceTier !== undefined) conditions.service_tier = serviceTier;
        if (quality !== undefined) conditions.quality = quality;
        if (group === "Image generation" || group === "Video generation")
          conditions.resolution = label;
        rates.push(publishedRate(meter, match[1], unit, sourceId, rawUnit, conditions));
      });
    });

  content
    .find("div")
    .filter(
      (_index, element) =>
        normalizedText($(element).children().first().text()) === "Pricing" &&
        $(element).children().length === 2,
    )
    .each((_index, element) => {
      const cards = $(element).next().children();
      let useCase: string | undefined;
      let rawPrice: string | undefined;
      let rawUnit: string | undefined;
      cards.each((_cardIndex, card) => {
        const label = normalizedText($(card).children().first().text());
        const value = normalizedText($(card).children().last().text());
        if (label.startsWith("Use case / ")) useCase = value;
        if (label.startsWith("Cost / ")) {
          rawPrice = value.match(/^\$((?:0|[1-9]\d*)(?:\.\d+)?)$/)?.[1];
          rawUnit = label.slice("Cost / ".length);
        }
      });
      if (useCase === undefined || rawPrice === undefined || rawUnit === undefined) return;
      const meter: PriceRate["meter"] | undefined =
        useCase === "Speech generation"
          ? "output_audio"
          : useCase === "Transcription"
            ? "input_audio"
            : undefined;
      const unit: PriceRate["unit"] | undefined =
        rawUnit === "1M characters"
          ? "million_characters"
          : rawUnit === "minute"
            ? "minute"
            : undefined;
      if (meter === undefined || unit === undefined)
        throw new Error(`Unsupported OpenAI pricing use case: ${useCase}/${rawUnit}`);
      rates.push(publishedRate(meter, rawPrice, unit, sourceId, `per ${rawUnit}`));
    });
  if (rates.length === 0) throw new Error("OpenAI Pricing section contained no rates");

  const pageText = normalizedText($("main").text());
  const longContext = pageText.match(
    /Prompts with >([\d,]+)(K)? input tokens are priced at ([\d.]+)x input and ([\d.]+)x output/,
  );
  if (
    longContext?.[1] !== undefined &&
    longContext[3] !== undefined &&
    longContext[4] !== undefined
  ) {
    const threshold =
      Number(longContext[1].replaceAll(",", "")) * (longContext[2] === "K" ? 1_000 : 1);
    const additions = rates.flatMap((rate): PriceRate[] => {
      const multiplier =
        rate.meter === "input_text"
          ? longContext[3]
          : rate.meter === "output_text"
            ? longContext[4]
            : undefined;
      if (multiplier === undefined || rate.conditions.context_min_tokens !== undefined) return [];
      return [
        {
          ...rate,
          price: multiplyDecimal(rate.price, multiplier),
          conditions: { ...rate.conditions, context_min_tokens: threshold + 1 },
          derived: true,
          derivation: `${multiplier} × published ${rate.meter} rate above ${threshold} input tokens`,
          raw_price: undefined,
          raw_unit: "published long-context multiplier",
        },
      ];
    });
    rates.push(...additions);
  }

  const cacheWrite = pageText.match(/Cache writes are billed at ([\d.]+)x the uncached input/);
  if (cacheWrite?.[1] !== undefined) {
    const multiplier = cacheWrite[1];
    rates.push(
      ...rates.flatMap((rate): PriceRate[] =>
        rate.meter !== "input_text"
          ? []
          : [
              {
                ...rate,
                meter: "cache_write_text",
                price: multiplyDecimal(rate.price, multiplier),
                derived: true,
                derivation: `${multiplier} × published uncached input rate`,
                raw_price: undefined,
                raw_unit: "published cache-write multiplier",
              },
            ],
      ),
    );
  }
  return rates;
}

function openAiTokenLimit(
  $: LoadedDocument,
  label: "context window" | "max output tokens",
): number | undefined {
  const match = $("main *")
    .filter((_index, element) => $(element).children().length === 0)
    .map((_index, element) => normalizedText($(element).text()).match(`^([\\d,]+) ${label}$`)?.[1])
    .get()
    .find((value) => value !== undefined);
  return match === undefined ? undefined : Number(match.replaceAll(",", ""));
}

function parseOpenAiCatalog(input: ParseInput): ProviderModel[] {
  const bundle = linkedBundleSchema.parse(parseJson(input.body));
  const index = load(bundle.index.body);
  const statuses = new Map<string, ProviderModel["status"]>();
  index("a[href]").each((_index, element) => {
    const target = index(element).attr("href");
    const match = target?.match(/^\/api\/docs\/models\/([a-z0-9._-]+)$/);
    if (match?.[1] === undefined) return;
    const id = match[1];
    const deprecated =
      index(element)
        .find("*")
        .filter(
          (_childIndex, child) =>
            index(child).children().length === 0 &&
            normalizedText(index(child).text()) === "Deprecated",
        ).length > 0;
    statuses.set(id, deprecated ? "deprecated" : id.includes("preview") ? "preview" : "active");
  });
  if (statuses.size !== bundle.documents.length)
    throw new Error("OpenAI catalog index and model pages disagree");

  return bundle.documents
    .map((document) => {
      const id = modelIdSchema.parse(new URL(document.url).pathname.split("/").at(-1));
      const status = statuses.get(id);
      if (status === undefined) throw new Error(`OpenAI catalog omitted index entry for ${id}`);
      const $ = load(document.body);
      const name = normalizedText(
        $("main .text-2xl.font-semibold.whitespace-nowrap").first().text(),
      );
      if (name === "") throw new Error(`OpenAI model page omitted display name for ${id}`);
      const description = normalizedText($("main .hidden.text-secondary.sm\\:flex").first().text());
      const observedModalities = openAiModalities($);
      const classifiedTypes = classifyModelTypes({
        modelId: id,
        name,
        rawType: undefined,
        modalities: observedModalities,
        fallback: "generate",
      });
      const types = openAiTypes($, classifiedTypes);
      const embeddingOutput: Modality[] = ["embedding"];
      const modelModalities: ProviderModel["modalities"] = types.includes("embeddings")
        ? { input: observedModalities.input, output: embeddingOutput }
        : observedModalities;
      const pricing = openAiPricing($, input.source.id, types);
      const features = openAiFeatures($);
      const pageText = normalizedText($("main").text());
      const aliases = openAiAliases($, id);
      return {
        ...baseModel({
          providerId: input.provider.id,
          id,
          name,
          sourceId: input.source.id,
          observedAt: input.observedAt,
        }),
        description: description || undefined,
        aliases,
        types,
        modalities: modelModalities,
        capabilities: {
          ...features,
          reasoning: pageText.includes("Reasoning token support") ? true : features.reasoning,
          prompt_cache: pricing.some((rate) => rate.meter.startsWith("cache_"))
            ? true
            : features.prompt_cache,
          batch: pricing.some((rate) => rate.conditions.service_tier === "batch")
            ? true
            : features.batch,
        },
        limits: {
          context_tokens: openAiTokenLimit($, "context window"),
          max_output_tokens: openAiTokenLimit($, "max output tokens"),
        },
        status,
        is_deprecated: status === "deprecated",
        pricing_status:
          pricing.length > 0
            ? "published"
            : pageText.includes("free models designed to detect harmful content") ||
                pageText.includes("open-weight model")
              ? "not_applicable"
              : "unknown",
        pricing,
      } satisfies ProviderModel;
    })
    .sort((left, right) => left.uid.localeCompare(right.uid));
}

function parseOpenAiOverview(input: ParseInput): ProviderModel[] {
  const $ = load(input.body);
  const models = new Map<string, ProviderModel>();
  $("main div")
    .filter(
      (_index, element) =>
        $(element).children().length === 0 && normalizedText($(element).text()) === "Model ID",
    )
    .each((_index, element) => {
      const row = $(element).parent();
      const id = normalizedText(row.children().last().text());
      if (!modelIdSchema.safeParse(id).success) return;
      const aliasLabel = row
        .parent()
        .children()
        .find("div")
        .filter(
          (_aliasIndex, candidate) =>
            $(candidate).children().length === 0 && normalizedText($(candidate).text()) === "Alias",
        )
        .first();
      if (aliasLabel.length === 0) return;
      const alias = normalizedText(aliasLabel.parent().children().last().text());
      if (alias === id || !modelIdSchema.safeParse(alias).success) return;
      models.set(id, {
        ...baseModel({
          providerId: input.provider.id,
          id,
          name: id,
          sourceId: input.source.id,
          observedAt: input.observedAt,
        }),
        aliases: [alias],
      });
    });
  if (models.size === 0) throw new Error("OpenAI overview contained no model aliases");
  return [...models.values()].sort((left, right) => left.uid.localeCompare(right.uid));
}

function parseOpenAiApi(input: ParseInput): ProviderModel[] {
  const list = listSchema.parse(parseJson(input.body));
  const results = list.data.map((item) => openAiItemSchema.safeParse(item));
  if (list.data.length === 0 || results.some((result) => !result.success))
    throw new Error("OpenAI model API schema drift");
  return results.flatMap((result) =>
    result.success
      ? [
          baseModel({
            providerId: input.provider.id,
            id: result.data.id,
            name: result.data.id,
            sourceId: input.source.id,
            observedAt: input.observedAt,
          }),
        ]
      : [],
  );
}

function parseOpenAiDeprecations(input: ParseInput): ProviderModel[] {
  const $ = load(input.body);
  const models = new Map<string, ProviderModel>();
  $("table").each((_tableIndex, table) => {
    const headers = $(table)
      .find("thead th")
      .map((_index, cell) => normalizedText($(cell).text()).toLowerCase())
      .get();
    const dateIndex = headers.findIndex((header) => header === "shutdown date");
    const modelIndex = headers.findIndex(
      (header) =>
        header === "model / system" ||
        header === "deprecated model" ||
        header === "legacy model" ||
        header === "model",
    );
    const replacementIndex = headers.findIndex((header) => header === "recommended replacement");
    if (dateIndex < 0 || modelIndex < 0) return;
    $(table)
      .find("tbody tr")
      .each((_rowIndex, row) => {
        const cells = $(row).children("td");
        const retiredAt = normalizedText(cells.eq(dateIndex).text()).replace(/[‐‑‒–—−]/g, "-");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(retiredAt)) return;
        const replacements =
          replacementIndex < 0
            ? []
            : unique(
                cells
                  .eq(replacementIndex)
                  .find("code")
                  .map((_index, code) => normalizedText($(code).text()))
                  .get()
                  .filter((id) => modelIdSchema.safeParse(id).success),
              );
        const ids = unique(
          cells
            .eq(modelIndex)
            .find("code")
            .map((_index, code) => normalizedText($(code).text()))
            .get()
            .filter((id) => modelIdSchema.safeParse(id).success),
        );
        for (const id of ids) {
          const status = retiredAt <= input.observedAt.slice(0, 10) ? "retired" : "deprecated";
          const model: ProviderModel = {
            ...baseModel({
              providerId: input.provider.id,
              id,
              name: id,
              sourceId: input.source.id,
              observedAt: input.observedAt,
            }),
            types: classifyModelTypes({
              modelId: id,
              name: id,
              rawType: undefined,
              modalities: { input: [], output: [] },
              fallback: "generate",
            }),
            status,
            is_deprecated: true,
            retired_at: retiredAt,
            replacement_model_ids: replacements,
          };
          const previous = models.get(id);
          if (previous === undefined || (previous.retired_at ?? "") <= retiredAt)
            models.set(id, model);
        }
      });
  });
  if (models.size === 0) throw new Error("OpenAI deprecations page contained no model rows");
  return [...models.values()].sort((left, right) => left.uid.localeCompare(right.uid));
}

function parseCerebras(input: ParseInput): ProviderModel[] {
  const list = listSchema.parse(parseJson(input.body));
  const results = list.data.map((item) => cerebrasItemSchema.safeParse(item));
  const invalid = results.filter((result) => !result.success).length;
  if (list.data.length === 0 || invalid > 0) throw new Error("Cerebras model schema drift");

  return results.flatMap((result) => {
    if (!result.success) return [];
    const item = result.data;
    const prices: PriceRate[] = [];
    if (item.pricing?.prompt !== undefined)
      prices.push(tokenRate("input_text", item.pricing.prompt, input.source.id, "token"));
    if (item.pricing?.completion !== undefined)
      prices.push(tokenRate("output_text", item.pricing.completion, input.source.id, "token"));
    const vision = item.capabilities?.vision === true;
    return [
      {
        ...baseModel({
          providerId: input.provider.id,
          id: item.id,
          name: item.name ?? item.id,
          sourceId: input.source.id,
          observedAt: input.observedAt,
        }),
        description: item.description,
        types: ["generate"],
        modalities: { input: vision ? ["text", "image"] : ["text"], output: ["text"] },
        capabilities: {
          ...unknownCapabilities(),
          reasoning: item.capabilities?.reasoning ?? "unknown",
          tool_call: item.capabilities?.function_calling ?? "unknown",
          structured_output: item.capabilities?.structured_outputs ?? "unknown",
          streaming: item.capabilities?.streaming ?? "unknown",
          batch: "unknown",
          prompt_cache: "unknown",
          fine_tuning: "unknown",
        },
        limits: {
          context_tokens: item.limits?.max_context_length ?? undefined,
          max_output_tokens: item.limits?.max_completion_tokens ?? undefined,
        },
        release_date: unixDate(item.created),
        status: item.deprecated ? "deprecated" : item.preview ? "preview" : "active",
        pricing_status: prices.length > 0 ? "derived" : "unknown",
        pricing: prices,
      },
    ];
  });
}

function consensus(values: (boolean | undefined)[]): boolean | "unknown" {
  const known = values.filter((value) => value !== undefined);
  if (known.length === 0) return "unknown";
  if (known.every((value) => value)) return true;
  if (known.every((value) => !value)) return false;
  return "unknown";
}

function parseHuggingFace(input: ParseInput): ProviderModel[] {
  const list = listSchema.parse(parseJson(input.body));
  const results = list.data.map((item) => huggingFaceItemSchema.safeParse(item));
  const invalid = results.filter((result) => !result.success).length;
  if (list.data.length === 0 || invalid / list.data.length > 0.05)
    throw new Error("Hugging Face model schema drift");

  return results.flatMap((result) => {
    if (!result.success) return [];
    const item = result.data;
    const prices: PriceRate[] = [];
    for (const route of item.providers) {
      if (route.pricing?.input !== undefined)
        prices.push(
          tokenRate(
            "input_text",
            route.pricing.input,
            input.source.id,
            "million_tokens",
            { route_provider: route.provider },
            false,
          ),
        );
      if (route.pricing?.output !== undefined)
        prices.push(
          tokenRate(
            "output_text",
            route.pricing.output,
            input.source.id,
            "million_tokens",
            { route_provider: route.provider },
            false,
          ),
        );
    }
    const inputModalities = modalities(item.architecture?.input_modalities);
    const outputModalities = modalities(item.architecture?.output_modalities);
    const contexts = unique(
      item.providers.flatMap((route) =>
        route.context_length === undefined ? [] : [route.context_length],
      ),
    );
    return [
      {
        ...baseModel({
          providerId: input.provider.id,
          id: item.id,
          name: item.id,
          sourceId: input.source.id,
          observedAt: input.observedAt,
        }),
        types: classifyModelTypes({
          modelId: item.id,
          name: item.id,
          rawType: undefined,
          modalities: { input: inputModalities, output: outputModalities },
          fallback: "generate",
        }),
        modalities: { input: inputModalities, output: outputModalities },
        capabilities: {
          ...unknownCapabilities(),
          tool_call: consensus(item.providers.map((route) => route.supports_tools)),
          structured_output: consensus(
            item.providers.map((route) => route.supports_structured_output),
          ),
        },
        limits: { context_tokens: contexts.length === 1 ? contexts[0] : undefined },
        release_date: unixDate(item.created),
        status: "active",
        pricing_status: prices.length > 0 ? "published" : "unknown",
        pricing: prices,
      },
    ];
  });
}

function documentFragments(body: string, source: SourceManifest): string[] {
  const fragments: string[] = [];
  const $ = load(body);
  if (
    source.extractor.kind === "document-identifiers" &&
    source.extractor.linkTarget !== undefined
  ) {
    const linkTarget = source.extractor.linkTarget;
    for (const match of body.matchAll(/(?<!!)\[([^\]]+)\]\(([^)]+)\)/g)) {
      const label = match[1]?.replace(/\\\+/g, "+").trim();
      const target = match[2]?.trim();
      if (label !== undefined && target !== undefined && linkTarget.test(target)) {
        fragments.push(label);
        const lastSegment = target.split("/").filter(Boolean).at(-1)?.split(/[?#]/)[0];
        if (lastSegment !== undefined) fragments.push(decodeURIComponent(lastSegment));
      }
    }
    $("a[href]").each((_index, element) => {
      const target = $(element).attr("href");
      if (target === undefined || !linkTarget.test(target)) return;
      const label = $(element).text().trim();
      if (label !== "") fragments.push(label);
      const lastSegment = target.split("/").filter(Boolean).at(-1)?.split(/[?#]/)[0];
      if (lastSegment !== undefined) fragments.push(decodeURIComponent(lastSegment));
    });
    return unique(fragments);
  }
  $("code").each((_index, element) => {
    const text = $(element).text().trim();
    if (text) fragments.push(text);
  });
  for (const match of body.matchAll(/`([^`\n]+)`/g)) {
    const value = match[1]?.trim();
    if (value) fragments.push(value);
  }
  return unique(fragments);
}

function identifierCandidates(fragment: string): string[] {
  const clean = fragment.replace(/^["']|["'.,;:]$/g, "").trim();
  const tokens = clean.split(/[\s,;()[\]{}<>"']+/).filter(Boolean);
  return unique([clean, ...tokens]).filter((value) => value.length <= 128 && !value.includes("//"));
}

function parseDocument(input: ParseInput): ProviderModel[] {
  const extractor = input.source.extractor;
  if (extractor.kind !== "document-identifiers") throw new Error("Wrong document extractor");
  const ids = unique(
    documentFragments(input.body, input.source).flatMap((fragment) =>
      (extractor.linkTarget !== undefined
        ? [fragment.trim()]
        : identifierCandidates(fragment)
      ).filter((candidate) => extractor.patterns.some((pattern) => pattern.test(candidate))),
    ),
  ).sort();
  if (ids.length === 0) throw new Error("No model identifiers found in document");
  return ids.map((id) => ({
    ...baseModel({
      providerId: input.provider.id,
      id,
      name: id,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    }),
    id_kind: extractor.idKind,
    types: classifyModelTypes({
      modelId: id,
      name: id,
      rawType: undefined,
      modalities: { input: [], output: [] },
      fallback: extractor.defaultType,
    }),
    pricing_status: input.provider.kind === "model_publisher" ? "not_applicable" : "unknown",
  }));
}

function parseOllama(input: ParseInput): ProviderModel[] {
  const list = ollamaListSchema.parse(parseJson(input.body));
  const results = list.models.map((item) => ollamaItemSchema.safeParse(item));
  if (list.models.length === 0 || results.some((result) => !result.success))
    throw new Error("Ollama model schema drift");
  return results.flatMap((result) => {
    if (!result.success) return [];
    const id = result.data.model ?? result.data.name;
    const modelModalities = { input: [], output: [] };
    return [
      {
        ...baseModel({
          providerId: input.provider.id,
          id,
          name: result.data.name,
          sourceId: input.source.id,
          observedAt: input.observedAt,
        }),
        types: classifyModelTypes({
          modelId: id,
          name: result.data.name,
          rawType: undefined,
          modalities: modelModalities,
          fallback: "generate",
        }),
        updated_date: result.data.modified_at?.slice(0, 10),
        pricing_status: "not_applicable",
        status: "active",
      },
    ];
  });
}

function parseVllm(input: ParseInput): ProviderModel[] {
  const list = listSchema.parse(parseJson(input.body));
  const ids = list.data.map((item) => z.object({ id: z.string().min(1) }).parse(item).id);
  if (ids.length === 0) throw new Error("vLLM returned an empty model list");
  return unique(ids).map((id) => ({
    ...baseModel({
      providerId: input.provider.id,
      id,
      name: id,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    }),
    types: classifyModelTypes({
      modelId: id,
      name: id,
      rawType: undefined,
      modalities: { input: [], output: [] },
      fallback: "generate",
    }),
    pricing_status: "not_applicable",
    scope: "runtime_observation",
    status: "active",
  }));
}

export function parseSource(input: ParseInput): ProviderModel[] {
  switch (input.source.extractor.kind) {
    case "openai-catalog":
      return parseOpenAiCatalog(input);
    case "openai-overview":
      return parseOpenAiOverview(input);
    case "openai-api":
      return parseOpenAiApi(input);
    case "openai-deprecations":
      return parseOpenAiDeprecations(input);
    case "anthropic-catalog":
      return parseAnthropicCatalog(input);
    case "anthropic-api":
      return parseAnthropicApi(input);
    case "vercel-catalog":
      return parseVercelCatalog(input);
    case "cerebras":
      return parseCerebras(input);
    case "huggingface":
      return parseHuggingFace(input);
    case "ollama":
      return parseOllama(input);
    case "vllm":
      return parseVllm(input);
    case "bedrock-catalog":
      return parseBedrockCatalog(input);
    case "bedrock-api":
      return parseBedrockApi(input);
    case "databricks-catalog":
      return parseDatabricksCatalog(input);
    case "databricks-api":
      return parseDatabricksApi(input);
    case "azure-catalog":
      return parseAzureCatalog(input);
    case "azure-api":
      return parseAzureApi(input);
    case "gemini-catalog":
      return parseGeminiCatalog(input);
    case "gemini-api":
      return parseGeminiApi(input);
    case "vertex-catalog":
      return parseVertexCatalog(input);
    case "vertex-api":
      return parseVertexApi(input);
    case "cohere-catalog":
      return parseCohereCatalog(input);
    case "cohere-api":
      return parseCohereApi(input);
    case "mistral-catalog":
      return parseMistralCatalog(input);
    case "mistral-api":
      return parseMistralApi(input);
    case "llama-catalog":
      return parseLlamaCatalog(input);
    case "llama-api":
      return parseLlamaApi(input);
    case "document-identifiers":
      return parseDocument(input);
  }
}
