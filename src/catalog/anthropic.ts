import { z } from "zod";
import { linkedBundleSchema, linkedDocumentBody } from "./bundle.ts";
import { modelIdSchema } from "./identity.ts";
import type { SourceManifest } from "./manifests.ts";
import { baseModel } from "./model.ts";
import { decimalsEqual, multiplyDecimal, publishedRate } from "./pricing.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import type { ParsedProviderModel as ProviderModel, SourcePriceFact } from "./pricing-source.ts";
import { assertItemCount, recognizeItems } from "./source-contract.ts";
import { type Modality, type Provider, unknownCapabilities } from "./schema.ts";

interface Input {
  provider: Provider;
  source: SourceManifest;
  body: string;
  observedAt: string;
  onPricingReconciliation?: (item: PricingReconciliationItem) => void;
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
const messagesEndpoint = { name: "Create a Message", path: "v1/messages" };
const batchEndpoint = { name: "Create a Message Batch", path: "v1/messages/batches" };

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
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .replaceAll("\\|", "\u0000")
    .split("|")
    .map((cell) => text(cell.replaceAll("\u0000", "|")));
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
      if (values.length !== headers.length)
        throw new Error("Anthropic Markdown table contained an irregular row");
      rows.push(values);
      cursor += 1;
    }
    result.push({ headers, rows, line });
    line = cursor - 1;
  }
  return result;
}

function row(table: MarkdownTable, label: string): string[] | undefined {
  return table.rows.find(
    (values) => values[0] === label || values[0]?.startsWith(`${label} (`) === true,
  );
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
  const match = value.match(/^([A-Z][a-z]+) (\d{1,2})(?:st|nd|rd|th)?, (\d{4})$/);
  const month = match?.[1] === undefined ? undefined : months.get(match[1]);
  if (month === undefined || match?.[2] === undefined || match[3] === undefined) return undefined;
  const result = `${match[3]}-${month}-${match[2].padStart(2, "0")}`;
  return z.iso.date().safeParse(result).success ? result : undefined;
}

function tableDate(value: string, field: string): string | undefined {
  if (value === "N/A" || value.startsWith("Not sooner than ")) return undefined;
  const parsed = date(value);
  if (parsed === undefined) throw new Error(`Anthropic ${field} was not a valid date: ${value}`);
  return parsed;
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
    tasks: ["text_generation"],
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
    }
  }

  for (const match of body.matchAll(
    /Claude ([A-Z][A-Za-z]+(?: (?:[A-Z][A-Za-z]+|\d+(?:\.\d+)?))*) \(`([a-z0-9._:/-]+)`\)/g,
  )) {
    if (match[1] === undefined || match[2] === undefined) continue;
    const item = model(models, input, match[2]);
    item.name = `Claude ${match[1]}`;
    item.modalities = { input: ["text", "image"], output: ["text"] };
    if (/(?:^|-)preview(?:-|$)/.test(item.model_id)) item.release_stage = "preview";
  }

  for (const item of models.values()) {
    if (
      body.includes(`${item.name} is generally available`) ||
      body.includes(`${item.name} (\`${item.model_id}\`) is generally available`)
    ) {
      item.status = "active";
      item.release_stage = "stable";
    } else if (
      body.includes(
        `${item.name} is not generally available: it is offered in limited availability`,
      )
    ) {
      item.status = "active";
    }
  }

  for (const match of body.matchAll(
    /Claude [^(\n]+ \(`(claude-[a-z0-9._:/-]+)`\) shares (Claude [A-Za-z0-9. -]+)'s specs and pricing/g,
  )) {
    const targetId = match[1];
    const sourceName = match[2];
    if (targetId === undefined || sourceName === undefined) continue;
    const target = models.get(targetId);
    const sources = [...models.values()].filter(({ name }) => name === sourceName);
    if (target === undefined || sources.length !== 1 || sources[0] === undefined)
      throw new Error(`Anthropic shared model facts did not bind: ${targetId}`);
    const source = sources[0];
    target.modalities = {
      input: [...source.modalities.input],
      output: [...source.modalities.output],
    };
    target.limits = { ...source.limits };
    target.capabilities.reasoning = source.capabilities.reasoning;
  }
}

