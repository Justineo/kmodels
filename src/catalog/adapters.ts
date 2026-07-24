import { load } from "cheerio";
import { z } from "zod";
import { parseAnthropicApi, parseAnthropicCatalog } from "./anthropic.ts";
import { parseAzureApi, parseAzureCatalog } from "./azure.ts";
import { parseBedrockApi, parseBedrockCatalog } from "./bedrock.ts";
import {
  parseCerebrasApi,
  parseCerebrasCatalog,
  parseCerebrasLifecycle,
  parseCerebrasPublic,
  parseCerebrasReleases,
} from "./cerebras.ts";
import { parseCohereApi, parseCohereCatalog } from "./cohere.ts";
import { parseDatabricksApi, parseDatabricksCatalog } from "./databricks.ts";
import { parseDeepseekApi, parseDeepseekCatalog, parseDeepseekUpdates } from "./deepseek.ts";
import {
  parseDashscopeApi,
  parseDashscopeCatalog,
  parseDashscopeLifecycle,
  parseDashscopePricing,
  parseDashscopeRecommended,
} from "./dashscope.ts";
import { parseGeminiApi, parseGeminiCatalog } from "./gemini.ts";
import { parseHuggingFaceMapping, parseHuggingFaceRouter } from "./huggingface.ts";
import { parseLlamaApi, parseLlamaCatalog } from "./llama.ts";
import {
  parseKimiApi,
  parseKimiCatalog,
  parseKimiOpenApi,
  parseKimiPricing,
  parseKimiReleases,
} from "./kimi.ts";
import { parseMistralApi, parseMistralCatalog } from "./mistral.ts";
import { parseOllamaCloud, parseOllamaLibrary } from "./ollama.ts";
import { linkedBundleSchema } from "./bundle.ts";
import { modelIdSchema } from "./identity.ts";
import { baseModel } from "./model.ts";
import type { SourceManifest } from "./manifests.ts";
import { multiplyDecimal, publishedRate } from "./pricing.ts";
import { classifyModelOperations } from "./operation.ts";
import { parseVercelCatalog } from "./vercel.ts";
import { parseVertexApi, parseVertexCatalog } from "./vertex.ts";
import { parseXaiApi, parseXaiCatalog } from "./xai.ts";
import {
  modalitySchema,
  type Modality,
  type ModelOperation,
  type PriceRate,
  type ProviderModel,
  type Provider,
  unknownCapabilities,
} from "./schema.ts";

export { multiplyDecimal, scaleDecimal } from "./pricing.ts";
export { classifyModelOperations, normalizeModelOperations } from "./operation.ts";
export {
  modelStateFromLabel,
  normalizeModelReleaseStage,
  releaseStageFromIdentity,
} from "./lifecycle.ts";

const openAiItemSchema = z.object({
  id: modelIdSchema,
  object: z.literal("model"),
  created: z.number().int().nonnegative(),
  owned_by: z.string().min(1),
});

const listSchema = z.object({ data: z.array(z.unknown()) });
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

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
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

const openAiEndpointDefinitions = new Map<string, { name: string; operations: ModelOperation[] }>([
  ["v1/chat/completions", { name: "Chat Completions", operations: ["text_generation"] }],
  ["v1/responses", { name: "Responses", operations: ["text_generation"] }],
  ["v1/realtime", { name: "Realtime", operations: ["speech_to_speech"] }],
  ["v1/realtime/translations", { name: "Realtime translation", operations: ["translation"] }],
  [
    "v1/realtime/transcription_sessions",
    { name: "Realtime transcription", operations: ["transcription"] },
  ],
  ["v1/assistants", { name: "Assistants", operations: ["text_generation"] }],
  ["v1/batch", { name: "Batch", operations: [] }],
  ["v1/fine-tuning", { name: "Fine-tuning", operations: [] }],
  ["v1/embeddings", { name: "Embeddings", operations: ["embeddings"] }],
  ["v1/images/generations", { name: "Image generation", operations: ["image_generation"] }],
  ["v1/videos", { name: "Videos", operations: ["video_generation"] }],
  ["v1/images/edits", { name: "Image edit", operations: ["image_generation"] }],
  ["v1/audio/speech", { name: "Speech generation", operations: ["speech_synthesis"] }],
  ["v1/audio/transcriptions", { name: "Transcription", operations: ["transcription"] }],
  ["v1/audio/translations", { name: "Translation", operations: ["translation"] }],
  ["v1/moderations", { name: "Moderation", operations: ["moderation"] }],
  ["v1/completions", { name: "Completions (legacy)", operations: ["text_generation"] }],
]);

interface OpenAiEndpointEvidence {
  endpoints: NonNullable<ProviderModel["api_endpoints"]>;
  operations: ModelOperation[];
}

