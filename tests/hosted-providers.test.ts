import { describe, expect, it, vi } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import { collectProvider } from "../src/catalog/collector.ts";
import { fetchSource, linkedDocumentUrls } from "../src/catalog/fetch.ts";
import { compileInferencePriceMapping } from "../src/catalog/inference-pricing-compilation.ts";
import { sha256 } from "../src/catalog/io.ts";
import { manifests, type ProviderManifest } from "../src/catalog/manifests.ts";
import { prepareCatalogPair } from "../src/catalog/pricing-publication.ts";

vi.mock("../src/catalog/fetch.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/catalog/fetch.ts")>()),
  fetchSource: vi.fn(),
}));

const observedAt = "2026-10-20T00:00:00.000Z";

function providerManifest(id: string): ProviderManifest {
  const manifest = manifests.find(({ provider }) => provider.id === id);
  if (manifest === undefined) throw new Error(`Missing provider ${id}`);
  return manifest;
}

function parse(id: string, body: string) {
  const manifest = providerManifest(id);
  const source = manifest.sources[0];
  if (source === undefined) throw new Error(`Missing source for ${id}`);
  return parseSource({
    provider: { ...manifest.provider, source_ids: [source.id] },
    source,
    body,
    observedAt,
  });
}

const togetherCatalog = [
  "## Chat models",
  "| Model name | API model string | Context length | Input pricing (per 1M tokens) | Cached input pricing (per 1M tokens) | Output pricing (per 1M tokens) | Function calling |",
  "| - | - | - | - | - | - | - |",
  "| Vision Chat | Example/Vision-Chat | 4096 | $1 | $0.2 | $3 | Yes |",
  "| Text Chat | Example/Text-Chat | - | Free | - | $2 | - |",
  "## US-only inference",
  "| Model | Input | Cached input | Output |",
  "| - | - | - | - |",
  "| Vision Chat (US-only) | $1.25 | $0.25 | $3.75 |",
  "## Vision models",
  "| Model name | API model string | Context length | Input pricing (per 1M tokens) | Output pricing (per 1M tokens) |",
  "| - | - | - | - | - |",
  "| Vision Chat | Example/Vision-Chat | 4096 | $1 | $3 |",
  "## Image models",
  "| Model name | Model string for API | Unit | Price |",
  "| - | - | - | - |",
  "| Example Image | Example/Image | image | $0.03+ |",
  "## Video models",
  "| Model name | Model string for API | Price per video | Resolution / duration |",
  "| - | - | - | - |",
  "| Example Video | Example/Video | $0.20 | 720p / 5s |",
  "## Audio models",
  "| Model name | Model string for API | Modality | Pricing |",
  "| - | - | - | - |",
  "| Example Audio | Example/ASR | Speech-to-Text | $0.01 per audio min |",
  "## Embedding models",
  "There are currently no embedding models offered via serverless.",
  "## Rerank models",
  "There are currently no rerank models offered via serverless.",
  "## Moderation models",
  "There are currently no moderation models offered via serverless.",
].join("\n");

function payload(body: string) {
  return {
    body,
    contentHash: sha256(body),
    etag: undefined,
    lastModified: undefined,
    dependencies: [],
  };
}

