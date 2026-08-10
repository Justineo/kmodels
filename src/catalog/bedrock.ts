import { BedrockClient, ListFoundationModelsCommand } from "@aws-sdk/client-bedrock";
import { load } from "cheerio";
import { z } from "zod";
import { linkedBundleSchema } from "./bundle.ts";
import { modelIdSchema } from "./identity.ts";
import { stableJson } from "./io.ts";
import { apiEndpointKey, baseModel } from "./model.ts";
import type { SourceManifest } from "./manifests.ts";
import { decimalsEqual, scaleDecimal } from "./pricing.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import type {
  ParsedProviderModel as ProviderModel,
  SourceCommercialPricingFact,
  SourcePriceFact,
  SourceRawPricingFact,
} from "./pricing-source.ts";
import {
  zodContractEvidence,
  type SourceContractEvidence,
  type ZodContractObservation,
} from "./source-contract.ts";
import {
  modalitySchema,
  type Modality,
  type ModelTask,
  type Provider,
  unknownCapabilities,
} from "./schema.ts";
import { classifyModelTasks } from "./task.ts";

interface ParseInput {
  provider: Provider;
  source: SourceManifest;
  body: string;
  observedAt: string;
  onContractFinding?: (evidence: SourceContractEvidence) => void;
  onPricingReconciliation?: (item: PricingReconciliationItem) => void;
}

interface CardId {
  aliases: Set<string>;
  endpoints: Set<BedrockModelEndpoint>;
  deploymentTypes: Set<DeploymentType>;
}

interface Card {
  name: string;
  publisher: string;
  description: string | undefined;
  ids: Map<string, CardId>;
  modalities: ProviderModel["modalities"];
  apiEndpoints: BedrockApiEndpoint[];
  availability: BedrockAvailability[];
  capabilities: ProviderModel["capabilities"];
  limits: ProviderModel["limits"];
  releaseDate: string | undefined;
  deprecatedAt: string | undefined;
  retiredAt: string | undefined;
  status: ProviderModel["status"];
  releaseStage: ProviderModel["release_stage"];
  tasks: ModelTask[];
  identityKeys: Set<string>;
}

type BedrockModelEndpoint = "bedrock-runtime" | "bedrock-mantle";
type DeploymentType = "in-region" | "geo" | "global";

interface BedrockApiEndpoint {
  name: string;
  path: string;
  programmaticEndpoint: BedrockModelEndpoint;
}

interface BedrockAvailability {
  region: string;
  deploymentType: DeploymentType;
}

const rerankApi: BedrockApiEndpoint = {
  name: "Rerank",
  path: "rerank",
  programmaticEndpoint: "bedrock-runtime",
};
const bedrockApiDefinitions = new Map<string, Omit<BedrockApiEndpoint, "name">[]>([
  ["Invoke", [{ path: "model/{modelId}/invoke", programmaticEndpoint: "bedrock-runtime" }]],
  ["Converse", [{ path: "model/{modelId}/converse", programmaticEndpoint: "bedrock-runtime" }]],
  ["Responses", [{ path: "v1/responses", programmaticEndpoint: "bedrock-mantle" }]],
  [
    "Chat Completions",
    [
      { path: "v1/chat/completions", programmaticEndpoint: "bedrock-runtime" },
      { path: "v1/chat/completions", programmaticEndpoint: "bedrock-mantle" },
    ],
  ],
  [
    "Messages",
    [
      { path: "model/{modelId}/invoke", programmaticEndpoint: "bedrock-runtime" },
      { path: "anthropic/v1/messages", programmaticEndpoint: "bedrock-mantle" },
    ],
  ],
  ["StartAsyncInvoke", [{ path: "async-invoke", programmaticEndpoint: "bedrock-runtime" }]],
  [
    "InvokeModelWithBidirectionalStream",
    [
      {
        path: "model/{modelId}/invoke-with-bidirectional-stream",
        programmaticEndpoint: "bedrock-runtime",
      },
    ],
  ],
]);
const inferenceIdColumns = new Map<DeploymentType, string>([
  ["geo", "Geo inference ID"],
  ["global", "Global inference ID"],
]);
const availabilityColumns = new Map<DeploymentType, string>([
  ["in-region", "In-Region"],
  ["geo", "Geo"],
  ["global", "Global"],
]);

const decimalSchema = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);

const priceProductSchema = z.object({
  sku: z.string().min(1),
  productFamily: z.string().optional(),
  attributes: z.record(z.string(), z.string()),
});

const priceDimensionSchema = z.object({
  rateCode: z.string().min(1).optional(),
  description: z.string().min(1),
  unit: z.string().min(1),
  pricePerUnit: z.record(z.string(), decimalSchema),
});

const priceTermSchema = z.object({
  effectiveDate: z.string().optional(),
  priceDimensions: z.record(z.string(), z.unknown()),
});

const priceListSchema = z.object({
  offerCode: z.enum([
    "AmazonBedrock",
    "AmazonBedrockFoundationModels",
    "AmazonBedrockService",
    "AmazonBedrockAgentCore",
  ]),
  products: z.record(z.string(), z.unknown()),
  terms: z.object({
    OnDemand: z.record(z.string(), z.record(z.string(), z.unknown())),
  }),
});

type BedrockOfferCode = z.infer<typeof priceListSchema>["offerCode"];

const marketplaceRateCardSchema = z.object({
  dimensionKey: z.string().regex(/^[A-Z0-9]+_InputTokenCount(?:_Global)?$/),
  displayName: z.enum([
    "Price per 1 million input tokens",
    "Price per 1 million input tokens Global",
  ]),
  description: z.enum([
    "Price per 1 million input tokens",
    "Price per 1 million input tokens Global",
  ]),
  dimensionLabels: z
    .array(
      z.object({
        type: z.literal("REGION"),
        value: z.string().regex(/^[a-z]{2}(?:-[a-z]+)+-\d$/),
        displayName: z.string().min(1),
      }),
    )
    .length(1),
  unit: z.literal("Units"),
  price: decimalSchema,
});

const marketplacePricingTermSchema = z.object({
  termType: z.literal("UsageBasedPricingTerm"),
  currencyCode: z.literal("USD"),
  rateCards: z.array(marketplaceRateCardSchema).length(46),
  rateCardCount: z.literal(46),
  totalRateCards: z.literal(46),
});

const marketplaceQuerySchema = z.object({
  state: z.object({
    data: z.object({
      summary: z.object({
        vendor: z.object({ vendorName: z.literal("Cohere") }),
        pricingModel: z.literal("USAGE"),
        terms: z.array(z.unknown()).min(1),
      }),
    }),
  }),
});

const marketplacePageContextSchema = z.object({
  routeParams: z.object({ listingId: z.literal("prodview-j3fgisven2yrs") }),
  dehydratedState: z.object({ queries: z.array(z.unknown()) }),
});

const apiDateSchema = z.iso.datetime({ offset: true });
const apiModalitySchema = z.enum(["TEXT", "IMAGE", "EMBEDDING", "AUDIO", "SPEECH", "VIDEO"]);
const customizationSchema = z.enum([
  "FINE_TUNING",
  "PREFERENCE_FINE_TUNING",
  "CONTINUED_PRE_TRAINING",
  "DISTILLATION",
]);
const inferenceTypeSchema = z.enum(["ON_DEMAND", "PROVISIONED", "INFERENCE_PROFILE"]);
const foundationModelArnSchema = z
  .string()
  .regex(/^arn:aws(?:-[^:]+)?:bedrock:[a-z0-9-]{1,20}::foundation-model\/[a-z0-9./:-]+$/);

const lifecycleSchema = z
  .object({
    status: z.string().min(1),
    startOfLifeTime: apiDateSchema.optional(),
    legacyTime: apiDateSchema.optional(),
    publicExtendedAccessTime: apiDateSchema.optional(),
    endOfLifeTime: apiDateSchema.optional(),
  })
  .optional();

const apiItemSchema = z
  .object({
    modelArn: foundationModelArnSchema,
    modelId: modelIdSchema,
    modelName: z.string().min(1).optional(),
    providerName: z.string().min(1).optional(),
    inputModalities: z.array(z.string().min(1)).optional(),
    outputModalities: z.array(z.string().min(1)).optional(),
    customizationsSupported: z.array(z.string().min(1)).optional(),
    inferenceTypesSupported: z.array(z.string().min(1)).optional(),
    responseStreamingSupported: z.boolean().optional(),
    modelLifecycle: lifecycleSchema,
  })
  .superRefine((item, context) => {
    const arnId = item.modelArn.match(/::foundation-model\/(.+)$/)?.[1];
    if (arnId !== item.modelId)
      context.addIssue({
        code: "custom",
        path: ["modelArn"],
        message: "Bedrock foundation-model ARN did not match modelId",
      });
  });

const apiSchema = z.object({ modelSummaries: z.array(apiItemSchema).min(1) });
const reviewedApiEnumsSchema = z.object({
  inputModalities: z.array(apiModalitySchema).optional(),
  outputModalities: z.array(apiModalitySchema).optional(),
  customizationsSupported: z.array(customizationSchema).optional(),
  inferenceTypesSupported: z.array(inferenceTypeSchema).optional(),
  modelLifecycle: z.object({ status: z.enum(["ACTIVE", "LEGACY"]) }).optional(),
});

const bedrockContractPaths = [
  "/bedrock/latest/userguide/models-supported.md",
  "/bedrock/latest/APIReference/API_ListFoundationModels.md",
  "/bedrock/latest/APIReference/API_FoundationModelSummary.md",
  "/bedrock/latest/APIReference/API_FoundationModelLifecycle.md",
  "/bedrock/latest/APIReference/API_runtime_Converse.md",
  "/bedrock/latest/APIReference/API_runtime_CountTokens.md",
  "/bedrock/latest/userguide/service-tiers-inference.md",
  "/bedrock/latest/userguide/conversation-inference.md",
  "/bedrock/latest/userguide/prompt-caching.md",
  "/bedrock/latest/userguide/count-tokens.md",
  "/bedrock/latest/userguide/model-invocation-logging.md",
  "/bedrock/latest/userguide/cost-management.md",
  "/bedrock/latest/userguide/cost-mgmt-understanding-cur-data.md",
  "/awsaccountbilling/latest/aboutv2/price-changes.md",
  "/awsaccountbilling/latest/aboutv2/bulk-api-reading-price-list-files.md",
  "/awsaccountbilling/latest/aboutv2/view-billing-dashboard.md",
] as const;

type BedrockDocuments = z.infer<typeof linkedBundleSchema>["documents"];

function exactDocument(documents: BedrockDocuments, path: string): string | undefined {
  const matches = documents.filter((document) => {
    const url = new URL(document.url);
    return url.hostname === "docs.aws.amazon.com" && url.pathname === path;
  });
  if (matches.length > 1) throw new Error(`Bedrock catalog duplicated official document: ${path}`);
  return matches[0]?.body;
}

function requireDocumentFacts(name: string, body: string, facts: readonly RegExp[]): void {
  for (const fact of facts)
    if (!fact.test(body)) throw new Error(`Bedrock ${name} contract drifted: ${fact.source}`);
}

function documentedValues(body: string, field: string): string[] {
  const match = body.match(
    new RegExp(
      `\\*\\*\\s*${field}\\s*\\*\\*[\\s\\S]{0,1200}?Valid Values:\\s*\u0060([^\u0060]+)\u0060`,
    ),
  );
  if (match?.[1] === undefined)
    throw new Error(`Bedrock FoundationModelSummary omitted ${field} valid values`);
  return match[1].split("|").map((value) => value.trim());
}

function requireDocumentedValues(body: string, field: string, expected: string[]): void {
  const values = documentedValues(body, field);
  if (expected.some((value) => !values.includes(value)))
    throw new Error(`Bedrock FoundationModelSummary ${field} enum contract drifted`);
}

