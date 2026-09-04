import { load } from "cheerio";
import { z } from "zod";
import { linkedBundleSchema } from "./bundle.ts";
import { htmlText } from "./html.ts";
import { modelIdSchema } from "./identity.ts";
import { baseModel } from "./model.ts";
import type { SourceManifest } from "./manifests.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import type { ParsedProviderModel as ProviderModel } from "./pricing-source.ts";
import {
  assertItemCount,
  contractExtensionEvidence,
  recognizeItems,
  type SourceContractEvidence,
} from "./source-contract.ts";
import { type Provider, unknownCapabilities } from "./schema.ts";

interface ParseInput {
  provider: Provider;
  source: SourceManifest;
  body: string;
  observedAt: string;
  onContractFinding?: (evidence: SourceContractEvidence) => void;
  onPricingReconciliation?: (item: PricingReconciliationItem) => void;
}

interface RegisteredModel {
  key: string;
  id: string;
  family: string;
  description: string;
  huggingFaceRepo: string;
  variant?: string;
  quantization: string;
}

type ApiEndpoint = NonNullable<ProviderModel["api_endpoints"]>[number];

interface HostedEvidence {
  aliases: string[];
  capabilities: Set<HostedCapability>;
}

type HostedCapability = "streaming" | "structured_output" | "tool_call";

interface HostedExamples {
  asyncChat: string | undefined;
  chat: string | undefined;
  structured: string | undefined;
  tool: string | undefined;
}

const hostedSpecs: {
  key: keyof HostedExamples;
  valid: (body: string) => boolean;
  capabilities: HostedCapability[];
}[] = [
  {
    key: "asyncChat",
    valid: (body) => /\bstream\s*=\s*True\b/.test(body) && /\bAsyncLlamaAPIClient\b/.test(body),
    capabilities: ["streaming"],
  },
  {
    key: "chat",
    valid: (body) => /\bstream\s*=\s*True\b/.test(body),
    capabilities: ["streaming"],
  },
  {
    key: "structured",
    valid: (body) => /\bresponse_format\s*=/.test(body) && /["']json_schema["']/.test(body),
    capabilities: ["structured_output"],
  },
  {
    key: "tool",
    valid: (body) => /\btools\s*=/.test(body),
    capabilities: ["tool_call"],
  },
];

interface ContextRules {
  byFamily: Map<string, number>;
  byId: Map<string, number>;
  byQuantization: Map<string, Map<string, number>>;
}

interface SafetyEvidence {
  releaseDate: string;
  inputImage: boolean;
  moderation: boolean;
}

const safetyReleaseSpecs: {
  suffix: string;
  title: string;
  claims: string[];
  models: { pattern: RegExp; inputImage?: boolean; moderation?: boolean }[];
}[] = [
  {
    suffix: "/blog/meta-llama-3/",
    title: "Introducing Meta Llama 3: The most capable openly available LLM to date",
    claims: ["Llama Guard 2"],
    models: [{ pattern: /^Llama-Guard-2-/ }],
  },
  {
    suffix: "/blog/meta-llama-3-1/",
    title: "Introducing Llama 3.1: Our most capable models to date",
    claims: ["Llama Guard 3", "Prompt Guard"],
    models: [{ pattern: /^Llama-Guard-3-8B(?:$|:)/ }, { pattern: /^Prompt-Guard-/ }],
  },
  {
    suffix: "/blog/llama-3-2-connect-2024-vision-edge-mobile-devices/",
    title: "Llama 3.2: Revolutionizing edge AI and vision with open, customizable models",
    claims: ["Llama Guard 3 11B Vision", "Llama Guard 3 1B"],
    models: [{ pattern: /^Llama-Guard-3-(?:1B|11B-Vision)(?:$|:)/ }],
  },
  {
    suffix: "/blog/ai-defenders-program-llama-protection-tools/",
    title: "Sharing new open source protection tools and advancements in AI privacy and security",
    claims: ["Llama Guard 4", "Llama API", "Prompt Guard 2"],
    models: [
      { pattern: /^Llama-Guard-4-/, inputImage: true, moderation: true },
      { pattern: /^Llama-Prompt-Guard-2-/ },
    ],
  },
];

const llamaApiItemSchema = z.object({
  id: modelIdSchema,
  created: z.number().int().nonnegative(),
  object: z.literal("model"),
  owned_by: z.string().min(1),
});
const llamaApiListSchema = z.object({ data: z.array(z.unknown()) });
const llamaApiItemKeys = ["id", "created", "object", "owned_by"] as const;
const stringSchema = z.string();

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function document(bundle: z.infer<typeof linkedBundleSchema>, suffix: string): string {
  const matches = bundle.documents.filter(({ url }) => new URL(url).pathname.endsWith(suffix));
  if (matches.length !== 1) throw new Error(`Llama bundle requires exactly one ${suffix}`);
  return matches[0]?.body ?? "";
}

function optionalDocument(
  bundle: z.infer<typeof linkedBundleSchema>,
  suffix: string,
): string | undefined {
  const matches = bundle.documents.filter(({ url }) => new URL(url).pathname.endsWith(suffix));
  if (matches.length > 1) throw new Error(`Llama bundle contains duplicate ${suffix}`);
  return matches[0]?.body;
}

function diagnostic(input: ParseInput, reason_code: string, sample: string): void {
  input.onPricingReconciliation?.({ disposition: "unsupported", reason_code, sample });
}

function claim<T>(
  input: ParseInput,
  reasonCode: string,
  sample: string,
  parse: () => T,
): T | undefined {
  try {
    return parse();
  } catch (error) {
    diagnostic(
      input,
      reasonCode,
      `${sample}: ${(error instanceof Error ? error.message : String(error)).slice(0, 180)}`,
    );
  }
}

function pythonString(value: string): string {
  return stringSchema.parse(JSON.parse(value));
}

function calls(body: string, constructor: string): string[] {
  const pattern = new RegExp(`^ {8}${constructor}\\(`, "gm");
  return [...body.matchAll(pattern)].map((match) => {
    const start = match.index;
    const open = body.indexOf("(", start);
    let depth = 0;
    let quote: "'" | '"' | undefined;
    let escaped = false;
    for (let index = open; index < body.length; index += 1) {
      const character = body[index];
      if (character === undefined) break;
      if (quote !== undefined) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === quote) quote = undefined;
        continue;
      }
      if (character === "'" || character === '"') quote = character;
      else if (character === "(") depth += 1;
      else if (character === ")" && --depth === 0) return body.slice(start, index + 1);
    }
    throw new Error(`Unterminated ${constructor} constructor`);
  });
}

