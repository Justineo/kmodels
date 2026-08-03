import { canonicalJsonKey, compareUtf8 } from "./canonical-value.ts";
import { formatSentenceCase } from "./presentation.ts";
import { scaleDecimal } from "./pricing.ts";
import {
  applicabilitiesOverlap,
  applicabilityContainedIn,
  unionApplicabilities,
} from "./pricing-canonical.ts";
import { assertPricingDecimal } from "./pricing-constants.ts";
import {
  compareRationals,
  multiplyRationals,
  rationalToFiniteDecimal,
  rationalFromDecimal,
} from "./pricing-rational.ts";
import type {
  BillingMode,
  BillingUnit,
  PriceAllowanceBenefit,
  PriceApplicability,
  PriceCategoricalValue,
  PriceCondition,
  PriceDenomination,
  PriceDimension,
  PriceMeter,
  PriceRateTerm,
  PricingBook,
  PricingCatalog,
  PricingOffer,
  NormalizedPriceObservation,
  ProviderPricingSnapshot,
  Rational,
  RawPricingVariant,
  StandardPriceMeter,
  UnitExpression,
  UnitPrice,
} from "./pricing-schema.ts";
import type { ProviderModel } from "./schema.ts";

type PricingModel = Pick<ProviderModel, "provider_id" | "tasks" | "uid">;

type ApplicabilityResult =
  | { state: "true" | "false"; missing_dimensions: [] }
  | { state: "missing"; missing_dimensions: PriceDimension[] };

export type PricingSelection =
  | {
      dimension: PriceDimension;
      kind: "categorical";
      value: PriceCategoricalValue;
    }
  | {
      dimension: PriceDimension;
      kind: "boolean";
      value: boolean;
    }
  | {
      dimension: PriceDimension;
      kind: "decimal";
      value: string;
      unit: UnitExpression;
    }
  | Extract<PriceCondition, { kind: "decimal_range" }>;

export interface ModelPricingView {
  outcome: "not_applicable" | "unknown" | "offers";
  books: PricingBook[];
  baseOffers: PricingOffer[];
  addOns: PricingOffer[];
  snapshot?: ProviderPricingSnapshot;
}

interface PricingViewIndex {
  snapshots: ReadonlyMap<string, ProviderPricingSnapshot>;
  dispositions: ReadonlySet<string>;
  books: ReadonlyMap<string, PricingBook[]>;
}

interface PricingTableCell {
  meter: string;
  amount: string;
  displayUnit: string;
  accessibleText: string;
  showTooltip: boolean;
}

const inputMeters = ["input_text", "input_image", "input_audio", "input_video"] as const;
const cacheMeters = [
  "cache_read_text",
  "cache_read_image",
  "cache_read_audio",
  "cache_read_video",
  "cache_write_text",
  "cache_write_image",
  "cache_write_audio",
  "cache_write_video",
  "cache_storage",
] as const;
const outputMeters = [
  "output_text",
  "output_image",
  "output_audio",
  "output_video",
  "image_generation",
  "video_generation",
  "embedding",
  "rerank_request",
  "tool_call",
  "realtime_client_message",
  "realtime_session_duration",
  "batch_inference",
  "gpu_hour",
  "provisioned_throughput",
] as const;
const modelDimension: PriceDimension = { namespace: "kmodels", value: "model" };
const wholeNumberDimensions = new Set([
  "cache_ttl_seconds",
  "context_tokens",
  "input_tokens",
  "output_tokens",
]);

