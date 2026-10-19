import { compareCanonicalValues } from "./canonical-value.ts";
import type {
  AtomicPricingBook,
  AtomicProviderPricing,
  AtomicRateVariant,
} from "./pricing-assembly.ts";
import type { PublishedPricingModel } from "./pricing-adapter.ts";
import { bindRateTerm, isStandardUnit, rawEvidence } from "./pricing-commercial-assembly.ts";
import {
  directQuantityMethods as directMethods,
  includePricingInputSourceRefs,
  indexPricingInputs,
  pricingInputObservation,
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
      return [];
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
    offers: book.offers.map((offer) => {
      if (offer.offer_key !== "usage") return offer;
      return {
        ...offer,
        offer_key: "payg",
        name: "Pay-as-you-go inference",
        terms: offer.terms.map((term) =>
          bindRateTerm(term, (meter, variant) => binding(meter, variant, model, inputIndex)),
        ),
        relations: [],
        settlement: [],
      };
    }),
  };
}

function binding(
  meter: PriceMeter,
  variant: AtomicRateVariant,
  model: PublishedPricingModel | undefined,
  inputIndex: PricingInputIndex,
): ChargeBinding | undefined {
  if (!isStandardUnit(variant.price.per, "token") || meter.namespace !== "kmodels") return;
  const signal =
    meter.value === "input_text"
      ? standardSignal("input_tokens")
      : meter.value === "output_text"
        ? standardSignal("output_tokens")
        : undefined;
  if (signal === undefined) return;
  const protocols = endpointProtocols(model);
  const mapped = directMethods(signal, protocolKeys(protocols, signal.value), inputIndex);
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
  return [...protocols].flatMap((protocol) => [
    `${protocol}.${signal}`,
    `${protocol}.stream.${signal}`,
  ]);
}

function standardSignal(
  value: "input_tokens" | "output_tokens",
): Extract<UsageSignal, { namespace: "kmodels" }> {
  return { namespace: "kmodels", value };
}
