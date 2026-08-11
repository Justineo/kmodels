import type {
  AtomicAllowanceTerm,
  AtomicPricingBook,
  AtomicPricingOffer,
  AtomicPricingTerm,
  AtomicProviderPricing,
  AtomicRateVariant,
} from "./pricing-assembly.ts";
import { unconditionalApplicability } from "./pricing-canonical.ts";
import { pricingBookId, pricingOfferId } from "./pricing-identifiers.ts";
import { rationalFromDecimal } from "./pricing-rational.ts";
import type {
  ChargeBinding,
  NormalizedPriceObservation,
  PriceMeter,
  RawPriceObservation,
} from "./pricing-schema.ts";
import type { PublishedPricingModel } from "./pricing-adapter.ts";
import {
  accountingGaps,
  addAtom,
  isStandardUnit,
  offerEvidence,
  rawEvidence,
  relation,
} from "./pricing-commercial-assembly.ts";

interface ModelOffer {
  offer: AtomicPricingOffer;
  ref: string;
}

export function applyCerebrasCommercialTopology(
  input: AtomicProviderPricing,
  publishedModels: readonly PublishedPricingModel[],
): AtomicProviderPricing {
  if (input.provider_id !== "cerebras") return input;
  const published = new Map(publishedModels.map((model) => [model.uid, model]));
  const modelOffers = new Map<string, ModelOffer>();
  const books = input.books.map((book) => {
    if (book.scope.kind !== "models") return resourceBook(book);
    const modelRef = book.scope.model_refs[0];
    const migrated = modelBook(book, modelRef === undefined ? undefined : published.get(modelRef));
    const offer = migrated.offers.find(({ offer_key }) => offer_key === "payg");
    if (offer !== undefined)
      for (const ref of book.scope.model_refs)
        modelOffers.set(ref, {
          offer,
          ref: pricingOfferId(pricingBookId(input.provider_id, book.book_key), offer.offer_key),
        });
    return migrated;
  });
  bindResources(input, books, modelOffers);
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
      const hasCache = offer.terms.some(
        (term) =>
          term.kind === "rate" &&
          term.meter.namespace === "kmodels" &&
          term.meter.value === "cache_read_text",
      );
      const migrated: AtomicPricingOffer = {
        ...offer,
        offer_key: "payg",
        name: "Developer pay-as-you-go inference",
        terms: offer.terms.map((term) => bindTerm(term, model, blocked, hasCache)),
        relations: [],
      };
      return blocked.has("settlement") ? migrated : directSettlement(migrated);
    }),
  };
}

function resourceBook(book: AtomicPricingBook): AtomicPricingBook {
  if (book.scope.kind !== "provider_resource") return book;
  const key = book.scope.resource_key;
  return {
    ...book,
    offers: book.offers.map((offer) => {
      const enrollment =
        key === "batch" || key === "batch-file"
          ? "private_preview"
          : key === "inference-subscription" ||
              key === "dedicated-endpoint" ||
              key === "model-development" ||
              key === "aws-marketplace" ||
              key === "cost-report" ||
              key === "project-quota" ||
              key === "dedicated-metrics"
            ? "account_scoped"
            : undefined;
      const evidence = offerEvidence(offer);
      const migrated: AtomicPricingOffer = {
        ...offer,
        ...(enrollment === undefined
          ? {}
          : {
              enrollment: [
                {
                  state: enrollment,
                  applicability: unconditionalApplicability,
                  observations: [normalized(evidence)],
                },
              ],
            }),
        relations: [],
      };
      if (key === "cerebras-code") return closeCodePlan(migrated);
      if (key === "dedicated-endpoint")
        return settled(migrated, "direct", "Cerebras", ["postpaid_invoice"]);
      if (key === "aws-marketplace")
        return settled(migrated, "marketplace", "AWS Marketplace", [
          "postpaid_invoice",
          "marketplace_commitment",
        ]);
      return migrated;
    }),
  };
}

