import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import {
  classifyModelTypes,
  multiplyDecimal,
  parseSource,
  scaleDecimal,
} from "../src/catalog/adapters.ts";
import {
  curlResponse,
  linkedDocumentUrls,
  normalizeOllamaList,
  normalizeOllamaResponse,
} from "../src/catalog/fetch.ts";
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

function endpoints(model: ProviderModel | undefined): string[] | undefined {
  return model?.api_endpoints?.map(({ name, path }) => `${name} ${path}`);
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

async function deepseekCatalog(chat?: string): Promise<ProviderModel[]> {
  const value = manifest("deepseek");
  const source = value.sources.find(({ id }) => id === "deepseek-catalog");
  if (source === undefined) throw new Error("Missing DeepSeek catalog source");
  const body = JSON.stringify({
    index: { url: source.url, body: await fixture("deepseek/catalog.html") },
    documents: [
      {
        url: "https://api-docs.deepseek.com/api/create-chat-completion",
        body: chat ?? (await fixture("deepseek/chat.html")),
      },
    ],
  });
  return parseSource({ provider: provider(value), source, body, observedAt });
}

async function anthropicCatalog(
  messagesBody?: string,
  batchGuideBody?: string,
): Promise<ProviderModel[]> {
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
      {
        url: "https://platform.claude.com/docs/en/api/messages/create.md",
        body: messagesBody ?? (await fixture("anthropic/messages.md")),
      },
      {
        url: "https://platform.claude.com/docs/en/api/messages/batches/create.md",
        body: await fixture("anthropic/batches.md"),
      },
      {
        url: "https://platform.claude.com/docs/en/build-with-claude/batch-processing.md",
        body: batchGuideBody ?? (await fixture("anthropic/batch-processing.md")),
      },
    ],
  });
  return parseSource({ provider: provider(value), source, body, observedAt });
}

