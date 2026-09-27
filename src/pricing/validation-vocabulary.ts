import { canonicalJson } from "../catalog/canonical-value.ts";
import {
  canonicalizeApplicability,
  normalizeUnitExpression,
} from "../catalog/pricing-canonical.ts";
import { standardDimensionKind } from "../catalog/pricing-dimension-kind.ts";
import { standardUsageSignalUnit } from "../catalog/pricing-signal-unit.ts";
import { publishedValidityIsCoherent } from "../catalog/pricing-time.ts";
import {
  priceApplicabilitySchema,
  publishedValiditySchema,
  type PriceCategoricalValue,
  type PriceCondition,
  type PriceDimension,
  type UnitExpression,
  type UsageSignal,
} from "../catalog/pricing-schema.ts";
import type { CalculationProvider } from "./schema.ts";
import { PricingError } from "./errors.ts";

interface VocabularyContext {
  provider: CalculationProvider;
  sourceIds: Set<string>;
  dimensionShapes: Map<string, string>;
}

export function validateProviderProperties(provider: CalculationProvider): void {
  const context: VocabularyContext = {
    provider,
    sourceIds: new Set(provider.sources.map((source) => source.id)),
    dimensionShapes: new Map(),
  };
  const pendingValues: unknown[] = [provider.books, provider.vocabulary.atoms];
  while (pendingValues.length > 0) {
    const value = pendingValues.pop();
    if (Array.isArray(value)) {
      pendingValues.push(...value);
      continue;
    }
    if (typeof value !== "object" || value === null) continue;
    for (const [property, child] of Object.entries(value)) {
      validateProperty(property, child, context);
      pendingValues.push(child);
    }
  }
}

function validateProperty(property: string, value: unknown, context: VocabularyContext): void {
  switch (property) {
    case "source_ref":
      if (typeof value !== "string" || !context.sourceIds.has(value))
        throw new Error("Missing evidence source");
      return;
    case "source_refs":
      if (
        Array.isArray(value) &&
        value.some((ref: unknown) => typeof ref !== "string" || !context.sourceIds.has(ref))
      )
        throw new Error("Missing source reference");
      return;
    case "applicability":
    case "possible_scope":
      validateApplicability(value, context);
      return;
    case "validity": {
      const validity = publishedValiditySchema.parse(value);
      if (!publishedValidityIsCoherent(validity.from, validity.until))
        throw new Error("Incoherent validity");
      return;
    }
    case "dimension":
    case "meter":
    case "billing_mode":
    case "aggregation":
    case "resource_kind":
      validateAtom(value, property, context.provider);
      return;
    case "signal":
      validateAtom(value, "usage_signal", context.provider);
      return;
    case "unit":
      if (typeof value === "object" && value !== null && "namespace" in value)
        validateAtom(value, "unit", context.provider);
      return;
    case "reset":
      validateAtom(value, "allowance_reset", context.provider);
      return;
    case "denomination":
      validateCreditDenomination(value, context.provider);
  }
}

function validateApplicability(value: unknown, context: VocabularyContext): void {
  const scope = priceApplicabilitySchema.parse(value);
  if (canonicalJson(canonicalizeApplicability(scope)) !== canonicalJson(scope))
    throw new Error("Noncanonical applicability");
  for (const clause of scope.any_of) {
    for (const condition of clause.all_of) {
      validateCondition(condition, context.provider);
      const dimensionKey = canonicalJson(condition.dimension);
      const dimensionShape = canonicalJson([
        condition.kind,
        condition.kind === "decimal_range" ? condition.unit : null,
      ]);
      const previousShape = context.dimensionShapes.get(dimensionKey);
      if (previousShape !== undefined && previousShape !== dimensionShape)
        throw new Error("Dimension changes kind or unit");
      context.dimensionShapes.set(dimensionKey, dimensionShape);
    }
  }
}

