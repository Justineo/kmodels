import { canonicalJsonKey, compareUtf8 } from "./canonical-value.ts";
import { manifests, type ProviderManifest } from "./manifests.ts";
import { formatSentenceCase } from "./presentation.ts";
import { compareRationals, rationalFromDecimal } from "./pricing-rational.ts";
import {
  displayUnitPrice,
  evaluateApplicability,
  evaluateModelApplicability,
  formatAllowanceBenefit,
  formatCategoricalValue,
  formatDimension,
  formatUnitExpression,
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
  ProviderPricingSnapshot,
  RawPriceFact,
  UsageSignal,
} from "./pricing-schema.ts";
import { standardUsageSignalDetails } from "./pricing-vocabulary.ts";
import type { Catalog, ProviderModel } from "./schema.ts";
import {
  websiteCatalogIndexSchema,
  websiteDetailChunkSchema,
  websiteOfferChunkSchema,
  websiteProviderPricingChunkSchema,
  websitePricingDetailSchema,
  websitePricingSummariesSchema,
  type WebsiteCatalogIndex,
  type WebsiteDetailChunk,
  type WebsiteModelDetail,
  type WebsiteOfferChunk,
  type WebsiteOfferReference,
  type WebsiteProviderPricingChunk,
  type WebsitePricingDetail,
  type WebsitePricingOffer,
  type WebsitePricingSelector,
  type WebsitePricingSummaries,
  type WebsiteStoredModelDetail,
} from "./website-schema.ts";

export const WEBSITE_DETAIL_CHUNK_MAX_BYTES = 2 * 1024 * 1024;
export const PROVIDER_UNNORMALIZED_PREVIEW_LIMIT = 20;
export const WEBSITE_APPLICABILITY_LABEL_MAX_LENGTH = 180;
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
  offers: WebsiteOfferChunk[];
  providerPricing: WebsiteProviderPricingChunk[];
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
  const summaries = catalog.models.map((model) => pricingSummary(view(model), model, labels));
  const deferred = websiteDeferredAssets(catalog, pricing, dataVersion, view, labels, atoms);
  const providerPricingChunks = new Map<string, number>();
  for (const { provider_id } of deferred.providerPricing)
    providerPricingChunks.set(provider_id, (providerPricingChunks.get(provider_id) ?? 0) + 1);
  const detailChunkByModel = new Map(
    deferred.details.flatMap(({ chunk, details: chunkDetails }) =>
      chunkDetails.map((detail): [string, number] => [detail.model_ref, chunk]),
    ),
  );

  return {
    catalog: websiteCatalogIndexSchema.parse({
      schema_version: 2,
      data_version: dataVersion,
      generated_at: catalog.generated_at,
      providers: catalog.providers.map(({ id, name }) => ({
        id,
        name,
        pricing_coverage: providerPricingCoverage(
          catalog,
          pricing,
          summaries,
          id,
          providerPricingChunks.get(id) ?? 0,
        ),
      })),
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
      pricing: summaries,
    }),
    details: deferred.details,
    offers: deferred.offers,
    providerPricing: deferred.providerPricing,
  };
}

function providerPricingCoverage(
  catalog: Catalog,
  pricing: PricingCatalog,
  summaries: WebsitePricingSummaries["pricing"],
  providerId: string,
  detailChunks: number,
) {
  const providerModels = catalog.models.flatMap((model, index) =>
    model.provider_id === providerId && summaries[index] !== undefined ? [summaries[index]] : [],
  );
  return {
    models: providerModels.length,
    representative_models: providerModels.filter(
      (summary) =>
        summary.input !== undefined || summary.cache !== undefined || summary.output !== undefined,
    ).length,
    offer_models: providerModels.filter(({ outcome }) => outcome === "offers").length,
    unknown_models: providerModels.filter(({ outcome }) => outcome === "unknown").length,
    not_applicable_models: providerModels.filter(({ outcome }) => outcome === "not_applicable")
      .length,
    standalone_resources: pricing.books.filter(
      ({ provider_id, scope }) =>
        provider_id === providerId &&
        scope.kind === "provider_resource" &&
        scope.model_refs.length === 0,
    ).length,
    detail_chunks: detailChunks,
  };
}

