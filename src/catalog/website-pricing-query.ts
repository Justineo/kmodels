import { canonicalJson } from "./canonical-value.ts";
import {
  applicabilityContainedIn,
  unconditionalApplicability,
  unionApplicabilities,
} from "./pricing-canonical.ts";
import {
  evaluateApplicability,
  evaluateModelApplicability,
  type PricingSelection,
} from "./pricing-applicability.ts";
import { publishedValidityStatus } from "./pricing-time.ts";
import type {
  WebsitePriceApplicability,
  WebsitePriceDimension,
  WebsitePricingOffer,
  WebsitePricingSelector,
} from "./website-schema.ts";

type WebsiteRateRow = WebsitePricingOffer["rates"][number];
type TimedRow = Pick<WebsitePricingOffer["states"][number], "validity">;

interface WebsitePricingTimeline {
  current: WebsitePricingOffer;
  next_change_at: string | undefined;
  upcoming: { effective_at: string; offer: WebsitePricingOffer } | undefined;
}

export interface WebsiteProjectedRate {
  row: WebsiteRateRow;
  invariant_dimensions: WebsitePriceDimension[];
}

export interface WebsiteRateQuery {
  rates: WebsiteProjectedRate[];
  unresolved_dimensions: WebsitePriceDimension[];
}

export interface ServiceRule {
  operation?: Extract<WebsitePricingSelector, { kind: "categorical" }>["values"][number];
  state: WebsitePricingOffer["states"][number];
  rates: { row: WebsiteRateRow; currency?: string }[];
  allowances: WebsitePricingOffer["allowances"];
}

/** A service can publish a flat price, currency quotes, or a small set of operation tariffs. */
export function projectServiceRules(
  offer: WebsitePricingOffer,
  selectors: readonly WebsitePricingSelector[],
  modelRef: string | undefined,
  fixed: readonly PricingSelection[],
  instant: string,
): ServiceRule[] | undefined {
  function dimension(name: "operation" | "billing_currency") {
    const matches = (s: WebsitePricingSelector) =>
      s.dimension.namespace === "kmodels" && s.dimension.value === name;
    return (
      selectors.find(matches) ??
      offer.selectors.find((s) => matches(s) && s.kind === "categorical" && s.values.length === 1)
    );
  }
  const operation = dimension("operation");
  const currency = dimension("billing_currency");
  if (
    (operation && (operation.kind !== "categorical" || operation.values.length > 4)) ||
    (currency && (currency.kind !== "categorical" || currency.values.length > 3)) ||
    selectors.some((s) => s !== operation && s !== currency) ||
    offer.unnormalized_count ||
    offer.contributions.length ||
    [...offer.states, ...offer.rates, ...offer.allowances].some(
      (row) => row.validity && publishedValidityStatus(row.validity, instant) === "unresolved",
    )
  )
    return;

  const rules: ServiceRule[] = [];
  const usedAllowances = new Set<string>();
  const match = (
    row: { applicability: WebsitePriceApplicability },
    selections: readonly PricingSelection[],
  ) => evaluate(row.applicability, modelRef, selections).state;
  for (const option of operation?.values ?? [undefined]) {
    if (option?.schedule) return;
    const context =
      operation && option
        ? [
            ...fixed,
            { kind: "categorical" as const, dimension: operation.dimension, value: option.value },
          ]
        : fixed;
    const states = offer.states.filter((row) => match(row, context) !== "false");
    const state = states[0];
    if (states.length !== 1 || !state) return;
    const metered = state.state === "numeric";
    const allowances = offer.allowances.filter((row) => match(row, context) !== "false");
    if (!metered && (allowances.length || match(state, context) !== "true")) return;
    if (allowances.some((row) => match(row, context) !== "true" || usedAllowances.has(row.key)))
      return;
    for (const row of allowances) usedAllowances.add(row.key);
    const rates: ServiceRule["rates"] = [];
    for (const denomination of currency?.values ?? [undefined]) {
      const selections =
        currency && denomination
          ? [
              ...context,
              {
                kind: "categorical" as const,
                dimension: currency.dimension,
                value: denomination.value,
              },
            ]
          : context;
      const possible = offer.rates.filter((row) => match(row, selections) !== "false");
      if (match(state, selections) !== "true" || possible.length !== (metered ? 1 : 0)) return;
      const row = possible[0];
      if (!row) continue;
      if (match(row, selections) !== "true") return;
      if (denomination && (currency?.values.length === 1 || match(row, context) !== "true"))
        rates.push({ row, currency: denomination.label });
      else if (!rates.some((rate) => rate.row === row)) rates.push({ row });
    }
    rules.push({ ...(option ? { operation: option } : {}), state, rates, allowances });
  }
  if (
    rules.length > 1 &&
    rules.every((rule) => rule.state.state === "numeric" && !rule.allowances.length)
  ) {
    const invariant = projectWebsiteRateQuery(offer, modelRef, fixed);
    const rate = invariant.rates[0];
    const first = rules[0];
    if (!invariant.unresolved_dimensions.length && invariant.rates.length === 1 && rate && first)
      return [{ state: first.state, rates: [{ row: rate.row }], allowances: [] }];
  }
  return rules;
}

