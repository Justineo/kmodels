import { canonicalJsonKey, compareUtf8 } from "./canonical-value.ts";
import { manifests, type ProviderManifest } from "./manifests.ts";
import { formatSentenceCase } from "./presentation.ts";
import { compareRationals, rationalFromDecimal } from "./pricing-rational.ts";
import {
  displayUnitPrice,
  evaluateModelApplicability,
  formatAllowanceBenefit,
  formatCategoricalValue,
  formatDimension,
  formatMeter,
  isWholeNumberDimension,
  isModelDimension,
  modelPricingView,
  modelPricingViewFromIndex,
  offerConditions,
  offerRawVariants,
  pricingViewIndex,
  projectPricingTableCellFromView,
  type ModelPricingView,
} from "./pricing-presentation.ts";
import type {
  AllowanceReset,
  BillingMode,
  ChargeBinding,
  PriceAllowanceTarget,
  PriceCategoricalValue,
  PriceCondition,
  PriceDimension,
  PriceMeter,
  PricingBook,
  PricingCatalog,
  PricingOffer,
  PricingRefreshFailureCode,
  ProviderAtomRegistryEntry,
  UsageSignal,
} from "./pricing-schema.ts";
import { standardUsageSignalDetails } from "./pricing-vocabulary.ts";
import type { Catalog, ProviderModel } from "./schema.ts";
import {
  websiteCatalogIndexSchema,
  websiteDetailChunkSchema,
  websitePricingDetailSchema,
  websitePricingSummariesSchema,
  type WebsiteCatalogIndex,
  type WebsiteDetailChunk,
  type WebsiteModelDetail,
  type WebsitePricingDetail,
  type WebsitePricingOffer,
  type WebsitePricingSelector,
  type WebsitePricingSummaries,
} from "./website-schema.ts";

export const WEBSITE_DETAIL_CHUNK_MAX_BYTES = 2 * 1024 * 1024;
const WEBSITE_DETAIL_CHUNK_PAYLOAD_BYTES = WEBSITE_DETAIL_CHUNK_MAX_BYTES - 1024;
type CategoricalLabelIndex = ReadonlyMap<string, string>;
type ProviderAtomIndex = ReadonlyMap<string, ProviderAtomRegistryEntry>;
const selectorCache = new WeakMap<
  PricingOffer,
  WeakMap<CategoricalLabelIndex, WebsitePricingSelector[]>
>();

export interface WebsitePublication {
  catalog: WebsiteCatalogIndex;
  pricing: WebsitePricingSummaries;
  details: WebsiteDetailChunk[];
}

export function websitePublication(
  catalog: Catalog,
  pricing: PricingCatalog,
  dataVersion: string,
): WebsitePublication {
  const index = pricingViewIndex(pricing);
  const labels = categoricalLabelIndex(pricing);
  const atoms = providerAtomIndex(pricing);
  const pricingViews = new Map(
    catalog.models.map((model) => [model.uid, modelPricingViewFromIndex(index, model)]),
  );
  const view = (model: ProviderModel): ModelPricingView => {
    const result = pricingViews.get(model.uid);
    if (result === undefined) throw new Error(`Missing pricing view for ${model.uid}`);
    return result;
  };
  const details = websiteDetailChunks(catalog, dataVersion, view, labels, atoms);
  const detailChunkByModel = new Map(
    details.flatMap(({ chunk, details: chunkDetails }) =>
      chunkDetails.map((detail): [string, number] => [detail.model_ref, chunk]),
    ),
  );

  return {
    catalog: websiteCatalogIndexSchema.parse({
      schema_version: 1,
      data_version: dataVersion,
      generated_at: catalog.generated_at,
      providers: catalog.providers.map(({ id, name }) => ({ id, name })),
      models: catalog.models.map((model) => {
        const detailChunk = detailChunkByModel.get(model.uid);
        if (detailChunk === undefined)
          throw new Error(`Missing website detail chunk for ${model.uid}`);
        return {
          provider_id: model.provider_id,
          model_id: model.model_id,
          ...(model.version === undefined ? {} : { version: model.version }),
          name: model.name,
          tasks: model.tasks,
          ...(model.limits.context_tokens === undefined
            ? {}
            : { context_tokens: model.limits.context_tokens }),
          ...(model.release_date === undefined ? {} : { release_date: model.release_date }),
          status: model.status,
          release_stage: model.release_stage,
          detail_chunk: detailChunk,
        };
      }),
    }),
    pricing: websitePricingSummariesSchema.parse({
      schema_version: 1,
      data_version: dataVersion,
      pricing: catalog.models.map((model) => pricingSummary(view(model), model, labels)),
    }),
    details,
  };
}

