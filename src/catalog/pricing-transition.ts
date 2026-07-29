import { compareUtf8 } from "./canonical-value.ts";
import type { ProviderPricingPartition } from "./pricing-assembly.ts";
import type {
  PricingCatalog,
  PricingRefreshFailure,
  PricingRefreshFailureCode,
} from "./pricing-schema.ts";

export type ProviderPricingTransition =
  | {
      kind: "fresh";
      partition: ProviderPricingPartition;
    }
  | {
      kind: "failed";
      provider_id: string;
      failure: PricingRefreshFailure;
    }
  | {
      kind: "fresh_empty" | "remove_provider" | "withdraw_pricing";
      provider_id: string;
    };

export function pricingTransitionProviderId(transition: ProviderPricingTransition): string {
  return transition.kind === "fresh"
    ? transition.partition.snapshot.provider_id
    : transition.provider_id;
}

export function failedPricingTransition(
  providerId: string,
  attemptedAt: string,
  code: PricingRefreshFailureCode,
): ProviderPricingTransition {
  return {
    kind: "failed",
    provider_id: providerId,
    failure: { attempted_at: attemptedAt, code },
  };
}

export function transitionProviderPricing(
  prior: PricingCatalog,
  transition: ProviderPricingTransition,
  modelProvider: (modelRef: string) => string,
): PricingCatalog {
  const providerId = pricingTransitionProviderId(transition);
  const previous = providerPartition(prior, providerId, modelProvider);
  if (transition.kind === "failed") {
    if (previous === undefined) return prior;
    return replaceProvider(
      prior,
      {
        ...previous,
        snapshot: {
          ...previous.snapshot,
          publication: "retained",
          refresh_failure: transition.failure,
        },
      },
      modelProvider,
    );
  }
  if (transition.kind === "fresh") {
    if (transition.partition.snapshot.publication !== "fresh")
      throw new Error("Pricing advancement must carry a fresh provider snapshot");
    return replaceProvider(prior, transition.partition, modelProvider);
  }
  return removeProvider(prior, providerId, modelProvider);
}

export function providerPartition(
  data: PricingCatalog,
  providerId: string,
  modelProvider: (modelRef: string) => string,
): ProviderPricingPartition | undefined {
  const vocabulary = data.provider_vocabularies.find(
    ({ provider_id }) => provider_id === providerId,
  );
  const snapshot = data.provider_snapshots.find(({ provider_id }) => provider_id === providerId);
  const books = data.books.filter(({ provider_id }) => provider_id === providerId);
  const model_dispositions = data.model_dispositions.filter(
    ({ model_ref }) => modelProvider(model_ref) === providerId,
  );
  const present =
    vocabulary !== undefined ||
    snapshot !== undefined ||
    books.length > 0 ||
    model_dispositions.length > 0;
  if (!present) return undefined;
  if (vocabulary === undefined || snapshot === undefined)
    throw new Error(`Provider ${providerId} has an incomplete pricing partition`);
  return { vocabulary, snapshot, model_dispositions, books };
}

export function providerPartitionSourceRefs(partition: ProviderPricingPartition): string[] {
  const refs = new Set<string>();
  const addObservation = ({ source_ref }: { source_ref: string }): void => {
    refs.add(source_ref);
  };
  partition.model_dispositions.forEach(({ observations }) => observations.forEach(addObservation));
  for (const book of partition.books) {
    book.source_refs.forEach((sourceRef) => refs.add(sourceRef));
    book.scope_observations.forEach(addObservation);
    for (const offer of book.offers) {
      offer.source_refs.forEach((sourceRef) => refs.add(sourceRef));
      offer.states.forEach(({ observations }) => observations.forEach(addObservation));
      if (offer.role === "add_on") offer.compatibility_observations.forEach(addObservation);
      for (const term of offer.terms) {
        term.source_refs.forEach((sourceRef) => refs.add(sourceRef));
        const variants =
          term.kind === "raw" ? term.variants : [...term.variants, ...term.raw_variants];
        variants.forEach(({ observations }) => observations.forEach(addObservation));
      }
    }
  }
  return [...refs].sort(compareUtf8);
}

function replaceProvider(
  data: PricingCatalog,
  partition: ProviderPricingPartition,
  modelProvider: (modelRef: string) => string,
): PricingCatalog {
  const providerId = partition.snapshot.provider_id;
  const without = removeProvider(data, providerId, modelProvider);
  return {
    provider_vocabularies: [...without.provider_vocabularies, partition.vocabulary].sort(
      byProvider,
    ),
    provider_snapshots: [...without.provider_snapshots, partition.snapshot].sort(byProvider),
    model_dispositions: [...without.model_dispositions, ...partition.model_dispositions].sort(
      (left, right) => compareUtf8(left.model_ref, right.model_ref),
    ),
    books: [...without.books, ...partition.books].sort((left, right) =>
      compareUtf8(left.id, right.id),
    ),
  };
}

function removeProvider(
  data: PricingCatalog,
  providerId: string,
  modelProvider: (modelRef: string) => string,
): PricingCatalog {
  return {
    provider_vocabularies: data.provider_vocabularies.filter(
      ({ provider_id }) => provider_id !== providerId,
    ),
    provider_snapshots: data.provider_snapshots.filter(
      ({ provider_id }) => provider_id !== providerId,
    ),
    model_dispositions: data.model_dispositions.filter(
      ({ model_ref }) => modelProvider(model_ref) !== providerId,
    ),
    books: data.books.filter(({ provider_id }) => provider_id !== providerId),
  };
}

function byProvider(left: { provider_id: string }, right: { provider_id: string }): number {
  return compareUtf8(left.provider_id, right.provider_id);
}
