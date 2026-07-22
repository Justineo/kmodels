import { load } from "cheerio";
import { z } from "zod";
import { linkedBundleSchema } from "./bundle.ts";
import { modelIdSchema } from "./identity.ts";
import type { SourceManifest } from "./manifests.ts";
import { baseModel } from "./model.ts";
import { publishedRate } from "./pricing.ts";
import {
  modelTypeSchema,
  type Modality,
  type ModelType,
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

interface Evidence {
  model: ProviderModel;
  names: Set<string>;
}

type LoadedDocument = ReturnType<typeof load>;
type Selection = ReturnType<LoadedDocument>;

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
const typeOrder = new Map(modelTypeSchema.options.map((value, index) => [value, index]));
const apiItemSchema = z.object({
  name: z.string().regex(/^publishers\/[a-z0-9-]+\/models\/[a-z0-9][a-z0-9._:/@-]*$/i),
  launchStage: z.string().optional(),
  versionState: z.string().optional(),
});
const apiBundleSchema = z.object({
  publishers: z
    .array(
      z.object({
        publisher: z.string().min(1),
        models: z.array(z.unknown()),
      }),
    )
    .min(1),
});

function text(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function orderedTypes(values: ModelType[]): ModelType[] {
  const result = unique(values);
  return result.sort(
    (left, right) =>
      (typeOrder.get(left) ?? typeOrder.size) - (typeOrder.get(right) ?? typeOrder.size),
  );
}

function modelDate(value: string): string | undefined {
  const iso = value.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
  if (iso !== undefined) return iso;
  const match = value.match(/\b([A-Z][a-z]+) (\d{1,2}), (\d{4})\b/);
  const month = match?.[1] === undefined ? undefined : months.get(match[1]);
  return month === undefined || match?.[2] === undefined || match[3] === undefined
    ? undefined
    : `${match[3]}-${month}-${match[2].padStart(2, "0")}`;
}

function rowCell($: LoadedDocument, table: Selection, label: RegExp): Selection | undefined {
  let result: Selection | undefined;
  table.find("tr").each((_index, row) => {
    const cells = $(row).find("th,td");
    if (result === undefined && cells.length >= 2 && label.test(text(cells.eq(0).text())))
      result = cells.slice(1);
  });
  return result;
}

function media(value: string): Modality[] {
  const lower = value.toLowerCase();
  const result: Modality[] = [];
  if (/\btext\b|\bcode\b/.test(lower)) result.push("text");
  if (/\bimages?\b|\bvision\b/.test(lower)) result.push("image");
  if (/\baudio\b|\bmusic\b/.test(lower)) result.push("audio");
  if (/\bvideos?\b/.test(lower)) result.push("video");
  if (/\bpdfs?\b|\bdocuments?\b/.test(lower)) result.push("pdf");
  if (/\bembeddings?\b/.test(lower)) result.push("embedding");
  return unique(result);
}

function modalities($: LoadedDocument, table: Selection): ProviderModel["modalities"] {
  const cell =
    rowCell($, table, /^Modalities$/i) ?? rowCell($, table, /^Supported inputs? & outputs?$/i);
  if (cell === undefined) return { input: [], output: [] };
  const input: Modality[] = [];
  const output: Modality[] = [];
  cell.find(".geap-modality").each((_index, element) => {
    const item = $(element);
    const modality = media(text(item.find(".geap-modality-label").first().text()));
    const support = text(item.find(".geap-supported-modality").first().text()).toLowerCase();
    if (support.includes("input only") || support.includes("input and output"))
      input.push(...modality);
    if (support.includes("output only") || support.includes("input and output"))
      output.push(...modality);
  });
  if (input.length + output.length === 0) {
    const value = text(cell.text());
    const parts = value.split(/\bOutputs?:/i);
    input.push(...media(parts[0]?.replace(/^Inputs?:/i, "") ?? ""));
    output.push(...media(parts[1] ?? ""));
  }
  return { input: unique(input), output: unique(output) };
}

function number(value: string, pattern: RegExp): number | undefined {
  const raw = value.match(pattern)?.[1];
  if (raw === undefined) return undefined;
  const result = Number(raw.replaceAll(",", ""));
  return Number.isSafeInteger(result) && result > 0 ? result : undefined;
}

function tokens(value: string, pattern: RegExp): number | undefined {
  const match = value.match(pattern);
  const raw = match?.[1];
  if (raw === undefined) return undefined;
  const unit = match?.[2]?.toLowerCase();
  const scale =
    unit === "k" || unit === "thousand"
      ? 1_000
      : unit === "m" || unit === "million"
        ? 1_000_000
        : 1;
  const result = Number(raw.replaceAll(",", "")) * scale;
  return Number.isSafeInteger(result) && result > 0 ? result : undefined;
}

function limits($: LoadedDocument, table: Selection): ProviderModel["limits"] {
  const outputCell = rowCell($, table, /^Maximum output tokens$/i);
  const value = text(
    [
      rowCell($, table, /^Token limits$/i),
      rowCell($, table, /^Quotas?$/i),
      rowCell($, table, /^Maximum sequence length$/i),
      outputCell,
      rowCell($, table, /^Output dimensions$/i),
    ]
      .flatMap((cell) => (cell === undefined ? [] : [cell.text()]))
      .join(" "),
  );
  const context =
    tokens(
      value,
      /([\d,.]+)\s*(K|M|thousand|million)?\s+(?:context length|maximum input tokens)/i,
    ) ??
    tokens(
      value,
      /(?:Context window|Context length|Maximum input tokens|Maximum sequence length)\s*(?:is|of|:|-)?\s*([\d,.]+)\s*(K|M|thousand|million)?/i,
    );
  const input =
    tokens(value, /([\d,.]+)\s*(K|M|thousand|million)?\s+maximum input tokens/i) ??
    tokens(value, /Maximum input tokens\s*(?:is|of|:|-)?\s*([\d,.]+)\s*(K|M|thousand|million)?/i) ??
    context;
  const output =
    tokens(text(outputCell?.text() ?? ""), /([\d,.]+)\s*(K|M|thousand|million)?/i) ??
    tokens(
      value,
      /([\d,.]+)\s*(K|M|thousand|million)?\s+(?:maximum output tokens|maximum output|max output)/i,
    ) ??
    tokens(
      value,
      /(?:Maximum output tokens|Max output)\s*(?:is|of|:|-)?\s*([\d,.]+)\s*(K|M|thousand|million)?/i,
    );
  const dimensions = number(value, /Output dimensions?\D*([\d,]+)/i);
  return {
    ...(context === undefined ? {} : { context_tokens: context }),
    ...(input === undefined ? {} : { max_input_tokens: input }),
    ...(output === undefined ? {} : { max_output_tokens: output }),
    ...(/\bUp to\b/i.test(value) || dimensions === undefined
      ? {}
      : { embedding_dimensions: [dimensions] }),
  };
}

function support(
  $: LoadedDocument,
  cell: Selection | undefined,
  labels: RegExp,
): boolean | "unknown" {
  if (cell === undefined) return "unknown";
  let featureResult: boolean | "unknown" = "unknown";
  cell.find(".geap-feature").each((_index, feature) => {
    const item = $(feature);
    if (!labels.test(text(item.text()))) return;
    featureResult = item.find(".geap-not-supported").length > 0 ? false : true;
  });
  if (featureResult !== "unknown") return featureResult;
  if (
    cell
      .find(".geap-capabilities-supported")
      .filter((_index, section) => labels.test(text($(section).text()))).length > 0
  )
    return true;
  if (
    cell
      .find(".geap-capabilities-not-supported")
      .filter((_index, section) => labels.test(text($(section).text()))).length > 0
  )
    return false;
  const sections = cell.find("section");
  let result: boolean | "unknown" = "unknown";
  sections.each((_index, section) => {
    const item = text($(section).text());
    if (!labels.test(item)) return;
    if (/not supported/i.test(item)) result = false;
    else if (/supported/i.test(item)) result = true;
  });
  if (result !== "unknown") return result;
  const value = text(cell.text());
  const split = value.search(/\bNot supported\b/i);
  const match = value.search(labels);
  if (match < 0) return "unknown";
  return split < 0 || match < split;
}

function capabilities($: LoadedDocument, table: Selection): ProviderModel["capabilities"] {
  const capability = rowCell($, table, /^Capabilities$/i);
  const consumption = rowCell($, table, /^(?:Consumption options|Usage types)$/i) ?? capability;
  return {
    ...unknownCapabilities(),
    reasoning: support($, capability, /\b(?:Thinking|Reasoning|Extended thinking)\b/i),
    tool_call: support($, capability, /\bFunction calling\b/i),
    structured_output: support($, capability, /\bStructured outputs?\b/i),
    streaming: support($, capability, /\b(?:Gemini )?Live API\b/i),
    batch: support($, consumption, /\bBatch (?:inference|predictions?)\b/i),
    prompt_cache: support($, capability, /\b(?:Prompt|Context) cach(?:e|ing)\b/i),
    code_execution: support($, capability, /\bCode execution\b/i),
    computer_use: support($, capability, /\bComputer use\b/i),
  };
}

function modelTypes(
  id: string,
  name: string,
  observed: ProviderModel["modalities"],
  features: ProviderModel["capabilities"],
): ModelType[] {
  const value = `${id} ${name}`.toLowerCase();
  const result: ModelType[] = [];
  const ocr = /\bocr\b/.test(value);
  if (observed.output.includes("embedding") || /\bembedding/.test(value)) result.push("embeddings");
  if (observed.output.includes("video")) result.push("video");
  if (observed.output.includes("image")) result.push("image");
  if (observed.output.includes("audio"))
    result.push(/\blyria\b|\bmusic\b/.test(value) ? "audio_generation" : "audio_speech");
  if (ocr) result.push("ocr");
  else if (observed.output.includes("text")) result.push("generate");
  if (/\blive\b|\brealtime\b|\bomni\b/.test(value)) result.push("realtime");
  if (features.computer_use === true) result.push("agentic");
  return orderedTypes(result.length === 0 ? ["other"] : result);
}

function status(value: string): ProviderModel["status"] {
  const lower = value.toLowerCase();
  if (/retired|discontinued|shut down/.test(lower)) return "retired";
  if (/deprecated/.test(lower)) return "deprecated";
  if (/preview|experimental/.test(lower)) return "preview";
  if (/generally available|\bga\b/.test(lower)) return "active";
  return "unknown";
}

function regions($: LoadedDocument, table: Selection): ProviderModel["availability"] {
  const cell = rowCell($, table, /^Supported regions$/i);
  const values = unique(
    cell
      ?.find("code")
      .map((_index, element) => text($(element).text()))
      .get()
      .filter((value) => /^(?:global|us|eu|[a-z]+-[a-z]+\d)$/i.test(value)) ?? [],
  );
  return values.length === 0
    ? undefined
    : values.map((region) => ({ region, deployment_type: "managed_api" }));
}

function pageName(title: string, heading: string, count: number): string {
  if (count === 1 || heading === "") return title;
  if (/deprecations?/i.test(title)) return heading;
  const first = title.split(" ")[0] ?? title;
  return /^\d/.test(heading) ? `${first} ${heading}` : `${title} ${heading}`;
}

function description($: LoadedDocument, heading: Selection): string | undefined {
  const scoped =
    heading.length === 0
      ? $(".devsite-article-body > p").first()
      : heading.nextUntil("h2").filter("p").first();
  const value = text(scoped.text()) || text($(".devsite-article-body > p").first().text());
  return value || undefined;
}

function mergeEvidence(current: Evidence | undefined, incoming: Evidence): Evidence {
  if (current === undefined) return incoming;
  const model = current.model;
  const next = incoming.model;
  model.name =
    model.name === model.model_id && next.name !== next.model_id ? next.name : model.name;
  model.description ??= next.description;
  model.types = orderedTypes([...model.types.filter((value) => value !== "other"), ...next.types]);
  if (model.modalities.input.length + model.modalities.output.length === 0)
    model.modalities = next.modalities;
  const known = <T extends boolean | "unknown">(left: T, right: T): T =>
    left === "unknown" ? right : left;
  model.capabilities = {
    reasoning: known(model.capabilities.reasoning, next.capabilities.reasoning),
    tool_call: known(model.capabilities.tool_call, next.capabilities.tool_call),
    structured_output: known(
      model.capabilities.structured_output,
      next.capabilities.structured_output,
    ),
    streaming: known(model.capabilities.streaming, next.capabilities.streaming),
    batch: known(model.capabilities.batch, next.capabilities.batch),
    prompt_cache: known(model.capabilities.prompt_cache, next.capabilities.prompt_cache),
    fine_tuning: known(model.capabilities.fine_tuning, next.capabilities.fine_tuning),
    citations: known(model.capabilities.citations, next.capabilities.citations),
    code_execution: known(model.capabilities.code_execution, next.capabilities.code_execution),
    context_management: known(
      model.capabilities.context_management,
      next.capabilities.context_management,
    ),
    effort_control: known(model.capabilities.effort_control, next.capabilities.effort_control),
    computer_use: known(model.capabilities.computer_use, next.capabilities.computer_use),
  };
  model.limits = { ...next.limits, ...model.limits };
  model.release_date ??= next.release_date;
  model.deprecated_at ??= next.deprecated_at;
  model.retired_at ??= next.retired_at;
  if (
    next.status === "retired" ||
    (next.status === "deprecated" && model.status !== "retired") ||
    model.status === "unknown"
  )
    model.status = next.status;
  if (next.is_deprecated === true || model.is_deprecated === "unknown")
    model.is_deprecated = next.is_deprecated;
  model.replacement_model_ids = unique([
    ...model.replacement_model_ids,
    ...next.replacement_model_ids,
  ]);
  model.availability = [
    ...new Map(
      [...(model.availability ?? []), ...(next.availability ?? [])].map((item) => [
        `${item.region}\0${item.deployment_type}`,
        item,
      ]),
    ).values(),
  ];
  return { model, names: new Set([...current.names, ...incoming.names]) };
}

function add(models: Map<string, Evidence>, evidence: Evidence): void {
  models.set(evidence.model.model_id, mergeEvidence(models.get(evidence.model.model_id), evidence));
}

function parseModelTables(models: Map<string, Evidence>, input: Input, body: string): void {
  const $ = load(body);
  const tables = $(".devsite-article-body table").filter((_index, table) => {
    const cells = $(table).find("tr").first().find("th,td");
    return /^Model ID$/i.test(text(cells.eq(0).text()));
  });
  const title = text($("h1").first().clone().children().remove().end().text());
  tables.each((_index, tableElement) => {
    const table = $(tableElement);
    const idCell = rowCell($, table, /^Model ID$/i);
    const id = text(idCell?.find("code").first().text() ?? idCell?.text() ?? "");
    if (!modelIdSchema.safeParse(id).success) return;
    const heading = table.prevAll("h2,h3,h4").first();
    const headingText = text(heading.clone().children().remove().end().text());
    const name = pageName(title || id, headingText, tables.length);
    const observedModalities = modalities($, table);
    const observedCapabilities = capabilities($, table);
    const versionText = text(rowCell($, table, /^Versions$/i)?.text() ?? "");
    const launchText = `${text(rowCell($, table, /^Launch stage$/i)?.text() ?? "")} ${versionText}`;
    const modelStatus = status(launchText);
    const model = {
      ...baseModel({
        providerId: input.provider.id,
        id,
        name,
        sourceId: input.source.id,
        observedAt: input.observedAt,
      }),
      description: description($, heading),
      types: modelTypes(id, name, observedModalities, observedCapabilities),
      modalities: observedModalities,
      capabilities: observedCapabilities,
      limits: limits($, table),
      release_date: modelDate(versionText),
      status: modelStatus,
      is_deprecated:
        modelStatus === "deprecated" || modelStatus === "retired"
          ? true
          : modelStatus === "active" || modelStatus === "preview"
            ? false
            : "unknown",
      availability: regions($, table),
      scope: "regional_catalog",
    } satisfies ProviderModel;
    const section = text(heading.nextUntil("h2").text());
    const deprecated = section.match(/deprecated as of ([A-Z][a-z]+ \d{1,2}, \d{4})/i)?.[1];
    const shutdown = section.match(/(?:shut down|shutdown) on ([A-Z][a-z]+ \d{1,2}, \d{4})/i)?.[1];
    if (deprecated !== undefined) model.deprecated_at = modelDate(deprecated);
    if (shutdown !== undefined) model.retired_at = modelDate(shutdown);
    if (model.deprecated_at !== undefined) {
      model.status =
        model.retired_at !== undefined && model.retired_at <= input.observedAt.slice(0, 10)
          ? "retired"
          : "deprecated";
      model.is_deprecated = true;
    }
    add(models, { model, names: new Set([name]) });
  });
}

function lifecycleTypes(section: string): ModelType[] {
  const lower = section.toLowerCase();
  if (lower.includes("embedding")) return ["embeddings"];
  if (lower.includes("image")) return ["image"];
  if (lower.includes("veo")) return ["video"];
  return ["generate"];
}

function ensure(
  models: Map<string, Evidence>,
  input: Input,
  id: string,
  types: ModelType[],
): Evidence {
  const current = models.get(id);
  if (current !== undefined) return current;
  const model = {
    ...baseModel({
      providerId: input.provider.id,
      id,
      name: id,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    }),
    types,
    scope: "regional_catalog",
  } satisfies ProviderModel;
  const evidence = { model, names: new Set([id]) };
  models.set(id, evidence);
  return evidence;
}

function applyLifecycle(models: Map<string, Evidence>, input: Input, body: string): void {
  const $ = load(body);
  $(".devsite-article-body table").each((_index, tableElement) => {
    const table = $(tableElement);
    const headers = table
      .find("tr")
      .first()
      .find("th,td")
      .map((_cellIndex, cell) => text($(cell).text()))
      .get();
    if (headers[0] !== "Model ID") return;
    const releaseIndex = headers.findIndex((value) => /^Release date$/i.test(value));
    const retirementIndex = headers.findIndex((value) =>
      /^(?:Retirement|Shutdown) date$/i.test(value),
    );
    const deprecatedIndex = headers.findIndex((value) => /^Deprecation date$/i.test(value));
    const replacementIndex = headers.findIndex((value) =>
      /Replacement|upgrade|alternative/i.test(value),
    );
    if (releaseIndex < 0 && retirementIndex < 0 && deprecatedIndex < 0) return;
    const section = text(table.prevAll("h2,h3,h4").first().text());
    table
      .find("tr")
      .slice(1)
      .each((_rowIndex, row) => {
        const cells = $(row).find("th,td");
        const id = text(cells.eq(0).find("code").first().text() || cells.eq(0).text());
        if (!modelIdSchema.safeParse(id).success) return;
        const item = ensure(models, input, id, lifecycleTypes(section)).model;
        const released =
          releaseIndex < 0 ? undefined : modelDate(text(cells.eq(releaseIndex).text()));
        const retirementText = retirementIndex < 0 ? "" : text(cells.eq(retirementIndex).text());
        const retired = modelDate(retirementText);
        const deprecated =
          deprecatedIndex < 0 ? undefined : modelDate(text(cells.eq(deprecatedIndex).text()));
        const replacements =
          replacementIndex < 0
            ? []
            : cells
                .eq(replacementIndex)
                .find("code")
                .map((_codeIndex, code) => text($(code).text()))
                .get()
                .filter((value) => value !== id && modelIdSchema.safeParse(value).success);
        item.release_date ??= released;
        const exactRetirement = /or later|no sooner/i.test(retirementText) ? undefined : retired;
        item.retired_at ??= exactRetirement;
        item.deprecated_at ??= deprecated;
        item.replacement_model_ids = unique([...item.replacement_model_ids, ...replacements]);
        const pastRetirement =
          exactRetirement !== undefined && exactRetirement <= input.observedAt.slice(0, 10);
        if (deprecated !== undefined || pastRetirement || /retired/i.test(section)) {
          item.status = pastRetirement || /retired/i.test(section) ? "retired" : "deprecated";
          item.is_deprecated = true;
        } else if (item.status === "unknown") {
          item.status = "active";
          item.is_deprecated = false;
        }
      });
  });
}

function priceName(value: string): string {
  return value
    .replace(/\((?:Promotional|Standard Price|Deprecated|Preview|Nano Banana)[^)]*\)/gi, " ")
    .replace(/\bon Google Cloud\b/gi, " ")
    .replace(/\bwith Gemini Live API\b/gi, "Live API")
    .replace(/\bpreview\b/gi, " ")
    .replace(/\b(?:generate|generation)\b/gi, " ")
    .replace(/\b(\d+)\.0\b/g, "$1")
    .replace(/\b001\b/g, " ")
    .replace(/\b\d+[BEM](?:-\d+[A-Z0-9]+)*\b/gi, " ")
    .replace(/[^a-z0-9]+/gi, "")
    .toLowerCase();
}

function priceTarget(
  models: Map<string, Evidence>,
  label: string,
  hint = "",
): ProviderModel | undefined {
  const key = priceName(label);
  if (key === "") return undefined;
  let candidates = [...models.values()].filter((item) =>
    [...item.names].some((name) => priceName(name) === key),
  );
  if (candidates.length > 1 && hint !== "") {
    const hinted = candidates.filter((item) =>
      priceName(`${item.model.name} ${item.model.model_id}`).includes(priceName(hint)),
    );
    if (hinted.length > 0) candidates = hinted;
  }
  return candidates.length === 1 ? candidates[0]?.model : undefined;
}

function meters(descriptor: string, cached: boolean): PriceRate["meter"][] {
  const value = descriptor.toLowerCase();
  const input = /\binput\b/.test(value);
  const output = /\boutput\b|response|reasoning/.test(value);
  if (!cached && !input && !output) return [];
  const pricedModalities: ("text" | "image" | "audio" | "video")[] = [
    "text",
    "image",
    "audio",
    "video",
  ];
  const modalities = pricedModalities.filter((modality) =>
    new RegExp(`\\b${modality}\\b`).test(value),
  );
  const observed = modalities.length > 0 ? modalities : ["text"];
  return observed.map((modality) => {
    if (cached) {
      if (modality === "audio") return "cache_read_audio";
      if (modality === "image") return "cache_read_image";
      if (modality === "video") return "cache_read_video";
      return "cache_read_text";
    }
    if (modality === "audio") return input ? "input_audio" : "output_audio";
    if (modality === "image") return input ? "input_image" : "output_image";
    if (modality === "video") return input ? "input_video" : "output_video";
    return input ? "input_text" : "output_text";
  });
}

function money(value: string): { price: string; scope?: string; serviceTier?: string }[] {
  const results: { price: string; scope?: string; serviceTier?: string }[] = [];
  let serviceTier: string | undefined;
  for (const match of value.matchAll(
    /(?:(Batch|Flex):\s*)?\$(\d+(?:\.\d+)?)(?:\s*\((Global|Non-global)\))?/gi,
  )) {
    if (match[1] !== undefined) serviceTier = match[1].toLowerCase();
    if (match[2] === undefined) continue;
    results.push({
      price: match[2],
      ...(match[3] === undefined ? {} : { scope: match[3].toLowerCase() }),
      ...(serviceTier === undefined ? {} : { serviceTier }),
    });
  }
  return results;
}

function decimalKey(value: string): string {
  const [whole = "0", fraction] = value.split(".");
  if (fraction === undefined) return whole;
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed === "" ? whole : `${whole}.${trimmed}`;
}

function addRate(model: ProviderModel, rate: PriceRate): void {
  const key = `${rate.meter}\0${rate.currency}\0${rate.unit}\0${JSON.stringify(rate.conditions)}`;
  if (
    !model.pricing.some(
      (item) =>
        `${item.meter}\0${item.currency}\0${item.unit}\0${JSON.stringify(item.conditions)}` ===
          key && decimalKey(item.price) === decimalKey(rate.price),
    )
  )
    model.pricing.push(rate);
}

function tier(table: Selection): string | undefined {
  const value = text(table.prevAll("h3,h4").first().text()).toLowerCase();
  if (value === "standard" || value === "priority") return value;
  if (value === "flex/batch") return "flex_or_batch";
  return undefined;
}

function tokenTables(models: Map<string, Evidence>, sourceId: string, $: LoadedDocument): void {
  $(".devsite-article-body table").each((_index, tableElement) => {
    const table = $(tableElement);
    const headers = table
      .find("tr")
      .first()
      .find("th,td")
      .map((_cellIndex, cell) => text($(cell).text()))
      .get();
    if (!headers.some((value) => /1M tokens|million tokens/i.test(value))) return;
    let current: ProviderModel | undefined;
    table
      .find("tr")
      .slice(1)
      .each((_rowIndex, row) => {
        const cells = $(row).find("th,td");
        if (cells.length === 1) {
          current = priceTarget(models, text(cells.eq(0).text()));
          return;
        }
        const direct = priceTarget(models, text(cells.eq(0).text()));
        if (direct !== undefined) current = direct;
        if (current === undefined) return;
        const target = current;
        const offset = headers.length - cells.length;
        const descriptor = direct === undefined ? text(cells.eq(0).text()) : "";
        cells.slice(direct === undefined ? 1 : 1).each((cellIndex, cell) => {
          const header = headers[cellIndex + 1 + offset] ?? "";
          const cached = /cached/i.test(header);
          const rateMeters = meters(descriptor, cached);
          if (rateMeters.length === 0) return;
          const conditions: PriceRate["conditions"] = {
            service_tier: tier(table),
            context_max_tokens: /<=\s*200K/i.test(header) ? 200_000 : undefined,
            context_min_tokens: />\s*200K/i.test(header) ? 200_001 : undefined,
          };
          for (const item of money(text($(cell).text())))
            for (const rateMeter of rateMeters)
              addRate(
                target,
                publishedRate(
                  rateMeter,
                  item.price,
                  "million_tokens",
                  sourceId,
                  `${header}; ${descriptor}; ${text($(cell).text())}`,
                  {
                    ...conditions,
                    service_tier: item.serviceTier ?? conditions.service_tier,
                    deployment_scope: item.scope,
                  },
                ),
              );
        });
      });
  });
}

function labeledTables(models: Map<string, Evidence>, sourceId: string, $: LoadedDocument): void {
  const pattern =
    /(5m Batch Cache Write|1h Batch Cache Write|Batch Cache Hit|Batch Input|Batch Output|5m Cache Write|1h Cache Write|Cache Hit|Input|Output):\s*\$(\d+(?:\.\d+)?)/gi;
  $(".devsite-article-body table").each((_index, tableElement) => {
    const table = $(tableElement);
    const headers = table
      .find("tr")
      .first()
      .find("th,td")
      .map((_cellIndex, cell) => text($(cell).text()))
      .get();
    if (headers[0] !== "Model" || headers.length > 3) return;
    const heading = text(table.prevAll("h2,h3,h4").first().text());
    table
      .find("tr")
      .slice(1)
      .each((_rowIndex, row) => {
        const cells = $(row).find("th,td");
        const model = priceTarget(models, text(cells.eq(0).text()));
        if (model === undefined) return;
        cells.slice(1).each((cellIndex, cell) => {
          const header = headers[cellIndex + 1] ?? "";
          const matches = [...text($(cell).text()).matchAll(pattern)];
          const counts = new Map<string, number>();
          for (const match of matches) {
            const label = match[1]?.toLowerCase();
            if (label !== undefined) counts.set(label, (counts.get(label) ?? 0) + 1);
          }
          for (const match of matches) {
            const label = match[1];
            const price = match[2];
            if (
              label === undefined ||
              price === undefined ||
              (counts.get(label.toLowerCase()) ?? 0) > 1
            )
              continue;
            const lower = label.toLowerCase();
            const rateMeter: PriceRate["meter"] = lower.includes("cache write")
              ? "cache_write_text"
              : lower.includes("cache hit")
                ? "cache_read_text"
                : lower.includes("output")
                  ? "output_text"
                  : "input_text";
            const effective = text(cells.eq(0).text())
              .match(/(?:through|beginning) ([A-Z][a-z]+ \d{1,2}(?:st|nd|rd|th)?, \d{4})/i)?.[1]
              ?.replace(/(\d)(?:st|nd|rd|th)/, "$1");
            addRate(
              model,
              publishedRate(rateMeter, price, "million_tokens", sourceId, `${header}; ${label}`, {
                region: /^(?:Global|US Multi-Region|EU Multi-Region|[a-z]+-[a-z]+\d)$/i.test(
                  heading,
                )
                  ? heading
                  : undefined,
                service_tier: lower.includes("batch") ? "batch" : undefined,
                context_max_tokens: /<=\s*200K/i.test(header) ? 200_000 : undefined,
                context_min_tokens: />\s*200K/i.test(header) ? 200_001 : undefined,
                cache_ttl_seconds: lower.startsWith("5m")
                  ? 300
                  : lower.startsWith("1h")
                    ? 3600
                    : undefined,
                effective_from:
                  /beginning/i.test(text(cells.eq(0).text())) && effective !== undefined
                    ? modelDate(effective)
                    : undefined,
                effective_until:
                  /through/i.test(text(cells.eq(0).text())) && effective !== undefined
                    ? modelDate(effective)
                    : undefined,
                promotion: /promotional/i.test(text(cells.eq(0).text())) || undefined,
              }),
            );
          }
        });
      });
  });
}

function storageTables(models: Map<string, Evidence>, sourceId: string, $: LoadedDocument): void {
  $(".devsite-article-body table").each((_index, tableElement) => {
    const table = $(tableElement);
    const headers = table
      .find("tr")
      .first()
      .find("th,td")
      .map((_cellIndex, cell) => text($(cell).text()))
      .get();
    const featureIndex = headers.findIndex((value) => /^Feature$/i.test(value));
    const typeIndex = headers.findIndex((value) => /^Type$/i.test(value));
    if (headers[0] !== "Model" || featureIndex < 0 || typeIndex < 0) return;
    table
      .find("tr")
      .slice(1)
      .each((_rowIndex, row) => {
        const cells = $(row).find("th,td");
        if (!/Context Cache Storage/i.test(text(cells.eq(featureIndex).text()))) return;
        const model = priceTarget(models, text(cells.eq(0).text()));
        if (model === undefined) return;
        const modalities = media(text(cells.eq(typeIndex).text())).filter(
          (modality) => modality !== "pdf" && modality !== "embedding",
        );
        for (let index = typeIndex + 1; index < cells.length; index += 1) {
          const header = headers[index] ?? "";
          const raw = text(cells.eq(index).text());
          for (const item of money(raw))
            for (const modality of modalities.length === 0 ? [undefined] : modalities)
              addRate(
                model,
                publishedRate(
                  "cache_storage",
                  item.price,
                  "million_tokens_per_hour",
                  sourceId,
                  raw,
                  {
                    modality,
                    context_max_tokens: /<=\s*200K/i.test(header) ? 200_000 : undefined,
                    context_min_tokens: />\s*200K/i.test(header) ? 200_001 : undefined,
                  },
                ),
              );
        }
      });
  });
}

function mediaTables(models: Map<string, Evidence>, sourceId: string, $: LoadedDocument): void {
  $(".devsite-article-body table").each((_index, tableElement) => {
    const table = $(tableElement);
    const headers = table
      .find("tr")
      .first()
      .find("th,td")
      .map((_cellIndex, cell) => text($(cell).text()))
      .get();
    const section = text(table.prevAll("h2,h3,h4").first().text());
    if (headers[0] !== "Model" || !/(Imagen|Veo|Lyria|Embedding)/i.test(section)) return;
    let current: ProviderModel | undefined;
    let operation = "";
    table
      .find("tr")
      .slice(1)
      .each((_rowIndex, row) => {
        const cells = $(row).find("th,td");
        if (cells.length < 2) return;
        const label = text(cells.eq(0).text());
        const featureIndex = headers.findIndex((value) => /^(?:Feature|Type)$/i.test(value));
        const resolutionIndex = headers.findIndex((value) => /^Output Resolution$/i.test(value));
        const fullRow = cells.length === headers.length;
        const feature = featureIndex >= 0 && fullRow ? text(cells.eq(featureIndex).text()) : "";
        const hinted = /30 second|clip/i.test(`${feature} ${text($(row).text())}`) ? "clip" : "";
        const target = priceTarget(models, label, hinted);
        if (target !== undefined) current = target;
        else if (fullRow) current = undefined;
        const rowOperation =
          feature ||
          (/generation|upscal|editing|caption|q&a|recontext|try-on/i.test(label) ? label : "");
        if (rowOperation !== "") operation = rowOperation;
        if (current === undefined) return;
        const raw = text(cells.last().text());
        const price = money(raw)[0]?.price;
        if (price === undefined) return;
        const unit: PriceRate["unit"] | undefined = /per image|\/image/i.test(raw)
          ? "image"
          : /second/i.test(raw)
            ? "second"
            : /frame/i.test(`${raw} ${text($(row).text())}`)
              ? "frame"
              : /1M tokens/i.test(`${raw} ${text($(row).text())}`)
                ? "million_tokens"
                : /1,000 input tokens/i.test(headers.at(-1) ?? "")
                  ? "thousand_tokens"
                  : /song/i.test(raw)
                    ? "request"
                    : undefined;
        if (unit === undefined) return;
        const rateMeter: PriceRate["meter"] = /Imagen/i.test(section)
          ? "image_generation"
          : /Veo/i.test(section)
            ? "video_generation"
            : /Lyria/i.test(section)
              ? "output_audio"
              : "embedding";
        const resolutionText =
          resolutionIndex >= 0 && fullRow
            ? text(cells.eq(resolutionIndex).text())
            : text(cells.eq(-2).text());
        const resolutions = unique(
          [...resolutionText.matchAll(/\b(4k|1080p|720p)\b/gi)].flatMap((match) =>
            match[1] === undefined ? [] : [match[1].toLowerCase()],
          ),
        );
        for (const resolution of resolutions.length === 0 ? [undefined] : resolutions)
          addRate(
            current,
            publishedRate(rateMeter, price, unit, sourceId, raw, {
              operation: operation || undefined,
              resolution,
              audio: /video \+ audio/i.test(operation) || undefined,
              modality: /input (text|image|video|audio)/i
                .exec(text($(row).text()))?.[1]
                ?.toLowerCase(),
            }),
          );
      });
  });
}

function applyPricing(models: Map<string, Evidence>, sourceId: string, body: string): void {
  const $ = load(body);
  tokenTables(models, sourceId, $);
  labeledTables(models, sourceId, $);
  storageTables(models, sourceId, $);
  mediaTables(models, sourceId, $);
  for (const { model } of models.values()) {
    model.pricing.sort((left, right) =>
      `${left.meter}\0${left.unit}\0${left.price}\0${JSON.stringify(left.conditions)}`.localeCompare(
        `${right.meter}\0${right.unit}\0${right.price}\0${JSON.stringify(right.conditions)}`,
      ),
    );
    if (model.pricing.length > 0) model.pricing_status = "published";
  }
}

export function parseVertexCatalog(input: Input): ProviderModel[] {
  const extractor = input.source.extractor;
  if (extractor.kind !== "vertex-catalog") throw new Error("Wrong Vertex catalog extractor");
  const bundle = linkedBundleSchema.parse(JSON.parse(input.body));
  const models = new Map<string, Evidence>();
  for (const document of bundle.documents) {
    const path = new URL(document.url).pathname;
    if (path.endsWith("/generative-ai/pricing")) continue;
    parseModelTables(models, input, document.body);
    if (/model-versions|\/deprecations\//.test(path)) applyLifecycle(models, input, document.body);
  }
  const pricing = bundle.documents.find((document) =>
    new URL(document.url).pathname.endsWith("/generative-ai/pricing"),
  );
  if (pricing !== undefined) applyPricing(models, input.source.id, pricing.body);
  const values = [...models.values()]
    .map((item) => item.model)
    .sort((left, right) => left.model_id.localeCompare(right.model_id));
  if (values.length < extractor.minModels || values.length > extractor.maxModels)
    throw new Error("Vertex model count outside reviewed bounds");
  return values;
}

export function parseVertexApi(input: Input): ProviderModel[] {
  const bundle = apiBundleSchema.parse(JSON.parse(input.body));
  const models = new Map<string, ProviderModel>();
  for (const publisher of bundle.publishers) {
    for (const value of publisher.models) {
      const parsed = apiItemSchema.safeParse(value);
      if (!parsed.success) throw new Error("Vertex Model Garden API schema drift");
      const resource = parsed.data.name.match(/^publishers\/([^/]+)\/models\/(.+)$/);
      const resourcePublisher = resource?.[1];
      const id = resource?.[2]?.replace(/@\d+$/, "");
      if (
        resourcePublisher !== publisher.publisher ||
        id === undefined ||
        !modelIdSchema.safeParse(id).success
      )
        throw new Error("Vertex Model Garden API returned an invalid resource name");
      const modelStatus = status(
        `${parsed.data.launchStage ?? ""} ${parsed.data.versionState ?? ""}`,
      );
      models.set(id, {
        ...baseModel({
          providerId: input.provider.id,
          id,
          name: id,
          sourceId: input.source.id,
          observedAt: input.observedAt,
        }),
        status: modelStatus,
        is_deprecated:
          modelStatus === "deprecated" || modelStatus === "retired"
            ? true
            : modelStatus === "active" || modelStatus === "preview"
              ? false
              : "unknown",
        scope: "runtime_observation",
      });
    }
  }
  if (models.size === 0) throw new Error("Vertex Model Garden API returned no models");
  return [...models.values()].sort((left, right) => left.model_id.localeCompare(right.model_id));
}
