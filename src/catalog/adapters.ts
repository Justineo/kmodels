import { load } from "cheerio";
import { z } from "zod";
import type { SourceManifest } from "./manifests.ts";
import {
  modalitySchema,
  type Modality,
  type ModelType,
  type PriceRate,
  type ProviderModel,
  type Provider,
  unknownCapabilities,
} from "./schema.ts";

const decimalValue = z
  .union([z.string(), z.number().finite().nonnegative()])
  .transform((value) => String(value));

const tierSchema = z.object({
  cost: decimalValue,
  min: z.number().int().nonnegative().optional(),
  max: z.number().int().nonnegative().optional(),
});

const vercelItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  released: z.number().int().nonnegative().optional(),
  type: z.string().optional(),
  tags: z.array(z.string()).optional(),
  context_window: z.number().int().nonnegative().optional(),
  max_tokens: z.number().int().nonnegative().optional(),
  modalities: z
    .object({ input: z.array(z.string()).optional(), output: z.array(z.string()).optional() })
    .optional(),
  supported_parameters: z.array(z.string()).optional(),
  pricing: z
    .object({
      input: decimalValue.optional(),
      output: decimalValue.optional(),
      input_cache_read: decimalValue.optional(),
      input_cache_write: decimalValue.optional(),
      input_tiers: z.array(tierSchema).optional(),
      output_tiers: z.array(tierSchema).optional(),
      input_cache_read_tiers: z.array(tierSchema).optional(),
      input_cache_write_tiers: z.array(tierSchema).optional(),
    })
    .optional(),
});

const cerebrasItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  created: z.number().int().nonnegative().optional(),
  preview: z.boolean().optional(),
  deprecated: z.boolean().optional(),
  pricing: z
    .object({ prompt: decimalValue.optional(), completion: decimalValue.optional() })
    .optional(),
  capabilities: z
    .object({
      streaming: z.boolean().optional(),
      function_calling: z.boolean().optional(),
      structured_outputs: z.boolean().optional(),
      vision: z.boolean().optional(),
      reasoning: z.boolean().optional(),
    })
    .optional(),
  limits: z
    .object({
      max_context_length: z.number().int().nonnegative().nullable().optional(),
      max_completion_tokens: z.number().int().nonnegative().nullable().optional(),
    })
    .optional(),
});

const huggingFaceRouteSchema = z.object({
  provider: z.string().min(1),
  context_length: z.number().int().nonnegative().optional(),
  supports_tools: z.boolean().optional(),
  supports_structured_output: z.boolean().optional(),
  pricing: z.object({ input: decimalValue.optional(), output: decimalValue.optional() }).optional(),
});

const huggingFaceItemSchema = z.object({
  id: z.string().min(1),
  owned_by: z.string().optional(),
  created: z.number().int().nonnegative().optional(),
  architecture: z
    .object({
      input_modalities: z.array(z.string()).optional(),
      output_modalities: z.array(z.string()).optional(),
    })
    .optional(),
  providers: z.array(huggingFaceRouteSchema).min(1),
});

const ollamaItemSchema = z.object({
  name: z.string().min(1),
  model: z.string().min(1).optional(),
  modified_at: z.string().optional(),
});

const listSchema = z.object({ data: z.array(z.unknown()) });
const ollamaListSchema = z.object({ models: z.array(z.unknown()) });

interface ParseInput {
  provider: Provider;
  source: SourceManifest;
  body: string;
  observedAt: string;
}

interface BaseModelInput {
  providerId: string;
  id: string;
  name: string;
  sourceId: string;
  observedAt: string;
}

type Tier = z.infer<typeof tierSchema>;

function parseJson(body: string): unknown {
  return JSON.parse(body);
}

function unixDate(seconds: number | undefined): string | undefined {
  return seconds === undefined ? undefined : new Date(seconds * 1000).toISOString().slice(0, 10);
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function modalities(values: string[] | undefined): Modality[] {
  if (values === undefined) return [];
  return unique(
    values.flatMap((value) => {
      const parsed = modalitySchema.safeParse(value);
      return parsed.success ? [parsed.data] : [];
    }),
  );
}

function baseModel(input: BaseModelInput): ProviderModel {
  return {
    provider_id: input.providerId,
    model_id: input.id,
    uid: `${input.providerId}/${input.id}`,
    id_kind: "api_id",
    name: input.name,
    aliases: [],
    types: ["other"],
    modalities: { input: [], output: [] },
    capabilities: unknownCapabilities(),
    limits: {},
    status: "unknown",
    pricing_status: "unknown",
    pricing: [],
    scope: "global_catalog",
    account_availability: "unknown",
    first_seen_at: input.observedAt,
    last_seen_at: input.observedAt,
    observed_at: input.observedAt,
    source_refs: [input.sourceId],
  };
}

export function scaleDecimal(value: string, places: number): string {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    throw new Error(`Invalid decimal: ${value}`);
  }
  const [whole = "", fraction = ""] = value.split(".");
  const digits = `${whole}${fraction}`;
  const point = whole.length + places;
  const padded = point >= digits.length ? `${digits}${"0".repeat(point - digits.length)}` : digits;
  const integer = padded.slice(0, point).replace(/^0+(?=\d)/, "") || "0";
  const decimals = padded.slice(point).replace(/0+$/, "");
  return decimals ? `${integer}.${decimals}` : integer;
}

