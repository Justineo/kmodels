import { load } from "cheerio";
import { z } from "zod";
import { parseAnthropicApi, parseAnthropicCatalog } from "./anthropic.ts";
import { parseAzureApi, parseAzureCatalog, parseAzureRetailPrices } from "./azure.ts";
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
  parseDashscopeReleases,
} from "./dashscope.ts";
import { parseGeminiApi, parseGeminiCatalog } from "./gemini.ts";
import {
  parseHuggingFaceHub,
  parseHuggingFaceMapping,
  parseHuggingFaceRouter,
} from "./huggingface.ts";
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
import { decimalsEqual, multiplyDecimal, publishedRate } from "./pricing.ts";
import {
  sourcePriceFactKey,
  type ParsedProviderModel as ProviderModel,
  type SourcePriceFact,
} from "./pricing-source.ts";
import {
  assertItemCount,
  invalidJsonContractEvidence,
  recognizeItems,
  SourceContractError,
  zodContractEvidence,
  type SourceContractEvidence,
} from "./source-contract.ts";
import { classifyModelTasks } from "./task.ts";
import { parseVercelCatalog } from "./vercel.ts";
import { parseVertexApi, parseVertexCatalog } from "./vertex.ts";
import { parseXaiApi, parseXaiCatalog } from "./xai.ts";
import {
  modalitySchema,
  type Modality,
  type ModelTask,
  type Provider,
  unknownCapabilities,
} from "./schema.ts";

export { multiplyDecimal, scaleDecimal } from "./pricing.ts";
export { classifyModelTasks, normalizeModelTasks } from "./task.ts";
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
  catalogModels?: readonly Pick<
    ProviderModel,
    "aliases" | "model_id" | "price_facts" | "tasks" | "version"
  >[];
  onContractFinding?: (evidence: SourceContractEvidence) => void;
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

function openAiSupport($: LoadedDocument, section: string): Map<string, boolean> {
  const values = new Map<string, boolean>();
  const content = sectionContent($, section);
  content
    .find("div")
    .filter((_index, element) => $(element).children().length === 0)
    .each((_index, element) => {
      const label = normalizedText($(element).text());
      const support = normalizedText($(element).parent().children().eq(1).text());
      if (support === "Supported") values.set(label, true);
      if (support === "Not supported") values.set(label, false);
    });
  return values;
}

function openAiSupportValue(values: Map<string, boolean>, labels: string[]): boolean | "unknown" {
  const observed = labels.flatMap((label) => {
    const value = values.get(label);
    return value === undefined ? [] : [value];
  });
  if (observed.includes(true)) return true;
  return observed.length === labels.length ? false : "unknown";
}

function openAiFeatures($: LoadedDocument): ProviderModel["capabilities"] {
  const values = openAiSupport($, "Features");
  const value = (label: string): boolean | "unknown" => openAiSupportValue(values, [label]);
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

const openAiEndpointDefinitions = new Map<string, { name: string; tasks: ModelTask[] }>([
  ["v1/chat/completions", { name: "Chat Completions", tasks: ["text_generation"] }],
  ["v1/responses", { name: "Responses", tasks: ["text_generation"] }],
  ["v1/realtime", { name: "Realtime", tasks: ["speech_to_speech"] }],
  ["v1/realtime/translations", { name: "Realtime translation", tasks: ["translation"] }],
  [
    "v1/realtime/transcription_sessions",
    { name: "Realtime transcription", tasks: ["transcription"] },
  ],
  ["v1/assistants", { name: "Assistants", tasks: ["text_generation"] }],
  ["v1/batch", { name: "Batch", tasks: [] }],
  ["v1/fine-tuning", { name: "Fine-tuning", tasks: [] }],
  ["v1/embeddings", { name: "Embeddings", tasks: ["embeddings"] }],
  ["v1/images/generations", { name: "Image generation", tasks: ["image_generation"] }],
  ["v1/videos", { name: "Videos", tasks: ["video_generation"] }],
  ["v1/images/edits", { name: "Image edit", tasks: ["image_generation"] }],
  ["v1/audio/speech", { name: "Speech generation", tasks: ["speech_synthesis"] }],
  ["v1/audio/transcriptions", { name: "Transcription", tasks: ["transcription"] }],
  ["v1/audio/translations", { name: "Translation", tasks: ["translation"] }],
  ["v1/moderations", { name: "Moderation", tasks: ["moderation"] }],
  ["v1/completions", { name: "Completions (legacy)", tasks: ["text_generation"] }],
]);

interface OpenAiEndpointEvidence {
  endpoints: NonNullable<ProviderModel["api_endpoints"]>;
  tasks: ModelTask[];
}

function openAiEndpointEvidence($: LoadedDocument, fallback: ModelTask[]): OpenAiEndpointEvidence {
  const content = sectionContent($, "Endpoints");
  if (content.length === 0) throw new Error("OpenAI model page omitted Endpoints");
  const endpoints: NonNullable<ProviderModel["api_endpoints"]> = [];
  const tasks: ModelTask[] = [];
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
      tasks.push(...definition.tasks);
    });
  if (observedPaths.size === 0)
    throw new Error("OpenAI Endpoints section contained no endpoint cards");
  return {
    endpoints,
    tasks: tasks.length > 0 ? unique(tasks) : fallback,
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
  tasks: ModelTask[],
): SourcePriceFact["meter"] | undefined {
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
  if (group === "Transcription audio duration" && label === "Price") return "input_audio";
  if (group === "Realtime audio duration" && label === "Price") {
    if (tasks.includes("transcription") || tasks.includes("translation")) return "input_audio";
    if (tasks.includes("speech_synthesis") || tasks.includes("speech_to_speech"))
      return "output_audio";
  }
}

