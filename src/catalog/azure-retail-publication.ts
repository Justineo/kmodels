import { canonicalJson } from "./canonical-value.ts";
import type { ProviderResult } from "./collection-result.ts";
import type { PricingReplaySource } from "./pricing-compilation.ts";
import type { ProviderPricingSnapshot } from "./pricing-schema.ts";
import { sourcePriceFactKey, type SourcePriceFact } from "./pricing-source.ts";
import {
  comparePublishedTimes,
  parsePublishedBoundary,
  publishedValidityStatus,
} from "./pricing-time.ts";
import type { ProviderModel, SourceRecord } from "./schema.ts";

export const azureRetailSourceId = "azure-retail-prices";

export function azureRetailMeterKey(modelRef: string, meterId: string, region?: string): string {
  return canonicalJson([modelRef, meterId, region ?? ""]);
}

export function acceptedAzureRetailMeters(
  prior: PricingReplaySource | undefined,
  record: SourceRecord | undefined,
) {
  const keys = new Set<string>();
  if (
    !prior ||
    record?.id !== azureRetailSourceId ||
    prior.source_id !== record.id ||
    prior.content_hash !== record.content_hash ||
    prior.extractor_version !== record.extractor_version
  )
    return keys;
  for (const model of prior.models) {
    if (model.version !== undefined) continue;
    for (const fact of model.price_facts) {
      if (fact.source_locator?.kind === "meter")
        keys.add(azureRetailMeterKey(model.uid, fact.source_locator.value, fact.conditions.region));
    }
  }
  return keys;
}

export function azureRetailModelRetired(
  model: Pick<ProviderModel, "status" | "retired_at">,
  observedAt: string,
): boolean {
  return (
    model.status === "retired" ||
    (model.retired_at !== undefined && model.retired_at <= observedAt.slice(0, 10))
  );
}

function comparablePriceKey(uid: string, fact: SourcePriceFact, legacyTier: boolean): string {
  const { effective_from: _effectiveFrom, service_tier, ...conditions } = fact.conditions;
  return canonicalJson([
    uid,
    fact.source_locator?.value ?? null,
    sourcePriceFactKey({
      ...fact,
      conditions: {
        ...conditions,
        ...(service_tier === undefined || (legacyTier && service_tier === "standard")
          ? {}
          : { service_tier }),
      },
    }),
  ]);
}

function observedValidity(fact: SourcePriceFact): string | undefined {
  return fact.raw_validity ?? fact.conditions.effective_from;
}

function supportsPriorValidity(
  previous: SourcePriceFact,
  current: SourcePriceFact,
  observedAt: string,
): boolean {
  const previousLiteral = observedValidity(previous);
  if (
    observedValidity(current) === previousLiteral &&
    (previous.conditions.effective_from === undefined ||
      current.conditions.effective_from !== undefined)
  )
    return true;
  if (previousLiteral === undefined || current.raw_validity?.includes(" – ") === true) return false;
  const before = parsePublishedBoundary(previousLiteral);
  const after = parsePublishedBoundary(current.conditions.effective_from);
  if (!before || !after) return false;
  if (before.precision === after.precision && before.value === after.value) return true;
  return (
    comparePublishedTimes(before, after) < 0 &&
    publishedValidityStatus({ from: after }, observedAt) === "current"
  );
}

