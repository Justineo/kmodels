import { readFile } from "node:fs/promises";
import { expect, it } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import { manifests, type ProviderManifest, type SourceManifest } from "../src/catalog/manifests.ts";
import { baseModel } from "../src/catalog/model.ts";
import type { ParsedProviderModel } from "../src/catalog/pricing-source.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";
import { prepareCatalogPair } from "../src/catalog/pricing-publication.ts";
import { compileInferencePriceMapping } from "../src/catalog/inference-pricing-compilation.ts";
import { captureInferencePriceSources } from "../src/catalog/inference-pricing-source.ts";
import { priceDataExport } from "../src/catalog/pricing-lookup-export.ts";
import { createInferencePriceLookup } from "../src/pricing/inference.ts";
import { providerModelSchema } from "../src/catalog/schema.ts";
import { websiteModelDetail } from "../src/catalog/website-data.ts";
import { renderComponent } from "./render-component.ts";
import PricingDetails from "../src/components/PricingDetails.vue";

function configuration() {
  const manifest: ProviderManifest | undefined = manifests.find((m) => m.provider.id === "azure");
  const source: SourceManifest | undefined = manifest?.sources.find(
    (s) => s.id === "azure-claude-pricing",
  );
  if (!manifest || !source) throw new Error("Missing Azure Claude source");
  return { manifest, source };
}
const { manifest, source } = configuration();
const provider = { ...manifest.provider, source_ids: [source.id] };
const at = "2026-11-15T00:00:00.000Z";
const model = (id: string): ParsedProviderModel => ({
  ...baseModel({ providerId: "azure", id, name: id, sourceId: source.id, observedAt: at }),
  tasks: ["text_generation"],
  status: "active",
  service_families: ["Foundry Models from partners and community"],
  availability: [
    {
      deployment_type: id.startsWith("claude-opus-5-5") ? "DataZoneStandard" : "GlobalStandard",
      region: "eastus2",
    },
  ],
});
const catalog = [
  "claude-fable-5-2",
  "claude-fable-5-2-fast",
  "claude-mythos-5-2",
  "claude-mythos-5-2-fast",
  "claude-opus-5-5",
  "claude-opus-5-5-fast",
  "claude-opus-5-fast",
].map(model);
const fixture = (name: string) =>
  readFile(new URL(`./fixtures/azure/${name}.md`, import.meta.url), "utf8");
async function parse(
  change?: (pricing: string, fast: string) => { pricing: string; fast: string | undefined },
) {
  const pricing = await fixture("claude-current-pricing");
  const fast = await fixture("claude-fast-mapping");
  const edited = change?.(pricing, fast) ?? { pricing, fast };
  return parseSource({
    provider,
    source,
    observedAt: at,
    catalogModels: catalog,
    body: JSON.stringify({
      index: { url: source.url, body: edited.pricing },
      documents:
        edited.fast === undefined
          ? []
          : [
              {
                url: "https://platform.claude.com/docs/en/build-with-claude/fast-mode.md",
                body: edited.fast,
              },
            ],
    }),
  });
}

it("collects current delegated prices and three explicitly mapped Fast identities", async () => {
  const parsed = await parse();
  expect(parsed.models).toHaveLength(6);
  expect(parsed.inference_prices).toEqual([]);
  for (const id of ["claude-fable-5-2-fast", "claude-mythos-5-2-fast"]) {
    const rates = parsed.models.find((m) => m.model_id === id)?.price_facts ?? [];
    expect(
      rates
        .filter((r) => r.conditions.deployment_scope === "GlobalStandard")
        .map((r) => [r.meter, r.price, r.conditions.cache_ttl_seconds]),
    ).toEqual([
      ["input_text", "16", undefined],
      ["output_text", "80", undefined],
      ["cache_write_text", "20", 300],
      ["cache_write_text", "32", 3600],
      ["cache_read_text", "0.4", undefined],
    ]);
    expect(
      rates.every(
        (r) => r.conditions.speed === "fast" && r.conditions.deployment_scope === "GlobalStandard",
      ),
    ).toBe(true);
  }
  const opus = parsed.models.find((m) => m.model_id === "claude-opus-5-5-fast");
  expect(opus?.price_facts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        meter: "input_text",
        price: "8",
        conditions: expect.objectContaining({ deployment_scope: "GlobalStandard" }),
      }),
      expect.objectContaining({
        meter: "input_text",
        price: "8.8",
        conditions: expect.objectContaining({
          deployment_scope: "DataZoneStandard",
          inference_geo: "us",
        }),
      }),
      expect.objectContaining({
        meter: "cache_read_text",
        price: "0.44",
        conditions: expect.objectContaining({ deployment_scope: "DataZoneStandard" }),
      }),
    ]),
  );
  expect(parsed.models.some((m) => m.model_id === "claude-opus-5-fast")).toBe(false);
});

