import { load } from "cheerio";
import { z } from "zod";
import { htmlTables, htmlText, type HtmlTable } from "./html.ts";
import { modelIdSchema } from "./identity.ts";
import type { SourceManifest } from "./manifests.ts";
import { baseModel } from "./model.ts";
import { publishedRate, rawPricingFact } from "./pricing.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import { canonicalizeInstant } from "./pricing-time.ts";
import type {
  ParsedProviderModel as ProviderModel,
  SourcePriceFact,
  SourceRawPricingFact,
} from "./pricing-source.ts";
import { assertItemCount } from "./source-contract.ts";
import { type Provider, unknownCapabilities } from "./schema.ts";

interface Input {
  provider: Provider;
  source: SourceManifest;
  body: string;
  observedAt: string;
  onPricingReconciliation?: (item: PricingReconciliationItem) => void;
}

const bundleSchema = z.object({
  index: z.object({ url: z.url(), body: z.string().min(1) }),
  documents: z.array(z.object({ url: z.url(), body: z.string().min(1) })),
});

type Bundle = z.infer<typeof bundleSchema>;

const listItemSchema = z
  .object({
    id: modelIdSchema,
    object: z.literal("model"),
    owned_by: z.string().min(1),
  })
  .strict();
const listSchema = z
  .object({ object: z.literal("list"), data: z.array(listItemSchema).min(1) })
  .strict();
const apiListSchema = z.object({ object: z.literal("list"), data: z.array(z.unknown()) });
const apiListItemSchema = z.object({
  id: modelIdSchema,
  object: z.literal("model"),
  owned_by: z.string().min(1),
});

const chatEndpoint = { name: "Chat Completions", path: "/chat/completions" };
const responsesEndpoint = { name: "Responses", path: "/responses" };
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

type DeepseekCurrency = "CNY" | "USD";
type BillingPeriod = "off_peak" | "peak";

interface ScheduledPricing {
  effectiveFrom: string;
  table: HtmlTable;
}

function exactId(value: string): string | undefined {
  const parsed = modelIdSchema.safeParse(value.trim());
  return parsed.success ? parsed.data : undefined;
}

function withoutFootnote(value: string): string {
  return value.replace(/\(\d+\)$/, "");
}

function catalogId(value: string): string | undefined {
  return exactId(withoutFootnote(value));
}

function tokenCount(value: string): number {
  const match = value.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*([kKmM])?/);
  if (match?.[1] === undefined) throw new Error(`Invalid DeepSeek token limit: ${value}`);
  const scale = match[2]?.toLowerCase() === "m" ? 1_000_000 : match[2] ? 1_000 : 1;
  const result = Number(match[1]) * scale;
  if (!Number.isSafeInteger(result)) throw new Error(`Invalid DeepSeek token limit: ${value}`);
  return result;
}

function price(value: string, currency: "CNY" | "USD"): string {
  const pattern =
    currency === "USD" ? /^\$(0|[1-9]\d*)(?:\.(\d+))?$/ : /^(?:¥|￥)?(0|[1-9]\d*)(?:\.(\d+))?元?$/;
  const match = value.match(pattern);
  if (match?.[1] === undefined) throw new Error(`Invalid DeepSeek price: ${value}`);
  return match[2] === undefined ? match[1] : `${match[1]}.${match[2]}`;
}

