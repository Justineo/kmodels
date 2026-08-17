import type {
  AtomicPricingBook,
  AtomicPricingOffer,
  AtomicPricingTerm,
  AtomicProviderPricing,
  AtomicRateTerm,
  AtomicRateVariant,
} from "./pricing-assembly.ts";
import { addAtom, isStandardUnit, rawEvidence } from "./pricing-commercial-assembly.ts";
import type {
  ChargeBinding,
  NormalizedPriceObservation,
  PriceApplicability,
  PriceCondition,
  UnitExpression,
} from "./pricing-schema.ts";

const tokenUnit = unit("token");
const requestUnit = unit("request");
const itemUnit = unit("item");

interface NativeOffer {
  modelRefs: string[];
  sourceBook: AtomicPricingBook;
  sourceOffer: AtomicPricingOffer;
  kind: "web-search" | "maps-search";
  terms: AtomicPricingTerm[];
}

export function applyVercelCommercialTopology(input: AtomicProviderPricing): AtomicProviderPricing {
  const native: NativeOffer[] = [];
  const books = input.books.map((book) =>
    book.scope.kind === "models" ? modelBook(book, input, native) : bindResourceBook(book, input),
  );
  books.push(...nativeBooks(native, input));
  return { ...input, books };
}

function modelBook(
  book: AtomicPricingBook,
  input: AtomicProviderPricing,
  native: NativeOffer[],
): AtomicPricingBook {
  const modelRefs = book.scope.kind === "models" ? book.scope.model_refs : [];
  const offers = book.offers.map((offer) => {
    if (offer.offer_key !== "usage") return offer;
    for (const kind of ["web-search", "maps-search"] as const) {
      const terms = offer.terms.filter((term) => serviceKind(term) === kind);
      if (terms.length > 0)
        native.push({ modelRefs, sourceBook: book, sourceOffer: offer, kind, terms });
    }
    const terms = offer.terms.filter((term) => serviceKind(term) === undefined);
    return {
      ...offer,
      name: "AI Gateway inference",
      states: statesForTerms(offer, terms),
      terms: terms.map((term) => bindModelTerm(term, terms, input)),
      relations: [],
      enrollment: [],
      settlement: [],
    };
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
        : term.variants.map((variant) => {
            const { formula: _, ...raw } = variant.observation.raw;
            return {
              state: "numeric" as const,
              applicability: variant.applicability,
              ...(variant.validity === undefined ? {} : { validity: variant.validity }),
              observation: {
                ...variant.observation,
                raw,
                establishes_applicability: variant.applicability,
              },
            };
          }),
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
    const modelRefs = unique(selected.flatMap(({ modelRefs: refs }) => refs));
    const sourceRefs = unique(selected.flatMap(({ sourceBook }) => sourceBook.source_refs));
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
            source_ref: sourceRefs[0]!,
            locator: { kind: "provider_key", value: `resource:native-${kind}` },
            establishes: scope,
            raw: {
              label: kind === "web-search" ? "Native web-search pricing" : "Native Maps pricing",
            },
          },
        ],
        offers: selected.map(({ modelRefs: refs, sourceBook, sourceOffer, terms }) => ({
          offer_key: sourceBook.book_key,
          name: `${kind === "web-search" ? "Web search" : "Maps search"} for ${refs.join(", ")}`,
          ...(refs.length === 0 ? {} : { model_refs: refs }),
          billing_mode: { namespace: "kmodels", value: "usage" },
          states: statesForTerms(sourceOffer, terms),
          terms: terms.map((term) => bindNativeServiceTerm(term, input)),
          relations: [],
          enrollment: [],
          settlement: [],
          source_refs: sourceOffer.source_refs,
        })),
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
    if (!isStandardUnit(variant.price.per, "token") || term.meter.namespace !== "kmodels") return;
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
    isStandardUnit(variant.price.per, "request")
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

function bindResourceBook(
  book: AtomicPricingBook,
  input: AtomicProviderPricing,
): AtomicPricingBook {
  if (book.scope.kind !== "provider_resource") return book;
  const key = book.scope.resource_key;
  const merged = mergeSearchComponents(book);
  return {
    ...merged,
    offers: merged.offers.map((offer) => ({
      ...offer,
      terms: offer.terms.map((term) =>
        term.kind === "rate"
          ? bindVariants(term, (variant) => resourceBinding(key, variant, input))
          : term,
      ),
      relations: [],
      enrollment: [],
      settlement: [],
    })),
  };
}

function mergeSearchComponents(book: AtomicPricingBook): AtomicPricingBook {
  if (book.scope.kind !== "provider_resource") return book;
  const operation =
    book.scope.resource_key === "exa-search"
      ? "additional_requested_results"
      : book.scope.resource_key === "parallel-search"
        ? "additional_results"
        : undefined;
  if (operation === undefined) return book;
  const search = book.offers.find(({ offer_key: key }) => key === "search");
  const additional = book.offers.find(({ offer_key: key }) => key === "additional-results");
  if (search === undefined || additional === undefined) return book;
  const merged = {
    ...search,
    terms: [
      ...search.terms,
      ...additional.terms.map((term) => ({
        ...term,
        term_key: `${term.term_key}:${operation}`,
      })),
    ],
    source_refs: unique([...search.source_refs, ...additional.source_refs]),
  };
  return {
    ...book,
    offers: book.offers.flatMap((offer) =>
      offer === search ? [merged] : offer === additional ? [] : [offer],
    ),
  };
}

function resourceBinding(
  key: string,
  variant: AtomicRateVariant,
  input: AtomicProviderPricing,
): ChargeBinding | undefined {
  if (!["perplexity-search", "exa-search", "parallel-search"].includes(key)) return;
  if (isStandardUnit(variant.price.per, "request"))
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
    categorical(variant.applicability, "operation") === "additional_requested_results" &&
    isStandardUnit(variant.price.per, "item")
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
  resolutionPhase: "request" | "outcome" = "outcome",
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
    observations: [{ ...rawEvidence(observation), locator: { kind: "meter", value: locator } }],
  };
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

function unit(value: "item" | "request" | "token"): UnitExpression {
  return { factors: [{ unit: { namespace: "kmodels", value }, power: 1 }] };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