export function validateCondition(condition: PriceCondition, provider: CalculationProvider): void {
  const dimension = condition.dimension;
  validateAtom(dimension, "dimension", provider);
  if (dimension.namespace === "kmodels") validateStandardCondition(condition, dimension.value);
  if (condition.kind === "decimal_range") unitKey(condition.unit);
  if (condition.kind === "categorical") {
    for (const value of condition.values) validateCategoricalValue(value, dimension, provider);
  }
}

function validateStandardCondition(
  condition: PriceCondition,
  dimension: Extract<PriceDimension, { namespace: "kmodels" }>["value"],
): void {
  if (condition.kind !== standardDimensionKind(dimension))
    throw new Error("Invalid standard dimension kind");
  if (condition.kind !== "decimal_range") return;
  const expectedUnit: UnitExpression = {
    factors: [
      {
        unit: { namespace: "kmodels", value: dimension.endsWith("_tokens") ? "token" : "second" },
        power: 1,
      },
    ],
  };
  if (unitKey(condition.unit) !== unitKey(expectedUnit))
    throw new Error("Invalid standard dimension unit");
}

function validateCategoricalValue(
  value: PriceCategoricalValue,
  dimension: PriceDimension,
  provider: CalculationProvider,
): void {
  if (dimension.namespace === "kmodels" && dimension.value === "model") {
    if (
      value.namespace !== "kmodels" ||
      !provider.models.some((model) => model.model_ref === value.value)
    )
      throw new Error("Missing model selector reference");
    return;
  }
  if (value.namespace !== "provider" || value.provider_id !== provider.snapshot.provider_id)
    throw new Error("Unregistered categorical value");
  const registered = provider.vocabulary.atoms.some(
    (atom) =>
      atom.kind === "categorical_value" &&
      atom.key === value.value &&
      canonicalJson(atom.dimension) === canonicalJson(dimension),
  );
  if (!registered) throw new Error("Unregistered categorical value");
}

function validateAtom(value: unknown, kind: string, provider: CalculationProvider): void {
  if (
    typeof value !== "object" ||
    value === null ||
    !("namespace" in value) ||
    value.namespace !== "provider"
  )
    return;
  const belongsToProvider =
    "provider_id" in value && value.provider_id === provider.snapshot.provider_id;
  const registered =
    "value" in value &&
    provider.vocabulary.atoms.some((atom) => atom.kind === kind && atom.key === value.value);
  if (!belongsToProvider || !registered) throw new Error(`Unregistered ${kind}`);
}

function validateCreditDenomination(value: unknown, provider: CalculationProvider): void {
  if (
    typeof value !== "object" ||
    value === null ||
    !("kind" in value) ||
    value.kind !== "provider_credit"
  )
    return;
  const belongsToProvider =
    "provider_id" in value && value.provider_id === provider.snapshot.provider_id;
  const registered =
    "code" in value &&
    provider.vocabulary.atoms.some(
      (atom) => atom.kind === "credit_denomination" && atom.key === value.code,
    );
  if (!belongsToProvider || !registered) throw new Error("Unregistered credit denomination");
}

export function signalUnit(signal: UsageSignal, provider: CalculationProvider): UnitExpression {
  if (signal.namespace === "kmodels") return standardUsageSignalUnit(signal);
  if (signal.provider_id !== provider.snapshot.provider_id)
    throw new PricingError("INCOMPATIBLE_QUANTITY", "Usage signal belongs to another provider");
  const atom = provider.vocabulary.atoms.find(
    (atom) => atom.kind === "usage_signal" && atom.key === signal.value,
  );
  if (atom?.kind !== "usage_signal")
    throw new PricingError("INCOMPATIBLE_QUANTITY", "Unregistered usage signal");
  return atom.unit;
}

export function unitKey(unit: UnitExpression): string {
  if (canonicalJson(normalizeUnitExpression(unit)) !== canonicalJson(unit))
    throw new Error("Noncanonical unit");
  return canonicalJson(unit);
}
