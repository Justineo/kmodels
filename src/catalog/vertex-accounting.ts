import { load } from "cheerio";
import { z } from "zod";
import { finalizePricingInputs } from "./pricing-input.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import type { SourcePricingInputFact } from "./pricing-source.ts";
import { contractExtensionEvidence, type SourceContractEvidence } from "./source-contract.ts";

type Document = { url: string; body: string };
type Finding = (evidence: SourceContractEvidence) => void;
type Reconcile = (item: PricingReconciliationItem) => void;

interface DiscoveryContract {
  key: string;
  required: readonly (readonly [string, string])[];
  requiredEnum?: readonly [string, string, readonly string[]] | undefined;
  locator: SourcePricingInputFact["locator"];
  reduction?: SourcePricingInputFact["reduction"] | undefined;
  absentValue?: "zero" | undefined;
  availability?: SourcePricingInputFact["availability"] | undefined;
}

const schemaPrefix = "GoogleCloudAiplatformV1beta1";
const responseSchema = `${schemaPrefix}GenerateContentResponse`;
const usageSchema = `${responseSchema}UsageMetadata`;
const modalitySchema = `${schemaPrefix}ModalityTokenCount`;
const groundingSchema = `${schemaPrefix}GroundingMetadata`;
const discoveryPath = "/$discovery/rest";
const batchPath =
  "/gemini-enterprise-agent-platform/models/capabilities/batch-inference/new-job-from-cloud-storage";
const claudePath = "/gemini-enterprise-agent-platform/models/partner-models/claude/use-claude";
const claudeSearchPath =
  "/gemini-enterprise-agent-platform/models/partner-models/claude/web-search";
const responsesPath = "/gemini-enterprise-agent-platform/models/partner-models/grok/responses";
const chatPath = "/gemini-enterprise-agent-platform/models/maas/call-open-model-apis";
const imagePath = "/vertex-ai/generative-ai/docs/image/generate-images";
const imageResolutionPath = "/vertex-ai/generative-ai/docs/image/set-output-resolution";
const videoPath = "/vertex-ai/generative-ai/docs/model-reference/veo-video-generation";

const discoverySchema = z.object({
  resources: z.object({
    projects: z.object({
      resources: z.object({
        locations: z.object({
          resources: z.object({
            publishers: z.object({
              resources: z.object({
                models: z.object({
                  methods: z.record(
                    z.string(),
                    z.object({ response: z.object({ $ref: z.string().min(1) }) }),
                  ),
                }),
              }),
            }),
          }),
        }),
      }),
    }),
  }),
  schemas: z.record(z.string(), z.object({ properties: z.record(z.string(), z.unknown()) })),
});

const modalities = ["TEXT", "IMAGE", "VIDEO", "AUDIO", "DOCUMENT"] as const;

export function extractVertexPricingInputs(
  documents: readonly Document[],
  sourceRef: string,
  onFinding?: Finding,
  onReconciliation?: Reconcile,
): SourcePricingInputFact[] {
  const bodies = documentsByPath(documents);
  const facts = [
    ...discoveryInputs(bodies, sourceRef, onFinding),
    ...partnerInputs(bodies, sourceRef, onFinding),
    ...mediaInputs(bodies, sourceRef, onFinding),
  ];
  const expected = expectedInputCount();
  return finalizePricingInputs(facts, expected, "Agent Platform pricing inputs", onReconciliation);
}

