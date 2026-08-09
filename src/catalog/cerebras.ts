import { z } from "zod";
import { linkedBundleSchema } from "./bundle.ts";
import { modelIdSchema } from "./identity.ts";
import type { SourceManifest } from "./manifests.ts";
import { apiEndpointKey, baseModel } from "./model.ts";
import { decimalsEqual, publishedRate, scaleDecimal } from "./pricing.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import type { ParsedProviderModel as ProviderModel, SourcePriceFact } from "./pricing-source.ts";
import { assertItemCount, recognizeItems, type SourceContractEvidence } from "./source-contract.ts";
import { modalitySchema, type Modality, type Provider, unknownCapabilities } from "./schema.ts";

interface Input {
  provider: Provider;
  source: SourceManifest;
  body: string;
  observedAt: string;
  onContractFinding?: (evidence: SourceContractEvidence) => void;
  onPricingReconciliation?: (item: PricingReconciliationItem) => void;
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
  pricing: z.strictObject({ prompt: decimalSchema, completion: decimalSchema }),
  capabilities: z.strictObject({
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
  architecture: z.strictObject({
    modality: z.string().min(1),
    tokenizer: z.string().min(1),
    instruct_type: z.string().min(1),
  }),
  limits: z.strictObject({
    max_context_length: z.number().int().positive(),
    max_completion_tokens: z.number().int().positive(),
    requests_per_minute: z.number().int().positive().nullable(),
    tokens_per_minute: z.number().int().positive().nullable(),
  }),
  datacenter_locations: z.array(z.string().min(1)).optional(),
  deprecated: z.boolean(),
  preview: z.boolean(),
  quantization: z.string().nullable(),
});
const publicSchema = z.strictObject({
  object: z.literal("list"),
  data: z.array(z.unknown()).min(1),
});
const openRouterFeatureSchema = z.enum(["tools", "json_mode", "structured_outputs", "reasoning"]);
const openRouterItemSchema = z.strictObject({
  id: modelIdSchema,
  hugging_face_id: z.string().min(1),
  name: z.string().min(1),
  created: z.number().int().nonnegative(),
  input_modalities: z.array(modalitySchema).min(1),
  output_modalities: z.array(modalitySchema).min(1),
  quantization: z.string().min(1).nullable(),
  context_length: z.number().int().positive(),
  max_output_length: z.number().int().positive(),
  pricing: z.strictObject({
    prompt: decimalSchema,
    completion: decimalSchema,
    request: z.literal("0"),
    image: z.literal("0"),
    input_cache_read: z.literal("0"),
    input_cache_write: z.literal("0"),
  }),
  supported_sampling_parameters: z.array(z.string().min(1)),
  supported_features: z.array(openRouterFeatureSchema),
  description: z.string().min(1),
  openrouter: z.strictObject({ slug: z.string().min(1) }),
  datacenters: z.array(z.string().min(1)),
});
const openRouterSchema = z.strictObject({ data: z.array(openRouterItemSchema).min(1) });
const huggingFaceItemSchema = z.strictObject({
  id: modelIdSchema,
  hugging_face_id: z.string().min(1),
  object: z.literal("model"),
  created: z.number().int().nonnegative(),
  owned_by: z.string().min(1),
  context_length: z.number().int().positive(),
  pricing: z.strictObject({
    input: z.number().nonnegative(),
    output: z.number().nonnegative(),
  }),
  capabilities: z.strictObject({
    streaming: z.boolean(),
    function_calling: z.boolean(),
    structured_outputs: z.boolean(),
    vision: z.boolean(),
  }),
});
const huggingFaceSchema = z.strictObject({
  object: z.literal("list"),
  data: z.array(huggingFaceItemSchema).min(1),
});
const inventoryItemSchema = z.object({
  id: modelIdSchema,
  object: z.literal("model"),
  created: z.number().int().nonnegative(),
  owned_by: z.string().min(1),
});
const inventorySchema = z.strictObject({
  object: z.literal("list"),
  data: z.array(z.unknown()).min(1),
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
  assertItemCount(`Cerebras ${kind}`, models.length, extractor.minModels, extractor.maxModels);
  if (new Set(models.map(({ model_id }) => model_id)).size !== models.length)
    throw new Error(`Cerebras ${kind} returned duplicate model IDs`);
  return models.sort((left, right) => left.model_id.localeCompare(right.model_id));
}

function scaledRate(
  meter: "input_text" | "output_text",
  price: string,
  sourceId: string,
): SourcePriceFact {
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

function bundleDocument(
  bundle: z.infer<typeof linkedBundleSchema>,
  label: string,
  predicate: (url: URL) => boolean,
): string {
  const matches = bundle.documents.filter(({ url }) => predicate(new URL(url)));
  const [item] = matches;
  if (matches.length !== 1 || item === undefined)
    throw new Error(`Cerebras source bundle omitted or duplicated ${label}`);
  return item.body;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  const sorted = (values: readonly string[]): string[] => [...values].sort();
  return JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));
}

function assertPublicFormatContract(body: string): void {
  const normalized = body.replace(/\s+/g, " ");
  const claims = [
    /endpoint supports three response formats via the `format` query parameter/i,
    /Default \(Cerebras\).*OpenRouter.*HuggingFace/i,
    /Options: `openrouter`, `huggingface`/,
    /Pricing per token in USD/,
    /Cost per cached input token read \(typically `"0"`\)/,
    /Pricing in USD per million tokens/,
  ];
  if (claims.some((claim) => !claim.test(normalized)))
    throw new Error("Cerebras public-model format contract drift");
}

function formatEvidence(input: Input, models: readonly ProviderModel[], reasonCode: string): void {
  for (const model of models)
    for (const meter of ["input_text", "output_text"] as const)
      input.onPricingReconciliation?.({
        disposition: "normalized",
        reason_code: reasonCode,
        sample: `${model.model_id}:${meter}`,
      });
}

export function parseCerebrasPublic(input: Input): ProviderModel[] {
  const bundle = linkedBundleSchema.parse(JSON.parse(input.body));
  const list = publicSchema.parse(JSON.parse(bundle.index.body));
  const items = recognizeItems({
    label: "Cerebras public model",
    items: list.data,
    schema: publicItemSchema,
    modelId: "id",
    rootKeys: Object.keys(publicItemSchema.shape),
    ...(input.onContractFinding === undefined ? {} : { onFinding: input.onContractFinding }),
  });
  const models = items.map((item): ProviderModel => {
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
      tasks: ["text_generation"],
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
      pricing_state: "numeric",
      price_facts: [
        scaledRate("input_text", item.pricing.prompt, input.source.id),
        scaledRate("output_text", item.pricing.completion, input.source.id),
      ],
    };
  });
  const result = bounded(input, "cerebras-public", models);
  const openRouter = openRouterSchema.parse(
    JSON.parse(
      bundleDocument(
        bundle,
        "OpenRouter compatibility response",
        (url) => url.searchParams.get("format") === "openrouter",
      ),
    ),
  ).data;
  const huggingFace = huggingFaceSchema.parse(
    JSON.parse(
      bundleDocument(
        bundle,
        "HuggingFace compatibility response",
        (url) => url.searchParams.get("format") === "huggingface",
      ),
    ),
  ).data;
  assertPublicFormatContract(
    bundleDocument(bundle, "public-model format contract", (url) =>
      url.pathname.endsWith("/api-reference/models/public-models.md"),
    ),
  );
  const ids = result.map(({ model_id }) => model_id);
  if (
    !sameStrings(
      ids,
      openRouter.map(({ id }) => id),
    ) ||
    !sameStrings(
      ids,
      huggingFace.map(({ id }) => id),
    )
  )
    throw new Error("Cerebras public-model formats disagree on exact model IDs");
  const nativeById = new Map(items.map((item) => [item.id, item]));
  const openRouterById = new Map(openRouter.map((item) => [item.id, item]));
  const huggingFaceById = new Map(huggingFace.map((item) => [item.id, item]));
  for (const id of ids) {
    const native = nativeById.get(id);
    const router = openRouterById.get(id);
    const hub = huggingFaceById.get(id);
    if (native === undefined || router === undefined || hub === undefined)
      throw new Error(`Cerebras public-model format omitted ${id}`);
    const nativeInputs = architectureInputs(native.architecture.modality);
    const routerFeatures = new Set(router.supported_features);
    if (
      native.hugging_face_id !== router.hugging_face_id ||
      native.hugging_face_id !== hub.hugging_face_id ||
      native.name !== router.name ||
      native.description !== router.description ||
      native.created !== router.created ||
      native.created !== hub.created ||
      native.owned_by !== hub.owned_by ||
      native.limits.max_context_length !== router.context_length ||
      native.limits.max_context_length !== hub.context_length ||
      native.limits.max_completion_tokens !== router.max_output_length ||
      !sameStrings(nativeInputs, router.input_modalities) ||
      !sameStrings(["text"], router.output_modalities) ||
      !sameStrings(native.datacenter_locations ?? [], router.datacenters) ||
      !decimalsEqual(native.pricing.prompt, router.pricing.prompt) ||
      !decimalsEqual(native.pricing.completion, router.pricing.completion) ||
      !decimalsEqual(scaleDecimal(native.pricing.prompt, 6), String(hub.pricing.input)) ||
      !decimalsEqual(scaleDecimal(native.pricing.completion, 6), String(hub.pricing.output)) ||
      native.capabilities.function_calling !== routerFeatures.has("tools") ||
      native.capabilities.json_mode !== routerFeatures.has("json_mode") ||
      native.capabilities.structured_outputs !== routerFeatures.has("structured_outputs") ||
      native.capabilities.reasoning !== routerFeatures.has("reasoning") ||
      native.capabilities.streaming !== hub.capabilities.streaming ||
      native.capabilities.function_calling !== hub.capabilities.function_calling ||
      native.capabilities.structured_outputs !== hub.capabilities.structured_outputs ||
      native.capabilities.vision !== hub.capabilities.vision
    )
      throw new Error(`Cerebras public-model formats disagree for ${id}`);
  }
  reconcileRates(input, result);
  formatEvidence(input, result, "openrouter_format_rate_corroborated");
  formatEvidence(input, result, "huggingface_format_rate_corroborated");
  return result;
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
  path: string;
  releaseStage: "stable" | "preview";
}

