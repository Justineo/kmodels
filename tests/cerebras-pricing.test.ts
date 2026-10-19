import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import { applyGroups } from "../src/catalog/collector.ts";
import { manifests, type ProviderManifest } from "../src/catalog/manifests.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";
import { calculationExport } from "../src/catalog/pricing-calculator-export.ts";
import { createPricingCatalogEnvelope } from "../src/catalog/pricing-envelope.ts";
import { catalogSchema } from "../src/catalog/schema.ts";
import { websitePublication } from "../src/catalog/website-data.ts";
import { parseWebsiteCatalog } from "../src/catalog/website-runtime.ts";
import { createCalculator } from "../src/pricing/index.ts";

const fixture = (name: string) =>
  readFile(new URL(`./fixtures/cerebras/${name}`, import.meta.url), "utf8");
const observedAt = "2026-10-19T00:00:00.000Z";

async function compiled(publicPrices: boolean) {
  const manifest: ProviderManifest | undefined = manifests.find(
    ({ provider }) => provider.id === "cerebras",
  );
  if (manifest === undefined) throw new Error("Missing Cerebras manifest");
  const provider = { ...manifest.provider, source_ids: manifest.sources.map(({ id }) => id) };
  const catalog = manifest.sources.find(({ id }) => id === "cerebras-catalog");
  const publicSource = manifest.sources.find(({ id }) => id === "cerebras-models");
  if (catalog === undefined || publicSource === undefined) throw new Error("Missing sources");
  const documents = [
    ["models/openai-oss", "gpt.md"],
    ["models/gemma-4-31b", "gemma.md"],
    ["models/zai-glm-47", "glm.md"],
    ["capabilities/prompt-caching", "cache.md"],
    ["api-reference/chat-completions", "chat-completions.md"],
    ["api-reference/completions", "completions.md"],
    ["capabilities/batch", "batch.md"],
    [
      "https://raw.githubusercontent.com/Cerebras/cerebras-cloud-sdk-python/main/README",
      "sdk-readme.md",
    ],
  ] as const;
  const catalogResult = parseSource({
    provider,
    source: catalog,
    observedAt,
    body: JSON.stringify({
      index: { url: catalog.url, body: await fixture("catalog.md") },
      documents: await Promise.all(
        documents.map(async ([path, name]) => ({
          url: path.startsWith("https:")
            ? `${path}.md`
            : `https://inference-docs.cerebras.ai/${path}.md`,
          body: (await fixture(name)).replace('inputPrice: "$0.99"', 'inputPrice: "$2.15"'),
        })),
      ),
    }),
  });
  const groups = [{ source: catalog, ...catalogResult }];
  if (publicPrices)
    groups.push({
      source: publicSource,
      ...parseSource({
        provider,
        source: publicSource,
        observedAt,
        body: await fixture("public.json"),
      }),
    });
  const models = applyGroups([], groups, true);
  const partition = assembleParsedProviderPricing("cerebras", observedAt, groups, models);
  if (partition === undefined) throw new Error("Missing pricing");
  const core = catalogSchema.parse(
    JSON.parse(
      JSON.stringify({
        catalog_version: "a".repeat(64),
        generated_at: observedAt,
        providers: [provider],
        models,
        coverage: [],
        warnings: [],
        sources: groups.map(({ source }) => ({
          id: source.id,
          provider_id: "cerebras",
          url: source.url,
          source: [source.type],
          stability: source.stability,
          scope: "global",
          role: "catalog",
          exhaustive: true,
          field_paths: source.fields,
          pricing_evidence: source.pricingEvidence,
          observed_at: observedAt,
          extractor_version: source.extractorVersion,
          content_hash: "1".repeat(64),
        })),
      }),
    ),
  );
  const pricing = {
    books: partition.books,
    provider_snapshots: [partition.snapshot],
    provider_vocabularies: [partition.vocabulary],
    model_dispositions: partition.model_dispositions,
  };
  const exported = calculationExport(core, createPricingCatalogEnvelope(pricing, core));
  const offer = exported.providers[0]?.books.find(({ scope }) =>
    scope.model_refs.includes("cerebras/gemma-4-31b"),
  )?.offers[0];
  if (offer === undefined) throw new Error("Missing Gemma offer");
  return { offer, calculator: createCalculator(exported), core, pricing };
}

describe("Cerebras standard input pricing", () => {
  it.each([true, false])(
    "charges the whole prompt at the selected input rate (public=%s)",
    async (publicPrices) => {
      const { offer, calculator, core, pricing } = await compiled(publicPrices);
      expect(
        offer.terms.flatMap((term) => (term.kind === "rate" ? [term.meter.value] : [])),
      ).toEqual(["input_text", "output_text"]);
      const input = offer.terms.find(
        (term) => term.kind === "rate" && term.meter.value === "input_text",
      );
      expect(
        input?.kind === "rate" ? input.variants[0]?.charge_binding?.signal : undefined,
      ).toEqual({
        namespace: "kmodels",
        value: "input_tokens",
      });
      expect(
        input?.kind === "rate"
          ? input.variants[0]?.charge_binding?.quantity_methods?.flatMap(
              ({ input_sources }) => input_sources ?? [],
            )
          : undefined,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            channel: "response",
            locator: { kind: "json_pointer", value: "/usage/prompt_tokens" },
          }),
          expect.objectContaining({
            channel: "stream_event",
            availability: "terminal_only",
            locator: { kind: "json_pointer", value: "/usage/prompt_tokens" },
          }),
        ]),
      );
      for (const cached of [undefined, 0, 900000, 1000000]) {
        const nativeUsage = {
          prompt_tokens: 1000000,
          completion_tokens: 0,
          ...(cached === undefined ? {} : { prompt_tokens_details: { cached_tokens: cached } }),
        };
        const result = calculator.calculate({
          evaluatedAt: observedAt,
          components: [
            {
              id: "request",
              offerRef: offer.id,
              quantities: [
                {
                  signal: { namespace: "kmodels", value: "input_tokens" },
                  value: { numerator: String(nativeUsage.prompt_tokens), denominator: "1" },
                },
                {
                  signal: { namespace: "kmodels", value: "output_tokens" },
                  value: { numerator: String(nativeUsage.completion_tokens), denominator: "1" },
                },
              ],
            },
          ],
        });
        expect(result.status).toBe("calculated");
        expect(result.totals).toEqual([
          {
            denomination: { kind: "fiat", currency: "USD" },
            amount: {
              numerator: publicPrices ? "99" : "43",
              denominator: publicPrices ? "100" : "20",
            },
          },
        ]);
      }
      const website = websitePublication(core, pricing, "b".repeat(64));
      const summary = parseWebsiteCatalog(website.catalog, website.pricing).models.find(
        ({ uid }) => uid === "cerebras/gemma-4-31b",
      )?.pricing;
      expect(summary?.input?.amount).toBe(publicPrices ? "$0.99" : "$2.15");
      expect(summary?.cache).toBeUndefined();
      if (publicPrices)
        expect(input?.kind === "rate" ? input.raw_variants : undefined).toEqual([
          expect.objectContaining({
            impact: "informational",
            reason: "superseded_value",
            resolution_policy: "cerebras_public_api_over_model_card",
          }),
        ]);
      expect(
        pricing.books
          .flatMap(({ offers }) => offers)
          .flatMap(({ terms }) => terms)
          .some((term) => term.kind === "rate" && term.meter.value === "cache_read_text"),
      ).toBe(false);
    },
  );
});
