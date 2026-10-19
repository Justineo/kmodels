import { describe, expect, it } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import { manifests } from "../src/catalog/manifests.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";
import { vercelCommercialFacts } from "../src/catalog/vercel-commercial-source.ts";
import { modelPricingView } from "../src/catalog/pricing-presentation.ts";
import type { PricingReconciliationItem } from "../src/catalog/pricing-reconciliation.ts";

const manifest = manifests.find((m) => m.provider.id === "vercel");
const configured = manifest?.sources[0];
if (manifest === undefined || configured?.extractor.kind !== "vercel-catalog")
  throw new Error("Missing Vercel source");
const source = {
  ...configured,
  extractor: { ...configured.extractor, minModels: 1, maxModels: 20 },
};
const provider = { ...manifest.provider, source_ids: manifest.sources.map((s) => s.id) };
const observedAt = "2026-10-20T00:00:00.000Z";
const model = {
  id: "acme/text-1",
  object: "model",
  created: 1,
  released: 1,
  owned_by: "acme",
  name: "Text One",
  description: "",
  type: "language",
  supported_specifications: ["v3"],
  modalities: { input: ["text"], output: ["text"] },
};
function endpoint(name: string, prompt = "0.000002", peak?: unknown) {
  return {
    name: `${name} | ${model.id}`,
    provider_name: name,
    model_name: model.name,
    quantization: null,
    status: 0,
    supports_implicit_caching: false,
    pricing: {
      prompt,
      completion: "0.000006",
      request: "0",
      image: "0",
      image_output: "0",
      web_search: "0",
      internal_reasoning: "0",
      discount: 0,
      ...(peak === undefined ? {} : { peak_pricing: peak }),
    },
  };
}
function parse(
  pricing: Record<string, unknown>,
  endpoints: ReturnType<typeof endpoint>[] = [],
  responseId = model.id,
  metadata: Record<string, unknown> = {},
) {
  const diagnostics: PricingReconciliationItem[] = [];
  const result = parseSource({
    provider,
    source,
    observedAt,
    body: JSON.stringify({
      index: {
        url: source.url,
        body: JSON.stringify({ object: "list", data: [{ ...model, ...metadata, pricing }] }),
      },
      documents:
        endpoints.length === 0
          ? []
          : [
              {
                url: source.url + "/" + model.id + "/endpoints",
                body: JSON.stringify({
                  data: {
                    id: responseId,
                    name: model.name,
                    created: 1,
                    released: 1,
                    description: "",
                    architecture: null,
                    endpoints,
                  },
                }),
              },
            ],
    }),
    onPricingReconciliation: (item) => diagnostics.push(item),
  });
  return { result, diagnostics };
}
describe("Vercel price authority", () => {
  it("keeps independently callable search tools outside model inference-price resolution", () => {
    const { result } = parse({});
    const commercial = vercelCommercialFacts({
      sourceId: source.id,
      documents: new Map([
        [
          "/docs/ai-gateway/models-and-providers/web-search.md",
          "perplexitySearch: Perplexity web search requests are charged at $5 per 1,000 requests.",
        ],
      ]),
    });
    expect(commercial).toHaveLength(1);
    expect(commercial[0]?.model_refs).toEqual([]);
    const partition = assembleParsedProviderPricing(
      "vercel",
      observedAt,
      [{ source, ...result, commercial_facts: commercial }],
      result.models,
    );
    if (partition === undefined || result.models[0] === undefined)
      throw new Error("Missing independent service");
    expect(partition.books).toHaveLength(1);
    expect(partition.books[0]?.scope.model_refs).toEqual([]);
    expect(
      modelPricingView(
        {
          books: partition.books,
          provider_snapshots: [partition.snapshot],
          provider_vocabularies: [partition.vocabulary],
          model_dispositions: [],
        },
        result.models[0],
      ).outcome,
    ).toBe("unknown");
  });
  it("does not infer a false voice-control condition from a qualified sibling", () => {
    const { result } = parse({
      video_duration_pricing: [
        { audio: true, mode: "std", cost_per_second: "0.252" },
        { audio: true, mode: "std", voice_control: true, cost_per_second: "0.308" },
      ],
    });
    expect(
      result.models[0]?.price_facts.find((f) => f.price === "0.252")?.conditions.voice_control,
    ).toBeUndefined();
    expect(
      result.models[0]?.price_facts.find((f) => f.price === "0.308")?.conditions.voice_control,
    ).toBe(true);
    const partition = assembleParsedProviderPricing(
      "vercel",
      observedAt,
      [{ source, ...result }],
      result.models,
    );
    expect(
      partition?.books[0]?.offers[0]?.terms.flatMap((t) =>
        t.kind === "raw" ? t.variants : t.raw_variants,
      ),
    ).toContainEqual(expect.objectContaining({ reason: "conflicting_values" }));
  });
  it("keeps models when unconsumed reasoning or privacy metadata changes representation", () => {
    const { result } = parse({ input: "0.000002" }, [], model.id, {
      interleaved: { field: "reasoning_content" },
      no_training: "some",
      zdr: "some",
    });
    expect(result.models).toHaveLength(1);
    expect(result.models[0]?.price_facts).toHaveLength(1);
  });
  it("keeps verified token prices when an endpoint search amount has an unreviewed unit", () => {
    const route = endpoint("acme");
    route.pricing.web_search = "0.01";
    const { result } = parse({}, [route]);
    expect(result.models[0]?.price_facts).toHaveLength(2);
    expect(result.models[0]?.raw_price_facts[0]).toMatchObject({
      reason: "unknown_unit",
      raw: { amount: "0.01", meter: "web_search" },
    });
    const partition = assembleParsedProviderPricing(
      "vercel",
      observedAt,
      [{ source, ...result }],
      result.models,
    );
    const inference = partition?.books.find((b) => b.book_key === "model:vercel/acme/text-1");
    expect(inference?.offers[0]?.terms.every((t) => t.kind === "rate")).toBe(true);
    expect(
      partition?.books.find((b) => b.book_key === "service:native-web-search")?.offers[0]?.terms,
    ).toContainEqual(expect.objectContaining({ kind: "raw" }));
  });
  it("keeps absent prices unknown without asserting an unpublished offer", () => {
    const { result, diagnostics } = parse({});
    expect(result.models[0]).toMatchObject({ pricing_state: "unknown", price_facts: [] });
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ disposition: "unbound", reason_code: "catalog_price_empty" }),
    );
  });
  it("retains an explicitly published numeric zero", () => {
    expect(parse({ input: "0", output: "0" }).result.models[0]).toMatchObject({
      pricing_state: "numeric",
    });
    expect(
      parse({ input: "0", output: "0" }).result.models[0]?.price_facts.map((f) => f.price),
    ).toEqual(["0", "0"]);
  });
  it("does not publish an unqualified minimum when pricing varies by provider", () => {
    const { result } = parse({ input: "0", output: "0", varies_by_provider: true });
    expect(result.models[0]).toMatchObject({ pricing_state: "unknown", price_facts: [] });
  });
  it("keeps exact paid and zero route quotes without a global zero fallback", () => {
    const free = endpoint("free", "0");
    free.pricing.completion = "0";
    const { result } = parse({ input: "0", output: "0", varies_by_provider: true }, [
      endpoint("paid"),
      free,
    ]);
    const rates = result.models[0]?.price_facts ?? [];
    expect(rates).toHaveLength(4);
    expect(rates.every((f) => f.conditions.route_provider !== undefined)).toBe(true);
    expect(rates).toContainEqual(
      expect.objectContaining({
        price: "2",
        conditions: expect.objectContaining({ route_provider: "paid" }),
      }),
    );
    expect(rates).toContainEqual(
      expect.objectContaining({
        price: "0",
        conditions: expect.objectContaining({ route_provider: "free" }),
      }),
    );
  });
  const peak = {
    multiplier: 2,
    windows: [{ start_minute_utc: 60, end_minute_utc: 240, days_of_week: [1, 2, 3, 4, 5] }],
    holiday_calendar: "cn",
  };
  it("retains an unreviewed peak schedule and amounts in the owning route only", () => {
    const { result } = parse({ input: "0.000001", varies_by_provider: true }, [
      endpoint("peak", "0.000001", peak),
      endpoint("fixed"),
    ]);
    const actual = result.models[0];
    expect(actual?.price_facts.every((f) => f.conditions.route_provider === "fixed")).toBe(true);
    expect(actual?.raw_price_facts).toHaveLength(2);
    expect(actual?.raw_price_facts).toContainEqual(
      expect.objectContaining({
        reason: "unknown_applicability",
        conditions: expect.objectContaining({ route_provider: "peak" }),
        raw: expect.objectContaining({
          amount: "0.000001",
          unit: "token",
          fragment: expect.stringContaining("holiday_calendar"),
        }),
      }),
    );
    const partition = assembleParsedProviderPricing(
      "vercel",
      observedAt,
      [{ source, ...result }],
      result.models,
    );
    expect(partition?.books[0]?.offers[0]?.terms.some((t) => t.kind === "raw")).toBe(true);
  });
  it("withholds an unqualified catalog rate while its peak applicability is unreviewed", () => {
    const actual = parse({ input: "0.000001", peak_pricing: peak }).result.models[0];
    expect(actual).toMatchObject({ pricing_state: "unknown", price_facts: [] });
    expect(actual?.raw_price_facts[0]).toMatchObject({
      reason: "unknown_applicability",
      raw: { amount: "0.000001" },
    });
  });
  it("retains contradictory tier quotes for canonical conflict resolution", () => {
    const { result } = parse({
      input_tiers: [
        { min: 0, max: 100, cost: "0.000001" },
        { min: 0, max: 100, cost: "0.000002" },
      ],
      output: "0.000006",
    });
    expect(
      result.models[0]?.price_facts
        .filter((f) => f.meter === "input_text")
        .map((f) => f.price)
        .sort(),
    ).toEqual(["1", "2"]);
    const partition = assembleParsedProviderPricing(
      "vercel",
      observedAt,
      [{ source, ...result }],
      result.models,
    );
    expect(
      partition?.books[0]?.offers[0]?.terms.flatMap((t) =>
        t.kind === "raw" ? t.variants : t.raw_variants,
      ),
    ).toContainEqual(expect.objectContaining({ reason: "conflicting_values" }));
  });
  it("rejects a wrong endpoint model identity", () => {
    expect(() => parse({}, [endpoint("acme")], "other/model")).toThrow(
      "endpoint identity disagreed",
    );
  });
  it("rejects duplicate route ownership", () => {
    expect(() => parse({}, [endpoint("acme"), endpoint("acme")])).toThrow(
      "route ownership was duplicated",
    );
  });
  it("rejects a route whose published name belongs to another model", () => {
    const route = endpoint("acme");
    route.name = "acme | other/model";
    expect(() => parse({}, [route])).toThrow("route identity disagreed");
  });
});
