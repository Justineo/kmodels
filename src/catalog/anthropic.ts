import { z } from "zod";
import { linkedBundleSchema } from "./bundle.ts";
import { modelIdSchema } from "./identity.ts";
import type { SourceManifest } from "./manifests.ts";
import { apiEndpointKey, baseModel } from "./model.ts";
import { multiplyDecimal, publishedRate } from "./pricing.ts";
import {
  type Modality,
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

interface MarkdownTable {
  headers: string[];
  rows: string[][];
  line: number;
}

const supportSchema = z.object({ supported: z.boolean() });
const itemSchema = z.object({
  id: modelIdSchema,
  type: z.literal("model"),
  display_name: z.string().min(1),
  created_at: z.iso.datetime({ offset: true }),
  max_input_tokens: z.number().int().nonnegative(),
  max_tokens: z.number().int().nonnegative(),
  capabilities: z.object({
    batch: supportSchema,
    citations: supportSchema,
    code_execution: supportSchema,
    context_management: supportSchema,
    effort: supportSchema,
    image_input: supportSchema,
    pdf_input: supportSchema,
    structured_outputs: supportSchema,
    thinking: supportSchema,
  }),
});
const listSchema = z.object({
  data: z.array(z.unknown()),
  first_id: z.string().nullable(),
  last_id: z.string().nullable(),
  has_more: z.boolean(),
});
const fivePricesSchema = z.tuple([z.string(), z.string(), z.string(), z.string(), z.string()]);
const endpointDocuments = [
  {
    suffix: "/api/messages/create.md",
    endpoint: { name: "Create a Message", path: "v1/messages" },
  },
  {
    suffix: "/api/completions/create.md",
    endpoint: { name: "Create a Text Completion", path: "v1/complete" },
  },
  {
    suffix: "/api/messages/batches/create.md",
    endpoint: { name: "Create a Message Batch", path: "v1/messages/batches" },
  },
] as const;

function json(body: string): unknown {
  return JSON.parse(body);
}

function text(value: string): string {
  return value
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[*_`\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(text);
}

function tables(body: string): MarkdownTable[] {
  const lines = body.split(/\r?\n/);
  const result: MarkdownTable[] = [];
  for (let line = 0; line + 1 < lines.length; line += 1) {
    const header = lines[line];
    const separator = lines[line + 1];
    if (header === undefined || separator === undefined || !header.trim().startsWith("|")) continue;
    const headers = cells(header);
    const separators = cells(separator);
    if (
      headers.length !== separators.length ||
      !separators.every((cell) => /^:?-{3,}:?$/.test(cell))
    )
      continue;
    const rows: string[][] = [];
    let cursor = line + 2;
    while (lines[cursor]?.trim().startsWith("|")) {
      const values = cells(lines[cursor] ?? "");
      if (values.length === headers.length) rows.push(values);
      cursor += 1;
    }
    result.push({ headers, rows, line });
    line = cursor - 1;
  }
  return result;
}

function row(table: MarkdownTable, label: string): string[] | undefined {
  return table.rows.find((values) => values[0] === label);
}

function tokenCount(value: string | undefined): number | undefined {
  const match = value?.match(/([\d.]+)\s*([kKmM])?\s*tokens?/);
  if (match?.[1] === undefined) return undefined;
  const scale = match[2]?.toLowerCase() === "m" ? 1_000_000 : match[2] ? 1_000 : 1;
  const result = Number(match[1]) * scale;
  return Number.isInteger(result) ? result : undefined;
}

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

function date(value: string): string | undefined {
  const match = value.match(/^([A-Z][a-z]+) (\d{1,2}), (\d{4})$/);
  const month = match?.[1] === undefined ? undefined : months.get(match[1]);
  return month === undefined || match?.[2] === undefined || match[3] === undefined
    ? undefined
    : `${match[3]}-${month}-${match[2].padStart(2, "0")}`;
}

function model(models: Map<string, ProviderModel>, input: Input, id: string): ProviderModel {
  const current = models.get(id);
  if (current !== undefined) return current;
  const created = {
    ...baseModel({
      providerId: input.provider.id,
      id: modelIdSchema.parse(id),
      name: id,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    }),
    types: ["generate"],
  } satisfies ProviderModel;
  models.set(id, created);
  return created;
}

function overview(body: string, input: Input, models: Map<string, ProviderModel>): void {
  const featureTables = tables(body).filter((table) => table.headers[0] === "Feature");
  if (featureTables.length < 2) throw new Error("Anthropic overview omitted model tables");
  for (const table of featureTables) {
    const ids = row(table, "Claude API ID");
    if (ids === undefined) continue;
    const aliases = row(table, "Claude API alias");
    const descriptions = row(table, "Description");
    const contexts = row(table, "Context window");
    const outputs = row(table, "Max output");
    const extended = row(table, "Extended thinking");
    const adaptive = row(table, "Adaptive thinking");
    for (let column = 1; column < table.headers.length; column += 1) {
      const id = ids[column];
      if (id === undefined || !modelIdSchema.safeParse(id).success) continue;
      const item = model(models, input, id);
      const name = table.headers[column]?.replace(/\s*\(deprecated\)$/i, "");
      if (name) item.name = name;
      item.description = descriptions?.[column] || item.description;
      const alias = aliases?.[column];
      if (alias !== undefined && alias !== id && modelIdSchema.safeParse(alias).success)
        item.aliases = [...new Set([...item.aliases, alias])];
      item.modalities = { input: ["text", "image"], output: ["text"] };
      const thinking = [extended?.[column], adaptive?.[column]].filter(
        (value): value is string => value !== undefined,
      );
      if (thinking.some((value) => value.startsWith("Yes"))) item.capabilities.reasoning = true;
      else if (thinking.length === 2 && thinking.every((value) => value === "No"))
        item.capabilities.reasoning = false;
      item.limits = {
        ...item.limits,
        context_tokens: tokenCount(contexts?.[column]),
        max_output_tokens: tokenCount(outputs?.[column]),
      };
      item.status = /\(deprecated\)$/i.test(table.headers[column] ?? "") ? "deprecated" : "active";
      item.is_deprecated = item.status === "deprecated";
    }
  }

  for (const match of body.matchAll(
    /Claude (Fable 5|Mythos 5|Mythos Preview) \(`([a-z0-9._:/-]+)`\)/g,
  )) {
    if (match[1] === undefined || match[2] === undefined) continue;
    const item = model(models, input, match[2]);
    item.name = `Claude ${match[1]}`;
    item.modalities = { input: ["text", "image"], output: ["text"] };
    if (match[1] === "Mythos Preview") {
      item.status = "preview";
      item.is_deprecated = false;
    } else {
      item.status = "active";
      item.is_deprecated = false;
    }
  }
}

function launch(body: string, input: Input, models: Map<string, ProviderModel>): void {
  const table = tables(body).find(
    (candidate) => candidate.headers.join("|") === "Model|API model ID|Description",
  );
  if (table === undefined) throw new Error("Anthropic launch page omitted its model table");
  const releaseText = body.match(/become available on ([A-Z][a-z]+ \d{1,2}, \d{4})/)?.[1];
  const releaseDate = releaseText === undefined ? undefined : date(releaseText);
  if (releaseDate === undefined) throw new Error("Anthropic launch page omitted its release date");
  for (const values of table.rows) {
    const id = values[1];
    if (id === undefined || !modelIdSchema.safeParse(id).success) continue;
    const item = model(models, input, id);
    item.name = values[0] || item.name;
    item.description = values[2] || item.description;
    if (body.includes("1M token context window") && body.includes("up to 128k output tokens"))
      item.limits = { ...item.limits, context_tokens: 1_000_000, max_output_tokens: 128_000 };
    if (body.includes("Adaptive thinking is always on")) item.capabilities.reasoning = true;
    if (body.includes("Programmatic tool calling")) item.capabilities.tool_call = true;
    if (body.includes("Code execution")) item.capabilities.code_execution = true;
    if (body.includes("context editing")) item.capabilities.context_management = true;
    if (body.includes("Effort")) item.capabilities.effort_control = true;
    item.release_date = releaseDate;
  }
}

function status(value: string): ProviderModel["status"] | undefined {
  if (value === "Active" || value === "Legacy") return "active";
  if (value === "Deprecated") return "deprecated";
  if (value === "Retired") return "retired";
  return undefined;
}

function lifecycle(body: string, input: Input, models: Map<string, ProviderModel>): void {
  const parsedTables = tables(body);
  const statusTable = parsedTables.find((table) => table.headers[0] === "API model name");
  if (statusTable === undefined) throw new Error("Anthropic lifecycle page omitted model status");
  for (const values of statusTable.rows) {
    const id = values[0];
    const state = status(values[1] ?? "");
    if (id === undefined || state === undefined || !modelIdSchema.safeParse(id).success) continue;
    const item = model(models, input, id);
    item.status = state;
    item.is_deprecated = state === "deprecated" || state === "retired";
    const deprecatedAt = date(values[2] ?? "");
    if (deprecatedAt !== undefined) item.deprecated_at = deprecatedAt;
    const retiredAt = date(values[3] ?? "");
    if (retiredAt !== undefined && state !== "active") item.retired_at = retiredAt;
  }

  const lines = body.split(/\r?\n/);
  for (const table of parsedTables.filter(
    (candidate) => candidate.headers[0] === "Retirement date",
  )) {
    const deprecatedAt = lines
      .slice(0, table.line)
      .reverse()
      .map((line) => line.match(/^### (\d{4}-\d{2}-\d{2}):/)?.[1])
      .find((value) => value !== undefined);
    if (deprecatedAt === undefined)
      throw new Error("Anthropic lifecycle history omitted announcement date");
    for (const values of table.rows) {
      const retiredAt = date(values[0] ?? "");
      const id = values[1];
      const replacement = values[2];
      if (retiredAt === undefined || id === undefined || !modelIdSchema.safeParse(id).success)
        continue;
      const item = model(models, input, id);
      item.deprecated_at = deprecatedAt;
      item.retired_at = retiredAt;
      item.status = retiredAt <= input.observedAt.slice(0, 10) ? "retired" : "deprecated";
      item.is_deprecated = true;
      if (replacement !== undefined && modelIdSchema.safeParse(replacement).success)
        item.replacement_model_ids = [...new Set([...item.replacement_model_ids, replacement])];
    }
  }

  const mythos = body.match(
    /`(claude-mythos-preview)`\) will be retired on ([A-Z][a-z]+ \d{1,2}, \d{4}).*?`(claude-mythos-5)`/s,
  );
  const retiredAt = mythos?.[2] === undefined ? undefined : date(mythos[2]);
  if (mythos?.[1] !== undefined && mythos[3] !== undefined && retiredAt !== undefined) {
    const item = model(models, input, mythos[1]);
    item.retired_at = retiredAt;
    item.status = retiredAt <= input.observedAt.slice(0, 10) ? "retired" : "deprecated";
    item.is_deprecated = true;
    item.replacement_model_ids = [mythos[3]];
  }
}

function applyEndpoint(
  body: string,
  expected: (typeof endpointDocuments)[number]["endpoint"],
  models: Map<string, ProviderModel>,
): void {
  const header = body.match(/^## (.+)\r?\n\r?\n\*\*post\*\* `\/([^`]+)`/);
  if (header?.[1] !== expected.name || header[2] !== expected.path)
    throw new Error(`Anthropic endpoint document drifted for ${expected.path}`);
  const field = /^([ \t]*)- `model: Model`[ \t]*$/m.exec(body);
  if (field?.[1] === undefined)
    throw new Error(`Anthropic endpoint omitted its model field: ${expected.path}`);
  const lines = body.slice(field.index + field[0].length).split(/\r?\n/);
  const end = lines.findIndex((line) => line.startsWith(`${field[1]}- \``));
  const section = lines.slice(0, end < 0 ? undefined : end).join("\n");
  const summary = section.match(/^[ \t]+- `(.+)`[ \t]*$/m)?.[1];
  const ids = [
    ...new Set(
      [...section.matchAll(/^[ \t]+- `"([^"]+)"`[ \t]*$/gm)].map((match) =>
        modelIdSchema.parse(match[1]),
      ),
    ),
  ];
  const summaryIds = [...(summary?.matchAll(/"([^"]+)"/g) ?? [])].map((match) =>
    modelIdSchema.parse(match[1]),
  );
  const more = Number(summary?.match(/ or (\d+) more$/)?.[1] ?? 0);
  if (
    ids.length === 0 ||
    ids.length !== summaryIds.length + more ||
    summaryIds.some((id) => !ids.includes(id))
  )
    throw new Error(`Anthropic endpoint model list drifted: ${expected.path}`);

  const supported = new Set<ProviderModel>();
  for (const id of ids) {
    const direct = models.get(id);
    const candidates =
      direct === undefined
        ? [...models.values()].filter((item) => item.aliases.includes(id))
        : [direct];
    if (candidates.length !== 1 || candidates[0] === undefined)
      throw new Error(`Anthropic endpoint model did not match one official ID: ${id}`);
    supported.add(candidates[0]);
  }
  for (const item of supported) {
    item.api_endpoints = [...(item.api_endpoints ?? []), expected].sort((left, right) =>
      apiEndpointKey(left).localeCompare(apiEndpointKey(right)),
    );
  }
}

function label(value: string): string {
  return value
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/\s+(?:through|starting)\s+.*$/i, "")
    .trim();
}

function key(value: string): string {
  return (
    label(value)
      .toLowerCase()
      .match(/[a-z]+|\d+/g)
      ?.filter((token) => token !== "claude" && !/^\d{8}$/.test(token))
      .sort()
      .join("-") ?? ""
  );
}

function amount(value: string | undefined): string | undefined {
  return value?.match(/^\$((?:0|[1-9]\d*)(?:\.\d+)?) \/ MTok$/)?.[1];
}

function effective(value: string): PriceRate["conditions"] {
  if (value.includes("through August 31, 2026"))
    return { effective_until: "2026-08-31", promotion: true };
  if (value.includes("starting September 1, 2026")) return { effective_from: "2026-09-01" };
  return {};
}

function cached(rate: PriceRate): PriceRate[] {
  const derive = (
    meter: "cache_write_text" | "cache_read_text",
    multiplier: string,
    cacheTtlSeconds?: number,
  ): PriceRate => ({
    ...rate,
    meter,
    price: multiplyDecimal(rate.price, multiplier),
    conditions: {
      ...rate.conditions,
      ...(cacheTtlSeconds === undefined ? {} : { cache_ttl_seconds: cacheTtlSeconds }),
    },
    derived: true,
    derivation: `${multiplier} × published ${rate.conditions.service_tier ?? "standard"} input rate`,
    raw_price: undefined,
    raw_unit: "published prompt-cache multiplier",
  });
  return [
    derive("cache_write_text", "1.25", 300),
    derive("cache_write_text", "2", 3600),
    derive("cache_read_text", "0.1"),
  ];
}

function supportsUsInference(id: string): boolean {
  if (/^claude-(?:fable|mythos)-/.test(id)) return true;
  const match = id.match(/^claude-(?:opus|sonnet)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/);
  if (match?.[1] === undefined) return false;
  const major = Number(match[1]);
  const minor = Number(match[2] ?? 0);
  return major > 4 || (major === 4 && minor >= 6);
}

function pricing(body: string, input: Input, models: Map<string, ProviderModel>): void {
  const identities = new Map<string, string[]>();
  for (const item of models.values()) {
    const identity = key(item.model_id);
    identities.set(identity, [...(identities.get(identity) ?? []), item.model_id]);
  }
  const resolve = (name: string): ProviderModel => {
    const ids = identities.get(key(name)) ?? [];
    if (ids.length !== 1 || ids[0] === undefined)
      throw new Error(`Anthropic pricing model did not match one official ID: ${label(name)}`);
    const item = models.get(ids[0]);
    if (item === undefined) throw new Error("Anthropic identity index drifted");
    if (item.name === item.model_id) item.name = label(name);
    return item;
  };
  const add = (item: ProviderModel, rates: PriceRate[]): void => {
    item.pricing.push(...rates);
    item.pricing_status = "published";
  };
  const parsedTables = tables(body);
  const base = parsedTables.find((table) => table.headers[1] === "Base Input Tokens");
  const batch = parsedTables.find((table) => table.headers[1] === "Batch input");
  const fast = parsedTables.find(
    (table) => table.headers.join("|") === "Model|Input|Output" && table.rows.length === 2,
  );
  if (base === undefined || batch === undefined || fast === undefined)
    throw new Error("Anthropic pricing page omitted a reviewed price table");

  for (const values of base.rows) {
    const item = resolve(values[0] ?? "");
    const parsed = fivePricesSchema.safeParse(values.slice(1).map(amount));
    if (!parsed.success)
      throw new Error(`Anthropic base pricing was not machine-readable for ${item.model_id}`);
    const [inputPrice, fiveMinuteWrite, oneHourWrite, cacheRead, outputPrice] = parsed.data;
    const conditions = effective(values[0] ?? "");
    const rate = (meter: PriceRate["meter"], value: string, cacheTtlSeconds?: number): PriceRate =>
      publishedRate(meter, value, "million_tokens", input.source.id, "MTok", {
        ...conditions,
        ...(cacheTtlSeconds === undefined ? {} : { cache_ttl_seconds: cacheTtlSeconds }),
      });
    add(item, [
      rate("input_text", inputPrice),
      rate("cache_write_text", fiveMinuteWrite, 300),
      rate("cache_write_text", oneHourWrite, 3600),
      rate("cache_read_text", cacheRead),
      rate("output_text", outputPrice),
    ]);
    item.capabilities.prompt_cache = true;
  }

  for (const values of batch.rows) {
    const item = resolve(values[0] ?? "");
    const inputPrice = amount(values[1]);
    const outputPrice = amount(values[2]);
    if (inputPrice === undefined || outputPrice === undefined)
      throw new Error(`Anthropic batch pricing was not machine-readable for ${item.model_id}`);
    const conditions = { ...effective(values[0] ?? ""), service_tier: "batch" };
    const inputRate = publishedRate(
      "input_text",
      inputPrice,
      "million_tokens",
      input.source.id,
      "MTok",
      conditions,
    );
    add(item, [
      inputRate,
      ...cached(inputRate),
      publishedRate(
        "output_text",
        outputPrice,
        "million_tokens",
        input.source.id,
        "MTok",
        conditions,
      ),
    ]);
    item.capabilities.batch = true;
  }

  for (const values of fast.rows) {
    const item = resolve(values[0] ?? "");
    const inputPrice = amount(values[1]);
    const outputPrice = amount(values[2]);
    if (inputPrice === undefined || outputPrice === undefined)
      throw new Error(`Anthropic fast pricing was not machine-readable for ${item.model_id}`);
    const conditions = { service_tier: "fast" };
    const inputRate = publishedRate(
      "input_text",
      inputPrice,
      "million_tokens",
      input.source.id,
      "MTok",
      conditions,
    );
    add(item, [
      inputRate,
      ...cached(inputRate),
      publishedRate(
        "output_text",
        outputPrice,
        "million_tokens",
        input.source.id,
        "MTok",
        conditions,
      ),
    ]);
  }

  const tools = parsedTables.find((table) => table.headers.includes("Tool choice"));
  if (tools === undefined) throw new Error("Anthropic pricing page omitted tool support");
  for (const values of tools.rows) resolve(values[0] ?? "").capabilities.tool_call = true;

  const longContext = body.match(/^(.+?) include the full \[1M token context window]/m)?.[1];
  if (longContext === undefined)
    throw new Error("Anthropic pricing page omitted long-context coverage");
  const longContextModels = text(longContext);
  for (const item of models.values())
    if (
      longContextModels.includes(item.name) ||
      longContextModels.includes(item.name.replace(/^Claude /, ""))
    )
      item.limits.context_tokens = 1_000_000;

  for (const item of models.values()) {
    if (!supportsUsInference(item.model_id)) continue;
    item.pricing.push(
      ...item.pricing.map(
        (rate): PriceRate => ({
          ...rate,
          price: multiplyDecimal(rate.price, "1.1"),
          conditions: { ...rate.conditions, inference_geo: "us" },
          derived: true,
          derivation: `1.1 × ${rate.derivation ?? "published rate"} for US-only inference`,
          raw_price: undefined,
          raw_unit: "published inference geography multiplier",
        }),
      ),
    );
  }
}

export function parseAnthropicCatalog(input: Input): ProviderModel[] {
  const bundle = linkedBundleSchema.parse(json(input.body));
  const document = (suffix: string): string => {
    const match = bundle.documents.find((item) => new URL(item.url).pathname.endsWith(suffix));
    if (match === undefined) throw new Error(`Anthropic catalog omitted ${suffix}`);
    return match.body;
  };
  const models = new Map<string, ProviderModel>();
  overview(bundle.index.body, input, models);
  launch(document("introducing-claude-fable-5-and-claude-mythos-5.md"), input, models);
  lifecycle(document("model-deprecations.md"), input, models);
  pricing(document("pricing.md"), input, models);
  for (const entry of endpointDocuments)
    applyEndpoint(document(entry.suffix), entry.endpoint, models);
  return [...models.values()].sort((left, right) => left.uid.localeCompare(right.uid));
}

export function parseAnthropicApi(input: Input): ProviderModel[] {
  const parsed = listSchema.parse(json(input.body));
  if (parsed.has_more)
    throw new Error("Anthropic model API pagination exceeded the reviewed limit");
  const results = parsed.data.map((value) => itemSchema.safeParse(value));
  if (parsed.data.length === 0 || results.some((result) => !result.success))
    throw new Error("Anthropic model API schema drift");
  return results.flatMap((result) => {
    if (!result.success) return [];
    const item = result.data;
    const inputModalities: Modality[] = ["text"];
    if (item.capabilities.image_input.supported) inputModalities.push("image");
    if (item.capabilities.pdf_input.supported) inputModalities.push("pdf");
    return [
      {
        ...baseModel({
          providerId: input.provider.id,
          id: item.id,
          name: item.display_name,
          sourceId: input.source.id,
          observedAt: input.observedAt,
        }),
        types: ["generate"],
        modalities: { input: inputModalities, output: ["text"] },
        capabilities: {
          ...unknownCapabilities(),
          reasoning: item.capabilities.thinking.supported,
          structured_output: item.capabilities.structured_outputs.supported,
          batch: item.capabilities.batch.supported,
          citations: item.capabilities.citations.supported,
          code_execution: item.capabilities.code_execution.supported,
          context_management: item.capabilities.context_management.supported,
          effort_control: item.capabilities.effort.supported,
        },
        limits: {
          ...(item.max_input_tokens > 0
            ? { context_tokens: item.max_input_tokens, max_input_tokens: item.max_input_tokens }
            : {}),
          ...(item.max_tokens > 0 ? { max_output_tokens: item.max_tokens } : {}),
        },
        release_date: item.created_at.slice(0, 10),
      } satisfies ProviderModel,
    ];
  });
}
