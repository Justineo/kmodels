import { load } from "cheerio";
import { z } from "zod";
import { parseAnthropicApi, parseAnthropicCatalog } from "./anthropic.ts";
import {
  parseAzureApi,
  parseAzureCatalog,
  parseAzureClaudePricing,
  parseAzurePortalCatalog,
  parseAzurePublicPricing,
  parseAzureRetailPrices,
} from "./azure.ts";
import { parseAzureAccounting } from "./azure-accounting.ts";
import { parseBedrockApi, parseBedrockCatalog } from "./bedrock.ts";
import {
  parseCerebrasApi,
  parseCerebrasCatalog,
  parseCerebrasLifecycle,
  parseCerebrasPublic,
  parseCerebrasReleases,
} from "./cerebras.ts";
import { parseCohereApi, parseCohereCatalog, parseCoherePricing } from "./cohere.ts";
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
import { parseGeminiApi, parseGeminiCatalog, parseGeminiPricing } from "./gemini.ts";
import {
  parseHuggingFaceFeatherless,
  parseHuggingFaceHub,
  parseHuggingFaceMapping,
  parseHuggingFaceNativePricing,
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
import { parseMistralApi, parseMistralCatalog, parseMistralPricing } from "./mistral.ts";
import { parseOllamaCloud, parseOllamaLibrary } from "./ollama.ts";
import { linkedBundleSchema } from "./bundle.ts";
import { modelIdSchema } from "./identity.ts";
import { baseModel } from "./model.ts";
import type { SourceManifest } from "./manifests.ts";
import { openApiYamlHasPropertyPath } from "./openapi-yaml.ts";
import { decimalsEqual, multiplyDecimal, publishedRate } from "./pricing.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import {
  sourcePriceFactKey,
  type ParsedProviderModel as ProviderModel,
  type SourceCommercialPricingFact,
  type SourcePricingInputFact,
  type SourcePriceFact,
  type SourceRawPricingFact,
} from "./pricing-source.ts";
import {
  assertItemCount,
  contractExtensionEvidence,
  invalidJsonContractEvidence,
  recognizeItems,
  SourceContractError,
  zodContractEvidence,
  type SourceContractEvidence,
} from "./source-contract.ts";
import { classifyModelTasks } from "./task.ts";
import { parseVercelCatalog } from "./vercel.ts";
import { parseVertexApi, parseVertexCatalog, parseVertexPricing } from "./vertex.ts";
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
    | "aliases"
    | "api_endpoints"
    | "availability"
    | "capabilities"
    | "model_id"
    | "name"
    | "price_facts"
    | "pricing_state"
    | "routes"
    | "service_families"
    | "status"
    | "tasks"
    | "uid"
    | "version"
  >[];
  onContractFinding?: (evidence: SourceContractEvidence) => void;
  onPricingReconciliation?: (item: PricingReconciliationItem) => void;
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
  support: ReadonlyMap<string, boolean>;
}

function markdownSection(body: string, heading: string): string | undefined {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `## ${heading}`);
  if (start < 0) return undefined;
  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  return lines
    .slice(start + 1, end < 0 ? undefined : end)
    .join("\n")
    .trim();
}

function openAiEndpointEvidence(
  body: string,
  fallback: ModelTask[],
  onFinding: ParseInput["onContractFinding"],
): OpenAiEndpointEvidence {
  const content = markdownSection(body, "Endpoints");
  if (content === undefined) {
    onFinding?.(contractExtensionEvidence(["/models/endpoints/table"]));
    return { endpoints: [], tasks: fallback, support: new Map() };
  }
  const lines = content.split(/\r?\n/);
  const headerIndex = lines.findIndex(
    (line) => markdownCells(line).join("\0") === ["Endpoint", "Route", "Support"].join("\0"),
  );
  if (headerIndex < 0 || lines[headerIndex + 1] === undefined) {
    onFinding?.(contractExtensionEvidence(["/models/endpoints/header"]));
    return { endpoints: [], tasks: fallback, support: new Map() };
  }
  const separators = markdownCells(lines[headerIndex + 1] ?? "");
  if (separators.length !== 3 || !separators.every((cell) => /^:?-{3,}:?$/.test(cell))) {
    onFinding?.(contractExtensionEvidence(["/models/endpoints/separator"]));
    return { endpoints: [], tasks: fallback, support: new Map() };
  }
  const endpoints: NonNullable<ProviderModel["api_endpoints"]> = [];
  const tasks: ModelTask[] = [];
  const observedPaths = new Set<string>();
  const supportByPath = new Map<string, boolean>();
  const findings: string[] = [];
  for (let index = headerIndex + 2; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!line.trim().startsWith("|")) break;
    const cells = markdownCells(line);
    if (cells.length !== 3) {
      findings.push(`/models/endpoints/row-${index - headerIndex - 1}`);
      continue;
    }
    const name = cells[0] ?? "";
    const path = (cells[1] ?? "").replace(/^`|`$/g, "");
    const support = cells[2];
    const definition = openAiEndpointDefinitions.get(path);
    if (definition === undefined || definition.name !== name) {
      findings.push(`/models/endpoints/${path || "unknown"}`);
      continue;
    }
    if (observedPaths.has(path)) {
      findings.push(`/models/endpoints/${path}/duplicate`);
      continue;
    }
    if (support !== "Supported" && support !== "Not supported") {
      findings.push(`/models/endpoints/${path}/support`);
      continue;
    }
    observedPaths.add(path);
    const supported = support === "Supported";
    supportByPath.set(path, supported);
    if (!supported) continue;
    endpoints.push({ name, path });
    tasks.push(...definition.tasks);
  }
  for (const path of openAiEndpointDefinitions.keys())
    if (!observedPaths.has(path)) findings.push(`/models/endpoints/${path}/missing`);
  if (findings.length > 0) onFinding?.(contractExtensionEvidence(findings));
  return {
    endpoints,
    tasks: tasks.length > 0 ? unique(tasks) : fallback,
    support: supportByPath,
  };
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
  "Cyber models",
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
    .replaceAll("\\|", "\u0000")
    .split("|")
    .map((cell) => normalizedText(cell.replaceAll("\u0000", "|")));
}

