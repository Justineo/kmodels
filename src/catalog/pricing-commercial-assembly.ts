import { canonicalJson } from "./canonical-json.ts";
import type {
  AtomicPricingOffer,
  AtomicPricingTerm,
  AtomicProviderPricing,
} from "./pricing-assembly.ts";
import { unconditionalApplicability } from "./pricing-canonical.ts";
import type {
  OfferRelation,
  PriceApplicability,
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

export function accountingGaps(terms: readonly AtomicPricingTerm[]): Set<string> {
  const prefix = "accounting_binding_unavailable:";
  return new Set(
    terms.flatMap(({ term_key }) =>
      term_key.startsWith(prefix) ? [term_key.slice(prefix.length)] : [],
    ),
  );
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
