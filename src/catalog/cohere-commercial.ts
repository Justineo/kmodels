import type {
  AtomicPricingBook,
  AtomicPricingTerm,
  AtomicProviderPricing,
  AtomicRateVariant,
} from "./pricing-assembly.ts";
import type { PublishedPricingModel } from "./pricing-adapter.ts";
import {
  accountingGaps,
  addAtom,
  bindRateTerm,
  isStandardUnit,
  providerKeyEvidence,
  stripAccountingGaps,
} from "./pricing-commercial-assembly.ts";
import type { ChargeBinding, PriceMeter } from "./pricing-schema.ts";

export function applyCohereCommercialTopology(
  input: AtomicProviderPricing,
  publishedModels: readonly PublishedPricingModel[],
): AtomicProviderPricing {
  const published = new Map(publishedModels.map((model) => [model.uid, model]));
  return {
    ...input,
    books: input.books.flatMap((book) =>
      book.scope.kind === "models"
        ? [modelBook(book, published.get(book.scope.model_refs[0] ?? ""), input)]
        : [],
    ),
  };
}

function modelBook(
  book: AtomicPricingBook,
  model: PublishedPricingModel | undefined,
  input: AtomicProviderPricing,
): AtomicPricingBook {
  return {
    ...book,
    resource_edges: [],
    offers: book.offers.flatMap((offer) => {
      if (offer.offer_key !== "usage") return [];
      const blocked = accountingGaps(offer.terms);
      return [
        {
          ...offer,
          offer_key: "hosted-inference",
          name: "Hosted inference",
          enrollment: [],
          terms: stripAccountingGaps(offer.terms).map((term) =>
            bindTerm(term, model, input, blocked),
          ),
          relations: [],
          settlement: [],
        },
      ];
    }),
  };
}

function bindTerm(
  term: AtomicPricingTerm,
  model: PublishedPricingModel | undefined,
  input: AtomicProviderPricing,
  blocked: ReadonlySet<string>,
): AtomicPricingTerm {
  return bindRateTerm(term, (meter, variant) => binding(meter, variant, model, input, blocked));
}

function binding(
  meter: PriceMeter,
  variant: AtomicRateVariant,
  model: PublishedPricingModel | undefined,
  input: AtomicProviderPricing,
  blocked: ReadonlySet<string>,
): ChargeBinding | undefined {
  if (blocked.has("policy") || meter.namespace !== "kmodels") return;
  const paths = new Set(model?.api_endpoints?.map(({ path }) => path) ?? []);
  const locators: string[] = [];
  let signal: ChargeBinding["signal"] | undefined;

  if (
    (meter.value === "input_text" || meter.value === "output_text") &&
    isStandardUnit(variant.price.per, "token")
  ) {
    const field = meter.value === "input_text" ? "input_tokens" : "output_tokens";
    signal = { namespace: "kmodels", value: field };
    if (!blocked.has("chat-v2") && paths.has("v2/chat"))
      locators.push(`v2/chat:response.usage.billed_units.${field}`);
    if (!blocked.has("chat-v1") && paths.has("v1/chat"))
      locators.push(`v1/chat:response.meta.billed_units.${field}`);
  } else if (meter.value === "embedding" && isStandardUnit(variant.price.per, "token")) {
    const image = variant.applicability.any_of.some(({ all_of }) =>
      all_of.some(
        (condition) =>
          condition.kind === "categorical" &&
          condition.dimension.namespace === "kmodels" &&
          condition.dimension.value === "modality" &&
          condition.values.some(
            (value) => value.namespace === "kmodels" && value.value === "image",
          ),
      ),
    );
    if (image) {
      const key = "billed_image_tokens";
      addAtom(input, {
        kind: "usage_signal",
        key,
        definition: "Cohere Embed image tokens reported in response meta.billed_units",
        unit: variant.price.per,
        resolution_phase: "outcome",
      });
      signal = { namespace: "provider", provider_id: "cohere", value: key };
    } else signal = { namespace: "kmodels", value: "input_tokens" };
    if (!blocked.has("embed-v2") && paths.has("v2/embed"))
      locators.push(
        `v2/embed:response.meta.billed_units.${image ? "image_tokens" : "input_tokens"}`,
      );
  } else if (meter.value === "rerank") {
    const key = "billed_search_units";
    addAtom(input, {
      kind: "usage_signal",
      key,
      definition: "Cohere Rerank search units reported in response meta.billed_units",
      unit: variant.price.per,
      resolution_phase: "outcome",
    });
    signal = { namespace: "provider", provider_id: "cohere", value: key };
    if (!blocked.has("rerank-v2") && paths.has("v2/rerank"))
      locators.push("v2/rerank:response.meta.billed_units.search_units");
  }

  return signal === undefined || locators.length === 0
    ? undefined
    : {
        signal,
        aggregation: "request",
        observations: locators.map((locator) => providerKeyEvidence(variant.observation, locator)),
      };
}
