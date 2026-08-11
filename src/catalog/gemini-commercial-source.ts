import type {
  ParsedProviderModel,
  SourceCommercialPricingFact,
  SourcePriceFact,
  SourceRawPricingFact,
} from "./pricing-source.ts";
import { sourcePriceFactKey, sourceRawPricingFactKey } from "./pricing-source.ts";

interface CommercialContext {
  agentIds: string[];
}

type MutableFact = Omit<SourceCommercialPricingFact, "source_ref">;

export function extractGeminiCommercialFacts(
  models: Map<string, ParsedProviderModel>,
  sourceId: string,
  context: CommercialContext,
): void {
  const facts = new Map<string, MutableFact>();
  for (const model of models.values()) {
    model.price_facts = model.price_facts.filter((rate) => {
      if (rate.meter === "tool_call") {
        return !addGroundingRate(facts, model, rate);
      }
      if (rate.meter === "cache_storage") {
        addRate(
          facts,
          resource({
            bookKey: "service:explicit-cache-storage",
            bookName: "Explicit context cache storage",
            resourceKey: "explicit-cache-storage",
            model,
            offerKey: `storage:${model.uid}`,
            offerName: `Explicit cache storage for ${model.model_id}`,
          }),
          rate,
        );
        return false;
      }
      return true;
    });
    model.raw_price_facts = model.raw_price_facts.filter((raw) => {
      const groundingOperation =
        raw.conditions.operation ??
        (raw.term_key === "google_search_allowance"
          ? "google_search"
          : raw.term_key === "google_maps_allowance"
            ? "google_maps"
            : undefined);
      if (raw.term_key.endsWith("_allowance") && groundingOperation !== undefined) {
        addRaw(facts, groundingAllowance(model, groundingOperation), raw);
        return false;
      }
      if (raw.term_key === "agent_usage_formula") {
        addRaw(
          facts,
          resource({
            bookKey: `service:agent:${model.model_id}`,
            bookName: `Agent execution for ${model.model_id}`,
            resourceKey: `agent:${model.model_id}`,
            model,
            offerKey: "execution",
            offerName: "Managed agent execution",
          }),
          raw,
        );
        return false;
      }
      return true;
    });
  }
  addFileSearchFacts(facts, models, sourceId);
  addAgentEnvironmentFact(facts, models, sourceId, context);
  const carrier = [...models.values()].sort((left, right) => left.uid.localeCompare(right.uid))[0];
  if (carrier !== undefined && facts.size > 0)
    carrier.commercial_facts = [...facts.values()].map((fact) => ({
      source_ref: sourceId,
      ...fact,
    }));
}

function addAgentEnvironmentFact(
  facts: Map<string, MutableFact>,
  models: ReadonlyMap<string, ParsedProviderModel>,
  sourceId: string,
  context: CommercialContext,
): void {
  const modelRefs = context.agentIds.flatMap((id) => {
    const model = models.get(id);
    return model === undefined ? [] : [model.uid];
  });
  addRaw(
    facts,
    {
      book_key: "service:managed-agent-environment",
      book_name: "Managed agent environment",
      resource_kind: "service",
      resource_key: "managed-agent-environment",
      model_refs: modelRefs,
      offer_key: "preview-environment",
      offer_name: "Preview environment compute",
      billing_mode: "usage",
      pricing_state: "numeric",
      price_facts: [],
      raw_price_facts: [],
    },
    policyRaw(
      "preview-environment-compute",
      "base_price",
      "unknown_applicability",
      "Environment compute (CPU, memory, sandbox execution) is not billed during the preview period",
      sourceId,
    ),
  );
}

function addGroundingRate(
  facts: Map<string, MutableFact>,
  model: ParsedProviderModel,
  rate: SourcePriceFact,
): boolean {
  const operation = rate.conditions.operation;
  if (operation !== "google_search" && operation !== "google_maps") return false;
  const search = operation === "google_search";
  addRate(
    facts,
    resource({
      bookKey: `service:${operation.replaceAll("_", "-")}`,
      bookName: search ? "Grounding with Google Search" : "Grounding with Google Maps",
      resourceKey: operation.replaceAll("_", "-"),
      model,
      offerKey: `grounding:${model.uid}`,
      offerName: `${search ? "Search" : "Maps"} grounding for ${model.model_id}`,
    }),
    { ...rate, meter: search ? "web_search" : "maps_search" },
  );
  return true;
}

