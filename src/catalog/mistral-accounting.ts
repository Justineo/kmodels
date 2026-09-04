import {
  openApiYamlHasPropertyPath,
  openApiYamlPropertyReferencesSchema,
  openApiYamlSchemaReferencesSchema,
} from "./openapi-yaml.ts";
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
  | { document: string; schema: string; path: readonly string[] }
  | { document: string; schema: string; property: string; references: string }
  | { document: string; schema: string; references: string };

const repositoryRoot = "/mistralai/platform-docs-public/main";
const openApiPath = `${repositoryRoot}/openapi.yaml`;
const promptCachingPath = `${repositoryRoot}/src/content/en/docs/studio/conversations/advanced/prompt-caching/page.mdx`;
const agentToolsRoot = `${repositoryRoot}/src/content/en/docs/studio/agents/agent-tools`;
const codeInterpreterPath = `${agentToolsRoot}/code_interpreter/page.mdx`;
const webSearchPath = `${agentToolsRoot}/websearch/page.mdx`;
const imageGenerationPath = `${agentToolsRoot}/image_generation/page.mdx`;
const librariesPath = `${repositoryRoot}/src/content/en/docs/studio/search/libraries/page.mdx`;

const usageResponse = (schema: string): Requirement => ({
  document: openApiPath,
  schema,
  property: "usage",
  references: "UsageInfo",
});

const usageField = (field: string): Requirement => ({
  document: openApiPath,
  schema: "UsageInfo",
  path: [field],
});

const conversationField = (field: string): Requirement => ({
  document: openApiPath,
  schema: "ConversationUsageInfo",
  path: [field],
});

const conversationResponse: Requirement = {
  document: openApiPath,
  schema: "ConversationResponse",
  property: "usage",
  references: "ConversationUsageInfo",
};

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
    requirements: [
      usageField("prompt_tokens"),
      usageResponse("ResponseBase"),
      {
        document: openApiPath,
        schema: "EmbeddingResponse",
        references: "ResponseBase",
      },
    ],
  },
  conversationUsage("prompt_tokens"),
  conversationUsage("completion_tokens"),
  conversationUsage("connector_tokens", "zero"),
  {
    key: "ocr.response.pages_processed",
    channel: "response",
    locator: { kind: "json_pointer", value: "/usage_info/pages_processed" },
    availability: "success_only",
    requirements: [
      { document: openApiPath, schema: "OCRUsageInfo", path: ["pages_processed"] },
      {
        document: openApiPath,
        schema: "OCRResponse",
        property: "usage_info",
        references: "OCRUsageInfo",
      },
    ],
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
    requirements: [{ document: openApiPath, schema: "SpeechRequest", path: ["input"] }],
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
      conversationResponse,
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
  const bodies = new Map(documents.map(({ url, body }) => [new URL(url).pathname, body]));
  const facts = contracts.flatMap((contract): SourcePricingInputFact[] => {
    if (!contract.requirements.every((requirement) => requirementPresent(bodies, requirement))) {
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
  bodies: ReadonlyMap<string, string>,
  requirement: Requirement,
): boolean {
  const body = bodies.get(requirement.document);
  if (body === undefined) return false;
  if ("markers" in requirement) return requirement.markers.every((marker) => marker.test(body));
  if ("property" in requirement)
    return openApiYamlPropertyReferencesSchema(
      body,
      requirement.schema,
      requirement.property,
      requirement.references,
    );
  if ("references" in requirement)
    return openApiYamlSchemaReferencesSchema(body, requirement.schema, requirement.references);
  return openApiYamlHasPropertyPath(body, requirement.schema, requirement.path);
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
    requirements: [
      usageField(field),
      usageResponse(streaming ? "CompletionChunk" : "ResponseBase"),
    ],
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
      { document: openApiPath, schema: "PromptTokensDetails", path: ["cached_tokens"] },
      {
        document: openApiPath,
        schema: "UsageInfo",
        property: "prompt_tokens_details",
        references: "PromptTokensDetails",
      },
      usageResponse(streaming ? "CompletionChunk" : "ResponseBase"),
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
    requirements: [
      usageField("prompt_audio_seconds"),
      usageResponse(streaming ? "CompletionChunk" : "ResponseBase"),
    ],
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
    requirements: [conversationField(field), conversationResponse],
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
      usageField("prompt_audio_seconds"),
      usageResponse(streaming ? "TranscriptionStreamDone" : "TranscriptionResponse"),
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
    requirements: [conversationField("connectors"), conversationResponse, { document, markers }],
  };
}