function websiteDetailChunks(
  catalog: Catalog,
  dataVersion: string,
  view: (model: ProviderModel) => ModelPricingView,
  labels: CategoricalLabelIndex,
  atoms: ProviderAtomIndex,
): WebsiteDetailChunk[] {
  const chunks: WebsiteDetailChunk[] = [];

  for (const provider of catalog.providers) {
    const providerDetails = catalog.models
      .filter((model) => model.provider_id === provider.id)
      .map((model) => {
        const detail = websiteModelDetailFromView(view(model), model, labels, atoms);
        return {
          detail,
          bytes: Buffer.byteLength(JSON.stringify(detail)),
        };
      });
    let chunkDetails: WebsiteModelDetail[] = [];
    let payloadBytes = 0;
    let chunk = 0;

    function emitChunk(): void {
      if (chunkDetails.length === 0) return;
      const detailChunk = websiteDetailChunkSchema.parse({
        schema_version: 4,
        data_version: dataVersion,
        provider_id: provider.id,
        chunk,
        details: chunkDetails,
      });
      const bytes = Buffer.byteLength(JSON.stringify(detailChunk));
      if (bytes > WEBSITE_DETAIL_CHUNK_MAX_BYTES)
        throw new Error(
          `Website detail chunk ${provider.id}/${chunk} exceeds ${WEBSITE_DETAIL_CHUNK_MAX_BYTES} bytes`,
        );
      chunks.push(detailChunk);
      chunk += 1;
      chunkDetails = [];
      payloadBytes = 0;
    }

    for (const entry of providerDetails) {
      const separatorBytes = chunkDetails.length === 0 ? 0 : 1;
      if (
        chunkDetails.length > 0 &&
        payloadBytes + separatorBytes + entry.bytes > WEBSITE_DETAIL_CHUNK_PAYLOAD_BYTES
      )
        emitChunk();
      chunkDetails.push(entry.detail);
      payloadBytes += (chunkDetails.length === 1 ? 0 : 1) + entry.bytes;
    }
    emitChunk();
  }

  return chunks;
}

function pricingSummary(
  view: ModelPricingView,
  model: ProviderModel,
  labels: CategoricalLabelIndex,
) {
  const input = projectPricingTableCellFromView(view, model, "input");
  const cache = projectPricingTableCellFromView(view, model, "cache");
  const output = projectPricingTableCellFromView(view, model, "output");
  const hasRepresentativeRate = input !== undefined || cache !== undefined || output !== undefined;
  return {
    outcome: view.outcome,
    ...(hasRepresentativeRate ? {} : { status: pricingStatus(view, model.uid, labels) }),
    ...(input === undefined ? {} : { input }),
    ...(cache === undefined ? {} : { cache }),
    ...(output === undefined ? {} : { output }),
  };
}

function pricingStatus(view: ModelPricingView, modelRef: string, labels: CategoricalLabelIndex) {
  if (view.outcome === "not_applicable")
    return {
      label: "No offer",
      description: "No public hosted pricing offer applies to this model.",
    };
  if (view.outcome === "unknown")
    return {
      label: "Unknown",
      description: "Available sources do not establish whether pricing applies.",
    };
  if (view.modelMechanisms.length === 0)
    return {
      label: "No model offer",
      description:
        "Pricing details exist, but no model offer applies to this model. This is not a service-availability claim.",
    };
  if (view.modelMechanisms.length > 1)
    return {
      label: `${view.modelMechanisms.length} offers`,
      description: "Open model details to compare the available model offers.",
    };

  const offer = view.modelMechanisms[0]!;
  const summary = offerStateSummary(offer, modelRef);
  if (summary === "Free")
    return {
      label: "Free",
      description: "The provider publishes this model offer as free.",
    };
  if (summary === "Custom quote")
    return {
      label: "Quote",
      description: "The provider publishes this offer without a standard public price.",
    };
  if (summary === "Price not published")
    return {
      label: "Unpublished",
      description: "A hosted offer exists, but its price is not publicly available.",
    };
  if (summary === "Incomplete")
    return {
      label: "Incomplete",
      description: "Some official pricing facts cannot yet be expressed as exact rates.",
    };
  if (pricingSelectors(offer, labels).some((selector) => !hasFixedValue(selector)))
    return {
      label: "Varies",
      description: "Price varies by request context. Open model details to choose the options.",
    };
  return {
    label: "Details",
    description: "Pricing exists but does not map to one representative table rate.",
  };
}

