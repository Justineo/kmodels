import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import type { ZodType } from "zod";
import { parseSource } from "./adapters.ts";
import { azureRetailSourceId, validateAzureRetailPublication } from "./azure-retail-publication.ts";
import { captureRepairSource } from "./catalog-repair-capture.ts";
import {
  captureInferencePriceSources,
  type InferencePriceSource,
} from "./inference-pricing-source.ts";
import {
  compileInferencePriceMapping,
  type InferencePriceBaseline,
} from "./inference-pricing-compilation.ts";
import { canonicalJson, compareUtf8 } from "./canonical-value.ts";
import { mapConcurrentByKey } from "./concurrency.ts";
import type { ProviderResult, CollectionBatch } from "./collection-result.ts";
import { deliveryModeEvidenceKey, normalizeDeliveryModes } from "./delivery.ts";
import {
  fetchSource,
  fetchStateSchema,
  type FetchResult,
  type FetchState,
  type SourceState,
  type SagemakerDiscoveryCache,
} from "./fetch.ts";
import {
  manifests,
  type CoverageField,
  type ProviderManifest,
  type SourceManifest,
} from "./manifests.ts";
import { readJson, rootDirectory, sha256, stableJson, writeJson } from "./io.ts";
import { isCredentialLikeIdentifier } from "./identity.ts";
import { normalizeModelReleaseStage } from "./lifecycle.ts";
import { apiEndpointKey, modelRouteKey } from "./model.ts";
import { limitDetailGroupSchema, limitDetailsSchema } from "./model-limit-details.ts";
import {
  capabilityDetailGroupSchema,
  capabilityDetailsSchema,
} from "./model-capability-details.ts";
import {
  filterModelClaims,
  modelClaimFields,
  validateModelDetailSources,
  type ModelClaimField,
  type ModelClaimGroup,
} from "./model-claim-details.ts";
import {
  composeCatalogPair,
  coreCatalogVersion,
  type AcceptedPairSafetyFinding,
} from "./pricing-pair-transition.ts";
import type { ProviderPricingPartition } from "./pricing-assembly.ts";
import { capturePricingSourceRecords } from "./pricing-source-records.ts";
import {
  commitCatalogPair,
  prepareCatalogPairInParallel,
  recoverCatalogPair,
  type CatalogPairCandidate,
  type CatalogPairData,
} from "./pricing-publication.ts";
import {
  sourcePricingExtraction,
  sourcePricingReconciliation,
  type PricingReconciliationItem,
} from "./pricing-reconciliation.ts";
import {
  capturePricingReplaySources,
  createPricingCompilationSnapshot,
  readPricingCompilationSnapshot,
  writePricingCompilationSnapshot,
  type PricingCompilationSnapshot,
  type PricingReplayProvider,
  type PricingReplaySource,
} from "./pricing-compilation.ts";
import {
  failedPricingTransition,
  pricingTransitionProviderId,
  providerPartitionSourceRefs,
  type ProviderPricingTransition,
} from "./pricing-transition.ts";
import {
  assembleParsedProviderPricing,
  isPricingDependencySource,
  isRequiredPricingSource,
  isPricingSource,
} from "./pricing-adapter.ts";
import { validateAdoptedTopology } from "./pricing-adopted-topology.ts";
import {
  publishedModel,
  sourcePriceFactKey,
  sourceRawPricingFactKey,
  type ParsedProviderModel,
  type SourcePriceFact,
  type SourceRawPricingFact,
  type SourcePricingFacts,
} from "./pricing-source.ts";
import type { SourceParseResult } from "./source-parse.ts";
import { validatePricingCatalog } from "./pricing-validation.ts";
import { emptyPricingCatalog, type PricingRefreshFailureCode } from "./pricing-schema.ts";
import {
  catalogSchema,
  type Catalog,
  type CatalogWarning,
  type Coverage,
  type Provider,
  type ProviderModel,
  type SourceRecord,
} from "./schema.ts";
import { reconcileCatalog, validateProvider, type ProviderValidationIssue } from "./validation.ts";
import { normalizeModelTasks } from "./task.ts";
import {
  summarizeRefresh,
  type ProviderRefreshAttempt,
  type SourceRefreshAttempt,
} from "./summary.ts";
import {
  contractEvidence,
  createContractFindingCollector,
  isContractDrift,
} from "./source-contract.ts";
import {
  sourceErrorMessage as message,
  sourceFailure,
  summarizeDependencyFailures,
} from "./source-failure.ts";

const availabilityWarning: CatalogWarning = {
  code: "account_availability_unknown",
  message: "Global catalog presence does not imply availability to a specific account.",
};

type SourceFetch = { sourceId: string; result: FetchResult } | { sourceId: string; error: unknown };

interface CollectionOptions {
  now?: Date;
  jitterMs?: number;
  rebuild?: boolean;
  rebuildProvider?: string;
  pricingTransitions?: readonly ProviderPricingTransition[];
  pricingSafetyFindings?: readonly AcceptedPairSafetyFinding[];
  loadCollected?: () => Promise<CollectionBatch & { state: FetchState }>;
}

function previousModels(catalog: Catalog | undefined, providerId: string): ProviderModel[] {
  return (
    catalog?.models
      .filter(
        (model) => model.provider_id === providerId && !isCredentialLikeIdentifier(model.model_id),
      )
      .map(normalizeModelReleaseStage)
      .map(normalizeModelTasks)
      .map(normalizeDeliveryModes) ?? []
  );
}

function previousSources(catalog: Catalog | undefined, providerId: string): SourceRecord[] {
  return catalog?.sources.filter((source) => source.provider_id === providerId) ?? [];
}

function previousCoverage(catalog: Catalog | undefined, providerId: string): Coverage | undefined {
  return catalog?.coverage.find((coverage) => coverage.provider_id === providerId);
}

function sourceState(
  result: Pick<FetchResult, "etag" | "lastModified" | "contentHash">,
  observedAt: string,
): SourceState {
  return {
    etag: result.etag,
    lastModified: result.lastModified,
    contentHash: result.contentHash,
    lastSuccessAt: observedAt,
    checkedAt: observedAt,
    consecutiveFailures: 0,
  };
}

function recordSourceFailure(
  state: FetchState,
  sourceId: string,
  observedAt: string,
  result?: Pick<FetchResult, "etag" | "lastModified" | "contentHash">,
): Pick<SourceRefreshAttempt, "consecutive_failures" | "last_success_at"> {
  const previous = state.sources[sourceId];
  const consecutiveFailures = (previous?.consecutiveFailures ?? 0) + 1;
  const next: SourceState = {
    ...previous,
    checkedAt: observedAt,
    consecutiveFailures,
  };
  if (result !== undefined) {
    next.contentHash = result.contentHash;
    if (result.etag !== undefined) next.etag = result.etag;
    if (result.lastModified !== undefined) next.lastModified = result.lastModified;
  }
  state.sources[sourceId] = next;
  return {
    consecutive_failures: consecutiveFailures,
    ...(previous?.lastSuccessAt === undefined ? {} : { last_success_at: previous.lastSuccessAt }),
  };
}

export interface SourceGroup extends SourcePricingFacts {
  source: SourceManifest;
  models: ParsedProviderModel[];
}

interface SourceRetention {
  models: ParsedProviderModel[];
  count: number;
}

function mergeBy<T>(
  current: readonly T[] | undefined,
  incoming: readonly T[] | undefined,
  key: (value: T) => string,
): T[] {
  return [
    ...new Map(
      [...(current ?? []), ...(incoming ?? [])].map((value) => [key(value), value]),
    ).values(),
  ];
}

function known<T extends string | boolean>(current: T, incoming: T, fillOnly: boolean): T {
  return incoming === "unknown" || (fillOnly && current !== "unknown") ? current : incoming;
}

function optional<T>(
  current: T | undefined,
  incoming: T | undefined,
  fillOnly: boolean,
): T | undefined {
  return incoming === undefined || (fillOnly && current !== undefined) ? current : incoming;
}

function mergePriceFacts(
  current: ParsedProviderModel,
  incoming: ParsedProviderModel,
): SourcePriceFact[] {
  if (incoming.price_facts.length === 0) return incoming.price_facts;
  return mergeBy(current.price_facts, incoming.price_facts, sourcePriceFactKey).sort(
    (left, right) => compareUtf8(sourcePriceFactKey(left), sourcePriceFactKey(right)),
  );
}

