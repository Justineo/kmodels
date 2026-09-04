import { compareCanonicalValues } from "./canonical-value.ts";
import type {
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
import type { ChargeBinding, PriceMeter, UsageSignal } from "./pricing-schema.ts";
import type { SourcePricingInputFact } from "./pricing-source.ts";

export function applyCerebrasCommercialTopology(
  input: AtomicProviderPricing,
  publishedModels: readonly PublishedPricingModel[],
  pricingInputs: readonly SourcePricingInputFact[],
): AtomicProviderPricing {
  const published = new Map(publishedModels.map((model) => [model.uid, model]));
  const inputIndex = indexPricingInputs(pricingInputs);
  return {
    ...input,
    books: input.books.flatMap((book) => {
      if (book.scope.kind === "models")
        return [
          includePricingInputSourceRefs(
            modelBook(book, published.get(book.scope.model_refs[0] ?? ""), inputIndex),
          ),
        ];
      return book.scope.resource_key === "batch" ? [cleanBook(book)] : [];
    }),
  };
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
            terms: offer.terms.map((term) => bindTerm(term, model, inputIndex)),
            relations: [],
            settlement: [],
          }
        : offer,
    ),
  };
}

function cleanBook(book: AtomicPricingBook): AtomicPricingBook {
  return {
    ...book,
    offers: book.offers.map((offer) => ({
      ...offer,
      enrollment: [],
      relations: [],
      settlement: [],
    })),
  };
}

function bindTerm(
  term: AtomicPricingTerm,
  model: PublishedPricingModel | undefined,
  inputIndex: PricingInputIndex,
): AtomicPricingTerm {
  return bindRateTerm(term, (meter, variant) => binding(meter, variant, model, inputIndex));
}

function binding(
  meter: PriceMeter,
  variant: AtomicRateVariant,
  model: PublishedPricingModel | undefined,
  inputIndex: PricingInputIndex,
): ChargeBinding | undefined {
  if (!isStandardUnit(variant.price.per, "token") || meter.namespace !== "kmodels") return;
  const hasCache = model?.capabilities.prompt_cache === true;
  const signal =
    meter.value === "cache_read_text"
      ? hasCache
        ? standardSignal("cached_input_tokens")
        : undefined
      : meter.value === "input_text"
        ? standardSignal(hasCache ? "uncached_input_tokens" : "input_tokens")
        : meter.value === "output_text"
          ? standardSignal("output_tokens")
          : undefined;
  if (signal === undefined) return;
  const protocols = endpointProtocols(model);
  const mapped =
    signal.value === "uncached_input_tokens"
      ? uncachedInputMethods(protocols, inputIndex)
      : directMethods(signal, protocolKeys(protocols, signal.value), inputIndex);
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

function endpointProtocols(
  model: PublishedPricingModel | undefined,
): ReadonlySet<"chat" | "completions"> {
  const paths = new Set(model?.api_endpoints?.map(({ path }) => path.replace(/^\//, "")) ?? []);
  return new Set([
    ...(paths.has("v1/chat/completions") ? (["chat"] as const) : []),
    ...(paths.has("v1/completions") ? (["completions"] as const) : []),
  ]);
}

function protocolKeys(protocols: ReadonlySet<"chat" | "completions">, signal: string): string[] {
  return [...protocols].flatMap((protocol) => usageKeys(protocol, signal));
}

function usageKeys(protocol: "chat" | "completions", signal: string): string[] {
  return [`${protocol}.${signal}`, `${protocol}.stream.${signal}`];
}

function uncachedInputMethods(
  protocols: ReadonlySet<"chat" | "completions">,
  inputIndex: PricingInputIndex,
): MethodsAndFacts {
  const totalSignal = standardSignal("input_tokens");
  const cachedSignal = standardSignal("cached_input_tokens");
  const total = pricingInputFacts(inputIndex, protocolKeys(protocols, totalSignal.value));
  const cached = pricingInputFacts(inputIndex, protocolKeys(protocols, cachedSignal.value));
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
