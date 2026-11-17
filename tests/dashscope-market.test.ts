import { readFile } from "node:fs/promises";
import { expect, it } from "vite-plus/test";
import {
  dashscopeMarketBundleSchema,
  parseDashscopeMarket,
} from "../src/catalog/dashscope-market.ts";
import { manifests } from "../src/catalog/manifests.ts";
import { parseSource } from "../src/catalog/adapters.ts";
import { dashscopeInferenceFixture } from "./dashscope-inference-fixture.ts";
import { extractDashscopePricingInputs } from "../src/catalog/dashscope-accounting.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";
import { catalogRepairCandidates } from "../src/catalog/catalog-repair.ts";
import {
  sourcePricingReconciliation,
  type PricingReconciliationItem,
} from "../src/catalog/pricing-reconciliation.ts";
import {
  sourcePriceFactSchema,
  sourceRawPricingFactSchema,
} from "../src/catalog/pricing-source.ts";

const manifest = manifests.find(({ provider }) => provider.id === "dashscope");
const source = manifest?.sources.find(({ id }) => id === "dashscope-pricing");
if (!manifest || !source) throw new Error("Missing DashScope source");
const input = {
  provider: { ...manifest.provider, source_ids: [source.id] },
  source,
  observedAt: "2026-11-14T00:00:00Z",
  body: "",
};
const fixture: unknown = JSON.parse(
  await readFile(new URL("./fixtures/dashscope/market-prices.json", import.meta.url), "utf8"),
);

it("normalizes Batch Chat suffixes and speech character tariffs without borrowing token units", async () => {
  const body: unknown = JSON.parse(
    await readFile(
      new URL("./fixtures/dashscope/market-static-tariffs.json", import.meta.url),
      "utf8",
    ),
  );
  const result = parseDashscopeMarket(input, body);
  const chat = result.models.find(({ model_id }) => model_id === "qwen3.6-flash");
  expect(chat?.price_facts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        meter: "input_text",
        price: "0.165",
        unit: "million_tokens",
        conditions: expect.objectContaining({ service_tier: "batch", context_max_tokens: 256000 }),
      }),
      expect.objectContaining({
        meter: "output_text",
        price: "0.99",
        conditions: expect.objectContaining({ service_tier: "batch" }),
      }),
      expect.objectContaining({
        meter: "input_text",
        price: "0.33",
        conditions: {
          region: "China (Beijing)",
          context_min_tokens: 0,
          context_max_tokens: 256000,
        },
      }),
    ]),
  );
  expect(
    result.models.find(({ model_id }) => model_id === "cosyvoice-v3.5-flash")?.price_facts,
  ).toEqual([
    expect.objectContaining({
      meter: "output_audio",
      price: "11.6",
      unit: "million_characters",
      raw_price: "0.116",
      raw_unit: "Per 10,000 characters",
    }),
  ]);
  const unreviewed: unknown = JSON.parse(
    JSON.stringify(body).replaceAll("Per 10,000 characters", "Per voice"),
  );
  const voice = parseDashscopeMarket(input, unreviewed).models.find(
    ({ model_id }) => model_id === "cosyvoice-v3.5-flash",
  );
  expect(voice?.price_facts).toEqual([]);
  expect(voice?.raw_price_facts).toContainEqual(
    expect.objectContaining({
      raw: expect.objectContaining({ amount: "0.116", unit: "Per voice" }),
    }),
  );
});

