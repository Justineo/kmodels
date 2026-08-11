import type {
  AtomicPricingBook,
  AtomicPricingOffer,
  AtomicPricingTerm,
  AtomicProviderPricing,
} from "./pricing-assembly.ts";
import { canonicalizeApplicability, unconditionalApplicability } from "./pricing-canonical.ts";
import { addAtom, unitIdentityKey } from "./pricing-commercial-assembly.ts";
import { pricingBookId, pricingOfferId } from "./pricing-identifiers.ts";
import type {
  ChargeBinding,
  NormalizedPriceObservation,
  OfferRelation,
  PriceApplicability,
  PriceCondition,
  PriceMeter,
  RawPriceObservation,
  PricingOffer,
  UnitExpression,
} from "./pricing-schema.ts";
import type { ProviderModel } from "./schema.ts";

type PublishedModel = Pick<ProviderModel, "model_id" | "service_families" | "tasks" | "uid">;
type Mechanism = "sync" | "batch";

const serviceTier = { namespace: "kmodels" as const, value: "service_tier" as const };
const servedTier = { namespace: "kmodels" as const, value: "served_service_tier" as const };

export function applyAzureCommercialTopology(
  input: AtomicProviderPricing,
  publishedModels: readonly PublishedModel[],
): AtomicProviderPricing {
  if (input.provider_id !== "azure") return input;
  const models = new Map(publishedModels.map((model) => [model.uid, model]));
  const books: AtomicPricingBook[] = [];

  for (const book of input.books) {
    if (book.scope.kind !== "models") {
      books.push(bindResourceBook(book, input));
      continue;
    }
    const migrated = migrateModelBook(book, input, models);
    if (migrated.model.offers.length > 0) books.push(migrated.model);
    books.push(...migrated.capacity);
  }
  return { ...input, books };
}

function bindResourceBook(
  book: AtomicPricingBook,
  input: AtomicProviderPricing,
): AtomicPricingBook {
  if (book.scope.kind !== "provider_resource") return book;
  const scope = book.scope;
  return {
    ...book,
    offers: book.offers.map((offer) => ({
      ...offer,
      terms: offer.terms.map((term) => bindResourceTerm(scope.resource_key, term, input)),
      settlement: modelSettlement(offer, undefined),
      ...(scope.resource_kind.namespace === "kmodels" && scope.resource_kind.value === "plan"
        ? { enrollment: [accountEnrollment(offer)] }
        : {}),
    })),
  };
}

function bindResourceTerm(
  resourceKey: string,
  term: AtomicPricingTerm,
  input: AtomicProviderPricing,
): AtomicPricingTerm {
  if (term.kind !== "rate") return term;
  return {
    ...term,
    variants: term.variants.map((variant) => {
      const { aggregation, phase } = resourceAggregation(resourceKey, term.meter);
      return {
        ...variant,
        charge_binding: providerBinding(
          input,
          resourceSignal(resourceKey, term.meter, variant.applicability, variant.price.per),
          `Microsoft-reported billable ${term.meter.value.replaceAll("_", " ")} quantity for ${resourceKey}`,
          variant.price.per,
          aggregation,
          variant.observation,
          `resource:${resourceKey}:${term.meter.value}`,
          phase,
        ),
      };
    }),
  };
}

function resourceAggregation(
  resourceKey: string,
  meter: PriceMeter,
): {
  aggregation: ChargeBinding["aggregation"];
  phase: "outcome" | "account";
} {
  if (meter.namespace === "kmodels") {
    if (["web_search", "file_search", "content_safety"].includes(meter.value))
      return { aggregation: "result_item", phase: "outcome" };
    if (meter.value === "code_execution") return { aggregation: "session", phase: "outcome" };
    if (["evaluation", "training_input", "training_compute"].includes(meter.value))
      return { aggregation: "job", phase: "account" };
    if (meter.value === "subscription") return { aggregation: "billing_period", phase: "account" };
  }
  return {
    aggregation: resourceKey.includes("runtime") ? "session" : "resource",
    phase: "account",
  };
}

function resourceSignal(
  resourceKey: string,
  meter: PriceMeter,
  applicability: PriceApplicability,
  unit: UnitExpression,
): string {
  const operation = applicability.any_of
    .flatMap(({ all_of }) => all_of)
    .find(
      (condition) => condition.kind === "categorical" && condition.dimension.value === "operation",
    );
  const suffix =
    operation?.kind === "categorical" ? operation.values.map(({ value }) => value).join("_") : "";
  return [resourceKey, meter.value, suffix, unitIdentityKey(unit)]
    .filter(Boolean)
    .join("_")
    .replace(/[^a-zA-Z0-9_]+/g, "_");
}