function discoveryInputs(
  bodies: ReadonlyMap<string, string>,
  sourceRef: string,
  onFinding?: Finding,
): SourcePricingInputFact[] {
  const body = bodies.get(discoveryPath);
  const discovery = parseDiscovery(body);
  if (discovery === undefined) {
    finding(onFinding, "/documents/$discovery/rest");
    return [];
  }
  const facts: SourcePricingInputFact[] = [];
  const contracts = discoveryContracts();
  const methods =
    discovery.resources.projects.resources.locations.resources.publishers.resources.models.methods;
  const channels: Array<{
    method: string;
    channel: SourcePricingInputFact["channel"];
    target: string;
    availability: SourcePricingInputFact["availability"];
  }> = [
    {
      method: "generateContent",
      channel: "response",
      target: "GenerateContentResponse",
      availability: "terminal_only",
    },
    {
      method: "streamGenerateContent",
      channel: "stream_event",
      target: "GenerateContentResponse",
      availability: "terminal_only",
    },
  ];
  if (batchContract(bodies.get(batchPath)))
    channels.push({
      method: "generateContent",
      channel: "result",
      target: "BatchPredictionOutput JSONL[*].response",
      availability: "success_only",
    });
  else finding(onFinding, `/documents${batchPath}/output/response/usageMetadata`);

  for (const contract of contracts) {
    if (!discoveryContractAvailable(discovery.schemas, contract)) {
      finding(onFinding, `/documents/$discovery/rest/contracts/${contract.key}`);
      continue;
    }
    for (const channel of channels) {
      if (methods[channel.method]?.response.$ref !== responseSchema) {
        finding(onFinding, `/documents/$discovery/rest/methods/${channel.method}/response`);
        continue;
      }
      facts.push(
        inputFact(
          sourceRef,
          contract.key,
          channel.channel,
          retarget(contract.locator, channel.target),
          {
            availability: channel.availability,
            reduction: contract.reduction,
            absentValue: contract.absentValue,
          },
        ),
      );
    }
  }

  if (methods.embedContent?.response.$ref !== `${schemaPrefix}EmbedContentResponse`) {
    finding(onFinding, "/documents/$discovery/rest/methods/embedContent/response");
  } else {
    for (const contract of embeddingContracts())
      if (discoveryContractAvailable(discovery.schemas, contract))
        facts.push(
          inputFact(sourceRef, contract.key, "response", contract.locator, {
            availability: "terminal_only",
            absentValue: contract.absentValue,
          }),
        );
      else finding(onFinding, `/documents/$discovery/rest/contracts/${contract.key}`);
  }
  return facts;
}

function discoveryContracts(): DiscoveryContract[] {
  const usage: DiscoveryContract[] = [
    scalar("generate.prompt.total", "promptTokenCount"),
    scalar("generate.cache.total", "cachedContentTokenCount", true),
    scalar("generate.candidates.total", "candidatesTokenCount"),
    scalar("generate.thoughts", "thoughtsTokenCount", true),
    scalar("generate.tool_prompt.total", "toolUsePromptTokenCount", true),
    {
      ...scalar("generate.service_tier", "trafficType"),
      requiredEnum: [
        usageSchema,
        "trafficType",
        ["ON_DEMAND", "ON_DEMAND_PRIORITY", "ON_DEMAND_FLEX", "ON_DEMAND_OFFPEAK"],
      ],
    },
    ...modalities.flatMap((modality) => [
      modalityContract("prompt", "promptTokensDetails", modality),
      modalityContract("cache", "cacheTokensDetails", modality),
      modalityContract("candidates", "candidatesTokensDetails", modality),
      modalityContract("tool_prompt", "toolUsePromptTokensDetails", modality),
    ]),
  ];
  const contracts: DiscoveryContract[] = [
    ...usage,
    {
      key: "generate.output.images",
      required: [
        [responseSchema, "candidates"],
        [`${schemaPrefix}Candidate`, "content"],
        [`${schemaPrefix}Content`, "parts"],
        [`${schemaPrefix}Part`, "inlineData"],
        [`${schemaPrefix}Blob`, "mimeType"],
      ],
      locator: {
        kind: "provider_field",
        value:
          "GenerateContentResponse.candidates[*].content.parts[*].inlineData[mimeType=image/*]",
      },
      reduction: { kind: "array_length" },
      absentValue: "zero",
      availability: "success_only",
    },
    grounding(
      "google_search_queries",
      "webSearchQueries",
      "GenerateContentResponse.candidates[*].groundingMetadata.webSearchQueries[*]",
      { kind: "count_unique_non_empty_strings" },
    ),
    grounding(
      "google_image_search_queries",
      "imageSearchQueries",
      "GenerateContentResponse.candidates[*].groundingMetadata.imageSearchQueries[*]",
      { kind: "count_unique_non_empty_strings" },
    ),
    groundingResult("google_search_result", "web", `${schemaPrefix}Web`, "uri"),
    groundingResult("google_maps_result", "maps", `${schemaPrefix}Maps`, "placeId"),
    groundingResult(
      "agent_search_result",
      "retrievedContext",
      `${schemaPrefix}RetrievedContext`,
      "uri",
    ),
  ];
  return contracts;
}

function scalar(key: string, property: string, absent = false): DiscoveryContract {
  return {
    key,
    required: [
      [responseSchema, "usageMetadata"],
      [usageSchema, property],
    ],
    locator: { kind: "json_pointer", value: `/usageMetadata/${property}` },
    ...(absent ? { absentValue: "zero" as const } : {}),
  };
}