function modelLink(value: string): { name: string; path: string } {
  const match = value.match(/^\[([^\]]+)]\((\/models\/[a-z0-9-]+)\)$/);
  if (match?.[1] === undefined || match[2] === undefined)
    throw new Error(`Cerebras model cell is not an exact model link: ${value}`);
  return {
    name: text(match[1]),
    path: match[2],
  };
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
      return { id: exactCode(rawId), ...modelLink(rawName), releaseStage };
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
  const rates: SourcePriceFact[] = [
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
    tasks: ["text_generation"],
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
      effort_control: /\breasoning_effort\b/.test(body) ? true : "unknown",
    },
    limits: {
      context_tokens: largestTokenCount(objectBlock(body, "contextLength")),
      max_output_tokens: largestTokenCount(objectBlock(body, "maxOutput")),
    },
    deprecated_at: deprecatedAt,
    status: deprecated ? "deprecated" : "active",
    release_stage: row.releaseStage,
    pricing_state: "numeric",
    price_facts: rates,
  };
}

function document(bundle: z.infer<typeof linkedBundleSchema>, suffix: string): string {
  const matches = bundle.documents.filter(({ url }) => new URL(url).pathname.endsWith(suffix));
  const [item] = matches;
  if (matches.length !== 1 || item === undefined)
    throw new Error(`Cerebras source bundle omitted or duplicated ${suffix}`);
  return item.body;
}

