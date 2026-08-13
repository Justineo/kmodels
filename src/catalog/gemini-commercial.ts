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

type Mechanism = "sync" | "batch";

const servedTier = { namespace: "kmodels", value: "served_service_tier" } as const;

export function applyGeminiCommercialTopology(input: AtomicProviderPricing): AtomicProviderPricing {
  const modelOffers = new Map<string, string>();
  const books = input.books.map((book) => {
    if (book.scope.kind !== "models") return bindGroundingBook(book, input);
    const migrated = splitModelBook(book, input);
    if (migrated.offers.some(({ offer_key }) => offer_key === "sync")) {
      const ref = pricingOfferId(pricingBookId(input.provider_id, book.book_key), "sync");
      for (const modelRef of book.scope.model_refs) modelOffers.set(modelRef, ref);
    }
    return migrated;
  });
  for (const book of books) bindGroundingRelations(book, modelOffers);
  return { ...input, books };
}

function splitModelBook(book: AtomicPricingBook, input: AtomicProviderPricing): AtomicPricingBook {
  return {
    ...book,
    offers: book.offers.flatMap((offer) => {
      if (offer.offer_key !== "usage") return [offer];
      return (["sync", "batch"] as const)
        .map((mechanism) => partitionOffer(offer, mechanism, input))
        .filter((candidate): candidate is AtomicPricingOffer => candidate !== undefined);
    }),
  };
}

