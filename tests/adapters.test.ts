import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import {
  classifyModelTypes,
  multiplyDecimal,
  parseSource,
  scaleDecimal,
} from "../src/catalog/adapters.ts";
import { curlResponse, linkedDocumentUrls } from "../src/catalog/fetch.ts";
import { applyGroups } from "../src/catalog/collector.ts";
import { manifests, type ProviderManifest, type SourceManifest } from "../src/catalog/manifests.ts";
import { sourceKindSchema, type Provider, type ProviderModel } from "../src/catalog/schema.ts";
import { baseModel } from "../src/catalog/model.ts";
import { preserveMissing, validateProvider } from "../src/catalog/validation.ts";

const observedAt = "2026-07-21T00:00:00.000Z";

async function fixture(path: string): Promise<string> {
  return readFile(new URL(`./fixtures/${path}`, import.meta.url), "utf8");
}

async function expected(path: string): Promise<unknown> {
  return JSON.parse(await fixture(path));
}

function manifest(providerId: string): ProviderManifest {
  const value = manifests.find((item) => item.provider.id === providerId);
  if (value === undefined) throw new Error(`Missing manifest ${providerId}`);
  return value;
}

function provider(value: ProviderManifest): Provider {
  return { ...value.provider, source_ids: value.sources.map((source) => source.id) };
}

async function parsed(
  providerId: string,
  path: string,
  sourceId?: string,
): Promise<ProviderModel[]> {
  const value = manifest(providerId);
  const source =
    sourceId === undefined
      ? value.sources[0]
      : value.sources.find((candidate) => candidate.id === sourceId);
  if (source === undefined) throw new Error(`Missing source for ${providerId}`);
  return parseSource({ provider: provider(value), source, body: await fixture(path), observedAt });
}

async function anthropicCatalog(): Promise<ProviderModel[]> {
  const value = manifest("anthropic");
  const source = value.sources[0];
  if (source === undefined) throw new Error("Missing Anthropic source");
  const body = JSON.stringify({
    index: {
      url: source.url,
      body: await fixture("anthropic/overview.md"),
    },
    documents: [
      {
        url: "https://platform.claude.com/docs/en/about-claude/pricing.md",
        body: await fixture("anthropic/pricing.md"),
      },
      {
        url: "https://platform.claude.com/docs/en/about-claude/model-deprecations.md",
        body: await fixture("anthropic/lifecycle.md"),
      },
      {
        url: "https://platform.claude.com/docs/en/about-claude/models/introducing-claude-fable-5-and-claude-mythos-5.md",
        body: await fixture("anthropic/launch.md"),
      },
    ],
  });
  return parseSource({ provider: provider(value), source, body, observedAt });
}

async function databricksCatalog(): Promise<ProviderModel[]> {
  const value = manifest("databricks");
  const configured = value.sources[0];
  if (configured === undefined || configured.extractor.kind !== "databricks-catalog")
    throw new Error("Missing Databricks source");
  const source: SourceManifest = {
    ...configured,
    extractor: { kind: "databricks-catalog", minModels: 5, maxModels: 10 },
  };
  const documents = [
    [
      "https://docs.databricks.com/aws/en/machine-learning/model-serving/foundation-model-overview",
      "overview.html",
    ],
    ["https://docs.databricks.com/aws/en/machine-learning/retired-models-policy", "lifecycle.html"],
    ["https://www.databricks.com/product/pricing/foundation-model-serving", "pricing-open.html"],
    [
      "https://www.databricks.com/product/pricing/proprietary-foundation-model-serving",
      "pricing-partner.html",
    ],
    [
      "https://docs.databricks.com/aws/en/machine-learning/foundation-model-apis/limits",
      "limits.html",
    ],
    [
      "https://docs.databricks.com/aws/en/machine-learning/foundation-model-apis/api-reference",
      "api-reference.html",
    ],
    ["https://docs.databricks.com/aws/en/feed.xml", "release-feed.xml"],
  ];
  const body = JSON.stringify({
    index: { url: source.url, body: await fixture("databricks/models.html") },
    documents: await Promise.all(
      documents.map(async ([url, path]) => ({
        url,
        body: await fixture(`databricks/${path}`),
      })),
    ),
  });
  return parseSource({ provider: provider(value), source, body, observedAt });
}

async function vercelCatalog(path: string): Promise<ProviderModel[]> {
  const value = manifest("vercel");
  const configured = value.sources[0];
  if (configured === undefined || configured.extractor.kind !== "vercel-catalog")
    throw new Error("Missing Vercel source");
  const source: SourceManifest = {
    ...configured,
    extractor: { kind: "vercel-catalog", minModels: 1, maxModels: 20 },
  };
  return parseSource({ provider: provider(value), source, body: await fixture(path), observedAt });
}

async function xaiCatalog(): Promise<ProviderModel[]> {
  const value = manifest("xai");
  const configured = value.sources[0];
  if (configured === undefined || configured.extractor.kind !== "xai-catalog")
    throw new Error("Missing xAI source");
  const source: SourceManifest = {
    ...configured,
    extractor: { kind: "xai-catalog", minModels: 4, maxModels: 10 },
  };
  const body = JSON.stringify({
    index: { url: source.url, body: await fixture("xai/models.txt") },
    documents: [{ url: "https://docs.x.ai/llms.txt", body: await fixture("xai/llms.txt") }],
  });
  return parseSource({ provider: provider(value), source, body, observedAt });
}

function huggingFaceRouterSource(value: ProviderManifest): SourceManifest {
  const configured = value.sources.find((source) => source.id === "huggingface-router");
  if (configured === undefined || configured.extractor.kind !== "huggingface-router")
    throw new Error("Missing Hugging Face router source");
  return {
    ...configured,
    extractor: { kind: "huggingface-router", minModels: 1, maxModels: 10 },
  };
}

async function huggingFaceRouter(path: string): Promise<ProviderModel[]> {
  const value = manifest("huggingface");
  const source = huggingFaceRouterSource(value);
  return parseSource({ provider: provider(value), source, body: await fixture(path), observedAt });
}

async function azureCatalog(): Promise<ProviderModel[]> {
  const value = manifest("azure");
  const configured = value.sources[0];
  if (configured === undefined || configured.extractor.kind !== "azure-catalog")
    throw new Error("Missing Azure source");
  const source: SourceManifest = {
    ...configured,
    extractor: { kind: "azure-catalog", minModels: 1, maxModels: 20 },
  };
  const documents = [
    ["models-azure-direct-others.md", "others.md"],
    ["models-partners.md", "partners.md"],
    ["concepts-model-retirement-schedule-content.md", "lifecycle.md"],
    ["deployments-standard.md", "standard.md"],
    ["deployments-provisioned.md", "provisioned.md"],
    ["deployments-batch.md", "batch.md"],
  ];
  const body = JSON.stringify({
    index: { url: source.url, body: await fixture("azure/openai.md") },
    documents: await Promise.all(
      documents.map(async ([name, path]) => ({
        url: `https://raw.githubusercontent.com/MicrosoftDocs/azure-ai-docs/main/${name}`,
        body: await fixture(`azure/${path}`),
      })),
    ),
  });
  return parseSource({ provider: provider(value), source, body, observedAt });
}

async function geminiCatalog(): Promise<ProviderModel[]> {
  const value = manifest("gemini");
  const configured = value.sources[0];
  if (configured === undefined || configured.extractor.kind !== "gemini-catalog")
    throw new Error("Missing Gemini source");
  const source: SourceManifest = {
    ...configured,
    extractor: { kind: "gemini-catalog", minModels: 5, maxModels: 10 },
  };
  const documents = [
    ["https://ai.google.dev/gemini-api/docs/models/gemini-test-preview", "model.html"],
    ["https://ai.google.dev/gemini-api/docs/models/lyria-test", "lyria.html"],
    ["https://ai.google.dev/gemini-api/docs/models/embedding-test", "embedding.html"],
    ["https://ai.google.dev/gemini-api/docs/pricing", "pricing.html"],
    ["https://ai.google.dev/gemini-api/docs/deprecations", "deprecations.html"],
    ["https://ai.google.dev/gemini-api/docs/changelog", "changelog.html"],
    ["https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api", "gemma-api.html"],
    ["https://ai.google.dev/gemma/docs/core/model_card_4", "gemma-card.html"],
  ];
  const body = JSON.stringify({
    index: { url: source.url, body: await fixture("gemini/index.html") },
    documents: await Promise.all(
      documents.map(async ([url, path]) => ({
        url,
        body: await fixture(`gemini/${path}`),
      })),
    ),
  });
  return parseSource({ provider: provider(value), source, body, observedAt });
}

