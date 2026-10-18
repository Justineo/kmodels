import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import {
  applyMistralPricingPolicy,
  mistralCurrencyUrl,
  mistralPriorityUrl,
  parseMistralPricingPolicy,
} from "../src/catalog/mistral-pricing-policy.ts";
import { baseModel } from "../src/catalog/model.ts";
import { publishedRate } from "../src/catalog/pricing.ts";
import type { PricingReconciliationItem } from "../src/catalog/pricing-reconciliation.ts";

const fixture = (name: string) =>
  readFile(new URL(`./fixtures/mistral/${name}`, import.meta.url), "utf8");

async function policy(
  overrides: { currency?: string | null; priority?: string | null; duplicate?: boolean } = {},
) {
  const currency =
    overrides.currency === undefined ? await fixture("pricing-currency.ts") : overrides.currency;
  const priority =
    overrides.priority === undefined ? await fixture("priority-tier.md") : overrides.priority;
  const documents = [
    ...(currency === null ? [] : [{ url: mistralCurrencyUrl, body: currency }]),
    ...(priority === null ? [] : [{ url: mistralPriorityUrl, body: priority }]),
  ];
  if (overrides.duplicate && documents[0] !== undefined) documents.push(documents[0]);
  const items: PricingReconciliationItem[] = [];
  const result = parseMistralPricingPolicy(
    { index: { url: "https://docs.mistral.ai/inference/pricing", body: "fixture" }, documents },
    "mistral-pricing",
    (item) => items.push(item),
  );
  return { result, items };
}

function model(price = "1.5") {
  const result = baseModel({
    providerId: "mistral",
    id: "example",
    name: "Example",
    sourceId: "mistral-pricing",
    observedAt: "2026-10-18T00:00:00.000Z",
  });
  result.api_endpoints = [{ name: "Chat", path: "/v1/chat/completions" }];
  result.price_facts = [
    publishedRate("input_text", price, "million_tokens", "mistral-pricing", "per M tokens", {
      billing_currency: "USD",
    }),
  ];
  return result;
}

describe("Mistral pricing policy boundaries", () => {
  it("reads changed published factors instead of freezing the reviewed values", async () => {
    const { result } = await policy({
      currency: (await fixture("pricing-currency.ts")).replace("0.85", "0.9"),
      priority: (await fixture("priority-tier.md")).replace("1.75", "2"),
    });
    const value = model();
    applyMistralPricingPolicy(value, result, undefined);
    expect(value.price_facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currency: "EUR",
          price: "1.35",
          conditions: { billing_currency: "EUR", service_tier: "standard" },
        }),
        expect.objectContaining({
          currency: "USD",
          price: "3",
          conditions: {
            billing_currency: "USD",
            service_tier: "priority",
            endpoint: "/v1/chat/completions",
          },
        }),
      ]),
    );
  });

  it.each([
    ["mutable factor", (body: string) => body.replace("const USD_TO_EUR", "let USD_TO_EUR")],
    [
      "changed formula",
      (body: string) => body.replace("priceUsd * USD_TO_EUR", "priceUsd / USD_TO_EUR"),
    ],
    [
      "duplicate converter",
      (body: string) =>
        `${body}\nexport function convertUsdPrice(priceUsd: number) { return priceUsd; }`,
    ],
  ])("isolates %s without losing Priority or USD rates", async (_label, change) => {
    const { result, items } = await policy({
      currency: change(await fixture("pricing-currency.ts")),
    });
    expect(result.euro).toBeUndefined();
    const value = model();
    applyMistralPricingPolicy(value, result, undefined);
    expect(value.price_facts.map(({ price, currency }) => ({ price, currency }))).toEqual([
      { price: "1.5", currency: "USD" },
      { price: "2.625", currency: "USD" },
    ]);
    expect(items).toContainEqual({
      disposition: "unbound",
      reason_code: "pricing_policy_unavailable",
      sample: "currency",
    });
  });

  it("isolates absent or duplicate companions at their owned policy", async () => {
    const missing = await policy({ priority: null });
    expect(missing.result).toMatchObject({ euro: { factor: "0.85" }, inputs: [] });
    expect(missing.result.priority).toBeUndefined();
    const duplicate = await policy({ duplicate: true });
    expect(duplicate.result.euro).toBeUndefined();
    expect(duplicate.result.priority).toBe("1.75");
  });

  it("retains bounded unresolved tariffs when both price policies are unavailable", async () => {
    const { result } = await policy({ currency: null, priority: null });
    const value = model();
    applyMistralPricingPolicy(value, result, undefined);
    expect(value.price_facts).toEqual([
      expect.objectContaining({
        currency: "USD",
        price: "1.5",
        conditions: { billing_currency: "USD", service_tier: "standard" },
      }),
    ]);
    expect(value.raw_price_facts.map(({ conditions }) => conditions)).toEqual([
      { billing_currency: "EUR", service_tier: "standard" },
      { billing_currency: "EUR", service_tier: "priority", endpoint: "/v1/chat/completions" },
      { billing_currency: "USD", service_tier: "priority", endpoint: "/v1/chat/completions" },
    ]);
    expect(value.raw_price_facts.every(({ impact }) => impact === "base_price")).toBe(true);
  });

  it("keeps the known Priority price rule when the response selector drifts", async () => {
    const { result } = await policy({
      priority: (await fixture("priority-tier.md")).replace('"service_tier"', '"requested_tier"'),
    });
    expect(result.priority).toBe("1.75");
    expect(result.inputs).toEqual([]);
    const value = model();
    applyMistralPricingPolicy(value, result, undefined);
    expect(value.price_facts.some(({ conditions }) => conditions.service_tier === "priority")).toBe(
      true,
    );
  });

  it("does not infer an exact EUR display amount beyond the reviewed precision", async () => {
    const { result } = await policy();
    const value = model("0.00000003");
    const items: PricingReconciliationItem[] = [];
    applyMistralPricingPolicy(value, result, (item) => items.push(item));
    expect(value.price_facts.every(({ currency }) => currency === "USD")).toBe(true);
    expect(items).toContainEqual({
      disposition: "unsupported",
      reason_code: "eur_display_precision_not_exact",
      sample: "example",
    });
    expect(value.raw_price_facts).toContainEqual(
      expect.objectContaining({
        conditions: {
          billing_currency: "EUR",
          service_tier: "priority",
          endpoint: "/v1/chat/completions",
        },
      }),
    );
  });

  it("checks EUR precision after the Priority multiplier as well as before it", async () => {
    const { result } = await policy();
    const value = model("0.00001");
    applyMistralPricingPolicy(value, result, undefined);
    expect(value.price_facts.filter(({ currency }) => currency === "EUR")).toEqual([
      expect.objectContaining({
        price: "0.0000085",
        conditions: { billing_currency: "EUR", service_tier: "standard" },
      }),
    ]);
  });
});
