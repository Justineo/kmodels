import { canonicalJson } from "../catalog/canonical-value.ts";
import type { InferencePriceMapping } from "./inference-schema.ts";
import type { InferenceMatchData, InferenceMatchTerm } from "./inference-matching-schema.ts";
import { pricingSemantics, type Qualified } from "./selection.ts";
import type { PriceDataTerm } from "./schema.ts";
import type { PricingSnapshot } from "./snapshot.ts";
import type { PriceMeter } from "../catalog/pricing-schema.ts";

export function inferenceMatchData(
  snapshot: PricingSnapshot,
  rules: readonly InferenceMatchData["rules"][number][],
  selections: InferencePriceMapping["offer_selections"] = [],
  meter?: PriceMeter,
): InferenceMatchData {
  const includesTerm = (value: PriceDataTerm) =>
    meter === undefined ||
    value.kind === "raw" ||
    (value.kind === "rate" && canonicalJson(value.meter) === canonicalJson(meter));
  const semantics = new Map<string, number>();
  function qualified(value: Qualified, meaning: unknown = value) {
    const key = canonicalJson(pricingSemantics(meaning));
    let index = semantics.get(key);
    if (index === undefined) {
      index = semantics.size;
      semantics.set(key, index);
    }
    return {
      applicability: value.applicability,
      ...(value.validity === undefined ? {} : { validity: value.validity }),
      semantics: index,
    };
  }
  function term(value: PriceDataTerm): InferenceMatchTerm {
    return {
      id: value.id,
      kind: value.kind,
      variants:
        value.kind === "raw"
          ? []
          : value.variants.map((variant) => ({
              // Accounting metadata does not change the quoted unit price.
              ...qualified(variant, "price" in variant ? { price: variant.price } : variant),
              ...("target_rate_refs" in variant
                ? { target_rate_refs: variant.target_rate_refs }
                : {}),
            })),
      raw_variants: (value.kind === "raw" ? value.variants : value.raw_variants).map((raw) => ({
        ...(raw.possible_scope === undefined ? {} : { possible_scope: raw.possible_scope }),
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
    rules: rules.map(({ model_ref, offer_refs, fixed_selectors, execution_choices }) => ({
      ...(model_ref === undefined ? {} : { model_ref }),
      offer_refs,
      fixed_selectors,
      ...(execution_choices === undefined
        ? {}
        : {
            execution_choices: execution_choices.map(({ mode, offer_ref }) => ({
              mode,
              offer_ref,
            })),
          }),
    })),
    offers: offers.map(({ offer }) => ({
      id: offer.id,
      selection:
        selections
          .find(({ offer_ref }) => offer_ref === offer.id)
          ?.selection.map(({ evidence: _evidence, ...claim }) => claim) ??
        rules.flatMap(({ execution_choices }) =>
          (execution_choices ?? [])
            .filter(({ offer_ref }) => offer_ref === offer.id)
            .map(({ mode }) => ({
              dimension: "execution" as const,
              coverage: "complete" as const,
              applicability: { any_of: [{ all_of: [] }] },
              alternatives: [
                {
                  value: { namespace: "kmodels" as const, value: mode },
                  applicability: { any_of: [{ all_of: [] }] },
                },
              ],
            })),
        ),
      states:
        meter !== undefined && !offer.terms.some(includesTerm)
          ? []
          : offer.states.map((state) => ({ ...qualified(state), state: state.state })),
      relations: meter === undefined ? offer.relations.map((relation) => qualified(relation)) : [],
      terms: offer.terms.filter(includesTerm).map(term),
    })),
    referenced_rates: [...rateRefs].map((ref) => {
      const rate = snapshot.rates.get(ref);
      if (rate === undefined) throw new Error(`Missing referenced rate ${ref}`);
      return term(rate);
    }),
  };
}
