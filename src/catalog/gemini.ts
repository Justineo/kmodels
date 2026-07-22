import { load } from "cheerio";
import { z } from "zod";
import { linkedBundleSchema } from "./bundle.ts";
import { modelIdSchema } from "./identity.ts";
import type { SourceManifest } from "./manifests.ts";
import { baseModel } from "./model.ts";
import { publishedRate } from "./pricing.ts";
import {
  modalitySchema,
  modelTypeSchema,
  type Modality,
  type ModelType,
  type PriceRate,
  type Provider,
  type ProviderModel,
  unknownCapabilities,
} from "./schema.ts";
import { classifyModelTypes } from "./task.ts";

interface Input {
  provider: Provider;
  source: SourceManifest;
  body: string;
  observedAt: string;
}

interface Card {
  name: string;
  description: string | undefined;
  status: ProviderModel["status"];
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
const typeOrder = new Map(modelTypeSchema.options.map((type, index) => [type, index]));
const modalityOrder = new Map(modalitySchema.options.map((modality, index) => [modality, index]));

const apiItemSchema = z.object({
  name: z.string().regex(/^models\/[a-z0-9][a-z0-9._:/-]*$/i),
  baseModelId: modelIdSchema,
  version: z.string().min(1),
  displayName: z.string().min(1).optional(),
  description: z.string().optional(),
  inputTokenLimit: z.number().int().nonnegative().optional(),
  outputTokenLimit: z.number().int().nonnegative().optional(),
  supportedGenerationMethods: z.array(z.string().min(1)).optional(),
  thinking: z.boolean().optional(),
  temperature: z.number().finite().optional(),
  maxTemperature: z.number().finite().optional(),
  topP: z.number().finite().optional(),
  topK: z.number().int().optional(),
});
const apiListSchema = z.object({
  models: z.array(z.unknown()).min(1).max(1000),
  nextPageToken: z.string().min(1).optional(),
});

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function types(values: ModelType[]): ModelType[] {
  const result = unique(values);
  const known = result.filter((value) => value !== "other");
  return (known.length === 0 ? result : known).sort(
    (left, right) => (typeOrder.get(left) ?? 0) - (typeOrder.get(right) ?? 0),
  );
}

function modalities(values: Modality[]): Modality[] {
  return unique(values).sort(
    (left, right) => (modalityOrder.get(left) ?? 0) - (modalityOrder.get(right) ?? 0),
  );
}

function text(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function modelDate(value: string): string | undefined {
  const day = value.match(/^([A-Z][a-z]+) (\d{1,2}), (\d{4})$/);
  const month = day?.[1] === undefined ? undefined : months.get(day[1]);
  if (month !== undefined && day?.[2] !== undefined && day[3] !== undefined)
    return `${day[3]}-${month}-${day[2].padStart(2, "0")}`;
  const partial = value.match(/^([A-Z][a-z]+) (\d{4})$/);
  const partialMonth = partial?.[1] === undefined ? undefined : months.get(partial[1]);
  return partialMonth === undefined || partial?.[2] === undefined
    ? undefined
    : `${partial[2]}-${partialMonth}`;
}

function status(value: string): ProviderModel["status"] {
  const lower = value.toLowerCase();
  if (lower.includes("shut down") || lower.includes("shutdown")) return "retired";
  if (lower.includes("deprecated")) return "deprecated";
  if (lower.includes("preview") || lower.includes("experimental")) return "preview";
  if (lower.includes("stable")) return "active";
  return "unknown";
}

function media(value: string): Modality[] {
  const lower = value.toLowerCase();
  const values: Modality[] = [];
  if (/\btext embeddings?\b/.test(lower)) values.push("embedding");
  else if (/\btext\b/.test(lower)) values.push("text");
  if (/\bimages?\b/.test(lower)) values.push("image");
  if (/\baudio\b|\bmusic\b/.test(lower)) values.push("audio");
  if (/\bvideos?\b/.test(lower)) values.push("video");
  if (/\bpdfs?\b|\bdocuments?\b/.test(lower)) values.push("pdf");
  return modalities(values);
}

function property($: LoadedDocument, label: RegExp): Selection | undefined {
  let result: Selection | undefined;
  $(".devsite-article-body table tr").each((_index, element) => {
    const cells = $(element).find("th,td");
    if (result === undefined && cells.length >= 2 && label.test(text(cells.eq(0).text())))
      result = cells.eq(1);
  });
  return result;
}

function supportedData(
  $: LoadedDocument,
  cell: Selection | undefined,
): ProviderModel["modalities"] {
  if (cell === undefined) return { input: [], output: [] };
  let input: Modality[] = [];
  let output: Modality[] = [];
  cell.find("section").each((_index, section) => {
    const selection = $(section);
    const value = text(selection.text());
    const heading = text(selection.find("b").first().text()).toLowerCase();
    if (heading.startsWith("input")) input = media(value);
    if (heading.startsWith("output")) output = media(value);
  });
  if (input.length + output.length === 0) {
    const value = text(cell.text());
    const parts = value.split(/\bOutput(?:s)?\b/i);
    input = media(parts[0]?.replace(/^Inputs?\s*/i, "") ?? "");
    output = media(parts[1] ?? "");
  }
  return { input, output };
}

function token(value: string, pattern: RegExp): number | undefined {
  const raw = value.match(pattern)?.[1];
  if (raw === undefined) return undefined;
  const result = Number(raw.replaceAll(",", ""));
  return Number.isSafeInteger(result) && result > 0 ? result : undefined;
}

function modelLimits(cell: Selection | undefined): ProviderModel["limits"] {
  if (cell === undefined) return {};
  const value = text(cell.text());
  const input = token(
    value,
    /(?:Input token limit|Input context window|Context window)\s*([\d,]+)/i,
  );
  const output = token(value, /Output token limit\s*([\d,]+)/i);
  const range = value.match(/(?:Flexible,\s*)?supports:\s*([\d,]+)\s*-\s*([\d,]+)/i);
  const recommended = value.match(/Recommended:\s*([\d,\s]+)/i)?.[1];
  const exact = range === null ? token(value, /Output dimension size\s*([\d,]+)/i) : undefined;
  return {
    context_tokens: input,
    max_input_tokens: input,
    max_output_tokens: output,
    embedding_dimensions: exact === undefined ? undefined : [exact],
    embedding_dimension_range:
      range?.[1] === undefined || range[2] === undefined
        ? undefined
        : {
            min: Number(range[1].replaceAll(",", "")),
            max: Number(range[2].replaceAll(",", "")),
          },
    recommended_embedding_dimensions:
      recommended === undefined
        ? undefined
        : unique(
            [...recommended.matchAll(/[\d,]+/g)]
              .map((match) => Number(match[0].replaceAll(",", "")))
              .filter((item) => Number.isSafeInteger(item) && item > 0),
          ),
  };
}

function support(value: string): boolean | "unknown" {
  if (/not supported/i.test(value)) return false;
  if (/supported|experimental/i.test(value)) return true;
  return "unknown";
}

function modelCapabilities(
  $: LoadedDocument,
  capabilityCell: Selection | undefined,
  consumptionCell: Selection | undefined,
): ProviderModel["capabilities"] {
  const result = unknownCapabilities();
  const apply = (cell: Selection | undefined): void => {
    cell?.find("section").each((_index, section) => {
      const selection = $(section);
      const label = text(selection.find("b").first().text()).toLowerCase();
      const value = support(text(selection.text()).slice(label.length));
      if (label === "caching") result.prompt_cache = value;
      if (label === "code execution") result.code_execution = value;
      if (label === "computer use") result.computer_use = value;
      if (label === "function calling") result.tool_call = value;
      if (label === "structured outputs") result.structured_output = value;
      if (label === "thinking") result.reasoning = value;
      if (label === "batch api") result.batch = value;
      if (label === "live api" && value === true) result.streaming = true;
    });
  };
  apply(capabilityCell);
  apply(consumptionCell);
  return result;
}

function pageTypes(
  title: string,
  codeLabel: string,
  modelModalities: ProviderModel["modalities"],
  capabilities: ProviderModel["capabilities"],
  capabilityCell: Selection | undefined,
): ModelType[] {
  const values: ModelType[] = [];
  const lower = title.toLowerCase();
  const capabilityText = capabilityCell === undefined ? "" : text(capabilityCell.text());
  const agent = /agent code/i.test(codeLabel);
  const live = /Live API\s+Supported/i.test(capabilityText) || /\blive\b|realtime/i.test(lower);
  if (agent) values.push("agentic");
  if (!agent && modelModalities.output.includes("embedding")) values.push("embeddings");
  if (!agent && modelModalities.output.includes("video")) values.push("video");
  if (!agent && modelModalities.output.includes("image")) values.push("image");
  if (!agent && modelModalities.output.includes("audio")) {
    if (/lyria|music/i.test(title)) values.push("audio_generation");
    else if (/translat/i.test(title)) values.push("audio_translation");
    else if (/tts|text-to-speech/i.test(title)) values.push("audio_speech");
    else if (live) values.push("realtime");
  }
  if (
    !agent &&
    modelModalities.output.includes("text") &&
    !/tts|text-to-speech|lyria|music/i.test(lower)
  )
    values.push("generate");
  if (/Image generation\s+Supported/i.test(capabilityText)) values.push("image");
  if (live) values.push("realtime");
  if (capabilities.computer_use === true) values.push("agentic");
  return types(values.length === 0 ? ["other"] : values);
}

function cards(body: string): Map<string, Card> {
  const $ = load(body);
  const result = new Map<string, Card>();
  $(".devsite-article-body a[href^='/gemini-api/docs/models/']").each((_index, element) => {
    const anchor = $(element);
    const href = anchor.attr("href");
    if (href === undefined) return;
    const container = anchor.hasClass("gemini-card-centered")
      ? anchor
      : anchor.closest(".gemini-model-row");
    if (container.length === 0) return;
    const heading = container.find("h3").first().clone();
    heading.find(".model-status").remove();
    const name = text(heading.text());
    if (name === "") return;
    const description =
      text(container.find(".description-centered,.gemini-model-desc").first().text()) || undefined;
    const modelStatus = status(
      text(container.find(".status-subtext,.model-status").first().text()),
    );
    const current = result.get(href);
    result.set(href, {
      name: current?.name ?? name,
      description: current?.description ?? description,
      status:
        current?.status === undefined || current.status === "unknown"
          ? modelStatus
          : current.status,
    });
  });
  return result;
}

function description($: LoadedDocument): string | undefined {
  let result: string | undefined;
  $(".devsite-article-body > p").each((_index, element) => {
    const value = text($(element).text());
    if (result === undefined && value !== "") result = value;
  });
  return result;
}

function primaryPageModel(
  input: Input,
  body: string,
  card: Card | undefined,
): { models: ProviderModel[]; versionIds: string[] } {
  const $ = load(body);
  const codeCell = property($, /(?:Model|Agent) code$/i);
  if (codeCell === undefined) throw new Error("Gemini model page omitted its labeled code");
  const codeLabel = text(codeCell.parent().find("th,td").first().text());
  const ids = unique(
    codeCell
      .find("code")
      .map((_index, element) => text($(element).text()))
      .get()
      .filter((id) => modelIdSchema.safeParse(id).success),
  );
  if (ids.length === 0) throw new Error("Gemini model page published no valid model code");
  const title = text($("h1.devsite-page-title").first().text());
  const modelModalities = supportedData($, property($, /Supported data types$/i));
  const limits = modelLimits(property($, /(?:Token|Streaming )?limits/i));
  const capabilityCell = property($, /Capabilities$/i);
  const capabilities = modelCapabilities($, capabilityCell, property($, /Consumption options$/i));
  const updated = modelDate(text(property($, /Latest update$/i)?.text() ?? ""));
  const versionIds = unique(
    property($, /Versions$/i)
      ?.find("code")
      .map((_index, element) => text($(element).text()))
      .get()
      .filter((id) => modelIdSchema.safeParse(id).success) ?? [],
  );
  return {
    models: ids.map((id) => {
      const modelStatus = card?.status ?? "unknown";
      return {
        ...baseModel({
          providerId: input.provider.id,
          id,
          name: card?.name ?? title,
          sourceId: input.source.id,
          observedAt: input.observedAt,
        }),
        description: card?.description ?? description($),
        types: pageTypes(title, codeLabel, modelModalities, capabilities, capabilityCell),
        modalities: modelModalities,
        capabilities,
        limits,
        updated_date: updated,
        status: modelStatus,
        is_deprecated:
          modelStatus === "deprecated" || modelStatus === "retired"
            ? true
            : modelStatus === "active" || modelStatus === "preview"
              ? false
              : "unknown",
      } satisfies ProviderModel;
    }),
    versionIds,
  };
}

function sectionTypes(section: string, id: string): ModelType[] {
  const lower = section.toLowerCase();
  const fallback: ModelType = lower.includes("embedding")
    ? "embeddings"
    : lower.includes("imagen")
      ? "image"
      : lower.includes("veo")
        ? "video"
        : lower.includes("live api")
          ? "realtime"
          : lower.includes("audio")
            ? "audio_speech"
            : lower.includes("lyria")
              ? "audio_generation"
              : lower.includes("robotics")
                ? "agentic"
                : "generate";
  const classified = classifyModelTypes({
    modelId: id,
    name: id,
    rawType: undefined,
    modalities: { input: [], output: [] },
    fallback,
  });
  return types(fallback === "audio_generation" ? [fallback, ...classified] : classified);
}

function ensure(
  models: Map<string, ProviderModel>,
  input: Input,
  id: string,
  modelTypes: ModelType[],
): ProviderModel {
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
    types: modelTypes,
  } satisfies ProviderModel;
  models.set(id, created);
  return created;
}

function applyLifecycle(models: Map<string, ProviderModel>, input: Input, body: string): void {
  const $ = load(body);
  $(".devsite-article-body h2").each((_index, heading) => {
    const section = text($(heading).text());
    const siblings = $(heading).nextUntil("h2");
    const tables = siblings.filter("table").add(siblings.find("table"));
    tables.each((_tableIndex, table) => {
      let preview = false;
      $(table)
        .find("tbody tr")
        .each((_rowIndex, row) => {
          const cells = $(row).find("td");
          if (cells.length === 1 && /preview models/i.test(text(cells.eq(0).text()))) {
            preview = true;
            return;
          }
          if (cells.length < 4) return;
          const id = text(cells.eq(0).find("code").first().text());
          if (!modelIdSchema.safeParse(id).success) return;
          const item = ensure(models, input, id, sectionTypes(section, id));
          const released = modelDate(text(cells.eq(1).text()));
          const shutdownText = text(cells.eq(2).text());
          const shutdown = modelDate(shutdownText);
          const retired = $(row).hasClass("row-gray");
          const replacements = unique(
            cells
              .eq(3)
              .find("code")
              .map((_replacementIndex, element) => text($(element).text()))
              .get()
              .filter((value) => modelIdSchema.safeParse(value).success && value !== id),
          );
          item.release_date = released ?? item.release_date;
          item.retired_at = shutdown ?? item.retired_at;
          item.replacement_model_ids = unique([...item.replacement_model_ids, ...replacements]);
          item.status = retired
            ? "retired"
            : shutdown === undefined
              ? preview
                ? "preview"
                : "active"
              : "deprecated";
          item.is_deprecated = shutdown === undefined ? false : true;
          item.types = types([...item.types, ...sectionTypes(section, id)]);
        });
    });
  });
}

function scaledTokenCount(value: string): number | undefined {
  const match = value.match(/^([\d.]+)\s*([KM])?$/i);
  if (match?.[1] === undefined) return undefined;
  const scale = match[2]?.toLowerCase() === "m" ? 1_000_000 : match[2] ? 1_000 : 1;
  const result = Number(match[1]) * scale;
  return Number.isSafeInteger(result) && result > 0 ? result : undefined;
}

function applyGemma(
  models: Map<string, ProviderModel>,
  input: Input,
  apiBody: string,
  cardBody: string,
): void {
  const api = load(apiBody);
  const heading = api(".devsite-article-body h2")
    .filter((_index, element) => text(api(element).text()) === "Supported Models")
    .first();
  const ids = unique(
    heading
      .nextUntil("h2")
      .find("ul code")
      .map((_index, element) => text(api(element).text()))
      .get()
      .filter((id) => /^gemma-4-[a-z0-9-]+-it$/.test(id) && modelIdSchema.safeParse(id).success),
  );
  if (ids.length !== 2) throw new Error("Gemma-on-Gemini supported-model list changed");
  const card = load(cardBody);
  for (const id of ids) {
    const item = ensure(models, input, id, ["generate"]);
    const needle = id.includes("26b-a4b") ? /26B A4B/i : /31B/i;
    card(".devsite-article-body table").each((_tableIndex, table) => {
      const headers = card(table).find("tr").first().find("th,td");
      let column = -1;
      headers.each((index, cell) => {
        if (needle.test(text(card(cell).text()))) column = index;
      });
      if (column < 1) return;
      card(table)
        .find("tr")
        .each((_rowIndex, row) => {
          const cells = card(row).find("th,td");
          const label = text(cells.eq(0).text());
          const value = text(cells.eq(column).text());
          if (label === "Context Length") {
            const context = scaledTokenCount(value.replace(/\s*tokens?$/i, ""));
            if (context !== undefined)
              item.limits = { ...item.limits, context_tokens: context, max_input_tokens: context };
          }
          if (label === "Supported Modalities")
            item.modalities = { input: media(value), output: ["text"] };
        });
    });
    item.capabilities.reasoning = true;
    item.capabilities.tool_call = true;
    item.status = "active";
    item.is_deprecated = false;
    item.pricing_status = "not_published";
  }
}

function segments(cell: Selection): string[] {
  const html = cell.html() ?? "";
  return html
    .split(/<br\s*\/?>/i)
    .map((part) => text(load(part).text()))
    .filter(Boolean);
}

function priceUnit(header: string, descriptor: string, row: string): PriceRate["unit"] | undefined {
  const value = `${descriptor} ${row}`.toLowerCase();
  if (/tokens per hour/.test(value)) return "million_tokens_per_hour";
  if (/\/\s*min\b|per minute/.test(value)) return "minute";
  if (/per second/.test(value)) return "second";
  if (/per frame/.test(value)) return "frame";
  if (/per (?:0\.5k |1k |2k |4k |resolution )?image|per song/.test(value))
    return value.includes("song") ? "request" : "image";
  if (
    /1,000 (?:search queries|grounded prompts)|1k (?:search queries|grounded prompts)/.test(value)
  )
    return "thousand_requests";
  const lower = header.toLowerCase();
  if (lower.includes("per image")) return "image";
  if (lower.includes("per second")) return "second";
  if (lower.includes("per request")) return "request";
  if (lower.includes("1m tokens")) return "million_tokens";
  return undefined;
}

function applyGemmaFreePricing(
  models: Map<string, ProviderModel>,
  sourceId: string,
  body: string,
): void {
  const gemma = [...models.values()].filter((model) => /^gemma-4-.+-it$/.test(model.model_id));
  if (gemma.length === 0) return;
  const $ = load(body);
  const section = $(".models-section h2#gemma-4").first().closest(".models-section");
  const table = section.nextUntil(".models-section").filter("table.pricing-table").first();
  const rows = new Map<string, string[]>();
  table.find("tbody tr").each((_index, row) => {
    const cells = $(row)
      .find("td")
      .map((_cellIndex, cell) => text($(cell).text()))
      .get();
    if (cells[0] !== undefined) rows.set(cells[0], cells);
  });
  const required = [
    "Input price",
    "Output price",
    "Context caching price",
    "Context caching (storage)",
  ];
  if (
    required.some(
      (label) =>
        rows.get(label)?.[1] !== "Free of charge" || rows.get(label)?.[2] !== "Not available",
    )
  )
    throw new Error("Gemma 4 free-tier pricing structure changed");

  for (const model of gemma) {
    const input = model.modalities.input.filter((modality) => modality !== "pdf");
    for (const modality of input) {
      const suffix = modality === "image" ? "image" : "text";
      model.pricing.push(
        publishedRate(
          suffix === "image" ? "input_image" : "input_text",
          "0",
          "million_tokens",
          sourceId,
          "Gemma 4 Free Tier: Input price; Free of charge",
          { service_tier: "free" },
        ),
        publishedRate(
          suffix === "image" ? "cache_read_image" : "cache_read_text",
          "0",
          "million_tokens",
          sourceId,
          "Gemma 4 Free Tier: Context caching price; Free of charge",
          { service_tier: "free" },
        ),
        publishedRate(
          "cache_storage",
          "0",
          "million_tokens_per_hour",
          sourceId,
          "Gemma 4 Free Tier: Context caching (storage); Free of charge",
          { service_tier: "free", modality },
        ),
      );
    }
    model.pricing.push(
      publishedRate(
        "output_text",
        "0",
        "million_tokens",
        sourceId,
        "Gemma 4 Free Tier: Output price; Free of charge",
        { service_tier: "free" },
      ),
    );
  }
}

function explicitModalities(value: string): Modality[] {
  return media(value).filter((modality) => modality !== "embedding" && modality !== "pdf");
}

function priceModalities(
  row: string,
  segment: string,
  descriptor: string,
  fallback: Modality[],
): Modality[] {
  const local = explicitModalities(descriptor);
  if (local.length > 0) return local;
  const segmentModalities = explicitModalities(segment);
  if (segmentModalities.length > 0) return segmentModalities;
  const rowModalities = explicitModalities(row);
  return rowModalities.length > 0 ? rowModalities : fallback.filter((value) => value !== "pdf");
}

function conditions(tier: string, descriptor: string, row: string): PriceRate["conditions"] {
  const result: PriceRate["conditions"] = {};
  const normalizedTier = tier.toLowerCase();
  if (normalizedTier !== "" && normalizedTier !== "standard") result.service_tier = normalizedTier;
  if (/prompts?\s*(?:<=|≤)\s*200k/i.test(descriptor)) result.context_max_tokens = 200_000;
  if (/prompts?\s*>\s*200k/i.test(descriptor)) result.context_min_tokens = 200_001;
  const resolution = descriptor.match(/\b(0\.5K|1K|2K|4K|720p|1080p)\b/i)?.[1];
  if (resolution !== undefined) result.resolution = resolution;
  if (/with audio/i.test(row)) result.audio = true;
  return result;
}

function meterRates(
  model: ProviderModel,
  row: string,
  segment: string,
  descriptor: string,
  unit: PriceRate["unit"],
  baseConditions: PriceRate["conditions"],
): { meter: PriceRate["meter"]; conditions: PriceRate["conditions"] }[] {
  const lower = row.toLowerCase();
  if (lower.includes("grounding with google"))
    return [
      {
        meter: "tool_call",
        conditions: {
          ...baseConditions,
          operation: lower.includes("maps") ? "google_maps" : "google_search",
        },
      },
    ];
  if (lower.includes("image price"))
    return [{ meter: "image_generation", conditions: baseConditions }];
  if (
    /video (?:generation|price)/.test(lower) ||
    (unit === "second" && model.types.includes("video"))
  )
    return [{ meter: "video_generation", conditions: baseConditions }];
  if (
    lower.includes("lyria") ||
    lower.includes("song") ||
    (model.types.includes("audio_generation") && /per song/i.test(segment))
  )
    return [
      {
        meter: "output_audio",
        conditions: { ...baseConditions, operation: "music_generation" },
      },
    ];
  if (lower.includes("storage") || segment.toLowerCase().includes("storage price")) {
    const selected = priceModalities(row, segment, descriptor, model.modalities.input);
    const selectedOrText: Modality[] = selected.length === 0 ? ["text"] : selected;
    return selectedOrText.map((modality) => ({
      meter: "cache_storage",
      conditions: { ...baseConditions, modality },
    }));
  }
  const embedding = model.types.includes("embeddings");
  const input = lower.includes("input price");
  const output = lower.includes("output price");
  const cache = lower.includes("context caching price");
  if (!input && !output && !cache && !embedding) return [];
  const selected = priceModalities(
    row,
    segment,
    descriptor,
    input || cache ? model.modalities.input : model.modalities.output,
  );
  const selectedOrText: Modality[] = selected.length === 0 ? ["text"] : selected;
  const rates: { meter: PriceRate["meter"]; conditions: PriceRate["conditions"] }[] = [];
  for (const modality of selectedOrText) {
    if (embedding) {
      rates.push({ meter: "embedding", conditions: { ...baseConditions, modality } });
      continue;
    }
    if (cache) {
      const meter =
        modality === "audio"
          ? "cache_read_audio"
          : modality === "image"
            ? "cache_read_image"
            : modality === "video"
              ? "cache_read_video"
              : "cache_read_text";
      rates.push({ meter, conditions: baseConditions });
      continue;
    }
    if (unit === "image" && output) {
      rates.push({ meter: "image_generation", conditions: baseConditions });
      continue;
    }
    const meter =
      modality === "audio"
        ? input
          ? "input_audio"
          : "output_audio"
        : modality === "image"
          ? input
            ? "input_image"
            : "output_image"
          : modality === "video"
            ? input
              ? "input_video"
              : "output_video"
            : input
              ? "input_text"
              : "output_text";
    rates.push({ meter, conditions: baseConditions });
  }
  return rates;
}

function targets(codes: string[], row: string): string[] {
  if (codes.length <= 1) return codes;
  const lower = row.toLowerCase();
  for (const variant of ["fast", "ultra", "lite", "clip", "pro"]) {
    if (!new RegExp(`\\b${variant}\\b`).test(lower)) continue;
    const matched = codes.filter(
      (code) => code.includes(`-${variant}-`) || code.includes(`-${variant}`),
    );
    if (matched.length === 1) return matched;
  }
  if (/\bstandard\b|\bdefault\b/.test(lower)) {
    const base = codes.filter(
      (code) => !["-fast-", "-ultra-", "-lite-", "-clip-"].some((part) => code.includes(part)),
    );
    if (base.length === 1) return base;
  }
  return codes;
}

function applyPricing(models: Map<string, ProviderModel>, sourceId: string, body: string): void {
  const $ = load(body);
  $(".devsite-article-body .models-section").each((_index, section) => {
    const codes = unique(
      $(section)
        .find(".heading-group code")
        .map((_codeIndex, element) => text($(element).text()))
        .get()
        .filter((id) => modelIdSchema.safeParse(id).success),
    );
    if (codes.length === 0) return;
    const siblings = $(section).nextUntil(".models-section");
    const tables = siblings.filter("table.pricing-table").add(siblings.find("table.pricing-table"));
    tables.each((_tableIndex, table) => {
      const header = text($(table).find("thead tr").first().find("th").last().text());
      const tier = text($(table).closest("section").children("h3").first().text()) || "standard";
      $(table)
        .find("tbody tr")
        .each((_rowIndex, rowElement) => {
          const cells = $(rowElement).find("td");
          if (cells.length < 3) return;
          const row = text(cells.eq(0).text());
          const paid = segments(cells.eq(2));
          for (const segment of paid) {
            const matches = [...segment.matchAll(/\$(\d+(?:\.\d+)?)/g)];
            for (let index = 0; index < matches.length; index += 1) {
              const match = matches[index];
              const price = match?.[1];
              const start = (match?.index ?? 0) + (match?.[0].length ?? 0);
              const end = matches[index + 1]?.index ?? segment.length;
              const descriptor = text(segment.slice(start, end));
              const unit = price === undefined ? undefined : priceUnit(header, descriptor, row);
              if (price === undefined || unit === undefined) continue;
              for (const id of targets(codes, row)) {
                const model = models.get(id);
                if (model === undefined) continue;
                for (const rate of meterRates(
                  model,
                  row,
                  segment,
                  descriptor,
                  unit,
                  conditions(tier, descriptor, row),
                ))
                  model.pricing.push(
                    publishedRate(
                      rate.meter,
                      price,
                      unit,
                      sourceId,
                      `${header}; ${row}; ${descriptor || segment}`,
                      rate.conditions,
                    ),
                  );
              }
            }
          }
        });
    });
  });
  applyGemmaFreePricing(models, sourceId, body);
  for (const item of models.values()) {
    item.pricing = [
      ...new Map(
        item.pricing.map((rate) => [
          `${rate.meter}\u0000${rate.price}\u0000${rate.unit}\u0000${JSON.stringify(rate.conditions)}`,
          rate,
        ]),
      ).values(),
    ].sort((left, right) =>
      `${left.meter}\u0000${left.unit}\u0000${left.price}\u0000${JSON.stringify(left.conditions)}`.localeCompare(
        `${right.meter}\u0000${right.unit}\u0000${right.price}\u0000${JSON.stringify(right.conditions)}`,
      ),
    );
    if (item.pricing.length > 0) item.pricing_status = "published";
  }
}

function applyChangelog(models: Map<string, ProviderModel>, body: string): void {
  const $ = load(body);
  const aliases = new Map<string, string>();
  $(".devsite-article-body h2").each((_index, heading) => {
    const released = modelDate(text($(heading).text()));
    if (released === undefined) return;
    $(heading)
      .nextUntil("h2")
      .find("li")
      .each((_itemIndex, element) => {
        const item = $(element);
        const value = text(item.text());
        const codes = unique(
          item
            .find("code")
            .map((_codeIndex, code) => text($(code).text()))
            .get()
            .filter((id) => modelIdSchema.safeParse(id).success),
        );
        if (/^(?:Released|Launched|Introduced)\b/i.test(value))
          for (const id of codes) {
            const model = models.get(id);
            if (model !== undefined && model.release_date === undefined)
              model.release_date = released;
          }
        if (/switched to|model behind/i.test(value)) {
          const alias = codes.find((id) => id.endsWith("-latest"));
          const target = codes.find((id) => id !== alias && models.has(id));
          if (alias !== undefined && target !== undefined && !aliases.has(alias))
            aliases.set(alias, target);
        }
      });
  });
  for (const [alias, target] of aliases) {
    const item = models.get(target);
    if (item !== undefined && item.status !== "retired")
      item.aliases = unique([...item.aliases, alias]);
  }
}

function document(bundle: z.infer<typeof linkedBundleSchema>, pathname: string): string {
  const value = bundle.documents.find((item) => new URL(item.url).pathname === pathname)?.body;
  if (value === undefined) throw new Error(`Gemini bundle omitted ${pathname}`);
  return value;
}

export function parseGeminiCatalog(input: Input): ProviderModel[] {
  const extractor = input.source.extractor;
  if (extractor.kind !== "gemini-catalog") throw new Error("Wrong Gemini catalog extractor");
  const bundle = linkedBundleSchema.parse(JSON.parse(input.body));
  const indexCards = cards(bundle.index.body);
  const models = new Map<string, ProviderModel>();
  const versionIds = new Map<string, string[]>();
  const modelDocuments = bundle.documents
    .filter((item) => /^\/gemini-api\/docs\/models\/[a-z0-9.-]+$/.test(new URL(item.url).pathname))
    .sort((left, right) => left.url.localeCompare(right.url));
  for (const page of modelDocuments) {
    const path = new URL(page.url).pathname;
    const parsed = primaryPageModel(input, page.body, indexCards.get(path));
    for (const item of parsed.models) {
      if (models.has(item.model_id)) continue;
      models.set(item.model_id, item);
      versionIds.set(item.model_id, parsed.versionIds);
    }
  }
  applyGemma(
    models,
    input,
    document(bundle, "/gemma/docs/core/gemma_on_gemini_api"),
    document(bundle, "/gemma/docs/core/model_card_4"),
  );
  applyLifecycle(models, input, document(bundle, "/gemini-api/docs/deprecations"));
  for (const [id, aliases] of versionIds) {
    const item = models.get(id);
    if (item !== undefined)
      item.aliases = unique(aliases.filter((alias) => alias !== id && !models.has(alias)));
  }
  applyChangelog(models, document(bundle, "/gemini-api/docs/changelog"));
  applyPricing(models, input.source.id, document(bundle, "/gemini-api/docs/pricing"));
  const values = [...models.values()].sort((left, right) =>
    left.model_id.localeCompare(right.model_id),
  );
  if (values.length < extractor.minModels || values.length > extractor.maxModels)
    throw new Error("Gemini model count outside reviewed bounds");
  return values;
}

export function parseGeminiApi(input: Input): ProviderModel[] {
  const list = apiListSchema.parse(JSON.parse(input.body));
  if (list.nextPageToken !== undefined) throw new Error("Gemini API inventory was truncated");
  const parsed = list.models.map((item) => apiItemSchema.safeParse(item));
  if (parsed.some((result) => !result.success)) throw new Error("Gemini API schema drift");
  return parsed.flatMap((result) => {
    if (!result.success) return [];
    const item = result.data;
    const id = item.name.slice("models/".length);
    const methods = item.supportedGenerationMethods ?? [];
    const normalized = methods.map((method) => method.toLowerCase());
    const modelTypes: ModelType[] = [];
    if (normalized.some((method) => method === "generatecontent" || method === "generatemessage"))
      modelTypes.push("generate");
    if (normalized.some((method) => method === "embedcontent" || method === "batchembedcontent"))
      modelTypes.push("embeddings");
    if (normalized.some((method) => method === "bidigeneratecontent")) modelTypes.push("realtime");
    const aliases =
      item.baseModelId === id || !modelIdSchema.safeParse(item.baseModelId).success
        ? []
        : [item.baseModelId];
    return [
      {
        ...baseModel({
          providerId: input.provider.id,
          id,
          name: item.displayName ?? id,
          sourceId: input.source.id,
          observedAt: input.observedAt,
        }),
        description: item.description,
        aliases,
        types: types(modelTypes.length === 0 ? ["other"] : modelTypes),
        capabilities: {
          ...unknownCapabilities(),
          reasoning: item.thinking ?? "unknown",
          streaming: normalized.some(
            (method) => method === "streamgeneratecontent" || method === "bidigeneratecontent",
          ),
          batch: normalized.some((method) => method.startsWith("batch")),
        },
        limits: {
          context_tokens: item.inputTokenLimit,
          max_input_tokens: item.inputTokenLimit,
          max_output_tokens: item.outputTokenLimit,
        },
        scope: "runtime_observation",
      } satisfies ProviderModel,
    ];
  });
}
