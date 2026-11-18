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

const capacitySignals = {
  marketplace: {
    key: "marketplace_billed_software_instance_time",
    definition:
      "Marketplace-billed software instance-time, prorated to the minute and expressed in instance-seconds",
  },
  hosting: {
    key: "sagemaker_billed_hosting_instance_time",
    definition:
      "AWS-billed hosting instance-time, expressed in instance-seconds; the price list does not establish a billing minimum",
  },
};

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
    offers: book.offers.map((offer) => ({
      ...offer,
      ...(offer.terms.some((term) => term.kind === "rate" && term.variants.length > 0)
        ? { name: "SageMaker hosting" }
        : {}),
      model_refs: refs,
    })),
  };
}

function linkEndpointDataProcessing(
  book: AtomicPricingBook,
  modelsBySource: ReadonlyMap<string, Set<string>>,
): AtomicPricingBook {
  if (
    book.scope.kind !== "provider_resource" ||
    book.scope.resource_key !== "endpoint-data-processing" ||
    modelsBySource.size === 0
  )
    return book;
  const modelRefs = [...new Set([...modelsBySource.values()].flatMap((refs) => [...refs]))];
  const scope = { ...book.scope, model_refs: modelRefs };
  return {
    ...book,
    scope,
    source_refs: [...new Set([...book.source_refs, ...modelsBySource.keys()])],
    scope_observations: [
      ...book.scope_observations,
      ...[...modelsBySource.entries()].map(([sourceRef, refs]) => ({
        source_ref: sourceRef,
        locator: { kind: "provider_key" as const, value: "deployment:realtime-endpoint" },
        establishes: { ...scope, model_refs: [...refs] },
        raw: { label: "Published real-time endpoint deployment" },
      })),
    ],
    offers: book.offers.map((offer) => ({ ...offer, model_refs: modelRefs })),
  };
}

// Commercial selection describes owned tariffs, independently of model capabilities.
export const sagemaker_commercialSelectionPolicy = {
  offers: {
    "realtime-inference": ["request"],
  },
  values: {},
} satisfies import("./commercial-selection.ts").CommercialSelectionPolicy;

export function applySagemakerCommercialTopology(
  input: AtomicProviderPricing,
  publishedModels: readonly PublishedPricingModel[],
): AtomicProviderPricing {
  const modelsByInstance = new Map<string, string[]>();
  const endpointModelsBySource = new Map<string, Set<string>>();
  const currentModels = new Set(
    publishedModels.filter(({ status }) => status !== "retired").map(({ uid }) => uid),
  );
  const addEndpointModels = (sourceRef: string, refs: readonly string[]) => {
    for (const ref of refs) {
      if (!currentModels.has(ref)) continue;
      const models = endpointModelsBySource.get(sourceRef) ?? new Set<string>();
      models.add(ref);
      endpointModelsBySource.set(sourceRef, models);
    }
  };
  for (const model of publishedModels) {
    const instances = new Set(
      model.deployment?.profiles.flatMap((profile) => profile.instance_types) ?? [],
    );
    if (instances.size > 0) addEndpointModels("sagemaker-sdk", [model.uid]);
    for (const instance of instances) {
      const refs = modelsByInstance.get(instance) ?? [];
      refs.push(model.uid);
      modelsByInstance.set(instance, refs);
    }
  }
  for (const book of input.books) {
    if (
      book.scope.kind !== "provider_resource" ||
      !/^marketplace-(?:software-)?prodview-/.test(book.scope.resource_key)
    )
      continue;
    for (const { source_ref, establishes } of book.scope_observations)
      addEndpointModels(source_ref, establishes.model_refs);
  }
  return {
    ...input,
    books: input.books.flatMap(marketplaceModelBooks).map((original) => {
      const book = linkEndpointDataProcessing(
        linkHostingModels(original, modelsByInstance),
        endpointModelsBySource,
      );
      return {
        ...book,
        offers: book.offers.map((offer) => ({
          ...offer,
          terms: offer.terms.map((term) =>
            bindRateTerm(term, (meter, variant) => {
              const isCapacity =
                meter.namespace === "kmodels" && meter.value === "provisioned_capacity";
              const marketplace =
                isCapacity &&
                book.scope.kind === "provider_resource" &&
                book.scope.resource_key.startsWith("marketplace-software-");
              const signal = isCapacity
                ? capacitySignals[marketplace ? "marketplace" : "hosting"]
                : signals.get(meter.value);
              if (signal === undefined) return undefined;
              addAtom(input, {
                kind: "usage_signal",
                ...signal,
                unit: variant.price.per,
                resolution_phase: isCapacity ? "account" : "outcome",
              });
              return {
                signal: {
                  namespace: "provider",
                  provider_id: input.provider_id,
                  value: signal.key,
                },
                aggregation: isCapacity ? "resource" : "request",
                observations: [rawEvidence(variant.observation)],
              };
            }),
          ),
        })),
      };
    }),
  };
}
