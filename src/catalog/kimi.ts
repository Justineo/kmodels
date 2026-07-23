import { load } from "cheerio";
import { z } from "zod";
import { linkedBundleSchema } from "./bundle.ts";
import { modelIdSchema } from "./identity.ts";
import type { SourceManifest } from "./manifests.ts";
import { baseModel } from "./model.ts";
import {
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

const chatPath = "/v1/chat/completions";
const refSchema = z.string().regex(/^#\/components\/schemas\/[A-Za-z0-9]+$/);
const openApiSchema = z.object({
  paths: z.object({
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
      }),
    }),
  }),
  components: z.object({ schemas: z.record(z.string(), z.unknown()) }),
});
const allOfSchema = z.object({ allOf: z.array(z.unknown()).min(1) });
const propertiesSchema = z.object({ properties: z.record(z.string(), z.unknown()) });
const referenceSchema = z.object({ $ref: refSchema });
const modelPropertySchema = z.object({ enum: z.array(modelIdSchema).min(1) });
const priceRowsSchema = z.array(z.array(z.string()).min(5).max(6)).min(1);
const apiSchema = z.object({
  object: z.literal("list"),
  data: z
    .array(
      z.object({
        id: modelIdSchema,
        object: z.literal("model"),
        created: z.number().int().nonnegative(),
        owned_by: z.string().min(1),
        context_length: z.number().int().positive(),
        supports_image_in: z.boolean().optional(),
        supports_video_in: z.boolean().optional(),
        supports_reasoning: z.boolean().optional(),
      }),
    )
    .min(1),
});

