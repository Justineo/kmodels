import type {
  AtomicPricingBook,
  AtomicPricingOffer,
  AtomicPricingTerm,
  AtomicProviderPricing,
  AtomicRateVariant,
  AtomicRawVariant,
} from "./pricing-assembly.ts";
import { canonicalizeApplicability } from "./pricing-canonical.ts";
import {
  addAtom,
  isStandardUnit,
  rawEvidence,
  withApplicability,
} from "./pricing-commercial-assembly.ts";
import type {
  ChargeBinding,
  PriceApplicability,
  PriceCondition,
  PriceMeter,
  RawPriceObservation,
  UnitExpression,
} from "./pricing-schema.ts";
import type { PublishedPricingModel } from "./pricing-adapter.ts";

type Mechanism = "batch" | "direct" | "realtime" | "sync";

const requestResources = new Set([
  "attachment-search",
  "code-execution",
  "collections-search",
  "image-generation-tool",
  "responses-policy",
  "speech-to-text",
  "text-to-speech",
  "web-search",
  "x-search",
]);

export function applyXaiCommercialTopology(
  input: AtomicProviderPricing,
  publishedModels: readonly PublishedPricingModel[],
): AtomicProviderPricing {
  addAtom(input, {
    kind: "categorical_value",
    key: "default",
    dimension: { namespace: "kmodels", value: "served_service_tier" },
    definition: "xAI response was served at the default processing tier",
    label: "Default",
  });
  const published = new Map(publishedModels.map((model) => [model.uid, model]));
  const books = input.books.flatMap((book) => {
    if (book.scope.kind !== "models")
      return book.scope.kind === "provider_resource" &&
        requestResources.has(book.scope.resource_key)
        ? [resourceBook(book, input)]
        : [];
    return [modelBook(book, published.get(book.scope.model_refs[0] ?? ""), input)];
  });
  input.vocabulary.atoms = input.vocabulary.atoms.flatMap((atom) => {
    if (
      atom.kind !== "categorical_value" ||
      atom.dimension.namespace !== "kmodels" ||
      atom.dimension.value !== "service_tier"
    )
      return [atom];
    if (atom.key === "batch") return [];
    return [{ ...atom, dimension: { namespace: "kmodels", value: "served_service_tier" } }];
  });
  return { ...input, books };
}

function modelBook(
  book: AtomicPricingBook,
  model: PublishedPricingModel | undefined,
  input: AtomicProviderPricing,
): AtomicPricingBook {
  const mechanisms = modelMechanisms(model);
  return {
    ...book,
    offers: book.offers.flatMap((offer) =>
      offer.offer_key !== "usage"
        ? [{ ...offer, settlement: [] }]
        : mechanisms.flatMap((mechanism) => {
            const next = modelOffer(offer, mechanism, model, input);
            return next.states.length + next.terms.length === 0 ? [] : [next];
          }),
    ),
  };
}

function modelMechanisms(model: PublishedPricingModel | undefined): Mechanism[] {
  if (model?.tasks.includes("speech_to_speech")) return ["realtime"];
  if (model?.tasks.some((task) => task === "image_generation" || task === "video_generation"))
    return model.capabilities.batch === true ? ["direct", "batch"] : ["direct"];
  if (model?.tasks.includes("text_generation"))
    return model.capabilities.batch === true ? ["sync", "batch"] : ["sync"];
  return ["sync"];
}

function modelOffer(
  offer: AtomicPricingOffer,
  mechanism: Mechanism,
  model: PublishedPricingModel | undefined,
  input: AtomicProviderPricing,
): AtomicPricingOffer {
  const duplicate =
    mechanism === "batch" &&
    model?.tasks.some((task) => task === "image_generation" || task === "video_generation") ===
      true;
  const states = offer.states.flatMap((state) => {
    const applicability = duplicate
      ? state.applicability
      : mechanismApplicability(state.applicability, mechanism);
    return applicability === undefined
      ? []
      : [
          {
            ...state,
            applicability,
            observation: withApplicability(state.observation, applicability),
          },
        ];
  });
  const terms = offer.terms.flatMap((term) => modelTerm(term, mechanism, duplicate, input));
  return {
    ...offer,
    offer_key: mechanism,
    name: mechanismName(mechanism),
    states,
    terms,
    relations: [],
    settlement: [],
  };
}