it("keeps standard tariffs on missing, malformed or duplicate Fast mapping evidence", async () => {
  for (const change of [
    (_p: string, _f: string) => undefined,
    (_p: string, f: string) =>
      f.replace("and the deployment sets the speed.", "and the request sets the speed."),
    (_p: string, f: string) => f.replace("`claude-mythos-5-2-fast`", "`claude-fable-5-2-fast`"),
  ]) {
    const parsed = await parse((pricing, fast) => ({ pricing, fast: change(pricing, fast) }));
    expect(parsed.models.map((m) => m.model_id).sort()).toEqual([
      "claude-fable-5-2",
      "claude-mythos-5-2",
      "claude-opus-5-5",
    ]);
    expect(parsed.models.every((m) => m.price_facts.length >= 5)).toBe(true);
  }
  const foreign = await fixture("claude-current-pricing");
  await expect(
    parse((_, fast) => ({
      pricing: foreign.replace(
        "same as [Model pricing](https://platform.claude.com/docs/en/about-claude/pricing#model-pricing)",
        "same as [Model pricing](https://example.test/pricing#model-pricing)",
      ),
      fast,
    })),
  ).rejects.toThrow("delegated-pricing contract drifted");
});

it("withholds only unreadable Fast inputs and unproved cache modifiers", async () => {
  const partial = await parse((pricing, fast) => ({
    pricing: pricing.replace("$16 USD / MTok | $80 USD / MTok", "Pending | $80 USD / MTok"),
    fast,
  }));
  const rates = partial.models.find((m) => m.model_id === "claude-fable-5-2-fast")?.price_facts;
  expect(rates?.map((r) => r.meter)).toEqual(["output_text"]);
  const withoutCache = await parse((pricing, fast) => ({
    pricing: pricing.replace("apply on top of fast mode pricing.", "are unavailable in fast mode."),
    fast,
  }));
  expect(
    withoutCache.models
      .find((m) => m.model_id === "claude-fable-5-2-fast")
      ?.price_facts.map((r) => r.meter),
  ).toEqual(["input_text", "output_text"]);
});

it("requires the owned unique Fast document and exact Data Zone Standard support", async () => {
  const pricing = await fixture("claude-current-pricing");
  const fast = await fixture("claude-fast-mapping");
  const document = {
    url: "https://platform.claude.com/docs/en/build-with-claude/fast-mode.md",
    body: fast,
  };
  for (const documents of [
    [{ ...document, url: document.url.replace("platform.claude.com", "example.test") }],
    [document, document],
  ]) {
    const result = parseSource({
      provider,
      source,
      observedAt: at,
      catalogModels: catalog,
      body: JSON.stringify({ index: { url: source.url, body: pricing }, documents }),
    });
    expect(result.models.some((m) => m.model_id.endsWith("-fast"))).toBe(false);
    expect(result.models).toHaveLength(3);
  }
  const result = parseSource({
    provider,
    source,
    observedAt: at,
    catalogModels: catalog.map((m) => ({
      ...m,
      availability: [{ deployment_type: "DataZoneBatch", region: "eastus2" }],
    })),
    body: JSON.stringify({ index: { url: source.url, body: pricing }, documents: [document] }),
  });
  expect(
    result.models
      .flatMap((m) => m.price_facts)
      .some((r) => r.conditions.deployment_scope === "DataZoneStandard"),
  ).toBe(false);
});

it("exports and renders Fast prices while private deployment lookup remains unreviewed", async () => {
  const parsed = await parse();
  const partition = assembleParsedProviderPricing(
    "azure",
    at,
    [{ source, ...parsed }],
    catalog,
    manifest.pricingCategoricalLabels,
  );
  if (!partition) throw new Error("Missing pricing");
  const sources = [
    {
      id: source.id,
      provider_id: "azure",
      url: source.url,
      source: [source.type],
      stability: source.stability,
      scope: "global" as const,
      exhaustive: false,
      role: "overlay" as const,
      field_paths: source.fields,
      observed_at: at,
      content_hash: "1".repeat(64),
      extractor_version: source.extractorVersion,
      pricing_evidence: source.pricingEvidence,
    },
  ];
  const core = {
    catalog_version: "a".repeat(64),
    generated_at: at,
    providers: [provider],
    models: catalog.map((m) => providerModelSchema.parse(m)),
    sources,
    coverage: [],
    warnings: [],
  };
  const prices = {
    provider_vocabularies: [partition.vocabulary],
    provider_snapshots: [partition.snapshot],
    model_dispositions: partition.model_dispositions,
    books: partition.books,
  };
  const pair = compileInferencePriceMapping(
    prepareCatalogPair(core, prices),
    captureInferencePriceSources([{ source, ...parsed }], sources),
  );
  const exported = priceDataExport(pair.catalog, pair.pricing);
  const lookup = createInferencePriceLookup(exported, pair.inference?.mapping);
  expect(lookup({ provider_id: "azure", model_id: "claude-opus-5-5-fast" }).reason).toBe(
    "unreviewed_id",
  );
  const selected = core.models.find((m) => m.model_id === "claude-fable-5-2-fast");
  if (!selected) throw new Error("Missing Fast model");
  const offer = exported.providers[0]?.books.find((b) => b.scope.model_refs.includes(selected.uid))
    ?.offers[0];
  expect(
    offer?.terms.flatMap((t) =>
      t.kind === "rate" && t.meter.value === "cache_read_text"
        ? t.variants.map((v) => v.price.value)
        : [],
    ),
  ).toEqual([{ numerator: "1", denominator: "2500000" }]);
  const html = await renderComponent(PricingDetails, {
    model: { ...selected, pricing: { outcome: "offers" } },
    provider: undefined,
    dataVersion: pair.pairId,
    detail: websiteModelDetail(prices, selected).pricing,
    loading: false,
    error: undefined,
    inferencePrices: undefined,
  });
  expect(html).toContain("USD 16 per 1M tokens");
  expect(html).toContain("USD 80 per 1M tokens");
});
