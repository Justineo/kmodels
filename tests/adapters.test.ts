import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import {
  classifyModelTasks,
  modelStateFromLabel,
  multiplyDecimal,
  normalizeModelReleaseStage,
  parseSource,
  scaleDecimal,
} from "../src/catalog/adapters.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";
import { decimalsEqual, publishedRate } from "../src/catalog/pricing.ts";
import {
  curlResponse,
  linkedDocumentUrls,
  normalizeOllamaList,
  normalizeOllamaResponse,
} from "../src/catalog/fetch.ts";
import { applyGroups } from "../src/catalog/collector.ts";
import { manifests, type ProviderManifest, type SourceManifest } from "../src/catalog/manifests.ts";
import { baseModel } from "../src/catalog/model.ts";
import type { ParsedProviderModel as ProviderModel } from "../src/catalog/pricing-source.ts";
import { sourceKindSchema, type Provider } from "../src/catalog/schema.ts";
import { reconcileCatalog, validateProvider } from "../src/catalog/validation.ts";

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

function azurePricingModel(id: string, version?: string): ProviderModel {
  return {
    ...baseModel({
      providerId: "azure",
      id,
      ...(version === undefined ? {} : { version }),
      name: id,
      sourceId: "azure-models",
      observedAt,
    }),
    service_families: ["Azure OpenAI"],
  };
}