function accountEnrollment(offer: AtomicPricingOffer) {
  const applicability = unconditionalApplicability;
  const observation = offerObservation(offer, "Account-scoped Microsoft commercial enrollment");
  return {
    state: "account_scoped" as const,
    applicability,
    observations: [{ ...observation, establishes_applicability: applicability }],
  };
}

function migrateModelBook(
  book: AtomicPricingBook,
  input: AtomicProviderPricing,
  models: ReadonlyMap<string, PublishedModel>,
): { model: AtomicPricingBook; capacity: AtomicPricingBook[] } {
  const model =
    book.scope.kind === "models" ? models.get(book.scope.model_refs[0] ?? "") : undefined;
  const modelOffers: AtomicPricingOffer[] = [];
  const capacityOffers: AtomicPricingOffer[] = [];

  for (const offer of book.offers) {
    if (offer.offer_key === "capacity") {
      capacityOffers.push(offer);
      continue;
    }
    if (offer.offer_key !== "usage") {
      modelOffers.push(offer);
      continue;
    }
    const sync = partitionOffer(offer, "sync", input, model?.model_id === "model-router");
    const batch = partitionOffer(offer, "batch", input, false);
    if (sync !== undefined && batch !== undefined) {
      const bookId = pricingBookId(input.provider_id, book.book_key);
      sync.relations.push(
        relationFromOffer(
          sync,
          "exclusive_with",
          [pricingOfferId(bookId, batch.offer_key)],
          "Synchronous and Batch are alternative billable executions",
        ),
      );
      batch.relations.push(
        relationFromOffer(
          batch,
          "exclusive_with",
          [pricingOfferId(bookId, sync.offer_key)],
          "Batch and synchronous inference are alternative billable executions",
        ),
      );
    }
    if (sync !== undefined) modelOffers.push(sync);
    if (batch !== undefined) modelOffers.push(batch);
  }

  for (const offer of modelOffers) offer.settlement = modelSettlement(offer, model);
  const capacity = capacityBooks(book, capacityOffers, modelOffers, input, model);
  return { model: { ...book, offers: modelOffers }, capacity };
}

function partitionOffer(
  source: AtomicPricingOffer,
  mechanism: Mechanism,
  input: AtomicProviderPricing,
  router: boolean,
): AtomicPricingOffer | undefined {
  const states = source.states.flatMap((state) => {
    const applicability = mechanismApplicability(state.applicability, mechanism, input);
    return applicability === undefined
      ? []
      : [
          {
            ...state,
            applicability,
            observation: withApplicability(state.observation, applicability),
          },
        ];
  });
  const terms = source.terms.flatMap((term) =>
    partitionTerm(term, mechanism, input, router && mechanism === "sync"),
  );
  if (states.length === 0 && terms.length === 0) return;
  return {
    ...source,
    offer_key: router && mechanism === "sync" ? "router" : mechanism,
    name:
      router && mechanism === "sync"
        ? "Model Router"
        : mechanism === "batch"
          ? "Batch inference"
          : "Synchronous PAYG inference",
    states,
    terms,
    relations: [],
  };
}

function partitionTerm(
  term: AtomicPricingTerm,
  mechanism: Mechanism,
  input: AtomicProviderPricing,
  router: boolean,
): AtomicPricingTerm[] {
  if (term.kind === "raw") {
    const variants = term.variants.flatMap((variant) => {
      if (variant.possible_scope === undefined) return mechanism === "sync" ? [variant] : [];
      const possible_scope = mechanismApplicability(variant.possible_scope, mechanism, input);
      return possible_scope === undefined ? [] : [{ ...variant, possible_scope }];
    });
    return variants.length === 0 ? [] : [{ ...term, variants }];
  }
  if (term.kind !== "rate") return mechanism === "sync" ? [term] : [];
  if (isCapacity(term.meter)) return [];
  const meter = router && isTextInput(term.meter) ? routerMeter(input) : term.meter;
  const variants = term.variants.flatMap((variant) => {
    const applicability = mechanismApplicability(variant.applicability, mechanism, input);
    if (applicability === undefined) return [];
    const observation = withApplicability(variant.observation, applicability);
    const charge_binding = modelChargeBinding(
      meter,
      variant.price.per,
      mechanism,
      observation,
      input,
      router,
    );
    return [
      {
        ...variant,
        applicability,
        observation,
        ...(charge_binding === undefined ? {} : { charge_binding }),
      },
    ];
  });
  const raw_variants = term.raw_variants.flatMap((variant) => {
    if (variant.possible_scope === undefined) return mechanism === "sync" ? [variant] : [];
    const possible_scope = mechanismApplicability(variant.possible_scope, mechanism, input);
    return possible_scope === undefined ? [] : [{ ...variant, possible_scope }];
  });
  if (variants.length + raw_variants.length === 0) return [];
  return [
    {
      ...term,
      term_key: router && isTextInput(term.meter) ? "model_router_input" : term.term_key,
      meter,
      variants,
      raw_variants,
    },
  ];
}