function rowLabel(value: HtmlTable["rows"][number]): string {
  return withoutFootnote(value[1]?.text ?? value[0]?.text ?? "");
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

function support(table: HtmlTable, label: string, columns: number[]): boolean[] {
  return cells(table, label, columns).map((value) => {
    if (value === "✓" || /^Non-thinking mode only$/i.test(value)) return true;
    if (value === "✗") return false;
    throw new Error(`Unknown DeepSeek support value: ${value}`);
  });
}

function endpointEvidence(
  body: string,
  endpoint: NonNullable<ProviderModel["api_endpoints"]>[number],
): {
  modelIds: Set<string>;
  propertyValues: (name: string) => string[] | undefined;
  propertyText: (name: string) => string[];
} {
  const $ = load(body);
  const article = $("article");
  const operations = article.find("pre.openapi__method-endpoint");
  const operation = operations.first();
  if (
    operations.length !== 1 ||
    htmlText(operation.find(".badge").first().text()) !== "POST" ||
    htmlText(operation.find("h2.openapi__method-endpoint-path").first().text()) !== endpoint.path
  )
    throw new Error(`DeepSeek ${endpoint.name} reference changed operation`);
  const schemaItems = article.find(".openapi-schema__list-item").toArray();
  const propertyValues = (name: string): string[] | undefined => {
    const values = schemaItems
      .filter(
        (element) =>
          htmlText($(element).find("strong.openapi-schema__property").first().text()) === name,
      )
      .flatMap((element) =>
        $(element)
          .find("p")
          .toArray()
          .filter((paragraph) => /^Possible values:/i.test(htmlText($(paragraph).text())))
          .map((paragraph) =>
            $(paragraph)
              .find("code")
              .map((_index, code) => htmlText($(code).text()))
              .get(),
          ),
      )
      .filter((items) => items.length > 0);
    return values.length === 1 ? values[0] : undefined;
  };
  const propertyText = (name: string): string[] =>
    schemaItems
      .filter(
        (element) =>
          htmlText($(element).find("strong.openapi-schema__property").first().text()) === name,
      )
      .map((element) => htmlText($(element).text()));
  const modelValues = propertyValues("model");
  if (modelValues === undefined)
    throw new Error(`DeepSeek ${endpoint.name} reference changed model schema`);
  const ids = z.array(modelIdSchema).min(1).safeParse(modelValues);
  if (!ids.success || new Set(ids.data).size !== ids.data.length)
    throw new Error(`DeepSeek ${endpoint.name} reference returned invalid model IDs`);
  return { modelIds: new Set(ids.data), propertyValues, propertyText };
}

function propertyClaims(
  evidence: ReturnType<typeof endpointEvidence>,
  property: string,
  claims: readonly string[],
  message: string,
): void {
  const value = evidence.propertyText(property).join(" ").toLowerCase();
  if (value === "" || claims.some((claim) => !value.includes(claim.toLowerCase())))
    throw new Error(message);
}

interface ChatClaims {
  effortControl: boolean;
  modelIds: Set<string>;
  streaming: boolean;
  tokenAccounting: boolean;
}

function chatClaims(input: Input, body: string | undefined): ChatClaims {
  if (body === undefined)
    return { effortControl: false, modelIds: new Set(), streaming: false, tokenAccounting: false };
  const evidence = claim(input, "chat_operation_contract_drift", "Chat Completions", () =>
    endpointEvidence(body, chatEndpoint),
  );
  if (evidence === undefined)
    return { effortControl: false, modelIds: new Set(), streaming: false, tokenAccounting: false };
  const effortControl =
    claim(input, "chat_reasoning_controls_drift", "reasoning controls", () => {
      const thinking = evidence.propertyValues("thinking");
      const effort = evidence.propertyValues("reasoning_effort");
      if (
        thinking === undefined ||
        !["enabled", "disabled"].every((value) => thinking.includes(value)) ||
        effort === undefined ||
        !["high", "max"].every((value) => effort.includes(value))
      )
        throw new Error("expected thinking and reasoning_effort values");
      return true;
    }) === true;
  claim(input, "chat_structured_output_drift", "response_format", () => {
    const values = evidence.propertyValues("response_format");
    if (values === undefined || !["text", "json_object"].every((value) => values.includes(value)))
      throw new Error("expected text and json_object");
  });
  claim(input, "chat_tool_schema_drift", "tools", () => {
    if (evidence.propertyValues("tools")?.includes("function") !== true)
      throw new Error("expected function tool");
  });
  const streaming =
    claim(input, "chat_streaming_contract_drift", "stream", () => {
      if (
        evidence
          .propertyText("stream")
          .filter((value) => /partial message deltas will be sent/.test(value)).length !== 1
      )
        throw new Error("expected one streaming claim");
      propertyClaims(
        evidence,
        "include_usage",
        ["entire request", "choices field will always be an empty array"],
        "streaming usage contract drifted",
      );
      return true;
    }) === true;
  const tokenAccounting =
    claim(input, "chat_usage_contract_drift", "usage", () => {
      propertyClaims(
        evidence,
        "usage",
        [
          "completion_tokens",
          "prompt_tokens",
          "prompt_cache_hit_tokens",
          "prompt_cache_miss_tokens",
          "total_tokens",
          "reasoning_tokens",
        ],
        "usage contract drifted",
      );
      return true;
    }) === true;
  return { effortControl, modelIds: evidence.modelIds, streaming, tokenAccounting };
}

interface ResponseClaims {
  modelIds: Set<string>;
  tokenAccounting: boolean;
}

function responseClaims(input: Input, body: string | undefined): ResponseClaims {
  if (body === undefined) return { modelIds: new Set(), tokenAccounting: false };
  const evidence = claim(input, "responses_operation_contract_drift", "Responses", () =>
    endpointEvidence(body, responsesEndpoint),
  );
  if (evidence === undefined) return { modelIds: new Set(), tokenAccounting: false };
  const tokenAccounting =
    claim(input, "responses_usage_contract_drift", "Responses usage", () => {
      propertyClaims(
        evidence,
        "usage",
        ["input_tokens", "cached_tokens", "output_tokens", "reasoning_tokens", "total_tokens"],
        "usage contract drifted",
      );
      return true;
    }) === true;
  return { modelIds: evidence.modelIds, tokenAccounting };
}

interface FimClaims {
  modelIds: Set<string>;
  tokenAccounting: boolean;
}

function fimClaims(input: Input, body: string | undefined): FimClaims {
  if (body === undefined) return { modelIds: new Set(), tokenAccounting: false };
  const evidence = claim(input, "fim_operation_contract_drift", "FIM Completion", () =>
    endpointEvidence(body, fimReferenceEndpoint),
  );
  if (evidence === undefined) return { modelIds: new Set(), tokenAccounting: false };
  const tokenAccounting =
    claim(input, "fim_usage_contract_drift", "FIM usage", () => {
      propertyClaims(
        evidence,
        "usage",
        [
          "completion_tokens",
          "prompt_tokens",
          "prompt_cache_hit_tokens",
          "prompt_cache_miss_tokens",
          "total_tokens",
        ],
        "usage contract drifted",
      );
      return true;
    }) === true;
  return { modelIds: evidence.modelIds, tokenAccounting };
}

function schemaProperty(element: ReturnType<ReturnType<typeof load>>): string {
  return htmlText(element.find("strong.openapi-schema__property").first().text());
}

function inventoryReferenceModelIds(body: string): Set<string> {
  const $ = load(body);
  const article = $("article");
  const operations = article.find("pre.openapi__method-endpoint");
  const operation = operations.first();
  if (
    operations.length !== 1 ||
    htmlText(operation.find(".badge").first().text()) !== "GET" ||
    htmlText(operation.find("h2.openapi__method-endpoint-path").first().text()) !== "/models"
  )
    throw new Error("DeepSeek model-inventory reference changed operation");

  const schemaItems = article.find(".openapi-schema__list-item").toArray();
  const rootItems = schemaItems.filter(
    (element) => $(element).parents(".openapi-schema__list-item").length === 0,
  );
  const rootNames = rootItems.map((element) => schemaProperty($(element)));
  if (rootNames.join("\0") !== "object\0data")
    throw new Error("DeepSeek model-inventory reference changed response schema");
  const rootObject = rootItems[0];
  const data = rootItems[1];
  if (
    rootObject === undefined ||
    data === undefined ||
    !/Possible values:\s*\[list\]/i.test(htmlText($(rootObject).text()))
  )
    throw new Error("DeepSeek model-inventory reference changed response schema");
  const itemNames = $(data)
    .find(".openapi-schema__list-item")
    .toArray()
    .filter((element) => $(element).parents(".openapi-schema__list-item").first().get(0) === data)
    .map((element) => schemaProperty($(element)));
  if (itemNames.join("\0") !== "id\0object\0owned_by")
    throw new Error("DeepSeek model-inventory reference changed response schema");
  const itemObject = $(data)
    .find(".openapi-schema__list-item")
    .toArray()
    .find((element) => schemaProperty($(element)) === "object");
  if (
    itemObject === undefined ||
    !/Possible values:\s*\[model\]/i.test(htmlText($(itemObject).text()))
  )
    throw new Error("DeepSeek model-inventory reference changed response schema");

  const examples = article
    .find(".openapi-code__response-samples-container pre code")
    .toArray()
    .flatMap((element) => {
      const parsedJson = z
        .string()
        .transform((value, context): unknown => {
          try {
            return JSON.parse(value);
          } catch {
            context.addIssue({ code: "custom", message: "Invalid JSON" });
            return z.NEVER;
          }
        })
        .safeParse($(element).text());
      if (!parsedJson.success) return [];
      const parsed = listSchema.safeParse(parsedJson.data);
      return parsed.success ? [parsed.data] : [];
    })
    .filter(({ data: models }) =>
      models.every(({ id, owned_by }) => id !== "string" && owned_by !== "string"),
    );
  const [example] = examples;
  if (examples.length !== 1 || example === undefined)
    throw new Error("DeepSeek model-inventory reference omitted the current example");
  const ids = example.data.map(({ id }) => id);
  if (new Set(ids).size !== ids.length)
    throw new Error("DeepSeek model-inventory reference returned duplicate model IDs");
  return new Set(ids);
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

function companion(input: Input, bundle: Bundle, pathname: string): string | undefined {
  const normalized = (value: string): string => value.replace(/\/$/, "");
  const matches = bundle.documents.filter(
    ({ url }) => normalized(new URL(url).pathname) === normalized(pathname),
  );
  if (matches.length === 1) return matches[0]?.body;
  diagnostic(
    input,
    matches.length === 0 ? "unbound" : "unsupported",
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
  ...priceRows.map(([, label]) => label),
  "Concurrency Limit",
]);

function validateCatalogTable(input: Input, table: HtmlTable, columns: number[]): void {
  const unhandled = table.rows.map(rowLabel).filter((label) => !catalogRows.has(label));
  if (unhandled.length > 0)
    diagnostic(input, "unsupported", "catalog_row_unhandled", unhandled.join(" | "));
  for (const [label, expected] of baseUrls)
    claim(input, "catalog_base_url_drift", label, () => {
      if (cells(table, label, columns).some((value) => value !== expected))
        throw new Error(`expected ${expected}`);
    });
  for (const label of ["Chat Prefix Completion（Beta）", "FIM Completion（Beta）", "Anthropic API"])
    claim(input, "catalog_support_claim_drift", label, () => support(table, label, columns));
}

function model(
  input: Input,
  table: HtmlTable,
  column: number,
  id: string,
  chat: ChatClaims,
  responses: ResponseClaims,
  fim: FimClaims,
  effectiveUntil: string | undefined,
): ProviderModel {
  const value = <T>(reasonCode: string, label: string, parse: (cell: string) => T): T | undefined =>
    claim(input, reasonCode, `${id}:${label}`, () => parse(cell(table, label, column)));
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
  const apiEndpoints = [
    ...(hasChatEndpoint ? [chatEndpoint] : []),
    ...(hasResponsesEndpoint ? [responsesEndpoint] : []),
    ...(hasFimEndpoint ? [fimEndpoint] : []),
  ];
  const priceFacts = priceRows.flatMap(([meter, label]): SourcePriceFact[] => {
    const amount = value("usd_price_claim_drift", label, (item) => price(item, "USD"));
    return amount === undefined
      ? []
      : [
          publishedRate(meter, amount, "million_tokens", input.source.id, label, {
            billing_currency: "USD",
            ...(effectiveUntil === undefined ? {} : { effective_until: effectiveUntil }),
          }),
        ];
  });
  for (const rate of priceFacts)
    input.onPricingReconciliation?.({
      disposition: "normalized",
      reason_code: "price_fact_normalized",
      sample: `${id}:${rate.meter}`,
    });
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
    modalities: { input: ["text"], output: ["text"] },
    capabilities: {
      ...unknownCapabilities(),
      ...(reasoning === undefined ? {} : { reasoning }),
      ...(tools === undefined ? {} : { tool_call: tools }),
      ...(structured === undefined ? {} : { structured_output: structured }),
      ...(hasChatEndpoint && chat.streaming ? { streaming: true } : {}),
      ...(hasChatEndpoint && chat.effortControl ? { effort_control: true } : {}),
      ...(priceFacts.some(({ meter }) => meter === "cache_read_text")
        ? { prompt_cache: true }
        : {}),
    },
    limits: {
      ...(context === undefined ? {} : { context_tokens: context }),
      ...(output === undefined ? {} : { max_output_tokens: output }),
    },
    status: "active",
    pricing_state: priceFacts.length === 0 ? "unknown" : "numeric",
    price_facts: priceFacts,
  };
}

function scheduledPricing(body: string, currency: DeepseekCurrency): ScheduledPricing | undefined {
  const expectedHeaders = (currency === "USD" ? priceRows : cnyPriceRows).map(([, label]) => label);
  const modelHeader = currency === "USD" ? "MODEL" : "模型";
  const tables = htmlTables(body).filter(
    ({ headers }) =>
      headers[0] === modelHeader &&
      headers[1] === modelHeader &&
      headers.length === expectedHeaders.length + 2 &&
      expectedHeaders.every((header, index) => headers[index + 2] === header),
  );
  if (tables.length === 0) {
    const prose = htmlText(load(body)("article").text());
    const hasNotice =
      currency === "USD" ? /peak\s*\/\s*off-peak billing/i.test(prose) : /采用峰谷定价/.test(prose);
    if (hasNotice) throw new Error(`DeepSeek ${currency} scheduled price table not found`);
    return;
  }
  const table = tables[0];
  if (tables.length !== 1 || table === undefined)
    throw new Error(`DeepSeek ${currency} scheduled price table is ambiguous`);
  return {
    table,
    effectiveFrom:
      currency === "USD" ? englishScheduledEffectiveFrom(body) : cnyScheduledEffectiveFrom(body),
  };
}

function englishScheduledEffectiveFrom(body: string): string {
  const prose = htmlText(load(body)("article").text());
  const match =
    /Peak hours are 01:00\s*[-–]\s*04:00 and 06:00\s*[-–]\s*10:00 UTC \(all other hours are off-peak\).*?new prices take effect at (\d{2}:\d{2}) UTC on ([A-Za-z]+) (\d{1,2}), (\d{4})/i.exec(
      prose,
    );
  const monthNames = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];
  const time = match?.[1];
  const monthName = match?.[2]?.toLowerCase();
  const day = match?.[3];
  const year = match?.[4];
  const monthIndex = monthName === undefined ? -1 : monthNames.indexOf(monthName);
  if (time === undefined || day === undefined || year === undefined || monthIndex < 0)
    throw new Error("DeepSeek scheduled pricing notice changed");
  return canonicalizeInstant(
    `${year}-${String(monthIndex + 1).padStart(2, "0")}-${day.padStart(2, "0")}T${time}:00Z`,
  );
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

function attachScheduledRates(
  input: Input,
  models: ProviderModel[],
  scheduled: ScheduledPricing,
  currency: DeepseekCurrency,
): void {
  const labels = currency === "USD" ? priceRows : cnyPriceRows;
  const byId = new Map(models.map((item) => [item.model_id, item]));
  const seen = new Set<string>();
  for (const tableRow of scheduled.table.rows) {
    const id = catalogId(tableRow[0]?.text ?? "");
    const periodText = tableRow[1]?.text;
    if (id === undefined || periodText === undefined) {
      diagnostic(input, "unsupported", "scheduled_price_row_invalid", currency);
      continue;
    }
    const period = claim(
      input,
      "scheduled_billing_period_claim_drift",
      `${id}:${currency}:${periodText}`,
      () => billingPeriod(periodText),
    );
    if (period === undefined) continue;
    const identity = `${id}\0${period}`;
    if (seen.has(identity)) {
      diagnostic(input, "unsupported", "scheduled_price_row_duplicate", `${id}:${currency}`);
      continue;
    }
    seen.add(identity);
    const target = byId.get(id);
    if (target === undefined) {
      diagnostic(input, "unbound", "scheduled_price_model_not_in_catalog", `${id}:${currency}`);
      continue;
    }
    for (const [index, [meter, label]] of labels.entries()) {
      const rawAmount = tableRow[index + 2]?.text;
      const amount = claim(
        input,
        "scheduled_price_claim_drift",
        `${id}:${meter}:${currency}:${period}`,
        () => {
          if (rawAmount === undefined) throw new Error("price is missing");
          return price(rawAmount, currency);
        },
      );
      if (amount === undefined) continue;
      const rate = publishedRate(
        meter,
        amount,
        "million_tokens",
        input.source.id,
        `${label} (${periodText})`,
        {
          billing_currency: currency,
          billing_period: period,
          effective_from: scheduled.effectiveFrom,
        },
      );
      target.price_facts.push(currency === "USD" ? rate : { ...rate, currency: "CNY" });
      diagnostic(
        input,
        "normalized",
        "price_fact_normalized",
        `${id}:${meter}:${currency}:${period}`,
      );
    }
    target.pricing_state = "numeric";
  }
}

function supportValue(value: string): boolean {
  if (value === "✓" || /^Non-thinking mode only$/i.test(value)) return true;
  if (value === "✗") return false;
  throw new Error(`Unknown DeepSeek support value: ${value}`);
}

function thinkingValue(value: string): boolean {
  if (/^Supports both non-thinking and thinking\b/i.test(value)) return true;
  if (/^Non-thinking mode only$/i.test(value)) return false;
  throw new Error(`Unknown DeepSeek thinking mode: ${value}`);
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

function attachCnyRates(
  input: Input,
  bundle: Bundle,
  models: ProviderModel[],
  usdEffectiveFrom: string | undefined,
): void {
  const body = companion(input, bundle, "/zh-cn/quick_start/pricing");
  if (body === undefined) return;
  const tables = htmlTables(body).filter(({ rows }) =>
    cnyPriceRows.every(([, label]) => rows.some((item) => rowLabel(item) === label)),
  );
  const [table] = tables;
  if (tables.length !== 1 || table === undefined) {
    diagnostic(input, "unsupported", "cny_price_table_drift", "model table");
    return;
  }
  const scheduled = scheduledPricing(body, "CNY");
  if (
    scheduled !== undefined &&
    usdEffectiveFrom !== undefined &&
    scheduled.effectiveFrom !== usdEffectiveFrom
  )
    throw new Error("DeepSeek USD and CNY scheduled pricing effective times disagree");
  const byId = new Map(models.map((item) => [item.model_id, item]));
  const seen = new Set<string>();
  for (const [index, header] of table.headers.slice(2).entries()) {
    const id = catalogId(header);
    if (id === undefined || seen.has(id)) {
      diagnostic(input, "unsupported", "cny_model_header_unbound", header);
      continue;
    }
    seen.add(id);
    const target = byId.get(id);
    if (target === undefined) {
      diagnostic(input, "unbound", "cny_model_not_in_usd_catalog", id);
      continue;
    }
    for (const [meter, label] of cnyPriceRows) {
      const amount = claim(input, "cny_price_claim_drift", `${id}:${label}`, () =>
        price(cell(table, label, index + 2), "CNY"),
      );
      if (amount === undefined) continue;
      target.price_facts.push({
        ...publishedRate(meter, amount, "million_tokens", input.source.id, label, {
          billing_currency: "CNY",
          ...(scheduled === undefined ? {} : { effective_until: scheduled.effectiveFrom }),
        }),
        currency: "CNY",
      });
      target.pricing_state = "numeric";
      diagnostic(input, "normalized", "price_fact_normalized", `${id}:${meter}:CNY`);
    }
  }
  if (scheduled !== undefined) attachScheduledRates(input, models, scheduled, "CNY");
}

function bounded(input: Input, models: ProviderModel[]): ProviderModel[] {
  if (input.source.extractor.kind !== "deepseek-catalog")
    throw new Error("Wrong DeepSeek catalog extractor");
  const { minModels, maxModels } = input.source.extractor;
  assertItemCount("DeepSeek model catalog", models.length, minModels, maxModels);
  return models.sort((left, right) => left.model_id.localeCompare(right.model_id));
}

export function parseDeepseekCatalog(input: Input): ProviderModel[] {
  const bundle = bundleSchema.parse(JSON.parse(input.body));
  const chat = chatClaims(input, companion(input, bundle, "/api/create-chat-completion"));
  const responses = responseClaims(input, companion(input, bundle, "/api/create-response"));
  const fim = fimClaims(input, companion(input, bundle, "/api/create-completion"));
  const modelTables = htmlTables(bundle.index.body).filter(
    ({ headers, rows }) =>
      headers[0] === "MODEL" &&
      headers[1] === "MODEL" &&
      rows.some((item) => rowLabel(item) === "MODEL VERSION"),
  );
  const [table] = modelTables;
  if (modelTables.length !== 1 || table === undefined)
    throw new Error("DeepSeek model table not found or ambiguous");
  const columns: Array<{ column: number; id: string }> = [];
  const seen = new Set<string>();
  for (const [index, header] of table.headers.slice(2).entries()) {
    const id = catalogId(header);
    if (id === undefined || seen.has(id)) {
      diagnostic(
        input,
        "unsupported",
        id === undefined ? "catalog_model_header_invalid" : "catalog_model_header_duplicate",
        header,
      );
      continue;
    }
    seen.add(id);
    columns.push({ column: index + 2, id });
  }
  if (columns.length < 1) throw new Error("DeepSeek catalog returned no model IDs");
  validateCatalogTable(
    input,
    table,
    columns.map(({ column }) => column),
  );
  const tableResponseIds = new Set(
    columns.flatMap(({ column, id }) =>
      claim(input, "responses_table_claim_drift", `${id}:Responses API`, () =>
        supportValue(cell(table, "Responses API", column)),
      ) === true
        ? [id]
        : [],
    ),
  );
  const tableFimIds = new Set(
    columns.flatMap(({ column, id }) =>
      claim(input, "fim_table_claim_drift", `${id}:FIM Completion`, () =>
        supportValue(cell(table, "FIM Completion（Beta）", column)),
      ) === true
        ? [id]
        : [],
    ),
  );
  if (
    responses.modelIds.size > 0 &&
    (responses.modelIds.size !== tableResponseIds.size ||
      [...responses.modelIds].some((id) => !tableResponseIds.has(id)))
  )
    diagnostic(input, "unbound", "responses_inventory_disagreement");
  if (
    fim.modelIds.size > 0 &&
    (fim.modelIds.size !== tableFimIds.size || [...fim.modelIds].some((id) => !tableFimIds.has(id)))
  )
    diagnostic(input, "unbound", "fim_inventory_disagreement");
  const scheduled = scheduledPricing(bundle.index.body, "USD");
  const models = columns.map(({ column, id }) =>
    model(input, table, column, id, chat, responses, fim, scheduled?.effectiveFrom),
  );
  if (scheduled !== undefined) attachScheduledRates(input, models, scheduled, "USD");
  const knownIds = new Set(models.map(({ model_id }) => model_id));
  for (const id of chat.modelIds)
    if (!knownIds.has(id)) diagnostic(input, "unbound", "chat_model_not_in_catalog", id);
  const inventoryBody = companion(input, bundle, "/api/list-models");
  const inventoryIds =
    inventoryBody === undefined
      ? undefined
      : claim(input, "model_inventory_contract_drift", "GET /models", () =>
          inventoryReferenceModelIds(inventoryBody),
        );
  if (
    inventoryIds !== undefined &&
    (inventoryIds.size !== models.length ||
      models.some(({ model_id }) => !inventoryIds.has(model_id)))
  )
    diagnostic(input, "unbound", "model_inventory_disagreement");

  for (const current of models) {
    const interfaces = [
      [chat.modelIds.has(current.model_id), chat.tokenAccounting, "chat"],
      [responses.modelIds.has(current.model_id), responses.tokenAccounting, "responses"],
      [fim.modelIds.has(current.model_id), fim.tokenAccounting, "fim"],
    ] as const;
    if (!interfaces.some(([applies, accounting]) => applies && accounting))
      current.raw_price_facts.push(
        rawGap(
          input.source.id,
          "tokens",
          "No reviewed public interface currently binds the published token rates to response usage fields",
        ),
      );
    else
      for (const [applies, accounting, key] of interfaces)
        if (applies && !accounting)
          current.raw_price_facts.push(
            rawGap(input.source.id, key, `The ${key} usage contract is unavailable`),
          );
  }
  attachCnyRates(input, bundle, models, scheduled?.effectiveFrom);
  return bounded(input, models);
}

interface Dates {
  release?: string;
  releaseStage?: "preview";
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
      diagnostic(input, "unsupported", "update_date_invalid", label);
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
          !/(?:model parameter|API model names?|model name|model upgraded|new model|models? .* upgraded|corresponds? to)/i.test(
            prose,
          )
        )
          return;
        const release =
          !/backward compatibility/i.test(prose) &&
          /(?:\bAPI now supports\b|\bis our new model\b|\bofficial release\b)/i.test(prose);
        const releaseStage = /\bpublic beta\b/i.test(prose) ? "preview" : undefined;
        $(paragraph)
          .find("code")
          .each((_codeIndex, code) => {
            const id = exactId(htmlText($(code).text()));
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
  const models = [...dates].map(
    ([id, observed]): ProviderModel => ({
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
    }),
  );
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
      diagnostic(input, "unsupported", "api_model_record_invalid", String(index));
      continue;
    }
    if (seen.has(item.data.id)) {
      diagnostic(input, "unsupported", "api_model_record_duplicate", item.data.id);
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
