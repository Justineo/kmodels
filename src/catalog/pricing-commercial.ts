import { canonicalJson } from "./canonical-json.ts";
import { compareUtf8 } from "./canonical-value.ts";
import type {
  PriceApplicability,
  PriceCondition,
  PriceDimension,
  PricingCatalog,
  PricingOffer,
  PricingTerm,
  ProviderAtomRegistryEntry,
  RawPriceFact,
  RawPricingVariant,
} from "./pricing-schema.ts";

export interface CommercialPricingProjection {
  provider_atoms: CommercialProviderAtoms[];
  model_dispositions: Array<{ model_ref: string; state: "not_applicable" }>;
  books: CommercialPricingBook[];
}

export interface CommercialProviderAtoms {
  provider_id: string;
  atoms: ProviderAtomRegistryEntry[];
}

export interface CommercialPricingBook {
  id: string;
  provider_id: string;
  book_key: string;
  scope: PricingCatalog["books"][number]["scope"];
  resource_edges: Array<
    Omit<PricingCatalog["books"][number]["resource_edges"][number], "observations">
  >;
  offers: CommercialPricingOffer[];
}

export interface CommercialPricingOffer {
  id: string;
  offer_key: string;
  model_refs?: string[];
  billing_mode: PricingOffer["billing_mode"];
  states: Array<Omit<PricingOffer["states"][number], "observations">>;
  enrollment: Array<Omit<PricingOffer["enrollment"][number], "observations">>;
  terms: CommercialPricingTerm[];
  relations: Array<Omit<PricingOffer["relations"][number], "observations">>;
  settlement: Array<Omit<PricingOffer["settlement"][number], "observations">>;
}

export type CommercialPricingTerm =
  | {
      id: string;
      term_key: string;
      kind: "rate";
      meter: Extract<PricingTerm, { kind: "rate" }>["meter"];
      variants: Array<
        Omit<
          Extract<PricingTerm, { kind: "rate" }>["variants"][number],
          "observations" | "charge_binding"
        > & {
          charge_binding?: Omit<
            NonNullable<
              Extract<PricingTerm, { kind: "rate" }>["variants"][number]["charge_binding"]
            >,
            "observations"
          >;
        }
      >;
      raw_variants: CommercialRawPricingVariant[];
    }
  | {
      id: string;
      term_key: string;
      kind: "contribution";
      variants: Array<
        Omit<
          Extract<PricingTerm, { kind: "contribution" }>["variants"][number],
          "observations" | "charge_bindings"
        > & {
          charge_bindings: Array<
            Omit<
              Extract<
                PricingTerm,
                { kind: "contribution" }
              >["variants"][number]["charge_bindings"][number],
              "observations"
            >
          >;
        }
      >;
      raw_variants: CommercialRawPricingVariant[];
    }
  | {
      id: string;
      term_key: string;
      kind: "allowance";
      variants: Array<
        Omit<Extract<PricingTerm, { kind: "allowance" }>["variants"][number], "observations">
      >;
      raw_variants: CommercialRawPricingVariant[];
    }
  | {
      id: string;
      term_key: string;
      kind: "raw";
      variants: CommercialRawPricingVariant[];
    };

export type CommercialRawPricingVariant = Omit<RawPricingVariant, "observations"> & {
  raw_facts: RawPriceFact[];
};

interface UsedAtoms {
  providerId: string;
  identities: Set<string>;
}

