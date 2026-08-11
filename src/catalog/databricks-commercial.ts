import type {
  AtomicAllowanceTerm,
  AtomicPricingBook,
  AtomicPricingOffer,
  AtomicPricingTerm,
  AtomicProviderPricing,
  AtomicRateTerm,
  AtomicRateVariant,
  AtomicRawTerm,
  AtomicRawVariant,
} from "./pricing-assembly.ts";
import { canonicalizeApplicability, unconditionalApplicability } from "./pricing-canonical.ts";
import { addAtom, rawEvidence } from "./pricing-commercial-assembly.ts";
import { isNonNegativeDecimal } from "./pricing-constants.ts";
import { pricingBookId, pricingOfferId, pricingTermId } from "./pricing-identifiers.ts";
import { rationalFromDecimal } from "./pricing-rational.ts";
import type {
  ChargeBinding,
  NormalizedPriceObservation,
  OfferRelation,
  PriceApplicability,
  PriceCondition,
  PriceDenomination,
  PriceMeter,
  RawPriceObservation,
  UnitExpression,
} from "./pricing-schema.ts";
import {
  canonicalizeQuantity,
  canonicalizeSourceUnit,
  canonicalizeUnitPrice,
  type CanonicalSourceUnit,
} from "./pricing-units.ts";

export function applyDatabricksCommercialTopology(
  input: AtomicProviderPricing,
): AtomicProviderPricing {
  if (input.provider_id !== "databricks") return input;
  const books: AtomicPricingBook[] = [];
  for (const book of input.books) {
    if (book.scope.kind !== "models") {
      books.push(normalizeResourceBook(book, input));
      continue;
    }
    const { model, capacity } = splitModelBook(book, input);
    if (model.offers.length > 0) books.push(model);
    books.push(...capacity);
  }
  bindDbuSettlement(books);
  return { ...input, books };
}

function splitModelBook(
  book: AtomicPricingBook,
  input: AtomicProviderPricing,
): { model: AtomicPricingBook; capacity: AtomicPricingBook[] } {
  const modelOffers: AtomicPricingOffer[] = [];
  const capacity: AtomicPricingBook[] = [];
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
    const payPerToken = modelOffer(offer, "pay-per-token", input);
    const batch = modelOffer(offer, "batch", input);
    const bookId = pricingBookId(input.provider_id, book.book_key);
    if (payPerToken !== undefined && batch !== undefined) {
      payPerToken.relations.push(
        relationFromOffer(
          payPerToken,
          "exclusive_with",
          [pricingOfferId(bookId, "batch")],
          "Pay-per-token and Batch are alternative execution mechanisms",
        ),
      );
      batch.relations.push(
        relationFromOffer(
          batch,
          "exclusive_with",
          [pricingOfferId(bookId, "pay-per-token")],
          "Batch and pay-per-token are alternative execution mechanisms",
        ),
      );
    }
    if (payPerToken !== undefined) modelOffers.push(payPerToken);
    if (batch !== undefined) modelOffers.push(batch);
  }
  const executionKeys = modelOffers
    .map(({ offer_key }) => offer_key)
    .filter((key) => key === "pay-per-token" || key === "batch");
  for (const offer of capacityOffers)
    capacity.push(...capacityBooks(book, offer, input, executionKeys));
  return { model: { ...book, offers: modelOffers }, capacity };
}

