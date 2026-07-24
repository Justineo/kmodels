import { load } from "cheerio";
import { z } from "zod";
import { linkedBundleSchema } from "./bundle.ts";
import { modelIdSchema } from "./identity.ts";
import type { SourceManifest } from "./manifests.ts";
import { baseModel } from "./model.ts";
import { multiplyDecimal } from "./pricing.ts";
import {
  modalitySchema,
  type Modality,
  type PriceRate,
  type Provider,
  type ProviderModel,
  unknownCapabilities,
} from "./schema.ts";
import { classifyModelOperations, normalizeModelOperations } from "./operation.ts";

interface Input {
  provider: Provider;
  source: SourceManifest;
  body: string;
  observedAt: string;
}

type Document = ReturnType<typeof load>;
type Selection = ReturnType<Document>;

const endpointSchema = z.object({
  name: modelIdSchema,
  task: z.string().optional(),
});
const endpointListSchema = z.object({ endpoints: z.array(z.unknown()).min(1) });

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

function text(value: string): string {
  return value
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function date(value: string): string | undefined {
  const match = value.match(/([A-Z][a-z]+) (\d{1,2}), (\d{4})/);
  const month = match?.[1] === undefined ? undefined : months.get(match[1]);
  return month === undefined || match?.[2] === undefined || match[3] === undefined
    ? undefined
    : `${match[3]}-${month}-${match[2].padStart(2, "0")}`;
}

function count(value: string): number | undefined {
  const match = value.trim().match(/^~?([\d,.]+)\s*(k|m|thousand|million)?$/i);
  if (match?.[1] === undefined) return undefined;
  const scale = /^(?:m|million)$/i.test(match[2] ?? "")
    ? 1_000_000
    : /^(?:k|thousand)$/i.test(match[2] ?? "")
      ? 1_000
      : 1;
  const parsed = Number(match[1].replace(/,/g, "")) * scale;
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

const amount = String.raw`~?[\d,.]+\s*(?:[kKmM]|thousand|million)?`;

function tokenLimit(value: string, patterns: string[]): number | undefined {
  const normalized = value
    .replace(/(\d)-(million|thousand)-token/gi, "$1 $2 token")
    .replace(/(\d)-token/gi, "$1 token");
  for (const pattern of patterns) {
    const raw = normalized.match(new RegExp(pattern, "i"))?.[1];
    if (raw !== undefined) {
      const parsed = count(raw);
      if (parsed !== undefined) return parsed;
    }
  }
  return undefined;
}

function contextLimit(value: string): number | undefined {
  return tokenLimit(value, [
    `(${amount})\\s+(?:total\\s+)?token context window`,
    `context(?: window| length)?(?: of| up to)?\\s+(${amount})\\s+tokens`,
    `handles long contexts up to\\s+(${amount})\\s+tokens`,
    `embedding window of\\s+(${amount})\\s+tokens`,
    `up to (?:a )?(${amount})\\s+token context`,
  ]);
}

function outputLimit(value: string): number | undefined {
  return tokenLimit(value, [
    `(${amount})\\s+maximum output tokens`,
    `up to\\s+(${amount})\\s+output tokens`,
    `(${amount})\\s+output token (?:capabilities|limit)`,
  ]);
}

function modalities(value: string): Modality[] {
  return [
    ...new Set(
      value.split(/\s*,\s*|\s+and\s+/).flatMap((item) => {
        const result = modalitySchema.safeParse(item.toLowerCase());
        return result.success ? [result.data] : [];
      }),
    ),
  ];
}

function description($: Document, section: Selection): string | undefined {
  const paragraphs = section
    .filter("p")
    .map((_index, element) => text($(element).text()))
    .get();
  const supported = paragraphs.findIndex((value) => value.startsWith("Supported inputs:"));
  return paragraphs
    .slice(supported + 1)
    .find(
      (value) =>
        value !== "" &&
        !/^(?:AI models|As with other large language models|This endpoint is hosted)/.test(value),
    );
}

function dimensions(value: string): number[] | undefined {
  const raw = value.match(/([\d,]+)-dimension embedding vector/i)?.[1];
  if (raw === undefined) return undefined;
  const parsed = Number(raw.replace(/,/g, ""));
  return Number.isSafeInteger(parsed) && parsed > 0 ? [parsed] : undefined;
}

function parseModels(input: Input): ProviderModel[] {
  const $ = load(input.body);
  const models: ProviderModel[] = [];
  $("main h2").each((_index, element) => {
    const heading = $(element);
    const section = heading.nextUntil("h2");
    const content = text(section.text());
    const paragraphs = section
      .filter("p")
      .map((_paragraphIndex, paragraph) => text($(paragraph).text()))
      .get();
    const id = paragraphs
      .find((value) => value.startsWith("Endpoint name:"))
      ?.slice("Endpoint name:".length)
      .trim();
    if (id === undefined || !modelIdSchema.safeParse(id).success) return;
    const name = text(heading.text());
    const inputText = paragraphs
      .find((value) => value.startsWith("Supported inputs:"))
      ?.slice("Supported inputs:".length)
      .trim();
    if (name === "" || inputText === undefined)
      throw new Error(`Databricks model section omitted labeled fields for ${id}`);
    const inputModalities = modalities(inputText);
    if (inputModalities.length === 0)
      throw new Error(`Databricks model section omitted modalities for ${id}`);
    const summary = description($, section);
    const outputModalities: Modality[] = /generated images alongside text|image output/i.test(
      content,
    )
      ? ["text", "image"]
      : /embedding/i.test(`${id} ${name} ${content}`)
        ? ["embedding"]
        : ["text"];
    const modelModalities = { input: inputModalities, output: outputModalities };
    const operations = classifyModelOperations({
      modelId: id,
      name,
      rawType: undefined,
      modalities: modelModalities,
      fallback: "text_generation",
    });
    const deprecated = /\bis deprecated\b|\bwill be retired\b|\bplanned for retirement\b/i.test(
      content,
    );
    const preview = /\bPublic Preview\b|\bis in Preview\b/i.test(content);
    const contextTokens = contextLimit(content);
    const maxOutputTokens = outputLimit(content);
    const embeddingDimensions = dimensions(content);
    models.push({
      ...baseModel({
        providerId: input.provider.id,
        id,
        name,
        sourceId: input.source.id,
        observedAt: input.observedAt,
      }),
      description: summary,
      operations,
      modalities: modelModalities,
      capabilities: {
        ...unknownCapabilities(),
        reasoning:
          /reasoning model|reasoning capabilities|hybrid reasoning|reasoning-only|optimized for (?:long-horizon )?reasoning/i.test(
            content,
          )
            ? true
            : "unknown",
        tool_call: /doesn't support function calling/i.test(content)
          ? false
          : /function calling|complex tool use|tool-use|tool use/i.test(content)
            ? true
            : "unknown",
        structured_output: /structured output/i.test(content) ? true : "unknown",
        prompt_cache: /prompt caching|cached tensors/i.test(content) ? true : "unknown",
        effort_control: /reasoning effort|effort level/i.test(content) ? true : "unknown",
      },
      limits: {
        ...(contextTokens === undefined ? {} : { context_tokens: contextTokens }),
        ...(maxOutputTokens === undefined ? {} : { max_output_tokens: maxOutputTokens }),
        ...(embeddingDimensions === undefined ? {} : { embedding_dimensions: embeddingDimensions }),
      },
      status: deprecated ? "deprecated" : "active",
      release_stage: preview ? "preview" : "unknown",
      scope: "regional_catalog",
    });
  });
  const extractor = input.source.extractor;
  if (extractor.kind !== "databricks-catalog") throw new Error("Wrong Databricks extractor");
  if (models.length < extractor.minModels || models.length > extractor.maxModels)
    throw new Error("Databricks model section count outside reviewed bounds");
  return models.sort((left, right) => left.uid.localeCompare(right.uid));
}

function document(bundle: z.infer<typeof linkedBundleSchema>, path: string): string {
  const result = bundle.documents.find((item) => new URL(item.url).pathname === path);
  if (result === undefined) throw new Error(`Databricks bundle omitted ${path}`);
  return result.body;
}

function endpointIds($: Document, selection: Selection): string[] {
  return [
    ...new Set(
      selection
        .find("code")
        .map((_index, element) => text($(element).text()))
        .get()
        .filter((value) => /^databricks-[a-z0-9._-]+$/i.test(value)),
    ),
  ];
}

function applyApiSupport(models: ProviderModel[], tasksBody: string, referenceBody: string): void {
  const reference = load(referenceBody);
  const headings = new Set(
    reference("main h2")
      .map((_index, element) => text(reference(element).text()))
      .get(),
  );
  const referenceText = text(reference("main").text());
  if (
    !headings.has("Chat Completions API") ||
    !headings.has("Embeddings API") ||
    !/Chat and completion endpoints support streaming responses\./i.test(referenceText)
  )
    throw new Error("Databricks API reference changed");

  const $ = load(tasksBody);
  if (
    !$("main a")
      .map((_index, element) => text($(element).text()))
      .get()
      .includes("POST /serving-endpoints/{name}/invocations")
  )
    throw new Error("Databricks invocation route changed");

  const tasks = new Map<string, string[]>();
  $("main table").each((_tableIndex, table) => {
    const headers = $(table)
      .find("thead th")
      .map((_index, element) => text($(element).text()))
      .get();
    if (
      headers.join("|") !==
      "Task type|Description|Supported models|When to use? Recommended use cases"
    )
      return;
    $(table)
      .find("tbody tr")
      .each((_rowIndex, row) => {
        const cells = $(row).children("td");
        const task = text(cells.eq(0).text());
        if (task !== "General purpose" && task !== "Embeddings") return;
        const ids = endpointIds($, cells.eq(2)).sort();
        const previous = tasks.get(task);
        if (ids.length === 0 || (previous !== undefined && previous.join() !== ids.join()))
          throw new Error(`Databricks ${task} task matrix changed`);
        tasks.set(task, ids);
      });
  });
  const general = tasks.get("General purpose");
  const embeddings = tasks.get("Embeddings");
  if (general === undefined || embeddings === undefined)
    throw new Error("Databricks task matrix changed");

  const catalog = new Set(models.map((model) => model.model_id));
  const assigned = new Set([...general, ...embeddings]);
  for (const id of assigned)
    if (!catalog.has(id))
      throw new Error(`Databricks task matrix named unknown catalog model ${id}`);
  const omitted = models.filter((model) => !assigned.has(model.model_id));
  if (omitted.length > 0)
    throw new Error(
      `Databricks task matrix omitted catalog models: ${omitted
        .map((model) => model.model_id)
        .join(", ")}`,
    );

  const generalIds = new Set(general);
  const embeddingIds = new Set(embeddings);
  for (const model of models) {
    const taskOperations: ProviderModel["operations"] = [];
    if (generalIds.has(model.model_id)) taskOperations.push("text_generation");
    if (embeddingIds.has(model.model_id)) taskOperations.push("embeddings");
    model.operations = normalizeModelOperations({
      ...model,
      operations: [...taskOperations, ...model.operations],
    }).operations;
    model.capabilities.streaming = taskOperations.includes("text_generation") ? true : "unknown";
    model.api_endpoints = [
      {
        name: "Invocations",
        path: `/serving-endpoints/${model.model_id}/invocations`,
      },
    ];
  }
}

function applyBatch(models: ProviderModel[], body: string): void {
  const $ = load(body);
  const payPerToken = new Set<string>();
  const batch = new Set<string>();
  $("main table").each((_tableIndex, table) => {
    const headers = $(table)
      .find("thead th")
      .map((_index, cell) => text($(cell).text()))
      .get();
    const pay = headers.findIndex((value) => value.includes("pay-per-token"));
    const aiFunctions = headers.findIndex((value) => value.includes("AI Functions"));
    if (headers[0] !== "Region" || pay < 0 || aiFunctions < 0) return;
    $(table)
      .find("tbody tr")
      .each((_rowIndex, row) => {
        const cells = $(row).children("td");
        const payCell = cells.eq(pay);
        const batchCell = cells.eq(aiFunctions);
        for (const id of endpointIds($, payCell)) payPerToken.add(id);
        for (const id of endpointIds($, batchCell)) batch.add(id);
      });
  });
  if (payPerToken.size < Math.min(30, models.length - 1))
    throw new Error("Databricks overview omitted regional model IDs");
  for (const model of models)
    model.capabilities.batch = batch.has(model.model_id)
      ? true
      : payPerToken.has(model.model_id)
        ? false
        : "unknown";
}

const ignoredIdentityTokens = new Set([
  "ai",
  "alibaba",
  "anthropic",
  "beta",
  "cloud",
  "en",
  "google",
  "instruct",
  "labs",
  "machine",
  "meta",
  "openai",
  "preview",
  "public",
  "thinking",
  "zhipu",
]);

function identity(value: string): string[] {
  return (value.toLowerCase().match(/[a-z]+|\d+(?:\.\d+)*/g) ?? [])
    .map((token) => (/^\d+(?:\.\d+)*$/.test(token) ? token.replace(/(?:\.0)+$/, "") : token))
    .filter((token) => !ignoredIdentityTokens.has(token));
}

function alternatives(value: string): string[] {
  const parts = value.replace(/\*/g, "").split(/\s*\/\s*/);
  if (parts.length < 2) return [value.replace(/\*/g, "")];
  const first = parts[0]?.match(/^(.*?)(\d+(?:\.\d+)*)\s*$/);
  const last = parts.at(-1)?.match(/^(\d+(?:\.\d+)*)(.*)$/);
  if (first?.[1] === undefined || last?.[2] === undefined) return [value.replace(/\*/g, "")];
  const versions = parts.map((part) => part.match(/\d+(?:\.\d+)*/)?.[0]);
  if (versions.some((version) => version === undefined)) return [value.replace(/\*/g, "")];
  return versions.flatMap((version) =>
    version === undefined ? [] : [`${first[1]}${version}${last[2]}`],
  );
}

function matches(models: ProviderModel[], label: string, loose: boolean): ProviderModel[] {
  const expected = identity(label);
  if (expected.length === 0) return [];
  const candidates = models.filter((model) => {
    const actual = identity(model.name);
    return (
      expected.every((token) => actual.includes(token)) &&
      (loose || actual.every((token) => expected.includes(token)))
    );
  });
  return candidates.length === 1 ? candidates : [];
}

function matched(models: ProviderModel[], label: string, loose: boolean): ProviderModel[] {
  const variants = alternatives(label);
  const exact = [
    ...new Map(
      variants.flatMap((value) => matches(models, value, false)).map((model) => [model.uid, model]),
    ).values(),
  ];
  if (!loose || exact.length > 0) return exact;
  return [
    ...new Map(
      variants.flatMap((value) => matches(models, value, true)).map((model) => [model.uid, model]),
    ).values(),
  ];
}

interface Span {
  value: string;
  remaining: number;
}

function rows($: Document, table: Selection): string[][] {
  const spans: (Span | undefined)[] = [];
  const result: string[][] = [];
  table.find("tbody tr").each((_rowIndex, rowElement) => {
    const row: string[] = [];
    for (const [column, span] of spans.entries()) {
      if (span === undefined) continue;
      row[column] = span.value;
      span.remaining -= 1;
      if (span.remaining === 0) spans[column] = undefined;
    }
    let column = 0;
    $(rowElement)
      .children("th,td")
      .each((_cellIndex, cellElement) => {
        while (row[column] !== undefined) column += 1;
        const cell = $(cellElement);
        const value = text(cell.text());
        const colspan = Number(cell.attr("colspan") ?? "1");
        const rowspan = Number(cell.attr("rowspan") ?? "1");
        for (let offset = 0; offset < colspan; offset += 1) {
          row[column + offset] = value;
          if (rowspan > 1) spans[column + offset] = { value, remaining: rowspan - 1 };
        }
        column += colspan;
      });
    result.push(row);
  });
  return result;
}

function decimal(value: string): string | undefined {
  const normalized = value.replace(/,/g, "").trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalized)) return undefined;
  const [whole = "0", fraction = ""] = normalized.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed === "" ? whole : `${whole}.${trimmed}`;
}

