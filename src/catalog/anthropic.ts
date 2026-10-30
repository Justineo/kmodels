import { z } from "zod";
import { linkedBundleSchema } from "./bundle.ts";
import { modelIdSchema } from "./identity.ts";
import { markdownProse, markdownSection } from "./markdown.ts";
import { yamlBlock } from "./yaml.ts";
import { baseModel } from "./model.ts";
import { decimalsEqual, multiplyDecimal, publishedRate } from "./pricing.ts";
import {
  anthropicMessageInputs,
  anthropicSearchInput,
  anthropicIterationInputs,
} from "./anthropic-accounting.ts";
import { anthropicPriceKind, anthropicPriceRow } from "./anthropic-price-row.ts";
import { anthropicCodeExecution } from "./anthropic-code-execution.ts";
import type { ProviderAtomRegistryEntry } from "./pricing-schema.ts";
import type {
  ParsedProviderModel as ProviderModel,
  SourceCommercialPricingFact,
  SourcePriceFact,
  SourcePricingInputFact,
  SourcePricingFacts,
} from "./pricing-source.ts";
import { assertItemCount, contractExtensionEvidence, recognizeItems } from "./source-contract.ts";
import { type Modality, unknownCapabilities } from "./schema.ts";
import type { SourceParseInput as Input, SourceParseResult } from "./source-parse.ts";

