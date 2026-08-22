import type {
  AtomicPriceState,
  AtomicPricingBook,
  AtomicPricingTerm,
  AtomicProviderPricing,
  AtomicRateVariant,
} from "./pricing-assembly.ts";
import type {
  ChargeBinding,
  PriceMeter,
  ProviderAtomRegistryEntry,
  ProviderPricingVocabulary,
  PublishedValidity,
} from "./pricing-schema.ts";
import type { PublishedPricingModel } from "./pricing-adapter.ts";
import {
  accountingGaps,
  bindRateTerm,
  isStandardUnit,
  providerKeyEvidence,
  stripAccountingGaps,
} from "./pricing-commercial-assembly.ts";
import { deepseekWeekendOffPeakEffectiveAt } from "./deepseek.ts";

export function applyDeepseekCommercialTopology(
  input: AtomicProviderPricing,
  publishedModels: readonly PublishedPricingModel[],
): AtomicProviderPricing {
  const published = new Map(publishedModels.map((model) => [model.uid, model]));
  return {
    ...input,
    vocabulary: deepseekVocabulary(input.vocabulary, input.observed_at),
    books: input.books.flatMap((book) =>
      book.scope.kind === "models"
        ? [modelBook(book, published.get(book.scope.model_refs[0] ?? ""))]
        : [],
    ),
  };
}

function deepseekVocabulary(
  vocabulary: ProviderPricingVocabulary,
  observedAt: string,
): ProviderPricingVocabulary {
  return { ...vocabulary, atoms: vocabulary.atoms.map((atom) => deepseekAtom(atom, observedAt)) };
}

function deepseekAtom(
  atom: ProviderAtomRegistryEntry,
  observedAt: string,
): ProviderAtomRegistryEntry {
  if (
    atom.kind !== "categorical_value" ||
    atom.dimension.namespace !== "kmodels" ||
    atom.dimension.value !== "billing_period"
  )
    return atom;
  const weekendsAreOffPeak = observedAt >= deepseekWeekendOffPeakEffectiveAt;
  if (atom.key === "peak")
    return {
      ...atom,
      label: "Peak",
      schedule: weekendsAreOffPeak
        ? {
            kind: "weekly_time_windows",
            time_zone: "UTC",
            days: ["monday", "tuesday", "wednesday", "thursday", "friday"],
            windows: [
              { from: "01:00", until: "04:00" },
              { from: "06:00", until: "10:00" },
            ],
          }
        : {
            kind: "daily_time_windows",
            time_zone: "UTC",
            windows: [
              { from: "01:00", until: "04:00" },
              { from: "06:00", until: "10:00" },
            ],
          },
    };
  if (atom.key === "off_peak")
    return {
      ...atom,
      label: "Off-peak",
      schedule: {
        kind: weekendsAreOffPeak ? "weekly_time_remainder" : "daily_time_remainder",
        time_zone: "UTC",
      },
    };
  return atom;
}

function modelBook(
  book: AtomicPricingBook,
  model: PublishedPricingModel | undefined,
): AtomicPricingBook {
  return {
    ...book,
    offers: book.offers.map((offer) => {
      if (offer.offer_key !== "usage") return offer;
      const blocked = accountingGaps(offer.terms);
      return {
        ...offer,
        offer_key: "payg",
        name: "Pay-as-you-go inference",
        states: offer.states.map(normalizeStateValidity),
        terms: stripAccountingGaps(offer.terms).map((term) =>
          normalizeTermValidity(bindTerm(term, model, blocked)),
        ),
        relations: [],
        settlement: [],
      };
    }),
  };
}

function normalizeStateValidity(state: AtomicPriceState): AtomicPriceState {
  const validity = deepseekValidity(state.validity);
  return validity === undefined ? state : { ...state, validity };
}

function normalizeTermValidity(term: AtomicPricingTerm): AtomicPricingTerm {
  if (term.kind !== "rate") return term;
  return {
    ...term,
    variants: term.variants.map((variant) => {
      const validity = deepseekValidity(variant.validity);
      return validity === undefined ? variant : { ...variant, validity };
    }),
  };
}

function deepseekValidity(validity: PublishedValidity | undefined): PublishedValidity | undefined {
  if (validity === undefined) return;
  const from =
    validity.from === undefined
      ? undefined
      : { ...validity.from, inclusive: validity.from.inclusive ?? true };
  const until =
    validity.until === undefined
      ? undefined
      : { ...validity.until, inclusive: validity.until.inclusive ?? false };
  if (from === undefined) return until === undefined ? undefined : { until };
  return until === undefined ? { from } : { from, until };
}

function bindTerm(
  term: AtomicPricingTerm,
  model: PublishedPricingModel | undefined,
  blocked: ReadonlySet<string>,
): AtomicPricingTerm {
  return bindRateTerm(term, (meter, variant) => modelBinding(meter, variant, model, blocked));
}

function modelBinding(
  meter: PriceMeter,
  variant: AtomicRateVariant,
  model: PublishedPricingModel | undefined,
  blocked: ReadonlySet<string>,
): ChargeBinding | undefined {
  if (
    blocked.has("tokens") ||
    !isStandardUnit(variant.price.per, "token") ||
    meter.namespace !== "kmodels"
  )
    return;
  const signal =
    meter.value === "cache_read_text"
      ? "cached_input_tokens"
      : meter.value === "input_text"
        ? "uncached_input_tokens"
        : meter.value === "output_text"
          ? "output_tokens"
          : undefined;
  if (signal === undefined || (signal === "cached_input_tokens" && blocked.has("cache"))) return;
  const paths = new Set(model?.api_endpoints?.map(({ path }) => path) ?? []);
  const observations = [
    ...(!blocked.has("chat") && paths.has("/chat/completions")
      ? [providerKeyEvidence(variant.observation, chatLocator(signal))]
      : []),
    ...(!blocked.has("responses") && paths.has("/responses")
      ? [providerKeyEvidence(variant.observation, responsesLocator(signal))]
      : []),
    ...(!blocked.has("fim") && paths.has("/beta/completions")
      ? [providerKeyEvidence(variant.observation, fimLocator(signal))]
      : []),
  ];
  if (observations.length === 0) return;
  return {
    signal: { namespace: "kmodels", value: signal },
    aggregation: "request",
    observations,
  };
}

function chatLocator(
  signal: "cached_input_tokens" | "output_tokens" | "uncached_input_tokens",
): string {
  if (signal === "cached_input_tokens") return "chat:usage.prompt_cache_hit_tokens";
  if (signal === "uncached_input_tokens") return "chat:usage.prompt_cache_miss_tokens";
  return "chat:usage.completion_tokens";
}

function responsesLocator(
  signal: "cached_input_tokens" | "output_tokens" | "uncached_input_tokens",
): string {
  if (signal === "cached_input_tokens") return "responses:usage.input_tokens_details.cached_tokens";
  if (signal === "uncached_input_tokens")
    return "responses:usage.input_tokens - usage.input_tokens_details.cached_tokens";
  return "responses:usage.output_tokens";
}

function fimLocator(
  signal: "cached_input_tokens" | "output_tokens" | "uncached_input_tokens",
): string {
  if (signal === "cached_input_tokens") return "fim:usage.prompt_cache_hit_tokens";
  if (signal === "uncached_input_tokens") return "fim:usage.prompt_cache_miss_tokens";
  return "fim:usage.completion_tokens";
}