function openAiCardTier(
  $: LoadedDocument,
  header: ReturnType<LoadedDocument>,
  group: string,
): "standard" | "batch" {
  const headers = header
    .parent()
    .children()
    .filter((_index, element) => normalizedText($(element).children().first().text()) === group);
  const toggleHeaders = headers.filter(
    (_index, element) => $(element).find('button[role="switch"]').length > 0,
  );
  if (toggleHeaders.length === 0) return "standard";
  if (toggleHeaders.length !== 1 || headers.length > 2)
    throw new Error(`Unsupported OpenAI ${group} price-tier selector`);
  const toggle = toggleHeaders.first().find('button[role="switch"]').attr("aria-checked");
  if (toggle !== "true" && toggle !== "false")
    throw new Error(`OpenAI ${group} price-tier selector omitted its state`);
  const primary = header.get(0) === toggleHeaders.get(0);
  return primary === (toggle === "true") ? "batch" : "standard";
}

function openAiPricing($: LoadedDocument, sourceId: string, tasks: ModelTask[]): SourcePriceFact[] {
  const content = sectionContent($, "Pricing");
  if (content.length === 0) return [];
  const rates: SourcePriceFact[] = [];
  const groups = new Set([
    "Text tokens",
    "Audio tokens",
    "Image tokens",
    "Embeddings",
    "Image generation",
    "Video generation",
    "Transcription audio duration",
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
      const serviceTier = openAiCardTier($, header, group);
      const unit: SourcePriceFact["unit"] =
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
        const meter = openAiMeter(group, label, tasks);
        if (meter === undefined)
          throw new Error(`Unsupported OpenAI pricing field: ${group}/${label}`);
        const conditions: SourcePriceFact["conditions"] = { service_tier: serviceTier };
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
      const meter: SourcePriceFact["meter"] | undefined =
        useCase === "Speech generation"
          ? "output_audio"
          : useCase === "Transcription"
            ? "input_audio"
            : undefined;
      const unit: SourcePriceFact["unit"] | undefined =
        rawUnit === "1M characters"
          ? "million_characters"
          : rawUnit === "minute"
            ? "minute"
            : undefined;
      if (meter === undefined || unit === undefined)
        throw new Error(`Unsupported OpenAI pricing use case: ${useCase}/${rawUnit}`);
      rates.push(
        publishedRate(meter, rawPrice, unit, sourceId, `per ${rawUnit}`, {
          service_tier: "standard",
        }),
      );
    });
  if (rates.length === 0) throw new Error("OpenAI Pricing section contained no rates");

  const pageText = normalizedText($("main").text());
  const longContext = pageText.match(
    /prompts with >([\d,]+)(K)? input tokens are priced at ([\d.]+)x input and ([\d.]+)x output/i,
  );
  if (
    longContext?.[1] !== undefined &&
    longContext[3] !== undefined &&
    longContext[4] !== undefined
  ) {
    const threshold =
      Number(longContext[1].replaceAll(",", "")) * (longContext[2] === "K" ? 1_000 : 1);
    const additions = rates.flatMap((rate): SourcePriceFact[] => {
      const multiplier =
        rate.meter === "input_text" || rate.meter === "cache_read_text"
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
      ...rates.flatMap((rate): SourcePriceFact[] =>
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

type OpenAiPricingTier = "standard" | "batch" | "flex" | "fast";

interface OpenAiPricingTable {
  section: string;
  tier?: OpenAiPricingTier;
  headers: string[];
  rows: string[][];
}

const openAiPricingSections = new Set([
  "Flagship models",
  "Realtime and audio generation models",
  "Image generation models",
  "Video generation models",
  "Transcription models",
  "Tools",
  "Specialized models",
  "Finetuning",
]);

const openAiPricingTiers = new Map<string, OpenAiPricingTier>([
  ["Standard", "standard"],
  ["Batch", "batch"],
  ["Flex", "flex"],
  ["Fast mode", "fast"],
]);

function markdownCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => normalizedText(cell));
}

function openAiPricingTables(body: string): OpenAiPricingTable[] {
  const lines = body.split(/\r?\n/);
  const tables: OpenAiPricingTable[] = [];
  let section: string | undefined;
  let tier: OpenAiPricingTier | undefined;
  for (let index = 0; index < lines.length - 1; index += 1) {
    const line = normalizedText(lines[index] ?? "");
    if (openAiPricingSections.has(line)) {
      section = line;
      tier = undefined;
      continue;
    }
    const observedTier = openAiPricingTiers.get(line);
    if (observedTier !== undefined) {
      tier = observedTier;
      continue;
    }
    if (!line.startsWith("|") || !normalizedText(lines[index + 1] ?? "").startsWith("|")) continue;
    const headers = markdownCells(line);
    const separators = markdownCells(lines[index + 1] ?? "");
    if (
      section === undefined ||
      headers.length !== separators.length ||
      !separators.every((cell) => /^:?-{3,}:?$/.test(cell))
    )
      continue;
    const rows: string[][] = [];
    index += 2;
    while (index < lines.length && normalizedText(lines[index] ?? "").startsWith("|")) {
      const row = markdownCells(lines[index] ?? "");
      if (row.length !== headers.length)
        throw new Error("OpenAI pricing table contained an irregular row");
      rows.push(row);
      index += 1;
    }
    index -= 1;
    tables.push({
      section,
      ...(tier === undefined ? {} : { tier }),
      headers,
      rows,
    });
  }
  return tables;
}

type OpenAiAmount =
  | {
      price: string;
      unit: SourcePriceFact["unit"];
      rawUnit: string;
    }
  | "free"
  | undefined;

function openAiAmount(value: string, defaultUnit: SourcePriceFact["unit"]): OpenAiAmount {
  if (value === "-") return undefined;
  if (value === "Free") return "free";
  const match = value.match(/^\$((?:0|[1-9]\d*)(?:\.\d+)?)(?: \/ (minute|1M characters))?$/);
  if (match?.[1] === undefined) throw new Error(`Unsupported OpenAI global price: ${value}`);
  const rawUnit = match[2] ?? (defaultUnit === "second" ? "second" : "1M tokens");
  return {
    price: match[1],
    unit:
      match[2] === "minute"
        ? "minute"
        : match[2] === "1M characters"
          ? "million_characters"
          : defaultUnit,
    rawUnit: `per ${rawUnit}`,
  };
}

function openAiTierConditions(tier: OpenAiPricingTier | undefined): SourcePriceFact["conditions"] {
  return { service_tier: tier ?? "standard" };
}

function openAiModalityMeter(
  modality: string,
  column: "input" | "cached" | "output",
): SourcePriceFact["meter"] | undefined {
  if (modality === "Text")
    return column === "input"
      ? "input_text"
      : column === "cached"
        ? "cache_read_text"
        : "output_text";
  if (modality === "Audio")
    return column === "input"
      ? "input_audio"
      : column === "cached"
        ? "cache_read_audio"
        : "output_audio";
  if (modality === "Image")
    return column === "input"
      ? "input_image"
      : column === "cached"
        ? "cache_read_image"
        : "output_image";
}

function openAiGlobalRate(
  meter: SourcePriceFact["meter"],
  amount: Exclude<OpenAiAmount, "free" | undefined>,
  sourceId: string,
  conditions: SourcePriceFact["conditions"],
): SourcePriceFact {
  return publishedRate(meter, amount.price, amount.unit, sourceId, amount.rawUnit, conditions);
}

function openAiTokenTableRates(
  table: OpenAiPricingTable,
  row: string[],
  sourceId: string,
): SourcePriceFact[] {
  const hasLongContext = table.headers.some(
    (header, index) => header.startsWith("Long context") && row[index] !== "-",
  );
  const explicitShortContext = (row[0] ?? "").includes("(<272K context length)");
  return table.headers.flatMap((header, index): SourcePriceFact[] => {
    if (index === 0) return [];
    const match = header.match(
      /^(?:(Short|Long) context )?(input|cached input|cache writes|output)$/,
    );
    if (match?.[2] === undefined) return [];
    const amount = openAiAmount(row[index] ?? "", "million_tokens");
    if (amount === undefined || amount === "free") return [];
    const meter: SourcePriceFact["meter"] =
      match[2] === "input"
        ? "input_text"
        : match[2] === "cached input"
          ? "cache_read_text"
          : match[2] === "cache writes"
            ? "cache_write_text"
            : "output_text";
    const context =
      match[1] === undefined || (!hasLongContext && !explicitShortContext)
        ? {}
        : match[1] === "Short"
          ? { context_max_tokens: 272_000 }
          : { context_min_tokens: 272_001 };
    return [
      openAiGlobalRate(meter, amount, sourceId, {
        ...openAiTierConditions(table.tier),
        ...context,
      }),
    ];
  });
}

function openAiModalityTableRates(
  table: OpenAiPricingTable,
  row: string[],
  tasks: ModelTask[],
  sourceId: string,
): SourcePriceFact[] {
  const modality = row[table.headers.indexOf("Modality")] ?? "";
  return table.headers.flatMap((header, index): SourcePriceFact[] => {
    const column =
      header === "Input"
        ? "input"
        : header === "Cached input"
          ? "cached"
          : header === "Output" || header === "Output / cost"
            ? "output"
            : undefined;
    if (column === undefined) return [];
    const amount = openAiAmount(row[index] ?? "", "million_tokens");
    if (amount === undefined || amount === "free") return [];
    const meter =
      amount.unit === "minute"
        ? tasks.includes("transcription") || tasks.includes("translation")
          ? "input_audio"
          : "output_audio"
        : amount.unit === "million_characters"
          ? "output_audio"
          : openAiModalityMeter(modality, column);
    if (meter === undefined)
      throw new Error(`Unsupported OpenAI pricing modality: ${modality}/${header}`);
    return [openAiGlobalRate(meter, amount, sourceId, openAiTierConditions(table.tier))];
  });
}

function openAiVideoTableRates(
  table: OpenAiPricingTable,
  row: string[],
  sourceId: string,
): SourcePriceFact[] {
  const amount = openAiAmount(row[table.headers.indexOf("Price per second")] ?? "", "second");
  if (amount === undefined || amount === "free") return [];
  const resolution = row[table.headers.indexOf("Size")];
  if (resolution === undefined) throw new Error("OpenAI video pricing omitted resolution");
  return [
    openAiGlobalRate("video_generation", amount, sourceId, {
      ...openAiTierConditions(table.tier),
      resolution,
    }),
  ];
}

function openAiTranscriptionTableRates(
  table: OpenAiPricingTable,
  row: string[],
  sourceId: string,
): SourcePriceFact[] {
  const columns: Array<{ header: string; meter: SourcePriceFact["meter"] }> = [
    { header: "Input", meter: "input_audio" },
    { header: "Output", meter: "output_audio" },
  ];
  const tokenRates = columns.flatMap(({ header, meter }): SourcePriceFact[] => {
    const amount = openAiAmount(row[table.headers.indexOf(header)] ?? "", "million_tokens");
    return amount === undefined || amount === "free"
      ? []
      : [openAiGlobalRate(meter, amount, sourceId, openAiTierConditions(table.tier))];
  });
  if (tokenRates.length > 0) return tokenRates;
  const amount = openAiAmount(row[table.headers.indexOf("Estimated cost")] ?? "", "minute");
  return amount === undefined || amount === "free"
    ? []
    : [openAiGlobalRate("input_audio", amount, sourceId, openAiTierConditions(table.tier))];
}

function openAiSpecializedTableRates(
  table: OpenAiPricingTable,
  row: string[],
  sourceId: string,
): SourcePriceFact[] {
  const category = row[table.headers.indexOf("Category")];
  return table.headers.flatMap((header, index): SourcePriceFact[] => {
    const meter: SourcePriceFact["meter"] | undefined =
      category === "Embedding" && header === "Input"
        ? "embedding"
        : header === "Input"
          ? "input_text"
          : header === "Cached input"
            ? "cache_read_text"
            : header === "Output"
              ? "output_text"
              : undefined;
    if (meter === undefined) return [];
    const amount = openAiAmount(row[index] ?? "", "million_tokens");
    return amount === undefined || amount === "free"
      ? []
      : [openAiGlobalRate(meter, amount, sourceId, openAiTierConditions(table.tier))];
  });
}

function openAiGlobalRates(
  table: OpenAiPricingTable,
  row: string[],
  tasks: ModelTask[],
  sourceId: string,
): SourcePriceFact[] | undefined {
  const headers = table.headers.join("|");
  if (headers.startsWith("Model|Short context input|"))
    return openAiTokenTableRates(table, row, sourceId);
  if (
    headers === "Model|Modality|Input|Cached input|Output / cost" ||
    headers === "Model|Modality|Input|Cached input|Output"
  )
    return openAiModalityTableRates(table, row, tasks, sourceId);
  if (headers === "Model|Size|Portrait|Landscape|Price per second")
    return openAiVideoTableRates(table, row, sourceId);
  if (headers === "Model|Use case|Input|Output|Estimated cost")
    return openAiTranscriptionTableRates(table, row, sourceId);
  if (headers === "Category|Model|Input|Cached input|Output")
    return openAiSpecializedTableRates(table, row, sourceId);
}

function parseOpenAiPricing(input: ParseInput): ProviderModel[] {
  if (input.catalogModels === undefined)
    throw new Error("OpenAI pricing requires the collected catalog");
  const exact = new Map(input.catalogModels.map((model) => [model.model_id, model]));
  const aliases = new Map<string, (typeof input.catalogModels)[number] | null>();
  for (const model of input.catalogModels)
    for (const alias of model.aliases) {
      const current = aliases.get(alias);
      aliases.set(
        alias,
        current === undefined
          ? model
          : current === null || current.model_id !== model.model_id
            ? null
            : current,
      );
    }
  const rates = new Map<string, Map<string, SourcePriceFact>>();
  for (const table of openAiPricingTables(input.body)) {
    const modelIndex = table.headers.indexOf("Model");
    if (modelIndex < 0 || table.section === "Finetuning" || table.section === "Tools") continue;
    for (const row of table.rows) {
      const rawId = (row[modelIndex] ?? "").replace(
        / \((?:<272K context length|legacy|data sharing)\)$/,
        "",
      );
      if (!modelIdSchema.safeParse(rawId).success) continue;
      const target = exact.get(rawId) ?? aliases.get(rawId);
      if (target === undefined || target === null) continue;
      const candidates = openAiGlobalRates(table, row, target.tasks, input.source.id);
      if (candidates === undefined)
        throw new Error(`Unsupported OpenAI pricing table: ${table.headers.join("|")}`);
      if (candidates.length === 0) continue;
      const existing = new Map(target.price_facts.map((fact) => [sourcePriceFactKey(fact), fact]));
      const supplemental = candidates.filter((fact) => {
        const current = existing.get(sourcePriceFactKey(fact));
        if (current !== undefined && !decimalsEqual(current.price, fact.price))
          throw new Error(`OpenAI pricing sources disagree for ${target.model_id}`);
        if (
          target.price_facts.length > 0 &&
          (table.tier === undefined || table.tier === "standard")
        )
          return false;
        return current === undefined;
      });
      if (supplemental.length === 0) continue;
      const modelRates = rates.get(target.model_id) ?? new Map<string, SourcePriceFact>();
      for (const fact of supplemental) {
        const key = sourcePriceFactKey(fact);
        const current = modelRates.get(key);
        if (current !== undefined && !decimalsEqual(current.price, fact.price))
          throw new Error(`OpenAI pricing table conflicts for ${target.model_id}`);
        modelRates.set(key, fact);
      }
      rates.set(target.model_id, modelRates);
    }
  }
  const extractor = input.source.extractor;
  if (extractor.kind !== "openai-pricing") throw new Error("Invalid OpenAI pricing extractor");
  const { minModels, maxModels } = extractor;
  assertItemCount("OpenAI pricing models", rates.size, minModels, maxModels);
  return [...rates]
    .map(([modelId, modelRates]): ProviderModel => {
      const target = exact.get(modelId);
      if (target === undefined) throw new Error("OpenAI pricing lost its catalog binding");
      return {
        ...baseModel({
          providerId: input.provider.id,
          id: modelId,
          ...(target.version === undefined ? {} : { version: target.version }),
          name: modelId,
          sourceId: input.source.id,
          observedAt: input.observedAt,
        }),
        pricing_state: "numeric",
        price_facts: [...modelRates.values()],
      };
    })
    .sort((left, right) => left.uid.localeCompare(right.uid));
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
      const classifiedOperations = classifyModelTasks({
        modelId: id,
        name,
        rawType: undefined,
        modalities: observedModalities,
        fallback: "text_generation",
      });
      const endpointEvidence = openAiEndpointEvidence($, classifiedOperations);
      const tasks = endpointEvidence.tasks;
      const embeddingOutput: Modality[] = ["embedding"];
      const modelModalities: ProviderModel["modalities"] = tasks.includes("embeddings")
        ? { input: observedModalities.input, output: embeddingOutput }
        : observedModalities;
      const pricing = openAiPricing($, input.source.id, tasks);
      const features = openAiFeatures($);
      const tools = openAiSupport($, "Tools");
      const pageText = normalizedText($("main").text());
      const aliases = openAiAliases($, id);
      const computerUse = openAiSupportValue(tools, ["Computer use"]);
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
        tasks,
        api_endpoints: endpointEvidence.endpoints,
        modalities: modelModalities,
        capabilities: {
          ...features,
          reasoning: pageText.includes("Reasoning token support") ? true : features.reasoning,
          prompt_cache: pricing.some((rate) => rate.meter.startsWith("cache_"))
            ? true
            : features.prompt_cache,
          batch: endpointEvidence.endpoints.some(({ path }) => path === "v1/batch")
            ? true
            : features.batch,
          fine_tuning: endpointEvidence.endpoints.some(({ path }) => path === "v1/fine-tuning")
            ? true
            : features.fine_tuning,
          code_execution: openAiSupportValue(tools, ["Code interpreter", "Hosted shell"]),
          effort_control: /reasoning[._]effort supports:/i.test(pageText)
            ? true
            : features.effort_control,
          computer_use:
            computerUse !== "unknown"
              ? computerUse
              : /specialized model for the computer use tool|trained to understand and execute computer tasks/i.test(
                    pageText,
                  )
                ? true
                : features.computer_use,
        },
        limits: {
          context_tokens: openAiTokenLimit($, "context window"),
          max_output_tokens: openAiTokenLimit($, "max output tokens"),
        },
        ...lifecycle,
        pricing_state:
          pricing.length > 0
            ? "numeric"
            : pageText.includes("free models designed to detect harmful content") ||
                pageText.includes("open-weight model")
              ? "not_applicable"
              : "unknown",
        price_facts: pricing,
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
  assertItemCount("OpenAI model API", list.data.length, 1, undefined, ["data"]);
  return recognizeItems({
    label: "OpenAI model",
    items: list.data,
    schema: openAiItemSchema,
    modelId: "id",
  }).map((item) =>
    baseModel({
      providerId: input.provider.id,
      id: item.id,
      name: item.id,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    }),
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
            tasks: classifyModelTasks({
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

function parseSourceBody(input: ParseInput): ProviderModel[] {
  switch (input.source.extractor.kind) {
    case "openai-catalog":
      return parseOpenAiCatalog(input);
    case "openai-overview":
      return parseOpenAiOverview(input);
    case "openai-api":
      return parseOpenAiApi(input);
    case "openai-deprecations":
      return parseOpenAiDeprecations(input);
    case "openai-pricing":
      return parseOpenAiPricing(input);
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
    case "huggingface-hub":
      return parseHuggingFaceHub(input);
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
    case "azure-retail-prices":
      return parseAzureRetailPrices(input);
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
    case "dashscope-releases":
      return parseDashscopeReleases(input);
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

export function parseSource(input: ParseInput): ProviderModel[] {
  try {
    return parseSourceBody(input);
  } catch (error) {
    if (error instanceof SourceContractError) throw error;
    let value: unknown;
    if (input.source.format === "json") {
      try {
        value = parseJson(input.body);
      } catch {
        throw new SourceContractError("Source response", invalidJsonContractEvidence());
      }
    }
    if (error instanceof z.ZodError) {
      throw new SourceContractError(
        "Source response",
        zodContractEvidence([{ error, input: value, itemIndex: 0 }], 1),
      );
    }
    throw error;
  }
}