function rate(
  meter: PriceRate["meter"],
  rawPrice: string,
  unit: PriceRate["unit"],
  sourceId: string,
  rawUnit: string,
  conditions: PriceRate["conditions"],
): PriceRate | undefined {
  const price = decimal(rawPrice);
  return price === undefined
    ? undefined
    : {
        meter,
        price,
        currency: "DBU",
        unit,
        conditions,
        source_ref: sourceId,
        derived: false,
        raw_price: rawPrice,
        raw_unit: rawUnit,
      };
}

function add(rates: Map<string, Map<string, PriceRate>>, id: string, value: PriceRate): void {
  const modelRates = rates.get(id) ?? new Map<string, PriceRate>();
  modelRates.set(
    `${value.meter}:${value.currency}:${value.unit}:${JSON.stringify(value.conditions)}`,
    value,
  );
  rates.set(id, modelRates);
}

function openPrices(
  models: ProviderModel[],
  body: string,
  sourceId: string,
  rates: Map<string, Map<string, PriceRate>>,
): void {
  const $ = load(body);
  const table = $("main table").first();
  if (table.length === 0) throw new Error("Databricks open-model pricing table is missing");
  const headers = table
    .find("thead th")
    .map((_index, element) => text($(element).text()))
    .get();
  if (
    headers.map((value) => value.replace(/\s/g, "")).join("|") !==
    "Model|Pay-Per-Token|ProvisionedThroughput|DBU/Minputtokens|DBU/Moutputtokens|DBU/Mcachereadtokens|DBU/hour(entrycapacity)|DBU/hour(scalingcapacity)"
  )
    throw new Error("Databricks open-model pricing table changed shape");
  for (const values of rows($, table)) {
    const label = values[0];
    if (label === undefined) continue;
    for (const model of matched(models, label, true)) {
      const embedding = model.operations.includes("embeddings");
      const input = rate(
        embedding ? "embedding" : "input_text",
        values[1] ?? "",
        "million_tokens",
        sourceId,
        "DBU / M input tokens",
        { service_tier: "pay_per_token" },
      );
      const output = rate(
        "output_text",
        values[2] ?? "",
        "million_tokens",
        sourceId,
        "DBU / M output tokens",
        { service_tier: "pay_per_token" },
      );
      const cacheRead = rate(
        "cache_read_text",
        values[3] ?? "",
        "million_tokens",
        sourceId,
        "DBU / M cache read tokens",
        { service_tier: "pay_per_token" },
      );
      const entry = rate(
        "provisioned_throughput",
        values[4] ?? "",
        "unit_hour",
        sourceId,
        "DBU / hour (entry capacity)",
        { capacity: "entry" },
      );
      const scaling = rate(
        "provisioned_throughput",
        values[5] ?? "",
        "unit_hour",
        sourceId,
        "DBU / hour (scaling capacity)",
        { capacity: "scaling" },
      );
      for (const value of [input, output, cacheRead, entry, scaling])
        if (value !== undefined) add(rates, model.model_id, value);
    }
  }
}

