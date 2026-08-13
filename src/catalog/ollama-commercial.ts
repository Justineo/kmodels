import type {
  AtomicPricingBook,
  AtomicPricingTerm,
  AtomicProviderPricing,
  AtomicRateVariant,
} from "./pricing-assembly.ts";
import {
  accountingGaps,
  bindRateTerm,
  isStandardUnit,
  providerKeyEvidence,
  stripAccountingGaps,
} from "./pricing-commercial-assembly.ts";
import type { ChargeBinding, PriceMeter } from "./pricing-schema.ts";
import type { PublishedPricingModel } from "./pricing-adapter.ts";

export function applyOllamaCommercialTopology(
  input: AtomicProviderPricing,
  publishedModels: readonly PublishedPricingModel[],
): AtomicProviderPricing {
  const published = new Map(publishedModels.map((model) => [model.uid, model]));
  return {
    ...input,
    books: input.books.flatMap((book) => {
      if (book.scope.kind !== "models") return [];
      const model = published.get(book.scope.model_refs[0] ?? "");
      return model?.service_families?.includes("Ollama Cloud") ? [modelBook(book, model)] : [];
    }),
  };
}

function modelBook(book: AtomicPricingBook, model: PublishedPricingModel): AtomicPricingBook {
  const endpoints = model.api_endpoints ?? [
    { name: "Generate", path: "/api/generate" },
    { name: "Chat", path: "/api/chat" },
  ];
  return {
    ...book,
    offers: book.offers.map((offer) => {
      if (offer.offer_key !== "usage") return offer;
      const blocked = accountingGaps(offer.terms);
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
        terms: stripAccountingGaps(offer.terms).map((term) =>
          bindTerm(term, endpoints, blocked, hasCacheRate),
        ),
        relations: [],
        settlement: [],
      };
    }),
  };
}

function bindTerm(
  term: AtomicPricingTerm,
  endpoints: NonNullable<PublishedPricingModel["api_endpoints"]>,
  blocked: ReadonlySet<string>,
  hasCacheRate: boolean,
): AtomicPricingTerm {
  return bindRateTerm(term, (meter, variant) =>
    binding(meter, variant, endpoints, blocked, hasCacheRate),
  );
}

function binding(
  meter: PriceMeter,
  variant: AtomicRateVariant,
  endpoints: NonNullable<PublishedPricingModel["api_endpoints"]>,
  blocked: ReadonlySet<string>,
  hasCacheRate: boolean,
): ChargeBinding | undefined {
  if (
    blocked.has("tokens") ||
    meter.namespace !== "kmodels" ||
    !isStandardUnit(variant.price.per, "token")
  )
    return;
  const signal =
    meter.value === "output_text"
      ? "output_tokens"
      : meter.value === "input_text" && !hasCacheRate
        ? "input_tokens"
        : undefined;
  if (signal === undefined) return;
  const field = signal === "output_tokens" ? "eval_count" : "prompt_eval_count";
  const observations = endpoints.flatMap(({ path }) =>
    ["/api/chat", "/api/generate"].includes(path)
      ? [providerKeyEvidence(variant.observation, `${path}:${field}`)]
      : [],
  );
  return observations.length === 0
    ? undefined
    : {
        signal: { namespace: "kmodels", value: signal },
        aggregation: "request",
        observations,
      };
}
