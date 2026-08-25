import type { ProviderPricingPartition } from "./pricing-assembly.ts";

export type AdoptedPricingTopologyFeature =
  | "resource"
  | "edge"
  | "relation"
  | "binding"
  | "allowance"
  | "contribution"
  | "settlement"
  | "disposition";

const adoptedTopology = new Map<string, readonly AdoptedPricingTopologyFeature[]>([
  ["amazon-bedrock", ["resource", "binding"]],
  ["anthropic", ["resource", "binding", "allowance"]],
  ["azure", ["resource", "binding"]],
  ["cerebras", ["resource", "binding"]],
  ["cohere", ["binding", "disposition"]],
  ["dashscope", ["resource", "binding", "disposition"]],
  ["databricks", ["binding"]],
  ["deepseek", ["binding"]],
  ["gemini", ["resource", "relation", "binding"]],
  ["huggingface", ["binding"]],
  ["kimi", ["resource", "relation", "binding", "settlement"]],
  ["llama", []],
  ["mistral", ["resource", "binding", "disposition"]],
  ["ollama", ["binding"]],
  ["openai", ["resource", "binding", "disposition"]],
  ["vercel", ["resource", "binding"]],
  ["vertex", ["resource", "relation", "binding"]],
  ["xai", ["resource", "binding"]],
]);

export function providerPricingTopology(
  pricing: ProviderPricingPartition,
): AdoptedPricingTopologyFeature[] {
  const offers = pricing.books.flatMap((book) => book.offers);
  const terms = offers.flatMap((offer) => offer.terms);
  const result: AdoptedPricingTopologyFeature[] = [];
  if (pricing.books.some(({ scope }) => scope.kind === "provider_resource"))
    result.push("resource");
  if (pricing.books.some(({ resource_edges }) => resource_edges.length > 0)) result.push("edge");
  if (offers.some(({ relations }) => relations.length > 0)) result.push("relation");
  if (
    terms.some(
      (term) =>
        (term.kind === "rate" &&
          term.variants.some(({ charge_binding }) => charge_binding !== undefined)) ||
        (term.kind === "contribution" &&
          term.variants.some(({ charge_bindings }) => charge_bindings.length > 0)),
    )
  )
    result.push("binding");
  if (terms.some(({ kind }) => kind === "allowance")) result.push("allowance");
  if (terms.some(({ kind }) => kind === "contribution")) result.push("contribution");
  if (offers.some(({ settlement }) => settlement.length > 0)) result.push("settlement");
  if (pricing.model_dispositions.length > 0) result.push("disposition");
  return result;
}

export function validateAdoptedProviderPricingTopology(pricing: ProviderPricingPartition): void {
  const providerId = pricing.snapshot.provider_id;
  const expected = adoptedTopology.get(providerId);
  if (expected === undefined) throw new Error(`${providerId} has no adopted commercial topology`);
  const actual = providerPricingTopology(pricing);
  if (
    actual.length === expected.length &&
    actual.every((feature, index) => feature === expected[index])
  )
    return;
  throw new Error(
    `${providerId} commercial topology changed: expected ${format(expected)}, received ${format(actual)}`,
  );
}

function format(features: readonly AdoptedPricingTopologyFeature[]): string {
  return features.length === 0 ? "none" : features.join(", ");
}
