import type {
  AtomicPricingBook,
  AtomicPricingOffer,
  AtomicPricingTerm,
  AtomicProviderPricing,
  AtomicRateTerm,
  AtomicRateVariant,
  AtomicRawVariant,
} from "./pricing-assembly.ts";
import { canonicalizeApplicability, unconditionalApplicability } from "./pricing-canonical.ts";
import {
  addAtom,
  isStandardUnit,
  offerEvidence,
  rawEvidence,
  relation,
} from "./pricing-commercial-assembly.ts";
import { pricingBookId, pricingOfferId } from "./pricing-identifiers.ts";
import type {
  ChargeBinding,
  NormalizedPriceObservation,
  PriceApplicability,
  PriceCondition,
  PriceMeter,
  RawPriceObservation,
  UnitExpression,
} from "./pricing-schema.ts";
import type { PublishedPricingModel } from "./pricing-adapter.ts";

type Mechanism = "batch" | "direct" | "realtime" | "sync";

interface ModelOffers {
  batch?: string;
  direct?: string;
  realtime?: string;
  sync?: string;
}

export function applyXaiCommercialTopology(
  input: AtomicProviderPricing,
  publishedModels: readonly PublishedPricingModel[],
): AtomicProviderPricing {
  if (input.provider_id !== "xai") return input;
  addAtom(input, {
    kind: "categorical_value",
    key: "default",
    dimension: { namespace: "kmodels", value: "served_service_tier" },
    definition: "xAI response was served at the default processing tier",
    label: "Default",
  });
  const published = new Map(publishedModels.map((model) => [model.uid, model]));
  const modelOffers = new Map<string, ModelOffers>();
  const books = input.books.map((book) => {
    if (book.scope.kind !== "models") return resourceBook(book, input);
    const model = published.get(book.scope.model_refs[0] ?? "");
    const migrated = modelBook(book, model, input);
    const bookId = pricingBookId(input.provider_id, book.book_key);
    const offers: ModelOffers = {};
    for (const offer of migrated.offers) {
      const key = offer.offer_key;
      if (["batch", "direct", "realtime", "sync"].includes(key))
        offers[key as Mechanism] = pricingOfferId(bookId, key);
    }
    for (const modelRef of book.scope.model_refs) modelOffers.set(modelRef, offers);
    return migrated;
  });
  bindRelations(books, modelOffers);
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
  const offers = book.offers.flatMap((offer) => {
    if (offer.offer_key !== "usage") return [settled(offer, "xAI API usage")];
    const result = mechanisms.flatMap((mechanism) => {
      const partitioned = modelOffer(offer, mechanism, model, input);
      return hasContent(partitioned)
        ? [settled(partitioned, `xAI ${mechanismName(mechanism).toLowerCase()}`)]
        : [];
    });
    if (result.length > 1) addExclusiveRelations(book, result);
    return result;
  });
  return { ...book, offers };
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
      : [{ ...state, applicability, observation: normalized(state.observation, applicability) }];
  });
  const terms = offer.terms.flatMap((term) => modelTerm(term, mechanism, duplicate, input));
  return {
    ...offer,
    offer_key: mechanism,
    name: mechanismName(mechanism),
    states,
    terms,
    relations: [],
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
  const migrated = modelMeter(term, mechanism, input);
  const variants = migrated.variants.flatMap((variant) => {
    const applicability = duplicate
      ? variant.applicability
      : mechanismApplicability(variant.applicability, mechanism);
    if (applicability === undefined) return [];
    const next = {
      ...variant,
      applicability,
      observation: normalized(variant.observation, applicability),
    };
    const charge_binding = modelBinding(migrated.meter, next, mechanism, input);
    return [{ ...next, ...(charge_binding === undefined ? {} : { charge_binding }) }];
  });
  const raw_variants = migrated.raw_variants.flatMap((variant) =>
    rawVariant(variant, mechanism, duplicate),
  );
  return variants.length + raw_variants.length === 0
    ? []
    : [{ ...migrated, variants, raw_variants }];
}

