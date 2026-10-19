import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import { manifests } from "../src/catalog/manifests.ts";
import { baseModel } from "../src/catalog/model.ts";
import { publishedRate } from "../src/catalog/pricing.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";
import { canonicalJson } from "../src/catalog/canonical-json.ts";
import { requiredUsageSignals } from "../src/catalog/pricing-calculation.ts";
import { calculationExport } from "../src/catalog/pricing-calculator-export.ts";
import { createPricingCatalogEnvelope } from "../src/catalog/pricing-envelope.ts";
import type { SourcePriceFact } from "../src/catalog/pricing-source.ts";
import { catalogSchema } from "../src/catalog/schema.ts";
import { createCalculator, type Quantity } from "../src/pricing/index.ts";

const observedAt = "2026-10-19T00:00:00.000Z";
function configuration() {
  const manifest = manifests.find(({ provider }) => provider.id === "azure");
  const priceSource = manifest?.sources.find(({ id }) => id === "azure-public-pricing");
  const accountingSource = manifest?.sources.find(({ id }) => id === "azure-accounting");
  if (manifest === undefined || priceSource === undefined || accountingSource === undefined)
    throw new Error("Missing Azure sources");
  return { manifest, priceSource, accountingSource };
}
const { manifest, priceSource, accountingSource } = configuration();
function rate(
  meter: SourcePriceFact["meter"],
  price: string,
  conditions: SourcePriceFact["conditions"] = {},
  unit: SourcePriceFact["unit"] = "million_tokens",
) {
  return publishedRate(meter, price, unit, priceSource.id, "Synthetic tariff control", conditions);
}
const ordinary = () => [
  rate("input_text", "2"),
  rate("cache_read_text", "0.2"),
  rate("input_audio", "10"),
];

async function assemble(rates: SourcePriceFact[]) {
  const provider = { ...manifest.provider, source_ids: manifest.sources.map(({ id }) => id) };
  const model = {
    ...baseModel({
      providerId: "azure",
      id: "cache-test",
      name: "Cache Test",
      sourceId: priceSource.id,
      observedAt,
    }),
    tasks: ["text_generation", "image_generation"] satisfies (
      | "text_generation"
      | "image_generation"
    )[],
    api_endpoints: [
      { name: "Chat", path: "openai/v1/chat/completions" },
      { name: "Images", path: "openai/v1/images/generations" },
    ],
    price_facts: rates,
  };
  const accounting = parseSource({
    provider,
    source: accountingSource,
    observedAt,
    body: JSON.stringify({
      index: {
        url: accountingSource.url,
        body: await readFile(
          new URL("./fixtures/azure/accounting-chat.html", import.meta.url),
          "utf8",
        ),
      },
      documents: await Promise.all(
        [
          [
            "https://learn.microsoft.com/azure/foundry/openai/how-to/prompt-caching",
            "accounting-cache.html",
          ],
          [
            "https://learn.microsoft.com/azure/foundry/openai/reference-preview-latest",
            "accounting-media.html",
          ],
        ].map(async ([url, file]) => {
          if (url === undefined || file === undefined)
            throw new Error("Missing accounting fixture");
          return {
            url,
            body: await readFile(new URL(`./fixtures/azure/${file}`, import.meta.url), "utf8"),
          };
        }),
      ),
    }),
  });
  const partition = assembleParsedProviderPricing(
    "azure",
    observedAt,
    [
      { source: priceSource, models: [model] },
      { source: accountingSource, ...accounting },
    ],
    [model],
  );
  if (partition === undefined) throw new Error("Missing Azure partition");
  const core = catalogSchema.parse(
    JSON.parse(
      JSON.stringify({
        catalog_version: "a".repeat(64),
        generated_at: observedAt,
        coverage: [],
        warnings: [],
        providers: [provider],
        models: [model],
        sources: [priceSource, accountingSource].map((source) => ({
          id: source.id,
          provider_id: "azure",
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
        })),
      }),
    ),
  );
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
  const binding = (meter: string) => {
    const term = offer.terms.find((term) => term.kind === "rate" && term.meter.value === meter);
    const result = term?.kind === "rate" ? term.variants[0]?.charge_binding : undefined;
    if (result === undefined) throw new Error(`Missing ${meter} binding`);
    return result;
  };
  return { offer, binding, calculator: createCalculator(exported) };
}