export function evaluateApplicability(
  applicability: PriceApplicability,
  selections: readonly PricingSelection[],
): ApplicabilityResult {
  const context = selectionMap(selections);
  const missing = new Map<string, PriceDimension>();
  let hasMissingClause = false;
  for (const clause of applicability.any_of) {
    let clauseMissing = false;
    let clauseFalse = false;
    const clauseDimensions: PriceDimension[] = [];
    for (const condition of clause.all_of) {
      const result = evaluateCondition(condition, context);
      if (result === "false") {
        clauseFalse = true;
        break;
      }
      if (result === "missing") {
        clauseMissing = true;
        clauseDimensions.push(condition.dimension);
      }
    }
    if (clauseFalse) continue;
    if (!clauseMissing) return { state: "true", missing_dimensions: [] };
    hasMissingClause = true;
    for (const dimension of clauseDimensions) missing.set(dimensionKey(dimension), dimension);
  }
  if (!hasMissingClause) return { state: "false", missing_dimensions: [] };
  return {
    state: "missing",
    missing_dimensions: [...missing.values()].sort((left, right) =>
      compareUtf8(dimensionKey(left), dimensionKey(right)),
    ),
  };
}

export function evaluateModelApplicability(
  applicability: PriceApplicability,
  modelRef: string,
  selections: readonly PricingSelection[] = [],
): ApplicabilityResult {
  return evaluateApplicability(applicability, withModelSelection(selections, modelRef));
}

export function modelPricingView(
  data: PricingCatalog,
  model: PricingModel,
  selections: readonly PricingSelection[] = [],
): ModelPricingView {
  return modelPricingViewFromIndex(pricingViewIndex(data), model, selections);
}

export function pricingViewIndex(data: PricingCatalog): PricingViewIndex {
  const books = new Map<string, PricingBook[]>();
  for (const book of data.books)
    for (const modelRef of book.scope.model_refs) {
      const current = books.get(modelRef);
      if (current === undefined) books.set(modelRef, [book]);
      else current.push(book);
    }
  return {
    snapshots: new Map(data.provider_snapshots.map((snapshot) => [snapshot.provider_id, snapshot])),
    dispositions: new Set(data.model_dispositions.map(({ model_ref }) => model_ref)),
    books,
  };
}

export function modelPricingViewFromIndex(
  index: PricingViewIndex,
  model: PricingModel,
  selections: readonly PricingSelection[] = [],
): ModelPricingView {
  const snapshot = index.snapshots.get(model.provider_id);
  const metadata = snapshot === undefined ? {} : { snapshot };
  if (index.dispositions.has(model.uid))
    return { outcome: "not_applicable", books: [], baseOffers: [], addOns: [], ...metadata };

  const books = (index.books.get(model.uid) ?? []).filter(
    ({ provider_id }) => provider_id === model.provider_id,
  );
  if (books.length === 0)
    return { outcome: "unknown", books: [], baseOffers: [], addOns: [], ...metadata };

  const context = withModelSelection(selections, model.uid);
  const offers = books.flatMap(({ offers }) => offers);
  const baseOffers = uniqueOffers(
    offers.filter((offer) => offer.role === "base" && offerCanApplyToModel(offer, context)),
  );
  const addOns = uniqueOffers(offers.filter(({ role }) => role === "add_on"));
  return { outcome: "offers", books, baseOffers, addOns, ...metadata };
}

export function projectPricingTableCell(
  data: PricingCatalog,
  model: PricingModel,
  slot: "input" | "cache" | "output",
): PricingTableCell | undefined {
  return projectPricingTableCellFromView(modelPricingView(data, model), model, slot);
}

