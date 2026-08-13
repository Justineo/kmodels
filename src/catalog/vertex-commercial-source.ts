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
  bindingAvailable: boolean,
): void {
  const values = [...models];
  const facts = new Map<string, MutableFact>();
  for (const model of values) {
    model.price_facts = model.price_facts.filter((rate) => {
      if (rate.meter === "cache_storage") return false;
      if (rate.meter !== "tool_call") return true;
      const service = services.get(rate.conditions.operation ?? "");
      if (service === undefined) return true;
      addRate(facts, fact(model, service), { ...rate, meter: service[2] });
      return false;
    });
    model.raw_price_facts = model.raw_price_facts.filter(
      ({ impact, term_key }) => impact !== "allowance" && !term_key.startsWith("grounding_"),
    );
    if (!bindingAvailable && model.price_facts.length > 0)
      model.raw_price_facts.push(bindingUnavailable(sourceId));
  }
  const carrier = values.sort((left, right) => left.uid.localeCompare(right.uid))[0];
  if (carrier !== undefined && facts.size > 0)
    carrier.commercial_facts = [...facts.values()].map((item) => ({
      source_ref: sourceId,
      ...item,
      raw_price_facts: bindingAvailable
        ? item.raw_price_facts
        : [...item.raw_price_facts, bindingUnavailable(sourceId)],
    }));
}

function fact(
  model: ParsedProviderModel,
  service: readonly [string, string, SourcePriceFact["meter"]],
): MutableFact {
  const [key, name] = service;
  return {
    book_key: `service:${key}`,
    book_name: name,
    resource_kind: "service",
    resource_key: key,
    model_refs: [model.uid],
    offer_key: `request:${model.uid}`,
    offer_name: `${name} for ${model.model_id}`,
    billing_mode: "usage",
    pricing_state: "numeric",
    price_facts: [],
    raw_price_facts: [],
  };
}

function bindingUnavailable(sourceRef: string) {
  return {
    source_ref: sourceRef,
    term_key: "charge_binding_unavailable",
    impact: "informational" as const,
    reason: "unknown_applicability" as const,
    conditions: {},
    raw: { fragment: "Vertex response usage schema was not verified during this refresh" },
  };
}

function addRate(facts: Map<string, MutableFact>, next: MutableFact, rate: SourcePriceFact): void {
  const key = `${next.book_key}\0${next.offer_key}`;
  const current = facts.get(key);
  if (current === undefined) {
    next.price_facts.push(rate);
    facts.set(key, next);
    return;
  }
  if (
    !current.price_facts.some(
      (candidate) => sourcePriceFactKey(candidate) === sourcePriceFactKey(rate),
    )
  )
    current.price_facts.push(rate);
}
