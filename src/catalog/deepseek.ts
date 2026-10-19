import { load } from "cheerio";
import { z } from "zod";
import { extractDeepseekPricingInputs } from "./deepseek-accounting.ts";
import { deepseekApiDocument } from "./deepseek-api-document.ts";
import {
  deepseekBillingRule,
  deepseekBillingVocabulary,
  type DeepseekBillingRule,
  type DeepseekCurrency,
  deepseekPrice,
  deepseekEnglishInstant,
} from "./deepseek-pricing-policy.ts";
import { deepseekServicePricing } from "./deepseek-services.ts";
import { htmlTables, htmlText, type HtmlTable } from "./html.ts";
import { modelIdSchema } from "./identity.ts";
import { baseModel, modelUid } from "./model.ts";
import { publishedRate } from "./pricing.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import { canonicalizeInstant } from "./pricing-time.ts";
import type {
  ParsedProviderModel as ProviderModel,
  SourcePriceFact,
  SourceRawPricingFact,
} from "./pricing-source.ts";
import { assertItemCount, contractExtensionEvidence } from "./source-contract.ts";
import { unknownCapabilities } from "./schema.ts";
import type { SourceParseInput as Input, SourceParseResult } from "./source-parse.ts";
import { linkedBundleSchema, type LinkedBundle as Bundle } from "./bundle.ts";
import { parseIJson } from "./canonical-json.ts";

const listItemSchema = z.object({
  id: modelIdSchema,
  object: z.literal("model"),
  owned_by: z.string().min(1),
  context_window: z.unknown().optional(),
  max_output_tokens: z.unknown().optional(),
});
const listSchema = z.object({ object: z.literal("list"), data: z.array(listItemSchema).min(1) });
const apiListSchema = z.object({ object: z.literal("list"), data: z.array(z.unknown()) });
const apiListItemSchema = z.object({
  id: modelIdSchema,
  object: z.literal("model"),
  owned_by: z.string().min(1),
});

const chatEndpoint = { name: "Chat Completions", path: "/chat/completions" };
const responsesEndpoint = { name: "Responses", path: "/responses" };
const anthropicEndpoint = { name: "Anthropic Messages", path: "/anthropic/v1/messages" };
const fimReferenceEndpoint = { name: "FIM Completion (Beta)", path: "/completions" };
const fimEndpoint = { name: "FIM Completion (Beta)", path: "/beta/completions" };
const baseUrls = [
  ["BASE URL (OpenAI Format)", "https://api.deepseek.com"],
  ["BASE URL (Anthropic Format)", "https://api.deepseek.com/anthropic"],
] as const;
const priceRows = [
  ["cache_read_text", "1M INPUT TOKENS (CACHE HIT)"],
  ["input_text", "1M INPUT TOKENS (CACHE MISS)"],
  ["output_text", "1M OUTPUT TOKENS"],
] as const;

const cnyPriceRows = [
  ["cache_read_text", "百万tokens输入（缓存命中）"],
  ["input_text", "百万tokens输入（缓存未命中）"],
  ["output_text", "百万tokens输出"],
] as const;

type BillingPeriod = "off_peak" | "peak";

type ScheduledPricing = { rule: DeepseekBillingRule } & (
  | { layout: "inline"; table: HtmlTable }
  | { layout: "separate"; effectiveFrom: string; table: HtmlTable }
);

function exactId(value: string): string | undefined {
  const parsed = modelIdSchema.safeParse(value.trim());
  return parsed.success ? parsed.data : undefined;
}

function updateModelId(value: string): string | undefined {
  const direct = exactId(value);
  if (direct !== undefined) return direct;
  const assignment = /^model\s*=\s*['"]([^'"]+)['"]$/.exec(value.trim());
  return assignment?.[1] === undefined ? undefined : exactId(assignment[1]);
}

function withoutFootnote(value: string): string {
  return value.replace(/\(\d+\)$/, "");
}

function catalogId(value: string): string | undefined {
  return exactId(withoutFootnote(value));
}

function modelColumnStart(table: HtmlTable, modelHeader: string): number {
  const index = table.headers.findIndex((header) => header !== modelHeader);
  if (index < 1) throw new Error(`DeepSeek ${modelHeader} columns are missing`);
  return index;
}

function tokenCount(value: string): number {
  const match = value.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*([kKmM])?/);
  if (match?.[1] === undefined) throw new Error(`Invalid DeepSeek token limit: ${value}`);
  const scale = match[2]?.toLowerCase() === "m" ? 1_000_000 : match[2] ? 1_000 : 1;
  const result = Number(match[1]) * scale;
  if (!Number.isSafeInteger(result)) throw new Error(`Invalid DeepSeek token limit: ${value}`);
  return result;
}

