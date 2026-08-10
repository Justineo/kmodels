import type {
  AtomicAllowanceTerm,
  AtomicPricingBook,
  AtomicPricingOffer,
  AtomicPricingTerm,
  AtomicProviderPricing,
  AtomicRateTerm,
  AtomicRateVariant,
} from "./pricing-assembly.ts";
import { unconditionalApplicability } from "./pricing-canonical.ts";
import { pricingBookId, pricingOfferId } from "./pricing-identifiers.ts";
import { rationalFromDecimal } from "./pricing-rational.ts";
import type {
  ChargeBinding,
  NormalizedPriceObservation,
  OfferRelation,
  PriceApplicability,
  PriceCondition,
  PriceMeter,
  ProviderAtomRegistryEntry,
  RawPriceObservation,
  UnitExpression,
} from "./pricing-schema.ts";

const tokenUnit = unit("token");
const requestUnit = unit("request");
const eventUnit = unit("event");
const itemUnit = unit("item");
const byteUnit = unit("byte");

interface NativeOffer {
  modelRefs: string[];
  sourceBook: AtomicPricingBook;
  sourceOffer: AtomicPricingOffer;
  systemOfferRef: string;
  kind: "web-search" | "maps-search";
  terms: AtomicPricingTerm[];
}

export function applyVercelCommercialTopology(input: AtomicProviderPricing): AtomicProviderPricing {
  if (input.provider_id !== "vercel") return input;
  const byok = input.books.find(
    (book) => book.scope.kind === "provider_resource" && book.scope.resource_key === "byok",
  );
  const byokRefs = new Set(byok?.scope.model_refs ?? []);
  const native: NativeOffer[] = [];
  const books = input.books.flatMap((book) => {
    if (book === byok) return [];
    if (book.scope.kind !== "models") return [book];
    return [modelBook(book, input, byok, byokRefs, native)];
  });
  books.push(...nativeBooks(native, input));
  for (const book of books) {
    if (book.scope.kind !== "provider_resource") continue;
    bindResourceBook(book, input);
  }
  addServiceCompatibility(books);
  addFreeTierAllowance(books, input);
  return { ...input, books };
}

function modelBook(
  book: AtomicPricingBook,
  input: AtomicProviderPricing,
  byok: AtomicPricingBook | undefined,
  byokRefs: ReadonlySet<string>,
  native: NativeOffer[],
): AtomicPricingBook {
  const refs = book.scope.kind === "models" ? book.scope.model_refs : [];
  const offers = book.offers.flatMap((offer) => {
    if (offer.offer_key !== "usage") return [offer];
    const systemTerms = offer.terms.filter((term) => serviceKind(term) === undefined);
    const system: AtomicPricingOffer = {
      ...offer,
      offer_key: "system-credentials",
      name: "AI Gateway system credentials",
      states: statesForTerms(offer, systemTerms),
      terms: systemTerms.map((term) => bindModelTerm(term, systemTerms, input)),
      relations: [],
      settlement: [
        settlement(
          offerEvidence(offer),
          "direct",
          "Vercel",
          ["prepaid_balance", "postpaid_invoice"],
          "AI Gateway system-credential usage settles through Vercel",
        ),
      ],
    };
    if (system.states.length === 0 && system.terms.length === 0)
      system.states.push({
        state: "not_published",
        applicability: unconditionalApplicability,
        observation: normalized(offerEvidence(offer), unconditionalApplicability),
      });
    const bookId = pricingBookId(input.provider_id, book.book_key);
    const systemRef = pricingOfferId(bookId, system.offer_key);
    for (const kind of ["web-search", "maps-search"] as const) {
      const terms = offer.terms.filter((term) => serviceKind(term) === kind);
      if (terms.length > 0)
        native.push({
          modelRefs: refs,
          sourceBook: book,
          sourceOffer: offer,
          systemOfferRef: systemRef,
          kind,
          terms,
        });
    }
    const externalEvidence = byok === undefined ? undefined : offerEvidence(byok.offers[0]);
    if (externalEvidence === undefined || !refs.some((ref) => byokRefs.has(ref))) return [system];
    const byokOffer: AtomicPricingOffer = {
      offer_key: "byok",
      name: "Bring Your Own Key",
      billing_mode: { namespace: "kmodels", value: "usage" },
      states: [
        {
          state: "externally_billed",
          applicability: unconditionalApplicability,
          observation: normalized(externalEvidence, unconditionalApplicability),
        },
      ],
      enrollment: [
        {
          state: "account_scoped",
          applicability: unconditionalApplicability,
          observations: [normalized(externalEvidence, unconditionalApplicability)],
        },
      ],
      terms: [],
      relations: [],
      settlement: [
        settlement(
          externalEvidence,
          "byok",
          "Upstream provider",
          ["external_bill"],
          "The upstream provider bills BYOK usage under the account's own agreement",
        ),
      ],
      source_refs: byok?.source_refs ?? offer.source_refs,
    };
    const byokRef = pricingOfferId(bookId, byokOffer.offer_key);
    system.relations.push(
      relation(
        system,
        "exclusive_with",
        [byokRef],
        "System credentials and BYOK are alternative attempt settlement paths",
      ),
    );
    byokOffer.relations.push(
      relation(
        byokOffer,
        "exclusive_with",
        [systemRef],
        "BYOK and system credentials are alternative attempt settlement paths",
      ),
    );
    return [system, byokOffer];
  });
  return { ...book, offers };
}

