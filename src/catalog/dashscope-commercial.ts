import type {
  AtomicPricingBook,
  AtomicPricingOffer,
  AtomicPricingTerm,
  AtomicProviderPricing,
  AtomicRateVariant,
  AtomicRawVariant,
} from "./pricing-assembly.ts";
import { canonicalizeApplicability } from "./pricing-canonical.ts";
import { isStandardUnit, rawEvidence, withApplicability } from "./pricing-commercial-assembly.ts";
import type {
  ChargeBinding,
  PriceApplicability,
  PriceCondition,
  PriceMeter,
  UnitExpression,
  UsageSignal,
} from "./pricing-schema.ts";

type Mechanism = "sync" | "batch";
type StandardSignal = Extract<UsageSignal, { namespace: "kmodels" }>["value"];

export function applyDashscopeCommercialTopology(
  input: AtomicProviderPricing,
): AtomicProviderPricing {
  return {
    ...input,
    books: input.books.map((book) =>
      book.scope.kind === "models" ? splitModelBook(book) : bindResourceBook(book),
    ),
  };
}

function splitModelBook(book: AtomicPricingBook): AtomicPricingBook {
  return {
    ...book,
    offers: book.offers.flatMap((offer) => {
      if (offer.offer_key !== "usage") return [{ ...offer, relations: [], settlement: [] }];
      return (["sync", "batch"] as const).flatMap((mechanism) => {
        const partition = partitionOffer(offer, mechanism);
        return partition === undefined ? [] : [partition];
      });
    }),
    resource_edges: [],
  };
}

