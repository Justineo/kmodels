import { compareCanonicalValues } from "./canonical-value.ts";
import type {
  AtomicPriceState,
  AtomicPricingBook,
  AtomicPricingTerm,
  AtomicProviderPricing,
  AtomicRateVariant,
} from "./pricing-assembly.ts";
import type { PublishedPricingModel } from "./pricing-adapter.ts";
import { bindRateTerm, isStandardUnit, rawEvidence } from "./pricing-commercial-assembly.ts";
import {
  directQuantityMethods as directMethods,
  emptyQuantityMethods as emptyMethods,
  includePricingInputSourceRefs,
  indexPricingInputs,
  pricingInputFacts,
  pricingInputObservation,
  uniquePricingInputFacts,
  usageInputSources,
  type BoundQuantityMethods as MethodsAndFacts,
  type PricingInputIndex,
} from "./pricing-input.ts";
import type {
  ChargeBinding,
  PriceMeter,
  ProviderAtomRegistryEntry,
  ProviderPricingVocabulary,
  PublishedValidity,
  UsageSignal,
} from "./pricing-schema.ts";
import type { SourcePricingInputFact } from "./pricing-source.ts";
import { deepseekWeekendOffPeakEffectiveAt } from "./deepseek.ts";

export function applyDeepseekCommercialTopology(
  input: AtomicProviderPricing,
  publishedModels: readonly PublishedPricingModel[],
  pricingInputs: readonly SourcePricingInputFact[],
): AtomicProviderPricing {
  const published = new Map(publishedModels.map((model) => [model.uid, model]));
  const inputIndex = indexPricingInputs(pricingInputs);
  return {
    ...input,
    vocabulary: deepseekVocabulary(input.vocabulary, input.observed_at),
    books: input.books.flatMap((book) =>
      book.scope.kind === "models"
        ? [
            includePricingInputSourceRefs(
              modelBook(book, published.get(book.scope.model_refs[0] ?? ""), inputIndex),
            ),
          ]
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
  inputIndex: PricingInputIndex,
): AtomicPricingBook {
  return {
    ...book,
    offers: book.offers.map((offer) =>
      offer.offer_key === "usage"
        ? {
            ...offer,
            offer_key: "payg",
            name: "Pay-as-you-go inference",
            states: offer.states.map(normalizeStateValidity),
            terms: offer.terms.map((term) =>
              normalizeTermValidity(
                bindRateTerm(term, (meter, variant) =>
                  modelBinding(meter, variant, model, inputIndex),
                ),
              ),
            ),
            relations: [],
            settlement: [],
          }
        : offer,
    ),
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

function modelBinding(
  meter: PriceMeter,
  variant: AtomicRateVariant,
  model: PublishedPricingModel | undefined,
  inputIndex: PricingInputIndex,
): ChargeBinding | undefined {
  if (!isStandardUnit(variant.price.per, "token") || meter.namespace !== "kmodels") return;
  const signal =
    meter.value === "cache_read_text"
      ? standardSignal("cached_input_tokens")
      : meter.value === "input_text"
        ? standardSignal("uncached_input_tokens")
        : meter.value === "output_text"
          ? standardSignal("output_tokens")
          : undefined;
  if (signal === undefined) return;
  const paths = new Set(model?.api_endpoints?.map(({ path }) => path) ?? []);
  const mapped =
    signal.value === "uncached_input_tokens"
      ? uncachedInputMethods(paths, inputIndex)
      : directMethods(signal, protocolKeys(paths, signal.value), inputIndex);
  return {
    signal,
    aggregation: "request",
    ...(mapped.methods.length === 0 ? {} : { quantity_methods: mapped.methods }),
    observations: [
      rawEvidence(variant.observation),
      ...mapped.facts.map(pricingInputObservation),
    ].sort(compareCanonicalValues),
  };
}

function protocolKeys(paths: ReadonlySet<string>, signal: string): string[] {
  return [
    ...(paths.has("/chat/completions") ? usageKeys("chat", signal) : []),
    ...(paths.has("/responses") ? usageKeys("responses", signal) : []),
    ...(paths.has("/beta/completions") ? usageKeys("fim", signal) : []),
  ];
}

function usageKeys(protocol: "chat" | "fim" | "responses", signal: string): string[] {
  return [`${protocol}.${signal}`, `${protocol}.stream.${signal}`];
}

function uncachedInputMethods(
  paths: ReadonlySet<string>,
  inputIndex: PricingInputIndex,
): MethodsAndFacts {
  const direct = directMethods(
    standardSignal("uncached_input_tokens"),
    [
      ...(paths.has("/chat/completions") ? usageKeys("chat", "uncached_input_tokens") : []),
      ...(paths.has("/beta/completions") ? usageKeys("fim", "uncached_input_tokens") : []),
    ],
    inputIndex,
  );
  const derived = paths.has("/responses") ? responsesUncachedInput(inputIndex) : emptyMethods();
  return {
    methods: [...direct.methods, ...derived.methods].sort(compareCanonicalValues),
    facts: uniquePricingInputFacts([...direct.facts, ...derived.facts]),
  };
}

function responsesUncachedInput(inputIndex: PricingInputIndex): MethodsAndFacts {
  const totalSignal = standardSignal("input_tokens");
  const cachedSignal = standardSignal("cached_input_tokens");
  const total = pricingInputFacts(inputIndex, usageKeys("responses", "input_tokens"));
  const cached = pricingInputFacts(inputIndex, usageKeys("responses", "cached_input_tokens"));
  if (total.length === 0 || cached.length === 0) return emptyMethods();
  return {
    methods: [
      {
        calculation: {
          nodes: [
            { op: "signal", signal: totalSignal },
            { op: "signal", signal: cachedSignal },
            { op: "subtract_floor_zero", minuend: 0, subtrahend: 1 },
          ],
          result: 2,
        },
        input_sources: [
          ...usageInputSources(totalSignal, total),
          ...usageInputSources(cachedSignal, cached),
        ].sort(compareCanonicalValues),
      },
    ],
    facts: uniquePricingInputFacts([...total, ...cached]),
  };
}

function standardSignal(
  value: "cached_input_tokens" | "input_tokens" | "output_tokens" | "uncached_input_tokens",
): Extract<UsageSignal, { namespace: "kmodels" }> {
  return { namespace: "kmodels", value };
}
