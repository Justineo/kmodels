import { expect, it } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { parseSource } from "../src/catalog/adapters.ts";
import { manifests, type SourceManifest } from "../src/catalog/manifests.ts";
import { baseModel } from "../src/catalog/model.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";
import { evaluateRateCost } from "../src/catalog/pricing-calculation.ts";
import type { PricingReconciliationItem } from "../src/catalog/pricing-reconciliation.ts";
import type { ParsedProviderModel } from "../src/catalog/pricing-source.ts";

const at = "2026-11-02T04:00:00.000Z";
const manifest = manifests.find(({ provider }) => provider.id === "vertex");
const pricingSource = manifest?.sources.find(({ id }) => id === "vertex-pricing");
const catalogSource: SourceManifest | undefined = manifest?.sources.find(
  ({ id }) => id === "vertex-google-models",
);
if (
  !manifest ||
  !pricingSource ||
  !catalogSource ||
  catalogSource.extractor.kind !== "vertex-catalog"
)
  throw new Error("Missing Vertex sources");
const provider = { ...manifest.provider, source_ids: manifest.sources.map(({ id }) => id) };
const source = {
  ...catalogSource,
  extractor: { ...catalogSource.extractor, minModels: 1, minModelDocuments: 1 },
};

it("keeps retired Imagen revision identities from the merged card associated with their count quotes", async () => {
  const url =
    "https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/imagen/3-0-generate";
  expect(catalogSource.linkedDocuments?.documents).toContainEqual(
    expect.objectContaining({ url, optional: true, claimLocal: true }),
  );
  const parsed = parseSource({
    provider,
    source: { ...source, extractor: { ...source.extractor, minModelDocuments: 0 } },
    observedAt: at,
    body: JSON.stringify({
      index: { url: source.url, body: "<main></main>" },
      documents: [
        {
          url,
          body: await readFile(
            new URL("./fixtures/vertex/imagen-3-merged.html", import.meta.url),
            "utf8",
          ),
        },
      ],
    }),
  });
  expect(
    parsed.models.map(({ model_id, name, status, retired_at }) => ({
      model_id,
      name,
      status,
      retired_at,
    })),
  ).toEqual([
    {
      model_id: "imagen-3.0-generate-001",
      name: "Imagen 3.0",
      status: "retired",
      retired_at: "2026-06-30",
    },
    {
      model_id: "imagen-3.0-generate-002",
      name: "Imagen 3.0",
      status: "retired",
      retired_at: "2026-06-30",
    },
  ]);
  const pricing = parseSource({
    provider,
    source: pricingSource,
    observedAt: at,
    catalogModels: parsed.models,
    body: JSON.stringify({
      index: {
        url: pricingSource.url,
        body: "<main><h2>Imagen</h2><table><tr><th>Model</th><th>Feature</th><th>Price (USD)</th></tr><tr><td>Imagen 3</td><td>Image generation</td><td>$0.03 / 1 count</td></tr></table></main>",
      },
      documents: [],
    }),
  });
  expect(pricing.models).toHaveLength(2);
  expect(
    pricing.models.every(
      (m) =>
        m.price_facts.length === 0 &&
        m.raw_price_facts.some((f) => f.reason === "unknown_unit" && f.raw.amount === "0.03"),
    ),
  ).toBe(true);
});