function modalityContract(
  category: "prompt" | "cache" | "candidates" | "tool_prompt",
  property: string,
  modality: (typeof modalities)[number],
): DiscoveryContract {
  return {
    key: `generate.${category}.${modality.toLowerCase()}`,
    required: [
      [responseSchema, "usageMetadata"],
      [usageSchema, property],
      [modalitySchema, "modality"],
      [modalitySchema, "tokenCount"],
    ],
    requiredEnum: [modalitySchema, "modality", [modality]],
    locator: {
      kind: "provider_field",
      value: `GenerateContentResponse.usageMetadata.${property}[modality=${modality}].tokenCount`,
    },
    absentValue: "zero",
  };
}

function grounding(
  suffix: string,
  property: string,
  value: string,
  reduction: NonNullable<SourcePricingInputFact["reduction"]>,
): DiscoveryContract {
  return {
    key: `generate.grounding.${suffix}`,
    required: [
      [responseSchema, "candidates"],
      [`${schemaPrefix}Candidate`, "groundingMetadata"],
      [groundingSchema, property],
    ],
    locator: { kind: "provider_field", value },
    reduction,
    absentValue: "zero",
  };
}

function groundingResult(
  suffix: string,
  chunkProperty: string,
  detailSchema: string,
  detailProperty: string,
): DiscoveryContract {
  return {
    key: `generate.grounding.${suffix}`,
    required: [
      [responseSchema, "candidates"],
      [`${schemaPrefix}Candidate`, "groundingMetadata"],
      [groundingSchema, "groundingChunks"],
      [`${schemaPrefix}GroundingChunk`, chunkProperty],
      [detailSchema, detailProperty],
    ],
    locator: {
      kind: "provider_field",
      value: `GenerateContentResponse.candidates[*].groundingMetadata.groundingChunks[*].${chunkProperty}.${detailProperty}`,
    },
    reduction: { kind: "presence" },
    absentValue: "zero",
  };
}

function embeddingContracts(): DiscoveryContract[] {
  const base = (key: string, property: string): DiscoveryContract => ({
    key: `embedding.prompt.${key}`,
    required: [
      [`${schemaPrefix}EmbedContentResponse`, "usageMetadata"],
      [`${schemaPrefix}UsageMetadata`, property],
    ],
    locator: { kind: "json_pointer", value: `/usageMetadata/${property}` },
  });
  return [
    base("total", "promptTokenCount"),
    ...modalities.map((modality): DiscoveryContract => ({
      key: `embedding.prompt.${modality.toLowerCase()}`,
      required: [
        [`${schemaPrefix}EmbedContentResponse`, "usageMetadata"],
        [`${schemaPrefix}UsageMetadata`, "promptTokensDetails"],
        [modalitySchema, "modality"],
        [modalitySchema, "tokenCount"],
      ],
      requiredEnum: [modalitySchema, "modality", [modality]],
      locator: {
        kind: "provider_field",
        value: `EmbedContentResponse.usageMetadata.promptTokensDetails[modality=${modality}].tokenCount`,
      },
      absentValue: "zero",
    })),
  ];
}