function modelMeter(
  term: AtomicRateTerm,
  mechanism: Mechanism,
  input: AtomicProviderPricing,
): AtomicRateTerm {
  if (
    mechanism !== "realtime" ||
    term.meter.namespace !== "kmodels" ||
    term.meter.value !== "output_audio"
  )
    return term;
  return {
    ...term,
    term_key: "realtime_audio",
    meter: providerMeter(
      input,
      "realtime_audio",
      "xAI Speech-to-Speech audio minutes without a published input/output split",
    ),
  };
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
      "Audio seconds billed by the Speech-to-Speech service without a public input/output split",
      variant.price.per,
      aggregation,
      variant.observation,
      "voice:billed_audio_seconds",
      "outcome",
    );
  if (meter.namespace !== "kmodels") return;
  if (meter.value === "input_text" && isUnit(variant.price.per, "token"))
    return standardBinding(
      "uncached_input_tokens",
      aggregation,
      variant.observation,
      "usage:prompt_tokens",
    );
  if (meter.value === "cache_read_text" && isUnit(variant.price.per, "token"))
    return standardBinding(
      "cached_input_tokens",
      aggregation,
      variant.observation,
      "usage:cached_tokens",
    );
  if (meter.value === "output_text" && isUnit(variant.price.per, "token"))
    return providerBinding(
      input,
      "billed_output_tokens",
      "Non-overlapping completion and reasoning tokens billed at the published output rate",
      variant.price.per,
      aggregation,
      variant.observation,
      "usage:completion_tokens+reasoning_tokens",
      "outcome",
    );
  if (meter.value === "input_image" && isUnit(variant.price.per, "token"))
    return providerBinding(
      input,
      "prompt_image_tokens",
      "Image tokens reported for visual input",
      variant.price.per,
      aggregation,
      variant.observation,
      "usage:prompt_image_tokens",
      "outcome",
    );
  if (meter.value === "image_generation" && isUnit(variant.price.per, "image"))
    return standardBinding("generated_images", aggregation, variant.observation, "result:images");
  if (meter.value === "video_generation" && isUnit(variant.price.per, "second"))
    return standardBinding(
      "generated_seconds",
      aggregation,
      variant.observation,
      "result:video_seconds",
    );
  if (meter.value === "input_image" && isUnit(variant.price.per, "image"))
    return providerBinding(
      input,
      "submitted_input_images",
      "Input images submitted to an Imagine generation or edit",
      variant.price.per,
      aggregation,
      variant.observation,
      "request:input_images",
      "request",
    );
  if (meter.value === "input_video" && isUnit(variant.price.per, "second"))
    return providerBinding(
      input,
      "submitted_input_video_seconds",
      "Input video seconds submitted to an Imagine edit or extension",
      variant.price.per,
      aggregation,
      variant.observation,
      "request:input_video_seconds",
      "request",
    );
  if (meter.value === "input_text" && isUnit(variant.price.per, "request"))
    return providerBinding(
      input,
      "realtime_text_input_events",
      "conversation.item.create text-input events billed by xAI Realtime",
      variant.price.per,
      aggregation,
      variant.observation,
      "voice:conversation.item.create",
      "request",
    );
  if (meter.value === "input_text" && isUnit(variant.price.per, "token"))
    return standardBinding("input_tokens", aggregation, variant.observation, "usage:prompt_tokens");
}

function resourceBook(book: AtomicPricingBook, input: AtomicProviderPricing): AtomicPricingBook {
  if (book.scope.kind !== "provider_resource") return book;
  return {
    ...book,
    offers: book.offers.map((offer) => {
      const terms = offer.terms.map((term) => resourceTerm(book, offer, term, input));
      const accountResource =
        book.scope.kind === "provider_resource" &&
        book.scope.resource_kind.namespace === "kmodels" &&
        book.scope.resource_kind.value === "account_resource_template";
      return settled(
        {
          ...offer,
          terms,
          ...(accountResource
            ? {
                enrollment: [
                  {
                    state: "account_scoped" as const,
                    applicability: unconditionalApplicability,
                    observations: [
                      {
                        ...rawEvidence(offerEvidence(offer)),
                        establishes_applicability: unconditionalApplicability,
                      },
                    ],
                  },
                ],
              }
            : {}),
        },
        `xAI ${book.name ?? book.book_key}`,
      );
    }),
  };
}

