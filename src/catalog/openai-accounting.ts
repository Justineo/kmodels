import { finalizePricingInputs } from "./pricing-input.ts";
import type { SourcePricingInputFact } from "./pricing-source.ts";
import { contractExtensionEvidence } from "./source-contract.ts";
import type { SourceParseInput as ParseInput, SourceParseResult } from "./source-parse.ts";
import { yamlBlock } from "./yaml.ts";

interface YamlNode {
  lines: readonly string[];
  indentation: number;
}
interface YamlEntry {
  value: string;
  node: YamlNode;
}

function entry(node: YamlNode, key: string): YamlEntry | null | undefined {
  const prefix = " ".repeat(node.indentation) + key + ":";
  const indexes = node.lines.flatMap((line, index) =>
    line.startsWith(prefix) &&
    (line.length === prefix.length || /\s/.test(line[prefix.length] ?? ""))
      ? [index]
      : [],
  );
  const start = indexes[0];
  if (indexes.length > 1) return null;
  if (start === undefined) return;
  const end = node.lines.findIndex(
    (line, index) =>
      index > start &&
      line.trim() !== "" &&
      !line.trimStart().startsWith("#") &&
      line.length - line.trimStart().length <= node.indentation,
  );
  return {
    value: (node.lines[start] ?? "").slice(prefix.length).trim(),
    node: {
      lines: node.lines.slice(start + 1, end < 0 ? undefined : end),
      indentation: node.indentation + 2,
    },
  };
}

function sequence(node: YamlNode): YamlEntry[] {
  const prefix = " ".repeat(node.indentation) + "- ";
  const starts = node.lines.flatMap((line, index) => (line.startsWith(prefix) ? [index] : []));
  return starts.map((start, index) => {
    const value = (node.lines[start] ?? "").slice(prefix.length);
    return {
      value,
      node: {
        lines: [
          " ".repeat(node.indentation + 2) + value,
          ...node.lines.slice(start + 1, starts[index + 1]),
        ],
        indentation: node.indentation + 2,
      },
    };
  });
}

