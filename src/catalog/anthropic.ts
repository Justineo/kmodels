import { z } from "zod";
import { linkedBundleSchema, linkedDocumentBody } from "./bundle.ts";
import { modelIdSchema } from "./identity.ts";
import type { SourceManifest } from "./manifests.ts";
import { baseModel } from "./model.ts";
import { decimalsEqual, multiplyDecimal, publishedRate } from "./pricing.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import type {
  ParsedProviderModel as ProviderModel,
  SourceCommercialPricingFact,
  SourcePriceFact,
} from "./pricing-source.ts";
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

function tableDate(value: string, field: string, input: Input): string | undefined {
  if (value === "N/A" || value.startsWith("Not sooner than ")) return undefined;
  const parsed = date(value);
  if (parsed === undefined) {
    input.onPricingReconciliation?.({
      disposition: "unresolved",
      reason_code: "lifecycle_date_invalid",
      sample: `${field}: ${value}`,
    });
    return;
  }
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

function launchDetails(body: string, input: Input, models: Map<string, ProviderModel>): void {
  const table = tables(body).find(
    (candidate) => candidate.headers.join("|") === "Model|API model ID|Description",
  );
  if (table === undefined || table.rows.length === 0)
    throw new Error("Anthropic launch page omitted its model table");
  const releaseDate = date(
    body.match(/become available on ([A-Z][a-z]+ \d{1,2}, \d{4})/)?.[1] ?? "",
  );
  if (releaseDate === undefined) throw new Error("Anthropic launch page omitted its release date");
  for (const values of table.rows) {
    const id = values[1];
    if (id === undefined || !modelIdSchema.safeParse(id).success) continue;
    const item = model(models, input, id);
    item.name = values[0] || item.name;
    item.description = values[2] || item.description;
    if (item.release_date !== undefined && item.release_date !== releaseDate) {
      delete item.release_date;
      input.onPricingReconciliation?.({
        disposition: "unresolved",
        reason_code: "release_date_conflict",
        sample: item.model_id,
      });
    } else item.release_date = releaseDate;
  }
}

function releaseNotes(body: string, input: Input, models: Map<string, ProviderModel>): void {
  let currentDate: string | undefined;
  let launches = 0;
  const conflicts = new Set<string>();
  for (const line of body.split(/\r?\n/)) {
    const heading = line.match(/^### (.+)$/)?.[1];
    if (heading !== undefined) currentDate = date(heading);
    const subject = line.match(/^[*-] We've launched (.+)$/)?.[1];
    if (subject === undefined) continue;
    const opening = text(subject.split(",", 1)[0] ?? "");
    if (!/^Claude (?:Fable|Mythos|Opus|Sonnet|Haiku|\d)\b/.test(opening)) continue;
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
    for (const item of mentioned(opening, models)) targets.set(item.model_id, item);
    for (const item of targets.values()) {
      if (conflicts.has(item.model_id)) continue;
      if (item.release_date !== undefined && item.release_date !== currentDate) {
        delete item.release_date;
        conflicts.add(item.model_id);
        input.onPricingReconciliation?.({
          disposition: "unresolved",
          reason_code: "release_date_conflict",
          sample: item.model_id,
        });
      } else item.release_date = currentDate;
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
    const deprecatedAt = tableDate(values[2] ?? "", "deprecation date", input);
    if (deprecatedAt !== undefined) item.deprecated_at = deprecatedAt;
    const retiredAt = tableDate(values[3] ?? "", "retirement date", input);
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
      const retiredAt = tableDate(values[0] ?? "", "historical retirement date", input);
      if (retiredAt === undefined) continue;
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
    if (retiredAt === undefined) {
      input.onPricingReconciliation?.({
        disposition: "unresolved",
        reason_code: "lifecycle_date_invalid",
        sample: `inline retirement date: ${match[2]}`,
      });
      continue;
    }
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
  input: Input,
): void {
  const endpoint = (body: string, expected: { name: string; path: string }): boolean => {
    try {
      validateEndpoint(body, expected);
      return true;
    } catch {
      input.onPricingReconciliation?.({
        disposition: "unresolved",
        reason_code: "operation_contract_drift",
        sample: expected.path,
      });
      return false;
    }
  };
  const messages = endpoint(messagesBody, messagesEndpoint);
  const batches = endpoint(batchesBody, batchEndpoint);
  const streaming =
    messages &&
    /- `stream: optional boolean`\r?\n\r?\n\s+Whether to incrementally stream the response using server-sent events\./.test(
      messagesBody,
    );
  const toolUse =
    messages &&
    /- `tools: optional array of ToolUnion`[\s\S]*?Definitions of tools that the model may use\.[\s\S]*?may return `tool_use` content blocks/.test(
      messagesBody,
    );
  const batchCoverage =
    batches &&
    /^All \[active models]\([^)]*\) support the Message Batches API\.$/m.test(batchGuide);
  for (const [claim, valid] of [
    ["Messages streaming", streaming],
    ["Messages tool use", toolUse],
    ["Message Batches coverage", batchCoverage],
  ] as const)
    if (!valid)
      input.onPricingReconciliation?.({
        disposition: "unresolved",
        reason_code: "operation_claim_drift",
        sample: claim,
      });
  for (const item of models.values()) {
    if (item.status === "active") {
      item.api_endpoints = [
        ...(messages ? [messagesEndpoint] : []),
        ...(batchCoverage ? [batchEndpoint] : []),
      ];
      item.capabilities.batch = batchCoverage ? true : "unknown";
      item.capabilities.streaming = streaming ? true : "unknown";
      item.capabilities.tool_call = toolUse ? true : "unknown";
    } else if (item.status === "legacy" || item.status === "deprecated") {
      item.api_endpoints = messages ? [messagesEndpoint] : [];
      item.capabilities.batch = false;
      item.capabilities.streaming = streaming ? true : "unknown";
      item.capabilities.tool_call = toolUse ? true : "unknown";
    }
    if (item.api_endpoints?.length === 0) delete item.api_endpoints;
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

function listedModels(
  body: string,
  models: Map<string, ProviderModel>,
  capability: string,
  input: Input,
): ProviderModel[] | undefined {
  const list = body
    .split(/\r?\n/)
    .find((line) => line.startsWith("- Supported models:"))
    ?.match(/^- Supported models: (`[^`]+`(?:, `[^`]+`)*)$/)?.[1];
  if (list === undefined) {
    input.onPricingReconciliation?.({
      disposition: "unresolved",
      reason_code: "capability_contract_drift",
      sample: capability,
    });
    return;
  }
  const ids = [...list.matchAll(/`([^`]+)`/g)].map((match) => modelIdSchema.parse(match[1]));
  if (ids.length === 0 || new Set(ids).size !== ids.length) {
    input.onPricingReconciliation?.({
      disposition: "unresolved",
      reason_code: "capability_contract_drift",
      sample: capability,
    });
    return;
  }
  return ids.flatMap((id) => {
    const item = commercialModel(models, id);
    if (item !== undefined) return [item];
    input.onPricingReconciliation?.({
      disposition: "unbound",
      reason_code: "capability_model_unbound",
      sample: `${capability}: ${id}`,
    });
    return [];
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
  input: Input,
): void {
  const current = [...models.values()].filter(({ status }) => status === "active");
  const supported = [...models.values()].filter(callable);
  const drift = (claim: string): void =>
    input.onPricingReconciliation?.({
      disposition: "unresolved",
      reason_code: "capability_contract_drift",
      sample: claim,
    });

  if (/^All \[active models]\([^)]*\) support citations\.$/m.test(bodies.citations))
    for (const item of current) item.capabilities.citations = true;
  else drift("citations");

  if (/All \[active models]\([^)]*\) support PDF processing\./.test(bodies.pdf))
    for (const item of current)
      item.modalities.input = [...new Set<Modality>([...item.modalities.input, "pdf"])];
  else drift("PDF input");

  if (
    /^Context editing is available on all supported Claude models\.$/m.test(bodies.contextEditing)
  )
    for (const item of supported) item.capabilities.context_management = true;
  else drift("context editing");

  const structured = listedModels(bodies.structuredOutputs, models, "structured-output", input);
  if (structured !== undefined) {
    const structuredSet = new Set(structured);
    for (const item of supported) item.capabilities.structured_output = structuredSet.has(item);
  }

  const codeTable = tables(bodies.codeExecution).find(
    (table) => table.headers.join("|") === "Model|Tool versions",
  );
  if (codeTable === undefined || codeTable.rows.length === 0) drift("code execution");
  else {
    for (const item of supported) item.capabilities.code_execution = false;
    const resolve = resolver(models);
    for (const values of codeTable.rows) {
      try {
        const item = resolve(values[0] ?? "");
        if (callable(item)) item.capabilities.code_execution = true;
      } catch {
        input.onPricingReconciliation?.({
          disposition: "unbound",
          reason_code: "capability_model_unbound",
          sample: `code execution: ${values[0] ?? "unknown"}`,
        });
      }
    }
  }
  const previewCode = bodies.codeExecution
    .split(/\r?\n/)
    .find((line) => line.includes("code execution is supported on the Claude API"));
  const previewCodeModels = previewCode === undefined ? [] : mentioned(previewCode, models);
  if (previewCodeModels.length === 0) drift("code execution exception");
  else
    for (const item of previewCodeModels)
      if (callable(item)) item.capabilities.code_execution = true;

  const listedComputer = listedModels(bodies.computerUse, models, "computer-use", input);
  if (listedComputer !== undefined) {
    const computerModels = new Set([
      ...listedComputer,
      ...mentioned(bodies.computerUse.match(/<Note>([\s\S]*?)<\/Note>/)?.[1] ?? "", models),
    ]);
    for (const item of supported) item.capabilities.computer_use = false;
    for (const item of computerModels) if (callable(item)) item.capabilities.computer_use = true;
  }

  const effortModels = listedModels(bodies.effort, models, "effort", input);
  if (effortModels !== undefined) {
    for (const item of supported) item.capabilities.effort_control = false;
    for (const item of effortModels) if (callable(item)) item.capabilities.effort_control = true;
  }

  if (
    /^Prompt caching \(both automatic and explicit\) is supported on all \[active Claude models]\([^)]*\)\.$/m.test(
      bodies.promptCaching,
    )
  )
    for (const item of current) item.capabilities.prompt_cache = true;
  else drift("prompt caching");

  if (/The Claude API does not currently offer fine-tuning/.test(bodies.glossary))
    for (const item of supported) item.capabilities.fine_tuning = false;
  else drift("fine tuning");

  const thinkingLine = bodies.thinking
    .split(/\r?\n/)
    .find((line) => line.includes("thinking cannot be turned off on these models"));
  const thinkingModels = thinkingLine === undefined ? [] : mentioned(thinkingLine, models);
  if (thinkingModels.length === 0) drift("thinking");
  else for (const item of thinkingModels) if (callable(item)) item.capabilities.reasoning = true;

  const toolLine = bodies.toolUse
    .split(/\r?\n/)
    .find((line) => line.includes("does not support forced tool use"));
  const toolModels = toolLine === undefined ? [] : mentioned(toolLine, models);
  if (toolModels.length === 0) drift("tool use");
  else for (const item of toolModels) if (callable(item)) item.capabilities.tool_call = true;
}

function validateDocumentationIndex(body: string, input: Input): void {
  if (!body.startsWith("# Anthropic Developer Documentation")) {
    input.onPricingReconciliation?.({
      disposition: "unresolved",
      reason_code: "documentation_index_drift",
      sample: "llms.txt heading",
    });
    return;
  }
  const indexedPaths = new Set(
    [...body.matchAll(/https:\/\/platform\.claude\.com(\/docs\/en\/[^)\s]+\.md)/g)].flatMap(
      (match) => (match[1] === undefined ? [] : [match[1]]),
    ),
  );
  const configured = input.source.linkedDocuments?.documents;
  if (configured === undefined) throw new Error("Anthropic documentation bundle is not fixed");
  const configuredPaths = new Set<string>();
  for (const { url } of configured) {
    const parsed = new URL(url);
    if (parsed.hostname !== "platform.claude.com") continue;
    const path = parsed.pathname;
    if (path === "/llms.txt") continue;
    configuredPaths.add(path);
    if (!indexedPaths.has(path))
      input.onPricingReconciliation?.({
        disposition: "unresolved",
        reason_code: "documentation_index_omission",
        sample: path,
      });
  }
  for (const path of indexedPaths)
    if (
      !configuredPaths.has(path) &&
      /(?:pricing|billing|cost|usage|service-tier|managed-agents|fallback)/.test(path)
    )
      input.onPricingReconciliation?.({
        disposition: "unresolved",
        reason_code: "unreviewed_commercial_source",
        sample: path,
      });
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

function reviewedGeographyGeneration(
  body: string,
  label: string,
  input: Input,
): ModelGeneration | undefined {
  try {
    return geographyGeneration(body, label);
  } catch {
    input.onPricingReconciliation?.({
      disposition: "unresolved",
      reason_code: "inference_geo_contract_drift",
      sample: label,
    });
    return;
  }
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
): ModelGeneration | undefined {
  const contract = (valid: boolean, sample: string): boolean => {
    if (!valid)
      input.onPricingReconciliation?.({
        disposition: "unresolved",
        reason_code: "accounting_contract_drift",
        sample,
      });
    return valid;
  };
  for (const field of [
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
    "inference_geo",
    "input_tokens",
    "output_tokens",
    "server_tool_use",
    "service_tier",
  ])
    contract(bodies.messages.includes(`- \`${field}:`), `Messages usage.${field}`);

  const serviceTierContract = contract(
    bodies.serviceTiers.includes('`"auto"` (default)') &&
      bodies.serviceTiers.includes('`"standard_only"`') &&
      bodies.serviceTiers.includes('"service_tier": "priority"') &&
      bodies.serviceTiers.includes(
        "Requests beyond your committed capacity automatically fall back to standard tier",
      ),
    "service-tier outcomes",
  );
  if (serviceTierContract)
    input.onPricingReconciliation?.({
      disposition: "excluded",
      reason_code: "account_specific_service_tier",
      sample: "Priority Tier contract pricing",
    });

  const dataResidencyGeneration = reviewedGeographyGeneration(
    bodies.dataResidency,
    "data-residency",
    input,
  );
  contract(
    bodies.dataResidency.includes(
      "The response `usage` object includes an `inference_geo` field",
    ) &&
      bodies.dataResidency.includes("`allowed_inference_geos`") &&
      bodies.dataResidency.includes("`default_inference_geo`") &&
      bodies.dataResidency.includes("return a 400 error"),
    "inference-geography outcomes",
  );

  try {
    validateEndpoint(
      bodies.usageReport,
      { name: "Get Messages Usage Report", path: "v1/organizations/usage_report/messages" },
      "get",
    );
  } catch {
    contract(false, "Usage API endpoint");
  }
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
    contract(bodies.usageReport.includes(field), `Usage API ${field}`);

  try {
    validateEndpoint(
      bodies.costReport,
      { name: "Get Cost Report", path: "v1/organizations/cost_report" },
      "get",
    );
  } catch {
    contract(false, "Cost API endpoint");
  }
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
    contract(bodies.costReport.includes(field), `Cost API ${field}`);

  contract(
    bodies.usageCost.includes("Usage and cost data typically appears within 5 minutes") &&
      bodies.usageCost.includes("Priority Tier costs are not available in the cost endpoint") &&
      bodies.usageCost.includes("Admin API key required"),
    "Usage and Cost API boundary",
  );

  contract(
    bodies.fallbackCredit.includes("fallback_credit_token") &&
      bodies.fallbackCredit.includes("Refusals in [Message Batches]") &&
      bodies.fallbackCredit.includes("`cache_creation_input_tokens` is lower") &&
      bodies.fallbackCredit.includes("organization and workspace that received the refusal"),
    "fallback credit",
  );
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

function reconcileCommercialBoundaries(body: string, input: Input): void {
  const ccuRates = body.match(/\$0\.01 per CCU \(fixed;/g)?.length ?? 0;
  if (ccuRates !== 2)
    input.onPricingReconciliation?.({
      disposition: "unresolved",
      reason_code: "marketplace_settlement_drift",
      sample: "Claude Consumption Units",
    });
  else {
    input.onPricingReconciliation?.({
      disposition: "normalized",
      reason_code: "marketplace_settlement_bound",
      sample: "Claude Platform on AWS CCU",
    });
    input.onPricingReconciliation?.({
      disposition: "excluded",
      reason_code: "external_provider_partition",
      sample: "Claude in Microsoft Foundry CCU",
    });
  }
  if (!/Volume discounts may be available[\s\S]*?negotiated on a case-by-case basis/.test(body))
    input.onPricingReconciliation?.({
      disposition: "unresolved",
      reason_code: "account_discount_boundary_drift",
      sample: "Negotiated volume discount",
    });
  else
    input.onPricingReconciliation?.({
      disposition: "excluded",
      reason_code: "account_specific_discount",
      sample: "Negotiated volume discount",
    });
}

function pricing(
  body: string,
  fastModeBody: string,
  dataResidencyGeneration: ModelGeneration | undefined,
  input: Input,
  models: Map<string, ProviderModel>,
): void {
  const resolve = resolver(models);
  const resolveRow = (value: string, claim: string): ProviderModel | undefined => {
    try {
      return resolve(value);
    } catch {
      input.onPricingReconciliation?.({
        disposition: "unbound",
        reason_code: "pricing_model_unbound",
        sample: `${claim}: ${label(value)}`,
      });
      return;
    }
  };
  const add = (item: ProviderModel, rates: SourcePriceFact[]): void => {
    item.price_facts.push(...rates);
    item.pricing_state = "numeric";
  };
  const parsedTables = tables(body);
  let multipliers: CacheMultipliers | undefined;
  try {
    multipliers = cacheMultipliers(parsedTables, input);
  } catch {
    input.onPricingReconciliation?.({
      disposition: "unresolved",
      reason_code: "cache_multiplier_drift",
      sample: "Prompt caching multipliers",
    });
  }
  const base = parsedTables.find((table) => table.headers[1] === "Base Input Tokens");
  const batch = parsedTables.find((table) => table.headers[1] === "Batch input");
  const fastTables = parsedTables.filter(
    (table) => table.headers.join("|") === "Model|Input|Output",
  );
  const fast = fastTables[0];
  for (const [claim, valid] of [
    ["base model prices", base !== undefined],
    ["Batch prices", batch !== undefined],
    ["Fast prices", fastTables.length === 1 && fast !== undefined && fast.rows.length > 0],
  ] as const)
    if (!valid)
      input.onPricingReconciliation?.({
        disposition: "unresolved",
        reason_code: "pricing_table_drift",
        sample: claim,
      });

  for (const values of base?.rows ?? []) {
    const item = resolveRow(values[0] ?? "", "base pricing");
    if (item === undefined) continue;
    const parsed = fivePricesSchema.safeParse(values.slice(1).map(amount));
    if (!parsed.success) {
      input.onPricingReconciliation?.({
        disposition: "unsupported",
        reason_code: "pricing_row_unreadable",
        sample: item.model_id,
      });
      continue;
    }
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
    if (multipliers !== undefined) {
      const expectedFiveMinuteWrite = multiplyDecimal(inputPrice, multipliers.fiveMinuteWrite);
      const expectedOneHourWrite = multiplyDecimal(inputPrice, multipliers.oneHourWrite);
      const expectedCacheRead = multiplyDecimal(inputPrice, multipliers.read);
      if (
        !decimalsEqual(fiveMinuteWrite, expectedFiveMinuteWrite) ||
        !decimalsEqual(oneHourWrite, expectedOneHourWrite) ||
        !decimalsEqual(cacheRead, expectedCacheRead)
      )
        input.onPricingReconciliation?.({
          disposition: "unresolved",
          reason_code: "cache_price_conflict",
          sample: item.model_id,
        });
    }
    input.onPricingReconciliation?.({
      disposition: "normalized",
      reason_code: "base_model_price_row",
    });
    item.capabilities.prompt_cache = true;
  }

  for (const values of batch?.rows ?? []) {
    const item = resolveRow(values[0] ?? "", "Batch pricing");
    if (item === undefined) continue;
    const inputPrice = amount(values[1]);
    const outputPrice = amount(values[2]);
    if (inputPrice === undefined || outputPrice === undefined) {
      input.onPricingReconciliation?.({
        disposition: "unsupported",
        reason_code: "pricing_row_unreadable",
        sample: `Batch: ${item.model_id}`,
      });
      continue;
    }
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
      ...(multipliers === undefined ? [] : cached(inputRate, multipliers)),
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

  for (const values of fast?.rows ?? []) {
    const inputPrice = amount(values[1]);
    const outputPrice = amount(values[2]);
    if (inputPrice === undefined || outputPrice === undefined) {
      input.onPricingReconciliation?.({
        disposition: "unsupported",
        reason_code: "pricing_row_unreadable",
        sample: `Fast: ${values[0] ?? "unknown"}`,
      });
      continue;
    }
    const names = (values[0] ?? "").split(/\s+\/\s+/).filter(Boolean);
    if (names.length === 0) {
      input.onPricingReconciliation?.({
        disposition: "unbound",
        reason_code: "pricing_model_unbound",
        sample: "Fast pricing",
      });
      continue;
    }
    const fastIds = new Set<string>();
    for (const name of names) {
      const item = resolveRow(name, "Fast pricing");
      if (item === undefined) continue;
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
        ...(multipliers === undefined ? [] : cached(inputRate, multipliers)),
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
    try {
      validateFastMode(fastModeBody, fastIds);
    } catch {
      input.onPricingReconciliation?.({
        disposition: "unresolved",
        reason_code: "fast_compatibility_conflict",
        sample: [...fastIds].join(", "),
      });
    }
    input.onPricingReconciliation?.({
      disposition: "normalized",
      reason_code: "fast_model_price_row",
    });
  }

  const tools = parsedTables.find((table) => table.headers.includes("Tool choice"));
  if (tools === undefined)
    input.onPricingReconciliation?.({
      disposition: "unresolved",
      reason_code: "tool_overhead_table_drift",
      sample: "Tool use system prompt token count",
    });
  for (const values of tools?.rows ?? []) {
    const item = resolveRow(values[0] ?? "", "tool overhead");
    if (item === undefined) continue;
    item.capabilities.tool_call = true;
    input.onPricingReconciliation?.({
      disposition: "excluded",
      reason_code: "token_overhead_included_in_usage",
      ...(values[0] === undefined ? {} : { sample: values[0] }),
    });
  }

  const longContext = body.match(/^(.+?) include the full \[1M token context window]/m)?.[1];
  if (longContext === undefined)
    input.onPricingReconciliation?.({
      disposition: "unresolved",
      reason_code: "long_context_contract_drift",
      sample: "1M context pricing",
    });
  else {
    const longContextModels = text(longContext);
    for (const item of models.values())
      if (
        longContextModels.includes(item.name) ||
        longContextModels.includes(item.name.replace(/^Claude /, ""))
      )
        item.limits.context_tokens = 1_000_000;
  }

  const inferenceGeoMultiplier = body.match(
    /incurs a ((?:0|[1-9]\d*)(?:\.\d+)?)x multiplier on all token pricing categories/,
  )?.[1];
  if (inferenceGeoMultiplier === undefined) {
    input.onPricingReconciliation?.({
      disposition: "unresolved",
      reason_code: "inference_geo_multiplier_drift",
      sample: "US inference multiplier",
    });
    reconcileCommercialBoundaries(body, input);
    return;
  }
  const pricingGeneration = reviewedGeographyGeneration(body, "pricing", input);
  const matchingGeneration =
    pricingGeneration !== undefined &&
    dataResidencyGeneration !== undefined &&
    pricingGeneration.major === dataResidencyGeneration.major &&
    pricingGeneration.minor === dataResidencyGeneration.minor;
  if (!matchingGeneration)
    input.onPricingReconciliation?.({
      disposition: "unresolved",
      reason_code: "inference_geo_eligibility_conflict",
      sample: "pricing and data-residency generation thresholds",
    });
  else {
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
  }
  reconcileCommercialBoundaries(body, input);
}

function commercialRaw(
  termKey: string,
  impact: SourceCommercialPricingFact["raw_price_facts"][number]["impact"],
  reason: SourceCommercialPricingFact["raw_price_facts"][number]["reason"],
  fragment: string,
  sourceId: string,
): SourceCommercialPricingFact["raw_price_facts"][number] {
  return {
    term_key: termKey,
    impact,
    reason,
    conditions: {},
    source_ref: sourceId,
    raw: { fragment },
  };
}

interface CommercialFactInput {
  bookKey: string;
  bookName: string;
  resourceKind?: SourceCommercialPricingFact["resource_kind"];
  resourceKey: string;
  modelRefs?: string[];
  offerKey: string;
  offerName: string;
  billingMode?: SourceCommercialPricingFact["billing_mode"];
  state: SourceCommercialPricingFact["pricing_state"];
  rates?: SourcePriceFact[];
  raw?: SourceCommercialPricingFact["raw_price_facts"];
}

function commercialFact(sourceId: string, value: CommercialFactInput): SourceCommercialPricingFact {
  return {
    source_ref: sourceId,
    book_key: value.bookKey,
    book_name: value.bookName,
    resource_kind: value.resourceKind ?? "service",
    resource_key: value.resourceKey,
    model_refs: value.modelRefs ?? [],
    offer_key: value.offerKey,
    offer_name: value.offerName,
    billing_mode: value.billingMode ?? "usage",
    pricing_state: value.state,
    price_facts: value.rates ?? [],
    raw_price_facts: value.raw ?? [],
  };
}

function commercialModel(
  models: Map<string, ProviderModel>,
  value: string,
): ProviderModel | undefined {
  const direct = models.get(value);
  if (direct !== undefined) return direct;
  const matches = [...models.values()].filter(
    ({ aliases, model_id }) => model_id === value || aliases.includes(value),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function ids(value: string): string[] {
  return [...value.matchAll(/claude-[a-z0-9._:/-]+/g)].flatMap((match) =>
    match[0] === undefined ? [] : [match[0]],
  );
}

function commercialPricing(
  bodies: {
    pricing: string;
    currentPricing: string;
    webSearch: string;
    webFetch: string;
    codeExecution: string;
    advisor: string;
    compaction: string;
    tokenCounting: string;
    files: string;
    managedAgents: string;
    managedAgentCreate: string;
    managedAgentEvents: string;
    serviceTiers: string;
    fallbackCredit: string;
  },
  input: Input,
  models: Map<string, ProviderModel>,
): void {
  const facts: SourceCommercialPricingFact[] = [];
  const callableModels = [...models.values()].filter(callable);
  const activeModels = callableModels.filter(({ status }) => status === "active");
  const callableRefs = callableModels.map(({ uid }) => uid);
  const batchRefs = activeModels
    .filter(({ capabilities }) => capabilities.batch === true)
    .map(({ uid }) => uid);
  const endpointFacts = (
    value: Omit<CommercialFactInput, "modelRefs" | "offerKey" | "offerName">,
    names: { sync: string; batch: string },
  ): SourceCommercialPricingFact[] => [
    commercialFact(input.source.id, {
      ...value,
      modelRefs: callableRefs,
      offerKey: "sync",
      offerName: names.sync,
    }),
    ...(batchRefs.length === 0
      ? []
      : [
          commercialFact(input.source.id, {
            ...value,
            modelRefs: batchRefs,
            offerKey: "batch",
            offerName: names.batch,
          }),
        ]),
  ];
  const report = (normalized: boolean, reasonCode: string, sample: string): void =>
    input.onPricingReconciliation?.({
      disposition: normalized ? "normalized" : "unresolved",
      reason_code: reasonCode,
      sample,
    });

  const compaction = bodies.compaction.replace(/\s+/g, " ");
  const compactionBilling =
    compaction.includes("Compaction requires an additional sampling step") &&
    compaction.includes("sum across all entries in the `usage.iterations` array") &&
    compaction.includes(
      "top-level `input_tokens` and `output_tokens` do not include compaction iteration usage",
    ) &&
    compaction.includes(
      "Re-applying a previous `compaction` block incurs no additional compaction cost",
    );
  report(compactionBilling, "compaction_usage_bound", "Compaction iterations");

  const searchAmount = bodies.webSearch.match(
    /\$((?:0|[1-9]\d*)(?:\.\d+)?) per 1,000 searches/,
  )?.[1];
  const searchSignal = bodies.webSearch.includes('"web_search_requests"');
  if (searchAmount !== undefined) {
    const rate = publishedRate(
      "web_search",
      searchAmount,
      "thousand_events",
      input.source.id,
      "per 1,000 successful searches",
    );
    rate.source_locator = {
      kind: "fragment",
      value: "/docs/en/agents-and-tools/tool-use/web-search-tool.md#usage-and-pricing",
    };
    facts.push(
      ...endpointFacts(
        {
          bookKey: "service:web-search",
          bookName: "Web Search",
          resourceKey: "web-search",
          state: "numeric",
          rates: [rate],
          raw: searchSignal
            ? [
                commercialRaw(
                  "usage-signal",
                  "informational",
                  "unsupported_structure",
                  "usage.server_tool_use.web_search_requests",
                  input.source.id,
                ),
              ]
            : [],
        },
        { sync: "Web Search", batch: "Batch Web Search" },
      ),
    );
  }
  report(searchAmount !== undefined, "web_search_service_bound", "Web Search rate");
  report(searchSignal, "web_search_usage_bound", "Web Search usage signal");

  const fetchIncluded = /no additional charges beyond standard token costs/i.test(bodies.webFetch);
  const fetchSignal = bodies.webFetch.includes('"web_fetch_requests"');
  if (fetchIncluded)
    facts.push(
      ...endpointFacts(
        {
          bookKey: "service:web-fetch",
          bookName: "Web Fetch",
          resourceKey: "web-fetch",
          state: "included",
        },
        { sync: "Web Fetch", batch: "Batch Web Fetch" },
      ),
    );
  report(fetchIncluded, "web_fetch_service_bound", "Web Fetch service");
  report(fetchSignal, "web_fetch_usage_bound", "Web Fetch usage signal");

  const codeTable = tables(bodies.codeExecution).find(
    (table) => table.headers.join("|") === "Model|Tool versions",
  );
  const codeIds = new Set<string>();
  const codeRefs = new Set<string>();
  for (const values of codeTable?.rows ?? []) {
    const rawId = ids(values[0] ?? "")[0];
    if (rawId !== undefined) codeIds.add(rawId);
    const item = rawId === undefined ? undefined : commercialModel(models, rawId);
    if (item !== undefined && callable(item)) codeRefs.add(item.uid);
  }
  const codeAmount = bodies.codeExecution.match(
    /\$((?:0|[1-9]\d*)(?:\.\d+)?) USD per hour, per container/,
  )?.[1];
  const minimum = bodies.codeExecution.match(/minimum of (\d+) minutes/)?.[1];
  const monthlyAllowance = bodies.codeExecution.match(
    /([\d,]+) free hours of usage per month/,
  )?.[1];
  const dailyAllowance = bodies.currentPricing.match(
    /((?:0|[1-9]\d*)(?:\.\d+)?) free hours of usage daily per organization/,
  )?.[1];
  const webAssisted =
    bodies.codeExecution.includes(
      "Code execution is free when used with web search or web fetch",
    ) &&
    bodies.codeExecution.includes("web_search_20260209") &&
    bodies.codeExecution.includes("web_fetch_20260209");
  const scope = [...codeRefs];
  const batchScope = scope.filter((ref) => batchRefs.includes(ref));
  if (codeAmount !== undefined && scope.length > 0) {
    const rate = publishedRate(
      "container_runtime",
      codeAmount,
      "hour",
      input.source.id,
      "per container-hour",
    );
    rate.source_locator = {
      kind: "fragment",
      value: "/docs/en/agents-and-tools/tool-use/code-execution-tool.md#usage-and-pricing",
    };
    const raw =
      minimum === undefined
        ? []
        : [
            commercialRaw(
              "minimum-runtime",
              "informational",
              "unsupported_structure",
              `${minimum}-minute minimum execution time`,
              input.source.id,
            ),
          ];
    facts.push(
      commercialFact(input.source.id, {
        bookKey: "service:code-execution",
        bookName: "Code Execution",
        resourceKey: "code-execution",
        modelRefs: scope,
        offerKey: "sync",
        offerName: "Standalone Code Execution",
        state: "numeric",
        rates: [rate],
        raw,
      }),
      ...(batchScope.length === 0
        ? []
        : [
            commercialFact(input.source.id, {
              bookKey: "service:code-execution",
              bookName: "Code Execution",
              resourceKey: "code-execution",
              modelRefs: batchScope,
              offerKey: "batch",
              offerName: "Batch Code Execution",
              state: "numeric",
              rates: [rate],
              raw,
            }),
          ]),
    );
  }
  if (webAssisted && scope.length > 0)
    facts.push(
      commercialFact(input.source.id, {
        bookKey: "service:code-execution",
        bookName: "Code Execution",
        resourceKey: "code-execution",
        modelRefs: scope,
        offerKey: "web-assisted-sync",
        offerName: "Web-assisted Code Execution",
        state: "included",
      }),
      ...(batchScope.length === 0
        ? []
        : [
            commercialFact(input.source.id, {
              bookKey: "service:code-execution",
              bookName: "Code Execution",
              resourceKey: "code-execution",
              modelRefs: batchScope,
              offerKey: "web-assisted-batch",
              offerName: "Web-assisted Batch Code Execution",
              state: "included",
            }),
          ]),
    );
  if ((dailyAllowance !== undefined || monthlyAllowance !== undefined) && scope.length > 0) {
    const allowanceRaw = [
      ...(dailyAllowance === undefined
        ? []
        : [
            commercialRaw(
              "daily-container-allowance",
              "allowance",
              "unsupported_structure",
              `${dailyAllowance} free container-hours per organization per day`,
              input.source.id,
            ),
          ]),
      ...(monthlyAllowance === undefined
        ? []
        : [
            commercialRaw(
              "monthly-container-allowance",
              "allowance",
              dailyAllowance === undefined ? "unsupported_structure" : "superseded_value",
              `${monthlyAllowance.replaceAll(",", "")} free container-hours per organization per month`,
              input.source.id,
            ),
          ]),
    ];
    facts.push(
      commercialFact(input.source.id, {
        bookKey: "service:code-execution",
        bookName: "Code Execution",
        resourceKey: "code-execution",
        modelRefs: scope,
        offerKey: "organization-allowance",
        offerName: "Organization free-hours allowance",
        state: "included",
        raw: allowanceRaw,
      }),
    );
  }
  report(
    codeIds.size > 0 && codeRefs.size === codeIds.size,
    "code_execution_scope_bound",
    "Code Execution model scope",
  );
  report(codeAmount !== undefined, "code_execution_rate_bound", "Code Execution rate");
  report(minimum !== undefined, "code_execution_minimum_bound", "Code Execution minimum");
  report(
    dailyAllowance !== undefined || monthlyAllowance !== undefined,
    "code_execution_allowance_bound",
    "Code Execution allowance",
  );
  report(webAssisted, "code_execution_web_assisted_bound", "Web-assisted Code Execution");

  const advisorTable = tables(bodies.advisor).find(
    (table) => table.headers.join("|") === "Executor models|Advisor models",
  );
  let advisorScopeBound = advisorTable !== undefined;
  const advisorExecutors = new Map<string, Set<string>>();
  for (const values of advisorTable?.rows ?? []) {
    const executorIds = ids(values[0] ?? "");
    const executors = executorIds.flatMap((id) => {
      const item = commercialModel(models, id);
      return item === undefined ? [] : [item.uid];
    });
    if (executors.length !== executorIds.length) advisorScopeBound = false;
    for (const advisorId of ids(values[1] ?? "")) {
      const advisor = commercialModel(models, advisorId);
      if (advisor === undefined) {
        advisorScopeBound = false;
        continue;
      }
      const refs = advisorExecutors.get(advisor.uid) ?? new Set<string>();
      for (const executor of executors) refs.add(executor);
      advisorExecutors.set(advisor.uid, refs);
    }
  }
  const advisorBilling =
    bodies.advisor.includes("separate sub-inference billed at the advisor model's rates") &&
    bodies.advisor.includes("usage.iterations");
  if (advisorBilling)
    for (const [advisorRef, executorRefs] of advisorExecutors) {
      const advisor = models.get(advisorRef.replace(/^anthropic\//, ""));
      const name = advisor?.name ?? advisorRef;
      const raw = [
        commercialRaw(
          "advisor-model-usage",
          "base_price",
          "target_rate_not_normalized",
          `Advisor sub-inference uses ${advisorRef} list rates and usage.iterations`,
          input.source.id,
        ),
      ];
      facts.push(
        commercialFact(input.source.id, {
          bookKey: `service:advisor:${advisorRef}`,
          bookName: `${name} Advisor`,
          resourceKey: `advisor:${advisorRef}`,
          modelRefs: [...executorRefs],
          offerKey: "sync",
          offerName: `${name} advisor sub-inference`,
          state: "included",
          raw,
        }),
        commercialFact(input.source.id, {
          bookKey: `service:advisor:${advisorRef}`,
          bookName: `${name} Advisor`,
          resourceKey: `advisor:${advisorRef}`,
          modelRefs: [...executorRefs].filter((ref) => batchRefs.includes(ref)),
          offerKey: "batch",
          offerName: `${name} Batch advisor sub-inference`,
          state: "included",
          raw,
        }),
      );
    }
  report(
    advisorBilling && advisorScopeBound && advisorExecutors.size > 0,
    "advisor_service_bound",
    "Advisor sub-inference",
  );

  const fallbackTargetIds = ids(
    bodies.fallbackCredit.split(/\r?\n/).find((line) => line.includes("permitted targets are")) ??
      "",
  );
  const fallbackTargets = fallbackTargetIds.flatMap((id) => {
    const item = commercialModel(models, id);
    return item === undefined ? [] : [item.uid];
  });
  const fallbackContract =
    bodies.fallbackCredit.includes("fallback_credit_token") &&
    bodies.fallbackCredit.includes("five-minute window") &&
    bodies.fallbackCredit.includes("cache_creation_input_tokens") &&
    bodies.fallbackCredit.includes("cache_read_input_tokens");
  if (fallbackContract && fallbackTargets.length > 0)
    facts.push(
      commercialFact(input.source.id, {
        bookKey: "account-resource:fallback-credit-token",
        bookName: "Fallback Credit Token",
        resourceKind: "account_resource_template",
        resourceKey: "fallback-credit-token",
        modelRefs: fallbackTargets,
        offerKey: "redemption",
        offerName: "Fallback cache repricing",
        state: "included",
        raw: [
          commercialRaw(
            "fallback-rate-substitution",
            "allowance",
            "unsupported_structure",
            "Eligible cache writes are repriced as cache reads",
            input.source.id,
          ),
          commercialRaw(
            "fallback-credit-lifetime",
            "informational",
            "unsupported_structure",
            "Opaque token is redeemable within five minutes by its originating organization and workspace",
            input.source.id,
          ),
        ],
      }),
    );
  report(
    fallbackContract &&
      fallbackTargetIds.length > 0 &&
      fallbackTargets.length === fallbackTargetIds.length,
    "fallback_credit_bound",
    "Fallback prompt-cache credit",
  );

  const newUserCredits = bodies.pricing.includes(
    "New users receive a small amount of free credits to test the API",
  );
  if (newUserCredits)
    facts.push(
      commercialFact(input.source.id, {
        bookKey: "account-resource:new-user-credit",
        bookName: "New-user API credit",
        resourceKind: "account_resource_template",
        resourceKey: "new-user-credit",
        offerKey: "grant",
        offerName: "New-user credit grant",
        state: "included",
        raw: [
          commercialRaw(
            "credit-amount",
            "allowance",
            "unknown_amount",
            "New users receive an unspecified small amount of free API credits",
            input.source.id,
          ),
        ],
      }),
    );
  report(newUserCredits, "new_user_credit_bound", "New-user API credit");

  const tokenCountingFree = /Token counting is free to use/i.test(bodies.tokenCounting);
  if (tokenCountingFree)
    facts.push(
      commercialFact(input.source.id, {
        bookKey: "service:token-counting",
        bookName: "Token Counting",
        resourceKey: "token-counting",
        modelRefs: activeModels.map(({ uid }) => uid),
        offerKey: "preflight",
        offerName: "Token count estimate",
        state: "free",
      }),
    );
  report(tokenCountingFree, "token_counting_service_bound", "Token Counting");

  const filesFree =
    /Files API operations are free/i.test(bodies.files) &&
    ["Uploading files", "Downloading files", "Listing files", "Deleting files"].every((value) =>
      bodies.files.includes(value),
    );
  if (filesFree)
    facts.push(
      commercialFact(input.source.id, {
        bookKey: "service:files",
        bookName: "Files API",
        resourceKey: "files",
        offerKey: "management",
        offerName: "File management",
        state: "free",
      }),
    );
  report(filesFree, "files_service_bound", "Files API");

  const managedAmount = bodies.pricing.match(
    /\| Session runtime \| \$((?:0|[1-9]\d*)(?:\.\d+)?) per session-hour \|/,
  )?.[1];
  const managedIds = [
    ...new Set(
      [...bodies.managedAgentCreate.matchAll(/^\s*-\s+`"(claude-[a-z0-9._:/-]+)"`\s*$/gm)]
        .map((match) => match[1])
        .filter((id): id is string => id !== undefined),
    ),
  ];
  const managedRefs = managedIds.flatMap((id) => {
    const item = commercialModel(models, id);
    return item === undefined || !callable(item) ? [] : [item.uid];
  });
  const managedService = bodies.managedAgents.includes("Claude Managed Agents");
  const managedActiveSignal = bodies.managedAgentEvents.includes('"active_seconds"');
  const managedListCost = bodies.managedAgentEvents.includes('"list_cost"');
  const managedModelUsage = bodies.pricing.includes(
    "All tokens consumed by a Claude Managed Agents session are billed at the rates shown in",
  );
  const managedCodeIncluded = bodies.pricing.includes(
    "Session runtime replaces the [code execution](#code-execution-tool) container-hour billing model",
  );
  if (managedAmount !== undefined && managedService && managedRefs.length > 0) {
    const rate = publishedRate(
      "session_runtime",
      managedAmount,
      "hour",
      input.source.id,
      "per running session-hour",
    );
    rate.source_locator = {
      kind: "fragment",
      value: "/docs/en/about-claude/pricing.md#managed-agents-pricing",
    };
    facts.push(
      commercialFact(input.source.id, {
        bookKey: "service:managed-agents-runtime",
        bookName: "Managed Agents Runtime",
        resourceKey: "managed-agents-runtime",
        modelRefs: managedRefs,
        offerKey: "runtime",
        offerName: "Running session",
        state: "numeric",
        rates: [rate],
        raw: [
          ...(managedActiveSignal
            ? [
                commercialRaw(
                  "runtime-signal",
                  "informational",
                  "unsupported_structure",
                  "usage.active_seconds is cumulative deduplicated session runtime",
                  input.source.id,
                ),
              ]
            : []),
          ...(managedModelUsage
            ? [
                commercialRaw(
                  "model-usage",
                  "informational",
                  "unsupported_structure",
                  "Session tokens use exact model rates and prompt-cache multipliers",
                  input.source.id,
                ),
              ]
            : []),
          ...(managedListCost
            ? [
                commercialRaw(
                  "session-list-cost",
                  "informational",
                  "requires_usage_aggregation",
                  "Session list_cost is the authoritative rounded public-list subtotal",
                  input.source.id,
                ),
              ]
            : []),
        ],
      }),
    );
    const managedCodeRefs = managedRefs.filter((ref) => codeRefs.has(ref));
    if (managedCodeIncluded && managedCodeRefs.length > 0)
      facts.push(
        commercialFact(input.source.id, {
          bookKey: "service:code-execution",
          bookName: "Code Execution",
          resourceKey: "code-execution",
          modelRefs: managedCodeRefs,
          offerKey: "managed-agents",
          offerName: "Managed Agents code execution",
          state: "included",
        }),
      );
  }
  report(
    managedService && managedIds.length > 0 && managedRefs.length === managedIds.length,
    "managed_agents_scope_bound",
    "Managed Agents model scope",
  );
  report(
    managedAmount !== undefined && managedActiveSignal,
    "managed_agents_runtime_bound",
    "Managed Agents runtime",
  );
  report(managedModelUsage, "managed_agents_model_usage_bound", "Managed Agents model usage");
  report(managedListCost, "managed_agents_list_cost_bound", "Managed Agents list cost");
  report(
    managedCodeIncluded,
    "managed_agents_code_execution_bound",
    "Managed Agents code execution coverage",
  );

  const priorityClosed = bodies.serviceTiers.includes(
    "Priority Tier capacity commitments are no longer available for purchase",
  );
  const prioritySupport = bodies.serviceTiers
    .split(/\r?\n/)
    .find((line) =>
      line.includes("Priority Tier is supported on all available Claude models except"),
    );
  if (prioritySupport !== undefined) {
    const excluded = new Set(mentioned(prioritySupport, models).map(({ uid }) => uid));
    for (const { name, uid } of activeModels.filter(({ uid }) => !excluded.has(uid)))
      facts.push(
        commercialFact(input.source.id, {
          bookKey: `capacity:priority-tier:${uid}`,
          bookName: `${name} Priority Tier Capacity`,
          resourceKind: "capacity",
          resourceKey: `priority-tier:${uid}`,
          modelRefs: [uid],
          offerKey: "commitment",
          offerName: "Existing capacity commitment",
          billingMode: "capacity",
          state: "not_published",
          raw: [
            commercialRaw(
              "commitment-terms",
              "base_price",
              "unknown_amount",
              "Input/output TPM, model version, and 1/3/6/12-month commitment; payment unpublished",
              input.source.id,
            ),
            ...(priorityClosed
              ? [
                  commercialRaw(
                    "closed-enrollment",
                    "informational",
                    "unsupported_structure",
                    "Priority Tier capacity commitments are closed to new purchases",
                    input.source.id,
                  ),
                ]
              : []),
          ],
        }),
      );
  }
  report(prioritySupport !== undefined, "priority_capacity_bound", "Priority Tier capacity");
  report(priorityClosed, "priority_enrollment_bound", "Priority Tier enrollment");

  if (bodies.pricing.includes("Claude Platform on AWS") && bodies.pricing.includes("$0.01 per CCU"))
    facts.push(
      commercialFact(input.source.id, {
        bookKey: "distribution:claude-platform-aws",
        bookName: "Claude Platform on AWS",
        resourceKind: "distribution",
        resourceKey: "claude-platform-aws",
        modelRefs: activeModels.map(({ uid }) => uid),
        offerKey: "marketplace",
        offerName: "AWS Marketplace settlement",
        state: "externally_billed",
        raw: [
          commercialRaw(
            "ccu-conversion",
            "informational",
            "unsupported_structure",
            "100 Claude Consumption Units represent USD 1 after applicable discounts",
            input.source.id,
          ),
        ],
      }),
    );

  const carrier = [...models.values()].find(({ price_facts }) => price_facts.length > 0);
  if (carrier !== undefined && facts.length > 0) carrier.commercial_facts = facts;
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
  launchDetails(
    document("/docs/en/about-claude/models/introducing-claude-fable-5-and-claude-mythos-5.md"),
    input,
    models,
  );
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
    input,
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
    input,
  );
  commercialPricing(
    {
      pricing: document("/docs/en/about-claude/pricing.md"),
      currentPricing: document("/pricing"),
      webSearch: document("/docs/en/agents-and-tools/tool-use/web-search-tool.md"),
      webFetch: document("/docs/en/agents-and-tools/tool-use/web-fetch-tool.md"),
      codeExecution: document("/docs/en/agents-and-tools/tool-use/code-execution-tool.md"),
      advisor: document("/docs/en/agents-and-tools/tool-use/advisor-tool.md"),
      compaction: document("/docs/en/build-with-claude/compaction.md"),
      tokenCounting: document("/docs/en/build-with-claude/token-counting.md"),
      files: document("/docs/en/build-with-claude/files.md"),
      managedAgents: document("/docs/en/managed-agents/overview.md"),
      managedAgentCreate: document("/docs/en/api/beta/agents/create.md"),
      managedAgentEvents: document("/docs/en/managed-agents/events-and-streaming.md"),
      serviceTiers: document("/docs/en/api/service-tiers.md"),
      fallbackCredit: document("/docs/en/build-with-claude/fallback-credit.md"),
    },
    input,
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
