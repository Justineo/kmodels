import { load } from "cheerio";
import { z } from "zod";
import type { SourceManifest } from "./manifests.ts";
import {
  attachCommercialFacts,
  commercialResource,
  publishedRate,
  rawPricingFact,
} from "./pricing.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import type { SourceCommercialPricingFact } from "./pricing-source.ts";
import type { Provider } from "./schema.ts";
import {
  parseSagemakerCatalog,
  sagemakerRows,
  sagemakerSpecSchema,
  sagemakerPricingSpecs,
} from "./sagemaker.ts";
import { sagemakerOpenSpecs } from "./sagemaker-sdk.ts";
import { baseModel } from "./model.ts";

const decimal = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);
const listingId = z.string().regex(/^prodview-[a-z0-9]+$/);
const bundleSchema = z.object({
  openManifest: z.string().optional(),
  proprietaryManifest: z.string().optional(),
  catalog: z.string().min(1),
  prices: z.string().min(1),
  specs: z.array(sagemakerSpecSchema),
  listings: z.array(z.object({ id: listingId, body: z.string().min(1) })),
});
const priceListSchema = z.object({
  offerCode: z.literal("AmazonSageMaker"),
  products: z.record(z.string(), z.object({ attributes: z.record(z.string(), z.string()) })),
  terms: z.object({ OnDemand: z.record(z.string(), z.record(z.string(), z.unknown())) }),
});
const termSchema = z.object({
  effectiveDate: z.string().min(1),
  priceDimensions: z.record(
    z.string(),
    z.object({
      rateCode: z.string().min(1),
      description: z.string(),
      beginRange: z.string(),
      endRange: z.string(),
      unit: z.string(),
      pricePerUnit: z.record(z.string(), z.string()),
    }),
  ),
});
const marketplaceContextSchema = z.object({
  routeParams: z.object({ listingId: listingId.optional() }),
  pageId: z.string().optional(),
  urlPathname: z.string().optional(),
  dehydratedState: z.object({ queries: z.array(z.unknown()) }),
});
const pricingQuerySchema = z.object({
  queryKey: z.tuple([
    z.literal("disco"),
    z.literal("get-listing-view"),
    z.object({
      listingId,
      queryName: z.literal("Pricing"),
    }),
  ]),
  state: z.object({ data: z.object({ summary: z.object({ terms: z.array(z.unknown()) }) }) }),
});
const marketplacePageSchema = z.object({ listing_id: listingId, terms: z.array(z.unknown()) });
const marketplaceTermSchema = z.object({
  termType: z.literal("UsageBasedPricingTerm"),
  currencyCode: z.string().min(1),
  rateCards: z.array(z.unknown()),
  rateCardCount: z.number().int().nonnegative(),
  totalRateCards: z.number().int().nonnegative(),
});
const marketplaceCardSchema = z.object({
  dimensionKey: z.string().min(1),
  displayName: z.string(),
  description: z.string(),
  unit: z.string(),
  price: decimal,
  dimensionLabels: z.array(z.object({ type: z.string(), value: z.string() })),
  regionalPrices: z.array(z.unknown()),
});

// Keep public pricing only; SSR also contains unrelated agreement/session fields.
export function normalizeSagemakerMarketplace(body: string, id: string): string {
  const $ = load(body);
  const states = $("script#vike_pageContext");
  if (states.length !== 1) throw new Error("SageMaker Marketplace page state changed");
  const context = marketplaceContextSchema.parse(JSON.parse(states.text()));
  if (
    context.routeParams.listingId === undefined &&
    context.pageId === "/lib/frontend/pages/ppV2/default" &&
    context.urlPathname === "/en/pp/default/index.html" &&
    context.dehydratedState.queries.length === 0 &&
    $("title").text() === "AWS Marketplace"
  )
    return JSON.stringify({ listing_id: id, terms: [] });
  if (context.routeParams.listingId !== id)
    throw new Error("SageMaker Marketplace identity changed");
  const queries = context.dehydratedState.queries.flatMap((value) => {
    const key = z.object({ queryKey: z.array(z.unknown()) }).safeParse(value);
    if (
      !key.success ||
      key.data.queryKey[0] !== "disco" ||
      key.data.queryKey[1] !== "get-listing-view"
    )
      return [];
    const selector = z.object({ queryName: z.string() }).safeParse(key.data.queryKey[2]);
    if (!selector.success || selector.data.queryName !== "Pricing") return [];
    return [pricingQuerySchema.parse(value)];
  });
  if (queries.length > 1 || queries.some((query) => query.queryKey[2].listingId !== id))
    throw new Error("SageMaker Marketplace pricing identity was ambiguous");
  // Some current SDK links resolve to pages without a public pricing query. This is
  // an observable coverage gap, never evidence for free or no hosted offer.
  return JSON.stringify({ listing_id: id, terms: queries[0]?.state.data.summary.terms ?? [] });
}

