import { finalizePricingInputs } from "./pricing-input.ts";
import { openApiYamlSchemaReader } from "./openapi-yaml.ts";
import { yamlBlock, yamlPath } from "./yaml.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import type { SourcePricingInputFact } from "./pricing-source.ts";
import { contractExtensionEvidence, type SourceContractEvidence } from "./source-contract.ts";

interface Input {
  documents: ReadonlyMap<string, string>;
  sourceRef: string;
  onFinding?: (evidence: SourceContractEvidence) => void;
  onReconciliation?: (item: PricingReconciliationItem) => void;
}

interface Contract {
  fact: Omit<SourcePricingInputFact, "source_ref">;
  requirements: readonly { url: string; markers: readonly RegExp[] }[];
}

const usageUrl = "https://docs.ollama.com/api/usage.md";
const compatibilityUrl = "https://docs.ollama.com/api/openai-compatibility.md";
const openapiUrl = "https://docs.ollama.com/openapi.yaml";
export const ollamaUsageRelease = "v0.40.16";
export const ollamaUsageSourceBase = `https://raw.githubusercontent.com/ollama/ollama/${ollamaUsageRelease}`;
const typesUrl = `${ollamaUsageSourceBase}/api/types.go`;
const openaiUrl = `${ollamaUsageSourceBase}/openai/openai.go`;
const responsesUrl = `${ollamaUsageSourceBase}/openai/responses.go`;
const middlewareUrl = `${ollamaUsageSourceBase}/middleware/openai.go`;

const contracts: readonly Contract[] = [
  ...nativeContracts("generate", "/api/generate", "GenerateResponse"),
  ...nativeContracts("chat", "/api/chat", "ChatResponse"),
  ...openAiContracts("chat", "/v1/chat/completions", "ToUsage", /ChatWriter/),
  ...openAiContracts("completions", "/v1/completions", "ToUsageGenerate", /CompleteWriter/),
  ...responsesContracts(),
];
const requiredUrls = new Set(
  contracts.flatMap(({ requirements }) => requirements.map(({ url }) => url)),
);

export function extractOllamaPricingInputs(input: Input): SourcePricingInputFact[] {
  const documents = new Map<string, string>();
  for (const url of requiredUrls) {
    const body = input.documents.get(url);
    if (body !== undefined)
      documents.set(url, body.replace(/\\([_$*])/g, "$1").replace(/\s+/g, " "));
  }
  const facts = contracts.flatMap(({ fact, requirements }): SourcePricingInputFact[] => {
    const present = requirements.every(({ url, markers }) => {
      const body = documents.get(url);
      return body !== undefined && markers.every((marker) => marker.test(body));
    });
    if (!present) {
      input.onFinding?.(contractExtensionEvidence([`/pricing-inputs/${fact.key}`]));
      return [];
    }
    return [{ ...fact, source_ref: input.sourceRef }];
  });
  const systemOne = systemOneInput(input);
  return finalizePricingInputs(
    [...facts, ...systemOne.facts],
    contracts.length + systemOne.expected,
    "Ollama pricing inputs",
    input.onReconciliation,
  );
}