function tokenRate(
  meter: PriceRate["meter"],
  value: string,
  sourceId: string,
  rawUnit: string,
  conditions: PriceRate["conditions"] = {},
  scale = true,
): PriceRate {
  return {
    meter,
    price: scale ? scaleDecimal(value, 6) : value,
    currency: "USD",
    unit: "million_tokens",
    conditions,
    source_ref: sourceId,
    derived: scale,
    derivation: scale ? "source price per token × 1,000,000" : undefined,
    raw_price: value,
    raw_unit: rawUnit,
  };
}

function addTieredRates(
  rates: PriceRate[],
  meter: PriceRate["meter"],
  sourceId: string,
  value: string | undefined,
  tiers: Tier[] | undefined,
): void {
  if (tiers !== undefined && tiers.length > 0) {
    for (const tier of tiers) {
      rates.push(
        tokenRate(meter, tier.cost, sourceId, "token", {
          context_min_tokens: tier.min,
          context_max_tokens: tier.max,
        }),
      );
    }
    return;
  }
  if (value !== undefined) rates.push(tokenRate(meter, value, sourceId, "token"));
}

function typesFromVercel(rawType: string | undefined, tags: string[]): ModelType[] {
  const types: ModelType[] = [];
  switch (rawType) {
    case "language":
      types.push("language");
      break;
    case "embedding":
      types.push("embedding");
      break;
    case "image":
    case "image-generation":
      types.push("image_generation");
      break;
    case "video":
      types.push("video_generation");
      break;
    default:
      types.push("other");
  }
  if (tags.includes("reasoning")) types.push("reasoning");
  if (tags.includes("vision") || tags.includes("file-input")) types.push("multimodal");
  return unique(types);
}

function parseVercel(input: ParseInput): ProviderModel[] {
  const list = listSchema.parse(parseJson(input.body));
  const results = list.data.map((item) => vercelItemSchema.safeParse(item));
  const invalid = results.filter((result) => !result.success).length;
  if (list.data.length === 0 || invalid / list.data.length > 0.05)
    throw new Error("Vercel model schema drift");

  return results.flatMap((result) => {
    if (!result.success) return [];
    const item = result.data;
    const tags = item.tags ?? [];
    const parameters = item.supported_parameters ?? [];
    const prices: PriceRate[] = [];
    const pricing = item.pricing;
    if (pricing !== undefined) {
      addTieredRates(prices, "input_text", input.source.id, pricing.input, pricing.input_tiers);
      addTieredRates(prices, "output_text", input.source.id, pricing.output, pricing.output_tiers);
      addTieredRates(
        prices,
        "cache_read_text",
        input.source.id,
        pricing.input_cache_read,
        pricing.input_cache_read_tiers,
      );
      addTieredRates(
        prices,
        "cache_write_text",
        input.source.id,
        pricing.input_cache_write,
        pricing.input_cache_write_tiers,
      );
    }
    return [
      {
        ...baseModel({
          providerId: input.provider.id,
          id: item.id,
          name: item.name ?? item.id,
          sourceId: input.source.id,
          observedAt: input.observedAt,
        }),
        description: item.description || undefined,
        types: typesFromVercel(item.type, tags),
        raw_type: item.type,
        modalities: {
          input: modalities(item.modalities?.input),
          output: modalities(item.modalities?.output),
        },
        capabilities: {
          reasoning: tags.includes("reasoning") ? true : "unknown",
          tool_call: tags.includes("tool-use") || parameters.includes("tools") ? true : "unknown",
          structured_output: parameters.includes("response_format") ? true : "unknown",
          streaming: "unknown",
          batch: "unknown",
          prompt_cache:
            prices.some(
              (rate) => rate.meter === "cache_read_text" || rate.meter === "cache_write_text",
            ) || tags.includes("implicit-caching")
              ? true
              : "unknown",
          fine_tuning: "unknown",
        },
        limits: { context_tokens: item.context_window, max_output_tokens: item.max_tokens },
        release_date: unixDate(item.released),
        status: "active",
        pricing_status: prices.length > 0 ? "derived" : "unknown",
        pricing: prices,
      },
    ];
  });
}