function partitionOffer(
  offer: AtomicPricingOffer,
  mechanism: Mechanism,
): AtomicPricingOffer | undefined {
  const states = offer.states.flatMap((state) => {
    const applicability = mechanismApplicability(state.applicability, mechanism);
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
  const terms = offer.terms.flatMap((term) => partitionTerm(term, mechanism));
  if (states.length === 0 && terms.length === 0) return;
  return {
    ...offer,
    offer_key: mechanism,
    name: mechanism === "batch" ? "Batch inference" : "Realtime inference",
    states,
    terms,
    relations: [],
    settlement: [],
  };
}

function partitionTerm(term: AtomicPricingTerm, mechanism: Mechanism): AtomicPricingTerm[] {
  if (term.kind === "raw") {
    const variants = term.variants.flatMap((variant) => partitionRaw(variant, mechanism));
    return variants.length === 0 ? [] : [{ ...term, variants }];
  }
  if (term.kind !== "rate") return mechanism === "sync" ? [term] : [];
  const variants = term.variants.flatMap((variant) => {
    const applicability = mechanismApplicability(variant.applicability, mechanism);
    if (applicability === undefined) return [];
    const next = {
      ...variant,
      applicability,
      observation: withApplicability(variant.observation, applicability),
    };
    const charge_binding = modelBinding(term.meter, next, mechanism);
    return [{ ...next, ...(charge_binding === undefined ? {} : { charge_binding }) }];
  });
  const raw_variants = term.raw_variants.flatMap((variant) => partitionRaw(variant, mechanism));
  return variants.length + raw_variants.length === 0 ? [] : [{ ...term, variants, raw_variants }];
}

function partitionRaw(variant: AtomicRawVariant, mechanism: Mechanism): AtomicRawVariant[] {
  if (variant.possible_scope === undefined) return mechanism === "sync" ? [variant] : [];
  const possible_scope = mechanismApplicability(variant.possible_scope, mechanism);
  return possible_scope === undefined ? [] : [{ ...variant, possible_scope }];
}

function mechanismApplicability(
  applicability: PriceApplicability,
  mechanism: Mechanism,
): PriceApplicability | undefined {
  const any_of = applicability.any_of.flatMap(({ all_of }) => {
    const tier = all_of.find(isBatchTier);
    if ((mechanism === "batch") !== (tier !== undefined)) return [];
    return [{ all_of: tier === undefined ? all_of : all_of.filter((item) => item !== tier) }];
  });
  return any_of.length === 0 ? undefined : canonicalizeApplicability({ any_of });
}

function isBatchTier(condition: PriceCondition): boolean {
  return (
    condition.kind === "categorical" &&
    condition.dimension.namespace === "kmodels" &&
    condition.dimension.value === "service_tier" &&
    condition.values.some(({ value }) => value === "batch")
  );
}

function modelBinding(
  meter: PriceMeter,
  variant: AtomicRateVariant,
  mechanism: Mechanism,
): ChargeBinding | undefined {
  const signal = modelSignal(meter, variant.price.per);
  if (signal === undefined) return;
  return {
    signal: { namespace: "kmodels", value: signal },
    aggregation: mechanism === "batch" ? "result_item" : "request",
    observations: usageFields(signal, mechanism).map((field) => ({
      ...rawEvidence(variant.observation),
      locator: { kind: "provider_key", value: field },
    })),
  };
}

function modelSignal(meter: PriceMeter, unit: UnitExpression): StandardSignal | undefined {
  if (meter.namespace !== "kmodels") return;
  if (meter.value === "input_text" && isStandardUnit(unit, "token")) return "uncached_input_tokens";
  if (meter.value === "cache_read_text" && isStandardUnit(unit, "token"))
    return "cached_input_tokens";
  if (meter.value === "cache_write_text" && isStandardUnit(unit, "token"))
    return "cache_write_tokens";
  if (meter.value === "output_text" && isStandardUnit(unit, "token")) return "output_tokens";
}

function usageFields(signal: StandardSignal, mechanism: Mechanism): string[] {
  if (mechanism === "batch") return [`batch-result:usage.${usageField(signal)}`];
  switch (signal) {
    case "cache_write_tokens":
      return [
        "chat:usage.prompt_tokens_details.cache_creation_input_tokens",
        "anthropic:usage.cache_creation_input_tokens",
      ];
    case "cached_input_tokens":
      return [
        "chat:usage.prompt_tokens_details.cached_tokens",
        "responses:usage.input_tokens_details.cached_tokens",
        "anthropic:usage.cache_read_input_tokens",
      ];
    case "input_tokens":
    case "uncached_input_tokens":
      return ["chat:usage.prompt_tokens", "responses:usage.input_tokens"];
    case "output_tokens":
      return ["chat:usage.completion_tokens", "responses:usage.output_tokens"];
    default:
      return [];
  }
}

function usageField(signal: StandardSignal): string {
  if (signal === "cache_write_tokens") return "cache_creation_input_tokens";
  if (signal === "cached_input_tokens") return "cached_tokens";
  if (signal === "input_tokens" || signal === "uncached_input_tokens") return "input_tokens";
  if (signal === "output_tokens") return "output_tokens";
  return signal;
}

function bindResourceBook(book: AtomicPricingBook): AtomicPricingBook {
  if (book.scope.kind !== "provider_resource" || book.scope.resource_key !== "web-search")
    return { ...book, resource_edges: [] };
  return {
    ...book,
    offers: book.offers.map((offer) => ({
      ...offer,
      terms: offer.terms.map((term) => {
        if (
          term.kind !== "rate" ||
          term.meter.namespace !== "kmodels" ||
          term.meter.value !== "web_search"
        )
          return term;
        return {
          ...term,
          variants: term.variants.map(
            (variant): AtomicRateVariant => ({
              ...variant,
              charge_binding: {
                signal: { namespace: "kmodels", value: "successful_web_searches" },
                aggregation: "request",
                observations: [
                  {
                    ...rawEvidence(variant.observation),
                    locator: {
                      kind: "provider_key",
                      value: "responses:usage.x_tools.web_search.count",
                    },
                  },
                ],
              },
            }),
          ),
        };
      }),
      relations: [],
      settlement: [],
    })),
    resource_edges: [],
  };
}