function releaseNotes(body: string, input: Input, models: Map<string, ProviderModel>): void {
  let currentDate: string | undefined;
  let launches = 0;
  for (const line of body.split(/\r?\n/)) {
    const heading = line.match(/^### (.+)$/)?.[1];
    if (heading !== undefined) currentDate = date(heading);
    const subject = line.match(/^[*-] We've launched (.+?), /)?.[1];
    if (subject === undefined) continue;
    const launchSubject = text(subject);
    if (!/^Claude (?:Fable|Mythos|Opus|Sonnet|Haiku|\d)\b/.test(launchSubject)) continue;
    if (currentDate === undefined)
      throw new Error("Anthropic release notes omitted a valid launch date");
    const targets = new Map<string, ProviderModel>();
    for (const match of subject.matchAll(
      /`(claude-[a-z0-9._:/-]+)`|\((claude-[a-z0-9._:/-]+)\)/g,
    )) {
      const id = match[1] ?? match[2];
      if (id !== undefined) {
        const item = model(models, input, id);
        targets.set(item.model_id, item);
      }
    }
    for (const item of mentioned(launchSubject, models)) targets.set(item.model_id, item);
    for (const item of targets.values()) {
      if (item.release_date !== undefined && item.release_date !== currentDate)
        throw new Error(`Anthropic release sources disagree for ${item.model_id}`);
      item.release_date = currentDate;
      launches += 1;
    }
  }
  if (launches === 0) throw new Error("Anthropic release notes omitted model launches");
}

function status(value: string): ProviderModel["status"] | undefined {
  const normalized = value.toLowerCase();
  if (normalized === "active") return "active";
  if (normalized === "legacy") return "legacy";
  if (normalized === "deprecated") return "deprecated";
  if (normalized === "retired") return "retired";
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
    const deprecatedAt = tableDate(values[2] ?? "", "deprecation date");
    if (deprecatedAt !== undefined) item.deprecated_at = deprecatedAt;
    const retiredAt = tableDate(values[3] ?? "", "retirement date");
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
      const id = values[1];
      const replacement = values[2];
      if (id === undefined || !modelIdSchema.safeParse(id).success) continue;
      const retiredAt = tableDate(values[0] ?? "", "historical retirement date");
      if (retiredAt === undefined)
        throw new Error("Anthropic lifecycle history omitted its retirement date");
      const item = model(models, input, id);
      item.deprecated_at = deprecatedAt;
      item.retired_at = retiredAt;
      item.status = retiredAt <= input.observedAt.slice(0, 10) ? "retired" : "deprecated";
      if (replacement !== undefined && modelIdSchema.safeParse(replacement).success)
        item.replacement_model_ids = [...new Set([...item.replacement_model_ids, replacement])];
    }
  }

  for (const match of body.matchAll(
    /`(claude-[a-z0-9._:/-]+)`\) is (active|legacy|deprecated|retired)\b/gi,
  )) {
    const state = status(match[2] ?? "");
    if (match[1] !== undefined && state !== undefined)
      model(models, input, match[1]).status = state;
  }

  for (const match of body.matchAll(
    /`(claude-[a-z0-9._:/-]+)`\) is deprecated\.[^\n]*?`(claude-[a-z0-9._:/-]+)`/gi,
  )) {
    if (match[1] === undefined || match[2] === undefined) continue;
    const item = model(models, input, match[1]);
    item.replacement_model_ids = [...new Set([...item.replacement_model_ids, match[2]])];
  }

  for (const match of body.matchAll(
    /`(claude-[a-z0-9._:/-]+)`\) will be retired on ([A-Z][a-z]+ \d{1,2}, \d{4})\.[^\n]*?`(claude-[a-z0-9._:/-]+)`/g,
  )) {
    if (match[1] === undefined || match[2] === undefined || match[3] === undefined) continue;
    const retiredAt = date(match[2]);
    if (retiredAt === undefined)
      throw new Error(`Anthropic inline retirement date was not valid: ${match[2]}`);
    const item = model(models, input, match[1]);
    item.retired_at = retiredAt;
    item.status = retiredAt <= input.observedAt.slice(0, 10) ? "retired" : "deprecated";
    item.replacement_model_ids = [...new Set([...item.replacement_model_ids, match[3]])];
  }
}

