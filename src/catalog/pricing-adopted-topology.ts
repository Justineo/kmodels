import type { ProviderPricingPartition } from "./pricing-assembly.ts";

type TopologyFeature =
  | "resource"
  | "edge"
  | "relation"
  | "binding"
  | "allowance"
  | "contribution"
  | "settlement";

export const adoptedTopologies = new Map<string, readonly TopologyFeature[]>([
  ["amazon-bedrock", ["resource", "binding"]],
  ["amazon-sagemaker", ["resource", "binding"]],
  ["anthropic", ["resource", "binding", "allowance"]],
  ["azure", ["resource", "binding"]],
  ["cerebras", ["binding"]],
  ["cohere", ["binding"]],
  ["dashscope", ["resource", "binding"]],
  ["databricks", ["binding"]],
  ["deepseek", ["resource", "binding"]],
  ["gemini", ["resource", "relation", "binding", "allowance"]],
  ["huggingface", ["binding"]],
  ["kimi", ["resource", "relation", "binding"]],
  ["llama", []],
  ["mistral", ["resource", "binding"]],
  ["ollama", ["binding"]],
  ["openai", ["resource", "binding", "contribution"]],
  ["typesafe", ["binding"]],
  ["vercel", ["resource", "binding"]],
  ["vertex", ["resource", "relation", "binding", "allowance"]],
  ["xai", ["resource", "binding"]],
]);

function pricingTopology(pricing: ProviderPricingPartition): TopologyFeature[] {
  const offers = pricing.books.flatMap((book) => book.offers);
  const terms = offers.flatMap((offer) => offer.terms);
  const result: TopologyFeature[] = [];
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
  return result;
}

export function validateAdoptedTopology(pricing: ProviderPricingPartition): void {
  const providerId = pricing.snapshot.provider_id;
  const expected = adoptedTopologies.get(providerId);
  if (expected === undefined) throw new Error(`${providerId} has no adopted commercial topology`);
  const actual = pricingTopology(pricing);
  if (
    actual.length === expected.length &&
    actual.every((feature, index) => feature === expected[index])
  )
    return;
  throw new Error(
    `${providerId} commercial topology changed: expected ${format(expected)}, received ${format(actual)}`,
  );
}

function format(features: readonly TopologyFeature[]): string {
  return features.length === 0 ? "none" : features.join(", ");
}