function mergeRawPriceFacts(
  current: ParsedProviderModel,
  incoming: ParsedProviderModel,
): SourceRawPricingFact[] {
  if (incoming.raw_price_facts.length === 0) return incoming.raw_price_facts;
  const key = (fact: SourceRawPricingFact) =>
    canonicalJson([fact.source_ref, sourceRawPricingFactKey(fact)]);
  return mergeBy(current.raw_price_facts, incoming.raw_price_facts, key).sort((left, right) =>
    compareUtf8(key(left), key(right)),
  );
}

function declaresModelClaims(source: SourceManifest, field: ModelClaimField): boolean {
  return (
    source.fields.includes(field) &&
    source.access === "public" &&
    source.auth === undefined &&
    source.role !== "inventory"
  );
}

function ownsModelClaim(
  source: SourceManifest,
  field: ModelClaimField,
  group: ModelClaimGroup,
): boolean {
  return (
    declaresModelClaims(source, field) &&
    group.source_ref === source.id &&
    group.evidence.every(({ document_url }) =>
      source.allowedHosts.includes(new URL(document_url).hostname),
    )
  );
}

function mergeClaimGroups<Group extends ModelClaimGroup>(
  current: Group[] | undefined,
  incoming: Group[] | undefined,
  source: SourceManifest,
  field: ModelClaimField,
): Group[] | undefined {
  if (!declaresModelClaims(source, field)) return current;
  const key = (group: Group) => canonicalJson([group.source_ref, group.claim]);
  const groups = mergeBy(
    current,
    incoming?.filter(({ source_ref }) => source_ref === source.id),
    key,
  );
  return groups.length === 0
    ? current
    : groups.sort((left, right) => compareUtf8(key(left), key(right)));
}

const claimSchemas = {
  limit_details: { group: limitDetailGroupSchema, all: limitDetailsSchema, subject: "limit" },
  capability_details: {
    group: capabilityDetailGroupSchema,
    all: capabilityDetailsSchema,
    subject: "capability",
  },
} satisfies Record<
  ModelClaimField,
  { group: ZodType<ModelClaimGroup>; all: ZodType<ModelClaimGroup[]>; subject: string }
>;

function admitClaimGroups<Group extends ModelClaimGroup>(
  model: ParsedProviderModel,
  source: SourceManifest,
  providerId: string,
  warnings: CatalogWarning[],
  field: ModelClaimField,
  schemas: { group: ZodType<Group>; all: ZodType<Group[]>; subject: string },
): Group[] | undefined {
  const observations = model[field];
  if (observations === undefined) return;
  const groups: Group[] = [];
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  let rejected = false;
  for (const value of observations) {
    const parsed = schemas.group.safeParse(value);
    if (
      !parsed.success ||
      model.provider_id !== providerId ||
      !ownsModelClaim(source, field, parsed.data)
    ) {
      rejected = true;
      continue;
    }
    if (seen.has(parsed.data.claim)) duplicates.add(parsed.data.claim);
    seen.add(parsed.data.claim);
    groups.push(parsed.data);
  }
  const accepted = groups.filter(({ claim }) => !duplicates.has(claim));
  const bounded = schemas.all.safeParse(accepted);
  if (rejected || duplicates.size > 0 || !bounded.success)
    warnings.push(
      sourceWarning(
        `${schemas.subject}_detail_invalid`,
        providerId,
        source.id,
        `Withheld invalid or unowned ${schemas.subject} detail observations for ${model.uid}. Independent model facts remain usable.`,
      ),
    );
  return bounded.success && bounded.data.length > 0 ? bounded.data : undefined;
}

function admitModelClaims(
  model: ParsedProviderModel,
  source: SourceManifest,
  providerId: string,
  warnings: CatalogWarning[],
): ParsedProviderModel {
  if (model.limit_details === undefined && model.capability_details === undefined) return model;
  const limitDetails = admitClaimGroups(
    model,
    source,
    providerId,
    warnings,
    "limit_details",
    claimSchemas.limit_details,
  );
  const capabilityDetails = admitClaimGroups(
    model,
    source,
    providerId,
    warnings,
    "capability_details",
    claimSchemas.capability_details,
  );
  const { limit_details: _limits, capability_details: _capabilities, ...ordinary } = model;
  if (limitDetails === undefined && capabilityDetails === undefined) return ordinary;
  return {
    ...ordinary,
    ...(limitDetails === undefined ? {} : { limit_details: limitDetails }),
    ...(capabilityDetails === undefined ? {} : { capability_details: capabilityDetails }),
    source_refs: [...new Set([...ordinary.source_refs, source.id])],
  };
}

function retainClaimGroups<Group extends ModelClaimGroup>(
  groups: Group[] | undefined,
  prior: Group[] | undefined,
  source: SourceManifest,
  field: ModelClaimField,
): Group[] | undefined {
  if (prior === undefined || !declaresModelClaims(source, field)) return groups;
  const observed = new Set(
    groups?.filter(({ source_ref }) => source_ref === source.id).map(({ claim }) => claim),
  );
  const omitted = prior.filter(
    ({ source_ref, claim }) => source_ref === source.id && !observed.has(claim),
  );
  return mergeClaimGroups(groups, omitted, source, field);
}

