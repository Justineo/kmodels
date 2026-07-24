import { z } from "zod";
import { linkedBundleSchema } from "./bundle.ts";
import { modelIdSchema } from "./identity.ts";
import type { SourceManifest } from "./manifests.ts";
import { apiEndpointKey, baseModel, modelUid } from "./model.ts";
import { classifyModelOperations, orderedOperations } from "./operation.ts";
import {
  type Modality,
  type ModelOperation,
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

interface MarkdownTable {
  section: string;
  subsection: string;
  detail: string;
  headers: string[];
  rows: string[][];
}

interface CatalogFact {
  id: string;
  version: string | undefined;
  rawType: string;
  details: string;
  serviceFamily: ServiceFamily;
  apiEndpoints: ProviderModel["api_endpoints"];
  limits: ProviderModel["limits"];
  status: ProviderModel["status"];
  releaseStage: ProviderModel["release_stage"];
}

const serviceFamilies = {
  openAi: "Azure OpenAI",
  sold: "Foundry Models sold by Azure",
  partner: "Foundry Models from partners and community",
} as const;
type ServiceFamily = (typeof serviceFamilies)[keyof typeof serviceFamilies];

interface AzureApiEndpoint {
  path: string;
  operationId: string;
  spec: "stable" | "preview";
}

const azureApiEndpoints = {
  batch: {
    path: "openai/v1/batches",
    operationId: "createBatch",
    spec: "stable",
  },
  chat: {
    path: "openai/v1/chat/completions",
    operationId: "createChatCompletion",
    spec: "stable",
  },
  completion: {
    path: "openai/v1/completions",
    operationId: "createCompletion",
    spec: "stable",
  },
  embedding: {
    path: "openai/v1/embeddings",
    operationId: "createEmbedding",
    spec: "stable",
  },
  realtime: {
    path: "openai/v1/realtime/sessions",
    operationId: "createRealtimeSession",
    spec: "stable",
  },
  response: {
    path: "openai/v1/responses",
    operationId: "createResponse",
    spec: "stable",
  },
  speech: {
    path: "openai/v1/audio/speech",
    operationId: "createSpeech",
    spec: "preview",
  },
  transcription: {
    path: "openai/v1/audio/transcriptions",
    operationId: "createTranscription",
    spec: "preview",
  },
  translation: {
    path: "openai/v1/audio/translations",
    operationId: "createTranslation",
    spec: "preview",
  },
  image: {
    path: "openai/v1/images/generations",
    operationId: "createImage",
    spec: "preview",
  },
  video: {
    path: "openai/v1/videos",
    operationId: "Videos_Create",
    spec: "preview",
  },
} as const satisfies Record<string, AzureApiEndpoint>;

const azureModelSchema = z.object({
  kind: z.string().optional(),
  skuName: z.string().optional(),
  description: z.string().optional(),
  model: z.object({
    name: modelIdSchema,
    version: z.string().min(1).optional(),
    format: z.string().optional(),
    publisher: z.string().optional(),
    capabilities: z.record(z.string(), z.string()).optional(),
    finetuneCapabilities: z.record(z.string(), z.string()).optional(),
    deprecation: z
      .object({ fineTune: z.string().optional(), inference: z.string().optional() })
      .optional(),
    lifecycleStatus: z
      .enum(["Stable", "Preview", "GenerallyAvailable", "Legacy", "Deprecating", "Deprecated"])
      .optional(),
    skus: z
      .array(
        z.object({
          name: z.string().min(1),
          usageName: z.string().optional(),
          deprecationDate: z.string().optional(),
          cost: z
            .array(
              z.object({
                name: z.string().optional(),
                meterId: z.string().min(1),
                unit: z.string().optional(),
              }),
            )
            .optional(),
        }),
      )
      .optional(),
  }),
});

const decimalValue = z
  .union([z.string(), z.number().finite().nonnegative()])
  .transform((value) => String(value));

const retailPriceSchema = z.object({
  currencyCode: z.string().min(1),
  retailPrice: decimalValue,
  armRegionName: z.string(),
  effectiveStartDate: z.string().min(1),
  meterId: z.string().min(1),
  meterName: z.string().min(1),
  productName: z.string().min(1),
  skuName: z.string().min(1),
  serviceName: z.literal("Foundry Models"),
  unitOfMeasure: z.string().min(1),
});

const azureApiBundleSchema = z.object({
  location: z.string().min(1),
  models: z.array(z.unknown()).min(1),
  prices: z.array(z.unknown()),
});

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function plain(value: string): string {
  return value
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/[*`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function markdownCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
}

function tables(body: string): MarkdownTable[] {
  const lines = body.split(/\r?\n/);
  const results: MarkdownTable[] = [];
  let section = "";
  let subsection = "";
  let detail = "";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.startsWith("## ")) {
      section = plain(line.slice(3));
      subsection = "";
      detail = "";
      continue;
    }
    if (line.startsWith("### ")) {
      subsection = plain(line.slice(4));
      detail = "";
      continue;
    }
    if (line.startsWith("#### ")) {
      detail = plain(line.slice(5));
      continue;
    }
    const separator = lines[index + 1];
    if (!line.startsWith("|") || separator === undefined || !separator.startsWith("|")) continue;
    const headers = markdownCells(line).map(plain);
    const dividers = markdownCells(separator).map((cell) => cell.replace(/\s+/g, ""));
    if (
      headers.length < 2 ||
      headers.length !== dividers.length ||
      !dividers.every((cell) => /^:?-{2,}:?$/.test(cell))
    )
      continue;
    const rows: string[][] = [];
    index += 2;
    while (index < lines.length && lines[index]?.startsWith("|")) {
      const row = markdownCells(lines[index] ?? "");
      if (row.length === headers.length) rows.push(row);
      index += 1;
    }
    index -= 1;
    results.push({ section, subsection, detail, headers, rows });
  }
  return results;
}

function headerIndex(table: MarkdownTable, label: RegExp): number {
  return table.headers.findIndex((header) => label.test(header));
}

function modelId(value: string): string | undefined {
  const code = value.match(/`([^`]+)`/)?.[1]?.trim();
  const candidate = code ?? plain(value);
  if (modelIdSchema.safeParse(candidate).success) return candidate;
  const annotated = candidate.replace(/\s+\([^)]*\)$/, "").trim();
  return modelIdSchema.safeParse(annotated).success ? annotated : undefined;
}

function modelReferences(cell: string): { id: string; version: string | undefined }[] {
  const matches = [...cell.matchAll(/`([^`]+)`/g)];
  return matches.flatMap((match, index) => {
    const id = match[1]?.trim();
    if (id === undefined || !modelIdSchema.safeParse(id).success) return [];
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? cell.length;
    const tail = plain(cell.slice(start, end));
    const rawVersion = tail.match(/\((?:version\s+)?([a-z0-9][a-z0-9._-]*)\)/i)?.[1];
    const version =
      rawVersion === undefined || /^(?:preview|ga|new)$/i.test(rawVersion) ? undefined : rawVersion;
    return [{ id, version }];
  });
}

function count(value: string | undefined): number | undefined {
  const raw = value?.match(/[\d,]+/)?.[0];
  if (raw === undefined) return undefined;
  const parsed = Number(raw.replaceAll(",", ""));
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function labeledTokens(value: string, label: "Input" | "Output"): number | undefined {
  const raw = value.match(
    new RegExp(`${label}:\\s*[^\\d]{0,40}([\\d,]+)\\s*(?:max\\s+)?tokens?`, "i"),
  )?.[1];
  return count(raw);
}

function limits(table: MarkdownTable, row: string[], details: string): ProviderModel["limits"] {
  const contextIndex = headerIndex(table, /^Context window$/i);
  const outputIndex = headerIndex(table, /^Max output tokens$/i);
  const requestIndex = headerIndex(table, /^Max request \(tokens\)$/i);
  const dimensionsIndex = headerIndex(table, /^Output dimensions$/i);
  const contextCell = contextIndex < 0 ? undefined : plain(row[contextIndex] ?? "");
  const requestCell = requestIndex < 0 ? "" : plain(row[requestIndex] ?? "");
  const explicitContext = details.match(/Context window:\s*([\d,]+)/i)?.[1];
  const input =
    labeledTokens(details, "Input") ?? count(requestCell.match(/Input:\s*([\d,]+)/i)?.[1]);
  const output =
    (outputIndex < 0 ? undefined : count(plain(row[outputIndex] ?? ""))) ??
    labeledTokens(details, "Output") ??
    count(requestCell.match(/Output:\s*([\d,]+)/i)?.[1]);
  const dimension =
    (dimensionsIndex < 0 ? undefined : count(plain(row[dimensionsIndex] ?? ""))) ??
    count(details.match(/([\d,]+)\s*(?:dim\.|dimensions?)/i)?.[1]);
  return {
    context_tokens:
      count(explicitContext) ?? count(contextCell) ?? (requestIndex < 0 ? undefined : input),
    max_input_tokens: input,
    max_output_tokens: output,
    embedding_dimensions: dimension === undefined ? undefined : [dimension],
  };
}

function modalityValues(value: string): Modality[] {
  const normalized = value.toLowerCase();
  const values: Modality[] = [];
  if (/\b(?:text|code)\b/.test(normalized)) values.push("text");
  if (/\b(?:image|images|vision)\b/.test(normalized)) values.push("image");
  if (/\b(?:audio|speech)\b/.test(normalized)) values.push("audio");
  if (/\bvideo\b/.test(normalized)) values.push("video");
  if (/\bpdf\b/.test(normalized)) values.push("pdf");
  if (/\b(?:vector|embedding)\b/.test(normalized)) values.push("embedding");
  return unique(values);
}

function labeledValue(value: string, label: "Input" | "Output"): string | undefined {
  return value.match(
    new RegExp(
      `${label}:\\s*(.*?)(?=\\b(?:Input|Output|Languages?|Tool calling|Response formats?|Key features?|Context window):|$)`,
      "i",
    ),
  )?.[1];
}

function modelModalities(
  rawType: string,
  details: string,
  operations: ModelOperation[],
): ProviderModel["modalities"] {
  const evidence = `${rawType} ${details}`;
  const inputValue = labeledValue(evidence, "Input");
  const outputValue = labeledValue(evidence, "Output");
  const input = modalityValues(inputValue ?? "");
  const output = modalityValues(outputValue ?? "");
  if (input.length === 0) {
    const phrase = evidence.match(
      /((?:text|image|audio|video)(?: and (?:text|image|audio|video))*) input/i,
    )?.[1];
    if (phrase !== undefined) input.push(...modalityValues(phrase));
    if (/text in/i.test(evidence)) input.push("text");
  }
  if (/text and image processing/i.test(evidence)) input.push("text", "image");
  if (output.length === 0) {
    const phrase = evidence.match(
      /((?:text|image|audio|video)(?: and (?:text|image|audio|video))*) output/i,
    )?.[1];
    if (phrase !== undefined) output.push(...modalityValues(phrase));
    if (/text out/i.test(evidence)) output.push("text");
  }
  if (operations.includes("embeddings")) {
    if (input.length === 0) input.push("text");
    output.push("embedding");
  }
  if (operations.includes("image_generation")) output.push("image");
  if (operations.includes("video_generation")) output.push("video");
  if (operations.includes("speech_synthesis")) {
    if (input.length === 0) input.push("text");
    output.push("audio");
  }
  if (operations.includes("transcription") || operations.includes("translation")) {
    input.push("audio");
    if (output.length === 0) output.push("text");
  }
  if (operations.includes("speech_to_speech")) {
    input.push("audio");
    output.push("audio");
  }
  if (operations.includes("text_generation")) {
    if (input.length === 0) input.push("text");
    if (output.length === 0) output.push("text");
  }
  return { input: unique(input), output: unique(output) };
}

function explicitOperations(rawType: string, details: string): ModelOperation[] {
  const value = `${rawType} ${details}`.toLowerCase();
  const operations: ModelOperation[] = [];
  if (/chat[- ]completion|messages|responses api|completions api/.test(value))
    operations.push("text_generation");
  if (/assistants/.test(value)) operations.push("text_generation");
  if (/embedding/.test(rawType.toLowerCase())) operations.push("embeddings");
  if (/text classification/.test(value)) operations.push("classification");
  if (/rerank/.test(value)) operations.push("reranking");
  if (/image generation|image-to-image|text-to-image/.test(value))
    operations.push("image_generation");
  if (/image-to-text|document ai|\bocr\b/.test(value)) operations.push("ocr");
  if (/video generation/.test(value)) operations.push("video_generation");
  if (/speech-to-text|speech to text/.test(value)) operations.push("transcription");
  if (/speech translation/.test(value)) operations.push("translation");
  if (/text-to-speech|text to speech/.test(value)) operations.push("speech_synthesis");
  if (/\baudio\b.*(?:real-?time|\brealtime\b)|(?:real-?time|\brealtime\b).*\baudio\b/.test(value))
    operations.push("speech_to_speech");
  if (/audio and text generation|audio generation/.test(value))
    operations.push("text_generation", "speech_synthesis");
  return orderedOperations(operations);
}

function modelOperations(id: string, rawType: string, details: string): ModelOperation[] {
  const explicit = explicitOperations(rawType, details);
  const classified = classifyModelOperations({
    modelId: id,
    name: id,
    rawType: undefined,
    modalities: { input: [], output: [] },
    fallback: "text_generation",
  });
  return orderedOperations(
    explicit.length === 0
      ? classified
      : [
          ...explicit,
          ...classified.filter(
            (operation) => operation !== "text_generation" || explicit.includes(operation),
          ),
        ],
  );
}

function capabilities(details: string): ProviderModel["capabilities"] {
  const value = details.toLowerCase();
  const yesNo = (label: string): boolean | "unknown" => {
    if (new RegExp(`${label}:\\s*no`, "i").test(details)) return false;
    if (new RegExp(`${label}:\\s*yes`, "i").test(details)) return true;
    return "unknown";
  };
  const tool = yesNo("Tool calling");
  return {
    ...unknownCapabilities(),
    reasoning: /\breasoning\b/.test(value) ? true : "unknown",
    tool_call:
      tool !== "unknown"
        ? tool
        : /function calling|functions(?:, tools)?|functions? & tools?|\btools\b/.test(value)
          ? true
          : "unknown",
    structured_output: /structured outputs?|response formats?:[^.]*\bjson\b|json mode/.test(value)
      ? true
      : "unknown",
    streaming: /streaming:\s*no/.test(value)
      ? false
      : /\bstreaming\b/.test(value)
        ? true
        : "unknown",
    prompt_cache: /prompt cach|cacheable prompt/.test(value) ? true : "unknown",
    fine_tuning: /fine[- ]tun/.test(value) ? true : "unknown",
    citations: /\bcitations?\b/.test(value) ? true : "unknown",
    code_execution: /code execution/.test(value) ? true : "unknown",
    context_management: /context management/.test(value) ? true : "unknown",
    effort_control: /reasoning_effort|reasoning effort/.test(value) ? true : "unknown",
    computer_use: /computer use/.test(value) ? true : "unknown",
  };
}

function endpoint(value: AzureApiEndpoint): NonNullable<ProviderModel["api_endpoints"]>[number] {
  return { name: value.operationId, path: value.path };
}

function endpointsFor(rawType: string, details: string): ProviderModel["api_endpoints"] {
  const evidence = `${rawType} ${details}`;
  const values: NonNullable<ProviderModel["api_endpoints"]> = [];
  if (/Chat Completions API/i.test(evidence)) values.push(endpoint(azureApiEndpoints.chat));
  if (/Completions API/i.test(evidence.replace(/Chat Completions API/gi, "")))
    values.push(endpoint(azureApiEndpoints.completion));
  if (/Responses API/i.test(evidence)) values.push(endpoint(azureApiEndpoints.response));
  if (
    /Realtime API/i.test(evidence) ||
    (/Audio models GPT-4o audio models/i.test(rawType) && /\breal-?time\b/i.test(details))
  )
    values.push(endpoint(azureApiEndpoints.realtime));
  if (/\bEmbeddings?\b/i.test(rawType)) values.push(endpoint(azureApiEndpoints.embedding));
  if (/Image generation models?/i.test(rawType)) values.push(endpoint(azureApiEndpoints.image));
  if (/Video generation models?/i.test(rawType)) values.push(endpoint(azureApiEndpoints.video));
  if (/Speech-to-text models?/i.test(rawType))
    values.push(endpoint(azureApiEndpoints.transcription));
  if (/Speech translation models?/i.test(rawType))
    values.push(endpoint(azureApiEndpoints.translation));
  if (/Text-to-speech models?/i.test(rawType)) values.push(endpoint(azureApiEndpoints.speech));
  if (values.length === 0) return undefined;
  return [...new Map(values.map((value) => [apiEndpointKey(value), value])).values()].sort(
    (left, right) => apiEndpointKey(left).localeCompare(apiEndpointKey(right)),
  );
}

function catalogFacts(body: string, serviceFamily: ServiceFamily): CatalogFact[] {
  const facts: CatalogFact[] = [];
  for (const table of tables(body)) {
    const modelIndex = headerIndex(table, /^Model(?: ID)?$/i);
    if (modelIndex < 0) continue;
    const typeIndex = headerIndex(table, /^Type(?: & API endpoint)?$/i);
    const descriptionIndex = headerIndex(table, /^(?:Description|Capabilities)$/i);
    for (const row of table.rows) {
      const references = modelReferences(row[modelIndex] ?? "");
      if (references.length === 0) continue;
      const rawType =
        typeIndex < 0
          ? `${table.section} ${table.subsection} ${table.detail}`.trim()
          : plain(row[typeIndex] ?? "");
      const details = `${rawType} ${
        descriptionIndex < 0 ? "" : plain(row[descriptionIndex] ?? "")
      }`.trim();
      const rowLimits = limits(table, row, details);
      const preview = /\bpreview\b/i.test(`${row[modelIndex] ?? ""} ${details}`);
      for (const reference of references)
        facts.push({
          ...reference,
          rawType,
          details,
          serviceFamily,
          apiEndpoints:
            serviceFamily === serviceFamilies.openAi ? endpointsFor(rawType, details) : undefined,
          limits: rowLimits,
          status: "active",
          releaseStage: preview ? "preview" : "unknown",
        });
    }
  }
  return facts;
}

function base(input: Input, id: string, version?: string): ProviderModel {
  return {
    ...baseModel({
      providerId: input.provider.id,
      id,
      ...(version === undefined ? {} : { version }),
      name: id,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    }),
    scope: "regional_catalog",
  };
}

function mergeTriState(left: boolean | "unknown", right: boolean | "unknown"): boolean | "unknown" {
  if (left === "unknown") return right;
  if (right === "unknown" || left === right) return left;
  return "unknown";
}

function mergeModel(left: ProviderModel, right: ProviderModel): ProviderModel {
  const availability = [
    ...new Map(
      [...(left.availability ?? []), ...(right.availability ?? [])].map((item) => [
        `${item.region}\u0000${item.deployment_type}`,
        item,
      ]),
    ).values(),
  ].sort((a, b) =>
    `${a.deployment_type}\u0000${a.region}`.localeCompare(`${b.deployment_type}\u0000${b.region}`),
  );
  const serviceFamilyValues = unique([
    ...(left.service_families ?? []),
    ...(right.service_families ?? []),
  ]).sort();
  const endpointValues = [
    ...new Map(
      [...(left.api_endpoints ?? []), ...(right.api_endpoints ?? [])].map((item) => [
        apiEndpointKey(item),
        item,
      ]),
    ).values(),
  ].sort((a, b) => apiEndpointKey(a).localeCompare(apiEndpointKey(b)));
  return {
    ...left,
    raw_type: left.raw_type ?? right.raw_type,
    service_families: serviceFamilyValues.length === 0 ? undefined : serviceFamilyValues,
    api_endpoints: endpointValues.length === 0 ? undefined : endpointValues,
    operations: orderedOperations([
      ...left.operations.filter(
        (operation) =>
          right.raw_type === undefined ||
          operation !== "text_generation" ||
          right.operations.includes(operation),
      ),
      ...right.operations,
    ]),
    modalities: {
      input: unique([...left.modalities.input, ...right.modalities.input]),
      output: unique([...left.modalities.output, ...right.modalities.output]),
    },
    capabilities: {
      reasoning: mergeTriState(left.capabilities.reasoning, right.capabilities.reasoning),
      tool_call: mergeTriState(left.capabilities.tool_call, right.capabilities.tool_call),
      structured_output: mergeTriState(
        left.capabilities.structured_output,
        right.capabilities.structured_output,
      ),
      streaming: mergeTriState(left.capabilities.streaming, right.capabilities.streaming),
      batch: mergeTriState(left.capabilities.batch, right.capabilities.batch),
      prompt_cache: mergeTriState(left.capabilities.prompt_cache, right.capabilities.prompt_cache),
      fine_tuning: mergeTriState(left.capabilities.fine_tuning, right.capabilities.fine_tuning),
      citations: mergeTriState(left.capabilities.citations, right.capabilities.citations),
      code_execution: mergeTriState(
        left.capabilities.code_execution,
        right.capabilities.code_execution,
      ),
      context_management: mergeTriState(
        left.capabilities.context_management,
        right.capabilities.context_management,
      ),
      effort_control: mergeTriState(
        left.capabilities.effort_control,
        right.capabilities.effort_control,
      ),
      computer_use: mergeTriState(left.capabilities.computer_use, right.capabilities.computer_use),
    },
    limits: { ...left.limits, ...right.limits },
    availability: availability.length === 0 ? undefined : availability,
    source_refs: unique([...left.source_refs, ...right.source_refs]),
  };
}

function upsert(models: Map<string, ProviderModel>, incoming: ProviderModel): void {
  const current = models.get(incoming.uid);
  models.set(incoming.uid, current === undefined ? incoming : mergeModel(current, incoming));
}

function lifecycleServiceFamily(table: MarkdownTable): ServiceFamily {
  if (table.section === serviceFamilies.partner) return serviceFamilies.partner;
  if (table.section === serviceFamilies.sold)
    return table.subsection === serviceFamilies.openAi
      ? serviceFamilies.openAi
      : serviceFamilies.sold;
  throw new Error(`Unsupported Azure lifecycle service family: ${table.section}`);
}

function lifecycle(models: Map<string, ProviderModel>, input: Input, body: string): void {
  for (const table of tables(body)) {
    const modelIndex = headerIndex(table, /^Model$/i);
    const versionIndex = headerIndex(table, /^Version$/i);
    const lifecycleIndex = headerIndex(table, /^Lifecycle$/i);
    const retirementIndex = headerIndex(table, /^Retirement date$/i);
    const replacementIndex = headerIndex(table, /^Replacement$/i);
    if (
      [modelIndex, versionIndex, lifecycleIndex, retirementIndex, replacementIndex].some(
        (i) => i < 0,
      )
    )
      continue;
    const serviceFamily = lifecycleServiceFamily(table);
    for (const row of table.rows) {
      const id = modelId(row[modelIndex] ?? "");
      if (id === undefined) throw new Error("Azure lifecycle table contained an invalid model ID");
      const rawVersion = plain(row[versionIndex] ?? "");
      const version = rawVersion === "—" || rawVersion === "-" ? undefined : rawVersion;
      const stage = plain(row[lifecycleIndex] ?? "").toLowerCase();
      const status: ProviderModel["status"] =
        stage === "preview"
          ? "active"
          : stage === "ga" || stage === "stable" || stage === "generallyavailable"
            ? "active"
            : stage === "legacy"
              ? "legacy"
              : stage === "deprecated"
                ? "deprecated"
                : stage === "retired"
                  ? "retired"
                  : "unknown";
      if (status === "unknown") throw new Error(`Unsupported Azure lifecycle stage: ${stage}`);
      const releaseStage: ProviderModel["release_stage"] =
        stage === "preview"
          ? "preview"
          : stage === "ga" || stage === "stable" || stage === "generallyavailable"
            ? "stable"
            : "unknown";
      const retiredAt = plain(row[retirementIndex] ?? "");
      const replacements = plain(row[replacementIndex] ?? "")
        .split(",")
        .map((value) => value.replace(/\s+\([^)]*\)$/, "").trim())
        .filter((value) => modelIdSchema.safeParse(value).success);
      const existing = models.get(modelUid(input.provider.id, id, version));
      const operations = modelOperations(id, table.section, "");
      const incoming = {
        ...base(input, id, version),
        operations,
        modalities: modelModalities(table.section, "", operations),
        service_families: [serviceFamily],
        status,
        release_stage: releaseStage,
        retired_at: retiredAt === "—" || retiredAt === "-" ? undefined : retiredAt,
        replacement_model_ids: unique(replacements),
      } satisfies ProviderModel;
      upsert(models, existing === undefined ? incoming : { ...incoming, name: existing.name });
      const merged = models.get(incoming.uid);
      if (merged !== undefined)
        models.set(incoming.uid, {
          ...merged,
          status,
          release_stage: releaseStage,
          retired_at: incoming.retired_at,
          replacement_model_ids: incoming.replacement_model_ids,
        });
    }
  }
}

function availability(models: Map<string, ProviderModel>, input: Input, body: string): void {
  for (const table of tables(body)) {
    const modelIndex = headerIndex(table, /^Model$/i);
    const versionIndex = headerIndex(table, /^Version$/i);
    if (modelIndex < 0 || versionIndex < 0) continue;
    const serviceFamily = /^Availability for Azure OpenAI in Foundry Models$/i.test(table.detail)
      ? serviceFamilies.openAi
      : /^Availability for other Foundry Models sold by Azure$/i.test(table.detail)
        ? serviceFamilies.sold
        : undefined;
    for (const row of table.rows) {
      const id = modelId(row[modelIndex] ?? "");
      const version = plain(row[versionIndex] ?? "");
      if (id === undefined || version === "" || version === "—")
        throw new Error("Azure availability table contained an invalid model tuple");
      const regions = table.headers
        .slice(2)
        .flatMap((region, index) => (plain(row[index + 2] ?? "") === "✅" ? [region] : []));
      if (regions.length === 0) continue;
      const operations = modelOperations(id, table.section, "");
      upsert(models, {
        ...base(input, id, version),
        operations,
        modalities: modelModalities(table.section, "", operations),
        service_families: serviceFamily === undefined ? undefined : [serviceFamily],
        api_endpoints:
          serviceFamily === serviceFamilies.openAi && /batch/i.test(table.section)
            ? [endpoint(azureApiEndpoints.batch)]
            : undefined,
        capabilities: {
          ...unknownCapabilities(),
          batch: /batch/i.test(table.section) ? true : "unknown",
        },
        status: "active",
        availability: regions.map((region) => ({ region, deployment_type: table.section })),
      });
    }
  }
}

function assistants(models: Map<string, ProviderModel>, input: Input, body: string): void {
  for (const table of tables(body)) {
    if (!/^Assistants\b/i.test(table.section) || !/^Region$/i.test(table.headers[0] ?? ""))
      continue;
    for (let index = 1; index < table.headers.length; index += 1) {
      const match = table.headers[index]?.match(/^([^,]+),\s*(.+)$/);
      const id = match?.[1]?.trim();
      const version = match?.[2]?.trim();
      if (
        id === undefined ||
        version === undefined ||
        !modelIdSchema.safeParse(id).success ||
        !table.rows.some((row) => plain(row[index] ?? "") === "✅")
      )
        continue;
      const regions = table.rows.flatMap((row) =>
        plain(row[index] ?? "") === "✅" ? [plain(row[0] ?? "")] : [],
      );
      upsert(models, {
        ...base(input, id, version),
        operations: orderedOperations([
          ...modelOperations(id, "Assistants", ""),
          "text_generation",
        ]),
        service_families: [serviceFamilies.openAi],
        availability: regions.map((region) => ({ region, deployment_type: "Standard/Regional" })),
      });
    }
  }
}

function document(bundle: z.infer<typeof linkedBundleSchema>, suffix: string): string {
  const item = bundle.documents.find((candidate) =>
    new URL(candidate.url).pathname.endsWith(suffix),
  );
  if (item === undefined) throw new Error(`Azure bundle omitted ${suffix}`);
  return item.body;
}

function validateApiSpecs(bundle: z.infer<typeof linkedBundleSchema>): void {
  const specs = {
    stable: document(bundle, "/azure-v1-v1-generated.yaml"),
    preview: document(bundle, "/azure-v1-preview-generated.yaml"),
  };
  for (const body of Object.values(specs))
    if (!/^  - url: ["']\{endpoint\}\/openai\/v1["']$/m.test(body))
      throw new Error("Azure OpenAI API specification server drifted");
  for (const value of Object.values(azureApiEndpoints)) {
    const relativePath = value.path.replace(/^openai\/v1/, "");
    const operation = `  ${relativePath}:\n    post:\n      operationId: ${value.operationId}`;
    if (!specs[value.spec].includes(operation))
      throw new Error(`Azure OpenAI API specification drifted for ${value.path}`);
  }
}

export function parseAzureCatalog(input: Input): ProviderModel[] {
  const extractor = input.source.extractor;
  if (extractor.kind !== "azure-catalog") throw new Error("Wrong Azure catalog extractor");
  const bundle = linkedBundleSchema.parse(JSON.parse(input.body));
  const openAi = bundle.index.body;
  const others = document(bundle, "/models-azure-direct-others.md");
  const partners = document(bundle, "/models-partners.md");
  const models = new Map<string, ProviderModel>();
  validateApiSpecs(bundle);

  lifecycle(models, input, document(bundle, "/concepts-model-retirement-schedule-content.md"));
  for (const suffix of [
    "/deployments-standard.md",
    "/deployments-provisioned.md",
    "/deployments-batch.md",
  ])
    availability(models, input, document(bundle, suffix));

  for (const fact of [
    ...catalogFacts(openAi, serviceFamilies.openAi),
    ...catalogFacts(others, serviceFamilies.sold),
    ...catalogFacts(partners, serviceFamilies.partner),
  ]) {
    const candidates = [...models.values()].filter(
      (model) =>
        model.model_id.toLowerCase() === fact.id.toLowerCase() &&
        (fact.version === undefined || model.version === fact.version) &&
        model.status !== "retired" &&
        model.status !== "deprecated",
    );
    const exact = candidates.filter((model) => model.model_id === fact.id);
    const eligible = exact.length === 0 ? candidates : exact;
    const target = eligible.length === 1 ? eligible[0] : undefined;
    const id = target?.model_id ?? fact.id;
    const version = target?.version ?? fact.version;
    const operations = modelOperations(id, fact.rawType, fact.details);
    upsert(models, {
      ...base(input, id, version),
      raw_type: fact.rawType,
      service_families: [fact.serviceFamily],
      api_endpoints: fact.apiEndpoints,
      operations,
      modalities: modelModalities(fact.rawType, fact.details, operations),
      capabilities: capabilities(`${fact.rawType} ${fact.details}`),
      limits: fact.limits,
      status: target?.status ?? fact.status,
      release_stage: target?.release_stage ?? fact.releaseStage,
      pricing_status: "unknown",
    });
  }
  assistants(models, input, openAi);

  const values = [...models.values()].map((model) => ({
    ...model,
    capabilities:
      model.availability?.some((item) => /batch/i.test(item.deployment_type)) === true
        ? { ...model.capabilities, batch: true }
        : model.capabilities,
  }));
  if (values.length < extractor.minModels || values.length > extractor.maxModels)
    throw new Error("Azure model count outside reviewed bounds");
  return values.sort((left, right) => left.uid.localeCompare(right.uid));
}

function booleanCapability(values: Map<string, string>, keys: string[]): boolean | "unknown" {
  for (const key of keys) {
    const value = values.get(key.toLowerCase())?.toLowerCase();
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return "unknown";
}

function integerCapability(values: Map<string, string>, keys: string[]): number | undefined {
  for (const key of keys) {
    const raw = values.get(key.toLowerCase());
    if (raw === undefined || !/^\d+$/.test(raw)) continue;
    const value = Number(raw);
    if (Number.isSafeInteger(value)) return value;
  }
}

function apiStatus(
  value: z.infer<typeof azureModelSchema>["model"]["lifecycleStatus"],
): Pick<ProviderModel, "status" | "release_stage"> {
  if (value === "Preview") return { status: "active", release_stage: "preview" };
  if (value === "Stable" || value === "GenerallyAvailable")
    return { status: "active", release_stage: "stable" };
  if (value === "Legacy") return { status: "legacy", release_stage: "unknown" };
  if (value === "Deprecating") return { status: "deprecated", release_stage: "unknown" };
  if (value === "Deprecated") return { status: "retired", release_stage: "unknown" };
  return { status: "unknown", release_stage: "unknown" };
}

function retailUnit(value: string): PriceRate["unit"] | undefined {
  const unit = value.toLowerCase();
  if (/1m.*tokens?|million.*tokens?/.test(unit)) return "million_tokens";
  if (/1k.*tokens?|thousand.*tokens?/.test(unit)) return "thousand_tokens";
  if (/\btokens?\b/.test(unit)) return "token";
  if (/1k.*requests?|thousand.*requests?/.test(unit)) return "thousand_requests";
  if (/\brequests?\b/.test(unit)) return "request";
  if (/\bimages?\b/.test(unit)) return "image";
  if (/\bseconds?\b/.test(unit)) return "second";
  if (/\bminutes?\b/.test(unit)) return "minute";
  if (/\bhours?\b/.test(unit)) return "unit_hour";
}

function retailMeter(label: string, unit: PriceRate["unit"]): PriceRate["meter"] | undefined {
  const value = label.toLowerCase();
  const input = /input|prompt/.test(value);
  const output = /output|completion/.test(value);
  const cacheWrite = /cache.*(?:write|creation)/.test(value);
  const cacheRead = /cache|cached/.test(value);
  const audio = /audio|speech|realtime|transcri|translat/.test(value);
  const image = /image/.test(value);
  const video = /video/.test(value);
  if (unit === "unit_hour" && /provisioned|\bptu\b/.test(value)) return "provisioned_throughput";
  if (cacheWrite && audio) return "cache_write_audio";
  if (cacheWrite && image) return "cache_write_image";
  if (cacheWrite) return "cache_write_text";
  if (cacheRead && audio) return "cache_read_audio";
  if (cacheRead && image) return "cache_read_image";
  if (cacheRead) return "cache_read_text";
  if (/embedding/.test(value)) return "embedding";
  if (/rerank/.test(value)) return "rerank_request";
  if (video && input) return "input_video";
  if (video && output) return "output_video";
  if (video) return "video_generation";
  if (image && input) return "input_image";
  if (image && output) return "output_image";
  if (image) return "image_generation";
  if (audio && output) return "output_audio";
  if (audio && (input || unit === "unit_hour")) return "input_audio";
  if (output) return "output_text";
  if (input) return "input_text";
}

function pricesFor(
  item: z.infer<typeof azureModelSchema>,
  prices: z.infer<typeof retailPriceSchema>[],
  location: string,
  sourceId: string,
): PriceRate[] {
  const byMeter = new Map<string, z.infer<typeof retailPriceSchema>[]>();
  for (const price of prices)
    byMeter.set(price.meterId, [...(byMeter.get(price.meterId) ?? []), price]);
  const rates: PriceRate[] = [];
  for (const sku of item.model.skus ?? []) {
    for (const cost of sku.cost ?? []) {
      for (const price of byMeter.get(cost.meterId) ?? []) {
        const unit = retailUnit(price.unitOfMeasure);
        if (unit === undefined) continue;
        const meter = retailMeter(
          `${cost.name ?? ""} ${price.meterName} ${price.productName} ${price.skuName}`,
          unit,
        );
        if (meter === undefined) continue;
        rates.push({
          meter,
          price: price.retailPrice,
          currency: price.currencyCode,
          unit,
          conditions: {
            region: price.armRegionName || location,
            deployment_scope: sku.name,
            effective_from: price.effectiveStartDate.slice(0, 10),
          },
          source_ref: sourceId,
          derived: false,
          raw_price: price.retailPrice,
          raw_unit: price.unitOfMeasure,
        });
      }
    }
  }
  return [
    ...new Map(
      rates.map((rate) => [
        `${rate.meter}\u0000${rate.currency}\u0000${rate.unit}\u0000${JSON.stringify(rate.conditions)}`,
        rate,
      ]),
    ).values(),
  ];
}

export function parseAzureApi(input: Input): ProviderModel[] {
  const bundle = azureApiBundleSchema.parse(JSON.parse(input.body));
  const modelResults = bundle.models.map((item) => azureModelSchema.safeParse(item));
  const priceResults = bundle.prices.map((item) => retailPriceSchema.safeParse(item));
  if (
    modelResults.some((result) => !result.success) ||
    priceResults.some((result) => !result.success)
  )
    throw new Error("Azure Models API schema drift");
  const prices = priceResults.flatMap((result) => (result.success ? [result.data] : []));
  return modelResults.flatMap((result) => {
    if (!result.success) return [];
    const item = result.data;
    const raw = new Map(
      Object.entries(item.model.capabilities ?? {}).map(([key, value]) => [
        key.toLowerCase(),
        value,
      ]),
    );
    const supports = (keys: string[]): boolean => booleanCapability(raw, keys) === true;
    const operations: ModelOperation[] = [];
    if (supports(["chatCompletion", "completion", "responses"])) operations.push("text_generation");
    if (supports(["assistants", "agentsV2"])) operations.push("text_generation");
    if (supports(["realtime"])) operations.push("speech_to_speech");
    const classified = modelOperations(item.model.name, item.kind ?? item.model.format ?? "", "");
    const modelOperationsValue = orderedOperations(
      operations.length === 0 ? classified : [...operations, ...classified],
    );
    const status = apiStatus(item.model.lifecycleStatus);
    const rates = pricesFor(item, prices, bundle.location, input.source.id);
    return [
      {
        ...base(input, item.model.name, item.model.version),
        description: item.description,
        operations: modelOperationsValue,
        modalities: modelModalities(item.kind ?? item.model.format ?? "", "", modelOperationsValue),
        capabilities: {
          ...unknownCapabilities(),
          tool_call: booleanCapability(raw, ["toolCalling", "functionCalling"]),
          structured_output: booleanCapability(raw, ["jsonSchemaResponse", "jsonObjectResponse"]),
          streaming: booleanCapability(raw, ["streaming"]),
          batch: booleanCapability(raw, ["batch"]),
          prompt_cache: booleanCapability(raw, ["promptCaching"]),
          fine_tuning: booleanCapability(raw, ["fineTune", "globalFineTune"]),
          reasoning: booleanCapability(raw, ["reasoning"]),
          computer_use: booleanCapability(raw, ["computerUse"]),
        },
        limits: {
          context_tokens: integerCapability(raw, ["maxContextToken"]),
          max_output_tokens: integerCapability(raw, ["maxOutputToken"]),
        },
        deprecated_at: item.model.deprecation?.inference?.slice(0, 10),
        ...status,
        pricing_status: rates.length === 0 ? "unknown" : "published",
        pricing: rates,
        availability: (item.model.skus ?? []).map((sku) => ({
          region: bundle.location,
          deployment_type: sku.name,
        })),
        scope: "runtime_observation",
      },
    ];
  });
}
