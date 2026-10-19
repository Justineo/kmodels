import { finalizePricingInputs } from "./pricing-input.ts";
import type { SourcePricingInputFact } from "./pricing-source.ts";
import { contractExtensionEvidence } from "./source-contract.ts";
import type { SourceParseInput as ParseInput, SourceParseResult } from "./source-parse.ts";
import { openApiYamlSchemaReader } from "./openapi-yaml.ts";
import { yamlBlock } from "./yaml.ts";

interface OpenAiAccountingContract {
  key: string;
  schema: string;
  path: string[];
  type: "integer" | "string" | "array";
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
  ...["text", "audio", "image"].flatMap((modality) => [
    realtimeUsage(`input_${modality}_tokens`, ["input_token_details", `${modality}_tokens`]),
    realtimeUsage(`cached_${modality}_tokens`, [
      "input_token_details",
      "cached_tokens_details",
      `${modality}_tokens`,
    ]),
  ]),
  ...["text", "audio"].map((modality) =>
    realtimeUsage(`output_${modality}_tokens`, ["output_token_details", `${modality}_tokens`]),
  ),
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

function realtimeUsage(key: string, path: string[]): OpenAiAccountingContract {
  return {
    key: `realtime.${key}`,
    schema: "RealtimeServerEventResponseDone",
    path: ["response", "usage", ...path],
    type: "integer",
    channel: "stream_event",
    locator: { kind: "json_pointer", value: `/response/usage/${path.join("/")}` },
    availability: "terminal_only",
  };
}

function realtimeEvent(body: string): boolean {
  const components = yamlBlock(body, "components", 0);
  const schemas = components === undefined ? undefined : yamlBlock(components, "schemas", 2);
  const event =
    schemas === undefined ? undefined : yamlBlock(schemas, "RealtimeServerEventResponseDone", 4);
  const properties = event === undefined ? undefined : yamlBlock(event, "properties", 6);
  const type = properties === undefined ? undefined : yamlBlock(properties, "type", 8);
  const values = type === undefined ? undefined : yamlBlock(type, "enum", 10);
  const response = properties === undefined ? undefined : yamlBlock(properties, "response", 8);
  const entries = values
    ?.split(/\r?\n/)
    .slice(1)
    .filter((line) => line.trim() !== "" && !line.trimStart().startsWith("#"));
  return (
    entries?.length === 1 &&
    /^ {12}- (?:response\.done|"response\.done"|'response\.done')$/.test(entries[0] ?? "") &&
    response !== undefined &&
    /^ {10}\$ref: ["']#\/components\/schemas\/RealtimeResponse["']$/m.test(response)
  );
}

export function parseOpenAiAccounting(input: ParseInput): SourceParseResult {
  const pricingInputs: SourcePricingInputFact[] = [];
  const propertyTypes = openApiYamlSchemaReader(input.body);
  const eventTypes = propertyTypes("RealtimeServerEventResponseDone", ["type"]);
  const hasRealtimeEvent =
    realtimeEvent(input.body) && eventTypes.length === 1 && eventTypes[0] === "string";
  for (const contract of openAiAccountingContracts) {
    const types =
      contract.key.startsWith("realtime.") && !hasRealtimeEvent
        ? []
        : propertyTypes(contract.schema, contract.path);
    if (types.length === 0 || types.some((type) => type !== contract.type)) {
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