function rowLabel(value: HtmlTable["rows"][number]): string {
  return withoutFootnote(value[1]?.text ?? value[0]?.text ?? "").replace(/TOKENS\(/giu, "TOKENS (");
}

function row(table: HtmlTable, label: string): string[] {
  const matches = table.rows.filter((item) => rowLabel(item) === label);
  if (matches.length !== 1) throw new Error(`DeepSeek catalog omitted or duplicated ${label}`);
  return matches[0]?.map((cell) => cell.text) ?? [];
}

function optionalRow(table: HtmlTable, label: string): string[] | undefined {
  const matches = table.rows.filter((item) => rowLabel(item) === label);
  return matches.length === 1 ? matches[0]?.map((cell) => cell.text) : undefined;
}

function cells(table: HtmlTable, label: string, columns: number[]): string[] {
  const values = row(table, label);
  return columns.map((column) => {
    const value = values[column];
    if (value === undefined || value === "") throw new Error(`DeepSeek catalog omitted ${label}`);
    return value;
  });
}

function cell(table: HtmlTable, label: string, column: number): string {
  const value = optionalRow(table, label)?.[column];
  if (value === undefined || value === "") throw new Error(`DeepSeek catalog omitted ${label}`);
  return value;
}

function supportedModelIds(
  input: Input,
  table: HtmlTable,
  columns: readonly { column: number; id: string }[],
  label: string,
  reasonCode: string,
): Set<string> {
  return new Set(
    columns.flatMap(({ column, id }) =>
      catalogClaim(input, reasonCode, `${id}:${label}`, () =>
        supportValue(cell(table, label, column)),
      ) === true
        ? [id]
        : [],
    ),
  );
}

function endpointEvidence(
  body: string,
  endpoint: NonNullable<ProviderModel["api_endpoints"]>[number],
) {
  const api = deepseekApiDocument(body, endpoint.path);
  const modelValues = api.values("request", [["model", "string"]]);
  const ids = z.array(modelIdSchema).min(1).safeParse(modelValues);
  if (!ids.success || new Set(ids.data).size !== ids.data.length)
    throw new Error("DeepSeek " + endpoint.name + " reference returned invalid model IDs");
  return { modelIds: new Set(ids.data), api };
}

interface ChatClaims {
  effortControl: boolean;
  modelIds: Set<string>;
  streaming: boolean;
}

function chatClaims(input: Input, body: string | undefined): ChatClaims {
  if (body === undefined) return { effortControl: false, modelIds: new Set(), streaming: false };
  const evidence = catalogClaim(input, "chat_operation_contract_drift", "Chat Completions", () =>
    endpointEvidence(body, chatEndpoint),
  );
  if (evidence === undefined)
    return { effortControl: false, modelIds: new Set(), streaming: false };
  const effortControl =
    catalogClaim(input, "chat_reasoning_controls_drift", "reasoning controls", () => {
      const thinking = evidence.api.values("request", [
        ["thinking", "object"],
        ["type", "string"],
      ]);
      const effort = evidence.api.values("request", [["reasoning_effort", "string"]]);
      if (
        thinking === undefined ||
        !["enabled", "disabled"].every((value) => thinking.includes(value)) ||
        effort === undefined ||
        !["high", "max"].every((value) => effort.includes(value))
      )
        throw new Error("expected thinking and reasoning_effort values");
      return true;
    }) === true;
  catalogClaim(input, "chat_structured_output_drift", "response_format", () => {
    const values = evidence.api.values("request", [
      ["response_format", "object"],
      ["type", "string"],
    ]);
    if (values === undefined || !["text", "json_object"].every((value) => values.includes(value)))
      throw new Error("expected text and json_object");
  });
  catalogClaim(input, "chat_tool_schema_drift", "tools", () => {
    if (
      evidence.api
        .values("request", [
          ["tools", "object[]"],
          ["type", "string"],
        ])
        ?.includes("function") !== true
    )
      throw new Error("expected function tool");
  });
  const streaming =
    catalogClaim(input, "chat_streaming_contract_drift", "stream", () => {
      const stream = evidence.api.text("request", [["stream", "boolean"]]);
      if (stream === undefined || !stream.includes("partial message deltas will be sent"))
        throw new Error("expected one streaming claim");
      const usage = evidence.api.text("request", [
        ["stream_options", "object"],
        ["include_usage", "boolean"],
      ]);
      if (
        usage === undefined ||
        ![
          "entire request",
          "choices array always contains exactly one element",
          "carries no new content",
        ].every((claim) => usage.includes(claim))
      )
        throw new Error("streaming usage contract drifted");
      return true;
    }) === true;
  return { effortControl, modelIds: evidence.modelIds, streaming };
}

interface ResponseClaims {
  modelIds: Set<string>;
}

function responseClaims(input: Input, body: string | undefined): ResponseClaims {
  if (body === undefined) return { modelIds: new Set() };
  const evidence = catalogClaim(input, "responses_operation_contract_drift", "Responses", () =>
    endpointEvidence(body, responsesEndpoint),
  );
  return { modelIds: evidence?.modelIds ?? new Set() };
}

interface FimClaims {
  modelIds: Set<string>;
}

interface VisionClaims {
  modelIds: Set<string>;
}

function visionClaims(input: Input, body: string | undefined): VisionClaims {
  if (body === undefined) return { modelIds: new Set() };
  const ids = catalogClaim(input, "vision_contract_drift", "Vision", () => {
    const $ = load(body);
    const introductions = $("article p")
      .toArray()
      .filter((paragraph) =>
        /model accepts images alongside text/i.test(htmlText($(paragraph).text())),
      );
    if (introductions.length !== 1) throw new Error("expected one image-input model claim");
    const introduction = $(introductions[0]);
    const id = exactId(htmlText(introduction.find("code").first().text()));
    if (
      id === undefined ||
      !htmlText(introduction.text()).startsWith(`The ${id} model accepts images alongside text`)
    )
      throw new Error("expected one exact vision model ID");
    const tokenUsage = $("article h2")
      .toArray()
      .filter((heading) => htmlText($(heading).text()) === "Token Usage")
      .map((heading) => htmlText($(heading).nextUntil("h2").text()));
    if (
      tokenUsage.length !== 1 ||
      !/images are converted into tokens based on their dimensions/i.test(tokenUsage[0] ?? "") ||
      !/billed together with your text tokens/i.test(tokenUsage[0] ?? "")
    )
      throw new Error("image token billing claim changed");
    return new Set([id]);
  });
  return { modelIds: ids ?? new Set() };
}

function fimClaims(input: Input, body: string | undefined): FimClaims {
  if (body === undefined) return { modelIds: new Set() };
  const evidence = catalogClaim(input, "fim_operation_contract_drift", "FIM Completion", () =>
    endpointEvidence(body, fimReferenceEndpoint),
  );
  return { modelIds: evidence?.modelIds ?? new Set() };
}

interface AnthropicClaims {
  available: boolean;
  streaming: boolean;
}

function anthropicClaims(input: Input, body: string | undefined): AnthropicClaims {
  if (body === undefined) return { available: false, streaming: false };
  const $ = load(body);
  const prose = htmlText($("article").text());
  const available =
    catalogClaim(input, "anthropic_operation_contract_drift", "Anthropic Messages", () => {
      if (
        !/Using the Anthropic API/i.test(prose) ||
        !/https:\/\/api\.deepseek\.com\/anthropic/.test(prose) ||
        !/client\.messages\.create/.test(prose)
      )
        throw new Error("expected Anthropic base URL and Messages invocation");
      return true;
    }) === true;
  const streaming =
    catalogClaim(input, "anthropic_streaming_contract_drift", "Anthropic stream", () => {
      const sections = $("article h3").filter(
        (_, heading) => htmlText($(heading).text()) === "Simple Fields",
      );
      if (sections.length !== 1) throw new Error("expected one Simple Fields section");
      const content = sections
        .nextUntil("h1,h2,h3")
        .filter((_, node) => !$(node).is("pre,blockquote"))
        .clone();
      content.find("pre,blockquote").remove();
      const statuses = htmlTables(content.toString())
        .filter(({ headers }) => headers.join("|") === "Field|Support Status")
        .flatMap(({ rows }) =>
          rows
            .filter((row) => row[0]?.text === "stream")
            .map((row) => (row.length === 2 ? row[1]?.text : undefined)),
        );
      if (statuses.length !== 1 || statuses[0] !== "Fully Supported")
        throw new Error("expected fully supported stream field");
      return true;
    }) === true;
  return { available, streaming };
}

function inventoryReferenceModels(
  input: Input,
  body: string,
): Map<string, ProviderModel["limits"]> {
  const api = deepseekApiDocument(body, "/models", "GET");
  const rootObject = api.text("response", [["object", "string"]]);
  const itemObject = api.text("response", [
    ["data", "object[]"],
    ["object", "string"],
  ]);
  if (
    rootObject === undefined ||
    !/Possible values:\s*\[list\]/i.test(rootObject) ||
    itemObject === undefined ||
    !/Possible values:\s*\[model\]/i.test(itemObject) ||
    !api.has("response", [
      ["data", "object[]"],
      ["id", "string"],
    ]) ||
    !api.has("response", [
      ["data", "object[]"],
      ["owned_by", "string"],
    ])
  )
    throw new Error("DeepSeek model-inventory reference changed response schema");
  const examples = api.responseSamples
    .flatMap((value) => {
      let exampleValue: unknown;
      try {
        exampleValue = parseIJson(
          new TextEncoder().encode(value),
          input.source.maxResponseBytes ?? 2 * 1024 * 1024,
        );
      } catch {
        return [];
      }
      const parsed = listSchema.safeParse(exampleValue);
      return parsed.success ? [parsed.data] : [];
    })
    .filter(({ data }) =>
      data.every(({ id, owned_by }) => id !== "string" && owned_by !== "string"),
    );
  const [example] = examples;
  if (examples.length !== 1 || example === undefined)
    throw new Error("DeepSeek model-inventory reference omitted the current example");
  const ids = example.data.map(({ id }) => id);
  if (new Set(ids).size !== ids.length)
    throw new Error("DeepSeek model-inventory reference returned duplicate model IDs");
  return new Map(
    example.data.map((item): [string, ProviderModel["limits"]] => {
      const limits: ProviderModel["limits"] = {};
      for (const [field, target] of [
        ["context_window", "context_tokens"],
        ["max_output_tokens", "max_output_tokens"],
      ] as const) {
        const value = item[field];
        if (value === undefined) continue;
        if (
          api.has("response", [
            ["data", "object[]"],
            [field, "integer"],
          ]) &&
          typeof value === "number" &&
          Number.isSafeInteger(value) &&
          value > 0
        )
          limits[target] = value;
        else catalogFinding(input, "model_inventory_limit_contract_drift", `${item.id}:${field}`);
      }
      if (
        limits.context_tokens !== undefined &&
        limits.max_output_tokens !== undefined &&
        limits.max_output_tokens > limits.context_tokens
      ) {
        catalogFinding(input, "model_inventory_limits_conflict", item.id);
        return [item.id, {}];
      }
      return [item.id, limits];
    }),
  );
}

function catalogFinding(input: Input, code: string, sample?: string): void {
  input.onContractFinding?.(
    contractExtensionEvidence(["/deepseek/" + code + (sample === undefined ? "" : "/" + sample)]),
  );
}
function catalogClaim<T>(
  input: Input,
  code: string,
  sample: string,
  parse: () => T,
): T | undefined {
  try {
    return parse();
  } catch {
    catalogFinding(input, code, sample);
    return;
  }
}

function pricingDiagnostic(
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

function pricingClaim<T>(
  input: Input,
  reasonCode: string,
  sample: string,
  parse: () => T,
): T | undefined {
  try {
    return parse();
  } catch (error) {
    pricingDiagnostic(
      input,
      "unsupported",
      reasonCode,
      `${sample}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function companion(input: Input, bundle: Bundle, pathname: string): string | undefined {
  const normalized = (value: string): string => value.replace(/\/$/, "");
  const matches = bundle.documents.filter(
    ({ url }) => normalized(new URL(url).pathname) === normalized(pathname),
  );
  if (matches.length === 1) return matches[0]?.body;
  catalogFinding(
    input,
    matches.length === 0 ? "commercial_companion_missing" : "commercial_companion_duplicate",
    pathname,
  );
}

const catalogRows = new Set([
  ...baseUrls.map(([label]) => label),
  "MODEL VERSION",
  "THINKING MODE",
  "CONTEXT LENGTH",
  "MAX OUTPUT",
  "Json Output",
  "Tool Calls",
  "Responses API",
  "Anthropic API",
  "Chat Prefix Completion（Beta）",
  "FIM Completion（Beta）",
  "Vision",
  ...priceRows.map(([, label]) => label),
  "Concurrency Limit",
]);

function validateCatalogTable(input: Input, table: HtmlTable, columns: number[]): void {
  const unhandled = table.rows.map(rowLabel).filter((label) => !catalogRows.has(label));
  if (unhandled.length > 0) catalogFinding(input, "catalog_row_unhandled", unhandled.join(" | "));
  for (const [label, expected] of baseUrls)
    catalogClaim(input, "catalog_base_url_drift", label, () => {
      if (cells(table, label, columns).some((value) => value !== expected))
        throw new Error(`expected ${expected}`);
    });
  catalogClaim(input, "catalog_support_claim_drift", "Chat Prefix Completion（Beta）", () =>
    cells(table, "Chat Prefix Completion（Beta）", columns).map(supportValue),
  );
}

function priceFact(
  input: Input,
  meter: SourcePriceFact["meter"],
  amount: string,
  rawUnit: string,
  currency: DeepseekCurrency,
  conditions: SourcePriceFact["conditions"],
): SourcePriceFact {
  const rate = publishedRate(meter, amount, "million_tokens", input.source.id, rawUnit, conditions);
  return currency === "USD" ? rate : { ...rate, currency };
}

function addRate(input: Input, target: ProviderModel, rate: SourcePriceFact, sample: string): void {
  target.price_facts.push(rate);
  target.pricing_state = "numeric";
  if (rate.meter === "cache_read_text") target.capabilities.prompt_cache = true;
  pricingDiagnostic(input, "normalized", "price_fact_normalized", sample);
}

function model(
  input: Input,
  table: HtmlTable,
  column: number,
  id: string,
  chat: ChatClaims,
  responses: ResponseClaims,
  fim: FimClaims,
  vision: VisionClaims,
  hasAnthropicEndpoint: boolean,
  anthropicStreaming: boolean,
): ProviderModel {
  const value = <T>(reasonCode: string, label: string, parse: (cell: string) => T): T | undefined =>
    catalogClaim(input, reasonCode, `${id}:${label}`, () => parse(cell(table, label, column)));
  const name = value("model_name_claim_drift", "MODEL VERSION", (item) => item) ?? id;
  const context = value("context_limit_claim_drift", "CONTEXT LENGTH", tokenCount);
  const output = value("output_limit_claim_drift", "MAX OUTPUT", tokenCount);
  const structured = value("structured_output_claim_drift", "Json Output", (item) =>
    supportValue(item),
  );
  const tools = value("tool_call_claim_drift", "Tool Calls", (item) => supportValue(item));
  const reasoning = value("thinking_mode_claim_drift", "THINKING MODE", thinkingValue);
  const hasChatEndpoint = chat.modelIds.has(id);
  const hasResponsesEndpoint = responses.modelIds.has(id);
  const hasFimEndpoint = fim.modelIds.has(id);
  const hasImageInput = vision.modelIds.has(id);
  const apiEndpoints = [
    ...(hasChatEndpoint ? [chatEndpoint] : []),
    ...(hasResponsesEndpoint ? [responsesEndpoint] : []),
    ...(hasFimEndpoint ? [fimEndpoint] : []),
    ...(hasAnthropicEndpoint ? [anthropicEndpoint] : []),
  ];
  return {
    ...baseModel({
      providerId: input.provider.id,
      id,
      name,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    }),
    tasks: ["text_generation"],
    ...(apiEndpoints.length === 0 ? {} : { api_endpoints: apiEndpoints }),
    modalities: { input: hasImageInput ? ["text", "image"] : ["text"], output: ["text"] },
    capabilities: {
      ...unknownCapabilities(),
      ...(reasoning === undefined ? {} : { reasoning }),
      ...(tools === undefined ? {} : { tool_call: tools }),
      ...(structured === undefined ? {} : { structured_output: structured }),
      ...((hasChatEndpoint && chat.streaming) || (hasAnthropicEndpoint && anthropicStreaming)
        ? { streaming: true }
        : {}),
      ...(hasChatEndpoint && chat.effortControl ? { effort_control: true } : {}),
    },
    limits: {
      ...(context === undefined ? {} : { context_tokens: context }),
      ...(output === undefined ? {} : { max_output_tokens: output }),
    },
    status: "active",
    pricing_state: "unknown",
    price_facts: [],
  };
}

function scheduledPricing(
  input: Input,
  body: string,
  currency: DeepseekCurrency,
  inlineTable: HtmlTable,
): ScheduledPricing | undefined {
  const expectedHeaders = (currency === "USD" ? priceRows : cnyPriceRows).map(([, label]) => label);
  const modelHeader = currency === "USD" ? "MODEL" : "模型";
  const tables = htmlTables(body).filter(
    ({ headers }) =>
      headers[0] === modelHeader &&
      headers[1] === modelHeader &&
      headers.length === expectedHeaders.length + 2 &&
      expectedHeaders.every((header, index) => headers[index + 2] === header),
  );
  const table = tables[0];
  if (tables.length > 1) throw new Error(`DeepSeek ${currency} scheduled price table is ambiguous`);
  if (table !== undefined)
    return {
      layout: "separate",
      table,
      rule: deepseekBillingRule(body, currency, input.observedAt),
      effectiveFrom:
        currency === "USD" ? englishScheduledEffectiveFrom(body) : cnyScheduledEffectiveFrom(body),
    };

  const prose = htmlText(load(body)("article").text());
  const hasSchedule =
    currency === "USD"
      ? /(?:peak\s*\/\s*off-peak billing|off-peak rates (?:are|at) half).*?peak hours/i.test(prose)
      : /(?:采用峰谷定价|空闲时段价格为高峰时段价格的一半).*?高峰时段/.test(prose);
  const hasInlineRows = expectedHeaders.some(
    (label) => inlineTable.rows.filter((item) => rowLabel(item) === label).length > 1,
  );
  if (hasInlineRows)
    return {
      layout: "inline",
      table: inlineTable,
      rule: deepseekBillingRule(body, currency, input.observedAt),
    };
  if (hasSchedule) throw new Error(`DeepSeek ${currency} scheduled price table not found`);
  return;
}

function englishScheduledEffectiveFrom(body: string): string {
  const prose = htmlText(load(body)("article").text());
  const match =
    /Peak hours are 01:00\s*[-–]\s*04:00 and 06:00\s*[-–]\s*10:00 UTC \(all other hours are off-peak\).*?new prices take effect at (\d{2}:\d{2}) UTC on ([A-Za-z]+) (\d{1,2}), (\d{4})/i.exec(
      prose,
    );
  const time = match?.[1];
  const monthName = match?.[2]?.toLowerCase();
  const day = match?.[3];
  const year = match?.[4];
  if (time === undefined || day === undefined || year === undefined || monthName === undefined)
    throw new Error("DeepSeek scheduled pricing notice changed");
  return deepseekEnglishInstant(year, monthName, day, time, "Z");
}

function cnyScheduledEffectiveFrom(body: string): string {
  const prose = htmlText(load(body)("article").text());
  const match =
    /高峰时段为北京时间\s*0?9:00\s*[-–]\s*12:00[、，,和]\s*14:00\s*[-–]\s*18:00（其余为(?:空闲|低谷)时段）.*?北京时间\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{2}:\d{2})\s*(?:开始)?生效/.exec(
      prose,
    );
  const year = match?.[1];
  const month = match?.[2];
  const day = match?.[3];
  const time = match?.[4];
  if (year === undefined || month === undefined || day === undefined || time === undefined)
    throw new Error("DeepSeek CNY scheduled pricing notice changed");
  return canonicalizeInstant(
    `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${time}:00+08:00`,
  );
}

function billingPeriod(value: string): BillingPeriod {
  if (/^PEAK$/i.test(value)) return "peak";
  if (/^OFF[- ]PEAK$/i.test(value) || value === "低谷" || value === "空闲时段") return "off_peak";
  if (value === "高峰" || value === "高峰时段") return "peak";
  throw new Error(`Unknown DeepSeek billing period: ${value}`);
}

interface TariffCell {
  header: string;
  meter: SourcePriceFact["meter"];
  label: string;
  amount: string;
  fragment: string;
  conditions: SourcePriceFact["conditions"];
  periodText?: string;
  invalidPeriod: boolean;
}

function tariffCell(
  header: string,
  meter: SourcePriceFact["meter"],
  label: string,
  amount: string | undefined,
  row: HtmlTable["rows"][number],
  conditions: SourcePriceFact["conditions"],
  periodText?: string,
): TariffCell {
  let period: BillingPeriod | undefined;
  if (periodText !== undefined) {
    try {
      period = billingPeriod(periodText);
    } catch {
      // Keep the quote with its original label when applicability cannot be established.
    }
  }
  return {
    header,
    meter,
    label,
    amount: amount ?? "",
    fragment: row
      .map(({ text }) => text)
      .join(" | ")
      .slice(0, 4096),
    conditions: { ...conditions, ...(period === undefined ? {} : { billing_period: period }) },
    ...(periodText === undefined ? {} : { periodText }),
    invalidPeriod: periodText !== undefined && period === undefined,
  };
}

function tariffCells(
  table: HtmlTable,
  scheduled: ScheduledPricing | undefined,
  currency: DeepseekCurrency,
): TariffCell[] {
  const labels = currency === "USD" ? priceRows : cnyPriceRows;
  const claims: TariffCell[] = [];
  const columnStart = modelColumnStart(table, currency === "USD" ? "MODEL" : "模型");
  for (const [index, header] of table.headers.slice(columnStart).entries())
    for (const [meter, label] of labels) {
      const matching = table.rows.filter((row) => rowLabel(row) === label);
      for (const row of matching.length === 0 ? [[]] : matching)
        claims.push(
          tariffCell(
            header,
            meter,
            label,
            row[index + columnStart]?.text,
            row,
            {
              billing_currency: currency,
              ...(scheduled?.layout !== "separate"
                ? {}
                : { effective_until: scheduled.effectiveFrom }),
            },
            scheduled?.layout === "inline" ? (row[columnStart - 1]?.text ?? "missing") : undefined,
          ),
        );
    }
  if (scheduled?.layout === "separate")
    for (const row of scheduled.table.rows)
      for (const [index, [meter, label]] of labels.entries())
        claims.push(
          tariffCell(
            row[0]?.text ?? "",
            meter,
            label,
            row[index + 2]?.text,
            row,
            { billing_currency: currency, effective_from: scheduled.effectiveFrom },
            row[1]?.text ?? "missing",
          ),
        );
  return claims;
}

function preserveTariff(
  input: Input,
  target: ProviderModel,
  claim: TariffCell,
  currency: DeepseekCurrency,
  reason: SourceRawPricingFact["reason"],
): void {
  target.raw_price_facts.push({
    term_key: `unparsed:${claim.meter}`,
    impact: "base_price",
    reason,
    conditions: claim.conditions,
    source_ref: input.source.id,
    raw: {
      label: claim.label,
      ...(claim.amount === "" ? {} : { amount: claim.amount.slice(0, 4096) }),
      meter: claim.meter,
      unit: "million tokens",
      conditions: [
        { dimension: "published_currency", value: currency },
        ...(claim.periodText === undefined
          ? []
          : [{ dimension: "published_billing_period", value: claim.periodText }]),
      ],
      fragment: claim.fragment || `Missing ${claim.label} quote for ${claim.header}`,
    },
  });
  pricingDiagnostic(
    input,
    "raw",
    reason === "unknown_applicability"
      ? "scheduled_billing_period_claim_drift"
      : reason === "unsupported_structure"
        ? "price_cell_conflict"
        : "price_cell_preserved",
    `${claim.header}:${currency}:${claim.meter}:${claim.amount}`,
  );
}

function attachTariffs(
  input: Input,
  models: ProviderModel[],
  claims: TariffCell[],
  currency: DeepseekCurrency,
  url: string,
): void {
  const byId = new Map(models.map((model) => [model.model_id, model]));
  const identity = (claim: TariffCell): string =>
    JSON.stringify([catalogId(claim.header), claim.meter, claim.conditions]);
  const counts = new Map<string, number>();
  for (const claim of claims)
    if (!claim.invalidPeriod) counts.set(identity(claim), (counts.get(identity(claim)) ?? 0) + 1);
  for (const claim of claims) {
    const id = catalogId(claim.header);
    const target = id === undefined ? undefined : byId.get(id);
    if (target === undefined) {
      pricingDiagnostic(
        input,
        "unbound",
        "price_cell_model_unbound",
        `${claim.header}:${currency}:${claim.meter}:${claim.amount}`,
      );
      input.onPricingDependencyFailure?.(url);
      continue;
    }
    const reason = claim.invalidPeriod
      ? "unknown_applicability"
      : (counts.get(identity(claim)) ?? 0) > 1
        ? "unsupported_structure"
        : undefined;
    if (reason !== undefined) {
      preserveTariff(input, target, claim, currency, reason);
      continue;
    }
    let amount: string;
    try {
      amount = deepseekPrice(claim.amount, currency);
    } catch {
      preserveTariff(input, target, claim, currency, "unknown_amount");
      continue;
    }
    addRate(
      input,
      target,
      priceFact(
        input,
        claim.meter,
        amount,
        claim.label + (claim.periodText === undefined ? "" : ` (${claim.periodText})`),
        currency,
        claim.conditions,
      ),
      `${claim.header}:${currency}:${claim.meter}`,
    );
  }
}

function attachPricing(
  input: Input,
  bundle: Bundle,
  models: ProviderModel[],
  usdTable: HtmlTable,
): DeepseekBillingRule | undefined {
  const parseCurrency = (
    body: string,
    table: HtmlTable,
    currency: DeepseekCurrency,
    url: string,
    usd?: ScheduledPricing,
  ): ScheduledPricing | undefined => {
    try {
      const scheduled = scheduledPricing(input, body, currency, table);
      if (
        currency === "CNY" &&
        (scheduled?.rule.policy !== usd?.rule.policy ||
          (scheduled?.layout === "separate" ? scheduled.effectiveFrom : undefined) !==
            (usd?.layout === "separate" ? usd.effectiveFrom : undefined))
      )
        throw new Error("DeepSeek USD and CNY billing rules or effective times disagree");
      const claims = tariffCells(table, scheduled, currency);
      if (scheduled !== undefined)
        for (const model of models)
          for (const [meter] of priceRows) {
            const scoped = claims.filter(
              (claim) =>
                catalogId(claim.header) === model.model_id &&
                claim.meter === meter &&
                claim.periodText !== undefined,
            );
            if (
              !scoped.some(({ invalidPeriod }) => invalidPeriod) &&
              (!scoped.some(({ conditions }) => conditions.billing_period === "peak") ||
                !scoped.some(({ conditions }) => conditions.billing_period === "off_peak"))
            )
              throw new Error(
                `DeepSeek ${currency} omitted a scheduled period for ${model.model_id}:${meter}`,
              );
          }
      attachTariffs(input, models, claims, currency, url);
      if (scheduled !== undefined) {
        for (const model of models)
          model.raw_price_facts.push({
            term_key: "billing-period-applicability",
            impact: "informational",
            reason: "unsupported_structure",
            conditions: { billing_currency: currency },
            source_ref: input.source.id,
            raw: { label: "Peak / Off-peak applicability", fragment: scheduled.rule.fragment },
          });
        pricingDiagnostic(input, "normalized", "billing_period_rule_verified", currency);
      }
      return scheduled;
    } catch (error) {
      pricingDiagnostic(
        input,
        "unresolved",
        "commercial_source_contract_drift",
        `${currency}: ${error instanceof Error ? error.message : String(error)}`,
      );
      input.onPricingDependencyFailure?.(url);
    }
  };
  const usd = parseCurrency(bundle.index.body, usdTable, "USD", bundle.index.url);
  const url = "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/";
  const body = companion(input, bundle, "/zh-cn/quick_start/pricing");
  if (body === undefined) {
    input.onPricingDependencyFailure?.(url);
    return usd?.rule;
  }
  const tables = htmlTables(body).filter(({ rows }) =>
    cnyPriceRows.every(([, label]) => rows.some((row) => rowLabel(row) === label)),
  );
  const [table] = tables;
  if (tables.length !== 1 || table === undefined) {
    pricingDiagnostic(input, "unresolved", "cny_price_table_drift", "model table");
    input.onPricingDependencyFailure?.(url);
    return usd?.rule;
  }
  parseCurrency(body, table, "CNY", url, usd);
  return usd?.rule;
}

function supportValue(value: string): boolean {
  if (value === "✓" || /^Non-thinking mode only$/i.test(value)) return true;
  if (value === "✗" || /^Not supported$/i.test(value)) return false;
  throw new Error(`Unknown DeepSeek support value: ${value}`);
}

function thinkingValue(value: string): boolean {
  if (/^Supports both non-thinking and thinking\b/i.test(value)) return true;
  if (/^Non-thinking mode only$/i.test(value)) return false;
  throw new Error(`Unknown DeepSeek thinking mode: ${value}`);
}

function bounded(input: Input, models: ProviderModel[]): ProviderModel[] {
  if (input.source.extractor.kind !== "deepseek-catalog")
    throw new Error("Wrong DeepSeek catalog extractor");
  const { minModels, maxModels } = input.source.extractor;
  assertItemCount("DeepSeek model catalog", models.length, minModels, maxModels);
  return models.sort((left, right) => left.model_id.localeCompare(right.model_id));
}

function attachLegacyRedirects(input: Input, body: string, models: ProviderModel[]): void {
  const $ = load(body);
  const byId = new Map(models.map((item) => [item.model_id, item]));
  for (const paragraph of $("article p").toArray()) {
    const text = htmlText($(paragraph).text());
    if (!/\blegacy names\b/i.test(text)) continue;
    const redirect = pricingClaim(
      input,
      "legacy_redirect_contract_drift",
      "legacy model names",
      () => {
        const match =
          /^\(\d+\) Use (\S+) as the model name\. The legacy names (.+?) are still accepted, but the corresponding models have been retired, their requests are served by the (.+?) model and billed at the (.+?) price\.$/.exec(
            text,
          );
        const target = match?.[1] === undefined ? undefined : byId.get(match[1]);
        const label = match?.[4];
        if (
          target === undefined ||
          target.name !== match?.[3] ||
          label === undefined ||
          !target.model_id.endsWith(`-${label.toLowerCase()}`)
        )
          throw new Error("expected an exact current model and explicit same-price redirect");
        const ids = $(paragraph)
          .find("code")
          .toArray()
          .map((code) => exactId(htmlText($(code).text())));
        const legacyIds = ids.slice(1).filter((id): id is string => id !== undefined);
        if (
          ids[0] !== target.model_id ||
          legacyIds.length === 0 ||
          legacyIds.length !== ids.length - 1 ||
          new Set(ids).size !== ids.length ||
          legacyIds.some((id) => byId.has(id)) ||
          match?.[2] !== legacyIds.join(" and ")
        )
          throw new Error("expected distinct legacy IDs bound only by the redirect notice");
        return { target, legacyIds };
      },
    );
    if (redirect === undefined) continue;
    for (const id of redirect.legacyIds) {
      const legacy = structuredClone(redirect.target);
      legacy.model_id = id;
      legacy.uid = modelUid(input.provider.id, id);
      legacy.status = "legacy";
      legacy.aliases = [];
      legacy.replacement_model_ids = [redirect.target.model_id];
      legacy.price_facts = legacy.price_facts.map((rate) => ({
        ...rate,
        derived: true,
        derivation: `Official legacy ID ${id} is served by ${redirect.target.model_id} and billed at its current rate.`,
      }));
      models.push(legacy);
      byId.set(id, legacy);
    }
    pricingDiagnostic(
      input,
      "normalized",
      "legacy_redirect_bound",
      `${redirect.legacyIds.join(", ")} → ${redirect.target.model_id}`,
    );
  }
}

export function parseDeepseekCatalog(input: Input): SourceParseResult {
  const bundle = linkedBundleSchema.parse(JSON.parse(input.body));
  const chat = chatClaims(input, companion(input, bundle, "/api/create-chat-completion"));
  const responses = responseClaims(input, companion(input, bundle, "/api/create-response"));
  const fim = fimClaims(input, companion(input, bundle, "/api/create-completion"));
  const anthropic = anthropicClaims(input, companion(input, bundle, "/guides/anthropic_api"));
  const vision = visionClaims(input, companion(input, bundle, "/guides/vision"));
  const modelTables = htmlTables(bundle.index.body).filter(
    ({ headers, rows }) =>
      headers[0] === "MODEL" && rows.some((item) => rowLabel(item) === "MODEL VERSION"),
  );
  const [table] = modelTables;
  if (modelTables.length !== 1 || table === undefined)
    throw new Error("DeepSeek model table not found or ambiguous");
  const columns: Array<{ column: number; id: string }> = [];
  const seen = new Set<string>();
  const columnStart = modelColumnStart(table, "MODEL");
  for (const [index, header] of table.headers.slice(columnStart).entries()) {
    const id = catalogId(header);
    if (id === undefined || seen.has(id)) {
      catalogFinding(
        input,
        id === undefined ? "catalog_model_header_invalid" : "catalog_model_header_duplicate",
        header,
      );
      continue;
    }
    seen.add(id);
    columns.push({ column: index + columnStart, id });
  }
  if (columns.length < 1) throw new Error("DeepSeek catalog returned no model IDs");
  validateCatalogTable(
    input,
    table,
    columns.map(({ column }) => column),
  );
  const tableResponseIds = supportedModelIds(
    input,
    table,
    columns,
    "Responses API",
    "responses_table_claim_drift",
  );
  const tableFimIds = supportedModelIds(
    input,
    table,
    columns,
    "FIM Completion（Beta）",
    "fim_table_claim_drift",
  );
  const tableAnthropicIds = supportedModelIds(
    input,
    table,
    columns,
    "Anthropic API",
    "anthropic_table_claim_drift",
  );
  if (
    responses.modelIds.size > 0 &&
    (responses.modelIds.size !== tableResponseIds.size ||
      [...responses.modelIds].some((id) => !tableResponseIds.has(id)))
  )
    catalogFinding(input, "responses_inventory_disagreement");
  if (
    fim.modelIds.size > 0 &&
    (fim.modelIds.size !== tableFimIds.size || [...fim.modelIds].some((id) => !tableFimIds.has(id)))
  )
    catalogFinding(input, "fim_inventory_disagreement");
  const models = columns.map(({ column, id }) =>
    model(
      input,
      table,
      column,
      id,
      chat,
      responses,
      fim,
      vision,
      anthropic.available && tableAnthropicIds.has(id),
      anthropic.streaming,
    ),
  );
  const knownIds = new Set(models.map(({ model_id }) => model_id));
  for (const id of chat.modelIds)
    if (!knownIds.has(id)) catalogFinding(input, "chat_model_not_in_catalog", id);
  for (const id of vision.modelIds)
    if (!knownIds.has(id)) catalogFinding(input, "vision_model_not_in_catalog", id);
  const inventoryBody = companion(input, bundle, "/api/list-models");
  const inventoryIds =
    inventoryBody === undefined
      ? undefined
      : catalogClaim(input, "model_inventory_contract_drift", "GET /models", () =>
          inventoryReferenceModels(input, inventoryBody),
        );
  if (
    inventoryIds !== undefined &&
    (inventoryIds.size !== models.length ||
      models.some(({ model_id }) => !inventoryIds.has(model_id)))
  )
    catalogFinding(input, "model_inventory_disagreement");
  for (const model of models)
    model.limits = { ...model.limits, ...inventoryIds?.get(model.model_id) };

  const billingRule = attachPricing(input, bundle, models, table);
  attachLegacyRedirects(input, bundle.index.body, models);
  const pricingInputs = extractDeepseekPricingInputs(
    bundle.documents,
    input.source.id,
    input.onContractFinding,
  );
  const services = deepseekServicePricing(input, bundle);
  return {
    models: bounded(input, models),
    pricing_inputs: pricingInputs,
    commercial_facts: services.commercial_facts ?? [],
    vocabulary: [
      ...(billingRule === undefined ? [] : deepseekBillingVocabulary(billingRule)),
      ...(services.vocabulary ?? []),
    ],
  };
}

interface Dates {
  release?: string;
  releaseStage?: "experimental" | "preview";
  update?: string;
}

function latest(current: string | undefined, incoming: string): string {
  return current === undefined || current < incoming ? incoming : current;
}

function earliest(current: string | undefined, incoming: string): string {
  return current === undefined || current > incoming ? incoming : current;
}

export function parseDeepseekUpdates(input: Input): ProviderModel[] {
  if (input.source.extractor.kind !== "deepseek-updates")
    throw new Error("Wrong DeepSeek updates extractor");
  const $ = load(input.body);
  const dates = new Map<string, Dates>();
  $("article h2").each((_index, heading) => {
    const label = htmlText($(heading).text());
    if (!label.startsWith("Date:")) return;
    const parsedDate = z.iso.date().safeParse(label.slice(5).trim());
    if (!parsedDate.success) {
      catalogFinding(input, "update_date_invalid", label);
      return;
    }
    const date = parsedDate.data;
    $(heading)
      .nextUntil("h2")
      .filter("p,li")
      .add($(heading).nextUntil("h2").find("p,li"))
      .each((_paragraphIndex, paragraph) => {
        const prose = htmlText($(paragraph).text());
        if (
          !/(?:model parameter|API model names?|model name|model upgraded|\bnew\b.*\bmodel\b|models? .* upgraded|corresponds? to)/i.test(
            prose,
          )
        )
          return;
        const release =
          !/backward compatibility/i.test(prose) &&
          /(?:\bAPI now supports\b|\bis our new model\b|\bofficial release\b|\bnow available\b)/i.test(
            prose,
          );
        const releaseStage = /\bexperimental model\b/i.test(prose)
          ? "experimental"
          : /\bpublic beta\b/i.test(prose)
            ? "preview"
            : undefined;
        $(paragraph)
          .find("code")
          .each((_codeIndex, code) => {
            const id = updateModelId(htmlText($(code).text()));
            if (id === undefined) return;
            const current = dates.get(id) ?? {};
            const released = release ? earliest(current.release, date) : current.release;
            const observedReleaseStage = current.releaseStage ?? releaseStage;
            const updated: Dates = {
              update: latest(current.update, date),
              ...(observedReleaseStage === undefined ? {} : { releaseStage: observedReleaseStage }),
            };
            dates.set(id, released === undefined ? updated : { ...updated, release: released });
          });
      });
  });
  const models = [...dates].map(([id, observed]): ProviderModel => ({
    ...baseModel({
      providerId: input.provider.id,
      id,
      name: id,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    }),
    ...(observed.release === undefined ? {} : { release_date: observed.release }),
    ...(observed.releaseStage === undefined ? {} : { release_stage: observed.releaseStage }),
    ...(observed.update === undefined || observed.update === observed.release
      ? {}
      : { updated_date: observed.update }),
  }));
  const { minModels, maxModels } = input.source.extractor;
  assertItemCount("DeepSeek updates", models.length, minModels, maxModels);
  return models.sort((left, right) => left.model_id.localeCompare(right.model_id));
}

export function parseDeepseekApi(input: Input): ProviderModel[] {
  if (input.source.extractor.kind !== "deepseek-api")
    throw new Error("Wrong DeepSeek API extractor");
  const list = apiListSchema.parse(JSON.parse(input.body));
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const [index, value] of list.data.entries()) {
    const item = apiListItemSchema.safeParse(value);
    if (!item.success) {
      catalogFinding(input, "api_model_record_invalid", String(index));
      continue;
    }
    if (seen.has(item.data.id)) {
      catalogFinding(input, "api_model_record_duplicate", item.data.id);
      continue;
    }
    seen.add(item.data.id);
    ids.push(item.data.id);
  }
  const { minModels, maxModels } = input.source.extractor;
  assertItemCount("DeepSeek API models", ids.length, minModels, maxModels);
  return ids.map((id) => ({
    ...baseModel({
      providerId: input.provider.id,
      id,
      name: id,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    }),
  }));
}
