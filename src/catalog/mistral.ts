import * as ts from "typescript";
import { z } from "zod";
import { linkedBundleSchema, linkedDocumentBody } from "./bundle.ts";
import { modelIdSchema } from "./identity.ts";
import type { SourceManifest } from "./manifests.ts";
import {
  extractMistralCommercialFacts,
  type MistralPricingCard,
  parseMistralPricingCards,
} from "./mistral-commercial-source.ts";
import { apiEndpointKey, baseModel } from "./model.ts";
import { classifyModelTasks, orderedTasks } from "./task.ts";
import { decimalsEqual, multiplyDecimal, publishedRate } from "./pricing.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import {
  type ParsedProviderModel as ProviderModel,
  type SourcePriceFact,
  sourcePriceFactKey,
} from "./pricing-source.ts";
import { assertItemCount, recognizeItems } from "./source-contract.ts";
import { type Modality, type ModelTask, type Provider, unknownCapabilities } from "./schema.ts";
import { yamlBlock } from "./yaml.ts";

interface Input {
  provider: Provider;
  source: SourceManifest;
  body: string;
  observedAt: string;
  onPricingReconciliation?: (item: PricingReconciliationItem) => void;
}

type Direction = "input" | "output";

interface SourcePrice {
  direction: Direction;
  price: string;
  denominator: string;
}

interface SourcePricing {
  free: boolean;
  prices: SourcePrice[];
}

interface Draft {
  sourceSlug: string;
  name: string;
  description?: string;
  releaseDate?: string;
  version?: string;
  catalogType: string;
  status: "active" | "preview" | "deprecated" | "retired";
  apiNames: string[];
  input: string[];
  output: string[];
  features: string[];
  contextTokens?: number;
  maxOutputTokens?: number;
  pricing: SourcePricing;
  deprecatedAt?: string;
  retiredAt?: string;
  replacement?: string;
  weights: Weight[];
  weightsDrifted: boolean;
}

interface Weight {
  url: string;
  license?: string;
  licenseUrl?: string;
}

type Reconcile = Input["onPricingReconciliation"];
type AccountingClaim = "conversation" | "ocr" | "speech" | "tokens" | "transcription";

interface DiscountPolicy {
  batch: boolean;
  cache: boolean;
}

const publicPriceSuffixes = new Map<string, string | null>([
  ["Input (/M tokens)", null],
  ["Output (/M tokens)", null],
  ["OCR", "/ 1000 pages"],
  ["Document AI", "/ 1000 pages"],
  ["Audio generation", "per 1k characters"],
  ["Audio Input/min", null],
  ["Audio Input (per min / per M tok)", ""],
  ["Text Input (per min / per M tok)", ""],
]);

const accountingReferences: readonly {
  path: string;
  markers: readonly RegExp[];
  message: string;
}[] = [
  {
    path: "/mistralai/platform-docs-public/main/src/content/en/docs/admin/admin-api/usage-metrics/page.mdx",
    markers: [
      /Billing usage.*cost and consumption for your Organization over a billing period/is,
      /\/v1\/admin\/usage\?month=5&year=2026/,
      /month.*,.*year.*,.*workspace_id.*optional/is,
      /chat.*completion.*ocr.*audio.*connectors.*libraries_api.*fine_tuning.*vibe_usage/is,
    ],
    message: "Mistral Admin usage guide drifted",
  },
  {
    path: "/mistralai/platform-docs-public/main/src/content/en/api/endpoint/beta/admin/billing/page.mdx",
    markers: [
      /GET<\/b><\/Pill> \/v1\/admin\/usage/,
      /Get usage and cost data for the Organization/,
      /api_zone[\s\S]*global[\s\S]*us[\s\S]*eu/,
      /Prices used to calculate usage amounts/,
      /Billing metric this price applies to/,
      /Unit price for the billing metric/,
    ],
    message: "Mistral Admin billing API reference drifted",
  },
  {
    path: "/mistralai/platform-docs-public/main/src/content/en/docs/admin/billing-usage/billing/page.mdx",
    markers: [
      /credits.*pending pay-as-you-go usage/is,
      /current API usage for the ongoing month/i,
      /Invoices.*invoice ID.*amount.*payment status/is,
    ],
    message: "Mistral account billing guide drifted",
  },
  {
    path: "/mistralai/platform-docs-public/main/src/content/en/docs/admin/billing-usage/subscriptions/page.mdx",
    markers: [
      /included monthly usage.*shared across Studio, the API, and Vibe Code/is,
      /pay-as-you-go is enabled.*billed per token/is,
      /Free mode.*Pro.*Education.*Team.*Enterprise/is,
    ],
    message: "Mistral account plan guide drifted",
  },
  {
    path: "/mistralai/platform-docs-public/main/src/content/en/docs/studio-api/regional-inference/page.mdx",
    markers: [
      /Regional inference is billed at \*\*1\.1× standard list pricing\*\*/,
      /input tokens, output tokens, cached reads, and cache writes/,
      /Regional endpoints only serve models hosted in that region/,
      /Stateful features.*Agents, Batch, Files API.*not available/is,
    ],
    message: "Mistral regional pricing guide drifted",
  },
];

const apiCapabilityNames = [
  "completion_chat",
  "function_calling",
  "reasoning",
  "completion_fim",
  "fine_tuning",
  "vision",
  "ocr",
  "classification",
  "moderation",
  "audio",
  "audio_transcription",
  "audio_transcription_realtime",
  "audio_speech",
  "unified_resources",
] as const;