interface Input {
  provider: Provider;
  source: SourceManifest;
  body: string;
  observedAt: string;
  onPricingReconciliation?: (item: PricingReconciliationItem) => void;
}

export function parseSagemakerPricing(input: Input) {
  const bundle = bundleSchema.parse(JSON.parse(input.body));
  const models = parseSagemakerCatalog({ ...input, body: bundle.catalog });
  if (bundle.openManifest !== undefined) {
    const seen = new Set(models.map((model) => model.model_id));
    for (const header of sagemakerOpenSpecs(bundle.openManifest, sagemakerRows(bundle.catalog))) {
      if (seen.has(header.model_id)) continue;
      models.push(
        baseModel({
          providerId: input.provider.id,
          id: header.model_id,
          name: header.model_id,
          sourceId: input.source.id,
          observedAt: input.observedAt,
        }),
      );
    }
  }
  const admitted = new Set(
    sagemakerRows(bundle.catalog)
      .filter((row) => row.proprietary)
      .map((row) => row.id),
  );
  if (bundle.proprietaryManifest !== undefined) {
    for (const header of sagemakerPricingSpecs(
      bundle.proprietaryManifest,
      sagemakerRows(bundle.catalog),
      true,
    )) {
      if (admitted.has(header.model_id)) continue;
      admitted.add(header.model_id);
      models.push(
        baseModel({
          providerId: input.provider.id,
          id: header.model_id,
          name: header.model_id,
          sourceId: input.source.id,
          observedAt: input.observedAt,
        }),
      );
    }
  }
  const modelRefs = models.map((model) => model.uid);
  const facts = infrastructureFacts(input, bundle.prices, modelRefs);
  const seenSpecs = new Map<string, string>();
  const versions = new Set<string>();
  const refs = new Map<string, string[]>();
  for (const spec of bundle.specs) {
    const identity = `${spec.model_id}@${spec.version}`;
    const previous = seenSpecs.get(spec.model_id);
    if (
      !admitted.has(spec.model_id) ||
      versions.has(identity) ||
      (previous !== undefined && previous !== spec.listing_id)
    )
      throw new Error("SageMaker pricing spec identity or listing association changed");
    versions.add(identity);
    if (previous !== undefined) continue;
    seenSpecs.set(spec.model_id, spec.listing_id);
    const values = refs.get(spec.listing_id) ?? [];
    values.push(`${input.provider.id}/${spec.model_id}`);
    refs.set(spec.listing_id, values);
  }
  if (seenSpecs.size !== admitted.size) throw new Error("SageMaker pricing specs were incomplete");
  const seenListings = new Set<string>();
  for (const listing of bundle.listings) {
    const linked = refs.get(listing.id);
    if (linked === undefined || seenListings.has(listing.id))
      throw new Error("SageMaker pricing listing escaped catalog scope or duplicated a listing");
    seenListings.add(listing.id);
    facts.push(...marketplaceFacts(input, listing.id, listing.body, linked));
  }
  if (seenListings.size !== refs.size)
    throw new Error("SageMaker Marketplace price bundle was incomplete");
  attachCommercialFacts(models, facts);
  return models;
}

function record(
  input: Input,
  disposition: PricingReconciliationItem["disposition"],
  reason_code: string,
): void {
  input.onPricingReconciliation?.({ disposition, reason_code });
}

function service(
  input: Input,
  key: string,
  name: string,
  refs: string[],
): SourceCommercialPricingFact {
  return {
    ...commercialResource(input.source.id, `service:${key}`, name, "service", key, refs, "usage"),
    offer_key: key,
    offer_name: name,
    pricing_state: "numeric",
    price_facts: [],
    raw_price_facts: [],
  };
}

function capacity(
  input: Input,
  key: string,
  name: string,
  refs: string[],
): SourceCommercialPricingFact {
  return {
    ...commercialResource(
      input.source.id,
      `capacity:${key}`,
      name,
      "capacity",
      key,
      refs,
      "capacity",
    ),
    offer_key: "instance-hour",
    offer_name: name,
    pricing_state: "numeric",
    price_facts: [],
    raw_price_facts: [],
  };
}