function websiteDeferredAssets(
  catalog: Catalog,
  pricing: PricingCatalog,
  dataVersion: string,
  view: (model: ProviderModel) => ModelPricingView,
  labels: CategoricalLabelIndex,
  atoms: ProviderAtomIndex,
): Pick<WebsitePublication, "details" | "offers" | "providerPricing"> {
  const details: WebsiteDetailChunk[] = [];
  const offers: WebsiteOfferChunk[] = [];
  const providerPricing: WebsiteProviderPricingChunk[] = [];

  for (const provider of catalog.providers) {
    const offerIndexes = new Map<string, number>();
    const uniqueOffers: WebsitePricingOffer[] = [];
    function indexOffer(offer: WebsitePricingOffer): number {
      const source = JSON.stringify(offer);
      const current = offerIndexes.get(source);
      if (current !== undefined) return current;
      const index = uniqueOffers.length;
      offerIndexes.set(source, index);
      uniqueOffers.push(offer);
      return index;
    }

    const providerDetails = catalog.models
      .filter((model) => model.provider_id === provider.id)
      .map((model) => {
        const { pricing, ...detail } = websiteModelDetailFromView(
          view(model),
          model,
          labels,
          atoms,
        );
        return {
          detail,
          ...(pricing === undefined
            ? {}
            : {
                pricing: {
                  ...(pricing.snapshot === undefined ? {} : { snapshot: pricing.snapshot }),
                  offerIndexes: pricing.offers.map(indexOffer),
                },
              }),
        };
      });
    const providerResources = websiteProviderPricingResources(
      pricing,
      provider.id,
      labels,
      atoms,
    ).map(({ offers: resourceOffers, ...resource }) => ({
      resource,
      offers: resourceOffers.map((offer) => ({
        offer,
        indexes: websiteOfferFragments(offer).map(indexOffer),
      })),
    }));
    offerIndexes.clear();
    const providerOffers = boundedChunks(
      uniqueOffers,
      (values, chunk) =>
        websiteOfferChunkSchema.parse({
          schema_version: 2,
          data_version: dataVersion,
          provider_id: provider.id,
          chunk,
          offers: values,
        }),
      `Website offers for ${provider.id}`,
    );
    offers.push(...providerOffers);
    const references: WebsiteOfferReference[] = providerOffers.flatMap(({ chunk, offers }) =>
      offers.map((_, index): WebsiteOfferReference => [chunk, index]),
    );

    const storedDetails = providerDetails.map(({ pricing, detail }): WebsiteStoredModelDetail => {
      if (pricing === undefined) return detail;
      return {
        ...detail,
        pricing: {
          ...(pricing.snapshot === undefined ? {} : { snapshot: pricing.snapshot }),
          offer_refs: pricing.offerIndexes.map((index) =>
            offerReference(references, index, detail.model_ref),
          ),
        },
      };
    });
    details.push(
      ...boundedChunks(
        storedDetails,
        (values, chunk) =>
          websiteDetailChunkSchema.parse({
            schema_version: 5,
            data_version: dataVersion,
            provider_id: provider.id,
            chunk,
            details: values,
          }),
        `Website model details for ${provider.id}`,
      ),
    );

    const storedResources: WebsiteProviderPricingChunk["resources"] = providerResources.map(
      ({ resource, offers: resourceOffers }) => ({
        ...resource,
        offers: resourceOffers.map(({ offer, indexes }) => ({
          id: offer.id,
          title: offer.title,
          billing_mode: offer.billing_mode,
          state_summary: offer.state_summary,
          offer_refs: indexes.map((index) => offerReference(references, index, resource.id)),
        })),
      }),
    );
    const snapshot = websiteSnapshot(
      pricing.provider_snapshots.find(({ provider_id }) => provider_id === provider.id),
    );
    providerPricing.push(
      ...boundedChunks(
        storedResources,
        (values, chunk) =>
          websiteProviderPricingChunkSchema.parse({
            schema_version: 3,
            data_version: dataVersion,
            provider_id: provider.id,
            chunk,
            ...(snapshot === undefined ? {} : { snapshot }),
            resources: values,
          }),
        `Website provider pricing for ${provider.id}`,
      ),
    );
  }

  return { details, offers, providerPricing };
}

function offerReference(
  references: readonly WebsiteOfferReference[],
  index: number,
  owner: string,
): WebsiteOfferReference {
  const reference = references[index];
  if (reference === undefined) throw new Error(`Missing website offer reference for ${owner}`);
  return reference;
}

const offerRows = [
  "selectors",
  "states",
  "rates",
  "allowances",
  "contributions",
  "enrollment",
  "settlement",
  "unnormalized",
] as const satisfies readonly (keyof WebsitePricingOffer)[];

