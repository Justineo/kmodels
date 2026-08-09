import { load } from "cheerio";
import { z } from "zod";
import { linkedBundleSchema, linkedDocumentBody, type LinkedBundle } from "./bundle.ts";
import { modelIdSchema } from "./identity.ts";
import type { SourceManifest } from "./manifests.ts";
import { baseModel } from "./model.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import type { ParsedProviderModel as ProviderModel, SourcePriceFact } from "./pricing-source.ts";
import { assertItemCount, recognizeItems, type SourceContractEvidence } from "./source-contract.ts";
import { type Provider, unknownCapabilities } from "./schema.ts";

interface Input {
  provider: Provider;
  source: SourceManifest;
  body: string;
  observedAt: string;
  onContractFinding?: (evidence: SourceContractEvidence) => void;
  onPricingReconciliation?: (item: PricingReconciliationItem) => void;
}

const modelsPath = "/v1/models";
const chatPath = "/v1/chat/completions";
const estimatePath = "/v1/tokenizers/estimate-token-count";
const batchPath = "/v1/batches";
const batchApiDocument = "/docs/api/batch-create";
const cacheDocument = "/docs/guide/use-context-caching-feature-of-kimi-api";
const refSchema = z.string().regex(/^#\/components\/schemas\/[A-Za-z0-9]+$/);
const openApiSchema = z.object({
  servers: z.array(z.object({ url: z.url() })).length(1),
  paths: z.object({
    [modelsPath]: z.object({
      get: z.object({
        responses: z.object({
          "200": z.object({
            content: z.object({
              "application/json": z.object({ schema: z.unknown() }),
            }),
          }),
        }),
      }),
    }),
    [chatPath]: z.object({
      post: z.object({
        requestBody: z.object({
          content: z.object({
            "application/json": z.object({
              schema: z.object({
                discriminator: z.object({
                  propertyName: z.literal("model"),
                  mapping: z.record(modelIdSchema, refSchema),
                }),
              }),
            }),
          }),
        }),
        responses: z.object({
          "200": z.object({
            content: z.object({
              "application/json": z.object({ schema: z.object({ $ref: refSchema }) }),
              "text/event-stream": z.object({ schema: z.object({ $ref: refSchema }) }),
            }),
          }),
        }),
      }),
    }),
    [estimatePath]: z.object({
      post: z.object({
        requestBody: z.object({
          content: z.object({
            "application/json": z.object({ schema: z.object({ $ref: refSchema }) }),
          }),
        }),
      }),
    }),
  }),
  components: z.object({ schemas: z.record(z.string(), z.unknown()) }),
});
const allOfSchema = z.object({ allOf: z.array(z.unknown()).min(1) });
const propertiesSchema = z.object({ properties: z.record(z.string(), z.unknown()) });
const referenceSchema = z.object({ $ref: refSchema });
const modelPropertySchema = z.object({ enum: z.array(modelIdSchema).min(1) });
const enumSchema = z.object({ enum: z.array(z.string()).min(1) });
const maxCompletionSchema = z.object({
  type: z.literal("integer"),
  description: z.string().min(1),
});
const integerPropertySchema = z.object({ type: z.literal("integer") });
const includeUsageSchema = z.object({
  type: z.literal("boolean"),
  default: z.literal(false),
  description: z.string().min(1),
});
const typedObjectSchema = z.object({
  type: z.literal("object"),
  properties: z.record(z.string(), z.unknown()),
});
const typedArraySchema = z.object({ type: z.literal("array"), items: z.unknown() });
const typedStringSchema = z.object({ type: z.literal("string") });
const typedIntegerSchema = z.object({ type: z.literal("integer") });
const typedBooleanSchema = z.object({ type: z.literal("boolean") });
const priceRowsSchema = z.array(z.array(z.string()).min(5).max(6)).min(1);
type PriceColumn = "model" | "unit" | "cache" | "input" | "output" | "context";
const priceColumns = new Map<string, PriceColumn>([
  ["模型", "model"],
  ["Model", "model"],
  ["计费单位", "unit"],
  ["Unit", "unit"],
  ["输入价格（缓存命中）", "cache"],
  ["Input Price (Cache Hit)", "cache"],
  ["输入价格（缓存未命中）", "input"],
  ["Input Price (Cache Miss)", "input"],
  ["输入价格", "input"],
  ["Input Price", "input"],
  ["输出价格", "output"],
  ["Output Price", "output"],
  ["上下文窗口", "context"],
  ["Context Window", "context"],
]);
const apiSchema = z
  .object({
    object: z.literal("list"),
    data: z.array(z.unknown()).min(1),
  })
  .strict();
const apiItemSchema = z.object({
  id: modelIdSchema,
  object: z.literal("model"),
  created: z.number().int().nonnegative(),
  owned_by: z.string().min(1),
  context_length: z.number().int().positive(),
  supports_image_in: z.boolean().optional(),
  supports_video_in: z.boolean().optional(),
  supports_reasoning: z.boolean().optional(),
});

function bounded(
  input: Input,
  kind: "kimi-openapi" | "kimi-catalog" | "kimi-pricing" | "kimi-releases" | "kimi-api",
  models: ProviderModel[],
): ProviderModel[] {
  const extractor = input.source.extractor;
  if (extractor.kind !== kind) throw new Error(`Wrong ${kind} extractor`);
  assertItemCount(`Kimi ${kind}`, models.length, extractor.minModels, extractor.maxModels);
  return models.sort((left, right) => left.model_id.localeCompare(right.model_id));
}

function properties(value: unknown): Record<string, unknown> {
  return propertiesSchema.parse(value).properties;
}

function componentName(ref: string): string {
  const name = ref.split("/").at(-1);
  if (name === undefined) throw new Error("Kimi OpenAPI schema reference omitted a name");
  return name;
}

function exactPropertyNames(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const observed = Object.keys(value).sort();
  const reviewed = [...expected].sort();
  if (observed.join("\0") !== reviewed.join("\0"))
    throw new Error(`Kimi OpenAPI changed ${label}: ${observed.join(", ")}`);
}

function validateModelListSchema(spec: z.infer<typeof openApiSchema>): void {
  const schema = spec.paths[modelsPath].get.responses["200"].content["application/json"].schema;
  const root = typedObjectSchema.parse(schema).properties;
  exactPropertyNames(root, ["object", "data"], "List Models response fields");
  z.object({ type: z.literal("string"), example: z.literal("list") }).parse(root.object);
  const data = typedArraySchema.parse(root.data);
  const item = typedObjectSchema.parse(data.items).properties;
  exactPropertyNames(
    item,
    [
      "id",
      "object",
      "created",
      "owned_by",
      "context_length",
      "supports_image_in",
      "supports_video_in",
      "supports_reasoning",
    ],
    "List Models item fields",
  );
  typedStringSchema.parse(item.id);
  z.object({ type: z.literal("string"), example: z.literal("model") }).parse(item.object);
  typedIntegerSchema.parse(item.created);
  typedStringSchema.parse(item.owned_by);
  typedIntegerSchema.parse(item.context_length);
  typedBooleanSchema.parse(item.supports_image_in);
  typedBooleanSchema.parse(item.supports_video_in);
  typedBooleanSchema.parse(item.supports_reasoning);
}

function estimateModelIds(spec: z.infer<typeof openApiSchema>): string[] {
  const ref = spec.paths[estimatePath].post.requestBody.content["application/json"].schema.$ref;
  return modelPropertySchema.parse(properties(spec.components.schemas[componentName(ref)]).model)
    .enum;
}

function outputLimits(value: unknown): { name: string; max: number }[] {
  const { description } = maxCompletionSchema.parse(value);
  const matches = [
    ...description.matchAll(
      /(?:^|[.;:]\s+)for (.+?) it defaults to ([\d,]+) and can be set up to ([\d,]+)/gi,
    ),
    ...description.matchAll(
      /(?:^|[。；：]\s*)([A-Za-z][A-Za-z0-9 ._-]+?)\s+默认为\s*([\d,]+)，最大可设置为\s*([\d,]+)/g,
    ),
  ];
  if (matches.length === 0) throw new Error("Kimi OpenAPI changed output limit descriptions");
  return matches.map((match) => {
    const name = match[1]?.trim();
    const initial = Number(match[2]?.replaceAll(",", ""));
    const max = Number(match[3]?.replaceAll(",", ""));
    if (
      name === undefined ||
      name === "" ||
      !Number.isSafeInteger(initial) ||
      !Number.isSafeInteger(max) ||
      initial <= 0 ||
      max < initial
    )
      throw new Error("Kimi OpenAPI published an invalid output limit");
    return { name, max };
  });
}

function requestFacts(
  ref: string,
  schemas: Record<string, unknown>,
): {
  ids: string[];
  reasoning: boolean;
  effort: boolean;
  outputLimits: { name: string; max: number }[];
} {
  const component = schemas[componentName(ref)];
  const parts = allOfSchema.parse(component).allOf;
  const own = parts.flatMap((part) => {
    const parsed = propertiesSchema.safeParse(part);
    return parsed.success ? [parsed.data.properties] : [];
  });
  if (own.length !== 1) throw new Error(`Kimi OpenAPI request ${ref} omitted its properties`);
  const ownProperties = own[0];
  if (ownProperties === undefined)
    throw new Error(`Kimi OpenAPI request ${ref} omitted properties`);
  const ids = modelPropertySchema.parse(ownProperties.model).enum;
  const commonRefs = parts.flatMap((part) => {
    const parsed = referenceSchema.safeParse(part);
    return parsed.success ? [parsed.data.$ref] : [];
  });
  if (commonRefs.length !== 1) throw new Error(`Kimi OpenAPI request ${ref} omitted its base`);
  const commonRef = commonRefs[0];
  if (commonRef === undefined) throw new Error(`Kimi OpenAPI request ${ref} omitted its base`);
  const common = properties(schemas[componentName(commonRef)]);
  const responseFormat = properties(common.response_format);
  const formats = enumSchema.parse(responseFormat.type).enum;
  if (!["text", "json_object", "json_schema"].every((value) => formats.includes(value)))
    throw new Error("Kimi OpenAPI changed structured output");
  if (z.object({ type: z.literal("boolean") }).safeParse(common.stream).success === false)
    throw new Error("Kimi OpenAPI changed streaming schema");
  const includeUsage = includeUsageSchema.parse(properties(common.stream_options).include_usage);
  if (
    !/(?:entire request|整个请求)/i.test(includeUsage.description) ||
    !/(?:interrupted|流中断)/i.test(includeUsage.description)
  )
    throw new Error("Kimi OpenAPI changed streaming usage semantics");
  const toolRef = z.object({ items: referenceSchema }).parse(common.tools).items.$ref;
  const toolType = properties(schemas[componentName(toolRef)]).type;
  if (!enumSchema.parse(toolType).enum.includes("function"))
    throw new Error("Kimi OpenAPI changed tool schema");
  if (common.tool_choice === undefined)
    throw new Error("Kimi OpenAPI request base omitted tool_choice");
  if (z.object({ type: z.literal("string") }).safeParse(common.prompt_cache_key).success === false)
    throw new Error("Kimi OpenAPI changed prompt cache schema");
  const efforts =
    ownProperties.reasoning_effort === undefined
      ? undefined
      : enumSchema.parse(ownProperties.reasoning_effort).enum;
  if (efforts !== undefined && !["low", "high", "max"].every((value) => efforts.includes(value)))
    throw new Error(`Kimi OpenAPI request ${ref} changed reasoning effort`);
  const reasoning =
    ownProperties.thinking === undefined
      ? efforts !== undefined
      : enumSchema.parse(properties(ownProperties.thinking).type).enum.includes("enabled");
  if (ownProperties.thinking !== undefined && !reasoning)
    throw new Error(`Kimi OpenAPI request ${ref} changed thinking schema`);
  return {
    ids,
    reasoning,
    effort: efforts !== undefined,
    outputLimits: outputLimits(common.max_completion_tokens),
  };
}

function usageFields(value: unknown): string[] {
  const fields = properties(value);
  for (const field of Object.values(fields)) integerPropertySchema.parse(field);
  return Object.keys(fields).sort();
}

function validateUsageSchemas(spec: z.infer<typeof openApiSchema>): void {
  const response =
    spec.paths[chatPath].post.responses["200"].content["application/json"].schema.$ref;
  const stream =
    spec.paths[chatPath].post.responses["200"].content["text/event-stream"].schema.$ref;
  const expected = ["cached_tokens", "completion_tokens", "prompt_tokens", "total_tokens"];
  for (const [label, ref] of [
    ["response", response],
    ["stream", stream],
  ] as const) {
    const component = properties(spec.components.schemas[componentName(ref)]);
    if (usageFields(component.usage).join("\0") !== expected.join("\0"))
      throw new Error(`Kimi OpenAPI changed ${label} usage fields`);
  }
}

export function parseKimiOpenApi(input: Input): ProviderModel[] {
  const spec = openApiSchema.parse(JSON.parse(input.body));
  const extractor = input.source.extractor;
  if (extractor.kind !== "kimi-openapi") throw new Error("Wrong kimi-openapi extractor");
  if (spec.servers[0]?.url !== extractor.baseUrl)
    throw new Error("Kimi OpenAPI changed its server");
  validateModelListSchema(spec);
  validateUsageSchemas(spec);
  const mapping =
    spec.paths[chatPath].post.requestBody.content["application/json"].schema.discriminator.mapping;
  const entries = Object.entries(mapping);
  const estimateIds = estimateModelIds(spec).sort();
  const chatIds = entries.map(([id]) => id).sort();
  if (estimateIds.join("\0") !== chatIds.join("\0"))
    throw new Error("Kimi OpenAPI token estimator disagrees with Chat model IDs");
  const facts = new Map<string, ReturnType<typeof requestFacts>>();
  for (const ref of new Set(Object.values(mapping)))
    facts.set(ref, requestFacts(ref, spec.components.schemas));
  for (const [ref, observed] of facts) {
    const mapped = entries
      .filter(([, candidate]) => candidate === ref)
      .map(([id]) => id)
      .sort();
    if (mapped.join("\0") !== [...observed.ids].sort().join("\0"))
      throw new Error(`Kimi OpenAPI mapping disagrees with ${ref}`);
  }
  const describedLimits = new Map<string, { name: string; max: number }>();
  for (const observed of facts.values()) {
    for (const limit of observed.outputLimits) {
      const key = identity(limit.name);
      const current = describedLimits.get(key);
      if (current !== undefined && current.max !== limit.max)
        throw new Error(`Kimi OpenAPI output limits disagree for ${limit.name}`);
      describedLimits.set(key, limit);
    }
  }
  const maxOutputs = new Map<string, number>();
  for (const limit of describedLimits.values()) {
    const matches = entries.map(([id]) => id).filter((id) => identity(id) === identity(limit.name));
    if (matches.length !== 1)
      throw new Error(`Kimi OpenAPI output limit identity is ambiguous: ${limit.name}`);
    const id = matches[0];
    if (id === undefined) throw new Error(`Kimi OpenAPI omitted ${limit.name}`);
    maxOutputs.set(id, limit.max);
  }
  const models = entries.map(([id, ref]) => {
    const observed = facts.get(ref);
    if (observed === undefined) throw new Error(`Kimi OpenAPI omitted ${ref}`);
    return {
      ...baseModel({
        providerId: input.provider.id,
        id,
        name: id,
        sourceId: input.source.id,
        observedAt: input.observedAt,
      }),
      tasks: ["text_generation"],
      modalities: { input: ["text"], output: ["text"] },
      api_endpoints: [{ name: "Chat Completions", path: chatPath }],
      limits: { max_output_tokens: maxOutputs.get(id) },
      capabilities: {
        ...unknownCapabilities(),
        reasoning: observed.reasoning ? true : "unknown",
        tool_call: true,
        structured_output: true,
        streaming: true,
        prompt_cache: true,
        effort_control: observed.effort ? true : "unknown",
      },
      status: "active",
    } satisfies ProviderModel;
  });
  return bounded(input, "kimi-openapi", models);
}

interface MarkdownTable {
  section: string;
  headers: string[];
  rows: string[][];
}

function markdownCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
}

