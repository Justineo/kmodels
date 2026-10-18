import { openApiYamlSchemaReader } from "./openapi-yaml.ts";
import { finalizePricingInputs } from "./pricing-input.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import type { SourcePricingInputFact } from "./pricing-source.ts";
import { contractExtensionEvidence, type SourceContractEvidence } from "./source-contract.ts";

interface Document {
  url: string;
  body: string;
}

interface Contract {
  key: string;
  channel: SourcePricingInputFact["channel"];
  locator: SourcePricingInputFact["locator"];
  availability: SourcePricingInputFact["availability"];
  absent_value?: SourcePricingInputFact["absent_value"];
  requirements: readonly Requirement[];
}

type Requirement =
  | { document: string; markers: readonly RegExp[] }
  | {
      document: string;
      schema: string;
      path: readonly string[];
      type: "integer" | "number" | "string" | "array";
      member?: "map_value";
    };

const repositoryRoot = "/mistralai/platform-docs-public/main";
const openApiPath = `${repositoryRoot}/openapi.yaml`;
const promptCachingPath = `${repositoryRoot}/src/content/en/docs/studio/conversations/advanced/prompt-caching/page.mdx`;
const agentToolsRoot = `${repositoryRoot}/src/content/en/docs/studio/agents/agent-tools`;
const codeInterpreterPath = `${agentToolsRoot}/code_interpreter/page.mdx`;
const webSearchPath = `${agentToolsRoot}/websearch/page.mdx`;
const imageGenerationPath = `${agentToolsRoot}/image_generation/page.mdx`;
const librariesPath = `${repositoryRoot}/src/content/en/docs/studio/search/libraries/page.mdx`;

function schemaField(
  schema: string,
  path: readonly string[],
  type: "integer" | "number" | "string" | "array",
  member?: "map_value",
): Requirement {
  return { document: openApiPath, schema, path, type, ...(member === undefined ? {} : { member }) };
}

function completionFields(
  streaming: boolean,
  path: readonly string[],
  type: "integer" | "number" = "integer",
): Requirement[] {
  // This common contract serves Chat and FIM, so both response owners must establish it.
  const schemas = streaming
    ? ["CompletionChunk"]
    : ["ChatCompletionResponse", "FIMCompletionResponse"];
  return schemas.map((schema) => schemaField(schema, ["usage", ...path], type));
}

const contracts: readonly Contract[] = [
  completionUsage("response", "prompt_tokens"),
  completionUsage("response", "completion_tokens"),
  completionCachedUsage("response"),
  completionUsage("stream", "prompt_tokens"),
  completionUsage("stream", "completion_tokens"),
  completionCachedUsage("stream"),
  {
    key: "embedding.response.prompt_tokens",
    channel: "response",
    locator: { kind: "json_pointer", value: "/usage/prompt_tokens" },
    availability: "success_only",
    requirements: [schemaField("EmbeddingResponse", ["usage", "prompt_tokens"], "integer")],
  },
  conversationUsage("prompt_tokens"),
  conversationUsage("completion_tokens"),
  conversationUsage("connector_tokens", "zero"),
  {
    key: "ocr.response.pages_processed",
    channel: "response",
    locator: { kind: "json_pointer", value: "/usage_info/pages_processed" },
    availability: "success_only",
    requirements: [schemaField("OCRResponse", ["usage_info", "pages_processed"], "integer")],
  },
  transcriptionUsage("response"),
  transcriptionUsage("stream"),
  completionAudioUsage("response"),
  completionAudioUsage("stream"),
  {
    key: "speech.request.input_characters",
    channel: "request",
    locator: {
      kind: "provider_field",
      value: "SpeechRequest.accepted_billing_characters",
    },
    availability: "always",
    requirements: [schemaField("SpeechRequest", ["input"], "string")],
  },
  connectorUsage("code_interpreter", codeInterpreterPath, [
    /\btool\.execution\b/,
    /connectors[\s\S]*code_interpreter/,
  ]),
  connectorUsage("web_search", webSearchPath, [
    /\btool\.execution\b/,
    /connectors[\s\S]*web_search/,
  ]),
  {
    key: "service.image_generation.generated_images",
    channel: "response",
    locator: {
      kind: "provider_field",
      value: "ConversationResponse.completed_image_generation_files",
    },
    absent_value: "zero",
    availability: "success_only",
    requirements: [
      schemaField("ConversationResponse", ["outputs"], "array"),
      {
        document: imageGenerationPath,
        markers: [/\bimage_generation\b/, /\btool_file\b/, /\bfile_id\b/],
      },
    ],
  },
  connectorUsage("document_library", librariesPath, [
    /\bdocument_library\b/,
    /connectors[\s\S]*document_library/,
  ]),
];