function validateEndpoint(
  body: string,
  expected: { name: string; path: string },
  method: "get" | "post" = "post",
): void {
  const header = body.match(/^## (.+)\r?\n\r?\n\*\*(get|post)\*\* `\/([^`]+)`/);
  if (header?.[1] !== expected.name || header[2] !== method || header[3] !== expected.path)
    throw new Error(`Anthropic endpoint document drifted for ${expected.path}`);
}

function applyEndpoints(
  messagesBody: string,
  batchesBody: string,
  batchGuide: string,
  models: Map<string, ProviderModel>,
): void {
  validateEndpoint(messagesBody, messagesEndpoint);
  validateEndpoint(batchesBody, batchEndpoint);
  if (
    !/- `stream: optional boolean`\r?\n\r?\n\s+Whether to incrementally stream the response using server-sent events\./.test(
      messagesBody,
    )
  )
    throw new Error("Anthropic Messages streaming contract drifted");
  if (
    !/- `tools: optional array of ToolUnion`[\s\S]*?Definitions of tools that the model may use\.[\s\S]*?may return `tool_use` content blocks/.test(
      messagesBody,
    )
  )
    throw new Error("Anthropic Messages tool-use contract drifted");
  if (!/^All \[active models]\([^)]*\) support the Message Batches API\.$/m.test(batchGuide))
    throw new Error("Anthropic batch model coverage drifted");
  for (const item of models.values()) {
    if (item.status === "active") {
      item.api_endpoints = [messagesEndpoint, batchEndpoint];
      item.capabilities.batch = true;
      item.capabilities.streaming = true;
      item.capabilities.tool_call = true;
    } else if (item.status === "legacy" || item.status === "deprecated") {
      item.api_endpoints = [messagesEndpoint];
      item.capabilities.batch = false;
      item.capabilities.streaming = true;
      item.capabilities.tool_call = true;
    }
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

function resolver(models: Map<string, ProviderModel>): (value: string) => ProviderModel {
  const identities = new Map<string, string[]>();
  for (const item of models.values()) {
    for (const value of [item.model_id, item.name, ...item.aliases]) {
      const identity = key(value);
      identities.set(identity, [...(identities.get(identity) ?? []), item.model_id]);
    }
  }
  return (value: string): ProviderModel => {
    const ids = [...new Set(identities.get(key(value)) ?? [])];
    if (ids.length !== 1 || ids[0] === undefined)
      throw new Error(`Anthropic model label did not match one official ID: ${label(value)}`);
    const item = models.get(ids[0]);
    if (item === undefined) throw new Error("Anthropic identity index drifted");
    if (item.name === item.model_id) item.name = label(value);
    return item;
  };
}

function mentioned(value: string, models: Map<string, ProviderModel>): ProviderModel[] {
  const result: ProviderModel[] = [];
  for (const item of models.values()) {
    if (item.name === item.model_id) continue;
    const escaped = item.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?:^|[^\\w.])${escaped}(?![\\w.])`).test(value)) result.push(item);
  }
  return result;
}

function callable(item: ProviderModel): boolean {
  return item.api_endpoints?.some(({ path }) => path === messagesEndpoint.path) === true;
}

function requireMentions(
  value: string | undefined,
  models: Map<string, ProviderModel>,
  message: string,
): ProviderModel[] {
  const matches = value === undefined ? [] : mentioned(value, models);
  if (matches.length === 0) throw new Error(message);
  return matches;
}

function listedModels(
  body: string,
  models: Map<string, ProviderModel>,
  capability: string,
): ProviderModel[] {
  const list = body
    .split(/\r?\n/)
    .find((line) => line.startsWith("- Supported models:"))
    ?.match(/^- Supported models: (`[^`]+`(?:, `[^`]+`)*)$/)?.[1];
  if (list === undefined) throw new Error(`Anthropic ${capability} coverage drifted`);
  const ids = [...list.matchAll(/`([^`]+)`/g)].map((match) => modelIdSchema.parse(match[1]));
  if (ids.length === 0 || new Set(ids).size !== ids.length)
    throw new Error(`Anthropic ${capability} coverage drifted`);
  return ids.map((id) => {
    const model = models.get(id);
    if (model === undefined) throw new Error(`Anthropic ${capability} model did not bind: ${id}`);
    return model;
  });
}

function capabilities(
  bodies: {
    citations: string;
    pdf: string;
    contextEditing: string;
    structuredOutputs: string;
    codeExecution: string;
    computerUse: string;
    effort: string;
    promptCaching: string;
    glossary: string;
    thinking: string;
    toolUse: string;
  },
  models: Map<string, ProviderModel>,
): void {
  const current = [...models.values()].filter(({ status }) => status === "active");
  const supported = [...models.values()].filter(callable);

  if (!/^All \[active models]\([^)]*\) support citations\.$/m.test(bodies.citations))
    throw new Error("Anthropic citation coverage drifted");
  for (const item of current) item.capabilities.citations = true;

  if (!/All \[active models]\([^)]*\) support PDF processing\./.test(bodies.pdf))
    throw new Error("Anthropic PDF coverage drifted");
  for (const item of current)
    item.modalities.input = [...new Set<Modality>([...item.modalities.input, "pdf"])];

  if (
    !/^Context editing is available on all supported Claude models\.$/m.test(bodies.contextEditing)
  )
    throw new Error("Anthropic context-editing coverage drifted");
  for (const item of supported) item.capabilities.context_management = true;

  const structured = new Set(listedModels(bodies.structuredOutputs, models, "structured-output"));
  for (const item of supported) item.capabilities.structured_output = structured.has(item);

  const codeTable = tables(bodies.codeExecution).find(
    (table) => table.headers.join("|") === "Model|Tool versions",
  );
  if (codeTable === undefined || codeTable.rows.length === 0)
    throw new Error("Anthropic code-execution coverage drifted");
  for (const item of supported) item.capabilities.code_execution = false;
  const resolve = resolver(models);
  for (const values of codeTable.rows) {
    const item = resolve(values[0] ?? "");
    if (callable(item)) item.capabilities.code_execution = true;
  }
  const previewCode = bodies.codeExecution
    .split(/\r?\n/)
    .find((line) => line.includes("code execution is supported on the Claude API"));
  for (const item of requireMentions(
    previewCode,
    models,
    "Anthropic code-execution exception drifted",
  ))
    if (callable(item)) item.capabilities.code_execution = true;

  const computerModels = new Set([
    ...listedModels(bodies.computerUse, models, "computer-use"),
    ...mentioned(bodies.computerUse.match(/<Note>([\s\S]*?)<\/Note>/)?.[1] ?? "", models),
  ]);
  for (const item of supported) item.capabilities.computer_use = false;
  for (const item of computerModels) if (callable(item)) item.capabilities.computer_use = true;

  const effortModels = listedModels(bodies.effort, models, "effort");
  for (const item of supported) item.capabilities.effort_control = false;
  for (const item of effortModels) if (callable(item)) item.capabilities.effort_control = true;

  if (
    !/^Prompt caching \(both automatic and explicit\) is supported on all \[active Claude models]\([^)]*\)\.$/m.test(
      bodies.promptCaching,
    )
  )
    throw new Error("Anthropic prompt-cache coverage drifted");
  for (const item of current) item.capabilities.prompt_cache = true;

  if (!/The Claude API does not currently offer fine-tuning/.test(bodies.glossary))
    throw new Error("Anthropic fine-tuning coverage drifted");
  for (const item of supported) item.capabilities.fine_tuning = false;

  const thinkingLine = bodies.thinking
    .split(/\r?\n/)
    .find((line) => line.includes("thinking cannot be turned off on these models"));
  for (const item of requireMentions(thinkingLine, models, "Anthropic thinking coverage drifted"))
    if (callable(item)) item.capabilities.reasoning = true;

  const toolLine = bodies.toolUse
    .split(/\r?\n/)
    .find((line) => line.includes("does not support forced tool use"));
  for (const item of requireMentions(toolLine, models, "Anthropic tool-use coverage drifted"))
    if (callable(item)) item.capabilities.tool_call = true;
}

