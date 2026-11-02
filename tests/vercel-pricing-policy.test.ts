import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import { manifests } from "../src/catalog/manifests.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";
import { vercelCommercialFacts } from "../src/catalog/vercel-commercial-source.ts";
import { modelPricingView } from "../src/catalog/pricing-presentation.ts";
import type { PricingReconciliationItem } from "../src/catalog/pricing-reconciliation.ts";
import { normalizeVercelModelPage, normalizeVercelPricingScript } from "../src/catalog/fetch.ts";
import { evaluateRateCost } from "../src/catalog/pricing-calculation.ts";
import { vercelPageSearchPrices } from "../src/catalog/vercel-pricing-contracts.ts";
import { evaluateApplicability } from "../src/catalog/pricing-applicability.ts";
import { rationalFromDecimal } from "../src/catalog/pricing-rational.ts";

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
  endpoints: readonly unknown[] = [],
  responseId = model.id,
  metadata: Record<string, unknown> = {},
  registry?: string,
  page?: Record<string, unknown>,
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
      documents: [
        ...(page === undefined
          ? []
          : [{ url: "https://vercel.com/ai-gateway/models/text-1", body: JSON.stringify(page) }]),
        ...(registry === undefined
          ? []
          : [
              {
                url: "https://vercel.com/vc-ap-vercel-marketing/_next/static/immutable/chunks/pricing.js",
                body: registry,
              },
            ]),
        ...(endpoints.length === 0
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
            ]),
      ],
    }),
    onPricingReconciliation: (item) => diagnostics.push(item),
  });
  return { result, diagnostics };
}
describe("Vercel price authority", () => {
  it("preserves HeyGen duration tiers and their exact 15-second boundary through assembly", async () => {
    const result = parseSource({
      provider,
      source,
      observedAt,
      body: await readFile(
        new URL("./fixtures/vercel/heygen-duration-tiers.json", import.meta.url),
        "utf8",
      ),
    });
    const partition = assembleParsedProviderPricing(
      "vercel",
      observedAt,
      [{ source, ...result }],
      result.models,
    );
    const offer = partition?.books.find(
      ({ book_key }) => book_key === "model:vercel/heygen/heygen-video-1",
    )?.offers[0];
    const term = offer?.terms.find(
      (term) => term.kind === "rate" && term.meter.value === "video_generation",
    );
    if (term?.kind !== "rate") throw new Error("Missing HeyGen duration prices");
    expect(term.raw_variants).toEqual([]);
    const fixed = (
      [
        ["quality", "text_to_video"],
        ["resolution", "480p"],
        ["route_provider", "heygen"],
      ] as const
    ).map(([value, option]) => ({
      kind: "categorical" as const,
      dimension: { namespace: "kmodels" as const, value },
      value: { namespace: "provider" as const, provider_id: "vercel", value: option },
    }));
    for (const [seconds, numerator, denominator] of [
      ["15", "1", "100"],
      ["15.1", "9", "200"],
    ] as const) {
      const matched = term.variants.filter(
        ({ applicability }) =>
          evaluateApplicability(applicability, [
            ...fixed,
            {
              kind: "decimal",
              dimension: { namespace: "kmodels", value: "duration_seconds" },
              value: seconds,
              unit: { factors: [{ unit: { namespace: "kmodels", value: "second" }, power: 1 }] },
            },
          ]).state === "true",
      );
      expect(matched).toHaveLength(1);
      const rate = matched[0];
      if (rate === undefined) throw new Error("Missing exact duration tariff");
      expect(rate.price.value).toEqual({ numerator, denominator });
      if (rate.charge_binding === undefined) throw new Error("Missing generated-seconds binding");
      expect(
        evaluateRateCost(rate, [
          {
            signal: {
              namespace: "provider",
              provider_id: "vercel",
              value: "requested_video_seconds",
            },
            value: rationalFromDecimal(seconds),
          },
          {
            signal: { namespace: "kmodels", value: "generated_items" },
            value: { numerator: "1", denominator: "1" },
          },
        ]),
      ).toMatchObject({
        kind: "resolved",
        amount: {
          numerator: seconds === "15" ? "3" : "1359",
          denominator: seconds === "15" ? "20" : "2000",
        },
      });
    }
    const reference = term.variants.filter(
      ({ applicability }) =>
        evaluateApplicability(applicability, [
          ...fixed.filter(({ dimension }) => dimension.value !== "quality"),
          {
            kind: "categorical",
            dimension: { namespace: "kmodels", value: "quality" },
            value: { namespace: "provider", provider_id: "vercel", value: "reference_to_video" },
          },
        ]).state === "true",
    );
    expect(reference).toHaveLength(1);
    expect(reference[0]?.price.value).toEqual({ numerator: "7", denominator: "200" });
  });

  it("preserves the hourly transcription denominator and audio quantity through assembly", async () => {
    const fixture = await readFile(
      new URL("./fixtures/vercel/unpriced-transcription.json", import.meta.url),
      "utf8",
    );
    const result = parseSource({
      provider,
      source,
      observedAt,
      body: fixture.replace(
        '\\"AzureLegal:Terms•Privacy\\",\\"\\"',
        '\\"AzureLegal:Terms•Privacy\\",\\"$0.39/hr\\"',
      ),
    });
    const partition = assembleParsedProviderPricing(
      "vercel",
      observedAt,
      [{ source, ...result }],
      result.models,
    );
    const terms = partition?.books
      .find(({ book_key }) => book_key === "model:vercel/microsoft/mai-transcribe-2-streaming")
      ?.offers.flatMap(({ terms }) => terms);
    expect(terms).toHaveLength(1);
    expect(terms?.[0]).toMatchObject({
      kind: "rate",
      meter: { namespace: "kmodels", value: "input_audio" },
      variants: [
        expect.objectContaining({
          charge_binding: expect.objectContaining({
            signal: { namespace: "kmodels", value: "processed_audio_seconds" },
          }),
          price: {
            denomination: { kind: "fiat", currency: "USD" },
            value: { numerator: "13", denominator: "120000" },
            per: { factors: [{ unit: { namespace: "kmodels", value: "second" }, power: 1 }] },
          },
        }),
      ],
      raw_variants: [],
    });
  });
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
  it("keeps documented peak and off-peak prices conditional without inventing a holiday calendar", async () => {
    const body = await readFile(
      new URL("./fixtures/vercel/pricing-contracts.txt", import.meta.url),
      "utf8",
    );
    const registry = normalizeVercelPricingScript(body);
    expect(registry).toBeDefined();
    const { result } = parse(
      { varies_by_provider: true },
      [endpoint("metered", "0.000001", peak), endpoint("fixed")],
      model.id,
      {},
      registry,
    );
    const metered =
      result.models[0]?.price_facts.filter((f) => f.conditions.route_provider === "metered") ?? [];
    expect(
      metered
        .filter((f) => f.meter === "input_text")
        .map((f) => [f.conditions.billing_period, f.price]),
    ).toEqual([
      ["off_peak", "1"],
      ["peak", "2"],
    ]);
    expect(result.models[0]?.raw_price_facts).toEqual([]);
    expect(
      result.models[0]?.price_facts
        .filter((f) => f.conditions.route_provider === "fixed")
        .every((f) => f.conditions.billing_period === undefined),
    ).toBe(true);
    const partition = assembleParsedProviderPricing(
      "vercel",
      observedAt,
      [{ source, ...result }],
      result.models,
    );
    const variant = partition?.books
      .flatMap((b) =>
        b.offers.flatMap((o) => o.terms.flatMap((t) => (t.kind === "rate" ? t.variants : []))),
      )
      .find((v) => v.price.value.numerator === "1" && v.price.value.denominator === "500000");
    if (variant?.charge_binding === undefined) throw new Error("Missing peak input rate");
    expect(
      evaluateRateCost(variant, [
        {
          signal: variant.charge_binding.signal,
          value: { numerator: "1000000", denominator: "1" },
        },
      ]),
    ).toMatchObject({ kind: "resolved", amount: { numerator: "2", denominator: "1" } });
    const drift = normalizeVercelPricingScript(
      body.replace(
        "Listed prices are the off-peak rate.",
        "Listed prices have an unspecified basis.",
      ),
    );
    const unresolved = parse({ input: "0.000001", peak_pricing: peak }, [], model.id, {}, drift);
    expect(unresolved.result.models[0]?.raw_price_facts.length).toBeGreaterThan(0);
  });
  it("separates native X Search item prices from the model's token charges", async () => {
    const body = await readFile(
      new URL("./fixtures/vercel/pricing-contracts.txt", import.meta.url),
      "utf8",
    );
    const route = endpoint("xai");
    const { result } = parse(
      { varies_by_provider: true },
      [
        {
          ...route,
          pricing: {
            ...route.pricing,
            web_search: "0.005",
            x_search_post: "0.005",
            x_search_user: "0.01",
          },
        },
      ],
      model.id,
      {},
      normalizeVercelPricingScript(body),
      {
        title: model.name,
        search_prices: [
          {
            model_id: model.id,
            provider: "xai",
            posts_per_thousand: "5",
            profiles_per_thousand: "10",
          },
        ],
      },
    );
    expect(result.models[0]?.price_facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          meter: "web_search",
          unit: "thousand_items",
          price: "5",
          conditions: { route_provider: "xai", operation: "x_search_post" },
        }),
        expect.objectContaining({
          meter: "web_search",
          unit: "thousand_items",
          price: "10",
          conditions: { route_provider: "xai", operation: "x_search_user" },
        }),
      ]),
    );
    const partition = assembleParsedProviderPricing(
      "vercel",
      observedAt,
      [{ source, ...result }],
      result.models,
    );
    const inference = partition?.books.find((b) => b.scope.kind === "models");
    expect(
      inference?.offers
        .flatMap((o) => o.terms)
        .every((t) => t.kind !== "rate" || t.meter.value !== "web_search"),
    ).toBe(true);
    const search = partition?.books.find((b) => b.book_key === "service:native-web-search");
    expect(
      search?.offers
        .flatMap((o) => o.terms.flatMap((t) => (t.kind === "rate" ? t.variants : [])))
        .map((v) => v.charge_binding?.signal.value)
        .sort(),
    ).toEqual(["billable_x_posts_fetched", "billable_x_profiles_fetched"]);
    const rawSearch = search?.offers
      .flatMap((o) => o.terms)
      .find((t) => t.term_key === "endpoint_web_search");
    if (rawSearch?.kind !== "raw" || rawSearch.variants[0]?.possible_scope === undefined)
      throw new Error("Missing unknown-unit ordinary web-search quote");
    const scope = rawSearch.variants[0].possible_scope;
    const routeSelection = {
      kind: "categorical" as const,
      dimension: { namespace: "kmodels" as const, value: "route_provider" as const },
      value: { namespace: "provider" as const, provider_id: "vercel", value: "xai" },
    };
    for (const operation of ["web_search", "x_search_post", "x_search_user"]) {
      expect(
        evaluateApplicability(scope, [
          routeSelection,
          {
            kind: "categorical",
            dimension: { namespace: "kmodels", value: "operation" },
            value: { namespace: "provider", provider_id: "vercel", value: operation },
          },
        ]).state,
      ).toBe(operation === "web_search" ? "true" : "false");
    }
    const missingPage = parse(
      { varies_by_provider: true },
      [{ ...route, pricing: { ...route.pricing, x_search_post: "0.005" } }],
      model.id,
      {},
      normalizeVercelPricingScript(body),
    );
    expect(missingPage.result.models[0]?.raw_price_facts).toContainEqual(
      expect.objectContaining({ reason: "unknown_unit" }),
    );
  });
  it("reads exact model/route search amounts from the canonical model-detail payload", () => {
    const payload =
      '169:["$","$L171",null,{"backingModels":[{"chef":"spacexai","primaryModel":"grok-4.6","provider":"xai","xSearchPostCost":"5","xSearchUserCost":"10"}]}]\n';
    const html = `<link rel="canonical" href="https://vercel.com/ai-gateway/models/grok-4.6"><script>self.__next_f.push(${JSON.stringify([1, payload])})</script>`;
    expect(vercelPageSearchPrices(html)).toEqual([
      {
        model_id: "spacexai/grok-4.6",
        provider: "xai",
        posts_per_thousand: "5",
        profiles_per_thousand: "10",
      },
    ]);
    expect(JSON.parse(normalizeVercelModelPage(`<h1>Grok 4.6</h1>${html}`, true))).toMatchObject({
      title: "Grok 4.6",
      search_prices: [{ model_id: "spacexai/grok-4.6", provider: "xai", posts_per_thousand: "5" }],
    });
    expect(() => normalizeVercelModelPage("<h1>Grok 4.6</h1>", true)).toThrow(
      "omitted exact search prices",
    );
    expect(
      vercelPageSearchPrices(html.replace("https://vercel.com/", "https://example.test/")),
    ).toEqual([]);
    expect(vercelPageSearchPrices(html.replace("/models/grok-4.6", "/models/other"))).toEqual([]);
    expect(
      vercelPageSearchPrices(
        html.replace('\\"xSearchPostCost\\":\\"5\\"', '\\"xSearchPostCost\\":\\"unknown\\"'),
      ),
    ).toEqual([]);
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
