import { finalizePricingInputs } from "./pricing-input.ts";
import type { SourcePricingInputFact } from "./pricing-source.ts";
import { contractExtensionEvidence } from "./source-contract.ts";
import type { SourceParseInput as ParseInput, SourceParseResult } from "./source-parse.ts";
import { openApiYamlSchemaReader } from "./openapi-yaml.ts";

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
  const propertyTypes = openApiYamlSchemaReader(input.body);
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
