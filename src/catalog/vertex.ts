import { load } from "cheerio";
import { z } from "zod";
import { linkedBundleSchema } from "./bundle.ts";
import { modelIdSchema } from "./identity.ts";
import { modelStateFromLabel } from "./lifecycle.ts";
import type { SourceManifest } from "./manifests.ts";
import { apiEndpointKey, baseModel } from "./model.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import { orderedTasks } from "./task.ts";
import { decimalsEqual, multiplyDecimal, publishedRate, scaleDecimal } from "./pricing.ts";
import {
  sourceRawPricingFactKey,
  sourcePriceFactKey,
  type ParsedProviderModel as ProviderModel,
  type SourcePriceFact,
} from "./pricing-source.ts";
import { assertCoverage, assertItemCount, recognizeItems } from "./source-contract.ts";
import { type Modality, type ModelTask, type Provider, unknownCapabilities } from "./schema.ts";

interface Input {
  provider: Provider;
  source: SourceManifest;
  body: string;
  observedAt: string;
  onPricingReconciliation?: (item: PricingReconciliationItem) => void;
}

interface Evidence {
  model: ProviderModel;
  names: Set<string>;
}

interface PageTokenEquivalence {
  inputTokensPerPage: number;
  outputTokensPerPage: number;
}

interface PricingEvidence {
  canonicalUnits: ReadonlyMap<string, SourcePriceFact["unit"]>;
  pageTokenEquivalences: ReadonlyMap<string, PageTokenEquivalence>;
}

interface LabeledPrice {
  label: string;
  price: string;
  index: number;
}

type LoadedDocument = ReturnType<typeof load>;
type Selection = ReturnType<LoadedDocument>;
type ApiEndpoint = NonNullable<ProviderModel["api_endpoints"]>[number];
type LinkedDocument = { url: string; body: string };
type Reconcile = Input["onPricingReconciliation"];

const discoveryMethodSchema = z.object({
  httpMethod: z.enum(["GET", "POST"]),
  path: z.string().min(1),
  parameters: z.record(z.string(), z.unknown()).optional(),
  response: z.object({ $ref: z.string().min(1) }),
});
const vertexDiscoverySchema = z.object({
  rootUrl: z.literal("https://aiplatform.googleapis.com/"),
  version: z.literal("v1beta1"),
  revision: z.string().regex(/^\d{8}$/),
  resources: z.object({
    publishers: z.object({
      resources: z.object({
        models: z.object({ methods: z.record(z.string(), discoveryMethodSchema) }),
      }),
    }),
    projects: z.object({
      resources: z.object({
        locations: z.object({
          resources: z.object({
            publishers: z.object({
              resources: z.object({
                models: z.object({ methods: z.record(z.string(), discoveryMethodSchema) }),
              }),
            }),
          }),
        }),
      }),
    }),
  }),
  schemas: z.object({
    GoogleCloudAiplatformV1beta1PublisherModel: z.object({
      properties: z.record(z.string(), z.unknown()),
    }),
    GoogleCloudAiplatformV1beta1ListPublisherModelsResponse: z.object({
      properties: z.record(z.string(), z.unknown()),
    }),
    GoogleCloudAiplatformV1beta1GenerateContentResponseUsageMetadata: z.object({
      properties: z.record(z.string(), z.unknown()),
    }),
    GoogleCloudAiplatformV1beta1GroundingMetadata: z.object({
      properties: z.record(z.string(), z.unknown()),
    }),
    GoogleCloudAiplatformV1beta1GenerateContentResponse: z.object({
      properties: z.record(z.string(), z.unknown()),
    }),
  }),
});

const endpoints = {
  generate: {
    name: "generateContent",
    path: "/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:generateContent",
  },
  embedding: {
    name: "embedContent",
    path: "/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:embedContent",
  },
  predict: {
    name: "predict",
    path: "/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:predict",
  },
  video: {
    name: "predictLongRunning",
    path: "/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:predictLongRunning",
  },
  claude: {
    name: "rawPredict",
    path: "/v1/projects/{project}/locations/{location}/publishers/anthropic/models/{model}:rawPredict",
  },
  claudeStream: {
    name: "streamRawPredict",
    path: "/v1/projects/{project}/locations/{location}/publishers/anthropic/models/{model}:streamRawPredict",
  },
  grok: {
    name: "Responses",
    path: "/v1/projects/{project}/locations/global/endpoints/openapi/responses",
  },
  llama: {
    name: "Chat Completions",
    path: "/v1beta1/projects/{project}/locations/{location}/endpoints/openapi/chat/completions",
  },
  open: {
    name: "Chat Completions",
    path: "/v1/projects/{project}/locations/{location}/endpoints/openapi/chat/completions",
  },
} as const satisfies Record<string, ApiEndpoint>;
const endpointReferences: Readonly<
  Record<string, readonly (readonly [string, readonly RegExp[], string])[]>
> = {
  "vertex-google-models": [
    [
      "/gemini-enterprise-agent-platform/models/start",
      [
        /GENERATE_CONTENT_API\s*=\s*"generateContent"/,
        /publishers\/google\/models\/\$\{MODEL_ID\}:\$\{GENERATE_CONTENT_API\}/,
      ],
      "Vertex generateContent reference drifted",
    ],
    [
      "/gemini-enterprise-agent-platform/models/embeddings/get-multimodal-embeddings",
      [/publishers\/google\/models\/gemini-embedding-2:embedContent/],
      "Vertex embedContent reference drifted",
    ],
    [
      "/gemini-enterprise-agent-platform/models/embeddings/get-text-embeddings",
      [/publishers\/google\/models\/\$\{MODEL_ID\}:predict/],
      "Vertex text embedding reference drifted",
    ],
    [
      "/vertex-ai/generative-ai/docs/image/generate-images",
      [/publishers\/google\/models\/MODEL_VERSION:predict/],
      "Vertex image predict reference drifted",
    ],
    [
      "/gemini-enterprise-agent-platform/models/video/generate-videos-from-text",
      [/publishers\/google\/models\/MODEL_ID:predictLongRunning/],
      "Vertex video prediction reference drifted",
    ],
    [
      "/gemini-enterprise-agent-platform/models/music/generate-music",
      [/publishers\/google\/models\/lyria-002:predict/],
      "Vertex music prediction reference drifted",
    ],
    [
      "/gemini-enterprise-agent-platform/models/grounding/grounding-with-google-search",
      [
        /lists the models that support grounding with Search/,
        /billing occurs for each search query that is generated by Gemini and sent to Search/,
      ],
      "Vertex Google Search grounding reference drifted",
    ],
    [
      "/gemini-enterprise-agent-platform/models/grounding/grounding-with-google-maps",
      [/lists the models that support Grounding with Google Maps/],
      "Vertex Google Maps grounding reference drifted",
    ],
    [
      "/gemini-enterprise-agent-platform/models/grounding/grounding-with-vertex-ai-search",
      [
        /lists the models that support grounding with your data/,
        /maximum of 10 Agent Search data sources/,
      ],
      "Vertex customer-data grounding reference drifted",
    ],
    [
      "/gemini-enterprise-agent-platform/models/standard-paygo",
      [/rolling 30-day period/, /usage tier system/, /Baseline Throughput/],
      "Vertex Standard PayGo reference drifted",
    ],
    [
      "/gemini-enterprise-agent-platform/models/flex-paygo",
      [
        /50% discount compared to Standard PayGo/,
        /X-Vertex-AI-LLM-Shared-Request-Type: flex/,
        /ON_DEMAND_FLEX/,
      ],
      "Vertex Flex PayGo reference drifted",
    ],
    [
      "/gemini-enterprise-agent-platform/models/priority-paygo",
      [
        /X-Vertex-AI-LLM-Shared-Request-Type: priority/,
        /ON_DEMAND_PRIORITY/,
        /may be downgraded to Standard PayGo and is charged at Standard PayGo rates/,
      ],
      "Vertex Priority PayGo reference drifted",
    ],
    [
      "/gemini-enterprise-agent-platform/models/provisioned-throughput/use-provisioned-throughput",
      [
        /X-Vertex-AI-LLM-Request-Type.*dedicated/,
        /X-Vertex-AI-LLM-Request-Type.*shared/,
        /entire request is processed as an on-demand request by default and is billed at the pay-as-you-go rate/,
      ],
      "Vertex Provisioned Throughput routing reference drifted",
    ],
    [
      "/gemini-enterprise-agent-platform/models/provisioned-throughput/measure-provisioned-throughput",
      [/specific to a project, region, model, and version/, /burndown rate/],
      "Vertex Provisioned Throughput accounting reference drifted",
    ],
    [
      "/billing/docs/how-to/get-pricing-information-api",
      [/custom prices associated with your Cloud Billing account/],
      "Google Cloud account pricing reference drifted",
    ],
    [
      "/billing/docs/how-to/export-data-bigquery-tables/standard-usage",
      [
        /cost details are available within a day.*more than 24 hours/,
        /effective_price.*negotiated discounts/,
      ],
      "Google Cloud cost export reference drifted",
    ],
  ],
  "vertex-partner-models": [
    [
      "/gemini-enterprise-agent-platform/models/partner-models/claude/use-claude",
      [
        /publishers\/anthropic\/models\/MODEL:rawPredict/,
        /publishers\/anthropic\/models\/MODEL:streamRawPredict/,
        /"usage".*"input_tokens".*"output_tokens"/,
      ],
      "Vertex Claude prediction reference drifted",
    ],
    [
      "/gemini-enterprise-agent-platform/models/partner-models/claude/web-search",
      [
        /cache_creation_input_tokens.*cache_read_input_tokens/,
        /web_search_requests/,
        /priced as an add-on to standard messages API usage/,
      ],
      "Vertex Claude web-search accounting reference drifted",
    ],
    [
      "/gemini-enterprise-agent-platform/models/partner-models/grok/responses",
      [
        /\/v1\/projects\/PROJECT_ID\/locations\/global\/endpoints\/openapi\/responses/,
        /input_tokens_details.*cached_tokens/,
        /output_tokens_details.*reasoning_tokens/,
        /traffic_type.*ON_DEMAND/,
      ],
      "Vertex Grok Responses reference drifted",
    ],
    [
      "/gemini-enterprise-agent-platform/models/partner-models/llama/use-llama",
      [
        /\/v1beta1\/projects\/PROJECT_ID\/locations\/LOCATION\/endpoints\/openapi\/chat\/completions/,
      ],
      "Vertex Llama Chat Completions reference drifted",
    ],
  ],
  "vertex-open-models": [
    [
      "/gemini-enterprise-agent-platform/models/maas/call-open-model-apis",
      [
        /\/v1\/projects\/PROJECT_ID\/locations\/LOCATION\/endpoints\/openapi\/chat\/completions/,
        /completion_tokens/,
        /prompt_tokens/,
        /total_tokens/,
        /There is no price difference with the regional endpoints when you use the global endpoint/,
      ],
      "Vertex open-model Chat Completions reference drifted",
    ],
    [
      "/gemini-enterprise-agent-platform/models/embeddings/get-text-embeddings",
      [/publishers\/google\/models\/\$\{MODEL_ID\}:predict/],
      "Vertex text embedding reference drifted",
    ],
  ],
};

