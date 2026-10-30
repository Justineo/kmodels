import { expect, it } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import { manifests } from "../src/catalog/manifests.ts";
import { baseModel } from "../src/catalog/model.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";
import { calculationExport } from "../src/catalog/pricing-calculator-export.ts";
import { createPricingCatalogEnvelope } from "../src/catalog/pricing-envelope.ts";
import { catalogSchema } from "../src/catalog/schema.ts";
import { websitePublication } from "../src/catalog/website-data.ts";
import { createCalculator, type Quantity, type Selector } from "../src/pricing/index.ts";

const at = "2026-10-30T01:00:00.000Z";
// Reduced current pricing table; the caching guide defines disjoint lifetime counts in one request.
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
  const exported = calculationExport(core, pricing);
  const calculator = createCalculator(exported);
  const offer = exported.providers[0]?.books[0]?.offers.find(
    ({ offer_key }) => offer_key === (batch ? "batch" : "sync"),
  );
  if (offer === undefined) throw new Error("Missing offer");
  const websiteOffer = websitePublication(core, pricing.data, "b".repeat(64))
    .offers.flatMap(({ offers }) => offers)
    .find(({ id }) => id === offer.id);
  if (websiteOffer === undefined) throw new Error("Missing website offer");
  return { calculator, offer, websiteOffer };
}

it.each([false, true])("prices mixed cache lifetimes once at the %s Batch boundary", (batch) => {
  const { calculator, offer, websiteOffer } = compiled(batch);
  expect(new Set(websiteOffer.rates.map(({ label }) => label))).toEqual(
    new Set([
      "Input text",
      "Output text",
      "Cache read text",
      "Cache write 30m tokens",
      "Cache write 12h tokens",
    ]),
  );
  const quantity = (signal: Quantity["signal"], value: string): Quantity => ({
    signal,
    value: { numerator: value, denominator: "1" },
  });
  const quantities = [
    ...(batch
      ? [quantity({ namespace: "kmodels", value: "uncached_input_tokens" }, "1000")]
      : [
          quantity({ namespace: "kmodels", value: "input_tokens" }, "12000"),
          quantity({ namespace: "kmodels", value: "cache_write_tokens" }, "7000"),
        ]),
    quantity({ namespace: "kmodels", value: "cached_input_tokens" }, "4000"),
    quantity(
      { namespace: "provider", provider_id: "openai", value: "cache_write_30m_tokens" },
      "3000",
    ),
    quantity(
      { namespace: "provider", provider_id: "openai", value: "cache_write_12h_tokens" },
      "4000",
    ),
    quantity({ namespace: "kmodels", value: "output_tokens" }, "500"),
  ];
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
  const calculate = (values: Quantity[]) =>
    calculator.calculate({
      evaluatedAt: at,
      components: [{ id: "request", offerRef: offer.id, quantities: values, selectors }],
    });
  const complete = calculate(quantities);
  expect(complete.status).toBe("calculated");
  expect(complete.totals).toEqual([
    expect.objectContaining({ amount: { numerator: "349", denominator: "10000" } }),
  ]);
  const missing = calculate(
    quantities.filter(({ signal }) => signal.value !== "cache_write_12h_tokens"),
  );
  expect(missing.status).toBe("partial");
  expect(JSON.stringify(missing)).toContain("cache_write_12h_tokens");
  if (batch)
    expect(() =>
      calculate([
        ...quantities,
        quantity({ namespace: "kmodels", value: "cache_write_tokens" }, "7000"),
      ]),
    ).toThrow("Quantity is not an input");
  const writes = offer.terms.filter(
    (term) => term.kind === "rate" && term.meter.value === "cache_write_text",
  );
  expect(writes).toHaveLength(2);
  expect(
    writes
      .flatMap((term) => (term.kind === "rate" ? term.variants : []))
      .every(
        (variant) => variant.charge_binding?.aggregation === (batch ? "result_item" : "request"),
      ),
  ).toBe(true);
});
