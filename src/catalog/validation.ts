import { apiEndpointKey, modelRouteKey, modelUid } from "./model.ts";
import { providerModelSchema, type ProviderModel } from "./schema.ts";

type ProviderValidationIssueCode =
  | "empty_candidate"
  | "schema_invalid"
  | "uid_mismatch"
  | "duplicate_model"
  | "duplicate_service_family"
  | "duplicate_api_endpoint"
  | "duplicate_route"
  | "missing_route_source"
  | "duplicate_availability"
  | "model_count_drop"
  | "service_family_count_drop"
  | "api_endpoint_count_drop"
  | "route_count_drop"
  | "availability_count_drop";

export interface ProviderValidationIssue {
  code: ProviderValidationIssueCode;
  message: string;
  model_ref?: string;
  previous?: number;
  current?: number;
  minimum_ratio?: number;
}

export type ValidationResult =
  | { ok: true; issue?: never }
  | { ok: false; issue: ProviderValidationIssue };

type CountedField = "service_families" | "api_endpoints" | "routes" | "availability";

export interface ProviderCountDecrease {
  field: "models" | CountedField;
  previous: number;
  current: number;
}

function count(models: ProviderModel[], field: CountedField): number {
  return models.reduce((total, model) => total + (model[field]?.length ?? 0), 0);
}

function invalid(
  code: ProviderValidationIssueCode,
  message: string,
  detail: Omit<ProviderValidationIssue, "code" | "message"> = {},
): ValidationResult {
  return { ok: false, issue: { code, message, ...detail } };
}

export function providerCountDecreases(
  models: ProviderModel[],
  previous: ProviderModel[],
): ProviderCountDecrease[] {
  const fields = ["models", "service_families", "api_endpoints", "routes", "availability"] as const;
  return fields.flatMap((field) => {
    const before = field === "models" ? previous.length : count(previous, field);
    const after = field === "models" ? models.length : count(models, field);
    return after < before ? [{ field, previous: before, current: after }] : [];
  });
}

export function validateProvider(models: ProviderModel[]): ValidationResult {
  if (models.length === 0) return invalid("empty_candidate", "candidate catalog is empty");
  const uids = new Set<string>();
  for (const model of models) {
    const parsed = providerModelSchema.safeParse(model);
    if (!parsed.success)
      return invalid("schema_invalid", `schema validation failed for ${model.uid}`, {
        model_ref: model.uid,
      });
    if (model.uid !== modelUid(model.provider_id, model.model_id, model.version))
      return invalid("uid_mismatch", `UID mismatch for ${model.model_id}`, {
        model_ref: model.uid,
      });
    if (uids.has(model.uid))
      return invalid("duplicate_model", `duplicate model ${model.uid}`, {
        model_ref: model.uid,
      });
    uids.add(model.uid);
    const serviceFamilies = new Set<string>();
    for (const family of model.service_families ?? []) {
      if (serviceFamilies.has(family))
        return invalid("duplicate_service_family", `duplicate service family for ${model.uid}`, {
          model_ref: model.uid,
        });
      serviceFamilies.add(family);
    }
    const endpoints = new Set<string>();
    for (const endpoint of model.api_endpoints ?? []) {
      const key = apiEndpointKey(endpoint);
      if (endpoints.has(key))
        return invalid("duplicate_api_endpoint", `duplicate API endpoint for ${model.uid}`, {
          model_ref: model.uid,
        });
      endpoints.add(key);
    }
    const routes = new Set<string>();
    for (const route of model.routes ?? []) {
      const key = modelRouteKey(route);
      if (routes.has(key))
        return invalid("duplicate_route", `duplicate route for ${model.uid}`, {
          model_ref: model.uid,
        });
      if (!model.source_refs.includes(route.source_ref))
        return invalid("missing_route_source", `route source is missing for ${model.uid}`, {
          model_ref: model.uid,
        });
      routes.add(key);
    }
    const availability = new Set<string>();
    for (const item of model.availability ?? []) {
      const key = `${item.region}\0${item.deployment_type}`;
      if (availability.has(key))
        return invalid("duplicate_availability", `duplicate availability for ${model.uid}`, {
          model_ref: model.uid,
        });
      availability.add(key);
    }
  }

  return { ok: true };
}

interface ReconciliationSources {
  catalog: ReadonlySet<string>;
  exhaustive: ReadonlySet<string>;
  recomputed: ReadonlySet<string>;
  releaseDate?: ReadonlySet<string>;
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
    if (old === undefined) return model;
    const releaseDateRefs =
      model.release_date === undefined && old.release_date !== undefined
        ? old.source_refs.filter((sourceId) => sources.releaseDate?.has(sourceId) === true)
        : [];
    return {
      ...model,
      first_seen_at: old.first_seen_at,
      release_date: releaseDateRefs.length === 0 ? model.release_date : old.release_date,
      source_refs: [...new Set([...sourceRefs(old), ...releaseDateRefs, ...model.source_refs])],
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
