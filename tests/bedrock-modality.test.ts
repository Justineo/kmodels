import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import { manifests } from "../src/catalog/manifests.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";
import { calculationExport } from "../src/catalog/pricing-calculator-export.ts";
import { createPricingCatalogEnvelope } from "../src/catalog/pricing-envelope.ts";
import { publishedRate } from "../src/catalog/pricing.ts";
import { catalogSchema } from "../src/catalog/schema.ts";
import {
  createCalculator,
  type Quantity,
  type Selector,
  type CalculationOffer,
  type CalculationEnvelope,
  type CalculationBinding,
} from "../src/pricing/index.ts";
import { canonicalJson } from "../src/catalog/canonical-json.ts";
import { sonicDocuments, sonicBundle } from "./bedrock-sonic-fixtures.ts";

// Native price rows: AmazonBedrock/current/index.json, observed 2026-10-19T06:49:30.039Z,
// SHA256 f1a16e43dd44b6bc42d72cf41fd2a2cef2ed066f04373b424f3752aad7071d3a.
// Cards below are synthetic catalog scaffolding; they establish no live availability assertion.
const observedAt = "2026-10-19T06:49:30.039Z";
function configuration() {
  const manifest = manifests.find(({ provider }) => provider.id === "amazon-bedrock");
  const source = manifest?.sources.find(({ id }) => id === "bedrock-models");
  const accountingSource = manifest?.sources.find(({ id }) => id === "bedrock-accounting");
  if (manifest === undefined || source === undefined || accountingSource === undefined)
    throw new Error("Missing Bedrock sources");
  return { manifest, source, accountingSource };
}
const { manifest, source, accountingSource } = configuration();
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
          "amazon.nova-sonic-v1:0",
          "Nova Sonic",
          "Amazon",
          "InvokeModelWithBidirectionalStream",
          audio,
        ),
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