function resourceTerm(
  book: AtomicPricingBook,
  offer: AtomicPricingOffer,
  term: AtomicPricingTerm,
  input: AtomicProviderPricing,
): AtomicPricingTerm {
  if (term.kind !== "rate" || book.scope.kind !== "provider_resource") return term;
  const resourceKey = book.scope.resource_key;
  const meter = resourceMeter(resourceKey, term.meter, input);
  const migrated = meter === term.meter ? term : { ...term, term_key: resourceKey, meter };
  return {
    ...migrated,
    variants: migrated.variants.map((variant) => {
      const charge_binding = resourceBinding(resourceKey, offer, variant, input);
      return charge_binding === undefined ? variant : { ...variant, charge_binding };
    }),
  };
}

function resourceMeter(
  resourceKey: string,
  meter: PriceMeter,
  input: AtomicProviderPricing,
): PriceMeter {
  if (resourceKey === "x-search")
    return providerMeter(input, "x_search", "Successful xAI X Search executions");
  if (resourceKey === "responses-policy")
    return providerMeter(
      input,
      "pre_generation_usage_guideline_violation",
      "Responses requests rejected for a usage-guideline violation before generation",
    );
  if (resourceKey === "text-to-speech") return { namespace: "kmodels", value: "speech_generation" };
  if (resourceKey === "speech-to-text") return { namespace: "kmodels", value: "transcription" };
  return meter;
}

function resourceBinding(
  resourceKey: string,
  offer: AtomicPricingOffer,
  variant: AtomicRateVariant,
  input: AtomicProviderPricing,
): ChargeBinding | undefined {
  const providerSignals = new Map<string, readonly [string, string]>([
    ["web-search", ["successful_web_searches", "SERVER_SIDE_TOOL_WEB_SEARCH"]],
    ["x-search", ["successful_x_searches", "SERVER_SIDE_TOOL_X_SEARCH"]],
    ["code-execution", ["successful_code_executions", "SERVER_SIDE_TOOL_CODE_EXECUTION"]],
    [
      "collections-search",
      ["successful_collections_searches", "SERVER_SIDE_TOOL_COLLECTIONS_SEARCH"],
    ],
  ]);
  const tool = providerSignals.get(resourceKey);
  if (tool !== undefined)
    return providerBinding(
      input,
      tool[0],
      `Successful billable calls reported in server_side_tool_usage.${tool[1]}`,
      variant.price.per,
      "request",
      variant.observation,
      `server_side_tool_usage:${tool[1]}`,
      "outcome",
    );
  if (resourceKey === "image-generation-tool")
    return standardBinding(
      "generated_images",
      "request",
      variant.observation,
      "response:image_generation_call",
    );
  if (resourceKey === "text-to-speech")
    return providerBinding(
      input,
      "submitted_tts_characters",
      "Characters submitted to the xAI Text-to-Speech service",
      variant.price.per,
      "request",
      variant.observation,
      "request:text.length",
      "request",
    );
  if (resourceKey === "speech-to-text")
    return standardBinding(
      "active_seconds",
      "request",
      variant.observation,
      `${offer.offer_key}:audio_seconds`,
    );
  if (resourceKey === "files" || resourceKey === "collections")
    return offer.offer_key === "storage"
      ? standardBinding(
          "stored_byte_seconds",
          "resource",
          variant.observation,
          `${resourceKey}:stored_byte_seconds`,
        )
      : standardBinding(
          "transferred_bytes",
          "request",
          variant.observation,
          `${resourceKey}:downloaded_bytes`,
        );
}