function requireClaims(
  bundle: z.infer<typeof linkedBundleSchema>,
  suffix: string,
  claims: readonly RegExp[],
  label: string,
): string {
  const body = document(bundle, suffix);
  const normalized = body.replace(/\\([_$*])/g, "$1").replace(/\s+/g, " ");
  if (claims.some((claim) => !claim.test(normalized)))
    throw new Error(`Cerebras ${label} contract drift`);
  return body;
}

const commercialPaths = new Set([
  "/api-reference/chat-completions",
  "/api-reference/completions",
  "/api-reference/metrics/retrieve-metrics",
  "/api-reference/models/public-models",
  "/capabilities/batch",
  "/capabilities/image-inputs",
  "/capabilities/metrics",
  "/capabilities/prompt-caching",
  "/capabilities/reasoning",
  "/capabilities/service-tiers",
  "/capabilities/tool-use",
  "/console/account-billing",
  "/console/overview",
  "/console/projects",
  "/console/usage-monitoring",
  "/dedicated/overview",
  "/dedicated/predicted-outputs",
  "/integrations/aws-marketplace",
  "/support/pricing",
  "/support/rate-limits",
]);
const nonBillingCommercialMentions = new Set(["/integrations/foundry"]);

function commercialIndexEntry(path: string, line: string): boolean {
  const normalized = path.replace(/\.md$/, "");
  if (commercialPaths.has(normalized)) return true;
  if (nonBillingCommercialMentions.has(normalized)) return false;
  return /\b(?:billing|costs?|credits?|meters?|pricing|spend|subscriptions?|usage)\b/i.test(line);
}