function validateDocumentationIndex(body: string, input: Input): void {
  if (!body.startsWith("# Anthropic Developer Documentation"))
    throw new Error("Anthropic documentation index drifted");
  const indexedPaths = new Set(
    [...body.matchAll(/https:\/\/platform\.claude\.com(\/docs\/en\/[^)\s]+\.md)/g)].flatMap(
      (match) => (match[1] === undefined ? [] : [match[1]]),
    ),
  );
  const configured = input.source.linkedDocuments?.documents;
  if (configured === undefined) throw new Error("Anthropic documentation bundle is not fixed");
  for (const { url } of configured) {
    const path = new URL(url).pathname;
    if (path === "/llms.txt") continue;
    if (!indexedPaths.has(path))
      throw new Error(`Anthropic documentation index omitted reviewed source: ${path}`);
  }
}

function validateModelIdentityContract(body: string, modelsListBody: string): void {
  if (
    !body.includes("Each Claude model ID identifies a pinned version of the model") ||
    !body.includes("Starting with the Claude 4.6 generation, model IDs use a dateless format") ||
    !body.includes("dateless ID is the canonical model ID for that release") ||
    !body.includes("convenience pointer that resolves to the most recent dated snapshot")
  )
    throw new Error("Anthropic model-ID versioning contract drifted");
  validateEndpoint(modelsListBody, { name: "List Models", path: "v1/models" }, "get");
  if (
    !modelsListBody.includes("Defaults to `20`. Ranges from `1` to `1000`.") ||
    !modelsListBody.includes("ID of the object to use as a cursor for pagination")
  )
    throw new Error("Anthropic Models API pagination contract drifted");
  for (const field of [
    "batch",
    "citations",
    "code_execution",
    "context_management",
    "effort",
    "image_input",
    "pdf_input",
    "structured_outputs",
    "thinking",
  ])
    if (!modelsListBody.includes(`- \`${field}:`))
      throw new Error(`Anthropic Models API capability contract drifted for ${field}`);
}

interface ModelGeneration {
  major: number;
  minor: number;
}

function geographyGeneration(body: string, label: string): ModelGeneration {
  const values = new Map<string, ModelGeneration>();
  for (const line of body.split(/\r?\n/)) {
    if (!line.includes("inference_geo")) continue;
    for (const match of line.matchAll(/Claude (\d+)\.(\d+) and later models/g)) {
      if (match[1] === undefined || match[2] === undefined) continue;
      const generation = { major: Number(match[1]), minor: Number(match[2]) };
      values.set(`${generation.major}.${generation.minor}`, generation);
    }
  }
  const generations = [...values.values()];
  if (generations.length !== 1 || generations[0] === undefined)
    throw new Error(`Anthropic ${label} generation threshold drifted`);
  return generations[0];
}