function azureRetailSource(
  minModels: number,
  maxModels: number,
  minHandledRatio: number,
): SourceManifest {
  const configured = manifest("azure").sources.find(({ id }) => id === "azure-retail-prices");
  if (configured === undefined || configured.extractor.kind !== "azure-retail-prices")
    throw new Error("Missing Azure retail-price source");
  return {
    ...configured,
    extractor: { kind: "azure-retail-prices", minModels, maxModels, minHandledRatio },
  };
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

async function deepseekCatalog(
  chat?: string,
  catalog?: string,
  responses?: string,
): Promise<ProviderModel[]> {
  const value = manifest("deepseek");
  const source = value.sources.find(({ id }) => id === "deepseek-catalog");
  if (source === undefined) throw new Error("Missing DeepSeek catalog source");
  const body = JSON.stringify({
    index: { url: source.url, body: catalog ?? (await fixture("deepseek/catalog.html")) },
    documents: [
      {
        url: "https://api-docs.deepseek.com/api/create-chat-completion",
        body: chat ?? (await fixture("deepseek/chat.html")),
      },
      {
        url: "https://api-docs.deepseek.com/api/create-response",
        body: responses ?? (await fixture("deepseek/responses.html")),
      },
    ],
  });
  return parseSource({ provider: provider(value), source, body, observedAt });
}

async function anthropicCatalog(
  messagesBody?: string,
  batchGuideBody?: string,
  lifecycleBody?: string,
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
        body: lifecycleBody ?? (await fixture("anthropic/lifecycle.md")),
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
      {
        url: "https://platform.claude.com/docs/en/build-with-claude/citations.md",
        body: await fixture("anthropic/citations.md"),
      },
      {
        url: "https://platform.claude.com/docs/en/build-with-claude/pdf-support.md",
        body: await fixture("anthropic/pdf-support.md"),
      },
      {
        url: "https://platform.claude.com/docs/en/build-with-claude/context-editing.md",
        body: await fixture("anthropic/context-editing.md"),
      },
      {
        url: "https://platform.claude.com/docs/en/build-with-claude/structured-outputs.md",
        body: await fixture("anthropic/structured-outputs.md"),
      },
      {
        url: "https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool.md",
        body: await fixture("anthropic/code-execution-tool.md"),
      },
      {
        url: "https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool.md",
        body: await fixture("anthropic/computer-use-tool.md"),
      },
      {
        url: "https://platform.claude.com/docs/en/build-with-claude/effort.md",
        body: await fixture("anthropic/effort.md"),
      },
      {
        url: "https://platform.claude.com/docs/en/build-with-claude/prompt-caching.md",
        body: await fixture("anthropic/prompt-caching.md"),
      },
      {
        url: "https://platform.claude.com/docs/en/about-claude/glossary.md",
        body: await fixture("anthropic/glossary.md"),
      },
      {
        url: "https://platform.claude.com/docs/en/build-with-claude/thinking.md",
        body: await fixture("anthropic/thinking.md"),
      },
      {
        url: "https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use.md",
        body: await fixture("anthropic/implement-tool-use.md"),
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

async function vercelCatalog(
  path: string,
  edit: (body: string) => string = (body) => body,
): Promise<ProviderModel[]> {
  const value = manifest("vercel");
  const configured = value.sources[0];
  if (configured === undefined || configured.extractor.kind !== "vercel-catalog")
    throw new Error("Missing Vercel source");
  const source: SourceManifest = {
    ...configured,
    extractor: { kind: "vercel-catalog", minModels: 1, maxModels: 20 },
  };
  return parseSource({
    provider: provider(value),
    source,
    body: edit(await fixture(path)),
    observedAt,
  });
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
    extractor: { kind: "xai-catalog", minModels: 4, maxModels: 20 },
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

function huggingFaceHubSource(value: ProviderManifest): SourceManifest {
  const configured = value.sources.find((source) => source.id === "huggingface-hub");
  if (configured === undefined || configured.extractor.kind !== "huggingface-hub")
    throw new Error("Missing Hugging Face Hub source");
  return {
    ...configured,
    extractor: { kind: "huggingface-hub", minModels: 1, maxModels: 10 },
  };
}

async function huggingFaceMapping(path: string): Promise<ProviderModel[]> {
  const value = manifest("huggingface");
  const source = huggingFaceMappingSource(value);
  return parseSource({ provider: provider(value), source, body: await fixture(path), observedAt });
}

async function huggingFaceRouter(
  path: string,
  edit: (body: string) => string = (body) => body,
): Promise<ProviderModel[]> {
  const value = manifest("huggingface");
  const source = huggingFaceRouterSource(value);
  return parseSource({
    provider: provider(value),
    source,
    body: edit(await fixture(path)),
    observedAt,
  });
}

async function huggingFaceHub(
  edit: (body: string) => string = (body) => body,
): Promise<ProviderModel[]> {
  const value = manifest("huggingface");
  const source = huggingFaceHubSource(value);
  return parseSource({
    provider: provider(value),
    source,
    body: edit(await fixture("huggingface/hub.json")),
    observedAt,
  });
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
    ["concepts-retired-models-content.md", "retired.md"],
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
    ["https://ai.google.dev/gemini-api/docs/models/deep-research-test", "agent.html"],
    ["https://ai.google.dev/gemini-api/docs/robotics-overview", "robotics.html"],
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
  minPricingCoverage = 0,
  minModelDocuments = 0,
  index = "<main></main>",
): Promise<ProviderModel[]> {
  const value = manifest("vertex");
  const configured = value.sources[sourceIndex];
  if (configured === undefined || configured.extractor.kind !== "vertex-catalog")
    throw new Error("Missing Vertex source");
  const source: SourceManifest = {
    ...configured,
    extractor: {
      kind: "vertex-catalog",
      minModels: 1,
      maxModels: 5,
      minModelDocuments,
      maxModelDocuments: 5,
      minPricingCoverage,
    },
  };
  const referencedDocuments =
    sourceIndex === 2 &&
    !documents.some(
      ([url]) =>
        new URL(url).pathname ===
        "/gemini-enterprise-agent-platform/models/embeddings/get-text-embeddings",
    )
      ? [
          [
            "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/embeddings/get-text-embeddings",
            "text-embeddings.html",
          ] as const,
        ]
      : [];
  const body = JSON.stringify({
    index: { url: source.url, body: index },
    documents: await Promise.all(
      [...documents, ...referencedDocuments].map(async ([url, path]) => ({
        url,
        body: overrides[path] ?? (await fixture(`vertex/${path}`)),
      })),
    ),
  });
  return parseSource({ provider: provider(value), source, body, observedAt });
}

async function vertexCatalog(
  overrides: Readonly<Record<string, string>> = {},
  minPricingCoverage = 0,
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
        "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/embeddings/get-text-embeddings",
        "text-embeddings.html",
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
    minPricingCoverage,
  );
}

async function cohereCatalog(
  overrides: {
    chat?: string;
    commandAPlus?: string;
    index?: string;
    lifecycle?: string;
    modelIndex?: string;
    pricing?: string;
  } = {},
): Promise<ProviderModel[]> {
  const value = manifest("cohere");
  const configured = value.sources[0];
  if (
    configured === undefined ||
    configured.extractor.kind !== "cohere-catalog" ||
    configured.linkedDocuments === undefined
  )
    throw new Error("Missing Cohere source");
  const source: SourceManifest = {
    ...configured,
    extractor: {
      kind: "cohere-catalog",
      minModels: 40,
      maxModels: 50,
      minPricingCoverage: 0.3,
    },
    linkedDocuments: {
      ...configured.linkedDocuments,
      minDocuments: 5,
      maxDocuments: 6,
    },
  };
  const documents = [
    ["https://docs.cohere.com/docs/models", "index.html"],
    ["https://docs.cohere.com/docs/command-a-plus", "command-a-plus.html"],
    ["https://docs.cohere.com/docs/command-a", "command-a-broken.html"],
    ["https://docs.cohere.com/docs/transcribe", "transcribe.html"],
    ["https://docs.cohere.com/docs/transcribe-arabic", "transcribe-arabic.html"],
    ["https://docs.cohere.com/docs/north-mini-code-1.0", "north-mini-code.html"],
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
      body: overrides.modelIndex ?? (await fixture("cohere/model-index.md")),
    },
    documents: await Promise.all(
      documents.map(async ([url, path]) => ({
        url,
        body:
          url === "https://docs.cohere.com/reference/chat.md" && overrides.chat !== undefined
            ? overrides.chat
            : url === "https://docs.cohere.com/docs/models" && overrides.index !== undefined
              ? overrides.index
              : url === "https://docs.cohere.com/docs/command-a-plus" &&
                  overrides.commandAPlus !== undefined
                ? overrides.commandAPlus
                : url === "https://docs.cohere.com/docs/deprecations" &&
                    overrides.lifecycle !== undefined
                  ? overrides.lifecycle
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
  minPricingCoverage = 0.9,
): Promise<ProviderModel[]> {
  const value = manifest("mistral");
  const configured = value.sources[0];
  if (configured === undefined || configured.extractor.kind !== "mistral-catalog")
    throw new Error("Missing Mistral source");
  const source: SourceManifest = {
    ...configured,
    extractor: {
      kind: "mistral-catalog",
      minModels: 6,
      maxModels: 6,
      minPricingCoverage,
    },
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
        url: "https://docs.mistral.ai/studio-api/conversations/advanced/prompt-caching.md",
        body: await fixture("mistral/prompt-caching.md"),
      },
      {
        url: "https://docs.mistral.ai/studio-api/batch-processing.md",
        body: await fixture("mistral/batch-processing.md"),
      },
    ],
  });
  return parseSource({ provider: provider(value), source, body, observedAt });
}

function withoutMistralPrices(body: string): string {
  return body
    .replace('input: [{ type: "range", price: 1.5, denominator: "/M Tokens" }]', "input: []")
    .replace('output: [{ type: "range", price: 7.5, denominator: "/M Tokens" }]', "output: []");
}

async function llamaCatalog(overrides: Record<string, string> = {}): Promise<ProviderModel[]> {
  const value = manifest("llama");
  const configured = value.sources[0];
  if (configured === undefined || configured.extractor.kind !== "llama-catalog")
    throw new Error("Missing Llama source");
  const source: SourceManifest = {
    ...configured,
    extractor: { kind: "llama-catalog", minModels: 12, maxModels: 12 },
  };
  const raw = (repository: string, path: string): string =>
    `https://raw.githubusercontent.com/meta-llama/${repository}/main/${path}`;
  const files: [url: string, fixturePath: string][] = [
    [raw("llama-models", "models/sku_types.py"), "sku_types.py"],
    [raw("llama-models", "models/cli/safety_models.py"), "safety_models.py"],
    [raw("llama-models", "README.md"), "README.md"],
    [raw("llama-models", "models/llama3_1/MODEL_CARD.md"), "llama3_1.md"],
    [raw("llama-models", "models/llama3_2/MODEL_CARD.md"), "llama3_2.md"],
    [raw("llama-models", "models/llama3_3/MODEL_CARD.md"), "llama3_3.md"],
    [raw("llama-models", "models/llama4/MODEL_CARD.md"), "llama4.md"],
    [raw("llama-api-python", "examples/chat.py"), "chat.py"],
    [raw("llama-api-python", "examples/tool_call.py"), "tool_call.py"],
    [raw("llama-api-python", "examples/structured.py"), "structured.py"],
    [raw("llama-api-python", "src/llama_api_client/_client.py"), "client.py"],
    [
      raw("llama-api-python", "src/llama_api_client/resources/chat/completions.py"),
      "completions.py",
    ],
    [raw("llama-api-python", "src/llama_api_client/resources/moderations.py"), "moderations.py"],
    ["https://ai.meta.com/blog/meta-llama-3/", "meta-llama-3.html"],
    ["https://ai.meta.com/blog/meta-llama-3-1/", "meta-llama-3-1.html"],
    [
      "https://ai.meta.com/blog/llama-3-2-connect-2024-vision-edge-mobile-devices/",
      "meta-llama-3-2.html",
    ],
    [
      "https://ai.meta.com/blog/ai-defenders-program-llama-protection-tools/",
      "meta-protections.html",
    ],
  ];
  const body = JSON.stringify({
    index: {
      url: source.url,
      body: overrides["sku_list.py"] ?? (await fixture("llama/sku_list.py")),
    },
    documents: await Promise.all(
      files.map(async ([url, fixturePath]) => ({
        url,
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
    expect(decimalsEqual("0.3000000000", "0.3")).toBe(true);
    expect(decimalsEqual("0.30000000000000004", "0.3")).toBe(false);
  });
});

describe("model operation taxonomy", () => {
  it("normalizes task semantics and permits multiple observed tasks", () => {
    const tasks = (modelId: string): ReturnType<typeof classifyModelTasks> =>
      classifyModelTasks({
        modelId,
        name: modelId,
        rawType: undefined,
        modalities: { input: [], output: [] },
        fallback: "text_generation",
      });
    expect([
      tasks("text-embedding-3-large"),
      tasks("cohere/rerank-v4-fast"),
      tasks("gpt-4o-transcribe"),
      tasks("gpt-image-2"),
      tasks("gpt-realtime-2"),
      tasks("computer-use-realtime-preview"),
      tasks("voxtral-tts-26-03"),
      tasks("amazon.titan-embed-image-v1"),
      tasks("wan2.7-image-pro"),
      tasks("claude-sonnet-5"),
      tasks("translate-gemma"),
    ]).toEqual([
      ["embeddings"],
      ["reranking"],
      ["transcription"],
      ["image_generation"],
      ["text_generation"],
      ["text_generation"],
      ["speech_synthesis"],
      ["embeddings"],
      ["image_generation"],
      ["text_generation"],
      ["translation"],
    ]);
    expect(
      classifyModelTasks({
        modelId: "gpt-realtime-2",
        name: "GPT Realtime 2",
        rawType: undefined,
        modalities: { input: ["audio"], output: ["audio"] },
      }),
    ).toEqual(["speech_to_speech"]);
  });

  it("keeps release maturity separate from lifecycle state", () => {
    const model = baseModel({
      providerId: "test",
      id: "voice-exp",
      name: "Voice experimental",
      sourceId: "test-source",
      observedAt,
    });
    expect(normalizeModelReleaseStage(model)).toMatchObject({
      status: "unknown",
      release_stage: "experimental",
    });
    expect(
      normalizeModelReleaseStage({
        ...model,
        model_id: "voice-preview",
        name: "Voice preview",
        status: "deprecated",
      }),
    ).toMatchObject({
      status: "deprecated",
      release_stage: "preview",
    });
    expect(modelStateFromLabel("Deprecated · Preview")).toEqual({
      status: "deprecated",
      release_stage: "preview",
    });
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
    const north = models.find((model) => model.model_id === "north-mini-code-1-0");
    expect({
      count: models.length,
      command_a_name: commandA?.name,
      command_a_release: commandA?.release_date,
      command_a_price_count: commandA?.price_facts.length,
      plus_name: commandAPlus?.name,
      plus_modalities: commandAPlus?.modalities,
      plus_reasoning: commandAPlus?.capabilities.reasoning,
      plus_pricing_state: commandAPlus?.pricing_state,
      plus_endpoints: commandAPlus?.api_endpoints,
      command_a_endpoints: commandA?.api_endpoints,
      embedding_limits: embedding?.limits,
      embedding_status: embedding?.status,
      embedding_endpoints: embedding?.api_endpoints,
      embedding_prices: embedding?.price_facts.map(({ meter, price, unit, conditions }) => ({
        meter,
        price,
        unit,
        conditions,
      })),
      rerank_prices: rerank?.price_facts.map(({ price, unit, conditions }) => ({
        price,
        unit,
        conditions,
      })),
      rerank_status: rerank?.status,
      retired: {
        status: retired?.status,
        retired_at: retired?.retired_at,
        replacements: retired?.replacement_model_ids,
        pricing_state: retired?.pricing_state,
        price_count: retired?.price_facts.length,
      },
      arabic: {
        name: arabic?.name,
        tasks: arabic?.tasks,
        modalities: arabic?.modalities,
        release: arabic?.release_date,
        pricing_state: arabic?.pricing_state,
        endpoints: arabic?.api_endpoints,
      },
      north: {
        name: north?.name,
        description: north?.description,
        tasks: north?.tasks,
        modalities: north?.modalities,
        limits: north?.limits,
        release: north?.release_date,
        status: north?.status,
        pricing_state: north?.pricing_state,
        endpoints: north?.api_endpoints,
      },
    }).toEqual({
      count: 43,
      command_a_name: "Command A",
      command_a_release: "2025-03-13",
      command_a_price_count: 0,
      plus_name: "Command A+",
      plus_modalities: { input: ["text", "image"], output: ["text"] },
      plus_reasoning: true,
      plus_pricing_state: "free",
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
      embedding_status: "active",
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
          conditions: {
            endpoint: "Model Vault",
            capacity: "Small",
            billing_period: "hourly",
          },
        },
        {
          meter: "provisioned_throughput",
          price: "2500",
          unit: "unit_month",
          conditions: {
            endpoint: "Model Vault",
            capacity: "Small",
            billing_period: "monthly",
          },
        },
      ],
      embedding_endpoints: [{ name: "Embed", path: "v2/embed" }],
      rerank_prices: [
        { price: "2.5", unit: "thousand_search_units", conditions: {} },
        {
          price: "10.00",
          unit: "unit_hour",
          conditions: {
            endpoint: "Model Vault",
            capacity: "Large",
            billing_period: "hourly",
          },
        },
        {
          price: "6500",
          unit: "unit_month",
          conditions: {
            endpoint: "Model Vault",
            capacity: "Large",
            billing_period: "monthly",
          },
        },
      ],
      rerank_status: "active",
      retired: {
        status: "retired",
        retired_at: "2025-04-30",
        replacements: ["rerank-v3.5"],
        pricing_state: "not_applicable",
        price_count: 0,
      },
      arabic: {
        name: "Cohere Transcribe Arabic",
        tasks: ["transcription"],
        modalities: { input: ["audio"], output: ["text"] },
        release: "2026-07-07",
        pricing_state: "free",
        endpoints: [{ name: "Audio Transcriptions", path: "v2/audio/transcriptions" }],
      },
      north: {
        name: "North Mini Code",
        description:
          "North Mini Code is Cohere's agentic coding model for repository-level software engineering.",
        tasks: ["text_generation"],
        modalities: { input: ["text"], output: ["text"] },
        limits: { context_tokens: 256_000, max_output_tokens: 64_000 },
        release: "2026-06-09",
        status: "active",
        pricing_state: "free",
        endpoints: [
          { name: "Chat Completions", path: "compatibility/v1/chat/completions" },
          { name: "Chat V1", path: "v1/chat" },
          { name: "Chat V2", path: "v2/chat" },
        ],
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
    expect(models.find(({ model_id }) => model_id === "command-r")?.price_facts).toHaveLength(2);
    expect(
      models.find(({ model_id }) => model_id === "command-a-translate-08-2025")?.tasks,
    ).toEqual(["text_generation", "translation"]);
    expect(models.find(({ model_id }) => model_id === "c4ai-aya-expanse-8b")).toMatchObject({
      replacement_model_ids: ["command-r7b-12-2024", "command-a-03-2025"],
      pricing_state: "not_applicable",
      price_facts: [],
    });
    expect(models.find(({ model_id }) => model_id === "embed-english-v2.0")).toMatchObject({
      replacement_model_ids: ["embed-english-v3.0", "embed-multilingual-v3.0", "embed-v4.0"],
      pricing_state: "not_applicable",
      price_facts: [],
    });
  });

  it("treats the authenticated API as a complete scoped page", async () => {
    const models = await parsed("cohere", "cohere/api.json", "cohere-api");
    expect(
      models.map(({ model_id, tasks, api_endpoints, limits }) => ({
        model_id,
        tasks,
        api_endpoints,
        limits,
      })),
    ).toEqual([
      {
        model_id: "command-r-08-2024",
        tasks: ["text_generation"],
        api_endpoints: [{ name: "Generate", path: "v1/generate" }],
        limits: { context_tokens: 128_000 },
      },
      {
        model_id: "embed-v4.0",
        tasks: ["embeddings", "classification"],
        api_endpoints: [{ name: "Classify", path: "v1/classify" }],
        limits: { context_tokens: 128_000 },
      },
      {
        model_id: "cohere-transcribe-07-2026",
        tasks: ["transcription"],
        api_endpoints: undefined,
        limits: { context_tokens: 10_000 },
      },
      {
        model_id: "embed-english-v3.0-image",
        tasks: ["embeddings"],
        api_endpoints: undefined,
        limits: {},
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
    await expect(
      cohereCatalog({
        modelIndex: `${await fixture("cohere/model-index.md")}\n- [Missing](https://docs.cohere.com/docs/missing.md)`,
      }),
    ).rejects.toThrow("Cohere model index document is missing");
  });

  it("derives lifecycle dates and scheduled state from each reviewed section", async () => {
    const lifecycle = (await fixture("cohere/lifecycle.html")).replace(
      "</main>",
      `<h3>2027-08-01: Future retirement</h3>
       <p>The following models will be retired:</p>
       <ul><li><code>future-model</code></li></ul>
       </main>`,
    );
    const model = (await cohereCatalog({ lifecycle })).find(
      ({ model_id }) => model_id === "future-model",
    );
    expect(model).toMatchObject({
      status: "deprecated",
      retired_at: "2027-08-01",
    });
  });

  it("takes operation families from reviewed catalog sections, not identifier prefixes", async () => {
    const index = (await fixture("cohere/index.html")).replace(
      "<td>command-nightly</td>\n      <td>Cohere API</td>\n    </tr>",
      "<td>command-nightly</td>\n      <td>Cohere API</td>\n    </tr>\n    <tr>\n      <td>research-nightly</td>\n      <td>Cohere API</td>\n    </tr>",
    );
    const models = await cohereCatalog({ index });
    expect(models.find(({ model_id }) => model_id === "research-nightly")?.tasks).toEqual([
      "text_generation",
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
        url: "https://docs.cohere.com/docs/models/llms.txt",
        extractor: {
          kind: "cohere-catalog",
          minModels: 40,
          maxModels: 70,
          minPricingCoverage: 0.6,
        },
        type: "website",
        fields: expect.arrayContaining(["api_endpoints"]),
        linkedDocuments: {
          indexFormat: "markdown",
          discoverySuffix: ".md",
          minDocuments: 15,
          maxDocuments: 30,
        },
      },
      {
        extractor: { kind: "cohere-api" },
        type: "api",
        scope: "account",
        role: "inventory",
        fields: expect.arrayContaining(["api_endpoints"]),
      },
    ]);
  });
});

describe("Mistral adapters", () => {
  it("parses exact API names, non-exclusive tasks, lifecycle, and native prices", async () => {
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
        release_stage: medium?.release_stage,
        aliases: medium?.aliases,
        tasks: medium?.tasks,
        api_endpoints: medium?.api_endpoints,
        modalities: medium?.modalities,
        limits: medium?.limits,
        release_date: medium?.release_date,
        pricing: medium?.price_facts.map(({ meter, price, unit, conditions, derived }) => ({
          meter,
          price,
          unit,
          conditions,
          derived,
        })),
      },
      embed: {
        tasks: embed?.tasks,
        api_endpoints: embed?.api_endpoints,
      },
      ocr: {
        tasks: ocr?.tasks,
        api_endpoints: ocr?.api_endpoints,
        modalities: ocr?.modalities,
        pricing: ocr?.price_facts.map(({ meter, price, unit, conditions }) => ({
          meter,
          price,
          unit,
          conditions,
        })),
      },
      speech: {
        tasks: speech?.tasks,
        api_endpoints: speech?.api_endpoints,
        modalities: speech?.modalities,
        pricing: speech?.price_facts.map(({ meter, price, unit }) => ({ meter, price, unit })),
      },
      retired: {
        tasks: retired?.tasks,
        status: retired?.status,
        deprecated_at: retired?.deprecated_at,
        retired_at: retired?.retired_at,
        replacements: retired?.replacement_model_ids,
        api_endpoints: retired?.api_endpoints,
        pricing_state: retired?.pricing_state,
        price_count: retired?.price_facts.length,
      },
    }).toEqual({
      count: 6,
      medium: {
        name: "Mistral Medium 3.5",
        version: "26.04",
        release_stage: "stable",
        aliases: ["mistral-medium-3", "mistral-medium-latest"],
        tasks: ["text_generation"],
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
        tasks: ["embeddings"],
        api_endpoints: [
          { name: "Batch", path: "/v1/batch" },
          { name: "Embeddings", path: "/v1/embeddings" },
        ],
      },
      ocr: {
        tasks: ["ocr"],
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
        tasks: ["speech_synthesis"],
        api_endpoints: [{ name: "Audio Speech", path: "/v1/audio/speech" }],
        modalities: { input: ["text", "audio"], output: ["audio"] },
        pricing: [
          { meter: "input_text", price: "0", unit: "million_characters" },
          { meter: "output_audio", price: "16", unit: "million_characters" },
        ],
      },
      retired: {
        tasks: ["text_generation"],
        status: "retired",
        deprecated_at: "2024-11-30",
        retired_at: "2025-03-30",
        replacements: ["mistral-large-2512"],
        api_endpoints: undefined,
        pricing_state: "not_applicable",
        price_count: 0,
      },
    });
  });

  it("uses explicit lifecycle state and publishes no current offer for retired models", async () => {
    const medium = await fixture("mistral/mistral-medium-3-5-26-04.ts");
    const metadata =
      'metadata: { deprecationDate: "2026-01-01", retirementDate: "2026-02-01", replacement: "Mistral Large 3" }';
    const deprecated = (
      await mistralCatalog({
        medium: medium
          .replace('status: "GA"', 'status: "Deprecated"')
          .replace("metadata: {}", metadata),
      })
    ).find(({ model_id }) => model_id === "mistral-medium-3-5");
    const retired = (
      await mistralCatalog({
        medium: medium
          .replace('status: "GA"', 'status: "Retired"')
          .replace("metadata: {}", metadata),
      })
    ).find(({ model_id }) => model_id === "mistral-medium-3-5");
    expect(deprecated).toMatchObject({
      status: "deprecated",
      retired_at: "2026-02-01",
      pricing_state: "numeric",
    });
    expect(retired).toMatchObject({
      status: "retired",
      retired_at: "2026-02-01",
      pricing_state: "not_applicable",
      price_facts: [],
    });
  });

  it("distinguishes an unpublished current price from missing pricing evidence", async () => {
    const medium = withoutMistralPrices(await fixture("mistral/mistral-medium-3-5-26-04.ts"));
    const model = (await mistralCatalog({ medium }, 0.8)).find(
      ({ model_id }) => model_id === "mistral-medium-3-5",
    );
    expect(model).toMatchObject({ pricing_state: "not_published", price_facts: [] });
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

    await expect(
      mistralCatalog({
        medium: withoutMistralPrices(medium),
      }),
    ).rejects.toThrow("Mistral pricing coverage fell below reviewed bounds");

    expect(
      (
        await mistralCatalog({
          medium: medium.replace('status: "GA"', 'status: "PublicPreview"'),
        })
      ).find(({ model_id }) => model_id === "mistral-medium-3-5"),
    ).toMatchObject({ status: "active", release_stage: "preview" });
  });

  it("validates structured base models and ignores private fine-tunes", async () => {
    const models = await parsed("mistral", "mistral/api.json", "mistral-api");
    expect(
      models.map(({ model_id, name, aliases, tasks, modalities, limits, status, source_refs }) => ({
        model_id,
        name,
        aliases,
        tasks,
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
        tasks: ["text_generation"],
        modalities: { input: ["text", "image"], output: ["text"] },
        limits: { context_tokens: 262_144 },
        status: "active",
        source_refs: ["mistral-api"],
      },
      {
        model_id: "mistral-ocr-4-0",
        name: "OCR 4",
        aliases: ["mistral-ocr-latest"],
        tasks: ["ocr"],
        modalities: { input: ["image", "pdf"], output: ["text"] },
        limits: {},
        status: "active",
        source_refs: ["mistral-api"],
      },
    ]);
  });

  it("declares a structured official catalog and non-persistent account inventory", () => {
    const value = manifest("mistral");
    expect(value.sources).toMatchObject([
      {
        extractor: {
          kind: "mistral-catalog",
          minModels: 50,
          maxModels: 90,
          minPricingCoverage: 0.9,
        },
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
            expect.objectContaining({
              id: "prompt-caching",
              url: expect.stringMatching(/\.md$/),
            }),
            expect.objectContaining({
              id: "batch-processing",
              url: expect.stringMatching(/\.md$/),
            }),
          ]),
        },
      },
      {
        extractor: { kind: "mistral-api" },
        type: "api",
        scope: "account",
        role: "inventory",
      },
    ]);
  });
});

describe("Meta Llama adapters", () => {
  it("parses exact CLI descriptors, artifact variants, tasks, dates, and API aliases", async () => {
    const models = await llamaCatalog();
    const quantized = models.find(
      ({ model_id }) => model_id === "Llama3.2-1B-Instruct:int4-qlora-eo8",
    );
    const hosted = models.find(
      ({ model_id }) => model_id === "Llama-4-Maverick-17B-128E-Instruct:fp8",
    );
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
        pricing_state: hosted?.pricing_state,
      },
      safety: models
        .filter(({ tasks }) => !tasks.includes("text_generation"))
        .map(
          ({
            model_id,
            tasks,
            modalities,
            limits,
            release_date,
            api_endpoints,
            pricing_state,
          }) => ({
            model_id,
            tasks,
            modalities,
            context: limits.context_tokens,
            release_date,
            api_endpoints,
            pricing_state,
          }),
        )
        .sort((left, right) => left.model_id.localeCompare(right.model_id)),
    }).toEqual({
      count: 12,
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
        pricing_state: "not_published",
      },
      safety: [
        {
          model_id: "Llama-Guard-2-8B",
          tasks: ["moderation"],
          modalities: { input: ["text"], output: ["text"] },
          context: 4_096,
          release_date: "2024-04-18",
          api_endpoints: undefined,
          pricing_state: "not_applicable",
        },
        {
          model_id: "Llama-Guard-3-11B-Vision",
          tasks: ["moderation"],
          modalities: { input: ["text", "image"], output: ["text"] },
          context: 131_072,
          release_date: "2024-09-25",
          api_endpoints: undefined,
          pricing_state: "not_applicable",
        },
        {
          model_id: "Llama-Guard-3-8B",
          tasks: ["moderation"],
          modalities: { input: ["text"], output: ["text"] },
          context: 131_072,
          release_date: "2024-07-23",
          api_endpoints: undefined,
          pricing_state: "not_applicable",
        },
        {
          model_id: "Llama-Guard-4-12B",
          tasks: ["moderation"],
          modalities: { input: ["text", "image"], output: ["text"] },
          context: 8_192,
          release_date: "2025-04-29",
          api_endpoints: [{ name: "Moderations", path: "/v1/moderations" }],
          pricing_state: "not_published",
        },
        {
          model_id: "Llama-Prompt-Guard-2-22M",
          tasks: ["classification"],
          modalities: { input: ["text"], output: ["text"] },
          context: 512,
          release_date: "2025-04-29",
          api_endpoints: undefined,
          pricing_state: "not_applicable",
        },
        {
          model_id: "Prompt-Guard-86M",
          tasks: ["classification"],
          modalities: { input: ["text"], output: ["text"] },
          context: 512,
          release_date: "2024-07-23",
          api_endpoints: undefined,
          pricing_state: "not_applicable",
        },
      ],
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
    ).rejects.toThrow("Llama API Chat Completions path was not relative");
    const moderations = await fixture("llama/moderations.py");
    await expect(
      llamaCatalog({
        "moderations.py": moderations.replace(
          '"/moderations"',
          '"https://api.llama.com/v1/moderations"',
        ),
      }),
    ).rejects.toThrow("Llama API Moderations path was not relative");

    const skuTypes = await fixture("llama/sku_types.py");
    await expect(
      llamaCatalog({
        "sku_types.py": skuTypes
          .replace('llama2 = "llama2"', 'llama3_4 = "llama3_4"')
          .replaceAll("ModelFamily.llama2", "ModelFamily.llama3_4")
          .replaceAll("llama2_7b", "llama3_4_8b")
          .replace("Llama-2-7b", "Llama-3.4-8B"),
        "sku_list.py": skuList
          .replace("CoreModelId.llama2_7b", "CoreModelId.llama3_4_8b")
          .replace("meta-llama/Llama-2-7b", "meta-llama/Llama-3.4-8B"),
      }),
    ).rejects.toThrow("Llama launch table omitted Llama 3.4");
  });

  it("derives static context and safety release evidence from official source semantics", async () => {
    const skuTypes = await fixture("llama/sku_types.py");
    const models = await llamaCatalog({
      "sku_types.py": skuTypes.replace(
        "if self.model_family == ModelFamily.llama2:\n            return 4096",
        "if self.model_family == ModelFamily.llama2:\n            return 16384",
      ),
      "meta-protections.html": (await fixture("llama/meta-protections.html")).replace(
        "April 29, 2025",
        "May 1, 2025",
      ),
    });
    expect(models.find(({ model_id }) => model_id === "Llama-2-7b")?.limits.context_tokens).toBe(
      16_384,
    );
    expect(models.find(({ model_id }) => model_id === "Llama-Guard-4-12B")?.release_date).toBe(
      "2025-05-01",
    );

    await expect(
      llamaCatalog({
        "sku_types.py": skuTypes.replace("return 4096", "return 4 * 1024"),
      }),
    ).rejects.toThrow("Llama max_seq_length function changed shape");
    await expect(
      llamaCatalog({
        "meta-protections.html": (await fixture("llama/meta-protections.html")).replace(
          "Llama API",
          "hosted API",
        ),
      }),
    ).rejects.toThrow("omitted reviewed model evidence");
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
        source: ["repository", "website"],
        exhaustive: true,
        fields: expect.arrayContaining(["api_endpoints"]),
        linkedDocuments: {
          documents: expect.arrayContaining([
            expect.objectContaining({ id: "llama-api-structured-example" }),
            expect.objectContaining({ id: "llama-api-client" }),
            expect.objectContaining({ id: "llama-api-chat-completions" }),
            expect.objectContaining({ id: "llama-api-moderations" }),
            expect.objectContaining({ id: "llama-3-release" }),
            expect.objectContaining({ id: "llama-3-1-release" }),
            expect.objectContaining({ id: "llama-3-2-release" }),
            expect.objectContaining({ id: "llama-protections-release" }),
          ]),
        },
      },
      {
        extractor: { kind: "llama-api" },
        type: "api",
        scope: "account",
        role: "inventory",
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

  it("uses Cohere's Markdown index to discover canonical HTML model pages", async () => {
    const source = manifest("cohere").sources[0];
    if (source?.linkedDocuments === undefined) throw new Error("Missing Cohere link policy");
    const urls = linkedDocumentUrls(
      `${await fixture("cohere/model-index.md")}
       [Not a Markdown source](https://docs.cohere.com/docs/not-a-source)`,
      {
        ...source,
        linkedDocuments: {
          ...source.linkedDocuments,
          minDocuments: 5,
          maxDocuments: 5,
        },
      },
    );
    expect(urls.map((url) => url.pathname)).toEqual([
      "/docs/command-a",
      "/docs/command-a-plus",
      "/docs/north-mini-code-1.0",
      "/docs/transcribe",
      "/docs/transcribe-arabic",
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
      tasks: model?.tasks,
      endpoints: model?.api_endpoints,
      aliases: model?.aliases,
      context: model?.limits.context_tokens,
      output: model?.limits.max_output_tokens,
      modalities: model?.modalities,
      capabilities: model?.capabilities,
      status: model?.status,
      embedding_type: embedding?.tasks,
      embedding_output: embedding?.modalities.output,
    }).toEqual({
      name: "GPT-5.4",
      tasks: ["text_generation"],
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
        code_execution: true,
        context_management: "unknown",
        effort_control: true,
        computer_use: true,
      },
      status: "active",
      embedding_type: ["embeddings"],
      embedding_output: ["embedding"],
    });
    expect(
      model?.price_facts.find(
        (rate) =>
          rate.meter === "cache_write_text" && rate.conditions.context_min_tokens === undefined,
      )?.price,
    ).toBe("3.125");
    expect(
      model?.price_facts.find(
        (rate) => rate.meter === "input_text" && rate.conditions.context_min_tokens === 272_001,
      )?.price,
    ).toBe("5");
    expect(
      model?.price_facts.find(
        (rate) =>
          rate.meter === "cache_read_text" && rate.conditions.context_min_tokens === 272_001,
      )?.price,
    ).toBe("0.5");
  });

  it("distinguishes the standard and batch views behind a price-tier selector", async () => {
    const model = (await parsed("openai", "openai/batch-catalog.json"))[0];
    expect(
      model?.price_facts.map(({ meter, price, conditions }) => ({ meter, price, conditions })),
    ).toEqual([
      {
        meter: "input_text",
        price: "2.00",
        conditions: { service_tier: "standard" },
      },
      {
        meter: "output_text",
        price: "8.00",
        conditions: { service_tier: "standard" },
      },
      {
        meter: "input_text",
        price: "1.00",
        conditions: { service_tier: "batch" },
      },
      {
        meter: "output_text",
        price: "4.00",
        conditions: { service_tier: "batch" },
      },
    ]);
    expect(model?.capabilities.batch).toBe(true);
    expect(model?.api_endpoints).toEqual([
      { name: "Responses", path: "v1/responses" },
      { name: "Batch", path: "v1/batch" },
    ]);
  });

  it("fills missing prices, adds service tiers, and rejects source conflicts", async () => {
    const value = manifest("openai");
    const configured = value.sources.find(({ id }) => id === "openai-pricing");
    if (configured === undefined || configured.extractor.kind !== "openai-pricing")
      throw new Error("Missing OpenAI pricing source");
    const source: SourceManifest = {
      ...configured,
      extractor: { kind: "openai-pricing", minModels: 3, maxModels: 3 },
    };
    const catalogSource = value.sources.find(({ id }) => id === "openai-models");
    if (catalogSource === undefined) throw new Error("Missing OpenAI catalog source");
    const catalog = parseSource({
      provider: provider(value),
      source: catalogSource,
      body: (await fixture("openai/catalog.json")).replace(
        "Prompts with",
        "For GPT-5.4, prompts with",
      ),
      observedAt,
    });
    const image = {
      ...baseModel({
        providerId: "openai",
        id: "gpt-image-2",
        name: "GPT Image 2",
        sourceId: "openai-models",
        observedAt,
      }),
      aliases: ["gpt-image-2-2026-04-21"],
      tasks: ["image_generation"],
    } satisfies ProviderModel;
    const transcribe = {
      ...baseModel({
        providerId: "openai",
        id: "gpt-transcribe",
        name: "GPT Transcribe",
        sourceId: "openai-models",
        observedAt,
      }),
      tasks: ["transcription"],
    } satisfies ProviderModel;
    const tokenTranscribe = {
      ...baseModel({
        providerId: "openai",
        id: "gpt-4o-transcribe",
        name: "GPT-4o Transcribe",
        sourceId: "openai-models",
        observedAt,
      }),
      tasks: ["transcription"],
      pricing_state: "numeric",
      price_facts: [
        publishedRate("input_audio", "2.5", "million_tokens", "openai-models", "per 1M tokens", {
          service_tier: "standard",
        }),
        publishedRate("output_audio", "10", "million_tokens", "openai-models", "per 1M tokens", {
          service_tier: "standard",
        }),
      ],
    } satisfies ProviderModel;
    const pricingBody = await fixture("openai/pricing.md");
    const parsePricing = (body: string) =>
      parseSource({
        provider: provider(value),
        source,
        body,
        observedAt,
        catalogModels: [...catalog, image, transcribe, tokenTranscribe],
      });
    const models = parsePricing(pricingBody);
    const gpt = models.find(({ model_id }) => model_id === "gpt-5.4");
    const imageRates = models.find(({ model_id }) => model_id === "gpt-image-2")?.price_facts;
    const transcribeRates = models.find(
      ({ model_id }) => model_id === "gpt-transcribe",
    )?.price_facts;
    expect(gpt?.price_facts.map(({ meter, conditions }) => ({ meter, conditions }))).toEqual([
      {
        meter: "input_text",
        conditions: { service_tier: "batch", context_max_tokens: 272_000 },
      },
      {
        meter: "cache_read_text",
        conditions: { service_tier: "batch", context_max_tokens: 272_000 },
      },
      {
        meter: "output_text",
        conditions: { service_tier: "batch", context_max_tokens: 272_000 },
      },
      {
        meter: "input_text",
        conditions: { service_tier: "batch", context_min_tokens: 272_001 },
      },
      {
        meter: "cache_read_text",
        conditions: { service_tier: "batch", context_min_tokens: 272_001 },
      },
      {
        meter: "output_text",
        conditions: { service_tier: "batch", context_min_tokens: 272_001 },
      },
      {
        meter: "input_text",
        conditions: { service_tier: "flex", context_max_tokens: 272_000 },
      },
      {
        meter: "cache_read_text",
        conditions: { service_tier: "flex", context_max_tokens: 272_000 },
      },
      {
        meter: "output_text",
        conditions: { service_tier: "flex", context_max_tokens: 272_000 },
      },
      {
        meter: "input_text",
        conditions: { service_tier: "flex", context_min_tokens: 272_001 },
      },
      {
        meter: "cache_read_text",
        conditions: { service_tier: "flex", context_min_tokens: 272_001 },
      },
      {
        meter: "output_text",
        conditions: { service_tier: "flex", context_min_tokens: 272_001 },
      },
      {
        meter: "input_text",
        conditions: { service_tier: "fast", context_max_tokens: 272_000 },
      },
      {
        meter: "cache_read_text",
        conditions: { service_tier: "fast", context_max_tokens: 272_000 },
      },
      {
        meter: "output_text",
        conditions: { service_tier: "fast", context_max_tokens: 272_000 },
      },
    ]);
    expect(imageRates).toHaveLength(10);
    expect(imageRates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          meter: "output_image",
          price: "30.00",
          conditions: { service_tier: "standard" },
        }),
        expect.objectContaining({
          meter: "output_image",
          price: "15.00",
          conditions: { service_tier: "batch" },
        }),
      ]),
    );
    expect(transcribeRates).toEqual([
      expect.objectContaining({
        meter: "input_audio",
        price: "0.0045",
        unit: "minute",
        conditions: { service_tier: "standard" },
      }),
    ]);
    expect(models.some(({ model_id }) => model_id === "gpt-4o-transcribe")).toBe(false);
    expect(() => parsePricing(pricingBody.replace("$5.00", "$5.01"))).toThrow(
      "OpenAI pricing sources disagree for gpt-5.4",
    );
  });

  it("binds Realtime translation duration to audio input", async () => {
    const models = await parsed("openai", "openai/realtime-translation-catalog.json");
    expect(models.find(({ model_id }) => model_id === "gpt-realtime-translate")).toMatchObject({
      model_id: "gpt-realtime-translate",
      tasks: ["translation"],
      price_facts: [
        expect.objectContaining({ meter: "input_audio", price: "0.034", unit: "minute" }),
      ],
    });
    expect(models.find(({ model_id }) => model_id === "gpt-transcribe")).toMatchObject({
      tasks: ["transcription"],
      price_facts: [
        expect.objectContaining({ meter: "input_audio", price: "0.0045", unit: "minute" }),
      ],
    });
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
    const archived = models.find((candidate) => candidate.uid === "azure/gpt-archive@0613");
    const assistant = models.find((candidate) => candidate.uid === "azure/gpt-assistant@1");
    const newer = models.find((candidate) => candidate.uid === "azure/gpt-multi@2026-02-01");
    const family = models.find((candidate) => candidate.uid === "azure/gpt-family");
    expect({
      tasks: model?.tasks,
      serviceFamilies: model?.service_families,
      endpoints: model?.api_endpoints,
      modalities: model?.modalities,
      context: model?.limits.context_tokens,
      output: model?.limits.max_output_tokens,
      lifecycle: [model?.status, model?.release_stage],
      availability: model?.availability?.length,
      whisper: whisper?.tasks,
      whisperEndpoints: whisper?.api_endpoints,
      realtimeEndpoints: realtime?.api_endpoints,
      rerank: rerank?.tasks,
      embedding: [
        embedding?.tasks,
        embedding?.modalities.output,
        embedding?.service_families,
        embedding?.status,
        embedding?.release_stage,
      ],
      retired: [retired?.status, retired?.replacement_model_ids],
      archived: [archived?.status, archived?.retired_at, archived?.replacement_model_ids],
      assistant: [assistant?.status, assistant?.availability],
      newer: [newer?.limits, newer?.api_endpoints],
      versionless: [family?.version, family?.service_families, family?.api_endpoints],
    }).toEqual({
      tasks: ["text_generation"],
      serviceFamilies: ["Azure OpenAI"],
      endpoints: expect.arrayContaining([
        { name: "createBatch", path: "openai/v1/batches" },
        { name: "createChatCompletion", path: "openai/v1/chat/completions" },
        { name: "createResponse", path: "openai/v1/responses" },
      ]),
      modalities: { input: ["text", "image"], output: ["text"] },
      context: 128_000,
      output: 16_384,
      lifecycle: ["active", "stable"],
      availability: 5,
      whisper: ["transcription", "translation"],
      whisperEndpoints: expect.arrayContaining([
        { name: "createTranscription", path: "openai/v1/audio/transcriptions" },
        { name: "createTranslation", path: "openai/v1/audio/translations" },
      ]),
      realtimeEndpoints: [{ name: "createRealtimeSession", path: "openai/v1/realtime/sessions" }],
      rerank: ["reranking", "classification"],
      embedding: [
        ["embeddings"],
        ["embedding"],
        ["Foundry Models from partners and community"],
        "active",
        "preview",
      ],
      retired: ["retired", ["gpt-multi"]],
      archived: ["retired", "April 30, 2025", ["gpt-multi"]],
      assistant: ["active", [{ region: "eastus", deployment_type: "Standard/Regional" }]],
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
    expect(
      models.some((candidate) => candidate.model_id === "Old Model Not In The Current Catalog"),
    ).toBe(false);
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
      tasks: model?.tasks,
      capabilities: model?.capabilities,
      context: model?.limits.context_tokens,
      status: model?.status,
      deprecatedAt: model?.deprecated_at,
      availability: model?.availability,
      price: model?.price_facts[0],
      imagePrice: model?.price_facts.find((rate) => rate.meter === "input_image")?.price,
      scope: model?.scope,
    }).toEqual({
      uid: "azure/gpt-multi@2026-01-01",
      description: "A structured regional model.",
      tasks: ["text_generation"],
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
        },
        source_ref: "azure-api",
        derived: false,
        raw_price: "1.25",
        raw_unit: "1M Tokens",
        raw_validity: "2026-01-01T00:00:00Z",
      },
      imagePrice: "2.5",
      scope: "runtime_observation",
    });
    await expect(parsed("azure", "azure/broken-api.json", "azure-api")).rejects.toThrow(
      "schema drift",
    );
  });

  it("extracts current public retail rates without Azure credentials", async () => {
    const value = manifest("azure");
    const source = azureRetailSource(3, 5, 0.8);
    const models = parseSource({
      provider: provider(value),
      source,
      body: await fixture("azure/retail-prices.json"),
      observedAt,
      catalogModels: [
        azurePricingModel("gpt-4.1", "2025-04-14"),
        azurePricingModel("gpt-5.6-terra", "2026-07-09"),
        azurePricingModel("gpt-audio-1.5", "2026-02-23"),
        azurePricingModel("gpt-4o-mini-realtime-preview", "2024-12-17"),
        azurePricingModel("gpt-4o-mini-audio-preview", "2024-12-17"),
      ],
    });
    const gpt = models.find(({ model_id }) => model_id === "gpt-4.1");
    const terra = models.find(({ model_id }) => model_id === "gpt-5.6-terra");
    const audio = models.find(({ model_id }) => model_id === "gpt-audio-1.5");
    const realtime = models.find(({ model_id }) => model_id === "gpt-4o-mini-realtime-preview");
    const audioPreview = models.find(({ model_id }) => model_id === "gpt-4o-mini-audio-preview");
    expect(models).toHaveLength(5);
    expect(gpt?.price_facts).toEqual([
      expect.objectContaining({
        meter: "input_text",
        price: "0.0022",
        unit: "thousand_tokens",
        conditions: { region: "eastus", deployment_scope: "Standard" },
        raw_validity: "2025-11-01T00:00:00Z",
      }),
      expect.objectContaining({ meter: "output_text", price: "0.0088" }),
      expect.objectContaining({ meter: "cache_read_text", price: "0.00055" }),
    ]);
    expect(terra?.price_facts).toEqual([
      expect.objectContaining({
        meter: "input_text",
        conditions: {
          region: "eastus2",
          deployment_scope: "GlobalStandard",
          context_tier: "short_context",
        },
        raw_validity: "2026-07-01T00:00:00Z – 2026-08-31T23:59:00Z",
      }),
      expect.objectContaining({
        meter: "cache_read_text",
        conditions: {
          region: "eastus2",
          deployment_scope: "GlobalStandard",
          service_tier: "priority",
          context_tier: "short_context",
        },
      }),
      expect.objectContaining({ meter: "cache_write_text" }),
    ]);
    expect(audio?.price_facts.map(({ meter }) => meter)).toEqual(["input_text", "input_audio"]);
    expect(realtime).toMatchObject({
      uid: "azure/gpt-4o-mini-realtime-preview@2024-12-17",
      price_facts: [
        expect.objectContaining({ meter: "input_text", price: "0.0006" }),
        expect.objectContaining({ meter: "input_audio", price: "0.01" }),
      ],
    });
    expect(audioPreview).toMatchObject({
      uid: "azure/gpt-4o-mini-audio-preview@2024-12-17",
      price_facts: [
        expect.objectContaining({ meter: "input_text", price: "0.00015" }),
        expect.objectContaining({ meter: "input_audio", price: "0.01" }),
      ],
    });
    expect(models.some(({ model_id }) => model_id === "gpt-5")).toBe(false);
  });

  it("matches retail SKUs against the public model/version catalog", async () => {
    const value = manifest("azure");
    const catalogModels: ProviderModel[] = [
      azurePricingModel("codex-mini", "2025-05-16"),
      azurePricingModel("gpt-realtime-mini", "2025-12-15"),
      azurePricingModel("gpt-audio-mini", "2025-12-15"),
      azurePricingModel("gpt-35-turbo-16k", "0613"),
      azurePricingModel("gpt-35-turbo", "0125"),
      azurePricingModel("gpt-35-turbo", "1106"),
      azurePricingModel("o3-deep-research", "2025-06-26"),
      azurePricingModel("computer-use-preview", "2025-03-11"),
      { ...azurePricingModel("sora-2", "2025-10-06"), tasks: ["video_generation"] },
      azurePricingModel("gpt-chat-latest", "2026-05-05"),
      azurePricingModel("gpt-chat-latest", "2026-05-28"),
      azurePricingModel("gpt-image-1-mini", "2025-10-06"),
    ];
    const models = parseSource({
      provider: provider(value),
      source: azureRetailSource(9, 9, 1),
      body: await fixture("azure/retail-catalog-matching.json"),
      observedAt,
      catalogModels,
    });
    expect(
      models.map(({ uid, price_facts }) => ({
        uid,
        meters: price_facts.map(({ meter }) => meter),
      })),
    ).toEqual([
      { uid: "azure/codex-mini@2025-05-16", meters: ["input_text"] },
      { uid: "azure/computer-use-preview@2025-03-11", meters: ["input_text"] },
      { uid: "azure/gpt-35-turbo-16k@0613", meters: ["input_text"] },
      { uid: "azure/gpt-35-turbo@0125", meters: ["input_text"] },
      { uid: "azure/gpt-chat-latest@2026-05-05", meters: ["input_text"] },
      { uid: "azure/gpt-image-1-mini@2025-10-06", meters: ["input_image"] },
      { uid: "azure/gpt-realtime-mini@2025-12-15", meters: ["input_audio"] },
      { uid: "azure/o3-deep-research@2025-06-26", meters: ["input_text"] },
      { uid: "azure/sora-2@2025-10-06", meters: ["video_generation"] },
    ]);
  });

  it("does not guess which version owns a versionless retail SKU", async () => {
    const value = manifest("azure");
    const bundle = z
      .object({ prices: z.array(z.object({ skuName: z.string() }).passthrough()) })
      .parse(JSON.parse(await fixture("azure/retail-catalog-matching.json")));
    const body = JSON.stringify({
      prices: bundle.prices.filter(({ skuName }) => skuName === "Sora 2 glbl"),
    });
    expect(
      parseSource({
        provider: provider(value),
        source: azureRetailSource(0, 0, 0),
        body,
        observedAt,
        catalogModels: [
          { ...azurePricingModel("sora-2", "2025-10-06"), tasks: ["video_generation"] },
          { ...azurePricingModel("sora-2", "2025-12-08"), tasks: ["video_generation"] },
        ],
      }),
    ).toEqual([]);
  });

  it("fails closed when too many public retail rows cannot be matched", async () => {
    const value = manifest("azure");
    const body = await fixture("azure/retail-prices.json");
    expect(() =>
      parseSource({
        provider: provider(value),
        source: azureRetailSource(3, 5, 0.9),
        body,
        observedAt,
        catalogModels: [
          azurePricingModel("gpt-4.1", "2025-04-14"),
          azurePricingModel("gpt-5.6-terra", "2026-07-09"),
          azurePricingModel("gpt-audio-1.5", "2026-02-23"),
          azurePricingModel("gpt-4o-mini-realtime-preview", "2024-12-17"),
          azurePricingModel("gpt-4o-mini-audio-preview", "2024-12-17"),
        ],
      }),
    ).toThrow("interpretation coverage fell below");
  });

  it("preserves ARM Legacy as a callable lifecycle state", async () => {
    const value = manifest("azure");
    const source = value.sources.find((candidate) => candidate.id === "azure-api");
    if (source === undefined) throw new Error("Missing Azure API source");
    const body = (await fixture("azure/api.json")).replace(
      '"lifecycleStatus": "GenerallyAvailable"',
      '"lifecycleStatus": "Legacy"',
    );
    const model = parseSource({ provider: provider(value), source, body, observedAt })[0];
    expect(model).toMatchObject({
      status: "legacy",
      release_stage: "unknown",
    });
  });
});

