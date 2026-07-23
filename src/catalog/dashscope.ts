import { load } from "cheerio";
import { z } from "zod";
import { linkedBundleSchema } from "./bundle.ts";
import {
  htmlColumn as column,
  type HtmlCell as Cell,
  type HtmlTable as Table,
  htmlTables as tables,
  htmlText as text,
  htmlValue as value,
} from "./html.ts";
import { modelIdSchema } from "./identity.ts";
import { apiEndpointKey, baseModel } from "./model.ts";
import type { SourceManifest } from "./manifests.ts";
import { multiplyDecimal, scaleDecimal } from "./pricing.ts";
import {
  type Modality,
  type ModelType,
  type PriceRate,
  type Provider,
  type ProviderModel,
} from "./schema.ts";

type TriState = ProviderModel["capabilities"]["reasoning"];
type ApiEndpoint = NonNullable<ProviderModel["api_endpoints"]>[number];

interface ParseInput {
  provider: Provider;
  source: SourceManifest;
  body: string;
  observedAt: string;
}

const deploymentPageSchema = z.object({
  output: z.object({
    page_no: z.literal(1),
    page_size: z.number().int().min(1).max(100),
    total: z.number().int().nonnegative(),
    models: z.array(
      z.object({
        model_name: modelIdSchema,
        plans: z.array(
          z.object({
            plan: z.enum(["mu", "cu", "ptu", "ptu_v2", "lora"]),
            templates: z.array(z.unknown()).optional(),
          }),
        ),
      }),
    ),
  }),
});

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function exactId(value: string): string | undefined {
  const parsed = modelIdSchema.safeParse(value.trim());
  return parsed.success ? parsed.data : undefined;
}

function cellIds(cell: Cell | undefined): string[] {
  if (cell === undefined) return [];
  return unique([...cell.parts, cell.text].flatMap((item) => exactId(item) ?? []));
}

function equivalentIds(cell: Cell | undefined): string[] {
  return unique(
    (cell?.quotes ?? [])
      .map((quote) => quote.match(/^Currently equivalent to ([a-z0-9][a-z0-9._:/-]*)$/i)?.[1])
      .flatMap((item) => (item === undefined ? [] : (exactId(item) ?? []))),
  );
}

function ids(table: Table, row: Cell[]): string[] {
  const index = column(table.headers, /^(?:Model ID|Model name|Model)$/i);
  return index === undefined ? [] : cellIds(row[index]);
}

function tokenCount(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const match = raw.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*([kKmM])?/);
  if (match?.[1] === undefined) return undefined;
  const scale = match[2]?.toLowerCase() === "m" ? 1_000_000 : match[2] ? 1_000 : 1;
  const result = Number(match[1]) * scale;
  return Number.isSafeInteger(result) ? result : undefined;
}

function modalities(raw: string | undefined): Modality[] {
  if (raw === undefined) return [];
  const lower = raw.toLowerCase();
  return (["text", "image", "audio", "video"] as const).filter((item) => lower.includes(item));
}

function support(raw: string | undefined): TriState {
  if (raw === undefined || raw === "--" || raw === "-") return "unknown";
  if (/^Supported$/i.test(raw)) return true;
  if (/^(?:Unsupported|Not supported)$/i.test(raw)) return false;
  return "unknown";
}

function rowTypes(
  category: Extract<SourceManifest["extractor"], { kind: "dashscope-catalog" }>["category"],
  id: string,
  rawType: string | undefined,
  api: string | undefined,
  headings: string[],
): ModelType[] {
  const evidence = `${id} ${rawType ?? ""} ${headings.join(" ")}`.toLowerCase();
  const result: ModelType[] = [];
  if (category === "text" || category === "vision" || category === "omni") result.push("generate");
  if (category === "image") result.push("image");
  if (category === "video") result.push("video");
  if (category === "asr") result.push("audio_transcription");
  if (category === "tts") result.push("audio_speech");
  if (category === "embedding")
    result.push(/rerank/i.test(rawType ?? id) ? "rerank" : "embeddings");
  if (/ocr/.test(evidence)) result.push("ocr");
  if (/livetranslate|translation/.test(evidence)) result.push("audio_translation");
  if (/WebSocket|realtime/i.test(`${api ?? ""} ${id}`)) result.push("realtime");
  if (category === "s2s" && result.length === 0) result.push("generate");
  return unique(result.length > 0 ? result : ["other"]);
}

