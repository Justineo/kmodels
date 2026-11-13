import { expect, it } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import { manifests } from "../src/catalog/manifests.ts";
import { baseModel } from "../src/catalog/model.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";
import { priceDataExport } from "../src/catalog/pricing-lookup-export.ts";
import { createPricingCatalogEnvelope } from "../src/catalog/pricing-envelope.ts";
import { catalogSchema } from "../src/catalog/schema.ts";
import { websitePublication } from "../src/catalog/website-data.ts";
import { createInferencePriceLookup, type Selector } from "../src/pricing/index.ts";

const at = "2026-10-30T01:00:00.000Z";
// Reduced current pricing table with conditional cache-write unit prices.
const table = [
  "Flagship models",
  "Standard",
  "| Model | Short context input | Short context output | Short context cached input | Short context 30m write | Short context 12h write | Long context input | Long context output | Long context cached input | Long context 30m write | Long context 12h write |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  "| gpt-6.1-sol | $2.00 | $10.00 | $0.10 | $2.50 | $5.00 | $4.00 | $15.00 | $0.20 | $5.00 | $10.00 |",
].join("\n");

function compiled(batch: boolean) {
  const manifest = manifests.find(({ provider }) => provider.id === "openai");
  const source = manifest?.sources.find(({ id }) => id === "openai-pricing");
  if (manifest === undefined || source === undefined) throw new Error("Missing OpenAI source");
  const provider = { ...manifest.provider, source_ids: [source.id] };
  const model = baseModel({
    providerId: "openai",
    id: "gpt-6.1-sol",
    name: "Sol",
    sourceId: source.id,
    observedAt: at,
  });
  const parsed = parseSource({
    provider,
    source,
    observedAt: at,
    catalogModels: [model],
    body: batch ? table.replace("Standard", "Batch") : table,
  });
  const partition = assembleParsedProviderPricing("openai", at, [{ source, ...parsed }], [model]);
  if (partition === undefined) throw new Error("Missing partition");
  const core = catalogSchema.parse(
    JSON.parse(
      JSON.stringify({
        catalog_version: "a".repeat(64),
        generated_at: at,
        providers: [provider],
        models: [model],
        coverage: [],
        warnings: [],
        sources: [
          {
            id: source.id,
            provider_id: "openai",
            url: source.url,
            source: [source.type],
            stability: source.stability,
            scope: "global",
            exhaustive: false,
            role: "supplement",
            field_paths: source.fields,
            observed_at: at,
            content_hash: "1".repeat(64),
            extractor_version: source.extractorVersion,
          },
        ],
      }),
    ),
  );
  const pricing = createPricingCatalogEnvelope(
    {
      books: partition.books,
      provider_vocabularies: [partition.vocabulary],
      provider_snapshots: [partition.snapshot],
      model_dispositions: partition.model_dispositions,
    },
    core,
  );
  const exported = priceDataExport(core, pricing);
  const offer = exported.providers[0]?.books[0]?.offers.find(
    ({ offer_key }) => offer_key === (batch ? "batch" : "sync"),
  );
  if (offer === undefined) throw new Error("Missing offer");
  const websiteOffer = websitePublication(core, pricing.data, "b".repeat(64))
    .offers.flatMap(({ offers }) => offers)
    .find(({ id }) => id === offer.id);
  if (websiteOffer === undefined) throw new Error("Missing website offer");
  const query = createInferencePriceLookup(exported, {
    core_catalog_version: exported.snapshot.coreCatalogVersion,
    pricing_data_version: exported.snapshot.pricingDataVersion,
    sources: [],
    rules: [
      {
        provider_id: "openai",
        model_id: model.model_id,
        model_ref: model.uid,
        offer_refs: [offer.id],
        fixed_selectors: [],
        evidence: offer.states.flatMap(({ evidence }) => evidence),
      },
    ],
  });
  return { query, offer, websiteOffer };
}

it.each([false, true])(
  "selects a cache-write unit price by TTL at the %s Batch boundary",
  (batch) => {
    const { query, offer, websiteOffer } = compiled(batch);
    expect(new Set(websiteOffer.rates.map(({ label }) => label))).toEqual(
      new Set(["Input text", "Output text", "Cache read text", "Cache write text"]),
    );
    const selectors: Selector[] = [
      {
        kind: "decimal",
        dimension: { namespace: "kmodels", value: "context_tokens" },
        value: "12000",
        unit: { factors: [{ unit: { namespace: "kmodels", value: "token" }, power: 1 }] },
      },
      ...(batch
        ? []
        : [
            {
              kind: "categorical" as const,
              dimension: { namespace: "kmodels" as const, value: "served_service_tier" as const },
              value: { namespace: "provider" as const, provider_id: "openai", value: "standard" },
            },
          ]),
    ];
    const base = { provider_id: "openai", model_id: "gpt-6.1-sol", evaluated_at: at };
    const writes = offer.terms.filter(
      (term) => term.kind === "rate" && term.meter.value === "cache_write_text",
    );
    expect(writes).toHaveLength(1);
    expect(
      query({ ...base, selectors, meter: { namespace: "kmodels", value: "input_text" } }).status,
    ).toBe("matched");
    expect(
      query({ ...base, selectors, meter: { namespace: "kmodels", value: "cache_write_text" } })
        .missing_conditions,
    ).toEqual([{ namespace: "kmodels", value: "cache_ttl_seconds" }]);
    for (const [ttl, denominator] of [
      ["1800", "400000"],
      ["43200", "200000"],
    ] as const) {
      const result = query({
        ...base,
        meter: { namespace: "kmodels", value: "cache_write_text" },
        selectors: [
          ...selectors,
          {
            kind: "decimal",
            dimension: { namespace: "kmodels", value: "cache_ttl_seconds" },
            value: ttl,
            unit: { factors: [{ unit: { namespace: "kmodels", value: "second" }, power: 1 }] },
          },
        ],
      });
      expect(result.status).toBe("matched");
      expect(result.candidates.flatMap(({ offer }) => offer.terms)).toMatchObject([
        { kind: "rate", variants: [{ price: { value: { numerator: "1", denominator } } }] },
      ]);
    }
  },
);
