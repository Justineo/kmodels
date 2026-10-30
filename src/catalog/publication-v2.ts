import { canonicalJsonHash } from "./canonical-json.ts";
import {
  assertIJsonValue,
  canonicalJson,
  canonicalJsonChunksFromValidated,
} from "./canonical-value.ts";
import type { AssetSource } from "./asset-pack.ts";
import { emptyInvocationCatalog } from "./invocation-schema.ts";
import { invocationProviderPartition } from "./invocation-collection.ts";
import { validateInvocationCatalog } from "./invocation-validation.ts";
import { sha256, sha256Chunks } from "./io.ts";
import { catalogPairId } from "./pair-identity.ts";
import { pricingLimits } from "./pricing-constants.ts";
import { catalogIds, catalogModels, catalogSummary } from "./publication.ts";
import {
  pricingV2DataSchema,
  publicationManifestSchema,
  type CatalogV2Envelope,
  type InvocationPricingBinding,
  type PricingV2Envelope,
} from "./publication-v2-schema.ts";
import type { PricingCatalogEnvelope } from "./pricing-schema.ts";
import type { Catalog } from "./schema.ts";
import {
  invocationSelectorContract,
  type InvocationPriceSelectorSource,
} from "./invocation-price-inputs.ts";
import { validateInvocationPricing } from "./invocation-pricing-validation.ts";
import {
  invocationCaseId,
  invocationTargetId,
  invocationEvidenceId,
} from "./invocation-identity.ts";

export interface V2Publication {
  catalog: CatalogV2Envelope;
  pricing: PricingV2Envelope;
  catalogSource: string;
  pricingSource: string;
  pairId: string;
}

/** The pair boundary has already validated the catalog and each canonical price book. */
export function createV2PublicationFromValidatedPair(
  catalog: Catalog,
  pricing: PricingCatalogEnvelope,
  bindings: readonly InvocationPricingBinding[],
): V2Publication {
  const invocation = catalog.invocation ?? emptyInvocationCatalog();
  validateInvocationCatalog(invocation, catalog);
  for (const target of invocation.invocation_targets) {
    if (target.id !== invocationTargetId(target))
      throw new Error("Invocation target identity does not match its address contract");
    for (const entry of target.cases)
      if (entry.id !== invocationCaseId(target.id, entry))
        throw new Error("Invocation case identity does not match its joint scope");
  }
  for (const { id, observed_at: _at, ...evidence } of invocation.invocation_evidence)
    if (id !== invocationEvidenceId(evidence))
      throw new Error("Invocation evidence identity does not match its source content");
  const data = {
    providers: catalog.providers,
    models: catalog.models,
    sources: catalog.sources,
    coverage: catalog.coverage,
    ...invocation,
  };
  const coreHash = sha256Chunks(canonicalJsonChunksFromValidated(data));
  const core: CatalogV2Envelope = {
    schema_version: 2,
    catalog_version: coreHash,
    generated_at: catalog.generated_at,
    data,
    warnings: catalog.warnings,
  };
  const priceData = {
    ...pricing.data,
    invocation_bindings: pricingV2DataSchema.shape.invocation_bindings.parse(bindings),
  };
  assertIJsonValue(priceData.invocation_bindings);
  const prices: PricingV2Envelope = {
    schema_version: 2,
    core_catalog_version: coreHash,
    core_data_sha256: coreHash,
    pricing_data_version: sha256Chunks(canonicalJsonChunksFromValidated(priceData)),
    generated_at: catalog.generated_at,
    data: priceData,
  };
  validateInvocationPricing(
    core.data,
    core.data,
    prices.data.books,
    prices.data.provider_vocabularies,
    prices.data.invocation_bindings,
    invocationSelectorSourceRef,
  );
  const catalogSource = encodedPublication(core, pricingLimits.coreInputBytes);
  const pricingSource = encodedPublication(prices, pricingLimits.pricingInputBytes);
  return {
    catalog: core,
    pricing: prices,
    catalogSource: catalogSource.source,
    pricingSource: pricingSource.source,
    pairId: v2PairId(catalogSource.hash, pricingSource.hash),
  };
}

function encodedPublication(value: CatalogV2Envelope | PricingV2Envelope, maxBytes: number) {
  const chunks = canonicalJsonChunksFromValidated(value);
  // Keep the response as a rope; hashing a complete string would flatten it.
  let source = "";
  let bytes = 0;
  for (const chunk of chunks) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > maxBytes) throw new Error("V2 publication exceeds its encoded-input limit");
    source += chunk;
  }
  return { source, hash: sha256Chunks(chunks) };
}

export function v2PairId(catalogHash: string, pricingHash: string): string {
  return canonicalJsonHash({
    schema_version: 2,
    catalog_asset_sha256: catalogHash,
    pricing_asset_sha256: pricingHash,
  });
}