function rowModalities(
  category: Extract<SourceManifest["extractor"], { kind: "dashscope-catalog" }>["category"],
  table: Table,
  row: Cell[],
  rawType: string | undefined,
): ProviderModel["modalities"] {
  const observedInput = modalities(value(table, row, /^Input(?:$| \/)/i));
  const observedOutput = modalities(value(table, row, /^Output(?:$| \/)/i));
  if (observedInput.length > 0 || observedOutput.length > 0)
    return { input: observedInput, output: observedOutput };
  if (category === "text") return { input: ["text"], output: ["text"] };
  if (category === "vision") return { input: ["text", "image", "video"], output: ["text"] };
  if (category === "image")
    return {
      input:
        support(value(table, row, /^Editing(?:$| \/)/i)) === true ? ["text", "image"] : ["text"],
      output: ["image"],
    };
  if (category === "video")
    return {
      input: /image|reference|video edit/i.test(rawType ?? "") ? ["text", "image"] : ["text"],
      output: ["video"],
    };
  if (category === "asr") return { input: ["audio"], output: ["text"] };
  if (category === "tts") return { input: ["text"], output: ["audio"] };
  if (category === "s2s") return { input: ["text", "audio"], output: ["text", "audio"] };
  if (category === "omni")
    return { input: ["text", "image", "audio", "video"], output: ["text", "audio"] };
  if (/rerank/i.test(rawType ?? "")) return { input: ["text"], output: [] };
  return {
    input: /multimodal/i.test(rawType ?? "") ? ["text", "image", "video"] : ["text"],
    output: ["embedding"],
  };
}

function dimensions(raw: string | undefined): ProviderModel["limits"] {
  if (raw === undefined) return {};
  const numbers = [...raw.replace(/,/g, "").matchAll(/\d+/g)].map((match) => Number(match[0]));
  if (numbers.length === 0) return {};
  const defaultValue = raw.match(/default:\s*(\d+)/i)?.[1];
  const first = numbers[0];
  if (first === undefined) return {};
  const second = numbers[1];
  return {
    ...(second === undefined
      ? { embedding_dimensions: [first] }
      : { embedding_dimension_range: { min: first, max: second } }),
    ...(defaultValue === undefined
      ? {}
      : { recommended_embedding_dimensions: [Number(defaultValue)] }),
  };
}

function mergeState(current: TriState, incoming: TriState): TriState {
  if (incoming === "unknown") return current;
  if (current !== "unknown" && current !== incoming)
    throw new Error("Conflicting capability facts");
  return incoming;
}

function rateKey(rate: PriceRate): string {
  return `${rate.meter}:${rate.currency}:${rate.unit}:${JSON.stringify(rate.conditions)}`;
}

function merge(left: ProviderModel, right: ProviderModel): ProviderModel {
  const pricing = new Map(left.pricing.map((item) => [rateKey(item), item]));
  for (const item of right.pricing) pricing.set(rateKey(item), item);
  const endpoints = new Map(
    [...(left.api_endpoints ?? []), ...(right.api_endpoints ?? [])].map((item) => [
      apiEndpointKey(item),
      item,
    ]),
  );
  const availability = new Map(
    [...(left.availability ?? []), ...(right.availability ?? [])].map((item) => [
      `${item.region}\0${item.deployment_type}`,
      item,
    ]),
  );
  return {
    ...left,
    description: left.description ?? right.description,
    aliases: unique([...left.aliases, ...right.aliases]),
    types: unique([...left.types.filter((item) => item !== "other"), ...right.types]),
    raw_type: left.raw_type ?? right.raw_type,
    api_endpoints:
      endpoints.size === 0
        ? undefined
        : [...endpoints.values()].sort((left, right) =>
            apiEndpointKey(left).localeCompare(apiEndpointKey(right)),
          ),
    modalities: {
      input: unique([...left.modalities.input, ...right.modalities.input]),
      output: unique([...left.modalities.output, ...right.modalities.output]),
    },
    capabilities: {
      reasoning: mergeState(left.capabilities.reasoning, right.capabilities.reasoning),
      tool_call: mergeState(left.capabilities.tool_call, right.capabilities.tool_call),
      structured_output: mergeState(
        left.capabilities.structured_output,
        right.capabilities.structured_output,
      ),
      streaming: mergeState(left.capabilities.streaming, right.capabilities.streaming),
      batch: mergeState(left.capabilities.batch, right.capabilities.batch),
      prompt_cache: mergeState(left.capabilities.prompt_cache, right.capabilities.prompt_cache),
      fine_tuning: mergeState(left.capabilities.fine_tuning, right.capabilities.fine_tuning),
      citations: mergeState(left.capabilities.citations, right.capabilities.citations),
      code_execution: mergeState(
        left.capabilities.code_execution,
        right.capabilities.code_execution,
      ),
      context_management: mergeState(
        left.capabilities.context_management,
        right.capabilities.context_management,
      ),
      effort_control: mergeState(
        left.capabilities.effort_control,
        right.capabilities.effort_control,
      ),
      computer_use: mergeState(left.capabilities.computer_use, right.capabilities.computer_use),
    },
    limits: {
      ...left.limits,
      ...right.limits,
      context_tokens:
        Math.max(left.limits.context_tokens ?? 0, right.limits.context_tokens ?? 0) || undefined,
      max_output_tokens:
        Math.max(left.limits.max_output_tokens ?? 0, right.limits.max_output_tokens ?? 0) ||
        undefined,
    },
    status: right.status === "unknown" ? left.status : right.status,
    is_deprecated: mergeState(left.is_deprecated, right.is_deprecated),
    replacement_model_ids: unique([...left.replacement_model_ids, ...right.replacement_model_ids]),
    pricing_status:
      pricing.size === 0
        ? left.pricing_status
        : [...pricing.values()].some((item) => item.derived)
          ? "derived"
          : "published",
    pricing: [...pricing.values()],
    availability: availability.size === 0 ? undefined : [...availability.values()],
  };
}