export function projectPricingTableCellFromView(
  view: ModelPricingView,
  model: PricingModel,
  slot: "input" | "cache" | "output",
): PricingTableCell | undefined {
  if (view.outcome !== "offers" || view.baseOffers.length !== 1) return undefined;
  const offer = view.baseOffers[0]!;
  const context = withModelSelection(fixedOfferStateSelections(offer, model.uid), model.uid);
  const states = offer.states.filter(
    ({ applicability }) => evaluateApplicability(applicability, context).state !== "false",
  );
  if (
    states.length !== 1 ||
    states[0]?.state !== "numeric" ||
    states[0].validity !== undefined ||
    evaluateApplicability(states[0].applicability, context).state === "false"
  )
    return undefined;
  const numericScope = states[0].applicability;
  if (
    offerRawVariants(offer).some(
      (variant) =>
        variant.impact === "base_price" &&
        (variant.possible_scope === undefined ||
          evaluateApplicability(variant.possible_scope, context).state !== "false"),
    )
  )
    return undefined;

  const meters = slotMeters(model, slot);
  const rateTerms = offer.terms.filter(isRateTerm);
  for (const meter of meters) {
    const selectedTerms = rateTerms
      .filter(
        (term) =>
          term.meter.namespace === "kmodels" &&
          term.meter.value === meter &&
          term.variants.some(
            ({ applicability }) => evaluateApplicability(applicability, context).state !== "false",
          ),
      )
      .map((term) => ({
        term,
        variants: term.variants.filter(
          ({ applicability }) => evaluateApplicability(applicability, context).state !== "false",
        ),
      }));
    if (selectedTerms.length === 0) continue;
    if (selectedTerms.length !== 1) return undefined;
    const selected = selectedTerms[0]!.variants;
    if (
      selected.length === 0 ||
      selected.some(
        (variant) =>
          variant.validity !== undefined ||
          variant.price.denomination.kind !== "fiat" ||
          variant.price.per.factors.length === 0,
      )
    )
      return undefined;
    const prices = new Map(selected.map(({ price }) => [canonicalJsonKey(price), price]));
    if (prices.size !== 1) return undefined;
    try {
      const coveredScope = unionApplicabilities(selected.map(({ applicability }) => applicability));
      if (!applicabilityContainedIn(numericScope, coveredScope)) return undefined;
    } catch {
      return undefined;
    }
    return tableCell(
      { namespace: "kmodels", value: meter },
      [...prices.values()][0]!,
      selected.flatMap(({ observations }) => observations),
    );
  }
  return undefined;
}

export function offerConditions(offer: PricingOffer): PriceCondition[] {
  return [
    ...offer.states.map(({ applicability }) => applicability),
    ...offer.terms.flatMap((term) =>
      term.kind === "raw"
        ? term.variants.flatMap(({ possible_scope }) =>
            possible_scope === undefined ? [] : [possible_scope],
          )
        : [
            ...term.variants.map(({ applicability }) => applicability),
            ...term.raw_variants.flatMap(({ possible_scope }) =>
              possible_scope === undefined ? [] : [possible_scope],
            ),
          ],
    ),
  ].flatMap(({ any_of }) => any_of.flatMap(({ all_of }) => all_of));
}

export function fixedOfferStateSelections(
  offer: PricingOffer,
  modelRef: string,
): PricingSelection[] {
  const modelContext = withModelSelection([], modelRef);
  const clauses = offer.states
    .flatMap(({ applicability }) => applicability.any_of)
    .filter(
      (clause) => evaluateApplicability({ any_of: [clause] }, modelContext).state !== "false",
    );
  const dimensions = new Map<string, PriceDimension>();
  for (const condition of clauses.flatMap(({ all_of }) => all_of)) {
    if (!isModelDimension(condition.dimension))
      dimensions.set(dimensionKey(condition.dimension), condition.dimension);
  }
  return [...dimensions.entries()]
    .sort(([left], [right]) => compareUtf8(left, right))
    .flatMap(([key, dimension]) => {
      const values = new Map<string, PriceCategoricalValue>();
      for (const clause of clauses) {
        const conditions = clause.all_of.filter(
          (condition) => dimensionKey(condition.dimension) === key,
        );
        const condition = conditions[0];
        if (
          conditions.length !== 1 ||
          condition?.kind !== "categorical" ||
          condition.values.length !== 1
        )
          return [];
        const value = condition.values[0]!;
        values.set(canonicalJsonKey(value), value);
      }
      if (values.size !== 1) return [];
      return [
        {
          dimension,
          kind: "categorical" as const,
          value: [...values.values()][0]!,
        },
      ];
    });
}

