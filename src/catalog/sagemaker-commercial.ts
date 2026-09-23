import type { AtomicPricingBook, AtomicProviderPricing } from "./pricing-assembly.ts";
import type { PublishedPricingModel } from "./pricing-adapter.ts";
import { addAtom, bindRateTerm, rawEvidence } from "./pricing-commercial-assembly.ts";

const signals = new Map([
  [
    "input_data",
    {
      key: "endpoint_input_gb",
      definition:
        "Request input data processing in AWS-billed GB; excludes general network transfer",
    },
  ],
  [
    "output_data",
    {
      key: "endpoint_output_gb",
      definition:
        "Request output data processing in AWS-billed GB; excludes general network transfer",
    },
  ],
  [
    "compute",
    {
      key: "serverless_execution_seconds",
      definition:
        "AWS-billed Serverless inference execution seconds for the selected memory size and execution tier; excludes reserved concurrency capacity and client wall-clock time",
    },
  ],
  [
    "inference",
    {
      key: "marketplace_billable_inferences",
      definition:
        "Publisher-metered billable real-time inferences for this Marketplace listing; not an assumed count of HTTP requests",
    },
  ],
]);

function marketplaceModelBooks(book: AtomicPricingBook): AtomicPricingBook[] {
  if (
    book.scope.kind !== "provider_resource" ||
    !book.scope.resource_key.startsWith("marketplace-prodview-")
  ) {
    return [book];
  }
  if (book.scope.model_refs.length === 0) {
    throw new Error("SageMaker Marketplace pricing requires an exact model association");
  }
  return book.scope.model_refs.map((modelRef) => {
    const scope = { kind: "models" as const, model_refs: [modelRef] };
    return {
      ...book,
      book_key: `model:${modelRef}`,
      name: `Pricing for ${modelRef}`,
      scope,
      scope_observations: book.scope_observations.map((observation) => ({
        ...observation,
        establishes: scope,
      })),
      offers: book.offers.map((offer) => ({
        ...offer,
        offer_key: "realtime-inference",
        name: "Real-time inference · Marketplace software",
        model_refs: [modelRef],
      })),
    };
  });
}

function linkHostingModels(
  book: AtomicPricingBook,
  modelsByInstance: ReadonlyMap<string, string[]>,
): AtomicPricingBook {
  // SDK profiles establish instance compatibility; regional price variants do not establish
  // that the model can be deployed in every priced Region.
  if (
    book.scope.kind !== "provider_resource" ||
    book.scope.resource_kind.namespace !== "kmodels" ||
    book.scope.resource_kind.value !== "capacity" ||
    !book.scope.resource_key.startsWith("hosting-ml.")
  )
    return book;
  const instance = book.scope.resource_key.slice("hosting-".length);
  const refs = modelsByInstance.get(instance) ?? [];
  if (refs.length === 0) return book;
  const scope = { ...book.scope, model_refs: refs };
  return {
    ...book,
    scope,
    source_refs: [...book.source_refs, "sagemaker-sdk"],
    scope_observations: [
      ...book.scope_observations,
      {
        source_ref: "sagemaker-sdk",
        locator: { kind: "provider_key", value: `deployment:${instance}` },
        establishes: scope,
        raw: { label: `Published deployment profiles support ${instance}` },
      },
    ],
    offers: book.offers.map((offer) => ({ ...offer, model_refs: refs })),
  };
}

export function applySagemakerCommercialTopology(
  input: AtomicProviderPricing,
  publishedModels: readonly PublishedPricingModel[],
): AtomicProviderPricing {
  const modelsByInstance = new Map<string, string[]>();
  for (const model of publishedModels) {
    for (const instance of new Set(
      model.deployment?.profiles.flatMap((profile) => profile.instance_types) ?? [],
    )) {
      const refs = modelsByInstance.get(instance) ?? [];
      refs.push(model.uid);
      modelsByInstance.set(instance, refs);
    }
  }
  return {
    ...input,
    books: input.books.flatMap(marketplaceModelBooks).map((original) => {
      const book = linkHostingModels(original, modelsByInstance);
      return {
        ...book,
        offers: book.offers.map((offer) => ({
          ...offer,
          terms: offer.terms.map((term) =>
            bindRateTerm(term, (meter, variant) => {
              if (meter.namespace === "kmodels" && meter.value === "provisioned_capacity") {
                const marketplace =
                  book.scope.kind === "provider_resource" &&
                  book.scope.resource_key.startsWith("marketplace-software-");
                const key = marketplace
                  ? "marketplace_billed_software_instance_time"
                  : "sagemaker_billed_hosting_instance_time";
                addAtom(input, {
                  kind: "usage_signal",
                  key,
                  definition: marketplace
                    ? "Marketplace-billed software instance-time, prorated to the minute and expressed in instance-seconds"
                    : "AWS-billed hosting instance-time, expressed in instance-seconds; the price list does not establish a billing minimum",
                  unit: variant.price.per,
                  resolution_phase: "account",
                });
                return {
                  signal: { namespace: "provider", provider_id: input.provider_id, value: key },
                  aggregation: "resource",
                  observations: [rawEvidence(variant.observation)],
                };
              }
              const signal = signals.get(meter.value);
              if (signal === undefined) return undefined;
              addAtom(input, {
                kind: "usage_signal",
                ...signal,
                unit: variant.price.per,
                resolution_phase: "outcome",
              });
              return {
                signal: {
                  namespace: "provider",
                  provider_id: input.provider_id,
                  value: signal.key,
                },
                aggregation: "request",
                observations: [rawEvidence(variant.observation)],
              };
            }),
          ),
        })),
      };
    }),
  };
}