function websiteOfferFragments(offer: WebsitePricingOffer): WebsitePricingOffer[] {
  const empty = (): WebsitePricingOffer => ({
    ...offer,
    selectors: [],
    states: [],
    rates: [],
    allowances: [],
    contributions: [],
    enrollment: [],
    settlement: [],
    unnormalized_count: offer.unnormalized_count,
    unnormalized: [],
  });
  const fragments: WebsitePricingOffer[] = [];
  let current = empty();
  let rowCount = 0;
  for (const field of offerRows)
    for (const row of offer[field]) {
      const candidate = { ...current, [field]: [...current[field], row] };
      if (
        rowCount > 0 &&
        Buffer.byteLength(JSON.stringify(candidate)) > WEBSITE_DETAIL_CHUNK_PAYLOAD_BYTES
      ) {
        fragments.push(current);
        current = { ...empty(), [field]: [row] };
        rowCount = 1;
      } else {
        current = candidate;
        rowCount += 1;
      }
    }
  return fragments.length === 0 && rowCount === 0 ? [offer] : [...fragments, current];
}

function boundedChunks<Value, Chunk>(
  values: readonly Value[],
  makeChunk: (values: Value[], chunk: number) => Chunk,
  label: string,
): Chunk[] {
  const chunks: Chunk[] = [];
  let current: Value[] = [];
  let payloadBytes = 0;

  function emit(): void {
    if (current.length === 0) return;
    const chunk = makeChunk(current, chunks.length);
    if (Buffer.byteLength(JSON.stringify(chunk)) > WEBSITE_DETAIL_CHUNK_MAX_BYTES)
      throw new Error(
        `${label} chunk ${chunks.length} exceeds ${WEBSITE_DETAIL_CHUNK_MAX_BYTES} bytes`,
      );
    chunks.push(chunk);
    current = [];
    payloadBytes = 0;
  }

  for (const value of values) {
    const bytes = Buffer.byteLength(JSON.stringify(value));
    if (current.length > 0 && payloadBytes + 1 + bytes > WEBSITE_DETAIL_CHUNK_PAYLOAD_BYTES) emit();
    current.push(value);
    payloadBytes += (current.length === 1 ? 0 : 1) + bytes;
  }
  emit();
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
  if (view.modelMechanisms.length === 0) {
    const resourceOffers = [
      ...view.optionalServices,
      ...view.automaticComponents,
      ...view.plansAndCapacity,
      ...view.standaloneOffers,
    ];
    if (
      resourceOffers.some((offer) =>
        offer.states.some(
          ({ state, applicability }) =>
            state === "externally_billed" &&
            evaluateModelApplicability(applicability, modelRef).state !== "false",
        ),
      )
    )
      return {
        label: "External cost",
        description:
          "A self-hosted or externally billed execution path exists; infrastructure cost is set outside this provider price book.",
      };
    return {
      label: "Context",
      description:
        "Commercial services or plans relate to this model, but no provider-priced inference offer applies.",
    };
  }
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
  const snapshot = websiteSnapshot(view.snapshot);
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

function websiteProviderPricingResources(
  pricing: PricingCatalog,
  providerId: string,
  labels: CategoricalLabelIndex,
  atoms: ProviderAtomIndex,
): Array<{
  id: string;
  title: string;
  kind: string;
  raw_only: boolean;
  offers: WebsitePricingOffer[];
}> {
  const books = pricing.books.filter(({ provider_id }) => provider_id === providerId);
  return books
    .filter(({ scope }) => scope.kind === "provider_resource" && scope.model_refs.length === 0)
    .map((book) => {
      if (book.scope.kind !== "provider_resource")
        throw new Error(`Provider resource ${book.book_key} lost its scope`);
      return {
        id: book.id,
        title: book.name ?? formatSentenceCase(book.scope.resource_key.replaceAll("-", "_")),
        kind:
          book.scope.resource_kind.namespace === "kmodels"
            ? formatSentenceCase(book.scope.resource_kind.value)
            : formatSentenceCase(book.scope.resource_kind.value.replaceAll("-", "_")),
        raw_only: isRawOnlyResource(book),
        offers: book.offers.map((offer) =>
          websiteOffer(books, offer, "standalone", undefined, labels, atoms, {
            unnormalizedLimit: PROVIDER_UNNORMALIZED_PREVIEW_LIMIT,
          }),
        ),
      };
    })
    .sort(
      (left, right) =>
        Number(left.raw_only) - Number(right.raw_only) ||
        compareUtf8(left.title, right.title) ||
        compareUtf8(left.id, right.id),
    );
}

function isRawOnlyResource(book: PricingBook): boolean {
  return book.offers.every(
    (offer) =>
      offer.terms.length > 0 &&
      offer.terms.every(({ kind }) => kind === "raw") &&
      offer.states.every(({ state }) => state === "not_published") &&
      offer.relations.length === 0 &&
      offer.enrollment.length === 0 &&
      offer.settlement.length === 0,
  );
}

function websiteSnapshot(snapshot: ProviderPricingSnapshot | undefined) {
  if (snapshot === undefined) return;
  return snapshot.publication === "retained"
    ? {
        observed_at: snapshot.observed_at,
        publication: snapshot.publication,
        refresh_failure: {
          attempted_at: snapshot.refresh_failure.attempted_at,
          message: refreshFailureMessage(snapshot.refresh_failure.code),
        },
      }
    : {
        observed_at: snapshot.observed_at,
        publication: snapshot.publication,
      };
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
  modelRef: string | undefined,
  labels: CategoricalLabelIndex,
  atoms: ProviderAtomIndex,
  options: { unnormalizedLimit?: number } = {},
): WebsitePricingOffer {
  const states = offer.states.map((state, index) => ({
    key: `state:${index}`,
    state: state.state,
    label: stateLabel(state.state),
    ...scopeFields(state, labels),
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
          label: meterLabel(term.meter, atoms),
          amount: price.amount,
          unit: `per ${price.displayUnit}`,
          accessible_text: price.accessibleText,
          ...(variant.charge_binding === undefined
            ? {}
            : { driver: chargeDriver(variant.charge_binding, atoms) }),
          ...scopeFields(variant, labels),
        });
      });
    } else if (term.kind === "allowance") {
      term.variants.forEach((variant, index) => {
        allowances.push({
          key: `${term.id}:allowance:${index}`,
          value: formatAllowanceBenefit(variant.benefit),
          target: allowanceTarget(variant.target, offer, atoms),
          reset: resetLabel(variant.reset),
          ...scopeFields(variant, labels),
        });
      });
    } else if (term.kind === "contribution") {
      term.variants.forEach((variant, index) => {
        contributions.push({
          key: `${term.id}:contribution:${index}`,
          label: formatSentenceCase(term.term_key.replaceAll("-", "_")),
          target: contributionTarget(books, variant.target_rate_refs, atoms),
          drivers: variant.charge_bindings.map((binding) => chargeDriver(binding, atoms)),
          ...scopeFields(variant, labels),
        });
      });
    }

    const variants = term.kind === "raw" ? term.variants : term.raw_variants;
    const label =
      term.kind === "rate"
        ? meterLabel(term.meter, atoms)
        : term.kind === "allowance"
          ? "Allowance"
          : formatSentenceCase(term.term_key);
    variants.forEach((variant, index) => {
      const details = [...new Set(variant.observations.flatMap(({ raw }) => rawFactDetails(raw)))];
      unnormalized.push({
        key: `${term.id}:raw:${index}`,
        label,
        impact: variant.impact,
        reason: formatSentenceCase(variant.reason),
        ...(details.length === 0 ? {} : { details }),
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
      ...scopeFields(variant, labels),
    })),
    settlement: offer.settlement.map((variant, index) => ({
      key: `settlement:${index}`,
      channel: formatSentenceCase(variant.channel),
      biller: variant.biller,
      payment_sources: variant.payment_sources.map((source) => formatSentenceCase(source)),
      ...scopeFields(variant, labels),
    })),
    unnormalized_count: unnormalized.length,
    unnormalized:
      options.unnormalizedLimit === undefined
        ? unnormalized
        : unnormalized.slice(0, options.unnormalizedLimit),
  };
}

