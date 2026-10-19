import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import { manifests } from "../src/catalog/manifests.ts";
import { baseModel } from "../src/catalog/model.ts";
import type { ProviderModel } from "../src/catalog/schema.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";
import { canonicalJson } from "../src/catalog/canonical-json.ts";
import { requiredUsageSignals } from "../src/catalog/pricing-calculation.ts";
import { calculationExport } from "../src/catalog/pricing-calculator-export.ts";
import { createPricingCatalogEnvelope } from "../src/catalog/pricing-envelope.ts";
import { catalogSchema } from "../src/catalog/schema.ts";
import { createCalculator, type Quantity } from "../src/pricing/index.ts";

const observedAt = "2026-10-19T00:00:00.000Z";

const liveEndpoint = {
  name: "bidiGenerateContent",
  path: "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent",
};
async function cachePricing(
  withDiscovery: boolean,
  endpoints: ProviderModel["api_endpoints"] = [],
) {
  const manifest = manifests.find(({ provider }) => provider.id === "gemini");
  const source = manifest?.sources.find(({ id }) => id === "gemini-pricing");
  if (manifest === undefined || source === undefined) throw new Error("Missing Gemini source");
  const provider = { ...manifest.provider, source_ids: manifest.sources.map(({ id }) => id) };
  const model = baseModel({
    providerId: "gemini",
    id: "cache-test",
    name: "Cache Test",
    sourceId: source.id,
    observedAt,
  });
  model.api_endpoints = endpoints;
  if (endpoints.some(({ path }) => path === liveEndpoint.path)) {
    model.tasks = ["speech_to_speech"];
  }
  // Synthetic rate controls use the reviewed public table layout and independent accounting fixture.
  const body = `<div class="devsite-article-body"><div class="models-section"><div class="heading-group"><code>cache-test</code></div></div><section><h3>Standard</h3><table class="pricing-table"><thead><tr><th></th><th>Free Tier</th><th>Paid Tier, per 1M tokens in USD</th></tr></thead><tbody><tr><td>Input price</td><td>Not available</td><td>$2.00 (image, audio, video)</td></tr><tr><td>Context caching price</td><td>Not available</td><td>$0.20 (image, audio, video)</td></tr></tbody></table></section></div>`;
  const parsed = parseSource({
    provider,
    source,
    observedAt,
    catalogModels: [model],
    body: JSON.stringify({
      index: { url: source.url, body },
      documents: withDiscovery
        ? [
            {
              url: "https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta",
              body: await readFile(
                new URL("./fixtures/gemini/discovery.json", import.meta.url),
                "utf8",
              ),
            },
            {
              url: "https://ai.google.dev/api/interactions-api",
              body: await readFile(
                new URL("./fixtures/gemini/interactions-fields.html", import.meta.url),
                "utf8",
              ),
            },
          ]
        : [],
    }),
  });
  expect(parsed.models[0]?.price_facts.map(({ meter }) => meter)).toEqual(
    expect.arrayContaining([
      "input_audio",
      "input_image",
      "input_video",
      "cache_read_audio",
      "cache_read_image",
      "cache_read_video",
    ]),
  );
  const partition = assembleParsedProviderPricing(
    "gemini",
    observedAt,
    [{ source, ...parsed }],
    [model],
  );
  if (partition === undefined) throw new Error("Missing Gemini price book");
  const coreData = {
    catalog_version: "a".repeat(64),
    generated_at: observedAt,
    coverage: [],
    warnings: [],
    providers: [provider],
    models: parsed.models,
    sources: [
      {
        id: source.id,
        provider_id: "gemini",
        url: source.url,
        source: ["website"],
        stability: source.stability,
        scope: source.scope ?? "global",
        exhaustive: false,
        role: "overlay",
        field_paths: source.fields,
        observed_at: observedAt,
        content_hash: "1".repeat(64),
        extractor_version: source.extractorVersion,
      },
    ],
  };
  const core = catalogSchema.parse(JSON.parse(JSON.stringify(coreData)));
  const exported = calculationExport(
    core,
    createPricingCatalogEnvelope(
      {
        provider_vocabularies: [partition.vocabulary],
        provider_snapshots: [partition.snapshot],
        model_dispositions: partition.model_dispositions,
        books: partition.books,
      },
      core,
    ),
  );
  const offer = exported.providers[0]?.books[0]?.offers.find(
    ({ offer_key }) => offer_key === "sync",
  );
  if (offer === undefined) throw new Error("Missing online offer");
  return { calculator: createCalculator(exported), offer };
}

