import { expect, it } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import { manifests } from "../src/catalog/manifests.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";

const manifest = manifests.find(({ provider }) => provider.id === "vertex");
const catalogSource = manifest?.sources.find(({ id }) => id === "vertex-google-models");
const pricingSource = manifest?.sources.find(({ id }) => id === "vertex-pricing");
if (
  !manifest ||
  !catalogSource ||
  !pricingSource ||
  catalogSource.extractor.kind !== "vertex-catalog"
)
  throw new Error("Missing Vertex sources");
const provider = { ...manifest.provider, source_ids: [catalogSource.id, pricingSource.id] };
const observedAt = "2026-11-15T00:00:00.000Z";
const models = parseSource({
  provider,
  source: {
    ...catalogSource,
    extractor: { ...catalogSource.extractor, minModels: 1, minModelDocuments: 1 },
  },
  observedAt,
  body: JSON.stringify({
    index: { url: catalogSource.url, body: "<main></main>" },
    documents: [
      ["omni-flash-preview", "Gemini Omni Flash Preview", "gemini-omni-flash-preview"],
      ["omni-1-1-flash", "Gemini Omni 1.1 Flash (Preview)", "gemini-omni-1.1-flash-preview"],
      ["nano-banana-2-1", "Gemini Nano Banana 2.1", "gemini-nano-banana-2.1"],
    ].map(([path, name, id]) => ({
      url: `https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/${path}`,
      body: `<main><div class="devsite-article-body"><h1>${name}</h1><table><tr><th>Model ID</th><td><code>${id}</code></td></tr><tr><th>Modalities</th><td>Inputs: Text Outputs: Text</td></tr></table></div></main>`,
    })),
  }),
}).models;

function prices(label = "Gemini Nano Banana 2.1 <sup>[4]</sup>") {
  if (!pricingSource) throw new Error("Missing pricing source");
  return parseSource({
    provider,
    source: pricingSource,
    observedAt,
    catalogModels: models,
    body: JSON.stringify({
      index: {
        url: pricingSource.url,
        body: `<main><h2>Gemini Omni</h2><table><tr><th>Model</th><th>Type</th><th>Token Price /1M (USD)</th></tr>
        <tr><td>Gemini Omni Flash, Gemini Omni 1.1 Flash</td><td>Input (text, image, video, audio)*</td><td>$1.50</td></tr>
        <tr><td></td><td>Text output (response and reasoning)</td><td>$9.00</td></tr></table>
        <h2>Nano Banana</h2><button role="tab" id="batch">Batch</button><div role="tabpanel" aria-labelledby="batch"><table><tr><th>Model</th><th>Type</th><th>Region</th><th>Price (/1M tokens)</th><th>Price (/1M tokens) cached input tokens</th></tr>
        <tr><td><p>${label}</p></td><td>Input (text, image, video) <sup>[4]</sup></td><td>Global</td><td>$0.75</td><td>$0.075</td></tr>
        <tr><td></td><td>Text output (response and reasoning)</td><td>Global</td><td>$3.75</td><td>N/A</td></tr></table>
        <p>[4] Gemini Nano Banana 2.1 charges 1120 tokens per input image, with approximate output image costs scaling by resolution: 1120 tokens ($0.034) for 1K (roughly 1MP), 1680 tokens ($0.05) for 2K (roughly 4MP), and 3780 tokens ($0.113) for 4K (roughly 16MP). Gemini Nano Banana 2.1 does not support Flex</p></div></main>`,
      },
      documents: [],
    }),
  });
}

it("joins owned Preview display titles without changing request IDs or aliases", () => {
  expect(
    models
      .filter(({ model_id }) => model_id.includes("omni"))
      .map(({ model_id, name, aliases }) => ({ model_id, name, aliases })),
  ).toEqual([
    { model_id: "gemini-omni-1.1-flash-preview", name: "Gemini Omni 1.1 Flash", aliases: [] },
    { model_id: "gemini-omni-flash-preview", name: "Gemini Omni Flash", aliases: [] },
  ]);
  for (const id of ["gemini-omni-flash-preview", "gemini-omni-1.1-flash-preview"]) {
    const model = prices().models.find(({ model_id }) => model_id === id);
    expect(model).toBeDefined();
    expect(model?.price_facts).toContainEqual(
      expect.objectContaining({ meter: "input_text", price: "1.50" }),
    );
    expect(model?.price_facts).toContainEqual(
      expect.objectContaining({ meter: "output_text", price: "9.00" }),
    );
  }
});

it("retains the footnoted Nano Banana Batch scope through canonical assembly", () => {
  const parsed = prices();
  const model = parsed.models.find(({ model_id }) => model_id === "gemini-nano-banana-2.1");
  expect(model).toBeDefined();
  expect(model?.price_facts).toContainEqual(
    expect.objectContaining({
      meter: "input_text",
      price: "0.75",
      conditions: expect.objectContaining({ service_tier: "batch", deployment_scope: "global" }),
    }),
  );
  expect(model?.price_facts).toContainEqual(
    expect.objectContaining({ meter: "cache_read_text", price: "0.075" }),
  );
  const canonical = assembleParsedProviderPricing(
    "vertex",
    observedAt,
    [{ source: pricingSource, ...parsed }],
    models,
  );
  const book = canonical?.books.find(({ scope }) =>
    scope.model_refs.includes("vertex/gemini-nano-banana-2.1"),
  );
  expect(book).toBeDefined();
  expect(
    book?.offers
      .flatMap(({ terms }) => terms)
      .filter((term) => term.kind === "rate")
      .flatMap(({ variants }) => variants)
      .map(({ price }) => price.value),
  ).toContainEqual({ numerator: "3", denominator: "4000000" });
  expect(
    prices("Gemini Nano Banana 2.1 [new variant]").models.some(
      ({ model_id }) => model_id === "gemini-nano-banana-2.1",
    ),
  ).toBe(false);
});
