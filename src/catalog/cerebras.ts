import { z } from "zod";
import { linkedBundleSchema } from "./bundle.ts";
import { modelIdSchema } from "./identity.ts";
import type { SourceManifest } from "./manifests.ts";
import { apiEndpointKey, baseModel } from "./model.ts";
import { publishedRate, scaleDecimal } from "./pricing.ts";
import {
  modalitySchema,
  type Modality,
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

const decimalSchema = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);
const publicItemSchema = z.object({
  id: modelIdSchema,
  object: z.literal("model"),
  created: z.number().int().nonnegative(),
  owned_by: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  hugging_face_id: z.string().min(1),
  pricing: z.object({ prompt: decimalSchema, completion: decimalSchema }),
  capabilities: z.object({
    streaming: z.boolean(),
    function_calling: z.boolean(),
    structured_outputs: z.boolean(),
    vision: z.boolean(),
    json_mode: z.boolean(),
    tools: z.boolean(),
    tool_choice: z.boolean(),
    parallel_tool_calls: z.boolean(),
    response_format: z.boolean(),
    reasoning: z.boolean(),
  }),
  supported_parameters: z.record(z.string(), z.boolean()),
  architecture: z.object({
    modality: z.string().min(1),
    tokenizer: z.string().min(1),
    instruct_type: z.string().min(1),
  }),
  limits: z.object({
    max_context_length: z.number().int().positive(),
    max_completion_tokens: z.number().int().positive(),
    requests_per_minute: z.number().int().positive().nullable(),
    tokens_per_minute: z.number().int().positive().nullable(),
  }),
  deprecated: z.boolean(),
  preview: z.boolean(),
  quantization: z.string().nullable(),
});
const publicSchema = z.object({
  object: z.literal("list"),
  data: z.array(publicItemSchema).min(1),
});
const inventorySchema = z.object({
  object: z.literal("list"),
  data: z
    .array(
      z.object({
        id: modelIdSchema,
        object: z.literal("model"),
        created: z.number().int().nonnegative(),
        owned_by: z.string().min(1),
      }),
    )
    .min(1),
});

type CerebrasExtractor =
  | "cerebras-public"
  | "cerebras-catalog"
  | "cerebras-lifecycle"
  | "cerebras-releases"
  | "cerebras-api";

type ApiEndpoint = NonNullable<ProviderModel["api_endpoints"]>[number];

const apiEndpoints = new Map<string, ApiEndpoint>([
  ["Chat Completions", { name: "Chat Completions", path: "v1/chat/completions" }],
  ["Completions", { name: "Completions", path: "v1/completions" }],
]);

function bounded(input: Input, kind: CerebrasExtractor, models: ProviderModel[]): ProviderModel[] {
  const extractor = input.source.extractor;
  if (extractor.kind !== kind) throw new Error(`Wrong ${kind} extractor`);
  if (models.length < extractor.minModels || models.length > extractor.maxModels)
    throw new Error(
      `Cerebras ${kind} model count ${models.length} outside ${extractor.minModels}-${extractor.maxModels}`,
    );
  if (new Set(models.map(({ model_id }) => model_id)).size !== models.length)
    throw new Error(`Cerebras ${kind} returned duplicate model IDs`);
  return models.sort((left, right) => left.model_id.localeCompare(right.model_id));
}

function scaledRate(
  meter: "input_text" | "output_text",
  price: string,
  sourceId: string,
): PriceRate {
  return {
    ...publishedRate(meter, scaleDecimal(price, 6), "million_tokens", sourceId, "token"),
    derived: true,
    derivation: "source price per token × 1,000,000",
    raw_price: price,
  };
}

function architectureInputs(value: string): Modality[] {
  const values = value.split("+").map((part) => (part === "vision" ? "image" : part));
  const parsed = values.map((part) => modalitySchema.safeParse(part));
  if (parsed.some((result) => !result.success))
    throw new Error(`Unknown Cerebras architecture modality: ${value}`);
  return parsed.flatMap((result) => (result.success ? [result.data] : []));
}

