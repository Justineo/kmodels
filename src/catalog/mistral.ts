import { load } from "cheerio";
import * as ts from "typescript";
import { z } from "zod";
import { linkedBundleSchema } from "./bundle.ts";
import { modelIdSchema } from "./identity.ts";
import type { SourceManifest } from "./manifests.ts";
import { baseModel } from "./model.ts";
import { multiplyDecimal, publishedRate } from "./pricing.ts";
import {
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

type Direction = "input" | "output";

interface SourcePrice {
  direction: Direction;
  price: string;
  denominator: string;
}

interface Draft {
  sourceSlug: string;
  name: string;
  description?: string;
  releaseDate?: string;
  version?: string;
  catalogType: string;
  status: ProviderModel["status"];
  apiNames: string[];
  input: string[];
  output: string[];
  features: string[];
  contextTokens?: number;
  maxOutputTokens?: number;
  prices: SourcePrice[];
  deprecatedAt?: string;
  retiredAt?: string;
  replacement?: string;
}

const apiCapabilitiesSchema = z.object({
  completion_chat: z.boolean().optional(),
  function_calling: z.boolean().optional(),
  reasoning: z.boolean().optional(),
  completion_fim: z.boolean().optional(),
  fine_tuning: z.boolean().optional(),
  vision: z.boolean().optional(),
  ocr: z.boolean().optional(),
  classification: z.boolean().optional(),
  moderation: z.boolean().optional(),
  audio: z.boolean().optional(),
  audio_transcription: z.boolean().optional(),
  audio_transcription_realtime: z.boolean().optional(),
  audio_speech: z.boolean().optional(),
  unified_resources: z.boolean().optional(),
});
const apiDateSchema = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);
const apiBaseSchema = z.object({
  id: modelIdSchema,
  object: z.literal("model").optional(),
  created: z.number().int().nonnegative().optional(),
  owned_by: z.string().min(1).optional(),
  capabilities: apiCapabilitiesSchema,
  name: z.string().min(1).nullable().optional(),
  description: z.string().min(1).nullable().optional(),
  max_context_length: z.number().int().positive().optional(),
  aliases: z.array(modelIdSchema).optional(),
  deprecation: apiDateSchema.nullable().optional(),
  deprecation_replacement_model: modelIdSchema.nullable().optional(),
  type: z.literal("base"),
});
const apiFineTunedSchema = z.object({
  id: modelIdSchema,
  capabilities: apiCapabilitiesSchema,
  type: z.literal("fine-tuned"),
  job: z.string().min(1),
  root: z.string().min(1),
  archived: z.boolean().optional(),
});
const apiItemSchema = z.discriminatedUnion("type", [apiBaseSchema, apiFineTunedSchema]);
const apiListSchema = z.object({
  object: z.literal("list").optional(),
  data: z.array(z.unknown()).min(1),
});

const monthNumbers = new Map(
  [
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
  ].map((month, index) => [month, String(index + 1).padStart(2, "0")]),
);

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  )
    current = current.expression;
  return current;
}

function objectValue(
  expression: ts.Expression | undefined,
  label: string,
): ts.ObjectLiteralExpression {
  if (expression === undefined) throw new Error(`Mistral model omitted ${label}`);
  const value = unwrap(expression);
  if (!ts.isObjectLiteralExpression(value)) throw new Error(`Mistral ${label} was not an object`);
  return value;
}

function propertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : undefined;
}

function property(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const item of object.properties)
    if (ts.isPropertyAssignment(item) && propertyName(item.name) === name) return item.initializer;
  return undefined;
}

function stringValue(expression: ts.Expression | undefined): string | undefined {
  if (expression === undefined) return undefined;
  const value = unwrap(expression);
  if (value.kind === ts.SyntaxKind.NullKeyword) return undefined;
  return ts.isStringLiteralLike(value) ? value.text : undefined;
}

function requiredString(object: ts.ObjectLiteralExpression, name: string): string {
  const value = stringValue(property(object, name));
  if (value === undefined || value.trim() === "") throw new Error(`Mistral model omitted ${name}`);
  return value;
}

function booleanValue(expression: ts.Expression | undefined, label: string): boolean {
  const value = expression === undefined ? undefined : unwrap(expression);
  if (value?.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (value?.kind === ts.SyntaxKind.FalseKeyword) return false;
  throw new Error(`Mistral ${label} was not a boolean`);
}

function numberText(expression: ts.Expression | undefined, label: string): string {
  const value = expression === undefined ? undefined : unwrap(expression);
  if (!value || !ts.isNumericLiteral(value) || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value.text))
    throw new Error(`Mistral ${label} was not a non-negative decimal`);
  return value.text;
}