export function projectWebsiteRateQuery(
  offer: WebsitePricingOffer,
  modelRef: string | undefined,
  selections: readonly PricingSelection[],
): WebsiteRateQuery {
  const rates: WebsiteProjectedRate[] = [];
  const unresolved = new Map<string, WebsitePriceDimension>();
  const states = offer.states.filter(
    ({ applicability }) => evaluate(applicability, modelRef, selections).state !== "false",
  );
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
    if (isInvariantRate(states, possible, modelRef, selections)) {
      rates.push({ row: possible[0]!, invariant_dimensions: missing });
      continue;
    }
    for (const dimension of missing) unresolved.set(canonicalJson(dimension), dimension);
  }
  if (new Set(states.map(({ state }) => state)).size > 1)
    for (const dimension of missingDimensions(states, modelRef, selections))
      unresolved.set(canonicalJson(dimension), dimension);
  return {
    rates,
    unresolved_dimensions: [...unresolved.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, dimension]) => dimension),
  };
}

export function projectWebsitePricingNotes(
  offer: WebsitePricingOffer,
): WebsitePricingOffer["unnormalized"] {
  const groups = new Map<string, WebsitePricingOffer["unnormalized"]>();
  for (const row of offer.unnormalized) {
    const { key: _key, possible_scope, ...content } = row;
    const key = canonicalJson({ ...content, scoped: possible_scope !== undefined });
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const notes = [...groups.values()].flatMap((rows) => {
    const first = rows[0];
    if (first === undefined) return [];
    if (first.possible_scope === undefined) return [first];
    try {
      const scope = unionApplicabilities(
        rows.flatMap(({ possible_scope }) => possible_scope ?? []),
      );
      const coversOffer =
        offer.states.length > 0 &&
        offer.states.every(({ applicability }) => applicabilityContainedIn(applicability, scope));
      return [{ ...first, possible_scope: coversOffer ? unconditionalApplicability : scope }];
    } catch {
      return rows;
    }
  });
  return notes.map((note) => ({
    ...note,
    label: note.label === "Unpublished cache read" ? "Cache read" : note.label,
    ...(note.details === undefined
      ? {}
      : { details: note.details.map((detail) => detail.replace(/\\+\$(?=\d)/g, "$")) }),
  }));
}

export function projectWebsitePricingTimeline(
  offer: WebsitePricingOffer,
  currentInstant: string,
): WebsitePricingTimeline {
  const current = projectOffer(offer, (row) => isVisibleAt(row, currentInstant));
  const effectiveAt = nextEffectiveAt(offer, currentInstant);
  return {
    current,
    next_change_at: nextChangeAt(offer, currentInstant),
    upcoming:
      effectiveAt === undefined
        ? undefined
        : {
            effective_at: effectiveAt,
            offer: projectOffer(
              offer,
              (row) =>
                isVisibleAt(row, effectiveAt) ||
                (row.validity?.from?.precision === "datetime" &&
                  row.validity.from.value === effectiveAt),
            ),
          },
  };
}

function isVisibleAt(row: TimedRow, instant: string): boolean {
  const status = publishedValidityStatus(row.validity, instant);
  return status === "current" || status === "unresolved";
}

function nextChangeAt(offer: WebsitePricingOffer, currentInstant: string): string | undefined {
  const currentTime = Date.parse(currentInstant);
  return [...timedRows(offer), ...(offer.mechanism_links ?? [])]
    .flatMap(({ validity }) => [validity?.from, validity?.until])
    .flatMap((boundary) =>
      boundary?.precision === "datetime" && Date.parse(boundary.value) > currentTime
        ? [boundary.value]
        : [],
    )
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0];
}