async function vertexCatalog(): Promise<ProviderModel[]> {
  const value = manifest("vertex");
  const configured = value.sources[0];
  if (configured === undefined || configured.extractor.kind !== "vertex-catalog")
    throw new Error("Missing Vertex source");
  const source: SourceManifest = {
    ...configured,
    extractor: { kind: "vertex-catalog", minModels: 2, maxModels: 5 },
  };
  const documents = [
    [
      "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/gemini-test",
      "model.html",
    ],
    [
      "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/model-versions",
      "lifecycle.html",
    ],
    [
      "https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing",
      "pricing.html",
    ],
  ];
  const body = JSON.stringify({
    index: { url: source.url, body: "<main></main>" },
    documents: await Promise.all(
      documents.map(async ([url, path]) => ({
        url,
        body: await fixture(`vertex/${path}`),
      })),
    ),
  });
  return parseSource({ provider: provider(value), source, body, observedAt });
}

async function cohereCatalog(): Promise<ProviderModel[]> {
  const value = manifest("cohere");
  const source = value.sources[0];
  if (source === undefined || source.extractor.kind !== "cohere-catalog")
    throw new Error("Missing Cohere source");
  const documents = [
    ["https://docs.cohere.com/docs/command-a-plus", "command-a-plus.html"],
    ["https://docs.cohere.com/docs/command-a", "command-a-broken.html"],
    ["https://docs.cohere.com/docs/transcribe", "transcribe.html"],
    ["https://docs.cohere.com/docs/transcribe-arabic", "transcribe-arabic.html"],
    ["https://docs.cohere.com/docs/deprecations", "lifecycle.html"],
    ["https://cohere.com/pricing", "pricing.html"],
    ["https://docs.cohere.com/v2/changelog", "changelog.html"],
    ["https://docs.cohere.com/changelog/command-a", "command-a-release.html"],
    ["https://docs.cohere.com/changelog/command-r-7b/", "command-r7b-release.html"],
  ];
  const body = JSON.stringify({
    index: { url: source.url, body: await fixture("cohere/index.html") },
    documents: await Promise.all(
      documents.map(async ([url, path]) => ({
        url,
        body: await fixture(`cohere/${path}`),
      })),
    ),
  });
  return parseSource({ provider: provider(value), source, body, observedAt });
}

async function mistralCatalog(): Promise<ProviderModel[]> {
  const value = manifest("mistral");
  const configured = value.sources[0];
  if (configured === undefined || configured.extractor.kind !== "mistral-catalog")
    throw new Error("Missing Mistral source");
  const source: SourceManifest = {
    ...configured,
    extractor: { kind: "mistral-catalog", minModels: 5, maxModels: 5 },
  };
  const slugs = [
    "mistral-medium-3-5-26-04",
    "ocr-4-0",
    "voxtral-tts-26-03",
    "mistral-large-2-0-24-07",
    "mistral-large-3-25-12",
  ];
  const body = JSON.stringify({
    index: { url: source.url, body: await fixture("mistral/index.ts") },
    documents: [
      ...(await Promise.all(
        slugs.map(async (slug) => ({
          url: `https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/schema/models/models/${slug}.ts`,
          body: await fixture(`mistral/${slug}.ts`),
        })),
      )),
      {
        url: "https://docs.mistral.ai/studio-api/conversations/advanced/prompt-caching",
        body: await fixture("mistral/prompt-caching.html"),
      },
      {
        url: "https://docs.mistral.ai/studio-api/batch-processing",
        body: await fixture("mistral/batch-processing.html"),
      },
    ],
  });
  return parseSource({ provider: provider(value), source, body, observedAt });
}

async function llamaCatalog(): Promise<ProviderModel[]> {
  const value = manifest("llama");
  const configured = value.sources[0];
  if (configured === undefined || configured.extractor.kind !== "llama-catalog")
    throw new Error("Missing Llama source");
  const source: SourceManifest = {
    ...configured,
    extractor: { kind: "llama-catalog", minModels: 8, maxModels: 8 },
  };
  const files = [
    ["models/sku_types.py", "sku_types.py"],
    ["models/cli/safety_models.py", "safety_models.py"],
    ["README.md", "README.md"],
    ["models/llama3_1/MODEL_CARD.md", "llama3_1.md"],
    ["models/llama3_2/MODEL_CARD.md", "llama3_2.md"],
    ["models/llama3_3/MODEL_CARD.md", "llama3_3.md"],
    ["models/llama4/MODEL_CARD.md", "llama4.md"],
    ["examples/chat.py", "chat.py", "llama-api-python"],
    ["examples/tool_call.py", "tool_call.py", "llama-api-python"],
  ];
  const body = JSON.stringify({
    index: { url: source.url, body: await fixture("llama/sku_list.py") },
    documents: await Promise.all(
      files.map(async ([path, fixturePath, repository = "llama-models"]) => ({
        url: `https://raw.githubusercontent.com/meta-llama/${repository}/main/${path}`,
        body: await fixture(`llama/${fixturePath}`),
      })),
    ),
  });
  return parseSource({ provider: provider(value), source, body, observedAt });
}

describe("decimal normalization", () => {
  it("scales source token prices without floating-point arithmetic", () => {
    expect(scaleDecimal("0.00000012", 6)).toBe("0.12");
    expect(scaleDecimal("0.000002", 6)).toBe("2");
    expect(scaleDecimal("1.25", 6)).toBe("1250000");
    expect(scaleDecimal("200000000", -10)).toBe("0.02");
    expect(multiplyDecimal("2.50", "1.25")).toBe("3.125");
  });
});

describe("model task taxonomy", () => {
  it("normalizes operation families and permits multiple observed types", () => {
    const types = (modelId: string): ReturnType<typeof classifyModelTypes> =>
      classifyModelTypes({
        modelId,
        name: modelId,
        rawType: undefined,
        modalities: { input: [], output: [] },
        fallback: "generate",
      });
    expect([
      types("text-embedding-3-large"),
      types("cohere/rerank-v4-fast"),
      types("gpt-4o-transcribe"),
      types("gpt-image-2"),
      types("gpt-realtime-2"),
      types("computer-use-realtime-preview"),
      types("voxtral-tts-26-03"),
      types("amazon.titan-embed-image-v1"),
      types("wan2.7-image-pro"),
      types("claude-sonnet-5"),
    ]).toEqual([
      ["embeddings"],
      ["rerank"],
      ["audio_transcription"],
      ["image"],
      ["realtime"],
      ["agentic", "realtime"],
      ["audio_speech"],
      ["embeddings"],
      ["image"],
      ["generate"],
    ]);
  });
});

describe("source taxonomy", () => {
  it("publishes a compact array of source kinds", () => {
    expect(manifest("azure").sources[0]).toMatchObject({
      type: "repository",
    });
    expect(manifest("amazon-bedrock").sources[0]).toMatchObject({
      type: "website",
      source: ["website", "api"],
    });
    expect(manifest("ollama").sources[0]?.type).toBe("api");
    expect(sourceKindSchema.safeParse("runtime").success).toBe(false);
  });
});