function mechanismApplicability(
  applicability: PriceApplicability,
  mechanism: Mechanism,
  input: AtomicProviderPricing,
): PriceApplicability | undefined {
  const any_of = applicability.any_of.flatMap(({ all_of }) => {
    const tier = all_of.find(isServiceTier);
    const values = tier?.kind === "categorical" ? tier.values.map(({ value }) => value) : [];
    const batch = values.includes("batch");
    if ((mechanism === "batch") !== batch) return [];
    if (mechanism === "batch" || tier === undefined)
      return [{ all_of: tier === undefined ? all_of : all_of.filter((item) => item !== tier) }];
    if (tier.kind !== "categorical") return [];
    const realized: Extract<PriceCondition, { kind: "categorical" }> = {
      ...tier,
      dimension: servedTier,
      values: tier.values.map((value) => {
        addAtom(input, {
          kind: "categorical_value",
          key: value.value,
          dimension: servedTier,
          definition: `Azure response-reported served service tier ${JSON.stringify(value.value)}`,
          label: value.value === "priority" ? "Priority" : "Standard",
        });
        return value;
      }),
    };
    return [{ all_of: all_of.map((item) => (item === tier ? realized : item)) }];
  });
  return any_of.length === 0 ? undefined : canonicalizeApplicability({ any_of });
}

function capacityBooks(
  sourceBook: AtomicPricingBook,
  offers: readonly AtomicPricingOffer[],
  modelOffers: AtomicPricingOffer[],
  input: AtomicProviderPricing,
  model: PublishedModel | undefined,
): AtomicPricingBook[] {
  if (offers.length === 0 || sourceBook.scope.kind !== "models") return [];
  const modelRefs = sourceBook.scope.model_refs;
  const resourceKey = `provisioned:${modelRefs.join("+")}`;
  const source = sourceBook.scope_observations[0];
  if (source === undefined) throw new Error(`Azure book ${sourceBook.book_key} has no evidence`);
  const scope = {
    kind: "provider_resource" as const,
    resource_kind: { namespace: "kmodels" as const, value: "capacity" as const },
    resource_key: resourceKey,
    model_refs: modelRefs,
  };
  const bookKey = `capacity:${resourceKey}`;
  const capacityBookId = pricingBookId(input.provider_id, bookKey);
  const migrated = offers.map((offer): AtomicPricingOffer => {
    const provisioned: AtomicPricingOffer = {
      ...offer,
      offer_key: "provisioned",
      name: "Provisioned throughput",
      terms: offer.terms.map((term) => bindCapacityTerm(term, input)),
      relations: [],
      settlement: modelSettlement(offer, model),
    };
    const sync = modelOffers.find(({ offer_key }) => offer_key === "sync");
    if (sync !== undefined) {
      const target = pricingOfferId(
        pricingBookId(input.provider_id, sourceBook.book_key),
        sync.offer_key,
      );
      provisioned.relations.push(
        relationFromOffer(
          provisioned,
          "exclusive_with",
          [target],
          "Provisioned and PAYG are alternative serving mechanisms for one realized attempt",
        ),
      );
      sync.relations.push(
        relationFromOffer(
          sync,
          "exclusive_with",
          [pricingOfferId(capacityBookId, provisioned.offer_key)],
          "PAYG and provisioned are alternative serving mechanisms for one realized attempt",
        ),
      );
    }
    return provisioned;
  });
  return [
    {
      book_key: bookKey,
      name: `Provisioned capacity for ${modelRefs.join(", ")}`,
      scope,
      scope_observations: [
        {
          source_ref: source.source_ref,
          locator: { kind: "provider_key", value: `resource:${resourceKey}` },
          establishes: scope,
          raw: { label: "Provisioned throughput capacity" },
        },
      ],
      resource_edges: [
        {
          kind: "requires_resource",
          target: { kind: "models", model_refs: modelRefs },
          applicability: unconditionalApplicability,
          observations: [bookObservation(sourceBook, "Exact provisioned model compatibility")],
        },
      ],
      offers: migrated,
      source_refs: sourceBook.source_refs,
    },
  ];
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
        "deployed_ptu_hours",
        "Deployed PTUs multiplied by elapsed provisioned billing hours",
        variant.price.per,
        "resource",
        variant.observation,
        "deployment:capacity × elapsed-hours",
      ),
    })),
  };
}

