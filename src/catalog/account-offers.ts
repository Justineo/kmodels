import { uniqueCanonicalValues } from "./canonical-value.ts";
import {
  normalizeOfferRelationships,
  intersectOfferScope,
  normalized,
  raw,
} from "./offer-boundary.ts";
import { applicabilitiesOverlap, unconditionalApplicability } from "./pricing-canonical.ts";
import { pricingOfferId, pricingTermId } from "./pricing-identifiers.ts";
import {
  reassembleProviderPricing,
  type AtomicPricingTerm,
  type ProviderPricingPartition,
} from "./pricing-assembly.ts";
import type {
  PriceApplicability,
  PricingBook,
  PricingOffer,
  PricingTerm,
} from "./pricing-schema.ts";

function accountScope(provider: string, value: string): PriceApplicability {
  return {
    any_of: [
      {
        all_of: [
          {
            kind: "categorical",
            dimension: { namespace: "kmodels", value: "account_eligibility" },
            values: [{ namespace: "provider", provider_id: provider, value }],
          },
        ],
      },
    ],
  };
}

function programs(book: PricingBook): string[] {
  const values = new Set<string>();
  for (const offer of book.offers)
    for (const scope of [
      ...offer.states.map((s) => s.applicability),
      ...offer.terms.flatMap((t) =>
        t.kind === "raw"
          ? t.variants.flatMap((v) => v.possible_scope ?? [])
          : [
              ...t.variants.map((v) => v.applicability),
              ...t.raw_variants.flatMap((v) => v.possible_scope ?? []),
            ],
      ),
    ])
      for (const clause of scope.any_of)
        for (const condition of clause.all_of) {
          if (
            condition.dimension.namespace === "kmodels" &&
            condition.dimension.value === "account_eligibility" &&
            condition.kind === "categorical"
          )
            for (const value of condition.values) values.add(value.value);
        }
  if (book.provider_id === "gemini")
    return ["free_tier", "paid_tier", "free_tier_contributor", "paid_tier_contributor"].filter(
      (v) => values.has(v),
    );
  if (book.provider_id === "openai" && values.has("data_sharing"))
    return ["default", "data_sharing"].filter((v) => values.has(v));
  return [];
}

function narrow<T extends { applicability: PriceApplicability }>(
  values: T[],
  scope: PriceApplicability,
): T[] {
  return values
    .filter((v) => applicabilitiesOverlap(v.applicability, scope))
    .map((v) => ({ ...v, applicability: intersectOfferScope(v.applicability, scope) }));
}

function narrowTerm(term: PricingTerm, scope: PriceApplicability): PricingTerm | undefined {
  const rawVariants = (values: Extract<PricingTerm, { kind: "raw" }>["variants"]) =>
    values
      .filter((v) => applicabilitiesOverlap(v.possible_scope ?? unconditionalApplicability, scope))
      .map((v) => ({
        ...v,
        possible_scope: intersectOfferScope(v.possible_scope ?? unconditionalApplicability, scope),
      }));
  if (term.kind === "raw") {
    const variants = rawVariants(term.variants);
    return variants.length ? { ...term, variants } : undefined;
  }
  const variants = term.variants.filter((v) => applicabilitiesOverlap(v.applicability, scope));
  const raw_variants = rawVariants(term.raw_variants);
  if (!variants.length && !raw_variants.length) return;
  // Discriminating before mapping retains each variant's exact typed payload.
  if (term.kind === "rate")
    return { ...term, variants: narrow(term.variants, scope), raw_variants };
  if (term.kind === "allowance")
    return { ...term, variants: narrow(term.variants, scope), raw_variants };
  return { ...term, variants: narrow(term.variants, scope), raw_variants };
}

