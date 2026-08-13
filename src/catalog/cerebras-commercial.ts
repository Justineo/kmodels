import type {
  AtomicPricingBook,
  AtomicPricingTerm,
  AtomicProviderPricing,
  AtomicRateVariant,
} from "./pricing-assembly.ts";
import type { ChargeBinding, PriceMeter } from "./pricing-schema.ts";
import type { PublishedPricingModel } from "./pricing-adapter.ts";
import {
  accountingGaps,
  bindRateTerm,
  isStandardUnit,
  providerKeyEvidence,
  stripAccountingGaps,
} from "./pricing-commercial-assembly.ts";

export function applyCerebrasCommercialTopology(
  input: AtomicProviderPricing,
  publishedModels: readonly PublishedPricingModel[],
): AtomicProviderPricing {
  const published = new Map(publishedModels.map((model) => [model.uid, model]));
  return {
    ...input,
    books: input.books.flatMap((book) => {
      if (book.scope.kind === "models")
        return [modelBook(book, published.get(book.scope.model_refs[0] ?? ""))];
      return book.scope.resource_key === "batch" ? [cleanBook(book)] : [];
    }),
  };
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
        terms: stripAccountingGaps(offer.terms).map((term) => bindTerm(term, model, blocked)),
        relations: [],
        settlement: [],
      };
    }),
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
  blocked: ReadonlySet<string>,
): AtomicPricingTerm {
  return bindRateTerm(term, (meter, variant) => binding(meter, variant, model, blocked));
}

function binding(
  meter: PriceMeter,
  variant: AtomicRateVariant,
  model: PublishedPricingModel | undefined,
  blocked: ReadonlySet<string>,
): ChargeBinding | undefined {
  if (
    blocked.has("tokens") ||
    blocked.has("service_tier") ||
    !isStandardUnit(variant.price.per, "token") ||
    meter.namespace !== "kmodels"
  )
    return;
  const hasCache = model?.capabilities.prompt_cache === true;
  const signal =
    meter.value === "cache_read_text"
      ? hasCache && !blocked.has("cache")
        ? "cached_input_tokens"
        : undefined
      : meter.value === "input_text"
        ? hasCache && !blocked.has("cache")
          ? "uncached_input_tokens"
          : "input_tokens"
        : meter.value === "output_text"
          ? "output_tokens"
          : undefined;
  if (signal === undefined) return;
  const paths = new Set(model?.api_endpoints?.map(({ path }) => path) ?? []);
  const observations = [
    ...(!blocked.has("chat") && paths.has("v1/chat/completions")
      ? [providerKeyEvidence(variant.observation, `chat:${locator(signal)}`)]
      : []),
    ...(!blocked.has("completions") && paths.has("v1/completions")
      ? [providerKeyEvidence(variant.observation, `completions:${locator(signal)}`)]
      : []),
  ];
  return observations.length === 0
    ? undefined
    : {
        signal: { namespace: "kmodels", value: signal },
        aggregation: "request",
        observations,
      };
}

function locator(
  signal: "cached_input_tokens" | "input_tokens" | "output_tokens" | "uncached_input_tokens",
): string {
  if (signal === "cached_input_tokens") return "usage.prompt_tokens_details.cached_tokens";
  if (signal === "uncached_input_tokens")
    return "usage.prompt_tokens - usage.prompt_tokens_details.cached_tokens";
  if (signal === "input_tokens") return "usage.prompt_tokens";
  return "usage.completion_tokens";
}