function serviceKind(term: AtomicPricingTerm): NativeOffer["kind"] | undefined {
  if (term.kind === "rate" && term.meter.namespace === "kmodels") {
    if (term.meter.value === "web_search") return "web-search";
    if (term.meter.value === "maps_search") return "maps-search";
  }
  if (term.kind !== "raw") return;
  if (term.term_key.includes("web_search")) return "web-search";
  if (term.term_key.includes("maps_search")) return "maps-search";
}

function statesForTerms(
  source: AtomicPricingOffer,
  terms: readonly AtomicPricingTerm[],
): AtomicPricingOffer["states"] {
  return [
    ...source.states.filter(({ state }) => state !== "numeric"),
    ...terms.flatMap((term) =>
      term.kind === "raw"
        ? []
        : term.variants.map((variant) => ({
            state: "numeric" as const,
            applicability: variant.applicability,
            ...(variant.validity === undefined ? {} : { validity: variant.validity }),
            observation: {
              ...variant.observation,
              establishes_applicability: variant.applicability,
            },
          })),
    ),
  ];
}

function nativeBooks(
  offers: readonly NativeOffer[],
  input: AtomicProviderPricing,
): AtomicPricingBook[] {
  return (["web-search", "maps-search"] as const).flatMap((kind) => {
    const selected = offers.filter((offer) => offer.kind === kind);
    if (selected.length === 0) return [];
    const modelRefs = [...new Set(selected.flatMap(({ modelRefs: refs }) => refs))];
    const sourceRefs = [...new Set(selected.flatMap(({ sourceBook }) => sourceBook.source_refs))];
    const first = selected[0]!;
    const scope = {
      kind: "provider_resource" as const,
      resource_kind: { namespace: "kmodels" as const, value: "service" as const },
      resource_key: `native-${kind}`,
      model_refs: modelRefs,
    };
    return [
      {
        book_key: `service:native-${kind}`,
        name: kind === "web-search" ? "Provider-native web search" : "Provider-native Maps search",
        scope,
        scope_observations: [
          {
            source_ref: first.sourceBook.source_refs[0]!,
            locator: { kind: "provider_key", value: `resource:native-${kind}` },
            establishes: scope,
            raw: {
              label: kind === "web-search" ? "Native web-search pricing" : "Native Maps pricing",
            },
          },
        ],
        offers: selected.map((selectedOffer) => {
          const evidence = termEvidence(selectedOffer.terms[0]!);
          return {
            offer_key: selectedOffer.modelRefs.join("+") || selectedOffer.sourceBook.book_key,
            name: `${kind === "web-search" ? "Web search" : "Maps search"} for ${selectedOffer.modelRefs.join(", ")}`,
            billing_mode: { namespace: "kmodels", value: "usage" },
            states: statesForTerms(selectedOffer.sourceOffer, selectedOffer.terms),
            terms: selectedOffer.terms.map((term) => bindNativeServiceTerm(term, input)),
            relations: [
              relationFromEvidence(
                evidence,
                "compatible_with",
                [selectedOffer.systemOfferRef],
                "This native service price applies to the exact system-credential model route",
              ),
            ],
            settlement: [
              settlement(
                evidence,
                "direct",
                "Vercel",
                ["prepaid_balance", "postpaid_invoice"],
                "Provider-native service usage on system credentials settles through Vercel",
              ),
            ],
            source_refs: selectedOffer.sourceOffer.source_refs,
          };
        }),
        source_refs: sourceRefs,
      },
    ];
  });
}

