import type {
  ParsedProviderModel,
  SourceCommercialPricingFact,
  SourcePriceFact,
} from "./pricing-source.ts";
import type { GeminiGroundingClaim } from "./gemini-grounding-allowances.ts";

type MutableFact = Omit<SourceCommercialPricingFact, "source_ref">;

/**
 * Search, Maps and explicit cache storage are independently metered services.
 * Storage retains its token-time unit instead of becoming a generation charge.
 */
export function extractGeminiCommercialFacts(
  models: Map<string, ParsedProviderModel>,
  sourceId: string,
  claims: readonly GeminiGroundingClaim[],
): SourceCommercialPricingFact[] {
  const facts = new Map<string, MutableFact>();
  for (const model of models.values()) {
    model.price_facts = model.price_facts.filter((rate) => {
      if (rate.meter === "cache_storage") {
        serviceFact(facts, model, "cache_storage").price_facts.push(rate);
        return false;
      }
      if (rate.meter !== "tool_call") return true;
      const operation =
        rate.conditions.operation === "google_web_image_search"
          ? "google_search"
          : rate.conditions.operation;
      if (operation !== "google_search" && operation !== "google_maps") return true;
      const fact = serviceFact(facts, model, operation);
      const mapped: SourcePriceFact = {
        ...rate,
        meter: operation === "google_search" ? "web_search" : "maps_search",
      };
      fact.price_facts.push(mapped);
      return false;
    });
    model.raw_price_facts = model.raw_price_facts.filter((raw) => {
      if (raw.raw.meter === "cache_storage") {
        serviceFact(facts, model, "cache_storage").raw_price_facts.push(raw);
        return false;
      }
      if (raw.term_key === "agent_usage_formula") return false;
      const operation =
        raw.conditions.operation === "google_web_image_search"
          ? "google_search"
          : raw.conditions.operation;
      if (operation !== "google_search" && operation !== "google_maps") return true;
      serviceFact(facts, model, operation).raw_price_facts.push(raw);
      return false;
    });
  }
  const byUid = new Map([...models.values()].map((model) => [model.uid, model]));
  for (const claim of claims) {
    const model = byUid.get(claim.model_ref);
    if (model === undefined) throw new Error("Grounding claim lost its catalog identity");
    serviceFact(facts, model, claim.operation);
  }
  return [...facts.values()].map((fact) => ({ source_ref: sourceId, ...fact }));
}

function serviceFact(
  facts: Map<string, MutableFact>,
  model: ParsedProviderModel,
  operation: "google_search" | "google_maps" | "cache_storage",
): MutableFact {
  const storage = operation === "cache_storage";
  const resource = storage ? "context-cache-storage" : operation.replaceAll("_", "-");
  const bookKey = `service:${resource}`;
  const offerKey = `${storage ? "storage" : "grounding"}:${model.uid}`;
  const key = `${bookKey}\0${offerKey}`;
  const existing = facts.get(key);
  if (existing !== undefined) return existing;
  const search = operation === "google_search";
  const fact: MutableFact = {
    book_key: bookKey,
    book_name: storage
      ? "Explicit context cache storage"
      : search
        ? "Grounding with Google Search"
        : "Grounding with Google Maps",
    resource_kind: "service",
    resource_key: resource,
    model_refs: [model.uid],
    offer_key: offerKey,
    offer_name: storage
      ? `Cache storage for ${model.model_id}`
      : `${search ? "Search" : "Maps"} grounding for ${model.model_id}`,
    billing_mode: "usage",
    pricing_state: "numeric",
    price_facts: [],
    raw_price_facts: [],
  };
  facts.set(key, fact);
  return fact;
}