export function websiteModelDetail(
  pricing: PricingCatalog,
  model: ProviderModel,
): WebsiteModelDetail {
  return websiteModelDetailFromView(
    modelPricingView(pricing, model),
    model,
    categoricalLabelIndex(pricing),
    providerAtomIndex(pricing),
  );
}

function websiteModelDetailFromView(
  view: ModelPricingView,
  model: ProviderModel,
  labels: CategoricalLabelIndex,
  atoms: ProviderAtomIndex,
): WebsiteModelDetail {
  const pricingDetail = websitePricingDetail(view, model.uid, labels, atoms);
  return {
    model_ref: model.uid,
    ...(model.updated_date === undefined ? {} : { updated_date: model.updated_date }),
    ...(model.description === undefined ? {} : { description: model.description }),
    ...(model.delivery_modes === undefined ? {} : { delivery_modes: model.delivery_modes }),
    ...(model.api_endpoints === undefined ? {} : { api_endpoints: model.api_endpoints }),
    modalities: model.modalities,
    capabilities: model.capabilities,
    ...(model.limits.max_output_tokens === undefined
      ? {}
      : { max_output_tokens: model.limits.max_output_tokens }),
    scope: model.scope,
    ...(model.availability === undefined ? {} : { availability_count: model.availability.length }),
    ...(pricingDetail === undefined ? {} : { pricing: pricingDetail }),
  };
}

function websitePricingDetail(
  view: ModelPricingView,
  modelRef: string,
  labels: CategoricalLabelIndex,
  atoms: ProviderAtomIndex,
): WebsitePricingDetail | undefined {
  const snapshot =
    view.snapshot === undefined
      ? undefined
      : view.snapshot.publication === "retained"
        ? {
            observed_at: view.snapshot.observed_at,
            publication: view.snapshot.publication,
            refresh_failure: {
              attempted_at: view.snapshot.refresh_failure.attempted_at,
              message: refreshFailureMessage(view.snapshot.refresh_failure.code),
            },
          }
        : {
            observed_at: view.snapshot.observed_at,
            publication: view.snapshot.publication,
          };
  if (view.outcome !== "offers")
    return snapshot === undefined
      ? undefined
      : websitePricingDetailSchema.parse({ snapshot, offers: [] });
  const offers = [
    ...view.modelMechanisms.map((offer) => ({ offer, group: "model_mechanism" as const })),
    ...view.optionalServices.map((offer) => ({ offer, group: "optional_service" as const })),
    ...view.automaticComponents.map((offer) => ({
      offer,
      group: "automatic_component" as const,
    })),
    ...view.plansAndCapacity.map((offer) => ({ offer, group: "plan_capacity" as const })),
    ...view.standaloneOffers.map((offer) => ({ offer, group: "standalone" as const })),
  ].map(({ offer, group }) => websiteOffer(view.books, offer, group, modelRef, labels, atoms));
  return websitePricingDetailSchema.parse({
    ...(snapshot === undefined ? {} : { snapshot }),
    offers,
  });
}

function refreshFailureMessage(code: PricingRefreshFailureCode): string {
  switch (code) {
    case "source_unavailable":
      return "A required public pricing source could not be fetched.";
    case "source_schema_changed":
      return "A required public pricing source no longer matched its reviewed format.";
    case "pricing_validation_failed":
      return "The refreshed pricing data did not pass validation.";
    case "provider_refresh_failed":
      return "The provider refresh did not complete.";
    case "pricing_not_observed":
      return "The refresh did not produce a complete public pricing snapshot.";
  }
}