function bindModelTerm(
  term: AtomicPricingTerm,
  terms: readonly AtomicPricingTerm[],
  input: AtomicProviderPricing,
): AtomicPricingTerm {
  if (term.kind !== "rate") return term;
  return bindVariants(term, (variant) => {
    if (!isUnit(variant.price.per, "token") || term.meter.namespace !== "kmodels") return;
    const signal: readonly [string, string, string] | undefined =
      term.meter.value === "input_text"
        ? terms.some(
            (candidate) =>
              candidate.kind === "rate" &&
              candidate.meter.namespace === "kmodels" &&
              ["cache_read_text", "cache_write_text"].includes(candidate.meter.value),
          )
          ? undefined
          : [
              "billable_input_tokens",
              "Provider-native prompt tokens when no separately priced cache partition is published",
              "generation:native_tokens_prompt",
            ]
        : term.meter.value === "cache_read_text"
          ? [
              "cache_read_tokens",
              "Provider-native cached input tokens read",
              "generation:native_tokens_cached",
            ]
          : term.meter.value === "cache_write_text"
            ? [
                "cache_creation_tokens",
                "Provider-native cache creation tokens written",
                "generation:native_tokens_cache_creation",
              ]
            : term.meter.value === "output_text"
              ? [
                  "billable_output_tokens",
                  "Provider-native completion tokens",
                  "generation:native_tokens_completion",
                ]
              : term.meter.value === "embedding"
                ? [
                    "billable_embedding_tokens",
                    "Provider-native embedding prompt tokens",
                    "generation:native_tokens_prompt",
                  ]
                : undefined;
    return signal === undefined
      ? undefined
      : providerBinding(
          input,
          signal[0],
          signal[1],
          tokenUnit,
          "attempt",
          variant.observation,
          signal[2],
        );
  });
}

function bindNativeServiceTerm(
  term: AtomicPricingTerm,
  input: AtomicProviderPricing,
): AtomicPricingTerm {
  if (
    term.kind !== "rate" ||
    term.meter.namespace !== "kmodels" ||
    term.meter.value !== "web_search"
  )
    return term;
  return bindVariants(term, (variant) =>
    isUnit(variant.price.per, "request")
      ? providerBinding(
          input,
          "billable_native_web_search_calls",
          "Provider-reported billable native web-search calls",
          requestUnit,
          "attempt",
          variant.observation,
          "generation:billable_web_search_calls",
        )
      : undefined,
  );
}

function bindResourceBook(book: AtomicPricingBook, input: AtomicProviderPricing): void {
  const key = book.scope.kind === "provider_resource" ? book.scope.resource_key : "";
  for (const offer of book.offers) {
    offer.terms = offer.terms.map((term) => {
      if (key === "trace-drains" && term.kind === "raw" && term.term_key === "trace-delivery")
        return {
          term_key: term.term_key,
          kind: "rate",
          meter: providerMeter(
            input,
            "trace_delivery",
            "One AI Gateway trace delivered to one configured drain",
          ),
          variants: [],
          raw_variants: term.variants,
          source_refs: term.source_refs,
        };
      if (term.kind !== "rate") return term;
      return bindVariants(term, (variant) => resourceBinding(key, term, variant, input));
    });
    if (["custom-reporting", "team-restrictions", "team-wide-zdr", "trace-drains"].includes(key))
      offer.enrollment = [
        {
          state: "account_scoped",
          applicability: unconditionalApplicability,
          observations: [normalized(offerEvidence(offer), unconditionalApplicability)],
        },
      ];
    if (key === "trace-drains")
      offer.settlement = [
        settlement(
          offerEvidence(offer),
          "direct",
          "Vercel",
          ["postpaid_invoice"],
          "Trace Drains settle through plan Drains usage rather than AI Gateway Credits",
        ),
      ];
    else if (!["free-tier", "model-allowlist", "provider-allowlist"].includes(key))
      offer.settlement = [
        settlement(
          offerEvidence(offer),
          "direct",
          "Vercel",
          ["prepaid_balance", "postpaid_invoice"],
          "AI Gateway add-on usage settles through Vercel",
        ),
      ];
  }
}