function bindRelations(
  books: AtomicPricingBook[],
  modelOffers: ReadonlyMap<string, ModelOffers>,
): void {
  const resourceOffers = new Map<string, string[]>();
  for (const book of books) {
    if (book.scope.kind !== "provider_resource") continue;
    const bookId = pricingBookId("xai", book.book_key);
    resourceOffers.set(
      book.scope.resource_key,
      book.offers.map(({ offer_key }) => pricingOfferId(bookId, offer_key)),
    );
  }
  for (const book of books) {
    if (book.scope.kind !== "provider_resource") continue;
    for (const offer of book.offers) {
      const targets = book.scope.model_refs.flatMap((modelRef) => {
        const value = modelOffers.get(modelRef);
        return [value?.sync, value?.batch, value?.realtime].filter(
          (ref): ref is string => ref !== undefined,
        );
      });
      if (targets.length > 0)
        offer.relations.push(
          relation(
            offer,
            "requires",
            targets,
            "The service charge is additive to an exact compatible xAI model execution",
          ),
        );
      if (book.scope.resource_key === "image-search") {
        const web = resourceOffers.get("web-search") ?? [];
        if (web.length > 0)
          offer.relations.push(
            relation(offer, "requires", web, "Image Search is included inside Web Search"),
          );
      }
      if (book.scope.resource_key === "custom-voices") {
        const voice = [
          ...(resourceOffers.get("text-to-speech") ?? []),
          ...[...modelOffers.values()].flatMap(({ realtime }) =>
            realtime === undefined ? [] : [realtime],
          ),
        ];
        if (voice.length > 0)
          offer.relations.push(
            relation(
              offer,
              "compatible_with",
              voice,
              "A retained custom voice can be used by Text-to-Speech and Realtime voice offers",
            ),
          );
      }
      if (book.scope.resource_key === "zero-data-retention") {
        const disabled = [
          ...[...modelOffers.values()].flatMap(({ batch }) => (batch === undefined ? [] : [batch])),
          ...(resourceOffers.get("files") ?? []),
          ...(resourceOffers.get("collections") ?? []),
          ...(resourceOffers.get("image-generation-tool") ?? []),
        ];
        if (disabled.length > 0)
          offer.relations.push(
            relation(
              offer,
              "exclusive_with",
              disabled,
              "Zero Data Retention disables these exact stored or asynchronous xAI offers",
            ),
          );
      }
    }
  }
  const transcription = books.find(
    (book) =>
      book.scope.kind === "provider_resource" && book.scope.resource_key === "speech-to-text",
  );
  if (transcription?.scope.kind === "provider_resource" && transcription.offers.length > 1)
    addExclusiveRelations(transcription, transcription.offers);
}

function addExclusiveRelations(book: AtomicPricingBook, offers: AtomicPricingOffer[]): void {
  const bookId = pricingBookId("xai", book.book_key);
  for (const offer of offers) {
    const targets = offers
      .filter((candidate) => candidate !== offer)
      .map(({ offer_key }) => pricingOfferId(bookId, offer_key));
    if (targets.length > 0)
      offer.relations.push(
        relation(
          offer,
          "exclusive_with",
          targets,
          "These execution mechanisms are alternatives for the same work item",
        ),
      );
  }
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
  if (!isServiceTier(condition)) return condition;
  return {
    ...condition,
    dimension: { namespace: "kmodels", value: "served_service_tier" },
  };
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
  resolutionPhase: "account" | "outcome" | "request",
): ChargeBinding {
  addAtom(input, {
    kind: "usage_signal",
    key,
    definition,
    unit,
    resolution_phase: resolutionPhase,
  });
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

function settled(offer: AtomicPricingOffer, label: string): AtomicPricingOffer {
  const evidence = offerEvidence(offer);
  return {
    ...offer,
    settlement: [
      {
        channel: "direct",
        biller: "xAI",
        payment_sources: ["prepaid_balance", "postpaid_invoice"],
        applicability: unconditionalApplicability,
        observations: [
          {
            ...rawEvidence(evidence),
            raw: { label: `${label} settles directly with xAI` },
            establishes_applicability: unconditionalApplicability,
          },
        ],
      },
    ],
  };
}

function normalized(
  observation: NormalizedPriceObservation,
  applicability: PriceApplicability,
): NormalizedPriceObservation {
  return { ...observation, establishes_applicability: applicability };
}

function isUnit(unit: UnitExpression, expected: "image" | "request" | "second" | "token"): boolean {
  return isStandardUnit(unit, expected);
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

function hasContent(offer: AtomicPricingOffer): boolean {
  return offer.states.length > 0 || offer.terms.length > 0;
}
