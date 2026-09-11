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
      const fact = groundingFact(facts, model, operation);
      const mapped: SourcePriceFact = {
        ...rate,
        meter: operation === "google_search" ? "web_search" : "maps_search",
      };
      if (
        !fact.price_facts.some(
          (candidate) => sourcePriceFactKey(candidate) === sourcePriceFactKey(mapped),
        )
      )
        fact.price_facts.push(mapped);
      return false;
    });
    model.raw_price_facts = model.raw_price_facts.filter((raw) => {
      if (raw.term_key === "agent_usage_formula") return false;
      const operation = raw.conditions.operation;
      if (
        raw.impact !== "allowance" ||
        (operation !== "google_search" && operation !== "google_maps")
      )
        return true;
      groundingFact(facts, model, operation).raw_price_facts.push(raw);
      return false;
    });
  }
  const carrier = [...models.values()].sort((left, right) => left.uid.localeCompare(right.uid))[0];
  if (carrier !== undefined && facts.size > 0)
    carrier.commercial_facts = [...facts.values()].map((fact) => ({
      source_ref: sourceId,
      ...fact,
    }));
}

function groundingFact(
  facts: Map<string, MutableFact>,
  model: ParsedProviderModel,
  operation: "google_search" | "google_maps",
): MutableFact {
  const resource = operation.replaceAll("_", "-");
  const bookKey = `service:${resource}`;
  const offerKey = `grounding:${model.uid}`;
  const key = `${bookKey}\0${offerKey}`;
  const existing = facts.get(key);
  if (existing !== undefined) return existing;
  const search = operation === "google_search";
  const fact: MutableFact = {
    book_key: bookKey,
    book_name: search ? "Grounding with Google Search" : "Grounding with Google Maps",
    resource_kind: "service",
    resource_key: resource,
    model_refs: [model.uid],
    offer_key: offerKey,
    offer_name: `${search ? "Search" : "Maps"} grounding for ${model.model_id}`,
    billing_mode: "usage",
    pricing_state: "numeric",
    price_facts: [],
    raw_price_facts: [],
  };
  facts.set(key, fact);
  return fact;
}
