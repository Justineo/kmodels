import type {
  AtomicPricingBook,
  AtomicPricingOffer,
  AtomicPricingTerm,
  AtomicProviderPricing,
  AtomicRateVariant,
} from "./pricing-assembly.ts";
import { unconditionalApplicability } from "./pricing-canonical.ts";
import { pricingBookId, pricingOfferId } from "./pricing-identifiers.ts";
import type {
  ChargeBinding,
  NormalizedPriceObservation,
  OfferRelation,
  PriceMeter,
  ProviderAtomRegistryEntry,
  RawPriceObservation,
  UnitExpression,
} from "./pricing-schema.ts";
import type { ProviderModel } from "./schema.ts";

type PublishedModel = Pick<ProviderModel, "name" | "uid">;

export function applyCohereCommercialTopology(
  input: AtomicProviderPricing,
  publishedModels: readonly PublishedModel[],
): AtomicProviderPricing {
  if (input.provider_id !== "cohere") return input;
  const models = new Map(publishedModels.map((model) => [model.uid, model]));
  const evaluation = input.books.find(
    (book) =>
      book.scope.kind === "provider_resource" && book.scope.resource_key === "hosted-api-access",
  );
  const evaluationRefs = new Set(evaluation?.scope.model_refs ?? []);
  const byModel = new Map<string, AtomicPricingBook>();
  const resources: AtomicPricingBook[] = [];
  for (const book of input.books) {
    if (book === evaluation) continue;
    if (book.scope.kind === "models") {
      const migrated = modelBook(book, input, evaluation, evaluationRefs);
      byModel.set(migrated.scope.model_refs[0]!, migrated);
    } else resources.push(resourceBook(book, input));
  }
  if (evaluation !== undefined)
    for (const modelRef of evaluationRefs)
      if (!byModel.has(modelRef))
        byModel.set(modelRef, evaluationOnlyBook(modelRef, evaluation, models.get(modelRef)));

  const books = [...byModel.values(), ...resources];
  bindRelations(books);
  return { ...input, books };
}

function modelBook(
  book: AtomicPricingBook,
  input: AtomicProviderPricing,
  evaluation: AtomicPricingBook | undefined,
  evaluationRefs: ReadonlySet<string>,
): AtomicPricingBook {
  if (book.scope.kind !== "models") return book;
  const modelRef = book.scope.model_refs[0];
  const offers = book.offers.map((offer) => hostedOffer(offer, input));
  const exactNoCharge = offers.some(({ offer_key }) => offer_key === "hosted-no-charge");
  if (
    !exactNoCharge &&
    modelRef !== undefined &&
    evaluationRefs.has(modelRef) &&
    evaluation !== undefined
  ) {
    const source = evaluation.offers[0];
    if (source !== undefined) offers.push(evaluationOffer(source));
  }
  addMutualExclusion(book.book_key, offers, input.provider_id);
  return { ...book, offers };
}

function hostedOffer(offer: AtomicPricingOffer, input: AtomicProviderPricing): AtomicPricingOffer {
  if (offer.offer_key !== "usage") return directSettlement(offer, "Cohere hosted API usage");
  const noCharge =
    offer.states.some(({ state }) => state === "free") &&
    !offer.states.some(({ state }) => state === "numeric") &&
    !offer.terms.some((term) => term.kind === "rate" && term.variants.length > 0);
  const accountingGap = offer.terms.some(
    ({ term_key }) => term_key === "accounting_binding_unavailable",
  );
  const migrated = {
    ...offer,
    offer_key: noCharge ? "hosted-no-charge" : "hosted-production",
    name: noCharge ? "Hosted no-charge access" : "Hosted production API",
    terms: offer.terms.map((term) => (accountingGap ? term : bindModelTerm(term, input))),
    relations: [],
  };
  return noCharge
    ? { ...migrated, settlement: [] }
    : directSettlement(migrated, "Cohere hosted production API");
}

function evaluationOffer(source: AtomicPricingOffer): AtomicPricingOffer {
  const evidence = offerEvidence(source);
  return {
    ...source,
    offer_key: "hosted-evaluation",
    name: "Hosted evaluation API",
    enrollment: [
      {
        state: "account_scoped",
        applicability: unconditionalApplicability,
        observations: [normalized(evidence, unconditionalApplicability)],
      },
    ],
    relations: [],
    settlement: [],
  };
}

