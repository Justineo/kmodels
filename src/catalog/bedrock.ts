import { BedrockClient, ListFoundationModelsCommand } from "@aws-sdk/client-bedrock";
import { z } from "zod";
import { linkedBundleSchema } from "./bundle.ts";
import { modelIdSchema } from "./identity.ts";
import { apiEndpointKey, baseModel } from "./model.ts";
import type { SourceManifest } from "./manifests.ts";
import { scaleDecimal } from "./pricing.ts";
import {
  modalitySchema,
  type Modality,
  type ModelOperation,
  type PriceRate,
  type Provider,
  type ProviderModel,
  unknownCapabilities,
} from "./schema.ts";
import { classifyModelOperations } from "./operation.ts";

interface ParseInput {
  provider: Provider;
  source: SourceManifest;
  body: string;
  observedAt: string;
}

interface CardId {
  aliases: Set<string>;
  endpoints: Set<BedrockModelEndpoint>;
  deploymentTypes: Set<DeploymentType>;
}

interface Card {
  name: string;
  publisher: string;
  description: string | undefined;
  ids: Map<string, CardId>;
  modalities: ProviderModel["modalities"];
  apiEndpoints: BedrockApiEndpoint[];
  availability: BedrockAvailability[];
  capabilities: ProviderModel["capabilities"];
  limits: ProviderModel["limits"];
  releaseDate: string | undefined;
  deprecatedAt: string | undefined;
  retiredAt: string | undefined;
  status: ProviderModel["status"];
  releaseStage: ProviderModel["release_stage"];
  operations: ModelOperation[];
  identityKeys: Set<string>;
}

type BedrockModelEndpoint = "bedrock-runtime" | "bedrock-mantle";
type DeploymentType = "in-region" | "geo" | "global";

interface BedrockApiEndpoint {
  name: string;
  path: string;
  programmaticEndpoint: BedrockModelEndpoint;
}

interface BedrockAvailability {
  region: string;
  deploymentType: DeploymentType;
}

const rerankApi: BedrockApiEndpoint = {
  name: "Rerank",
  path: "rerank",
  programmaticEndpoint: "bedrock-runtime",
};
const bedrockApiDefinitions = new Map<string, Omit<BedrockApiEndpoint, "name">[]>([
  ["Invoke", [{ path: "model/{modelId}/invoke", programmaticEndpoint: "bedrock-runtime" }]],
  ["Converse", [{ path: "model/{modelId}/converse", programmaticEndpoint: "bedrock-runtime" }]],
  ["Responses", [{ path: "v1/responses", programmaticEndpoint: "bedrock-mantle" }]],
  [
    "Chat Completions",
    [
      { path: "v1/chat/completions", programmaticEndpoint: "bedrock-runtime" },
      { path: "v1/chat/completions", programmaticEndpoint: "bedrock-mantle" },
    ],
  ],
  [
    "Messages",
    [
      { path: "model/{modelId}/invoke", programmaticEndpoint: "bedrock-runtime" },
      { path: "anthropic/v1/messages", programmaticEndpoint: "bedrock-mantle" },
    ],
  ],
  ["StartAsyncInvoke", [{ path: "async-invoke", programmaticEndpoint: "bedrock-runtime" }]],
  [
    "InvokeModelWithBidirectionalStream",
    [
      {
        path: "model/{modelId}/invoke-with-bidirectional-stream",
        programmaticEndpoint: "bedrock-runtime",
      },
    ],
  ],
]);
const inferenceIdColumns = new Map<DeploymentType, string>([
  ["geo", "Geo inference ID"],
  ["global", "Global inference ID"],
]);
const availabilityColumns = new Map<DeploymentType, string>([
  ["in-region", "In-Region"],
  ["geo", "Geo"],
  ["global", "Global"],
]);

const decimalSchema = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);

const priceListSchema = z.object({
  offerCode: z.enum(["AmazonBedrock", "AmazonBedrockFoundationModels", "AmazonBedrockService"]),
  products: z.record(
    z.string(),
    z.object({
      sku: z.string().min(1),
      attributes: z.record(z.string(), z.string()),
    }),
  ),
  terms: z.object({
    OnDemand: z.record(
      z.string(),
      z.record(
        z.string(),
        z.object({
          effectiveDate: z.string().optional(),
          priceDimensions: z.record(
            z.string(),
            z.object({
              description: z.string().min(1),
              unit: z.string().min(1),
              pricePerUnit: z.record(z.string(), decimalSchema),
            }),
          ),
        }),
      ),
    ),
  }),
});

const apiDateSchema = z.iso.datetime({ offset: true });
const apiModalitySchema = z.enum(["TEXT", "IMAGE", "EMBEDDING"]);
const customizationSchema = z.enum(["FINE_TUNING", "CONTINUED_PRE_TRAINING", "DISTILLATION"]);

