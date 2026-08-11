import type {
  AtomicAllowanceTerm,
  AtomicPricingBook,
  AtomicPricingOffer,
  AtomicPricingTerm,
  AtomicProviderPricing,
  AtomicRateVariant,
} from "./pricing-assembly.ts";
import { unconditionalApplicability } from "./pricing-canonical.ts";
import { addAtom, offerEvidence, rawEvidence, relation } from "./pricing-commercial-assembly.ts";
import { pricingBookId, pricingOfferId, pricingTermId } from "./pricing-identifiers.ts";
import { multiplyRationals, rationalFromDecimal } from "./pricing-rational.ts";
import type {
  ChargeBinding,
  NormalizedPriceObservation,
  PriceApplicability,
  RawPriceObservation,
} from "./pricing-schema.ts";

export function applyHuggingFaceCommercialTopology(
  input: AtomicProviderPricing,
): AtomicProviderPricing {
  if (input.provider_id !== "huggingface") return input;
  const byok = input.books.find(({ book_key }) => book_key === "account:custom-provider-key");
  const byokRefs = new Set(byok?.scope.model_refs ?? []);
  const books = input.books
    .filter((book) => book !== byok)
    .map((book) =>
      book.scope.kind === "models"
        ? modelBook(book, input, byok, byokRefs)
        : resourceBook(book, input),
    );
  linkJobsPort(books, input.provider_id);
  return { ...input, books };
}

function modelBook(
  book: AtomicPricingBook,
  input: AtomicProviderPricing,
  byok: AtomicPricingBook | undefined,
  byokRefs: ReadonlySet<string>,
): AtomicPricingBook {
  const modelRefs = book.scope.kind === "models" ? book.scope.model_refs : [];
  const offers = book.offers.flatMap((offer) => {
    if (offer.offer_key !== "usage") return [settled(offer, "Hugging Face")];
    const routed: AtomicPricingOffer = settled(
      {
        ...promotions(offer),
        offer_key: "hf-routed",
        name: "Hugging Face routed inference",
        terms: offer.terms.map((term) => bindModelTerm(term)),
        relations: [],
      },
      "Hugging Face",
    );
    if (byok === undefined || !modelRefs.some((ref) => byokRefs.has(ref))) return [routed];
    const evidence = offerEvidence(byok.offers[0]);
    const bookId = pricingBookId(input.provider_id, book.book_key);
    const routedRef = pricingOfferId(bookId, routed.offer_key);
    const byokRef = pricingOfferId(bookId, "custom-provider-key");
    routed.relations.push(
      relation(
        routed,
        "exclusive_with",
        [byokRef],
        "Hugging Face billing and custom provider-key billing are alternative settlement paths",
      ),
    );
    const external: AtomicPricingOffer = {
      offer_key: "custom-provider-key",
      name: "Custom provider key",
      billing_mode: { namespace: "kmodels", value: "usage" },
      states: [
        {
          state: "externally_billed",
          applicability: unconditionalApplicability,
          observation: normalized(evidence, unconditionalApplicability),
        },
      ],
      enrollment: [
        {
          state: "account_scoped",
          applicability: unconditionalApplicability,
          observations: [normalized(evidence, unconditionalApplicability)],
        },
      ],
      terms: [],
      relations: [
        relation(
          routed,
          "exclusive_with",
          [routedRef],
          "Custom provider-key billing and Hugging Face billing are alternative settlement paths",
        ),
      ],
      settlement: [
        {
          channel: "byok",
          biller: "Upstream inference provider",
          payment_sources: ["external_bill"],
          applicability: unconditionalApplicability,
          observations: [normalized(evidence, unconditionalApplicability)],
        },
      ],
      source_refs: byok.source_refs,
    };
    return [routed, external];
  });
  return { ...book, offers };
}

function promotions(offer: AtomicPricingOffer): AtomicPricingOffer {
  const states = [...offer.states];
  const terms = offer.terms.flatMap((term) => {
    if (term.kind !== "raw" || term.term_key !== "route_promotional_free") return [term];
    const unresolved = term.variants.filter(({ possible_scope }) => possible_scope === undefined);
    for (const variant of term.variants)
      if (variant.possible_scope !== undefined)
        states.push({
          state: "free",
          applicability: variant.possible_scope,
          observation: normalized(variant.observation, variant.possible_scope),
        });
    return unresolved.length === 0 ? [] : [{ ...term, variants: unresolved }];
  });
  return { ...offer, states, terms };
}