function bindResources(
  input: AtomicProviderPricing,
  books: AtomicPricingBook[],
  modelOffers: ReadonlyMap<string, ModelOffer>,
): void {
  const batchFile = resourceOffer(books, "batch-file");
  for (const book of books) {
    if (book.scope.kind !== "provider_resource") continue;
    const key = book.scope.resource_key;
    if (key === "free-trial") bindTrial(input, book, modelOffers);
    if (key === "inference-subscription")
      bindPerModelAlternatives(book, modelOffers, "subscription");
    if (key === "batch") {
      bindPerModelAlternatives(book, modelOffers, "batch");
      if (batchFile !== undefined)
        for (const offer of book.offers)
          offer.relations.push(
            relation(
              offer,
              "requires",
              [batchFile],
              "A Batch execution requires a Batch-purpose input file",
            ),
          );
    }
    if (key === "aws-marketplace") {
      const targets = book.scope.model_refs.flatMap((ref) => {
        const target = modelOffers.get(ref);
        return target === undefined ? [] : [target.ref];
      });
      for (const offer of book.offers)
        if (targets.length > 0)
          offer.relations.push(
            relation(
              offer,
              "compatible_with",
              targets,
              "AWS Marketplace is an alternate settlement channel for direct Cerebras inference",
            ),
          );
    }
  }
}

function bindTrial(
  input: AtomicProviderPricing,
  book: AtomicPricingBook,
  modelOffers: ReadonlyMap<string, ModelOffer>,
): void {
  const offer = book.offers.find(({ offer_key }) => offer_key === "credit");
  const rawTerm = offer?.terms.find(
    (term) => term.kind === "raw" && term.term_key === "free-trial-credit",
  );
  if (offer === undefined || rawTerm?.kind !== "raw") return;
  const observation = rawTerm.variants[0]?.observation;
  const targets =
    book.scope.kind === "provider_resource"
      ? book.scope.model_refs.flatMap((ref) => {
          const target = modelOffers.get(ref);
          return target === undefined ? [] : [target.ref];
        })
      : [];
  if (observation === undefined || targets.length === 0) return;
  addAtom(input, {
    kind: "allowance_reset",
    key: "30_days_after_grant",
    definition: "Thirty days after the provider grants the trial credit",
  });
  const allowance: AtomicAllowanceTerm = {
    term_key: "free-trial-credit",
    kind: "allowance",
    variants: [
      {
        benefit: {
          kind: "credit",
          amount: rationalFromDecimal("5"),
          denomination: { kind: "fiat", currency: "USD" },
        },
        target: { kind: "offers", offer_refs: [...new Set(targets)].sort() },
        reset: {
          namespace: "provider",
          provider_id: input.provider_id,
          value: "30_days_after_grant",
        },
        applicability: unconditionalApplicability,
        observation: normalized(observation),
      },
    ],
    raw_variants: [],
    source_refs: rawTerm.source_refs,
  };
  offer.terms = [
    ...offer.terms.filter(({ term_key }) => term_key !== "free-trial-credit"),
    allowance,
  ];
  offer.enrollment = [
    {
      state: "open",
      applicability: unconditionalApplicability,
      observations: [normalized(observation)],
    },
  ];
  offer.settlement = [
    {
      channel: "direct",
      biller: "Cerebras",
      payment_sources: ["allowance"],
      applicability: unconditionalApplicability,
      observations: [normalized(observation)],
    },
  ];
}

function bindPerModelAlternatives(
  book: AtomicPricingBook,
  modelOffers: ReadonlyMap<string, ModelOffer>,
  kind: "batch" | "subscription",
): void {
  for (const offer of book.offers) {
    const prefix = kind === "batch" ? "execution:" : "model:";
    const modelRef = offer.offer_key.startsWith(prefix) ? offer.offer_key.slice(prefix.length) : "";
    const target = modelOffers.get(modelRef);
    if (target === undefined) continue;
    const label =
      kind === "batch"
        ? "Batch and synchronous inference are alternative execution mechanisms"
        : "An active model subscription and PAYG are alternative settlement paths for one request";
    offer.relations.push(relation(offer, "exclusive_with", [target.ref], label));
    target.offer.relations.push(
      relation(
        target.offer,
        "exclusive_with",
        [pricingOfferId(pricingBookId("cerebras", book.book_key), offer.offer_key)],
        label,
      ),
    );
  }
}