it.each([
  { type: "new_charge_alpha", priceUnit: "Per 1M tokens", tool: false },
  { type: "new_charge_beta", priceUnit: "Per 1M tokens", tool: false },
  { type: "input_token", priceUnit: "Per new billing unit", tool: false },
  { type: "new_service", priceUnit: "Per new service unit", tool: true },
])(
  "routes an owned unmapped quote to repair while preserving known siblings: $type / $priceUnit",
  ({ type, priceUnit, tool }) => {
    const items: PricingReconciliationItem[] = [];
    const parsed = parseDashscopeMarket(
      { ...input, onPricingReconciliation: (item) => items.push(item) },
      {
        market: [
          {
            region: "ap-southeast-1",
            scope: "international",
            models: [
              {
                model: "new-public-model",
                scope: "PUBLIC",
                serviceSites: ["international"],
                supports: { inference: true },
                prices: [
                  {
                    type: "output_token",
                    priceName: "Output",
                    price: "8.3",
                    priceUnit: "Per 1M tokens",
                  },
                  ...(tool
                    ? []
                    : [{ type, priceName: "New provider tariff", price: "2.7", priceUnit }]),
                ],
                builtInToolMultiPrices: tool
                  ? [
                      {
                        type,
                        name: "New provider tariff",
                        supportedApi: "Responses API",
                        prices: [{ price: "2.7", priceUnit, currency: "USD" }],
                      },
                    ]
                  : [],
              },
            ],
          },
        ],
      },
    );
    const model = parsed.models[0];
    if (!model) throw new Error("Missing model");
    expect(model.price_facts).toMatchObject([{ meter: "output_text", price: "8.3" }]);
    const raw = tool
      ? parsed.commercial.flatMap(({ raw_price_facts }) => raw_price_facts)
      : model.raw_price_facts;
    expect(raw).toMatchObject([
      {
        conditions: { region: "Singapore", deployment_scope: "International" },
        raw: {
          amount: "2.7",
          denomination: "USD",
          label: "New provider tariff",
          unit: priceUnit,
          meter: type,
        },
      },
    ]);
    const pricing_reconciliation = sourcePricingReconciliation(parsed.models, items, true);
    expect(pricing_reconciliation.diagnostic_count).toBe(1);
    expect(pricing_reconciliation.diagnostics[0]?.sample).toContain(type);
    for (const outcome of ["changed", "unchanged"]) {
      const candidates = catalogRepairCandidates({
        schema_version: 2,
        generated_at: input.observedAt,
        providers: [
          {
            provider_id: "dashscope",
            signals: [],
            attempt: {
              outcome: "accepted",
              pricing: { outcome: "accepted" },
              sources: [{ source_id: source.id, outcome, pricing_reconciliation }],
            },
          },
        ],
      });
      expect(candidates).toMatchObject([
        { source_id: source.id, trigger: "source_pricing_structure" },
      ]);
      expect(candidates[0]?.message).toContain(type);
    }
  },
);

it("normalizes the published per-page tool quote and keeps unknown tool units raw", () => {
  const items: PricingReconciliationItem[] = [];
  const parsed = parseDashscopeMarket(
    { ...input, onPricingReconciliation: (item) => items.push(item) },
    {
      market: [
        {
          region: "ap-southeast-1",
          scope: "international",
          models: [
            {
              model: "qwen3.8-max",
              scope: "PUBLIC",
              serviceSites: ["international"],
              supports: { inference: true },
              prices: [
                {
                  type: "input_token",
                  priceName: "Input",
                  price: "1.65",
                  priceUnit: "Per 1M tokens",
                },
              ],
              builtInToolMultiPrices: [
                {
                  type: "pdf_parsing",
                  name: "Document parsing",
                  supportedApi: "Completions API",
                  prices: [{ price: "0.003", priceUnit: "Per page", currency: "USD" }],
                },
                {
                  type: "new_service",
                  name: "Unreviewed tool",
                  supportedApi: "Completions API",
                  prices: [{ price: "0.75", priceUnit: "Per new service unit", currency: "USD" }],
                },
              ],
            },
          ],
        },
      ],
    },
  );
  const [service, unreviewed] = parsed.commercial;
  expect(service).toMatchObject({
    book_key: "service:market:pdf_parsing",
    pricing_state: "numeric",
    price_facts: [{ meter: "tool_call", price: "0.003", unit: "page", currency: "USD" }],
    raw_price_facts: [],
  });
  expect(unreviewed).toMatchObject({
    book_key: "service:market:new_service",
    pricing_state: "unknown",
    price_facts: [],
    raw_price_facts: [{ reason: "unknown_unit", raw: { unit: "Per new service unit" } }],
  });
  expect(items.filter(({ sample }) => sample?.endsWith(":input_token") !== true)).toMatchObject([
    {
      disposition: "normalized",
      reason_code: "market_tool_price",
      sample: expect.stringContaining("pdf_parsing"),
    },
    {
      disposition: "raw",
      reason_code: "unsupported_pricing_cell_preserved",
      sample: expect.stringContaining("new_service"),
    },
  ]);
});

