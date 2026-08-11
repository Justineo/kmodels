import type { PriceDimension } from "./pricing-schema.ts";
import type { SourcePricingEvidence } from "./source-pricing-policy.ts";
import type { Provider, ProviderModel, SourceAccess, SourceFormat, SourceKind } from "./schema.ts";

export type Extractor =
  | { kind: "openai-catalog" }
  | { kind: "openai-model-pricing" }
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
  | {
      kind: "huggingface-mapping";
      providers: string[];
      minModels: number;
      maxModels: number;
      minRoutes: number;
      maxRoutes: number;
    }
  | { kind: "huggingface-router"; minModels: number; maxModels: number }
  | { kind: "huggingface-featherless"; minModels: number; maxModels: number }
  | { kind: "huggingface-hub"; minModels: number; maxModels: number }
  | { kind: "ollama-library"; minModels: number; maxModels: number }
  | { kind: "ollama-cloud"; minModels: number; maxModels: number }
  | { kind: "bedrock-catalog" }
  | { kind: "bedrock-api" }
  | { kind: "databricks-catalog"; minModels: number; maxModels: number }
  | { kind: "databricks-api" }
  | { kind: "azure-catalog"; minModels: number; maxModels: number }
  | { kind: "azure-portal-catalog"; minModels: number; maxModels: number }
  | {
      kind: "azure-retail-prices";
      minModels: number;
      maxModels: number;
      minHandledRatio: number;
    }
  | { kind: "azure-public-pricing"; minModels: number; maxModels: number }
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
  indexFormat?: "html" | "markdown" | "typescript" | "mixed";
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
    optional?: boolean;
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
  fillOnly?: boolean;
  optional?: boolean;
  pricingRequired?: true;
  auth?:
    | { scheme: "bearer"; env: string }
    | { scheme: "header"; env: string; header: string }
    | { scheme: "aws"; envs: [string, string] }
    | { scheme: "azure"; envs: [string, string, string] }
    | { scheme: "google-service-account"; env: string };
  headers?: { name: string; value: string }[];
  transport?:
    | { kind: "aws-bedrock"; region: string }
    | { kind: "databricks"; hostEnv: string }
    | { kind: "azure-retail-prices" }
    | {
        kind: "azure-portal-models";
        registries: string[];
        pageSize: number;
        maxPages: number;
        maxModels: number;
      }
    | {
        kind: "azure-models";
        subscriptionEnv: string;
        concurrency: number;
        maxLocations: number;
        maxModels: number;
        maxModelsPerLocation: number;
      }
    | {
        kind: "google-model-garden";
        publishers: string[];
        pageSize: number;
        maxPages: number;
        maxModelsPerPublisher: number;
        concurrency: number;
      }
    | { kind: "gemini-models"; pageSize: number; maxPages: number; maxModels: number }
    | { kind: "cohere-models"; pageSize: number; maxPages: number; maxModels: number }
    | { kind: "dashscope-deployable-models"; pageSize: number; maxPages: number; maxModels: number }
    | {
        kind: "huggingface-partner-models";
        providers: string[];
        concurrency: number;
        maxPartnerBytes: number;
      }
    | { kind: "huggingface-models"; maxPages: number; maxModels: number }
    | {
        kind: "featherless-models";
        pageSize: number;
        maxPages: number;
        maxModels: number;
        concurrency: number;
        maxPageBytes: number;
      }
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

type FixedDocument = readonly [
  id: string,
  url: string,
  maxResponseMebibytes?: number | undefined,
  format?: SourceFormat | undefined,
  optional?: boolean | undefined,
];

function fixedDocuments(
  entries: readonly FixedDocument[],
): NonNullable<LinkedDocuments["documents"]> {
  return entries.map(([id, url, maxResponseMebibytes = 1, format, optional]) => ({
    id,
    url,
    maxResponseBytes: mebibytes(maxResponseMebibytes),
    ...(format === undefined ? {} : { format }),
    ...(optional === undefined ? {} : { optional }),
  }));
}

function optionalFixedDocuments(
  entries: readonly FixedDocument[],
): NonNullable<LinkedDocuments["documents"]> {
  return fixedDocuments(entries).map((document) => ({ ...document, optional: true }));
}

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
  extractorVersion: "xai-api-v2",
  fields,
  allowedHosts: ["api.x.ai"],
  maxResponseBytes: mebibytes(4),
  scope: "account",
  exhaustive: false,
  role: "inventory",
  optional: true,
  auth: { scheme: "bearer", env: "XAI_API_KEY" },
});

export const huggingFacePartnerIds = [
  "baseten",
  "cerebras",
  "cohere",
  "deepinfra",
  "fal-ai",
  "featherless-ai",
  "fireworks-ai",
  "groq",
  "hf-inference",
  "novita",
  "nscale",
  "ovhcloud",
  "publicai",
  "replicate",
  "scaleway",
  "together",
  "wavespeed",
  "zai-org",
] as const;

const huggingFaceInferenceSource: SourceManifest = {
  id: "huggingface-hf-inference",
  url: "https://huggingface.co/api/partners/hf-inference/models?status=live",
  type: "api",
  access: "public",
  format: "json",
  stability: "documented",
  extractor: {
    kind: "huggingface-mapping",
    providers: [...huggingFacePartnerIds],
    minModels: 1,
    maxModels: 100_000,
    minRoutes: 1,
    maxRoutes: 200_000,
  },
  extractorVersion: "huggingface-mapping-v8",
  pricingEvidence: firstPartyPricing("commercial_terms", "exact_id"),
  fields: ["model_id", "routes", "tasks", "modalities", "pricing", "status"],
  allowedHosts: ["huggingface.co"],
  maxResponseBytes: mebibytes(64),
  scope: "global",
  exhaustive: true,
  role: "catalog",
  transport: {
    kind: "huggingface-partner-models",
    providers: [...huggingFacePartnerIds],
    concurrency: 6,
    maxPartnerBytes: mebibytes(32),
  },
  linkedDocuments: {
    indexFormat: "mixed",
    path: /^\/docs\/inference-providers\/en\/tasks\/[a-z0-9]+(?:-[a-z0-9]+)*$/,
    minDocuments: 10,
    maxDocuments: 128,
    concurrency: 6,
    maxDocumentBytes: mebibytes(4),
    requestSuffix: ".md",
    documents: [
      {
        id: "task-index",
        url: "https://huggingface.co/docs/inference-providers/en/tasks/index.md",
        format: "markdown",
        maxResponseBytes: mebibytes(1),
      },
    ],
  },
};