function stringArray(expression: ts.Expression | undefined, label: string): string[] {
  if (expression === undefined) throw new Error(`Mistral model omitted ${label}`);
  const value = unwrap(expression);
  if (!ts.isArrayLiteralExpression(value)) throw new Error(`Mistral ${label} was not an array`);
  return value.elements.map((item) => {
    const parsed = stringValue(item);
    if (parsed === undefined) throw new Error(`Mistral ${label} contained a non-string`);
    return parsed;
  });
}

function normalizeDate(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const match = value.match(/^([A-Z][a-z]+) (\d{1,2}), (\d{4})$/);
  const month = match?.[1] === undefined ? undefined : monthNumbers.get(match[1]);
  const day = match?.[2] === undefined ? undefined : Number(match[2]);
  if (month === undefined || day === undefined || day < 1 || day > 31 || match?.[3] === undefined)
    throw new Error(`Mistral published an invalid model date: ${value}`);
  return `${match[3]}-${month}-${String(day).padStart(2, "0")}`;
}

function tokens(value: string | undefined): number | undefined {
  if (value === undefined || value === "--") return undefined;
  const match = value.match(/^(\d+(?:\.\d+)?)([kKmM])?$/);
  if (match?.[1] === undefined)
    throw new Error(`Mistral published an invalid token limit: ${value}`);
  const multiplier = match[2]?.toLowerCase() === "m" ? 1_000_000 : match[2] ? 1_000 : 1;
  const result = Number(match[1]) * multiplier;
  if (!Number.isSafeInteger(result) || result <= 0)
    throw new Error(`Mistral published an invalid token limit: ${value}`);
  return result;
}

function returnedObject(
  expression: ts.Expression | undefined,
): ts.ObjectLiteralExpression | undefined {
  if (expression === undefined) return undefined;
  const value = unwrap(expression);
  if (!ts.isArrowFunction(value) && !ts.isFunctionExpression(value)) return undefined;
  const body = value.body;
  if (!ts.isBlock(body)) {
    const result = unwrap(body);
    return ts.isObjectLiteralExpression(result) ? result : undefined;
  }
  for (const statement of body.statements)
    if (ts.isReturnStatement(statement) && statement.expression !== undefined) {
      const result = unwrap(statement.expression);
      if (ts.isObjectLiteralExpression(result)) return result;
    }
  return undefined;
}

function description(object: ts.ObjectLiteralExpression): string | undefined {
  const result = returnedObject(property(object, "describe"));
  const expression = result === undefined ? undefined : property(result, "description");
  const value = expression === undefined ? undefined : unwrap(expression);
  if (value === undefined) return undefined;
  if (ts.isCallExpression(value)) return stringValue(value.arguments[0]);
  return stringValue(value);
}

function sourcePrices(object: ts.ObjectLiteralExpression): SourcePrice[] {
  const pricing = objectValue(property(object, "pricing"), "pricing");
  const type = requiredString(pricing, "type");
  booleanValue(property(pricing, "free"), "pricing.free");
  if (type === "flat")
    return [
      {
        direction: "input",
        price: numberText(property(pricing, "price"), "pricing.price"),
        denominator: requiredString(pricing, "denominator"),
      },
    ];
  if (type === "range")
    return (["input", "output"] as const).map((direction) => ({
      direction,
      price: numberText(property(pricing, direction), `pricing.${direction}`),
      denominator: requiredString(pricing, "denominator"),
    }));
  if (type !== "custom") throw new Error(`Mistral published an unknown pricing type: ${type}`);
  return (["input", "output"] as const).flatMap((direction) => {
    const expression = property(pricing, direction);
    const value = expression === undefined ? undefined : unwrap(expression);
    if (!value || !ts.isArrayLiteralExpression(value))
      throw new Error(`Mistral pricing.${direction} was not an array`);
    return value.elements.map((item) => {
      const rate = objectValue(item, `pricing.${direction} rate`);
      const rateType = requiredString(rate, "type");
      if (rateType !== "flat" && rateType !== "range")
        throw new Error(`Mistral published an unknown price rate type: ${rateType}`);
      return {
        direction,
        price: numberText(property(rate, "price"), "pricing rate price"),
        denominator: requiredString(rate, "denominator"),
      };
    });
  });
}