const months = new Map([
  ["Jan", "01"],
  ["Feb", "02"],
  ["Mar", "03"],
  ["Apr", "04"],
  ["May", "05"],
  ["Jun", "06"],
  ["Jul", "07"],
  ["Aug", "08"],
  ["Sep", "09"],
  ["Oct", "10"],
  ["Nov", "11"],
  ["Dec", "12"],
]);
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

function cellText(cell: Selection): string {
  const clone = cell.clone();
  clone.find("br").replaceWith(" ");
  return text(clone.text());
}

function texts($: LoadedDocument, selection: Selection): string[] {
  return selection.map((_index, element) => text($(element).text())).get();
}

function tableHeaders($: LoadedDocument, table: Selection): string[] {
  return texts($, table.find("tr").first().find("th,td"));
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function reference(
  documents: LinkedDocument[],
  path: string,
  patterns: readonly RegExp[],
  message: string,
): void {
  const document = documents.find((item) => new URL(item.url).pathname === path);
  const value = document === undefined ? "" : text(load(document.body)("main").text());
  if (document === undefined || patterns.some((pattern) => !pattern.test(value)))
    throw new Error(message);
}

function validateEndpointReferences(sourceId: string, documents: LinkedDocument[]): void {
  for (const [path, patterns, message] of endpointReferences[sourceId] ?? [])
    reference(documents, path, patterns, message);
}

function validateDiscovery(sourceId: string, documents: LinkedDocument[]): void {
  if (sourceId !== "vertex-google-models") return;
  const document = documents.find((item) => {
    const url = new URL(item.url);
    return (
      url.hostname === "aiplatform.googleapis.com" &&
      url.pathname === "/$discovery/rest" &&
      url.searchParams.get("version") === "v1beta1"
    );
  });
  if (document === undefined) throw new Error("Missing Vertex Discovery document");
  let value: unknown;
  try {
    value = JSON.parse(document.body);
  } catch {
    throw new Error("Vertex Discovery document returned invalid JSON");
  }
  const discovery = vertexDiscoverySchema.parse(value);
  const list = discovery.resources.publishers.resources.models.methods.list;
  if (
    list?.httpMethod !== "GET" ||
    list.path !== "v1beta1/{+parent}/models" ||
    list.response.$ref !== "GoogleCloudAiplatformV1beta1ListPublisherModelsResponse" ||
    !["pageSize", "pageToken", "view", "listAllVersions", "languageCode"].every(
      (field) => list.parameters?.[field] !== undefined,
    )
  )
    throw new Error("Vertex Model Garden inventory contract changed");
  const views = z.object({ enum: z.array(z.string()) }).safeParse(list.parameters?.view);
  if (
    !views.success ||
    ![
      "PUBLISHER_MODEL_VIEW_BASIC",
      "PUBLISHER_MODEL_VIEW_FULL",
      "PUBLISHER_MODEL_VERSION_VIEW_BASIC",
    ].every((view) => views.data.enum.includes(view))
  )
    throw new Error("Vertex Model Garden views changed");

  const publisherFields = discovery.schemas.GoogleCloudAiplatformV1beta1PublisherModel.properties;
  if (
    ![
      "name",
      "launchStage",
      "versionState",
      "versionId",
      "supportedActions",
      "frameworks",
      "openSourceCategory",
      "predictSchemata",
    ].every((field) => publisherFields[field] !== undefined)
  )
    throw new Error("Vertex PublisherModel schema changed");
  const listFields =
    discovery.schemas.GoogleCloudAiplatformV1beta1ListPublisherModelsResponse.properties;
  if (listFields.publisherModels === undefined || listFields.nextPageToken === undefined)
    throw new Error("Vertex Model Garden pagination schema changed");

  const methods =
    discovery.resources.projects.resources.locations.resources.publishers.resources.models.methods;
  const routes = new Map<string, string>([
    ["generateContent", "v1beta1/{+model}:generateContent"],
    ["streamGenerateContent", "v1beta1/{+model}:streamGenerateContent"],
    ["embedContent", "v1beta1/{+model}:embedContent"],
    ["countTokens", "v1beta1/{+endpoint}:countTokens"],
    ["predict", "v1beta1/{+endpoint}:predict"],
    ["predictLongRunning", "v1beta1/{+endpoint}:predictLongRunning"],
    ["rawPredict", "v1beta1/{+endpoint}:rawPredict"],
    ["streamRawPredict", "v1beta1/{+endpoint}:streamRawPredict"],
  ]);
  for (const [name, path] of routes) {
    const method = methods[name];
    if (method?.httpMethod !== "POST" || method.path !== path)
      throw new Error(`Vertex ${name} Discovery route changed`);
  }

  const usageFields =
    discovery.schemas.GoogleCloudAiplatformV1beta1GenerateContentResponseUsageMetadata.properties;
  if (
    ![
      "promptTokenCount",
      "cachedContentTokenCount",
      "candidatesTokenCount",
      "totalTokenCount",
      "toolUsePromptTokenCount",
      "thoughtsTokenCount",
      "promptTokensDetails",
      "cacheTokensDetails",
      "candidatesTokensDetails",
      "toolUsePromptTokensDetails",
      "trafficType",
    ].every((field) => usageFields[field] !== undefined)
  )
    throw new Error("Vertex usage schema changed");
  const trafficTypes = z.object({ enum: z.array(z.string()) }).safeParse(usageFields.trafficType);
  if (
    !trafficTypes.success ||
    ![
      "ON_DEMAND",
      "ON_DEMAND_PRIORITY",
      "ON_DEMAND_FLEX",
      "ON_DEMAND_OFFPEAK",
      "PROVISIONED_THROUGHPUT",
    ].every((trafficType) => trafficTypes.data.enum.includes(trafficType))
  )
    throw new Error("Vertex usage traffic types changed");

  const groundingFields =
    discovery.schemas.GoogleCloudAiplatformV1beta1GroundingMetadata.properties;
  if (
    !["webSearchQueries", "imageSearchQueries", "groundingChunks", "groundingSupports"].every(
      (field) => groundingFields[field] !== undefined,
    )
  )
    throw new Error("Vertex grounding schema changed");
  const responseFields =
    discovery.schemas.GoogleCloudAiplatformV1beta1GenerateContentResponse.properties;
  if (
    !["usageMetadata", "modelVersion", "responseId", "createTime", "candidates"].every(
      (field) => responseFields[field] !== undefined,
    )
  )
    throw new Error("Vertex response observability schema changed");
}

function modelDate(value: string): string | undefined {
  const iso = value.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
  if (iso !== undefined) return iso;
  const match = value.match(/\b([A-Z][a-z]{2,8}) (\d{1,2}), (\d{4})\b/);
  const month = match?.[1] === undefined ? undefined : months.get(match[1].slice(0, 3));
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

function section($: LoadedDocument, heading: Selection): Selection {
  if (heading.length === 0) return $(".devsite-article-body");
  const level = Number(heading.prop("tagName")?.slice(1));
  const boundary = Number.isInteger(level)
    ? Array.from({ length: Math.max(level - 1, 1) }, (_value, index) => `h${index + 2}`).join(",")
    : "h2";
  return heading.add(heading.nextUntil(boundary));
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
  if (match === null) return undefined;
  const raw = match[1];
  if (raw === undefined) return undefined;
  const capturedUnit = match[2]?.toLowerCase();
  const next = value[(match.index ?? 0) + match[0].length];
  const unit =
    capturedUnit?.length === 1 && next !== undefined && /[a-z]/i.test(next)
      ? undefined
      : capturedUnit;
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
  const sequenceCell = rowCell($, table, /^Maximum sequence length$/i);
  const value = text(
    [
      rowCell($, table, /^Token limits$/i),
      rowCell($, table, /^Quotas?(?: limits?)?$/i),
      sequenceCell,
      outputCell,
      rowCell($, table, /^Output dimensions$/i),
    ]
      .flatMap((cell) => (cell === undefined ? [] : [cell.text()]))
      .join(" "),
  );
  const context =
    tokens(text(sequenceCell?.text() ?? ""), /([\d,.]+)\s*(K|M|thousand|million)?/i) ??
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
      /(?:Maximum output tokens|Max output)\s*(?:is|of|:|-)?\s*([\d,.]+)\s*(K|M|thousand|million)?/i,
    ) ??
    tokens(
      value,
      /([\d,.]+)\s*(K|M|thousand|million)?\s+(?:maximum output tokens|maximum output|max output)/i,
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

function modelTasks(
  id: string,
  name: string,
  observed: ProviderModel["modalities"],
  features: ProviderModel["capabilities"],
): ModelTask[] {
  const value = `${id} ${name}`.toLowerCase();
  const result: ModelTask[] = [];
  const ocr = /\bocr\b/.test(value);
  const live =
    observed.input.includes("audio") &&
    observed.output.includes("audio") &&
    /\blive\b|\brealtime\b|\bomni\b/.test(value);
  if (observed.output.includes("embedding") || /\bembedding/.test(value)) result.push("embeddings");
  if (observed.output.includes("video")) result.push("video_generation");
  if (observed.output.includes("image")) result.push("image_generation");
  if (observed.output.includes("audio")) {
    if (/\blyria\b|\bmusic\b/.test(value)) result.push("audio_generation");
    else if (live) result.push("speech_to_speech");
    else if (/\btts\b|text-to-speech/.test(value)) result.push("speech_synthesis");
  }
  if (ocr) result.push("ocr");
  else if (observed.output.includes("text")) result.push("text_generation");
  if (features.computer_use === true) result.push("text_generation");
  return orderedTasks(result);
}

function regions($: LoadedDocument, table: Selection): ProviderModel["availability"] {
  const values: string[] = [];
  table.find("tr").each((_index, row) => {
    const cells = $(row).find("th,td");
    if (
      cells.length < 2 ||
      !/^(?:Supported regions|Model availability)(?:\s*\(.*\))?$/i.test(text(cells.eq(0).text()))
    )
      return;
    const cell = cells.slice(1);
    const groups = cell.find(".geap-region");
    if (groups.length > 0) {
      groups.each((_groupIndex, group) => {
        const item = $(group);
        const area = text(item.children("li").first().text()).toLowerCase();
        item.find("code").each((_codeIndex, code) => {
          const value = text($(code).text());
          if (/^global endpoint$/i.test(value)) values.push("global");
          else if (/^multi-region$/i.test(value) && area === "united states") values.push("us");
          else if (/^multi-region$/i.test(value) && area === "europe") values.push("eu");
          else if (/^(?:global|us|eu|[a-z]+-[a-z]+\d)$/i.test(value)) values.push(value);
        });
      });
      return;
    }
    cell.find("code").each((_codeIndex, code) => {
      const value = text($(code).text());
      if (/^global endpoint$/i.test(value)) values.push("global");
      else if (/^(?:global|us|eu|[a-z]+-[a-z]+\d)$/i.test(value)) values.push(value);
    });
  });
  const observed = unique(values);
  return observed.length === 0
    ? undefined
    : observed.map((region) => ({ region, deployment_type: "managed_api" }));
}

function pageName(title: string, heading: string, count: number): string {
  if (count === 1 || heading === "") return title;
  if (/deprecations?/i.test(title)) return heading;
  const first = title.split(" ")[0] ?? title;
  return /^\d/.test(heading) ? `${first} ${heading}` : `${title} ${heading}`;
}

function description($: LoadedDocument, heading: Selection): string | undefined {
  const scoped = section($, heading).filter("p").first();
  const value = text(scoped.text()) || text($(".devsite-article-body > p").first().text());
  return value || undefined;
}

function publisherFamily(
  $: LoadedDocument,
  sourceId: string,
  scope: Selection,
): ProviderModel["service_families"] {
  if (sourceId === "vertex-google-models") return ["publishers/google"];
  const publishers = unique(
    scope
      .find("a[href]")
      .addBack("a[href]")
      .map(
        (_index, element) =>
          ($(element).attr("href") ?? "").match(
            /^https:\/\/console\.cloud\.google\.com\/agent-platform\/publishers\/([a-z0-9-]+)\/model-garden\//,
          )?.[1],
      )
      .get()
      .filter((value): value is string => value !== undefined),
  );
  if (publishers.length > 1) throw new Error("Vertex model card publisher drifted");
  return publishers[0] === undefined ? undefined : [`publishers/${publishers[0]}`];
}

function modelEndpoints(
  sourceId: string,
  path: string,
  $: LoadedDocument,
  model: ProviderModel,
): ProviderModel["api_endpoints"] {
  if (sourceId === "vertex-google-models") {
    if (/\/models\/gemini\//.test(path)) {
      if (
        $(".devsite-article-body a[href]").is(
          '[href="/gemini-enterprise-agent-platform/models/embeddings/get-multimodal-embeddings"]',
        )
      )
        return [endpoints.embedding];
      return model.tasks.includes("speech_to_speech") ? undefined : [endpoints.generate];
    }
    if (/\/models\/veo\//.test(path)) return [endpoints.video];
    if (/\/models\/(?:lyria|imagen)\//.test(path)) return [endpoints.predict];
  }
  if (sourceId === "vertex-partner-models") {
    if (/\/partner-models\/claude\//.test(path)) return [endpoints.claude, endpoints.claudeStream];
    if (/\/partner-models\/grok\//.test(path)) return [endpoints.grok];
    if (/\/partner-models\/llama\//.test(path)) return [endpoints.llama];
  }
  return undefined;
}

function mergeEndpoints(...values: ProviderModel["api_endpoints"][]): ApiEndpoint[] {
  return [
    ...new Map(
      values
        .flatMap((value) => value ?? [])
        .map((endpoint) => [apiEndpointKey(endpoint), endpoint]),
    ).values(),
  ].sort((left, right) => apiEndpointKey(left).localeCompare(apiEndpointKey(right)));
}

function mergeAvailability(
  ...values: ProviderModel["availability"][]
): NonNullable<ProviderModel["availability"]> {
  return [
    ...new Map(
      values
        .flatMap((value) => value ?? [])
        .map((item) => [`${item.region}\0${item.deployment_type}`, item]),
    ).values(),
  ];
}

function mergeEvidence(current: Evidence | undefined, incoming: Evidence): Evidence {
  if (current === undefined) return incoming;
  const model = current.model;
  const next = incoming.model;
  model.name =
    model.name === model.model_id && next.name !== next.model_id ? next.name : model.name;
  model.description ??= next.description;
  model.tasks = orderedTasks([...model.tasks, ...next.tasks]);
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
  if (model.release_stage === "unknown") model.release_stage = next.release_stage;
  model.replacement_model_ids = unique([
    ...model.replacement_model_ids,
    ...next.replacement_model_ids,
  ]);
  const families = unique([
    ...(model.service_families ?? []),
    ...(next.service_families ?? []),
  ]).sort();
  model.service_families = families.length === 0 ? undefined : families;
  const endpointValues = mergeEndpoints(model.api_endpoints, next.api_endpoints);
  model.api_endpoints = endpointValues.length === 0 ? undefined : endpointValues;
  model.availability = mergeAvailability(model.availability, next.availability);
  return { model, names: new Set([...current.names, ...incoming.names]) };
}

function add(models: Map<string, Evidence>, evidence: Evidence): void {
  models.set(evidence.model.model_id, mergeEvidence(models.get(evidence.model.model_id), evidence));
}

function parseIndexInventory(models: Map<string, Evidence>, input: Input, body: string): void {
  if (input.source.id === "vertex-google-models") return;
  const $ = load(body);
  const rows = new Map<
    string,
    { publisher: string; name: string; cells: string[]; headers: string[] }[]
  >();
  $(".devsite-article-body a[href]").each((_index, element) => {
    const match = ($(element).attr("href") ?? "").match(
      /^https:\/\/console\.cloud\.google\.com\/agent-platform\/publishers\/([a-z0-9-]+)\/model-garden\/([a-z0-9][a-z0-9._@-]*)$/,
    );
    const publisher = match?.[1];
    const id = match?.[2];
    if (publisher === undefined || id === undefined || !modelIdSchema.safeParse(id).success) return;
    const row = $(element).closest("tr");
    const cells = texts($, row.find("th,td"));
    const name = cells[0];
    if (name === undefined || name === "") return;
    const headers = tableHeaders($, row.closest("table"));
    const current = rows.get(id) ?? [];
    current.push({ publisher, name, cells, headers });
    rows.set(id, current);
  });
  for (const [id, candidates] of rows) {
    const identities = unique(candidates.map(({ publisher, name }) => `${publisher}\0${name}`));
    if (identities.length !== 1) continue;
    const candidate = candidates[0];
    if (candidate === undefined) continue;
    const modalityIndex = candidate.headers.findIndex((value) => /^Modality$/i.test(value));
    const type = modalityIndex < 0 ? "" : (candidate.cells[modalityIndex] ?? "");
    const isEmbedding = candidate.headers.some((value) => /^Output dimensions$/i.test(value));
    const modelInput: Modality[] = [];
    if (/\bLanguage\b|\bCode\b/i.test(type) || isEmbedding) modelInput.push("text");
    if (/\bVision\b/i.test(type)) modelInput.push("image");
    const observedModalities: ProviderModel["modalities"] = {
      input: modelInput,
      output: isEmbedding ? ["embedding"] : /\bLanguage\b|\bCode\b/i.test(type) ? ["text"] : [],
    };
    const observedCapabilities = unknownCapabilities();
    const descriptionIndex = candidate.headers.findIndex((value) => /^Description$/i.test(value));
    const model = {
      ...baseModel({
        providerId: input.provider.id,
        id,
        name: candidate.name,
        sourceId: input.source.id,
        observedAt: input.observedAt,
      }),
      description:
        descriptionIndex < 0 ? undefined : candidate.cells[descriptionIndex] || undefined,
      tasks: modelTasks(id, candidate.name, observedModalities, observedCapabilities),
      service_families: [`publishers/${candidate.publisher}`],
      modalities: observedModalities,
      capabilities: observedCapabilities,
      scope: "regional_catalog",
    } satisfies ProviderModel;
    add(models, { model, names: new Set([id, candidate.name]) });
  }
}

function applyReplacementTables(models: Map<string, Evidence>, $: LoadedDocument): void {
  $(".devsite-article-body table").each((_index, tableElement) => {
    const table = $(tableElement);
    const headers = tableHeaders($, table);
    if (
      !/^Discontinued (?:model )?endpoints?$/i.test(headers[0] ?? "") ||
      !/^(?:Recommended )?(?:endpoint )?(?:migration|replacement)$/i.test(headers[1] ?? "")
    )
      return;
    table
      .find("tr")
      .slice(1)
      .each((_rowIndex, row) => {
        const cells = $(row).find("th,td");
        const id = text(cells.eq(0).find("code").first().text());
        const replacement = text(cells.eq(1).find("code").first().text());
        const model = models.get(id)?.model;
        if (
          model === undefined ||
          replacement === id ||
          !modelIdSchema.safeParse(replacement).success
        )
          return;
        model.replacement_model_ids = unique([...model.replacement_model_ids, replacement]);
      });
  });
}

function parseModelTables(
  models: Map<string, Evidence>,
  input: Input,
  path: string,
  body: string,
): boolean {
  const $ = load(body);
  const tables = $(".devsite-article-body table").filter((_index, table) => {
    const cells = $(table).find("tr").first().find("th,td");
    return /^Model ID$/i.test(text(cells.eq(0).text()));
  });
  const title = text($("h1").first().clone().children().remove().end().text());
  let parsed = false;
  tables.each((_index, tableElement) => {
    const table = $(tableElement);
    const idCell = rowCell($, table, /^Model ID$/i);
    const id = text(idCell?.find("code").first().text() ?? idCell?.text() ?? "");
    if (!modelIdSchema.safeParse(id).success) return;
    const heading = table.prevAll("h2,h3,h4").first();
    const headingText = text(heading.clone().children().remove().end().text());
    const publisherScope = tables.length === 1 ? $(".devsite-article-body") : section($, heading);
    const name = pageName(title || id, headingText, tables.length);
    const observedModalities = modalities($, table);
    const observedCapabilities = capabilities($, table);
    const versionText = text(rowCell($, table, /^Versions$/i)?.text() ?? "");
    const launchText = `${text(rowCell($, table, /^Launch stage$/i)?.text() ?? "")} ${versionText}`;
    const modelStatus = modelStateFromLabel(launchText);
    const model = {
      ...baseModel({
        providerId: input.provider.id,
        id,
        name,
        sourceId: input.source.id,
        observedAt: input.observedAt,
      }),
      description: description($, heading),
      tasks: modelTasks(id, name, observedModalities, observedCapabilities),
      service_families: publisherFamily($, input.source.id, publisherScope),
      modalities: observedModalities,
      capabilities: observedCapabilities,
      limits: limits($, table),
      release_date: modelDate(versionText),
      ...modelStatus,
      availability: regions($, table),
      scope: "regional_catalog",
    } satisfies ProviderModel;
    model.api_endpoints = modelEndpoints(input.source.id, path, $, model);
    const sectionText = text(section($, heading).text());
    const deprecated =
      versionText.match(/Deprecation date\s*:?\s*([A-Z][a-z]{2,8} \d{1,2}, \d{4})/i)?.[1] ??
      sectionText.match(/deprecated as of ([A-Z][a-z]{2,8} \d{1,2}, \d{4})/i)?.[1];
    const retired =
      versionText.match(
        /(?:Discontinuation|Retirement|Shutdown) date\s*:?\s*([A-Z][a-z]{2,8} \d{1,2}, \d{4})/i,
      )?.[1] ??
      sectionText.match(
        /(?:shut down|shutdown|discontinued) (?:on|as of) ([A-Z][a-z]{2,8} \d{1,2}, \d{4})/i,
      )?.[1];
    if (deprecated !== undefined) model.deprecated_at = modelDate(deprecated);
    if (retired !== undefined) model.retired_at = modelDate(retired);
    if (model.retired_at !== undefined && model.retired_at <= input.observedAt.slice(0, 10))
      model.status = "retired";
    else if (model.deprecated_at !== undefined) model.status = "deprecated";
    const versionNames = versionText
      ? (rowCell($, table, /^Versions$/i)
          ?.find("code")
          .map((_codeIndex, code) => text($(code).text()))
          .get()
          .filter((value) => modelIdSchema.safeParse(value).success) ?? [])
      : [];
    add(models, { model, names: new Set([name, ...versionNames]) });
    parsed = true;
  });
  applyReplacementTables(models, $);
  return parsed;
}

function lifecycleOperations(section: string): ModelTask[] {
  const lower = section.toLowerCase();
  if (lower.includes("embedding")) return ["embeddings"];
  if (lower.includes("image")) return ["image_generation"];
  if (lower.includes("veo")) return ["video_generation"];
  return ["text_generation"];
}

function ensure(
  models: Map<string, Evidence>,
  input: Input,
  id: string,
  tasks: ModelTask[],
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
    tasks,
    service_families:
      input.source.id === "vertex-google-models" ? ["publishers/google"] : undefined,
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
    const headers = tableHeaders($, table);
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
        const item = ensure(models, input, id, lifecycleOperations(section)).model;
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
        } else if (item.status === "unknown") {
          item.status = "active";
        }
      });
  });
}

function priceName(value: string): string {
  return value
    .replace(/\((?:Promotional Price|Standard Price|Deprecated)[^)]*\)/gi, " ")
    .replace(/\bon Google Cloud\b/gi, " ")
    .replace(
      /\bGemini (\d+(?:\.\d+)?) Flash with Gemini Live API native audio\b/gi,
      "Gemini Live $1 Flash Native Audio",
    )
    .replace(/\bwith Gemini Live API\b/gi, "Live API")
    .replace(/\b(\d+)\.0\b/g, "$1")
    .replace(/[^a-z0-9]+/gi, "")
    .toLowerCase();
}

function priceNames(value: string): string[] {
  return unique([
    priceName(value),
    priceName(
      value.replace(/\(([^)]*)\)/g, (match, inner: string) => (/\d/.test(inner) ? match : " ")),
    ),
  ]).filter((item) => item !== "");
}

function priceKeys(item: Evidence): Set<string> {
  const values = new Set(item.names);
  let id = item.model.model_id;
  values.add(id);
  id = id.replace(/-maas$/, "");
  values.add(id);
  while (/(?:-\d{3}|-preview|-generate)$/.test(id)) {
    id = id.replace(/(?:-\d{3}|-preview|-generate)$/, "");
    values.add(id);
  }
  return new Set([...values].flatMap(priceNames));
}

function priceTargets(models: Map<string, Evidence>, label: string, hint = ""): ProviderModel[] {
  const labelKeys = priceNames(label);
  if (labelKeys.length === 0) return [];
  const entries = [...models.values()].map((item) => ({ item, keys: priceKeys(item) }));
  let candidates = entries.filter(({ keys }) => labelKeys.some((key) => keys.has(key)));
  const exact = candidates.length > 0;
  if (!exact) {
    const related = entries
      .map((entry) => ({
        ...entry,
        score: Math.max(
          0,
          ...[...entry.keys]
            .filter((candidate) =>
              labelKeys.some(
                (key) => /\d/.test(key) && (candidate.startsWith(key) || candidate.endsWith(key)),
              ),
            )
            .map((candidate) => candidate.length),
        ),
      }))
      .filter(({ score }) => score > 0);
    const best = Math.max(0, ...related.map(({ score }) => score));
    candidates = related.filter(({ score }) => score === best);
  }
  const hintKey =
    priceName(hint) ||
    ["fast", "ultra", "lite", "clip", "pro"].find((variant) =>
      new RegExp(`\\b${variant}\\b`, "i").test(label),
    ) ||
    "";
  if (hintKey !== "" && candidates.length > 1) {
    const hinted = candidates.filter(({ keys }) =>
      [...keys].some((candidate) => candidate.includes(hintKey)),
    );
    if (hinted.length > 0) candidates = hinted;
  } else if (candidates.length > 1) {
    const base = candidates.filter(
      ({ item }) => !/(?:^|-)(?:fast|ultra|lite|clip)(?:-|$)/.test(item.model.model_id),
    );
    if (base.length > 0) candidates = base;
  }
  return exact || candidates.length === 1 ? candidates.map(({ item }) => item.model) : [];
}

function applyEmbeddingReference(models: Map<string, Evidence>, body: string): void {
  const $ = load(body);
  $(".devsite-article-body table").each((_index, tableElement) => {
    const table = $(tableElement);
    const headers = tableHeaders($, table);
    const sequenceIndex = headers.findIndex((value) =>
      /^Max(?:imum)? sequence length$/i.test(value),
    );
    if (!/^Model name$/i.test(headers[0] ?? "") || sequenceIndex < 0) return;
    table
      .find("tr")
      .slice(1)
      .each((_rowIndex, row) => {
        const cells = $(row).find("th,td");
        const label = text(cells.eq(0).find("code").first().text() || cells.eq(0).text());
        const targets = priceTargets(models, label).filter((model) =>
          model.tasks.includes("embeddings"),
        );
        if (targets.length === 0) return;
        const context = tokens(
          text(cells.eq(sequenceIndex).text()),
          /([\d,.]+)\s*(K|M|thousand|million)?/i,
        );
        for (const model of targets) {
          if (context !== undefined) {
            model.limits.context_tokens ??= context;
            model.limits.max_input_tokens ??= context;
          }
          model.api_endpoints = mergeEndpoints(model.api_endpoints, [endpoints.predict]);
        }
      });
  });
  $(".devsite-article-body pre").each((_index, element) => {
    const value = text($(element).text());
    for (const match of value.matchAll(
      /https:\/\/[a-z0-9-]*aiplatform\.googleapis\.com\/v1\/projects\/[^/]+\/locations\/(global|[a-z]+-[a-z]+\d)\/publishers\/google\/models\/([a-z0-9][a-z0-9._@-]*):predict/gi,
    )) {
      const region = match[1];
      const id = match[2];
      const model = id === undefined ? undefined : models.get(id)?.model;
      if (region === undefined || model === undefined || !model.tasks.includes("embeddings"))
        continue;
      model.availability = mergeAvailability(model.availability, [
        { region, deployment_type: "managed_api" },
      ]);
    }
  });
}

function meters(descriptor: string, cached: boolean): SourcePriceFact["meter"][] {
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

function pricingEvidenceKey(modelId: string, meter: SourcePriceFact["meter"]): string {
  return `${modelId}\0${meter}`;
}

function embeddedPriceTarget(
  models: Map<string, Evidence>,
  label: string,
): ProviderModel | undefined {
  const normalized = priceName(label);
  const candidates = [...models.values()]
    .map((item) => ({
      item,
      score: Math.max(
        0,
        ...[...priceKeys(item)]
          .filter((key) => key.length >= 8 && normalized.includes(key))
          .map((key) => key.length),
      ),
    }))
    .filter(({ score }) => score > 0);
  const best = Math.max(0, ...candidates.map(({ score }) => score));
  const matched = candidates.filter(({ score }) => score === best);
  return matched.length === 1 ? matched[0]?.item.model : undefined;
}

function pageTokenEquivalence(value: string): PageTokenEquivalence | undefined {
  if (!/\b(?:1|one) page\s*=/i.test(value)) return undefined;
  const inputTokensPerPage = tokens(value, /([\d,.]+)\s*(K|M|thousand|million)?\s+input tokens/i);
  const outputTokensPerPage = tokens(value, /([\d,.]+)\s*(K|M|thousand|million)?\s+output tokens/i);
  return inputTokensPerPage === undefined || outputTokensPerPage === undefined
    ? undefined
    : { inputTokensPerPage, outputTokensPerPage };
}

// SKU-group names corroborate meter identity only; numeric rates come from the Vertex price book.
function pricingEvidence(
  models: Map<string, Evidence>,
  documents: LinkedDocument[],
  sourceId: string,
): PricingEvidence {
  const skuUnits = new Map<string, Set<SourcePriceFact["unit"] | undefined>>();
  const pageTokenEquivalences = new Map<string, PageTokenEquivalence>();
  const expectedSkuGroups = new Set(["/skus/sku-groups/gen-ai", "/skus/sku-groups/gen-ai-v2"]);
  const observedSkuGroups = new Set<string>();
  for (const document of documents) {
    const documentPath = new URL(document.url).pathname;
    const isSkuGroup = expectedSkuGroups.has(documentPath);
    let skuRows = 0;
    const $ = load(document.body);
    $(".devsite-article-body table").each((_index, tableElement) => {
      const table = $(tableElement);
      const idCell = rowCell($, table, /^Model ID$/i);
      const quotaCell = rowCell($, table, /^Quotas?(?: limits?)?$/i);
      const id = text(idCell?.find("code").first().text() ?? idCell?.text() ?? "");
      const equivalence = pageTokenEquivalence(text(quotaCell?.text() ?? ""));
      if (modelIdSchema.safeParse(id).success && equivalence !== undefined)
        pageTokenEquivalences.set(id, equivalence);
    });
    $("table").each((_index, tableElement) => {
      const table = $(tableElement);
      const headers = tableHeaders($, table);
      const serviceIndex = headers.findIndex((header) => /^Service Name$/i.test(header));
      const nameIndex = headers.findIndex((header) => /^SKU Name$/i.test(header));
      const idIndex = headers.findIndex((header) => /^SKU ID$/i.test(header));
      if (serviceIndex < 0 || nameIndex < 0 || idIndex < 0) return;
      table
        .find("tr")
        .slice(1)
        .each((_rowIndex, row) => {
          const cells = $(row).find("th,td");
          const service = text(cells.eq(serviceIndex).text());
          const skuName = text(cells.eq(nameIndex).text());
          const skuId = text(cells.eq(idIndex).text());
          if (!isSkuGroup) return;
          if (
            !/^Vertex AI\s*\(C7E2-9256-1C43\)$/.test(service) ||
            skuName === "" ||
            !/^[0-9A-F]{4}(?:-[0-9A-F]{4}){2}$/.test(skuId)
          )
            throw new Error("Vertex billing SKU group contract changed");
          skuRows += 1;
          const target = embeddedPriceTarget(models, skuName);
          if (target === undefined) return;
          const rateMeters = meters(skuName, false);
          const lower = skuName.toLowerCase();
          const unit: SourcePriceFact["unit"] | undefined = lower.includes("token count")
            ? "million_tokens"
            : lower.includes("second count") || lower.includes("seconds")
              ? "second"
              : undefined;
          for (const meter of rateMeters) {
            const key = pricingEvidenceKey(target.model_id, meter);
            const units = skuUnits.get(key) ?? new Set();
            units.add(unit);
            skuUnits.set(key, units);
          }
        });
    });
    if (isSkuGroup) {
      if (skuRows === 0) throw new Error("Vertex billing SKU group returned no reviewed rows");
      observedSkuGroups.add(documentPath);
    }
  }
  if (
    sourceId === "vertex-google-models" &&
    [...expectedSkuGroups].some((path) => !observedSkuGroups.has(path))
  )
    throw new Error("Missing Vertex billing SKU group");
  const canonicalUnits = new Map<string, SourcePriceFact["unit"]>();
  for (const [key, units] of skuUnits) {
    const unit = [...units][0];
    if (units.size === 1 && unit !== undefined) canonicalUnits.set(key, unit);
  }
  return { canonicalUnits, pageTokenEquivalences };
}

function money(value: string): { price: string; scope?: string; serviceTier?: string }[] {
  const results: { price: string; scope?: string; serviceTier?: string }[] = [];
  for (const match of value.matchAll(
    /(?:(Batch|Flex|Online)(?: requests?)?:\s*)?\$(\d+(?:\.\d+)?)(?:\s*\((Global|Non-global)\))?/gi,
  )) {
    if (match[2] === undefined) continue;
    const serviceTier =
      match[1] === undefined
        ? undefined
        : match[1].toLowerCase() === "online"
          ? "standard"
          : match[1].toLowerCase();
    results.push({
      price: match[2],
      ...(match[3] === undefined ? {} : { scope: match[3].toLowerCase() }),
      ...(serviceTier === undefined ? {} : { serviceTier }),
    });
  }
  return results;
}

function addRate(model: ProviderModel, rate: SourcePriceFact, reconcile?: Reconcile): void {
  const key = sourcePriceFactKey(rate);
  const duplicate = model.price_facts.some(
    (item) => sourcePriceFactKey(item) === key && decimalsEqual(item.price, rate.price),
  );
  if (!duplicate) model.price_facts.push(rate);
  reconcile?.({
    disposition: duplicate ? "excluded" : "normalized",
    reason_code: duplicate ? "duplicate_pricing_binding" : "pricing_rate_bound",
    sample: `${model.model_id}: ${rate.meter}`,
  });
}

function tiers(table: Selection, header: string, headers: string[]): (string | undefined)[] {
  if (/Batch API/i.test(header)) return ["batch"];
  if (headers.some((value) => /Batch API/i.test(value)) && /^Price$/i.test(header))
    return ["standard"];
  const value = text(table.prevAll("h3,h4").first().text()).toLowerCase();
  if (value === "standard" || value === "priority") return [value];
  if (value === "flex/batch") return ["flex", "batch"];
  return [undefined];
}

function contextTokenBounds(header: string): SourcePriceFact["conditions"] {
  return {
    ...(/(?:<=|=<)\s*200K/i.test(header) ? { context_max_tokens: 200_000 } : {}),
    ...(/>\s*200K/i.test(header) ? { context_min_tokens: 200_001 } : {}),
  };
}

function excludedPricingTable(table: Selection, headers: string[]): boolean {
  const section = text(table.prevAll("h2,h3,h4").first().text());
  return (
    /^(?:Agents|CodeMender|Model Tuning|AlphaEvolve|Agent Platform Model Optimizer)/i.test(
      section,
    ) || headers.some((header) => /training/i.test(header))
  );
}

function tokenTables(
  models: Map<string, Evidence>,
  sourceId: string,
  $: LoadedDocument,
  reconcile?: Reconcile,
): void {
  $(".devsite-article-body table").each((_index, tableElement) => {
    const table = $(tableElement);
    const headers = tableHeaders($, table);
    const value = text(table.text());
    if (
      excludedPricingTable(table, headers) ||
      headers.some((header) => /storage/i.test(header)) ||
      (!headers.some((header) => /1M tokens|million tokens/i.test(header)) &&
        !/\b1M (?:input|output).*\btokens\b/i.test(value))
    )
      return;
    let current: ProviderModel[] = [];
    table
      .find("tr")
      .slice(1)
      .each((_rowIndex, row) => {
        const cells = $(row).find("th,td");
        if (cells.length === 1) {
          current = priceTargets(models, text(cells.eq(0).text()));
          return;
        }
        const direct = priceTargets(models, text(cells.eq(0).text()));
        if (direct.length > 0) current = direct;
        if (current.length === 0) return;
        const offset = headers.length - cells.length;
        const descriptor = direct.length === 0 ? text(cells.eq(0).text()) : "";
        cells.slice(1).each((cellIndex, cell) => {
          const header = headers[cellIndex + 1 + offset] ?? "";
          const cached = /cached/i.test(header);
          const rateMeters = meters(descriptor, cached);
          if (rateMeters.length === 0) return;
          const raw = cellText($(cell));
          const prices = money(raw);
          if (prices.length === 0 && /^(?:N\/?A|Not available)$/i.test(raw))
            for (const target of current)
              for (const rateMeter of rateMeters)
                reconcile?.({
                  disposition: "explicit_non_numeric",
                  reason_code: "pricing_cell_not_available",
                  sample: `${target.model_id}: ${rateMeter}`,
                });
          for (const item of prices)
            for (const serviceTier of item.serviceTier === undefined
              ? tiers(table, header, headers)
              : [item.serviceTier])
              for (const target of current)
                for (const rateMeter of rateMeters)
                  addRate(
                    target,
                    publishedRate(
                      rateMeter,
                      item.price,
                      "million_tokens",
                      sourceId,
                      `${header}; ${descriptor}; ${raw}`,
                      {
                        service_tier: serviceTier,
                        deployment_scope: item.scope,
                        ...contextTokenBounds(header),
                      },
                    ),
                    reconcile,
                  );
        });
      });
  });
}

function rawRate(
  model: ProviderModel,
  sourceId: string,
  label: string,
  fragment: string,
  conditions: SourcePriceFact["conditions"],
  impact: "base_price" | "informational" = "base_price",
  reconcile?: Reconcile,
): void {
  model.raw_price_facts.push({
    term_key: "unparsed_base_rate",
    impact,
    reason: impact === "base_price" ? "unknown_applicability" : "unsupported_structure",
    conditions,
    source_ref: sourceId,
    raw: { label, fragment },
  });
  reconcile?.({
    disposition: "raw",
    reason_code: impact === "base_price" ? "unparsed_base_rate" : "informational_price_note",
    sample: model.model_id,
  });
}

function groundingNote(
  model: ProviderModel,
  sourceId: string,
  termKey: string,
  label: string,
  fragment: string,
  impact: "allowance" | "informational",
  conditions: SourcePriceFact["conditions"],
  reconcile?: Reconcile,
): void {
  model.raw_price_facts.push({
    term_key: termKey,
    impact,
    reason: "unsupported_structure",
    conditions,
    source_ref: sourceId,
    raw: { label, fragment },
  });
  reconcile?.({
    disposition: "raw",
    reason_code: impact === "allowance" ? "grounding_allowance" : "grounding_billing_note",
    sample: model.model_id,
  });
}

const labeledPricePattern =
  /(5m Batch Cache Write|1h Batch Cache Write|Batch Cache Write|Batch Cache Hit|Batch Input|Batch Output|5m Cache Write|1h Cache Write|Cache Write|Cache Hit|Input|Output):\s*\$(\d+(?:\.\d+)?)/gi;

function labeledCellKey(modelLabel: string, header: string): string {
  return `${priceName(modelLabel)}\0${priceName(header)}\0${JSON.stringify(contextTokenBounds(header))}`;
}

function labeledPrices(fragment: string): LabeledPrice[] {
  return [...fragment.matchAll(labeledPricePattern)].flatMap((match) => {
    const label = match[1];
    const price = match[2];
    return label === undefined || price === undefined || match.index === undefined
      ? []
      : [{ label, price, index: match.index }];
  });
}

function dominantLabeledSequences($: LoadedDocument): ReadonlyMap<string, readonly string[]> {
  const counts = new Map<string, Map<string, { count: number; labels: string[] }>>();
  $(".devsite-article-body table").each((_index, tableElement) => {
    const table = $(tableElement);
    const headers = tableHeaders($, table);
    if (headers[0] !== "Model" || headers.length > 3 || excludedPricingTable(table, headers))
      return;
    table
      .find("tr")
      .slice(1)
      .each((_rowIndex, row) => {
        const cells = $(row).find("th,td");
        const modelLabel = text(cells.eq(0).text());
        cells.slice(1).each((cellIndex, cell) => {
          const header = headers[cellIndex + 1] ?? "";
          const labels = labeledPrices(cellText($(cell))).map(({ label }) => label.toLowerCase());
          if (labels.length === 0) return;
          const key = labeledCellKey(modelLabel, header);
          const signature = labels.join("\0");
          const signatures = counts.get(key) ?? new Map();
          const current = signatures.get(signature);
          signatures.set(signature, { count: (current?.count ?? 0) + 1, labels });
          counts.set(key, signatures);
        });
      });
  });
  const result = new Map<string, readonly string[]>();
  for (const [key, signatures] of counts) {
    const ranked = [...signatures.values()].sort((left, right) => right.count - left.count);
    const best = ranked[0];
    if (best !== undefined && best.count >= 2 && best.count > (ranked[1]?.count ?? 0))
      result.set(key, best.labels);
  }
  return result;
}

function canonicalLabeledFragment(
  fragment: string,
  expected: readonly string[] | undefined,
): { fragment: string; ignoredSuffix?: string } {
  if (expected === undefined) return { fragment };
  const matches = labeledPrices(fragment);
  const labels = matches.map(({ label }) => label.toLowerCase());
  if (
    matches.length <= expected.length ||
    matches.length !== (fragment.match(/\$/g) ?? []).length ||
    !expected.every((label, index) => labels[index] === label) ||
    !labels.slice(expected.length).every((label) => expected.includes(label))
  )
    return { fragment };
  const splitAt = matches[expected.length]?.index;
  if (splitAt === undefined) return { fragment };
  return {
    fragment: text(fragment.slice(0, splitAt)),
    ignoredSuffix: text(fragment.slice(splitAt)),
  };
}

function exactPageAlternatives(fragment: string, equivalence: PageTokenEquivalence): boolean {
  const matches = [
    ...fragment.matchAll(
      /\b(Input|Output):\s*\$(\d+(?:\.\d+)?)\s*\/\s*million tokens\s*\(or\s*\$(\d+(?:\.\d+)?)\s*\/\s*page\)/gi,
    ),
  ];
  return (
    matches.length === 2 &&
    new Set(matches.map((match) => match[1]?.toLowerCase())).size === 2 &&
    matches.every((match) => {
      const label = match[1]?.toLowerCase();
      const tokenPrice = match[2];
      const pagePrice = match[3];
      if (label === undefined || tokenPrice === undefined || pagePrice === undefined) return false;
      const tokensPerPage =
        label === "input" ? equivalence.inputTokensPerPage : equivalence.outputTokensPerPage;
      const expected = scaleDecimal(multiplyDecimal(tokenPrice, String(tokensPerPage)), -6);
      return decimalsEqual(expected, pagePrice);
    })
  );
}

function verifiedDefaultCacheDuplicate(matches: LabeledPrice[]): boolean {
  const bare = matches.filter(({ label }) => /^Cache Write$/i.test(label));
  const fiveMinute = matches.filter(({ label }) => /^5m Cache Write$/i.test(label));
  const oneHour = matches.filter(({ label }) => /^1h Cache Write$/i.test(label));
  return (
    bare.length === 1 &&
    fiveMinute.length === 1 &&
    oneHour.length === 1 &&
    bare[0] !== undefined &&
    fiveMinute[0] !== undefined &&
    decimalsEqual(bare[0].price, fiveMinute[0].price)
  );
}

function labeledTables(
  models: Map<string, Evidence>,
  sourceId: string,
  $: LoadedDocument,
  evidence: PricingEvidence,
  reconcile?: Reconcile,
): void {
  const dominantSequences = dominantLabeledSequences($);
  $(".devsite-article-body table").each((_index, tableElement) => {
    const table = $(tableElement);
    const headers = tableHeaders($, table);
    if (headers[0] !== "Model" || headers.length > 3 || excludedPricingTable(table, headers))
      return;
    const heading = text(table.prevAll("h2,h3,h4").first().text());
    const region = /^(?:Global|US Multi-Region|EU Multi-Region|[a-z]+-[a-z]+\d)$/i.test(heading)
      ? heading
      : undefined;
    table
      .find("tr")
      .slice(1)
      .each((_rowIndex, row) => {
        const cells = $(row).find("th,td");
        const modelLabel = text(cells.eq(0).text());
        const targets = priceTargets(models, modelLabel);
        if (targets.length === 0) return;
        const effective = modelLabel
          .match(/(?:through|beginning) ([A-Z][a-z]+ \d{1,2}(?:st|nd|rd|th)?, \d{4})/i)?.[1]
          ?.replace(/(\d)(?:st|nd|rd|th)/, "$1");
        cells.slice(1).each((cellIndex, cell) => {
          const header = headers[cellIndex + 1] ?? "";
          const originalFragment = cellText($(cell));
          const canonical = canonicalLabeledFragment(
            originalFragment,
            dominantSequences.get(labeledCellKey(modelLabel, header)),
          );
          const fragment = canonical.fragment;
          const matches = labeledPrices(fragment);
          const counts = new Map<string, number>();
          for (const { label } of matches) {
            const key = label.toLowerCase();
            counts.set(key, (counts.get(key) ?? 0) + 1);
          }
          for (const { label: rateLabel, price } of matches) {
            if (
              (/^Cache Write$/i.test(rateLabel) && /\b(?:5m|1h) Cache Write:/i.test(fragment)) ||
              (counts.get(rateLabel.toLowerCase()) ?? 0) > 1
            )
              continue;
            const lower = rateLabel.toLowerCase();
            const rateMeter: SourcePriceFact["meter"] = lower.includes("cache write")
              ? "cache_write_text"
              : lower.includes("cache hit")
                ? "cache_read_text"
                : lower.includes("output")
                  ? "output_text"
                  : "input_text";
            for (const model of targets)
              addRate(
                model,
                publishedRate(
                  rateMeter,
                  price,
                  "million_tokens",
                  sourceId,
                  `${header}; ${rateLabel}`,
                  {
                    region,
                    service_tier: lower.includes("batch") ? "batch" : undefined,
                    ...contextTokenBounds(header),
                    cache_ttl_seconds: lower.startsWith("5m")
                      ? 300
                      : lower.startsWith("1h")
                        ? 3600
                        : undefined,
                    effective_from:
                      /beginning/i.test(modelLabel) && effective !== undefined
                        ? modelDate(effective)
                        : undefined,
                    effective_until:
                      /through/i.test(modelLabel) && effective !== undefined
                        ? modelDate(effective)
                        : undefined,
                    promotion: /promotional/i.test(modelLabel) || undefined,
                  },
                ),
                reconcile,
              );
          }
          const conditions = {
            region,
            ...contextTokenBounds(header),
          };
          const cacheDuplicate =
            matches.some(({ label }) => /^Cache Write$/i.test(label)) &&
            /\b(?:5m|1h) Cache Write:/i.test(fragment);
          const incomplete =
            [...counts.values()].some((count) => count > 1) ||
            (cacheDuplicate && !verifiedDefaultCacheDuplicate(matches));
          const dollarCount = (fragment.match(/\$/g) ?? []).length;
          for (const model of targets) {
            const pageTokenRelation = evidence.pageTokenEquivalences.get(model.model_id);
            const pageAlternativesVerified =
              pageTokenRelation !== undefined && exactPageAlternatives(fragment, pageTokenRelation);
            const accountedDollarCount = matches.length + (pageAlternativesVerified ? 2 : 0);
            if (incomplete || accountedDollarCount !== dollarCount)
              rawRate(
                model,
                sourceId,
                `${modelLabel}; ${header}`,
                fragment,
                conditions,
                "base_price",
                reconcile,
              );
            if (matches.length === 0 && /^(?:N\/?A|Not available)$/i.test(fragment))
              reconcile?.({
                disposition: "explicit_non_numeric",
                reason_code: "pricing_cell_not_available",
                sample: `${model.model_id}: ${header}`.slice(0, 256),
              });
            if (canonical.ignoredSuffix !== undefined)
              rawRate(
                model,
                sourceId,
                `${modelLabel}; ${header}; structurally rejected suffix`,
                canonical.ignoredSuffix,
                conditions,
                "informational",
                reconcile,
              );
          }
        });
      });
  });
}

function storageTables(
  models: Map<string, Evidence>,
  sourceId: string,
  $: LoadedDocument,
  reconcile?: Reconcile,
): void {
  $(".devsite-article-body table").each((_index, tableElement) => {
    const table = $(tableElement);
    const headers = tableHeaders($, table);
    const featureIndex = headers.findIndex((value) => /^Feature$/i.test(value));
    const typeIndex = headers.findIndex((value) => /^Type$/i.test(value));
    if (headers[0] !== "Model" || featureIndex < 0 || typeIndex < 0) return;
    table
      .find("tr")
      .slice(1)
      .each((_rowIndex, row) => {
        const cells = $(row).find("th,td");
        if (!/Context Cache Storage/i.test(text(cells.eq(featureIndex).text()))) return;
        const targets = priceTargets(models, text(cells.eq(0).text()));
        if (targets.length === 0) return;
        const modalities = media(text(cells.eq(typeIndex).text())).filter(
          (modality) => modality !== "pdf" && modality !== "embedding",
        );
        for (let index = typeIndex + 1; index < cells.length; index += 1) {
          const header = headers[index] ?? "";
          const raw = cellText(cells.eq(index));
          for (const item of money(raw))
            for (const modality of modalities.length === 0 ? [undefined] : modalities)
              for (const model of targets)
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
                      ...contextTokenBounds(header),
                    },
                  ),
                  reconcile,
                );
        }
      });
  });
}

