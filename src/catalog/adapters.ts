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
const bedrockBundleSchema = z.object({
  documents: z.array(z.object({ url: z.url(), body: z.string().min(1) })).min(1),
});
const bedrockModelIdSchema = z
  .string()
  .regex(/^[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63}){1,3}(?::[a-z0-9-]{1,63}){0,2}$/);

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

export function classifyModelTask(input: {
  modelId: string;
  name: string;
  rawType: string | undefined;
  modalities: ProviderModel["modalities"];
  fallback: ModelType;
}): ModelType {
  const identity = `${input.modelId} ${input.name}`.toLowerCase();
  if (
    /(?:^|[./:_ -])(?:embed(?:ding|dings)?|text-embedding|multimodal-embedding|gte)(?:$|[./:_ -])/.test(
      identity,
    )
  )
    return "embedding";
  if (/(?:^|[./:_ -])rerank(?:$|[./:_ -])/.test(identity)) return "rerank";
  if (/(?:moderation|safeguard|(?:^|[./:_ -])guard(?:$|[./:_ -]))/.test(identity))
    return "moderation";
  if (/(?:^|[./:_ -])ocr(?:$|[./:_ -])/.test(identity)) return "ocr";
  if (/(?:^|[./:_ -])tts(?:$|[./:_ -])|text-to-speech|cosyvoice/.test(identity))
    return "text_to_speech";
  if (
    /(?:transcrib|whisper|paraformer|(?:^|[./:_ -])stt(?:$|[./:_ -])|chirp|voxtral)/.test(identity)
  )
    return "speech_to_text";
  if (
    /(?:realtime|(?:^|[./:_ -])audio(?:$|[./:_ -])|sonic|(?:^|[./:_ -])voice(?:$|[./:_ -]))/.test(
      identity,
    )
  )
    return "speech_to_speech";
  if (/(?:video|sora|veo|reel|(?:^|[./:_ -])wan\d)/.test(identity)) return "video_generation";
  if (/(?:image|dall-e|imagen|flux|canvas)/.test(identity)) return "image_generation";
  if (/computer-use/.test(identity)) return "computer_use";
  if (/(?:^|[./:_ -])classif(?:ier|ication)?(?:$|[./:_ -])/.test(identity)) return "classifier";

  switch (input.rawType) {
    case "language":
      return "text_generation";
    case "embedding":
      return "embedding";
    case "reranking":
      return "rerank";
    case "image":
    case "image-generation":
      return "image_generation";
    case "video":
      return "video_generation";
    case "transcription":
      return "speech_to_text";
    case "speech":
      return "text_to_speech";
    case "realtime":
      return "speech_to_speech";
  }

  if (input.modalities.output.includes("embedding")) return "embedding";
  if (input.modalities.output.includes("video")) return "video_generation";
  if (input.modalities.output.includes("image")) return "image_generation";
  if (input.modalities.output.includes("audio"))
    return input.modalities.input.includes("audio") ? "speech_to_speech" : "text_to_speech";
  return input.fallback;
}

export function normalizeModelTask(model: ProviderModel): ProviderModel {
  const fallback = model.types.find((type) => type !== "other") ?? "text_generation";
  return {
    ...model,
    types: [
      classifyModelTask({
        modelId: model.model_id,
        name: model.name,
        rawType: model.raw_type,
        modalities: model.modalities,
        fallback,
      }),
    ],
  };
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
    const modelModalities = {
      input: modalities(item.modalities?.input),
      output: modalities(item.modalities?.output),
    };
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
        types: [
          classifyModelTask({
            modelId: item.id,
            name: item.name ?? item.id,
            rawType: item.type,
            modalities: modelModalities,
            fallback: "other",
          }),
        ],
        raw_type: item.type,
        modalities: modelModalities,
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
        types: ["text_generation"],
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
        types: [
          classifyModelTask({
            modelId: item.id,
            name: item.id,
            rawType: undefined,
            modalities: { input: inputModalities, output: outputModalities },
            fallback: "text_generation",
          }),
        ],
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
      if (label !== undefined && target !== undefined && linkTarget.test(target)) {
        fragments.push(label);
        const lastSegment = target.split("/").filter(Boolean).at(-1)?.split(/[?#]/)[0];
        if (lastSegment !== undefined) fragments.push(decodeURIComponent(lastSegment));
      }
    }
    $("a[href]").each((_index, element) => {
      const target = $(element).attr("href");
      if (target === undefined || !linkTarget.test(target)) return;
      const label = $(element).text().trim();
      if (label !== "") fragments.push(label);
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
  const extractor = input.source.extractor;
  if (extractor.kind !== "document-identifiers") throw new Error("Wrong document extractor");
  const ids = unique(
    documentFragments(input.body, input.source).flatMap((fragment) =>
      (extractor.linkTarget !== undefined
        ? [fragment.trim()]
        : identifierCandidates(fragment)
      ).filter((candidate) => extractor.patterns.some((pattern) => pattern.test(candidate))),
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
    id_kind: extractor.idKind,
    types: [
      classifyModelTask({
        modelId: id,
        name: id,
        rawType: undefined,
        modalities: { input: [], output: [] },
        fallback: extractor.defaultType,
      }),
    ],
    pricing_status: input.provider.kind === "model_publisher" ? "not_applicable" : "unknown",
  }));
}

function markdownCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.replaceAll("**", "").replaceAll("`", "").trim());
}