function modelTerm(
  term: AtomicPricingTerm,
  mechanism: Mechanism,
  duplicate: boolean,
  input: AtomicProviderPricing,
): AtomicPricingTerm[] {
  if (term.kind === "raw") {
    const variants = term.variants.flatMap((variant) => rawVariant(variant, mechanism, duplicate));
    return variants.length === 0 ? [] : [{ ...term, variants }];
  }
  if (term.kind !== "rate") return mechanism === "batch" ? [] : [term];
  const meter =
    mechanism === "realtime" &&
    term.meter.namespace === "kmodels" &&
    term.meter.value === "output_audio"
      ? providerMeter(
          input,
          "realtime_audio",
          "xAI Speech-to-Speech audio minutes without a published input/output split",
        )
      : term.meter;
  const variants = term.variants.flatMap((variant) => {
    const applicability = duplicate
      ? variant.applicability
      : mechanismApplicability(variant.applicability, mechanism);
    if (applicability === undefined) return [];
    const next = {
      ...variant,
      applicability,
      observation: withApplicability(variant.observation, applicability),
    };
    const charge_binding = modelBinding(meter, next, mechanism, input);
    return [{ ...next, ...(charge_binding === undefined ? {} : { charge_binding }) }];
  });
  const raw_variants = term.raw_variants.flatMap((variant) =>
    rawVariant(variant, mechanism, duplicate),
  );
  return variants.length + raw_variants.length === 0
    ? []
    : [
        {
          ...term,
          ...(meter === term.meter ? {} : { term_key: "realtime_audio", meter }),
          variants,
          raw_variants,
        },
      ];
}

function modelBinding(
  meter: PriceMeter,
  variant: AtomicRateVariant,
  mechanism: Mechanism,
  input: AtomicProviderPricing,
): ChargeBinding | undefined {
  const aggregation = mechanism === "batch" ? "result_item" : "request";
  if (meter.namespace === "provider" && meter.value === "realtime_audio")
    return providerBinding(
      input,
      "billed_realtime_audio_seconds",
      "Audio seconds billed by the Speech-to-Speech service without a public direction split",
      variant.price.per,
      aggregation,
      variant.observation,
      "Voice session accepted input audio seconds + emitted output audio seconds",
      "outcome",
    );
  if (meter.namespace !== "kmodels") return;
  if (meter.value === "input_text" && isStandardUnit(variant.price.per, "token"))
    return providerBinding(
      input,
      "uncached_input_tokens",
      "xAI input tokens excluding cached tokens",
      variant.price.per,
      aggregation,
      variant.observation,
      "Response.usage.input_tokens - Response.usage.input_tokens_details.cached_tokens",
      "outcome",
    );
  if (meter.value === "cache_read_text" && isStandardUnit(variant.price.per, "token"))
    return providerBinding(
      input,
      "cached_input_tokens",
      "xAI cached input tokens",
      variant.price.per,
      aggregation,
      variant.observation,
      "Response.usage.input_tokens_details.cached_tokens",
      "outcome",
    );
  if (meter.value === "output_text" && isStandardUnit(variant.price.per, "token"))
    return providerBinding(
      input,
      "output_tokens",
      "xAI output tokens, including billed reasoning tokens",
      variant.price.per,
      aggregation,
      variant.observation,
      "Response.usage.output_tokens",
      "outcome",
    );
  if (meter.value === "input_image" && isStandardUnit(variant.price.per, "token"))
    return providerBinding(
      input,
      "input_image_tokens",
      "xAI prompt image tokens",
      variant.price.per,
      aggregation,
      variant.observation,
      "ChatCompletion.usage.prompt_image_tokens",
      "outcome",
    );
  if (meter.value === "image_generation" && isStandardUnit(variant.price.per, "image"))
    return standardBinding(
      "generated_images",
      aggregation,
      variant.observation,
      "result.data.length",
    );
  if (meter.value === "video_generation" && isStandardUnit(variant.price.per, "second"))
    return standardBinding(
      "generated_seconds",
      aggregation,
      variant.observation,
      "completed video duration_seconds",
    );
  if (meter.value === "input_image" && isStandardUnit(variant.price.per, "image"))
    return providerBinding(
      input,
      "submitted_input_images",
      "Accepted input images in an Imagine request",
      variant.price.per,
      aggregation,
      variant.observation,
      "request input image count",
      "request",
    );
  if (meter.value === "input_video" && isStandardUnit(variant.price.per, "second"))
    return providerBinding(
      input,
      "submitted_input_video_seconds",
      "Accepted source-video seconds in an Imagine request",
      variant.price.per,
      aggregation,
      variant.observation,
      "request source video duration_seconds",
      "request",
    );
  if (meter.value === "input_text" && isStandardUnit(variant.price.per, "request"))
    return providerBinding(
      input,
      "realtime_text_input_events",
      "Billable Speech-to-Speech text-input events",
      variant.price.per,
      aggregation,
      variant.observation,
      "conversation.item.create non-audio client events excluding function_call_output",
      "request",
    );
}

