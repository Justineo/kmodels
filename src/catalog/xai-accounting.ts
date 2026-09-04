import { finalizePricingInputs } from "./pricing-input.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import type { SourcePricingInputFact } from "./pricing-source.ts";
import { contractExtensionEvidence, type SourceContractEvidence } from "./source-contract.ts";

interface Contract {
  key: string;
  channel: SourcePricingInputFact["channel"];
  locator: SourcePricingInputFact["locator"];
  availability: SourcePricingInputFact["availability"];
  sections: readonly SectionRequirement[];
  reduction?: SourcePricingInputFact["reduction"];
  absentValue?: SourcePricingInputFact["absent_value"];
}

interface SectionRequirement {
  path: string;
  markers: readonly RegExp[];
}

const chatPath = "/developers/rest-api-reference/inference/chat";
const costPath = "/developers/cost-tracking";
const batchPath = "/developers/advanced-api-usage/batch-api";
const toolPath = "/developers/tools/tool-usage-details";
const imagePath = "/developers/rest-api-reference/inference/images";
const videoPath = "/developers/rest-api-reference/inference/videos";
const voicePath = "/developers/rest-api-reference/inference/voice";
const realtimePath = "/developers/model-capabilities/audio/speech-to-speech";

const contracts: readonly Contract[] = [
  ...chatUsageContracts("response"),
  ...chatStreamContracts(),
  ...responsesUsageContracts("response"),
  providerField(
    "sdk.agent.prompt_text_tokens",
    "response",
    "ChatResponse.usage.prompt_text_tokens",
    toolPath,
    [/\bprompt_text_tokens\b/, /\bprompt_image_tokens\b/],
  ),
  providerField(
    "sdk.agent.prompt_tokens",
    "response",
    "ChatResponse.usage.prompt_tokens",
    toolPath,
    [/\bprompt_tokens\b/, /\bprompt_image_tokens\b/],
  ),
  providerField(
    "sdk.agent.cached_prompt_text_tokens",
    "response",
    "ChatResponse.usage.cached_prompt_text_tokens",
    toolPath,
    [/\bcached_prompt_text_tokens\b/],
  ),
  providerField(
    "sdk.agent.prompt_image_tokens",
    "response",
    "ChatResponse.usage.prompt_image_tokens",
    toolPath,
    [/\bprompt_image_tokens\b/],
  ),
  providerField(
    "sdk.agent.completion_tokens",
    "response",
    "ChatResponse.usage.completion_tokens",
    toolPath,
    [/\bcompletion_tokens\b/],
  ),
  providerField(
    "sdk.agent.reasoning_tokens",
    "response",
    "ChatResponse.usage.reasoning_tokens",
    toolPath,
    [/\breasoning_tokens\b/],
  ),
  ...toolContracts(),
  {
    key: "image.generated_images",
    channel: "response",
    locator: { kind: "json_pointer", value: "/data" },
    reduction: { kind: "array_length" },
    availability: "success_only",
    sections: [{ path: imagePath, markers: [/\bdata\b[^\n]*\barray\b/i] }],
  },
  providerField(
    "imagine.accepted_input_images",
    "request",
    "ImagineRequest.accepted_input_images",
    imagePath,
    [/\bimages?\b/, /image edit/i],
    { availability: "always" },
  ),
  providerField(
    "image.effective_resolution",
    "request",
    "ImagineRequest.effective_resolution",
    imagePath,
    [/\bresolution\b/],
    { availability: "always" },
  ),
  providerField(
    "image.effective_quality",
    "request",
    "ImagineRequest.effective_quality",
    imagePath,
    [/\bquality\b/],
    { availability: "always" },
  ),
  {
    key: "video.generated_seconds",
    channel: "result",
    locator: { kind: "json_pointer", value: "/video/duration" },
    availability: "success_only",
    sections: [{ path: videoPath, markers: [/"status"\s*:\s*"done"/, /"video"[\s\S]*"duration"/] }],
  },
  providerField(
    "video.accepted_input_images",
    "request",
    "VideoRequest.accepted_input_images",
    videoPath,
    [/\bimage\b/, /request body/i],
    { availability: "always" },
  ),
  providerField(
    "video.accepted_input_video_seconds",
    "request",
    "VideoRequest.accepted_input_video_seconds",
    videoPath,
    [/\bvideo\b/, /video input/i],
    { availability: "always" },
  ),
  providerField(
    "video.effective_resolution",
    "request",
    "VideoRequest.effective_output_resolution",
    videoPath,
    [/\bresolution\b/],
    { availability: "always" },
  ),
  providerField(
    "realtime.accepted_input_audio_seconds",
    "request",
    "RealtimeSession.accepted_input_audio_seconds",
    realtimePath,
    [/audio duration/i, /audio sent or received/i],
    { availability: "always" },
  ),
  providerField(
    "realtime.emitted_output_audio_seconds",
    "stream_event",
    "RealtimeSession.emitted_output_audio_seconds",
    realtimePath,
    [/audio duration/i, /audio sent or received/i],
    { availability: "terminal_only" },
  ),
  providerField(
    "realtime.billable_text_input_events",
    "request",
    "RealtimeSession.billable_conversation_item_create_events",
    realtimePath,
    [/conversation\.item\.create/, /function_call_output/, /input_audio/],
    { availability: "always" },
  ),
  providerField(
    "tts.rest.input_characters",
    "request",
    "TtsRequest.accepted_billing_characters",
    voicePath,
    [/text to speech/i, /\btext\b[^\n]*\bstring\b/i, /character/i],
    { availability: "always" },
  ),
  providerField(
    "tts.streaming.input_characters",
    "request",
    "TtsStream.accepted_text_delta_billing_characters",
    voicePath,
    [/text\.delta/, /text\.done/, /character/i],
    { availability: "always" },
  ),
  jsonPointer(
    "stt.rest.audio_seconds",
    "response",
    "/duration",
    voicePath,
    [/speech to text - rest/i, /duration[^\n]*audio duration/i],
    { availability: "success_only" },
  ),
  jsonPointer(
    "stt.streaming.audio_seconds",
    "stream_event",
    "/duration",
    voicePath,
    [/transcript\.done/, /duration is always present/i],
    { availability: "terminal_only" },
  ),
  providerField(
    "responses.image_generation.completed_images",
    "response",
    "Response.output[type=image_generation_call,result].length",
    "/developers/tools/image-generation",
    [/image_generation_call/, /\bresult\b/],
    { availability: "success_only" },
  ),
  ...batchUsageContracts(),
];