function bindModelTerm(term: AtomicPricingTerm): AtomicPricingTerm {
  if (term.kind !== "rate" || term.meter.namespace !== "kmodels") return term;
  const signal =
    term.meter.value === "input_text"
      ? "input_tokens"
      : term.meter.value === "output_text"
        ? "output_tokens"
        : undefined;
  if (signal === undefined) return term;
  return {
    ...term,
    variants: term.variants.map((variant) => ({
      ...variant,
      charge_binding: standardBinding(
        signal,
        variant,
        signal === "input_tokens" ? "usage:prompt_tokens" : "usage:completion_tokens",
      ),
    })),
  };
}

function resourceBook(book: AtomicPricingBook, input: AtomicProviderPricing): AtomicPricingBook {
  if (book.scope.kind !== "provider_resource") return book;
  const resourceKey = book.scope.resource_key;
  return {
    ...book,
    offers: book.offers.map((offer) => {
      const terms = offer.terms.map((term) => bindResourceTerm(book, offer, term, input));
      const migrated = { ...offer, terms };
      return settled(
        accountScoped(resourceKey) ? withAccountEnrollment(migrated) : migrated,
        "Hugging Face",
      );
    }),
  };
}

function bindResourceTerm(
  book: AtomicPricingBook,
  offer: AtomicPricingOffer,
  term: AtomicPricingTerm,
  input: AtomicProviderPricing,
): AtomicPricingTerm {
  if (
    book.scope.kind === "provider_resource" &&
    book.scope.resource_key === "zerogpu" &&
    term.kind === "raw" &&
    term.term_key === "daily_gpu_minutes"
  )
    return zeroGpuAllowance(book, offer, term, input);
  if (
    book.scope.kind !== "provider_resource" ||
    term.kind !== "rate" ||
    term.meter.namespace !== "kmodels" ||
    term.meter.value !== "compute"
  )
    return term;
  const key = resourceSignal(book.scope.resource_key);
  if (key === undefined) return term;
  return {
    ...term,
    variants: term.variants.map((variant) => ({
      ...variant,
      charge_binding: providerBinding(input, key, variant),
    })),
  };
}

function zeroGpuAllowance(
  book: AtomicPricingBook,
  offer: AtomicPricingOffer,
  term: Extract<AtomicPricingTerm, { kind: "raw" }>,
  input: AtomicProviderPricing,
): AtomicAllowanceTerm {
  addAtom(input, {
    kind: "allowance_reset",
    key: "24_hours_after_first_use",
    definition: "Twenty-four hours after the account's first ZeroGPU use in the quota window",
  });
  const offerId = pricingOfferId(pricingBookId(input.provider_id, book.book_key), offer.offer_key);
  const rateRefs = offer.terms.flatMap((candidate) =>
    candidate.kind === "rate" ? [pricingTermId(offerId, "rate", candidate.term_key)] : [],
  );
  const variants: AtomicAllowanceTerm["variants"] = [];
  const rawVariants: AtomicAllowanceTerm["raw_variants"] = [];
  for (const variant of term.variants) {
    const amount = variant.observation.raw.amount;
    if (amount === undefined || !/^\d+$/.test(amount)) {
      rawVariants.push(variant);
      continue;
    }
    const applicability = variant.possible_scope ?? unconditionalApplicability;
    variants.push({
      benefit: {
        kind: "quantity",
        quantity: {
          value: multiplyRationals(rationalFromDecimal(amount), rationalFromDecimal("60")),
          unit: {
            factors: [{ unit: { namespace: "kmodels", value: "second" }, power: 1 }],
          },
        },
      },
      target:
        rateRefs.length === 0
          ? { kind: "offers", offer_refs: [offerId] }
          : { kind: "rate_terms", term_refs: rateRefs },
      reset: {
        namespace: "provider",
        provider_id: input.provider_id,
        value: "24_hours_after_first_use",
      },
      applicability,
      observation: normalized(variant.observation, applicability),
    });
  }
  return {
    term_key: term.term_key,
    kind: "allowance",
    variants,
    raw_variants: rawVariants,
    source_refs: term.source_refs,
  };
}

