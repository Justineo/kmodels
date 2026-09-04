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
  document: string;
  markers: readonly RegExp[];
  channel: SourcePricingInputFact["channel"];
  locator: SourcePricingInputFact["locator"];
  absentValue?: "zero";
  availability: SourcePricingInputFact["availability"];
}

const chatPath = "/help/en/model-studio/qwen-api-via-openai-chat-completions";
const nativePath = "/help/en/model-studio/qwen-api-via-dashscope";
const responsesPath = "/help/en/model-studio/qwen-api-via-openai-responses";
const batchPath = "/help/en/model-studio/batch-interfaces-compatible-with-openai";
const cachePath = "/help/en/model-studio/context-cache";
const anthropicPath = "/help/en/model-studio/anthropic-api-messages";
const imagePath = "/help/en/model-studio/qwen-image-api";
const videoPath = "/help/en/model-studio/text-to-video-api-reference";
const ttsPath = "/help/en/model-studio/qwen-tts-api";
const musicPath = "/help/en/model-studio/fun-music-api";
const asrPath = "/help/en/model-studio/non-realtime-speech-recognition-user-guide";
const asrEventsPath = "/help/en/model-studio/fun-asr-server-events";
const baseUrlPath = "/help/en/model-studio/base-url";
const webSearchPath = "/help/en/model-studio/web-search";
const imageSearchPath = "/help/en/model-studio/image-search";
const textToImageSearchPath = "/help/en/model-studio/web-search-image";