function infrastructureFacts(
  input: Input,
  body: string,
  modelRefs: string[],
): SourceCommercialPricingFact[] {
  const data = priceListSchema.parse(JSON.parse(body));
  const dataProcessing = service(
    input,
    "endpoint-data-processing",
    "Endpoint data processing",
    modelRefs,
  );
  // Serverless deployment is conditional and excludes Marketplace/GPU containers. No
  // blanket model references: this service book does not assert model compatibility.
  const serverless = service(input, "serverless-inference", "Serverless inference execution", []);
  const hosting = new Map<string, SourceCommercialPricingFact>();
  for (const [sku, product] of Object.entries(data.products)) {
    const a = product.attributes;
    const isData = a.group === "Hosting:IN" || a.group === "Hosting:OUT";
    const isServerless =
      a.group === "ServerlessInf" || a.group === "ServerlessProvisionedConcurrency-Duration";
    const isHosting = a.component === "Hosting";
    if (!isData && !isServerless && !isHosting) {
      record(input, "excluded", "sagemaker_outside_request_pricing");
      continue;
    }
    const region = a.regionCode;
    if (
      !region ||
      !/^[a-z]{2}(?:-[a-z0-9]+)+-\d+$/.test(region) ||
      (isData
        ? a.operation !== "Invoke-Endpoint"
        : isServerless
          ? a.operation !== "Serverless" || !/^[1-6]$/.test(a.memorygb ?? "")
          : a.operation !== "RunInstance" ||
            !/^ml\.[a-z0-9][a-z0-9.-]*$/.test(a.instanceName ?? "") ||
            ![`${a.instanceName}-Hosting`, `${a.instanceName}-hosting`].includes(
              a.instanceType ?? "",
            ))
    )
      throw new Error("SageMaker inference rate selectors changed");
    const instance = a.instanceName ?? "";
    const fact = isData
      ? dataProcessing
      : isServerless
        ? serverless
        : (hosting.get(instance) ??
          capacity(input, `hosting-${instance}`, `SageMaker hosting · ${instance}`, []));
    if (isHosting) hosting.set(instance, fact);
    const terms = Object.values(data.terms.OnDemand[sku] ?? {});
    if (terms.length !== 1)
      throw new Error("SageMaker inference SKU did not have one current term");
    const term = termSchema.parse(terms[0]);
    const dimensions = Object.values(term.priceDimensions);
    if (dimensions.length === 0) throw new Error("SageMaker inference price dimensions were empty");
    let raw = false;
    for (const dimension of dimensions) {
      if (Object.keys(dimension.pricePerUnit).length === 0)
        throw new Error("SageMaker inference price amounts were empty");
      for (const [currency, amount] of Object.entries(dimension.pricePerUnit)) {
        if (
          dimension.unit !== (isData ? "GB" : isServerless ? "seconds" : "Hrs") ||
          dimension.beginRange !== "0" ||
          dimension.endRange !== "Inf" ||
          !decimal.safeParse(amount).success
        ) {
          fact.raw_price_facts.push(
            rawPricingFact(
              input.source.id,
              `AmazonSageMaker:${sku}:${dimension.rateCode}`,
              "base_price",
              "unsupported_structure",
              {
                label: dimension.description.slice(0, 256),
                amount: amount.slice(0, 256),
                denomination: currency.slice(0, 64),
                unit: dimension.unit.slice(0, 128),
                conditions: [
                  { dimension: "region", value: region },
                  { dimension: "group", value: a.group ?? "" },
                  { dimension: "memorygb", value: a.memorygb ?? "" },
                  ...(isHosting ? [{ dimension: "instance", value: instance }] : []),
                  {
                    dimension: "range",
                    value: `${dimension.beginRange}-${dimension.endRange}`.slice(0, 128),
                  },
                ],
              },
            ),
          );
          raw = true;
          continue;
        }
        fact.price_facts.push({
          ...publishedRate(
            isData
              ? a.group === "Hosting:IN"
                ? "input_data"
                : "output_data"
              : isServerless
                ? "compute"
                : "instance_hour",
            amount,
            isData ? "sagemaker_data_gb" : isServerless ? "second" : "instance_hour",
            input.source.id,
            dimension.unit,
            {
              region,
              effective_from: term.effectiveDate,
              endpoint: "InvokeEndpoint",
              ...(isData
                ? {}
                : isServerless
                  ? {
                      operation: `memory-${a.memorygb}gb`,
                      service_tier:
                        a.group === "ServerlessInf" ? "on_demand" : "provisioned_execution",
                    }
                  : { capacity: instance }),
            },
          ),
          currency,
          source_locator: {
            kind: "provider_key",
            value: `AmazonSageMaker:${sku}:${dimension.rateCode}`,
          },
        });
      }
    }
    record(
      input,
      raw ? "raw" : "normalized",
      raw
        ? "sagemaker_public_inference_structure"
        : isHosting
          ? "sagemaker_public_hosting_capacity"
          : "sagemaker_public_invocation_meter",
    );
  }
  const facts = [dataProcessing, serverless, ...hosting.values()];
  if (hosting.size === 0) throw new Error("SageMaker public hosting instance prices were missing");
  if (facts.some((fact) => fact.price_facts.length === 0 && fact.raw_price_facts.length === 0))
    throw new Error("SageMaker public invocation price groups were missing");
  return facts;
}

