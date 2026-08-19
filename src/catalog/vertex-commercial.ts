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
  providerKeyEvidence,
  relation,
  withApplicability,
} from "./pricing-commercial-assembly.ts";
import { pricingBookId, pricingOfferId } from "./pricing-identifiers.ts";
import type {
  ChargeBinding,
  PriceApplicability,
  PriceCondition,
  PriceMeter,
  UnitExpression,
} from "./pricing-schema.ts";
import type { ParsedProviderModel } from "./pricing-source.ts";

type Mechanism = "sync" | "batch";
type PublishedModel = Pick<ParsedProviderModel, "service_families" | "uid">;

const servedTier = { namespace: "kmodels", value: "served_service_tier" } as const;
const requestServices = new Set([
  "claude-web-search",
  "google-image-search",
  "google-maps",
  "google-search",
  "grounded-generation",
  "web-grounding-enterprise",
]);

export function applyVertexCommercialTopology(
  input: AtomicProviderPricing,
  publishedModels: readonly PublishedModel[],
): AtomicProviderPricing {
  const models = new Map(publishedModels.map((model) => [model.uid, model]));
  const modelOffers = new Map<string, string>();
  const books = input.books.flatMap((book) => {
    if (book.scope.kind === "models") {
      const migrated = splitModelBook(book, input, models);
      if (migrated.offers.some(({ offer_key }) => offer_key === "sync")) {
        const ref = pricingOfferId(pricingBookId(input.provider_id, book.book_key), "sync");
        for (const modelRef of book.scope.model_refs) modelOffers.set(modelRef, ref);
      }
      return [migrated];
    }
    if (!requestServices.has(book.scope.resource_key)) return [];
    return [bindRequestService(book, input)];
  });
  for (const book of books) bindServiceRelations(book, modelOffers);
  return { ...input, books };
}

function splitModelBook(
  book: AtomicPricingBook,
  input: AtomicProviderPricing,
  models: ReadonlyMap<string, PublishedModel>,
): AtomicPricingBook {
  return {
    ...book,
    offers: book.offers.flatMap((offer) => {
      if (offer.offer_key !== "usage") return [{ ...offer, settlement: [] }];
      return (["sync", "batch"] as const)
        .map((mechanism) => partitionOffer(book, offer, mechanism, input, models))
        .filter((candidate): candidate is AtomicPricingOffer => candidate !== undefined);
    }),
  };
}

