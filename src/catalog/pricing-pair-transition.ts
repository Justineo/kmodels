import { canonicalJson } from "./canonical-json.ts";
import { stableJson, sha256 } from "./io.ts";
import type { ProviderPricingPartition } from "./pricing-assembly.ts";
import {
  failedPricingTransition,
  pricingTransitionProviderId,
  providerPartition,
  transitionProviderPricing,
  type ProviderPricingTransition,
} from "./pricing-transition.ts";
import type { PricingCatalog } from "./pricing-schema.ts";
import { catalogSchema, type Catalog } from "./schema.ts";

export interface ComposedCatalogPair {
  catalog: Catalog;
  pricing: PricingCatalog;
}

export interface AcceptedPairSafetyFinding {
  provider_id: string;
  accepted_pair_id: string;
  affects: "core" | "pricing" | "both";
  replacement_core_cleared?: true;
  replacement_pricing_cleared?: true;
}

export interface PairTransitionOptions {
  accepted_pair_id?: string;
  safety_findings?: readonly AcceptedPairSafetyFinding[];
}

export function coreCatalogVersion(providers: Catalog["providers"]): string {
  return sha256(stableJson(providers.map(({ id, catalog_version }) => [id, catalog_version])));
}

export function composeCatalogPair(
  priorCatalog: Catalog | undefined,
  freshCatalog: Catalog,
  priorPricing: PricingCatalog,
  requestedTransitions: readonly ProviderPricingTransition[],
  options: PairTransitionOptions = {},
): ComposedCatalogPair {
  const current = catalogSchema.parse(freshCatalog);
  const prior = priorCatalog === undefined ? undefined : catalogSchema.parse(priorCatalog);
  if (prior === undefined && priorPricing.provider_snapshots.length > 0)
    throw new Error("Prior canonical pricing exists without an accepted catalog");
  const modelOwners = modelOwnerLookup(prior, current);
  const findings = validateSafetyFindings(options, prior, priorPricing, modelOwners);
  const transitionByProvider = new Map<string, ProviderPricingTransition>();
  for (const transition of requestedTransitions) {
    const providerId = pricingTransitionProviderId(transition);
    if (transitionByProvider.has(providerId))
      throw new Error(`Provider ${providerId} has multiple pricing transitions`);
    transitionByProvider.set(providerId, transition);
  }

  for (const snapshot of priorPricing.provider_snapshots)
    if (!transitionByProvider.has(snapshot.provider_id))
      transitionByProvider.set(
        snapshot.provider_id,
        failedPricingTransition(
          snapshot.provider_id,
          current.generated_at,
          "provider_refresh_failed",
        ),
      );

  let catalog = current;
  let pricing = priorPricing;
  for (const [providerId, transition] of transitionByProvider) {
    const previousPartition = providerPartition(priorPricing, providerId, modelOwners);
    if (
      transition.kind === "withdraw_pricing" &&
      !(findings.get(providerId) ?? []).some((finding) => affectsSide(finding, "pricing"))
    )
      throw new Error(`pricing withdrawal has no accepted-state safety finding: ${providerId}`);
    validateTransitionSubjects(
      transition,
      providerId,
      prior,
      current,
      previousPartition !== undefined,
    );

    if (
      prior !== undefined &&
      previousPartition !== undefined &&
      transition.kind === "withdraw_pricing" &&
      !affectsCore(findings.get(providerId) ?? [])
    )
      catalog = retainProviderCore(catalog, prior, providerId);
    else if (transition.kind === "remove_provider")
      catalog = removeProviderCore(catalog, providerId);

    pricing = transitionProviderPricing(pricing, transition, modelOwners);
  }

  const composed = { catalog: withCatalogVersion(catalog), pricing };
  validateSafetyOutcome(prior, priorPricing, composed, findings, modelOwners);
  return composed;
}

function validateSafetyFindings(
  options: PairTransitionOptions,
  prior: Catalog | undefined,
  priorPricing: PricingCatalog,
  modelOwners: (modelRef: string) => string,
): Map<string, AcceptedPairSafetyFinding[]> {
  const findings = new Map<string, AcceptedPairSafetyFinding[]>();
  for (const finding of options.safety_findings ?? []) {
    if (
      options.accepted_pair_id === undefined ||
      finding.accepted_pair_id !== options.accepted_pair_id
    )
      throw new Error("Pricing safety finding is not bound to the accepted pair");
    if (prior === undefined)
      throw new Error("Pricing safety finding exists without an accepted catalog");
    if (affectsSide(finding, "core") && providerCoreSlice(prior, finding.provider_id) === undefined)
      throw new Error(`Pricing safety finding has no accepted core side: ${finding.provider_id}`);
    if (
      affectsSide(finding, "pricing") &&
      providerPartition(priorPricing, finding.provider_id, modelOwners) === undefined
    )
      throw new Error(
        `Pricing safety finding has no accepted pricing side: ${finding.provider_id}`,
      );
    const providerFindings = findings.get(finding.provider_id) ?? [];
    providerFindings.push(finding);
    findings.set(finding.provider_id, providerFindings);
  }
  return findings;
}