function modelGeneration(id: string): ModelGeneration | undefined {
  const match = id.match(/^claude-[a-z]+-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/);
  if (match?.[1] === undefined) return undefined;
  return { major: Number(match[1]), minor: Number(match[2] ?? 0) };
}

function atLeastGeneration(id: string, threshold: ModelGeneration): boolean {
  const generation = modelGeneration(id);
  return (
    generation !== undefined &&
    (generation.major > threshold.major ||
      (generation.major === threshold.major && generation.minor >= threshold.minor))
  );
}

function validateAccountingContracts(
  bodies: {
    messages: string;
    serviceTiers: string;
    dataResidency: string;
    usageCost: string;
    usageReport: string;
    costReport: string;
    fallbackCredit: string;
  },
  input: Input,
): ModelGeneration {
  for (const field of [
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
    "inference_geo",
    "input_tokens",
    "output_tokens",
    "server_tool_use",
    "service_tier",
  ])
    if (!bodies.messages.includes(`- \`${field}:`))
      throw new Error(`Anthropic Messages usage contract drifted for ${field}`);

  if (
    !bodies.serviceTiers.includes('`"auto"` (default)') ||
    !bodies.serviceTiers.includes('`"standard_only"`') ||
    !bodies.serviceTiers.includes('"service_tier": "priority"') ||
    !bodies.serviceTiers.includes(
      "Requests beyond your committed capacity automatically fall back to standard tier",
    )
  )
    throw new Error("Anthropic service-tier accounting contract drifted");
  input.onPricingReconciliation?.({
    disposition: "excluded",
    reason_code: "account_specific_service_tier",
    sample: "Priority Tier contract pricing",
  });

  const dataResidencyGeneration = geographyGeneration(bodies.dataResidency, "data-residency");
  if (
    !bodies.dataResidency.includes(
      "The response `usage` object includes an `inference_geo` field",
    ) ||
    !bodies.dataResidency.includes("`allowed_inference_geos`") ||
    !bodies.dataResidency.includes("`default_inference_geo`") ||
    !bodies.dataResidency.includes("return a 400 error")
  )
    throw new Error("Anthropic inference-geography contract drifted");

  validateEndpoint(
    bodies.usageReport,
    { name: "Get Messages Usage Report", path: "v1/organizations/usage_report/messages" },
    "get",
  );
  for (const field of [
    'bucket_width: optional "1d" or "1h" or "1m"',
    '"api_key_id"',
    '"context_window"',
    '"inference_geo"',
    '"model"',
    '"service_tier"',
    '"speed"',
    '"workspace_id"',
    "cache_creation",
    "output_tokens",
    "uncached_input_tokens",
  ])
    if (!bodies.usageReport.includes(field))
      throw new Error(`Anthropic Usage API contract drifted for ${field}`);

  validateEndpoint(
    bodies.costReport,
    { name: "Get Cost Report", path: "v1/organizations/cost_report" },
    "get",
  );
  for (const field of [
    'bucket_width: optional "1d"',
    "amount",
    "cost_type",
    "currency",
    "inference_geo",
    "model",
    "service_tier",
    "token_type",
    "workspace_id",
  ])
    if (!bodies.costReport.includes(field))
      throw new Error(`Anthropic Cost API contract drifted for ${field}`);

  if (
    !bodies.usageCost.includes("Usage and cost data typically appears within 5 minutes") ||
    !bodies.usageCost.includes("Priority Tier costs are not available in the cost endpoint") ||
    !bodies.usageCost.includes("Admin API key required")
  )
    throw new Error("Anthropic Usage and Cost API boundary drifted");

  if (
    !bodies.fallbackCredit.includes("fallback_credit_token") ||
    !bodies.fallbackCredit.includes("Refusals in [Message Batches]") ||
    !bodies.fallbackCredit.includes("`cache_creation_input_tokens` is lower") ||
    !bodies.fallbackCredit.includes("organization and workspace that received the refusal")
  )
    throw new Error("Anthropic fallback-credit accounting contract drifted");
  input.onPricingReconciliation?.({
    disposition: "excluded",
    reason_code: "request_credit_reconciliation",
    sample: "Fallback prompt-cache credit",
  });
  return dataResidencyGeneration;
}

function amount(value: string | undefined): string | undefined {
  return value?.match(/^\$((?:0|[1-9]\d*)(?:\.\d+)?) \/ MTok$/)?.[1];
}