/** Compare the exact accepted source observations before replacing an Azure partition. */
export function azureRetailPricingLoss(
  result: Pick<
    ProviderResult,
    "models" | "pricingReplaySources" | "azureRetailUnmatchedVersionMeters" | "coverage"
  >,
  snapshot: ProviderPricingSnapshot,
  prior: PricingReplaySource | undefined,
  catalogSource: SourceRecord | undefined,
): string | undefined {
  const previous =
    snapshot.source_records === undefined
      ? catalogSource
      : snapshot.source_records.find(({ id }) => id === azureRetailSourceId);
  if (previous === undefined) return;
  if (prior === undefined || prior.content_hash !== previous.content_hash)
    return "Azure Retail Prices cannot verify coverage without the accepted source observations.";
  const current = result.pricingReplaySources?.find(
    ({ source_id }) => source_id === azureRetailSourceId,
  );
  if (current === undefined) return "Azure Retail Prices source observations are missing.";

  // v9 observed the native validity and did not always express the Standard processing tier.
  const legacyTier = prior.extractor_version === "azure-retail-prices-v9";
  const legacyEmbedding = /^azure-retail-prices-v(?:9|10|11|12)$/.test(prior.extractor_version);
  const models = new Map(result.models.map((model) => [model.uid, model]));
  const comparable = new Map<string, SourcePriceFact[]>();
  for (const { uid, price_facts } of current.models) {
    if (!models.has(uid)) continue;
    for (const fact of price_facts) {
      const keys = [comparablePriceKey(uid, fact, legacyTier)];
      const { modality, ...conditions } = fact.conditions;
      if (
        legacyEmbedding &&
        /^azure\/cohere-embed-/i.test(uid) &&
        fact.source_locator?.kind === "meter" &&
        fact.meter === "embedding" &&
        (modality === "text" || modality === "image")
      ) {
        // Older extractors labeled these same native text/image token meters without modality.
        keys.push(
          comparablePriceKey(
            uid,
            {
              ...fact,
              meter: modality === "image" ? "image_generation" : "embedding",
              conditions,
            },
            legacyTier,
          ),
        );
      }
      for (const key of keys) {
        const siblings = comparable.get(key);
        if (siblings === undefined) comparable.set(key, [fact]);
        else siblings.push(fact);
      }
    }
  }
  const rejectedVersions = new Set(result.azureRetailUnmatchedVersionMeters);
  let missing = 0;
  const examples = new Set<string>();
  for (const { uid, price_facts } of prior.models) {
    const model = models.get(uid);
    if (model !== undefined && azureRetailModelRetired(model, result.coverage.checked_at)) continue;
    for (const fact of price_facts) {
      if (
        comparable
          .get(comparablePriceKey(uid, fact, legacyTier))
          ?.some((candidate) => supportsPriorValidity(fact, candidate, result.coverage.checked_at))
      )
        continue;
      const meterId = fact.source_locator?.kind === "meter" ? fact.source_locator.value : undefined;
      if (
        meterId !== undefined &&
        (legacyTier || prior.extractor_version === "azure-retail-prices-v10") &&
        rejectedVersions.has(azureRetailMeterKey(uid, meterId, fact.conditions.region))
      )
        continue;
      missing += 1;
      if (examples.size < 3)
        examples.add(
          `${uid} ${fact.meter} (${fact.conditions.region ?? "unscoped"}, meter ${meterId ?? "unknown"})`,
        );
    }
  }
  if (missing > 0)
    return `Azure Retail Prices lost ${missing} previously supported scoped quotes. Examples: ${[...examples].join(", ")}.`;
}

export function validateAzureRetailPublication(
  result: ProviderResult,
  snapshot: ProviderPricingSnapshot | undefined,
  previousInputs: PricingReplaySource | undefined,
  previousSource: SourceRecord | undefined,
): ProviderResult {
  if (result.provider.id !== "azure" || result.pricing === undefined || snapshot === undefined)
    return result;
  const reason = azureRetailPricingLoss(result, snapshot, previousInputs, previousSource);
  if (reason === undefined) return result;
  const { pricing: _pricing, ...core } = result;
  const failureCode = "pricing_validation_failed";
  return {
    ...core,
    sources: result.sources.map((source) =>
      source.id === azureRetailSourceId ? (previousSource ?? source) : source,
    ),
    warnings: [
      ...result.warnings,
      {
        code: "pricing_invalid",
        provider_id: "azure",
        source_id: azureRetailSourceId,
        message: reason,
      },
    ],
    pricingFailure: failureCode,
    attempt: {
      ...result.attempt,
      pricing: { outcome: "failed", failure_code: failureCode, message: reason },
    },
  };
}
