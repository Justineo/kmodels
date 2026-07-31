import { apiEndpointKey, modelRouteKey, modelUid } from "./model.ts";
import { providerModelSchema, type ProviderModel } from "./schema.ts";

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

type CountedField = "service_families" | "api_endpoints" | "routes" | "availability";

function count(models: ProviderModel[], field: CountedField): number {
  return models.reduce((total, model) => total + (model[field]?.length ?? 0), 0);
}

export function validateProvider(
  models: ProviderModel[],
  previous: ProviderModel[],
): ValidationResult {
  if (models.length === 0) return { ok: false, reason: "candidate catalog is empty" };
  const uids = new Set<string>();
  for (const model of models) {
    const parsed = providerModelSchema.safeParse(model);
    if (!parsed.success) return { ok: false, reason: `schema validation failed for ${model.uid}` };
    if (model.uid !== modelUid(model.provider_id, model.model_id, model.version))
      return { ok: false, reason: `UID mismatch for ${model.model_id}` };
    if (uids.has(model.uid)) return { ok: false, reason: `duplicate model ${model.uid}` };
    uids.add(model.uid);
    const serviceFamilies = new Set<string>();
    for (const family of model.service_families ?? []) {
      if (serviceFamilies.has(family))
        return { ok: false, reason: `duplicate service family for ${model.uid}` };
      serviceFamilies.add(family);
    }
    const endpoints = new Set<string>();
    for (const endpoint of model.api_endpoints ?? []) {
      const key = apiEndpointKey(endpoint);
      if (endpoints.has(key))
        return { ok: false, reason: `duplicate API endpoint for ${model.uid}` };
      endpoints.add(key);
    }
    const routes = new Set<string>();
    for (const route of model.routes ?? []) {
      const key = modelRouteKey(route);
      if (routes.has(key)) return { ok: false, reason: `duplicate route for ${model.uid}` };
      if (!model.source_refs.includes(route.source_ref))
        return { ok: false, reason: `route source is missing for ${model.uid}` };
      routes.add(key);
    }
    const availability = new Set<string>();
    for (const item of model.availability ?? []) {
      const key = `${item.region}\0${item.deployment_type}`;
      if (availability.has(key))
        return { ok: false, reason: `duplicate availability for ${model.uid}` };
      availability.add(key);
    }
  }

  if (previous.length > 0 && models.length < previous.length * 0.9)
    return { ok: false, reason: "model count dropped by more than 10%" };
  const previousServiceFamilies = count(previous, "service_families");
  if (
    previousServiceFamilies > 0 &&
    count(models, "service_families") < previousServiceFamilies * 0.8
  )
    return { ok: false, reason: "service-family count dropped by more than 20%" };
  const previousEndpoints = count(previous, "api_endpoints");
  if (previousEndpoints > 0 && count(models, "api_endpoints") < previousEndpoints * 0.8)
    return { ok: false, reason: "API endpoint count dropped by more than 20%" };
  const previousRoutes = count(previous, "routes");
  if (previousRoutes > 0 && count(models, "routes") < previousRoutes * 0.8)
    return { ok: false, reason: "route count dropped by more than 20%" };
  const previousAvailability = count(previous, "availability");
  if (previousAvailability > 0 && count(models, "availability") < previousAvailability * 0.8)
    return { ok: false, reason: "availability count dropped by more than 20%" };

  return { ok: true };
}

interface ReconciliationSources {
  catalog: ReadonlySet<string>;
  exhaustive: ReadonlySet<string>;
  recomputed: ReadonlySet<string>;
}

export function reconcileCatalog(
  candidate: ProviderModel[],
  previous: ProviderModel[],
  sources: ReconciliationSources,
): ProviderModel[] {
  const candidateByUid = new Map(candidate.map((model) => [model.uid, model]));
  const previousByUid = new Map(previous.map((model) => [model.uid, model]));
  const sourceRefs = (model: ProviderModel): string[] =>
    model.source_refs.filter(
      (sourceId) =>
        (!sources.exhaustive.has(sourceId) && !sources.recomputed.has(sourceId)) ||
        candidateByUid.get(model.uid)?.source_refs.includes(sourceId),
    );
  const observed = candidate.map((model) => {
    const old = previousByUid.get(model.uid);
    return old === undefined
      ? model
      : {
          ...model,
          first_seen_at: old.first_seen_at,
          source_refs: [...new Set([...sourceRefs(old), ...model.source_refs])],
        };
  });
  const missing = previous.flatMap((model) => {
    if (candidateByUid.has(model.uid)) return [];
    const refs = sourceRefs(model);
    return refs.some((sourceId) => sources.catalog.has(sourceId))
      ? [
          {
            ...model,
            source_refs: refs,
            routes: model.routes?.filter((route) => refs.includes(route.source_ref)),
          },
        ]
      : [];
  });
  return [...observed, ...missing].sort((left, right) => left.uid.localeCompare(right.uid));
}