function mediaTables(
  models: Map<string, Evidence>,
  sourceId: string,
  $: LoadedDocument,
  reconcile?: Reconcile,
): void {
  $(".devsite-article-body table").each((_index, tableElement) => {
    const table = $(tableElement);
    const headers = tableHeaders($, table);
    const section = text(table.prevAll("h2,h3,h4").first().text());
    if (
      !/^(?:Model|Open Source Model)$/.test(headers[0] ?? "") ||
      !/(Imagen|Veo|Lyria|Embedding)/i.test(section)
    )
      return;
    let current: ProviderModel[] = [];
    let operation = "";
    table
      .find("tr")
      .slice(1)
      .each((_rowIndex, row) => {
        const cells = $(row).find("th,td");
        if (cells.length < 2) return;
        const label = text(cells.eq(0).text());
        const featureIndex = headers.findIndex((value) => /^Feature$/i.test(value));
        const regionIndex = headers.findIndex((value) => /^Region$/i.test(value));
        const resolutionIndex = headers.findIndex((value) => /^Output Resolution$/i.test(value));
        const fullRow = cells.length === headers.length;
        const feature = featureIndex >= 0 && fullRow ? text(cells.eq(featureIndex).text()) : "";
        const hinted = /30 second|clip/i.test(`${feature} ${text($(row).text())}`) ? "clip" : "";
        const rowOperation =
          feature ||
          (/generation|upscal|editing|caption|q&a|recontext|try-on/i.test(label) ? label : "");
        const targets = /Embeddings for Text\s*\(Excluding Gemini Embedding\)/i.test(label)
          ? [...models.values()]
              .map(({ model }) => model)
              .filter(
                (model) =>
                  model.tasks.includes("embeddings") &&
                  model.service_families?.includes("publishers/google") === true &&
                  !model.model_id.startsWith("gemini-embedding"),
              )
          : priceTargets(models, label, hinted);
        if (targets.length > 0) current = targets;
        else if (fullRow) current = [];
        if (rowOperation !== "") operation = rowOperation;
        if (current.length === 0) return;
        const raw = cellText(cells.last());
        const rowText = text($(row).text());
        const unit: SourcePriceFact["unit"] | undefined = /per image|\/image/i.test(rowText)
          ? "image"
          : /\bsong\b/i.test(rowText) || /per \d+ seconds?/i.test(rowText)
            ? "request"
            : /(?:second|\/sec\b)/i.test(rowText)
              ? "second"
              : /frame/i.test(rowText)
                ? "frame"
                : /1M tokens/i.test(rowText)
                  ? "million_tokens"
                  : /1,000 input tokens/i.test(headers.at(-1) ?? "")
                    ? "thousand_tokens"
                    : /1,000 characters/i.test(headers.at(-1) ?? "") ||
                        /1k characters/i.test(rowText)
                      ? "thousand_characters"
                      : undefined;
        if (unit === undefined) return;
        const rateMeter: SourcePriceFact["meter"] = /Imagen/i.test(section)
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
        for (const item of money(raw))
          for (const resolution of resolutions.length === 0 ? [undefined] : resolutions)
            for (const model of current)
              addRate(
                model,
                publishedRate(rateMeter, item.price, unit, sourceId, raw, {
                  operation: operation || undefined,
                  resolution,
                  region:
                    regionIndex >= 0 && fullRow
                      ? text(cells.eq(regionIndex).text()) || undefined
                      : undefined,
                  service_tier: item.serviceTier,
                  audio: /video \+ audio/i.test(operation) || undefined,
                  modality:
                    /input (text|image|video|audio)/i.exec(rowText)?.[1]?.toLowerCase() ??
                    (/Embeddings for Text/i.test(label) ? "text" : undefined),
                }),
                reconcile,
              );
      });
  });
}