function add(models: Map<string, ProviderModel>, model: ProviderModel): void {
  const current = models.get(model.model_id);
  models.set(model.model_id, current === undefined ? model : merge(current, model));
}

function bounded(
  models: Map<string, ProviderModel>,
  min: number,
  max: number,
  label: string,
): ProviderModel[] {
  if (models.size < min || models.size > max)
    throw new Error(`${label} model count ${models.size} is outside reviewed bounds`);
  return [...models.values()].sort((left, right) => left.uid.localeCompare(right.uid));
}

export function parseDashscopeCatalog(input: ParseInput): ProviderModel[] {
  const extractor = input.source.extractor;
  if (extractor.kind !== "dashscope-catalog") throw new Error("Wrong DashScope catalog extractor");
  const models = new Map<string, ProviderModel>();
  for (const table of tables(input.body)) {
    for (const row of table.rows) {
      const rawType = value(table, row, /^(?:Type|Mode)(?:$| \/)/i);
      const api = value(table, row, /^API(?:$| \/)/i);
      for (const id of ids(table, row)) {
        const context = tokenCount(value(table, row, /^Context(?:$| \/)/i));
        const output = tokenCount(value(table, row, /^Max output(?:$| \/)/i));
        const dimensionLimits = dimensions(value(table, row, /^Dimension(?:$| \/)/i));
        const embeddingTokens = tokenCount(value(table, row, /^Max tokens(?:$| \/)/i));
        const model = baseModel({
          providerId: input.provider.id,
          id,
          name: id,
          sourceId: input.source.id,
          observedAt: input.observedAt,
        });
        add(models, {
          ...model,
          description: value(table, row, /^(?:Description|Use case|Use cases)(?:$| \/)/i),
          types: rowTypes(extractor.category, id, rawType, api, table.headings),
          raw_type: rawType,
          modalities: rowModalities(extractor.category, table, row, rawType),
          capabilities: {
            ...model.capabilities,
            reasoning: support(value(table, row, /^Thinking mode(?:$| \/)/i)),
            tool_call: support(value(table, row, /^Function (?:Calling|calling)(?:$| \/)/)),
            structured_output: support(value(table, row, /^Structured output(?:$| \/)/i)),
            streaming: /WebSocket/i.test(api ?? "") ? true : "unknown",
          },
          limits: {
            ...dimensionLimits,
            ...(context === undefined ? {} : { context_tokens: context }),
            ...(output === undefined ? {} : { max_output_tokens: output }),
            ...(embeddingTokens === undefined ? {} : { max_input_tokens: embeddingTokens }),
          },
          status: /preview/i.test(id) ? "preview" : "active",
          is_deprecated: false,
          pricing_status: "unknown",
          scope: "regional_catalog",
        });
      }
    }
  }
  return bounded(
    models,
    extractor.minModels,
    extractor.maxModels,
    `DashScope ${extractor.category}`,
  );
}

const recommendedEndpoints = new Map<string, { name: string; protocol: "https:" | "wss:" }>([
  [
    "/api/v1/services/aigc/image-generation/generation",
    { name: "Image Generation", protocol: "https:" },
  ],
  [
    "/api/v1/services/aigc/multimodal-generation/generation",
    { name: "Multimodal Generation", protocol: "https:" },
  ],
  [
    "/api/v1/services/aigc/video-generation/video-synthesis",
    { name: "Video Synthesis", protocol: "https:" },
  ],
  ["/api-ws/v1/inference", { name: "Realtime Inference", protocol: "wss:" }],
  ["/api/v1/services/audio/asr/transcription", { name: "Speech Recognition", protocol: "https:" }],
  ["/api-ws/v1/realtime", { name: "Realtime", protocol: "wss:" }],
  ["/compatible-mode/v1/embeddings", { name: "Embeddings", protocol: "https:" }],
  [
    "/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding",
    { name: "Multimodal Embeddings", protocol: "https:" },
  ],
  ["/api/v1/services/rerank/text-rerank/text-rerank", { name: "Rerank", protocol: "https:" }],
]);

