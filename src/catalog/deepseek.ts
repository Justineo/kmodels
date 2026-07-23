import { load } from "cheerio";
import { z } from "zod";
import { linkedBundleSchema } from "./bundle.ts";
import { htmlTables, htmlText, type HtmlTable } from "./html.ts";
import { modelIdSchema } from "./identity.ts";
import type { SourceManifest } from "./manifests.ts";
import { baseModel } from "./model.ts";
import { publishedRate } from "./pricing.ts";
import { type Provider, type ProviderModel, unknownCapabilities } from "./schema.ts";

interface Input {
  provider: Provider;
  source: SourceManifest;
  body: string;
  observedAt: string;
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

function exactId(value: string): string | undefined {
  const parsed = modelIdSchema.safeParse(value.trim());
  return parsed.success ? parsed.data : undefined;
}

function catalogId(value: string): string | undefined {
  return exactId(value.replace(/\(\d+\)$/, ""));
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

function row(table: HtmlTable, label: string): string[] {
  const match = table.rows.find((item) => item[1]?.text === label || item[0]?.text === label);
  if (match === undefined) throw new Error(`DeepSeek catalog omitted ${label}`);
  return match.map((cell) => cell.text);
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

function chatModelIds(body: string): Set<string> {
  const $ = load(body);
  const article = $("article");
  const operation = article.find("pre.openapi__method-endpoint").first();
  if (
    htmlText(article.find("h1.openapi__heading").first().text()) !== "Create Chat Completion" ||
    htmlText(operation.find(".badge").first().text()) !== "POST" ||
    htmlText(operation.find("h2.openapi__method-endpoint-path").first().text()) !==
      chatEndpoint.path
  )
    throw new Error("DeepSeek Chat Completions reference changed operation");
  const schemaItems = article.find(".openapi-schema__list-item").toArray();
  const propertyValues = (name: string): string[] | undefined => {
    const values = schemaItems
      .filter(
        (element) =>
          htmlText($(element).find("strong.openapi-schema__property").first().text()) === name,
      )
      .map((element) =>
        $(element)
          .find("code")
          .map((_index, code) => htmlText($(code).text()))
          .get(),
      )
      .filter((items) => items.length > 0);
    return values.length === 1 ? values[0] : undefined;
  };
  const modelValues = propertyValues("model");
  if (modelValues === undefined)
    throw new Error("DeepSeek Chat Completions reference changed model schema");
  const ids = z.array(modelIdSchema).min(1).safeParse(modelValues);
  if (!ids.success || new Set(ids.data).size !== ids.data.length)
    throw new Error("DeepSeek Chat Completions reference returned invalid model IDs");
  const thinkingValues = propertyValues("thinking");
  const effortValues = propertyValues("reasoning_effort");
  if (
    thinkingValues === undefined ||
    !["enabled", "disabled"].every((value) => thinkingValues.includes(value)) ||
    effortValues === undefined ||
    !["high", "max"].every((value) => effortValues.includes(value))
  )
    throw new Error("DeepSeek Chat Completions reference changed reasoning controls");
  const streaming = schemaItems.filter(
    (element) =>
      htmlText($(element).find("strong.openapi-schema__property").first().text()) === "stream" &&
      /partial message deltas will be sent/.test(htmlText($(element).text())),
  );
  if (streaming.length !== 1)
    throw new Error("DeepSeek Chat Completions reference changed streaming schema");
  return new Set(ids.data);
}

function retirement(body: string): {
  aliases: [string, string];
  replacement: string;
  at: string;
} {
  const $ = load(body);
  const paragraph = $("article p")
    .toArray()
    .find((element) =>
      /will be deprecated on .*For compatibility/i.test(htmlText($(element).text())),
    );
  if (paragraph === undefined) throw new Error("DeepSeek catalog omitted legacy lifecycle");
  const ids = $(paragraph)
    .find("code")
    .map((_index, element) => exactId(htmlText($(element).text())))
    .get()
    .filter((value) => value !== undefined);
  const date = htmlText($(paragraph).text()).match(/(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}) UTC/);
  if (ids.length !== 3 || date === null) throw new Error("DeepSeek legacy lifecycle schema drift");
  const [first, second, replacement] = ids;
  if (first === undefined || second === undefined || replacement === undefined)
    throw new Error("DeepSeek legacy lifecycle schema drift");
  return {
    aliases: [first, second],
    replacement,
    at: `${date[1]}-${date[2]}-${date[3]}T${date[4]}:${date[5]}:00Z`,
  };
}

function model(
  input: Input,
  table: HtmlTable,
  column: number,
  id: string,
  name: string,
  hasChatEndpoint: boolean,
): ProviderModel {
  const context = tokenCount(cells(table, "CONTEXT LENGTH", [column])[0] ?? "");
  const output = tokenCount(cells(table, "MAX OUTPUT", [column])[0] ?? "");
  const [structured] = support(table, "Json Output", [column]);
  const [tools] = support(table, "Tool Calls", [column]);
  if (structured === undefined || tools === undefined)
    throw new Error("DeepSeek feature table schema drift");
  const prices = [
    ["cache_read_text", "1M INPUT TOKENS (CACHE HIT)"],
    ["input_text", "1M INPUT TOKENS (CACHE MISS)"],
    ["output_text", "1M OUTPUT TOKENS"],
  ] as const;
  return {
    ...baseModel({
      providerId: input.provider.id,
      id,
      name,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    }),
    types: ["generate"],
    ...(hasChatEndpoint ? { api_endpoints: [chatEndpoint] } : {}),
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
    is_deprecated: false,
    pricing_status: "published",
    pricing: prices.map(([meter, label]) =>
      publishedRate(
        meter,
        price(cells(table, label, [column])[0] ?? ""),
        "million_tokens",
        input.source.id,
        label,
      ),
    ),
  };
}

function bounded(input: Input, models: ProviderModel[]): ProviderModel[] {
  if (input.source.extractor.kind !== "deepseek-catalog")
    throw new Error("Wrong DeepSeek catalog extractor");
  const { minModels, maxModels } = input.source.extractor;
  if (models.length < minModels || models.length > maxModels)
    throw new Error(`DeepSeek model count ${models.length} outside ${minModels}-${maxModels}`);
  return models.sort((left, right) => left.model_id.localeCompare(right.model_id));
}

export function parseDeepseekCatalog(input: Input): ProviderModel[] {
  const bundle = linkedBundleSchema.parse(JSON.parse(input.body));
  const chatDocuments = bundle.documents.filter(
    ({ url }) => new URL(url).pathname === "/api/create-chat-completion",
  );
  const [chatDocument] = chatDocuments;
  if (chatDocuments.length !== 1 || chatDocument === undefined)
    throw new Error("DeepSeek catalog omitted the Chat Completions reference");
  const chatIds = chatModelIds(chatDocument.body);
  const table = htmlTables(bundle.index.body).find(
    (item) => item.headers[0] === "MODEL" && item.headers.slice(2).some(catalogId),
  );
  if (table === undefined) throw new Error("DeepSeek model table not found");
  const columns = table.headers.flatMap((header, column) => {
    if (column < 2) return [];
    const id = catalogId(header);
    return id === undefined ? [] : [{ column, id }];
  });
  if (columns.length < 1) throw new Error("DeepSeek catalog returned no model IDs");
  const names = cells(
    table,
    "MODEL VERSION",
    columns.map(({ column }) => column),
  );
  const models = columns.map(({ column, id }, index) =>
    model(input, table, column, id, names[index] ?? id, chatIds.has(id)),
  );
  for (const id of chatIds)
    if (!models.some(({ model_id }) => model_id === id))
      throw new Error(`DeepSeek Chat Completions reference named unknown catalog model ${id}`);
  const lifecycle = retirement(bundle.index.body);
  const replacement = models.find(({ model_id }) => model_id === lifecycle.replacement);
  if (replacement === undefined)
    throw new Error("DeepSeek replacement model is not in the catalog");
  const retired = input.observedAt >= lifecycle.at;
  for (const [index, id] of lifecycle.aliases.entries()) {
    models.push({
      ...replacement,
      model_id: id,
      uid: `${input.provider.id}/${id}`,
      name: id,
      aliases: [],
      capabilities: {
        ...replacement.capabilities,
        reasoning: index === 1,
        effort_control: "unknown",
      },
      deprecated_at: lifecycle.at,
      retired_at: lifecycle.at,
      status: retired ? "retired" : "active",
      is_deprecated: retired,
      replacement_model_ids: [lifecycle.replacement],
    });
  }
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
    const date = htmlText($(heading).text()).match(/^Date: (\d{4}-\d{2}-\d{2})$/)?.[1];
    if (date === undefined) return;
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
        const release = /(?:now supports|new model)/i.test(prose);
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
      types: ["generate"],
      ...(observed.release === undefined ? {} : { release_date: observed.release }),
      ...(observed.update === undefined || observed.update === observed.release
        ? {}
        : { updated_date: observed.update }),
    }),
  );
  const { minModels, maxModels } = input.source.extractor;
  if (models.length < minModels || models.length > maxModels)
    throw new Error(`DeepSeek update count ${models.length} outside ${minModels}-${maxModels}`);
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
  if (ids.length < minModels || ids.length > maxModels)
    throw new Error(`DeepSeek API model count ${ids.length} outside ${minModels}-${maxModels}`);
  return ids.map((id) => ({
    ...baseModel({
      providerId: input.provider.id,
      id,
      name: id,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    }),
    types: ["generate"],
  }));
}