function timedRows(offer: WebsitePricingOffer): TimedRow[] {
  return [
    ...offer.states,
    ...offer.rates,
    ...offer.allowances,
    ...offer.contributions,
    ...offer.enrollment,
    ...offer.settlement,
    ...offer.unnormalized,
  ];
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
  states: WebsitePricingOffer["states"],
  rows: WebsiteRateRow[],
  modelRef: string | undefined,
  selections: readonly PricingSelection[],
): boolean {
  if (
    !states.length ||
    states.some(({ state }) => state !== "numeric") ||
    new Set(rows.map(rateValue)).size !== 1
  )
    return false;
  // Both sets contain only possible rows. Keep the surviving clauses of each row.
  const remainingScope = ({ applicability }: Pick<WebsiteRateRow, "applicability">) => ({
    any_of: applicability.any_of.filter(
      (clause) => evaluate({ any_of: [clause] }, modelRef, selections).state !== "false",
    ),
  });
  const numericScopes = states.map(remainingScope);
  const rateScopes = rows.map(remainingScope);
  try {
    const covered = unionApplicabilities(rateScopes);
    return numericScopes.every((scope) => applicabilityContainedIn(scope, covered));
  } catch {
    return false;
  }
}

function missingDimensions(
  rows: Array<Pick<WebsiteRateRow, "applicability">>,
  modelRef: string | undefined,
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
  modelRef: string | undefined,
  selections: readonly PricingSelection[],
) {
  return modelRef === undefined
    ? evaluateApplicability(applicability, selections)
    : evaluateModelApplicability(applicability, modelRef, selections);
}

function nextEffectiveAt(offer: WebsitePricingOffer, currentInstant: string): string | undefined {
  const boundaries = timedRows(offer).flatMap(({ validity }) => {
    const from = validity?.from;
    return from?.precision === "datetime" &&
      publishedValidityStatus(validity, currentInstant) === "upcoming"
      ? [from.value]
      : [];
  });
  return [...new Set(boundaries)].sort((left, right) => Date.parse(left) - Date.parse(right))[0];
}

function projectOffer(
  offer: WebsitePricingOffer,
  include: (row: TimedRow) => boolean,
): WebsitePricingOffer {
  const states = offer.states.filter(include);
  return {
    ...offer,
    state_summary: offer.state_summary === "Incomplete" ? "Incomplete" : stateSummary(states),
    states,
    rates: offer.rates.filter(include),
    allowances: offer.allowances.filter(include),
    contributions: offer.contributions.filter(include),
    enrollment: offer.enrollment.filter(include),
    settlement: offer.settlement.filter(include),
    unnormalized: offer.unnormalized.filter(include),
  };
}

function stateSummary(states: WebsitePricingOffer["states"]): string {
  const labels = [...new Set(states.map(({ label }) => label))];
  if (labels.length === 0) return "No matching state";
  return labels.length === 1 ? labels[0]! : `${labels.length} pricing states`;
}
