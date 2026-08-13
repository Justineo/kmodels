import type {
  AtomicPricingBook,
  AtomicPricingOffer,
  AtomicPricingTerm,
  AtomicProviderPricing,
} from "./pricing-assembly.ts";
import { canonicalizeApplicability } from "./pricing-canonical.ts";
import { addAtom, unitIdentityKey, withApplicability } from "./pricing-commercial-assembly.ts";
import type {
  ChargeBinding,
  NormalizedPriceObservation,
  PriceApplicability,
  PriceCondition,
  PriceMeter,
  UnitExpression,
} from "./pricing-schema.ts";
import type { ProviderModel } from "./schema.ts";

type PublishedModel = Pick<ProviderModel, "model_id" | "uid">;
type Mechanism = "sync" | "batch";

const servedTier = { namespace: "kmodels" as const, value: "served_service_tier" as const };
const requestServices = new Set([
  "computer-use",
  "responses-code-interpreter",
  "responses-file-search",
  "responses-web-search",
]);

export function applyAzureCommercialTopology(
  input: AtomicProviderPricing,
  publishedModels: readonly PublishedModel[],
): AtomicProviderPricing {
  const models = new Map(publishedModels.map((model) => [model.uid, model]));
  const books = input.books.flatMap((book): AtomicPricingBook[] => {
    if (book.scope.kind === "provider_resource")
      return admittedResource(book.scope.resource_key) ? [bindResourceBook(book, input)] : [];
    const migrated = migrateModelBook(book, input, models);
    return migrated.offers.length === 0 ? [] : [migrated];
  });
  return { ...input, books };
}

function admittedResource(key: string): boolean {
  return requestServices.has(key) || key.startsWith("unclassified-built-in:");
}

function bindResourceBook(
  book: AtomicPricingBook,
  input: AtomicProviderPricing,
): AtomicPricingBook {
  if (book.scope.kind !== "provider_resource") return book;
  const resourceKey = book.scope.resource_key;
  return {
    ...book,
    resource_edges: [],
    offers: book.offers.map((offer) => ({
      ...offer,
      enrollment: [],
      settlement: [],
      relations: [],
      terms: offer.terms.map((term) => bindResourceTerm(resourceKey, term, input)),
    })),
  };
}

function bindResourceTerm(
  resourceKey: string,
  term: AtomicPricingTerm,
  input: AtomicProviderPricing,
): AtomicPricingTerm {
  if (term.kind !== "rate") return term;
  return {
    ...term,
    variants: term.variants.map((variant) => {
      const aggregation =
        term.meter.namespace === "kmodels" && term.meter.value === "code_execution"
          ? "session"
          : term.meter.namespace === "kmodels" &&
              ["file_search", "web_search"].includes(term.meter.value)
            ? "result_item"
            : "attempt";
      return {
        ...variant,
        charge_binding: providerBinding(
          input,
          resourceSignal(resourceKey, term.meter, variant.price.per),
          `Observed ${resourceKey} ${term.meter.value.replaceAll("_", " ")} usage`,
          variant.price.per,
          aggregation,
          variant.observation,
          `resource:${resourceKey}:${term.meter.value}`,
        ),
      };
    }),
  };
}

function resourceSignal(resourceKey: string, meter: PriceMeter, unit: UnitExpression): string {
  return `${resourceKey}_${meter.value}_${unitIdentityKey(unit)}`.replace(/[^a-zA-Z0-9_]+/g, "_");
}

function migrateModelBook(
  book: AtomicPricingBook,
  input: AtomicProviderPricing,
  models: ReadonlyMap<string, PublishedModel>,
): AtomicPricingBook {
  const model =
    book.scope.kind === "models" ? models.get(book.scope.model_refs[0] ?? "") : undefined;
  const offers = book.offers.flatMap((offer): AtomicPricingOffer[] => {
    if (offer.offer_key === "capacity") return [];
    if (offer.offer_key !== "usage")
      return [{ ...offer, enrollment: [], settlement: [], relations: [] }];
    return [
      partitionOffer(offer, "sync", input, model?.model_id === "model-router"),
      partitionOffer(offer, "batch", input, false),
    ].filter((value): value is AtomicPricingOffer => value !== undefined);
  });
  return { ...book, resource_edges: [], offers };
}

function partitionOffer(
  source: AtomicPricingOffer,
  mechanism: Mechanism,
  input: AtomicProviderPricing,
  router: boolean,
): AtomicPricingOffer | undefined {
  const states = source.states.flatMap((state) => {
    const applicability = mechanismApplicability(state.applicability, mechanism, input);
    return applicability === undefined
      ? []
      : [
          {
            ...state,
            applicability,
            observation: withApplicability(state.observation, applicability),
          },
        ];
  });
  const terms = source.terms.flatMap((term) =>
    partitionTerm(term, mechanism, input, router && mechanism === "sync"),
  );
  if (states.length === 0 && terms.length === 0) return;
  return {
    ...source,
    offer_key: router && mechanism === "sync" ? "router" : mechanism,
    name:
      router && mechanism === "sync"
        ? "Model Router"
        : mechanism === "batch"
          ? "Batch inference"
          : "Synchronous PAYG inference",
    enrollment: [],
    settlement: [],
    relations: [],
    states,
    terms,
  };
}