function resourceBook(book: AtomicPricingBook, input: AtomicProviderPricing): AtomicPricingBook {
  if (book.scope.kind !== "provider_resource") return book;
  const resourceKey = book.scope.resource_key;
  return {
    ...book,
    resource_edges: [],
    offers: book.offers.map((offer) => ({
      ...offer,
      enrollment: [],
      relations: [],
      settlement: [],
      terms: offer.terms.map((term) => resourceTerm(resourceKey, offer, term, input)),
    })),
  };
}

function resourceTerm(
  resourceKey: string,
  offer: AtomicPricingOffer,
  term: AtomicPricingTerm,
  input: AtomicProviderPricing,
): AtomicPricingTerm {
  if (term.kind !== "rate") return term;
  const meter =
    resourceKey === "x-search"
      ? providerMeter(input, "x_search", "Successful xAI X Search executions")
      : resourceKey === "responses-policy"
        ? providerMeter(
            input,
            "pre_generation_usage_guideline_violation",
            "Responses requests rejected before generation for an xAI usage-guideline violation",
          )
        : resourceKey === "text-to-speech"
          ? ({ namespace: "kmodels", value: "speech_generation" } as const)
          : resourceKey === "speech-to-text"
            ? ({ namespace: "kmodels", value: "transcription" } as const)
            : term.meter;
  return {
    ...term,
    ...(meter === term.meter ? {} : { term_key: resourceKey, meter }),
    variants: term.variants.map((variant) => {
      const charge_binding = resourceBinding(resourceKey, offer, variant, input);
      return charge_binding === undefined ? variant : { ...variant, charge_binding };
    }),
  };
}

function resourceBinding(
  resourceKey: string,
  offer: AtomicPricingOffer,
  variant: AtomicRateVariant,
  input: AtomicProviderPricing,
): ChargeBinding | undefined {
  const toolLocators = new Map<string, readonly [string, string]>([
    [
      "web-search",
      ["successful_web_searches", "Response.usage.server_side_tool_usage_details.web_search_calls"],
    ],
    [
      "x-search",
      ["successful_x_searches", "Response.usage.server_side_tool_usage_details.x_search_calls"],
    ],
    [
      "code-execution",
      [
        "successful_code_executions",
        "Response.usage.server_side_tool_usage_details.code_interpreter_calls",
      ],
    ],
    [
      "attachment-search",
      [
        "successful_attachment_searches",
        "Response.usage.server_side_tool_usage_details.document_search_calls",
      ],
    ],
    [
      "collections-search",
      [
        "successful_collections_searches",
        "Response.usage.server_side_tool_usage_details.file_search_calls",
      ],
    ],
  ]);
  const tool = toolLocators.get(resourceKey);
  if (tool !== undefined)
    return providerBinding(
      input,
      tool[0],
      `Successful billable ${resourceKey.replaceAll("-", " ")} calls reported by xAI usage`,
      variant.price.per,
      "request",
      variant.observation,
      tool[1],
      "outcome",
    );
  // The tool reports successful calls, but does not expose the resolution/quality
  // needed to choose among the published Imagine rates.
  if (resourceKey === "image-generation-tool") return;
  if (resourceKey === "text-to-speech")
    return providerBinding(
      input,
      "submitted_tts_characters",
      "Characters in the accepted Text-to-Speech input",
      variant.price.per,
      "request",
      variant.observation,
      "request.text character count",
      "request",
    );
  if (resourceKey === "speech-to-text")
    return standardBinding(
      "active_seconds",
      "request",
      variant.observation,
      `${offer.offer_key} accepted audio duration_seconds`,
    );
}