function scopeFields(
  value: Pick<PricingOffer["states"][number], "applicability" | "validity">,
  labels: CategoricalLabelIndex,
) {
  return {
    applicability: value.applicability,
    applicability_label: applicabilityLabel(value.applicability, labels),
    ...(value.validity === undefined ? {} : { validity: value.validity }),
  };
}

function rawFactDetails(raw: RawPriceFact): string[] {
  const price = [raw.amount, raw.denomination].filter((value) => value !== undefined).join(" ");
  const details = [
    raw.label,
    price === "" ? undefined : price,
    raw.unit === undefined ? undefined : `Unit: ${raw.unit}`,
    raw.meter === undefined ? undefined : `Meter: ${raw.meter}`,
    raw.formula === undefined ? undefined : `Formula: ${raw.formula}`,
    raw.validity === undefined ? undefined : `Validity: ${raw.validity}`,
    raw.conditions?.map(({ dimension, value }) => `${dimension}: ${value}`).join(", "),
  ].filter((value): value is string => value !== undefined);
  return details;
}

function pricingSelectors(
  offer: PricingOffer,
  labels: CategoricalLabelIndex,
): WebsitePricingSelector[] {
  const cache = selectorCache.get(offer);
  const cached = cache?.get(labels);
  if (cached !== undefined) return cached;
  const byDimension = conditionsByDimension(offerConditions(offer));
  const selectors = [...byDimension.entries()]
    .map(([key, conditions]) => pricingSelector(key, conditions, labels))
    .sort((left, right) => compareUtf8(left.label, right.label));
  const created = cache ?? new WeakMap<CategoricalLabelIndex, WebsitePricingSelector[]>();
  created.set(labels, selectors);
  if (cache === undefined) selectorCache.set(offer, created);
  return selectors;
}

