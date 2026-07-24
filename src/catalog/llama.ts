import { z } from "zod";
import { linkedBundleSchema } from "./bundle.ts";
import { modelIdSchema } from "./identity.ts";
import { baseModel } from "./model.ts";
import type { SourceManifest } from "./manifests.ts";
import { type Provider, type ProviderModel, unknownCapabilities } from "./schema.ts";

interface ParseInput {
  provider: Provider;
  source: SourceManifest;
  body: string;
  observedAt: string;
}

interface RegisteredModel {
  key: string;
  id: string;
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
  chat: string;
  structured: string;
  tool: string;
}

const hostedSpecs: {
  key: keyof HostedExamples;
  valid: (body: string) => boolean;
  capabilities: HostedCapability[];
}[] = [
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

const llama3Key = /^llama3_(?:8b|70b)(?:_|$)/;

const llamaApiItemSchema = z.object({
  id: modelIdSchema,
  created: z.number().int().nonnegative(),
  object: z.literal("model"),
  owned_by: z.string().min(1),
});
const llamaApiListSchema = z.object({ data: z.array(llamaApiItemSchema) });
const stringSchema = z.string();

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function document(bundle: z.infer<typeof linkedBundleSchema>, suffix: string): string {
  const matches = bundle.documents.filter(({ url }) => new URL(url).pathname.endsWith(suffix));
  if (matches.length !== 1) throw new Error(`Llama bundle requires exactly one ${suffix}`);
  return matches[0]?.body ?? "";
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

function registeredModels(body: string, ids: Map<string, string>): RegisteredModel[] {
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

function family(key: string): string | undefined {
  if (key.startsWith("llama2_")) return "Llama 2";
  if (key.startsWith("llama3_1_")) return "Llama 3.1";
  if (key.startsWith("llama3_2_") && key.includes("vision")) return "Llama 3.2-Vision";
  if (key.startsWith("llama3_2_")) return "Llama 3.2";
  if (key.startsWith("llama3_3_")) return "Llama 3.3";
  if (llama3Key.test(key)) return "Llama 3";
  if (key.startsWith("llama4_")) return "Llama 4";
  return undefined;
}

function contextTokens(model: RegisteredModel): number {
  const key = model.key;
  if (key === "prompt_guard") return 512;
  if (key.startsWith("llama2_") || key === "llama_guard_2_8b") return 4_096;
  if (llama3Key.test(key)) return 8_192;
  if (key.startsWith("llama3_1_") || key.startsWith("llama3_3_")) return 131_072;
  if (key.startsWith("llama3_2_")) return model.quantization === "int4" ? 8_192 : 131_072;
  if (key === "llama4_scout_17b_16e" || key === "llama4_maverick_17b_128e") return 262_144;
  if (key === "llama4_scout_17b_16e_instruct") return 10_485_760;
  if (key === "llama4_maverick_17b_128e_instruct") return 1_048_576;
  if (key.startsWith("llama_guard_3_")) return 131_072;
  if (key === "llama_guard_4_12b") return 8_192;
  throw new Error(`No reviewed context rule for ${key}`);
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

function hostedChatEndpoint(client: string, completions: string): ApiEndpoint {
  const baseUrls = unique(
    [...client.matchAll(/\bbase_url\s*=\s*f?("(?:[^"\\]|\\.)*")/g)].map((match) =>
      pythonString(required(match[1], "API base URL")),
    ),
  );
  if (baseUrls.length !== 1) throw new Error("Llama API client did not publish one base URL");
  const paths = unique(
    [...completions.matchAll(/\bself\._post\(\s*("(?:[^"\\]|\\.)*")/g)].map((match) =>
      pythonString(required(match[1], "API chat path")),
    ),
  );
  if (paths.length !== 1) throw new Error("Llama API client did not publish one chat path");
  const resource = required(paths[0], "API chat path");
  if (!/^\/(?!\/)[^?#\s]+$/.test(resource)) throw new Error("Llama API chat path was not relative");
  const base = new URL(required(baseUrls[0], "API base URL"));
  if (
    base.protocol !== "https:" ||
    base.username !== "" ||
    base.password !== "" ||
    base.search !== "" ||
    base.hash !== ""
  )
    throw new Error("Llama API base URL was invalid");
  const path = `${base.pathname.replace(/\/+$/, "")}${resource}`;
  if (!/^\/(?!\/)[^?#\s]+$/.test(path)) throw new Error("Llama API chat path was invalid");
  return { name: "Chat Completions", path };
}

function hostedEvidence(
  models: RegisteredModel[],
  examples: HostedExamples,
): Map<string, HostedEvidence> {
  const result = new Map<string, HostedEvidence>();
  for (const spec of hostedSpecs) {
    const body = examples[spec.key];
    if (!spec.valid(body)) throw new Error(`Llama ${spec.key} example changed shape`);
    const id = exampleModelId(body, spec.key);
    const model = resolveHostedModel(models, id, spec.key);
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
): string | undefined {
  if (model.key.startsWith("llama_guard_") || model.key === "prompt_guard") return undefined;
  if (model.key.startsWith("llama3_2_") && model.quantization === "int4") return quantizedDate;
  if (model.key.startsWith("llama3_3_")) return llama33Date;
  const name = family(model.key);
  const date = name === undefined ? undefined : dates.get(name);
  if (date === undefined) throw new Error(`Llama launch table omitted ${name ?? model.key}`);
  return date;
}

function toolCall(
  model: RegisteredModel,
  text32Card: string,
  llama31Card: string,
  llama33Card: string,
  hosted: boolean,
): true | "unknown" {
  if (hosted) return true;
  if (!model.id.toLowerCase().includes("instruct")) return "unknown";
  const evidence = model.key.startsWith("llama3_1_")
    ? llama31Card
    : model.key.startsWith("llama3_2_") && !model.key.includes("vision")
      ? text32Card
      : model.key.startsWith("llama3_3_")
        ? llama33Card
        : undefined;
  if (evidence !== undefined && /Tool Use|Tool-use/i.test(evidence)) return true;
  return "unknown";
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
  const chatExample = document(bundle, "/examples/chat.py");
  const toolExample = document(bundle, "/examples/tool_call.py");
  const structuredExample = document(bundle, "/examples/structured.py");
  const apiClient = document(bundle, "/src/llama_api_client/_client.py");
  const chatCompletions = document(bundle, "/src/llama_api_client/resources/chat/completions.py");
  const models = [
    ...registeredModels(bundle.index.body, coreIds(skuTypes)),
    ...promptGuardModels(safety),
  ];
  const bounds = input.source.extractor;
  if (bounds.kind !== "llama-catalog") throw new Error("Invalid Llama extractor");
  if (models.length < bounds.minModels || models.length > bounds.maxModels)
    throw new Error("Llama model count outside reviewed bounds");
  if (new Set(models.map(({ id }) => id)).size !== models.length)
    throw new Error("Llama registry returned duplicate descriptors");

  const dates = launchDates(readme);
  const quantizedDate = cardDate(text32Card);
  const llama33Date = cardDate(llama33Card);
  if (cardDate(llama4Card) !== dates.get("Llama 4"))
    throw new Error("Llama 4 release sources disagree");
  const endpoint = hostedChatEndpoint(apiClient, chatCompletions);
  const hosted = hostedEvidence(models, {
    chat: chatExample,
    structured: structuredExample,
    tool: toolExample,
  });
  return models.map((model) => {
    const evidence = hosted.get(model.id);
    const capability = (name: HostedCapability): true | "unknown" =>
      evidence?.capabilities.has(name) === true ? true : "unknown";
    const aliases = unique([model.huggingFaceRepo, ...(evidence?.aliases ?? [])]).filter(
      (alias) => alias !== model.id,
    );
    const vision = model.key.includes("vision") || model.key.startsWith("llama4_");
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
      operations: guard ? ["moderation"] : promptGuard ? ["classification"] : ["text_generation"],
      ...(evidence === undefined ? {} : { api_endpoints: [endpoint] }),
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
      limits: { context_tokens: contextTokens(model) },
      release_date: releaseDate(model, dates, quantizedDate, llama33Date),
      status: "active",
      pricing_status: "not_applicable",
    };
  });
}

export function parseLlamaApi(input: ParseInput): ProviderModel[] {
  const list = llamaApiListSchema.parse(JSON.parse(input.body));
  if (list.data.length === 0) throw new Error("Llama API returned no models");
  const ids = list.data.map(({ id }) => id);
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
