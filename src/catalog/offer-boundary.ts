import { canonicalJson, uniqueCanonicalValues } from "./canonical-value.ts";
import {
  applicabilitiesOverlap,
  canonicalizeApplicability,
  unconditionalApplicability,
} from "./pricing-canonical.ts";
import { pricingOfferId, pricingTermId } from "./pricing-identifiers.ts";
import { evaluateApplicability, type PricingSelection } from "./pricing-applicability.ts";
import {
  reassembleProviderPricing,
  type AtomicPricingTerm,
  type AtomicRawVariant,
  type ProviderPricingPartition,
} from "./pricing-assembly.ts";
import type {
  CommercialSelection,
  NormalizedPriceObservation,
  PriceApplicability,
  PricingBook,
  PricingOffer,
  PublishedValidity,
  RawPricingVariant,
} from "./pricing-schema.ts";

/** Audited public list-rate relationships; enrollment and private contracts are not inferred. */
const publicProviders = new Set([
  "amazon-bedrock",
  "amazon-sagemaker",
  "anthropic",
  "azure",
  "cerebras",
  "cohere",
  "dashscope",
  "databricks",
  "deepseek",
  "fireworks",
  "gemini",
  "huggingface",
  "kimi",
  "meta",
  "mistral",
  "nvidia-nim",
  "ollama",
  "openai",
  "together",
  "typesafe",
  "vercel",
  "vertex",
  "xai",
]);

/** Source route bindings become exact conditions inside the public relationship. */
export function sourceContextSelectors(
  offer: PricingOffer,
  key: string,
  fixed: readonly PricingSelection[],
): PricingSelection[][] {
  const context = offer.source_contexts?.find((c) => c.key === key);
  if (context === undefined) return offer.offer_key === key ? [[...fixed]] : [];
  return context.applicability.any_of.flatMap((clause) => {
    let branches: PricingSelection[][] = [[...fixed]];
    for (const condition of clause.all_of) {
      if (
        condition.dimension.namespace === "kmodels" &&
        ["model", "account_eligibility"].includes(condition.dimension.value)
      )
        continue;
      if (condition.kind !== "categorical")
        throw new Error("Source context requires categorical selectors");
      branches = branches.flatMap((branch) =>
        condition.values.flatMap((value) => {
          const selected: PricingSelection = {
            kind: "categorical",
            dimension: condition.dimension,
            value,
          };
          const existing = branch.find(
            (s) => canonicalJson(s.dimension) === canonicalJson(condition.dimension),
          );
          return existing === undefined
            ? [[...branch, selected]]
            : canonicalJson(existing) === canonicalJson(selected)
              ? [branch]
              : [];
        }),
      );
    }
    return branches.filter(
      (branch) => evaluateApplicability({ any_of: [clause] }, branch).state !== "false",
    );
  });
}

export function intersectOfferScope(
  a: PriceApplicability,
  b: PriceApplicability,
): PriceApplicability {
  return canonicalizeApplicability({
    any_of: a.any_of.flatMap((left) =>
      b.any_of.map((right) => ({ all_of: [...left.all_of, ...right.all_of] })),
    ),
  });
}

function category(
  dimension: "execution" | "operation" | "model",
  values: string[],
  provider?: string,
): PriceApplicability {
  return {
    any_of: [
      {
        all_of: [
          {
            kind: "categorical",
            dimension: { namespace: "kmodels", value: dimension },
            values: values.map((value) =>
              provider === undefined
                ? { namespace: "kmodels", value }
                : { namespace: "provider", provider_id: provider, value },
            ),
          },
        ],
      },
    ],
  };
}