it("normalizes each published cache TTL and keeps reads independent of creation TTL", async () => {
  const market: unknown = JSON.parse(
    await readFile(new URL("./fixtures/dashscope/qwen4-market.json", import.meta.url), "utf8"),
  );
  const parsed = parseDashscopeMarket(input, { market });
  for (const model of parsed.models) {
    expect(model.raw_price_facts).toEqual([]);
    for (const rate of model.price_facts.filter(({ meter }) => meter === "cache_read_text"))
      expect(rate.conditions).not.toHaveProperty("cache_ttl_seconds");
  }
  expect(
    parsed.models.flatMap(({ price_facts }) =>
      price_facts
        .filter(({ meter }) => meter === "cache_write_text")
        .map(({ price, conditions }) => [conditions.region, conditions.cache_ttl_seconds, price]),
    ),
  ).toEqual([
    ["Singapore", 300, "1.875"],
    ["Singapore", 3600, "3"],
    ["Germany (Frankfurt)", 300, "1.767"],
    ["Germany (Frankfurt)", 3600, "2.827"],
    ["China (Beijing)", 300, "1.767"],
    ["China (Beijing)", 3600, "2.827"],
  ]);
});

it("keeps Beijing billing prices independent of an unproven physical deployment scope", async () => {
  const market: unknown = JSON.parse(
    await readFile(new URL("./fixtures/dashscope/qwen4-market.json", import.meta.url), "utf8"),
  );
  const parsed = parseDashscopeMarket(input, { market });
  const beijing = parsed.models.filter((model) =>
    model.price_facts.some(({ conditions }) => conditions.region === "China (Beijing)"),
  );
  expect(beijing).toHaveLength(1);
  expect(beijing[0]?.price_facts).toHaveLength(6);
  for (const rate of beijing[0]?.price_facts ?? [])
    expect(rate.conditions).not.toHaveProperty("deployment_scope");
  const frankfurt = parsed.models.find((model) =>
    model.price_facts.some(({ conditions }) => conditions.region === "Germany (Frankfurt)"),
  );
  expect(
    frankfurt?.price_facts.every(({ conditions }) => conditions.deployment_scope === "Global"),
  ).toBe(true);
});

it("retains cache creation evidence when the duration semantics are unreviewed", () => {
  const parsed = parseDashscopeMarket(input, {
    market: [
      {
        region: "ap-southeast-1",
        scope: "international",
        models: [
          {
            model: "future-model",
            scope: "PUBLIC",
            serviceSites: ["international"],
            supports: { inference: true },
            prices: [
              {
                type: "input_token_cache_creation_custom",
                priceName: "Explicit Cache Creation: provider-defined retention",
                price: "4",
                priceUnit: "Per 1M tokens",
              },
            ],
          },
        ],
      },
    ],
  });
  expect(parsed.models[0]?.raw_price_facts).toMatchObject([
    {
      reason: "unknown_meter",
      conditions: {
        cache_mode: "explicit",
        region: "Singapore",
        deployment_scope: "International",
      },
      raw: { amount: "4", unit: "Per 1M tokens" },
    },
  ]);
  expect(parsed.models[0]?.raw_price_facts[0]?.conditions).not.toHaveProperty("cache_ttl_seconds");
});

