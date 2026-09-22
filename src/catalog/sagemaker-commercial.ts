import type { AtomicPricingBook, AtomicProviderPricing } from "./pricing-assembly.ts";
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

export function applySagemakerCommercialTopology(
  input: AtomicProviderPricing,
): AtomicProviderPricing {
  return {
    ...input,
    books: input.books.flatMap(marketplaceModelBooks).map((book) => ({
      ...book,
      offers: book.offers.map((offer) => ({
        ...offer,
        terms: offer.terms.map((term) =>
          bindRateTerm(term, (meter, variant) => {
            const signal = signals.get(meter.value);
            if (signal === undefined) return undefined;
            addAtom(input, {
              kind: "usage_signal",
              ...signal,
              unit: variant.price.per,
              resolution_phase: "outcome",
            });
            return {
              signal: { namespace: "provider", provider_id: input.provider_id, value: signal.key },
              aggregation: "request",
              observations: [rawEvidence(variant.observation)],
            };
          }),
        ),
      })),
    })),
  };
}