function validateCommercialIndex(bundle: z.infer<typeof linkedBundleSchema>): void {
  const body = document(bundle, "/llms.txt");
  const indexed = new Set(
    [...body.matchAll(/^- \[[^\]]+\]\((https?:\/\/[^)]+)\).*$/gm)].flatMap((match) => {
      const href = match[1];
      const line = match[0];
      if (href === undefined || line === undefined) return [];
      const url = new URL(href);
      return url.origin === "https://inference-docs.cerebras.ai" &&
        commercialIndexEntry(url.pathname, line)
        ? [url.pathname.replace(/\.md$/, "")]
        : [];
    }),
  );
  if (indexed.size === 0) throw new Error("Cerebras documentation index omitted commercial pages");
  const selected = new Set(
    [bundle.index, ...bundle.documents].map(({ url }) =>
      new URL(url).pathname.replace(/\.md$/, ""),
    ),
  );
  const missing = [...indexed].filter((path) => !selected.has(path)).sort();
  if (missing.length > 0)
    throw new Error(
      `Cerebras documentation index has unreviewed commercial pages: ${missing.join(", ")}`,
    );
}

interface PagePrice {
  label: string;
  input: string;
  output: string;
}

function pricePageRows(body: string): PagePrice[] {
  const decoded = body.replaceAll('\\"', '"');
  const rows = [
    ...decoded.matchAll(
      /"cells":\["([^"]+)","[^"]+","\$\$((?:0|[1-9]\d*)(?:\.\d+)?)\/M tokens","\$\$((?:0|[1-9]\d*)(?:\.\d+)?)\/M tokens"\]/g,
    ),
  ].flatMap((match) =>
    match[1] === undefined || match[2] === undefined || match[3] === undefined
      ? []
      : [{ label: match[1], input: match[2], output: match[3] }],
  );
  if (rows.length === 0) throw new Error("Cerebras pricing page omitted model price rows");
  return rows;
}