function markdownCodeValues(value: string): string[] {
  return [...value.matchAll(/`([^`]+)`/g)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

const openAiRegionalProcessingRegions = [
  "United States",
  "Europe (EEA + Switzerland)",
  "United Arab Emirates",
] as const;
const openAiRegionalProcessingRegionSet = new Set<string>(openAiRegionalProcessingRegions);

function parseOpenAiDataResidency(input: ParseInput): ProviderModel[] {
  const requiredHeaders = [
    "Endpoint or feature",
    "Service",
    "Storage regions",
    "Processing regions",
    "Supported models and snapshots",
    "Regional processing snapshot exceptions",
    "Notes",
  ];
  const lines = input.body.split(/\r?\n/);
  const models = new Map<string, ProviderModel>();
  let found = false;
  for (let index = 0; index < lines.length - 1; index += 1) {
    const headers = markdownCells(lines[index] ?? "");
    if (!requiredHeaders.every((header) => headers.includes(header))) continue;
    const separators = markdownCells(lines[index + 1] ?? "");
    if (
      separators.length !== headers.length ||
      !separators.every((cell) => /^:?-{3,}:?$/.test(cell))
    ) {
      input.onContractFinding?.(contractExtensionEvidence(["/data-residency/table/separators"]));
      continue;
    }
    if (found)
      input.onContractFinding?.(contractExtensionEvidence(["/data-residency/table/duplicate"]));
    if (headers.length !== requiredHeaders.length)
      input.onContractFinding?.(contractExtensionEvidence(["/data-residency/table/columns"]));
    found = true;
    const cell = (row: string[], header: string): string => row[headers.indexOf(header)] ?? "";
    index += 2;
    while (index < lines.length && normalizedText(lines[index] ?? "").startsWith("|")) {
      const row = markdownCells(lines[index] ?? "");
      if (row.length !== headers.length) {
        input.onContractFinding?.(
          contractExtensionEvidence([`/data-residency/table/row-${index}`]),
        );
        index += 1;
        continue;
      }
      const endpointCell = cell(row, "Endpoint or feature");
      const endpointPaths = markdownCodeValues(endpointCell).flatMap((value) =>
        value.startsWith("/v1/") ? value.split(/,\s*/).map((path) => path.slice(1)) : [],
      );
      if (endpointPaths.length === 0) {
        index += 1;
        continue;
      }
      const modelIds = markdownCodeValues(cell(row, "Supported models and snapshots")).filter(
        (id) => modelIdSchema.safeParse(id).success,
      );
      if (modelIds.length === 0) {
        index += 1;
        continue;
      }
      const endpointDefinitions = endpointPaths.flatMap((path) => {
        if (path === "v1/batches" || path === "v1/fine_tuning/jobs") return [];
        const definition = openAiEndpointDefinitions.get(path);
        if (definition === undefined) {
          input.onContractFinding?.(
            contractExtensionEvidence([`/data-residency/endpoints/${path}`]),
          );
          return [];
        }
        return [{ path, ...definition }];
      });
      const processingCell = cell(row, "Processing regions");
      let processingRegions =
        processingCell === "None" ? [] : processingCell.split(", ").map(normalizedText);
      const unknownRegions = processingRegions.filter(
        (region) => !openAiRegionalProcessingRegionSet.has(region),
      );
      if (unknownRegions.length > 0)
        input.onContractFinding?.(
          contractExtensionEvidence(
            unknownRegions.map((region) => `/data-residency/regions/${region}`),
          ),
        );
      processingRegions = processingRegions.filter((region) =>
        openAiRegionalProcessingRegionSet.has(region),
      );
      const exceptionCell = cell(row, "Regional processing snapshot exceptions");
      let exceptionIds = markdownCodeValues(exceptionCell).filter((id) => modelIds.includes(id));
      const validException =
        exceptionCell === "None" || exceptionCell.startsWith("United Arab Emirates:");
      if (!validException) {
        input.onContractFinding?.(
          contractExtensionEvidence(["/data-residency/regional-processing-exception"]),
        );
        processingRegions = processingRegions.filter((region) => region !== "United Arab Emirates");
        exceptionIds = [];
      } else if (markdownCodeValues(exceptionCell).length !== exceptionIds.length)
        input.onContractFinding?.(
          contractExtensionEvidence(["/data-residency/regional-processing-exception/models"]),
        );
      for (const modelId of modelIds) {
        const classifiedTasks = classifyModelTasks({
          modelId,
          name: modelId,
          rawType: undefined,
          modalities: { input: [], output: [] },
          fallback: "text_generation",
        });
        const combinedAudio = endpointPaths.length > 1;
        const rowTasks = combinedAudio
          ? classifiedTasks
          : unique(endpointDefinitions.flatMap(({ tasks }) => tasks));
        const endpoints = endpointDefinitions.flatMap(({ name, path, tasks }) =>
          combinedAudio && !tasks.some((task) => rowTasks.includes(task)) ? [] : [{ name, path }],
        );
        const availability: NonNullable<ProviderModel["availability"]> = processingRegions.flatMap(
          (region) =>
            region === "United Arab Emirates" &&
            exceptionIds.length > 0 &&
            !exceptionIds.includes(modelId)
              ? []
              : [{ region, deployment_type: "regional_processing" }],
        );
        const current =
          models.get(modelId) ??
          ({
            ...baseModel({
              providerId: input.provider.id,
              id: modelId,
              name: modelId,
              sourceId: input.source.id,
              observedAt: input.observedAt,
            }),
            status: "active",
          } satisfies ProviderModel);
        const apiEndpoints = [
          ...new Map(
            [...(current.api_endpoints ?? []), ...endpoints].map((endpoint) => [
              `${endpoint.path}\0${endpoint.name}`,
              endpoint,
            ]),
          ).values(),
        ];
        const regionalAvailability = [
          ...new Map(
            [...(current.availability ?? []), ...availability].map((item) => [
              `${item.region}\0${item.deployment_type}`,
              item,
            ]),
          ).values(),
        ].sort((left, right) =>
          `${left.region}\0${left.deployment_type}`.localeCompare(
            `${right.region}\0${right.deployment_type}`,
          ),
        );
        models.set(modelId, {
          ...current,
          tasks: unique([...current.tasks, ...rowTasks]),
          ...(apiEndpoints.length === 0 ? {} : { api_endpoints: apiEndpoints }),
          ...(regionalAvailability.length === 0 ? {} : { availability: regionalAvailability }),
        });
      }
      index += 1;
    }
    index -= 1;
  }
  if (!found) throw new Error("OpenAI data-residency model table was not found");
  if (input.source.extractor.kind !== "openai-data-residency")
    throw new Error("Invalid OpenAI data-residency extractor");
  if (models.size === 0) throw new Error("OpenAI data-residency table contained no model facts");
  return [...models.values()].sort((left, right) => left.uid.localeCompare(right.uid));
}

function openAiPricingTables(
  body: string,
  onReconciliation: ParseInput["onPricingReconciliation"],
): OpenAiPricingTable[] {
  const lines = body.split(/\r?\n/);
  const tables: OpenAiPricingTable[] = [];
  let section: string | undefined;
  let tier: OpenAiPricingTier | undefined;
  let reviewedTier = true;
  for (let index = 0; index < lines.length - 1; index += 1) {
    const line = normalizedText(lines[index] ?? "");
    if (openAiPricingSections.has(line)) {
      section = line;
      tier = undefined;
      reviewedTier = true;
      continue;
    }
    const observedTier = openAiPricingTiers.get(line);
    if (observedTier !== undefined) {
      tier = observedTier;
      reviewedTier = true;
      continue;
    }
    if (line === "Our latest models" || line === "Multimodal models") continue;
    if (/^(?:Standard|Batch|Flex|Fast|Priority)\b/.test(line)) {
      reviewedTier = false;
      onReconciliation?.({
        disposition: "unsupported",
        reason_code: "unreviewed_pricing_tier",
        sample: line.slice(0, 256),
      });
      continue;
    }
    if (/^[A-Z][A-Za-z ]+ models$/.test(line)) {
      section = undefined;
      tier = undefined;
      reviewedTier = true;
      continue;
    }
    if (!line.startsWith("|") || !normalizedText(lines[index + 1] ?? "").startsWith("|")) continue;
    const headers = markdownCells(line);
    const separators = markdownCells(lines[index + 1] ?? "");
    if (
      headers.length !== separators.length ||
      !separators.every((cell) => /^:?-{3,}:?$/.test(cell))
    )
      continue;
    if (section === undefined || !reviewedTier) {
      onReconciliation?.({
        disposition: "unsupported",
        reason_code: "unreviewed_pricing_table",
        sample: headers.join(" | ").slice(0, 256),
      });
      continue;
    }
    const rows: string[][] = [];
    index += 2;
    while (index < lines.length && normalizedText(lines[index] ?? "").startsWith("|")) {
      const row = markdownCells(lines[index] ?? "");
      if (row.length === headers.length) rows.push(row);
      else
        onReconciliation?.({
          disposition: "unsupported",
          reason_code: "irregular_pricing_row",
          sample: normalizedText(lines[index] ?? "").slice(0, 256),
        });
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

function openAiAmount(
  value: string,
  defaultUnit: SourcePriceFact["unit"],
  onUnsupported?: (sample: string) => void,
): OpenAiAmount {
  if (value === "-") return undefined;
  if (value === "Free") return "free";
  const match = value.match(/^\$((?:0|[1-9]\d*)(?:\.\d+)?)(?: \/ (minute|1M characters))?$/);
  if (match?.[1] === undefined) {
    onUnsupported?.(value);
    return;
  }
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
  onUnsupported: (sample: string) => void,
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
    const amount = openAiAmount(row[index] ?? "", "million_tokens", onUnsupported);
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
  onUnsupported: (sample: string) => void,
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
    const amount = openAiAmount(row[index] ?? "", "million_tokens", onUnsupported);
    if (amount === undefined || amount === "free") return [];
    const meter =
      amount.unit === "minute"
        ? tasks.includes("transcription") || tasks.includes("translation")
          ? "input_audio"
          : "output_audio"
        : amount.unit === "million_characters"
          ? "output_audio"
          : openAiModalityMeter(modality, column);
    if (meter === undefined) {
      onUnsupported(`${modality}/${header}`);
      return [];
    }
    return [openAiGlobalRate(meter, amount, sourceId, openAiTierConditions(table.tier))];
  });
}

function openAiVideoTableRates(
  table: OpenAiPricingTable,
  row: string[],
  sourceId: string,
  onUnsupported: (sample: string) => void,
): SourcePriceFact[] {
  const amount = openAiAmount(
    row[table.headers.indexOf("Price per second")] ?? "",
    "second",
    onUnsupported,
  );
  if (amount === undefined || amount === "free") return [];
  const resolution = row[table.headers.indexOf("Size")];
  if (resolution === undefined) {
    onUnsupported("video resolution");
    return [];
  }
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
  onUnsupported: (sample: string) => void,
): SourcePriceFact[] {
  const columns: Array<{ header: string; meter: SourcePriceFact["meter"] }> = [
    { header: "Input", meter: "input_audio" },
    { header: "Output", meter: "output_audio" },
  ];
  const tokenRates = columns.flatMap(({ header, meter }): SourcePriceFact[] => {
    const amount = openAiAmount(
      row[table.headers.indexOf(header)] ?? "",
      "million_tokens",
      onUnsupported,
    );
    return amount === undefined || amount === "free"
      ? []
      : [openAiGlobalRate(meter, amount, sourceId, openAiTierConditions(table.tier))];
  });
  if (tokenRates.length > 0) return tokenRates;
  const amount = openAiAmount(
    row[table.headers.indexOf("Estimated cost")] ?? "",
    "minute",
    onUnsupported,
  );
  return amount === undefined || amount === "free"
    ? []
    : [openAiGlobalRate("input_audio", amount, sourceId, openAiTierConditions(table.tier))];
}

function openAiSpecializedTableRates(
  table: OpenAiPricingTable,
  row: string[],
  sourceId: string,
  onUnsupported: (sample: string) => void,
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
    const amount = openAiAmount(row[index] ?? "", "million_tokens", onUnsupported);
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
  onUnsupported: (sample: string) => void,
): SourcePriceFact[] | undefined {
  const headers = table.headers.join("|");
  if (headers.startsWith("Model|Short context input|"))
    return openAiTokenTableRates(table, row, sourceId, onUnsupported);
  if (
    headers === "Model|Modality|Input|Cached input|Output / cost" ||
    headers === "Model|Modality|Input|Cached input|Output"
  )
    return openAiModalityTableRates(table, row, tasks, sourceId, onUnsupported);
  if (headers === "Model|Size|Portrait|Landscape|Price per second")
    return openAiVideoTableRates(table, row, sourceId, onUnsupported);
  if (headers === "Model|Use case|Input|Output|Estimated cost")
    return openAiTranscriptionTableRates(table, row, sourceId, onUnsupported);
  if (headers === "Category|Model|Input|Cached input|Output")
    return openAiSpecializedTableRates(table, row, sourceId, onUnsupported);
}

function addUniqueModelIndex<T extends { model_id: string }>(
  index: Map<string, T | null>,
  key: string,
  model: T,
): void {
  const current = index.get(key);
  index.set(
    key,
    current === undefined
      ? model
      : current === null || current.model_id !== model.model_id
        ? null
        : current,
  );
}

type OpenAiCommercialModel = Pick<
  ProviderModel,
  "api_endpoints" | "capabilities" | "pricing_state" | "uid"
>;

function openAiToolCommercialFacts(
  table: OpenAiPricingTable,
  row: string[],
  sourceId: string,
  models: readonly OpenAiCommercialModel[],
  containerBilling: string | undefined,
): SourceCommercialPricingFact[] {
  const tool = row[table.headers.indexOf("Tool")] ?? row[0] ?? "";
  const details = row[table.headers.indexOf("Details")] ?? "";
  const published = row[table.headers.indexOf("Pricing")] ?? row.at(-1) ?? "";
  const responseModels = models.filter(
    ({ api_endpoints, pricing_state }) =>
      pricing_state !== "not_applicable" &&
      api_endpoints?.some(({ path }) => path === "v1/responses"),
  );
  const responseRefs = responseModels.map(({ uid }) => uid);
  const codeExecutionRefs = responseModels
    .filter(({ capabilities }) => capabilities.code_execution === true)
    .map(({ uid }) => uid);
  const fact = (
    key: string,
    name: string,
    offerKey: string,
    offerName: string,
    modelRefs: string[],
    priceFacts: SourcePriceFact[],
    rawPriceFacts: SourceCommercialPricingFact["raw_price_facts"] = [],
  ): SourceCommercialPricingFact => ({
    source_ref: sourceId,
    book_key: `service:${key}`,
    book_name: name,
    resource_kind: "service",
    resource_key: key,
    model_refs: modelRefs,
    offer_key: offerKey,
    offer_name: offerName,
    billing_mode: "usage",
    pricing_state: "numeric",
    price_facts: priceFacts,
    raw_price_facts: rawPriceFacts,
  });
  const callAmount = published.match(/^\$((?:0|[1-9]\d*)(?:\.\d+)?) \/ 1k calls(?: \+ .*)?$/i)?.[1];
  if (tool === "Web search" && callAmount !== undefined) {
    const preview = details.startsWith("Web search preview");
    const operation = preview
      ? details.includes("non-reasoning")
        ? "preview_non_reasoning"
        : "preview_reasoning"
      : details.startsWith("Image Web search")
        ? "image"
        : "search";
    const modelRefs = preview
      ? responseModels
          .filter(({ capabilities }) =>
            operation === "preview_non_reasoning"
              ? capabilities.reasoning === false
              : capabilities.reasoning === true,
          )
          .map(({ uid }) => uid)
      : responseRefs;
    return [
      fact(
        "web-search",
        "Web Search",
        preview ? "preview" : "current",
        preview ? "Web Search Preview" : "Web Search",
        modelRefs,
        [
          publishedRate("web_search", callAmount, "thousand_events", sourceId, "per 1k calls", {
            operation,
          }),
        ],
      ),
    ];
  }
  if (tool === "File search" && details === "Tool call" && callAmount !== undefined)
    return [
      fact("file-search", "File Search", "usage", "File Search usage", responseRefs, [
        publishedRate("file_search", callAmount, "thousand_events", sourceId, "per 1k calls"),
      ]),
    ];

  if (tool === "Containers" && details === "Hosted Shell and Code Interpreter") {
    const prices = [...published.matchAll(/(\d+) GB \$((?:0|[1-9]\d*)(?:\.\d+)?)/g)].flatMap(
      (match) => {
        const memory = match[1];
        const amount = match[2];
        return memory === undefined || amount === undefined
          ? []
          : [
              publishedRate(
                "container_runtime",
                amount,
                "container_session",
                sourceId,
                "per 20-minute container session",
                { capacity: `${memory} GiB` },
              ),
            ];
      },
    );
    return prices.length === 0
      ? []
      : [
          fact(
            "containers",
            "Code execution containers",
            "runtime",
            "Code execution runtime",
            codeExecutionRefs,
            prices,
            containerBilling === undefined
              ? []
              : [commercialRaw("billing-minimum", "base_price", containerBilling, sourceId)],
          ),
        ];
  }
  return [];
}

function commercialRaw(
  termKey: string,
  impact: SourceCommercialPricingFact["raw_price_facts"][number]["impact"],
  fragment: string,
  sourceId: string,
): SourceCommercialPricingFact["raw_price_facts"][number] {
  return {
    term_key: termKey,
    impact,
    reason: "unsupported_structure",
    conditions: {},
    source_ref: sourceId,
    raw: { fragment },
  };
}

function openAiFineTunedInferenceFacts(
  table: OpenAiPricingTable,
  row: string[],
  sourceId: string,
  target: Pick<ProviderModel, "model_id" | "uid"> | undefined,
  onUnsupported: (sample: string) => void,
): SourceCommercialPricingFact[] {
  const rawModelId = row[table.headers.indexOf("Model")] ?? "";
  const dataSharing = rawModelId.endsWith(" (data sharing)");
  const modelId = rawModelId.replace(/ \(data sharing\)$/, "");
  const modelRefs = target === undefined ? [] : [target.uid];
  const conditions: SourcePriceFact["conditions"] = {
    ...openAiTierConditions(table.tier),
    account_eligibility: dataSharing ? "data_sharing" : "default",
  };
  const amount = (header: string): Exclude<OpenAiAmount, "free" | undefined> | undefined => {
    const value = openAiAmount(
      row[table.headers.indexOf(header)] ?? "",
      "million_tokens",
      onUnsupported,
    );
    return value === undefined || value === "free" ? undefined : value;
  };
  const rate = (
    meter: SourcePriceFact["meter"],
    value: Exclude<OpenAiAmount, "free" | undefined>,
  ) => openAiGlobalRate(meter, value, sourceId, conditions);
  const inference = [
    ["Input", "input_text"],
    ["Cached input", "cache_read_text"],
    ["Output", "output_text"],
  ].flatMap(([header, meter]): SourcePriceFact[] => {
    const value = amount(header ?? "");
    return value === undefined ? [] : [rate(meter as SourcePriceFact["meter"], value)];
  });
  return inference.length === 0
    ? []
    : [
        {
          source_ref: sourceId,
          book_key: `service:fine-tuned-inference:${modelId}`,
          book_name: `Fine-tuned ${modelId} inference`,
          resource_kind: "service",
          resource_key: `fine-tuned-inference:${modelId}`,
          model_refs: modelRefs,
          offer_key: "inference",
          offer_name: "Fine-tuned model inference",
          billing_mode: "usage",
          pricing_state: "numeric",
          price_facts: inference,
          raw_price_facts: [],
        },
      ];
}

function openAiPricingAliases(body: string): Map<string, string> {
  const aliases = new Map<string, string>();
  const match = body.match(
    /`([^`]+)`\s+and\s+`([^`]+)`\s+are\s+aliases that currently point to\s+`([^`]+)`\s+and\s+`([^`]+)`, respectively\./,
  );
  if (match === null) return aliases;
  const pairs = [
    [match[1], match[3]],
    [match[2], match[4]],
  ] as const;
  for (const [alias, target] of pairs)
    if (
      alias !== undefined &&
      target !== undefined &&
      modelIdSchema.safeParse(alias).success &&
      modelIdSchema.safeParse(target).success
    )
      aliases.set(alias, target);
  return aliases;
}

function openAiPriceConflict(
  left: SourcePriceFact,
  right: SourcePriceFact,
  sourceId: string,
): SourceRawPricingFact {
  return {
    term_key: `pricing-conflict:${left.meter}`,
    impact: "base_price",
    reason: "conflicting_values",
    conditions: left.conditions,
    source_ref: sourceId,
    raw: {
      label: "Conflicting values on the OpenAI pricing page",
      amount: `${left.price} / ${right.price}`,
      denomination: left.currency,
      unit: left.raw_unit ?? left.unit,
    },
  };
}

function openAiRegionalUpliftEligible(
  model: Pick<ProviderModel, "availability" | "release_date">,
): boolean {
  return (
    model.release_date !== undefined &&
    model.release_date >= "2026-03-05" &&
    model.availability?.some(({ deployment_type }) => deployment_type === "regional_processing") ===
      true
  );
}

function openAiGlobalProcessingRates(
  rates: readonly SourcePriceFact[],
  model: Pick<ProviderModel, "availability" | "release_date">,
): SourcePriceFact[] {
  if (!openAiRegionalUpliftEligible(model)) return [...rates];
  return rates.map((rate) => ({
    ...rate,
    conditions: { ...rate.conditions, deployment_scope: "global_processing" },
  }));
}

function openAiRegionalProcessingRates(rates: readonly SourcePriceFact[]): SourcePriceFact[] {
  return rates.flatMap((rate): SourcePriceFact[] => {
    const global = {
      ...rate,
      conditions: { ...rate.conditions, deployment_scope: "global_processing" },
    };
    return [
      global,
      {
        ...rate,
        price: multiplyDecimal(rate.price, "1.1"),
        conditions: { ...rate.conditions, deployment_scope: "regional_processing" },
        derived: true,
        derivation: "1.1 × published rate for eligible regional-processing endpoints",
        raw_price: undefined,
        raw_unit: "published 10% regional-processing uplift",
      },
    ];
  });
}

interface OpenAiAccountingContract {
  key: string;
  schema: string;
  path: string[];
  channel: SourcePricingInputFact["channel"];
  locator: SourcePricingInputFact["locator"];
  reduction?: SourcePricingInputFact["reduction"];
  availability: SourcePricingInputFact["availability"];
}

const openAiAccountingContracts: readonly OpenAiAccountingContract[] = [
  responseUsage("input_tokens", ["input_tokens"]),
  responseUsage("cached_input_tokens", ["input_tokens_details", "cached_tokens"]),
  responseUsage("cache_write_tokens", ["input_tokens_details", "cache_write_tokens"]),
  responseUsage("output_tokens", ["output_tokens"]),
  responseField("served_service_tier", "service_tier"),
  responseField("image_quality", "quality", "ImagesResponse"),
  responseField("image_resolution", "size", "ImagesResponse"),
  responseField("generated_images", "data", "ImagesResponse", "/data", ["data"], {
    kind: "array_length",
  }),
  responseField("image_input_tokens", "input_tokens", "ImageGenUsage", "/usage/input_tokens"),
  responseField(
    "image_input_text_tokens",
    "text_tokens",
    "ImageGenInputUsageDetails",
    "/usage/input_tokens_details/text_tokens",
  ),
  responseField(
    "image_input_image_tokens",
    "image_tokens",
    "ImageGenInputUsageDetails",
    "/usage/input_tokens_details/image_tokens",
  ),
  responseField(
    "image_output_tokens",
    "image_tokens",
    "ImageGenOutputTokensDetails",
    "/usage/output_tokens_details/image_tokens",
  ),
  responseField(
    "embedding_input_tokens",
    "prompt_tokens",
    "CreateEmbeddingResponse",
    "/usage/prompt_tokens",
    ["usage", "prompt_tokens"],
  ),
  responseField("generated_seconds", "seconds", "VideoResource", "/seconds"),
  responseField("video_resolution", "size", "VideoResource", "/size"),
  ...[
    "input_tokens",
    "input_cached_tokens",
    "input_cache_write_tokens",
    "input_uncached_tokens",
    "output_tokens",
    "input_text_tokens",
    "output_text_tokens",
    "input_cached_text_tokens",
    "input_audio_tokens",
    "input_cached_audio_tokens",
    "output_audio_tokens",
    "input_image_tokens",
    "input_cached_image_tokens",
    "output_image_tokens",
    "service_tier",
  ].map((field) => organizationUsage("completions", "UsageCompletionsResult", field)),
  organizationUsage("embeddings", "UsageEmbeddingsResult", "input_tokens"),
  organizationUsage("audio_speeches", "UsageAudioSpeechesResult", "characters"),
  organizationUsage("audio_transcriptions", "UsageAudioTranscriptionsResult", "seconds"),
  organizationUsage(
    "code_interpreter_sessions",
    "UsageCodeInterpreterSessionsResult",
    "num_sessions",
  ),
  organizationUsage("file_search_calls", "UsageFileSearchCallsResult", "num_requests"),
  organizationUsage("images", "UsageImagesResult", "images"),
  organizationUsage("web_search_calls", "UsageWebSearchCallsResult", "num_requests"),
];

function responseUsage(key: string, path: string[]): OpenAiAccountingContract {
  return {
    key: `responses.usage.${key}`,
    schema: "ResponseUsage",
    path,
    channel: "response",
    locator: {
      kind: "json_pointer",
      value: `/usage/${path.join("/")}`,
    },
    availability: "terminal_only",
  };
}

function responseField(
  key: string,
  property: string,
  schema = "Response",
  pointer = `/${property}`,
  path: string[] = [property],
  reduction?: SourcePricingInputFact["reduction"],
): OpenAiAccountingContract {
  return {
    key: `responses.${key}`,
    schema,
    path,
    channel: "response",
    locator: { kind: "json_pointer", value: pointer },
    ...(reduction === undefined ? {} : { reduction }),
    availability: "terminal_only",
  };
}

function organizationUsage(
  endpoint: string,
  schema: string,
  field: string,
): OpenAiAccountingContract {
  return {
    key: `organization.${endpoint}.${field}`,
    schema,
    path: [field],
    channel: "account_report",
    locator: {
      kind: "provider_field",
      value: `organization.usage.${endpoint}.results[*].${field}`,
    },
    availability: "reconciliation_only",
  };
}

function parseOpenAiAccounting(input: ParseInput): ProviderModel[] {
  if (input.catalogModels === undefined)
    throw new Error("OpenAI accounting contract requires the collected catalog");
  const target = [...input.catalogModels].sort((left, right) =>
    left.uid.localeCompare(right.uid),
  )[0];
  if (target === undefined) throw new Error("OpenAI accounting contract has no catalog carrier");
  const pricingInputs: SourcePricingInputFact[] = [];
  for (const contract of openAiAccountingContracts) {
    if (!openApiYamlHasPropertyPath(input.body, contract.schema, contract.path)) {
      input.onContractFinding?.(
        contractExtensionEvidence([
          `/components/schemas/${contract.schema}/properties/${contract.path.join("/properties/")}`,
        ]),
      );
      continue;
    }
    pricingInputs.push({
      key: contract.key,
      channel: contract.channel,
      locator: contract.locator,
      ...(contract.reduction === undefined ? {} : { reduction: contract.reduction }),
      availability: contract.availability,
      source_ref: input.source.id,
    });
  }
  if (pricingInputs.length === 0)
    throw new Error("OpenAI accounting contract contained no recognized pricing inputs");
  input.onPricingReconciliation?.({
    disposition: "normalized",
    reason_code: "pricing_input_contract_bound",
    sample: `${pricingInputs.length} accounting fields`,
  });
  return [
    {
      ...baseModel({
        providerId: input.provider.id,
        id: target.model_id,
        ...(target.version === undefined ? {} : { version: target.version }),
        name: target.name,
        sourceId: input.source.id,
        observedAt: input.observedAt,
      }),
      tasks: target.tasks,
      pricing_state: "unknown",
      price_facts: [],
      raw_price_facts: [],
      pricing_inputs: pricingInputs,
    },
  ];
}

function parseOpenAiPricing(input: ParseInput): ProviderModel[] {
  if (input.catalogModels === undefined)
    throw new Error("OpenAI pricing requires the collected catalog");
  const exact = new Map(input.catalogModels.map((model) => [model.model_id, model]));
  const aliases = new Map<string, (typeof input.catalogModels)[number] | null>();
  const names = new Map<string, (typeof input.catalogModels)[number] | null>();
  for (const model of input.catalogModels) {
    addUniqueModelIndex(names, model.name.toLowerCase(), model);
    for (const alias of model.aliases) addUniqueModelIndex(aliases, alias, model);
  }
  const findTarget = (rawId: string): (typeof input.catalogModels)[number] | null | undefined => {
    const direct = exact.get(rawId);
    if (direct !== undefined) return direct;
    if (rawId === rawId.toLowerCase() && modelIdSchema.safeParse(rawId).success) return undefined;
    const alias = aliases.get(rawId);
    return alias === undefined ? names.get(rawId.toLowerCase()) : alias;
  };
  const created = new Map<string, ProviderModel>();
  const states = new Map<string, "free">();
  const createTarget = (modelId: string): ProviderModel => {
    const model = {
      ...baseModel({
        providerId: input.provider.id,
        id: modelId,
        name: modelId,
        sourceId: input.source.id,
        observedAt: input.observedAt,
      }),
      tasks: classifyModelTasks({
        modelId,
        name: modelId,
        rawType: undefined,
        modalities: { input: [], output: [] },
        fallback: "text_generation",
      }),
    } satisfies ProviderModel;
    created.set(modelId, model);
    exact.set(modelId, model);
    return model;
  };
  const rates = new Map<string, Map<string, SourcePriceFact>>();
  const conflicts = new Map<string, Map<string, SourceRawPricingFact>>();
  const conflictedRates = new Map<string, Set<string>>();
  const commercialFacts: SourceCommercialPricingFact[] = [];
  const pricingAliases = openAiPricingAliases(input.body);
  const containerBilling = input.body.match(
    /Eligible container sessions will be billed by the minute, with a 5-minute minimum per session\./,
  )?.[0];
  const unsupportedCell = (sample: string): void => {
    input.onPricingReconciliation?.({
      disposition: "unsupported",
      reason_code: "unsupported_pricing_cell",
      ...(sample === "" ? {} : { sample: sample.slice(0, 256) }),
    });
  };
  for (const table of openAiPricingTables(input.body, input.onPricingReconciliation)) {
    if (table.section === "Tools") {
      for (const row of table.rows) {
        const facts = openAiToolCommercialFacts(
          table,
          row,
          input.source.id,
          input.catalogModels,
          containerBilling,
        );
        commercialFacts.push(...facts);
        const details = row[table.headers.indexOf("Details")] ?? "";
        const outsideScope =
          (row[0] === "File search" && details === "Storage") ||
          (row[0] === "Agent Kit" && details === "ChatKit file and image upload storage");
        input.onPricingReconciliation?.({
          disposition: outsideScope
            ? "excluded"
            : facts.length === 0
              ? "unsupported"
              : "normalized",
          reason_code: outsideScope
            ? "commercial_fact_outside_invocation_scope"
            : facts.length === 0
              ? "provider_service_pricing_unmodeled"
              : "provider_service_pricing_bound",
          ...(row[0] === undefined ? {} : { sample: row[0] }),
        });
      }
      continue;
    }
    if (table.section === "Finetuning") {
      for (const row of table.rows) {
        const modelId = row[table.headers.indexOf("Model")] ?? "";
        const target = findTarget(modelId.replace(/ \(data sharing\)$/, ""));
        const facts = openAiFineTunedInferenceFacts(
          table,
          row,
          input.source.id,
          target === null ? undefined : target,
          unsupportedCell,
        );
        commercialFacts.push(...facts);
        input.onPricingReconciliation?.({
          disposition: facts.length === 0 ? "unsupported" : "normalized",
          reason_code:
            facts.length === 0
              ? "fine_tuned_inference_pricing_unmodeled"
              : "fine_tuned_inference_pricing_bound",
          ...(modelId === "" ? {} : { sample: modelId }),
        });
        if (table.headers.includes("Training"))
          input.onPricingReconciliation?.({
            disposition: "excluded",
            reason_code: "commercial_fact_outside_invocation_scope",
            sample: `${modelId}: training`,
          });
      }
      continue;
    }
    const modelIndex = table.headers.indexOf("Model");
    if (modelIndex < 0) continue;
    for (const row of table.rows) {
      const rawId = (row[modelIndex] ?? "").replace(
        / \((?:<272K context length|legacy|data sharing)\)$/,
        "",
      );
      let target = findTarget(rawId);
      if (target === null) {
        input.onPricingReconciliation?.({
          disposition: "ambiguous",
          reason_code: "documented_alias_ambiguous",
          sample: rawId,
        });
        continue;
      }
      if (target === undefined && !modelIdSchema.safeParse(rawId).success) {
        input.onPricingReconciliation?.({
          disposition: "excluded",
          reason_code: "non_model_pricing_row",
          ...(rawId === "" ? {} : { sample: rawId }),
        });
        continue;
      }
      target ??= createTarget(rawId);
      const candidates = openAiGlobalRates(
        table,
        row,
        target.tasks,
        input.source.id,
        unsupportedCell,
      );
      if (candidates === undefined) {
        input.onPricingReconciliation?.({
          disposition: "unsupported",
          reason_code: "unreviewed_pricing_table",
          sample: table.headers.join(" | ").slice(0, 256),
        });
        break;
      }
      if (candidates.length === 0) {
        if (row.includes("Free")) {
          if (target.price_facts.length > 0 || rates.has(target.model_id)) {
            input.onPricingReconciliation?.({
              disposition: "ambiguous",
              reason_code: "pricing_state_conflict_retained",
              sample: rawId,
            });
          } else if (target.pricing_state === "free") {
            input.onPricingReconciliation?.({
              disposition: "excluded",
              reason_code: "duplicate_catalog_price",
              sample: rawId,
            });
          } else {
            states.set(target.model_id, "free");
            input.onPricingReconciliation?.({
              disposition: "normalized",
              reason_code: "free_pricing_row_bound",
            });
          }
          continue;
        }
        input.onPricingReconciliation?.({
          disposition: "unsupported",
          reason_code: "pricing_row_has_no_normalized_rate",
          sample: rawId,
        });
        continue;
      }
      const existing = new Map(target.price_facts.map((fact) => [sourcePriceFactKey(fact), fact]));
      const selected = candidates.map((fact) => {
        const current = existing.get(sourcePriceFactKey(fact));
        if (current === undefined || decimalsEqual(current.price, fact.price)) return fact;
        input.onPricingReconciliation?.({
          disposition: "raw",
          reason_code: "first_party_price_conflict_resolved",
          sample: rawId,
        });
        return { ...fact, resolution_policy: "openai_pricing_page_over_model_card" };
      });
      const modelRates = rates.get(target.model_id) ?? new Map<string, SourcePriceFact>();
      const modelConflicts = conflictedRates.get(target.model_id) ?? new Set<string>();
      const rawConflicts =
        conflicts.get(target.model_id) ?? new Map<string, SourceRawPricingFact>();
      for (const fact of selected) {
        const key = sourcePriceFactKey(fact);
        if (modelConflicts.has(key)) continue;
        const current = modelRates.get(key);
        if (current !== undefined && !decimalsEqual(current.price, fact.price)) {
          modelRates.delete(key);
          modelConflicts.add(key);
          rawConflicts.set(key, openAiPriceConflict(current, fact, input.source.id));
          input.onPricingReconciliation?.({
            disposition: "ambiguous",
            reason_code: "pricing_value_conflict",
            sample: rawId,
          });
          continue;
        }
        modelRates.set(key, fact);
      }
      rates.set(target.model_id, modelRates);
      if (modelConflicts.size > 0) conflictedRates.set(target.model_id, modelConflicts);
      if (rawConflicts.size > 0) conflicts.set(target.model_id, rawConflicts);
      input.onPricingReconciliation?.({
        disposition: "normalized",
        reason_code: "pricing_row_bound",
      });
    }
  }
  if (input.source.extractor.kind !== "openai-pricing")
    throw new Error("Invalid OpenAI pricing extractor");
  for (const [aliasId, targetId] of pricingAliases) {
    const alias = exact.get(aliasId);
    const target = exact.get(targetId);
    const targetRates = rates.get(targetId);
    if (alias === undefined || target === undefined || targetRates === undefined) {
      input.onPricingReconciliation?.({
        disposition: "unbound",
        reason_code: "documented_alias_price_unbound",
        sample: `${aliasId} -> ${targetId}`,
      });
      continue;
    }
    rates.set(
      aliasId,
      new Map(
        [...targetRates].map(([key, fact]) => [
          key,
          {
            ...fact,
            derived: true,
            derivation: `OpenAI pricing documents ${aliasId} as routing to ${targetId} with matching pricing`,
            raw_price: undefined,
            raw_unit: undefined,
          },
        ]),
      ),
    );
    input.onPricingReconciliation?.({
      disposition: "normalized",
      reason_code: "documented_alias_price_bound",
      sample: `${aliasId} -> ${targetId}`,
    });
  }
  const hasRegionalUplift = /Regional processing .*10% uplift/i.test(input.body);
  const modelIds = new Set([
    ...rates.keys(),
    ...states.keys(),
    ...created.keys(),
    ...conflicts.keys(),
  ]);
  if (commercialFacts.length > 0 && modelIds.size === 0) {
    const carrier = [...input.catalogModels].sort((left, right) =>
      left.uid.localeCompare(right.uid),
    )[0];
    if (carrier !== undefined) modelIds.add(carrier.model_id);
  }
  if (modelIds.size === 0) throw new Error("OpenAI pricing contained no admitted facts");
  const output = [...modelIds]
    .map((modelId): ProviderModel => {
      const target = exact.get(modelId);
      if (target === undefined) throw new Error("OpenAI pricing lost its catalog binding");
      const modelRates = rates.get(modelId);
      const rawPriceFacts = [...(conflicts.get(modelId)?.values() ?? [])];
      const priceFacts = [...(modelRates?.values() ?? [])];
      const publishedRates =
        hasRegionalUplift && openAiRegionalUpliftEligible(target)
          ? openAiRegionalProcessingRates(priceFacts)
          : priceFacts;
      return {
        ...baseModel({
          providerId: input.provider.id,
          id: modelId,
          ...(target.version === undefined ? {} : { version: target.version }),
          name: target.name,
          sourceId: input.source.id,
          observedAt: input.observedAt,
        }),
        tasks: target.tasks,
        pricing_state:
          modelRates === undefined || modelRates.size === 0
            ? (states.get(modelId) ?? "unknown")
            : "numeric",
        price_facts: publishedRates,
        raw_price_facts: rawPriceFacts,
      };
    })
    .sort((left, right) => left.uid.localeCompare(right.uid));
  if (commercialFacts.length > 0) {
    const carrier = output[0];
    if (carrier === undefined) throw new Error("OpenAI commercial pricing has no replay carrier");
    carrier.commercial_facts = commercialFacts;
  }
  return output;
}

function openAiModalitiesFromDetails(
  details: string,
  label: "Input" | "Output",
  onFinding: ParseInput["onContractFinding"],
): Modality[] {
  const match = details.match(new RegExp(`^- ${label} modalities: (.+)$`, "m"));
  if (match?.[1] === undefined) {
    onFinding?.(contractExtensionEvidence([`/models/modalities/${label.toLowerCase()}`]));
    return [];
  }
  const values = match[1].split(",").map((value) => value.trim());
  const modalities = values.flatMap((value): Modality[] => {
    const parsed = modalitySchema.safeParse(value);
    if (parsed.success) return [parsed.data];
    onFinding?.(
      contractExtensionEvidence([`/models/modalities/${label.toLowerCase()}/${value || "empty"}`]),
    );
    return [];
  });
  return unique(modalities);
}

function openAiLimit(
  details: string,
  label: "context window" | "max output tokens",
): number | undefined {
  const match = details.match(new RegExp(`^- ([\\d,]+) ${label}$`, "m"));
  return match?.[1] === undefined ? undefined : Number(match[1].replaceAll(",", ""));
}

function openAiListSection(body: string, heading: string): Set<string> | undefined {
  const section = markdownSection(body, heading);
  if (section === undefined) return undefined;
  return new Set(
    [...section.matchAll(/^- ([a-z][a-z0-9_]*)$/gm)].flatMap((match) =>
      match[1] === undefined ? [] : [match[1]],
    ),
  );
}

function openAiAliasesFromMarkdown(
  body: string,
  id: string,
  onFinding: ParseInput["onContractFinding"],
): string[] {
  const snapshots = markdownSection(body, "Snapshots");
  if (snapshots === undefined) onFinding?.(contractExtensionEvidence([`/models/${id}/snapshots`]));
  const aliases = markdownCodeValues(snapshots ?? "").filter(
    (value) => value !== id && modelIdSchema.safeParse(value).success,
  );
  for (const match of body.matchAll(/The `([^`]+)` alias routes requests to\b/g)) {
    const alias = match[1];
    if (alias !== undefined && alias !== id && modelIdSchema.safeParse(alias).success)
      aliases.push(alias);
  }
  return unique(aliases).sort();
}

