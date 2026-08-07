import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { parseSource } from "./adapters.ts";
import { deliveryModeEvidenceKey, normalizeDeliveryModes } from "./delivery.ts";
import {
  fetchSource,
  fetchStateSchema,
  type FetchResult,
  type FetchState,
  type SourceState,
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
import {
  composeCatalogPair,
  coreCatalogVersion,
  type AcceptedPairSafetyFinding,
} from "./pricing-pair-transition.ts";
import type { ProviderPricingPartition } from "./pricing-assembly.ts";
import {
  commitCatalogPair,
  prepareCatalogPairInParallel,
  recoverCatalogPair,
  type CatalogPairCandidate,
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
import { assembleParsedProviderPricing, isRequiredPricingSource } from "./pricing-adapter.ts";
import {
  publishedModel,
  type ParsedProviderModel,
  type SourcePriceFact,
  type SourceRawPricingFact,
} from "./pricing-source.ts";
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
import { contractEvidence, type SourceContractEvidence } from "./source-contract.ts";

const availabilityWarning: CatalogWarning = {
  code: "account_availability_unknown",
  message: "Global catalog presence does not imply availability to a specific account.",
};

interface ProviderResult {
  provider: Provider;
  models: ProviderModel[];
  sources: SourceRecord[];
  coverage: Coverage;
  warnings: CatalogWarning[];
  pricing?: ProviderPricingPartition;
  pricingReplaySources?: PricingReplaySource[];
  pricingFailure?: PricingRefreshFailureCode;
  quarantine?: { provider_id: string; checked_at: string; reason: string };
  attempt: ProviderRefreshAttempt;
}

interface CollectionOptions {
  now?: Date;
  jitterMs?: number;
  rebuild?: boolean;
  rebuildProvider?: string;
  pricingTransitions?: readonly ProviderPricingTransition[];
  pricingSafetyFindings?: readonly AcceptedPairSafetyFinding[];
}

function message(error: unknown): string {
  return error instanceof Error
    ? error.message
        .replace(/https?:\/\/\S+/g, "[source]")
        .replace(/\barn:aws(?:-[a-z0-9-]+)?:[^\s,;"']+/gi, "[resource]")
        .replace(/\b\d{12}\b/g, "[account]")
        .replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi, "[identity]")
    : "Unknown collection failure";
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

export interface SourceGroup {
  source: SourceManifest;
  models: ParsedProviderModel[];
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

function priceFactKey(fact: SourcePriceFact): string {
  return `${fact.meter}\0${fact.currency}\0${fact.unit}\0${JSON.stringify(fact.conditions)}`;
}

function mergePriceFacts(
  current: ParsedProviderModel,
  incoming: ParsedProviderModel,
): SourcePriceFact[] {
  if (incoming.price_facts.length === 0) return incoming.price_facts;
  return [
    ...new Map(
      [...current.price_facts, ...incoming.price_facts].map((fact) => [priceFactKey(fact), fact]),
    ).values(),
  ].sort((left, right) => priceFactKey(left).localeCompare(priceFactKey(right)));
}

function mergeRawPriceFacts(
  current: ParsedProviderModel,
  incoming: ParsedProviderModel,
): SourceRawPricingFact[] {
  if (incoming.raw_price_facts.length === 0) return incoming.raw_price_facts;
  return [
    ...new Map(
      [...current.raw_price_facts, ...incoming.raw_price_facts].map((fact) => [
        JSON.stringify(fact),
        fact,
      ]),
    ).values(),
  ].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function applyFields(
  current: ParsedProviderModel,
  incoming: ParsedProviderModel,
  source: SourceManifest,
): ParsedProviderModel {
  const fields = new Set(source.fields);
  const fillOnly = source.role === "inventory";
  const incomingModalities =
    incoming.modalities.input.length + incoming.modalities.output.length > 0;
  const incomingOperations = incoming.tasks.length > 0;
  const incomingPricing =
    incoming.price_facts.length > 0 ||
    incoming.raw_price_facts.length > 0 ||
    incoming.pricing_state !== "unknown";
  const applyPricing =
    fields.has("pricing") && incomingPricing && (!fillOnly || current.pricing_state === "unknown");
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
    aliases: fields.has("aliases")
      ? [...new Set([...current.aliases, ...incoming.aliases])]
      : current.aliases,
    tasks:
      fields.has("tasks") && incomingOperations
        ? [...new Set([...current.tasks, ...incoming.tasks])]
        : current.tasks,
    delivery_modes: fields.has("delivery_modes")
      ? [...new Set([...(current.delivery_modes ?? []), ...(incoming.delivery_modes ?? [])])]
      : current.delivery_modes,
    delivery_mode_evidence: fields.has("delivery_modes")
      ? [
          ...new Map(
            [
              ...(current.delivery_mode_evidence ?? []),
              ...(incoming.delivery_mode_evidence ?? []),
            ].map((evidence) => [deliveryModeEvidenceKey(evidence), evidence]),
          ).values(),
        ]
      : current.delivery_mode_evidence,
    raw_type: fields.has("tasks")
      ? optional(current.raw_type, incoming.raw_type, fillOnly)
      : current.raw_type,
    service_families: fields.has("service_families")
      ? serviceFamilies.length === 0
        ? undefined
        : serviceFamilies
      : current.service_families,
    api_endpoints: fields.has("api_endpoints")
      ? [
          ...new Map(
            [...(current.api_endpoints ?? []), ...(incoming.api_endpoints ?? [])].map(
              (endpoint) => [apiEndpointKey(endpoint), endpoint],
            ),
          ).values(),
        ].sort((left, right) => apiEndpointKey(left).localeCompare(apiEndpointKey(right)))
      : current.api_endpoints,
    routes: fields.has("routes")
      ? [
          ...new Map(
            [...(current.routes ?? []), ...(incoming.routes ?? [])].map((route) => [
              modelRouteKey(route),
              route,
            ]),
          ).values(),
        ].sort((left, right) => modelRouteKey(left).localeCompare(modelRouteKey(right)))
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
    availability: fields.has("availability")
      ? [
          ...new Map(
            [...(current.availability ?? []), ...(incoming.availability ?? [])].map((item) => [
              `${item.region}\u0000${item.deployment_type}`,
              item,
            ]),
          ).values(),
        ].sort((left, right) =>
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
          byUid.set(incoming.uid, incoming);
          index(incoming);
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

async function collectProvider(
  manifest: ProviderManifest,
  previous: Catalog | undefined,
  state: FetchState,
  observedAt: string,
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
  const currentSourceIds = new Set(manifest.sources.map((source) => source.id));
  const comparableOldModels = oldModels.flatMap((model) => {
    const sourceRefs = model.source_refs.filter((sourceId) => currentSourceIds.has(sourceId));
    return sourceRefs.length > 0 &&
      !manifest.supersededIdKinds?.includes(model.id_kind) &&
      !manifest.supersededModelIds?.includes(model.model_id)
      ? [
          {
            ...model,
            routes: model.routes?.filter((route) => currentSourceIds.has(route.source_ref)),
            source_refs: sourceRefs,
          },
        ]
      : [];
  });
  const oldSources = previousSources(previous, manifest.provider.id);
  const oldSourceById = new Map(oldSources.map((source) => [source.id, source]));
  const oldCoverage = previousCoverage(previous, manifest.provider.id);
  const warnings: CatalogWarning[] = [];
  const sourceAttempts: SourceRefreshAttempt[] = [];
  let candidateModels: ProviderModel[] | undefined;
  let validationIssue: ProviderValidationIssue | undefined;
  let providerFailure: PricingRefreshFailureCode = "provider_refresh_failed";

  try {
    const groups: SourceGroup[] = [];
    const supplements: SourceGroup[] = [];
    const overlays: SourceGroup[] = [];
    const inventories: SourceGroup[] = [];
    const pricingSources: SourceGroup[] = [];
    const sources: SourceRecord[] = [];
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
        if (source.optional) continue;
        providerFailure = "source_unavailable";
        throw new Error(`Missing credential for ${source.id}`);
      }

      let result: Awaited<ReturnType<typeof fetchSource>>;
      try {
        result = await fetchSource(source);
      } catch (error) {
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
          outcome: evidence === undefined ? "fetch_failed" : "parse_failed",
          message: message(error),
          ...failureState,
          ...(evidence === undefined ? {} : { contract_finding: evidence }),
        });
        if (source.optional) continue;
        providerFailure = evidence === undefined ? "source_unavailable" : "source_schema_changed";
        throw error;
      }

      let parsed: ParsedProviderModel[];
      let contractFinding: SourceContractEvidence | undefined;
      const pricingReconciliationItems: PricingReconciliationItem[] = [];
      try {
        parsed = parseSource({
          provider: providerRecord(manifest, [], undefined),
          source,
          body: result.body,
          observedAt,
          ...(role === "catalog"
            ? {}
            : { catalogModels: applyPublicGroups(groups, supplements, overlays) }),
          onContractFinding: (finding) => {
            contractFinding = finding;
          },
          onPricingReconciliation: (item) => {
            pricingReconciliationItems.push(item);
          },
        });
      } catch (error) {
        const failureState = recordSourceFailure(state, source.id, observedAt, result);
        const evidence = contractEvidence(error);
        warnings.push(
          sourceWarning("source_parse_failed", manifest.provider.id, source.id, message(error)),
        );
        sourceAttempts.push({
          source_id: source.id,
          outcome: "parse_failed",
          message: message(error),
          ...failureState,
          ...(evidence === undefined ? {} : { contract_finding: evidence }),
        });
        if (source.optional) continue;
        providerFailure = "source_schema_changed";
        throw error;
      }

      const oldSource = oldSourceById.get(source.id);
      const contentChanged = oldSource?.content_hash !== result.contentHash;
      const extractorChanged = oldSource?.extractor_version !== source.extractorVersion;
      sourceAttempts.push({
        source_id: source.id,
        outcome: contentChanged || extractorChanged ? "changed" : "unchanged",
        parsed_models: parsed.length,
        content_changed: contentChanged,
        extractor_changed: extractorChanged,
        ...(source.fields.includes("pricing")
          ? {
              pricing_extraction: sourcePricingExtraction(parsed),
              pricing_reconciliation: sourcePricingReconciliation(
                parsed,
                pricingReconciliationItems,
                source.access === "public" && source.auth === undefined,
              ),
            }
          : {}),
        ...(contractFinding === undefined ? {} : { contract_finding: contractFinding }),
      });
      const firstFinding = contractFinding?.diagnostics[0];
      if (contractFinding !== undefined && firstFinding !== undefined)
        warnings.push(
          sourceWarning(
            "source_contract_extension",
            manifest.provider.id,
            source.id,
            `${firstFinding.kind} at ${firstFinding.path}; ${firstFinding.affected_items}/${contractFinding.observed_items} items; fingerprint ${firstFinding.fingerprint}`,
          ),
        );
      pricingSources.push({ source, models: parsed });
      if (role === "catalog") groups.push({ source, models: parsed });
      if (role === "supplement") supplements.push({ source, models: parsed });
      if (role === "overlay") overlays.push({ source, models: parsed });
      if (role === "inventory") inventories.push({ source, models: parsed });
      sources.push({
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
      const dependencyKeys = new Set(result.dependencies.map((dependency) => dependency.key));
      for (const dependency of result.dependencies)
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
    candidate = candidate
      .map(normalizeModelReleaseStage)
      .map(normalizeModelTasks)
      .map(normalizeDeliveryModes);
    const freshModels = candidate.map(publishedModel);
    candidateModels = freshModels;
    const validation = validateProvider(freshModels, comparableOldModels);
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
        sources
          .filter(({ id, extractor_version }) => {
            const oldSource = oldSourceById.get(id);
            return oldSource !== undefined && oldSource.extractor_version !== extractor_version;
          })
          .map(({ id }) => id),
      ),
    };
    const models = reconcileCatalog(freshModels, comparableOldModels, reconciliationSources);
    const sourceById = new Map(
      [...oldSources.filter((source) => currentSourceIds.has(source.id)), ...sources].map(
        (source) => [source.id, source],
      ),
    );
    const provider = providerRecord(manifest, models, observedAt);
    let pricing: ProviderPricingPartition | undefined;
    let pricingReplaySources: PricingReplaySource[] | undefined;
    let pricingFailure: PricingRefreshFailureCode | undefined;
    let pricingFailureMessage: string | undefined;
    try {
      const expectedPricingSources = manifest.sources.filter(isRequiredPricingSource);
      const fetchedPricingSourceIds = new Set(pricingSources.map(({ source }) => source.id));
      const missingPricingSource = expectedPricingSources.find(
        ({ id }) => !fetchedPricingSourceIds.has(id),
      );
      if (missingPricingSource !== undefined)
        throw new Error(`Pricing source bundle is incomplete at ${missingPricingSource.id}`);
      pricing = assembleParsedProviderPricing(
        manifest.provider.id,
        observedAt,
        pricingSources,
        models,
        manifest.pricingCategoricalLabels,
      );
      if (pricing !== undefined) {
        validatePricingCatalog(
          {
            provider_vocabularies: [pricing.vocabulary],
            provider_snapshots: [pricing.snapshot],
            model_dispositions: pricing.model_dispositions,
            books: pricing.books,
          },
          { providers: [provider], models, sources: [...sourceById.values()] },
        );
        try {
          pricingReplaySources = capturePricingReplaySources(pricingSources, sources);
        } catch (error) {
          warnings.push({
            code: "pricing_replay_input_invalid",
            provider_id: manifest.provider.id,
            message: message(error),
          });
        }
      }
    } catch (error) {
      pricingFailureMessage = message(error);
      warnings.push({
        code: "pricing_invalid",
        provider_id: manifest.provider.id,
        message: pricingFailureMessage,
      });
      pricing = undefined;
      pricingFailure = "pricing_validation_failed";
    }
    const referencedSourceIds = new Set([
      ...models.flatMap((model) => model.source_refs),
      ...(pricing === undefined ? [] : providerPartitionSourceRefs(pricing)),
    ]);
    const retainedSources = [...referencedSourceIds].flatMap((sourceId) => {
      const source = sourceById.get(sourceId);
      return source === undefined ? [] : [source];
    });
    if (retainedSources.length !== referencedSourceIds.size)
      throw new Error("Published provenance source is missing");
    return {
      provider,
      models,
      sources: retainedSources,
      coverage: {
        provider_id: manifest.provider.id,
        status: "fresh",
        model_count: models.length,
        pricing_term_count:
          pricing?.books.reduce(
            (count, book) =>
              count + book.offers.reduce((offerCount, offer) => offerCount + offer.terms.length, 0),
            0,
          ) ?? 0,
        checked_at: observedAt,
        last_successful_sync_at: observedAt,
      },
      warnings: [...warnings, ...missingFieldWarnings(manifest, candidate)],
      ...(pricing === undefined ? {} : { pricing }),
      ...(pricingReplaySources === undefined ? {} : { pricingReplaySources }),
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
    return {
      provider: providerRecord(manifest, oldModels, oldCoverage?.last_successful_sync_at),
      models: oldModels,
      sources: oldSources,
      coverage: {
        provider_id: manifest.provider.id,
        status: hasPrevious ? "stale" : "unavailable",
        model_count: oldModels.length,
        pricing_term_count: oldCoverage?.pricing_term_count ?? 0,
        checked_at: observedAt,
        last_successful_sync_at: oldCoverage?.last_successful_sync_at,
        reason,
      },
      warnings,
      pricingFailure: providerFailure,
      quarantine: { provider_id: manifest.provider.id, checked_at: observedAt, reason },
      attempt: {
        provider_id: manifest.provider.id,
        outcome: "rejected",
        sources: sourceAttempts,
        ...(candidateModels === undefined ? {} : { candidate_models: candidateModels }),
        ...(validationIssue === undefined ? {} : { validation_issue: validationIssue }),
        failure: { code: providerFailure, message: reason },
        pricing: { outcome: "failed", failure_code: providerFailure, message: reason },
      },
    };
  }
}

async function collectProviders(
  previous: Catalog | undefined,
  state: FetchState,
  observedAt: string,
  rebuildProvider: string | undefined,
): Promise<{
  results: ProviderResult[];
  durations: { provider_id: string; duration_ms: number }[];
}> {
  const collected = await Promise.all(
    manifests.map(async (manifest) => {
      const started = performance.now();
      const result = await collectProvider(
        manifest,
        rebuildProvider === manifest.provider.id ? undefined : previous,
        state,
        observedAt,
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
  };
}

export async function collect(options: CollectionOptions = {}): Promise<Catalog> {
  const observedAt = (options.now ?? new Date()).toISOString();
  if ((options.jitterMs ?? 0) > 0) await wait(Math.floor(Math.random() * (options.jitterMs ?? 0)));

  const acceptedPair = await recoverCatalogPair();
  const acceptedCatalog = acceptedPair?.catalog;
  const acceptedPricing = acceptedPair?.pricing.data ?? emptyPricingCatalog();
  const previousPricingCompilation = await loadPreviousPricingCompilation(acceptedPair);
  const previous = options.rebuild ? undefined : acceptedCatalog;
  const stateValue = await readJson(join(rootDirectory, "data/fetch-state.json"));
  const stateResult = stateValue === undefined ? undefined : fetchStateSchema.safeParse(stateValue);
  const previousState: FetchState = stateResult?.success ? stateResult.data : { sources: {} };
  const state = structuredClone(previousState);

  const collected = await collectProviders(previous, state, observedAt, options.rebuildProvider);
  const { results } = collected;

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
  await writeJson(join(rootDirectory, "data/fetch-state.json"), state);
  await writeJson(
    join(rootDirectory, "data/quarantine.json"),
    results.flatMap((result) => (result.quarantine === undefined ? [] : [result.quarantine])),
  );
  const pricingTransitions = new Map<string, ProviderPricingTransition>(
    results.map((result): [string, ProviderPricingTransition] => [
      result.provider.id,
      result.pricing === undefined
        ? failedPricingTransition(
            result.provider.id,
            observedAt,
            result.pricingFailure ?? "pricing_not_observed",
          )
        : { kind: "fresh", partition: result.pricing },
    ]),
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
  const candidate = await prepareCatalogPairInParallel(composed.catalog, composed.pricing);
  const pricingCompilation = createPricingCompilationSnapshot(
    candidate,
    pricingCompilationEntries(
      candidate,
      results,
      pricingTransitions,
      explicitProviders,
      previousPricingCompilation,
    ),
  );
  const summary = summarizeRefresh(
    previous,
    composed.catalog,
    previous === undefined ? emptyPricingCatalog() : acceptedPricing,
    composed.pricing,
    results.map(({ attempt }) => attempt),
  );
  const runReportPath = process.env.KMODELS_REFRESH_REPORT_PATH;
  if (runReportPath !== undefined && runReportPath.trim() !== "")
    await writeJson(runReportPath, {
      ...summary,
      operational: { provider_durations: collected.durations },
    });
  await writePricingCompilationSnapshot(pricingCompilation);
  await commitCatalogPair(candidate);
  await writeJson(join(rootDirectory, "data/refresh-summary.json"), summary);
  return composed.catalog;
}

async function loadPreviousPricingCompilation(
  acceptedPair: Awaited<ReturnType<typeof recoverCatalogPair>>,
): Promise<PricingCompilationSnapshot | undefined> {
  if (acceptedPair === undefined) return undefined;
  try {
    return await readPricingCompilationSnapshot(acceptedPair);
  } catch {
    return undefined;
  }
}

function pricingCompilationEntries(
  candidate: CatalogPairCandidate,
  results: readonly ProviderResult[],
  transitions: ReadonlyMap<string, ProviderPricingTransition>,
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
  return candidate.pricing.data.provider_snapshots.flatMap(({ provider_id: providerId }) => {
    const transition = transitions.get(providerId);
    const sources = replaySources.get(providerId);
    if (transition?.kind === "fresh" && !explicitProviders.has(providerId) && sources !== undefined)
      return [{ provider_id: providerId, sources }];

    const prior = previousProviders.get(providerId);
    return transition?.kind === "failed" && prior !== undefined ? [prior] : [];
  });
}