describe("Cohere adapters", () => {
  it("combines callable IDs with model cards, lifecycle, releases, and native prices", async () => {
    const models = await cohereCatalog();
    const commandA = models.find((model) => model.model_id === "command-a-03-2025");
    const commandAPlus = models.find((model) => model.model_id === "command-a-plus-05-2026");
    const embedding = models.find((model) => model.model_id === "embed-v4.0");
    const rerank = models.find((model) => model.model_id === "rerank-v4.0-pro");
    const retired = models.find((model) => model.model_id === "rerank-english-v2.0");
    const arabic = models.find((model) => model.model_id === "cohere-transcribe-arabic-07-2026");
    expect({
      count: models.length,
      command_a_name: commandA?.name,
      command_a_release: commandA?.release_date,
      command_a_price_count: commandA?.pricing.length,
      plus_name: commandAPlus?.name,
      plus_modalities: commandAPlus?.modalities,
      plus_reasoning: commandAPlus?.capabilities.reasoning,
      plus_pricing_status: commandAPlus?.pricing_status,
      embedding_limits: embedding?.limits,
      embedding_prices: embedding?.pricing.map(({ meter, price, unit, conditions }) => ({
        meter,
        price,
        unit,
        conditions,
      })),
      rerank_prices: rerank?.pricing.map(({ price, unit, conditions }) => ({
        price,
        unit,
        conditions,
      })),
      retired: {
        status: retired?.status,
        retired_at: retired?.retired_at,
        replacements: retired?.replacement_model_ids,
      },
      arabic: {
        name: arabic?.name,
        types: arabic?.types,
        modalities: arabic?.modalities,
        release: arabic?.release_date,
        pricing_status: arabic?.pricing_status,
      },
    }).toEqual({
      count: 42,
      command_a_name: "Command A",
      command_a_release: "2025-03-13",
      command_a_price_count: 0,
      plus_name: "Command A+",
      plus_modalities: { input: ["text", "image"], output: ["text"] },
      plus_reasoning: true,
      plus_pricing_status: "custom_quote",
      embedding_limits: {
        context_tokens: 128_000,
        embedding_dimensions: [256, 512, 1024, 1536],
        recommended_embedding_dimensions: [1536],
      },
      embedding_prices: [
        {
          meter: "embedding",
          price: "0.12",
          unit: "million_tokens",
          conditions: { modality: "text" },
        },
        {
          meter: "embedding",
          price: "0.47",
          unit: "million_tokens",
          conditions: { modality: "image" },
        },
        {
          meter: "provisioned_throughput",
          price: "4.00",
          unit: "unit_hour",
          conditions: { endpoint: "Model Vault", capacity: "Small" },
        },
        {
          meter: "provisioned_throughput",
          price: "2500",
          unit: "unit_month",
          conditions: { endpoint: "Model Vault", capacity: "Small" },
        },
      ],
      rerank_prices: [
        { price: "2.5", unit: "thousand_search_units", conditions: {} },
        {
          price: "10.00",
          unit: "unit_hour",
          conditions: { endpoint: "Model Vault", capacity: "Large" },
        },
        {
          price: "6500",
          unit: "unit_month",
          conditions: { endpoint: "Model Vault", capacity: "Large" },
        },
      ],
      retired: {
        status: "retired",
        retired_at: "2025-04-30",
        replacements: ["rerank-v3.5"],
      },
      arabic: {
        name: "Cohere Transcribe Arabic",
        types: ["audio_transcription"],
        modalities: { input: ["audio"], output: ["text"] },
        release: "2026-07-07",
        pricing_status: "custom_quote",
      },
    });
  });

  it("treats the authenticated API as a complete scoped page", async () => {
    const models = await parsed("cohere", "cohere/api.json", "cohere-api");
    expect(
      models.map(({ model_id, types, limits, is_deprecated }) => ({
        model_id,
        types,
        limits,
        is_deprecated,
      })),
    ).toEqual([
      {
        model_id: "command-r-08-2024",
        types: ["generate"],
        limits: { context_tokens: 128_000 },
        is_deprecated: false,
      },
      {
        model_id: "embed-v4.0",
        types: ["embeddings", "classification"],
        limits: { context_tokens: 128_000 },
        is_deprecated: false,
      },
    ]);
    await expect(parsed("cohere", "cohere/truncated-api.json", "cohere-api")).rejects.toThrow(
      "truncated",
    );
  });

  it("declares reviewed catalog companions and a non-persistent account inventory", () => {
    const value = manifest("cohere");
    expect(value.sources).toMatchObject([
      {
        extractor: { kind: "cohere-catalog" },
        type: "website",
        linkedDocuments: { minDocuments: 17, maxDocuments: 24 },
      },
      {
        extractor: { kind: "cohere-api" },
        type: "api",
        scope: "account",
        role: "inventory",
        snapshotPolicy: "none",
      },
    ]);
  });
});

describe("Mistral adapters", () => {
  it("parses exact API names, non-exclusive operations, lifecycle, and native prices", async () => {
    const models = await mistralCatalog();
    const medium = models.find((model) => model.model_id === "mistral-medium-3-5");
    const ocr = models.find((model) => model.model_id === "mistral-ocr-4-0");
    const speech = models.find((model) => model.model_id === "voxtral-mini-tts-2603");
    const retired = models.find((model) => model.model_id === "mistral-large-2407");
    expect({
      count: models.length,
      medium: {
        name: medium?.name,
        version: medium?.version,
        aliases: medium?.aliases,
        types: medium?.types,
        modalities: medium?.modalities,
        limits: medium?.limits,
        release_date: medium?.release_date,
        pricing: medium?.pricing.map(({ meter, price, unit, conditions, derived }) => ({
          meter,
          price,
          unit,
          conditions,
          derived,
        })),
      },
      ocr: {
        types: ocr?.types,
        modalities: ocr?.modalities,
        pricing: ocr?.pricing.map(({ meter, price, unit, conditions }) => ({
          meter,
          price,
          unit,
          conditions,
        })),
      },
      speech: {
        types: speech?.types,
        modalities: speech?.modalities,
        pricing: speech?.pricing.map(({ meter, price, unit }) => ({ meter, price, unit })),
      },
      retired: {
        types: retired?.types,
        status: retired?.status,
        deprecated_at: retired?.deprecated_at,
        retired_at: retired?.retired_at,
        replacements: retired?.replacement_model_ids,
      },
    }).toEqual({
      count: 5,
      medium: {
        name: "Mistral Medium 3.5",
        version: "26.04",
        aliases: ["mistral-medium-3", "mistral-medium-latest"],
        types: ["generate", "agentic"],
        modalities: { input: ["text", "image"], output: ["text"] },
        limits: { context_tokens: 256_000, max_output_tokens: 32_000 },
        release_date: "2026-04-28",
        pricing: [
          {
            meter: "input_text",
            price: "1.5",
            unit: "million_tokens",
            conditions: {},
            derived: false,
          },
          {
            meter: "output_text",
            price: "7.5",
            unit: "million_tokens",
            conditions: {},
            derived: false,
          },
          {
            meter: "input_text",
            price: "0.75",
            unit: "million_tokens",
            conditions: { service_tier: "batch" },
            derived: true,
          },
          {
            meter: "output_text",
            price: "3.75",
            unit: "million_tokens",
            conditions: { service_tier: "batch" },
            derived: true,
          },
          {
            meter: "cache_read_text",
            price: "0.15",
            unit: "million_tokens",
            conditions: {},
            derived: true,
          },
        ],
      },
      ocr: {
        types: ["ocr"],
        modalities: { input: ["image", "pdf"], output: ["text", "image"] },
        pricing: [
          {
            meter: "input_image",
            price: "4",
            unit: "thousand_pages",
            conditions: { operation: "ocr" },
          },
          {
            meter: "input_image",
            price: "5",
            unit: "thousand_pages",
            conditions: { operation: "document_annotation" },
          },
          {
            meter: "input_image",
            price: "2",
            unit: "thousand_pages",
            conditions: { operation: "ocr", service_tier: "batch" },
          },
          {
            meter: "input_image",
            price: "2.5",
            unit: "thousand_pages",
            conditions: { operation: "document_annotation", service_tier: "batch" },
          },
        ],
      },
      speech: {
        types: ["audio_speech"],
        modalities: { input: ["text", "audio"], output: ["audio"] },
        pricing: [
          { meter: "input_text", price: "0", unit: "million_characters" },
          { meter: "output_audio", price: "16", unit: "million_characters" },
        ],
      },
      retired: {
        types: ["generate"],
        status: "retired",
        deprecated_at: "2024-11-30",
        retired_at: "2025-03-30",
        replacements: ["mistral-large-2512"],
      },
    });
  });

  it("validates structured base models and ignores private fine-tunes", async () => {
    const models = await parsed("mistral", "mistral/api.json", "mistral-api");
    expect(
      models.map(({ model_id, name, aliases, types, modalities, limits, status, source_refs }) => ({
        model_id,
        name,
        aliases,
        types,
        modalities,
        limits,
        status,
        source_refs,
      })),
    ).toEqual([
      {
        model_id: "mistral-medium-3-5",
        name: "Mistral Medium 3.5 API",
        aliases: ["mistral-medium-latest"],
        types: ["generate"],
        modalities: { input: ["text", "image"], output: ["text"] },
        limits: { context_tokens: 262_144 },
        status: "active",
        source_refs: ["mistral-api"],
      },
      {
        model_id: "mistral-ocr-4-0",
        name: "OCR 4",
        aliases: ["mistral-ocr-latest"],
        types: ["ocr"],
        modalities: { input: ["image", "pdf"], output: ["text"] },
        limits: {},
        status: "unknown",
        source_refs: ["mistral-api"],
      },
    ]);
  });

  it("declares a structured official catalog and non-persistent account inventory", () => {
    const value = manifest("mistral");
    expect(value.sources).toMatchObject([
      {
        extractor: { kind: "mistral-catalog", minModels: 50, maxModels: 90 },
        type: "repository",
        source: ["repository", "website"],
        linkedDocuments: { indexFormat: "typescript", minDocuments: 55, maxDocuments: 90 },
      },
      {
        extractor: { kind: "mistral-api" },
        type: "api",
        scope: "account",
        role: "inventory",
        snapshotPolicy: "none",
      },
    ]);
  });
});