function validateBedrockContracts(documents: BedrockDocuments): void {
  const found = new Map(
    bedrockContractPaths.flatMap((path) => {
      const body = exactDocument(documents, path);
      return body === undefined ? [] : [[path, body] as const];
    }),
  );
  if (found.size === 0) return;
  if (found.size !== bedrockContractPaths.length) {
    const missing = bedrockContractPaths.filter((path) => !found.has(path));
    throw new Error(`Bedrock catalog omitted official contract documents: ${missing.join(", ")}`);
  }
  const body = (path: (typeof bedrockContractPaths)[number]): string => {
    const value = found.get(path);
    if (value === undefined) throw new Error(`Bedrock catalog omitted official document: ${path}`);
    return value;
  };

  for (const [name, path, facts] of [
    [
      "canonical model catalog",
      "/bedrock/latest/userguide/models-supported.md",
      [/has moved to \[models at a glance\]\(model-cards\.md\)/],
    ],
    [
      "ListFoundationModels",
      "/bedrock/latest/APIReference/API_ListFoundationModels.md",
      [/GET \/foundation-models\?/, /"modelSummaries"/, /"modelArn"/, /"modelId"/],
    ],
  ] as const)
    requireDocumentFacts(name, body(path), facts);
  const summary = body("/bedrock/latest/APIReference/API_FoundationModelSummary.md");
  requireDocumentedValues(summary, "customizationsSupported", [
    "FINE_TUNING",
    "CONTINUED_PRE_TRAINING",
    "DISTILLATION",
  ]);
  requireDocumentedValues(summary, "inferenceTypesSupported", ["ON_DEMAND", "PROVISIONED"]);
  for (const field of ["inputModalities", "outputModalities"])
    requireDocumentedValues(summary, field, ["TEXT", "IMAGE", "EMBEDDING"]);
  const lifecycle = body("/bedrock/latest/APIReference/API_FoundationModelLifecycle.md");
  requireDocumentedValues(lifecycle, "status", ["ACTIVE", "LEGACY"]);
  for (const [name, path, facts] of [
    [
      "foundation-model lifecycle",
      "/bedrock/latest/APIReference/API_FoundationModelLifecycle.md",
      [
        /\*\* endOfLifeTime \*\*/,
        /\*\* legacyTime \*\*/,
        /\*\* publicExtendedAccessTime \*\*/,
        /\*\* startOfLifeTime \*\*/,
        /higher pricing/,
      ],
    ],
    [
      "Converse response",
      "/bedrock/latest/APIReference/API_runtime_Converse.md",
      [
        /"performanceConfig"/,
        /"serviceTier"/,
        /"cacheDetails"/,
        /"cacheReadInputTokens"/,
        /"cacheWriteInputTokens"/,
        /"inputTokens"/,
        /"outputTokens"/,
        /"totalTokens"/,
      ],
    ],
    [
      "CountTokens operation",
      "/bedrock/latest/APIReference/API_runtime_CountTokens.md",
      [/POST \/model\/\{\{modelId\}\}\/count-tokens/, /"inputTokens": number/],
    ],
    [
      "service tier",
      "/bedrock/latest/userguide/service-tiers-inference.md",
      [
        /four service tiers[^\n]*Reserved, Priority, Standard, and Flex/,
        /automatically overflows to the Standard tier/,
        /service\\?_tier/,
        /"reserved \| priority \| default \| flex"/,
        /ResolvedServiceTier shows the actual tier that served your requests/,
      ],
    ],
    [
      "conversation usage",
      "/bedrock/latest/userguide/conversation-inference.md",
      [
        /`serviceTier`/,
        /`cacheReadInputTokens`/,
        /`cacheWriteInputTokens`/,
        /"inputTokens"/,
        /"outputTokens"/,
      ],
    ],
    [
      "prompt-cache accounting",
      "/bedrock/latest/userguide/prompt-caching.md",
      [
        /`cacheDetails`/,
        /`inputTokens` field represents only the non-cached input tokens/,
        /inputTokens \+ cacheReadInputTokens \+ cacheWriteInputTokens/,
      ],
    ],
    [
      "token-counting guide",
      "/bedrock/latest/userguide/count-tokens.md",
      [
        /doesn't incur charges/,
        /Token counting is model-specific/,
        /will match the token count that would be charged/,
        /\/anthropic\/v1\/messages\/count_tokens/,
      ],
    ],
    [
      "invocation logging",
      "/bedrock/latest/userguide/model-invocation-logging.md",
      [
        /disabled by default/,
        /only supported for calls made through the `bedrock-runtime` endpoint/,
        /`bedrock-mantle` endpoint, are not currently captured/,
        /\| requestId \|/,
        /\| region \|/,
        /\| operation \|/,
        /\| modelId \|/,
        /\| identity\.arn \|/,
        /\| input\.inputTokenCount \|/,
        /\| output\.outputTokenCount \|/,
      ],
    ],
    [
      "cost-management grain",
      "/bedrock/latest/userguide/cost-management.md",
      [
        /finest grain is per usage type per day/,
        /they do not produce a per-request row/,
        /Invocation logs only/,
      ],
    ],
    [
      "CUR accounting",
      "/bedrock/latest/userguide/cost-mgmt-understanding-cur-data.md",
      [
        /Input tokens/,
        /Output tokens/,
        /Cache read tokens/,
        /Cache write tokens/,
        /aggregate Amazon Bedrock cost[^\n]*over an hour or a day/,
        /neither carries a per-`requestId` identifier/,
      ],
    ],
    [
      "Price List precedence",
      "/awsaccountbilling/latest/aboutv2/price-changes.md",
      [
        /Price List Query API and Price List Bulk API provide pricing details for informational purposes only/,
        /AWS charges the prices on the \*service pricing page\*/,
      ],
    ],
    [
      "Price List current-version",
      "/awsaccountbilling/latest/aboutv2/bulk-api-reading-price-list-files.md",
      [/"currentVersionUrl"/, /most up-to-date service price list file/],
    ],
    [
      "billing latency",
      "/awsaccountbilling/latest/aboutv2/view-billing-dashboard.md",
      [/take up to 24 hours/, /refreshed at least once every 24 hours/],
    ],
  ] as const)
    requireDocumentFacts(name, body(path), facts);
}

const months = new Map([
  ["jan", 1],
  ["january", 1],
  ["feb", 2],
  ["february", 2],
  ["mar", 3],
  ["march", 3],
  ["apr", 4],
  ["april", 4],
  ["may", 5],
  ["jun", 6],
  ["june", 6],
  ["jul", 7],
  ["july", 7],
  ["aug", 8],
  ["august", 8],
  ["sep", 9],
  ["sept", 9],
  ["september", 9],
  ["oct", 10],
  ["october", 10],
  ["nov", 11],
  ["november", 11],
  ["dec", 12],
  ["december", 12],
]);

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function section(body: string, heading: string): string | undefined {
  const start = body.indexOf(`## ${heading}`);
  if (start < 0) return undefined;
  const content = body.slice(start + heading.length + 3);
  const end = content.search(/\n## /);
  return end < 0 ? content : content.slice(0, end);
}

function plain(value: string): string {
  return value
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replaceAll("\\+", "+")
    .replace(/[*`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function fact(body: string, label: string): string | undefined {
  return body.match(new RegExp(`^\\+ \\*\\*${label}:\\*\\* ([^\\n]+)$`, "m"))?.[1]?.trim();
}

function humanDate(value: string): string | undefined {
  const normalized = plain(value);
  const named = normalized.match(/^([A-Za-z]+)\s+(?:(\d{1,2}),?\s+)?(\d{4})$/);
  if (named !== null) {
    const month = months.get(named[1]?.toLowerCase() ?? "");
    const year = named[3];
    if (month === undefined || year === undefined) return undefined;
    const prefix = `${year}-${String(month).padStart(2, "0")}`;
    if (named[2] === undefined) return prefix;
    const result = `${prefix}-${named[2].padStart(2, "0")}`;
    return z.iso.date().safeParse(result).success ? result : undefined;
  }
  const numeric = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (numeric?.[1] === undefined || numeric[2] === undefined || numeric[3] === undefined)
    return undefined;
  const result = `${numeric[3]}-${numeric[1].padStart(2, "0")}-${numeric[2].padStart(2, "0")}`;
  return z.iso.date().safeParse(result).success ? result : undefined;
}

function exactHumanDate(value: string, field: string): string {
  const parsed = humanDate(value);
  if (parsed === undefined) throw new Error(`Bedrock ${field} was not a valid date: ${value}`);
  return parsed;
}

function apiDate(value: string | undefined): string | undefined {
  return value?.slice(0, 10);
}

function tokens(value: string | undefined): number | undefined {
  const match = value?.replaceAll(",", "").match(/^(\d+(?:\.\d+)?)\s*([KMB])?(?:\s*tokens?)?$/i);
  if (match?.[1] === undefined) return undefined;
  const suffix = match[2]?.toUpperCase();
  const multiplier =
    suffix === "K" ? 1_000 : suffix === "M" ? 1_000_000 : suffix === "B" ? 1_000_000_000 : 1;
  return Number(match[1]) * multiplier;
}

function markdownCells(line: string): string[] {
  const escapedPipe = "\u0000";
  const value = line.trim();
  if (!value.startsWith("|")) return [];
  return value
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .replaceAll("\\|", escapedPipe)
    .split("|")
    .map((cell) =>
      cell.replaceAll(escapedPipe, "|").replaceAll("**", "").replaceAll("`", "").trim(),
    );
}

function markdownTable(
  body: string,
  requiredHeaders: string[],
): { header: string[]; rows: string[][] } | undefined {
  const lines = body.split(/\r?\n/);
  const matches: { header: string[]; rows: string[][] }[] = [];
  for (let index = 0; index + 1 < lines.length; index += 1) {
    const header = markdownCells(lines[index] ?? "");
    if (!requiredHeaders.every((required) => header.includes(required))) continue;
    const separator = markdownCells(lines[index + 1] ?? "");
    if (separator.length < header.length || !separator.every((cell) => /^:?-{3,}:?$/.test(cell)))
      continue;
    const rows: string[][] = [];
    let cursor = index + 2;
    while (lines[cursor]?.trim().startsWith("|")) {
      const cells = markdownCells(lines[cursor] ?? "");
      if (cells.length !== header.length)
        throw new Error("Bedrock Markdown table contained an irregular row");
      rows.push(cells);
      cursor += 1;
    }
    matches.push({ header, rows });
    index = cursor - 1;
  }
  if (matches.length > 1)
    throw new Error(`Bedrock document duplicated Markdown table: ${requiredHeaders.join(", ")}`);
  return matches[0];
}

function tableLabel(cell: string): string | undefined {
  const value = cell.match(/\)\s*([^)]*?)\s*$/)?.[1]?.trim();
  return value === "" ? undefined : value;
}

function supported(cell: string): boolean {
  return cell.includes("icon-yes.png");
}

function supportedModality(cell: string): Modality | undefined {
  const label = tableLabel(cell);
  if (label === undefined) return undefined;
  const value = label === "Speech" ? "audio" : label.toLowerCase();
  const parsed = modalitySchema.safeParse(value);
  if (!parsed.success) throw new Error(`Unsupported Bedrock modality label: ${label}`);
  return supported(cell) ? parsed.data : undefined;
}

