import {
  applicabilitiesOverlap,
  unconditionalApplicability,
} from "../src/catalog/pricing-canonical.ts";
import type {
  PricingOffer,
  PricingTerm,
  PriceApplicability,
} from "../src/catalog/pricing-schema.ts";
import type { PriceDataOffer, Selector } from "../src/pricing/schema.ts";

export function executionSelector(value: "request" | "batch" | "realtime"): Selector {
  return {
    kind: "categorical",
    dimension: { namespace: "kmodels", value: "execution" },
    value: { namespace: "kmodels", value },
  };
}

export function executionScope(value: "request" | "batch" | "realtime"): PriceApplicability {
  return {
    any_of: [
      {
        all_of: [
          {
            kind: "categorical",
            dimension: { namespace: "kmodels", value: "execution" },
            values: [{ namespace: "kmodels", value }],
          },
        ],
      },
    ],
  };
}

/** Inspect a source tariff branch while retaining its published relationship ID and predicates. */
export function priceContexts(offer: PriceDataOffer) {
  const scopes = offer.terms.flatMap((term) =>
    term.kind === "raw"
      ? term.variants.map((v) => v.possible_scope ?? unconditionalApplicability)
      : [
          ...term.variants.map((v) => v.applicability),
          ...term.raw_variants.map((v) => v.possible_scope ?? unconditionalApplicability),
        ],
  );
  const keys = [
    ...new Set([
      offer.offer_key,
      ...scopes.flatMap((scope) =>
        scope.any_of.flatMap((c) =>
          c.all_of.flatMap((condition) =>
            condition.kind === "categorical" && condition.dimension.value === "invocation_mode"
              ? condition.values.map((v) => v.value)
              : condition.kind === "categorical" && condition.dimension.value === "execution"
                ? condition.values.flatMap((v) =>
                    v.value === "batch"
                      ? ["batch"]
                      : v.value === "request"
                        ? ["sync", "on-demand", "direct", "usage"]
                        : ["sync", "realtime"],
                  )
                : [],
          ),
        ),
      ),
      ...offer.terms.flatMap((term) =>
        term.term_key.includes("/") ? [term.term_key.split("/")[0] ?? offer.offer_key] : [],
      ),
    ]),
  ];
  return (keys.length ? keys : [offer.offer_key]).map((key) => ({
    ...offer,
    context_key: key,
    terms: offer.terms.filter((term) =>
      (term.kind === "raw"
        ? term.variants.map((v) => v.possible_scope ?? unconditionalApplicability)
        : [
            ...term.variants.map((v) => v.applicability),
            ...term.raw_variants.map((v) => v.possible_scope ?? unconditionalApplicability),
          ]
      ).some((scope) =>
        scope.any_of.some(
          (clause) =>
            clause.all_of.every(
              (c) =>
                c.kind !== "categorical" ||
                c.dimension.value !== "invocation_mode" ||
                c.values.some((v) => v.value === key),
            ) &&
            applicabilitiesOverlap(
              { any_of: [clause] },
              key === "batch"
                ? executionScope("batch")
                : {
                    any_of: [
                      ...executionScope("request").any_of,
                      ...executionScope("realtime").any_of,
                    ],
                  },
            ),
        ),
      ),
    ),
  }));
}

export function offerContexts(offer: PricingOffer) {
  return (
    offer.source_contexts ?? [{ key: offer.offer_key, applicability: unconditionalApplicability }]
  ).map((context) => {
    const relevant = (scope: PriceApplicability) =>
      applicabilitiesOverlap(scope, context.applicability);
    const terms: PricingTerm[] = offer.terms
      .map((term) => {
        if (term.kind === "raw")
          return {
            ...term,
            variants: term.variants.filter((v) =>
              relevant(v.possible_scope ?? unconditionalApplicability),
            ),
          };
        const raw_variants = term.raw_variants.filter((v) =>
          relevant(v.possible_scope ?? unconditionalApplicability),
        );
        if (term.kind === "rate")
          return {
            ...term,
            variants: term.variants.filter((v) => relevant(v.applicability)),
            raw_variants,
          };
        if (term.kind === "allowance")
          return {
            ...term,
            variants: term.variants.filter((v) => relevant(v.applicability)),
            raw_variants,
          };
        return {
          ...term,
          variants: term.variants.filter((v) => relevant(v.applicability)),
          raw_variants,
        };
      })
      .filter(
        (term) => term.variants.length > 0 || (term.kind !== "raw" && term.raw_variants.length > 0),
      );
    return {
      ...offer,
      context_key: context.key,
      context_model_refs: [
        ...new Set(
          context.applicability.any_of.flatMap((clause) =>
            clause.all_of.flatMap((c) =>
              c.kind === "categorical" &&
              c.dimension.namespace === "kmodels" &&
              c.dimension.value === "model"
                ? c.values.map((v) => v.value)
                : [],
            ),
          ),
        ),
      ],
      terms,
      states: offer.states.filter((v) => relevant(v.applicability)),
    };
  });
}
