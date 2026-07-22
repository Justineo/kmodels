import type {
  ModelType,
  Provider,
  ProviderModel,
  SourceAccess,
  SourceFormat,
  SourceType,
} from "./schema.ts";

export type Extractor =
  | { kind: "openai-catalog" }
  | { kind: "openai-overview" }
  | { kind: "openai-api" }
  | { kind: "openai-deprecations" }
  | { kind: "anthropic-catalog" }
  | { kind: "anthropic-api" }
  | { kind: "vercel-catalog"; minModels: number; maxModels: number }
  | { kind: "cerebras" }
  | { kind: "huggingface" }
  | { kind: "ollama" }
  | { kind: "vllm" }
  | { kind: "bedrock-catalog" }
  | { kind: "bedrock-api" }
  | { kind: "databricks-catalog"; minModels: number; maxModels: number }
  | { kind: "databricks-api" }
  | { kind: "azure-catalog"; minModels: number; maxModels: number }
  | { kind: "azure-api" }
  | { kind: "gemini-catalog"; minModels: number; maxModels: number }
  | { kind: "gemini-api" }
  | {
      kind: "document-identifiers";
      patterns: RegExp[];
      idKind: "api_id" | "alias" | "display_name" | "source_generated";
      defaultType: ModelType;
      linkTarget?: RegExp;
    };

export interface LinkedDocuments {
  path: RegExp;
  indexFormat?: "html" | "markdown";
  minDocuments: number;
  maxDocuments: number;
  concurrency: number;
  maxDocumentBytes?: number;
  markdownSuffix?: boolean;
  documents?: {
    id: string;
    url: string;
    maxResponseBytes: number;
  }[];
}

export type SourceField =
  | "model_id"
  | "version"
  | "name"
  | "description"
  | "aliases"
  | "types"
  | "modalities"
  | "capabilities"
  | "limits"
  | "release_date"
  | "updated_date"
  | "pricing"
  | "availability"
  | "status"
  | "is_deprecated"
  | "deprecated_at"
  | "retired_at"
  | "replacement_model_ids";

export type CoverageField = "limits.context_tokens" | "pricing" | "release_date" | "updated_date";

export interface SourceManifest {
  id: string;
  url: string;
  type: SourceType;
  access: SourceAccess;
  format: SourceFormat;
  stability: "documented" | "semi_structured" | "undocumented";
  extractor: Extractor;
  extractorVersion: string;
  fields: SourceField[];
  allowedHosts: string[];
  maxResponseBytes: number;
  scope?: "global" | "account" | "region" | "workspace" | "runtime";
  exhaustive?: boolean;
  role?: "catalog" | "overlay" | "inventory";
  optional?: boolean;
  auth?:
    | { scheme: "bearer"; env: string }
    | { scheme: "header"; env: string; header: string }
    | { scheme: "aws"; envs: [string, string] }
    | { scheme: "azure"; envs: [string, string, string, string, string] };
  headers?: { name: string; value: string }[];
  transport?:
    | { kind: "aws-bedrock"; region: string }
    | { kind: "databricks"; hostEnv: string }
    | { kind: "azure-models"; subscriptionEnv: string; locationEnv: string };
  snapshotPolicy?: "full" | "none";
  linkedDocuments?: LinkedDocuments;
}