function formatRational(value: Rational): { text: string; approximate: boolean } {
  const exact = rationalToFiniteDecimal(value);
  return exact === undefined
    ? { text: approximateDecimal(value), approximate: true }
    : { text: exact, approximate: false };
}

function approximateDecimal(value: Rational): string {
  const denominator = BigInt(value.denominator);
  const numerator = BigInt(value.numerator);
  const whole = numerator / denominator;
  let remainder = numerator % denominator;
  let fraction = "";
  for (let index = 0; index < 12 && remainder !== 0n; index += 1) {
    remainder *= 10n;
    fraction += String(remainder / denominator);
    remainder %= denominator;
  }
  return fraction === "" ? String(whole) : `${whole}.${fraction}`;
}

export function formatDenomination(value: PriceDenomination): string {
  return value.kind === "fiat"
    ? value.currency
    : formatProviderValue("provider-credit", value.provider_id, value.code);
}

export function formatBillingMode(value: BillingMode): string {
  return value.namespace === "kmodels"
    ? value.value
    : formatProviderValue("provider-billing-mode", value.provider_id, value.value);
}

export function formatMeter(value: PriceMeter): string {
  return value.namespace === "kmodels"
    ? value.value
    : formatProviderValue("provider-meter", value.provider_id, value.value);
}

function formatBillingUnit(value: BillingUnit): string {
  return value.namespace === "kmodels"
    ? value.value
    : formatProviderValue("provider-unit", value.provider_id, value.value);
}

export function formatUnitExpression(value: UnitExpression): string {
  if (value.factors.length === 0) return "dimensionless";
  return value.factors
    .map(({ unit, power }) => `${formatBillingUnit(unit)}${power === 1 ? "" : `^${power}`}`)
    .join("*");
}

function displayUnitExpression(value: UnitExpression): string {
  if (value.factors.length === 0) return "dimensionless";
  return value.factors
    .map(({ unit, power }) => {
      const label = unit.namespace === "kmodels" ? unit.value : displayProviderUnit(unit.value);
      return `${label}${power === 1 ? "" : `^${power}`}`;
    })
    .join("*");
}

function displayProviderUnit(value: string): string {
  switch (value) {
    case "1k_tpm_hour":
      return "1K TPM·hr";
    case "search_unit":
      return "search unit";
    case "unit_hour":
      return "unit·hr";
    case "unit_month":
      return "unit·mo";
    default:
      return value.replaceAll("_", " ");
  }
}

interface DisplayUnit {
  scale: Rational;
  display: string;
  accessible: string;
}

interface DisplayValue {
  amount: string;
  unit: DisplayUnit;
  approximate: boolean;
}

const unitScale = (value: string): Rational => ({ numerator: value, denominator: "1" });

function displayUnits(value: UnitExpression): DisplayUnit[] {
  const base = {
    scale: unitScale("1"),
    display: displayUnitExpression(value),
    accessible: formatUnitExpression(value),
  };
  const scaled = (scale: string, display: string): DisplayUnit => ({
    scale: unitScale(scale),
    display,
    accessible: display,
  });
  const single = value.factors.length === 1 ? value.factors[0] : undefined;
  if (single?.power === 1 && single.unit.namespace === "kmodels") {
    switch (single.unit.value) {
      case "token": {
        const million = scaled("1000000", "1M tokens");
        return [million, base, scaled("1000", "1K tokens")];
      }
      case "character":
        return [base, scaled("1000", "1K characters"), scaled("1000000", "1M characters")];
      case "request":
        return [base, scaled("1000", "1K requests")];
      case "page":
        return [base, scaled("1000", "1K pages")];
      case "second":
        return [base, scaled("60", "minute"), scaled("3600", "hour")];
    }
  }
  if (standardUnitProduct(value, "second", "token"))
    return [base, scaled("3600000000", "1M tokens·hour")];
  if (standardUnitProduct(value, "gpu", "second")) return [base, scaled("3600", "GPU·hour")];
  if (
    single?.power === 1 &&
    single.unit.namespace === "provider" &&
    single.unit.value === "search_unit"
  )
    return [base, scaled("1000", "1K search units")];
  return [base];
}