function accountScoped(resourceKey: string): boolean {
  return [
    "inference-endpoints",
    "jobs-exposed-ports",
    "jobs-hardware",
    "private-storage",
    "public-storage-addon",
    "spaces-hardware",
  ].includes(resourceKey);
}

function withAccountEnrollment(offer: AtomicPricingOffer): AtomicPricingOffer {
  if ((offer.enrollment?.length ?? 0) > 0) return offer;
  const evidence = offerEvidence(offer);
  return {
    ...offer,
    enrollment: [
      {
        state: "account_scoped",
        applicability: unconditionalApplicability,
        observations: [normalized(evidence, unconditionalApplicability)],
      },
    ],
  };
}

function resourceSignal(resourceKey: string): string | undefined {
  switch (resourceKey) {
    case "inference-endpoints":
      return "billed_endpoint_seconds";
    case "spaces-hardware":
      return "billed_space_seconds";
    case "jobs-hardware":
      return "billed_job_seconds";
    case "jobs-exposed-ports":
      return "billed_job_port_seconds";
    case "zerogpu":
      return "billed_zerogpu_seconds";
  }
}

function providerBinding(
  input: AtomicProviderPricing,
  key: string,
  variant: AtomicRateVariant,
): ChargeBinding {
  addAtom(input, {
    kind: "usage_signal",
    key,
    definition: `Hugging Face ${key.replaceAll("_", " ")}`,
    unit: variant.price.per,
    resolution_phase: "outcome",
  });
  return {
    signal: { namespace: "provider", provider_id: input.provider_id, value: key },
    aggregation: "resource",
    observations: [rawEvidence(variant.observation)],
  };
}

function standardBinding(
  signal: "input_tokens" | "output_tokens",
  variant: AtomicRateVariant,
  locator: string,
): ChargeBinding {
  return {
    signal: { namespace: "kmodels", value: signal },
    aggregation: "request",
    observations: [
      {
        ...rawEvidence(variant.observation),
        locator: { kind: "provider_key", value: locator },
      },
    ],
  };
}

function settled(offer: AtomicPricingOffer, biller: string): AtomicPricingOffer {
  if ((offer.settlement?.length ?? 0) > 0) return offer;
  if (
    offer.states.some(({ state }) => state === "free") &&
    !offer.terms.some((term) => term.kind === "rate" && term.variants.length > 0)
  )
    return { ...offer, settlement: [] };
  const evidence = offerEvidence(offer);
  const included =
    offer.states.some(({ state }) => state === "included") ||
    offer.terms.some(({ kind }) => kind === "allowance");
  return {
    ...offer,
    settlement: [
      {
        channel: "direct",
        biller,
        payment_sources: [
          ...(included ? (["allowance"] as const) : []),
          "provider_credit",
          "postpaid_invoice",
        ],
        applicability: unconditionalApplicability,
        observations: [normalized(evidence, unconditionalApplicability)],
      },
    ],
  };
}

function linkJobsPort(books: AtomicPricingBook[], providerId: string): void {
  const port = books.find(({ book_key }) => book_key === "service:jobs-exposed-ports");
  const hardware = books.find(({ book_key }) => book_key === "capacity:jobs-hardware");
  if (port === undefined || hardware === undefined) return;
  const target = pricingBookId(providerId, hardware.book_key);
  const evidence = offerEvidence(port.offers[0]);
  port.resource_edges = [
    {
      kind: "requires_resource",
      target: { kind: "books", book_refs: [target] },
      applicability: unconditionalApplicability,
      observations: [
        {
          ...evidence,
          raw: { label: "An exposed port is an add-on to a running Hugging Face Job" },
        },
      ],
    },
  ];
}

function normalized(
  evidence: RawPriceObservation,
  applicability: PriceApplicability,
): NormalizedPriceObservation {
  return { ...evidence, establishes_applicability: applicability };
}