function endpoint(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/\s*\/\s*/g, " or ")
      .match(/[a-z0-9]+/g)
      ?.join("_") ?? "unknown"
  );
}

function contextConditions(value: string, hasLongTier: boolean): PriceRate["conditions"] {
  const normalized = value.toLowerCase();
  const contextTier = normalized.startsWith("short")
    ? "short"
    : normalized.startsWith("long")
      ? "long"
      : "all";
  return {
    context_tier: contextTier,
    ...(normalized.includes(">200k")
      ? { context_min_tokens: 200_001 }
      : contextTier === "short" && hasLongTier
        ? { context_max_tokens: 200_000 }
        : {}),
  };
}

function promotional(value: PriceRate, factor: string, until: string, reason: string): PriceRate {
  const conditions = { ...value.conditions };
  delete conditions.effective_from;
  return {
    ...value,
    price: multiplyDecimal(value.price, factor),
    conditions: {
      ...conditions,
      effective_until: until,
      promotion: true,
    },
    derived: true,
    derivation: reason,
  };
}

function partnerPrices(
  models: ProviderModel[],
  body: string,
  sourceId: string,
  rates: Map<string, Map<string, PriceRate>>,
): void {
  const $ = load(body);
  const tables = $("main table");
  if (tables.length !== 3) throw new Error("Databricks partner pricing tables changed shape");
  const providers = new Set<string>();
  tables.each((_tableIndex, tableElement) => {
    const tableRows = rows($, $(tableElement));
    const provider = tableRows[0]?.[0];
    if (provider !== "OpenAI" && provider !== "Anthropic" && provider !== "Google")
      throw new Error("Databricks partner pricing group changed");
    providers.add(provider);
    const values = tableRows.filter((row) => row.length === 8 && new Set(row).size > 1);
    const long = new Set(
      values.filter((row) => row[2]?.includes(">200k")).map((row) => row[0] ?? ""),
    );
    for (const row of values) {
      const label = row[0];
      if (label === undefined) continue;
      for (const model of matched(models, label, true)) {
        const common = {
          endpoint: endpoint(row[1] ?? ""),
          service_tier: "pay_per_token",
          ...contextConditions(row[2] ?? "", long.has(label)),
        };
        const valuesToAdd = [
          rate("input_text", row[3] ?? "", "million_tokens", sourceId, "DBU / 1M Tokens", common),
          rate("output_text", row[4] ?? "", "million_tokens", sourceId, "DBU / 1M Tokens", common),
          rate(
            "cache_write_text",
            row[5] ?? "",
            "million_tokens",
            sourceId,
            "DBU / 1M Tokens",
            common,
          ),
          rate(
            "cache_read_text",
            row[6] ?? "",
            "million_tokens",
            sourceId,
            "DBU / 1M Tokens",
            common,
          ),
          rate("batch_inference", row[7] ?? "", "unit_hour", sourceId, "DBU / hour", {
            ...common,
            service_tier: "batch",
          }),
        ].flatMap((value) => (value === undefined ? [] : [value]));
        for (const value of valuesToAdd) {
          if (provider === "Google") {
            add(rates, model.model_id, {
              ...value,
              conditions: { ...value.conditions, effective_from: "2026-08-01" },
            });
            add(
              rates,
              model.model_id,
              promotional(value, "0.8", "2026-07-31", `${value.meter} = published DBU rate * 0.8`),
            );
          } else if (model.model_id === "databricks-claude-sonnet-5") {
            add(rates, model.model_id, {
              ...value,
              conditions: {
                ...value.conditions,
                effective_until: "2026-08-31",
                promotion: true,
              },
            });
          } else add(rates, model.model_id, value);
        }
      }
    }
  });
  if (providers.size !== tables.length)
    throw new Error("Databricks partner pricing groups changed");

  const standard = rates.get("databricks-claude-sonnet-4-6");
  if (standard !== undefined)
    for (const value of standard.values())
      add(rates, "databricks-claude-sonnet-5", {
        ...value,
        conditions: { ...value.conditions, effective_from: "2026-09-01" },
        derived: true,
        derivation: "Claude Sonnet 5 standard rate = Claude Sonnet 4.5 / 4.6 rate",
      });
}

