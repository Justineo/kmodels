import { attachCommercialFacts, rawPricingFact as raw } from "./pricing.ts";
import type {
  ParsedProviderModel,
  SourceCommercialPricingFact,
  SourcePriceFact,
} from "./pricing-source.ts";

export interface XaiCommercialEvidence {
  contextCompactionModels: string[];
  customVoices: boolean;
  imageGenerationTool: boolean;
  includedTools: Array<"image-search" | "remote-mcp" | "view-media">;
  pstnMinuteTicks?: string;
  storageRates: {
    collectionDownload?: SourcePriceFact;
    collectionStorage?: SourcePriceFact;
    fileDownload?: SourcePriceFact;
    fileStorage?: SourcePriceFact;
  };
  toolRates: Array<{
    key: "attachment-search" | "code-execution" | "collections-search" | "web-search" | "x-search";
    name: string;
    rate: SourcePriceFact;
    supportsVoice: boolean;
  }>;
  ttsRate?: SourcePriceFact;
  restSttRate?: SourcePriceFact;
  streamingSttRate?: SourcePriceFact;
  violationRate?: SourcePriceFact;
  voiceTools: boolean;
  zeroDataRetention: boolean;
}

export function extractXaiCommercialFacts(
  models: ParsedProviderModel[],
  sourceId: string,
  evidence: XaiCommercialEvidence,
): void {
  const responseRefs = models
    .filter(
      ({ api_endpoints, tasks }) =>
        tasks.includes("text_generation") &&
        api_endpoints?.some(({ path }) => path === "/v1/responses") === true,
    )
    .map(({ uid }) => uid);
  const voiceRefs = models
    .filter(({ tasks }) => tasks.includes("speech_to_speech"))
    .map(({ uid }) => uid);
  const facts: SourceCommercialPricingFact[] = [];

  for (const tool of evidence.toolRates) {
    const refs = [...responseRefs, ...(tool.supportsVoice && evidence.voiceTools ? voiceRefs : [])];
    facts.push({
      ...service(sourceId, `service:${tool.key}`, tool.name, tool.key, refs),
      offer_key: "execution",
      offer_name: `${tool.name} execution`,
      pricing_state: "numeric",
      price_facts: [tool.rate],
      raw_price_facts: [],
    });
  }

  if (evidence.imageGenerationTool) {
    const image = models.find(({ model_id }) => model_id === "grok-imagine-image-quality");
    if (image !== undefined)
      facts.push({
        ...service(
          sourceId,
          "service:image-generation-tool",
          "Responses image generation tool",
          "image-generation-tool",
          responseRefs,
        ),
        offer_key: "execution",
        offer_name: "Agentic image generation",
        pricing_state: "numeric",
        price_facts: image.price_facts,
        raw_price_facts: [
          raw(
            sourceId,
            "tool_resolution_unresolved",
            "informational",
            "unknown_applicability",
            "The Responses tool uses grok-imagine-image-quality rates but exposes no direct resolution selector",
          ),
        ],
      });
  }

  for (const tool of evidence.includedTools) {
    const refs =
      tool !== "view-media" && evidence.voiceTools ? [...responseRefs, ...voiceRefs] : responseRefs;
    facts.push({
      ...service(sourceId, `service:${tool}`, includedToolName(tool), tool, refs),
      offer_key: "invocation",
      offer_name: `${includedToolName(tool)} invocation`,
      pricing_state: "included",
      price_facts: [],
      raw_price_facts: [
        raw(
          sourceId,
          "token_only_invocation",
          "informational",
          "unknown_amount",
          includedToolDescription(tool),
        ),
      ],
    });
  }

  if (evidence.ttsRate !== undefined)
    facts.push({
      ...service(sourceId, "service:text-to-speech", "Text to Speech", "text-to-speech", []),
      offer_key: "synthesis",
      offer_name: "Text to Speech synthesis",
      pricing_state: "numeric",
      price_facts: [evidence.ttsRate],
      raw_price_facts: [],
    });
  const sttRates = [
    ["rest", "REST transcription", evidence.restSttRate],
    ["streaming", "Streaming transcription", evidence.streamingSttRate],
  ] as const;
  for (const [key, name, rate] of sttRates)
    if (rate !== undefined)
      facts.push({
        ...service(sourceId, "service:speech-to-text", "Speech to Text", "speech-to-text", []),
        offer_key: key,
        offer_name: name,
        pricing_state: "numeric",
        price_facts: [rate],
        raw_price_facts: [],
      });

  addStorageFacts(
    facts,
    sourceId,
    "files",
    evidence.storageRates.fileStorage,
    evidence.storageRates.fileDownload,
  );
  addStorageFacts(
    facts,
    sourceId,
    "collections",
    evidence.storageRates.collectionStorage,
    evidence.storageRates.collectionDownload,
  );

  if (evidence.violationRate !== undefined)
    facts.push({
      ...service(
        sourceId,
        "service:responses-policy",
        "Responses usage-guideline enforcement",
        "responses-policy",
        responseRefs,
      ),
      offer_key: "pre-generation-violation",
      offer_name: "Pre-generation usage-guideline violation",
      pricing_state: "numeric",
      price_facts: [evidence.violationRate],
      raw_price_facts: [
        raw(
          sourceId,
          "violation_outcome_unbound",
          "informational",
          "requires_usage_aggregation",
          "The public contract does not expose a stable request-level selector for the pre-generation violation outcome",
        ),
      ],
    });

  const compactionRefs = modelRefs(models, evidence.contextCompactionModels);
  if (compactionRefs.length > 0)
    facts.push({
      ...service(
        sourceId,
        "service:context-compaction",
        "Responses context compaction",
        "context-compaction",
        compactionRefs,
      ),
      offer_key: "compact",
      offer_name: "Context compaction operation",
      pricing_state: "not_published",
      price_facts: [],
      raw_price_facts: [
        raw(
          sourceId,
          "compaction_token_price_join",
          "base_price",
          "unknown_amount",
          "The operation reports input and output token usage but no reviewed source binds those counters to the ordinary Responses price table",
        ),
      ],
    });

  if (evidence.customVoices) {
    const base = accountResource(
      sourceId,
      "account-resource:custom-voices",
      "Custom voices",
      "custom-voices",
      voiceRefs,
    );
    facts.push(
      {
        ...base,
        offer_key: "console",
        offer_name: "Console creation for up to 30 retained team voices",
        billing_mode: "one_time",
        pricing_state: "free",
        price_facts: [],
        raw_price_facts: [
          raw(
            sourceId,
            "console_voice_slots",
            "allowance",
            "unsupported_structure",
            "Console creation is free for up to 30 retained team-scoped custom voices",
          ),
        ],
      },
      {
        ...base,
        offer_key: "enterprise-api",
        offer_name: "Enterprise custom-voice API creation",
        billing_mode: "one_time",
        pricing_state: "not_published",
        price_facts: [],
        raw_price_facts: [
          raw(
            sourceId,
            "enterprise_custom_voice_creation",
            "base_price",
            "unknown_amount",
            "POST /v1/custom-voices requires Enterprise enablement and publishes no amount",
          ),
        ],
      },
    );
  }

  if (evidence.zeroDataRetention)
    facts.push({
      ...accountResource(
        sourceId,
        "account-setting:zero-data-retention",
        "Zero Data Retention",
        "zero-data-retention",
        [],
      ),
      offer_key: "enabled",
      offer_name: "Zero Data Retention enabled",
      pricing_state: "not_published",
      price_facts: [],
      raw_price_facts: [
        raw(
          sourceId,
          "zdr_feature_exclusions",
          "informational",
          "unsupported_structure",
          "ZDR disables Batch, Files, Collections, agentic image generation, stateful Responses, deferred results, stored media outputs, and persisted Voice history",
        ),
      ],
    });

  if (evidence.pstnMinuteTicks !== undefined)
    facts.push({
      ...service(
        sourceId,
        "service:pstn-transport",
        "Voice PSTN transport",
        "pstn-transport",
        voiceRefs,
      ),
      offer_key: "candidate",
      offer_name: "PSTN transport candidate",
      pricing_state: "not_published",
      price_facts: [],
      raw_price_facts: [
        {
          term_key: "pstn_minute_candidate",
          impact: "base_price",
          reason: "unknown_unit",
          conditions: {},
          source_ref: sourceId,
          raw: {
            label: "Embedded pstnMinutePrice",
            amount: evidence.pstnMinuteTicks,
            denomination: "USD ticks",
            unit: "Undocumented PSTN minute candidate",
          },
        },
      ],
    });

  attachCommercialFacts(models, facts);
}

