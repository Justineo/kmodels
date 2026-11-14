import { readFile } from "node:fs/promises";
import { expect, it } from "vite-plus/test";
import {
  dashscopeMarketBundleSchema,
  parseDashscopeMarket,
} from "../src/catalog/dashscope-market.ts";
import { manifests } from "../src/catalog/manifests.ts";
import { parseSource } from "../src/catalog/adapters.ts";
import { dashscopeInferenceFixture } from "./dashscope-inference-fixture.ts";
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