function applyFields(
  current: ParsedProviderModel,
  incoming: ParsedProviderModel,
  source: SourceManifest,
): ParsedProviderModel {
  const fields = new Set(source.fields);
  const fillOnly = source.role === "inventory" || source.fillOnly === true;
  const incomingModalities =
    incoming.modalities.input.length + incoming.modalities.output.length > 0;
  const incomingOperations = incoming.tasks.length > 0;
  const incomingPricing =
    incoming.price_facts.length > 0 ||
    incoming.raw_price_facts.length > 0 ||
    (incoming.state_facts?.length ?? 0) > 0 ||
    incoming.pricing_state !== "unknown";
  const applyPricing =
    fields.has("pricing") && incomingPricing && (!fillOnly || current.pricing_state === "unknown");
  const applyDeliveryEvidence =
    fields.has("delivery_modes") ||
    fields.has("api_endpoints") ||
    fields.has("tasks") ||
    fields.has("capabilities");
  const deliveryEvidence = applyDeliveryEvidence
    ? mergeBy(
        current.delivery_mode_evidence,
        incoming.delivery_mode_evidence,
        deliveryModeEvidenceKey,
      )
    : current.delivery_mode_evidence;
  const serviceFamilies = [
    ...new Set([...(current.service_families ?? []), ...(incoming.service_families ?? [])]),
  ].sort();
  return {
    ...current,
    name:
      fields.has("name") &&
      (incoming.name !== incoming.model_id || current.name === current.model_id) &&
      (!fillOnly || current.name === current.model_id)
        ? incoming.name
        : current.name,
    description: fields.has("description")
      ? optional(current.description, incoming.description, fillOnly)
      : current.description,
    model_card:
      fields.has("model_card") && incoming.model_card !== undefined
        ? fillOnly
          ? { ...incoming.model_card, ...current.model_card }
          : { ...current.model_card, ...incoming.model_card }
        : current.model_card,
    deployment: fields.has("deployment")
      ? optional(current.deployment, incoming.deployment, fillOnly)
      : current.deployment,
    aliases: fields.has("aliases")
      ? [...new Set([...current.aliases, ...incoming.aliases])]
      : current.aliases,
    tasks:
      fields.has("tasks") && incomingOperations
        ? [...new Set([...current.tasks, ...incoming.tasks])]
        : current.tasks,
    task_evidence:
      fields.has("tasks") || fields.has("routes")
        ? mergeBy(current.task_evidence, incoming.task_evidence, stableJson)
        : current.task_evidence,
    delivery_modes: fields.has("delivery_modes")
      ? [...new Set([...(current.delivery_modes ?? []), ...(incoming.delivery_modes ?? [])])]
      : current.delivery_modes,
    delivery_mode_evidence: deliveryEvidence,
    raw_type: fields.has("tasks")
      ? optional(current.raw_type, incoming.raw_type, fillOnly)
      : current.raw_type,
    service_families: fields.has("service_families")
      ? serviceFamilies.length === 0
        ? undefined
        : serviceFamilies
      : current.service_families,
    api_endpoints: fields.has("api_endpoints")
      ? mergeBy(current.api_endpoints, incoming.api_endpoints, apiEndpointKey).sort((left, right) =>
          apiEndpointKey(left).localeCompare(apiEndpointKey(right)),
        )
      : current.api_endpoints,
    routes: fields.has("routes")
      ? mergeBy(current.routes, incoming.routes, modelRouteKey).sort((left, right) =>
          modelRouteKey(left).localeCompare(modelRouteKey(right)),
        )
      : current.routes,
    modalities:
      fields.has("modalities") && incomingModalities
        ? {
            input: [...new Set([...current.modalities.input, ...incoming.modalities.input])],
            output: [...new Set([...current.modalities.output, ...incoming.modalities.output])],
          }
        : current.modalities,
    capabilities: fields.has("capabilities")
      ? {
          reasoning: known(
            current.capabilities.reasoning,
            incoming.capabilities.reasoning,
            fillOnly,
          ),
          tool_call: known(
            current.capabilities.tool_call,
            incoming.capabilities.tool_call,
            fillOnly,
          ),
          structured_output: known(
            current.capabilities.structured_output,
            incoming.capabilities.structured_output,
            fillOnly,
          ),
          streaming: known(
            current.capabilities.streaming,
            incoming.capabilities.streaming,
            fillOnly,
          ),
          batch: known(current.capabilities.batch, incoming.capabilities.batch, fillOnly),
          prompt_cache: known(
            current.capabilities.prompt_cache,
            incoming.capabilities.prompt_cache,
            fillOnly,
          ),
          fine_tuning: known(
            current.capabilities.fine_tuning,
            incoming.capabilities.fine_tuning,
            fillOnly,
          ),
          citations: known(
            current.capabilities.citations,
            incoming.capabilities.citations,
            fillOnly,
          ),
          code_execution: known(
            current.capabilities.code_execution,
            incoming.capabilities.code_execution,
            fillOnly,
          ),
          context_management: known(
            current.capabilities.context_management,
            incoming.capabilities.context_management,
            fillOnly,
          ),
          effort_control: known(
            current.capabilities.effort_control,
            incoming.capabilities.effort_control,
            fillOnly,
          ),
          computer_use: known(
            current.capabilities.computer_use,
            incoming.capabilities.computer_use,
            fillOnly,
          ),
        }
      : current.capabilities,
    limits: fields.has("limits")
      ? fillOnly
        ? { ...incoming.limits, ...current.limits }
        : { ...current.limits, ...incoming.limits }
      : current.limits,
    limit_details: mergeClaimGroups(
      current.limit_details,
      incoming.limit_details,
      source,
      "limit_details",
    ),
    capability_details: mergeClaimGroups(
      current.capability_details,
      incoming.capability_details,
      source,
      "capability_details",
    ),
    release_date: fields.has("release_date")
      ? optional(current.release_date, incoming.release_date, fillOnly)
      : current.release_date,
    updated_date: fields.has("updated_date")
      ? optional(current.updated_date, incoming.updated_date, fillOnly)
      : current.updated_date,
    deprecated_at: fields.has("deprecated_at")
      ? optional(current.deprecated_at, incoming.deprecated_at, fillOnly)
      : current.deprecated_at,
    retired_at: fields.has("retired_at")
      ? optional(current.retired_at, incoming.retired_at, fillOnly)
      : current.retired_at,
    status: fields.has("status")
      ? known(current.status, incoming.status, fillOnly)
      : current.status,
    release_stage: fields.has("release_stage")
      ? known(current.release_stage, incoming.release_stage, fillOnly)
      : current.release_stage,
    replacement_model_ids: fields.has("replacement_model_ids")
      ? [...new Set([...current.replacement_model_ids, ...incoming.replacement_model_ids])]
      : current.replacement_model_ids,
    pricing_state: applyPricing ? incoming.pricing_state : current.pricing_state,
    price_facts: applyPricing ? mergePriceFacts(current, incoming) : current.price_facts,
    raw_price_facts: applyPricing ? mergeRawPriceFacts(current, incoming) : current.raw_price_facts,
    state_facts: applyPricing ? incoming.state_facts : current.state_facts,
    availability: fields.has("availability")
      ? mergeBy(
          current.availability,
          incoming.availability,
          ({ deployment_type, region }) => `${region}\u0000${deployment_type}`,
        ).sort((left, right) =>
          `${left.deployment_type}\u0000${left.region}`.localeCompare(
            `${right.deployment_type}\u0000${right.region}`,
          ),
        )
      : current.availability,
    source_refs: [...new Set([...current.source_refs, ...incoming.source_refs])],
    observed_at: incoming.observed_at,
    last_seen_at: incoming.last_seen_at,
  };
}

export function retainSourceFacts(
  models: ParsedProviderModel[],
  previous: ProviderModel[],
  source: SourceManifest,
  observed: ReadonlySet<string> = new Set(),
  options: { detailsOnly?: boolean } = {},
): SourceRetention {
  const oldByUid = new Map(
    previous
      .filter((model) => model.source_refs.includes(source.id))
      .map((model) => [model.uid, model]),
  );
  let count = 0;
  return {
    models: models.map((model) => {
      const old = oldByUid.get(model.uid);
      if (old === undefined) return model;
      const withDetails = {
        ...model,
        limit_details: retainClaimGroups(
          model.limit_details,
          old.limit_details,
          source,
          "limit_details",
        ),
        capability_details: retainClaimGroups(
          model.capability_details,
          old.capability_details,
          source,
          "capability_details",
        ),
      };
      const incoming: ParsedProviderModel = {
        ...old,
        task_evidence: old.task_evidence?.filter(({ source_ref }) => source_ref === source.id),
        delivery_mode_evidence: old.delivery_mode_evidence?.filter(
          ({ source_ref }) => source_ref === source.id,
        ),
        routes: old.routes?.filter(({ source_ref }) => source_ref === source.id),
        limit_details: undefined,
        capability_details: undefined,
        source_refs: [],
        observed_at: model.observed_at,
        last_seen_at: model.last_seen_at,
        pricing_state: "unknown",
        price_facts: [],
        raw_price_facts: [],
      };
      const applied =
        options.detailsOnly || observed.has(model.uid)
          ? withDetails
          : applyFields(withDetails, incoming, source);
      const next = {
        ...applied,
        source_refs: model.source_refs,
        observed_at: model.observed_at,
        last_seen_at: model.last_seen_at,
      };
      if (stableJson(next) === stableJson(model)) return model;
      count += 1;
      return { ...next, source_refs: [...new Set([...model.source_refs, source.id])] };
    }),
    count,
  };
}

export function applyGroups(
  models: ParsedProviderModel[],
  groups: SourceGroup[],
  create: boolean,
): ParsedProviderModel[] {
  return mergeGroups(models, groups, create, !create);
}

export function applySupplementGroups(
  models: ParsedProviderModel[],
  groups: SourceGroup[],
): ParsedProviderModel[] {
  return mergeGroups(models, groups, true, true);
}

function applyPublicGroups(
  catalogs: SourceGroup[],
  supplements: SourceGroup[],
  overlays: SourceGroup[],
): ParsedProviderModel[] {
  return applyGroups(
    applySupplementGroups(applyGroups([], catalogs, true), supplements),
    overlays,
    false,
  );
}

function mergeGroups(
  models: ParsedProviderModel[],
  groups: SourceGroup[],
  create: boolean,
  matchAliases: boolean,
): ParsedProviderModel[] {
  const byUid = new Map(models.map((model) => [model.uid, model]));
  const aliases = new Map<string, string | null>();
  const modelIds = new Map<string, string | null>();
  const index = (model: ParsedProviderModel): void => {
    const idUid = modelIds.get(model.model_id);
    modelIds.set(model.model_id, idUid === undefined || idUid === model.uid ? model.uid : null);
    for (const alias of model.aliases) {
      const current = aliases.get(alias);
      aliases.set(alias, current === undefined || current === model.uid ? model.uid : null);
    }
  };
  for (const model of models) index(model);
  for (const group of groups) {
    for (const incoming of group.models) {
      const aliasUid = aliases.get(incoming.model_id);
      const aliasModel =
        aliasUid === undefined || aliasUid === null ? undefined : byUid.get(aliasUid);
      const idUid = incoming.version === undefined ? modelIds.get(incoming.model_id) : undefined;
      const idModel = idUid === undefined || idUid === null ? undefined : byUid.get(idUid);
      const reverseMatches = new Set(
        incoming.aliases.flatMap((alias) => {
          const uid = modelIds.get(alias) ?? aliases.get(alias);
          return uid === undefined || uid === null ? [] : [uid];
        }),
      );
      const reverseUid = reverseMatches.size === 1 ? [...reverseMatches][0] : undefined;
      const reverseModel = reverseUid === undefined ? undefined : byUid.get(reverseUid);
      const current =
        byUid.get(incoming.uid) ??
        (matchAliases ? (idModel ?? aliasModel ?? reverseModel) : undefined);
      if (current === undefined) {
        if (create) {
          const admitted = {
            ...incoming,
            ...filterModelClaims(
              incoming,
              (field, fact) =>
                declaresModelClaims(group.source, field) && fact.source_ref === group.source.id,
            ),
          };
          byUid.set(incoming.uid, admitted);
          index(admitted);
        }
        continue;
      }
      const next = applyFields(current, incoming, group.source);
      byUid.set(current.uid, next);
      index(next);
    }
  }
  const values = [...byUid.values()];
  const canonicalIds = new Set(values.map((model) => model.model_id));
  return (
    create
      ? values.map((model) => ({
          ...model,
          aliases: model.aliases.filter((alias) => !canonicalIds.has(alias)),
        }))
      : values
  ).sort((left, right) => left.uid.localeCompare(right.uid));
}