export function extractXaiPricingInputs(
  llms: string,
  sourceRef: string,
  onFinding?: (evidence: SourceContractEvidence) => void,
  onReconciliation?: (item: PricingReconciliationItem) => void,
): SourcePricingInputFact[] {
  const sections = splitSections(llms);
  const facts = contracts.flatMap((contract) => {
    const present = contract.sections.every(({ path, markers }) => {
      const body = sections.get(path);
      return body !== undefined && markers.every((marker) => marker.test(body));
    });
    if (!present) {
      onFinding?.(
        contractExtensionEvidence([
          `/documents${contract.sections.map(({ path }) => path).join("+")}/${contract.key}`,
        ]),
      );
      return [];
    }
    return [
      {
        key: contract.key,
        channel: contract.channel,
        locator: contract.locator,
        ...(contract.reduction === undefined ? {} : { reduction: contract.reduction }),
        ...(contract.absentValue === undefined ? {} : { absent_value: contract.absentValue }),
        availability: contract.availability,
        source_ref: sourceRef,
      },
    ];
  });
  return finalizePricingInputs(facts, contracts.length, "xAI pricing inputs", onReconciliation);
}

function chatUsageContracts(channel: "response" | "result"): Contract[] {
  const path = channel === "response" ? chatPath : batchPath;
  const prefix = channel === "response" ? "chat" : "batch.chat";
  const wrap = channel === "response" ? (value: string) => value : batchChatField;
  return [
    contract(
      `${prefix}.usage.prompt_text_tokens`,
      channel,
      wrap("usage.prompt_tokens_details.text_tokens"),
      path,
      [/prompt_tokens_details[\s\S]*text_tokens/],
    ),
    contract(
      `${prefix}.usage.cached_prompt_text_tokens`,
      channel,
      wrap("usage.prompt_tokens_details.cached_tokens"),
      path,
      [/prompt_tokens_details[\s\S]*cached_tokens/],
    ),
    contract(
      `${prefix}.usage.prompt_image_tokens`,
      channel,
      wrap("usage.prompt_tokens_details.image_tokens"),
      path,
      [/prompt_tokens_details[\s\S]*image_tokens/],
    ),
    contract(`${prefix}.usage.completion_tokens`, channel, wrap("usage.completion_tokens"), path, [
      /\bcompletion_tokens\b/,
    ]),
    contract(
      `${prefix}.usage.reasoning_tokens`,
      channel,
      wrap("usage.completion_tokens_details.reasoning_tokens"),
      path,
      [/completion_tokens_details[\s\S]*reasoning_tokens/],
    ),
    contract(`${prefix}.usage.prompt_tokens`, channel, wrap("usage.prompt_tokens"), path, [
      /\bprompt_tokens\b/,
    ]),
    ...(channel === "response"
      ? [
          jsonPointer("chat.served_service_tier", "response", "/service_tier", chatPath, [
            /chat\.completion[\s\S]*service_tier/,
          ]),
        ]
      : []),
  ];
}