function inlineUnitTables(
  models: Map<string, Evidence>,
  sourceId: string,
  $: LoadedDocument,
  evidence: PricingEvidence,
  reconcile?: Reconcile,
): void {
  $(".devsite-article-body table").each((_index, tableElement) => {
    const table = $(tableElement);
    const headers = tableHeaders($, table);
    if (headers.join("\0") !== "Model\0Type\0Price") return;
    let current: ProviderModel[] = [];
    table
      .find("tr")
      .slice(1)
      .each((_rowIndex, row) => {
        const cells = $(row).find("th,td");
        if (cells.length === 1) {
          current = priceTargets(models, text(cells.eq(0).text()));
          return;
        }
        if (current.length === 0) return;
        const descriptor = text(cells.eq(0).text());
        const rateMeters = meters(descriptor, false);
        if (rateMeters.length === 0) return;
        const raw = cellText(cells.last());
        const matches = [...raw.matchAll(/\$(\d+(?:\.\d+)?)/g)];
        const prices: { price: string; unit: SourcePriceFact["unit"] }[] = [];
        for (const [index, match] of matches.entries()) {
          const price = match[1];
          if (price === undefined) continue;
          const start = (match.index ?? 0) + match[0].length;
          const unitText = raw.slice(start, matches[index + 1]?.index ?? raw.length);
          const unit: SourcePriceFact["unit"] | undefined = /1M .*tokens/i.test(unitText)
            ? "million_tokens"
            : /second/i.test(unitText)
              ? "second"
              : undefined;
          if (unit === undefined) continue;
          prices.push({ price, unit });
        }
        for (const model of current)
          for (const meter of rateMeters) {
            const canonicalUnit = evidence.canonicalUnits.get(
              pricingEvidenceKey(model.model_id, meter),
            );
            const canonicalObserved =
              canonicalUnit !== undefined && prices.some(({ unit }) => unit === canonicalUnit);
            const selected = canonicalObserved
              ? prices.filter(({ unit }) => unit === canonicalUnit)
              : prices;
            for (const { price, unit } of selected)
              addRate(model, publishedRate(meter, price, unit, sourceId, raw), reconcile);
            if (canonicalObserved && selected.length < prices.length)
              rawRate(
                model,
                sourceId,
                `${descriptor}; alternate display unit`,
                raw,
                {},
                "informational",
                reconcile,
              );
          }
      });
  });
}