function markdownTables(body: string): MarkdownTable[] {
  const lines = body.split(/\r?\n/);
  const tables: MarkdownTable[] = [];
  let section = "";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const heading = line.match(/^##\s+(.+)$/)?.[1];
    if (heading !== undefined) section = heading.trim();
    const separator = lines[index + 1];
    if (!line.trim().startsWith("|") || separator === undefined) continue;
    const headers = markdownCells(line);
    if (!markdownCells(separator).every((cell) => /^:?-{3,}:?$/.test(cell))) continue;
    const rows: string[][] = [];
    index += 2;
    while ((lines[index] ?? "").trim().startsWith("|")) {
      rows.push(markdownCells(lines[index] ?? ""));
      index += 1;
    }
    index -= 1;
    if (rows.some((row) => row.length !== headers.length))
      throw new Error("Kimi Markdown table has inconsistent columns");
    tables.push({ section, headers, rows });
  }
  return tables;
}

function exactCode(value: string): string {
  const match = value.match(/^`([^`]+)`$/);
  if (match?.[1] === undefined)
    throw new Error(`Kimi model cell is not an exact code ID: ${value}`);
  return modelIdSchema.parse(match[1]);
}

function modelDate(year: string, month: string, day: string): string {
  const value = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  if (!z.iso.date().safeParse(value).success) throw new Error(`Invalid Kimi date: ${value}`);
  return value;
}

function tokenCount(value: string): number | undefined {
  const exact = value.match(/([\d,]+)\s*tokens?/i)?.[1];
  if (exact !== undefined) {
    const result = Number(exact.replaceAll(",", ""));
    if (!Number.isSafeInteger(result)) throw new Error(`Invalid Kimi token count: ${value}`);
    return result;
  }
  const scaled = value
    .match(/(\d+(?:\.\d+)?)\s*(万|[kKmM])(?:\s*-?\s*(?:token|上下文)|\s*$)/i)
    ?.slice(1);
  if (scaled === undefined) return undefined;
  const [raw, suffix] = scaled;
  if (raw === undefined || suffix === undefined) return undefined;
  const multiplier = suffix === "万" ? 10_000 : suffix.toLowerCase() === "m" ? 1_000_000 : 1_000;
  const result = Number(raw) * multiplier;
  if (!Number.isSafeInteger(result)) throw new Error(`Invalid Kimi token count: ${value}`);
  return result;
}

function catalogContextTokens(value: string): number | undefined {
  const context = "(?:上下文(?:长度|窗口)?|context(?:\\s+(?:length|window))?)";
  const quantity = "(?:[\\d,]+(?:\\.\\d+)?\\s*(?:万|[kKmM])?(?:\\s*-?\\s*tokens?)?)";
  const before = value.match(new RegExp(`(${quantity})\\s*${context}`, "i"))?.[1];
  const after = value.match(
    new RegExp(`${context}\\s*(?:[:：]|of|is)?\\s*(${quantity})`, "i"),
  )?.[1];
  const observed = before ?? after;
  return observed === undefined ? undefined : tokenCount(observed);
}

function catalogModel(
  input: Input,
  id: string,
  description: string | undefined,
  status: ProviderModel["status"],
  retiredAt?: string,
  replacements: string[] = [],
  releaseStage: ProviderModel["release_stage"] = "unknown",
): ProviderModel {
  const prose = description ?? "";
  const media = /视觉|图片|visual|image/i.test(prose) ? ["image" as const] : [];
  const video = /视频输入|video input/i.test(prose) ? ["video" as const] : [];
  return {
    ...baseModel({
      providerId: input.provider.id,
      id,
      name: id,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    }),
    description,
    tasks: ["text_generation"],
    modalities: { input: ["text", ...media, ...video], output: ["text"] },
    capabilities: {
      ...unknownCapabilities(),
      reasoning: /思考|推理|thinking|reasoning/i.test(prose) ? true : "unknown",
    },
    limits: { context_tokens: catalogContextTokens(prose) },
    status,
    release_stage: releaseStage,
    retired_at: retiredAt,
    replacement_model_ids: replacements,
  };
}

interface RetirementNotice {
  id: string;
  date: string;
  replacement: string;
}

function retiredSeriesNotice(body: string): RetirementNotice | undefined {
  const chinese = body.match(
    /`([^`]+)` 系列模型已于 \*\*(\d{4}) 年 (\d{1,2}) 月 (\d{1,2}) 日下线\*\*.*\[([^\]]+)\]/,
  );
  if (
    chinese?.[1] !== undefined &&
    chinese[2] !== undefined &&
    chinese[3] !== undefined &&
    chinese[4] !== undefined &&
    chinese[5] !== undefined
  )
    return {
      id: modelIdSchema.parse(chinese[1]),
      date: modelDate(chinese[2], chinese[3], chinese[4]),
      replacement: modelIdSchema.parse(chinese[5]),
    };
  const english = body.match(
    /The `([^`]+)` series models were officially discontinued on \*\*([A-Z][a-z]+ \d{1,2}, \d{4})\*\*.*\[([^\]]+)\]/,
  );
  const date = english?.[2] === undefined ? undefined : englishDate(english[2]);
  if (english?.[1] === undefined || date === undefined || english[3] === undefined)
    return undefined;
  return {
    id: modelIdSchema.parse(english[1]),
    date,
    replacement: modelIdSchema.parse(english[3]),
  };
}

function retiredModelNotice(line: string): RetirementNotice | undefined {
  const chinese = line.match(
    /^>\s*`([^`]+)` 已于 \*\*(\d{4}) 年 (\d{1,2}) 月 (\d{1,2}) 日下线\*\*.*\[([^\]]+)\]/,
  );
  if (
    chinese?.[1] !== undefined &&
    chinese[2] !== undefined &&
    chinese[3] !== undefined &&
    chinese[4] !== undefined &&
    chinese[5] !== undefined
  )
    return {
      id: modelIdSchema.parse(chinese[1]),
      date: modelDate(chinese[2], chinese[3], chinese[4]),
      replacement: modelIdSchema.parse(chinese[5]),
    };
  const english = line.match(
    /^>\s*`([^`]+)` was officially discontinued on \*\*([A-Z][a-z]+ \d{1,2}, \d{4})\*\*.*\[([^\]]+)\]/,
  );
  const date = english?.[2] === undefined ? undefined : englishDate(english[2]);
  if (english?.[1] === undefined || date === undefined || english[3] === undefined)
    return undefined;
  return {
    id: modelIdSchema.parse(english[1]),
    date,
    replacement: modelIdSchema.parse(english[3]),
  };
}

export function parseKimiCatalog(input: Input): ProviderModel[] {
  const tables = markdownTables(input.body).filter(
    (table) =>
      (table.headers[0] === "模型名称" && table.headers[1] === "描述") ||
      (table.headers[0] === "Model Name" && table.headers[1] === "Description"),
  );
  if (tables.length !== 3) throw new Error("Kimi model catalog table structure changed");
  const restriction = input.body
    .split(/\r?\n/)
    .find((line) =>
      /已停止向新注册用户开放|no longer available to newly registered users/i.test(line),
    );
  if (restriction === undefined) throw new Error("Kimi restricted-model notice is missing");
  const restricted = [...restriction.matchAll(/`([^`]+)`(\s*系列模型|\s+series)?/gi)].map(
    (match) => ({
      id: modelIdSchema.parse(match[1]),
      series: match[2] !== undefined,
    }),
  );
  if (restricted.length === 0) throw new Error("Kimi restricted-model notice omitted model IDs");
  const retiredNotice = retiredSeriesNotice(input.body);
  if (retiredNotice === undefined) throw new Error("Kimi retired-series date is missing");
  const retiredSeries = retiredNotice.id;
  const retiredAt = retiredNotice.date;
  const retiredReplacement = retiredNotice.replacement;
  const models = tables.flatMap((table) =>
    table.rows.map((row) => {
      const id = exactCode(row[0] ?? "");
      const description = row[1]?.trim() || undefined;
      const retired = table.section === "已下线模型" || table.section === "Deprecated Models";
      if (retired && id !== retiredSeries && !id.startsWith(`${retiredSeries}-`))
        throw new Error(`Kimi retired table contains ${id} outside ${retiredSeries}`);
      const legacy = restricted.some(({ id: restrictedId, series }) =>
        series ? id === restrictedId || id.startsWith(`${restrictedId}-`) : id === restrictedId,
      );
      const status: ProviderModel["status"] = retired ? "retired" : legacy ? "legacy" : "active";
      return catalogModel(
        input,
        id,
        description,
        status,
        retired ? retiredAt : undefined,
        retired ? [retiredReplacement] : [],
        id.includes("preview") ? "preview" : "unknown",
      );
    }),
  );
  const retiredLines = input.body
    .split(/\r?\n/)
    .filter(
      (line) =>
        line.startsWith(">") &&
        !/系列模型|series models/i.test(line) &&
        /已于.*下线|was officially discontinued/i.test(line),
    );
  for (const line of retiredLines) {
    const retired = retiredModelNotice(line);
    if (retired === undefined) throw new Error(`Kimi retired-model notice changed: ${line}`);
    models.push(
      catalogModel(input, retired.id, undefined, "retired", retired.date, [retired.replacement]),
    );
  }
  if (new Set(models.map(({ model_id }) => model_id)).size !== models.length)
    throw new Error("Kimi catalog returned duplicate model IDs");
  return bounded(input, "kimi-catalog", models);
}

