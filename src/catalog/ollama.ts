import { load } from "cheerio";
import { z } from "zod";
import { modelIdSchema } from "./identity.ts";
import { baseModel } from "./model.ts";
import type { SourceManifest } from "./manifests.ts";
import { classifyModelTypes } from "./task.ts";
import {
  type Modality,
  type ModelType,
  type Provider,
  type ProviderModel,
  unknownCapabilities,
} from "./schema.ts";

interface ParseInput {
  provider: Provider;
  source: SourceManifest;
  body: string;
  observedAt: string;
}

const badgeSchema = z.enum(["audio", "cloud", "embedding", "thinking", "tools", "vision"]);
const capabilitySchema = z.enum([
  "audio",
  "completion",
  "embedding",
  "image",
  "insert",
  "thinking",
  "tools",
  "vision",
]);
const detailsSchema = z.object({
  parent_model: z.string(),
  format: z.string(),
  family: z.string(),
  families: z.array(z.string()).nullable(),
  parameter_size: z.string(),
  quantization_level: z.string(),
});
const listItemSchema = z.object({
  name: modelIdSchema,
  model: modelIdSchema,
  modified_at: z.iso.datetime({ offset: true }),
  size: z.number().int().nonnegative(),
  digest: z.string().regex(/^[a-f0-9]{12,64}$/),
  details: detailsSchema,
});
const listSchema = z.object({ models: z.array(listItemSchema) });
const showSchema = z
  .object({
    capabilities: z.array(capabilitySchema).min(1),
    details: detailsSchema,
    model_info: z.record(z.string(), z.unknown()),
    modified_at: z.iso.datetime({ offset: true }),
    retirement_on: z.iso.datetime({ offset: true }).optional(),
  })
  .passthrough();
const errorSchema = z.strictObject({ error: z.string().min(1) });
const bundleSchema = z.object({
  list: z.unknown(),
  catalog: z.object({ url: z.url(), body: z.string().min(1) }),
  documents: z.array(
    z.object({
      model: modelIdSchema,
      status: z.union([z.literal(200), z.literal(404), z.literal(410)]),
      body: z.unknown(),
    }),
  ),
});

const months = new Map(
  ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map(
    (month, index) => [month, String(index + 1).padStart(2, "0")],
  ),
);

interface LibraryItem {
  id: string;
  description: string;
  badges: z.infer<typeof badgeSchema>[];
  updated: string;
}

const cloudFamily = "Ollama Cloud";
const libraryFamily = "Ollama Library";

function exactDate(value: string): string {
  const match = value.match(
    /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}), (\d{4}) \d{1,2}:\d{2} (?:AM|PM) UTC$/,
  );
  const month = match?.[1] === undefined ? undefined : months.get(match[1]);
  if (match?.[2] === undefined || match[3] === undefined || month === undefined)
    throw new Error("Ollama library update date changed shape");
  return `${match[3]}-${month}-${match[2].padStart(2, "0")}`;
}

