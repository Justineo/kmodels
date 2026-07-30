import { compareUtf8 } from "./canonical-value.ts";
import { groupModels } from "./model-groups.ts";
import {
  catalogIdsSchema,
  catalogModelsSchema,
  catalogSummarySchema,
  publishedModelVariantSchema,
  type CatalogIds,
  type CatalogModels,
  type CatalogSummary,
  type PublishedModelVariant,
} from "./publication-schema.ts";
import type { Catalog, ProviderModel } from "./schema.ts";

export function catalogIds(catalog: Catalog): CatalogIds {
  return catalogIdsSchema.parse({
    schema_version: 1,
    profile: "ids",
    catalog_version: catalog.catalog_version,
    generated_at: catalog.generated_at,
    providers: Object.fromEntries(
      catalog.providers.map((provider) => [
        provider.id,
        [
          ...new Set(
            catalog.models
              .filter((model) => model.provider_id === provider.id)
              .map((model) => model.model_id),
          ),
        ].sort(compareUtf8),
      ]),
    ),
  });
}

export function catalogSummary(catalog: Catalog): CatalogSummary {
  return catalogSummarySchema.parse({
    schema_version: 1,
    profile: "summary",
    catalog_version: catalog.catalog_version,
    generated_at: catalog.generated_at,
    models: catalog.models.map((model) => ({
      model_id: model.model_id,
      provider: model.provider_id,
      ...(model.version === undefined ? {} : { version: model.version }),
      tasks: model.tasks,
      status: model.status,
    })),
  });
}

export function catalogModels(catalog: Catalog): CatalogModels {
  return catalogModelsSchema.parse({
    schema_version: 1,
    profile: "models",
    catalog_version: catalog.catalog_version,
    generated_at: catalog.generated_at,
    providers: Object.fromEntries(
      catalog.providers.map((provider) => {
        const coverage = catalog.coverage.find(({ provider_id }) => provider_id === provider.id);
        return [
          provider.id,
          {
            name: provider.name,
            kind: provider.kind,
            homepage: provider.homepage,
            ...(provider.docs_url === undefined ? {} : { docs_url: provider.docs_url }),
            catalog_scope: provider.catalog_scope,
            ...(provider.regions === undefined ? {} : { regions: provider.regions }),
            ...(provider.catalog_version === undefined
              ? {}
              : { catalog_version: provider.catalog_version }),
            coverage:
              coverage === undefined
                ? undefined
                : {
                    status: coverage.status,
                    model_count: coverage.model_count,
                    pricing_term_count: coverage.pricing_term_count,
                    checked_at: coverage.checked_at,
                    ...(coverage.last_successful_sync_at === undefined
                      ? {}
                      : { last_successful_sync_at: coverage.last_successful_sync_at }),
                    ...(coverage.reason === undefined ? {} : { reason: coverage.reason }),
                  },
            models: groupModels(
              catalog.models.filter((model) => model.provider_id === provider.id),
            ).map((group) => ({
              model_id: group.model_id,
              variants: group.models.map(publishedModelVariant),
            })),
          },
        ];
      }),
    ),
  });
}

function publishedModelVariant(model: ProviderModel): PublishedModelVariant {
  return publishedModelVariantSchema.parse({
    ...(model.version === undefined ? {} : { version: model.version }),
    uid: model.uid,
    id_kind: model.id_kind,
    name: model.name,
    ...(model.description === undefined ? {} : { description: model.description }),
    aliases: model.aliases,
    tasks: model.tasks,
    ...(model.delivery_modes === undefined ? {} : { delivery_modes: model.delivery_modes }),
    ...(model.service_families === undefined ? {} : { service_families: model.service_families }),
    ...(model.api_endpoints === undefined ? {} : { api_endpoints: model.api_endpoints }),
    modalities: model.modalities,
    capabilities: model.capabilities,
    limits: model.limits,
    ...(model.release_date === undefined ? {} : { release_date: model.release_date }),
    ...(model.updated_date === undefined ? {} : { updated_date: model.updated_date }),
    ...(model.deprecated_at === undefined ? {} : { deprecated_at: model.deprecated_at }),
    ...(model.retired_at === undefined ? {} : { retired_at: model.retired_at }),
    status: model.status,
    release_stage: model.release_stage,
    replacement_model_ids: model.replacement_model_ids,
    ...(model.availability === undefined ? {} : { availability: model.availability }),
    scope: model.scope,
  });
}