type GeminiPricingGeneration = "gemini-3" | "gemini-2.5" | "gemini-2.0";
type GroundingReferences = Readonly<Record<"search" | "maps" | "data", string>>;

function geminiPricingGeneration(
  $: LoadedDocument,
  table: Selection,
): GeminiPricingGeneration | undefined {
  const headings = table.prevAll("h2,h3");
  for (let index = 0; index < headings.length; index += 1) {
    const heading = text($(headings[index]).text());
    if (/^(?:Agents|CodeMender|Gemini Omni|AlphaEvolve)$/i.test(heading)) return undefined;
    if (/^Gemini 3$/i.test(heading)) return "gemini-3";
    if (/^Gemini 2\.5$/i.test(heading)) return "gemini-2.5";
    if (/^Gemini 2\.0$/i.test(heading)) return "gemini-2.0";
  }
  return undefined;
}

function groundingOperations(label: string): string[] {
  if (/Web Search and Image Search.*Web Grounding/i.test(label))
    return ["google_search", "google_image_search", "web_grounding_enterprise"];
  if (/Web Grounding/i.test(label)) return ["web_grounding_enterprise"];
  if (/Google Maps/i.test(label)) return ["google_maps"];
  if (/your data/i.test(label)) return ["grounding_with_your_data"];
  if (/Google Search/i.test(label)) return ["google_search"];
  return [];
}