function partitionOffer(
  book: AtomicPricingBook,
  offer: AtomicPricingOffer,
  mechanism: Mechanism,
  input: AtomicProviderPricing,
  models: ReadonlyMap<string, PublishedModel>,
): AtomicPricingOffer | undefined {
  const states = offer.states.flatMap((state) => {
    const applicability = mechanismApplicability(state.applicability, mechanism, input);
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
  const blocked = offer.terms.some(
    (term) => term.kind === "raw" && term.term_key === "charge_binding_unavailable",
  );
  const terms = offer.terms.flatMap((term) =>
    partitionTerm(book, term, mechanism, input, models, blocked),
  );
  if (states.length === 0 && terms.length === 0) return;
  return {
    ...offer,
    offer_key: mechanism,
    name: mechanism === "batch" ? "Batch inference" : "Online inference",
    states,
    terms,
    relations: [],
    settlement: [],
  };
}

function partitionTerm(
  book: AtomicPricingBook,
  term: AtomicPricingTerm,
  mechanism: Mechanism,
  input: AtomicProviderPricing,
  models: ReadonlyMap<string, PublishedModel>,
  blocked: boolean,
): AtomicPricingTerm[] {
  if (term.kind === "raw") {
    const variants = term.variants.flatMap((variant) => partitionRaw(variant, mechanism, input));
    return variants.length === 0 ? [] : [{ ...term, variants }];
  }
  if (term.kind !== "rate") return mechanism === "sync" ? [term] : [];
  const variants = term.variants.flatMap((variant) => {
    const applicability = mechanismApplicability(variant.applicability, mechanism, input);
    if (applicability === undefined) return [];
    const observation = withApplicability(variant.observation, applicability);
    const charge_binding = blocked
      ? undefined
      : modelBinding(book, term.meter, variant, mechanism, input, models);
    return [
      {
        ...variant,
        applicability,
        observation,
        ...(charge_binding === undefined ? {} : { charge_binding }),
      },
    ];
  });
  const raw_variants = term.raw_variants.flatMap((variant) =>
    partitionRaw(variant, mechanism, input),
  );
  return variants.length + raw_variants.length === 0 ? [] : [{ ...term, variants, raw_variants }];
}

function partitionRaw(
  variant: AtomicRawVariant,
  mechanism: Mechanism,
  input: AtomicProviderPricing,
): AtomicRawVariant[] {
  if (variant.possible_scope === undefined) return mechanism === "sync" ? [variant] : [];
  const possible_scope = mechanismApplicability(variant.possible_scope, mechanism, input);
  return possible_scope === undefined ? [] : [{ ...variant, possible_scope }];
}

function mechanismApplicability(
  applicability: PriceApplicability,
  mechanism: Mechanism,
  input: AtomicProviderPricing,
): PriceApplicability | undefined {
  const any_of = applicability.any_of.flatMap(({ all_of }) => {
    const tier = all_of.find(isServiceTier);
    const values = tier?.kind === "categorical" ? tier.values.map(({ value }) => value) : [];
    const batch = values.includes("batch");
    if ((mechanism === "batch") !== batch) return [];
    if (mechanism === "batch" || tier === undefined)
      return [{ all_of: tier === undefined ? all_of : all_of.filter((item) => item !== tier) }];
    if (tier.kind !== "categorical") return [];
    const realized: Extract<PriceCondition, { kind: "categorical" }> = {
      ...tier,
      dimension: servedTier,
      values: tier.values.map((value) => {
        addAtom(input, {
          kind: "categorical_value",
          key: value.value,
          dimension: servedTier,
          definition: `Agent Platform response-reported served traffic type ${JSON.stringify(value.value)}`,
          label: title(value.value),
        });
        return value;
      }),
    };
    return [{ all_of: all_of.map((item) => (item === tier ? realized : item)) }];
  });
  return any_of.length === 0 ? undefined : canonicalizeApplicability({ any_of });
}

function isServiceTier(condition: PriceCondition): boolean {
  return (
    condition.kind === "categorical" &&
    condition.dimension.namespace === "kmodels" &&
    condition.dimension.value === "service_tier"
  );
}

interface Signal {
  key: string;
  definition: string;
  locators: string[];
}

function modelBinding(
  book: AtomicPricingBook,
  meter: PriceMeter,
  variant: AtomicRateVariant,
  mechanism: Mechanism,
  input: AtomicProviderPricing,
  models: ReadonlyMap<string, PublishedModel>,
): ChargeBinding | undefined {
  const signal = modelSignal(book, meter, variant.price.per, models);
  if (signal === undefined) return;
  addAtom(input, {
    kind: "usage_signal",
    key: signal.key,
    definition: signal.definition,
    unit: variant.price.per,
    resolution_phase: "outcome",
  });
  const prefix = mechanism === "batch" ? "batch-result" : "response";
  return {
    signal: { namespace: "provider", provider_id: input.provider_id, value: signal.key },
    aggregation: mechanism === "batch" ? "result_item" : "request",
    observations: signal.locators.map((locator) =>
      providerKeyEvidence(variant.observation, `${prefix}:${locator}`),
    ),
  };
}

function modelSignal(
  book: AtomicPricingBook,
  meter: PriceMeter,
  unit: UnitExpression,
  models: ReadonlyMap<string, PublishedModel>,
): Signal | undefined {
  if (
    meter.namespace !== "kmodels" ||
    !isStandardUnit(unit, "token") ||
    book.scope.kind !== "models"
  )
    return;
  const families = new Set(
    book.scope.model_refs.flatMap((ref) => models.get(ref)?.service_families ?? []),
  );
  if (families.has("publishers/google")) return geminiSignal(meter);
  if (families.has("publishers/anthropic")) return claudeSignal(meter);
  if (families.has("publishers/xai")) return responsesSignal(meter);
  return chatSignal(meter);
}

function geminiSignal(meter: PriceMeter): Signal | undefined {
  const modality = meter.value.split("_").at(-1)?.toUpperCase();
  if (meter.value.startsWith("input_") && modality !== undefined)
    return {
      key: `uncached_input_${modality.toLowerCase()}_tokens`,
      definition: `Uncached Agent Platform Gemini ${modality.toLowerCase()} input tokens reported by usage metadata`,
      locators: [
        `GenerateContentResponse.usageMetadata.promptTokensDetails[modality=${modality}].tokenCount - GenerateContentResponse.usageMetadata.cacheTokensDetails[modality=${modality}].tokenCount`,
      ],
    };
  if (meter.value.startsWith("cache_read_") && modality !== undefined)
    return {
      key: `cached_input_${modality.toLowerCase()}_tokens`,
      definition: `Cached Agent Platform Gemini ${modality.toLowerCase()} input tokens reported by usage metadata`,
      locators: [
        `GenerateContentResponse.usageMetadata.cacheTokensDetails[modality=${modality}].tokenCount`,
      ],
    };
  if (meter.value === "output_text")
    return {
      key: "output_text_tokens",
      definition:
        "Agent Platform Gemini candidate and thought output tokens reported by usage metadata",
      locators: [
        "GenerateContentResponse.usageMetadata.candidatesTokenCount + GenerateContentResponse.usageMetadata.thoughtsTokenCount",
      ],
    };
  if (meter.value.startsWith("output_") && modality !== undefined)
    return {
      key: `output_${modality.toLowerCase()}_tokens`,
      definition: `Agent Platform Gemini ${modality.toLowerCase()} output tokens reported by usage metadata`,
      locators: [
        `GenerateContentResponse.usageMetadata.candidatesTokensDetails[modality=${modality}].tokenCount`,
      ],
    };
  if (meter.value === "embedding")
    return {
      key: "embedding_input_tokens",
      definition: "Agent Platform Gemini embedding input tokens reported by the embedding response",
      locators: ["EmbedContentResponse.usageMetadata.promptTokenCount"],
    };
}

function claudeSignal(meter: PriceMeter): Signal | undefined {
  const field =
    meter.value === "input_text"
      ? "input_tokens"
      : meter.value === "cache_read_text"
        ? "cache_read_input_tokens"
        : meter.value === "cache_write_text"
          ? "cache_creation_input_tokens"
          : meter.value === "output_text"
            ? "output_tokens"
            : undefined;
  return field === undefined
    ? undefined
    : {
        key: `claude_${field}`,
        definition: `Agent Platform Claude ${field.replaceAll("_", " ")} reported by response usage`,
        locators: [`Message.usage.${field}`],
      };
}

function responsesSignal(meter: PriceMeter): Signal | undefined {
  const locator =
    meter.value === "input_text"
      ? "Response.usage.input_tokens - Response.usage.input_tokens_details.cached_tokens"
      : meter.value === "cache_read_text"
        ? "Response.usage.input_tokens_details.cached_tokens"
        : meter.value === "output_text"
          ? "Response.usage.output_tokens"
          : undefined;
  return locator === undefined
    ? undefined
    : {
        key: `responses_${meter.value}_tokens`,
        definition: `Agent Platform Responses ${meter.value.replaceAll("_", " ")} tokens reported by response usage`,
        locators: [locator],
      };
}

function chatSignal(meter: PriceMeter): Signal | undefined {
  const locator =
    meter.value === "input_text"
      ? "ChatCompletion.usage.prompt_tokens"
      : meter.value === "output_text"
        ? "ChatCompletion.usage.completion_tokens"
        : undefined;
  return locator === undefined
    ? undefined
    : {
        key: `chat_${meter.value}_tokens`,
        definition: `Agent Platform Chat Completions ${meter.value.replaceAll("_", " ")} tokens reported by response usage`,
        locators: [locator],
      };
}

function bindRequestService(
  book: AtomicPricingBook,
  input: AtomicProviderPricing,
): AtomicPricingBook {
  if (book.scope.kind !== "provider_resource") return book;
  const resourceKey = book.scope.resource_key;
  return {
    ...book,
    resource_edges: [],
    offers: book.offers.map((offer) => {
      const blocked = offer.terms.some(
        (term) => term.kind === "raw" && term.term_key === "charge_binding_unavailable",
      );
      return {
        ...offer,
        enrollment: [],
        settlement: [],
        terms: offer.terms.map((term) => {
          if (term.kind !== "rate" || blocked) return term;
          return {
            ...term,
            variants: term.variants.map((variant) => {
              const charge_binding = serviceBinding(resourceKey, variant, input);
              return charge_binding === undefined ? variant : { ...variant, charge_binding };
            }),
          };
        }),
      };
    }),
  };
}

function serviceBinding(
  resourceKey: string,
  variant: AtomicRateVariant,
  input: AtomicProviderPricing,
): ChargeBinding | undefined {
  const request = isStandardUnit(variant.price.per, "request");
  const requestCount = resourceKey === "claude-web-search" || request;
  const locator =
    resourceKey === "claude-web-search"
      ? "Message.usage.server_tool_use.web_search_requests"
      : resourceKey === "google-image-search" && !request
        ? "GenerateContentResponse.candidates[*].groundingMetadata.imageSearchQueries.length"
        : (resourceKey === "google-search" || resourceKey === "web-grounding-enterprise") &&
            !request
          ? "GenerateContentResponse.candidates[*].groundingMetadata.webSearchQueries.length"
          : resourceKey === "google-maps" && request
            ? "GenerateContentResponse.candidates[*].groundingMetadata.googleMapsWidgetContextToken (one grounded prompt)"
            : undefined;
  if (locator === undefined) return;
  const key = `${resourceKey.replaceAll("-", "_")}_${requestCount ? "requests" : "queries"}`;
  addAtom(input, {
    kind: "usage_signal",
    key,
    definition: `Billable Agent Platform ${resourceKey.replaceAll("-", " ")} usage reported by the generated result`,
    unit: variant.price.per,
    resolution_phase: "outcome",
  });
  return {
    signal: { namespace: "provider", provider_id: input.provider_id, value: key },
    aggregation: "result_item",
    observations: [providerKeyEvidence(variant.observation, locator)],
  };
}

function bindServiceRelations(
  book: AtomicPricingBook,
  modelOffers: ReadonlyMap<string, string>,
): void {
  if (book.scope.kind !== "provider_resource") return;
  for (const offer of book.offers) {
    const modelRef = offer.offer_key.startsWith("request:")
      ? offer.offer_key.slice("request:".length)
      : undefined;
    const target = modelRef === undefined ? undefined : modelOffers.get(modelRef);
    if (target !== undefined)
      offer.relations.push(
        relation(
          offer,
          "compatible_with",
          [target],
          "This request component is compatible with the model's online offer",
        ),
      );
  }
}

function title(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