it("reads TTL-specific quantities only from their own protocol usage section", async () => {
  const body = await readFile(
    new URL("./fixtures/dashscope/qwen4-cache.md", import.meta.url),
    "utf8",
  );
  const url = "https://www.alibabacloud.com/help/en/model-studio/explicit-cache-qwen4.md";
  const facts = extractDashscopePricingInputs([{ url, body }], source.id);
  expect(
    new Set(
      facts
        .filter(({ key }) => key.endsWith("1h_input_tokens"))
        .map(({ key, locator }) => [key, locator.value]),
    ),
  ).toEqual(
    new Set([
      [
        "chat.cache_creation_1h_input_tokens",
        "/usage/prompt_tokens_details/cache_creation/ephemeral_1h_input_tokens",
      ],
      [
        "chat.stream.cache_creation_1h_input_tokens",
        "/usage/prompt_tokens_details/cache_creation/ephemeral_1h_input_tokens",
      ],
      [
        "responses.cache_creation_1h_input_tokens",
        "/usage/input_tokens_details/cache_write_tokens_details/ttl_1h_tokens",
      ],
      [
        "responses.stream.cache_creation_1h_input_tokens",
        "/response/usage/input_tokens_details/cache_write_tokens_details/ttl_1h_tokens",
      ],
      [
        "anthropic.cache_creation_1h_input_tokens",
        "/usage/cache_creation/ephemeral_1h_input_tokens",
      ],
    ]),
  );
  const withoutResponses = extractDashscopePricingInputs(
    [{ url, body: body.replace(/<Tab title="OpenAI compatible Responses">[\s\S]*?<\/Tab>/, "") }],
    source.id,
  );
  expect(withoutResponses.some(({ key }) => key.startsWith("responses."))).toBe(false);
  expect(withoutResponses.some(({ key }) => key === "chat.cache_creation_1h_input_tokens")).toBe(
    true,
  );
  expect(facts.some(({ key }) => key.startsWith("native."))).toBe(false);
  expect(facts.every(({ model_refs }) => model_refs?.includes("dashscope/qwen4-max"))).toBe(true);
  const findings: unknown[] = [];
  expect(
    extractDashscopePricingInputs(
      [{ url, body: body.replace("## View cache usage", "## Usage examples") }],
      source.id,
      (finding) => findings.push(finding),
    ),
  ).toEqual([]);
  expect(findings.length).toBeGreaterThan(0);
});

it("does not transfer Qwen4 cache counters to another model with the same tariff shape", async () => {
  const market: unknown = JSON.parse(
    await readFile(new URL("./fixtures/dashscope/qwen4-market.json", import.meta.url), "utf8"),
  );
  const model = parseDashscopeMarket(input, { market }).models[0];
  if (!model) throw new Error("Missing Qwen4 market fixture");
  const models = [
    model,
    { ...model, uid: "dashscope/unrelated-model", model_id: "unrelated-model" },
  ];
  const body = await readFile(
    new URL("./fixtures/dashscope/qwen4-cache.md", import.meta.url),
    "utf8",
  );
  const pricing_inputs = extractDashscopePricingInputs(
    [{ url: "https://www.alibabacloud.com/help/en/model-studio/explicit-cache-qwen4.md", body }],
    source.id,
  );
  const partition = assembleParsedProviderPricing(
    "dashscope",
    input.observedAt,
    [{ source, models, pricing_inputs }],
    models,
  );
  const books = partition?.books.filter(({ scope }) => scope.kind === "models");
  expect(books).toHaveLength(2);
  for (const book of books ?? []) {
    const writes = book.offers.flatMap(({ terms }) =>
      terms.flatMap((term) =>
        term.kind === "rate" && term.meter.value === "cache_write_text" ? term.variants : [],
      ),
    );
    expect(writes).toHaveLength(2);
    const methods = writes.flatMap(({ charge_binding }) => charge_binding?.quantity_methods ?? []);
    expect(methods.length > 0).toBe(
      book.scope.kind === "models" && book.scope.model_refs.includes("dashscope/qwen4-max"),
    );
  }
});

