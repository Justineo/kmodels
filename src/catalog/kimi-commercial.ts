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
import { canonicalizeApplicability } from "./pricing-canonical.ts";
import {
  addAtom,
  isStandardUnit,
  rawEvidence,
  relation,
  withApplicability,
} from "./pricing-commercial-assembly.ts";
import { pricingBookId, pricingOfferId } from "./pricing-identifiers.ts";
import { kimiTokenSignal } from "./kimi-commercial-source.ts";
import {
  calculatedQuantityMethods,
  subtractQuantityMethods,
  directQuantityMethods as directMethods,
  emptyQuantityMethods as emptyMethods,
  includePricingInputSourceRefs,
  indexPricingInputs,
  mergeQuantityMethods as mergeMethods,
  pricingInputFacts,
  pricingInputObservation,
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
    if (offer.offer_key !== "usage") return [{ ...offer, settlement: [] }];
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
  return {
    ...offer,
    offer_key: mechanism,
    name: mechanism === "batch" ? "Batch inference" : "Synchronous inference",
    states,
    terms,
    relations: [],
    settlement: [],
  };
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
  const signal = kimiTokenSignal(modelRef, meter.value);
  if (signal === undefined) return;
  if (mechanism === "batch") {
    return (
      variant.charge_binding ??
      standardBinding(signal, "result_item", variant.observation, emptyMethods())
    );
  }
  return standardBinding(
    signal,
    "request",
    variant.observation,
    synchronousMethods(
      model,
      signal,
      regionalInputs(variant.applicability, inputIndex),
      book.offers.some(({ terms }) =>
        terms.some(
          (term) =>
            term.kind === "rate" &&
            term.meter.namespace === "kmodels" &&
            term.meter.value === "cache_write_text" &&
            term.variants.some(
              (write) => write.observation.source_ref === variant.observation.source_ref,
            ),
        ),
      ),
    ),
  );
}

function regionalInputs(
  applicability: PriceApplicability,
  inputIndex: PricingInputIndex,
): PricingInputIndex {
  const sources = new Set(
    applicability.any_of.flatMap(({ all_of }) =>
      all_of.flatMap((condition) =>
        condition.kind === "categorical" &&
        condition.dimension.namespace === "kmodels" &&
        condition.dimension.value === "region"
          ? condition.values.flatMap((value) => {
              const region = regionSelector(value);
              return region === undefined
                ? []
                : pricingInputFacts(inputIndex, [`request.api_origin.${region.key}`]).map(
                    ({ source_ref }) => source_ref,
                  );
            })
          : [],
      ),
    ),
  );
  return sourceInputs(inputIndex, sources);
}

function sourceInputs(
  inputIndex: PricingInputIndex,
  sources: ReadonlySet<string>,
): PricingInputIndex {
  return indexPricingInputs(
    [...inputIndex.values()].flat().filter(({ source_ref }) => sources.has(source_ref)),
  );
}

function standardBinding(
  signal: UsageSignal,
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
  separateWrites: boolean,
): MethodsAndFacts {
  const endpoints = new Set(model?.api_endpoints?.map(({ path }) => path) ?? []);
  if (signal.value === "uncached_input_tokens") {
    return mergeMethods([
      separateWrites
        ? cachePartitionMethod(model?.uid, inputIndex)
        : subtractionMethod("chat", inputIndex, model?.uid),
      ...(endpoints.has("/v1/responses") && !separateWrites
        ? [subtractionMethod("responses", inputIndex, model?.uid)]
        : []),
      ...(endpoints.has("/anthropic/v1/messages")
        ? [
            directMethods(
              signal,
              separateWrites
                ? [
                    "messages.uncached_input_tokens.excludes_cache_writes",
                    "messages.stream.uncached_input_tokens.excludes_cache_writes",
                  ]
                : usageKeys("messages", signal.value),
              inputIndex,
              model?.uid,
            ),
          ]
        : []),
    ]);
  }
  const keys = [
    ...usageKeys("chat", signal.value),
    ...(endpoints.has("/v1/responses") ? usageKeys("responses", signal.value) : []),
    ...(endpoints.has("/anthropic/v1/messages") ? usageKeys("messages", signal.value) : []),
  ];
  return directMethods(signal, keys, inputIndex, model?.uid);
}