function applyLifecycle(models: ProviderModel[], body: string, observedAt: string): void {
  const $ = load(body);
  const seen = new Set<string>();
  $("main table").each((_tableIndex, table) => {
    const headers = $(table)
      .find("thead th")
      .map((_index, element) => text($(element).text()))
      .get();
    if (headers[0] !== "Partner model" && headers[0] !== "Open model") return;
    $(table)
      .find("tbody tr")
      .each((_rowIndex, row) => {
        const values = $(row)
          .children("td")
          .map((_index, cell) => text($(cell).text()))
          .get();
        const label = values[0];
        const retirement = values[1];
        if (label === undefined || retirement === undefined) return;
        const key = `${label}:${retirement}`;
        if (seen.has(key)) return;
        seen.add(key);
        const payPerToken = retirement.match(/Pay-per-token:\s*([A-Z][a-z]+ \d{1,2}, \d{4})/)?.[1];
        const retiredAt = date(payPerToken ?? retirement);
        if (retiredAt === undefined) return;
        const replacements = (values[2] ?? "")
          .replace(/\. To allow.*$/i, "")
          .split(/\s+or\s+/i)
          .flatMap((value) => matched(models, value, false).map((model) => model.model_id));
        for (const model of matched(models, label, false)) {
          model.retired_at = retiredAt;
          model.status = retiredAt <= observedAt.slice(0, 10) ? "retired" : "deprecated";
          model.replacement_model_ids = [...new Set(replacements)].sort();
        }
      });
  });
}