async function databricksCatalog(
  overrides: Readonly<Record<string, string>> = {},
): Promise<ProviderModel[]> {
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
    [
      "https://docs.databricks.com/aws/en/machine-learning/model-serving/score-foundation-models",
      "model-types.html",
    ],
    ["https://docs.databricks.com/aws/en/feed.xml", "release-feed.xml"],
  ] as const;
  const body = JSON.stringify({
    index: { url: source.url, body: await fixture("databricks/models.html") },
    documents: await Promise.all(
      documents.map(async ([url, path]) => ({
        url,
        body: overrides[path] ?? (await fixture(`databricks/${path}`)),
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

async function xaiCatalog(
  index = "xai/models.txt",
  edit: (body: string) => string = (body) => body,
  editLlms: (body: string) => string = (body) => body,
): Promise<ProviderModel[]> {
  const value = manifest("xai");
  const configured = value.sources[0];
  if (configured === undefined || configured.extractor.kind !== "xai-catalog")
    throw new Error("Missing xAI source");
  const source: SourceManifest = {
    ...configured,
    extractor: { kind: "xai-catalog", minModels: 4, maxModels: 10 },
  };
  const body = JSON.stringify({
    index: { url: source.url, body: edit(await fixture(index)) },
    documents: [
      { url: "https://docs.x.ai/llms.txt", body: editLlms(await fixture("xai/llms.txt")) },
    ],
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

function huggingFaceMappingSource(value: ProviderManifest): SourceManifest {
  const configured = value.sources.find((source) => source.id === "huggingface-hf-inference");
  if (configured === undefined || configured.extractor.kind !== "huggingface-mapping")
    throw new Error("Missing Hugging Face mapping source");
  return {
    ...configured,
    extractor: { ...configured.extractor, minModels: 1, maxModels: 10 },
  };
}

async function huggingFaceMapping(path: string): Promise<ProviderModel[]> {
  const value = manifest("huggingface");
  const source = huggingFaceMappingSource(value);
  return parseSource({ provider: provider(value), source, body: await fixture(path), observedAt });
}

async function huggingFaceRouter(path: string): Promise<ProviderModel[]> {
  const value = manifest("huggingface");
  const source = huggingFaceRouterSource(value);
  return parseSource({ provider: provider(value), source, body: await fixture(path), observedAt });
}

async function azureCatalog(stableApiSpec?: string): Promise<ProviderModel[]> {
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
    ["azure-v1-v1-generated.yaml", "openai-v1.yaml"],
    ["azure-v1-preview-generated.yaml", "openai-v1-preview.yaml"],
  ] as const;
  const body = JSON.stringify({
    index: { url: source.url, body: await fixture("azure/openai.md") },
    documents: await Promise.all(
      documents.map(async ([name, path]) => ({
        url: `https://raw.githubusercontent.com/${
          name.startsWith("azure-v1-")
            ? "Azure/azure-rest-api-specs/main/specification/ai/data-plane/OpenAI.v1"
            : "MicrosoftDocs/azure-ai-docs/main"
        }/${name}`,
        body:
          name === "azure-v1-v1-generated.yaml" && stableApiSpec !== undefined
            ? stableApiSpec
            : await fixture(`azure/${path}`),
      })),
    ),
  });
  return parseSource({ provider: provider(value), source, body, observedAt });
}

async function geminiCatalog(
  overrides: Readonly<Record<string, string>> = {},
): Promise<ProviderModel[]> {
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
    ["https://ai.google.dev/gemini-api/docs/interactions-overview", "interactions-overview.html"],
    ["https://ai.google.dev/api/interactions-api", "interactions-api.html"],
    ["https://ai.google.dev/api/all-methods", "all-methods.html"],
    ["https://ai.google.dev/api/live", "live-api.html"],
  ] as const;
  const body = JSON.stringify({
    index: { url: source.url, body: await fixture("gemini/index.html") },
    documents: await Promise.all(
      documents.map(async ([url, path]) => ({
        url,
        body: overrides[path] ?? (await fixture(`gemini/${path}`)),
      })),
    ),
  });
  return parseSource({ provider: provider(value), source, body, observedAt });
}

async function vertexModels(
  sourceIndex: number,
  documents: readonly (readonly [string, string])[],
  overrides: Readonly<Record<string, string>> = {},
): Promise<ProviderModel[]> {
  const value = manifest("vertex");
  const configured = value.sources[sourceIndex];
  if (configured === undefined || configured.extractor.kind !== "vertex-catalog")
    throw new Error("Missing Vertex source");
  const source: SourceManifest = {
    ...configured,
    extractor: { kind: "vertex-catalog", minModels: 1, maxModels: 5 },
  };
  const body = JSON.stringify({
    index: { url: source.url, body: "<main></main>" },
    documents: await Promise.all(
      documents.map(async ([url, path]) => ({
        url,
        body: overrides[path] ?? (await fixture(`vertex/${path}`)),
      })),
    ),
  });
  return parseSource({ provider: provider(value), source, body, observedAt });
}

async function vertexCatalog(
  overrides: Readonly<Record<string, string>> = {},
): Promise<ProviderModel[]> {
  return vertexModels(
    0,
    [
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
      [
        "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/start",
        "routes.html",
      ],
      [
        "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/embeddings/get-multimodal-embeddings",
        "routes.html",
      ],
      [
        "https://docs.cloud.google.com/vertex-ai/generative-ai/docs/image/generate-images",
        "routes.html",
      ],
      [
        "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/video/generate-videos-from-text",
        "routes.html",
      ],
      [
        "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/music/generate-music",
        "routes.html",
      ],
    ],
    overrides,
  );
}

async function cohereCatalog(
  overrides: { chat?: string; commandAPlus?: string; index?: string; pricing?: string } = {},
): Promise<ProviderModel[]> {
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
    ["https://docs.cohere.com/reference/chat.md", "chat.md"],
    ["https://docs.cohere.com/reference/chat-v1.md", "chat-v1.md"],
    ["https://docs.cohere.com/reference/embed.md", "embed.md"],
    ["https://docs.cohere.com/reference/create-embed-job.md", "create-embed-job.md"],
    ["https://docs.cohere.com/reference/rerank.md", "rerank.md"],
    ["https://docs.cohere.com/reference/create-audio-transcription.md", "transcription.md"],
    ["https://docs.cohere.com/docs/compatibility-api.md", "compatibility.md"],
    ["https://docs.cohere.com/v1/reference/generate.md", "generate.md"],
  ];
  const body = JSON.stringify({
    index: {
      url: source.url,
      body: overrides.index ?? (await fixture("cohere/index.html")),
    },
    documents: await Promise.all(
      documents.map(async ([url, path]) => ({
        url,
        body:
          url === "https://docs.cohere.com/reference/chat.md" && overrides.chat !== undefined
            ? overrides.chat
            : url === "https://docs.cohere.com/docs/command-a-plus" &&
                overrides.commandAPlus !== undefined
              ? overrides.commandAPlus
              : url === "https://cohere.com/pricing" && overrides.pricing !== undefined
                ? overrides.pricing
                : await fixture(`cohere/${path}`),
      })),
    ),
  });
  return parseSource({ provider: provider(value), source, body, observedAt });
}

async function mistralCatalog(
  overrides: { medium?: string; schema?: string; endpoints?: string } = {},
): Promise<ProviderModel[]> {
  const value = manifest("mistral");
  const configured = value.sources[0];
  if (configured === undefined || configured.extractor.kind !== "mistral-catalog")
    throw new Error("Missing Mistral source");
  const source: SourceManifest = {
    ...configured,
    extractor: { kind: "mistral-catalog", minModels: 6, maxModels: 6 },
  };
  const slugs = [
    "mistral-medium-3-5-26-04",
    "codestral-embed-25-05",
    "ocr-4-0",
    "voxtral-tts-26-03",
    "mistral-large-2-0-24-07",
    "mistral-large-3-25-12",
  ];
  const body = JSON.stringify({
    index: { url: source.url, body: await fixture("mistral/index.ts") },
    documents: [
      {
        url: "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/schema/models/schema.ts",
        body: overrides.schema ?? (await fixture("mistral/schema.ts")),
      },
      {
        url: "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/schema/models/endpoints.ts",
        body: overrides.endpoints ?? (await fixture("mistral/endpoints.ts")),
      },
      ...(await Promise.all(
        slugs.map(async (slug) => ({
          url: `https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/schema/models/models/${slug}.ts`,
          body:
            slug === "mistral-medium-3-5-26-04" && overrides.medium !== undefined
              ? overrides.medium
              : await fixture(`mistral/${slug}.ts`),
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

async function llamaCatalog(overrides: Record<string, string> = {}): Promise<ProviderModel[]> {
  const value = manifest("llama");
  const configured = value.sources[0];
  if (configured === undefined || configured.extractor.kind !== "llama-catalog")
    throw new Error("Missing Llama source");
  const source: SourceManifest = {
    ...configured,
    extractor: { kind: "llama-catalog", minModels: 8, maxModels: 8 },
  };
  const files: [path: string, fixturePath: string, repository?: string][] = [
    ["models/sku_types.py", "sku_types.py"],
    ["models/cli/safety_models.py", "safety_models.py"],
    ["README.md", "README.md"],
    ["models/llama3_1/MODEL_CARD.md", "llama3_1.md"],
    ["models/llama3_2/MODEL_CARD.md", "llama3_2.md"],
    ["models/llama3_3/MODEL_CARD.md", "llama3_3.md"],
    ["models/llama4/MODEL_CARD.md", "llama4.md"],
    ["examples/chat.py", "chat.py", "llama-api-python"],
    ["examples/tool_call.py", "tool_call.py", "llama-api-python"],
    ["examples/structured.py", "structured.py", "llama-api-python"],
    ["src/llama_api_client/_client.py", "client.py", "llama-api-python"],
    ["src/llama_api_client/resources/chat/completions.py", "completions.py", "llama-api-python"],
  ];
  const body = JSON.stringify({
    index: {
      url: source.url,
      body: overrides["sku_list.py"] ?? (await fixture("llama/sku_list.py")),
    },
    documents: await Promise.all(
      files.map(async ([path, fixturePath, repository = "llama-models"]) => ({
        url: `https://raw.githubusercontent.com/meta-llama/${repository}/main/${path}`,
        body: overrides[fixturePath] ?? (await fixture(`llama/${fixturePath}`)),
      })),
    ),
  });
  return parseSource({ provider: provider(value), source, body, observedAt });
}

function ollamaSource(kind: "ollama-cloud" | "ollama-library"): SourceManifest {
  const value = manifest("ollama");
  const configured = value.sources.find((source) => source.extractor.kind === kind);
  if (configured === undefined) throw new Error(`Missing ${kind} source`);
  return {
    ...configured,
    extractor: { kind, minModels: 1, maxModels: 10 },
  };
}

async function ollamaLibrary(): Promise<ProviderModel[]> {
  const value = manifest("ollama");
  const source = ollamaSource("ollama-library");
  return parseSource({
    provider: provider(value),
    source,
    body: await fixture("ollama/library.html"),
    observedAt,
  });
}

async function ollamaCloudBody(): Promise<string> {
  const raw: unknown = JSON.parse(await fixture("ollama/cloud.json"));
  const bundle = z.object({ list: z.unknown(), documents: z.array(z.unknown()) }).parse(raw);
  return JSON.stringify({
    ...bundle,
    catalog: {
      url: "https://ollama.com/search?c=cloud",
      body: await fixture("ollama/cloud-catalog.html"),
    },
  });
}

async function ollamaCloud(): Promise<ProviderModel[]> {
  const value = manifest("ollama");
  const source = ollamaSource("ollama-cloud");
  return parseSource({
    provider: provider(value),
    source,
    body: await ollamaCloudBody(),
    observedAt,
  });
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
      types("translate-gemma"),
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
    expect(manifest("ollama").sources).toMatchObject([
      { id: "ollama-library", type: "website" },
      { id: "ollama-cloud-models", source: ["api", "website"] },
    ]);
    expect(manifest("vllm")).toMatchObject({
      sources: [],
      notConfiguredReason: "No explicitly allowlisted runtime endpoint is configured.",
    });
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
      plus_endpoints: commandAPlus?.api_endpoints,
      command_a_endpoints: commandA?.api_endpoints,
      embedding_limits: embedding?.limits,
      embedding_endpoints: embedding?.api_endpoints,
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
        endpoints: arabic?.api_endpoints,
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
      plus_endpoints: [
        { name: "Chat Completions", path: "compatibility/v1/chat/completions" },
        { name: "Chat V2", path: "v2/chat" },
      ],
      command_a_endpoints: [{ name: "Chat V2", path: "v2/chat" }],
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
      embedding_endpoints: [{ name: "Embed", path: "v2/embed" }],
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
        endpoints: [{ name: "Audio Transcriptions", path: "v2/audio/transcriptions" }],
      },
    });
    expect(models.find(({ model_id }) => model_id === "embed-english-v3.0")?.api_endpoints).toEqual(
      [
        { name: "Embed Jobs", path: "v1/embed-jobs" },
        { name: "Embed", path: "v2/embed" },
      ],
    );
    expect(models.find(({ model_id }) => model_id === "rerank-v4.0-pro")?.api_endpoints).toEqual([
      { name: "Rerank", path: "v2/rerank" },
    ]);
    expect(models.find(({ model_id }) => model_id === "command")?.api_endpoints).toEqual([
      { name: "Generate", path: "v1/generate" },
      { name: "Chat V2", path: "v2/chat" },
    ]);
  });

  it("treats the authenticated API as a complete scoped page", async () => {
    const models = await parsed("cohere", "cohere/api.json", "cohere-api");
    expect(
      models.map(({ model_id, types, api_endpoints, limits, is_deprecated }) => ({
        model_id,
        types,
        api_endpoints,
        limits,
        is_deprecated,
      })),
    ).toEqual([
      {
        model_id: "command-r-08-2024",
        types: ["generate"],
        api_endpoints: [{ name: "Generate", path: "v1/generate" }],
        limits: { context_tokens: 128_000 },
        is_deprecated: false,
      },
      {
        model_id: "embed-v4.0",
        types: ["embeddings", "classification"],
        api_endpoints: [{ name: "Classify", path: "v1/classify" }],
        limits: { context_tokens: 128_000 },
        is_deprecated: false,
      },
      {
        model_id: "cohere-transcribe-07-2026",
        types: ["audio_transcription"],
        api_endpoints: undefined,
        limits: { context_tokens: 10_000 },
        is_deprecated: "unknown",
      },
      {
        model_id: "embed-english-v3.0-image",
        types: ["embeddings"],
        api_endpoints: undefined,
        limits: {},
        is_deprecated: "unknown",
      },
    ]);
    await expect(parsed("cohere", "cohere/truncated-api.json", "cohere-api")).rejects.toThrow(
      "truncated",
    );
  });

  it("rejects model endpoint and API-reference drift", async () => {
    const chat = (await fixture("cohere/chat.md")).replace("/v2/chat", "/v2/renamed");
    await expect(cohereCatalog({ chat })).rejects.toThrow("Cohere API reference drifted: Chat V2");
    const commandAPlus = (await fixture("cohere/command-a-plus.html")).replace(
      "Chat Completions",
      "Responses",
    );
    await expect(cohereCatalog({ commandAPlus })).rejects.toThrow(
      "Unsupported Cohere model endpoint: Responses",
    );
  });

  it("takes operation families from reviewed catalog sections, not identifier prefixes", async () => {
    const index = (await fixture("cohere/index.html")).replace(
      "<td>command-nightly</td>\n      <td>Cohere API</td>\n    </tr>",
      "<td>command-nightly</td>\n      <td>Cohere API</td>\n    </tr>\n    <tr>\n      <td>research-nightly</td>\n      <td>Cohere API</td>\n    </tr>",
    );
    const models = await cohereCatalog({ index });
    expect(models.find(({ model_id }) => model_id === "research-nightly")?.types).toEqual([
      "generate",
    ]);
    await expect(
      cohereCatalog({
        index: index.replace(
          "</main>",
          "<h2>Safety</h2><table><tr><th>Model Name</th></tr><tr><td>safety-1</td></tr></table></main>",
        ),
      }),
    ).rejects.toThrow("Unsupported Cohere model catalog section");
  });

  it("rejects conflicting responsive pricing payloads", async () => {
    const pricing = await fixture("cohere/pricing.html");
    const frame = pricing.match(/<script[\s\S]*?<\/script>/)?.[0];
    if (frame === undefined) throw new Error("Missing Cohere pricing fixture frame");
    await expect(
      cohereCatalog({
        pricing: pricing.replace("</main>", `${frame.replace("0.15", "0.16")}</main>`),
      }),
    ).rejects.toThrow("Cohere pricing payloads disagree for Command R");
  });

  it("declares reviewed catalog companions and a non-persistent account inventory", () => {
    const value = manifest("cohere");
    expect(value.sources).toMatchObject([
      {
        extractor: { kind: "cohere-catalog" },
        type: "website",
        fields: expect.arrayContaining(["api_endpoints"]),
        linkedDocuments: { minDocuments: 17, maxDocuments: 24 },
      },
      {
        extractor: { kind: "cohere-api" },
        type: "api",
        scope: "account",
        role: "inventory",
        fields: expect.arrayContaining(["api_endpoints"]),
        snapshotPolicy: "none",
      },
    ]);
  });
});

describe("Mistral adapters", () => {
  it("parses exact API names, non-exclusive operations, lifecycle, and native prices", async () => {
    const models = await mistralCatalog();
    const medium = models.find((model) => model.model_id === "mistral-medium-3-5");
    const embed = models.find((model) => model.model_id === "codestral-embed-2505");
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
        api_endpoints: medium?.api_endpoints,
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
      embed: {
        types: embed?.types,
        api_endpoints: embed?.api_endpoints,
      },
      ocr: {
        types: ocr?.types,
        api_endpoints: ocr?.api_endpoints,
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
        api_endpoints: speech?.api_endpoints,
        modalities: speech?.modalities,
        pricing: speech?.pricing.map(({ meter, price, unit }) => ({ meter, price, unit })),
      },
      retired: {
        types: retired?.types,
        status: retired?.status,
        deprecated_at: retired?.deprecated_at,
        retired_at: retired?.retired_at,
        replacements: retired?.replacement_model_ids,
        api_endpoints: retired?.api_endpoints,
      },
    }).toEqual({
      count: 6,
      medium: {
        name: "Mistral Medium 3.5",
        version: "26.04",
        aliases: ["mistral-medium-3", "mistral-medium-latest"],
        types: ["generate", "agentic"],
        api_endpoints: [
          { name: "Agents", path: "/v1/agents" },
          { name: "Batch", path: "/v1/batch" },
          { name: "Chat / Completions", path: "/v1/chat/completions" },
          { name: "Conversations", path: "/v1/conversations" },
        ],
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
      embed: {
        types: ["embeddings"],
        api_endpoints: [
          { name: "Batch", path: "/v1/batch" },
          { name: "Embeddings", path: "/v1/embeddings" },
        ],
      },
      ocr: {
        types: ["ocr"],
        api_endpoints: [
          { name: "Batch", path: "/v1/batch" },
          { name: "OCR", path: "/v1/ocr" },
        ],
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
        api_endpoints: [{ name: "Audio Speech", path: "/v1/audio/speech" }],
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
        api_endpoints: undefined,
      },
    });
  });

  it("fails closed on feature, endpoint, and pricing drift", async () => {
    const medium = await fixture("mistral/mistral-medium-3-5-26-04.ts");
    await expect(
      mistralCatalog({ medium: medium.replace('"chat-completions"', '"responses"') }),
    ).rejects.toThrow("Mistral published an unknown feature: responses");

    const schema = await fixture("mistral/schema.ts");
    await expect(
      mistralCatalog({
        schema: schema.replace(
          '"chat-completions": { endpoints: ["chat-completions"] }',
          '"chat-completions": { endpoints: ["responses"] }',
        ),
      }),
    ).rejects.toThrow("Mistral feature chat-completions referenced unknown endpoint responses");

    const endpoints = await fixture("mistral/endpoints.ts");
    await expect(
      mistralCatalog({
        endpoints: endpoints.replace(
          'path: "/v1/chat/completions"',
          'path: "https://api.mistral.ai/v1/chat/completions"',
        ),
      }),
    ).rejects.toThrow("Mistral endpoint chat-completions had an invalid relative path");

    await expect(
      mistralCatalog({ medium: medium.replace("free: false", "free: true") }),
    ).rejects.toThrow("Mistral marked non-zero model pricing as free");
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
        fields: expect.arrayContaining(["api_endpoints"]),
        linkedDocuments: {
          indexFormat: "typescript",
          minDocuments: 55,
          maxDocuments: 90,
          documents: expect.arrayContaining([
            expect.objectContaining({ id: "model-schema" }),
            expect.objectContaining({ id: "model-endpoints" }),
          ]),
        },
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
        capabilities: {
          streaming: hosted?.capabilities.streaming,
          structured_output: hosted?.capabilities.structured_output,
          tool_call: hosted?.capabilities.tool_call,
        },
        api_endpoints: hosted?.api_endpoints,
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
        capabilities: {
          streaming: true,
          structured_output: true,
          tool_call: true,
        },
        api_endpoints: [{ name: "Chat Completions", path: "/v1/chat/completions" }],
      },
      guard: {
        types: ["moderation"],
        modalities: { input: ["text", "image"], output: ["text"] },
        context: 131_072,
      },
      promptGuard: { types: ["classification"], context: 512 },
    });
  });

  it("fails closed on hosted identity, route, and family drift", async () => {
    const chat = await fixture("llama/chat.py");
    await expect(
      llamaCatalog({
        "chat.py": chat.replace("Llama-4-Maverick-17B-128E-Instruct-FP8", "unpublished-model"),
      }),
    ).rejects.toThrow("Llama chat example model unpublished-model did not resolve uniquely");

    const skuList = await fixture("llama/sku_list.py");
    await expect(
      llamaCatalog({
        "sku_list.py": skuList.replace(
          'huggingface_repo="meta-llama/Llama-4-Maverick-17B-128E",',
          'huggingface_repo="meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",',
        ),
      }),
    ).rejects.toThrow(
      "Llama chat example model Llama-4-Maverick-17B-128E-Instruct-FP8 did not resolve uniquely",
    );

    const completions = await fixture("llama/completions.py");
    await expect(
      llamaCatalog({
        "completions.py": completions.replace(
          '"/chat/completions"',
          '"https://api.llama.com/v1/chat/completions"',
        ),
      }),
    ).rejects.toThrow("Llama API chat path was not relative");

    const skuTypes = await fixture("llama/sku_types.py");
    await expect(
      llamaCatalog({
        "sku_types.py": skuTypes.replace(
          'llama2_7b = "Llama-2-7b"',
          'llama3_4_8b = "Llama-3.4-8B"',
        ),
        "sku_list.py": skuList
          .replace("CoreModelId.llama2_7b", "CoreModelId.llama3_4_8b")
          .replace("meta-llama/Llama-2-7b", "meta-llama/Llama-3.4-8B"),
      }),
    ).rejects.toThrow("No reviewed context rule for llama3_4_8b");
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
        fields: expect.arrayContaining(["api_endpoints"]),
        linkedDocuments: {
          documents: expect.arrayContaining([
            expect.objectContaining({ id: "llama-api-structured-example" }),
            expect.objectContaining({ id: "llama-api-client" }),
            expect.objectContaining({ id: "llama-api-chat-completions" }),
          ]),
        },
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
      linkedDocuments: { ...source.linkedDocuments, minDocuments: 6, maxDocuments: 6 },
    });
    expect(urls.map((url) => url.pathname)).toEqual([
      "/mistralai/platform-docs-public/main/src/schema/models/models/codestral-embed-25-05.ts",
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
      endpoints: model?.api_endpoints,
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
      endpoints: [
        { name: "Chat Completions", path: "v1/chat/completions" },
        { name: "Responses", path: "v1/responses" },
        { name: "Assistants", path: "v1/assistants" },
      ],
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
    expect(model?.api_endpoints).toEqual([
      { name: "Responses", path: "v1/responses" },
      { name: "Batch", path: "v1/batch" },
    ]);
  });

  it("fails closed on an unreviewed endpoint card", async () => {
    const value = manifest("openai");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing OpenAI catalog source");
    const body = (await fixture("openai/catalog.json")).replace(
      "v1/chat/completions",
      "v1/conversations",
    );
    expect(() => parseSource({ provider: provider(value), source, body, observedAt })).toThrow(
      "Unsupported OpenAI endpoint card",
    );
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
    const realtime = models.find((candidate) => candidate.uid === "azure/gpt-realtime@2025-08-28");
    const rerank = models.find((candidate) => candidate.uid === "azure/cohere-rerank-v4.0-fast@1");
    const embedding = models.find(
      (candidate) => candidate.uid === "azure/Cohere-embed-v3-english@1",
    );
    const retired = models.find((candidate) => candidate.uid === "azure/gpt-old@1");
    const newer = models.find((candidate) => candidate.uid === "azure/gpt-multi@2026-02-01");
    const family = models.find((candidate) => candidate.uid === "azure/gpt-family");
    expect({
      types: model?.types,
      serviceFamilies: model?.service_families,
      endpoints: model?.api_endpoints,
      modalities: model?.modalities,
      context: model?.limits.context_tokens,
      output: model?.limits.max_output_tokens,
      availability: model?.availability?.length,
      whisper: whisper?.types,
      whisperEndpoints: whisper?.api_endpoints,
      realtimeEndpoints: realtime?.api_endpoints,
      rerank: rerank?.types,
      embedding: [embedding?.types, embedding?.modalities.output, embedding?.service_families],
      retired: [retired?.status, retired?.replacement_model_ids],
      newer: [newer?.limits, newer?.api_endpoints],
      versionless: [family?.version, family?.service_families, family?.api_endpoints],
    }).toEqual({
      types: ["generate", "agentic"],
      serviceFamilies: ["Azure OpenAI"],
      endpoints: expect.arrayContaining([
        { name: "createBatch", path: "openai/v1/batches" },
        { name: "createChatCompletion", path: "openai/v1/chat/completions" },
        { name: "createResponse", path: "openai/v1/responses" },
      ]),
      modalities: { input: ["text", "image"], output: ["text"] },
      context: 128_000,
      output: 16_384,
      availability: 5,
      whisper: ["audio_transcription", "audio_translation"],
      whisperEndpoints: expect.arrayContaining([
        { name: "createTranscription", path: "openai/v1/audio/transcriptions" },
        { name: "createTranslation", path: "openai/v1/audio/translations" },
      ]),
      realtimeEndpoints: [{ name: "createRealtimeSession", path: "openai/v1/realtime/sessions" }],
      rerank: ["rerank", "classification"],
      embedding: [["embeddings"], ["embedding"], ["Foundry Models from partners and community"]],
      retired: ["retired", ["gpt-multi"]],
      newer: [{}, undefined],
      versionless: [
        undefined,
        ["Azure OpenAI"],
        [{ name: "createChatCompletion", path: "openai/v1/chat/completions" }],
      ],
    });
    expect(model?.api_endpoints).toHaveLength(3);
    expect(whisper?.api_endpoints).toHaveLength(2);
    expect(models.find((candidate) => candidate.uid === "azure/gpt-family@1")?.api_endpoints).toBe(
      undefined,
    );
    expect(models.find((candidate) => candidate.uid === "azure/gpt-family@2")?.api_endpoints).toBe(
      undefined,
    );
  });

  it("rejects drift in the reviewed Azure OpenAI API surface", async () => {
    const spec = (await fixture("azure/openai-v1.yaml")).replace(
      "operationId: createResponse",
      "operationId: renamedResponse",
    );
    await expect(azureCatalog(spec)).rejects.toThrow(
      "Azure OpenAI API specification drifted for openai/v1/responses",
    );
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
      endpoints: endpoints(model),
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
      endpoints: ["interactions.create /v1beta/interactions"],
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
    const models = await parsed("gemini", "gemini/api.json", "gemini-api");
    const model = models.find((item) => item.model_id === "gemini-test-preview");
    const embedding = models.find((item) => item.model_id === "embedding-test");
    const live = models.find((item) => item.model_id === "live-test");
    const future = models.find((item) => item.model_id === "future-test");
    expect({
      id: model?.model_id,
      name: model?.name,
      aliases: model?.aliases,
      types: model?.types,
      reasoning: model?.capabilities.reasoning,
      streaming: model?.capabilities.streaming,
      batch: model?.capabilities.batch,
      limits: model?.limits,
      endpoints: endpoints(model),
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
      endpoints: [
        "generateContent /v1beta/models/gemini-test-preview:generateContent",
        "streamGenerateContent /v1beta/models/gemini-test-preview:streamGenerateContent",
        "batchGenerateContent /v1beta/models/gemini-test-preview:batchGenerateContent",
        "countTokens /v1beta/models/gemini-test-preview:countTokens",
        "predictLongRunning /v1beta/models/gemini-test-preview:predictLongRunning",
      ],
      scope: "runtime_observation",
    });
    expect({
      embeddingTypes: embedding?.types,
      embeddingBatch: embedding?.capabilities.batch,
      embeddingEndpoints: endpoints(embedding),
      liveTypes: live?.types,
      liveStreaming: live?.capabilities.streaming,
      liveEndpoints: endpoints(live),
      futureTypes: future?.types,
      futureStreaming: future?.capabilities.streaming,
      futureBatch: future?.capabilities.batch,
      futureEndpoints: endpoints(future),
    }).toEqual({
      embeddingTypes: ["embeddings"],
      embeddingBatch: true,
      embeddingEndpoints: [
        "embedContent /v1beta/models/embedding-test:embedContent",
        "batchEmbedContents /v1beta/models/embedding-test:batchEmbedContents",
        "asyncBatchEmbedContent /v1beta/models/embedding-test:asyncBatchEmbedContent",
      ],
      liveTypes: ["realtime"],
      liveStreaming: true,
      liveEndpoints: [
        "bidiGenerateContent wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent",
      ],
      futureTypes: ["other"],
      futureStreaming: "unknown",
      futureBatch: "unknown",
      futureEndpoints: undefined,
    });
    await expect(parsed("gemini", "gemini/truncated-api.json", "gemini-api")).rejects.toThrow(
      "truncated",
    );
  });

  it("rejects drift in fixed route evidence", async () => {
    const overview = await fixture("gemini/interactions-overview.html");
    const interactionsApi = await fixture("gemini/interactions-api.html");
    const methods = await fixture("gemini/all-methods.html");
    await expect(
      geminiCatalog({
        "interactions-overview.html": overview.replace("gemini-test-preview", "gemini-unpublished"),
      }),
    ).rejects.toThrow("unknown model");
    await expect(
      geminiCatalog({
        "interactions-overview.html": overview.replace(
          "<td>Lyria Test</td>\n        <td>Model</td>",
          "<td>Lyria Test</td>\n        <td>Agent</td>",
        ),
      }),
    ).rejects.toThrow("agent classification");
    await expect(
      geminiCatalog({
        "interactions-api.html": interactionsApi.replace(
          "/v1beta/interactions",
          "/v1/interactions",
        ),
      }),
    ).rejects.toThrow("create endpoint changed");
    await expect(
      geminiCatalog({
        "all-methods.html": methods.replace(":generateContent", ":generateContentV2"),
      }),
    ).rejects.toThrow("model method changed");
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
      families: current?.service_families,
      endpoints: endpoints(current),
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
      families: ["publishers/google"],
      endpoints: [
        "generateContent /v1/projects/{project}/locations/{location}/publishers/google/models/{model}:generateContent",
      ],
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

  it("retains exact publisher and API-family evidence for partner and managed open models", async () => {
    const routes = "routes.html";
    const partner = await vertexModels(1, [
      [
        "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/claude/test",
        "partner.html",
      ],
      [
        "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/claude/use-claude",
        routes,
      ],
      [
        "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/grok/responses",
        routes,
      ],
      [
        "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/llama/use-llama",
        routes,
      ],
    ]);
    const open = await vertexModels(2, [
      [
        "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/maas/zaiorg/glm-test",
        "open.html",
      ],
      [
        "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/maas/call-open-model-apis",
        routes,
      ],
      [
        "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/maas/capabilities/thinking",
        routes,
      ],
    ]);
    expect({
      partner: [partner[0]?.service_families, endpoints(partner[0])],
      open: [
        open.find((model) => model.model_id === "glm-test-maas")?.service_families,
        endpoints(open.find((model) => model.model_id === "glm-test-maas")),
      ],
      unlisted: endpoints(open.find((model) => model.model_id === "embedding-test-maas")),
    }).toEqual({
      partner: [
        ["publishers/anthropic"],
        [
          "rawPredict /v1/projects/{project}/locations/{location}/publishers/anthropic/models/{model}:rawPredict",
          "streamRawPredict /v1/projects/{project}/locations/{location}/publishers/anthropic/models/{model}:streamRawPredict",
        ],
      ],
      open: [
        ["endpoints/openapi/zai-org"],
        [
          "Chat Completions /v1/projects/{project}/locations/{location}/endpoints/openapi/chat/completions",
        ],
      ],
      unlisted: undefined,
    });
  });

  it("uses an embedding card's direct guide link instead of navigation labels", async () => {
    const card = (await fixture("vertex/model.html")).replace(
      "</table>",
      '</table><a href="/gemini-enterprise-agent-platform/models/embeddings/get-multimodal-embeddings">Get multimodal embeddings</a>',
    );
    const model = (await vertexCatalog({ "model.html": card })).find(
      (item) => item.model_id === "gemini-test",
    );
    expect(endpoints(model)).toEqual([
      "embedContent /v1/projects/{project}/locations/{location}/publishers/google/models/{model}:embedContent",
    ]);
  });

  it("rejects drift in reviewed Vertex method references", async () => {
    const routes = (await fixture("vertex/routes.html")).replace(
      'GENERATE_CONTENT_API="generateContent"',
      'GENERATE_CONTENT_API="generateContentV2"',
    );
    await expect(vertexCatalog({ "routes.html": routes })).rejects.toThrow(
      "Vertex generateContent reference drifted",
    );
  });

  it("parses authenticated Model Garden inventory as scoped validation", async () => {
    const model = (await parsed("vertex", "vertex/api.json", "vertex-model-garden-api"))[0];
    expect({
      id: model?.model_id,
      status: model?.status,
      families: model?.service_families,
      scope: model?.scope,
    }).toEqual({
      id: "gemini-test",
      status: "active",
      families: ["publishers/google"],
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

  it("publishes current Messages and explicitly universal batch support", async () => {
    const models = await anthropicCatalog();
    const endpoints = (id: string) => models.find((model) => model.model_id === id)?.api_endpoints;
    expect(endpoints("claude-fable-5")).toEqual([
      { name: "Create a Message", path: "v1/messages" },
      { name: "Create a Message Batch", path: "v1/messages/batches" },
    ]);
    expect(endpoints("claude-opus-4-7")).toEqual([
      { name: "Create a Message", path: "v1/messages" },
      { name: "Create a Message Batch", path: "v1/messages/batches" },
    ]);
    expect(endpoints("claude-mythos-preview")).toBeUndefined();
    expect(endpoints("claude-opus-4-1-20250805")).toEqual([
      { name: "Create a Message", path: "v1/messages" },
    ]);
  });

  it("rejects a changed Messages operation contract", async () => {
    const body = (await fixture("anthropic/messages.md")).replace("/v1/messages", "/v2/messages");
    await expect(anthropicCatalog(body)).rejects.toThrow(
      "Anthropic endpoint document drifted for v1/messages",
    );
  });

  it("rejects loss of universal active-model batch coverage", async () => {
    await expect(anthropicCatalog(undefined, "# Message Batches API")).rejects.toThrow(
      "Anthropic batch model coverage drifted",
    );
  });
});

describe("Databricks adapters", () => {
  it("combines labeled endpoints with lifecycle, limits, feature support, and DBU rates", async () => {
    const models = await databricksCatalog();
    const sol = models.find((model) => model.model_id === "databricks-gpt-5-6-sol");
    const retired = models.find((model) => model.model_id === "databricks-claude-sonnet-4");
    const replacement = models.find((model) => model.model_id === "databricks-claude-sonnet-4-6");
    const embedding = models.find((model) => model.model_id === "databricks-gte-large-en");
    const image = models.find((model) => model.model_id === "databricks-gemini-3-pro-image");
    const open = models.find((model) => model.model_id === "databricks-glm-5-2");
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
      image_types: image?.types,
      endpoints: sol?.api_endpoints,
    }).toEqual({
      count: 9,
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
      image_types: ["generate", "image"],
      endpoints: [
        {
          name: "Invocations",
          path: "/serving-endpoints/databricks-gpt-5-6-sol/invocations",
        },
      ],
    });
    expect(open?.pricing.find((rate) => rate.meter === "cache_read_text")).toMatchObject({
      price: "3.714",
      unit: "million_tokens",
    });
    expect(open?.pricing.some((rate) => rate.meter === "provisioned_throughput")).toBe(false);
    expect(
      models
        .find((model) => model.model_id === "databricks-qwen3-embedding-0-6b")
        ?.pricing.filter((rate) => rate.meter === "provisioned_throughput")
        .map((rate) => [rate.conditions.capacity, rate.price]),
    ).toEqual([
      ["entry", "25"],
      ["scaling", "25"],
    ]);
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

  it("rejects task and API-reference drift instead of inferring routes", async () => {
    const tasks = await fixture("databricks/model-types.html");
    await expect(
      databricksCatalog({
        "model-types.html": tasks.replace("databricks-gpt-5-6-sol", "databricks-unknown-model"),
      }),
    ).rejects.toThrow("unknown catalog model");
    await expect(
      databricksCatalog({
        "model-types.html": tasks.replace("<code>databricks-gpt-5-6-sol</code>", ""),
      }),
    ).rejects.toThrow("omitted catalog models");
    await expect(
      databricksCatalog({
        "model-types.html": tasks.replace(
          "POST /serving-endpoints/{name}/invocations",
          "POST /serving-endpoints/{name}",
        ),
      }),
    ).rejects.toThrow("invocation route changed");
    const reference = await fixture("databricks/api-reference.html");
    await expect(
      databricksCatalog({
        "api-reference.html": reference.replace("Chat Completions API", "Chat API"),
      }),
    ).rejects.toThrow("API reference changed");
    const pricing = await fixture("databricks/pricing-open.html");
    await expect(
      databricksCatalog({
        "pricing-open.html": pricing.replace("cache read tokens", "cached tokens"),
      }),
    ).rejects.toThrow("open-model pricing table changed shape");
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
  it("validates voice service configuration without publishing internal service names", async () => {
    const models = await xaiCatalog("xai/models-voice-services.txt");
    expect(models.map(({ model_id }) => model_id)).toEqual([
      "grok-3",
      "grok-4.20-multi-agent-0309",
      "grok-4.5",
      "grok-imagine-image-pro",
      "grok-imagine-image-quality",
      "grok-imagine-video",
      "grok-imagine-video-1.5",
      "grok-voice-fast-1.0",
      "grok-voice-think-fast-1.0",
    ]);
    expect(
      models.some(({ model_id }) => ["grok-tts", "grok-stt", "grok-realtime"].includes(model_id)),
    ).toBe(false);
    await expect(
      xaiCatalog("xai/models-voice-services.txt", (body) =>
        body.replaceAll(
          '"realtimeAudioSecondPrice":"8333333"',
          '"realtimeAudioSecondPrice":"10000000"',
        ),
      ),
    ).rejects.toThrow("structured and published voice pricing differ");
  });

  it("joins the structured public catalog to lifecycle, voice, pricing, and release facts", async () => {
    const models = await xaiCatalog();
    expect(models.map(({ model_id }) => model_id)).toEqual([
      "grok-3",
      "grok-4.20-multi-agent-0309",
      "grok-4.5",
      "grok-imagine-image-pro",
      "grok-imagine-image-quality",
      "grok-imagine-video",
      "grok-imagine-video-1.5",
      "grok-voice-fast-1.0",
      "grok-voice-think-fast-1.0",
    ]);
    expect(models.find(({ model_id }) => model_id === "grok-4.5")).toMatchObject({
      name: "Grok 4.5",
      api_endpoints: [
        { name: "Chat Completions", path: "/v1/chat/completions" },
        { name: "Responses", path: "/v1/responses" },
      ],
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
      api_endpoints: [{ name: "Responses", path: "/v1/responses" }],
      release_date: "2026-03",
      status: "preview",
      capabilities: { citations: true, code_execution: true },
    });
    expect(models.find(({ model_id }) => model_id === "grok-imagine-image-quality")).toMatchObject({
      name: "Grok Imagine API",
      api_endpoints: [
        { name: "Image Edits", path: "/v1/images/edits" },
        { name: "Image Generations", path: "/v1/images/generations" },
      ],
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
      api_endpoints: [{ name: "Video Generations", path: "/v1/videos/generations" }],
      updated_date: "2026-05-30",
    });
    expect(models.find(({ model_id }) => model_id === "grok-voice-think-fast-1.0")).toMatchObject({
      aliases: ["grok-voice-latest"],
      types: ["agentic", "realtime"],
      api_endpoints: [{ name: "Realtime", path: "/v1/realtime" }],
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
    expect(models.find(({ model_id }) => model_id === "grok-3")?.api_endpoints).toBeUndefined();
    await expect(
      xaiCatalog(
        "xai/models.txt",
        (body) => body,
        (body) => body.replace("https://api.x.ai/v1/images/edits", "/v1/images/edits"),
      ),
    ).rejects.toThrow("xAI Image Edits evidence changed");
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
      { model_id: "cohere.rerank-v3-5:0", id_kind: "api_id", name: "Rerank 3.5" },
    ]);
    const runtime = models.find(
      (model) => model.model_id === "anthropic.claude-haiku-4-5-20251001-v1:0",
    );
    const mantle = models.find((model) => model.model_id === "anthropic.claude-haiku-4-5");
    const rerank = models.find((model) => model.model_id === "cohere.rerank-v3-5:0");
    expect(models[0]?.types).toEqual(["generate"]);
    expect(models[0]?.modalities.input).toEqual(["text", "image"]);
    expect(runtime?.aliases).toEqual([
      "global.anthropic.claude-haiku-4-5-20251001-v1:0",
      "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    ]);
    expect(runtime?.api_endpoints).toEqual([
      { name: "Converse", path: "model/{modelId}/converse" },
      { name: "Invoke", path: "model/{modelId}/invoke" },
      { name: "Messages", path: "model/{modelId}/invoke" },
    ]);
    expect(mantle?.api_endpoints).toEqual([{ name: "Messages", path: "anthropic/v1/messages" }]);
    expect(rerank?.api_endpoints).toEqual([
      { name: "Invoke", path: "model/{modelId}/invoke" },
      { name: "Rerank", path: "rerank" },
    ]);
    expect(runtime?.availability).toEqual([
      { region: "ap-southeast-4", deployment_type: "bedrock-runtime/geo" },
      { region: "us-east-1", deployment_type: "bedrock-runtime/geo" },
      { region: "ap-southeast-4", deployment_type: "bedrock-runtime/global" },
      { region: "us-east-1", deployment_type: "bedrock-runtime/global" },
      { region: "ap-southeast-4", deployment_type: "bedrock-runtime/in-region" },
      { region: "us-east-1", deployment_type: "bedrock-runtime/in-region" },
    ]);
    expect(mantle?.availability).toEqual([
      { region: "us-east-1", deployment_type: "bedrock-mantle/in-region" },
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

  it("keeps API evidence positive and fails closed on unknown labels", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Bedrock catalog source");
    const withoutInvoke = (await fixture("document/bedrock.json")).replace(
      "![Yes](icon-yes.png) Invoke",
      "![No](icon-no.png) Invoke",
    );
    const command = parseSource({
      provider: provider(value),
      source,
      body: withoutInvoke,
      observedAt,
    }).find(({ model_id }) => model_id === "cohere.command-r-v1:0");
    expect(command?.api_endpoints).toBeUndefined();

    const withChat = (await fixture("document/bedrock.json")).replace(
      "![Yes](icon-yes.png) Messages",
      "![Yes](icon-yes.png) Chat Completions",
    );
    const chatModels = parseSource({
      provider: provider(value),
      source,
      body: withChat,
      observedAt,
    });
    for (const id of ["anthropic.claude-haiku-4-5", "anthropic.claude-haiku-4-5-20251001-v1:0"])
      expect(chatModels.find(({ model_id }) => model_id === id)?.api_endpoints).toContainEqual({
        name: "Chat Completions",
        path: "v1/chat/completions",
      });

    const sharedId = withChat.replace(
      "`bedrock-mantle` | `anthropic.claude-haiku-4-5`",
      "`bedrock-mantle` | `anthropic.claude-haiku-4-5-20251001-v1:0`",
    );
    const sharedModel = parseSource({
      provider: provider(value),
      source,
      body: sharedId,
      observedAt,
    }).find(({ model_id }) => model_id === "anthropic.claude-haiku-4-5-20251001-v1:0");
    expect(sharedModel?.api_endpoints?.filter(({ name }) => name === "Chat Completions")).toEqual([
      { name: "Chat Completions", path: "v1/chat/completions" },
    ]);

    const body = (await fixture("document/bedrock.json")).replace(
      "![Yes](icon-yes.png) Invoke",
      "![Yes](icon-yes.png) Transform",
    );
    expect(() => parseSource({ provider: provider(value), source, body, observedAt })).toThrow(
      "Unsupported Bedrock API label",
    );
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
    const tokenTranscription = byId.get("acme/transcribe-token");
    const realtime = byId.get("acme/realtime-1");
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
      tokenTranscription: tokenTranscription?.pricing.map((rate) => ({
        meter: rate.meter,
        price: rate.price,
        unit: rate.unit,
      })),
      realtime: realtime?.pricing.map((rate) => ({
        meter: rate.meter,
        price: rate.price,
        unit: rate.unit,
        derived: rate.derived,
        rawUnit: rate.raw_unit,
      })),
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
      tokenTranscription: [
        { meter: "input_audio", price: "1.25", unit: "million_tokens" },
        { meter: "output_text", price: "5", unit: "million_tokens" },
      ],
      realtime: [
        {
          meter: "input_text",
          price: "4",
          unit: "million_tokens",
          derived: true,
          rawUnit: "token",
        },
        {
          meter: "output_text",
          price: "16",
          unit: "million_tokens",
          derived: true,
          rawUnit: "token",
        },
        {
          meter: "input_audio",
          price: "32",
          unit: "million_tokens",
          derived: true,
          rawUnit: "token",
        },
        {
          meter: "output_audio",
          price: "64",
          unit: "million_tokens",
          derived: true,
          rawUnit: "token",
        },
        {
          meter: "realtime_client_message",
          price: "0.004",
          unit: "request",
          derived: false,
          rawUnit: "message",
        },
        {
          meter: "realtime_session_duration",
          price: "0.000834",
          unit: "second",
          derived: false,
          rawUnit: "second",
        },
      ],
    });
  });

  it("detects item schema drift", async () => {
    await expect(vercelCatalog("vercel/broken.json")).rejects.toThrow("schema drift");
  });
});

describe("Cerebras adapter", () => {
  function source(id: string): SourceManifest {
    const configured = manifest("cerebras").sources.find((candidate) => candidate.id === id);
    if (configured === undefined) throw new Error(`Missing Cerebras source ${id}`);
    const extractor = configured.extractor;
    switch (extractor.kind) {
      case "cerebras-public":
      case "cerebras-catalog":
      case "cerebras-lifecycle":
      case "cerebras-releases":
      case "cerebras-api":
        return { ...configured, extractor: { ...extractor, minModels: 1, maxModels: 20 } };
      default:
        throw new Error(`Wrong Cerebras source ${id}`);
    }
  }

  async function parse(id: string, path: string): Promise<ProviderModel[]> {
    const value = manifest("cerebras");
    return parseSource({
      provider: provider(value),
      source: source(id),
      body: await fixture(path),
      observedAt,
    });
  }

  async function catalog(
    overrides: { chat?: string; completions?: string; gemma?: string; gpt?: string } = {},
  ): Promise<ProviderModel[]> {
    const value = manifest("cerebras");
    const configured = source("cerebras-catalog");
    const body = JSON.stringify({
      index: { url: configured.url, body: await fixture("cerebras/catalog.md") },
      documents: [
        {
          url: "https://inference-docs.cerebras.ai/models/openai-oss.md",
          body: overrides.gpt ?? (await fixture("cerebras/gpt.md")),
        },
        {
          url: "https://inference-docs.cerebras.ai/models/gemma-4-31b.md",
          body: overrides.gemma ?? (await fixture("cerebras/gemma.md")),
        },
        {
          url: "https://inference-docs.cerebras.ai/models/zai-glm-47.md",
          body: await fixture("cerebras/glm.md"),
        },
        {
          url: "https://inference-docs.cerebras.ai/capabilities/prompt-caching.md",
          body: await fixture("cerebras/cache.md"),
        },
        {
          url: "https://inference-docs.cerebras.ai/api-reference/chat-completions.md",
          body: overrides.chat ?? (await fixture("cerebras/chat-completions.md")),
        },
        {
          url: "https://inference-docs.cerebras.ai/api-reference/completions.md",
          body: overrides.completions ?? (await fixture("cerebras/completions.md")),
        },
      ],
    });
    return parseSource({ provider: provider(value), source: configured, body, observedAt });
  }

  it("retains structured capabilities without treating created=0 as a release", async () => {
    const model = (await parse("cerebras-models", "cerebras/normal.json"))[0];
    expect(model?.capabilities.reasoning).toBe(true);
    expect(model?.types).toEqual(["generate"]);
    expect(model?.capabilities.structured_output).toBe(false);
    expect(model?.status).toBe("preview");
    expect(model?.release_date).toBeUndefined();
  });

  it("normalizes published per-token rates", async () => {
    const model = (await parse("cerebras-models", "cerebras/pricing.json"))[0];
    expect(model?.release_date).toBeUndefined();
    expect({
      id: model?.model_id,
      input: model?.pricing.find((rate) => rate.meter === "input_text")?.price,
      output: model?.pricing.find((rate) => rate.meter === "output_text")?.price,
      pricing_status: model?.pricing_status,
    }).toEqual(await expected("cerebras/expected.json"));
  });

  it("parses model cards, scheduled lifecycle, and cached-input pricing", async () => {
    const models = await catalog();
    const glm = models.find(({ model_id }) => model_id === "zai-glm-4.7");
    const gpt = models.find(({ model_id }) => model_id === "gpt-oss-120b");
    const gemma = models.find(({ model_id }) => model_id === "gemma-4-31b");
    expect(glm).toMatchObject({
      name: "Z.ai GLM 4.7",
      status: "preview",
      is_deprecated: false,
      deprecated_at: "2026-08-17",
      limits: { context_tokens: 131000, max_output_tokens: 40000 },
    });
    expect(gpt?.pricing.find(({ meter }) => meter === "cache_read_text")).toMatchObject({
      price: "0.35",
      derived: true,
    });
    expect(gpt?.api_endpoints).toEqual([{ name: "Chat Completions", path: "v1/chat/completions" }]);
    expect(gemma?.api_endpoints).toEqual([
      { name: "Chat Completions", path: "v1/chat/completions" },
      { name: "Completions", path: "v1/completions" },
    ]);
  });

  it("rejects endpoint, pricing-unit, and API-reference drift", async () => {
    const chat = (await fixture("cerebras/chat-completions.md")).replace(
      "operationId: createChatCompletion",
      "operationId: renamedChatCompletion",
    );
    await expect(catalog({ chat })).rejects.toThrow(
      "Cerebras Chat Completions API reference drift",
    );
    const completions = (await fixture("cerebras/completions.md")).replace(
      "v1/completions",
      "v1/renamed",
    );
    await expect(catalog({ completions })).rejects.toThrow(
      "Cerebras Completions API reference drift",
    );
    const get = (await fixture("cerebras/completions.md")).replace("curl -X POST", "curl -X GET");
    await expect(catalog({ completions: get })).rejects.toThrow(
      "Cerebras Completions API reference drift",
    );
    const gpt = (await fixture("cerebras/gpt.md")).replace('"Chat Completions"', '"Responses"');
    await expect(catalog({ gpt })).rejects.toThrow(
      "Unsupported Cerebras model endpoint: Responses",
    );
    const wrongUnit = (await fixture("cerebras/gpt.md")).replace("/ M tokens", "/ requests");
    await expect(catalog({ gpt: wrongUnit })).rejects.toThrow(
      "Invalid Cerebras model card inputPrice",
    );
    const missingUnit = (await fixture("cerebras/gemma.md")).replace(
      "per million tokens",
      "per request",
    );
    await expect(catalog({ gemma: missingUnit })).rejects.toThrow(
      "Invalid Cerebras model card inputPrice",
    );
  });

  it("parses model deprecations but ignores parameter deprecations", async () => {
    const models = await parse("cerebras-lifecycle", "cerebras/lifecycle.md");
    expect(models.map(({ model_id }) => model_id)).toEqual([
      "llama-3.3-70b",
      "llama3.1-70b",
      "qwen-3-32b",
    ]);
    expect(models.find(({ model_id }) => model_id === "llama3.1-70b")).toMatchObject({
      deprecated_at: "2025-01-17",
      replacement_model_ids: ["llama-3.3-70b"],
    });
    expect(models.every(({ api_endpoints }) => api_endpoints === undefined)).toBe(true);
  });

  it("uses the first exact availability entry as release date", async () => {
    const models = await parse("cerebras-releases", "cerebras/releases.md");
    expect(models.find(({ model_id }) => model_id === "gpt-oss-120b")?.release_date).toBe(
      "2025-08-05",
    );
    expect(models.find(({ model_id }) => model_id === "llama-3.3-70b")?.release_date).toBe(
      "2024-12-10",
    );
  });

  it("retains every source that finds an exact model", async () => {
    const publicModels = await parse("cerebras-models", "cerebras/public.json");
    const releaseModels = await parse("cerebras-releases", "cerebras/releases.md");
    const apiModels = await parse("cerebras-api", "cerebras/api.json");
    const catalogs = [
      { source: source("cerebras-catalog"), models: await catalog() },
      { source: source("cerebras-models"), models: publicModels },
    ];
    const merged = applyGroups(
      applyGroups(
        applyGroups([], catalogs, true),
        [{ source: source("cerebras-releases"), models: releaseModels }],
        false,
      ),
      [{ source: source("cerebras-api"), models: apiModels }],
      false,
    );
    expect(merged.find(({ model_id }) => model_id === "gpt-oss-120b")?.source_refs).toEqual([
      "cerebras-catalog",
      "cerebras-models",
      "cerebras-releases",
      "cerebras-api",
    ]);
    expect(
      merged
        .find(({ model_id }) => model_id === "gpt-oss-120b")
        ?.pricing.map(({ meter, source_ref }) => [meter, source_ref]),
    ).toEqual([
      ["cache_read_text", "cerebras-catalog"],
      ["input_text", "cerebras-models"],
      ["output_text", "cerebras-models"],
    ]);
  });

  it("rejects an empty catalog", async () => {
    await expect(parse("cerebras-models", "cerebras/broken.json")).rejects.toThrow("schema drift");
  });
});

describe("Hugging Face adapter", () => {
  it("uses only Hugging Face-operated listings as catalog sources", () => {
    const sources = manifest("huggingface").sources;
    expect(sources.map(({ id, role }) => ({ id, role }))).toEqual([
      { id: "huggingface-hf-inference", role: "catalog" },
      { id: "huggingface-router", role: "catalog" },
    ]);
  });

  it("parses every concrete mapping and unions non-exclusive tasks", async () => {
    const models = await huggingFaceMapping("huggingface/normal.json");
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
    expect(multi?.routes).toEqual([
      {
        source_ref: "huggingface-hf-inference",
        provider: "hf-inference",
        provider_model_id: "upstream/future",
        task: "future-task",
        status: "live",
      },
      {
        source_ref: "huggingface-hf-inference",
        provider: "hf-inference",
        provider_model_id: "upstream/video",
        task: "image-to-video",
        status: "live",
      },
      {
        source_ref: "huggingface-hf-inference",
        provider: "hf-inference",
        provider_model_id: "upstream/image",
        task: "text-to-image",
        status: "live",
      },
    ]);
  });

  it("validates dynamic LoRA filters without publishing them", async () => {
    const value = manifest("huggingface");
    const source = huggingFaceMappingSource(value);
    const body = await fixture("huggingface/normal.json");
    for (const invalid of [
      body.replace('"adapterType": "lora"', '"adapterType": "future"'),
      body.replace(
        '"tags": ["base_model:adapter:org/base", "lora"]',
        '"tags": ["base_model:adapter:org/other", "lora"]',
      ),
    ])
      expect(() =>
        parseSource({ provider: provider(value), source, body: invalid, observedAt }),
      ).toThrow();
  });

  it("does not publish credential-like route identifiers", async () => {
    const credentialLikeId = `org/${["hf_", "a".repeat(40)].join("")}`;
    const value = manifest("huggingface");
    const source = huggingFaceMappingSource(value);
    for (const { from, hidden } of [
      { from: '"org/model-1"', hidden: credentialLikeId },
      { from: '"upstream/model-1"', hidden: credentialLikeId },
    ]) {
      const body = (await fixture("huggingface/normal.json")).replace(from, JSON.stringify(hidden));
      expect(
        parseSource({ provider: provider(value), source, body, observedAt }).some(
          (model) => model.model_id === "org/model-1" || model.model_id === credentialLikeId,
        ),
      ).toBe(false);
    }
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
      model?.pricing.some((rate) => rate.conditions.route_provider === "unavailable-route"),
    ).toBe(false);
    expect(models.some((item) => item.model_id === "org/unavailable-model")).toBe(false);
    expect(
      free?.pricing.map((rate) => [rate.meter, rate.price, rate.conditions.promotion]),
    ).toEqual([
      ["input_text", "0", true],
      ["output_text", "0", true],
    ]);
  });

  it("combines the HF Inference and router catalogs", async () => {
    const value = manifest("huggingface");
    const inference = huggingFaceMappingSource(value);
    const router = huggingFaceRouterSource(value);
    const body = await fixture("huggingface/normal.json");
    const routeBody = await fixture("huggingface/pricing.json");
    const mappings = parseSource({
      provider: provider(value),
      source: inference,
      body,
      observedAt,
    });
    const routed = parseSource({
      provider: provider(value),
      source: router,
      body: routeBody,
      observedAt,
    });
    const models = applyGroups(
      [],
      [
        { source: inference, models: mappings },
        { source: router, models: routed },
      ],
      true,
    );
    expect(models.find((model) => model.model_id === "org/model-1")?.source_refs).toEqual([
      "huggingface-hf-inference",
      "huggingface-router",
    ]);
    expect(models.find((model) => model.model_id === "org/model-1")?.routes).toEqual([
      {
        source_ref: "huggingface-hf-inference",
        provider: "hf-inference",
        provider_model_id: "upstream/model-1",
        task: "conversational",
        status: "live",
      },
    ]);
  });

  it("rejects malformed mappings, undocumented route states, and contradictory free prices", async () => {
    await expect(huggingFaceMapping("huggingface/broken.json")).rejects.toThrow(
      "Expected a Hugging Face repository ID",
    );
    await expect(huggingFaceRouter("huggingface/broken-router.json")).rejects.toThrow();
    const value = manifest("huggingface");
    const source = huggingFaceRouterSource(value);
    const body = (await fixture("huggingface/pricing.json")).replace(
      '"pricing": { "input": 0, "output": "0.0" }',
      '"pricing": { "input": 1, "output": "0.0" }',
    );
    expect(() => parseSource({ provider: provider(value), source, body, observedAt })).toThrow(
      "both free and priced",
    );
  });
});

describe("DeepSeek adapters", () => {
  function source(id: string): SourceManifest {
    const configured = manifest("deepseek").sources.find((item) => item.id === id);
    if (configured === undefined) throw new Error(`Missing DeepSeek source ${id}`);
    return configured;
  }

  it("reads the current callable catalog without a product-name allowlist", async () => {
    expect(source("deepseek-catalog")).toMatchObject({
      fields: expect.arrayContaining(["api_endpoints"]),
      linkedDocuments: {
        minDocuments: 0,
        maxDocuments: 0,
        documents: [
          {
            id: "chat-completions",
            url: "https://api-docs.deepseek.com/api/create-chat-completion",
          },
        ],
      },
    });
    const models = await deepseekCatalog();
    expect(models.map(({ model_id }) => model_id)).toEqual([
      "deepseek-chat",
      "deepseek-reasoner",
      "deepseek-v4-flash",
      "deepseek-v4-pro",
    ]);
    expect(models.find(({ model_id }) => model_id === "deepseek-v4-pro")).toMatchObject({
      name: "DeepSeek-V4-Pro",
      types: ["generate"],
      api_endpoints: [{ name: "Chat Completions", path: "/chat/completions" }],
      modalities: { input: ["text"], output: ["text"] },
      capabilities: {
        reasoning: true,
        tool_call: true,
        structured_output: true,
        streaming: true,
        prompt_cache: true,
      },
      limits: { context_tokens: 1_000_000, max_output_tokens: 384_000 },
      pricing_status: "published",
      pricing: [
        expect.objectContaining({ meter: "cache_read_text", price: "0.003625" }),
        expect.objectContaining({ meter: "input_text", price: "0.435" }),
        expect.objectContaining({ meter: "output_text", price: "0.87" }),
      ],
    });
    expect(models.find(({ model_id }) => model_id === "deepseek-chat")).toMatchObject({
      api_endpoints: [{ name: "Chat Completions", path: "/chat/completions" }],
      capabilities: { reasoning: false, streaming: true },
      deprecated_at: "2026-07-24T15:59:00Z",
      retired_at: "2026-07-24T15:59:00Z",
      status: "active",
      is_deprecated: false,
      replacement_model_ids: ["deepseek-v4-flash"],
      pricing: [
        expect.objectContaining({ meter: "cache_read_text", price: "0.0028" }),
        expect.objectContaining({ meter: "input_text", price: "0.14" }),
        expect.objectContaining({ meter: "output_text", price: "0.28" }),
      ],
    });
  });

  it("rejects changed Chat Completions operation and model evidence", async () => {
    const chat = await fixture("deepseek/chat.html");
    await expect(deepseekCatalog(chat.replace("/chat/completions", "/responses"))).rejects.toThrow(
      "changed operation",
    );
    await expect(
      deepseekCatalog(chat.replace("deepseek-v4-flash", "deepseek-v4-unknown")),
    ).rejects.toThrow("named unknown catalog model");
    await expect(
      deepseekCatalog(
        chat.replace("partial message deltas will be sent", "streaming is supported"),
      ),
    ).rejects.toThrow("changed streaming schema");
  });

  it("uses exact change-log evidence for release and update dates", async () => {
    const models = await parsed("deepseek", "deepseek/updates.html", "deepseek-updates");
    const flash = models.find(({ model_id }) => model_id === "deepseek-v4-flash");
    expect(flash).toMatchObject({ release_date: "2026-04-24" });
    expect(flash).not.toHaveProperty("updated_date");
    expect(models.find(({ model_id }) => model_id === "deepseek-reasoner")).toMatchObject({
      release_date: "2025-01-20",
      updated_date: "2026-04-24",
    });
    expect(models.find(({ model_id }) => model_id === "deepseek-chat")).toMatchObject({
      updated_date: "2026-04-24",
    });
  });

  it("retains catalog, change-log, and authenticated API observations", async () => {
    const catalogSource = source("deepseek-catalog");
    const updateSource = source("deepseek-updates");
    const apiSource = source("deepseek-api");
    const catalog = await deepseekCatalog();
    const updates = await parsed("deepseek", "deepseek/updates.html", updateSource.id);
    const inventory = await parsed("deepseek", "deepseek/api.json", apiSource.id);
    const models = applyGroups(
      applyGroups(
        applyGroups([], [{ source: catalogSource, models: catalog }], true),
        [{ source: updateSource, models: updates }],
        false,
      ),
      [{ source: apiSource, models: inventory }],
      false,
    );
    expect(models.find(({ model_id }) => model_id === "deepseek-v4-flash")?.source_refs).toEqual([
      "deepseek-catalog",
      "deepseek-updates",
      "deepseek-api",
    ]);
    expect(models.find(({ model_id }) => model_id === "deepseek-chat")?.source_refs).toEqual([
      "deepseek-catalog",
      "deepseek-updates",
    ]);
  });
});

describe("DashScope adapters", () => {
  function source(id: string, minModels = 1, maxModels = 20): SourceManifest {
    const configured = manifest("dashscope").sources.find((item) => item.id === id);
    if (configured === undefined) throw new Error(`Missing DashScope source ${id}`);
    if (
      configured.extractor.kind === "dashscope-catalog" ||
      configured.extractor.kind === "dashscope-pricing" ||
      configured.extractor.kind === "dashscope-recommended" ||
      configured.extractor.kind === "dashscope-lifecycle" ||
      configured.extractor.kind === "dashscope-api"
    )
      return {
        ...configured,
        extractor: { ...configured.extractor, minModels, maxModels },
      };
    throw new Error(`Wrong DashScope source ${id}`);
  }

  function parse(sourceManifest: SourceManifest, body: string): ProviderModel[] {
    const value = manifest("dashscope");
    return parseSource({
      provider: provider(value),
      source: sourceManifest,
      body,
      observedAt,
    });
  }

  it("reads exact labeled IDs without a product-prefix allowlist", async () => {
    const models = parse(source("dashscope-text"), await fixture("dashscope/catalog.html"));
    expect(models.map(({ model_id, types, limits }) => ({ model_id, types, limits }))).toEqual([
      {
        model_id: "MiniMax-M2.5",
        types: ["generate"],
        limits: { context_tokens: 204_000 },
      },
      {
        model_id: "qwen3.7-plus",
        types: ["generate"],
        limits: { context_tokens: 1_000_000 },
      },
      {
        model_id: "qwen3.7-plus-2026-05-26",
        types: ["generate"],
        limits: { context_tokens: 1_000_000 },
      },
    ]);

    const embedding = parse(
      source("dashscope-embedding"),
      await fixture("dashscope/embedding.html"),
    );
    expect(embedding.map(({ model_id, types, limits }) => ({ model_id, types, limits }))).toEqual([
      {
        model_id: "qwen3-vl-rerank",
        types: ["rerank"],
        limits: { max_input_tokens: 8_000 },
      },
      {
        model_id: "text-embedding-v4",
        types: ["embeddings"],
        limits: {
          embedding_dimension_range: { min: 64, max: 2048 },
          max_input_tokens: 8_192,
          recommended_embedding_dimensions: [1024],
        },
      },
    ]);
  });

  it("overlays only exact recommended-model regions and request URLs", async () => {
    const models = parse(
      source("dashscope-recommended"),
      await fixture("dashscope/recommended.html"),
    );
    expect(
      models.map(({ model_id, api_endpoints, availability }) => ({
        model_id,
        api_endpoints,
        availability,
      })),
    ).toEqual([
      {
        model_id: "qwen-image-2.0-pro",
        api_endpoints: [
          {
            name: "Multimodal Generation",
            path: "/api/v1/services/aigc/multimodal-generation/generation",
          },
        ],
        availability: [{ region: "International", deployment_type: "model_api" }],
      },
      {
        model_id: "qwen3.7-plus",
        api_endpoints: undefined,
        availability: [
          { region: "China (Beijing)", deployment_type: "model_api" },
          { region: "Singapore", deployment_type: "model_api" },
        ],
      },
      {
        model_id: "text-embedding-v4",
        api_endpoints: [{ name: "Embeddings", path: "/compatible-mode/v1/embeddings" }],
        availability: [{ region: "International", deployment_type: "model_api" }],
      },
    ]);
  });

  it("rejects an unreviewed recommended-model endpoint", async () => {
    const body = (await fixture("dashscope/recommended.html")).replace(
      "/compatible-mode/v1/embeddings",
      "/compatible-mode/v1/unknown",
    );
    expect(() => parse(source("dashscope-recommended"), body)).toThrow(
      "Unsupported DashScope recommended-model endpoint",
    );
  });

  it("retains tier, promotion, batch, and explicit and implicit cache prices", async () => {
    const pricingSource = source("dashscope-pricing");
    const models = parse(
      pricingSource,
      JSON.stringify({
        index: {
          url: pricingSource.url,
          body: await fixture("dashscope/pricing.html"),
        },
        documents: [
          {
            url: "https://www.alibabacloud.com/help/en/model-studio/context-cache",
            body: await fixture("dashscope/cache.html"),
          },
        ],
      }),
    );
    const model = models.find(({ model_id }) => model_id === "qwen3.7-plus");
    expect(model?.aliases).toEqual(["qwen3.7-plus-2026-05-26"]);
    expect(
      model?.pricing.map(({ meter, price, conditions }) => ({ meter, price, conditions })),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ meter: "input_text", price: "0.4" }),
        expect.objectContaining({
          meter: "input_text",
          price: "0.32",
          conditions: expect.objectContaining({ promotion: true }),
        }),
        expect.objectContaining({
          meter: "input_text",
          price: "0.2",
          conditions: expect.objectContaining({ service_tier: "batch" }),
        }),
        expect.objectContaining({ meter: "cache_write_text", price: "0.5" }),
        expect.objectContaining({
          meter: "cache_read_text",
          price: "0.04",
          conditions: expect.objectContaining({ operation: "explicit_cache" }),
        }),
        expect.objectContaining({
          meter: "cache_read_text",
          price: "0.08",
          conditions: expect.objectContaining({ operation: "implicit_cache" }),
        }),
      ]),
    );
  });

  it("keeps every source that observes the same exact model", async () => {
    const catalogSource = source("dashscope-text");
    const pricingSource = source("dashscope-pricing");
    const recommendedSource = source("dashscope-recommended");
    const lifecycleSource = source("dashscope-lifecycle");
    const apiSource = source("dashscope-deployable-api");
    const catalog = parse(catalogSource, await fixture("dashscope/catalog.html"));
    const pricing = parse(
      pricingSource,
      JSON.stringify({
        index: {
          url: pricingSource.url,
          body: await fixture("dashscope/pricing.html"),
        },
        documents: [
          {
            url: "https://www.alibabacloud.com/help/en/model-studio/context-cache",
            body: await fixture("dashscope/cache.html"),
          },
        ],
      }),
    );
    const recommended = parse(recommendedSource, await fixture("dashscope/recommended.html"));
    const lifecycle = parse(lifecycleSource, await fixture("dashscope/lifecycle.html"));
    const inventory = parse(apiSource, await fixture("dashscope/api.json"));
    const models = applyGroups(
      applyGroups(
        applyGroups(
          [],
          [
            { source: catalogSource, models: catalog },
            { source: pricingSource, models: pricing },
            { source: lifecycleSource, models: lifecycle },
          ],
          true,
        ),
        [{ source: recommendedSource, models: recommended }],
        false,
      ),
      [{ source: apiSource, models: inventory }],
      false,
    );
    expect(models.find(({ model_id }) => model_id === "qwen3.7-plus")).toMatchObject({
      status: "deprecated",
      is_deprecated: true,
      retired_at: "2026-10-10",
      replacement_model_ids: ["qwen3.8-plus"],
      source_refs: [
        "dashscope-text",
        "dashscope-pricing",
        "dashscope-lifecycle",
        "dashscope-recommended",
        "dashscope-deployable-api",
      ],
      availability: [
        { region: "China (Beijing)", deployment_type: "model_api" },
        { region: "Singapore", deployment_type: "model_api" },
        { region: "Singapore", deployment_type: "mu" },
        { region: "Singapore", deployment_type: "ptu_v2" },
      ],
    });
  });

  it("fails a truncated authenticated deployment page", async () => {
    const body: unknown = JSON.parse(await fixture("dashscope/api.json"));
    const parsed = z
      .object({ output: z.object({ total: z.number() }).passthrough() })
      .passthrough()
      .parse(body);
    parsed.output.total = 101;
    expect(() => parse(source("dashscope-deployable-api"), JSON.stringify(parsed))).toThrow(
      "pagination is incomplete",
    );
  });
});

describe("Kimi adapters", () => {
  const value = manifest("kimi");
  const source = (id: string): SourceManifest => {
    const result = value.sources.find((candidate) => candidate.id === id);
    if (result === undefined) throw new Error(`Missing Kimi source ${id}`);
    return result;
  };
  const parse = (configured: SourceManifest, body: string): ProviderModel[] =>
    parseSource({ provider: provider(value), source: configured, body, observedAt });

  it("uses the documented international API origin", () => {
    expect(source("kimi-api")).toMatchObject({
      url: "https://api.moonshot.ai/v1/models",
      allowedHosts: ["api.moonshot.ai"],
    });
  });

  it("keeps omitted inventory capabilities as unknown", async () => {
    const models = await parsed("kimi", "kimi/api.json", "kimi-api");
    expect(models.find(({ model_id }) => model_id === "kimi-k2.6")).toMatchObject({
      modalities: { input: ["text"], output: ["text"] },
      capabilities: { reasoning: "unknown" },
    });
  });

  async function pricing(): Promise<ProviderModel[]> {
    const configured = source("kimi-pricing");
    const documents = [
      ["https://platform.kimi.com/docs/pricing/chat-k27-code", "pricing-k27.md"],
      ["https://platform.kimi.com/docs/pricing/chat-k26", "pricing-k26.md"],
      ["https://platform.kimi.com/docs/pricing/chat-k25", "pricing-k25.md"],
      ["https://platform.kimi.com/docs/pricing/chat-v1", "pricing-v1.md"],
      ["https://platform.kimi.com/docs/pricing/batch", "pricing-batch.md"],
      ["https://platform.kimi.com/docs/guide/use-context-caching-feature-of-kimi-api", "cache.md"],
    ];
    return parse(
      configured,
      JSON.stringify({
        index: { url: configured.url, body: await fixture("kimi/pricing-k3.md") },
        documents: await Promise.all(
          documents.map(async ([url, path]) => ({
            url,
            body: await fixture(`kimi/${path}`),
          })),
        ),
      }),
    );
  }

  async function releases(): Promise<ProviderModel[]> {
    const configured = source("kimi-releases");
    return parse(
      configured,
      JSON.stringify({
        index: { url: configured.url, body: await fixture("kimi/changelog.html") },
        documents: [
          { url: "https://www.kimi.com/blog/", body: await fixture("kimi/blog.html") },
          {
            url: "https://www.kimi.com/code/docs/en/kimi-code/whats-new.html",
            body: await fixture("kimi/code.html"),
          },
        ],
      }),
    );
  }

  it("uses exact OpenAPI model enums without a product-prefix rule", async () => {
    const body = await fixture("kimi/openapi.json");
    const models = parse(source("kimi-openapi"), body);
    expect(models).toHaveLength(12);
    expect(models.find(({ model_id }) => model_id === "moonshot-v1-auto")).toMatchObject({
      types: ["generate"],
      modalities: { input: ["text"], output: ["text"] },
      api_endpoints: [{ name: "Chat Completions", path: "/v1/chat/completions" }],
      capabilities: {
        tool_call: true,
        structured_output: true,
        streaming: true,
        prompt_cache: true,
      },
    });
    expect(models.find(({ model_id }) => model_id === "kimi-k3")?.capabilities).toMatchObject({
      reasoning: true,
      effort_control: true,
    });
    expect(() =>
      parse(source("kimi-openapi"), body.replace('"kimi-k3"]', '"kimi-k3", "ghost-model"]')),
    ).toThrow("mapping disagrees");
    expect(() =>
      parse(source("kimi-openapi"), body.replace("/v1/chat/completions", "/v1/responses")),
    ).toThrow();
  });

  it("retains callable and retired IDs only from labeled catalog fields", async () => {
    const models = await parsed("kimi", "kimi/models.md", "kimi-catalog");
    expect(models).toHaveLength(18);
    expect(models.find(({ model_id }) => model_id === "kimi-k3")).toMatchObject({
      limits: { context_tokens: 1_000_000 },
      modalities: { input: ["text", "image"], output: ["text"] },
    });
    expect(models.find(({ model_id }) => model_id === "kimi-k2.5")).toMatchObject({
      status: "deprecated",
      is_deprecated: true,
    });
    expect(models.find(({ model_id }) => model_id === "kimi-thinking-preview")).toMatchObject({
      status: "retired",
      retired_at: "2025-11-11",
      replacement_model_ids: ["kimi-k3"],
    });
  });

  it("keeps CNY standard, cached-input, and Batch rates", async () => {
    const models = await pricing();
    expect(models).toHaveLength(11);
    expect(models.find(({ model_id }) => model_id === "kimi-k2.7-code-highspeed")).toMatchObject({
      name: "Kimi K2.7 Code HighSpeed",
      modalities: { input: ["text", "image", "video"], output: ["text"] },
      limits: { context_tokens: 262_144 },
    });
    const k26 = models.find(({ model_id }) => model_id === "kimi-k2.6");
    expect(k26?.capabilities).toMatchObject({ reasoning: true, batch: true, prompt_cache: true });
    expect(k26?.pricing).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          meter: "cache_read_text",
          price: "1.10",
          currency: "CNY",
          conditions: {},
        }),
        expect.objectContaining({
          meter: "input_text",
          price: "3.90",
          currency: "CNY",
          conditions: { service_tier: "batch" },
        }),
      ]),
    );
  });

  it("joins only reviewed official display identities to release dates", async () => {
    const models = await releases();
    expect(models.find(({ model_id }) => model_id === "kimi-k3")?.release_date).toBe("2026-07-16");
    expect(models.find(({ model_id }) => model_id === "kimi-k2.7-code")?.release_date).toBe(
      "2026-06-12",
    );
    expect(models.find(({ model_id }) => model_id === "moonshot-v1-auto")?.release_date).toBe(
      "2024-08-28",
    );
  });

  it("retains every successful source that finds the same model", async () => {
    const catalogSources = [source("kimi-openapi"), source("kimi-catalog"), source("kimi-pricing")];
    const catalogs = [
      parse(catalogSources[0] ?? source("kimi-openapi"), await fixture("kimi/openapi.json")),
      await parsed("kimi", "kimi/models.md", "kimi-catalog"),
      await pricing(),
    ];
    const publicModels = applyGroups(
      [],
      catalogSources.map((configured, index) => ({
        source: configured,
        models: catalogs[index] ?? [],
      })),
      true,
    );
    const models = applyGroups(
      applyGroups(
        publicModels,
        [{ source: source("kimi-releases"), models: await releases() }],
        false,
      ),
      [
        {
          source: source("kimi-api"),
          models: await parsed("kimi", "kimi/api.json", "kimi-api"),
        },
      ],
      false,
    );
    expect(models.find(({ model_id }) => model_id === "kimi-k3")?.source_refs).toEqual([
      "kimi-openapi",
      "kimi-catalog",
      "kimi-pricing",
      "kimi-releases",
      "kimi-api",
    ]);
  });

  it("fails malformed authenticated capability data atomically", async () => {
    const body = await fixture("kimi/api.json");
    expect(() =>
      parse(
        source("kimi-api"),
        body.replace('"context_length": 1048576', '"context_length": "1048576"'),
      ),
    ).toThrow();
  });
});

describe("Ollama adapters", () => {
  it("parses exact curated library IDs and family metadata", async () => {
    const models = await ollamaLibrary();
    expect(models.map(({ model_id }) => model_id)).toEqual([
      "gemma4",
      "glm-ocr",
      "kimi-k2.5",
      "nomic-embed-text",
    ]);
    expect(models.find(({ model_id }) => model_id === "gemma4")).toMatchObject({
      types: ["generate"],
      service_families: ["Ollama Library"],
      modalities: { input: ["text", "image", "audio"], output: ["text"] },
      capabilities: { reasoning: true, tool_call: true },
      updated_date: "2026-06-30",
      pricing_status: "not_applicable",
    });
    expect(models.find(({ model_id }) => model_id === "nomic-embed-text")).toMatchObject({
      types: ["embeddings"],
      modalities: { input: ["text"], output: ["embedding"] },
    });
    expect(models.find(({ model_id }) => model_id === "glm-ocr")?.types).toEqual([
      "generate",
      "ocr",
    ]);
  });

  it("combines Cloud details without flattening channel lifecycle", async () => {
    const models = await ollamaCloud();
    expect(models.find(({ model_id }) => model_id === "gpt-oss:120b")).toMatchObject({
      service_families: ["Ollama Cloud"],
      modalities: { input: ["text"], output: ["text"] },
      capabilities: { reasoning: true, tool_call: true, streaming: true },
      limits: { context_tokens: 131072 },
      updated_date: "2025-08-05",
      pricing_status: "not_published",
      source_refs: ["ollama-cloud-models"],
    });
    expect(models.find(({ model_id }) => model_id === "kimi-k2.5")).toMatchObject({
      service_families: ["Ollama Cloud", "Ollama Library"],
      status: "active",
      is_deprecated: "unknown",
      modalities: { input: ["text", "image"], output: ["text"] },
    });
    expect(models.find(({ model_id }) => model_id === "gemini-3-flash-preview")).toMatchObject({
      service_families: ["Ollama Cloud", "Ollama Library"],
      status: "active",
      is_deprecated: "unknown",
      description: "A fast multimodal model.",
    });
    expect(models.find(({ model_id }) => model_id === "kimi-k2.5")?.retired_at).toBeUndefined();
    expect(
      models.find(({ model_id }) => model_id === "gemini-3-flash-preview")?.retired_at,
    ).toBeUndefined();
  });

  it("retains every catalog that finds the same exact model", async () => {
    const value = manifest("ollama");
    const library = ollamaSource("ollama-library");
    const cloud = ollamaSource("ollama-cloud");
    const models = applyGroups(
      [],
      [
        { source: library, models: await ollamaLibrary() },
        { source: cloud, models: await ollamaCloud() },
      ],
      true,
    );
    expect(models.find(({ model_id }) => model_id === "kimi-k2.5")?.source_refs).toEqual([
      "ollama-library",
      "ollama-cloud-models",
    ]);
    expect(models.find(({ model_id }) => model_id === "kimi-k2.5")).toMatchObject({
      service_families: ["Ollama Cloud", "Ollama Library"],
      status: "active",
      is_deprecated: "unknown",
    });
    expect(provider(value).source_ids).toEqual(["ollama-library", "ollama-cloud-models"]);
  });

  it("publishes lifecycle only without current Library-family evidence", async () => {
    const value = manifest("ollama");
    const source = ollamaSource("ollama-cloud");
    const body = (await ollamaCloudBody()).replace(
      'href=\\"/library/kimi-k2.5\\"',
      'href=\\"/not-a-library-model\\"',
    );
    const models = parseSource({ provider: provider(value), source, body, observedAt });
    expect(models.find(({ model_id }) => model_id === "kimi-k2.5")).toMatchObject({
      service_families: ["Ollama Cloud"],
      status: "deprecated",
      is_deprecated: true,
      retired_at: "2026-07-31",
    });
  });

  it("canonicalizes nonsemantic Cloud transport variation", () => {
    expect(
      normalizeOllamaResponse(
        410,
        '{"error":"model was retired at 2026-07-15 00:00:00 -0700 PDT (ref: 4276b407-3c87-4cb0-8d79-f8198cdd8e75)"}',
      ),
    ).toEqual({ error: "model was retired at 2026-07-15 00:00:00 -0700 PDT" });
    expect(
      normalizeOllamaList(
        '{"models":[{"model":"z-model","name":"z-model"},{"model":"a-model","name":"a-model"}]}',
      ),
    ).toBe(
      '{"models":[{"model":"a-model","name":"a-model"},{"model":"z-model","name":"z-model"}]}',
    );
    expect(() =>
      normalizeOllamaResponse(
        410,
        '{"error":"model was retired at 2026-07-15 00:00:00 -0700 PDT"}',
      ),
    ).toThrow("omitted its request reference");
  });

  it("rejects list/detail and catalog drift atomically", async () => {
    const value = manifest("ollama");
    const source = ollamaSource("ollama-cloud");
    const body = await ollamaCloudBody();
    const parse = (candidate: string): ProviderModel[] =>
      parseSource({ provider: provider(value), source, body: candidate, observedAt });
    expect(() =>
      parse(
        body.replace(
          '"modified_at":"2025-08-05T00:00:00Z"',
          '"modified_at":"2025-08-06T00:00:00Z"',
        ),
      ),
    ).toThrow("update time mismatch");
    expect(() => parse(body.replace('"completion"', '"unknown-capability"'))).toThrow();
    expect(() => parse(body.replace('"status":200', '"status":404'))).toThrow(
      "listed model was unavailable",
    );
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

  it("rejects duplicate or abruptly missing structured evidence", async () => {
    const model = (await huggingFaceMapping("huggingface/normal.json")).find(
      ({ model_id }) => model_id === "org/model-1",
    );
    const route = model?.routes?.[0];
    if (model === undefined || route === undefined) throw new Error("Missing routed fixture model");
    expect(validateProvider([{ ...model, routes: [route, route] }], []).reason).toContain(
      "duplicate route",
    );
    expect(
      validateProvider(
        [{ ...model, routes: [{ ...route, source_ref: "unreferenced-source" }] }],
        [],
      ).reason,
    ).toContain("route source is missing");
    expect(validateProvider([{ ...model, routes: [] }], [model]).reason).toContain(
      "route count dropped by more than 20%",
    );

    const bedrock = (await parsed("amazon-bedrock", "document/bedrock.json")).find(
      ({ model_id }) => model_id === "anthropic.claude-haiku-4-5-20251001-v1:0",
    );
    const endpoint = bedrock?.api_endpoints?.[0];
    const availability = bedrock?.availability?.[0];
    if (bedrock === undefined || endpoint === undefined || availability === undefined)
      throw new Error("Missing Bedrock route evidence");
    expect(
      validateProvider([{ ...bedrock, api_endpoints: [endpoint, endpoint] }], []).reason,
    ).toContain("duplicate API endpoint");
    expect(
      validateProvider([{ ...bedrock, availability: [availability, availability] }], []).reason,
    ).toContain("duplicate availability");
    expect(validateProvider([{ ...bedrock, api_endpoints: [] }], [bedrock]).reason).toContain(
      "API endpoint count dropped by more than 20%",
    );
    expect(validateProvider([{ ...bedrock, availability: [] }], [bedrock]).reason).toContain(
      "availability count dropped by more than 20%",
    );

    const azure = (await azureCatalog()).find(
      ({ model_id }) => model_id === "Cohere-embed-v3-english",
    );
    const family = azure?.service_families?.[0];
    if (azure === undefined || family === undefined)
      throw new Error("Missing Azure service-family evidence");
    expect(
      validateProvider([{ ...azure, service_families: [family, family] }], []).reason,
    ).toContain("duplicate service family");
    expect(validateProvider([{ ...azure, service_families: undefined }], [azure]).reason).toContain(
      "service-family count dropped by more than 20%",
    );
  });
});