it("keeps regional cache tariffs, scope-specific prices and decimal billing tiers", () => {
  const parsed = parseDashscopeMarket(input, { market: fixture });
  const rates = parsed.models
    .filter(({ model_id }) => model_id === "deepseek-v4-pro")
    .flatMap(({ price_facts }) => price_facts.filter(({ meter }) => meter === "cache_read_text"));
  expect(
    rates.map(({ price, currency, conditions }) => [
      conditions.region,
      conditions.deployment_scope,
      price,
      currency,
    ]),
  ).toEqual([
    ["Singapore", "International", "0.2", "USD"],
    ["Germany (Frankfurt)", "Global", "0.138", "USD"],
    ["Japan (Tokyo)", "Japan", "0.2", "USD"],
  ]);
  const plus = parsed.models.find(({ model_id }) => model_id === "qwen3.7-plus");
  expect(plus).toBeDefined();
  expect(plus?.price_facts.find(({ meter }) => meter === "input_text")).toMatchObject({
    price: "0.4",
    conditions: { context_max_tokens: 256000 },
  });
  expect(plus?.raw_price_facts.find(({ impact }) => impact === "informational")).toMatchObject({
    raw: { amount: "0.8" },
  });
  for (const model of parsed.models) {
    model.price_facts.forEach((price) => sourcePriceFactSchema.parse(price));
    model.raw_price_facts.forEach((price) => sourceRawPricingFactSchema.parse(price));
  }
  expect(
    parsed.commercial.some(
      ({ model_refs, resource_kind, price_facts }) =>
        resource_kind === "service" &&
        model_refs.includes("dashscope/deepseek-v4-pro") &&
        price_facts.some(({ price }) => price === "0.573411"),
    ),
  ).toBe(true);
});

it("preserves unknown meters and empty tool denominators without guessing a price contract", () => {
  const result = parseDashscopeMarket(input, {
    market: [
      {
        region: "eu-central-1",
        scope: "global",
        models: [
          {
            model: "future-model",
            scope: "PUBLIC",
            serviceSites: ["global"],
            supports: { inference: true },
            prices: [
              {
                type: "future_meter",
                priceName: "Future charge",
                price: "3",
                priceUnit: "Per new unit",
              },
            ],
            builtInToolMultiPrices: [
              {
                type: "code_interpreter",
                name: "code_interpreter",
                supportedApi: "Responses API",
                prices: [{ price: "0", priceUnit: "", currency: "USD" }],
              },
            ],
          },
        ],
      },
    ],
  });
  expect(result.models[0]?.raw_price_facts[0]).toMatchObject({
    reason: "unknown_meter",
    conditions: { region: "Germany (Frankfurt)", deployment_scope: "Global" },
    raw: { amount: "3", unit: "Per new unit", denomination: "USD" },
  });
  const tool = result.commercial[0];
  expect(result.inferenceUrls.get("future-model")).toBe(
    "https://modelstudio.console.alibabacloud.com/eu-central-1/model/market/detail/future-model",
  );
  expect(tool?.raw_price_facts[0]).toMatchObject({ reason: "unknown_unit", raw: { amount: "0" } });
  expect(tool?.price_facts).toEqual([]);
  tool?.raw_price_facts.forEach((price) => sourceRawPricingFactSchema.parse(price));
});

it.each(["foreign scope", "private model", "duplicate", "unknown region"])(
  "rejects %s market claims",
  (scenario) => {
    const parsed = dashscopeMarketBundleSchema.parse({ market: fixture });
    const context = parsed.market?.[0];
    if (!context) throw new Error("Missing fixture context");
    const model = context.models[0];
    if (typeof model !== "object" || model === null) throw new Error("Missing model");
    const invalid = {
      ...context,
      ...(scenario === "unknown region" ? { region: "unknown" } : {}),
      models:
        scenario === "duplicate"
          ? [model, model]
          : [
              {
                ...model,
                ...(scenario === "private model" ? { scope: "PRIVATE" } : {}),
                ...(scenario === "foreign scope" ? { serviceSites: ["global"] } : {}),
              },
            ],
    };
    expect(() => parseDashscopeMarket(input, { market: [invalid] })).toThrow();
  },
);