function identity(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

type TextMeter = "input_text" | "output_text";

function observedRateEvidence(
  model: ProviderModel,
  meter: TextMeter,
  observed: string,
  source: "model_card_prose" | "pricing_page",
): PricingReconciliationItem {
  const normalized = model.price_facts.find((rate) => rate.meter === meter)?.price;
  if (normalized === undefined)
    throw new Error(`Cerebras ${source} model omitted ${meter}: ${model.model_id}`);
  const corroborated = decimalsEqual(normalized, observed);
  return {
    disposition: corroborated ? "normalized" : "unbound",
    reason_code: `${source}_rate_${corroborated ? "corroborated" : "conflict"}`,
    sample: `${model.model_id}:${meter}`,
  };
}

function cardProseEvidence(body: string, model: ProviderModel): PricingReconciliationItem[] {
  const matches = [
    ...body.matchAll(
      /\bPricing:\s*\$((?:0|[1-9]\d*)(?:\.\d+)?) per million input tokens,\s*\$((?:0|[1-9]\d*)(?:\.\d+)?) per million output tokens\./g,
    ),
  ];
  const [match] = matches;
  if (matches.length !== 1 || match?.[1] === undefined || match[2] === undefined)
    throw new Error(`Cerebras model card prose pricing drift for ${model.model_id}`);
  return [
    observedRateEvidence(model, "input_text", match[1], "model_card_prose"),
    observedRateEvidence(model, "output_text", match[2], "model_card_prose"),
  ];
}

function pricePageEvidence(body: string, models: ProviderModel[]): PricingReconciliationItem[] {
  if (
    !/Get started with \$5 in free credits after making an account/.test(body) ||
    !/Self-serve payment starting at just \$10/.test(body) ||
    !/10x higher rate limits than free tier/.test(body) ||
    !/Developer Tier Pricing/.test(body)
  )
    throw new Error("Cerebras pricing-plan contract drift");
  const rows = pricePageRows(body);
  if (rows.length !== models.length) throw new Error("Cerebras pricing-page model count drift");
  const evidence: PricingReconciliationItem[] = [];
  for (const row of rows) {
    const matches = models.filter(({ model_id }) =>
      identity(row.label).includes(identity(model_id)),
    );
    const [model] = matches;
    if (matches.length !== 1 || model === undefined)
      throw new Error(`Cerebras pricing-page identity drift: ${row.label}`);
    evidence.push(
      observedRateEvidence(model, "input_text", row.input, "pricing_page"),
      observedRateEvidence(model, "output_text", row.output, "pricing_page"),
    );
  }
  return evidence;
}

function commercialEvidence(
  bundle: z.infer<typeof linkedBundleSchema>,
  models: ProviderModel[],
): PricingReconciliationItem[] {
  validateCommercialIndex(bundle);
  requireClaims(
    bundle,
    "/api-reference/chat-completions.md",
    [
      /prompt_tokens:/,
      /completion_tokens:/,
      /total_tokens:/,
      /image_tokens:/,
      /cached_tokens:/,
      /reasoning_tokens:/,
      /rejected_prediction_tokens:/,
      /service_tier_used:/,
      /object: chat\.completion\.chunk[\s\S]*?usage:/,
    ],
    "Chat usage",
  );
  requireClaims(
    bundle,
    "/api-reference/completions.md",
    [/prompt_tokens/, /completion_tokens/, /total_tokens/, /cached_tokens/],
    "Completions usage",
  );
  requireClaims(
    bundle,
    "/api-reference/models/public-models.md",
    [
      /Pricing per token in USD/,
      /Cost per prompt token/,
      /Cost per completion token/,
      /input_cache_read/,
      /typically `"0"`/,
    ],
    "public-model pricing schema",
  );
  requireClaims(
    bundle,
    "/capabilities/prompt-caching.md",
    [
      /automatically enabled for all users/,
      /usage\.prompt_tokens_details\.cached_tokens/,
      /billed at the standard input token rate/,
      /does not (?:affect|change) billing/,
    ],
    "cache accounting",
  );
  requireClaims(
    bundle,
    "/capabilities/service-tiers.md",
    [/service_tier/, /service_tier_used/, /all service tiers are billed equally/],
    "service-tier pricing",
  );
  requireClaims(
    bundle,
    "/capabilities/image-inputs.md",
    [/usage\.image_tokens/, /prompt_tokens` includes text tokens, image tokens/],
    "image-token accounting",
  );
  requireClaims(
    bundle,
    "/capabilities/reasoning.md",
    [/reasoning tokens are still generated and counted toward total\s+completion tokens/i],
    "reasoning-token accounting",
  );
  requireClaims(
    bundle,
    "/dedicated/predicted-outputs.md",
    [
      /rejected_prediction_tokens/,
      /billed at the output token\s+rate/,
      /dedicated endpoints are not affected by rejected-token pricing/,
    ],
    "predicted-output accounting",
  );
  requireClaims(
    bundle,
    "/capabilities/tool-use.md",
    [/client application receives the model's tool call request, executes the specified tool/i],
    "tool-execution",
  );
  requireClaims(
    bundle,
    "/capabilities/batch.md",
    [
      /Private Preview/,
      /only charged for requests that completed/i,
      /prompt_tokens/,
      /completion_tokens/,
    ],
    "Batch accounting",
  );
  requireClaims(
    bundle,
    "/console/account-billing.md",
    [
      /\$5 in free credits/,
      /Credits expire 30 days/,
      /credit grant history/,
      /Auto-recharge is off by default/,
      /inference plans on a per-model basis/,
      /multiple tiers at different\s+monthly rates/,
    ],
    "account billing",
  );
  requireClaims(
    bundle,
    "/console/overview.md",
    [
      /usage, billing, and team access/,
      /Manage credits, payment methods, subscriptions, and invoices/,
    ],
    "console billing",
  );
  requireClaims(
    bundle,
    "/console/usage-monitoring.md",
    [
      /Usage[\s\S]*Cached-Usage[\s\S]*Cost/,
      /Cost data may be delayed by up to 10 minutes/,
      /active monthly subscription\s+are excluded from usage-based billing/,
      /Download Report.*CSV/,
    ],
    "usage and cost reporting",
  );
  requireClaims(
    bundle,
    "/console/projects.md",
    [
      /two-level quota model/,
      /billing is always aggregated and invoiced at the organization level/,
    ],
    "project billing",
  );
  requireClaims(
    bundle,
    "/support/rate-limits.md",
    [/organization level, not the user level/, /precise, up-to-date rate limit\s+information/],
    "account limits",
  );
  requireClaims(
    bundle,
    "/capabilities/metrics.md",
    [/dedicated Cerebras inference endpoint/, /Track input and output tokens for cost analysis/],
    "metrics availability",
  );
  requireClaims(
    bundle,
    "/api-reference/metrics/retrieve-metrics.md",
    [
      /available on an opt-in basis/,
      /input_tokens_total/,
      /output_tokens_total/,
      /cache_reads_total/,
      /last complete minute/,
    ],
    "metrics aggregation",
  );
  requireClaims(
    bundle,
    "/dedicated/overview.md",
    [/reserved exclusively for your organization/, /available to enterprise customers/],
    "dedicated endpoint",
  );
  requireClaims(
    bundle,
    "/integrations/aws-marketplace.md",
    [
      /X-Cerebras-3rd-Party-Integration: aws-marketplace/,
      /billed monthly through your AWS account/,
      /\$0\.01 SKU/,
      /allow 24-48 hours for charges to appear/,
    ],
    "AWS Marketplace billing",
  );
  const pageEvidence = pricePageEvidence(document(bundle, "/support/pricing.md"), models);
  return [
    { disposition: "excluded", reason_code: "free_trial_credit_allowance_out_of_catalog" },
    { disposition: "excluded", reason_code: "credit_balance_recharge_out_of_catalog" },
    { disposition: "excluded", reason_code: "account_tier_capacity_out_of_catalog" },
    { disposition: "excluded", reason_code: "monthly_subscription_out_of_catalog" },
    { disposition: "excluded", reason_code: "console_cost_reporting_out_of_catalog" },
    { disposition: "excluded", reason_code: "console_cost_delay_out_of_catalog" },
    { disposition: "excluded", reason_code: "project_quota_out_of_catalog" },
    { disposition: "excluded", reason_code: "metrics_api_operational_out_of_catalog" },
    { disposition: "excluded", reason_code: "dedicated_endpoint_contract_out_of_catalog" },
    { disposition: "excluded", reason_code: "aws_marketplace_billing_out_of_catalog" },
    { disposition: "excluded", reason_code: "aws_billing_delay_out_of_catalog" },
    { disposition: "excluded", reason_code: "cerebras_code_subscription_out_of_catalog" },
    { disposition: "excluded", reason_code: "client_executed_tools_out_of_catalog" },
    { disposition: "unbound", reason_code: "usage_cost_api_not_documented" },
    { disposition: "unbound", reason_code: "monthly_subscription_rates_not_public" },
    { disposition: "unbound", reason_code: "enterprise_dedicated_terms_not_public" },
    { disposition: "unbound", reason_code: "batch_rate_not_published" },
    ...pageEvidence,
  ];
}

function reconcileRates(input: Input, models: ProviderModel[]): void {
  for (const model of models)
    for (const rate of model.price_facts)
      input.onPricingReconciliation?.({
        disposition: "normalized",
        reason_code:
          rate.meter === "cache_read_text" ? "cache_rate_normalized" : "price_normalized",
        sample: `${model.model_id}:${rate.meter}`,
      });
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

function validateServiceTierPricing(bundle: z.infer<typeof linkedBundleSchema>): void {
  const body = document(bundle, "/capabilities/service-tiers.md");
  if (
    !/Are priority, flex, or auto billed differently than default\?/.test(body) ||
    !/No, during the preview launch all service tiers are billed equally\./.test(body)
  )
    throw new Error("Cerebras service-tier pricing policy drift");
}

function validateOpenApi(bundle: z.infer<typeof linkedBundleSchema>): void {
  const body = document(bundle, "/api-reference/openapi.yaml");
  const paths = [...body.matchAll(/^  (\/[^:]+):\s*$/gm)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
  const operations = [...body.matchAll(/^    (get|post|put|patch|delete):\s*$/gm)].flatMap(
    (match) => (match[1] === undefined ? [] : [match[1]]),
  );
  const claims = [
    /^openapi: 3\.1\.0$/m,
    /^  - url: https:\/\/api\.cerebras\.ai$/m,
    /^  - BearerAuth: \[\]$/m,
    /^      operationId: createChatCompletion$/m,
    /application\/vnd\.msgpack/,
    /name: Content-Encoding[\s\S]*?gzip/,
    /name: queue_threshold[\s\S]*?Private Preview/,
    /#\/components\/schemas\/ChatCompletionRequest/,
    /#\/components\/schemas\/ChatCompletionResponse/,
    /^        prompt_cache_key:$/m,
    /^        reasoning_effort:$/m,
    /^        service_tier:$/m,
    /^        tool_choice:$/m,
    /^        service_tier_used:$/m,
    /^            image_tokens:$/m,
    /^                cached_tokens:$/m,
    /^                rejected_prediction_tokens:$/m,
    /^                reasoning_tokens:$/m,
    /^    BearerAuth:$/m,
    /type: http[\s\S]*?scheme: bearer/,
  ];
  if (
    !sameStrings(paths, ["/v1/chat/completions"]) ||
    !sameStrings(operations, ["post"]) ||
    claims.some((claim) => !claim.test(body))
  )
    throw new Error("Cerebras raw OpenAPI contract drift");
}

function validateApiVersioning(bundle: z.infer<typeof linkedBundleSchema>): void {
  const body = document(bundle, "/api-reference/versions.md").replace(/\s+/g, " ");
  if (
    !/Version 2 is now the default for API requests\./.test(body) ||
    !/New optional request parameters may be added/.test(body) ||
    !/New fields may be added to responses/.test(body) ||
    !/Breaking changes only happen in new API versions/.test(body) ||
    !/X-Cerebras-Version-Patch/.test(body)
  )
    throw new Error("Cerebras API-version contract drift");
}

export function parseCerebrasCatalog(input: Input): ProviderModel[] {
  const bundle = linkedBundleSchema.parse(JSON.parse(input.body));
  validateApiReferences(bundle);
  validateServiceTierPricing(bundle);
  validateOpenApi(bundle);
  validateApiVersioning(bundle);
  const rows = catalogRows(bundle.index.body);
  const cardPaths = new Set(rows.map(({ path }) => path));
  const nonCardModelPaths = new Set(["/models/choose-a-model"]);
  const cardEntries = bundle.documents.flatMap((item) => {
    const pathname = new URL(item.url).pathname.replace(/\.md$/, "");
    if (!pathname.startsWith("/models/")) return [];
    if (!cardPaths.has(pathname)) {
      if (nonCardModelPaths.has(pathname)) return [];
      throw new Error(`Cerebras source included an unreviewed model page: ${pathname}`);
    }
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
  const modelsById = new Map(models.map((model) => [model.model_id, model]));
  const cardEvidence = [...cards].flatMap(([id, body]) => {
    const model = modelsById.get(id);
    if (model === undefined) throw new Error(`Cerebras card pricing omitted catalog model ${id}`);
    return cardProseEvidence(body, model);
  });
  const evidence = [...commercialEvidence(bundle, models), ...cardEvidence];
  const result = bounded(input, "cerebras-catalog", models);
  reconcileRates(input, result);
  for (const item of evidence) input.onPricingReconciliation?.(item);
  return result;
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

function bind(map: Map<string, string>, key: string, id: string): void {
  const current = map.get(key);
  if (current !== undefined && current !== id)
    throw new Error(`Cerebras model reference ${key} maps to multiple IDs`);
  map.set(key, id);
}

function namedReleaseIds(body: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of body.matchAll(
    /Added (?:(?:preview|production) )?support for ([^:\n]{1,160}):\s*`([^`]+)`/gi,
  )) {
    if (match[1] === undefined || match[2] === undefined) continue;
    bind(result, text(match[1]), modelIdSchema.parse(match[2]));
  }
  for (const match of body.matchAll(
    /\[([^\]]+)]\(\/models\/[a-z0-9-]+\)\s+\(`([^`]+)`\) is now available in preview/gi,
  )) {
    if (match[1] === undefined || match[2] === undefined) continue;
    bind(result, text(match[1]), modelIdSchema.parse(match[2]));
  }
  const heading = body.match(/\*\*Support for ([^*\n]+)\*\*/)?.[1];
  if (heading !== undefined) {
    const ids = [...body.matchAll(/`([^`]+)`/g)].flatMap((match) => {
      const parsed = modelIdSchema.safeParse(match[1]);
      return parsed.success ? [parsed.data] : [];
    });
    if (ids.length !== 1) throw new Error("Cerebras model-support release has ambiguous IDs");
    const id = ids[0];
    if (id === undefined) throw new Error("Cerebras model-support release omitted its ID");
    bind(result, text(heading), id);
  }
  return result;
}

function modelReferences(
  catalog: string,
  releases: string,
): { names: Map<string, string>; paths: Map<string, string> } {
  const names = new Map<string, string>();
  const paths = new Map<string, string>();
  for (const row of catalogRows(catalog)) {
    bind(names, row.name, row.id);
    bind(paths, row.path, row.id);
  }
  for (const update of updates(releases))
    for (const [name, id] of namedReleaseIds(update.body)) bind(names, name, id);
  return { names, paths };
}

function replacements(
  body: string,
  deprecated: string[],
  references: ReturnType<typeof modelReferences>,
): string[] {
  const recommendation = body.match(/We recommend[\s\S]*?(?:\n\n|$)/)?.[0];
  if (recommendation === undefined) return [];
  const result: string[] = [];
  for (const match of recommendation.matchAll(/\[([^\]]+)]\((\/models\/[a-z0-9-]+)\)/g)) {
    if (match[1] === undefined || match[2] === undefined) continue;
    const path = match[2];
    const pathId = references.paths.get(path);
    const nameId = references.names.get(text(match[1]));
    if (pathId !== undefined && nameId !== undefined && pathId !== nameId)
      throw new Error(`Cerebras replacement link ${path} has conflicting model IDs`);
    const id = pathId ?? nameId;
    if (id === undefined) throw new Error(`Unresolved Cerebras replacement model link: ${path}`);
    result.push(id);
  }
  for (const match of recommendation.matchAll(/`([^`]+)`/g)) {
    const parsed = modelIdSchema.safeParse(match[1]);
    if (parsed.success) result.push(parsed.data);
  }
  const unique = [...new Set(result.filter((id) => !deprecated.includes(id)))];
  if (unique.length === 0)
    throw new Error("Cerebras model recommendation omitted a replacement ID");
  return unique;
}

export function parseCerebrasLifecycle(input: Input): ProviderModel[] {
  const bundle = linkedBundleSchema.parse(JSON.parse(input.body));
  const references = modelReferences(
    document(bundle, "/models/overview.md"),
    document(bundle, "/support/change-log.md"),
  );
  const models = updates(bundle.index.body).flatMap((update): ProviderModel[] => {
    const ids = deprecatedIds(update.body);
    if (ids.length === 0) return [];
    const replacementIds = replacements(update.body, ids, references);
    return ids.map(
      (id): ProviderModel => ({
        ...baseModel({
          providerId: input.provider.id,
          id,
          name: id,
          sourceId: input.source.id,
          observedAt: input.observedAt,
        }),
        tasks: ["text_generation"],
        modalities: { input: ["text"], output: ["text"] },
        deprecated_at: update.date,
        status: "deprecated",
        replacement_model_ids: replacementIds,
      }),
    );
  });
  const known = new Set([...models.map(({ model_id }) => model_id), ...references.paths.values()]);
  for (const model of models)
    for (const replacement of model.replacement_model_ids)
      if (!known.has(replacement))
        throw new Error(`Unknown Cerebras replacement model ID: ${replacement}`);
  return bounded(input, "cerebras-lifecycle", models);
}

function releaseIds(body: string): string[] {
  const ids = [...body.matchAll(/\(`([^`]+)`\) is now available in preview/gi)].flatMap((match) =>
    match[1] === undefined ? [] : [modelIdSchema.parse(match[1])],
  );
  ids.push(...namedReleaseIds(body).values());
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
      tasks: ["text_generation"],
      release_date: date,
    }),
  );
  return bounded(input, "cerebras-releases", models);
}

export function parseCerebrasApi(input: Input): ProviderModel[] {
  const list = inventorySchema.parse(JSON.parse(input.body));
  const items = recognizeItems({
    label: "Cerebras API model",
    items: list.data,
    schema: inventoryItemSchema,
    modelId: "id",
    rootKeys: Object.keys(inventoryItemSchema.shape),
    ...(input.onContractFinding === undefined ? {} : { onFinding: input.onContractFinding }),
  });
  const models = items.map(
    (item): ProviderModel => ({
      ...baseModel({
        providerId: input.provider.id,
        id: item.id,
        name: item.id,
        sourceId: input.source.id,
        observedAt: input.observedAt,
      }),
      tasks: ["text_generation"],
    }),
  );
  return bounded(input, "cerebras-api", models);
}
