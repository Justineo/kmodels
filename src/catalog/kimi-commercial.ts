import {
  compareCanonicalValues,
  uniqueCanonicalValues as uniqueCanonical,
} from "./canonical-value.ts";
import type {
  AtomicPricingBook,
  AtomicPricingOffer,
  AtomicPricingTerm,
  AtomicProviderPricing,
  AtomicRateVariant,
  AtomicRawVariant,
} from "./pricing-assembly.ts";
import type { PublishedPricingModel } from "./pricing-adapter.ts";
import { canonicalizeApplicability, unconditionalApplicability } from "./pricing-canonical.ts";
import {
  addAtom,
  isStandardUnit,
  offerEvidence,
  rawEvidence,
  relation,
  withApplicability,
} from "./pricing-commercial-assembly.ts";
import { pricingBookId, pricingOfferId } from "./pricing-identifiers.ts";
import {
  directQuantityMethods as directMethods,
  emptyQuantityMethods as emptyMethods,
  includePricingInputSourceRefs,
  indexPricingInputs,
  mergeQuantityMethods as mergeMethods,
  pricingInputFacts,
  pricingInputObservation,
  uniquePricingInputFacts,
  usageInputSources,
  type BoundQuantityMethods as MethodsAndFacts,
  type PricingInputIndex,
} from "./pricing-input.ts";
import type {
  ChargeBinding,
  PriceApplicability,
  PriceCategoricalValue,
  PriceCondition,
  PriceMeter,
  PriceSelectorSource,
  RawPriceObservation,
  UnitExpression,
  UsageSignal,
} from "./pricing-schema.ts";
import type { SourcePricingInputFact } from "./pricing-source.ts";

type Mechanism = "sync" | "batch";

interface ModelOffers {
  sync?: string;
  batch?: string;
}

export function applyKimiCommercialTopology(
  input: AtomicProviderPricing,
  publishedModels: readonly PublishedPricingModel[],
  pricingInputs: readonly SourcePricingInputFact[],
): AtomicProviderPricing {
  const published = new Map(publishedModels.map((model) => [model.uid, model]));
  const inputIndex = indexPricingInputs(pricingInputs);
  const modelOffers = new Map<string, ModelOffers>();
  const books = input.books.map((book) => {
    if (book.scope.kind !== "models") return bindResourceBook(book, input, inputIndex);
    const modelRef = book.scope.model_refs[0];
    const migrated = splitModelBook(
      book,
      modelRef === undefined ? undefined : published.get(modelRef),
      inputIndex,
    );
    const bookId = pricingBookId(input.provider_id, book.book_key);
    const offers: ModelOffers = {};
    if (migrated.offers.some(({ offer_key }) => offer_key === "sync"))
      offers.sync = pricingOfferId(bookId, "sync");
    if (migrated.offers.some(({ offer_key }) => offer_key === "batch"))
      offers.batch = pricingOfferId(bookId, "batch");
    for (const modelRef of book.scope.model_refs) modelOffers.set(modelRef, offers);
    return migrated;
  });
  for (const book of books)
    if (book.scope.kind === "provider_resource") bindResourceRelations(book, modelOffers);
  return { ...input, books: books.map(includePricingInputSourceRefs) };
}

function splitModelBook(
  book: AtomicPricingBook,
  model: PublishedPricingModel | undefined,
  inputIndex: PricingInputIndex,
): AtomicPricingBook {
  const offers = book.offers.flatMap((offer) => {
    if (offer.offer_key !== "usage") return [withSettlement(offer, "Kimi API usage")];
    const sync = partitionOffer(book, offer, "sync", model, inputIndex);
    const batch = partitionOffer(book, offer, "batch", model, inputIndex);
    const result = [sync, batch].filter(hasCommercialContent);
    if (sync !== undefined && batch !== undefined && result.length === 2) {
      const bookId = pricingBookId("kimi", book.book_key);
      sync.relations.push(
        relation(
          sync,
          "exclusive_with",
          [pricingOfferId(bookId, "batch")],
          "Synchronous and Batch inference are alternative execution mechanisms",
        ),
      );
      batch.relations.push(
        relation(
          batch,
          "exclusive_with",
          [pricingOfferId(bookId, "sync")],
          "Batch and synchronous inference are alternative execution mechanisms",
        ),
      );
    }
    return result;
  });
  return { ...book, offers };
}