function jsonArrayAfter(body: string, marker: string): unknown {
  const markerIndex = body.indexOf(marker);
  const start = body.indexOf("[", markerIndex + marker.length);
  if (markerIndex < 0 || start < 0) throw new Error(`Kimi document omitted ${marker}`);
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < body.length; index += 1) {
    const character = body[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    if (character === "[") depth += 1;
    if (character === "]") {
      depth -= 1;
      if (depth === 0) {
        const json = body
          .slice(start, index + 1)
          .replace(/<code>\{"([^"]+)"\}([^<]+)<\/code>/g, (_match, prefix: string, value: string) =>
            JSON.stringify(`${prefix}${value}`),
          )
          .replace(
            /<>([^<]*)<code>([^<]+)<\/code>([^<]*)<\/>/g,
            (_match, before: string, code: string, after: string) =>
              JSON.stringify(`${before}${code}${after}`),
          )
          .replace(
            /<>\{"([^"]+)"\}((?:0|[1-9]\d*)(?:\.\d+)?)<\/>/g,
            (_match, symbol: string, amount: string) => JSON.stringify(`${symbol}${amount}`),
          );
        return JSON.parse(withoutTrailingCommas(json));
      }
    }
  }
  throw new Error(`Kimi document contains an unterminated ${marker}`);
}

