import { canonicalJson } from "./canonical-json.ts";
import type {
  AtomicPricingTerm,
  AtomicPricingOffer,
  AtomicProviderPricing,
  AtomicRateVariant,
} from "./pricing-assembly.ts";
import { unconditionalApplicability } from "./pricing-canonical.ts";
import type {
  OfferRelation,
  NormalizedPriceObservation,
  PriceApplicability,
  PriceMeter,
  ProviderAtomRegistryEntry,
  RawPriceObservation,
  UnitExpression,
} from "./pricing-schema.ts";

export function relation(
  offer: AtomicPricingOffer,
  kind: OfferRelation["kind"],
  targets: string[],
  label: string,
  applicability: PriceApplicability = unconditionalApplicability,
): OfferRelation {
  const offerRefs = [...new Set(targets)].sort();
  return {
    kind,
    target: { kind: "offers", offer_refs: offerRefs },
    applicability,
    observations: [
      {
        ...rawEvidence(offerEvidence(offer)),
        raw: { label },
        establishes_offer_refs: offerRefs,
        establishes_book_refs: [],
      },
    ],
  };
}

export function offerEvidence(offer: AtomicPricingOffer | undefined): RawPriceObservation {
  const observation =
    offer?.states[0]?.observation ??
    offer?.terms.flatMap((term) =>
      term.kind === "raw"
        ? term.variants.map(({ observation }) => observation)
        : [...term.variants, ...term.raw_variants].map(({ observation }) => observation),
    )[0];
  if (observation === undefined) throw new Error("Commercial offer has no pricing evidence");
  return rawEvidence(observation);
}

export function rawEvidence(observation: RawPriceObservation): RawPriceObservation {
  return { source_ref: observation.source_ref, locator: observation.locator, raw: observation.raw };
}

export function providerKeyEvidence(
  observation: RawPriceObservation,
  value: string,
): RawPriceObservation {
  return { ...rawEvidence(observation), locator: { kind: "provider_key", value } };
}

export function withApplicability(
  observation: NormalizedPriceObservation,
  applicability: PriceApplicability,
): NormalizedPriceObservation {
  return { ...observation, establishes_applicability: applicability };
}

export function accountingGaps(terms: readonly AtomicPricingTerm[]): Set<string> {
  const prefix = "accounting_binding_unavailable:";
  return new Set(
    terms.flatMap(({ term_key }) =>
      term_key.startsWith(prefix) ? [term_key.slice(prefix.length)] : [],
    ),
  );
}

export function bindRateTerm(
  term: AtomicPricingTerm,
  binding: (meter: PriceMeter, variant: AtomicRateVariant) => AtomicRateVariant["charge_binding"],
): AtomicPricingTerm {
  if (term.kind !== "rate") return term;
  return {
    ...term,
    variants: term.variants.map((variant) => {
      const charge_binding = binding(term.meter, variant);
      return charge_binding === undefined ? variant : { ...variant, charge_binding };
    }),
  };
}

export function stripAccountingGaps(terms: readonly AtomicPricingTerm[]): AtomicPricingTerm[] {
  return terms.filter(({ term_key }) => !term_key.startsWith("accounting_binding_unavailable:"));
}

export function addAtom(input: AtomicProviderPricing, atom: ProviderAtomRegistryEntry): void {
  const identity = atomIdentity(atom);
  const current = input.vocabulary.atoms.find((candidate) => atomIdentity(candidate) === identity);
  if (current === undefined) input.vocabulary.atoms.push(atom);
  else if (canonicalJson(current) !== canonicalJson(atom))
    throw new Error(`${input.provider_id} pricing atom ${atom.key} changed definition`);
}

function atomIdentity(atom: ProviderAtomRegistryEntry): string {
  return canonicalJson([
    atom.kind,
    atom.key,
    atom.kind === "categorical_value" ? atom.dimension : 0,
  ]);
}

export function isStandardUnit(unit: UnitExpression, value: string): boolean {
  return (
    unit.factors.length === 1 &&
    unit.factors[0]?.power === 1 &&
    unit.factors[0].unit.namespace === "kmodels" &&
    unit.factors[0].unit.value === value
  );
}

export function unitIdentityKey(unit: UnitExpression): string {
  return unit.factors
    .map(({ unit: factor, power }) => [factor.namespace, factor.value, `p${power}`].join("_"))
    .join("_");
}