describe("Meta Llama adapters", () => {
  it("parses exact CLI descriptors, artifact variants, operations, dates, and API aliases", async () => {
    const models = await llamaCatalog();
    const quantized = models.find(
      ({ model_id }) => model_id === "Llama3.2-1B-Instruct:int4-qlora-eo8",
    );
    const hosted = models.find(
      ({ model_id }) => model_id === "Llama-4-Maverick-17B-128E-Instruct:fp8",
    );
    const guard = models.find(({ model_id }) => model_id === "Llama-Guard-3-11B-Vision");
    const promptGuard = models.find(({ model_id }) => model_id === "Prompt-Guard-86M");
    expect({
      count: models.length,
      quantized: {
        aliases: quantized?.aliases,
        context: quantized?.limits.context_tokens,
        release: quantized?.release_date,
        tool_call: quantized?.capabilities.tool_call,
      },
      hosted: {
        aliases: hosted?.aliases,
        modalities: hosted?.modalities,
        context: hosted?.limits.context_tokens,
        release: hosted?.release_date,
        tool_call: hosted?.capabilities.tool_call,
      },
      guard: {
        types: guard?.types,
        modalities: guard?.modalities,
        context: guard?.limits.context_tokens,
      },
      promptGuard: {
        types: promptGuard?.types,
        context: promptGuard?.limits.context_tokens,
      },
    }).toEqual({
      count: 8,
      quantized: {
        aliases: ["meta-llama/Llama-3.2-1B-Instruct-QLORA_INT4_EO8"],
        context: 8_192,
        release: "2024-10-24",
        tool_call: true,
      },
      hosted: {
        aliases: [
          "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
          "Llama-4-Maverick-17B-128E-Instruct-FP8",
        ],
        modalities: { input: ["text", "image"], output: ["text"] },
        context: 1_048_576,
        release: "2025-04-05",
        tool_call: true,
      },
      guard: {
        types: ["moderation"],
        modalities: { input: ["text", "image"], output: ["text"] },
        context: 131_072,
      },
      promptGuard: { types: ["classification"], context: 512 },
    });
  });

  it("validates the authenticated model-list schema", async () => {
    const models = await parsed("llama", "llama/api.json", "llama-api");
    expect(
      models.map(({ model_id, status, source_refs }) => ({ model_id, status, source_refs })),
    ).toEqual([
      {
        model_id: "Llama-4-Maverick-17B-128E-Instruct-FP8",
        status: "active",
        source_refs: ["llama-api"],
      },
    ]);
  });

  it("declares an exhaustive registry catalog and non-persistent API inventory", () => {
    expect(manifest("llama").sources).toMatchObject([
      {
        extractor: { kind: "llama-catalog", minModels: 45, maxModels: 60 },
        type: "repository",
        exhaustive: true,
      },
      {
        extractor: { kind: "llama-api" },
        type: "api",
        scope: "account",
        role: "inventory",
        snapshotPolicy: "none",
      },
    ]);
  });
});

describe("HTTP transport boundary", () => {
  it("uses the final response behind a CONNECT proxy and preserves 304", () => {
    const response = curlResponse(
      'HTTP/1.1 200 Connection Established\r\n\r\nHTTP/2 304\r\netag: "fixture"\r\n\r\n',
    );
    expect(response.status).toBe(304);
    expect(response.headers.get("etag")).toBe('"fixture"');
  });

  it("follows only reviewed same-host model-card links", () => {
    const source = manifest("amazon-bedrock").sources[0];
    if (source?.linkedDocuments === undefined) throw new Error("Missing Bedrock link policy");
    const urls = linkedDocumentUrls(
      [
        "[Command R](model-card-cohere-command-r.md)",
        "[External](https://example.test/bedrock/latest/userguide/model-card-external.md)",
        "[Wrong port](https://docs.aws.amazon.com:444/bedrock/latest/userguide/model-card-port.md)",
        "[Unrelated](models-supported.md)",
      ].join("\n"),
      {
        ...source,
        linkedDocuments: { ...source.linkedDocuments, minDocuments: 1 },
      },
    );
    expect(urls.map((url) => url.href)).toEqual([
      "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-cohere-command-r.md",
    ]);
  });

  it("discovers reviewed HTML catalog links", () => {
    const source = manifest("openai").sources[0];
    if (source?.linkedDocuments === undefined) throw new Error("Missing OpenAI crawl policy");
    const urls = linkedDocumentUrls(
      "<a href='/api/docs/models/gpt-5.4'>GPT-5.4</a><a href='/api/docs/pricing'>Pricing</a>",
      { ...source, linkedDocuments: { ...source.linkedDocuments, minDocuments: 1 } },
    );
    expect(urls.map((url) => url.pathname)).toEqual(["/api/docs/models/gpt-5.4"]);
  });

  it("upgrades reviewed Anthropic companion links to Markdown", async () => {
    const source = manifest("anthropic").sources[0];
    if (source?.linkedDocuments === undefined) throw new Error("Missing Anthropic link policy");
    const urls = linkedDocumentUrls(await fixture("anthropic/overview.md"), source);
    expect(urls.map((url) => url.pathname)).toEqual([
      "/docs/en/about-claude/model-deprecations.md",
      "/docs/en/about-claude/models/introducing-claude-fable-5-and-claude-mythos-5.md",
      "/docs/en/about-claude/pricing.md",
    ]);
  });

  it("discovers reviewed TypeScript model imports", async () => {
    const source = manifest("mistral").sources[0];
    if (source?.linkedDocuments === undefined) throw new Error("Missing Mistral link policy");
    const urls = linkedDocumentUrls(await fixture("mistral/index.ts"), {
      ...source,
      linkedDocuments: { ...source.linkedDocuments, minDocuments: 5, maxDocuments: 5 },
    });
    expect(urls.map((url) => url.pathname)).toEqual([
      "/mistralai/platform-docs-public/main/src/schema/models/models/mistral-large-2-0-24-07.ts",
      "/mistralai/platform-docs-public/main/src/schema/models/models/mistral-large-3-25-12.ts",
      "/mistralai/platform-docs-public/main/src/schema/models/models/mistral-medium-3-5-26-04.ts",
      "/mistralai/platform-docs-public/main/src/schema/models/models/ocr-4-0.ts",
      "/mistralai/platform-docs-public/main/src/schema/models/models/voxtral-tts-26-03.ts",
    ]);
  });
});

describe("OpenAI adapters", () => {
  it("combines the complete model index with rich model pages", async () => {
    const models = await parsed("openai", "openai/catalog.json");
    const model = models.find((candidate) => candidate.model_id === "gpt-5.4");
    const embedding = models.find((candidate) => candidate.model_id === "text-embedding-3-large");
    expect({
      name: model?.name,
      types: model?.types,
      aliases: model?.aliases,
      context: model?.limits.context_tokens,
      output: model?.limits.max_output_tokens,
      modalities: model?.modalities,
      capabilities: model?.capabilities,
      status: model?.status,
      embedding_type: embedding?.types,
      embedding_output: embedding?.modalities.output,
      embedding_deprecated: embedding?.is_deprecated,
    }).toEqual({
      name: "GPT-5.4",
      types: ["generate", "agentic"],
      aliases: ["gpt-5.4-2026-03-05"],
      context: 1_050_000,
      output: 128_000,
      modalities: { input: ["text", "image"], output: ["text"] },
      capabilities: {
        reasoning: true,
        tool_call: true,
        structured_output: true,
        streaming: true,
        batch: "unknown",
        prompt_cache: true,
        fine_tuning: false,
        citations: "unknown",
        code_execution: "unknown",
        context_management: "unknown",
        effort_control: "unknown",
        computer_use: "unknown",
      },
      status: "active",
      embedding_type: ["embeddings"],
      embedding_output: ["embedding"],
      embedding_deprecated: true,
    });
    expect(
      model?.pricing.find(
        (rate) =>
          rate.meter === "cache_write_text" && rate.conditions.context_min_tokens === undefined,
      )?.price,
    ).toBe("3.125");
    expect(
      model?.pricing.find(
        (rate) => rate.meter === "input_text" && rate.conditions.context_min_tokens === 272_001,
      )?.price,
    ).toBe("5");
  });

  it("keeps batch and standard token prices as separate tiers", async () => {
    const model = (await parsed("openai", "openai/batch-catalog.json"))[0];
    expect(
      model?.pricing.map(({ meter, price, conditions }) => ({ meter, price, conditions })),
    ).toEqual([
      { meter: "input_text", price: "2.00", conditions: { service_tier: "batch" } },
      { meter: "output_text", price: "8.00", conditions: { service_tier: "batch" } },
      { meter: "input_text", price: "1.00", conditions: {} },
      { meter: "output_text", price: "4.00", conditions: {} },
    ]);
    expect(model?.capabilities.batch).toBe(true);
  });

  it("parses scoped API inventory without treating it as the global catalog", async () => {
    const models = await parsed("openai", "openai/api.json", "openai-api");
    expect(models.map((model) => model.model_id)).toEqual(["gpt-5.4", "ft:gpt-5.4:example"]);
  });

  it("keeps an overview alias inside its own model card", async () => {
    const models = await parsed("openai", "openai/overview.html", "openai-overview");
    expect(models.map(({ model_id, aliases }) => ({ model_id, aliases }))).toEqual([
      { model_id: "gpt-5.6-sol", aliases: ["gpt-5.6"] },
    ]);
  });

  it("parses lifecycle dates and replacements from deprecation tables", async () => {
    const models = await parsed("openai", "openai/deprecations.html", "openai-deprecations");
    expect(
      models.map(({ model_id, status, retired_at, replacement_model_ids }) => ({
        model_id,
        status,
        retired_at,
        replacement_model_ids,
      })),
    ).toEqual([
      {
        model_id: "gpt-5.4",
        status: "deprecated",
        retired_at: "2026-09-28",
        replacement_model_ids: ["gpt-5.6-sol"],
      },
      {
        model_id: "text-embedding-3-large",
        status: "retired",
        retired_at: "2026-02-17",
        replacement_model_ids: ["text-embedding-3-small"],
      },
    ]);
  });

  it("fails closed when the index and model pages disagree", async () => {
    await expect(parsed("openai", "openai/broken-catalog.json")).rejects.toThrow(
      "index and model pages disagree",
    );
  });
});

