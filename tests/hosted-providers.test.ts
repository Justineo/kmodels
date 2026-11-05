import { describe, expect, it, vi } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import { collectProvider } from "../src/catalog/collector.ts";
import { fetchSource, linkedDocumentUrls } from "../src/catalog/fetch.ts";
import { compileInferencePriceMapping } from "../src/catalog/inference-pricing-compilation.ts";
import { sha256 } from "../src/catalog/io.ts";
import { manifests, type ProviderManifest } from "../src/catalog/manifests.ts";
import { calculationExport } from "../src/catalog/pricing-calculator-export.ts";
import { prepareCatalogPair } from "../src/catalog/pricing-publication.ts";
import { togetherNextLibraryPage } from "../src/catalog/together-metadata.ts";
import { createInferencePriceLookup } from "../src/pricing/inference.ts";

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

function togetherBundle(body = togetherCatalog) {
  const docs = "https://docs.together.ai/docs";
  return JSON.stringify({
    index: { url: `${docs}/serverless/models.md`, body },
    documents: [
      {
        url: `${docs}/deprecations.md`,
        body: [
          "## Active model redirects",
          "| Original model | Redirects to |",
          "| - | - |",
          "| `Example/Old-Chat` | `Example/Text-Chat` |",
          "## Scheduled deprecations",
          "| Removal date | Model | Recommended replacement |",
          "| - | - | - |",
          "| 2026-10-28 | `Example/Text-Chat` | `Example/Vision-Chat` |",
          "## Deprecation history",
          "### Inference",
          "| Removal date | Model |",
          "| - | - |",
          "| 2026-10-01 | `Example/Image` |",
          "### Fine-tuning",
          "| Removal date | Model |",
          "| - | - |",
          "| 2026-10-01 | `Example/Vision-Chat` |",
        ].join("\n"),
      },
      {
        url: `${docs}/inference/batch/overview.md`,
        body: [
          "## Supported models",
          "Audio models like `Example/ASR` run through `/v1/audio/transcriptions` and `/v1/audio/translations`.",
          "### Discounted models",
          "Selected serverless models run at 50% off batch rates:",
          "| Model ID |",
          "| - |",
          "| `Example/ASR` |",
        ].join("\n"),
      },
      {
        url: `${docs}/inference/messages-api.md`,
        body: "## Supported models\n| API model string | Serverless inference |\n| - | - |\n| `Example/Vision-Chat` | ✓ |\n| `Example/Text-Chat` | - |",
      },
    ],
  });
}

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
    const result = parse("together", togetherBundle());
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
      parse(
        "together",
        togetherBundle(togetherCatalog.replace("Vision Chat (US-only)", "Unbound (US-only)")),
      ),
    ).toThrow(/did not match/);
  });

  it("keeps Serverless lifecycle and batch terms scoped to their exact model and operation", () => {
    const { models, inference_prices } = parse("together", togetherBundle());
    const byId = new Map(models.map((model) => [model.model_id, model]));
    expect(byId.get("Example/Image")).toMatchObject({
      status: "retired",
      retired_at: "2026-10-01",
      price_facts: [],
      raw_price_facts: [],
    });
    expect(byId.get("Example/Image")?.api_endpoints).toBeUndefined();
    expect(inference_prices?.some(({ model_id }) => model_id === "Example/Image")).toBe(false);
    expect(byId.get("Example/Text-Chat")).toMatchObject({
      status: "deprecated",
      retired_at: "2026-10-28",
      replacement_model_ids: ["Example/Vision-Chat"],
      aliases: ["Example/Old-Chat"],
      api_endpoints: [{ path: "/v1/chat/completions" }],
    });
    expect(byId.get("Example/Vision-Chat")).toMatchObject({
      status: "active",
      api_endpoints: expect.arrayContaining([{ name: "Messages", path: "/v1/messages" }]),
    });
    expect(byId.get("Example/ASR")).toMatchObject({
      capabilities: { batch: true },
      api_endpoints: expect.arrayContaining([
        { name: "Translations", path: "/v1/audio/translations" },
      ]),
      price_facts: [
        { price: "0.01", unit: "minute", conditions: { operation: "standard" } },
        { price: "0.005", unit: "minute", conditions: { operation: "batch" }, derived: true },
      ],
    });
  });

  it("enriches exact public rows and compiles prices without admitting private inventory", async () => {
    vi.stubEnv("TOGETHER_API_KEY", "fixture");
    try {
      const api = JSON.stringify([
        { id: "Example/Text-Chat", type: "chat", context_length: 8192, license: "Apache-2.0" },
        { id: "Example/Vision-Chat", type: "chat", context_length: 2048 },
        { id: "Example/ASR", type: "transcribe", context_length: 1 },
        { id: "Example/Inventory-Only", type: "chat", context_length: 65536 },
      ]);
      vi.mocked(fetchSource).mockImplementation(async ({ id }) =>
        payload(id === "together-api" ? api : togetherBundle()),
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
      expect(
        result.models.find(({ model_id }) => model_id === "Example/Text-Chat")?.model_card?.license,
      ).toBe("Apache-2.0");
      expect(result.models.find(({ model_id }) => model_id === "Example/ASR")?.limits).toEqual({});
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
      const inference = compileInferencePriceMapping(
        candidate,
        result.inferencePriceSources ?? [],
      ).inference;
      expect(inference?.mapping.rules).toEqual(
        expect.arrayContaining([expect.objectContaining({ model_id: "Example/Vision-Chat" })]),
      );
      const lookup = createInferencePriceLookup(
        calculationExport(candidate.catalog, candidate.pricing),
        inference?.mapping,
      );
      const whisper = { provider_id: "together", model_id: "Example/ASR" };
      expect(lookup(whisper).missing_conditions).toContainEqual({
        namespace: "kmodels",
        value: "operation",
      });
      for (const [value, denominator] of [
        ["standard", "6000"],
        ["batch", "12000"],
      ] as const) {
        const selected = lookup({
          ...whisper,
          selectors: [
            {
              kind: "categorical",
              dimension: { namespace: "kmodels", value: "operation" },
              value: { namespace: "provider", provider_id: "together", value },
            },
          ],
        });
        expect(selected.status).toBe("matched");
        expect(
          selected.candidates.flatMap(({ offer }) =>
            offer.terms.flatMap((term) =>
              term.kind === "rate" ? term.variants.map(({ price }) => price.value) : [],
            ),
          ),
        ).toEqual([{ numerator: "1", denominator }]);
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("adds descriptions and launch dates for exact current IDs without changing price authority", async () => {
    const indexUrl = "https://www.together.ai/models";
    const visionUrl = `${indexUrl}/example-vision`;
    const textUrl = `${indexUrl}/example-text`;
    const index = `<main>
      <div class="models_link"><a href="/models/example-vision"></a><span fs-list-field="endpoint">Example/Vision-Chat</span><span data-model-features>Serverless</span><span fs-list-field="category">Reasoning</span></div>
      <div class="models_link"><a href="/models/example-text"></a><span fs-list-field="endpoint">Example/Text-Chat</span><span data-model-features>Serverless</span></div>
    </main>`;
    const cards = JSON.stringify({
      index: { url: indexUrl, body: index },
      documents: [
        {
          url: visionUrl,
          body: '<meta name="description" content="Vision description"><main><p data-copy-target>Example/Vision-Chat</p><div class="models-d-content_box-item-inner"><div>Input modalities</div><div role="list"><div role="listitem">Video</div></div></div></main>',
        },
        {
          url: textUrl,
          body: '<meta name="description" content="Wrong identity"><main><p data-copy-target>Example/Other</p></main>',
        },
      ],
    });
    const releases = [
      "**October 10, 2026**",
      "## New serverless models",
      "* `Example/Vision-Chat`: Published for shared inference.",
      "## New dedicated endpoint models",
      "* `Example/Text-Chat`.",
      "**October 9, 2026**",
      "## New serverless models",
      "* `Example/Other`.",
    ].join("\n");
    vi.stubEnv("TOGETHER_API_KEY", "");
    try {
      const bodies = new Map([
        ["together-serverless", togetherBundle()],
        ["together-model-cards", cards],
        ["together-releases", releases],
      ]);
      vi.mocked(fetchSource).mockImplementation(async ({ id }) => {
        const body = bodies.get(id);
        if (body === undefined) throw new Error("Unconfigured fixture source");
        return payload(body);
      });
      const result = await collectProvider(
        providerManifest("together"),
        undefined,
        { sources: {} },
        observedAt,
      );
      expect(result.coverage.status).toBe("fresh");
      expect(result.models).toHaveLength(5);
      expect(
        result.models.find(({ model_id }) => model_id === "Example/Vision-Chat"),
      ).toMatchObject({
        description: "Vision description",
        release_date: "2026-10-10",
        capabilities: { reasoning: true },
        modalities: { input: expect.arrayContaining(["text", "image", "video"]) },
      });
      const text = result.models.find(({ model_id }) => model_id === "Example/Text-Chat");
      expect(text).toBeDefined();
      expect(text?.description).toBeUndefined();
      expect(text?.release_date).toBeUndefined();
      expect(result.attempt.pricing).toEqual({ outcome: "accepted" });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("keeps Model Library pagination on the reviewed next page", () => {
    const root = new URL("https://www.together.ai/models");
    const next = togetherNextLibraryPage("?dac2a22c_page=2", root);
    expect(togetherNextLibraryPage("?dac2a22c_page=3", next).search).toBe("?dac2a22c_page=3");
    for (const target of [
      "?dac2a22c_page=4",
      "?dac2a22c_page=2",
      "?ba456789_page=3",
      "https://example.com/models?dac2a22c_page=3",
    ])
      expect(() => togetherNextLibraryPage(target, next)).toThrow(/reviewed sequence/);
  });
});

const fireworksRoot = "https://fireworks.ai/models";
const fireworksDocs = "https://docs.fireworks.ai/serverless";
const fireworksGuides = "https://docs.fireworks.ai/guides";
const chatSlug = "publisher/example";
const chatId = "accounts/fireworks/models/example";
const routerId = "accounts/fireworks/routers/example-fast";
const decisionId = "accounts/fireworks/models/decide";
const embeddingAlias = "fireworks/example-embedding";
const embeddingId = "accounts/fireworks/models/example-embedding";
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
  {
    slug: embeddingAlias,
    serverless: true,
    serverlessApi: true,
    contextLength: null,
    tags: ["Embedding"],
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
      ...card(embeddingAlias, embeddingId, "Example Embedding"),
      body: card(embeddingAlias, embeddingId, "Example Embedding").body.replace(
        "$1 / $0.2 / $3",
        "$0.1",
      ),
    },
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
        "## Embeddings",
        "| Base model parameter count | \\$ / 1M input tokens |",
        "| - | - |",
        "| up to 150M | $0.008 |",
        "| 150M – 350M | $0.016 |",
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
    {
      url: `${fireworksGuides}/spot-serverless.md`,
      body: [
        "## Models",
        "| Model | Spot model identifier | Standard model identifier |",
        "| - | - | - |",
        `| Example | \`${chatId}-spot\` | \`${chatId}\` |`,
        "## Pricing",
        "| Model | Tier | Cached input | Uncached input | Output |",
        "| - | - | - | - | - |",
        "| Example | Standard | $0.2 | $1 | $3 |",
        "| Example | Spot | $0.14 | $0.7 | $2.1 |",
      ].join("\n"),
    },
    {
      url: `${fireworksGuides}/querying-embeddings-models.md`,
      body: [
        "## Generating embeddings",
        "> [tab] Qwen3",
        "> | Model | Model ID | Availability |",
        "> | - | - | - |",
        `> | [Example Embedding](https://app.fireworks.ai/models/${embeddingAlias}) | [\`${embeddingAlias}\`](https://app.fireworks.ai/models/${embeddingAlias}) | Serverless and dedicated |`,
        "> [accordion] BERT-based models (legacy)",
        "> | Model id | Dimensions | Parameters |",
        "> | - | - | - |",
        "> | `Example/Small-Embed` | 384 | 33M |",
        "> | `Example/Large-Embed` | 1024 | 335M |",
        "> **Retired.** `Example/Retired-Embed`.",
      ].join("\n"),
    },
    {
      url: `${fireworksGuides}/video-audio-inputs.md`,
      body: [
        "## Available models",
        "| Model | Input support | Notes |",
        "| - | - | - |",
        "| Example | Image, video, text | Serverless |",
        "## Choose an inference option",
        "### Serverless",
        "```text",
        chatId,
        "```",
      ].join("\n"),
    },
  ],
};

describe("Fireworks AI Serverless", () => {
  it("discovers eligible cards and preserves published model and router identities", () => {
    const source = providerManifest("fireworks").sources[0];
    if (source === undefined) throw new Error("Missing Fireworks source");
    expect(linkedDocumentUrls(index.body, source).map(({ href }) => href)).toEqual([
      `${fireworksRoot}/fireworks/decide/`,
      `${fireworksRoot}/${embeddingAlias}/`,
      `${fireworksRoot}/${chatSlug}/`,
    ]);
    const { models, inference_prices } = parse("fireworks", JSON.stringify(fireworkBundle));
    expect(models.map(({ model_id }) => model_id)).toEqual([
      chatId,
      decisionId,
      embeddingId,
      routerId,
      "accounts/fireworks/routers/another-ultrafast",
      "accounts/fireworks/routers/another-us",
      `${chatId}-spot`,
      "Example/Small-Embed",
      "Example/Large-Embed",
    ]);
    expect(models[4]?.price_facts).toEqual([]);
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
    expect(inference_prices).toContainEqual(
      expect.objectContaining({ model_id: embeddingAlias, model_ref: `fireworks/${embeddingId}` }),
    );
    expect(models[0]?.modalities.input).toEqual(["text", "image", "video"]);
    expect(models[6]?.price_facts.map(({ price }) => price)).toEqual(["0.7", "0.14", "2.1"]);
    expect(models[8]).toMatchObject({
      status: "legacy",
      limits: { embedding_dimensions: [1024] },
      price_facts: [{ price: "0.016" }],
    });
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