const recommendedRegions = new Map([
  ["Beijing", "China (Beijing)"],
  ["Hong Kong", "Hong Kong (China)"],
  ["Singapore", "Singapore"],
  ["Tokyo", "Japan (Tokyo)"],
  ["Frankfurt", "Germany (Frankfurt)"],
  ["US (Virginia)", "US (Virginia)"],
  ["International", "International"],
]);

function recommendedEndpoint(raw: string): ApiEndpoint {
  const url = new URL(raw);
  const fact = recommendedEndpoints.get(url.pathname);
  if (
    fact === undefined ||
    url.protocol !== fact.protocol ||
    url.hostname !== "dashscope-intl.aliyuncs.com" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.search !== "" ||
    url.hash !== ""
  )
    throw new Error(`Unsupported DashScope recommended-model endpoint: ${raw}`);
  return { name: fact.name, path: url.pathname };
}

export function parseDashscopeRecommended(input: ParseInput): ProviderModel[] {
  const extractor = input.source.extractor;
  if (extractor.kind !== "dashscope-recommended")
    throw new Error("Wrong DashScope recommended-model extractor");
  const $ = load(input.body);
  const models = new Map<string, ProviderModel>();
  $(".bl-cardwrap").each((_index, element) => {
    const card = $(element);
    const names = unique(
      card
        .find(".bl-card-name")
        .map((_nameIndex, name) => text($(name).text()))
        .get()
        .filter(Boolean),
    );
    const id = names.length === 1 ? exactId(names[0] ?? "") : undefined;
    const publishedIds = unique(
      card
        .find(".bl-pop-row")
        .filter((_rowIndex, row) => text($(row).find(".bl-pop-k").first().text()) === "Model ID")
        .map((_rowIndex, row) => exactId(text($(row).find("code").first().text())) ?? "")
        .get()
        .filter(Boolean),
    );
    if (id === undefined || publishedIds.length !== 1 || publishedIds[0] !== id)
      throw new Error("DashScope recommended-model card ID drifted");
    const availability = unique(
      card
        .find(".bl-pop > .bl-tabs > label")
        .map((_regionIndex, label) => text($(label).text()))
        .get()
        .filter(Boolean),
    ).map((raw) => {
      const region = recommendedRegions.get(raw);
      if (region === undefined)
        throw new Error(`Unsupported DashScope recommended-model region: ${raw}`);
      return { region, deployment_type: "model_api" };
    });
    if (availability.length === 0)
      throw new Error(`DashScope recommended-model card omitted regions for ${id}`);
    const endpoints = new Map(
      card
        .find(".bl-pop-row")
        .filter((_rowIndex, row) => text($(row).find(".bl-pop-k").first().text()) === "Request URL")
        .map((_rowIndex, row) => recommendedEndpoint(text($(row).find("code").first().text())))
        .get()
        .map((endpoint) => [apiEndpointKey(endpoint), endpoint]),
    );
    const model = baseModel({
      providerId: input.provider.id,
      id,
      name: id,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    });
    add(models, {
      ...model,
      api_endpoints:
        endpoints.size === 0
          ? undefined
          : [...endpoints.values()].sort((left, right) =>
              apiEndpointKey(left).localeCompare(apiEndpointKey(right)),
            ),
      availability,
      scope: "regional_catalog",
    });
  });
  return bounded(models, extractor.minModels, extractor.maxModels, "DashScope recommended-model");
}

function decimal(raw: string): string | undefined {
  const normalized = raw.replace(/,/g, "");
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalized)) return undefined;
  const [whole = "0", fraction = ""] = normalized.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed === "" ? whole : `${whole}.${trimmed}`;
}

function unit(header: string, raw: string): PriceRate["unit"] | undefined {
  const evidence = `${header} ${raw}`.toLowerCase();
  if (/million (?:input )?tokens/.test(evidence)) return "million_tokens";
  if (/10,000 characters/.test(evidence)) return "million_characters";
  if (/\/image|per image/.test(evidence)) return "image";
  if (/\/second|per second/.test(evidence)) return "second";
  if (/voice clone/.test(evidence)) return "request";
  return undefined;
}

