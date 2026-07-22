import type { Provider, ProviderModel } from "./schema.ts";

export type Extractor =
  | { kind: "vercel" }
  | { kind: "cerebras" }
  | { kind: "huggingface" }
  | { kind: "ollama" }
  | { kind: "vllm" }
  | { kind: "bedrock-model-cards" }
  | {
      kind: "document-identifiers";
      patterns: RegExp[];
      idKind: "api_id" | "alias" | "display_name" | "source_generated";
      linkTarget?: RegExp;
    };

export interface LinkedDocuments {
  path: RegExp;
  minDocuments: number;
  maxDocuments: number;
  concurrency: number;
}

export interface SourceManifest {
  id: string;
  url: string;
  type:
    | "official_public_api"
    | "official_bulk_pricing"
    | "official_openapi"
    | "official_markdown"
    | "official_html"
    | "official_github"
    | "runtime_api";
  stability: "documented" | "semi_structured" | "undocumented";
  extractor: Extractor;
  extractorVersion: string;
  fields: string[];
  allowedHosts: string[];
  maxResponseBytes: number;
  linkedDocuments?: LinkedDocuments;
}

export interface ProviderManifest {
  provider: Omit<Provider, "source_ids" | "last_successful_sync_at" | "catalog_version">;
  sources: SourceManifest[];
  notConfiguredReason?: string;
  supersededIdKinds?: ProviderModel["id_kind"][];
}

const mebibytes = (value: number): number => value * 1024 * 1024;

const documentSource = (
  id: string,
  url: string,
  patterns: RegExp[],
  idKind: "api_id" | "alias" | "display_name" | "source_generated" = "api_id",
  linkTarget?: RegExp,
  additionalHosts: string[] = [],
): SourceManifest => ({
  id,
  url,
  type: url.includes("githubusercontent.com") ? "official_github" : "official_html",
  stability: "semi_structured",
  extractor: {
    kind: "document-identifiers",
    patterns,
    idKind,
    ...(linkTarget === undefined ? {} : { linkTarget }),
  },
  extractorVersion: "document-identifiers-v1",
  fields: ["model_id", "name"],
  allowedHosts: [new URL(url).hostname, ...additionalHosts],
  maxResponseBytes: mebibytes(8),
});