function websiteOffer(
  books: PricingBook[],
  offer: PricingOffer,
  group: WebsitePricingOffer["group"],
  modelRef: string,
  labels: CategoricalLabelIndex,
  atoms: ProviderAtomIndex,
): WebsitePricingOffer {
  const states = offer.states.map((state, index) => ({
    key: `state:${index}`,
    state: state.state,
    label: stateLabel(state.state),
    applicability: state.applicability,
    ...(state.validity === undefined ? {} : { validity: state.validity }),
  }));
  const rates: WebsitePricingOffer["rates"] = [];
  const allowances: WebsitePricingOffer["allowances"] = [];
  const contributions: WebsitePricingOffer["contributions"] = [];
  const unnormalized: WebsitePricingOffer["unnormalized"] = [];

  for (const term of offer.terms) {
    if (term.kind === "rate") {
      term.variants.forEach((variant, index) => {
        const price = displayUnitPrice(variant.price, variant.observations, {
          tokenDisplay: "source",
        });
        rates.push({
          key: `${term.id}:rate:${index}`,
          label: meterLabel(term.meter),
          amount: price.amount,
          unit: `per ${price.displayUnit}`,
          accessible_text: price.accessibleText,
          ...(variant.charge_binding === undefined
            ? {}
            : { driver: chargeDriver(variant.charge_binding, atoms) }),
          applicability: variant.applicability,
          ...(variant.validity === undefined ? {} : { validity: variant.validity }),
        });
      });
    } else if (term.kind === "allowance") {
      term.variants.forEach((variant, index) => {
        allowances.push({
          key: `${term.id}:allowance:${index}`,
          value: formatAllowanceBenefit(variant.benefit),
          target: allowanceTarget(variant.target, offer),
          reset: resetLabel(variant.reset),
          applicability: variant.applicability,
          ...(variant.validity === undefined ? {} : { validity: variant.validity }),
        });
      });
    } else if (term.kind === "contribution") {
      term.variants.forEach((variant, index) => {
        contributions.push({
          key: `${term.id}:contribution:${index}`,
          label: formatSentenceCase(term.term_key.replaceAll("-", "_")),
          target: contributionTarget(books, variant.target_rate_refs),
          drivers: variant.charge_bindings.map((binding) => chargeDriver(binding, atoms)),
          applicability: variant.applicability,
          ...(variant.validity === undefined ? {} : { validity: variant.validity }),
        });
      });
    }

    const variants = term.kind === "raw" ? term.variants : term.raw_variants;
    const label =
      term.kind === "rate"
        ? meterLabel(term.meter)
        : term.kind === "allowance"
          ? "Allowance"
          : formatSentenceCase(term.term_key);
    variants.forEach((variant, index) => {
      unnormalized.push({
        key: `${term.id}:raw:${index}`,
        label,
        impact: variant.impact,
        reason: formatSentenceCase(variant.reason),
        ...(variant.possible_scope === undefined ? {} : { possible_scope: variant.possible_scope }),
        ...(variant.validity === undefined ? {} : { validity: variant.validity }),
      });
    });
  }

  return {
    id: offer.id,
    title: offer.name ?? formatSentenceCase(offer.offer_key),
    group,
    billing_mode: billingMode(offer.billing_mode, atoms),
    ...(offer.relations.length === 0 ? {} : { composition: relationLabel(books, offer) }),
    state_summary: offerStateSummary(offer, modelRef),
    selectors: pricingSelectors(offer, labels),
    states,
    rates,
    allowances,
    contributions,
    enrollment: offer.enrollment.map((variant, index) => ({
      key: `enrollment:${index}`,
      label: enrollmentLabel(variant.state),
      applicability: variant.applicability,
      ...(variant.validity === undefined ? {} : { validity: variant.validity }),
    })),
    settlement: offer.settlement.map((variant, index) => ({
      key: `settlement:${index}`,
      channel: formatSentenceCase(variant.channel),
      biller: variant.biller,
      payment_sources: variant.payment_sources.map((source) => formatSentenceCase(source)),
      applicability: variant.applicability,
      ...(variant.validity === undefined ? {} : { validity: variant.validity }),
    })),
    unnormalized,
  };
}