function bounded(
  input: Input,
  kind: "kimi-openapi" | "kimi-catalog" | "kimi-pricing" | "kimi-releases" | "kimi-api",
  models: ProviderModel[],
): ProviderModel[] {
  const extractor = input.source.extractor;
  if (extractor.kind !== kind) throw new Error(`Wrong ${kind} extractor`);
  if (models.length < extractor.minModels || models.length > extractor.maxModels)
    throw new Error(
      `Kimi ${kind} model count ${models.length} outside ${extractor.minModels}-${extractor.maxModels}`,
    );
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

function requestFacts(
  ref: string,
  schemas: Record<string, unknown>,
): { ids: string[]; reasoning: boolean; effort: boolean } {
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
  for (const field of ["response_format", "stream", "tools", "tool_choice", "prompt_cache_key"])
    if (common[field] === undefined) throw new Error(`Kimi OpenAPI request base omitted ${field}`);
  return {
    ids,
    reasoning: ownProperties.reasoning_effort !== undefined || ownProperties.thinking !== undefined,
    effort: ownProperties.reasoning_effort !== undefined,
  };
}

export function parseKimiOpenApi(input: Input): ProviderModel[] {
  const spec = openApiSchema.parse(JSON.parse(input.body));
  const mapping =
    spec.paths[chatPath].post.requestBody.content["application/json"].schema.discriminator.mapping;
  const entries = Object.entries(mapping);
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
      types: ["generate"],
      modalities: { input: ["text"], output: ["text"] },
      api_endpoints: [{ name: "Chat Completions", path: chatPath }],
      capabilities: {
        ...unknownCapabilities(),
        reasoning: observed.reasoning ? true : "unknown",
        tool_call: true,
        structured_output: true,
        streaming: true,
        prompt_cache: true,
        effort_control: observed.effort ? true : "unknown",
      },
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
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function tokenCount(value: string): number | undefined {
  const exact = value.match(/([\d,]+)\s*tokens?/i)?.[1];
  if (exact !== undefined) {
    const result = Number(exact.replaceAll(",", ""));
    if (!Number.isSafeInteger(result)) throw new Error(`Invalid Kimi token count: ${value}`);
    return result;
  }
  const scaled = value.match(/(\d+(?:\.\d+)?)\s*(万|[kKmM])\s*(?:token|上下文)/)?.slice(1);
  if (scaled === undefined) return undefined;
  const [raw, suffix] = scaled;
  if (raw === undefined || suffix === undefined) return undefined;
  const multiplier = suffix === "万" ? 10_000 : suffix.toLowerCase() === "m" ? 1_000_000 : 1_000;
  const result = Number(raw) * multiplier;
  if (!Number.isSafeInteger(result)) throw new Error(`Invalid Kimi token count: ${value}`);
  return result;
}

function catalogModel(
  input: Input,
  id: string,
  description: string | undefined,
  status: ProviderModel["status"],
  retiredAt?: string,
  replacements: string[] = [],
): ProviderModel {
  const prose = description ?? "";
  const media = /视觉|图片/.test(prose) ? ["image" as const] : [];
  const video = /视频输入/.test(prose) ? ["video" as const] : [];
  return {
    ...baseModel({
      providerId: input.provider.id,
      id,
      name: id,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    }),
    description,
    types: ["generate"],
    modalities: { input: ["text", ...media, ...video], output: ["text"] },
    capabilities: {
      ...unknownCapabilities(),
      reasoning: /思考|推理/.test(prose) ? true : "unknown",
    },
    limits: { context_tokens: tokenCount(prose) },
    status,
    is_deprecated: status === "deprecated" || status === "retired",
    retired_at: retiredAt,
    replacement_model_ids: replacements,
  };
}

export function parseKimiCatalog(input: Input): ProviderModel[] {
  const tables = markdownTables(input.body).filter(
    (table) => table.headers[0] === "模型名称" && table.headers[1] === "描述",
  );
  if (tables.length !== 3) throw new Error("Kimi model catalog table structure changed");
  const retiredDate = input.body.match(
    /系列模型已于 \*\*(\d{4}) 年 (\d{1,2}) 月 (\d{1,2}) 日下线\*\*/,
  );
  if (
    retiredDate?.[1] === undefined ||
    retiredDate[2] === undefined ||
    retiredDate[3] === undefined
  )
    throw new Error("Kimi retired-series date is missing");
  const retiredAt = modelDate(retiredDate[1], retiredDate[2], retiredDate[3]);
  const restricted = input.body.includes(
    "`kimi-k2.5` 和 `moonshot-v1` 系列模型已停止向新注册用户开放",
  );
  const models = tables.flatMap((table) =>
    table.rows.map((row) => {
      const id = exactCode(row[0] ?? "");
      const description = row[1]?.trim() || undefined;
      const retired = table.section === "已下线模型";
      const deprecated = restricted && (id === "kimi-k2.5" || id.startsWith("moonshot-v1-"));
      const status: ProviderModel["status"] = retired
        ? "retired"
        : deprecated
          ? "deprecated"
          : id.includes("preview")
            ? "preview"
            : "active";
      return catalogModel(
        input,
        id,
        description,
        status,
        retired ? retiredAt : undefined,
        retired ? ["kimi-k3"] : [],
      );
    }),
  );
  for (const line of input.body.split(/\r?\n/)) {
    const retired = line.match(
      /^>\s*`([^`]+)` 已于 \*\*(\d{4}) 年 (\d{1,2}) 月 (\d{1,2}) 日下线\*\*.*\[([^\]]+)\]/,
    );
    if (
      retired?.[1] === undefined ||
      retired[2] === undefined ||
      retired[3] === undefined ||
      retired[4] === undefined ||
      retired[5] === undefined
    )
      continue;
    const id = modelIdSchema.parse(retired[1]);
    const replacement = modelIdSchema.parse(retired[5]);
    models.push(
      catalogModel(input, id, undefined, "retired", modelDate(retired[2], retired[3], retired[4]), [
        replacement,
      ]),
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
      if (depth === 0) return JSON.parse(withoutTrailingCommas(body.slice(start, index + 1)));
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

function decimalPrice(value: string): string {
  const match = value.match(/^¥(0|[1-9]\d*)(?:\.(\d+))?$/);
  if (match?.[1] === undefined) throw new Error(`Invalid Kimi price: ${value}`);
  return match[2] === undefined ? match[1] : `${match[1]}.${match[2]}`;
}

function priceRate(
  meter: PriceRate["meter"],
  value: string,
  sourceId: string,
  conditions: PriceRate["conditions"],
): PriceRate {
  return {
    meter,
    price: decimalPrice(value),
    currency: "CNY",
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
    const heading = line.match(/^#\s+(.+?)(?:\s+模型)?定价\s*$/)?.[1];
    if (heading !== undefined)
      names.push(heading.replace(/^(?:旗舰模型|编程模型|多模态模型|生成模型)\s+/, "").trim());
    const bullet = line.match(/^[-*]\s+(.+?)\s+是/)?.[1];
    if (bullet !== undefined) names.push(bullet.trim());
  }
  return [...new Set(names)];
}

function pricingModel(input: Input, body: string, row: string[], batch: boolean): ProviderModel {
  const suffix = "（Batch）";
  const rawId = row[0];
  const rawUnit = row[1];
  if (rawId === undefined || rawUnit !== "1M tokens")
    throw new Error("Kimi pricing row omitted its model or unit");
  if (batch !== rawId.endsWith(suffix)) throw new Error("Kimi Batch label disagrees with its page");
  const id = modelIdSchema.parse(batch ? rawId.slice(0, -suffix.length) : rawId);
  const context = row.at(-1);
  const contextTokens = context === undefined ? undefined : tokenCount(context);
  if (contextTokens === undefined) throw new Error(`Kimi pricing omitted context for ${id}`);
  const conditions: PriceRate["conditions"] = batch ? { service_tier: "batch" } : {};
  const prices =
    row.length === 6
      ? [
          priceRate("cache_read_text", row[2] ?? "", input.source.id, conditions),
          priceRate("input_text", row[3] ?? "", input.source.id, conditions),
          priceRate("output_text", row[4] ?? "", input.source.id, conditions),
        ]
      : [
          priceRate("input_text", row[2] ?? "", input.source.id, conditions),
          priceRate("output_text", row[3] ?? "", input.source.id, conditions),
        ];
  const names = displayNames(body).filter((name) => identity(name) === identity(id));
  if (names.length > 1) throw new Error(`Kimi pricing display name for ${id} is ambiguous`);
  const multimedia = /支持文本、图片与视频输入/.test(body);
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
    types: ["generate"],
    modalities: { input: ["text", ...image, ...video], output: ["text"] },
    capabilities: {
      ...unknownCapabilities(),
      reasoning: /思考|推理/.test(body) ? true : "unknown",
      tool_call: /ToolCalls|工具调用/.test(body) ? true : "unknown",
      structured_output: /JSON Mode|结构化输出/.test(body) ? true : "unknown",
      batch: batch ? true : "unknown",
    },
    limits: { context_tokens: contextTokens },
    pricing_status: "published",
    pricing: prices,
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
  const rates = [...current.pricing, ...incoming.pricing];
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
    pricing: rates,
  };
}

export function parseKimiPricing(input: Input): ProviderModel[] {
  const bundle = linkedBundleSchema.parse(JSON.parse(input.body));
  const documents = [bundle.index, ...bundle.documents];
  const cache = documents.find(
    ({ url }) => new URL(url).pathname === "/docs/guide/use-context-caching-feature-of-kimi-api",
  );
  if (cache === undefined || !/对所有模型请求自动启用/.test(cache.body))
    throw new Error("Kimi automatic cache documentation changed");
  const models = new Map<string, ProviderModel>();
  for (const document of documents) {
    const path = new URL(document.url).pathname;
    if (path === "/docs/guide/use-context-caching-feature-of-kimi-api") continue;
    if (!path.startsWith("/docs/pricing/"))
      throw new Error(`Unexpected Kimi pricing page: ${path}`);
    const rows = priceRowsSchema.parse(jsonArrayAfter(document.body, "rows={"));
    const batch = path === "/docs/pricing/batch";
    for (const row of rows) {
      const incoming = pricingModel(input, document.body, row, batch);
      const current = models.get(incoming.model_id);
      models.set(
        incoming.model_id,
        current === undefined ? incoming : mergePricing(current, incoming),
      );
    }
  }
  const result = [...models.values()].map(
    (model): ProviderModel => ({
      ...model,
      capabilities: { ...model.capabilities, prompt_cache: true },
      pricing: [...model.pricing].sort((left, right) =>
        `${left.meter}\0${JSON.stringify(left.conditions)}`.localeCompare(
          `${right.meter}\0${JSON.stringify(right.conditions)}`,
        ),
      ),
    }),
  );
  return bounded(input, "kimi-pricing", result);
}

const releaseIds = new Map([
  ["Kimi K3", "kimi-k3"],
  ["Kimi K2.7 Code", "kimi-k2.7-code"],
  ["Kimi K2.6", "kimi-k2.6"],
  ["Kimi K2.5", "kimi-k2.5"],
]);

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
    : `${match[3]}-${month}-${match[2].padStart(2, "0")}`;
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
    types: ["generate"],
    release_date: date,
  };
}

export function parseKimiReleases(input: Input): ProviderModel[] {
  const bundle = linkedBundleSchema.parse(JSON.parse(input.body));
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
    const $ = load(document.body);
    if (url.hostname === "www.kimi.com" && url.pathname === "/blog/") {
      $(".menu-card").each((_index, card) => {
        const name = htmlText($(card).find("h4").first().text());
        const id = releaseIds.get(name);
        const date = htmlText($(card).text())
          .match(/(\d{4})\/(\d{2})\/(\d{2})/)
          ?.slice(1);
        if (
          id !== undefined &&
          date?.[0] !== undefined &&
          date[1] !== undefined &&
          date[2] !== undefined
        )
          add(id, `${date[0]}-${date[1]}-${date[2]}`);
      });
      continue;
    }
    if (url.hostname === "www.kimi.com" && url.pathname.endsWith("/whats-new.html")) {
      $(".wn-entry .wn-meta").each((_index, meta) => {
        const name = htmlText($(meta).find(".ignore-header").first().text());
        const rawDate = htmlText($(meta).find(".wn-date").first().text());
        const id = releaseIds.get(name);
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
  if (new Set(list.data.map(({ id }) => id)).size !== list.data.length)
    throw new Error("Kimi API returned duplicate model IDs");
  const models = list.data.map(
    (item): ProviderModel => ({
      ...baseModel({
        providerId: input.provider.id,
        id: item.id,
        name: item.id,
        sourceId: input.source.id,
        observedAt: input.observedAt,
      }),
      types: ["generate"],
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