describe("Gemini adapters", () => {
  it("joins labeled model pages, lifecycle, changelog, and pricing", async () => {
    const models = await geminiCatalog();
    const model = models.find((item) => item.model_id === "gemini-test-preview");
    expect({
      name: model?.name,
      aliases: model?.aliases,
      tasks: model?.tasks,
      modalities: model?.modalities,
      capabilities: model?.capabilities,
      limits: model?.limits,
      release: model?.release_date,
      updated: model?.updated_date,
      status: model?.status,
      releaseStage: model?.release_stage,
      endpoints: endpoints(model),
      input: model?.price_facts.find(
        (rate) =>
          rate.meter === "input_text" && rate.conditions.account_eligibility === "paid_tier",
      )?.price,
      free: model?.price_facts.find(
        (rate) =>
          rate.meter === "input_text" && rate.conditions.account_eligibility === "free_tier",
      )?.price,
      searchUnit: model?.price_facts.find((rate) => rate.meter === "tool_call")?.unit,
      searchAllowance: model?.raw_price_facts.find(
        (fact) => fact.term_key === "google_search_allowance",
      ),
      cached: model?.price_facts.find((rate) => rate.meter === "cache_read_text")?.price,
      storage: model?.price_facts.find((rate) => rate.meter === "cache_storage")?.unit,
    }).toEqual({
      name: "Gemini Test",
      aliases: ["gemini-test-latest"],
      tasks: ["text_generation"],
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
      status: "active",
      releaseStage: "preview",
      endpoints: ["interactions.create /v1beta/interactions"],
      input: "1.50",
      free: "0",
      searchUnit: "thousand_requests",
      searchAllowance: expect.objectContaining({
        impact: "allowance",
        reason: "unsupported_structure",
        raw: expect.objectContaining({
          fragment: expect.stringContaining("shared across all Gemini 3.x models"),
        }),
      }),
      cached: "0.15",
      storage: "million_tokens_per_hour",
    });
  });

  it("extracts every labeled model table from a shared detail page", async () => {
    const models = await geminiCatalog();
    expect(
      ["gemini-robotics-er-2-preview", "gemini-robotics-er-2-streaming-preview"].map((id) => {
        const model = models.find((item) => item.model_id === id);
        return {
          id: model?.model_id,
          name: model?.name,
          tasks: model?.tasks,
          limits: model?.limits,
          release: model?.release_date,
          updated: model?.updated_date,
          price: model?.price_facts.find(
            (rate) =>
              rate.meter === "input_text" && rate.conditions.account_eligibility === "paid_tier",
          )?.price,
        };
      }),
    ).toEqual([
      {
        id: "gemini-robotics-er-2-preview",
        name: "Gemini Robotics ER 2 Preview",
        tasks: ["text_generation"],
        limits: {
          context_tokens: 131_072,
          max_input_tokens: 131_072,
          max_output_tokens: 65_536,
        },
        release: "2026-07-30",
        updated: "2026-07",
        price: "1.25",
      },
      {
        id: "gemini-robotics-er-2-streaming-preview",
        name: "Gemini Robotics ER 2 Streaming Preview",
        tasks: ["text_generation"],
        limits: {
          context_tokens: 131_072,
          max_input_tokens: 131_072,
          max_output_tokens: 65_536,
        },
        release: "2026-07-30",
        updated: "2026-07",
        price: "1.25",
      },
    ]);
  });

  it("preserves usage-dependent agent pricing without inventing a fixed rate", async () => {
    const agent = (await geminiCatalog()).find((model) => model.model_id === "deep-research-test");
    expect(agent).toMatchObject({
      pricing_state: "unknown",
      price_facts: [],
      raw_price_facts: [
        {
          term_key: "agent_usage_formula",
          impact: "base_price",
          reason: "requires_usage_aggregation",
          raw: {
            label: "Agent usage pricing",
            formula: expect.stringContaining("underlying model"),
          },
        },
      ],
    });
  });

  it("keeps music generation distinct and embedding dimensions structured", async () => {
    const models = await geminiCatalog();
    const music = models.find((item) => item.model_id === "lyria-test");
    const embedding = models.find((item) => item.model_id === "embedding-test");
    const gemma = models.find((item) => item.model_id === "gemma-4-31b-it");
    expect({
      music: {
        tasks: music?.tasks,
        modalities: music?.modalities,
        releaseStage: music?.release_stage,
        rate: music?.price_facts[0],
      },
      embedding: {
        tasks: embedding?.tasks,
        limits: embedding?.limits,
        releaseStage: embedding?.release_stage,
        paidUnits: embedding?.price_facts
          .filter((rate) => rate.conditions.account_eligibility === "paid_tier")
          .map((rate) => rate.unit),
        freePrices: embedding?.price_facts
          .filter((rate) => rate.conditions.account_eligibility === "free_tier")
          .map((rate) => rate.price),
      },
      gemma: {
        context: gemma?.limits.context_tokens,
        pricing: gemma?.pricing_state,
        rates: gemma?.price_facts.length,
        prices: [...new Set(gemma?.price_facts.map((rate) => rate.price))],
      },
    }).toEqual({
      music: {
        tasks: ["audio_generation"],
        modalities: { input: ["text", "image"], output: ["text", "audio"] },
        releaseStage: "experimental",
        rate: expect.objectContaining({
          meter: "output_audio",
          price: "0.50",
          unit: "request",
          conditions: {
            account_eligibility: "paid_tier",
            operation: "music_generation",
          },
        }),
      },
      embedding: {
        tasks: ["embeddings"],
        limits: {
          context_tokens: 8192,
          max_input_tokens: 8192,
          embedding_dimension_range: { min: 128, max: 3072 },
          recommended_embedding_dimensions: [768, 1536],
        },
        releaseStage: "stable",
        paidUnits: ["million_tokens", "million_tokens"],
        freePrices: ["0", "0"],
      },
      gemma: {
        context: 256_000,
        pricing: "numeric",
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
      tasks: model?.tasks,
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
      tasks: ["text_generation"],
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
      embeddingOperations: embedding?.tasks,
      embeddingBatch: embedding?.capabilities.batch,
      embeddingEndpoints: endpoints(embedding),
      liveOperations: live?.tasks,
      liveStreaming: live?.capabilities.streaming,
      liveEndpoints: endpoints(live),
      futureOperations: future?.tasks,
      futureStreaming: future?.capabilities.streaming,
      futureBatch: future?.capabilities.batch,
      futureEndpoints: endpoints(future),
    }).toEqual({
      embeddingOperations: ["embeddings"],
      embeddingBatch: true,
      embeddingEndpoints: [
        "embedContent /v1beta/models/embedding-test:embedContent",
        "batchEmbedContents /v1beta/models/embedding-test:batchEmbedContents",
        "asyncBatchEmbedContent /v1beta/models/embedding-test:asyncBatchEmbedContent",
      ],
      liveOperations: ["speech_to_speech"],
      liveStreaming: true,
      liveEndpoints: [
        "bidiGenerateContent wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent",
      ],
      futureOperations: [],
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

  it("rejects pricing rows that cannot be bound or normalized", async () => {
    const pricing = await fixture("gemini/pricing.html");
    await expect(
      geminiCatalog({
        "pricing.html": pricing.replace("gemini-test-preview", "gemini-unpublished"),
      }),
    ).rejects.toThrow("pricing references unknown model");
    await expect(
      geminiCatalog({
        "pricing.html": pricing.replace("Input price</td>", "Mystery price</td>"),
      }),
    ).rejects.toThrow("pricing row changed");
    await expect(
      geminiCatalog({
        "pricing.html": pricing.replace("Free Tier</th>", "Trial Tier</th>"),
      }),
    ).rejects.toThrow("pricing table headers changed");
  });
});

describe("Vertex AI adapters", () => {
  it("joins exact card IDs with lifecycle, capabilities, and multimodal pricing", async () => {
    const models = await vertexCatalog();
    const current = models.find((model) => model.model_id === "gemini-test");
    const embedding = models.find((model) => model.model_id === "gemini-embedding-test");
    const retired = models.find((model) => model.model_id === "gemini-old");
    expect({
      name: current?.name,
      tasks: current?.tasks,
      modalities: current?.modalities,
      limits: current?.limits,
      capabilities: current?.capabilities,
      release: current?.release_date,
      status: current?.status,
      retiredAt: current?.retired_at,
      families: current?.service_families,
      endpoints: endpoints(current),
      meters: current?.price_facts.map((rate) => rate.meter),
      contextRanges: current?.price_facts
        .filter((rate) => rate.meter === "input_text")
        .map(({ conditions }) => [conditions.context_min_tokens, conditions.context_max_tokens]),
      storageUnit: current?.price_facts.find((rate) => rate.meter === "cache_storage")?.unit,
      embedding: {
        release: embedding?.release_date,
        limits: embedding?.limits,
        endpoints: endpoints(embedding),
        availability: embedding?.availability,
      },
      retired: {
        status: retired?.status,
        release: retired?.release_date,
        retiredAt: retired?.retired_at,
        replacement: retired?.replacement_model_ids,
      },
    }).toEqual({
      name: "Gemini Test",
      tasks: ["text_generation", "image_generation"],
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
      contextRanges: [
        [undefined, 200_000],
        [200_001, undefined],
      ],
      storageUnit: "million_tokens_per_hour",
      embedding: {
        release: "2025-11-13",
        limits: {
          context_tokens: 2_048,
          max_input_tokens: 2_048,
        },
        endpoints: [
          "predict /v1/projects/{project}/locations/{location}/publishers/google/models/{model}:predict",
        ],
        availability: [{ region: "us-central1", deployment_type: "managed_api" }],
      },
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
      partner: [
        partner[0]?.service_families,
        endpoints(partner[0]),
        partner[0]?.limits,
        partner[0]?.availability,
      ],
      open: [
        open.find((model) => model.model_id === "glm-test-maas")?.service_families,
        endpoints(open.find((model) => model.model_id === "glm-test-maas")),
        open.find((model) => model.model_id === "glm-test-maas")?.limits,
      ],
      embedding: {
        limits: open.find((model) => model.model_id === "embedding-test-maas")?.limits,
        release: open.find((model) => model.model_id === "embedding-test-maas")?.release_date,
        endpoints: endpoints(open.find((model) => model.model_id === "embedding-test-maas")),
      },
    }).toEqual({
      partner: [
        ["publishers/anthropic"],
        [
          "rawPredict /v1/projects/{project}/locations/{location}/publishers/anthropic/models/{model}:rawPredict",
          "streamRawPredict /v1/projects/{project}/locations/{location}/publishers/anthropic/models/{model}:streamRawPredict",
        ],
        {
          context_tokens: 200_000,
          max_input_tokens: 200_000,
          max_output_tokens: 64_000,
        },
        [
          { region: "us", deployment_type: "managed_api" },
          { region: "global", deployment_type: "managed_api" },
        ],
      ],
      open: [
        ["endpoints/openapi/zai-org"],
        [
          "Chat Completions /v1/projects/{project}/locations/{location}/endpoints/openapi/chat/completions",
        ],
        {
          context_tokens: 262_144,
          max_input_tokens: 262_144,
          max_output_tokens: 262_144,
        },
      ],
      embedding: {
        limits: {
          context_tokens: 512,
          max_input_tokens: 512,
        },
        release: "2025-11-13",
        endpoints: [
          "predict /v1/projects/{project}/locations/{location}/publishers/google/models/{model}:predict",
        ],
      },
    });
  });

  it("uses only unambiguous model identities from the official catalog index", async () => {
    const index = `
      <main><div class="devsite-article-body"><table>
        <tr><th>Model name</th><th>Modality</th><th>Description</th><th>Quickstart</th></tr>
        <tr>
          <td>Future Model</td><td>Language, Vision</td><td>Future description.</td>
          <td><a href="https://console.cloud.google.com/agent-platform/publishers/future/model-garden/future-model">Model card</a></td>
        </tr>
        <tr>
          <td>Wrong Small</td><td>Language</td><td>Wrong link.</td>
          <td><a href="https://console.cloud.google.com/agent-platform/publishers/future/model-garden/shared-model">Model card</a></td>
        </tr>
        <tr>
          <td>Wrong Large</td><td>Language</td><td>Same wrong link.</td>
          <td><a href="https://console.cloud.google.com/agent-platform/publishers/future/model-garden/shared-model">Model card</a></td>
        </tr>
      </table></div></main>`;
    const models = await vertexModels(
      2,
      [
        [
          "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/maas/call-open-model-apis",
          "routes.html",
        ],
      ],
      {},
      0,
      0,
      index,
    );
    expect(
      models.map(({ model_id, name, description, service_families, modalities, tasks }) => ({
        model_id,
        name,
        description,
        service_families,
        modalities,
        tasks,
      })),
    ).toEqual([
      {
        model_id: "future-model",
        name: "Future Model",
        description: "Future description.",
        service_families: ["publishers/future"],
        modalities: { input: ["text", "image"], output: ["text"] },
        tasks: ["text_generation"],
      },
    ]);
  });

  it("keeps publisher evidence scoped to each card on shared pages", async () => {
    const models = await vertexModels(1, [
      [
        "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/deprecations/partner-models",
        "partner-deprecations.html",
      ],
      [
        "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/claude/use-claude",
        "routes.html",
      ],
      [
        "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/grok/responses",
        "routes.html",
      ],
      [
        "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/llama/use-llama",
        "routes.html",
      ],
    ]);
    expect(models.map(({ model_id, service_families }) => [model_id, service_families])).toEqual([
      ["claude-old", ["publishers/anthropic"]],
      ["jamba-old", undefined],
    ]);
  });

  it("does not count same-depth guide pages as model-card coverage", async () => {
    await expect(
      vertexModels(
        1,
        [
          [
            "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/claude/test",
            "partner.html",
          ],
          [
            "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/claude/prompt-caching",
            "routes.html",
          ],
          [
            "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/claude/use-claude",
            "routes.html",
          ],
          [
            "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/grok/responses",
            "routes.html",
          ],
          [
            "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/llama/use-llama",
            "routes.html",
          ],
        ],
        {},
        0,
        2,
      ),
    ).rejects.toThrow("model-card document count");
  });

  it("normalizes shared tiers, inline units, and only exact base-rate alternatives", async () => {
    const pricing = `
      <main><div class="devsite-article-body">
        <h3>Flex/Batch</h3>
        <table>
          <tr>
            <th>Model</th><th>Type</th>
            <th>Price (/1M tokens) &lt;= 200K input tokens with Flex/Batch</th>
            <th>Price (/1M tokens) &lt;= 200K cached input tokens with Flex/Batch</th>
          </tr>
          <tr><td>Gemini Test</td></tr>
          <tr>
            <td>Input (text)</td><td>$0.5</td>
            <td>Batch: $0.05 (Global)<br>Flex: $0.06 (Global)<br>$0.055 (Non-global)</td>
          </tr>
        </table>
        <h3>Gemini Omni</h3>
        <table>
          <tr><th>Model</th><th>Type</th><th>Price</th></tr>
          <tr><td>Gemini Test</td></tr>
          <tr><td>Video Output</td><td>$0.10 / second ($17.50 / 1M video output tokens)</td></tr>
        </table>
        <h3>Managed open models</h3>
        <table>
          <tr><th>Model</th><th>Pricing</th></tr>
          <tr>
            <td>Gemini Test</td>
            <td>Input: $0.3 / million tokens (or $0.003/page) Output: $1.2 / million tokens</td>
          </tr>
        </table>
      </div></main>`;
    const model = (await vertexCatalog({ "pricing.html": pricing })).find(
      ({ model_id }) => model_id === "gemini-test",
    );
    expect(
      model?.price_facts
        .filter(({ meter }) => meter === "input_text")
        .map(({ price, conditions }) => [
          conditions.service_tier,
          conditions.deployment_scope,
          price,
        ])
        .sort(),
    ).toEqual([
      [undefined, undefined, "0.3"],
      ["batch", undefined, "0.5"],
      ["flex", undefined, "0.5"],
    ]);
    expect(
      model?.price_facts
        .filter(({ meter }) => meter === "cache_read_text")
        .map(({ price, conditions }) => [
          conditions.service_tier,
          conditions.deployment_scope,
          price,
        ])
        .sort(),
    ).toEqual([
      ["batch", "global", "0.05"],
      ["batch", "non-global", "0.055"],
      ["flex", "global", "0.06"],
      ["flex", "non-global", "0.055"],
    ]);
    expect(
      model?.price_facts
        .filter(({ meter }) => meter === "output_video")
        .map(({ price, unit }) => [price, unit])
        .sort(),
    ).toEqual([
      ["0.10", "second"],
      ["17.50", "million_tokens"],
    ]);
    expect(model?.raw_price_facts).toEqual([
      expect.objectContaining({
        impact: "base_price",
        reason: "unknown_applicability",
        raw: expect.objectContaining({ fragment: expect.stringContaining("$0.003/page") }),
      }),
    ]);
  });

  it("applies an exact family price to every ID on the same model card", async () => {
    const card = `
      <main><div class="devsite-article-body">
        <h1>Veo Test</h1>
        <table>
          <tr><th>Model ID</th><td><code>veo-test-preview</code></td></tr>
          <tr><th>Modalities</th><td>Inputs: Text Outputs: Video</td></tr>
        </table>
        <table>
          <tr><th>Model ID</th><td><code>veo-test-001</code></td></tr>
          <tr><th>Modalities</th><td>Inputs: Text Outputs: Video</td></tr>
        </table>
      </div></main>`;
    const pricing = `
      <main><div class="devsite-article-body">
        <h3>Veo</h3>
        <table>
          <tr>
            <th>Model</th><th>Feature</th><th>Description</th><th>Input</th><th>Output</th>
            <th>Output Resolution</th><th>Price</th>
          </tr>
          <tr>
            <td>Veo Test</td><td>Video generation</td><td>Generate video</td><td>Text</td>
            <td>Video</td><td>720p</td><td>$0.20/second</td>
          </tr>
        </table>
      </div></main>`;
    const models = await vertexCatalog({ "model.html": card, "pricing.html": pricing });
    expect(
      models
        .filter(({ model_id }) => model_id.startsWith("veo-test-"))
        .map(({ model_id, price_facts }) => [
          model_id,
          price_facts.find(({ meter }) => meter === "video_generation")?.price,
        ]),
    ).toEqual([
      ["veo-test-001", "0.20"],
      ["veo-test-preview", "0.20"],
    ]);
  });

  it("parses labeled lifecycle dates, quota limits, and endpoint replacements", async () => {
    const card = `
      <main><div class="devsite-article-body">
        <h1>Retired Test</h1>
        <table>
          <tr><th>Discontinued endpoints</th><th>Recommended endpoint migration</th></tr>
          <tr><td><code>retired-test</code></td><td><code>replacement-test</code></td></tr>
        </table>
        <table>
          <tr><th>Model ID</th><td><code>retired-test</code></td></tr>
          <tr><th>Modalities</th><td>Inputs: Text Outputs: Text</td></tr>
          <tr><th>Quota limits</th><td>Context length: 128,000 Max output: 8,192</td></tr>
          <tr>
            <th>Versions</th>
            <td>
              <code>retired-test</code>
              Launch stage: GA Release date: Nov 13, 2025 Discontinuation date: Jun 30, 2026
            </td>
          </tr>
        </table>
      </div></main>`;
    const model = (await vertexCatalog({ "model.html": card })).find(
      ({ model_id }) => model_id === "retired-test",
    );
    expect(model).toMatchObject({
      release_date: "2025-11-13",
      retired_at: "2026-06-30",
      status: "retired",
      limits: {
        context_tokens: 128_000,
        max_input_tokens: 128_000,
        max_output_tokens: 8_192,
      },
      replacement_model_ids: ["replacement-test"],
    });
  });

  it("preserves size discriminators when joining pricing labels", async () => {
    const models = await vertexModels(2, [
      [
        "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/maas/openai/gpt-oss",
        "open-sizes.html",
      ],
      [
        "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/maas/call-open-model-apis",
        "routes.html",
      ],
      [
        "https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing",
        "pricing-sizes.html",
      ],
    ]);
    expect(
      models.map(({ model_id, price_facts }) => [
        model_id,
        price_facts.find(({ meter }) => meter === "input_text")?.price,
      ]),
    ).toEqual([
      ["gpt-oss-120b-maas", "0.09"],
      ["gpt-oss-20b-maas", "0.07"],
    ]);
  });

  it("fails closed when reviewed current-model pricing coverage regresses", async () => {
    const pricing = (await fixture("vertex/pricing.html")).replaceAll(
      "Gemini Test",
      "Unpublished Model",
    );
    await expect(vertexCatalog({ "pricing.html": pricing }, 1)).rejects.toThrow(
      "pricing coverage fell below",
    );
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
      stage: fable?.release_stage,
      limits: fable?.limits,
      input: fable?.price_facts.find(
        (rate) => rate.meter === "input_text" && rate.conditions.inference_geo === undefined,
      )?.price,
      usInput: fable?.price_facts.find(
        (rate) => rate.meter === "input_text" && rate.conditions.inference_geo === "us",
      )?.price,
      batchCache: fable?.price_facts.find(
        (rate) =>
          rate.meter === "cache_read_text" &&
          rate.conditions.service_tier === "batch" &&
          rate.conditions.inference_geo === undefined,
      )?.price,
      sonnetRates: sonnet?.price_facts.length,
      previewStatus: preview?.status,
      previewReplacement: preview?.replacement_model_ids,
    }).toEqual({
      count: 7,
      name: "Claude Fable 5",
      release: "2026-06-09",
      stage: "stable",
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

  it("publishes Messages for callable models and batches only for active models", async () => {
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

  it("derives current capabilities from public compatibility contracts", async () => {
    const models = await anthropicCatalog();
    const capabilities = (id: string) =>
      models.find((model) => model.model_id === id)?.capabilities;
    expect(capabilities("claude-fable-5")).toEqual({
      reasoning: true,
      tool_call: true,
      structured_output: true,
      streaming: true,
      batch: true,
      prompt_cache: true,
      fine_tuning: false,
      citations: true,
      code_execution: true,
      context_management: true,
      effort_control: true,
      computer_use: false,
    });
    expect(models.find(({ model_id }) => model_id === "claude-fable-5")?.modalities).toEqual({
      input: ["text", "image", "pdf"],
      output: ["text"],
    });
    expect(capabilities("claude-opus-4-1-20250805")).toMatchObject({
      structured_output: false,
      streaming: true,
      batch: false,
      fine_tuning: false,
      code_execution: true,
      context_management: true,
      effort_control: false,
      computer_use: true,
    });
  });

  it("lets scoped inventory fill gaps without overriding global facts", () => {
    const value = manifest("anthropic");
    const catalogSource = value.sources[0];
    const inventorySource = value.sources.find(({ id }) => id === "anthropic-api");
    if (catalogSource === undefined || inventorySource === undefined)
      throw new Error("Missing Anthropic sources");
    const publicBase = baseModel({
      providerId: "anthropic",
      id: "claude-example",
      name: "Public name",
      sourceId: catalogSource.id,
      observedAt,
    });
    const publicModel = {
      ...publicBase,
      capabilities: {
        ...publicBase.capabilities,
        reasoning: true,
      },
      limits: { context_tokens: 1_000_000 },
      release_date: "2026-06-09",
    };
    const inventoryModel = {
      ...baseModel({
        providerId: "anthropic",
        id: "claude-example",
        name: "Inventory name",
        sourceId: inventorySource.id,
        observedAt,
      }),
      capabilities: {
        ...publicModel.capabilities,
        reasoning: false,
        tool_call: false,
      },
      limits: { context_tokens: 500_000, max_input_tokens: 500_000 },
      release_date: "2026-06-07",
    };
    const merged = applyGroups(
      applyGroups([], [{ source: catalogSource, models: [publicModel] }], true),
      [{ source: inventorySource, models: [inventoryModel] }],
      false,
    )[0];
    expect(merged).toMatchObject({
      name: "Public name",
      capabilities: { reasoning: true, tool_call: false },
      limits: { context_tokens: 1_000_000, max_input_tokens: 500_000 },
      release_date: "2026-06-09",
      source_refs: ["anthropic-models", "anthropic-api"],
    });
  });

  it("parses labeled lifecycle notes for models omitted from the status table", async () => {
    const lifecycle = (await fixture("anthropic/lifecycle.md")).replace(
      /\n\[Claude Mythos Preview].*\n/,
      "\n",
    );
    const preview = (await anthropicCatalog(undefined, undefined, lifecycle)).find(
      ({ model_id }) => model_id === "claude-mythos-preview",
    );
    expect(preview).toMatchObject({
      status: "deprecated",
      replacement_model_ids: ["claude-mythos-5"],
    });
    expect(preview?.retired_at).toBeUndefined();
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
      embedding_type: embedding?.tasks,
      embedding_context: embedding?.limits.context_tokens,
      embedding_dimensions: embedding?.limits.embedding_dimensions,
      image_operations: image?.tasks,
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
      image_operations: ["text_generation", "image_generation"],
      endpoints: [
        {
          name: "Invocations",
          path: "/serving-endpoints/databricks-gpt-5-6-sol/invocations",
        },
      ],
    });
    expect(open?.price_facts.find((rate) => rate.meter === "cache_read_text")).toMatchObject({
      price: "3.714",
      unit: "million_tokens",
    });
    expect(open?.price_facts.some((rate) => rate.meter === "provisioned_throughput")).toBe(false);
    expect(
      models
        .find((model) => model.model_id === "databricks-qwen3-embedding-0-6b")
        ?.price_facts.filter((rate) => rate.meter === "provisioned_throughput")
        .map((rate) => [rate.conditions.capacity, rate.price]),
    ).toEqual([
      ["entry", "25"],
      ["scaling", "25"],
    ]);
    expect(
      sol?.price_facts.find(
        (rate) =>
          rate.meter === "input_text" &&
          rate.conditions.endpoint === "global" &&
          rate.conditions.context_tier === "short",
      ),
    ).toMatchObject({ price: "71.429", currency: "DBU", unit: "million_tokens" });
    expect(
      sol?.price_facts.find(
        (rate) => rate.meter === "input_text" && rate.conditions.context_min_tokens === 200_001,
      )?.price,
    ).toBe("142.857");
  });

  it("retains promotional and future standard rates as dated conditions", async () => {
    const models = await databricksCatalog();
    const gemini = models.find((model) => model.model_id === "databricks-gemini-3-5-flash");
    const sonnet = models.find((model) => model.model_id === "databricks-claude-sonnet-5");
    expect(
      gemini?.price_facts.find(
        (rate) => rate.meter === "input_text" && rate.conditions.promotion === true,
      ),
    ).toMatchObject({
      price: "21.4288",
      derived: true,
      conditions: { effective_until: "2027-01-31" },
    });
    expect(
      gemini?.price_facts.find(
        (rate) => rate.meter === "input_text" && rate.conditions.effective_from !== undefined,
      )?.conditions.effective_from,
    ).toBe("2027-02-01");
    expect(gemini?.price_facts.some((rate) => rate.meter === "batch_inference")).toBe(false);
    expect(
      sonnet?.price_facts.find(
        (rate) => rate.meter === "input_text" && rate.conditions.effective_from === "2026-09-01",
      ),
    ).toMatchObject({ price: "42.857", derived: true });
    expect(
      sonnet?.price_facts.find(
        (rate) => rate.meter === "input_text" && rate.conditions.promotion === true,
      )?.conditions.effective_until,
    ).toBe("2026-08-31");
  });

  it("derives Databricks promotions from published notes", async () => {
    const pricing = (await fixture("databricks/pricing-partner.html"))
      .replaceAll("20%", "25%")
      .replace("Jan 31, 2027", "Feb 28, 2027");
    const gemini = (await databricksCatalog({ "pricing-partner.html": pricing })).find(
      (model) => model.model_id === "databricks-gemini-3-5-flash",
    );

    expect(
      gemini?.price_facts.find(
        (rate) => rate.meter === "input_text" && rate.conditions.promotion === true,
      ),
    ).toMatchObject({
      price: "20.0895",
      conditions: { effective_until: "2027-02-28" },
    });
    expect(
      gemini?.price_facts.find(
        (rate) => rate.meter === "input_text" && rate.conditions.effective_from !== undefined,
      )?.conditions.effective_from,
    ).toBe("2027-03-01");
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
    await expect(
      databricksCatalog({
        "pricing-open.html": pricing.replace("<td>20.000</td>", "<td>$20</td>"),
      }),
    ).rejects.toThrow("invalid DBU price");
    await expect(
      databricksCatalog({
        "pricing-open.html": pricing.replace(
          "</tbody>",
          `<tr>
            <td>GTE</td>
            <td>2.000</td>
            <td>n/a</td>
            <td>n/a</td>
            <td>20.000</td>
            <td>20.000</td>
          </tr></tbody>`,
        ),
      }),
    ).rejects.toThrow("conflicting prices");
    const partner = await fixture("databricks/pricing-partner.html");
    await expect(
      databricksCatalog({
        "pricing-partner.html": partner.replace("promotional discount", "temporary discount"),
      }),
    ).rejects.toThrow("pricing notes omitted starred models");
    await expect(
      databricksCatalog({
        "pricing-open.html": pricing
          .replace("Qwen 3 0.6B Embedding", "Future Embed")
          .replace("GTE", "Future GTE")
          .replace("GLM-5.2", "Future GLM"),
      }),
    ).rejects.toThrow("pricing coverage");
  });

  it("parses workspace endpoints only as a scoped inventory", async () => {
    const models = await parsed("databricks", "databricks/api.json", "databricks-api");
    expect(models.map((model) => [model.model_id, model.tasks[0], model.scope])).toEqual([
      ["databricks-gpt-5-6-sol", "text_generation", "runtime_observation"],
      ["databricks-qwen3-embedding-0-6b", "embeddings", "runtime_observation"],
      ["private-endpoint", "text_generation", "runtime_observation"],
    ]);
  });
});

describe("xAI adapter", () => {
  it("validates voice service configuration without publishing internal service names", async () => {
    const models = await xaiCatalog("xai/models-voice-services.txt");
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
      "grok-4.3",
      "grok-4.5",
      "grok-build-0.1",
      "grok-imagine-image-pro",
      "grok-imagine-image-quality",
      "grok-imagine-video-1.5",
      "grok-imagine-video",
      "grok-voice-think-fast-1.0",
      "grok-voice-think-fast-2.0",
    ]);
    expect(models.find(({ model_id }) => model_id === "grok-4.5")).toMatchObject({
      version: "1.0",
      uid: "xai/grok-4.5@1.0",
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
        batch: false,
        prompt_cache: true,
        effort_control: true,
      },
    });
    expect(models.find(({ model_id }) => model_id === "grok-4.20-multi-agent-0309")).toMatchObject({
      version: "1.0",
      tasks: ["text_generation"],
      api_endpoints: [{ name: "Responses", path: "/v1/responses" }],
      release_date: "2026-03",
      status: "active",
      release_stage: "preview",
      capabilities: { citations: true, code_execution: true },
    });
    expect(models.find(({ model_id }) => model_id === "grok-imagine-image-quality")).toMatchObject({
      name: "Grok Imagine API",
      api_endpoints: [
        { name: "Image Edits", path: "/v1/images/edits" },
        { name: "Image Generations", path: "/v1/images/generations" },
      ],
      updated_date: "2026-04-03",
      capabilities: { streaming: false, batch: true },
      price_facts: expect.arrayContaining([
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
      version: "1.0",
      aliases: ["grok-voice-latest"],
      tasks: ["text_generation", "speech_to_speech"],
      api_endpoints: [{ name: "Realtime", path: "/v1/realtime" }],
      release_date: "2026-04",
      capabilities: {
        reasoning: true,
        tool_call: true,
        streaming: true,
        effort_control: true,
      },
      price_facts: expect.arrayContaining([
        expect.objectContaining({ meter: "input_audio", price: "0.05", unit: "minute" }),
        expect.objectContaining({ meter: "input_text", price: "0.004", unit: "request" }),
      ]),
    });
    expect(models.find(({ model_id }) => model_id === "grok-voice-think-fast-2.0")).toMatchObject({
      version: "1.0",
      capabilities: { reasoning: true, effort_control: true },
      price_facts: expect.arrayContaining([
        expect.objectContaining({ meter: "input_audio", price: "0.08", unit: "minute" }),
      ]),
    });
    expect(models.find(({ model_id }) => model_id === "grok-3")).toMatchObject({
      status: "legacy",
      deprecated_at: "2026-05-15",
      tasks: ["text_generation"],
      replacement_model_ids: ["grok-4.3"],
      pricing_state: "numeric",
      price_facts: expect.arrayContaining([
        expect.objectContaining({
          meter: "input_text",
          price: "1.25",
          conditions: expect.objectContaining({ effective_from: "2026-05-15" }),
          derived: true,
          derivation: expect.stringContaining("Redirects to grok-4.3"),
        }),
      ]),
    });
    expect(models.find(({ model_id }) => model_id === "grok-3")?.retired_at).toBeUndefined();
    expect(models.find(({ model_id }) => model_id === "grok-3")?.api_endpoints).toBeUndefined();
    expect(models.find(({ model_id }) => model_id === "grok-imagine-image-pro")).toMatchObject({
      status: "legacy",
      tasks: ["image_generation"],
      replacement_model_ids: ["grok-imagine-image-quality"],
      pricing_state: "numeric",
    });
  });

  it("keeps standard, long-context, batch, priority, media, and tool rates distinct", async () => {
    const models = await xaiCatalog();
    const multiAgent = models.find(({ model_id }) => model_id === "grok-4.20-multi-agent-0309");
    const build = models.find(({ model_id }) => model_id === "grok-build-0.1");
    expect(
      multiAgent?.price_facts.find(
        ({ meter, conditions }) => meter === "input_text" && conditions.service_tier === "batch",
      ),
    ).toMatchObject({ price: "1", derived: true });
    expect(
      multiAgent?.price_facts.find(
        ({ meter, conditions }) =>
          meter === "output_text" &&
          conditions.service_tier === "priority" &&
          conditions.context_min_tokens === 200_000,
      ),
    ).toMatchObject({ price: "10", derived: true });
    expect(
      multiAgent?.price_facts.find(
        ({ meter, conditions }) =>
          meter === "tool_call" && conditions.operation === "collections_search",
      ),
    ).toMatchObject({ price: "2.5", unit: "thousand_requests", derived: false });
    expect(build?.price_facts.some(({ conditions }) => conditions.service_tier === "batch")).toBe(
      false,
    );

    const changedPriority = await xaiCatalog(
      "xai/models.txt",
      (body) => body,
      (body) => body.replaceAll("2x", "3x"),
    );
    expect(
      changedPriority
        .find(({ model_id }) => model_id === "grok-4.20-multi-agent-0309")
        ?.price_facts.find(
          ({ meter, conditions }) =>
            meter === "output_text" &&
            conditions.service_tier === "priority" &&
            conditions.context_min_tokens === 200_000,
        ),
    ).toMatchObject({ price: "15", derived: true });
  });

  it("derives endpoint bindings from reviewed request examples and fails closed on drift", async () => {
    const reassigned = await xaiCatalog(
      "xai/models.txt",
      (body) => body,
      (body) =>
        body.replace(
          `curl https://api.x.ai/v1/responses -d '{"model": "grok-4.5"}'`,
          `curl https://api.x.ai/v1/responses -d '{"model": "grok-4.3"}'`,
        ),
    );
    expect(reassigned.find(({ model_id }) => model_id === "grok-4.3")?.api_endpoints).toEqual([
      { name: "Responses", path: "/v1/responses" },
    ]);
    expect(reassigned.find(({ model_id }) => model_id === "grok-4.5")?.api_endpoints).toEqual([
      { name: "Chat Completions", path: "/v1/chat/completions" },
    ]);
    await expect(
      xaiCatalog(
        "xai/models.txt",
        (body) => body,
        (body) => body.replace("https://api.x.ai/v1/images/edits", "/v1/images/edits"),
      ),
    ).rejects.toThrow("omitted a model");
    await expect(
      xaiCatalog("xai/models.txt", (body) =>
        body.replace('"languageModels":[', '"futureModels":[],"languageModels":['),
      ),
    ).rejects.toThrow("added categories: futureModels");
    await expect(
      xaiCatalog(
        "xai/models.txt",
        (body) => body,
        (body) => body.replace("- grok-4.3", "- future-model"),
      ),
    ).rejects.toThrow("batch pricing model future-model did not resolve");
    await expect(
      xaiCatalog("xai/models-voice-services.txt", (body) =>
        body.replace('"aliases":["grok-voice-latest"]', '"aliases":[]'),
      ),
    ).rejects.toThrow("structured and documented voice aliases differ");
  });

  it("parses every authenticated inventory without treating it as global presence", async () => {
    const language = await parsed("xai", "xai/language-api.json", "xai-language-api");
    const image = await parsed("xai", "xai/image-api.json", "xai-image-api");
    const video = await parsed("xai", "xai/video-api.json", "xai-video-api");
    expect(language[0]).toMatchObject({
      model_id: "grok-4.5",
      version: "1.0",
      uid: "xai/grok-4.5@1.0",
      tasks: ["text_generation"],
      modalities: { input: ["text", "image"], output: ["text"] },
      scope: "runtime_observation",
      source_refs: ["xai-language-api"],
    });
    expect(image[0]).toMatchObject({
      version: "1.0",
      tasks: ["image_generation"],
      scope: "runtime_observation",
    });
    expect(video[0]).toMatchObject({
      version: "1.0",
      tasks: ["video_generation"],
      scope: "runtime_observation",
    });
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
  it("uses unique catalog identities and provider-native units for Bedrock prices", async () => {
    const models = await parsed("amazon-bedrock", "document/bedrock-pricing-identity.json");
    const nova = models.find(
      ({ model_id }) => model_id === "amazon.nova-2-multimodal-embeddings-v1:0",
    );
    const rerank = models.find(({ model_id }) => model_id === "cohere.rerank-v3-5:0");

    expect(nova?.price_facts).toContainEqual(
      expect.objectContaining({
        meter: "input_text",
        price: "0.135",
        unit: "million_tokens",
        raw_unit: "1K tokens",
      }),
    );
    expect(
      nova?.price_facts
        .filter(
          ({ meter, conditions }) => meter === "input_image" && conditions.operation !== undefined,
        )
        .map(({ price, conditions }) => ({ price, operation: conditions.operation })),
    ).toEqual([
      { price: "0.0004800000", operation: "document_image" },
      { price: "0.0000300000", operation: "standard_image" },
    ]);
    expect(nova?.price_facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          meter: "input_image",
          price: "0.0001000000",
          unit: "image",
          raw_unit: "Input Images",
        }),
        expect.objectContaining({
          meter: "embedding",
          price: "0.0000700000",
          unit: "request",
          raw_unit: "Text Requests",
          conditions: expect.objectContaining({ modality: "text" }),
        }),
        expect.objectContaining({
          meter: "input_text",
          price: "0.0000000200",
          unit: "token",
          raw_unit: "Embeddings",
          derived: true,
        }),
        expect.objectContaining({
          meter: "provisioned_throughput",
          price: "5.5560000000",
          unit: "unit_hour",
          raw_unit: "hour",
        }),
        expect.objectContaining({
          meter: "provisioned_throughput",
          price: "0.3000000000",
          unit: "thousand_tokens_per_minute_hour",
          raw_unit: "1M TPM Hour",
          derived: true,
        }),
        expect.objectContaining({
          meter: "tool_call",
          price: "0.0300000000",
          unit: "request",
          conditions: expect.objectContaining({ operation: "grounding" }),
        }),
      ]),
    );
    expect(rerank?.price_facts).toContainEqual(
      expect.objectContaining({
        meter: "rerank_request",
        price: "0.0020000000",
        unit: "search_unit",
        raw_unit: "Search Units",
      }),
    );
  });

  it("fails closed when Bedrock model-price interpretation coverage regresses", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Bedrock source");
    const body = (await fixture("document/bedrock-pricing-identity.json")).replace(
      '\\"unit\\":\\"Search Units\\"',
      '\\"unit\\":\\"Unknown Units\\"',
    );

    expect(() => parseSource({ provider: provider(value), source, body, observedAt })).toThrow(
      "interpretation coverage incomplete",
    );
  });

  it("does not guess when a Bedrock price family matches multiple model cards", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Bedrock source");
    const bundle = z
      .object({
        index: z.object({ url: z.string(), body: z.string() }),
        documents: z.array(z.object({ url: z.string(), body: z.string() })),
      })
      .parse(JSON.parse(await fixture("document/bedrock-pricing-identity.json")));
    const nova = bundle.documents.find((document) =>
      document.url.endsWith("model-card-amazon-amazon-nova-multimodal-embeddings.md"),
    );
    if (nova === undefined) throw new Error("Missing Nova fixture card");
    bundle.documents.push({
      url: "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-amazon-nova-multimodal-embeddings-preview.md",
      body: nova.body.replace(
        "amazon.nova-2-multimodal-embeddings-v1:0",
        "amazon.nova-3-multimodal-embeddings-v1:0",
      ),
    });

    expect(() =>
      parseSource({
        provider: provider(value),
        source,
        body: JSON.stringify(bundle),
        observedAt,
      }),
    ).toThrow("unbound: Amazon Bedrock");
  });

  it("keeps embedding input dimensions as distinct commercial meters", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Bedrock source");
    const models = await parsed("amazon-bedrock", "document/bedrock-embedding-pricing.json");
    const titan = models.find(({ model_id }) => model_id === "amazon.titan-embed-image-v1");
    if (titan === undefined) throw new Error("Missing Titan embedding fixture model");

    expect(titan.price_facts.every(({ conditions }) => conditions.modality === undefined)).toBe(
      true,
    );
    expect(
      titan.price_facts.map(({ meter, price, unit, conditions }) => {
        const { region, endpoint, deployment_scope, service_tier } = conditions;
        return {
          meter,
          price,
          unit,
          conditions: { region, endpoint, deployment_scope, service_tier },
        };
      }),
    ).toEqual([
      {
        meter: "input_image",
        price: "0.0000400000",
        unit: "image",
        conditions: {
          region: "eu-west-3",
          endpoint: "bedrock-runtime",
          deployment_scope: "in_region",
          service_tier: "batch",
        },
      },
      {
        meter: "input_text",
        price: "0.5",
        unit: "million_tokens",
        conditions: {
          region: "eu-west-3",
          endpoint: "bedrock-runtime",
          deployment_scope: "in_region",
          service_tier: "batch",
        },
      },
      {
        meter: "provisioned_throughput",
        price: "10.7300000000",
        unit: "unit_hour",
        conditions: {
          region: "eu-west-3",
          endpoint: "bedrock-runtime",
          deployment_scope: "in_region",
          service_tier: "provisioned_no_commit",
        },
      },
    ]);

    const partition = assembleParsedProviderPricing(
      value.provider.id,
      observedAt,
      [{ source, models }],
      models,
    );
    expect(
      partition?.books[0]?.offers
        .flatMap(({ terms }) =>
          terms.map((term) => [
            term.term_key,
            term.kind === "rate" ? term.variants.length : 0,
            term.kind === "rate" ? term.raw_variants.length : 0,
          ]),
        )
        .sort(([left], [right]) => String(left).localeCompare(String(right))),
    ).toEqual([
      ["input_image", 1, 0],
      ["input_text", 1, 0],
      ["provisioned_throughput", 1, 0],
    ]);

    const marengo = models.find(({ model_id }) => model_id === "twelvelabs.marengo-embed-3-0-v1:0");
    expect(
      marengo?.price_facts.map(({ meter, unit, conditions }) => ({
        meter,
        unit,
        modality: conditions.modality,
      })),
    ).toEqual([
      { meter: "input_audio", unit: "second", modality: undefined },
      { meter: "input_video", unit: "second", modality: undefined },
    ]);
  });

  it("reconciles endpoint-equivalent Marketplace and service token prices", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Bedrock source");
    const models = await parsed("amazon-bedrock", "document/bedrock-sonnet-pricing.json");
    const sonnet = models.find(
      ({ model_id }) => model_id === "anthropic.claude-sonnet-4-20250514-v1:0",
    );
    if (sonnet === undefined) throw new Error("Missing Claude Sonnet 4 fixture model");
    expect(
      sonnet.price_facts
        .filter(({ conditions }) => conditions.service_tier !== "batch")
        .every(({ conditions }) => conditions.endpoint === undefined),
    ).toBe(true);
    expect(
      sonnet.price_facts
        .filter(({ conditions }) => conditions.service_tier === "batch")
        .every(({ conditions }) => conditions.endpoint === "bedrock-runtime"),
    ).toBe(true);

    const partition = assembleParsedProviderPricing(
      value.provider.id,
      observedAt,
      [{ source, models }],
      models,
    );
    const usage = partition?.books[0]?.offers.find(({ offer_key }) => offer_key === "usage");
    const terms = usage?.terms ?? [];
    expect(
      terms
        .map((term) => [
          term.term_key,
          term.kind === "rate" ? term.variants.length : 0,
          term.kind === "rate" ? term.raw_variants.length : 0,
        ])
        .sort(([left], [right]) => String(left).localeCompare(String(right))),
    ).toEqual([
      ["cache_read_text", 2, 0],
      ["cache_write_text", 2, 0],
      ["input_text", 3, 0],
      ["output_text", 3, 0],
    ]);

    const input = terms.find(({ term_key }) => term_key === "input_text");
    if (input?.kind !== "rate") throw new Error("Missing input price term");
    const standard = input.variants.find(({ observations }) =>
      observations.some(({ raw }) => raw.amount === "0.0030000000"),
    );
    const longContext = input.variants.find(({ observations }) =>
      observations.some(({ raw }) => raw.amount === "0.0060000000"),
    );
    const batch = input.variants.find(({ observations }) =>
      observations.some(({ raw }) => raw.amount === "1.5000000000"),
    );
    expect(usage?.states.every(({ validity }) => validity === undefined)).toBe(true);
    expect(
      terms.every(
        (term) =>
          term.kind === "raw" || term.variants.every(({ validity }) => validity === undefined),
      ),
    ).toBe(true);
    expect(standard?.observations.some(({ raw }) => raw.validity === "2026-07-01T00:00:00Z")).toBe(
      true,
    );
    expect(standard?.applicability.any_of[0]?.all_of).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "decimal_range",
          dimension: { namespace: "kmodels", value: "context_tokens" },
          upper: { value: "200000", inclusive: true },
        }),
      ]),
    );
    expect(longContext?.applicability.any_of[0]?.all_of).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "decimal_range",
          dimension: { namespace: "kmodels", value: "context_tokens" },
          lower: { value: "200001", inclusive: true },
        }),
      ]),
    );
    expect(batch?.applicability.any_of[0]?.all_of).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "categorical",
          dimension: { namespace: "kmodels", value: "service_tier" },
          values: [
            {
              namespace: "provider",
              provider_id: "amazon-bedrock",
              value: "batch",
            },
          ],
        }),
      ]),
    );
  });

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
    expect(models[0]?.tasks).toEqual(["text_generation"]);
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
    expect(runtime?.price_facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          meter: "input_text",
          price: "0.8",
          unit: "million_tokens",
          raw_validity: "2026-07-01T00:00:00Z",
          conditions: expect.objectContaining({
            region: "us-east-1",
            endpoint: "bedrock-runtime",
            service_tier: "standard",
          }),
        }),
        expect.objectContaining({
          meter: "input_text",
          price: "1.0000000000",
          conditions: expect.objectContaining({
            deployment_scope: "global_cross_region",
          }),
        }),
        expect.objectContaining({
          meter: "input_text",
          price: "0.5000000000",
          conditions: expect.objectContaining({
            endpoint: "bedrock-runtime",
            deployment_scope: "global_cross_region",
            service_tier: "batch",
          }),
        }),
        expect.objectContaining({
          meter: "output_text",
          price: "5.0000000000",
          conditions: expect.objectContaining({
            deployment_scope: "in_region",
          }),
        }),
      ]),
    );
    expect(
      runtime?.price_facts.every(({ conditions }) => conditions.effective_from === undefined),
    ).toBe(true);
    expect(mantle?.price_facts).toEqual([
      expect.objectContaining({
        meter: "output_text",
        price: "5.0000000000",
        conditions: expect.objectContaining({
          deployment_scope: "in_region",
        }),
      }),
    ]);
    expect(models[2]?.status).toBe("legacy");
    expect(models[2]?.aliases).toEqual(["us.cohere.command-r-v1:0"]);
  });

  it("preserves an explicit Mantle endpoint on service token prices", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Bedrock source");
    const input = (await fixture("document/bedrock.json"))
      .replace('\\"offerCode\\":\\"AmazonBedrock\\"', '\\"offerCode\\":\\"AmazonBedrockService\\"')
      .replace("USE1-ClaudeHaiku45-input-tokens", "USE1-ClaudeHaiku45-input-tokens-mantle");
    const models = parseSource({
      provider: provider(value),
      source,
      body: input,
      observedAt,
    });
    const mantle = models.find((model) => model.model_id === "anthropic.claude-haiku-4-5");

    expect(mantle?.price_facts).toContainEqual(
      expect.objectContaining({
        meter: "input_text",
        price: "0.8",
        conditions: expect.objectContaining({ endpoint: "bedrock-mantle" }),
      }),
    );
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

  it("merges additive evidence for an exact model ID repeated across cards", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Bedrock catalog source");
    const bundle = z
      .object({
        index: z.object({ url: z.string(), body: z.string() }),
        documents: z.array(z.object({ url: z.string(), body: z.string() })),
      })
      .parse(JSON.parse(await fixture("document/bedrock.json")));
    const card = bundle.documents.find((document) =>
      document.url.endsWith("model-card-anthropic-claude-haiku-4-5.md"),
    );
    if (card === undefined) throw new Error("Missing Bedrock fixture card");
    bundle.documents.push({
      url: "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-4-5-copy.md",
      body: card.body.replace(
        "![Yes](icon-yes.png) Messages",
        "![Yes](icon-yes.png) Chat Completions",
      ),
    });
    const model = parseSource({
      provider: provider(value),
      source,
      body: JSON.stringify(bundle),
      observedAt,
    }).find(({ model_id }) => model_id === "anthropic.claude-haiku-4-5-20251001-v1:0");
    expect(model?.api_endpoints).toEqual([
      { name: "Converse", path: "model/{modelId}/converse" },
      { name: "Invoke", path: "model/{modelId}/invoke" },
      { name: "Messages", path: "model/{modelId}/invoke" },
      { name: "Chat Completions", path: "v1/chat/completions" },
    ]);
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

  it("normalizes observed inventory enums and rejects unknown values", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources.find(({ id }) => id === "bedrock-api-us-east-1");
    if (source === undefined) throw new Error("Missing Bedrock API source");
    const body = await fixture("document/bedrock-api.json");
    const withoutName = body.replace('      "modelName": "Claude Haiku 4.5",\n', "");
    expect(
      parseSource({
        provider: provider(value),
        source,
        body: withoutName,
        observedAt,
      })[0]?.name,
    ).toBe("anthropic.claude-haiku-4-5-20251001-v1:0");
    const expanded = body
      .replace(
        '"inputModalities": ["TEXT", "IMAGE"]',
        '"inputModalities": ["TEXT", "IMAGE", "AUDIO", "SPEECH", "VIDEO"]',
      )
      .replace('"outputModalities": ["TEXT"]', '"outputModalities": ["TEXT", "SPEECH", "VIDEO"]')
      .replace(
        '"customizationsSupported": ["FINE_TUNING"]',
        '"customizationsSupported": ["PREFERENCE_FINE_TUNING"]',
      )
      .replace(
        '"inferenceTypesSupported": ["ON_DEMAND"]',
        '"inferenceTypesSupported": ["INFERENCE_PROFILE"]',
      );
    const expandedModel = parseSource({
      provider: provider(value),
      source,
      body: expanded,
      observedAt,
    })[0];
    expect({
      modalities: expandedModel?.modalities,
      fineTuning: expandedModel?.capabilities.fine_tuning,
    }).toEqual({
      modalities: {
        input: ["text", "image", "audio", "video"],
        output: ["text", "audio", "video"],
      },
      fineTuning: true,
    });
    for (const changed of [
      body.replace('"inputModalities": ["TEXT", "IMAGE"]', '"inputModalities": ["TEXT", "MUSIC"]'),
      body.replace(
        '"customizationsSupported": ["FINE_TUNING"]',
        '"customizationsSupported": ["ADAPTER_TUNING"]',
      ),
      body.replace(
        '"inferenceTypesSupported": ["ON_DEMAND"]',
        '"inferenceTypesSupported": ["SERVERLESS"]',
      ),
      body.replace('"status": "ACTIVE"', '"status": "AVAILABLE"'),
    ])
      expect(() =>
        parseSource({ provider: provider(value), source, body: changed, observedAt }),
      ).toThrow();
  });
});

