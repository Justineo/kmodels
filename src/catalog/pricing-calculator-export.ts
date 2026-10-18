import { canonicalJson, uniqueCanonicalValues } from "./canonical-value.ts";
import {
  calculationBookSchema,
  calculationSchemaVersion,
  type CalculationEnvelope,
  type CalculationProvider,
} from "../pricing/schema.ts";
import type {
  PricingCatalogEnvelope,
  PricingBook,
  ProviderPricingSnapshot,
} from "./pricing-schema.ts";
import type { Catalog } from "./schema.ts";
import { calculationCoverage } from "./pricing-calculation-coverage.ts";
import { snapshotSourceRecords } from "./pricing-source-records.ts";
import { validatePriceData } from "../pricing/validation.ts";

export function calculationExport(
  catalog: Catalog,
  pricing: PricingCatalogEnvelope,
  providerIds?: readonly string[],
): CalculationEnvelope {
  const selectedProviders = selectProviderIds(pricing, providerIds);
  const notApplicableModels = new Set(
    pricing.data.model_dispositions.map((model) => model.model_ref),
  );
  const providers: CalculationProvider[] = [];
  for (const snapshot of pricing.data.provider_snapshots) {
    if (selectedProviders.has(snapshot.provider_id)) {
      providers.push(exportProvider(catalog, pricing, snapshot, notApplicableModels));
    }
  }
  return {
    schemaVersion: calculationSchemaVersion,
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
): CalculationProvider {
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
): CalculationProvider["models"][number]["disposition"] {
  if (modelsWithOffers.has(modelRef)) return "offers";
  if (notApplicableModels.has(modelRef)) return "not_applicable";
  return "unknown";
}

function exportBook(book: PricingBook): CalculationProvider["books"][number] {
  return calculationBookSchema.parse(replaceObservationsWithEvidence(book));
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

export function calculationExportAssets(
  catalog: Catalog,
  pricing: PricingCatalogEnvelope,
): Array<{ fileName: string; source: string }> {
  if (pricing.data.provider_snapshots.length === 0) return [];
  const envelope = validatePriceData(calculationExport(catalog, pricing));
  return [
    { fileName: "pricing/calculation/index.json", source: canonicalJson(envelope) },
    {
      fileName: "pricing/calculation/coverage.json",
      source: canonicalJson(calculationCoverage(envelope)),
    },
    ...envelope.providers.map((provider) => ({
      fileName: `pricing/calculation/providers/${provider.snapshot.provider_id}.json`,
      source: canonicalJson({ ...envelope, providers: [provider] }),
    })),
  ];
}