function applyOutputLimits(models: ProviderModel[], body: string): void {
  const $ = load(body);
  $("main table").each((_tableIndex, table) => {
    const headers = $(table)
      .find("thead th")
      .map((_index, element) => text($(element).text()))
      .get();
    if (headers.join("|") !== "Model|Output token limit") return;
    $(table)
      .find("tbody tr")
      .each((_rowIndex, row) => {
        const values = $(row)
          .children("td")
          .map((_index, cell) => text($(cell).text()))
          .get();
        const limit = values[1] === undefined ? undefined : count(values[1]);
        if (values[0] === undefined || limit === undefined) return;
        for (const model of matched(models, values[0], false))
          if (model.limits.max_output_tokens === undefined) model.limits.max_output_tokens = limit;
      });
  });
}

function applyReleases(models: ProviderModel[], body: string): void {
  const $ = load(body, { xmlMode: true });
  let observed = 0;
  $("item").each((_itemIndex, item) => {
    const published = new Date($(item).find("pubDate").text());
    if (Number.isNaN(published.valueOf())) return;
    const released = published.toISOString().slice(0, 10);
    const description = load($(item).find("description").text());
    const summary = text(description.root().text());
    if (!/Model Serving now supports (?!function calling|structured output)/i.test(summary)) return;
    description("a[href]").each((_linkIndex, link) => {
      const href = description(link).attr("href");
      if (!href?.includes("/machine-learning/foundation-model-apis/supported-models#")) return;
      const label = text(description(link).text());
      for (const model of matched(models, label, false)) {
        if (model.release_date === undefined || released < model.release_date)
          model.release_date = released;
        observed += 1;
      }
    });
  });
  if (observed === 0) throw new Error("Databricks release feed contained no matching models");
}