function partitionOffer(
  offer: AtomicPricingOffer,
  mechanism: Mechanism,
  input: AtomicProviderPricing,
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
  const terms = offer.terms.flatMap((term) => partitionTerm(term, mechanism, input, blocked));
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
  term: AtomicPricingTerm,
  mechanism: Mechanism,
  input: AtomicProviderPricing,
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
      : modelBinding(term.meter, variant, mechanism, input);
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
          definition: `Gemini response-reported served service tier ${JSON.stringify(value.value)}`,
          label: value.value.charAt(0).toUpperCase() + value.value.slice(1),
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

function modelBinding(
  meter: PriceMeter,
  variant: AtomicRateVariant,
  mechanism: Mechanism,
  input: AtomicProviderPricing,
): ChargeBinding | undefined {
  const signal = modelSignal(meter, variant.price.per);
  if (signal === undefined) return;
  const locators = signal.locators.filter(
    ({ mechanisms }) => mechanisms === undefined || mechanisms.includes(mechanism),
  );
  if (locators.length === 0) return;
  const prefix = mechanism === "batch" ? "batch-result" : "response";
  const aggregation = mechanism === "batch" ? "result_item" : "request";
  if (signal.standard !== undefined)
    return {
      signal: { namespace: "kmodels", value: signal.standard },
      aggregation,
      observations: locators.map(({ value }) =>
        providerKeyEvidence(variant.observation, `${prefix}:${value}`),
      ),
    };
  addAtom(input, {
    kind: "usage_signal",
    key: signal.key,
    definition: signal.definition,
    unit: variant.price.per,
    resolution_phase: "outcome",
  });
  return {
    signal: { namespace: "provider", provider_id: input.provider_id, value: signal.key },
    aggregation,
    observations: locators.map(({ value }) =>
      providerKeyEvidence(variant.observation, `${prefix}:${value}`),
    ),
  };
}

interface SignalLocator {
  value: string;
  mechanisms?: readonly Mechanism[];
}

function modelSignal(
  meter: PriceMeter,
  unit: UnitExpression,
):
  | {
      standard: "uncached_input_tokens" | "cached_input_tokens" | "output_tokens";
      locators: SignalLocator[];
      key?: never;
      definition?: never;
    }
  | { key: string; definition: string; locators: SignalLocator[]; standard?: never }
  | undefined {
  if (meter.namespace !== "kmodels" || !isStandardUnit(unit, "token")) return;
  const modality = meter.value.split("_").at(-1)?.toUpperCase();
  if (meter.value.startsWith("input_") && modality !== undefined)
    return {
      key: `uncached_input_${modality.toLowerCase()}_tokens`,
      definition: `Uncached Gemini ${modality.toLowerCase()} input tokens reported by usage metadata`,
      locators: [
        {
          value: `GenerateContentResponse.usageMetadata.promptTokensDetails[modality=${modality}].tokenCount - GenerateContentResponse.usageMetadata.cacheTokensDetails[modality=${modality}].tokenCount`,
        },
        {
          value: `Interaction.usage.input_tokens_by_modality[modality=${modality.toLowerCase()}].tokens - Interaction.usage.cached_tokens_by_modality[modality=${modality.toLowerCase()}].tokens`,
          mechanisms: ["sync"],
        },
      ],
    };
  if (meter.value.startsWith("cache_read_") && modality !== undefined)
    return {
      key: `cached_input_${modality.toLowerCase()}_tokens`,
      definition: `Cached Gemini ${modality.toLowerCase()} input tokens reported by usage metadata`,
      locators: [
        {
          value: `GenerateContentResponse.usageMetadata.cacheTokensDetails[modality=${modality}].tokenCount`,
        },
        {
          value: `Interaction.usage.cached_tokens_by_modality[modality=${modality.toLowerCase()}].tokens`,
          mechanisms: ["sync"],
        },
      ],
    };
  if (meter.value === "output_text")
    return {
      standard: "output_tokens",
      locators: [
        {
          value:
            "GenerateContentResponse.usageMetadata.candidatesTokenCount + GenerateContentResponse.usageMetadata.thoughtsTokenCount",
        },
        {
          value: "Interaction.usage.total_output_tokens + Interaction.usage.total_thought_tokens",
          mechanisms: ["sync"],
        },
      ],
    };
  if (meter.value.startsWith("output_") && modality !== undefined)
    return {
      key: `output_${modality.toLowerCase()}_tokens`,
      definition: `Gemini ${modality.toLowerCase()} output tokens reported by usage metadata`,
      locators: [
        {
          value: `GenerateContentResponse.usageMetadata.candidatesTokensDetails[modality=${modality}].tokenCount`,
        },
        {
          value: `Interaction.usage.output_tokens_by_modality[modality=${modality.toLowerCase()}].tokens`,
          mechanisms: ["sync"],
        },
      ],
    };
  if (meter.value === "embedding")
    return {
      key: "embedding_input_tokens",
      definition: "Gemini embedding input tokens reported by the embedding response",
      locators: [{ value: "EmbedContentResponse.usageMetadata.promptTokenCount" }],
    };
}

function bindGroundingBook(
  book: AtomicPricingBook,
  input: AtomicProviderPricing,
): AtomicPricingBook {
  if (
    book.scope.kind !== "provider_resource" ||
    !["google-search", "google-maps"].includes(book.scope.resource_key)
  )
    return book;
  const resourceKey = book.scope.resource_key;
  return {
    ...book,
    resource_edges: [],
    offers: book.offers.map((offer) => ({
      ...offer,
      enrollment: [],
      settlement: [],
      terms: offer.terms.map((term) => {
        if (term.kind !== "rate") return term;
        const blocked = offer.terms.some(
          (candidate) =>
            candidate.kind === "raw" && candidate.term_key === "charge_binding_unavailable",
        );
        return {
          ...term,
          variants: term.variants.map((variant) => ({
            ...variant,
            ...(blocked ? {} : { charge_binding: groundingBinding(resourceKey, variant, input) }),
          })),
        };
      }),
    })),
  };
}

function groundingBinding(
  resourceKey: string,
  variant: AtomicRateVariant,
  input: AtomicProviderPricing,
): ChargeBinding {
  const maps = resourceKey === "google-maps";
  const request = isStandardUnit(variant.price.per, "request");
  const key = `${maps ? "maps" : "search"}_${request ? "grounded_prompts" : "executed_queries"}`;
  addAtom(input, {
    kind: "usage_signal",
    key,
    definition: request
      ? `Qualifying Gemini ${maps ? "Maps" : "Search"} grounded prompts reported by the interaction or generated result`
      : `Gemini ${maps ? "Maps" : "Search"} queries reported by the interaction or generated result`,
    unit: variant.price.per,
    resolution_phase: "outcome",
  });
  return {
    signal: { namespace: "provider", provider_id: input.provider_id, value: key },
    aggregation: "result_item",
    observations: [
      providerKeyEvidence(
        variant.observation,
        `Interaction.usage.grounding_tool_count[type=${maps ? "google_maps" : "google_search"}].count`,
      ),
      providerKeyEvidence(
        variant.observation,
        maps
          ? "GenerateContentResponse.candidates[*].groundingMetadata.googleMapsWidgetContextToken (one grounded prompt)"
          : "GenerateContentResponse.candidates[*].groundingMetadata.webSearchQueries.length",
      ),
    ],
  };
}

function bindGroundingRelations(
  book: AtomicPricingBook,
  modelOffers: ReadonlyMap<string, string>,
): void {
  if (
    book.scope.kind !== "provider_resource" ||
    !["google-search", "google-maps"].includes(book.scope.resource_key)
  )
    return;
  for (const offer of book.offers) {
    const modelRef = offer.offer_key.startsWith("grounding:")
      ? offer.offer_key.slice("grounding:".length)
      : undefined;
    const target = modelRef === undefined ? undefined : modelOffers.get(modelRef);
    if (target !== undefined)
      offer.relations.push(
        relation(
          offer,
          "compatible_with",
          [target],
          "Grounding is compatible with this model's online inference offer",
        ),
      );
  }
}