function pricingSelectors(
  offer: PricingOffer,
  labels: CategoricalLabelIndex,
): WebsitePricingSelector[] {
  const cache = selectorCache.get(offer);
  const cached = cache?.get(labels);
  if (cached !== undefined) return cached;
  const byDimension = new Map<string, PriceCondition[]>();
  for (const condition of offerConditions(offer)) {
    if (isModelDimension(condition.dimension)) continue;
    const key = canonicalJsonKey(condition.dimension);
    const current = byDimension.get(key);
    if (current === undefined) byDimension.set(key, [condition]);
    else current.push(condition);
  }
  const selectors = [...byDimension.entries()]
    .map(([key, conditions]) => pricingSelector(key, conditions, labels))
    .sort((left, right) => compareUtf8(left.label, right.label));
  const created = cache ?? new WeakMap<CategoricalLabelIndex, WebsitePricingSelector[]>();
  created.set(labels, selectors);
  if (cache === undefined) selectorCache.set(offer, created);
  return selectors;
}

function pricingSelector(
  key: string,
  conditions: PriceCondition[],
  labels: CategoricalLabelIndex,
): WebsitePricingSelector {
  const first = conditions[0];
  if (first === undefined) throw new Error(`Pricing selector ${key} has no conditions`);
  const base = {
    key,
    label: formatDimension(first.dimension),
    dimension: first.dimension,
  };
  if (first.kind === "categorical") {
    const values = new Map(
      conditions.flatMap((condition) => {
        if (condition.kind !== "categorical") return [];
        return condition.values.map((value) => {
          const valueKey = canonicalJsonKey(value);
          return [
            valueKey,
            { key: valueKey, label: categoricalLabel(labels, first.dimension, value), value },
          ] as const;
        });
      }),
    );
    return {
      ...base,
      kind: "categorical",
      values: [...values.values()].sort((left, right) => compareUtf8(left.label, right.label)),
    };
  }
  if (first.kind === "boolean") return { ...base, kind: "boolean" };

  const ranges = [
    ...new Map(
      conditions.flatMap((condition) => {
        if (condition.kind !== "decimal_range") return [];
        const range = {
          ...(condition.lower === undefined ? {} : { lower: condition.lower }),
          ...(condition.upper === undefined ? {} : { upper: condition.upper }),
        };
        return [[canonicalJsonKey(range), range] as const];
      }),
    ).values(),
  ];
  const exactValues = ranges.flatMap(({ lower, upper }) =>
    lower !== undefined &&
    upper !== undefined &&
    lower.inclusive &&
    upper.inclusive &&
    lower.value === upper.value
      ? [lower.value]
      : [],
  );
  if (exactValues.length === ranges.length)
    return {
      ...base,
      kind: "decimal_values",
      unit: first.unit,
      values: exactValues.sort((left, right) =>
        compareRationals(rationalFromDecimal(left), rationalFromDecimal(right)),
      ),
    };
  const buckets = decimalBuckets(first.dimension, ranges);
  if (buckets !== undefined)
    return { ...base, kind: "decimal_buckets", unit: first.unit, values: buckets };
  return { ...base, kind: "decimal_range", unit: first.unit, ranges };
}

function categoricalLabelIndex(pricing: PricingCatalog): CategoricalLabelIndex {
  const labels = new Map<string, string>();
  for (const vocabulary of pricing.provider_vocabularies)
    for (const atom of vocabulary.atoms)
      if (atom.kind === "categorical_value" && atom.label !== undefined)
        addCategoricalLabel(
          labels,
          categoricalLabelIdentity(vocabulary.provider_id, atom.dimension, atom.key),
          atom.label,
        );
  const providerManifests: readonly ProviderManifest[] = manifests;
  for (const manifest of providerManifests)
    for (const label of manifest.pricingCategoricalLabels ?? [])
      addCategoricalLabel(
        labels,
        categoricalLabelIdentity(manifest.provider.id, label.dimension, label.value),
        label.label,
      );
  return labels;
}

function providerAtomIndex(pricing: PricingCatalog): ProviderAtomIndex {
  const atoms = new Map<string, ProviderAtomRegistryEntry>();
  for (const vocabulary of pricing.provider_vocabularies)
    for (const atom of vocabulary.atoms) {
      if (atom.kind === "categorical_value") continue;
      const key = providerAtomIdentity(vocabulary.provider_id, atom.kind, atom.key);
      if (atoms.has(key)) throw new Error(`Duplicate provider pricing atom ${key}`);
      atoms.set(key, atom);
    }
  return atoms;
}

