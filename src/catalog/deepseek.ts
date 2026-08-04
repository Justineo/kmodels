import { load } from "cheerio";
import { z } from "zod";
import { linkedBundleSchema } from "./bundle.ts";
import { htmlTables, htmlText, type HtmlTable } from "./html.ts";
import { modelIdSchema } from "./identity.ts";
import type { SourceManifest } from "./manifests.ts";
import { baseModel } from "./model.ts";
import { publishedRate } from "./pricing.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import type { ParsedProviderModel as ProviderModel } from "./pricing-source.ts";
import { assertItemCount } from "./source-contract.ts";
import { type Provider, unknownCapabilities } from "./schema.ts";

interface Input {
  provider: Provider;
  source: SourceManifest;
  body: string;
  observedAt: string;
  onPricingReconciliation?: (item: PricingReconciliationItem) => void;
}

const listSchema = z.object({
  object: z.literal("list"),
  data: z
    .array(
      z.object({
        id: modelIdSchema,
        object: z.literal("model"),
        owned_by: z.string().min(1),
      }),
    )
    .min(1),
});

const chatEndpoint = { name: "Chat Completions", path: "/chat/completions" };
const responsesEndpoint = { name: "Responses", path: "/responses" };
const baseUrls = [
  ["BASE URL (OpenAI Format)", "https://api.deepseek.com"],
  ["BASE URL (Anthropic Format)", "https://api.deepseek.com/anthropic"],
] as const;
const priceRows = [
  ["cache_read_text", "1M INPUT TOKENS (CACHE HIT)"],
  ["input_text", "1M INPUT TOKENS (CACHE MISS)"],
  ["output_text", "1M OUTPUT TOKENS"],
] as const;

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