function effective(value: string): SourcePriceFact["conditions"] {
  if (value.includes("through August 31, 2026"))
    return { effective_until: "2026-08-31", promotion: true };
  if (value.includes("starting September 1, 2026")) return { effective_from: "2026-09-01" };
  return {};
}

interface CacheMultipliers {
  fiveMinuteWrite: string;
  oneHourWrite: string;
  read: string;
}

function cached(rate: SourcePriceFact, multipliers: CacheMultipliers): SourcePriceFact[] {
  const derive = (
    meter: "cache_write_text" | "cache_read_text",
    multiplier: string,
    cacheTtlSeconds?: number,
  ): SourcePriceFact => ({
    ...rate,
    meter,
    price: multiplyDecimal(rate.price, multiplier),
    conditions: {
      ...rate.conditions,
      ...(cacheTtlSeconds === undefined ? {} : { cache_ttl_seconds: cacheTtlSeconds }),
    },
    derived: true,
    derivation: `${multiplier} × published ${rate.conditions.speed ?? rate.conditions.service_tier ?? "standard"} input rate`,
    raw_price: undefined,
    raw_unit: "published prompt-cache multiplier",
  });
  return [
    derive("cache_write_text", multipliers.fiveMinuteWrite, 300),
    derive("cache_write_text", multipliers.oneHourWrite, 3600),
    derive("cache_read_text", multipliers.read),
  ];
}

function cacheMultipliers(parsedTables: MarkdownTable[], input: Input): CacheMultipliers {
  const table = parsedTables.find(
    (candidate) => candidate.headers.join("|") === "Cache operation|Multiplier|Duration",
  );
  if (table === undefined) throw new Error("Anthropic pricing page omitted cache multipliers");
  const multiplier = (label: string): string => {
    const value = row(table, label)?.[1]?.match(
      /^((?:0|[1-9]\d*)(?:\.\d+)?)x base input price$/,
    )?.[1];
    if (value === undefined)
      throw new Error(`Anthropic cache multiplier was not machine-readable for ${label}`);
    input.onPricingReconciliation?.({
      disposition: "normalized",
      reason_code: "cache_multiplier_applied",
    });
    return value;
  };
  return {
    fiveMinuteWrite: multiplier("5-minute cache write"),
    oneHourWrite: multiplier("1-hour cache write"),
    read: multiplier("Cache read"),
  };
}