describe("Azure adapters", () => {
  it("keeps exact model/version tuples and unions every observed operation", async () => {
    const models = await azureCatalog();
    const model = models.find((candidate) => candidate.uid === "azure/gpt-multi@2026-01-01");
    const whisper = models.find((candidate) => candidate.uid === "azure/whisper@001");
    const rerank = models.find((candidate) => candidate.uid === "azure/cohere-rerank-v4.0-fast@1");
    const embedding = models.find(
      (candidate) => candidate.uid === "azure/Cohere-embed-v3-english@1",
    );
    const retired = models.find((candidate) => candidate.uid === "azure/gpt-old@1");
    expect({
      types: model?.types,
      modalities: model?.modalities,
      context: model?.limits.context_tokens,
      output: model?.limits.max_output_tokens,
      availability: model?.availability?.length,
      whisper: whisper?.types,
      rerank: rerank?.types,
      embedding: [embedding?.types, embedding?.modalities.output],
      retired: [retired?.status, retired?.replacement_model_ids],
    }).toEqual({
      types: ["generate", "agentic"],
      modalities: { input: ["text", "image"], output: ["text"] },
      context: 128_000,
      output: 16_384,
      availability: 5,
      whisper: ["audio_transcription", "audio_translation"],
      rerank: ["rerank", "classification"],
      embedding: [["embeddings"], ["embedding"]],
      retired: ["retired", ["gpt-multi"]],
    });
  });

  it("parses the scoped ARM inventory and exact billing-meter price join", async () => {
    const model = (await parsed("azure", "azure/api.json", "azure-api"))[0];
    expect({
      uid: model?.uid,
      description: model?.description,
      types: model?.types,
      capabilities: model?.capabilities,
      context: model?.limits.context_tokens,
      status: model?.status,
      deprecatedAt: model?.deprecated_at,
      availability: model?.availability,
      price: model?.pricing[0],
      imagePrice: model?.pricing.find((rate) => rate.meter === "input_image")?.price,
      scope: model?.scope,
    }).toEqual({
      uid: "azure/gpt-multi@2026-01-01",
      description: "A structured regional model.",
      types: ["generate", "agentic"],
      capabilities: {
        reasoning: "unknown",
        tool_call: "unknown",
        structured_output: true,
        streaming: true,
        batch: "unknown",
        prompt_cache: "unknown",
        fine_tuning: false,
        citations: "unknown",
        code_execution: "unknown",
        context_management: "unknown",
        effort_control: "unknown",
        computer_use: "unknown",
      },
      context: 128_000,
      status: "active",
      deprecatedAt: "2027-01-01",
      availability: [{ region: "eastus", deployment_type: "GlobalStandard" }],
      price: {
        meter: "input_text",
        price: "1.25",
        currency: "USD",
        unit: "million_tokens",
        conditions: {
          region: "eastus",
          deployment_scope: "GlobalStandard",
          effective_from: "2026-01-01",
        },
        source_ref: "azure-api",
        derived: false,
        raw_price: "1.25",
        raw_unit: "1M Tokens",
      },
      imagePrice: "2.5",
      scope: "runtime_observation",
    });
    await expect(parsed("azure", "azure/broken-api.json", "azure-api")).rejects.toThrow(
      "schema drift",
    );
  });
});

describe("Gemini adapters", () => {
  it("joins labeled model pages, lifecycle, changelog, and pricing", async () => {
    const models = await geminiCatalog();
    const model = models.find((item) => item.model_id === "gemini-test-preview");
    expect({
      name: model?.name,
      aliases: model?.aliases,
      types: model?.types,
      modalities: model?.modalities,
      capabilities: model?.capabilities,
      limits: model?.limits,
      release: model?.release_date,
      updated: model?.updated_date,
      status: model?.status,
      input: model?.pricing.find((rate) => rate.meter === "input_text")?.price,
      cached: model?.pricing.find((rate) => rate.meter === "cache_read_text")?.price,
      storage: model?.pricing.find((rate) => rate.meter === "cache_storage")?.unit,
    }).toEqual({
      name: "Gemini Test",
      aliases: ["gemini-test-latest"],
      types: ["generate", "agentic"],
      modalities: { input: ["text", "image", "pdf"], output: ["text"] },
      capabilities: {
        reasoning: true,
        tool_call: true,
        structured_output: true,
        streaming: "unknown",
        batch: true,
        prompt_cache: true,
        fine_tuning: "unknown",
        citations: "unknown",
        code_execution: "unknown",
        context_management: "unknown",
        effort_control: "unknown",
        computer_use: true,
      },
      limits: {
        context_tokens: 1_048_576,
        max_input_tokens: 1_048_576,
        max_output_tokens: 65_536,
      },
      release: "2026-07-01",
      updated: "2026-07",
      status: "preview",
      input: "1.50",
      cached: "0.15",
      storage: "million_tokens_per_hour",
    });
  });

  it("keeps music generation distinct and embedding dimensions structured", async () => {
    const models = await geminiCatalog();
    const music = models.find((item) => item.model_id === "lyria-test");
    const embedding = models.find((item) => item.model_id === "embedding-test");
    const gemma = models.find((item) => item.model_id === "gemma-4-31b-it");
    expect({
      music: {
        types: music?.types,
        modalities: music?.modalities,
        rate: music?.pricing[0],
      },
      embedding: {
        types: embedding?.types,
        limits: embedding?.limits,
        units: embedding?.pricing.map((rate) => rate.unit),
      },
      gemma: {
        context: gemma?.limits.context_tokens,
        pricing: gemma?.pricing_status,
        rates: gemma?.pricing.length,
        prices: [...new Set(gemma?.pricing.map((rate) => rate.price))],
      },
    }).toEqual({
      music: {
        types: ["audio_generation"],
        modalities: { input: ["text", "image"], output: ["text", "audio"] },
        rate: expect.objectContaining({
          meter: "output_audio",
          price: "0.50",
          unit: "request",
          conditions: { operation: "music_generation" },
        }),
      },
      embedding: {
        types: ["embeddings"],
        limits: {
          context_tokens: 8192,
          max_input_tokens: 8192,
          embedding_dimension_range: { min: 128, max: 3072 },
          recommended_embedding_dimensions: [768, 1536],
        },
        units: ["image", "million_tokens", "million_tokens"],
      },
      gemma: {
        context: 256_000,
        pricing: "published",
        rates: 7,
        prices: ["0"],
      },
    });
  });

  it("parses the authenticated inventory without making it a global catalog", async () => {
    const model = (await parsed("gemini", "gemini/api.json", "gemini-api"))[0];
    expect({
      id: model?.model_id,
      name: model?.name,
      aliases: model?.aliases,
      types: model?.types,
      reasoning: model?.capabilities.reasoning,
      streaming: model?.capabilities.streaming,
      batch: model?.capabilities.batch,
      limits: model?.limits,
      scope: model?.scope,
    }).toEqual({
      id: "gemini-test-preview",
      name: "Gemini Test API",
      aliases: ["gemini-test"],
      types: ["generate"],
      reasoning: true,
      streaming: true,
      batch: true,
      limits: {
        context_tokens: 1_048_576,
        max_input_tokens: 1_048_576,
        max_output_tokens: 65_536,
      },
      scope: "runtime_observation",
    });
    await expect(parsed("gemini", "gemini/truncated-api.json", "gemini-api")).rejects.toThrow(
      "truncated",
    );
  });
});

