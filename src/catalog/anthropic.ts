import { z } from "zod";
import { linkedBundleSchema } from "./bundle.ts";
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
import { assertItemCount, recognizeItems, type SourceContractEvidence } from "./source-contract.ts";
import { type Modality, type Provider, unknownCapabilities } from "./schema.ts";

interface Input {
  provider: Provider;
  source: SourceManifest;
  body: string;
  observedAt: string;
  onContractFinding?: (evidence: SourceContractEvidence) => void;
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
      if (values.length === headers.length) rows.push(values);
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
  if (featureTables.length === 0)
    input.onPricingReconciliation?.({
      disposition: "unresolved",
      reason_code: "model_overview_drift",
      sample: "model feature tables",
    });
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
      const name = table.headers[column]?.replace(/\s*\(deprecated\)$/i, "");
      if (name) item.name = name;
      item.description = descriptions?.[column] || item.description;
      const alias = aliases?.[column];
      if (alias !== undefined && alias !== id && modelIdSchema.safeParse(alias).success)
        item.aliases = [...new Set([...item.aliases, alias])];
      item.modalities = { input: ["text", "image"], output: ["text"] };
      const thinking = [extended?.[column], adaptive?.[column], thinkingMode?.[column]].filter(
        (value): value is string => value !== undefined,
      );
      if (thinking.some((value) => /^(?:Yes|Adaptive|Extended)\b/.test(value)))
        item.capabilities.reasoning = true;
      else if (
        thinking.length > 0 &&
        thinking.every((value) => /^(?:No|Not supported)$/.test(value))
      )
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
    if (target === undefined || sources.length !== 1 || sources[0] === undefined) {
      input.onPricingReconciliation?.({
        disposition: "unbound",
        reason_code: "shared_model_fact_unbound",
        sample: targetId,
      });
      continue;
    }
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
  const conflicts = new Set<string>();
  for (const line of body.split(/\r?\n/)) {
    const heading = line.match(/^### (.+)$/)?.[1];
    if (heading !== undefined) currentDate = date(heading);
    const subject = line.match(/^[*-] We've launched (.+)$/)?.[1];
    if (subject === undefined) continue;
    const opening = text(subject.split(",", 1)[0] ?? "");
    if (!/^Claude (?:Fable|Mythos|Opus|Sonnet|Haiku|\d)\b/.test(opening)) continue;
    if (currentDate === undefined) {
      input.onPricingReconciliation?.({
        disposition: "unresolved",
        reason_code: "release_notes_drift",
        sample: opening,
      });
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
        input.onPricingReconciliation?.({
          disposition: "unresolved",
          reason_code: "release_date_conflict",
          sample: item.model_id,
        });
      } else item.release_date = currentDate;
      launches += 1;
    }
  }
  if (launches === 0)
    input.onPricingReconciliation?.({
      disposition: "unresolved",
      reason_code: "release_notes_drift",
      sample: "model launches",
    });
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
  if (statusTable === undefined)
    input.onPricingReconciliation?.({
      disposition: "unresolved",
      reason_code: "lifecycle_table_drift",
      sample: "model status",
    });
  for (const values of statusTable?.rows ?? []) {
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
    if (deprecatedAt === undefined) {
      input.onPricingReconciliation?.({
        disposition: "unresolved",
        reason_code: "lifecycle_table_drift",
        sample: "historical announcement date",
      });
      continue;
    }
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

function listedModelIds(body: string): string[] | undefined {
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

  const codeIds = listedModelIds(bodies.codeExecution);
  const codeTable = tables(bodies.codeExecution).find(
    (table) => table.headers.join("|") === "Model|Tool versions",
  );
  if (codeIds !== undefined) {
    for (const item of supported) item.capabilities.code_execution = false;
    for (const id of codeIds) {
      const item = commercialModel(models, id);
      if (item !== undefined && callable(item)) item.capabilities.code_execution = true;
      else
        input.onPricingReconciliation?.({
          disposition: "unbound",
          reason_code: "capability_model_unbound",
          sample: `code execution: ${id}`,
        });
    }
  } else if (codeTable !== undefined && codeTable.rows.length > 0) {
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

function validateModelIdentityContract(body: string, modelsListBody: string, input: Input): void {
  const report = (valid: boolean, sample: string): void => {
    if (!valid)
      input.onPricingReconciliation?.({
        disposition: "unresolved",
        reason_code: "model_identity_contract_drift",
        sample,
      });
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

function validateRequestAccounting(
  messages: string,
  dataResidency: string,
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
    contract(messages.includes(`- \`${field}:`), `Messages usage.${field}`);

  const dataResidencyGeneration = reviewedGeographyGeneration(
    dataResidency,
    "data-residency",
    input,
  );
  contract(
    dataResidency.includes("The response `usage` object includes an `inference_geo` field") &&
      dataResidency.includes("`allowed_inference_geos`") &&
      dataResidency.includes("`default_inference_geo`") &&
      dataResidency.includes("return a 400 error"),
    "inference-geography outcomes",
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
        ...item.price_facts.map((rate): SourcePriceFact => ({
          ...rate,
          price: multiplyDecimal(rate.price, inferenceGeoMultiplier),
          conditions: { ...rate.conditions, inference_geo: "us" },
          derived: true,
          derivation: `${inferenceGeoMultiplier} × ${rate.derivation ?? "published rate"} for US-only inference`,
          raw_price: undefined,
          raw_unit: "published inference geography multiplier",
        })),
      );
    }
    input.onPricingReconciliation?.({
      disposition: "normalized",
      reason_code: "inference_geo_multiplier_applied",
    });
  }
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
    fallbackCredit: string;
  },
  input: Input,
  models: Map<string, ProviderModel>,
): void {
  const facts: SourceCommercialPricingFact[] = [];
  const callableRefs = [...models.values()].filter(callable).map(({ uid }) => uid);
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
      commercialFact(input.source.id, {
        bookKey: "service:web-search",
        bookName: "Web Search",
        resourceKey: "web-search",
        modelRefs: callableRefs,
        offerKey: "usage",
        offerName: "Successful search",
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
      }),
    );
  }
  report(searchAmount !== undefined, "web_search_service_bound", "Web Search rate");
  report(searchSignal, "web_search_usage_bound", "Web Search usage signal");

  const codeTable = tables(bodies.codeExecution).find(
    (table) => table.headers.join("|") === "Model|Tool versions",
  );
  const codeText = text(bodies.codeExecution);
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
  const codeAmount = codeText.match(
    /\$((?:0|[1-9]\d*)(?:\.\d+)?) USD per hour, per container/,
  )?.[1];
  const minimum = codeText.match(/minimum of (\d+) minutes/)?.[1];
  const monthlyAllowance = codeText.match(/([\d,]+) free hours of usage per month/)?.[1];
  const webAssisted =
    codeText.includes("Code execution is free when used with web search or web fetch") &&
    bodies.codeExecution.includes("web_search_20260209") &&
    bodies.codeExecution.includes("web_fetch_20260209");
  const scope = [...codeRefs];
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
    const raw = [
      ...(minimum === undefined
        ? []
        : [
            commercialRaw(
              "minimum-runtime",
              "informational",
              "unsupported_structure",
              `${minimum}-minute minimum execution time`,
              input.source.id,
            ),
          ]),
      ...(monthlyAllowance === undefined
        ? []
        : [
            commercialRaw(
              "monthly-container-allowance",
              "allowance",
              "unsupported_structure",
              `${monthlyAllowance} free container-hours per organization per month`,
              input.source.id,
            ),
          ]),
      commercialRaw(
        "runtime-observation",
        "informational",
        "requires_usage_aggregation",
        "Messages usage reports code-execution request count, not billable container duration",
        input.source.id,
      ),
    ];
    facts.push(
      commercialFact(input.source.id, {
        bookKey: "service:code-execution",
        bookName: "Code Execution",
        resourceKey: "code-execution",
        modelRefs: scope,
        offerKey: "standalone",
        offerName: "Standalone Code Execution",
        state: "numeric",
        rates: [rate],
        raw,
      }),
    );
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
  report(advisorBilling, "advisor_usage_ledger_bound", "Advisor sub-inference model usage");

  const fallbackContract =
    bodies.fallbackCredit.includes("fallback_credit_token") &&
    bodies.fallbackCredit.includes("five-minute window") &&
    bodies.fallbackCredit.includes("cache_creation_input_tokens") &&
    bodies.fallbackCredit.includes("cache_read_input_tokens");
  report(fallbackContract, "fallback_usage_outcome_bound", "Fallback retry usage outcome");

  const carrier = [...models.values()].find(({ price_facts }) => price_facts.length > 0);
  if (carrier !== undefined && facts.length > 0) carrier.commercial_facts = facts;
}

export function parseAnthropicCatalog(input: Input): ProviderModel[] {
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
  const dataResidencyGeneration = validateRequestAccounting(
    messagesBody,
    document("/docs/en/manage-claude/data-residency.md"),
    input,
  );
  const models = new Map<string, ProviderModel>();
  overview(bundle.index.body, input, models);
  const lifecycleBody = document("/docs/en/about-claude/model-deprecations.md");
  if (lifecycleBody) lifecycle(lifecycleBody, input, models);
  const releases = document("/docs/en/release-notes/overview.md");
  if (releases) releaseNotes(releases, input, models);
  const pricingBody = document("/docs/en/about-claude/pricing.md");
  if (pricingBody)
    pricing(
      pricingBody,
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
      webSearch: document("/docs/en/agents-and-tools/tool-use/web-search-tool.md"),
      codeExecution: document("/docs/en/agents-and-tools/tool-use/code-execution-tool.md"),
      advisor: document("/docs/en/agents-and-tools/tool-use/advisor-tool.md"),
      compaction: document("/docs/en/build-with-claude/compaction.md"),
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
