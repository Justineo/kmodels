import type {
  InferenceMatchData,
  InferenceMatchTerm,
} from "../pricing/inference-matching-schema.ts";
import type { PriceApplicability, PriceCondition } from "./pricing-schema.ts";
import type { WebsiteInferencePrice, WebsiteStoredModelDetail } from "./website-schema.ts";

type StoredPrice = NonNullable<WebsiteStoredModelDetail["inference_prices"]>[number];
type StoredMatching = NonNullable<StoredPrice["matching"]>;
type StoredTerm = NonNullable<StoredMatching["referenced_rates"]>[number];
type StoredCondition = NonNullable<StoredPrice["matching_conditions"]>[number];
type Atom<T extends string> =
  | { namespace: "kmodels"; value: T }
  | { namespace: "provider"; provider_id: string; value: string };

function storeAtom<T extends string>(atom: Atom<T>): T | [string, string] {
  return atom.namespace === "kmodels" ? atom.value : [atom.provider_id, atom.value];
}

function restoreAtom<T extends string>(value: T | [string, string]): Atom<T> {
  return typeof value === "string"
    ? { namespace: "kmodels", value }
    : { namespace: "provider", provider_id: value[0], value: value[1] };
}

function storeCondition(value: PriceCondition): StoredCondition {
  const dimension = storeAtom(value.dimension);
  switch (value.kind) {
    case "categorical":
      return [0, dimension, value.values.map(storeAtom)];
    case "boolean":
      return [1, dimension, value.value];
    case "decimal_range":
      return [2, dimension, value.unit, value.lower ?? null, value.upper ?? null];
  }
}

function restoreCondition(value: StoredCondition): PriceCondition {
  const dimension = restoreAtom(value[1]);
  switch (value[0]) {
    case 0:
      return { kind: "categorical", dimension, values: value[2].map(restoreAtom) };
    case 1:
      return { kind: "boolean", dimension, value: value[2] };
    case 2:
      return {
        kind: "decimal_range",
        dimension,
        unit: value[2],
        ...(value[3] === null ? {} : { lower: value[3] }),
        ...(value[4] === null ? {} : { upper: value[4] }),
      };
  }
}

function storeMatching(matching: InferenceMatchData) {
  const conditions: PriceCondition[] = [];
  const conditionKeys = new Map<string, number>();
  const applicabilities: number[][][] = [];
  const applicabilityKeys = new Map<string, number>();
  function applicability(value: PriceApplicability): number {
    const key = JSON.stringify(value);
    const existing = applicabilityKeys.get(key);
    if (existing !== undefined) return existing;
    const index = applicabilities.length;
    applicabilityKeys.set(key, index);
    applicabilities.push(
      value.any_of.map(({ all_of }) =>
        all_of.map((condition) => {
          const key = JSON.stringify(condition);
          let index = conditionKeys.get(key);
          if (index === undefined) {
            index = conditions.length;
            conditionKeys.set(key, index);
            conditions.push(condition);
          }
          return index;
        }),
      ),
    );
    return index;
  }
  function variant(value: InferenceMatchTerm["variants"][number]): StoredTerm["variants"][number] {
    return [
      value.semantics,
      applicability(value.applicability),
      value.validity ?? null,
      value.target_rate_refs ?? null,
    ];
  }
  function term(value: InferenceMatchTerm): StoredTerm {
    return {
      ...value,
      variants: value.variants.map(variant),
      raw_variants: value.raw_variants.map((raw) => [
        raw.impact,
        raw.reason,
        raw.possible_scope === undefined ? null : applicability(raw.possible_scope),
        raw.validity ?? null,
      ]),
    };
  }
  const { referenced_rates, ...base } = matching;
  const stored: StoredMatching = {
    ...base,
    offers: matching.offers.map((offer) => ({
      ...offer,
      states: offer.states.map((state) => [
        state.state,
        state.semantics,
        applicability(state.applicability),
        state.validity ?? null,
      ]),
      relations: offer.relations.map(variant),
      terms: offer.terms.map(term),
    })),
    ...(referenced_rates.length === 0 ? {} : { referenced_rates: referenced_rates.map(term) }),
  };
  return {
    matching: stored,
    matching_conditions: conditions.map(storeCondition),
    matching_applicabilities: applicabilities,
  };
}