function scalar(value: string): string {
  return value.replace(/^["']|["']$/g, "");
}

function declaredTypes(value: YamlEntry): string[] {
  if (value.value === "") return sequence(value.node).map(({ value }) => scalar(value));
  if (value.value.startsWith("[") && value.value.endsWith("]"))
    return value.value
      .slice(1, -1)
      .split(",")
      .map((part) => scalar(part.trim()));
  return [scalar(value.value)];
}

// This recognizes the reviewed block-style schema shapes, not arbitrary YAML.
// Only direct properties, local schema references and schema compositions establish paths.
function schemaReader(body: string): (schema: string, path: readonly string[]) => string[] {
  const components = yamlBlock(body, "components", 0);
  const schemas = components === undefined ? undefined : yamlBlock(components, "schemas", 2);
  const schemaNodes = new Map<string, YamlNode | undefined>();
  const lines = (schemas ?? "").split(/\r?\n/);
  const starts = lines.flatMap((line, index) => {
    const name = line.match(/^    ([A-Za-z0-9_-]+):$/)?.[1];
    return name === undefined ? [] : [{ name, index }];
  });
  for (const [position, { name, index }] of starts.entries()) {
    schemaNodes.set(
      name,
      schemaNodes.has(name)
        ? undefined
        : { lines: lines.slice(index + 1, starts[position + 1]?.index), indentation: 6 },
    );
  }
  function read(
    node: YamlNode,
    path: readonly string[],
    ancestors: ReadonlySet<YamlNode>,
  ): string[] | undefined {
    if (ancestors.has(node) || ancestors.size > 64) return;
    const seen = new Set([...ancestors, node]);
    const type = entry(node, "type");
    const properties = entry(node, "properties");
    const reference = entry(node, "$ref");
    if (type === null || properties === null || reference === null) return;
    const types = type === undefined ? [] : declaredTypes(type);
    if (path.length > 0 && types.some((type) => type !== "object" && type !== "null")) return;
    const result = path.length === 0 ? types.filter((type) => type !== "null") : [];
    const name = path[0];
    if (properties !== undefined && name !== undefined) {
      const property = entry(properties.node, name);
      if (property === null) return;
      if (property !== undefined) {
        const found = read(property.node, path.slice(1), seen);
        if (found === undefined) return;
        result.push(...found);
      }
    }
    if (reference !== undefined) {
      const target = scalar(reference.value).match(
        /^#\/components\/schemas\/([A-Za-z0-9_-]+)$/,
      )?.[1];
      const schema = target === undefined ? undefined : schemaNodes.get(target);
      if (schema === undefined) return;
      const found = read(schema, path, seen);
      if (found === undefined) return;
      result.push(...found);
    }
    for (const composition of ["allOf", "anyOf", "oneOf"]) {
      const group = entry(node, composition);
      if (group === null) return;
      if (group === undefined) continue;
      const alternatives = sequence(group.node);
      if (alternatives.length === 0) return;
      for (const alternative of alternatives) {
        const type = entry(alternative.node, "type");
        if (
          type !== undefined &&
          type !== null &&
          declaredTypes(type).every((type) => type === "null")
        )
          continue;
        const found = read(alternative.node, path, seen);
        if (found === undefined || (composition !== "allOf" && found.length === 0)) return;
        result.push(...found);
      }
    }
    return result;
  }
  return (schema, path) => {
    const node = schemaNodes.get(schema);
    return node === undefined ? [] : [...new Set(read(node, path, new Set()) ?? [])];
  };
}

interface OpenAiAccountingContract {
  key: string;
  schema: string;
  path: string[];
  type: "integer" | "number" | "string" | "array";
  channel: SourcePricingInputFact["channel"];
  locator: SourcePricingInputFact["locator"];
  reduction?: SourcePricingInputFact["reduction"];
  availability: SourcePricingInputFact["availability"];
}

const openAiAccountingContracts: readonly OpenAiAccountingContract[] = [
  responseUsage("input_tokens", ["input_tokens"]),
  responseUsage("cached_input_tokens", ["input_tokens_details", "cached_tokens"]),
  responseUsage("cache_write_tokens", ["input_tokens_details", "cache_write_tokens"]),
  responseUsage("output_tokens", ["output_tokens"]),
  responseField(
    "served_service_tier",
    "service_tier",
    "Response",
    "/service_tier",
    ["service_tier"],
    undefined,
    "string",
  ),
  responseField(
    "image_quality",
    "quality",
    "ImagesResponse",
    "/quality",
    ["quality"],
    undefined,
    "string",
  ),
  responseField(
    "image_resolution",
    "size",
    "ImagesResponse",
    "/size",
    ["size"],
    undefined,
    "string",
  ),
  responseField(
    "generated_images",
    "data",
    "ImagesResponse",
    "/data",
    ["data"],
    {
      kind: "array_length",
    },
    "array",
  ),
  responseField("image_input_tokens", "input_tokens", "ImagesResponse", "/usage/input_tokens", [
    "usage",
    "input_tokens",
  ]),
  responseField(
    "image_input_text_tokens",
    "text_tokens",
    "ImagesResponse",
    "/usage/input_tokens_details/text_tokens",
    ["usage", "input_tokens_details", "text_tokens"],
  ),
  responseField(
    "image_input_image_tokens",
    "image_tokens",
    "ImagesResponse",
    "/usage/input_tokens_details/image_tokens",
    ["usage", "input_tokens_details", "image_tokens"],
  ),
  responseField(
    "image_output_tokens",
    "image_tokens",
    "ImagesResponse",
    "/usage/output_tokens_details/image_tokens",
    ["usage", "output_tokens_details", "image_tokens"],
  ),
  responseField(
    "embedding_input_tokens",
    "prompt_tokens",
    "CreateEmbeddingResponse",
    "/usage/prompt_tokens",
    ["usage", "prompt_tokens"],
  ),
  responseField(
    "generated_seconds",
    "seconds",
    "VideoResource",
    "/seconds",
    ["seconds"],
    undefined,
    "string",
  ),
  responseField(
    "video_resolution",
    "size",
    "VideoResource",
    "/size",
    ["size"],
    undefined,
    "string",
  ),
  ...[
    "input_tokens",
    "input_cached_tokens",
    "input_cache_write_tokens",
    "input_uncached_tokens",
    "output_tokens",
    "input_text_tokens",
    "output_text_tokens",
    "input_cached_text_tokens",
    "input_audio_tokens",
    "input_cached_audio_tokens",
    "output_audio_tokens",
    "input_image_tokens",
    "input_cached_image_tokens",
    "output_image_tokens",
    "service_tier",
  ].map((field) => organizationUsage("completions", "UsageCompletionsResult", field)),
  organizationUsage("embeddings", "UsageEmbeddingsResult", "input_tokens"),
  organizationUsage("audio_speeches", "UsageAudioSpeechesResult", "characters"),
  organizationUsage("audio_transcriptions", "UsageAudioTranscriptionsResult", "seconds"),
  organizationUsage(
    "code_interpreter_sessions",
    "UsageCodeInterpreterSessionsResult",
    "num_sessions",
  ),
  organizationUsage("file_search_calls", "UsageFileSearchCallsResult", "num_requests"),
  organizationUsage("images", "UsageImagesResult", "images"),
  organizationUsage("web_search_calls", "UsageWebSearchCallsResult", "num_requests"),
];

function responseUsage(key: string, path: string[]): OpenAiAccountingContract {
  return {
    key: `responses.usage.${key}`,
    schema: "Response",
    path: ["usage", ...path],
    type: "integer",
    channel: "response",
    locator: {
      kind: "json_pointer",
      value: `/usage/${path.join("/")}`,
    },
    availability: "terminal_only",
  };
}

function responseField(
  key: string,
  property: string,
  schema = "Response",
  pointer = `/${property}`,
  path: string[] = [property],
  reduction?: SourcePricingInputFact["reduction"],
  type: OpenAiAccountingContract["type"] = "integer",
): OpenAiAccountingContract {
  return {
    key: `responses.${key}`,
    schema,
    path,
    type,
    channel: "response",
    locator: { kind: "json_pointer", value: pointer },
    ...(reduction === undefined ? {} : { reduction }),
    availability: "terminal_only",
  };
}

function organizationUsage(
  endpoint: string,
  schema: string,
  field: string,
): OpenAiAccountingContract {
  return {
    key: `organization.${endpoint}.${field}`,
    schema,
    path: [field],
    type: field === "service_tier" ? "string" : field === "seconds" ? "number" : "integer",
    channel: "account_report",
    locator: {
      kind: "provider_field",
      value: `organization.usage.${endpoint}.results[*].${field}`,
    },
    availability: "reconciliation_only",
  };
}

export function parseOpenAiAccounting(input: ParseInput): SourceParseResult {
  const pricingInputs: SourcePricingInputFact[] = [];
  const propertyTypes = schemaReader(input.body);
  for (const contract of openAiAccountingContracts) {
    const types = propertyTypes(contract.schema, contract.path);
    if (
      types.length === 0 ||
      types.some(
        (type) => type !== contract.type && !(contract.type === "number" && type === "integer"),
      )
    ) {
      input.onContractFinding?.(
        contractExtensionEvidence([
          `/components/schemas/${contract.schema}/properties/${contract.path.join("/properties/")}`,
        ]),
      );
      continue;
    }
    pricingInputs.push({
      key: contract.key,
      channel: contract.channel,
      locator: contract.locator,
      ...(contract.reduction === undefined ? {} : { reduction: contract.reduction }),
      availability: contract.availability,
      source_ref: input.source.id,
    });
  }
  if (pricingInputs.length === 0)
    throw new Error("OpenAI accounting contract contained no recognized pricing inputs");
  finalizePricingInputs(
    pricingInputs,
    openAiAccountingContracts.length,
    "OpenAI accounting fields",
    input.onPricingReconciliation,
  );
  return { models: [], pricing_inputs: pricingInputs };
}
