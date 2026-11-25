import { canonicalJson, compareUtf8, uniqueCanonicalValues } from "./canonical-value.ts";
import {
  priceDataSchemaVersion,
  type Evidence,
  type PriceDataBook,
  type PriceDataEnvelope,
  type PriceDataOffer,
  type PriceDataProvider,
  type PriceDataRaw,
  type PriceDataSelection,
  type PriceDataTerm,
} from "../pricing/schema.ts";
import type {
  PriceApplicability,
  PricingBook,
  PricingCatalogEnvelope,
  PricingOffer,
  PricingTerm,
  ProviderPricingSnapshot,
  RawPriceObservation,
  RawPricingVariant,
} from "./pricing-schema.ts";
import type { Catalog } from "./schema.ts";
import { priceDataCoverage } from "./pricing-coverage.ts";
import { snapshotSourceRecords } from "./pricing-source-records.ts";

export function priceDataExport(
  catalog: Catalog,
  pricing: PricingCatalogEnvelope,
  providerIds?: readonly string[],
): PriceDataEnvelope {
  const selectedProviders = selectProviderIds(pricing, providerIds);
  const notApplicableModels = new Set(
    pricing.data.model_dispositions.map((model) => model.model_ref),
  );
  const providers: PriceDataProvider[] = [];
  for (const snapshot of pricing.data.provider_snapshots) {
    if (selectedProviders.has(snapshot.provider_id)) {
      providers.push(exportProvider(catalog, pricing, snapshot, notApplicableModels));
    }
  }
  return {
    schemaVersion: priceDataSchemaVersion,
    snapshot: {
      pricingDataVersion: pricing.pricing_data_version,
      coreCatalogVersion: pricing.core_catalog_version,
      generatedAt: pricing.generated_at,
    },
    providers,
  };
}

function selectProviderIds(
  pricing: PricingCatalogEnvelope,
  requestedIds?: readonly string[],
): Set<string> {
  const availableIds = new Set(
    pricing.data.provider_snapshots.map((snapshot) => snapshot.provider_id),
  );
  const requested = requestedIds ?? [...availableIds];
  const selected = new Set(requested);
  const includesUnknownProvider = requested.some((id) => !availableIds.has(id));
  if (selected.size === 0 || selected.size !== requested.length || includesUnknownProvider) {
    throw new Error("Select one or more unique complete provider partitions");
  }
  return selected;
}

function exportProvider(
  catalog: Catalog,
  pricing: PricingCatalogEnvelope,
  snapshot: ProviderPricingSnapshot,
  notApplicableModels: Set<string>,
): PriceDataProvider {
  const providerId = snapshot.provider_id;
  const vocabulary = pricing.data.provider_vocabularies.find(
    (vocabulary) => vocabulary.provider_id === providerId,
  );
  if (vocabulary === undefined) throw new Error("Provider vocabulary is missing");
  const books = pricing.data.books.filter((book) => book.provider_id === providerId);
  const models = catalog.models.filter((model) => model.provider_id === providerId);
  const modelRefs = new Set(models.map(({ uid }) => uid));
  const modelsWithOffers = new Set<string>();
  for (const book of books) {
    for (const offer of book.offers) {
      for (const modelRef of offer.model_refs ?? book.scope.model_refs)
        modelsWithOffers.add(modelRef);
    }
  }
  const { applicabilities, intern } = buildApplicabilityTable(books);
  return {
    snapshot:
      snapshot.publication === "fresh"
        ? {
            provider_id: snapshot.provider_id,
            observed_at: snapshot.observed_at,
            publication: snapshot.publication,
          }
        : {
            provider_id: snapshot.provider_id,
            observed_at: snapshot.observed_at,
            publication: snapshot.publication,
            refresh_failure: snapshot.refresh_failure,
          },
    vocabulary,
    applicabilities,
    books: books.map((book) => exportBook(book, intern)),
    models: models.map((model) => ({
      model_ref: model.uid,
      disposition: modelDisposition(model.uid, modelsWithOffers, notApplicableModels),
    })),
    sources: snapshotSourceRecords(
      {
        snapshot,
        vocabulary,
        books,
        model_dispositions: pricing.data.model_dispositions.filter(({ model_ref }) =>
          modelRefs.has(model_ref),
        ),
      },
      catalog.sources,
    ),
  };
}

function buildApplicabilityTable(books: readonly PricingBook[]): {
  applicabilities: PriceApplicability[];
  intern: (scope: PriceApplicability) => number;
} {
  const unique = new Map<string, PriceApplicability>();
  const collect = (scope: PriceApplicability) => {
    const key = canonicalJson(scope);
    if (!unique.has(key)) unique.set(key, scope);
  };
  for (const book of books) {
    for (const offer of book.offers) {
      for (const state of offer.states) collect(state.applicability);
      for (const claim of offer.selection ?? []) {
        collect(claim.applicability);
        for (const alternative of claim.alternatives) collect(alternative.applicability);
      }
      for (const relation of offer.relations) collect(relation.applicability);
      for (const term of offer.terms) {
        if (term.kind === "raw") {
          for (const variant of term.variants) {
            if (variant.possible_scope !== undefined) collect(variant.possible_scope);
          }
        } else {
          for (const variant of term.variants) collect(variant.applicability);
          for (const variant of term.raw_variants) {
            if (variant.possible_scope !== undefined) collect(variant.possible_scope);
          }
        }
      }
    }
  }
  const sortedEntries = [...unique.entries()].sort(([left], [right]) => compareUtf8(left, right));
  const applicabilities: PriceApplicability[] = [];
  const index = new Map<string, number>();
  for (const [key, scope] of sortedEntries) {
    index.set(key, applicabilities.length);
    applicabilities.push(scope);
  }
  return {
    applicabilities,
    intern: (scope) => {
      const id = index.get(canonicalJson(scope));
      if (id === undefined) throw new Error("Unindexed applicability");
      return id;
    },
  };
}