/** These keys identify source operation rows, never independent purchasing relationships. */
function contextScope(book: PricingBook, offer: PricingOffer): PriceApplicability {
  let scope =
    offer.model_refs === undefined
      ? unconditionalApplicability
      : category("model", offer.model_refs);
  const execution = offer.selection?.find(
    (claim) => claim.dimension === "execution" && claim.coverage === "complete",
  );
  if (book.offers.length > 1 && execution !== undefined && execution.alternatives.length > 0)
    scope = intersectOfferScope(
      scope,
      category(
        "execution",
        execution.alternatives.map(({ value }) => value.value),
      ),
    );
  if (
    book.scope.kind === "models" &&
    book.offers.some((o) => o.offer_key === "batch") &&
    book.offers.some(
      (o) => !o.selection?.some((c) => c.dimension === "execution" && c.coverage === "complete"),
    )
  )
    scope = intersectOfferScope(scope, {
      any_of: [
        {
          all_of: [
            {
              kind: "categorical",
              dimension: {
                namespace: "provider",
                provider_id: book.provider_id,
                value: "invocation_mode",
              },
              values: [
                { namespace: "provider", provider_id: book.provider_id, value: offer.offer_key },
              ],
            },
          ],
        },
      ],
    });
  if (book.provider_id === "openai" && book.book_key.startsWith("service:fine-tuned-inference:"))
    scope = intersectOfferScope(
      scope,
      category("execution", [offer.offer_key === "batch" ? "batch" : "request"]),
    );
  const operation =
    (book.provider_id === "xai" && book.book_key === "service:speech-to-text") ||
    (book.provider_id === "anthropic" && book.book_key === "service:code-execution") ||
    (book.provider_id === "deepseek" &&
      ["service:web-search", "service:web-fetch"].includes(book.book_key)) ||
    (book.provider_id === "kimi" &&
      ["service:web-search", "service:formula"].includes(book.book_key));
  if (operation)
    scope = intersectOfferScope(scope, category("operation", [offer.offer_key], book.provider_id));
  return scope;
}

export function normalized<
  T extends {
    applicability: PriceApplicability;
    observations: NormalizedPriceObservation[];
    validity?: PublishedValidity | undefined;
  },
>(variants: T[], scope: PriceApplicability) {
  return variants.flatMap(({ observations, validity, ...variant }) =>
    observations.map((observation) => ({
      ...variant,
      ...(validity === undefined ? {} : { validity }),
      applicability: intersectOfferScope(observation.establishes_applicability, scope),
      observation: {
        ...observation,
        establishes_applicability: intersectOfferScope(
          observation.establishes_applicability,
          scope,
        ),
      },
    })),
  );
}

export function raw(variants: RawPricingVariant[], scope: PriceApplicability): AtomicRawVariant[] {
  return variants.flatMap(
    ({ observations, possible_scope, validity, resolution_policy, ...variant }) =>
      observations.map((observation) => ({
        ...variant,
        ...(validity === undefined ? {} : { validity }),
        ...(resolution_policy === undefined ? {} : { resolution_policy }),
        possible_scope: intersectOfferScope(possible_scope ?? unconditionalApplicability, scope),
        observation,
      })),
  );
}