function parseDraft(sourceSlug: string, body: string): Draft {
  const source = ts.createSourceFile(`${sourceSlug}.ts`, body, ts.ScriptTarget.Latest, false);
  let exported: ts.ObjectLiteralExpression | undefined;
  source.forEachChild((node) => {
    if (ts.isExportAssignment(node)) {
      const value = unwrap(node.expression);
      if (ts.isObjectLiteralExpression(value)) exported = value;
    }
  });
  const object = exported;
  if (object === undefined) throw new Error(`Mistral ${sourceSlug} omitted its static export`);
  const slug = requiredString(object, "slug");
  if (slug !== sourceSlug)
    throw new Error(`Mistral model path and slug disagree for ${sourceSlug}`);
  const catalogType = requiredString(object, "type");
  const rawStatus = requiredString(object, "status");
  const status: ProviderModel["status"] =
    rawStatus === "Retired"
      ? "retired"
      : rawStatus === "Deprecated"
        ? "deprecated"
        : rawStatus === "Active" && catalogType === "Labs"
          ? "preview"
          : rawStatus === "Active"
            ? "active"
            : (() => {
                throw new Error(`Mistral published an unknown lifecycle status: ${rawStatus}`);
              })();
  const identifiers = objectValue(property(object, "identifiers"), "identifiers");
  const capabilities = objectValue(property(object, "capabilities"), "capabilities");
  const metadata = objectValue(property(object, "metadata"), "metadata");
  const apiNames = stringArray(property(identifiers, "apiNames"), "identifiers.apiNames").map(
    (id) => modelIdSchema.parse(id),
  );
  const modelDescription = description(object);
  const releaseDate = normalizeDate(stringValue(property(object, "releaseDate")));
  const version = stringValue(property(object, "version"));
  const contextTokens = tokens(stringValue(property(object, "contextLength")));
  const maxOutputTokens = tokens(stringValue(property(object, "outputTokenLimit")));
  const deprecatedAt = normalizeDate(stringValue(property(metadata, "deprecationDate")));
  const retiredAt = normalizeDate(stringValue(property(metadata, "retirementDate")));
  const replacement = stringValue(property(metadata, "replacement"));
  return {
    sourceSlug,
    name: requiredString(object, "name"),
    ...(modelDescription === undefined ? {} : { description: modelDescription }),
    ...(releaseDate === undefined ? {} : { releaseDate }),
    ...(version === undefined ? {} : { version }),
    catalogType,
    status,
    apiNames: unique(apiNames),
    input: stringArray(property(capabilities, "input"), "capabilities.input"),
    output: stringArray(property(capabilities, "output"), "capabilities.output"),
    features: stringArray(property(capabilities, "features"), "capabilities.features"),
    ...(contextTokens === undefined ? {} : { contextTokens }),
    ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
    prices: sourcePrices(object),
    ...(deprecatedAt === undefined ? {} : { deprecatedAt }),
    ...(retiredAt === undefined ? {} : { retiredAt }),
    ...(replacement === undefined ? {} : { replacement }),
  };
}

function indexSlugs(body: string): Set<string> {
  const source = ts.createSourceFile("index.ts", body, ts.ScriptTarget.Latest, false);
  const imports = new Map<string, string>();
  let modelArray: ts.ArrayLiteralExpression | undefined;
  source.forEachChild((node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const local = node.importClause?.name?.text;
      const target = node.moduleSpecifier.text.match(/^\.\/([a-z0-9-]+)$/)?.[1];
      if (local !== undefined && target !== undefined) imports.set(local, target);
    }
    if (!ts.isVariableStatement(node)) return;
    for (const declaration of node.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== "MODELS") continue;
      const initializer =
        declaration.initializer === undefined ? undefined : unwrap(declaration.initializer);
      if (!initializer || !ts.isCallExpression(initializer)) continue;
      const argument =
        initializer.arguments[0] === undefined ? undefined : unwrap(initializer.arguments[0]);
      if (argument && ts.isArrayLiteralExpression(argument)) modelArray = argument;
    }
  });
  if (modelArray === undefined) throw new Error("Mistral index omitted the MODELS array");
  const slugs = modelArray.elements.map((element) => {
    const value = unwrap(element);
    const slug = ts.isIdentifier(value) ? imports.get(value.text) : undefined;
    if (slug === undefined) throw new Error("Mistral MODELS contained an unreviewed expression");
    return slug;
  });
  if (slugs.length !== imports.size || new Set(slugs).size !== slugs.length)
    throw new Error("Mistral imports and MODELS array disagree");
  return new Set(slugs);
}

