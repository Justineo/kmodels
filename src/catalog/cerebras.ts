import { z } from "zod";
import { extractCerebrasPricingInputs } from "./cerebras-accounting.ts";
import { attachCerebrasBatch } from "./cerebras-commercial-source.ts";
import { modelIdSchema } from "./identity.ts";
import type { SourceManifest } from "./manifests.ts";
import { apiEndpointKey, baseModel } from "./model.ts";
import { publishedRate, scaleDecimal } from "./pricing.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import type { ParsedProviderModel as ProviderModel, SourcePriceFact } from "./pricing-source.ts";
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
const publicBundleSchema = z.union([
  bundleSchema,
  z
    .string()
    .min(1)
    .transform((body) => ({
      index: { url: "https://api.cerebras.ai/public/v1/models", body },
      documents: [],
    })),
]);

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

export function parseCerebrasPublic(input: Input): ProviderModel[] {
  const value: unknown = JSON.parse(input.body);
  const bundle = publicBundleSchema.parse(
    typeof value === "object" && value !== null && "index" in value ? value : JSON.stringify(value),
  );
  const list = publicSchema.parse(JSON.parse(bundle.index.body));
  const items = recognizeItems({
    label: "Cerebras public model",
    items: usableRows(input, list.data, publicItemSchema, "public_model_identity_drift"),
    schema: publicItemSchema,
    modelId: "id",
    rootKeys: Object.keys(publicItemSchema.shape),
    ...(input.onContractFinding === undefined ? {} : { onFinding: input.onContractFinding }),
  });
  const result = bounded(
    input,
    "cerebras-public",
    items.map((item) => publicModel(input, item)),
  );
  reconcileRates(input, result);
  return result;
}

type PublicItem = z.infer<typeof publicItemSchema>;

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
  const capability = (
    field: keyof z.infer<typeof publicCapabilitiesSchema>,
  ): boolean | undefined =>
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
  const match = value.match(/^\[([^\]]+)]\((\/models\/[a-z0-9.-]+)\)$/);
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
      table.section === "Preview Models"
        ? "preview"
        : table.section === "Production Models" || table.section === "Available Models"
          ? "stable"
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

function hasBatchOffer(input: Input, bundle: Bundle): boolean {
  const batch = hasClaims(
    input,
    bundle,
    "/capabilities/batch.md",
    [
      /Private Preview/,
      /available endpoint is currently `\/v1\/chat\/completions`/,
      /only charged for requests that completed/i,
      /prompt_tokens/,
      /completion_tokens/,
    ],
    "batch_accounting_contract_drift",
  );
  if (batch) diagnostic(input, "explicit_non_numeric", "batch_rate_not_published");
  return batch;
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
  const batch = hasBatchOffer(input, bundle);
  const pricingInputs = extractCerebrasPricingInputs({
    documents: bundle.documents,
    sourceRef: input.source.id,
    ...(input.onContractFinding === undefined ? {} : { onFinding: input.onContractFinding }),
    ...(input.onPricingReconciliation === undefined
      ? {}
      : { onReconciliation: input.onPricingReconciliation }),
  });
  const carrier = models.toSorted((left, right) => left.uid.localeCompare(right.uid))[0];
  if (carrier !== undefined && pricingInputs.length > 0) carrier.pricing_inputs = pricingInputs;
  const result = bounded(input, "cerebras-catalog", models);
  reconcileRates(input, result);
  if (batch) attachCerebrasBatch(result, input.source.id);
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
    return ids.map((id): ProviderModel => ({
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
    }));
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
  const models = [...dates].map(([id, date]): ProviderModel => ({
    ...baseModel({
      providerId: input.provider.id,
      id,
      name: id,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    }),
    tasks: ["text_generation"],
    release_date: date,
  }));
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
  const models = items.map((item): ProviderModel => ({
    ...baseModel({
      providerId: input.provider.id,
      id: item.id,
      name: item.id,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    }),
    tasks: ["text_generation"],
  }));
  return bounded(input, "cerebras-api", models);
}