function bedrockModality(cell: string): Modality | undefined {
  if (!cell.includes("icon-yes.png")) return undefined;
  const label = cell.match(/\)\s*(Audio|Embedding|Image|Speech|Text|Video)\s*$/)?.[1];
  switch (label) {
    case "Audio":
    case "Speech":
      return "audio";
    case "Embedding":
      return "embedding";
    case "Image":
      return "image";
    case "Text":
      return "text";
    case "Video":
      return "video";
  }
}

function bedrockModalities(body: string): ProviderModel["modalities"] {
  const lines = body.split("\n");
  const headerIndex = lines.findIndex((line) => {
    const cells = markdownCells(line);
    return cells.includes("Input Modalities") && cells.includes("Output Modalities");
  });
  if (headerIndex < 0) throw new Error("Bedrock model card omitted its modality table");
  const header = markdownCells(lines[headerIndex] ?? "");
  const inputIndex = header.indexOf("Input Modalities");
  const outputIndex = header.indexOf("Output Modalities");
  const inputModalities: Modality[] = [];
  const outputModalities: Modality[] = [];
  for (const line of lines.slice(headerIndex + 2)) {
    if (!line.trim().startsWith("|")) break;
    const cells = markdownCells(line);
    const inputModality = bedrockModality(cells[inputIndex] ?? "");
    const outputModality = bedrockModality(cells[outputIndex] ?? "");
    if (inputModality !== undefined) inputModalities.push(inputModality);
    if (outputModality !== undefined) outputModalities.push(outputModality);
  }
  return { input: unique(inputModalities), output: unique(outputModalities) };
}

function bedrockCard(body: string): {
  name: string;
  ids: string[];
  modalities: ProviderModel["modalities"];
} {
  const name = body.match(/^# ([^\n]+)$/m)?.[1]?.trim();
  if (name === undefined || name === "") throw new Error("Bedrock model card omitted its name");
  const programmaticAccess = body.split("## Programmatic Access")[1]?.split(/\n## /)[0];
  if (programmaticAccess === undefined)
    throw new Error(`Bedrock model card omitted Programmatic Access for ${name}`);
  const lines = programmaticAccess.split("\n");
  const headerIndex = lines.findIndex((line) => {
    const cells = markdownCells(line);
    return cells.includes("Endpoint") && cells.includes("Model ID");
  });
  if (headerIndex < 0) throw new Error(`Bedrock model card omitted its ID table for ${name}`);
  const header = markdownCells(lines[headerIndex] ?? "");
  const endpointIndex = header.indexOf("Endpoint");
  const modelIdIndex = header.indexOf("Model ID");
  const ids = unique(
    lines.slice(headerIndex + 2).flatMap((line) => {
      if (!line.trim().startsWith("|")) return [];
      const cells = markdownCells(line);
      const endpoint = cells[endpointIndex];
      const result = bedrockModelIdSchema.safeParse(cells[modelIdIndex]);
      return endpoint?.startsWith("bedrock-") && result.success ? [result.data] : [];
    }),
  );
  if (ids.length === 0)
    throw new Error(`Bedrock model card omitted official model IDs for ${name}`);
  return { name, ids, modalities: bedrockModalities(body) };
}

function parseBedrock(input: ParseInput): ProviderModel[] {
  const bundle = bedrockBundleSchema.parse(parseJson(input.body));
  const identities = new Map<string, { name: string; modalities: ProviderModel["modalities"] }>();
  for (const document of bundle.documents) {
    const card = bedrockCard(document.body);
    for (const id of card.ids) {
      const existing = identities.get(id);
      if (existing !== undefined && existing.name !== card.name)
        throw new Error(`Bedrock model ID ${id} has conflicting display names`);
      identities.set(id, { name: card.name, modalities: card.modalities });
    }
  }
  return [...identities]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, model]) => ({
      ...baseModel({
        providerId: input.provider.id,
        id,
        name: model.name,
        sourceId: input.source.id,
        observedAt: input.observedAt,
      }),
      id_kind: "api_id",
      types: [
        classifyModelTask({
          modelId: id,
          name: model.name,
          rawType: undefined,
          modalities: model.modalities,
          fallback: "text_generation",
        }),
      ],
      modalities: model.modalities,
      scope: "regional_catalog",
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
    const modelModalities = { input: [], output: [] };
    return [
      {
        ...baseModel({
          providerId: input.provider.id,
          id,
          name: result.data.name,
          sourceId: input.source.id,
          observedAt: input.observedAt,
        }),
        types: [
          classifyModelTask({
            modelId: id,
            name: result.data.name,
            rawType: undefined,
            modalities: modelModalities,
            fallback: "text_generation",
          }),
        ],
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
    types: [
      classifyModelTask({
        modelId: id,
        name: id,
        rawType: undefined,
        modalities: { input: [], output: [] },
        fallback: "text_generation",
      }),
    ],
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
    case "bedrock-model-cards":
      return parseBedrock(input);
    case "document-identifiers":
      return parseDocument(input);
  }
}