it("prices reviewed Veo count rows in generated seconds without extending the contract to Lite", () => {
  const models = catalog("Veo 3.1", ["Generate", "Fast Generate", "Lite Generate"]).map(
    (model, index) => {
      const id = ["veo-3.1-generate-001", "veo-3.1-fast-generate-001", "veo-3.1-lite-generate-001"][
        index
      ];
      if (id === undefined) throw new Error("Missing fixture model");
      return { ...model, uid: `vertex/${id}`, model_id: id };
    },
  );
  const parsed = parseSource({
    provider,
    source: pricingSource,
    observedAt: at,
    catalogModels: models,
    body: JSON.stringify({
      index: {
        url: pricingSource.url,
        body: `<main><h2>Veo</h2><table>
    <tr><th>Model</th><th>Feature</th><th>Output Resolution</th><th>Price (USD)</th></tr>
    <tr><td>Veo 3.1</td><td>Video + Audio generation</td><td>720p, 1080p</td><td>$0.40 / 1 count</td></tr>
    <tr><td></td><td></td><td>4k</td><td>$0.60 / 1 count</td></tr>
    <tr><td>Veo 3.1 Fast</td><td>Video generation</td><td>720p</td><td>$0.08 / 1 count</td></tr>
    <tr><td>Veo 3.1 Lite</td><td>Video generation</td><td>720p</td><td>$0.03 / 1 count</td></tr>
    </table></main>`,
      },
      documents: [],
    }),
  });
  const [veo, fast, lite] = [
    "veo-3.1-generate-001",
    "veo-3.1-fast-generate-001",
    "veo-3.1-lite-generate-001",
  ].map((id) => parsed.models.find((m) => m.model_id === id));
  if (!veo || !fast || !lite) throw new Error("Missing reviewed video models");
  expect(veo.price_facts).toHaveLength(3);
  expect(veo.price_facts.every((f) => f.unit === "second")).toBe(true);
  expect(veo.raw_price_facts).toEqual([]);
  expect(fast.price_facts).toEqual([expect.objectContaining({ price: "0.08", unit: "second" })]);
  expect(lite.price_facts).toEqual([]);
  expect(lite.raw_price_facts).toEqual([
    expect.objectContaining({
      reason: "unknown_unit",
      raw: expect.objectContaining({ amount: "0.03" }),
    }),
  ]);
  const partition = assembleParsedProviderPricing(
    "vertex",
    at,
    [{ source: pricingSource, ...parsed }],
    models,
  );
  const term = partition?.books
    .find((b) => b.scope.model_refs.includes(veo.uid))
    ?.offers[0]?.terms.find((t) => t.kind === "rate" && t.meter.value === "video_generation");
  if (term?.kind !== "rate") throw new Error("Missing generated-second tariff");
  const variant = term.variants.find(
    (v) => v.price.value.numerator === "2" && v.price.value.denominator === "5",
  );
  if (variant?.charge_binding === undefined) throw new Error("Missing generated-second binding");
  expect(
    evaluateRateCost(variant, [
      {
        signal: { namespace: "provider", provider_id: "vertex", value: "video_duration_seconds" },
        value: { numerator: "4", denominator: "1" },
      },
      {
        signal: { namespace: "provider", provider_id: "vertex", value: "generated_video_count" },
        value: { numerator: "2", denominator: "1" },
      },
    ]),
  ).toMatchObject({ kind: "resolved", amount: { numerator: "16", denominator: "5" } });
  expect(evaluateRateCost(variant, [])).toMatchObject({ kind: "missing_input" });
});