function meter(
  header: string,
  headings: string[],
  types: ModelType[],
  rateUnit: PriceRate["unit"],
): PriceRate["meter"] {
  const evidence = `${header} ${headings.join(" ")}`.toLowerCase();
  if (rateUnit === "image" || types.includes("image")) return "image_generation";
  if (types.includes("video")) return "video_generation";
  if (types.includes("audio_generation")) return "output_audio";
  if (types.includes("audio_transcription")) return "input_audio";
  if (/output/.test(header.toLowerCase())) {
    if (/audio/.test(header.toLowerCase())) return "output_audio";
    if (/image/.test(header.toLowerCase())) return "output_image";
    if (/video/.test(header.toLowerCase())) return "output_video";
    return "output_text";
  }
  if (/audio/.test(header.toLowerCase())) return "input_audio";
  if (/image/.test(header.toLowerCase())) return "input_image";
  if (/video/.test(header.toLowerCase())) return "input_video";
  if (/voice clone/.test(evidence)) return "tool_call";
  return types.includes("embeddings") ? "embedding" : "input_text";
}

function priceConditions(table: Table, row: Cell[], header: string): PriceRate["conditions"] {
  const observedRegion = table.headings.find((heading) =>
    /^(?:Singapore|China \(Beijing\)|Hong Kong \(China\)|China \(Hong Kong\)|Germany \(Frankfurt\)|Japan \(Tokyo\)|US \(Virginia\))$/.test(
      heading,
    ),
  );
  const region = observedRegion === "China (Hong Kong)" ? "Hong Kong (China)" : observedRegion;
  const deployment = value(table, row, /^Deployment (?:scope|region)|^Service deployment scope/i);
  const tier = value(table, row, /^Input token(?:s| range) per request/i);
  const range = tier
    ?.replace(/,/g, "")
    .match(/(?:(\d+(?:\.\d+)?[KM]?)<)?Token≤(\d+(?:\.\d+)?[KM]?)/i);
  const mode = value(table, row, /^Mode(?:$| \/)/i);
  const subheading = header.split(" / ").at(-1);
  const operation = mode ?? (/thinking mode/i.test(subheading ?? "") ? subheading : undefined);
  const resolution = value(table, row, /^(?:Output video )?resolution|^Max resolution/i);
  return {
    ...(region === undefined ? {} : { region }),
    ...(deployment === undefined ? {} : { deployment_scope: deployment }),
    ...(range?.[1] === undefined ? {} : { context_min_tokens: tokenCount(range[1]) }),
    ...(range?.[2] === undefined ? {} : { context_max_tokens: tokenCount(range[2]) }),
    ...(tier === undefined || /No tiered|flat-rate/i.test(tier) ? {} : { context_tier: tier }),
    ...(operation === undefined
      ? {}
      : { operation: text(operation).toLowerCase().replace(/\W+/g, "_") }),
    ...(resolution === undefined ? {} : { resolution }),
    ...(subheading === undefined || !/^(?:Text|Audio|Image|Video|Image\/video)/i.test(subheading)
      ? {}
      : { modality: subheading.toLowerCase() }),
  };
}

interface PriceSegment {
  price: string;
  label?: string;
}

function priceSegments(cell: Cell): PriceSegment[] {
  const parts = cell.parts.length === 0 ? [cell.text] : cell.parts;
  const pricedParts = parts.filter((part) => /\$[\d,.]+|^Free$/i.test(part.trim()));
  return pricedParts.flatMap((raw) => {
    if (/^Free$/i.test(raw.trim())) return [{ price: "0" }];
    const matches = [...raw.matchAll(/\$([\d,.]+)/g)];
    return matches.flatMap((match, index) => {
      const price = match[1] === undefined ? undefined : decimal(match[1]);
      if (price === undefined) return [];
      const start =
        index === 0 ? 0 : (matches[index - 1]?.index ?? 0) + (matches[index - 1]?.[0].length ?? 0);
      const label = text(raw.slice(start, match.index));
      return [
        {
          price,
          ...(label === "" || (pricedParts.length === 1 && matches.length === 1) ? {} : { label }),
        },
      ];
    });
  });
}

function segmentConditions(label: string | undefined): PriceRate["conditions"] {
  if (label === undefined) return {};
  const resolution = label.match(/\b\d{3,4}P\b/i)?.[0];
  const promptExtend = label.match(/prompt_extend=(true|false)/i)?.[0];
  const modality = label.match(/(?:Image\/video|Text|Audio|Image|Video)\s*:?[\s]*$/i)?.[0];
  const normalized = text(label.replace(/^(?:List price|Output video):\s*/i, "")).replace(
    /[:：]+$/,
    "",
  );
  const operation =
    normalized === "" || /^(?:Image\/video|Text|Audio|Image|Video)$/i.test(normalized)
      ? undefined
      : normalized;
  return {
    ...(resolution === undefined ? {} : { resolution }),
    ...(promptExtend === undefined ? {} : { operation: promptExtend }),
    ...(modality === undefined ? {} : { modality: modality.replace(/[:\s]+$/g, "").toLowerCase() }),
    ...(resolution === undefined && promptExtend === undefined && operation !== undefined
      ? { operation: operation.toLowerCase().replace(/\W+/g, "_") }
      : {}),
  };
}