function missingCredential(source: SourceManifest): boolean {
  return requiredEnvs(source).some((env) => {
    const value = process.env[env];
    return value === undefined || value.trim() === "";
  });
}

function requiredEnvs(source: SourceManifest): string[] {
  const auth =
    source.auth === undefined
      ? []
      : source.auth.scheme === "aws" || source.auth.scheme === "azure"
        ? source.auth.envs
        : [source.auth.env];
  const transport =
    source.transport?.kind === "databricks"
      ? [source.transport.hostEnv]
      : source.transport?.kind === "azure-models"
        ? [source.transport.subscriptionEnv]
        : [];
  return [...new Set([...auth, ...transport])];
}

function credentialLabel(source: SourceManifest): string {
  return requiredEnvs(source).join(" and ") || "Credential";
}

function retainsPricingOnFailure(source: SourceManifest): boolean {
  return isPricingSource(source) || isRequiredPricingSource(source);
}

async function fetchProviderSources(
  sources: readonly SourceManifest[],
  previousModels: readonly ProviderModel[],
  onSourceFetch?: (sourceId: string, durationMs: number) => void,
): Promise<SourceFetch[]> {
  const discoveryCache: SagemakerDiscoveryCache = new Map();
  return mapConcurrentByKey(
    sources.filter((source) => !missingCredential(source)),
    (source) =>
      source.transport?.kind === "aws-sagemaker"
        ? [new URL(source.url).hostname]
        : source.allowedHosts,
    async (source) => {
      const started = performance.now();
      try {
        const result =
          source.transport?.kind === "nvidia-nim-cards"
            ? await fetchSource(
                source,
                discoveryCache,
                previousModels
                  .filter(({ status }) => status === "unknown" || status === "deprecated")
                  .map(({ model_id }) => model_id),
              )
            : await fetchSource(source, discoveryCache);
        return { sourceId: source.id, result };
      } catch (error) {
        return { sourceId: source.id, error };
      } finally {
        onSourceFetch?.(source.id, Math.round(performance.now() - started));
      }
    },
  );
}

function sourceWarning(
  code: string,
  providerId: string,
  sourceId: string,
  detail: string,
): CatalogWarning {
  return { code, provider_id: providerId, source_id: sourceId, message: detail };
}

function missingFieldWarning(
  field: CoverageField,
  models: ParsedProviderModel[],
  providerId: string,
  sourceId: string,
): CatalogWarning | undefined {
  const count = models.filter((model) =>
    field === "limits.context_tokens"
      ? model.limits.context_tokens === undefined
      : field === "pricing"
        ? model.pricing_state === "unknown" || model.pricing_state === "not_published"
        : model[field] === undefined,
  ).length;
  if (count === 0) return undefined;
  if (field === "pricing")
    return {
      code: "missing_field",
      provider_id: providerId,
      source_id: sourceId,
      field,
      message: `Kmodels did not resolve public pricing for ${count} ${count === 1 ? "model" : "models"} from the configured official sources.`,
    };
  const fact =
    field === "limits.context_tokens"
      ? "a token context limit"
      : field === "release_date"
        ? "an official release date"
        : "an official update date";
  return {
    code: "missing_field",
    provider_id: providerId,
    source_id: sourceId,
    field,
    message: `${count} ${count === 1 ? "model does" : "models do"} not publish ${fact}.`,
  };
}

function missingFieldWarnings(
  manifest: ProviderManifest,
  models: ParsedProviderModel[],
): CatalogWarning[] {
  const configuration = manifest.warnOnMissing;
  if (configuration === undefined) return [];
  const relevantModels =
    configuration.statuses === undefined
      ? models
      : models.filter((model) => configuration.statuses?.includes(model.status));
  return configuration.fields.flatMap((field) => {
    const warning = missingFieldWarning(
      field,
      relevantModels,
      manifest.provider.id,
      configuration.sourceId,
    );
    return warning === undefined ? [] : [warning];
  });
}

function providerRecord(
  manifest: ProviderManifest,
  models: ProviderModel[],
  lastSuccessfulSyncAt: string | undefined,
): Provider {
  return {
    ...manifest.provider,
    source_ids: manifest.sources.map((source) => source.id),
    last_successful_sync_at: lastSuccessfulSyncAt,
    catalog_version: models.length === 0 ? undefined : sha256(stableJson(models)),
  };
}

function validateProviderPricing(
  pricing: ProviderPricingPartition,
  provider: Provider,
  models: ProviderModel[],
  sources: SourceRecord[],
): void {
  validatePricingCatalog(
    {
      provider_vocabularies: [pricing.vocabulary],
      provider_snapshots: [pricing.snapshot],
      model_dispositions: pricing.model_dispositions,
      books: pricing.books,
    },
    { providers: [provider], models, sources },
  );
  validateAdoptedTopology(pricing);
}

function pricingTermCount(pricing: ProviderPricingPartition | undefined): number {
  return (
    pricing?.books.reduce(
      (count, book) =>
        count + book.offers.reduce((offerCount, offer) => offerCount + offer.terms.length, 0),
      0,
    ) ?? 0
  );
}

function providerSources(
  models: ProviderModel[],
  pricing: ProviderPricingPartition | undefined,
  sources: ReadonlyMap<string, SourceRecord>,
  replaySources: readonly PricingReplaySource[] | undefined,
  inferenceSources: readonly InferencePriceSource[] = [],
  pricingDependencySources: readonly string[] = [],
): SourceRecord[] {
  const sourceIds = new Set([
    ...models.flatMap((model) => model.source_refs),
    // A failed price assembly can only retain the previous partition, whose provenance still
    // cites configured pricing sources that contribute no model rows of their own.
    ...(pricing === undefined ? pricingDependencySources : providerPartitionSourceRefs(pricing)),
    ...(replaySources ?? []).map(({ source_id }) => source_id),
    ...inferenceSources.map(({ record }) => record.id),
  ]);
  const result = [...sourceIds].flatMap((sourceId) => {
    const source = sources.get(sourceId);
    return source === undefined ? [] : [source];
  });
  if (result.length !== sourceIds.size) throw new Error("Provider provenance source is missing");
  return result;
}

function retainedPricingDependencySources(
  manifest: ProviderManifest,
  sources: ReadonlyMap<string, SourceRecord>,
): string[] {
  return manifest.sources
    .filter((source) => isPricingDependencySource(source) && sources.has(source.id))
    .map(({ id }) => id);
}