function modelDisposition(
  modelRef: string,
  modelsWithOffers: Set<string>,
  notApplicableModels: Set<string>,
): PriceDataProvider["models"][number]["disposition"] {
  if (modelsWithOffers.has(modelRef)) return "offers";
  if (notApplicableModels.has(modelRef)) return "not_applicable";
  return "unknown";
}

function toEvidence(
  observations: readonly Pick<RawPriceObservation, "source_ref" | "locator">[],
): Evidence[] {
  return uniqueCanonicalValues(
    observations.map(({ source_ref, locator }) => ({ source_ref, locator })),
  );
}

function exportRawVariant(
  variant: RawPricingVariant,
  intern: (scope: PriceApplicability) => number,
): PriceDataRaw {
  return {
    impact: variant.impact,
    reason: variant.reason,
    ...(variant.resolution_policy === undefined
      ? {}
      : { resolution_policy: variant.resolution_policy }),
    ...(variant.possible_scope === undefined
      ? {}
      : { possible_scope_id: intern(variant.possible_scope) }),
    ...(variant.validity === undefined ? {} : { validity: variant.validity }),
    evidence: toEvidence(variant.observations),
  };
}

function exportQualified(
  variant: {
    readonly applicability: PriceApplicability;
    readonly validity?: PricingOffer["states"][number]["validity"];
    readonly observations: Parameters<typeof toEvidence>[0];
  },
  intern: (scope: PriceApplicability) => number,
) {
  return {
    applicability_id: intern(variant.applicability),
    ...(variant.validity === undefined ? {} : { validity: variant.validity }),
    evidence: toEvidence(variant.observations),
  };
}

function exportTerm(
  term: PricingTerm,
  intern: (scope: PriceApplicability) => number,
): PriceDataTerm {
  if (term.kind === "raw") {
    return {
      id: term.id,
      term_key: term.term_key,
      source_refs: term.source_refs,
      kind: "raw",
      variants: term.variants.map((variant) => exportRawVariant(variant, intern)),
    };
  }
  const raw_variants = term.raw_variants.map((variant) => exportRawVariant(variant, intern));
  if (term.kind === "rate") {
    return {
      id: term.id,
      term_key: term.term_key,
      source_refs: term.source_refs,
      kind: "rate",
      meter: term.meter,
      variants: term.variants.map((variant) => ({
        price: variant.price,
        ...exportQualified(variant, intern),
      })),
      raw_variants,
    };
  }
  if (term.kind === "allowance") {
    return {
      id: term.id,
      term_key: term.term_key,
      source_refs: term.source_refs,
      kind: "allowance",
      variants: term.variants.map((variant) => ({
        benefit: variant.benefit,
        target: variant.target,
        reset: variant.reset,
        ...exportQualified(variant, intern),
      })),
      raw_variants,
    };
  }
  return {
    id: term.id,
    term_key: term.term_key,
    source_refs: term.source_refs,
    kind: "contribution",
    variants: term.variants.map((variant) => ({
      target_rate_refs: variant.target_rate_refs,
      ...exportQualified(variant, intern),
    })),
    raw_variants,
  };
}

function exportOffer(
  offer: PricingOffer,
  intern: (scope: PriceApplicability) => number,
): PriceDataOffer {
  const selection: PriceDataSelection[] | undefined = offer.selection?.map((claim) => ({
    dimension: claim.dimension,
    ...(claim.target === undefined ? {} : { target: claim.target }),
    coverage: claim.coverage,
    ...(claim.excluded_values === undefined ? {} : { excluded_values: claim.excluded_values }),
    alternatives: claim.alternatives.map((alternative) => ({
      value: alternative.value,
      applicability_id: intern(alternative.applicability),
    })),
    ...exportQualified(claim, intern),
  }));
  return {
    id: offer.id,
    offer_key: offer.offer_key,
    ...(offer.name === undefined ? {} : { name: offer.name }),
    ...(offer.model_refs === undefined ? {} : { model_refs: offer.model_refs }),
    billing_mode: offer.billing_mode,
    states: offer.states.map((state) => ({
      state: state.state,
      ...exportQualified(state, intern),
    })),
    ...(selection === undefined ? {} : { selection }),
    terms: offer.terms.map((term) => exportTerm(term, intern)),
    relations: offer.relations.map((relation) => ({
      kind: relation.kind,
      target: relation.target,
      ...exportQualified(relation, intern),
    })),
    source_refs: offer.source_refs,
  };
}

function exportBook(
  book: PricingBook,
  intern: (scope: PriceApplicability) => number,
): PriceDataBook {
  return {
    id: book.id,
    provider_id: book.provider_id,
    book_key: book.book_key,
    ...(book.name === undefined ? {} : { name: book.name }),
    scope: book.scope,
    evidence: toEvidence(book.scope_observations),
    offers: book.offers.map((offer) => exportOffer(offer, intern)),
    source_refs: book.source_refs,
  };
}

export function priceDataExportAssets(
  envelope: PriceDataEnvelope,
): Array<{ fileName: string; source: string }> {
  if (envelope.providers.length === 0) return [];
  return [
    { fileName: "pricing/lookup/index.json", source: canonicalJson(envelope) },
    {
      fileName: "pricing/lookup/coverage.json",
      source: canonicalJson(priceDataCoverage(envelope)),
    },
    ...envelope.providers.map((provider) => ({
      fileName: `pricing/lookup/providers/${provider.snapshot.provider_id}.json`,
      source: canonicalJson({ ...envelope, providers: [provider] }),
    })),
  ];
}
