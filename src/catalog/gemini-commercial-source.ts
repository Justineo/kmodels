import type {
  ParsedProviderModel,
  SourceCommercialPricingFact,
  SourcePriceFact,
} from "./pricing-source.ts";
import { sourcePriceFactKey } from "./pricing-source.ts";

type MutableFact = Omit<SourceCommercialPricingFact, "source_ref">;

/**
 * Gemini publishes Search and Maps as independently metered request components.
 * Everything else stays on the model offer or is outside the gateway price-book boundary.
 */
export function extractGeminiCommercialFacts(
  models: Map<string, ParsedProviderModel>,
  sourceId: string,
): void {
  const facts = new Map<string, MutableFact>();
  for (const model of models.values()) {
    model.price_facts = model.price_facts.filter((rate) => {
      if (rate.meter === "cache_storage") return false;
      if (rate.meter !== "tool_call") return true;
      const operation = rate.conditions.operation;
      if (operation !== "google_search" && operation !== "google_maps") return true;
      addRate(facts, groundingFact(model, operation), {
        ...rate,
        meter: operation === "google_search" ? "web_search" : "maps_search",
      });
      return false;
    });
    model.raw_price_facts = model.raw_price_facts.filter(
      ({ impact, term_key }) => impact !== "allowance" && term_key !== "agent_usage_formula",
    );
  }
  const carrier = [...models.values()].sort((left, right) => left.uid.localeCompare(right.uid))[0];
  if (carrier !== undefined && facts.size > 0)
    carrier.commercial_facts = [...facts.values()].map((fact) => ({
      source_ref: sourceId,
      ...fact,
      raw_price_facts: fact.raw_price_facts,
    }));
}

function groundingFact(
  model: ParsedProviderModel,
  operation: "google_search" | "google_maps",
): MutableFact {
  const search = operation === "google_search";
  return {
    book_key: `service:${operation.replaceAll("_", "-")}`,
    book_name: search ? "Grounding with Google Search" : "Grounding with Google Maps",
    resource_kind: "service",
    resource_key: operation.replaceAll("_", "-"),
    model_refs: [model.uid],
    offer_key: `grounding:${model.uid}`,
    offer_name: `${search ? "Search" : "Maps"} grounding for ${model.model_id}`,
    billing_mode: "usage",
    pricing_state: "numeric",
    price_facts: [],
    raw_price_facts: [],
  };
}

function addRate(facts: Map<string, MutableFact>, fact: MutableFact, rate: SourcePriceFact): void {
  const key = `${fact.book_key}\0${fact.offer_key}`;
  const current = facts.get(key);
  if (current === undefined) {
    fact.price_facts.push(rate);
    facts.set(key, fact);
    return;
  }
  if (
    !current.price_facts.some(
      (candidate) => sourcePriceFactKey(candidate) === sourcePriceFactKey(rate),
    )
  )
    current.price_facts.push(rate);
}