function partnerInputs(
  bodies: ReadonlyMap<string, string>,
  sourceRef: string,
  onFinding?: Finding,
): SourcePricingInputFact[] {
  const facts: SourcePricingInputFact[] = [];
  const claude = normalizedText(bodies.get(claudePath));
  const claudeSearch = normalizedText(bodies.get(claudeSearchPath));
  for (const [key, field] of [
    ["claude.input_tokens", "input_tokens"],
    ["claude.cache_write_tokens", "cache_creation_input_tokens"],
    ["claude.cache_read_tokens", "cache_read_input_tokens"],
    ["claude.output_tokens", "output_tokens"],
  ] as const) {
    if (!claude.includes(field) && !claudeSearch.includes(field)) {
      finding(onFinding, `/documents${claudePath}/usage/${field}`);
      continue;
    }
    for (const channel of ["response", "stream_event"] as const)
      facts.push(
        inputFact(sourceRef, key, channel, {
          kind: "json_pointer",
          value: `/usage/${field}`,
        }),
      );
  }
  if (claudeSearch.includes("web_search_requests"))
    for (const channel of ["response", "stream_event"] as const)
      facts.push(
        inputFact(
          sourceRef,
          "claude.web_search_requests",
          channel,
          {
            kind: "json_pointer",
            value: "/usage/server_tool_use/web_search_requests",
          },
          { absentValue: "zero" },
        ),
      );
  else
    finding(onFinding, `/documents${claudeSearchPath}/usage/server_tool_use/web_search_requests`);

  const responses = normalizedText(bodies.get(responsesPath));
  for (const [key, field, pointer] of [
    ["responses.input_tokens", "input_tokens", "/usage/input_tokens"],
    ["responses.cached_input_tokens", "cached_tokens", "/usage/input_tokens_details/cached_tokens"],
    ["responses.output_tokens", "output_tokens", "/usage/output_tokens"],
    [
      "responses.reasoning_tokens",
      "reasoning_tokens",
      "/usage/output_tokens_details/reasoning_tokens",
    ],
    [
      "responses.served_service_tier",
      "traffic_type",
      "/usage/extra_properties/google/traffic_type",
    ],
    [
      "responses.server_tool_calls",
      "num_server_side_tools_used",
      "/usage/num_server_side_tools_used",
    ],
    ["responses.sources", "num_sources_used", "/usage/num_sources_used"],
  ] as const) {
    if (!responses.includes(field)) {
      finding(onFinding, `/documents${responsesPath}/usage/${field}`);
      continue;
    }
    facts.push(inputFact(sourceRef, key, "response", { kind: "json_pointer", value: pointer }));
    if (responses.includes("response.completed"))
      facts.push(
        inputFact(sourceRef, key, "stream_event", {
          kind: "provider_field",
          value: `ResponseCompletedEvent.response${pointer.replace(/^\/usage/u, ".usage").replaceAll("/", ".")}`,
        }),
      );
  }

  const chat = normalizedText(bodies.get(chatPath));
  for (const [key, field] of [
    ["chat.input_tokens", "prompt_tokens"],
    ["chat.output_tokens", "completion_tokens"],
  ] as const) {
    if (!chat.includes(field)) {
      finding(onFinding, `/documents${chatPath}/usage/${field}`);
      continue;
    }
    facts.push(
      inputFact(sourceRef, key, "response", {
        kind: "json_pointer",
        value: `/usage/${field}`,
      }),
    );
    if (chat.includes("data: [DONE]"))
      facts.push(
        inputFact(sourceRef, key, "stream_event", {
          kind: "json_pointer",
          value: `/usage/${field}`,
        }),
      );
  }
  if ([claude, responses, chat].some((body) => /locations\/(?:\{?location\}?|global)/iu.test(body)))
    facts.push(
      inputFact(
        sourceRef,
        "request.location",
        "request",
        { kind: "provider_field", value: "RequestEndpoint.location" },
        { availability: "always" },
      ),
    );
  else finding(onFinding, "/documents/request-endpoints/location");
  return facts;
}

function mediaInputs(
  bodies: ReadonlyMap<string, string>,
  sourceRef: string,
  onFinding?: Finding,
): SourcePricingInputFact[] {
  const facts: SourcePricingInputFact[] = [];
  const image = normalizedText(bodies.get(imagePath));
  const imageResolution = normalizedText(bodies.get(imageResolutionPath));
  addDocumentedFact(
    facts,
    sourceRef,
    image,
    "sampleCount",
    "imagen.request.images",
    "request",
    {
      kind: "json_pointer",
      value: "/parameters/sampleCount",
    },
    onFinding,
    imagePath,
  );
  addDocumentedFact(
    facts,
    sourceRef,
    image,
    "predictions",
    "imagen.response.images",
    "response",
    { kind: "json_pointer", value: "/predictions" },
    onFinding,
    imagePath,
    { reduction: { kind: "array_length" }, absentValue: "zero", availability: "success_only" },
  );
  addDocumentedFact(
    facts,
    sourceRef,
    imageResolution,
    "sampleImageSize",
    "imagen.request.resolution",
    "request",
    { kind: "json_pointer", value: "/parameters/sampleImageSize" },
    onFinding,
    imageResolutionPath,
    { availability: "conditional" },
  );

  const video = normalizedText(bodies.get(videoPath));
  for (const [key, field] of [
    ["video.request.duration_seconds", "durationSeconds"],
    ["video.request.videos", "sampleCount"],
    ["video.request.resolution", "resolution"],
    ["video.request.generate_audio", "generateAudio"],
  ] as const)
    addDocumentedFact(
      facts,
      sourceRef,
      video,
      field,
      key,
      "request",
      { kind: "json_pointer", value: `/parameters/${field}` },
      onFinding,
      videoPath,
      { availability: "conditional" },
    );
  addDocumentedFact(
    facts,
    sourceRef,
    video,
    '"videos"',
    "video.result.videos",
    "result",
    { kind: "provider_field", value: "FetchPredictOperationResponse.response.videos[*]" },
    onFinding,
    videoPath,
    { reduction: { kind: "array_length" }, absentValue: "zero", availability: "success_only" },
  );
  return facts;
}

