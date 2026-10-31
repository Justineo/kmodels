import { canonicalJson, uniqueCanonicalValues } from "./canonical-value.ts";
import { calculationExport } from "./pricing-calculator-export.ts";
import type { PricingCatalogEnvelope } from "./pricing-schema.ts";
import type { Catalog } from "./schema.ts";
import { createInferencePriceLookup } from "../pricing/inference.ts";
import {
  inferencePriceMappingSchema,
  type InferencePriceMapping,
} from "../pricing/inference-schema.ts";

export const inferencePricingPath = "pricing/inference.json";
export const inferencePricingMaxBytes = 16 * 1024 * 1024;

/** The additive mapping resource references the existing catalog and price snapshot. */
export function inferencePricingPublication(
  catalog: Catalog,
  pricing: PricingCatalogEnvelope,
  input: unknown,
) {
  const parsed = inferencePriceMappingSchema.parse(input);
  if (
    parsed.core_catalog_version !== catalog.catalog_version ||
    parsed.pricing_data_version !== pricing.pricing_data_version
  )
    throw new Error("Inference mappings do not match the accepted catalog and prices");
  for (const source of parsed.sources) {
    const { provider_id, ...record } = source;
    const current = catalog.sources.find(({ id }) => id === source.id);
    const historical = pricing.data.provider_snapshots.find(
      (snapshot) => snapshot.provider_id === provider_id,
    )?.source_records;
    if (
      current?.provider_id !== provider_id ||
      ![
        ...(historical ?? []),
        {
          id: current.id,
          url: current.url,
          observed_at: current.observed_at,
          content_hash: current.content_hash,
          extractor_version: current.extractor_version,
        },
      ].some((candidate) => canonicalJson(candidate) === canonicalJson(record))
    )
      throw new Error("Inference mapping evidence has an unknown source revision");
  }
  const mapping: InferencePriceMapping = {
    ...parsed,
    rules: uniqueCanonicalValues(parsed.rules),
    sources: uniqueCanonicalValues(parsed.sources),
  };
  for (const providerId of new Set(mapping.rules.map(({ provider_id }) => provider_id))) {
    createInferencePriceLookup(calculationExport(catalog, pricing, [providerId]), {
      ...mapping,
      rules: mapping.rules.filter(({ provider_id }) => provider_id === providerId),
      sources: mapping.sources.filter(({ provider_id }) => provider_id === providerId),
    });
  }
  const source = canonicalJson(mapping);
  if (Buffer.byteLength(source) > inferencePricingMaxBytes)
    throw new Error("Inference mapping resource exceeds its size limit");
  return { mapping, source };
}

export type InferencePricingPublication = ReturnType<typeof inferencePricingPublication>;