export function parseCerebrasPublic(input: Input): ProviderModel[] {
  const parsed = publicSchema.safeParse(JSON.parse(input.body));
  if (!parsed.success) throw new Error("Cerebras public model schema drift");
  const models = parsed.data.data.map((item): ProviderModel => {
    const modalities = architectureInputs(item.architecture.modality);
    if (modalities.includes("image") !== item.capabilities.vision)
      throw new Error(`Cerebras modality and vision flag disagree for ${item.id}`);
    if (item.capabilities.function_calling !== item.capabilities.tools)
      throw new Error(`Cerebras tool flags disagree for ${item.id}`);
    return {
      ...baseModel({
        providerId: input.provider.id,
        id: item.id,
        name: item.name,
        sourceId: input.source.id,
        observedAt: input.observedAt,
      }),
      description: item.description,
      operations: ["text_generation"],
      modalities: { input: modalities, output: ["text"] },
      capabilities: {
        ...unknownCapabilities(),
        reasoning: item.capabilities.reasoning,
        tool_call: item.capabilities.function_calling,
        structured_output: item.capabilities.structured_outputs,
        streaming: item.capabilities.streaming,
      },
      limits: {
        context_tokens: item.limits.max_context_length,
        max_output_tokens: item.limits.max_completion_tokens,
      },
      status: item.deprecated ? "deprecated" : "active",
      release_stage: item.preview ? "preview" : "stable",
      pricing_status: "derived",
      pricing: [
        scaledRate("input_text", item.pricing.prompt, input.source.id),
        scaledRate("output_text", item.pricing.completion, input.source.id),
      ],
    };
  });
  return bounded(input, "cerebras-public", models);
}

interface MarkdownTable {
  section: string;
  headers: string[];
  rows: string[][];
}

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
}

function tables(body: string): MarkdownTable[] {
  const lines = body.split(/\r?\n/);
  const result: MarkdownTable[] = [];
  let section = "";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const heading = line.match(/^##\s+(.+)$/)?.[1];
    if (heading !== undefined) section = heading.trim();
    const separator = lines[index + 1];
    if (!line.trim().startsWith("|") || separator === undefined) continue;
    const headers = cells(line);
    if (!cells(separator).every((cell) => /^:?-{3,}:?$/.test(cell))) continue;
    const rows: string[][] = [];
    index += 2;
    while ((lines[index] ?? "").trim().startsWith("|")) {
      rows.push(cells(lines[index] ?? ""));
      index += 1;
    }
    index -= 1;
    if (rows.some((row) => row.length !== headers.length))
      throw new Error("Cerebras Markdown table has inconsistent columns");
    result.push({ section, headers, rows });
  }
  return result;
}

function text(value: string): string {
  return value
    .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, "")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/\\([~*_])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function exactCode(value: string): string {
  const match = value.match(/^`([^`]+)`$/);
  if (match?.[1] === undefined)
    throw new Error(`Cerebras model cell is not an exact code ID: ${value}`);
  return modelIdSchema.parse(match[1]);
}

function englishDate(value: string): string {
  const months = new Map([
    ["January", "01"],
    ["February", "02"],
    ["March", "03"],
    ["April", "04"],
    ["May", "05"],
    ["June", "06"],
    ["July", "07"],
    ["August", "08"],
    ["September", "09"],
    ["October", "10"],
    ["November", "11"],
    ["December", "12"],
  ]);
  const match = value.match(/^([A-Z][a-z]+) (\d{1,2}), (\d{4})$/);
  const month = match?.[1] === undefined ? undefined : months.get(match[1]);
  if (month === undefined || match?.[2] === undefined || match[3] === undefined)
    throw new Error(`Invalid Cerebras date: ${value}`);
  return `${match[3]}-${month}-${match[2].padStart(2, "0")}`;
}

function scheduledDates(body: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of body.matchAll(
    /\*\*([^*]+)\*\* is scheduled for deprecation on ([A-Z][a-z]+ \d{1,2}, \d{4})\./g,
  )) {
    if (match[1] === undefined || match[2] === undefined) continue;
    const name = text(match[1]);
    const date = englishDate(match[2]);
    const current = result.get(name);
    if (current !== undefined && current !== date)
      throw new Error(`Cerebras scheduled dates disagree for ${name}`);
    result.set(name, date);
  }
  return result;
}

function objectBlock(body: string, name: string): string {
  const match = body.match(new RegExp(`${name}=\\{\\{([\\s\\S]*?)\\}\\}`));
  if (match?.[1] === undefined) throw new Error(`Cerebras model card omitted ${name}`);
  return match[1];
}

function arrayBlock(body: string, name: string): string[] {
  const match = body.match(new RegExp(`${name}=\\{\\[([\\s\\S]*?)\\]\\}`));
  if (match?.[1] === undefined) throw new Error(`Cerebras model card omitted ${name}`);
  return [...match[1].matchAll(/"([^"\n]+)"/g)].flatMap((item) =>
    item[1] === undefined ? [] : [item[1]],
  );
}

function modelEndpoints(body: string): ApiEndpoint[] {
  return arrayBlock(body, "endpoints")
    .map((name) => {
      const endpoint = apiEndpoints.get(name);
      if (endpoint === undefined) throw new Error(`Unsupported Cerebras model endpoint: ${name}`);
      return endpoint;
    })
    .sort((left, right) => apiEndpointKey(left).localeCompare(apiEndpointKey(right)));
}

function stringField(block: string, field: string): string[] {
  return [...block.matchAll(new RegExp(`\\b${field}:\\s*"([^"\\n]+)"`, "g"))].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