function modalities(draft: Draft): ProviderModel["modalities"] {
  const map = (value: string): Modality[] => {
    if (value === "text") return ["text"];
    if (value === "image" || value === "vision") return ["image"];
    if (value === "audio") return ["audio"];
    if (value === "document") return ["pdf"];
    if (value === "embeddings") return ["embedding"];
    if (value === "reasoning" || value === "scores") return [];
    throw new Error(`Mistral published an unknown modality: ${value}`);
  };
  return {
    input: unique(draft.input.flatMap(map)),
    output: unique(draft.output.flatMap(map)),
  };
}

const typeOrder: ModelType[] = [
  "generate",
  "agentic",
  "embeddings",
  "audio_generation",
  "audio_speech",
  "audio_transcription",
  "audio_translation",
  "image",
  "video",
  "realtime",
  "rerank",
  "moderation",
  "classification",
  "ocr",
  "other",
];

function types(draft: Draft, observedModalities: ProviderModel["modalities"]): ModelType[] {
  const result: ModelType[] = [];
  for (const feature of draft.features) {
    if (["chat-completions", "fim", "document-qna"].includes(feature)) result.push("generate");
    if (["agents-conversations", "connectors"].includes(feature)) result.push("agentic");
    if (feature === "embeddings") result.push("embeddings");
    if (feature === "moderations" || feature === "chat-moderations") result.push("moderation");
    if (["ocr", "annotations-structured-ocr", "bbox-extraction"].includes(feature))
      result.push("ocr");
    if (feature === "transcriptions" || feature === "timestamps")
      result.push("audio_transcription");
    if (feature === "tts") result.push("audio_speech");
  }
  result.push(
    ...classifyModelTypes({
      modelId: draft.apiNames[0] ?? draft.sourceSlug,
      name: draft.name,
      rawType: undefined,
      modalities: observedModalities,
      fallback: observedModalities.output.includes("text") ? "generate" : "other",
    }),
  );
  const normalized = unique(result);
  const known = normalized.filter((type) => type !== "other");
  return (known.length === 0 ? normalized : known).sort(
    (left, right) => typeOrder.indexOf(left) - typeOrder.indexOf(right),
  );
}

function directRate(price: SourcePrice, modelTypes: ModelType[], sourceId: string): PriceRate {
  const conditions: PriceRate["conditions"] = {};
  let unit: PriceRate["unit"];
  let meter: PriceRate["meter"];
  if (price.denominator === "/M Tokens") {
    unit = "million_tokens";
    meter =
      price.direction === "output"
        ? "output_text"
        : modelTypes.includes("embeddings")
          ? "embedding"
          : "input_text";
  } else if (price.denominator === "/M Chars") {
    unit = "million_characters";
    meter = price.direction === "output" ? "output_audio" : "input_text";
  } else if (price.denominator === "/Min") {
    unit = "minute";
    meter = price.direction === "output" ? "output_audio" : "input_audio";
  } else if (price.denominator === "/1000 Pages" || price.denominator === "/1000 Annotated Pages") {
    unit = "thousand_pages";
    meter = "input_image";
    conditions.operation =
      price.denominator === "/1000 Annotated Pages" ? "document_annotation" : "ocr";
  } else {
    throw new Error(`Mistral published an unknown pricing denominator: ${price.denominator}`);
  }
  return publishedRate(meter, price.price, unit, sourceId, price.denominator, conditions);
}

function pricing(draft: Draft, modelTypes: ModelType[], sourceId: string): PriceRate[] {
  const direct = draft.prices.map((price) => directRate(price, modelTypes, sourceId));
  const derived: PriceRate[] = [];
  if (draft.status !== "retired" && draft.features.includes("batching"))
    derived.push(
      ...direct.map((rate) => ({
        ...rate,
        price: multiplyDecimal(rate.price, "0.5"),
        conditions: { ...rate.conditions, service_tier: "batch" },
        derived: true,
        derivation: "0.5 × published standard rate for Batch API",
        raw_price: undefined,
        raw_unit: "published 50% Batch API discount",
      })),
    );
  if (
    draft.status !== "retired" &&
    draft.features.some((feature) => feature === "chat-completions" || feature === "fim")
  )
    derived.push(
      ...direct.flatMap((rate): PriceRate[] =>
        rate.meter !== "input_text"
          ? []
          : [
              {
                ...rate,
                meter: "cache_read_text",
                price: multiplyDecimal(rate.price, "0.1"),
                derived: true,
                derivation: "0.1 × published standard input rate for cached prompt tokens",
                raw_price: undefined,
                raw_unit: "published 10% prompt-cache rate",
              },
            ],
      ),
    );
  return [...direct, ...derived];
}