function modelOffer(
  source: AtomicPricingOffer,
  mechanism: "pay-per-token" | "batch",
  input: AtomicProviderPricing,
): AtomicPricingOffer | undefined {
  const states = source.states.flatMap((state) => {
    const applicability = mechanismApplicability(state.applicability, mechanism);
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
  const terms = source.terms.flatMap((term) => modelTerm(term, mechanism, input));
  if (states.length === 0 && terms.length === 0) return;
  return {
    ...source,
    offer_key: mechanism,
    name: mechanism === "batch" ? "ai_query Batch inference" : "Pay-per-token inference",
    states,
    terms,
    relations: [],
  };
}

function modelTerm(
  term: AtomicPricingTerm,
  mechanism: "pay-per-token" | "batch",
  input: AtomicProviderPricing,
): AtomicPricingTerm[] {
  if (term.kind === "raw") {
    if (term.term_key === "batch_inference")
      return mechanism === "batch" ? batchTerm(term, input) : [];
    if (mechanism === "batch") return [];
    const variants = term.variants.flatMap((variant) => {
      if (variant.possible_scope === undefined) return [variant];
      const possible_scope = mechanismApplicability(variant.possible_scope, mechanism);
      return possible_scope === undefined ? [] : [{ ...variant, possible_scope }];
    });
    return variants.length === 0 ? [] : [{ ...term, variants }];
  }
  if (term.kind !== "rate" || mechanism === "batch") return [];
  const variants = term.variants.flatMap((variant) => {
    const applicability = mechanismApplicability(variant.applicability, mechanism);
    if (applicability === undefined) return [];
    const observation = withApplicability(variant.observation, applicability);
    const charge_binding = tokenBinding(term.meter, variant.price.per, observation);
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
    if (variant.possible_scope === undefined) return [variant];
    const possible_scope = mechanismApplicability(variant.possible_scope, mechanism);
    return possible_scope === undefined ? [] : [{ ...variant, possible_scope }];
  });
  return variants.length + raw_variants.length === 0 ? [] : [{ ...term, variants, raw_variants }];
}

function mechanismApplicability(
  applicability: PriceApplicability,
  mechanism: "pay-per-token" | "batch",
): PriceApplicability | undefined {
  const any_of = applicability.any_of.flatMap(({ all_of }) => {
    const tier = all_of.find(isServiceTier);
    const batch = tier !== undefined && categoricalValue(tier) === "batch";
    if ((mechanism === "batch") !== batch) return [];
    return [{ all_of: all_of.filter((condition) => condition !== tier) }];
  });
  return any_of.length === 0 ? undefined : canonicalizeApplicability({ any_of });
}

function isServiceTier(condition: PriceCondition): boolean {
  return (
    condition.kind === "categorical" &&
    condition.dimension.namespace === "kmodels" &&
    condition.dimension.value === "service_tier"
  );
}

function categoricalValue(condition: PriceCondition): string | undefined {
  return condition.kind === "categorical" && condition.values.length === 1
    ? condition.values[0]?.value
    : undefined;
}

function batchTerm(term: AtomicRawTerm, input: AtomicProviderPricing): AtomicPricingTerm[] {
  const variants: AtomicRateVariant[] = [];
  const raw: AtomicRawVariant[] = [];
  for (const variant of term.variants) {
    const amount = variant.observation.raw.amount;
    if (
      amount === undefined ||
      !isNonNegativeDecimal(amount) ||
      variant.observation.raw.denomination !== "DBU" ||
      variant.observation.raw.unit !== "DBU / hour"
    ) {
      raw.push(variant);
      continue;
    }
    const applicability =
      variant.possible_scope === undefined
        ? unconditionalApplicability
        : mechanismApplicability(variant.possible_scope, "batch");
    if (applicability === undefined) {
      raw.push(variant);
      continue;
    }
    const unit = providerUnitExpression(
      input,
      "batch_compute_hour",
      "One hour of Databricks ai_query Batch inference compute",
    );
    const observation = normalizedRawObservation(variant.observation, applicability);
    variants.push({
      price: {
        value: rationalFromDecimal(amount),
        denomination: dbu(input),
        per: unit,
      },
      applicability,
      ...(variant.validity === undefined ? {} : { validity: variant.validity }),
      charge_binding: providerBinding(
        input,
        "batch_inference_compute_hours",
        "Completed ai_query Batch inference compute hours; reconcile to BATCH_INFERENCE billing usage",
        unit,
        "job",
        observation,
        "system.billing.usage:billing_origin_product=MODEL_SERVING,offering_type=BATCH_INFERENCE",
      ),
      observation,
    });
  }
  if (variants.length === 0) return [term];
  const rate: AtomicRateTerm = {
    term_key: "batch_inference",
    kind: "rate",
    meter: providerMeter(input, "batch_inference", "Databricks ai_query Batch inference compute"),
    variants,
    raw_variants: raw,
    source_refs: term.source_refs,
  };
  return [rate];
}

function tokenBinding(
  meter: PriceMeter,
  unit: UnitExpression,
  observation: NormalizedPriceObservation,
): ChargeBinding | undefined {
  if (!isUnit(unit, "token") || meter.namespace !== "kmodels") return;
  const signal =
    meter.value === "input_text"
      ? "uncached_input_tokens"
      : meter.value === "embedding"
        ? "input_tokens"
        : meter.value === "cache_read_text"
          ? "cached_input_tokens"
          : meter.value === "cache_write_text"
            ? "cache_write_tokens"
            : meter.value === "output_text"
              ? "output_tokens"
              : undefined;
  if (signal === undefined) return;
  const field =
    signal === "uncached_input_tokens" || signal === "input_tokens"
      ? "input_tokens"
      : signal === "cached_input_tokens"
        ? "token_details.cache_read_input_tokens"
        : signal === "cache_write_tokens"
          ? "token_details.cache_creation_input_tokens"
          : "output_tokens";
  return {
    signal: { namespace: "kmodels", value: signal },
    aggregation: "attempt",
    observations: [
      usageObservation(observation, `response:usage.${field}`),
      usageObservation(observation, `system.ai_gateway.usage:${field}`),
    ],
  };
}

function capacityBooks(
  modelBook: AtomicPricingBook,
  source: AtomicPricingOffer,
  input: AtomicProviderPricing,
  executionKeys: readonly string[],
): AtomicPricingBook[] {
  if (modelBook.scope.kind !== "models") return [];
  return modelBook.scope.model_refs.flatMap((modelRef) => {
    const terms = source.terms.flatMap((term): AtomicPricingTerm[] => {
      if (
        term.kind !== "rate" ||
        term.meter.namespace !== "kmodels" ||
        term.meter.value !== "provisioned_capacity"
      )
        return [];
      return [
        {
          ...term,
          variants: term.variants.map((variant) => ({
            ...variant,
            charge_binding: providerBinding(
              input,
              "provisioned_model_unit_hours",
              "Provisioned Model Serving unit-hours billed in per-minute increments",
              variant.price.per,
              "resource",
              variant.observation,
              "system.billing.usage:provisioned Model Serving SKU usage",
            ),
          })),
        },
      ];
    });
    if (terms.length === 0) return [];
    const resourceKey = `model-capacity:${modelRef}`;
    const bookKey = `capacity:${modelRef}`;
    const bookId = pricingBookId(input.provider_id, bookKey);
    const commitmentRef = pricingOfferId(bookId, "provisioned-throughput");
    const coveredRef = pricingOfferId(bookId, "covered-inference");
    const modelBookId = pricingBookId(input.provider_id, modelBook.book_key);
    const alternatives = executionKeys.map((key) => pricingOfferId(modelBookId, key));
    const commitment: AtomicPricingOffer = {
      ...source,
      offer_key: "provisioned-throughput",
      name: "Provisioned throughput capacity",
      terms,
      relations: [
        relationFromBook(
          modelBook,
          "compatible_with",
          [coveredRef],
          "Provisioned capacity covers matching endpoint inference",
        ),
      ],
    };
    const covered: AtomicPricingOffer = {
      offer_key: "covered-inference",
      name: "Capacity-covered inference",
      billing_mode: { namespace: "kmodels", value: "usage" },
      states: [
        {
          state: "included",
          applicability: unconditionalApplicability,
          observation: normalizedBookObservation(
            modelBook,
            "Matching endpoint inference is covered by provisioned capacity",
          ),
        },
      ],
      terms: [],
      relations: [
        relationFromBook(modelBook, "requires", [commitmentRef], "Exact provisioned capacity"),
        relationFromBook(
          modelBook,
          "exclusive_with",
          alternatives,
          "Capacity-covered and usage-priced execution are alternatives",
        ),
      ],
      source_refs: source.source_refs,
    };
    return [
      {
        book_key: bookKey,
        name: `${modelRef} provisioned throughput`,
        scope: {
          kind: "provider_resource",
          resource_kind: { namespace: "kmodels", value: "capacity" },
          resource_key: resourceKey,
          model_refs: [modelRef],
        },
        scope_observations: modelBook.scope_observations.map((observation) => ({
          ...observation,
          establishes: {
            kind: "provider_resource",
            resource_kind: { namespace: "kmodels", value: "capacity" },
            resource_key: resourceKey,
            model_refs: [modelRef],
          },
          raw: { label: `${modelRef} provisioned throughput` },
        })),
        resource_edges: [
          {
            kind: "requires_resource",
            target: { kind: "models", model_refs: [modelRef] },
            applicability: unconditionalApplicability,
            observations: [rawBookObservation(modelBook, `topology:capacity:${modelRef}`)],
          },
        ],
        offers: [commitment, covered],
        source_refs: source.source_refs,
      },
    ];
  });
}

function normalizeResourceBook(
  book: AtomicPricingBook,
  input: AtomicProviderPricing,
): AtomicPricingBook {
  if (book.scope.kind !== "provider_resource") return book;
  const offers = book.offers.map((offer) => {
    const promotionalStates = offer.terms.flatMap((term) =>
      term.kind === "raw" && term.term_key === "free_promotion"
        ? term.variants.map((variant) => {
            const applicability = variant.possible_scope ?? unconditionalApplicability;
            return {
              state: "free" as const,
              applicability,
              ...(variant.validity === undefined ? {} : { validity: variant.validity }),
              observation: normalizedRawObservation(variant.observation, applicability),
            };
          })
        : [],
    );
    const terms = offer.terms.flatMap((term) => {
      if (term.kind !== "raw") return [term];
      if (term.term_key === "free_promotion") return [];
      if (term.term_key === "storage_allowance") return searchAllowance(book, offer, term);
      if (term.term_key === "genie_dbu_allowance") return genieAllowance(book, offer, term, input);
      return normalizedServiceTerm(book, offer, term, input);
    });
    const normalized = terms.some((term) => term.kind === "rate");
    const numericStates =
      normalized && !offer.states.some(({ state }) => state === "numeric")
        ? terms.flatMap((term) =>
            term.kind === "rate"
              ? term.variants.map((variant) => ({
                  state: "numeric" as const,
                  applicability: variant.applicability,
                  ...(variant.validity === undefined ? {} : { validity: variant.validity }),
                  observation: {
                    ...variant.observation,
                    raw: { label: "Published numeric rate" },
                  },
                }))
              : [],
          )
        : [];
    return {
      ...offer,
      terms,
      states: [...offer.states, ...promotionalStates, ...numericStates],
    };
  });
  return { ...book, offers };
}

interface ServiceRate {
  meter: PriceMeter;
  sourceUnit: CanonicalSourceUnit;
  denomination: PriceDenomination;
  aggregation: ChargeBinding["aggregation"];
}

function normalizedServiceTerm(
  book: AtomicPricingBook,
  _offer: AtomicPricingOffer,
  term: AtomicRawTerm,
  input: AtomicProviderPricing,
): AtomicPricingTerm[] {
  if (book.scope.kind !== "provider_resource") return [term];
  const resourceKey = book.scope.resource_key;
  const rates: AtomicRateVariant[] = [];
  const raw: AtomicRawVariant[] = [];
  let meter: PriceMeter | undefined;
  for (const variant of term.variants) {
    if (variant.impact !== "base_price" && term.term_key !== "list_price_settlement") {
      raw.push(variant);
      continue;
    }
    const normalized = serviceRate(book, _offer, term.term_key, variant, input);
    const amount = variant.observation.raw.amount;
    if (normalized === undefined || amount === undefined || !isNonNegativeDecimal(amount)) {
      raw.push(variant);
      continue;
    }
    meter = normalized.meter;
    const applicability = variant.possible_scope ?? unconditionalApplicability;
    const observation = normalizedRawObservation(variant.observation, applicability);
    rates.push({
      price: canonicalizeUnitPrice(
        rationalFromDecimal(amount),
        normalized.denomination,
        normalized.sourceUnit,
      ),
      applicability,
      ...(variant.validity === undefined ? {} : { validity: variant.validity }),
      charge_binding: providerBinding(
        input,
        `billing_${resourceKey.replaceAll("-", "_")}_${term.term_key}`,
        `${resourceKey} ${term.term_key.replaceAll("_", " ")} billable quantity`,
        normalized.sourceUnit.unit,
        normalized.aggregation,
        observation,
        `system.billing.usage:${resourceKey}:${term.term_key}`,
      ),
      observation,
    });
  }
  if (rates.length === 0 || meter === undefined) return [term];
  return [
    {
      term_key: term.term_key,
      kind: "rate",
      meter,
      variants: rates,
      raw_variants: raw,
      source_refs: term.source_refs,
    },
  ];
}

function serviceRate(
  book: AtomicPricingBook,
  _offer: AtomicPricingOffer,
  key: string,
  variant: AtomicRawVariant,
  input: AtomicProviderPricing,
): ServiceRate | undefined {
  if (book.scope.kind !== "provider_resource") return;
  const raw = variant.observation.raw;
  const denomination =
    raw.denomination === "USD"
      ? ({ kind: "fiat", currency: "USD" } as const)
      : raw.denomination === "DBU"
        ? dbu(input)
        : undefined;
  if (denomination === undefined) return;
  const provider = (unitKey: string, definition: string) =>
    ({
      unit: providerUnitExpression(input, unitKey, definition),
      scale: { numerator: "1", denominator: "1" },
    }) satisfies CanonicalSourceUnit;
  const standard = (
    value: "accelerator" | "billing_month" | "byte" | "request" | "second" | "token",
  ) => ({ namespace: "kmodels" as const, value });
  const scaled = (
    unit: Parameters<typeof standard>[0],
    scale: "gigabyte" | "hour" | "million" | "thousand",
  ) => canonicalizeSourceUnit([{ unit: standard(unit), power: 1, scale }]);
  const resource = book.scope.resource_key;
  const details = (() => {
    if (key === "payload_gb" && raw.unit === "GB")
      return { sourceUnit: scaled("byte", "gigabyte"), aggregation: "attempt" as const };
    if (key === "list_price_settlement" && raw.unit === "DBU")
      return {
        sourceUnit: provider("DBU", "One Databricks billing unit"),
        aggregation: "billing_period" as const,
      };
    if (key === "payload_tokens" && raw.unit === "million tokens")
      return { sourceUnit: scaled("token", "million"), aggregation: "attempt" as const };
    if (key === "knowledge_answer" && raw.unit === "answer")
      return {
        sourceUnit: provider("knowledge_answer", "One knowledge-base-backed answer"),
        aggregation: "result_item" as const,
      };
    if (key === "supervisor_step" && raw.unit === "step")
      return {
        sourceUnit: provider("supervisor_step", "One realized Supervisor Agent step"),
        aggregation: "result_item" as const,
      };
    if (key === "compute" && raw.unit === "unit-hour")
      return {
        sourceUnit: provider("search_unit_hour", "One AI Search capacity unit-hour"),
        aggregation: "resource" as const,
      };
    if (key === "storage" && raw.unit === "GB-month")
      return {
        sourceUnit: canonicalizeSourceUnit([
          { unit: standard("byte"), power: 1, scale: "gigabyte" },
          { unit: standard("billing_month"), power: 1 },
        ]),
        aggregation: "billing_period" as const,
      };
    if (
      (key === "judge_input" || key === "judge_output") &&
      raw.unit !== undefined &&
      /million .* tokens/.test(raw.unit)
    )
      return { sourceUnit: scaled("token", "million"), aggregation: "job" as const };
    if (key === "synthetic_question" && raw.unit === "question")
      return {
        sourceUnit: provider("synthetic_question", "One generated evaluation question"),
        aggregation: "result_item" as const,
      };
    if (key === "gpu_runtime" && raw.unit === "GPU-hour")
      return {
        sourceUnit: canonicalizeSourceUnit([
          { unit: standard("accelerator"), power: 1 },
          { unit: standard("second"), power: 1, scale: "hour" },
        ]),
        aggregation: "resource" as const,
      };
    if (key === "cpu_capacity" && raw.unit === "hour")
      return {
        sourceUnit: provider("cpu_node_hour", "One standard CPU Serving node-hour"),
        aggregation: "resource" as const,
      };
    if (key === "gpu_capacity" && raw.unit === "GPU instance hour")
      return {
        sourceUnit: canonicalizeSourceUnit([
          { unit: standard("accelerator"), power: 1 },
          { unit: standard("second"), power: 1, scale: "hour" },
        ]),
        aggregation: "resource" as const,
      };
    if (key === "reranker_queries" && raw.unit === "1k queries")
      return { sourceUnit: scaled("request", "thousand"), aggregation: "request" as const };
    if (key === "forecasting_compute" && raw.unit === "hour")
      return {
        sourceUnit: provider("forecasting_hour", "One Model Training forecasting hour"),
        aggregation: "job" as const,
      };
  })();
  if (details === undefined) return;
  const meterKey = `${resource.replaceAll("-", "_")}_${key}`;
  return {
    meter: providerMeter(input, meterKey, `${resource} ${key.replaceAll("_", " ")} usage`),
    sourceUnit: details.sourceUnit,
    denomination,
    aggregation: details.aggregation,
  };
}

function searchAllowance(
  book: AtomicPricingBook,
  offer: AtomicPricingOffer,
  term: AtomicRawTerm,
): AtomicPricingTerm[] {
  if (book.scope.kind !== "provider_resource") return [term];
  const offerId = pricingOfferId(pricingBookId("databricks", book.book_key), offer.offer_key);
  const storage = offer.terms.find(
    (candidate) => candidate.kind === "raw" && candidate.term_key === "storage",
  );
  if (storage === undefined) return [term];
  const variants: AtomicAllowanceTerm["variants"] = [];
  const raw: AtomicRawVariant[] = [];
  for (const variant of term.variants) {
    const amount = variant.observation.raw.amount;
    if (
      amount === undefined ||
      !isNonNegativeDecimal(amount) ||
      variant.observation.raw.unit !== "GB"
    ) {
      raw.push(variant);
      continue;
    }
    const applicability = variant.possible_scope ?? unconditionalApplicability;
    variants.push({
      benefit: {
        kind: "quantity",
        quantity: canonicalizeQuantity(
          rationalFromDecimal(amount),
          canonicalizeSourceUnit([
            {
              unit: { namespace: "kmodels", value: "byte" },
              power: 1,
              scale: "gigabyte",
            },
            { unit: { namespace: "kmodels", value: "billing_month" }, power: 1 },
          ]),
        ),
      },
      target: {
        kind: "rate_terms",
        term_refs: [pricingTermId(offerId, "rate", storage.term_key)],
      },
      reset: { namespace: "kmodels", value: "monthly" },
      applicability,
      observation: normalizedRawObservation(variant.observation, applicability),
    });
  }
  if (variants.length === 0) return [term];
  const allowance: AtomicAllowanceTerm = {
    term_key: term.term_key,
    kind: "allowance",
    variants,
    raw_variants: raw,
    source_refs: term.source_refs,
  };
  return [allowance];
}

function genieAllowance(
  book: AtomicPricingBook,
  _offer: AtomicPricingOffer,
  term: AtomicRawTerm,
  input: AtomicProviderPricing,
): AtomicPricingTerm[] {
  const bookId = pricingBookId(input.provider_id, book.book_key);
  const targets = ["genie-one", "genie-agents", "genie-code"].map((key) =>
    pricingOfferId(bookId, key),
  );
  const variants: AtomicAllowanceTerm["variants"] = [];
  const raw: AtomicRawVariant[] = [];
  for (const variant of term.variants) {
    const amount = variant.observation.raw.amount;
    if (
      amount === undefined ||
      !isNonNegativeDecimal(amount) ||
      variant.observation.raw.unit !== "DBU"
    ) {
      raw.push(variant);
      continue;
    }
    const applicability = variant.possible_scope ?? unconditionalApplicability;
    variants.push({
      benefit: {
        kind: "quantity",
        quantity: {
          value: rationalFromDecimal(amount),
          unit: providerUnitExpression(input, "DBU", "One Databricks billing unit"),
        },
      },
      target: { kind: "offers", offer_refs: targets },
      reset: { namespace: "kmodels", value: "monthly" },
      applicability,
      observation: normalizedRawObservation(variant.observation, applicability),
    });
  }
  if (variants.length === 0) return [term];
  return [
    {
      term_key: term.term_key,
      kind: "allowance",
      variants,
      raw_variants: raw,
      source_refs: term.source_refs,
    },
  ];
}

function bindDbuSettlement(books: AtomicPricingBook[]): void {
  const settlement = books.find(({ book_key }) => book_key === "account:dbu-settlement");
  const targetOffer = settlement?.offers.find(({ offer_key }) => offer_key === "effective-list");
  if (settlement === undefined || targetOffer === undefined) return;
  const target = pricingOfferId(
    pricingBookId("databricks", settlement.book_key),
    targetOffer.offer_key,
  );
  for (const book of books) {
    if (book === settlement) continue;
    for (const offer of book.offers) {
      if (!offer.terms.some(hasDbuRate)) continue;
      offer.relations.push(
        relationFromBook(
          book,
          "requires",
          [target],
          "DBU consumption requires the account's effective list-price settlement fact",
        ),
      );
    }
  }
}

function hasDbuRate(term: AtomicPricingTerm): boolean {
  return (
    term.kind === "rate" &&
    term.variants.some(
      ({ price }) =>
        price.denomination.kind === "provider_credit" && price.denomination.code === "DBU",
    )
  );
}

function dbu(input: AtomicProviderPricing): PriceDenomination {
  addAtom(input, {
    kind: "credit_denomination",
    key: "DBU",
    definition: "Databricks billing unit",
  });
  return { kind: "provider_credit", provider_id: input.provider_id, code: "DBU" };
}

function providerMeter(input: AtomicProviderPricing, key: string, definition: string): PriceMeter {
  addAtom(input, { kind: "meter", key, definition });
  return { namespace: "provider", provider_id: input.provider_id, value: key };
}

function providerUnitExpression(
  input: AtomicProviderPricing,
  key: string,
  definition: string,
): UnitExpression {
  addAtom(input, { kind: "unit", key, definition });
  return {
    factors: [
      { unit: { namespace: "provider", provider_id: input.provider_id, value: key }, power: 1 },
    ],
  };
}

function providerBinding(
  input: AtomicProviderPricing,
  key: string,
  definition: string,
  unit: UnitExpression,
  aggregation: ChargeBinding["aggregation"],
  observation: NormalizedPriceObservation,
  locator: string,
): ChargeBinding {
  addAtom(input, {
    kind: "usage_signal",
    key,
    definition,
    unit,
    resolution_phase:
      aggregation === "request" || aggregation === "attempt" ? "outcome" : "account",
  });
  return {
    signal: { namespace: "provider", provider_id: input.provider_id, value: key },
    aggregation,
    observations: [usageObservation(observation, locator)],
  };
}

function isUnit(unit: UnitExpression, value: "token"): boolean {
  return (
    unit.factors.length === 1 &&
    unit.factors[0]?.power === 1 &&
    unit.factors[0].unit.namespace === "kmodels" &&
    unit.factors[0].unit.value === value
  );
}

function withApplicability(
  observation: NormalizedPriceObservation,
  applicability: PriceApplicability,
): NormalizedPriceObservation {
  return { ...observation, establishes_applicability: applicability };
}

function normalizedRawObservation(
  observation: RawPriceObservation,
  applicability: PriceApplicability,
): NormalizedPriceObservation {
  return { ...observation, establishes_applicability: applicability };
}

function usageObservation(observation: RawPriceObservation, value: string): RawPriceObservation {
  return { ...rawEvidence(observation), locator: { kind: "meter", value } };
}

function relationFromOffer(
  offer: AtomicPricingOffer,
  kind: OfferRelation["kind"],
  targets: string[],
  label: string,
): OfferRelation {
  const source = offer.states[0]?.observation ?? offer.terms.flatMap(termObservations)[0];
  if (source === undefined) throw new Error(`Databricks offer ${offer.offer_key} has no evidence`);
  return relation(kind, targets, label, source);
}

function relationFromBook(
  book: AtomicPricingBook,
  kind: OfferRelation["kind"],
  targets: string[],
  label: string,
): OfferRelation {
  return relation(kind, targets, label, rawBookObservation(book, `topology:${label}`));
}

function relation(
  kind: OfferRelation["kind"],
  targets: string[],
  label: string,
  source: RawPriceObservation,
): OfferRelation {
  return {
    kind,
    target: { kind: "offers", offer_refs: targets },
    applicability: unconditionalApplicability,
    observations: [
      {
        ...rawEvidence(source),
        raw: { label },
        establishes_offer_refs: targets,
        establishes_book_refs: [],
      },
    ],
  };
}

function termObservations(term: AtomicPricingTerm): RawPriceObservation[] {
  if (term.kind === "raw") return term.variants.map(({ observation }) => observation);
  return [
    ...term.variants.map(({ observation }) => observation),
    ...term.raw_variants.map(({ observation }) => observation),
  ];
}

function normalizedBookObservation(
  book: AtomicPricingBook,
  label: string,
): NormalizedPriceObservation {
  return {
    ...rawBookObservation(book, `topology:${label}`),
    raw: { label },
    establishes_applicability: unconditionalApplicability,
  };
}

function rawBookObservation(book: AtomicPricingBook, locator: string): RawPriceObservation {
  const source = book.scope_observations[0];
  if (source === undefined) throw new Error(`Databricks book ${book.book_key} has no evidence`);
  return {
    source_ref: source.source_ref,
    locator: { kind: "provider_key", value: locator },
    raw: source.raw,
  };
}
