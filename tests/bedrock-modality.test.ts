import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import { manifests } from "../src/catalog/manifests.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";
import { calculationExport } from "../src/catalog/pricing-calculator-export.ts";
import { createPricingCatalogEnvelope } from "../src/catalog/pricing-envelope.ts";
import { publishedRate } from "../src/catalog/pricing.ts";
import { catalogSchema } from "../src/catalog/schema.ts";
import { createCalculator, type Quantity, type Selector } from "../src/pricing/index.ts";

// Native price rows: AmazonBedrock/current/index.json, observed 2026-10-19T06:49:30.039Z,
// SHA256 f1a16e43dd44b6bc42d72cf41fd2a2cef2ed066f04373b424f3752aad7071d3a.
// Cards below are synthetic catalog scaffolding; they establish no live availability assertion.
const observedAt = "2026-10-19T06:49:30.039Z";
function configuration() {
  const manifest = manifests.find(({ provider }) => provider.id === "amazon-bedrock");
  const source = manifest?.sources.find(({ id }) => id === "bedrock-models");
  if (manifest === undefined || source === undefined) throw new Error("Missing Bedrock source");
  return { manifest, source };
}
const { manifest, source } = configuration();
const provider = { ...manifest.provider, source_ids: manifest.sources.map(({ id }) => id) };
const fixture = (path: string) => readFile(new URL(`./fixtures/${path}`, import.meta.url), "utf8");

function card(id: string, name: string, publisher: string, api: string, audio = true) {
  return {
    url: `https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-${id.replace(/[^a-z0-9-]/g, "-")}.md`,
    body: `# ${name}
## ![](publisher.png) ${publisher} — ${name}
## Model Details
| Input Modalities | Output Modalities | APIs supported | Endpoints supported |
| --- | --- | --- | --- |
| ![Yes](icon-yes.png) Text | ![Yes](icon-yes.png) Text | ![Yes](icon-yes.png) ${api} | ![Yes](icon-yes.png) bedrock-runtime |
| ![${audio ? "Yes" : "No"}](icon-${audio ? "yes" : "no"}.png) Audio | ![${audio ? "Yes" : "No"}](icon-${audio ? "yes" : "no"}.png) Audio | | ![Yes](icon-yes.png) bedrock-mantle |
## Programmatic Access
| Endpoint | Model ID | Geo inference ID | Global inference ID |
| --- | --- | --- | --- |
| bedrock-runtime | ${id} | N/A | N/A |
| bedrock-mantle | ${id} | N/A | N/A |
## Regional Availability
| Region | In-Region | Geo | Global |
| --- | --- | --- | --- |
| us-east-1 (N. Virginia) | ![Yes](icon-yes.png) | ![No](icon-no.png) | ![No](icon-no.png) |`,
  };
}

async function parsed(audio = true) {
  return parseSource({
    provider,
    source,
    observedAt,
    body: JSON.stringify({
      index: { url: source.url, body: "# Model cards" },
      documents: [
        card(
          "mistral.voxtral-mini-3b-2507",
          "Voxtral Mini 3B 2507",
          "Mistral AI",
          "Converse",
          audio,
        ),
        card(
          "amazon.nova-2-sonic-v1:0",
          "Nova Sonic 2.0",
          "Amazon",
          "InvokeModelWithBidirectionalStream",
          audio,
        ),
        card(
          "amazon.nova-2-5-sonic-v1:0",
          "Nova 2.5 Sonic",
          "Amazon",
          "InvokeModelWithBidirectionalStream",
          audio,
        ),
        {
          url: "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrock/current/index.json",
          body: await fixture("bedrock/modality-price-list.json"),
        },
      ],
    }),
  });
}