function normalizedPrice(price: string, rateUnit: PriceRate["unit"]): string {
  return rateUnit === "million_characters" ? scaleDecimal(price, 2) : price;
}

function rates(table: Table, row: Cell[], types: ModelType[], sourceId: string): PriceRate[] {
  const result: PriceRate[] = [];
  const idIndex = column(table.headers, /^(?:Model ID|Model name|Model)$/i);
  const idCell = idIndex === undefined ? undefined : row[idIndex];
  const priceIndexes = table.headers.flatMap((header, index) =>
    /price/i.test(header) ? [index] : [],
  );
  for (const [index, header] of table.headers.entries()) {
    if (!/price/i.test(header)) continue;
    const effectiveHeader =
      /Qwen-TTS-Realtime/i.test(table.headings.join(" ")) && index === priceIndexes[1]
        ? header.replace(/^Input/i, "Output")
        : header;
    const cell = row[index];
    if (cell === undefined) continue;
    const raw = cell.text;
    const rateUnit = unit(effectiveHeader, raw);
    if (rateUnit === undefined) continue;
    const baseConditions = priceConditions(table, row, effectiveHeader);
    for (const segment of priceSegments(cell)) {
      const base: PriceRate = {
        meter: meter(effectiveHeader, table.headings, types, rateUnit),
        price: normalizedPrice(segment.price, rateUnit),
        currency: "USD",
        unit: rateUnit,
        conditions: { ...baseConditions, ...segmentConditions(segment.label) },
        source_ref: sourceId,
        derived: rateUnit === "million_characters",
        derivation:
          rateUnit === "million_characters"
            ? "source price per 10,000 characters × 100"
            : undefined,
        raw_price: segment.price,
        raw_unit: header,
      };
      result.push(base);
      for (const match of raw.matchAll(/(?:(night|daytime)\s+)?(\d+)% off/gi)) {
        const percent = Number(match[2]);
        if (!Number.isInteger(percent) || percent < 0 || percent > 100) continue;
        const remainder = 100 - percent;
        const factor =
          remainder === 100
            ? "1"
            : remainder === 0
              ? "0"
              : `0.${String(remainder).padStart(2, "0")}`;
        result.push({
          ...base,
          price: multiplyDecimal(base.price, factor),
          conditions: {
            ...base.conditions,
            service_tier: match[1]?.toLowerCase() ?? `limited_time_${percent}_percent_off`,
            promotion: true,
          },
          derived: true,
          derivation: `source list price × ${factor}`,
        });
      }
      if (/50%\s+batch inference discount/i.test(idCell?.text ?? ""))
        result.push({
          ...base,
          price: multiplyDecimal(base.price, "0.5"),
          conditions: { ...base.conditions, service_tier: "batch" },
          derived: true,
          derivation: "source real-time price × 0.5",
        });
    }
  }
  return result;
}

function priceTypes(id: string, headings: string[]): ModelType[] {
  const evidence = `${id} ${headings.join(" ")}`.toLowerCase();
  const result: ModelType[] = [];
  if (/embedding/.test(evidence)) result.push("embeddings");
  if (/rerank/.test(evidence)) result.push("rerank");
  if (/image generation|image processing|text-to-image/.test(evidence)) result.push("image");
  if (/video generation|video processing/.test(evidence)) result.push("video");
  if (/music generation/.test(evidence)) result.push("audio_generation");
  if (/speech synthesis|tts|cosyvoice|voice (?:clone|design|enrollment)/.test(evidence))
    result.push("audio_speech");
  if (/livetranslate|speech translation/.test(evidence)) result.push("audio_translation");
  if (/speech recognition|(?:^|[ -])asr|paraformer/.test(evidence))
    result.push("audio_transcription");
  if (/realtime/.test(evidence)) result.push("realtime");
  if (/intent/.test(evidence)) result.push("classification");
  if (/ocr/.test(evidence)) result.push("ocr");
  if (result.length === 0) result.push("generate");
  return unique(result);
}

