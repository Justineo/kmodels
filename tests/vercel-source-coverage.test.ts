import { readFile } from "node:fs/promises";
import { expect, it } from "vite-plus/test";
import { vercelCommercialFacts } from "../src/catalog/vercel-commercial-source.ts";
import { extractVercelPricingInputs } from "../src/catalog/vercel-accounting.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";
import { manifests } from "../src/catalog/manifests.ts";
import { evaluateApplicability } from "../src/catalog/pricing-applicability.ts";
import { vercelPricingContracts } from "../src/catalog/vercel-pricing-contracts.ts";

const searchPath = "/docs/ai-gateway/models-and-providers/web-search.md";
const livePath = "/docs/ai-gateway/modalities/realtime/gpt-live.md";
const fixture = (name: string) =>
  readFile(new URL(`./fixtures/vercel/${name}.md`, import.meta.url), "utf8");
const parse = (body: string) =>
  vercelCommercialFacts({ documents: new Map([[searchPath, body]]), sourceId: "vercel-models" });

it("publishes newly documented search and fetch services independently of model inventory", async () => {
  const facts = parse(await fixture("additional-services"));
  expect(new Set(facts.map((f) => f.resource_key))).toEqual(
    new Set([
      "exa-search",
      "tako-search",
      "browserbase-search",
      "browserbase-fetch",
      "deepseek-search",
      "deepseek-fetch",
    ]),
  );
  expect(
    facts
      .find((f) => f.resource_key === "exa-search")
      ?.price_facts.map((f) => [f.conditions.search_effort, f.price]),
  ).toEqual([
    ["auto", "7"],
    ["fast", "7"],
    ["instant", "4"],
  ]);
  expect(
    facts
      .find((f) => f.resource_key === "browserbase-fetch")
      ?.price_facts.map((f) => [f.conditions.format, f.conditions.proxies, f.price]),
  ).toEqual([
    ["raw", false, "1"],
    ["raw", true, "4"],
    ["markdown", false, "4"],
    ["markdown", true, "7"],
    ["json", false, "4"],
    ["json", true, "7"],
  ]);
  for (const key of ["deepseek-search", "deepseek-fetch"])
    expect(facts.find((f) => f.resource_key === key)?.price_facts[0]).toMatchObject({
      price: "0.75",
      unit: "thousand_requests",
    });

  expect(
    facts
      .filter((f) => f.resource_key === "tako-search")
      .flatMap((f) => f.raw_price_facts)
      .map((f) => f.term_key),
  ).toEqual(["data_export_surcharge", "variable_data_surcharge"]);
  const manifest = manifests.find((m) => m.provider.id === "vercel");
  const source = manifest?.sources[0];
  if (!source) throw new Error("Missing Vercel source");
  const partition = assembleParsedProviderPricing(
    "vercel",
    "2026-11-15T00:00:00Z",
    [{ source, models: [], commercial_facts: facts }],
    [],
  );
  const fetch = partition?.books.find((b) => b.book_key === "service:browserbase-fetch");
  const rates = fetch?.offers[0]?.terms.flatMap((t) => (t.kind === "rate" ? t.variants : [])) ?? [];
  for (const [format, proxies, numerator] of [
    ["raw", false, "1"],
    ["raw", true, "4"],
    ["markdown", false, "4"],
    ["markdown", true, "7"],
    ["json", false, "4"],
    ["json", true, "7"],
  ] as const) {
    const matched = rates.filter(
      (v) =>
        evaluateApplicability(v.applicability, [
          {
            kind: "categorical",
            dimension: { namespace: "provider", provider_id: "vercel", value: "format" },
            value: { namespace: "provider", provider_id: "vercel", value: format },
          },
          {
            kind: "boolean",
            dimension: { namespace: "provider", provider_id: "vercel", value: "proxies" },
            value: proxies,
          },
        ]).state === "true",
    );
    expect(matched.map((v) => v.price.value)).toEqual([
      numerator === "4"
        ? { numerator: "1", denominator: "250" }
        : { numerator, denominator: "1000" },
    ]);
  }
  expect(
    rates.every(
      (v) =>
        v.applicability.any_of[0]?.all_of.length === 2 &&
        v.charge_binding?.quantity_methods === undefined,
    ),
  ).toBe(true);
  expect(partition?.vocabulary.atoms).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: "dimension", key: "format", resolution_phase: "outcome" }),
      expect.objectContaining({ kind: "dimension", key: "proxies", resolution_phase: "outcome" }),
    ]),
  );
  for (const key of ["deepseek-search", "deepseek-fetch"]) {
    const terms =
      partition?.books.find((b) => b.book_key === `service:${key}`)?.offers[0]?.terms ?? [];
    const variant = terms.flatMap((t) => (t.kind === "rate" ? t.variants : []))[0];
    expect(variant?.price.value).toEqual({ numerator: "3", denominator: "4000" });
    expect(variant?.charge_binding?.quantity_methods).toBeUndefined();
    expect(variant?.charge_binding?.signal).toMatchObject({
      namespace: "provider",
      value: `${key.replaceAll("-", "_")}_billable_requests`,
    });
  }
});

