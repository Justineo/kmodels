import { canonicalJson } from "./canonical-value.ts";
import { sha256 } from "./io.ts";
import { invocationProviderPartition } from "./invocation-collection.ts";
import { calculationCoverage } from "./pricing-calculation-coverage.ts";
import { calculationExport } from "./pricing-calculator-export.ts";
import type { Catalog } from "./schema.ts";
import type { V2Publication } from "./publication-v2.ts";
import { invocationSourceSchema, type CalculationV2Envelope } from "../pricing/v2/schema.ts";
import { evaluatorEnvelope, validatePriceData } from "../pricing/v2/validation.ts";
import type { AssetSource } from "./asset-pack.ts";

export async function calculationV2Export(
  publication: V2Publication,
  providerIds?: readonly string[],
): Promise<CalculationV2Envelope> {
  // P2 owns the commercial facts; P1 is not a source of v2 rates or bindings.
  const { invocation_bindings: bindings, ...priceData } = publication.pricing.data;
  const catalog: Catalog = {
    catalog_version: publication.catalog.catalog_version,
    generated_at: publication.catalog.generated_at,
    providers: publication.catalog.data.providers,
    models: publication.catalog.data.models,
    sources: publication.catalog.data.sources,
    coverage: publication.catalog.data.coverage,
    warnings: publication.catalog.warnings,
  };
  const base = calculationExport(catalog, { ...publication.pricing, data: priceData }, providerIds);
  return validatePriceData({
    schemaVersion: "2.0",
    snapshot: {
      pricingDataVersion: publication.pricing.pricing_data_version,
      coreCatalogVersion: publication.catalog.catalog_version,
      generatedAt: publication.catalog.generated_at,
      coreDataSha256: publication.pricing.core_data_sha256,
      pricingAssetSha256: sha256(publication.pricingSource),
    },
    providers: base.providers.map((provider) => {
      const modelRefs = new Set(provider.models.map(({ model_ref }) => model_ref));
      const invocation = invocationProviderPartition(
        publication.catalog.data,
        modelRefs,
        provider.snapshot.provider_id,
      );
      const targets = new Set(invocation.invocation_targets.map(({ id }) => id));
      const invocationBindings = bindings.filter(({ target_ref }) => targets.has(target_ref));
      const evidenceRefs = new Set([
        ...invocation.invocation_evidence.map(({ id }) => id),
        ...invocationBindings.flatMap((binding) => [
          ...binding.evidence_refs,
          ...binding.selectors.flatMap(({ evidence_refs }) => evidence_refs),
        ]),
      ]);
      invocation.invocation_evidence = publication.catalog.data.invocation_evidence.filter(
        ({ id }) => evidenceRefs.has(id),
      );
      const sourceRefs = new Set(
        invocation.invocation_evidence.map(({ source_ref }) => source_ref),
      );
      return {
        ...provider,
        invocation,
        invocation_sources: publication.catalog.data.sources
          .filter(({ id }) => sourceRefs.has(id))
          .map((source) => invocationSourceSchema.strip().parse(source)),
        invocation_bindings: invocationBindings,
      };
    }),
  });
}

export async function calculationV2ExportAssets(
  publication: V2Publication,
): Promise<AssetSource[]> {
  if (publication.pricing.data.provider_snapshots.length === 0) return [];
  const envelope = await calculationV2Export(publication);
  return [
    { fileName: "pricing/v2/calculation/index.json", source: canonicalJson(envelope) },
    {
      fileName: "pricing/v2/calculation/coverage.json",
      source: canonicalJson(calculationV2Coverage(envelope)),
    },
    ...envelope.providers.map((provider) => ({
      fileName: `pricing/v2/calculation/providers/${provider.snapshot.provider_id}.json`,
      source: canonicalJson({ ...envelope, providers: [provider] }),
    })),
  ];
}

export function calculationV2Coverage(envelope: CalculationV2Envelope) {
  const coverage = calculationCoverage(evaluatorEnvelope(envelope));
  return {
    ...coverage,
    schemaVersion: envelope.schemaVersion,
    snapshot: envelope.snapshot,
    providers: coverage.providers.map((provider) => {
      const partition = envelope.providers.find(
        ({ snapshot }) => snapshot.provider_id === provider.snapshot.provider_id,
      );
      if (partition === undefined) throw new Error("Missing v2 coverage partition");
      return {
        ...provider,
        targetCoverage: partition.invocation.target_coverage,
        invocationBindings: partition.invocation_bindings.map(
          ({ target_ref, case_ref, offer_refs }) => ({ target_ref, case_ref, offer_refs }),
        ),
      };
    }),
  };
}
