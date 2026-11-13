import { canonicalJson, uniqueCanonicalValues } from "./canonical-value.ts";
import {
  priceDataBookSchema,
  priceDataSchemaVersion,
  type PriceDataEnvelope,
  type PriceDataProvider,
} from "../pricing/schema.ts";
import type {
  PricingCatalogEnvelope,
  PricingBook,
  ProviderPricingSnapshot,
} from "./pricing-schema.ts";
import type { Catalog } from "./schema.ts";
import { priceDataCoverage } from "./pricing-coverage.ts";
import { snapshotSourceRecords } from "./pricing-source-records.ts";
import { validatePriceData } from "../pricing/validation.ts";

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
    books: books.map(exportBook),
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

function modelDisposition(
  modelRef: string,
  modelsWithOffers: Set<string>,
  notApplicableModels: Set<string>,
): PriceDataProvider["models"][number]["disposition"] {
  if (modelsWithOffers.has(modelRef)) return "offers";
  if (notApplicableModels.has(modelRef)) return "not_applicable";
  return "unknown";
}

function exportBook(book: PricingBook): PriceDataProvider["books"][number] {
  return priceDataBookSchema.parse(
    replaceObservationsWithEvidence({
      ...book,
      offers: book.offers.map(
        ({ selection: _selection, source_contexts: _contexts, ...offer }) => offer,
      ),
    }),
  );
}

function replaceObservationsWithEvidence(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(replaceObservationsWithEvidence);
  if (value === null || typeof value !== "object") return value;
  const projected: Record<string, unknown> = {};
  for (const [property, child] of Object.entries(value)) {
    if (child === undefined) continue;
    if (
      (property === "observations" || property === "scope_observations") &&
      Array.isArray(child)
    ) {
      projected["evidence"] = uniqueCanonicalValues(child.map(evidenceReference));
    } else {
      projected[property] = replaceObservationsWithEvidence(child);
    }
  }
  return projected;
}

function evidenceReference(observation: unknown) {
  if (
    observation === null ||
    typeof observation !== "object" ||
    !("source_ref" in observation) ||
    !("locator" in observation)
  ) {
    throw new Error("Invalid canonical evidence");
  }
  return { source_ref: observation.source_ref, locator: observation.locator };
}

export function priceDataExportAssets(
  catalog: Catalog,
  pricing: PricingCatalogEnvelope,
): Array<{ fileName: string; source: string }> {
  if (pricing.data.provider_snapshots.length === 0) return [];
  const envelope = validatePriceData(priceDataExport(catalog, pricing));
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
