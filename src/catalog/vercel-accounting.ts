import { finalizePricingInputs } from "./pricing-input.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import type { SourcePricingInputFact } from "./pricing-source.ts";
import { contractExtensionEvidence, type SourceContractEvidence } from "./source-contract.ts";

interface Contract {
  key: string;
  document: string;
  markers: readonly RegExp[];
  channel: SourcePricingInputFact["channel"];
  locator: SourcePricingInputFact["locator"];
  reduction?: SourcePricingInputFact["reduction"];
  selectorAbsentValue?: string;
  availability: SourcePricingInputFact["availability"];
}

const restPath = "/docs/ai-gateway/sdks-and-apis/rest-api.md";
const fastPath = "/docs/ai-gateway/models-and-providers/fast-mode.md";
const serviceTierPath = "/docs/ai-gateway/models-and-providers/service-tiers.md";
const regionPath = "/docs/ai-gateway/security-and-compliance/regional-inference.md";
const searchPath = "/docs/ai-gateway/models-and-providers/web-search.md";
const imagePath = "/docs/ai-gateway/getting-started/image.md";
const videoPath = "/docs/ai-gateway/modalities/video-generation.md";
const transcriptionPath = "/docs/ai-gateway/modalities/speech-to-text.md";
const rerankPath = "/docs/ai-gateway/modalities/reranking.md";

const contracts: readonly Contract[] = [
  generation("native_prompt_tokens", "native_tokens_prompt"),
  generation("native_completion_tokens", "native_tokens_completion"),
  generation("native_reasoning_tokens", "native_tokens_reasoning"),
  generation("native_cached_tokens", "native_tokens_cached"),
  generation("native_cache_creation_tokens", "native_tokens_cache_creation"),
  generation("billable_web_search_calls", "billable_web_search_calls"),
  generation("route_provider", "provider_name"),
  {
    key: "gateway.served_speed",
    document: fastPath,
    markers: [
      /providerMetadata\.gateway\.routing\.speed/,
      /only sets this field to `fast` when the request was genuinely served fast/i,
      /field is omitted/i,
    ],
    channel: "response",
    locator: { kind: "provider_field", value: "providerMetadata.gateway.routing.speed" },
    selectorAbsentValue: "standard",
    availability: "terminal_only",
  },
  {
    key: "gateway.served_service_tier",
    document: serviceTierPath,
    markers: [
      /providerMetadata\.gateway\.serviceTier/,
      /bills the request at the tier the provider actually served/i,
      /field is omitted/i,
    ],
    channel: "response",
    locator: { kind: "provider_field", value: "providerMetadata.gateway.serviceTier" },
    selectorAbsentValue: "standard",
    availability: "terminal_only",
  },
  {
    key: "gateway.served_region",
    document: regionPath,
    markers: [
      /confirm the resolved region from the response/i,
      /inferenceEndpoint/,
      /geoRegion/,
      /Leave it unset \(the `global` default\)/i,
    ],
    channel: "response",
    locator: {
      kind: "provider_field",
      value:
        "providerMetadata.gateway.routing.modelAttempts[successful].providerAttempts[successful].inferenceEndpoint.geoRegion",
    },
    selectorAbsentValue: "default",
    availability: "terminal_only",
  },
  {
    key: "image.generated_images",
    document: imagePath,
    markers: [/experimental_generateImage/, /result\.images/, /Image-only models/i],
    channel: "result",
    locator: { kind: "provider_field", value: "AiSdkGenerateImageResult.images" },
    reduction: { kind: "array_length" },
    availability: "success_only",
  },
  {
    key: "video.requested_duration_seconds",
    document: videoPath,
    markers: [/`duration`\s*\|\s*`number`/i, /Video length in seconds/i],
    channel: "request",
    locator: { kind: "provider_field", value: "AiSdkGenerateVideoRequest.duration" },
    availability: "conditional",
  },
  {
    key: "video.generated_videos",
    document: videoPath,
    markers: [/experimental_generateVideo/, /const \{ videos(?:, providerMetadata)? \}/],
    channel: "result",
    locator: { kind: "provider_field", value: "AiSdkGenerateVideoResult.videos" },
    reduction: { kind: "array_length" },
    availability: "success_only",
  },
  {
    key: "transcription.input_audio_seconds",
    document: transcriptionPath,
    markers: [/durationInSeconds/, /duration of the input audio/i],
    channel: "result",
    locator: { kind: "provider_field", value: "AiSdkTranscriptionResult.durationInSeconds" },
    availability: "success_only",
  },
  {
    key: "rerank.successful_request",
    document: rerankPath,
    markers: [/const result = await rerank/, /returns a `ranking` array/i],
    channel: "result",
    locator: { kind: "provider_field", value: "AiSdkRerankResult.ranking" },
    reduction: { kind: "presence" },
    availability: "success_only",
  },
  ...searchContracts(),
];