function priceModalities(types: ModelType[], modelRates: PriceRate[]): ProviderModel["modalities"] {
  const input: Modality[] = [];
  const output: Modality[] = [];
  for (const item of modelRates) {
    if (item.meter === "input_text" || item.meter === "embedding") input.push("text");
    if (item.meter === "input_image") input.push("image");
    if (item.meter === "input_audio") input.push("audio");
    if (item.meter === "input_video") input.push("video");
    if (item.meter === "output_text") output.push("text");
    if (item.meter === "output_image" || item.meter === "image_generation") output.push("image");
    if (item.meter === "output_audio") output.push("audio");
    if (item.meter === "output_video" || item.meter === "video_generation") output.push("video");
  }
  if (types.includes("embeddings")) output.push("embedding");
  if (types.includes("audio_speech") || types.includes("audio_generation")) output.push("audio");
  if (types.includes("audio_transcription")) output.push("text");
  return { input: unique(input), output: unique(output) };
}

function cacheModels(body: string): Map<string, Set<string>> {
  const $ = load(body);
  const result = new Map<string, Set<string>>();
  for (const mode of ["Explicit cache", "Implicit cache"] as const) {
    const root = $("h2")
      .filter((_index, element) => text($(element).text()) === mode)
      .first()
      .parent("section");
    root
      .find("h2")
      .filter((_index, element) => text($(element).text()) !== mode)
      .each((_index, heading) => {
        const region = text($(heading).text());
        if (
          !/^(?:Singapore|China \(Beijing\)|Germany \(Frankfurt\)|Hong Kong \(China\)|China \(Hong Kong\)|Japan \(Tokyo\)|US \(Virginia\))$/.test(
            region,
          )
        )
          return;
        $(heading)
          .parent("section")
          .find("p")
          .each((_paragraphIndex, paragraph) => {
            const suffix = text($(paragraph).text()).split(":").at(-1);
            if (suffix === undefined) return;
            for (const candidate of suffix.split(",")) {
              const id = exactId(candidate);
              if (id === undefined) continue;
              const canonicalRegion = region === "China (Hong Kong)" ? "Hong Kong (China)" : region;
              const key = `${mode}\0${canonicalRegion}`;
              const values = result.get(key) ?? new Set<string>();
              values.add(id);
              result.set(key, values);
            }
          });
      });
  }
  return result;
}

function cacheRate(
  input: PriceRate,
  meterName: "cache_read_text" | "cache_write_text",
  factor: string,
  operation: string,
  ttl?: number,
): PriceRate {
  return {
    ...input,
    meter: meterName,
    price: multiplyDecimal(input.price, factor),
    conditions: {
      ...input.conditions,
      operation,
      ...(ttl === undefined ? {} : { cache_ttl_seconds: ttl }),
    },
    derived: true,
    derivation: `source input price × ${factor}`,
  };
}

export function parseDashscopePricing(input: ParseInput): ProviderModel[] {
  const extractor = input.source.extractor;
  if (extractor.kind !== "dashscope-pricing") throw new Error("Wrong DashScope pricing extractor");
  const bundle = linkedBundleSchema.parse(JSON.parse(input.body));
  const cacheBody = bundle.documents.find(
    ({ url }) => new URL(url).pathname === "/help/en/model-studio/context-cache",
  )?.body;
  if (cacheBody === undefined) throw new Error("DashScope pricing bundle omitted context cache");
  const cache = cacheModels(cacheBody);
  const models = new Map<string, ProviderModel>();
  for (const table of tables(bundle.index.body)) {
    const idIndex = column(table.headers, /^(?:Model ID|Model name|Model)$/i);
    if (idIndex === undefined) continue;
    for (const row of table.rows) {
      const idCell = row[idIndex];
      const id = cellIds(idCell)[0];
      if (id === undefined) continue;
      const types = priceTypes(id, table.headings);
      const modelRates = rates(table, row, types, input.source.id);
      const model = baseModel({
        providerId: input.provider.id,
        id,
        name: id,
        sourceId: input.source.id,
        observedAt: input.observedAt,
      });
      const region = modelRates[0]?.conditions.region;
      add(models, {
        ...model,
        aliases: equivalentIds(idCell),
        types,
        modalities: priceModalities(types, modelRates),
        status: /preview/i.test(id) ? "preview" : "active",
        is_deprecated: false,
        pricing_status: modelRates.length === 0 ? "unknown" : "published",
        pricing: modelRates,
        availability: region === undefined ? undefined : [{ region, deployment_type: "model_api" }],
        scope: "regional_catalog",
      });
    }
  }
  for (const [key, idsForRegion] of cache) {
    const region = key.split("\0")[1] ?? "";
    for (const id of idsForRegion) {
      const current = models.get(id);
      const model = baseModel({
        providerId: input.provider.id,
        id,
        name: id,
        sourceId: input.source.id,
        observedAt: input.observedAt,
      });
      add(models, {
        ...model,
        types: current?.types ?? ["generate"],
        modalities: current?.modalities ?? { input: ["text"], output: ["text"] },
        capabilities: { ...model.capabilities, prompt_cache: true },
        status: current?.status ?? (/preview/i.test(id) ? "preview" : "active"),
        is_deprecated: false,
        availability: [{ region, deployment_type: "model_api" }],
        scope: "regional_catalog",
      });
    }
  }
  for (const [id, model] of models) {
    const baseRates = model.pricing.filter(
      (item) => item.meter === "input_text" && item.conditions.promotion !== true,
    );
    const derived: PriceRate[] = [];
    for (const item of baseRates) {
      const region = item.conditions.region;
      if (region === undefined) continue;
      if (cache.get(`Explicit cache\0${region}`)?.has(id)) {
        derived.push(cacheRate(item, "cache_write_text", "1.25", "explicit_cache", 300));
        derived.push(cacheRate(item, "cache_read_text", "0.1", "explicit_cache", 300));
      }
      if (cache.get(`Implicit cache\0${region}`)?.has(id))
        derived.push(cacheRate(item, "cache_read_text", "0.2", "implicit_cache"));
    }
    if (derived.length > 0)
      models.set(id, merge(model, { ...model, pricing_status: "derived", pricing: derived }));
  }
  return bounded(models, extractor.minModels, extractor.maxModels, "DashScope pricing");
}