it("withholds only a changed service tariff and never prices the Tako cap as an amount", async () => {
  const body = await fixture("additional-services");
  for (const changed of [
    body.replace("Routing through proxies adds $3", "Routing through proxies adds $4"),
    body.replace("options actually sent upstream", "requested options"),
  ]) {
    const facts = parse(changed);
    expect(facts.some((f) => f.resource_key === "browserbase-fetch")).toBe(false);
    expect(facts.some((f) => f.resource_key === "deepseek-search")).toBe(true);
  }
  const facts = parse(body.replace("empty results are not billed", "empty results are billed"));
  expect(facts.some((f) => f.resource_key?.startsWith("deepseek-"))).toBe(false);
  expect(
    facts
      .filter((f) => f.resource_key === "tako-search")
      .flatMap((f) => f.price_facts)
      .map((f) => f.price),
  ).toEqual(["7", "7", "12"]);
});

it("uses only GPT-Live's final cumulative duration and withholds a changed finalization contract", async () => {
  const body = await fixture("live-usage");
  const parse = (body: string) =>
    extractVercelPricingInputs(new Map([[livePath, body]]), "vercel-models");
  expect(parse(body)).toEqual([
    expect.objectContaining({
      key: "live.final_session_seconds",
      model_refs: ["vercel/openai/gpt-live-1"],
      channel: "stream_event",
      availability: "terminal_only",
      locator: { kind: "provider_field", value: "session.closed.usage.seconds" },
    }),
  ]);
  expect(parse(body.replace("**cumulative totals**", "**increments**"))).toEqual([]);
  expect(parse(body.replaceAll("session.closed.usage.seconds", "usage.elapsed"))).toEqual([]);
  expect(parse(body.replace("openai/gpt-live-1", "other/live"))).toEqual([]);
});

it("recognizes the owned peak-price renderer across minifier names without joining unrelated prose", async () => {
  const body = await readFile(
    new URL("./fixtures/vercel/peak-component.txt", import.meta.url),
    "utf8",
  );
  expect(vercelPricingContracts(body)).toEqual({
    token_peak_basis: "listed_off_peak_with_multiplier",
  });
  for (const changed of [
    body.replace("Listed prices are the off-peak rate.", "Listed prices are the peak rate."),
    body.replace("Math.round(100*c)/100", "Math.round(100*d)/100"),
    body.replace("multiplier:c", "unrelated:c"),
  ])
    expect(vercelPricingContracts(changed)).toEqual({});
});

it("recognizes current X-search item labels without depending on the minified item variable", async () => {
  const body = await readFile(
    new URL("./fixtures/vercel/search-component.txt", import.meta.url),
    "utf8",
  );
  expect(vercelPricingContracts(body)).toEqual({ x_search_units: "fetched_posts_and_profiles" });
  expect(vercelPricingContracts(body.replace('unit:"posts"', 'unit:"calls"'))).toEqual({});
});