function resourceBinding(
  key: string,
  term: AtomicRateTerm,
  variant: AtomicRateVariant,
  input: AtomicProviderPricing,
): ChargeBinding | undefined {
  const operation = categorical(variant.applicability, "operation");
  if (["perplexity-search", "exa-search", "parallel-search"].includes(key)) {
    if (isUnit(variant.price.per, "request"))
      return providerBinding(
        input,
        `${key.replaceAll("-", "_")}_requests`,
        `Executed ${key.replaceAll("-", " ")} requests`,
        requestUnit,
        "request",
        variant.observation,
        `ai-sdk:gateway.tools.${key.replace("-search", "Search")} tool result`,
      );
    if (
      key === "exa-search" &&
      operation === "additional_requested_results" &&
      isUnit(variant.price.per, "item")
    )
      return providerBinding(
        input,
        "exa_additional_requested_results",
        "Requested Exa results above the ten-result included quantity",
        itemUnit,
        "request",
        variant.observation,
        "request:gateway.tools.exaSearch.numResults-10",
        "request",
      );
    return;
  }
  if (key === "custom-reporting") {
    if (operation === "unique_dimension_write" && isUnit(variant.price.per, "event"))
      return providerBinding(
        input,
        "custom_reporting_unique_writes",
        "Unique tag, user ID, or quota entity ID writes within one request scope",
        eventUnit,
        "request",
        variant.observation,
        "request:unique(providerOptions.gateway.tags,user,quotaEntityId)",
        "request",
      );
    if (operation === "report_query" && isUnit(variant.price.per, "request"))
      return providerBinding(
        input,
        "custom_reporting_queries",
        "Queries sent to the Custom Reporting endpoint",
        requestUnit,
        "request",
        variant.observation,
        "rest:GET /v1/reports/spend",
      );
  }
  if (key === "team-restrictions" && isUnit(variant.price.per, "request"))
    return providerBinding(
      input,
      "successful_restricted_responses",
      "Successful responses while either or both team-wide allowlists are enabled; counted once",
      requestUnit,
      "request",
      variant.observation,
      "generation:successful response with team model/provider restriction enabled",
    );
  if (key === "team-wide-zdr" && isUnit(variant.price.per, "request"))
    return providerBinding(
      input,
      "successful_zdr_responses_with_usage",
      "Successful usage-bearing responses while team-wide ZDR is enabled",
      requestUnit,
      "request",
      variant.observation,
      "generation:successful response with usage and zero_data_retention=true",
    );
  if (
    key === "trace-drains" &&
    term.meter.namespace === "kmodels" &&
    term.meter.value === "data_transfer" &&
    isUnit(variant.price.per, "byte")
  )
    return providerBinding(
      input,
      "trace_egress_bytes",
      "Uncompressed JSON bytes of delivered AI Gateway trace records",
      byteUnit,
      "resource",
      variant.observation,
      "usage:Drains/AI Gateway Traces egress bytes",
    );
}