describe("Gemini multimodal cache calculations", () => {
  it("does not describe a BidiGenerateContent response with GenerateContent counters", async () => {
    const { offer } = await cachePricing(true, [liveEndpoint]);
    const variants = offer.terms.flatMap((term) => (term.kind === "rate" ? term.variants : []));
    expect(variants).toHaveLength(6);
    expect(variants.every((v) => v.charge_binding !== undefined)).toBe(true);
    expect(
      variants.flatMap(
        (v) => v.charge_binding?.quantity_methods?.flatMap((m) => m.input_sources ?? []) ?? [],
      ),
    ).toEqual([]);
    expect(variants.flatMap((v) => v.selector_sources ?? [])).toEqual([]);
  });
  it("keeps a separately documented GenerateContent route on a model that also supports Live", async () => {
    const { offer } = await cachePricing(true, [
      liveEndpoint,
      { name: "generateContent", path: "/v1beta/models/cache-test:generateContent" },
    ]);
    const inputs = offer.terms.flatMap((term) =>
      term.kind === "rate"
        ? term.variants.flatMap(
            (v) => v.charge_binding?.quantity_methods?.flatMap((m) => m.input_sources ?? []) ?? [],
          )
        : [],
    );
    expect(inputs.some(({ locator }) => locator.value.startsWith("GenerateContentResponse."))).toBe(
      true,
    );
    expect(inputs.some(({ locator }) => locator.value.startsWith("Interaction."))).toBe(false);
  });
  it.each([false, true])(
    "requires exact Interactions endpoint support before adding its modality counters (supported=%s)",
    async (supported) => {
      const { offer } = await cachePricing(
        true,
        supported ? [{ name: "interactions.create", path: "/v1beta/interactions" }] : [],
      );
      const inputs = offer.terms.flatMap((term) =>
        term.kind === "rate"
          ? term.variants.flatMap(
              (v) =>
                v.charge_binding?.quantity_methods?.flatMap((m) => m.input_sources ?? []) ?? [],
            )
          : [],
      );
      expect(inputs.some(({ locator }) => locator.value.startsWith("Interaction."))).toBe(
        supported,
      );
      expect(
        inputs.some(({ locator }) => locator.value.startsWith("GenerateContentResponse.")),
      ).toBe(true);
    },
  );
  it.each(["audio", "image", "video", "document"])(
    "retains and calculates the %s cache partition",
    async (modality) => {
      const { calculator, offer } = await cachePricing(true);
      const values: Readonly<Record<string, string>> = {
        [`reported_prompt_${modality}_tokens`]: "1000000",
        [`reported_cached_${modality}_tokens`]: "1000000",
        ...(modality === "image" || modality === "document"
          ? {}
          : { [`cached_input_${modality}_tokens`]: "1000000" }),
      };
      const quantities = new Map<string, Quantity>();
      for (const term of offer.terms) {
        if (term.kind !== "rate") continue;
        for (const { charge_binding } of term.variants) {
          expect(charge_binding).toBeDefined();
          if (charge_binding === undefined) throw new Error("Missing cache/input binding");
          for (const signal of requiredUsageSignals(charge_binding))
            quantities.set(canonicalJson(signal), {
              signal,
              value: { numerator: values[signal.value] ?? "0", denominator: "1" },
            });
        }
      }
      const result = calculator.calculate({
        evaluatedAt: observedAt,
        components: [
          {
            id: "cached",
            offerRef: offer.id,
            quantities: [...quantities.values()],
            selectors: [
              {
                kind: "categorical",
                dimension: { namespace: "kmodels", value: "account_eligibility" },
                value: { namespace: "provider", provider_id: "gemini", value: "paid_tier" },
              },
              {
                kind: "categorical",
                dimension: { namespace: "kmodels", value: "served_service_tier" },
                value: { namespace: "provider", provider_id: "gemini", value: "standard" },
              },
            ],
          },
        ],
      });
      expect(result).toMatchObject({
        status: "calculated",
        totals: [
          {
            denomination: { kind: "fiat", currency: "USD" },
            amount: { numerator: "1", denominator: "5" },
          },
        ],
      });
      expect(result.charges.filter(({ amount }) => amount.numerator !== "0")).toHaveLength(1);
    },
  );

  it("retains semantic bindings when the optional accounting companion is absent", async () => {
    const { offer } = await cachePricing(false);
    const caches = offer.terms.filter(
      (term) => term.kind === "rate" && term.meter.value.startsWith("cache_read_"),
    );
    expect(caches).toHaveLength(3);
    for (const term of caches) {
      if (term.kind !== "rate") continue;
      expect(term.variants.length).toBeGreaterThan(0);
      expect(term.variants.every(({ charge_binding }) => charge_binding !== undefined)).toBe(true);
    }
  });
});