export function commercialPricingProjection(data: PricingCatalog): CommercialPricingProjection {
  const usedByProvider = new Map<string, UsedAtoms>();
  const books = data.books.map((book) => {
    const used = usedAtoms(usedByProvider, book.provider_id);
    if (book.scope.kind === "provider_resource")
      collectAtom(used, "resource_kind", book.scope.resource_kind);
    book.resource_edges.forEach(({ applicability }) => collectApplicability(used, applicability));
    return {
      id: book.id,
      provider_id: book.provider_id,
      book_key: book.book_key,
      scope: book.scope,
      resource_edges: book.resource_edges.map(({ observations: _observations, ...edge }) => edge),
      offers: book.offers.map((offer) => commercialOffer(offer, used)),
    };
  });
  const vocabularies = new Map(
    data.provider_vocabularies.map((vocabulary) => [vocabulary.provider_id, vocabulary]),
  );
  const provider_atoms = [...usedByProvider.values()]
    .map(({ providerId, identities }) => ({
      provider_id: providerId,
      atoms:
        vocabularies
          .get(providerId)
          ?.atoms.filter((atom) => identities.has(atomIdentity(providerId, atom))) ?? [],
    }))
    .filter(({ atoms }) => atoms.length > 0)
    .sort((left, right) => compareUtf8(left.provider_id, right.provider_id));
  for (const group of provider_atoms)
    if (group.atoms.length !== usedByProvider.get(group.provider_id)?.identities.size)
      throw new Error(`Provider ${group.provider_id} uses an unregistered commercial atom`);

  return {
    provider_atoms,
    model_dispositions: data.model_dispositions.map(({ model_ref, state }) => ({
      model_ref,
      state,
    })),
    books,
  };
}

function commercialOffer(offer: PricingOffer, used: UsedAtoms): CommercialPricingOffer {
  collectAtom(used, "billing_mode", offer.billing_mode);
  offer.states.forEach(({ applicability }) => collectApplicability(used, applicability));
  offer.enrollment.forEach(({ applicability }) => collectApplicability(used, applicability));
  offer.relations.forEach(({ applicability }) => collectApplicability(used, applicability));
  offer.settlement.forEach(({ applicability }) => collectApplicability(used, applicability));
  const base = {
    id: offer.id,
    offer_key: offer.offer_key,
    ...(offer.model_refs === undefined ? {} : { model_refs: offer.model_refs }),
    billing_mode: offer.billing_mode,
    states: offer.states.map(({ observations: _observations, ...state }) => state),
    enrollment: offer.enrollment.map(({ observations: _observations, ...variant }) => variant),
    terms: offer.terms.flatMap((term) => {
      const projected = commercialTerm(term, used);
      return projected === undefined ? [] : [projected];
    }),
    relations: offer.relations.map(({ observations: _observations, ...relation }) => relation),
    settlement: offer.settlement.map(({ observations: _observations, ...variant }) => variant),
  };
  return base;
}

function commercialTerm(term: PricingTerm, used: UsedAtoms): CommercialPricingTerm | undefined {
  if (term.kind === "rate") {
    collectAtom(used, "meter", term.meter);
    term.variants.forEach((variant) => {
      collectApplicability(used, variant.applicability);
      if (variant.charge_binding !== undefined)
        collectAtom(used, "usage_signal", variant.charge_binding.signal);
      if (
        variant.charge_binding !== undefined &&
        typeof variant.charge_binding.aggregation !== "string"
      )
        collectAtom(used, "aggregation", variant.charge_binding.aggregation);
      variant.price.per.factors.forEach(({ unit }) => collectAtom(used, "unit", unit));
      if (variant.price.denomination.kind === "provider_credit")
        collectProviderKey(
          used,
          "credit_denomination",
          variant.price.denomination.provider_id,
          variant.price.denomination.code,
        );
    });
    term.raw_variants.forEach((variant) => collectRawScope(used, variant));
    return {
      id: term.id,
      term_key: term.term_key,
      kind: "rate",
      meter: term.meter,
      variants: term.variants.map(
        ({ observations: _observations, charge_binding, ...variant }) => ({
          ...variant,
          ...(charge_binding === undefined
            ? {}
            : {
                charge_binding: (({ observations: _bindingObservations, ...binding }) => binding)(
                  charge_binding,
                ),
              }),
        }),
      ),
      raw_variants: term.raw_variants.map(commercialRaw),
    };
  }
  if (term.kind === "allowance") {
    term.variants.forEach((variant) => {
      collectApplicability(used, variant.applicability);
      collectAtom(used, "allowance_reset", variant.reset);
      if (variant.benefit.kind === "quantity")
        variant.benefit.quantity.unit.factors.forEach(({ unit }) =>
          collectAtom(used, "unit", unit),
        );
      else if (
        variant.benefit.kind === "credit" &&
        variant.benefit.denomination.kind === "provider_credit"
      )
        collectProviderKey(
          used,
          "credit_denomination",
          variant.benefit.denomination.provider_id,
          variant.benefit.denomination.code,
        );
    });
    term.raw_variants.forEach((variant) => collectRawScope(used, variant));
    return {
      id: term.id,
      term_key: term.term_key,
      kind: "allowance",
      variants: term.variants.map(({ observations: _observations, ...variant }) => variant),
      raw_variants: term.raw_variants.map(commercialRaw),
    };
  }
  if (term.kind === "contribution") {
    term.variants.forEach((variant) => {
      collectApplicability(used, variant.applicability);
      variant.charge_bindings.forEach((binding) => {
        collectAtom(used, "usage_signal", binding.signal);
        if (typeof binding.aggregation !== "string")
          collectAtom(used, "aggregation", binding.aggregation);
      });
    });
    term.raw_variants.forEach((variant) => collectRawScope(used, variant));
    return {
      id: term.id,
      term_key: term.term_key,
      kind: "contribution",
      variants: term.variants.map(
        ({ observations: _observations, charge_bindings, ...variant }) => ({
          ...variant,
          charge_bindings: charge_bindings.map(
            ({ observations: _observations, ...binding }) => binding,
          ),
        }),
      ),
      raw_variants: term.raw_variants.map(commercialRaw),
    };
  }
  const variants = term.variants.filter(({ impact }) => impact !== "informational");
  variants.forEach((variant) => collectRawScope(used, variant));
  if (variants.length === 0) return undefined;
  return {
    id: term.id,
    term_key: term.term_key,
    kind: "raw",
    variants: variants.map(commercialRaw),
  };
}