const contracts: readonly Contract[] = [
  ...chatUsage("prompt_tokens", "input_tokens"),
  ...chatUsage("completion_tokens", "output_tokens"),
  ...chatUsage("prompt_tokens_details.cached_tokens", "cached_input_tokens"),
  ...chatUsageZero("prompt_tokens_details.text_tokens", "input_text_tokens"),
  ...chatUsageZero("prompt_tokens_details.image_tokens", "input_image_tokens"),
  ...chatUsageZero("prompt_tokens_details.video_tokens", "input_video_tokens"),
  ...chatUsageZero("prompt_tokens_details.audio_tokens", "input_audio_tokens"),
  ...chatUsageZero("completion_tokens_details.text_tokens", "output_text_tokens"),
  ...chatUsageZero("completion_tokens_details.reasoning_tokens", "reasoning_tokens"),
  ...chatUsageZero("completion_tokens_details.audio_tokens", "output_audio_tokens"),
  contract(
    "chat.cache_creation_input_tokens",
    cachePath,
    "response",
    "/usage/prompt_tokens_details/cache_creation_input_tokens",
    [/prompt_tokens_details\.cache_creation_input_tokens/, /OpenAI-compatible/i],
  ),
  ...chatUsage(
    "prompt_tokens_details.cache_creation.cache_creation_input_tokens",
    "cache_creation_input_tokens",
  ),
  ...chatUsage(
    "prompt_tokens_details.cache_creation.ephemeral_5m_input_tokens",
    "cache_creation_5m_input_tokens",
  ),
  ...nativeUsage("input_tokens", "input_tokens"),
  ...nativeUsage("output_tokens", "output_tokens"),
  ...nativeUsageZero("input_tokens_details.text_tokens", "input_text_tokens"),
  ...nativeUsageZero("input_tokens_details.image_tokens", "input_image_tokens"),
  ...nativeUsageZero("image_tokens", "input_image_tokens"),
  ...nativeUsageZero("input_tokens_details.video_tokens", "input_video_tokens"),
  ...nativeUsageZero("video_tokens", "input_video_tokens"),
  ...nativeUsageZero("audio_tokens", "input_audio_tokens"),
  ...nativeUsageZero("output_tokens_details.text_tokens", "output_text_tokens"),
  ...nativeUsageZero("output_tokens_details.reasoning_tokens", "reasoning_tokens"),
  ...nativeUsageZero("output_tokens_details.audio_tokens", "output_audio_tokens"),
  ...nativeUsage("prompt_tokens_details.cached_tokens", "cached_input_tokens"),
  ...nativeUsage("cached_tokens", "cached_input_tokens"),
  contract(
    "native.cache_creation_input_tokens",
    cachePath,
    "response",
    "/usage/prompt_tokens_details/cache_creation_input_tokens",
    [/prompt_tokens_details\.cache_creation_input_tokens/, /DashScope/i],
  ),
  ...nativeUsage(
    "prompt_tokens_details.cache_creation.cache_creation_input_tokens",
    "cache_creation_input_tokens",
  ),
  ...nativeUsage(
    "prompt_tokens_details.cache_creation.ephemeral_5m_input_tokens",
    "cache_creation_5m_input_tokens",
  ),
  ...anthropicUsage("input_tokens", "input_tokens"),
  ...anthropicUsage("output_tokens", "output_tokens"),
  ...anthropicUsage("cache_read_input_tokens", "cached_input_tokens"),
  ...anthropicUsage("cache_creation_input_tokens", "cache_creation_input_tokens"),
  ...responsesUsage("input_tokens", "input_tokens"),
  ...responsesUsage("output_tokens", "output_tokens"),
  ...responsesUsage("input_tokens_details.cached_tokens", "cached_input_tokens"),
  ...responsesUsage("output_tokens_details.reasoning_tokens", "reasoning_tokens"),
  ...responsesUsage("prompt_tokens_details.cached_tokens", "session_cached_input_tokens"),
  ...responsesUsage(
    "prompt_tokens_details.cache_creation_input_tokens",
    "session_cache_creation_input_tokens",
  ),
  ...responsesUsage(
    "prompt_tokens_details.cache_creation.ephemeral_5m_input_tokens",
    "session_cache_creation_5m_input_tokens",
  ),
  ...responsesDetailedUsage("input_tokens", "input_tokens"),
  ...responsesDetailedUsage("output_tokens", "output_tokens"),
  ...responsesDetailedUsageZero("input_tokens_details.text_tokens", "input_text_tokens"),
  ...responsesDetailedUsageZero("input_tokens_details.image_tokens", "input_image_tokens"),
  ...responsesDetailedUsageZero("image_tokens", "input_image_tokens"),
  ...responsesDetailedUsageZero("output_tokens_details.text_tokens", "output_text_tokens"),
  ...responsesDetailedUsageZero("output_tokens_details.reasoning_tokens", "reasoning_tokens"),
  contract(
    "responses.stream.web_search_count",
    responsesPath,
    "stream_event",
    "/response/usage/x_tools/web_search/count",
    [/x_tools\.web_search\.count/, /response\.completed/],
  ),
  contract(
    "responses.stream.image_search_count",
    imageSearchPath,
    "stream_event",
    "/response/usage/x_tools/image_search/count",
    [/x_tools\.image_search\.count/, /response\.completed/],
  ),
  contract(
    "responses.web_search_image_count",
    textToImageSearchPath,
    "response",
    "/usage/x_tools/web_search_image/count",
    [/x_tools\.web_search_image\.count/],
  ),
  contract(
    "responses.stream.web_search_image_count",
    textToImageSearchPath,
    "stream_event",
    "/response/usage/x_tools/web_search_image/count",
    [/x_tools\.web_search_image\.count/, /response\.completed/],
  ),
  ...batchUsage("prompt_tokens", "chat.input_tokens"),
  ...batchUsage("completion_tokens", "chat.output_tokens"),
  ...batchUsage("prompt_tokens_details.cached_tokens", "chat.cached_input_tokens"),
  ...batchUsage("completion_tokens_details.reasoning_tokens", "chat.reasoning_tokens"),
  ...batchUsage("input_tokens", "responses.input_tokens"),
  ...batchUsage("output_tokens", "responses.output_tokens"),
  ...batchUsage("input_tokens_details.cached_tokens", "responses.cached_input_tokens"),
  ...batchUsage("output_tokens_details.reasoning_tokens", "responses.reasoning_tokens"),
  result("image.generated_images", imagePath, "/usage/image_count", [/image_count/]),
  result("image.width", imagePath, "/usage/width", [/\bwidth\b/]),
  result("image.height", imagePath, "/usage/height", [/\bheight\b/]),
  result("image.effective_size", imagePath, "/usage/size", [/\bsize\b/]),
  result("video.output_seconds", videoPath, "/usage/video_duration", [/video_duration/]),
  result("video.billable_seconds", videoPath, "/usage/duration", [/\bduration\b/]),
  result("video.input_seconds", videoPath, "/usage/input_video_duration", [/input_video_duration/]),
  result("video.output_seconds", videoPath, "/usage/output_video_duration", [
    /output_video_duration/,
  ]),
  result("video.effective_resolution", videoPath, "/usage/SR", [/\bSR\b/]),
  result("video.effective_size", videoPath, "/usage/size", [/\bsize\b/]),
  result("video.generated_videos", videoPath, "/usage/video_count", [/video_count/]),
  result("tts.input_characters", ttsPath, "/usage/characters", [/\bcharacters\b/]),
  result("tts.input_text_tokens", ttsPath, "/usage/input_tokens_details/text_tokens", [
    /input_tokens_details/,
    /text_tokens/,
  ]),
  result("tts.output_audio_tokens", ttsPath, "/usage/output_tokens_details/audio_tokens", [
    /output_tokens_details/,
    /audio_tokens/,
  ]),
  result("music.generated_seconds", musicPath, "/usage/duration", [/\bduration\b/]),
  result("asr.processed_audio_seconds", asrPath, "/usage/duration", [/\bduration\b/]),
  result("asr.processed_audio_seconds", asrPath, "/usage/seconds", [/\bseconds\b/]),
  contract(
    "asr.stream.processed_audio_seconds",
    asrEventsPath,
    "stream_event",
    "/payload/output/usage/duration",
    [/sentence_end/, /payload\.output\.usage\.duration/],
  ),
  contract(
    "request.resolved_region",
    baseUrlPath,
    "request",
    "HttpRequest.resolved_region",
    [/Base URL/i, /API Key/i, /region/i],
    "always",
    "provider_field",
  ),
  request("chat.enable_thinking", chatPath, "/enable_thinking", [/enable_thinking/]),
  request("native.enable_thinking", nativePath, "/parameters/enable_thinking", [/enable_thinking/]),
  request("native.prompt_extend", videoPath, "/parameters/prompt_extend", [/prompt_extend/]),
  request("batch.enable_thinking", batchPath, "/body/enable_thinking", [/enable_thinking/]),
  contract("native.web_search_count", webSearchPath, "response", "/usage/plugins/search/count", [
    /usage\.plugins\.search\.count/,
  ]),
  contract(
    "responses.web_search_count",
    webSearchPath,
    "response",
    "/usage/x_tools/web_search/count",
    [/x_tools\.web_search\.count/],
  ),
  contract(
    "responses.image_search_count",
    imageSearchPath,
    "response",
    "/usage/x_tools/image_search/count",
    [/x_tools\.image_search\.count/],
  ),
];