function providerAtomIdentity(providerId: string, kind: string, key: string): string {
  return canonicalJsonKey([providerId, kind, key]);
}

function providerAtom(
  atoms: ProviderAtomIndex,
  providerId: string,
  kind: Exclude<ProviderAtomRegistryEntry["kind"], "categorical_value" | "dimension">,
  key: string,
): ProviderAtomRegistryEntry {
  const atom = atoms.get(providerAtomIdentity(providerId, kind, key));
  if (atom === undefined || atom.kind !== kind)
    throw new Error(`Missing ${providerId} ${kind} atom ${key}`);
  return atom;
}

function addCategoricalLabel(labels: Map<string, string>, identity: string, label: string): void {
  const current = labels.get(identity);
  if (current !== undefined && current !== label)
    throw new Error(`Provider categorical label conflicts with its canonical vocabulary`);
  labels.set(identity, label);
}

function categoricalLabel(
  labels: CategoricalLabelIndex,
  dimension: PriceDimension,
  value: PriceCategoricalValue,
): string {
  if (value.namespace === "provider") {
    const label = labels.get(categoricalLabelIdentity(value.provider_id, dimension, value.value));
    if (label !== undefined) return label;
  }
  return formatCategoricalValue(value);
}

function categoricalLabelIdentity(
  providerId: string,
  dimension: PriceDimension,
  value: string,
): string {
  return canonicalJsonKey([providerId, dimension, value]);
}

type WebsiteDecimalRange = Extract<
  WebsitePricingSelector,
  { kind: "decimal_range" }
>["ranges"][number];
type WebsiteDecimalBucket = Extract<
  WebsitePricingSelector,
  { kind: "decimal_buckets" }
>["values"][number];

function decimalBuckets(
  dimension: PriceCondition["dimension"],
  ranges: WebsiteDecimalRange[],
): WebsiteDecimalBucket[] | undefined {
  if (ranges.length < 2) return undefined;
  const partition = isWholeNumberDimension(dimension)
    ? integerPartition(ranges)
    : continuousPartition(ranges);
  return partition?.map((range) => ({
    key: canonicalJsonKey(range),
    label: decimalBucketLabel(range),
    ...range,
  }));
}

function integerPartition(ranges: WebsiteDecimalRange[]): WebsiteDecimalRange[] | undefined {
  const normalized = ranges.flatMap((range) => {
    const lower = integerLower(range.lower);
    const upper = integerUpper(range.upper);
    return upper !== undefined && upper < lower
      ? []
      : [{ lower, ...(upper === undefined ? {} : { upper }) }];
  });
  if (normalized.length !== ranges.length) return undefined;
  normalized.sort((left, right) =>
    left.lower < right.lower ? -1 : left.lower > right.lower ? 1 : 0,
  );
  if (normalized[0]?.lower !== 0n || normalized.at(-1)?.upper !== undefined) return undefined;
  for (let index = 1; index < normalized.length; index++) {
    const previousUpper = normalized[index - 1]?.upper;
    if (previousUpper === undefined || normalized[index]?.lower !== previousUpper + 1n)
      return undefined;
  }
  return normalized.map(({ lower, upper }) => ({
    lower: { value: String(lower), inclusive: true },
    ...(upper === undefined ? {} : { upper: { value: String(upper), inclusive: true } }),
  }));
}

function integerLower(bound: WebsiteDecimalRange["lower"]): bigint {
  if (bound === undefined) return 0n;
  const { integer, fractional } = decimalParts(bound.value);
  return fractional || !bound.inclusive ? integer + 1n : integer;
}

function integerUpper(bound: WebsiteDecimalRange["upper"]): bigint | undefined {
  if (bound === undefined) return undefined;
  const { integer, fractional } = decimalParts(bound.value);
  return fractional || bound.inclusive ? integer : integer - 1n;
}

function decimalParts(value: string): { integer: bigint; fractional: boolean } {
  const [integer = "0", fraction = ""] = value.split(".");
  return { integer: BigInt(integer), fractional: fraction !== "" };
}

