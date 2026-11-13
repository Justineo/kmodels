import { canonicalJson, canonicalJsonKey } from "../catalog/canonical-value.ts";
import type { PricingSelection } from "../catalog/pricing-applicability.ts";
import { publishedValidityStatus } from "../catalog/pricing-time.ts";
import type {
  PriceApplicability,
  PriceCondition,
  PriceDimension,
  PublishedValidity,
} from "../catalog/pricing-schema.ts";
import { PricingError } from "./errors.ts";

const nonPricingFields = new Set(["evidence", "applicability", "validity", "selector_sources"]);

export interface Qualified {
  applicability: PriceApplicability;
  validity?: PublishedValidity | undefined;
}

export type GapCode =
  | "missing_selector"
  | "unsupported_structure"
  | "conflicting_variants"
  | "unresolved_validity"
  | "historical_evidence_missing"
  | "unknown_price"
  | "outside_validity";

export interface Gap {
  code: GapCode;
  offerRef: string;
  termRef?: string;
  dimensions?: PriceDimension[];
  reason?: string;
}

export function validateSelectors(
  selectors: readonly PricingSelection[],
  scopes: readonly PriceApplicability[],
): void {
  if (selectors.length === 0) return;
  const suppliedDimensions = new Set<string>();
  const conditions = new Map<string, PriceCondition[]>();
  for (const scope of scopes) {
    for (const clause of scope.any_of) {
      for (const condition of clause.all_of) {
        const key = canonicalJsonKey(condition.dimension);
        const group = conditions.get(key);
        if (group === undefined) conditions.set(key, [condition]);
        else group.push(condition);
      }
    }
  }
  for (const selector of selectors) {
    const dimensionKey = canonicalJson(selector.dimension);
    if (suppliedDimensions.has(dimensionKey)) {
      throw new PricingError("DUPLICATE_SELECTOR", "Selectors repeat a dimension");
    }
    suppliedDimensions.add(dimensionKey);
    let unit: string | undefined;
    for (const condition of conditions.get(dimensionKey) ?? []) {
      const matches =
        condition.kind === "decimal_range"
          ? (selector.kind === "decimal" || selector.kind === "decimal_range") &&
            canonicalJsonKey(condition.unit) === (unit ??= canonicalJson(selector.unit))
          : selector.kind === condition.kind;
      if (!matches) {
        throw new PricingError(
          "INVALID_REQUEST",
          "Selector kind or unit conflicts with its dimension",
        );
      }
    }
  }
}

export function validityGap(
  variant: Qualified,
  evaluatedAt: string,
  observedAt: string,
): GapCode | undefined {
  const status = publishedValidityStatus(variant.validity, evaluatedAt);
  if (status === "expired" || status === "upcoming") return "outside_validity";
  if (status === "unresolved") return "unresolved_validity";
  const observationStatus = publishedValidityStatus(
    { from: { value: observedAt, precision: "datetime" } },
    evaluatedAt,
  );
  if (observationStatus === "upcoming" && variant.validity?.from?.precision !== "datetime")
    return "historical_evidence_missing";
  return undefined;
}

export function pricingSemantics(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(pricingSemantics);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !nonPricingFields.has(key))
      .map(([key, child]) => [key, pricingSemantics(child)]),
  );
}
