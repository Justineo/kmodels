import { canonicalJson, compareUtf8 } from "./canonical-value.ts";
import type { PriceSelectorSource, PricingOffer } from "./pricing-schema.ts";
import type { CalculationOffer, CalculationRate } from "../pricing/schema.ts";

export type InvocationPriceSelectorContract = Omit<PriceSelectorSource, "observations">;
export type InvocationPriceSelectorSource =
  | PriceSelectorSource
  | NonNullable<CalculationRate["selector_sources"]>[number]
  | InvocationPriceSelectorContract;

export function invocationSelectorContract(
  source: InvocationPriceSelectorSource,
): InvocationPriceSelectorContract {
  if ("observations" in source) {
    const { observations: _observations, ...contract } = source;
    return contract;
  }
  if ("evidence" in source) {
    const { evidence: _evidence, ...contract } = source;
    return contract;
  }
  return source;
}

export function invocationOfferSelectorSources(offer: PricingOffer | CalculationOffer) {
  return offer.terms.flatMap<InvocationPriceSelectorSource>((term) =>
    term.kind === "rate"
      ? term.variants.flatMap<InvocationPriceSelectorSource>(
          (variant) => variant.selector_sources ?? [],
        )
      : [],
  );
}

/** V2 acquisition contracts combine consistent maps for the same field within one offer.
 * Rate-local sources and the legacy publication remain unchanged. */
export function invocationOfferSelectorContracts(
  offer: PricingOffer | CalculationOffer,
): InvocationPriceSelectorContract[] {
  const groups = new Map<string, InvocationPriceSelectorContract[]>();
  for (const source of invocationOfferSelectorSources(offer)) {
    const contract = invocationSelectorContract(source);
    const { normalization: _normalization, ...field } = contract;
    const key = canonicalJson(field);
    const group = groups.get(key) ?? [];
    group.push(contract);
    groups.set(key, group);
  }
  return [...groups]
    .sort(([a], [b]) => compareUtf8(a, b))
    .flatMap(([, group]) => {
      const first = group[0];
      if (first === undefined) return [];
      if (group.every(({ normalization }) => normalization === undefined)) return [first];
      // An unmapped peer or conflicting raw value does not establish one decoding contract.
      if (group.some(({ normalization }) => normalization === undefined)) return [];
      const entries = new Map<
        string,
        NonNullable<PriceSelectorSource["normalization"]>["entries"][number]
      >();
      for (const { normalization } of group)
        for (const entry of normalization?.entries ?? []) {
          const existing = entries.get(entry.source_value);
          if (
            existing !== undefined &&
            canonicalJson(existing.value) !== canonicalJson(entry.value)
          )
            return [];
          entries.set(entry.source_value, entry);
        }
      return [
        {
          ...first,
          normalization: {
            kind: "categorical_map" as const,
            entries: [...entries.values()].sort((a, b) =>
              compareUtf8(a.source_value, b.source_value),
            ),
          },
        },
      ];
    });
}