function addStorageFacts(
  facts: SourceCommercialPricingFact[],
  sourceId: string,
  key: "collections" | "files",
  storage: SourcePriceFact | undefined,
  download: SourcePriceFact | undefined,
): void {
  const rates = [
    ["storage", `${title(key)} storage`, storage],
    ["download", `${title(key)} download`, download],
  ] as const;
  for (const [offerKey, name, rate] of rates)
    if (rate !== undefined)
      facts.push({
        ...service(sourceId, `service:${key}`, title(key), key, []),
        offer_key: offerKey,
        offer_name: name,
        pricing_state: "numeric",
        price_facts: [rate],
        raw_price_facts: [],
      });
}

function service(
  sourceRef: string,
  bookKey: string,
  bookName: string,
  resourceKey: string,
  modelRefs: string[],
): Pick<
  SourceCommercialPricingFact,
  | "billing_mode"
  | "book_key"
  | "book_name"
  | "model_refs"
  | "resource_key"
  | "resource_kind"
  | "source_ref"
> {
  return {
    source_ref: sourceRef,
    book_key: bookKey,
    book_name: bookName,
    resource_kind: "service",
    resource_key: resourceKey,
    model_refs: [...new Set(modelRefs)].sort(),
    billing_mode: "usage",
  };
}

function accountResource(
  sourceRef: string,
  bookKey: string,
  bookName: string,
  resourceKey: string,
  modelRefs: string[],
): Omit<ReturnType<typeof service>, "resource_kind"> & {
  resource_kind: "account_resource_template";
} {
  return {
    ...service(sourceRef, bookKey, bookName, resourceKey, modelRefs),
    resource_kind: "account_resource_template",
  };
}

function modelRefs(models: readonly ParsedProviderModel[], ids: readonly string[]): string[] {
  const expected = new Set(ids);
  return models.flatMap((model) => (expected.has(model.model_id) ? [model.uid] : [])).sort();
}

function includedToolName(key: XaiCommercialEvidence["includedTools"][number]): string {
  switch (key) {
    case "image-search":
      return "Image Search";
    case "remote-mcp":
      return "Remote MCP";
    case "view-media":
      return "Search media understanding";
  }
}

function includedToolDescription(key: XaiCommercialEvidence["includedTools"][number]): string {
  switch (key) {
    case "image-search":
      return "Image Search is included in Web Search and has no second invocation charge";
    case "remote-mcp":
      return "xAI charges no Remote MCP invocation fee; model tokens apply and an external MCP seller may bill separately";
    case "view-media":
      return "view_image and view_x_video have no invocation fee; processed media is charged through model token usage";
  }
}

function title(value: "collections" | "files"): string {
  return value === "collections" ? "Collections" : "Files";
}
