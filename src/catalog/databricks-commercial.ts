import { canonicalJson } from "./canonical-json.ts";
import { compareCanonicalValues } from "./canonical-value.ts";
import type {
  AtomicPricingBook,
  AtomicPricingTerm,
  AtomicProviderPricing,
  AtomicRateVariant,
} from "./pricing-assembly.ts";
import { canonicalizeApplicability } from "./pricing-canonical.ts";
import {
  isStandardUnit,
  rawEvidence,
  standardSignal,
  withApplicability,
} from "./pricing-commercial-assembly.ts";
import {
  emptyQuantityMethods as emptyMethods,
  includePricingInputSourceRefs,
  indexPricingInputs,
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
  PriceCondition,
  PriceDimension,
  PriceMeter,
  PriceSelectorSource,
  NormalizedPriceObservation,
  UsageQuantityNode,
  UsageSignal,
} from "./pricing-schema.ts";
import type { SourcePricingInputFact } from "./pricing-source.ts";
import type { ProviderModel } from "./schema.ts";

type PublishedModel = Pick<ProviderModel, "model_id" | "uid">;

export function applyDatabricksCommercialTopology(
  input: AtomicProviderPricing,
  models: readonly PublishedModel[],
  pricingInputs: readonly SourcePricingInputFact[],
): AtomicProviderPricing {
  const modelByRef = new Map(models.map((model) => [model.uid, model]));
  const inputIndex = indexPricingInputs(uniquePricingInputFacts(pricingInputs));
  return {
    ...input,
    books: input.books
      .flatMap((book) => modelBook(book, modelByRef, inputIndex))
      .map(includePricingInputSourceRefs),
  };
}

