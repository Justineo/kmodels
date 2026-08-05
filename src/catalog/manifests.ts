import type { PriceDimension } from "./pricing-schema.ts";
import type { SourcePricingEvidence } from "./source-pricing-policy.ts";
import type { Provider, ProviderModel, SourceAccess, SourceFormat, SourceKind } from "./schema.ts";

export type Extractor =
  | { kind: "openai-catalog" }
  | { kind: "openai-overview" }
  | { kind: "openai-api" }
  | { kind: "openai-deprecations" }
  | { kind: "openai-data-residency"; minModels: number; maxModels: number }
  | { kind: "openai-pricing"; minModels: number; maxModels: number }
  | { kind: "anthropic-catalog" }
  | { kind: "anthropic-api" }
  | { kind: "vercel-catalog"; minModels: number; maxModels: number }
  | { kind: "cerebras-public"; minModels: number; maxModels: number }
  | { kind: "cerebras-catalog"; minModels: number; maxModels: number }
  | { kind: "cerebras-lifecycle"; minModels: number; maxModels: number }
  | { kind: "cerebras-releases"; minModels: number; maxModels: number }
  | { kind: "cerebras-api"; minModels: number; maxModels: number }
  | { kind: "huggingface-mapping"; provider: string; minModels: number; maxModels: number }
  | { kind: "huggingface-router"; minModels: number; maxModels: number }
  | { kind: "huggingface-hub"; minModels: number; maxModels: number }
  | { kind: "ollama-library"; minModels: number; maxModels: number }
  | { kind: "ollama-cloud"; minModels: number; maxModels: number }
  | { kind: "bedrock-catalog" }
  | { kind: "bedrock-api" }
  | { kind: "databricks-catalog"; minModels: number; maxModels: number }
  | { kind: "databricks-api" }
  | { kind: "azure-catalog"; minModels: number; maxModels: number }
  | {
      kind: "azure-retail-prices";
      minModels: number;
      maxModels: number;
      minHandledRatio: number;
    }
  | { kind: "azure-claude-pricing"; minModels: number; maxModels: number }
  | { kind: "azure-api" }
  | { kind: "gemini-catalog"; minModels: number; maxModels: number }
  | { kind: "gemini-api" }
  | {
      kind: "vertex-catalog";
      minModels: number;
      maxModels: number;
      minModelDocuments: number;
      maxModelDocuments: number;
      minPricingCoverage: number;
    }
  | { kind: "vertex-api" }
  | {
      kind: "cohere-catalog";
      minModels: number;
      maxModels: number;
      minPricingCoverage: number;
    }
  | { kind: "cohere-api" }
  | {
      kind: "mistral-catalog";
      minModels: number;
      maxModels: number;
      minPricingCoverage: number;
    }
  | { kind: "mistral-api" }
  | { kind: "llama-catalog"; minModels: number; maxModels: number }
  | { kind: "llama-api" }
  | { kind: "xai-catalog"; minModels: number; maxModels: number }
  | { kind: "xai-api"; category: "all" | "language" | "image" | "video" }
  | {
      kind: "dashscope-catalog";
      category:
        | "text"
        | "vision"
        | "image"
        | "video"
        | "asr"
        | "tts"
        | "s2s"
        | "omni"
        | "embedding";
      minModels: number;
      maxModels: number;
    }
  | { kind: "dashscope-pricing"; minModels: number; maxModels: number }
  | { kind: "dashscope-recommended"; minModels: number; maxModels: number }
  | { kind: "dashscope-lifecycle"; minModels: number; maxModels: number }
  | { kind: "dashscope-releases"; minModels: number; maxModels: number }
  | { kind: "dashscope-api"; minModels: number; maxModels: number }
  | { kind: "deepseek-catalog"; minModels: number; maxModels: number }
  | { kind: "deepseek-updates"; minModels: number; maxModels: number }
  | { kind: "deepseek-api"; minModels: number; maxModels: number }
  | { kind: "kimi-openapi"; baseUrl: string; minModels: number; maxModels: number }
  | { kind: "kimi-catalog"; minModels: number; maxModels: number }
  | {
      kind: "kimi-pricing";
      region: string;
      currency: "CNY" | "USD";
      symbol: "¥" | "$";
      minModels: number;
      maxModels: number;
    }
  | { kind: "kimi-releases"; minModels: number; maxModels: number }
  | { kind: "kimi-api"; minModels: number; maxModels: number };

export interface LinkedDocuments {
  path: RegExp;
  indexFormat?: "html" | "markdown" | "typescript";
  nestedIndexes?: {
    path: RegExp;
    minDocuments: number;
    maxDocuments: number;
  };
  minDocuments: number;
  maxDocuments: number;
  concurrency: number;
  maxDocumentBytes?: number;
  discoverySuffix?: ".md" | ".ts";
  requestSuffix?: ".md" | ".ts";
  documents?: {
    id: string;
    url: string;
    format?: SourceFormat;
    maxResponseBytes: number;
  }[];
}

export type SourceField =
  | "model_id"
  | "version"
  | "name"
  | "description"
  | "aliases"
  | "tasks"
  | "delivery_modes"
  | "service_families"
  | "api_endpoints"
  | "routes"
  | "modalities"
  | "capabilities"
  | "limits"
  | "release_date"
  | "updated_date"
  | "pricing"
  | "availability"
  | "status"
  | "release_stage"
  | "deprecated_at"
  | "retired_at"
  | "replacement_model_ids";

export type CoverageField = "limits.context_tokens" | "pricing" | "release_date" | "updated_date";

export interface SourceManifest {
  id: string;
  url: string;
  type: SourceKind;
  source?: SourceKind[];
  access: SourceAccess;
  format: SourceFormat;
  stability: "documented" | "semi_structured" | "undocumented";
  extractor: Extractor;
  extractorVersion: string;
  fields: SourceField[];
  pricingEvidence?: SourcePricingEvidence;
  allowedHosts: string[];
  maxResponseBytes: number;
  scope?: "global" | "account" | "region" | "workspace" | "runtime";
  exhaustive?: boolean;
  role?: "catalog" | "supplement" | "overlay" | "inventory";
  optional?: boolean;
  auth?:
    | { scheme: "bearer"; env: string }
    | { scheme: "header"; env: string; header: string }
    | { scheme: "aws"; envs: [string, string] }
    | { scheme: "azure"; envs: [string, string, string, string, string] }
    | { scheme: "google-service-account"; env: string };
  headers?: { name: string; value: string }[];
  transport?:
    | { kind: "aws-bedrock"; region: string }
    | { kind: "databricks"; hostEnv: string }
    | { kind: "azure-retail-prices" }
    | { kind: "azure-models"; subscriptionEnv: string; locationEnv: string }
    | { kind: "google-model-garden"; publishers: string[] }
    | { kind: "huggingface-models"; maxPages: number; maxModels: number }
    | {
        kind: "vercel-models";
        modelPageBaseUrl: string;
        minModelPages: number;
        maxModelPages: number;
        concurrency: number;
        maxModelPageBytes: number;
        maxEndpointBytes: number;
      }
    | {
        kind: "ollama-cloud";
        catalogUrl: string;
        modelPageBaseUrl: string;
        minModels: number;
        maxModels: number;
        concurrency: number;
        maxModelPageBytes: number;
      };
  linkedDocuments?: LinkedDocuments;
}

function firstPartyPricing(
  kind: SourcePricingEvidence["kind"],
  binding: SourcePricingEvidence["binding"],
  currentness: SourcePricingEvidence["currentness"] = "observed_current",
): SourcePricingEvidence {
  return { authority: "first_party", kind, binding, currentness };
}

export interface PricingCategoricalLabel {
  dimension: PriceDimension;
  value: string;
  label: string;
}

interface ProviderManifestBase {
  provider: Omit<Provider, "source_ids" | "last_successful_sync_at" | "catalog_version">;
  pricingCategoricalLabels?: PricingCategoricalLabel[];
  supersededIdKinds?: ProviderModel["id_kind"][];
  supersededModelIds?: string[];
  warnOnMissing?: {
    sourceId: string;
    fields: CoverageField[];
    statuses?: ProviderModel["status"][];
  };
}

export type ProviderManifest = ProviderManifestBase &
  (
    | {
        sources: [...SourceManifest[], SourceManifest];
        notConfiguredReason?: undefined;
      }
    | {
        sources: [];
        notConfiguredReason: string;
      }
  );

const mebibytes = (value: number): number => value * 1024 * 1024;

type StandardPriceDimension = Extract<PriceDimension, { namespace: "kmodels" }>["value"];

function pricingLabels(
  dimension: StandardPriceDimension,
  labels: Readonly<Record<string, string>>,
): PricingCategoricalLabel[] {
  return Object.entries(labels).map(([value, label]) => ({
    dimension: { namespace: "kmodels", value: dimension },
    value,
    label,
  }));
}

const xaiApiSource = (
  id: string,
  path: string,
  category: "all" | "language" | "image" | "video",
  fields: SourceField[],
): SourceManifest => ({
  id,
  url: `https://api.x.ai/v1/${path}`,
  type: "api",
  access: "authenticated",
  format: "json",
  stability: "documented",
  extractor: { kind: "xai-api", category },
  extractorVersion: "xai-api-v1",
  fields,
  allowedHosts: ["api.x.ai"],
  maxResponseBytes: mebibytes(4),
  scope: "account",
  exhaustive: false,
  role: "inventory",
  optional: true,
  auth: { scheme: "bearer", env: "XAI_API_KEY" },
});

const huggingFaceInferenceSource: SourceManifest = {
  id: "huggingface-hf-inference",
  url: "https://huggingface.co/api/partners/hf-inference/models?status=live",
  type: "api",
  access: "public",
  format: "json",
  stability: "documented",
  extractor: {
    kind: "huggingface-mapping",
    provider: "hf-inference",
    minModels: 500,
    maxModels: 3_000,
  },
  extractorVersion: "huggingface-mapping-v3",
  pricingEvidence: firstPartyPricing("commercial_terms", "exact_id"),
  fields: ["model_id", "routes", "tasks", "modalities", "pricing", "status"],
  allowedHosts: ["huggingface.co"],
  maxResponseBytes: mebibytes(8),
  scope: "global",
  exhaustive: true,
  role: "catalog",
};

const dashscopeCatalogSource = (
  id: string,
  path: string,
  category: Extract<Extractor, { kind: "dashscope-catalog" }>["category"],
  minModels: number,
  maxModels: number,
): SourceManifest => ({
  id,
  url: `https://www.alibabacloud.com/help/en/model-studio/${path}`,
  type: "website",
  access: "public",
  format: "html",
  stability: "semi_structured",
  extractor: { kind: "dashscope-catalog", category, minModels, maxModels },
  extractorVersion: "dashscope-catalog-v2",
  fields: [
    "model_id",
    "description",
    "tasks",
    "modalities",
    "capabilities",
    "limits",
    "status",
    "release_stage",
  ],
  allowedHosts: ["www.alibabacloud.com"],
  maxResponseBytes: mebibytes(2),
  scope: "region",
  exhaustive: false,
  role: "catalog",
});

