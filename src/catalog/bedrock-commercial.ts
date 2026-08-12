import type {
  AtomicAllowanceTerm,
  AtomicPricingBook,
  AtomicPricingOffer,
  AtomicPricingTerm,
  AtomicProviderPricing,
  AtomicRateTerm,
  AtomicRawTerm,
  AtomicRawVariant,
} from "./pricing-assembly.ts";
import { canonicalizeApplicability, unconditionalApplicability } from "./pricing-canonical.ts";
import { addAtom } from "./pricing-commercial-assembly.ts";
import { pricingBookId, pricingOfferId, pricingTermId } from "./pricing-identifiers.ts";
import { rationalFromDecimal } from "./pricing-rational.ts";
import { canonicalizeSourceUnit, canonicalizeUnitPrice } from "./pricing-units.ts";
import type {
  ChargeBinding,
  NormalizedPriceObservation,
  OfferRelation,
  PriceApplicability,
  PriceCondition,
  PriceMeter,
  RawPriceObservation,
  UnitExpression,
} from "./pricing-schema.ts";

type Mechanism = "on-demand" | "batch";

const tokenUnit: UnitExpression = {
  factors: [{ unit: { namespace: "kmodels", value: "token" }, power: 1 }],
};
const requestUnit: UnitExpression = {
  factors: [{ unit: { namespace: "kmodels", value: "request" }, power: 1 }],
};

export function applyBedrockCommercialTopology(
  input: AtomicProviderPricing,
): AtomicProviderPricing {
  if (input.provider_id !== "amazon-bedrock") return input;
  const books: AtomicPricingBook[] = [];
  const modelOffers = new Map<string, { onDemand?: string; batch?: string }>();
  const grounding: AtomicPricingBook[] = [];

  for (const book of input.books) {
    if (book.scope.kind !== "models") {
      books.push(book);
      continue;
    }
    const migrated = splitModelBook(book, input);
    if (migrated.model.offers.length > 0) books.push(migrated.model);
    books.push(...migrated.capacity);
    grounding.push(...migrated.grounding);
    const bookId = pricingBookId(input.provider_id, book.book_key);
    for (const modelRef of book.scope.model_refs)
      modelOffers.set(modelRef, {
        ...(migrated.model.offers.some(({ offer_key }) => offer_key === "on-demand")
          ? { onDemand: pricingOfferId(bookId, "on-demand") }
          : {}),
        ...(migrated.model.offers.some(({ offer_key }) => offer_key === "batch")
          ? { batch: pricingOfferId(bookId, "batch") }
          : {}),
      });
  }

  bindGrounding(grounding, modelOffers);
  const result = [...books, ...grounding];
  applyResourceTopology(input, result);
  bindServiceTopology(result);
  return { ...input, books: result };
}

interface SplitBookResult {
  model: AtomicPricingBook;
  capacity: AtomicPricingBook[];
  grounding: AtomicPricingBook[];
}

function splitModelBook(book: AtomicPricingBook, input: AtomicProviderPricing): SplitBookResult {
  const modelOffers: AtomicPricingOffer[] = [];
  const capacity: AtomicPricingBook[] = [];
  const grounding: AtomicPricingBook[] = [];
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
    const onDemand = partitionOffer(offer, "on-demand", input);
    const batch = partitionOffer(offer, "batch", input);
    const alternatives = [onDemand, batch].filter(hasCommercialContent);
    if (onDemand !== undefined && batch !== undefined && alternatives.length === 2) {
      const bookId = pricingBookId(input.provider_id, book.book_key);
      onDemand.relations.push(
        exclusiveRelation(
          onDemand,
          pricingOfferId(bookId, "batch"),
          "On-demand and Batch are alternative execution mechanisms",
        ),
      );
      batch.relations.push(
        exclusiveRelation(
          batch,
          pricingOfferId(bookId, "on-demand"),
          "Batch and on-demand are alternative execution mechanisms",
        ),
      );
    }
    modelOffers.push(...alternatives);
    grounding.push(...groundingBooks(book, offer, input));
  }

  const modelBookId = pricingBookId(input.provider_id, book.book_key);
  const executionRefs = modelOffers.flatMap(({ offer_key }) =>
    ["on-demand", "batch"].includes(offer_key) ? [pricingOfferId(modelBookId, offer_key)] : [],
  );
  for (const offer of capacityOffers)
    capacity.push(...capacityBooks(book, offer, input, executionRefs));

  return { model: { ...book, offers: modelOffers }, capacity, grounding };
}

