import { readFile } from "node:fs/promises";
import { expect, it } from "vite-plus/test";
import { normalizeOllamaModelPage } from "../src/catalog/fetch.ts";
import { parseSource } from "../src/catalog/adapters.ts";
import { manifests } from "../src/catalog/manifests.ts";
import {
  applyOllamaPublicPricing,
  ollamaPricedModelPageIds,
} from "../src/catalog/ollama-pricing.ts";
import { baseModel } from "../src/catalog/model.ts";
import { publishedRate } from "../src/catalog/pricing.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";

const value = manifests.find(({ provider }) => provider.id === "ollama");
const source = value?.sources.find(({ id }) => id === "ollama-cloud-models");
if (value === undefined || source === undefined) throw new Error("Missing Ollama configuration");
const provider = { ...value.provider, source_ids: value.sources.map(({ id }) => id) };
const observedAt = "2026-10-20T00:00:00.000Z";
const publicPricing = () =>
  readFile(new URL("./fixtures/ollama/pricing.html", import.meta.url), "utf8");
const model = (id: string) => ({
  ...baseModel({ providerId: provider.id, id, name: id, sourceId: source.id, observedAt }),
  service_families: ["Ollama Cloud"],
});

it("binds a priced family page to its explicitly documented and listed Cloud API tag", async () => {
  if (source.extractor.kind !== "ollama-cloud") throw new Error("Wrong Ollama source");
  const page = await readFile(
    new URL("./fixtures/ollama/mistral-cloud-page.html", import.meta.url),
    "utf8",
  );
  for (const witness of [
    "all",
    "no-api-example",
    "no-tag-link",
    "no-list",
    "conflicting-example",
  ]) {
    const body =
      witness === "no-api-example"
        ? page.replace(/<pre>[\s\S]*?<\/pre>/, "")
        : witness === "no-tag-link"
          ? page.replace(/<a[\s\S]*?<\/a>/, "")
          : witness === "conflicting-example"
            ? page.replace(
                "</body>",
                '<pre>curl https://ollama.com/api/chat -d \'{"model":"mistral-large-3:other"}\'</pre></body>',
              )
            : page;
    const parsed = parseSource({
      provider,
      source: { ...source, extractor: { ...source.extractor, minModels: 1 } },
      observedAt,
      body: JSON.stringify({
        list: { models: [{ model: witness === "no-list" ? "unrelated" : "mistral-large-3:675b" }] },
        pages: [
          {
            model: "mistral-large-3",
            url: "https://ollama.com/library/mistral-large-3",
            body: JSON.parse(normalizeOllamaModelPage("mistral-large-3", body)),
          },
        ],
      }),
    });
    const tagged = parsed.models.find((m) => m.model_id === "mistral-large-3:675b");
    expect(tagged?.price_facts.length ?? 0).toBe(witness === "all" ? 2 : 0);
    if (witness === "all")
      expect(tagged?.price_facts.map((f) => [f.meter, f.price])).toEqual([
        ["input_text", "0.50"],
        ["output_text", "1.50"],
      ]);
  }
});

it("discovers model pages from the owned tariff even when the current Cloud search omits them", () => {
  const table =
    '<section id="model-pricing"><h2>Model pricing</h2><p>Prices are per million tokens.</p><table><tbody><tr><td><a href="/library/mistral-large-3">mistral-large-3</a></td></tr><tr><td><a href="/library/gpt-oss">gpt-oss:20b</a></td></tr><tr><td><a href="https://example.test/library/untrusted">untrusted</a></td></tr><tr><td><a href="/library/unrelated">different</a></td></tr></tbody></table></section><a href="/library/navigation">navigation</a>';
  expect(ollamaPricedModelPageIds(table)).toEqual(["gpt-oss", "mistral-large-3"]);
  expect(ollamaPricedModelPageIds(table.replace("per million tokens", "per request"))).toEqual([]);
});

it.each([false, true])(
  "retains disagreeing family and exact-tag page quotes (reverse=%s)",
  async (reverse) => {
    if (source.extractor.kind !== "ollama-cloud") throw new Error("Wrong Ollama source");
    const page = await readFile(
      new URL("./fixtures/ollama/mistral-cloud-page.html", import.meta.url),
      "utf8",
    );
    const pages = [
      {
        model: "mistral-large-3",
        url: "https://ollama.com/library/mistral-large-3",
        body: JSON.parse(normalizeOllamaModelPage("mistral-large-3", page)),
      },
      {
        model: "mistral-large-3:675b",
        url: "https://ollama.com/library/mistral-large-3:675b",
        body: {
          model: "mistral-large-3:675b",
          title: "mistral-large-3:675b",
          cost: { unit: "1M tokens", variants: [{ input: "0.60", output: "1.50" }] },
        },
      },
    ];
    const parsed = parseSource({
      provider,
      source: { ...source, extractor: { ...source.extractor, minModels: 1 } },
      observedAt,
      body: JSON.stringify({
        list: { models: [{ model: "mistral-large-3:675b" }] },
        pages: reverse ? pages.toReversed() : pages,
      }),
    });
    expect(
      parsed.models
        .find((m) => m.model_id === "mistral-large-3:675b")
        ?.price_facts.filter((f) => f.meter === "input_text")
        .map((f) => f.price)
        .sort(),
    ).toEqual(["0.50", "0.60"]);
  },
);