const dashscopeCatalogSource = (
  id: string,
  path: string,
  category: Extract<Extractor, { kind: "dashscope-catalog" }>["category"],
  minModels: number,
  maxModels: number,
): SourceManifest => ({
  id,
  url: `https://www.alibabacloud.com/help/en/model-studio/${path.replace(/\/$/, "")}.md`,
  type: "website",
  access: "public",
  format: "markdown",
  stability: "documented",
  extractor: { kind: "dashscope-catalog", category, minModels, maxModels },
  extractorVersion: "dashscope-catalog-v5",
  fields: [
    "model_id",
    "description",
    "tasks",
    "delivery_modes",
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
  extractorVersion: "kimi-pricing-v6",
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
        ["files", "/docs/api/files"],
        ["files-upload", "/docs/api/files-upload"],
        ["files-list", "/docs/api/files-list"],
        ["files-retrieve", "/docs/api/files-retrieve"],
        ["files-delete", "/docs/api/files-delete"],
        ["files-content", "/docs/api/files-content"],
        ["cache", "/docs/guide/use-context-caching-feature-of-kimi-api"],
        ["web-search", "/docs/guide/use-web-search"],
        ["official-tools", "/docs/guide/use-official-tools"],
        ["batch-guide", "/docs/guide/use-batch-api"],
        ["batch-console", "/docs/guide/use-batch-inference"],
        ["account", "/docs/guide/account-and-payments"],
        ["organization", "/docs/guide/org-best-practice"],
        ["product-plans", "/docs/guide/product-plans"],
        ["introduction", "/docs/introduction"],
        ["terms", "/docs/agreement/modeluse"],
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
        url: "https://developers.openai.com/api/docs/models/all.md",
        type: "website",
        source: ["website", "repository"],
        access: "public",
        format: "markdown",
        stability: "semi_structured",
        extractor: { kind: "openai-catalog" },
        extractorVersion: "openai-catalog-v8",
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
          "status",
          "release_stage",
        ],
        allowedHosts: ["developers.openai.com", "raw.githubusercontent.com"],
        maxResponseBytes: mebibytes(32),
        scope: "global",
        exhaustive: true,
        role: "catalog",
        linkedDocuments: {
          indexFormat: "markdown",
          path: /^\/api\/docs\/models\/[a-z0-9._-]+$/,
          minDocuments: 80,
          maxDocuments: 140,
          concurrency: 8,
          maxDocumentBytes: mebibytes(1),
          discoverySuffix: ".md",
          requestSuffix: ".md",
          documents: (
            [
              [
                "documentation-index",
                "https://developers.openai.com/api/docs/llms.txt",
                "markdown",
                1,
              ],
              [
                "reference-index",
                "https://developers.openai.com/api/reference/llms.txt",
                "markdown",
                1,
              ],
              [
                "model-comparison",
                "https://developers.openai.com/api/docs/models/compare.md",
                "markdown",
                1,
              ],
              ["pricing", "https://developers.openai.com/api/docs/pricing.md", "markdown", 1],
              [
                "deprecations",
                "https://developers.openai.com/api/docs/deprecations.md",
                "markdown",
                2,
              ],
              [
                "data-controls",
                "https://developers.openai.com/api/docs/guides/your-data.md",
                "markdown",
                1,
              ],
              ["batch", "https://developers.openai.com/api/docs/guides/batch.md", "markdown", 1],
              [
                "cost-optimization",
                "https://developers.openai.com/api/docs/guides/cost-optimization.md",
                "markdown",
                1,
              ],
              [
                "fast-mode",
                "https://developers.openai.com/api/docs/guides/fast-mode.md",
                "markdown",
                1,
              ],
              [
                "flex-processing",
                "https://developers.openai.com/api/docs/guides/flex-processing.md",
                "markdown",
                1,
              ],
              [
                "prompt-caching",
                "https://developers.openai.com/api/docs/guides/prompt-caching.md",
                "markdown",
                1,
              ],
              [
                "rate-limits",
                "https://developers.openai.com/api/docs/guides/rate-limits.md",
                "markdown",
                1,
              ],
              [
                "realtime-costs",
                "https://developers.openai.com/api/docs/guides/realtime-costs.md",
                "markdown",
                1,
              ],
              [
                "spend-limits",
                "https://developers.openai.com/api/docs/guides/spend-limits.md",
                "markdown",
                1,
              ],
              [
                "terraform-rate-limits-and-spend",
                "https://developers.openai.com/api/docs/guides/terraform/rate-limits-and-spend.md",
                "markdown",
                1,
              ],
              [
                "openapi",
                "https://raw.githubusercontent.com/openai/openai-openapi/master/openapi.yaml",
                "mixed",
                16,
              ],
            ] as const
          ).map(([id, url, format, maxResponseMebibytes]) => ({
            id,
            url,
            format,
            maxResponseBytes: mebibytes(maxResponseMebibytes),
          })),
        },
      },
      {
        id: "openai-overview",
        url: "https://developers.openai.com/api/docs/models/all",
        type: "website",
        access: "public",
        format: "html",
        stability: "semi_structured",
        extractor: { kind: "openai-model-pricing" },
        extractorVersion: "openai-model-pricing-v1",
        pricingEvidence: firstPartyPricing("model_catalog", "exact_id"),
        fields: ["model_id", "tasks", "pricing"],
        allowedHosts: ["developers.openai.com"],
        maxResponseBytes: mebibytes(64),
        scope: "global",
        exhaustive: false,
        role: "overlay",
        optional: true,
        linkedDocuments: {
          path: /^\/api\/docs\/models\/[a-z0-9._-]+$/,
          minDocuments: 80,
          maxDocuments: 140,
          concurrency: 8,
          maxDocumentBytes: mebibytes(2),
        },
      },
      {
        id: "openai-deprecations",
        url: "https://developers.openai.com/api/docs/deprecations.md",
        type: "website",
        access: "public",
        format: "markdown",
        stability: "semi_structured",
        extractor: { kind: "openai-deprecations" },
        extractorVersion: "openai-deprecations-v3",
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
        extractorVersion: "openai-pricing-v3",
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
        extractorVersion: "anthropic-catalog-v12",
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
        allowedHosts: ["platform.claude.com", "claude.com"],
        maxResponseBytes: mebibytes(8),
        scope: "global",
        exhaustive: true,
        role: "catalog",
        linkedDocuments: {
          path: /^$/,
          minDocuments: 0,
          maxDocuments: 0,
          concurrency: 6,
          maxDocumentBytes: mebibytes(2),
          documents: fixedDocuments([
            ["documentation-index", "https://platform.claude.com/llms.txt"],
            ["current-pricing", "https://claude.com/pricing", 2],
            ["pricing", "https://platform.claude.com/docs/en/about-claude/pricing.md", 2],
            [
              "model-deprecations",
              "https://platform.claude.com/docs/en/about-claude/model-deprecations.md",
              2,
            ],
            [
              "model-ids-and-versions",
              "https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions.md",
            ],
            [
              "fable-mythos-launch",
              "https://platform.claude.com/docs/en/about-claude/models/introducing-claude-fable-5-and-claude-mythos-5.md",
            ],
            ["models-list", "https://platform.claude.com/docs/en/api/models/list.md"],
            ["messages-create", "https://platform.claude.com/docs/en/api/messages/create.md"],
            [
              "message-batches-create",
              "https://platform.claude.com/docs/en/api/messages/batches/create.md",
            ],
            [
              "batch-processing",
              "https://platform.claude.com/docs/en/build-with-claude/batch-processing.md",
            ],
            ["citations", "https://platform.claude.com/docs/en/build-with-claude/citations.md"],
            ["pdf-support", "https://platform.claude.com/docs/en/build-with-claude/pdf-support.md"],
            [
              "context-editing",
              "https://platform.claude.com/docs/en/build-with-claude/context-editing.md",
            ],
            [
              "structured-outputs",
              "https://platform.claude.com/docs/en/build-with-claude/structured-outputs.md",
              2,
            ],
            [
              "code-execution",
              "https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool.md",
            ],
            [
              "web-search",
              "https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool.md",
            ],
            [
              "web-fetch",
              "https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool.md",
            ],
            [
              "advisor",
              "https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool.md",
            ],
            [
              "computer-use",
              "https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool.md",
            ],
            ["effort", "https://platform.claude.com/docs/en/build-with-claude/effort.md"],
            [
              "prompt-caching",
              "https://platform.claude.com/docs/en/build-with-claude/prompt-caching.md",
              2,
            ],
            ["glossary", "https://platform.claude.com/docs/en/about-claude/glossary.md"],
            ["thinking", "https://platform.claude.com/docs/en/build-with-claude/thinking.md"],
            ["compaction", "https://platform.claude.com/docs/en/build-with-claude/compaction.md"],
            [
              "token-counting",
              "https://platform.claude.com/docs/en/build-with-claude/token-counting.md",
            ],
            ["files", "https://platform.claude.com/docs/en/build-with-claude/files.md"],
            [
              "tool-use",
              "https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools.md",
              2,
            ],
            ["fast-mode", "https://platform.claude.com/docs/en/build-with-claude/fast-mode.md"],
            ["service-tiers", "https://platform.claude.com/docs/en/api/service-tiers.md"],
            [
              "data-residency",
              "https://platform.claude.com/docs/en/manage-claude/data-residency.md",
            ],
            [
              "usage-cost-api",
              "https://platform.claude.com/docs/en/manage-claude/usage-cost-api.md",
            ],
            [
              "messages-usage-report",
              "https://platform.claude.com/docs/en/api/admin/usage_report/retrieve_messages.md",
            ],
            [
              "cost-report",
              "https://platform.claude.com/docs/en/api/admin/cost_report/retrieve.md",
            ],
            [
              "fallback-credit",
              "https://platform.claude.com/docs/en/build-with-claude/fallback-credit.md",
            ],
            [
              "managed-agents-overview",
              "https://platform.claude.com/docs/en/managed-agents/overview.md",
            ],
            [
              "managed-agents-create",
              "https://platform.claude.com/docs/en/api/beta/agents/create.md",
              2,
            ],
            [
              "managed-agents-events",
              "https://platform.claude.com/docs/en/managed-agents/events-and-streaming.md",
              2,
            ],
            ["release-notes", "https://platform.claude.com/docs/en/release-notes/overview.md", 4],
          ]),
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
        extractorVersion: "bedrock-catalog-v15",
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
          documents: fixedDocuments([
            [
              "bedrock-mantle",
              "https://docs.aws.amazon.com/bedrock/latest/userguide/bedrock-mantle.md",
            ],
            [
              "bedrock-model-catalog-contract",
              "https://docs.aws.amazon.com/bedrock/latest/userguide/models-supported.md",
            ],
            [
              "bedrock-list-foundation-models-contract",
              "https://docs.aws.amazon.com/bedrock/latest/APIReference/API_ListFoundationModels.md",
            ],
            [
              "bedrock-foundation-model-summary-contract",
              "https://docs.aws.amazon.com/bedrock/latest/APIReference/API_FoundationModelSummary.md",
            ],
            [
              "bedrock-foundation-model-lifecycle-contract",
              "https://docs.aws.amazon.com/bedrock/latest/APIReference/API_FoundationModelLifecycle.md",
            ],
            [
              "bedrock-converse-contract",
              "https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.md",
            ],
            [
              "bedrock-count-tokens-contract",
              "https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_CountTokens.md",
            ],
            [
              "bedrock-service-tiers-contract",
              "https://docs.aws.amazon.com/bedrock/latest/userguide/service-tiers-inference.md",
            ],
            [
              "bedrock-conversation-usage-contract",
              "https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.md",
            ],
            [
              "bedrock-prompt-caching-contract",
              "https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.md",
            ],
            [
              "bedrock-token-counting-guide-contract",
              "https://docs.aws.amazon.com/bedrock/latest/userguide/count-tokens.md",
            ],
            [
              "bedrock-invocation-logging-contract",
              "https://docs.aws.amazon.com/bedrock/latest/userguide/model-invocation-logging.md",
            ],
            [
              "bedrock-cost-management-contract",
              "https://docs.aws.amazon.com/bedrock/latest/userguide/cost-management.md",
            ],
            [
              "bedrock-cur-contract",
              "https://docs.aws.amazon.com/bedrock/latest/userguide/cost-mgmt-understanding-cur-data.md",
            ],
            [
              "aws-price-list-precedence-contract",
              "https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/price-changes.md",
            ],
            [
              "aws-price-list-bulk-contract",
              "https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/bulk-api-reading-price-list-files.md",
            ],
            [
              "aws-billing-latency-contract",
              "https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/view-billing-dashboard.md",
            ],
            ["bedrock-public-pricing", "https://aws.amazon.com/bedrock/pricing/", 8, "html"],
            [
              "bedrock-agentcore-pricing",
              "https://aws.amazon.com/bedrock/agentcore/pricing/",
              2,
              "html",
            ],
            [
              "bedrock-cohere-embed-v4-marketplace",
              "https://aws.amazon.com/marketplace/pp/prodview-j3fgisven2yrs",
              1,
              "html",
            ],
            [
              "pricing-bedrock",
              "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrock/current/index.json",
              20,
            ],
            [
              "pricing-foundation-models",
              "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrockFoundationModels/current/index.json",
              8,
            ],
            [
              "pricing-service",
              "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrockService/current/index.json",
              2,
            ],
            [
              "pricing-agentcore",
              "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrockAgentCore/current/index.json",
              12,
            ],
          ]),
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
        extractorVersion: "bedrock-api-v4",
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
        extractorVersion: "databricks-catalog-v8",
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
          documents: fixedDocuments([
            [
              "overview",
              "https://docs.databricks.com/aws/en/machine-learning/model-serving/foundation-model-overview",
              2,
            ],
            [
              "lifecycle",
              "https://docs.databricks.com/aws/en/machine-learning/retired-models-policy",
            ],
            [
              "pricing-open",
              "https://www.databricks.com/product/pricing/foundation-model-serving",
              2,
            ],
            [
              "pricing-partner",
              "https://www.databricks.com/product/pricing/proprietary-foundation-model-serving",
              2,
            ],
            [
              "priority-mode",
              "https://docs.databricks.com/aws/en/machine-learning/foundation-model-apis/priority-mode",
            ],
            ["google-image-pricing", "https://ai.google.dev/gemini-api/docs/pricing?hl=en", 4],
            [
              "limits",
              "https://docs.databricks.com/aws/en/machine-learning/foundation-model-apis/limits",
            ],
            [
              "api-reference",
              "https://docs.databricks.com/aws/en/machine-learning/foundation-model-apis/api-reference",
              2,
            ],
            [
              "model-types",
              "https://docs.databricks.com/aws/en/machine-learning/model-serving/score-foundation-models",
            ],
            ["system-tables", "https://docs.databricks.com/aws/en/admin/system-tables"],
            ["billing-usage", "https://docs.databricks.com/aws/en/admin/system-tables/billing"],
            ["list-pricing", "https://docs.databricks.com/aws/en/admin/system-tables/pricing"],
            [
              "model-serving-cost",
              "https://docs.databricks.com/aws/en/admin/system-tables/model-serving-cost",
            ],
            [
              "legacy-endpoint-usage",
              "https://docs.databricks.com/aws/en/ai-gateway/configure-ai-gateway-endpoints",
            ],
            ["ai-gateway-usage", "https://docs.databricks.com/aws/en/ai-gateway/usage-tracking"],
            ["ai-gateway-cost", "https://docs.databricks.com/aws/en/ai-gateway/cost-observability"],
            [
              "pricing-cards",
              "https://www.databricks.com/en-pricing-assets/data/pricing/cards.json",
            ],
            ...[
              "ai-gateway",
              "agent-bricks",
              "ai-functions",
              "model-serving",
              "ai-search",
              "agent-evaluation",
              "foundation-model-training",
              "ai-runtime",
              "genie",
            ].map(
              (page) =>
                [
                  `pricing-${page}`,
                  `https://www.databricks.com/en-pricing-assets/page-data/product/pricing/${page}/page-data.json`,
                ] as const,
            ),
            ["release-feed", "https://docs.databricks.com/aws/en/feed.xml", 2],
          ]),
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
        extractorVersion: "vercel-catalog-v12",
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
          documents: fixedDocuments([
            [
              "models-and-providers",
              "https://vercel.com/docs/ai-gateway/models-and-providers.md",
              1,
              "markdown",
            ],
            ["pricing-policy", "https://vercel.com/docs/ai-gateway/pricing.md", 1, "markdown"],
            ["model-directory", "https://vercel.com/ai-gateway/models", 4, "html"],
            ["sitemap", "https://vercel.com/crawled-sitemap.xml", 2, "mixed"],
            [
              "free-credit-policy",
              "https://vercel.com/kb/guide/how-i-use-opencode-with-vercel-ai-gateway-to-build-features-fast.md",
              1,
              "markdown",
            ],
            [
              "provider-options",
              "https://vercel.com/docs/ai-gateway/models-and-providers/provider-options.md",
              1,
              "markdown",
            ],
            [
              "provider-filtering-and-ordering",
              "https://vercel.com/docs/ai-gateway/models-and-providers/provider-filtering-and-ordering.md",
              1,
              "markdown",
            ],
            [
              "fast-mode",
              "https://vercel.com/docs/ai-gateway/models-and-providers/fast-mode.md",
              1,
              "markdown",
            ],
            [
              "service-tiers",
              "https://vercel.com/docs/ai-gateway/models-and-providers/service-tiers.md",
              1,
              "markdown",
            ],
            [
              "web-search",
              "https://vercel.com/docs/ai-gateway/models-and-providers/web-search.md",
              1,
              "markdown",
            ],
            [
              "routing-rules",
              "https://vercel.com/docs/ai-gateway/models-and-providers/routing-rules.md",
              1,
              "markdown",
            ],
            [
              "regional-inference",
              "https://vercel.com/docs/ai-gateway/security-and-compliance/regional-inference.md",
              1,
              "markdown",
            ],
            [
              "byok",
              "https://vercel.com/docs/ai-gateway/authentication-and-byok/byok.md",
              1,
              "markdown",
            ],
            [
              "rest-api",
              "https://vercel.com/docs/ai-gateway/sdks-and-apis/rest-api.md",
              1,
              "markdown",
            ],
            [
              "custom-reporting",
              "https://vercel.com/docs/ai-gateway/observability-and-spend/custom-reporting.md",
              1,
              "markdown",
            ],
            [
              "budgets",
              "https://vercel.com/docs/ai-gateway/observability-and-spend/budgets.md",
              1,
              "markdown",
            ],
            [
              "trace-drains",
              "https://vercel.com/docs/ai-gateway/observability-and-spend/trace-drains.md",
              1,
              "markdown",
            ],
            ["drains", "https://vercel.com/docs/drains.md", 1, "markdown"],
            [
              "model-allowlist",
              "https://vercel.com/docs/ai-gateway/security-and-compliance/model-allowlist.md",
              1,
              "markdown",
            ],
            [
              "provider-allowlist",
              "https://vercel.com/docs/ai-gateway/security-and-compliance/provider-allowlist.md",
              1,
              "markdown",
            ],
            [
              "zdr",
              "https://vercel.com/docs/ai-gateway/security-and-compliance/zdr.md",
              1,
              "markdown",
            ],
            [
              "disallow-prompt-training",
              "https://vercel.com/docs/ai-gateway/security-and-compliance/disallow-prompt-training.md",
              1,
              "markdown",
            ],
            [
              "logs",
              "https://vercel.com/docs/ai-gateway/observability-and-spend/logs.md",
              1,
              "markdown",
            ],
            [
              "usage",
              "https://vercel.com/docs/ai-gateway/observability-and-spend/usage.md",
              1,
              "markdown",
            ],
          ]),
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
        extractorVersion: "azure-catalog-v6",
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
          documents: fixedDocuments([
            [
              "direct-others",
              "https://raw.githubusercontent.com/MicrosoftDocs/azure-ai-docs/main/articles/foundry/foundry-models/includes/models-azure-direct-others.md",
            ],
            [
              "partners",
              "https://raw.githubusercontent.com/MicrosoftDocs/azure-ai-docs/main/articles/foundry/foundry-models/includes/models-partners.md",
            ],
            [
              "lifecycle",
              "https://raw.githubusercontent.com/MicrosoftDocs/azure-ai-docs/main/articles/foundry/openai/includes/concepts-model-retirement-schedule-content.md",
            ],
            [
              "retired",
              "https://raw.githubusercontent.com/MicrosoftDocs/azure-ai-docs/main/articles/foundry/openai/includes/concepts-retired-models-content.md",
            ],
            [
              "standard",
              "https://raw.githubusercontent.com/MicrosoftDocs/azure-ai-docs/main/articles/foundry/foundry-models/includes/model-matrix/deployments-standard.md",
            ],
            [
              "provisioned",
              "https://raw.githubusercontent.com/MicrosoftDocs/azure-ai-docs/main/articles/foundry/foundry-models/includes/model-matrix/deployments-provisioned.md",
            ],
            [
              "batch",
              "https://raw.githubusercontent.com/MicrosoftDocs/azure-ai-docs/main/articles/foundry/foundry-models/includes/model-matrix/deployments-batch.md",
            ],
            [
              "openai-v1",
              "https://raw.githubusercontent.com/Azure/azure-rest-api-specs/main/specification/ai/data-plane/OpenAI.v1/azure-v1-v1-generated.yaml",
              2,
            ],
            [
              "openai-v1-preview",
              "https://raw.githubusercontent.com/Azure/azure-rest-api-specs/main/specification/ai/data-plane/OpenAI.v1/azure-v1-preview-generated.yaml",
              2,
            ],
            [
              "foundry-costs",
              "https://raw.githubusercontent.com/MicrosoftDocs/azure-ai-docs/main/articles/foundry/concepts/manage-costs.md",
            ],
            [
              "openai-prompt-caching",
              "https://raw.githubusercontent.com/MicrosoftDocs/azure-ai-docs/main/articles/foundry/openai/includes/how-to-prompt-caching-content.md",
            ],
            [
              "claude-billing",
              "https://raw.githubusercontent.com/MicrosoftDocs/azure-ai-docs/main/articles/foundry/foundry-models/concepts/claude-models-billing.md",
            ],
            [
              "cost-management-automation",
              "https://raw.githubusercontent.com/MicrosoftDocs/azure-docs/main/articles/cost-management-billing/costs/manage-automation.md",
            ],
          ]),
        },
      },
      {
        id: "azure-portal-models",
        url: "https://ai.azure.com/api/westus2/ux/v1.0/entities/crossRegion",
        type: "api",
        source: ["api", "website"],
        access: "public",
        format: "json",
        stability: "undocumented",
        extractor: { kind: "azure-portal-catalog", minModels: 50, maxModels: 150 },
        extractorVersion: "azure-portal-catalog-v1",
        fields: [
          "model_id",
          "version",
          "name",
          "description",
          "tasks",
          "service_families",
          "modalities",
          "capabilities",
          "limits",
          "availability",
          "status",
          "release_stage",
          "deprecated_at",
          "retired_at",
        ],
        allowedHosts: ["ai.azure.com"],
        maxResponseBytes: mebibytes(8),
        scope: "global",
        exhaustive: false,
        role: "supplement",
        fillOnly: true,
        headers: [
          { name: "X-Ms-User-Agent", value: "AzureMachineLearningWorkspacePortal/3.0" },
          { name: "x-ms-useragent", value: "AzureMachineLearningWorkspacePortal/3.0" },
        ],
        transport: {
          kind: "azure-portal-models",
          registries: [
            "azure-openai",
            "azureml-msr",
            "azureml",
            "azureml-meta",
            "azureml-mistral",
            "nvidia-ai",
            "azureml-nixtla",
            "azureml-core42",
            "azureml-cohere",
            "azureml-restricted",
            "HuggingFace",
          ],
          pageSize: 50,
          maxPages: 5,
          maxModels: 250,
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
        id: "azure-public-pricing",
        url: "https://azure.microsoft.com/en-us/pricing/details/ai-foundry-models/microsoft/",
        type: "website",
        access: "public",
        format: "html",
        stability: "semi_structured",
        extractor: { kind: "azure-public-pricing", minModels: 40, maxModels: 250 },
        extractorVersion: "azure-public-pricing-v2",
        pricingEvidence: firstPartyPricing("price_book", "base_model_id"),
        fields: ["pricing"],
        allowedHosts: ["azure.microsoft.com"],
        maxResponseBytes: mebibytes(8),
        scope: "global",
        exhaustive: false,
        role: "overlay",
        linkedDocuments: {
          path: /^\/en-us\/pricing\/details\/ai-foundry-models\/(?!(?:aoai|fine-tuning-models|microsoft)\/$)[a-z0-9]+(?:-[a-z0-9]+)*\/$/,
          minDocuments: 9,
          maxDocuments: 20,
          concurrency: 5,
          maxDocumentBytes: mebibytes(2),
          documents: [
            {
              id: "azure-openai",
              url: "https://azure.microsoft.com/en-us/pricing/details/azure-openai/",
              maxResponseBytes: mebibytes(8),
            },
            {
              id: "fine-tuning-models",
              url: "https://azure.microsoft.com/en-us/pricing/details/ai-foundry-models/fine-tuning-models/",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "foundry-agent-service",
              url: "https://azure.microsoft.com/en-us/pricing/details/foundry-agent-service/",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "content-safety",
              url: "https://azure.microsoft.com/en-us/pricing/details/content-safety/",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "foundry-observability",
              url: "https://azure.microsoft.com/en-us/pricing/details/foundryobservability/",
              maxResponseBytes: mebibytes(2),
            },
            {
              id: "microsoft-foundry",
              url: "https://azure.microsoft.com/en-us/pricing/details/microsoft-foundry/",
              maxResponseBytes: mebibytes(2),
            },
          ],
        },
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
        url: "https://management.azure.com/subscriptions/00000000-0000-0000-0000-000000000000/providers/Microsoft.CognitiveServices/resourceTypes?api-version=2021-04-01",
        type: "api",
        access: "authenticated",
        format: "json",
        stability: "documented",
        extractor: { kind: "azure-api" },
        extractorVersion: "azure-api-v3",
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
        maxResponseBytes: mebibytes(64),
        scope: "account",
        exhaustive: false,
        role: "inventory",
        optional: true,
        auth: {
          scheme: "azure",
          envs: ["AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET"],
        },
        transport: {
          kind: "azure-models",
          subscriptionEnv: "AZURE_SUBSCRIPTION_ID",
          concurrency: 6,
          maxLocations: 64,
          maxModels: 50_000,
          maxModelsPerLocation: 5_000,
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
        extractorVersion: "gemini-catalog-v7",
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
        allowedHosts: [
          "ai.google.dev",
          "cloud.google.com",
          "docs.cloud.google.com",
          "generativelanguage.googleapis.com",
        ],
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
          documents: fixedDocuments([
            ["pricing", "https://ai.google.dev/gemini-api/docs/pricing"],
            ["deprecations", "https://ai.google.dev/gemini-api/docs/deprecations"],
            ["changelog", "https://ai.google.dev/gemini-api/docs/changelog"],
            ["gemma-api", "https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api"],
            ["gemma-card", "https://ai.google.dev/gemma/docs/core/model_card_4", 2],
            [
              "interactions-overview",
              "https://ai.google.dev/gemini-api/docs/interactions-overview",
            ],
            ["interactions-api", "https://ai.google.dev/api/interactions-api", 2],
            [
              "discovery",
              "https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta",
              1,
              "json",
            ],
            ["live-api", "https://ai.google.dev/api/live"],
            ["billing", "https://ai.google.dev/gemini-api/docs/billing"],
            ["implicit-caching", "https://ai.google.dev/gemini-api/docs/caching"],
            ["explicit-caching", "https://ai.google.dev/gemini-api/docs/generate-content/caching"],
            ["tokens", "https://ai.google.dev/gemini-api/docs/tokens"],
            ["flex-inference", "https://ai.google.dev/gemini-api/docs/flex-inference"],
            ["priority-inference", "https://ai.google.dev/gemini-api/docs/priority-inference"],
            ["google-search", "https://ai.google.dev/gemini-api/docs/google-search"],
            ["google-maps", "https://ai.google.dev/gemini-api/docs/maps-grounding"],
            ["batch-api", "https://ai.google.dev/gemini-api/docs/batch-api", 2],
            ["file-search", "https://ai.google.dev/gemini-api/docs/file-search", 2],
            ["url-context", "https://ai.google.dev/gemini-api/docs/url-context"],
            ["code-execution", "https://ai.google.dev/gemini-api/docs/code-execution"],
            ["computer-use", "https://ai.google.dev/gemini-api/docs/computer-use", 2],
            ["model-tuning", "https://ai.google.dev/gemini-api/docs/model-tuning"],
            ["deep-research", "https://ai.google.dev/gemini-api/docs/deep-research", 2],
            ["agents", "https://ai.google.dev/gemini-api/docs/agents"],
            ["agent-environment", "https://ai.google.dev/gemini-api/docs/agent-environment", 2],
            [
              "cloud-pricing-api",
              "https://docs.cloud.google.com/billing/docs/how-to/get-pricing-information-api",
              2,
            ],
            [
              "cloud-billing-export",
              "https://docs.cloud.google.com/billing/docs/how-to/export-data-bigquery-tables",
              2,
            ],
            [
              "cloud-sku-group",
              "https://cloud.google.com/skus/sku-groups/google-developer-program-premium-genai-credit",
              2,
            ],
          ]),
        },
      },
      {
        id: "gemini-api",
        url: "https://generativelanguage.googleapis.com/v1beta/models",
        type: "api",
        access: "authenticated",
        format: "json",
        stability: "documented",
        extractor: { kind: "gemini-api" },
        extractorVersion: "gemini-api-v3",
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
        transport: { kind: "gemini-models", pageSize: 1000, maxPages: 5, maxModels: 5_000 },
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
        },
        extractorVersion: "vertex-catalog-v7",
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
        allowedHosts: ["docs.cloud.google.com", "cloud.google.com", "aiplatform.googleapis.com"],
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
          documents: fixedDocuments([
            [
              "lifecycle",
              "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/model-versions",
              2,
            ],
            [
              "imagen",
              "https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/imagen/4-0-generate",
              2,
            ],
            [
              "generate-api",
              "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/start",
              2,
            ],
            [
              "embedding-api",
              "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/embeddings/get-multimodal-embeddings",
              2,
            ],
            [
              "text-embedding-api",
              "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/embeddings/get-text-embeddings",
              2,
            ],
            [
              "image-api",
              "https://docs.cloud.google.com/vertex-ai/generative-ai/docs/image/generate-images",
              2,
            ],
            [
              "video-api",
              "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/video/generate-videos-from-text",
              2,
            ],
            [
              "music-api",
              "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/music/generate-music",
              2,
            ],
            [
              "pricing",
              "https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing",
              6,
            ],
            ["billing-skus", "https://cloud.google.com/skus/sku-groups/gen-ai", 2],
            ["billing-skus-v2", "https://cloud.google.com/skus/sku-groups/gen-ai-v2", 2],
            ["discovery", "https://aiplatform.googleapis.com/$discovery/rest?version=v1beta1", 6],
            [
              "grounding-search",
              "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/grounding/grounding-with-google-search",
              2,
            ],
            [
              "grounding-maps",
              "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/grounding/grounding-with-google-maps",
              2,
            ],
            [
              "grounding-data",
              "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/grounding/grounding-with-vertex-ai-search",
              2,
            ],
            [
              "standard-paygo",
              "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/standard-paygo",
              2,
            ],
            [
              "flex-paygo",
              "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/flex-paygo",
              2,
            ],
            [
              "priority-paygo",
              "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/priority-paygo",
              2,
            ],
            [
              "batch-inference",
              "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/batch-inference",
              2,
            ],
            [
              "context-cache",
              "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/context-cache/context-cache-overview",
              2,
            ],
            [
              "provisioned-throughput-purchase",
              "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/provisioned-throughput/purchase-provisioned-throughput",
              2,
            ],
            [
              "provisioned-throughput-routing",
              "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/provisioned-throughput/use-provisioned-throughput",
              2,
            ],
            [
              "provisioned-throughput-accounting",
              "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/provisioned-throughput/measure-provisioned-throughput",
              2,
            ],
            [
              "cloud-pricing-api",
              "https://docs.cloud.google.com/billing/docs/how-to/get-pricing-information-api",
              2,
            ],
            [
              "cloud-billing-export",
              "https://docs.cloud.google.com/billing/docs/how-to/export-data-bigquery-tables/standard-usage",
              2,
            ],
            [
              "agent-search-pricing",
              "https://cloud.google.com/generative-ai-app-builder/pricing",
              2,
            ],
          ]),
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
        },
        extractorVersion: "vertex-catalog-v6",
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
          documents: fixedDocuments([
            [
              "claude-api",
              "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/claude/use-claude",
              2,
            ],
            [
              "claude-web-search",
              "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/claude/web-search",
              2,
            ],
            [
              "grok-api",
              "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/grok/responses",
              2,
            ],
            [
              "llama-api",
              "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/llama/use-llama",
              2,
            ],
            [
              "deprecations",
              "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/deprecations/partner-models",
              4,
            ],
            [
              "pricing",
              "https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing",
              6,
            ],
          ]),
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
        },
        extractorVersion: "vertex-catalog-v6",
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
          documents: fixedDocuments([
            [
              "open-api",
              "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/maas/call-open-model-apis",
              2,
            ],
            [
              "text-embedding-api",
              "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/embeddings/get-text-embeddings",
              2,
            ],
            [
              "deprecations",
              "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/deprecations/open-models",
              2,
            ],
            [
              "pricing",
              "https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing",
              6,
            ],
          ]),
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
          pageSize: 300,
          maxPages: 20,
          maxModelsPerPublisher: 5_000,
          concurrency: 4,
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
        source: ["website", "repository"],
        access: "public",
        format: "mixed",
        stability: "semi_structured",
        extractor: {
          kind: "cohere-catalog",
          minModels: 40,
          maxModels: 70,
          minPricingCoverage: 0.6,
        },
        extractorVersion: "cohere-catalog-v9",
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
        allowedHosts: ["docs.cohere.com", "cohere.com", "raw.githubusercontent.com"],
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
          documents: fixedDocuments([
            ["overview", "https://docs.cohere.com/docs/models", 2],
            ["deprecations", "https://docs.cohere.com/docs/deprecations", 2],
            ["pricing", "https://cohere.com/pricing", 2],
            ["pricing-policy", "https://docs.cohere.com/docs/how-does-cohere-pricing-work.md"],
            ["rate-limits", "https://docs.cohere.com/docs/rate-limits.md"],
            [
              "commercial-batch",
              "https://docs.cohere.com/reference/create-batch.md",
              1,
              undefined,
              true,
            ],
            [
              "commercial-tool-use",
              "https://docs.cohere.com/v2/docs/tool-use-overview.md",
              1,
              undefined,
              true,
            ],
            [
              "commercial-v1-v2-migration",
              "https://docs.cohere.com/v2/docs/migrating-v1-to-v2.md",
              1,
              undefined,
              true,
            ],
            [
              "model-vault-overview",
              "https://docs.cohere.com/docs/model-vault.md",
              2,
              undefined,
              true,
            ],
            [
              "standard-vault-models",
              "https://docs.cohere.com/docs/model-vault/standard/supported-models.md",
              1,
              undefined,
              true,
            ],
            [
              "standard-vault-pricing",
              "https://docs.cohere.com/docs/model-vault/standard/pricing.md",
              1,
              undefined,
              true,
            ],
            [
              "encrypted-vault-models",
              "https://docs.cohere.com/docs/model-vault/encrypted/supported-models.md",
              1,
              undefined,
              true,
            ],
            [
              "encrypted-vault-pricing",
              "https://docs.cohere.com/docs/model-vault/encrypted/pricing.md",
              1,
              undefined,
              true,
            ],
            [
              "model-vault-north",
              "https://docs.cohere.com/docs/model-vault/model-vault-with-north.md",
              1,
              undefined,
              true,
            ],
            [
              "private-deployment",
              "https://docs.cohere.com/docs/private-deployment-overview.md",
              1,
              undefined,
              true,
            ],
            ["billing-errors", "https://docs.cohere.com/reference/errors.md"],
            ["teams-and-roles", "https://docs.cohere.com/reference/teams-and-roles.md"],
            ["changelog", "https://docs.cohere.com/v2/changelog", 3],
            ["release-command-a", "https://docs.cohere.com/changelog/command-a", 2],
            ["release-command-r7b", "https://docs.cohere.com/changelog/command-r-7b/", 2],
            ["release-command-r", "https://docs.cohere.com/v1/changelog/command-gets-refreshed", 2],
            ["release-rerank-v3-5", "https://docs.cohere.com/changelog/rerank-v3.5", 2],
            ["api-chat-v2", "https://docs.cohere.com/reference/chat.md"],
            ["api-chat-v1", "https://docs.cohere.com/reference/chat-v1.md"],
            ["api-chat-stream-v2", "https://docs.cohere.com/reference/chat-stream.md"],
            ["api-embed-v2", "https://docs.cohere.com/reference/embed.md"],
            ["api-embed-jobs", "https://docs.cohere.com/reference/create-embed-job.md"],
            ["api-embed-job-result", "https://docs.cohere.com/reference/get-embed-job.md"],
            ["api-rerank-v2", "https://docs.cohere.com/reference/rerank.md"],
            [
              "api-transcription-v2",
              "https://docs.cohere.com/reference/create-audio-transcription.md",
            ],
            ["api-openai-compatibility", "https://docs.cohere.com/docs/compatibility-api.md"],
            ["api-generate-v1", "https://docs.cohere.com/v1/reference/generate.md"],
            [
              "openapi",
              "https://raw.githubusercontent.com/cohere-ai/cohere-developer-experience/main/cohere-openapi.yaml",
              2,
            ],
          ]),
        },
      },
      {
        id: "cohere-api",
        url: "https://api.cohere.com/v1/models",
        type: "api",
        access: "authenticated",
        format: "json",
        stability: "documented",
        extractor: { kind: "cohere-api" },
        extractorVersion: "cohere-api-v3",
        fields: ["model_id", "tasks", "api_endpoints", "limits", "status"],
        allowedHosts: ["api.cohere.com"],
        maxResponseBytes: mebibytes(8),
        scope: "account",
        exhaustive: false,
        role: "inventory",
        optional: true,
        auth: { scheme: "bearer", env: "COHERE_API_KEY" },
        transport: { kind: "cohere-models", pageSize: 1000, maxPages: 10, maxModels: 5000 },
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
    pricingCategoricalLabels: [
      ...pricingLabels("operation", { ocr: "OCR" }),
      ...pricingLabels("billing_currency", { EUR: "EUR", USD: "USD" }),
    ],
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
        extractorVersion: "mistral-catalog-v10",
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
          documents: fixedDocuments([
            [
              "model-schema",
              "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/schema/models/schema.ts",
            ],
            [
              "model-endpoints",
              "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/schema/models/endpoints.ts",
            ],
            [
              "prompt-caching",
              "https://docs.mistral.ai/studio-api/conversations/advanced/prompt-caching.md",
              1,
              undefined,
              true,
            ],
            [
              "batch-processing",
              "https://docs.mistral.ai/studio-api/batch-processing.md",
              1,
              undefined,
              true,
            ],
            ["public-pricing", "https://mistral.ai/pricing/api/", 2, undefined, true],
            [
              "api-schema",
              "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/openapi.yaml",
              2,
              undefined,
              true,
            ],
            [
              "admin-usage",
              "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/content/en/docs/admin/admin-api/usage-metrics/page.mdx",
              1,
              undefined,
              true,
            ],
            [
              "admin-billing-api",
              "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/content/en/api/endpoint/beta/admin/billing/page.mdx",
              1,
              undefined,
              true,
            ],
            [
              "account-billing",
              "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/content/en/docs/admin/billing-usage/billing/page.mdx",
              1,
              undefined,
              true,
            ],
            [
              "account-plans",
              "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/content/en/docs/admin/billing-usage/subscriptions/page.mdx",
              1,
              undefined,
              true,
            ],
            [
              "regional-inference",
              "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/content/en/docs/studio-api/regional-inference/page.mdx",
              1,
              undefined,
              true,
            ],
            [
              "agent-tools",
              "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/content/en/docs/studio-api/agents/agent-tools/page.mdx",
              1,
              undefined,
              true,
            ],
            [
              "code-interpreter",
              "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/content/en/docs/studio-api/agents/agent-tools/code_interpreter/page.mdx",
              1,
              undefined,
              true,
            ],
            [
              "web-search",
              "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/content/en/docs/studio-api/agents/agent-tools/websearch/page.mdx",
              1,
              undefined,
              true,
            ],
            [
              "image-generation",
              "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/content/en/docs/studio-api/agents/agent-tools/image_generation/page.mdx",
              1,
              undefined,
              true,
            ],
            [
              "libraries",
              "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/content/en/docs/studio-api/libraries/page.mdx",
              2,
              undefined,
              true,
            ],
            ["vibe-pricing", "https://mistral.ai/pricing/", 4, undefined, true],
            ["forge", "https://mistral.ai/products/forge/", 4, undefined, true],
            ["compute", "https://mistral.ai/products/compute/", 4, undefined, true],
            ["services", "https://mistral.ai/services/", 4, undefined, true],
          ]),
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
        extractorVersion: "mistral-api-v3",
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
        extractorVersion: "llama-catalog-v6",
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
              id: "llama-api-async-chat-example",
              url: "https://raw.githubusercontent.com/meta-llama/llama-api-python/main/examples/async_chat.py",
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
              id: "llama-api-models",
              url: "https://raw.githubusercontent.com/meta-llama/llama-api-python/main/src/llama_api_client/resources/models.py",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "llama-api-model",
              url: "https://raw.githubusercontent.com/meta-llama/llama-api-python/main/src/llama_api_client/types/llama_model.py",
              maxResponseBytes: mebibytes(1),
            },
            {
              id: "llama-api-model-list-response",
              url: "https://raw.githubusercontent.com/meta-llama/llama-api-python/main/src/llama_api_client/types/model_list_response.py",
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
            ...(
              [
                ["llama-2", "llama2"],
                ["llama-3", "llama3"],
                ["llama-3-1", "llama3_1"],
                ["llama-3-2", "llama3_2"],
                ["llama-3-3", "llama3_3"],
                ["llama-4", "llama4"],
              ] as const
            ).map(([id, path]) => ({
              id: `${id}-license`,
              url: `https://raw.githubusercontent.com/meta-llama/llama-models/main/models/${path}/LICENSE`,
              maxResponseBytes: mebibytes(1),
              optional: true,
            })),
            ...(
              [
                ["llama-3-2", "llama3_2"],
                ["llama-4", "llama4"],
              ] as const
            ).map(([id, path]) => ({
              id: `${id}-use-policy`,
              url: `https://raw.githubusercontent.com/meta-llama/llama-models/main/models/${path}/USE_POLICY.md`,
              maxResponseBytes: mebibytes(1),
              optional: true,
            })),
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
        extractorVersion: "llama-api-v2",
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
      "conversation.item.create": "Text input",
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
        extractorVersion: "xai-catalog-v9",
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
        source: ["api", "website", "repository"],
        access: "public",
        format: "json",
        stability: "documented",
        extractor: { kind: "huggingface-router", minModels: 1, maxModels: 10_000 },
        extractorVersion: "huggingface-router-v8",
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
        allowedHosts: ["router.huggingface.co", "huggingface.co", "raw.githubusercontent.com"],
        maxResponseBytes: mebibytes(16),
        scope: "global",
        exhaustive: true,
        role: "catalog",
        linkedDocuments: {
          path: /^$/,
          minDocuments: 0,
          maxDocuments: 0,
          concurrency: 4,
          documents: optionalFixedDocuments([
            [
              "pricing",
              "https://huggingface.co/docs/inference-providers/en/pricing.md",
              1,
              "markdown",
            ],
            [
              "overview",
              "https://huggingface.co/docs/inference-providers/en/index.md",
              1,
              "markdown",
            ],
            [
              "hub-api",
              "https://huggingface.co/docs/inference-providers/en/hub-api.md",
              1,
              "markdown",
            ],
            [
              "chat-completion",
              "https://huggingface.co/docs/inference-providers/en/tasks/chat-completion.md",
              1,
              "markdown",
            ],
            [
              "responses-api",
              "https://huggingface.co/docs/inference-providers/en/guides/responses-api.md",
              1,
              "markdown",
            ],
            [
              "provider-registration",
              "https://huggingface.co/docs/inference-providers/en/register-as-a-provider.md",
              1,
              "markdown",
            ],
            [
              "sdk-inference",
              "https://huggingface.co/docs/huggingface_hub/en/guides/inference.md",
              1,
              "markdown",
            ],
            [
              "sdk-provider-registry",
              "https://raw.githubusercontent.com/huggingface/huggingface_hub/main/src/huggingface_hub/inference/_providers/__init__.py",
              1,
              "markdown",
            ],
            ["hub-billing", "https://huggingface.co/docs/hub/en/billing.md", 1, "markdown"],
            [
              "endpoint-pricing",
              "https://huggingface.co/docs/inference-endpoints/en/support/pricing.md",
              2,
              "markdown",
            ],
            ["spaces-hardware", "https://huggingface.co/docs/hub/en/spaces-gpus.md", 1, "markdown"],
            [
              "spaces-zerogpu",
              "https://huggingface.co/docs/hub/en/spaces-zerogpu.md",
              1,
              "markdown",
            ],
            ["jobs-pricing", "https://huggingface.co/docs/hub/en/jobs-pricing.md", 1, "markdown"],
            ["jobs-hardware", "https://huggingface.co/api/jobs/hardware", 1, "json"],
            [
              "storage-limits",
              "https://huggingface.co/docs/hub/en/storage-limits.md",
              1,
              "markdown",
            ],
            ["pricing-page", "https://huggingface.co/pricing", 4, "html"],
            ["enterprise-page", "https://huggingface.co/enterprise", 4, "html"],
          ]),
        },
      },
      {
        id: "huggingface-featherless",
        url: "https://api.featherless.ai/v1/models?status=active&page=1&per_page=1000",
        type: "api",
        source: ["api", "website"],
        access: "public",
        format: "mixed",
        stability: "semi_structured",
        extractor: { kind: "huggingface-featherless", minModels: 1, maxModels: 50_000 },
        extractorVersion: "huggingface-featherless-v1",
        pricingEvidence: firstPartyPricing("price_book", "exact_id", "current_snapshot"),
        fields: ["limits", "pricing"],
        allowedHosts: ["api.featherless.ai", "featherless.ai"],
        maxResponseBytes: mebibytes(64),
        scope: "global",
        exhaustive: false,
        role: "overlay",
        optional: true,
        pricingRequired: true,
        transport: {
          kind: "featherless-models",
          pageSize: 1000,
          maxPages: 500,
          maxModels: 50_000,
          concurrency: 6,
          maxPageBytes: mebibytes(4),
        },
        linkedDocuments: {
          path: /^$/,
          minDocuments: 0,
          maxDocuments: 0,
          concurrency: 2,
          documents: fixedDocuments([
            ["models-api", "https://featherless.ai/docs/api-reference-models", 4, "html"],
            [
              "request-pricing",
              "https://featherless.ai/docs/request-pricing-and-credits",
              4,
              "html",
            ],
          ]),
        },
      },
      {
        id: "huggingface-hub",
        url: "https://huggingface.co/api/models?inference_provider=hf-inference&limit=1000&sort=createdAt&expand=lastModified",
        type: "api",
        access: "public",
        format: "json",
        stability: "documented",
        extractor: { kind: "huggingface-hub", minModels: 1, maxModels: 50_000 },
        extractorVersion: "huggingface-hub-v2",
        fields: ["updated_date"],
        allowedHosts: ["huggingface.co"],
        maxResponseBytes: mebibytes(16),
        scope: "global",
        exhaustive: false,
        role: "overlay",
        transport: { kind: "huggingface-models", maxPages: 100, maxModels: 50_000 },
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
        "text + audio audio only billed": "Text + audio (audio only billed)",
        "text/image": "Text / image",
        "text/image/video": "Text / image / video",
        "text multimodal input": "Text (multimodal input)",
        "text text-only input": "Text (text-only input)",
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
        url: "https://www.alibabacloud.com/help/en/model-studio/models.md",
        type: "website",
        access: "public",
        format: "markdown",
        stability: "documented",
        extractor: { kind: "dashscope-recommended", minModels: 15, maxModels: 60 },
        extractorVersion: "dashscope-recommended-v2",
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
        url: "https://www.alibabacloud.com/help/en/model-studio/model-pricing.md",
        type: "website",
        access: "public",
        format: "markdown",
        stability: "documented",
        extractor: { kind: "dashscope-pricing", minModels: 240, maxModels: 500 },
        extractorVersion: "dashscope-pricing-v7",
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
          documents: optionalFixedDocuments([
            [
              "context-cache",
              "https://www.alibabacloud.com/help/en/model-studio/context-cache.md",
              2,
            ],
            [
              "batch-inference",
              "https://www.alibabacloud.com/help/en/model-studio/batch-inference.md",
              2,
            ],
            [
              "chat-completions",
              "https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-chat-completions.md",
              2,
            ],
            [
              "responses-api",
              "https://www.alibabacloud.com/help/en/model-studio/compatibility-with-openai-responses-api.md",
              2,
            ],
            ["web-search", "https://www.alibabacloud.com/help/en/model-studio/web-search.md", 2],
            [
              "billing",
              "https://www.alibabacloud.com/help/en/model-studio/bill-query-and-cost-management.md",
              2,
            ],
          ]),
        },
      },
      {
        id: "dashscope-lifecycle",
        url: "https://www.alibabacloud.com/help/en/model-studio/model-depreciation.md",
        type: "website",
        access: "public",
        format: "markdown",
        stability: "documented",
        extractor: { kind: "dashscope-lifecycle", minModels: 15, maxModels: 150 },
        extractorVersion: "dashscope-lifecycle-v2",
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
        url: "https://www.alibabacloud.com/help/en/model-studio/newly-released-models.md",
        type: "website",
        access: "public",
        format: "markdown",
        stability: "documented",
        extractor: { kind: "dashscope-releases", minModels: 150, maxModels: 500 },
        extractorVersion: "dashscope-releases-v2",
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
        extractor: { kind: "dashscope-api", minModels: 1, maxModels: 500 },
        extractorVersion: "dashscope-api-v2",
        fields: ["availability"],
        allowedHosts: ["dashscope-intl.aliyuncs.com"],
        maxResponseBytes: mebibytes(2),
        scope: "region",
        exhaustive: false,
        role: "inventory",
        transport: {
          kind: "dashscope-deployable-models",
          pageSize: 100,
          maxPages: 5,
          maxModels: 500,
        },
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
        extractor: { kind: "cerebras-catalog", minModels: 1, maxModels: 100 },
        extractorVersion: "cerebras-catalog-v9",
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
          minDocuments: 1,
          maxDocuments: 100,
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
                ["batch-file", "/api-reference/file/upload-file.md"],
                ["account-billing", "/console/account-billing.md"],
                ["console-overview", "/console/overview.md"],
                ["usage-monitoring", "/console/usage-monitoring.md"],
                ["projects", "/console/projects.md"],
                ["rate-limits", "/support/rate-limits.md"],
                ["metrics", "/capabilities/metrics.md"],
                ["metrics-api", "/api-reference/metrics/retrieve-metrics.md"],
                ["dedicated", "/dedicated/overview.md"],
                ["aws-marketplace", "/integrations/aws-marketplace.md"],
                ["api-versions", "/api-reference/versions.md"],
              ] as const
            ).map(([id, path]) => ({
              id,
              url: `https://inference-docs.cerebras.ai${path}`,
              maxResponseBytes: mebibytes(1),
              optional: true,
            })),
            {
              id: "openapi",
              url: "https://inference-docs.cerebras.ai/api-reference/openapi.yaml",
              maxResponseBytes: mebibytes(1),
              optional: true,
            },
            {
              id: "pricing",
              url: "https://inference-docs.cerebras.ai/support/pricing.md",
              format: "html",
              maxResponseBytes: mebibytes(4),
              optional: true,
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
        extractor: { kind: "cerebras-public", minModels: 1, maxModels: 100 },
        extractorVersion: "cerebras-public-v3",
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
        allowedHosts: ["api.cerebras.ai", "inference-docs.cerebras.ai"],
        maxResponseBytes: mebibytes(1),
        scope: "global",
        exhaustive: true,
        role: "catalog",
        linkedDocuments: {
          indexFormat: "markdown",
          path: /^$/,
          minDocuments: 0,
          maxDocuments: 0,
          concurrency: 3,
          documents: optionalFixedDocuments([
            ["openrouter", "https://api.cerebras.ai/public/v1/models?format=openrouter", 1, "json"],
            [
              "huggingface",
              "https://api.cerebras.ai/public/v1/models?format=huggingface",
              1,
              "json",
            ],
            [
              "public-models-contract",
              "https://inference-docs.cerebras.ai/api-reference/models/public-models.md",
              1,
              "markdown",
            ],
          ]),
        },
      },
      {
        id: "cerebras-lifecycle",
        url: "https://inference-docs.cerebras.ai/support/deprecation",
        type: "website",
        access: "public",
        format: "markdown",
        stability: "semi_structured",
        extractor: { kind: "cerebras-lifecycle", minModels: 0, maxModels: 100 },
        extractorVersion: "cerebras-lifecycle-v3",
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
          documents: optionalFixedDocuments([
            ["model-catalog", "https://inference-docs.cerebras.ai/models/overview.md", 1],
            ["change-log", "https://inference-docs.cerebras.ai/support/change-log.md", 1],
          ]),
        },
      },
      {
        id: "cerebras-releases",
        url: "https://inference-docs.cerebras.ai/support/change-log",
        type: "website",
        access: "public",
        format: "markdown",
        stability: "semi_structured",
        extractor: { kind: "cerebras-releases", minModels: 0, maxModels: 100 },
        extractorVersion: "cerebras-releases-v2",
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
        extractor: { kind: "cerebras-api", minModels: 0, maxModels: 100 },
        extractorVersion: "cerebras-api-v3",
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
        extractorVersion: "ollama-library-v4",
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
        extractorVersion: "ollama-cloud-v6",
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
              ["api-introduction", "https://docs.ollama.com/api/introduction.md", "markdown"],
              ["list-models", "https://docs.ollama.com/api/tags.md", "markdown"],
              [
                "show-model-details",
                "https://docs.ollama.com/api-reference/show-model-details.md",
                "markdown",
              ],
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
            optional: true,
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
        extractor: { kind: "deepseek-catalog", minModels: 1, maxModels: 100 },
        extractorVersion: "deepseek-catalog-v10",
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
          documents: optionalFixedDocuments([
            ["chat-completions", "https://api-docs.deepseek.com/api/create-chat-completion", 1],
            ["responses", "https://api-docs.deepseek.com/api/create-response"],
            ["fim-completion", "https://api-docs.deepseek.com/api/create-completion", 1],
            ["model-inventory", "https://api-docs.deepseek.com/api/list-models", 1],
            ["token-usage", "https://api-docs.deepseek.com/quick_start/token_usage/", 1],
            ["context-cache", "https://api-docs.deepseek.com/guides/kv_cache/"],
            ["balance", "https://api-docs.deepseek.com/api/get-user-balance"],
            ["rate-limit", "https://api-docs.deepseek.com/quick_start/rate_limit/", 1],
            ["error-codes", "https://api-docs.deepseek.com/quick_start/error_codes/", 1],
            ["responses-guide", "https://api-docs.deepseek.com/guides/responses_api/", 1],
            ["anthropic-guide", "https://api-docs.deepseek.com/guides/anthropic_api/", 1],
            ["cny-pricing", "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/", 1],
            [
              "claude-code",
              "https://api-docs.deepseek.com/quick_start/agent_integrations/claude_code/",
              1,
            ],
            ["faq", "https://api-docs.deepseek.com/faq"],
          ]),
        },
      },
      {
        id: "deepseek-updates",
        url: "https://api-docs.deepseek.com/updates",
        type: "website",
        access: "public",
        format: "html",
        stability: "semi_structured",
        extractor: { kind: "deepseek-updates", minModels: 1, maxModels: 100 },
        extractorVersion: "deepseek-updates-v3",
        fields: ["release_date", "updated_date", "release_stage"],
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
        extractor: { kind: "deepseek-api", minModels: 1, maxModels: 100 },
        extractorVersion: "deepseek-api-v3",
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
        extractorVersion: "kimi-openapi-v4",
        fields: ["model_id", "tasks", "modalities", "api_endpoints", "capabilities", "limits"],
        allowedHosts: ["platform.kimi.ai"],
        maxResponseBytes: mebibytes(2),
        scope: "global",
        exhaustive: false,
        role: "catalog",
      },
      {
        id: "kimi-china-openapi",
        url: "https://platform.kimi.com/docs/openapi.json",
        type: "website",
        access: "public",
        format: "json",
        stability: "documented",
        extractor: {
          kind: "kimi-openapi",
          baseUrl: "https://api.moonshot.cn",
          minModels: 8,
          maxModels: 30,
        },
        extractorVersion: "kimi-openapi-v4",
        fields: ["model_id", "tasks", "modalities", "api_endpoints", "capabilities", "limits"],
        allowedHosts: ["platform.kimi.com"],
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
        extractorVersion: "kimi-catalog-v3",
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
      {
        id: "kimi-international-catalog",
        url: "https://platform.kimi.ai/docs/models",
        type: "website",
        access: "public",
        format: "markdown",
        stability: "semi_structured",
        extractor: { kind: "kimi-catalog", minModels: 15, maxModels: 30 },
        extractorVersion: "kimi-catalog-v3",
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
        allowedHosts: ["platform.kimi.ai"],
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
          documents: fixedDocuments([
            ["research", "https://www.kimi.com/blog/", 2],
            ["code", "https://www.kimi.com/code/docs/en/kimi-code/whats-new.html", 2],
            ["catalog", "https://platform.kimi.com/docs/models", 1, "markdown"],
          ]),
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
        extractorVersion: "kimi-api-v2",
        fields: ["model_id", "modalities", "capabilities", "limits"],
        allowedHosts: ["api.moonshot.ai"],
        maxResponseBytes: mebibytes(1),
        scope: "account",
        exhaustive: false,
        role: "inventory",
        optional: true,
        auth: { scheme: "bearer", env: "MOONSHOT_API_KEY" },
      },
      {
        id: "kimi-china-api",
        url: "https://api.moonshot.cn/v1/models",
        type: "api",
        access: "authenticated",
        format: "json",
        stability: "documented",
        extractor: { kind: "kimi-api", minModels: 1, maxModels: 50 },
        extractorVersion: "kimi-api-v2",
        fields: ["model_id", "modalities", "capabilities", "limits"],
        allowedHosts: ["api.moonshot.cn"],
        maxResponseBytes: mebibytes(1),
        scope: "account",
        exhaustive: false,
        role: "inventory",
        optional: true,
        auth: { scheme: "bearer", env: "MOONSHOT_CN_API_KEY" },
      },
    ],
    warnOnMissing: {
      sourceId: "kimi-catalog",
      fields: ["limits.context_tokens", "pricing", "release_date", "updated_date"],
      statuses: ["active", "legacy", "deprecated", "unknown"],
    },
  },
] satisfies ProviderManifest[];