function commercialRaw({
  observations,
  ...variant
}: RawPricingVariant): CommercialRawPricingVariant {
  return {
    ...variant,
    raw_facts: rawFacts(observations.map(({ raw }) => raw)),
  };
}

function rawFacts(facts: RawPriceFact[]): RawPriceFact[] {
  const byBytes = new Map(facts.map((fact) => [canonicalJson(fact), fact]));
  return [...byBytes].sort(([left], [right]) => compareUtf8(left, right)).map(([, fact]) => fact);
}

function collectRawScope(used: UsedAtoms, variant: RawPricingVariant): void {
  if (variant.possible_scope !== undefined) collectApplicability(used, variant.possible_scope);
}

function collectApplicability(used: UsedAtoms, applicability: PriceApplicability): void {
  applicability.any_of.forEach(({ all_of }) =>
    all_of.forEach((condition) => collectCondition(used, condition)),
  );
}

function collectCondition(used: UsedAtoms, condition: PriceCondition): void {
  const { dimension } = condition;
  collectAtom(used, "dimension", dimension);
  if (condition.kind === "categorical")
    condition.values.forEach((value) => collectAtom(used, "categorical_value", value, dimension));
  else if (condition.kind === "decimal_range")
    condition.unit.factors.forEach(({ unit }) => collectAtom(used, "unit", unit));
}

function collectAtom(
  used: UsedAtoms,
  kind: ProviderAtomRegistryEntry["kind"],
  atom: { namespace: string; provider_id?: string; value: string },
  dimension?: PriceDimension,
): void {
  if (atom.namespace !== "provider" || atom.provider_id === undefined) return;
  collectProviderKey(used, kind, atom.provider_id, atom.value, dimension);
}

function collectProviderKey(
  used: UsedAtoms,
  kind: ProviderAtomRegistryEntry["kind"],
  providerId: string,
  key: string,
  dimension?: PriceDimension,
): void {
  if (providerId !== used.providerId)
    throw new Error(`Commercial ${kind} atom belongs to another provider`);
  used.identities.add(canonicalJson([providerId, kind, dimension ?? 0, key]));
}

function atomIdentity(providerId: string, atom: ProviderAtomRegistryEntry): string {
  return canonicalJson([
    providerId,
    atom.kind,
    atom.kind === "categorical_value" ? atom.dimension : 0,
    atom.key,
  ]);
}

function usedAtoms(groups: Map<string, UsedAtoms>, providerId: string): UsedAtoms {
  const existing = groups.get(providerId);
  if (existing !== undefined) return existing;
  const created = { providerId, identities: new Set<string>() };
  groups.set(providerId, created);
  return created;
}