const kimiPricingSource = (
  id: string,
  origin: string,
  region: "China" | "International",
  currency: "CNY" | "USD",
  symbol: "¥" | "$",
): SourceManifest => ({
  id,
  url: `${origin}/docs/pricing/chat-k3`,
  type: "website",
  access: "public",
  format: "markdown",
  stability: "semi_structured",
  extractor: { kind: "kimi-pricing", region, currency, symbol, minModels: 8, maxModels: 20 },
  extractorVersion: "kimi-pricing-v4",
  pricingEvidence: firstPartyPricing("price_book", "exact_id"),
  fields: [
    "model_id",
    "name",
    "tasks",
    "modalities",
    "api_endpoints",
    "capabilities",
    "limits",
    "pricing",
  ],
  allowedHosts: [new URL(origin).hostname],
  maxResponseBytes: mebibytes(8),
  scope: "region",
  exhaustive: false,
  role: "catalog",
  linkedDocuments: {
    indexFormat: "markdown",
    path: /^$/,
    minDocuments: 0,
    maxDocuments: 0,
    concurrency: 6,
    maxDocumentBytes: mebibytes(1),
    documents: (
      [
        ["k27", "/docs/pricing/chat-k27-code"],
        ["k26", "/docs/pricing/chat-k26"],
        ["k25", "/docs/pricing/chat-k25"],
        ["v1", "/docs/pricing/chat-v1"],
        ["batch", "/docs/pricing/batch"],
        ["pricing", "/docs/pricing/chat"],
        ["tools-pricing", "/docs/pricing/tools"],
        ["limits", "/docs/pricing/limits"],
        ["batch-api", "/docs/api/batch-create"],
        ["chat-api", "/docs/api/chat"],
        ["estimate-api", "/docs/api/estimate"],
        ["balance-api", "/docs/api/balance"],
        ["cache", "/docs/guide/use-context-caching-feature-of-kimi-api"],
        ["web-search", "/docs/guide/use-web-search"],
        ["official-tools", "/docs/guide/use-official-tools"],
        ["batch-guide", "/docs/guide/use-batch-api"],
        ["batch-console", "/docs/guide/use-batch-inference"],
        ["account", "/docs/guide/account-and-payments"],
        ["organization", "/docs/guide/org-best-practice"],
        ["product-plans", "/docs/guide/product-plans"],
        ["introduction", "/docs/introduction"],
        ["documentation-index", "/docs/llms.txt"],
      ] as const
    ).map(([id, path]) => ({
      id,
      url: `${origin}${path}`,
      maxResponseBytes: mebibytes(1),
    })),
  },
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
      {
        id: "openai-models",
        url: "https://developers.openai.com/api/docs/models/all",
        type: "website",
        access: "public",
        format: "html",
        stability: "semi_structured",
        extractor: { kind: "openai-catalog" },
        extractorVersion: "openai-catalog-v5",
        pricingEvidence: firstPartyPricing("model_catalog", "exact_id"),
        fields: [
          "model_id",
          "name",
          "description",
          "aliases",
          "tasks",
          "api_endpoints",
          "modalities",
          "capabilities",
          "limits",
          "pricing",
          "status",
          "release_stage",
        ],
        allowedHosts: ["developers.openai.com"],
        maxResponseBytes: mebibytes(64),
        scope: "global",
        exhaustive: true,
        role: "catalog",
        linkedDocuments: {
          path: /^\/api\/docs\/models\/[a-z0-9._-]+$/,
          minDocuments: 80,
          maxDocuments: 140,
          concurrency: 8,
          maxDocumentBytes: mebibytes(2),
        },
      },
      {
        id: "openai-overview",
        url: "https://developers.openai.com/api/docs/models",
        type: "website",
        access: "public",
        format: "html",
        stability: "semi_structured",
        extractor: { kind: "openai-overview" },
        extractorVersion: "openai-overview-v1",
        fields: ["aliases"],
        allowedHosts: ["developers.openai.com"],
        maxResponseBytes: mebibytes(4),
        scope: "global",
        exhaustive: false,
        role: "overlay",
        optional: true,
      },
      {
        id: "openai-deprecations",
        url: "https://developers.openai.com/api/docs/deprecations",
        type: "website",
        access: "public",
        format: "html",
        stability: "semi_structured",
        extractor: { kind: "openai-deprecations" },
        extractorVersion: "openai-deprecations-v2",
        fields: ["aliases", "status", "release_stage", "retired_at", "replacement_model_ids"],
        allowedHosts: ["developers.openai.com"],
        maxResponseBytes: mebibytes(8),
        scope: "global",
        exhaustive: false,
        role: "supplement",
        optional: true,
      },
      {
        id: "openai-data-residency",
        url: "https://developers.openai.com/api/docs/guides/your-data.md",
        type: "website",
        access: "public",
        format: "markdown",
        stability: "semi_structured",
        extractor: { kind: "openai-data-residency", minModels: 30, maxModels: 100 },
        extractorVersion: "openai-data-residency-v1",
        fields: ["model_id", "tasks", "api_endpoints", "availability"],
        allowedHosts: ["developers.openai.com"],
        maxResponseBytes: mebibytes(1),
        scope: "global",
        exhaustive: false,
        role: "supplement",
        optional: true,
      },
      {
        id: "openai-pricing",
        url: "https://developers.openai.com/api/docs/pricing.md",
        type: "website",
        access: "public",
        format: "markdown",
        stability: "semi_structured",
        extractor: { kind: "openai-pricing", minModels: 30, maxModels: 100 },
        extractorVersion: "openai-pricing-v2",
        pricingEvidence: firstPartyPricing("price_book", "exact_or_documented_alias"),
        fields: ["model_id", "tasks", "pricing"],
        allowedHosts: ["developers.openai.com"],
        maxResponseBytes: mebibytes(1),
        scope: "global",
        exhaustive: false,
        role: "supplement",
      },
      {
        id: "openai-api",
        url: "https://api.openai.com/v1/models",
        type: "api",
        access: "authenticated",
        format: "json",
        stability: "documented",
        extractor: { kind: "openai-api" },
        extractorVersion: "openai-api-v1",
        fields: ["model_id"],
        allowedHosts: ["api.openai.com"],
        maxResponseBytes: mebibytes(4),
        scope: "account",
        exhaustive: false,
        role: "inventory",
        optional: true,
        auth: { scheme: "bearer", env: "OPENAI_API_KEY" },
      },
    ],
    warnOnMissing: {
      sourceId: "openai-models",
      fields: ["limits.context_tokens", "pricing"],
    },
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
    pricingCategoricalLabels: pricingLabels("inference_geo", { global: "Global", us: "US" }),
    sources: [
      {
        id: "anthropic-models",
        url: "https://platform.claude.com/docs/en/about-claude/models/overview.md",
        type: "website",
        access: "public",
        format: "markdown",
        stability: "semi_structured",
        extractor: { kind: "anthropic-catalog" },
        extractorVersion: "anthropic-catalog-v7",
        pricingEvidence: firstPartyPricing("price_book", "exact_or_documented_alias"),
        fields: [
          "model_id",
          "name",
          "description",
          "aliases",
          "tasks",
          "api_endpoints",
          "modalities",
          "capabilities",
          "limits",
          "release_date",
          "pricing",
          "status",
          "release_stage",
          "deprecated_at",
          "retired_at",
          "replacement_model_ids",
        ],
        allowedHosts: ["platform.claude.com"],
        maxResponseBytes: mebibytes(8),
        scope: "global",
        exhaustive: true,
        role: "catalog",
        linkedDocuments: {
          path: /^\/docs\/en\/about-claude\/(?:pricing|model-deprecations|models\/introducing-claude-fable-5-and-claude-mythos-5)$/,
          minDocuments: 3,
          maxDocuments: 3,
          concurrency: 3,
          maxDocumentBytes: mebibytes(2),
          requestSuffix: ".md",
          documents: [
            {
              id: "messages-create",
              url: "https://platform.claude.com/docs/en/api/messages/create.md",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "message-batches-create",
              url: "https://platform.claude.com/docs/en/api/messages/batches/create.md",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "batch-processing",
              url: "https://platform.claude.com/docs/en/build-with-claude/batch-processing.md",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "citations",
              url: "https://platform.claude.com/docs/en/build-with-claude/citations.md",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "pdf-support",
              url: "https://platform.claude.com/docs/en/build-with-claude/pdf-support.md",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "context-editing",
              url: "https://platform.claude.com/docs/en/build-with-claude/context-editing.md",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "structured-outputs",
              url: "https://platform.claude.com/docs/en/build-with-claude/structured-outputs.md",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "code-execution",
              url: "https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool.md",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "computer-use",
              url: "https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool.md",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "effort",
              url: "https://platform.claude.com/docs/en/build-with-claude/effort.md",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "prompt-caching",
              url: "https://platform.claude.com/docs/en/build-with-claude/prompt-caching.md",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "glossary",
              url: "https://platform.claude.com/docs/en/about-claude/glossary.md",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "thinking",
              url: "https://platform.claude.com/docs/en/build-with-claude/thinking.md",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "tool-use",
              url: "https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use.md",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "fast-mode",
              url: "https://platform.claude.com/docs/en/build-with-claude/fast-mode.md",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "release-notes",
              url: "https://platform.claude.com/docs/en/release-notes/overview.md",
              maxResponseBytes: mebibytes(4),
            },
          ],
        },
      },
      {
        id: "anthropic-api",
        url: "https://api.anthropic.com/v1/models?limit=1000",
        type: "api",
        access: "authenticated",
        format: "json",
        stability: "documented",
        extractor: { kind: "anthropic-api" },
        extractorVersion: "anthropic-api-v1",
        fields: ["name", "release_date", "modalities", "capabilities", "limits"],
        allowedHosts: ["api.anthropic.com"],
        maxResponseBytes: mebibytes(4),
        scope: "account",
        exhaustive: false,
        role: "inventory",
        optional: true,
        auth: { scheme: "header", env: "ANTHROPIC_API_KEY", header: "x-api-key" },
        headers: [{ name: "anthropic-version", value: "2023-06-01" }],
      },
    ],
    warnOnMissing: {
      sourceId: "anthropic-models",
      fields: ["limits.context_tokens", "pricing"],
      statuses: ["active", "deprecated"],
    },
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
    pricingCategoricalLabels: [
      ...pricingLabels("deployment_scope", {
        geo_cross_region: "Geographic Cross-Region",
        global_cross_region: "Global Cross-Region",
        in_region: "In-Region",
      }),
      ...pricingLabels("endpoint", {
        "bedrock-mantle": "Bedrock Mantle",
        "bedrock-runtime": "Bedrock Runtime",
      }),
      ...pricingLabels("operation", {
        I2I: "Image to image",
        I2V: "Image to video",
        T2I: "Text to image",
        T2V: "Text to video",
      }),
      ...pricingLabels("service_tier", {
        provisioned_1_month: "Provisioned (1-month commitment)",
        provisioned_6_month: "Provisioned (6-month commitment)",
        provisioned_no_commit: "Provisioned (no commitment)",
        reserved_1_month: "Reserved (1-month commitment)",
        reserved_3_month: "Reserved (3-month commitment)",
      }),
    ],
    sources: [
      {
        id: "bedrock-models",
        url: "https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards.md",
        type: "website",
        source: ["website", "api"],
        access: "public",
        format: "mixed",
        stability: "semi_structured",
        extractor: { kind: "bedrock-catalog" },
        extractorVersion: "bedrock-catalog-v11",
        pricingEvidence: firstPartyPricing(
          "billing_catalog",
          "reviewed_unique_join",
          "current_snapshot",
        ),
        fields: [
          "model_id",
          "name",
          "description",
          "aliases",
          "tasks",
          "api_endpoints",
          "modalities",
          "capabilities",
          "limits",
          "release_date",
          "pricing",
          "availability",
          "status",
          "release_stage",
          "deprecated_at",
          "retired_at",
        ],
        allowedHosts: ["aws.amazon.com", "docs.aws.amazon.com", "pricing.us-east-1.amazonaws.com"],
        maxResponseBytes: mebibytes(32),
        scope: "global",
        exhaustive: true,
        role: "catalog",
        linkedDocuments: {
          path: /^\/bedrock\/latest\/userguide\/model-card-[a-z0-9-]+\.md$/,
          indexFormat: "markdown",
          nestedIndexes: {
            path: /^\/bedrock\/latest\/userguide\/model-cards-[a-z0-9-]+\.md$/,
            minDocuments: 10,
            maxDocuments: 30,
          },
          minDocuments: 100,
          maxDocuments: 200,
          concurrency: 8,
          maxDocumentBytes: mebibytes(2),
          documents: [
            {
              id: "bedrock-mantle",
              url: "https://docs.aws.amazon.com/bedrock/latest/userguide/bedrock-mantle.md",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "bedrock-public-pricing",
              url: "https://aws.amazon.com/bedrock/pricing/",
              format: "html",
              maxResponseBytes: mebibytes(8),
            },
            {
              id: "pricing-bedrock",
              url: "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrock/current/index.json",
              maxResponseBytes: mebibytes(20),
            },
            {
              id: "pricing-foundation-models",
              url: "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrockFoundationModels/current/index.json",
              maxResponseBytes: mebibytes(8),
            },
            {
              id: "pricing-service",
              url: "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrockService/current/index.json",
              maxResponseBytes: mebibytes(2),
            },
          ],
        },
      },
      {
        id: "bedrock-api-us-east-1",
        url: "https://bedrock.us-east-1.amazonaws.com/foundation-models",
        type: "api",
        access: "authenticated",
        format: "json",
        stability: "documented",
        extractor: { kind: "bedrock-api" },
        extractorVersion: "bedrock-api-v3",
        fields: [
          "name",
          "modalities",
          "capabilities",
          "release_date",
          "status",
          "release_stage",
          "deprecated_at",
          "retired_at",
        ],
        allowedHosts: ["bedrock.us-east-1.amazonaws.com"],
        maxResponseBytes: mebibytes(4),
        scope: "region",
        exhaustive: false,
        role: "inventory",
        optional: true,
        auth: {
          scheme: "aws",
          envs: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"],
        },
        transport: { kind: "aws-bedrock", region: "us-east-1" },
      },
    ],
    supersededIdKinds: ["display_name"],
    warnOnMissing: {
      sourceId: "bedrock-models",
      fields: ["limits.context_tokens", "pricing"],
      statuses: ["active", "deprecated"],
    },
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
    pricingCategoricalLabels: [
      ...pricingLabels("capacity", { entry: "Entry", scaling: "Scaling" }),
      ...pricingLabels("endpoint", {
        global: "Global",
        global_or_in_geo: "Global or In-geo",
        in_geo: "In-geo",
      }),
      ...pricingLabels("service_tier", { batch: "Batch" }),
    ],
    sources: [
      {
        id: "databricks-models",
        url: "https://docs.databricks.com/aws/en/machine-learning/foundation-model-apis/supported-models",
        type: "website",
        access: "public",
        format: "mixed",
        stability: "semi_structured",
        extractor: { kind: "databricks-catalog", minModels: 40, maxModels: 80 },
        extractorVersion: "databricks-catalog-v6",
        pricingEvidence: firstPartyPricing("price_book", "reviewed_unique_join"),
        fields: [
          "model_id",
          "name",
          "description",
          "tasks",
          "api_endpoints",
          "modalities",
          "capabilities",
          "limits",
          "release_date",
          "pricing",
          "status",
          "release_stage",
          "deprecated_at",
          "retired_at",
          "replacement_model_ids",
        ],
        allowedHosts: ["ai.google.dev", "docs.databricks.com", "www.databricks.com"],
        maxResponseBytes: mebibytes(16),
        scope: "region",
        exhaustive: true,
        role: "catalog",
        linkedDocuments: {
          path: /^$/,
          indexFormat: "html",
          minDocuments: 0,
          maxDocuments: 0,
          concurrency: 4,
          documents: [
            {
              id: "overview",
              url: "https://docs.databricks.com/aws/en/machine-learning/model-serving/foundation-model-overview",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "lifecycle",
              url: "https://docs.databricks.com/aws/en/machine-learning/retired-models-policy",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "pricing-open",
              url: "https://www.databricks.com/product/pricing/foundation-model-serving",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "pricing-partner",
              url: "https://www.databricks.com/product/pricing/proprietary-foundation-model-serving",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "priority-mode",
              url: "https://docs.databricks.com/aws/en/machine-learning/foundation-model-apis/priority-mode",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "google-image-pricing",
              url: "https://ai.google.dev/gemini-api/docs/pricing?hl=en",
              maxResponseBytes: mebibytes(4),
            },
            {
              id: "limits",
              url: "https://docs.databricks.com/aws/en/machine-learning/foundation-model-apis/limits",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "api-reference",
              url: "https://docs.databricks.com/aws/en/machine-learning/foundation-model-apis/api-reference",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "model-types",
              url: "https://docs.databricks.com/aws/en/machine-learning/model-serving/score-foundation-models",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "release-feed",
              url: "https://docs.databricks.com/aws/en/feed.xml",
              maxResponseBytes: mebibytes(2),
            },
          ],
        },
      },
      {
        id: "databricks-api",
        url: "https://workspace.cloud.databricks.com/api/2.0/serving-endpoints",
        type: "api",
        access: "authenticated",
        format: "json",
        stability: "documented",
        extractor: { kind: "databricks-api" },
        extractorVersion: "databricks-api-v1",
        fields: ["tasks", "modalities"],
        allowedHosts: ["workspace.cloud.databricks.com"],
        maxResponseBytes: mebibytes(8),
        scope: "workspace",
        exhaustive: false,
        role: "inventory",
        optional: true,
        auth: { scheme: "bearer", env: "DATABRICKS_TOKEN" },
        transport: { kind: "databricks", hostEnv: "DATABRICKS_HOST" },
      },
    ],
    supersededIdKinds: ["display_name"],
    warnOnMissing: {
      sourceId: "databricks-models",
      fields: ["limits.context_tokens", "pricing", "release_date"],
      statuses: ["active", "deprecated"],
    },
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
    pricingCategoricalLabels: [
      ...pricingLabels("quality", { std: "Standard" }),
      ...pricingLabels("region", { eu: "EU", us: "US" }),
      ...pricingLabels("resolution", { "2k": "2K", "4k": "4K" }),
    ],
    sources: [
      {
        id: "vercel-models",
        url: "https://ai-gateway.vercel.sh/v1/models",
        type: "api",
        source: ["api", "website"],
        access: "public",
        format: "json",
        stability: "documented",
        extractor: { kind: "vercel-catalog", minModels: 250, maxModels: 600 },
        extractorVersion: "vercel-catalog-v9",
        pricingEvidence: firstPartyPricing("model_catalog", "exact_id", "current_snapshot"),
        fields: [
          "model_id",
          "name",
          "description",
          "tasks",
          "delivery_modes",
          "modalities",
          "capabilities",
          "limits",
          "release_date",
          "pricing",
          "status",
          "release_stage",
          "deprecated_at",
          "availability",
          "routes",
        ],
        allowedHosts: ["ai-gateway.vercel.sh", "vercel.com"],
        maxResponseBytes: mebibytes(32),
        scope: "global",
        exhaustive: true,
        role: "catalog",
        transport: {
          kind: "vercel-models",
          modelPageBaseUrl: "https://vercel.com/ai-gateway/models/",
          minModelPages: 0,
          maxModelPages: 50,
          concurrency: 12,
          maxModelPageBytes: mebibytes(2),
          maxEndpointBytes: mebibytes(1),
        },
        linkedDocuments: {
          path: /$^/,
          minDocuments: 0,
          maxDocuments: 0,
          concurrency: 6,
          documents: [
            {
              id: "pricing-policy",
              url: "https://vercel.com/docs/ai-gateway/pricing.md",
              format: "markdown",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "provider-options",
              url: "https://vercel.com/docs/ai-gateway/models-and-providers/provider-options.md",
              format: "markdown",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "rest-api",
              url: "https://vercel.com/docs/ai-gateway/sdks-and-apis/rest-api.md",
              format: "markdown",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "custom-reporting",
              url: "https://vercel.com/docs/ai-gateway/observability-and-spend/custom-reporting.md",
              format: "markdown",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "logs",
              url: "https://vercel.com/docs/ai-gateway/observability-and-spend/logs.md",
              format: "markdown",
              maxResponseBytes: mebibytes(1),
            },
          ],
        },
      },
    ],
    warnOnMissing: {
      sourceId: "vercel-models",
      fields: ["pricing"],
      statuses: ["active", "deprecated"],
    },
  },
  {
    provider: {
      id: "azure",
      name: "Microsoft Foundry",
      kind: "cloud_platform",
      homepage: "https://azure.microsoft.com/products/ai-foundry/",
      docs_url:
        "https://learn.microsoft.com/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure",
      catalog_scope: "mixed",
    },
    pricingCategoricalLabels: [
      ...pricingLabels("deployment_scope", {
        DataZoneBatch: "Data Zone Batch",
        DataZoneStandard: "Data Zone Standard",
        GlobalBatch: "Global Batch",
        GlobalStandard: "Global Standard",
      }),
      ...pricingLabels("region", {
        australiaeast: "Australia East",
        australiasoutheast: "Australia Southeast",
        brazilsouth: "Brazil South",
        canadacentral: "Canada Central",
        canadaeast: "Canada East",
        centralindia: "Central India",
        centralus: "Central US",
        denmarkeast: "Denmark East",
        eastasia: "East Asia",
        eastus: "East US",
        eastus2: "East US 2",
        francecentral: "France Central",
        germanywestcentral: "Germany West Central",
        Global: "Global",
        indonesiacentral: "Indonesia Central",
        italynorth: "Italy North",
        japaneast: "Japan East",
        japanwest: "Japan West",
        jioindiawest: "Jio India West",
        koreacentral: "Korea Central",
        malaysiawest: "Malaysia West",
        northcentralus: "North Central US",
        northeurope: "North Europe",
        norwayeast: "Norway East",
        polandcentral: "Poland Central",
        qatarcentral: "Qatar Central",
        southafricanorth: "South Africa North",
        southcentralus: "South Central US",
        southeastasia: "Southeast Asia",
        southindia: "South India",
        spaincentral: "Spain Central",
        swedencentral: "Sweden Central",
        switzerlandnorth: "Switzerland North",
        switzerlandwest: "Switzerland West",
        uaenorth: "UAE North",
        uksouth: "UK South",
        ukwest: "UK West",
        usgovarizona: "US Gov Arizona",
        usgovvirginia: "US Gov Virginia",
        westcentralus: "West Central US",
        westeurope: "West Europe",
        westus: "West US",
        westus2: "West US 2",
        westus3: "West US 3",
      }),
    ],
    sources: [
      {
        id: "azure-models",
        url: "https://raw.githubusercontent.com/MicrosoftDocs/azure-ai-docs/main/articles/foundry/openai/includes/models-azure-direct-openai.md",
        type: "repository",
        access: "public",
        format: "markdown",
        stability: "semi_structured",
        extractor: { kind: "azure-catalog", minModels: 120, maxModels: 300 },
        extractorVersion: "azure-catalog-v5",
        fields: [
          "model_id",
          "version",
          "tasks",
          "service_families",
          "api_endpoints",
          "modalities",
          "capabilities",
          "limits",
          "availability",
          "status",
          "release_stage",
          "retired_at",
          "replacement_model_ids",
        ],
        allowedHosts: ["raw.githubusercontent.com"],
        maxResponseBytes: mebibytes(8),
        scope: "global",
        exhaustive: false,
        role: "catalog",
        linkedDocuments: {
          path: /^$/,
          minDocuments: 0,
          maxDocuments: 0,
          concurrency: 7,
          documents: [
            {
              id: "direct-others",
              url: "https://raw.githubusercontent.com/MicrosoftDocs/azure-ai-docs/main/articles/foundry/foundry-models/includes/models-azure-direct-others.md",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "partners",
              url: "https://raw.githubusercontent.com/MicrosoftDocs/azure-ai-docs/main/articles/foundry/foundry-models/includes/models-partners.md",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "lifecycle",
              url: "https://raw.githubusercontent.com/MicrosoftDocs/azure-ai-docs/main/articles/foundry/openai/includes/concepts-model-retirement-schedule-content.md",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "retired",
              url: "https://raw.githubusercontent.com/MicrosoftDocs/azure-ai-docs/main/articles/foundry/openai/includes/concepts-retired-models-content.md",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "standard",
              url: "https://raw.githubusercontent.com/MicrosoftDocs/azure-ai-docs/main/articles/foundry/foundry-models/includes/model-matrix/deployments-standard.md",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "provisioned",
              url: "https://raw.githubusercontent.com/MicrosoftDocs/azure-ai-docs/main/articles/foundry/foundry-models/includes/model-matrix/deployments-provisioned.md",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "batch",
              url: "https://raw.githubusercontent.com/MicrosoftDocs/azure-ai-docs/main/articles/foundry/foundry-models/includes/model-matrix/deployments-batch.md",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "openai-v1",
              url: "https://raw.githubusercontent.com/Azure/azure-rest-api-specs/main/specification/ai/data-plane/OpenAI.v1/azure-v1-v1-generated.yaml",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "openai-v1-preview",
              url: "https://raw.githubusercontent.com/Azure/azure-rest-api-specs/main/specification/ai/data-plane/OpenAI.v1/azure-v1-preview-generated.yaml",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "foundry-costs",
              url: "https://raw.githubusercontent.com/MicrosoftDocs/azure-ai-docs/main/articles/foundry/concepts/manage-costs.md",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "openai-prompt-caching",
              url: "https://raw.githubusercontent.com/MicrosoftDocs/azure-ai-docs/main/articles/foundry/openai/includes/how-to-prompt-caching-content.md",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "claude-billing",
              url: "https://raw.githubusercontent.com/MicrosoftDocs/azure-ai-docs/main/articles/foundry/foundry-models/concepts/claude-models-billing.md",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "cost-management-automation",
              url: "https://raw.githubusercontent.com/MicrosoftDocs/azure-docs/main/articles/cost-management-billing/costs/manage-automation.md",
              maxResponseBytes: mebibytes(1),
            },
          ],
        },
      },
      {
        id: "azure-retail-prices",
        url: "https://prices.azure.com/api/retail/prices",
        type: "api",
        access: "public",
        format: "json",
        stability: "documented",
        extractor: {
          kind: "azure-retail-prices",
          minModels: 20,
          maxModels: 200,
          minHandledRatio: 0.7,
        },
        extractorVersion: "azure-retail-prices-v5",
        pricingEvidence: firstPartyPricing(
          "billing_catalog",
          "reviewed_unique_join",
          "current_snapshot",
        ),
        fields: ["pricing"],
        allowedHosts: ["prices.azure.com"],
        maxResponseBytes: mebibytes(32),
        scope: "global",
        exhaustive: false,
        role: "overlay",
        transport: { kind: "azure-retail-prices" },
      },
      {
        id: "azure-claude-pricing",
        url: "https://platform.claude.com/docs/en/about-claude/pricing.md",
        type: "website",
        access: "public",
        format: "markdown",
        stability: "documented",
        extractor: { kind: "azure-claude-pricing", minModels: 5, maxModels: 30 },
        extractorVersion: "azure-claude-pricing-v1",
        pricingEvidence: firstPartyPricing(
          "price_book",
          "exact_or_documented_alias",
          "observed_current",
        ),
        fields: ["pricing"],
        allowedHosts: ["platform.claude.com"],
        maxResponseBytes: mebibytes(2),
        scope: "global",
        exhaustive: false,
        role: "overlay",
      },
      {
        id: "azure-api",
        url: "https://management.azure.com/subscriptions/00000000-0000-0000-0000-000000000000/providers/Microsoft.CognitiveServices/locations/location/models?api-version=2025-06-01",
        type: "api",
        access: "authenticated",
        format: "json",
        stability: "documented",
        extractor: { kind: "azure-api" },
        extractorVersion: "azure-api-v2",
        pricingEvidence: firstPartyPricing("scoped_meter_inventory", "meter_id", "scoped_current"),
        fields: [
          "model_id",
          "version",
          "description",
          "tasks",
          "modalities",
          "capabilities",
          "limits",
          "pricing",
          "availability",
          "status",
          "release_stage",
          "retired_at",
        ],
        allowedHosts: ["management.azure.com", "login.microsoftonline.com", "prices.azure.com"],
        maxResponseBytes: mebibytes(32),
        scope: "region",
        exhaustive: false,
        role: "inventory",
        optional: true,
        auth: {
          scheme: "azure",
          envs: [
            "AZURE_TENANT_ID",
            "AZURE_CLIENT_ID",
            "AZURE_CLIENT_SECRET",
            "AZURE_SUBSCRIPTION_ID",
            "AZURE_LOCATION",
          ],
        },
        transport: {
          kind: "azure-models",
          subscriptionEnv: "AZURE_SUBSCRIPTION_ID",
          locationEnv: "AZURE_LOCATION",
        },
      },
    ],
    supersededIdKinds: ["display_name"],
    supersededModelIds: ["Cohere-command-a", "Mistral-medium-2505", "Mistral-small-2503"],
    warnOnMissing: {
      sourceId: "azure-models",
      fields: ["limits.context_tokens", "pricing", "release_date"],
      statuses: ["active", "deprecated"],
    },
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
    pricingCategoricalLabels: [
      ...pricingLabels("operation", {
        google_maps: "Google Maps",
        google_search: "Google Search",
      }),
      ...pricingLabels("resolution", { "4k": "4K" }),
    ],
    sources: [
      {
        id: "gemini-models",
        url: "https://ai.google.dev/gemini-api/docs/models",
        type: "website",
        access: "public",
        format: "html",
        stability: "semi_structured",
        extractor: { kind: "gemini-catalog", minModels: 50, maxModels: 160 },
        extractorVersion: "gemini-catalog-v6",
        pricingEvidence: firstPartyPricing("price_book", "exact_or_documented_alias"),
        fields: [
          "model_id",
          "name",
          "description",
          "aliases",
          "tasks",
          "api_endpoints",
          "modalities",
          "capabilities",
          "limits",
          "release_date",
          "updated_date",
          "pricing",
          "status",
          "release_stage",
          "retired_at",
          "replacement_model_ids",
        ],
        headers: [{ name: "Accept-Language", value: "en-US,en;q=0.9" }],
        allowedHosts: ["ai.google.dev", "docs.cloud.google.com"],
        maxResponseBytes: mebibytes(32),
        scope: "global",
        exhaustive: true,
        role: "catalog",
        linkedDocuments: {
          path: /^\/gemini-api\/docs\/(?:models\/[a-z0-9.-]+|robotics-overview)$/,
          minDocuments: 30,
          maxDocuments: 60,
          concurrency: 8,
          maxDocumentBytes: mebibytes(1),
          documents: [
            {
              id: "pricing",
              url: "https://ai.google.dev/gemini-api/docs/pricing",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "deprecations",
              url: "https://ai.google.dev/gemini-api/docs/deprecations",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "changelog",
              url: "https://ai.google.dev/gemini-api/docs/changelog",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "gemma-api",
              url: "https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "gemma-card",
              url: "https://ai.google.dev/gemma/docs/core/model_card_4",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "interactions-overview",
              url: "https://ai.google.dev/gemini-api/docs/interactions-overview",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "interactions-api",
              url: "https://ai.google.dev/api/interactions-api",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "all-methods",
              url: "https://ai.google.dev/api/all-methods",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "live-api",
              url: "https://ai.google.dev/api/live",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "billing",
              url: "https://ai.google.dev/gemini-api/docs/billing",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "implicit-caching",
              url: "https://ai.google.dev/gemini-api/docs/caching",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "explicit-caching",
              url: "https://ai.google.dev/gemini-api/docs/generate-content/caching",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "tokens",
              url: "https://ai.google.dev/gemini-api/docs/tokens",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "generate-content-api",
              url: "https://ai.google.dev/api/generate-content",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "flex-inference",
              url: "https://ai.google.dev/gemini-api/docs/flex-inference",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "priority-inference",
              url: "https://ai.google.dev/gemini-api/docs/priority-inference",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "google-search",
              url: "https://ai.google.dev/gemini-api/docs/google-search",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "google-maps",
              url: "https://ai.google.dev/gemini-api/docs/maps-grounding",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "cloud-pricing-api",
              url: "https://docs.cloud.google.com/billing/docs/how-to/get-pricing-information-api",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "cloud-billing-export",
              url: "https://docs.cloud.google.com/billing/docs/how-to/export-data-bigquery-tables",
              maxResponseBytes: mebibytes(2),
            },
          ],
        },
      },
      {
        id: "gemini-api",
        url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
        type: "api",
        access: "authenticated",
        format: "json",
        stability: "documented",
        extractor: { kind: "gemini-api" },
        extractorVersion: "gemini-api-v2",
        fields: [
          "name",
          "description",
          "aliases",
          "tasks",
          "api_endpoints",
          "capabilities",
          "limits",
        ],
        allowedHosts: ["generativelanguage.googleapis.com"],
        maxResponseBytes: mebibytes(8),
        scope: "account",
        exhaustive: false,
        role: "inventory",
        optional: true,
        auth: { scheme: "header", env: "GEMINI_API_KEY", header: "x-goog-api-key" },
      },
    ],
    supersededModelIds: ["gemini-2.5-flash-preview-09-2025", "gemini-flash-latest"],
    warnOnMissing: {
      sourceId: "gemini-models",
      fields: ["limits.context_tokens", "pricing", "release_date", "updated_date"],
      statuses: ["active", "deprecated"],
    },
  },
  {
    provider: {
      id: "vertex",
      name: "Vertex AI",
      kind: "cloud_platform",
      homepage: "https://cloud.google.com/vertex-ai/",
      docs_url: "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models",
      catalog_scope: "regional",
    },
    pricingCategoricalLabels: [
      ...pricingLabels("deployment_scope", { "non-global": "Non-global" }),
      ...pricingLabels("resolution", { "4k": "4K" }),
    ],
    sources: [
      {
        id: "vertex-google-models",
        url: "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/google-models",
        type: "website",
        access: "public",
        format: "mixed",
        stability: "semi_structured",
        extractor: {
          kind: "vertex-catalog",
          minModels: 25,
          maxModels: 90,
          minModelDocuments: 20,
          maxModelDocuments: 40,
          minPricingCoverage: 0.8,
        },
        extractorVersion: "vertex-catalog-v5",
        pricingEvidence: firstPartyPricing("price_book", "reviewed_unique_join"),
        fields: [
          "model_id",
          "name",
          "description",
          "tasks",
          "service_families",
          "api_endpoints",
          "modalities",
          "capabilities",
          "limits",
          "release_date",
          "pricing",
          "availability",
          "status",
          "release_stage",
          "retired_at",
          "replacement_model_ids",
        ],
        allowedHosts: ["docs.cloud.google.com", "cloud.google.com"],
        headers: [{ name: "Accept-Language", value: "en-US,en;q=0.9" }],
        maxResponseBytes: mebibytes(48),
        scope: "region",
        exhaustive: false,
        role: "catalog",
        linkedDocuments: {
          indexFormat: "html",
          path: /^\/gemini-enterprise-agent-platform\/models\/(?:gemini\/(?!gemini-robotics-er$)|veo\/|lyria\/)[a-z0-9-]+$/,
          minDocuments: 20,
          maxDocuments: 40,
          concurrency: 8,
          maxDocumentBytes: mebibytes(2),
          documents: [
            {
              id: "lifecycle",
              url: "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/model-versions",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "imagen",
              url: "https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/imagen/4-0-generate",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "generate-api",
              url: "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/start",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "embedding-api",
              url: "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/embeddings/get-multimodal-embeddings",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "text-embedding-api",
              url: "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/embeddings/get-text-embeddings",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "image-api",
              url: "https://docs.cloud.google.com/vertex-ai/generative-ai/docs/image/generate-images",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "video-api",
              url: "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/video/generate-videos-from-text",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "music-api",
              url: "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/music/generate-music",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "pricing",
              url: "https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing",
              maxResponseBytes: mebibytes(6),
            },
            {
              id: "billing-skus",
              url: "https://cloud.google.com/skus/sku-groups/select-google-cloud-offerings",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "usage-response",
              url: "https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/rest/v1/GenerateContentResponse",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "grounding-response",
              url: "https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/rest/v1/GroundingMetadata",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "grounding-search",
              url: "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/grounding/grounding-with-google-search",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "grounding-maps",
              url: "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/grounding/grounding-with-google-maps",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "grounding-data",
              url: "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/grounding/grounding-with-vertex-ai-search",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "standard-paygo",
              url: "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/standard-paygo",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "flex-paygo",
              url: "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/flex-paygo",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "priority-paygo",
              url: "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/priority-paygo",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "provisioned-throughput-routing",
              url: "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/provisioned-throughput/use-provisioned-throughput",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "provisioned-throughput-accounting",
              url: "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/provisioned-throughput/measure-provisioned-throughput",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "cloud-pricing-api",
              url: "https://docs.cloud.google.com/billing/docs/how-to/get-pricing-information-api",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "cloud-billing-export",
              url: "https://docs.cloud.google.com/billing/docs/how-to/export-data-bigquery-tables/standard-usage",
              maxResponseBytes: mebibytes(2),
            },
          ],
        },
      },
      {
        id: "vertex-partner-models",
        url: "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/use-partner-models",
        type: "website",
        access: "public",
        format: "mixed",
        stability: "semi_structured",
        extractor: {
          kind: "vertex-catalog",
          minModels: 20,
          maxModels: 80,
          minModelDocuments: 20,
          maxModelDocuments: 45,
          minPricingCoverage: 0.9,
        },
        extractorVersion: "vertex-catalog-v5",
        pricingEvidence: firstPartyPricing("price_book", "reviewed_unique_join"),
        fields: [
          "model_id",
          "name",
          "description",
          "tasks",
          "service_families",
          "api_endpoints",
          "modalities",
          "capabilities",
          "limits",
          "release_date",
          "pricing",
          "availability",
          "status",
          "release_stage",
          "deprecated_at",
          "retired_at",
          "replacement_model_ids",
        ],
        allowedHosts: ["docs.cloud.google.com", "cloud.google.com"],
        headers: [{ name: "Accept-Language", value: "en-US,en;q=0.9" }],
        maxResponseBytes: mebibytes(48),
        scope: "region",
        exhaustive: false,
        role: "catalog",
        linkedDocuments: {
          indexFormat: "html",
          path: /^\/gemini-enterprise-agent-platform\/models\/partner-models\/(?:claude\/(?!use-claude$)|grok\/(?!responses$)|mistral\/|llama\/(?!use-llama$))[a-z0-9-]+$/,
          minDocuments: 20,
          maxDocuments: 45,
          concurrency: 8,
          maxDocumentBytes: mebibytes(2),
          documents: [
            {
              id: "claude-api",
              url: "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/claude/use-claude",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "claude-web-search",
              url: "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/claude/web-search",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "grok-api",
              url: "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/grok/responses",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "llama-api",
              url: "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/llama/use-llama",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "deprecations",
              url: "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/deprecations/partner-models",
              maxResponseBytes: mebibytes(4),
            },
            {
              id: "pricing",
              url: "https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing",
              maxResponseBytes: mebibytes(6),
            },
          ],
        },
      },
      {
        id: "vertex-open-models",
        url: "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/maas/use-open-models",
        type: "website",
        access: "public",
        format: "mixed",
        stability: "semi_structured",
        extractor: {
          kind: "vertex-catalog",
          minModels: 15,
          maxModels: 60,
          minModelDocuments: 15,
          maxModelDocuments: 40,
          minPricingCoverage: 0.9,
        },
        extractorVersion: "vertex-catalog-v5",
        pricingEvidence: firstPartyPricing("price_book", "reviewed_unique_join"),
        fields: [
          "model_id",
          "name",
          "description",
          "tasks",
          "service_families",
          "api_endpoints",
          "modalities",
          "capabilities",
          "limits",
          "release_date",
          "pricing",
          "availability",
          "status",
          "release_stage",
          "deprecated_at",
          "retired_at",
        ],
        allowedHosts: ["docs.cloud.google.com", "cloud.google.com"],
        headers: [{ name: "Accept-Language", value: "en-US,en;q=0.9" }],
        maxResponseBytes: mebibytes(40),
        scope: "region",
        exhaustive: false,
        role: "catalog",
        linkedDocuments: {
          indexFormat: "html",
          path: /^\/gemini-enterprise-agent-platform\/models\/maas\/[a-z0-9-]+\/[a-z0-9-]+$/,
          minDocuments: 15,
          maxDocuments: 40,
          concurrency: 8,
          maxDocumentBytes: mebibytes(2),
          documents: [
            {
              id: "open-api",
              url: "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/maas/call-open-model-apis",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "text-embedding-api",
              url: "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/embeddings/get-text-embeddings",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "deprecations",
              url: "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/deprecations/open-models",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "pricing",
              url: "https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing",
              maxResponseBytes: mebibytes(6),
            },
          ],
        },
      },
      {
        id: "vertex-model-garden-api",
        url: "https://aiplatform.googleapis.com/v1beta1/publishers/google/models",
        type: "api",
        access: "authenticated",
        format: "json",
        stability: "documented",
        extractor: { kind: "vertex-api" },
        extractorVersion: "vertex-api-v1",
        fields: ["model_id", "service_families", "status", "release_stage"],
        allowedHosts: ["aiplatform.googleapis.com", "oauth2.googleapis.com"],
        maxResponseBytes: mebibytes(32),
        scope: "account",
        exhaustive: false,
        role: "inventory",
        optional: true,
        auth: { scheme: "google-service-account", env: "GOOGLE_SERVICE_ACCOUNT_JSON" },
        transport: {
          kind: "google-model-garden",
          publishers: [
            "google",
            "anthropic",
            "xai",
            "ai21",
            "mistralai",
            "meta",
            "deepseek-ai",
            "qwen",
            "zai-org",
            "moonshotai",
            "minimaxai",
            "openai",
          ],
        },
      },
    ],
    warnOnMissing: {
      sourceId: "vertex-google-models",
      fields: ["limits.context_tokens", "pricing", "release_date", "updated_date"],
      statuses: ["active", "deprecated"],
    },
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
    pricingCategoricalLabels: pricingLabels("capacity", {
      "starting rate": "Starting rate",
    }),
    sources: [
      {
        id: "cohere-models",
        url: "https://docs.cohere.com/docs/models/llms.txt",
        type: "website",
        access: "public",
        format: "mixed",
        stability: "semi_structured",
        extractor: {
          kind: "cohere-catalog",
          minModels: 40,
          maxModels: 70,
          minPricingCoverage: 0.6,
        },
        extractorVersion: "cohere-catalog-v6",
        pricingEvidence: firstPartyPricing("price_book", "exact_or_documented_alias"),
        fields: [
          "model_id",
          "name",
          "description",
          "tasks",
          "api_endpoints",
          "modalities",
          "capabilities",
          "limits",
          "release_date",
          "pricing",
          "status",
          "deprecated_at",
          "retired_at",
          "replacement_model_ids",
        ],
        allowedHosts: ["docs.cohere.com", "cohere.com"],
        maxResponseBytes: mebibytes(48),
        scope: "global",
        exhaustive: false,
        role: "catalog",
        linkedDocuments: {
          path: /^\/docs\/[a-z0-9.-]+$/,
          indexFormat: "markdown",
          discoverySuffix: ".md",
          minDocuments: 15,
          maxDocuments: 30,
          concurrency: 6,
          maxDocumentBytes: mebibytes(2),
          documents: [
            {
              id: "overview",
              url: "https://docs.cohere.com/docs/models",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "deprecations",
              url: "https://docs.cohere.com/docs/deprecations",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "pricing",
              url: "https://cohere.com/pricing",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "pricing-policy",
              url: "https://docs.cohere.com/docs/how-does-cohere-pricing-work.md",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "rate-limits",
              url: "https://docs.cohere.com/docs/rate-limits.md",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "billing-errors",
              url: "https://docs.cohere.com/reference/errors.md",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "teams-and-roles",
              url: "https://docs.cohere.com/reference/teams-and-roles.md",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "changelog",
              url: "https://docs.cohere.com/v2/changelog",
              maxResponseBytes: mebibytes(3),
            },
            {
              id: "release-command-a",
              url: "https://docs.cohere.com/changelog/command-a",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "release-command-r7b",
              url: "https://docs.cohere.com/changelog/command-r-7b/",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "release-command-r",
              url: "https://docs.cohere.com/v1/changelog/command-gets-refreshed",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "release-rerank-v3-5",
              url: "https://docs.cohere.com/changelog/rerank-v3.5",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "api-chat-v2",
              url: "https://docs.cohere.com/reference/chat.md",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "api-chat-v1",
              url: "https://docs.cohere.com/reference/chat-v1.md",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "api-chat-stream-v2",
              url: "https://docs.cohere.com/reference/chat-stream.md",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "api-embed-v2",
              url: "https://docs.cohere.com/reference/embed.md",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "api-embed-jobs",
              url: "https://docs.cohere.com/reference/create-embed-job.md",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "api-embed-job-result",
              url: "https://docs.cohere.com/reference/get-embed-job.md",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "api-rerank-v2",
              url: "https://docs.cohere.com/reference/rerank.md",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "api-transcription-v2",
              url: "https://docs.cohere.com/reference/create-audio-transcription.md",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "api-openai-compatibility",
              url: "https://docs.cohere.com/docs/compatibility-api.md",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "api-generate-v1",
              url: "https://docs.cohere.com/v1/reference/generate.md",
              maxResponseBytes: mebibytes(1),
            },
          ],
        },
      },
      {
        id: "cohere-api",
        url: "https://api.cohere.com/v1/models?page_size=1000",
        type: "api",
        access: "authenticated",
        format: "json",
        stability: "documented",
        extractor: { kind: "cohere-api" },
        extractorVersion: "cohere-api-v2",
        fields: ["model_id", "tasks", "api_endpoints", "limits", "status"],
        allowedHosts: ["api.cohere.com"],
        maxResponseBytes: mebibytes(8),
        scope: "account",
        exhaustive: false,
        role: "inventory",
        optional: true,
        auth: { scheme: "bearer", env: "COHERE_API_KEY" },
      },
    ],
    supersededIdKinds: ["source_generated"],
    warnOnMissing: {
      sourceId: "cohere-models",
      fields: ["limits.context_tokens", "pricing", "release_date", "updated_date"],
      statuses: ["active", "deprecated"],
    },
  },
  {
    provider: {
      id: "mistral",
      name: "Mistral AI",
      kind: "hosted",
      homepage: "https://mistral.ai/",
      docs_url: "https://docs.mistral.ai/models/overview",
      catalog_scope: "global",
    },
    pricingCategoricalLabels: pricingLabels("operation", { ocr: "OCR" }),
    sources: [
      {
        id: "mistral-models",
        url: "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/schema/models/models/index.ts",
        type: "repository",
        source: ["repository", "website"],
        access: "public",
        format: "mixed",
        stability: "documented",
        extractor: {
          kind: "mistral-catalog",
          minModels: 50,
          maxModels: 90,
          minPricingCoverage: 0.9,
        },
        extractorVersion: "mistral-catalog-v7",
        pricingEvidence: firstPartyPricing("model_catalog", "exact_or_documented_alias"),
        fields: [
          "model_id",
          "version",
          "name",
          "description",
          "aliases",
          "tasks",
          "api_endpoints",
          "modalities",
          "capabilities",
          "limits",
          "release_date",
          "pricing",
          "status",
          "release_stage",
          "deprecated_at",
          "retired_at",
          "replacement_model_ids",
        ],
        allowedHosts: ["raw.githubusercontent.com", "docs.mistral.ai", "mistral.ai"],
        maxResponseBytes: mebibytes(16),
        scope: "global",
        exhaustive: true,
        role: "catalog",
        linkedDocuments: {
          path: /^\/mistralai\/platform-docs-public\/main\/src\/schema\/models\/models\/[a-z0-9-]+$/,
          indexFormat: "typescript",
          requestSuffix: ".ts",
          minDocuments: 55,
          maxDocuments: 90,
          concurrency: 8,
          maxDocumentBytes: mebibytes(1),
          documents: [
            {
              id: "model-schema",
              url: "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/schema/models/schema.ts",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "model-endpoints",
              url: "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/schema/models/endpoints.ts",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "prompt-caching",
              url: "https://docs.mistral.ai/studio-api/conversations/advanced/prompt-caching.md",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "batch-processing",
              url: "https://docs.mistral.ai/studio-api/batch-processing.md",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "public-pricing",
              url: "https://mistral.ai/pricing/api/",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "api-schema",
              url: "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/openapi.yaml",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "admin-usage",
              url: "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/content/en/docs/admin/admin-api/usage-metrics/page.mdx",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "admin-billing-api",
              url: "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/content/en/api/endpoint/beta/admin/billing/page.mdx",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "account-billing",
              url: "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/content/en/docs/admin/billing-usage/billing/page.mdx",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "account-plans",
              url: "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/content/en/docs/admin/billing-usage/subscriptions/page.mdx",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "regional-inference",
              url: "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/content/en/docs/studio-api/regional-inference/page.mdx",
              maxResponseBytes: mebibytes(1),
            },
          ],
        },
      },
      {
        id: "mistral-api",
        url: "https://api.mistral.ai/v1/models",
        type: "api",
        access: "authenticated",
        format: "json",
        stability: "documented",
        extractor: { kind: "mistral-api" },
        extractorVersion: "mistral-api-v2",
        fields: [
          "name",
          "description",
          "aliases",
          "tasks",
          "modalities",
          "capabilities",
          "limits",
          "status",
          "deprecated_at",
          "replacement_model_ids",
        ],
        allowedHosts: ["api.mistral.ai"],
        maxResponseBytes: mebibytes(8),
        scope: "account",
        exhaustive: false,
        role: "inventory",
        optional: true,
        auth: { scheme: "bearer", env: "MISTRAL_API_KEY" },
      },
    ],
    supersededIdKinds: ["source_generated"],
    warnOnMissing: {
      sourceId: "mistral-models",
      fields: ["limits.context_tokens", "pricing", "release_date", "updated_date"],
      statuses: ["active", "deprecated"],
    },
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
      {
        id: "llama-models",
        url: "https://raw.githubusercontent.com/meta-llama/llama-models/main/models/sku_list.py",
        type: "repository",
        source: ["repository", "website"],
        access: "public",
        format: "mixed",
        stability: "documented",
        extractor: { kind: "llama-catalog", minModels: 45, maxModels: 60 },
        extractorVersion: "llama-catalog-v4",
        pricingEvidence: firstPartyPricing("commercial_terms", "exact_or_documented_alias"),
        fields: [
          "model_id",
          "description",
          "aliases",
          "tasks",
          "api_endpoints",
          "modalities",
          "capabilities",
          "limits",
          "release_date",
          "pricing",
          "status",
        ],
        allowedHosts: ["raw.githubusercontent.com", "ai.meta.com"],
        maxResponseBytes: mebibytes(12),
        scope: "global",
        exhaustive: true,
        role: "catalog",
        linkedDocuments: {
          path: /^$/,
          minDocuments: 0,
          maxDocuments: 0,
          concurrency: 6,
          maxDocumentBytes: mebibytes(2),
          documents: [
            {
              id: "sku-types",
              url: "https://raw.githubusercontent.com/meta-llama/llama-models/main/models/sku_types.py",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "prompt-guard-models",
              url: "https://raw.githubusercontent.com/meta-llama/llama-models/main/models/cli/safety_models.py",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "readme",
              url: "https://raw.githubusercontent.com/meta-llama/llama-models/main/README.md",
              maxResponseBytes: mebibytes(1),
            },
            ...[
              "llama3_1/MODEL_CARD.md",
              "llama3_2/MODEL_CARD.md",
              "llama3_3/MODEL_CARD.md",
              "llama4/MODEL_CARD.md",
            ].map((path) => ({
              id: path.replaceAll("/", "-").toLowerCase(),
              url: `https://raw.githubusercontent.com/meta-llama/llama-models/main/models/${path}`,
              maxResponseBytes: mebibytes(2),
            })),
            {
              id: "llama-api-chat-example",
              url: "https://raw.githubusercontent.com/meta-llama/llama-api-python/main/examples/chat.py",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "llama-api-tool-example",
              url: "https://raw.githubusercontent.com/meta-llama/llama-api-python/main/examples/tool_call.py",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "llama-api-structured-example",
              url: "https://raw.githubusercontent.com/meta-llama/llama-api-python/main/examples/structured.py",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "llama-api-client",
              url: "https://raw.githubusercontent.com/meta-llama/llama-api-python/main/src/llama_api_client/_client.py",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "llama-api-chat-params",
              url: "https://raw.githubusercontent.com/meta-llama/llama-api-python/main/src/llama_api_client/types/chat/completion_create_params.py",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "llama-api-chat-response",
              url: "https://raw.githubusercontent.com/meta-llama/llama-api-python/main/src/llama_api_client/types/create_chat_completion_response.py",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "llama-api-chat-stream-response",
              url: "https://raw.githubusercontent.com/meta-llama/llama-api-python/main/src/llama_api_client/types/create_chat_completion_response_stream_chunk.py",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "llama-api-moderation-response",
              url: "https://raw.githubusercontent.com/meta-llama/llama-api-python/main/src/llama_api_client/types/moderation_create_response.py",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "llama-api-chat-completions",
              url: "https://raw.githubusercontent.com/meta-llama/llama-api-python/main/src/llama_api_client/resources/chat/completions.py",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "llama-api-moderations",
              url: "https://raw.githubusercontent.com/meta-llama/llama-api-python/main/src/llama_api_client/resources/moderations.py",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "llama-3-release",
              url: "https://ai.meta.com/blog/meta-llama-3/",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "llama-3-1-release",
              url: "https://ai.meta.com/blog/meta-llama-3-1/",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "llama-3-2-release",
              url: "https://ai.meta.com/blog/llama-3-2-connect-2024-vision-edge-mobile-devices/",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "llama-protections-release",
              url: "https://ai.meta.com/blog/ai-defenders-program-llama-protection-tools/",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "llama-api-launch",
              url: "https://ai.meta.com/blog/llamacon-llama-news/",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "llama-4-license",
              url: "https://raw.githubusercontent.com/meta-llama/llama-models/main/models/llama4/LICENSE",
              maxResponseBytes: mebibytes(1),
            },
          ],
        },
      },
      {
        id: "llama-api",
        url: "https://api.llama.com/v1/models",
        type: "api",
        access: "authenticated",
        format: "json",
        stability: "documented",
        extractor: { kind: "llama-api" },
        extractorVersion: "llama-api-v1",
        fields: ["model_id", "status"],
        allowedHosts: ["api.llama.com"],
        maxResponseBytes: mebibytes(4),
        scope: "account",
        exhaustive: false,
        role: "inventory",
        optional: true,
        auth: { scheme: "bearer", env: "LLAMA_API_KEY" },
      },
    ],
    supersededIdKinds: ["display_name", "source_generated"],
    supersededModelIds: ["llama3", "llama4"],
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
    pricingCategoricalLabels: pricingLabels("operation", {
      attachment_search: "File attachments",
      code_execution: "Code execution",
      code_interpreter: "Code interpreter",
      collections_search: "Collections search",
      "conversation.item.create": "Text input",
      file_search: "File search",
      web_search: "Web search",
      x_search: "X search",
    }),
    sources: [
      {
        id: "xai-models",
        url: "https://docs.x.ai/developers/models",
        type: "website",
        access: "public",
        format: "mixed",
        stability: "semi_structured",
        extractor: { kind: "xai-catalog", minModels: 10, maxModels: 50 },
        extractorVersion: "xai-catalog-v6",
        pricingEvidence: firstPartyPricing("price_book", "exact_id"),
        fields: [
          "model_id",
          "version",
          "name",
          "description",
          "aliases",
          "tasks",
          "api_endpoints",
          "modalities",
          "capabilities",
          "limits",
          "release_date",
          "updated_date",
          "pricing",
          "status",
          "release_stage",
          "deprecated_at",
          "replacement_model_ids",
        ],
        allowedHosts: ["docs.x.ai"],
        maxResponseBytes: mebibytes(8),
        scope: "global",
        exhaustive: false,
        role: "catalog",
        linkedDocuments: {
          path: /^$/,
          minDocuments: 0,
          maxDocuments: 0,
          concurrency: 1,
          documents: [
            {
              id: "llms",
              url: "https://docs.x.ai/llms.txt",
              maxResponseBytes: mebibytes(3),
            },
          ],
        },
      },
      xaiApiSource("xai-api", "models", "all", ["model_id", "aliases", "limits"]),
      xaiApiSource("xai-language-api", "language-models", "language", [
        "model_id",
        "version",
        "aliases",
        "tasks",
        "modalities",
      ]),
      xaiApiSource("xai-image-api", "image-generation-models", "image", [
        "model_id",
        "version",
        "aliases",
        "tasks",
        "modalities",
      ]),
      xaiApiSource("xai-video-api", "video-generation-models", "video", [
        "model_id",
        "version",
        "aliases",
        "tasks",
        "modalities",
      ]),
    ],
    supersededIdKinds: ["display_name", "source_generated"],
    supersededModelIds: ["grok-4.20"],
    warnOnMissing: {
      sourceId: "xai-models",
      fields: ["pricing", "release_date"],
      statuses: ["active", "deprecated"],
    },
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
    pricingCategoricalLabels: pricingLabels("route_provider", {
      deepinfra: "DeepInfra",
      "fireworks-ai": "Fireworks",
      ovhcloud: "OVHcloud AI Endpoints",
      publicai: "Public AI",
    }),
    sources: [
      huggingFaceInferenceSource,
      {
        id: "huggingface-router",
        url: "https://router.huggingface.co/v1/models",
        type: "api",
        access: "public",
        format: "json",
        stability: "documented",
        extractor: { kind: "huggingface-router", minModels: 50, maxModels: 500 },
        extractorVersion: "huggingface-router-v4",
        pricingEvidence: firstPartyPricing("price_book", "exact_id", "current_snapshot"),
        fields: [
          "tasks",
          "modalities",
          "api_endpoints",
          "capabilities",
          "limits",
          "pricing",
          "status",
        ],
        allowedHosts: ["router.huggingface.co", "huggingface.co"],
        maxResponseBytes: mebibytes(16),
        scope: "global",
        exhaustive: true,
        role: "catalog",
        linkedDocuments: {
          path: /^$/,
          minDocuments: 0,
          maxDocuments: 0,
          concurrency: 4,
          documents: [
            {
              id: "pricing",
              url: "https://huggingface.co/docs/inference-providers/en/pricing.md",
              format: "markdown",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "overview",
              url: "https://huggingface.co/docs/inference-providers/en/index.md",
              format: "markdown",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "hub-api",
              url: "https://huggingface.co/docs/inference-providers/en/hub-api.md",
              format: "markdown",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "chat-completion",
              url: "https://huggingface.co/docs/inference-providers/en/tasks/chat-completion.md",
              format: "markdown",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "responses-api",
              url: "https://huggingface.co/docs/inference-providers/en/guides/responses-api.md",
              format: "markdown",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "provider-registration",
              url: "https://huggingface.co/docs/inference-providers/en/register-as-a-provider.md",
              format: "markdown",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "sdk-inference",
              url: "https://huggingface.co/docs/huggingface_hub/en/guides/inference.md",
              format: "markdown",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "hub-billing",
              url: "https://huggingface.co/docs/hub/en/billing.md",
              format: "markdown",
              maxResponseBytes: mebibytes(1),
            },
          ],
        },
      },
      {
        id: "huggingface-hub",
        url: "https://huggingface.co/api/models?inference_provider=hf-inference&limit=1000&sort=createdAt&expand=lastModified",
        type: "api",
        access: "public",
        format: "json",
        stability: "documented",
        extractor: { kind: "huggingface-hub", minModels: 500, maxModels: 3_000 },
        extractorVersion: "huggingface-hub-v1",
        fields: ["updated_date"],
        allowedHosts: ["huggingface.co"],
        maxResponseBytes: mebibytes(4),
        scope: "global",
        exhaustive: false,
        role: "overlay",
        transport: { kind: "huggingface-models", maxPages: 5, maxModels: 3_000 },
      },
    ],
    warnOnMissing: {
      sourceId: "huggingface-router",
      fields: ["limits.context_tokens", "pricing", "release_date", "updated_date"],
      statuses: ["active", "deprecated"],
    },
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
    pricingCategoricalLabels: [
      ...pricingLabels("context_tier", {
        "0<Token≤128K": "0 < tokens ≤ 128K",
        "0<Token≤1M": "0 < tokens ≤ 1M",
        "0<Token≤200K": "0 < tokens ≤ 200K",
        "0<Token≤256K": "0 < tokens ≤ 256K",
        "0<Token≤32K": "0 < tokens ≤ 32K",
        "128K<Token≤200K": "128K < tokens ≤ 200K",
        "128K<Token≤256K": "128K < tokens ≤ 256K",
        "256K<Token≤1M": "256K < tokens ≤ 1M",
        "32K<Token≤128K": "32K < tokens ≤ 128K",
        "32K<Token≤166K": "32K < tokens ≤ 166K",
        "32K<Token≤200K": "32K < tokens ≤ 200K",
      }),
      ...pricingLabels("modality", {
        "image/video": "Image / video",
        "text + audioaudio only billed": "Text + audio (audio only billed)",
        "text/image": "Text / image",
        "text/image/video": "Text / image / video",
        "textmultimodal input": "Text (multimodal input)",
        "texttext-only input": "Text (text-only input)",
      }),
      ...pricingLabels("operation", {
        "1_1landscape_video": "1:1 landscape video",
        "3_4landscape_video": "3:4 landscape video",
        non_thinking_and_thinking_modes: "Non-Thinking and Thinking modes",
        non_thinking_mode: "Non-Thinking mode",
        non_thinking_mode_only: "Non-Thinking mode only",
        "prompt_extend=false": "Prompt rewriting disabled",
        "prompt_extend=true": "Prompt rewriting enabled",
        thinking_mode_chain_of_thought_answer_: "Thinking mode (chain of thought + answer)",
        thinking_mode_only: "Thinking mode only",
      }),
      ...pricingLabels("service_tier", {
        limited_time_20_percent_off: "Limited-time 20% off",
        limited_time_40_percent_off: "Limited-time 40% off",
        limited_time_50_percent_off: "Limited-time 50% off",
      }),
    ],
    sources: [
      {
        id: "dashscope-recommended",
        url: "https://www.alibabacloud.com/help/en/model-studio/models",
        type: "website",
        access: "public",
        format: "html",
        stability: "semi_structured",
        extractor: { kind: "dashscope-recommended", minModels: 15, maxModels: 60 },
        extractorVersion: "dashscope-recommended-v1",
        fields: ["api_endpoints", "availability"],
        allowedHosts: ["www.alibabacloud.com"],
        maxResponseBytes: mebibytes(1),
        scope: "region",
        exhaustive: false,
        role: "overlay",
      },
      dashscopeCatalogSource("dashscope-text", "text-generation-model/", "text", 70, 180),
      dashscopeCatalogSource("dashscope-vision", "vision-model/", "vision", 12, 50),
      dashscopeCatalogSource("dashscope-image", "image-model", "image", 20, 70),
      dashscopeCatalogSource("dashscope-video", "video-generate-edit-model", "video", 25, 80),
      dashscopeCatalogSource("dashscope-asr", "asr-model/", "asr", 25, 90),
      dashscopeCatalogSource("dashscope-tts", "tts-model/", "tts", 20, 70),
      dashscopeCatalogSource("dashscope-s2s", "s2s-model", "s2s", 15, 80),
      dashscopeCatalogSource("dashscope-omni", "omni/", "omni", 20, 80),
      dashscopeCatalogSource("dashscope-embedding", "embedding-rerank-model/", "embedding", 5, 25),
      {
        id: "dashscope-pricing",
        url: "https://www.alibabacloud.com/help/en/model-studio/model-pricing",
        type: "website",
        access: "public",
        format: "html",
        stability: "semi_structured",
        extractor: { kind: "dashscope-pricing", minModels: 240, maxModels: 500 },
        extractorVersion: "dashscope-pricing-v4",
        pricingEvidence: firstPartyPricing("price_book", "exact_id"),
        fields: [
          "model_id",
          "aliases",
          "tasks",
          "modalities",
          "capabilities",
          "pricing",
          "availability",
          "status",
          "release_stage",
        ],
        allowedHosts: ["www.alibabacloud.com"],
        maxResponseBytes: mebibytes(16),
        scope: "region",
        exhaustive: false,
        role: "catalog",
        linkedDocuments: {
          path: /$a/,
          minDocuments: 0,
          maxDocuments: 0,
          concurrency: 4,
          documents: [
            {
              id: "context-cache",
              url: "https://www.alibabacloud.com/help/en/model-studio/context-cache",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "batch-inference",
              url: "https://www.alibabacloud.com/help/en/model-studio/batch-inference/",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "chat-completions",
              url: "https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-chat-completions",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "responses-api",
              url: "https://www.alibabacloud.com/help/en/model-studio/compatibility-with-openai-responses-api",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "web-search",
              url: "https://www.alibabacloud.com/help/en/model-studio/web-search",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "billing",
              url: "https://www.alibabacloud.com/help/en/model-studio/bill-query-and-cost-management",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "model-usage",
              url: "https://www.alibabacloud.com/help/en/model-studio/model-usage-statistics",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "savings-plans",
              url: "https://www.alibabacloud.com/help/en/model-studio/savings-plan-and-resource-package",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "billing-plans",
              url: "https://www.alibabacloud.com/help/en/model-studio/more-tools",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "base-url",
              url: "https://www.alibabacloud.com/help/en/model-studio/base-url",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "billing-api",
              url: "https://www.alibabacloud.com/help/en/user-center/developer-reference/api-bssopenapi-2017-12-14-describeinstancebill",
              maxResponseBytes: mebibytes(2),
            },
          ],
        },
      },
      {
        id: "dashscope-lifecycle",
        url: "https://www.alibabacloud.com/help/en/model-studio/model-depreciation",
        type: "website",
        access: "public",
        format: "html",
        stability: "semi_structured",
        extractor: { kind: "dashscope-lifecycle", minModels: 15, maxModels: 150 },
        extractorVersion: "dashscope-lifecycle-v1",
        fields: [
          "model_id",
          "tasks",
          "status",
          "release_stage",
          "retired_at",
          "replacement_model_ids",
        ],
        allowedHosts: ["www.alibabacloud.com"],
        maxResponseBytes: mebibytes(1),
        scope: "region",
        exhaustive: false,
        role: "catalog",
      },
      {
        id: "dashscope-releases",
        url: "https://www.alibabacloud.com/help/en/model-studio/newly-released-models",
        type: "website",
        access: "public",
        format: "html",
        stability: "semi_structured",
        extractor: { kind: "dashscope-releases", minModels: 150, maxModels: 500 },
        extractorVersion: "dashscope-releases-v1",
        fields: ["release_date"],
        allowedHosts: ["www.alibabacloud.com"],
        maxResponseBytes: mebibytes(1),
        scope: "region",
        exhaustive: false,
        role: "overlay",
      },
      {
        id: "dashscope-deployable-api",
        url: "https://dashscope-intl.aliyuncs.com/api/v1/deployments/models?page_no=1&page_size=100&version=v1.0&model_source=base",
        type: "api",
        access: "authenticated",
        format: "json",
        stability: "documented",
        extractor: { kind: "dashscope-api", minModels: 1, maxModels: 100 },
        extractorVersion: "dashscope-api-v1",
        fields: ["availability"],
        allowedHosts: ["dashscope-intl.aliyuncs.com"],
        maxResponseBytes: mebibytes(2),
        scope: "region",
        exhaustive: false,
        role: "inventory",
        optional: true,
        auth: { scheme: "bearer", env: "DASHSCOPE_API_KEY" },
      },
    ],
    warnOnMissing: {
      sourceId: "dashscope-pricing",
      fields: ["limits.context_tokens", "pricing", "release_date", "updated_date"],
      statuses: ["active", "deprecated"],
    },
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
        id: "cerebras-catalog",
        url: "https://inference-docs.cerebras.ai/models/overview",
        type: "website",
        access: "public",
        format: "markdown",
        stability: "semi_structured",
        extractor: { kind: "cerebras-catalog", minModels: 2, maxModels: 20 },
        extractorVersion: "cerebras-catalog-v6",
        pricingEvidence: firstPartyPricing("model_catalog", "exact_id"),
        fields: [
          "model_id",
          "name",
          "description",
          "tasks",
          "api_endpoints",
          "modalities",
          "capabilities",
          "limits",
          "pricing",
          "status",
          "release_stage",
          "deprecated_at",
        ],
        allowedHosts: ["inference-docs.cerebras.ai", "www.cerebras.ai"],
        maxResponseBytes: mebibytes(8),
        scope: "global",
        exhaustive: true,
        role: "catalog",
        linkedDocuments: {
          indexFormat: "markdown",
          path: /^\/models\/[a-z0-9-]+$/,
          requestSuffix: ".md",
          minDocuments: 2,
          maxDocuments: 20,
          concurrency: 6,
          maxDocumentBytes: mebibytes(1),
          documents: [
            ...(
              [
                ["documentation-index", "/llms.txt"],
                ["chat-completions", "/api-reference/chat-completions.md"],
                ["completions", "/api-reference/completions.md"],
                ["public-models", "/api-reference/models/public-models.md"],
                ["image-inputs", "/capabilities/image-inputs.md"],
                ["prompt-caching", "/capabilities/prompt-caching.md"],
                ["reasoning", "/capabilities/reasoning.md"],
                ["service-tiers", "/capabilities/service-tiers.md"],
                ["predicted-outputs", "/dedicated/predicted-outputs.md"],
                ["tool-use", "/capabilities/tool-use.md"],
                ["batch", "/capabilities/batch.md"],
                ["account-billing", "/console/account-billing.md"],
                ["console-overview", "/console/overview.md"],
                ["usage-monitoring", "/console/usage-monitoring.md"],
                ["projects", "/console/projects.md"],
                ["rate-limits", "/support/rate-limits.md"],
                ["metrics", "/capabilities/metrics.md"],
                ["metrics-api", "/api-reference/metrics/retrieve-metrics.md"],
                ["dedicated", "/dedicated/overview.md"],
                ["aws-marketplace", "/integrations/aws-marketplace.md"],
              ] as const
            ).map(([id, path]) => ({
              id,
              url: `https://inference-docs.cerebras.ai${path}`,
              maxResponseBytes: mebibytes(1),
            })),
            {
              id: "pricing",
              url: "https://inference-docs.cerebras.ai/support/pricing.md",
              format: "html",
              maxResponseBytes: mebibytes(4),
            },
          ],
        },
      },
      {
        id: "cerebras-models",
        url: "https://api.cerebras.ai/public/v1/models",
        type: "api",
        access: "public",
        format: "json",
        stability: "documented",
        extractor: { kind: "cerebras-public", minModels: 2, maxModels: 20 },
        extractorVersion: "cerebras-public-v1",
        pricingEvidence: firstPartyPricing("model_catalog", "exact_id", "current_snapshot"),
        fields: [
          "model_id",
          "name",
          "description",
          "tasks",
          "modalities",
          "capabilities",
          "limits",
          "pricing",
        ],
        allowedHosts: ["api.cerebras.ai"],
        maxResponseBytes: mebibytes(1),
        scope: "global",
        exhaustive: true,
        role: "catalog",
      },
      {
        id: "cerebras-lifecycle",
        url: "https://inference-docs.cerebras.ai/support/deprecation",
        type: "website",
        access: "public",
        format: "markdown",
        stability: "semi_structured",
        extractor: { kind: "cerebras-lifecycle", minModels: 10, maxModels: 30 },
        extractorVersion: "cerebras-lifecycle-v2",
        fields: [
          "model_id",
          "tasks",
          "modalities",
          "status",
          "release_stage",
          "deprecated_at",
          "replacement_model_ids",
        ],
        allowedHosts: ["inference-docs.cerebras.ai"],
        maxResponseBytes: mebibytes(1),
        scope: "global",
        exhaustive: false,
        role: "catalog",
        linkedDocuments: {
          indexFormat: "markdown",
          path: /^$/,
          minDocuments: 0,
          maxDocuments: 0,
          concurrency: 2,
          documents: [
            {
              id: "model-catalog",
              url: "https://inference-docs.cerebras.ai/models/overview.md",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "change-log",
              url: "https://inference-docs.cerebras.ai/support/change-log.md",
              maxResponseBytes: mebibytes(1),
            },
          ],
        },
      },
      {
        id: "cerebras-releases",
        url: "https://inference-docs.cerebras.ai/support/change-log",
        type: "website",
        access: "public",
        format: "markdown",
        stability: "semi_structured",
        extractor: { kind: "cerebras-releases", minModels: 10, maxModels: 30 },
        extractorVersion: "cerebras-releases-v1",
        fields: ["release_date"],
        allowedHosts: ["inference-docs.cerebras.ai"],
        maxResponseBytes: mebibytes(1),
        scope: "global",
        exhaustive: false,
        role: "overlay",
      },
      {
        id: "cerebras-api",
        url: "https://api.cerebras.ai/v1/models",
        type: "api",
        access: "authenticated",
        format: "json",
        stability: "documented",
        extractor: { kind: "cerebras-api", minModels: 1, maxModels: 20 },
        extractorVersion: "cerebras-api-v1",
        fields: ["model_id"],
        allowedHosts: ["api.cerebras.ai"],
        maxResponseBytes: mebibytes(1),
        scope: "account",
        exhaustive: false,
        role: "inventory",
        optional: true,
        auth: { scheme: "bearer", env: "CEREBRAS_API_KEY" },
      },
    ],
    warnOnMissing: {
      sourceId: "cerebras-models",
      fields: ["limits.context_tokens", "pricing", "release_date", "updated_date"],
      statuses: ["active", "deprecated"],
    },
  },
  {
    provider: {
      id: "ollama",
      name: "Ollama",
      kind: "local_runtime",
      homepage: "https://ollama.com/",
      docs_url: "https://docs.ollama.com/cloud",
      catalog_scope: "mixed",
    },
    sources: [
      {
        id: "ollama-library",
        url: "https://ollama.com/library",
        type: "website",
        access: "public",
        format: "html",
        stability: "semi_structured",
        extractor: { kind: "ollama-library", minModels: 200, maxModels: 350 },
        extractorVersion: "ollama-library-v3",
        pricingEvidence: firstPartyPricing("commercial_terms", "exact_id"),
        fields: [
          "model_id",
          "description",
          "tasks",
          "service_families",
          "modalities",
          "capabilities",
          "updated_date",
          "pricing",
          "status",
          "release_stage",
        ],
        allowedHosts: ["ollama.com"],
        maxResponseBytes: mebibytes(4),
        scope: "global",
        exhaustive: false,
        role: "catalog",
      },
      {
        id: "ollama-cloud-models",
        url: "https://ollama.com/api/tags",
        type: "api",
        source: ["api", "website"],
        access: "public",
        format: "mixed",
        stability: "semi_structured",
        extractor: { kind: "ollama-cloud", minModels: 15, maxModels: 30 },
        extractorVersion: "ollama-cloud-v4",
        pricingEvidence: firstPartyPricing("price_book", "exact_id"),
        fields: [
          "model_id",
          "name",
          "description",
          "tasks",
          "service_families",
          "modalities",
          "capabilities",
          "limits",
          "updated_date",
          "pricing",
          "status",
          "release_stage",
          "retired_at",
        ],
        allowedHosts: ["docs.ollama.com", "ollama.com"],
        maxResponseBytes: mebibytes(8),
        scope: "global",
        exhaustive: true,
        role: "catalog",
        transport: {
          kind: "ollama-cloud",
          catalogUrl: "https://ollama.com/search?c=cloud",
          modelPageBaseUrl: "https://ollama.com/library/",
          minModels: 15,
          maxModels: 30,
          concurrency: 6,
          maxModelPageBytes: mebibytes(1),
        },
        linkedDocuments: {
          path: /^$/,
          minDocuments: 0,
          maxDocuments: 0,
          concurrency: 6,
          documents: (
            [
              ["site-index", "https://ollama.com/llms.txt", "markdown"],
              ["docs-index", "https://docs.ollama.com/llms.txt", "markdown"],
              ["pricing", "https://ollama.com/pricing", "html"],
              ["terms", "https://ollama.com/terms", "html"],
              ["openapi", "https://docs.ollama.com/openapi.yaml", "markdown"],
              ["usage", "https://docs.ollama.com/api/usage.md", "markdown"],
              [
                "openai-compatibility",
                "https://docs.ollama.com/api/openai-compatibility.md",
                "markdown",
              ],
              [
                "anthropic-compatibility",
                "https://docs.ollama.com/api/anthropic-compatibility.md",
                "markdown",
              ],
              ["authentication", "https://docs.ollama.com/api/authentication.md", "markdown"],
              ["cloud", "https://docs.ollama.com/cloud.md", "markdown"],
              ["web-search", "https://docs.ollama.com/capabilities/web-search.md", "markdown"],
              ["tool-calling", "https://docs.ollama.com/capabilities/tool-calling.md", "markdown"],
              ["thinking", "https://docs.ollama.com/capabilities/thinking.md", "markdown"],
              ["vision", "https://docs.ollama.com/capabilities/vision.md", "markdown"],
            ] as const
          ).map(([id, url, format]) => ({
            id,
            url,
            format,
            maxResponseBytes: mebibytes(1),
          })),
        },
      },
    ],
    warnOnMissing: {
      sourceId: "ollama-library",
      fields: ["limits.context_tokens", "pricing", "release_date", "updated_date"],
      statuses: ["active", "deprecated"],
    },
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
      {
        id: "deepseek-catalog",
        url: "https://api-docs.deepseek.com/quick_start/pricing",
        type: "website",
        access: "public",
        format: "html",
        stability: "semi_structured",
        extractor: { kind: "deepseek-catalog", minModels: 2, maxModels: 10 },
        extractorVersion: "deepseek-catalog-v7",
        pricingEvidence: firstPartyPricing("price_book", "exact_id"),
        fields: [
          "model_id",
          "name",
          "tasks",
          "api_endpoints",
          "modalities",
          "capabilities",
          "limits",
          "pricing",
          "status",
          "release_stage",
          "deprecated_at",
          "retired_at",
          "replacement_model_ids",
        ],
        allowedHosts: ["api-docs.deepseek.com"],
        maxResponseBytes: mebibytes(2),
        scope: "global",
        exhaustive: true,
        role: "catalog",
        linkedDocuments: {
          path: /$a/,
          minDocuments: 0,
          maxDocuments: 0,
          concurrency: 4,
          documents: [
            {
              id: "chat-completions",
              url: "https://api-docs.deepseek.com/api/create-chat-completion",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "responses",
              url: "https://api-docs.deepseek.com/api/create-response",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "token-usage",
              url: "https://api-docs.deepseek.com/quick_start/token_usage",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "context-cache",
              url: "https://api-docs.deepseek.com/guides/kv_cache",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "balance",
              url: "https://api-docs.deepseek.com/api/get-user-balance",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "rate-limit",
              url: "https://api-docs.deepseek.com/quick_start/rate_limit",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "error-codes",
              url: "https://api-docs.deepseek.com/quick_start/error_codes",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "responses-guide",
              url: "https://api-docs.deepseek.com/guides/responses_api",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "anthropic-guide",
              url: "https://api-docs.deepseek.com/guides/anthropic_api",
              maxResponseBytes: mebibytes(1),
            },
          ],
        },
      },
      {
        id: "deepseek-updates",
        url: "https://api-docs.deepseek.com/updates",
        type: "website",
        access: "public",
        format: "html",
        stability: "semi_structured",
        extractor: { kind: "deepseek-updates", minModels: 4, maxModels: 10 },
        extractorVersion: "deepseek-updates-v2",
        fields: ["release_date", "updated_date"],
        allowedHosts: ["api-docs.deepseek.com"],
        maxResponseBytes: mebibytes(1),
        scope: "global",
        exhaustive: false,
        role: "overlay",
      },
      {
        id: "deepseek-api",
        url: "https://api.deepseek.com/models",
        type: "api",
        access: "authenticated",
        format: "json",
        stability: "documented",
        extractor: { kind: "deepseek-api", minModels: 1, maxModels: 20 },
        extractorVersion: "deepseek-api-v2",
        fields: ["model_id"],
        allowedHosts: ["api.deepseek.com"],
        maxResponseBytes: mebibytes(1),
        scope: "account",
        exhaustive: false,
        role: "inventory",
        optional: true,
        auth: { scheme: "bearer", env: "DEEPSEEK_API_KEY" },
      },
    ],
    warnOnMissing: {
      sourceId: "deepseek-catalog",
      fields: ["release_date", "updated_date"],
      statuses: ["active", "deprecated"],
    },
  },
  {
    provider: {
      id: "kimi",
      name: "Kimi",
      kind: "hosted",
      homepage: "https://www.kimi.com/",
      docs_url: "https://platform.kimi.ai/docs/models",
      catalog_scope: "mixed",
      regions: ["China", "International"],
    },
    sources: [
      {
        id: "kimi-openapi",
        url: "https://platform.kimi.ai/docs/openapi.json",
        type: "website",
        access: "public",
        format: "json",
        stability: "documented",
        extractor: {
          kind: "kimi-openapi",
          baseUrl: "https://api.moonshot.ai",
          minModels: 8,
          maxModels: 30,
        },
        extractorVersion: "kimi-openapi-v3",
        fields: ["model_id", "tasks", "modalities", "api_endpoints", "capabilities", "limits"],
        allowedHosts: ["platform.kimi.ai"],
        maxResponseBytes: mebibytes(2),
        scope: "global",
        exhaustive: false,
        role: "catalog",
      },
      {
        id: "kimi-catalog",
        url: "https://platform.kimi.com/docs/models",
        type: "website",
        access: "public",
        format: "markdown",
        stability: "semi_structured",
        extractor: { kind: "kimi-catalog", minModels: 15, maxModels: 30 },
        extractorVersion: "kimi-catalog-v2",
        fields: [
          "model_id",
          "description",
          "tasks",
          "modalities",
          "capabilities",
          "limits",
          "status",
          "release_stage",
          "retired_at",
          "replacement_model_ids",
        ],
        allowedHosts: ["platform.kimi.com"],
        maxResponseBytes: mebibytes(1),
        scope: "global",
        exhaustive: false,
        role: "catalog",
      },
      kimiPricingSource("kimi-pricing", "https://platform.kimi.com", "China", "CNY", "¥"),
      kimiPricingSource(
        "kimi-international-pricing",
        "https://platform.kimi.ai",
        "International",
        "USD",
        "$",
      ),
      {
        id: "kimi-releases",
        url: "https://platform.kimi.com/blog/posts/changelog",
        type: "website",
        access: "public",
        format: "html",
        stability: "semi_structured",
        extractor: { kind: "kimi-releases", minModels: 8, maxModels: 25 },
        extractorVersion: "kimi-releases-v2",
        fields: ["release_date"],
        allowedHosts: ["platform.kimi.com", "www.kimi.com"],
        maxResponseBytes: mebibytes(6),
        scope: "global",
        exhaustive: false,
        role: "overlay",
        linkedDocuments: {
          indexFormat: "html",
          path: /^$/,
          minDocuments: 0,
          maxDocuments: 0,
          concurrency: 2,
          maxDocumentBytes: mebibytes(2),
          documents: [
            {
              id: "research",
              url: "https://www.kimi.com/blog/",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "code",
              url: "https://www.kimi.com/code/docs/en/kimi-code/whats-new.html",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "catalog",
              url: "https://platform.kimi.com/docs/models",
              format: "markdown",
              maxResponseBytes: mebibytes(1),
            },
          ],
        },
      },
      {
        id: "kimi-api",
        url: "https://api.moonshot.ai/v1/models",
        type: "api",
        access: "authenticated",
        format: "json",
        stability: "documented",
        extractor: { kind: "kimi-api", minModels: 1, maxModels: 50 },
        extractorVersion: "kimi-api-v1",
        fields: ["model_id", "modalities", "capabilities", "limits"],
        allowedHosts: ["api.moonshot.ai"],
        maxResponseBytes: mebibytes(1),
        scope: "account",
        exhaustive: false,
        role: "inventory",
        optional: true,
        auth: { scheme: "bearer", env: "MOONSHOT_API_KEY" },
      },
    ],
    warnOnMissing: {
      sourceId: "kimi-catalog",
      fields: ["limits.context_tokens", "pricing", "release_date", "updated_date"],
      statuses: ["active", "legacy", "deprecated", "unknown"],
    },
  },
] satisfies ProviderManifest[];