async function compiled(scope?: "same" | "region" | "currency" | "validity" | "batch") {
  const result = await parsed();
  const accounting =
    scope === undefined
      ? undefined
      : parseSource({ provider, source, observedAt, body: await fixture("document/bedrock.json") });
  const models = result.models.map((model) => ({
    ...model,
    price_facts: model.price_facts.map((fact) => {
      const audio = fact.meter === "input_audio" || fact.meter === "output_audio";
      if (scope === "validity")
        return {
          ...fact,
          conditions: {
            ...fact.conditions,
            effective_from: audio ? "2026-01-01T00:00:00Z" : "2026-10-01T00:00:00Z",
            ...(audio ? { effective_until: "2026-02-01T00:00:00Z" } : {}),
          },
        };
      if (!audio) return fact;
      if (scope === "region")
        return { ...fact, conditions: { ...fact.conditions, region: "eu-west-1" } };
      if (scope === "currency") return { ...fact, currency: "EUR" };
      if (scope === "batch")
        return { ...fact, conditions: { ...fact.conditions, service_tier: "batch" } };
      return fact;
    }),
  }));
  const partition = assembleParsedProviderPricing(
    provider.id,
    observedAt,
    [
      {
        source,
        ...result,
        models,
        pricing_inputs: accounting?.pricing_inputs ?? result.pricing_inputs ?? [],
      },
    ],
    models,
  );
  if (partition === undefined) throw new Error("Missing Bedrock pricing");
  const core = catalogSchema.parse(
    JSON.parse(
      JSON.stringify({
        catalog_version: "a".repeat(64),
        generated_at: observedAt,
        coverage: [],
        warnings: [],
        providers: [provider],
        models,
        sources: [
          {
            id: source.id,
            provider_id: provider.id,
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
      }),
    ),
  );
  const exported = calculationExport(
    core,
    createPricingCatalogEnvelope(
      {
        provider_vocabularies: [partition.vocabulary],
        provider_snapshots: [partition.snapshot],
        books: partition.books,
        model_dispositions: partition.model_dispositions,
      },
      core,
    ),
  );
  return { partition, exported, calculator: createCalculator(exported) };
}

describe("Bedrock modality pricing", () => {
  it("uses native direction and modality instead of the model's tasks", async () => {
    for (const audio of [true, false]) {
      const result = await parsed(audio);
      const voxtral = result.models.find(
        ({ model_id }) => model_id === "mistral.voxtral-mini-3b-2507",
      );
      expect(voxtral?.price_facts).toMatchObject([
        { meter: "input_text", price: "0.04", unit: "million_tokens" },
      ]);
      const sonic = result.models.find(({ model_id }) => model_id === "amazon.nova-2-sonic-v1:0");
      expect(sonic?.price_facts.map(({ meter }) => meter).sort()).toEqual([
        "input_audio",
        "input_text",
        "output_audio",
        "output_text",
      ]);
    }
  });

  it("recognizes the native lowercase 1k token denominator without changing the amount", async () => {
    const result = await parsed();
    const sonic = result.models.find(({ model_id }) => model_id === "amazon.nova-2-5-sonic-v1:0");
    expect(sonic?.price_facts).toMatchObject([
      {
        meter: "output_audio",
        price: "12",
        unit: "million_tokens",
        raw_price: "0.0120000000",
        raw_unit: "1k tokens",
      },
    ]);
    expect(sonic?.raw_price_facts).toEqual([]);
  });

  it("preserves semantic audio token charges in the portable export without inventing locators", async () => {
    const { exported, calculator } = await compiled();
    const book = exported.providers[0]?.books.find(({ book_key }) =>
      book_key.endsWith("amazon.nova-2-sonic-v1:0"),
    );
    const offer = book?.offers.find(({ offer_key }) => offer_key === "on-demand");
    if (offer === undefined) throw new Error("Missing Sonic offer");
    const quantities: Quantity[] = [];
    const selectors: Selector[] = [];
    for (const term of offer.terms) {
      if (term.kind !== "rate") continue;
      const variant = term.variants[0];
      const binding = variant?.charge_binding;
      if (variant === undefined || binding === undefined)
        throw new Error(`Missing ${term.meter.value} binding`);
      quantities.push({ signal: binding.signal, value: { numerator: "1000", denominator: "1" } });
      expect(binding.quantity_methods).toBeUndefined();
      const clause = variant.applicability.any_of[0];
      for (const condition of clause?.all_of ?? []) {
        if (condition.kind !== "categorical" || condition.values[0] === undefined)
          throw new Error("Unexpected native selector");
        selectors.push({
          kind: "categorical",
          dimension: condition.dimension,
          value: condition.values[0],
        });
      }
    }
    const unique = new Map(
      selectors.map((selector) => [JSON.stringify(selector.dimension), selector]),
    );
    expect(
      calculator.calculate({
        evaluatedAt: observedAt,
        components: [
          { id: "sonic", offerRef: offer.id, quantities, selectors: [...unique.values()] },
        ],
      }),
    ).toMatchObject({
      status: "calculated",
      charges: expect.any(Array),
      totals: [
        {
          denomination: { kind: "fiat", currency: "USD" },
          amount: { numerator: "113", denominator: "6250" },
        },
      ],
    });
  });

  it("binds independently priced input-video seconds in existing native-shaped embedding fixtures", async () => {
    const result = parseSource({
      provider,
      source,
      observedAt,
      body: await fixture("document/bedrock-embedding-pricing.json"),
    });
    const partition = assembleParsedProviderPricing(
      provider.id,
      observedAt,
      [{ source, ...result }],
      result.models,
    );
    const video = partition?.books
      .flatMap(({ offers }) => offers)
      .flatMap(({ terms }) => terms)
      .find((term) => term.kind === "rate" && term.meter.value === "input_video");
    if (video?.kind !== "rate") throw new Error("Missing video rate");
    expect(video.variants[0]?.charge_binding).toMatchObject({
      aggregation: "attempt",
      signal: {
        namespace: "provider",
        provider_id: "amazon-bedrock",
        value: "runtime_input_video_second",
      },
    });
    expect(video.variants[0]?.charge_binding?.quantity_methods).toBeUndefined();
  });

  it.each(["same", "region", "currency", "validity", "batch"] as const)(
    "keeps aggregate counters out of overlapping modality tariffs (%s control)",
    async (scope) => {
      const { exported } = await compiled(scope);
      const offer = exported.providers[0]?.books
        .find(({ book_key }) => book_key.endsWith("amazon.nova-2-sonic-v1:0"))
        ?.offers.find(({ offer_key }) => offer_key === "on-demand");
      if (offer === undefined) throw new Error("Missing Sonic offer");
      const text = offer.terms.filter(
        (term) => term.kind === "rate" && ["input_text", "output_text"].includes(term.meter.value),
      );
      expect(text).toHaveLength(2);
      for (const term of text) {
        if (term.kind !== "rate") throw new Error("Missing text rate");
        const binding = term.variants[0]?.charge_binding;
        if (scope === "same") {
          expect(binding?.signal.namespace).toBe("provider");
          expect(binding?.quantity_methods).toBeUndefined();
        } else {
          expect(binding?.signal.namespace).toBe("kmodels");
          expect(binding?.quantity_methods).toContainEqual({
            input_sources: expect.arrayContaining([
              expect.objectContaining({
                channel: "invocation_log",
                availability: "reconciliation_only",
              }),
            ]),
          });
        }
      }
    },
  );

  it.each(["same", "region", "currency", "batch"] as const)(
    "does not let an unrelated cache quote change the input quantity (%s control)",
    async (scope) => {
      const result = await parsed();
      const original = result.models.find(
        ({ model_id }) => model_id === "mistral.voxtral-mini-3b-2507",
      );
      const inputRate = original?.price_facts[0];
      if (original === undefined || inputRate === undefined)
        throw new Error("Missing native Voxtral input");
      const cache = publishedRate(
        "cache_read_text",
        "0.004",
        "million_tokens",
        source.id,
        "Synthetic cache scope control",
        {
          ...inputRate.conditions,
          ...(scope === "region" ? { region: "eu-west-1" } : {}),
          ...(scope === "batch" ? { service_tier: "batch" } : {}),
        },
      );
      const model = {
        ...original,
        price_facts: [inputRate, { ...cache, currency: scope === "currency" ? "EUR" : "USD" }],
      };
      const partition = assembleParsedProviderPricing(
        provider.id,
        observedAt,
        [{ source, models: [model] }],
        [model],
      );
      const input = partition?.books
        .flatMap(({ offers }) => offers)
        .filter(({ offer_key }) => offer_key === "on-demand")
        .flatMap(({ terms }) => terms)
        .find((term) => term.kind === "rate" && term.meter.value === "input_text");
      if (input?.kind !== "rate") throw new Error("Missing input tariff");
      expect(input.variants[0]?.charge_binding?.signal).toEqual({
        namespace: "kmodels",
        value: scope === "same" ? "uncached_input_tokens" : "input_tokens",
      });
    },
  );
});