function withoutTrailingCommas(value: string): string {
  let result = "";
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? "";
    if (quoted) {
      result += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    if (character === ",") {
      let next = index + 1;
      while (/\s/.test(value[next] ?? "")) next += 1;
      if (value[next] === "]" || value[next] === "}") continue;
    }
    result += character;
  }
  return result;
}

function hasCachePrices(body: string): boolean {
  const rows = body.indexOf("rows={");
  const start = body.lastIndexOf("<DocTable", rows);
  if (start < 0 || rows < 0) throw new Error("Kimi pricing table is missing");
  const columns = [...body.slice(start, rows).matchAll(/\{\s*title:\s*"([^"]+)"/g)].map((match) =>
    priceColumns.get(match[1] ?? ""),
  );
  if (columns.some((column) => column === undefined))
    throw new Error("Kimi pricing table has an unknown column");
  const signature = columns.join(",");
  if (signature === "model,unit,cache,input,output,context") return true;
  if (signature === "model,unit,input,output,context") return false;
  throw new Error(`Kimi pricing table has unsupported columns: ${signature}`);
}

type PricingExtractor = Extract<SourceManifest["extractor"], { kind: "kimi-pricing" }>;

function decimalPrice(value: string, symbol: PricingExtractor["symbol"]): string {
  const amount = value.startsWith(symbol) ? value.slice(symbol.length) : "";
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(amount)) throw new Error(`Invalid Kimi price: ${value}`);
  return amount;
}

function priceRate(
  meter: SourcePriceFact["meter"],
  value: string,
  sourceId: string,
  conditions: SourcePriceFact["conditions"],
  extractor: PricingExtractor,
): SourcePriceFact {
  return {
    meter,
    price: decimalPrice(value, extractor.symbol),
    currency: extractor.currency,
    unit: "million_tokens",
    conditions,
    source_ref: sourceId,
    derived: false,
    raw_price: value,
    raw_unit: "1M tokens",
  };
}