function openAiEndpointEvidence(
  $: LoadedDocument,
  fallback: ModelOperation[],
): OpenAiEndpointEvidence {
  const content = sectionContent($, "Endpoints");
  if (content.length === 0) throw new Error("OpenAI model page omitted Endpoints");
  const endpoints: NonNullable<ProviderModel["api_endpoints"]> = [];
  const operations: ModelOperation[] = [];
  const observedPaths = new Set<string>();
  content
    .find("div")
    .filter((_index, element) => {
      const children = $(element).children("div");
      return (
        children.length === 2 && /^v\d+\/[a-z0-9_./-]+$/.test(normalizedText(children.eq(1).text()))
      );
    })
    .each((_index, element) => {
      const children = $(element).children("div");
      const nameNode = children.eq(0);
      const name = normalizedText(nameNode.text());
      const path = normalizedText(children.eq(1).text());
      const definition = openAiEndpointDefinitions.get(path);
      if (definition === undefined || definition.name !== name)
        throw new Error(`Unsupported OpenAI endpoint card: ${name}/${path}`);
      if (observedPaths.has(path)) throw new Error(`Duplicate OpenAI endpoint card: ${path}`);
      observedPaths.add(path);
      if (nameNode.hasClass("text-gray-400")) return;
      endpoints.push({ name, path });
      operations.push(...definition.operations);
    });
  if (observedPaths.size === 0)
    throw new Error("OpenAI Endpoints section contained no endpoint cards");
  return {
    endpoints,
    operations: operations.length > 0 ? unique(operations) : fallback,
  };
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
  operations: ModelOperation[],
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
    if (operations.includes("transcription")) return "input_audio";
    if (operations.includes("speech_synthesis") || operations.includes("speech_to_speech"))
      return "output_audio";
  }
}

function openAiPricing(
  $: LoadedDocument,
  sourceId: string,
  operations: ModelOperation[],
): PriceRate[] {
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
        const meter = openAiMeter(group, label, operations);
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
  const statuses = new Map<string, Pick<ProviderModel, "status" | "release_stage">>();
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
    statuses.set(id, {
      status: deprecated ? "deprecated" : "active",
      release_stage: id.includes("preview") ? "preview" : "unknown",
    });
  });
  if (statuses.size !== bundle.documents.length)
    throw new Error("OpenAI catalog index and model pages disagree");

  return bundle.documents
    .map((document) => {
      const id = modelIdSchema.parse(new URL(document.url).pathname.split("/").at(-1));
      const lifecycle = statuses.get(id);
      if (lifecycle === undefined) throw new Error(`OpenAI catalog omitted index entry for ${id}`);
      const $ = load(document.body);
      const name = normalizedText(
        $("main .text-2xl.font-semibold.whitespace-nowrap").first().text(),
      );
      if (name === "") throw new Error(`OpenAI model page omitted display name for ${id}`);
      const description = normalizedText($("main .hidden.text-secondary.sm\\:flex").first().text());
      const observedModalities = openAiModalities($);
      const classifiedOperations = classifyModelOperations({
        modelId: id,
        name,
        rawType: undefined,
        modalities: observedModalities,
        fallback: "text_generation",
      });
      const endpointEvidence = openAiEndpointEvidence($, classifiedOperations);
      const operations = endpointEvidence.operations;
      const embeddingOutput: Modality[] = ["embedding"];
      const modelModalities: ProviderModel["modalities"] = operations.includes("embeddings")
        ? { input: observedModalities.input, output: embeddingOutput }
        : observedModalities;
      const pricing = openAiPricing($, input.source.id, operations);
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
        operations,
        api_endpoints: endpointEvidence.endpoints,
        modalities: modelModalities,
        capabilities: {
          ...features,
          reasoning: pageText.includes("Reasoning token support") ? true : features.reasoning,
          prompt_cache: pricing.some((rate) => rate.meter.startsWith("cache_"))
            ? true
            : features.prompt_cache,
          batch:
            endpointEvidence.endpoints.some(({ path }) => path === "v1/batch") ||
            pricing.some((rate) => rate.conditions.service_tier === "batch")
              ? true
              : features.batch,
          fine_tuning: endpointEvidence.endpoints.some(({ path }) => path === "v1/fine-tuning")
            ? true
            : features.fine_tuning,
        },
        limits: {
          context_tokens: openAiTokenLimit($, "context window"),
          max_output_tokens: openAiTokenLimit($, "max output tokens"),
        },
        ...lifecycle,
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
            operations: classifyModelOperations({
              modelId: id,
              name: id,
              rawType: undefined,
              modalities: { input: [], output: [] },
              fallback: "text_generation",
            }),
            status,
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
    case "cerebras-public":
      return parseCerebrasPublic(input);
    case "cerebras-catalog":
      return parseCerebrasCatalog(input);
    case "cerebras-lifecycle":
      return parseCerebrasLifecycle(input);
    case "cerebras-releases":
      return parseCerebrasReleases(input);
    case "cerebras-api":
      return parseCerebrasApi(input);
    case "huggingface-mapping":
      return parseHuggingFaceMapping(input);
    case "huggingface-router":
      return parseHuggingFaceRouter(input);
    case "ollama-library":
      return parseOllamaLibrary(input);
    case "ollama-cloud":
      return parseOllamaCloud(input);
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
    case "xai-catalog":
      return parseXaiCatalog(input);
    case "xai-api":
      return parseXaiApi(input);
    case "dashscope-catalog":
      return parseDashscopeCatalog(input);
    case "dashscope-pricing":
      return parseDashscopePricing(input);
    case "dashscope-recommended":
      return parseDashscopeRecommended(input);
    case "dashscope-lifecycle":
      return parseDashscopeLifecycle(input);
    case "dashscope-api":
      return parseDashscopeApi(input);
    case "deepseek-catalog":
      return parseDeepseekCatalog(input);
    case "deepseek-updates":
      return parseDeepseekUpdates(input);
    case "deepseek-api":
      return parseDeepseekApi(input);
    case "kimi-openapi":
      return parseKimiOpenApi(input);
    case "kimi-catalog":
      return parseKimiCatalog(input);
    case "kimi-pricing":
      return parseKimiPricing(input);
    case "kimi-releases":
      return parseKimiReleases(input);
    case "kimi-api":
      return parseKimiApi(input);
  }
}