it.each([false, true])(
  "parses embedding token tables once with their request tiers and modalities (article=%s)",
  (article) => {
    const models = [
      ["gemini-embedding-2", "Gemini Embedding 2"],
      ["multilingual-e5-small-maas", "multilingual-e5-small"],
    ].map(([id, name]) => {
      if (id === undefined || name === undefined) throw new Error("Missing embedding fixture");
      return {
        ...baseModel({ providerId: "vertex", id, name, sourceId: source.id, observedAt: at }),
        tasks: ["embeddings" as const],
        service_families: ["publishers/google"],
      };
    });
    const parsed = parseSource({
      provider,
      source: pricingSource,
      observedAt: at,
      catalogModels: models,
      body: JSON.stringify({
        index: {
          url: pricingSource.url,
          body: `<main>${article ? '<div class="devsite-article-body">' : ""}<h2>Embedding models</h2><div>
      <table><tr><th>Model</th><th>Type</th><th>Description</th><th>Request Type</th><th>Price /1M tokens (USD)</th></tr>
      <tr><td>Gemini Embedding 2</td><td>Input text</td><td>Text embeddings</td><td>Online requests</td><td>$0.20</td></tr>
      <tr><td></td><td></td><td></td><td>Batch requests</td><td>$0.10</td></tr>
      <tr><td></td><td>Input image</td><td>Image embeddings</td><td>Online requests</td><td>$0.45</td></tr>
      <tr><td></td><td></td><td></td><td>Batch requests</td><td>$0.225</td></tr>
      </table>
      <table><tr><th>Open Source Model</th><th>Type</th><th>Request Type</th><th>Price /1M tokens (USD)</th></tr>
      <tr><td>multilingual-e5-small</td><td>Input</td><td>Online requests</td><td>$0.015</td></tr>
      <tr><td></td><td>Batch Input</td><td>Batch requests</td><td>$0.0075</td></tr></table>
      </div>${article ? "</div>" : ""}</main>`,
        },
        documents: [],
      }),
    });
    const gemini = parsed.models.find(({ model_id }) => model_id === "gemini-embedding-2");
    const e5 = parsed.models.find(({ model_id }) => model_id === "multilingual-e5-small-maas");
    if (!gemini || !e5) throw new Error("Missing embedding prices");
    expect(gemini.price_facts).toHaveLength(4);
    expect(
      gemini.price_facts.map(({ meter, price, conditions }) => [
        meter,
        price,
        conditions.service_tier,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ["input_text", "0.20", "standard"],
        ["input_text", "0.10", "batch"],
        ["input_image", "0.45", "standard"],
        ["input_image", "0.225", "batch"],
      ]),
    );
    expect(e5.price_facts).toHaveLength(2);
    expect(
      e5.price_facts.map(({ price, conditions }) => [
        price,
        conditions.service_tier,
        conditions.modality,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ["0.015", "standard", undefined],
        ["0.0075", "batch", undefined],
      ]),
    );
    expect(gemini.raw_price_facts).toEqual([]);
    const partition = assembleParsedProviderPricing(
      "vertex",
      at,
      [{ source: pricingSource, ...parsed }],
      models,
    );
    if (partition === undefined) throw new Error("Missing embedding partition");
    expect(
      partition.books
        .flatMap(({ offers }) =>
          offers.flatMap(({ terms }) =>
            terms.flatMap((term) => (term.kind === "raw" ? term.variants : term.raw_variants)),
          ),
        )
        .some(({ reason }) => reason === "conflicting_values"),
    ).toBe(false);
  },
);

function catalog(title: string, headings: string[]) {
  return parseSource({
    provider,
    source,
    observedAt: at,
    body: JSON.stringify({
      index: { url: source.url, body: "<main></main>" },
      documents: [
        {
          url: "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/veo/3-1-generate",
          body: `<main><div class="devsite-article-body"><h1>${title}</h1>${headings
            .map(
              (heading, index) => `
        <h2>${heading}</h2><table><tr><th>Model ID</th><td><code>veo-media-${index}</code></td></tr>
        <tr><th>Modalities</th><td>Inputs: Text Outputs: Video</td></tr></table>`,
            )
            .join("")}</div></main>`,
        },
      ],
    }),
  }).models;
}

it.each([false, true])(
  "uses owned media variant headings without changing literal model IDs (version=%s)",
  (version) => {
    const models = catalog(
      "Veo 3.1",
      ["Generate", "Fast Generate", "Lite Generate"].map(
        (heading) => `${version ? "3.1 " : ""}${heading}`,
      ),
    );
    expect(models.map(({ model_id, name, aliases }) => ({ model_id, name, aliases }))).toEqual([
      { model_id: "veo-media-0", name: "Veo 3.1", aliases: [] },
      { model_id: "veo-media-1", name: "Veo 3.1 Fast", aliases: [] },
      { model_id: "veo-media-2", name: "Veo 3.1 Lite", aliases: [] },
    ]);
    expect(catalog("Other Model", ["Generate", "Fast Generate"]).map(({ name }) => name)).toEqual([
      "Other Model Generate",
      "Other Model Fast Generate",
    ]);
    expect(
      catalog("Imagen 4", ["4.0 Generate 001", "4.0 Ultra Generate 001"]).map(({ name }) => name),
    ).toEqual(["Imagen 4.0", "Imagen 4.0 Ultra"]);
  },
);