function closeCodePlan(offer: AtomicPricingOffer): AtomicPricingOffer {
  const closed = offer.terms.find(
    (term) => term.kind === "raw" && term.term_key === "closed-enrollment",
  );
  if (closed?.kind !== "raw") return offer;
  const observation = closed.variants[0]?.observation;
  if (observation === undefined) return offer;
  return {
    ...offer,
    enrollment: [
      {
        state: "closed_to_new",
        applicability: unconditionalApplicability,
        observations: [normalized(observation)],
      },
    ],
    terms: offer.terms.filter(({ term_key }) => term_key !== "closed-enrollment"),
  };
}

function bindTerm(
  term: AtomicPricingTerm,
  model: PublishedPricingModel | undefined,
  blocked: ReadonlySet<string>,
  hasCache: boolean,
): AtomicPricingTerm {
  if (term.kind !== "rate") return term;
  return {
    ...term,
    variants: term.variants.map((variant) => {
      const charge_binding = modelBinding(term.meter, variant, model, blocked, hasCache);
      return charge_binding === undefined ? variant : { ...variant, charge_binding };
    }),
  };
}

function modelBinding(
  meter: PriceMeter,
  variant: AtomicRateVariant,
  model: PublishedPricingModel | undefined,
  blocked: ReadonlySet<string>,
  hasCache: boolean,
): ChargeBinding | undefined {
  if (
    blocked.has("tokens") ||
    !isStandardUnit(variant.price.per, "token") ||
    meter.namespace !== "kmodels"
  )
    return;
  const splitCache = hasCache && !blocked.has("cache");
  const signal =
    meter.value === "cache_read_text"
      ? splitCache
        ? "cached_input_tokens"
        : undefined
      : meter.value === "input_text"
        ? splitCache
          ? "uncached_input_tokens"
          : "input_tokens"
        : meter.value === "output_text"
          ? "output_tokens"
          : undefined;
  if (signal === undefined) return;
  const endpoints = model?.api_endpoints ?? [];
  const observations = [
    ...(!blocked.has("chat") && endpoints.some(({ path }) => path.endsWith("/chat/completions"))
      ? [bindingObservation(variant, `chat:${usageLocator(signal)}`)]
      : []),
    ...(!blocked.has("completions") &&
    endpoints.some(({ path }) => /(?:^|\/)v1\/completions$/.test(path))
      ? [bindingObservation(variant, `completions:${usageLocator(signal)}`)]
      : []),
  ];
  if (observations.length === 0) return;
  return {
    signal: { namespace: "kmodels", value: signal },
    aggregation: "request",
    observations,
  };
}

function usageLocator(
  signal: "cached_input_tokens" | "input_tokens" | "output_tokens" | "uncached_input_tokens",
): string {
  if (signal === "cached_input_tokens") return "usage.prompt_tokens_details.cached_tokens";
  if (signal === "uncached_input_tokens")
    return "usage.prompt_tokens-usage.prompt_tokens_details.cached_tokens";
  if (signal === "input_tokens") return "usage.prompt_tokens";
  return "usage.completion_tokens";
}

function resourceOffer(
  books: readonly AtomicPricingBook[],
  resourceKey: string,
): string | undefined {
  const book = books.find(
    (candidate) =>
      candidate.scope.kind === "provider_resource" && candidate.scope.resource_key === resourceKey,
  );
  const offer = book?.offers[0];
  return book === undefined || offer === undefined
    ? undefined
    : pricingOfferId(pricingBookId("cerebras", book.book_key), offer.offer_key);
}

function directSettlement(offer: AtomicPricingOffer): AtomicPricingOffer {
  return settled(offer, "direct", "Cerebras", ["prepaid_balance", "provider_credit"]);
}

function settled(
  offer: AtomicPricingOffer,
  channel: "direct" | "marketplace",
  biller: string,
  payment_sources: Array<
    "marketplace_commitment" | "postpaid_invoice" | "prepaid_balance" | "provider_credit"
  >,
): AtomicPricingOffer {
  return {
    ...offer,
    settlement: [
      {
        channel,
        biller,
        payment_sources,
        applicability: unconditionalApplicability,
        observations: [normalized(offerEvidence(offer))],
      },
    ],
  };
}

function bindingObservation(variant: AtomicRateVariant, value: string): RawPriceObservation {
  return {
    ...rawEvidence(variant.observation),
    locator: { kind: "provider_key", value },
  };
}

function normalized(observation: RawPriceObservation): NormalizedPriceObservation {
  return {
    ...rawEvidence(observation),
    establishes_applicability: unconditionalApplicability,
  };
}
