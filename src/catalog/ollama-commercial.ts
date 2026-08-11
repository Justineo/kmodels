import type {
  AtomicPricingBook,
  AtomicPricingOffer,
  AtomicPricingTerm,
  AtomicProviderPricing,
  AtomicRateVariant,
} from "./pricing-assembly.ts";
import { unconditionalApplicability } from "./pricing-canonical.ts";
import { offerEvidence, rawEvidence, relation } from "./pricing-commercial-assembly.ts";
import { pricingBookId, pricingOfferId } from "./pricing-identifiers.ts";
import type {
  ChargeBinding,
  NormalizedPriceObservation,
  RawPriceObservation,
} from "./pricing-schema.ts";
import type { PublishedPricingModel } from "./pricing-adapter.ts";

interface OfferRef {
  offer: AtomicPricingOffer;
  ref: string;
}

export function applyOllamaCommercialTopology(
  input: AtomicProviderPricing,
  publishedModels: readonly PublishedPricingModel[],
): AtomicProviderPricing {
  if (input.provider_id !== "ollama") return input;
  const published = new Map(publishedModels.map((model) => [model.uid, model]));
  const books = input.books.map((book) =>
    book.scope.kind === "models"
      ? modelBook(book, published.get(book.scope.model_refs[0] ?? ""))
      : resourceBook(book),
  );
  bindRelations(books);
  return { ...input, books };
}

function modelBook(
  book: AtomicPricingBook,
  model: PublishedPricingModel | undefined,
): AtomicPricingBook {
  if (!model?.service_families?.includes("Ollama Cloud")) return book;
  return {
    ...book,
    offers: book.offers.map((offer) => {
      if (offer.offer_key !== "usage") return offer;
      const gated = offer.terms.some(
        ({ kind, term_key }) => kind === "raw" && term_key === "ollama_cloud_plan_gate",
      );
      const migrated: AtomicPricingOffer = {
        ...offer,
        offer_key: "cloud-inference",
        name: gated ? "Plan-gated extra-usage inference" : "Ollama Cloud inference",
        enrollment: [enrollment(offer, "account_scoped")],
        terms: offer.terms.map((term) => bindOutput(term, model)),
        relations: [],
        settlement: [
          {
            channel: "direct",
            biller: "Ollama",
            payment_sources: gated ? ["prepaid_balance"] : ["allowance", "prepaid_balance"],
            applicability: unconditionalApplicability,
            observations: [normalized(offerEvidence(offer))],
          },
        ],
      };
      return migrated;
    }),
  };
}

function bindOutput(term: AtomicPricingTerm, model: PublishedPricingModel): AtomicPricingTerm {
  if (
    term.kind !== "rate" ||
    term.meter.namespace !== "kmodels" ||
    term.meter.value !== "output_text"
  )
    return term;
  const endpoints = model.api_endpoints?.filter(({ path }) =>
    ["/api/chat", "/api/generate"].includes(path),
  );
  if (endpoints === undefined || endpoints.length === 0) return term;
  return {
    ...term,
    variants: term.variants.map((variant) => ({
      ...variant,
      charge_binding: nativeOutputBinding(
        variant,
        endpoints.map(({ path }) => path),
      ),
    })),
  };
}

function nativeOutputBinding(variant: AtomicRateVariant, paths: string[]): ChargeBinding {
  return {
    signal: { namespace: "kmodels", value: "output_tokens" },
    aggregation: "request",
    observations: paths.map((path) => ({
      ...rawEvidence(variant.observation),
      locator: { kind: "provider_key", value: `${path}:eval_count` },
    })),
  };
}