function argument(call: string, name: string): string | undefined {
  const matches = [...call.matchAll(new RegExp(`\\b${name}=("(?:[^"\\\\]|\\\\.)*")`, "g"))];
  if (matches.length > 1) throw new Error(`Duplicate ${name} argument`);
  const raw = matches[0]?.[1];
  if (raw === undefined) {
    if (call.includes(`${name}=`)) throw new Error(`Unsupported ${name} argument`);
    return undefined;
  }
  return pythonString(raw);
}

function enumArgument(call: string, name: string, enumName: string): string | undefined {
  const matches = [...call.matchAll(new RegExp(`\\b${name}=${enumName}\\.([a-z0-9_]+)`, "g"))];
  if (matches.length > 1) throw new Error(`Duplicate ${name} argument`);
  const value = matches[0]?.[1];
  if (value === undefined && call.includes(`${name}=`))
    throw new Error(`Unsupported ${name} argument`);
  return value;
}

function required(value: string | undefined, field: string): string {
  if (value === undefined) throw new Error(`Llama model omitted ${field}`);
  return value;
}

function coreIds(body: string): Map<string, string> {
  const start = body.indexOf("class CoreModelId(Enum):");
  const end = body.indexOf("\n\ndef is_multimodal", start);
  if (start < 0 || end < 0) throw new Error("Llama CoreModelId enum was not found");
  const ids = new Map<string, string>();
  for (const match of body.slice(start, end).matchAll(/^ {4}([a-z0-9_]+) = ("[^"]+")$/gm)) {
    const key = match[1];
    const raw = match[2];
    if (key === undefined || raw === undefined || ids.has(key))
      throw new Error("Invalid Llama CoreModelId enum");
    ids.set(key, modelIdSchema.parse(pythonString(raw)));
  }
  if (ids.size === 0) throw new Error("Llama CoreModelId enum was empty");
  return ids;
}

function modelFamilies(body: string, ids: Map<string, string>): Map<string, string> {
  const start = body.indexOf("def model_family(model_id)");
  const end = body.indexOf("\n\nclass Model(", start);
  if (start < 0 || end < 0) throw new Error("Llama model_family function was not found");
  const families = new Map<string, string>();
  const branches = [
    ...body
      .slice(start, end)
      .matchAll(/(?:if|elif) model_id in \[([\s\S]*?)\]:\s*return ModelFamily\.([a-z0-9_]+)/g),
  ];
  for (const branch of branches) {
    const family = branch[2];
    if (family === undefined) throw new Error("Invalid Llama model family");
    const keys = [...(branch[1] ?? "").matchAll(/CoreModelId\.([a-z0-9_]+)/g)].map(
      (match) => match[1],
    );
    if (keys.length === 0 || keys.some((key) => key === undefined || !ids.has(key)))
      throw new Error(`Invalid Llama ${family} family`);
    for (const key of keys) {
      if (key === undefined || families.has(key))
        throw new Error("Llama CoreModelId belonged to multiple families");
      families.set(key, family);
    }
  }
  if (families.size !== ids.size)
    throw new Error("Llama model_family did not classify every CoreModelId");
  return families;
}

function setRule(rules: Map<string, number>, key: string, raw: string): void {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0 || rules.has(key))
    throw new Error("Invalid Llama context rule");
  rules.set(key, value);
}