function arrayField(block: string, field: string): string[] {
  const match = block.match(new RegExp(`\\b${field}:\\s*\\[([^\\]]+)\\]`));
  if (match?.[1] === undefined) throw new Error(`Cerebras model card omitted ${field}`);
  return [...match[1].matchAll(/"([^"\n]+)"/g)].flatMap((item) =>
    item[1] === undefined ? [] : [item[1]],
  );
}

function tokenCount(value: string): number {
  const match = value.match(/^(\d+(?:\.\d+)?)\s*([kKmM])?\s*tokens?$/);
  if (match?.[1] === undefined) throw new Error(`Invalid Cerebras token count: ${value}`);
  const suffix = match[2]?.toLowerCase();
  const scale = suffix === "m" ? 1_000_000 : suffix === "k" ? 1_000 : 1;
  const result = Number(match[1]) * scale;
  if (!Number.isSafeInteger(result)) throw new Error(`Invalid Cerebras token count: ${value}`);
  return result;
}

function largestTokenCount(block: string): number {
  const counts = [
    ...new Set([...stringField(block, "freeTier"), ...stringField(block, "paidTiers")]),
  ]
    .filter((value) => value !== "N/A")
    .map(tokenCount);
  if (counts.length === 0) throw new Error("Cerebras model card omitted a token limit");
  return Math.max(...counts);
}

function cardPrice(body: string, field: "inputPrice" | "outputPrice"): string {
  const values = stringField(objectBlock(body, "pricing"), field);
  const value = values.length === 1 ? values[0] : undefined;
  const match = value?.match(/^\$((?:0|[1-9]\d*)(?:\.\d+)?)(?: \/ M tokens)?$/);
  if (
    match?.[1] === undefined ||
    (value?.endsWith(" / M tokens") !== true && !/>per million tokens<\/span>/.test(body))
  )
    throw new Error(`Invalid Cerebras model card ${field}`);
  return match[1];
}

function cardModalities(body: string, field: "inputFormats" | "outputFormats"): Modality[] {
  return arrayField(objectBlock(body, "inputOutput"), field).map((value) =>
    modalitySchema.parse(value.toLowerCase()),
  );
}

interface CatalogRow {
  id: string;
  name: string;
  releaseStage: "stable" | "preview";
}

function catalogRows(body: string): CatalogRow[] {
  return tables(body).flatMap((table) => {
    const releaseStage =
      table.section === "Production Models"
        ? "stable"
        : table.section === "Preview Models"
          ? "preview"
          : undefined;
    if (releaseStage === undefined) return [];
    const nameIndex = table.headers.indexOf("Model Name");
    const idIndex = table.headers.indexOf("Model ID");
    if (nameIndex < 0 || idIndex < 0) throw new Error("Cerebras model table schema drift");
    return table.rows.map((row) => {
      const rawName = row[nameIndex];
      const rawId = row[idIndex];
      if (rawName === undefined || rawId === undefined)
        throw new Error("Cerebras model table omitted a value");
      return { id: exactCode(rawId), name: text(rawName), releaseStage };
    });
  });
}

