import { type ModelRoute, type ProviderModel, unknownCapabilities } from "./schema.ts";

export interface BaseModelInput {
  providerId: string;
  id: string;
  version?: string;
  name: string;
  sourceId: string;
  observedAt: string;
}

export function modelUid(providerId: string, id: string, version?: string): string {
  return `${providerId}/${id}${version === undefined ? "" : `@${version}`}`;
}

export function apiEndpointKey(
  endpoint: NonNullable<ProviderModel["api_endpoints"]>[number],
): string {
  return `${endpoint.path}\0${endpoint.name}`;
}

export function modelRouteKey(route: ModelRoute): string {
  return `${route.provider}\0${route.task}\0${route.provider_model_id}\0${route.source_ref}`;
}

export function baseModel(input: BaseModelInput): ProviderModel {
  return {
    provider_id: input.providerId,
    model_id: input.id,
    version: input.version,
    uid: modelUid(input.providerId, input.id, input.version),
    id_kind: "api_id",
    name: input.name,
    aliases: [],
    types: ["other"],
    modalities: { input: [], output: [] },
    capabilities: unknownCapabilities(),
    limits: {},
    status: "unknown",
    is_deprecated: "unknown",
    replacement_model_ids: [],
    pricing_status: "unknown",
    pricing: [],
    scope: "global_catalog",
    account_availability: "unknown",
    first_seen_at: input.observedAt,
    last_seen_at: input.observedAt,
    observed_at: input.observedAt,
    source_refs: [input.sourceId],
  };
}