export function normalizeOfferRelationships(
  input: ProviderPricingPartition,
): ProviderPricingPartition {
  if (
    !publicProviders.has(input.snapshot.provider_id) ||
    input.books.every((b) => b.offers.every((o) => o.source_contexts !== undefined))
  )
    return input;
  const scopes = new Map<string, PriceApplicability>();
  const offerRefs = new Map<string, string>();
  const termRefs = new Map<string, string>();
  const termKeys = new Map<string, string>();
  const mixedBooks = new Set<string>();
  const groupedBooks = input.books.flatMap((book) => {
    const modes = uniqueCanonicalValues(book.offers.map((o) => o.billing_mode));
    if (modes.length === 1) return [book];
    mixedBooks.add(book.id);
    return modes.map((mode) => ({
      ...book,
      offers: book.offers.filter((o) => canonicalJson(o.billing_mode) === canonicalJson(mode)),
    }));
  });
  const offerKey = (book: PricingBook) =>
    book.offers.length === 1
      ? (book.offers[0]?.offer_key ?? "public")
      : mixedBooks.has(book.id)
        ? `public:${book.offers[0]?.billing_mode.value}`
        : "public";
  for (const book of groupedBooks) {
    const counts = new Map<string, number>();
    for (const term of book.offers.flatMap((o) => o.terms))
      counts.set(term.term_key, (counts.get(term.term_key) ?? 0) + 1);
    for (const offer of book.offers)
      for (const term of offer.terms)
        termKeys.set(
          term.id,
          counts.get(term.term_key) === 1 ? term.term_key : `${offer.offer_key}/${term.term_key}`,
        );
  }
  for (const book of groupedBooks)
    for (const offer of book.offers) {
      if (offer.enrollment.length || offer.settlement.length)
        throw new Error(
          `${book.provider_id}: relationship evidence requires an explicit offer policy`,
        );
      scopes.set(offer.id, contextScope(book, offer));
      const id = pricingOfferId(book.id, offerKey(book));
      offerRefs.set(offer.id, id);
      for (const term of offer.terms)
        termRefs.set(term.id, pricingTermId(id, term.kind, termKeys.get(term.id) ?? term.term_key));
    }
  const ref = (id: string) => offerRefs.get(id) ?? id;
  const termRef = (id: string) => termRefs.get(id) ?? id;
  const vocabulary = structuredClone(input.vocabulary);
  const books = groupedBooks.map((book) => {
    const first = book.offers[0];
    if (first === undefined) throw new Error(`${book.book_key}: empty price book`);
    const terms: AtomicPricingTerm[] = [];
    const selection: CommercialSelection[] = [];
    for (const offer of book.offers) {
      const scope = scopes.get(offer.id) ?? unconditionalApplicability;
      for (const clause of scope.any_of)
        for (const condition of clause.all_of)
          if (condition.kind === "categorical")
            for (const value of condition.values) {
              if (
                condition.dimension.namespace === "provider" &&
                !vocabulary.atoms.some(
                  (a) => a.kind === "dimension" && a.key === condition.dimension.value,
                )
              )
                vocabulary.atoms.push({
                  kind: "dimension",
                  key: condition.dimension.value,
                  definition:
                    "Source invocation mode with incomplete canonical execution classification",
                  resolution_phase: "request",
                });
              if (
                value.namespace === "provider" &&
                !vocabulary.atoms.some(
                  (a) =>
                    a.kind === "categorical_value" &&
                    a.key === value.value &&
                    canonicalJson(a.dimension) === canonicalJson(condition.dimension),
                )
              )
                vocabulary.atoms.push({
                  kind: "categorical_value",
                  key: value.value,
                  dimension: condition.dimension,
                  definition: `Source operation ${value.value}`,
                });
            }
      for (const claim of offer.selection ?? []) {
        if (
          claim.dimension === "execution" &&
          book.provider_id === "openai" &&
          book.book_key.startsWith("service:fine-tuned-inference:")
        ) {
          selection.push({
            ...claim,
            target: "condition",
            coverage: "complete",
            applicability: scope,
            alternatives: [
              {
                value: {
                  namespace: "kmodels",
                  value: offer.offer_key === "batch" ? "batch" : "request",
                },
                applicability: scope,
              },
            ],
          });
          continue;
        }
        if (["billing_mode", "resource_kind"].includes(claim.dimension)) {
          if (!selection.some((c) => c.dimension === claim.dimension))
            selection.push({
              ...claim,
              target: claim.dimension === "resource_kind" ? "book" : "offer",
            });
          continue;
        }
        selection.push({
          ...claim,
          target:
            claim.dimension === "resource_kind"
              ? "book"
              : claim.dimension === "billing_mode"
                ? "offer"
                : "condition",
          applicability: intersectOfferScope(claim.applicability, scope),
          alternatives: claim.alternatives.map((a) => ({
            ...a,
            applicability: intersectOfferScope(a.applicability, scope),
          })),
        });
      }
      for (const term of offer.terms) {
        const base = {
          term_key: termKeys.get(term.id) ?? term.term_key,
          source_refs: term.source_refs,
        };
        if (term.kind === "raw")
          terms.push({ ...base, kind: "raw", variants: raw(term.variants, scope) });
        else if (term.kind === "rate")
          terms.push({
            ...base,
            kind: "rate",
            meter: term.meter,
            variants: normalized(term.variants, scope).map(
              ({ charge_binding, selector_sources, ...v }) => ({
                ...v,
                ...(charge_binding === undefined ? {} : { charge_binding }),
                ...(selector_sources === undefined ? {} : { selector_sources }),
              }),
            ),
            raw_variants: raw(term.raw_variants, scope),
          });
        else if (term.kind === "allowance")
          terms.push({
            ...base,
            kind: "allowance",
            variants: normalized(term.variants, scope).map((v) => ({
              ...v,
              target:
                v.target.kind === "rate_terms"
                  ? { ...v.target, term_refs: v.target.term_refs.map(termRef) }
                  : v.target,
            })),
            raw_variants: raw(term.raw_variants, scope),
          });
        else
          terms.push({
            ...base,
            kind: "contribution",
            variants: normalized(term.variants, scope).map((v) => ({
              ...v,
              target_rate_refs: v.target_rate_refs.map(termRef),
            })),
            raw_variants: raw(term.raw_variants, scope),
          });
      }
    }
    return {
      book_key: book.book_key,
      ...(book.name === undefined ? {} : { name: book.name }),
      scope: book.scope,
      scope_observations: book.scope_observations,
      resource_edges: book.resource_edges,
      source_refs: book.source_refs,
      offers: [
        {
          offer_key: offerKey(book),
          name: book.offers.length === 1 ? (first.name ?? "Public rates") : "Public rates",
          billing_mode: first.billing_mode,
          source_contexts: uniqueCanonicalValues(
            book.offers.map((o) => ({
              key: o.offer_key,
              applicability: scopes.get(o.id) ?? unconditionalApplicability,
            })),
          ),
          selection: uniqueCanonicalValues(selection),
          states: book.offers.flatMap((o) =>
            normalized(o.states, scopes.get(o.id) ?? unconditionalApplicability),
          ),
          terms,
          relations: uniqueCanonicalValues(
            book.offers.flatMap((o) =>
              o.relations.flatMap((r) =>
                r.target.offer_refs.flatMap((target) => {
                  if (ref(target) === ref(o.id)) {
                    if (
                      r.kind === "exclusive_with" &&
                      !applicabilitiesOverlap(
                        scopes.get(o.id) ?? unconditionalApplicability,
                        scopes.get(target) ?? unconditionalApplicability,
                      )
                    )
                      return [];
                    throw new Error(
                      `${book.book_key}: relationship cannot become a self-reference`,
                    );
                  }
                  return [
                    {
                      ...r,
                      target: { kind: "offers" as const, offer_refs: [ref(target)] },
                      applicability: intersectOfferScope(
                        intersectOfferScope(
                          r.applicability,
                          scopes.get(o.id) ?? unconditionalApplicability,
                        ),
                        scopes.get(target) ?? unconditionalApplicability,
                      ),
                      observations: r.observations.map((obs) => ({
                        ...obs,
                        establishes_offer_refs: [ref(target)],
                      })),
                    },
                  ];
                }),
              ),
            ),
          ),
          source_refs: [...new Set(book.offers.flatMap((o) => o.source_refs))],
        },
      ],
    };
  });
  const assembled = reassembleProviderPricing({
    provider_id: input.snapshot.provider_id,
    observed_at: input.snapshot.observed_at,
    vocabulary,
    dispositions: input.model_dispositions.flatMap((d) =>
      d.observations.map((observation) => ({ model_ref: d.model_ref, observation })),
    ),
    books: [...new Set(books.map((b) => b.book_key))].map((key) => {
      const peers = books.filter((b) => b.book_key === key);
      const first = peers[0];
      if (first === undefined) throw new Error("Missing relationship book");
      return { ...first, offers: peers.flatMap((b) => b.offers) };
    }),
  });
  return { ...assembled, snapshot: input.snapshot };
}