describe("Vertex AI adapters", () => {
  it("joins exact card IDs with lifecycle, capabilities, and multimodal pricing", async () => {
    const models = await vertexCatalog();
    const current = models.find((model) => model.model_id === "gemini-test");
    const retired = models.find((model) => model.model_id === "gemini-old");
    expect({
      name: current?.name,
      types: current?.types,
      modalities: current?.modalities,
      limits: current?.limits,
      capabilities: current?.capabilities,
      release: current?.release_date,
      status: current?.status,
      retiredAt: current?.retired_at,
      meters: current?.pricing.map((rate) => rate.meter),
      storageUnit: current?.pricing.find((rate) => rate.meter === "cache_storage")?.unit,
      retired: {
        status: retired?.status,
        release: retired?.release_date,
        retiredAt: retired?.retired_at,
        replacement: retired?.replacement_model_ids,
      },
    }).toEqual({
      name: "Gemini Test",
      types: ["generate", "agentic", "image"],
      modalities: { input: ["text", "image"], output: ["text", "image"] },
      limits: {
        context_tokens: 1_000_000,
        max_input_tokens: 1_000_000,
        max_output_tokens: 65_536,
      },
      capabilities: {
        reasoning: true,
        tool_call: true,
        structured_output: "unknown",
        streaming: "unknown",
        batch: "unknown",
        prompt_cache: "unknown",
        fine_tuning: "unknown",
        citations: "unknown",
        code_execution: "unknown",
        context_management: "unknown",
        effort_control: "unknown",
        computer_use: true,
      },
      release: "2026-07-21",
      status: "active",
      retiredAt: undefined,
      meters: [
        "cache_read_image",
        "cache_read_text",
        "cache_storage",
        "cache_storage",
        "cache_storage",
        "cache_storage",
        "input_image",
        "input_image",
        "input_text",
        "input_text",
        "output_text",
        "output_text",
      ],
      storageUnit: "million_tokens_per_hour",
      retired: {
        status: "retired",
        release: "2025-05-01",
        retiredAt: "2026-05-01",
        replacement: ["gemini-test"],
      },
    });
  });

  it("parses authenticated Model Garden inventory as scoped validation", async () => {
    const model = (await parsed("vertex", "vertex/api.json", "vertex-model-garden-api"))[0];
    expect({ id: model?.model_id, status: model?.status, scope: model?.scope }).toEqual({
      id: "gemini-test",
      status: "active",
      scope: "runtime_observation",
    });
  });
});

describe("Anthropic adapters", () => {
  it("joins official model, lifecycle, and pricing tables by observed identity", async () => {
    const models = await anthropicCatalog();
    const fable = models.find((model) => model.model_id === "claude-fable-5");
    const sonnet = models.find((model) => model.model_id === "claude-sonnet-5");
    const preview = models.find((model) => model.model_id === "claude-mythos-preview");
    expect({
      count: models.length,
      name: fable?.name,
      release: fable?.release_date,
      limits: fable?.limits,
      input: fable?.pricing.find(
        (rate) => rate.meter === "input_text" && rate.conditions.inference_geo === undefined,
      )?.price,
      usInput: fable?.pricing.find(
        (rate) => rate.meter === "input_text" && rate.conditions.inference_geo === "us",
      )?.price,
      batchCache: fable?.pricing.find(
        (rate) =>
          rate.meter === "cache_read_text" &&
          rate.conditions.service_tier === "batch" &&
          rate.conditions.inference_geo === undefined,
      )?.price,
      sonnetRates: sonnet?.pricing.length,
      previewStatus: preview?.status,
      previewReplacement: preview?.replacement_model_ids,
    }).toEqual({
      count: 7,
      name: "Claude Fable 5",
      release: "2026-06-09",
      limits: { context_tokens: 1_000_000, max_output_tokens: 128_000 },
      input: "10",
      usInput: "11",
      batchCache: "0.5",
      sonnetRates: 40,
      previewStatus: "retired",
      previewReplacement: ["claude-mythos-5"],
    });
  });

  it("parses the authenticated capability inventory as structured facts", async () => {
    const model = (await parsed("anthropic", "anthropic/api.json", "anthropic-api"))[0];
    expect({
      id: model?.model_id,
      release: model?.release_date,
      modalities: model?.modalities,
      limits: model?.limits,
      citations: model?.capabilities.citations,
      structured: model?.capabilities.structured_output,
    }).toEqual({
      id: "claude-opus-4-8",
      release: "2026-05-28",
      modalities: { input: ["text", "image", "pdf"], output: ["text"] },
      limits: {
        context_tokens: 1_000_000,
        max_input_tokens: 1_000_000,
        max_output_tokens: 128_000,
      },
      citations: true,
      structured: true,
    });
  });
});

describe("Databricks adapters", () => {
  it("combines labeled endpoints with lifecycle, limits, feature support, and DBU rates", async () => {
    const models = await databricksCatalog();
    const sol = models.find((model) => model.model_id === "databricks-gpt-5-6-sol");
    const retired = models.find((model) => model.model_id === "databricks-claude-sonnet-4");
    const replacement = models.find((model) => model.model_id === "databricks-claude-sonnet-4-6");
    const embedding = models.find((model) => model.model_id === "databricks-gte-large-en");
    expect({
      count: models.length,
      name: sol?.name,
      release: sol?.release_date,
      modalities: sol?.modalities,
      limits: sol?.limits,
      reasoning: sol?.capabilities.reasoning,
      tools: sol?.capabilities.tool_call,
      streaming: sol?.capabilities.streaming,
      batch: sol?.capabilities.batch,
      status: retired?.status,
      retired_at: retired?.retired_at,
      replacements: retired?.replacement_model_ids,
      replacement_output: replacement?.limits.max_output_tokens,
      embedding_type: embedding?.types,
      embedding_context: embedding?.limits.context_tokens,
      embedding_dimensions: embedding?.limits.embedding_dimensions,
    }).toEqual({
      count: 7,
      name: "OpenAI GPT-5.6 Sol",
      release: "2026-07-09",
      modalities: { input: ["text", "image"], output: ["text"] },
      limits: { context_tokens: 1_050_000, max_output_tokens: 128_000 },
      reasoning: true,
      tools: true,
      streaming: true,
      batch: true,
      status: "deprecated",
      retired_at: "2026-10-09",
      replacements: ["databricks-claude-sonnet-4-6"],
      replacement_output: 64_000,
      embedding_type: ["embeddings"],
      embedding_context: 8_192,
      embedding_dimensions: [1_024],
    });
    expect(
      sol?.pricing.find(
        (rate) =>
          rate.meter === "input_text" &&
          rate.conditions.endpoint === "global" &&
          rate.conditions.context_tier === "short",
      ),
    ).toMatchObject({ price: "71.429", currency: "DBU", unit: "million_tokens" });
    expect(
      sol?.pricing.find(
        (rate) => rate.meter === "input_text" && rate.conditions.context_min_tokens === 200_001,
      )?.price,
    ).toBe("142.857");
  });

  it("retains promotional and future standard rates as dated conditions", async () => {
    const models = await databricksCatalog();
    const gemini = models.find((model) => model.model_id === "databricks-gemini-3-5-flash");
    const sonnet = models.find((model) => model.model_id === "databricks-claude-sonnet-5");
    expect(
      gemini?.pricing.find(
        (rate) => rate.meter === "input_text" && rate.conditions.promotion === true,
      ),
    ).toMatchObject({
      price: "21.4288",
      derived: true,
      conditions: { effective_until: "2026-07-31" },
    });
    expect(
      sonnet?.pricing.find(
        (rate) => rate.meter === "input_text" && rate.conditions.effective_from === "2026-09-01",
      ),
    ).toMatchObject({ price: "42.857", derived: true });
    expect(
      sonnet?.pricing.find(
        (rate) => rate.meter === "input_text" && rate.conditions.promotion === true,
      )?.conditions.effective_until,
    ).toBe("2026-08-31");
  });

  it("parses workspace endpoints only as a scoped inventory", async () => {
    const models = await parsed("databricks", "databricks/api.json", "databricks-api");
    expect(models.map((model) => [model.model_id, model.types[0], model.scope])).toEqual([
      ["databricks-gpt-5-6-sol", "generate", "runtime_observation"],
      ["databricks-qwen3-embedding-0-6b", "embeddings", "runtime_observation"],
      ["private-endpoint", "generate", "runtime_observation"],
    ]);
  });
});