function modelChargeBinding(
  meter: PriceMeter,
  unit: UnitExpression,
  mechanism: Mechanism,
  observation: NormalizedPriceObservation,
  input: AtomicProviderPricing,
  router: boolean,
): ChargeBinding | undefined {
  const key =
    router && meter.namespace === "provider" && meter.value === "model_router_input"
      ? `router_input_${unitIdentityKey(unit)}`
      : `${mechanism === "batch" ? "batch_result" : "response"}_${meter.value}_${unitIdentityKey(unit)}`;
  return providerBinding(
    input,
    key,
    `${mechanism === "batch" ? "Completed Batch result-item" : "Resolved Azure inference response"} ${meter.value.replaceAll("_", " ")} usage measured in ${unitIdentityKey(unit)}`,
    unit,
    mechanism === "batch" ? "result_item" : "attempt",
    observation,
    `${mechanism === "batch" ? "batch-result" : "response"}:usage:${meter.value}`,
    "outcome",
  );
}

function providerBinding(
  input: AtomicProviderPricing,
  key: string,
  definition: string,
  unit: UnitExpression,
  aggregation: ChargeBinding["aggregation"],
  observation: NormalizedPriceObservation,
  locator: string,
  resolution_phase: "outcome" | "account" = "account",
): ChargeBinding {
  addAtom(input, { kind: "usage_signal", key, definition, unit, resolution_phase });
  return {
    signal: { namespace: "provider", provider_id: input.provider_id, value: key },
    aggregation,
    observations: [usageObservation(observation, locator)],
  };
}

function modelSettlement(
  offer: AtomicPricingOffer,
  model: PublishedModel | undefined,
): PricingOffer["settlement"] {
  const marketplace =
    model?.service_families?.includes("Foundry Models from partners and community") === true;
  const observation = offerObservation(
    offer,
    marketplace ? "Azure Marketplace settlement" : "Microsoft direct settlement",
  );
  return [
    {
      channel: marketplace ? "marketplace" : "direct",
      biller: marketplace ? "Azure Marketplace publisher" : "Microsoft",
      payment_sources: marketplace
        ? ["marketplace_commitment", "postpaid_invoice"]
        : ["prepaid_balance", "postpaid_invoice"],
      applicability: unconditionalApplicability,
      observations: [{ ...observation, establishes_applicability: unconditionalApplicability }],
    },
  ];
}

function relationFromOffer(
  offer: AtomicPricingOffer,
  kind: OfferRelation["kind"],
  targets: string[],
  label: string,
): OfferRelation {
  const observation = offerObservation(offer, label);
  return {
    kind,
    target: { kind: "offers", offer_refs: targets },
    applicability: unconditionalApplicability,
    observations: [
      {
        ...observation,
        establishes_offer_refs: targets,
        establishes_book_refs: [],
      },
    ],
  };
}

function routerMeter(input: AtomicProviderPricing): PriceMeter {
  addAtom(input, {
    kind: "meter",
    key: "model_router_input",
    definition:
      "Azure Model Router input-token markup; underlying model inference remains additive",
  });
  return { namespace: "provider", provider_id: input.provider_id, value: "model_router_input" };
}

function isServiceTier(condition: PriceCondition): boolean {
  return (
    condition.dimension.namespace === serviceTier.namespace &&
    condition.dimension.value === serviceTier.value
  );
}

function isCapacity(meter: PriceMeter): boolean {
  return meter.namespace === "kmodels" && meter.value === "provisioned_capacity";
}

function isTextInput(meter: PriceMeter): boolean {
  return meter.namespace === "kmodels" && meter.value === "input_text";
}

function withApplicability(
  observation: NormalizedPriceObservation,
  applicability: PriceApplicability,
): NormalizedPriceObservation {
  return { ...observation, establishes_applicability: applicability };
}

function bookObservation(book: AtomicPricingBook, label: string): RawPriceObservation {
  const observation = book.scope_observations[0];
  if (observation === undefined) throw new Error(`Azure book ${book.book_key} has no evidence`);
  return {
    source_ref: observation.source_ref,
    locator: { kind: "provider_key", value: `topology:${label}` },
    raw: { label },
  };
}

function offerObservation(offer: AtomicPricingOffer, label: string): RawPriceObservation {
  const observation =
    offer.states[0]?.observation ??
    offer.terms.flatMap((term) =>
      term.kind === "raw"
        ? term.variants.map(({ observation: value }) => value)
        : [...term.variants, ...term.raw_variants].map(({ observation: value }) => value),
    )[0];
  if (observation === undefined) throw new Error(`Azure offer ${offer.offer_key} has no evidence`);
  return { source_ref: observation.source_ref, locator: observation.locator, raw: { label } };
}

function usageObservation(
  observation: NormalizedPriceObservation,
  locator: string,
): RawPriceObservation {
  return {
    source_ref: observation.source_ref,
    locator: { kind: "provider_key", value: locator },
    raw: { fragment: locator },
  };
}
