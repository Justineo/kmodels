import type {
  ParsedProviderModel,
  SourceCommercialPricingFact,
  SourcePriceFact,
} from "./pricing-source.ts";
import { sourcePriceFactKey } from "./pricing-source.ts";

type MutableFact = Omit<SourceCommercialPricingFact, "source_ref">;

const services = new Map<string, readonly [string, string, SourcePriceFact["meter"]]>(
  Object.entries({
    google_search: ["google-search", "Grounding with Google Search", "web_search"],
    google_image_search: [
      "google-image-search",
      "Grounding with Google Image Search",
      "image_search",
    ],
    google_maps: ["google-maps", "Grounding with Google Maps", "maps_search"],
    web_grounding_enterprise: [
      "web-grounding-enterprise",
      "Web Grounding for Enterprise",
      "web_search",
    ],
    grounding_with_your_data: ["grounded-generation", "Grounded Generation", "grounded_generation"],
    web_search: ["claude-web-search", "Claude Web Search", "web_search"],
  } as const),
);

/** Keep only direct inference and independently metered request components. */
export function extractVertexCommercialFacts(
  models: Iterable<ParsedProviderModel>,
  sourceId: string,
): void {
  const values = [...models];
  const facts = new Map<string, MutableFact>();
  for (const model of values) {
    model.price_facts = model.price_facts.filter((rate) => {
      if (rate.meter === "cache_storage") return false;
      if (rate.meter !== "tool_call") return true;
      const service = services.get(rate.conditions.operation ?? "");
      if (service === undefined) return true;
      const fact = serviceFact(facts, model, service);
      const mapped = { ...rate, meter: service[2] };
      if (
        !fact.price_facts.some(
          (candidate) => sourcePriceFactKey(candidate) === sourcePriceFactKey(mapped),
        )
      )
        fact.price_facts.push(mapped);
      return false;
    });
    model.raw_price_facts = model.raw_price_facts.filter((raw) => {
      if (!raw.term_key.startsWith("grounding_")) return raw.impact !== "allowance";
      const service = services.get(raw.conditions.operation ?? "");
      if (service === undefined) return true;
      serviceFact(facts, model, service).raw_price_facts.push(raw);
      return false;
    });
  }
  const carrier = values.sort((left, right) => left.uid.localeCompare(right.uid))[0];
  if (carrier !== undefined && facts.size > 0)
    carrier.commercial_facts = [...facts.values()].map((item) => ({
      source_ref: sourceId,
      ...item,
    }));
}

function serviceFact(
  facts: Map<string, MutableFact>,
  model: ParsedProviderModel,
  service: readonly [string, string, SourcePriceFact["meter"]],
): MutableFact {
  const [resource, name] = service;
  const bookKey = `service:${resource}`;
  const offerKey = `request:${model.uid}`;
  const key = `${bookKey}\0${offerKey}`;
  const existing = facts.get(key);
  if (existing !== undefined) return existing;
  const fact: MutableFact = {
    book_key: bookKey,
    book_name: name,
    resource_kind: "service",
    resource_key: resource,
    model_refs: [model.uid],
    offer_key: offerKey,
    offer_name: `${name} for ${model.model_id}`,
    billing_mode: "usage",
    pricing_state: "numeric",
    price_facts: [],
    raw_price_facts: [],
  };
  facts.set(key, fact);
  return fact;
}