function validateFastMode(body: string, expectedIds: Set<string>): void {
  if (
    !body.includes('Set `speed: "fast"`') ||
    !/Fast mode is not available with the \[Batch API]/.test(body)
  )
    throw new Error("Anthropic fast-mode request contract drifted");
  const modelPattern = /^\s*[*-] Claude [^(]+\(`?(claude-[a-z0-9._:/-]+)`?\)$/gm;
  const supported = new Set(
    [...body.matchAll(modelPattern)].flatMap((match) => (match[1] === undefined ? [] : [match[1]])),
  );
  if (
    supported.size === 0 ||
    supported.size !== expectedIds.size ||
    [...supported].some((id) => !expectedIds.has(id))
  )
    throw new Error("Anthropic fast-mode model coverage disagreed with pricing");
}

function reconcileExcludedPricing(body: string, input: Input): void {
  const statements = [
    {
      pattern:
        /\*\*1,550 free hours\*\* of usage per month[\s\S]*?\*\*\$0\.05 USD per hour, per container\*\*/,
      reason_code: "provider_service_pricing_unmodeled",
      sample: "Code execution container time",
    },
    {
      pattern: /\*\*\$10 per 1,000 searches\*\*/,
      reason_code: "provider_service_pricing_unmodeled",
      sample: "Web search",
    },
    {
      pattern: /Web fetch usage has \*\*no additional charges\*\*/,
      reason_code: "provider_service_pricing_unmodeled",
      sample: "Web fetch",
    },
    {
      pattern: /\| Session runtime \| \$0\.08 per session-hour \|/,
      reason_code: "separate_product_pricing",
      sample: "Claude Managed Agents runtime",
    },
  ] as const;
  for (const statement of statements) {
    if (!statement.pattern.test(body))
      throw new Error(`Anthropic pricing page omitted ${statement.sample}`);
    input.onPricingReconciliation?.({
      disposition: "excluded",
      reason_code: statement.reason_code,
      sample: statement.sample,
    });
  }
  const ccuRates = body.match(/\$0\.01 per CCU \(fixed;/g)?.length ?? 0;
  if (ccuRates !== 2) throw new Error("Anthropic marketplace CCU pricing drifted");
  for (const sample of ["Claude Platform on AWS CCU", "Claude in Microsoft Foundry CCU"])
    input.onPricingReconciliation?.({
      disposition: "excluded",
      reason_code: "separate_distribution_pricing",
      sample,
    });
  if (!/Volume discounts may be available[\s\S]*?negotiated on a case-by-case basis/.test(body))
    throw new Error("Anthropic account-specific pricing boundary drifted");
  input.onPricingReconciliation?.({
    disposition: "excluded",
    reason_code: "account_specific_discount",
    sample: "Negotiated volume discount",
  });
}

function pricing(
  body: string,
  fastModeBody: string,
  dataResidencyGeneration: ModelGeneration,
  input: Input,
  models: Map<string, ProviderModel>,
): void {
  const resolve = resolver(models);
  const add = (item: ProviderModel, rates: SourcePriceFact[]): void => {
    item.price_facts.push(...rates);
    item.pricing_state = "numeric";
  };
  const parsedTables = tables(body);
  const multipliers = cacheMultipliers(parsedTables, input);
  const base = parsedTables.find((table) => table.headers[1] === "Base Input Tokens");
  const batch = parsedTables.find((table) => table.headers[1] === "Batch input");
  const fastTables = parsedTables.filter(
    (table) => table.headers.join("|") === "Model|Input|Output",
  );
  const fast = fastTables[0];
  if (
    base === undefined ||
    batch === undefined ||
    fastTables.length !== 1 ||
    fast === undefined ||
    fast.rows.length === 0
  )
    throw new Error("Anthropic pricing page omitted a reviewed price table");

  for (const values of base.rows) {
    const item = resolve(values[0] ?? "");
    const parsed = fivePricesSchema.safeParse(values.slice(1).map(amount));
    if (!parsed.success)
      throw new Error(`Anthropic base pricing was not machine-readable for ${item.model_id}`);
    const [inputPrice, fiveMinuteWrite, oneHourWrite, cacheRead, outputPrice] = parsed.data;
    const conditions = effective(values[0] ?? "");
    const rate = (
      meter: SourcePriceFact["meter"],
      value: string,
      cacheTtlSeconds?: number,
    ): SourcePriceFact =>
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
    const expectedFiveMinuteWrite = multiplyDecimal(inputPrice, multipliers.fiveMinuteWrite);
    const expectedOneHourWrite = multiplyDecimal(inputPrice, multipliers.oneHourWrite);
    const expectedCacheRead = multiplyDecimal(inputPrice, multipliers.read);
    if (
      !decimalsEqual(fiveMinuteWrite, expectedFiveMinuteWrite) ||
      !decimalsEqual(oneHourWrite, expectedOneHourWrite) ||
      !decimalsEqual(cacheRead, expectedCacheRead)
    )
      throw new Error(
        `Anthropic cache prices disagreed with published multipliers for ${item.model_id}`,
      );
    input.onPricingReconciliation?.({
      disposition: "normalized",
      reason_code: "base_model_price_row",
    });
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
      ...cached(inputRate, multipliers),
      publishedRate(
        "output_text",
        outputPrice,
        "million_tokens",
        input.source.id,
        "MTok",
        conditions,
      ),
    ]);
    input.onPricingReconciliation?.({
      disposition: "normalized",
      reason_code: "batch_model_price_row",
    });
    item.capabilities.batch = true;
  }

  for (const values of fast.rows) {
    const inputPrice = amount(values[1]);
    const outputPrice = amount(values[2]);
    if (inputPrice === undefined || outputPrice === undefined)
      throw new Error(`Anthropic fast pricing was not machine-readable for ${values[0] ?? ""}`);
    const names = (values[0] ?? "").split(/\s+\/\s+/).filter(Boolean);
    if (names.length === 0) throw new Error("Anthropic fast pricing omitted its model");
    const fastIds = new Set<string>();
    for (const name of names) {
      const item = resolve(name);
      fastIds.add(item.model_id);
      const conditions = { speed: "fast" };
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
        ...cached(inputRate, multipliers),
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
    validateFastMode(fastModeBody, fastIds);
    input.onPricingReconciliation?.({
      disposition: "normalized",
      reason_code: "fast_model_price_row",
    });
  }

  const tools = parsedTables.find((table) => table.headers.includes("Tool choice"));
  if (tools === undefined) throw new Error("Anthropic pricing page omitted tool support");
  for (const values of tools.rows) {
    resolve(values[0] ?? "").capabilities.tool_call = true;
    input.onPricingReconciliation?.({
      disposition: "excluded",
      reason_code: "token_overhead_included_in_usage",
      ...(values[0] === undefined ? {} : { sample: values[0] }),
    });
  }

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

  const inferenceGeoMultiplier = body.match(
    /incurs a ((?:0|[1-9]\d*)(?:\.\d+)?)x multiplier on all token pricing categories/,
  )?.[1];
  if (inferenceGeoMultiplier === undefined)
    throw new Error("Anthropic pricing page omitted the inference geography multiplier");
  const pricingGeneration = geographyGeneration(body, "pricing");
  if (
    pricingGeneration.major !== dataResidencyGeneration.major ||
    pricingGeneration.minor !== dataResidencyGeneration.minor
  )
    throw new Error("Anthropic pricing and data-residency generation thresholds disagreed");
  for (const item of models.values()) {
    if (!atLeastGeneration(item.model_id, pricingGeneration)) continue;
    item.price_facts.push(
      ...item.price_facts.map(
        (rate): SourcePriceFact => ({
          ...rate,
          price: multiplyDecimal(rate.price, inferenceGeoMultiplier),
          conditions: { ...rate.conditions, inference_geo: "us" },
          derived: true,
          derivation: `${inferenceGeoMultiplier} × ${rate.derivation ?? "published rate"} for US-only inference`,
          raw_price: undefined,
          raw_unit: "published inference geography multiplier",
        }),
      ),
    );
  }
  input.onPricingReconciliation?.({
    disposition: "normalized",
    reason_code: "inference_geo_multiplier_applied",
  });
  reconcileExcludedPricing(body, input);
}

export function parseAnthropicCatalog(input: Input): ProviderModel[] {
  const bundle = linkedBundleSchema.parse(json(input.body));
  const document = (path: string): string =>
    linkedDocumentBody(bundle, path, `Anthropic catalog expected exactly one document: ${path}`);
  const messagesBody = document("/docs/en/api/messages/create.md");
  validateDocumentationIndex(document("/llms.txt"), input);
  validateModelIdentityContract(
    document("/docs/en/about-claude/models/model-ids-and-versions.md"),
    document("/docs/en/api/models/list.md"),
  );
  const dataResidencyGeneration = validateAccountingContracts(
    {
      messages: messagesBody,
      serviceTiers: document("/docs/en/api/service-tiers.md"),
      dataResidency: document("/docs/en/manage-claude/data-residency.md"),
      usageCost: document("/docs/en/manage-claude/usage-cost-api.md"),
      usageReport: document("/docs/en/api/admin/usage_report/retrieve_messages.md"),
      costReport: document("/docs/en/api/admin/cost_report/retrieve.md"),
      fallbackCredit: document("/docs/en/build-with-claude/fallback-credit.md"),
    },
    input,
  );
  const models = new Map<string, ProviderModel>();
  overview(bundle.index.body, input, models);
  lifecycle(document("/docs/en/about-claude/model-deprecations.md"), input, models);
  releaseNotes(document("/docs/en/release-notes/overview.md"), input, models);
  pricing(
    document("/docs/en/about-claude/pricing.md"),
    document("/docs/en/build-with-claude/fast-mode.md"),
    dataResidencyGeneration,
    input,
    models,
  );
  applyEndpoints(
    messagesBody,
    document("/docs/en/api/messages/batches/create.md"),
    document("/docs/en/build-with-claude/batch-processing.md"),
    models,
  );
  capabilities(
    {
      citations: document("/docs/en/build-with-claude/citations.md"),
      pdf: document("/docs/en/build-with-claude/pdf-support.md"),
      contextEditing: document("/docs/en/build-with-claude/context-editing.md"),
      structuredOutputs: document("/docs/en/build-with-claude/structured-outputs.md"),
      codeExecution: document("/docs/en/agents-and-tools/tool-use/code-execution-tool.md"),
      computerUse: document("/docs/en/agents-and-tools/tool-use/computer-use-tool.md"),
      effort: document("/docs/en/build-with-claude/effort.md"),
      promptCaching: document("/docs/en/build-with-claude/prompt-caching.md"),
      glossary: document("/docs/en/about-claude/glossary.md"),
      thinking: document("/docs/en/build-with-claude/thinking.md"),
      toolUse: document("/docs/en/agents-and-tools/tool-use/define-tools.md"),
    },
    models,
  );
  return [...models.values()].sort((left, right) => left.uid.localeCompare(right.uid));
}

export function parseAnthropicApi(input: Input): ProviderModel[] {
  const parsed = listSchema.parse(json(input.body));
  if (parsed.has_more)
    throw new Error("Anthropic model API pagination exceeded the reviewed limit");
  assertItemCount("Anthropic model API", parsed.data.length, 1, undefined, ["data"]);
  const items = recognizeItems({
    label: "Anthropic model",
    items: parsed.data,
    schema: itemSchema,
    modelId: "id",
  });
  return items.map((item) => {
    const inputModalities: Modality[] = ["text"];
    if (item.capabilities.image_input.supported) inputModalities.push("image");
    if (item.capabilities.pdf_input.supported) inputModalities.push("pdf");
    return {
      ...baseModel({
        providerId: input.provider.id,
        id: item.id,
        name: item.display_name,
        sourceId: input.source.id,
        observedAt: input.observedAt,
      }),
      tasks: ["text_generation"],
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
    } satisfies ProviderModel;
  });
}