describe("xAI adapter", () => {
  it("joins the structured public catalog to lifecycle, voice, pricing, and release facts", async () => {
    const models = await xaiCatalog();
    expect(models.map(({ model_id }) => model_id)).toEqual([
      "grok-3",
      "grok-4.20-multi-agent-0309",
      "grok-4.5",
      "grok-imagine-image-pro",
      "grok-imagine-image-quality",
      "grok-imagine-video-1.5",
      "grok-voice-fast-1.0",
      "grok-voice-think-fast-1.0",
    ]);
    expect(models.find(({ model_id }) => model_id === "grok-4.5")).toMatchObject({
      name: "Grok 4.5",
      release_date: "2026-07",
      limits: { context_tokens: 500_000 },
      capabilities: {
        reasoning: true,
        tool_call: true,
        structured_output: true,
        streaming: true,
        batch: true,
        prompt_cache: true,
        effort_control: true,
      },
    });
    expect(models.find(({ model_id }) => model_id === "grok-4.20-multi-agent-0309")).toMatchObject({
      types: ["generate", "agentic"],
      release_date: "2026-03",
      status: "preview",
      capabilities: { citations: true, code_execution: true },
    });
    expect(models.find(({ model_id }) => model_id === "grok-imagine-image-quality")).toMatchObject({
      name: "Grok Imagine API",
      updated_date: "2026-04-03",
      pricing: expect.arrayContaining([
        expect.objectContaining({
          meter: "image_generation",
          price: "0.07",
          unit: "image",
          conditions: { resolution: "2K" },
        }),
      ]),
    });
    expect(models.find(({ model_id }) => model_id === "grok-imagine-video-1.5")).toMatchObject({
      updated_date: "2026-05-30",
    });
    expect(models.find(({ model_id }) => model_id === "grok-voice-think-fast-1.0")).toMatchObject({
      aliases: ["grok-voice-latest"],
      types: ["agentic", "realtime"],
      release_date: "2026-04",
      pricing: expect.arrayContaining([
        expect.objectContaining({ meter: "input_audio", price: "0.05", unit: "minute" }),
        expect.objectContaining({ meter: "input_text", price: "0.004", unit: "request" }),
      ]),
    });
    expect(models.find(({ model_id }) => model_id === "grok-3")).toMatchObject({
      status: "retired",
      is_deprecated: true,
      retired_at: "2026-05-15",
      replacement_model_ids: ["grok-4.3"],
    });
  });

  it("keeps standard, long-context, batch, priority, media, and tool rates distinct", async () => {
    const models = await xaiCatalog();
    const multiAgent = models.find(({ model_id }) => model_id === "grok-4.20-multi-agent-0309");
    expect(
      multiAgent?.pricing.find(
        ({ meter, conditions }) => meter === "input_text" && conditions.service_tier === "batch",
      ),
    ).toMatchObject({ price: "1", derived: true });
    expect(
      multiAgent?.pricing.find(
        ({ meter, conditions }) =>
          meter === "output_text" &&
          conditions.service_tier === "priority" &&
          conditions.context_min_tokens === 200_000,
      ),
    ).toMatchObject({ price: "10", derived: true });
    expect(
      multiAgent?.pricing.find(
        ({ meter, conditions }) =>
          meter === "tool_call" && conditions.operation === "collections_search",
      ),
    ).toMatchObject({ price: "2.5", unit: "thousand_requests", derived: false });
  });

  it("parses every authenticated inventory without treating it as global presence", async () => {
    const language = await parsed("xai", "xai/language-api.json", "xai-language-api");
    const image = await parsed("xai", "xai/image-api.json", "xai-image-api");
    const video = await parsed("xai", "xai/video-api.json", "xai-video-api");
    expect(language[0]).toMatchObject({
      model_id: "grok-4.5",
      types: ["generate"],
      modalities: { input: ["text", "image"], output: ["text"] },
      scope: "runtime_observation",
      source_refs: ["xai-language-api"],
    });
    expect(image[0]).toMatchObject({ types: ["image"], scope: "runtime_observation" });
    expect(video[0]).toMatchObject({ types: ["video"], scope: "runtime_observation" });
  });

  it("retains a source when its canonical API ID matches a public alias", async () => {
    const value = manifest("xai");
    const catalogSource = value.sources[0];
    const apiSource = value.sources.find(({ id }) => id === "xai-api");
    if (catalogSource === undefined || apiSource === undefined)
      throw new Error("Missing xAI source");
    const catalog = await xaiCatalog();
    const inventory = await parsed("xai", "xai/api.json", "xai-api");
    const merged = applyGroups(
      applyGroups([], [{ source: catalogSource, models: catalog }], true),
      [{ source: apiSource, models: inventory }],
      false,
    );
    expect(merged.find(({ model_id }) => model_id === "grok-4.5")?.source_refs).toEqual([
      "xai-models",
      "xai-api",
    ]);
  });
});