function modelBook(
  book: AtomicPricingBook,
  models: ReadonlyMap<string, PublishedModel>,
  inputIndex: PricingInputIndex,
): AtomicPricingBook[] {
  if (book.scope.kind !== "models") return [];
  const model =
    book.scope.model_refs.length === 1 ? models.get(book.scope.model_refs[0]!) : undefined;
  const offers = book.offers.flatMap((offer) => {
    if (offer.offer_key !== "usage") return [];
    const states = offer.states.flatMap((state) => {
      const applicability = inferenceApplicability(state.applicability);
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
    const rateMeters = offer.terms.flatMap((term) => (term.kind === "rate" ? [term.meter] : []));
    const terms = offer.terms.flatMap((term) => inferenceTerm(term, model, inputIndex, rateMeters));
    if (states.length + terms.length === 0) return [];
    return [
      {
        ...offer,
        offer_key: "pay-per-token",
        name: "Pay-per-token inference",
        states,
        terms,
        relations: [],
      },
    ];
  });
  return offers.length === 0 ? [] : [{ ...book, offers }];
}

function inferenceTerm(
  term: AtomicPricingTerm,
  model: PublishedModel | undefined,
  inputIndex: PricingInputIndex,
  rateMeters: readonly PriceMeter[],
): AtomicPricingTerm[] {
  if (term.kind === "raw") {
    if (term.term_key === "batch_inference") return [];
    const variants = term.variants.flatMap((variant) => {
      if (variant.possible_scope === undefined) return [variant];
      const possible_scope = inferenceApplicability(variant.possible_scope);
      return possible_scope === undefined ? [] : [{ ...variant, possible_scope }];
    });
    return variants.length === 0 ? [] : [{ ...term, variants }];
  }
  if (term.kind !== "rate") return [];
  const variants = term.variants.flatMap((variant) => {
    const applicability = inferenceApplicability(variant.applicability);
    if (applicability === undefined) return [];
    const observation = withApplicability(variant.observation, applicability);
    const charge_binding = tokenBinding(
      term.meter,
      variant,
      observation,
      model,
      inputIndex,
      rateMeters,
    );
    const selector_sources = selectorSources(applicability, inputIndex);
    return [
      {
        ...variant,
        applicability,
        observation,
        ...(charge_binding === undefined ? {} : { charge_binding }),
        ...(selector_sources.length === 0 ? {} : { selector_sources }),
      },
    ];
  });
  const raw_variants = term.raw_variants.flatMap((variant) => {
    if (variant.possible_scope === undefined) return [variant];
    const possible_scope = inferenceApplicability(variant.possible_scope);
    return possible_scope === undefined ? [] : [{ ...variant, possible_scope }];
  });
  return variants.length + raw_variants.length === 0 ? [] : [{ ...term, variants, raw_variants }];
}

function inferenceApplicability(applicability: PriceApplicability): PriceApplicability | undefined {
  const any_of = applicability.any_of.flatMap(({ all_of }) => {
    const tiers = all_of.filter(isServiceTier);
    if (tiers.some((condition) => categoricalValue(condition) === "batch")) return [];
    return [{ all_of }];
  });
  return any_of.length === 0 ? undefined : canonicalizeApplicability({ any_of });
}

function isServiceTier(condition: PriceCondition): boolean {
  return (
    condition.kind === "categorical" &&
    condition.dimension.namespace === "kmodels" &&
    condition.dimension.value === "served_service_tier"
  );
}

function categoricalValue(condition: PriceCondition): string | undefined {
  return condition.kind === "categorical" && condition.values.length === 1
    ? condition.values[0]?.value
    : undefined;
}

function tokenBinding(
  meter: PriceMeter,
  variant: AtomicRateVariant,
  observation: NormalizedPriceObservation,
  model: PublishedModel | undefined,
  inputIndex: PricingInputIndex,
  rateMeters: readonly PriceMeter[],
): ChargeBinding | undefined {
  if (!isStandardUnit(variant.price.per, "token") || meter.namespace !== "kmodels") return;
  const signal = meterSignal(meter.value);
  if (signal === undefined) return;
  const mapped = quantityMethods(signal, meter.value, model, inputIndex, rateMeters);
  return {
    signal,
    aggregation: "attempt",
    ...(mapped.methods.length === 0 ? {} : { quantity_methods: mapped.methods }),
    observations: [rawEvidence(observation), ...mapped.facts.map(pricingInputObservation)].sort(
      compareCanonicalValues,
    ),
  };
}

function meterSignal(meter: PriceMeter["value"]): UsageSignal | undefined {
  if (meter === "input_text") return standardSignal("uncached_input_tokens");
  if (meter === "embedding") return standardSignal("input_tokens");
  if (meter === "cache_read_text") return standardSignal("cached_input_tokens");
  if (meter === "cache_write_text") return standardSignal("cache_write_tokens");
  if (meter === "output_text") return standardSignal("output_tokens");
}

function quantityMethods(
  signal: UsageSignal,
  meter: PriceMeter["value"],
  model: PublishedModel | undefined,
  inputIndex: PricingInputIndex,
  rateMeters: readonly PriceMeter[],
): MethodsAndFacts {
  if (meter === "input_text") return inputMethods(signal, model, inputIndex, rateMeters);
  if (meter === "output_text" && hasMeter(rateMeters, "output_image")) return emptyMethods();
  if (meter === "embedding")
    return directMethods(signal, "response.usage.input_tokens", inputIndex);
  if (meter === "output_text")
    return directMethods(signal, "response.usage.output_tokens", inputIndex);
  if (!isClaude(model)) return emptyMethods();
  if (meter === "cache_read_text")
    return directMethods(signal, "response.usage.claude.cache_read_tokens", inputIndex);
  if (meter === "cache_write_text")
    return directMethods(signal, "response.usage.claude.cache_write_tokens", inputIndex);
  return emptyMethods();
}

function inputMethods(
  signal: UsageSignal,
  model: PublishedModel | undefined,
  inputIndex: PricingInputIndex,
  rateMeters: readonly PriceMeter[],
): MethodsAndFacts {
  if (hasMeter(rateMeters, "input_image")) return emptyMethods();
  const partitions = [
    ...(hasMeter(rateMeters, "cache_read_text")
      ? [
          {
            signal: standardSignal("cached_input_tokens"),
            key: "response.usage.claude.cache_read_tokens",
          },
        ]
      : []),
    ...(hasMeter(rateMeters, "cache_write_text")
      ? [
          {
            signal: standardSignal("cache_write_tokens"),
            key: "response.usage.claude.cache_write_tokens",
          },
        ]
      : []),
  ];
  if (partitions.length === 0)
    return directMethods(signal, "response.usage.input_tokens", inputIndex);
  if (!isClaude(model)) return emptyMethods();

  const total = pricingInputFacts(inputIndex, ["response.usage.input_tokens"]);
  const partitionFacts = partitions.map(({ key }) => pricingInputFacts(inputIndex, [key]));
  if (total.length === 0 || partitionFacts.some((facts) => facts.length === 0))
    return emptyMethods();
  const totalSignal = standardSignal("input_tokens");
  const nodes: UsageQuantityNode[] = [{ op: "signal", signal: totalSignal }];
  let result = 0;
  for (const { signal: partition } of partitions) {
    const subtrahend = nodes.length;
    nodes.push({ op: "signal", signal: partition });
    nodes.push({ op: "subtract_floor_zero", minuend: result, subtrahend });
    result = nodes.length - 1;
  }
  const facts = uniquePricingInputFacts([...total, ...partitionFacts.flat()]);
  return {
    methods: [
      {
        calculation: { nodes, result },
        input_sources: [
          ...usageInputSources(totalSignal, total),
          ...partitions.flatMap(({ signal: partition }, index) =>
            usageInputSources(partition, partitionFacts[index] ?? []),
          ),
        ].sort(compareCanonicalValues),
      },
    ],
    facts,
  };
}

function directMethods(
  signal: UsageSignal,
  key: string,
  inputIndex: PricingInputIndex,
): MethodsAndFacts {
  const facts = pricingInputFacts(inputIndex, [key]);
  return facts.length === 0
    ? emptyMethods()
    : { methods: [{ input_sources: usageInputSources(signal, facts) }], facts };
}

function isClaude(model: PublishedModel | undefined): boolean {
  return model?.model_id.startsWith("databricks-claude-") === true;
}

function hasMeter(meters: readonly PriceMeter[], value: string): boolean {
  return meters.some((meter) => meter.namespace === "kmodels" && meter.value === value);
}

function selectorSources(
  applicability: PriceApplicability,
  inputIndex: PricingInputIndex,
): PriceSelectorSource[] {
  const dimensions = new Map<string, PriceDimension>();
  for (const { all_of } of applicability.any_of)
    for (const { dimension } of all_of) dimensions.set(canonicalJson(dimension), dimension);
  return [...dimensions.values()]
    .flatMap((dimension): PriceSelectorSource[] => {
      if (dimension.namespace !== "kmodels") return [];
      if (dimension.value !== "context_tokens") return [];
      return pricingInputFacts(inputIndex, ["response.usage.input_tokens"]).map((fact) => ({
        dimension,
        channel: fact.channel,
        locator: fact.locator,
        availability: fact.availability,
        observations: [pricingInputObservation(fact)],
      }));
    })
    .sort(compareCanonicalValues);
}