function catalogCard(
  input: Input,
  row: CatalogRow,
  body: string,
  cachePolicy: string,
  scheduled: Map<string, string>,
): ProviderModel {
  const id = body.match(/\bmodelId="([^"]+)"/)?.[1];
  const title = body.match(/^#\s+(.+)$/m)?.[1];
  const description = body.match(/^>\s+(.+)$/m)?.[1];
  if (id === undefined || title === undefined || description === undefined)
    throw new Error(`Cerebras model card schema drift for ${row.id}`);
  if (modelIdSchema.parse(id) !== row.id || text(title) !== row.name)
    throw new Error(`Cerebras model card disagrees with the catalog for ${row.id}`);
  const endpoints = modelEndpoints(body);
  if (endpoints.length === 0)
    throw new Error(`Cerebras model card omitted a generation endpoint for ${row.id}`);
  const features = new Set(arrayBlock(body, "features"));
  const inputPrice = cardPrice(body, "inputPrice");
  const rates: PriceRate[] = [
    publishedRate("input_text", inputPrice, "million_tokens", input.source.id, "million tokens"),
    publishedRate(
      "output_text",
      cardPrice(body, "outputPrice"),
      "million_tokens",
      input.source.id,
      "million tokens",
    ),
  ];
  if (features.has("Prompt Caching")) {
    if (
      !/Input tokens, whether served from the cache or processed fresh, are billed at the standard input token rate/.test(
        cachePolicy,
      )
    )
      throw new Error("Cerebras cache pricing policy changed");
    rates.push({
      ...publishedRate(
        "cache_read_text",
        inputPrice,
        "million_tokens",
        input.source.id,
        "standard input token rate",
      ),
      derived: true,
      derivation: "cached input is billed at the published standard input rate",
    });
  }
  const deprecatedAt = scheduled.get(row.name);
  const deprecated = deprecatedAt !== undefined && deprecatedAt <= input.observedAt.slice(0, 10);
  return {
    ...baseModel({
      providerId: input.provider.id,
      id: row.id,
      name: row.name,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    }),
    description: text(description),
    operations: ["text_generation"],
    api_endpoints: endpoints,
    modalities: {
      input: cardModalities(body, "inputFormats"),
      output: cardModalities(body, "outputFormats"),
    },
    capabilities: {
      ...unknownCapabilities(),
      reasoning: features.has("Reasoning"),
      tool_call: features.has("Tool Calling"),
      structured_output: features.has("Structured Outputs"),
      streaming: features.has("Streaming"),
      prompt_cache: features.has("Prompt Caching"),
    },
    limits: {
      context_tokens: largestTokenCount(objectBlock(body, "contextLength")),
      max_output_tokens: largestTokenCount(objectBlock(body, "maxOutput")),
    },
    deprecated_at: deprecatedAt,
    status: deprecated ? "deprecated" : "active",
    release_stage: row.releaseStage,
    pricing_status: rates.some(({ derived }) => derived) ? "derived" : "published",
    pricing: rates,
  };
}

function document(bundle: z.infer<typeof linkedBundleSchema>, suffix: string): string {
  const item = bundle.documents.find(({ url }) => new URL(url).pathname.endsWith(suffix));
  if (item === undefined) throw new Error(`Cerebras catalog omitted ${suffix}`);
  return item.body;
}

function validateApiReferences(bundle: z.infer<typeof linkedBundleSchema>): void {
  const chat = document(bundle, "/api-reference/chat-completions.md");
  if (
    !/^# Chat Completions$/m.test(chat) ||
    !/^\s*\/v1\/chat\/completions:\s*$/m.test(chat) ||
    !/^\s*operationId: createChatCompletion\s*$/m.test(chat)
  )
    throw new Error("Cerebras Chat Completions API reference drift");
  const completions = document(bundle, "/api-reference/completions.md");
  if (
    !/^# Completions$/m.test(completions) ||
    !/^\s*curl -X POST https:\/\/api\.cerebras\.ai\/v1\/completions(?:\s+\\)?\s*$/m.test(
      completions,
    )
  )
    throw new Error("Cerebras Completions API reference drift");
}

export function parseCerebrasCatalog(input: Input): ProviderModel[] {
  const bundle = linkedBundleSchema.parse(JSON.parse(input.body));
  validateApiReferences(bundle);
  const rows = catalogRows(bundle.index.body);
  const cardEntries = bundle.documents.flatMap((item) => {
    const pathname = new URL(item.url).pathname.replace(/\.md$/, "");
    if (!pathname.startsWith("/models/")) return [];
    const id = item.body.match(/\bmodelId="([^"]+)"/)?.[1];
    if (id === undefined) throw new Error(`Cerebras model page ${pathname} omitted its Model ID`);
    return [[modelIdSchema.parse(id), item.body] as const];
  });
  const cards = new Map(cardEntries);
  if (cards.size !== cardEntries.length)
    throw new Error("Cerebras model pages returned duplicate model IDs");
  if (cards.size !== rows.length)
    throw new Error("Cerebras model-page count disagrees with catalog");
  const cachePolicy = document(bundle, "/capabilities/prompt-caching.md");
  const scheduled = scheduledDates([bundle.index.body, ...cards.values()].join("\n"));
  const models = rows.map((row) => {
    const card = cards.get(row.id);
    if (card === undefined) throw new Error(`Cerebras catalog omitted model page for ${row.id}`);
    return catalogCard(input, row, card, cachePolicy, scheduled);
  });
  return bounded(input, "cerebras-catalog", models);
}

