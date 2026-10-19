import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import { manifests } from "../src/catalog/manifests.ts";
import { baseModel } from "../src/catalog/model.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";
import { calculationExport } from "../src/catalog/pricing-calculator-export.ts";
import { createPricingCatalogEnvelope } from "../src/catalog/pricing-envelope.ts";
import { catalogSchema } from "../src/catalog/schema.ts";
import { createCalculator, type Quantity } from "../src/pricing/index.ts";

function configuration() {
  const manifest = manifests.find(({ provider }) => provider.id === "openai");
  const prices = manifest?.sources.find(({ id }) => id === "openai-pricing");
  const cards = manifest?.sources.find(({ id }) => id === "openai-overview");
  const accounting = manifest?.sources.find(({ id }) => id === "openai-accounting");
  if (
    manifest === undefined ||
    prices === undefined ||
    cards === undefined ||
    accounting === undefined
  )
    throw new Error("Missing OpenAI sources");
  return {
    prices,
    cards,
    accounting,
    provider: { ...manifest.provider, source_ids: manifest.sources.map(({ id }) => id) },
  };
}
const { prices, cards, accounting, provider } = configuration();
const observedAt = "2026-10-19T12:44:41.022Z";
const fixture = (name: string) =>
  readFile(new URL(`./fixtures/openai/${name}`, import.meta.url), "utf8");