export async function collectProvider(
  manifest: ProviderManifest,
  previous: Catalog | undefined,
  state: FetchState,
  observedAt: string,
  onSourceFetch?: (sourceId: string, durationMs: number) => void,
): Promise<ProviderResult> {
  if (manifest.notConfiguredReason !== undefined) {
    return {
      provider: providerRecord(manifest, [], undefined),
      models: [],
      sources: [],
      coverage: {
        provider_id: manifest.provider.id,
        status: "not_configured",
        model_count: 0,
        pricing_term_count: 0,
        checked_at: observedAt,
        reason: manifest.notConfiguredReason,
      },
      warnings: [],
      attempt: {
        provider_id: manifest.provider.id,
        outcome: "not_configured",
        sources: [],
      },
    };
  }

  const oldModels = previousModels(previous, manifest.provider.id);
  const oldSources = previousSources(previous, manifest.provider.id);
  const oldSourceById = new Map(oldSources.map((source) => [source.id, source]));
  const currentSources = new Map(manifest.sources.map((source) => [source.id, source]));
  const comparableOldModels = oldModels.flatMap((model) => {
    const sourceRefs = model.source_refs.filter((sourceId) => currentSources.has(sourceId));
    return sourceRefs.length > 0 &&
      !manifest.supersededIdKinds?.includes(model.id_kind) &&
      !manifest.supersededModelIds?.includes(model.model_id)
      ? [
          {
            ...model,
            routes: model.routes?.filter((route) => currentSources.has(route.source_ref)),
            ...filterModelClaims(model, (field, group) => {
              const source = currentSources.get(group.source_ref);
              return (
                source !== undefined &&
                oldSourceById.get(group.source_ref)?.extractor_version ===
                  source.extractorVersion &&
                ownsModelClaim(source, field, group)
              );
            }),
            source_refs: sourceRefs,
          },
        ]
      : [];
  });
  const oldCoverage = previousCoverage(previous, manifest.provider.id);
  const warnings: CatalogWarning[] = [];
  const sourceAttempts: SourceRefreshAttempt[] = [];
  let candidateModels: ProviderModel[] | undefined;
  let validationIssue: ProviderValidationIssue | undefined;
  let providerFailure: PricingRefreshFailureCode = "provider_refresh_failed";
  const pricingSources: SourceGroup[] = [];
  const omittedPricingDependencies = new Set<string>();
  const invalidPricingDependencies = new Set<string>();
  const collectedSources: SourceRecord[] = [];
  function capturePricingInputs(): PricingReplaySource[] | undefined {
    try {
      return capturePricingReplaySources(pricingSources, collectedSources);
    } catch (error) {
      warnings.push({
        code: "pricing_replay_input_invalid",
        provider_id: manifest.provider.id,
        message: message(error),
      });
      return undefined;
    }
  }

  try {
    const sourceFetches = new Map(
      (await fetchProviderSources(manifest.sources, oldModels, onSourceFetch)).map((fetch) => [
        fetch.sourceId,
        fetch,
      ]),
    );
    const groups: SourceGroup[] = [];
    const supplements: SourceGroup[] = [];
    const overlays: SourceGroup[] = [];
    const inventories: SourceGroup[] = [];
    const unavailableInventories: SourceManifest[] = [];
    const retainedOmissions: { source: SourceManifest; observed: Set<string> }[] = [];
    let azureRetailUnmatchedVersionMeters: string[] | undefined;
    function recordOptionalOmission(source: SourceManifest, role: SourceRecord["role"]): void {
      if (role === "inventory") unavailableInventories.push(source);
      else if (source.retainOmittedFacts === true)
        retainedOmissions.push({ source, observed: new Set() });
      if (retainsPricingOnFailure(source)) omittedPricingDependencies.add(source.id);
    }
    for (const source of manifest.sources) {
      const role = source.role ?? "catalog";
      if (missingCredential(source)) {
        sourceAttempts.push({
          source_id: source.id,
          outcome: "skipped_not_configured",
          message: `Required credential(s) ${credentialLabel(source)} are not configured.`,
        });
        warnings.push(
          sourceWarning(
            "authentication_not_configured",
            manifest.provider.id,
            source.id,
            `Required credential(s) ${credentialLabel(source)} are not configured; the scoped inventory was skipped.`,
          ),
        );
        if (source.optional) {
          recordOptionalOmission(source, role);
          continue;
        }
        providerFailure = "source_unavailable";
        throw new Error(`Missing credential for ${source.id}`);
      }

      const fetch = sourceFetches.get(source.id);
      if (fetch === undefined) throw new Error(`Source fetch ${source.id} is missing`);
      if ("error" in fetch) {
        const { error } = fetch;
        const failureState = recordSourceFailure(state, source.id, observedAt);
        const evidence = contractEvidence(error);
        warnings.push(
          sourceWarning(
            evidence === undefined ? "source_fetch_failed" : "source_parse_failed",
            manifest.provider.id,
            source.id,
            message(error),
          ),
        );
        sourceAttempts.push({
          source_id: source.id,
          ...sourceFailure(error),
          ...failureState,
        });
        if (source.optional) {
          recordOptionalOmission(source, role);
          continue;
        }
        providerFailure = evidence === undefined ? "source_unavailable" : "source_schema_changed";
        throw error;
      }
      const { result } = fetch;
      const captureEvidence = () =>
        captureRepairSource(source, result.body, observedAt).catch((error: unknown) => {
          warnings.push(
            sourceWarning(
              "repair_evidence_unavailable",
              manifest.provider.id,
              source.id,
              error instanceof Error ? error.message : "Repair evidence could not be saved",
            ),
          );
        });

      const dependencyFailures = (result.dependencyFailures ?? []).map((failure) => ({
        ...failure,
        ...recordSourceFailure(state, failure.dependency_id, observedAt),
      }));
      const dependencySummary = summarizeDependencyFailures(dependencyFailures);
      if (dependencyFailures.length > 0)
        warnings.push(
          sourceWarning(
            "source_partial",
            manifest.provider.id,
            source.id,
            `${dependencyFailures.length} optional dependencies failed; bundle and claim impacts are reported separately.`,
          ),
        );

      let parsed: ParsedProviderModel[];
      let parsedSource: SourceParseResult;
      const contractFindings = createContractFindingCollector();
      const pricingReconciliationItems: PricingReconciliationItem[] = [];
      try {
        if (retainsPricingOnFailure(source))
          for (const dependency of dependencyFailures)
            if (dependency.impact === "bundle")
              omittedPricingDependencies.add(dependency.dependency_id);
        parsedSource = parseSource({
          provider: providerRecord(manifest, [], undefined),
          source,
          body: result.body,
          observedAt,
          ...(role === "catalog"
            ? {}
            : {
                catalogModels: applyPublicGroups(groups, supplements, overlays),
                inventoryModels: [
                  ...inventories.flatMap(({ models }) => models),
                  ...unavailableInventories.flatMap((inventory) =>
                    retainSourceFacts(
                      applyPublicGroups(groups, supplements, overlays),
                      comparableOldModels,
                      inventory,
                    )
                      .models.filter((model) =>
                        comparableOldModels.some(
                          (old) => old.uid === model.uid && old.source_refs.includes(inventory.id),
                        ),
                      )
                      .map((model) => ({ ...model, api_endpoints: [] })),
                  ),
                ],
              }),
          onContractFinding: contractFindings.add,
          ...(source.extractor.kind === "azure-retail-prices"
            ? {
                previousCatalogModels: comparableOldModels.filter(({ source_refs }) =>
                  source_refs.some((id) => {
                    const owner = currentSources.get(id);
                    return (
                      owner !== undefined &&
                      (owner.role === "catalog" || owner.role === "supplement") &&
                      owner.scope === "global" &&
                      owner.exhaustive !== true &&
                      oldSourceById.get(id)?.extractor_version === owner.extractorVersion
                    );
                  }),
                ),
              }
            : {}),
          onPricingReconciliation: (item) => {
            pricingReconciliationItems.push(item);
          },
          onPricingDependencyFailure: (url) => {
            if (retainsPricingOnFailure(source)) invalidPricingDependencies.add(url);
          },
        });
        azureRetailUnmatchedVersionMeters ??= parsedSource.azureRetailUnmatchedVersionMeters;
        parsed = parsedSource.models
          .map(normalizeModelTasks)
          .map(normalizeDeliveryModes)
          .map((model) => admitModelClaims(model, source, manifest.provider.id, warnings));
      } catch (error) {
        await captureEvidence();
        const failureState = recordSourceFailure(state, source.id, observedAt, result);
        const evidence = contractEvidence(error);
        if (evidence !== undefined) contractFindings.add(evidence);
        warnings.push(
          sourceWarning("source_parse_failed", manifest.provider.id, source.id, message(error)),
        );
        sourceAttempts.push({
          source_id: source.id,
          outcome: "parse_failed",
          message: message(error),
          ...failureState,
          ...dependencySummary,
          ...contractFindings.summary(),
        });
        if (source.optional) {
          recordOptionalOmission(source, role);
          continue;
        }
        providerFailure = "source_schema_changed";
        throw error;
      }

      const oldSource = oldSourceById.get(source.id);
      const contentChanged = oldSource?.content_hash !== result.contentHash;
      const extractorChanged = oldSource?.extractor_version !== source.extractorVersion;
      if (source.retainOmittedFacts === true && !extractorChanged)
        retainedOmissions.push({
          source,
          observed: dependencyFailures.every(({ impact }) => impact === "claim")
            ? new Set(parsed.map(({ uid }) => uid))
            : new Set(),
        });
      const contractSummary = contractFindings.summary();
      if (contentChanged || extractorChanged || contractSummary.contract_findings?.length)
        await captureEvidence();
      sourceAttempts.push({
        source_id: source.id,
        outcome: contentChanged || extractorChanged ? "changed" : "unchanged",
        parsed_models: parsed.length,
        content_changed: contentChanged,
        extractor_changed: extractorChanged,
        ...dependencySummary,
        ...(isPricingDependencySource(source)
          ? {
              pricing_extraction: sourcePricingExtraction(parsed),
              pricing_reconciliation: sourcePricingReconciliation(
                parsed,
                pricingReconciliationItems,
                source.access === "public" && source.auth === undefined,
              ),
            }
          : {}),
        ...contractSummary,
      });
      for (const finding of contractSummary.contract_findings ?? []) {
        const firstFinding = finding.diagnostics[0];
        if (firstFinding === undefined) continue;
        warnings.push(
          sourceWarning(
            isContractDrift(finding) ? "source_contract_drift" : "source_contract_extension",
            manifest.provider.id,
            source.id,
            `${firstFinding.kind} at ${firstFinding.path}; ${firstFinding.affected_items}/${finding.observed_items} items; fingerprint ${firstFinding.fingerprint}`,
          ),
        );
      }
      pricingSources.push({ source, ...parsedSource, models: parsed });
      if (role === "catalog") groups.push({ source, models: parsed });
      if (role === "supplement") supplements.push({ source, models: parsed });
      if (role === "overlay") overlays.push({ source, models: parsed });
      if (role === "inventory") inventories.push({ source, models: parsed });
      collectedSources.push({
        id: source.id,
        provider_id: manifest.provider.id,
        url: source.url,
        source: source.source ?? [source.type],
        stability: source.stability,
        scope: source.scope ?? "global",
        exhaustive: source.exhaustive ?? false,
        role,
        field_paths: source.fields,
        ...(source.pricingEvidence === undefined
          ? {}
          : { pricing_evidence: source.pricingEvidence }),
        observed_at: observedAt,
        etag: result.etag,
        last_modified: result.lastModified,
        content_hash: result.contentHash,
        extractor_version: source.extractorVersion,
      });
      state.sources[source.id] = sourceState(result, observedAt);
      const failedDependencyKeys = new Set(
        dependencyFailures.map(({ dependency_id }) => dependency_id),
      );
      const dependencyKeys = new Set([
        ...result.dependencies.map((dependency) => dependency.key),
        ...failedDependencyKeys,
      ]);
      for (const dependency of result.dependencies)
        if (!failedDependencyKeys.has(dependency.key))
          state.sources[dependency.key] = sourceState(dependency, observedAt);
      for (const key of Object.keys(state.sources))
        if (key.startsWith(`${source.id}/`) && !dependencyKeys.has(key)) delete state.sources[key];
    }

    if (groups.length === 0) throw new Error("No global catalog source succeeded");
    let candidate = applyPublicGroups(groups, supplements, overlays);
    const identity = (model: ProviderModel): string =>
      `${model.model_id}${model.version === undefined ? "" : `@${model.version}`}`;
    const catalogIdentities = new Set(
      candidate.flatMap((model) => [identity(model), ...model.aliases]),
    );
    for (const inventory of inventories) {
      const inventoryIds = new Set(inventory.models.map(identity));
      const missing = [...catalogIdentities].filter((id) => !inventoryIds.has(id)).length;
      const extra = [...inventoryIds].filter((id) => !catalogIdentities.has(id)).length;
      warnings.push(
        sourceWarning(
          "scope_limited",
          manifest.provider.id,
          inventory.source.id,
          `Inventory is ${inventory.source.scope ?? "account"}-scoped and cannot define global catalog presence.`,
        ),
      );
      if (missing > 0 || extra > 0)
        warnings.push(
          sourceWarning(
            "catalog_api_set_mismatch",
            manifest.provider.id,
            inventory.source.id,
            `${missing} catalog identifiers were absent from the scoped inventory; ${extra} inventory identifiers were absent from the public catalog.`,
          ),
        );
      candidate = applyGroups(candidate, [inventory], false);
    }
    for (const source of unavailableInventories) {
      const retention = retainSourceFacts(candidate, comparableOldModels, source);
      candidate = retention.models;
      if (retention.count > 0)
        warnings.push(
          sourceWarning(
            "inventory_fallback",
            manifest.provider.id,
            source.id,
            `Retained the last successful inventory enrichment for ${retention.count} ${retention.count === 1 ? "model" : "models"}.`,
          ),
        );
    }
    // Claim companions can fail independently of a successful catalog card. Their explicit
    // source/claim receipts must not opt ordinary fields into whole-source retention.
    for (const source of manifest.sources) {
      if (
        !modelClaimFields.some((field) => declaresModelClaims(source, field)) ||
        oldSourceById.get(source.id)?.extractor_version !== source.extractorVersion
      )
        continue;
      const retention = retainSourceFacts(candidate, comparableOldModels, source, new Set(), {
        detailsOnly: true,
      });
      candidate = retention.models;
      if (retention.count > 0)
        warnings.push(
          sourceWarning(
            source.fields.includes("limit_details") && !source.fields.includes("capability_details")
              ? "limit_detail_retention"
              : "model_detail_retention",
            manifest.provider.id,
            source.id,
            `Retained unobserved detail claims with their original evidence for ${retention.count} models.`,
          ),
        );
    }
    for (const { source, observed } of retainedOmissions) {
      const retention = retainSourceFacts(candidate, comparableOldModels, source, observed);
      candidate = retention.models;
      if (retention.count > 0)
        warnings.push(
          sourceWarning(
            "source_partial_retention",
            manifest.provider.id,
            source.id,
            `Retained last verified facts for ${retention.count} ${retention.count === 1 ? "model" : "models"} omitted by the current non-exhaustive source.`,
          ),
        );
    }
    candidate = candidate
      .map(normalizeModelReleaseStage)
      .map(normalizeModelTasks)
      .map(normalizeDeliveryModes);
    candidate = candidate.map((model) => {
      let accepted = model;
      for (const field of modelClaimFields) {
        const groups = model[field];
        const { subject, all } = claimSchemas[field];
        if (groups === undefined || all.safeParse(groups).success) continue;
        warnings.push(
          sourceWarning(
            `${subject}_detail_invalid`,
            manifest.provider.id,
            groups[0]?.source_ref ?? manifest.sources[0]?.id ?? "unknown",
            `Withheld combined ${subject} observations for ${model.uid} because they exceed the detail contract. Retained prior verified groups when available.`,
          ),
        );
        const prior = comparableOldModels.find(({ uid }) => uid === model.uid);
        accepted = { ...accepted, [field]: prior?.[field] };
      }
      return accepted;
    });
    const freshModels = candidate.map(publishedModel);
    candidateModels = freshModels;
    const validation = validateProvider(freshModels);
    if (!validation.ok) {
      validationIssue = validation.issue;
      throw new Error(validation.issue.message);
    }
    const reconciliationSources = {
      catalog: new Set(
        manifest.sources
          .filter(({ role }) => role === undefined || role === "catalog" || role === "supplement")
          .map(({ id }) => id),
      ),
      exhaustive: new Set(
        groups
          .filter(
            ({ source }) => source.exhaustive === true && (source.scope ?? "global") === "global",
          )
          .map(({ source }) => source.id),
      ),
      recomputed: new Set(
        collectedSources
          .filter(({ id, extractor_version }) => {
            const oldSource = oldSourceById.get(id);
            return oldSource !== undefined && oldSource.extractor_version !== extractor_version;
          })
          .map(({ id }) => id),
      ),
      releaseDate: new Set(
        manifest.sources
          .filter(({ fields }) => fields.includes("release_date"))
          .map(({ id }) => id),
      ),
    };
    const models = reconcileCatalog(freshModels, comparableOldModels, reconciliationSources);
    const sourceById = new Map(
      [...oldSources.filter((source) => currentSources.has(source.id)), ...collectedSources].map(
        (source) => [source.id, source],
      ),
    );
    const provider = providerRecord(manifest, models, observedAt);
    let pricing: ProviderPricingPartition | undefined;
    let pricingReplaySources: PricingReplaySource[] | undefined;
    let pricingFailure: PricingRefreshFailureCode | undefined;
    let pricingFailureMessage: string | undefined;
    try {
      if (invalidPricingDependencies.size > 0) {
        pricingFailure = "source_schema_changed";
        throw new Error(
          `Commercial source bundle contains rejected documents: ${[...invalidPricingDependencies].join(", ")}`,
        );
      }
      if (omittedPricingDependencies.size > 0) {
        pricingFailure = "source_unavailable";
        throw new Error(
          `Optional commercial source bundle is incomplete at ${[...omittedPricingDependencies].join(", ")}`,
        );
      }
      const expectedPricingSources = manifest.sources.filter(isRequiredPricingSource);
      const fetchedPricingSourceIds = new Set(pricingSources.map(({ source }) => source.id));
      const missingPricingSource = expectedPricingSources.find(
        ({ id }) => !fetchedPricingSourceIds.has(id),
      );
      if (missingPricingSource !== undefined) {
        pricingFailure = "source_unavailable";
        throw new Error(`Pricing source bundle is incomplete at ${missingPricingSource.id}`);
      }
      pricingReplaySources = capturePricingInputs();
      pricing = assembleParsedProviderPricing(
        manifest.provider.id,
        observedAt,
        pricingSources,
        models,
        manifest.pricingCategoricalLabels,
      );
      if (pricing !== undefined) {
        pricing = capturePricingSourceRecords(pricing, [...sourceById.values()]);
        validateProviderPricing(pricing, provider, models, [...sourceById.values()]);
      }
    } catch (error) {
      pricingFailureMessage = message(error);
      if (pricingFailure === undefined)
        warnings.push({
          code: "pricing_invalid",
          provider_id: manifest.provider.id,
          message: pricingFailureMessage,
        });
      pricing = undefined;
      pricingFailure ??= "pricing_validation_failed";
    }
    const inferencePriceSources = captureInferencePriceSources(pricingSources, collectedSources);
    const retainedSources = providerSources(
      models,
      pricing,
      sourceById,
      pricingReplaySources,
      inferencePriceSources,
      retainedPricingDependencySources(manifest, sourceById),
    );
    validateModelDetailSources({ models, sources: retainedSources });
    return {
      inferencePriceSources,
      provider,
      models,
      sources: retainedSources,
      coverage: {
        provider_id: manifest.provider.id,
        status: "fresh",
        model_count: models.length,
        pricing_term_count: pricingTermCount(pricing),
        checked_at: observedAt,
        last_successful_sync_at: observedAt,
      },
      warnings: [...warnings, ...missingFieldWarnings(manifest, candidate)],
      ...(pricing === undefined ? {} : { pricing }),
      ...(pricingReplaySources === undefined ? {} : { pricingReplaySources }),
      ...(azureRetailUnmatchedVersionMeters === undefined
        ? {}
        : { azureRetailUnmatchedVersionMeters }),
      ...(pricingFailure === undefined ? {} : { pricingFailure }),
      attempt: {
        provider_id: manifest.provider.id,
        outcome: "accepted",
        sources: sourceAttempts,
        pricing:
          pricing !== undefined
            ? { outcome: "accepted" }
            : pricingFailure === undefined
              ? { outcome: "not_observed" }
              : {
                  outcome: "failed",
                  failure_code: pricingFailure,
                  ...(pricingFailureMessage === undefined
                    ? {}
                    : { message: pricingFailureMessage }),
                },
      },
    };
  } catch (error) {
    const reason = message(error);
    const hasPrevious = oldModels.length > 0;
    const sourceById = new Map(
      [...oldSources, ...collectedSources].map((source) => [source.id, source]),
    );
    let pricing: ProviderPricingPartition | undefined;
    let pricingReplaySources: PricingReplaySource[] | undefined;
    const fetchedPricingSourceIds = new Set(pricingSources.map(({ source }) => source.id));
    const hasCompletePricingBundle = manifest.sources
      .filter(isRequiredPricingSource)
      .every(({ id }) => fetchedPricingSourceIds.has(id));
    if (
      hasPrevious &&
      omittedPricingDependencies.size === 0 &&
      invalidPricingDependencies.size === 0 &&
      hasCompletePricingBundle
    ) {
      try {
        pricingReplaySources = capturePricingInputs();
        pricing = assembleParsedProviderPricing(
          manifest.provider.id,
          observedAt,
          pricingSources,
          oldModels,
          manifest.pricingCategoricalLabels,
        );
        if (pricing !== undefined) {
          pricing = capturePricingSourceRecords(pricing, [...sourceById.values()]);
          validateProviderPricing(
            pricing,
            providerRecord(manifest, oldModels, oldCoverage?.last_successful_sync_at),
            oldModels,
            [...sourceById.values()],
          );
        }
      } catch (pricingError) {
        warnings.push({
          code: "pricing_invalid",
          provider_id: manifest.provider.id,
          message: message(pricingError),
        });
        pricing = undefined;
      }
    }
    const retainedSources = providerSources(
      oldModels,
      pricing,
      sourceById,
      pricingReplaySources,
      [],
      retainedPricingDependencySources(manifest, sourceById),
    );
    return {
      provider: providerRecord(manifest, oldModels, oldCoverage?.last_successful_sync_at),
      models: oldModels,
      sources: retainedSources,
      coverage: {
        provider_id: manifest.provider.id,
        status: hasPrevious ? "stale" : "unavailable",
        model_count: oldModels.length,
        pricing_term_count:
          pricing === undefined
            ? (oldCoverage?.pricing_term_count ?? 0)
            : pricingTermCount(pricing),
        checked_at: observedAt,
        last_successful_sync_at: oldCoverage?.last_successful_sync_at,
        reason,
      },
      warnings,
      ...(pricing === undefined ? { pricingFailure: providerFailure } : { pricing }),
      ...(pricingReplaySources === undefined ? {} : { pricingReplaySources }),
      quarantine: { provider_id: manifest.provider.id, checked_at: observedAt, reason },
      attempt: {
        provider_id: manifest.provider.id,
        outcome: "rejected",
        sources: sourceAttempts,
        ...(candidateModels === undefined ? {} : { candidate_models: candidateModels }),
        ...(validationIssue === undefined ? {} : { validation_issue: validationIssue }),
        failure: { code: providerFailure, message: reason },
        pricing:
          pricing === undefined
            ? { outcome: "failed", failure_code: providerFailure, message: reason }
            : { outcome: "accepted" },
      },
    };
  }
}