function evaluationOnlyBook(
  modelRef: string,
  evaluation: AtomicPricingBook,
  model: PublishedModel | undefined,
): AtomicPricingBook {
  const source = evaluation.offers[0];
  if (source === undefined) throw new Error("Cohere evaluation access has no offer");
  const evidence = offerEvidence(source);
  const scope = { kind: "models" as const, model_refs: [modelRef] };
  return {
    book_key: `model:${modelRef}`,
    name: `Pricing for ${model?.name ?? modelRef}`,
    scope,
    scope_observations: [
      {
        ...rawEvidence(evidence),
        establishes: scope,
        raw: { label: `Evaluation API access for ${modelRef}` },
      },
    ],
    offers: [evaluationOffer(source)],
    source_refs: evaluation.source_refs,
  };
}

function addMutualExclusion(
  bookKey: string,
  offers: AtomicPricingOffer[],
  providerId: string,
): void {
  const mechanisms = offers.filter(({ offer_key }) =>
    ["hosted-production", "hosted-evaluation", "hosted-no-charge"].includes(offer_key),
  );
  if (mechanisms.length < 2) return;
  const bookId = pricingBookId(providerId, bookKey);
  for (const offer of mechanisms) {
    const targets = mechanisms
      .filter((candidate) => candidate !== offer)
      .map(({ offer_key }) => pricingOfferId(bookId, offer_key));
    offer.relations.push(
      relation(
        offer,
        "exclusive_with",
        targets,
        "Evaluation and production access are alternative credential routes for one execution",
      ),
    );
  }
}

function bindModelTerm(term: AtomicPricingTerm, input: AtomicProviderPricing): AtomicPricingTerm {
  if (term.kind !== "rate") return term;
  return {
    ...term,
    variants: term.variants.map((variant) => {
      const signal = modelSignal(term.meter, variant);
      return signal === undefined
        ? variant
        : {
            ...variant,
            charge_binding: providerBinding(
              input,
              signal.key,
              signal.definition,
              variant.price.per,
              "request",
              variant.observation,
              `response:meta.billed_units.${signal.field}`,
              "outcome",
            ),
          };
    }),
  };
}

function modelSignal(
  meter: PriceMeter,
  variant: AtomicRateVariant,
): { key: string; field: string; definition: string } | undefined {
  if (meter.namespace !== "kmodels") return;
  if (meter.value === "input_text")
    return {
      key: "billed_input_tokens",
      field: "input_tokens",
      definition: "Cohere response meta.billed_units.input_tokens actually billed",
    };
  if (meter.value === "output_text")
    return {
      key: "billed_output_tokens",
      field: "output_tokens",
      definition: "Cohere response meta.billed_units.output_tokens actually billed",
    };
  if (meter.value === "embedding") {
    const image = variant.applicability.any_of.some(({ all_of }) =>
      all_of.some(
        (condition) =>
          condition.kind === "categorical" &&
          condition.dimension.value === "modality" &&
          condition.values.some(({ value }) => value === "image"),
      ),
    );
    return image
      ? {
          key: "billed_image_tokens",
          field: "image_tokens",
          definition: "Cohere Embed response meta.billed_units.image_tokens actually billed",
        }
      : {
          key: "billed_embedding_input_tokens",
          field: "input_tokens",
          definition: "Cohere Embed response meta.billed_units.input_tokens actually billed",
        };
  }
  if (meter.value === "rerank")
    return {
      key: "billed_search_units",
      field: "search_units",
      definition: "Cohere Rerank response meta.billed_units.search_units actually billed",
    };
}