function sourceModel(
  input: Input,
  draft: Draft,
  replacementId: string | undefined,
): ProviderModel | undefined {
  const id = draft.apiNames[0];
  if (id === undefined) return undefined;
  const observedModalities = modalities(draft);
  const modelTypes = types(draft, observedModalities);
  const rates = pricing(draft, modelTypes, input.source.id);
  const active = draft.status === "active" || draft.status === "preview";
  const feature = (name: string): boolean | "unknown" =>
    draft.features.includes(name) ? true : active ? false : "unknown";
  return {
    ...baseModel({
      providerId: input.provider.id,
      id,
      name: draft.name,
      sourceId: input.source.id,
      observedAt: input.observedAt,
      ...(draft.version === undefined ? {} : { version: draft.version }),
    }),
    ...(draft.description === undefined ? {} : { description: draft.description }),
    aliases: draft.apiNames.slice(1),
    types: modelTypes,
    raw_type: draft.catalogType,
    modalities: observedModalities,
    capabilities: {
      ...unknownCapabilities(),
      reasoning: draft.output.includes("reasoning") ? true : active ? false : "unknown",
      tool_call: feature("function-calling"),
      structured_output: feature("structured-outputs"),
      batch: feature("batching"),
      prompt_cache: rates.some((rate) => rate.meter === "cache_read_text") ? true : "unknown",
    },
    limits: {
      ...(draft.contextTokens === undefined ? {} : { context_tokens: draft.contextTokens }),
      ...(draft.maxOutputTokens === undefined ? {} : { max_output_tokens: draft.maxOutputTokens }),
    },
    ...(draft.releaseDate === undefined ? {} : { release_date: draft.releaseDate }),
    ...(draft.deprecatedAt === undefined ? {} : { deprecated_at: draft.deprecatedAt }),
    ...(draft.retiredAt === undefined ? {} : { retired_at: draft.retiredAt }),
    status: draft.status,
    is_deprecated: draft.status === "deprecated" || draft.status === "retired",
    replacement_model_ids: replacementId === undefined ? [] : [replacementId],
    pricing_status: rates.length > 0 ? "published" : "unknown",
    pricing: rates,
  };
}

export function parseMistralCatalog(input: Input): ProviderModel[] {
  if (input.source.extractor.kind !== "mistral-catalog")
    throw new Error("Wrong Mistral catalog extractor");
  const bundle = linkedBundleSchema.parse(JSON.parse(input.body));
  const expected = indexSlugs(bundle.index.body);
  const drafts = bundle.documents.flatMap((document): Draft[] => {
    const match = new URL(document.url).pathname.match(
      /^\/mistralai\/platform-docs-public\/main\/src\/schema\/models\/models\/([a-z0-9-]+)\.ts$/,
    );
    return match?.[1] === undefined ? [] : [parseDraft(match[1], document.body)];
  });
  const observed = new Set(drafts.map((draft) => draft.sourceSlug));
  if (drafts.length !== expected.size || [...expected].some((slug) => !observed.has(slug)))
    throw new Error("Mistral index and model documents disagree");
  const companion = (suffix: string): string => {
    const body = bundle.documents.find(
      (document) => new URL(document.url).pathname === suffix,
    )?.body;
    if (body === undefined) throw new Error(`Mistral bundle omitted ${suffix}`);
    return load(body)("main").text().replace(/\s+/g, " ");
  };
  if (
    !companion("/studio-api/conversations/advanced/prompt-caching").includes(
      "Cached prompt tokens are billed at 10% of the standard input token price",
    )
  )
    throw new Error("Mistral prompt-cache pricing semantics changed");
  if (!/50% discount/i.test(companion("/studio-api/batch-processing")))
    throw new Error("Mistral Batch API pricing semantics changed");

  const currentByName = new Map<string, string | null>();
  for (const draft of drafts) {
    const id = draft.apiNames[0];
    if (id === undefined || (draft.status !== "active" && draft.status !== "preview")) continue;
    const current = currentByName.get(draft.name);
    currentByName.set(draft.name, current === undefined || current === id ? id : null);
  }
  const models = drafts.flatMap((draft): ProviderModel[] => {
    const replacement =
      draft.replacement === undefined ? undefined : currentByName.get(draft.replacement);
    if (replacement === null)
      throw new Error(`Mistral replacement was ambiguous: ${draft.replacement ?? "unknown"}`);
    const model = sourceModel(input, draft, replacement);
    return model === undefined ? [] : [model];
  });
  if (
    models.length < input.source.extractor.minModels ||
    models.length > input.source.extractor.maxModels
  )
    throw new Error("Mistral callable model count outside reviewed bounds");
  return models.sort((left, right) => left.uid.localeCompare(right.uid));
}