function cardTable(body: string): {
  modalities: ProviderModel["modalities"];
  apiEndpoints: BedrockApiEndpoint[];
  modelEndpoints: Set<BedrockModelEndpoint>;
} {
  const table = markdownTable(body, ["Input Modalities", "Output Modalities"]);
  if (table === undefined) throw new Error("Bedrock model card omitted its modality table");
  const { header } = table;
  const inputIndex = header.indexOf("Input Modalities");
  const outputIndex = header.indexOf("Output Modalities");
  const apiIndex = header.findIndex((cell) => cell.includes("APIs supported"));
  const endpointIndex = header.findIndex((cell) => cell.includes("Endpoints supported"));
  if (apiIndex < 0 || endpointIndex < 0)
    throw new Error("Bedrock model card omitted API or endpoint support");
  const input: Modality[] = [];
  const output: Modality[] = [];
  const apiEndpoints = new Map<string, BedrockApiEndpoint>();
  const modelEndpoints = new Set<BedrockModelEndpoint>();
  for (const cells of table.rows) {
    const inputValue = supportedModality(cells[inputIndex] ?? "");
    const outputValue = supportedModality(cells[outputIndex] ?? "");
    if (inputValue !== undefined) input.push(inputValue);
    if (outputValue !== undefined) output.push(outputValue);
    const apiLabel = tableLabel(cells[apiIndex] ?? "");
    if (apiLabel !== undefined) {
      const definitions = bedrockApiDefinitions.get(apiLabel);
      if (definitions === undefined) throw new Error(`Unsupported Bedrock API label: ${apiLabel}`);
      if (supported(cells[apiIndex] ?? ""))
        for (const definition of definitions) {
          const endpoint = { name: apiLabel, ...definition };
          apiEndpoints.set(
            `${apiEndpointKey(endpoint)}\0${endpoint.programmaticEndpoint}`,
            endpoint,
          );
        }
    }
    const endpointLabel = tableLabel(cells[endpointIndex] ?? "");
    if (endpointLabel !== undefined) {
      if (endpointLabel !== "bedrock-runtime" && endpointLabel !== "bedrock-mantle")
        throw new Error(`Unsupported Bedrock endpoint label: ${endpointLabel}`);
      if (supported(cells[endpointIndex] ?? "")) modelEndpoints.add(endpointLabel);
    }
  }
  if (modelEndpoints.size === 0)
    throw new Error("Bedrock model card contained no supported endpoint");
  if (/^#### \[\s*Rerank API\s*]$/m.test(body))
    apiEndpoints.set(apiEndpointKey(rerankApi), rerankApi);
  return {
    modalities: { input: unique(input), output: unique(output) },
    apiEndpoints: [...apiEndpoints.values()],
    modelEndpoints,
  };
}

function ids(cell: string): string[] {
  return unique(
    cell
      .replace(/<br\s*\/?>/gi, "\n")
      .split("\n")
      .map((value) => value.replace(/[`*]/g, "").trim())
      .filter(
        (value) =>
          value === value.toLowerCase() &&
          value.includes(".") &&
          modelIdSchema.safeParse(value).success,
      ),
  );
}

function programmaticAccess(body: string, name: string): Map<string, CardId> {
  const content = section(body, "Programmatic Access");
  if (content === undefined)
    throw new Error(`Bedrock model card omitted Programmatic Access for ${name}`);
  const table = markdownTable(content, ["Endpoint", "Model ID"]);
  if (table === undefined) throw new Error(`Bedrock model card omitted its ID table for ${name}`);
  const { header } = table;
  const endpointIndex = header.indexOf("Endpoint");
  const idIndex = header.indexOf("Model ID");
  const result = new Map<string, CardId>();
  for (const cells of table.rows) {
    const endpoint = cells[endpointIndex];
    if (endpoint !== "bedrock-runtime" && endpoint !== "bedrock-mantle") continue;
    const modelId = cells[idIndex];
    if (modelId === undefined || !modelIdSchema.safeParse(modelId).success) continue;
    const current = result.get(modelId) ?? {
      aliases: new Set<string>(),
      endpoints: new Set<BedrockModelEndpoint>(),
      deploymentTypes: new Set<DeploymentType>(["in-region"]),
    };
    current.endpoints.add(endpoint);
    for (const [deploymentType, heading] of inferenceIdColumns) {
      const index = header.indexOf(heading);
      if (index < 0) continue;
      const observedAliases = ids(cells[index] ?? "");
      if (observedAliases.length > 0) current.deploymentTypes.add(deploymentType);
      for (const alias of observedAliases) if (alias !== modelId) current.aliases.add(alias);
    }
    result.set(modelId, current);
  }
  if (result.size === 0)
    throw new Error(`Bedrock model card omitted official model IDs for ${name}`);
  return result;
}

function cardAvailability(body: string): BedrockAvailability[] {
  const content = section(body, "Regional Availability");
  if (content === undefined) throw new Error("Bedrock model card omitted Regional Availability");
  const table = markdownTable(content, ["Region", "In-Region", "Geo", "Global"]);
  if (table === undefined)
    throw new Error("Bedrock model card omitted its regional availability table");
  const { header } = table;
  const regionIndex = header.indexOf("Region");
  const availability: BedrockAvailability[] = [];
  for (const cells of table.rows) {
    const region = plain(cells[regionIndex] ?? "").match(/^([a-z]{2}(?:-[a-z0-9]+)+-\d)\b/)?.[1];
    if (region === undefined) throw new Error("Bedrock regional availability omitted a region");
    for (const [deploymentType, heading] of availabilityColumns)
      if (supported(cells[header.indexOf(heading)] ?? ""))
        availability.push({ region, deploymentType });
  }
  if (availability.length === 0)
    throw new Error("Bedrock model card contained no regional availability");
  return availability;
}

function mantleRegions(documents: z.infer<typeof linkedBundleSchema>["documents"]): Set<string> {
  const document = exactDocument(documents, "/bedrock/latest/userguide/bedrock-mantle.md");
  if (document === undefined) throw new Error("Bedrock catalog omitted Mantle regions");
  const content = section(document, "Supported Regions and Endpoints");
  if (content === undefined) throw new Error("Bedrock Mantle guide omitted supported regions");
  const table = markdownTable(content, ["Region", "Endpoint"]);
  if (table === undefined) throw new Error("Bedrock Mantle guide omitted its region table");
  const { header } = table;
  const regionIndex = header.indexOf("Region");
  const endpointIndex = header.indexOf("Endpoint");
  const regions = new Set<string>();
  for (const cells of table.rows) {
    const region = cells[regionIndex];
    if (
      region === undefined ||
      !/^[a-z]{2}(?:-[a-z0-9]+)+-\d$/.test(region) ||
      cells[endpointIndex] !== `bedrock-mantle.${region}.api.aws`
    )
      throw new Error("Invalid Bedrock Mantle region row");
    regions.add(region);
  }
  if (regions.size === 0) throw new Error("Bedrock Mantle guide contained no regions");
  return regions;
}

function identityTokens(value: string, publisher = ""): string[] {
  const ignored = new Set([
    "amazon",
    "bedrock",
    "edition",
    "model",
    "instruct",
    "it",
    "pt",
    "chat",
    "input",
    "output",
  ]);
  const publisherTokens = new Set(
    publisher
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/),
  );
  const parts = value
    .replace(/\(Amazon Bedrock Edition\)/gi, "")
    .replace(/\\?\+/g, " plus ")
    .replace(/\b(\d+)\.0\b/g, "$1")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([a-z])([0-9])/gi, "$1 $2")
    .replace(/([0-9])([a-z])/gi, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((part) => (/^embeddings?$/.test(part) ? "embed" : part))
    .filter(
      (part) =>
        part !== "" &&
        part !== "v" &&
        part !== "g" &&
        !ignored.has(part) &&
        !publisherTokens.has(part),
    );
  const tokens: string[] = [];
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (part === undefined) continue;
    if (part === "multi" && parts[index + 1] === "modal") {
      tokens.push("multimodal");
      index++;
    } else {
      tokens.push(part);
    }
  }
  return tokens;
}

function identityKey(value: string, publisher = ""): string {
  return identityTokens(value, publisher).sort().join(":");
}

function cardIdentityKeys(
  name: string,
  publisher: string,
  cardIds: Map<string, CardId>,
): Set<string> {
  return new Set(
    [
      identityKey(name, publisher),
      ...[...cardIds.keys()].flatMap((id) => [
        identityKey(id.replace(/:\d+$/, ""), publisher),
        identityKey(id.replace(/-v\d+:\d+$/i, ""), publisher),
      ]),
    ].filter(Boolean),
  );
}

function parseCard(body: string, observedAt: string): Card {
  const name = plain(body.match(/^# ([^\n]+)$/m)?.[1] ?? "");
  if (name === "") throw new Error("Bedrock model card omitted its name");
  const publisher = plain(body.match(/^## .*\)\s*([^—\n]+?)\s+—\s+/m)?.[1] ?? "");
  const details = section(body, "Model Details");
  const description = details
    ?.split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "" && !line.startsWith("<a ") && !line.startsWith("+ "));
  const cardSupport = cardTable(body);
  const responsePath = body.match(
    /available on the `([^`]+)` path on the `bedrock-mantle` endpoint/i,
  )?.[1];
  if (responsePath !== undefined && !/^(?:[a-z0-9-]+\/)*v1\/responses$/.test(responsePath))
    throw new Error(`Unsupported Bedrock Responses path for ${name}: ${responsePath}`);
  const apiEndpoints = cardSupport.apiEndpoints.map((endpoint) =>
    responsePath !== undefined &&
    endpoint.name === "Responses" &&
    endpoint.programmaticEndpoint === "bedrock-mantle"
      ? { ...endpoint, path: responsePath }
      : endpoint,
  );
  const cardIds = programmaticAccess(body, name);
  const programmaticEndpoints = new Set(
    [...cardIds.values()].flatMap(({ endpoints }) => [...endpoints]),
  );
  if (
    programmaticEndpoints.size !== cardSupport.modelEndpoints.size ||
    [...programmaticEndpoints].some((endpoint) => !cardSupport.modelEndpoints.has(endpoint))
  )
    throw new Error(`Bedrock endpoint support disagreed with Programmatic Access for ${name}`);
  const lifecycle = fact(body, "Model lifecycle")?.toLowerCase();
  const documentedStatus: ProviderModel["status"] = lifecycle?.startsWith("active")
    ? "active"
    : lifecycle?.startsWith("preview")
      ? "active"
      : lifecycle?.startsWith("legacy")
        ? "legacy"
        : "unknown";
  const releaseStage: ProviderModel["release_stage"] = lifecycle?.startsWith("preview")
    ? "preview"
    : "unknown";
  const eol = fact(body, "Model EOL date");
  const launchDate = fact(body, "Model launch date");
  const deprecatedAt = eol?.startsWith("Legacy:")
    ? exactHumanDate(eol.slice("Legacy:".length).trim(), "legacy date")
    : undefined;
  const retiredAt =
    eol === undefined ||
    eol === "N/A" ||
    eol.startsWith("No sooner than") ||
    deprecatedAt !== undefined
      ? undefined
      : exactHumanDate(eol, "EOL date");
  const status: ProviderModel["status"] =
    retiredAt !== undefined && retiredAt <= observedAt.slice(0, 10) ? "retired" : documentedStatus;
  const reasoning = fact(body, "Reasoning");
  const promptCache = /\*\*Prompt caching[^\n]*\*\*[\s\S]*?\n\| Yes \|/.test(
    section(body, "Capabilities and Features") ?? "",
  );
  const computerUse = /\*\*Computer use/.test(section(body, "Capabilities and Features") ?? "");
  const capabilities = {
    ...unknownCapabilities(),
    reasoning: reasoning?.startsWith("Supported") ? true : "unknown",
    prompt_cache: promptCache ? true : "unknown",
    effort_control: reasoning?.toLowerCase().includes("effort") ? true : "unknown",
    computer_use: computerUse ? true : "unknown",
  } satisfies ProviderModel["capabilities"];
  const limits: ProviderModel["limits"] = {};
  const context = tokens(fact(body, "Context window"));
  const output = tokens(fact(body, "Max output tokens"));
  if (context !== undefined) limits.context_tokens = context;
  if (output !== undefined) limits.max_output_tokens = output;
  const tasks = classifyModelTasks({
    modelId: cardIds.keys().next().value ?? name,
    name,
    rawType: undefined,
    modalities: cardSupport.modalities,
    fallback: "text_generation",
  });
  return {
    name,
    publisher,
    description: description === undefined ? undefined : plain(description),
    ids: cardIds,
    modalities: cardSupport.modalities,
    apiEndpoints,
    availability: cardAvailability(body),
    capabilities,
    limits,
    releaseDate: launchDate === undefined ? undefined : exactHumanDate(launchDate, "launch date"),
    deprecatedAt,
    retiredAt,
    status,
    releaseStage,
    tasks,
    identityKeys: cardIdentityKeys(name, publisher, cardIds),
  };
}

function oneModel(cards: Card[]): Card | undefined {
  const first = cards[0];
  if (first === undefined) return undefined;
  const key = (card: Card) =>
    [...card.ids]
      .map(
        ([id, access]) =>
          `${id}:${[...access.endpoints].sort().join(",")}:${[...access.deploymentTypes].sort().join(",")}`,
      )
      .sort()
      .join("\0");
  const identity = key(first);
  return cards.every((card) => key(card) === identity) ? first : undefined;
}

function modelForProduct(cards: Card[], label: string, usage: string): Card | undefined {
  const displayMatches = cards.filter((card) => {
    const labelKey = identityKey(label, card.publisher);
    return labelKey !== "" && labelKey === identityKey(card.name, card.publisher);
  });
  if (displayMatches.length > 0) return oneModel(displayMatches);
  const matches = cards.filter((card) => {
    const labelKey = identityKey(label, card.publisher);
    if (labelKey !== "" && card.identityKeys.has(labelKey)) return true;
    return [...card.ids].some(([id]) => {
      const stem = id.replace(/^[^.]+\./, "").replace(/-v\d+:\d+$/i, "");
      const value = stem.replace(/[^a-z0-9]+/gi, "[-._:]?");
      return (
        value.length >= 8 &&
        new RegExp(
          `(?:^|[-:_.])${value}(?:$|[-:_.](?:mantle|input|output|cache|provisioned|reserved|batch|priority|flex|standard|text|image|audio|video))`,
          "i",
        ).test(usage)
      );
    });
  });
  if (matches.length > 0) return oneModel(matches);
  if (identityKey(label) !== "") return undefined;
  const familyMatches = cards.filter((card) => {
    const source = new Set(identityTokens(`${label} ${usage}`, card.publisher));
    const family = new Set(identityTokens(card.name, card.publisher));
    return family.size >= 2 && [...family].every((token) => source.has(token));
  });
  return oneModel(familyMatches);
}

function meter(
  text: string,
  priceText: string,
  tasks: ModelTask[],
  unit: SourcePriceFact["unit"],
): SourcePriceFact["meter"] | undefined {
  if (/provisioned|reserved|model.?units|tokens per minute|tpm/.test(text))
    return "provisioned_throughput";
  if (/cache.?read/.test(text)) {
    if (/audio/.test(text)) return "cache_read_audio";
    if (/image/.test(text)) return "cache_read_image";
    return "cache_read_text";
  }
  if (/cache.?write/.test(text)) {
    if (/audio/.test(text)) return "cache_write_audio";
    if (/image/.test(text)) return "cache_write_image";
    return "cache_write_text";
  }
  if (tasks.includes("reranking") && /search|rerank|request/.test(text)) return "rerank_request";
  if ((unit === "request" || unit === "thousand_requests") && /grounding|tool/.test(text))
    return "tool_call";
  if (tasks.includes("embeddings")) {
    if (unit === "image") return "input_image";
    if (unit === "token" || unit === "thousand_tokens" || unit === "million_tokens")
      return "input_text";
    if (unit === "second" || unit === "minute") {
      if (priceText.includes("audio")) return "input_audio";
      if (priceText.includes("video")) return "input_video";
    }
    if (/input|token|second|minute|image|request|page/.test(text)) return "embedding";
  }
  if (tasks.includes("image_generation") && /output image|created.?image|per image/.test(text))
    return "image_generation";
  if (/output.*video|video.*output/.test(text)) return "output_video";
  if (/input.*video|video.*input/.test(text)) return "input_video";
  if (/output.*image|image.*output/.test(text)) return "output_image";
  if (/input.*image|image.*input/.test(text)) return "input_image";
  if (/output.*audio|audio.*output/.test(text)) return "output_audio";
  if (/input.*audio|audio.*input|speech understanding input/.test(text)) return "input_audio";
  if (/text output/.test(text)) return "output_text";
  if (/text input/.test(text)) return "input_text";
  if (/rerank/.test(text)) return "rerank_request";
  if (/output|response/.test(text))
    return tasks.includes("speech_synthesis") || tasks.includes("speech_to_speech")
      ? "output_audio"
      : "output_text";
  if (/input|prompt/.test(text))
    return tasks.includes("transcription") || tasks.includes("speech_to_speech")
      ? "input_audio"
      : "input_text";
  if (tasks.includes("image_generation") && /image/.test(text)) return "image_generation";
  if (tasks.includes("video_generation") && /video|second/.test(text)) return "video_generation";
}

function tier(attributes: Record<string, string>, text: string): string | undefined {
  const imageQuality = /(?:^|\s)(?:standard|premium)$/i.test(attributes.inferenceType ?? "");
  const value =
    `${attributes.service_tier ?? ""} ${attributes.feature ?? ""} ${imageQuality ? "" : text}`.toLowerCase();
  if (/provisioned.*6.?months?/.test(value)) return "provisioned_6_month";
  if (/provisioned.*1.?months?/.test(value)) return "provisioned_1_month";
  if (/provisioned.*no.?commit/.test(value)) return "provisioned_no_commit";
  if (/reserved[^a-z0-9]*3.?month|3.?month.*reserved/.test(value)) return "reserved_3_month";
  if (/reserved[^a-z0-9]*1.?month|1.?month.*reserved/.test(value)) return "reserved_1_month";
  if (/reserved/.test(value)) return "reserved";
  if (/batch/.test(value)) return "batch";
  if (/priority/.test(value)) return "priority";
  if (/flex/.test(value)) return "flex";
  if (/standard|on-demand/.test(value)) return "standard";
}

function speed(text: string): string | undefined {
  return /latency.?optimized/.test(text) ? "optimized" : undefined;
}

function priceDeploymentType(text: string): DeploymentType {
  const lower = text.toLowerCase();
  if (/cross-region-global|[_ -]global(?:[_ -]|$)/.test(lower)) return "global";
  if (/cross-region-geo|[_ -]geo(?:[_ -]|$)/.test(lower)) return "geo";
  return "in-region";
}

function conditions(
  attributes: Record<string, string>,
  text: string,
  priceText: string,
  endpoint: string | undefined,
  rateMeter: SourcePriceFact["meter"],
): SourcePriceFact["conditions"] {
  const lower = text.toLowerCase();
  const deploymentType = priceDeploymentType(lower);
  const deploymentScope =
    deploymentType === "global"
      ? "global_cross_region"
      : deploymentType === "geo"
        ? "geo_cross_region"
        : "in_region";
  const serviceTier = tier(attributes, lower);
  const capacity = /input.*(?:tokens per minute|tpm)|inputtpm/.test(lower)
    ? "input_tokens_per_minute"
    : /output.*(?:tokens per minute|tpm)|outputtpm/.test(lower)
      ? "output_tokens_per_minute"
      : undefined;
  const modality =
    rateMeter === "embedding"
      ? ["audio", "image", "video", "text"].find((value) => priceText.includes(value))
      : undefined;
  const ttl = /cache.?write/.test(lower) ? (/1h|1 hour/.test(lower) ? 3_600 : 300) : undefined;
  const inference = attributes.inferenceType ?? "";
  const sourceModality = attributes.modality
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");
  const operation =
    inference.match(/\b(T2I|I2I|T2V|I2V)\b/i)?.[1]?.toUpperCase() ??
    (rateMeter === "input_image" && sourceModality !== "image"
      ? sourceModality
      : /grounding/.test(lower)
        ? "grounding"
        : undefined);
  const resolution =
    inference.match(/\b(512|1024|2048)\b/)?.[1] ??
    inference.match(/\b(SD|HD|FHD)\s+Resolution\b/i)?.[1]?.toUpperCase() ??
    attributes.imageresolution;
  const quality =
    inference.match(/\b(Standard|Premium)\b/i)?.[1]?.toLowerCase() ?? attributes.imagequality;
  return {
    region: attributes.regionCode,
    endpoint,
    deployment_scope: deploymentScope,
    service_tier: serviceTier,
    speed: speed(lower),
    context_min_tokens: /long.?(?:context|ctx)/.test(lower) ? 200_001 : undefined,
    cache_ttl_seconds: ttl,
    capacity,
    modality,
    operation,
    resolution,
    quality,
  };
}

function pricingText(attributes: Record<string, string>, description: string): string {
  return `${attributes.inferenceType ?? ""} ${attributes.feature ?? ""} ${attributes.usagetype ?? ""} ${description}`.toLowerCase();
}

function rate(
  attributes: Record<string, string>,
  description: string,
  unit: string,
  price: string,
  effectiveDate: string | undefined,
  tasks: ModelTask[],
  sourceId: string,
  endpoint: BedrockModelEndpoint | undefined,
): SourcePriceFact | undefined {
  const text = pricingText(attributes, description);
  const priceText = `${attributes.inferenceType ?? ""} ${description}`.toLowerCase();
  let normalizedUnit: SourcePriceFact["unit"] | undefined;
  let normalizedPrice = price;
  let derivation: string | undefined;
  if (unit === "1K tokens") {
    normalizedUnit = "million_tokens";
    normalizedPrice = scaleDecimal(price, 3);
    derivation = "source price per 1K tokens × 1,000";
  } else if (unit === "1M tokens" || (unit === "Units" && /million .*tokens?/.test(text))) {
    normalizedUnit = "million_tokens";
  } else if (/^search units?$/i.test(unit) || (unit === "Units" && /search.?units?/.test(text))) {
    normalizedUnit = "search_unit";
  } else if (unit === "Units" && /seconds?/.test(text)) {
    normalizedUnit = "second";
  } else if (unit === "Units" && /image.*(?:count|output)|created.?image/.test(text)) {
    normalizedUnit = "image";
  } else if (unit === "Units" && /requests?/.test(text)) {
    normalizedUnit = "request";
  } else if (/^(?:image|images processed|input images)$/i.test(unit)) {
    normalizedUnit = "image";
  } else if (unit === "seconds" || unit === "Second") {
    normalizedUnit = "second";
  } else if (unit === "video") {
    normalizedUnit = "video";
  } else if (unit === "Minutes Processed") {
    normalizedUnit = "minute";
  } else if (unit === "Pages Processed") {
    normalizedUnit = "page";
  } else if (unit === "Requests" || unit === "Text Requests") {
    normalizedUnit = "request";
  } else if (unit === "Per 1000 requests") {
    normalizedUnit = "thousand_requests";
  } else if (
    unit === "1K TPM Hour" ||
    (unit === "1M TPM Hour" && /per hour per 1k .*tpm/.test(text))
  ) {
    normalizedUnit = "thousand_tokens_per_minute_hour";
    if (unit === "1M TPM Hour")
      derivation = "source dimension description identifies a 1K TPM-hour capacity unit";
  } else if (unit === "Embeddings" && /input.?token.?count/.test(text)) {
    normalizedUnit = "token";
    derivation = "source dimension description identifies an input-token unit";
  } else if (unit === "hour" || unit === "hours" || (unit === "Units" && /hour/.test(text))) {
    normalizedUnit = "unit_hour";
  }
  if (normalizedUnit === undefined) return undefined;
  const observedMeter = meter(text, priceText, tasks, normalizedUnit);
  const finalMeter =
    observedMeter ??
    (normalizedUnit === "image" && tasks.includes("image_generation")
      ? "image_generation"
      : normalizedUnit === "second" || normalizedUnit === "video"
        ? "video_generation"
        : undefined);
  if (finalMeter === undefined) return undefined;
  const rateConditions = conditions(attributes, text, priceText, endpoint, finalMeter);
  return {
    meter: finalMeter,
    price: normalizedPrice,
    currency: "USD",
    unit: normalizedUnit,
    conditions: rateConditions,
    source_ref: sourceId,
    derived: derivation !== undefined,
    derivation,
    raw_price: price,
    raw_unit: unit,
    ...(effectiveDate === undefined ? {} : { raw_validity: effectiveDate }),
  };
}

function priceTargets(
  card: Card,
  offerCode: BedrockOfferCode,
  usage: string,
): { ids: string[]; endpoint: BedrockModelEndpoint | undefined } {
  const deploymentType = priceDeploymentType(usage);
  const lower = usage.toLowerCase();
  const onDemandToken = /token/.test(lower) && !/batch|reserved|provisioned|tpm/.test(lower);
  const marketplaceToken = offerCode === "AmazonBedrockFoundationModels" && onDemandToken;
  const endpointNeutral =
    marketplaceToken ||
    (offerCode === "AmazonBedrockService" && onDemandToken && !lower.includes("mantle"));
  const endpoint =
    offerCode === "AmazonBedrockFoundationModels" || !lower.includes("mantle")
      ? "bedrock-runtime"
      : "bedrock-mantle";
  const ids = [...card.ids]
    .filter(
      ([, value]) =>
        value.deploymentTypes.has(deploymentType) &&
        (marketplaceToken || value.endpoints.has(endpoint)),
    )
    .map(([id]) => id);
  return { ids, endpoint: endpointNeutral ? undefined : endpoint };
}

function addRate(rates: Map<string, SourcePriceFact>, next: SourcePriceFact): void {
  const key = rateKey(next);
  const sameScope = [...rates.values()].filter((current) => rateKey(current) === key);
  if (sameScope.some((current) => decimalsEqual(current.price, next.price))) return;
  rates.set(sameScope.length === 0 ? key : `${key}\0${next.price}\0${rates.size}`, next);
}

function rateKey(rate: SourcePriceFact): string {
  return `${rate.meter}:${rate.currency}:${rate.unit}:${JSON.stringify(rate.conditions)}`;
}

function setReviewedPageRate(rates: Map<string, SourcePriceFact>, next: SourcePriceFact): boolean {
  const key = rateKey(next);
  const overlaps = [...rates].filter(([, current]) => rateKey(current) === key);
  for (const [currentKey] of overlaps) rates.delete(currentKey);
  rates.set(key, next);
  return overlaps.some(([, current]) => !decimalsEqual(current.price, next.price));
}

function mergeOptionalFact<T>(
  modelId: string,
  field: string,
  current: T | undefined,
  incoming: T | undefined,
): T | undefined {
  if (current === undefined) return incoming;
  if (incoming === undefined) return current;
  if (stableJson(current) !== stableJson(incoming))
    throw new Error(`Bedrock model ID ${modelId} has conflicting ${field}`);
  return current;
}

function mergeKnownFact<T extends string>(
  modelId: string,
  field: string,
  current: T,
  incoming: T,
  unknown: T,
): T {
  if (current === unknown) return incoming;
  if (incoming === unknown) return current;
  if (current !== incoming) throw new Error(`Bedrock model ID ${modelId} has conflicting ${field}`);
  return current;
}

function mergeCapability(
  modelId: string,
  field: string,
  current: boolean | "unknown",
  incoming: boolean | "unknown",
): boolean | "unknown" {
  if (current === "unknown") return incoming;
  if (incoming === "unknown") return current;
  if (current !== incoming)
    throw new Error(`Bedrock model ID ${modelId} has conflicting capability ${field}`);
  return current;
}

function mergeBedrockModels(current: ProviderModel, incoming: ProviderModel): ProviderModel {
  const modelId = current.model_id;
  if (current.uid !== incoming.uid || current.name !== incoming.name)
    throw new Error(`Bedrock model ID ${modelId} has conflicting identity`);
  const rates = new Map<string, SourcePriceFact>();
  for (const rate of [...current.price_facts, ...incoming.price_facts]) addRate(rates, rate);
  const endpoints = new Map(
    [...(current.api_endpoints ?? []), ...(incoming.api_endpoints ?? [])].map((endpoint) => [
      apiEndpointKey(endpoint),
      endpoint,
    ]),
  );
  const availability = new Map(
    [...(current.availability ?? []), ...(incoming.availability ?? [])].map((item) => [
      `${item.region}\0${item.deployment_type}`,
      item,
    ]),
  );
  const contextTokens = mergeOptionalFact(
    modelId,
    "context token limit",
    current.limits.context_tokens,
    incoming.limits.context_tokens,
  );
  const maxInputTokens = mergeOptionalFact(
    modelId,
    "maximum input token limit",
    current.limits.max_input_tokens,
    incoming.limits.max_input_tokens,
  );
  const maxOutputTokens = mergeOptionalFact(
    modelId,
    "maximum output token limit",
    current.limits.max_output_tokens,
    incoming.limits.max_output_tokens,
  );
  const embeddingDimensions = mergeOptionalFact(
    modelId,
    "embedding dimensions",
    current.limits.embedding_dimensions,
    incoming.limits.embedding_dimensions,
  );
  const embeddingDimensionRange = mergeOptionalFact(
    modelId,
    "embedding dimension range",
    current.limits.embedding_dimension_range,
    incoming.limits.embedding_dimension_range,
  );
  const recommendedEmbeddingDimensions = mergeOptionalFact(
    modelId,
    "recommended embedding dimensions",
    current.limits.recommended_embedding_dimensions,
    incoming.limits.recommended_embedding_dimensions,
  );
  const limits: ProviderModel["limits"] = {
    ...(contextTokens === undefined ? {} : { context_tokens: contextTokens }),
    ...(maxInputTokens === undefined ? {} : { max_input_tokens: maxInputTokens }),
    ...(maxOutputTokens === undefined ? {} : { max_output_tokens: maxOutputTokens }),
    ...(embeddingDimensions === undefined ? {} : { embedding_dimensions: embeddingDimensions }),
    ...(embeddingDimensionRange === undefined
      ? {}
      : { embedding_dimension_range: embeddingDimensionRange }),
    ...(recommendedEmbeddingDimensions === undefined
      ? {}
      : { recommended_embedding_dimensions: recommendedEmbeddingDimensions }),
  };
  return {
    ...current,
    description: mergeOptionalFact(
      modelId,
      "description",
      current.description,
      incoming.description,
    ),
    aliases: [...new Set([...current.aliases, ...incoming.aliases])].sort(),
    tasks: unique([...current.tasks, ...incoming.tasks]),
    api_endpoints:
      endpoints.size === 0
        ? undefined
        : [...endpoints.values()].sort((left, right) =>
            apiEndpointKey(left).localeCompare(apiEndpointKey(right)),
          ),
    modalities: {
      input: unique([...current.modalities.input, ...incoming.modalities.input]),
      output: unique([...current.modalities.output, ...incoming.modalities.output]),
    },
    capabilities: {
      reasoning: mergeCapability(
        modelId,
        "reasoning",
        current.capabilities.reasoning,
        incoming.capabilities.reasoning,
      ),
      tool_call: mergeCapability(
        modelId,
        "tool_call",
        current.capabilities.tool_call,
        incoming.capabilities.tool_call,
      ),
      structured_output: mergeCapability(
        modelId,
        "structured_output",
        current.capabilities.structured_output,
        incoming.capabilities.structured_output,
      ),
      streaming: mergeCapability(
        modelId,
        "streaming",
        current.capabilities.streaming,
        incoming.capabilities.streaming,
      ),
      batch: mergeCapability(
        modelId,
        "batch",
        current.capabilities.batch,
        incoming.capabilities.batch,
      ),
      prompt_cache: mergeCapability(
        modelId,
        "prompt_cache",
        current.capabilities.prompt_cache,
        incoming.capabilities.prompt_cache,
      ),
      fine_tuning: mergeCapability(
        modelId,
        "fine_tuning",
        current.capabilities.fine_tuning,
        incoming.capabilities.fine_tuning,
      ),
      citations: mergeCapability(
        modelId,
        "citations",
        current.capabilities.citations,
        incoming.capabilities.citations,
      ),
      code_execution: mergeCapability(
        modelId,
        "code_execution",
        current.capabilities.code_execution,
        incoming.capabilities.code_execution,
      ),
      context_management: mergeCapability(
        modelId,
        "context_management",
        current.capabilities.context_management,
        incoming.capabilities.context_management,
      ),
      effort_control: mergeCapability(
        modelId,
        "effort_control",
        current.capabilities.effort_control,
        incoming.capabilities.effort_control,
      ),
      computer_use: mergeCapability(
        modelId,
        "computer_use",
        current.capabilities.computer_use,
        incoming.capabilities.computer_use,
      ),
    },
    limits,
    release_date: mergeOptionalFact(
      modelId,
      "release date",
      current.release_date,
      incoming.release_date,
    ),
    deprecated_at: mergeOptionalFact(
      modelId,
      "deprecation date",
      current.deprecated_at,
      incoming.deprecated_at,
    ),
    retired_at: mergeOptionalFact(
      modelId,
      "retirement date",
      current.retired_at,
      incoming.retired_at,
    ),
    status: mergeKnownFact(modelId, "lifecycle", current.status, incoming.status, "unknown"),
    release_stage: mergeKnownFact(
      modelId,
      "release stage",
      current.release_stage,
      incoming.release_stage,
      "unknown",
    ),
    pricing_state: mergeKnownFact(
      modelId,
      "pricing status",
      current.pricing_state,
      incoming.pricing_state,
      "unknown",
    ),
    price_facts: [...rates.values()].sort((left, right) =>
      `${left.meter}:${JSON.stringify(left.conditions)}`.localeCompare(
        `${right.meter}:${JSON.stringify(right.conditions)}`,
      ),
    ),
    availability:
      availability.size === 0
        ? undefined
        : [...availability.values()].sort((left, right) =>
            `${left.deployment_type}\0${left.region}`.localeCompare(
              `${right.deployment_type}\0${right.region}`,
            ),
          ),
    source_refs: [...new Set([...current.source_refs, ...incoming.source_refs])].sort(),
  };
}

function cohereEmbedMarketplaceRates(body: string, sourceId: string): SourcePriceFact[] {
  const page = load(body);
  if (
    page("title").text().trim() !== "AWS Marketplace: Cohere Embed 4 Model (Amazon Bedrock Edition)"
  )
    throw new Error("Bedrock Cohere Embed 4 Marketplace identity changed");
  const contexts = page("script#vike_pageContext")
    .map((_index, element) => page(element).text())
    .get();
  if (contexts.length !== 1 || contexts[0] === undefined)
    throw new Error("Bedrock Cohere Embed 4 Marketplace state was not unique");
  const context = marketplacePageContextSchema.parse(JSON.parse(contexts[0]));
  const queries = context.dehydratedState.queries.flatMap((query) => {
    const parsed = marketplaceQuerySchema.safeParse(query);
    return parsed.success ? [parsed.data] : [];
  });
  const pricingTerms = queries.flatMap((query) =>
    query.state.data.summary.terms.flatMap((term) => {
      const parsed = marketplacePricingTermSchema.safeParse(term);
      return parsed.success ? [parsed.data] : [];
    }),
  );
  if (pricingTerms.length === 0)
    throw new Error("Bedrock Cohere Embed 4 Marketplace pricing term was missing");
  const cardSets = new Map(
    pricingTerms.map((term) => [stableJson(term.rateCards), term.rateCards] as const),
  );
  if (cardSets.size !== 1)
    throw new Error("Bedrock Cohere Embed 4 Marketplace pricing terms disagreed");
  const cards = [...cardSets.values()][0]!;
  const regional = new Set<string>();
  const global = new Set<string>();
  const keys = new Set<string>();
  const rates = cards.map((card): SourcePriceFact => {
    const isGlobal = card.dimensionKey.endsWith("_Global");
    if (isGlobal !== card.displayName.endsWith(" Global"))
      throw new Error("Bedrock Cohere Embed 4 Marketplace scope changed");
    if (card.description !== card.displayName)
      throw new Error("Bedrock Cohere Embed 4 Marketplace description changed");
    const region = card.dimensionLabels[0]!.value;
    const key = `${isGlobal ? "global" : "in-region"}:${region}`;
    if (keys.has(key)) throw new Error("Bedrock Cohere Embed 4 Marketplace duplicated a region");
    keys.add(key);
    (isGlobal ? global : regional).add(region);
    return {
      meter: "input_text",
      price: card.price,
      currency: "USD",
      unit: "million_tokens",
      conditions: {
        region,
        deployment_scope: isGlobal ? "global_cross_region" : "in_region",
      },
      source_ref: sourceId,
      source_locator: {
        kind: "table",
        value: `prodview-j3fgisven2yrs:${card.dimensionKey}`,
      },
      derived: false,
      raw_price: card.price,
      raw_unit: card.displayName,
      resolution_policy: "bedrock_marketplace_product_page_over_price_list",
    };
  });
  if (
    regional.size !== 23 ||
    global.size !== 23 ||
    [...regional].some((region) => !global.has(region))
  )
    throw new Error("Bedrock Cohere Embed 4 Marketplace region coverage changed");
  return rates;
}

interface BedrockPriceDimension {
  dimension: z.infer<typeof priceDimensionSchema>;
  term: z.infer<typeof priceTermSchema>;
}

interface CommercialSpec {
  bookKey: string;
  bookName: string;
  resourceKind: SourceCommercialPricingFact["resource_kind"];
  resourceKey: string;
  modelRefs: string[];
  offerKey: string;
  offerName: string;
  billingMode: SourceCommercialPricingFact["billing_mode"];
  termKey: string;
}

interface CommercialBuilder {
  spec: CommercialSpec;
  rates: SourceRawPricingFact[];
}

interface BedrockPrices {
  modelRates: Map<string, SourcePriceFact[]>;
  commercialFacts: SourceCommercialPricingFact[];
}

function slug(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function agentCoreService(usage: string): string | undefined {
  return usage.match(
    /(?:^|-)(Runtime|BrowserTool|CodeInterpreter|Evaluations|Gateway|Knowledge-Base|Memory|Policy|WebSearchTool):/,
  )?.[1];
}

function agentCoreSpec(
  attributes: Record<string, string>,
  unit: string,
): CommercialSpec | undefined {
  const usage = attributes.usagetype ?? "";
  const service = agentCoreService(usage);
  if (attributes.operation === "AgentCoreRuntimeInstancesUsage" || service === "Runtime") {
    const instance = attributes.operation === "AgentCoreRuntimeInstancesUsage";
    return {
      bookKey: "service:agentcore-runtime",
      bookName: "AgentCore Runtime",
      resourceKind: "service",
      resourceKey: "agentcore-runtime",
      modelRefs: [],
      offerKey: instance ? "instance-based" : "consumption",
      offerName: instance ? "Instance-based runtime" : "Consumption-based runtime",
      billingMode: "usage",
      termKey: instance
        ? `instance-${slug(attributes.instanceType || usage)}`
        : slug(attributes.resource || unit),
    };
  }
  const identity: readonly [string, string] | undefined =
    service === "BrowserTool"
      ? ["agentcore-browser", "AgentCore Browser"]
      : service === "CodeInterpreter"
        ? ["agentcore-code-interpreter", "AgentCore Code Interpreter"]
        : service === "Evaluations"
          ? ["agentcore-evaluations", "AgentCore Evaluations"]
          : service === "Gateway"
            ? ["agentcore-gateway", "AgentCore Gateway"]
            : service === "Knowledge-Base"
              ? ["agentcore-knowledge-base", "AgentCore Knowledge Base"]
              : service === "Memory"
                ? ["agentcore-memory", "AgentCore Memory"]
                : service === "Policy"
                  ? ["agentcore-policy", "AgentCore Policy"]
                  : service === "WebSearchTool"
                    ? ["agentcore-web-search", "AgentCore Web Search"]
                    : undefined;
  if (identity === undefined) return;
  const [resourceKey, bookName] = identity;
  const tier = attributes.tier === undefined ? "" : `-${slug(attributes.tier)}`;
  const strategy = attributes.strategy === undefined ? "" : `-${slug(attributes.strategy)}`;
  const resource = slug(attributes.resource || unit);
  return {
    bookKey: `service:${resourceKey}`,
    bookName,
    resourceKind: "service",
    resourceKey,
    modelRefs: [],
    offerKey: `consumption${tier}${strategy}`,
    offerName: `Consumption-based${tier.replace("-", " ")}${strategy.replace("-", " ")}`,
    billingMode: "usage",
    termKey: resource,
  };
}

function coreCommercialSpec(
  attributes: Record<string, string>,
  unit: string,
  modelRefs: string[] = [],
): CommercialSpec | undefined {
  const operation = attributes.operation ?? "";
  const feature = attributes.feature ?? "";
  const featureType = attributes.featureType ?? "";
  const inference = attributes.inferenceType ?? "";
  const usage = attributes.usagetype ?? "";
  const text = `${operation} ${feature} ${featureType} ${inference} ${usage}`;
  if (/Custom Model Import/i.test(text)) {
    const offerKey = /storage/i.test(featureType) ? "storage" : "runtime";
    return {
      bookKey: "account-resource:custom-model-import",
      bookName: "Custom Model Import",
      resourceKind: "account_resource_template",
      resourceKey: "custom-model-import",
      modelRefs: [],
      offerKey,
      offerName: offerKey === "storage" ? "Imported model storage" : "Imported model runtime",
      billingMode: "usage",
      termKey: offerKey,
    };
  }
  if (modelRefs.length > 0 && /custom|customization|training|storage/i.test(text)) {
    const modelKey = slug(modelRefs.join("-"));
    const offerKey = /training/i.test(featureType)
      ? "training"
      : /storage/i.test(featureType)
        ? "storage"
        : /provisioned/i.test(inference)
          ? "custom-provisioned"
          : "custom-inference";
    return {
      bookKey: `account-resource:model-customization:${modelKey}`,
      bookName: "Model Customization",
      resourceKind: "account_resource_template",
      resourceKey: `model-customization:${modelKey}`,
      modelRefs,
      offerKey,
      offerName: offerKey.replaceAll("-", " "),
      billingMode: offerKey === "custom-provisioned" ? "capacity" : "usage",
      termKey: slug(feature || inference || unit),
    };
  }
  const service: readonly [string, string, string] | undefined =
    operation === "ApplyGuardrail" || operation === "InvokeGuardrailChecks"
      ? ["guardrails", "Guardrails", operation === "ApplyGuardrail" ? "apply" : "invoke-checks"]
      : operation === "BedrockFlows-v1-invokeFlow"
        ? ["flows", "Flows", "node-transitions"]
        : operation === "GenerateSQL-StructuredRetrieve"
          ? ["knowledge-bases", "Knowledge Bases", "structured-data-retrieval"]
          : operation === "InvokeDataAutomationAsync" || operation === "InvokeDataAutomationSync"
            ? [
                "data-automation",
                "Bedrock Data Automation",
                `${operation.endsWith("Sync") ? "sync" : "async"}-${slug(feature)}`,
              ]
            : operation === "APO-v1-optimizePrompt"
              ? ["prompt-optimization", "Prompt Optimization", "simple"]
              : feature === "Prompt Router"
                ? ["prompt-routing", "Intelligent Prompt Routing", "routing"]
                : feature === "Reranker" || /AmazonRerank.*searchunits/i.test(usage)
                  ? ["reranking", "Bedrock Reranking", "amazon-rerank"]
                  : /Bedrock-Websearch-Queries/i.test(usage)
                    ? ["web-search", "Bedrock Web Search", "query"]
                    : undefined;
  if (service === undefined) return;
  const [resourceKey, bookName, offerKey] = service;
  return {
    bookKey: `service:${resourceKey}`,
    bookName,
    resourceKind: "service",
    resourceKey,
    modelRefs: [],
    offerKey,
    offerName: offerKey.replaceAll("-", " "),
    billingMode: "usage",
    termKey: slug(attributes.policyType || feature || unit),
  };
}

function commercialSpec(
  offerCode: BedrockOfferCode,
  attributes: Record<string, string>,
  unit: string,
  modelRefs: string[] = [],
): CommercialSpec | undefined {
  return offerCode === "AmazonBedrockAgentCore"
    ? agentCoreSpec(attributes, unit)
    : offerCode === "AmazonBedrock"
      ? coreCommercialSpec(attributes, unit, modelRefs)
      : undefined;
}

function commercialRawFact(
  offerCode: BedrockOfferCode,
  sku: string,
  attributes: Record<string, string>,
  dimension: z.infer<typeof priceDimensionSchema>,
  effectiveDate: string | undefined,
  termKey: string,
  sourceId: string,
): SourceRawPricingFact | undefined {
  const evidenceAttributes = new Set([
    "batch",
    "feature",
    "featureType",
    "inferenceType",
    "instanceType",
    "modality",
    "operation",
    "policyType",
    "resource",
    "strategy",
    "tier",
    "type",
    "usagetype",
  ]);
  const entries = [
    ["offer_code", offerCode],
    ["sku", sku],
    ...Object.entries(attributes).filter(([key]) => evidenceAttributes.has(key)),
  ]
    .filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== "")
    .sort(([left], [right]) => left.localeCompare(right));
  const price = dimension.pricePerUnit.USD;
  if (price === undefined) return;
  return {
    term_key: termKey,
    impact: "base_price",
    reason: "unsupported_structure",
    conditions: attributes.regionCode === undefined ? {} : { region: attributes.regionCode },
    source_ref: sourceId,
    raw: {
      label: `${offerCode}:${sku}`,
      amount: price,
      denomination: "USD",
      unit: dimension.unit,
      meter: termKey,
      ...(effectiveDate === undefined ? {} : { validity: effectiveDate }),
      conditions: entries.map(([dimensionName, value]) => ({
        dimension: dimensionName,
        value,
      })),
      fragment: dimension.description,
    },
  };
}

function addCommercialRate(
  builders: Map<string, CommercialBuilder>,
  spec: CommercialSpec,
  raw: SourceRawPricingFact,
): void {
  const key = `${spec.bookKey}\0${spec.offerKey}\0${spec.termKey}`;
  const current = builders.get(key);
  if (current !== undefined) {
    const { rates: _rates, ...identity } = current;
    if (stableJson(identity.spec) !== stableJson(spec))
      throw new Error(`Bedrock commercial offer ${key} changed identity`);
    current.rates.push(raw);
    return;
  }
  builders.set(key, { spec, rates: [raw] });
}

function commercialFacts(
  builders: ReadonlyMap<string, CommercialBuilder>,
  sourceId: string,
): SourceCommercialPricingFact[] {
  return [...builders.values()].map(({ spec, rates }) => ({
    source_ref: sourceId,
    book_key: spec.bookKey,
    book_name: spec.bookName,
    resource_kind: spec.resourceKind,
    resource_key: spec.resourceKey,
    model_refs: spec.modelRefs,
    offer_key: spec.offerKey,
    offer_name: spec.offerName,
    billing_mode: spec.billingMode,
    pricing_state: "numeric",
    price_facts: [],
    raw_price_facts: rates,
  }));
}

function pageRawFact(
  sourceId: string,
  termKey: string,
  impact: SourceRawPricingFact["impact"],
  raw: SourceRawPricingFact["raw"],
): SourceRawPricingFact {
  return {
    term_key: termKey,
    impact,
    reason: "unsupported_structure",
    conditions: {},
    source_ref: sourceId,
    raw,
  };
}

interface PageCommercialFact {
  bookKey: string;
  bookName: string;
  resourceKey: string;
  offerKey: string;
  offerName: string;
  pricingState: SourceCommercialPricingFact["pricing_state"];
  raw: SourceRawPricingFact[];
}

function pageCommercialFact(
  sourceId: string,
  value: PageCommercialFact,
): SourceCommercialPricingFact {
  return {
    source_ref: sourceId,
    book_key: value.bookKey,
    book_name: value.bookName,
    resource_kind: "service",
    resource_key: value.resourceKey,
    model_refs: [],
    offer_key: value.offerKey,
    offer_name: value.offerName,
    billing_mode: "usage",
    pricing_state: value.pricingState,
    price_facts: [],
    raw_price_facts: value.raw,
  };
}

function pricingRow(
  rows: ReadonlyMap<string, string[]>,
  label: string,
  expected: RegExp,
  onPricingReconciliation?: (item: PricingReconciliationItem) => void,
): string | undefined {
  const cells = rows.get(label);
  const value = cells?.at(-1);
  if (value === undefined || !expected.test(value)) {
    onPricingReconciliation?.({
      disposition: "unsupported",
      reason_code: "pricing_page_row_drifted",
      sample: `AgentCore: ${label}`,
    });
    return;
  }
  return value;
}

function agentCorePageFacts(
  documents: BedrockDocuments,
  sourceId: string,
  onPricingReconciliation?: (item: PricingReconciliationItem) => void,
): SourceCommercialPricingFact[] {
  const matches = documents.filter(({ url }) => {
    const parsed = new URL(url);
    return (
      parsed.hostname === "aws.amazon.com" && parsed.pathname === "/bedrock/agentcore/pricing/"
    );
  });
  if (matches.length > 1)
    onPricingReconciliation?.({
      disposition: "unsupported",
      reason_code: "pricing_page_duplicated",
      sample: "AgentCore pricing",
    });
  const document = matches[0];
  if (document === undefined) return [];
  const page = load(document.body);
  const tables = page("table").filter((_index, table) => {
    const text = page(table).text();
    return (
      text.includes("Token or API key requests for non-AWS resources") &&
      text.includes("Registry Records")
    );
  });
  if (tables.length !== 1) {
    onPricingReconciliation?.({
      disposition: "unsupported",
      reason_code: "pricing_page_table_drifted",
      sample: "AgentCore pricing",
    });
    return [];
  }
  const rows = new Map<string, string[]>();
  tables.find("tr").each((_index, row) => {
    const cells = page(row)
      .children("th,td")
      .map((_cellIndex, cell) => page(cell).text().replace(/\s+/g, " ").trim())
      .get();
    for (const label of cells.slice(0, -1)) if (label !== "") rows.set(label, cells);
  });
  const identity = pricingRow(
    rows,
    "Token or API key requests for non-AWS resources",
    /^\$0\.010 per 1,000 token or API keys requested by the agent/,
    onPricingReconciliation,
  );
  const insights = pricingRow(
    rows,
    "Insights (Preview)",
    /^Free during public preview; pricing will be announced before general availability$/,
    onPricingReconciliation,
  );
  const recommendations = pricingRow(
    rows,
    "Recommendations",
    /^Recommendation generation is free; pay for any Evaluations consumed as part of workflow$/,
    onPricingReconciliation,
  );
  const experiments = pricingRow(
    rows,
    "A/B Tests",
    /^Pay for underlying AgentCore resources consumed$/,
    onPricingReconciliation,
  );
  const registryRecords = pricingRow(
    rows,
    "Registry Records",
    /^First 5,000 records free monthly, then \$0\.400 per 1,000 records$/,
    onPricingReconciliation,
  );
  const registrySearch = pricingRow(
    rows,
    "Search API Invocation",
    /^First 1,000,000 invocations free monthly, then \$0\.020 per 1,000 invocations$/,
    onPricingReconciliation,
  );
  const registryList = pricingRow(
    rows,
    "List and Get API Invocations",
    /^First 2,000,000 combined invocations free monthly, then \$0\.004 per 1,000 invocations$/,
    onPricingReconciliation,
  );
  const paymentOperations = pricingRow(
    rows,
    "CreateInstrument and ProcessPayment API invocations",
    /Coinbase CDP Wallet:.*1 CreateInstrument API invocation = 1 wallet operation fee.*1 ProcessPayment API invocation = 1 wallet operation fee.*Stripe Privy Wallet:.*1 CreateInstrument API invocation = No charge.*1 ProcessPayment API invocation = 1 wallet operation fee/,
    onPricingReconciliation,
  );
  const freePaymentApis = pricingRow(
    rows,
    "Rest of the API invocations",
    /^No charge$/,
    onPricingReconciliation,
  );
  const temporalPolicies = pricingRow(
    rows,
    "Authorization Request",
    /first 100 temporal policies per policy engine incur no additional authorization charges/i,
    onPricingReconciliation,
  );
  const raw = (
    termKey: string,
    impact: SourceRawPricingFact["impact"],
    fragment: string,
    amount?: string,
    unit?: string,
    denomination?: "USD",
  ) =>
    pageRawFact(sourceId, termKey, impact, {
      ...(amount === undefined ? {} : { amount }),
      ...(denomination === undefined ? {} : { denomination }),
      ...(unit === undefined ? {} : { unit }),
      fragment,
    });
  const facts: SourceCommercialPricingFact[] = [];
  if (identity !== undefined)
    facts.push(
      pageCommercialFact(sourceId, {
        bookKey: "service:agentcore-identity",
        bookName: "AgentCore Identity",
        resourceKey: "agentcore-identity",
        offerKey: "direct",
        offerName: "Direct successful credential requests",
        pricingState: "numeric",
        raw: [
          raw("credential-requests", "base_price", identity, "0.010", "Per 1000 requests", "USD"),
        ],
      }),
      pageCommercialFact(sourceId, {
        bookKey: "service:agentcore-identity",
        bookName: "AgentCore Identity",
        resourceKey: "agentcore-identity",
        offerKey: "runtime-or-gateway",
        offerName: "Through Runtime or Gateway",
        pricingState: "included",
        raw: [
          raw(
            "covering-services",
            "informational",
            "No additional charges through AgentCore Runtime or AgentCore Gateway",
          ),
        ],
      }),
    );
  const optimization = [
    { key: "insights-preview", name: "Insights public preview", state: "free", text: insights },
    {
      key: "recommendations",
      name: "Recommendations",
      state: "included",
      text: recommendations,
    },
    { key: "experiments", name: "A/B tests", state: "included", text: experiments },
  ] as const;
  for (const { key, name, state, text } of optimization) {
    if (text === undefined) continue;
    facts.push(
      pageCommercialFact(sourceId, {
        bookKey: "service:agentcore-optimization",
        bookName: "AgentCore Optimization",
        resourceKey: "agentcore-optimization",
        offerKey: key,
        offerName: name,
        pricingState: state,
        raw: [raw("underlying-services", "informational", text)],
      }),
    );
  }
  const registry = [
    {
      key: "records",
      text: registryRecords,
      price: "0.400",
      priceUnit: "1K Registry Record-Months",
      allowance: "5000",
      allowanceUnit: "Registry Records",
    },
    {
      key: "search",
      text: registrySearch,
      price: "0.020",
      priceUnit: "Per 1000 requests",
      allowance: "1000000",
      allowanceUnit: "Requests",
    },
    {
      key: "list-get",
      text: registryList,
      price: "0.004",
      priceUnit: "Per 1000 requests",
      allowance: "2000000",
      allowanceUnit: "Requests",
    },
  ] as const;
  const registryRaw = registry.flatMap(
    ({ key, text, price, priceUnit, allowance, allowanceUnit }) =>
      text === undefined
        ? []
        : [
            raw(key, "base_price", text, price, priceUnit, "USD"),
            raw(`${key}-allowance`, "allowance", text, allowance, allowanceUnit),
          ],
  );
  if (registryRaw.length > 0)
    facts.push(
      pageCommercialFact(sourceId, {
        bookKey: "service:agentcore-registry",
        bookName: "AWS Agent Registry",
        resourceKey: "agentcore-registry",
        offerKey: "consumption",
        offerName: "Consumption-based registry",
        pricingState: "numeric",
        raw: registryRaw,
      }),
    );
  if (temporalPolicies !== undefined)
    facts.push(
      pageCommercialFact(sourceId, {
        bookKey: "service:agentcore-policy",
        bookName: "AgentCore Policy",
        resourceKey: "agentcore-policy",
        offerKey: "consumption",
        offerName: "Consumption-based",
        pricingState: "numeric",
        raw: [raw("temporal-policy-coverage", "allowance", temporalPolicies)],
      }),
    );
  if (paymentOperations !== undefined)
    facts.push(
      pageCommercialFact(sourceId, {
        bookKey: "service:agentcore-payments",
        bookName: "AgentCore Payments",
        resourceKey: "agentcore-payments",
        offerKey: "coinbase-wallet",
        offerName: "Coinbase CDP wallet operations",
        pricingState: "externally_billed",
        raw: [raw("wallet-provider-operations", "informational", paymentOperations)],
      }),
      pageCommercialFact(sourceId, {
        bookKey: "service:agentcore-payments",
        bookName: "AgentCore Payments",
        resourceKey: "agentcore-payments",
        offerKey: "privy-process-payment",
        offerName: "Privy ProcessPayment",
        pricingState: "externally_billed",
        raw: [raw("wallet-provider-operations", "informational", paymentOperations)],
      }),
      pageCommercialFact(sourceId, {
        bookKey: "service:agentcore-payments",
        bookName: "AgentCore Payments",
        resourceKey: "agentcore-payments",
        offerKey: "privy-create-instrument",
        offerName: "Privy CreateInstrument",
        pricingState: "free",
        raw: [raw("wallet-provider-operations", "informational", paymentOperations)],
      }),
    );
  if (freePaymentApis !== undefined)
    facts.push(
      pageCommercialFact(sourceId, {
        bookKey: "service:agentcore-payments",
        bookName: "AgentCore Payments",
        resourceKey: "agentcore-payments",
        offerKey: "other-api",
        offerName: "Other AgentCore Payments API calls",
        pricingState: "free",
        raw: [raw("other-api", "informational", freePaymentApis)],
      }),
    );
  return facts;
}

function bedrockPageFacts(
  documents: BedrockDocuments,
  sourceId: string,
  onPricingReconciliation?: (item: PricingReconciliationItem) => void,
): SourceCommercialPricingFact[] {
  const facts: SourceCommercialPricingFact[] = [];
  const countTokens = exactDocument(documents, "/bedrock/latest/userguide/count-tokens.md");
  if (countTokens !== undefined && /CountTokens doesn't incur charges\./.test(countTokens))
    facts.push(
      pageCommercialFact(sourceId, {
        bookKey: "service:token-counting",
        bookName: "CountTokens",
        resourceKey: "token-counting",
        offerKey: "preflight",
        offerName: "Model-specific token count",
        pricingState: "free",
        raw: [
          pageRawFact(sourceId, "estimated-input-tokens", "informational", {
            fragment:
              "CountTokens does not incur charges and estimates model-specific input tokens",
          }),
        ],
      }),
    );
  const pricing = documents.find(({ url }) => {
    const parsed = new URL(url);
    return parsed.hostname === "aws.amazon.com" && parsed.pathname === "/bedrock/pricing/";
  });
  if (pricing !== undefined) {
    const page = load(pricing.body);
    const section = page("h2#Model_Evaluation").first().closest("li[role='tabpanel']");
    const text = section.text().replace(/\s+/g, " ").trim();
    if (section.length !== 1 || !text.includes("a charge of $0.21 per completed human task")) {
      onPricingReconciliation?.({
        disposition: "unsupported",
        reason_code: "pricing_page_section_drifted",
        sample: "Bedrock Model Evaluation",
      });
      return facts;
    }
    facts.push(
      pageCommercialFact(sourceId, {
        bookKey: "service:model-evaluation",
        bookName: "Model Evaluation",
        resourceKey: "model-evaluation",
        offerKey: "human-evaluation",
        offerName: "Human-based evaluation",
        pricingState: "numeric",
        raw: [
          pageRawFact(sourceId, "completed-human-task", "base_price", {
            amount: "0.21",
            denomination: "USD",
            unit: "Evaluations",
            fragment: "A charge of $0.21 per completed human task",
          }),
        ],
      }),
      pageCommercialFact(sourceId, {
        bookKey: "service:model-evaluation",
        bookName: "Model Evaluation",
        resourceKey: "model-evaluation",
        offerKey: "algorithmic-scores",
        offerName: "Automatically generated algorithmic scores",
        pricingState: "included",
        raw: [
          pageRawFact(sourceId, "model-inference", "informational", {
            fragment:
              "Algorithmic scores have no extra charge; selected model inference remains billable",
          }),
        ],
      }),
    );
  }
  return facts;
}

function productDimensions(
  list: z.infer<typeof priceListSchema>,
  sku: string,
  onPricingReconciliation?: (item: PricingReconciliationItem) => void,
): BedrockPriceDimension[] {
  const result: BedrockPriceDimension[] = [];
  for (const [termCode, termInput] of Object.entries(list.terms.OnDemand[sku] ?? {})) {
    const term = priceTermSchema.safeParse(termInput);
    if (!term.success) {
      onPricingReconciliation?.({
        disposition: "unsupported",
        reason_code: "price_term_rejected",
        sample: `${list.offerCode}:${sku}:${termCode}`,
      });
      continue;
    }
    for (const [dimensionCode, dimensionInput] of Object.entries(term.data.priceDimensions)) {
      const dimension = priceDimensionSchema.safeParse(dimensionInput);
      if (!dimension.success) {
        onPricingReconciliation?.({
          disposition: "unsupported",
          reason_code: "price_dimension_rejected",
          sample: `${list.offerCode}:${sku}:${dimensionCode}`,
        });
        continue;
      }
      result.push({ dimension: dimension.data, term: term.data });
    }
  }
  return result;
}

function parsePrices(
  documents: z.infer<typeof linkedBundleSchema>["documents"],
  cards: Card[],
  sourceId: string,
  onPricingReconciliation?: (item: PricingReconciliationItem) => void,
): BedrockPrices {
  const byId = new Map<string, Map<string, SourcePriceFact>>();
  const commercial = new Map<string, CommercialBuilder>();
  let requiredDimensions = 0;
  let handledDimensions = 0;
  const unbound = new Set<string>();
  const unsupported = new Set<string>();
  for (const document of documents) {
    if (new URL(document.url).hostname !== "pricing.us-east-1.amazonaws.com") continue;
    const list = priceListSchema.parse(JSON.parse(document.body));
    for (const [sku, productInput] of Object.entries(list.products)) {
      const product = priceProductSchema.safeParse(productInput);
      if (!product.success) {
        onPricingReconciliation?.({
          disposition: "unsupported",
          reason_code: "price_product_rejected",
          sample: `${list.offerCode}:${sku}`,
        });
        continue;
      }
      const dimensions = productDimensions(list, sku, onPricingReconciliation);
      if (dimensions.length === 0) continue;
      const value = product.data;
      if (value.sku !== sku) {
        for (const { dimension } of dimensions)
          onPricingReconciliation?.({
            disposition: "unsupported",
            reason_code: "price_product_sku_mismatch",
            sample: `${list.offerCode}:${sku}:${dimension.description}`,
          });
        continue;
      }
      const attributes = value.attributes;
      const explicitLabel = attributes.model ?? attributes.titanModel ?? attributes.titanModelUnit;
      const usage = attributes.usagetype ?? "";
      const identityLabel =
        explicitLabel ??
        (list.offerCode === "AmazonBedrockFoundationModels" ? (attributes.servicename ?? "") : "");
      const card = modelForProduct(cards, identityLabel, usage);
      requiredDimensions += dimensions.length;
      const modelRefs =
        card === undefined ? [] : [...card.ids.keys()].map((id) => `amazon-bedrock/${id}`);
      const target = card === undefined ? undefined : priceTargets(card, list.offerCode, usage);
      for (const { dimension, term } of dimensions) {
        const spec = commercialSpec(list.offerCode, attributes, dimension.unit, modelRefs);
        if (spec !== undefined) {
          const raw = commercialRawFact(
            list.offerCode,
            sku,
            attributes,
            dimension,
            term.effectiveDate,
            spec.termKey,
            sourceId,
          );
          if (raw === undefined) {
            unsupported.add(`${spec.bookName}: ${dimension.unit}`);
            onPricingReconciliation?.({
              disposition: "unsupported",
              reason_code: "commercial_dimension_non_usd",
              sample: `${spec.bookName}: ${dimension.description}`,
            });
            continue;
          }
          addCommercialRate(commercial, spec, raw);
          handledDimensions++;
          onPricingReconciliation?.({
            disposition: "normalized",
            reason_code: "commercial_dimension_bound",
          });
          continue;
        }
        const label = identityLabel || usage;
        if (card === undefined) {
          const stale = explicitLabel !== undefined || list.offerCode !== "AmazonBedrockAgentCore";
          handledDimensions++;
          if (!stale) unbound.add(label);
          onPricingReconciliation?.({
            disposition: stale ? "excluded" : "unbound",
            reason_code: stale
              ? "price_product_absent_from_current_catalog"
              : "commercial_product_unbound",
            sample: `${label}: ${dimension.description}`,
          });
          continue;
        }
        if (target === undefined || target.ids.length === 0) {
          handledDimensions++;
          unbound.add(`${label} (${usage})`);
          onPricingReconciliation?.({
            disposition: "unbound",
            reason_code: "price_dimension_target_unbound",
            sample: `${label}: ${dimension.description}`,
          });
          continue;
        }
        const price = dimension.pricePerUnit.USD;
        if (price === undefined) {
          unsupported.add(`${label}: ${dimension.unit}`);
          onPricingReconciliation?.({
            disposition: "unsupported",
            reason_code: "non_usd_price_dimension",
            sample: `${label}: ${dimension.description}`,
          });
          continue;
        }
        const parsed = rate(
          attributes,
          dimension.description,
          dimension.unit,
          price,
          term.effectiveDate,
          card.tasks,
          sourceId,
          target.endpoint,
        );
        if (parsed === undefined) {
          unsupported.add(`${label}: ${dimension.unit}`);
          onPricingReconciliation?.({
            disposition: "unsupported",
            reason_code: "price_dimension_unsupported",
            sample: `${label}: ${dimension.description}`,
          });
          continue;
        }
        handledDimensions++;
        onPricingReconciliation?.({
          disposition: "normalized",
          reason_code: "price_dimension_bound",
        });
        for (const id of target.ids) {
          const rates = byId.get(id) ?? new Map<string, SourcePriceFact>();
          addRate(rates, {
            ...parsed,
            source_locator: {
              kind: "sku",
              value: `${list.offerCode}:${sku}:${dimension.rateCode ?? dimension.description}`,
            },
          });
          byId.set(id, rates);
        }
      }
    }
  }
  const cohereMarketplace = documents.filter((document) => {
    const url = new URL(document.url);
    return (
      url.hostname === "aws.amazon.com" && url.pathname === "/marketplace/pp/prodview-j3fgisven2yrs"
    );
  });
  if (cohereMarketplace.length > 1)
    throw new Error("Bedrock Cohere Embed 4 Marketplace document was duplicated");
  const marketplaceDocument = cohereMarketplace[0];
  if (marketplaceDocument !== undefined) {
    const id = "cohere.embed-v4:0";
    if (!cards.some((card) => card.ids.has(id)))
      throw new Error("Bedrock Cohere Embed 4 Marketplace model was not callable");
    const marketplaceRates = cohereEmbedMarketplaceRates(marketplaceDocument.body, sourceId);
    requiredDimensions += marketplaceRates.length;
    handledDimensions += marketplaceRates.length;
    const rates = byId.get(id) ?? new Map<string, SourcePriceFact>();
    for (const marketplaceRate of marketplaceRates) {
      const overrodePriceList = setReviewedPageRate(rates, marketplaceRate);
      onPricingReconciliation?.({
        disposition: "normalized",
        reason_code: overrodePriceList
          ? "marketplace_product_rate_overrode_price_list"
          : "marketplace_product_rate_bound",
      });
    }
    byId.set(id, rates);
  }
  const publicPages = documents.filter(({ url }) => {
    const parsed = new URL(url);
    return parsed.hostname === "aws.amazon.com" && parsed.pathname === "/bedrock/pricing/";
  });
  if (publicPages.length > 1) throw new Error("Bedrock public pricing document was duplicated");
  const publicPage = publicPages[0];
  if (publicPage !== undefined) {
    const page = load(publicPage.body);
    const openAiHeading = page("h2#OpenAI").first();
    const openAiPanel = openAiHeading.closest("li[role='tabpanel']");
    const frontierPanel = openAiHeading
      .nextAll(".lb-tabs")
      .first()
      .find("li[role='tabpanel']")
      .first();
    const openAi = frontierPanel.length === 0 ? openAiPanel : frontierPanel;
    if (openAi.length === 0) throw new Error("Bedrock pricing page omitted the OpenAI panel");
    const regionNames = new Map([
      ["US East (N. Virginia)", "us-east-1"],
      ["US East (Ohio)", "us-east-2"],
      ["US West (Oregon)", "us-west-2"],
      ["AWS GovCloud (US-West)", "us-gov-west-1"],
    ]);
    let reviewedTables = 0;
    openAi.find("table").each((_tableIndex, table) => {
      const rows = page(table).find("tr");
      const rowCells = (index: number): string[] =>
        rows
          .eq(index)
          .children("th,td")
          .map((_cellIndex, cell) => page(cell).text().replace(/\s+/g, " ").trim())
          .get();
      let headers = rowCells(0);
      let dataRows = rows.slice(1);
      let contextConditions: Array<
        { label: string; contextMinTokens?: number; contextMaxTokens?: number } | undefined
      > = headers.map(() => undefined);
      const secondHeaders = rowCells(1);
      if (headers[0] === "" && secondHeaders[0] === "OpenAI models") {
        const groups = rows
          .eq(0)
          .children("th,td")
          .map((_cellIndex, cell) => ({
            label: page(cell).text().replace(/\s+/g, " ").trim(),
            colspan: Number(page(cell).attr("colspan") ?? "1"),
          }))
          .get();
        if (
          groups.length !== 3 ||
          groups[0]?.label !== "" ||
          groups[0].colspan !== 1 ||
          !groups.every(({ colspan }) => Number.isInteger(colspan) && colspan > 0)
        )
          throw new Error("Bedrock OpenAI pricing context header changed");
        const short = groups[1]?.label.match(/^Short Context Window \((\d+(?:\.\d+)?[KM])\)$/);
        const long = groups[2]?.label.match(/^Long Context Window \((\d+(?:\.\d+)?[KM])\)$/);
        const shortMaximum = tokens(short?.[1]);
        const longMaximum = tokens(long?.[1]);
        if (shortMaximum === undefined || longMaximum === undefined || shortMaximum >= longMaximum)
          throw new Error("Bedrock OpenAI pricing context ranges changed");
        contextConditions = groups.flatMap(({ label, colspan }, index) =>
          Array.from({ length: colspan }, () =>
            index === 0
              ? undefined
              : index === 1
                ? { label, contextMaxTokens: shortMaximum }
                : {
                    label,
                    contextMinTokens: shortMaximum + 1,
                    contextMaxTokens: longMaximum,
                  },
          ),
        );
        if (contextConditions.length !== secondHeaders.length)
          throw new Error("Bedrock OpenAI pricing context columns changed");
        headers = secondHeaders;
        dataRows = rows.slice(2);
      }
      if (
        headers[0] !== "OpenAI models" ||
        !headers.includes("Price per 1M input tokens") ||
        !headers.includes("Price per 1M output tokens")
      )
        return;
      reviewedTables++;
      const regionText = page(table)
        .parent()
        .prevAll(".lb-rtxt")
        .first()
        .text()
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^Regions?:\s*/i, "");
      const regions = [...regionNames]
        .filter(([label]) => regionText.includes(label))
        .map(([, region]) => region);
      if (regions.length === 0)
        throw new Error(`Unsupported Bedrock OpenAI pricing region: ${regionText}`);
      const rateColumns = headers.flatMap((header, index) => {
        const meter: SourcePriceFact["meter"] | undefined =
          header === "Price per 1M input tokens"
            ? "input_text"
            : /Price per 1M input tokens \((?:30m )?cache write\)/.test(header)
              ? "cache_write_text"
              : header === "Price per 1M input tokens (cache read)" ||
                  header === "Price per 1M cached input tokens"
                ? "cache_read_text"
                : header === "Price per 1M output tokens"
                  ? "output_text"
                  : undefined;
        return meter === undefined
          ? []
          : [
              {
                index,
                meter,
                cacheTtl: header.includes("30m cache write") ? 1_800 : undefined,
                context: contextConditions[index],
              },
            ];
      });
      dataRows.each((_rowIndex, row) => {
        const cells = page(row)
          .children("th,td")
          .map((_index, cell) => page(cell).text().replace(/\s+/g, " ").trim())
          .get();
        const label = cells[0];
        if (label === undefined || label === "") return;
        const card = modelForProduct(cards, label, "");
        const ids =
          card === undefined
            ? []
            : [...card.ids]
                .filter(([, access]) => access.deploymentTypes.has("in-region"))
                .map(([id]) => id);
        for (const column of rateColumns) {
          const raw = cells[column.index] ?? "";
          if (raw === "-" || raw === "N/A") {
            onPricingReconciliation?.({
              disposition: "excluded",
              reason_code: "price_cell_not_available",
              sample: `${label}: ${headers[column.index] ?? column.meter}`,
            });
            continue;
          }
          requiredDimensions++;
          if (card === undefined || ids.length === 0) {
            handledDimensions++;
            unbound.add(label);
            onPricingReconciliation?.({
              disposition: "unbound",
              reason_code: "pricing_page_model_unbound",
              sample: label,
            });
            continue;
          }
          const amount = raw.match(/^\$\s*(\d+(?:\.\d+)?)$/)?.[1];
          if (amount === undefined) {
            unsupported.add(`${label}: ${raw}`);
            onPricingReconciliation?.({
              disposition: "unsupported",
              reason_code: "pricing_page_amount_unsupported",
              sample: `${label}: ${raw}`,
            });
            continue;
          }
          handledDimensions++;
          let overrodePriceList = false;
          for (const id of ids) {
            const rates = byId.get(id) ?? new Map<string, SourcePriceFact>();
            for (const region of regions)
              overrodePriceList =
                setReviewedPageRate(rates, {
                  meter: column.meter,
                  price: amount,
                  currency: "USD",
                  unit: "million_tokens",
                  conditions: {
                    region,
                    deployment_scope: "in_region",
                    service_tier: "standard",
                    ...(column.context?.contextMinTokens === undefined
                      ? {}
                      : { context_min_tokens: column.context.contextMinTokens }),
                    ...(column.context?.contextMaxTokens === undefined
                      ? {}
                      : { context_max_tokens: column.context.contextMaxTokens }),
                    ...(column.cacheTtl === undefined
                      ? {}
                      : { cache_ttl_seconds: column.cacheTtl }),
                  },
                  source_ref: sourceId,
                  derived: false,
                  raw_price: raw,
                  raw_unit:
                    column.context === undefined
                      ? headers[column.index]
                      : `${column.context.label}: ${headers[column.index] ?? column.meter}`,
                }) || overrodePriceList;
            byId.set(id, rates);
          }
          onPricingReconciliation?.({
            disposition: "normalized",
            reason_code: overrodePriceList
              ? "pricing_page_cell_overrode_price_list"
              : "pricing_page_cell_bound",
          });
        }
      });
    });
    if (reviewedTables === 0)
      throw new Error("Bedrock pricing page contained no reviewed OpenAI model tables");

    const stability = page("h2#Stability_AI").first().closest("li[role='tabpanel']");
    if (stability.length === 0)
      throw new Error("Bedrock pricing page omitted the Stability AI panel");
    let stabilityTables = 0;
    stability.find("table").each((_tableIndex, table) => {
      const rows = page(table).find("tr");
      const headers = rows
        .first()
        .children("th,td")
        .map((_index, cell) => page(cell).text().replace(/\s+/g, " ").trim())
        .get();
      if (
        headers[0] !== "Stability AI Image Services" ||
        headers[1] !== "Price per generation for each model"
      )
        return;
      stabilityTables++;
      const regions = ["us-east-1", "us-east-2", "us-west-2"];
      rows.slice(1).each((_rowIndex, row) => {
        const cells = page(row)
          .children("th,td")
          .map((_index, cell) => page(cell).text().replace(/\s+/g, " ").trim())
          .get();
        const label = cells[0];
        const raw = cells[1];
        if (label === undefined || label === "" || raw === undefined || raw === "") return;
        requiredDimensions++;
        const card = modelForProduct(cards, label, "");
        const ids =
          card === undefined
            ? []
            : [...card.ids]
                .filter(
                  ([, access]) =>
                    access.endpoints.has("bedrock-runtime") && access.deploymentTypes.has("geo"),
                )
                .map(([id]) => id);
        if (card === undefined || ids.length === 0) {
          handledDimensions++;
          unbound.add(label);
          onPricingReconciliation?.({
            disposition: "unbound",
            reason_code: "pricing_page_model_unbound",
            sample: label,
          });
          return;
        }
        const amount = raw.match(/^\$\s*(\d+(?:\.\d+)?)$/)?.[1];
        if (amount === undefined) {
          unsupported.add(`${label}: ${raw}`);
          onPricingReconciliation?.({
            disposition: "unsupported",
            reason_code: "pricing_page_amount_unsupported",
            sample: `${label}: ${raw}`,
          });
          return;
        }
        handledDimensions++;
        let overrodePriceList = false;
        for (const id of ids) {
          const rates = byId.get(id) ?? new Map<string, SourcePriceFact>();
          for (const region of regions)
            overrodePriceList =
              setReviewedPageRate(rates, {
                meter: "image_generation",
                price: amount,
                currency: "USD",
                unit: "image",
                conditions: {
                  region,
                  deployment_scope: "geo",
                  service_tier: "standard",
                },
                source_ref: sourceId,
                derived: false,
                raw_price: raw,
                raw_unit: headers[1],
              }) || overrodePriceList;
          byId.set(id, rates);
        }
        onPricingReconciliation?.({
          disposition: "normalized",
          reason_code: overrodePriceList
            ? "pricing_page_cell_overrode_price_list"
            : "pricing_page_cell_bound",
        });
      });
    });
    if (stabilityTables !== 1)
      throw new Error(
        `Bedrock pricing page contained ${stabilityTables} reviewed Stability AI tables`,
      );
  }
  if (requiredDimensions === 0 || handledDimensions !== requiredDimensions)
    onPricingReconciliation?.({
      disposition: "unbound",
      reason_code: "pricing_interpretation_partial",
      sample: `${handledDimensions}/${requiredDimensions}; unbound: ${[...unbound].slice(0, 5).join(", ") || "none"}; unsupported: ${[...unsupported].slice(0, 5).join(", ") || "none"}`,
    });
  return {
    modelRates: new Map(
      [...byId].map(([id, rates]) => [
        id,
        [...rates.values()].sort((left, right) =>
          `${left.meter}:${JSON.stringify(left.conditions)}`.localeCompare(
            `${right.meter}:${JSON.stringify(right.conditions)}`,
          ),
        ),
      ]),
    ),
    commercialFacts: [
      ...commercialFacts(commercial, sourceId),
      ...agentCorePageFacts(documents, sourceId, onPricingReconciliation),
      ...bedrockPageFacts(documents, sourceId, onPricingReconciliation),
    ],
  };
}

export function parseBedrockCatalog(input: ParseInput): ProviderModel[] {
  if (input.source.extractor.kind !== "bedrock-catalog")
    throw new Error("Bedrock catalog parser received the wrong extractor");
  const bundle = linkedBundleSchema.parse(JSON.parse(input.body));
  validateBedrockContracts(bundle.documents);
  const supportedMantleRegions = mantleRegions(bundle.documents);
  const cards = bundle.documents
    .filter((document) => {
      const url = new URL(document.url);
      return (
        url.hostname === "docs.aws.amazon.com" &&
        /^\/bedrock\/latest\/userguide\/model-card-[a-z0-9-]+\.md$/.test(url.pathname)
      );
    })
    .map((document) => parseCard(document.body, input.observedAt));
  if (cards.length === 0) throw new Error("Bedrock catalog contained no model cards");
  const prices = parsePrices(
    bundle.documents,
    cards,
    input.source.id,
    input.onPricingReconciliation,
  );
  const models = new Map<string, ProviderModel>();
  for (const card of cards) {
    for (const [id, access] of card.ids) {
      const current = models.get(id);
      if (current !== undefined && current.name !== card.name)
        throw new Error(`Bedrock model ID ${id} has conflicting display names`);
      const pricing = prices.modelRates.get(id) ?? [];
      const apiEndpoints = [
        ...new Map(
          card.apiEndpoints
            .filter(({ programmaticEndpoint }) => access.endpoints.has(programmaticEndpoint))
            .map(({ name, path }) => {
              const endpoint = { name, path };
              return [apiEndpointKey(endpoint), endpoint];
            }),
        ).values(),
      ].sort((left, right) => apiEndpointKey(left).localeCompare(apiEndpointKey(right)));
      const availability = card.availability
        .filter(({ deploymentType }) => access.deploymentTypes.has(deploymentType))
        .flatMap(({ region, deploymentType }) =>
          [...access.endpoints].flatMap((endpoint) =>
            endpoint === "bedrock-mantle" &&
            (deploymentType !== "in-region" || !supportedMantleRegions.has(region))
              ? []
              : [{ region, deployment_type: `${endpoint}/${deploymentType}` }],
          ),
        )
        .sort((left, right) =>
          `${left.deployment_type}\0${left.region}`.localeCompare(
            `${right.deployment_type}\0${right.region}`,
          ),
        );
      const incoming: ProviderModel = {
        ...baseModel({
          providerId: input.provider.id,
          id,
          name: card.name,
          sourceId: input.source.id,
          observedAt: input.observedAt,
        }),
        description: card.description,
        aliases: [...access.aliases].sort(),
        tasks: card.tasks,
        api_endpoints: apiEndpoints.length > 0 ? apiEndpoints : undefined,
        modalities: card.modalities,
        capabilities: {
          ...card.capabilities,
          batch: pricing.some((item) => item.conditions.service_tier === "batch")
            ? true
            : card.capabilities.batch,
        },
        limits: card.limits,
        release_date: card.releaseDate,
        deprecated_at: card.deprecatedAt,
        retired_at: card.retiredAt,
        status: card.status,
        release_stage: card.releaseStage,
        pricing_state: pricing.length > 0 ? "numeric" : "unknown",
        price_facts: pricing,
        availability,
        scope: "regional_catalog",
      };
      models.set(id, current === undefined ? incoming : mergeBedrockModels(current, incoming));
    }
  }
  const result = [...models.values()].sort((left, right) => left.uid.localeCompare(right.uid));
  const carrier = result.find(({ price_facts }) => price_facts.length > 0) ?? result[0];
  if (carrier !== undefined && prices.commercialFacts.length > 0)
    carrier.commercial_facts = prices.commercialFacts;
  return result;
}

function apiModality(value: z.infer<typeof apiModalitySchema>): Modality {
  if (value === "TEXT") return "text";
  if (value === "IMAGE") return "image";
  if (value === "EMBEDDING") return "embedding";
  if (value === "VIDEO") return "video";
  return "audio";
}

function apiModalities(values: string[] | undefined): Modality[] {
  return unique(
    (values ?? []).flatMap((value) => {
      const parsed = apiModalitySchema.safeParse(value);
      return parsed.success ? [apiModality(parsed.data)] : [];
    }),
  );
}

function fineTuning(values: string[] | undefined): ProviderModel["capabilities"]["fine_tuning"] {
  if (values === undefined) return "unknown";
  if (values.some((value) => value === "FINE_TUNING" || value === "PREFERENCE_FINE_TUNING"))
    return true;
  return values.every((value) => customizationSchema.safeParse(value).success) ? false : "unknown";
}

export function parseBedrockApi(input: ParseInput): ProviderModel[] {
  const { modelSummaries } = apiSchema.parse(JSON.parse(input.body));
  const enumObservations: ZodContractObservation[] = [];
  for (const [itemIndex, item] of modelSummaries.entries()) {
    const result = reviewedApiEnumsSchema.safeParse(item);
    if (!result.success)
      enumObservations.push({
        error: result.error,
        input: item,
        itemIndex,
        modelId: item.modelId,
      });
  }
  if (enumObservations.length > 0)
    input.onContractFinding?.(
      zodContractEvidence(enumObservations, modelSummaries.length, "accept_with_signal"),
    );
  return modelSummaries.map((item) => {
    const status: ProviderModel["status"] =
      item.modelLifecycle?.status === "ACTIVE"
        ? "active"
        : item.modelLifecycle?.status === "LEGACY"
          ? "legacy"
          : "unknown";
    return {
      ...baseModel({
        providerId: input.provider.id,
        id: item.modelId,
        name: item.modelName ?? item.modelId,
        sourceId: input.source.id,
        observedAt: input.observedAt,
      }),
      modalities: {
        input: apiModalities(item.inputModalities),
        output: apiModalities(item.outputModalities),
      },
      capabilities: {
        ...unknownCapabilities(),
        streaming: item.responseStreamingSupported ?? "unknown",
        fine_tuning: fineTuning(item.customizationsSupported),
      },
      release_date: apiDate(item.modelLifecycle?.startOfLifeTime),
      deprecated_at: apiDate(item.modelLifecycle?.legacyTime),
      retired_at: apiDate(item.modelLifecycle?.endOfLifeTime),
      status,
      scope: "regional_catalog",
    };
  });
}

export async function fetchBedrockInventory(region: string, maxBytes: number): Promise<string> {
  const client = new BedrockClient({ region, maxAttempts: 3 });
  try {
    const result = await client.send(new ListFoundationModelsCommand({}), {
      abortSignal: AbortSignal.timeout(20_000),
    });
    if (result.modelSummaries === undefined || result.modelSummaries.length === 0)
      throw new Error("Bedrock API returned an empty model list");
    const body = JSON.stringify({ modelSummaries: result.modelSummaries });
    if (Buffer.byteLength(body) > maxBytes) throw new Error("Bedrock API exceeded byte limit");
    return body;
  } finally {
    client.destroy();
  }
}