it("keeps Batch File, thinking, time bands and contradictory media labels separate", () => {
  const parsed = parseDashscopeMarket(input, {
    market: [
      {
        region: "eu-central-1",
        scope: "global",
        models: [
          {
            model: "scoped-model",
            scope: "PUBLIC",
            serviceSites: ["global"],
            supports: { inference: true },
            prices: [
              { type: "input_token", priceName: "Input", price: "1", priceUnit: "Per 1M tokens" },
              {
                type: "thinking_input_token_batch",
                priceName: "Input(Thinking Batch File)",
                price: "2",
                priceUnit: "Per 1M tokens",
                timeBand: "peak",
              },
              {
                type: "video_ratio_540p",
                priceName: "Video Generation(480P)",
                price: "3",
                priceUnit: "Per second",
              },
              {
                type: "720P_no_audio",
                priceName: "Video Generation(720P no audio)",
                price: "4",
                priceUnit: "Per second",
              },
              {
                type: "omni_audio_output_token",
                priceName: "Output: Text&Audio (Output text is not charged)",
                price: "5",
                priceUnit: "Per 1M tokens",
              },
            ],
          },
        ],
      },
    ],
  });
  const model = parsed.models[0];
  if (!model) throw new Error("Missing model");
  expect(model.price_facts.find(({ price }) => price === "2")).toMatchObject({
    meter: "input_text",
    conditions: { operation: "thinking_mode", service_tier: "batch", billing_period: "peak" },
  });
  expect(model.price_facts.find(({ price }) => price === "4")).toMatchObject({
    meter: "video_generation",
    conditions: { resolution: "720P", audio: false },
  });
  expect(model.raw_price_facts.find(({ raw }) => raw.amount === "3")).toMatchObject({
    reason: "unknown_applicability",
    raw: { label: "Video Generation(480P)", meter: "video_ratio_540p" },
  });
  expect(
    model.raw_price_facts.find(({ raw }) => raw.amount === "3")?.conditions,
  ).not.toHaveProperty("resolution");
  expect(model.raw_price_facts.find(({ raw }) => raw.amount === "5")).toMatchObject({
    reason: "unknown_applicability",
  });
});

it("uses the exact published cache creation price instead of a rounded generic multiplier", async () => {
  const bundle = (await dashscopeInferenceFixture()).get("dashscope-pricing");
  if (!bundle) throw new Error("Missing pricing fixture");
  const cache = bundle.documents.find(({ url }) => url.includes("context-cache"));
  if (!cache) throw new Error("Missing cache fixture");
  cache.body = (
    await readFile(new URL("./fixtures/dashscope/cache-current.md", import.meta.url), "utf8")
  )
    .replaceAll("Singapore", "US (Virginia)")
    .replaceAll("Qwen Max: qwen3.8-max", "Qwen Plus: qwen-plus");
  const parsed = parseSource({
    ...input,
    body: JSON.stringify({
      ...bundle,
      market: [
        {
          region: "us-east-1",
          scope: "global",
          models: [
            {
              model: "qwen-plus",
              scope: "PUBLIC",
              serviceSites: ["global"],
              supports: { inference: true },
              prices: [
                {
                  type: "input_token_cache_creation_5m",
                  priceName: "5-Minute Explicit Cache Creation",
                  price: "0.143",
                  priceUnit: "Per 1M tokens",
                },
              ],
            },
          ],
        },
      ],
    }),
  });
  const model = parsed.models.find(({ model_id }) => model_id === "qwen-plus");
  if (!model) throw new Error("Missing qwen-plus");
  const writes = model.price_facts.filter(
    ({ meter, conditions }) =>
      meter === "cache_write_text" &&
      conditions.region === "US (Virginia)" &&
      conditions.deployment_scope === "Global",
  );
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ price: "0.143", derived: false });
  expect(
    model.price_facts.some(
      ({ meter, derived, conditions }) =>
        meter === "cache_read_text" &&
        derived &&
        conditions.region === "US (Virginia)" &&
        conditions.cache_mode === "explicit",
    ),
  ).toBe(true);
});