function belongsToPricingGeneration(modelId: string, generation: GeminiPricingGeneration): boolean {
  if (generation === "gemini-2.5") return /^gemini-(?:live-)?2\.5(?:[.-])/.test(modelId);
  const pattern = new RegExp(`^${generation.replace(".", "\\.")}(?:[.-])`);
  return pattern.test(modelId);
}

function groundingReferenceTargets(
  models: Map<string, Evidence>,
  body: string,
  reference: string,
  reconcile?: Reconcile,
): ProviderModel[] {
  const $ = load(body);
  const heading = $("h2").filter(
    (_index, element) => text($(element).text()) === "Supported models",
  );
  if (heading.length !== 1)
    throw new Error(`Vertex ${reference} supported-model reference changed`);
  const labels = heading
    .first()
    .nextUntil("h2")
    .find("li")
    .map((_index, item) => text($(item).text()).replace(/\s+preview$/i, " Preview"))
    .get();
  if (labels.length === 0) throw new Error(`Vertex ${reference} supported-model list is empty`);
  const targets = new Map<string, ProviderModel>();
  for (const label of labels) {
    const matches = priceTargets(models, label).filter(
      (model) =>
        model.status !== "retired" &&
        model.service_families?.includes("publishers/google") === true,
    );
    if (matches.length === 0) {
      reconcile?.({
        disposition: "unbound",
        reason_code: "grounding_supported_model_unbound",
        sample: `${reference}: ${label}`.slice(0, 256),
      });
      continue;
    }
    for (const model of matches) targets.set(model.model_id, model);
  }
  return [...targets.values()];
}