describe("Together AI Serverless", () => {
  it("keeps exact public IDs, cache accounting, and endpoint-specific prices", () => {
    const result = parse("together", togetherCatalog);
    expect(result.models).toHaveLength(5);
    const model = result.models.find(({ model_id }) => model_id === "Example/Vision-Chat");
    expect(model?.modalities).toEqual({ input: ["text", "image"], output: ["text"] });
    expect(model?.price_facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          price: "1",
          conditions: { endpoint: "api.together.ai" },
          charge_binding: expect.objectContaining({
            signal: { namespace: "kmodels", value: "uncached_input_tokens" },
          }),
        }),
        expect.objectContaining({
          price: "0.25",
          meter: "cache_read_text",
          conditions: { endpoint: "us-api.together.ai" },
        }),
      ]),
    );
    const video = result.models.find(({ model_id }) => model_id === "Example/Video");
    expect(video?.api_endpoints).toEqual([{ name: "Video generation", path: "/v2/videos" }]);
    expect(video?.raw_price_facts).toHaveLength(1);
    expect(video?.price_facts).toEqual([]);
    expect(() =>
      parse("together", togetherCatalog.replace("Vision Chat (US-only)", "Unbound (US-only)")),
    ).toThrow(/did not match/);
  });

  it("enriches exact public rows and compiles prices without admitting private inventory", async () => {
    vi.stubEnv("TOGETHER_API_KEY", "fixture");
    try {
      const api = JSON.stringify([
        { id: "Example/Text-Chat", context_length: 8192 },
        { id: "Example/Vision-Chat", context_length: 2048 },
        { id: "Example/Inventory-Only", context_length: 65536 },
      ]);
      vi.mocked(fetchSource).mockImplementation(async ({ id }) =>
        payload(id === "together-api" ? api : togetherCatalog),
      );
      const result = await collectProvider(
        providerManifest("together"),
        undefined,
        { sources: {} },
        observedAt,
      );
      expect(result.coverage.status).toBe("fresh");
      expect(
        result.models.find(({ model_id }) => model_id === "Example/Text-Chat")?.limits
          .context_tokens,
      ).toBe(8192);
      expect(
        result.models.find(({ model_id }) => model_id === "Example/Vision-Chat")?.limits
          .context_tokens,
      ).toBe(4096);
      expect(result.models.some(({ model_id }) => model_id === "Example/Inventory-Only")).toBe(
        false,
      );
      const pricing = result.pricing;
      if (pricing === undefined) throw new Error(JSON.stringify(result.attempt.pricing));
      const candidate = prepareCatalogPair(
        {
          catalog_version: "1".repeat(64),
          generated_at: observedAt,
          providers: [result.provider],
          models: result.models,
          sources: result.sources,
          coverage: [result.coverage],
          warnings: result.warnings,
        },
        {
          provider_vocabularies: [pricing.vocabulary],
          provider_snapshots: [pricing.snapshot],
          model_dispositions: pricing.model_dispositions,
          books: pricing.books,
        },
      );
      expect(
        compileInferencePriceMapping(candidate, result.inferencePriceSources ?? []).inference
          ?.mapping.rules,
      ).toEqual(
        expect.arrayContaining([expect.objectContaining({ model_id: "Example/Vision-Chat" })]),
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

const fireworksRoot = "https://fireworks.ai/models";
const fireworksDocs = "https://docs.fireworks.ai/serverless";
const chatSlug = "publisher/example";
const chatId = "accounts/fireworks/models/example";
const routerId = "accounts/fireworks/routers/example-fast";
const decisionId = "accounts/fireworks/models/decide";
const library = [
  {
    slug: chatSlug,
    serverless: true,
    serverlessApi: true,
    contextLength: "8192",
    tags: ["Chat"],
    supportsImageInput: true,
  },
  {
    slug: "fireworks/decide",
    serverless: true,
    serverlessApi: true,
    contextLength: null,
    tags: ["Chat"],
    supportsImageInput: false,
  },
  { slug: "publisher/dedicated-only", serverless: true, serverlessApi: false },
];
const index = {
  url: fireworksRoot,
  body: `<a href="/models/publisher/dedicated-only/">Dedicated</a><script>self.__next_f.push(${JSON.stringify([1, `a:${JSON.stringify(["$", "$L1", null, { models: library }])}\n`])})</script>`,
};

function card(slug: string, id: string, name: string) {
  return {
    url: `${fireworksRoot}/${slug}/`,
    body: `<link rel="canonical" href="${fireworksRoot}/${slug}"><h1>${name}</h1><div><span>model path:</span><span>${id}</span><button aria-label="Copy model path"></button></div><section><h2>Available Serverless</h2><p>$1 / $0.2 / $3</p><div><p>Per 1M Tokens (input/cached input/output)</p></div></section>`,
  };
}

const fireworkBundle = {
  index,
  documents: [
    card(chatSlug, chatId, "Example"),
    card("fireworks/decide", decisionId, "Decide"),
    {
      url: `${fireworksDocs}/pricing.md`,
      body: [
        "## Text and vision models",
        "| Model | Standard | Priority |",
        "| - | - | - |",
        "| [Example](https://app.fireworks.ai/models/fireworks/example) | $1 / $0.2 / $3 | $2 / $0.4 / $6 |",
        "| [Example Fast](https://app.fireworks.ai/models/fireworks/example) | $4 / $0.8 / $12 | — |",
        "## Decision models",
        "| Model | Standard | Priority |",
        "| - | - | - |",
        "| [Decide](https://app.fireworks.ai/models/fireworks/decide) | $1 / $0.2 / $0 | — |",
      ].join("\n"),
    },
    {
      url: `${fireworksDocs}/serverless-modes.md`,
      body: [
        "## Fast",
        "| Model | `model` ID |",
        "| - | - |",
        `| Example Fast | \`${routerId}\` |`,
        "## Ultra-fast (Preview)",
        "| Model | `model` ID |",
        "| - | - |",
        "| Another Model | `accounts/fireworks/routers/another-ultrafast` |",
      ].join("\n"),
    },
    {
      url: `${fireworksDocs}/us-only-serverless.md`,
      body: "## Available models\n| Model | `model` ID |\n| - | - |\n| Another Model | `accounts/fireworks/routers/another-us` |",
    },
  ],
};

describe("Fireworks AI Serverless", () => {
  it("discovers eligible cards and preserves published model and router identities", () => {
    const source = providerManifest("fireworks").sources[0];
    if (source === undefined) throw new Error("Missing Fireworks source");
    expect(linkedDocumentUrls(index.body, source).map(({ href }) => href)).toEqual([
      `${fireworksRoot}/fireworks/decide/`,
      `${fireworksRoot}/${chatSlug}/`,
    ]);
    const { models, inference_prices } = parse("fireworks", JSON.stringify(fireworkBundle));
    expect(models.map(({ model_id }) => model_id)).toEqual([
      chatId,
      decisionId,
      routerId,
      "accounts/fireworks/routers/another-ultrafast",
      "accounts/fireworks/routers/another-us",
    ]);
    expect(models[3]?.price_facts).toEqual([]);
    expect(models[0]?.price_facts).toContainEqual(
      expect.objectContaining({
        meter: "input_text",
        price: "2",
        conditions: { service_tier: "priority" },
      }),
    );
    expect(models[1]?.tasks).toEqual([]);
    expect(models[1]?.price_facts.map(({ meter }) => meter)).toEqual([
      "input_text",
      "cache_read_text",
    ]);
    expect(inference_prices).toContainEqual(
      expect.objectContaining({ model_id: routerId, model_ref: `fireworks/${routerId}` }),
    );
  });

  it("rejects an incomplete card crawl", () => {
    const incomplete = { ...fireworkBundle, documents: fireworkBundle.documents.slice(1) };
    expect(() => parse("fireworks", JSON.stringify(incomplete))).toThrow(
      /omitted a serverless model card/,
    );
  });
});

describe("NVIDIA hosted NIM", () => {
  it("reads exact hosted identifiers with unknown lifecycle and pricing", () => {
    const entry = { id: "vendor/nim-model", object: "model", created: 1234 };
    const { models } = parse("nvidia", JSON.stringify({ object: "list", data: [entry] }));
    expect(models).toEqual([
      expect.objectContaining({
        model_id: "vendor/nim-model",
        status: "unknown",
        pricing_state: "unknown",
        price_facts: [],
      }),
    ]);
    expect(models[0]?.release_date).toBeUndefined();
    expect(() => parse("nvidia", JSON.stringify({ object: "list", data: [entry, entry] }))).toThrow(
      /repeated a model ID/,
    );
  });
});