function identity(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function displayNames(body: string): string[] {
  const names: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const heading = line.match(/^#\s+(.+?)(?:\s+模型)?(?:定价|Pricing)\s*$/i)?.[1];
    if (heading !== undefined)
      names.push(
        heading
          .replace(
            /^(?:(?:旗舰|编程|多模态|生成)模型|(?:Flagship|Coding|Multi-modal|Generation) Model)\s+/i,
            "",
          )
          .trim(),
      );
    const bullet = line.match(/^[-*]\s+(.+?)\s+(?:是|is)\s+/i)?.[1];
    if (bullet !== undefined) names.push(bullet.trim());
  }
  return [...new Set(names)];
}

function pricingModel(
  input: Input,
  extractor: PricingExtractor,
  body: string,
  row: string[],
  batch: boolean,
  cached: boolean,
): ProviderModel {
  const rawId = row[0];
  const rawUnit = row[1];
  if (rawId === undefined || rawUnit !== "1M tokens")
    throw new Error("Kimi pricing row omitted its model or unit");
  const suffix = rawId.match(/\s*[（(]Batch[）)]$/)?.[0];
  if (batch !== (suffix !== undefined)) throw new Error("Kimi Batch label disagrees with its page");
  const id = modelIdSchema.parse(suffix === undefined ? rawId : rawId.slice(0, -suffix.length));
  if (row.length !== (cached ? 6 : 5))
    throw new Error(`Kimi pricing columns disagree with the row for ${id}`);
  const context = row.at(-1);
  const contextTokens = context === undefined ? undefined : tokenCount(context);
  if (contextTokens === undefined) throw new Error(`Kimi pricing omitted context for ${id}`);
  const conditions: SourcePriceFact["conditions"] = {
    region: extractor.region,
    ...(batch ? { service_tier: "batch" } : {}),
  };
  const prices = cached
    ? [
        priceRate("cache_read_text", row[2] ?? "", input.source.id, conditions, extractor),
        priceRate("input_text", row[3] ?? "", input.source.id, conditions, extractor),
        priceRate("output_text", row[4] ?? "", input.source.id, conditions, extractor),
      ]
    : [
        priceRate("input_text", row[2] ?? "", input.source.id, conditions, extractor),
        priceRate("output_text", row[3] ?? "", input.source.id, conditions, extractor),
      ];
  const names = displayNames(body).filter((name) => identity(name) === identity(id));
  if (names.length > 1) throw new Error(`Kimi pricing display name for ${id} is ambiguous`);
  const multimedia = /支持文本、图片与视频输入|supports text, image, and video input/i.test(body);
  const image = multimedia || id.includes("-vision-") ? ["image" as const] : [];
  const video = multimedia ? ["video" as const] : [];
  return {
    ...baseModel({
      providerId: input.provider.id,
      id,
      name: names[0] ?? id,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    }),
    tasks: ["text_generation"],
    modalities: { input: ["text", ...image, ...video], output: ["text"] },
    api_endpoints: batch ? [{ name: "Batch", path: batchPath }] : undefined,
    capabilities: {
      ...unknownCapabilities(),
      reasoning: /思考|推理|reason|thinking/i.test(body) ? true : "unknown",
      tool_call: /ToolCalls|工具调用/.test(body) ? true : "unknown",
      structured_output: /JSON Mode|结构化输出/.test(body) ? true : "unknown",
      batch: batch ? true : "unknown",
    },
    limits: { context_tokens: contextTokens },
    pricing_state: "numeric",
    price_facts: prices,
  };
}

function mergeTruth(
  current: boolean | "unknown",
  incoming: boolean | "unknown",
): boolean | "unknown" {
  if (current === "unknown") return incoming;
  if (incoming === "unknown" || incoming === current) return current;
  throw new Error("Kimi pricing documents disagree on a capability");
}

function mergePricing(current: ProviderModel, incoming: ProviderModel): ProviderModel {
  if (
    current.name !== current.model_id &&
    incoming.name !== incoming.model_id &&
    current.name !== incoming.name
  )
    throw new Error(`Kimi pricing documents disagree on the name of ${current.model_id}`);
  if (current.limits.context_tokens !== incoming.limits.context_tokens)
    throw new Error(`Kimi pricing documents disagree on the context of ${current.model_id}`);
  const rates = [...current.price_facts, ...incoming.price_facts];
  const keys = rates.map(
    (rate) => `${rate.meter}\0${JSON.stringify(rate.conditions)}\0${rate.currency}\0${rate.unit}`,
  );
  if (new Set(keys).size !== keys.length)
    throw new Error(`Kimi pricing documents duplicate a rate for ${current.model_id}`);
  return {
    ...current,
    name: current.name === current.model_id ? incoming.name : current.name,
    modalities: {
      input: [...new Set([...current.modalities.input, ...incoming.modalities.input])],
      output: [...new Set([...current.modalities.output, ...incoming.modalities.output])],
    },
    api_endpoints: current.api_endpoints ?? incoming.api_endpoints,
    capabilities: {
      ...current.capabilities,
      reasoning: mergeTruth(current.capabilities.reasoning, incoming.capabilities.reasoning),
      tool_call: mergeTruth(current.capabilities.tool_call, incoming.capabilities.tool_call),
      structured_output: mergeTruth(
        current.capabilities.structured_output,
        incoming.capabilities.structured_output,
      ),
      batch: mergeTruth(current.capabilities.batch, incoming.capabilities.batch),
    },
    price_facts: rates,
  };
}

function companion(bundle: LinkedBundle, path: string, label: string): string {
  return linkedDocumentBody(bundle, path, `Kimi pricing omitted the ${label} reference`);
}

function requireClaims(body: string, claims: readonly RegExp[], message: string): void {
  const normalized = body.replace(/\\([_$*])/g, "$1");
  if (claims.some((claim) => !claim.test(normalized))) throw new Error(message);
}

function commercialIndexPath(path: string): boolean {
  const normalized = path.replace(/\.md$/, "");
  if (normalized.startsWith("/docs/pricing/")) return true;
  if (
    /^\/docs\/api\/[^/]*(?:balance|billing|cost|usage|spend|expense|consumption)[^/]*$/.test(
      normalized,
    ) ||
    normalized === "/docs/api/chat" ||
    normalized === "/docs/api/estimate"
  )
    return true;
  if (
    [
      "/docs/guide/account-and-payments",
      "/docs/guide/org-best-practice",
      "/docs/guide/product-plans",
      "/docs/guide/use-batch-api",
      "/docs/guide/use-batch-inference",
      "/docs/guide/use-context-caching-feature-of-kimi-api",
      "/docs/guide/use-official-tools",
      "/docs/guide/use-web-search",
    ].includes(normalized) ||
    /^\/docs\/guide\/[^/]*(?:billing|payment|cost|spend|budget)[^/]*$/.test(normalized)
  )
    return true;
  if (normalized === "/docs/agreement/modeluse") return true;
  return normalized === "/docs/introduction";
}

function validateCommercialIndex(bundle: LinkedBundle, origin: string): void {
  const body = companion(bundle, "/docs/llms.txt", "documentation index");
  const indexed = new Set(
    [...body.matchAll(/\]\((https?:\/\/[^)]+)\)/g)]
      .map((match) => match[1])
      .filter((url): url is string => url !== undefined)
      .map((url) => new URL(url))
      .filter((url) => url.origin === origin && commercialIndexPath(url.pathname))
      .map((url) => url.pathname.replace(/\.md$/, "")),
  );
  if (indexed.size === 0) throw new Error("Kimi documentation index omitted commercial pages");
  const selected = new Set(
    [bundle.index, ...bundle.documents].map(({ url }) => new URL(url).pathname),
  );
  const missing = [...indexed].filter((path) => !selected.has(path)).sort();
  if (missing.length > 0)
    throw new Error(
      `Kimi documentation index has unreviewed commercial pages: ${missing.join(", ")}`,
    );
}