function libraryItems(body: string): LibraryItem[] {
  const $ = load(body);
  const items = new Map<string, LibraryItem>();
  $('a[href^="/library/"]').each((_index, element) => {
    const anchor = $(element);
    const href = anchor.attr("href");
    const match = href?.match(/^\/library\/([a-z0-9][a-z0-9._-]*)$/i);
    if (match?.[1] === undefined) return;
    const id = modelIdSchema.parse(match[1]);
    const intro = anchor.children("div").first();
    const title = intro.find("h2").first().text().replace(/\s+/g, " ").trim();
    const description = intro.children("p").first().text().replace(/\s+/g, " ").trim();
    const badgeResults = anchor
      .find('span[class*="bg-indigo"], span[class*="bg-cyan"]')
      .map((_badgeIndex, badge) => badgeSchema.safeParse($(badge).text().trim()))
      .get();
    const updated = anchor
      .find("span[title]")
      .filter((_spanIndex, span) => $(span).text().includes("Updated"));
    if (
      title !== id ||
      description === "" ||
      badgeResults.some((result) => !result.success) ||
      updated.length !== 1
    )
      throw new Error("Ollama library card schema drift");
    const updateTitle = updated.attr("title");
    if (updateTitle === undefined) throw new Error("Ollama library card omitted update time");
    const item = {
      id,
      description,
      badges: badgeResults.flatMap((result) => (result.success ? [result.data] : [])),
      updated: exactDate(updateTitle),
    };
    const previous = items.get(id);
    if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(item))
      throw new Error("Ollama library contained conflicting model cards");
    items.set(id, item);
  });
  return [...items.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function facts(
  item: LibraryItem,
): Pick<
  ProviderModel,
  "capabilities" | "description" | "modalities" | "service_families" | "types" | "updated_date"
> {
  const badges = new Set(item.badges);
  const embedding = badges.has("embedding");
  const input: Modality[] = ["text"];
  if (badges.has("vision")) input.push("image");
  if (badges.has("audio")) input.push("audio");
  const modalities: ProviderModel["modalities"] = {
    input,
    output: embedding ? ["embedding"] : ["text"],
  };
  return {
    description: item.description,
    service_families: [libraryFamily],
    types: classifyModelTypes({
      modelId: item.id,
      name: item.id,
      rawType: embedding ? "embedding" : "language",
      modalities,
      fallback: embedding ? "embeddings" : "generate",
    }),
    modalities,
    capabilities: {
      ...unknownCapabilities(),
      reasoning: badges.has("thinking") ? true : "unknown",
      tool_call: badges.has("tools") ? true : "unknown",
    },
    updated_date: item.updated,
  };
}

function libraryModel(input: ParseInput, item: LibraryItem): ProviderModel {
  return {
    ...baseModel({
      providerId: input.provider.id,
      id: item.id,
      name: item.id,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    }),
    ...facts(item),
    pricing_status: "not_applicable",
    status: "active",
  };
}

export function parseOllamaLibrary(input: ParseInput): ProviderModel[] {
  if (input.source.extractor.kind !== "ollama-library")
    throw new Error("Invalid Ollama library extractor");
  const models = libraryItems(input.body);
  const { minModels, maxModels } = input.source.extractor;
  if (models.length < minModels || models.length > maxModels)
    throw new Error("Ollama library model count outside reviewed bounds");
  return models.map((item) => libraryModel(input, item));
}

function number(info: Record<string, unknown>, key: string): number | undefined {
  const value = info[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function cloudModel(
  input: ParseInput,
  id: string,
  raw: unknown,
  listed?: z.infer<typeof listItemSchema>,
  library = false,
): ProviderModel {
  const show = showSchema.parse(raw);
  if (listed !== undefined && listed.name !== listed.model)
    throw new Error("Ollama cloud list identity mismatch");
  if (show.details.parent_model !== id) throw new Error("Ollama cloud model identity mismatch");
  if (listed !== undefined && show.modified_at !== listed.modified_at)
    throw new Error("Ollama cloud model update time mismatch");
  const capabilities = new Set(show.capabilities);
  if (
    !capabilities.has("completion") &&
    !capabilities.has("embedding") &&
    !capabilities.has("image")
  )
    throw new Error("Ollama cloud model omitted an operation capability");
  const modalityInput: Modality[] = ["text"];
  if (capabilities.has("vision")) modalityInput.push("image");
  if (capabilities.has("audio")) modalityInput.push("audio");
  const output: Modality[] = [];
  if (capabilities.has("completion")) output.push("text");
  if (capabilities.has("embedding")) output.push("embedding");
  if (capabilities.has("image")) output.push("image");
  const modalities = { input: modalityInput, output };
  const types: ModelType[] = [];
  if (capabilities.has("completion")) types.push("generate");
  if (capabilities.has("embedding")) types.push("embeddings");
  if (capabilities.has("image")) types.push("image");
  const architecture = show.model_info["general.architecture"];
  const context =
    typeof architecture === "string"
      ? number(show.model_info, `${architecture}.context_length`)
      : undefined;
  const dimension =
    capabilities.has("embedding") && typeof architecture === "string"
      ? number(show.model_info, `${architecture}.embedding_length`)
      : undefined;
  const retirement = show.retirement_on?.slice(0, 10);
  const retired = retirement !== undefined && retirement <= input.observedAt.slice(0, 10);
  return {
    ...baseModel({
      providerId: input.provider.id,
      id,
      name: id,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    }),
    types,
    service_families: library ? [cloudFamily, libraryFamily] : [cloudFamily],
    modalities,
    capabilities: {
      ...unknownCapabilities(),
      reasoning: capabilities.has("thinking") ? true : "unknown",
      tool_call: capabilities.has("tools") ? true : "unknown",
      streaming: capabilities.has("completion") || capabilities.has("image") ? true : "unknown",
    },
    limits: {
      ...(context === undefined ? {} : { context_tokens: context }),
      ...(dimension === undefined ? {} : { embedding_dimensions: [dimension] }),
    },
    updated_date: show.modified_at.slice(0, 10),
    status: library || retirement === undefined ? "active" : retired ? "retired" : "deprecated",
    is_deprecated: library || retirement === undefined ? "unknown" : true,
    retired_at: library ? undefined : retirement,
    pricing_status: "not_published",
  };
}

function retiredModel(input: ParseInput, item: LibraryItem, raw: unknown): ProviderModel {
  const { error } = errorSchema.parse(raw);
  const match = error.match(
    /^(.+?) was retired at (\d{4}-\d{2}-\d{2}) \d{2}:\d{2}:\d{2} [+-]\d{4} [A-Z]+(?: \(ref: [0-9a-f-]{36}\))?$/,
  );
  if (match?.[1] !== item.id || match[2] === undefined)
    throw new Error("Ollama cloud retirement response changed shape");
  return {
    ...libraryModel(input, item),
    service_families: [cloudFamily, libraryFamily],
    pricing_status: "not_published",
  };
}

export function parseOllamaCloud(input: ParseInput): ProviderModel[] {
  if (input.source.extractor.kind !== "ollama-cloud")
    throw new Error("Invalid Ollama cloud extractor");
  const bundle = bundleSchema.parse(JSON.parse(input.body));
  if (bundle.catalog.url !== "https://ollama.com/search?c=cloud")
    throw new Error("Ollama cloud bundle contained an unexpected catalog URL");
  const list = listSchema.parse(bundle.list);
  const { minModels, maxModels } = input.source.extractor;
  if (list.models.length < minModels || list.models.length > maxModels)
    throw new Error("Ollama cloud model count outside reviewed bounds");
  const listed = new Map(list.models.map((item) => [item.model, item]));
  if (listed.size !== list.models.length)
    throw new Error("Ollama cloud list contained duplicate IDs");
  const catalog = new Map(
    libraryItems(bundle.catalog.body)
      .filter((item) => item.badges.includes("cloud"))
      .map((item) => [item.id, item]),
  );
  if (catalog.size < minModels || catalog.size > maxModels)
    throw new Error("Ollama cloud catalog count outside reviewed bounds");
  const documents = new Map(bundle.documents.map((document) => [document.model, document]));
  if (documents.size !== bundle.documents.length)
    throw new Error("Ollama cloud bundle contained duplicate detail responses");
  const expected = new Set([...listed.keys(), ...catalog.keys()]);
  if (documents.size !== expected.size || [...expected].some((id) => !documents.has(id)))
    throw new Error("Ollama cloud bundle omitted model details");

  const models = list.models.map((item) => {
    const document = documents.get(item.model);
    if (document?.status !== 200) throw new Error("Ollama cloud listed model was unavailable");
    return cloudModel(input, item.model, document.body, item, catalog.has(item.model));
  });
  for (const [id, item] of catalog) {
    if (listed.has(id)) continue;
    const document = documents.get(id);
    if (document?.status === 200)
      models.push(cloudModel(input, id, document.body, undefined, true));
    else if (document?.status === 410) models.push(retiredModel(input, item, document.body));
    else if (document?.status !== 404)
      throw new Error("Ollama cloud catalog probe returned an unexpected status");
  }
  return models.sort((left, right) => left.uid.localeCompare(right.uid));
}