function partitionOffer(
  book: AtomicPricingBook,
  offer: AtomicPricingOffer,
  mechanism: Mechanism,
  model: PublishedPricingModel | undefined,
  inputIndex: PricingInputIndex,
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
  const terms = offer.terms.flatMap((term) =>
    partitionTerm(book, term, mechanism, model, inputIndex),
  );
  if (states.length === 0 && terms.length === 0) return;
  return withSettlement(
    {
      ...offer,
      offer_key: mechanism,
      name: mechanism === "batch" ? "Batch inference" : "Synchronous inference",
      states,
      terms,
      relations: [],
    },
    mechanism === "batch" ? "Kimi Batch usage" : "Kimi synchronous usage",
  );
}

function partitionTerm(
  book: AtomicPricingBook,
  term: AtomicPricingTerm,
  mechanism: Mechanism,
  model: PublishedPricingModel | undefined,
  inputIndex: PricingInputIndex,
): AtomicPricingTerm[] {
  if (term.kind === "raw") {
    const variants = term.variants.flatMap((variant) => partitionRaw(variant, mechanism));
    return variants.length === 0 ? [] : [{ ...term, variants }];
  }
  if (term.kind !== "rate") return mechanism === "sync" ? [term] : [];
  const variants = term.variants.flatMap((variant) => {
    const applicability = mechanismApplicability(variant.applicability, mechanism);
    if (applicability === undefined) return [];
    const next = {
      ...variant,
      applicability,
      observation: withApplicability(variant.observation, applicability),
    };
    const charge_binding = modelBinding(book, term.meter, next, mechanism, model, inputIndex);
    const selector_sources = selectorSources(applicability, inputIndex);
    return [
      {
        ...next,
        ...(charge_binding === undefined ? {} : { charge_binding }),
        ...(selector_sources.length === 0 ? {} : { selector_sources }),
      },
    ];
  });
  const raw_variants = term.raw_variants.flatMap((variant) => partitionRaw(variant, mechanism));
  return variants.length + raw_variants.length === 0 ? [] : [{ ...term, variants, raw_variants }];
}

function partitionRaw(variant: AtomicRawVariant, mechanism: Mechanism): AtomicRawVariant[] {
  if (variant.possible_scope === undefined) return mechanism === "sync" ? [variant] : [];
  const possible_scope = mechanismApplicability(variant.possible_scope, mechanism);
  return possible_scope === undefined ? [] : [{ ...variant, possible_scope }];
}