function exactDocumentModelIds(body: string): string[] {
  const prose = body.replace(/```[\s\S]*?```/g, "");
  return [
    ...new Set(
      [...prose.matchAll(/`([^`]+)`/g)]
        .map((match) => match[1])
        .filter((value): value is string => value !== undefined)
        .flatMap((value) => {
          const parsed = modelIdSchema.safeParse(value);
          return parsed.success ? [parsed.data] : [];
        }),
    ),
  ];
}

function guideModels(body: string, models: Map<string, ProviderModel>, label: string): string[] {
  const reviewedProse = body.split("<Tabs>")[0] ?? "";
  const ids = exactDocumentModelIds(reviewedProse).filter((id) => models.has(id));
  if (ids.length === 0) throw new Error(`Kimi ${label} guide omitted exact supported model IDs`);
  return ids.sort();
}

function batchGuideModels(body: string): string[] {
  const support = body.split(/\r?\n/).find((line) => /Batch API (?:supports|支持)/i.test(line));
  if (support === undefined) throw new Error("Kimi Batch guide omitted its supported models");
  const supportedClause = support.split(/;|；|，暂不支持/)[0] ?? "";
  const ids = exactDocumentModelIds(supportedClause);
  if (ids.length === 0) throw new Error("Kimi Batch guide omitted exact supported model IDs");
  return ids.sort();
}

function webSearchRate(input: Input, extractor: PricingExtractor, body: string): SourcePriceFact {
  const rows = z
    .array(z.array(z.string()).min(3).max(4))
    .length(1)
    .parse(jsonArrayAfter(body, "rows={"));
  const row = rows[0];
  if (row === undefined) throw new Error("Kimi web-search pricing omitted its row");
  const [name, unit] = row;
  const rawPrice = row[2];
  if (
    name === undefined ||
    unit === undefined ||
    rawPrice === undefined ||
    !(/联网搜索/.test(name) || name === "$web_search") ||
    !(/1 次/.test(unit) || /Per successful tool call/i.test(unit))
  )
    throw new Error("Kimi web-search pricing row changed");
  return {
    meter: "tool_call",
    price: decimalPrice(rawPrice.replace("￥", "¥"), extractor.symbol),
    currency: extractor.currency,
    unit: "request",
    conditions: { region: extractor.region, operation: "web_search" },
    source_ref: input.source.id,
    derived: false,
    raw_price: rawPrice,
    raw_unit: unit,
  };
}

function batchModelIds(models: Map<string, ProviderModel>): string[] {
  return [...models.values()]
    .filter((model) =>
      model.price_facts.some(({ conditions }) => conditions.service_tier === "batch"),
    )
    .map(({ model_id }) => model_id)
    .sort();
}

function formulaTools(body: string): string[] {
  const tables = markdownTables(body).filter(
    ({ headers }) => headers[0] === "Tool Name" || headers[0] === "工具名称",
  );
  const [table] = tables;
  if (tables.length !== 1 || table === undefined)
    throw new Error("Kimi official-tools table changed");
  const names = table.rows.map((row) => exactCode(row[0] ?? ""));
  if (new Set(names).size !== names.length || !names.includes("web-search"))
    throw new Error("Kimi official-tools identities changed");
  return names;
}

function freeFormulaRates(
  input: Input,
  extractor: PricingExtractor,
  names: string[],
): SourcePriceFact[] {
  return names
    .filter((name) => name !== "web-search")
    .map((name) => ({
      meter: "tool_call",
      price: "0",
      currency: extractor.currency,
      unit: "request",
      conditions: {
        region: extractor.region,
        operation: `formula_${name.replaceAll("-", "_")}`,
        promotion: true,
      },
      source_ref: input.source.id,
      derived: false,
      raw_price: extractor.region === "China" ? "限时免费" : "free for a limited time",
      raw_unit: "tool call",
    }));
}

interface CommercialEvidence {
  formulaModels: string[];
  formulaRates: SourcePriceFact[];
  searchModels: string[];
  searchRate: SourcePriceFact;
  reconciliation: PricingReconciliationItem[];
}

function commercialEvidence(
  input: Input,
  extractor: PricingExtractor,
  bundle: LinkedBundle,
  models: Map<string, ProviderModel>,
): CommercialEvidence {
  validateCommercialIndex(bundle, new URL(input.source.url).origin);
  const china = extractor.region === "China";
  requireClaims(
    bundle.index.body,
    china
      ? [/联网搜索/, /更新升级中/, /文档已经过时/]
      : [/web search/i, /currently being updated/i, /documentation is outdated/i],
    "Kimi K3 web-search warning drifted",
  );
  requireClaims(
    companion(bundle, "/docs/pricing/chat", "billing"),
    china
      ? [/对 Input 和 Output 均实行按量计费/, /计算 Token API/, /限时免费/]
      : [
          /bill both the Input and Output based on usage/i,
          /Token Calculation API/,
          /temporarily free/i,
        ],
    "Kimi billing contract drifted",
  );
  requireClaims(
    companion(bundle, "/docs/api/chat", "Chat Completions"),
    [/prompt_tokens/, /completion_tokens/, /total_tokens/, /cached_tokens/, /include_usage/],
    "Kimi response-usage contract drifted",
  );
  requireClaims(
    companion(bundle, "/docs/api/estimate", "token estimate"),
    [/\/v1\/tokenizers\/estimate-token-count/, /data\.total_tokens/],
    "Kimi token-estimate contract drifted",
  );
  requireClaims(
    companion(bundle, cacheDocument, "context cache"),
    china
      ? [/对所有模型请求自动启用/, /(?:超过|大于) 256/, /无需手动/]
      : [/automatically enabled for all model requests/i, /exceed 256/i, /no manual/i],
    "Kimi context-cache accounting contract drifted",
  );
  const tools = companion(bundle, "/docs/pricing/tools", "web-search pricing");
  requireClaims(
    tools,
    [/finish_reason = tool_calls/, /finish_reason = stop/, /search_tokens/],
    "Kimi web-search billing contract drifted",
  );
  if (!china)
    requireClaims(
      tools,
      [/Prices exclude applicable taxes/i, /calculated at checkout/i],
      "Kimi tax contract drifted",
    );
  const webGuide = companion(bundle, "/docs/guide/use-web-search", "web-search usage");
  requireClaims(
    webGuide,
    [/arguments\.usage\.total_tokens/, /prompt_tokens/, /completion_tokens/, /total_tokens/],
    "Kimi web-search usage contract drifted",
  );
  const officialTools = companion(bundle, "/docs/guide/use-official-tools", "official tools");
  requireClaims(
    officialTools,
    china
      ? [/官方工具(?:执行)?限时免费/, /moonshot\/web-search:latest/, /资源用量/, /计费/]
      : [
          /official tools are currently free for a limited time/i,
          /moonshot\/web-search:latest/,
          /resource usage/i,
          /billing/i,
        ],
    "Kimi Formula-tools commercial contract drifted",
  );
  requireClaims(
    companion(bundle, "/docs/api/balance", "balance API"),
    [/\/v1\/users\/me\/balance/, /available_balance/, /voucher_balance/, /cash_balance/],
    "Kimi balance API contract drifted",
  );
  requireClaims(
    companion(bundle, "/docs/pricing/limits", "account limits"),
    china
      ? [/累计充值金额/, /Tier5/, /代金券不计入累计充值总额/]
      : [/cumulative recharge amount/i, /Tier5/, /Vouchers do not count/i],
    "Kimi account-tier contract drifted",
  );
  const account = companion(bundle, "/docs/guide/account-and-payments", "account billing");
  requireClaims(
    account,
    china
      ? [/项目日消费预算/, /10 分钟/, /15 元代金券/, /Kimi K3 不支持/]
      : [/daily spending budget/i, /10 minutes/i, /invoice/i, /account tier/i],
    "Kimi account-billing contract drifted",
  );
  requireClaims(
    companion(bundle, "/docs/guide/org-best-practice", "project consumption"),
    china
      ? [/月消费预算和日消费预算/, /10 分钟/, /消费分析/]
      : [/monthly and daily consumption budgets/i, /10 minutes/i, /consumption analysis/i],
    "Kimi project-consumption contract drifted",
  );
  requireClaims(
    companion(bundle, "/docs/guide/product-plans", "product plans"),
    china ? [/按量计费模式/, /企业方案/] : [/pay-as-you-go billing/i, /enterprise plans/i],
    "Kimi product-plan contract drifted",
  );
  requireClaims(
    companion(bundle, "/docs/introduction", "billing and rate limits"),
    china
      ? [/max_completion_tokens/, /实际生成的 (?:Tokens|token)/i, /用户(?:层面|级别)/]
      : [/max_completion_tokens/, /actual number of Tokens generated/i, /user level/i],
    "Kimi request-accounting contract drifted",
  );
  requireClaims(
    companion(bundle, "/docs/agreement/modeluse", "commercial terms"),
    china
      ? [/产品定价、类型/, /官网网页\/订购页面公示为准/, /价格调整说明/, /网站价格页面公示/]
      : [
          /pricing set forth on the pricing page or in an applicable Order Form/i,
          /Pricing Changes/,
          /after the effective date/i,
          /Promotions/,
        ],
    "Kimi commercial terms drifted",
  );
  requireClaims(
    companion(bundle, "/docs/guide/use-batch-inference", "Batch console"),
    [/Tier1/, china ? /以上/ : /or above/i],
    "Kimi Batch account-eligibility contract drifted",
  );
  const batchGuide = companion(bundle, "/docs/guide/use-batch-api", "Batch guide");
  requireClaims(
    batchGuide,
    china
      ? [/节省 40%/, /prompt_tokens/, /completion_tokens/, /total_tokens/]
      : [/saving 40%/i, /prompt_tokens/, /completion_tokens/, /total_tokens/],
    "Kimi Batch accounting contract drifted",
  );

  const reconciliation: PricingReconciliationItem[] = [
    { disposition: "excluded", reason_code: "balance_api_out_of_catalog" },
    { disposition: "excluded", reason_code: "account_tier_capacity_out_of_catalog" },
    { disposition: "excluded", reason_code: "project_budget_control_out_of_catalog" },
    { disposition: "excluded", reason_code: "console_consumption_analysis_out_of_catalog" },
    { disposition: "excluded", reason_code: "voucher_account_entitlement_out_of_catalog" },
    { disposition: "excluded", reason_code: "file_api_temporary_free_out_of_catalog" },
    { disposition: "excluded", reason_code: "batch_console_tier_out_of_catalog" },
    { disposition: "excluded", reason_code: "response_exact_cost_not_returned" },
    { disposition: "unbound", reason_code: "usage_cost_api_not_documented" },
    { disposition: "unbound", reason_code: "stream_interruption_usage_unavailable" },
    { disposition: "unbound", reason_code: "enterprise_terms_not_published" },
    { disposition: "unbound", reason_code: "formula_web_search_billing_trigger_ambiguous" },
    { disposition: "unbound", reason_code: "formula_tool_promotion_end_not_published" },
    { disposition: "unbound", reason_code: "web_search_documentation_outdated" },
  ];
  if (!batchGuide.includes("cached_tokens"))
    reconciliation.push({
      disposition: "unbound",
      reason_code: "batch_cached_tokens_not_documented",
    });
  if (!china)
    reconciliation.push({ disposition: "excluded", reason_code: "tax_at_checkout_out_of_catalog" });
  const batchGuideModelIds = new Set(batchGuideModels(batchGuide));
  for (const id of batchModelIds(models).filter((modelId) => !batchGuideModelIds.has(modelId)))
    reconciliation.push({
      disposition: "unbound",
      reason_code: "batch_guide_scope_conflict",
      sample: id,
    });
  return {
    formulaModels: guideModels(officialTools, models, "official-tools"),
    formulaRates: freeFormulaRates(input, extractor, formulaTools(officialTools)),
    searchModels: guideModels(webGuide, models, "web-search"),
    searchRate: webSearchRate(input, extractor, tools),
    reconciliation,
  };
}

export function parseKimiPricing(input: Input): ProviderModel[] {
  const extractor = input.source.extractor;
  if (extractor.kind !== "kimi-pricing") throw new Error("Wrong kimi-pricing extractor");
  const bundle = linkedBundleSchema.parse(JSON.parse(input.body));
  const documents = [bundle.index, ...bundle.documents];
  const batchApi = documents.find(({ url }) => new URL(url).pathname === batchApiDocument);
  if (
    batchApi === undefined ||
    !/^`{3,4}yaml POST \/v1\/batches$/m.test(batchApi.body) ||
    !/目前仅支持 \/v1\/chat\/completions|currently only \/v1\/chat\/completions is supported/i.test(
      batchApi.body,
    )
  )
    throw new Error("Kimi Batch API reference changed");
  const models = new Map<string, ProviderModel>();
  const modelPricingPaths = new Set([
    "/docs/pricing/chat-k3",
    "/docs/pricing/chat-k27-code",
    "/docs/pricing/chat-k26",
    "/docs/pricing/chat-k25",
    "/docs/pricing/chat-v1",
    "/docs/pricing/batch",
  ]);
  for (const document of documents) {
    const path = new URL(document.url).pathname;
    if (!modelPricingPaths.has(path)) continue;
    const rows = priceRowsSchema.parse(jsonArrayAfter(document.body, "rows={"));
    const batch = path === "/docs/pricing/batch";
    const cached = hasCachePrices(document.body);
    for (const row of rows) {
      const incoming = pricingModel(input, extractor, document.body, row, batch, cached);
      const current = models.get(incoming.model_id);
      models.set(
        incoming.model_id,
        current === undefined ? incoming : mergePricing(current, incoming),
      );
    }
  }
  const evidence = commercialEvidence(input, extractor, bundle, models);
  for (const id of evidence.formulaModels) {
    const model = models.get(id);
    if (model === undefined) throw new Error(`Kimi official-tools guide named unknown model ${id}`);
    models.set(id, {
      ...model,
      capabilities: { ...model.capabilities, tool_call: true },
      price_facts: [...model.price_facts, ...evidence.formulaRates],
    });
  }
  for (const id of evidence.searchModels) {
    const model = models.get(id);
    if (model === undefined) throw new Error(`Kimi web-search guide named unknown model ${id}`);
    models.set(id, {
      ...model,
      capabilities: { ...model.capabilities, tool_call: true },
      price_facts: [...model.price_facts, evidence.searchRate],
    });
  }
  const result = [...models.values()].map(
    (model): ProviderModel => ({
      ...model,
      capabilities: { ...model.capabilities, prompt_cache: true },
      price_facts: [...model.price_facts].sort((left, right) =>
        `${left.meter}\0${JSON.stringify(left.conditions)}`.localeCompare(
          `${right.meter}\0${JSON.stringify(right.conditions)}`,
        ),
      ),
    }),
  );
  for (const model of result) {
    for (const rate of model.price_facts) {
      const formula =
        rate.meter === "tool_call" &&
        rate.conditions.promotion === true &&
        rate.conditions.operation?.startsWith("formula_") === true;
      input.onPricingReconciliation?.({
        disposition: "normalized",
        reason_code: formula
          ? "formula_tool_free_rate_normalized"
          : rate.meter === "tool_call" && rate.conditions.operation === "web_search"
            ? "web_search_rate_normalized"
            : "price_fact_normalized",
        sample: formula
          ? `${model.model_id}:${extractor.region}:${rate.conditions.operation}:${rate.meter}`
          : `${model.model_id}:${extractor.region}:${rate.conditions.service_tier ?? "standard"}:${rate.meter}`,
      });
    }
  }
  for (const item of evidence.reconciliation) input.onPricingReconciliation?.(item);
  return bounded(input, "kimi-pricing", result);
}

function htmlText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function englishDate(value: string): string | undefined {
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
  return month === undefined || match?.[2] === undefined || match[3] === undefined
    ? undefined
    : modelDate(match[3], month, match[2]);
}

function releaseModel(input: Input, id: string, date: string): ProviderModel {
  return {
    ...baseModel({
      providerId: input.provider.id,
      id,
      name: id,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    }),
    release_date: date,
  };
}

export function parseKimiReleases(input: Input): ProviderModel[] {
  const bundle = linkedBundleSchema.parse(JSON.parse(input.body));
  const catalog = bundle.documents.find(
    ({ url }) =>
      new URL(url).hostname === "platform.kimi.com" && new URL(url).pathname === "/docs/models",
  );
  if (catalog === undefined) throw new Error("Kimi releases omitted the model catalog");
  const candidates = new Set(
    markdownTables(catalog.body)
      .filter((table) => table.headers[0] === "模型名称")
      .flatMap((table) => table.rows.map((row) => exactCode(row[0] ?? ""))),
  );
  const displayId = (name: string): string | undefined => {
    const matches = [...candidates].filter((id) => identity(id) === identity(name));
    if (matches.length > 1) throw new Error(`Kimi release identity is ambiguous: ${name}`);
    return matches[0];
  };
  const dates = new Map<string, string>();
  const add = (id: string, date: string): void => {
    const parsed = modelIdSchema.parse(id);
    const current = dates.get(parsed);
    dates.set(parsed, current === undefined || date < current ? date : current);
  };
  const changelog = load(bundle.index.body);
  changelog("article h2").each((_index, heading) => {
    const observed = htmlText(changelog(heading).text()).match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
    if (observed?.[1] === undefined || observed[2] === undefined || observed[3] === undefined)
      return;
    const date = modelDate(observed[1], observed[2], observed[3]);
    changelog(heading)
      .nextUntil("h2")
      .find("li")
      .each((_itemIndex, item) => {
        const prose = htmlText(changelog(item).text());
        if (!/(?:上线|发布)/.test(prose)) return;
        for (const match of prose.matchAll(/[a-z0-9][a-z0-9._/-]*-[a-z0-9._/-]+/gi)) {
          const id = match[0];
          if (id === id.toLowerCase() && modelIdSchema.safeParse(id).success) add(id, date);
        }
      });
  });
  for (const document of bundle.documents) {
    const url = new URL(document.url);
    if (document === catalog) continue;
    const $ = load(document.body);
    if (url.hostname === "www.kimi.com" && url.pathname === "/blog/") {
      $(".menu-card").each((_index, card) => {
        const name = htmlText($(card).find("h4").first().text());
        const id = displayId(name);
        const date = htmlText($(card).text())
          .match(/(\d{4})\/(\d{2})\/(\d{2})/)
          ?.slice(1);
        if (
          id !== undefined &&
          date?.[0] !== undefined &&
          date[1] !== undefined &&
          date[2] !== undefined
        )
          add(id, modelDate(date[0], date[1], date[2]));
      });
      continue;
    }
    if (url.hostname === "www.kimi.com" && url.pathname.endsWith("/whats-new.html")) {
      $(".wn-entry .wn-meta").each((_index, meta) => {
        const name = htmlText($(meta).find(".ignore-header").first().text());
        const rawDate = htmlText($(meta).find(".wn-date").first().text());
        const id = displayId(name);
        const date = englishDate(rawDate);
        if (id !== undefined && date !== undefined) add(id, date);
      });
      continue;
    }
    throw new Error(`Unexpected Kimi release page: ${url.href}`);
  }
  return bounded(
    input,
    "kimi-releases",
    [...dates].map(([id, date]) => releaseModel(input, id, date)),
  );
}

export function parseKimiApi(input: Input): ProviderModel[] {
  const list = apiSchema.parse(JSON.parse(input.body));
  const items = recognizeItems({
    label: "Kimi model inventory item",
    items: list.data,
    schema: apiItemSchema,
    modelId: "id",
    rootKeys: Object.keys(apiItemSchema.shape),
    ...(input.onContractFinding === undefined ? {} : { onFinding: input.onContractFinding }),
  });
  if (new Set(items.map(({ id }) => id)).size !== items.length)
    throw new Error("Kimi API returned duplicate model IDs");
  const models = items.map(
    (item): ProviderModel => ({
      ...baseModel({
        providerId: input.provider.id,
        id: item.id,
        name: item.id,
        sourceId: input.source.id,
        observedAt: input.observedAt,
      }),
      modalities: {
        input: [
          "text",
          ...(item.supports_image_in === true ? (["image"] as const) : []),
          ...(item.supports_video_in === true ? (["video"] as const) : []),
        ],
        output: ["text"],
      },
      capabilities: {
        ...unknownCapabilities(),
        reasoning: item.supports_reasoning ?? "unknown",
      },
      limits: { context_tokens: item.context_length },
    }),
  );
  return bounded(input, "kimi-api", models);
}