async function compiled(
  scope?: "same" | "region" | "currency" | "validity" | "batch",
  controls: {
    documents?: Array<{ url: string; body: string }>;
    apiPath?: string;
    priceEndpoint?: string;
    omitAudioRates?: boolean;
  } = {},
) {
  const result = await parsed();
  const sonic =
    controls.documents === undefined
      ? undefined
      : parseSource({
          provider,
          source: accountingSource,
          observedAt,
          body: sonicBundle(controls.documents, accountingSource.url),
        });
  const accounting =
    scope === undefined
      ? undefined
      : parseSource({ provider, source, observedAt, body: await fixture("document/bedrock.json") });
  const models = result.models.map((model) => ({
    ...model,
    ...(controls.apiPath === undefined
      ? {}
      : { api_endpoints: [{ name: "InvokeModel", path: controls.apiPath }] }),
    price_facts: model.price_facts
      .filter(
        (fact) => !controls.omitAudioRates || !["input_audio", "output_audio"].includes(fact.meter),
      )
      .map((nativeFact) => {
        // Unqualified synthetic token quotes exercise aggregate eligibility independently of
        // the native fixture's explicitly text-only quotes.
        const quoted =
          scope !== undefined && ["input_text", "output_text"].includes(nativeFact.meter)
            ? publishedRate(
                nativeFact.meter,
                nativeFact.price,
                nativeFact.unit,
                source.id,
                "Synthetic generic-token scope control",
                nativeFact.conditions,
              )
            : nativeFact;
        const fact =
          controls.priceEndpoint === undefined
            ? quoted
            : { ...quoted, conditions: { ...quoted.conditions, endpoint: controls.priceEndpoint } };
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
        pricing_inputs: [...(accounting?.pricing_inputs ?? []), ...(result.pricing_inputs ?? [])],
      },
      ...(sonic === undefined ? [] : [{ source: accountingSource, ...sonic }]),
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
        sources: [source, ...(sonic === undefined ? [] : [accountingSource])].map((source) => ({
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
        books: partition.books,
        model_dispositions: partition.model_dispositions,
      },
      core,
    ),
  );
  return { partition, exported, calculator: createCalculator(exported) };
}

function modelOffer(exported: CalculationEnvelope, model: string, mechanism = "on-demand") {
  const offer = exported.providers[0]?.books
    .find(({ book_key }) => book_key === `model:amazon-bedrock/${model}`)
    ?.offers.find(({ offer_key }) => offer_key === mechanism);
  if (offer === undefined) throw new Error(`Missing ${model} ${mechanism} offer`);
  return offer;
}

function nativeEvent() {
  const input: Record<string, number> = { textTokens: 1000, speechTokens: 1000 };
  const output: Record<string, number> = { textTokens: 1000, speechTokens: 1000 };
  return {
    event: {
      usageEvent: {
        sessionId: "same-session",
        promptName: "same-prompt",
        completionId: "same-completion",
        details: {
          delta: { input, output },
          total: {
            input: { textTokens: 999999, speechTokens: 999999 },
            output: { textTokens: 999999, speechTokens: 999999 },
          },
        },
        totalInputTokens: 1999998,
        totalOutputTokens: 1999998,
        totalTokens: 3999996,
      },
    },
  };
}

function eventComponent(offer: CalculationOffer, event: unknown, id: string) {
  const quantities = new Map<string, Quantity>();
  const selectors = new Map<string, Selector>();
  let aggregation: CalculationBinding["aggregation"] | undefined;
  for (const term of offer.terms) {
    if (term.kind !== "rate") continue;
    const variant = term.variants[0];
    const binding = variant?.charge_binding;
    if (variant === undefined || binding === undefined)
      throw new Error("Missing native charge binding");
    if (
      aggregation !== undefined &&
      canonicalJson(aggregation) !== canonicalJson(binding.aggregation)
    )
      throw new Error("Mixed event boundaries");
    aggregation = binding.aggregation;
    for (const method of binding.quantity_methods ?? [])
      for (const source of method.input_sources ?? []) {
        if (source.locator.kind !== "json_pointer") continue;
        let value: unknown = event;
        for (const key of source.locator.value.split("/").slice(1))
          value =
            value !== null && typeof value === "object" && Object.hasOwn(value, key)
              ? Reflect.get(value, key)
              : undefined;
        if (typeof value !== "number") continue;
        quantities.set(canonicalJson(source.signal), {
          signal: source.signal,
          value: { numerator: String(value), denominator: "1" },
        });
      }
    for (const condition of variant.applicability.any_of[0]?.all_of ?? []) {
      if (
        condition.kind !== "categorical" ||
        condition.values.length !== 1 ||
        condition.values[0] === undefined
      )
        throw new Error("Unexpected native selector");
      selectors.set(canonicalJson(condition.dimension), {
        kind: "categorical",
        dimension: condition.dimension,
        value: condition.values[0],
      });
    }
  }
  return {
    id,
    offerRef: offer.id,
    quantities: [...quantities.values()],
    selectors: [...selectors.values()],
    ...(aggregation === undefined ? {} : { aggregation }),
  };
}

describe("Bedrock modality pricing", () => {
  it.each([false, true])(
    "keeps the quote's native text role independent of missing peers (generic=%s)",
    async (generic) => {
      const { exported, calculator } = await compiled(generic ? "same" : undefined, {
        documents: await sonicDocuments(),
        omitAudioRates: true,
      });
      const offer = modelOffer(exported, "amazon.nova-2-sonic-v1:0");
      expect(offer.terms.filter(({ kind }) => kind === "rate")).toHaveLength(2);
      const result = calculator.calculate({
        evaluatedAt: observedAt,
        components: [
          eventComponent(offer, nativeEvent(), "usage-0"),
          eventComponent(offer, nativeEvent(), "usage-1"),
        ],
      });
      expect(result).toMatchObject({
        status: "calculated",
        totals: [{ amount: { numerator: "77", denominator: generic ? "6250" : "12500" } }],
      });
    },
  );

  it("does not borrow a generic invocation-log selector for a Bidi-only model", async () => {
    const { exported } = await compiled("same", { documents: await sonicDocuments() });
    const offer = modelOffer(exported, "amazon.nova-2-sonic-v1:0");
    const sources = offer.terms.flatMap((term) =>
      term.kind === "rate"
        ? term.variants.flatMap(({ selector_sources }) => selector_sources ?? [])
        : [],
    );
    expect(sources.some(({ channel }) => channel === "invocation_log")).toBe(false);
  });
  it.each([
    ["amazon.nova-sonic-v1:0", { numerator: "173", denominator: "5000" }],
    ["amazon.nova-2-sonic-v1:0", { numerator: "113", denominator: "3125" }],
  ] as const)(
    "prices repeated native deltas once each rather than cumulative totals (%s)",
    async (model, amount) => {
      const { exported, calculator } = await compiled(undefined, {
        documents: await sonicDocuments(),
      });
      const offer = modelOffer(exported, model);
      const components = [0, 1].map((index) =>
        eventComponent(offer, nativeEvent(), `usage-${index}`),
      );
      expect(
        components.every(
          ({ aggregation }) =>
            canonicalJson(aggregation) ===
            canonicalJson({
              namespace: "provider",
              provider_id: "amazon-bedrock",
              value: "sonic_usage_event",
            }),
        ),
      ).toBe(true);
      const result = calculator.calculate({ evaluatedAt: observedAt, components });
      expect(result).toMatchObject({
        status: "calculated",
        totals: [{ denomination: { kind: "fiat", currency: "USD" }, amount }],
      });
      expect(result.charges).toHaveLength(8);
    },
  );

  it("sums native text and speech deltas for explicitly unqualified synthetic token quotes", async () => {
    const { exported, calculator } = await compiled("same", { documents: await sonicDocuments() });
    const offer = modelOffer(exported, "amazon.nova-2-sonic-v1:0");
    const result = calculator.calculate({
      evaluatedAt: observedAt,
      components: [
        eventComponent(offer, nativeEvent(), "usage-0"),
        eventComponent(offer, nativeEvent(), "usage-1"),
      ],
    });
    expect(result).toMatchObject({
      status: "calculated",
      totals: [{ amount: { numerator: "529", denominator: "12500" } }],
    });
  });

  it.each(["source", "runtime"])(
    "keeps a missing %s counter unknown and preserves native prices",
    async (missing) => {
      const documents = await sonicDocuments();
      const doc = documents[1];
      if (doc === undefined) throw new Error("Missing Sonic2 document");
      if (missing === "source")
        doc.body = doc.body.replace(
          '"speechTokens": number, // input speech tokens',
          '"renamed": number, // input speech tokens',
        );
      const { exported, calculator } = await compiled(undefined, { documents });
      const offer = modelOffer(exported, "amazon.nova-2-sonic-v1:0");
      expect(offer.terms.filter(({ kind }) => kind === "rate")).toHaveLength(4);
      const event = nativeEvent();
      if (missing === "runtime") delete event.event.usageEvent.details.delta.input.speechTokens;
      const result = calculator.calculate({
        evaluatedAt: observedAt,
        components: [eventComponent(offer, event, "usage")],
      });
      expect(result.status).not.toBe("calculated");
      expect(result.totals).toBeUndefined();
    },
  );

  it.each(["model", "api", "endpoint", "batch"])(
    "does not lend Sonic counters to another %s scope",
    async (boundary) => {
      const { exported } = await compiled(boundary === "batch" ? "batch" : undefined, {
        documents: await sonicDocuments(),
        ...(boundary === "api" ? { apiPath: "model/{modelId}/invoke" } : {}),
        ...(boundary === "endpoint" ? { priceEndpoint: "bedrock-mantle" } : {}),
      });
      const offer = modelOffer(
        exported,
        boundary === "model" ? "amazon.nova-2-5-sonic-v1:0" : "amazon.nova-2-sonic-v1:0",
        boundary === "batch" ? "batch" : "on-demand",
      );
      for (const term of offer.terms) {
        if (term.kind !== "rate") continue;
        const binding = term.variants[0]?.charge_binding;
        expect(binding?.quantity_methods).toBeUndefined();
        expect(binding?.aggregation).toBe(boundary === "batch" ? "job" : "attempt");
      }
    },
  );
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
          expect(binding?.signal.namespace).toBe("kmodels");
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