function standardUnitProduct(value: UnitExpression, ...units: string[]): boolean {
  if (value.factors.length !== units.length) return false;
  const actual = value.factors.flatMap(({ unit, power }) =>
    power === 1 && unit.namespace === "kmodels" ? [unit.value] : [],
  );
  return (
    actual.length === units.length && actual.sort().join("\0") === [...units].sort().join("\0")
  );
}

function sourceDisplay(
  price: UnitPrice,
  observations: readonly NormalizedPriceObservation[],
  units: readonly DisplayUnit[],
): DisplayValue | undefined {
  if (observations.length === 0) return undefined;
  const candidates = new Map<string, DisplayValue>();
  for (const { raw } of observations) {
    if (
      raw.amount === undefined ||
      raw.denomination === undefined ||
      raw.unit === undefined ||
      raw.formula !== undefined ||
      !denominationMatches(price.denomination, raw.denomination)
    )
      return undefined;
    let amount: Rational;
    try {
      amount = rationalFromDecimal(raw.amount);
    } catch {
      return undefined;
    }
    const matching = units.filter(({ scale }) => {
      try {
        return compareRationals(multiplyRationals(price.value, scale), amount) === 0;
      } catch {
        return false;
      }
    });
    const unit = matching[0];
    if (matching.length !== 1 || unit === undefined) return undefined;
    const display = { amount: scaleDecimal(raw.amount, 0), unit, approximate: false };
    candidates.set(`${display.amount}\0${display.unit.display}`, display);
  }
  return candidates.size === 1 ? [...candidates.values()][0] : undefined;
}

function denominationMatches(value: PriceDenomination, source: string): boolean {
  return value.kind === "fiat" ? value.currency === source : value.code === source;
}

function exactDisplay(price: UnitPrice, units: readonly DisplayUnit[]): DisplayValue | undefined {
  for (const unit of units) {
    try {
      const amount = rationalToFiniteDecimal(multiplyRationals(price.value, unit.scale));
      if (amount !== undefined) return { amount, unit, approximate: false };
    } catch {
      // Try the next reviewed display scale.
    }
  }
  return undefined;
}

export function displayUnitPrice(
  price: UnitPrice,
  observations: readonly NormalizedPriceObservation[] = [],
  options: { tokenDisplay?: "million" | "source" } = {},
) {
  const tokenDisplay = options.tokenDisplay ?? "million";
  const units = displayUnits(price.per);
  const fallbackUnit = units[0];
  if (fallbackUnit === undefined) throw new Error("Price display has no unit");
  const source =
    tokenDisplay === "million" && units[0]?.display === "1M tokens"
      ? undefined
      : sourceDisplay(price, observations, units);
  const display = source ??
    exactDisplay(price, units) ?? {
      amount: approximateDecimal(price.value),
      unit: fallbackUnit,
      approximate: true,
    };
  const denomination = formatDenomination(price.denomination);
  return {
    amount: formatDisplayAmountText(price.denomination, display.amount, display.approximate),
    displayUnit: display.unit.display,
    accessibleText: `${display.approximate ? "approximately " : ""}${denomination} ${display.amount} per ${display.unit.accessible}`,
  };
}

export function formatAllowanceBenefit(value: PriceAllowanceBenefit): string {
  if (value.kind === "credit") return formatDisplayAmount(value.denomination, value.amount);
  const quantity = formatRational(value.quantity.value);
  return `${quantity.text}${quantity.approximate ? "…" : ""} ${formatUnitExpression(value.quantity.unit)}`;
}

