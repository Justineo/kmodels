import { load } from "cheerio";
import { z } from "zod";
import { linkedBundleSchema, linkedDocumentBody, type LinkedBundle } from "./bundle.ts";
import { modelIdSchema } from "./identity.ts";
import {
  extractKimiCommercialFacts,
  type KimiCommercialEvidence,
} from "./kimi-commercial-source.ts";
import {
  extractKimiCommercialPricingInputs,
  extractKimiOpenApiAccounting,
} from "./kimi-accounting.ts";
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
const refSchema = z.string().regex(/^#\/components\/schemas\/[A-Za-z0-9]+$/);
const openApiSchema = z.object({
  servers: z.array(z.object({ url: z.url() })).length(1),
  paths: z
    .object({
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
    })
    .catchall(z.unknown()),
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
const priceRowSchema = z.array(z.string()).min(5).max(6);
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
  if (!/(?:entire request|整个请求)/i.test(includeUsage.description))
    throw new Error("Kimi OpenAPI changed streaming usage scope");
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

export function parseKimiOpenApi(input: Input): ProviderModel[] {
  const spec = openApiSchema.parse(JSON.parse(input.body));
  const extractor = input.source.extractor;
  if (extractor.kind !== "kimi-openapi") throw new Error("Wrong kimi-openapi extractor");
  if (spec.servers[0]?.url !== extractor.baseUrl)
    throw new Error("Kimi OpenAPI changed its server");
  validateModelListSchema(spec);
  const accounting = extractKimiOpenApiAccounting({
    spec,
    sourceRef: input.source.id,
    baseUrl: extractor.baseUrl,
    ...(input.onContractFinding === undefined ? {} : { onFinding: input.onContractFinding }),
    ...(input.onPricingReconciliation === undefined
      ? {}
      : { onReconciliation: input.onPricingReconciliation }),
  });
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
    const optionalEndpoints = accounting.endpoints
      .filter(({ modelIds }) => modelIds.includes(id))
      .map(({ name, path }) => ({ name, path }));
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
      api_endpoints: [{ name: "Chat Completions", path: chatPath }, ...optionalEndpoints],
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
  const carrier = models.toSorted((left, right) => left.uid.localeCompare(right.uid))[0];
  if (carrier !== undefined && accounting.pricingInputs.length > 0)
    carrier.pricing_inputs = accounting.pricingInputs;
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
  if (/^\/docs\/pricing\/(?:chat(?:-[a-z0-9-]+)?|batch|tools)$/.test(normalized)) return true;
  if (normalized.startsWith("/docs/api/files")) return true;
  if (
    [
      "/docs/guide/use-batch-api",
      "/docs/guide/use-official-tools",
      "/docs/guide/use-web-search",
    ].includes(normalized)
  )
    return true;
  return normalized === "/docs/api/batch-create";
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
    meter: "web_search",
    price: decimalPrice(rawPrice.replace("￥", "¥"), extractor.symbol),
    currency: extractor.currency,
    unit: "event",
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

interface CommercialEvidence extends KimiCommercialEvidence {
  reconciliation: PricingReconciliationItem[];
}

function reviewClaim<Value>(
  reconciliation: PricingReconciliationItem[],
  reasonCode: string,
  claim: () => Value,
): Value | undefined {
  try {
    return claim();
  } catch (error) {
    reconciliation.push({
      disposition: "unbound",
      reason_code: reasonCode,
      sample: (error instanceof Error ? error.message : String(error)).slice(0, 256),
    });
    return;
  }
}

function reviewedDocument(
  bundle: LinkedBundle,
  path: string,
  label: string,
  claims: readonly RegExp[],
  message: string,
): string {
  const body = companion(bundle, path, label);
  requireClaims(body, claims, message);
  return body;
}

function commercialEvidence(
  input: Input,
  extractor: PricingExtractor,
  bundle: LinkedBundle,
  models: Map<string, ProviderModel>,
): CommercialEvidence {
  const china = extractor.region === "China";
  const reconciliation: PricingReconciliationItem[] = [
    { disposition: "unbound", reason_code: "formula_web_search_billing_trigger_ambiguous" },
    { disposition: "unbound", reason_code: "formula_tool_promotion_end_not_published" },
    { disposition: "unbound", reason_code: "web_search_documentation_outdated" },
  ];
  reviewClaim(reconciliation, "commercial_index_drift", () =>
    validateCommercialIndex(bundle, new URL(input.source.url).origin),
  );
  const webSearchWarning =
    reviewClaim(reconciliation, "web_search_warning_drift", () => {
      requireClaims(
        bundle.index.body,
        china
          ? [/联网搜索/, /更新升级中/, /文档已经过时/]
          : [/web search/i, /currently being updated/i, /documentation is outdated/i],
        "Kimi K3 web-search warning drifted",
      );
      return true;
    }) ?? false;

  const review = (
    reasonCode: string,
    path: string,
    label: string,
    claims: readonly RegExp[],
    message: string,
  ) =>
    reviewClaim(reconciliation, reasonCode, () =>
      reviewedDocument(bundle, path, label, claims, message),
    );
  const billing = review(
    "billing_contract_drift",
    "/docs/pricing/chat",
    "billing",
    china
      ? [/对 Input 和 Output 均实行按量计费/, /计算 Token API/, /限时免费/]
      : [
          /bill both the Input and Output based on usage/i,
          /Token Calculation API/,
          /temporarily free/i,
        ],
    "Kimi billing contract drifted",
  );
  const tools = review(
    "web_search_billing_contract_drift",
    "/docs/pricing/tools",
    "web-search pricing",
    china
      ? [/finish_reason = tool_calls/, /finish_reason = stop/, /search_tokens/]
      : [
          /finish_reason = tool_calls/,
          /finish_reason = stop/,
          /search_tokens/,
          /Prices exclude applicable taxes/i,
          /calculated at checkout/i,
        ],
    "Kimi web-search billing contract drifted",
  );
  const webGuide = review(
    "web_search_usage_contract_drift",
    "/docs/guide/use-web-search",
    "web-search usage",
    [/arguments\.usage\.total_tokens/, /prompt_tokens/, /completion_tokens/, /total_tokens/],
    "Kimi web-search usage contract drifted",
  );
  const officialTools = review(
    "formula_tools_contract_drift",
    "/docs/guide/use-official-tools",
    "official tools",
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
  const fileDocuments = [
    review(
      "files_index_contract_drift",
      "/docs/api/files",
      "Files index",
      china
        ? [/上传文件/, /列出文件/, /获取文件信息/, /删除文件/, /获取文件内容/]
        : [/Upload File/, /List Files/, /Get File Information/, /Delete File/, /Get File Content/],
      "Kimi Files index drifted",
    ),
    review(
      "files_upload_contract_drift",
      "/docs/api/files-upload",
      "file upload",
      china
        ? [/POST \/v1\/files/, /file-extract/, /image/, /video/, /batch/, /文件解析服务限时免费/]
        : [
            /POST \/v1\/files/,
            /file-extract/,
            /image/,
            /video/,
            /batch/,
            /file parsing service is currently free/i,
          ],
      "Kimi file-upload contract drifted",
    ),
    review(
      "files_list_contract_drift",
      "/docs/api/files-list",
      "file list",
      [/GET \/v1\/files/, /purpose/, /status/],
      "Kimi file-list contract drifted",
    ),
    review(
      "files_retrieve_contract_drift",
      "/docs/api/files-retrieve",
      "file retrieval",
      [/GET \/v1\/files\/\{file_id\}/, /purpose/, /status/],
      "Kimi file-retrieval contract drifted",
    ),
    review(
      "files_delete_contract_drift",
      "/docs/api/files-delete",
      "file deletion",
      [/DELETE \/v1\/files\/\{file_id\}/, /deleted/],
      "Kimi file-deletion contract drifted",
    ),
    review(
      "files_content_contract_drift",
      "/docs/api/files-content",
      "file content",
      [/GET \/v1\/files\/\{file_id\}\/content/, /file-extract/],
      "Kimi file-content contract drifted",
    ),
  ];

  const batchGuide = review(
    "batch_accounting_contract_drift",
    "/docs/guide/use-batch-api",
    "Batch guide",
    china
      ? [/节省 40%/, /prompt_tokens/, /completion_tokens/, /total_tokens/]
      : [/saving 40%/i, /prompt_tokens/, /completion_tokens/, /total_tokens/],
    "Kimi Batch accounting contract drifted",
  );
  if (batchGuide !== undefined && !batchGuide.includes("cached_tokens"))
    reconciliation.push({
      disposition: "unbound",
      reason_code: "batch_cached_tokens_not_documented",
    });
  const batchScopeConflicts: string[] = [];
  if (batchGuide !== undefined) {
    const batchGuideModelIds = new Set(batchGuideModels(batchGuide));
    for (const id of batchModelIds(models).filter((modelId) => !batchGuideModelIds.has(modelId))) {
      batchScopeConflicts.push(id);
      reconciliation.push({
        disposition: "unbound",
        reason_code: "batch_guide_scope_conflict",
        sample: id,
      });
    }
  }
  const formula =
    officialTools === undefined
      ? undefined
      : reviewClaim(reconciliation, "formula_tools_structure_drift", () => ({
          models: guideModels(officialTools, models, "official-tools"),
          tools: formulaTools(officialTools),
        }));
  const search =
    tools === undefined || webGuide === undefined
      ? undefined
      : reviewClaim(reconciliation, "web_search_structure_drift", () => ({
          models: guideModels(webGuide, models, "web-search"),
          rate: webSearchRate(input, extractor, tools),
        }));
  return {
    region: extractor.region,
    batchScopeConflicts,
    fileService: billing !== undefined && fileDocuments.every((document) => document !== undefined),
    formulaModels: formula?.models ?? [],
    formulaTools: formula?.tools ?? [],
    searchModels: search?.models ?? [],
    ...(search?.rate === undefined ? {} : { searchRate: search.rate }),
    webSearchWarning,
    reconciliation,
  };
}

export function parseKimiPricing(input: Input): ProviderModel[] {
  const extractor = input.source.extractor;
  if (extractor.kind !== "kimi-pricing") throw new Error("Wrong kimi-pricing extractor");
  const bundle = linkedBundleSchema.parse(JSON.parse(input.body));
  const documents = [bundle.index, ...bundle.documents];
  const pricingInputs = extractKimiCommercialPricingInputs({
    documents,
    sourceRef: input.source.id,
    ...(input.onContractFinding === undefined ? {} : { onFinding: input.onContractFinding }),
    ...(input.onPricingReconciliation === undefined
      ? {}
      : { onReconciliation: input.onPricingReconciliation }),
  });
  const models = new Map<string, ProviderModel>();
  const rowReconciliation: PricingReconciliationItem[] = [];
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
    try {
      const rows = z.array(z.unknown()).min(1).parse(jsonArrayAfter(document.body, "rows={"));
      const batch = path === "/docs/pricing/batch";
      const cached = hasCachePrices(document.body);
      for (const [index, value] of rows.entries()) {
        const parsed = priceRowSchema.safeParse(value);
        if (!parsed.success) {
          rowReconciliation.push({
            disposition: "unsupported",
            reason_code: "pricing_row_rejected",
            sample: `${path} row ${index + 1}`,
          });
          continue;
        }
        try {
          const incoming = pricingModel(
            input,
            extractor,
            document.body,
            parsed.data,
            batch,
            cached,
          );
          const current = models.get(incoming.model_id);
          models.set(
            incoming.model_id,
            current === undefined ? incoming : mergePricing(current, incoming),
          );
        } catch (error) {
          rowReconciliation.push({
            disposition: "unsupported",
            reason_code: "pricing_row_rejected",
            sample: `${path} row ${index + 1}: ${(error instanceof Error ? error.message : String(error)).slice(0, 180)}`,
          });
        }
      }
    } catch (error) {
      rowReconciliation.push({
        disposition: "unbound",
        reason_code: "pricing_document_rejected",
        sample: `${path}: ${(error instanceof Error ? error.message : String(error)).slice(0, 200)}`,
      });
    }
  }
  const evidence = commercialEvidence(input, extractor, bundle, models);
  for (const id of new Set([...evidence.formulaModels, ...evidence.searchModels])) {
    const model = models.get(id);
    if (model === undefined) throw new Error(`Kimi tool guide named unknown model ${id}`);
    models.set(id, {
      ...model,
      capabilities: { ...model.capabilities, tool_call: true },
    });
  }
  extractKimiCommercialFacts(models, input.source.id, evidence);
  const result = [...models.values()].map((model): ProviderModel => ({
    ...model,
    capabilities: { ...model.capabilities, prompt_cache: true },
    price_facts: [...model.price_facts].sort((left, right) =>
      `${left.meter}\0${JSON.stringify(left.conditions)}`.localeCompare(
        `${right.meter}\0${JSON.stringify(right.conditions)}`,
      ),
    ),
    raw_price_facts: model.raw_price_facts,
  }));
  const carrier = result.toSorted((left, right) => left.uid.localeCompare(right.uid))[0];
  if (carrier !== undefined && pricingInputs.length > 0) carrier.pricing_inputs = pricingInputs;
  for (const model of result) {
    for (const rate of model.price_facts)
      input.onPricingReconciliation?.({
        disposition: "normalized",
        reason_code: "price_fact_normalized",
        sample: `${model.model_id}:${extractor.region}:${rate.conditions.service_tier ?? "standard"}:${rate.meter}`,
      });
  }
  if (evidence.searchRate !== undefined)
    input.onPricingReconciliation?.({
      disposition: "normalized",
      reason_code: "web_search_service_normalized",
      sample: `${extractor.region}:web_search:event`,
    });
  for (const tool of evidence.formulaTools.filter((name) => name !== "web-search"))
    input.onPricingReconciliation?.({
      disposition: "explicit_non_numeric",
      reason_code: "formula_tool_promotional_free",
      sample: tool,
    });
  if (evidence.fileService)
    input.onPricingReconciliation?.({
      disposition: "explicit_non_numeric",
      reason_code: "file_service_promotional_free",
    });
  for (const item of [...rowReconciliation, ...evidence.reconciliation])
    input.onPricingReconciliation?.(item);
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
  const models = items.map((item): ProviderModel => ({
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
  }));
  return bounded(input, "kimi-api", models);
}