function price(value: string): string {
  const match = value.match(/^\$(0|[1-9]\d*)(?:\.(\d+))?$/);
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

function cells(table: HtmlTable, label: string, columns: number[]): string[] {
  const values = row(table, label);
  return columns.map((column) => {
    const value = values[column];
    if (value === undefined || value === "") throw new Error(`DeepSeek catalog omitted ${label}`);
    return value;
  });
}

function support(table: HtmlTable, label: string, columns: number[]): boolean[] {
  return cells(table, label, columns).map((value) => {
    if (value === "✓" || /^Non-thinking mode only$/i.test(value)) return true;
    if (value === "✗") return false;
    throw new Error(`Unknown DeepSeek support value: ${value}`);
  });
}

function thinking(table: HtmlTable, column: number): boolean {
  const value = cells(table, "THINKING MODE", [column])[0] ?? "";
  if (/^Supports both non-thinking and thinking\b/i.test(value)) return true;
  if (/^Non-thinking mode only$/i.test(value)) return false;
  throw new Error(`Unknown DeepSeek thinking mode: ${value}`);
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

function chatModelIds(body: string): Set<string> {
  const evidence = endpointEvidence(body, chatEndpoint);
  const thinkingValues = evidence.propertyValues("thinking");
  const effortValues = evidence.propertyValues("reasoning_effort");
  if (
    thinkingValues === undefined ||
    !["enabled", "disabled"].every((value) => thinkingValues.includes(value)) ||
    effortValues === undefined ||
    !["high", "max"].every((value) => effortValues.includes(value))
  )
    throw new Error("DeepSeek Chat Completions reference changed reasoning controls");
  const outputValues = evidence.propertyValues("response_format");
  if (
    outputValues === undefined ||
    !["text", "json_object"].every((value) => outputValues.includes(value))
  )
    throw new Error("DeepSeek Chat Completions reference changed structured-output schema");
  const toolValues = evidence.propertyValues("tools");
  if (toolValues === undefined || !toolValues.includes("function"))
    throw new Error("DeepSeek Chat Completions reference changed tool schema");
  const streaming = evidence
    .propertyText("stream")
    .filter((value) => /partial message deltas will be sent/.test(value));
  if (streaming.length !== 1)
    throw new Error("DeepSeek Chat Completions reference changed streaming schema");
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
    "DeepSeek Chat Completions reference changed usage schema",
  );
  propertyClaims(
    evidence,
    "include_usage",
    ["entire request", "choices field will always be an empty array"],
    "DeepSeek Chat Completions reference changed streaming usage schema",
  );
  return evidence.modelIds;
}

function responseModelIds(body: string): Set<string> {
  const evidence = endpointEvidence(body, responsesEndpoint);
  propertyClaims(
    evidence,
    "tools",
    ["function", "web_search", "executed on the server side"],
    "DeepSeek Responses reference changed tool schema",
  );
  propertyClaims(
    evidence,
    "usage",
    ["input_tokens", "cached_tokens", "output_tokens", "reasoning_tokens", "total_tokens"],
    "DeepSeek Responses reference changed usage schema",
  );
  return evidence.modelIds;
}

function companion(
  bundle: z.infer<typeof linkedBundleSchema>,
  path: string,
  label: string,
): string {
  const matches = bundle.documents.filter(({ url }) => new URL(url).pathname === path);
  const [match] = matches;
  if (matches.length !== 1 || match === undefined)
    throw new Error(`DeepSeek catalog omitted the ${label} reference`);
  return match.body;
}

function requireClaims(body: string, claims: readonly string[], message: string): void {
  const value = htmlText(load(body).root().text()).toLowerCase();
  if (claims.some((claim) => !value.includes(claim.toLowerCase()))) throw new Error(message);
}

function commercialEvidence(input: Input, bundle: z.infer<typeof linkedBundleSchema>): void {
  requireClaims(
    bundle.index.body,
    [
      "bill based on the total number of input and output tokens",
      "peak/off-peak pricing policy",
      "prices will be 2x the regular prices",
      "effective date will be subject to the official announcement",
      "expense = number of tokens × price",
      "preference for using the granted balance first",
      "most recent pricing information",
    ],
    "DeepSeek public pricing contract drifted",
  );
  requireClaims(
    companion(bundle, "/quick_start/token_usage", "token usage"),
    [
      "units we use for billing",
      "actual number of tokens processed each time is based on the model's return",
      "usage results",
    ],
    "DeepSeek token-usage contract drifted",
  );
  requireClaims(
    companion(bundle, "/guides/kv_cache", "context cache"),
    [
      "enabled by default for all users",
      "prompt_cache_hit_tokens",
      "prompt_cache_miss_tokens",
      "best-effort",
      "cache construction takes seconds",
      "few hours to a few days",
    ],
    "DeepSeek context-cache contract drifted",
  );
  requireClaims(
    companion(bundle, "/api/get-user-balance", "balance API"),
    [
      "Get user current balance",
      "is_available",
      "total_balance",
      "granted_balance",
      "topped_up_balance",
    ],
    "DeepSeek balance API contract drifted",
  );
  requireClaims(
    companion(bundle, "/quick_start/rate_limit", "rate-limit"),
    [
      "account level, regardless of which API Key is used",
      "There is no additional cost for capacity expansion",
      "KVCache Isolation",
      "Scheduling Isolation",
    ],
    "DeepSeek account-quota contract drifted",
  );
  requireClaims(
    companion(bundle, "/quick_start/error_codes", "error-code"),
    ["402 - Insufficient Balance", "check your account's balance"],
    "DeepSeek insufficient-balance contract drifted",
  );
  requireClaims(
    companion(bundle, "/guides/responses_api", "Responses guide"),
    [
      "server-side web search tool call",
      "service_tier",
      "Not supported",
      "final event",
      "full response object including usage",
    ],
    "DeepSeek Responses accounting contract drifted",
  );
  requireClaims(
    companion(bundle, "/guides/anthropic_api", "Anthropic compatibility"),
    [
      "unsupported model name",
      "automatically map it to the deepseek-v4-flash model",
      "Models starting with claude-opus are mapped to deepseek-v4-pro",
      "claude-haiku or claude-sonnet are mapped to deepseek-v4-flash",
      "cache_control",
      "Ignored",
    ],
    "DeepSeek Anthropic compatibility contract drifted",
  );

  for (const reason_code of [
    "granted_balance_account_entitlement",
    "account_balance_api_out_of_catalog",
    "account_concurrency_out_of_catalog",
    "response_exact_cost_not_returned",
  ])
    input.onPricingReconciliation?.({ disposition: "excluded", reason_code });
  for (const reason_code of [
    "upcoming_peak_policy_not_effective",
    "web_search_fee_not_published",
    "anthropic_model_mapping_not_bound",
  ])
    input.onPricingReconciliation?.({ disposition: "unbound", reason_code });
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

function validateCatalogTable(table: HtmlTable, columns: number[]): void {
  const unhandled = table.rows.map(rowLabel).filter((label) => !catalogRows.has(label));
  if (unhandled.length > 0)
    throw new Error(`DeepSeek catalog has unhandled rows: ${unhandled.join(", ")}`);
  for (const label of catalogRows) row(table, label);
  for (const [label, expected] of baseUrls)
    if (cells(table, label, columns).some((value) => value !== expected))
      throw new Error(`DeepSeek catalog changed ${label} base URL`);
  support(table, "Chat Prefix Completion（Beta）", columns);
  support(table, "FIM Completion（Beta）", columns);
  support(table, "Anthropic API", columns);
  if (
    cells(table, "Concurrency Limit", columns).some(
      (value) => !/^[1-9]\d*$/.test(value.replace(/,/g, "")),
    )
  )
    throw new Error("DeepSeek catalog changed concurrency limits");
}

function model(
  input: Input,
  table: HtmlTable,
  column: number,
  id: string,
  name: string,
  hasChatEndpoint: boolean,
  hasResponsesEndpoint: boolean,
): ProviderModel {
  const context = tokenCount(cells(table, "CONTEXT LENGTH", [column])[0] ?? "");
  const output = tokenCount(cells(table, "MAX OUTPUT", [column])[0] ?? "");
  const [structured] = support(table, "Json Output", [column]);
  const [tools] = support(table, "Tool Calls", [column]);
  if (structured === undefined || tools === undefined)
    throw new Error("DeepSeek feature table schema drift");
  const apiEndpoints = [
    ...(hasChatEndpoint ? [chatEndpoint] : []),
    ...(hasResponsesEndpoint ? [responsesEndpoint] : []),
  ];
  const priceFacts = priceRows.map(([meter, label]) =>
    publishedRate(
      meter,
      price(cells(table, label, [column])[0] ?? ""),
      "million_tokens",
      input.source.id,
      label,
    ),
  );
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
      reasoning: thinking(table, column),
      tool_call: tools,
      structured_output: structured,
      ...(hasChatEndpoint ? { streaming: true, effort_control: true } : {}),
      prompt_cache: true,
    },
    limits: { context_tokens: context, max_output_tokens: output },
    status: "active",
    pricing_state: "numeric",
    price_facts: priceFacts,
  };
}