function formatDisplayAmount(denomination: PriceDenomination, value: Rational): string {
  const formatted = formatRational(value);
  return formatDisplayAmountText(denomination, formatted.text, formatted.approximate);
}

function formatDisplayAmountText(
  denomination: PriceDenomination,
  value: string,
  approximate: boolean,
): string {
  const label =
    denomination.kind === "fiat" && denomination.currency === "USD"
      ? "$"
      : formatDenomination(denomination);
  return `${label}${label === "$" ? "" : " "}${value}${approximate ? "…" : ""}`;
}

export function formatDimension(value: PriceDimension): string {
  if (value.namespace === "provider")
    return formatProviderValue("provider-dimension", value.provider_id, value.value);
  if (value.value === "cache_ttl_seconds") return "Cache TTL";
  if (value.value === "context_tokens") return "Context";
  return formatSentenceCase(value.value);
}

export function formatCategoricalValue(value: PriceCategoricalValue): string {
  return value.namespace === "kmodels"
    ? formatSentenceCase(value.value)
    : /^[a-z][a-z0-9_]*$/.test(value.value)
      ? formatSentenceCase(value.value)
      : value.value;
}

function offerCanApplyToModel(offer: PricingOffer, context: readonly PricingSelection[]): boolean {
  const statePossible = offer.states.some(
    ({ applicability }) => evaluateApplicability(applicability, context).state !== "false",
  );
  const rawPossible = offerRawVariants(offer).some(
    (variant) =>
      variant.impact === "base_price" &&
      (variant.possible_scope === undefined ||
        evaluateApplicability(variant.possible_scope, context).state !== "false"),
  );
  return statePossible || rawPossible;
}

export function offerRawVariants(offer: PricingOffer): RawPricingVariant[] {
  return offer.terms.flatMap((term) => (term.kind === "raw" ? term.variants : term.raw_variants));
}

function isRateTerm(term: PricingOffer["terms"][number]): term is PriceRateTerm {
  return term.kind === "rate";
}

function uniqueOffers(offers: PricingOffer[]): PricingOffer[] {
  return [
    ...new Map(
      [...offers]
        .sort((left, right) => compareUtf8(left.id, right.id))
        .map((offer) => [offer.id, offer]),
    ).values(),
  ];
}

function withModelSelection(
  selections: readonly PricingSelection[],
  modelRef: string,
): PricingSelection[] {
  const withoutModel = selections.filter(
    ({ dimension }) => dimensionKey(dimension) !== dimensionKey(modelDimension),
  );
  return [
    ...withoutModel,
    {
      dimension: modelDimension,
      kind: "categorical",
      value: { namespace: "kmodels", value: modelRef },
    },
  ];
}

function categoricalValuesEqual(
  left: PriceCategoricalValue,
  right: PriceCategoricalValue,
): boolean {
  return (
    left.namespace === right.namespace &&
    left.value === right.value &&
    (left.namespace !== "provider" ||
      (right.namespace === "provider" && left.provider_id === right.provider_id))
  );
}

function selectionMap(selections: readonly PricingSelection[]): Map<string, PricingSelection> {
  const result = new Map<string, PricingSelection>();
  for (const selection of selections) {
    const key = dimensionKey(selection.dimension);
    if (result.has(key)) throw new Error(`Duplicate pricing selection for ${key}`);
    if (selection.kind === "decimal") assertPricingDecimal(selection.value);
    if (selection.kind === "decimal_range") {
      if (selection.lower === undefined && selection.upper === undefined)
        throw new Error("Decimal-range pricing selection has no bound");
      if (selection.lower !== undefined) assertPricingDecimal(selection.lower.value);
      if (selection.upper !== undefined) assertPricingDecimal(selection.upper.value);
    }
    result.set(key, selection);
  }
  return result;
}