function partitionOffer(
  offer: AtomicPricingOffer,
  mechanism: Mechanism,
  input: AtomicProviderPricing,
): AtomicPricingOffer | undefined {
  const states = offer.states.flatMap((state) => {
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
  const terms = offer.terms.flatMap((term) => partitionTerm(term, mechanism, input));
  if (states.length === 0 && terms.length === 0) return;
  return {
    ...offer,
    offer_key: mechanism,
    name: mechanism === "batch" ? "Batch inference" : "On-demand inference",
    states,
    terms,
    relations: [],
  };
}

function partitionTerm(
  term: AtomicPricingTerm,
  mechanism: Mechanism,
  input: AtomicProviderPricing,
): AtomicPricingTerm[] {
  if (term.kind === "raw") {
    if (term.term_key === "tool_call:grounding") return [];
    const variants = term.variants.flatMap((variant) => {
      const possible_scope =
        variant.possible_scope === undefined
          ? mechanism === "on-demand"
            ? unconditionalApplicability
            : undefined
          : mechanismApplicability(variant.possible_scope, mechanism);
      return possible_scope === undefined ? [] : [{ ...variant, possible_scope }];
    });
    return variants.length === 0 ? [] : [{ ...term, variants }];
  }
  if (term.kind !== "rate") return mechanism === "on-demand" ? [term] : [];
  if (isCapacityMeter(term.meter)) return [];
  const variants = term.variants.flatMap((variant) => {
    const applicability = mechanismApplicability(variant.applicability, mechanism);
    if (applicability === undefined) return [];
    const observation = withApplicability(variant.observation, applicability);
    const charge_binding = modelChargeBinding(
      term.meter,
      variant.price.per,
      mechanism,
      observation,
      input,
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
    if (variant.possible_scope === undefined) return mechanism === "on-demand" ? [variant] : [];
    const possible_scope = mechanismApplicability(variant.possible_scope, mechanism);
    return possible_scope === undefined ? [] : [{ ...variant, possible_scope }];
  });
  return variants.length + raw_variants.length === 0 ? [] : [{ ...term, variants, raw_variants }];
}

function mechanismApplicability(
  applicability: PriceApplicability,
  mechanism: Mechanism,
): PriceApplicability | undefined {
  const any_of = applicability.any_of.flatMap(({ all_of }) => {
    const tier = tierCondition(all_of);
    const value = tierValue(tier);
    if (value?.startsWith("reserved_") === true || value?.startsWith("provisioned_") === true)
      return [];
    if ((mechanism === "batch") !== (value === "batch")) return [];
    return [
      {
        all_of:
          mechanism === "batch" && tier !== undefined
            ? all_of.filter((item) => item !== tier)
            : all_of,
      },
    ];
  });
  return any_of.length === 0 ? undefined : canonicalizeApplicability({ any_of });
}

function capacityBooks(
  modelBook: AtomicPricingBook,
  sourceOffer: AtomicPricingOffer,
  input: AtomicProviderPricing,
  executionRefs: string[],
): AtomicPricingBook[] {
  if (modelBook.scope.kind !== "models") return [];
  const tiers = new Set<string>();
  for (const term of sourceOffer.terms) {
    if (term.kind !== "rate" || !isCapacityMeter(term.meter)) continue;
    for (const variant of term.variants)
      for (const { all_of } of variant.applicability.any_of) {
        const value = tierValue(tierCondition(all_of));
        if (value?.startsWith("reserved_") === true || value?.startsWith("provisioned_") === true)
          tiers.add(value);
      }
  }
  if (tiers.size === 0) return [];

  return modelBook.scope.model_refs.map((modelRef) => {
    const resourceKey = `model-capacity:${modelRef}`;
    const bookKey = `capacity:${modelRef}`;
    const bookId = pricingBookId(input.provider_id, bookKey);
    const offers = [...tiers].sort().flatMap((tier) => {
      const commitment = capacityOffer(sourceOffer, tier);
      if (commitment === undefined) return [];
      const commitmentRef = pricingOfferId(bookId, commitment.offer_key);
      const coveredKey = `${tier}-covered`;
      const covered: AtomicPricingOffer = {
        offer_key: coveredKey,
        name: `${capacityName(tier)} covered inference`,
        billing_mode: { namespace: "kmodels", value: "usage" },
        states: [
          {
            state: "included",
            applicability: unconditionalApplicability,
            observation: normalizedBookObservation(
              modelBook,
              unconditionalApplicability,
              `${capacityName(tier)} covers matching model execution`,
            ),
          },
        ],
        terms: [],
        relations: [
          relation(
            modelBook,
            "requires",
            [commitmentRef],
            `${capacityName(tier)} capacity commitment`,
          ),
          ...executionRefs.map((target) =>
            relation(
              modelBook,
              "exclusive_with",
              [target],
              "Covered and usage-priced execution are alternatives",
            ),
          ),
        ],
        source_refs: commitment.source_refs,
      };
      commitment.relations.push(
        relation(
          modelBook,
          "compatible_with",
          [pricingOfferId(bookId, coveredKey)],
          "Capacity covers matching execution",
        ),
      );
      return [commitment, covered];
    });
    return {
      book_key: bookKey,
      name: `${modelRef} capacity`,
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
        raw: { label: `${modelRef} capacity` },
      })),
      resource_edges: [
        {
          kind: "requires_resource",
          target: { kind: "models", model_refs: [modelRef] },
          applicability: unconditionalApplicability,
          observations: [rawBookObservation(modelBook, `topology:capacity:${modelRef}`)],
        },
      ],
      offers,
      source_refs: [...new Set(offers.flatMap(({ source_refs }) => source_refs))],
    };
  });
}