describe("document adapter", () => {
  it("pairs Bedrock display names with official endpoint model IDs", async () => {
    const models = await parsed("amazon-bedrock", "document/bedrock.json");
    expect(models.map(({ model_id, id_kind, name }) => ({ model_id, id_kind, name }))).toEqual([
      {
        model_id: "anthropic.claude-haiku-4-5",
        id_kind: "api_id",
        name: "Claude Haiku 4.5",
      },
      {
        model_id: "anthropic.claude-haiku-4-5-20251001-v1:0",
        id_kind: "api_id",
        name: "Claude Haiku 4.5",
      },
      { model_id: "cohere.command-r-v1:0", id_kind: "api_id", name: "Command R" },
    ]);
    const runtime = models.find(
      (model) => model.model_id === "anthropic.claude-haiku-4-5-20251001-v1:0",
    );
    expect(models[0]?.types).toEqual(["generate"]);
    expect(models[0]?.modalities.input).toEqual(["text", "image"]);
    expect(runtime?.aliases).toEqual([
      "global.anthropic.claude-haiku-4-5-20251001-v1:0",
      "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    ]);
    expect(models[0]?.limits).toEqual({ context_tokens: 200_000, max_output_tokens: 64_000 });
    expect(models[0]?.release_date).toBe("2025-10-15");
    expect(models[0]?.capabilities.reasoning).toBe(true);
    expect(models[0]?.capabilities.prompt_cache).toBe(true);
    expect(runtime?.pricing).toEqual([
      expect.objectContaining({
        meter: "input_text",
        price: "0.8",
        unit: "million_tokens",
        conditions: expect.objectContaining({
          region: "us-east-1",
          endpoint: "bedrock-runtime",
          service_tier: "standard",
        }),
      }),
    ]);
    expect(models[2]?.status).toBe("deprecated");
    expect(models[2]?.aliases).toEqual(["us.cohere.command-r-v1:0"]);
  });

  it("parses the signed regional inventory as a scoped structured overlay", async () => {
    const model = (
      await parsed("amazon-bedrock", "document/bedrock-api.json", "bedrock-api-us-east-1")
    )[0];
    expect({
      id: model?.model_id,
      name: model?.name,
      release: model?.release_date,
      modalities: model?.modalities,
      streaming: model?.capabilities.streaming,
      fineTuning: model?.capabilities.fine_tuning,
      status: model?.status,
    }).toEqual({
      id: "anthropic.claude-haiku-4-5-20251001-v1:0",
      name: "Claude Haiku 4.5",
      release: "2025-10-15",
      modalities: { input: ["text", "image"], output: ["text"] },
      streaming: true,
      fineTuning: true,
      status: "active",
    });
  });
});

describe("Vercel adapter", () => {
  it("parses the normal catalog shape", async () => {
    const model = (await vercelCatalog("vercel/normal.json"))[0];
    expect({
      limits: model?.limits,
      release: model?.release_date,
      pricing: model?.pricing_status,
    }).toEqual({
      limits: { context_tokens: 32768, max_output_tokens: 4096 },
      release: "2025-05-29",
      pricing: "not_published",
    });
  });

  it("preserves pricing tiers and normalizes token units", async () => {
    const model = (await vercelCatalog("vercel/pricing.json"))[0];
    expect({
      id: model?.model_id,
      input: model?.pricing.find((rate) => rate.meter === "input_text")?.price,
      output: model?.pricing.find((rate) => rate.meter === "output_text")?.price,
      cache_rates: model?.pricing.filter((rate) => rate.meter === "cache_read_text").length,
      pricing_status: model?.pricing_status,
    }).toEqual(await expected("vercel/expected.json"));
  });

  it("keeps structured multi-type, service-tier, and tool facts", async () => {
    const model = (await vercelCatalog("vercel/pricing.json"))[0];
    expect({
      types: model?.types,
      effort: model?.capabilities.effort_control,
      services: model?.pricing
        .filter((rate) => rate.conditions.service_tier === "flex")
        .map((rate) => ({
          meter: rate.meter,
          min: rate.conditions.context_min_tokens,
          max: rate.conditions.context_max_tokens,
        })),
      tools: model?.pricing
        .filter((rate) => rate.meter === "tool_call")
        .map((rate) => ({
          operation: rate.conditions.operation,
          price: rate.price,
          unit: rate.unit,
        })),
    }).toEqual({
      types: ["generate", "realtime"],
      effort: true,
      services: [
        { meter: "input_text", min: undefined, max: 200000 },
        { meter: "output_text", min: undefined, max: 200000 },
        { meter: "input_text", min: 200000, max: undefined },
        { meter: "output_text", min: 200000, max: undefined },
      ],
      tools: [
        { operation: "web_search", price: "10", unit: "thousand_requests" },
        { operation: "maps_search", price: "14", unit: "thousand_requests" },
      ],
    });
  });

  it("normalizes specialized modalities, lifecycle, and native pricing units", async () => {
    const models = await vercelCatalog("vercel/pricing.json");
    const byId = new Map(models.map((model) => [model.model_id, model]));
    const embedding = byId.get("acme/embed-1");
    const image = byId.get("acme/image-1");
    const video = byId.get("acme/video-1");
    const videoToken = byId.get("acme/video-token-1");
    const speech = byId.get("acme/speech-1");
    const transcription = byId.get("acme/transcribe-preview");
    expect({
      embedding: {
        modalities: embedding?.modalities,
        maxOutput: embedding?.limits.max_output_tokens,
        meter: embedding?.pricing[0]?.meter,
      },
      image: image?.pricing.map((rate) => ({ price: rate.price, conditions: rate.conditions })),
      video: video?.pricing[0],
      videoToken: videoToken?.pricing.map((rate) => ({
        price: rate.price,
        conditions: rate.conditions,
      })),
      speech: speech?.pricing.map((rate) => ({ meter: rate.meter, unit: rate.unit })),
      transcription: {
        types: transcription?.types,
        status: transcription?.status,
        deprecatedAt: transcription?.deprecated_at,
        pricing: transcription?.pricing.map((rate) => ({ meter: rate.meter, unit: rate.unit })),
      },
    }).toEqual({
      embedding: {
        modalities: { input: ["text"], output: ["embedding"] },
        maxOutput: undefined,
        meter: "embedding",
      },
      image: [
        { price: "0.04", conditions: {} },
        { price: "0.08", conditions: { operation: undefined, resolution: "4K", style: undefined } },
        {
          price: "0.12",
          conditions: { operation: undefined, resolution: undefined, style: "vector" },
        },
      ],
      video: {
        meter: "video_generation",
        price: "0.2",
        currency: "USD",
        unit: "second",
        conditions: {
          resolution: "1080p",
          quality: "pro",
          audio: true,
          voice_control: true,
        },
        source_ref: "vercel-models",
        derived: false,
        raw_price: "0.2",
        raw_unit: "second",
      },
      videoToken: [
        { price: "7", conditions: { video_input: false } },
        { price: "4.3", conditions: { video_input: true } },
      ],
      speech: [{ meter: "input_text", unit: "character" }],
      transcription: {
        types: ["audio_transcription", "realtime"],
        status: "deprecated",
        deprecatedAt: "2025-07-01",
        pricing: [{ meter: "input_audio", unit: "second" }],
      },
    });
  });

  it("detects item schema drift", async () => {
    await expect(vercelCatalog("vercel/broken.json")).rejects.toThrow("schema drift");
  });
});

describe("Cerebras adapter", () => {
  it("retains explicit capabilities and preview status", async () => {
    const model = (await parsed("cerebras", "cerebras/normal.json"))[0];
    expect(model?.capabilities.reasoning).toBe(true);
    expect(model?.types).toEqual(["generate"]);
    expect(model?.capabilities.structured_output).toBe(false);
    expect(model?.status).toBe("preview");
  });

  it("normalizes published per-token rates", async () => {
    const model = (await parsed("cerebras", "cerebras/pricing.json"))[0];
    expect({
      id: model?.model_id,
      input: model?.pricing.find((rate) => rate.meter === "input_text")?.price,
      output: model?.pricing.find((rate) => rate.meter === "output_text")?.price,
      pricing_status: model?.pricing_status,
    }).toEqual(await expected("cerebras/expected.json"));
  });

  it("rejects an empty catalog", async () => {
    await expect(parsed("cerebras", "cerebras/broken.json")).rejects.toThrow("schema drift");
  });
});

describe("Hugging Face adapter", () => {
  it("parses every concrete mapping and unions non-exclusive tasks", async () => {
    const models = await parsed("huggingface", "huggingface/normal.json");
    const multi = models.find((model) => model.model_id === "org/multi-model");
    const embedding = models.find((model) => model.model_id === "org/embed-model");
    expect(models.map((model) => model.model_id)).toEqual([
      "org/embed-model",
      "org/model-1",
      "org/multi-model",
    ]);
    expect(multi?.types).toEqual(["image", "video"]);
    expect(multi?.modalities).toEqual({
      input: ["text", "image"],
      output: ["image", "video"],
    });
    expect(embedding?.types).toEqual(["embeddings"]);
    expect(embedding?.modalities.output).toEqual(["embedding"]);
  });

  it("keeps every router price and route-derived fact", async () => {
    const models = await huggingFaceRouter("huggingface/pricing.json");
    const model = models.find((item) => item.model_id === "org/model-1");
    const free = models.find((item) => item.model_id === "org/free-model");
    expect({
      id: model?.model_id,
      input_rates: model?.pricing.filter((rate) => rate.meter === "input_text").length,
      output_rates: model?.pricing.filter((rate) => rate.meter === "output_text").length,
      routes: [
        ...new Set(model?.pricing.flatMap((rate) => rate.conditions.route_provider ?? []) ?? []),
      ].sort(),
      pricing_status: model?.pricing_status,
    }).toEqual(await expected("huggingface/expected.json"));
    expect(model?.limits.context_tokens).toBe(131072);
    expect(model?.capabilities.tool_call).toBe(true);
    expect(model?.capabilities.structured_output).toBe(true);
    expect(model?.modalities.input).toEqual(["text", "image"]);
    expect(model?.release_date).toBeUndefined();
    expect(
      free?.pricing.map((rate) => [rate.meter, rate.price, rate.conditions.promotion]),
    ).toEqual([
      ["input_text", "0", true],
      ["output_text", "0", true],
    ]);
  });

  it("retains every catalog and router source that matches a model", async () => {
    const value = manifest("huggingface");
    const first = value.sources.find((source) => source.id === "huggingface-cerebras");
    const second = value.sources.find((source) => source.id === "huggingface-cohere");
    const router = huggingFaceRouterSource(value);
    if (first === undefined || second === undefined)
      throw new Error("Missing Hugging Face sources");
    const body = await fixture("huggingface/normal.json");
    const routeBody = await fixture("huggingface/pricing.json");
    const groups = [first, second].map((source) => ({
      source,
      models: parseSource({ provider: provider(value), source, body, observedAt }),
    }));
    const overlay = parseSource({
      provider: provider(value),
      source: router,
      body: routeBody,
      observedAt,
    });
    const models = applyGroups(
      applyGroups([], groups, true),
      [{ source: router, models: overlay }],
      false,
    );
    expect(models.find((model) => model.model_id === "org/model-1")?.source_refs).toEqual([
      "huggingface-cerebras",
      "huggingface-cohere",
      "huggingface-router",
    ]);
  });

  it("rejects malformed mappings and non-live router routes", async () => {
    await expect(parsed("huggingface", "huggingface/broken.json")).rejects.toThrow(
      "Expected a Hugging Face repository ID",
    );
    await expect(huggingFaceRouter("huggingface/broken-router.json")).rejects.toThrow();
  });
});

describe("runtime adapters", () => {
  it("marks Ollama pricing as not applicable", async () => {
    const model = (await parsed("ollama", "ollama/normal.json"))[0];
    expect({
      id: model?.model_id,
      pricing_status: model?.pricing_status,
      scope: model?.scope,
      updated: model?.updated_date,
    }).toEqual(await expected("ollama/expected.json"));
    expect((await parsed("ollama", "ollama/pricing.json"))[0]?.pricing.length).toBe(0);
    await expect(parsed("ollama", "ollama/broken.json")).rejects.toThrow("schema drift");
  });

  it("parses an explicitly configured vLLM observation", async () => {
    const runtimeProvider: Provider = {
      id: "vllm",
      name: "vLLM runtime",
      kind: "local_runtime",
      homepage: "https://vllm.ai/",
      catalog_scope: "runtime",
      source_ids: ["vllm-fixture"],
    };
    const source: SourceManifest = {
      id: "vllm-fixture",
      url: "https://runtime.example.test/v1/models",
      type: "api",
      access: "configured",
      format: "json",
      stability: "documented",
      extractor: { kind: "vllm" },
      extractorVersion: "vllm-v1",
      fields: ["model_id"],
      allowedHosts: ["runtime.example.test"],
      maxResponseBytes: 1024,
    };
    const parseRuntime = async (name: string): Promise<ProviderModel[]> =>
      parseSource({
        provider: runtimeProvider,
        source,
        body: await fixture(`vllm/${name}.json`),
        observedAt,
      });
    const model = (await parseRuntime("normal"))[0];
    expect({
      id: model?.model_id,
      pricing_status: model?.pricing_status,
      scope: model?.scope,
    }).toEqual(await expected("vllm/expected.json"));
    expect((await parseRuntime("pricing"))[0]?.pricing.length).toBe(0);
    await expect(parseRuntime("broken")).rejects.toThrow("empty model list");
  });
});

describe("provider drift validation", () => {
  it("retains every source that observed a matching model", () => {
    const previous = baseModel({
      providerId: "example",
      id: "model",
      name: "Model",
      sourceId: "official-api",
      observedAt: "2026-07-20T00:00:00.000Z",
    });
    const current = baseModel({
      providerId: "example",
      id: "model",
      name: "Model",
      sourceId: "official-website",
      observedAt,
    });
    expect(preserveMissing([current], [previous])[0]?.source_refs).toEqual([
      "official-api",
      "official-website",
    ]);
  });

  it("quarantines large deletions and price jumps", async () => {
    const model = (await vercelCatalog("vercel/pricing.json"))[0];
    if (model === undefined) throw new Error("Missing fixture model");
    const second = {
      ...model,
      model_id: "acme/text-2",
      uid: "vercel/acme/text-2",
      name: "Text Two",
    };
    expect(validateProvider([model], [model, second])).toEqual({
      ok: false,
      reason: "model count dropped by more than 10%",
    });
    const changed = {
      ...model,
      pricing: model.pricing.map((rate) =>
        rate.meter === "input_text" ? { ...rate, price: "0.19" } : rate,
      ),
    };
    expect(validateProvider([changed], [model]).reason).toContain("price changed over 50%");
  });
});
