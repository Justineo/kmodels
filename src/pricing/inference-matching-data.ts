import { canonicalJson } from "../catalog/canonical-value.ts";
import type { InferenceMatchData, InferenceMatchTerm } from "./inference-matching-schema.ts";
import { pricingSemantics } from "./selection.ts";
import type { PriceDataProvider, PriceDataTerm } from "./schema.ts";
import { resolveApplicability, resolveSelectionClaim, type PricingSnapshot } from "./snapshot.ts";
import type { PriceMeter, PublishedValidity } from "../catalog/pricing-schema.ts";

export function inferenceMatchData(
  snapshot: PricingSnapshot,
  rules: readonly InferenceMatchData["rules"][number][],
  meter?: PriceMeter,
): InferenceMatchData {
  const includesTerm = (value: PriceDataTerm) =>
    meter === undefined ||
    value.kind === "raw" ||
    (value.kind === "rate" && canonicalJson(value.meter) === canonicalJson(meter));
  const semantics = new Map<string, number>();
  function qualified(
    provider: PriceDataProvider,
    value: { applicability_id: number; validity?: PublishedValidity | undefined },
    meaning: unknown = value,
  ) {
    const key = canonicalJson(pricingSemantics(meaning));
    let index = semantics.get(key);
    if (index === undefined) {
      index = semantics.size;
      semantics.set(key, index);
    }
    return {
      applicability: resolveApplicability(provider, value.applicability_id),
      ...(value.validity === undefined ? {} : { validity: value.validity }),
      semantics: index,
    };
  }
  function term(provider: PriceDataProvider, value: PriceDataTerm): InferenceMatchTerm {
    return {
      id: value.id,
      kind: value.kind,
      variants:
        value.kind === "raw"
          ? []
          : value.variants.map((variant) => ({
              // Accounting metadata does not change the quoted unit price.
              ...qualified(
                provider,
                variant,
                "price" in variant ? { price: variant.price } : variant,
              ),
              ...("target_rate_refs" in variant
                ? { target_rate_refs: variant.target_rate_refs }
                : {}),
            })),
      raw_variants: (value.kind === "raw" ? value.variants : value.raw_variants).map((raw) => ({
        ...(raw.possible_scope_id === undefined
          ? {}
          : { possible_scope: resolveApplicability(provider, raw.possible_scope_id) }),
        ...(raw.validity === undefined ? {} : { validity: raw.validity }),
        impact: raw.impact,
        reason: raw.reason,
      })),
    };
  }
  const offers = [...new Set(rules.flatMap(({ offer_refs }) => offer_refs))].map((ref) => {
    const owner = snapshot.offers.get(ref);
    if (owner === undefined) throw new Error(`Missing mapped offer ${ref}`);
    return owner;
  });
  const rateRefs = new Set(
    offers.flatMap(({ offer }) =>
      offer.terms
        .filter(includesTerm)
        .flatMap((value) =>
          value.kind === "contribution"
            ? value.variants.flatMap(({ target_rate_refs }) => target_rate_refs)
            : [],
        ),
    ),
  );
  return {
    generated_at: snapshot.data.snapshot.generatedAt,
    observed_at: offers[0]?.provider.snapshot.observed_at ?? snapshot.data.snapshot.generatedAt,
    rules: rules.map(({ model_ref, offer_refs, fixed_selectors }) => ({
      ...(model_ref === undefined ? {} : { model_ref }),
      offer_refs,
      fixed_selectors,
    })),
    offers: offers.map(({ provider, offer }) => ({
      id: offer.id,
      selection:
        offer.selection?.map((claim) => {
          const { evidence: _evidence, ...scope } = resolveSelectionClaim(provider, claim);
          return scope;
        }) ?? [],
      states:
        meter !== undefined && !offer.terms.some(includesTerm)
          ? []
          : offer.states.map((state) => ({ ...qualified(provider, state), state: state.state })),
      relations:
        meter === undefined ? offer.relations.map((relation) => qualified(provider, relation)) : [],
      terms: offer.terms.filter(includesTerm).map((value) => term(provider, value)),
    })),
    referenced_rates: [...rateRefs].map((ref) => {
      const rate = snapshot.rates.get(ref);
      if (rate === undefined) throw new Error(`Missing referenced rate ${ref}`);
      return term(rate.provider, rate.term);
    }),
  };
}