/** Account enrollment is independent of execution and actual service outcome. */
export function canonicalizeOfferBoundaries(
  partition: ProviderPricingPartition,
): ProviderPricingPartition {
  const input = normalizeOfferRelationships(partition);
  if (
    !input.books.some(
      (b) => programs(b).length > 0 && b.offers.some((o) => !o.offer_key.startsWith("account:")),
    )
  )
    return input;
  const plans = input.books.flatMap((book) =>
    book.offers.flatMap(
      (
        offer,
      ): {
        book: PricingBook;
        offer: PricingOffer;
        key: string;
        value: string | undefined;
        scope: PriceApplicability;
      }[] => {
        const values = !offer.offer_key.startsWith("account:") ? programs(book) : [];
        return values.length
          ? values.map((value) => ({
              book,
              offer,
              key: `account:${value}`,
              value,
              scope: accountScope(book.provider_id, value),
            }))
          : [
              {
                book,
                offer,
                key: offer.offer_key,
                value: undefined,
                scope: unconditionalApplicability,
              },
            ];
      },
    ),
  );
  const entries = plans.map((plan) => ({
    ...plan,
    id: pricingOfferId(plan.book.id, plan.key),
    terms: plan.offer.terms.flatMap((term) => narrowTerm(term, plan.scope) ?? []),
  }));
  const rateTargets = (refs: string[], scope: PriceApplicability) => [
    ...new Set(
      refs.flatMap((ref) =>
        entries.flatMap((e) =>
          e.terms
            .filter(
              (t) =>
                t.id === ref &&
                t.kind === "rate" &&
                t.variants.some((v) => applicabilitiesOverlap(v.applicability, scope)),
            )
            .map((t) => pricingTermId(e.id, t.kind, t.term_key)),
        ),
      ),
    ),
  ];
  const books = input.books.map((book) => ({
    book_key: book.book_key,
    ...(book.name === undefined ? {} : { name: book.name }),
    scope: book.scope,
    scope_observations: book.scope_observations,
    resource_edges: book.resource_edges,
    source_refs: book.source_refs,
    offers: entries
      .filter((e) => e.book.id === book.id)
      .map((entry) => {
        const { offer, scope } = entry;
        const observations = (values: typeof offer.states) =>
          normalized(
            values.map((v) => ({
              ...v,
              observations: v.observations.filter((o) =>
                applicabilitiesOverlap(o.establishes_applicability, scope),
              ),
            })),
            scope,
          );
        const terms: AtomicPricingTerm[] = entry.terms.map((term) => {
          const base = { term_key: term.term_key, source_refs: term.source_refs };
          if (term.kind === "raw")
            return { ...base, kind: "raw", variants: raw(term.variants, scope) };
          const relevant = <
            T extends { observations: (typeof offer.states)[number]["observations"] },
          >(
            values: T[],
          ) =>
            values.map((v) => ({
              ...v,
              observations: v.observations.filter((o) =>
                applicabilitiesOverlap(o.establishes_applicability, scope),
              ),
            }));
          if (term.kind === "rate")
            return {
              ...base,
              kind: "rate",
              meter: term.meter,
              variants: normalized(relevant(term.variants), scope).map(
                ({ charge_binding, selector_sources, ...v }) => ({
                  ...v,
                  ...(charge_binding === undefined ? {} : { charge_binding }),
                  ...(selector_sources === undefined ? {} : { selector_sources }),
                }),
              ),
              raw_variants: raw(term.raw_variants, scope),
            };
          if (term.kind === "allowance")
            return {
              ...base,
              kind: "allowance",
              variants: normalized(relevant(term.variants), scope).map((v) => ({
                ...v,
                target:
                  v.target.kind === "rate_terms"
                    ? { ...v.target, term_refs: rateTargets(v.target.term_refs, v.applicability) }
                    : v.target,
              })),
              raw_variants: raw(term.raw_variants, scope),
            };
          return {
            ...base,
            kind: "contribution",
            variants: normalized(relevant(term.variants), scope).map((v) => ({
              ...v,
              target_rate_refs: rateTargets(v.target_rate_refs, v.applicability),
            })),
            raw_variants: raw(term.raw_variants, scope),
          };
        });
        const priceScopes = [
          ...narrow(offer.states, scope).map((state) => state.applicability),
          ...entry.terms.flatMap((term) =>
            term.kind === "raw"
              ? term.variants.map((v) => v.possible_scope ?? unconditionalApplicability)
              : [
                  ...term.variants.map((v) => v.applicability),
                  ...term.raw_variants.map((v) => v.possible_scope ?? unconditionalApplicability),
                ],
          ),
        ];
        const applicable = (value: { applicability: PriceApplicability }) =>
          priceScopes.some((price) => applicabilitiesOverlap(price, value.applicability));
        const selection = narrow(offer.selection ?? [], scope)
          .filter(applicable)
          .map((c) => ({
            ...c,
            alternatives: narrow(c.alternatives, scope).filter(applicable),
          }));
        if (entry.value !== undefined)
          selection.push({
            dimension: "account_plan",
            target: "offer",
            coverage: "complete",
            applicability: scope,
            alternatives: [
              { value: { namespace: "kmodels", value: entry.value }, applicability: scope },
            ],
            observations: entry.terms
              .flatMap((t) =>
                (t.kind === "raw" ? t.variants : [...t.variants, ...t.raw_variants]).flatMap(
                  (v) => v.observations,
                ),
              )
              .slice(0, 1)
              .map(({ source_ref, locator, raw }) => ({ source_ref, locator, raw })),
          });
        return {
          offer_key: entry.key,
          name: entry.value === undefined ? "Public rates" : entry.value.replaceAll("_", " "),
          billing_mode: offer.billing_mode,
          source_contexts: narrow(offer.source_contexts ?? [], scope).filter(applicable),
          selection,
          states: observations(narrow(offer.states, scope)),
          terms,
          relations: uniqueCanonicalValues(
            narrow(offer.relations, scope).flatMap((r) =>
              r.target.offer_refs.flatMap((ref) =>
                entries
                  .filter((e) => e.offer.id === ref && applicabilitiesOverlap(e.scope, scope))
                  .map((target) => ({
                    ...r,
                    target: { kind: "offers" as const, offer_refs: [target.id] },
                    applicability: intersectOfferScope(r.applicability, target.scope),
                    observations: r.observations.map((o) => ({
                      ...o,
                      establishes_offer_refs: [target.id],
                    })),
                  })),
              ),
            ),
          ),
          source_refs: offer.source_refs,
        };
      }),
  }));
  return {
    ...reassembleProviderPricing({
      provider_id: input.snapshot.provider_id,
      observed_at: input.snapshot.observed_at,
      vocabulary: input.vocabulary,
      dispositions: input.model_dispositions.flatMap((d) =>
        d.observations.map((observation) => ({ model_ref: d.model_ref, observation })),
      ),
      books,
    }),
    snapshot: input.snapshot,
  };
}