function contextRules(body: string): ContextRules {
  const start = body.indexOf("    def max_seq_length(self) -> int:");
  if (start < 0) throw new Error("Llama max_seq_length function was not found");
  const compact = body.slice(start).replace(/\s+/g, " ");
  const byFamily = new Map<string, number>();
  const byId = new Map<string, number>();
  const byQuantization = new Map<string, Map<string, number>>();
  let returns = 0;

  for (const match of compact.matchAll(
    /(?:if|elif) self\.model_family == ModelFamily\.([a-z0-9_]+): return (\d+)(?= (?:if|elif|else|return|raise)|$)/g,
  )) {
    setRule(byFamily, required(match[1], "context family"), required(match[2], "context value"));
    returns += 1;
  }
  for (const match of compact.matchAll(
    /(?:if|elif) self\.model_family in \[([^\]]+)\]: return (\d+)(?= (?:if|elif|else|return|raise)|$)/g,
  )) {
    const value = required(match[2], "context value");
    const families = [...(match[1] ?? "").matchAll(/ModelFamily\.([a-z0-9_]+)/g)].map(
      (item) => item[1],
    );
    if (families.length === 0 || families.some((family) => family === undefined))
      throw new Error("Invalid Llama context family list");
    for (const family of families) setRule(byFamily, required(family, "context family"), value);
    returns += 1;
  }
  for (const match of compact.matchAll(
    /(?:if|elif) self\.core_model_id == CoreModelId\.([a-z0-9_]+): return (\d+)(?= (?:if|elif|else|return|raise)|$)/g,
  )) {
    setRule(byId, required(match[1], "context model"), required(match[2], "context value"));
    returns += 1;
  }
  for (const match of compact.matchAll(
    /(?:if|elif) self\.core_model_id in [[{]([^\]}]+)[\]}]: return (\d+)(?= (?:if|elif|else|return|raise)|$)/g,
  )) {
    const value = required(match[2], "context value");
    const keys = [...(match[1] ?? "").matchAll(/CoreModelId\.([a-z0-9_]+)/g)].map(
      (item) => item[1],
    );
    if (keys.length === 0 || keys.some((key) => key === undefined))
      throw new Error("Invalid Llama context model list");
    for (const key of keys) setRule(byId, required(key, "context model"), value);
    returns += 1;
  }
  for (const match of compact.matchAll(
    /(?:if|elif) self\.model_family == ModelFamily\.([a-z0-9_]+): if self\.quantization_format == CheckpointQuantizationFormat\.([a-z0-9_]+): return (\d+) return (\d+)(?= (?:if|elif|else|return|raise)|$)/g,
  )) {
    const family = required(match[1], "context family");
    const quantization = required(match[2], "context quantization");
    const quantized = new Map<string, number>();
    setRule(quantized, quantization, required(match[3], "context value"));
    if (byQuantization.has(family)) throw new Error("Duplicate Llama quantized context rule");
    byQuantization.set(family, quantized);
    setRule(byFamily, family, required(match[4], "context value"));
    returns += 2;
  }

  const publishedReturns = [...compact.matchAll(/\breturn\b/g)].length;
  if (returns === 0 || returns !== publishedReturns)
    throw new Error("Llama max_seq_length function changed shape");
  return { byFamily, byId, byQuantization };
}