export function extractDashscopePricingInputs(
  documents: readonly Document[],
  sourceRef: string,
  onFinding?: (evidence: SourceContractEvidence) => void,
  onReconciliation?: (item: PricingReconciliationItem) => void,
): SourcePricingInputFact[] {
  const bodies = new Map(
    documents.map(({ url, body }) => [normalizePath(new URL(url).pathname), body]),
  );
  const facts = contracts.flatMap((item) => {
    const body = bodies.get(item.document);
    if (body === undefined || !item.markers.every((marker) => marker.test(body))) {
      onFinding?.(contractExtensionEvidence([`/documents${item.document}/${item.key}`]));
      return [];
    }
    return [
      {
        key: item.key,
        channel: item.channel,
        locator: item.locator,
        ...(item.absentValue === undefined ? {} : { absent_value: item.absentValue }),
        availability: item.availability,
        source_ref: sourceRef,
      },
    ];
  });
  return finalizePricingInputs(
    facts,
    contracts.length,
    "DashScope pricing inputs",
    onReconciliation,
  );
}

function chatUsage(field: string, key: string): Contract[] {
  return [
    contract(`chat.${key}`, chatPath, "response", `/usage/${pointer(field)}`, [marker(field)]),
    contract(`chat.stream.${key}`, chatPath, "stream_event", `/usage/${pointer(field)}`, [
      marker(field),
      /stream_options\.include_usage/,
    ]),
  ];
}