const lifecycleSchema = z
  .object({
    status: z.enum(["ACTIVE", "LEGACY"]),
    startOfLifeTime: apiDateSchema.optional(),
    legacyTime: apiDateSchema.optional(),
    endOfLifeTime: apiDateSchema.optional(),
  })
  .optional();

const apiItemSchema = z.object({
  modelId: modelIdSchema,
  modelName: z.string().min(1).optional(),
  inputModalities: z.array(apiModalitySchema).optional(),
  outputModalities: z.array(apiModalitySchema).optional(),
  customizationsSupported: z.array(customizationSchema).optional(),
  responseStreamingSupported: z.boolean().optional(),
  modelLifecycle: lifecycleSchema,
});

const apiSchema = z.object({ modelSummaries: z.array(apiItemSchema).min(1) });

const months = new Map([
  ["jan", 1],
  ["january", 1],
  ["feb", 2],
  ["february", 2],
  ["mar", 3],
  ["march", 3],
  ["apr", 4],
  ["april", 4],
  ["may", 5],
  ["jun", 6],
  ["june", 6],
  ["jul", 7],
  ["july", 7],
  ["aug", 8],
  ["august", 8],
  ["sep", 9],
  ["sept", 9],
  ["september", 9],
  ["oct", 10],
  ["october", 10],
  ["nov", 11],
  ["november", 11],
  ["dec", 12],
  ["december", 12],
]);

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function section(body: string, heading: string): string | undefined {
  const start = body.indexOf(`## ${heading}`);
  if (start < 0) return undefined;
  const content = body.slice(start + heading.length + 3);
  const end = content.search(/\n## /);
  return end < 0 ? content : content.slice(0, end);
}

function plain(value: string): string {
  return value
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replaceAll("\\+", "+")
    .replace(/[*`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function fact(body: string, label: string): string | undefined {
  return body.match(new RegExp(`^\\+ \\*\\*${label}:\\*\\* ([^\\n]+)$`, "m"))?.[1]?.trim();
}

function humanDate(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = plain(value);
  const named = normalized.match(/^([A-Za-z]+)\s+(?:(\d{1,2}),?\s+)?(\d{4})$/);
  if (named !== null) {
    const month = months.get(named[1]?.toLowerCase() ?? "");
    const year = named[3];
    if (month === undefined || year === undefined) return undefined;
    const prefix = `${year}-${String(month).padStart(2, "0")}`;
    return named[2] === undefined ? prefix : `${prefix}-${named[2].padStart(2, "0")}`;
  }
  const numeric = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (numeric?.[1] === undefined || numeric[2] === undefined || numeric[3] === undefined)
    return undefined;
  return `${numeric[3]}-${numeric[1].padStart(2, "0")}-${numeric[2].padStart(2, "0")}`;
}

function apiDate(value: string | undefined): string | undefined {
  return value?.slice(0, 10);
}

function tokens(value: string | undefined): number | undefined {
  const match = value?.replaceAll(",", "").match(/^(\d+(?:\.\d+)?)\s*([KMB])?(?:\s*tokens?)?$/i);
  if (match?.[1] === undefined) return undefined;
  const suffix = match[2]?.toUpperCase();
  const multiplier =
    suffix === "K" ? 1_000 : suffix === "M" ? 1_000_000 : suffix === "B" ? 1_000_000_000 : 1;
  return Number(match[1]) * multiplier;
}

function markdownCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.replaceAll("**", "").replaceAll("`", "").trim());
}

function markdownTable(
  body: string,
  requiredHeaders: string[],
): { header: string[]; rows: string[][] } | undefined {
  const lines = body.split("\n");
  const headerIndex = lines.findIndex((line) => {
    const cells = markdownCells(line);
    return requiredHeaders.every((header) => cells.includes(header));
  });
  if (headerIndex < 0) return undefined;
  const rows: string[][] = [];
  for (const line of lines.slice(headerIndex + 2)) {
    if (!line.trim().startsWith("|")) break;
    rows.push(markdownCells(line));
  }
  return { header: markdownCells(lines[headerIndex] ?? ""), rows };
}

function tableLabel(cell: string): string | undefined {
  const value = cell.match(/\)\s*([^)]*?)\s*$/)?.[1]?.trim();
  return value === "" ? undefined : value;
}

function supported(cell: string): boolean {
  return cell.includes("icon-yes.png");
}

function supportedModality(cell: string): Modality | undefined {
  const label = tableLabel(cell);
  if (label === undefined) return undefined;
  const value = label === "Speech" ? "audio" : label.toLowerCase();
  const parsed = modalitySchema.safeParse(value);
  if (!parsed.success) throw new Error(`Unsupported Bedrock modality label: ${label}`);
  return supported(cell) ? parsed.data : undefined;
}

function cardTable(body: string): {
  modalities: ProviderModel["modalities"];
  apiEndpoints: BedrockApiEndpoint[];
  modelEndpoints: Set<BedrockModelEndpoint>;
} {
  const table = markdownTable(body, ["Input Modalities", "Output Modalities"]);
  if (table === undefined) throw new Error("Bedrock model card omitted its modality table");
  const { header } = table;
  const inputIndex = header.indexOf("Input Modalities");
  const outputIndex = header.indexOf("Output Modalities");
  const apiIndex = header.findIndex((cell) => cell.includes("APIs supported"));
  const endpointIndex = header.findIndex((cell) => cell.includes("Endpoints supported"));
  if (apiIndex < 0 || endpointIndex < 0)
    throw new Error("Bedrock model card omitted API or endpoint support");
  const input: Modality[] = [];
  const output: Modality[] = [];
  const apiEndpoints = new Map<string, BedrockApiEndpoint>();
  const modelEndpoints = new Set<BedrockModelEndpoint>();
  for (const cells of table.rows) {
    const inputValue = supportedModality(cells[inputIndex] ?? "");
    const outputValue = supportedModality(cells[outputIndex] ?? "");
    if (inputValue !== undefined) input.push(inputValue);
    if (outputValue !== undefined) output.push(outputValue);
    const apiLabel = tableLabel(cells[apiIndex] ?? "");
    if (apiLabel !== undefined) {
      const definitions = bedrockApiDefinitions.get(apiLabel);
      if (definitions === undefined) throw new Error(`Unsupported Bedrock API label: ${apiLabel}`);
      if (supported(cells[apiIndex] ?? ""))
        for (const definition of definitions) {
          const endpoint = { name: apiLabel, ...definition };
          apiEndpoints.set(
            `${apiEndpointKey(endpoint)}\0${endpoint.programmaticEndpoint}`,
            endpoint,
          );
        }
    }
    const endpointLabel = tableLabel(cells[endpointIndex] ?? "");
    if (endpointLabel !== undefined) {
      if (endpointLabel !== "bedrock-runtime" && endpointLabel !== "bedrock-mantle")
        throw new Error(`Unsupported Bedrock endpoint label: ${endpointLabel}`);
      if (supported(cells[endpointIndex] ?? "")) modelEndpoints.add(endpointLabel);
    }
  }
  if (modelEndpoints.size === 0)
    throw new Error("Bedrock model card contained no supported endpoint");
  if (/^#### \[\s*Rerank API\s*]$/m.test(body))
    apiEndpoints.set(apiEndpointKey(rerankApi), rerankApi);
  return {
    modalities: { input: unique(input), output: unique(output) },
    apiEndpoints: [...apiEndpoints.values()],
    modelEndpoints,
  };
}

function ids(cell: string): string[] {
  return unique(
    cell
      .replace(/<br\s*\/?>/gi, "\n")
      .split("\n")
      .map((value) => value.replace(/[`*]/g, "").trim())
      .filter(
        (value) =>
          value === value.toLowerCase() &&
          value.includes(".") &&
          modelIdSchema.safeParse(value).success,
      ),
  );
}

function programmaticAccess(body: string, name: string): Map<string, CardId> {
  const content = section(body, "Programmatic Access");
  if (content === undefined)
    throw new Error(`Bedrock model card omitted Programmatic Access for ${name}`);
  const table = markdownTable(content, ["Endpoint", "Model ID"]);
  if (table === undefined) throw new Error(`Bedrock model card omitted its ID table for ${name}`);
  const { header } = table;
  const endpointIndex = header.indexOf("Endpoint");
  const idIndex = header.indexOf("Model ID");
  const result = new Map<string, CardId>();
  for (const cells of table.rows) {
    const endpoint = cells[endpointIndex];
    if (endpoint !== "bedrock-runtime" && endpoint !== "bedrock-mantle") continue;
    const modelId = cells[idIndex];
    if (modelId === undefined || !modelIdSchema.safeParse(modelId).success) continue;
    const current = result.get(modelId) ?? {
      aliases: new Set<string>(),
      endpoints: new Set<BedrockModelEndpoint>(),
      deploymentTypes: new Set<DeploymentType>(["in-region"]),
    };
    current.endpoints.add(endpoint);
    for (const [deploymentType, heading] of inferenceIdColumns) {
      const index = header.indexOf(heading);
      if (index < 0) continue;
      const observedAliases = ids(cells[index] ?? "");
      if (observedAliases.length > 0) current.deploymentTypes.add(deploymentType);
      for (const alias of observedAliases) if (alias !== modelId) current.aliases.add(alias);
    }
    result.set(modelId, current);
  }
  if (result.size === 0)
    throw new Error(`Bedrock model card omitted official model IDs for ${name}`);
  return result;
}

function cardAvailability(body: string): BedrockAvailability[] {
  const content = section(body, "Regional Availability");
  if (content === undefined) throw new Error("Bedrock model card omitted Regional Availability");
  const table = markdownTable(content, ["Region", "In-Region", "Geo", "Global"]);
  if (table === undefined)
    throw new Error("Bedrock model card omitted its regional availability table");
  const { header } = table;
  const regionIndex = header.indexOf("Region");
  const availability: BedrockAvailability[] = [];
  for (const cells of table.rows) {
    const region = plain(cells[regionIndex] ?? "").match(/^([a-z]{2}(?:-[a-z0-9]+)+-\d)\b/)?.[1];
    if (region === undefined) throw new Error("Bedrock regional availability omitted a region");
    for (const [deploymentType, heading] of availabilityColumns)
      if (supported(cells[header.indexOf(heading)] ?? ""))
        availability.push({ region, deploymentType });
  }
  if (availability.length === 0)
    throw new Error("Bedrock model card contained no regional availability");
  return availability;
}

function mantleRegions(documents: z.infer<typeof linkedBundleSchema>["documents"]): Set<string> {
  const document = documents.find((item) => {
    const url = new URL(item.url);
    return (
      url.hostname === "docs.aws.amazon.com" &&
      url.pathname === "/bedrock/latest/userguide/bedrock-mantle.md"
    );
  });
  if (document === undefined) throw new Error("Bedrock catalog omitted Mantle regions");
  const content = section(document.body, "Supported Regions and Endpoints");
  if (content === undefined) throw new Error("Bedrock Mantle guide omitted supported regions");
  const table = markdownTable(content, ["Region", "Endpoint"]);
  if (table === undefined) throw new Error("Bedrock Mantle guide omitted its region table");
  const { header } = table;
  const regionIndex = header.indexOf("Region");
  const endpointIndex = header.indexOf("Endpoint");
  const regions = new Set<string>();
  for (const cells of table.rows) {
    const region = cells[regionIndex];
    if (
      region === undefined ||
      !/^[a-z]{2}(?:-[a-z0-9]+)+-\d$/.test(region) ||
      cells[endpointIndex] !== `bedrock-mantle.${region}.api.aws`
    )
      throw new Error("Invalid Bedrock Mantle region row");
    regions.add(region);
  }
  if (regions.size === 0) throw new Error("Bedrock Mantle guide contained no regions");
  return regions;
}

function identityKey(value: string, publisher = ""): string {
  const ignored = new Set([
    "amazon",
    "bedrock",
    "edition",
    "model",
    "instruct",
    "it",
    "pt",
    "chat",
    "input",
    "output",
  ]);
  const publisherTokens = new Set(
    publisher
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/),
  );
  const parts = value
    .replace(/\(Amazon Bedrock Edition\)/gi, "")
    .replace(/\\?\+/g, " plus ")
    .replace(/\b(\d+)\.0\b/g, "$1")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([a-z])([0-9])/gi, "$1 $2")
    .replace(/([0-9])([a-z])/gi, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((part) => (/^embeddings?$/.test(part) ? "embed" : part))
    .filter(
      (part) =>
        part !== "" &&
        part !== "v" &&
        part !== "g" &&
        !ignored.has(part) &&
        !publisherTokens.has(part),
    );
  return parts.sort().join(":");
}

function cardIdentityKeys(
  name: string,
  publisher: string,
  cardIds: Map<string, CardId>,
): Set<string> {
  return new Set(
    [
      identityKey(name, publisher),
      ...[...cardIds.keys()].flatMap((id) => [
        identityKey(id.replace(/:\d+$/, ""), publisher),
        identityKey(id.replace(/-v\d+:\d+$/i, ""), publisher),
      ]),
    ].filter((value) => value !== ""),
  );
}

function parseCard(body: string): Card {
  const name = plain(body.match(/^# ([^\n]+)$/m)?.[1] ?? "");
  if (name === "") throw new Error("Bedrock model card omitted its name");
  const publisher = plain(body.match(/^## .*\)\s*([^—\n]+?)\s+—\s+/m)?.[1] ?? "");
  const details = section(body, "Model Details");
  const description = details
    ?.split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "" && !line.startsWith("<a ") && !line.startsWith("+ "));
  const cardSupport = cardTable(body);
  const cardIds = programmaticAccess(body, name);
  const programmaticEndpoints = new Set(
    [...cardIds.values()].flatMap(({ endpoints }) => [...endpoints]),
  );
  if (
    programmaticEndpoints.size !== cardSupport.modelEndpoints.size ||
    [...programmaticEndpoints].some((endpoint) => !cardSupport.modelEndpoints.has(endpoint))
  )
    throw new Error(`Bedrock endpoint support disagreed with Programmatic Access for ${name}`);
  const lifecycle = fact(body, "Model lifecycle")?.toLowerCase();
  const status: ProviderModel["status"] = lifecycle?.startsWith("active")
    ? "active"
    : lifecycle?.startsWith("preview")
      ? "active"
      : lifecycle?.startsWith("legacy")
        ? "legacy"
        : "unknown";
  const releaseStage: ProviderModel["release_stage"] = lifecycle?.startsWith("preview")
    ? "preview"
    : "unknown";
  const eol = fact(body, "Model EOL date");
  const deprecatedAt = eol?.startsWith("Legacy:")
    ? humanDate(eol.slice("Legacy:".length).trim())
    : undefined;
  const retiredAt =
    eol === undefined ||
    eol === "N/A" ||
    eol.startsWith("No sooner than") ||
    deprecatedAt !== undefined
      ? undefined
      : humanDate(eol);
  const reasoning = fact(body, "Reasoning");
  const promptCache = /\*\*Prompt caching[^\n]*\*\*[\s\S]*?\n\| Yes \|/.test(
    section(body, "Capabilities and Features") ?? "",
  );
  const computerUse = /\*\*Computer use/.test(section(body, "Capabilities and Features") ?? "");
  const capabilities = {
    ...unknownCapabilities(),
    reasoning: reasoning?.startsWith("Supported") ? true : "unknown",
    prompt_cache: promptCache ? true : "unknown",
    effort_control: reasoning?.toLowerCase().includes("effort") ? true : "unknown",
    computer_use: computerUse ? true : "unknown",
  } satisfies ProviderModel["capabilities"];
  const limits: ProviderModel["limits"] = {};
  const context = tokens(fact(body, "Context window"));
  const output = tokens(fact(body, "Max output tokens"));
  if (context !== undefined) limits.context_tokens = context;
  if (output !== undefined) limits.max_output_tokens = output;
  const operations = classifyModelOperations({
    modelId: cardIds.keys().next().value ?? name,
    name,
    rawType: undefined,
    modalities: cardSupport.modalities,
    fallback: "text_generation",
  });
  return {
    name,
    publisher,
    description: description === undefined ? undefined : plain(description),
    ids: cardIds,
    modalities: cardSupport.modalities,
    apiEndpoints: cardSupport.apiEndpoints,
    availability: cardAvailability(body),
    capabilities,
    limits,
    releaseDate: humanDate(fact(body, "Model launch date")),
    deprecatedAt,
    retiredAt,
    status,
    releaseStage,
    operations,
    identityKeys: cardIdentityKeys(name, publisher, cardIds),
  };
}

function modelForProduct(cards: Card[], label: string, usage: string): Card | undefined {
  const displayMatches = cards.filter((card) => {
    const labelKey = identityKey(label, card.publisher);
    return labelKey !== "" && labelKey === identityKey(card.name, card.publisher);
  });
  if (displayMatches.length > 0) return displayMatches.length === 1 ? displayMatches[0] : undefined;
  const matches = cards.filter((card) => {
    const labelKey = identityKey(label, card.publisher);
    if (labelKey !== "" && card.identityKeys.has(labelKey)) return true;
    return [...card.ids].some(([id]) => {
      const stem = id.replace(/^[^.]+\./, "").replace(/-v\d+:\d+$/i, "");
      const value = stem.replace(/[^a-z0-9]+/gi, "[-._:]?");
      return (
        value.length >= 8 &&
        new RegExp(
          `(?:^|[-:_.])${value}(?:$|[-:_.](?:mantle|input|output|cache|provisioned|reserved|batch|priority|flex|standard|text|image|audio|video))`,
          "i",
        ).test(usage)
      );
    });
  });
  return matches.length === 1 ? matches[0] : undefined;
}

function meter(text: string, operations: ModelOperation[]): PriceRate["meter"] | undefined {
  if (/provisioned|reserved|model.?units|tokens per minute|tpm/.test(text))
    return "provisioned_throughput";
  if (/cache.?read/.test(text)) {
    if (/audio/.test(text)) return "cache_read_audio";
    if (/image/.test(text)) return "cache_read_image";
    return "cache_read_text";
  }
  if (/cache.?write/.test(text)) {
    if (/audio/.test(text)) return "cache_write_audio";
    if (/image/.test(text)) return "cache_write_image";
    return "cache_write_text";
  }
  if (operations.includes("reranking") && /search|rerank|request/.test(text))
    return "rerank_request";
  if (
    operations.includes("embeddings") &&
    /input|token|second|minute|image|request|page/.test(text)
  )
    return "embedding";
  if (operations.includes("image_generation") && /output image|created.?image|per image/.test(text))
    return "image_generation";
  if (/output.*video|video.*output/.test(text)) return "output_video";
  if (/input.*video|video.*input/.test(text)) return "input_video";
  if (/output.*image|image.*output/.test(text)) return "output_image";
  if (/input.*image|image.*input/.test(text)) return "input_image";
  if (/output.*audio|audio.*output/.test(text)) return "output_audio";
  if (/input.*audio|audio.*input|speech understanding input/.test(text)) return "input_audio";
  if (/text output/.test(text)) return "output_text";
  if (/text input/.test(text)) return "input_text";
  if (/rerank/.test(text)) return "rerank_request";
  if (/output|response/.test(text))
    return operations.includes("speech_synthesis") || operations.includes("speech_to_speech")
      ? "output_audio"
      : "output_text";
  if (/input|prompt/.test(text))
    return operations.includes("transcription") || operations.includes("speech_to_speech")
      ? "input_audio"
      : "input_text";
  if (operations.includes("image_generation") && /image/.test(text)) return "image_generation";
  if (operations.includes("video_generation") && /video|second/.test(text))
    return "video_generation";
}

function tier(attributes: Record<string, string>, text: string): string | undefined {
  const imageQuality = /(?:^|\s)(?:standard|premium)$/i.test(attributes.inferenceType ?? "");
  const value =
    `${attributes.service_tier ?? ""} ${attributes.feature ?? ""} ${imageQuality ? "" : text}`.toLowerCase();
  if (/provisioned.*6.?months?/.test(value)) return "provisioned_6_month";
  if (/provisioned.*1.?months?/.test(value)) return "provisioned_1_month";
  if (/provisioned.*no.?commit/.test(value)) return "provisioned_no_commit";
  if (/reserved[^a-z0-9]*3.?month|3.?month.*reserved/.test(value)) return "reserved_3_month";
  if (/reserved[^a-z0-9]*1.?month|1.?month.*reserved/.test(value)) return "reserved_1_month";
  if (/reserved/.test(value)) return "reserved";
  if (/latency.?optimized/.test(value)) return "latency_optimized";
  if (/batch/.test(value)) return "batch";
  if (/priority/.test(value)) return "priority";
  if (/flex/.test(value)) return "flex";
  if (/standard|on-demand/.test(value)) return "standard";
}

function conditions(
  attributes: Record<string, string>,
  text: string,
  effectiveDate: string | undefined,
  endpoint: string | undefined,
): PriceRate["conditions"] {
  const lower = text.toLowerCase();
  const deploymentScope = /cross-region-global|[_ -]global(?:[_ -]|$)/.test(lower)
    ? "global_cross_region"
    : /cross-region-geo|[_ -]geo(?:[_ -]|$)/.test(lower)
      ? "geo_cross_region"
      : "in_region";
  const serviceTier = tier(attributes, lower);
  const capacity = /input.*(?:tokens per minute|tpm)|inputtpm/.test(lower)
    ? "input_tokens_per_minute"
    : /output.*(?:tokens per minute|tpm)|outputtpm/.test(lower)
      ? "output_tokens_per_minute"
      : undefined;
  const modality = ["audio", "image", "video"].find((value) => lower.includes(value));
  const ttl = /cache.?write/.test(lower) ? (/1h|1 hour/.test(lower) ? 3_600 : 300) : undefined;
  const inference = attributes.inferenceType ?? "";
  const operation = inference.match(/\b(T2I|I2I|T2V|I2V)\b/i)?.[1]?.toUpperCase();
  const resolution =
    inference.match(/\b(512|1024|2048)\b/)?.[1] ??
    inference.match(/\b(SD|HD|FHD)\s+Resolution\b/i)?.[1]?.toUpperCase() ??
    attributes.imageresolution;
  const quality =
    inference.match(/\b(Standard|Premium)\b/i)?.[1]?.toLowerCase() ?? attributes.imagequality;
  return {
    region: attributes.regionCode,
    endpoint,
    deployment_scope: deploymentScope,
    service_tier: serviceTier,
    context_min_tokens: /long.?context/.test(lower) ? 200_001 : undefined,
    cache_ttl_seconds: ttl,
    capacity,
    modality,
    operation,
    resolution,
    quality,
    effective_from: effectiveDate?.slice(0, 10),
  };
}

function rate(
  offerCode: z.infer<typeof priceListSchema>["offerCode"],
  attributes: Record<string, string>,
  description: string,
  unit: string,
  price: string,
  effectiveDate: string | undefined,
  operations: ModelOperation[],
  sourceId: string,
): PriceRate | undefined {
  const usage = attributes.usagetype ?? "";
  const text =
    `${attributes.inferenceType ?? ""} ${attributes.feature ?? ""} ${usage} ${description}`.toLowerCase();
  if (/\bcustom\b|customization|training|storage/.test(text)) return undefined;
  const observedMeter = meter(text, operations);
  const endpoint =
    offerCode === "AmazonBedrockFoundationModels"
      ? undefined
      : usage.toLowerCase().includes("mantle")
        ? "bedrock-mantle"
        : "bedrock-runtime";
  const rateConditions = conditions(attributes, text, effectiveDate, endpoint);
  let normalizedUnit: PriceRate["unit"] | undefined;
  let normalizedPrice = price;
  let derived = false;
  if (unit === "1K tokens") {
    normalizedUnit = "million_tokens";
    normalizedPrice = scaleDecimal(price, 3);
    derived = true;
  } else if (unit === "1M tokens" || (unit === "Units" && /million .*tokens?/.test(text))) {
    normalizedUnit = "million_tokens";
  } else if (unit === "Units" && /search.?units?/.test(text)) {
    normalizedUnit = "search_unit";
  } else if (unit === "Units" && /seconds?/.test(text)) {
    normalizedUnit = "second";
  } else if (unit === "Units" && /image.*(?:count|output)|created.?image/.test(text)) {
    normalizedUnit = "image";
  } else if (unit === "Units" && /requests?/.test(text)) {
    normalizedUnit = "request";
  } else if (unit === "image" || /images processed/i.test(unit)) {
    normalizedUnit = "image";
  } else if (unit === "seconds" || unit === "Second") {
    normalizedUnit = "second";
  } else if (unit === "video") {
    normalizedUnit = "video";
  } else if (unit === "Minutes Processed") {
    normalizedUnit = "minute";
  } else if (unit === "Pages Processed") {
    normalizedUnit = "page";
  } else if (unit === "Requests") {
    normalizedUnit = "request";
  } else if (unit === "Per 1000 requests") {
    normalizedUnit = "thousand_requests";
  } else if (unit === "1K TPM Hour") {
    normalizedUnit = "thousand_tokens_per_minute_hour";
  } else if ((unit === "hour" || unit === "hours" || unit === "Units") && /hour/.test(text)) {
    normalizedUnit = "unit_hour";
  }
  const finalMeter =
    observedMeter ??
    (normalizedUnit === "image" && operations.includes("image_generation")
      ? "image_generation"
      : normalizedUnit === "second" || normalizedUnit === "video"
        ? "video_generation"
        : undefined);
  if (finalMeter === undefined || normalizedUnit === undefined) return undefined;
  return {
    meter: finalMeter,
    price: normalizedPrice,
    currency: "USD",
    unit: normalizedUnit,
    conditions: rateConditions,
    source_ref: sourceId,
    derived,
    derivation: derived ? "source price per 1K tokens × 1,000" : undefined,
    raw_price: price,
    raw_unit: unit,
  };
}

function addRate(rates: Map<string, PriceRate>, next: PriceRate, modelId: string): void {
  const key = `${next.meter}:${next.currency}:${next.unit}:${JSON.stringify(next.conditions)}`;
  const current = rates.get(key);
  if (current !== undefined && current.price !== next.price)
    throw new Error(
      `Bedrock price conflict for ${modelId}: ${current.price} and ${next.price} at ${key}`,
    );
  rates.set(key, next);
}

function parsePrices(
  documents: z.infer<typeof linkedBundleSchema>["documents"],
  cards: Card[],
  sourceId: string,
): Map<string, PriceRate[]> {
  const byId = new Map<string, Map<string, PriceRate>>();
  for (const document of documents) {
    if (new URL(document.url).hostname !== "pricing.us-east-1.amazonaws.com") continue;
    const list = priceListSchema.parse(JSON.parse(document.body));
    for (const [sku, product] of Object.entries(list.products)) {
      const attributes = product.attributes;
      const label =
        attributes.model ??
        attributes.titanModel ??
        attributes.titanModelUnit ??
        attributes.servicename;
      const usage = attributes.usagetype ?? "";
      if (label === undefined) continue;
      const card = modelForProduct(cards, label, usage);
      if (card === undefined) continue;
      const endpoint =
        list.offerCode === "AmazonBedrockFoundationModels"
          ? undefined
          : usage.toLowerCase().includes("mantle")
            ? "bedrock-mantle"
            : "bedrock-runtime";
      const targets = [...card.ids].filter(
        ([, value]) => endpoint === undefined || value.endpoints.has(endpoint),
      );
      if (targets.length === 0) continue;
      for (const term of Object.values(list.terms.OnDemand[sku] ?? {})) {
        for (const dimension of Object.values(term.priceDimensions)) {
          const price = dimension.pricePerUnit.USD;
          if (price === undefined) continue;
          const parsed = rate(
            list.offerCode,
            attributes,
            dimension.description,
            dimension.unit,
            price,
            term.effectiveDate,
            card.operations,
            sourceId,
          );
          if (parsed === undefined) continue;
          for (const [id] of targets) {
            const rates = byId.get(id) ?? new Map<string, PriceRate>();
            addRate(rates, parsed, id);
            byId.set(id, rates);
          }
        }
      }
    }
  }
  return new Map(
    [...byId].map(([id, rates]) => [
      id,
      [...rates.values()].sort((left, right) =>
        `${left.meter}:${JSON.stringify(left.conditions)}`.localeCompare(
          `${right.meter}:${JSON.stringify(right.conditions)}`,
        ),
      ),
    ]),
  );
}

export function parseBedrockCatalog(input: ParseInput): ProviderModel[] {
  const bundle = linkedBundleSchema.parse(JSON.parse(input.body));
  const supportedMantleRegions = mantleRegions(bundle.documents);
  const cards = bundle.documents
    .filter((document) => {
      const url = new URL(document.url);
      return (
        url.hostname === "docs.aws.amazon.com" &&
        /^\/bedrock\/latest\/userguide\/model-card-[a-z0-9-]+\.md$/.test(url.pathname)
      );
    })
    .map((document) => parseCard(document.body));
  if (cards.length === 0) throw new Error("Bedrock catalog contained no model cards");
  const prices = parsePrices(bundle.documents, cards, input.source.id);
  const models = new Map<string, ProviderModel>();
  for (const card of cards) {
    for (const [id, access] of card.ids) {
      const current = models.get(id);
      if (current !== undefined && current.name !== card.name)
        throw new Error(`Bedrock model ID ${id} has conflicting display names`);
      const pricing = prices.get(id) ?? [];
      const apiEndpoints = [
        ...new Map(
          card.apiEndpoints
            .filter(({ programmaticEndpoint }) => access.endpoints.has(programmaticEndpoint))
            .map(({ name, path }) => {
              const endpoint = { name, path };
              return [apiEndpointKey(endpoint), endpoint];
            }),
        ).values(),
      ].sort((left, right) => apiEndpointKey(left).localeCompare(apiEndpointKey(right)));
      const availability = card.availability
        .filter(({ deploymentType }) => access.deploymentTypes.has(deploymentType))
        .flatMap(({ region, deploymentType }) =>
          [...access.endpoints].flatMap((endpoint) =>
            endpoint === "bedrock-mantle" &&
            (deploymentType !== "in-region" || !supportedMantleRegions.has(region))
              ? []
              : [{ region, deployment_type: `${endpoint}/${deploymentType}` }],
          ),
        )
        .sort((left, right) =>
          `${left.deployment_type}\0${left.region}`.localeCompare(
            `${right.deployment_type}\0${right.region}`,
          ),
        );
      models.set(id, {
        ...baseModel({
          providerId: input.provider.id,
          id,
          name: card.name,
          sourceId: input.source.id,
          observedAt: input.observedAt,
        }),
        description: card.description,
        aliases: [...access.aliases].sort(),
        operations: card.operations,
        api_endpoints: apiEndpoints.length > 0 ? apiEndpoints : undefined,
        modalities: card.modalities,
        capabilities: {
          ...card.capabilities,
          batch: pricing.some((item) => item.conditions.service_tier === "batch")
            ? true
            : card.capabilities.batch,
        },
        limits: card.limits,
        release_date: card.releaseDate,
        deprecated_at: card.deprecatedAt,
        retired_at: card.retiredAt,
        status: card.status,
        release_stage: card.releaseStage,
        pricing_status: pricing.length > 0 ? "published" : "unknown",
        pricing,
        availability,
        scope: "regional_catalog",
      });
    }
  }
  return [...models.values()].sort((left, right) => left.uid.localeCompare(right.uid));
}

function apiModalities(values: z.infer<typeof apiModalitySchema>[] | undefined): Modality[] {
  return unique((values ?? []).map((value) => modalitySchema.parse(value.toLowerCase())));
}

export function parseBedrockApi(input: ParseInput): ProviderModel[] {
  const { modelSummaries } = apiSchema.parse(JSON.parse(input.body));
  return modelSummaries.map((item) => {
    const status: ProviderModel["status"] =
      item.modelLifecycle?.status === "ACTIVE"
        ? "active"
        : item.modelLifecycle?.status === "LEGACY"
          ? "legacy"
          : "unknown";
    return {
      ...baseModel({
        providerId: input.provider.id,
        id: item.modelId,
        name: item.modelName ?? item.modelId,
        sourceId: input.source.id,
        observedAt: input.observedAt,
      }),
      modalities: {
        input: apiModalities(item.inputModalities),
        output: apiModalities(item.outputModalities),
      },
      capabilities: {
        ...unknownCapabilities(),
        streaming: item.responseStreamingSupported ?? "unknown",
        fine_tuning:
          item.customizationsSupported === undefined
            ? "unknown"
            : item.customizationsSupported.includes("FINE_TUNING"),
      },
      release_date: apiDate(item.modelLifecycle?.startOfLifeTime),
      deprecated_at: apiDate(item.modelLifecycle?.legacyTime),
      retired_at: apiDate(item.modelLifecycle?.endOfLifeTime),
      status,
      scope: "regional_catalog",
    };
  });
}

export async function fetchBedrockInventory(region: string, maxBytes: number): Promise<string> {
  const client = new BedrockClient({ region, maxAttempts: 3 });
  try {
    const result = await client.send(new ListFoundationModelsCommand({}), {
      abortSignal: AbortSignal.timeout(20_000),
    });
    if (result.modelSummaries === undefined || result.modelSummaries.length === 0)
      throw new Error("Bedrock API returned an empty model list");
    const body = JSON.stringify({ modelSummaries: result.modelSummaries });
    if (Buffer.byteLength(body) > maxBytes) throw new Error("Bedrock API exceeded byte limit");
    return body;
  } finally {
    client.destroy();
  }
}