export async function collectProviders(
  previous: Catalog | undefined,
  state: FetchState,
  observedAt: string,
  rebuildProvider: string | undefined,
  selected: readonly ProviderManifest[] = manifests,
): Promise<CollectionBatch> {
  const sourceDurations: { provider_id: string; source_id: string; duration_ms: number }[] = [];
  const collected = await Promise.all(
    selected.map(async (manifest) => {
      const started = performance.now();
      const result = await collectProvider(
        manifest,
        rebuildProvider === manifest.provider.id ? undefined : previous,
        state,
        observedAt,
        (sourceId, durationMs) => {
          sourceDurations.push({
            provider_id: manifest.provider.id,
            source_id: sourceId,
            duration_ms: durationMs,
          });
        },
      );
      return {
        result,
        duration: {
          provider_id: manifest.provider.id,
          duration_ms: Math.round(performance.now() - started),
        },
      };
    }),
  );
  return {
    results: collected.map(({ result }) => result),
    durations: collected.map(({ duration }) => duration),
    sourceDurations: sourceDurations.sort((left, right) =>
      compareUtf8(left.source_id, right.source_id),
    ),
  };
}

export function collect(options: CollectionOptions = {}): Promise<Catalog> {
  // End ownership of the old pair and collection replay inputs before projection.
  return prepareCollection(options).then(async ({ candidate, catalog, summary }) => {
    await commitCatalogPair(candidate);
    await writeJson(join(rootDirectory, "data/refresh-summary.json"), summary);
    return catalog;
  });
}

