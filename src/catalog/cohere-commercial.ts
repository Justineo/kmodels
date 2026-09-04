import { uniqueCanonicalValues as unique } from "./canonical-value.ts";
import type {
  AtomicPricingBook,
  AtomicPricingTerm,
  AtomicProviderPricing,
  AtomicRateVariant,
} from "./pricing-assembly.ts";
import type { PublishedPricingModel } from "./pricing-adapter.ts";
import {
  addAtom,
  bindRateTerm,
  isStandardUnit,
  rawEvidence,
} from "./pricing-commercial-assembly.ts";
import {
  includePricingInputSourceRefs,
  indexPricingInputs,
  pricingInputFacts,
  pricingInputObservation,
  usageInputSources,
  type PricingInputIndex,
} from "./pricing-input.ts";
import type { ChargeBinding, PriceMeter, UsageSignal } from "./pricing-schema.ts";
import type { SourcePricingInputFact } from "./pricing-source.ts";

export function applyCohereCommercialTopology(
  input: AtomicProviderPricing,
  publishedModels: readonly PublishedPricingModel[],
  pricingInputs: readonly SourcePricingInputFact[],
): AtomicProviderPricing {
  const published = new Map(publishedModels.map((model) => [model.uid, model]));
  const inputIndex = indexPricingInputs(pricingInputs);
  return {
    ...input,
    books: input.books.flatMap((book) =>
      book.scope.kind === "models"
        ? [
            includePricingInputSourceRefs(
              modelBook(book, published.get(book.scope.model_refs[0] ?? ""), input, inputIndex),
            ),
          ]
        : [],
    ),
  };
}

function modelBook(
  book: AtomicPricingBook,
  model: PublishedPricingModel | undefined,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): AtomicPricingBook {
  return {
    ...book,
    resource_edges: [],
    offers: book.offers.flatMap((offer) =>
      offer.offer_key === "usage"
        ? [
            {
              ...offer,
              offer_key: "hosted-inference",
              name: "Hosted inference",
              enrollment: [],
              terms: offer.terms.map((term) => bindTerm(term, model, input, inputIndex)),
              relations: [],
              settlement: [],
            },
          ]
        : [],
    ),
  };
}

function bindTerm(
  term: AtomicPricingTerm,
  model: PublishedPricingModel | undefined,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): AtomicPricingTerm {
  return bindRateTerm(term, (meter, variant) => binding(meter, variant, model, input, inputIndex));
}

function binding(
  meter: PriceMeter,
  variant: AtomicRateVariant,
  model: PublishedPricingModel | undefined,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): ChargeBinding | undefined {
  const spec = signalSpec(meter, variant, model, input);
  if (spec === undefined) return;
  const facts = pricingInputFacts(inputIndex, spec.keys);
  return {
    signal: spec.signal,
    aggregation: "request",
    ...(facts.length === 0
      ? {}
      : { quantity_methods: [{ input_sources: usageInputSources(spec.signal, facts) }] }),
    observations: unique([rawEvidence(variant.observation), ...facts.map(pricingInputObservation)]),
  };
}

function signalSpec(
  meter: PriceMeter,
  variant: AtomicRateVariant,
  model: PublishedPricingModel | undefined,
  input: AtomicProviderPricing,
): { signal: UsageSignal; keys: string[] } | undefined {
  if (meter.namespace !== "kmodels") return;
  const paths = new Set(model?.api_endpoints?.map(({ path }) => path) ?? []);
  if (
    (meter.value === "input_text" || meter.value === "output_text") &&
    isStandardUnit(variant.price.per, "token")
  ) {
    const direction = meter.value === "input_text" ? "input" : "output";
    return {
      signal: { namespace: "kmodels", value: `${direction}_tokens` },
      keys: [
        ...(paths.has("v2/chat") ? [`chat.v2.${direction}_tokens`] : []),
        ...(paths.has("v1/chat") ? [`chat.v1.${direction}_tokens`] : []),
      ],
    };
  }
  if (meter.value === "embedding" && isStandardUnit(variant.price.per, "token")) {
    const image = variant.applicability.any_of.some(({ all_of }) =>
      all_of.some(
        (condition) =>
          condition.kind === "categorical" &&
          condition.dimension.namespace === "kmodels" &&
          condition.dimension.value === "modality" &&
          condition.values.some(({ value }) => value === "image"),
      ),
    );
    const signal = image
      ? providerSignal(
          input,
          "billed_image_tokens",
          "Cohere Embed image tokens reported in response meta.billed_units",
          variant,
        )
      : ({ namespace: "kmodels", value: "input_tokens" } as const);
    return {
      signal,
      keys: paths.has("v2/embed") ? [`embed.v2.${image ? "image_tokens" : "input_tokens"}`] : [],
    };
  }
  if (meter.value === "rerank")
    return {
      signal: providerSignal(
        input,
        "billed_search_units",
        "Cohere Rerank search units reported in response meta.billed_units",
        variant,
      ),
      keys: paths.has("v2/rerank") ? ["rerank.v2.search_units"] : [],
    };
}

function providerSignal(
  input: AtomicProviderPricing,
  key: string,
  definition: string,
  variant: AtomicRateVariant,
): Extract<UsageSignal, { namespace: "provider" }> {
  addAtom(input, {
    kind: "usage_signal",
    key,
    definition,
    unit: variant.price.per,
    resolution_phase: "outcome",
  });
  return { namespace: "provider", provider_id: input.provider_id, value: key };
}