function parseCerebras(input: ParseInput): ProviderModel[] {
  const list = listSchema.parse(parseJson(input.body));
  const results = list.data.map((item) => cerebrasItemSchema.safeParse(item));
  const invalid = results.filter((result) => !result.success).length;
  if (list.data.length === 0 || invalid > 0) throw new Error("Cerebras model schema drift");

  return results.flatMap((result) => {
    if (!result.success) return [];
    const item = result.data;
    const prices: PriceRate[] = [];
    if (item.pricing?.prompt !== undefined)
      prices.push(tokenRate("input_text", item.pricing.prompt, input.source.id, "token"));
    if (item.pricing?.completion !== undefined)
      prices.push(tokenRate("output_text", item.pricing.completion, input.source.id, "token"));
    const vision = item.capabilities?.vision === true;
    const reasoning = item.capabilities?.reasoning === true;
    const types: ModelType[] = ["language"];
    if (reasoning) types.push("reasoning");
    if (vision) types.push("multimodal");
    return [
      {
        ...baseModel({
          providerId: input.provider.id,
          id: item.id,
          name: item.name ?? item.id,
          sourceId: input.source.id,
          observedAt: input.observedAt,
        }),
        description: item.description,
        types,
        modalities: { input: vision ? ["text", "image"] : ["text"], output: ["text"] },
        capabilities: {
          reasoning: item.capabilities?.reasoning ?? "unknown",
          tool_call: item.capabilities?.function_calling ?? "unknown",
          structured_output: item.capabilities?.structured_outputs ?? "unknown",
          streaming: item.capabilities?.streaming ?? "unknown",
          batch: "unknown",
          prompt_cache: "unknown",
          fine_tuning: "unknown",
        },
        limits: {
          context_tokens: item.limits?.max_context_length ?? undefined,
          max_output_tokens: item.limits?.max_completion_tokens ?? undefined,
        },
        release_date: unixDate(item.created),
        status: item.deprecated ? "deprecated" : item.preview ? "preview" : "active",
        pricing_status: prices.length > 0 ? "derived" : "unknown",
        pricing: prices,
      },
    ];
  });
}

function consensus(values: (boolean | undefined)[]): boolean | "unknown" {
  const known = values.filter((value) => value !== undefined);
  if (known.length === 0) return "unknown";
  if (known.every((value) => value)) return true;
  if (known.every((value) => !value)) return false;
  return "unknown";
}

function parseHuggingFace(input: ParseInput): ProviderModel[] {
  const list = listSchema.parse(parseJson(input.body));
  const results = list.data.map((item) => huggingFaceItemSchema.safeParse(item));
  const invalid = results.filter((result) => !result.success).length;
  if (list.data.length === 0 || invalid / list.data.length > 0.05)
    throw new Error("Hugging Face model schema drift");

  return results.flatMap((result) => {
    if (!result.success) return [];
    const item = result.data;
    const prices: PriceRate[] = [];
    for (const route of item.providers) {
      if (route.pricing?.input !== undefined)
        prices.push(
          tokenRate(
            "input_text",
            route.pricing.input,
            input.source.id,
            "million_tokens",
            { route_provider: route.provider },
            false,
          ),
        );
      if (route.pricing?.output !== undefined)
        prices.push(
          tokenRate(
            "output_text",
            route.pricing.output,
            input.source.id,
            "million_tokens",
            { route_provider: route.provider },
            false,
          ),
        );
    }
    const inputModalities = modalities(item.architecture?.input_modalities);
    const outputModalities = modalities(item.architecture?.output_modalities);
    const contexts = unique(
      item.providers.flatMap((route) =>
        route.context_length === undefined ? [] : [route.context_length],
      ),
    );
    return [
      {
        ...baseModel({
          providerId: input.provider.id,
          id: item.id,
          name: item.id,
          sourceId: input.source.id,
          observedAt: input.observedAt,
        }),
        types: inputModalities.some((value) => value !== "text")
          ? ["language", "multimodal"]
          : ["language"],
        modalities: { input: inputModalities, output: outputModalities },
        capabilities: {
          ...unknownCapabilities(),
          tool_call: consensus(item.providers.map((route) => route.supports_tools)),
          structured_output: consensus(
            item.providers.map((route) => route.supports_structured_output),
          ),
        },
        limits: { context_tokens: contexts.length === 1 ? contexts[0] : undefined },
        release_date: unixDate(item.created),
        status: "active",
        pricing_status: prices.length > 0 ? "published" : "unknown",
        pricing: prices,
      },
    ];
  });
}

