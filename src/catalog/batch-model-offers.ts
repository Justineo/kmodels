import type {
  AtomicPricingOffer,
  AtomicPricingTerm,
  AtomicProviderPricing,
  AtomicRawVariant,
  AtomicRateVariant,
} from "./pricing-assembly.ts";
import { canonicalizeApplicability } from "./pricing-canonical.ts";
import { withApplicability } from "./pricing-commercial-assembly.ts";
import type { PriceApplicability } from "./pricing-schema.ts";
import type { SourceInferencePrice } from "./inference-pricing-source.ts";

/** Resolve the source usage container to the independently published canonical mechanisms. */
export function batchInferenceAssociations(
  provider: string,
  fact: SourceInferencePrice,
): SourceInferencePrice[] {
  if (!["vercel", "together"].includes(provider) || fact.offer_key !== "usage") return [fact];
  const operation = fact.fixed_selectors.find(
    ({ dimension }) => dimension.namespace === "kmodels" && dimension.value === "operation",
  );
  if (
    operation !== undefined &&
    (operation.kind !== "categorical" ||
      operation.value.namespace !== "provider" ||
      operation.value.provider_id !== provider ||
      !["batch", provider === "vercel" ? "sync" : "standard"].includes(operation.value.value))
  )
    return [fact];
  const keys =
    operation?.kind === "categorical"
      ? [operation.value.value === "batch" ? "batch" : "usage"]
      : ["usage", "batch"];
  return keys.map((offer_key) => ({
    ...fact,
    offer_key,
    fixed_selectors: fact.fixed_selectors.filter((value) => value !== operation),
  }));
}

/** Vercel and Together publish independent Batch mechanisms in source operation columns. */
export function splitBatchModelOffers(
  input: AtomicProviderPricing,
  requestOperation: "sync" | "standard",
): AtomicProviderPricing {
  const provider = input.provider_id;
  function partition(scope: PriceApplicability, batch: boolean): PriceApplicability | undefined {
    const any_of = scope.any_of.flatMap(({ all_of }) => {
      const operation = all_of.find(
        (condition) =>
          condition.dimension.namespace === "kmodels" && condition.dimension.value === "operation",
      );
      if (operation === undefined) return batch ? [] : [{ all_of }];
      if (operation.kind !== "categorical") return batch ? [] : [{ all_of }];
      const values = operation.values.filter(
        (value) =>
          batch ===
          (value.namespace === "provider" &&
            value.provider_id === provider &&
            value.value === "batch"),
      );
      if (values.length === 0) return [];
      const removesOperation = values.every(
        (value) =>
          value.namespace === "provider" &&
          value.provider_id === provider &&
          ["batch", requestOperation].includes(value.value),
      );
      return [
        {
          all_of: all_of.flatMap((condition) =>
            condition !== operation
              ? [condition]
              : removesOperation
                ? []
                : [{ ...operation, values }],
          ),
        },
      ];
    });
    return any_of.length === 0 ? undefined : canonicalizeApplicability({ any_of });
  }
  function raw(variant: AtomicRawVariant, batch: boolean): AtomicRawVariant[] {
    if (variant.possible_scope === undefined) return [variant];
    const possible_scope = partition(variant.possible_scope, batch);
    return possible_scope === undefined ? [] : [{ ...variant, possible_scope }];
  }
  function rate(variant: AtomicRateVariant, batch: boolean): AtomicRateVariant[] {
    const applicability = partition(variant.applicability, batch);
    if (applicability === undefined) return [];
    const { selector_sources: sources, charge_binding: binding, ...base } = variant;
    const selector_sources = (sources ?? []).flatMap((source) => {
      if (
        batch ||
        (source.dimension.namespace === "kmodels" &&
          source.dimension.value === "operation" &&
          !applicability.any_of.some(({ all_of }) =>
            all_of.some(
              ({ dimension }) =>
                dimension.namespace === "kmodels" && dimension.value === "operation",
            ),
          ))
      )
        return [];
      return [source];
    });
    let charge_binding = binding;
    if (batch && binding !== undefined) {
      const { quantity_methods: methods, ...semantic } = binding;
      // Batch results do not inherit synchronous response/stream or generation-lookup locations.
      const quantity_methods = (methods ?? []).flatMap(({ calculation }) =>
        calculation === undefined ? [] : [{ calculation }],
      );
      charge_binding = {
        ...semantic,
        aggregation: "result_item",
        ...(quantity_methods.length === 0 ? {} : { quantity_methods }),
      };
    }
    return [
      {
        ...base,
        applicability,
        observation: withApplicability(base.observation, applicability),
        ...(charge_binding === undefined ? {} : { charge_binding }),
        ...(selector_sources.length === 0 ? {} : { selector_sources }),
      },
    ];
  }
  function term(value: AtomicPricingTerm, batch: boolean): AtomicPricingTerm[] {
    if (value.kind === "raw") {
      const variants = value.variants.flatMap((variant) => raw(variant, batch));
      return variants.length === 0 ? [] : [{ ...value, variants }];
    }
    if (value.kind !== "rate")
      throw new Error(`${provider} Batch model offer has an unreviewed ${value.kind} term`);
    const variants = value.variants.flatMap((variant) => rate(variant, batch));
    const raw_variants = value.raw_variants.flatMap((variant) => raw(variant, batch));
    return variants.length + raw_variants.length === 0
      ? []
      : [{ ...value, variants, raw_variants }];
  }
  function offer(value: AtomicPricingOffer): AtomicPricingOffer[] {
    if (value.offer_key !== "usage") return [value];
    const scopes = [
      ...value.states.map(({ applicability }) => applicability),
      ...value.terms.flatMap((term) =>
        term.kind === "raw"
          ? term.variants.flatMap(({ possible_scope }) => possible_scope ?? [])
          : [
              ...term.variants.map(({ applicability }) => applicability),
              ...term.raw_variants.flatMap(({ possible_scope }) => possible_scope ?? []),
            ],
      ),
    ];
    if (!scopes.some((scope) => partition(scope, true) !== undefined)) return [value];
    if (
      value.relations.length > 0 ||
      (value.enrollment?.length ?? 0) > 0 ||
      (value.settlement?.length ?? 0) > 0
    )
      throw new Error(`${provider} Batch model offer has unreviewed commercial relations`);
    return [false, true].flatMap((batch) => {
      const states = value.states.flatMap((state) => {
        const applicability = partition(state.applicability, batch);
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
      const terms = value.terms.flatMap((value) => term(value, batch));
      return states.length + terms.length === 0
        ? []
        : [
            {
              ...value,
              offer_key: batch ? "batch" : "usage",
              name: batch ? "Batch inference" : "On-demand inference",
              states,
              terms,
            },
          ];
    });
  }
  return {
    ...input,
    books: input.books.map((book) =>
      book.scope.kind === "models" ? { ...book, offers: book.offers.flatMap(offer) } : book,
    ),
  };
}