export interface ProviderManifest {
  provider: Omit<Provider, "source_ids" | "last_successful_sync_at" | "catalog_version">;
  sources: SourceManifest[];
  notConfiguredReason?: string;
  supersededIdKinds?: ProviderModel["id_kind"][];
  supersededModelIds?: string[];
  warnOnMissing?: {
    sourceId: string;
    fields: CoverageField[];
    statuses?: ProviderModel["status"][];
  };
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
  type: url.includes("githubusercontent.com") ? "repository" : "website",
  access: "public",
  format: url.includes("githubusercontent.com") ? "markdown" : "html",
  stability: "semi_structured",
  extractor: {
    kind: "document-identifiers",
    patterns,
    idKind,
    defaultType: "generate",
    ...(linkTarget === undefined ? {} : { linkTarget }),
  },
  extractorVersion: "document-identifiers-v1",
  fields: ["model_id", "name", "types"],
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
      {
        id: "openai-models",
        url: "https://developers.openai.com/api/docs/models/all",
        type: "website",
        access: "public",
        format: "html",
        stability: "semi_structured",
        extractor: { kind: "openai-catalog" },
        extractorVersion: "openai-catalog-v1",
        fields: [
          "model_id",
          "name",
          "description",
          "aliases",
          "types",
          "modalities",
          "capabilities",
          "limits",
          "pricing",
          "status",
          "is_deprecated",
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
        extractorVersion: "openai-deprecations-v1",
        fields: ["status", "is_deprecated", "retired_at", "replacement_model_ids"],
        allowedHosts: ["developers.openai.com"],
        maxResponseBytes: mebibytes(8),
        scope: "global",
        exhaustive: true,
        role: "overlay",
        optional: true,
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
        snapshotPolicy: "none",
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
    sources: [
      {
        id: "anthropic-models",
        url: "https://platform.claude.com/docs/en/about-claude/models/overview.md",
        type: "website",
        access: "public",
        format: "markdown",
        stability: "semi_structured",
        extractor: { kind: "anthropic-catalog" },
        extractorVersion: "anthropic-catalog-v1",
        fields: [
          "model_id",
          "name",
          "description",
          "aliases",
          "types",
          "modalities",
          "capabilities",
          "limits",
          "release_date",
          "pricing",
          "status",
          "is_deprecated",
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
          markdownSuffix: true,
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
        snapshotPolicy: "none",
      },
    ],
    warnOnMissing: {
      sourceId: "anthropic-models",
      fields: ["limits.context_tokens", "pricing"],
      statuses: ["active", "preview", "deprecated"],
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
    sources: [
      {
        id: "bedrock-models",
        url: "https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards.md",
        type: "website",
        access: "public",
        format: "mixed",
        stability: "semi_structured",
        extractor: { kind: "bedrock-catalog" },
        extractorVersion: "bedrock-catalog-v2",
        fields: [
          "model_id",
          "name",
          "description",
          "aliases",
          "types",
          "modalities",
          "capabilities",
          "limits",
          "release_date",
          "pricing",
          "status",
          "is_deprecated",
          "deprecated_at",
          "retired_at",
        ],
        allowedHosts: ["docs.aws.amazon.com", "pricing.us-east-1.amazonaws.com"],
        maxResponseBytes: mebibytes(32),
        scope: "global",
        exhaustive: true,
        role: "catalog",
        linkedDocuments: {
          path: /^\/bedrock\/latest\/userguide\/model-card-[a-z0-9-]+\.md$/,
          indexFormat: "markdown",
          minDocuments: 100,
          maxDocuments: 200,
          concurrency: 8,
          maxDocumentBytes: mebibytes(2),
          documents: [
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
        extractorVersion: "bedrock-api-v1",
        fields: [
          "name",
          "modalities",
          "capabilities",
          "release_date",
          "status",
          "is_deprecated",
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
        snapshotPolicy: "none",
      },
    ],
    supersededIdKinds: ["display_name"],
    warnOnMissing: {
      sourceId: "bedrock-models",
      fields: ["limits.context_tokens", "pricing"],
      statuses: ["active", "preview", "deprecated"],
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
    sources: [
      {
        id: "databricks-models",
        url: "https://docs.databricks.com/aws/en/machine-learning/foundation-model-apis/supported-models",
        type: "website",
        access: "public",
        format: "mixed",
        stability: "semi_structured",
        extractor: { kind: "databricks-catalog", minModels: 40, maxModels: 80 },
        extractorVersion: "databricks-catalog-v1",
        fields: [
          "model_id",
          "name",
          "description",
          "types",
          "modalities",
          "capabilities",
          "limits",
          "release_date",
          "pricing",
          "status",
          "is_deprecated",
          "deprecated_at",
          "retired_at",
          "replacement_model_ids",
        ],
        allowedHosts: ["docs.databricks.com", "www.databricks.com"],
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
        fields: ["types", "modalities"],
        allowedHosts: ["workspace.cloud.databricks.com"],
        maxResponseBytes: mebibytes(8),
        scope: "workspace",
        exhaustive: false,
        role: "inventory",
        optional: true,
        auth: { scheme: "bearer", env: "DATABRICKS_TOKEN" },
        transport: { kind: "databricks", hostEnv: "DATABRICKS_HOST" },
        snapshotPolicy: "none",
      },
    ],
    supersededIdKinds: ["display_name"],
    warnOnMissing: {
      sourceId: "databricks-models",
      fields: ["limits.context_tokens", "pricing", "release_date"],
      statuses: ["active", "preview", "deprecated"],
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
    sources: [
      {
        id: "vercel-models",
        url: "https://ai-gateway.vercel.sh/v1/models",
        type: "api",
        access: "public",
        format: "json",
        stability: "documented",
        extractor: { kind: "vercel-catalog", minModels: 250, maxModels: 600 },
        extractorVersion: "vercel-catalog-v2",
        fields: [
          "model_id",
          "name",
          "description",
          "types",
          "modalities",
          "capabilities",
          "limits",
          "release_date",
          "pricing",
          "status",
          "is_deprecated",
          "deprecated_at",
        ],
        allowedHosts: ["ai-gateway.vercel.sh"],
        maxResponseBytes: mebibytes(16),
        scope: "global",
        exhaustive: true,
        role: "catalog",
      },
    ],
    warnOnMissing: {
      sourceId: "vercel-models",
      fields: ["pricing"],
      statuses: ["active", "preview", "deprecated"],
    },
  },
  {
    provider: {
      id: "azure",
      name: "Azure AI Foundry",
      kind: "cloud_platform",
      homepage: "https://azure.microsoft.com/products/ai-foundry/",
      docs_url:
        "https://learn.microsoft.com/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure",
      catalog_scope: "mixed",
    },
    sources: [
      {
        id: "azure-models",
        url: "https://raw.githubusercontent.com/MicrosoftDocs/azure-ai-docs/main/articles/foundry/openai/includes/models-azure-direct-openai.md",
        type: "repository",
        access: "public",
        format: "markdown",
        stability: "semi_structured",
        extractor: { kind: "azure-catalog", minModels: 120, maxModels: 300 },
        extractorVersion: "azure-catalog-v1",
        fields: [
          "model_id",
          "version",
          "types",
          "modalities",
          "capabilities",
          "limits",
          "availability",
          "status",
          "is_deprecated",
          "retired_at",
          "replacement_model_ids",
        ],
        allowedHosts: ["raw.githubusercontent.com"],
        maxResponseBytes: mebibytes(4),
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
          ],
        },
      },
      {
        id: "azure-api",
        url: "https://management.azure.com/subscriptions/00000000-0000-0000-0000-000000000000/providers/Microsoft.CognitiveServices/locations/location/models?api-version=2025-06-01",
        type: "api",
        access: "authenticated",
        format: "json",
        stability: "documented",
        extractor: { kind: "azure-api" },
        extractorVersion: "azure-api-v1",
        fields: [
          "model_id",
          "version",
          "description",
          "types",
          "modalities",
          "capabilities",
          "limits",
          "pricing",
          "availability",
          "status",
          "is_deprecated",
          "deprecated_at",
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
        snapshotPolicy: "none",
      },
    ],
    supersededIdKinds: ["display_name"],
    supersededModelIds: ["Cohere-command-a", "Mistral-medium-2505", "Mistral-small-2503"],
    warnOnMissing: {
      sourceId: "azure-models",
      fields: ["limits.context_tokens", "pricing", "release_date"],
      statuses: ["active", "preview", "deprecated"],
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
    sources: [
      {
        id: "gemini-models",
        url: "https://ai.google.dev/gemini-api/docs/models",
        type: "website",
        access: "public",
        format: "html",
        stability: "semi_structured",
        extractor: { kind: "gemini-catalog", minModels: 50, maxModels: 160 },
        extractorVersion: "gemini-catalog-v1",
        fields: [
          "model_id",
          "name",
          "description",
          "aliases",
          "types",
          "modalities",
          "capabilities",
          "limits",
          "release_date",
          "updated_date",
          "pricing",
          "status",
          "is_deprecated",
          "retired_at",
          "replacement_model_ids",
        ],
        allowedHosts: ["ai.google.dev"],
        maxResponseBytes: mebibytes(32),
        scope: "global",
        exhaustive: true,
        role: "catalog",
        linkedDocuments: {
          path: /^\/gemini-api\/docs\/models\/[a-z0-9.-]+$/,
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
        extractorVersion: "gemini-api-v1",
        fields: ["name", "description", "aliases", "types", "capabilities", "limits"],
        allowedHosts: ["generativelanguage.googleapis.com"],
        maxResponseBytes: mebibytes(8),
        scope: "account",
        exhaustive: false,
        role: "inventory",
        optional: true,
        auth: { scheme: "header", env: "GEMINI_API_KEY", header: "x-goog-api-key" },
        snapshotPolicy: "none",
      },
    ],
    supersededModelIds: ["gemini-2.5-flash-preview-09-2025", "gemini-flash-latest"],
    warnOnMissing: {
      sourceId: "gemini-models",
      fields: ["limits.context_tokens", "pricing", "release_date", "updated_date"],
      statuses: ["active", "preview", "deprecated"],
    },
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
      documentSource(
        "xai-models",
        "https://docs.x.ai/developers/models",
        [/^grok-[a-z0-9._-]+$/i],
        "api_id",
        /\/developers\/models\/grok-[a-z0-9._-]+$/i,
      ),
    ],
    supersededModelIds: ["grok-4.20"],
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
        type: "api",
        access: "public",
        format: "json",
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
        type: "api",
        access: "public",
        format: "json",
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
        type: "runtime",
        access: "configured",
        format: "json",
        stability: "undocumented",
        extractor: { kind: "ollama" },
        extractorVersion: "ollama-v1",
        fields: ["model_id", "name", "updated_date"],
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