export function extractMistralPricingInputs(
  documents: readonly Document[],
  sourceRef: string,
  onFinding?: (evidence: SourceContractEvidence) => void,
  onReconciliation?: (item: PricingReconciliationItem) => void,
): SourcePricingInputFact[] {
  const bodies = new Map<string, string | undefined>();
  for (const { url, body } of documents) {
    const path = new URL(url).pathname;
    bodies.set(path, bodies.has(path) ? undefined : body);
  }
  const schemaReaders = new Map<string, ReturnType<typeof openApiYamlSchemaReader>>();
  const facts = contracts.flatMap((contract): SourcePricingInputFact[] => {
    if (
      !contract.requirements.every((requirement) =>
        requirementPresent(bodies, schemaReaders, requirement),
      )
    ) {
      onFinding?.(
        contractExtensionEvidence([
          `/documents${contract.requirements.map(({ document }) => document).join("+")}/${contract.key}`,
        ]),
      );
      return [];
    }
    return [
      {
        key: contract.key,
        channel: contract.channel,
        locator: contract.locator,
        ...(contract.absent_value === undefined ? {} : { absent_value: contract.absent_value }),
        availability: contract.availability,
        source_ref: sourceRef,
      },
    ];
  });
  return finalizePricingInputs(facts, contracts.length, "Mistral pricing inputs", onReconciliation);
}

function requirementPresent(
  bodies: ReadonlyMap<string, string | undefined>,
  schemaReaders: Map<string, ReturnType<typeof openApiYamlSchemaReader>>,
  requirement: Requirement,
): boolean {
  const body = bodies.get(requirement.document);
  if (body === undefined) return false;
  if ("markers" in requirement) return requirement.markers.every((marker) => marker.test(body));
  const reader = schemaReaders.get(requirement.document) ?? openApiYamlSchemaReader(body);
  schemaReaders.set(requirement.document, reader);
  const types = reader(requirement.schema, requirement.path, requirement.member);
  return (
    types.length > 0 &&
    types.every(
      (type) => type === requirement.type || (requirement.type === "number" && type === "integer"),
    )
  );
}

function completionUsage(
  responseKind: "response" | "stream",
  field: "completion_tokens" | "prompt_tokens",
): Contract {
  const streaming = responseKind === "stream";
  return {
    key: `completion.${responseKind}.${field}`,
    channel: streaming ? "stream_event" : "response",
    locator: { kind: "json_pointer", value: `/usage/${field}` },
    availability: streaming ? "terminal_only" : "success_only",
    requirements: completionFields(streaming, [field]),
  };
}

function completionCachedUsage(responseKind: "response" | "stream"): Contract {
  const streaming = responseKind === "stream";
  return {
    key: `completion.${responseKind}.cached_tokens`,
    channel: streaming ? "stream_event" : "response",
    locator: { kind: "json_pointer", value: "/usage/prompt_tokens_details/cached_tokens" },
    absent_value: "zero",
    availability: streaming ? "terminal_only" : "success_only",
    requirements: [
      ...completionFields(streaming, ["prompt_tokens_details", "cached_tokens"]),
      {
        document: promptCachingPath,
        markers: [
          /usage\.prompt_tokens_details\.cached_tokens/,
          /prompt_tokens[\s\S]*all prompt tokens/i,
          /prompt_tokens\s*-\s*cached_tokens/,
          /cached_tokens[\s\S]*(?:0|zero)[\s\S]*omitted/i,
        ],
      },
    ],
  };
}

function completionAudioUsage(responseKind: "response" | "stream"): Contract {
  const streaming = responseKind === "stream";
  return {
    key: `completion.${responseKind}.prompt_audio_seconds`,
    channel: streaming ? "stream_event" : "response",
    locator: { kind: "json_pointer", value: "/usage/prompt_audio_seconds" },
    availability: streaming ? "terminal_only" : "success_only",
    requirements: completionFields(streaming, ["prompt_audio_seconds"], "number"),
  };
}

function conversationUsage(
  field: "completion_tokens" | "connector_tokens" | "prompt_tokens",
  absent_value?: "zero",
): Contract {
  return {
    key: `conversation.response.${field}`,
    channel: "response",
    locator: { kind: "json_pointer", value: `/usage/${field}` },
    ...(absent_value === undefined ? {} : { absent_value }),
    availability: "success_only",
    requirements: [schemaField("ConversationResponse", ["usage", field], "integer")],
  };
}

function transcriptionUsage(responseKind: "response" | "stream"): Contract {
  const streaming = responseKind === "stream";
  return {
    key: `transcription.${responseKind}.prompt_audio_seconds`,
    channel: streaming ? "stream_event" : "response",
    locator: { kind: "json_pointer", value: "/usage/prompt_audio_seconds" },
    availability: streaming ? "terminal_only" : "success_only",
    requirements: [
      schemaField(
        streaming ? "TranscriptionStreamDone" : "TranscriptionResponse",
        ["usage", "prompt_audio_seconds"],
        "number",
      ),
    ],
  };
}

function connectorUsage(
  connector: "code_interpreter" | "document_library" | "web_search",
  document: string,
  markers: readonly RegExp[],
): Contract {
  return {
    key: `service.${connector}.completed_calls`,
    channel: "response",
    locator: { kind: "json_pointer", value: `/usage/connectors/${connector}` },
    absent_value: "zero",
    availability: "success_only",
    requirements: [
      schemaField("ConversationResponse", ["usage", "connectors"], "integer", "map_value"),
      { document, markers },
    ],
  };
}
