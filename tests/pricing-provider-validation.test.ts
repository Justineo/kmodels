import { describe, expect, it } from "vite-plus/test";
import {
  compilePricingSnapshot,
  readPricingCompilationSnapshot,
} from "../src/catalog/pricing-compilation.ts";
import { validatePricingCatalogEnvelopeMetadata } from "../src/catalog/pricing-envelope.ts";
import { prepareCatalogPair } from "../src/catalog/pricing-publication.ts";
import { validatePricingCatalogInParallel } from "../src/catalog/pricing-validation-parallel.ts";
import { generatedData } from "./generated-data-context.ts";

describe("provider pricing validation", () => {
  it("validates every committed provider pricing partition", async () => {
    const { catalog, pricing, pricingDataHash } = await generatedData();

    expect(() =>
      validatePricingCatalogEnvelopeMetadata(pricing, catalog, pricingDataHash),
    ).not.toThrow();
    await expect(validatePricingCatalogInParallel(pricing.data, catalog)).resolves.toBeUndefined();
  }, 90_000);

  it("keeps the adopted commercial topology for every provider", async () => {
    const { pricing } = await generatedData();
    const expected = new Map<string, string[]>([
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

    const actual = new Map(
      pricing.data.provider_snapshots.map(({ provider_id }) => {
        const books = pricing.data.books.filter((book) => book.provider_id === provider_id);
        const offers = books.flatMap((book) => book.offers);
        const terms = offers.flatMap((offer) => offer.terms);
        return [
          provider_id,
          [
            ...(books.some(({ scope }) => scope.kind === "provider_resource") ? ["resource"] : []),
            ...(books.some(({ resource_edges }) => resource_edges.length > 0) ? ["edge"] : []),
            ...(offers.some(({ relations }) => relations.length > 0) ? ["relation"] : []),
            ...(terms.some(
              (term) =>
                (term.kind === "rate" &&
                  term.variants.some(({ charge_binding }) => charge_binding !== undefined)) ||
                (term.kind === "contribution" &&
                  term.variants.some(({ charge_bindings }) => charge_bindings.length > 0)),
            )
              ? ["binding"]
              : []),
            ...(terms.some(({ kind }) => kind === "allowance") ? ["allowance"] : []),
            ...(terms.some(({ kind }) => kind === "contribution") ? ["contribution"] : []),
            ...(offers.some(({ settlement }) => settlement.length > 0) ? ["settlement"] : []),
            ...(pricing.data.model_dispositions.some(({ model_ref }) =>
              model_ref.startsWith(`${provider_id}/`),
            )
              ? ["disposition"]
              : []),
          ],
        ];
      }),
    );

    expect(actual).toEqual(expected);
  });

  it("replays every captured provider with current extractors", async () => {
    const { catalog, pricing } = await generatedData();
    const current = prepareCatalogPair(catalog, pricing);
    const snapshot = await readPricingCompilationSnapshot(current);
    if (snapshot === undefined) throw new Error("Pricing replay input is missing");

    const compiled = await compilePricingSnapshot(current, snapshot);
    expect(compiled.replayedProviders).toEqual(
      snapshot.providers.map(({ provider_id }) => provider_id),
    );
    expect([...compiled.replayedProviders, ...compiled.preservedProviders].sort()).toEqual(
      pricing.data.provider_snapshots.map(({ provider_id }) => provider_id).sort(),
    );
  }, 300_000);
});