function resourceBook(book: AtomicPricingBook, input: AtomicProviderPricing): AtomicPricingBook {
  if (book.scope.kind !== "provider_resource") return book;
  const resourceKey = book.scope.resource_key;
  const external = resourceKey === "private-deployment";
  const capacity =
    book.scope.resource_kind.namespace === "kmodels" &&
    book.scope.resource_kind.value === "capacity";
  return {
    ...book,
    offers: book.offers.map((offer) => {
      const operator = external && offer.offer_key === "operator-infrastructure";
      const noCharge = offer.states.some(({ state }) => state === "free");
      const migrated = {
        ...offer,
        terms: offer.terms.map((term) => (capacity ? bindCapacityTerm(term, input) : term)),
        enrollment: enrollment(resourceKey, offer),
        settlement: noCharge
          ? []
          : operator
            ? [
                settlement(
                  offer,
                  "operator",
                  "Customer-selected infrastructure operator",
                  ["external_bill"],
                  "Private infrastructure is procured and billed outside Cohere",
                ),
              ]
            : [
                settlement(
                  offer,
                  "direct",
                  "Cohere",
                  ["provider_credit", "postpaid_invoice"],
                  "This commercial offer settles directly with Cohere",
                ),
              ],
      };
      return migrated;
    }),
  };
}

function bindCapacityTerm(
  term: AtomicPricingTerm,
  input: AtomicProviderPricing,
): AtomicPricingTerm {
  if (term.kind !== "rate") return term;
  return {
    ...term,
    variants: term.variants.map((variant) => ({
      ...variant,
      charge_binding: providerBinding(
        input,
        capacitySignal(variant.price.per),
        "Cohere Model Vault billable instance commitment or usage in the published period",
        variant.price.per,
        isUnit(variant.price.per, "unit_hour") ? "resource" : "billing_period",
        variant.observation,
        "model-vault:instance-period",
        "account",
      ),
    })),
  };
}

function capacitySignal(unit: UnitExpression): string {
  for (const key of ["unit_hour", "unit_month", "unit_year"])
    if (isUnit(unit, key)) return `vault_${key}`;
  return "vault_capacity_unit";
}

function enrollment(
  resourceKey: string,
  offer: AtomicPricingOffer,
): NonNullable<AtomicPricingOffer["enrollment"]> {
  const rawTermKeys = new Set(
    offer.terms.filter(({ kind }) => kind === "raw").map(({ term_key }) => term_key),
  );
  const state =
    resourceKey === "encrypted-vault"
      ? offer.offer_key === "beta"
        ? "private_preview"
        : "account_scoped"
      : resourceKey.startsWith("standard-vault:")
        ? rawTermKeys.has("standard_vault_open_enrollment")
          ? "open"
          : rawTermKeys.has("standard_vault_waitlist_enrollment")
            ? "waitlist"
            : undefined
        : offer.states.some(({ state: priceState }) => priceState === "custom_quote")
          ? "account_scoped"
          : undefined;
  if (state === undefined) return offer.enrollment ?? [];
  const evidence = offerEvidence(offer);
  return [
    {
      state,
      applicability: unconditionalApplicability,
      observations: [normalized(evidence, unconditionalApplicability)],
    },
  ];
}

function bindRelations(books: AtomicPricingBook[]): void {
  const modelOffers = new Map<string, string[]>();
  for (const book of books) {
    if (book.scope.kind !== "models") continue;
    const refs = book.offers
      .filter(({ offer_key }) => offer_key.startsWith("hosted-"))
      .map(({ offer_key }) => pricingOfferId(pricingBookId("cohere", book.book_key), offer_key));
    for (const modelRef of book.scope.model_refs) modelOffers.set(modelRef, refs);
  }

  for (const book of books) {
    if (book.scope.kind !== "provider_resource") continue;
    const targets = book.scope.model_refs.flatMap((modelRef) => modelOffers.get(modelRef) ?? []);
    if (targets.length === 0) continue;
    const capacity = book.scope.resource_key.startsWith("standard-vault:");
    const embedJobs = book.scope.resource_key === "embed-jobs";
    const distribution = book.scope.resource_kind.value === "distribution";
    for (const offer of book.offers) {
      offer.relations.push(
        relation(
          offer,
          capacity || embedJobs ? "exclusive_with" : "compatible_with",
          targets,
          capacity
            ? "Model Vault and hosted API charging are alternative inference mechanisms"
            : embedJobs
              ? "Embed Jobs and synchronous hosted Embed are alternative execution mechanisms"
              : distribution
                ? "Free weight acquisition can support a separately operated execution route"
                : "This provider resource is compatible with the exact documented model scope",
        ),
      );
    }
    if (capacity && book.offers.length > 1) {
      const bookId = pricingBookId("cohere", book.book_key);
      for (const offer of book.offers) {
        const peers = book.offers
          .filter((candidate) => candidate !== offer)
          .map(({ offer_key }) => pricingOfferId(bookId, offer_key));
        offer.relations.push(
          relation(offer, "exclusive_with", peers, "Fixed and Flex capacity are plan alternatives"),
        );
      }
    }
  }
}

