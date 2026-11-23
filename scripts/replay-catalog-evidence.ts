import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import { parseSource } from "../src/catalog/adapters.ts";
import { sha256, stableJson } from "../src/catalog/io.ts";
import { manifests, type SourceManifest } from "../src/catalog/manifests.ts";
import { sourcePriceFactSchema, parsedPricingStateSchema } from "../src/catalog/pricing-source.ts";
import { isPricingDependencySource } from "../src/catalog/pricing-adapter.ts";
import { providerModelSchema } from "../src/catalog/schema.ts";
import {
  contractEvidence,
  createContractFindingCollector,
} from "../src/catalog/source-contract.ts";
import { sourceErrorFingerprint, sourceErrorMessage } from "../src/catalog/source-failure.ts";
import {
  sourcePricingReconciliation,
  type PricingReconciliationItem,
} from "../src/catalog/pricing-reconciliation.ts";

const evidenceSchema = z.object({
  source_id: z.string(),
  scope: z.literal("source"),
  source_url: z.url(),
  observed_at: z.iso.datetime({ offset: true }),
  source_hash: z.string().regex(/^[a-f0-9]{64}$/),
  body: z.string(),
});
export const replayContextModelsSchema = z.array(
  providerModelSchema
    .extend({
      pricing_state: parsedPricingStateSchema.optional(),
      price_facts: z.array(sourcePriceFactSchema).optional(),
    })
    .transform(({ price_facts, pricing_state, ...model }) => ({
      ...model,
      ...(price_facts === undefined ? {} : { price_facts }),
      ...(pricing_state === undefined ? {} : { pricing_state }),
    })),
);
export const replayStructuredContextSchema = z.strictObject({
  catalog_models: replayContextModelsSchema.optional(),
  previous_catalog_models: replayContextModelsSchema.optional(),
  previous_retail_meters: z.array(z.string().min(1)).optional(),
});
export const replayContextSchema = z.union([
  replayContextModelsSchema,
  replayStructuredContextSchema,
]);

export interface ParsedReplayContext {
  kind: "catalog_models" | "azure_retail";
  catalogModels?: z.infer<typeof replayContextModelsSchema>;
  previousCatalogModels?: z.infer<typeof replayContextModelsSchema>;
  previousRetailMeters?: Set<string>;
}

/**
 * Single authoritative parser for offline replay context files, shared by both
 * `triage.ts` evidence discovery and `replay-catalog-evidence.ts` execution.
 */
export function parseReplayContext(
  context: unknown,
  expectedProviderId?: string,
): ParsedReplayContext {
  const parsedContext = replayContextSchema.parse(context);
  const catalogModels = Array.isArray(parsedContext) ? parsedContext : parsedContext.catalog_models;
  const previousCatalogModels = Array.isArray(parsedContext)
    ? undefined
    : parsedContext.previous_catalog_models;
  const previousRetailMeters =
    Array.isArray(parsedContext) || parsedContext.previous_retail_meters === undefined
      ? undefined
      : new Set(parsedContext.previous_retail_meters);
  if (
    expectedProviderId !== undefined &&
    (catalogModels?.some(({ provider_id }) => provider_id !== expectedProviderId) ||
      previousCatalogModels?.some(({ provider_id }) => provider_id !== expectedProviderId))
  ) {
    throw new Error("Replay catalog context has another provider's models");
  }
  const isAzureRetail =
    !Array.isArray(parsedContext) &&
    parsedContext.catalog_models !== undefined &&
    parsedContext.previous_catalog_models !== undefined &&
    parsedContext.previous_retail_meters !== undefined;
  return {
    kind: isAzureRetail ? "azure_retail" : "catalog_models",
    ...(catalogModels === undefined ? {} : { catalogModels }),
    ...(previousCatalogModels === undefined ? {} : { previousCatalogModels }),
    ...(previousRetailMeters === undefined ? {} : { previousRetailMeters }),
  };
}

export function verifiedCatalogEvidence(sourceId: string, input: unknown) {
  const evidence = evidenceSchema.parse(input);
  if (evidence.source_id !== sourceId || sha256(evidence.body) !== evidence.source_hash)
    throw new Error("Replay source identity or body hash does not match its evidence");
  const manifest = manifests.find(({ sources }) => sources.some(({ id }) => id === sourceId));
  const source: SourceManifest | undefined = manifest?.sources.find(({ id }) => id === sourceId);
  if (manifest === undefined || source === undefined || source.access !== "public" || source.auth)
    throw new Error("Replay requires an exact reviewed public source ID");
  if (evidence.source_url !== source.url)
    throw new Error("Replay full-source URL does not match its reviewed source");
  return { manifest, source, evidence };
}

export type ReplayFailureStage = "input_error" | "evidence_error" | "context_error" | "parse_error";

export function parseEvidence(
  sourceId: string,
  input: unknown,
  context?: unknown,
  onStage?: (stage: ReplayFailureStage) => void,
  findings = createContractFindingCollector(),
) {
  onStage?.("evidence_error");
  const { manifest, source, evidence } = verifiedCatalogEvidence(sourceId, input);
  onStage?.("context_error");
  const parsedContext =
    context === undefined ? undefined : parseReplayContext(context, manifest.provider.id);
  const catalogModels = parsedContext?.catalogModels;
  const previousCatalogModels = parsedContext?.previousCatalogModels;
  const previousRetailMeters = parsedContext?.previousRetailMeters;
  onStage?.("parse_error");
  const reconciliation: PricingReconciliationItem[] = [];
  const result = parseSource({
    provider: { ...manifest.provider, source_ids: manifest.sources.map(({ id }) => id) },
    source,
    body: evidence.body,
    observedAt: evidence.observed_at,
    ...(catalogModels === undefined ? {} : { catalogModels }),
    ...(previousCatalogModels === undefined ? {} : { previousCatalogModels }),
    ...(previousRetailMeters === undefined ? {} : { previousRetailMeters }),
    onContractFinding: findings.add,
    onPricingReconciliation: (item) => reconciliation.push(item),
  });
  return {
    result,
    evidence,
    source,
    catalogModels,
    previousCatalogModels,
    previousRetailMeters,
    findings,
    reconciliation,
  };
}