function googleGroundingTables(
  models: Map<string, Evidence>,
  sourceId: string,
  $: LoadedDocument,
  references: GroundingReferences,
  reconcile?: Reconcile,
): void {
  const referenceTargets = {
    search: groundingReferenceTargets(models, references.search, "Google Search", reconcile),
    maps: groundingReferenceTargets(models, references.maps, "Google Maps", reconcile),
    data: groundingReferenceTargets(models, references.data, "customer data", reconcile),
  };
  $(".devsite-article-body table").each((_tableIndex, tableElement) => {
    const table = $(tableElement);
    const generation = geminiPricingGeneration($, table);
    if (generation === undefined) return;
    table
      .find("tr")
      .slice(1)
      .each((_rowIndex, row) => {
        const cells = $(row).find("th,td");
        const label = text(cells.eq(0).text());
        const operations = groundingOperations(label);
        if (operations.length === 0) return;
        const fragment = cellText(cells.last());
        const match = fragment.match(
          /\$(\d+(?:\.\d+)?)\s+per\s+(?:1,?000|1000)\s+(search queries|queries|grounded prompts|prompts|requests)/i,
        );
        const price = match?.[1];
        if (price === undefined) {
          reconcile?.({
            disposition: "explicit_non_numeric",
            reason_code: "grounding_price_not_numeric",
            sample: `${generation}: ${label}`.slice(0, 256),
          });
          return;
        }
        for (const operation of operations) {
          const targets = (
            operation === "google_maps"
              ? referenceTargets.maps
              : operation === "grounding_with_your_data"
                ? referenceTargets.data
                : referenceTargets.search
          ).filter((model) => belongsToPricingGeneration(model.model_id, generation));
          if (targets.length === 0) {
            reconcile?.({
              disposition: "excluded",
              reason_code: "grounding_generation_outside_current_catalog",
              sample: `${generation}: ${operation}`,
            });
            continue;
          }
          for (const model of targets) {
            const conditions = { operation };
            addRate(
              model,
              publishedRate(
                "tool_call",
                price,
                generation === "gemini-3" && operation !== "grounding_with_your_data"
                  ? "thousand_search_units"
                  : "thousand_requests",
                sourceId,
                `${label}; ${fragment}`,
                conditions,
              ),
              reconcile,
            );
            if (/at no (?:additional )?charge|at no charge/i.test(fragment))
              groundingNote(
                model,
                sourceId,
                "grounding_allowance",
                label,
                fragment,
                "allowance",
                conditions,
                reconcile,
              );
            if (
              /charged for each individual|only when a prompt successfully returns|Input tokens .* are not charged/i.test(
                fragment,
              )
            )
              groundingNote(
                model,
                sourceId,
                "grounding_billing_rule",
                label,
                fragment,
                "informational",
                conditions,
                reconcile,
              );
          }
        }
      });
  });
  const legacySuccessRule = text($(".devsite-article-body").text()).match(
    /Grounding with Google Search and Web Grounding for enterprise is billed only when a prompt successfully returns web results.*?Gemini model usage fees apply separately\./i,
  )?.[0];
  if (legacySuccessRule === undefined) return;
  for (const model of referenceTargets.search.filter((candidate) =>
    belongsToPricingGeneration(candidate.model_id, "gemini-2.5"),
  ))
    for (const operation of ["google_search", "web_grounding_enterprise"])
      groundingNote(
        model,
        sourceId,
        "grounding_billing_rule",
        "Legacy successful-grounding billing",
        legacySuccessRule,
        "informational",
        { operation },
        reconcile,
      );
}

