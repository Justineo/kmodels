import { attachCommercialFacts } from "./pricing.ts";
import type {
  ParsedProviderModel,
  SourceCommercialPricingFact,
  SourcePriceFact,
} from "./pricing-source.ts";

export interface XaiCommercialEvidence {
  imageGenerationTool: boolean;
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
}

/** Keep only public rates attributable to an inference request or result. */
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
  const facts: SourceCommercialPricingFact[] = evidence.toolRates.map((tool) => ({
    ...service(sourceId, `service:${tool.key}`, tool.name, tool.key, [
      ...responseRefs,
      ...(tool.supportsVoice && evidence.voiceTools ? voiceRefs : []),
    ]),
    offer_key: "execution",
    offer_name: `${tool.name} execution`,
    pricing_state: "numeric",
    price_facts: [tool.rate],
    raw_price_facts: [],
  }));

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
        raw_price_facts: [],
      });
  }

  const voiceRates = [
    [
      "service:text-to-speech",
      "Text to Speech",
      "text-to-speech",
      "synthesis",
      "Text to Speech synthesis",
      evidence.ttsRate,
    ],
    [
      "service:speech-to-text",
      "Speech to Text",
      "speech-to-text",
      "rest",
      "REST transcription",
      evidence.restSttRate,
    ],
    [
      "service:speech-to-text",
      "Speech to Text",
      "speech-to-text",
      "streaming",
      "Streaming transcription",
      evidence.streamingSttRate,
    ],
  ] as const;
  for (const [bookKey, bookName, resourceKey, offerKey, offerName, rate] of voiceRates)
    if (rate !== undefined)
      facts.push({
        ...service(sourceId, bookKey, bookName, resourceKey, []),
        offer_key: offerKey,
        offer_name: offerName,
        pricing_state: "numeric",
        price_facts: [rate],
        raw_price_facts: [],
      });

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
      raw_price_facts: [],
    });

  attachCommercialFacts(models, facts);
}

function service(
  source_ref: string,
  book_key: string,
  book_name: string,
  resource_key: string,
  model_refs: string[],
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
    source_ref,
    book_key,
    book_name,
    resource_kind: "service",
    resource_key,
    model_refs: [...new Set(model_refs)].sort(),
    billing_mode: "usage",
  };
}