function resourceBook(book: AtomicPricingBook): AtomicPricingBook {
  if (book.scope.kind !== "provider_resource") return book;
  const key = book.scope.resource_key;
  return {
    ...book,
    offers: book.offers.map((offer) => {
      if (key === "local-execution")
        return {
          ...offer,
          enrollment: [enrollment(offer, "open")],
          relations: [],
          settlement: [
            {
              channel: "operator",
              biller: "Deployment operator",
              payment_sources: ["external_bill"],
              applicability: unconditionalApplicability,
              observations: [normalized(offerEvidence(offer))],
            },
          ],
        };
      if (key === "ollama-cloud")
        return {
          ...offer,
          enrollment: [
            enrollment(
              offer,
              offer.offer_key === "max"
                ? hasRawTerm(offer, "max-enrollment")
                  ? "closed_to_new"
                  : "account_scoped"
                : offer.offer_key === "team"
                  ? hasRawTerm(offer, "team-enrollment")
                    ? "waitlist"
                    : "account_scoped"
                  : offer.offer_key === "enterprise"
                    ? "account_scoped"
                    : "open",
            ),
          ],
          relations: [],
          ...(offer.offer_key === "enterprise"
            ? {
                settlement: [
                  {
                    channel: "direct" as const,
                    biller: "Ollama",
                    payment_sources: ["postpaid_invoice" as const],
                    applicability: unconditionalApplicability,
                    observations: [normalized(offerEvidence(offer))],
                  },
                ],
              }
            : {}),
        };
      if (key === "extra-usage-balance")
        return {
          ...offer,
          enrollment: [enrollment(offer, "account_scoped")],
          relations: [],
          settlement: [
            {
              channel: "direct",
              biller: "Ollama",
              payment_sources:
                offer.offer_key === "team" && hasRawTerm(offer, "automatic-billing")
                  ? ["prepaid_balance", "postpaid_invoice"]
                  : ["prepaid_balance"],
              applicability: unconditionalApplicability,
              observations: [normalized(offerEvidence(offer))],
            },
          ],
        };
      if (key === "ollama-web" || key === "cloud-allowance")
        return {
          ...offer,
          enrollment: [enrollment(offer, "account_scoped")],
          relations: [],
        };
      return offer;
    }),
  };
}

function hasRawTerm(offer: AtomicPricingOffer, key: string): boolean {
  return offer.terms.some(({ kind, term_key }) => kind === "raw" && term_key === key);
}

function bindRelations(books: AtomicPricingBook[]): void {
  const plans = resourceOffers(books, "ollama-cloud");
  const balances = resourceOffers(books, "extra-usage-balance");
  const locals = resourceOffers(books, "local-execution");
  const pro = plans.get("pro");
  const max = plans.get("max");
  const team = plans.get("team");
  const personalBalance = balances.get("personal");
  const teamBalance = balances.get("team");
  if (personalBalance !== undefined && pro !== undefined && max !== undefined)
    personalBalance.offer.relations.push(
      relation(
        personalBalance.offer,
        "requires",
        [pro.ref, max.ref],
        "A personal extra-usage balance is available with Pro or an existing Max subscription",
      ),
    );
  if (teamBalance !== undefined && team !== undefined)
    teamBalance.offer.relations.push(
      relation(
        teamBalance.offer,
        "requires",
        [team.ref],
        "The shared extra-usage balance belongs to the separate Team account",
      ),
    );

  for (const book of books) {
    if (book.scope.kind !== "models") continue;
    const offer = book.offers.find(({ offer_key }) => offer_key === "cloud-inference");
    if (offer === undefined) continue;
    const gated = offer.terms.some(
      ({ kind, term_key }) => kind === "raw" && term_key === "ollama_cloud_plan_gate",
    );
    if (gated && pro !== undefined && max !== undefined)
      offer.relations.push(
        relation(
          offer,
          "requires",
          [pro.ref, max.ref],
          "The model card requires Pro or an existing Max subscription",
        ),
      );
    if (gated && personalBalance !== undefined)
      offer.relations.push(
        relation(
          offer,
          "requires",
          [personalBalance.ref],
          "The model always consumes extra-usage credits instead of included allowance",
        ),
      );
    const cloudRef = offerRef(book, offer);
    for (const modelRef of book.scope.model_refs) {
      const local = locals.get(`model:${modelRef}`);
      if (local === undefined) continue;
      offer.relations.push(
        relation(
          offer,
          "exclusive_with",
          [local.ref],
          "Cloud and local execution are alternative routes for one work item",
        ),
      );
      local.offer.relations.push(
        relation(
          local.offer,
          "exclusive_with",
          [cloudRef],
          "Local and Cloud execution are alternative routes for one work item",
        ),
      );
    }
  }
}

function resourceOffers(books: AtomicPricingBook[], resourceKey: string): Map<string, OfferRef> {
  const result = new Map<string, OfferRef>();
  for (const book of books) {
    if (book.scope.kind !== "provider_resource" || book.scope.resource_key !== resourceKey)
      continue;
    for (const offer of book.offers)
      result.set(offer.offer_key, { offer, ref: offerRef(book, offer) });
  }
  return result;
}

function offerRef(book: AtomicPricingBook, offer: AtomicPricingOffer): string {
  return pricingOfferId(pricingBookId("ollama", book.book_key), offer.offer_key);
}

function enrollment(
  offer: AtomicPricingOffer,
  state: "open" | "waitlist" | "closed_to_new" | "account_scoped",
) {
  return {
    state,
    applicability: unconditionalApplicability,
    observations: [normalized(offerEvidence(offer))],
  };
}

function normalized(observation: RawPriceObservation): NormalizedPriceObservation {
  return { ...rawEvidence(observation), establishes_applicability: unconditionalApplicability };
}