describe("Vercel adapter", () => {
  it("parses the normal catalog shape", async () => {
    const model = (await vercelCatalog("vercel/normal.json"))[0];
    expect({
      limits: model?.limits,
      capabilities: {
        reasoning: model?.capabilities.reasoning,
        toolCall: model?.capabilities.tool_call,
      },
      release: model?.release_date,
      pricing: model?.pricing_state,
    }).toEqual({
      limits: { context_tokens: 32768, max_output_tokens: 4096 },
      capabilities: { reasoning: false, toolCall: false },
      release: "2025-05-29",
      pricing: "not_published",
    });
  });

  it("preserves pricing tiers and normalizes token units", async () => {
    const model = (await vercelCatalog("vercel/pricing.json"))[0];
    expect({
      id: model?.model_id,
      input: model?.price_facts.find((rate) => rate.meter === "input_text")?.price,
      output: model?.price_facts.find((rate) => rate.meter === "output_text")?.price,
      cache_rates: model?.price_facts.filter((rate) => rate.meter === "cache_read_text").length,
      pricing_state: model?.pricing_state,
    }).toEqual(await expected("vercel/expected.json"));
  });

  it("keeps service-tier and tool facts without treating realtime transport as an operation", async () => {
    const model = (await vercelCatalog("vercel/pricing.json"))[0];
    expect({
      tasks: model?.tasks,
      delivery: model?.delivery_modes,
      effort: model?.capabilities.effort_control,
      services: model?.price_facts
        .filter((rate) => rate.conditions.service_tier === "flex")
        .map((rate) => ({
          meter: rate.meter,
          min: rate.conditions.context_min_tokens,
          max: rate.conditions.context_max_tokens,
        })),
      cacheTiers: model?.price_facts
        .filter((rate) => rate.meter === "cache_read_text")
        .map((rate) => ({
          min: rate.conditions.context_min_tokens,
          max: rate.conditions.context_max_tokens,
        })),
      tools: model?.price_facts
        .filter((rate) => rate.meter === "tool_call")
        .map((rate) => ({
          operation: rate.conditions.operation,
          price: rate.price,
          unit: rate.unit,
        })),
    }).toEqual({
      tasks: ["text_generation"],
      delivery: ["realtime"],
      effort: true,
      services: [
        { meter: "input_text", min: undefined, max: 200000 },
        { meter: "output_text", min: undefined, max: 200000 },
        { meter: "input_text", min: 200001, max: undefined },
        { meter: "output_text", min: 200001, max: undefined },
      ],
      cacheTiers: [
        { min: 0, max: 31999 },
        { min: 32000, max: undefined },
      ],
      tools: [
        { operation: "web_search", price: "10", unit: "thousand_requests" },
        { operation: "maps_search", price: "14", unit: "thousand_requests" },
      ],
    });
  });

  it("keeps regional and fast rates as disjoint alternatives", async () => {
    const model = (await vercelCatalog("vercel/pricing.json")).find(
      ({ model_id }) => model_id === "acme/regional-fast-1",
    );
    expect(
      model?.price_facts
        .filter(({ meter }) => meter === "input_text")
        .map(({ price, conditions }) => ({ price, conditions })),
    ).toEqual([
      { price: "1", conditions: { region: "default", service_tier: "standard" } },
      { price: "2", conditions: { region: "default", service_tier: "fast" } },
      { price: "1.1", conditions: { region: "eu", service_tier: "standard" } },
      { price: "1.1", conditions: { region: "us", service_tier: "standard" } },
      { price: "2.2", conditions: { region: "us", service_tier: "fast" } },
    ]);
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
        meter: embedding?.price_facts[0]?.meter,
      },
      image: {
        maxOutput: image?.limits.max_output_tokens,
        rates: image?.price_facts.map((rate) => ({
          price: rate.price,
          conditions: rate.conditions,
        })),
      },
      video: {
        modalities: video?.modalities,
        rate: video?.price_facts[0],
      },
      videoToken: videoToken?.price_facts.map((rate) => ({
        price: rate.price,
        conditions: rate.conditions,
      })),
      speech: speech?.price_facts.map((rate) => ({ meter: rate.meter, unit: rate.unit })),
      transcription: {
        tasks: transcription?.tasks,
        status: transcription?.status,
        deprecatedAt: transcription?.deprecated_at,
        pricing: transcription?.price_facts.map((rate) => ({ meter: rate.meter, unit: rate.unit })),
      },
      tokenTranscription: tokenTranscription?.price_facts.map((rate) => ({
        meter: rate.meter,
        price: rate.price,
        unit: rate.unit,
      })),
      realtime: realtime?.price_facts.map((rate) => ({
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
      image: {
        maxOutput: undefined,
        rates: [
          { price: "0.04", conditions: { style: "default" } },
          {
            price: "0.08",
            conditions: { operation: undefined, resolution: "4K", style: undefined },
          },
          {
            price: "0.12",
            conditions: { operation: undefined, resolution: undefined, style: "vector" },
          },
        ],
      },
      video: {
        modalities: { input: ["text", "image", "video", "audio"], output: ["video"] },
        rate: {
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
      },
      videoToken: [
        { price: "7", conditions: { video_input: false } },
        { price: "4.3", conditions: { video_input: true } },
      ],
      speech: [{ meter: "input_text", unit: "character" }],
      transcription: {
        tasks: ["transcription"],
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

  it("publishes regional inference availability", async () => {
    const model = (await vercelCatalog("vercel/pricing.json")).find(
      ({ model_id }) => model_id === "acme/regional-fast-1",
    );
    expect(model?.availability).toEqual([
      { region: "eu", deployment_type: "regional_inference" },
      { region: "us", deployment_type: "regional_inference" },
    ]);
  });

  it("detects item schema drift", async () => {
    await expect(vercelCatalog("vercel/broken.json")).rejects.toThrow("schema drift");
    for (const edit of [
      (body: string) => body.replace('"object": "model"', '"object": "model", "new_field": true'),
      (body: string) => body.replace('"vision"', '"new-tag"'),
      (body: string) => body.replace('"max_tokens", "stop"', '"new_parameter", "stop"'),
      (body: string) => body.replace('"v2", "v3", "v4"', '"v2", "v3", "v5"'),
    ])
      await expect(vercelCatalog("vercel/normal.json", edit)).rejects.toThrow("schema drift");
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
    overrides: {
      chat?: string;
      completions?: string;
      gemma?: string;
      gpt?: string;
      serviceTiers?: string;
    } = {},
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
        {
          url: "https://inference-docs.cerebras.ai/capabilities/service-tiers.md",
          body: overrides.serviceTiers ?? (await fixture("cerebras/service-tiers.md")),
        },
      ],
    });
    return parseSource({ provider: provider(value), source: configured, body, observedAt });
  }

  async function lifecycle(body?: string): Promise<ProviderModel[]> {
    const value = manifest("cerebras");
    const configured = source("cerebras-lifecycle");
    return parseSource({
      provider: provider(value),
      source: configured,
      body: JSON.stringify({
        index: { url: configured.url, body: body ?? (await fixture("cerebras/lifecycle.md")) },
        documents: [
          {
            url: "https://inference-docs.cerebras.ai/models/overview.md",
            body: await fixture("cerebras/catalog.md"),
          },
          {
            url: "https://inference-docs.cerebras.ai/support/change-log.md",
            body: await fixture("cerebras/releases.md"),
          },
        ],
      }),
      observedAt,
    });
  }

  it("retains structured capabilities without treating created=0 as a release", async () => {
    const model = (await parse("cerebras-models", "cerebras/normal.json"))[0];
    expect(model?.capabilities.reasoning).toBe(true);
    expect(model?.tasks).toEqual(["text_generation"]);
    expect(model?.capabilities.structured_output).toBe(false);
    expect(model?.status).toBe("active");
    expect(model?.release_stage).toBe("preview");
    expect(model?.release_date).toBeUndefined();
  });

  it("normalizes published per-token rates", async () => {
    const model = (await parse("cerebras-models", "cerebras/pricing.json"))[0];
    expect(model?.release_date).toBeUndefined();
    expect({
      id: model?.model_id,
      input: model?.price_facts.find((rate) => rate.meter === "input_text")?.price,
      output: model?.price_facts.find((rate) => rate.meter === "output_text")?.price,
      pricing_state: model?.pricing_state,
    }).toEqual(await expected("cerebras/expected.json"));
  });

  it("parses model cards, scheduled lifecycle, and cached-input pricing", async () => {
    const models = await catalog();
    const glm = models.find(({ model_id }) => model_id === "zai-glm-4.7");
    const gpt = models.find(({ model_id }) => model_id === "gpt-oss-120b");
    const gemma = models.find(({ model_id }) => model_id === "gemma-4-31b");
    expect(glm).toMatchObject({
      name: "Z.ai GLM 4.7",
      status: "active",
      release_stage: "preview",
      deprecated_at: "2026-08-17",
      limits: { context_tokens: 131000, max_output_tokens: 40000 },
    });
    expect(gpt?.price_facts.find(({ meter }) => meter === "cache_read_text")).toMatchObject({
      price: "0.35",
      derived: true,
    });
    expect(gpt?.release_stage).toBe("stable");
    expect(gpt?.api_endpoints).toEqual([{ name: "Chat Completions", path: "v1/chat/completions" }]);
    expect(gemma?.api_endpoints).toEqual([
      { name: "Chat Completions", path: "v1/chat/completions" },
      { name: "Completions", path: "v1/completions" },
    ]);
    expect(gemma?.price_facts.find(({ meter }) => meter === "input_text")?.price).toBe("0.99");
    expect(models.every(({ capabilities }) => capabilities.effort_control === true)).toBe(true);
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
    const serviceTiers = (await fixture("cerebras/service-tiers.md")).replace(
      "all service tiers are billed equally",
      "service tiers may be billed differently",
    );
    await expect(catalog({ serviceTiers })).rejects.toThrow(
      "Cerebras service-tier pricing policy drift",
    );
  });

  it("resolves linked replacement models but ignores parameter deprecations", async () => {
    const models = await lifecycle();
    expect(models.map(({ model_id }) => model_id)).toEqual([
      "deepseek-r1-distill-llama-70b",
      "llama-3.3-70b",
      "llama3.1-70b",
      "qwen-3-32b",
    ]);
    expect(
      models.find(({ model_id }) => model_id === "deepseek-r1-distill-llama-70b")
        ?.replacement_model_ids,
    ).toEqual(["qwen-3-32b"]);
    expect(models.find(({ model_id }) => model_id === "qwen-3-32b")?.replacement_model_ids).toEqual(
      ["gpt-oss-120b"],
    );
    expect(models.find(({ model_id }) => model_id === "llama3.1-70b")).toMatchObject({
      deprecated_at: "2025-01-17",
      replacement_model_ids: ["llama-3.3-70b"],
    });
    expect(models.every(({ api_endpoints }) => api_endpoints === undefined)).toBe(true);
    await expect(
      lifecycle(
        (await fixture("cerebras/lifecycle.md")).replace(
          "[Qwen 3 32B](/models/qwen-3-32b)",
          "[Unknown replacement](/models/qwen-3-32b)",
        ),
      ),
    ).rejects.toThrow("Unresolved Cerebras replacement model link");
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
    const gemma = (await fixture("cerebras/gemma.md"))
      .replace('inputPrice: "$0.99"', 'inputPrice: "$2.15"')
      .replace('outputPrice: "$1.49"', 'outputPrice: "$2.70"');
    const catalogs = [
      { source: source("cerebras-catalog"), models: await catalog({ gemma }) },
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
        ?.price_facts.map(({ meter, source_ref }) => [meter, source_ref]),
    ).toEqual([
      ["cache_read_text", "cerebras-catalog"],
      ["input_text", "cerebras-models"],
      ["output_text", "cerebras-models"],
    ]);
    expect(
      merged
        .find(({ model_id }) => model_id === "gemma-4-31b")
        ?.price_facts.find(({ meter }) => meter === "input_text"),
    ).toMatchObject({ price: "0.99", source_ref: "cerebras-models" });
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
      { id: "huggingface-hub", role: "overlay" },
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
    expect(multi?.tasks).toEqual(["image_generation", "video_generation"]);
    expect(multi?.modalities).toEqual({
      input: ["text", "image"],
      output: ["image", "video"],
    });
    expect(embedding?.tasks).toEqual(["embeddings"]);
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

  it("does not publish credential-like identifiers from either listing", async () => {
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
    expect(
      (
        await huggingFaceRouter("huggingface/pricing.json", (body) =>
          body.replace('"org/model-1"', JSON.stringify(credentialLikeId)),
        )
      ).some(({ model_id }) => model_id === credentialLikeId),
    ).toBe(false);
    expect(
      (
        await huggingFaceHub((body) =>
          body.replace('"org/model-1"', JSON.stringify(credentialLikeId)),
        )
      ).some(({ model_id }) => model_id === credentialLikeId),
    ).toBe(false);
  });

  it("keeps every router price and route-derived fact", async () => {
    const models = await huggingFaceRouter("huggingface/pricing.json");
    const model = models.find((item) => item.model_id === "org/model-1");
    const free = models.find((item) => item.model_id === "org/free-model");
    expect({
      id: model?.model_id,
      input_rates: model?.price_facts.filter((rate) => rate.meter === "input_text").length,
      output_rates: model?.price_facts.filter((rate) => rate.meter === "output_text").length,
      routes: [
        ...new Set(
          model?.price_facts.flatMap((rate) => rate.conditions.route_provider ?? []) ?? [],
        ),
      ].sort(),
      pricing_state: model?.pricing_state,
    }).toEqual(await expected("huggingface/expected.json"));
    expect(model?.limits.context_tokens).toBe(131072);
    expect(model).toMatchObject({
      status: "active",
      capabilities: {
        streaming: true,
        tool_call: true,
        structured_output: true,
      },
    });
    expect(model?.modalities.input).toEqual(["text", "image"]);
    expect(model?.api_endpoints).toEqual([
      { name: "Chat Completions", path: "/v1/chat/completions" },
    ]);
    expect(model?.release_date).toBeUndefined();
    expect(
      model?.price_facts.some((rate) => rate.conditions.route_provider === "unavailable-route"),
    ).toBe(false);
    expect(models.some((item) => item.model_id === "org/unavailable-model")).toBe(false);
    expect(
      free?.price_facts.map((rate) => [rate.meter, rate.price, rate.conditions.promotion]),
    ).toEqual([
      ["input_text", "0", true],
      ["output_text", "0", true],
    ]);
  });

  it("combines the HF Inference and router catalogs", async () => {
    const value = manifest("huggingface");
    const inference = huggingFaceMappingSource(value);
    const router = huggingFaceRouterSource(value);
    const hub = huggingFaceHubSource(value);
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
    const metadata = parseSource({
      provider: provider(value),
      source: hub,
      body: await fixture("huggingface/hub.json"),
      observedAt,
    });
    const models = applyGroups(
      applyGroups(
        [],
        [
          { source: inference, models: mappings },
          { source: router, models: routed },
        ],
        true,
      ),
      [{ source: hub, models: metadata }],
      false,
    );
    expect(models.find((model) => model.model_id === "org/model-1")?.source_refs).toEqual([
      "huggingface-hf-inference",
      "huggingface-router",
      "huggingface-hub",
    ]);
    expect(models.find((model) => model.model_id === "org/model-1")?.updated_date).toBe(
      "2026-07-20",
    );
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

  it("enriches exact current mappings with Hub artifact modification dates", async () => {
    const models = await huggingFaceHub();
    expect(
      models.map(({ model_id, updated_date, tasks, status }) => ({
        model_id,
        updated_date,
        tasks,
        status,
      })),
    ).toEqual([
      {
        model_id: "org/embed-model",
        updated_date: "2026-06-03",
        tasks: [],
        status: "unknown",
      },
      {
        model_id: "org/model-1",
        updated_date: "2026-07-20",
        tasks: [],
        status: "unknown",
      },
    ]);
    await expect(
      huggingFaceHub((body) => body.replace('"org/model-1"', '"org/embed-model"')),
    ).rejects.toThrow("Duplicate Hugging Face Hub model");
    await expect(
      huggingFaceHub((body) => body.replace("2026-07-20T12:34:56.000Z", "not-a-date")),
    ).rejects.toThrow();
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
    expect(manifest("deepseek")).not.toHaveProperty("supersededModelIds");
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
          {
            id: "responses",
            url: "https://api-docs.deepseek.com/api/create-response",
          },
        ],
      },
    });
    const models = await deepseekCatalog();
    expect(models.map(({ model_id }) => model_id)).toEqual([
      "deepseek-v4-flash",
      "deepseek-v4-pro",
    ]);
    expect(models.find(({ model_id }) => model_id === "deepseek-v4-pro")).toMatchObject({
      name: "DeepSeek-V4-Pro",
      tasks: ["text_generation"],
      api_endpoints: [{ name: "Chat Completions", path: "/chat/completions" }],
      modalities: { input: ["text"], output: ["text"] },
      capabilities: {
        reasoning: true,
        effort_control: true,
        tool_call: true,
        structured_output: true,
        streaming: true,
        prompt_cache: true,
      },
      limits: { context_tokens: 1_000_000, max_output_tokens: 384_000 },
      pricing_state: "numeric",
      price_facts: [
        expect.objectContaining({ meter: "cache_read_text", price: "0.003625" }),
        expect.objectContaining({ meter: "input_text", price: "0.435" }),
        expect.objectContaining({ meter: "output_text", price: "0.87" }),
      ],
    });
    expect(models.find(({ model_id }) => model_id === "deepseek-v4-flash")?.api_endpoints).toEqual([
      { name: "Chat Completions", path: "/chat/completions" },
      { name: "Responses", path: "/responses" },
    ]);
  });

  it("rejects changed Chat Completions operation and model evidence", async () => {
    const chat = await fixture("deepseek/chat.html");
    await expect(
      deepseekCatalog(chat.replace("Chat Completions API", "Renamed API")),
    ).resolves.toHaveLength(2);
    await expect(deepseekCatalog(chat.replace("/chat/completions", "/responses"))).rejects.toThrow(
      "changed operation",
    );
    await expect(
      deepseekCatalog(
        chat.replace(
          "</pre>",
          '</pre><pre class="openapi__method-endpoint"><span class="badge">POST</span><h2 class="openapi__method-endpoint-path">/responses</h2></pre>',
        ),
      ),
    ).rejects.toThrow("changed operation");
    await expect(
      deepseekCatalog(chat.replace("deepseek-v4-flash", "deepseek-v4-unknown")),
    ).rejects.toThrow("named unknown catalog model");
    await expect(
      deepseekCatalog(
        chat.replace("partial message deltas will be sent", "streaming is supported"),
      ),
    ).rejects.toThrow("changed streaming schema");
    await expect(
      deepseekCatalog(chat.replace("reasoning_effort", "reasoning_level")),
    ).rejects.toThrow("changed reasoning controls");
    await expect(deepseekCatalog(chat.replace("json_object", "json_schema"))).rejects.toThrow(
      "changed structured-output schema",
    );
    await expect(
      deepseekCatalog(chat.replace("<code>function</code>", "<code>service</code>")),
    ).rejects.toThrow("changed tool schema");
    const responses = await fixture("deepseek/responses.html");
    await expect(
      deepseekCatalog(undefined, undefined, responses.replace("/responses", "/v2/responses")),
    ).rejects.toThrow("Responses reference changed operation");
    await expect(
      deepseekCatalog(
        undefined,
        undefined,
        responses.replace("deepseek-v4-flash", "deepseek-v4-pro"),
      ),
    ).rejects.toThrow("disagrees with the model table");
    const catalog = await fixture("deepseek/catalog.html");
    await expect(
      deepseekCatalog(
        undefined,
        catalog.replace("Supports both non-thinking and thinking modes", "Unknown mode"),
      ),
    ).rejects.toThrow("Unknown DeepSeek thinking mode");
    await expect(
      deepseekCatalog(
        undefined,
        catalog.replace("https://api.deepseek.com</td>", "https://api.example.com</td>"),
      ),
    ).rejects.toThrow("base URL");
    await expect(
      deepseekCatalog(undefined, catalog.replace("Concurrency Limit", "Concurrency Budget")),
    ).rejects.toThrow("unhandled rows");
  });

  it("treats the documented inventory owner as opaque metadata", async () => {
    const value = manifest("deepseek");
    const configured = source("deepseek-api");
    const body = (await fixture("deepseek/api.json")).replace(
      '"owned_by": "deepseek"',
      '"owned_by": "deepseek-platform"',
    );
    expect(
      parseSource({
        provider: provider(value),
        source: configured,
        body,
        observedAt,
      }),
    ).toHaveLength(2);
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
    expect(models.find(({ model_id }) => model_id === "deepseek-chat")).not.toHaveProperty(
      "release_date",
    );
    expect(models.find(({ model_id }) => model_id === "deepseek-coder")).toMatchObject({
      updated_date: "2024-09-05",
    });
    expect(models.find(({ model_id }) => model_id === "deepseek-coder")).not.toHaveProperty(
      "release_date",
    );
    const body = await fixture("deepseek/updates.html");
    expect(() =>
      parseSource({
        provider: provider(manifest("deepseek")),
        source: source("deepseek-updates"),
        body: body.replace("2024-09-05", "2024-02-30"),
        observedAt,
      }),
    ).toThrow("invalid date");
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
    expect(models.some(({ model_id }) => model_id === "deepseek-chat")).toBe(false);
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
      configured.extractor.kind === "dashscope-releases" ||
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
    expect(models.map(({ model_id, tasks, limits }) => ({ model_id, tasks, limits }))).toEqual([
      {
        model_id: "MiniMax-M2.5",
        tasks: ["text_generation"],
        limits: { context_tokens: 204_000 },
      },
      {
        model_id: "qwen3.7-plus",
        tasks: ["text_generation"],
        limits: { context_tokens: 1_000_000 },
      },
      {
        model_id: "qwen3.7-plus-2026-05-26",
        tasks: ["text_generation"],
        limits: { context_tokens: 1_000_000 },
      },
    ]);

    const embedding = parse(
      source("dashscope-embedding"),
      await fixture("dashscope/embedding.html"),
    );
    expect(embedding.map(({ model_id, tasks, limits }) => ({ model_id, tasks, limits }))).toEqual([
      {
        model_id: "qwen3-vl-rerank",
        tasks: ["reranking"],
        limits: { max_input_tokens: 8_000 },
      },
      {
        model_id: "text-embedding-v4",
        tasks: ["embeddings"],
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
    const pricingBody = await fixture("dashscope/pricing.html");
    const cacheBody = await fixture("dashscope/cache.html");
    const parsePricing = (body: string) =>
      parse(
        pricingSource,
        JSON.stringify({
          index: { url: pricingSource.url, body },
          documents: [
            {
              url: "https://www.alibabacloud.com/help/en/model-studio/context-cache",
              body: cacheBody,
            },
          ],
        }),
      );
    const models = parsePricing(pricingBody);
    const model = models.find(({ model_id }) => model_id === "qwen3.7-plus");
    expect(model?.aliases).toEqual(["qwen3.7-plus-2026-05-26"]);
    expect(
      model?.price_facts.map(({ meter, price, conditions }) => ({ meter, price, conditions })),
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
    expect(models.find(({ model_id }) => model_id === "qwen-mt-lite")?.tasks).toEqual([
      "translation",
    ]);
    expect(models.find(({ model_id }) => model_id === "qwen-mt-image")?.tasks).toEqual([
      "image_generation",
      "translation",
    ]);
    expect(models.find(({ model_id }) => model_id === "fun-asr")?.tasks).toEqual(["transcription"]);
    const embedding = models.find(({ model_id }) => model_id === "qwen3-vl-embedding");
    expect(embedding?.price_facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          price: "0.258",
          conditions: expect.objectContaining({ modality: "image/video" }),
        }),
        expect.objectContaining({
          price: "0.1",
          conditions: expect.objectContaining({ modality: "text" }),
        }),
      ]),
    );
    expect(
      embedding?.price_facts.every(({ conditions }) => conditions.operation === undefined),
    ).toBe(true);
    const video = models.find(({ model_id }) => model_id === "wan2.2-s2v");
    expect(video?.price_facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          price: "0.071677",
          conditions: expect.objectContaining({ resolution: "480P" }),
        }),
        expect.objectContaining({
          price: "0.129018",
          conditions: expect.objectContaining({ resolution: "720P" }),
        }),
      ]),
    );
    expect(video?.price_facts.every(({ conditions }) => conditions.operation === undefined)).toBe(
      true,
    );
    const aspectRatio = models.find(({ model_id }) => model_id === "emo-v1");
    expect(aspectRatio?.price_facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          price: "0.011469",
          conditions: expect.objectContaining({ operation: "1_1_landscape_video" }),
        }),
        expect.objectContaining({
          price: "0.022937",
          conditions: expect.objectContaining({ operation: "3_4_landscape_video" }),
        }),
      ]),
    );
    expect(models.find(({ model_id }) => model_id === "qwen2-vl-7b-instruct")).toMatchObject({
      pricing_state: "numeric",
      status: "active",
      modalities: { input: ["text"], output: ["text"] },
      price_facts: [
        expect.objectContaining({
          meter: "input_text",
          price: "0",
          conditions: expect.objectContaining({ promotion: true }),
        }),
        expect.objectContaining({
          meter: "output_text",
          price: "0",
          conditions: expect.objectContaining({ promotion: true }),
        }),
      ],
    });
    expect(models.find(({ model_id }) => model_id === "multimodal-embedding-v1")).toMatchObject({
      pricing_state: "numeric",
      modalities: { input: ["text", "image", "video"], output: ["embedding"] },
      price_facts: [
        expect.objectContaining({
          meter: "embedding",
          price: "0",
          conditions: expect.objectContaining({
            account_eligibility: "free_trial",
            promotion: true,
          }),
        }),
      ],
    });
    expect(
      models.find(({ model_id }) => model_id === "deepseek-r1-distill-llama-8b"),
    ).toMatchObject({
      pricing_state: "not_applicable",
      status: "retired",
      price_facts: [],
    });
    expect(
      models
        .find(({ model_id }) => model_id === "qwen3-vl-rerank")
        ?.price_facts.map(({ meter }) => meter)
        .sort(),
    ).toEqual(["input_image", "input_text"]);
    expect(models.find(({ model_id }) => model_id === "qwen3-vl-rerank")?.modalities).toEqual({
      input: ["text", "image"],
      output: [],
    });
    expect(
      models
        .find(({ model_id }) => model_id === "wan2.7-r2v")
        ?.price_facts.map(({ meter }) => meter),
    ).toEqual(["input_video", "video_generation"]);
    expect(() => parsePricing(pricingBody.replace("Free trial", "Contact sales"))).toThrow(
      "omitted a supported price or disposition",
    );
  });

  it("takes the earliest exact model release across regional release tables", async () => {
    const body = await fixture("dashscope/releases.html");
    const models = parse(source("dashscope-releases"), body);
    expect(models.map(({ model_id, release_date }) => ({ model_id, release_date }))).toEqual([
      { model_id: "qwen3-tts-flash-2025-11-27", release_date: "2025-11-27" },
      { model_id: "qwen3.7-plus", release_date: "2026-05-20" },
      { model_id: "qwen3.7-plus-2026-05-26", release_date: "2026-05-21" },
    ]);
    expect(() =>
      parse(source("dashscope-releases"), body.replace("2026-05-21", "May 21, 2026")),
    ).toThrow("DashScope release date");
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
    expect(value.provider).toMatchObject({
      catalog_scope: "mixed",
      regions: ["China", "International"],
    });
    expect(source("kimi-api")).toMatchObject({
      url: "https://api.moonshot.ai/v1/models",
      allowedHosts: ["api.moonshot.ai"],
    });
    expect(source("kimi-openapi")).toMatchObject({
      url: "https://platform.kimi.ai/docs/openapi.json",
      allowedHosts: ["platform.kimi.ai"],
    });
    expect(source("kimi-international-pricing")).toMatchObject({
      url: "https://platform.kimi.ai/docs/pricing/chat-k3",
      scope: "region",
    });
    expect(source("kimi-releases").linkedDocuments?.documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "catalog",
          url: "https://platform.kimi.com/docs/models",
          format: "markdown",
        }),
      ]),
    );
  });

  it("keeps omitted inventory capabilities as unknown", async () => {
    const models = await parsed("kimi", "kimi/api.json", "kimi-api");
    expect(models.find(({ model_id }) => model_id === "kimi-k2.6")).toMatchObject({
      modalities: { input: ["text"], output: ["text"] },
      capabilities: { reasoning: "unknown" },
    });
  });

  async function pricing(
    batchApi?: string,
    sourceId = "kimi-pricing",
    indexBody?: string,
  ): Promise<ProviderModel[]> {
    const configured = source(sourceId);
    const international = sourceId === "kimi-international-pricing";
    const fixtureName = (name: string): string =>
      `kimi/${international ? `pricing-global-${name}` : `pricing-${name}`}.md`;
    const origin = new URL(configured.url).origin;
    const documents = [
      [`${origin}/docs/pricing/chat-k27-code`, fixtureName("k27")],
      [`${origin}/docs/pricing/chat-k26`, fixtureName("k26")],
      [`${origin}/docs/pricing/chat-k25`, fixtureName("k25")],
      [`${origin}/docs/pricing/chat-v1`, fixtureName("v1")],
      [`${origin}/docs/pricing/batch`, fixtureName("batch")],
      [
        `${origin}/docs/api/batch-create`,
        `kimi/${international ? "batch-api-global" : "batch-api"}.md`,
      ],
      [
        `${origin}/docs/guide/use-context-caching-feature-of-kimi-api`,
        `kimi/${international ? "cache-global" : "cache"}.md`,
      ],
    ] as const;
    return parse(
      configured,
      JSON.stringify({
        index: {
          url: configured.url,
          body: indexBody ?? (await fixture(fixtureName("k3"))),
        },
        documents: await Promise.all(
          documents.map(async ([url, path]) => ({
            url,
            body:
              url.endsWith("/docs/api/batch-create") && batchApi !== undefined
                ? batchApi
                : await fixture(path),
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
          {
            url: "https://platform.kimi.com/docs/models",
            body: await fixture("kimi/models.md"),
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
      tasks: ["text_generation"],
      status: "active",
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
    expect(models.find(({ model_id }) => model_id === "kimi-k3")?.limits.max_output_tokens).toBe(
      1_048_576,
    );
    expect(() =>
      parse(source("kimi-openapi"), body.replace('"kimi-k3"]', '"kimi-k3", "ghost-model"]')),
    ).toThrow("mapping disagrees");
    expect(() =>
      parse(source("kimi-openapi"), body.replace("/v1/chat/completions", "/v1/responses")),
    ).toThrow();
    expect(() =>
      parse(source("kimi-openapi"), body.replace("https://api.moonshot.ai", "https://example.com")),
    ).toThrow("server");
    expect(() =>
      parse(source("kimi-openapi"), body.replace('"json_schema"', '"json_lines"')),
    ).toThrow("structured output");
    expect(() => parse(source("kimi-openapi"), body.replace('"function"', '"service"'))).toThrow(
      "tool schema",
    );
    expect(() =>
      parse(source("kimi-openapi"), body.replace('"low", "high", "max"', '"high", "max"')),
    ).toThrow("reasoning effort");
    expect(() =>
      parse(
        source("kimi-openapi"),
        body.replace("for Kimi K3 it defaults", "for Kimi K4 it defaults"),
      ),
    ).toThrow("output limit identity");
  });

  it("retains callable and retired IDs only from labeled catalog fields", async () => {
    const body = await fixture("kimi/models.md");
    const models = parse(source("kimi-catalog"), body);
    expect(models).toHaveLength(18);
    expect(models.find(({ model_id }) => model_id === "kimi-k3")).toMatchObject({
      limits: { context_tokens: 1_000_000 },
      modalities: { input: ["text", "image"], output: ["text"] },
    });
    expect(models.find(({ model_id }) => model_id === "kimi-k2.5")).toMatchObject({
      status: "legacy",
    });
    expect(models.find(({ model_id }) => model_id === "kimi-thinking-preview")).toMatchObject({
      status: "retired",
      retired_at: "2025-11-11",
      replacement_model_ids: ["kimi-k3"],
    });
    const changedRestriction = parse(
      source("kimi-catalog"),
      body.replace(
        "`kimi-k2.5` 和 `moonshot-v1` 系列模型",
        "`kimi-k2.6` 和 `moonshot-v1-8k-vision` 系列模型",
      ),
    );
    expect(changedRestriction.find(({ model_id }) => model_id === "kimi-k2.5")?.status).toBe(
      "active",
    );
    expect(changedRestriction.find(({ model_id }) => model_id === "kimi-k2.6")?.status).toBe(
      "legacy",
    );
    expect(changedRestriction.find(({ model_id }) => model_id === "moonshot-v1-8k")?.status).toBe(
      "active",
    );
    expect(
      changedRestriction.find(({ model_id }) => model_id === "moonshot-v1-8k-vision-preview")
        ?.status,
    ).toBe("legacy");
    const changedReplacement = parse(
      source("kimi-catalog"),
      body.replaceAll("[kimi-k3]", "[kimi-k2.6]"),
    );
    expect(
      changedReplacement.find(({ model_id }) => model_id === "kimi-k2-thinking")
        ?.replacement_model_ids,
    ).toEqual(["kimi-k2.6"]);
    expect(() =>
      parse(source("kimi-catalog"), body.replace("2026 年 5 月 25 日", "2026 年 2 月 30 日")),
    ).toThrow("date");
  });

  it("keeps regional standard, cached-input, and Batch rates", async () => {
    const models = await pricing();
    expect(models).toHaveLength(11);
    expect(models.find(({ model_id }) => model_id === "kimi-k2.7-code-highspeed")).toMatchObject({
      name: "Kimi K2.7 Code HighSpeed",
      modalities: { input: ["text", "image", "video"], output: ["text"] },
      limits: { context_tokens: 262_144 },
    });
    const k26 = models.find(({ model_id }) => model_id === "kimi-k2.6");
    expect(k26?.capabilities).toMatchObject({ reasoning: true, batch: true, prompt_cache: true });
    expect(k26?.api_endpoints).toEqual([{ name: "Batch", path: "/v1/batches" }]);
    expect(k26?.price_facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          meter: "cache_read_text",
          price: "1.10",
          currency: "CNY",
          conditions: { region: "China" },
        }),
        expect.objectContaining({
          meter: "input_text",
          price: "3.90",
          currency: "CNY",
          conditions: { region: "China", service_tier: "batch" },
        }),
      ]),
    );
    expect(
      models.find(({ model_id }) => model_id === "kimi-k2.7-code-highspeed")?.api_endpoints,
    ).toBeUndefined();
    const international = await pricing(undefined, "kimi-international-pricing");
    expect(international.find(({ model_id }) => model_id === "kimi-k3")?.price_facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          meter: "cache_read_text",
          price: "0.30",
          currency: "USD",
          conditions: { region: "International" },
        }),
        expect.objectContaining({
          meter: "output_text",
          price: "15.00",
          currency: "USD",
          conditions: { region: "International" },
        }),
      ]),
    );
    expect(international.find(({ model_id }) => model_id === "kimi-k2.6")?.price_facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          meter: "input_text",
          price: "0.57",
          currency: "USD",
          conditions: { region: "International", service_tier: "batch" },
        }),
      ]),
    );
    const k3 = await fixture("kimi/pricing-k3.md");
    await expect(
      pricing(
        undefined,
        "kimi-pricing",
        k3.replace("输入价格（缓存命中）", "输入价格（缓存读取）"),
      ),
    ).rejects.toThrow("unknown column");
  });

  it("rejects changed Batch API route evidence", async () => {
    const body = await fixture("kimi/batch-api.md");
    await expect(pricing(body.replace("POST /v1/batches", "POST /v1/jobs"))).rejects.toThrow(
      "Batch API reference changed",
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
    expect(models.find(({ model_id }) => model_id === "kimi-k2-thinking")?.release_date).toBe(
      "2025-11-06",
    );
    expect(models.some(({ model_id }) => model_id === "perceptionbench")).toBe(false);
  });

  it("retains every successful source that finds the same model", async () => {
    const catalogSources = [
      source("kimi-openapi"),
      source("kimi-catalog"),
      source("kimi-pricing"),
      source("kimi-international-pricing"),
    ];
    const catalogs = [
      parse(catalogSources[0] ?? source("kimi-openapi"), await fixture("kimi/openapi.json")),
      await parsed("kimi", "kimi/models.md", "kimi-catalog"),
      await pricing(),
      await pricing(undefined, "kimi-international-pricing"),
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
      "kimi-international-pricing",
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
      tasks: ["text_generation"],
      service_families: ["Ollama Library"],
      modalities: { input: ["text", "image", "audio"], output: ["text"] },
      capabilities: { reasoning: true, tool_call: true },
      updated_date: "2026-06-30",
      pricing_state: "not_published",
    });
    expect(models.find(({ model_id }) => model_id === "nomic-embed-text")).toMatchObject({
      tasks: ["embeddings"],
      modalities: { input: ["text"], output: ["embedding"] },
      pricing_state: "not_applicable",
    });
    expect(models.find(({ model_id }) => model_id === "glm-ocr")?.tasks).toEqual([
      "text_generation",
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
      pricing_state: "not_published",
      source_refs: ["ollama-cloud-models"],
    });
    expect(models.find(({ model_id }) => model_id === "kimi-k2.5")).toMatchObject({
      service_families: ["Ollama Cloud", "Ollama Library"],
      status: "active",
      modalities: { input: ["text", "image"], output: ["text"] },
    });
    expect(models.find(({ model_id }) => model_id === "gemini-3-flash-preview")).toMatchObject({
      service_families: ["Ollama Cloud", "Ollama Library"],
      status: "active",
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
  it("merges source-declared delivery modes and their evidence", () => {
    const configured = manifest("vercel").sources[0];
    if (configured === undefined) throw new Error("Missing Vercel source");
    const source: SourceManifest = { ...configured, fields: ["delivery_modes"] };
    const current: ProviderModel = {
      ...baseModel({
        providerId: "vercel",
        id: "acme/model",
        name: "Model",
        sourceId: "catalog",
        observedAt,
      }),
      delivery_modes: ["streaming"],
    };
    const incoming: ProviderModel = {
      ...baseModel({
        providerId: "vercel",
        id: "acme/model",
        name: "Model",
        sourceId: source.id,
        observedAt,
      }),
      delivery_modes: ["realtime"],
      delivery_mode_evidence: [
        {
          mode: "realtime",
          source_ref: source.id,
          namespace: "vercel.tag",
          raw_value: "websocket-realtime",
          kind: "capability",
        },
      ],
    };
    const merged = applyGroups([current], [{ source, models: [incoming] }], false)[0];
    expect({
      modes: merged?.delivery_modes,
      evidence: merged?.delivery_mode_evidence,
    }).toEqual({
      modes: ["streaming", "realtime"],
      evidence: incoming.delivery_mode_evidence,
    });
  });

  it("retains partial observations but replaces reinterpreted source output", () => {
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
    expect(
      reconcileCatalog([current], [previous], {
        catalog: new Set(["official-api", "official-website"]),
        exhaustive: new Set(),
        recomputed: new Set(),
      })[0]?.source_refs,
    ).toEqual(["official-api", "official-website"]);
    expect(
      reconcileCatalog([current], [previous], {
        catalog: new Set(["official-api", "official-website"]),
        exhaustive: new Set(["official-api"]),
        recomputed: new Set(),
      })[0]?.source_refs,
    ).toEqual(["official-website"]);
    expect(
      reconcileCatalog([current], [previous], {
        catalog: new Set(["official-api", "official-website"]),
        exhaustive: new Set(),
        recomputed: new Set(["official-api"]),
      })[0]?.source_refs,
    ).toEqual(["official-website"]);
  });

  it("reconciles omissions from exhaustive catalogs without treating overlays as presence", () => {
    const exhaustive = baseModel({
      providerId: "example",
      id: "removed",
      name: "Removed",
      sourceId: "exhaustive-api",
      observedAt: "2026-07-20T00:00:00.000Z",
    });
    const shared = {
      ...baseModel({
        providerId: "example",
        id: "shared",
        name: "Shared",
        sourceId: "exhaustive-api",
        observedAt: "2026-07-20T00:00:00.000Z",
      }),
      source_refs: ["exhaustive-api", "partial-catalog", "metadata-overlay"],
      routes: [
        {
          source_ref: "exhaustive-api",
          provider: "one",
          provider_model_id: "shared",
          task: "conversational",
          status: "live" as const,
        },
        {
          source_ref: "partial-catalog",
          provider: "two",
          provider_model_id: "shared",
          task: "conversational",
          status: "live" as const,
        },
      ],
    };
    const overlayOnly = {
      ...exhaustive,
      model_id: "overlay-only",
      uid: "example/overlay-only",
      source_refs: ["exhaustive-api", "metadata-overlay"],
    };
    expect(
      reconcileCatalog([], [exhaustive, shared, overlayOnly], {
        catalog: new Set(["exhaustive-api", "partial-catalog"]),
        exhaustive: new Set(["exhaustive-api"]),
        recomputed: new Set(),
      }),
    ).toEqual([
      expect.objectContaining({
        model_id: "shared",
        source_refs: ["partial-catalog", "metadata-overlay"],
        routes: [expect.objectContaining({ source_ref: "partial-catalog" })],
      }),
    ]);
  });

  it("quarantines large deletions", async () => {
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
      issue: {
        code: "model_count_drop",
        message: "model count dropped by more than 10%",
        previous: 2,
        current: 1,
        minimum_ratio: 0.9,
      },
    });
  });

  it("rejects duplicate or abruptly missing structured evidence", async () => {
    const model = (await huggingFaceMapping("huggingface/normal.json")).find(
      ({ model_id }) => model_id === "org/model-1",
    );
    const route = model?.routes?.[0];
    if (model === undefined || route === undefined) throw new Error("Missing routed fixture model");
    expect(validateProvider([{ ...model, routes: [route, route] }], []).issue?.code).toBe(
      "duplicate_route",
    );
    expect(
      validateProvider(
        [{ ...model, routes: [{ ...route, source_ref: "unreferenced-source" }] }],
        [],
      ).issue?.code,
    ).toBe("missing_route_source");
    expect(validateProvider([{ ...model, routes: [] }], [model]).issue?.code).toBe(
      "route_count_drop",
    );

    const bedrock = (await parsed("amazon-bedrock", "document/bedrock.json")).find(
      ({ model_id }) => model_id === "anthropic.claude-haiku-4-5-20251001-v1:0",
    );
    const endpoint = bedrock?.api_endpoints?.[0];
    const availability = bedrock?.availability?.[0];
    if (bedrock === undefined || endpoint === undefined || availability === undefined)
      throw new Error("Missing Bedrock route evidence");
    expect(
      validateProvider([{ ...bedrock, api_endpoints: [endpoint, endpoint] }], []).issue?.code,
    ).toBe("duplicate_api_endpoint");
    expect(
      validateProvider([{ ...bedrock, availability: [availability, availability] }], []).issue
        ?.code,
    ).toBe("duplicate_availability");
    expect(validateProvider([{ ...bedrock, api_endpoints: [] }], [bedrock]).issue?.code).toBe(
      "api_endpoint_count_drop",
    );
    expect(validateProvider([{ ...bedrock, availability: [] }], [bedrock]).issue?.code).toBe(
      "availability_count_drop",
    );

    const azure = (await azureCatalog()).find(
      ({ model_id }) => model_id === "Cohere-embed-v3-english",
    );
    const family = azure?.service_families?.[0];
    if (azure === undefined || family === undefined)
      throw new Error("Missing Azure service-family evidence");
    expect(
      validateProvider([{ ...azure, service_families: [family, family] }], []).issue?.code,
    ).toBe("duplicate_service_family");
    expect(validateProvider([{ ...azure, service_families: undefined }], [azure]).issue?.code).toBe(
      "service_family_count_drop",
    );
  });
});