describe("Azure independent cached modality quantities", () => {
  it.each([
    "cache_read_audio",
    "cache_read_image",
    "cache_write_audio",
    "cache_write_image",
  ] satisfies SourcePriceFact["meter"][])(
    "withholds an aggregate counter beside a separate %s tariff",
    async (meter) => {
      const aggregate = meter.includes("write") ? "cache_write_text" : "cache_read_text";
      const { binding } = await assemble([rate(aggregate, "0.2"), rate(meter, "0.3")]);
      expect(binding(aggregate).quantity_methods).toBeUndefined();
      expect(binding(meter).signal).toMatchObject({ namespace: "provider", provider_id: "azure" });
    },
  );

  it("does not subtract overlapping aggregate audio and cached counts from total input", async () => {
    const { binding } = await assemble([...ordinary(), rate("cache_read_audio", "0.3")]);
    for (const meter of ["input_text", "cache_read_text", "input_audio"])
      expect(binding(meter).quantity_methods).toBeUndefined();
  });

  it("withholds the image aggregate when image cache is independently priced", async () => {
    const { binding } = await assemble([rate("input_image", "2"), rate("cache_read_image", "0.2")]);
    expect(binding("input_image").quantity_methods).toBeUndefined();
  });

  it.each(["region", "validity", "currency"])(
    "preserves independent acquisition across disjoint %s evidence",
    async (scope) => {
      const audio = rate(
        "input_audio",
        "10",
        scope === "region"
          ? { region: "westus" }
          : scope === "validity"
            ? {
                effective_from: "2026-01-01T00:00:00.000Z",
                effective_until: "2026-02-01T00:00:00.000Z",
              }
            : {},
      );
      const cached = rate(
        "cache_read_audio",
        "0.3",
        scope === "region"
          ? { region: "eastus" }
          : scope === "validity"
            ? { effective_from: "2026-03-01T00:00:00.000Z" }
            : {},
      );
      if (scope === "currency") cached.currency = "EUR";
      const { binding } = await assemble([audio, cached]);
      const methods = binding("input_audio").quantity_methods;
      expect(methods?.flatMap(({ input_sources }) => input_sources ?? [])).toContainEqual(
        expect.objectContaining({
          locator: { kind: "json_pointer", value: "/usage/prompt_tokens_details/audio_tokens" },
        }),
      );
    },
  );

  it("withholds an overlapping token equation when a related cache tariff has incompatible units", async () => {
    const { binding } = await assemble([
      rate("input_audio", "10"),
      rate("cache_read_audio", "0.3", {}, "second"),
    ]);
    expect(binding("input_audio").quantity_methods).toBeUndefined();
  });

  it("does not bind an unqualified audio counter when only part of its scope has cache pricing", async () => {
    const { binding } = await assemble([
      rate("input_audio", "10"),
      rate("cache_read_audio", "0.3", { region: "eastus" }),
    ]);
    expect(binding("input_audio").quantity_methods).toBeUndefined();
  });

  it("calculates independent caller-supplied billable partitions without aggregate overlap", async () => {
    const { offer, calculator } = await assemble([...ordinary(), rate("cache_read_audio", "0.3")]);
    const quantities = new Map<string, Quantity>();
    for (const term of offer.terms) {
      if (term.kind !== "rate") continue;
      for (const { charge_binding } of term.variants) {
        if (charge_binding === undefined) throw new Error("Missing semantic charge binding");
        expect(charge_binding.quantity_methods).toBeUndefined();
        for (const signal of requiredUsageSignals(charge_binding))
          quantities.set(canonicalJson(signal), {
            signal,
            value: { numerator: "1000", denominator: "1" },
          });
      }
    }
    expect(quantities.size).toBe(4);
    const result = calculator.calculate({
      evaluatedAt: observedAt,
      components: [
        {
          id: "partitioned",
          offerRef: offer.id,
          quantities: [...quantities.values()],
          selectors: [],
        },
      ],
    });
    expect(result).toMatchObject({
      status: "calculated",
      totals: [
        {
          denomination: { kind: "fiat", currency: "USD" },
          amount: { numerator: "1", denominator: "80" },
        },
      ],
    });
  });
});