const apiCapabilitiesSchema = z
  .object({
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
  })
  .strict();
const apiDateSchema = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);
const apiCommonShape = {
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
  default_model_temperature: z.number().finite().nullable().optional(),
};
const apiBaseSchema = z
  .object({
    ...apiCommonShape,
    type: z.literal("base").default("base"),
  })
  .strict();
const apiFineTunedSchema = z
  .object({
    ...apiCommonShape,
    type: z.literal("fine-tuned").default("fine-tuned"),
    job: z.string().min(1),
    root: z.string().min(1),
    archived: z.boolean().optional(),
  })
  .strict();
const apiItemSchema = z.union([apiFineTunedSchema, apiBaseSchema]);
const apiListSchema = z
  .object({
    object: z.literal("list").optional(),
    data: z.array(z.unknown()).min(1),
  })
  .strict();

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

function sourcePricing(object: ts.ObjectLiteralExpression): SourcePricing {
  const pricing = objectValue(property(object, "pricing"), "pricing");
  const type = requiredString(pricing, "type");
  const free = booleanValue(property(pricing, "free"), "pricing.free");
  const result = (prices: SourcePrice[]): SourcePricing => {
    if (free && prices.some(({ price }) => price !== "0"))
      throw new Error("Mistral marked non-zero model pricing as free");
    return { free, prices };
  };
  if (type === "flat")
    return result([
      {
        direction: "input",
        price: numberText(property(pricing, "price"), "pricing.price"),
        denominator: requiredString(pricing, "denominator"),
      },
    ]);
  if (type === "range")
    return result(
      (["input", "output"] as const).map((direction) => ({
        direction,
        price: numberText(property(pricing, direction), `pricing.${direction}`),
        denominator: requiredString(pricing, "denominator"),
      })),
    );
  if (type !== "custom") throw new Error(`Mistral published an unknown pricing type: ${type}`);
  return result(
    (["input", "output"] as const).flatMap((direction) => {
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
    }),
  );
}

function weights(object: ts.ObjectLiteralExpression): { values: Weight[]; drifted: boolean } {
  const expression = property(object, "weights");
  if (expression === undefined) return { values: [], drifted: false };
  const value = unwrap(expression);
  if (!ts.isArrayLiteralExpression(value)) return { values: [], drifted: true };
  let drifted = false;
  const values = value.elements.flatMap((element): Weight[] => {
    const candidate = unwrap(element);
    if (!ts.isObjectLiteralExpression(candidate)) {
      drifted = true;
      return [];
    }
    const item = candidate;
    const url = stringValue(property(item, "url"));
    if (url === undefined || !/^https:\/\/[^\s]+$/.test(url)) {
      drifted = true;
      return [];
    }
    const license = stringValue(property(item, "license"));
    const licenseUrl = stringValue(property(item, "licenseUrl"));
    return [
      {
        url,
        ...(license === undefined ? {} : { license }),
        ...(licenseUrl === undefined ? {} : { licenseUrl }),
      },
    ];
  });
  return { values, drifted };
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
  let status: Draft["status"];
  switch (rawStatus) {
    case "GA":
      status = "active";
      break;
    case "PublicPreview":
      status = "preview";
      break;
    case "Deprecated":
      status = "deprecated";
      break;
    case "Retired":
      status = "retired";
      break;
    default:
      throw new Error(`Mistral published an unknown lifecycle status: ${rawStatus}`);
  }
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
  const pricing = sourcePricing(object);
  const distribution = weights(object);
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
    pricing,
    ...(deprecatedAt === undefined ? {} : { deprecatedAt }),
    ...(retiredAt === undefined ? {} : { retiredAt }),
    ...(replacement === undefined ? {} : { replacement }),
    weights: distribution.values,
    weightsDrifted: distribution.drifted,
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

function exportedObject(body: string, file: string, name: string): ts.ObjectLiteralExpression {
  const source = ts.createSourceFile(file, body, ts.ScriptTarget.Latest, false);
  let result: ts.ObjectLiteralExpression | undefined;
  source.forEachChild((node) => {
    if (!ts.isVariableStatement(node)) return;
    for (const declaration of node.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) continue;
      const value =
        declaration.initializer === undefined ? undefined : unwrap(declaration.initializer);
      if (!value || !ts.isObjectLiteralExpression(value))
        throw new Error(`Mistral ${name} was not a static object`);
      if (result !== undefined) throw new Error(`Mistral declared ${name} more than once`);
      result = value;
    }
  });
  if (result === undefined) throw new Error(`Mistral omitted ${name}`);
  return result;
}

function objectEntries(
  object: ts.ObjectLiteralExpression,
  label: string,
): [string, ts.ObjectLiteralExpression][] {
  const seen = new Set<string>();
  return object.properties.map((item) => {
    if (!ts.isPropertyAssignment(item))
      throw new Error(`Mistral ${label} contained an unreviewed property`);
    const key = propertyName(item.name);
    if (key === undefined) throw new Error(`Mistral ${label} contained an unreviewed property`);
    if (seen.has(key)) throw new Error(`Mistral ${label} duplicated ${key}`);
    seen.add(key);
    return [key, objectValue(item.initializer, `${label}.${key}`)];
  });
}

type ApiEndpoint = NonNullable<ProviderModel["api_endpoints"]>[number];