function evaluateCondition(
  condition: PriceCondition,
  context: ReadonlyMap<string, PricingSelection>,
): "true" | "false" | "missing" {
  const selected = context.get(dimensionKey(condition.dimension));
  if (selected === undefined) return "missing";
  if (condition.kind === "categorical")
    return selected.kind === "categorical" &&
      condition.values.some((value) => categoricalValuesEqual(value, selected.value))
      ? "true"
      : "false";
  if (condition.kind === "boolean")
    return selected.kind === "boolean" && condition.value === selected.value ? "true" : "false";
  if (
    (selected.kind !== "decimal" && selected.kind !== "decimal_range") ||
    canonicalJsonKey(selected.unit) !== canonicalJsonKey(condition.unit)
  )
    return "false";
  if (selected.kind === "decimal_range") {
    const selectedScope = { any_of: [{ all_of: [selected] }] };
    const conditionScope = { any_of: [{ all_of: [condition] }] };
    if (applicabilityContainedIn(selectedScope, conditionScope)) return "true";
    return applicabilitiesOverlap(selectedScope, conditionScope) ? "missing" : "false";
  }
  const value = rationalFromDecimal(selected.value);
  if (
    condition.lower !== undefined &&
    !boundSatisfied(
      value,
      rationalFromDecimal(condition.lower.value),
      "lower",
      condition.lower.inclusive,
    )
  )
    return "false";
  if (
    condition.upper !== undefined &&
    !boundSatisfied(
      value,
      rationalFromDecimal(condition.upper.value),
      "upper",
      condition.upper.inclusive,
    )
  )
    return "false";
  return "true";
}

function boundSatisfied(
  value: Rational,
  bound: Rational,
  side: "lower" | "upper",
  inclusive: boolean,
): boolean {
  const comparison = compareRationals(value, bound);
  return side === "lower"
    ? inclusive
      ? comparison >= 0
      : comparison > 0
    : inclusive
      ? comparison <= 0
      : comparison < 0;
}

function slotMeters(
  model: Pick<PricingModel, "tasks">,
  slot: "input" | "cache" | "output",
): readonly StandardPriceMeter[] {
  if (slot === "input") return inputMeters;
  if (slot === "cache") return cacheMeters;
  const prefix: StandardPriceMeter[] = model.tasks.includes("image_generation")
    ? ["image_generation", "output_image"]
    : model.tasks.includes("video_generation")
      ? ["video_generation", "output_video"]
      : model.tasks.includes("embeddings")
        ? ["embedding"]
        : model.tasks.includes("reranking")
          ? ["rerank_request"]
          : model.tasks.some((task) =>
                ["audio_generation", "speech_synthesis", "speech_to_speech"].includes(task),
              )
            ? ["output_audio"]
            : [];
  return [...new Set([...prefix, ...outputMeters])];
}

function tableCell(
  meter: PriceMeter,
  price: UnitPrice,
  observations: readonly NormalizedPriceObservation[],
): PricingTableCell {
  const display = displayUnitPrice(price, observations);
  const formattedMeter = formatMeter(meter);
  return {
    meter: formattedMeter,
    ...display,
    accessibleText: `${formattedMeter}: ${display.accessibleText}`,
    showTooltip:
      meter.namespace === "provider" ||
      price.denomination.kind === "provider_credit" ||
      price.per.factors.some(({ unit }) => unit.namespace === "provider"),
  };
}

function dimensionKey(value: PriceDimension): string {
  return canonicalJsonKey(value);
}

export function isModelDimension(dimension: PriceDimension): boolean {
  return dimension.namespace === "kmodels" && dimension.value === "model";
}

export function isWholeNumberDimension(dimension: PriceDimension): boolean {
  return dimension.namespace === "kmodels" && wholeNumberDimensions.has(dimension.value);
}

function formatProviderValue(kind: string, providerId: string, value: string): string {
  return `${kind}(${JSON.stringify(providerId)},${JSON.stringify(value)})`;
}