function apiTypes(capabilities: z.infer<typeof apiCapabilitiesSchema>): ModelType[] {
  const result: ModelType[] = [];
  if (capabilities.completion_chat || capabilities.completion_fim) result.push("generate");
  if (capabilities.classification) result.push("classification");
  if (capabilities.moderation) result.push("moderation");
  if (capabilities.ocr) result.push("ocr");
  if (capabilities.audio_transcription) result.push("audio_transcription");
  if (capabilities.audio_transcription_realtime) result.push("audio_transcription", "realtime");
  if (capabilities.audio_speech) result.push("audio_speech");
  return result.length === 0 ? ["other"] : unique(result);
}

function apiModalities(
  capabilities: z.infer<typeof apiCapabilitiesSchema>,
): ProviderModel["modalities"] {
  const input: Modality[] = [];
  const output: Modality[] = [];
  if (
    capabilities.completion_chat ||
    capabilities.completion_fim ||
    capabilities.classification ||
    capabilities.moderation ||
    capabilities.audio_speech
  )
    input.push("text");
  if (capabilities.vision) input.push("image");
  if (capabilities.ocr) input.push("image", "pdf");
  if (
    capabilities.audio ||
    capabilities.audio_transcription ||
    capabilities.audio_transcription_realtime
  )
    input.push("audio");
  if (
    capabilities.completion_chat ||
    capabilities.completion_fim ||
    capabilities.ocr ||
    capabilities.audio_transcription ||
    capabilities.audio_transcription_realtime
  )
    output.push("text");
  if (capabilities.audio_speech) output.push("audio");
  return { input: unique(input), output: unique(output) };
}

function flag(value: boolean | undefined): boolean | "unknown" {
  return value ?? "unknown";
}

export function parseMistralApi(input: Input): ProviderModel[] {
  const list = apiListSchema.parse(JSON.parse(input.body));
  const items = list.data.map((item) => apiItemSchema.safeParse(item));
  if (items.some((item) => !item.success)) throw new Error("Mistral model API schema drift");
  const models = items.flatMap((item): ProviderModel[] => {
    if (!item.success || item.data.type !== "base") return [];
    const value = item.data;
    const deprecation = value.deprecation?.slice(0, 10);
    const deprecated =
      deprecation === undefined ? false : deprecation <= input.observedAt.slice(0, 10);
    return [
      {
        ...baseModel({
          providerId: input.provider.id,
          id: value.id,
          name: value.name ?? value.id,
          sourceId: input.source.id,
          observedAt: input.observedAt,
        }),
        ...(value.description == null ? {} : { description: value.description }),
        aliases: unique((value.aliases ?? []).filter((alias) => alias !== value.id)),
        types: apiTypes(value.capabilities),
        raw_type: value.type,
        modalities: apiModalities(value.capabilities),
        capabilities: {
          ...unknownCapabilities(),
          reasoning: flag(value.capabilities.reasoning),
          tool_call: flag(value.capabilities.function_calling),
          fine_tuning: flag(value.capabilities.fine_tuning),
        },
        limits:
          value.max_context_length === undefined
            ? {}
            : { context_tokens: value.max_context_length },
        ...(deprecation === undefined ? {} : { deprecated_at: deprecation }),
        status: value.deprecation === null ? "active" : deprecated ? "deprecated" : "unknown",
        is_deprecated:
          value.deprecation === null ? false : deprecation === undefined ? "unknown" : deprecated,
        replacement_model_ids:
          value.deprecation_replacement_model == null ? [] : [value.deprecation_replacement_model],
      },
    ];
  });
  if (models.length === 0) throw new Error("Mistral model API returned no base models");
  return models.sort((left, right) => left.uid.localeCompare(right.uid));
}