function chatStreamContracts(): Contract[] {
  return chatUsageContracts("response")
    .filter(({ key }) => key !== "chat.served_service_tier")
    .map((value) => ({
      ...value,
      key: value.key.replace("chat.", "chat.stream."),
      channel: "stream_event",
      availability: "terminal_only",
      sections: [
        ...value.sections,
        { path: costPath, markers: [/stream_options/, /include_usage/, /final chunk/i] },
      ],
    }));
}

function responsesUsageContracts(channel: "response" | "result"): Contract[] {
  const path = channel === "response" ? chatPath : batchPath;
  const prefix = channel === "response" ? "responses" : "batch.responses";
  const wrap = channel === "response" ? (value: string) => value : batchResponsesField;
  return [
    contract(`${prefix}.usage.input_tokens`, channel, wrap("usage.input_tokens"), path, [
      /\binput_tokens\b/,
    ]),
    contract(
      `${prefix}.usage.cached_input_tokens`,
      channel,
      wrap("usage.input_tokens_details.cached_tokens"),
      path,
      [/input_tokens_details[\s\S]*cached_tokens/],
    ),
    contract(`${prefix}.usage.output_tokens`, channel, wrap("usage.output_tokens"), path, [
      /\boutput_tokens\b/,
    ]),
    ...(channel === "response"
      ? [
          jsonPointer("responses.served_service_tier", "response", "/service_tier", chatPath, [
            /"object"\s*:\s*"response"[\s\S]*service_tier/,
          ]),
        ]
      : []),
  ];
}

function toolContracts(): Contract[] {
  return [
    ["web_search", "SERVER_SIDE_TOOL_WEB_SEARCH"],
    ["x_search", "SERVER_SIDE_TOOL_X_SEARCH"],
    ["code_execution", "SERVER_SIDE_TOOL_CODE_EXECUTION"],
    ["collections_search", "SERVER_SIDE_TOOL_COLLECTIONS_SEARCH"],
  ].map(([key, category]) =>
    providerField(
      `sdk.server_side_tool_usage.${key}`,
      "response",
      `ChatResponse.server_side_tool_usage.${category}`,
      toolPath,
      [new RegExp(`\\b${category}\\b`), /successful calls \(billable\)/i],
      { availability: "terminal_only" },
    ),
  );
}

function batchUsageContracts(): Contract[] {
  return [
    ...chatUsageContracts("result"),
    ...responsesUsageContracts("result"),
    providerField(
      "batch.image.generated_images",
      "result",
      "BatchResult.image_response.data",
      batchPath,
      [/result\.image_response/, /\busage\b/, /\bmodel\b/],
      { reduction: { kind: "array_length" }, availability: "success_only" },
    ),
    providerField(
      "batch.video.generated_seconds",
      "result",
      "BatchResult.video_response.duration",
      batchPath,
      [/result\.video_response/, /\bduration\b/, /\busage\b/],
      { availability: "success_only" },
    ),
  ];
}

function contract(
  key: string,
  channel: SourcePricingInputFact["channel"],
  field: string,
  path: string,
  markers: readonly RegExp[],
): Contract {
  const locator =
    channel === "result"
      ? ({ kind: "provider_field", value: field } as const)
      : ({ kind: "json_pointer", value: `/${field.replaceAll(".", "/")}` } as const);
  return { key, channel, locator, availability: "terminal_only", sections: [{ path, markers }] };
}

function jsonPointer(
  key: string,
  channel: SourcePricingInputFact["channel"],
  value: string,
  path: string,
  markers: readonly RegExp[],
  options: Pick<Contract, "availability"> = { availability: "terminal_only" },
): Contract {
  return {
    key,
    channel,
    locator: { kind: "json_pointer", value },
    availability: options.availability,
    sections: [{ path, markers }],
  };
}

function providerField(
  key: string,
  channel: SourcePricingInputFact["channel"],
  value: string,
  path: string,
  markers: readonly RegExp[],
  options: Pick<Contract, "absentValue" | "availability" | "reduction"> = {
    availability: "terminal_only",
  },
): Contract {
  return {
    key,
    channel,
    locator: { kind: "provider_field", value },
    availability: options.availability,
    sections: [{ path, markers }],
    ...(options.reduction === undefined ? {} : { reduction: options.reduction }),
    ...(options.absentValue === undefined ? {} : { absentValue: options.absentValue }),
  };
}

function batchChatField(value: string): string {
  return `BatchResult.response.chat_get_completion.${value}`;
}

function batchResponsesField(value: string): string {
  return `BatchResult.response.responses_get_response.${value}`;
}

function splitSections(body: string): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  const matches = [...body.matchAll(/^===([^=\n]+)===\s*$/gm)];
  for (const [index, match] of matches.entries()) {
    const path = match[1];
    if (path === undefined || match.index === undefined)
      throw new Error("xAI accounting section marker was malformed");
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? body.length;
    if (result.has(path)) throw new Error(`xAI accounting duplicated ${path}`);
    result.set(path, body.slice(start, end).trim());
  }
  return result;
}