function validateSafetyOutcome(
  prior: Catalog | undefined,
  priorPricing: PricingCatalog,
  composed: ComposedCatalogPair,
  findings: ReadonlyMap<string, readonly AcceptedPairSafetyFinding[]>,
  modelOwners: (modelRef: string) => string,
): void {
  if (prior === undefined && findings.size > 0)
    throw new Error("Pricing safety findings require an accepted pair");
  for (const [providerId, providerFindings] of findings) {
    const priorCore = prior === undefined ? undefined : providerCoreSlice(prior, providerId);
    const currentCore = providerCoreSlice(composed.catalog, providerId);
    const priorPricingPartition = providerPartition(priorPricing, providerId, modelOwners);
    const currentPricingPartition = providerPartition(composed.pricing, providerId, modelOwners);
    for (const finding of providerFindings) {
      if (
        affectsSide(finding, "core") &&
        !safetySideCleared(
          priorCore,
          currentCore,
          finding.replacement_core_cleared === true,
          stableJson,
        )
      )
        throw new Error(`Unsafe accepted core provider slice would be republished: ${providerId}`);
      if (
        affectsSide(finding, "pricing") &&
        !safetySideCleared(
          priorPricingPartition,
          currentPricingPartition,
          finding.replacement_pricing_cleared === true,
          pricingFacts,
        )
      )
        throw new Error(
          `Unsafe accepted pricing provider partition would be republished: ${providerId}`,
        );
    }
  }
}

function safetySideCleared<T>(
  prior: T | undefined,
  current: T | undefined,
  replacementCleared: boolean,
  serialize: (value: T) => string,
): boolean {
  if (current === undefined) return true;
  return replacementCleared && prior !== undefined && serialize(prior) !== serialize(current);
}

function pricingFacts(partition: ProviderPricingPartition): string {
  return canonicalJson({
    vocabulary: partition.vocabulary,
    model_dispositions: partition.model_dispositions,
    books: partition.books,
  });
}

function providerCoreSlice(catalog: Catalog, providerId: string) {
  const providers = catalog.providers.filter(({ id }) => id === providerId);
  if (providers.length === 0) return undefined;
  return {
    providers,
    models: catalog.models.filter(({ provider_id }) => provider_id === providerId),
    sources: catalog.sources.filter(({ provider_id }) => provider_id === providerId),
  };
}

function affectsCore(findings: readonly AcceptedPairSafetyFinding[]): boolean {
  return findings.some((finding) => affectsSide(finding, "core"));
}

function affectsSide(finding: AcceptedPairSafetyFinding, side: "core" | "pricing"): boolean {
  return finding.affects === side || finding.affects === "both";
}

function validateTransitionSubjects(
  transition: ProviderPricingTransition,
  providerId: string,
  prior: Catalog | undefined,
  fresh: Catalog,
  hasPriorPricing: boolean,
): void {
  const priorCount = prior?.providers.filter(({ id }) => id === providerId).length ?? 0;
  const freshCount = fresh.providers.filter(({ id }) => id === providerId).length;
  if (transition.kind === "fresh" || transition.kind === "fresh_empty") {
    if (freshCount !== 1)
      throw new Error(`${transition.kind} provider ${providerId} is missing from fresh core`);
    return;
  }
  if (transition.kind === "remove_provider") {
    if (priorCount !== 1 || freshCount !== 0)
      throw new Error(`Removed provider ${providerId} does not match the core topology transition`);
    return;
  }
  if (transition.kind === "withdraw_pricing") {
    if (priorCount !== 1 || !hasPriorPricing)
      throw new Error(`Withdrawn provider ${providerId} has no accepted core/pricing pair`);
  }
}

function retainProviderCore(candidate: Catalog, prior: Catalog, providerId: string): Catalog {
  return catalogSchema.parse({
    ...candidate,
    providers: replaceProviderRecords(
      candidate.providers,
      prior.providers,
      ({ id }) => id === providerId,
    ),
    models: replaceProviderRecords(
      candidate.models,
      prior.models,
      ({ provider_id }) => provider_id === providerId,
    ),
    sources: replaceProviderRecords(
      candidate.sources,
      prior.sources,
      ({ provider_id }) => provider_id === providerId,
    ),
    coverage: candidate.coverage.some(({ provider_id }) => provider_id === providerId)
      ? candidate.coverage
      : replaceProviderRecords(
          candidate.coverage,
          prior.coverage,
          ({ provider_id }) => provider_id === providerId,
        ),
  });
}

function removeProviderCore(candidate: Catalog, providerId: string): Catalog {
  return catalogSchema.parse({
    ...candidate,
    providers: candidate.providers.filter(({ id }) => id !== providerId),
    models: candidate.models.filter(({ provider_id }) => provider_id !== providerId),
    sources: candidate.sources.filter(({ provider_id }) => provider_id !== providerId),
    coverage: candidate.coverage.filter(({ provider_id }) => provider_id !== providerId),
  });
}

function replaceProviderRecords<T>(
  candidate: readonly T[],
  prior: readonly T[],
  belongsToProvider: (value: T) => boolean,
): T[] {
  const retained = prior.filter(belongsToProvider);
  const output: T[] = [];
  let inserted = false;
  for (const value of candidate) {
    if (!belongsToProvider(value)) {
      output.push(value);
      continue;
    }
    if (!inserted) {
      output.push(...retained);
      inserted = true;
    }
  }
  if (!inserted) output.push(...retained);
  return output;
}

function modelOwnerLookup(
  prior: Catalog | undefined,
  fresh: Catalog,
): (modelRef: string) => string {
  const owners = new Map<string, string>();
  for (const model of [...(prior?.models ?? []), ...fresh.models]) {
    const existing = owners.get(model.uid);
    if (existing !== undefined && existing !== model.provider_id)
      throw new Error(`Model ${model.uid} has conflicting provider ownership`);
    owners.set(model.uid, model.provider_id);
  }
  return (modelRef) => {
    const providerId = owners.get(modelRef);
    if (providerId === undefined) throw new Error(`Pricing model ref is unresolved: ${modelRef}`);
    return providerId;
  };
}

function withCatalogVersion(catalog: Catalog): Catalog {
  return catalogSchema.parse({
    ...catalog,
    catalog_version: coreCatalogVersion(catalog.providers),
  });
}