export function invocationSelectorSourceRef(
  offerRef: string,
  source: InvocationPriceSelectorSource,
): string {
  const contract = invocationSelectorContract(source);
  return `selector:${canonicalJsonHash({ offer_ref: offerRef, contract })}`;
}

export function v2CatalogAssets(catalog: Catalog, publication: V2Publication): AssetSource[] {
  const metadata = {
    schema_version: 2,
    catalog_version: publication.catalog.catalog_version,
    generated_at: catalog.generated_at,
  };
  const invocation = catalog.invocation ?? emptyInvocationCatalog();
  const ids = catalogIds(catalog);
  const summary = catalogSummary(catalog);
  const models = catalogModels(catalog);
  const providers = Object.fromEntries(
    Object.entries(models.providers).map(([id, provider]) => [
      id,
      {
        ...provider,
        models: provider.models.map((group) => ({
          ...group,
          variants: group.variants.map((model) => ({
            ...model,
            legacy_fact_scope: "legacy_unscoped",
            target_refs: invocation.invocation_targets
              .filter(({ model_ref }) => model_ref === model.uid)
              .map(({ id }) => id),
            fact_refs: invocation.scoped_facts
              .filter(({ model_ref }) => model_ref === model.uid)
              .map(({ id }) => id),
          })),
        })),
      },
    ]),
  );
  const assets: AssetSource[] = [
    { fileName: "catalog/v2/index.json", source: publication.catalogSource },
    { fileName: "pricing/v2/index.json", source: publication.pricingSource },
    { fileName: "catalog/v2/ids.json", source: canonicalJson({ ...ids, ...metadata }) },
    { fileName: "catalog/v2/summary.json", source: canonicalJson({ ...summary, ...metadata }) },
    {
      fileName: "catalog/v2/models.json",
      source: canonicalJson({ ...models, ...metadata, providers }),
    },
    {
      fileName: "providers/v2/index.json",
      source: canonicalJson({
        ...metadata,
        profile: "providers",
        providers: Object.fromEntries(
          Object.entries(providers).map(([id, { models: _models, ...provider }]) => [id, provider]),
        ),
      }),
    },
    ...Object.entries(providers).flatMap(
      ([providerId, { models: providerModels, ...provider }]) => [
        {
          fileName: `providers/v2/${providerId}/index.json`,
          source: canonicalJson({
            ...metadata,
            profile: "provider",
            provider_id: providerId,
            provider,
          }),
        },
        {
          fileName: `providers/v2/${providerId}/models/index.json`,
          source: canonicalJson({
            ...metadata,
            profile: "provider-models",
            provider_id: providerId,
            models: providerModels,
          }),
        },
      ],
    ),
    {
      fileName: "catalog/v2/identifiers.json",
      source: canonicalJson({
        ...metadata,
        profile: "identifiers",
        relations: invocation.identifier_relations,
      }),
    },
    {
      fileName: "catalog/v2/invocations.json",
      source: canonicalJson({ ...metadata, profile: "invocations", data: invocation }),
    },
  ];
  for (const provider of catalog.providers) {
    const modelRefs = new Set(
      catalog.models.filter(({ provider_id }) => provider_id === provider.id).map(({ uid }) => uid),
    );
    const partition = invocationProviderPartition(invocation, modelRefs, provider.id);
    assets.push({
      fileName: `providers/v2/${provider.id}/invocations.json`,
      source: canonicalJson({
        ...metadata,
        profile: "provider-invocations",
        provider_id: provider.id,
        data: partition,
      }),
    });
  }
  return assets;
}

export function publicationManifestAsset(
  catalog: Catalog,
  pricing: PricingCatalogEnvelope,
  publication: V2Publication,
  assets: readonly AssetSource[],
): AssetSource {
  const catalogAsset = assets.find(({ fileName }) => fileName === "catalog/index.json");
  const pricingAsset = assets.find(({ fileName }) => fileName === "pricing/index.json");
  if (catalogAsset === undefined || pricingAsset === undefined)
    throw new Error("Publication is missing legacy resources");
  const manifest = publicationManifestSchema.parse({
    schema_version: 1,
    generated_at: catalog.generated_at,
    pairs: [
      {
        schema_version: 1,
        pair_id: catalogPairId({
          catalog_asset_sha256: sha256(catalogAsset.source),
          pricing_asset_sha256: sha256(pricingAsset.source),
        }),
        catalog_version: catalog.catalog_version,
        pricing_data_version: pricing.pricing_data_version,
        catalog_path: "catalog/index.json",
        pricing_path: "pricing/index.json",
      },
      {
        schema_version: 2,
        pair_id: publication.pairId,
        catalog_version: publication.catalog.catalog_version,
        pricing_data_version: publication.pricing.pricing_data_version,
        catalog_path: "catalog/v2/index.json",
        pricing_path: "pricing/v2/index.json",
      },
    ],
    resources: assets
      .map(({ fileName, source }) => ({ path: fileName, sha256: sha256(source) }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  });
  return { fileName: "catalog/publication.json", source: canonicalJson(manifest) };
}