async function prepareCollection(options: CollectionOptions) {
  const {
    composed,
    summary,
    stateWrites,
    results,
    explicitProviders,
    inferenceBaseline,
    previousPricingCompilation,
    operational,
  } = await prepareCollectionInputs(options);
  // Replaced accepted books and publication bytes end with the input phase, before
  // new canonical chunks overlap validation workers' private provider graphs.
  const [prepared] = await Promise.all([
    prepareCatalogPairInParallel(composed.catalog, composed.pricing),
    ...stateWrites,
  ]);
  const candidate = compileInferencePriceMapping(
    prepared,
    results.flatMap((result) =>
      explicitProviders.has(result.provider.id) ? [] : (result.inferencePriceSources ?? []),
    ),
    inferenceBaseline,
  );
  const pricingCompilation = createPricingCompilationSnapshot(
    candidate,
    pricingCompilationEntries(candidate, results, explicitProviders, previousPricingCompilation),
  );
  const runReportPath = process.env.KMODELS_REFRESH_REPORT_PATH;
  if (runReportPath !== undefined && runReportPath.trim() !== "")
    await writeJson(runReportPath, { ...summary, operational });
  await writePricingCompilationSnapshot(pricingCompilation);
  return { candidate, catalog: composed.catalog, summary };
}