it.each([false, true])(
  "keeps wrapped media quotes, continuation rows and exact model ownership (article=%s)",
  (article) => {
    const models = catalog("Veo 3.1", ["Generate", "Fast Generate"]);
    const lyria: ParsedProviderModel = {
      ...baseModel({
        providerId: "vertex",
        id: "lyria-002",
        name: "Lyria 2",
        sourceId: source.id,
        observedAt: at,
      }),
      tasks: ["audio_generation"],
      service_families: ["publishers/google"],
    };
    const body = `<h2>Veo</h2><div><div role="region" aria-label="Untrusted caption">
    <blockquote><h3>Imagen</h3></blockquote>
    <table><tr><th>Model</th><th>Feature</th><th>Output Resolution</th><th>Price (USD)</th></tr>
    <tr><td>Veo 3.1</td><td>Video + Audio generation</td><td>720p, 1080p</td><td>$0.40 / 1 count</td></tr>
    <tr><td></td><td></td><td>4k</td><td>$0.60 / 1 count</td></tr>
    <tr><td>Veo 3.1 Fast</td><td>Video generation</td><td>720p</td><td>$0.10/second</td></tr>
    <tr><td>Unreviewed model</td><td>Video generation</td><td>720p</td><td>$99/second</td></tr>
    <tr><td></td><td></td><td>1080p</td><td>$99/second</td></tr></table></div></div>
    <h2>Lyria</h2><div><table><tr><th>Model</th><th>Feature</th><th>Price (USD)</th></tr>
    <tr><td>Lyria 2</td><td>Music generation</td><td>$0.06 / 1 count</td></tr></table></div>`;
    const findings: PricingReconciliationItem[] = [];
    const parsed = parseSource({
      provider,
      source: pricingSource,
      observedAt: at,
      catalogModels: [...models, lyria],
      body: JSON.stringify({
        index: {
          url: pricingSource.url,
          body: `<main>${article ? '<div class="devsite-article-body">' : ""}${body}${article ? "</div>" : ""}</main>`,
        },
        documents: [],
      }),
      onPricingReconciliation: (item) => findings.push(item),
    });
    const veo = parsed.models.find(({ model_id }) => model_id === "veo-media-0");
    const fast = parsed.models.find(({ model_id }) => model_id === "veo-media-1");
    const music = parsed.models.find(({ model_id }) => model_id === "lyria-002");
    if (!veo || !fast || !music) throw new Error("Missing media quote");
    expect(veo.price_facts).toEqual([]);
    expect(veo.raw_price_facts).toHaveLength(3);
    expect(
      veo.raw_price_facts.every(
        ({ reason, raw }) => reason === "unknown_unit" && raw.meter === "video_generation",
      ),
    ).toBe(true);
    expect(veo.raw_price_facts).toContainEqual(
      expect.objectContaining({
        conditions: expect.objectContaining({ resolution: "4k" }),
        raw: expect.objectContaining({ amount: "0.60", unit: "$0.60 / 1 count" }),
      }),
    );
    expect(fast.price_facts).toEqual([
      expect.objectContaining({ meter: "video_generation", price: "0.10", unit: "second" }),
    ]);
    expect(
      parsed.models.flatMap(({ price_facts }) => price_facts).some(({ price }) => price === "99"),
    ).toBe(false);
    expect(findings).toContainEqual(
      expect.objectContaining({ reason_code: "pricing_model_unbound", sample: "Unreviewed model" }),
    );
    expect(music.price_facts).toEqual([
      expect.objectContaining({ meter: "output_audio", price: "60", unit: "thousand_items" }),
    ]);
    const partition = assembleParsedProviderPricing(
      "vertex",
      at,
      [{ source: pricingSource, ...parsed }],
      [...models, lyria],
    );
    const term = partition?.books.find(({ scope }) => scope.model_refs.includes(music.uid))
      ?.offers[0]?.terms[0];
    if (term?.kind !== "rate" || term.variants[0] === undefined)
      throw new Error("Missing music rate");
    const signal = term.variants[0].charge_binding?.signal;
    if (signal === undefined) throw new Error("Missing music quantity binding");
    expect(
      evaluateRateCost(term.variants[0], [{ signal, value: { numerator: "2", denominator: "1" } }]),
    ).toMatchObject({ kind: "resolved", amount: { numerator: "3", denominator: "25" } });
    expect(evaluateRateCost(term.variants[0], [])).toMatchObject({ kind: "missing_input" });
  },
);