export function parseDatabricksCatalog(input: Input): ProviderModel[] {
  const bundle = linkedBundleSchema.parse(JSON.parse(input.body));
  const apiReference = document(
    bundle,
    "/aws/en/machine-learning/foundation-model-apis/api-reference",
  );
  const models = parseModels({ ...input, body: bundle.index.body });
  applyApiSupport(
    models,
    document(bundle, "/aws/en/machine-learning/model-serving/score-foundation-models"),
    apiReference,
  );
  applyBatch(
    models,
    document(bundle, "/aws/en/machine-learning/model-serving/foundation-model-overview"),
  );
  applyLifecycle(
    models,
    document(bundle, "/aws/en/machine-learning/retired-models-policy"),
    input.observedAt,
  );
  applyOutputLimits(
    models,
    document(bundle, "/aws/en/machine-learning/foundation-model-apis/limits"),
  );
  applyReleases(models, document(bundle, "/aws/en/feed.xml"));
  const rates = new Map<string, Map<string, PriceRate>>();
  openPrices(
    models,
    document(bundle, "/product/pricing/foundation-model-serving"),
    input.source.id,
    rates,
  );
  partnerPrices(
    models,
    document(bundle, "/product/pricing/proprietary-foundation-model-serving"),
    input.source.id,
    rates,
  );
  return models.map((model) => {
    const pricing = [...(rates.get(model.model_id)?.values() ?? [])].sort((left, right) =>
      `${left.meter}:${JSON.stringify(left.conditions)}`.localeCompare(
        `${right.meter}:${JSON.stringify(right.conditions)}`,
      ),
    );
    return {
      ...model,
      capabilities: {
        ...model.capabilities,
        prompt_cache: pricing.some((value) => value.meter.startsWith("cache_"))
          ? true
          : model.capabilities.prompt_cache,
      },
      pricing_status: pricing.length > 0 ? "published" : "unknown",
      pricing,
    };
  });
}

function apiTask(value: string | undefined): {
  operation?: ProviderModel["operations"][number];
  modalities: ProviderModel["modalities"];
} {
  if (value?.toLowerCase().includes("embedding"))
    return { operation: "embeddings", modalities: { input: ["text"], output: ["embedding"] } };
  if (/\b(?:chat|completions?|responses?)\b/i.test(value ?? ""))
    return { operation: "text_generation", modalities: { input: ["text"], output: ["text"] } };
  return { modalities: { input: [], output: [] } };
}

export function parseDatabricksApi(input: Input): ProviderModel[] {
  const list = endpointListSchema.parse(JSON.parse(input.body));
  const results = list.endpoints.map((item) => endpointSchema.safeParse(item));
  if (results.some((result) => !result.success)) throw new Error("Databricks API schema drift");
  return results.flatMap((result) => {
    if (!result.success) return [];
    const task = apiTask(result.data.task);
    return [
      {
        ...baseModel({
          providerId: input.provider.id,
          id: result.data.name,
          name: result.data.name,
          sourceId: input.source.id,
          observedAt: input.observedAt,
        }),
        operations: task.operation === undefined ? [] : [task.operation],
        modalities: task.modalities,
        scope: "runtime_observation",
      },
    ];
  });
}