function chatUsageZero(field: string, key: string): Contract[] {
  return chatUsage(field, key).map((item) => ({ ...item, absentValue: "zero" }));
}

function nativeUsage(field: string, key: string): Contract[] {
  return [
    contract(`native.${key}`, nativePath, "response", `/usage/${pointer(field)}`, [marker(field)]),
    contract(`native.stream.${key}`, nativePath, "stream_event", `/usage/${pointer(field)}`, [
      marker(field),
      /streaming and non-streaming\s+responses use the same usage fields/i,
    ]),
  ];
}

function nativeUsageZero(field: string, key: string): Contract[] {
  return nativeUsage(field, key).map((item) => ({ ...item, absentValue: "zero" }));
}

function responsesUsage(field: string, key: string): Contract[] {
  return [
    contract(`responses.${key}`, responsesPath, "response", `/usage/${pointer(field)}`, [
      marker(field),
    ]),
    contract(
      `responses.stream.${key}`,
      responsesPath,
      "stream_event",
      `/response/usage/${pointer(field)}`,
      [marker(field), /response\.completed/],
    ),
  ];
}

function anthropicUsage(field: string, key: string): Contract[] {
  return [
    contract(`anthropic.${key}`, anthropicPath, "response", `/usage/${field}`, [
      marker(field),
      /Non-streaming Response/i,
    ]),
    contract(`anthropic.stream.${key}`, anthropicPath, "stream_event", `/usage/${field}`, [
      marker(field),
      /message_delta/,
      /Complete token usage/i,
    ]),
  ];
}

function responsesDetailedUsage(field: string, key: string): Contract[] {
  return [
    contract(
      `responses.detail.${key}`,
      responsesPath,
      "response",
      `Response.usage.x_details[x_billing_type=response_api].${field}`,
      [marker(field), /x_billing_type/],
      "terminal_only",
      "provider_field",
    ),
    contract(
      `responses.stream.detail.${key}`,
      responsesPath,
      "stream_event",
      `response.completed.response.usage.x_details[x_billing_type=response_api].${field}`,
      [marker(field), /x_billing_type/, /response\.completed/],
      "terminal_only",
      "provider_field",
    ),
  ];
}

function responsesDetailedUsageZero(field: string, key: string): Contract[] {
  return responsesDetailedUsage(field, key).map((item) => ({ ...item, absentValue: "zero" }));
}

function batchUsage(field: string, key: string): Contract[] {
  return [
    contract(`batch.${key}`, batchPath, "result", `/response/body/usage/${pointer(field)}`, [
      marker(field),
      /response\.body\.usage/,
    ]),
  ];
}

function result(key: string, document: string, path: string, markers: readonly RegExp[]): Contract {
  return contract(key, document, "result", path, markers, "success_only");
}

function request(
  key: string,
  document: string,
  path: string,
  markers: readonly RegExp[],
): Contract {
  return contract(key, document, "request", path, markers, "conditional");
}

function contract(
  key: string,
  document: string,
  channel: SourcePricingInputFact["channel"],
  path: string,
  markers: readonly RegExp[],
  availability: SourcePricingInputFact["availability"] = "terminal_only",
  kind: "json_pointer" | "provider_field" = "json_pointer",
): Contract {
  return { key, document, markers, channel, locator: { kind, value: path }, availability };
}

function pointer(field: string): string {
  return field.replaceAll(".", "/");
}

function marker(field: string): RegExp {
  return new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

function normalizePath(path: string): string {
  return path.replace(/\.md$/, "").replace(/\/$/, "");
}