interface MarkdownTable {
  headers: string[];
  rows: string[][];
  irregular: string[][];
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
const messagesEndpoint = { name: "Create a Message", path: "v1/messages" };
const batchEndpoint = { name: "Create a Message Batch", path: "v1/messages/batches" };

function json(body: string): unknown {
  return JSON.parse(body);
}

function text(value: string): string {
  const prose = (part: string) =>
    part
      .replace(/<[^>]+>/g, "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/(?<!\w)__([^_]+)__(?!\w)/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/(?<!\w)_([^_]+)_(?!\w)/g, "$1")
      .replace(/\\([\\`*_$.])/g, "$1");
  return value
    .split(/(`[^`]*`|\[[^\]]+]\([^)]*\))/g)
    .map((part, index) =>
      index % 2 === 0
        ? prose(part)
        : part.startsWith("`")
          ? part.slice(1, -1)
          : text(part.slice(1, part.indexOf("]("))),
    )
    .join("")
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
    const irregular: string[][] = [];
    let cursor = line + 2;
    while (lines[cursor]?.trim().startsWith("|")) {
      const values = cells(lines[cursor] ?? "");
      if (values.length === headers.length) rows.push(values);
      else irregular.push(values);
      cursor += 1;
    }
    result.push({ headers, rows, irregular, line });
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

function contractFinding(input: Input, code: string, claim: string): void {
  input.onContractFinding?.(contractExtensionEvidence([`/anthropic/${code}/${claim}`]));
}

type ObserveLimit = (
  item: ProviderModel,
  field: "context_tokens" | "max_output_tokens",
  value: number | undefined,
) => void;

function limitObserver(input: Input): ObserveLimit {
  const claims = new Map<string, Set<number>>();
  return (item, field, value) => {
    if (value === undefined) return;
    const key = `${item.model_id}/${field}`;
    const values = claims.get(key) ?? new Set<number>();
    values.add(value);
    claims.set(key, values);
    if (values.size === 1) item.limits[field] = value;
    else {
      delete item.limits[field];
      contractFinding(input, "model_limit_conflict", key);
    }
  };
}

function tableDate(value: string, field: string, input: Input): string | undefined {
  if (value === "N/A" || value === "To be announced" || value.startsWith("Not sooner than "))
    return undefined;
  const parsed = date(value);
  if (parsed === undefined) {
    contractFinding(input, "lifecycle_date_invalid", `${field}: ${value}`);
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

function overview(
  body: string,
  input: Input,
  models: Map<string, ProviderModel>,
  observeLimit: ObserveLimit,
): void {
  interface OverviewRecord {
    item: ProviderModel;
    names: Set<string>;
    descriptions: Set<string>;
    reasoning: Set<boolean>;
    states: Set<ProviderModel["status"]>;
  }
  const records = new Map<string, OverviewRecord>();
  const record = (item: ProviderModel): OverviewRecord => {
    const existing = records.get(item.model_id);
    if (existing !== undefined) return existing;
    const created: OverviewRecord = {
      item,
      names: new Set(),
      descriptions: new Set(),
      reasoning: new Set(),
      states: new Set(),
    };
    records.set(item.model_id, created);
    return created;
  };
  const agreed = <T>(target: OverviewRecord, values: Set<T>, field: string): T | undefined => {
    if (values.size > 1)
      contractFinding(input, "model_overview_conflict", `${target.item.model_id}/${field}`);
    return values.size === 1 ? [...values][0] : undefined;
  };
  const featureTables = tables(body).filter((table) => table.headers[0] === "Feature");
  if (featureTables.length === 0)
    contractFinding(input, "model_overview_drift", "model feature tables");
  for (const table of featureTables) {
    const ids = row(table, "Claude API ID");
    if (ids === undefined) continue;
    const aliases = row(table, "Claude API alias");
    const descriptions = row(table, "Description");
    const contexts = row(table, "Context window");
    const outputs = row(table, "Max output");
    const extended = row(table, "Extended thinking");
    const adaptive = row(table, "Adaptive thinking");
    const thinkingMode = row(table, "Thinking");
    for (let column = 1; column < table.headers.length; column += 1) {
      const id = ids[column];
      if (id === undefined || !modelIdSchema.safeParse(id).success) continue;
      const item = model(models, input, id);
      const target = record(item);
      const name = table.headers[column]?.replace(/\s*\(deprecated\)$/i, "");
      if (name) target.names.add(name);
      const description = descriptions?.[column];
      if (description) target.descriptions.add(description);
      const alias = aliases?.[column];
      if (alias !== undefined && alias !== id && modelIdSchema.safeParse(alias).success)
        item.aliases = [...new Set([...item.aliases, alias])];
      item.modalities = { input: ["text", "image"], output: ["text"] };
      const thinking = [extended?.[column], adaptive?.[column], thinkingMode?.[column]].filter(
        (value): value is string => value !== undefined,
      );
      if (thinking.some((value) => /^(?:Yes|Adaptive|Extended)\b/.test(value)))
        target.reasoning.add(true);
      else if (
        thinking.length > 0 &&
        thinking.every((value) => /^(?:No|Not supported)$/.test(value))
      )
        target.reasoning.add(false);
      observeLimit(item, "context_tokens", tokenCount(contexts?.[column]));
      observeLimit(item, "max_output_tokens", tokenCount(outputs?.[column]));
      target.states.add(
        /\(deprecated\)$/i.test(table.headers[column] ?? "") ? "deprecated" : "active",
      );
    }
  }
  for (const match of body.matchAll(
    /Claude ([A-Z][A-Za-z]+(?: (?:[A-Z][A-Za-z]+|\d+(?:\.\d+)?))*) \(`([a-z0-9._:/-]+)`\)/g,
  )) {
    if (match[1] === undefined || match[2] === undefined) continue;
    const item = model(models, input, match[2]);
    record(item).names.add(`Claude ${match[1]}`);
    item.modalities = { input: ["text", "image"], output: ["text"] };
    if (/(?:^|-)preview(?:-|$)/.test(item.model_id)) item.release_stage = "preview";
  }

  for (const target of records.values()) {
    const { item } = target;
    item.name = agreed(target, target.names, "name") ?? item.model_id;
    const description = agreed(target, target.descriptions, "description");
    if (description !== undefined) item.description = description;
    item.capabilities.reasoning = agreed(target, target.reasoning, "reasoning") ?? "unknown";
    if (
      body.includes(`${item.name} is generally available`) ||
      body.includes(`${item.name} (\`${item.model_id}\`) is generally available`)
    ) {
      target.states.add("active");
      item.release_stage = "stable";
    } else if (
      body.includes(
        `${item.name} is not generally available: it is offered in limited availability`,
      )
    ) {
      target.states.add("active");
    }
    item.status = agreed(target, target.states, "status") ?? "unknown";
  }

  for (const match of body.matchAll(
    /Claude [^(\n]+ \(`(claude-[a-z0-9._:/-]+)`\) shares (Claude [A-Za-z0-9. -]+)'s specs and pricing/g,
  )) {
    const targetId = match[1];
    const sourceName = match[2];
    if (targetId === undefined || sourceName === undefined) continue;
    const target = models.get(targetId);
    const sources = [...models.values()].filter(({ name }) => name === sourceName);
    if (target === undefined || sources.length !== 1 || sources[0] === undefined) {
      contractFinding(input, "shared_model_fact_unbound", targetId);
      continue;
    }
    const source = sources[0];
    target.modalities = {
      input: [...source.modalities.input],
      output: [...source.modalities.output],
    };
    observeLimit(target, "context_tokens", source.limits.context_tokens);
    observeLimit(target, "max_output_tokens", source.limits.max_output_tokens);
    const targetRecord = record(target);
    if (source.capabilities.reasoning !== "unknown")
      targetRecord.reasoning.add(source.capabilities.reasoning);
    target.capabilities.reasoning =
      agreed(targetRecord, targetRecord.reasoning, "reasoning") ?? "unknown";
  }
}

function releaseNotes(body: string, input: Input, models: Map<string, ProviderModel>): void {
  const names = new Map<string, Set<string>>();
  let currentDate: string | undefined;
  let launches = 0;
  const conflicts = new Set<string>();
  for (const line of markdownProse(body).split(/\r?\n/)) {
    const heading = line.match(/^### (.+)$/)?.[1];
    if (/^#{1,3} /.test(line)) currentDate = heading === undefined ? undefined : date(heading);
    if (currentDate !== undefined && /^[*-] We've retired the /.test(line))
      for (const match of line.matchAll(
        /\b(Claude [A-Z][A-Za-z]*(?: [A-Z][A-Za-z]*)* \d+(?:\.\d+)?)(?: model)? \(`(claude-[a-z0-9._:/-]+)`\)/g,
      )) {
        const name = match[1];
        const id = match[2];
        if (name === undefined || id === undefined || !models.has(id)) continue;
        const observed = names.get(id) ?? new Set<string>();
        observed.add(name);
        names.set(id, observed);
      }
    const subject = line.match(/^[*-] We've launched (.+)$/)?.[1];
    if (subject === undefined) continue;
    const opening = text(subject.split(",", 1)[0] ?? "");
    if (!/^Claude\b/.test(opening)) continue;
    if (currentDate === undefined) {
      contractFinding(input, "release_notes_drift", opening);
      continue;
    }
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
        contractFinding(input, "release_date_conflict", item.model_id);
      } else item.release_date = currentDate;
      launches += 1;
    }
  }
  for (const [id, observed] of names) {
    const item = models.get(id);
    const [name] = observed;
    if (item?.name === id && observed.size === 1 && name !== undefined) item.name = name;
  }
  if (launches === 0) contractFinding(input, "release_notes_drift", "model launches");
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
  interface LifecycleRecord {
    item: ProviderModel;
    states: Set<ProviderModel["status"]>;
    historicalStates: Set<ProviderModel["status"]>;
    deprecated: Set<string>;
    retired: Set<string>;
    replacements: Set<string>;
  }
  const records = new Map<string, LifecycleRecord>();
  const record = (id: string | undefined): LifecycleRecord | undefined => {
    if (id === undefined || !modelIdSchema.safeParse(id).success) return;
    const existing = records.get(id);
    if (existing !== undefined) return existing;
    const created: LifecycleRecord = {
      item: model(models, input, id),
      states: new Set(),
      historicalStates: new Set(),
      deprecated: new Set(),
      retired: new Set(),
      replacements: new Set(),
    };
    records.set(id, created);
    return created;
  };
  const add = (values: Set<string>, value: string | undefined) => {
    if (value !== undefined) values.add(value);
  };
  const parsedTables = tables(body);
  const statusTables = parsedTables.filter((table) => table.headers.includes("API model name"));
  if (statusTables.length === 0) contractFinding(input, "lifecycle_table_drift", "model status");
  for (const table of statusTables) {
    const cell = (values: string[], name: string) => values[table.headers.indexOf(name)] ?? "";
    for (const values of table.rows) {
      const target = record(cell(values, "API model name"));
      if (target === undefined) continue;
      const state = status(cell(values, "Current state"));
      if (state !== undefined) target.states.add(state);
      else contractFinding(input, "lifecycle_state_invalid", target.item.model_id);
      add(target.deprecated, tableDate(cell(values, "Deprecated"), "deprecation date", input));
      add(
        target.retired,
        tableDate(cell(values, "Tentative retirement date"), "retirement date", input),
      );
    }
    if (table.irregular.length > 0) contractFinding(input, "lifecycle_row_invalid", "model status");
  }

  const lines = body.split(/\r?\n/);
  for (const table of parsedTables.filter(
    (candidate) => candidate.headers[0] === "Retirement date",
  )) {
    const heading = lines.slice(0, table.line).findLast((line) => /^#{1,3} /.test(line));
    const nativeDate = heading?.match(/^### (\d{4}-\d{2}-\d{2}):/)?.[1];
    const deprecatedAt =
      nativeDate !== undefined && z.iso.date().safeParse(nativeDate).success
        ? nativeDate
        : undefined;
    if (deprecatedAt === undefined)
      contractFinding(input, "lifecycle_table_drift", "historical announcement date");
    for (const values of table.rows) {
      const target = record(values[1]);
      if (target === undefined) continue;
      const retiredAt = tableDate(values[0] ?? "", "historical retirement date", input);
      add(target.deprecated, deprecatedAt);
      add(target.retired, retiredAt);
      if (retiredAt !== undefined)
        target.historicalStates.add(
          retiredAt <= input.observedAt.slice(0, 10) ? "retired" : "deprecated",
        );
      const replacement = values[2];
      if (replacement !== undefined && modelIdSchema.safeParse(replacement).success)
        target.replacements.add(replacement);
    }
    if (table.irregular.length > 0)
      contractFinding(input, "lifecycle_row_invalid", "historical retirement");
  }

  for (const match of body.matchAll(
    /`(claude-[a-z0-9._:/-]+)`\) is (active|legacy|deprecated|retired)\b/gi,
  )) {
    const target = record(match[1]);
    const state = status(match[2] ?? "");
    if (target !== undefined && state !== undefined) target.states.add(state);
  }
  for (const match of body.matchAll(
    /`(claude-[a-z0-9._:/-]+)`\) is deprecated\.[^\n]*?`(claude-[a-z0-9._:/-]+)`/gi,
  )) {
    const target = record(match[1]);
    if (target !== undefined && match[2] !== undefined) target.replacements.add(match[2]);
  }
  for (const match of body.matchAll(
    /`(claude-[a-z0-9._:/-]+)`\) will be retired on ([A-Z][a-z]+ \d{1,2}, \d{4})\.[^\n]*?`(claude-[a-z0-9._:/-]+)`/g,
  )) {
    const target = record(match[1]);
    if (target === undefined) continue;
    const retiredAt = tableDate(match[2] ?? "", "inline retirement date", input);
    add(target.retired, retiredAt);
    if (retiredAt !== undefined)
      target.historicalStates.add(
        retiredAt <= input.observedAt.slice(0, 10) ? "retired" : "deprecated",
      );
    if (match[3] !== undefined) target.replacements.add(match[3]);
  }

  for (const target of records.values()) {
    const { item } = target;
    const agreed = <T>(values: Set<T>, field: string): T | undefined => {
      if (values.size > 1)
        contractFinding(input, "lifecycle_fact_conflict", `${item.model_id}/${field}`);
      return values.size === 1 ? [...values][0] : undefined;
    };
    const deprecatedAt = agreed(target.deprecated, "deprecated_at");
    const retiredAt = agreed(target.retired, "retired_at");
    if (deprecatedAt !== undefined) item.deprecated_at = deprecatedAt;
    if (retiredAt !== undefined) item.retired_at = retiredAt;
    const states = target.states.size > 0 ? target.states : target.historicalStates;
    if (states.size > 0) item.status = agreed(states, "status") ?? "unknown";
    if (
      item.status === "deprecated" &&
      retiredAt !== undefined &&
      retiredAt <= input.observedAt.slice(0, 10)
    )
      item.status = "retired";
    item.replacement_model_ids = [...target.replacements].sort();
  }
}

function validateEndpoint(
  body: string,
  expected: { name: string; path: string },
  method: "get" | "post" = "post",
): void {
  const header = body.match(/^#{1,2} (.+)\r?\n\r?\n\*\*(get|post)\*\* `\/([^`]+)`/im);
  if (
    header?.[1] !== expected.name ||
    header[2]?.toLowerCase() !== method ||
    header[3] !== expected.path
  )
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
      contractFinding(input, "operation_contract_drift", expected.path);
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
    if (!valid) contractFinding(input, "operation_claim_drift", claim);
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
      .replace(/-\d{8}$/, "")
      .match(/[a-z]+|\d+/g)
      ?.filter((token) => token !== "claude")
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
    const explicitIds = ids(value);
    let item: ProviderModel | undefined;
    if (explicitIds.length === 1) item = commercialModel(models, explicitIds[0] ?? "");
    else if (explicitIds.length === 0) {
      const candidates = [...new Set(identities.get(key(value)) ?? [])];
      if (candidates.length === 1) item = models.get(candidates[0] ?? "");
    }
    if (item === undefined)
      throw new Error(`Anthropic model label did not match one official ID: ${label(value)}`);
    return item;
  };
}

function mentioned(value: string, models: Map<string, ProviderModel>): ProviderModel[] {
  const result: ProviderModel[] = [];
  const resolve = resolver(models);
  for (const item of models.values()) {
    const pattern =
      item.name === item.model_id
        ? key(item.model_id).split("-").join("[ .-]+")
        : item.name.replace(/^Claude /, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = value.match(new RegExp(`(?:^|[^\\w.-])(?:Claude )?${pattern}(?![\\w.-])`, "i"));
    if (match === null) continue;
    try {
      if (resolve(match[0]).model_id === item.model_id) result.push(item);
    } catch {
      // An ambiguous display name cannot establish a model-specific claim.
    }
  }
  return result;
}

function callable(item: ProviderModel): boolean {
  return item.api_endpoints?.some(({ path }) => path === messagesEndpoint.path) === true;
}

function listedModelIds(body: string): string[] | undefined {
  const frontmatter = body.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  const metadata =
    frontmatter === undefined ? undefined : yamlBlock(frontmatter, "featureMetadata", 0);
  const supported = metadata === undefined ? undefined : yamlBlock(metadata, "supportedModels", 2);
  if (supported !== undefined) {
    const values = supported
      .split(/\r?\n/)
      .slice(1)
      .filter((line) => line.trim() !== "");
    const parsed = z
      .array(modelIdSchema)
      .nonempty()
      .safeParse(values.map((line) => line.match(/^    - (claude-[a-z0-9._:/-]+)$/)?.[1]));
    return parsed.success && new Set(parsed.data).size === parsed.data.length
      ? parsed.data
      : undefined;
  }
  const list = body.match(/^- Supported models: (`[^`]+`(?:, `[^`]+`)*)\r?$/m)?.[1];
  if (list === undefined) return;
  const ids: string[] = [];
  for (const match of list.matchAll(/`([^`]+)`/g)) {
    const parsed = modelIdSchema.safeParse(match[1]);
    if (!parsed.success) return;
    ids.push(parsed.data);
  }
  return ids.length > 0 && new Set(ids).size === ids.length ? ids : undefined;
}

function listedModels(
  body: string,
  models: Map<string, ProviderModel>,
  capability: string,
  input: Input,
): ProviderModel[] | undefined {
  const ids = listedModelIds(body);
  if (ids === undefined) {
    contractFinding(input, "capability_contract_drift", capability);
    return;
  }
  return ids.flatMap((id) => {
    const item = commercialModel(models, id);
    if (item !== undefined) return [item];
    contractFinding(input, "capability_model_unbound", `${capability}: ${id}`);
    return [];
  });
}

function capabilities(
  bodies: {
    overview: string;
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
    thinkingSupport: string;
    toolUse: string;
  },
  models: Map<string, ProviderModel>,
  input: Input,
): void {
  const current = [...models.values()].filter(({ status }) => status === "active");
  const supported = [...models.values()].filter(callable);
  const drift = (claim: string): void => contractFinding(input, "capability_contract_drift", claim);
  if (
    bodies.overview.includes(
      "All current models support text and image input, text output, multilingual capabilities, vision, and tool use.",
    )
  )
    for (const item of current) item.capabilities.tool_call = true;

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

  const codeIds = listedModelIds(bodies.codeExecution);
  const codeTable = tables(bodies.codeExecution).find(
    (table) => table.headers.join("|") === "Model|Tool versions",
  );
  if (codeIds !== undefined) {
    for (const item of supported) item.capabilities.code_execution = false;
    for (const id of codeIds) {
      const item = commercialModel(models, id);
      if (item !== undefined && callable(item)) item.capabilities.code_execution = true;
      else contractFinding(input, "capability_model_unbound", `code execution: ${id}`);
    }
  } else if (codeTable !== undefined && codeTable.rows.length > 0) {
    for (const item of supported) item.capabilities.code_execution = false;
    const resolve = resolver(models);
    for (const values of codeTable.rows) {
      try {
        const item = resolve(values[0] ?? "");
        if (callable(item)) item.capabilities.code_execution = true;
      } catch {
        contractFinding(
          input,
          "capability_model_unbound",
          `code execution: ${values[0] ?? "unknown"}`,
        );
      }
    }
  } else drift("code execution");
  const previewCode = bodies.codeExecution
    .split(/\r?\n/)
    .find((line) => line.includes("code execution is supported on the Claude API"));
  const previewModel = models.get("claude-mythos-preview");
  const previewCodeModels =
    previewCode === undefined
      ? []
      : [
          ...mentioned(previewCode, models),
          ...(previewModel !== undefined && previewCode.includes("[Claude Mythos Preview]")
            ? [previewModel]
            : []),
        ];
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
  const thinkingTable = tables(bodies.thinkingSupport).find(
    (table) => table.headers.join("|") === "Model|Thinking types|Default|Rejected with 400",
  );
  const thinkingModels =
    thinkingLine === undefined
      ? (thinkingTable?.rows.flatMap((values) =>
          /^(?:Adaptive|Extended)\b/.test(values[1] ?? "")
            ? mentioned(values[0] ?? "", models)
            : [],
        ) ?? [])
      : mentioned(thinkingLine, models);
  if (thinkingModels.length === 0) drift("thinking");
  else for (const item of thinkingModels) if (callable(item)) item.capabilities.reasoning = true;

  const toolLine = bodies.toolUse
    .split(/\r?\n/)
    .find((line) => line.includes("does not support forced tool use"));
  const toolModels = toolLine === undefined ? [] : mentioned(toolLine, models);
  if (toolModels.length === 0 && !current.every((item) => item.capabilities.tool_call === true))
    drift("tool use");
  else for (const item of toolModels) if (callable(item)) item.capabilities.tool_call = true;
}

function validateModelIdentityContract(body: string, modelsListBody: string, input: Input): void {
  const report = (valid: boolean, sample: string): void => {
    if (!valid) contractFinding(input, "model_identity_contract_drift", sample);
  };
  report(
    body.includes("Each Claude model ID identifies a pinned version of the model") &&
      body.includes("Starting with the Claude 4.6 generation, model IDs use a dateless format") &&
      body.includes("dateless ID is the canonical model ID for that release") &&
      body.includes("convenience pointer that resolves to the most recent dated snapshot"),
    "model ID semantics",
  );
  try {
    validateEndpoint(modelsListBody, { name: "List Models", path: "v1/models" }, "get");
  } catch {
    report(false, "Models API endpoint");
  }
  report(
    modelsListBody.includes("Defaults to `20`. Ranges from `1` to `1000`.") &&
      modelsListBody.includes("ID of the object to use as a cursor for pagination"),
    "Models API pagination",
  );
}

interface ModelGeneration {
  major: number;
  minor: number;
}

function sectionProse(body: string, depth: number, heading: string): string {
  const content = markdownSection(body, depth, heading);
  if (content === undefined) return "";
  return markdownProse(content)
    .split(/\r?\n/)
    .filter((line) => !/^(?: {4}|\t| *>)/.test(line))
    .join("\n");
}

function geographyGeneration(body: string, label: "pricing" | "data-residency"): ModelGeneration {
  const values = new Map<string, ModelGeneration>();
  const prefix =
    label === "pricing" ? "For Claude " : "The `inference_geo` parameter is supported on Claude ";
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith(prefix)) continue;
    const match = line.slice(prefix.length).match(/^(\d+)\.(\d+) and later models[,.]/);
    if (match?.[1] === undefined || match[2] === undefined)
      throw new Error(`Anthropic ${label} generation is unreadable`);
    const generation = { major: Number(match[1]), minor: Number(match[2]) };
    if (!Number.isSafeInteger(generation.major) || !Number.isSafeInteger(generation.minor))
      throw new Error(`Anthropic ${label} generation is unsafe`);
    values.set(`${generation.major}.${generation.minor}`, generation);
  }
  const generations = [...values.values()];
  if (generations.length !== 1 || generations[0] === undefined)
    throw new Error(`Anthropic ${label} generation threshold drifted`);
  return generations[0];
}

function reviewedGeographyGeneration(
  body: string,
  label: "pricing" | "data-residency",
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
  const match = id.match(/^claude-[a-z]+(?:-[a-z]+)*-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/);
  if (match?.[1] === undefined) return undefined;
  const generation = { major: Number(match[1]), minor: Number(match[2] ?? 0) };
  return Number.isSafeInteger(generation.major) && Number.isSafeInteger(generation.minor)
    ? generation
    : undefined;
}

function atLeastGeneration(id: string, threshold: ModelGeneration): boolean {
  const generation = modelGeneration(id);
  return (
    generation !== undefined &&
    (generation.major > threshold.major ||
      (generation.major === threshold.major && generation.minor >= threshold.minor))
  );
}

function validateRequestAccounting(
  messages: string,
  dataResidency: string,
  promptCaching: string,
  input: Input,
): SourcePricingInputFact[] {
  const pricingInputs = anthropicMessageInputs(messages, promptCaching, input);
  const geography = sectionProse(dataResidency, 2, "Inference geo");
  if (
    dataResidency !== "" &&
    !(
      geography.includes("The response `usage` object includes an `inference_geo` field") &&
      geography.includes("`allowed_inference_geos`") &&
      geography.includes("`default_inference_geo`") &&
      geography.includes("return a 400 error")
    )
  )
    contractFinding(input, "accounting_contract_drift", "inference-geography outcomes");
  return pricingInputs;
}

function rowScope(value: string): SourcePriceFact["conditions"] | undefined {
  let context: SourcePriceFact["conditions"] = {};
  const prompt = value.match(/ \(for prompts (up to|over) ([^()]+) tokens\)/);
  if (prompt !== null) {
    const raw = prompt[2] ?? "";
    if (!/^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)$/.test(raw)) return;
    const count = Number(raw.replaceAll(",", ""));
    if (!Number.isSafeInteger(count) || (prompt[1] === "over" && count === Number.MAX_SAFE_INTEGER))
      return;
    context =
      prompt[1] === "up to" ? { context_max_tokens: count } : { context_min_tokens: count + 1 };
    value = value.replace(prompt[0], "");
  }
  if (/[()]/.test(value.replace(/ \((?:limited availability|legacy)\)/g, ""))) return;
  const clauses = [
    ...value.matchAll(/\b(through|starting)\b\s+(.+?)(?=\s+(?:through|starting)\b|$)/g),
  ];
  if (clauses.length === 0) return context;
  if (clauses.length !== 1) return;
  const clause = clauses[0];
  const parsed = date(clause?.[2] ?? "");
  if (parsed === undefined) return;
  return clause?.[1] === "through"
    ? { ...context, effective_until: parsed, promotion: true }
    : { ...context, effective_from: parsed };
}

interface CacheMultipliers {
  fiveMinuteWrite: string | undefined;
  oneHourWrite: string | undefined;
  read: string | undefined;
  readOverrides: ReadonlyMap<string, string>;
  unknownOperations: boolean;
}

function cached(
  rate: SourcePriceFact,
  multipliers: CacheMultipliers,
  modelId: string,
): SourcePriceFact[] {
  const derive = (
    meter: "cache_write_text" | "cache_read_text",
    multiplier: string | undefined,
    cacheTtlSeconds?: number,
  ): SourcePriceFact[] =>
    multiplier === undefined
      ? []
      : [
          {
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
          },
        ];
  return [
    ...derive("cache_write_text", multipliers.fiveMinuteWrite, 300),
    ...derive("cache_write_text", multipliers.oneHourWrite, 3600),
    ...derive("cache_read_text", multipliers.readOverrides.get(modelId) ?? multipliers.read),
  ];
}

function cacheMultipliers(
  parsedTables: MarkdownTable[],
  input: Input,
  resolve: (value: string) => ProviderModel,
): CacheMultipliers {
  const policies = parsedTables.filter(
    (candidate) => candidate.headers.join("|") === "Cache operation|Multiplier|Duration",
  );
  if (policies.length === 0) throw new Error("Anthropic pricing page omitted cache multipliers");
  const rows = policies.flatMap((table) => [...table.rows, ...table.irregular]);
  const known = new Set([
    "5-minute cache write",
    "1-hour cache write",
    "Cache read",
    "Cache read (hit)",
  ]);
  const unknownOperations = rows.some((values) => !known.has(values[0] ?? ""));
  for (const values of rows.filter((values) => !known.has(values[0] ?? "")))
    input.onPricingReconciliation?.({
      disposition: "unsupported",
      reason_code: "cache_multiplier_drift",
      sample: values.join(" | ").slice(0, 256),
    });
  const parse = (values: string[], operation: string) => {
    const amount = values[1]?.match(/^((?:0|[1-9]\d*)(?:\.\d+)?)x base input price(?: \((.+)\))?$/);
    if (amount?.[1] === undefined || values.length !== 3) return;
    const duration =
      operation === "5-minute cache write"
        ? "Cache valid for 5 minutes"
        : operation === "1-hour cache write"
          ? "Cache valid for 1 hour"
          : "Same duration as the preceding write";
    if (values[2] !== duration || (operation !== "Cache read" && amount[2] !== undefined)) return;
    const overrides = new Map<string, string>();
    for (const clause of amount[2]?.split(/;\s*/) ?? []) {
      const override = clause.match(/^((?:0|[1-9]\d*)(?:\.\d+)?)x on (Claude .+)$/);
      if (override?.[1] === undefined || override[2] === undefined) return;
      for (const name of override[2].split(" and ")) {
        if (!/^Claude [\w. -]+$/.test(name)) return;
        let id: string;
        try {
          id = resolve(name).model_id;
        } catch {
          return;
        }
        if (overrides.has(id)) return;
        overrides.set(id, override[1]);
      }
    }
    return { value: amount[1], overrides };
  };
  const operation = (name: string) => {
    const claims = rows.filter(
      (values) => values[0] === name || (name === "Cache read" && values[0] === "Cache read (hit)"),
    );
    const values = claims.map((claim) => parse(claim, name));
    const first = values[0];
    const agreed =
      first !== undefined &&
      values.every(
        (current) =>
          current !== undefined &&
          decimalsEqual(current.value, first.value) &&
          current.overrides.size === first.overrides.size &&
          [...first.overrides].every(([name, value]) => {
            const candidate = current.overrides.get(name);
            return candidate !== undefined && decimalsEqual(value, candidate);
          }),
      );
    for (const value of values)
      input.onPricingReconciliation?.({
        disposition: agreed ? "normalized" : value === undefined ? "unresolved" : "ambiguous",
        reason_code: agreed ? "cache_multiplier_applied" : "cache_multiplier_drift",
        ...(agreed ? {} : { sample: "Prompt caching multipliers" }),
      });
    return agreed ? first : undefined;
  };
  const fiveMinuteWrite = operation("5-minute cache write");
  const oneHourWrite = operation("1-hour cache write");
  const read = operation("Cache read");
  return {
    fiveMinuteWrite: fiveMinuteWrite?.value,
    oneHourWrite: oneHourWrite?.value,
    read: read?.value,
    readOverrides: read?.overrides ?? new Map(),
    unknownOperations,
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
    listedModelIds(body) ??
      [...body.matchAll(modelPattern)].flatMap((match) =>
        match[1] === undefined ? [] : [match[1]],
      ),
  );
  if (
    supported.size === 0 ||
    supported.size !== expectedIds.size ||
    [...supported].some((id) => !expectedIds.has(id))
  )
    throw new Error("Anthropic fast-mode model coverage disagreed with pricing");
}

function pricing(
  body: string,
  fastModeBody: string,
  dataResidency: string,
  input: Input,
  models: Map<string, ProviderModel>,
  observeLimit: ObserveLimit,
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
    if (rates.length > 0) item.pricing_state = "numeric";
  };
  const parsedTables = tables(body);
  let multipliers: CacheMultipliers | undefined;
  try {
    multipliers = cacheMultipliers(parsedTables, input, resolve);
  } catch {
    input.onPricingReconciliation?.({
      disposition: "unresolved",
      reason_code: "cache_multiplier_drift",
      sample: "Prompt caching multipliers",
    });
  }
  const priceTables = parsedTables.filter(
    (table) => anthropicPriceKind(table.headers) !== undefined,
  );
  for (const kind of ["base", "batch", "fast"] as const)
    if (
      !priceTables.some(
        (table) =>
          anthropicPriceKind(table.headers) === kind &&
          table.rows.length + table.irregular.length > 0,
      )
    ) {
      input.onPricingReconciliation?.({
        disposition: "unresolved",
        reason_code: "pricing_table_drift",
        sample: `${kind} model prices`,
      });
      input.onPricingDependencyFailure?.(
        "https://platform.claude.com/docs/en/about-claude/pricing.md",
      );
    }
  const cachePolicy =
    parsedTables
      .filter(({ headers }) => headers.join("|") === "Cache operation|Multiplier|Duration")
      .map(({ headers, rows, irregular }) =>
        [headers, ...rows, ...irregular].map((values) => values.join(" | ")).join("\n"),
      )
      .join("\n") || body.slice(0, 4096);
  const fastIds = new Set<string>();
  for (const table of priceTables) {
    const kind = anthropicPriceKind(table.headers);
    if (kind === undefined) continue;
    for (const values of [...table.rows, ...table.irregular]) {
      const nativeLabel = values[0] ?? "";
      // These rows explicitly describe surviving partner-platform offers after direct API
      // retirement. They neither price the direct Claude API nor require a direct model join.
      if (
        /^Claude [\w. -]+ \(retired, except on (?:Bedrock and )?Claude Models on Google Cloud \(Google managed\)\)$/.test(
          nativeLabel,
        )
      ) {
        input.onPricingReconciliation?.({
          disposition: "excluded",
          reason_code: "retired_partner_only_price",
          sample: nativeLabel.slice(0, 256),
        });
        continue;
      }
      const names = kind === "fast" ? nativeLabel.split(" / ").filter(Boolean) : [nativeLabel];
      const scope = rowScope(nativeLabel);
      const conditions = {
        ...scope,
        ...(kind === "batch"
          ? { service_tier: "batch" }
          : { speed: kind === "fast" ? "fast" : "standard" }),
      };
      const claims = anthropicPriceRow(
        kind,
        table.headers,
        values,
        conditions,
        scope !== undefined,
        input.source.id,
      );
      let bound = 0;
      let conflict = false;
      for (const name of names) {
        let item: ProviderModel;
        try {
          item = resolve(name);
        } catch {
          continue;
        }
        bound += 1;
        item.raw_price_facts.push(...claims.raw);
        add(item, claims.rates);
        if (kind === "fast") fastIds.add(item.model_id);
        const inputRate = claims.rates.find(({ meter }) => meter === "input_text");
        if (kind === "base") {
          if (
            claims.rates.some(
              ({ meter }) => meter === "cache_write_text" || meter === "cache_read_text",
            )
          )
            item.capabilities.prompt_cache = true;
          if (multipliers !== undefined && inputRate !== undefined)
            conflict =
              conflict ||
              cached(inputRate, multipliers, item.model_id).some((expected) => {
                const direct = claims.rates.find(
                  (rate) =>
                    rate.meter === expected.meter &&
                    rate.conditions.cache_ttl_seconds === expected.conditions.cache_ttl_seconds,
                );
                return direct !== undefined && !decimalsEqual(direct.price, expected.price);
              });
        } else {
          if (kind === "batch" && claims.rates.length > 0) item.capabilities.batch = true;
          if (inputRate !== undefined && multipliers !== undefined)
            add(item, cached(inputRate, multipliers, item.model_id));
        }
        const incompleteCache =
          multipliers === undefined ||
          multipliers.fiveMinuteWrite === undefined ||
          multipliers.oneHourWrite === undefined ||
          multipliers.read === undefined;
        if ((kind !== "base" && incompleteCache) || multipliers?.unknownOperations === true)
          item.raw_price_facts.push({
            term_key: "unparsed:cache-policy",
            impact: "base_price",
            reason: "unsupported_structure",
            conditions,
            source_ref: input.source.id,
            raw: { fragment: cachePolicy.slice(0, 4096) },
          });
      }
      input.onPricingReconciliation?.({
        disposition:
          bound !== names.length || bound === 0
            ? "unbound"
            : conflict
              ? "ambiguous"
              : claims.raw.length > 0
                ? "raw"
                : "normalized",
        reason_code:
          bound !== names.length || bound === 0
            ? "pricing_model_unbound"
            : conflict
              ? "cache_price_conflict"
              : claims.raw.length > 0
                ? "pricing_row_preserved_raw"
                : `${kind}_model_price_row`,
        sample: nativeLabel.slice(0, 256) || "Model price row",
      });
      if (bound !== names.length || bound === 0)
        input.onPricingDependencyFailure?.(
          "https://platform.claude.com/docs/en/about-claude/pricing.md",
        );
    }
  }
  if (fastIds.size > 0) {
    try {
      validateFastMode(fastModeBody, fastIds);
    } catch {
      input.onPricingReconciliation?.({
        disposition: "unresolved",
        reason_code: "fast_compatibility_conflict",
        sample: [...fastIds].join(", "),
      });
    }
  }

  const tools = parsedTables.find(
    (table) =>
      table.headers.join("|") === "Model|Tool choice|Tool use system prompt token count" ||
      table.headers.join("|") ===
        "Model|Tool use system prompt tokens: auto, none|Tool use system prompt tokens: any, tool",
  );
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
    contractFinding(input, "long_context_contract_drift", "1M context pricing");
  else {
    const longContextModels = text(longContext);
    for (const item of mentioned(longContextModels, models))
      observeLimit(item, "context_tokens", 1_000_000);
  }

  const geography = sectionProse(body, 3, "Data residency pricing");
  const inferenceGeoMultiplier = geographyMultiplier(geography);
  const globalDeclarations = geography
    .split(/(?<=\.)\s+|\n/)
    .filter((statement) => statement.startsWith("Global routing"));
  const globalPricing =
    globalDeclarations.length > 0 &&
    globalDeclarations.every(
      (statement) => statement === "Global routing (the default) uses standard pricing.",
    );
  const pricingGeneration = reviewedGeographyGeneration(geography, "pricing", input);
  const dataResidencyGeneration =
    dataResidency === ""
      ? undefined
      : reviewedGeographyGeneration(
          sectionProse(dataResidency, 2, "Inference geo"),
          "data-residency",
          input,
        );
  const matchingGeneration =
    pricingGeneration !== undefined &&
    dataResidencyGeneration !== undefined &&
    pricingGeneration.major === dataResidencyGeneration.major &&
    pricingGeneration.minor === dataResidencyGeneration.minor;
  const scopeKnown = matchingGeneration && globalPricing;
  if (inferenceGeoMultiplier === undefined)
    input.onPricingReconciliation?.({
      disposition: "unresolved",
      reason_code: "inference_geo_multiplier_drift",
      sample: "US inference multiplier",
    });
  if (
    pricingGeneration === undefined ||
    !globalPricing ||
    (dataResidency !== "" && !matchingGeneration)
  )
    input.onPricingReconciliation?.({
      disposition: "unresolved",
      reason_code: "inference_geo_eligibility_conflict",
      sample: "pricing and data-residency applicability, including global base pricing",
    });
  const thresholds = [pricingGeneration, dataResidencyGeneration].filter(
    (value) => value !== undefined,
  );
  for (const item of models.values()) {
    const knownGeneration = modelGeneration(item.model_id) !== undefined;
    const affected =
      item.price_facts.length > 0 &&
      (!knownGeneration ||
        thresholds.length === 0 ||
        thresholds.some((value) => atLeastGeneration(item.model_id, value)));
    if (!affected) continue;
    if (globalPricing)
      item.price_facts = item.price_facts.map((rate) => ({
        ...rate,
        conditions: { ...rate.conditions, inference_geo: "global" },
      }));
    if (scopeKnown && inferenceGeoMultiplier !== undefined && knownGeneration) {
      item.price_facts.push(
        ...item.price_facts.map((rate): SourcePriceFact => ({
          ...rate,
          price: multiplyDecimal(rate.price, inferenceGeoMultiplier),
          conditions: { ...rate.conditions, inference_geo: "us" },
          derived: true,
          derivation:
            inferenceGeoMultiplier +
            " × " +
            (rate.derivation ?? "published rate") +
            " for US-only inference",
          raw_price: undefined,
          raw_unit: "published inference geography multiplier",
        })),
      );
    } else {
      item.raw_price_facts.push({
        term_key: "unparsed:inference-geography",
        impact: "base_price",
        reason: scopeKnown && knownGeneration ? "unknown_amount" : "unknown_applicability",
        conditions: globalPricing ? { inference_geo: "us" } : {},
        source_ref: input.source.id,
        raw: { fragment: geography.slice(0, 4096) || body.slice(0, 4096) },
      });
    }
  }
  if (scopeKnown && inferenceGeoMultiplier !== undefined)
    input.onPricingReconciliation?.({
      disposition: "normalized",
      reason_code: "inference_geo_multiplier_applied",
    });
}

function geographyMultiplier(body: string): string | undefined {
  const amounts = body
    .split(/\r?\n/)
    .filter((line) => /^For Claude\b/.test(line))
    .map(
      (line) =>
        line.match(
          /^For Claude \d+\.\d+ and later models, specifying US-only inference through the `inference_geo` parameter incurs a (\S+)x multiplier on all token pricing categories[.,]/,
        )?.[1],
    );
  const first = amounts[0];
  return first !== undefined &&
    amounts.every(
      (amount) =>
        amount !== undefined &&
        /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(amount) &&
        decimalsEqual(amount, first),
    )
    ? first
    : undefined;
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
  resourceKey: string;
  modelRefs?: string[];
  offerKey: string;
  offerName: string;
  state: SourceCommercialPricingFact["pricing_state"];
  rates?: SourcePriceFact[];
  raw?: SourceCommercialPricingFact["raw_price_facts"];
}

function commercialFact(sourceId: string, value: CommercialFactInput): SourceCommercialPricingFact {
  return {
    source_ref: sourceId,
    book_key: value.bookKey,
    book_name: value.bookName,
    resource_kind: "service",
    resource_key: value.resourceKey,
    model_refs: value.modelRefs ?? [],
    offer_key: value.offerKey,
    offer_name: value.offerName,
    billing_mode: "usage",
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

function usagePricingSection(body: string): string {
  const sections = body.split(/^## Usage and pricing[ \t]*\r?$/im);
  if (sections.length !== 2) return "";
  return (sections[1] ?? "").split(/^#{1,2} /m)[0] ?? "";
}

function agreedAmount(body: string, pattern: RegExp): string | undefined {
  const amounts = [...body.matchAll(pattern)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
  const first = amounts[0];
  return first !== undefined &&
    amounts.every(
      (amount) => /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(amount) && decimalsEqual(amount, first),
    )
    ? first
    : undefined;
}

function ids(value: string): string[] {
  return [...value.matchAll(/claude-[a-z0-9._:/-]+/g)].flatMap((match) =>
    match[0] === undefined ? [] : [match[0]],
  );
}

function commercialPricing(
  bodies: {
    webSearch: string;
    codeExecution: string;
    advisor: string;
    compaction: string;
    compactionThreshold: string;
    fallbackCredit: string;
  },
  input: Input,
  models: Map<string, ProviderModel>,
  pricingInputs: SourcePricingInputFact[],
): SourcePricingFacts {
  const facts: SourceCommercialPricingFact[] = [];
  const vocabulary: ProviderAtomRegistryEntry[] = [];
  const callableRefs = [...models.values()].filter(callable).map(({ uid }) => uid);
  const report = (normalized: boolean | "raw", reasonCode: string, sample: string): void =>
    input.onPricingReconciliation?.({
      disposition: normalized === "raw" ? "raw" : normalized ? "normalized" : "unresolved",
      reason_code: reasonCode,
      sample,
    });
  const reportUsage = (valid: boolean, claim: string): void => {
    if (!valid) contractFinding(input, "accounting_contract_drift", claim);
  };

  const compaction = [bodies.compaction, bodies.compactionThreshold].join(" ").replace(/\s+/g, " ");
  const compactionBilling =
    compaction.includes("Compaction requires an additional sampling step") &&
    compaction.includes("sum across all entries in the `usage.iterations` array") &&
    compaction.includes(
      "top-level `input_tokens` and `output_tokens` do not include compaction iteration usage",
    ) &&
    compaction.includes(
      "Re-applying a previous `compaction` block incurs no additional compaction cost",
    );
  const compactionInputs = compactionBilling
    ? anthropicIterationInputs([bodies.compaction, bodies.compactionThreshold].join("\n"), input)
    : [];
  reportUsage(
    ["uncached_input_tokens", "output_tokens"].every((signal) =>
      compactionInputs.some(({ key }) => key === `messages.usage.${signal}`),
    ),
    "Compaction iterations",
  );
  pricingInputs.push(...compactionInputs);

  const searchAmount = agreedAmount(
    usagePricingSection(bodies.webSearch),
    /\$((?:0|[1-9]\d*)(?:\.\d+)?)(?: USD)? per 1,000 searches/g,
  );
  const searchInput = anthropicSearchInput(bodies.webSearch, input);
  const searchSignal = searchInput !== undefined;
  if (searchInput !== undefined) pricingInputs.push(searchInput);
  if (bodies.webSearch.trim() !== "") {
    const rate =
      searchAmount === undefined
        ? undefined
        : publishedRate(
            "web_search",
            searchAmount,
            "thousand_events",
            input.source.id,
            "per 1,000 successful searches",
          );
    if (rate !== undefined)
      rate.source_locator = {
        kind: "fragment",
        value: "/docs/en/agents-and-tools/tool-use/web-search-tool.md#usage-and-pricing",
      };
    facts.push(
      commercialFact(input.source.id, {
        bookKey: "service:web-search",
        bookName: "Web Search",
        resourceKey: "web-search",
        modelRefs: callableRefs,
        offerKey: "usage",
        offerName: "Successful search",
        state: "numeric",
        rates: rate === undefined ? [] : [rate],
        raw:
          rate === undefined
            ? [
                commercialRaw(
                  "unparsed:web-search-price",
                  "base_price",
                  "unsupported_structure",
                  bodies.webSearch.slice(0, 4096),
                  input.source.id,
                ),
              ]
            : [],
      }),
    );
  }
  report(
    searchAmount !== undefined ? true : bodies.webSearch.trim() === "" ? false : "raw",
    "web_search_service_bound",
    "Web Search rate",
  );
  reportUsage(searchSignal, "Web Search usage signal");

  const codeTable = tables(bodies.codeExecution).find(
    (table) => table.headers.join("|") === "Model|Tool versions",
  );
  const codeText = text(usagePricingSection(bodies.codeExecution));
  const codeEvidence = codeText || text(bodies.codeExecution);
  const codeIds = new Set(listedModelIds(bodies.codeExecution) ?? []);
  const codeRefs = new Set<string>();
  for (const values of codeTable?.rows ?? []) {
    const rawId = ids(values[0] ?? "")[0];
    if (rawId !== undefined) codeIds.add(rawId);
  }
  for (const id of codeIds) {
    const item = commercialModel(models, id);
    if (item !== undefined && callable(item)) codeRefs.add(item.uid);
  }
  const codeAmount = agreedAmount(
    codeText,
    /\$((?:0|[1-9]\d*)(?:\.\d+)?) USD per hour, per container/g,
  );
  const minimumQuote = agreedAmount(codeText, /minimum of ([^ ]+) minutes/g);
  const minimum = /^\d+$/.test(minimumQuote ?? "") ? minimumQuote : undefined;
  const allowanceQuotes = [...codeText.matchAll(/([^ ]+) free hours of usage per month/g)].flatMap(
    (match) => (match[1] === undefined ? [] : [match[1]]),
  );
  const allowanceQuote = allowanceQuotes[0];
  const monthlyAllowance =
    allowanceQuote !== undefined &&
    allowanceQuotes.every(
      (quote) =>
        /^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)$/.test(quote) &&
        quote.replaceAll(",", "") === allowanceQuote.replaceAll(",", ""),
    )
      ? allowanceQuote
      : undefined;
  const webAssisted =
    codeText.includes("Code execution is free when used with web search or web fetch") &&
    bodies.codeExecution.includes("web_search_20260209") &&
    bodies.codeExecution.includes("web_fetch_20260209");
  const scope = [...codeRefs];
  if (scope.length > 0) {
    let rate =
      codeAmount === undefined
        ? undefined
        : publishedRate(
            "container_runtime",
            codeAmount,
            "hour",
            input.source.id,
            "per container-hour",
          );
    if (rate !== undefined)
      rate.source_locator = {
        kind: "fragment",
        value: "/docs/en/agents-and-tools/tool-use/code-execution-tool.md#usage-and-pricing",
      };
    const code =
      rate === undefined ? undefined : anthropicCodeExecution(rate, minimum, monthlyAllowance);
    if (code !== undefined) {
      rate = code.rate;
      vocabulary.push(...code.vocabulary);
    }
    const raw = [
      ...(rate === undefined
        ? [
            commercialRaw(
              "unparsed:code-execution-price",
              "base_price",
              "unsupported_structure",
              codeEvidence.slice(0, 4096),
              input.source.id,
            ),
          ]
        : []),
      ...(minimum === undefined
        ? [
            commercialRaw(
              "unparsed:minimum-runtime",
              "base_price",
              "unsupported_structure",
              codeEvidence.slice(0, 4096),
              input.source.id,
            ),
          ]
        : rate === undefined
          ? [
              commercialRaw(
                "minimum-runtime",
                "informational",
                "unsupported_structure",
                `${minimum}-minute minimum execution time`,
                input.source.id,
              ),
            ]
          : []),
      ...(monthlyAllowance === undefined
        ? [
            commercialRaw(
              "unparsed:monthly-container-allowance",
              "allowance",
              "unsupported_structure",
              codeEvidence.slice(0, 4096),
              input.source.id,
            ),
          ]
        : rate === undefined
          ? [
              commercialRaw(
                "monthly-container-allowance",
                "allowance",
                "unsupported_structure",
                `${monthlyAllowance} free container-hours per organization per month`,
                input.source.id,
              ),
            ]
          : []),
      ...(rate?.charge_binding === undefined
        ? [
            commercialRaw(
              "runtime-observation",
              "informational",
              "requires_usage_aggregation",
              "Messages usage reports code-execution request count, not billable container duration",
              input.source.id,
            ),
          ]
        : []),
    ];
    const codeFact = commercialFact(input.source.id, {
      bookKey: "service:code-execution",
      bookName: "Code Execution",
      resourceKey: "code-execution",
      modelRefs: scope,
      offerKey: "standalone",
      offerName: "Standalone Code Execution",
      state: "numeric",
      rates: rate === undefined ? [] : [rate],
      raw,
    });
    if (code !== undefined && code.terms.length > 0) codeFact.terms = code.terms;
    facts.push(codeFact);
  }
  if (webAssisted && scope.length > 0)
    facts.push(
      commercialFact(input.source.id, {
        bookKey: "service:code-execution",
        bookName: "Code Execution",
        resourceKey: "code-execution",
        modelRefs: scope,
        offerKey: "web-assisted",
        offerName: "Web-assisted Code Execution",
        state: "included",
      }),
    );
  report(
    codeIds.size > 0 && codeRefs.size === codeIds.size,
    "code_execution_scope_bound",
    "Code Execution model scope",
  );
  if (bodies.codeExecution.trim() !== "" && (codeIds.size === 0 || codeRefs.size !== codeIds.size))
    input.onPricingDependencyFailure?.(
      "https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool.md",
    );
  report(codeAmount !== undefined, "code_execution_rate_bound", "Code Execution rate");
  report(minimum !== undefined, "code_execution_minimum_bound", "Code Execution minimum");
  report(
    monthlyAllowance !== undefined,
    "code_execution_allowance_bound",
    "Code Execution allowance",
  );
  report(webAssisted, "code_execution_web_assisted_bound", "Web-assisted Code Execution");

  const advisorBilling =
    bodies.advisor.includes("separate sub-inference billed at the advisor model's rates") &&
    bodies.advisor.includes("usage.iterations");
  reportUsage(advisorBilling, "Advisor sub-inference model usage");

  const fallbackContract =
    bodies.fallbackCredit.includes("fallback_credit_token") &&
    bodies.fallbackCredit.includes("five-minute window") &&
    bodies.fallbackCredit.includes("cache_creation_input_tokens") &&
    bodies.fallbackCredit.includes("cache_read_input_tokens");
  reportUsage(fallbackContract, "Fallback retry usage outcome");

  return { commercial_facts: facts, pricing_inputs: pricingInputs, vocabulary };
}

export function parseAnthropicCatalog(input: Input): SourceParseResult {
  const bundle = linkedBundleSchema.parse(json(input.body));
  const documents = new Map<string, string>();
  for (const item of bundle.documents) {
    const path = new URL(item.url).pathname;
    if (documents.has(path))
      throw new Error(`Anthropic catalog expected at most one document: ${path}`);
    documents.set(path, item.body);
  }
  const document = (path: string): string => documents.get(path) ?? "";
  const messagesBody = document("/docs/en/api/messages/create.md");
  const modelIds = document("/docs/en/about-claude/models/model-ids-and-versions.md");
  const modelsList = document("/docs/en/api/models/list.md");
  if (modelIds && modelsList) validateModelIdentityContract(modelIds, modelsList, input);
  const dataResidency = document("/docs/en/manage-claude/data-residency.md");
  const requestInputs = validateRequestAccounting(
    messagesBody,
    dataResidency,
    document("/docs/en/build-with-claude/prompt-caching.md"),
    input,
  );
  const models = new Map<string, ProviderModel>();
  const observeLimit = limitObserver(input);
  overview(bundle.index.body, input, models, observeLimit);
  const lifecycleBody = document("/docs/en/about-claude/model-deprecations.md");
  if (lifecycleBody) lifecycle(lifecycleBody, input, models);
  const releases = document("/docs/en/release-notes/overview.md");
  if (releases) releaseNotes(releases, input, models);
  const pricingBody = document("/docs/en/about-claude/pricing.md");
  if (pricingBody)
    pricing(
      pricingBody,
      document("/docs/en/build-with-claude/fast-mode.md"),
      dataResidency,
      input,
      models,
      observeLimit,
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
      overview: bundle.index.body,
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
      thinkingSupport: document("/docs/en/build-with-claude/thinking-troubleshooting.md"),
      toolUse: document("/docs/en/agents-and-tools/tool-use/define-tools.md"),
    },
    models,
    input,
  );
  const commercial = commercialPricing(
    {
      webSearch: document("/docs/en/agents-and-tools/tool-use/web-search-tool.md"),
      codeExecution: document("/docs/en/agents-and-tools/tool-use/code-execution-tool.md"),
      advisor: document("/docs/en/agents-and-tools/tool-use/advisor-tool.md"),
      compaction: document("/docs/en/build-with-claude/compaction.md"),
      compactionThreshold: document("/docs/en/build-with-claude/compaction-threshold.md"),
      fallbackCredit: document("/docs/en/build-with-claude/fallback-credit.md"),
    },
    input,
    models,
    requestInputs,
  );
  return {
    models: [...models.values()].sort((left, right) => left.uid.localeCompare(right.uid)),
    ...commercial,
  };
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
    rootKeys: [
      "id",
      "type",
      "display_name",
      "created_at",
      "max_input_tokens",
      "max_tokens",
      "capabilities",
    ],
    skipInvalidItems: true,
    ...(input.onContractFinding === undefined ? {} : { onFinding: input.onContractFinding }),
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