// Prices and API schemas are native excerpts; model endpoint/task overrides are scope controls.
async function compiled(
  controls: {
    card?: boolean;
    body?: string;
    apiName?: string;
    apiPath?: string;
    accountingBody?: string;
    noAccounting?: boolean;
    batch?: boolean;
  } = {},
) {
  const source = controls.card ? cards : prices;
  const models = ["gpt-audio", "gpt-audio-1.5", "gpt-audio-mini"].map((id) => ({
    ...baseModel({ providerId: "openai", id, name: id, sourceId: "openai-models", observedAt }),
    api_endpoints: [
      {
        name: controls.apiName ?? "Chat Completions",
        path: controls.apiPath ?? "v1/chat/completions",
      },
    ],
  }));
  const parsed = parseSource({
    provider,
    source,
    observedAt,
    catalogModels: models,
    body:
      controls.body ??
      (await fixture(controls.card ? "audio-price-cards.json" : "audio-pricing.md")),
  });
  for (const model of parsed.models)
    model.price_facts = model.price_facts.map((fact) => ({
      ...fact,
      conditions: { ...fact.conditions, ...(controls.batch ? { service_tier: "batch" } : {}) },
    }));
  const siblingSchemas = (await fixture("accounting-realtime.yaml")).split("  schemas:\n")[1];
  if (siblingSchemas === undefined) throw new Error("Missing native sibling schemas");
  const native = parseSource({
    provider,
    source: accounting,
    observedAt,
    body:
      (controls.accountingBody ?? (await fixture("accounting-chat.yaml"))) + "\n" + siblingSchemas,
  });
  const partition = assembleParsedProviderPricing(
    "openai",
    observedAt,
    [{ source, ...parsed }, ...(controls.noAccounting ? [] : [{ source: accounting, ...native }])],
    models,
  );
  if (partition === undefined) throw new Error("Missing pricing partition");
  const core = catalogSchema.parse(
    JSON.parse(
      JSON.stringify({
        catalog_version: "a".repeat(64),
        generated_at: observedAt,
        providers: [provider],
        models,
        coverage: [],
        warnings: [],
        sources: [source, accounting].map((source) => ({
          id: source.id,
          provider_id: "openai",
          url: source.url,
          source: [source.type],
          stability: source.stability,
          scope: "global",
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
  const calculator = createCalculator(exported);
  function offer(id: string) {
    const book = exported.providers[0]?.books.find((book) =>
      book.scope.model_refs.includes(`openai/${id}`),
    );
    const result = book?.offers.find(
      (offer) => offer.offer_key === (controls.batch ? "batch" : "sync"),
    );
    if (result === undefined) throw new Error(`Missing offer ${id}`);
    return result;
  }
  function calculate(id: string, missingOutput?: "text" | "audio") {
    const selected = offer(id);
    const quantities: Quantity[] = [];
    const details: Record<string, number> = { text_tokens: 300, audio_tokens: 400 };
    if (missingOutput !== undefined) delete details[`${missingOutput}_tokens`];
    const response = { usage: { completion_tokens_details: details, completion_tokens: 999999 } };
    for (const term of selected.terms) {
      if (term.kind !== "rate") continue;
      for (const variant of term.variants) {
        const binding = variant.charge_binding;
        if (binding === undefined) throw new Error("Missing native charge quantity");
        const input = term.meter.value.startsWith("input_");
        if (input)
          quantities.push({
            signal: binding.signal,
            value: {
              numerator: term.meter.value === "input_text" ? "1000" : "2000",
              denominator: "1",
            },
          });
        else
          for (const method of binding.quantity_methods ?? [])
            for (const source of method.input_sources ?? []) {
              if (source.locator.kind !== "json_pointer") continue;
              let value: unknown = response;
              for (const key of source.locator.value.split("/").slice(1))
                value =
                  value !== null && typeof value === "object" && Object.hasOwn(value, key)
                    ? Reflect.get(value, key)
                    : undefined;
              if (typeof value === "number")
                quantities.push({
                  signal: source.signal,
                  value: { numerator: String(value), denominator: "1" },
                });
            }
      }
    }
    return calculator.calculate({
      evaluatedAt: observedAt,
      components: [
        {
          id: "completion",
          offerRef: selected.id,
          quantities,
          selectors: controls.batch
            ? []
            : [
                {
                  kind: "categorical",
                  dimension: { namespace: "kmodels", value: "served_service_tier" },
                  value: { namespace: "provider", provider_id: "openai", value: "standard" },
                },
              ],
        },
      ],
    });
  }
  return { parsed, native, offer, calculate };
}

function quantitySignal(key: string) {
  return { namespace: "provider", provider_id: "openai", value: key };
}

describe("OpenAI explicit non-Realtime modality quantities", () => {
  it("recognizes the owned Chat output breakdown without aggregate or account substitutes", async () => {
    const { native } = await compiled();
    expect(native.models).toEqual([]);
    expect(native.pricing_inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "chat.output_text_tokens",
          channel: "response",
          locator: { kind: "json_pointer", value: "/usage/completion_tokens_details/text_tokens" },
        }),
        expect.objectContaining({
          key: "chat.output_audio_tokens",
          channel: "response",
          locator: { kind: "json_pointer", value: "/usage/completion_tokens_details/audio_tokens" },
        }),
      ]),
    );
    expect(native.pricing_inputs?.some((input) => input.channel === "account_report")).toBe(false);
  });

  it.each([false, true])(
    "retains source-owned text quantities in native %s card mode",
    async (card) => {
      const { parsed, offer } = await compiled({ card });
      const mini = parsed.models.find((model) => model.model_id === "gpt-audio-mini");
      const text = mini?.price_facts.find((fact) => fact.meter === "input_text");
      expect(text?.charge_binding?.signal).toEqual(quantitySignal("uncached_input_text_tokens"));
      const output = offer("gpt-audio-mini").terms.find(
        (term) => term.kind === "rate" && term.meter.value === "output_text",
      );
      if (output?.kind !== "rate") throw new Error("Missing text output");
      expect(output.variants[0]?.charge_binding?.signal).toEqual(
        quantitySignal("output_text_tokens"),
      );
      if (card) expect(mini?.price_facts.some((fact) => fact.meter === "input_audio")).toBe(false);
    },
  );

  it.each([
    ["gpt-audio", "951", "10000"],
    ["gpt-audio-1.5", "951", "10000"],
    ["gpt-audio-mini", "733", "25000"],
  ])("prices native text and audio partitions once for %s", async (id, numerator, denominator) => {
    const { calculate } = await compiled();
    const result = calculate(id);
    expect(result.status).toBe("calculated");
    expect(result.totals).toEqual([
      { denomination: { kind: "fiat", currency: "USD" }, amount: { numerator, denominator } },
    ]);
    expect(result.charges).toHaveLength(4);
  });

  it.each(["text", "audio"] as const)(
    "keeps missing %s output unknown with other charges intact",
    async (missing) => {
      const { calculate } = await compiled();
      const result = calculate("gpt-audio", missing);
      expect(result.status).toBe("partial");
      expect(result.totals).toBeUndefined();
      expect(result.charges).toHaveLength(3);
    },
  );

  it.each([
    { apiName: "Responses", apiPath: "v1/responses" },
    { apiName: "Chat Completions", apiPath: "v1/responses" },
    { batch: true },
    { noAccounting: true },
  ])(
    "does not borrow Chat counters without its exact source/API/mechanism %j",
    async (controls) => {
      const { calculate, offer } = await compiled(controls);
      const selected = offer("gpt-audio");
      expect(
        selected.terms.flatMap((term) =>
          term.kind === "rate"
            ? term.variants.flatMap((variant) => variant.charge_binding?.quantity_methods ?? [])
            : [],
        ),
      ).toEqual([]);
      expect(calculate("gpt-audio").status).toBe("partial");
    },
  );

  it("does not convert aggregate cached input to text when the native audio row is missing", async () => {
    const body = (await fixture("audio-pricing.md"))
      .split("\n")
      .filter((line) => !/\| Audio\s*\|/.test(line))
      .join("\n")
      .replace(/\| -\s*\|/g, "| $0.25 |");
    const { parsed, offer } = await compiled({ body });
    const text = parsed.models[0]?.price_facts.find((fact) => fact.meter === "cache_read_text");
    expect(text?.charge_binding?.signal).toEqual(quantitySignal("cached_input_text_tokens"));
    const cached = offer("gpt-audio").terms.find(
      (term) => term.kind === "rate" && term.meter.value === "cache_read_text",
    );
    if (cached?.kind !== "rate") throw new Error("Missing scoped cache control");
    expect(cached.variants[0]?.charge_binding?.quantity_methods).toBeUndefined();
  });

  it.each(["type", "attachment", "duplicate"])("withholds a drifting %s locally", async (drift) => {
    let body = await fixture("accounting-chat.yaml");
    if (drift === "attachment")
      body = body.replace(
        "#/components/schemas/CompletionUsage",
        "#/components/schemas/OtherUsage",
      );
    else
      body = body.replace(
        /(            text_tokens:\n)              type: integer/,
        drift === "type"
          ? "$1              type: string"
          : "$1              type: integer\n            text_tokens:\n              type: integer",
      );
    const { native, calculate } = await compiled({ accountingBody: body });
    expect(native.pricing_inputs?.some((input) => input.key === "chat.output_text_tokens")).toBe(
      false,
    );
    expect(calculate("gpt-audio").status).toBe("partial");
    if (drift !== "attachment")
      expect(native.pricing_inputs?.some((input) => input.key === "chat.output_audio_tokens")).toBe(
        true,
      );
  });
});