export function extractVercelPricingInputs(
  documents: ReadonlyMap<string, string>,
  sourceRef: string,
  onFinding?: (evidence: SourceContractEvidence) => void,
  onReconciliation?: (item: PricingReconciliationItem) => void,
): SourcePricingInputFact[] {
  const facts = contracts.flatMap((contract) => {
    const body = documents.get(contract.document);
    if (body === undefined || !contract.markers.every((marker) => marker.test(body))) {
      onFinding?.(contractExtensionEvidence([`/documents${contract.document}/${contract.key}`]));
      return [];
    }
    return [
      {
        key: contract.key,
        channel: contract.channel,
        locator: contract.locator,
        ...(contract.reduction === undefined ? {} : { reduction: contract.reduction }),
        ...(contract.selectorAbsentValue === undefined
          ? {}
          : { selector_absent_value: contract.selectorAbsentValue }),
        availability: contract.availability,
        source_ref: sourceRef,
      },
    ];
  });
  return finalizePricingInputs(facts, contracts.length, "Vercel pricing inputs", onReconciliation);
}

function generation(key: string, field: string): Contract {
  return {
    key: `generation.${key}`,
    document: restPath,
    markers: [/GET \/v1\/generation\?id=\{generation_id\}/, new RegExp(`\\b${field}\\b`)],
    channel: "result",
    locator: { kind: "json_pointer", value: `/data/${field}` },
    availability: "conditional",
  };
}

function searchContracts(): Contract[] {
  const tools = [
    ["perplexity", "perplexitySearch", "vercel:perplexity_search"],
    ["exa", "exaSearch", "vercel:exa_search"],
    ["tako", "takoSearch", "vercel:tako_search"],
    ["parallel", "parallelSearch", "vercel:parallel_search"],
  ] as const;
  const successful = tools.map(([key, sdkName, wireName]): Contract => ({
    key: `search.${key}.successful_calls`,
    document: searchPath,
    markers: [
      new RegExp(`\\b${sdkName}\\b`),
      new RegExp(wireName),
      /gatewayToolCalls.*successful search-call counts/i,
    ],
    channel: "response",
    locator: {
      kind: "provider_field",
      value: `choices[0].message.provider_metadata.gateway.gatewayToolCalls[tool=${wireName}]`,
    },
    availability: "terminal_only",
  }));
  return [
    ...successful,
    ...searchRequests("search.exa.requested_results", "exaSearch", "numResults", "num_results"),
    ...searchRequests(
      "search.parallel.requested_results",
      "parallelSearch",
      "maxResults",
      "max_results",
    ),
    ...searchRequests("search.tako.effort", "takoSearch", "effort", "effort"),
  ];
}

function searchRequests(
  key: string,
  sdkTool: string,
  sdkField: string,
  wireField: string,
): Contract[] {
  const markers = [
    new RegExp(`\\b${sdkTool}\\b`),
    new RegExp(`\\b${sdkField}\\b`),
    new RegExp(`\\b${wireField}\\b`),
  ];
  return [
    {
      key,
      document: searchPath,
      markers,
      channel: "request",
      locator: { kind: "provider_field", value: `gateway.tools.${sdkTool}.${sdkField}` },
      availability: "conditional",
    },
    {
      key,
      document: searchPath,
      markers,
      channel: "request",
      locator: {
        kind: "provider_field",
        value: `ChatCompletions.tools[].config.${wireField}`,
      },
      availability: "conditional",
    },
  ];
}