export function replayCatalogEvidence(
  sourceId: string,
  input: unknown,
  context?: unknown,
  onStage?: (stage: ReplayFailureStage) => void,
  findings = createContractFindingCollector(),
) {
  const {
    result,
    evidence,
    source,
    catalogModels,
    previousCatalogModels,
    previousRetailMeters,
    reconciliation,
  } = parseEvidence(sourceId, input, context, onStage, findings);
  const hasStructuredContext =
    previousCatalogModels !== undefined || previousRetailMeters !== undefined;
  const contextHashPayload = hasStructuredContext
    ? {
        catalog_models: catalogModels ?? [],
        previous_catalog_models: previousCatalogModels ?? [],
        previous_retail_meters: [...(previousRetailMeters ?? [])].sort(),
      }
    : catalogModels;
  return {
    schema_version: 1,
    stage: "parse",
    source_id: sourceId,
    source_url: evidence.source_url,
    source_hash: evidence.source_hash,
    extractor_version: source.extractorVersion,
    observed_at: evidence.observed_at,
    context:
      contextHashPayload === undefined
        ? null
        : {
            model_count: catalogModels?.length ?? 0,
            ...(previousCatalogModels === undefined
              ? {}
              : { previous_model_count: previousCatalogModels.length }),
            ...(previousRetailMeters === undefined
              ? {}
              : { previous_retail_meter_count: previousRetailMeters.size }),
            sha256: sha256(stableJson(contextHashPayload)),
          },
    models: result.models.map(
      ({ uid, release_date, updated_date, price_facts, raw_price_facts }) => ({
        uid,
        release_date,
        updated_date,
        prices: price_facts.length,
        raw_prices: raw_price_facts.length,
      }),
    ),
    pricing_inputs: result.pricing_inputs?.length ?? 0,
    commercial_facts: result.commercial_facts?.length ?? 0,
    ...findings.summary(),
    ...(findings.replayCounts().total_findings === 0
      ? {}
      : {
          contract_findings_total: findings.replayCounts().total_findings,
          contract_reject_findings: findings.replayCounts().reject_findings,
          contract_diagnostic_counts: findings.replayCounts().diagnostic_counts,
          contract_reject_diagnostic_counts: findings.replayCounts().reject_diagnostic_counts,
        }),
    reconciliation: isPricingDependencySource(source)
      ? sourcePricingReconciliation(result.models, reconciliation, true)
      : null,
  };
}

const maxReplayBytes = 128 * 1024 * 1024;

export async function readBoundedJson(path: string): Promise<unknown> {
  if ((await stat(path)).size > maxReplayBytes) throw new Error("Replay file exceeds 128 MiB");
  const raw = await readFile(path);
  const text = path.endsWith(".gz")
    ? gunzipSync(raw, { maxOutputLength: maxReplayBytes }).toString("utf8")
    : raw.toString("utf8");
  return JSON.parse(text);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [sourceId, path, context, extra] = process.argv.slice(2);
  if (sourceId === undefined || path === undefined || extra !== undefined)
    throw new Error("Expected SOURCE_ID EVIDENCE_JSON [PARSED_CATALOG_MODELS_JSON]");
  // Let parse failures terminate with a nonzero status while emitting exact stage, fingerprint,
  // and BOTH pre-throw accumulated diagnostics and final exception diagnostics on stderr.
  let failureStage: ReplayFailureStage = "input_error";
  let verifiedSourceHash: string | undefined;
  const findings = createContractFindingCollector();
  try {
    const rawEvidence = await readBoundedJson(path);
    const rawContext = context === undefined ? undefined : await readBoundedJson(context);
    if (
      typeof rawEvidence === "object" &&
      rawEvidence !== null &&
      "source_hash" in rawEvidence &&
      typeof rawEvidence.source_hash === "string" &&
      /^[a-f0-9]{64}$/.test(rawEvidence.source_hash)
    ) {
      verifiedSourceHash = rawEvidence.source_hash;
    }
    const summary = replayCatalogEvidence(
      sourceId,
      rawEvidence,
      rawContext,
      (stage) => {
        failureStage = stage;
      },
      findings,
    );
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    const contract = contractEvidence(error);
    if (contract !== undefined) findings.add(contract);
    const replayCounts = findings.replayCounts();
    console.error(
      JSON.stringify({
        schema_version: 1,
        stage: failureStage,
        source_id: sourceId,
        ...(verifiedSourceHash === undefined ? {} : { source_hash: verifiedSourceHash }),
        error_name: error instanceof Error ? error.name : "Error",
        error_fingerprint: sourceErrorFingerprint(error),
        message: sourceErrorMessage(error),
        ...(contract === undefined ? {} : { contract_finding: contract }),
        ...findings.summary(),
        ...(replayCounts.total_findings === 0
          ? {}
          : {
              contract_findings_total: replayCounts.total_findings,
              contract_diagnostic_counts: replayCounts.diagnostic_counts,
            }),
      }),
    );
    process.exitCode = 1;
  }
}