export const manifests = [
  {
    provider: {
      id: "openai",
      name: "OpenAI",
      kind: "hosted",
      homepage: "https://openai.com/",
      docs_url: "https://developers.openai.com/api/docs/models",
      catalog_scope: "global",
    },
    sources: [
      documentSource(
        "openai-models",
        "https://developers.openai.com/api/docs/models/compare",
        [/^(?:gpt|o[1345]|text-embedding|omni-moderation|dall-e|tts|whisper)[a-z0-9._:-]*$/i],
        "api_id",
        /\/api\/docs\/models\//,
      ),
    ],
  },
  {
    provider: {
      id: "anthropic",
      name: "Anthropic",
      kind: "hosted",
      homepage: "https://www.anthropic.com/",
      docs_url: "https://platform.claude.com/docs/en/about-claude/models/overview",
      catalog_scope: "global",
    },
    sources: [
      documentSource(
        "anthropic-models",
        "https://platform.claude.com/docs/en/about-claude/models/overview",
        [/^claude-[a-z0-9.-]+$/i],
      ),
    ],
  },
  {
    provider: {
      id: "amazon-bedrock",
      name: "Amazon Bedrock",
      kind: "cloud_platform",
      homepage: "https://aws.amazon.com/bedrock/",
      docs_url: "https://docs.aws.amazon.com/bedrock/latest/userguide/models-supported.html",
      catalog_scope: "regional",
    },
    sources: [
      {
        id: "bedrock-models",
        url: "https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards.md",
        type: "official_markdown",
        stability: "semi_structured",
        extractor: { kind: "bedrock-model-cards" },
        extractorVersion: "bedrock-model-cards-v1",
        fields: ["model_id", "name"],
        allowedHosts: ["docs.aws.amazon.com"],
        maxResponseBytes: mebibytes(8),
        linkedDocuments: {
          path: /^\/bedrock\/latest\/userguide\/model-card-[a-z0-9-]+\.md$/,
          minDocuments: 100,
          maxDocuments: 200,
          concurrency: 8,
        },
      },
    ],
    supersededIdKinds: ["display_name"],
  },
  {
    provider: {
      id: "databricks",
      name: "Databricks",
      kind: "cloud_platform",
      homepage: "https://www.databricks.com/",
      docs_url:
        "https://docs.databricks.com/aws/en/machine-learning/model-serving/foundation-model-overview",
      catalog_scope: "regional",
    },
    sources: [
      documentSource(
        "databricks-models",
        "https://docs.databricks.com/aws/en/machine-learning/model-serving/foundation-model-overview",
        [/^databricks-[a-z0-9._-]+$/i],
      ),
    ],
  },
  {
    provider: {
      id: "vercel",
      name: "Vercel AI Gateway",
      kind: "gateway",
      homepage: "https://vercel.com/ai-gateway",
      docs_url: "https://vercel.com/ai-gateway/models",
      catalog_scope: "global",
    },
    sources: [
      {
        id: "vercel-models",
        url: "https://ai-gateway.vercel.sh/v1/models",
        type: "official_public_api",
        stability: "documented",
        extractor: { kind: "vercel" },
        extractorVersion: "vercel-v1",
        fields: ["model_id", "name", "types", "modalities", "capabilities", "limits", "pricing"],
        allowedHosts: ["ai-gateway.vercel.sh"],
        maxResponseBytes: mebibytes(16),
      },
    ],
  },
  {
    provider: {
      id: "azure",
      name: "Azure AI Foundry",
      kind: "cloud_platform",
      homepage: "https://azure.microsoft.com/products/ai-foundry/",
      docs_url:
        "https://learn.microsoft.com/azure/ai-foundry/foundry-models/concepts/models-sold-directly-by-azure",
      catalog_scope: "regional",
    },
    sources: [
      documentSource(
        "azure-models",
        "https://learn.microsoft.com/en-us/azure/ai-foundry/foundry-models/concepts/models-sold-directly-by-azure",
        [
          /^(?:gpt(?:-|$)|o[1345](?:-|$)|codex-|computer-use-|sora(?:-|$)|text-embedding-|tts(?:-|$)|whisper(?:-|$)|grok-|deepseek-|llama-|mistral-|ministral-|cohere-|command-|rerank-|embed-|flux[.-]|kimi-|mai-|qwen-|phi-)[a-z0-9._:-]*$/i,
        ],
        "display_name",
      ),
    ],
  },
  {
    provider: {
      id: "gemini",
      name: "Gemini API",
      kind: "hosted",
      homepage: "https://ai.google.dev/",
      docs_url: "https://ai.google.dev/gemini-api/docs/models",
      catalog_scope: "global",
    },
    sources: [
      documentSource("gemini-models", "https://ai.google.dev/gemini-api/docs/models", [
        /^(?:models\/)?gemini-[a-z0-9._-]+$/i,
      ]),
    ],
  },
  {
    provider: {
      id: "vertex",
      name: "Vertex AI",
      kind: "cloud_platform",
      homepage: "https://cloud.google.com/vertex-ai/",
      docs_url: "https://cloud.google.com/vertex-ai/generative-ai/docs/supported-models",
      catalog_scope: "regional",
    },
    sources: [
      documentSource(
        "vertex-models",
        "https://cloud.google.com/vertex-ai/generative-ai/docs/supported-models",
        [/^(?:gemini|imagen|veo|chirp|text-embedding|claude|llama|mistral)-[a-z0-9._-]+$/i],
        "api_id",
        undefined,
        ["docs.cloud.google.com"],
      ),
    ],
  },
  {
    provider: {
      id: "cohere",
      name: "Cohere",
      kind: "hosted",
      homepage: "https://cohere.com/",
      docs_url: "https://docs.cohere.com/docs/models",
      catalog_scope: "global",
    },
    sources: [
      documentSource("cohere-models", "https://docs.cohere.com/docs/models", [
        /^(?:command|embed|rerank|aya)-[a-z0-9._-]+$/i,
      ]),
    ],
  },
  {
    provider: {
      id: "mistral",
      name: "Mistral AI",
      kind: "hosted",
      homepage: "https://mistral.ai/",
      docs_url: "https://docs.mistral.ai/getting-started/models/models_overview/",
      catalog_scope: "global",
    },
    sources: [
      documentSource(
        "mistral-models",
        "https://docs.mistral.ai/getting-started/models/models_overview/",
        [/^(?:mistral|ministral|magistral|codestral|pixtral|voxtral|devstral|ocr)-[a-z0-9-]+$/i],
        "source_generated",
        /\/models\/model-cards\//,
      ),
    ],
  },
  {
    provider: {
      id: "llama",
      name: "Meta Llama",
      kind: "model_publisher",
      homepage: "https://www.llama.com/",
      docs_url: "https://github.com/meta-llama/llama-models",
      catalog_scope: "global",
    },
    sources: [
      documentSource(
        "llama-models",
        "https://raw.githubusercontent.com/meta-llama/llama-models/main/README.md",
        [/^(?:llama|Llama)[ -]?[0-9][a-z0-9 ._-]{0,80}$/],
        "display_name",
      ),
    ],
  },
  {
    provider: {
      id: "xai",
      name: "xAI",
      kind: "hosted",
      homepage: "https://x.ai/",
      docs_url: "https://docs.x.ai/developers/models",
      catalog_scope: "global",
    },
    sources: [
      documentSource("xai-models", "https://docs.x.ai/developers/models", [/^grok-[a-z0-9._-]+$/i]),
    ],
  },
  {
    provider: {
      id: "huggingface",
      name: "Hugging Face Inference Providers",
      kind: "gateway",
      homepage: "https://huggingface.co/",
      docs_url: "https://huggingface.co/docs/inference-providers/",
      catalog_scope: "global",
    },
    sources: [
      {
        id: "huggingface-models",
        url: "https://router.huggingface.co/v1/models",
        type: "official_public_api",
        stability: "documented",
        extractor: { kind: "huggingface" },
        extractorVersion: "huggingface-v1",
        fields: ["model_id", "modalities", "capabilities", "limits", "pricing"],
        allowedHosts: ["router.huggingface.co"],
        maxResponseBytes: mebibytes(16),
      },
    ],
  },
  {
    provider: {
      id: "dashscope",
      name: "Alibaba Cloud Model Studio",
      kind: "cloud_platform",
      homepage: "https://www.alibabacloud.com/product/modelstudio",
      docs_url: "https://www.alibabacloud.com/help/en/model-studio/models",
      catalog_scope: "regional",
    },
    sources: [
      documentSource(
        "dashscope-models",
        "https://www.alibabacloud.com/help/en/model-studio/models",
        [
          /^(?:qwen|wan|wanx|paraformer|cosyvoice|gte|text-embedding|multimodal-embedding)[a-z0-9._-]*$/i,
        ],
      ),
    ],
  },
  {
    provider: {
      id: "cerebras",
      name: "Cerebras Inference",
      kind: "hosted",
      homepage: "https://www.cerebras.ai/inference",
      docs_url: "https://inference-docs.cerebras.ai/",
      catalog_scope: "global",
    },
    sources: [
      {
        id: "cerebras-models",
        url: "https://api.cerebras.ai/public/v1/models",
        type: "official_public_api",
        stability: "documented",
        extractor: { kind: "cerebras" },
        extractorVersion: "cerebras-v1",
        fields: ["model_id", "name", "capabilities", "limits", "pricing", "status"],
        allowedHosts: ["api.cerebras.ai"],
        maxResponseBytes: mebibytes(4),
      },
    ],
  },
  {
    provider: {
      id: "ollama",
      name: "Ollama",
      kind: "local_runtime",
      homepage: "https://ollama.com/",
      docs_url: "https://docs.ollama.com/api/tags",
      catalog_scope: "mixed",
    },
    sources: [
      {
        id: "ollama-cloud-models",
        url: "https://ollama.com/api/tags",
        type: "runtime_api",
        stability: "undocumented",
        extractor: { kind: "ollama" },
        extractorVersion: "ollama-v1",
        fields: ["model_id", "name"],
        allowedHosts: ["ollama.com"],
        maxResponseBytes: mebibytes(4),
      },
    ],
  },
  {
    provider: {
      id: "vllm",
      name: "vLLM runtime",
      kind: "local_runtime",
      homepage: "https://vllm.ai/",
      docs_url: "https://docs.vllm.ai/en/latest/serving/openai_compatible_server/",
      catalog_scope: "runtime",
    },
    sources: [],
    notConfiguredReason: "No reviewed, unauthenticated runtime endpoint is configured.",
  },
  {
    provider: {
      id: "deepseek",
      name: "DeepSeek",
      kind: "hosted",
      homepage: "https://www.deepseek.com/",
      docs_url: "https://api-docs.deepseek.com/api/list-models",
      catalog_scope: "global",
    },
    sources: [
      documentSource("deepseek-models", "https://api-docs.deepseek.com/api/list-models", [
        /^deepseek-[a-z0-9._-]+$/i,
      ]),
    ],
  },
  {
    provider: {
      id: "kimi",
      name: "Kimi",
      kind: "hosted",
      homepage: "https://www.kimi.com/",
      docs_url: "https://platform.kimi.com/docs/guide/start-using-kimi-api",
      catalog_scope: "global",
    },
    sources: [
      documentSource("kimi-models", "https://platform.kimi.com/docs/guide/start-using-kimi-api", [
        /^(?:kimi|moonshot)-[a-z0-9._-]+$/i,
      ]),
    ],
  },
] satisfies ProviderManifest[];