async function prepareCollectionInputs(options: CollectionOptions) {
  if (
    options.loadCollected !== undefined &&
    (options.rebuild || options.rebuildProvider !== undefined)
  )
    throw new Error("Sharded collection cannot be combined with a rebuild");
  const observedAt = (options.now ?? new Date()).toISOString();
  if ((options.jitterMs ?? 0) > 0) await wait(Math.floor(Math.random() * (options.jitterMs ?? 0)));

  // End recovery's ownership of old canonical chunks before loading fresh shards.
  const acceptedPair = await recoverCatalogPair().then((pair) => {
    if (pair === undefined) return undefined;
    const inferenceBaseline: InferencePriceBaseline = {
      catalog: { sources: pair.catalog.sources },
      pricing: { data: { provider_snapshots: pair.pricing.data.provider_snapshots } },
      ...(pair.inference === undefined
        ? {}
        : {
            inference: {
              mapping: {
                rules: pair.inference.mapping.rules,
                sources: pair.inference.mapping.sources,
              },
            },
          }),
    };
    return { catalog: pair.catalog, pricing: pair.pricing, pairId: pair.pairId, inferenceBaseline };
  });
  const acceptedCatalog = acceptedPair?.catalog;
  const acceptedPricing = acceptedPair?.pricing.data ?? emptyPricingCatalog();
  const previousPricingCompilation = await loadPreviousPricingCompilation(acceptedPair);
  const previous = options.rebuild ? undefined : acceptedCatalog;
  const stateValue = await readJson(join(rootDirectory, "data/fetch-state.json"));
  const stateResult = stateValue === undefined ? undefined : fetchStateSchema.safeParse(stateValue);
  const previousState: FetchState = stateResult?.success ? stateResult.data : { sources: {} };
  const received = options.loadCollected === undefined ? undefined : await options.loadCollected();
  const state = received?.state ?? structuredClone(previousState);

  const collected =
    received ?? (await collectProviders(previous, state, observedAt, options.rebuildProvider));
  const acceptedAzure = acceptedPricing.provider_snapshots.find(
    ({ provider_id }) => provider_id === "azure",
  );
  const acceptedAzureRetail = previousPricingCompilation?.providers
    .find(({ provider_id }) => provider_id === "azure")
    ?.sources.find(({ source_id }) => source_id === azureRetailSourceId);
  const previousRetailRecord = acceptedCatalog?.sources.find(
    ({ id }) => id === azureRetailSourceId,
  );
  const results = collected.results.map((result) =>
    validateAzureRetailPublication(
      result,
      acceptedAzure,
      acceptedAzureRetail,
      previousRetailRecord,
    ),
  );

  const providers = results
    .map((result) => result.provider)
    .sort((left, right) => left.id.localeCompare(right.id));
  const models = results
    .flatMap((result) => result.models)
    .sort((left, right) => left.uid.localeCompare(right.uid));
  const sources = results
    .flatMap((result) => result.sources)
    .sort((left, right) => left.id.localeCompare(right.id));
  const coverage = results
    .map((result) => result.coverage)
    .sort((left, right) => left.provider_id.localeCompare(right.provider_id));
  const catalog = catalogSchema.parse({
    catalog_version: coreCatalogVersion(providers),
    generated_at: observedAt,
    providers,
    models,
    sources,
    coverage,
    warnings: [availabilityWarning, ...results.flatMap((result) => result.warnings)],
  });

  const configuredSourceIds = manifests.flatMap((manifest) =>
    manifest.sources.map((source) => source.id),
  );
  for (const key of Object.keys(state.sources))
    if (!configuredSourceIds.some((sourceId) => key === sourceId || key.startsWith(`${sourceId}/`)))
      delete state.sources[key];
  const stateWrites = [
    writeJson(join(rootDirectory, "data/fetch-state.json"), state),
    writeJson(
      join(rootDirectory, "data/quarantine.json"),
      results.flatMap((result) => (result.quarantine === undefined ? [] : [result.quarantine])),
    ),
  ];
  const catalogOnly = new Set(
    manifests.filter((manifest) => manifest.catalogOnly).map(({ provider }) => provider.id),
  );
  const pricingTransitions = new Map<string, ProviderPricingTransition>(
    results.map((result): [string, ProviderPricingTransition] => {
      const providerId = result.provider.id;
      if (result.pricing !== undefined)
        return [providerId, { kind: "fresh", partition: result.pricing }];
      if (catalogOnly.has(providerId) && result.coverage.status === "fresh")
        return [providerId, { kind: "fresh_empty", provider_id: providerId }];
      return [
        providerId,
        failedPricingTransition(
          providerId,
          observedAt,
          result.pricingFailure ?? "pricing_not_observed",
        ),
      ];
    }),
  );
  const explicitProviders = new Set<string>();
  for (const transition of options.pricingTransitions ?? []) {
    const providerId = pricingTransitionProviderId(transition);
    if (explicitProviders.has(providerId))
      throw new Error(`Provider ${providerId} has multiple pricing transitions`);
    explicitProviders.add(providerId);
    pricingTransitions.set(providerId, transition);
  }
  const composed = composeCatalogPair(
    acceptedCatalog,
    catalog,
    acceptedPricing,
    [...pricingTransitions.values()],
    {
      ...(acceptedPair === undefined ? {} : { accepted_pair_id: acceptedPair.pairId }),
      safety_findings: options.pricingSafetyFindings ?? [],
    },
  );
  const summary = summarizeRefresh(
    previous,
    composed.catalog,
    previous === undefined ? emptyPricingCatalog() : acceptedPricing,
    composed.pricing,
    results.map(({ attempt, models }): ProviderRefreshAttempt => {
      const retention = composed.catalog.warnings.find(
        (warning) =>
          warning.code === "retained_pricing_core_mismatch" &&
          "provider_id" in warning &&
          warning.provider_id === attempt.provider_id,
      );
      return retention === undefined
        ? attempt
        : {
            ...attempt,
            outcome: "rejected",
            candidate_models: models,
            failure: { code: retention.code, message: retention.message },
          };
    }),
  );
  const retainedProviders = new Set(
    composed.pricing.provider_snapshots
      .filter(({ publication }) => publication === "retained")
      .map(({ provider_id }) => provider_id),
  );
  return {
    composed,
    summary,
    stateWrites,
    results,
    explicitProviders,
    inferenceBaseline: acceptedPair?.inferenceBaseline,
    previousPricingCompilation:
      previousPricingCompilation === undefined
        ? undefined
        : {
            ...previousPricingCompilation,
            providers: previousPricingCompilation.providers.filter(({ provider_id }) =>
              retainedProviders.has(provider_id),
            ),
          },
    operational: {
      provider_durations: collected.durations,
      source_durations: collected.sourceDurations,
    },
  };
}

async function loadPreviousPricingCompilation(
  acceptedPair: Pick<CatalogPairData, "pricing"> | undefined,
): Promise<PricingCompilationSnapshot | undefined> {
  if (acceptedPair === undefined) return undefined;
  try {
    return await readPricingCompilationSnapshot(acceptedPair);
  } catch {
    return undefined;
  }
}

export function pricingCompilationEntries(
  candidate: CatalogPairCandidate,
  results: readonly Pick<ProviderResult, "provider" | "pricingReplaySources">[],
  explicitProviders: ReadonlySet<string>,
  previous: PricingCompilationSnapshot | undefined,
): PricingReplayProvider[] {
  const replaySources = new Map(
    results.flatMap(({ provider, pricingReplaySources }) =>
      pricingReplaySources === undefined ? [] : [[provider.id, pricingReplaySources] as const],
    ),
  );
  const previousProviders = new Map(
    previous?.providers.map((provider) => [provider.provider_id, provider]),
  );
  return candidate.pricing.data.provider_snapshots.flatMap(
    ({ provider_id: providerId, publication }) => {
      const prior = previousProviders.get(providerId);
      if (publication === "retained") return prior === undefined ? [] : [prior];

      const sources = replaySources.get(providerId);
      if (!explicitProviders.has(providerId) && sources !== undefined)
        return [{ provider_id: providerId, sources }];

      return [];
    },
  );
}