function registeredModels(
  body: string,
  ids: Map<string, string>,
  families: Map<string, string>,
): RegisteredModel[] {
  const models = calls(body, "Model").map((call) => {
    if (!call.includes("arch_args=") || !call.includes("pth_file_count="))
      throw new Error("Llama Model constructor omitted required registry fields");
    const key = required(enumArgument(call, "core_model_id", "CoreModelId"), "core_model_id");
    const id = ids.get(key);
    if (id === undefined) throw new Error(`Unknown Llama CoreModelId ${key}`);
    const variant = argument(call, "variant");
    return {
      key,
      id: modelIdSchema.parse(variant === undefined ? id : `${id}:${variant}`),
      family: required(families.get(key), "model family"),
      description: required(argument(call, "description"), "description"),
      huggingFaceRepo: modelIdSchema.parse(
        required(argument(call, "huggingface_repo"), "huggingface_repo"),
      ),
      ...(variant === undefined ? {} : { variant }),
      quantization:
        enumArgument(call, "quantization_format", "CheckpointQuantizationFormat") ?? "bf16",
    };
  });
  const used = new Set(models.map(({ key }) => key));
  if ([...ids.keys()].some((key) => !used.has(key)))
    throw new Error("Llama registry did not instantiate every CoreModelId");
  return models;
}

function promptGuardModels(body: string): RegisteredModel[] {
  const defaultDescription = required(
    body.match(/^ {4}description: str = ("[^"]+")$/m)?.[1],
    "Prompt Guard description",
  );
  const maxSequence = Number(
    required(body.match(/^ {4}max_seq_length: int = (\d+)$/m)?.[1], "Prompt Guard context"),
  );
  if (maxSequence !== 512) throw new Error("Prompt Guard context schema changed");
  return calls(body, "PromptGuardModel").map((call) => {
    const id = modelIdSchema.parse(required(argument(call, "model_id"), "model_id"));
    return {
      key: "prompt_guard",
      id,
      family: "safety",
      description: pythonString(defaultDescription),
      huggingFaceRepo: modelIdSchema.parse(
        required(argument(call, "huggingface_repo"), "huggingface_repo"),
      ),
      quantization: "bf16",
    };
  });
}

const months = new Map([
  ["january", "01"],
  ["february", "02"],
  ["march", "03"],
  ["april", "04"],
  ["may", "05"],
  ["june", "06"],
  ["july", "07"],
  ["august", "08"],
  ["september", "09"],
  ["sept", "09"],
  ["october", "10"],
  ["oct", "10"],
  ["november", "11"],
  ["december", "12"],
]);

function calendarDate(month: string, day: string, year: string): string {
  const number = months.get(month.toLowerCase());
  if (number === undefined) throw new Error(`Unknown month ${month}`);
  return `${year}-${number}-${day.padStart(2, "0")}`;
}

function cardDate(body: string): string {
  const match = body.match(
    /Model Release Date[\s\S]{0,100}?\b(January|February|March|April|May|June|July|August|Sept(?:ember)?|Oct(?:ober)?|November|December)\s+(\d{1,2}),?\s+(\d{4})/i,
  );
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined)
    throw new Error("Llama model card omitted its release date");
  return calendarDate(match[1], match[2], match[3]);
}

function launchDates(readme: string): Map<string, string> {
  const dates = new Map<string, string>();
  for (const match of readme.matchAll(
    /^\|\s*(Llama (?:2|3|3\.1|3\.2|3\.2-Vision|3\.3|4))\s*\|\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*\|/gm,
  )) {
    const family = match[1];
    const month = match[2];
    const day = match[3];
    const year = match[4];
    if (family === undefined || month === undefined || day === undefined || year === undefined)
      throw new Error("Invalid Llama launch table row");
    dates.set(family, `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`);
  }
  return dates;
}

