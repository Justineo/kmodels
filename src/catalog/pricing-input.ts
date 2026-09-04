import { compareCanonicalValues, compareUtf8, uniqueCanonicalValues } from "./canonical-value.ts";
import type { AtomicPricingBook } from "./pricing-assembly.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import type {
  RawPriceObservation,
  UsageInputSource,
  UsageQuantityMethod,
  UsageSignal,
} from "./pricing-schema.ts";
import type { SourcePricingInputFact } from "./pricing-source.ts";

export type PricingInputIndex = ReadonlyMap<string, SourcePricingInputFact[]>;

export interface BoundQuantityMethods {
  methods: UsageQuantityMethod[];
  facts: SourcePricingInputFact[];
}

export function emptyQuantityMethods(): BoundQuantityMethods {
  return { methods: [], facts: [] };
}

export function mergeQuantityMethods(
  values: readonly BoundQuantityMethods[],
): BoundQuantityMethods {
  return {
    methods: uniqueCanonicalValues(values.flatMap(({ methods }) => methods)),
    facts: uniquePricingInputFacts(values.flatMap(({ facts }) => facts)),
  };
}

export function indexPricingInputs(inputs: readonly SourcePricingInputFact[]): PricingInputIndex {
  const index = new Map<string, SourcePricingInputFact[]>();
  for (const input of inputs) {
    const values = index.get(input.key);
    if (values === undefined) index.set(input.key, [input]);
    else values.push(input);
  }
  for (const values of index.values()) values.sort(compareCanonicalValues);
  return index;
}

export function pricingInputFacts(
  inputIndex: PricingInputIndex,
  keys: readonly string[],
): SourcePricingInputFact[] {
  return keys.flatMap((key) => inputIndex.get(key) ?? []).sort(compareCanonicalValues);
}

export function usageInputSources(
  signal: UsageSignal,
  facts: readonly SourcePricingInputFact[],
): UsageInputSource[] {
  const sources = facts.map(({ channel, locator, reduction, absent_value, availability }) => ({
    signal,
    channel,
    locator,
    ...(reduction === undefined ? {} : { reduction }),
    ...(absent_value === undefined ? {} : { absent_value }),
    availability,
  }));
  return uniqueCanonicalValues(sources);
}

export function directQuantityMethods(
  signal: UsageSignal,
  keys: readonly string[],
  inputIndex: PricingInputIndex,
): BoundQuantityMethods {
  const facts = pricingInputFacts(inputIndex, keys);
  return facts.length === 0
    ? emptyQuantityMethods()
    : { methods: [{ input_sources: usageInputSources(signal, facts) }], facts };
}

export function subtractQuantityMethods(
  totalSignal: UsageSignal,
  totalKeys: readonly string[],
  excludedSignal: UsageSignal,
  excludedKeys: readonly string[],
  inputIndex: PricingInputIndex,
): BoundQuantityMethods {
  const total = pricingInputFacts(inputIndex, totalKeys);
  const excluded = pricingInputFacts(inputIndex, excludedKeys);
  if (total.length === 0 || excluded.length === 0) return emptyQuantityMethods();
  return {
    methods: [
      {
        calculation: {
          nodes: [
            { op: "signal", signal: totalSignal },
            { op: "signal", signal: excludedSignal },
            { op: "subtract_floor_zero", minuend: 0, subtrahend: 1 },
          ],
          result: 2,
        },
        input_sources: uniqueCanonicalValues([
          ...usageInputSources(totalSignal, total),
          ...usageInputSources(excludedSignal, excluded),
        ]),
      },
    ],
    facts: [...total, ...excluded],
  };
}

export function sumQuantityMethods(
  requirements: ReadonlyArray<{ signal: UsageSignal; keys: readonly string[] }>,
  inputIndex: PricingInputIndex,
): BoundQuantityMethods {
  const mapped = requirements.map(({ signal, keys }) => ({
    signal,
    facts: pricingInputFacts(inputIndex, keys),
  }));
  if (mapped.some(({ facts }) => facts.length === 0)) return emptyQuantityMethods();
  return {
    methods: [
      {
        calculation: {
          nodes: [
            ...mapped.map(({ signal }) => ({ op: "signal" as const, signal })),
            { op: "sum", inputs: mapped.map((_value, index) => index) },
          ],
          result: mapped.length,
        },
        input_sources: uniqueCanonicalValues(
          mapped.flatMap(({ signal, facts }) => usageInputSources(signal, facts)),
        ),
      },
    ],
    facts: mapped.flatMap(({ facts }) => facts),
  };
}

export function pricingInputObservation(fact: SourcePricingInputFact): RawPriceObservation {
  return {
    source_ref: fact.source_ref,
    locator: { kind: "provider_key", value: fact.key },
    raw: {
      fragment: `${fact.channel}:${fact.locator.kind}:${fact.locator.value}${
        fact.reduction === undefined ? "" : `:${fact.reduction.kind}`
      }${fact.absent_value === undefined ? "" : `:absent=${fact.absent_value}`}${
        fact.selector_absent_value === undefined
          ? ""
          : `:selector-absent=${fact.selector_absent_value}`
      }`,
    },
  };
}

export function uniquePricingInputFacts(
  facts: readonly SourcePricingInputFact[],
): SourcePricingInputFact[] {
  return uniqueCanonicalValues(facts);
}

export function finalizePricingInputs(
  facts: readonly SourcePricingInputFact[],
  expected: number,
  label: string,
  onReconciliation?: (item: PricingReconciliationItem) => void,
): SourcePricingInputFact[] {
  const result = uniquePricingInputFacts(facts);
  const complete = result.length === expected;
  onReconciliation?.({
    disposition: complete ? "normalized" : "unbound",
    reason_code: complete ? "pricing_input_contract_bound" : "pricing_input_contract_partial",
    sample: `${result.length}/${expected} ${label}`,
  });
  return result;
}

export function includePricingInputSourceRefs(book: AtomicPricingBook): AtomicPricingBook {
  const offers = book.offers.map((offer) => {
    const terms = offer.terms.map((term) => {
      if (term.kind !== "rate") return term;
      const inputRefs = term.variants.flatMap((variant) => [
        ...(variant.charge_binding?.observations.map(({ source_ref }) => source_ref) ?? []),
        ...(variant.selector_sources?.flatMap(({ observations }) =>
          observations.map(({ source_ref }) => source_ref),
        ) ?? []),
      ]);
      return { ...term, source_refs: sortedUnique([...term.source_refs, ...inputRefs]) };
    });
    return {
      ...offer,
      terms,
      source_refs: sortedUnique([
        ...offer.source_refs,
        ...terms.flatMap(({ source_refs }) => source_refs),
      ]),
    };
  });
  return {
    ...book,
    offers,
    source_refs: sortedUnique([
      ...book.source_refs,
      ...offers.flatMap(({ source_refs }) => source_refs),
    ]),
  };
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort(compareUtf8);
}