function groundingAllowance(model: ParsedProviderModel, operation: string): MutableFact {
  const search = operation === "google_search";
  return {
    ...resource({
      bookKey: `service:${operation.replaceAll("_", "-")}`,
      bookName: search ? "Grounding with Google Search" : "Grounding with Google Maps",
      resourceKey: operation.replaceAll("_", "-"),
      model,
      offerKey: "shared-allowance",
      offerName: `${search ? "Search" : "Maps"} grounding allowance`,
    }),
    pricing_state: "included",
  };
}

function addFileSearchFacts(
  facts: Map<string, MutableFact>,
  models: ReadonlyMap<string, ParsedProviderModel>,
  sourceId: string,
): void {
  const embeddingRefs = ["gemini-embedding-001", "gemini-embedding-2"].flatMap((id) => {
    const model = models.get(id);
    return model === undefined ? [] : [model.uid];
  });
  const generationRefs = [...models.values()]
    .filter((model) => model.tasks.includes("text_generation"))
    .map((model) => model.uid);
  for (const [offerKey, offerName] of [
    ["storage", "File Search storage"],
    ["query-embedding", "File Search query-time embedding"],
  ] as const)
    addFact(facts, {
      book_key: "account:file-search-store",
      book_name: "File Search store",
      resource_kind: "account_resource_template",
      resource_key: "file-search-store",
      model_refs: [],
      offer_key: offerKey,
      offer_name: offerName,
      billing_mode: "usage",
      pricing_state: "free",
      price_facts: [],
      raw_price_facts: [],
    });
  addRaw(
    facts,
    {
      book_key: "account:file-search-store",
      book_name: "File Search store",
      resource_kind: "account_resource_template",
      resource_key: "file-search-store",
      model_refs: embeddingRefs,
      offer_key: "indexing",
      offer_name: "File Search indexing",
      billing_mode: "usage",
      pricing_state: "numeric",
      price_facts: [],
      raw_price_facts: [],
    },
    policyRaw(
      "file-search-indexing",
      "base_price",
      "requires_usage_aggregation",
      "charged for embeddings at indexing time based on existing embeddings pricing",
      sourceId,
    ),
  );
  addRaw(
    facts,
    {
      book_key: "account:file-search-store",
      book_name: "File Search store",
      resource_kind: "account_resource_template",
      resource_key: "file-search-store",
      model_refs: generationRefs,
      offer_key: "retrieval",
      offer_name: "File Search retrieval",
      billing_mode: "usage",
      pricing_state: "numeric",
      price_facts: [],
      raw_price_facts: [],
    },
    policyRaw(
      "file-search-retrieved-tokens",
      "base_price",
      "requires_usage_aggregation",
      "Retrieved document tokens are charged as regular context tokens",
      sourceId,
    ),
  );
}

function policyRaw(
  termKey: string,
  impact: SourceRawPricingFact["impact"],
  reason: SourceRawPricingFact["reason"],
  fragment: string,
  sourceRef: string,
): SourceRawPricingFact {
  return {
    term_key: termKey,
    impact,
    reason,
    conditions: {},
    source_ref: sourceRef,
    raw: { fragment },
  };
}

function resource(input: {
  bookKey: string;
  bookName: string;
  resourceKey: string;
  model: ParsedProviderModel;
  offerKey: string;
  offerName: string;
}): MutableFact {
  return {
    book_key: input.bookKey,
    book_name: input.bookName,
    resource_kind: "service",
    resource_key: input.resourceKey,
    model_refs: [input.model.uid],
    offer_key: input.offerKey,
    offer_name: input.offerName,
    billing_mode: "usage",
    pricing_state: "numeric",
    price_facts: [],
    raw_price_facts: [],
  };
}

function addRate(facts: Map<string, MutableFact>, fact: MutableFact, rate: SourcePriceFact): void {
  const current = addFact(facts, fact);
  if (
    !current.price_facts.some(
      (candidate) => sourcePriceFactKey(candidate) === sourcePriceFactKey(rate),
    )
  )
    current.price_facts.push(rate);
}

function addRaw(
  facts: Map<string, MutableFact>,
  fact: MutableFact,
  raw: SourceRawPricingFact,
): void {
  const current = addFact(facts, fact);
  if (
    !current.raw_price_facts.some(
      (candidate) => sourceRawPricingFactKey(candidate) === sourceRawPricingFactKey(raw),
    )
  )
    current.raw_price_facts.push(raw);
}

function addFact(facts: Map<string, MutableFact>, fact: MutableFact): MutableFact {
  const key = `${fact.book_key}\0${fact.offer_key}`;
  const current = facts.get(key);
  if (current === undefined) {
    facts.set(key, fact);
    return fact;
  }
  current.model_refs = [...new Set([...current.model_refs, ...fact.model_refs])].sort();
  return current;
}