function announcementDate(body: string, title: string, claims: string[]): string {
  const $ = load(body);
  const headings = $("h1")
    .toArray()
    .filter((heading) => htmlText($(heading).text()) === title);
  const heading = headings[0];
  if (headings.length !== 1 || heading === undefined)
    throw new Error(`Llama announcement omitted ${title}`);
  const dates = [
    ...htmlText($(heading).parent().text()).matchAll(
      /(January|February|March|April|May|June|July|August|Sept(?:ember)?|Oct(?:ober)?|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/gi,
    ),
  ];
  const date = dates[0];
  if (
    dates.length !== 1 ||
    date?.[1] === undefined ||
    date[2] === undefined ||
    date[3] === undefined
  )
    throw new Error(`Llama announcement ${title} omitted its publication date`);
  const page = htmlText($("body").text());
  if (claims.some((claim) => !page.includes(claim)))
    throw new Error(`Llama announcement ${title} omitted reviewed model evidence`);
  return calendarDate(date[1], date[2], date[3]);
}

function safetyEvidence(
  bundle: z.infer<typeof linkedBundleSchema>,
  models: RegisteredModel[],
): Map<string, SafetyEvidence> {
  const safetyModels = models.filter(({ family }) => family === "safety");
  const result = new Map<string, SafetyEvidence>();
  for (const spec of safetyReleaseSpecs) {
    const releaseDate = announcementDate(document(bundle, spec.suffix), spec.title, spec.claims);
    for (const model of safetyModels) {
      const match = spec.models.find(({ pattern }) => pattern.test(model.id));
      if (match === undefined) continue;
      if (result.has(model.id))
        throw new Error(`Llama safety model had conflicting release evidence: ${model.id}`);
      result.set(model.id, {
        releaseDate,
        inputImage: match.inputImage === true,
        moderation: match.moderation === true,
      });
    }
  }
  if (result.size !== safetyModels.length)
    throw new Error("Llama safety release evidence did not cover every safety model");
  return result;
}

function launchFamily(model: RegisteredModel): string {
  const match = model.family.match(/^llama(\d+)(?:_(\d+))?$/);
  if (match?.[1] === undefined) throw new Error(`No Llama launch family for ${model.family}`);
  return `Llama ${match[1]}${match[2] === undefined ? "" : `.${match[2]}`}${
    model.key.includes("vision") ? "-Vision" : ""
  }`;
}

function contextTokens(model: RegisteredModel, rules: ContextRules): number {
  if (model.key === "prompt_guard") return 512;
  const quantized = rules.byQuantization.get(model.family)?.get(model.quantization);
  const value = quantized ?? rules.byId.get(model.key) ?? rules.byFamily.get(model.family);
  if (value === undefined) throw new Error(`No published context rule for ${model.key}`);
  return value;
}

function apiModelIds(body: string): string[] {
  return unique(
    [...body.matchAll(/\b(?:MODEL|model)\s*=\s*("(?:[^"\\]|\\.)*")/g)].map((match) =>
      modelIdSchema.parse(pythonString(required(match[1], "API model ID"))),
    ),
  );
}

function exampleModelId(body: string, label: string): string {
  const ids = apiModelIds(body);
  const id = ids[0];
  if (ids.length !== 1 || id === undefined)
    throw new Error(`Llama ${label} example did not name exactly one model`);
  return id;
}

function resolveHostedModel(models: RegisteredModel[], id: string, label: string): RegisteredModel {
  const matches = models.filter((model) =>
    [model.id, model.huggingFaceRepo, model.huggingFaceRepo.split("/").at(-1)].includes(id),
  );
  const model = matches[0];
  if (matches.length !== 1 || model === undefined)
    throw new Error(`Llama ${label} example model ${id} did not resolve uniquely`);
  return model;
}

function hostedApiBase(client: string): string {
  const baseUrls = unique(
    [...client.matchAll(/\bbase_url\s*=\s*f?("(?:[^"\\]|\\.)*")/g)].map((match) =>
      pythonString(required(match[1], "API base URL")),
    ),
  );
  if (baseUrls.length !== 1) throw new Error("Llama API client did not publish one base URL");
  const base = new URL(required(baseUrls[0], "API base URL"));
  if (
    base.protocol !== "https:" ||
    base.username !== "" ||
    base.password !== "" ||
    base.search !== "" ||
    base.hash !== ""
  )
    throw new Error("Llama API base URL was invalid");
  return base.pathname.replace(/\/+$/, "");
}

function hostedEndpoint(base: string, resourceBody: string, name: string): ApiEndpoint {
  const paths = unique(
    [...resourceBody.matchAll(/\bself\._post\(\s*("(?:[^"\\]|\\.)*")/g)].map((match) =>
      pythonString(required(match[1], `${name} path`)),
    ),
  );
  if (paths.length !== 1) throw new Error(`Llama API did not publish one ${name} path`);
  const resource = required(paths[0], `${name} path`);
  if (!/^\/(?!\/)[^?#\s]+$/.test(resource))
    throw new Error(`Llama API ${name} path was not relative`);
  const path = `${base}${resource}`;
  if (!/^\/(?!\/)[^?#\s]+$/.test(path)) throw new Error(`Llama API ${name} path was invalid`);
  return { name, path };
}

function hostedEvidence(
  input: ParseInput,
  models: RegisteredModel[],
  examples: HostedExamples,
): Map<string, HostedEvidence> {
  const result = new Map<string, HostedEvidence>();
  for (const spec of hostedSpecs) {
    const body = examples[spec.key];
    if (body === undefined) continue;
    const resolved = claim(input, "hosted_example_drift", spec.key, () => {
      if (!spec.valid(body)) throw new Error(`Llama ${spec.key} example changed shape`);
      const id = exampleModelId(body, spec.key);
      return { id, model: resolveHostedModel(models, id, spec.key) };
    });
    if (resolved === undefined) continue;
    const { id, model } = resolved;
    const current = result.get(model.id);
    result.set(model.id, {
      aliases: unique([...(current?.aliases ?? []), id]),
      capabilities: new Set([...(current?.capabilities ?? []), ...spec.capabilities]),
    });
  }
  return result;
}

function releaseDate(
  model: RegisteredModel,
  dates: Map<string, string>,
  quantizedDate: string,
  llama33Date: string,
  safety: SafetyEvidence | undefined,
): string {
  if (model.family === "safety") {
    if (safety === undefined) throw new Error(`Llama safety model omitted a release: ${model.id}`);
    return safety.releaseDate;
  }
  if (model.family === "llama3_2" && model.quantization === "int4") return quantizedDate;
  if (model.family === "llama3_3") return llama33Date;
  const name = launchFamily(model);
  const date = dates.get(name);
  if (date === undefined) throw new Error(`Llama launch table omitted ${name}`);
  return date;
}

function toolCall(
  model: RegisteredModel,
  text32Card: string,
  llama31Card: string,
  llama33Card: string,
  hostedTool: boolean,
): true | "unknown" {
  if (hostedTool) return true;
  if (!model.id.toLowerCase().includes("instruct")) return "unknown";
  const evidence =
    model.family === "llama3_1"
      ? llama31Card
      : model.family === "llama3_2" && !model.key.includes("vision")
        ? text32Card
        : model.family === "llama3_3"
          ? llama33Card
          : undefined;
  if (evidence !== undefined && /Tool Use|Tool-use/i.test(evidence)) return true;
  return "unknown";
}

function auditHostedUsageShape(
  input: ParseInput,
  bundle: z.infer<typeof linkedBundleSchema>,
): void {
  const response = optionalDocument(bundle, "/types/create_chat_completion_response.py");
  const stream = optionalDocument(bundle, "/types/create_chat_completion_response_stream_chunk.py");
  if (
    response !== undefined &&
    (!/class Metric\(BaseModel\):[\s\S]*metric: str[\s\S]*value: float[\s\S]*unit: Optional\[str\]/.test(
      response,
    ) ||
      !/metrics: Optional\[List\[Metric\]\]/.test(response))
  )
    diagnostic(input, "chat_metrics_contract_drift", "response metrics");
  if (
    stream !== undefined &&
    (!/class EventMetric\(BaseModel\):[\s\S]*metric: str[\s\S]*value: float[\s\S]*unit: Optional\[str\]/.test(
      stream,
    ) ||
      !/event_type: Literal\["start", "complete", "progress", "metrics"\]/.test(stream) ||
      !/metrics: Optional\[List\[EventMetric\]\]/.test(stream))
  )
    diagnostic(input, "stream_metrics_contract_drift", "stream metrics");
}

function auditHostedModelInventory(
  input: ParseInput,
  bundle: z.infer<typeof linkedBundleSchema>,
): void {
  if (
    [
      "/src/llama_api_client/resources/models.py",
      "/src/llama_api_client/types/llama_model.py",
      "/src/llama_api_client/types/model_list_response.py",
    ].every((suffix) => optionalDocument(bundle, suffix) !== undefined)
  )
    claim(input, "model_inventory_contract_drift", "generated Models resource", () =>
      hostedModelInventory(bundle),
    );
}

function auditHistoricalPreview(
  input: ParseInput,
  bundle: z.infer<typeof linkedBundleSchema>,
): void {
  const launch = optionalDocument(bundle, "/blog/llamacon-llama-news/");
  if (launch !== undefined) {
    const historicalPreview =
      claim(input, "launch_terms_drift", "LlamaCon launch", () => {
        if (
          announcementDate(launch, "Everything we announced at our first-ever LlamaCon", [
            "Llama API",
            "limited free preview",
            "Llama 4 Scout",
            "Llama 4 Maverick",
            "all usage tracked in one location",
          ]) !== "2025-04-29"
        )
          throw new Error("Llama API launch terms drifted");
        return true;
      }) === true;
    if (historicalPreview)
      input.onPricingReconciliation?.({
        disposition: "excluded",
        reason_code: "historical_limited_free_preview",
      });
  }
}

function hostedModelInventory(bundle: z.infer<typeof linkedBundleSchema>): void {
  const resource = document(bundle, "/src/llama_api_client/resources/models.py");
  const model = document(bundle, "/src/llama_api_client/types/llama_model.py");
  const list = document(bundle, "/src/llama_api_client/types/model_list_response.py");

  const syncResource = resource.match(
    /class ModelsResource\(SyncAPIResource\):([\s\S]*?)\nclass AsyncModelsResource\(/,
  )?.[1];
  const signature = syncResource?.match(
    /\n {4}def list\(([\s\S]*?)\n {4}\) -> ModelListResponse:/,
  )?.[1];
  const method = syncResource?.match(
    /\n {4}def list\([\s\S]*?\n {4}\) -> ModelListResponse:([\s\S]*)$/,
  )?.[1];
  if (signature === undefined || method === undefined)
    throw new Error("Llama API model-list resource drifted");
  const parameters = unique(
    [...signature.matchAll(/^ {8}([a-z][a-z0-9_]*):/gm)].map((match) => match[1] ?? ""),
  );
  const expectedParameters = ["extra_body", "extra_headers", "extra_query", "timeout"];
  if (
    parameters.length !== expectedParameters.length ||
    parameters.toSorted().join(",") !== expectedParameters.join(",") ||
    [...method.matchAll(/self\._get\(\s*[f]?(["'])(.*?)\1/g)].map((match) => match[2]).join(",") !==
      "/models" ||
    !/post_parser\s*=\s*DataWrapper\[ModelListResponse\]\._unwrapper/.test(method) ||
    !/cast_to\s*=\s*cast\(\s*Type\[ModelListResponse\]\s*,\s*DataWrapper\[ModelListResponse\]\s*\)/.test(
      method,
    )
  )
    throw new Error("Llama API model-list resource drifted");

  const classBody = model.match(/class LlamaModel\(BaseModel\):([\s\S]*)$/)?.[1];
  const fields =
    classBody === undefined
      ? []
      : [...classBody.matchAll(/^ {4}([a-z][a-z0-9_]*): ([^\n]+)$/gm)].map((match) => ({
          name: match[1] ?? "",
          type: match[2] ?? "",
        }));
  const fieldTypes = new Map(fields.map(({ name, type }) => [name, type]));
  if (
    fields.length !== 4 ||
    fieldTypes.get("id") !== "str" ||
    fieldTypes.get("created") !== "int" ||
    !/^Literal\[["']model["']\]$/.test(fieldTypes.get("object") ?? "") ||
    fieldTypes.get("owned_by") !== "str"
  )
    throw new Error("Llama API model schema drifted");
  if (!/^ModelListResponse\s*:\s*TypeAlias\s*=\s*(?:List|list)\[LlamaModel\]\s*$/m.test(list))
    throw new Error("Llama API model-list response drifted");
}

export function parseLlamaCatalog(input: ParseInput): ProviderModel[] {
  const bundle = linkedBundleSchema.parse(JSON.parse(input.body));
  const skuTypes = document(bundle, "/models/sku_types.py");
  const safety = document(bundle, "/models/cli/safety_models.py");
  const readme = document(bundle, "/README.md");
  const text32Card = document(bundle, "/models/llama3_2/MODEL_CARD.md");
  const llama31Card = document(bundle, "/models/llama3_1/MODEL_CARD.md");
  const llama33Card = document(bundle, "/models/llama3_3/MODEL_CARD.md");
  const llama4Card = document(bundle, "/models/llama4/MODEL_CARD.md");
  const apiClient = optionalDocument(bundle, "/src/llama_api_client/_client.py");
  const chatCompletions = optionalDocument(
    bundle,
    "/src/llama_api_client/resources/chat/completions.py",
  );
  const moderations = optionalDocument(bundle, "/src/llama_api_client/resources/moderations.py");
  const ids = coreIds(skuTypes);
  const models = [
    ...registeredModels(bundle.index.body, ids, modelFamilies(skuTypes, ids)),
    ...promptGuardModels(safety),
  ];
  const bounds = input.source.extractor;
  if (bounds.kind !== "llama-catalog") throw new Error("Invalid Llama extractor");
  assertItemCount("Llama model catalog", models.length, bounds.minModels, bounds.maxModels);
  if (new Set(models.map(({ id }) => id)).size !== models.length)
    throw new Error("Llama registry returned duplicate descriptors");

  const dates = launchDates(readme);
  const quantizedDate = cardDate(text32Card);
  const llama33Date = cardDate(llama33Card);
  if (cardDate(llama4Card) !== dates.get("Llama 4"))
    throw new Error("Llama 4 release sources disagree");
  if (!/Multilingual text and image/i.test(llama4Card))
    throw new Error("Llama 4 model card omitted multimodal input");
  const contexts = contextRules(skuTypes);
  const releases = safetyEvidence(bundle, models);
  const apiBase =
    apiClient === undefined
      ? undefined
      : claim(input, "hosted_api_base_drift", "API base URL", () => hostedApiBase(apiClient));
  const chatEndpoint =
    apiBase === undefined || chatCompletions === undefined
      ? undefined
      : claim(input, "hosted_route_drift", "Chat Completions", () =>
          hostedEndpoint(apiBase, chatCompletions, "Chat Completions"),
        );
  const moderationEndpoint =
    apiBase === undefined || moderations === undefined
      ? undefined
      : claim(input, "hosted_route_drift", "Moderations", () =>
          hostedEndpoint(apiBase, moderations, "Moderations"),
        );
  auditHostedUsageShape(input, bundle);
  auditHostedModelInventory(input, bundle);
  auditHistoricalPreview(input, bundle);
  const hosted = hostedEvidence(input, models, {
    asyncChat: optionalDocument(bundle, "/examples/async_chat.py"),
    chat: optionalDocument(bundle, "/examples/chat.py"),
    structured: optionalDocument(bundle, "/examples/structured.py"),
    tool: optionalDocument(bundle, "/examples/tool_call.py"),
  });
  const parsed = models.map((model) => {
    const evidence = hosted.get(model.id);
    const safetyRelease = releases.get(model.id);
    const capability = (name: HostedCapability): true | "unknown" =>
      evidence?.capabilities.has(name) === true ? true : "unknown";
    const aliases = unique([model.huggingFaceRepo, ...(evidence?.aliases ?? [])]).filter(
      (alias) => alias !== model.id,
    );
    const endpoints = [
      ...(evidence === undefined || chatEndpoint === undefined ? [] : [chatEndpoint]),
      ...(safetyRelease?.moderation !== true || moderationEndpoint === undefined
        ? []
        : [moderationEndpoint]),
    ];
    const hostedOffer = endpoints.length > 0;
    const vision =
      model.key.includes("vision") ||
      model.family === "llama4" ||
      safetyRelease?.inputImage === true;
    const guard = model.key.startsWith("llama_guard_");
    const promptGuard = model.key === "prompt_guard";
    return {
      ...baseModel({
        providerId: input.provider.id,
        id: model.id,
        name: model.id,
        sourceId: input.source.id,
        observedAt: input.observedAt,
      }),
      description: model.description,
      aliases,
      tasks: guard ? ["moderation"] : promptGuard ? ["classification"] : ["text_generation"],
      ...(endpoints.length === 0 ? {} : { api_endpoints: endpoints }),
      modalities: { input: vision ? ["text", "image"] : ["text"], output: ["text"] },
      capabilities: {
        ...unknownCapabilities(),
        tool_call: toolCall(
          model,
          text32Card,
          llama31Card,
          llama33Card,
          capability("tool_call") === true,
        ),
        structured_output: capability("structured_output"),
        streaming: capability("streaming"),
      },
      limits: { context_tokens: contextTokens(model, contexts) },
      release_date: releaseDate(model, dates, quantizedDate, llama33Date, safetyRelease),
      status: "active",
      pricing_state: hostedOffer ? ("not_published" as const) : ("unknown" as const),
    } satisfies ProviderModel;
  });
  for (const model of parsed)
    if (model.pricing_state === "not_published")
      input.onPricingReconciliation?.({
        disposition: "explicit_non_numeric",
        reason_code: "hosted_price_not_published",
      });
  return parsed;
}

export function parseLlamaApi(input: ParseInput): ProviderModel[] {
  const raw: unknown = JSON.parse(input.body);
  const list = llamaApiListSchema.parse(raw);
  if (raw !== null && typeof raw === "object") {
    const extensions = Object.keys(raw)
      .filter((key) => key !== "data")
      .map((key) => `/${key}`);
    if (extensions.length > 0) input.onContractFinding?.(contractExtensionEvidence(extensions));
  }
  const items = recognizeItems({
    label: "Llama API model",
    items: list.data,
    schema: llamaApiItemSchema,
    modelId: "id",
    rootKeys: llamaApiItemKeys,
    skipInvalidItems: true,
    ...(input.onContractFinding === undefined ? {} : { onFinding: input.onContractFinding }),
  });
  const ids = items.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) throw new Error("Llama API returned duplicate model IDs");
  return ids.map((id) => ({
    ...baseModel({
      providerId: input.provider.id,
      id,
      name: id,
      sourceId: input.source.id,
      observedAt: input.observedAt,
    }),
    status: "active",
  }));
}
