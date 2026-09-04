import { compareCanonicalValues, uniqueCanonicalValues } from "./canonical-value.ts";
import type {
  AtomicPricingBook,
  AtomicPricingTerm,
  AtomicProviderPricing,
  AtomicRateVariant,
} from "./pricing-assembly.ts";
import type { PublishedPricingModel } from "./pricing-adapter.ts";
import { bindRateTerm, isStandardUnit, rawEvidence } from "./pricing-commercial-assembly.ts";
import {
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
  UsageQuantityMethod,
  UsageSignal,
} from "./pricing-schema.ts";
import type { SourcePricingInputFact } from "./pricing-source.ts";

const protocols = [
  "native.generate",
  "native.chat",
  "openai.chat",
  "openai.completions",
  "openai.responses",
] as const;

export function applyOllamaCommercialTopology(
  input: AtomicProviderPricing,
  publishedModels: readonly PublishedPricingModel[],
  pricingInputs: readonly SourcePricingInputFact[],
): AtomicProviderPricing {
  const published = new Map(publishedModels.map((model) => [model.uid, model]));
  const inputIndex = indexPricingInputs(pricingInputs);
  return {
    ...input,
    books: input.books.flatMap((book) => {
      if (book.scope.kind !== "models") return [];
      const model = published.get(book.scope.model_refs[0] ?? "");
      return model?.service_families?.includes("Ollama Cloud")
        ? [includePricingInputSourceRefs(modelBook(book, inputIndex))]
        : [];
    }),
  };
}

function modelBook(book: AtomicPricingBook, inputIndex: PricingInputIndex): AtomicPricingBook {
  return {
    ...book,
    offers: book.offers.map((offer) => {
      if (offer.offer_key !== "usage") return offer;
      const hasCacheRate = offer.terms.some(
        (term) =>
          term.kind === "rate" &&
          term.meter.namespace === "kmodels" &&
          term.meter.value === "cache_read_text",
      );
      return {
        ...offer,
        offer_key: "cloud-inference",
        name: "Ollama Cloud inference",
        enrollment: [],
        terms: offer.terms.map((term) => bindTerm(term, inputIndex, hasCacheRate)),
        relations: [],
        settlement: [],
      };
    }),
  };
}

function bindTerm(
  term: AtomicPricingTerm,
  inputIndex: PricingInputIndex,
  hasCacheRate: boolean,
): AtomicPricingTerm {
  return bindRateTerm(term, (meter, variant) => binding(meter, variant, inputIndex, hasCacheRate));
}

function binding(
  meter: PriceMeter,
  variant: AtomicRateVariant,
  inputIndex: PricingInputIndex,
  hasCacheRate: boolean,
): ChargeBinding | undefined {
  if (!isStandardUnit(variant.price.per, "token") || meter.namespace !== "kmodels") return;
  const signal =
    meter.value === "cache_read_text"
      ? standardSignal("cached_input_tokens")
      : meter.value === "input_text"
        ? standardSignal(hasCacheRate ? "uncached_input_tokens" : "input_tokens")
        : meter.value === "output_text"
          ? standardSignal("output_tokens")
          : undefined;
  if (signal === undefined) return;
  const mapped =
    signal.value === "uncached_input_tokens"
      ? uncachedInputMethods(inputIndex)
      : directMethods(signal, inputIndex);
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

function uncachedInputMethods(inputIndex: PricingInputIndex): MethodsAndFacts {
  const totalSignal = standardSignal("input_tokens");
  const cachedSignal = standardSignal("cached_input_tokens");
  const facts: SourcePricingInputFact[] = [];
  const methods = protocols.flatMap((protocol) =>
    ["response", "stream_event"].flatMap((channel): UsageQuantityMethod[] => {
      const suffix = channel === "response" ? "" : ".stream";
      const total = pricingInputFacts(inputIndex, [`${protocol}${suffix}.input_tokens`]);
      const cached = pricingInputFacts(inputIndex, [`${protocol}${suffix}.cached_input_tokens`]);
      if (total.length === 0 || cached.length === 0) return [];
      facts.push(...total, ...cached);
      return [
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
      ];
    }),
  );
  return { methods: uniqueCanonicalValues(methods), facts: uniquePricingInputFacts(facts) };
}

function directMethods(signal: UsageSignal, inputIndex: PricingInputIndex): MethodsAndFacts {
  const facts = pricingInputFacts(
    inputIndex,
    protocols.flatMap((protocol) => [
      `${protocol}.${signal.value}`,
      `${protocol}.stream.${signal.value}`,
    ]),
  );
  return facts.length === 0
    ? { methods: [], facts: [] }
    : { methods: [{ input_sources: usageInputSources(signal, facts) }], facts };
}

function standardSignal(
  value: "cached_input_tokens" | "input_tokens" | "output_tokens" | "uncached_input_tokens",
): Extract<UsageSignal, { namespace: "kmodels" }> {
  return { namespace: "kmodels", value };
}
