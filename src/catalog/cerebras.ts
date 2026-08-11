import { load } from "cheerio";
import { z } from "zod";
import {
  attachCerebrasCommercialFacts,
  type CerebrasCodePlan,
  type CerebrasCommercialEvidence,
} from "./cerebras-commercial-source.ts";
import { htmlText } from "./html.ts";
import { modelIdSchema } from "./identity.ts";
import type { SourceManifest } from "./manifests.ts";
import { apiEndpointKey, baseModel } from "./model.ts";
import { decimalsEqual, publishedRate, rawPricingFact, scaleDecimal } from "./pricing.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import type {
  ParsedProviderModel as ProviderModel,
  SourcePriceFact,
  SourceRawPricingFact,
} from "./pricing-source.ts";
import {
  assertItemCount,
  recognizeItems,
  zodContractEvidence,
  type SourceContractEvidence,
  type ZodContractObservation,
} from "./source-contract.ts";
import { modalitySchema, type Modality, type Provider, unknownCapabilities } from "./schema.ts";

interface Input {
  provider: Provider;
  source: SourceManifest;
  body: string;
  observedAt: string;
  onContractFinding?: (evidence: SourceContractEvidence) => void;
  onPricingReconciliation?: (item: PricingReconciliationItem) => void;
}

const bundleSchema = z.object({
  index: z.object({ url: z.url(), body: z.string().min(1) }),
  documents: z.array(z.object({ url: z.url(), body: z.string().min(1) })),
});

type Bundle = z.infer<typeof bundleSchema>;