function openAiIndexStatuses(
  body: string,
): Map<string, Pick<ProviderModel, "status" | "release_stage">> {
  const statuses = new Map<string, Pick<ProviderModel, "status" | "release_stage">>();
  for (const match of body.matchAll(
    /^- \[[^\]]+\]\(\/api\/docs\/models\/([a-z0-9._-]+)\.md\)(?::\s*(.*))?$/gm,
  )) {
    const id = match[1];
    if (id === undefined) continue;
    const deprecated = /\bDeprecated\b/i.test(match[2] ?? "");
    const current = statuses.get(id);
    statuses.set(id, {
      status: deprecated || current?.status === "deprecated" ? "deprecated" : "active",
      release_stage: id.includes("preview") ? "preview" : "unknown",
    });
  }
  if (statuses.size === 0) throw new Error("OpenAI catalog index contained no model links");
  return statuses;
}

function openAiMarkdownModel(
  input: ParseInput,
  body: string,
  expectedId: string,
  lifecycle: Pick<ProviderModel, "status" | "release_stage">,
): ProviderModel {
  const idMatches = [...body.matchAll(/^Model ID: `([^`]+)`$/gm)];
  const id = idMatches.length === 1 ? idMatches[0]?.[1] : undefined;
  if (id !== expectedId) throw new Error(`OpenAI model page identity disagreed for ${expectedId}`);
  const observedName = body.match(/^# (.+)$/m)?.[1]?.trim();
  const name = observedName === undefined || observedName === "" ? id : observedName;
  if (name === id) input.onContractFinding?.(contractExtensionEvidence([`/models/${id}/name`]));
  const observedDetails = markdownSection(body, "Model details");
  const details = observedDetails ?? "";
  if (observedDetails === undefined)
    input.onContractFinding?.(contractExtensionEvidence([`/models/${id}/details`]));
  const observedModalities = {
    input: openAiModalitiesFromDetails(details, "Input", input.onContractFinding),
    output: openAiModalitiesFromDetails(details, "Output", input.onContractFinding),
  };
  const classifiedOperations = classifyModelTasks({
    modelId: id,
    name,
    rawType: undefined,
    modalities: observedModalities,
    fallback: "text_generation",
  });
  const endpointEvidence = openAiEndpointEvidence(
    body,
    classifiedOperations,
    input.onContractFinding,
  );
  const tasks = endpointEvidence.tasks;
  const modelModalities: ProviderModel["modalities"] = tasks.includes("embeddings")
    ? { input: observedModalities.input, output: ["embedding"] }
    : observedModalities;
  const features = openAiListSection(body, "Supported features");
  const tools = openAiListSection(body, "Supported tools");
  const feature = (name: string): boolean | "unknown" =>
    features === undefined ? "unknown" : features.has(name);
  const pricedCachedInput = /^\|\s*Cached input\s*\|\s*\$\d+(?:\.\d+)?\s*\|/im.test(body);
  const tool = (names: string[]): boolean | "unknown" =>
    tools === undefined ? "unknown" : names.some((value) => tools.has(value));
  const description = [...body.slice(0, body.indexOf("Model ID:")).matchAll(/^> (.+)$/gm)]
    .flatMap((match) =>
      match[1] === undefined || match[1].startsWith("For the complete documentation index")
        ? []
        : [match[1]],
    )
    .at(-1);
  return {
    ...baseModel({
      providerId: input.provider.id,
      id,
      name,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    }),
    ...(description === undefined ? {} : { description: normalizedText(description) }),
    aliases: openAiAliasesFromMarkdown(body, id, input.onContractFinding),
    tasks,
    api_endpoints: endpointEvidence.endpoints,
    modalities: modelModalities,
    capabilities: {
      ...unknownCapabilities(),
      reasoning:
        observedDetails === undefined ? "unknown" : details.includes("- Reasoning token support"),
      tool_call: feature("function_calling"),
      structured_output: feature("structured_outputs"),
      streaming: feature("streaming"),
      batch: endpointEvidence.support.get("v1/batch") ?? "unknown",
      prompt_cache: pricedCachedInput || feature("prompt_caching"),
      fine_tuning: endpointEvidence.support.get("v1/fine-tuning") ?? "unknown",
      code_execution: tool(["code_interpreter", "hosted_shell"]),
      effort_control:
        /reasoning[._ ]effort supports:|configurable reasoning effort/i.test(body) || "unknown",
      computer_use:
        tool(["computer_use"]) === true ||
        /specialized model for the computer use tool|trained to understand and execute computer tasks/i.test(
          body,
        ) ||
        (tools === undefined ? "unknown" : false),
    },
    limits: {
      context_tokens: openAiLimit(details, "context window"),
      max_output_tokens: openAiLimit(details, "max output tokens"),
    },
    ...lifecycle,
    pricing_state: body.includes("free models designed to detect harmful content")
      ? "free"
      : body.includes("open-weight model")
        ? "not_applicable"
        : "unknown",
  };
}

function parseOpenAiCatalog(input: ParseInput): ProviderModel[] {
  const bundle = linkedBundleSchema.parse(parseJson(input.body));
  const statuses = openAiIndexStatuses(bundle.index.body);
  const documents = new Map<string, typeof bundle.documents>();
  for (const document of bundle.documents) {
    const match = new URL(document.url).pathname.match(/^\/api\/docs\/models\/([a-z0-9._-]+)\.md$/);
    const id = match?.[1];
    if (id === undefined || id === "compare") continue;
    const current = documents.get(id) ?? [];
    current.push(document);
    documents.set(id, current);
  }
  const extra = [...documents.keys()].filter((id) => !statuses.has(id));
  if (extra.length > 0)
    input.onContractFinding?.(
      contractExtensionEvidence(extra.map((id) => `/models/${id}/unindexed`)),
    );
  return [...statuses.entries()]
    .map(([id, lifecycle]) => {
      const matches = documents.get(id) ?? [];
      if (matches.length === 1)
        try {
          return openAiMarkdownModel(input, matches[0]!.body, id, lifecycle);
        } catch {
          input.onContractFinding?.(contractExtensionEvidence([`/models/${id}/card`]));
        }
      else input.onContractFinding?.(contractExtensionEvidence([`/models/${id}/document`]));
      return {
        ...baseModel({
          providerId: input.provider.id,
          id,
          name: id,
          sourceId: input.source.id,
          observedAt: input.observedAt,
        }),
        ...lifecycle,
      };
    })
    .sort((left, right) => left.uid.localeCompare(right.uid));
}

function parseOpenAiModelPricing(input: ParseInput): ProviderModel[] {
  if (input.catalogModels === undefined)
    throw new Error("OpenAI model-card pricing requires the collected catalog");
  const bundle = linkedBundleSchema.parse(parseJson(input.body));
  const targets = new Map(input.catalogModels.map((model) => [model.model_id, model]));
  const index = load(bundle.index.body);
  const indexed = new Set<string>();
  index("a[href]").each((_index, element) => {
    const match = index(element)
      .attr("href")
      ?.match(/^\/api\/docs\/models\/([a-z0-9._-]+)$/);
    if (match?.[1] !== undefined) indexed.add(match[1]);
  });
  const documents = new Map<string, typeof bundle.documents>();
  for (const document of bundle.documents) {
    const id = new URL(document.url).pathname.split("/").at(-1);
    if (id === undefined || !modelIdSchema.safeParse(id).success || !indexed.has(id)) {
      input.onContractFinding?.(
        contractExtensionEvidence([`/models/${id ?? "unknown"}/pricing-document`]),
      );
      continue;
    }
    const current = documents.get(id) ?? [];
    current.push(document);
    documents.set(id, current);
  }
  return [...indexed]
    .flatMap((id): ProviderModel[] => {
      const matches = documents.get(id) ?? [];
      if (matches.length !== 1) {
        input.onContractFinding?.(contractExtensionEvidence([`/models/${id}/pricing-document`]));
        return [];
      }
      const target = targets.get(id);
      if (target === undefined) {
        input.onPricingReconciliation?.({
          disposition: "excluded",
          reason_code: "model_card_price_without_catalog_identity",
          sample: id,
        });
        return [];
      }
      const $ = load(matches[0]!.body);
      let rates: SourcePriceFact[];
      try {
        rates = openAiPricing($, input.source.id, target.tasks);
      } catch {
        input.onContractFinding?.(contractExtensionEvidence([`/models/${id}/pricing`]));
        return [];
      }
      const pageText = normalizedText($("main").text());
      return [
        {
          ...baseModel({
            providerId: input.provider.id,
            id,
            ...(target.version === undefined ? {} : { version: target.version }),
            name: target.name,
            sourceId: input.source.id,
            observedAt: input.observedAt,
          }),
          tasks: target.tasks,
          pricing_state:
            rates.length > 0
              ? "numeric"
              : pageText.includes("free models designed to detect harmful content")
                ? "free"
                : pageText.includes("open-weight model")
                  ? "not_applicable"
                  : "unknown",
          price_facts: openAiGlobalProcessingRates(rates, target),
        },
      ];
    })
    .sort((left, right) => left.uid.localeCompare(right.uid));
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

const openAiMonths = new Map(
  [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ].map((month, index) => [month, index + 1]),
);

function parseOpenAiChangelog(input: ParseInput): ProviderModel[] {
  if (input.catalogModels === undefined)
    throw new Error("OpenAI changelog requires the collected catalog");
  const known = new Map(input.catalogModels.map((model) => [model.model_id, model]));
  const releases = new Map<string, string>();
  const abbreviatedMonths = new Map(
    [...openAiMonths].map(([month, number]) => [month.slice(0, 3), number]),
  );
  let year: string | undefined;
  let month: number | undefined;
  let date: string | undefined;
  for (const rawLine of input.body.split(/\r?\n/)) {
    const line = normalizedText(rawLine);
    const monthHeading = line.match(/^## ([A-Z][a-z]+), (\d{4})$/);
    if (monthHeading?.[1] !== undefined && monthHeading[2] !== undefined) {
      month = openAiMonths.get(monthHeading[1]);
      year = monthHeading[2];
      date = undefined;
      continue;
    }
    const dayHeading = line.match(/^### ([A-Z][a-z]{2}) ([1-9]|[12]\d|3[01])$/);
    if (dayHeading?.[1] !== undefined && dayHeading[2] !== undefined && year !== undefined) {
      const headingMonth = abbreviatedMonths.get(dayHeading[1]);
      date =
        headingMonth === undefined || headingMonth !== month
          ? undefined
          : `${year}-${String(headingMonth).padStart(2, "0")}-${dayHeading[2].padStart(2, "0")}`;
      continue;
    }
    if (date === undefined || !line.startsWith("Feature ·")) continue;
    for (const match of line.matchAll(/(?:^| · )Model: ([a-z0-9._-]+)/g)) {
      const modelId = match[1];
      if (modelId === undefined || !known.has(modelId)) continue;
      const current = releases.get(modelId);
      if (current === undefined || date < current) releases.set(modelId, date);
    }
  }
  if (releases.size === 0) throw new Error("OpenAI changelog contained no known model releases");
  if (input.source.extractor.kind !== "openai-changelog")
    throw new Error("Invalid OpenAI changelog extractor");
  return [...releases]
    .map(([modelId, releaseDate]) => {
      const target = known.get(modelId);
      if (target === undefined) throw new Error("OpenAI changelog lost its catalog binding");
      return {
        ...baseModel({
          providerId: input.provider.id,
          id: modelId,
          ...(target.version === undefined ? {} : { version: target.version }),
          name: target.name,
          sourceId: input.source.id,
          observedAt: input.observedAt,
        }),
        tasks: target.tasks,
        release_date: releaseDate,
      };
    })
    .sort((left, right) => left.uid.localeCompare(right.uid));
}

function openAiShutdownDate(value: string): string | undefined {
  const normalized = normalizedText(value).replace(/[‐‑‒–—−]/g, "-");
  if (z.iso.date().safeParse(normalized).success) return normalized;
  const match = normalized.match(/^([A-Z][a-z]+) ([1-9]|[12]\d|3[01]), (\d{4})$/);
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined)
    return undefined;
  const month = openAiMonths.get(match[1]);
  if (month === undefined) return undefined;
  const date = `${match[3]}-${String(month).padStart(2, "0")}-${match[2].padStart(2, "0")}`;
  return z.iso.date().safeParse(date).success ? date : undefined;
}

function parseOpenAiDeprecations(input: ParseInput): ProviderModel[] {
  const models = new Map<string, ProviderModel>();
  const knownModelIds = new Set(input.catalogModels?.map(({ model_id }) => model_id) ?? []);
  const lines = input.body.split(/\r?\n/);
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!normalizedText(lines[index] ?? "").startsWith("|")) continue;
    const headers = markdownCells(lines[index] ?? "").map((header) => header.toLowerCase());
    const separators = markdownCells(lines[index + 1] ?? "");
    if (
      separators.length !== headers.length ||
      !separators.every((cell) => /^:?-{3,}:?$/.test(cell))
    )
      continue;
    const dateIndex = headers.findIndex((header) => header === "shutdown date");
    const modelIndex = headers.findIndex(
      (header) =>
        header === "model / system" ||
        header === "deprecated model" ||
        header === "legacy model" ||
        header === "model snapshot" ||
        header === "model",
    );
    const replacementIndex = headers.findIndex(
      (header) =>
        header === "recommended replacement" ||
        header === "recommended replacement base model" ||
        header === "substitute model",
    );
    if (dateIndex < 0 || modelIndex < 0) continue;
    index += 2;
    while (index < lines.length && normalizedText(lines[index] ?? "").startsWith("|")) {
      const cells = markdownCells(lines[index] ?? "");
      if (cells.length !== headers.length)
        throw new Error("OpenAI deprecations table contained an irregular row");
      const retiredAt = openAiShutdownDate(cells[dateIndex] ?? "");
      if (retiredAt !== undefined) {
        const replacements =
          replacementIndex < 0
            ? []
            : unique(
                markdownCodeValues(cells[replacementIndex] ?? "").filter(
                  (id) => modelIdSchema.safeParse(id).success,
                ),
              );
        const modelCell = cells[modelIndex] ?? "";
        const ids = unique(
          markdownCodeValues(modelCell).filter((id) => modelIdSchema.safeParse(id).success),
        );
        const entries = normalizedText(modelCell).includes("|")
          ? ids[0] === undefined
            ? []
            : [{ id: ids[0], aliases: ids.slice(1) }]
          : ids.map((id) => ({ id, aliases: [] }));
        for (const { id, aliases } of entries) {
          const status = retiredAt <= input.observedAt.slice(0, 10) ? "retired" : "deprecated";
          if (
            input.catalogModels !== undefined &&
            !knownModelIds.has(id) &&
            (status === "retired" || /^ft(?::|-)/.test(id))
          )
            continue;
          const model: ProviderModel = {
            ...baseModel({
              providerId: input.provider.id,
              id,
              name: id,
              sourceId: input.source.id,
              observedAt: input.observedAt,
            }),
            aliases,
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
            models.set(id, {
              ...model,
              aliases: unique([...(previous?.aliases ?? []), ...model.aliases]),
            });
        }
      }
      index += 1;
    }
    index -= 1;
  }
  if (models.size === 0) throw new Error("OpenAI deprecations page contained no model rows");
  return [...models.values()].sort((left, right) => left.uid.localeCompare(right.uid));
}

function parseSourceBody(input: ParseInput): ProviderModel[] {
  switch (input.source.extractor.kind) {
    case "openai-catalog":
      return parseOpenAiCatalog(input);
    case "openai-model-pricing":
      return parseOpenAiModelPricing(input);
    case "openai-api":
      return parseOpenAiApi(input);
    case "openai-changelog":
      return parseOpenAiChangelog(input);
    case "openai-deprecations":
      return parseOpenAiDeprecations(input);
    case "openai-data-residency":
      return parseOpenAiDataResidency(input);
    case "openai-pricing":
      return parseOpenAiPricing(input);
    case "openai-accounting":
      return parseOpenAiAccounting(input);
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
    case "huggingface-featherless":
      return parseHuggingFaceFeatherless(input);
    case "huggingface-native-pricing":
      return parseHuggingFaceNativePricing(input);
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
    case "azure-portal-catalog":
      return parseAzurePortalCatalog(input);
    case "azure-retail-prices":
      return parseAzureRetailPrices(input);
    case "azure-public-pricing":
      return parseAzurePublicPricing(input);
    case "azure-claude-pricing":
      return parseAzureClaudePricing(input);
    case "azure-accounting":
      return parseAzureAccounting(input);
    case "azure-api":
      return parseAzureApi(input);
    case "gemini-catalog":
      return parseGeminiCatalog(input);
    case "gemini-pricing":
      return parseGeminiPricing(input);
    case "gemini-api":
      return parseGeminiApi(input);
    case "vertex-catalog":
      return parseVertexCatalog(input);
    case "vertex-pricing":
      return parseVertexPricing(input);
    case "vertex-api":
      return parseVertexApi(input);
    case "cohere-catalog":
      return parseCohereCatalog(input);
    case "cohere-pricing":
      return parseCoherePricing(input);
    case "cohere-api":
      return parseCohereApi(input);
    case "mistral-catalog":
      return parseMistralCatalog(input);
    case "mistral-pricing":
      return parseMistralPricing(input);
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
