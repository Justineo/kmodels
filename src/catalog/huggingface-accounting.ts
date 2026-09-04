import { openApiYamlHasPropertyPath } from "./openapi-yaml.ts";
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
  requirements: readonly Requirement[];
}

type Requirement =
  | { document: string; markers: readonly RegExp[] }
  | { document: string; schema: string; path: readonly string[] };

const chatPath = "/docs/inference-providers/en/tasks/chat-completion.md";
const overviewPath = "/docs/inference-providers/en/index.md";
const responsesPath = "/docs/inference-providers/en/guides/responses-api.md";
const responsesSchemaPath = "/openai/openai-openapi/master/openapi.yaml";

const contracts: readonly Contract[] = [
  chatUsage("response", "prompt_tokens"),
  chatUsage("response", "completion_tokens"),
  chatUsage("stream", "prompt_tokens"),
  chatUsage("stream", "completion_tokens"),
  responsesUsage("response", "input_tokens"),
  responsesUsage("response", "output_tokens"),
  responsesUsage("stream", "input_tokens"),
  responsesUsage("stream", "output_tokens"),
  {
    key: "routing.pinned_provider",
    channel: "request",
    locator: {
      kind: "provider_field",
      value: "HuggingFaceRequest.pinned_route_provider",
    },
    availability: "conditional",
    requirements: [
      {
        document: overviewPath,
        markers: [/select the provider of your choice/i, /appending the provider name/i],
      },
    ],
  },
];

export function extractHuggingFacePricingInputs(
  documents: readonly Document[],
  sourceRef: string,
  onFinding?: (evidence: SourceContractEvidence) => void,
  onReconciliation?: (item: PricingReconciliationItem) => void,
): SourcePricingInputFact[] {
  const bodies = new Map(documents.map(({ url, body }) => [new URL(url).pathname, body]));
  const facts = contracts.flatMap((contract) => {
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
        availability: contract.availability,
        source_ref: sourceRef,
      },
    ];
  });
  return finalizePricingInputs(
    facts,
    contracts.length,
    "Hugging Face pricing inputs",
    onReconciliation,
  );
}

function requirementPresent(
  bodies: ReadonlyMap<string, string>,
  requirement: Requirement,
): boolean {
  const body = bodies.get(requirement.document);
  if (body === undefined) return false;
  return "markers" in requirement
    ? requirement.markers.every((marker) => marker.test(body))
    : openApiYamlHasPropertyPath(body, requirement.schema, requirement.path);
}

function chatUsage(
  keyPrefix: "response" | "stream",
  field: "completion_tokens" | "prompt_tokens",
): Contract {
  const streaming = keyPrefix === "stream";
  return {
    key: `chat.${keyPrefix}.${field}`,
    channel: streaming ? "stream_event" : "response",
    locator: { kind: "json_pointer", value: `/usage/${field}` },
    availability: "terminal_only",
    requirements: [
      {
        document: chatPath,
        markers: [
          new RegExp(`\\b${field}\\b`),
          ...(streaming ? [/\binclude_usage\b/, /usage[^\n]*entire request/i] : []),
        ],
      },
    ],
  };
}

function responsesUsage(
  keyPrefix: "response" | "stream",
  field: "input_tokens" | "output_tokens",
): Contract {
  const streaming = keyPrefix === "stream";
  return {
    key: `responses.${keyPrefix}.${field}`,
    channel: streaming ? "stream_event" : "response",
    locator: {
      kind: "json_pointer",
      value: `${streaming ? "/response" : ""}/usage/${field}`,
    },
    availability: "terminal_only",
    requirements: [
      {
        document: responsesPath,
        markers: [
          /Responses API \(from OpenAI\)/,
          ...(streaming ? [/\bresponse\.completed\b/] : []),
        ],
      },
      { document: responsesSchemaPath, schema: "ResponseUsage", path: [field] },
    ],
  };
}