function continuousPartition(ranges: WebsiteDecimalRange[]): WebsiteDecimalRange[] | undefined {
  const sorted = [...ranges].sort(compareRangeLower);
  const first = sorted[0];
  if (first === undefined || !rangeIncludesZero(first) || sorted.at(-1)?.upper !== undefined)
    return undefined;
  for (let index = 1; index < sorted.length; index++) {
    const previousUpper = sorted[index - 1]?.upper;
    const lower = sorted[index]?.lower;
    if (
      previousUpper === undefined ||
      lower === undefined ||
      compareRationals(
        rationalFromDecimal(previousUpper.value),
        rationalFromDecimal(lower.value),
      ) !== 0 ||
      previousUpper.inclusive === lower.inclusive
    )
      return undefined;
  }
  return sorted.map((range) =>
    range.lower === undefined
      ? {
          lower: { value: "0", inclusive: true },
          ...(range.upper === undefined ? {} : { upper: range.upper }),
        }
      : range,
  );
}

function compareRangeLower(left: WebsiteDecimalRange, right: WebsiteDecimalRange): number {
  if (left.lower === undefined) return right.lower === undefined ? 0 : -1;
  if (right.lower === undefined) return 1;
  return compareRationals(
    rationalFromDecimal(left.lower.value),
    rationalFromDecimal(right.lower.value),
  );
}

function rangeIncludesZero(range: WebsiteDecimalRange): boolean {
  if (range.lower !== undefined && (range.lower.value !== "0" || !range.lower.inclusive))
    return false;
  return (
    range.upper === undefined ||
    compareRationals(rationalFromDecimal(range.upper.value), rationalFromDecimal("0")) > 0 ||
    (range.upper.value === "0" && range.upper.inclusive)
  );
}

function decimalBucketLabel({ lower, upper }: WebsiteDecimalRange): string {
  if (
    lower !== undefined &&
    upper !== undefined &&
    lower.value === upper.value &&
    lower.inclusive &&
    upper.inclusive
  )
    return formatSelectorDecimal(lower.value);
  if (lower?.value === "0" && lower.inclusive && upper !== undefined)
    return `${upper.inclusive ? "≤" : "<"} ${formatSelectorDecimal(upper.value)}`;
  if (lower !== undefined && upper === undefined)
    return `${lower.inclusive ? "≥" : ">"} ${formatSelectorDecimal(lower.value)}`;
  if (lower === undefined || upper === undefined) throw new Error("Incomplete decimal bucket");
  return `${lower.inclusive ? "≥" : ">"} ${formatSelectorDecimal(lower.value)} and ${
    upper.inclusive ? "≤" : "<"
  } ${formatSelectorDecimal(upper.value)}`;
}