function addServiceCompatibility(books: readonly AtomicPricingBook[]): void {
  const mechanisms = books.flatMap((book) =>
    book.scope.kind === "models"
      ? book.offers.map((offer) => ({
          ref: pricingOfferId(pricingBookId("vercel", book.book_key), offer.offer_key),
          offer,
        }))
      : [],
  );
  for (const book of books) {
    if (
      book.scope.kind !== "provider_resource" ||
      !["perplexity-search", "exa-search", "parallel-search"].includes(book.scope.resource_key)
    )
      continue;
    const allowed = new Set(book.scope.model_refs);
    const targets = mechanisms.filter(({ offer }) => {
      const owner = books.find((candidate) => candidate.offers.includes(offer));
      return (
        owner?.scope.kind === "models" && owner.scope.model_refs.some((ref) => allowed.has(ref))
      );
    });
    for (const offer of book.offers) {
      if (targets.length === 0) continue;
      offer.relations.push(
        relation(
          offer,
          "compatible_with",
          targets.map(({ ref }) => ref),
          "Gateway search can supplement any published Vercel model mechanism",
        ),
      );
    }
  }
}

function addFreeTierAllowance(
  books: readonly AtomicPricingBook[],
  input: AtomicProviderPricing,
): void {
  const book = books.find(
    (candidate) =>
      candidate.scope.kind === "provider_resource" && candidate.scope.resource_key === "free-tier",
  );
  if (book?.scope.kind !== "provider_resource") return;
  const offer = book.offers.find(({ offer_key: key }) => key === "credit-allowance");
  if (offer === undefined) return;
  const rawTerm = offer.terms.find(
    (term) => term.kind === "raw" && term.term_key === "free-credit-allowance",
  );
  if (rawTerm?.kind !== "raw") return;
  const variant = rawTerm.variants[0];
  if (variant?.observation.raw.amount !== "5" || variant.observation.raw.denomination !== "USD")
    return;
  const eligible = new Set(book.scope.model_refs);
  const targets = books.flatMap((candidate) =>
    candidate.scope.kind === "models" && candidate.scope.model_refs.some((ref) => eligible.has(ref))
      ? candidate.offers
          .filter(({ offer_key }) => offer_key === "system-credentials")
          .map(({ offer_key }) =>
            pricingOfferId(pricingBookId(input.provider_id, candidate.book_key), offer_key),
          )
      : [],
  );
  if (targets.length === 0) return;
  addAtom(input, {
    kind: "allowance_reset",
    key: "30_days",
    definition: "Thirty days anchored to the account's first AI Gateway request",
  });
  const observation = normalized(variant.observation, unconditionalApplicability);
  const allowance: AtomicAllowanceTerm = {
    term_key: "free-credit-allowance",
    kind: "allowance",
    variants: [
      {
        benefit: {
          kind: "credit",
          amount: rationalFromDecimal("5"),
          denomination: { kind: "fiat", currency: "USD" },
        },
        target: { kind: "offers", offer_refs: targets },
        reset: { namespace: "provider", provider_id: input.provider_id, value: "30_days" },
        applicability: unconditionalApplicability,
        observation,
      },
    ],
    raw_variants: [],
    source_refs: rawTerm.source_refs,
  };
  offer.terms = offer.terms.map((term) => (term === rawTerm ? allowance : term));
  offer.settlement = [
    settlement(
      observation,
      "direct",
      "Vercel",
      ["allowance"],
      "Eligible system-credential usage can draw down the free-tier credit allowance",
    ),
  ];
}

function bindVariants(
  term: AtomicRateTerm,
  binding: (variant: AtomicRateVariant) => ChargeBinding | undefined,
): AtomicRateTerm {
  return {
    ...term,
    variants: term.variants.map((variant) => {
      const charge_binding = binding(variant);
      return charge_binding === undefined ? variant : { ...variant, charge_binding };
    }),
  };
}

function providerBinding(
  input: AtomicProviderPricing,
  key: string,
  definition: string,
  signalUnit: UnitExpression,
  aggregation: ChargeBinding["aggregation"],
  observation: NormalizedPriceObservation,
  locator: string,
  resolutionPhase: "request" | "outcome" | "account" = aggregation === "resource"
    ? "account"
    : "outcome",
): ChargeBinding {
  addAtom(input, {
    kind: "usage_signal",
    key,
    definition,
    unit: signalUnit,
    resolution_phase: resolutionPhase,
  });
  return {
    signal: { namespace: "provider", provider_id: input.provider_id, value: key },
    aggregation,
    observations: [{ ...observation, locator: { kind: "meter", value: locator } }],
  };
}