it("joins the independent model table exactly and publishes its owned weekly schedule", async () => {
  const models = [model("deepseek-v4.1-flash"), model("kimi-k3"), model("gpt-oss:20b")];
  const vocabulary = applyOllamaPublicPricing(
    { provider, source, observedAt, body: "" },
    models,
    await publicPricing(),
  );
  expect(models.map((m) => m.price_facts.length)).toEqual([6, 3, 3]);
  expect(models[2]?.price_facts.map((f) => f.price)).toEqual(["0.07", "0.035", "0.30"]);
  expect(vocabulary).toMatchObject([
    {
      key: "peak",
      schedule: {
        kind: "weekly_time_windows",
        time_zone: "UTC",
        windows: [{ from: "12:00", until: "18:00" }],
      },
    },
    { key: "off_peak", schedule: { kind: "weekly_time_remainder" } },
  ]);
  const partition = assembleParsedProviderPricing(
    provider.id,
    observedAt,
    [{ source, models, vocabulary }],
    models,
    value.pricingCategoricalLabels,
  );
  expect(partition?.books).toHaveLength(3);
  expect(
    partition?.books
      .flatMap((b) => b.offers.flatMap((o) => o.terms))
      .every((t) => t.kind === "rate"),
  ).toBe(true);
});

it("preserves conflicting public quotes as local raw evidence without choosing a source by order", async () => {
  const models = [model("deepseek-v4.1-flash")];
  models[0]?.price_facts.push(
    publishedRate("input_text", "0.31", "million_tokens", source.id, "1M tokens", {
      billing_period: "peak",
    }),
  );
  applyOllamaPublicPricing(
    { provider, source, observedAt, body: "" },
    models,
    await publicPricing(),
  );
  expect(models[0]?.raw_price_facts.map((f) => f.raw.amount)).toEqual(["0.31", "0.30"]);
  expect(models[0]?.price_facts).toHaveLength(5);
});

it("keeps missing component quotes unknown and preserves the published uncached-input meaning", async () => {
  const models = [model("clef")];
  models[0]?.price_facts.push(
    publishedRate("input_text", "0.24", "million_tokens", source.id, "1M tokens"),
  );
  const vocabulary = applyOllamaPublicPricing(
    { provider, source, observedAt, body: "" },
    models,
    await publicPricing(),
  );
  expect(models[0]?.raw_price_facts).toHaveLength(2);
  expect(models[0]?.price_facts[0]?.charge_binding?.signal).toEqual({
    namespace: "kmodels",
    value: "uncached_input_tokens",
  });
  const partition = assembleParsedProviderPricing(
    provider.id,
    observedAt,
    [{ source, models, vocabulary }],
    models,
    value.pricingCategoricalLabels,
  );
  const rates = partition?.books
    .flatMap((b) => b.offers.flatMap((o) => o.terms))
    .filter((t) => t.kind === "rate");
  expect(rates?.[0]?.variants).toHaveLength(1);
  expect(rates?.[0]?.variants[0]?.charge_binding?.signal).toEqual({
    namespace: "kmodels",
    value: "uncached_input_tokens",
  });
});

it("uses an exact model's input-only Cloud billing contract without inventing cache or output rates", async () => {
  if (source.extractor.kind !== "ollama-cloud") throw new Error("Wrong Ollama source");
  const page = await readFile(
    new URL("./fixtures/ollama/clef-billing.html", import.meta.url),
    "utf8",
  );
  for (const witness of ["owned", "missing", "untrusted-link", "wrong-title", "quoted"]) {
    const body =
      witness === "missing"
        ? page.replace("Usage is billed per input token", "Usage is measured in tokens")
        : witness === "untrusted-link"
          ? page.replace("https://ollama.com/pricing", "https://example.test/pricing")
          : witness === "wrong-title"
            ? page.replace("<title>clef</title>", "<title>other</title>")
            : witness === "quoted"
              ? page
                  .replace('<div id="display">', '<div id="display"><blockquote>')
                  .replace("</div>", "</blockquote></div>")
              : page;
    const parsed = parseSource({
      provider,
      source: { ...source, extractor: { ...source.extractor, minModels: 1 } },
      observedAt,
      body: JSON.stringify({
        list: { models: [{ model: "clef" }] },
        pages: [
          {
            model: "clef",
            url: "https://ollama.com/library/clef",
            body: JSON.parse(normalizeOllamaModelPage("clef", body)),
          },
        ],
        documents: [{ url: "https://ollama.com/pricing", body: await publicPricing() }],
      }),
    });
    const clef = parsed.models.find((m) => m.model_id === "clef");
    expect(clef?.raw_price_facts).toHaveLength(witness === "owned" ? 0 : 2);
    expect(clef?.price_facts.map((f) => [f.meter, f.price, f.charge_binding?.signal])).toEqual([
      [
        "input_text",
        "0.24",
        {
          namespace: "kmodels",
          value: witness === "owned" ? "input_tokens" : "uncached_input_tokens",
        },
      ],
    ]);
  }
});

