import { type ProviderModel, unknownCapabilities } from "./schema.ts";

export interface BaseModelInput {
  providerId: string;
  id: string;
  name: string;
  sourceId: string;
  observedAt: string;
}

export function baseModel(input: BaseModelInput): ProviderModel {
  return {
    provider_id: input.providerId,
    model_id: input.id,
    uid: `${input.providerId}/${input.id}`,
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