function providerBinding(
  input: AtomicProviderPricing,
  key: string,
  definition: string,
  unit: UnitExpression,
  aggregation: ChargeBinding["aggregation"],
  evidence: RawPriceObservation,
  locator: string,
  phase: "outcome" | "account",
): ChargeBinding {
  addAtom(input, { kind: "usage_signal", key, definition, unit, resolution_phase: phase });
  return {
    signal: { namespace: "provider", provider_id: input.provider_id, value: key },
    aggregation,
    observations: [{ ...rawEvidence(evidence), locator: { kind: "provider_key", value: locator } }],
  };
}

function directSettlement(offer: AtomicPricingOffer, label: string): AtomicPricingOffer {
  return {
    ...offer,
    settlement: [
      settlement(
        offer,
        "direct",
        "Cohere",
        ["provider_credit", "postpaid_invoice"],
        `${label} settles directly through the Cohere account`,
      ),
    ],
  };
}

function settlement(
  offer: AtomicPricingOffer,
  channel: "direct" | "operator",
  biller: string,
  payment_sources: Array<"provider_credit" | "postpaid_invoice" | "external_bill">,
  label: string,
): NonNullable<AtomicPricingOffer["settlement"]>[number] {
  const applicability = unconditionalApplicability;
  return {
    channel,
    biller,
    payment_sources,
    applicability,
    observations: [
      {
        ...rawEvidence(offerEvidence(offer)),
        raw: { label },
        establishes_applicability: applicability,
      },
    ],
  };
}

function relation(
  offer: AtomicPricingOffer,
  kind: OfferRelation["kind"],
  targets: string[],
  label: string,
): OfferRelation {
  const offerRefs = [...new Set(targets)].sort();
  return {
    kind,
    target: { kind: "offers", offer_refs: offerRefs },
    applicability: unconditionalApplicability,
    observations: [
      {
        ...rawEvidence(offerEvidence(offer)),
        raw: { label },
        establishes_offer_refs: offerRefs,
        establishes_book_refs: [],
      },
    ],
  };
}

function offerEvidence(offer: AtomicPricingOffer): RawPriceObservation {
  const evidence =
    offer.states[0]?.observation ??
    offer.terms.flatMap((term) =>
      term.kind === "raw"
        ? term.variants.map(({ observation }) => observation)
        : [...term.variants, ...term.raw_variants].map(({ observation }) => observation),
    )[0];
  if (evidence === undefined) throw new Error(`Cohere offer ${offer.offer_key} has no evidence`);
  return evidence;
}

function normalized(
  observation: RawPriceObservation,
  applicability: typeof unconditionalApplicability,
): NormalizedPriceObservation {
  return { ...rawEvidence(observation), establishes_applicability: applicability };
}

function rawEvidence(observation: RawPriceObservation): RawPriceObservation {
  return {
    source_ref: observation.source_ref,
    locator: observation.locator,
    raw: observation.raw,
  };
}

function isUnit(unit: UnitExpression, value: string): boolean {
  const factor = unit.factors.length === 1 ? unit.factors[0] : undefined;
  return factor?.power === 1 && factor.unit.namespace === "provider" && factor.unit.value === value;
}

function addAtom(input: AtomicProviderPricing, atom: ProviderAtomRegistryEntry): void {
  const current = input.vocabulary.atoms.find(
    (candidate) => candidate.kind === atom.kind && candidate.key === atom.key,
  );
  if (current === undefined) input.vocabulary.atoms.push(atom);
  else if (JSON.stringify(current) !== JSON.stringify(atom))
    throw new Error(`Cohere provider atom ${atom.kind}:${atom.key} conflicts`);
}