function systemOneInput(input: Input): { facts: SourcePricingInputFact[]; expected: number } {
  const body = input.documents.get(openapiUrl) ?? "";
  const operation = yamlPath(body, ["paths", "/v1/systemone", "post"]);
  if (operation === undefined) return { facts: [], expected: 0 };
  const servers = yamlBlock(operation, "servers", 6);
  const schema = yamlPath(body, [
    "paths",
    "/v1/systemone",
    "post",
    "responses",
    "200",
    "content",
    "application/json",
    "schema",
  ]);
  const reference = schema?.match(
    /^\s{16}\$ref: ["']#\/components\/schemas\/SystemOneResponse["']$/gm,
  );
  const types = openApiYamlSchemaReader(body)("SystemOneResponse", ["usage", "input_tokens"]);
  if (
    !/^        - url: https:\/\/ollama\.com$/m.test(servers ?? "") ||
    reference?.length !== 1 ||
    types.length !== 1 ||
    types[0] !== "integer"
  ) {
    input.onFinding?.(contractExtensionEvidence(["/pricing-inputs/systemone.input_tokens"]));
    return { facts: [], expected: 1 };
  }
  return {
    expected: 1,
    facts: [
      {
        key: "systemone.input_tokens",
        channel: "response",
        locator: { kind: "json_pointer", value: "/usage/input_tokens" },
        availability: "success_only",
        source_ref: input.sourceRef,
      },
    ],
  };
}

function nativeContracts(
  protocol: "chat" | "generate",
  path: string,
  responseType: "ChatResponse" | "GenerateResponse",
): Contract[] {
  return [
    ...nativeUsage(
      protocol,
      path,
      responseType,
      "input_tokens",
      "prompt_eval_count",
      "PromptEvalCount",
    ),
    ...nativeUsage(
      protocol,
      path,
      responseType,
      "cached_input_tokens",
      "prompt_eval_cached_count",
      "PromptEvalCachedCount",
    ),
    ...nativeUsage(protocol, path, responseType, "output_tokens", "eval_count", "EvalCount"),
  ];
}

function nativeUsage(
  protocol: "chat" | "generate",
  path: string,
  responseType: "ChatResponse" | "GenerateResponse",
  signal: "cached_input_tokens" | "input_tokens" | "output_tokens",
  field: string,
  goField: string,
): Contract[] {
  const requirements = [
    { url: usageUrl, markers: [new RegExp(`\\b${field}\\b`)] },
    { url: openapiUrl, markers: [new RegExp(`${escapeRegExp(path)}:`)] },
    {
      url: typesUrl,
      markers: [
        new RegExp(`type ${responseType} struct \\{[\\s\\S]{0,3000}\\bMetrics\\b`),
        new RegExp(`${goField}[^\n]*json:"${field}(?:,omitempty)?"`),
      ],
    },
  ];
  return [
    contract(`native.${protocol}.${signal}`, "response", `/${field}`, "success_only", requirements),
    contract(`native.${protocol}.stream.${signal}`, "stream_event", `/${field}`, "terminal_only", [
      ...requirements,
      { url: usageUrl, markers: [/final chunk[^.]*done[^.]*true/i] },
    ]),
  ];
}

function openAiContracts(
  protocol: "chat" | "completions",
  path: string,
  converter: "ToUsage" | "ToUsageGenerate",
  writer: RegExp,
): Contract[] {
  return [
    ...openAiUsage(
      protocol,
      path,
      converter,
      writer,
      "input_tokens",
      "prompt_tokens",
      conversion(converter, "input_tokens"),
    ),
    ...openAiUsage(
      protocol,
      path,
      converter,
      writer,
      "cached_input_tokens",
      "prompt_tokens_details/cached_tokens",
      conversion(converter, "cached_input_tokens"),
    ),
    ...openAiUsage(
      protocol,
      path,
      converter,
      writer,
      "output_tokens",
      "completion_tokens",
      conversion(converter, "output_tokens"),
    ),
  ];
}

function openAiUsage(
  protocol: "chat" | "completions",
  path: string,
  converter: "ToUsage" | "ToUsageGenerate",
  writer: RegExp,
  signal: "cached_input_tokens" | "input_tokens" | "output_tokens",
  fieldPath: string,
  conversionMarker: RegExp,
): Contract[] {
  const requirements = [
    { url: compatibilityUrl, markers: [new RegExp(escapeRegExp(path))] },
    { url: openaiUrl, markers: [conversionMarker] },
  ];
  return [
    contract(
      `openai.${protocol}.${signal}`,
      "response",
      `/usage/${fieldPath}`,
      "success_only",
      requirements,
    ),
    contract(
      `openai.${protocol}.stream.${signal}`,
      "stream_event",
      `/usage/${fieldPath}`,
      "terminal_only",
      [
        ...requirements,
        { url: compatibilityUrl, markers: [/stream_options/, /include_usage/] },
        {
          url: middlewareUrl,
          markers: [
            writer,
            /IncludeUsage/,
            new RegExp(`openai\\.${converter}\\(`),
            /Choices\s*=\s*\[\]/,
          ],
        },
      ],
    ),
  ];
}

function responsesContracts(): Contract[] {
  return [
    ...responsesUsage(
      "input_tokens",
      "input_tokens",
      /InputTokens:\s*chatResponse\.PromptEvalCount/,
      /"input_tokens":\s*r\.PromptEvalCount/,
    ),
    ...responsesUsage(
      "cached_input_tokens",
      "input_tokens_details/cached_tokens",
      /InputTokensDetails:\s*ResponsesInputTokensDetails\{CachedTokens:\s*intValue\(chatResponse\.PromptEvalCachedCount\)\}/,
      /"cached_tokens":\s*intValue\(r\.PromptEvalCachedCount\)/,
    ),
    ...responsesUsage(
      "output_tokens",
      "output_tokens",
      /OutputTokens:\s*chatResponse\.EvalCount/,
      /"output_tokens":\s*r\.EvalCount/,
    ),
  ];
}

function responsesUsage(
  signal: "cached_input_tokens" | "input_tokens" | "output_tokens",
  fieldPath: string,
  responseMapping: RegExp,
  streamMapping: RegExp,
): Contract[] {
  const common = [
    { url: compatibilityUrl, markers: [/\/v1\/responses/] },
    { url: middlewareUrl, markers: [/ResponsesWriter/, /openai\.ToResponse/] },
  ];
  return [
    contract(`openai.responses.${signal}`, "response", `/usage/${fieldPath}`, "success_only", [
      ...common,
      { url: responsesUrl, markers: [/func ToResponse\(/, responseMapping] },
    ]),
    contract(
      `openai.responses.stream.${signal}`,
      "stream_event",
      `/response/usage/${fieldPath}`,
      "terminal_only",
      [
        ...common,
        { url: responsesUrl, markers: [/response\.completed/, streamMapping] },
        {
          url: middlewareUrl,
          markers: [/NewResponsesStreamConverter/, /Content-Type[^\n]*text\/event-stream/],
        },
      ],
    ),
  ];
}

function conversion(
  converter: "ToUsage" | "ToUsageGenerate",
  signal: "cached_input_tokens" | "input_tokens" | "output_tokens",
): RegExp {
  const prefix = `func ${converter}\\(`;
  switch (signal) {
    case "input_tokens":
      return new RegExp(`${prefix}[\\s\\S]{0,600}PromptTokens:\\s*r\\.Metrics\\.PromptEvalCount`);
    case "cached_input_tokens":
      return new RegExp(
        `${prefix}[\\s\\S]{0,900}PromptTokensDetails\\s*=\\s*&PromptTokensDetails\\{CachedTokens:\\s*\\*r\\.Metrics\\.PromptEvalCachedCount\\}`,
      );
    case "output_tokens":
      return new RegExp(`${prefix}[\\s\\S]{0,600}CompletionTokens:\\s*r\\.Metrics\\.EvalCount`);
  }
}

function contract(
  key: string,
  channel: SourcePricingInputFact["channel"],
  pointer: string,
  availability: SourcePricingInputFact["availability"],
  requirements: Contract["requirements"],
): Contract {
  return {
    fact: {
      key,
      channel,
      locator: { kind: "json_pointer", value: pointer },
      availability,
    },
    requirements,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