function documentFragments(body: string, source: SourceManifest): string[] {
  const fragments: string[] = [];
  const $ = load(body);
  if (
    source.extractor.kind === "document-identifiers" &&
    source.extractor.linkTarget !== undefined
  ) {
    const linkTarget = source.extractor.linkTarget;
    for (const match of body.matchAll(/(?<!!)\[([^\]]+)\]\(([^)]+)\)/g)) {
      const label = match[1]?.replace(/\\\+/g, "+").trim();
      const target = match[2]?.trim();
      if (label !== undefined && target !== undefined && linkTarget.test(target))
        fragments.push(label);
    }
    $("a[href]").each((_index, element) => {
      const target = $(element).attr("href");
      if (target === undefined || !linkTarget.test(target)) return;
      const lastSegment = target.split("/").filter(Boolean).at(-1)?.split(/[?#]/)[0];
      if (lastSegment !== undefined) fragments.push(decodeURIComponent(lastSegment));
    });
    return unique(fragments);
  }
  $("code").each((_index, element) => {
    const text = $(element).text().trim();
    if (text) fragments.push(text);
  });
  for (const match of body.matchAll(/`([^`\n]+)`/g)) {
    const value = match[1]?.trim();
    if (value) fragments.push(value);
  }
  return unique(fragments);
}

function identifierCandidates(fragment: string): string[] {
  const clean = fragment.replace(/^["']|["'.,;:]$/g, "").trim();
  const tokens = clean.split(/[\s,;()[\]{}<>"']+/).filter(Boolean);
  return unique([clean, ...tokens]).filter((value) => value.length <= 128 && !value.includes("//"));
}

function parseDocument(input: ParseInput): ProviderModel[] {
  if (input.source.extractor.kind !== "document-identifiers")
    throw new Error("Wrong document extractor");
  const ids = unique(
    documentFragments(input.body, input.source).flatMap((fragment) =>
      (input.source.extractor.kind === "document-identifiers" &&
      input.source.extractor.linkTarget !== undefined
        ? [fragment.trim()]
        : identifierCandidates(fragment)
      ).filter((candidate) =>
        input.source.extractor.kind === "document-identifiers"
          ? input.source.extractor.patterns.some((pattern) => pattern.test(candidate))
          : false,
      ),
    ),
  ).sort();
  if (ids.length === 0) throw new Error("No model identifiers found in document");
  return ids.map((id) => ({
    ...baseModel({
      providerId: input.provider.id,
      id,
      name: id,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    }),
    id_kind:
      input.source.extractor.kind === "document-identifiers"
        ? input.source.extractor.idKind
        : "api_id",
    pricing_status: input.provider.kind === "model_publisher" ? "not_applicable" : "unknown",
  }));
}

function parseOllama(input: ParseInput): ProviderModel[] {
  const list = ollamaListSchema.parse(parseJson(input.body));
  const results = list.models.map((item) => ollamaItemSchema.safeParse(item));
  if (list.models.length === 0 || results.some((result) => !result.success))
    throw new Error("Ollama model schema drift");
  return results.flatMap((result) => {
    if (!result.success) return [];
    const id = result.data.model ?? result.data.name;
    return [
      {
        ...baseModel({
          providerId: input.provider.id,
          id,
          name: result.data.name,
          sourceId: input.source.id,
          observedAt: input.observedAt,
        }),
        pricing_status: "not_applicable",
        status: "active",
      },
    ];
  });
}

function parseVllm(input: ParseInput): ProviderModel[] {
  const list = listSchema.parse(parseJson(input.body));
  const ids = list.data.map((item) => z.object({ id: z.string().min(1) }).parse(item).id);
  if (ids.length === 0) throw new Error("vLLM returned an empty model list");
  return unique(ids).map((id) => ({
    ...baseModel({
      providerId: input.provider.id,
      id,
      name: id,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    }),
    pricing_status: "not_applicable",
    scope: "runtime_observation",
    status: "active",
  }));
}

export function parseSource(input: ParseInput): ProviderModel[] {
  switch (input.source.extractor.kind) {
    case "vercel":
      return parseVercel(input);
    case "cerebras":
      return parseCerebras(input);
    case "huggingface":
      return parseHuggingFace(input);
    case "ollama":
      return parseOllama(input);
    case "vllm":
      return parseVllm(input);
    case "document-identifiers":
      return parseDocument(input);
  }
}