function addDocumentedFact(
  facts: SourcePricingInputFact[],
  sourceRef: string,
  body: string,
  field: string,
  key: string,
  channel: SourcePricingInputFact["channel"],
  locator: SourcePricingInputFact["locator"],
  onFinding: Finding | undefined,
  path: string,
  options: InputOptions = {},
): void {
  if (!body.includes(field)) {
    finding(onFinding, `/documents${path}/${field.replaceAll('"', "")}`);
    return;
  }
  facts.push(inputFact(sourceRef, key, channel, locator, options));
}

interface InputOptions {
  availability?: SourcePricingInputFact["availability"] | undefined;
  reduction?: SourcePricingInputFact["reduction"] | undefined;
  absentValue?: "zero" | undefined;
}

function inputFact(
  sourceRef: string,
  key: string,
  channel: SourcePricingInputFact["channel"],
  locator: SourcePricingInputFact["locator"],
  options: InputOptions = {},
): SourcePricingInputFact {
  return {
    key,
    channel,
    locator,
    ...(options.reduction === undefined ? {} : { reduction: options.reduction }),
    ...(options.absentValue === undefined ? {} : { absent_value: options.absentValue }),
    availability: options.availability ?? "terminal_only",
    source_ref: sourceRef,
  };
}

function documentsByPath(documents: readonly Document[]): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  for (const document of documents) {
    const path = new URL(document.url).pathname;
    if (result.has(path)) throw new Error(`Agent Platform accounting duplicated ${path}`);
    result.set(path, document.body);
  }
  return result;
}

function parseDiscovery(body: string | undefined): z.infer<typeof discoverySchema> | undefined {
  if (body === undefined) return;
  try {
    const result = discoverySchema.safeParse(JSON.parse(body));
    return result.success ? result.data : undefined;
  } catch {
    return;
  }
}

function discoveryContractAvailable(
  schemas: z.infer<typeof discoverySchema>["schemas"],
  contract: DiscoveryContract,
): boolean {
  if (
    !contract.required.every(
      ([schema, property]) => schemas[schema]?.properties[property] !== undefined,
    )
  )
    return false;
  if (contract.requiredEnum === undefined) return true;
  const [schema, property, values] = contract.requiredEnum;
  const parsed = z
    .object({ enum: z.array(z.string()) })
    .safeParse(schemas[schema]?.properties[property]);
  return parsed.success && values.every((value) => parsed.data.enum.includes(value));
}

function retarget(
  locator: SourcePricingInputFact["locator"],
  target: string,
): SourcePricingInputFact["locator"] {
  if (target === "GenerateContentResponse") return locator;
  const suffix =
    locator.kind === "json_pointer"
      ? locator.value.slice(1).replaceAll("/", ".")
      : locator.value.slice("GenerateContentResponse.".length);
  return { kind: "provider_field", value: `${target}.${suffix}` };
}

function batchContract(body: string | undefined): boolean {
  const value = normalizedText(body);
  return value.includes('"response"') && value.includes('"usageMetadata"');
}

function normalizedText(body: string | undefined): string {
  return body === undefined ? "" : load(body).text().replace(/\s+/gu, " ").trim();
}

function finding(onFinding: Finding | undefined, path: string): void {
  onFinding?.(contractExtensionEvidence([path]));
}

function expectedInputCount(): number {
  const generateContracts = discoveryContracts().length;
  const generateChannels = 3;
  const embedding = embeddingContracts().length;
  const claude = 5 * 2;
  const responses = 7 * 2;
  const chat = 2 * 2;
  const requestLocation = 1;
  const media = 3 + 5;
  return (
    generateContracts * generateChannels +
    embedding +
    claude +
    responses +
    chat +
    requestLocation +
    media
  );
}