function claudeWebSearchPricing(
  models: Map<string, Evidence>,
  sourceId: string,
  $: LoadedDocument,
  referenceBody: string,
  reconcile?: Reconcile,
): void {
  const rows = $(".devsite-article-body table")
    .filter((_index, table) => tableHeaders($, $(table)).join("\0") === "Tool\0Price")
    .find("tr")
    .slice(1)
    .filter((_index, row) => /^Web Search Request$/i.test(text($(row).find("th,td").eq(0).text())));
  if (rows.length !== 1) throw new Error("Vertex Claude web-search pricing table changed");
  const raw = cellText(rows.first().find("th,td").last());
  const price = raw.match(/\$(\d+(?:\.\d+)?)\s+per\s+1,?000\s+searches/i)?.[1];
  if (price === undefined) throw new Error("Vertex Claude web-search price changed");

  const reference = load(referenceBody);
  const supportedHeading = reference("h2").filter(
    (_index, heading) => text(reference(heading).text()) === "Supported models",
  );
  if (supportedHeading.length !== 1)
    throw new Error("Vertex Claude web-search supported-model reference changed");
  const labels = supportedHeading
    .first()
    .nextUntil("h2")
    .find("li")
    .map((_index, item) => text(reference(item).text()))
    .get();
  if (labels.length === 0)
    throw new Error("Vertex Claude web-search supported-model list is empty");
  const targets = new Map<string, ProviderModel>();
  for (const label of labels) {
    const matches = priceTargets(models, label).filter(
      (model) => model.service_families?.includes("publishers/anthropic") === true,
    );
    if (matches.length === 0) {
      reconcile?.({
        disposition: "unbound",
        reason_code: "claude_web_search_model_unbound",
        sample: label,
      });
      continue;
    }
    for (const model of matches) targets.set(model.model_id, model);
  }
  for (const model of targets.values())
    addRate(
      model,
      publishedRate("tool_call", price, "thousand_search_units", sourceId, raw, {
        operation: "web_search",
      }),
      reconcile,
    );
}

function applyPricing(
  models: Map<string, Evidence>,
  sourceId: string,
  body: string,
  evidence: PricingEvidence,
  claudeWebSearchBody: string | undefined,
  groundingReferences: GroundingReferences | undefined,
  reconcile?: Reconcile,
): void {
  const $ = load(body);
  tokenTables(models, sourceId, $, reconcile);
  labeledTables(models, sourceId, $, evidence, reconcile);
  storageTables(models, sourceId, $, reconcile);
  mediaTables(models, sourceId, $, reconcile);
  inlineUnitTables(models, sourceId, $, evidence, reconcile);
  if (sourceId === "vertex-google-models") {
    if (groundingReferences === undefined) throw new Error("Missing Vertex grounding references");
    googleGroundingTables(models, sourceId, $, groundingReferences, reconcile);
  }
  if (sourceId === "vertex-partner-models") {
    if (claudeWebSearchBody === undefined)
      throw new Error("Missing Vertex Claude web-search reference");
    claudeWebSearchPricing(models, sourceId, $, claudeWebSearchBody, reconcile);
  }
  for (const { model } of models.values()) {
    model.price_facts.sort((left, right) =>
      `${left.meter}\0${left.unit}\0${left.price}\0${JSON.stringify(left.conditions)}`.localeCompare(
        `${right.meter}\0${right.unit}\0${right.price}\0${JSON.stringify(right.conditions)}`,
      ),
    );
    model.raw_price_facts = [
      ...new Map(
        model.raw_price_facts.map((fact) => [sourceRawPricingFactKey(fact), fact]),
      ).values(),
    ].sort((left, right) =>
      sourceRawPricingFactKey(left).localeCompare(sourceRawPricingFactKey(right)),
    );
    if (model.price_facts.length > 0) model.pricing_state = "numeric";
  }
}

function applyOpenExamples(models: Map<string, Evidence>, documents: LinkedDocument[]): void {
  for (const document of documents) {
    const $ = load(document.body);
    $("pre").each((_index, element) => {
      const value = text($(element).text());
      if (!/\/endpoints\/openapi\/chat\/completions/.test(value)) return;
      for (const match of value.matchAll(
        /\bmodel["']?\s*(?::|=)\s*["']([a-z0-9-]+)\/([a-z0-9][a-z0-9._@-]*)["']/gi,
      )) {
        const publisher = match[1];
        const id = match[2];
        const model = id === undefined ? undefined : models.get(id)?.model;
        if (publisher === undefined || model === undefined) continue;
        model.service_families = unique([
          ...(model.service_families ?? []),
          `endpoints/openapi/${publisher}`,
        ]).sort();
        model.api_endpoints = [endpoints.open];
      }
    });
  }
}

export function parseVertexCatalog(input: Input): ProviderModel[] {
  const extractor = input.source.extractor;
  if (extractor.kind !== "vertex-catalog") throw new Error("Wrong Vertex catalog extractor");
  const bundle = linkedBundleSchema.parse(JSON.parse(input.body));
  validateEndpointReferences(input.source.id, bundle.documents);
  validateDiscovery(input.source.id, bundle.documents);
  const models = new Map<string, Evidence>();
  parseIndexInventory(models, input, bundle.index.body);
  const configured = new Set(
    input.source.linkedDocuments?.documents?.map(({ url }) => new URL(url).href) ?? [],
  );
  let modelDocuments = 0;
  for (const document of bundle.documents) {
    const path = new URL(document.url).pathname;
    if (path.endsWith("/generative-ai/pricing")) continue;
    const hasModelCard = parseModelTables(models, input, path, document.body);
    if (!configured.has(new URL(document.url).href) && hasModelCard) modelDocuments += 1;
    if (/model-versions|\/deprecations\//.test(path)) applyLifecycle(models, input, document.body);
  }
  if (input.source.id === "vertex-open-models") applyOpenExamples(models, bundle.documents);
  const pricing = bundle.documents.find((document) =>
    new URL(document.url).pathname.endsWith("/generative-ai/pricing"),
  );
  const claudeWebSearch = bundle.documents.find(
    (document) =>
      new URL(document.url).pathname ===
      "/gemini-enterprise-agent-platform/models/partner-models/claude/web-search",
  );
  const groundingReference = (path: string): string | undefined =>
    bundle.documents.find((document) => new URL(document.url).pathname === path)?.body;
  const groundingSearch = groundingReference(
    "/gemini-enterprise-agent-platform/models/grounding/grounding-with-google-search",
  );
  const groundingMaps = groundingReference(
    "/gemini-enterprise-agent-platform/models/grounding/grounding-with-google-maps",
  );
  const groundingData = groundingReference(
    "/gemini-enterprise-agent-platform/models/grounding/grounding-with-vertex-ai-search",
  );
  const groundingReferences =
    groundingSearch === undefined || groundingMaps === undefined || groundingData === undefined
      ? undefined
      : { search: groundingSearch, maps: groundingMaps, data: groundingData };
  if (pricing !== undefined)
    applyPricing(
      models,
      input.source.id,
      pricing.body,
      pricingEvidence(models, bundle.documents, input.source.id),
      claudeWebSearch?.body,
      groundingReferences,
      input.onPricingReconciliation,
    );
  const embedding = bundle.documents.find(
    (document) =>
      new URL(document.url).pathname ===
      "/gemini-enterprise-agent-platform/models/embeddings/get-text-embeddings",
  );
  if (embedding !== undefined) applyEmbeddingReference(models, embedding.body);
  const values = [...models.values()]
    .map((item) => item.model)
    .sort((left, right) => left.model_id.localeCompare(right.model_id));
  assertItemCount("Vertex model catalog", values.length, extractor.minModels, extractor.maxModels);
  assertItemCount(
    "Vertex model-card documents",
    modelDocuments,
    extractor.minModelDocuments,
    extractor.maxModelDocuments,
  );
  const current = values.filter((model) => model.status !== "retired");
  const priced = current.filter((model) => model.price_facts.length > 0);
  assertCoverage(
    "Vertex pricing coverage",
    priced.length,
    current.length,
    extractor.minPricingCoverage,
    ["pricing"],
  );
  return values;
}

export function parseVertexApi(input: Input): ProviderModel[] {
  const bundle = apiBundleSchema.parse(JSON.parse(input.body));
  const models = new Map<string, ProviderModel>();
  for (const publisher of bundle.publishers) {
    const items = recognizeItems({
      label: "Vertex Model Garden model",
      items: publisher.models,
      schema: apiItemSchema,
      modelId: (item) => {
        if (item === null || typeof item !== "object") return undefined;
        const name = Reflect.get(item, "name");
        return typeof name === "string"
          ? name.split("/models/")[1]?.replace(/@\d+$/u, "")
          : undefined;
      },
    });
    for (const item of items) {
      const resource = item.name.match(/^publishers\/([^/]+)\/models\/(.+)$/);
      const resourcePublisher = resource?.[1];
      const id = resource?.[2]?.replace(/@\d+$/, "");
      if (
        resourcePublisher !== publisher.publisher ||
        id === undefined ||
        !modelIdSchema.safeParse(id).success
      )
        throw new Error("Vertex Model Garden API returned an invalid resource name");
      const modelStatus = modelStateFromLabel(
        `${item.launchStage ?? ""} ${item.versionState ?? ""}`,
      );
      models.set(id, {
        ...baseModel({
          providerId: input.provider.id,
          id,
          name: id,
          sourceId: input.source.id,
          observedAt: input.observedAt,
        }),
        service_families: [`publishers/${resourcePublisher}`],
        ...modelStatus,
        scope: "runtime_observation",
      });
    }
  }
  if (models.size === 0) throw new Error("Vertex Model Garden API returned no models");
  return [...models.values()].sort((left, right) => left.model_id.localeCompare(right.model_id));
}