function capacityOffer(source: AtomicPricingOffer, tier: string): AtomicPricingOffer | undefined {
  const terms = source.terms.flatMap((term): AtomicPricingTerm[] => {
    if (term.kind !== "rate" || !isCapacityMeter(term.meter)) return [];
    const variants = term.variants.flatMap((variant) => {
      const applicability = exactTierApplicability(variant.applicability, tier);
      if (applicability === undefined) return [];
      const { charge_binding: _chargeBinding, ...unbound } = variant;
      return [
        {
          ...unbound,
          applicability,
          observation: withApplicability(variant.observation, applicability),
        },
      ];
    });
    if (variants.length === 0) return [];
    const capacityTerm: AtomicRateTerm = { ...term, variants, raw_variants: [] };
    return [capacityTerm];
  });
  if (terms.length === 0) return;
  const states = source.states.flatMap((state) => {
    const applicability = exactTierApplicability(state.applicability, tier);
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
  return {
    ...source,
    offer_key: tier,
    name: capacityName(tier),
    billing_mode: { namespace: "kmodels", value: "capacity" },
    states,
    terms,
    relations: [],
  };
}

function exactTierApplicability(
  applicability: PriceApplicability,
  tier: string,
): PriceApplicability | undefined {
  const any_of = applicability.any_of.flatMap(({ all_of }) => {
    const condition = tierCondition(all_of);
    return tierValue(condition) === tier
      ? [{ all_of: all_of.filter((item) => item !== condition) }]
      : [];
  });
  return any_of.length === 0 ? undefined : canonicalizeApplicability({ any_of });
}

function tierCondition(conditions: readonly PriceCondition[]): PriceCondition | undefined {
  return conditions.find(
    (condition) =>
      condition.kind === "categorical" &&
      condition.dimension.namespace === "kmodels" &&
      condition.dimension.value === "service_tier",
  );
}

function tierValue(condition: PriceCondition | undefined): string | undefined {
  if (condition?.kind !== "categorical" || condition.values.length !== 1) return;
  return condition.values[0]?.value;
}

function capacityName(tier: string): string {
  return tier
    .replace(/^reserved_/, "Reserved ")
    .replace(/^provisioned_/, "Provisioned ")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (value) => value.toUpperCase());
}

function groundingBooks(
  modelBook: AtomicPricingBook,
  source: AtomicPricingOffer,
  input: AtomicProviderPricing,
): AtomicPricingBook[] {
  if (modelBook.scope.kind !== "models") return [];
  const raw = source.terms.find(
    (term): term is AtomicRawTerm => term.kind === "raw" && term.term_key === "tool_call:grounding",
  );
  if (raw === undefined) return [];
  return modelBook.scope.model_refs.flatMap((modelRef) => {
    const variants = raw.variants.flatMap((variant) => groundingVariant(variant, input));
    if (variants.length === 0) return [];
    const resourceKey = `nova-web-grounding:${modelRef}`;
    const bookKey = `service:${resourceKey}`;
    const rate: AtomicRateTerm = {
      term_key: "web_search",
      kind: "rate",
      meter: { namespace: "kmodels", value: "web_search" },
      variants,
      raw_variants: [],
      source_refs: [...new Set(variants.map(({ observation }) => observation.source_ref))],
    };
    return [
      {
        book_key: bookKey,
        name: `${modelRef} Nova Web Grounding`,
        scope: {
          kind: "provider_resource",
          resource_kind: { namespace: "kmodels", value: "service" },
          resource_key: resourceKey,
          model_refs: [modelRef],
        },
        scope_observations: modelBook.scope_observations.map((observation) => ({
          ...observation,
          establishes: {
            kind: "provider_resource",
            resource_kind: { namespace: "kmodels", value: "service" },
            resource_key: resourceKey,
            model_refs: [modelRef],
          },
          raw: { label: `${modelRef} Nova Web Grounding` },
        })),
        offers: [
          {
            offer_key: "grounding",
            name: "Nova Web Grounding",
            billing_mode: { namespace: "kmodels", value: "usage" },
            states: variants.map((variant) => ({
              state: "numeric",
              applicability: variant.applicability,
              observation: variant.observation,
            })),
            terms: [rate],
            relations: [],
            source_refs: rate.source_refs,
          },
        ],
        source_refs: rate.source_refs,
      },
    ];
  });
}

function groundingVariant(
  variant: AtomicRawVariant,
  input: AtomicProviderPricing,
): AtomicRateTerm["variants"] {
  const amount = variant.observation.raw.amount;
  const denomination = variant.observation.raw.denomination;
  const unit = variant.observation.raw.unit;
  if (
    amount === undefined ||
    denomination !== "USD" ||
    !["Requests", "request"].includes(unit ?? "")
  )
    return [];
  addAtom(input, {
    kind: "usage_signal",
    key: "nova_web_grounding_requests",
    definition: "Nova Web Grounding requests realized by Amazon Bedrock",
    unit: requestUnit,
    resolution_phase: "outcome",
  });
  const applicability = variant.possible_scope ?? unconditionalApplicability;
  return [
    {
      price: {
        value: rationalFromDecimal(amount),
        denomination: { kind: "fiat", currency: "USD" },
        per: requestUnit,
      },
      applicability,
      charge_binding: {
        signal: {
          namespace: "provider",
          provider_id: "amazon-bedrock",
          value: "nova_web_grounding_requests",
        },
        aggregation: "request",
        observations: [
          usageObservation(variant.observation, "response:Nova Web Grounding request usage"),
        ],
      },
      observation: {
        ...variant.observation,
        establishes_applicability: applicability,
      },
    },
  ];
}

function bindGrounding(
  books: AtomicPricingBook[],
  modelOffers: ReadonlyMap<string, { onDemand?: string }>,
): void {
  for (const book of books) {
    if (book.scope.kind !== "provider_resource") continue;
    const targets = book.scope.model_refs.flatMap((modelRef) => {
      const target = modelOffers.get(modelRef)?.onDemand;
      return target === undefined ? [] : [target];
    });
    if (targets.length === 0) continue;
    for (const offer of book.offers)
      offer.relations.push(relation(book, "requires", targets, "Exact model inference"));
  }
}

function applyResourceTopology(input: AtomicProviderPricing, books: AtomicPricingBook[]): void {
  for (const book of books) {
    if (book.scope.kind !== "provider_resource" || isGeneratedResource(book)) continue;
    for (const offer of book.offers) {
      offer.terms = offer.terms.flatMap((term) =>
        term.kind === "raw" ? normalizeCommercialTerm(book, offer, term, input) : [term],
      );
      normalizeRegistryAllowances(book, offer, input);
    }
  }
}

function normalizeRegistryAllowances(
  book: AtomicPricingBook,
  offer: AtomicPricingOffer,
  input: AtomicProviderPricing,
): void {
  if (book.scope.kind !== "provider_resource" || book.scope.resource_key !== "agentcore-registry")
    return;
  const offerId = pricingOfferId(pricingBookId(input.provider_id, book.book_key), offer.offer_key);
  const definitions = new Map<string, { rateKey: string; rawUnit: string; unit: UnitExpression }>([
    [
      "records-allowance",
      {
        rateKey: "records",
        rawUnit: "Registry Records",
        unit: canonicalizeSourceUnit([
          {
            unit: providerUnit(
              input,
              "registry_record",
              "One net record in the AWS Agent Registry",
            ),
            power: 1,
          },
          { unit: { namespace: "kmodels", value: "billing_month" }, power: 1 },
        ]).unit,
      },
    ],
    ["search-allowance", { rateKey: "search", rawUnit: "Requests", unit: requestUnit }],
    ["list-get-allowance", { rateKey: "list-get", rawUnit: "Requests", unit: requestUnit }],
  ]);
  offer.terms = offer.terms.map((term): AtomicPricingTerm => {
    if (term.kind !== "raw") return term;
    const definition = definitions.get(term.term_key);
    if (definition === undefined) return term;
    const target = offer.terms.find(
      (candidate) => candidate.kind === "rate" && candidate.term_key === definition.rateKey,
    );
    if (target === undefined) {
      const unresolved: AtomicRawTerm = {
        ...term,
        variants: term.variants.map((variant) => ({
          ...variant,
          reason: "target_rate_not_normalized" as const,
        })),
      };
      return unresolved;
    }
    const variants = term.variants.flatMap((variant) => {
      const amount = variant.observation.raw.amount;
      if (
        variant.impact !== "allowance" ||
        amount === undefined ||
        variant.observation.raw.unit !== definition.rawUnit ||
        variant.observation.raw.denomination !== undefined
      )
        return [];
      const applicability = variant.possible_scope ?? unconditionalApplicability;
      return [
        {
          benefit: {
            kind: "quantity" as const,
            quantity: { value: rationalFromDecimal(amount), unit: definition.unit },
          },
          target: {
            kind: "rate_terms" as const,
            term_refs: [pricingTermId(offerId, "rate", target.term_key)],
          },
          reset: { namespace: "kmodels" as const, value: "monthly" as const },
          applicability,
          ...(variant.validity === undefined ? {} : { validity: variant.validity }),
          observation: {
            ...variant.observation,
            establishes_applicability: applicability,
          },
        },
      ];
    });
    if (variants.length !== term.variants.length) return term;
    const allowance: AtomicAllowanceTerm = {
      term_key: term.term_key,
      kind: "allowance",
      variants,
      raw_variants: [],
      source_refs: term.source_refs,
    };
    return allowance;
  });
}

function bindServiceTopology(books: AtomicPricingBook[]): void {
  const byKey = new Map(books.map((book) => [book.book_key, book]));
  const offerRefs = (bookKey: string): string[] => {
    const book = byKey.get(bookKey);
    if (book === undefined) return [];
    const bookId = pricingBookId("amazon-bedrock", bookKey);
    return book.offers.map(({ offer_key }) => pricingOfferId(bookId, offer_key)).sort();
  };
  const identity = byKey.get("service:agentcore-identity");
  const included = identity?.offers.find(({ offer_key }) => offer_key === "runtime-or-gateway");
  const covering = [
    ...offerRefs("service:agentcore-runtime"),
    ...offerRefs("service:agentcore-gateway"),
  ].sort();
  if (identity !== undefined && included !== undefined && covering.length > 0)
    included.relations.push(
      relation(identity, "requires", covering, "AgentCore Runtime or Gateway usage"),
    );

  const optimization = byKey.get("service:agentcore-optimization");
  const recommendations = optimization?.offers.find(
    ({ offer_key }) => offer_key === "recommendations",
  );
  const evaluations = offerRefs("service:agentcore-evaluations");
  if (optimization !== undefined && recommendations !== undefined && evaluations.length > 0)
    recommendations.relations.push(
      relation(optimization, "incurs", evaluations, "Consumed AgentCore Evaluations"),
    );
}

function isGeneratedResource(book: AtomicPricingBook): boolean {
  return (
    book.scope.kind === "provider_resource" &&
    (book.scope.resource_key.startsWith("model-capacity:") ||
      book.scope.resource_key.startsWith("nova-web-grounding:"))
  );
}

function normalizeCommercialTerm(
  book: AtomicPricingBook,
  offer: AtomicPricingOffer,
  term: AtomicRawTerm,
  input: AtomicProviderPricing,
): AtomicPricingTerm[] {
  const groups = new Map<string, { meter: PriceMeter; variants: AtomicRateTerm["variants"] }>();
  const raw: AtomicRawVariant[] = [];
  for (const variant of term.variants) {
    const normalized = commercialVariant(book, offer, term.term_key, variant, input);
    if (normalized === undefined) {
      raw.push(variant);
      continue;
    }
    const key = `${normalized.meter.namespace}:${normalized.meter.value}`;
    const group = groups.get(key) ?? { meter: normalized.meter, variants: [] };
    group.variants.push(normalized.variant);
    groups.set(key, group);
  }
  if (groups.size === 0) return [term];
  for (const { variants } of groups.values())
    for (const variant of variants)
      offer.states.push({
        state: "numeric",
        applicability: variant.applicability,
        ...(variant.validity === undefined ? {} : { validity: variant.validity }),
        observation: {
          ...variant.observation,
          raw: { label: "Published numeric rate" },
        },
      });
  return [...groups.values()].map(
    ({ meter, variants }, index): AtomicRateTerm => ({
      term_key:
        groups.size === 1 ? term.term_key : `${term.term_key}:${meter.namespace}:${meter.value}`,
      kind: "rate",
      meter,
      variants,
      raw_variants: index === 0 ? raw : [],
      source_refs: [
        ...new Set([
          ...variants.map(({ observation }) => observation.source_ref),
          ...(index === 0 ? raw.map(({ observation }) => observation.source_ref) : []),
        ]),
      ],
    }),
  );
}

function commercialVariant(
  book: AtomicPricingBook,
  offer: AtomicPricingOffer,
  termKey: string,
  variant: AtomicRawVariant,
  input: AtomicProviderPricing,
): { meter: PriceMeter; variant: AtomicRateTerm["variants"][number] } | undefined {
  const raw = variant.observation.raw;
  if (raw.amount === undefined || raw.denomination !== "USD" || raw.unit === undefined) return;
  const sourceUnit = commercialUnit(raw.unit, raw.fragment, input);
  if (sourceUnit === undefined) return;
  const meter = commercialMeter(book, offer, termKey, raw, input);
  const applicability = commercialApplicability(variant, input);
  const charge_binding = commercialBinding(
    book,
    termKey,
    raw,
    sourceUnit.unit,
    sourceUnit.scale,
    variant.observation,
    input,
  );
  return {
    meter,
    variant: {
      price: canonicalizeUnitPrice(
        rationalFromDecimal(raw.amount),
        { kind: "fiat", currency: "USD" },
        sourceUnit,
      ),
      applicability,
      ...(variant.validity === undefined ? {} : { validity: variant.validity }),
      ...(charge_binding === undefined ? {} : { charge_binding }),
      observation: commercialObservation(variant.observation, applicability),
    },
  };
}

function commercialObservation(
  observation: RawPriceObservation,
  applicability: PriceApplicability,
): NormalizedPriceObservation {
  return {
    ...observation,
    locator:
      observation.raw.label === undefined
        ? observation.locator
        : { kind: "sku", value: observation.raw.label },
    establishes_applicability: applicability,
  };
}

function commercialUnit(
  rawUnit: string,
  fragment: string | undefined,
  input: AtomicProviderPricing,
): ReturnType<typeof canonicalizeSourceUnit> | undefined {
  const standard = (
    value: "byte" | "event" | "image" | "page" | "request" | "second" | "token",
  ) => ({ namespace: "kmodels" as const, value });
  const provider = (key: string, definition: string) => {
    addAtom(input, { kind: "unit", key, definition });
    return { namespace: "provider" as const, provider_id: input.provider_id, value: key };
  };
  const one = (
    unit: ReturnType<typeof standard> | ReturnType<typeof provider>,
    scale?: "thousand" | "million" | "gigabyte" | "minute" | "hour",
  ) => canonicalizeSourceUnit([{ unit, power: 1, ...(scale === undefined ? {} : { scale }) }]);
  switch (rawUnit) {
    case "1K tokens":
      return one(standard("token"), "thousand");
    case "1M tokens":
    case "1M Input Tokens":
    case "1M Output Tokens":
      return one(standard("token"), "million");
    case "API Calls":
    case "Invocations":
    case "Queries":
    case "Requests":
      return one(standard("request"));
    case "Per 1000 requests":
      return one(standard("request"), "thousand");
    case "1K Registry Record-Months":
      return canonicalizeSourceUnit([
        {
          unit: provider("registry_record", "One net record in the AWS Agent Registry"),
          power: 1,
          scale: "thousand",
        },
        { unit: { namespace: "kmodels", value: "billing_month" }, power: 1 },
      ]);
    case "Evaluations":
    case "Events":
    case "Node transition":
      return one(standard("event"));
    case "Images Processed":
    case "Images processed":
    case "image":
      return one(standard("image"));
    case "Pages Processed":
      return one(standard("page"));
    case "Minutes Processed":
      return one(standard("second"), "minute");
    case "seconds":
      return one(standard("second"));
    case "hour":
    case "hours":
    case "Hours":
      return one(standard("second"), "hour");
    case "GB":
      return one(standard("byte"), "gigabyte");
    case "GB-Hours":
      return canonicalizeSourceUnit([
        { unit: standard("byte"), power: 1, scale: "gigabyte" },
        { unit: standard("second"), power: 1, scale: "hour" },
      ]);
    case "GB-Month":
      return canonicalizeSourceUnit([
        { unit: standard("byte"), power: 1, scale: "gigabyte" },
        { unit: { namespace: "kmodels", value: "billing_month" }, power: 1 },
      ]);
    case "vCPU-Hours":
      return canonicalizeSourceUnit([
        {
          unit: provider("vcpu", "One virtual CPU allocated by Amazon Bedrock AgentCore"),
          power: 1,
        },
        { unit: standard("second"), power: 1, scale: "hour" },
      ]);
    case "Search Units":
      return one(provider("search_unit", "One provider-published search or rerank billing unit"));
    case "TextUnit":
      return one(
        provider(
          "guardrail_text_unit",
          "One Amazon Bedrock Guardrail text unit of up to 1,000 characters",
        ),
        fragment !== undefined && /per 1K text units?/i.test(fragment) ? "thousand" : undefined,
      );
    case "Custom Model Unit per Min":
      return canonicalizeSourceUnit([
        {
          unit: provider("custom_model_unit", "One Amazon Bedrock Custom Model Unit"),
          power: 1,
        },
        { unit: standard("second"), power: 1, scale: "minute" },
      ]);
    case "Model/month":
      return canonicalizeSourceUnit([
        {
          unit: provider("custom_model", "One stored Amazon Bedrock custom model"),
          power: 1,
        },
        { unit: { namespace: "kmodels", value: "billing_month" }, power: 1 },
      ]);
    case "Fields per Image Processed":
      return commercialFieldUnit(standard("image"), input);
    case "Fields per Minute Processed":
      return commercialFieldUnit(standard("second"), input, "minute");
    case "Fields per Page Processed":
      return commercialFieldUnit(standard("page"), input);
    case "Memory-Retrieved":
      return one(provider("memory_retrieval", "One memory retrieved by Amazon Bedrock AgentCore"));
    case "MemoryStored-Hour":
      return commercialStoredMemoryUnit(input, "hour");
    case "MemoryStored-Month":
      return commercialStoredMemoryUnit(input, "month");
    case "ToolIndex-Month":
      return canonicalizeSourceUnit([
        {
          unit: provider("tool_index", "One indexed AgentCore Gateway tool"),
          power: 1,
        },
        { unit: { namespace: "kmodels", value: "billing_month" }, power: 1 },
      ]);
    case "video":
      return one(provider("video", "One provider-published video item"));
  }
}

function commercialFieldUnit(
  processed: UnitExpression["factors"][number]["unit"],
  input: AtomicProviderPricing,
  scale?: "minute",
): ReturnType<typeof canonicalizeSourceUnit> {
  const field = providerUnit(
    input,
    "blueprint_field",
    "One Bedrock Data Automation custom blueprint field",
  );
  return canonicalizeSourceUnit([
    { unit: field, power: 1 },
    { unit: processed, power: 1, ...(scale === undefined ? {} : { scale }) },
  ]);
}

function commercialStoredMemoryUnit(
  input: AtomicProviderPricing,
  period: "hour" | "month",
): ReturnType<typeof canonicalizeSourceUnit> {
  const memory = providerUnit(
    input,
    "stored_memory",
    "One memory stored by Amazon Bedrock AgentCore",
  );
  return canonicalizeSourceUnit([
    { unit: memory, power: 1 },
    ...(period === "hour"
      ? [
          {
            unit: { namespace: "kmodels" as const, value: "second" as const },
            power: 1,
            scale: "hour" as const,
          },
        ]
      : [
          {
            unit: { namespace: "kmodels" as const, value: "billing_month" as const },
            power: 1,
          },
        ]),
  ]);
}

function commercialMeter(
  book: AtomicPricingBook,
  offer: AtomicPricingOffer,
  termKey: string,
  raw: RawPriceObservation["raw"],
  input: AtomicProviderPricing,
): PriceMeter {
  const resource = book.scope.kind === "provider_resource" ? book.scope.resource_key : "";
  const unit = raw.unit ?? "";
  const text = `${offer.offer_key} ${termKey} ${raw.fragment ?? ""}`;
  const standard = (value: Extract<PriceMeter, { namespace: "kmodels" }>["value"]): PriceMeter => ({
    namespace: "kmodels",
    value,
  });
  if (resource === "guardrails") return standard("content_safety");
  if (resource === "reranking") return standard("rerank");
  if (["web-search", "agentcore-web-search"].includes(resource)) return standard("web_search");
  if (
    /storage/i.test(text) ||
    ["GB-Month", "MemoryStored-Hour", "MemoryStored-Month"].includes(unit)
  )
    return standard("storage");
  if (resource === "custom-model-import") return standard("compute");
  if (resource.startsWith("model-customization:")) {
    if (/training/i.test(offer.offer_key))
      return /tokens?/i.test(unit) ? standard("training_input") : standard("training_compute");
    if (/input/i.test(text)) return standard("input_text");
    if (/output/i.test(text)) return standard("output_text");
    return standard("compute");
  }
  if (["agentcore-runtime", "agentcore-browser", "agentcore-code-interpreter"].includes(resource))
    return standard("compute");
  if (resource === "agentcore-evaluations") {
    if (/input/i.test(text)) return standard("input_text");
    if (/output/i.test(text)) return standard("output_text");
    return standard("evaluation");
  }
  if (resource === "model-evaluation") return standard("evaluation");
  if (resource === "agentcore-gateway" && unit === "GB") return standard("data_transfer");
  return providerMeter(
    input,
    `${resource.replace(/[^a-z0-9]+/gi, "_")}_${termKey.replace(/[^a-z0-9]+/gi, "_")}`,
    `${book.name} ${termKey.replaceAll("-", " ")} usage`,
  );
}

function commercialApplicability(
  variant: AtomicRawVariant,
  input: AtomicProviderPricing,
): PriceApplicability {
  const base = variant.possible_scope ?? unconditionalApplicability;
  const instanceType = rawCondition(variant.observation.raw, "instanceType");
  if (instanceType === undefined) return base;
  const dimension = providerDimension(
    input,
    "agentcore_instance_type",
    "Amazon Bedrock AgentCore instance type selected by the account resource",
    "account",
  );
  const value = providerCategorical(
    input,
    dimension,
    instanceType,
    `Amazon Bedrock AgentCore instance type ${instanceType}`,
  );
  return canonicalizeApplicability({
    any_of: base.any_of.map(({ all_of }) => ({
      all_of: [...all_of, { kind: "categorical", dimension, values: [value] }],
    })),
  });
}

function commercialBinding(
  book: AtomicPricingBook,
  termKey: string,
  raw: RawPriceObservation["raw"],
  unit: UnitExpression,
  scale: ReturnType<typeof rationalFromDecimal>,
  observation: RawPriceObservation,
  input: AtomicProviderPricing,
): ChargeBinding | undefined {
  const usageType = rawCondition(raw, "usagetype");
  const resource =
    book.scope.kind === "provider_resource" ? book.scope.resource_key : book.book_key;
  if (usageType === undefined)
    return pageCommercialBinding(book, resource, termKey, unit, scale, observation, input);
  const signalTerm =
    resource === "agentcore-runtime" && termKey.startsWith("instance-")
      ? "instance-runtime"
      : termKey;
  const key = `cur_${resource}_${signalTerm}_${raw.unit ?? "unit"}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  addAtom(input, {
    kind: "usage_signal",
    key,
    definition: `AWS CUR billing quantity identified by ${key.replaceAll("_", " ")}`,
    unit,
    resolution_phase: "account",
  });
  return {
    signal: { namespace: "provider", provider_id: input.provider_id, value: key },
    aggregation: "billing_period",
    ...(scale.numerator === "1" && scale.denominator === "1" ? {} : { scale }),
    observations: [usageObservation(observation, `cur:line_item/UsageType=${usageType}`)],
  };
}

function pageCommercialBinding(
  book: AtomicPricingBook,
  resource: string,
  termKey: string,
  unit: UnitExpression,
  scale: ReturnType<typeof rationalFromDecimal>,
  observation: RawPriceObservation,
  input: AtomicProviderPricing,
): ChargeBinding | undefined {
  const binding:
    | {
        key: string;
        definition: string;
        phase: "outcome" | "account";
        aggregation: ChargeBinding["aggregation"];
      }
    | undefined =
    resource === "agentcore-identity" && termKey === "credential-requests"
      ? {
          key: "agentcore_identity_successful_credential_requests",
          definition: "Successful direct AgentCore Identity OAuth-token or API-key retrievals",
          phase: "outcome",
          aggregation: "request",
        }
      : resource === "agentcore-registry" && ["records", "search", "list-get"].includes(termKey)
        ? {
            key: `agentcore_registry_${termKey.replace("-", "_")}`,
            definition: `${book.name ?? "AWS Agent Registry"} ${termKey.replaceAll("-", " ")} account quantity`,
            phase: "account",
            aggregation: "billing_period",
          }
        : resource === "model-evaluation" && termKey === "completed-human-task"
          ? {
              key: "completed_human_evaluation_tasks",
              definition: "Completed human tasks in an Amazon Bedrock model-evaluation job",
              phase: "outcome",
              aggregation: "job",
            }
          : undefined;
  if (binding === undefined) return;
  addAtom(input, {
    kind: "usage_signal",
    key: binding.key,
    definition: binding.definition,
    unit,
    resolution_phase: binding.phase,
  });
  return {
    signal: { namespace: "provider", provider_id: input.provider_id, value: binding.key },
    aggregation: binding.aggregation,
    ...(scale.numerator === "1" && scale.denominator === "1" ? {} : { scale }),
    observations: [usageObservation(observation, `pricing-page:${resource}:${termKey}`)],
  };
}

function rawCondition(raw: RawPriceObservation["raw"], name: string): string | undefined {
  return raw.conditions?.find(({ dimension }) => dimension === name)?.value;
}

function providerUnit(
  input: AtomicProviderPricing,
  key: string,
  definition: string,
): UnitExpression["factors"][number]["unit"] {
  addAtom(input, { kind: "unit", key, definition });
  return { namespace: "provider", provider_id: input.provider_id, value: key };
}

function providerMeter(input: AtomicProviderPricing, key: string, definition: string): PriceMeter {
  addAtom(input, { kind: "meter", key, definition });
  return { namespace: "provider", provider_id: input.provider_id, value: key };
}

function providerDimension(
  input: AtomicProviderPricing,
  key: string,
  definition: string,
  resolution_phase: "publication" | "request" | "outcome" | "account",
): PriceCondition["dimension"] {
  addAtom(input, { kind: "dimension", key, definition, resolution_phase });
  return { namespace: "provider", provider_id: input.provider_id, value: key };
}

function providerCategorical(
  input: AtomicProviderPricing,
  dimension: PriceCondition["dimension"],
  key: string,
  definition: string,
): Extract<PriceCondition, { kind: "categorical" }>["values"][number] {
  addAtom(input, { kind: "categorical_value", key, dimension, definition, label: key });
  return { namespace: "provider", provider_id: input.provider_id, value: key };
}

function modelChargeBinding(
  meter: PriceMeter,
  unit: UnitExpression,
  mechanism: Mechanism,
  observation: NormalizedPriceObservation,
  input: AtomicProviderPricing,
): ChargeBinding | undefined {
  if (!sameUnit(unit, tokenUnit) || meter.namespace !== "kmodels") return;
  const field =
    meter.value === "input_text"
      ? "inputTokens"
      : meter.value === "output_text"
        ? "outputTokens"
        : meter.value === "cache_read_text"
          ? "cacheReadInputTokens"
          : meter.value === "cache_write_text"
            ? "cacheWriteInputTokens"
            : undefined;
  if (field === undefined) return;
  const key = `runtime_${field.replace(/[A-Z]/g, (value) => `_${value.toLowerCase()}`)}`;
  addAtom(input, {
    kind: "usage_signal",
    key,
    definition: `${field} token usage reported by a completed Bedrock invocation or Batch result item`,
    unit: tokenUnit,
    resolution_phase: "outcome",
  });
  return {
    signal: { namespace: "provider", provider_id: input.provider_id, value: key },
    aggregation: mechanism === "batch" ? "result_item" : "attempt",
    observations: [
      usageObservation(
        observation,
        mechanism === "batch"
          ? `batch-result:modelOutput.usage.${field}`
          : `response:usage.${field}`,
      ),
    ],
  };
}

function isCapacityMeter(meter: PriceMeter): boolean {
  return meter.namespace === "kmodels" && meter.value === "provisioned_capacity";
}

function exclusiveRelation(
  source: AtomicPricingOffer,
  target: string,
  label: string,
): OfferRelation {
  const observation = offerObservation(source, label);
  return {
    kind: "exclusive_with",
    target: { kind: "offers", offer_refs: [target] },
    applicability: unconditionalApplicability,
    observations: [
      {
        ...observation,
        establishes_offer_refs: [target],
        establishes_book_refs: [],
      },
    ],
  };
}

function relation(
  book: AtomicPricingBook,
  kind: OfferRelation["kind"],
  targets: string[],
  label: string,
): OfferRelation {
  return {
    kind,
    target: { kind: "offers", offer_refs: targets },
    applicability: unconditionalApplicability,
    observations: [
      {
        ...rawBookObservation(book, `topology:${label}`),
        raw: { label },
        establishes_offer_refs: targets,
        establishes_book_refs: [],
      },
    ],
  };
}

function normalizedBookObservation(
  book: AtomicPricingBook,
  applicability: PriceApplicability,
  label: string,
): NormalizedPriceObservation {
  return {
    ...rawBookObservation(book, `topology:${label}`),
    raw: { label },
    establishes_applicability: applicability,
  };
}

function rawBookObservation(book: AtomicPricingBook, locator: string): RawPriceObservation {
  const observation = book.scope_observations[0];
  if (observation === undefined) throw new Error(`Bedrock book ${book.book_key} has no evidence`);
  return {
    source_ref: observation.source_ref,
    locator: { kind: "provider_key", value: locator },
    raw: { fragment: locator },
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
  if (observation === undefined)
    throw new Error(`Bedrock offer ${offer.offer_key} has no evidence`);
  return { source_ref: observation.source_ref, locator: observation.locator, raw: { label } };
}

function usageObservation(
  observation: NormalizedPriceObservation | RawPriceObservation,
  locator: string,
): RawPriceObservation {
  return {
    source_ref: observation.source_ref,
    locator: { kind: "provider_key", value: locator },
    raw: { fragment: locator },
  };
}

function withApplicability(
  observation: NormalizedPriceObservation,
  applicability: PriceApplicability,
): NormalizedPriceObservation {
  return { ...observation, establishes_applicability: applicability };
}

function sameUnit(left: UnitExpression, right: UnitExpression): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hasCommercialContent(offer: AtomicPricingOffer | undefined): offer is AtomicPricingOffer {
  return offer !== undefined && (offer.states.length > 0 || offer.terms.length > 0);
}