function bounded(input: Input, models: ProviderModel[]): ProviderModel[] {
  if (input.source.extractor.kind !== "deepseek-catalog")
    throw new Error("Wrong DeepSeek catalog extractor");
  const { minModels, maxModels } = input.source.extractor;
  assertItemCount("DeepSeek model catalog", models.length, minModels, maxModels);
  return models.sort((left, right) => left.model_id.localeCompare(right.model_id));
}

export function parseDeepseekCatalog(input: Input): ProviderModel[] {
  const bundle = linkedBundleSchema.parse(JSON.parse(input.body));
  commercialEvidence(input, bundle);
  const chatDocument = companion(bundle, "/api/create-chat-completion", "Chat Completions");
  const responsesDocument = companion(bundle, "/api/create-response", "Responses");
  const chatIds = chatModelIds(chatDocument);
  const responseIds = responseModelIds(responsesDocument);
  const modelTables = htmlTables(bundle.index.body).filter(
    (item) => item.headers[0] === "MODEL" && item.headers[1] === "MODEL",
  );
  const [table] = modelTables;
  if (modelTables.length !== 1 || table === undefined)
    throw new Error("DeepSeek model table not found or ambiguous");
  const columns = table.headers.slice(2).map((header, index) => {
    const id = catalogId(header);
    if (id === undefined)
      throw new Error(`DeepSeek catalog returned invalid model header: ${header}`);
    return { column: index + 2, id };
  });
  if (columns.length < 1) throw new Error("DeepSeek catalog returned no model IDs");
  if (new Set(columns.map(({ id }) => id)).size !== columns.length)
    throw new Error("DeepSeek catalog returned duplicate model IDs");
  validateCatalogTable(
    table,
    columns.map(({ column }) => column),
  );
  const names = cells(
    table,
    "MODEL VERSION",
    columns.map(({ column }) => column),
  );
  const tableResponseIds = new Set(
    columns.flatMap(({ column, id }) =>
      support(table, "Responses API", [column])[0] === true ? [id] : [],
    ),
  );
  if (
    responseIds.size !== tableResponseIds.size ||
    [...responseIds].some((id) => !tableResponseIds.has(id))
  )
    throw new Error("DeepSeek Responses reference disagrees with the model table");
  const models = columns.map(({ column, id }, index) =>
    model(input, table, column, id, names[index] ?? id, chatIds.has(id), responseIds.has(id)),
  );
  for (const id of chatIds)
    if (!models.some(({ model_id }) => model_id === id))
      throw new Error(`DeepSeek Chat Completions reference named unknown catalog model ${id}`);
  return bounded(input, models);
}

interface Dates {
  release?: string;
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
    if (!parsedDate.success) throw new Error(`DeepSeek update has invalid date: ${label}`);
    const date = parsedDate.data;
    $(heading)
      .nextUntil("h2")
      .filter("p,li")
      .add($(heading).nextUntil("h2").find("p,li"))
      .each((_paragraphIndex, paragraph) => {
        const prose = htmlText($(paragraph).text());
        if (
          !/(?:model parameter|API model names|model upgraded|new model|models? .* upgraded|corresponds? to)/i.test(
            prose,
          )
        )
          return;
        const release =
          !/backward compatibility/i.test(prose) &&
          /(?:\bAPI now supports\b|\bis our new model\b)/i.test(prose);
        $(paragraph)
          .find("code")
          .each((_codeIndex, code) => {
            const id = exactId(htmlText($(code).text()));
            if (id === undefined) return;
            const current = dates.get(id) ?? {};
            const released = release ? earliest(current.release, date) : current.release;
            const updated = { update: latest(current.update, date) };
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
  const list = listSchema.parse(JSON.parse(input.body));
  const ids = list.data.map(({ id }) => id);
  if (new Set(ids).size !== ids.length)
    throw new Error("DeepSeek API returned duplicate model IDs");
  if (input.source.extractor.kind !== "deepseek-api")
    throw new Error("Wrong DeepSeek API extractor");
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