export function storeInferencePrices(prices: readonly WebsiteInferencePrice[]): StoredPrice[] {
  const shared = new Map<string, number>();
  const stored: StoredPrice[] = prices.map((price, index) => {
    const { matching, ...base } = price;
    if (matching === undefined) return base;
    const { rules: _rules, ...data } = matching;
    const key = JSON.stringify(data);
    const reference = shared.get(key);
    if (reference === undefined) {
      shared.set(key, index);
      return { ...base, ...storeMatching(matching) };
    }
    const { referenced_rates: _referencedRates, ...sharedMatching } = matching;
    return {
      ...price,
      matching: { ...sharedMatching, offers: [] },
      matching_ref: reference,
    };
  });
  const options = new Map<string, number>();
  return stored.map((price, index) => {
    if (price.pricing_options === undefined) return price;
    const key = JSON.stringify(price.pricing_options);
    const reference = options.get(key);
    if (reference === undefined || key.length < 24) {
      options.set(key, index);
      return price;
    }
    const { pricing_options: _options, ...base } = price;
    return { ...base, pricing_options_ref: reference };
  });
}

function restoreMatching(price: StoredPrice): InferenceMatchData | undefined {
  const {
    matching,
    matching_conditions: conditions,
    matching_applicabilities: applicabilities,
  } = price;
  if (matching === undefined) {
    if (conditions !== undefined || applicabilities !== undefined)
      throw new Error("Inference price applicability dictionary has no matcher");
    return;
  }
  function applicability(index: number): PriceApplicability {
    const entry = applicabilities?.[index];
    if (entry === undefined) throw new Error("Inference price applicability reference is invalid");
    return {
      any_of: entry.map((clause) => ({
        all_of: clause.map((index) => {
          const condition = conditions?.[index];
          if (condition === undefined)
            throw new Error("Inference price condition reference is invalid");
          return restoreCondition(condition);
        }),
      })),
    };
  }
  function variant([
    semantics,
    index,
    validity,
    refs,
  ]: StoredTerm["variants"][number]): InferenceMatchTerm["variants"][number] {
    return {
      semantics,
      applicability: applicability(index),
      ...(validity === null ? {} : { validity }),
      ...(refs === null ? {} : { target_rate_refs: refs }),
    };
  }
  function term(value: StoredTerm): InferenceMatchTerm {
    return {
      ...value,
      variants: value.variants.map(variant),
      raw_variants: value.raw_variants.map(([impact, reason, index, validity]) => ({
        impact,
        reason,
        ...(index === null ? {} : { possible_scope: applicability(index) }),
        ...(validity === null ? {} : { validity }),
      })),
    };
  }
  return {
    ...matching,
    offers: matching.offers.map((offer) => ({
      ...offer,
      states: offer.states.map(([state, semantics, index, validity]) => ({
        state,
        semantics,
        applicability: applicability(index),
        ...(validity === null ? {} : { validity }),
      })),
      relations: offer.relations.map(variant),
      terms: offer.terms.map(term),
    })),
    referenced_rates: (matching.referenced_rates ?? []).map(term),
  };
}

export function restoreInferencePrices(prices: readonly StoredPrice[]): WebsiteInferencePrice[] {
  const restored: WebsiteInferencePrice[] = [];
  for (const [index, stored] of prices.entries()) {
    const {
      matching_ref,
      matching_conditions,
      matching_applicabilities,
      matching: _matching,
      pricing_options_ref,
      pricing_options: storedOptions,
      ...price
    } = stored;
    const shared = matching_ref === undefined ? undefined : restored[matching_ref];
    if (
      matching_ref !== undefined &&
      (matching_ref >= index ||
        shared?.matching === undefined ||
        prices[matching_ref]?.matching_ref !== undefined ||
        stored.matching === undefined ||
        stored.matching.offers.length > 0 ||
        (stored.matching.referenced_rates?.length ?? 0) > 0 ||
        matching_conditions !== undefined ||
        matching_applicabilities !== undefined ||
        stored.matching.generated_at !== shared.matching.generated_at ||
        stored.matching.observed_at !== shared.matching.observed_at)
    )
      throw new Error("Inference price matching reference is invalid");
    const matching =
      shared?.matching === undefined
        ? restoreMatching(stored)
        : { ...shared.matching, rules: stored.matching?.rules ?? [] };
    const pricing_options =
      pricing_options_ref === undefined
        ? storedOptions
        : restored[pricing_options_ref]?.pricing_options;
    if (
      pricing_options_ref !== undefined &&
      (pricing_options_ref >= index ||
        pricing_options === undefined ||
        storedOptions !== undefined ||
        prices[pricing_options_ref]?.pricing_options_ref !== undefined)
    )
      throw new Error("Inference price option reference is invalid");
    restored.push({
      ...price,
      ...(matching === undefined ? {} : { matching }),
      ...(pricing_options === undefined ? {} : { pricing_options }),
    });
  }
  return restored;
}