function mechanismApplicability(
  applicability: PriceApplicability,
  mechanism: Mechanism,
): PriceApplicability | undefined {
  if (mechanism === "direct" || mechanism === "realtime") return applicability;
  const any_of = applicability.any_of.flatMap(({ all_of }) => {
    const tier = all_of.find(isServiceTier);
    const batch =
      tier?.kind === "categorical" && tier.values.some(({ value }) => value === "batch");
    if ((mechanism === "batch") !== batch) return [];
    return [
      {
        all_of:
          mechanism === "batch"
            ? all_of.filter((item) => item !== tier)
            : tier === undefined
              ? [...all_of, defaultServedTier()]
              : all_of.map(servedTier),
      },
    ];
  });
  return any_of.length === 0 ? undefined : canonicalizeApplicability({ any_of });
}

function rawVariant(
  variant: AtomicRawVariant,
  mechanism: Mechanism,
  duplicate: boolean,
): AtomicRawVariant[] {
  if (duplicate) return [variant];
  if (variant.possible_scope === undefined) return mechanism === "sync" ? [variant] : [];
  const possible_scope = mechanismApplicability(variant.possible_scope, mechanism);
  return possible_scope === undefined ? [] : [{ ...variant, possible_scope }];
}

function servedTier(condition: PriceCondition): PriceCondition {
  return isServiceTier(condition)
    ? { ...condition, dimension: { namespace: "kmodels", value: "served_service_tier" } }
    : condition;
}

function defaultServedTier(): PriceCondition {
  return {
    kind: "categorical",
    dimension: { namespace: "kmodels", value: "served_service_tier" },
    values: [{ namespace: "provider", provider_id: "xai", value: "default" }],
  };
}

function isServiceTier(
  condition: PriceCondition,
): condition is Extract<PriceCondition, { kind: "categorical" }> {
  return (
    condition.kind === "categorical" &&
    condition.dimension.namespace === "kmodels" &&
    condition.dimension.value === "service_tier"
  );
}

function providerMeter(input: AtomicProviderPricing, key: string, definition: string): PriceMeter {
  addAtom(input, { kind: "meter", key, definition });
  return { namespace: "provider", provider_id: input.provider_id, value: key };
}

function providerBinding(
  input: AtomicProviderPricing,
  key: string,
  definition: string,
  unit: UnitExpression,
  aggregation: ChargeBinding["aggregation"],
  evidence: RawPriceObservation,
  locator: string,
  resolution_phase: "outcome" | "request",
): ChargeBinding {
  addAtom(input, { kind: "usage_signal", key, definition, unit, resolution_phase });
  return {
    signal: { namespace: "provider", provider_id: input.provider_id, value: key },
    aggregation,
    observations: [{ ...rawEvidence(evidence), locator: { kind: "provider_key", value: locator } }],
  };
}

function standardBinding(
  value: Extract<ChargeBinding["signal"], { namespace: "kmodels" }>["value"],
  aggregation: ChargeBinding["aggregation"],
  evidence: RawPriceObservation,
  locator: string,
): ChargeBinding {
  return {
    signal: { namespace: "kmodels", value },
    aggregation,
    observations: [{ ...rawEvidence(evidence), locator: { kind: "provider_key", value: locator } }],
  };
}

function mechanismName(mechanism: Mechanism): string {
  switch (mechanism) {
    case "batch":
      return "Batch inference";
    case "direct":
      return "Direct inference";
    case "realtime":
      return "Realtime inference";
    case "sync":
      return "Synchronous inference";
  }
}