function cachePartitionMethod(
  modelRef: string | undefined,
  inputIndex: PricingInputIndex,
): MethodsAndFacts {
  const total = { namespace: "kmodels", value: "input_tokens" } as const;
  const cached = { namespace: "kmodels", value: "cached_input_tokens" } as const;
  const written = { namespace: "kmodels", value: "cache_write_tokens" } as const;
  const totals = pricingInputFacts(
    inputIndex,
    ["chat.input_tokens.cache_write_partition", "chat.stream.input_tokens.cache_write_partition"],
    modelRef,
  );
  if (totals.length === 0) return emptyMethods();
  return calculatedQuantityMethods(
    {
      nodes: [
        { op: "signal", signal: total },
        { op: "signal", signal: cached },
        { op: "signal", signal: written },
        { op: "sum", inputs: [1, 2] },
        { op: "subtract_floor_zero", minuend: 0, subtrahend: 3 },
      ],
      result: 4,
    },
    [
      { signal: total, facts: totals },
      {
        signal: cached,
        facts: pricingInputFacts(inputIndex, usageKeys("chat", "cached_input_tokens"), modelRef),
      },
      {
        signal: written,
        facts: pricingInputFacts(inputIndex, usageKeys("chat", "cache_write_tokens"), modelRef),
      },
    ],
  );
}

function usageKeys(protocol: "chat" | "messages" | "responses", signal: string): string[] {
  const keys = [`${protocol}.${signal}`, `${protocol}.stream.${signal}`];
  if (protocol === "chat" && signal === "input_tokens")
    keys.push(
      "chat.input_tokens.cache_write_partition",
      "chat.stream.input_tokens.cache_write_partition",
    );
  if (protocol === "messages" && signal === "uncached_input_tokens")
    keys.push(
      "messages.uncached_input_tokens.excludes_cache_writes",
      "messages.stream.uncached_input_tokens.excludes_cache_writes",
    );
  return keys;
}

function subtractionMethod(
  protocol: "chat" | "responses",
  inputIndex: PricingInputIndex,
  modelRef: string | undefined,
): MethodsAndFacts {
  const totalSignal = standardSignal("input_tokens");
  const cachedSignal = standardSignal("cached_input_tokens");
  return subtractQuantityMethods(
    totalSignal,
    usageKeys(protocol, totalSignal.value),
    cachedSignal,
    usageKeys(protocol, cachedSignal.value),
    inputIndex,
    modelRef,
  );
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
    ...offer,
    settlement: [],
    terms: offer.terms.map((term) => {
      if (term.kind !== "rate") return term;
      return {
        ...term,
        variants: term.variants.map((variant) => {
          const charge_binding = resourceBinding(
            resourceKey,
            offer,
            variant,
            input,
            sourceInputs(inputIndex, new Set([variant.observation.source_ref])),
          );
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
  if (
    ["web-search-basic", "web-search-pro", "web-fetch"].includes(resourceKey) &&
    isStandardUnit(variant.price.per, "event")
  ) {
    const fetch = resourceKey === "web-fetch";
    const endpoint = fetch ? "fetch" : resourceKey === "web-search-pro" ? "search_pro" : "search";
    return providerBinding(
      input,
      `successful_rest_${endpoint}_calls`,
      `POST /v1/tools/${endpoint} calls returning HTTP 200 and ${fetch ? "non-blank markdown" : "non-empty search_results"}; failed or empty results are not billable`,
      variant.price.per,
      "request",
      variant.observation,
      [],
      inputIndex,
    );
  }
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
  inputIndex: PricingInputIndex,
): ChargeBinding {
  addAtom(input, {
    kind: "usage_signal",
    key,
    definition,
    unit,
    resolution_phase: "outcome",
  });
  const signal = { namespace: "provider", provider_id: input.provider_id, value: key } as const;
  return standardBinding(
    signal,
    aggregation,
    evidence,
    directMethods(signal, inputKeys, inputIndex),
  );
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

function hasCommercialContent(offer: AtomicPricingOffer | undefined): offer is AtomicPricingOffer {
  return offer !== undefined && (offer.states.length > 0 || offer.terms.length > 0);
}
