import { canonicalJson, compareUtf8 } from "./canonical-value.ts";
import { formatSentenceCase } from "./presentation.ts";
import {
  displayUnitPrice,
  evaluateModelApplicability,
  formatAllowanceBenefit,
  formatCategoricalValue,
  formatDimension,
  formatMeter,
  isModelDimension,
  modelPricingView,
  offerConditions,
  offerRawVariants,
  projectPricingTableCell,
} from "./pricing-presentation.ts";
import type {
  AllowanceReset,
  PriceAllowanceTarget,
  PriceMeter,
  PricingBook,
  PricingCatalog,
  PricingOffer,
  PricingRefreshFailureCode,
} from "./pricing-schema.ts";
import type { Catalog, ProviderModel } from "./schema.ts";
import {
  websiteCatalogIndexSchema,
  websiteDetailChunkSchema,
  websiteModelDetailSchema,
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
const textEncoder = new TextEncoder();

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
  const details = websiteDetailChunks(catalog, pricing, dataVersion);
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
      pricing: catalog.models.map((model) => pricingSummary(pricing, model)),
    }),
    details,
  };
}

function websiteDetailChunks(
  catalog: Catalog,
  pricing: PricingCatalog,
  dataVersion: string,
): WebsiteDetailChunk[] {
  const chunks: WebsiteDetailChunk[] = [];

  for (const provider of catalog.providers) {
    const providerDetails = catalog.models
      .filter((model) => model.provider_id === provider.id)
      .map((model) => {
        const detail = websiteModelDetail(pricing, model);
        return {
          detail,
          bytes: textEncoder.encode(JSON.stringify(detail)).byteLength,
        };
      });
    let chunkDetails: WebsiteModelDetail[] = [];
    let payloadBytes = 0;
    let chunk = 0;

    function emitChunk(): void {
      if (chunkDetails.length === 0) return;
      const detailChunk = websiteDetailChunkSchema.parse({
        schema_version: 1,
        data_version: dataVersion,
        provider_id: provider.id,
        chunk,
        details: chunkDetails,
      });
      const bytes = textEncoder.encode(JSON.stringify(detailChunk)).byteLength;
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

function pricingSummary(pricing: PricingCatalog, model: ProviderModel) {
  const view = modelPricingView(pricing, model);
  const input = projectPricingTableCell(pricing, model, "input");
  const cache = projectPricingTableCell(pricing, model, "cache");
  const output = projectPricingTableCell(pricing, model, "output");
  const hasRepresentativeRate = input !== undefined || cache !== undefined || output !== undefined;
  return {
    outcome: view.outcome,
    ...(hasRepresentativeRate ? {} : { status: pricingStatus(view, model.uid) }),
    ...(input === undefined ? {} : { input }),
    ...(cache === undefined ? {} : { cache }),
    ...(output === undefined ? {} : { output }),
  };
}

function pricingStatus(view: ReturnType<typeof modelPricingView>, modelRef: string) {
  if (view.outcome === "not_applicable")
    return {
      label: "N/A",
      description:
        "This provider explicitly has no public pricing offer for this model. This is not a service-availability claim.",
    };
  if (view.outcome === "unknown")
    return {
      label: "Unknown",
      description:
        "No reliable public pricing information is currently available. This does not mean the model is unavailable.",
    };
  if (view.baseOffers.length === 0)
    return {
      label: "No base offer",
      description:
        "Pricing details exist, but no base offer applies to this model. This is not a service-availability claim.",
    };
  if (view.baseOffers.length > 1)
    return {
      label: `${view.baseOffers.length} offers`,
      description: "Open model details to compare the available base offers.",
    };

  const offer = view.baseOffers[0]!;
  const summary = offerStateSummary(offer, modelRef);
  if (summary === "Free")
    return {
      label: "Free",
      description: "The provider publishes this base offer as free.",
    };
  if (summary === "Custom quote")
    return {
      label: "Quote",
      description: "The provider publishes this offer without a standard public price.",
    };
  if (summary === "Price not published")
    return {
      label: "Unpublished",
      description: "The provider confirms this offer but does not publish its numeric price.",
    };
  if (summary === "Incomplete")
    return {
      label: "Incomplete",
      description: "Some official pricing facts cannot yet be expressed as exact rates.",
    };
  if (pricingSelectors(offer).some((selector) => !hasFixedValue(selector)))
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
  const pricingDetail = websitePricingDetail(pricing, model);
  return websiteModelDetailSchema.parse({
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
  });
}

function websitePricingDetail(
  pricing: PricingCatalog,
  model: ProviderModel,
): WebsitePricingDetail | undefined {
  const view = modelPricingView(pricing, model);
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
  const offers = [...view.baseOffers, ...view.addOns].map((offer) =>
    websiteOffer(view.books, offer, model.uid),
  );
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
  modelRef: string,
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
  const unnormalized: WebsitePricingOffer["unnormalized"] = [];

  for (const term of offer.terms) {
    if (term.kind === "rate") {
      term.variants.forEach((variant, index) => {
        const price = displayUnitPrice(variant.price);
        rates.push({
          key: `${term.id}:rate:${index}`,
          label: meterLabel(term.meter),
          amount: price.amount,
          unit: `per ${price.displayUnit}`,
          accessible_text: price.accessibleText,
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
    role: offer.role,
    ...(offer.role === "add_on" ? { compatibility: compatibilityLabel(books, offer) } : {}),
    state_summary: offerStateSummary(offer, modelRef),
    selectors: pricingSelectors(offer),
    states,
    rates,
    allowances,
    unnormalized,
  };
}

function pricingSelectors(offer: PricingOffer): WebsitePricingSelector[] {
  const byDimension = new Map<string, WebsitePricingSelector>();
  for (const condition of offerConditions(offer)) {
    if (isModelDimension(condition.dimension)) continue;
    const key = canonicalJson(condition.dimension);
    if (condition.kind === "categorical") {
      const current = byDimension.get(key);
      const values = new Map(
        current?.kind === "categorical" ? current.values.map((value) => [value.key, value]) : [],
      );
      for (const value of condition.values) {
        const valueKey = canonicalJson(value);
        values.set(valueKey, {
          key: valueKey,
          label: formatCategoricalValue(value),
          value,
        });
      }
      byDimension.set(key, {
        key,
        label: formatDimension(condition.dimension),
        dimension: condition.dimension,
        kind: "categorical",
        values: [...values.values()].sort((left, right) => compareUtf8(left.label, right.label)),
      });
      continue;
    }
    if (byDimension.has(key)) continue;
    byDimension.set(
      key,
      condition.kind === "boolean"
        ? {
            key,
            label: formatDimension(condition.dimension),
            dimension: condition.dimension,
            kind: "boolean",
          }
        : {
            key,
            label: formatDimension(condition.dimension),
            dimension: condition.dimension,
            kind: "decimal_range",
            unit: condition.unit,
          },
    );
  }
  return [...byDimension.values()].sort((left, right) => compareUtf8(left.label, right.label));
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
  if (target.kind === "offer_credit") return "Offer credit";
  const labels = target.term_refs.map((ref) => {
    const term = offer.terms.find(({ id }) => id === ref);
    return term?.kind === "rate" ? meterLabel(term.meter) : "Rate term";
  });
  return `Offsets ${[...new Set(labels)].join(", ")}`;
}

function compatibilityLabel(
  books: PricingBook[],
  offer: Extract<PricingOffer, { role: "add_on" }>,
): string {
  if (offer.compatibility.kind === "all_base_offers_in_book")
    return "Compatible with every base offer in this price book";
  if (offer.compatibility.kind === "not_normalized") return "Compatibility is not normalized";
  const names = new Map(
    books.flatMap(({ offers }) =>
      offers
        .filter(({ role }) => role === "base")
        .map((candidate) => [
          candidate.id,
          candidate.name ?? formatSentenceCase(candidate.offer_key),
        ]),
    ),
  );
  return `Compatible with ${offer.compatibility.offer_refs
    .map((ref) => names.get(ref) ?? "Referenced base offer")
    .join(", ")}`;
}

function stateLabel(state: PricingOffer["states"][number]["state"]): string {
  switch (state) {
    case "numeric":
      return "Metered pricing";
    case "free":
      return "Free";
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
