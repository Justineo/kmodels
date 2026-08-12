import { canonicalJson } from "./canonical-value.ts";
import { applicabilityContainedIn, unionApplicabilities } from "./pricing-canonical.ts";
import { evaluateModelApplicability, type PricingSelection } from "./pricing-presentation.ts";
import type {
  WebsitePriceApplicability,
  WebsitePriceDimension,
  WebsitePricingOffer,
} from "./website-schema.ts";

type WebsiteRateRow = WebsitePricingOffer["rates"][number];

export interface WebsiteProjectedRate {
  row: WebsiteRateRow;
  invariant_dimensions: WebsitePriceDimension[];
}

export interface WebsiteRateQuery {
  rates: WebsiteProjectedRate[];
  unresolved_dimensions: WebsitePriceDimension[];
}

export function projectWebsiteRateQuery(
  offer: WebsitePricingOffer,
  modelRef: string,
  selections: readonly PricingSelection[],
): WebsiteRateQuery {
  const rates: WebsiteProjectedRate[] = [];
  const unresolved = new Map<string, WebsitePriceDimension>();
  for (const group of groupsByTerm(offer.rates).values()) {
    const possible = group.filter(
      ({ applicability }) => evaluate(applicability, modelRef, selections).state !== "false",
    );
    if (possible.length === 0) continue;
    const exact = possible.filter(
      ({ applicability }) => evaluate(applicability, modelRef, selections).state === "true",
    );
    if (exact.length > 0) {
      for (const row of uniqueRateValues(exact)) rates.push({ row, invariant_dimensions: [] });
      continue;
    }
    const missing = missingDimensions(possible, modelRef, selections);
    if (isInvariantRate(offer, possible, modelRef, selections)) {
      rates.push({ row: possible[0]!, invariant_dimensions: missing });
      continue;
    }
    for (const dimension of missing) unresolved.set(canonicalJson(dimension), dimension);
  }
  return {
    rates,
    unresolved_dimensions: [...unresolved.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, dimension]) => dimension),
  };
}

function groupsByTerm(rows: readonly WebsiteRateRow[]): Map<string, WebsiteRateRow[]> {
  const groups = new Map<string, WebsiteRateRow[]>();
  for (const row of rows) {
    const group = groups.get(row.term_ref) ?? [];
    group.push(row);
    groups.set(row.term_ref, group);
  }
  return groups;
}

function uniqueRateValues(rows: WebsiteRateRow[]): WebsiteRateRow[] {
  const values = new Map<string, WebsiteRateRow>();
  for (const row of rows) values.set(rateValue(row), row);
  return [...values.values()];
}

function isInvariantRate(
  offer: WebsitePricingOffer,
  rows: WebsiteRateRow[],
  modelRef: string,
  selections: readonly PricingSelection[],
): boolean {
  if (new Set(rows.map(rateValue)).size !== 1) return false;
  const numericScopes = offer.states.flatMap((state) => {
    if (state.state !== "numeric") return [];
    const scope = remainingScope(state.applicability, modelRef, selections);
    return scope === undefined ? [] : [scope];
  });
  if (numericScopes.length === 0) return false;
  const rateScopes = rows.flatMap(({ applicability }) => {
    const scope = remainingScope(applicability, modelRef, selections);
    return scope === undefined ? [] : [scope];
  });
  if (rateScopes.length === 0) return false;
  try {
    const covered = unionApplicabilities(rateScopes);
    return numericScopes.every((scope) => applicabilityContainedIn(scope, covered));
  } catch {
    return false;
  }
}

function remainingScope(
  applicability: WebsitePriceApplicability,
  modelRef: string,
  selections: readonly PricingSelection[],
): WebsitePriceApplicability | undefined {
  const any_of = applicability.any_of.filter(
    (clause) => evaluate({ any_of: [clause] }, modelRef, selections).state !== "false",
  );
  return any_of.length === 0 ? undefined : { any_of };
}

function missingDimensions(
  rows: WebsiteRateRow[],
  modelRef: string,
  selections: readonly PricingSelection[],
): WebsitePriceDimension[] {
  const dimensions = new Map<string, WebsitePriceDimension>();
  for (const { applicability } of rows) {
    const result = evaluate(applicability, modelRef, selections);
    if (result.state !== "missing") continue;
    for (const dimension of result.missing_dimensions)
      dimensions.set(canonicalJson(dimension), dimension);
  }
  return [...dimensions.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, dimension]) => dimension);
}

function rateValue(row: WebsiteRateRow): string {
  return canonicalJson({
    amount: row.amount,
    unit: row.unit,
    accessible_text: row.accessible_text,
    ...(row.driver === undefined ? {} : { driver: row.driver }),
    ...(row.validity === undefined ? {} : { validity: row.validity }),
  });
}

function evaluate(
  applicability: WebsitePriceApplicability,
  modelRef: string,
  selections: readonly PricingSelection[],
) {
  return evaluateModelApplicability(applicability, modelRef, selections);
}