function featureEndpoints(schemaBody: string, endpointsBody: string): Map<string, ApiEndpoint[]> {
  const endpoints = new Map(
    objectEntries(
      exportedObject(endpointsBody, "endpoints.ts", "AVAILABLE_ENDPOINTS"),
      "AVAILABLE_ENDPOINTS",
    ).map(([key, value]): [string, ApiEndpoint] => {
      const name = requiredString(value, "name");
      const path = requiredString(value, "path");
      if (!/^\/(?!\/)[^?#\s]+$/.test(path))
        throw new Error(`Mistral endpoint ${key} had an invalid relative path`);
      return [key, { name, path }];
    }),
  );
  return new Map(
    objectEntries(
      exportedObject(schemaBody, "schema.ts", "AVAILABLE_FEATURES"),
      "AVAILABLE_FEATURES",
    ).map(([feature, value]) => {
      const keys = stringArray(property(value, "endpoints"), `${feature}.endpoints`);
      if (keys.length === 0 || unique(keys).length !== keys.length)
        throw new Error(`Mistral feature ${feature} had invalid endpoint references`);
      return [
        feature,
        keys.map((key) => {
          const endpoint = endpoints.get(key);
          if (endpoint === undefined)
            throw new Error(`Mistral feature ${feature} referenced unknown endpoint ${key}`);
          return endpoint;
        }),
      ];
    }),
  );
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

const featureOperations = new Map<string, ModelTask[]>([
  ["chat-completions", ["text_generation"]],
  ["function-calling", []],
  ["agents-conversations", ["text_generation"]],
  ["connectors", ["text_generation"]],
  ["structured-outputs", []],
  ["predicted-outputs", []],
  ["prefix", []],
  ["ocr", ["ocr"]],
  ["annotations-structured-ocr", ["ocr"]],
  ["bbox-extraction", ["ocr"]],
  ["document-qna", ["text_generation"]],
  ["fim", ["text_generation"]],
  ["embeddings", ["embeddings"]],
  ["moderations", ["moderation"]],
  ["chat-moderations", ["moderation"]],
  ["transcriptions", ["transcription"]],
  ["tts", ["speech_synthesis"]],
  ["voice-cloning", []],
  ["timestamps", ["transcription"]],
  ["batching", []],
]);

function tasks(draft: Draft, observedModalities: ProviderModel["modalities"]): ModelTask[] {
  const result: ModelTask[] = [];
  const fallback: ModelTask | undefined = observedModalities.output.includes("text")
    ? "text_generation"
    : undefined;
  for (const feature of draft.features) {
    const observed = featureOperations.get(feature);
    if (observed === undefined) throw new Error(`Mistral published an unknown feature: ${feature}`);
    result.push(...observed);
  }
  result.push(
    ...classifyModelTasks({
      modelId: draft.apiNames[0] ?? draft.sourceSlug,
      name: draft.name,
      rawType: undefined,
      modalities: observedModalities,
      ...(fallback === undefined ? {} : { fallback }),
    }),
  );
  return orderedTasks(result);
}

function modelEndpoints(
  draft: Draft,
  endpointsByFeature: Map<string, ApiEndpoint[]>,
): ApiEndpoint[] {
  const endpoints = new Map<string, ApiEndpoint>();
  for (const feature of draft.features) {
    const observed = endpointsByFeature.get(feature);
    if (observed === undefined) throw new Error(`Mistral feature was not declared: ${feature}`);
    for (const endpoint of observed) endpoints.set(apiEndpointKey(endpoint), endpoint);
  }
  return [...endpoints.values()].sort((left, right) =>
    apiEndpointKey(left).localeCompare(apiEndpointKey(right)),
  );
}

function directRate(
  price: SourcePrice,
  modelTasks: ModelTask[],
  sourceId: string,
): SourcePriceFact {
  const conditions: SourcePriceFact["conditions"] = { billing_currency: "USD" };
  let unit: SourcePriceFact["unit"];
  let meter: SourcePriceFact["meter"];
  if (price.denominator === "/M Tokens") {
    unit = "million_tokens";
    meter =
      price.direction === "output"
        ? "output_text"
        : modelTasks.includes("embeddings")
          ? "embedding"
          : "input_text";
  } else if (price.denominator === "/M Chars") {
    unit = "million_characters";
    meter = price.direction === "output" ? "output_audio" : "input_text";
  } else if (price.denominator === "/Min") {
    unit = "minute";
    meter = price.direction === "output" ? "output_audio" : "input_audio";
    if (modelTasks.includes("transcription") && !modelTasks.includes("text_generation"))
      conditions.operation = "transcription";
    else if (modelTasks.includes("text_generation")) conditions.operation = "chat_completions";
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

function derivedPricing(
  direct: readonly SourcePriceFact[],
  batch: boolean,
  cache: boolean,
): SourcePriceFact[] {
  const derived: SourcePriceFact[] = [];
  if (batch)
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
  if (cache)
    derived.push(
      ...direct.flatMap((rate): SourcePriceFact[] =>
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
  return derived;
}

function pricing(
  draft: Draft,
  modelTasks: ModelTask[],
  sourceId: string,
  discounts: DiscountPolicy,
): SourcePriceFact[] {
  if (draft.status === "retired") return [];
  const direct = draft.pricing.prices.map((price) => directRate(price, modelTasks, sourceId));
  return [
    ...direct,
    ...derivedPricing(
      direct,
      discounts.batch && draft.features.includes("batching"),
      discounts.cache &&
        draft.features.some((feature) => feature === "chat-completions" || feature === "fim"),
    ),
  ];
}

function sourceModel(
  input: Input,
  draft: Draft,
  replacementId: string | undefined,
  endpointsByFeature: Map<string, ApiEndpoint[]>,
  discounts: DiscountPolicy,
): ProviderModel | undefined {
  const id = draft.apiNames[0];
  if (id === undefined) return undefined;
  const observedModalities = modalities(draft);
  const modelTasks = tasks(draft, observedModalities);
  const apiEndpoints = modelEndpoints(draft, endpointsByFeature);
  const rates = pricing(draft, modelTasks, input.source.id, discounts);
  const active = draft.status === "active" || draft.status === "preview";
  const feature = (name: string): boolean | "unknown" =>
    draft.features.includes(name) ? true : active ? false : "unknown";
  const model = {
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
    tasks: modelTasks,
    raw_type: draft.catalogType,
    ...(apiEndpoints.length === 0 ? {} : { api_endpoints: apiEndpoints }),
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
    status: draft.status === "preview" ? "active" : draft.status,
    release_stage:
      draft.status === "preview" ? "preview" : draft.status === "active" ? "stable" : "unknown",
    replacement_model_ids: replacementId === undefined ? [] : [replacementId],
    pricing_state:
      draft.status === "retired"
        ? "not_applicable"
        : rates.length > 0
          ? "numeric"
          : draft.pricing.free
            ? "free"
            : "not_published",
    price_facts: rates,
  } satisfies ProviderModel;
  if (draft.weights.length > 0)
    model.commercial_facts = draft.weights.map((weight, index) => ({
      source_ref: input.source.id,
      book_key: `distribution:${model.uid}`,
      book_name: `${model.name} model weights`,
      resource_kind: "distribution" as const,
      resource_key: `weights:${model.uid}`,
      model_refs: [model.uid],
      offer_key: `download:${index + 1}`,
      offer_name: "Published model weights",
      billing_mode: "one_time" as const,
      pricing_state: "not_published" as const,
      price_facts: [],
      raw_price_facts: [
        {
          term_key: "distribution_terms",
          impact: "informational" as const,
          reason: "unknown_amount" as const,
          conditions: {},
          source_ref: input.source.id,
          raw: {
            label: weight.license ?? "Published weights",
            fragment: [weight.url, weight.licenseUrl]
              .filter((value) => value !== undefined)
              .join(" "),
          },
        },
      ],
    }));
  return model;
}

function pageRate(
  model: ProviderModel,
  label: string,
  price: string,
  suffix: string | null,
  currency: "EUR" | "USD",
  sourceId: string,
): SourcePriceFact | undefined {
  if (suffix !== publicPriceSuffixes.get(label)) return undefined;
  let meter: SourcePriceFact["meter"];
  let unit: SourcePriceFact["unit"];
  let normalizedPrice = price;
  const conditions: SourcePriceFact["conditions"] = { billing_currency: currency };
  if (label === "Input (/M tokens)") {
    meter = model.tasks.includes("embeddings") ? "embedding" : "input_text";
    unit = "million_tokens";
  } else if (label === "Output (/M tokens)") {
    meter = "output_text";
    unit = "million_tokens";
  } else if (label === "OCR") {
    meter = "input_image";
    unit = "thousand_pages";
    conditions.operation = "ocr";
  } else if (label === "Document AI") {
    meter = "input_image";
    unit = "thousand_pages";
    conditions.operation = "document_annotation";
  } else if (label === "Audio generation") {
    meter = "output_audio";
    unit = "million_characters";
    normalizedPrice = multiplyDecimal(price, "1000");
  } else if (label === "Audio Input/min") {
    meter = "input_audio";
    unit = "minute";
    conditions.operation = model.tasks.includes("text_generation")
      ? "chat_completions"
      : "transcription";
  } else if (label === "Audio Input (per min / per M tok)") {
    meter = "input_audio";
    unit = "minute";
    conditions.operation = "chat_completions";
  } else if (label === "Text Input (per min / per M tok)") {
    meter = "input_text";
    unit = "million_tokens";
  } else {
    return undefined;
  }
  return {
    ...publishedRate(meter, normalizedPrice, unit, sourceId, label, conditions),
    currency,
    raw_price: price,
  };
}

function pageTargets(models: readonly ProviderModel[], id: string): number[] {
  const exact = models.flatMap((model, index) => (model.model_id === id ? [index] : []));
  const matches =
    exact.length > 0
      ? exact
      : models.flatMap((model, index) => (model.aliases.includes(id) ? [index] : []));
  const active = matches.filter((index) => models[index]?.status === "active");
  return active.length > 0 ? active : matches;
}

function reconcileMany(reconcile: Reconcile, count: number, item: PricingReconciliationItem): void {
  for (let index = 0; index < count; index += 1) reconcile?.(item);
}

function reconcileDrafts(drafts: readonly Draft[], reconcile: Reconcile): void {
  for (const draft of drafts) {
    if (draft.weightsDrifted)
      reconcile?.({
        disposition: "unsupported",
        reason_code: "weight_distribution_drift",
        sample: draft.sourceSlug,
      });
    reconcileMany(reconcile, draft.weights.length, {
      disposition: "normalized",
      reason_code: "normalized_weight_distribution",
    });
    if (draft.apiNames.length === 0) {
      reconcile?.({
        disposition: "excluded",
        reason_code: "definition_without_api_name",
        sample: draft.sourceSlug,
      });
      continue;
    }
    if (draft.status === "retired") {
      reconcileMany(reconcile, draft.pricing.prices.length, {
        disposition: "excluded",
        reason_code: "historical_retired_price",
      });
      reconcile?.({
        disposition: "explicit_non_numeric",
        reason_code: "not_applicable",
      });
      continue;
    }
    reconcileMany(reconcile, draft.pricing.prices.length, {
      disposition: "normalized",
      reason_code: "normalized_repository_price",
    });
    if (draft.pricing.free)
      reconcile?.({ disposition: "explicit_non_numeric", reason_code: "free" });
    else if (draft.pricing.prices.length === 0)
      reconcile?.({
        disposition: "explicit_non_numeric",
        reason_code: "price_not_published",
      });
  }
}

function publicPricing(
  input: Input,
  models: ProviderModel[],
  cards: readonly MistralPricingCard[],
  discounts: DiscountPolicy,
): void {
  for (const { id, rows, free } of cards) {
    if (id === "" || id.startsWith("Classifier API model")) continue;
    const targets = pageTargets(models, id);
    if (rows.length === 0) {
      if (!free) {
        input.onPricingReconciliation?.({
          disposition: "unsupported",
          reason_code: "public_model_price_without_rate",
          sample: id,
        });
        continue;
      }
      const targetIndex = targets.length === 1 ? targets[0] : undefined;
      const target = targetIndex === undefined ? undefined : models[targetIndex];
      if (targetIndex === undefined || target === undefined || target.status === "retired") {
        input.onPricingReconciliation?.({
          disposition: targets.length === 0 ? "unbound" : "ambiguous",
          reason_code:
            targets.length === 0 ? "public_free_model_unbound" : "public_free_model_conflict",
          sample: id,
        });
      } else if (target.price_facts.some(({ price }) => !decimalsEqual(price, "0"))) {
        input.onPricingReconciliation?.({
          disposition: "ambiguous",
          reason_code: "public_free_model_conflict",
          sample: id,
        });
      } else if (target.pricing_state === "free" || target.price_facts.length > 0) {
        input.onPricingReconciliation?.({
          disposition: "excluded",
          reason_code: "duplicate_free_evidence",
        });
      } else {
        models[targetIndex] = { ...target, pricing_state: "free" };
        input.onPricingReconciliation?.({
          disposition: "explicit_non_numeric",
          reason_code: "free",
        });
      }
      continue;
    }

    for (const row of rows) {
      const { label } = row;
      if (row.prefix !== null) {
        input.onPricingReconciliation?.({
          disposition: "unsupported",
          reason_code: "public_price_shape_unsupported",
          sample: `${id}: ${label}`,
        });
        continue;
      }
      const possible = targets.flatMap((index) => {
        const model = models[index];
        if (model === undefined) return [];
        const rate = pageRate(model, label, row.priceUsd, row.suffix, "USD", input.source.id);
        return rate === undefined ? [] : [{ index, model, rate }];
      });
      const withExistingRate = possible.filter(({ model, rate }) =>
        model.price_facts.some(
          (current) => sourcePriceFactKey(current) === sourcePriceFactKey(rate),
        ),
      );
      const candidates = withExistingRate.length > 0 ? withExistingRate : possible;
      const candidate = candidates.length === 1 ? candidates[0] : undefined;
      if (candidate === undefined) {
        input.onPricingReconciliation?.({
          disposition:
            targets.length === 0 ? "unbound" : possible.length === 0 ? "unsupported" : "ambiguous",
          reason_code:
            targets.length === 0
              ? "public_price_model_unbound"
              : possible.length === 0
                ? "public_price_label_unsupported"
                : "public_price_model_ambiguous",
          sample: `${id}: ${label}`,
        });
        continue;
      }
      if (candidate.model.status === "retired") {
        input.onPricingReconciliation?.({
          disposition: "ambiguous",
          reason_code: "public_price_retired_model_conflict",
          sample: `${id}: ${label}`,
        });
        continue;
      }
      const eur = pageRate(
        candidate.model,
        label,
        row.priceEur,
        row.suffix,
        "EUR",
        input.source.id,
      );
      if (eur === undefined) throw new Error("Mistral public price mapping was inconsistent");
      let merged = candidate.model;
      for (const rate of [candidate.rate, eur])
        merged = selectPublicRate(
          merged,
          rate,
          label,
          input.source.id,
          input.onPricingReconciliation,
          discounts,
        );
      models[candidate.index] = merged;
      reconcileMany(input.onPricingReconciliation, 2, {
        disposition: "normalized",
        reason_code: "normalized_public_currency_price",
      });
    }
  }
}

function selectPublicRate(
  model: ProviderModel,
  rate: SourcePriceFact,
  label: string,
  sourceId: string,
  reconcile: Reconcile,
  discounts: DiscountPolicy,
): ProviderModel {
  const current = model.price_facts.find(
    (candidate) => sourcePriceFactKey(candidate) === sourcePriceFactKey(rate),
  );
  if (current !== undefined && decimalsEqual(current.price, rate.price)) return model;
  const superseded = current === undefined ? [] : [current];
  const remaining = model.price_facts.filter(
    (candidate) => !relatedRate(candidate, rate) || candidate.currency !== rate.currency,
  );
  const selected = {
    ...rate,
    ...(superseded.length === 0
      ? {}
      : { resolution_policy: "mistral_public_price_page_over_repository" }),
  };
  const direct = [selected];
  const additions = [
    ...direct,
    ...derivedPricing(
      direct,
      discounts.batch && model.capabilities.batch === true,
      discounts.cache && model.capabilities.prompt_cache === true,
    ),
  ];
  if (superseded.length > 0)
    reconcile?.({
      disposition: "raw",
      reason_code: "first_party_price_conflict_resolved",
      sample: `${model.model_id}: ${label}`,
    });
  return {
    ...model,
    pricing_state: "numeric",
    price_facts: [...remaining, ...additions],
    raw_price_facts: [
      ...model.raw_price_facts,
      ...superseded.map((old) => ({
        term_key: `repository_price_superseded:${old.meter}:${old.currency}`,
        impact: "base_price" as const,
        reason: "superseded_value" as const,
        conditions: old.conditions,
        source_ref: sourceId,
        raw: {
          label: "Repository price superseded by the dedicated Mistral API pricing page",
          amount: old.price,
          denomination: old.currency,
          unit: old.raw_unit ?? old.unit,
        },
      })),
    ],
  };
}

function relatedRate(candidate: SourcePriceFact, selected: SourcePriceFact): boolean {
  if (candidate.conditions.operation !== selected.conditions.operation) return false;
  if (candidate.meter === selected.meter && candidate.unit === selected.unit) return true;
  return selected.meter === "input_text" && candidate.meter === "cache_read_text";
}

function requireYamlBlock(
  body: string,
  label: string,
  indentation: number,
  markers: readonly RegExp[],
  forbiddenMarkers: readonly RegExp[] = [],
): string {
  const block = yamlBlock(body, label, indentation);
  if (
    block === undefined ||
    markers.some((marker) => !marker.test(block)) ||
    forbiddenMarkers.some((marker) => marker.test(block))
  )
    throw new Error(`Mistral OpenAPI reference drifted: ${label}`);
  return block;
}

function usageReferenceMarkers(property = "usage"): RegExp[] {
  return [
    new RegExp(`^ {8}${property}:\\s*$`, "m"),
    /^ {10}\$ref: ["']#\/components\/schemas\/UsageInfo["']\s*$/m,
  ];
}

function validateOpenApi(
  documents: readonly { url: string; body: string }[],
  reconcile: Reconcile,
): Set<AccountingClaim> {
  const matches = documents.filter(({ url }) => {
    const value = new URL(url);
    return (
      value.hostname === "raw.githubusercontent.com" &&
      value.pathname === "/mistralai/platform-docs-public/main/openapi.yaml" &&
      value.search === "" &&
      value.hash === ""
    );
  });
  const document = matches[0];
  if (matches.length === 0) {
    reconcile?.({
      disposition: "unbound",
      reason_code: "commercial_companion_missing",
      sample: "/mistralai/platform-docs-public/main/openapi.yaml",
    });
    return new Set();
  }
  if (
    matches.length !== 1 ||
    document === undefined ||
    !/^openapi:\s+3\.1\.\d+\s*$/m.test(document.body)
  )
    throw new Error("Mistral OpenAPI reference drifted: document");

  requireYamlBlock(document.body, "/v1/models", 2, [
    /^ {4}get:\s*$/m,
    /^ {6}operationId: list_models_v1_models_get\s*$/m,
    /^ {16}\$ref: ["']#\/components\/schemas\/ModelList["']\s*$/m,
  ]);
  requireYamlBlock(document.body, "BaseModelCard", 4, [
    /^ {8}id:\s*$/m,
    /^ {8}capabilities:\s*\n {10}\$ref: ["']#\/components\/schemas\/ModelCapabilities["']\s*$/m,
    /^ {8}aliases:\s*$/m,
    /^ {8}deprecation:\s*$/m,
    /^ {8}deprecation_replacement_model:\s*$/m,
    /^ {8}type:\s*[\s\S]*^ {10}const: base\s*$/m,
    /^ {6}required:\s*$/m,
    /^ {6,8}- id\s*$/m,
    /^ {6,8}- capabilities\s*$/m,
  ]);
  requireYamlBlock(document.body, "FTModelCard", 4, [
    /^ {8}type:\s*[\s\S]*^ {10}const: fine-tuned\s*$/m,
    /^ {8}job:\s*$/m,
    /^ {8}root:\s*$/m,
    /^ {6}required:\s*$/m,
    /^ {6,8}- id\s*$/m,
    /^ {6,8}- capabilities\s*$/m,
    /^ {6,8}- job\s*$/m,
    /^ {6,8}- root\s*$/m,
  ]);
  const capabilityBlock = requireYamlBlock(document.body, "ModelCapabilities", 4, [
    /^ {6}properties:\s*$/m,
    /^ {8}completion_chat:\s*$/m,
    /^ {8}function_calling:\s*$/m,
    /^ {8}completion_fim:\s*$/m,
    /^ {8}fine_tuning:\s*$/m,
    /^ {8}vision:\s*$/m,
    /^ {8}ocr:\s*$/m,
    /^ {8}classification:\s*$/m,
    /^ {8}moderation:\s*$/m,
    /^ {8}audio:\s*$/m,
    /^ {8}audio_transcription:\s*$/m,
  ]);
  const documentedCapabilities = capabilityBlock
    .split(/\r?\n/)
    .flatMap((line) => line.match(/^ {8}([a-z][a-z0-9_]*):\s*$/)?.[1] ?? []);
  if (documentedCapabilities.some((name) => !apiCapabilityNames.some((known) => known === name)))
    throw new Error("Mistral OpenAPI reference drifted: ModelCapabilities");
  requireYamlBlock(document.body, "ModelList", 4, [
    /^ {8}object:\s*$/m,
    /^ {8}data:\s*$/m,
    /^ {12}oneOf:\s*$/m,
    /^ {12,14}- \$ref: ["']#\/components\/schemas\/BaseModelCard["']\s*$/m,
    /^ {12,14}- \$ref: ["']#\/components\/schemas\/FTModelCard["']\s*$/m,
    /^ {12}discriminator:\s*\n {14}propertyName: type\s*$/m,
  ]);

  const valid = new Set<AccountingClaim>();
  claim(
    "tokens",
    reconcile,
    () => {
      requireYamlBlock(document.body, "PromptTokensDetails", 4, [/^ {8}cached_tokens:\s*$/m]);
      const usageInfo = requireYamlBlock(document.body, "UsageInfo", 4, [
        /^ {8}prompt_tokens:\s*$/m,
        /^ {8}completion_tokens:\s*$/m,
        /^ {8}total_tokens:\s*$/m,
        /^ {8}prompt_audio_seconds:\s*$/m,
      ]);
      if (
        !/^ {8}num_cached_tokens:\s*$/m.test(usageInfo) &&
        !/^ {8}prompt_tokens?_details:\s*$/m.test(usageInfo)
      )
        throw new Error("Mistral OpenAPI reference drifted: UsageInfo");
      requireYamlBlock(document.body, "ResponseBase", 4, usageReferenceMarkers());
      requireYamlBlock(document.body, "CompletionChunk", 4, usageReferenceMarkers());
    },
    valid,
  );
  claim(
    "ocr",
    reconcile,
    () => {
      requireYamlBlock(document.body, "OCRUsageInfo", 4, [/^ {8}pages_processed:\s*$/m]);
      requireYamlBlock(document.body, "OCRResponse", 4, [
        /^ {8}usage_info:\s*$/m,
        /^ {10}\$ref: ["']#\/components\/schemas\/OCRUsageInfo["']\s*$/m,
      ]);
    },
    valid,
  );
  claim(
    "transcription",
    reconcile,
    () => {
      requireYamlBlock(document.body, "TranscriptionResponse", 4, usageReferenceMarkers());
      requireYamlBlock(document.body, "TranscriptionStreamDone", 4, usageReferenceMarkers());
    },
    valid,
  );
  claim(
    "speech",
    reconcile,
    () => {
      requireYamlBlock(
        document.body,
        "SpeechResponse",
        4,
        [/^ {8}audio_data:\s*$/m],
        [/^ {8}usage:\s*$/m],
      );
      requireYamlBlock(document.body, "SpeechStreamDone", 4, usageReferenceMarkers());
    },
    valid,
  );
  claim(
    "conversation",
    reconcile,
    () => {
      requireYamlBlock(document.body, "ConversationUsageInfo", 4, [
        /^ {8}prompt_tokens:\s*$/m,
        /^ {8}completion_tokens:\s*$/m,
        /^ {8}total_tokens:\s*$/m,
        /^ {8}connector_tokens:\s*$/m,
        /^ {8}connectors:\s*$/m,
      ]);
      requireYamlBlock(document.body, "ConversationResponse", 4, [
        /^ {8}usage:\s*$/m,
        /^ {10}\$ref: ["']#\/components\/schemas\/ConversationUsageInfo["']\s*$/m,
      ]);
    },
    valid,
  );
  return valid;
}

function claim(
  name: AccountingClaim,
  reconcile: Reconcile,
  validate: () => void,
  valid: Set<AccountingClaim>,
): void {
  try {
    validate();
    valid.add(name);
  } catch (error) {
    reconcile?.({
      disposition: "unbound",
      reason_code: "accounting_contract_drift",
      sample: error instanceof Error ? error.message : name,
    });
  }
}

function validateAccountingReferences(
  documents: readonly { url: string; body: string }[],
  reconcile: Reconcile,
): void {
  for (const reference of accountingReferences) {
    const matches = documents.filter(
      (document) => new URL(document.url).pathname === reference.path,
    );
    const document = matches[0];
    if (
      matches.length !== 1 ||
      document === undefined ||
      reference.markers.some((marker) => !marker.test(document.body))
    )
      reconcile?.({
        disposition: "unbound",
        reason_code: "accounting_contract_drift",
        sample: reference.message,
      });
  }
}

function validatePricingCoverage(
  models: ProviderModel[],
  minimum: number,
  reconcile: Reconcile,
): void {
  if (minimum < 0 || minimum > 1) throw new Error("Invalid Mistral pricing coverage threshold");
  const current = new Map<string, boolean>();
  for (const model of models)
    if (model.status !== "retired")
      current.set(
        model.uid,
        (current.get(model.uid) ?? false) ||
          model.pricing_state === "free" ||
          model.price_facts.length > 0,
      );
  const priced = [...current.values()].filter(Boolean).length;
  if (current.size > 0 && priced / current.size < minimum)
    reconcile?.({
      disposition: "unbound",
      reason_code: "pricing_coverage_below_reviewed_floor",
      sample: `${priced}/${current.size} current models`,
    });
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
  const accounting = validateOpenApi(bundle.documents, input.onPricingReconciliation);
  validateAccountingReferences(bundle.documents, input.onPricingReconciliation);
  const document = (path: string): string =>
    linkedDocumentBody(bundle, path, `Mistral bundle did not contain exactly one ${path}`);
  const optionalDocument = (path: string): string | undefined => {
    const matches = bundle.documents.filter(({ url }) => new URL(url).pathname === path);
    if (matches.length > 1) throw new Error(`Mistral bundle contained repeated ${path}`);
    return matches[0]?.body;
  };
  const endpointsByFeature = featureEndpoints(
    document("/mistralai/platform-docs-public/main/src/schema/models/schema.ts"),
    document("/mistralai/platform-docs-public/main/src/schema/models/endpoints.ts"),
  );
  const companion = (path: string): string => (optionalDocument(path) ?? "").replace(/\s+/g, " ");
  const discounts = {
    cache: companion("/studio-api/conversations/advanced/prompt-caching.md").includes(
      "Cached prompt tokens are billed at 10% of the standard input token price",
    ),
    batch: /50% discount/i.test(companion("/studio-api/batch-processing.md")),
  };
  reconcileMany(input.onPricingReconciliation, Number(discounts.cache) + Number(discounts.batch), {
    disposition: "normalized",
    reason_code: "normalized_discount_policy",
  });
  for (const [key, valid] of Object.entries(discounts))
    if (!valid)
      input.onPricingReconciliation?.({
        disposition: "unbound",
        reason_code: "discount_policy_drift",
        sample: key,
      });
  input.onPricingReconciliation?.({
    disposition: "excluded",
    reason_code: "regional_model_availability_required",
  });
  input.onPricingReconciliation?.({
    disposition: "excluded",
    reason_code: "account_plan_allowance_unscoped",
  });

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
    const model = sourceModel(input, draft, replacement, endpointsByFeature, discounts);
    return model === undefined ? [] : [model];
  });
  reconcileDrafts(drafts, input.onPricingReconciliation);
  const pricingBody = optionalDocument("/pricing/api/");
  const cards =
    pricingBody === undefined
      ? []
      : parseMistralPricingCards(pricingBody, input.onPricingReconciliation);
  if (pricingBody === undefined)
    input.onPricingReconciliation?.({
      disposition: "unbound",
      reason_code: "commercial_companion_missing",
      sample: "/pricing/api/",
    });
  publicPricing(input, models, cards, discounts);
  addAccountingGaps(models, accounting, input.source.id);
  extractMistralCommercialFacts(
    {
      documents: bundle.documents,
      models,
      sourceId: input.source.id,
      ...(input.onPricingReconciliation === undefined
        ? {}
        : { reconcile: input.onPricingReconciliation }),
    },
    cards,
  );
  const modelCount = new Set(models.map((model) => model.uid)).size;
  assertItemCount(
    "Mistral callable models",
    modelCount,
    input.source.extractor.minModels,
    input.source.extractor.maxModels,
  );
  validatePricingCoverage(
    models,
    input.source.extractor.minPricingCoverage,
    input.onPricingReconciliation,
  );
  return models.sort((left, right) => left.uid.localeCompare(right.uid));
}

function addAccountingGaps(
  models: ProviderModel[],
  valid: ReadonlySet<AccountingClaim>,
  sourceId: string,
): void {
  for (const model of models) {
    const claims = new Set(
      model.price_facts.flatMap(({ meter, unit }): AccountingClaim[] => {
        if (unit === "character" || unit === "thousand_characters" || unit === "million_characters")
          return [];
        if (meter === "input_image") return ["ocr"];
        if (meter === "input_audio")
          return [model.tasks.includes("transcription") ? "transcription" : "tokens"];
        if (meter === "output_audio") return ["speech"];
        return ["tokens"];
      }),
    );
    for (const name of claims)
      if (!valid.has(name))
        model.raw_price_facts.push({
          term_key: `accounting_binding_unavailable:${name}`,
          impact: "informational",
          reason: "unknown_applicability",
          conditions: {},
          source_ref: sourceId,
          raw: {
            fragment: `The ${name} accounting response contract drifted; published prices remain usable without an exact automatic charge binding`,
          },
        });
  }
}

function apiOperations(capabilities: z.infer<typeof apiCapabilitiesSchema>): ModelTask[] {
  const result: ModelTask[] = [];
  if (capabilities.completion_chat || capabilities.completion_fim) result.push("text_generation");
  if (capabilities.classification) result.push("classification");
  if (capabilities.moderation) result.push("moderation");
  if (capabilities.ocr) result.push("ocr");
  if (capabilities.audio_transcription) result.push("transcription");
  if (capabilities.audio_transcription_realtime) result.push("transcription");
  if (capabilities.audio_speech) result.push("speech_synthesis");
  return unique(result);
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
  const items = recognizeItems({
    label: "Mistral API model",
    items: list.data,
    schema: apiItemSchema,
    modelId: "id",
  });
  const models = items.flatMap((value): ProviderModel[] => {
    if (value.type !== "base") return [];
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
        tasks: apiOperations(value.capabilities),
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
        status: value.deprecation === undefined ? "unknown" : deprecated ? "deprecated" : "active",
        replacement_model_ids:
          value.deprecation_replacement_model == null ? [] : [value.deprecation_replacement_model],
      },
    ];
  });
  if (models.length === 0) throw new Error("Mistral model API returned no base models");
  return models.sort((left, right) => left.uid.localeCompare(right.uid));
}
