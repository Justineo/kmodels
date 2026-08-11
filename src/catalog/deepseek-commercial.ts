import type {
  AtomicPricingBook,
  AtomicPricingOffer,
  AtomicPricingTerm,
  AtomicProviderPricing,
  AtomicRateVariant,
} from "./pricing-assembly.ts";
import { unconditionalApplicability } from "./pricing-canonical.ts";
import { pricingBookId, pricingOfferId } from "./pricing-identifiers.ts";
import type { ChargeBinding, PriceMeter, RawPriceObservation } from "./pricing-schema.ts";
import type { PublishedPricingModel } from "./pricing-adapter.ts";
import {
  accountingGaps,
  isStandardUnit,
  offerEvidence,
  rawEvidence,
  relation,
} from "./pricing-commercial-assembly.ts";

export function applyDeepseekCommercialTopology(
  input: AtomicProviderPricing,
  publishedModels: readonly PublishedPricingModel[],
): AtomicProviderPricing {
  if (input.provider_id !== "deepseek") return input;
  const published = new Map(publishedModels.map((model) => [model.uid, model]));
  const modelOffers = new Map<string, string>();
  const books = input.books.map((book) => {
    if (book.scope.kind !== "models") return book;
    const migrated = modelBook(book, published.get(book.scope.model_refs[0] ?? ""));
    const offer = migrated.offers.find(({ offer_key }) => offer_key === "payg");
    if (offer !== undefined) {
      const ref = pricingOfferId(pricingBookId(input.provider_id, book.book_key), offer.offer_key);
      for (const modelRef of book.scope.model_refs) modelOffers.set(modelRef, ref);
    }
    return migrated;
  });
  for (const book of books)
    if (book.scope.kind === "provider_resource") bindResourceRelations(book, modelOffers);
  return { ...input, books };
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
      const migrated: AtomicPricingOffer = {
        ...offer,
        offer_key: "payg",
        name: "Pay-as-you-go inference",
        terms: offer.terms.map((term) => bindTerm(term, model, blocked)),
        relations: [],
      };
      return blocked.has("settlement") ? migrated : settled(migrated);
    }),
  };
}

function bindTerm(
  term: AtomicPricingTerm,
  model: PublishedPricingModel | undefined,
  blocked: ReadonlySet<string>,
): AtomicPricingTerm {
  if (term.kind !== "rate") return term;
  return {
    ...term,
    variants: term.variants.map((variant) => {
      const charge_binding = modelBinding(term.meter, variant, model, blocked);
      return charge_binding === undefined ? variant : { ...variant, charge_binding };
    }),
  };
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
      ? [bindingObservation(variant, chatLocator(signal))]
      : []),
    ...(!blocked.has("responses") && paths.has("/responses")
      ? [bindingObservation(variant, responsesLocator(signal))]
      : []),
    ...(!blocked.has("fim") && paths.has("/beta/completions")
      ? [bindingObservation(variant, fimLocator(signal))]
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
    return "responses:usage.input_tokens-input_tokens_details.cached_tokens";
  return "responses:usage.output_tokens";
}

function fimLocator(
  signal: "cached_input_tokens" | "output_tokens" | "uncached_input_tokens",
): string {
  if (signal === "cached_input_tokens") return "fim:usage.prompt_cache_hit_tokens";
  if (signal === "uncached_input_tokens") return "fim:usage.prompt_cache_miss_tokens";
  return "fim:usage.completion_tokens";
}

function bindingObservation(variant: AtomicRateVariant, value: string): RawPriceObservation {
  return {
    ...rawEvidence(variant.observation),
    locator: { kind: "provider_key", value },
  };
}

function bindResourceRelations(
  book: AtomicPricingBook,
  modelOffers: ReadonlyMap<string, string>,
): void {
  const key = book.scope.kind === "provider_resource" ? book.scope.resource_key : undefined;
  if (key !== "web-search" && key !== "anthropic-routing") return;
  for (const offer of book.offers) {
    const modelRefs =
      key === "web-search"
        ? [offer.offer_key.match(/^execution:(.+)$/)?.[1]].filter(
            (modelRef): modelRef is string => modelRef !== undefined,
          )
        : book.scope.model_refs;
    const targets = modelRefs.flatMap((modelRef) => {
      const target = modelOffers.get(modelRef);
      return target === undefined ? [] : [target];
    });
    if (targets.length === 0) continue;
    offer.relations.push(
      relation(
        offer,
        key === "web-search" ? "requires" : "compatible_with",
        targets,
        key === "web-search"
          ? "Provider-executed search can add separately metered model-token usage"
          : "Anthropic request-name routing resolves to the current DeepSeek model offers",
      ),
    );
  }
}

function settled(offer: AtomicPricingOffer): AtomicPricingOffer {
  return {
    ...offer,
    settlement: [
      {
        channel: "direct",
        biller: "DeepSeek",
        payment_sources: ["prepaid_balance", "provider_credit"],
        applicability: unconditionalApplicability,
        observations: [
          {
            ...rawEvidence(offerEvidence(offer)),
            raw: { label: "DeepSeek API usage deducts granted balance before topped-up balance" },
            establishes_applicability: unconditionalApplicability,
          },
        ],
      },
    ],
  };
}