function conditionsByDimension(
  conditions: Iterable<PriceCondition>,
): Map<string, PriceCondition[]> {
  const grouped = new Map<string, PriceCondition[]>();
  for (const condition of conditions) {
    if (isModelDimension(condition.dimension)) continue;
    const key = canonicalJsonKey(condition.dimension);
    const current = grouped.get(key);
    if (current === undefined) grouped.set(key, [condition]);
    else current.push(condition);
  }
  return grouped;
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
    label: dimensionLabel(first.dimension),
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

export function applicabilityLabel(
  applicability: PricingOffer["states"][number]["applicability"],
  labels: CategoricalLabelIndex,
): string {
  const clauses = applicability.any_of.map(({ all_of }) =>
    all_of.filter(({ dimension }) => !isModelDimension(dimension)),
  );
  const first = clauses[0];
  if (first === undefined || clauses.some((conditions) => conditions.length === 0))
    return "All contexts";

  const exact = clauses
    .map((conditions) =>
      conditions.map((condition) => conditionLabel(condition, labels)).join(" · "),
    )
    .join(" or ");
  if (exact.length <= WEBSITE_APPLICABILITY_LABEL_MAX_LENGTH) return exact;

  const common = new Set(first.map(canonicalJsonKey));
  for (const conditions of clauses.slice(1)) {
    const keys = new Set(conditions.map(canonicalJsonKey));
    for (const key of common) if (!keys.has(key)) common.delete(key);
  }
  const commonConditions = first.filter((condition) => common.has(canonicalJsonKey(condition)));
  const byDimension = conditionsByDimension(
    clauses.flatMap((conditions) =>
      conditions.filter((condition) => !common.has(canonicalJsonKey(condition))),
    ),
  );
  const variable = [...byDimension.values()]
    .map((conditions) => dimensionConditionSummary(conditions, labels))
    .sort(compareUtf8);
  const summary = [
    ...commonConditions.map((condition) => conditionLabel(condition, labels)),
    ...variable,
    ...(clauses.length === 1 ? [] : [`${clauses.length} combinations`]),
  ].join(" · ");
  if (summary.length <= WEBSITE_APPLICABILITY_LABEL_MAX_LENGTH) return summary;

  const dimensions = new Set(
    clauses.flatMap((conditions) => conditions.map(({ dimension }) => canonicalJsonKey(dimension))),
  ).size;
  return `Conditional pricing · ${clauses.length} combination${clauses.length === 1 ? "" : "s"} across ${dimensions} dimension${dimensions === 1 ? "" : "s"}`;
}

function conditionLabel(condition: PriceCondition, labels: CategoricalLabelIndex): string {
  const label = dimensionLabel(condition.dimension);
  if (condition.kind === "categorical")
    return `${label}: ${condition.values
      .map((value) => categoricalLabel(labels, condition.dimension, value))
      .join(", ")}`;
  if (condition.kind === "boolean") return condition.value ? label : `No ${label.toLowerCase()}`;
  const bounds = [
    condition.lower === undefined
      ? undefined
      : `${condition.lower.inclusive ? "≥" : ">"} ${condition.lower.value}`,
    condition.upper === undefined
      ? undefined
      : `${condition.upper.inclusive ? "≤" : "<"} ${condition.upper.value}`,
  ].filter((value): value is string => value !== undefined);
  return `${label}: ${bounds.join(" · ")} ${formatUnitExpression(condition.unit)}`;
}

function dimensionConditionSummary(
  conditions: PriceCondition[],
  labels: CategoricalLabelIndex,
): string {
  const first = conditions[0];
  if (first === undefined) throw new Error("Cannot summarize an empty pricing dimension");
  const label = dimensionLabel(first.dimension);
  if (conditions.every((condition) => condition.kind === "categorical")) {
    const values = [
      ...new Map(
        conditions.flatMap((condition) =>
          condition.kind === "categorical"
            ? condition.values.map((value) => [canonicalJsonKey(value), value] as const)
            : [],
        ),
      ).values(),
    ];
    return values.length <= 3
      ? `${label}: ${values
          .map((value) => categoricalLabel(labels, first.dimension, value))
          .join(", ")}`
      : `${label}: ${values.length} values`;
  }
  if (conditions.every((condition) => condition.kind === "boolean")) return `${label}: yes or no`;
  const variants = new Set(conditions.map(canonicalJsonKey)).size;
  return `${label}: ${variants} ${conditions.every((condition) => condition.kind === "decimal_range") ? "ranges" : "conditions"}`;
}

function dimensionLabel(dimension: PriceDimension): string {
  return dimension.namespace === "kmodels"
    ? formatDimension(dimension)
    : formatSentenceCase(dimension.value);
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

function offerStateSummary(offer: PricingOffer, modelRef: string | undefined): string {
  if (
    offerRawVariants(offer).some(
      (variant) =>
        variant.impact === "base_price" &&
        (variant.possible_scope === undefined ||
          applicabilityPossible(variant.possible_scope, modelRef)),
    )
  )
    return "Incomplete";
  const states = [
    ...new Set(
      offer.states
        .filter(({ applicability }) => applicabilityPossible(applicability, modelRef))
        .map(({ state }) => stateLabel(state)),
    ),
  ];
  if (states.length === 0) return "No matching state";
  return states.length === 1 ? states[0]! : `${states.length} pricing states`;
}

function applicabilityPossible(
  applicability: PricingOffer["states"][number]["applicability"],
  modelRef: string | undefined,
): boolean {
  return (
    (modelRef === undefined
      ? evaluateApplicability(applicability, [])
      : evaluateModelApplicability(applicability, modelRef)
    ).state !== "false"
  );
}

function allowanceTarget(
  target: PriceAllowanceTarget,
  offer: PricingOffer,
  atoms: ProviderAtomIndex,
): string {
  if (target.kind === "offers") return `${target.offer_refs.length} offer target`;
  const labels = target.term_refs.map((ref) => {
    const term = offer.terms.find(({ id }) => id === ref);
    return term?.kind === "rate" ? meterLabel(term.meter, atoms) : "Rate term";
  });
  return `Offsets ${[...new Set(labels)].join(", ")}`;
}

function contributionTarget(
  books: PricingBook[],
  termRefs: string[],
  atoms: ProviderAtomIndex,
): string {
  const labels = books.flatMap(({ offers }) =>
    offers.flatMap((offer) =>
      offer.terms.flatMap((term) =>
        term.kind === "rate" && termRefs.includes(term.id)
          ? [
              `${offer.name ?? formatSentenceCase(offer.offer_key)} · ${meterLabel(term.meter, atoms)}`,
            ]
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
      const names = relation.target.offer_refs.map((ref) => offerNames.get(ref));
      const target =
        names.length <= 3 && names.every((name) => name !== undefined)
          ? names.join(", ")
          : `${names.length} ${names.length === 1 ? "offer" : "offers"}`;
      const prefix =
        relation.kind === "requires"
          ? "Requires one of"
          : relation.kind === "incurs"
            ? "Automatically incurs"
            : relation.kind === "compatible_with"
              ? "Compatible with"
              : "Mutually exclusive with";
      return `${prefix} ${target}`;
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

function meterLabel(meter: PriceMeter, atoms: ProviderAtomIndex): string {
  if (meter.namespace === "kmodels") return formatSentenceCase(meter.value);
  providerAtom(atoms, meter.provider_id, "meter", meter.value);
  return formatSentenceCase(meter.value);
}

function hasFixedValue(selector: WebsitePricingSelector): boolean {
  return selector.kind === "categorical" && selector.values.length === 1;
}