const decimalSchema = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);
const publicItemSchema = z.object({
  id: modelIdSchema,
  object: z.literal("model"),
  created: z.unknown().optional(),
  owned_by: z.unknown().optional(),
  name: z.unknown().optional(),
  description: z.unknown().optional(),
  hugging_face_id: z.unknown().optional(),
  pricing: z.unknown().optional(),
  capabilities: z.unknown().optional(),
  supported_parameters: z.unknown().optional(),
  architecture: z.unknown().optional(),
  limits: z.unknown().optional(),
  datacenter_locations: z.unknown().optional(),
  deprecated: z.unknown().optional(),
  preview: z.unknown().optional(),
  quantization: z.unknown().optional(),
});
const publicSchema = z.object({
  object: z.literal("list"),
  data: z.array(z.unknown()).min(1),
});
const publicPricingSchema = z.object({
  prompt: z.unknown().optional(),
  completion: z.unknown().optional(),
});
const publicCapabilitiesSchema = z.object({
  streaming: z.unknown().optional(),
  function_calling: z.unknown().optional(),
  structured_outputs: z.unknown().optional(),
  vision: z.unknown().optional(),
  json_mode: z.unknown().optional(),
  tools: z.unknown().optional(),
  tool_choice: z.unknown().optional(),
  parallel_tool_calls: z.unknown().optional(),
  response_format: z.unknown().optional(),
  reasoning: z.unknown().optional(),
});
const publicArchitectureSchema = z.object({ modality: z.unknown().optional() });
const publicLimitsSchema = z.object({
  max_context_length: z.unknown().optional(),
  max_completion_tokens: z.unknown().optional(),
});
const openRouterFeatureSchema = z.enum(["tools", "json_mode", "structured_outputs", "reasoning"]);
const openRouterItemSchema = z.object({
  id: modelIdSchema,
  hugging_face_id: z.string().min(1),
  name: z.string().min(1),
  created: z.number().int().nonnegative(),
  input_modalities: z.array(modalitySchema).min(1),
  output_modalities: z.array(modalitySchema).min(1),
  quantization: z.string().min(1).nullable(),
  context_length: z.number().int().positive(),
  max_output_length: z.number().int().positive(),
  pricing: z.object({
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
  openrouter: z.object({ slug: z.string().min(1) }),
  datacenters: z.array(z.string().min(1)),
});
const openRouterSchema = z.object({ data: z.array(z.unknown()) });
const huggingFaceItemSchema = z.object({
  id: modelIdSchema,
  hugging_face_id: z.string().min(1),
  object: z.literal("model"),
  created: z.number().int().nonnegative(),
  owned_by: z.string().min(1),
  context_length: z.number().int().positive(),
  pricing: z.object({
    input: z.number().nonnegative(),
    output: z.number().nonnegative(),
  }),
  capabilities: z.object({
    streaming: z.boolean(),
    function_calling: z.boolean(),
    structured_outputs: z.boolean(),
    vision: z.boolean(),
  }),
});
const huggingFaceSchema = z.object({
  object: z.literal("list"),
  data: z.array(z.unknown()),
});
const inventoryItemSchema = z.object({
  id: modelIdSchema,
  object: z.literal("model"),
  created: z.unknown().optional(),
  owned_by: z.unknown().optional(),
});
const inventorySchema = z.object({
  object: z.literal("list"),
  data: z.array(z.unknown()),
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

function diagnostic(
  input: Input,
  disposition: PricingReconciliationItem["disposition"],
  reason_code: string,
  sample?: string,
): void {
  input.onPricingReconciliation?.({
    disposition,
    reason_code,
    ...(sample === undefined ? {} : { sample: sample.slice(0, 256) }),
  });
}

function claim<T>(input: Input, reasonCode: string, sample: string, parse: () => T): T | undefined {
  try {
    return parse();
  } catch (error) {
    diagnostic(
      input,
      "unsupported",
      reasonCode,
      `${sample}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function usableRows(
  input: Input,
  items: readonly unknown[],
  schema: z.ZodType<unknown>,
  reasonCode: string,
): unknown[] {
  const valid: unknown[] = [];
  const invalid: ZodContractObservation[] = [];
  for (const [itemIndex, item] of items.entries()) {
    const parsed = schema.safeParse(item);
    if (parsed.success) {
      valid.push(item);
      continue;
    }
    const id =
      item !== null && typeof item === "object" && typeof Reflect.get(item, "id") === "string"
        ? String(Reflect.get(item, "id"))
        : undefined;
    invalid.push({
      error: parsed.error,
      input: item,
      itemIndex,
      ...(id === undefined ? {} : { modelId: id }),
    });
  }
  if (invalid.length > 0) {
    input.onContractFinding?.(zodContractEvidence(invalid, items.length, "accept_with_signal"));
    diagnostic(input, "unsupported", reasonCode, `${invalid.length}/${items.length}`);
  }
  return valid;
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
  input: Input,
  bundle: Bundle,
  label: string,
  predicate: (url: URL) => boolean,
): string | undefined {
  const matches = bundle.documents.filter(({ url }) => predicate(new URL(url)));
  const [item] = matches;
  if (matches.length !== 1 || item === undefined) {
    diagnostic(
      input,
      matches.length === 0 ? "unbound" : "unsupported",
      matches.length === 0 ? "companion_missing" : "companion_duplicate",
      label,
    );
    return;
  }
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

export function parseCerebrasPublic(input: Input): ProviderModel[] {
  const bundle = bundleSchema.parse(JSON.parse(input.body));
  const list = publicSchema.parse(JSON.parse(bundle.index.body));
  const items = recognizeItems({
    label: "Cerebras public model",
    items: usableRows(input, list.data, publicItemSchema, "public_model_identity_drift"),
    schema: publicItemSchema,
    modelId: "id",
    rootKeys: Object.keys(publicItemSchema.shape),
    ...(input.onContractFinding === undefined ? {} : { onFinding: input.onContractFinding }),
  });
  const models = items.map((item) => publicModel(input, item));
  const result = bounded(input, "cerebras-public", models);
  const openRouter = compatibilityItems(
    input,
    bundleDocument(
      input,
      bundle,
      "OpenRouter compatibility response",
      (url) => url.searchParams.get("format") === "openrouter",
    ),
    "openrouter",
  );
  const huggingFace = compatibilityItems(
    input,
    bundleDocument(
      input,
      bundle,
      "HuggingFace compatibility response",
      (url) => url.searchParams.get("format") === "huggingface",
    ),
    "huggingface",
  );
  const contract = bundleDocument(input, bundle, "public-model format contract", (url) =>
    url.pathname.endsWith("/api-reference/models/public-models.md"),
  );
  if (contract !== undefined)
    claim(input, "public_format_contract_drift", "public model formats", () =>
      assertPublicFormatContract(contract),
    );
  reconcileCompatibility(input, result, items, openRouter, huggingFace);
  reconcileRates(input, result);
  diagnostic(input, "excluded", "compatibility_zero_placeholders_not_native_rates");
  return result;
}

type PublicItem = z.infer<typeof publicItemSchema>;
type OpenRouterItem = z.infer<typeof openRouterItemSchema>;
type HuggingFaceItem = z.infer<typeof huggingFaceItemSchema>;

function publicModel(input: Input, item: PublicItem): ProviderModel {
  const value = <T>(reason: string, field: string, parse: () => T): T | undefined =>
    claim(input, reason, `${item.id}:${field}`, parse);
  const name = value("public_name_claim_drift", "name", () => z.string().min(1).parse(item.name));
  const description = value("public_description_claim_drift", "description", () =>
    z.string().min(1).parse(item.description),
  );
  const architecture = publicArchitectureSchema.safeParse(item.architecture);
  const modality = architecture.success
    ? value("public_modality_claim_drift", "architecture.modality", () =>
        z.string().min(1).parse(architecture.data.modality),
      )
    : undefined;
  const modalities =
    modality === undefined
      ? []
      : (value("public_modality_claim_drift", "architecture.modality", () =>
          architectureInputs(modality),
        ) ?? []);
  const capabilities = publicCapabilitiesSchema.safeParse(item.capabilities);
  const capability = (field: keyof z.infer<typeof publicCapabilitiesSchema>): boolean | undefined =>
    capabilities.success
      ? value("public_capability_claim_drift", `capabilities.${field}`, () =>
          z.boolean().parse(capabilities.data[field]),
        )
      : undefined;
  const vision = capability("vision");
  if (vision !== undefined && modalities.length > 0 && modalities.includes("image") !== vision)
    diagnostic(input, "unbound", "public_modality_capability_conflict", item.id);
  const functionCalling = capability("function_calling");
  const tools = capability("tools");
  const reasoning = capability("reasoning");
  const structuredOutput = capability("structured_outputs");
  const streaming = capability("streaming");
  if (functionCalling !== undefined && tools !== undefined && functionCalling !== tools)
    diagnostic(input, "unbound", "public_tool_capability_conflict", item.id);
  const limits = publicLimitsSchema.safeParse(item.limits);
  const limit = (field: keyof z.infer<typeof publicLimitsSchema>): number | undefined =>
    limits.success
      ? value("public_limit_claim_drift", `limits.${field}`, () =>
          z.number().int().positive().parse(limits.data[field]),
        )
      : undefined;
  const contextTokens = limit("max_context_length");
  const maxOutputTokens = limit("max_completion_tokens");
  const pricing = publicPricingSchema.safeParse(item.pricing);
  const priceFacts = (
    [
      ["input_text", "prompt"],
      ["output_text", "completion"],
    ] as const
  ).flatMap(([meter, field]): SourcePriceFact[] => {
    const amount = pricing.success
      ? value("public_price_claim_drift", `pricing.${field}`, () =>
          decimalSchema.parse(pricing.data[field]),
        )
      : undefined;
    return amount === undefined ? [] : [scaledRate(meter, amount, input.source.id)];
  });
  const deprecated = value("public_lifecycle_claim_drift", "deprecated", () =>
    z.boolean().parse(item.deprecated),
  );
  const preview = value("public_release_stage_claim_drift", "preview", () =>
    z.boolean().parse(item.preview),
  );
  return {
    ...baseModel({
      providerId: input.provider.id,
      id: item.id,
      name: name ?? item.id,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    }),
    ...(description === undefined ? {} : { description }),
    tasks: ["text_generation"],
    modalities: { input: modalities, output: ["text"] },
    capabilities: {
      ...unknownCapabilities(),
      ...(reasoning === undefined ? {} : { reasoning }),
      ...(functionCalling === undefined ? {} : { tool_call: functionCalling }),
      ...(structuredOutput === undefined ? {} : { structured_output: structuredOutput }),
      ...(streaming === undefined ? {} : { streaming }),
    },
    limits: {
      ...(contextTokens === undefined ? {} : { context_tokens: contextTokens }),
      ...(maxOutputTokens === undefined ? {} : { max_output_tokens: maxOutputTokens }),
    },
    status: deprecated === undefined ? "unknown" : deprecated ? "deprecated" : "active",
    release_stage: preview === undefined ? "unknown" : preview ? "preview" : "stable",
    pricing_state: priceFacts.length === 0 ? "unknown" : "numeric",
    price_facts: priceFacts,
  };
}

function compatibilityItems(
  input: Input,
  body: string | undefined,
  format: "huggingface" | "openrouter",
): Array<HuggingFaceItem | OpenRouterItem> {
  if (body === undefined) return [];
  const envelope = claim(input, `${format}_format_envelope_drift`, format, () => {
    const parsed: unknown = JSON.parse(body);
    return format === "openrouter"
      ? openRouterSchema.parse(parsed).data
      : huggingFaceSchema.parse(parsed).data;
  });
  if (envelope === undefined) return [];
  return envelope.flatMap((item, index) => {
    const parsed =
      format === "openrouter"
        ? openRouterItemSchema.safeParse(item)
        : huggingFaceItemSchema.safeParse(item);
    if (parsed.success) return [parsed.data];
    diagnostic(input, "unsupported", `${format}_format_item_drift`, String(index));
    return [];
  });
}

function reconcileCompatibility(
  input: Input,
  models: ProviderModel[],
  nativeItems: PublicItem[],
  openRouterItems: Array<HuggingFaceItem | OpenRouterItem>,
  huggingFaceItems: Array<HuggingFaceItem | OpenRouterItem>,
): void {
  const native = new Map(nativeItems.map((item) => [item.id, item]));
  const routers = new Map(
    openRouterItems.flatMap((item) =>
      "supported_features" in item ? [[item.id, item] as const] : [],
    ),
  );
  const hubs = new Map(
    huggingFaceItems.flatMap((item) => ("object" in item ? [[item.id, item] as const] : [])),
  );
  const ids = models.map(({ model_id }) => model_id);
  if (!sameStrings(ids, [...routers.keys()]))
    diagnostic(input, "unbound", "openrouter_format_inventory_disagreement");
  if (!sameStrings(ids, [...hubs.keys()]))
    diagnostic(input, "unbound", "huggingface_format_inventory_disagreement");
  for (const model of models) {
    const source = native.get(model.model_id);
    const router = routers.get(model.model_id);
    const hub = hubs.get(model.model_id);
    if (router === undefined)
      diagnostic(input, "unbound", "openrouter_format_model_missing", model.model_id);
    else reconcileOpenRouter(input, model, source, router);
    if (hub === undefined)
      diagnostic(input, "unbound", "huggingface_format_model_missing", model.model_id);
    else reconcileHuggingFace(input, model, source, hub);
  }
}

function reconcileOpenRouter(
  input: Input,
  model: ProviderModel,
  native: PublicItem | undefined,
  item: OpenRouterItem,
): void {
  corroborateRate(input, model, "input_text", scaleDecimal(item.pricing.prompt, 6), "openrouter");
  corroborateRate(
    input,
    model,
    "output_text",
    scaleDecimal(item.pricing.completion, 6),
    "openrouter",
  );
  const features = new Set(item.supported_features);
  const claims = [
    ["name", model.name === item.name],
    ["description", model.description === item.description],
    ["context_length", model.limits.context_tokens === item.context_length],
    ["max_output_length", model.limits.max_output_tokens === item.max_output_length],
    ["input_modalities", sameStrings(model.modalities.input, item.input_modalities)],
    ["output_modalities", sameStrings(model.modalities.output, item.output_modalities)],
    ["tools", model.capabilities.tool_call === features.has("tools")],
    [
      "structured_outputs",
      model.capabilities.structured_output === features.has("structured_outputs"),
    ],
    ["reasoning", model.capabilities.reasoning === features.has("reasoning")],
  ] as const;
  for (const [field, agrees] of claims)
    if (!agrees)
      diagnostic(
        input,
        "unbound",
        "openrouter_format_claim_conflict",
        `${model.model_id}:${field}`,
      );
  const nativeHuggingFaceId = z.string().safeParse(native?.hugging_face_id);
  if (nativeHuggingFaceId.success && nativeHuggingFaceId.data !== item.hugging_face_id)
    diagnostic(
      input,
      "unbound",
      "openrouter_format_claim_conflict",
      `${model.model_id}:hugging_face_id`,
    );
}

function reconcileHuggingFace(
  input: Input,
  model: ProviderModel,
  native: PublicItem | undefined,
  item: HuggingFaceItem,
): void {
  corroborateRate(input, model, "input_text", String(item.pricing.input), "huggingface");
  corroborateRate(input, model, "output_text", String(item.pricing.output), "huggingface");
  const claims = [
    ["context_length", model.limits.context_tokens === item.context_length],
    ["streaming", model.capabilities.streaming === item.capabilities.streaming],
    ["function_calling", model.capabilities.tool_call === item.capabilities.function_calling],
    [
      "structured_outputs",
      model.capabilities.structured_output === item.capabilities.structured_outputs,
    ],
    ["vision", model.modalities.input.includes("image") === item.capabilities.vision],
  ] as const;
  for (const [field, agrees] of claims)
    if (!agrees)
      diagnostic(
        input,
        "unbound",
        "huggingface_format_claim_conflict",
        `${model.model_id}:${field}`,
      );
  const nativeHuggingFaceId = z.string().safeParse(native?.hugging_face_id);
  if (nativeHuggingFaceId.success && nativeHuggingFaceId.data !== item.hugging_face_id)
    diagnostic(
      input,
      "unbound",
      "huggingface_format_claim_conflict",
      `${model.model_id}:hugging_face_id`,
    );
}

function corroborateRate(
  input: Input,
  model: ProviderModel,
  meter: TextMeter,
  observed: string,
  format: "huggingface" | "openrouter",
): void {
  const normalized = model.price_facts.find((rate) => rate.meter === meter)?.price;
  diagnostic(
    input,
    normalized !== undefined && decimalsEqual(normalized, observed) ? "normalized" : "unbound",
    `${format}_format_rate_${normalized !== undefined && decimalsEqual(normalized, observed) ? "corroborated" : "conflict"}`,
    `${model.model_id}:${meter}`,
  );
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
    if (rows.some((row) => row.length !== headers.length)) continue;
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

function scheduledDates(input: Input, body: string): Map<string, string> {
  const result = new Map<string, string>();
  const conflicts = new Set<string>();
  for (const match of body.matchAll(
    /\*\*([^*]+)\*\* is scheduled for deprecation on ([A-Z][a-z]+ \d{1,2}, \d{4})\./g,
  )) {
    if (match[1] === undefined || match[2] === undefined) continue;
    const name = text(match[1]);
    const rawDate = match[2];
    const date = claim(input, "scheduled_date_claim_drift", name, () => englishDate(rawDate));
    if (date === undefined || conflicts.has(name)) continue;
    const current = result.get(name);
    if (current !== undefined && current !== date) {
      result.delete(name);
      conflicts.add(name);
      diagnostic(input, "unbound", "scheduled_date_conflict", name);
      continue;
    }
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

function modelEndpoints(input: Input, id: string, body: string): ApiEndpoint[] {
  const names = claim(input, "model_endpoint_block_drift", id, () => arrayBlock(body, "endpoints"));
  if (names === undefined) return [];
  return names
    .flatMap((name): ApiEndpoint[] => {
      const endpoint = apiEndpoints.get(name);
      if (endpoint !== undefined) return [endpoint];
      diagnostic(input, "unsupported", "model_endpoint_unrecognized", `${id}:${name}`);
      return [];
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

function largestTokenCount(input: Input, id: string, field: string, block: string): number {
  const counts = [
    ...new Set([...stringField(block, "freeTier"), ...stringField(block, "paidTiers")]),
  ]
    .filter((value) => value !== "N/A")
    .flatMap((value): number[] => {
      const parsed = claim(input, "model_limit_value_drift", `${id}:${field}:${value}`, () =>
        tokenCount(value),
      );
      return parsed === undefined ? [] : [parsed];
    });
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

function cardModalities(
  input: Input,
  id: string,
  body: string,
  field: "inputFormats" | "outputFormats",
): Modality[] | undefined {
  const values = claim(input, "model_modality_block_drift", `${id}:${field}`, () =>
    arrayField(objectBlock(body, "inputOutput"), field),
  );
  if (values === undefined) return;
  const parsed = values.flatMap((value): Modality[] => {
    const modality = modalitySchema.safeParse(value.toLowerCase());
    if (modality.success) return [modality.data];
    diagnostic(input, "unsupported", "model_modality_value_drift", `${id}:${field}:${value}`);
    return [];
  });
  return parsed.length === 0 ? undefined : parsed;
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

function catalogRows(input: Input, body: string): CatalogRow[] {
  const rows = tables(body).flatMap((table) => {
    const releaseStage =
      table.section === "Production Models"
        ? "stable"
        : table.section === "Preview Models"
          ? "preview"
          : undefined;
    if (releaseStage === undefined) return [];
    const nameIndex = table.headers.indexOf("Model Name");
    const idIndex = table.headers.indexOf("Model ID");
    if (nameIndex < 0 || idIndex < 0) {
      diagnostic(input, "unsupported", "catalog_table_schema_drift", table.section);
      return [];
    }
    return table.rows.flatMap((row, index): CatalogRow[] => {
      const rawName = row[nameIndex];
      const rawId = row[idIndex];
      const parsed = claim(
        input,
        "catalog_row_claim_drift",
        `${table.section}:${index}`,
        (): CatalogRow => {
          if (rawName === undefined || rawId === undefined)
            throw new Error("model table omitted a value");
          return { id: exactCode(rawId), ...modelLink(rawName), releaseStage };
        },
      );
      return parsed === undefined ? [] : [parsed];
    });
  });
  const unique = new Map<string, CatalogRow>();
  for (const row of rows) {
    if (unique.has(row.id)) {
      diagnostic(input, "unsupported", "catalog_model_id_duplicate", row.id);
      continue;
    }
    unique.set(row.id, row);
  }
  return [...unique.values()];
}

function catalogCard(
  input: Input,
  row: CatalogRow,
  body: string | undefined,
  cachePolicy: string | undefined,
  scheduled: Map<string, string>,
): ProviderModel {
  const deprecatedAt = scheduled.get(row.name);
  const deprecated = deprecatedAt !== undefined && deprecatedAt <= input.observedAt.slice(0, 10);
  const base: ProviderModel = {
    ...baseModel({
      providerId: input.provider.id,
      id: row.id,
      name: row.name,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    }),
    tasks: ["text_generation"],
    deprecated_at: deprecatedAt,
    status: deprecated ? "deprecated" : "active",
    release_stage: row.releaseStage,
  };
  if (body === undefined) {
    diagnostic(input, "unbound", "model_card_missing", row.id);
    return base;
  }
  const identity = claim(input, "model_card_identity_drift", row.id, () => {
    const id = body.match(/\bmodelId="([^"]+)"/)?.[1];
    const title = body.match(/^#\s+(.+)$/m)?.[1];
    if (id === undefined || title === undefined) throw new Error("model ID or title missing");
    return { id: modelIdSchema.parse(id), title: text(title) };
  });
  if (identity === undefined || identity.id !== row.id || identity.title !== row.name) {
    if (identity !== undefined)
      diagnostic(input, "unbound", "model_card_catalog_disagreement", row.id);
    return base;
  }
  const description = body.match(/^>\s+(.+)$/m)?.[1];
  if (description === undefined)
    diagnostic(input, "unbound", "model_description_claim_drift", row.id);
  const endpoints = modelEndpoints(input, row.id, body);
  if (endpoints.length === 0) diagnostic(input, "unbound", "model_endpoint_claim_missing", row.id);
  const featureValues = claim(input, "model_feature_block_drift", row.id, () =>
    arrayBlock(body, "features"),
  );
  const features = featureValues === undefined ? undefined : new Set(featureValues);
  const inputPrice = claim(input, "model_card_input_price_drift", row.id, () =>
    cardPrice(body, "inputPrice"),
  );
  const outputPrice = claim(input, "model_card_output_price_drift", row.id, () =>
    cardPrice(body, "outputPrice"),
  );
  const rates: SourcePriceFact[] = [
    ...(inputPrice === undefined
      ? []
      : [
          publishedRate(
            "input_text",
            inputPrice,
            "million_tokens",
            input.source.id,
            "million tokens",
          ),
        ]),
    ...(outputPrice === undefined
      ? []
      : [
          publishedRate(
            "output_text",
            outputPrice,
            "million_tokens",
            input.source.id,
            "million tokens",
          ),
        ]),
  ];
  const cacheAccounting =
    cachePolicy !== undefined &&
    /Input tokens, whether served from the cache or processed fresh, are billed at the standard input token rate/.test(
      cachePolicy,
    );
  if (features?.has("Prompt Caching") && inputPrice !== undefined) {
    if (cacheAccounting)
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
    else diagnostic(input, "unbound", "cache_pricing_policy_drift", row.id);
  }
  const contextBlock = claim(input, "model_context_block_drift", row.id, () =>
    objectBlock(body, "contextLength"),
  );
  const outputBlock = claim(input, "model_output_block_drift", row.id, () =>
    objectBlock(body, "maxOutput"),
  );
  const contextTokens =
    contextBlock === undefined
      ? undefined
      : claim(input, "model_context_limit_drift", row.id, () =>
          largestTokenCount(input, row.id, "contextLength", contextBlock),
        );
  const maxOutputTokens =
    outputBlock === undefined
      ? undefined
      : claim(input, "model_output_limit_drift", row.id, () =>
          largestTokenCount(input, row.id, "maxOutput", outputBlock),
        );
  const inputModalities = cardModalities(input, row.id, body, "inputFormats");
  const outputModalities = cardModalities(input, row.id, body, "outputFormats");
  return {
    ...base,
    ...(description === undefined ? {} : { description: text(description) }),
    ...(endpoints.length === 0 ? {} : { api_endpoints: endpoints }),
    modalities: {
      input: inputModalities ?? [],
      output: outputModalities ?? [],
    },
    capabilities:
      features === undefined
        ? unknownCapabilities()
        : {
            ...unknownCapabilities(),
            reasoning: features.has("Reasoning"),
            tool_call: features.has("Tool Calling"),
            structured_output: features.has("Structured Outputs"),
            streaming: features.has("Streaming"),
            prompt_cache: features.has("Prompt Caching"),
            effort_control: /\breasoning_effort\b/.test(body) ? true : "unknown",
          },
    limits: {
      ...(contextTokens === undefined ? {} : { context_tokens: contextTokens }),
      ...(maxOutputTokens === undefined ? {} : { max_output_tokens: maxOutputTokens }),
    },
    pricing_state: rates.length === 0 ? "unknown" : "numeric",
    price_facts: rates,
  };
}

function document(input: Input, bundle: Bundle, suffix: string): string | undefined {
  const matches = bundle.documents.filter(({ url }) => new URL(url).pathname.endsWith(suffix));
  const [item] = matches;
  if (matches.length !== 1 || item === undefined) {
    diagnostic(
      input,
      matches.length === 0 ? "unbound" : "unsupported",
      matches.length === 0 ? "commercial_companion_missing" : "commercial_companion_duplicate",
      suffix,
    );
    return;
  }
  return item.body;
}

function hasClaims(
  input: Input,
  bundle: Bundle,
  suffix: string,
  claims: readonly RegExp[],
  reasonCode: string,
): boolean {
  const body = document(input, bundle, suffix);
  if (body === undefined) return false;
  const normalized = body.replace(/\\([_$*])/g, "$1").replace(/\s+/g, " ");
  const missing = claims.filter((pattern) => !pattern.test(body) && !pattern.test(normalized));
  if (missing.length === 0) return true;
  diagnostic(input, "unbound", reasonCode, suffix);
  return false;
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

function validateCommercialIndex(input: Input, bundle: Bundle): void {
  const body = document(input, bundle, "/llms.txt");
  if (body === undefined) return;
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
  if (indexed.size === 0) {
    diagnostic(input, "unbound", "commercial_index_drift");
    return;
  }
  const selected = new Set(
    [bundle.index, ...bundle.documents].map(({ url }) =>
      new URL(url).pathname.replace(/\.md$/, ""),
    ),
  );
  const missing = [...indexed].filter((path) => !selected.has(path)).sort();
  for (const path of missing) diagnostic(input, "unbound", "commercial_page_pending_review", path);
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
  return [
    ...new Map(rows.map((row) => [`${row.label}\0${row.input}\0${row.output}`, row])).values(),
  ];
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
  const corroborated = normalized !== undefined && decimalsEqual(normalized, observed);
  return {
    disposition: corroborated ? "normalized" : "unbound",
    reason_code: `${source}_rate_${
      normalized === undefined ? "unbound" : corroborated ? "corroborated" : "conflict"
    }`,
    sample: `${model.model_id}:${meter}`,
  };
}

function cardProseEvidence(
  input: Input,
  body: string,
  model: ProviderModel,
): PricingReconciliationItem[] {
  const matches = [
    ...body.matchAll(
      /\bPricing:\s*\$((?:0|[1-9]\d*)(?:\.\d+)?) per million input tokens,\s*\$((?:0|[1-9]\d*)(?:\.\d+)?) per million output tokens\./g,
    ),
  ];
  const [match] = matches;
  if (matches.length !== 1 || match?.[1] === undefined || match[2] === undefined) {
    diagnostic(input, "unbound", "model_card_prose_pricing_drift", model.model_id);
    return [];
  }
  return [
    observedRateEvidence(model, "input_text", match[1], "model_card_prose"),
    observedRateEvidence(model, "output_text", match[2], "model_card_prose"),
  ];
}

function pricePageEvidence(
  input: Input,
  body: string,
  models: ProviderModel[],
): PricingReconciliationItem[] {
  if (!/Developer Tier Pricing/.test(body))
    diagnostic(input, "unbound", "pricing_plan_contract_drift");
  const rows = pricePageRows(body);
  if (rows.length === 0) diagnostic(input, "unbound", "pricing_page_rows_missing");
  const evidence: PricingReconciliationItem[] = [];
  const matched = new Set<string>();
  for (const row of rows) {
    const matches = models.filter(({ model_id }) =>
      identity(row.label).includes(identity(model_id)),
    );
    const [model] = matches;
    if (matches.length !== 1 || model === undefined) {
      diagnostic(input, "unbound", "pricing_page_identity_drift", row.label);
      continue;
    }
    matched.add(model.model_id);
    evidence.push(
      observedRateEvidence(model, "input_text", row.input, "pricing_page"),
      observedRateEvidence(model, "output_text", row.output, "pricing_page"),
    );
  }
  for (const model of models)
    if (!matched.has(model.model_id))
      diagnostic(input, "unbound", "pricing_page_model_missing", model.model_id);
  return evidence;
}

function codePlans(input: Input, body: string): CerebrasCodePlan[] {
  const searchable = htmlText(
    load(body.replaceAll('\\"', '"').replaceAll("\\n", "\n").replaceAll("$$", "$")).root().text(),
  );
  const configurations = [
    ["pro", "Cerebras Code Pro", "50", "24 million"],
    ["max", "Cerebras Code Max", "200", "120m"],
  ] as const;
  return configurations.flatMap(([key, name, monthlyPrice, dailyTokens]) => {
    const plan = new RegExp(
      `${key}\\s+\\$${monthlyPrice}\\/month[\\s\\S]{0,2500}?Send up to ${dailyTokens} tokens\\/day[\\s\\S]{0,2500}?sold out`,
      "i",
    );
    if (plan.test(searchable)) return [{ key, name, monthlyPrice, dailyTokens, closedToNew: true }];
    diagnostic(input, "unbound", "cerebras_code_plan_drift", key);
    return [];
  });
}

interface CatalogCommercialEvidence {
  chatAccounting: boolean;
  completionsAccounting: boolean;
  cacheAccounting: boolean;
  settlement: boolean;
  commercial: CerebrasCommercialEvidence;
}

function commercialEvidence(
  input: Input,
  bundle: Bundle,
  models: ProviderModel[],
): CatalogCommercialEvidence {
  validateCommercialIndex(input, bundle);
  const chatAccounting = hasClaims(
    input,
    bundle,
    "/api-reference/chat-completions.md",
    [/prompt_tokens:/, /completion_tokens:/, /total_tokens:/],
    "chat_usage_contract_drift",
  );
  const completionsAccounting = hasClaims(
    input,
    bundle,
    "/api-reference/completions.md",
    [/prompt_tokens/, /completion_tokens/, /total_tokens/, /cached_tokens/],
    "completions_usage_contract_drift",
  );
  hasClaims(
    input,
    bundle,
    "/api-reference/models/public-models.md",
    [/Pricing per token in USD/, /Cost per prompt token/, /Cost per completion token/],
    "public_model_pricing_schema_drift",
  );
  const cacheAccounting = hasClaims(
    input,
    bundle,
    "/capabilities/prompt-caching.md",
    [
      /automatically enabled for all users/,
      /usage\.prompt_tokens_details\.cached_tokens/,
      /billed at the standard input token rate/,
      /does not (?:affect|change) billing/,
    ],
    "cache_accounting_contract_drift",
  );
  hasClaims(
    input,
    bundle,
    "/capabilities/service-tiers.md",
    [/service_tier/, /service_tier_used/, /all service tiers are billed equally/],
    "service_tier_pricing_contract_drift",
  );
  hasClaims(
    input,
    bundle,
    "/capabilities/image-inputs.md",
    [/usage\.image_tokens/, /prompt_tokens` includes text tokens, image tokens/],
    "image_token_accounting_contract_drift",
  );
  hasClaims(
    input,
    bundle,
    "/capabilities/reasoning.md",
    [/reasoning tokens are still generated and counted toward total\s+completion tokens/i],
    "reasoning_token_accounting_contract_drift",
  );
  hasClaims(
    input,
    bundle,
    "/dedicated/predicted-outputs.md",
    [
      /rejected_prediction_tokens/,
      /billed at the output token\s+rate/,
      /dedicated endpoints are not affected by rejected-token pricing/,
    ],
    "predicted_output_accounting_contract_drift",
  );
  const clientTools = hasClaims(
    input,
    bundle,
    "/capabilities/tool-use.md",
    [/client application receives the model's tool call request, executes the specified tool/i],
    "tool_execution_contract_drift",
  );
  const batch = hasClaims(
    input,
    bundle,
    "/capabilities/batch.md",
    [
      /Private Preview/,
      /only charged for requests that completed/i,
      /prompt_tokens/,
      /completion_tokens/,
    ],
    "batch_accounting_contract_drift",
  );
  const batchFiles = hasClaims(
    input,
    bundle,
    "/api-reference/file/upload-file.md",
    [/purpose=batch/, /expire after 7 days by default/, /JSONL/],
    "batch_file_contract_drift",
  );
  const freeTrial = hasClaims(
    input,
    bundle,
    "/console/account-billing.md",
    [
      /\$5 in free credits/,
      /expire 30 days/,
      /verified payment method/,
      /across all public models/,
    ],
    "free_trial_contract_drift",
  );
  const settlement = hasClaims(
    input,
    bundle,
    "/console/account-billing.md",
    [/credit grant history/, /Auto-recharge is off by default/, /Pay as you go/],
    "direct_settlement_contract_drift",
  );
  const accountSubscriptions = hasClaims(
    input,
    bundle,
    "/console/account-billing.md",
    [/inference plans on a per-model basis/, /multiple tiers at different\s+monthly rates/],
    "account_subscription_contract_drift",
  );
  const costReporting = hasClaims(
    input,
    bundle,
    "/console/usage-monitoring.md",
    [
      /Usage[\s\S]*Cached-Usage[\s\S]*Cost/,
      /Cost data may be delayed by up to 10 minutes/,
      /active monthly subscription\s+are excluded from usage-based billing/,
      /Download Report.*CSV/,
    ],
    "cost_reporting_contract_drift",
  );
  const projectQuotas = hasClaims(
    input,
    bundle,
    "/console/projects.md",
    [
      /two-level quota model/,
      /billing is always aggregated and invoiced at the organization level/,
    ],
    "project_quota_contract_drift",
  );
  hasClaims(
    input,
    bundle,
    "/support/rate-limits.md",
    [/organization level, not the user level/, /precise, up-to-date rate limit\s+information/],
    "account_limit_contract_drift",
  );
  const metrics =
    hasClaims(
      input,
      bundle,
      "/capabilities/metrics.md",
      [/dedicated Cerebras inference endpoint/, /Track input and output tokens for cost analysis/],
      "metrics_availability_contract_drift",
    ) &&
    hasClaims(
      input,
      bundle,
      "/api-reference/metrics/retrieve-metrics.md",
      [
        /available on an opt-in basis/,
        /input_tokens_total/,
        /output_tokens_total/,
        /last complete minute/,
      ],
      "metrics_aggregation_contract_drift",
    );
  const dedicated = hasClaims(
    input,
    bundle,
    "/dedicated/overview.md",
    [/reserved exclusively for your organization/, /available to enterprise customers/],
    "dedicated_endpoint_contract_drift",
  );
  const marketplace = hasClaims(
    input,
    bundle,
    "/integrations/aws-marketplace.md",
    [
      /X-Cerebras-3rd-Party-Integration: aws-marketplace/,
      /billed monthly through your AWS account/,
      /\$0\.01 SKU/,
      /allow 24-48 hours for charges to appear/,
    ],
    "aws_marketplace_contract_drift",
  );
  const pricing = pricingDocument(input, bundle);
  if (pricing !== undefined)
    for (const item of pricePageEvidence(input, pricing, models))
      input.onPricingReconciliation?.(item);
  const plans = pricing === undefined ? [] : codePlans(input, pricing);
  const training =
    pricing !== undefined &&
    /(?:fine-tun(?:ed|ing) models?|model fine-tuning)/i.test(pricing) &&
    /(?:custom model training|training services?)/i.test(pricing);
  if (pricing !== undefined && !training)
    diagnostic(input, "unbound", "enterprise_training_contract_drift");

  diagnostic(input, "unbound", "usage_cost_api_not_documented");
  if (clientTools) diagnostic(input, "excluded", "client_executed_tools_not_provider_meter");
  if (batch) diagnostic(input, "explicit_non_numeric", "batch_rate_not_published");
  if (accountSubscriptions)
    diagnostic(input, "explicit_non_numeric", "monthly_subscription_rates_account_scoped");
  if (dedicated) diagnostic(input, "explicit_non_numeric", "dedicated_terms_custom_quote");
  if (freeTrial) diagnostic(input, "raw", "free_trial_credit_preserved");
  if (costReporting) diagnostic(input, "raw", "console_cost_reporting_preserved");
  if (projectQuotas) diagnostic(input, "raw", "project_quota_preserved");
  if (metrics) diagnostic(input, "raw", "dedicated_metrics_preserved");
  if (marketplace) diagnostic(input, "raw", "aws_marketplace_settlement_preserved");
  if (plans.length > 0) diagnostic(input, "normalized", "cerebras_code_plans_normalized");

  return {
    chatAccounting,
    completionsAccounting,
    cacheAccounting,
    settlement,
    commercial: {
      accountSubscriptions,
      batch,
      batchFiles,
      codePlans: plans,
      costReporting,
      dedicated,
      freeTrial,
      marketplace,
      metrics,
      projectQuotas,
      training,
    },
  };
}

function pricingDocument(input: Input, bundle: Bundle): string | undefined {
  const matches = bundle.documents.filter(({ url }) => {
    const path = new URL(url).pathname;
    return path === "/pricing" || path.endsWith("/support/pricing.md");
  });
  const [item] = matches;
  if (matches.length === 1 && item !== undefined) return item.body;
  diagnostic(
    input,
    matches.length === 0 ? "unbound" : "unsupported",
    matches.length === 0 ? "commercial_companion_missing" : "commercial_companion_duplicate",
    "pricing",
  );
}

function rawGap(sourceRef: string, key: string, fragment: string): SourceRawPricingFact {
  return rawPricingFact(
    sourceRef,
    `accounting_binding_unavailable:${key}`,
    "informational",
    "requires_usage_aggregation",
    fragment,
  );
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

function validateApiContracts(input: Input, bundle: Bundle): void {
  hasClaims(
    input,
    bundle,
    "/api-reference/chat-completions.md",
    [
      /^# Chat Completions$/m,
      /^\s*\/v1\/chat\/completions:\s*$/m,
      /operationId: createChatCompletion/,
    ],
    "chat_operation_contract_drift",
  );
  hasClaims(
    input,
    bundle,
    "/api-reference/completions.md",
    [/^# Completions$/m, /curl -X POST https:\/\/api\.cerebras\.ai\/v1\/completions/],
    "completions_operation_contract_drift",
  );
  hasClaims(
    input,
    bundle,
    "/api-reference/openapi.yaml",
    [
      /^openapi: 3\.1\.0$/m,
      /^  \/v1\/chat\/completions:\s*$/m,
      /operationId: createChatCompletion/,
      /#\/components\/schemas\/ChatCompletionRequest/,
      /#\/components\/schemas\/ChatCompletionResponse/,
      /^        prompt_cache_key:$/m,
      /^        reasoning_effort:$/m,
      /^        service_tier:$/m,
      /^        tool_choice:$/m,
      /^    BearerAuth:$/m,
      /type: http[\s\S]*?scheme: bearer/,
    ],
    "openapi_contract_drift",
  );
  hasClaims(
    input,
    bundle,
    "/api-reference/versions.md",
    [
      /Version 2 is now the default for API requests/,
      /New optional request parameters may be added/,
      /New fields may be added to responses/,
      /Breaking changes only happen in new API versions/,
      /X-Cerebras-Version-Patch/,
    ],
    "api_version_contract_drift",
  );
}

export function parseCerebrasCatalog(input: Input): ProviderModel[] {
  const bundle = bundleSchema.parse(JSON.parse(input.body));
  validateApiContracts(input, bundle);
  const rows = catalogRows(input, bundle.index.body);
  const cardPaths = new Set(rows.map(({ path }) => path));
  const nonCardModelPaths = new Set(["/models/choose-a-model"]);
  const cards = new Map<string, string>();
  for (const item of bundle.documents) {
    const pathname = new URL(item.url).pathname.replace(/\.md$/, "");
    if (!pathname.startsWith("/models/")) continue;
    if (!cardPaths.has(pathname)) {
      if (!nonCardModelPaths.has(pathname))
        diagnostic(input, "unbound", "model_page_pending_review", pathname);
      continue;
    }
    if (cards.has(pathname)) {
      diagnostic(input, "unsupported", "model_page_duplicate", pathname);
      continue;
    }
    cards.set(pathname, item.body);
  }
  const cachePolicy = document(input, bundle, "/capabilities/prompt-caching.md");
  const scheduled = scheduledDates(input, [bundle.index.body, ...cards.values()].join("\n"));
  const models = rows.map((row) =>
    catalogCard(input, row, cards.get(row.path), cachePolicy, scheduled),
  );
  const modelsById = new Map(models.map((model) => [model.model_id, model]));
  const cardEvidence = rows.flatMap((row) => {
    const body = cards.get(row.path);
    const model = modelsById.get(row.id);
    return body === undefined || model === undefined ? [] : cardProseEvidence(input, body, model);
  });
  const commercial = commercialEvidence(input, bundle, models);
  for (const model of models) {
    const paths = model.api_endpoints?.map(({ path }) => path) ?? [];
    if (paths.some((path) => path.endsWith("/chat/completions")) && !commercial.chatAccounting)
      model.raw_price_facts.push(
        rawGap(input.source.id, "chat", "Chat Completions usage contract is unavailable"),
      );
    if (
      paths.some((path) => /(?:^|\/)v1\/completions$/.test(path)) &&
      !commercial.completionsAccounting
    )
      model.raw_price_facts.push(
        rawGap(input.source.id, "completions", "Completions usage contract is unavailable"),
      );
    if (model.capabilities.prompt_cache === true && !commercial.cacheAccounting)
      model.raw_price_facts.push(
        rawGap(input.source.id, "cache", "Cached-token accounting contract is unavailable"),
      );
    if (!commercial.settlement)
      model.raw_price_facts.push(
        rawGap(input.source.id, "settlement", "Direct account settlement contract is unavailable"),
      );
  }
  const result = bounded(input, "cerebras-catalog", models);
  reconcileRates(input, result);
  for (const item of cardEvidence) input.onPricingReconciliation?.(item);
  attachCerebrasCommercialFacts(result, input.source.id, commercial.commercial);
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

function deprecatedIds(input: Input, body: string): string[] {
  const heading = body.match(/\*\*Deprecated ([^*]+)\*\*/)?.[1];
  if (heading !== undefined)
    return [...heading.matchAll(/`([^`]+)`/g)].flatMap((match) =>
      validModelId(input, match[1], "deprecated_model_id_drift"),
    );
  const sentence = body.match(/The `([^`]+)` model has been deprecated\./)?.[1];
  return validModelId(input, sentence, "deprecated_model_id_drift");
}

function validModelId(input: Input, value: string | undefined, reasonCode: string): string[] {
  const parsed = modelIdSchema.safeParse(value);
  if (parsed.success) return [parsed.data];
  diagnostic(input, "unsupported", reasonCode, value);
  return [];
}

function bind(input: Input, map: Map<string, string>, key: string, id: string): void {
  const current = map.get(key);
  if (current !== undefined && current !== id) {
    map.delete(key);
    diagnostic(input, "unbound", "model_reference_conflict", key);
    return;
  }
  map.set(key, id);
}

function namedReleaseIds(input: Input, body: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of body.matchAll(
    /Added (?:(?:preview|production) )?support for ([^:\n]{1,160}):\s*`([^`]+)`/gi,
  )) {
    if (match[1] === undefined || match[2] === undefined) continue;
    const [id] = validModelId(input, match[2], "release_model_id_drift");
    if (id !== undefined) bind(input, result, text(match[1]), id);
  }
  for (const match of body.matchAll(
    /\[([^\]]+)]\(\/models\/[a-z0-9-]+\)\s+\(`([^`]+)`\) is now available in preview/gi,
  )) {
    if (match[1] === undefined || match[2] === undefined) continue;
    const [id] = validModelId(input, match[2], "release_model_id_drift");
    if (id !== undefined) bind(input, result, text(match[1]), id);
  }
  const heading = body.match(/\*\*Support for ([^*\n]+)\*\*/)?.[1];
  if (heading !== undefined) {
    const ids = [...body.matchAll(/`([^`]+)`/g)].flatMap((match) => {
      const parsed = modelIdSchema.safeParse(match[1]);
      return parsed.success ? [parsed.data] : [];
    });
    if (ids.length !== 1) {
      diagnostic(input, "unbound", "release_model_id_ambiguous", text(heading));
      return result;
    }
    const id = ids[0];
    if (id !== undefined) bind(input, result, text(heading), id);
  }
  return result;
}

function modelReferences(
  input: Input,
  catalog: string | undefined,
  releases: string | undefined,
): { names: Map<string, string>; paths: Map<string, string> } {
  const names = new Map<string, string>();
  const paths = new Map<string, string>();
  for (const row of catalog === undefined ? [] : catalogRows(input, catalog)) {
    bind(input, names, row.name, row.id);
    bind(input, paths, row.path, row.id);
  }
  for (const update of releases === undefined ? [] : updates(releases))
    for (const [name, id] of namedReleaseIds(input, update.body)) bind(input, names, name, id);
  return { names, paths };
}

function replacements(
  input: Input,
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
    if (pathId !== undefined && nameId !== undefined && pathId !== nameId) {
      diagnostic(input, "unbound", "replacement_model_conflict", path);
      continue;
    }
    const id = pathId ?? nameId;
    if (id === undefined) {
      diagnostic(input, "unbound", "replacement_model_unresolved", path);
      continue;
    }
    result.push(id);
  }
  for (const match of recommendation.matchAll(/`([^`]+)`/g)) {
    const parsed = modelIdSchema.safeParse(match[1]);
    if (parsed.success) result.push(parsed.data);
  }
  const unique = [...new Set(result.filter((id) => !deprecated.includes(id)))];
  if (unique.length === 0) diagnostic(input, "unbound", "replacement_model_missing");
  return unique;
}

export function parseCerebrasLifecycle(input: Input): ProviderModel[] {
  const bundle = bundleSchema.parse(JSON.parse(input.body));
  const references = modelReferences(
    input,
    document(input, bundle, "/models/overview.md"),
    document(input, bundle, "/support/change-log.md"),
  );
  const models = updates(bundle.index.body).flatMap((update): ProviderModel[] => {
    const ids = deprecatedIds(input, update.body);
    if (ids.length === 0) return [];
    const replacementIds = replacements(input, update.body, ids, references);
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
    model.replacement_model_ids = model.replacement_model_ids.filter((replacement) => {
      if (known.has(replacement)) return true;
      diagnostic(input, "unbound", "replacement_model_unknown", replacement);
      return false;
    });
  return bounded(input, "cerebras-lifecycle", models);
}

function releaseIds(input: Input, body: string): string[] {
  const ids = [...body.matchAll(/\(`([^`]+)`\) is now available in preview/gi)].flatMap((match) =>
    validModelId(input, match[1], "release_model_id_drift"),
  );
  ids.push(...namedReleaseIds(input, body).values());
  return [...new Set(ids)];
}

export function parseCerebrasReleases(input: Input): ProviderModel[] {
  const dates = new Map<string, string>();
  for (const update of updates(input.body))
    for (const id of releaseIds(input, update.body)) {
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
    items: usableRows(input, list.data, inventoryItemSchema, "api_model_identity_drift"),
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