function lifecycleTypes(category: string, id: string): ModelType[] {
  const evidence = `${category} ${id}`.toLowerCase();
  if (/rerank/.test(evidence)) return ["rerank"];
  if (/embedding/.test(evidence)) return ["embeddings"];
  if (/image/.test(evidence)) return ["image"];
  if (/video/.test(evidence)) return ["video"];
  if (/tts|cosyvoice/.test(evidence)) return ["audio_speech"];
  if (/asr|paraformer/.test(evidence)) return ["audio_transcription"];
  if (/ocr/.test(evidence)) return ["ocr"];
  return ["generate"];
}

function modelDate(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const match = raw.match(new RegExp(`(${months.join("|")}) (\\d{1,2}), (\\d{4})`, "i"));
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined)
    return undefined;
  const month = months.findIndex((value) => value.toLowerCase() === match[1]?.toLowerCase()) + 1;
  return `${match[3]}-${String(month).padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

export function parseDashscopeLifecycle(input: ParseInput): ProviderModel[] {
  const extractor = input.source.extractor;
  if (extractor.kind !== "dashscope-lifecycle")
    throw new Error("Wrong DashScope lifecycle extractor");
  const models = new Map<string, ProviderModel>();
  for (const table of tables(input.body)) {
    const modelColumn = column(table.headers, /^Model name$/i);
    const replacementColumn = column(table.headers, /^Replacement model$/i);
    if (modelColumn === undefined) continue;
    for (const row of table.rows) {
      const category = value(table, row, /^Category$/i) ?? "";
      const retiredAt = modelDate(value(table, row, /^Deprecation time$/i));
      for (const id of cellIds(row[modelColumn])) {
        const model = baseModel({
          providerId: input.provider.id,
          id,
          name: id,
          sourceId: input.source.id,
          observedAt: input.observedAt,
        });
        add(models, {
          ...model,
          types: lifecycleTypes(category, id),
          status:
            retiredAt !== undefined && retiredAt <= input.observedAt.slice(0, 10)
              ? "retired"
              : "deprecated",
          is_deprecated: true,
          retired_at: retiredAt,
          replacement_model_ids:
            replacementColumn === undefined ? [] : cellIds(row[replacementColumn]),
          pricing_status: "unknown",
          scope: "regional_catalog",
        });
      }
    }
  }
  return bounded(models, extractor.minModels, extractor.maxModels, "DashScope lifecycle");
}

export function parseDashscopeApi(input: ParseInput): ProviderModel[] {
  const extractor = input.source.extractor;
  if (extractor.kind !== "dashscope-api") throw new Error("Wrong DashScope API extractor");
  const page = deploymentPageSchema.parse(JSON.parse(input.body)).output;
  if (page.total > page.page_size || page.models.length !== page.total)
    throw new Error("DashScope deployable-model pagination is incomplete");
  const models = new Map<string, ProviderModel>();
  for (const item of page.models) {
    const model = baseModel({
      providerId: input.provider.id,
      id: item.model_name,
      name: item.model_name,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    });
    add(models, {
      ...model,
      availability: unique(item.plans.map(({ plan }) => plan)).map((plan) => ({
        region: "Singapore",
        deployment_type: plan,
      })),
      scope: "runtime_observation",
    });
  }
  return bounded(models, extractor.minModels, extractor.maxModels, "DashScope API");
}