it("withholds the structured rule when the owned schedule claim changes", async () => {
  const models = [model("deepseek-v4.1-flash")];
  const vocabulary = applyOllamaPublicPricing(
    { provider, source, observedAt, body: "" },
    models,
    (await publicPricing()).replace("all day on weekends", "excluding public holidays"),
  );
  expect(vocabulary).toEqual([]);
  expect(models[0]?.price_facts).toHaveLength(6);
});

it("fails only the commercial dependency when the central token denominator is unrecognized", async () => {
  const models = [model("kimi-k3")],
    failures: string[] = [];
  applyOllamaPublicPricing(
    {
      provider,
      source,
      observedAt,
      body: "",
      onPricingDependencyFailure: (url) => failures.push(url),
    },
    models,
    (await publicPricing()).replace("per million tokens", "per thousand tokens"),
  );
  expect(models[0]?.price_facts).toEqual([]);
  expect(failures).toEqual(["https://ollama.com/pricing"]);
});

it("reports availability after reconciling the independent central quotes", async () => {
  if (source.extractor.kind !== "ollama-cloud") throw new Error("Wrong Ollama source");
  const reasons: string[] = [];
  const parsed = parseSource({
    provider,
    source: { ...source, extractor: { ...source.extractor, minModels: 1 } },
    observedAt,
    onPricingReconciliation: (item) => reasons.push(item.reason_code),
    body: JSON.stringify({
      list: { models: [{ model: "kimi-k3" }] },
      documents: [{ url: "https://ollama.com/pricing", body: await publicPricing() }],
    }),
  });
  expect(parsed.models[0]?.price_facts).toHaveLength(3);
  expect(reasons).not.toContain("public_model_rate_unavailable");
});

it("reads visible billing-period labels rather than internal DOM keys", async () => {
  const body = await readFile(
    new URL("./fixtures/ollama/deepseek-page.html", import.meta.url),
    "utf8",
  );
  const page: unknown = JSON.parse(
    normalizeOllamaModelPage(
      "deepseek-v4-flash",
      body
        .replace('data-rate="base">Base', 'data-rate="base">Peak')
        .replace('data-rate="peak">Peak', 'data-rate="peak">Off-Peak'),
    ),
  );
  expect(page).toMatchObject({
    cost: {
      variants: [
        { billing_period: "peak", input: "0.22" },
        { billing_period: "off_peak", input: "0.44" },
      ],
    },
  });
  expect(() =>
    normalizeOllamaModelPage(
      "deepseek-v4-flash",
      body.replace('data-rate="base">Base', 'data-rate="base">Unknown'),
    ),
  ).toThrow("period labels");
});

it.each([
  { url: "https://unreviewed.test/library/model-a" },
  { url: "https://ollama.com/library/another-model" },
  { model: "another-model" },
  { title: "another-model" },
])("withholds a mismatched page while retaining the independent model witness: %j", (change) => {
  const value = manifests.find(({ provider }) => provider.id === "ollama");
  const configured = value?.sources.find(({ id }) => id === "ollama-cloud-models");
  if (value === undefined || configured?.extractor.kind !== "ollama-cloud")
    throw new Error("Missing Ollama source");
  const { url = "https://ollama.com/library/model-a", ...bodyChange } = change;
  const parsed = parseSource({
    provider: { ...value.provider, source_ids: value.sources.map(({ id }) => id) },
    source: { ...configured, extractor: { ...configured.extractor, minModels: 1 } },
    observedAt: "2026-10-20T00:00:00.000Z",
    body: JSON.stringify({
      list: { models: [{ model: "model-a" }] },
      pages: [
        {
          model: "model-a",
          url,
          body: {
            model: "model-a",
            title: "model-a",
            tags: [{ model: "invented-model" }],
            cost: { unit: "1M tokens", variants: [{ input: "1", output: "2" }] },
            ...bodyChange,
          },
        },
      ],
    }),
  });
  expect(parsed.models.map(({ model_id }) => model_id)).toEqual(["model-a"]);
  expect(parsed.models[0]?.price_facts).toEqual([]);
});