interface Update {
  date: string;
  body: string;
}

function updates(body: string): Update[] {
  return [...body.matchAll(/<Update label="(\d{4}-\d{2}-\d{2})">([\s\S]*?)<\/Update>/g)].flatMap(
    (match) =>
      match[1] === undefined || match[2] === undefined ? [] : [{ date: match[1], body: match[2] }],
  );
}

function deprecatedIds(body: string): string[] {
  const heading = body.match(/\*\*Deprecated ([^*]+)\*\*/)?.[1];
  if (heading !== undefined)
    return [...heading.matchAll(/`([^`]+)`/g)].flatMap((match) =>
      match[1] === undefined ? [] : [modelIdSchema.parse(match[1])],
    );
  const sentence = body.match(/The `([^`]+)` model has been deprecated\./)?.[1];
  return sentence === undefined ? [] : [modelIdSchema.parse(sentence)];
}

export function parseCerebrasLifecycle(input: Input): ProviderModel[] {
  const models = updates(input.body).flatMap((update): ProviderModel[] => {
    const ids = deprecatedIds(update.body);
    if (ids.length === 0) return [];
    const recommendation = update.body.match(/We recommend[\s\S]*?(?:\n\n|$)/)?.[0] ?? "";
    const replacements = [...recommendation.matchAll(/`([^`]+)`/g)].flatMap((match) => {
      const parsed = modelIdSchema.safeParse(match[1]);
      return parsed.success && !ids.includes(parsed.data) ? [parsed.data] : [];
    });
    return ids.map(
      (id): ProviderModel => ({
        ...baseModel({
          providerId: input.provider.id,
          id,
          name: id,
          sourceId: input.source.id,
          observedAt: input.observedAt,
        }),
        operations: ["text_generation"],
        modalities: { input: ["text"], output: ["text"] },
        deprecated_at: update.date,
        status: "deprecated",
        replacement_model_ids: replacements,
      }),
    );
  });
  return bounded(input, "cerebras-lifecycle", models);
}

function releaseIds(body: string): string[] {
  const ids = [
    ...body.matchAll(/Added (?:(?:preview|production) )?support for [^:\n]{1,160}:\s*`([^`]+)`/gi),
    ...body.matchAll(/\(`([^`]+)`\) is now available in preview/gi),
  ].flatMap((match) => (match[1] === undefined ? [] : [modelIdSchema.parse(match[1])]));
  if (/\*\*Support for [^*\n]+\*\*/.test(body)) {
    const codes = [...body.matchAll(/`([^`]+)`/g)].flatMap((match) => {
      const parsed = modelIdSchema.safeParse(match[1]);
      return parsed.success ? [parsed.data] : [];
    });
    if (codes.length !== 1) throw new Error("Cerebras model-support release has ambiguous IDs");
    ids.push(...codes);
  }
  return [...new Set(ids)];
}

export function parseCerebrasReleases(input: Input): ProviderModel[] {
  const dates = new Map<string, string>();
  for (const update of updates(input.body))
    for (const id of releaseIds(update.body)) {
      const current = dates.get(id);
      dates.set(id, current === undefined || update.date < current ? update.date : current);
    }
  const models = [...dates].map(
    ([id, date]): ProviderModel => ({
      ...baseModel({
        providerId: input.provider.id,
        id,
        name: id,
        sourceId: input.source.id,
        observedAt: input.observedAt,
      }),
      operations: ["text_generation"],
      release_date: date,
    }),
  );
  return bounded(input, "cerebras-releases", models);
}

export function parseCerebrasApi(input: Input): ProviderModel[] {
  const parsed = inventorySchema.safeParse(JSON.parse(input.body));
  if (!parsed.success) throw new Error("Cerebras API model schema drift");
  const models = parsed.data.data.map(
    (item): ProviderModel => ({
      ...baseModel({
        providerId: input.provider.id,
        id: item.id,
        name: item.id,
        sourceId: input.source.id,
        observedAt: input.observedAt,
      }),
      operations: ["text_generation"],
    }),
  );
  return bounded(input, "cerebras-api", models);
}