function formatSelectorDecimal(value: string): string {
  const [integer = "0", fraction] = value.split(".");
  const grouped = integer.replace(/\B(?=(?:\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

function offerStateSummary(offer: PricingOffer, modelRef: string): string {
  if (
    offerRawVariants(offer).some(
      (variant) =>
        variant.impact === "base_price" &&
        (variant.possible_scope === undefined ||
          evaluateModelApplicability(variant.possible_scope, modelRef).state !== "false"),
    )
  )
    return "Incomplete";
  const states = [
    ...new Set(
      offer.states
        .filter(
          ({ applicability }) =>
            evaluateModelApplicability(applicability, modelRef).state !== "false",
        )
        .map(({ state }) => stateLabel(state)),
    ),
  ];
  if (states.length === 0) return "No matching state";
  return states.length === 1 ? states[0]! : `${states.length} pricing states`;
}

function allowanceTarget(target: PriceAllowanceTarget, offer: PricingOffer): string {
  if (target.kind === "offers") return `${target.offer_refs.length} offer target`;
  const labels = target.term_refs.map((ref) => {
    const term = offer.terms.find(({ id }) => id === ref);
    return term?.kind === "rate" ? meterLabel(term.meter) : "Rate term";
  });
  return `Offsets ${[...new Set(labels)].join(", ")}`;
}

function contributionTarget(books: PricingBook[], termRefs: string[]): string {
  const labels = books.flatMap(({ offers }) =>
    offers.flatMap((offer) =>
      offer.terms.flatMap((term) =>
        term.kind === "rate" && termRefs.includes(term.id)
          ? [`${offer.name ?? formatSentenceCase(offer.offer_key)} · ${meterLabel(term.meter)}`]
          : [],
      ),
    ),
  );
  return `Priced by ${[...new Set(labels)].join(", ") || "referenced rate"}`;
}

function relationLabel(books: PricingBook[], offer: PricingOffer): string {
  const offerNames = new Map(
    books.flatMap(({ offers }) =>
      offers.map((candidate) => [
        candidate.id,
        candidate.name ?? formatSentenceCase(candidate.offer_key),
      ]),
    ),
  );
  return offer.relations
    .map((relation) => {
      const target = relation.target.offer_refs.map(
        (ref) => offerNames.get(ref) ?? "Referenced offer",
      );
      const prefix =
        relation.kind === "requires"
          ? "Requires one of"
          : relation.kind === "incurs"
            ? "Automatically incurs"
            : relation.kind === "compatible_with"
              ? "Compatible with"
              : "Mutually exclusive with";
      return `${prefix} ${target.join(", ")}`;
    })
    .join("; ");
}

function chargeDriver(
  binding: ChargeBinding,
  atoms: ProviderAtomIndex,
): NonNullable<WebsitePricingOffer["rates"][number]["driver"]> {
  const signal = usageSignalDetails(binding.signal, atoms);
  const aggregation = aggregationDetails(binding.aggregation, atoms);
  return {
    label: signal.label,
    definition: signal.definition,
    aggregation: aggregation.label,
    ...(aggregation.definition === undefined
      ? {}
      : { aggregation_definition: aggregation.definition }),
    resolution_phase: signal.resolution_phase,
  };
}

function usageSignalDetails(signal: UsageSignal, atoms: ProviderAtomIndex) {
  if (signal.namespace === "kmodels") return standardUsageSignalDetails[signal.value];
  const atom = providerAtom(atoms, signal.provider_id, "usage_signal", signal.value);
  if (atom.kind !== "usage_signal") throw new Error(`Invalid usage signal ${signal.value}`);
  return {
    label: formatSentenceCase(signal.value),
    definition: atom.definition,
    resolution_phase: atom.resolution_phase,
  };
}

function aggregationDetails(
  aggregation: ChargeBinding["aggregation"],
  atoms: ProviderAtomIndex,
): { label: string; definition?: string } {
  if (typeof aggregation === "string")
    return {
      label:
        aggregation === "result_item"
          ? "Result item"
          : aggregation === "billing_period"
            ? "Billing period"
            : formatSentenceCase(aggregation),
    };
  const atom = providerAtom(atoms, aggregation.provider_id, "aggregation", aggregation.value);
  return { label: formatSentenceCase(aggregation.value), definition: atom.definition };
}

function billingMode(
  mode: BillingMode,
  atoms: ProviderAtomIndex,
): WebsitePricingOffer["billing_mode"] {
  if (mode.namespace === "kmodels")
    return {
      label:
        mode.value === "usage"
          ? "Usage-based"
          : mode.value === "one_time"
            ? "One-time purchase"
            : formatSentenceCase(mode.value),
    };
  const atom = providerAtom(atoms, mode.provider_id, "billing_mode", mode.value);
  return { label: formatSentenceCase(mode.value), description: atom.definition };
}

function enrollmentLabel(state: PricingOffer["enrollment"][number]["state"]): string {
  switch (state) {
    case "open":
      return "Open enrollment";
    case "waitlist":
      return "Waitlist";
    case "closed_to_new":
      return "Closed to new customers";
    case "private_preview":
      return "Private preview";
    case "account_scoped":
      return "Account-scoped enrollment";
  }
}

function stateLabel(state: PricingOffer["states"][number]["state"]): string {
  switch (state) {
    case "numeric":
      return "Metered pricing";
    case "free":
      return "Free";
    case "included":
      return "Included";
    case "externally_billed":
      return "Externally billed";
    case "custom_quote":
      return "Custom quote";
    case "not_published":
      return "Price not published";
  }
}

function resetLabel(reset: AllowanceReset): string {
  return reset.namespace === "kmodels"
    ? reset.value === "none"
      ? "No reset"
      : `${formatSentenceCase(reset.value)} reset`
    : `${reset.provider_id} · ${reset.value}`;
}

function meterLabel(meter: PriceMeter): string {
  return meter.namespace === "kmodels" ? formatSentenceCase(meter.value) : formatMeter(meter);
}

function hasFixedValue(selector: WebsitePricingSelector): boolean {
  return selector.kind === "categorical" && selector.values.length === 1;
}