function providerMeter(input: AtomicProviderPricing, key: string, definition: string): PriceMeter {
  addAtom(input, { kind: "meter", key, definition });
  return { namespace: "provider", provider_id: input.provider_id, value: key };
}

function addAtom(input: AtomicProviderPricing, atom: ProviderAtomRegistryEntry): void {
  const current = input.vocabulary.atoms.find(
    (candidate) =>
      candidate.kind === atom.kind &&
      candidate.key === atom.key &&
      (!("dimension" in candidate) ||
        !("dimension" in atom) ||
        JSON.stringify(candidate.dimension) === JSON.stringify(atom.dimension)),
  );
  if (current === undefined) input.vocabulary.atoms.push(atom);
  else if (JSON.stringify(current) !== JSON.stringify(atom))
    throw new Error(`Vercel pricing atom ${atom.key} changed definition`);
}

function relation(
  offer: AtomicPricingOffer,
  kind: OfferRelation["kind"],
  targets: string[],
  label: string,
): OfferRelation {
  return relationFromEvidence(offerEvidence(offer), kind, targets, label);
}

function relationFromEvidence(
  evidence: RawPriceObservation,
  kind: OfferRelation["kind"],
  targets: string[],
  label: string,
): OfferRelation {
  return {
    kind,
    target: { kind: "offers", offer_refs: targets },
    applicability: unconditionalApplicability,
    observations: [
      {
        ...evidence,
        raw: { label },
        establishes_offer_refs: targets,
        establishes_book_refs: [],
      },
    ],
  };
}

function settlement(
  evidence: RawPriceObservation,
  channel: "direct" | "byok",
  biller: string,
  paymentSources: ("allowance" | "prepaid_balance" | "postpaid_invoice" | "external_bill")[],
  label: string,
): NonNullable<AtomicPricingOffer["settlement"]>[number] {
  return {
    channel,
    biller,
    payment_sources: paymentSources,
    applicability: unconditionalApplicability,
    observations: [
      {
        ...normalized(evidence, unconditionalApplicability),
        raw: { label },
      },
    ],
  };
}

function offerEvidence(offer: AtomicPricingOffer | undefined): RawPriceObservation {
  const evidence = offer?.states[0]?.observation ?? offer?.terms.flatMap(termObservations)[0];
  if (evidence === undefined)
    throw new Error(`Vercel offer ${offer?.offer_key ?? "unknown"} has no evidence`);
  return evidence;
}

function termEvidence(term: AtomicPricingTerm): RawPriceObservation {
  const evidence = termObservations(term)[0];
  if (evidence === undefined) throw new Error(`Vercel term ${term.term_key} has no evidence`);
  return evidence;
}

function termObservations(term: AtomicPricingTerm): RawPriceObservation[] {
  if (term.kind === "raw") return term.variants.map(({ observation }) => observation);
  return [
    ...term.variants.map(({ observation }) => observation),
    ...term.raw_variants.map(({ observation }) => observation),
  ];
}

function normalized(
  observation: RawPriceObservation,
  applicability: PriceApplicability,
): NormalizedPriceObservation {
  return { ...observation, establishes_applicability: applicability };
}

function categorical(applicability: PriceApplicability, dimension: string): string | undefined {
  const values = new Set(
    applicability.any_of.flatMap(({ all_of }) =>
      all_of.flatMap((condition) => categoricalCondition(condition, dimension)),
    ),
  );
  return values.size === 1 ? [...values][0] : undefined;
}

function categoricalCondition(condition: PriceCondition, dimension: string): string[] {
  return condition.kind === "categorical" &&
    condition.dimension.namespace === "kmodels" &&
    condition.dimension.value === dimension
    ? condition.values.map(({ value }) => value)
    : [];
}

function isUnit(
  expression: UnitExpression,
  value: "byte" | "event" | "item" | "request" | "token",
): boolean {
  return (
    expression.factors.length === 1 &&
    expression.factors[0]?.power === 1 &&
    expression.factors[0].unit.namespace === "kmodels" &&
    expression.factors[0].unit.value === value
  );
}

function unit(value: "byte" | "event" | "item" | "request" | "token"): UnitExpression {
  return { factors: [{ unit: { namespace: "kmodels", value }, power: 1 }] };
}