function partitionTerm(
  term: AtomicPricingTerm,
  mechanism: Mechanism,
  input: AtomicProviderPricing,
  router: boolean,
): AtomicPricingTerm[] {
  if (term.kind === "raw") {
    const variants = term.variants.flatMap((variant) => {
      if (variant.possible_scope === undefined) return mechanism === "sync" ? [variant] : [];
      const possible_scope = mechanismApplicability(variant.possible_scope, mechanism, input);
      return possible_scope === undefined ? [] : [{ ...variant, possible_scope }];
    });
    return variants.length === 0 ? [] : [{ ...term, variants }];
  }
  if (term.kind !== "rate") return mechanism === "sync" ? [term] : [];
  if (isCapacity(term.meter)) return [];
  const meter = router && isTextInput(term.meter) ? routerMeter(input) : term.meter;
  const variants = term.variants.flatMap((variant) => {
    const applicability = mechanismApplicability(variant.applicability, mechanism, input);
    if (applicability === undefined) return [];
    const observation = withApplicability(variant.observation, applicability);
    return [
      {
        ...variant,
        applicability,
        observation,
        charge_binding: modelChargeBinding(
          meter,
          variant.price.per,
          mechanism,
          observation,
          input,
          router,
        ),
      },
    ];
  });
  const raw_variants = term.raw_variants.flatMap((variant) => {
    if (variant.possible_scope === undefined) return mechanism === "sync" ? [variant] : [];
    const possible_scope = mechanismApplicability(variant.possible_scope, mechanism, input);
    return possible_scope === undefined ? [] : [{ ...variant, possible_scope }];
  });
  if (variants.length + raw_variants.length === 0) return [];
  return [
    {
      ...term,
      term_key: router && isTextInput(term.meter) ? "model_router_input" : term.term_key,
      meter,
      variants,
      raw_variants,
    },
  ];
}

function mechanismApplicability(
  applicability: PriceApplicability,
  mechanism: Mechanism,
  input: AtomicProviderPricing,
): PriceApplicability | undefined {
  const any_of = applicability.any_of.flatMap(({ all_of }) => {
    const tier = all_of.find(isServiceTier);
    const values = tier?.kind === "categorical" ? tier.values.map(({ value }) => value) : [];
    const batch = values.includes("batch");
    if ((mechanism === "batch") !== batch) return [];
    if (mechanism === "batch" || tier === undefined)
      return [{ all_of: tier === undefined ? all_of : all_of.filter((item) => item !== tier) }];
    if (tier.kind !== "categorical") return [];
    const realized: Extract<PriceCondition, { kind: "categorical" }> = {
      ...tier,
      dimension: servedTier,
      values: tier.values.map((value) => {
        addAtom(input, {
          kind: "categorical_value",
          key: value.value,
          dimension: servedTier,
          definition: `Azure response-reported served service tier ${JSON.stringify(value.value)}`,
          label: value.value === "priority" ? "Priority" : "Standard",
        });
        return value;
      }),
    };
    return [{ all_of: all_of.map((item) => (item === tier ? realized : item)) }];
  });
  return any_of.length === 0 ? undefined : canonicalizeApplicability({ any_of });
}

function modelChargeBinding(
  meter: PriceMeter,
  unit: UnitExpression,
  mechanism: Mechanism,
  observation: NormalizedPriceObservation,
  input: AtomicProviderPricing,
  router: boolean,
): ChargeBinding {
  const key =
    router && meter.namespace === "provider" && meter.value === "model_router_input"
      ? `router_input_${unitIdentityKey(unit)}`
      : `${mechanism === "batch" ? "batch_result" : "response"}_${meter.value}_${unitIdentityKey(unit)}`;
  return providerBinding(
    input,
    key,
    `${mechanism === "batch" ? "Completed Batch result" : "Azure inference response"} ${meter.value.replaceAll("_", " ")} usage`,
    unit,
    mechanism === "batch" ? "result_item" : "attempt",
    observation,
    `${mechanism === "batch" ? "batch-result" : "response"}:usage:${meter.value}`,
  );
}

function providerBinding(
  input: AtomicProviderPricing,
  key: string,
  definition: string,
  unit: UnitExpression,
  aggregation: ChargeBinding["aggregation"],
  observation: NormalizedPriceObservation,
  locator: string,
): ChargeBinding {
  addAtom(input, { kind: "usage_signal", key, definition, unit, resolution_phase: "outcome" });
  return {
    signal: { namespace: "provider", provider_id: input.provider_id, value: key },
    aggregation,
    observations: [
      {
        source_ref: observation.source_ref,
        locator: { kind: "provider_key", value: locator },
        raw: { fragment: locator },
      },
    ],
  };
}

function routerMeter(input: AtomicProviderPricing): PriceMeter {
  addAtom(input, {
    kind: "meter",
    key: "model_router_input",
    definition: "Azure Model Router input-token markup; selected-model inference is additive",
  });
  return { namespace: "provider", provider_id: input.provider_id, value: "model_router_input" };
}

function isServiceTier(condition: PriceCondition): boolean {
  return (
    condition.dimension.namespace === "kmodels" && condition.dimension.value === "service_tier"
  );
}

function isCapacity(meter: PriceMeter): boolean {
  return meter.namespace === "kmodels" && meter.value === "provisioned_capacity";
}

function isTextInput(meter: PriceMeter): boolean {
  return meter.namespace === "kmodels" && meter.value === "input_text";
}