function marketplaceFacts(
  input: Input,
  id: string,
  body: string,
  refs: string[],
): SourceCommercialPricingFact[] {
  const page = marketplacePageSchema.parse(JSON.parse(body));
  if (page.listing_id !== id) throw new Error("SageMaker Marketplace price identity changed");
  if (page.terms.length === 0) {
    record(input, "unresolved", "sagemaker_marketplace_public_pricing_unavailable");
    return [];
  }
  const fact = service(input, `marketplace-${id}`, "Marketplace inference software", refs);
  const hourly = capacity(
    input,
    `marketplace-software-${id}`,
    "Marketplace real-time software",
    refs,
  );
  for (const value of page.terms) {
    const type = z.object({ termType: z.string() }).parse(value).termType;
    if (type !== "UsageBasedPricingTerm") {
      record(
        input,
        [
          "LegalTerm",
          "SupportTerm",
          "FreeTrialPricingTerm",
          "ConfigurableUpfrontPricingTerm",
          "FixedUpfrontPricingTerm",
        ].includes(type)
          ? "excluded"
          : "unsupported",
        "sagemaker_marketplace_non_usage_term",
      );
      continue;
    }
    const term = marketplaceTermSchema.parse(value);
    if (term.rateCards.length !== term.rateCardCount || term.rateCardCount !== term.totalRateCards)
      throw new Error("SageMaker Marketplace rate cards were truncated");
    const keys = new Set<string>();
    for (const value of term.rateCards) {
      const card = marketplaceCardSchema.parse(value);
      if (keys.has(card.dimensionKey))
        throw new Error("SageMaker Marketplace duplicated a price dimension");
      keys.add(card.dimensionKey);
      if (/\.(?:m\.i\.b|a\.t)$/.test(card.dimensionKey)) {
        record(input, "excluded", "sagemaker_marketplace_batch_or_training");
        continue;
      }
      const hourlyInstance = /^(ml\.[a-z0-9][a-z0-9.-]*)\.m\.i\.r$/.exec(card.dimensionKey)?.[1];
      const realTime = card.dimensionLabels.some(
        (label) => label.type === "SAGEMAKER_OPTION" && label.value === "Model Real-Time Inference",
      );
      const isHourly = hourlyInstance !== undefined && realTime;
      const isInference = card.dimensionKey === "inference.count.m.i.c" && realTime;
      if (!isInference && !isHourly) {
        if (!realTime) {
          record(input, "unsupported", "sagemaker_marketplace_unreviewed_meter");
          continue;
        }
        (card.unit === "HostHrs" ? hourly : fact).raw_price_facts.push(
          rawPricingFact(
            input.source.id,
            `${id}:${card.dimensionKey}`,
            "base_price",
            "unknown_meter",
            {
              label: card.displayName.slice(0, 256),
              amount: card.price,
              denomination: term.currencyCode,
              unit: card.unit.slice(0, 128),
              conditions: [{ dimension: "dimension_key", value: card.dimensionKey.slice(0, 128) }],
            },
          ),
        );
        record(input, "raw", "sagemaker_marketplace_unreviewed_realtime_meter");
        continue;
      }
      if (
        card.unit !== (isHourly ? "HostHrs" : "Requests") ||
        card.regionalPrices.length !== 0 ||
        card.dimensionLabels.length !== 1
      ) {
        (isHourly ? hourly : fact).raw_price_facts.push(
          rawPricingFact(
            input.source.id,
            `${id}:${card.dimensionKey}`,
            "base_price",
            "unsupported_structure",
            {
              label: card.displayName.slice(0, 256),
              amount: card.price,
              denomination: term.currencyCode,
              unit: card.unit,
            },
          ),
        );
        record(
          input,
          "raw",
          isHourly
            ? "sagemaker_marketplace_hourly_structure"
            : "sagemaker_marketplace_inference_structure",
        );
        continue;
      }
      (isHourly ? hourly : fact).price_facts.push({
        ...publishedRate(
          isHourly ? "instance_hour" : "inference",
          card.price,
          isHourly ? "instance_hour" : "request",
          input.source.id,
          card.unit,
          {
            endpoint: "InvokeEndpoint",
            ...(isHourly ? { capacity: hourlyInstance } : {}),
          },
        ),
        currency: term.currencyCode,
        source_locator: { kind: "provider_key", value: `${id}:${card.dimensionKey}` },
      });
      record(
        input,
        "normalized",
        isHourly
          ? "sagemaker_marketplace_realtime_software_capacity"
          : "sagemaker_marketplace_billable_inference",
      );
    }
  }
  return [fact, hourly].filter(
    (entry) => entry.price_facts.length > 0 || entry.raw_price_facts.length > 0,
  );
}