function mechanismApplicability(
  applicability: PriceApplicability,
  mechanism: Mechanism,
): PriceApplicability | undefined {
  const any_of = applicability.any_of.flatMap(({ all_of }) => {
    const tier = all_of.find(isServiceTier);
    const batch =
      tier?.kind === "categorical" && tier.values.some(({ value }) => value === "batch");
    if ((mechanism === "batch") !== batch) return [];
    return [{ all_of: tier === undefined ? all_of : all_of.filter((item) => item !== tier) }];
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

function modelBinding(
  book: AtomicPricingBook,
  meter: PriceMeter,
  variant: AtomicRateVariant,
  mechanism: Mechanism,
  model: PublishedPricingModel | undefined,
  inputIndex: PricingInputIndex,
): ChargeBinding | undefined {
  if (meter.namespace !== "kmodels" || !isStandardUnit(variant.price.per, "token")) return;
  const modelRef = book.scope.kind === "models" ? book.scope.model_refs[0] : undefined;
  if (modelRef === undefined) return;
  const signal = modelSignal(modelRef, meter);
  if (signal === undefined) return;
  if (mechanism === "batch") {
    if (modelRef.endsWith("/kimi-k2.7-code")) return;
    const mapped =
      signal.value === "output_tokens"
        ? directMethods(signal, ["batch.result.output_tokens"], inputIndex)
        : emptyMethods();
    return standardBinding(signal, "result_item", variant.observation, mapped);
  }
  return standardBinding(
    signal,
    "request",
    variant.observation,
    synchronousMethods(model, signal, inputIndex),
  );
}

function modelSignal(
  modelRef: string,
  meter: PriceMeter,
): Extract<UsageSignal, { namespace: "kmodels" }> | undefined {
  const value =
    meter.value === "cache_read_text"
      ? "cached_input_tokens"
      : meter.value === "output_text"
        ? "output_tokens"
        : meter.value === "input_text"
          ? modelRef.includes("/moonshot-v1-")
            ? "input_tokens"
            : "uncached_input_tokens"
          : undefined;
  return value === undefined ? undefined : { namespace: "kmodels", value };
}

function standardBinding(
  signal: Extract<UsageSignal, { namespace: "kmodels" }>,
  aggregation: ChargeBinding["aggregation"],
  evidence: RawPriceObservation,
  mapped: MethodsAndFacts,
): ChargeBinding {
  return {
    signal,
    aggregation,
    ...(mapped.methods.length === 0 ? {} : { quantity_methods: mapped.methods }),
    observations: [rawEvidence(evidence), ...mapped.facts.map(pricingInputObservation)].sort(
      compareCanonicalValues,
    ),
  };
}

function synchronousMethods(
  model: PublishedPricingModel | undefined,
  signal: Extract<UsageSignal, { namespace: "kmodels" }>,
  inputIndex: PricingInputIndex,
): MethodsAndFacts {
  const endpoints = new Set(model?.api_endpoints?.map(({ path }) => path) ?? []);
  if (signal.value === "uncached_input_tokens") {
    return mergeMethods([
      subtractionMethod("chat", inputIndex),
      ...(endpoints.has("/v1/responses") ? [subtractionMethod("responses", inputIndex)] : []),
      ...(endpoints.has("/anthropic/v1/messages")
        ? [directMethods(signal, usageKeys("messages", signal.value), inputIndex)]
        : []),
    ]);
  }
  const keys = [
    ...usageKeys("chat", signal.value),
    ...(endpoints.has("/v1/responses") ? usageKeys("responses", signal.value) : []),
    ...(endpoints.has("/anthropic/v1/messages") ? usageKeys("messages", signal.value) : []),
  ];
  return directMethods(signal, keys, inputIndex);
}

function usageKeys(protocol: "chat" | "messages" | "responses", signal: string): string[] {
  return [`${protocol}.${signal}`, `${protocol}.stream.${signal}`];
}

function subtractionMethod(
  protocol: "chat" | "responses",
  inputIndex: PricingInputIndex,
): MethodsAndFacts {
  const totalSignal = standardSignal("input_tokens");
  const cachedSignal = standardSignal("cached_input_tokens");
  const total = pricingInputFacts(inputIndex, usageKeys(protocol, totalSignal.value));
  const cached = pricingInputFacts(inputIndex, usageKeys(protocol, cachedSignal.value));
  if (total.length === 0 || cached.length === 0) return emptyMethods();
  return {
    methods: [
      {
        calculation: {
          nodes: [
            { op: "signal", signal: totalSignal },
            { op: "signal", signal: cachedSignal },
            { op: "subtract_floor_zero", minuend: 0, subtrahend: 1 },
          ],
          result: 2,
        },
        input_sources: [
          ...usageInputSources(totalSignal, total),
          ...usageInputSources(cachedSignal, cached),
        ].sort(compareCanonicalValues),
      },
    ],
    facts: uniquePricingInputFacts([...total, ...cached]),
  };
}

function standardSignal(
  value: "cached_input_tokens" | "input_tokens" | "uncached_input_tokens",
): Extract<UsageSignal, { namespace: "kmodels" }> {
  return { namespace: "kmodels", value };
}

function bindResourceBook(
  book: AtomicPricingBook,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): AtomicPricingBook {
  if (book.scope.kind !== "provider_resource") return book;
  const resourceKey = book.scope.resource_key;
  const offers = book.offers.map((offer) => ({
    ...withSettlement(offer, `Kimi ${book.name ?? book.book_key}`),
    terms: offer.terms.map((term) => {
      if (term.kind !== "rate") return term;
      return {
        ...term,
        variants: term.variants.map((variant) => {
          const charge_binding = resourceBinding(resourceKey, offer, variant, input, inputIndex);
          const selector_sources = selectorSources(variant.applicability, inputIndex);
          return {
            ...variant,
            ...(charge_binding === undefined ? {} : { charge_binding }),
            ...(selector_sources.length === 0 ? {} : { selector_sources }),
          };
        }),
      };
    }),
  }));
  return { ...book, offers };
}

function resourceBinding(
  resourceKey: string,
  offer: AtomicPricingOffer,
  variant: AtomicRateVariant,
  input: AtomicProviderPricing,
  inputIndex: PricingInputIndex,
): ChargeBinding | undefined {
  if (resourceKey !== "web-search" || !isStandardUnit(variant.price.per, "event")) return;
  const formula = offer.offer_key === "formula";
  return providerBinding(
    input,
    formula ? "formula_web_search_fiber_executions" : "emitted_builtin_web_search_calls",
    formula
      ? "Created moonshot/web-search:latest Fiber executions"
      : "Exact emitted $web_search items in responses whose finish_reason is tool_calls",
    variant.price.per,
    formula ? "resource" : "request",
    variant.observation,
    formula ? ["web_search.formula.created_fibers"] : ["web_search.chat.billable_calls"],
    "outcome",
    inputIndex,
  );
}

function bindResourceRelations(
  book: AtomicPricingBook,
  modelOffers: ReadonlyMap<string, ModelOffers>,
): void {
  if (book.scope.kind !== "provider_resource") return;
  const resourceKey = book.scope.resource_key;
  for (const offer of book.offers) {
    if (resourceKey === "web-search" && offer.offer_key.startsWith("built-in:")) {
      const target = modelOffers.get(offer.offer_key.slice("built-in:".length))?.sync;
      if (target !== undefined)
        offer.relations.push(
          relation(
            offer,
            "requires",
            [target],
            "Built-in web search adds to the exact synchronous model inference charge",
          ),
        );
      continue;
    }
    const targets = book.scope.model_refs.flatMap((modelRef) => {
      const current = modelOffers.get(modelRef);
      return resourceKey === "files"
        ? [current?.sync, current?.batch].filter((ref): ref is string => ref !== undefined)
        : current?.sync === undefined
          ? []
          : [current.sync];
    });
    if (targets.length > 0)
      offer.relations.push(
        relation(
          offer,
          "compatible_with",
          targets,
          resourceKey === "files"
            ? "Files can supply exact synchronous or Batch workflows while model usage remains separate"
            : "Formula execution is independently callable and compatible with the documented model loop",
        ),
      );
  }
}

function providerBinding(
  input: AtomicProviderPricing,
  key: string,
  definition: string,
  unit: UnitExpression,
  aggregation: ChargeBinding["aggregation"],
  evidence: RawPriceObservation,
  inputKeys: readonly string[],
  resolutionPhase: "outcome" | "account",
  inputIndex: PricingInputIndex,
): ChargeBinding {
  addAtom(input, {
    kind: "usage_signal",
    key,
    definition,
    unit,
    resolution_phase: resolutionPhase,
  });
  const signal = { namespace: "provider", provider_id: input.provider_id, value: key } as const;
  const mapped = directMethods(signal, inputKeys, inputIndex);
  return {
    signal,
    aggregation,
    ...(mapped.methods.length === 0 ? {} : { quantity_methods: mapped.methods }),
    observations: [rawEvidence(evidence), ...mapped.facts.map(pricingInputObservation)].sort(
      compareCanonicalValues,
    ),
  };
}

function selectorSources(
  applicability: PriceApplicability,
  inputIndex: PricingInputIndex,
): PriceSelectorSource[] {
  const condition = applicability.any_of
    .flatMap(({ all_of }) => all_of)
    .find(
      (candidate) =>
        candidate.kind === "categorical" &&
        candidate.dimension.namespace === "kmodels" &&
        candidate.dimension.value === "region",
    );
  if (condition?.kind !== "categorical") return [];
  return uniqueCanonical(
    condition.values.flatMap((value) => {
      const region = regionSelector(value);
      if (region === undefined) return [];
      return pricingInputFacts(inputIndex, [`request.api_origin.${region.key}`]).map((fact) => ({
        dimension: condition.dimension,
        channel: fact.channel,
        locator: fact.locator,
        availability: fact.availability,
        normalization: {
          kind: "categorical_map" as const,
          entries: [{ source_value: region.origin, value }],
        },
        observations: [pricingInputObservation(fact)],
      }));
    }),
  );
}

function regionSelector(
  value: PriceCategoricalValue,
): { key: "china" | "international"; origin: string } | undefined {
  const key = value.value.toLowerCase();
  if (key === "china") return { key: "china", origin: "https://api.moonshot.cn" };
  if (key === "international") return { key: "international", origin: "https://api.moonshot.ai" };
}

function withSettlement(offer: AtomicPricingOffer, label: string): AtomicPricingOffer {
  const evidence = offerEvidence(offer);
  return {
    ...offer,
    settlement: [
      {
        channel: "direct",
        biller: "Moonshot AI",
        payment_sources: ["prepaid_balance", "provider_credit", "postpaid_invoice"],
        applicability: unconditionalApplicability,
        observations: [
          {
            ...rawEvidence(evidence),
            raw: { label: `${label} settles directly through the selected regional Kimi account` },
            establishes_applicability: unconditionalApplicability,
          },
        ],
      },
    ],
  };
}

function hasCommercialContent(offer: AtomicPricingOffer | undefined): offer is AtomicPricingOffer {
  return offer !== undefined && (offer.states.length > 0 || offer.terms.length > 0);
}
