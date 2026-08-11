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
  normalizeOllamaModelPage,
  normalizeOllamaResponse,
  normalizeVercelEndpointResponse,
  normalizeVercelModelPage,
} from "../src/catalog/fetch.ts";
import {
  applyGroups,
  applySupplementGroups,
  retainInventoryFacts,
} from "../src/catalog/collector.ts";
import { manifests, type ProviderManifest, type SourceManifest } from "../src/catalog/manifests.ts";
import { baseModel } from "../src/catalog/model.ts";
import { normalizeDeliveryModes } from "../src/catalog/delivery.ts";
import {
  sourcePricingReconciliation,
  type PricingReconciliationItem,
} from "../src/catalog/pricing-reconciliation.ts";
import type { ParsedProviderModel as ProviderModel } from "../src/catalog/pricing-source.ts";
import { sourceKindSchema, type ModelTask, type Provider } from "../src/catalog/schema.ts";
import type { SourceContractEvidence } from "../src/catalog/source-contract.ts";
import { normalizeModelTasks } from "../src/catalog/task.ts";
import { reconcileCatalog, validateProvider } from "../src/catalog/validation.ts";
import { vercelCommercialFacts } from "../src/catalog/vercel-commercial-source.ts";

const observedAt = "2026-07-21T00:00:00.000Z";

const azureApiFixtureSchema = z
  .object({
    regions: z.array(z.object({ location: z.string(), models: z.array(z.unknown()) })),
  })
  .passthrough();
const linkedBundleFixtureSchema = z.object({
  index: z.object({ url: z.string(), body: z.string() }),
  documents: z.array(z.object({ url: z.string(), body: z.string() })),
});

async function fixture(path: string): Promise<string> {
  return readFile(new URL(`./fixtures/${path}`, import.meta.url), "utf8");
}

async function expected(path: string): Promise<unknown> {
  return JSON.parse(await fixture(path));
}

function linkedBundle(body: string): z.infer<typeof linkedBundleFixtureSchema> {
  return linkedBundleFixtureSchema.parse(JSON.parse(body));
}

function dispositionCounts(
  items: readonly PricingReconciliationItem[],
  dispositions: readonly PricingReconciliationItem["disposition"][],
): Record<string, number> {
  return Object.fromEntries(
    dispositions.map((disposition) => [
      disposition,
      items.filter((item) => item.disposition === disposition).length,
    ]),
  );
}

const openAiReviewedDocuments = [
  "/api/docs/models/compare.md",
  "/api/docs/pricing.md",
  "/api/docs/deprecations.md",
  "/api/docs/guides/your-data.md",
  "/api/docs/guides/batch.md",
  "/api/docs/guides/cost-optimization.md",
  "/api/docs/guides/fast-mode.md",
  "/api/docs/guides/flex-processing.md",
  "/api/docs/guides/prompt-caching.md",
  "/api/docs/guides/rate-limits.md",
  "/api/docs/guides/realtime-costs.md",
  "/api/docs/guides/spend-limits.md",
  "/api/docs/guides/terraform/rate-limits-and-spend.md",
] as const;

function openAiCatalogFixture(body: string): string {
  const bundle = linkedBundle(body);
  const documentationIndex = openAiReviewedDocuments
    .filter(
      (path) => path !== "/api/docs/deprecations.md" && path !== "/api/docs/guides/your-data.md",
    )
    .map((path) => `- [Reviewed](https://developers.openai.com${path})`)
    .join("\n");
  const usagePaths = [
    "audio_speeches",
    "audio_transcriptions",
    "code_interpreter_sessions",
    "completions",
    "embeddings",
    "file_search_calls",
    "images",
    "moderations",
    "vector_stores",
    "web_search_calls",
  ];
  const openapi = [
    "  /models:",
    "    operationId: listModels",
    "  /chat/completions:",
    "    operationId: createChatCompletion",
    "  /responses:",
    "    operationId: createResponse",
    "  /organization/costs:",
    "    operationId: usage-costs",
    ...usagePaths.flatMap((path) => [
      `  /organization/usage/${path}:`,
      ...(path === "completions" ? ["    operationId: usage-completions"] : ["    get: {}"]),
    ]),
    "input_cache_write_tokens",
    "input_uncached_tokens",
    "input_cached_audio_tokens",
    "service_tier",
    "input_tokens_details",
    "output_tokens_details",
  ].join("\n");
  return JSON.stringify({
    ...bundle,
    documents: [
      ...bundle.documents,
      {
        url: "https://developers.openai.com/api/docs/llms.txt",
        body: documentationIndex,
      },
      {
        url: "https://developers.openai.com/api/reference/llms.txt",
        body: [
          "https://developers.openai.com/api/reference/resources/models/methods/list.md",
          "https://developers.openai.com/api/reference/resources/responses/methods/create.md",
        ].join("\n"),
      },
      ...openAiReviewedDocuments.map((path) => ({
        url: `https://developers.openai.com${path}`,
        body: "# Reviewed official page",
      })),
      {
        url: "https://raw.githubusercontent.com/openai/openai-openapi/master/openapi.yaml",
        body: openapi,
      },
    ],
  });
}

async function azureApiFixture(): Promise<z.infer<typeof azureApiFixtureSchema>> {
  return azureApiFixtureSchema.parse(JSON.parse(await fixture("azure/api.json")));
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

function azurePublicPricingSource(minModels: number, maxModels: number): SourceManifest {
  const configured = manifest("azure").sources.find(({ id }) => id === "azure-public-pricing");
  if (configured === undefined || configured.extractor.kind !== "azure-public-pricing")
    throw new Error("Missing Azure public-pricing source");
  return {
    ...configured,
    extractor: { kind: "azure-public-pricing", minModels, maxModels },
  };
}

function azurePortalSource(minModels: number, maxModels: number): SourceManifest {
  const configured = manifest("azure").sources.find(({ id }) => id === "azure-portal-models");
  if (configured === undefined || configured.extractor.kind !== "azure-portal-catalog")
    throw new Error("Missing Azure portal source");
  return {
    ...configured,
    extractor: { kind: "azure-portal-catalog", minModels, maxModels },
  };
}

function azureApiModels(
  body: string,
  reconciliation?: PricingReconciliationItem[],
): ProviderModel[] {
  const value = manifest("azure");
  const source = value.sources.find(({ id }) => id === "azure-api");
  if (source === undefined) throw new Error("Missing Azure API source");
  return parseSource({
    provider: provider(value),
    source,
    body,
    observedAt,
    ...(reconciliation === undefined
      ? {}
      : { onPricingReconciliation: (item) => reconciliation.push(item) }),
  });
}

async function parsed(
  providerId: string,
  path: string,
  sourceId?: string,
  transform?: (body: string) => string,
): Promise<ProviderModel[]> {
  const value = manifest(providerId);
  const source =
    sourceId === undefined
      ? value.sources[0]
      : value.sources.find((candidate) => candidate.id === sourceId);
  if (source === undefined) throw new Error(`Missing source for ${providerId}`);
  const fixtureBody = await fixture(path);
  const body = transform?.(fixtureBody) ?? fixtureBody;
  return parseSource({
    provider: provider(value),
    source,
    body: source.id === "openai-models" ? openAiCatalogFixture(body) : body,
    observedAt,
  });
}

function openAiModel(id: string, tasks: ModelTask[], name = id): ProviderModel {
  return {
    ...baseModel({
      providerId: "openai",
      id,
      name,
      sourceId: "openai-models",
      observedAt,
    }),
    tasks,
  };
}

async function openAiModelPricing(
  path: string,
  catalogModels: ProviderModel[],
): Promise<ProviderModel[]> {
  const value = manifest("openai");
  const source = value.sources.find(({ id }) => id === "openai-overview");
  if (source === undefined) throw new Error("Missing OpenAI model-card pricing source");
  return parseSource({
    provider: provider(value),
    source,
    body: await fixture(path),
    observedAt,
    catalogModels,
  });
}

const deepseekCommercialDocuments = [
  [
    "quick_start/token_usage/",
    "token-usage.html",
    "units we use for billing",
    "token_usage_contract_drift",
  ],
  ["guides/kv_cache/", "cache.html", "best-effort", "context_cache_contract_drift"],
  ["api/get-user-balance", "balance.html", "total_balance", "balance_api_contract_drift"],
  [
    "quick_start/rate_limit/",
    "rate-limit.html",
    "no additional cost",
    "account_quota_contract_drift",
  ],
  [
    "quick_start/error_codes/",
    "error-codes.html",
    "402 - Insufficient Balance",
    "insufficient_balance_contract_drift",
  ],
  [
    "guides/responses_api/",
    "responses-guide.html",
    "server-side web search tool call",
    "responses_accounting_contract_drift",
  ],
  [
    "guides/anthropic_api/",
    "anthropic-guide.html",
    "deepseek-v4-pro",
    "anthropic_routing_contract_drift",
  ],
  [
    "quick_start/agent_integrations/claude_code/",
    "claude-code.html",
    "additional model token costs will be incurred",
    "web_search_token_cost_contract_drift",
  ],
  ["faq", "faq.html", "Unused balances are refundable", "balance_terms_contract_drift"],
] as const;

async function deepseekCatalog(
  options: {
    chat?: string;
    catalog?: string;
    inventory?: string;
    responses?: string;
    onPricingReconciliation?: (item: PricingReconciliationItem) => void;
    omit?: readonly string[];
    overrides?: Readonly<Record<string, string>>;
    withoutDocuments?: boolean;
  } = {},
): Promise<ProviderModel[]> {
  const {
    chat,
    catalog,
    inventory,
    responses,
    onPricingReconciliation,
    omit = [],
    overrides = {},
    withoutDocuments = false,
  } = options;
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
      {
        url: "https://api-docs.deepseek.com/api/create-completion",
        body: overrides["api/create-completion"] ?? (await fixture("deepseek/fim.html")),
      },
      {
        url: "https://api-docs.deepseek.com/api/list-models",
        body: inventory ?? (await fixture("deepseek/list-models.html")),
      },
      {
        url: "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/",
        body:
          overrides["zh-cn/quick_start/pricing/"] ?? (await fixture("deepseek/catalog-cny.html")),
      },
      ...(await Promise.all(
        deepseekCommercialDocuments.map(async ([path, fixtureName]) => ({
          url: `https://api-docs.deepseek.com/${path}`,
          body: overrides[path] ?? (await fixture(`deepseek/${fixtureName}`)),
        })),
      )),
    ].filter(
      ({ url }) => !withoutDocuments && !omit.includes(new URL(url).pathname.replace(/^\//, "")),
    ),
  });
  return parseSource({
    provider: provider(value),
    source,
    body,
    observedAt,
    ...(onPricingReconciliation === undefined ? {} : { onPricingReconciliation }),
  });
}

const anthropicDocuments = [
  ["/llms.txt", "llms.txt"],
  ["/pricing", "current-pricing.html"],
  ["/docs/en/about-claude/pricing.md", "pricing.md"],
  ["/docs/en/about-claude/model-deprecations.md", "lifecycle.md"],
  ["/docs/en/about-claude/models/model-ids-and-versions.md", "model-ids.md"],
  ["/docs/en/about-claude/models/introducing-claude-fable-5-and-claude-mythos-5.md", "launch.md"],
  ["/docs/en/api/models/list.md", "models-list.md"],
  ["/docs/en/api/messages/create.md", "messages.md"],
  ["/docs/en/api/messages/batches/create.md", "batches.md"],
  ["/docs/en/build-with-claude/batch-processing.md", "batch-processing.md"],
  ["/docs/en/build-with-claude/citations.md", "citations.md"],
  ["/docs/en/build-with-claude/pdf-support.md", "pdf-support.md"],
  ["/docs/en/build-with-claude/context-editing.md", "context-editing.md"],
  ["/docs/en/build-with-claude/structured-outputs.md", "structured-outputs.md"],
  ["/docs/en/agents-and-tools/tool-use/code-execution-tool.md", "code-execution-tool.md"],
  ["/docs/en/agents-and-tools/tool-use/web-search-tool.md", "web-search-tool.md"],
  ["/docs/en/agents-and-tools/tool-use/web-fetch-tool.md", "web-fetch-tool.md"],
  ["/docs/en/agents-and-tools/tool-use/advisor-tool.md", "advisor-tool.md"],
  ["/docs/en/agents-and-tools/tool-use/computer-use-tool.md", "computer-use-tool.md"],
  ["/docs/en/build-with-claude/effort.md", "effort.md"],
  ["/docs/en/build-with-claude/prompt-caching.md", "prompt-caching.md"],
  ["/docs/en/about-claude/glossary.md", "glossary.md"],
  ["/docs/en/build-with-claude/thinking.md", "thinking.md"],
  ["/docs/en/build-with-claude/compaction.md", "compaction.md"],
  ["/docs/en/build-with-claude/token-counting.md", "token-counting.md"],
  ["/docs/en/build-with-claude/files.md", "files.md"],
  ["/docs/en/agents-and-tools/tool-use/define-tools.md", "define-tools.md"],
  ["/docs/en/build-with-claude/fast-mode.md", "fast-mode.md"],
  ["/docs/en/api/service-tiers.md", "service-tiers.md"],
  ["/docs/en/manage-claude/data-residency.md", "data-residency.md"],
  ["/docs/en/manage-claude/usage-cost-api.md", "usage-cost-api.md"],
  ["/docs/en/api/admin/usage_report/retrieve_messages.md", "usage-report.md"],
  ["/docs/en/api/admin/cost_report/retrieve.md", "cost-report.md"],
  ["/docs/en/build-with-claude/fallback-credit.md", "fallback-credit.md"],
  ["/docs/en/managed-agents/overview.md", "managed-agents-overview.md"],
  ["/docs/en/api/beta/agents/create.md", "managed-agents-create.md"],
  ["/docs/en/managed-agents/events-and-streaming.md", "managed-agents-events-and-streaming.md"],
  ["/docs/en/release-notes/overview.md", "release-notes.md"],
] as const;

async function anthropicCatalog(
  options: {
    overview?: string;
    overrides?: Readonly<Record<string, string>>;
    extraDocuments?: readonly { url: string; body: string }[];
    onPricingReconciliation?: (item: PricingReconciliationItem) => void;
  } = {},
): Promise<ProviderModel[]> {
  const value = manifest("anthropic");
  const source = value.sources[0];
  if (source === undefined) throw new Error("Missing Anthropic source");
  const { overview, overrides = {}, extraDocuments = [], onPricingReconciliation } = options;
  const body = JSON.stringify({
    index: {
      url: source.url,
      body: overview ?? (await fixture("anthropic/overview.md")),
    },
    documents: [
      ...(await Promise.all(
        anthropicDocuments.map(async ([path, fixtureName]) => ({
          url: `${path === "/pricing" ? "https://claude.com" : "https://platform.claude.com"}${path}`,
          body: overrides[path] ?? (await fixture(`anthropic/${fixtureName}`)),
        })),
      )),
      ...extraDocuments,
    ],
  });
  return parseSource({
    provider: provider(value),
    source,
    body,
    observedAt,
    ...(onPricingReconciliation === undefined ? {} : { onPricingReconciliation }),
  });
}

async function databricksCatalog(
  overrides: Readonly<Record<string, string>> = {},
  onPricingReconciliation?: (item: PricingReconciliationItem) => void,
  extraDocuments: readonly { url: string; body: string }[] = [],
): Promise<ProviderModel[]> {
  const value = manifest("databricks");
  const configured = value.sources[0];
  if (configured === undefined || configured.extractor.kind !== "databricks-catalog")
    throw new Error("Missing Databricks source");
  const source: SourceManifest = {
    ...configured,
    extractor: { kind: "databricks-catalog", minModels: 5, maxModels: 12 },
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
      "https://docs.databricks.com/aws/en/machine-learning/foundation-model-apis/priority-mode",
      "priority-mode.html",
    ],
    ["https://ai.google.dev/gemini-api/docs/pricing?hl=en", "google-image-pricing.html"],
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
    ["https://docs.databricks.com/aws/en/admin/system-tables", "system-tables.html"],
    ["https://docs.databricks.com/aws/en/admin/system-tables/billing", "billing-usage.html"],
    ["https://docs.databricks.com/aws/en/admin/system-tables/pricing", "list-pricing.html"],
    [
      "https://docs.databricks.com/aws/en/admin/system-tables/model-serving-cost",
      "model-serving-cost.html",
    ],
    [
      "https://docs.databricks.com/aws/en/ai-gateway/configure-ai-gateway-endpoints",
      "legacy-endpoint-usage.html",
    ],
    ["https://docs.databricks.com/aws/en/ai-gateway/usage-tracking", "ai-gateway-usage.html"],
    ["https://docs.databricks.com/aws/en/ai-gateway/cost-observability", "ai-gateway-cost.html"],
    ["https://www.databricks.com/en-pricing-assets/data/pricing/cards.json", "pricing-cards.json"],
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
          `https://www.databricks.com/en-pricing-assets/page-data/product/pricing/${page}/page-data.json`,
          `pricing-${page}.json`,
        ] as const,
    ),
    ["https://docs.databricks.com/aws/en/feed.xml", "release-feed.xml"],
  ] as const;
  const body = JSON.stringify({
    index: {
      url: source.url,
      body: overrides["models.html"] ?? (await fixture("databricks/models.html")),
    },
    documents: [
      ...(await Promise.all(
        documents.map(async ([url, path]) => ({
          url,
          body: overrides[path] ?? (await fixture(`databricks/${path}`)),
        })),
      )),
      ...extraDocuments,
    ],
  });
  return parseSource({
    provider: provider(value),
    source,
    body,
    observedAt,
    ...(onPricingReconciliation === undefined ? {} : { onPricingReconciliation }),
  });
}

async function vercelCatalog(
  path: string,
  edit: (body: string) => string = (body) => body,
  onContractFinding?: (finding: SourceContractEvidence) => void,
): Promise<ProviderModel[]> {
  const value = manifest("vercel");
  const configured = value.sources[0];
  if (configured === undefined || configured.extractor.kind !== "vercel-catalog")
    throw new Error("Missing Vercel source");
  const { linkedDocuments: _linkedDocuments, transport: _transport, ...plain } = configured;
  void _linkedDocuments;
  void _transport;
  const source: SourceManifest = {
    ...plain,
    extractor: { kind: "vercel-catalog", minModels: 1, maxModels: 20 },
  };
  return parseSource({
    provider: provider(value),
    source,
    body: edit(await fixture(path)),
    observedAt,
    ...(onContractFinding === undefined ? {} : { onContractFinding }),
  });
}

function vercelDocumentation(): { url: string; body: string }[] {
  return [
    {
      url: "https://vercel.com/docs/ai-gateway/models-and-providers.md",
      body: [
        "https://ai-gateway.vercel.sh/v1/models",
        "This endpoint requires no authentication",
        "GET /v1/models/{creator}/{model}/endpoints",
        "returns per-provider pricing, supported parameters, uptime, throughput, and latency",
      ].join("\n"),
    },
    {
      url: "https://vercel.com/docs/ai-gateway/pricing.md",
      body: [
        "AI Gateway charges no markup and no platform fee on tokens.",
        "AI Gateway bases its rates on the provider's list price.",
        "fallback usage is charged against your credits balance",
        "With BYOK, there is no markup or fee from AI Gateway",
        "BYOK is available on the paid tier",
        "The free tier includes a subset of models",
        "free credits start when you make your first AI Gateway request",
        "$0.075 / 1,000 tag/user ID/quota entity ID writes",
        "$5 / 1,000 queries to the reporting endpoint",
        "Each unique tag, user ID, or quota entity ID within a single request scope",
        "$0.10 per 1,000 successful requests",
        "$0.10 per 1,000 requests",
      ].join("\n"),
    },
    {
      url: "https://vercel.com/ai-gateway/models",
      body: String.raw`copyString\":\"acme/text-1\",\"availableToFreeTier\":true`,
    },
    {
      url: "https://vercel.com/crawled-sitemap.xml",
      body: [
        "<urlset>",
        "<url><loc>https://vercel.com/docs/ai-gateway/pricing</loc></url>",
        "<url><loc>https://vercel.com/docs/ai-gateway/models-and-providers/web-search</loc></url>",
        "</urlset>",
      ].join(""),
    },
    {
      url: "https://vercel.com/kb/guide/how-i-use-opencode-with-vercel-ai-gateway-to-build-features-fast.md",
      body: "$5 in free credits that reset every 30 days, with no restrictions on which models you can use",
    },
    {
      url: "https://vercel.com/docs/ai-gateway/models-and-providers/provider-options.md",
      body: "`order`, `only`, and `sort`\nsort: 'cost'\ncaching: 'auto'",
    },
    {
      url: "https://vercel.com/docs/ai-gateway/models-and-providers/provider-filtering-and-ordering.md",
      body: [
        "The `gateway.cost` value is the inference cost for this request",
        "does not include other charges that may apply",
        "`'cost'`",
        "`'ttft'`",
        "`'tps'`",
        "providers are always sorted last, regardless",
      ].join("\n"),
    },
    {
      url: "https://vercel.com/docs/ai-gateway/models-and-providers/fast-mode.md",
      body: [
        "higher per-token cost",
        "falls back to the base model",
        "not merely routed to a fast variant slug",
        "weren't billed at the fast rate",
      ].join("\n"),
    },
    {
      url: "https://vercel.com/docs/ai-gateway/models-and-providers/service-tiers.md",
      body: [
        "best-effort routing hint, not a hard guarantee",
        "billed at the default rate",
        "bills the request at the tier the provider actually served",
      ].join("\n"),
    },
    {
      url: "https://vercel.com/docs/ai-gateway/security-and-compliance/regional-inference.md",
      body: [
        "Pinning a region can raise what a request costs.",
        "passes the provider's regional price straight through",
        "adds no AI Gateway markup",
      ].join("\n"),
    },
    {
      url: "https://vercel.com/docs/ai-gateway/authentication-and-byok/byok.md",
      body: [
        "no added markup",
        "fallback usage is billed against your credits balance",
        "Spend through your own credentials isn't counted in",
        "system credentials",
        "your actual costs may vary",
      ].join("\n"),
    },
    {
      url: "https://vercel.com/docs/ai-gateway/sdks-and-apis/rest-api.md",
      body: [
        "GET /v1/models/{creator}/{model}/endpoints",
        "GET /v1/generation?id={generation_id}",
        "Usage events are ingested asynchronously",
        "Allow a few seconds",
        "`total_cost`",
        "`upstream_inference_cost`",
        "`native_tokens_cached`",
        "`native_tokens_cache_creation`",
      ].join("\n"),
    },
    {
      url: "https://vercel.com/docs/ai-gateway/observability-and-spend/custom-reporting.md",
      body: "It can take a few minutes\n`market_cost`\n`surcharge_cost`\n`gateway_cost`",
    },
    {
      url: "https://vercel.com/docs/ai-gateway/models-and-providers/web-search.md",
      body: [
        "can be used with any model regardless of the model provider or creator",
        "Perplexity web search requests are charged at $5 per 1,000 requests",
        "Exa web search requests are charged at $7 per 1,000 requests",
        "Additional requested results beyond 10 are charged",
        "Parallel web search requests are charged at $5 per 1,000 requests",
        "Additional results beyond 10 are charged",
      ].join("\n"),
    },
    {
      url: "https://vercel.com/docs/ai-gateway/security-and-compliance/model-allowlist.md",
      body: [
        "$0.10 per 1,000 successful requests",
        "a single restriction surcharge, not one per allowlist",
        "never billed twice",
      ].join("\n"),
    },
    {
      url: "https://vercel.com/docs/ai-gateway/security-and-compliance/provider-allowlist.md",
      body: [
        "$0.10 per 1,000 successful requests",
        "Requests blocked by the allowlist (`403`) and other failures are not charged",
      ].join("\n"),
    },
    {
      url: "https://vercel.com/docs/ai-gateway/security-and-compliance/zdr.md",
      body: [
        "Team-wide zero data retention",
        "$0.10 per 1,000 requests",
        "only charged on successful responses that return usage data",
        "Requests that fail or return errors are not charged",
      ].join("\n"),
    },
    {
      url: "https://vercel.com/docs/ai-gateway/observability-and-spend/trace-drains.md",
      body: [
        "bills on two meters",
        "single trace event for each drain that delivers it",
        "Failed deliveries don't incur a trace-event charge",
        "Charges begin with the first delivered trace and first byte of trace egress",
      ].join("\n"),
    },
    {
      url: "https://vercel.com/docs/drains.md",
      body: "| Drains Volume | $0.50 |\nuncompressed JSON serialization of each drained record",
    },
    {
      url: "https://vercel.com/docs/ai-gateway/observability-and-spend/logs.md",
      body: "refreshing every 5 seconds\nabout 90 seconds\nFallback Path\nCache Write",
    },
    {
      url: "https://vercel.com/docs/ai-gateway/observability-and-spend/usage.md",
      body: [
        "`GET /v1/credits`",
        "remaining credit balance and lifetime spend",
        "`GET /v1/generation`",
        "cost, latency, finish reason, and token usage",
      ].join("\n"),
    },
  ] as const;
}

async function xaiCatalog(
  index = "xai/models.txt",
  edit: (body: string) => string = (body) => body,
  editLlms: (body: string) => string = (body) => body,
  onPricingReconciliation?: (item: PricingReconciliationItem) => void,
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
  return parseSource({
    provider: provider(value),
    source,
    body,
    observedAt,
    ...(onPricingReconciliation === undefined ? {} : { onPricingReconciliation }),
  });
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
  const { transport: _transport, ...source } = configured;
  void _transport;
  return {
    ...source,
    extractor: {
      kind: "huggingface-mapping",
      providers: ["hf-inference"],
      minModels: 1,
      maxModels: 10,
      minRoutes: 1,
      maxRoutes: 20,
    },
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

function huggingFaceFeatherlessSource(value: ProviderManifest): SourceManifest {
  const configured = value.sources.find((source) => source.id === "huggingface-featherless");
  if (configured === undefined || configured.extractor.kind !== "huggingface-featherless")
    throw new Error("Missing Hugging Face Featherless source");
  const { transport: _transport, ...source } = configured;
  void _transport;
  return {
    ...source,
    extractor: { kind: "huggingface-featherless", minModels: 1, maxModels: 10 },
  };
}

async function huggingFaceMapping(
  path: string,
  onPricingReconciliation?: (item: PricingReconciliationItem) => void,
): Promise<ProviderModel[]> {
  const value = manifest("huggingface");
  const source = huggingFaceMappingSource(value);
  return parseSource({
    provider: provider(value),
    source,
    body: huggingFaceMappingBody(await fixture(path)),
    observedAt,
    ...(onPricingReconciliation === undefined ? {} : { onPricingReconciliation }),
  });
}

function huggingFaceTaskDocuments(modelIds: readonly string[]): { url: string; body: string }[] {
  const featured = modelIds[0];
  return [
    {
      url: "https://huggingface.co/docs/inference-providers/en/tasks/chat-completion.md",
      body: [
        "### Recommended models",
        "",
        ...modelIds.map((id) => `- [${id}](https://huggingface.co/${id}): Fixture model.`),
        "",
        "### Using the API",
        "",
        ...(featured === undefined
          ? []
          : [
              `<InferenceSnippet providersMapping={ {"hf-inference":{"modelId":"${featured}","providerModelId":"${featured}"}} } />`,
            ]),
      ].join("\n"),
    },
  ];
}

function huggingFaceMappingBundle(
  partners: readonly unknown[],
  modelIds: readonly string[],
): string {
  return JSON.stringify({
    partners,
    documents: huggingFaceTaskDocuments(modelIds),
  });
}

function huggingFaceMappingBody(body: string, providerId = "hf-inference"): string {
  const models = z.record(z.string(), z.record(z.string(), z.unknown())).parse(JSON.parse(body));
  const modelIds = [
    ...new Set(
      Object.values(models).flatMap((entries) =>
        Object.keys(entries).filter(
          (id) => !id.startsWith("tag-filter=") && id.split("/").length === 2,
        ),
      ),
    ),
  ];
  return huggingFaceMappingBundle(
    [{ provider: providerId, models }],
    modelIds.length === 0 ? ["org/documented-sentinel"] : modelIds,
  );
}

const huggingFaceRouterDocuments = [
  ["pricing.md", "https://huggingface.co/docs/inference-providers/en/pricing.md"],
  ["overview.md", "https://huggingface.co/docs/inference-providers/en/index.md"],
  ["hub-api.md", "https://huggingface.co/docs/inference-providers/en/hub-api.md"],
  [
    "chat-completion.md",
    "https://huggingface.co/docs/inference-providers/en/tasks/chat-completion.md",
  ],
  [
    "responses-api.md",
    "https://huggingface.co/docs/inference-providers/en/guides/responses-api.md",
  ],
  [
    "provider-registration.md",
    "https://huggingface.co/docs/inference-providers/en/register-as-a-provider.md",
  ],
  ["sdk-inference.md", "https://huggingface.co/docs/huggingface_hub/en/guides/inference.md"],
  [
    "sdk-providers.py",
    "https://raw.githubusercontent.com/huggingface/huggingface_hub/main/src/huggingface_hub/inference/_providers/__init__.py",
  ],
  ["hub-billing.md", "https://huggingface.co/docs/hub/en/billing.md"],
  ["endpoint-pricing.md", "https://huggingface.co/docs/inference-endpoints/en/support/pricing.md"],
  ["spaces-hardware.md", "https://huggingface.co/docs/hub/en/spaces-gpus.md"],
  ["spaces-zerogpu.md", "https://huggingface.co/docs/hub/en/spaces-zerogpu.md"],
  ["jobs-pricing.md", "https://huggingface.co/docs/hub/en/jobs-pricing.md"],
  ["jobs-hardware.json", "https://huggingface.co/api/jobs/hardware"],
  ["storage-limits.md", "https://huggingface.co/docs/hub/en/storage-limits.md"],
  ["pricing-page.html", "https://huggingface.co/pricing"],
  ["enterprise-page.html", "https://huggingface.co/enterprise"],
] as const;

async function huggingFaceRouterBody(
  index: string,
  editDocument: (path: string, body: string) => string = (_path, body) => body,
): Promise<string> {
  return JSON.stringify({
    index: { url: "https://router.huggingface.co/v1/models", body: index },
    documents: await Promise.all(
      huggingFaceRouterDocuments.map(async ([path, url]) => ({
        url,
        body: editDocument(path, await fixture(`huggingface/${path}`)),
      })),
    ),
  });
}

async function huggingFaceRouter(
  path: string,
  edit: (body: string) => string = (body) => body,
  editDocument: (path: string, body: string) => string = (_path, body) => body,
  onPricingReconciliation?: (item: PricingReconciliationItem) => void,
): Promise<ProviderModel[]> {
  const value = manifest("huggingface");
  const source = huggingFaceRouterSource(value);
  return parseSource({
    provider: provider(value),
    source,
    body: await huggingFaceRouterBody(edit(await fixture(path)), editDocument),
    observedAt,
    ...(onPricingReconciliation === undefined ? {} : { onPricingReconciliation }),
  });
}

async function huggingFaceFeatherless(
  edit: (body: string) => string = (body) => body,
  catalogModels?: ProviderModel[],
  onPricingReconciliation?: (item: PricingReconciliationItem) => void,
): Promise<ProviderModel[]> {
  const value = manifest("huggingface");
  const source = huggingFaceFeatherlessSource(value);
  return parseSource({
    provider: provider(value),
    source,
    body: JSON.stringify({
      index: {
        url: source.url,
        body: edit(await fixture("huggingface/featherless.json")),
      },
      documents: [
        {
          url: "https://featherless.ai/docs/api-reference-models",
          body: await fixture("huggingface/featherless-models.html"),
        },
        {
          url: "https://featherless.ai/docs/request-pricing-and-credits",
          body: await fixture("huggingface/featherless-pricing.html"),
        },
      ],
    }),
    observedAt,
    ...(catalogModels === undefined ? {} : { catalogModels }),
    ...(onPricingReconciliation === undefined ? {} : { onPricingReconciliation }),
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

async function azureCatalog(
  stableApiSpec?: string,
  lifecycleBody?: string,
  overrides: Readonly<Record<string, string>> = {},
): Promise<ProviderModel[]> {
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
    ["manage-costs.md", "manage-costs.md"],
    ["how-to-prompt-caching-content.md", "prompt-caching.md"],
    ["claude-models-billing.md", "claude-billing.md"],
    ["manage-automation.md", "manage-automation.md"],
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
            : name === "concepts-model-retirement-schedule-content.md" &&
                lifecycleBody !== undefined
              ? lifecycleBody
              : (overrides[path] ?? (await fixture(`azure/${path}`))),
      })),
    ),
  });
  return parseSource({ provider: provider(value), source, body, observedAt });
}

async function geminiCatalog(
  overrides: Readonly<Record<string, string>> = {},
  onPricingReconciliation?: (item: PricingReconciliationItem) => void,
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
    ["https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta", "discovery.json"],
    ["https://ai.google.dev/api/live", "live-api.html"],
    ["https://ai.google.dev/gemini-api/docs/billing", "billing.html"],
    ["https://ai.google.dev/gemini-api/docs/caching", "caching.html"],
    ["https://ai.google.dev/gemini-api/docs/generate-content/caching", "explicit-caching.html"],
    ["https://ai.google.dev/gemini-api/docs/tokens", "tokens.html"],
    ["https://ai.google.dev/gemini-api/docs/flex-inference", "flex-inference.html"],
    ["https://ai.google.dev/gemini-api/docs/priority-inference", "priority-inference.html"],
    ["https://ai.google.dev/gemini-api/docs/google-search", "google-search.html"],
    ["https://ai.google.dev/gemini-api/docs/maps-grounding", "google-maps.html"],
    ["https://ai.google.dev/gemini-api/docs/batch-api", "batch-api.html"],
    ["https://ai.google.dev/gemini-api/docs/file-search", "file-search.html"],
    ["https://ai.google.dev/gemini-api/docs/url-context", "url-context.html"],
    ["https://ai.google.dev/gemini-api/docs/code-execution", "code-execution.html"],
    ["https://ai.google.dev/gemini-api/docs/computer-use", "computer-use.html"],
    ["https://ai.google.dev/gemini-api/docs/model-tuning", "model-tuning.html"],
    ["https://ai.google.dev/gemini-api/docs/deep-research", "deep-research.html"],
    ["https://ai.google.dev/gemini-api/docs/agents", "agents.html"],
    ["https://ai.google.dev/gemini-api/docs/agent-environment", "agent-environment.html"],
    [
      "https://docs.cloud.google.com/billing/docs/how-to/get-pricing-information-api",
      "cloud-pricing-api.html",
    ],
    [
      "https://docs.cloud.google.com/billing/docs/how-to/export-data-bigquery-tables",
      "cloud-billing-export.html",
    ],
    [
      "https://cloud.google.com/skus/sku-groups/google-developer-program-premium-genai-credit",
      "cloud-sku-group.html",
    ],
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
  return parseSource({
    provider: provider(value),
    source,
    body,
    observedAt,
    ...(onPricingReconciliation === undefined ? {} : { onPricingReconciliation }),
  });
}

async function vertexModels(
  sourceIndex: number,
  documents: readonly (readonly [string, string])[],
  overrides: Readonly<Record<string, string>> = {},
  minModelDocuments = 0,
  index = "<main></main>",
  onPricingReconciliation?: (item: PricingReconciliationItem) => void,
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
    },
  };
  const policyDocuments = [
    ...(sourceIndex === 0
      ? ([
          ["https://aiplatform.googleapis.com/$discovery/rest?version=v1beta1", "discovery.json"],
          [
            "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/grounding/grounding-with-google-search",
            "grounding-search.html",
          ],
          [
            "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/grounding/grounding-with-google-maps",
            "grounding-maps.html",
          ],
          [
            "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/grounding/grounding-with-vertex-ai-search",
            "grounding-data.html",
          ],
          [
            "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/standard-paygo",
            "standard-paygo.html",
          ],
          [
            "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/flex-paygo",
            "flex-paygo.html",
          ],
          [
            "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/priority-paygo",
            "priority-paygo.html",
          ],
          [
            "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/batch-inference",
            "batch-inference.html",
          ],
          [
            "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/context-cache/context-cache-overview",
            "context-cache.html",
          ],
          [
            "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/provisioned-throughput/purchase-provisioned-throughput",
            "pt-purchase.html",
          ],
          [
            "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/provisioned-throughput/use-provisioned-throughput",
            "pt-routing.html",
          ],
          [
            "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/provisioned-throughput/measure-provisioned-throughput",
            "pt-accounting.html",
          ],
          [
            "https://docs.cloud.google.com/billing/docs/how-to/get-pricing-information-api",
            "cloud-pricing-api.html",
          ],
          [
            "https://docs.cloud.google.com/billing/docs/how-to/export-data-bigquery-tables/standard-usage",
            "cloud-billing-export.html",
          ],
          [
            "https://cloud.google.com/generative-ai-app-builder/pricing",
            "agent-search-pricing.html",
          ],
        ] as const)
      : []),
    ...(sourceIndex === 1
      ? ([
          [
            "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/claude/web-search",
            "claude-web-search.html",
          ],
        ] as const)
      : []),
    ...(sourceIndex === 2
      ? ([
          [
            "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/embeddings/get-text-embeddings",
            "text-embeddings.html",
          ],
        ] as const)
      : []),
  ];
  const allDocuments = [...documents, ...policyDocuments].filter(
    ([url], index, values) => values.findIndex(([candidate]) => candidate === url) === index,
  );
  const body = JSON.stringify({
    index: { url: source.url, body: index },
    documents: await Promise.all(
      allDocuments.map(async ([url, path]) => ({
        url,
        body: overrides[path] ?? (await fixture(`vertex/${path}`)),
      })),
    ),
  });
  return parseSource({
    provider: provider(value),
    source,
    body,
    observedAt,
    ...(onPricingReconciliation === undefined ? {} : { onPricingReconciliation }),
  });
}

async function vertexCatalog(
  overrides: Readonly<Record<string, string>> = {},
  onPricingReconciliation?: (item: PricingReconciliationItem) => void,
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
      ["https://cloud.google.com/skus/sku-groups/gen-ai", "skus.html"],
      ["https://cloud.google.com/skus/sku-groups/gen-ai-v2", "skus.html"],
    ],
    overrides,
    0,
    "<main></main>",
    onPricingReconciliation,
  );
}

async function cohereCatalog(
  overrides: {
    chat?: string;
    commandARelease?: string;
    commandAPlus?: string;
    index?: string;
    lifecycle?: string;
    modelIndex?: string;
    omitDocument?: string;
    openapi?: string;
    pricing?: string;
    pricingPolicy?: string;
    transcription?: string;
  } = {},
  onPricingReconciliation?: (item: PricingReconciliationItem) => void,
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
    ["https://docs.cohere.com/docs/how-does-cohere-pricing-work.md", "pricing-policy.md"],
    ["https://docs.cohere.com/docs/rate-limits.md", "rate-limits.md"],
    ["https://docs.cohere.com/reference/create-batch.md", "commercial-batch.md"],
    ["https://docs.cohere.com/v2/docs/tool-use-overview.md", "commercial-tool-use.md"],
    ["https://docs.cohere.com/v2/docs/migrating-v1-to-v2.md", "commercial-migration.md"],
    ["https://docs.cohere.com/docs/model-vault.md", "vault-overview.md"],
    [
      "https://docs.cohere.com/docs/model-vault/standard/supported-models.md",
      "vault-standard-models.md",
    ],
    ["https://docs.cohere.com/docs/model-vault/standard/pricing.md", "vault-standard-pricing.md"],
    [
      "https://docs.cohere.com/docs/model-vault/encrypted/supported-models.md",
      "vault-encrypted-models.md",
    ],
    ["https://docs.cohere.com/docs/model-vault/encrypted/pricing.md", "vault-encrypted-pricing.md"],
    ["https://docs.cohere.com/docs/model-vault/model-vault-with-north.md", "vault-north.md"],
    ["https://docs.cohere.com/docs/private-deployment-overview.md", "private-deployment.md"],
    ["https://docs.cohere.com/reference/errors.md", "errors.md"],
    ["https://docs.cohere.com/reference/teams-and-roles.md", "teams-and-roles.md"],
    ["https://docs.cohere.com/v2/changelog", "changelog.html"],
    ["https://docs.cohere.com/changelog/command-a", "command-a-release.html"],
    ["https://docs.cohere.com/changelog/command-r-7b/", "command-r7b-release.html"],
    ["https://docs.cohere.com/reference/chat.md", "chat.md"],
    ["https://docs.cohere.com/reference/chat-v1.md", "chat-v1.md"],
    ["https://docs.cohere.com/reference/chat-stream.md", "chat-stream.md"],
    ["https://docs.cohere.com/reference/embed.md", "embed.md"],
    ["https://docs.cohere.com/reference/create-embed-job.md", "create-embed-job.md"],
    ["https://docs.cohere.com/reference/get-embed-job.md", "get-embed-job.md"],
    ["https://docs.cohere.com/reference/rerank.md", "rerank.md"],
    ["https://docs.cohere.com/reference/create-audio-transcription.md", "transcription.md"],
    ["https://docs.cohere.com/docs/compatibility-api.md", "compatibility.md"],
    ["https://docs.cohere.com/v1/reference/generate.md", "generate.md"],
    [
      "https://raw.githubusercontent.com/cohere-ai/cohere-developer-experience/main/cohere-openapi.yaml",
      "openapi.yaml",
    ],
  ] as const;
  const documentOverrides = new Map<string, string | undefined>([
    ["https://docs.cohere.com/reference/chat.md", overrides.chat],
    ["https://docs.cohere.com/docs/models", overrides.index],
    ["https://docs.cohere.com/docs/command-a-plus", overrides.commandAPlus],
    ["https://docs.cohere.com/changelog/command-a", overrides.commandARelease],
    ["https://docs.cohere.com/docs/deprecations", overrides.lifecycle],
    ["https://cohere.com/pricing", overrides.pricing],
    ["https://docs.cohere.com/docs/how-does-cohere-pricing-work.md", overrides.pricingPolicy],
    ["https://docs.cohere.com/reference/create-audio-transcription.md", overrides.transcription],
    [
      "https://raw.githubusercontent.com/cohere-ai/cohere-developer-experience/main/cohere-openapi.yaml",
      overrides.openapi,
    ],
  ]);
  const body = JSON.stringify({
    index: {
      url: source.url,
      body: overrides.modelIndex ?? (await fixture("cohere/model-index.md")),
    },
    documents: await Promise.all(
      documents
        .filter(([url]) => url !== overrides.omitDocument)
        .map(async ([url, path]) => ({
          url,
          body: documentOverrides.get(url) ?? (await fixture(`cohere/${path}`)),
        })),
    ),
  });
  return parseSource({
    provider: provider(value),
    source,
    body,
    observedAt,
    ...(onPricingReconciliation === undefined ? {} : { onPricingReconciliation }),
  });
}

async function mistralCatalog(
  overrides: {
    adminUsage?: string;
    endpoints?: string;
    large?: string;
    medium?: string;
    omitDocument?: string;
    openapi?: string;
    pricing?: string;
    regional?: string;
    schema?: string;
    vibePricing?: string;
  } = {},
  minPricingCoverage = 0.9,
  onPricingReconciliation?: (item: PricingReconciliationItem) => void,
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
  const fixedDocuments = [
    [
      "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/schema/models/schema.ts",
      "schema.ts",
      overrides.schema,
    ],
    [
      "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/schema/models/endpoints.ts",
      "endpoints.ts",
      overrides.endpoints,
    ],
    [
      "https://docs.mistral.ai/studio-api/conversations/advanced/prompt-caching.md",
      "prompt-caching.md",
      undefined,
    ],
    ["https://docs.mistral.ai/studio-api/batch-processing.md", "batch-processing.md", undefined],
    ["https://mistral.ai/pricing/api/", "pricing.html", overrides.pricing],
    [
      "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/openapi.yaml",
      "openapi.yaml",
      overrides.openapi,
    ],
    [
      "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/content/en/docs/admin/admin-api/usage-metrics/page.mdx",
      "admin-usage.mdx",
      overrides.adminUsage,
    ],
    [
      "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/content/en/api/endpoint/beta/admin/billing/page.mdx",
      "admin-billing-api.mdx",
      undefined,
    ],
    [
      "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/content/en/docs/admin/billing-usage/billing/page.mdx",
      "account-billing.mdx",
      undefined,
    ],
    [
      "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/content/en/docs/admin/billing-usage/subscriptions/page.mdx",
      "account-plans.mdx",
      undefined,
    ],
    [
      "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/content/en/docs/studio-api/regional-inference/page.mdx",
      "regional-inference.mdx",
      overrides.regional,
    ],
    [
      "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/content/en/docs/studio-api/agents/agent-tools/page.mdx",
      "agent-tools.mdx",
      undefined,
    ],
    [
      "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/content/en/docs/studio-api/agents/agent-tools/code_interpreter/page.mdx",
      "code-interpreter.mdx",
      undefined,
    ],
    [
      "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/content/en/docs/studio-api/agents/agent-tools/websearch/page.mdx",
      "web-search.mdx",
      undefined,
    ],
    [
      "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/content/en/docs/studio-api/agents/agent-tools/image_generation/page.mdx",
      "image-generation.mdx",
      undefined,
    ],
    [
      "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/content/en/docs/studio-api/libraries/page.mdx",
      "libraries.mdx",
      undefined,
    ],
    ["https://mistral.ai/pricing/", "vibe-pricing.html", overrides.vibePricing],
    ["https://mistral.ai/products/forge/", "forge.html", undefined],
    ["https://mistral.ai/products/compute/", "compute.html", undefined],
    ["https://mistral.ai/services/", "services.html", undefined],
  ] as const;
  const body = JSON.stringify({
    index: { url: source.url, body: await fixture("mistral/index.ts") },
    documents: [
      ...(await Promise.all(
        fixedDocuments
          .filter(([url]) => url !== overrides.omitDocument)
          .map(async ([url, path, override]) => ({
            url,
            body: override ?? (await fixture(`mistral/${path}`)),
          })),
      )),
      ...(await Promise.all(
        slugs.map(async (slug) => ({
          url: `https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/schema/models/models/${slug}.ts`,
          body:
            slug === "mistral-medium-3-5-26-04" && overrides.medium !== undefined
              ? overrides.medium
              : slug === "mistral-large-3-25-12" && overrides.large !== undefined
                ? overrides.large
                : await fixture(`mistral/${slug}.ts`),
        })),
      )),
    ],
  });
  return parseSource({
    provider: provider(value),
    source,
    body,
    observedAt,
    ...(onPricingReconciliation === undefined ? {} : { onPricingReconciliation }),
  });
}

function withoutMistralPrices(body: string): string {
  return body
    .replace('input: [{ type: "range", price: 1.5, denominator: "/M Tokens" }]', "input: []")
    .replace('output: [{ type: "range", price: 7.5, denominator: "/M Tokens" }]', "output: []");
}

function withoutMistralPublicMedium(body: string): string {
  return body.replaceAll("mistral-medium-latest", "unlisted-medium");
}

async function llamaCatalog(
  overrides: Record<string, string> = {},
  onPricingReconciliation?: (item: PricingReconciliationItem) => void,
): Promise<ProviderModel[]> {
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
    [raw("llama-api-python", "examples/async_chat.py"), "async_chat.py"],
    [raw("llama-api-python", "examples/tool_call.py"), "tool_call.py"],
    [raw("llama-api-python", "examples/structured.py"), "structured.py"],
    [raw("llama-api-python", "src/llama_api_client/_client.py"), "client.py"],
    [raw("llama-api-python", "src/llama_api_client/resources/models.py"), "models.py"],
    [raw("llama-api-python", "src/llama_api_client/types/llama_model.py"), "llama_model.py"],
    [
      raw("llama-api-python", "src/llama_api_client/types/model_list_response.py"),
      "model_list_response.py",
    ],
    [
      raw("llama-api-python", "src/llama_api_client/types/chat/completion_create_params.py"),
      "completion_create_params.py",
    ],
    [
      raw("llama-api-python", "src/llama_api_client/types/create_chat_completion_response.py"),
      "chat_response.py",
    ],
    [
      raw(
        "llama-api-python",
        "src/llama_api_client/types/create_chat_completion_response_stream_chunk.py",
      ),
      "chat_stream_response.py",
    ],
    [
      raw("llama-api-python", "src/llama_api_client/types/moderation_create_response.py"),
      "moderation_response.py",
    ],
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
    ["https://ai.meta.com/blog/llamacon-llama-news/", "llamacon.html"],
    [raw("llama-models", "models/llama2/LICENSE"), "llama2-license.txt"],
    [raw("llama-models", "models/llama3/LICENSE"), "llama3-license.txt"],
    [raw("llama-models", "models/llama3_1/LICENSE"), "llama3_1-license.txt"],
    [raw("llama-models", "models/llama3_2/LICENSE"), "llama3_2-license.txt"],
    [raw("llama-models", "models/llama3_3/LICENSE"), "llama3_3-license.txt"],
    [raw("llama-models", "models/llama4/LICENSE"), "llama4-license.txt"],
    [raw("llama-models", "models/llama3_2/USE_POLICY.md"), "llama3_2-use-policy.md"],
    [raw("llama-models", "models/llama4/USE_POLICY.md"), "llama4-use-policy.md"],
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
  return parseSource({
    provider: provider(value),
    source,
    body,
    observedAt,
    ...(onPricingReconciliation === undefined ? {} : { onPricingReconciliation }),
  });
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

async function ollamaLibrary(
  onPricingReconciliation?: (item: PricingReconciliationItem) => void,
): Promise<ProviderModel[]> {
  const value = manifest("ollama");
  const source = ollamaSource("ollama-library");
  return parseSource({
    provider: provider(value),
    source,
    body: await fixture("ollama/library.html"),
    observedAt,
    ...(onPricingReconciliation === undefined ? {} : { onPricingReconciliation }),
  });
}

interface OllamaCloudOptions {
  documents?: Readonly<Record<string, string>>;
  pages?: Readonly<Record<string, string>>;
  transform?: (body: string) => string;
}

async function ollamaCloudBody(options: OllamaCloudOptions = {}): Promise<string> {
  const raw: unknown = JSON.parse(await fixture("ollama/cloud.json"));
  const bundle = z.object({ list: z.unknown(), details: z.array(z.unknown()) }).parse(raw);
  const pages = [
    ["gpt-oss", "gpt-oss-page.html"],
    ["kimi-k2.5", "kimi-k2.5-page.html"],
    ["gemini-3-flash-preview", "gemini-page.html"],
    ["kimi-k3", "kimi-k3-page.html"],
  ] as const;
  const documents = [
    ["https://ollama.com/llms.txt", "site-llms.txt"],
    ["https://docs.ollama.com/llms.txt", "docs-llms.txt"],
    ["https://ollama.com/pricing", "pricing.html"],
    ["https://ollama.com/terms", "terms.html"],
    ["https://docs.ollama.com/api/introduction.md", "api-introduction.md"],
    ["https://docs.ollama.com/api/tags.md", "api-tags.md"],
    ["https://docs.ollama.com/api-reference/show-model-details.md", "show-model-details.md"],
    ["https://docs.ollama.com/openapi.yaml", "openapi.yaml"],
    ["https://docs.ollama.com/api/usage.md", "usage.md"],
    ["https://docs.ollama.com/api/openai-compatibility.md", "openai-compatibility.md"],
    ["https://docs.ollama.com/api/anthropic-compatibility.md", "anthropic-compatibility.md"],
    ["https://docs.ollama.com/api/authentication.md", "authentication.md"],
    ["https://docs.ollama.com/cloud.md", "cloud.md"],
    ["https://docs.ollama.com/capabilities/web-search.md", "web-search.md"],
    ["https://docs.ollama.com/capabilities/tool-calling.md", "tool-calling.md"],
    ["https://docs.ollama.com/capabilities/thinking.md", "thinking.md"],
    ["https://docs.ollama.com/capabilities/vision.md", "vision.md"],
  ] as const;
  const body = JSON.stringify({
    ...bundle,
    catalog: {
      url: "https://ollama.com/search?c=cloud",
      body: await fixture("ollama/cloud-catalog.html"),
    },
    pages: await Promise.all(
      pages.map(async ([model, path]) => ({
        model,
        url: `https://ollama.com/library/${model}`,
        body: JSON.parse(
          normalizeOllamaModelPage(
            model,
            options.pages?.[model] ?? (await fixture(`ollama/${path}`)),
          ),
        ),
      })),
    ),
    documents: await Promise.all(
      documents.map(async ([url, path]) => ({
        url,
        body: options.documents?.[path] ?? (await fixture(`ollama/${path}`)),
      })),
    ),
  });
  return options.transform?.(body) ?? body;
}

async function ollamaCloud(
  options: OllamaCloudOptions = {},
  onPricingReconciliation?: (item: PricingReconciliationItem) => void,
  onContractFinding?: (evidence: SourceContractEvidence) => void,
): Promise<ProviderModel[]> {
  const value = manifest("ollama");
  const source = ollamaSource("ollama-cloud");
  return parseSource({
    provider: provider(value),
    source,
    body: await ollamaCloudBody(options),
    observedAt,
    ...(onPricingReconciliation === undefined ? {} : { onPricingReconciliation }),
    ...(onContractFinding === undefined ? {} : { onContractFinding }),
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
      command_a_price_count: 2,
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
      ],
      embedding_endpoints: [{ name: "Embed", path: "v2/embed" }],
      rerank_prices: [{ price: "2.5", unit: "thousand_search_units", conditions: {} }],
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
    expect(commandA?.price_facts.map(({ meter, price, unit }) => ({ meter, price, unit }))).toEqual(
      [
        { meter: "input_text", price: "2.5", unit: "million_tokens" },
        { meter: "output_text", price: "10", unit: "million_tokens" },
      ],
    );
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

  it("publishes hosted, Vault, async, distribution, and private-deployment topology", async () => {
    const models = await cohereCatalog();
    const source = manifest("cohere").sources[0];
    if (source === undefined) throw new Error("Missing Cohere pricing source");
    const partition = assembleParsedProviderPricing(
      "cohere",
      observedAt,
      [{ source, models }],
      models,
    );
    expect(partition).toBeDefined();
    const books = partition?.books ?? [];
    const resource = (key: string) =>
      books.find(({ scope }) => scope.kind === "provider_resource" && scope.resource_key === key);

    const command = books.find(
      ({ scope }) =>
        scope.kind === "models" && scope.model_refs.includes("cohere/command-a-03-2025"),
    );
    expect(command?.offers.map(({ offer_key }) => offer_key)).toEqual([
      "hosted-production",
      "hosted-evaluation",
    ]);
    const production = command?.offers.find(({ offer_key }) => offer_key === "hosted-production");
    expect(
      production?.terms
        .filter((term) => term.kind === "rate")
        .map((term) => [term.meter.value, term.variants[0]?.charge_binding?.signal.value]),
    ).toEqual(
      expect.arrayContaining([
        ["input_text", "billed_input_tokens"],
        ["output_text", "billed_output_tokens"],
      ]),
    );
    expect(production?.relations).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "exclusive_with" })]),
    );
    expect(production?.settlement[0]).toMatchObject({ channel: "direct", biller: "Cohere" });

    const noCharge = books.find(
      ({ scope }) =>
        scope.kind === "models" && scope.model_refs.includes("cohere/command-a-plus-05-2026"),
    );
    expect(noCharge?.offers.map(({ offer_key }) => offer_key)).toEqual(["hosted-no-charge"]);
    expect(noCharge?.offers[0]?.settlement).toEqual([]);

    const standard = resource("standard-vault:cohere/embed-v4.0:small");
    expect(standard?.offers.map(({ offer_key }) => offer_key)).toEqual(["flex", "fixed"]);
    expect(
      standard?.offers.map((offer) => ({
        key: offer.offer_key,
        enrollment: offer.enrollment.map(({ state }) => state),
        units: offer.terms
          .filter((term) => term.kind === "rate")
          .flatMap((term) => term.variants.map(({ price }) => price.per.factors[0]?.unit.value)),
      })),
    ).toEqual(
      expect.arrayContaining([
        { key: "fixed", enrollment: ["open"], units: ["unit_month", "unit_year"] },
        {
          key: "flex",
          enrollment: ["open"],
          units: ["unit_hour", "unit_month", "unit_year"],
        },
      ]),
    );
    expect(standard?.offers[0]?.relations).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "exclusive_with" })]),
    );
    const unboundNorth = resource("standard-vault:unbound:north-large:xl");
    expect(unboundNorth?.scope.model_refs).toEqual([]);
    expect(unboundNorth?.offers[0]).toMatchObject({
      offer_key: "hourly-rate",
      states: [expect.objectContaining({ state: "numeric" })],
    });
    expect(unboundNorth?.offers[0]?.terms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "rate",
          meter: expect.objectContaining({ value: "provisioned_capacity" }),
        }),
        expect.objectContaining({
          kind: "raw",
          term_key: "standard_vault_model_binding",
        }),
      ]),
    );

    expect(resource("encrypted-vault")?.offers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          offer_key: "beta",
          enrollment: [expect.objectContaining({ state: "private_preview" })],
          settlement: [],
          states: [expect.objectContaining({ state: "free" })],
        }),
        expect.objectContaining({
          offer_key: "general-availability",
          enrollment: [expect.objectContaining({ state: "account_scoped" })],
          states: [expect.objectContaining({ state: "custom_quote" })],
        }),
      ]),
    );
    expect(resource("batch")?.offers[0]?.states).toEqual([
      expect.objectContaining({ state: "not_published" }),
    ]);
    expect(resource("embed-jobs")?.scope).toMatchObject({
      model_refs: expect.arrayContaining([
        "cohere/embed-english-v3.0",
        "cohere/embed-multilingual-v3.0",
      ]),
    });
    expect(resource("north")?.offers[0]?.states).toEqual([
      expect.objectContaining({ state: "custom_quote" }),
    ]);
    expect(resource("compass")?.offers[0]?.states).toEqual([
      expect.objectContaining({ state: "custom_quote" }),
    ]);
    expect(resource("model-download:cohere/command-a-plus-05-2026")?.offers[0]?.states).toEqual([
      expect.objectContaining({ state: "free" }),
    ]);
    expect(resource("private-deployment")?.offers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          offer_key: "cohere-engagement",
          states: [expect.objectContaining({ state: "custom_quote" })],
        }),
        expect.objectContaining({
          offer_key: "operator-infrastructure",
          settlement: [expect.objectContaining({ channel: "operator" })],
          states: [expect.objectContaining({ state: "externally_billed" })],
        }),
      ]),
    );
    expect(
      books.flatMap(({ offers }) =>
        offers.flatMap(({ terms }) =>
          terms.filter((term) => term.kind === "rate").map(({ meter }) => meter.value),
        ),
      ),
    ).not.toContain("tool_call");
  });

  it("parses the authenticated API after its transport has combined all pages", async () => {
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

  it("rejects model endpoint, API-reference, and official OpenAPI drift", async () => {
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
    const openapi = (await fixture("cohere/openapi.yaml")).replace(
      "        cached_tokens:\n",
      "        cache_hits:\n",
    );
    await expect(cohereCatalog({ openapi })).rejects.toThrow(
      "Cohere OpenAPI reference drifted: ApiMeta",
    );
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

  it("isolates conflicting responsive pricing payloads", async () => {
    const pricing = await fixture("cohere/pricing.html");
    const frame = pricing.match(/<script[\s\S]*?<\/script>/)?.[0];
    if (frame === undefined) throw new Error("Missing Cohere pricing fixture frame");
    const reconciliation: PricingReconciliationItem[] = [];
    const models = await cohereCatalog(
      { pricing: pricing.replace("</main>", `${frame.replace("0.15", "0.16")}</main>`) },
      (item) => reconciliation.push(item),
    );
    expect(models).toHaveLength(43);
    expect(models.find(({ model_id }) => model_id === "command-r")?.price_facts).toHaveLength(2);
    expect(reconciliation).toContainEqual({
      disposition: "unresolved",
      reason_code: "responsive_pricing_conflict",
      sample: "Command R",
    });
  });

  it("uses corroborated release evidence to bind the mislabeled Command A card", async () => {
    const reconciliation: PricingReconciliationItem[] = [];
    await cohereCatalog({}, (item) => reconciliation.push(item));
    expect(reconciliation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason_code: "evaluation_api_access_free" }),
        expect.objectContaining({ reason_code: "model_download_free" }),
        expect.objectContaining({ reason_code: "standard_vault_capacity_rates" }),
        expect.objectContaining({ reason_code: "encrypted_vault_beta_and_quote" }),
      ]),
    );
    expect(
      reconciliation.some(({ reason_code }) => reason_code === "responsive_pricing_conflict"),
    ).toBe(false);
    expect(
      reconciliation.find(({ reason_code }) => reason_code === "model_card_documented_id_override"),
    ).toEqual({
      disposition: "excluded",
      reason_code: "model_card_documented_id_override",
      sample: "/docs/command-a: command-a-plus-05-2026 -> command-a-03-2025",
    });
  });

  it("does not guess across a model-card identity conflict without exact release corroboration", async () => {
    const release = (await fixture("cohere/command-a-release.html")).replace(
      "command-a-03-2025",
      "command-a-research-preview",
    );
    const reconciliation: PricingReconciliationItem[] = [];
    const models = await cohereCatalog({ commandARelease: release }, (item) =>
      reconciliation.push(item),
    );
    expect(
      models.find(({ model_id }) => model_id === "command-a-03-2025")?.price_facts,
    ).toHaveLength(0);
    expect(
      reconciliation.filter(({ reason_code }) => reason_code === "model_card_identity_conflict"),
    ).toHaveLength(2);
  });

  it("isolates drift in billed-unit, account-key, and response evidence", async () => {
    const chat = (await fixture("cohere/chat.md")).replace(
      "The number of billed input tokens.",
      "The number of metered input tokens.",
    );
    const chatReconciliation: PricingReconciliationItem[] = [];
    const chatModels = await cohereCatalog({ chat }, (item) => chatReconciliation.push(item));
    expect(
      chatModels.find(({ model_id }) => model_id === "command-a-03-2025")?.raw_price_facts,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ term_key: "accounting_binding_unavailable" }),
      ]),
    );
    expect(chatReconciliation).toContainEqual({
      disposition: "unbound",
      reason_code: "accounting_reference_drift",
      sample: "/reference/chat.md",
    });
    const source = manifest("cohere").sources[0];
    if (source === undefined) throw new Error("Missing Cohere pricing source");
    const chatPricing = assembleParsedProviderPricing(
      "cohere",
      observedAt,
      [{ source, models: chatModels }],
      chatModels,
    );
    const offerFor = (uid: string) =>
      chatPricing?.books
        .find(({ scope }) => scope.kind === "models" && scope.model_refs.includes(uid))
        ?.offers.find(({ offer_key }) => offer_key === "hosted-production");
    expect(
      offerFor("cohere/command-a-03-2025")
        ?.terms.filter((term) => term.kind === "rate")
        .flatMap(({ variants }) => variants.map(({ charge_binding }) => charge_binding)),
    ).toEqual([undefined, undefined]);
    expect(
      offerFor("cohere/embed-v4.0")
        ?.terms.filter((term) => term.kind === "rate")
        .every(({ variants }) =>
          variants.every(({ charge_binding }) => charge_binding !== undefined),
        ),
    ).toBe(true);
    const pricingPolicy = (await fixture("cohere/pricing-policy.md")).replace(
      "actually billed",
      "approximately counted",
    );
    const policyReconciliation: PricingReconciliationItem[] = [];
    const policyModels = await cohereCatalog({ pricingPolicy }, (item) =>
      policyReconciliation.push(item),
    );
    expect(policyModels.find(({ model_id }) => model_id === "embed-v4.0")?.raw_price_facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ term_key: "accounting_binding_unavailable" }),
      ]),
    );
    expect(policyReconciliation).toContainEqual({
      disposition: "unbound",
      reason_code: "accounting_reference_drift",
      sample: "/docs/how-does-cohere-pricing-work.md",
    });
    const transcription = `${await fixture("cohere/transcription.md")}\nbilled_units`;
    const transcriptionReconciliation: PricingReconciliationItem[] = [];
    const transcriptionModels = await cohereCatalog({ transcription }, (item) =>
      transcriptionReconciliation.push(item),
    );
    expect(transcriptionModels).toHaveLength(43);
    expect(transcriptionReconciliation).toContainEqual({
      disposition: "unbound",
      reason_code: "accounting_reference_drift",
      sample: "/reference/create-audio-transcription.md",
    });
  });

  it("keeps independently supported prices when an optional commercial companion is absent", async () => {
    const reconciliation: PricingReconciliationItem[] = [];
    const models = await cohereCatalog(
      { omitDocument: "https://docs.cohere.com/docs/model-vault/standard/pricing.md" },
      (item) => reconciliation.push(item),
    );
    expect(
      models.find(({ model_id }) => model_id === "command-a-03-2025")?.price_facts,
    ).toHaveLength(2);
    expect(
      models
        .flatMap(({ commercial_facts }) => commercial_facts ?? [])
        .some(({ resource_key }) => resource_key === "standard-vault:cohere/embed-v4.0:small"),
    ).toBe(false);
    expect(reconciliation).toContainEqual({
      disposition: "unbound",
      reason_code: "commercial_companion_missing",
      sample: "/docs/model-vault/standard/pricing.md",
    });
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
        source: ["website", "repository"],
        fields: expect.arrayContaining(["api_endpoints"]),
        linkedDocuments: {
          indexFormat: "markdown",
          discoverySuffix: ".md",
          minDocuments: 15,
          maxDocuments: 30,
          documents: expect.arrayContaining([
            expect.objectContaining({ id: "pricing-policy" }),
            expect.objectContaining({ id: "rate-limits" }),
            expect.objectContaining({ id: "commercial-batch", optional: true }),
            expect.objectContaining({ id: "standard-vault-pricing", optional: true }),
            expect.objectContaining({ id: "encrypted-vault-pricing", optional: true }),
            expect.objectContaining({ id: "private-deployment", optional: true }),
            expect.objectContaining({ id: "billing-errors" }),
            expect.objectContaining({ id: "teams-and-roles" }),
            expect.objectContaining({ id: "api-chat-stream-v2" }),
            expect.objectContaining({ id: "api-embed-job-result" }),
            expect.objectContaining({ id: "openapi" }),
          ]),
        },
      },
      {
        url: "https://api.cohere.com/v1/models",
        extractor: { kind: "cohere-api" },
        type: "api",
        scope: "account",
        role: "inventory",
        transport: { kind: "cohere-models", pageSize: 1000, maxPages: 10, maxModels: 5000 },
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
        pricing: medium?.price_facts
          .filter(({ currency }) => currency === "USD")
          .map(({ meter, price, unit, conditions, derived }) => ({
            meter,
            price,
            unit,
            conditions,
            derived,
          })),
        eur: medium?.price_facts
          .filter(({ currency }) => currency === "EUR")
          .map(({ meter, price, conditions, derived }) => ({ meter, price, conditions, derived })),
      },
      embed: {
        tasks: embed?.tasks,
        api_endpoints: embed?.api_endpoints,
      },
      ocr: {
        tasks: ocr?.tasks,
        api_endpoints: ocr?.api_endpoints,
        modalities: ocr?.modalities,
        pricing: ocr?.price_facts
          .filter(({ currency }) => currency === "USD")
          .map(({ meter, price, unit, conditions }) => ({
            meter,
            price,
            unit,
            conditions,
          })),
        eur: ocr?.price_facts
          .filter(({ currency }) => currency === "EUR")
          .map(({ price, conditions }) => ({ price, conditions })),
      },
      speech: {
        tasks: speech?.tasks,
        api_endpoints: speech?.api_endpoints,
        modalities: speech?.modalities,
        pricing: speech?.price_facts
          .filter(({ currency }) => currency === "USD")
          .map(({ meter, price, unit }) => ({ meter, price, unit })),
        eur: speech?.price_facts
          .filter(({ currency }) => currency === "EUR")
          .map(({ meter, price, unit }) => ({ meter, price, unit })),
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
            conditions: { billing_currency: "USD" },
            derived: false,
          },
          {
            meter: "output_text",
            price: "7.5",
            unit: "million_tokens",
            conditions: { billing_currency: "USD" },
            derived: false,
          },
          {
            meter: "input_text",
            price: "0.75",
            unit: "million_tokens",
            conditions: { billing_currency: "USD", service_tier: "batch" },
            derived: true,
          },
          {
            meter: "output_text",
            price: "3.75",
            unit: "million_tokens",
            conditions: { billing_currency: "USD", service_tier: "batch" },
            derived: true,
          },
          {
            meter: "cache_read_text",
            price: "0.15",
            unit: "million_tokens",
            conditions: { billing_currency: "USD" },
            derived: true,
          },
        ],
        eur: [
          {
            meter: "input_text",
            price: "1.25",
            conditions: { billing_currency: "EUR" },
            derived: false,
          },
          {
            meter: "input_text",
            price: "0.625",
            conditions: { billing_currency: "EUR", service_tier: "batch" },
            derived: true,
          },
          {
            meter: "cache_read_text",
            price: "0.125",
            conditions: { billing_currency: "EUR" },
            derived: true,
          },
          {
            meter: "output_text",
            price: "6.4",
            conditions: { billing_currency: "EUR" },
            derived: false,
          },
          {
            meter: "output_text",
            price: "3.2",
            conditions: { billing_currency: "EUR", service_tier: "batch" },
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
            conditions: { billing_currency: "USD", operation: "ocr" },
          },
          {
            meter: "input_image",
            price: "5",
            unit: "thousand_pages",
            conditions: { billing_currency: "USD", operation: "document_annotation" },
          },
          {
            meter: "input_image",
            price: "2",
            unit: "thousand_pages",
            conditions: {
              billing_currency: "USD",
              operation: "ocr",
              service_tier: "batch",
            },
          },
          {
            meter: "input_image",
            price: "2.5",
            unit: "thousand_pages",
            conditions: {
              billing_currency: "USD",
              operation: "document_annotation",
              service_tier: "batch",
            },
          },
        ],
        eur: [
          { price: "3.5", conditions: { billing_currency: "EUR", operation: "ocr" } },
          {
            price: "1.75",
            conditions: {
              billing_currency: "EUR",
              operation: "ocr",
              service_tier: "batch",
            },
          },
          {
            price: "4.38",
            conditions: { billing_currency: "EUR", operation: "document_annotation" },
          },
          {
            price: "2.19",
            conditions: {
              billing_currency: "EUR",
              operation: "document_annotation",
              service_tier: "batch",
            },
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
        eur: [{ meter: "output_audio", price: "10", unit: "million_characters" }],
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
    const pricing = withoutMistralPublicMedium(await fixture("mistral/pricing.html"));
    const model = (await mistralCatalog({ medium, pricing }, 0.8)).find(
      ({ model_id }) => model_id === "mistral-medium-3-5",
    );
    expect(model).toMatchObject({ pricing_state: "not_published", price_facts: [] });
  });

  it("fills a repository price gap from the exact first-party public price card", async () => {
    const medium = withoutMistralPrices(await fixture("mistral/mistral-medium-3-5-26-04.ts"));
    const model = (await mistralCatalog({ medium }, 0.8)).find(
      ({ model_id }) => model_id === "mistral-medium-3-5",
    );
    expect(model).toMatchObject({
      pricing_state: "numeric",
      price_facts: expect.arrayContaining([
        expect.objectContaining({
          meter: "input_text",
          currency: "USD",
          price: "1.5",
          derived: false,
        }),
        expect.objectContaining({
          meter: "input_text",
          currency: "EUR",
          price: "1.25",
          derived: false,
        }),
      ]),
    });
  });

  it("reads an exact structural Free row even when adjacent card text has no separator", async () => {
    const medium = withoutMistralPrices(await fixture("mistral/mistral-medium-3-5-26-04.ts"));
    const pricing = withoutMistralPublicMedium(await fixture("mistral/pricing.html")).replace(
      "</main>",
      `<mistral-block-card-model><p>Classifier APIs</p><p>Free </p><mistral-atom-button-copy-clipboard data-text="mistral-medium-latest"></mistral-atom-button-copy-clipboard></mistral-block-card-model></main>`,
    );
    const model = (await mistralCatalog({ medium, pricing }, 0.8)).find(
      ({ model_id }) => model_id === "mistral-medium-3-5",
    );
    expect(model).toMatchObject({ pricing_state: "free", price_facts: [] });
  });

  it("accounts for every reviewed repository and public-page price observation", async () => {
    const items: PricingReconciliationItem[] = [];
    const models = await mistralCatalog({}, 0.9, (item) => items.push(item));
    expect(items.filter(({ disposition }) => disposition === "normalized").length).toBeGreaterThan(
      20,
    );
    expect(
      items.filter(({ disposition }) =>
        ["unbound", "unsupported", "unresolved"].includes(disposition),
      ),
    ).toEqual([]);
    expect(
      models
        .flatMap(({ commercial_facts }) => commercial_facts ?? [])
        .map(({ book_key }) => book_key),
    ).toEqual(
      expect.arrayContaining([
        "service:code-execution",
        "service:web-search",
        "service:image-generation",
        "account:library",
        "account:classifier-3b",
        "plan:vibe-pro",
        "service:compute",
      ]),
    );
    expect(items).toContainEqual({
      disposition: "ambiguous",
      reason_code: "public_price_retired_model_conflict",
      sample: "mistral-large-2407: Input (/M tokens)",
    });
  });

  it("selects the dedicated price page while preserving a conflicting repository amount", async () => {
    const pricing = (await fixture("mistral/pricing.html")).replaceAll(
      '"priceUsd":1.5',
      '"priceUsd":1.6',
    );
    const items: PricingReconciliationItem[] = [];
    const model = (await mistralCatalog({ pricing }, 0.9, (item) => items.push(item))).find(
      ({ model_id }) => model_id === "mistral-medium-3-5",
    );
    expect(model?.price_facts).toContainEqual(
      expect.objectContaining({
        meter: "input_text",
        currency: "USD",
        price: "1.6",
        resolution_policy: "mistral_public_price_page_over_repository",
      }),
    );
    expect(model?.price_facts).toContainEqual(
      expect.objectContaining({ meter: "input_text", currency: "EUR", price: "1.25" }),
    );
    expect(model?.raw_price_facts).toContainEqual(
      expect.objectContaining({
        reason: "superseded_value",
        raw: expect.objectContaining({ amount: "1.5", denomination: "USD" }),
      }),
    );
    expect(items).toContainEqual({
      disposition: "raw",
      reason_code: "first_party_price_conflict_resolved",
      sample: "mistral-medium-3-5: Input (/M tokens)",
    });
  });

  it("publishes distinct inference mechanisms and provider-resource price books", async () => {
    const value = manifest("mistral");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Mistral source");
    const models = await mistralCatalog();
    const pricing = assembleParsedProviderPricing(
      value.provider.id,
      observedAt,
      [{ source, models }],
      models,
      value.pricingCategoricalLabels,
    );
    const medium = pricing?.books.find(
      ({ book_key }) => book_key === "model:mistral/mistral-medium-3-5@26.04",
    );
    expect(medium?.offers.map(({ offer_key }) => offer_key)).toEqual(["batch", "sync"]);
    expect(
      medium?.offers
        .find(({ offer_key }) => offer_key === "sync")
        ?.terms.find(
          (term) =>
            term.kind === "rate" &&
            term.meter.namespace === "kmodels" &&
            term.meter.value === "cache_read_text",
        ),
    ).toMatchObject({
      kind: "rate",
      variants: expect.arrayContaining([
        expect.objectContaining({ charge_binding: expect.any(Object) }),
      ]),
    });
    expect(
      medium?.offers
        .find(({ offer_key }) => offer_key === "batch")
        ?.relations.some(({ kind }) => kind === "exclusive_with"),
    ).toBe(true);

    const code = pricing?.books.find(({ book_key }) => book_key === "service:code-execution");
    expect(code?.offers[0]?.terms[0]).toMatchObject({
      kind: "rate",
      meter: { namespace: "kmodels", value: "code_execution" },
      variants: expect.arrayContaining([
        expect.objectContaining({ charge_binding: expect.any(Object) }),
      ]),
    });
    expect(code?.offers[0]?.relations.map(({ kind }) => kind)).toEqual(
      expect.arrayContaining(["requires", "compatible_with"]),
    );

    const library = pricing?.books.find(({ book_key }) => book_key === "account:library");
    expect(library?.offers.map(({ offer_key }) => offer_key)).toEqual(
      expect.arrayContaining(["indexing", "ocr", "retrieval"]),
    );
    expect(
      library?.offers
        .find(({ offer_key }) => offer_key === "retrieval")
        ?.terms.find(({ kind }) => kind === "rate"),
    ).toMatchObject({
      variants: expect.arrayContaining([
        expect.objectContaining({ charge_binding: expect.any(Object) }),
      ]),
    });
    expect(pricing?.books.map(({ book_key }) => book_key)).toEqual(
      expect.arrayContaining([
        "account:classifier-3b",
        "plan:vibe-pro",
        "service:enterprise-api",
        "service:forge",
        "service:compute",
        "distribution:mistral/mistral-large-2512@25.12",
      ]),
    );
    expect(
      pricing?.books.find(
        ({ book_key }) => book_key === "distribution:mistral/mistral-large-2512@25.12",
      )?.offers[0],
    ).toMatchObject({
      states: [expect.objectContaining({ state: "externally_billed" })],
      settlement: [],
      terms: [
        expect.objectContaining({
          kind: "raw",
          variants: [expect.objectContaining({ reason: "unknown_amount" })],
        }),
      ],
    });
  });

  it("keeps a provider-service amount when its execution-counter companion is unavailable", async () => {
    const value = manifest("mistral");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Mistral source");
    const items: PricingReconciliationItem[] = [];
    const models = await mistralCatalog(
      {
        omitDocument:
          "https://raw.githubusercontent.com/mistralai/platform-docs-public/main/src/content/en/docs/studio-api/agents/agent-tools/code_interpreter/page.mdx",
      },
      0.9,
      (item) => items.push(item),
    );
    const pricing = assembleParsedProviderPricing(
      value.provider.id,
      observedAt,
      [{ source, models }],
      models,
      value.pricingCategoricalLabels,
    );
    const code = pricing?.books.find(({ book_key }) => book_key === "service:code-execution");
    const rate = code?.offers[0]?.terms.find(({ kind }) => kind === "rate");
    expect(
      rate?.kind === "rate" && rate.variants.every((variant) => !("charge_binding" in variant)),
    ).toBe(true);
    expect(code?.offers[0]?.terms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "raw", term_key: "charge_binding_unavailable" }),
      ]),
    );
    expect(items).toContainEqual(
      expect.objectContaining({
        reason_code: "commercial_companion_missing",
        sample:
          "/mistralai/platform-docs-public/main/src/content/en/docs/studio-api/agents/agent-tools/code_interpreter/page.mdx",
      }),
    );
  });

  it("falls back to repository prices when the dedicated pricing page is unavailable", async () => {
    const items: PricingReconciliationItem[] = [];
    const models = await mistralCatalog(
      { omitDocument: "https://mistral.ai/pricing/api/" },
      0.9,
      (item) => items.push(item),
    );
    const medium = models.find(({ model_id }) => model_id === "mistral-medium-3-5");
    expect(medium?.price_facts).toContainEqual(
      expect.objectContaining({
        meter: "input_text",
        currency: "USD",
        price: "1.5",
      }),
    );
    expect(medium?.price_facts.some(({ currency }) => currency === "EUR")).toBe(false);
    expect(items).toContainEqual({
      disposition: "unbound",
      reason_code: "commercial_companion_missing",
      sample: "/pricing/api/",
    });
  });

  it("keeps valid pricing cards when one provider-service amount is malformed", async () => {
    const pricing = (await fixture("mistral/pricing.html")).replace(
      '{"priceEur":30,"priceUsd":30,"prefix":null,"suffix":null}',
      '{"priceEur":"quote","priceUsd":30,"prefix":null,"suffix":null}',
    );
    const items: PricingReconciliationItem[] = [];
    const models = await mistralCatalog({ pricing }, 0.9, (item) => items.push(item));
    const facts = models.flatMap(({ commercial_facts }) => commercial_facts ?? []);
    expect(facts.some(({ book_key }) => book_key === "service:code-execution")).toBe(false);
    expect(facts.some(({ book_key }) => book_key === "service:web-search")).toBe(true);
    expect(items).toContainEqual(
      expect.objectContaining({
        disposition: "unsupported",
        reason_code: "public_price_shape_unsupported",
        sample: "Code execution: Price (per 1K calls)",
      }),
    );
  });

  it("mechanically refreshes structured Vibe plan amounts", async () => {
    const vibePricing = (await fixture("mistral/vibe-pricing.html")).replaceAll("14.99", "15.99");
    const models = await mistralCatalog({ vibePricing });
    const pro = models
      .flatMap(({ commercial_facts }) => commercial_facts ?? [])
      .find(({ book_key }) => book_key === "plan:vibe-pro");
    expect(pro?.price_facts).toContainEqual(
      expect.objectContaining({ currency: "USD", price: "15.99", unit: "unit_month" }),
    );
  });

  it("keeps an open model when only its optional weight-distribution claim drifts", async () => {
    const large = (await fixture("mistral/mistral-large-3-25-12.ts")).replace(
      'url: "https://huggingface.co/mistralai/Mistral-Large-3-675B-Instruct-2512"',
      'download: "https://huggingface.co/mistralai/Mistral-Large-3-675B-Instruct-2512"',
    );
    const items: PricingReconciliationItem[] = [];
    const models = await mistralCatalog({ large }, 0.9, (item) => items.push(item));
    const model = models.find(({ model_id }) => model_id === "mistral-large-2512");
    expect(model).toMatchObject({ status: "active", pricing_state: "numeric" });
    expect(model?.commercial_facts).toBeUndefined();
    expect(items).toContainEqual({
      disposition: "unsupported",
      reason_code: "weight_distribution_drift",
      sample: "mistral-large-3-25-12",
    });
  });

  it("isolates first-party accounting drift while keeping identity guards strict", async () => {
    const openapi = (await fixture("mistral/openapi.yaml")).replace(
      "cached_tokens",
      "renamed_cached_tokens",
    );
    const openapiItems: PricingReconciliationItem[] = [];
    const retained = await mistralCatalog({ openapi }, 0.9, (item) => openapiItems.push(item));
    expect(retained).toHaveLength(6);
    expect(
      retained.some(({ raw_price_facts }) =>
        raw_price_facts.some(
          ({ term_key }) => term_key === "accounting_binding_unavailable:tokens",
        ),
      ),
    ).toBe(true);
    expect(openapiItems).toContainEqual(
      expect.objectContaining({
        disposition: "unbound",
        reason_code: "accounting_contract_drift",
        sample: "Mistral OpenAPI reference drifted: PromptTokensDetails",
      }),
    );

    const modelList = (await fixture("mistral/openapi.yaml")).replace(
      "list_models_v1_models_get",
      "list_available_models",
    );
    await expect(mistralCatalog({ openapi: modelList })).rejects.toThrow(
      "Mistral OpenAPI reference drifted: /v1/models",
    );

    const misleadingUsage = `${openapi}\n    UnrelatedCacheShape:\n      properties:\n        cached_tokens:\n          type: integer`;
    await expect(mistralCatalog({ openapi: misleadingUsage })).resolves.toHaveLength(6);

    const adminUsage = (await fixture("mistral/admin-usage.mdx")).replaceAll(
      "cost and consumption",
      "request totals",
    );
    const adminItems: PricingReconciliationItem[] = [];
    await expect(
      mistralCatalog({ adminUsage }, 0.9, (item) => adminItems.push(item)),
    ).resolves.toHaveLength(6);
    expect(adminItems).toContainEqual(
      expect.objectContaining({
        reason_code: "accounting_contract_drift",
        sample: "Mistral Admin usage guide drifted",
      }),
    );

    const regional = (await fixture("mistral/regional-inference.mdx")).replace("1.1×", "1.2×");
    const regionalItems: PricingReconciliationItem[] = [];
    await expect(
      mistralCatalog({ regional }, 0.9, (item) => regionalItems.push(item)),
    ).resolves.toHaveLength(6);
    expect(regionalItems).toContainEqual(
      expect.objectContaining({
        reason_code: "accounting_contract_drift",
        sample: "Mistral regional pricing guide drifted",
      }),
    );
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

    const coverageItems: PricingReconciliationItem[] = [];
    await expect(
      mistralCatalog(
        {
          medium: withoutMistralPrices(medium),
          pricing: withoutMistralPublicMedium(await fixture("mistral/pricing.html")),
        },
        0.9,
        (item) => coverageItems.push(item),
      ),
    ).resolves.toHaveLength(6);
    expect(coverageItems).toContainEqual(
      expect.objectContaining({ reason_code: "pricing_coverage_below_reviewed_floor" }),
    );

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

    const api = (await fixture("mistral/api.json")).replace('      "type": "base",\n', "");
    const value = manifest("mistral");
    const source = value.sources.find(({ id }) => id === "mistral-api");
    if (source === undefined) throw new Error("Missing Mistral API source");
    expect(
      parseSource({
        provider: provider(value),
        source,
        body: api,
        observedAt,
      }).map(({ model_id }) => model_id),
    ).toEqual(["mistral-medium-3-5", "mistral-ocr-4-0"]);

    expect(() =>
      parseSource({
        provider: provider(value),
        source,
        body: api.replace(
          '{\n  "object": "list",',
          '{\n  "object": "list",\n  "next_page_token": "unreviewed",',
        ),
        observedAt,
      }),
    ).toThrow("unknown_field at /next_page_token");
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
            expect.objectContaining({ id: "public-pricing" }),
            expect.objectContaining({ id: "api-schema" }),
            expect.objectContaining({ id: "admin-usage" }),
            expect.objectContaining({ id: "admin-billing-api" }),
            expect.objectContaining({ id: "account-billing" }),
            expect.objectContaining({ id: "account-plans" }),
            expect.objectContaining({ id: "regional-inference" }),
            expect.objectContaining({ id: "agent-tools", optional: true }),
            expect.objectContaining({ id: "code-interpreter", optional: true }),
            expect.objectContaining({ id: "web-search", optional: true }),
            expect.objectContaining({ id: "image-generation", optional: true }),
            expect.objectContaining({ id: "libraries", optional: true }),
            expect.objectContaining({ id: "vibe-pricing", optional: true }),
            expect.objectContaining({ id: "forge", optional: true }),
            expect.objectContaining({ id: "compute", optional: true }),
            expect.objectContaining({ id: "services", optional: true }),
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
      hostedLlama33: models
        .filter(({ model_id }) => model_id === "Llama3.3-70B-Instruct")
        .map(({ aliases, api_endpoints, capabilities, pricing_state }) => ({
          aliases,
          api_endpoints,
          streaming: capabilities.streaming,
          pricing_state,
        })),
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
        pricing_state: "unknown",
      },
      hostedLlama33: [
        {
          aliases: ["meta-llama/Llama-3.3-70B-Instruct", "Llama-3.3-70B-Instruct"],
          api_endpoints: [{ name: "Chat Completions", path: "/v1/chat/completions" }],
          streaming: true,
          pricing_state: "unknown",
        },
      ],
      safety: [
        {
          model_id: "Llama-Guard-2-8B",
          tasks: ["moderation"],
          modalities: { input: ["text"], output: ["text"] },
          context: 4_096,
          release_date: "2024-04-18",
          api_endpoints: undefined,
          pricing_state: "unknown",
        },
        {
          model_id: "Llama-Guard-3-11B-Vision",
          tasks: ["moderation"],
          modalities: { input: ["text", "image"], output: ["text"] },
          context: 131_072,
          release_date: "2024-09-25",
          api_endpoints: undefined,
          pricing_state: "unknown",
        },
        {
          model_id: "Llama-Guard-3-8B",
          tasks: ["moderation"],
          modalities: { input: ["text"], output: ["text"] },
          context: 131_072,
          release_date: "2024-07-23",
          api_endpoints: undefined,
          pricing_state: "unknown",
        },
        {
          model_id: "Llama-Guard-4-12B",
          tasks: ["moderation"],
          modalities: { input: ["text", "image"], output: ["text"] },
          context: 8_192,
          release_date: "2025-04-29",
          api_endpoints: [{ name: "Moderations", path: "/v1/moderations" }],
          pricing_state: "unknown",
        },
        {
          model_id: "Llama-Prompt-Guard-2-22M",
          tasks: ["classification"],
          modalities: { input: ["text"], output: ["text"] },
          context: 512,
          release_date: "2025-04-29",
          api_endpoints: undefined,
          pricing_state: "unknown",
        },
        {
          model_id: "Prompt-Guard-86M",
          tasks: ["classification"],
          modalities: { input: ["text"], output: ["text"] },
          context: 512,
          release_date: "2024-07-23",
          api_endpoints: undefined,
          pricing_state: "unknown",
        },
      ],
    });
  });

  it("isolates hosted identity and route drift while keeping registry families strict", async () => {
    const chat = await fixture("llama/chat.py");
    const identityItems: PricingReconciliationItem[] = [];
    const identityModels = await llamaCatalog(
      {
        "chat.py": chat.replace("Llama-4-Maverick-17B-128E-Instruct-FP8", "unpublished-model"),
      },
      (item) => identityItems.push(item),
    );
    expect(identityModels).toHaveLength(12);
    expect(identityItems).toContainEqual(
      expect.objectContaining({
        reason_code: "hosted_example_drift",
        sample: expect.stringContaining("chat"),
      }),
    );

    const skuList = await fixture("llama/sku_list.py");
    const ambiguousItems: PricingReconciliationItem[] = [];
    await expect(
      llamaCatalog(
        {
          "sku_list.py": skuList.replace(
            'huggingface_repo="meta-llama/Llama-4-Maverick-17B-128E",',
            'huggingface_repo="meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",',
          ),
        },
        (item) => ambiguousItems.push(item),
      ),
    ).resolves.toHaveLength(12);
    expect(ambiguousItems).toContainEqual(
      expect.objectContaining({ reason_code: "hosted_example_drift" }),
    );

    const completions = await fixture("llama/completions.py");
    const chatRouteItems: PricingReconciliationItem[] = [];
    const withoutChatRoute = await llamaCatalog(
      {
        "completions.py": completions.replace(
          '"/chat/completions"',
          '"https://api.llama.com/v1/chat/completions"',
        ),
      },
      (item) => chatRouteItems.push(item),
    );
    expect(
      withoutChatRoute.every(
        ({ api_endpoints }) => api_endpoints?.[0]?.name !== "Chat Completions",
      ),
    ).toBe(true);
    expect(chatRouteItems).toContainEqual(
      expect.objectContaining({
        reason_code: "hosted_route_drift",
        sample: expect.stringContaining("Chat Completions"),
      }),
    );
    const moderations = await fixture("llama/moderations.py");
    const moderationRouteItems: PricingReconciliationItem[] = [];
    const withoutModerationRoute = await llamaCatalog(
      {
        "moderations.py": moderations.replace(
          '"/moderations"',
          '"https://api.llama.com/v1/moderations"',
        ),
      },
      (item) => moderationRouteItems.push(item),
    );
    expect(
      withoutModerationRoute.find(({ model_id }) => model_id === "Llama-Guard-4-12B")
        ?.api_endpoints,
    ).toBeUndefined();
    expect(moderationRouteItems).toContainEqual(
      expect.objectContaining({
        reason_code: "hosted_route_drift",
        sample: expect.stringContaining("Moderations"),
      }),
    );

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

  it("emits exact commercial resources without treating a dated preview as current", async () => {
    const items: PricingReconciliationItem[] = [];
    const models = await llamaCatalog({}, (item) => items.push(item));
    expect(
      dispositionCounts(items, [
        "normalized",
        "raw",
        "explicit_non_numeric",
        "excluded",
        "ambiguous",
        "unsupported",
        "unbound",
      ]),
    ).toEqual({
      normalized: 0,
      raw: 0,
      explicit_non_numeric: 12,
      excluded: 1,
      ambiguous: 0,
      unsupported: 0,
      unbound: 0,
    });
    expect(
      models
        .filter(({ api_endpoints }) => api_endpoints !== undefined)
        .map((model) => ({
          id: model.model_id,
          pricing: model.pricing_state,
        })),
    ).toEqual([
      { id: "Llama3.3-70B-Instruct", pricing: "unknown" },
      { id: "Llama-4-Maverick-17B-128E-Instruct:fp8", pricing: "unknown" },
      { id: "Llama-Guard-4-12B", pricing: "unknown" },
    ]);
    expect(
      models.every(({ commercial_facts }) =>
        ["distribution", "service"].every((kind) =>
          commercial_facts?.some(({ resource_kind }) => resource_kind === kind),
        ),
      ),
    ).toBe(true);
    expect(items).toContainEqual({
      disposition: "excluded",
      reason_code: "historical_limited_free_preview",
    });
  });

  it("assembles artifact, execution, and license mechanisms without a tool surcharge", async () => {
    const value = manifest("llama");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Llama source");
    const models = await llamaCatalog();
    const pricing = assembleParsedProviderPricing(
      value.provider.id,
      observedAt,
      [{ source, models }],
      models,
    );
    expect(pricing?.model_dispositions).toEqual([]);
    for (const model of models) {
      expect(
        pricing?.books.some(
          ({ scope }) =>
            scope.kind === "provider_resource" && scope.resource_key === `artifact:${model.uid}`,
        ),
      ).toBe(true);
      expect(
        pricing?.books.some(
          ({ scope }) =>
            scope.kind === "provider_resource" && scope.resource_key === `self-hosted:${model.uid}`,
        ),
      ).toBe(true);
    }
    const artifact = pricing?.books.find(
      ({ scope }) =>
        scope.kind === "provider_resource" &&
        scope.resource_key === "artifact:llama/Llama-4-Maverick-17B-128E-Instruct:fp8",
    );
    expect(artifact?.offers[0]).toMatchObject({
      states: [
        {
          state: "free",
          applicability: {
            any_of: [
              {
                all_of: [
                  expect.objectContaining({
                    kind: "categorical",
                    dimension: expect.objectContaining({ value: "license_class" }),
                    values: [expect.objectContaining({ value: "community" })],
                  }),
                ],
              },
            ],
          },
        },
      ],
      enrollment: [expect.objectContaining({ state: "account_scoped" })],
      settlement: [],
      relations: expect.arrayContaining([
        expect.objectContaining({ kind: "compatible_with" }),
        expect.objectContaining({
          kind: "requires",
          applicability: expect.objectContaining({
            any_of: [
              expect.objectContaining({
                all_of: [
                  expect.objectContaining({
                    values: [expect.objectContaining({ value: "separate_grant" })],
                  }),
                ],
              }),
            ],
          }),
        }),
      ]),
    });
    expect(
      pricing?.books.find(
        ({ scope }) =>
          scope.kind === "provider_resource" &&
          scope.resource_key === "self-hosted:llama/Llama-4-Maverick-17B-128E-Instruct:fp8",
      )?.offers[0],
    ).toMatchObject({
      states: [expect.objectContaining({ state: "externally_billed" })],
      settlement: [expect.objectContaining({ channel: "operator" })],
      relations: [expect.objectContaining({ kind: "exclusive_with" })],
    });
    expect(
      pricing?.books.find(({ book_key }) => book_key === "license-grant:llama4")?.offers[0],
    ).toMatchObject({
      states: [
        expect.objectContaining({
          state: "not_published",
          applicability: expect.objectContaining({
            any_of: [
              expect.objectContaining({
                all_of: [
                  expect.objectContaining({
                    values: [expect.objectContaining({ value: "separate_grant" })],
                  }),
                ],
              }),
            ],
          }),
        }),
      ],
      enrollment: [expect.objectContaining({ state: "account_scoped" })],
      settlement: [],
    });
    expect(
      pricing?.books.flatMap(({ offers }) =>
        offers.flatMap(({ terms }) =>
          terms.filter((term) => term.kind === "rate").map(({ meter }) => meter.value),
        ),
      ),
    ).not.toContain("tool_call");
  });

  it("isolates commercial and accounting drift and surfaces a new cost resource", async () => {
    const response = (await fixture("llama/chat_response.py")).replace(
      "metrics: Optional[List[Metric]]",
      "measurements: Optional[List[Metric]]",
    );
    const responseItems: PricingReconciliationItem[] = [];
    await expect(
      llamaCatalog({ "chat_response.py": response }, (item) => responseItems.push(item)),
    ).resolves.toHaveLength(12);
    expect(responseItems).toContainEqual(
      expect.objectContaining({
        reason_code: "chat_accounting_contract_drift",
        sample: "response metrics",
      }),
    );

    const launch = (await fixture("llama/llamacon.html")).replace(
      "limited free preview",
      "limited preview",
    );
    const launchItems: PricingReconciliationItem[] = [];
    await expect(
      llamaCatalog({ "llamacon.html": launch }, (item) => launchItems.push(item)),
    ).resolves.toHaveLength(12);
    expect(launchItems).toContainEqual(
      expect.objectContaining({ reason_code: "launch_terms_drift" }),
    );

    const license = (await fixture("llama/llama4-license.txt")).replace(
      "700 million",
      "800 million",
    );
    const licenseItems: PricingReconciliationItem[] = [];
    const licenseModels = await llamaCatalog({ "llama4-license.txt": license }, (item) =>
      licenseItems.push(item),
    );
    expect(licenseItems).toContainEqual({
      disposition: "unsupported",
      reason_code: "license_claim_unavailable",
      sample: "llama4",
    });
    expect(
      licenseModels
        .find(({ model_id }) => model_id === "Llama-4-Maverick-17B-128E-Instruct:fp8")
        ?.commercial_facts?.find(({ resource_kind }) => resource_kind === "distribution")
        ?.pricing_state,
    ).toBe("free");
    expect(
      licenseModels.some(({ commercial_facts }) =>
        commercial_facts?.some(({ book_key }) => book_key === "license-grant:llama4"),
      ),
    ).toBe(false);

    const policyItems: PricingReconciliationItem[] = [];
    const policyModels = await llamaCatalog(
      {
        "llama4-use-policy.md": (await fixture("llama/llama4-use-policy.md")).replace(
          "end users",
          "customers",
        ),
      },
      (item) => policyItems.push(item),
    );
    expect(policyItems).toContainEqual({
      disposition: "unsupported",
      reason_code: "use_policy_claim_unavailable",
      sample: "llama4",
    });
    expect(
      policyModels
        .find(({ model_id }) => model_id === "Llama-4-Maverick-17B-128E-Instruct:fp8")
        ?.commercial_facts?.find(({ resource_kind }) => resource_kind === "distribution")
        ?.raw_price_facts.some(({ term_key }) => term_key === "eu_multimodal_restriction"),
    ).toBe(false);

    const items: PricingReconciliationItem[] = [];
    await llamaCatalog(
      {
        "client.py": (await fixture("llama/client.py")).replace(
          "chat, models, uploads, moderations",
          "chat, models, uploads, moderations, usage",
        ),
      },
      (item) => items.push(item),
    );
    expect(items).toContainEqual({
      disposition: "unsupported",
      reason_code: "account_cost_api_unmodeled",
      sample: "usage",
    });
  });

  it("isolates generated model-list contract drift from the artifact catalog", async () => {
    const resource = await fixture("llama/models.py");
    await expect(
      llamaCatalog({
        "models.py": resource.replace(
          "extra_headers: Headers | None = None,\n        extra_query: Query | None = None,\n        extra_body: Body | None = None,",
          "extra_body: Body | None = None,\n        extra_query: Query | None = None,\n        extra_headers: Headers | None = None,",
        ),
        "llama_model.py": (await fixture("llama/llama_model.py")).replace(
          'Literal["model"]',
          "Literal['model']",
        ),
      }),
    ).resolves.toHaveLength(12);
    const paginationItems: PricingReconciliationItem[] = [];
    await expect(
      llamaCatalog(
        {
          "models.py": resource.replace(
            "extra_headers: Headers | None = None,",
            "after: str | None = None,\n        extra_headers: Headers | None = None,",
          ),
        },
        (item) => paginationItems.push(item),
      ),
    ).resolves.toHaveLength(12);
    expect(paginationItems).toContainEqual(
      expect.objectContaining({ reason_code: "model_inventory_contract_drift" }),
    );

    const model = await fixture("llama/llama_model.py");
    const modelItems: PricingReconciliationItem[] = [];
    await expect(
      llamaCatalog(
        {
          "llama_model.py": model.replace("owned_by: str", "updated: int\n\n    owned_by: str"),
        },
        (item) => modelItems.push(item),
      ),
    ).resolves.toHaveLength(12);
    expect(modelItems).toContainEqual(
      expect.objectContaining({ reason_code: "model_inventory_contract_drift" }),
    );

    const list = await fixture("llama/model_list_response.py");
    const listItems: PricingReconciliationItem[] = [];
    await expect(
      llamaCatalog(
        {
          "model_list_response.py": list.replace("List[LlamaModel]", "CursorPage[LlamaModel]"),
        },
        (item) => listItems.push(item),
      ),
    ).resolves.toHaveLength(12);
    expect(listItems).toContainEqual(
      expect.objectContaining({ reason_code: "model_inventory_contract_drift" }),
    );
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

    await expect(
      parsed("llama", "llama/api.json", "llama-api", (body) =>
        body.replace('"data":', '"next": "cursor", "data":'),
      ),
    ).rejects.toThrow();
    await expect(
      parsed("llama", "llama/api.json", "llama-api", (body) =>
        body.replace('"owned_by": "meta"', '"owned_by": "meta", "updated": 1'),
      ),
    ).rejects.toThrow();
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
            expect.objectContaining({ id: "llama-api-async-chat-example" }),
            expect.objectContaining({ id: "llama-api-client" }),
            expect.objectContaining({ id: "llama-api-models" }),
            expect.objectContaining({ id: "llama-api-model" }),
            expect.objectContaining({ id: "llama-api-model-list-response" }),
            expect.objectContaining({ id: "llama-api-chat-params" }),
            expect.objectContaining({ id: "llama-api-chat-response" }),
            expect.objectContaining({ id: "llama-api-chat-stream-response" }),
            expect.objectContaining({ id: "llama-api-moderation-response" }),
            expect.objectContaining({ id: "llama-api-chat-completions" }),
            expect.objectContaining({ id: "llama-api-moderations" }),
            expect.objectContaining({ id: "llama-3-release" }),
            expect.objectContaining({ id: "llama-3-1-release" }),
            expect.objectContaining({ id: "llama-3-2-release" }),
            expect.objectContaining({ id: "llama-protections-release" }),
            expect.objectContaining({ id: "llama-api-launch" }),
            ...["llama-2", "llama-3", "llama-3-1", "llama-3-2", "llama-3-3", "llama-4"].map((id) =>
              expect.objectContaining({ id: `${id}-license`, optional: true }),
            ),
            expect.objectContaining({ id: "llama-3-2-use-policy", optional: true }),
            expect.objectContaining({ id: "llama-4-use-policy", optional: true }),
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

  it("discovers Bedrock publisher indexes without widening the model-card policy", () => {
    const source = manifest("amazon-bedrock").sources[0];
    if (source?.linkedDocuments?.nestedIndexes === undefined)
      throw new Error("Missing Bedrock nested-index policy");
    const { nestedIndexes, ...crawl } = source.linkedDocuments;
    const indexes = linkedDocumentUrls("[OpenAI](model-cards-openai.md)", {
      ...source,
      linkedDocuments: {
        ...crawl,
        path: nestedIndexes.path,
        minDocuments: 1,
        maxDocuments: 1,
      },
    });
    const cards = linkedDocumentUrls("[GPT-5.6 Sol](model-card-openai-gpt-56-sol.md)", {
      ...source,
      linkedDocuments: { ...crawl, minDocuments: 1, maxDocuments: 1 },
    });
    expect(indexes.map((url) => url.pathname)).toEqual([
      "/bedrock/latest/userguide/model-cards-openai.md",
    ]);
    expect(cards.map((url) => url.pathname)).toEqual([
      "/bedrock/latest/userguide/model-card-openai-gpt-56-sol.md",
    ]);
  });

  it("discovers reviewed Markdown catalog links", () => {
    const source = manifest("openai").sources[0];
    if (source?.linkedDocuments === undefined) throw new Error("Missing OpenAI crawl policy");
    const urls = linkedDocumentUrls(
      "[GPT-5.4](/api/docs/models/gpt-5.4.md) [Pricing](/api/docs/pricing.md)",
      { ...source, linkedDocuments: { ...source.linkedDocuments, minDocuments: 1 } },
    );
    expect(urls.map((url) => url.pathname)).toEqual(["/api/docs/models/gpt-5.4.md"]);
  });

  it("keeps the Anthropic catalog on a fixed reviewed documentation bundle", async () => {
    const source = manifest("anthropic").sources[0];
    if (source?.linkedDocuments === undefined) throw new Error("Missing Anthropic link policy");
    const urls = linkedDocumentUrls(await fixture("anthropic/overview.md"), source);
    expect(urls).toEqual([]);
    expect({
      min: source.linkedDocuments.minDocuments,
      max: source.linkedDocuments.maxDocuments,
      reviewed: source.linkedDocuments.documents?.map(({ url }) => new URL(url).pathname),
    }).toMatchObject({
      min: 0,
      max: 0,
      reviewed: expect.arrayContaining([
        "/llms.txt",
        "/docs/en/about-claude/pricing.md",
        "/docs/en/about-claude/models/model-ids-and-versions.md",
        "/docs/en/manage-claude/usage-cost-api.md",
      ]),
    });
  });

  it("discovers bounded Foundry pricing families from Microsoft's pricing index", () => {
    const source = manifest("azure").sources.find(({ id }) => id === "azure-public-pricing");
    if (source?.linkedDocuments === undefined)
      throw new Error("Missing Azure pricing discovery policy");
    const families = linkedDocumentUrls(
      [
        '<a href="/en-us/pricing/details/ai-foundry-models/deepseek/">DeepSeek</a>',
        '<a href="/en-us/pricing/details/ai-foundry-models/new-publisher/">New publisher</a>',
        '<a href="/en-us/pricing/details/ai-foundry-models/aoai/">AOAI</a>',
        '<a href="/en-us/pricing/details/ai-foundry-models/fine-tuning-models/">Fine tuning</a>',
      ].join(""),
      {
        ...source,
        linkedDocuments: { ...source.linkedDocuments, minDocuments: 2, maxDocuments: 2 },
      },
    );
    expect(families.map((url) => url.pathname)).toEqual([
      "/en-us/pricing/details/ai-foundry-models/deepseek/",
      "/en-us/pricing/details/ai-foundry-models/new-publisher/",
    ]);
    expect(source.linkedDocuments.documents?.map(({ url }) => new URL(url).pathname)).toEqual(
      expect.arrayContaining([
        "/en-us/pricing/details/azure-openai/",
        "/en-us/pricing/details/ai-foundry-models/fine-tuning-models/",
        "/en-us/pricing/details/foundry-agent-service/",
        "/en-us/pricing/details/content-safety/",
        "/en-us/pricing/details/foundryobservability/",
        "/en-us/pricing/details/microsoft-foundry/",
      ]),
    );
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
        { name: "Batch", path: "v1/batch" },
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
        batch: true,
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
    expect(model?.pricing_state).toBe("unknown");
  });

  it("uses a numeric cached-input rate as positive prompt-cache evidence", async () => {
    const models = await parsed("openai", "openai/catalog.json", undefined, (body) => {
      const bundle = linkedBundle(body);
      const embedding = bundle.documents.find(({ url }) => url.includes("text-embedding-3-large"));
      if (embedding === undefined) throw new Error("Missing OpenAI model fixture");
      embedding.body += "\n\n| Cached input | $0.02 | 1M tokens |";
      return JSON.stringify(bundle);
    });
    expect(
      models.find(({ model_id }) => model_id === "text-embedding-3-large")?.capabilities
        .prompt_cache,
    ).toBe(true);
  });

  it("keeps card-local pricing in a separately replaceable HTML overlay", async () => {
    const catalog = await parsed("openai", "openai/catalog.json");
    const models = await openAiModelPricing("openai/pricing-catalog.json", catalog);
    const model = models.find((candidate) => candidate.model_id === "gpt-5.4");
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
    const model = (
      await openAiModelPricing("openai/batch-catalog.json", [
        openAiModel("o3", ["text_generation"]),
      ])
    )[0];
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
  });

  it("publishes an explicitly free hosted moderation offer as free", async () => {
    const value = manifest("openai");
    const pricingSource = value.sources.find(({ id }) => id === "openai-overview");
    if (pricingSource === undefined) throw new Error("Missing OpenAI model-card pricing source");
    const fixtureBundle = z
      .object({
        documents: z.array(z.object({ url: z.string(), body: z.string() })),
      })
      .parse(JSON.parse(await fixture("openai/pricing-catalog.json")));
    const template = fixtureBundle.documents.find(({ url }) =>
      url.endsWith("/text-embedding-3-large"),
    );
    if (template === undefined) throw new Error("Missing OpenAI model template");
    const body = JSON.stringify({
      index: {
        url: "https://developers.openai.com/api/docs/models/all",
        body: '<main><a href="/api/docs/models/omni-moderation-latest">Moderation</a></main>',
      },
      documents: [
        {
          url: "https://developers.openai.com/api/docs/models/omni-moderation-latest",
          body: template.body
            .replace(/<section><div>Pricing<\/div>.*?<\/section>/s, "")
            .replaceAll("text-embedding-3-large", "omni-moderation-latest")
            .replace(
              "Most capable embedding model",
              "free models designed to detect harmful content",
            )
            .replace("Embeddings</div><div>v1/embeddings", "Moderation</div><div>v1/moderations"),
        },
      ],
    });
    const [model] = parseSource({
      provider: provider(value),
      source: pricingSource,
      body,
      observedAt,
      catalogModels: [openAiModel("omni-moderation-latest", ["moderation"], "Moderation")],
    });
    expect(model).toMatchObject({
      model_id: "omni-moderation-latest",
      tasks: ["moderation"],
      pricing_state: "free",
      price_facts: [],
    });
  });

  it("extracts exact regional-processing model and endpoint support", async () => {
    const value = manifest("openai");
    const configured = value.sources.find(({ id }) => id === "openai-data-residency");
    if (configured === undefined || configured.extractor.kind !== "openai-data-residency")
      throw new Error("Missing OpenAI data-residency source");
    const source: SourceManifest = {
      ...configured,
      extractor: { kind: "openai-data-residency", minModels: 5, maxModels: 5 },
    };
    const models = parseSource({
      provider: provider(value),
      source,
      body: await fixture("openai/data-residency.md"),
      observedAt,
    });
    expect(models.find(({ model_id }) => model_id === "gpt-4o-2024-11-20")).toMatchObject({
      tasks: ["text_generation"],
      api_endpoints: [
        { name: "Chat Completions", path: "v1/chat/completions" },
        { name: "Responses", path: "v1/responses" },
      ],
      availability: [
        { region: "Europe (EEA + Switzerland)", deployment_type: "regional_processing" },
        { region: "United States", deployment_type: "regional_processing" },
      ],
    });
    expect(models.find(({ model_id }) => model_id === "gpt-5.2-2025-12-11")?.availability).toEqual([
      { region: "Europe (EEA + Switzerland)", deployment_type: "regional_processing" },
      { region: "United Arab Emirates", deployment_type: "regional_processing" },
      { region: "United States", deployment_type: "regional_processing" },
    ]);
    expect(models.find(({ model_id }) => model_id === "gpt-4o-tts")).toMatchObject({
      tasks: ["speech_synthesis"],
      api_endpoints: [{ name: "Speech generation", path: "v1/audio/speech" }],
    });
  });

  it("fills missing prices, adds service tiers, and rejects source conflicts", async () => {
    const value = manifest("openai");
    const configured = value.sources.find(({ id }) => id === "openai-pricing");
    if (configured === undefined || configured.extractor.kind !== "openai-pricing")
      throw new Error("Missing OpenAI pricing source");
    const source: SourceManifest = {
      ...configured,
      extractor: { kind: "openai-pricing", minModels: 5, maxModels: 5 },
    };
    const catalogSource = value.sources.find(({ id }) => id === "openai-models");
    if (catalogSource === undefined) throw new Error("Missing OpenAI catalog source");
    const catalog = parseSource({
      provider: provider(value),
      source: catalogSource,
      body: openAiCatalogFixture(await fixture("openai/catalog.json")),
      observedAt,
    });
    const pricingSource = value.sources.find(({ id }) => id === "openai-overview");
    if (pricingSource === undefined) throw new Error("Missing OpenAI model-card pricing source");
    const cardPricing = await openAiModelPricing("openai/pricing-catalog.json", catalog);
    const pricedCatalog = applyGroups(
      catalog,
      [{ source: pricingSource, models: cardPricing }],
      false,
    );
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
    const whisper = {
      ...baseModel({
        providerId: "openai",
        id: "whisper-1",
        name: "Whisper",
        sourceId: "openai-models",
        observedAt,
      }),
      tasks: ["transcription"],
    } satisfies ProviderModel;
    const pricingBody = await fixture("openai/pricing.md");
    const reconciliation: { disposition: string; reason_code: string }[] = [];
    const parsePricing = (body: string, reconcile = false) =>
      parseSource({
        provider: provider(value),
        source,
        body,
        observedAt,
        catalogModels: [...pricedCatalog, image, transcribe, tokenTranscribe, whisper],
        ...(reconcile ? { onPricingReconciliation: (item) => reconciliation.push(item) } : {}),
      });
    const models = parsePricing(pricingBody, true);
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
    expect(models.find(({ model_id }) => model_id === "whisper-1")?.price_facts).toEqual([
      expect.objectContaining({ meter: "input_audio", price: "0.006", unit: "minute" }),
    ]);
    expect(models.find(({ model_id }) => model_id === "gpt-5-search-api")).toMatchObject({
      tasks: ["text_generation"],
      pricing_state: "numeric",
      price_facts: expect.arrayContaining([
        expect.objectContaining({ meter: "input_text", price: "1.25" }),
        expect.objectContaining({ meter: "output_text", price: "10.00" }),
      ]),
    });
    expect(models.find(({ model_id }) => model_id === "omni-moderation-latest")).toMatchObject({
      tasks: ["moderation"],
      pricing_state: "free",
      price_facts: [],
    });
    expect(reconciliation).toContainEqual({
      disposition: "normalized",
      reason_code: "provider_service_pricing_bound",
      sample: "File search",
    });
    expect(reconciliation).toContainEqual({
      disposition: "normalized",
      reason_code: "fine_tuning_pricing_bound",
      sample: "gpt-4.1-2025-04-14",
    });
    const commercial = models.flatMap(({ commercial_facts }) => commercial_facts ?? []);
    expect(commercial).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_ref: "openai-pricing",
          resource_kind: "service",
          resource_key: "file-search",
          price_facts: [expect.objectContaining({ meter: "file_search" })],
        }),
        expect.objectContaining({
          source_ref: "openai-pricing",
          resource_kind: "service",
          resource_key: "fine-tuning:gpt-4.1-2025-04-14",
        }),
        expect.objectContaining({
          source_ref: "openai-pricing",
          resource_kind: "account_resource_template",
          resource_key: "fine-tuned-model:gpt-4.1-2025-04-14",
        }),
        expect.objectContaining({
          resource_key: "containers",
          price_facts: expect.arrayContaining([
            expect.objectContaining({
              meter: "container_runtime",
              unit: "container_session",
              conditions: { capacity: "64 GiB" },
            }),
          ]),
        }),
        expect.objectContaining({
          resource_key: "vector-store-storage",
          price_facts: [expect.objectContaining({ meter: "storage", unit: "gigabyte_day" })],
          raw_price_facts: [expect.objectContaining({ impact: "allowance" })],
        }),
        expect.objectContaining({
          resource_key: "chatkit-storage",
          price_facts: [expect.objectContaining({ meter: "storage", unit: "gigabyte_day" })],
        }),
        expect.objectContaining({
          resource_key: "fine-tuning:o4-mini-2025-04-16",
          price_facts: [expect.objectContaining({ meter: "training_compute", unit: "unit_hour" })],
        }),
      ]),
    );
    expect(
      commercial
        .filter(({ resource_key }) => resource_key === "web-search")
        .flatMap(({ price_facts }) => price_facts)
        .map(({ conditions }) => conditions.operation),
    ).toEqual(["search", "image", "preview_reasoning", "preview_non_reasoning"]);
    expect(models.some(({ model_id }) => model_id === "gpt-4o-transcribe")).toBe(false);
    expect(() => parsePricing(pricingBody.replace("$5.00", "$5.01"))).toThrow(
      "OpenAI pricing sources disagree for gpt-5.4",
    );
  });

  it("keeps an explicitly priced snapshot separate from a card alias", () => {
    const value = manifest("openai");
    const configured = value.sources.find(({ id }) => id === "openai-pricing");
    if (configured === undefined || configured.extractor.kind !== "openai-pricing")
      throw new Error("Missing OpenAI pricing source");
    const source: SourceManifest = {
      ...configured,
      extractor: { kind: "openai-pricing", minModels: 1, maxModels: 1 },
    };
    const card = {
      ...openAiModel("gpt-4o", ["text_generation"], "GPT-4o"),
      aliases: ["gpt-4o-2024-05-13"],
      pricing_state: "numeric",
      price_facts: [
        publishedRate("input_text", "2.50", "million_tokens", "openai-overview", "per 1M tokens", {
          service_tier: "standard",
        }),
      ],
    } satisfies ProviderModel;
    const models = parseSource({
      provider: provider(value),
      source,
      body: [
        "Flagship models",
        "Standard",
        "| Model | Short context input | Short context output |",
        "| --- | --- | --- |",
        "| gpt-4o-2024-05-13 | $5.00 | $15.00 |",
      ].join("\n"),
      observedAt,
      catalogModels: [card],
    });
    expect(models).toEqual([
      expect.objectContaining({
        model_id: "gpt-4o-2024-05-13",
        pricing_state: "numeric",
        price_facts: expect.arrayContaining([
          expect.objectContaining({ meter: "input_text", price: "5.00" }),
        ]),
      }),
    ]);
  });

  it("binds Realtime translation duration to audio input", async () => {
    const models = await openAiModelPricing("openai/realtime-translation-catalog.json", [
      openAiModel("gpt-realtime-translate", ["translation"]),
      openAiModel("gpt-transcribe", ["transcription"]),
    ]);
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

  it("preserves model facts and signals an unreviewed endpoint card", async () => {
    const value = manifest("openai");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing OpenAI catalog source");
    const body = openAiCatalogFixture(await fixture("openai/catalog.json")).replace(
      "v1/chat/completions",
      "v1/conversations",
    );
    let finding: SourceContractEvidence | undefined;
    const models = parseSource({
      provider: provider(value),
      source,
      body,
      observedAt,
      onContractFinding: (value) => {
        finding = value;
      },
    });
    expect(models).not.toHaveLength(0);
    expect(finding).toMatchObject({ disposition: "accept_with_signal" });
  });

  it("turns a newly indexed commercial page into a review signal", async () => {
    const value = manifest("openai");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing OpenAI catalog source");
    const bundle = linkedBundle(openAiCatalogFixture(await fixture("openai/catalog.json")));
    const index = bundle.documents.find(({ url }) => url.endsWith("/api/docs/llms.txt"));
    if (index === undefined) throw new Error("Missing OpenAI documentation index fixture");
    index.body +=
      "\n- [New usage surface](https://developers.openai.com/api/docs/guides/usage-ledger.md)";
    let finding: SourceContractEvidence | undefined;
    expect(
      parseSource({
        provider: provider(value),
        source,
        body: JSON.stringify(bundle),
        observedAt,
        onContractFinding: (value) => {
          finding = value;
        },
      }),
    ).not.toHaveLength(0);
    expect(finding).toMatchObject({ disposition: "accept_with_signal" });
  });

  it("signals organization usage drift without rejecting model facts", async () => {
    const value = manifest("openai");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing OpenAI catalog source");
    const bundle = linkedBundle(openAiCatalogFixture(await fixture("openai/catalog.json")));
    const openapi = bundle.documents.find(({ url }) => url.endsWith("/openapi.yaml"));
    if (openapi === undefined) throw new Error("Missing OpenAI OpenAPI fixture");
    openapi.body += "\n  /organization/usage/new_meter:\n    get: {}";
    let finding: SourceContractEvidence | undefined;
    expect(
      parseSource({
        provider: provider(value),
        source,
        body: JSON.stringify(bundle),
        observedAt,
        onContractFinding: (value) => {
          finding = value;
        },
      }),
    ).not.toHaveLength(0);
    expect(finding).toMatchObject({ disposition: "accept_with_signal" });
  });

  it("parses scoped API inventory without treating it as the global catalog", async () => {
    const models = await parsed("openai", "openai/api.json", "openai-api");
    expect(models.map((model) => model.model_id)).toEqual(["gpt-5.4", "ft:gpt-5.4:example"]);
  });

  it("keeps an explicit routed alias inside its matching Markdown card", async () => {
    const body = openAiCatalogFixture(await fixture("openai/catalog.json")).replace(
      "GPT-5.4 is a professional reasoning model.",
      "GPT-5.4 is a professional reasoning model. The `gpt-5.4-latest` alias routes requests to GPT-5.4.",
    );
    const value = manifest("openai");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing OpenAI catalog source");
    const models = parseSource({ provider: provider(value), source, body, observedAt });
    expect(models.find(({ model_id }) => model_id === "gpt-5.4")?.aliases).toEqual([
      "gpt-5.4-2026-03-05",
      "gpt-5.4-latest",
    ]);
  });

  it("parses lifecycle dates and replacements from deprecation tables", async () => {
    const models = await parsed("openai", "openai/deprecations.md", "openai-deprecations");
    expect(
      models.map(({ model_id, status, retired_at, replacement_model_ids }) => ({
        model_id,
        status,
        retired_at,
        replacement_model_ids,
      })),
    ).toEqual([
      {
        model_id: "gpt-4o-2024-05-13",
        status: "deprecated",
        retired_at: "2026-10-23",
        replacement_model_ids: ["gpt-5.6-sol"],
      },
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

    const value = manifest("openai");
    const lifecycleSource = value.sources.find(({ id }) => id === "openai-deprecations");
    if (lifecycleSource === undefined) throw new Error("Missing OpenAI lifecycle source");
    const current = baseModel({
      providerId: "openai",
      id: "gpt-5.4",
      name: "GPT-5.4",
      sourceId: "openai-models",
      observedAt,
    });
    const bounded = parseSource({
      provider: provider(value),
      source: lifecycleSource,
      body: await fixture("openai/deprecations.md"),
      observedAt,
      catalogModels: [current],
    });
    expect(bounded.map(({ model_id }) => model_id)).toEqual(["gpt-4o-2024-05-13", "gpt-5.4"]);
    expect(bounded.find(({ model_id }) => model_id === "gpt-5.4")?.aliases).toEqual([
      "gpt-5.4-completions",
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
    const claude = models.find((candidate) => candidate.uid === "azure/claude-opus-4-8");
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
      claude: [claude?.tasks, claude?.modalities, claude?.availability],
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
      claude: [
        ["text_generation"],
        { input: ["text", "image"], output: ["text"] },
        [{ region: "US", deployment_type: "DataZoneStandard" }],
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

  it("rejects drift in the reviewed accounting boundaries", async () => {
    const caching = (await fixture("azure/prompt-caching.md")).replace(
      "`cache_write_tokens`",
      "`written_tokens`",
    );
    await expect(
      azureCatalog(undefined, undefined, { "prompt-caching.md": caching }),
    ).rejects.toThrow("Azure OpenAI cache accounting contract drifted");
  });

  it("supplements documented identities from the public Foundry portal without widening scope", async () => {
    const value = manifest("azure");
    const source = azurePortalSource(2, 2);
    const documented = {
      ...azurePricingModel("gpt-multi", "2026-01-01"),
      limits: { max_output_tokens: 128_000 },
      status: "deprecated",
      release_stage: "stable",
      deprecated_at: "2026-06-01",
    } satisfies ProviderModel;
    const catalogModels = [documented, azurePricingModel("gpt-multi", "2026-02-01")];
    const models = parseSource({
      provider: provider(value),
      source,
      body: await fixture("azure/portal-models.json"),
      observedAt,
      catalogModels,
    });
    const exact = models.find(({ version }) => version === "2026-01-01");
    const newVersion = models.find(({ version }) => version === "2026-03-01");
    expect(models.map(({ uid }) => uid)).toEqual([
      "azure/gpt-multi@2026-01-01",
      "azure/gpt-multi@2026-03-01",
    ]);
    expect(exact).toMatchObject({
      name: "GPT Multi",
      description: "A portal-enriched multimodal model.",
      service_families: ["Azure OpenAI"],
      tasks: ["text_generation"],
      modalities: { input: ["text", "image"], output: ["text"] },
      capabilities: {
        reasoning: true,
        tool_call: true,
        streaming: true,
        batch: true,
      },
      limits: {
        context_tokens: 256_000,
        max_input_tokens: 240_000,
        max_output_tokens: 16_000,
      },
      status: "unknown",
      release_stage: "unknown",
      availability: [
        { region: "eastus", deployment_type: "DataZoneStandard" },
        { region: "eastus", deployment_type: "GlobalStandard" },
        { region: "westus3", deployment_type: "GlobalStandard" },
      ],
    });
    expect(newVersion).toMatchObject({
      name: "GPT Multi Preview",
      service_families: ["Azure OpenAI"],
      status: "active",
      release_stage: "preview",
      capabilities: { tool_call: false, batch: false },
    });
    expect(models.some(({ model_id }) => model_id === "portal-only")).toBe(false);
    const merged = applySupplementGroups(catalogModels, [{ source, models }]);
    expect(merged.map(({ uid }) => uid)).toEqual([
      "azure/gpt-multi@2026-01-01",
      "azure/gpt-multi@2026-02-01",
      "azure/gpt-multi@2026-03-01",
    ]);
    expect(merged.find(({ version }) => version === "2026-01-01")).toMatchObject({
      limits: {
        context_tokens: 256_000,
        max_input_tokens: 240_000,
        max_output_tokens: 128_000,
      },
      status: "deprecated",
      release_stage: "stable",
      deprecated_at: "2026-06-01",
    });
  });

  it("fails closed when the portal publishes an unreviewed inference task", async () => {
    const value = manifest("azure");
    const body = (await fixture("azure/portal-models.json")).replace(
      '"chat-completion", "responses"',
      '"future-inference-task", "responses"',
    );
    expect(() =>
      parseSource({
        provider: provider(value),
        source: azurePortalSource(2, 2),
        body,
        observedAt,
        catalogModels: [azurePricingModel("gpt-multi", "2026-01-01")],
      }),
    ).toThrow("contract mismatch");
  });

  it("bounds the anonymous portal request as a non-exhaustive supplement", () => {
    const source = azurePortalSource(50, 150);
    expect(source).toMatchObject({
      type: "api",
      source: ["api", "website"],
      access: "public",
      stability: "undocumented",
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
        pageSize: 50,
        maxPages: 5,
        maxModels: 250,
        registries: expect.arrayContaining(["azure-openai", "azureml", "azureml-cohere"]),
      },
    });
    expect(source.optional).toBeUndefined();
  });

  it("parses the scoped ARM inventory and exact billing-meter price join", async () => {
    const reconciliation: PricingReconciliationItem[] = [];
    const model = azureApiModels(await fixture("azure/api.json"), reconciliation)[0];
    expect({
      uid: model?.uid,
      description: model?.description,
      tasks: model?.tasks,
      capabilities: model?.capabilities,
      context: model?.limits.context_tokens,
      status: model?.status,
      retiredAt: model?.retired_at,
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
      retiredAt: "2027-01-01",
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
        source_locator: {
          kind: "meter",
          value: "11111111-1111-1111-1111-111111111111",
        },
        derived: false,
        raw_price: "1.25",
        raw_unit: "1M Tokens",
        raw_validity: "2026-01-01T00:00:00Z",
      },
      imagePrice: undefined,
      scope: "runtime_observation",
    });
    expect(reconciliation).toEqual([
      { disposition: "normalized", reason_code: "arm_direct_meter_bound" },
      {
        disposition: "unbound",
        reason_code: "arm_meter_missing",
        sample: "gpt-multi@2026-01-01 / GlobalStandard / Image Input Tokens",
      },
    ]);
    await expect(parsed("azure", "azure/broken-api.json", "azure-api")).rejects.toThrow(
      "contract mismatch",
    );
  });

  it("merges exact ARM model identities across discovered locations", async () => {
    const bundle = await azureApiFixture();
    const eastus = bundle.regions[0];
    if (eastus === undefined) throw new Error("Missing fixture region");
    const westus = z
      .object({
        kind: z.string().optional(),
        model: z
          .object({
            lifecycleStatus: z.string().optional(),
            capabilities: z.record(z.string(), z.string()),
          })
          .passthrough(),
      })
      .passthrough()
      .parse(structuredClone(eastus.models[0]));
    westus.kind = "Embedding";
    westus.model.lifecycleStatus = "Preview";
    westus.model.capabilities.streaming = "false";
    bundle.regions.push({ location: "westus3", models: [westus] });
    const models = azureApiModels(JSON.stringify(bundle));
    expect(models).toHaveLength(1);
    expect(models[0]?.availability).toEqual([
      { region: "eastus", deployment_type: "GlobalStandard" },
      { region: "westus3", deployment_type: "GlobalStandard" },
    ]);
    expect(models[0]?.price_facts).toHaveLength(1);
    expect(models[0]).toMatchObject({
      tasks: ["text_generation", "embeddings"],
      status: "active",
      release_stage: "unknown",
      capabilities: { streaming: "unknown" },
    });
  });

  it("treats null ARM capabilities as unknown without dropping the model", async () => {
    const body = (await fixture("azure/api.json")).replace(
      '"streaming": "true"',
      '"streaming": null',
    );
    const model = azureApiModels(body)[0];
    expect(model).toMatchObject({
      uid: "azure/gpt-multi@2026-01-01",
      capabilities: { streaming: "unknown", structured_output: true },
    });
  });

  it("normalizes the live ARM embedding TotalToken meter shape", () => {
    const model = azureApiModels(
      JSON.stringify({
        regions: [
          {
            location: "eastus",
            models: [
              {
                kind: "OpenAI",
                model: {
                  name: "text-embedding-3-small",
                  version: "1",
                  skus: [
                    {
                      name: "Standard",
                      costs: [
                        {
                          name: "TotalToken",
                          meterId: "embedding-meter",
                          unit: "1K Tokens",
                        },
                      ],
                    },
                  ],
                },
              },
            ],
          },
        ],
        prices: [
          {
            currencyCode: "USD",
            retailPrice: 0.02,
            armRegionName: "eastus",
            meterId: "embedding-meter",
            meterName: "Tokens",
            productName: "Foundry Models text-embedding-3-small",
            skuName: "Standard",
            serviceName: "Foundry Models",
            unitOfMeasure: "1K Tokens",
          },
        ],
      }),
    )[0];
    expect(model).toMatchObject({
      uid: "azure/text-embedding-3-small@1",
      tasks: ["embeddings"],
      price_facts: [
        expect.objectContaining({ meter: "embedding", unit: "thousand_tokens", price: "0.02" }),
      ],
    });
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

  it("uses public Microsoft price pages at their published version scope", async () => {
    const value = manifest("azure");
    const source = azurePublicPricingSource(2, 2);
    const llama = (version?: string): ProviderModel => ({
      ...azurePricingModel("Llama-3.3-70B-Instruct", version),
      service_families: ["Foundry Models sold by Azure"],
    });
    const catalogModels = [
      azurePricingModel("gpt-4o", "2024-05-13"),
      azurePricingModel("gpt-4o", "2024-08-06"),
      llama(),
      llama("1"),
      llama("2"),
    ];
    const reconciliation: PricingReconciliationItem[] = [];
    const models = parseSource({
      provider: provider(value),
      source,
      body: JSON.stringify({
        index: {
          url: "https://azure.microsoft.com/en-us/pricing/details/azure-openai/",
          body: await fixture("azure/public-openai-pricing.html"),
        },
        documents: [
          {
            url: "https://azure.microsoft.com/en-us/pricing/details/ai-foundry-models/llama/",
            body: await fixture("azure/public-llama-pricing.html"),
          },
        ],
      }),
      observedAt,
      catalogModels,
      onPricingReconciliation: (item) => reconciliation.push(item),
    });
    const gpt = models.find(({ model_id }) => model_id === "gpt-4o");
    const llamaPrice = models.find(({ model_id }) => model_id === "Llama-3.3-70B-Instruct");
    expect(models.map(({ uid }) => uid)).toEqual([
      "azure/gpt-4o@2024-08-06",
      "azure/Llama-3.3-70B-Instruct",
    ]);
    expect(gpt?.price_facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          meter: "input_text",
          price: "2.5",
          unit: "million_tokens",
          conditions: {
            region: "eastus",
            deployment_scope: "GlobalStandard",
          },
        }),
        expect.objectContaining({ meter: "cache_read_text", price: "1.25" }),
        expect.objectContaining({ meter: "output_text", price: "10" }),
      ]),
    );
    expect(gpt?.price_facts).toHaveLength(6);
    expect(llamaPrice?.price_facts).toHaveLength(4);
    expect(reconciliation).toEqual(
      Array.from({ length: 5 }, () => ({
        disposition: "normalized",
        reason_code: "public_price_bound",
      })),
    );
  });

  it("accepts a newly linked Foundry pricing family without widening identity matching", async () => {
    const value = manifest("azure");
    const source = azurePublicPricingSource(1, 1);
    const llama: ProviderModel = {
      ...azurePricingModel("Llama-3.3-70B-Instruct"),
      service_families: ["Foundry Models sold by Azure"],
    };
    const models = parseSource({
      provider: provider(value),
      source,
      body: JSON.stringify({
        index: {
          url: "https://azure.microsoft.com/en-us/pricing/details/azure-openai/",
          body: await fixture("azure/public-openai-pricing.html"),
        },
        documents: [
          {
            url: "https://azure.microsoft.com/en-us/pricing/details/ai-foundry-models/new-publisher/",
            body: await fixture("azure/public-llama-pricing.html"),
          },
        ],
      }),
      observedAt,
      catalogModels: [llama, azurePricingModel("Llama-3.3-70B-Instruct")],
    });
    expect(models).toEqual([
      expect.objectContaining({
        uid: "azure/Llama-3.3-70B-Instruct",
        price_facts: expect.arrayContaining([
          expect.objectContaining({ meter: "input_text", unit: "million_tokens" }),
          expect.objectContaining({ meter: "output_text", unit: "million_tokens" }),
        ]),
      }),
    ]);
  });

  it("keeps Foundry services, capacity, fine-tuning, safety, evaluation, and plans separate", async () => {
    const value = manifest("azure");
    const source = azurePublicPricingSource(2, 2);
    const llama: ProviderModel = {
      ...azurePricingModel("Llama-3.3-70B-Instruct"),
      service_families: ["Foundry Models sold by Azure"],
    };
    const published = [azurePricingModel("gpt-4o", "2024-08-06"), llama];
    const commercialDocuments = [
      [
        "https://azure.microsoft.com/en-us/pricing/details/ai-foundry-models/llama/",
        "azure/public-llama-pricing.html",
      ],
      [
        "https://azure.microsoft.com/en-us/pricing/details/ai-foundry-models/fine-tuning-models/",
        "azure/commercial-fine-tuning.html",
      ],
      [
        "https://azure.microsoft.com/en-us/pricing/details/foundry-agent-service/",
        "azure/commercial-agent.html",
      ],
      [
        "https://azure.microsoft.com/en-us/pricing/details/content-safety/",
        "azure/commercial-safety.html",
      ],
      [
        "https://azure.microsoft.com/en-us/pricing/details/foundryobservability/",
        "azure/commercial-evaluation.html",
      ],
      [
        "https://azure.microsoft.com/en-us/pricing/details/microsoft-foundry/",
        "azure/commercial-foundry.html",
      ],
    ] satisfies [string, string][];
    const documents = await Promise.all(
      commercialDocuments.map(async ([url, path]) => ({ url, body: await fixture(path) })),
    );
    const models = parseSource({
      provider: provider(value),
      source,
      body: JSON.stringify({
        index: {
          url: "https://azure.microsoft.com/en-us/pricing/details/azure-openai/",
          body: await fixture("azure/commercial-openai-pricing.html"),
        },
        documents,
      }),
      observedAt,
      catalogModels: published,
    });
    const commercial = models.flatMap(({ commercial_facts }) => commercial_facts ?? []);
    const byResource = (key: string) =>
      commercial.filter(({ resource_key }) => resource_key === key);

    expect(commercial.map(({ resource_key }) => resource_key)).toEqual(
      expect.arrayContaining([
        "responses-file-search",
        "responses-file-search-storage",
        "responses-code-interpreter",
        "ptu-reservation:azure/gpt-4o@2024-08-06",
        "hosted-agent-runtime",
        "agent-file-search-storage",
        "agent-code-interpreter",
        "agent-web-search",
        "agent-custom-search",
        "managed-compute",
        "fine-tuning:llama-3-3-70b",
        "content-safety",
        "content-safety-disconnected",
        "ai-evaluation",
        "agent-prepurchase",
      ]),
    );
    expect(byResource("ptu-reservation:azure/gpt-4o@2024-08-06")).toHaveLength(2);
    expect(byResource("ptu-reservation:azure/gpt-4o@2024-08-06")[0]?.model_refs).toEqual([
      "azure/gpt-4o@2024-08-06",
    ]);
    expect(byResource("fine-tuning:llama-3-3-70b")[0]?.model_refs).toEqual([
      "azure/Llama-3.3-70B-Instruct",
    ]);
    for (const key of ["agent-web-search", "content-safety", "ai-evaluation", "agent-prepurchase"])
      expect(
        byResource(key).every(({ model_refs }) => model_refs.length === 0),
        key,
      ).toBe(true);
    expect(byResource("hosted-agent-runtime")[0]?.price_facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ meter: "compute", unit: "unit_hour", price: "0.0994" }),
        expect.objectContaining({ meter: "compute", unit: "unit_hour", price: "0.0118" }),
      ]),
    );
    expect(byResource("content-safety").map(({ pricing_state }) => pricing_state)).toEqual(
      expect.arrayContaining(["included", "numeric"]),
    );
    expect(byResource("ai-evaluation")[0]?.price_facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ meter: "evaluation", price: "20" }),
        expect.objectContaining({ meter: "evaluation", price: "60" }),
      ]),
    );
    expect(byResource("agent-prepurchase").map(({ offer_key }) => offer_key)).toEqual([
      "tier-1",
      "tier-2",
    ]);
    const pricing = assembleParsedProviderPricing(
      "azure",
      observedAt,
      [{ source, models }],
      published,
    );
    const webSearch = pricing?.books.find(
      ({ scope }) =>
        scope.kind === "provider_resource" && scope.resource_key === "agent-web-search",
    );
    expect(webSearch?.offers[0]).toMatchObject({
      settlement: [expect.objectContaining({ channel: "direct", biller: "Microsoft" })],
      terms: [
        expect.objectContaining({
          variants: [
            expect.objectContaining({
              charge_binding: expect.objectContaining({ aggregation: "result_item" }),
            }),
          ],
        }),
      ],
    });
    const plan = pricing?.books.find(
      ({ scope }) =>
        scope.kind === "provider_resource" && scope.resource_key === "agent-prepurchase",
    );
    expect(plan?.offers[0]).toMatchObject({
      enrollment: [expect.objectContaining({ state: "account_scoped" })],
      terms: [
        expect.objectContaining({
          variants: [
            expect.objectContaining({
              charge_binding: expect.objectContaining({ aggregation: "billing_period" }),
            }),
          ],
        }),
      ],
    });
    expect(plan?.scope.model_refs).toEqual([]);
  });

  it("normalizes official partner meters with provider-native billing units", () => {
    const value = manifest("azure");
    const partner = (id: string, tasks: ModelTask[], version?: string): ProviderModel => ({
      ...azurePricingModel(id, version),
      service_families: ["Foundry Models from partners and community"],
      tasks,
    });
    const row = (
      productName: string,
      skuName: string,
      meterName: string,
      unitOfMeasure: string,
      index: number,
    ) => ({
      currencyCode: "USD",
      retailPrice: index,
      armRegionName: "",
      effectiveStartDate: "2026-01-01T00:00:00Z",
      meterId: `20000000-0000-0000-0000-${String(index).padStart(12, "0")}`,
      meterName,
      productName,
      skuName,
      serviceName: "Foundry Models",
      unitOfMeasure,
      type: "Consumption",
    });
    const models = parseSource({
      provider: provider(value),
      source: azureRetailSource(5, 5, 1),
      body: JSON.stringify({
        prices: [
          row("Cohere Models", "Rerank v4 Pro Glbl", "Rerank v4 Pro Glbl Search", "1", 1),
          row("Cohere Models", "Embed v4 Txt Glbl", "Embed v4 Txt Glbl Tokens", "1M", 2),
          row("Azure Mistral Models", "OCR 4 glbl", "OCR 4 glbl Pages", "1", 3),
          row("Azure Deepseek Models", "V3.2 SP Inp DZ", "V3.2 SP Inp DZ Tokens", "1M", 4),
          row("Azure BFL Flux Models", "Flux 2 Pro Dzone", "Flux 2 Pro Dzone Megapixel", "1", 5),
        ],
      }),
      observedAt,
      catalogModels: [
        partner("Cohere-rerank-v4.0-pro", ["reranking"], "1"),
        partner("embed-v-4-0", ["embeddings"], "1"),
        partner("mistral-ocr-4-0", ["ocr"]),
        partner("DeepSeek-V3.2-Speciale", ["text_generation"], "1"),
        partner("FLUX.2-pro", ["image_generation"], "1"),
      ],
    });
    expect(
      models.map(({ uid, price_facts }) => [
        uid,
        price_facts.map(({ meter, unit }) => [meter, unit]),
      ]),
    ).toEqual([
      ["azure/Cohere-rerank-v4.0-pro@1", [["rerank_request", "search_unit"]]],
      ["azure/DeepSeek-V3.2-Speciale@1", [["input_text", "million_tokens"]]],
      ["azure/embed-v-4-0@1", [["embedding", "million_tokens"]]],
      ["azure/FLUX.2-pro@1", [["image_generation", "million_pixels"]]],
      ["azure/mistral-ocr-4-0", [["input_image", "page"]]],
    ]);
  });

  it("imports Claude's official Foundry price book and preserves private-offer uncertainty", async () => {
    const value = manifest("azure");
    const configured = value.sources.find(({ id }) => id === "azure-claude-pricing");
    if (configured === undefined || configured.extractor.kind !== "azure-claude-pricing")
      throw new Error("Missing Azure Claude pricing source");
    const source: SourceManifest = {
      ...configured,
      extractor: { kind: "azure-claude-pricing", minModels: 2, maxModels: 2 },
    };
    const claude = (id: string, dataZone = false): ProviderModel => ({
      ...azurePricingModel(id),
      service_families: ["Foundry Models from partners and community"],
      status: "active",
      ...(dataZone
        ? { availability: [{ region: "eastus2", deployment_type: "DataZoneStandard" }] }
        : {}),
    });
    const reconciliation: PricingReconciliationItem[] = [];
    const models = parseSource({
      provider: provider(value),
      source,
      body: await fixture("azure/claude-pricing.md"),
      observedAt,
      catalogModels: [claude("claude-opus-4-8", true), claude("claude-sonnet-5")],
      onPricingReconciliation: (item) => reconciliation.push(item),
    });
    const opus = models.find(({ model_id }) => model_id === "claude-opus-4-8");
    const sonnet = models.find(({ model_id }) => model_id === "claude-sonnet-5");
    expect(opus?.price_facts).toHaveLength(10);
    expect(
      opus?.price_facts.find(
        ({ meter, conditions }) =>
          meter === "input_text" && conditions.deployment_scope === "DataZoneStandard",
      ),
    ).toMatchObject({
      price: "5.5",
      derived: true,
      conditions: { inference_geo: "us" },
    });
    expect(sonnet?.price_facts).toHaveLength(10);
    expect(
      sonnet?.price_facts
        .filter(({ meter }) => meter === "input_text")
        .map(({ price, conditions }) => [
          price,
          conditions.effective_until,
          conditions.effective_from,
        ]),
    ).toEqual([
      ["2", "2026-08-31", undefined],
      ["3", undefined, "2026-09-01"],
    ]);
    expect(opus?.raw_price_facts).toEqual([
      expect.objectContaining({
        term_key: "azure_marketplace_private_offer_discount",
        reason: "unknown_amount",
        conditions: { account_eligibility: "azure_marketplace_private_offer" },
      }),
    ]);
    expect(reconciliation).toEqual([
      expect.objectContaining({
        disposition: "normalized",
        reason_code: "claude_public_rate_row",
        sample: "claude-opus-4-8",
      }),
      expect.objectContaining({ sample: "claude-sonnet-5" }),
      expect.objectContaining({ sample: "claude-sonnet-5" }),
      {
        disposition: "excluded",
        reason_code: "claude_price_model_not_offered",
        sample: "claude-opus-4",
      },
    ]);
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
    const reconciliation: { disposition: string; reason_code: string }[] = [];
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
        onPricingReconciliation: (item) => reconciliation.push(item),
      }),
    ).toEqual([]);
    expect(reconciliation).toEqual([
      {
        disposition: "ambiguous",
        reason_code: "retail_version_not_unique",
        sample: "Azure OpenAI Media / Sora 2 glbl / Sora 2 glbl Second",
      },
    ]);
  });

  it("classifies unmatched public retail rows without guessing a catalog binding", async () => {
    const value = manifest("azure");
    const body = await fixture("azure/retail-prices.json");
    const reconciliation: { disposition: string; reason_code: string }[] = [];
    const models = parseSource({
      provider: provider(value),
      source: azureRetailSource(3, 5, 0.8),
      body,
      observedAt,
      catalogModels: [
        azurePricingModel("gpt-4.1", "2025-04-14"),
        azurePricingModel("gpt-5.6-terra", "2026-07-09"),
        azurePricingModel("gpt-audio-1.5", "2026-02-23"),
        azurePricingModel("gpt-4o-mini-realtime-preview", "2024-12-17"),
        azurePricingModel("gpt-4o-mini-audio-preview", "2024-12-17"),
      ],
      onPricingReconciliation: (item) => reconciliation.push(item),
    });
    expect(models).toHaveLength(5);
    expect(reconciliation).toContainEqual({
      disposition: "excluded",
      reason_code: "non_base_consumption_row",
      sample: "Azure OpenAI / gpt-4.1-ft input global / gpt-4.1-ft input global Tokens",
    });
    expect(reconciliation).toContainEqual({
      disposition: "unbound",
      reason_code: "retail_identity_not_unique",
      sample: "Azure OpenAI GPT5 / GPT 5.2 pro inp Gl / GPT 5.2 pro inp Gl 1M Tokens",
    });
    expect(reconciliation).toContainEqual({
      disposition: "unbound",
      reason_code: "retail_identity_not_unique",
      sample: "Azure OpenAI / Unknown Inp glbl / Unknown Inp glbl Tokens",
    });
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

  it("treats an effective inference retirement date as retired despite stale lifecycle labels", async () => {
    const value = manifest("azure");
    const source = value.sources.find((candidate) => candidate.id === "azure-api");
    if (source === undefined) throw new Error("Missing Azure API source");
    const body = (await fixture("azure/api.json")).replace(
      "2027-01-01T00:00:00Z",
      "2026-07-01T00:00:00Z",
    );
    const apiModel = parseSource({ provider: provider(value), source, body, observedAt })[0];
    expect(apiModel).toMatchObject({ status: "retired", retired_at: "2026-07-01" });

    const lifecycle = (await fixture("azure/lifecycle.md")).replace(
      "| gpt-multi    | 2026-01-01 | GA        | 2027-01-01",
      "| gpt-multi    | 2026-01-01 | GA        | 2026-07-01",
    );
    expect(
      (await azureCatalog(undefined, lifecycle)).find(
        (candidate) => candidate.uid === "azure/gpt-multi@2026-01-01",
      ),
    ).toMatchObject({ status: "retired", retired_at: "2026-07-01" });
  });
});

describe("Gemini adapters", () => {
  it("pins the machine-readable API contract and paginates authenticated inventory", () => {
    const value = manifest("gemini");
    const catalog = value.sources.find(({ id }) => id === "gemini-models");
    const inventory = value.sources.find(({ id }) => id === "gemini-api");
    expect(catalog?.linkedDocuments?.documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "discovery",
          url: "https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta",
          format: "json",
        }),
        expect.objectContaining({
          id: "cloud-sku-group",
          url: "https://cloud.google.com/skus/sku-groups/google-developer-program-premium-genai-credit",
        }),
      ]),
    );
    expect(inventory).toMatchObject({
      url: "https://generativelanguage.googleapis.com/v1beta/models",
      transport: { kind: "gemini-models", pageSize: 1000, maxPages: 5, maxModels: 5_000 },
    });
  });

  it("joins labeled model pages, lifecycle, changelog, and pricing", async () => {
    const models = await geminiCatalog();
    const model = models.find((item) => item.model_id === "gemini-test-preview");
    const commercial = models.flatMap(({ commercial_facts }) => commercial_facts ?? []);
    const search = commercial.find(
      (fact) =>
        fact.resource_key === "google-search" && fact.offer_key === `grounding:${model?.uid}`,
    );
    const storage = commercial.find(
      (fact) =>
        fact.resource_key === "explicit-cache-storage" &&
        fact.offer_key === `storage:${model?.uid}`,
    );
    const searchAllowance = commercial.find(
      (fact) => fact.resource_key === "google-search" && fact.offer_key === "shared-allowance",
    );
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
      searchUnit: search?.price_facts.find((rate) => rate.meter === "web_search")?.unit,
      searchAllowance: searchAllowance?.raw_price_facts.find(
        (fact) => fact.term_key === "google_search_allowance",
      ),
      cached: model?.price_facts.find((rate) => rate.meter === "cache_read_text")?.price,
      storage: storage?.price_facts.find((rate) => rate.meter === "cache_storage")?.unit,
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
        reason: "unknown_applicability",
        raw: expect.objectContaining({
          fragment: expect.stringContaining("shared across all Gemini 3.x models"),
        }),
      }),
      cached: "0.15",
      storage: "million_tokens_per_hour",
    });
  });

  it("uses generation-specific grounding units and reconciles every pricing claim", async () => {
    const reconciliation: PricingReconciliationItem[] = [];
    const models = await geminiCatalog({}, (item) => reconciliation.push(item));
    const legacy = models.find((model) => model.model_id === "gemini-test-preview");
    const current = models.find((model) => model.model_id === "gemini-3-test-preview");
    const commercial = models.flatMap(({ commercial_facts }) => commercial_facts ?? []);
    const groundingUnit = (modelRef: string | undefined) =>
      commercial
        .find(
          (fact) =>
            fact.resource_key === "google-search" &&
            fact.offer_key === `grounding:${modelRef ?? ""}`,
        )
        ?.price_facts.find((fact) => fact.meter === "web_search")?.unit;
    const maps = commercial.find(
      (fact) =>
        fact.resource_key === "google-maps" && fact.offer_key === `grounding:${current?.uid}`,
    );
    expect({
      legacy: groundingUnit(legacy?.uid),
      current: groundingUnit(current?.uid),
      maps: maps?.price_facts.find((fact) => fact.meter === "maps_search")?.unit,
      reconciliation: dispositionCounts(reconciliation, [
        "normalized",
        "raw",
        "explicit_non_numeric",
        "excluded",
      ]),
    }).toEqual({
      legacy: "thousand_requests",
      current: "thousand_search_units",
      maps: "thousand_search_units",
      reconciliation: {
        normalized: 37,
        raw: 5,
        explicit_non_numeric: 9,
        excluded: 0,
      },
    });
  });

  it("keeps File Search policy separate from model and tool rates", async () => {
    const facts = (await geminiCatalog())
      .flatMap(({ commercial_facts }) => commercial_facts ?? [])
      .filter((fact) => fact.resource_key === "file-search-store")
      .sort((left, right) => left.offer_key.localeCompare(right.offer_key));
    expect(
      facts.map(({ offer_key, pricing_state, model_refs, raw_price_facts }) => ({
        offerKey: offer_key,
        pricingState: pricing_state,
        modelRefs: model_refs,
        rawReason: raw_price_facts[0]?.reason,
      })),
    ).toEqual([
      {
        offerKey: "indexing",
        pricingState: "numeric",
        modelRefs: [],
        rawReason: "requires_usage_aggregation",
      },
      {
        offerKey: "query-embedding",
        pricingState: "free",
        modelRefs: [],
        rawReason: undefined,
      },
      {
        offerKey: "retrieval",
        pricingState: "numeric",
        modelRefs: expect.arrayContaining([
          "gemini/gemini-test-preview",
          "gemini/gemini-3-test-preview",
        ]),
        rawReason: "requires_usage_aggregation",
      },
      {
        offerKey: "storage",
        pricingState: "free",
        modelRefs: [],
        rawReason: undefined,
      },
    ]);
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
    const models = await geminiCatalog();
    const agent = models.find((model) => model.model_id === "deep-research-test");
    const execution = models
      .flatMap(({ commercial_facts }) => commercial_facts ?? [])
      .find((fact) => fact.resource_key === "agent:deep-research-test");
    const environment = models
      .flatMap(({ commercial_facts }) => commercial_facts ?? [])
      .find((fact) => fact.resource_key === "managed-agent-environment");
    expect(agent).toMatchObject({
      pricing_state: "unknown",
      price_facts: [],
      raw_price_facts: [],
    });
    expect(execution).toMatchObject({
      offer_key: "execution",
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
    expect(environment).toMatchObject({
      offer_key: "preview-environment",
      raw_price_facts: [
        expect.objectContaining({
          term_key: "preview-environment-compute",
          reason: "unknown_applicability",
          raw: {
            fragment: expect.stringContaining("not billed during the preview period"),
          },
        }),
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
        rates: 5,
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
    const discovery = await fixture("gemini/discovery.json");
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
        "discovery.json": discovery.replace(
          "v1beta/{+model}:generateContent",
          "v1beta/{+model}:generateContentV2",
        ),
      }),
    ).rejects.toThrow("Discovery model method changed");
  });

  it("rejects drift in fixed billing and usage-accounting evidence", async () => {
    const caching = (await fixture("gemini/caching.html")).replace(
      "enabled by default",
      "disabled by default",
    );
    await expect(geminiCatalog({ "caching.html": caching })).rejects.toThrow(
      "cache accounting contract drifted",
    );
    const billing = (await fixture("gemini/billing.html")).replace("more than 24", "at most one");
    await expect(geminiCatalog({ "billing.html": billing })).rejects.toThrow(
      "billing-account contract drifted",
    );
  });

  it("preserves pricing drift as bounded raw or unbound evidence", async () => {
    const pricing = await fixture("gemini/pricing.html");
    const reconciliation: PricingReconciliationItem[] = [];
    const unbound = await geminiCatalog(
      { "pricing.html": pricing.replace("gemini-test-preview", "gemini-unpublished") },
      (item) => reconciliation.push(item),
    );
    expect(unbound.some((model) => model.model_id === "gemini-3-test-preview")).toBe(true);
    expect(reconciliation).toContainEqual(
      expect.objectContaining({
        disposition: "unbound",
        reason_code: "pricing_model_unbound",
        sample: "gemini-unpublished",
      }),
    );

    const mystery = await geminiCatalog({
      "pricing.html": pricing.replace("Input price</td>", "Mystery price</td>"),
    });
    expect(
      mystery
        .find((model) => model.model_id === "gemini-test-preview")
        ?.raw_price_facts.find((fact) => fact.reason === "unknown_meter"),
    ).toMatchObject({ raw: { label: "Mystery price" } });

    const changedHeader = await geminiCatalog({
      "pricing.html": pricing.replace("Free Tier</th>", "Trial Tier</th>"),
    });
    expect(
      changedHeader
        .find((model) => model.model_id === "gemini-test-preview")
        ?.raw_price_facts.some((fact) => fact.reason === "unsupported_structure"),
    ).toBe(true);
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
      storageUnit: models
        .flatMap(({ commercial_facts }) => commercial_facts ?? [])
        .find(({ resource_key }) => resource_key === "explicit-cache-storage")?.price_facts[0]
        ?.unit,
      capacity: models
        .flatMap(({ commercial_facts }) => commercial_facts ?? [])
        .find(({ resource_key }) => resource_key === "provisioned-throughput")
        ?.price_facts.map(({ price, unit, conditions }) => [
          price,
          unit,
          conditions.deployment_scope,
          conditions.effective_from,
        ]),
      tuning: models
        .flatMap(({ commercial_facts }) => commercial_facts ?? [])
        .find(({ resource_key }) => resource_key === "model-tuning")
        ?.price_facts.map(({ price, unit, conditions }) => [price, unit, conditions.operation]),
      agent: models
        .flatMap(({ commercial_facts }) => commercial_facts ?? [])
        .find(({ resource_key }) => resource_key === "agent:gemini-deep-research-agent")
        ?.price_facts.map(({ meter, price }) => [meter, price]),
      agentGrounding: models
        .flatMap(({ commercial_facts }) => commercial_facts ?? [])
        .filter(({ offer_key }) => offer_key === "agent:gemini-deep-research-agent")
        .map(({ resource_key, price_facts }) => [resource_key, price_facts[0]?.price]),
      componentAgents: models
        .flatMap(({ commercial_facts }) => commercial_facts ?? [])
        .filter(({ resource_key }) => ["codemender", "alphaevolve"].includes(resource_key))
        .map(({ resource_key, price_facts, raw_price_facts }) => [
          resource_key,
          price_facts.map(({ meter, price }) => [meter, price]),
          raw_price_facts.map(({ raw }) => raw.amount),
        ]),
      optimizer: models
        .flatMap(({ commercial_facts }) => commercial_facts ?? [])
        .find(({ resource_key }) => resource_key === "model-optimizer")
        ?.raw_price_facts.map(({ term_key, impact, raw }) => [term_key, impact, raw.amount]),
      agentSearch: models
        .flatMap(({ commercial_facts }) => commercial_facts ?? [])
        .filter(({ resource_key }) => resource_key === "agent-search")
        .map(({ offer_key, price_facts, raw_price_facts }) => [
          offer_key,
          price_facts.map(({ meter, price }) => [meter, price]),
          raw_price_facts.map(({ raw }) => raw.amount),
        ]),
      retrievedGrounding: models
        .flatMap(({ commercial_facts }) => commercial_facts ?? [])
        .find(({ offer_key }) => offer_key === "own-retrieved-data")
        ?.price_facts.map(({ meter, price }) => [meter, price]),
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
      capacity: [
        ["1200", "unit_week", "global", undefined],
        ["1320", "unit_week", "non-global", "2026-07-01"],
        ["2700", "unit_month", "global", undefined],
        ["2970", "unit_month", "non-global", "2026-07-01"],
      ],
      tuning: [["10", "million_tokens", "supervised_fine_tuning"]],
      agent: [
        ["input_text", "2"],
        ["cache_read_text", "0.2"],
        ["output_text", "12"],
      ],
      agentGrounding: [
        ["google-search", "14"],
        ["web-grounding-enterprise", "14"],
        ["grounded-generation", "2.50"],
      ],
      componentAgents: [
        [
          "codemender",
          [
            ["input_text", "1"],
            ["cache_read_text", "0.1"],
            ["output_text", "4"],
          ],
          [],
        ],
        [
          "alphaevolve",
          [
            ["input_text", "2"],
            ["output_text", "8"],
          ],
          ["3", "12"],
        ],
      ],
      optimizer: [
        ["dynamic_model_price", "base_price", undefined],
        ["one_dollar_sku_purchasing_unit", "informational", "1"],
      ],
      agentSearch: [
        ["general-standard", [["retrieval", "1.50"]], ["10000"]],
        ["general-enterprise", [["retrieval", "4.00"]], ["10000"]],
        ["advanced-generative-answers", [["grounded_generation", "4.00"]], []],
      ],
      retrievedGrounding: [["grounded_generation", "2.50"]],
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
        2,
      ),
    ).rejects.toThrow("count_outside_bounds");
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
    ).toEqual([["17.50", "million_tokens"]]);
    expect(model?.raw_price_facts.filter(({ impact }) => impact === "base_price")).toEqual([
      expect.objectContaining({
        impact: "base_price",
        reason: "unknown_applicability",
        raw: expect.objectContaining({ fragment: expect.stringContaining("$0.003/page") }),
      }),
    ]);
    expect(model?.raw_price_facts.filter(({ impact }) => impact === "informational")).toEqual([
      expect.objectContaining({
        reason: "unsupported_structure",
        raw: expect.objectContaining({ fragment: expect.stringContaining("$0.10 / second") }),
      }),
    ]);
    const conflictingSkus = `
      <main><table>
        <tr><th>Service Name</th><th>SKU Name</th><th>SKU ID</th><th>Date Added</th></tr>
        <tr><td>Vertex AI (C7E2-9256-1C43)</td><td>Video output token count for Gemini Test</td><td>ABCD-1234-EF56</td><td>August 3, 2026</td></tr>
        <tr><td>Vertex AI (C7E2-9256-1C43)</td><td>Video output second count for Gemini Test</td><td>BCDE-2345-FA67</td><td>August 3, 2026</td></tr>
      </table></main>`;
    const unresolved = (
      await vertexCatalog({ "pricing.html": pricing, "skus.html": conflictingSkus })
    ).find(({ model_id }) => model_id === "gemini-test");
    expect(
      unresolved?.price_facts
        .filter(({ meter }) => meter === "output_video")
        .map(({ price, unit }) => [price, unit])
        .sort(),
    ).toEqual([
      ["0.10", "second"],
      ["17.50", "million_tokens"],
    ]);
  });

  it("resolves only document-verified Vertex pricing ambiguities", async () => {
    const card = (id: string, name: string, quota = "") => `
      <main><div class="devsite-article-body">
        <h1>${name}</h1>
        <table>
          <tr><th>Model ID</th><td><code>${id}</code></td></tr>
          <tr><th>Modalities</th><td>Inputs: Text Outputs: Text</td></tr>
          ${quota === "" ? "" : `<tr><th>Quota limits</th><td>${quota}</td></tr>`}
        </table>
      </div></main>`;
    const sonnetShort =
      "Input: $3.30 Output: $16.50 Batch Input: $1.65 Batch Output: $8.25 5m Cache Write: $4.13 1h Cache Write: $6.60 Cache Hit: $0.33 5m Batch Cache Write: $2.06 1h Batch Cache Write: $3.30 Batch Cache Hit: $0.17";
    const sonnetLong =
      "Input: $3.30 Output: $16.50 5m Cache Write: $4.13 1h Cache Write: $6.60 Cache Hit: $0.33";
    const pricing = `
      <main><div class="devsite-article-body">
        <h3>us-east5</h3>
        <table>
          <tr>
            <th>Model</th>
            <th>Price (/1M tokens) =&lt; 200K input tokens</th>
            <th>Price (/1M tokens) &gt; 200K input tokens</th>
          </tr>
          <tr>
            <td>Claude Haiku 4.5</td>
            <td>Input: $1.10 Output: $5.50 5m Cache Write: $1.375 1h Cache Write: $2.20 Cache Write: $1.375 Cache Hit: $0.11</td>
            <td>N/A</td>
          </tr>
          <tr>
            <td>Claude Sonnet 4.6</td>
            <td>${sonnetShort} Input: $6.60 Output: $24.75</td>
            <td>${sonnetLong}</td>
          </tr>
          <tr>
            <td>Claude Cache Ambiguous</td>
            <td>Input: $1.00 Output: $5.00 5m Cache Write: $1.25 1h Cache Write: $2.00 Cache Write: $1.50 Cache Hit: $0.10</td>
            <td>N/A</td>
          </tr>
        </table>
        <h3>europe-west1</h3>
        <table>
          <tr>
            <th>Model</th>
            <th>Price (/1M tokens) =&lt; 200K input tokens</th>
            <th>Price (/1M tokens) &gt; 200K input tokens</th>
          </tr>
          <tr><td>Claude Sonnet 4.6</td><td>${sonnetShort}</td><td>${sonnetLong}</td></tr>
        </table>
        <h3>asia-east1</h3>
        <table>
          <tr>
            <th>Model</th>
            <th>Price (/1M tokens) =&lt; 200K input tokens</th>
            <th>Price (/1M tokens) &gt; 200K input tokens</th>
          </tr>
          <tr><td>Claude Sonnet 4.6</td><td>${sonnetShort}</td><td>${sonnetLong}</td></tr>
        </table>
        <h3>Mistral AI's models</h3>
        <table>
          <tr><th>Model</th><th>Pricing</th></tr>
          <tr>
            <td>Mistral OCR (25.05)</td>
            <td>Input: $0.0005 / million tokens (or $0.0005/page) Output: $0.0005 / million tokens (or $0.0005/page)</td>
          </tr>
          <tr>
            <td>OCR Converted</td>
            <td>Input: $0.30 / million tokens (or $0.0003/page) Output: $1.20 / million tokens (or $0.00012/page)</td>
          </tr>
        </table>
        <h4>Pricing for tools</h4>
        <table>
          <tr><th>Tool</th><th>Price</th></tr>
          <tr><td>Web Search Request</td><td>$10 per 1000 searches</td></tr>
        </table>
      </div></main>`;
    const models = await vertexModels(
      1,
      [
        [
          "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/claude/claude-haiku-4-5",
          "haiku.html",
        ],
        [
          "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/claude/claude-sonnet-4-6",
          "sonnet.html",
        ],
        [
          "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/claude/claude-cache-ambiguous",
          "ambiguous.html",
        ],
        [
          "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/mistral/mistral-ocr",
          "mistral.html",
        ],
        [
          "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/mistral/ocr-converted",
          "converted.html",
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
        [
          "https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing",
          "pricing.html",
        ],
      ],
      {
        "haiku.html": card("claude-haiku-4-5", "Claude Haiku 4.5"),
        "sonnet.html": card("claude-sonnet-4-6", "Claude Sonnet 4.6"),
        "ambiguous.html": card("claude-cache-ambiguous", "Claude Cache Ambiguous"),
        "mistral.html": card(
          "mistral-ocr-2505",
          "Mistral OCR (25.05)",
          "Pages per request: 30 (1 page = 1 million input tokens and 1 million output tokens)",
        ),
        "converted.html": card(
          "ocr-converted",
          "OCR Converted",
          "Pages per request: 30 (1 page = 1 thousand input tokens and 100 output tokens)",
        ),
        "pricing.html": pricing,
      },
    );
    const byId = new Map(models.map((model) => [model.model_id, model]));
    expect(byId.get("claude-haiku-4-5")?.raw_price_facts).toEqual([]);
    expect(
      byId
        .get("claude-haiku-4-5")
        ?.price_facts.filter(({ meter }) => meter === "cache_write_text")
        .map(({ price, conditions }) => [price, conditions.cache_ttl_seconds]),
    ).toEqual([
      ["1.375", 300],
      ["2.20", 3600],
    ]);
    expect(
      byId
        .get("claude-sonnet-4-6")
        ?.raw_price_facts.filter(({ impact }) => impact === "base_price"),
    ).toEqual([]);
    expect(
      byId
        .get("claude-sonnet-4-6")
        ?.raw_price_facts.filter(({ impact }) => impact === "informational"),
    ).toEqual([
      expect.objectContaining({
        reason: "unsupported_structure",
        raw: expect.objectContaining({ fragment: "Input: $6.60 Output: $24.75" }),
      }),
    ]);
    expect(
      byId
        .get("claude-sonnet-4-6")
        ?.price_facts.filter(
          ({ meter, conditions }) =>
            (meter === "input_text" || meter === "output_text") &&
            conditions.service_tier === undefined &&
            conditions.region === "us-east5",
        )
        .map(({ meter, price, conditions }) => [
          meter,
          price,
          conditions.context_max_tokens,
          conditions.context_min_tokens,
        ]),
    ).toEqual([
      ["input_text", "3.30", 200_000, undefined],
      ["input_text", "3.30", undefined, 200_001],
      ["output_text", "16.50", 200_000, undefined],
      ["output_text", "16.50", undefined, 200_001],
    ]);
    expect(byId.get("mistral-ocr-2505")?.raw_price_facts).toEqual([]);
    expect(
      byId
        .get("mistral-ocr-2505")
        ?.price_facts.map(({ meter, price, unit }) => [meter, price, unit]),
    ).toEqual([
      ["input_text", "0.0005", "million_tokens"],
      ["output_text", "0.0005", "million_tokens"],
    ]);
    expect(byId.get("ocr-converted")?.raw_price_facts).toEqual([]);
    expect(
      byId.get("ocr-converted")?.price_facts.map(({ meter, price, unit }) => [meter, price, unit]),
    ).toEqual([
      ["input_text", "0.30", "million_tokens"],
      ["output_text", "1.20", "million_tokens"],
    ]);
    expect(byId.get("claude-cache-ambiguous")?.raw_price_facts).toEqual([
      expect.objectContaining({
        impact: "base_price",
        reason: "unknown_applicability",
        raw: expect.objectContaining({ fragment: expect.stringContaining("Cache Write: $1.50") }),
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

  it("normalizes first-party grounding and Claude web-search charges", async () => {
    const googlePricing = `
      <main><div class="devsite-article-body">
        <h3>Gemini 3</h3>
        <h3>Standard</h3>
        <table>
          <tr><th>Model</th><th>Type</th><th>Price (/1M tokens)</th></tr>
          <tr><td>Gemini 3 Test</td></tr>
          <tr><td>Input (text)</td><td>$1</td></tr>
        </table>
        <h3>Flex/Batch</h3>
        <table>
          <tr><th>Feature</th><th>Pricing</th></tr>
          <tr>
            <td>Grounding with Google Web Search and Image Search, &amp; Web Grounding for Enterprise</td>
            <td>Includes 5,000 search queries per month at no charge. Search queries exceeding
              those limits are billed at $14 per 1,000 search queries. You will be charged for
              each individual search query performed. Input tokens provided by Grounding with
              Google Search are not charged.</td>
          </tr>
          <tr>
            <td>Grounding with Google Maps</td>
            <td>Includes 5,000 search queries per month at no charge. Maps queries exceeding
              those limits are billed at $14 per 1,000 queries. You will be charged for each
              individual query performed.</td>
          </tr>
          <tr><td>Grounding with your data</td><td>$2.50 per 1,000 prompts.</td></tr>
        </table>
        <h3>Gemini 2.5</h3>
        <h3>Flex/Batch</h3>
        <table>
          <tr><th>Feature</th><th>Pricing</th></tr>
          <tr><td>Grounding with Google Search</td><td>$35 per 1,000 grounded prompts.</td></tr>
          <tr><td>Web Grounding for enterprise</td><td>$45 per 1,000 grounded prompts.</td></tr>
          <tr><td>Grounding with your data</td><td>$2.5 per 1,000 requests.</td></tr>
          <tr><td>Grounding with Google Maps</td><td>$25 per 1,000 grounded prompts.</td></tr>
        </table>
        <p>Grounding with Google Search and Web Grounding for enterprise is billed only when a
          prompt successfully returns web results. Gemini model usage fees apply separately.</p>
      </div></main>`;
    const modelCard = (await fixture("vertex/model.html"))
      .replaceAll("gemini-test", "gemini-3-test")
      .replaceAll("Gemini Test", "Gemini 3 Test")
      .replace(
        /\s*<\/div>\s*<\/main>\s*$/,
        `<h1>Gemini Live 2.5 Flash Native Audio</h1>
        <table>
          <tr><th>Model ID</th><td><code>gemini-live-2.5-flash-native-audio</code></td></tr>
          <tr><th>Modalities</th><td>Inputs: Audio Outputs: Audio</td></tr>
        </table></div></main>`,
      );
    const supported = async (path: string): Promise<string> =>
      (await fixture(`vertex/${path}`))
        .replaceAll("Gemini Test", "Gemini 3 Test")
        .replace("</ul>", "<li>Gemini 2.5 Flash with Gemini Live API native audio</li></ul>");
    const googleItems: PricingReconciliationItem[] = [];
    const googleModels = await vertexCatalog(
      {
        "model.html": modelCard,
        "pricing.html": googlePricing,
        "grounding-search.html": await supported("grounding-search.html"),
        "grounding-maps.html": await supported("grounding-maps.html"),
        "grounding-data.html": await supported("grounding-data.html"),
      },
      (item) => googleItems.push(item),
    );
    const google = googleModels.find(({ model_id }) => model_id === "gemini-3-test");
    const nativeAudio = googleModels.find(
      ({ model_id }) => model_id === "gemini-live-2.5-flash-native-audio",
    );
    const googleCommercial = googleModels.flatMap(({ commercial_facts }) => commercial_facts ?? []);

    const claudeCard = `
      <main><div class="devsite-article-body">
        <h1>Claude Sonnet 5</h1>
        <table>
          <tr><th>Model ID</th><td><code>claude-sonnet-5</code></td></tr>
          <tr><th>Modalities</th><td>Inputs: Text Outputs: Text</td></tr>
        </table>
        <a href="https://console.cloud.google.com/agent-platform/publishers/anthropic/model-garden/claude-sonnet-5">Model Garden</a>
      </div></main>`;
    const claudePricing = `
      <main><div class="devsite-article-body">
        <h4>Pricing for tools</h4>
        <table>
          <tr><th>Tool</th><th>Price</th></tr>
          <tr><td>Web Search Request</td><td>$10 per 1000 searches</td></tr>
        </table>
      </div></main>`;
    const claudeReference = (await fixture("vertex/claude-web-search.html")).replace(
      "Claude Test on Google Cloud",
      "Claude Sonnet 5 on Google Cloud",
    );
    const claudeItems: PricingReconciliationItem[] = [];
    const claude = (
      await vertexModels(
        1,
        [
          [
            "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/claude/sonnet-5",
            "sonnet-5.html",
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
          [
            "https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing",
            "pricing.html",
          ],
        ],
        {
          "sonnet-5.html": claudeCard,
          "pricing.html": claudePricing,
          "claude-web-search.html": claudeReference,
        },
        0,
        "<main></main>",
        (item) => claudeItems.push(item),
      )
    )[0];

    expect({
      google: googleCommercial
        .filter(({ offer_key }) => offer_key === `usage:${google?.uid}`)
        .flatMap(({ resource_key, price_facts }) =>
          price_facts.map(({ price, unit }) => ({
            service: resource_key,
            price,
            unit,
          })),
        ),
      allowances: googleCommercial
        .flatMap(({ raw_price_facts }) => raw_price_facts)
        .filter(({ term_key }) => term_key === "grounding_allowance").length,
      nativeAudio: googleCommercial
        .filter(({ offer_key }) => offer_key === `usage:${nativeAudio?.uid}`)
        .flatMap(({ resource_key, price_facts }) =>
          price_facts.map(({ unit }) => ({ service: resource_key, unit })),
        ),
      claude: claude?.commercial_facts?.find(
        ({ resource_key }) => resource_key === "claude-web-search",
      )?.price_facts[0],
      problems: [...googleItems, ...claudeItems].filter(({ disposition }) =>
        ["unbound", "ambiguous", "unsupported", "unresolved"].includes(disposition),
      ),
    }).toEqual({
      google: [
        {
          service: "grounded-generation",
          price: "2.50",
          unit: "thousand_requests",
        },
        { service: "google-image-search", price: "14", unit: "thousand_search_units" },
        { service: "google-maps", price: "14", unit: "thousand_search_units" },
        { service: "google-search", price: "14", unit: "thousand_search_units" },
        {
          service: "web-grounding-enterprise",
          price: "14",
          unit: "thousand_search_units",
        },
      ],
      allowances: 4,
      nativeAudio: [
        { service: "grounded-generation", unit: "thousand_requests" },
        { service: "google-maps", unit: "thousand_requests" },
        { service: "google-search", unit: "thousand_requests" },
        { service: "web-grounding-enterprise", unit: "thousand_requests" },
      ],
      claude: expect.objectContaining({
        price: "10",
        unit: "thousand_search_units",
        conditions: { operation: "web_search" },
      }),
      problems: [],
    });
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

  it("keeps model identity when a public price row becomes unbound", async () => {
    const pricing = (await fixture("vertex/pricing.html")).replaceAll(
      "Gemini Test",
      "Unpublished Model",
    );
    const reconciliation: PricingReconciliationItem[] = [];
    const models = await vertexCatalog({ "pricing.html": pricing }, (item) =>
      reconciliation.push(item),
    );
    expect(models.some(({ model_id }) => model_id === "gemini-test")).toBe(true);
    expect(reconciliation).toContainEqual(
      expect.objectContaining({ disposition: "unbound", sample: "Unpublished Model" }),
    );
  });

  it("contains fast-moving grounding structure drift to the affected claim", async () => {
    const reference = (await fixture("vertex/grounding-search.html")).replace(
      "<h2>Supported models</h2>",
      "<h2>Compatible models</h2>",
    );
    const reconciliation: PricingReconciliationItem[] = [];
    const models = await vertexCatalog({ "grounding-search.html": reference }, (item) =>
      reconciliation.push(item),
    );
    expect(
      models
        .find(({ model_id }) => model_id === "gemini-test")
        ?.price_facts.some(({ meter }) => meter === "input_text"),
    ).toBe(true);
    expect(reconciliation).toContainEqual(
      expect.objectContaining({
        disposition: "unsupported",
        reason_code: "grounding_supported_model_reference_changed",
      }),
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
    const discovery = (await fixture("vertex/discovery.json")).replace(
      "cachedContentTokenCount",
      "cacheHitTokens",
    );
    await expect(vertexCatalog({ "discovery.json": discovery })).rejects.toThrow(
      "Vertex usage schema changed",
    );
    const skus = (await fixture("vertex/skus.html")).replace("Vertex AI", "Unrelated Service");
    await expect(vertexCatalog({ "skus.html": skus })).rejects.toThrow(
      "Vertex billing SKU group contract changed",
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
    const mythos = models.find((model) => model.model_id === "claude-mythos-5");
    const opus = models.find((model) => model.model_id === "claude-opus-4-8");
    const sonnet = models.find((model) => model.model_id === "claude-sonnet-5");
    const preview = models.find((model) => model.model_id === "claude-mythos-preview");
    expect({
      count: models.length,
      name: fable?.name,
      release: fable?.release_date,
      description: fable?.description,
      mythosRelease: mythos?.release_date,
      mythosDescription: mythos?.description,
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
      cacheWrites: fable?.price_facts
        .filter(
          (rate) =>
            rate.meter === "cache_write_text" &&
            rate.conditions.service_tier === undefined &&
            rate.conditions.inference_geo === undefined,
        )
        .map(({ price, conditions }) => [conditions.cache_ttl_seconds, price]),
      opusRelease: opus?.release_date,
      fastInput: opus?.price_facts.find(
        (rate) =>
          rate.meter === "input_text" &&
          rate.conditions.speed === "fast" &&
          rate.conditions.inference_geo === undefined,
      ),
      sonnetRates: sonnet?.price_facts.length,
      previewStatus: preview?.status,
      previewReplacement: preview?.replacement_model_ids,
    }).toEqual({
      count: 7,
      name: "Claude Fable 5",
      release: "2026-06-09",
      description: "Widely released model",
      mythosRelease: "2026-06-09",
      mythosDescription: "Limited release model",
      stage: "stable",
      limits: { context_tokens: 1_000_000, max_output_tokens: 128_000 },
      input: "10",
      usInput: "11",
      batchCache: "0.5",
      cacheWrites: [
        [300, "12.50"],
        [3600, "20"],
      ],
      opusRelease: "2026-05-28",
      fastInput: expect.objectContaining({
        price: "10",
        conditions: { speed: "fast" },
      }),
      sonnetRates: 40,
      previewStatus: "retired",
      previewReplacement: ["claude-mythos-5"],
    });
  });

  it("accounts for every reviewed Anthropic pricing row or explicit boundary", async () => {
    const items: PricingReconciliationItem[] = [];
    await anthropicCatalog({ onPricingReconciliation: (item) => items.push(item) });
    expect({
      observed: items.length,
      normalized: items.filter(({ disposition }) => disposition === "normalized").length,
      excluded: items.filter(({ disposition }) => disposition === "excluded").length,
      problems: items.filter(({ disposition }) =>
        ["unbound", "ambiguous", "unsupported", "unresolved"].includes(disposition),
      ),
      reasons: [...new Set(items.map(({ reason_code }) => reason_code))].sort(),
    }).toEqual({
      observed: 46,
      normalized: 39,
      excluded: 6,
      problems: [
        {
          disposition: "unresolved",
          reason_code: "fallback_credit_bound",
          sample: "Fallback prompt-cache credit",
        },
      ],
      reasons: [
        "account_specific_discount",
        "account_specific_service_tier",
        "advisor_service_bound",
        "base_model_price_row",
        "batch_model_price_row",
        "cache_multiplier_applied",
        "code_execution_allowance_bound",
        "code_execution_minimum_bound",
        "code_execution_rate_bound",
        "code_execution_scope_bound",
        "code_execution_web_assisted_bound",
        "compaction_usage_bound",
        "external_provider_partition",
        "fallback_credit_bound",
        "fast_model_price_row",
        "files_service_bound",
        "inference_geo_multiplier_applied",
        "managed_agents_code_execution_bound",
        "managed_agents_list_cost_bound",
        "managed_agents_model_usage_bound",
        "managed_agents_runtime_bound",
        "managed_agents_scope_bound",
        "marketplace_settlement_bound",
        "new_user_credit_bound",
        "priority_capacity_bound",
        "priority_enrollment_bound",
        "token_counting_service_bound",
        "token_overhead_included_in_usage",
        "web_fetch_service_bound",
        "web_fetch_usage_bound",
        "web_search_service_bound",
        "web_search_usage_bound",
      ],
    });
  });

  it("normalizes provider services and account products without generic tool-call prices", async () => {
    const models = await anthropicCatalog();
    const facts = models.flatMap(({ commercial_facts }) => commercial_facts ?? []);
    const byKey = (resourceKey: string) =>
      facts.filter(({ resource_key }) => resource_key === resourceKey);
    expect({
      resources: [...new Set(facts.map(({ resource_key }) => resource_key))].sort(),
      search: byKey("web-search").map(({ offer_key, price_facts }) => [
        offer_key,
        price_facts[0]?.meter,
        price_facts[0]?.price,
      ]),
      fetch: byKey("web-fetch").map(({ pricing_state }) => pricing_state),
      code: byKey("code-execution").map(({ offer_key, pricing_state }) => [
        offer_key,
        pricing_state,
      ]),
      runtime: byKey("managed-agents-runtime")[0]?.price_facts[0],
      fallback: byKey("fallback-credit-token")[0]?.model_refs,
      priority: facts
        .filter(({ resource_key }) => resource_key.startsWith("priority-tier:"))
        .map(({ pricing_state }) => pricing_state),
    }).toEqual({
      resources: [
        "advisor:anthropic/claude-mythos-5",
        "advisor:anthropic/claude-opus-4-7",
        "advisor:anthropic/claude-opus-4-8",
        "claude-platform-aws",
        "code-execution",
        "fallback-credit-token",
        "files",
        "managed-agents-runtime",
        "new-user-credit",
        "priority-tier:anthropic/claude-opus-4-7",
        "priority-tier:anthropic/claude-opus-4-8",
        "priority-tier:anthropic/claude-sonnet-5",
        "token-counting",
        "web-fetch",
        "web-search",
      ],
      search: [
        ["sync", "web_search", "10"],
        ["batch", "web_search", "10"],
      ],
      fetch: ["included", "included"],
      code: [
        ["sync", "numeric"],
        ["batch", "numeric"],
        ["web-assisted-sync", "included"],
        ["web-assisted-batch", "included"],
        ["organization-allowance", "included"],
        ["managed-agents", "included"],
      ],
      runtime: expect.objectContaining({
        meter: "session_runtime",
        price: "0.08",
        unit: "hour",
      }),
      fallback: ["anthropic/claude-opus-4-8"],
      priority: ["not_published", "not_published", "not_published"],
    });
    expect(
      facts.flatMap(({ price_facts }) => price_facts).some(({ meter }) => meter === "tool_call"),
    ).toBe(false);
  });

  it("keeps independent Anthropic commercial claims when usage companions drift", async () => {
    const search = (await fixture("anthropic/web-search-tool.md")).replaceAll(
      "web_search_requests",
      "search_requests",
    );
    const code = (await fixture("anthropic/code-execution-tool.md")).replace(
      "minimum of 5 minutes",
      "minimum duration is documented elsewhere",
    );
    const agents = (await fixture("anthropic/managed-agents-events-and-streaming.md")).replaceAll(
      "list_cost",
      "public_cost",
    );
    const items: PricingReconciliationItem[] = [];
    const models = await anthropicCatalog({
      overrides: {
        "/docs/en/agents-and-tools/tool-use/web-search-tool.md": search,
        "/docs/en/agents-and-tools/tool-use/code-execution-tool.md": code,
        "/docs/en/managed-agents/events-and-streaming.md": agents,
      },
      onPricingReconciliation: (item) => items.push(item),
    });
    const facts = models.flatMap(({ commercial_facts }) => commercial_facts ?? []);
    const codeFacts = facts.filter(({ resource_key }) => resource_key === "code-execution");
    expect({
      searchRate: facts.find(({ resource_key }) => resource_key === "web-search")?.price_facts[0]
        ?.price,
      codeOffers: codeFacts.map(({ offer_key }) => offer_key),
      codeRate: codeFacts.find(({ offer_key }) => offer_key === "sync")?.price_facts[0]?.price,
      runtime: facts.find(({ resource_key }) => resource_key === "managed-agents-runtime")
        ?.price_facts[0]?.price,
    }).toEqual({
      searchRate: "10",
      codeOffers: [
        "sync",
        "batch",
        "web-assisted-sync",
        "web-assisted-batch",
        "organization-allowance",
        "managed-agents",
      ],
      codeRate: "0.05",
      runtime: "0.08",
    });
    expect(items).toEqual(
      expect.arrayContaining([
        {
          disposition: "unresolved",
          reason_code: "web_search_usage_bound",
          sample: "Web Search usage signal",
        },
        {
          disposition: "unresolved",
          reason_code: "code_execution_minimum_bound",
          sample: "Code Execution minimum",
        },
        {
          disposition: "unresolved",
          reason_code: "managed_agents_list_cost_bound",
          sample: "Managed Agents list cost",
        },
      ]),
    );
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
    const preview = (
      await anthropicCatalog({
        overrides: { "/docs/en/about-claude/model-deprecations.md": lifecycle },
      })
    ).find(({ model_id }) => model_id === "claude-mythos-preview");
    expect(preview).toMatchObject({
      status: "deprecated",
      replacement_model_ids: ["claude-mythos-5"],
    });
    expect(preview?.retired_at).toBeUndefined();
  });

  it("isolates an impossible lifecycle date while retaining independent evidence", async () => {
    const lifecycle = (await fixture("anthropic/lifecycle.md")).replace(
      "August 5, 2026",
      "February 30, 2026",
    );
    const items: PricingReconciliationItem[] = [];
    const opus = (
      await anthropicCatalog({
        overrides: { "/docs/en/about-claude/model-deprecations.md": lifecycle },
        onPricingReconciliation: (item) => items.push(item),
      })
    ).find(({ model_id }) => model_id === "claude-opus-4-1-20250805");
    expect(opus).toMatchObject({ status: "deprecated", retired_at: "2026-08-05" });
    expect(items).toContainEqual({
      disposition: "unresolved",
      reason_code: "lifecycle_date_invalid",
      sample: "retirement date: February 30, 2026",
    });
  });

  it("withholds a drifted Messages operation without rejecting model identity", async () => {
    const body = (await fixture("anthropic/messages.md")).replace("/v1/messages", "/v2/messages");
    const items: PricingReconciliationItem[] = [];
    const fable = (
      await anthropicCatalog({
        overrides: { "/docs/en/api/messages/create.md": body },
        onPricingReconciliation: (item) => items.push(item),
      })
    ).find(({ model_id }) => model_id === "claude-fable-5");
    expect(fable).toMatchObject({
      capabilities: { streaming: "unknown", tool_call: "unknown" },
    });
    expect(fable?.api_endpoints).toEqual([
      { name: "Create a Message Batch", path: "v1/messages/batches" },
    ]);
    expect(items).toContainEqual({
      disposition: "unresolved",
      reason_code: "operation_contract_drift",
      sample: "v1/messages",
    });
  });

  it("withholds drifted batch coverage without rejecting synchronous models", async () => {
    const fable = (
      await anthropicCatalog({
        overrides: { "/docs/en/build-with-claude/batch-processing.md": "# Message Batches API" },
      })
    ).find(({ model_id }) => model_id === "claude-fable-5");
    expect(fable).toMatchObject({
      api_endpoints: [{ name: "Create a Message", path: "v1/messages" }],
      capabilities: { batch: "unknown", streaming: true },
    });
  });

  it("isolates an unbound structured-output ID to that capability claim", async () => {
    const structured = (await fixture("anthropic/structured-outputs.md")).replace(
      "`claude-sonnet-5`",
      "`claude-unknown-5`",
    );
    const items: PricingReconciliationItem[] = [];
    const models = await anthropicCatalog({
      overrides: { "/docs/en/build-with-claude/structured-outputs.md": structured },
      onPricingReconciliation: (item) => items.push(item),
    });
    expect(
      models.find(({ model_id }) => model_id === "claude-sonnet-5")?.capabilities.structured_output,
    ).toBe(false);
    expect(items).toContainEqual({
      disposition: "unbound",
      reason_code: "capability_model_unbound",
      sample: "structured-output: claude-unknown-5",
    });
  });

  it("derives geography eligibility from the documented generation for new model families", async () => {
    const overview = `${await fixture("anthropic/overview.md")}\n
| Feature                                        | Claude Haiku 4.6        |
| ---------------------------------------------- | ----------------------- |
| **Description**                                | Fast future model       |
| **Claude API ID**                              | claude-haiku-4-6        |
| **Claude API alias**                           | claude-haiku-4-6        |
| **Extended thinking (thinking.type enabled)**  | No                      |
| **Adaptive thinking (thinking.type adaptive)** | Yes                     |
| **Context window**                             | 200k tokens             |
| **Max output**                                 | 64k tokens              |
`;
    const lifecycle = (await fixture("anthropic/lifecycle.md")).replace(
      "| claude-fable-5           | Active",
      "| claude-haiku-4-6         | Active        | N/A          | Not sooner than July 1, 2027   |\n| claude-fable-5           | Active",
    );
    const releases = (await fixture("anthropic/release-notes.md")).replace(
      "### June 30, 2026",
      "### July 1, 2026\n\n- We've launched **Claude Haiku 4.6** (`claude-haiku-4-6`), a faster model.\n\n### June 30, 2026",
    );
    const structured = (await fixture("anthropic/structured-outputs.md")).replace(
      "`claude-fable-5`,",
      "`claude-haiku-4-6`, `claude-fable-5`,",
    );
    const pricing = (await fixture("anthropic/pricing.md"))
      .replace(
        "| Claude Fable 5                             | $10 / MTok",
        "| Claude Haiku 4.6                          | $1 / MTok         | $1.25 / MTok    | $2 / MTok       | $0.10 / MTok           | $5 / MTok     |\n| Claude Fable 5                             | $10 / MTok",
      )
      .replace(
        "| Claude Fable 5                             | $5 / MTok",
        "| Claude Haiku 4.6                          | $0.50 / MTok | $2.50 / MTok  |\n| Claude Fable 5                             | $5 / MTok",
      );
    const haiku = (
      await anthropicCatalog({
        overview,
        overrides: {
          "/docs/en/about-claude/model-deprecations.md": lifecycle,
          "/docs/en/about-claude/pricing.md": pricing,
          "/docs/en/build-with-claude/structured-outputs.md": structured,
          "/docs/en/release-notes/overview.md": releases,
        },
      })
    ).find(({ model_id }) => model_id === "claude-haiku-4-6");
    expect(haiku).toMatchObject({
      status: "active",
      release_date: "2026-07-01",
      limits: { context_tokens: 200_000, max_output_tokens: 64_000 },
      capabilities: { reasoning: true, tool_call: true, structured_output: true },
    });
    expect(
      haiku?.price_facts.find(
        ({ meter, conditions }) => meter === "input_text" && conditions.inference_geo === "us",
      )?.price,
    ).toBe("1.1");
  });

  it("reports documentation-index drift without rejecting unrelated Anthropic facts", async () => {
    const index = (await fixture("anthropic/llms.txt")).replace(
      /^.*\/api\/models\/list\.md.*\n/m,
      "",
    );
    const items: PricingReconciliationItem[] = [];
    const models = await anthropicCatalog({
      overrides: { "/llms.txt": index },
      onPricingReconciliation: (item) => items.push(item),
    });
    expect(models.some(({ model_id }) => model_id === "claude-fable-5")).toBe(true);
    expect(items).toContainEqual({
      disposition: "unresolved",
      reason_code: "documentation_index_omission",
      sample: "/docs/en/api/models/list.md",
    });
  });

  it("withholds only geo variants when eligibility sources disagree", async () => {
    const residency = (await fixture("anthropic/data-residency.md")).replace("4.6", "4.7");
    const items: PricingReconciliationItem[] = [];
    const fable = (
      await anthropicCatalog({
        overrides: { "/docs/en/manage-claude/data-residency.md": residency },
        onPricingReconciliation: (item) => items.push(item),
      })
    ).find(({ model_id }) => model_id === "claude-fable-5");
    expect(fable?.price_facts.some(({ conditions }) => conditions.inference_geo === "us")).toBe(
      false,
    );
    expect(fable?.price_facts.some(({ meter }) => meter === "input_text")).toBe(true);
    expect(items).toContainEqual({
      disposition: "unresolved",
      reason_code: "inference_geo_eligibility_conflict",
      sample: "pricing and data-residency generation thresholds",
    });
  });

  it("rejects duplicate fixed documents instead of silently taking the first", async () => {
    await expect(
      anthropicCatalog({
        extraDocuments: [
          {
            url: "https://platform.claude.com/docs/en/api/messages/create.md",
            body: await fixture("anthropic/messages.md"),
          },
        ],
      }),
    ).rejects.toThrow(
      "Anthropic catalog expected exactly one document: /docs/en/api/messages/create.md",
    );
  });

  it("parses escaped Markdown pipes without shifting model columns", async () => {
    const overview = (await fixture("anthropic/overview.md")).replace(
      "Speed and intelligence",
      "Speed \\| intelligence",
    );
    expect(
      (await anthropicCatalog({ overview })).find(({ model_id }) => model_id === "claude-sonnet-5")
        ?.description,
    ).toBe("Speed | intelligence");
  });
});

describe("Databricks adapters", () => {
  it("keeps the reviewed English locale selector on the Google price companion", () => {
    const source = manifest("databricks").sources.find(({ id }) => id === "databricks-models");
    const companion = source?.linkedDocuments?.documents?.find(
      ({ id }) => id === "google-image-pricing",
    );
    expect(companion?.url).toBe("https://ai.google.dev/gemini-api/docs/pricing?hl=en");
  });

  it("combines labeled endpoints with lifecycle, limits, feature support, and DBU rates", async () => {
    const models = await databricksCatalog();
    const sol = models.find((model) => model.model_id === "databricks-gpt-5-6-sol");
    const retired = models.find((model) => model.model_id === "databricks-claude-sonnet-4");
    const replacement = models.find((model) => model.model_id === "databricks-claude-sonnet-4-6");
    const embedding = models.find((model) => model.model_id === "databricks-gte-large-en");
    const image = models.find((model) => model.model_id === "databricks-gemini-3-pro-image");
    const flashImage = models.find(
      (model) => model.model_id === "databricks-gemini-3-1-flash-image",
    );
    const open = models.find((model) => model.model_id === "databricks-glm-5-2");
    const qwen = models.find((model) => model.model_id === "databricks-qwen35-122b-a10b");
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
      count: 11,
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
    expect(
      qwen?.price_facts
        .filter(({ conditions }) => conditions.service_tier === "priority")
        .map(({ meter, price, conditions }) => [meter, price, conditions.region]),
    ).toEqual([
      ["input_text", "6.286", "ap_south_1"],
      ["output_text", "62.858", "ap_south_1"],
    ]);
    expect(
      flashImage?.price_facts.map(({ meter, price, currency }) => [meter, price, currency]),
    ).toEqual([
      ["input_image", "0.5", "USD"],
      ["input_text", "0.5", "USD"],
      ["output_image", "60", "USD"],
      ["output_text", "3", "USD"],
    ]);
    expect(
      image?.price_facts.map(({ meter, price, currency }) => [meter, price, currency]),
    ).toEqual([
      ["input_image", "2", "USD"],
      ["input_text", "2", "USD"],
      ["output_image", "120", "USD"],
      ["output_text", "12", "USD"],
    ]);
    expect(sol?.raw_price_facts).toEqual([
      expect.objectContaining({
        term_key: "priority_pay_per_token",
        reason: "unknown_amount",
        conditions: { service_tier: "priority" },
      }),
    ]);
  });

  it("publishes model mechanisms, capacity, provider services, and DBU settlement separately", async () => {
    const value = manifest("databricks");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Databricks source");
    const models = await databricksCatalog();
    const commercial = models.flatMap(({ commercial_facts }) => commercial_facts ?? []);
    expect([...new Set(commercial.map(({ book_key }) => book_key))].sort()).toEqual([
      "account:dbu-settlement",
      "service:agent-bricks",
      "service:agent-evaluation",
      "service:ai-functions",
      "service:ai-gateway",
      "service:ai-runtime",
      "service:ai-search",
      "service:genie",
      "service:model-serving",
      "service:model-training",
    ]);
    expect(
      commercial
        .filter(({ book_key }) => book_key === "service:ai-search")
        .flatMap(({ raw_price_facts }) => raw_price_facts)
        .map(({ term_key }) => term_key),
    ).toEqual(
      expect.arrayContaining(["compute", "storage", "storage_allowance", "reranker_queries"]),
    );

    const partition = assembleParsedProviderPricing(
      value.provider.id,
      observedAt,
      [{ source, models }],
      models,
      value.pricingCategoricalLabels,
    );
    const sol = partition?.books.find(
      ({ scope }) =>
        scope.kind === "models" && scope.model_refs.includes("databricks/databricks-gpt-5-6-sol"),
    );
    expect(sol?.offers.map(({ offer_key }) => offer_key).sort()).toEqual([
      "batch",
      "pay-per-token",
    ]);
    expect(
      sol?.offers
        .find(({ offer_key }) => offer_key === "batch")
        ?.terms.some(
          (term) =>
            term.kind === "rate" &&
            term.meter.namespace === "provider" &&
            term.meter.value === "batch_inference",
        ),
    ).toBe(true);
    expect(
      partition?.books.some(
        ({ book_key, offers }) =>
          book_key === "capacity:databricks/databricks-qwen3-embedding-0-6b" &&
          offers.some(({ offer_key }) => offer_key === "covered-inference"),
      ),
    ).toBe(true);
    const search = partition?.books.find(({ book_key }) => book_key === "service:ai-search");
    expect(
      search?.offers.flatMap(({ terms }) => terms).map(({ term_key, kind }) => [term_key, kind]),
    ).toEqual(
      expect.arrayContaining([
        ["compute", "rate"],
        ["storage", "rate"],
        ["storage_allowance", "allowance"],
        ["reranker_queries", "rate"],
      ]),
    );
    expect(
      partition?.books
        .find(({ book_key }) => book_key === "service:ai-gateway")
        ?.offers.find(({ offer_key }) => offer_key === "inference-tables")
        ?.terms.find(({ term_key }) => term_key === "payload_tokens")
        ?.variants.flatMap((variant) => ("price" in variant ? [variant.price.value] : [])),
    ).toEqual(expect.arrayContaining([{ numerator: "7", denominator: "100000000" }]));
    expect(
      partition?.books
        .find(({ book_key }) => book_key === "service:ai-runtime")
        ?.offers.find(({ offer_key }) => offer_key === "a10")
        ?.terms.find(({ term_key }) => term_key === "gpu_runtime")
        ?.variants.flatMap((variant) => ("price" in variant ? [variant.price.value] : [])),
    ).toEqual(expect.arrayContaining([{ numerator: "1", denominator: "1440" }]));
    expect(
      search?.offers
        .find(({ offer_key }) => offer_key === "standard")
        ?.terms.find(({ term_key }) => term_key === "storage_allowance"),
    ).toMatchObject({
      kind: "allowance",
      variants: expect.arrayContaining([
        expect.objectContaining({
          benefit: {
            kind: "quantity",
            quantity: {
              value: { numerator: "30000000000", denominator: "1" },
              unit: {
                factors: [
                  { unit: { namespace: "kmodels", value: "billing_month" }, power: 1 },
                  { unit: { namespace: "kmodels", value: "byte" }, power: 1 },
                ],
              },
            },
          },
        }),
      ]),
    });
    const reranker = search?.offers
      .find(({ offer_key }) => offer_key === "reranker")
      ?.terms.find(({ term_key }) => term_key === "reranker_queries");
    expect(reranker?.kind).toBe("rate");
    expect(
      reranker?.variants.flatMap((variant) => ("price" in variant ? [variant.price.value] : [])),
    ).toEqual([{ numerator: "2857", denominator: "100000" }]);
    expect(
      partition?.books.find(({ book_key }) => book_key === "account:dbu-settlement")?.offers[0]
        ?.states[0]?.state,
    ).toBe("not_published");
    const genie = partition?.books.find(({ book_key }) => book_key === "service:genie");
    expect(
      genie?.offers
        .find(({ offer_key }) => offer_key === "genie-one")
        ?.states.map(({ state, validity }) => [
          state,
          validity?.from?.value,
          validity?.until?.value,
        ]),
    ).toEqual(
      expect.arrayContaining([
        ["free", undefined, "2027-01-31"],
        ["numeric", "2027-02-01", undefined],
      ]),
    );
    expect(
      genie?.offers
        .find(({ offer_key }) => offer_key === "shared-monthly-allowance")
        ?.terms.some(({ kind }) => kind === "allowance"),
    ).toBe(true);
  });

  it("keeps provider-service siblings when one pricing-card identity drifts", async () => {
    const page = (await fixture("databricks/pricing-ai-gateway.json")).replace(
      '"fieldTitle": "Usage Tracking"',
      '"fieldTitle": "Renamed Tracking"',
    );
    const items: PricingReconciliationItem[] = [];
    const models = await databricksCatalog({ "pricing-ai-gateway.json": page }, (item) =>
      items.push(item),
    );
    const gateway = models
      .flatMap(({ commercial_facts }) => commercial_facts ?? [])
      .filter(({ book_key }) => book_key === "service:ai-gateway");
    expect(gateway.map(({ offer_key }) => offer_key)).toEqual(["inference-tables"]);
    expect(models.some(({ price_facts }) => price_facts.length > 0)).toBe(true);
    expect(items).toContainEqual({
      disposition: "unsupported",
      reason_code: "pricing_card_identity_drifted",
      sample: "ai-gateway: Usage Tracking",
    });
  });

  it("keeps valid provider-service price components when a sibling amount is malformed", async () => {
    const cards = (await fixture("databricks/pricing-cards.json")).replace(
      '"US East (N. Virginia)": "0.10|0.07"',
      '"US East (N. Virginia)": "market|0.07"',
    );
    const value = manifest("databricks");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Databricks source");
    const models = await databricksCatalog({ "pricing-cards.json": cards });
    const partition = assembleParsedProviderPricing(
      value.provider.id,
      observedAt,
      [{ source, models }],
      models,
      value.pricingCategoricalLabels,
    );
    const offer = partition?.books
      .find(({ book_key }) => book_key === "service:ai-gateway")
      ?.offers.find(({ offer_key }) => offer_key === "inference-tables");
    const payloadTokens = offer?.terms.find(({ term_key }) => term_key === "payload_tokens");
    expect(payloadTokens?.kind).toBe("rate");
    expect(
      payloadTokens?.variants.flatMap((variant) =>
        "price" in variant ? [variant.price.value] : [],
      ),
    ).toEqual(expect.arrayContaining([{ numerator: "7", denominator: "100000000" }]));
    expect(offer?.terms.find(({ term_key }) => term_key === "payload_gb")).toMatchObject({
      kind: "rate",
      raw_variants: [expect.objectContaining({ reason: "unknown_amount" })],
    });
  });

  it("reconciles every reviewed Databricks pricing item without unresolved rows", async () => {
    const items: PricingReconciliationItem[] = [];
    await databricksCatalog({}, (item) => items.push(item));
    expect(items.length).toBeGreaterThan(10);
    expect(items.filter(({ disposition }) => disposition === "raw")).toHaveLength(2);
    expect(
      items.filter(({ disposition }) =>
        ["unbound", "ambiguous", "unsupported", "unresolved"].includes(disposition),
      ),
    ).toEqual([]);
  });

  it("keeps a redirected partner slug deprecated until Databricks stops serving it", async () => {
    const lifecycle = (await fixture("databricks/lifecycle.html"))
      .replace("Pay-per-token: October 9, 2026", "Pay-per-token: June 9, 2026")
      .replace(
        "Claude Sonnet 4.6</td>",
        "Claude Sonnet 4.6. To allow more time for migration, between June 9, 2026 and August 7, 2026, API calls to Anthropic Claude Sonnet 4 will be temporarily redirected to Claude Sonnet 4.6.</td>",
      );
    expect(
      (await databricksCatalog({ "lifecycle.html": lifecycle })).find(
        (model) => model.model_id === "databricks-claude-sonnet-4",
      ),
    ).toMatchObject({
      status: "deprecated",
      retired_at: "2026-08-07",
      replacement_model_ids: ["databricks-claude-sonnet-4-6"],
    });
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

  it("validates additive operational schemas and rejects loss of billing semantics", async () => {
    const billing = (await fixture("databricks/billing-usage.html")).replace(
      "</tbody>",
      "<tr><td>future_field</td><td>string</td><td>Additive field.</td><td>value</td></tr></tbody>",
    );
    await expect(databricksCatalog({ "billing-usage.html": billing })).resolves.toHaveLength(11);

    const systemTables = await fixture("databricks/system-tables.html");
    await expect(
      databricksCatalog({
        "system-tables.html": systemTables.replace(
          "Data is updated throughout the day",
          "Data arrives immediately",
        ),
      }),
    ).rejects.toThrow("system-table freshness contract changed");

    const gatewayUsage = await fixture("databricks/ai-gateway-usage.html");
    await expect(
      databricksCatalog({
        "ai-gateway-usage.html": gatewayUsage.replaceAll("token_details", "token_breakdown"),
      }),
    ).rejects.toThrow("AI Gateway usage contract omitted fields: token_details");

    const pricing = await fixture("databricks/list-pricing.html");
    await expect(
      databricksCatalog({
        "list-pricing.html": pricing.replace("effective_list", "effective_price"),
      }),
    ).rejects.toThrow("list pricing contract changed");

    const models = await fixture("databricks/models.html");
    await expect(
      databricksCatalog({
        "models.html": models.replace("maximum output tokens", "different limit values"),
      }),
    ).rejects.toThrow("partner-model limit boundary changed");

    await expect(
      databricksCatalog({}, undefined, [
        {
          url: "https://docs.databricks.com/aws/en/admin/system-tables?duplicate=1",
          body: systemTables,
        },
      ]),
    ).rejects.toThrow("expected one /aws/en/admin/system-tables document");
  });

  it("rejects identity and support corruption while isolating pricing-table damage", async () => {
    const models = await fixture("databricks/models.html");
    await expect(
      databricksCatalog({
        "models.html": models.replace("databricks-claude-sonnet-4-6", "databricks-claude-sonnet-4"),
      }),
    ).rejects.toThrow("repeated an endpoint ID");

    const overview = await fixture("databricks/overview.html");
    await expect(
      databricksCatalog({
        "overview.html": overview.replace("databricks-gpt-5-6-sol", "databricks-unknown-model"),
      }),
    ).rejects.toThrow("regional matrix named unknown catalog model");

    const lifecycle = await fixture("databricks/lifecycle.html");
    await expect(
      databricksCatalog({
        "lifecycle.html": lifecycle.replace("October 9, 2026", "February 30, 2026"),
      }),
    ).rejects.toThrow("invalid retirement date");

    const partner = await fixture("databricks/pricing-partner.html");
    const reconciliation: PricingReconciliationItem[] = [];
    const retained = await databricksCatalog(
      {
        "pricing-partner.html": partner.replace('rowspan="4"', 'rowspan="0"'),
      },
      (item) => reconciliation.push(item),
    );
    expect(retained).toHaveLength(11);
    expect(reconciliation).toContainEqual(
      expect.objectContaining({
        disposition: "unsupported",
        reason_code: "partner_model_pricing_rejected",
        sample: expect.stringContaining("invalid cell span"),
      }),
    );
  });

  it("rejects unsafe route drift and keeps independent pricing claims", async () => {
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
    await expect(
      databricksCatalog({
        "api-reference.html": reference.replace("reasoning_tokens", "cached_tokens"),
      }),
    ).rejects.toThrow("response usage contract changed");
    const priority = await fixture("databricks/priority-mode.html");
    await expect(
      databricksCatalog({
        "priority-mode.html": priority.replace("billed at standard", "charged at regular"),
      }),
    ).rejects.toThrow("priority request or fallback contract changed");
    const imagePricing = await fixture("databricks/google-image-pricing.html");
    const imageItems: PricingReconciliationItem[] = [];
    const withoutPassThrough = await databricksCatalog(
      {
        "google-image-pricing.html": imagePricing.replace("$60.00 (images)", "By request"),
      },
      (item) => imageItems.push(item),
    );
    expect(
      withoutPassThrough.find(({ model_id }) => model_id === "databricks-gemini-3-1-flash-image")
        ?.price_facts,
    ).toEqual([]);
    expect(imageItems).toContainEqual(
      expect.objectContaining({ reason_code: "pass_through_pricing_rejected" }),
    );
    const pricing = await fixture("databricks/pricing-open.html");
    const openItems: PricingReconciliationItem[] = [];
    const withoutOpen = await databricksCatalog(
      {
        "pricing-open.html": pricing.replace("cache read tokens", "cached tokens"),
      },
      (item) => openItems.push(item),
    );
    expect(withoutOpen).toHaveLength(11);
    expect(openItems).toContainEqual(
      expect.objectContaining({ reason_code: "open_model_pricing_rejected" }),
    );
    const malformedAmount = await databricksCatalog({
      "pricing-open.html": pricing.replace("<td>20.000</td>", "<td>$20</td>"),
    });
    expect(
      malformedAmount
        .find(({ model_id }) => model_id === "databricks-gte-large-en")
        ?.price_facts.some(({ meter }) => meter === "embedding"),
    ).toBe(true);
    const conflicts = await databricksCatalog({
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
    });
    expect(
      conflicts
        .find(({ model_id }) => model_id === "databricks-gte-large-en")
        ?.price_facts.filter(({ meter }) => meter === "embedding")
        .map(({ price }) => price),
    ).toEqual(expect.arrayContaining(["1.857", "2"]));
    const value = manifest("databricks");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Databricks source");
    const conflictPartition = assembleParsedProviderPricing(
      value.provider.id,
      observedAt,
      [{ source, models: conflicts }],
      conflicts,
      value.pricingCategoricalLabels,
    );
    expect(
      conflictPartition?.books
        .find(
          ({ scope }) =>
            scope.kind === "models" &&
            scope.model_refs.includes("databricks/databricks-gte-large-en"),
        )
        ?.offers.flatMap(({ terms }) => terms)
        .find(({ term_key }) => term_key === "embedding"),
    ).toMatchObject({
      kind: "rate",
      raw_variants: [expect.objectContaining({ reason: "conflicting_values" })],
    });
    const partner = await fixture("databricks/pricing-partner.html");
    const noteItems: PricingReconciliationItem[] = [];
    const withoutDerivedPromotion = await databricksCatalog(
      {
        "pricing-partner.html": partner.replace("promotional discount", "temporary discount"),
      },
      (item) => noteItems.push(item),
    );
    expect(withoutDerivedPromotion).toHaveLength(11);
    expect(noteItems).toContainEqual(
      expect.objectContaining({ reason_code: "partner_model_pricing_rejected" }),
    );
    await expect(
      databricksCatalog({
        "pricing-open.html": pricing
          .replace("Qwen 3 0.6B Embedding", "Future Embed")
          .replace("GTE", "Future GTE")
          .replace("GLM-5.2", "Future GLM"),
      }),
    ).resolves.toHaveLength(11);
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
    const items: PricingReconciliationItem[] = [];
    const drifted = await xaiCatalog(
      "xai/models-voice-services.txt",
      (body) =>
        body.replaceAll(
          '"realtimeAudioSecondPrice":"8333333"',
          '"realtimeAudioSecondPrice":"10000000"',
        ),
      (body) => body,
      (item) => items.push(item),
    );
    expect(drifted.map(({ model_id }) => model_id)).toEqual(
      expect.arrayContaining(["grok-voice-think-fast-1.0", "grok-voice-think-fast-2.0"]),
    );
    expect(items).toContainEqual(
      expect.objectContaining({
        disposition: "unbound",
        reason_code: "voice_service_price_conflict",
      }),
    );
    await expect(
      xaiCatalog("xai/models-voice-services.txt", (body) =>
        body.replace('"basis":"CONCURRENCY"', '"basis":"CONCURRENCY","futureVoiceRate":1'),
      ),
    ).rejects.toThrow("public voice endpoint added fields: futureVoiceRate");
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
          conditions: expect.objectContaining({ region: "us-east-1", resolution: "2K" }),
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
        expect.objectContaining({ meter: "output_audio", price: "0.05", unit: "minute" }),
        expect.objectContaining({ meter: "input_text", price: "0.004", unit: "request" }),
      ]),
    });
    expect(models.find(({ model_id }) => model_id === "grok-voice-think-fast-2.0")).toMatchObject({
      version: "1.0",
      aliases: [],
      capabilities: { reasoning: true, effort_control: true },
      price_facts: expect.arrayContaining([
        expect.objectContaining({ meter: "output_audio", price: "0.08", unit: "minute" }),
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

  it("applies a documented dated voice-alias transition at observation time", async () => {
    const models = await xaiCatalog(
      "xai/models-voice-services.txt",
      (body) =>
        body
          .replace(
            '"name":"grok-voice-think-fast-1.0","version":"1.0","inputModalities":["TEXT","AUDIO"],"outputModalities":["TEXT","AUDIO"],"aliases":["grok-voice-latest"]',
            '"name":"grok-voice-think-fast-1.0","version":"1.0","inputModalities":["TEXT","AUDIO"],"outputModalities":["TEXT","AUDIO"],"aliases":[]',
          )
          .replace(
            '"name":"grok-voice-think-fast-2.0","version":"1.0","inputModalities":["TEXT","AUDIO"],"outputModalities":["TEXT","AUDIO"],"aliases":[]',
            '"name":"grok-voice-think-fast-2.0","version":"1.0","inputModalities":["TEXT","AUDIO"],"outputModalities":["TEXT","AUDIO"],"aliases":["grok-voice-latest"]',
          ),
      (body) => body.replace("August 5, 2026", "July 20, 2026"),
    );
    expect(
      models.find(({ model_id }) => model_id === "grok-voice-think-fast-1.0")?.aliases,
    ).toEqual([]);
    expect(
      models.find(({ model_id }) => model_id === "grok-voice-think-fast-2.0")?.aliases,
    ).toEqual(["grok-voice-latest"]);
  });

  it("keeps standard, long-context, batch, priority, media, and tool rates distinct", async () => {
    const value = manifest("xai");
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
      models.some(({ price_facts }) =>
        price_facts.some(({ meter }) =>
          ["code_execution", "file_search", "web_search"].includes(meter),
        ),
      ),
    ).toBe(false);
    expect(
      build?.price_facts.find(
        ({ meter, conditions }) => meter === "input_text" && conditions.service_tier === "batch",
      ),
    ).toMatchObject({ price: "1", derived: true });

    const operationLabels = new Map(
      value.pricingCategoricalLabels
        ?.filter(
          ({ dimension }) => dimension.namespace === "kmodels" && dimension.value === "operation",
        )
        .map(({ value: operation, label }) => [operation, label]),
    );
    const operations = new Set(
      models.flatMap(({ price_facts, raw_price_facts }) =>
        [...price_facts, ...raw_price_facts].flatMap(({ conditions }) =>
          conditions.operation === undefined ? [] : [conditions.operation],
        ),
      ),
    );
    expect([...operations].sort()).toEqual([...operationLabels.keys()].sort());

    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing xAI pricing source");
    const partition = assembleParsedProviderPricing(
      value.provider.id,
      observedAt,
      [{ source, models }],
      models,
      value.pricingCategoricalLabels,
    );
    expect(
      partition?.vocabulary.atoms.flatMap((atom) =>
        atom.kind === "categorical_value" && atom.dimension.value === "operation"
          ? [[atom.key, atom.label]]
          : [],
      ),
    ).toEqual([...operationLabels].sort(([left], [right]) => left.localeCompare(right)));
    const modelBook = partition?.books.find(
      ({ scope }) => scope.kind === "models" && scope.model_refs.includes("xai/grok-4.3@1.0"),
    );
    expect(modelBook?.offers.map(({ offer_key }) => offer_key).sort()).toEqual(["batch", "sync"]);
    const sync = modelBook?.offers.find(({ offer_key }) => offer_key === "sync");
    expect(
      sync?.terms
        .flatMap((term) => (term.kind === "rate" ? term.variants : []))
        .some(({ applicability }) =>
          applicability.any_of.some(({ all_of }) =>
            all_of.some(
              (condition) =>
                condition.kind === "categorical" &&
                condition.dimension.namespace === "kmodels" &&
                condition.dimension.value === "served_service_tier" &&
                condition.values.some(({ value: tier }) => tier === "priority"),
            ),
          ),
        ),
    ).toBe(true);
    const collections = partition?.books.find(
      ({ scope }) =>
        scope.kind === "provider_resource" && scope.resource_key === "collections-search",
    );
    expect(
      collections?.offers.flatMap(({ terms }) =>
        terms.flatMap((term) =>
          term.kind === "rate"
            ? term.variants.flatMap(({ charge_binding }) => charge_binding ?? [])
            : [],
        ),
      ),
    ).toEqual([
      expect.objectContaining({
        signal: {
          namespace: "provider",
          provider_id: "xai",
          value: "successful_collections_searches",
        },
      }),
    ]);
    const zdr = partition?.books.find(
      ({ scope }) =>
        scope.kind === "provider_resource" && scope.resource_key === "zero-data-retention",
    );
    expect(zdr?.offers[0]?.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "exclusive_with",
          target: expect.objectContaining({ kind: "offers" }),
        }),
      ]),
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

  it("accounts for public prices, regional applicability, and non-model commercial terms", async () => {
    const items: PricingReconciliationItem[] = [];
    const models = await xaiCatalog(
      "xai/models.txt",
      (body) => body,
      (body) => body,
      (item) => items.push(item),
    );
    const model = models.find(({ model_id }) => model_id === "grok-4.5");
    expect(
      model?.price_facts.find(
        ({ meter, conditions }) =>
          meter === "input_text" &&
          conditions.region === "us-east-1" &&
          conditions.service_tier === undefined &&
          conditions.context_max_tokens === 199_999,
      ),
    ).toMatchObject({ price: "2", unit: "million_tokens" });
    expect(model?.raw_price_facts).toEqual([]);
    const commercial = models.flatMap(({ commercial_facts }) => commercial_facts ?? []);
    expect(commercial).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resource_key: "collections",
          offer_key: "download",
          price_facts: [expect.objectContaining({ price: "0.2", unit: "gibibyte" })],
        }),
        expect.objectContaining({
          resource_key: "files",
          offer_key: "storage",
          price_facts: [expect.objectContaining({ price: "0.025", unit: "gibibyte_day" })],
        }),
        expect.objectContaining({
          resource_key: "responses-policy",
          offer_key: "pre-generation-violation",
          price_facts: [expect.objectContaining({ price: "0.05", unit: "request" })],
        }),
        expect.objectContaining({
          resource_key: "text-to-speech",
          price_facts: [expect.objectContaining({ price: "15", unit: "million_characters" })],
        }),
        expect.objectContaining({
          resource_key: "zero-data-retention",
          pricing_state: "not_published",
        }),
        expect.objectContaining({
          resource_key: "context-compaction",
          pricing_state: "not_published",
        }),
        expect.objectContaining({
          resource_key: "custom-voices",
          offer_key: "console",
          pricing_state: "free",
        }),
      ]),
    );
    expect(items).toContainEqual({
      disposition: "excluded",
      reason_code: "account_response_cost_out_of_catalog",
    });
  });

  it("isolates drift in one tool or Voice service price", async () => {
    const items: PricingReconciliationItem[] = [];
    const models = await xaiCatalog(
      "xai/models.txt",
      (body) => body,
      (body) =>
        body
          .replace(
            "| File Attachments | `attachment_search` | Search attachments | $10 |",
            "| Future Attachment Tool | `future_attachment` | Search attachments | $10 |",
          )
          .replaceAll(
            "| Text to Speech | $15.00 / 1M chars |",
            "| Text to Speech | Contact sales |",
          ),
      (item) => items.push(item),
    );
    const commercial = models.flatMap(({ commercial_facts }) => commercial_facts ?? []);
    expect(commercial.some(({ resource_key }) => resource_key === "attachment-search")).toBe(false);
    expect(commercial.some(({ resource_key }) => resource_key === "text-to-speech")).toBe(false);
    expect(commercial).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resource_key: "web-search" }),
        expect.objectContaining({ resource_key: "speech-to-text" }),
      ]),
    );
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          disposition: "unbound",
          reason_code: "tool_attachment-search_price_drift",
        }),
      ]),
    );
  });

  it("keeps accounting-document drift local to the affected claim", async () => {
    const items: PricingReconciliationItem[] = [];
    const models = await xaiCatalog(
      "xai/models.txt",
      (body) => body,
      (body) => body.replace("exact cost you were charged", "estimated cost"),
      (item) => items.push(item),
    );
    expect(models).toHaveLength(11);
    expect(items).toContainEqual({
      disposition: "unbound",
      reason_code: "exact_response_cost_contract_drift",
      sample: "xAI exact_response_cost contract drifted",
    });
    expect(models.flatMap(({ commercial_facts }) => commercial_facts ?? [])).toEqual(
      expect.arrayContaining([expect.objectContaining({ resource_key: "web-search" })]),
    );
  });

  it("derives endpoint bindings while keeping contract drift claim-local", async () => {
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
    const endpointItems: PricingReconciliationItem[] = [];
    const withoutEndpointJoin = await xaiCatalog(
      "xai/models.txt",
      (body) => body,
      (body) => body.replace("https://api.x.ai/v1/images/edits", "/v1/images/edits"),
      (item) => endpointItems.push(item),
    );
    expect(withoutEndpointJoin).toHaveLength(11);
    expect(
      withoutEndpointJoin.find(({ model_id }) => model_id === "grok-imagine-image-quality")
        ?.api_endpoints,
    ).toEqual([{ name: "Image Generations", path: "/v1/images/generations" }]);
    expect(
      withoutEndpointJoin.find(({ model_id }) => model_id === "grok-4.5")?.api_endpoints,
    ).toEqual([
      { name: "Chat Completions", path: "/v1/chat/completions" },
      { name: "Responses", path: "/v1/responses" },
    ]);
    expect(endpointItems).toContainEqual(
      expect.objectContaining({ disposition: "unbound", reason_code: "endpoint_contract_drift" }),
    );
    await expect(
      xaiCatalog("xai/models.txt", (body) =>
        body.replace('"languageModels":[', '"futureModels":[],"languageModels":['),
      ),
    ).rejects.toThrow("added categories: futureModels");
    await expect(
      xaiCatalog("xai/models.txt", (body) =>
        body.replace(
          '"batchDiscountPercent":0',
          '"futureCommercialFlag":true,"batchDiscountPercent":0',
        ),
      ),
    ).rejects.toThrow("public languageModels payload added fields: futureCommercialFlag");
    const pricingItems: PricingReconciliationItem[] = [];
    const withoutDerivedTerms = await xaiCatalog(
      "xai/models.txt",
      (body) => body,
      (body) => body.replace("- grok-4.3", "- future-model"),
      (item) => pricingItems.push(item),
    );
    expect(
      withoutDerivedTerms.some(({ price_facts }) =>
        price_facts.some(({ conditions }) => conditions.service_tier === "batch"),
      ),
    ).toBe(false);
    expect(pricingItems).toContainEqual(
      expect.objectContaining({
        disposition: "unbound",
        reason_code: "batch_pricing_terms_contract_drift",
      }),
    );
    const value = manifest("xai");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing xAI pricing source");
    const withoutBatchPrice = assembleParsedProviderPricing(
      value.provider.id,
      observedAt,
      [{ source, models: withoutDerivedTerms }],
      withoutDerivedTerms,
      value.pricingCategoricalLabels,
    )?.books.find(
      ({ scope }) => scope.kind === "models" && scope.model_refs.includes("xai/grok-4.3@1.0"),
    );
    expect(withoutBatchPrice?.offers.map(({ offer_key }) => offer_key)).toEqual(["sync"]);
    const voice = await xaiCatalog("xai/models-voice-services.txt", (body) =>
      body.replace('"aliases":["grok-voice-latest"]', '"aliases":[]'),
    );
    expect(voice.map(({ model_id }) => model_id)).toEqual(
      expect.arrayContaining(["grok-voice-think-fast-1.0", "grok-voice-think-fast-2.0"]),
    );
  });

  it("cross-checks independent official prices, model API schemas, and account surfaces", async () => {
    const value = manifest("xai");
    expect(value.sources[0]?.extractorVersion).toBe("xai-catalog-v9");
    expect(value.sources.find(({ id }) => id === "xai-api")?.extractorVersion).toBe("xai-api-v2");
    const priceItems: PricingReconciliationItem[] = [];
    const changedPrice = await xaiCatalog(
      "xai/models.txt",
      (body) => body,
      (body) =>
        body.replaceAll(
          "| grok-4.5 (< 200k prompt tokens) | 500k | $2.00",
          "| grok-4.5 (< 200k prompt tokens) | 500k | $2.10",
        ),
      (item) => priceItems.push(item),
    );
    expect(
      changedPrice
        .find(({ model_id }) => model_id === "grok-4.5")
        ?.price_facts.find(
          ({ meter, conditions }) =>
            meter === "input_text" &&
            conditions.context_max_tokens === 199_999 &&
            conditions.service_tier === undefined,
        ),
    ).toMatchObject({ price: "2.1" });
    expect(priceItems).toContainEqual({
      disposition: "ambiguous",
      reason_code: "structured_price_superseded",
      sample: "grok-4.5",
    });
    const contractItems: PricingReconciliationItem[] = [];
    const drifted = await xaiCatalog(
      "xai/models.txt",
      (body) => body,
      (body) =>
        body
          .replace("## GET /v1/video-generation-models", "## GET /v1/future-models")
          .replace("usage is calculated by cost in USD", "usage defaults to credits"),
      (item) => contractItems.push(item),
    );
    expect(drifted).toHaveLength(11);
    expect(contractItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          disposition: "unbound",
          reason_code: "model_api_contract_drift",
        }),
        expect.objectContaining({
          disposition: "unbound",
          reason_code: "console_usage_contract_drift",
        }),
      ]),
    );
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
    await expect(
      parsed("xai", "xai/language-api.json", "xai-language-api", (body) => {
        const value = z
          .object({ models: z.array(z.record(z.string(), z.unknown())).min(1) })
          .parse(JSON.parse(body));
        return JSON.stringify({ ...value, future_page: null });
      }),
    ).rejects.toThrow();
    await expect(
      parsed("xai", "xai/api.json", "xai-api", (body) => {
        const value = z
          .object({ data: z.array(z.record(z.string(), z.unknown())).min(1), object: z.string() })
          .parse(JSON.parse(body));
        const first = value.data[0];
        if (first === undefined) throw new Error("Missing xAI API fixture model");
        return JSON.stringify({ ...value, data: [{ ...first, future_price: 1 }] });
      }),
    ).rejects.toThrow();
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
  it("validates the complete first-party Bedrock model, accounting, and billing contract set", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Bedrock source");
    expect(source.extractorVersion).toBe("bedrock-catalog-v15");
    expect(source.linkedDocuments?.documents?.map(({ id }) => id)).toContain("pricing-agentcore");
    expect(source.linkedDocuments?.documents?.map(({ id }) => id)).toContain(
      "bedrock-agentcore-pricing",
    );
    expect(source.linkedDocuments?.documents?.map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        "bedrock-model-catalog-contract",
        "bedrock-list-foundation-models-contract",
        "bedrock-foundation-model-summary-contract",
        "bedrock-foundation-model-lifecycle-contract",
        "bedrock-converse-contract",
        "bedrock-count-tokens-contract",
        "bedrock-service-tiers-contract",
        "bedrock-conversation-usage-contract",
        "bedrock-prompt-caching-contract",
        "bedrock-token-counting-guide-contract",
        "bedrock-invocation-logging-contract",
        "bedrock-cost-management-contract",
        "bedrock-cur-contract",
        "aws-price-list-precedence-contract",
        "aws-price-list-bulk-contract",
        "aws-billing-latency-contract",
      ]),
    );
    const bundle = linkedBundle(await fixture("document/bedrock.json"));
    const contracts = linkedBundle(await fixture("document/bedrock-contracts.json"));
    bundle.documents.push(...contracts.documents);
    expect(
      parseSource({
        provider: provider(value),
        source,
        body: JSON.stringify(bundle),
        observedAt,
      }),
    ).toHaveLength(4);

    const canonical = bundle.documents.find(({ url }) => url.endsWith("models-supported.md"));
    if (canonical === undefined) throw new Error("Missing Bedrock contract fixture");
    canonical.body = canonical.body.replace("has moved", "might move");
    expect(() =>
      parseSource({
        provider: provider(value),
        source,
        body: JSON.stringify(bundle),
        observedAt,
      }),
    ).toThrow("canonical model catalog contract drifted");
  });

  it("requires all Bedrock contracts together and rejects duplicate official companions", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Bedrock source");
    const base = linkedBundle(await fixture("document/bedrock.json"));
    const contracts = linkedBundle(await fixture("document/bedrock-contracts.json"));
    base.documents.push(...contracts.documents.slice(1));
    expect(() =>
      parseSource({
        provider: provider(value),
        source,
        body: JSON.stringify(base),
        observedAt,
      }),
    ).toThrow("omitted official contract documents");

    const complete = linkedBundle(await fixture("document/bedrock.json"));
    const duplicate = contracts.documents[0];
    if (duplicate === undefined) throw new Error("Missing Bedrock contract fixture");
    complete.documents.push(...contracts.documents, duplicate);
    expect(() =>
      parseSource({
        provider: provider(value),
        source,
        body: JSON.stringify(complete),
        observedAt,
      }),
    ).toThrow("duplicated official document");
  });

  it("parses escaped Bedrock Markdown pipes and rejects irregular table rows", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Bedrock source");
    const escaped = linkedBundle(await fixture("document/bedrock.json"));
    const escapedCard = escaped.documents.find(({ url }) => url.includes("model-card-"));
    if (escapedCard === undefined) throw new Error("Missing Bedrock card fixture");
    escapedCard.body = escapedCard.body.replace(
      "us-east-1 (N. Virginia) | ![Yes]",
      "us-east-1 (N. Virginia \\| primary) | ![Yes]",
    );
    expect(
      parseSource({
        provider: provider(value),
        source,
        body: JSON.stringify(escaped),
        observedAt,
      }),
    ).toHaveLength(4);
    const irregular = linkedBundle(await fixture("document/bedrock.json"));
    const irregularCard = irregular.documents.find(({ url }) => url.includes("model-card-"));
    if (irregularCard === undefined) throw new Error("Missing Bedrock card fixture");
    irregularCard.body = irregularCard.body.replace(
      "us-east-1 (N. Virginia) | ![Yes](icon-yes.png) |",
      "us-east-1 (N. Virginia) | unexpected | ![Yes](icon-yes.png) |",
    );
    expect(() =>
      parseSource({
        provider: provider(value),
        source,
        body: JSON.stringify(irregular),
        observedAt,
      }),
    ).toThrow("Markdown table contained an irregular row");
  });

  it("uses the current public Bedrock page when the structured price lists lag", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Bedrock source");
    const fixtureBundle = linkedBundle(await fixture("document/bedrock.json"));
    const haiku = fixtureBundle.documents.find((document) =>
      document.url.endsWith("model-card-anthropic-claude-haiku-4-5.md"),
    );
    const mantle = fixtureBundle.documents.find((document) =>
      document.url.endsWith("bedrock-mantle.md"),
    );
    if (haiku === undefined || mantle === undefined)
      throw new Error("Missing Bedrock model card fixture");
    const body = JSON.stringify({
      index: fixtureBundle.index,
      documents: [
        mantle,
        {
          url: "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-5-5.md",
          body: haiku.body
            .replaceAll("Anthropic — Claude Haiku 4.5", "OpenAI — GPT-5.5")
            .replaceAll("Claude Haiku 4.5", "GPT-5.5")
            .replaceAll("anthropic.claude-haiku-4-5-20251001-v1:0", "openai.gpt-5.5")
            .replaceAll("anthropic.claude-haiku-4-5", "openai.gpt-5.5-mantle"),
        },
        {
          url: "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-stability-stable-image-remove-background.md",
          body: haiku.body
            .replaceAll(
              "Anthropic — Claude Haiku 4.5",
              "Stability AI — Stable Image Remove Background",
            )
            .replaceAll("Claude Haiku 4.5", "Stable Image Remove Background")
            .replaceAll(
              "anthropic.claude-haiku-4-5-20251001-v1:0",
              "stability.stable-image-remove-background-v1:0",
            )
            .replaceAll(
              "anthropic.claude-haiku-4-5",
              "stability.stable-image-remove-background-mantle",
            ),
        },
        {
          url: "https://aws.amazon.com/bedrock/pricing/",
          body: `<li role="tabpanel">
            <h2 id="OpenAI">OpenAI</h2>
            <div class="lb-rtxt"><p>Regions: US East (N. Virginia) &amp; US East (Ohio)</p></div>
            <div><table><tbody>
              <tr><td></td><td colspan="4">Short Context Window (272K)</td><td colspan="4">Long Context Window (1M)</td></tr>
              <tr><td>OpenAI models</td><td>Price per 1M input tokens</td><td>Price per 1M input tokens (30m cache write)</td><td>Price per 1M input tokens (cache read)</td><td>Price per 1M output tokens</td><td>Price per 1M input tokens</td><td>Price per 1M input tokens (30m cache write)</td><td>Price per 1M input tokens (cache read)</td><td>Price per 1M output tokens</td></tr>
              <tr><td>GPT-5.5</td><td>$ 5.50</td><td>-</td><td>$ 0.55</td><td>$ 33.00</td><td>-</td><td>-</td><td>-</td><td>-</td></tr>
            </tbody></table></div>
          </li>
          <li role="tabpanel">
            <h2 id="Stability_AI">Stability AI</h2>
            <table><tbody>
              <tr><td>Stability AI Image Services</td><td>Price per generation for each model</td><td></td></tr>
              <tr><td>Stable Image Remove Background</td><td>$0.07</td><td></td></tr>
            </tbody></table>
          </li>
          <li role="tabpanel">
            <h2 id="Model_Evaluation">Model Evaluation</h2>
            <p>
              Automatically-generated algorithmic scores are provided at no extra charge. Model
              inference remains billable, with a charge of $0.21 per completed human task.
            </p>
          </li>`,
        },
      ],
    });
    const reconciliation: { disposition: string; reason_code: string }[] = [];
    const models = parseSource({
      provider: provider(value),
      source,
      body,
      observedAt,
      onPricingReconciliation: (item) => reconciliation.push(item),
    });
    const model = models.find(({ model_id }) => model_id === "openai.gpt-5.5");
    expect(model?.price_facts).toHaveLength(6);
    expect(
      model?.price_facts.find(
        ({ meter, conditions }) => meter === "input_text" && conditions.region === "us-east-1",
      ),
    ).toMatchObject({
      price: "5.50",
      unit: "million_tokens",
      conditions: {
        deployment_scope: "in_region",
        service_tier: "standard",
        context_max_tokens: 272_000,
      },
    });
    const stability = models.find(
      ({ model_id }) => model_id === "stability.stable-image-remove-background-v1:0",
    );
    expect(stability?.price_facts).toHaveLength(3);
    expect(stability?.price_facts[0]).toMatchObject({
      meter: "image_generation",
      price: "0.07",
      unit: "image",
      conditions: { deployment_scope: "geo", service_tier: "standard" },
    });
    expect(
      models
        .flatMap(({ commercial_facts }) => commercial_facts ?? [])
        .filter(({ book_key }) => book_key === "service:model-evaluation"),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          offer_key: "human-evaluation",
          pricing_state: "numeric",
        }),
        expect.objectContaining({
          offer_key: "algorithmic-scores",
          pricing_state: "included",
        }),
      ]),
    );
    expect(reconciliation).toEqual([
      { disposition: "normalized", reason_code: "pricing_page_cell_bound" },
      {
        disposition: "excluded",
        reason_code: "price_cell_not_available",
        sample: "GPT-5.5: Price per 1M input tokens (30m cache write)",
      },
      { disposition: "normalized", reason_code: "pricing_page_cell_bound" },
      { disposition: "normalized", reason_code: "pricing_page_cell_bound" },
      ...Array.from({ length: 4 }, () => ({
        disposition: "excluded",
        reason_code: "price_cell_not_available",
        sample: expect.stringContaining("GPT-5.5"),
      })),
      { disposition: "normalized", reason_code: "pricing_page_cell_bound" },
    ]);
  });

  it("preserves Bedrock OpenAI short- and long-context price ranges", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Bedrock source");
    const fixtureBundle = linkedBundle(await fixture("document/bedrock.json"));
    const haiku = fixtureBundle.documents.find((document) =>
      document.url.endsWith("model-card-anthropic-claude-haiku-4-5.md"),
    );
    const mantle = fixtureBundle.documents.find((document) =>
      document.url.endsWith("bedrock-mantle.md"),
    );
    if (haiku === undefined || mantle === undefined)
      throw new Error("Missing Bedrock model card fixture");
    const body = JSON.stringify({
      index: fixtureBundle.index,
      documents: [
        mantle,
        {
          url: "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-56-sol.md",
          body: haiku.body
            .replaceAll("Anthropic — Claude Haiku 4.5", "OpenAI — GPT-5.6 Sol")
            .replaceAll("Claude Haiku 4.5", "GPT-5.6 Sol")
            .replaceAll("anthropic.claude-haiku-4-5-20251001-v1:0", "openai.gpt-5.6-sol-runtime")
            .replaceAll("anthropic.claude-haiku-4-5", "openai.gpt-5.6-sol"),
        },
        {
          url: "https://aws.amazon.com/bedrock/pricing/",
          body: `<li role="tabpanel">
            <h2 id="OpenAI">OpenAI</h2>
            <div class="lb-rtxt"><p>Region: US East (N. Virginia)</p></div>
            <div><table><tbody>
              <tr><td></td><td colspan="4">Short Context Window (272K)</td><td colspan="4">Long Context Window (1M)</td></tr>
              <tr><td>OpenAI models</td><td>Price per 1M input tokens</td><td>Price per 1M input tokens (30m cache write)</td><td>Price per 1M input tokens (cache read)</td><td>Price per 1M output tokens</td><td>Price per 1M input tokens</td><td>Price per 1M input tokens (30m cache write)</td><td>Price per 1M input tokens (cache read)</td><td>Price per 1M output tokens</td></tr>
              <tr><td>GPT-5.6 Sol</td><td>$5.50</td><td>$6.875</td><td>$0.55</td><td>$33.00</td><td>$11.00</td><td>$13.75</td><td>$1.10</td><td>$49.50</td></tr>
            </tbody></table></div>
          </li>
          <li role="tabpanel">
            <h2 id="Stability_AI">Stability AI</h2>
            <table><tbody><tr><td>Stability AI Image Services</td><td>Price per generation for each model</td></tr></tbody></table>
          </li>`,
        },
      ],
    });
    const model = parseSource({
      provider: provider(value),
      source,
      body,
      observedAt,
    }).find(({ model_id }) => model_id === "openai.gpt-5.6-sol");
    expect(model?.price_facts).toHaveLength(8);
    expect(
      model?.price_facts.find(
        ({ meter, conditions }) =>
          meter === "input_text" && conditions.context_min_tokens === 272_001,
      ),
    ).toMatchObject({
      price: "11.00",
      raw_unit: "Long Context Window (1M): Price per 1M input tokens",
      conditions: { context_min_tokens: 272_001, context_max_tokens: 1_000_000 },
    });
  });

  it("uses reviewed Bedrock pricing-page values when AWS price-list values disagree", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Bedrock source");
    const bundle = linkedBundle(
      (await fixture("document/bedrock-sonnet-pricing.json"))
        .replace(
          "USE1-Claude4Sonnet-input-tokens-cross-region-global",
          "USE1-Claude4Sonnet-input-tokens",
        )
        .replace("Claude4Sonnet input tokens cross region global", "Claude4Sonnet input tokens"),
    );
    const structured = bundle.documents.find((document) =>
      document.body.includes("USE1-Claude4Sonnet-input-tokens"),
    );
    if (structured === undefined) throw new Error("Missing Bedrock price-list fixture");
    structured.body = structured.body.replace(
      '"inferenceType":"Input tokens","model":"Claude Sonnet 4"',
      '"inferenceType":"Input tokens","model":"Claude Sonnet 4","service_tier":"standard"',
    );
    bundle.documents.push({
      url: "https://aws.amazon.com/bedrock/pricing/",
      body: `<li role="tabpanel">
        <h2 id="OpenAI">OpenAI</h2>
        <div class="lb-rtxt"><p>Region: US East (N. Virginia)</p></div>
        <div><table><tbody>
          <tr><td>OpenAI models</td><td>Price per 1M input tokens</td><td>Price per 1M output tokens</td></tr>
          <tr><td>Claude Sonnet 4</td><td>$ 99.00</td><td>N/A</td></tr>
        </tbody></table></div>
      </li>
      <li role="tabpanel">
        <h2 id="Stability_AI">Stability AI</h2>
        <table><tbody>
          <tr><td>Stability AI Image Services</td><td>Price per generation for each model</td></tr>
        </tbody></table>
      </li>`,
    });
    const reconciliation: { disposition: string; reason_code: string }[] = [];
    const models = parseSource({
      provider: provider(value),
      source,
      body: JSON.stringify(bundle),
      observedAt,
      onPricingReconciliation: (item) => reconciliation.push(item),
    });
    const sonnet = models.find(
      ({ model_id }) => model_id === "anthropic.claude-sonnet-4-20250514-v1:0",
    );
    expect(
      sonnet?.price_facts.find(
        ({ meter, conditions }) =>
          meter === "input_text" &&
          conditions.region === "us-east-1" &&
          conditions.endpoint === undefined &&
          conditions.service_tier === "standard" &&
          conditions.context_min_tokens === undefined,
      )?.price,
    ).toBe("99.00");
    expect(reconciliation).toContainEqual({
      disposition: "normalized",
      reason_code: "pricing_page_cell_overrode_price_list",
    });
  });

  it("uses the exact Cohere Embed 4 Marketplace rate card to resolve weaker dimensions", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Bedrock source");
    const bundle = linkedBundle(await fixture("document/bedrock.json"));
    const command = bundle.documents.find((document) =>
      document.url.endsWith("model-card-cohere-command-r.md"),
    );
    if (command === undefined) throw new Error("Missing Cohere Bedrock card fixture");
    bundle.documents.push({
      url: "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-cohere-embed-v4.md",
      body: command.body
        .replaceAll("Command R", "Cohere Embed 4")
        .replaceAll("cohere.command-r-v1:0", "cohere.embed-v4:0"),
    });
    const regions = `
      ap-northeast-1 ap-northeast-2 ap-northeast-3 ap-south-1 ap-south-2
      ap-southeast-1 ap-southeast-2 ap-southeast-3 ap-southeast-4 ca-central-1
      eu-central-1 eu-central-2 eu-north-1 eu-south-1 eu-south-2 eu-west-1 eu-west-2 eu-west-3
      sa-east-1 us-east-1 us-east-2 us-west-1 us-west-2
    `
      .trim()
      .split(/\s+/);
    const rateCards = regions.flatMap((region, index) =>
      [false, true].map((global) => ({
        dimensionKey: `R${index}_InputTokenCount${global ? "_Global" : ""}`,
        displayName: `Price per 1 million input tokens${global ? " Global" : ""}`,
        description: `Price per 1 million input tokens${global ? " Global" : ""}`,
        dimensionLabels: [{ type: "REGION", value: region, displayName: region }],
        unit: "Units",
        price: "0.12000000",
      })),
    );
    const pageContext = {
      routeParams: { listingId: "prodview-j3fgisven2yrs" },
      dehydratedState: {
        queries: Array.from({ length: 2 }, () => ({
          state: {
            data: {
              summary: {
                vendor: { vendorName: "Cohere" },
                pricingModel: "USAGE",
                terms: [
                  {
                    termType: "UsageBasedPricingTerm",
                    currencyCode: "USD",
                    rateCards,
                    rateCardCount: 46,
                    totalRateCards: 46,
                  },
                ],
              },
            },
          },
        })),
      },
    };
    bundle.documents.push({
      url: "https://aws.amazon.com/marketplace/pp/prodview-j3fgisven2yrs",
      body: `<title>AWS Marketplace: Cohere Embed 4 Model (Amazon Bedrock Edition)</title><script id="vike_pageContext">${JSON.stringify(pageContext)}</script>`,
    });
    const models = parseSource({
      provider: provider(value),
      source,
      body: JSON.stringify(bundle),
      observedAt,
    });
    const model = models.find(({ model_id }) => model_id === "cohere.embed-v4:0");
    if (model === undefined) throw new Error("Missing Cohere Embed 4 fixture model");
    expect(model.price_facts).toHaveLength(46);
    model.price_facts.push({
      meter: "input_text",
      price: "0.0000000200",
      currency: "USD",
      unit: "token",
      conditions: {
        deployment_scope: "in_region",
        endpoint: "bedrock-runtime",
        region: "us-east-1",
      },
      source_ref: source.id,
      derived: false,
      raw_price: "0.0000000200",
      raw_unit: "Embeddings",
    });
    const partition = assembleParsedProviderPricing(
      value.provider.id,
      observedAt,
      [{ source, models: [model] }],
      [model],
      value.pricingCategoricalLabels,
    );
    const term = partition?.books[0]?.offers[0]?.terms.find(
      (candidate) => candidate.kind === "rate" && candidate.meter.value === "input_text",
    );
    if (term?.kind !== "rate") throw new Error("Missing Cohere Embed 4 input term");
    expect(term.variants).not.toHaveLength(0);
    expect(term.raw_variants).toEqual([
      expect.objectContaining({
        impact: "informational",
        reason: "superseded_value",
        resolution_policy: "bedrock_marketplace_product_page_over_price_list",
      }),
    ]);
  });

  it("keeps Bedrock latency configuration separate from service tier and context tier", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Bedrock source");
    const body = (await fixture("document/bedrock.json")).replace(
      "USE1-ClaudeHaiku45-input-tokens",
      "USE1-ClaudeHaiku45-input-tokens-long-ctx-latency-optimized",
    );
    const model = parseSource({
      provider: provider(value),
      source,
      body,
      observedAt,
    }).find(({ model_id }) => model_id === "anthropic.claude-haiku-4-5-20251001-v1:0");
    expect(
      model?.price_facts.find(
        ({ meter, conditions }) => meter === "input_text" && conditions.speed === "optimized",
      ),
    ).toMatchObject({
      conditions: {
        region: "us-east-1",
        endpoint: "bedrock-runtime",
        deployment_scope: "in_region",
        service_tier: "standard",
        speed: "optimized",
        context_min_tokens: 200_001,
      },
    });
  });

  it("uses an explicit model-card route for Bedrock Responses variants", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Bedrock source");
    const bundle = linkedBundle(await fixture("document/bedrock.json"));
    const haiku = bundle.documents.find((document) =>
      document.url.endsWith("model-card-anthropic-claude-haiku-4-5.md"),
    );
    if (haiku === undefined) throw new Error("Missing Bedrock model card fixture");
    bundle.documents.push({
      url: "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-56-sol.md",
      body: haiku.body
        .replaceAll("Anthropic — Claude Haiku 4.5", "OpenAI — GPT-5.6 Sol")
        .replaceAll("Claude Haiku 4.5", "GPT-5.6 Sol")
        .replaceAll("anthropic.claude-haiku-4-5-20251001-v1:0", "openai.gpt-5.6-sol-runtime")
        .replaceAll("anthropic.claude-haiku-4-5", "openai.gpt-5.6-sol")
        .replace("![Yes](icon-yes.png) Messages", "![Yes](icon-yes.png) Responses")
        .replace(
          "## Capabilities and Features",
          "**Note**  \nThis model is available on the `openai/v1/responses` path on the `bedrock-mantle` endpoint.\n\n## Capabilities and Features",
        ),
    });
    const model = parseSource({
      provider: provider(value),
      source,
      body: JSON.stringify(bundle),
      observedAt,
    }).find(({ model_id }) => model_id === "openai.gpt-5.6-sol");
    expect(model?.api_endpoints).toEqual([{ name: "Responses", path: "openai/v1/responses" }]);
  });

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

  it("collects AgentCore services from the official Price List without creating model rows", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Bedrock source");
    const bundle = linkedBundle(await fixture("document/bedrock-pricing-identity.json"));
    const agentCore = await fixture("bedrock/agentcore-price-list.json");
    bundle.documents.push({
      url: "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrockAgentCore/current/index.json",
      body: agentCore,
    });
    bundle.documents.push({
      url: "https://aws.amazon.com/bedrock/agentcore/pricing/",
      body: await fixture("bedrock/agentcore-pricing.html"),
    });
    const reconciliation: PricingReconciliationItem[] = [];
    const models = parseSource({
      provider: provider(value),
      source,
      body: JSON.stringify(bundle),
      observedAt,
      onPricingReconciliation: (item) => reconciliation.push(item),
    });
    const commercial = models.flatMap(({ commercial_facts }) => commercial_facts ?? []);
    expect(models).toHaveLength(2);
    expect(commercial.map(({ book_key }) => book_key)).toEqual(
      expect.arrayContaining([
        "service:agentcore-runtime",
        "service:agentcore-browser",
        "service:agentcore-evaluations",
        "service:agentcore-gateway",
        "service:agentcore-memory",
        "service:agentcore-web-search",
        "service:agentcore-identity",
        "service:agentcore-optimization",
        "service:agentcore-registry",
        "service:agentcore-payments",
      ]),
    );
    expect(
      commercial
        .filter(({ book_key }) => book_key === "service:agentcore-browser")
        .flatMap(({ raw_price_facts }) => raw_price_facts.map(({ raw }) => raw.unit))
        .sort((left, right) => (left ?? "").localeCompare(right ?? "")),
    ).toEqual(["GB-Hours", "vCPU-Hours"]);
    expect(
      reconciliation.filter(({ reason_code }) => reason_code === "commercial_dimension_bound"),
    ).toHaveLength(7);
    expect(
      commercial
        .filter(({ book_key }) => book_key === "service:agentcore-registry")
        .flatMap(({ raw_price_facts }) => raw_price_facts),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ term_key: "records", impact: "base_price" }),
        expect.objectContaining({ term_key: "records-allowance", impact: "allowance" }),
      ]),
    );

    const driftedPage: PricingReconciliationItem[] = [];
    const driftedBundle = linkedBundle(JSON.stringify(bundle));
    const page = driftedBundle.documents.find(({ url }) =>
      url.endsWith("/bedrock/agentcore/pricing/"),
    );
    if (page === undefined) throw new Error("Missing AgentCore pricing-page fixture");
    page.body = page.body.replace("Search API Invocation", "Search API Calls");
    const driftedFacts = parseSource({
      provider: provider(value),
      source,
      body: JSON.stringify(driftedBundle),
      observedAt,
      onPricingReconciliation: (item) => driftedPage.push(item),
    }).flatMap(({ commercial_facts }) => commercial_facts ?? []);
    expect(driftedFacts.map(({ book_key }) => book_key)).toEqual(
      expect.arrayContaining(["service:agentcore-identity", "service:agentcore-registry"]),
    );
    expect(driftedPage).toContainEqual({
      disposition: "unsupported",
      reason_code: "pricing_page_row_drifted",
      sample: "AgentCore: Search API Invocation",
    });

    const malformed: PricingReconciliationItem[] = [];
    const malformedBundle = linkedBundle(JSON.stringify(bundle));
    const priceList = malformedBundle.documents.find(({ url }) =>
      url.includes("AmazonBedrockAgentCore"),
    );
    if (priceList === undefined) throw new Error("Missing AgentCore fixture document");
    priceList.body = priceList.body.replace(/"regionCode"\s*:\s*"us-east-1"/, '"regionCode":1');
    const retained = parseSource({
      provider: provider(value),
      source,
      body: JSON.stringify(malformedBundle),
      observedAt,
      onPricingReconciliation: (item) => malformed.push(item),
    }).flatMap(({ commercial_facts }) => commercial_facts ?? []);
    expect(
      retained
        .flatMap(({ raw_price_facts }) => raw_price_facts)
        .filter(({ raw }) => raw.label?.startsWith("AmazonBedrockAgentCore:")),
    ).toHaveLength(6);
    expect(malformed).toContainEqual(
      expect.objectContaining({
        disposition: "unsupported",
        reason_code: "price_product_rejected",
      }),
    );
  });

  it("retains unequal same-scope Bedrock prices as a claim-local conflict", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Bedrock source");
    const bundle = linkedBundle(await fixture("document/bedrock-pricing-identity.json"));
    const priceList = bundle.documents.find(({ url }) =>
      url.endsWith("AmazonBedrock/current/index.json"),
    );
    if (priceList === undefined) throw new Error("Missing Bedrock Price List fixture");
    const dimension =
      '"NOVA.DIM":{"description":"$0.000135 per 1K token for NovaMultiModalEmbeddings-input-tokens in US East (N. Virginia)","unit":"1K tokens","pricePerUnit":{"USD":"0.0001350000"}}';
    const conflict = dimension
      .replace("NOVA.DIM", "NOVA.CONFLICT")
      .replaceAll("0.000135", "0.000136");
    if (!priceList.body.includes(dimension)) throw new Error("Missing Nova price dimension");
    priceList.body = priceList.body.replace(dimension, `${dimension},${conflict}`);

    const models = parseSource({
      provider: provider(value),
      source,
      body: JSON.stringify(bundle),
      observedAt,
    });
    const nova = models.find(
      ({ model_id }) => model_id === "amazon.nova-2-multimodal-embeddings-v1:0",
    );
    expect(
      nova?.price_facts
        .filter(
          ({ meter, conditions }) => meter === "input_text" && conditions.region === "us-east-1",
        )
        .map(({ price }) => price),
    ).toEqual(expect.arrayContaining(["0.135", "0.136"]));
    if (nova === undefined) throw new Error("Missing Nova fixture model");
    const partition = assembleParsedProviderPricing(
      value.provider.id,
      observedAt,
      [{ source, models: [nova] }],
      [nova],
      value.pricingCategoricalLabels,
    );
    const input = partition?.books
      .flatMap(({ offers }) => offers)
      .flatMap(({ terms }) => terms)
      .find((term) => term.kind === "rate" && term.meter.value === "input_text");
    expect(input).toMatchObject({
      kind: "rate",
      raw_variants: expect.arrayContaining([
        expect.objectContaining({ reason: "conflicting_values" }),
      ]),
    });
  });

  it("keeps recognized Bedrock price siblings when one dimension is unsupported", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Bedrock source");
    const reconciliation: PricingReconciliationItem[] = [];
    const body = (await fixture("document/bedrock-pricing-identity.json")).replace(
      '\\"unit\\":\\"Search Units\\"',
      '\\"unit\\":\\"Unknown Units\\"',
    );

    const models = parseSource({
      provider: provider(value),
      source,
      body,
      observedAt,
      onPricingReconciliation: (item) => reconciliation.push(item),
    });
    expect(
      models.find(({ model_id }) => model_id === "amazon.nova-2-multimodal-embeddings-v1:0")
        ?.price_facts,
    ).not.toHaveLength(0);
    expect(reconciliation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          disposition: "unsupported",
          reason_code: "price_dimension_unsupported",
        }),
        expect.objectContaining({
          disposition: "unbound",
          reason_code: "pricing_interpretation_partial",
        }),
      ]),
    );
  });

  it("does not guess when a Bedrock price family matches multiple model cards", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Bedrock source");
    const bundle = linkedBundle(await fixture("document/bedrock-pricing-identity.json"));
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

    const reconciliation: PricingReconciliationItem[] = [];
    const models = parseSource({
      provider: provider(value),
      source,
      body: JSON.stringify(bundle),
      observedAt,
      onPricingReconciliation: (item) => reconciliation.push(item),
    });
    expect(
      models.find(({ model_id }) => model_id === "cohere.rerank-v3-5:0")?.price_facts,
    ).not.toHaveLength(0);
    expect(
      models.find(({ model_id }) => model_id === "amazon.nova-2-multimodal-embeddings-v1:0")
        ?.price_facts,
    ).toHaveLength(0);
    expect(reconciliation).toContainEqual(
      expect.objectContaining({
        disposition: "excluded",
        reason_code: "price_product_absent_from_current_catalog",
      }),
    );
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
      partition?.books
        .filter(({ scope }) =>
          scope.model_refs.includes("amazon-bedrock/amazon.titan-embed-image-v1"),
        )
        .flatMap(({ offers }) => offers)
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
      ["provisioned_capacity", 1, 0],
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
    const modelBook = partition?.books.find(
      ({ scope }) =>
        scope.kind === "models" &&
        scope.model_refs.includes("amazon-bedrock/anthropic.claude-sonnet-4-20250514-v1:0"),
    );
    const onDemand = modelBook?.offers.find(({ offer_key }) => offer_key === "on-demand");
    const batchOffer = modelBook?.offers.find(({ offer_key }) => offer_key === "batch");
    const terms = onDemand?.terms ?? [];
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
      ["input_text", 2, 0],
      ["output_text", 2, 0],
    ]);
    expect(
      batchOffer?.terms
        .map((term) => [term.term_key, term.kind === "rate" ? term.variants.length : 0])
        .sort(([left], [right]) => String(left).localeCompare(String(right))),
    ).toEqual([
      ["input_text", 1],
      ["output_text", 1],
    ]);

    const input = terms.find(({ term_key }) => term_key === "input_text");
    if (input?.kind !== "rate") throw new Error("Missing input price term");
    const standard = input.variants.find(({ observations }) =>
      observations.some(({ raw }) => raw.amount === "3.0000000000"),
    );
    const longContext = input.variants.find(({ observations }) =>
      observations.some(({ raw }) => raw.amount === "0.0060000000"),
    );
    const batchInput = batchOffer?.terms.find(({ term_key }) => term_key === "input_text");
    const batch = batchInput?.kind === "rate" ? batchInput.variants[0] : undefined;
    expect(
      modelBook?.offers.every(({ states }) =>
        states.every(({ validity }) => validity === undefined),
      ),
    ).toBe(true);
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
    expect(
      batch?.applicability.any_of[0]?.all_of.some(
        ({ dimension }) => dimension.namespace === "kmodels" && dimension.value === "service_tier",
      ),
    ).toBe(false);
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

  it("treats an effective Bedrock EOL date as retired despite a stale Legacy card label", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Bedrock source");
    const body = (await fixture("document/bedrock.json")).replace(
      "**Model EOL date:** N/A",
      "**Model EOL date:** Jun 20, 2026",
    );
    const model = parseSource({ provider: provider(value), source, body, observedAt }).find(
      (candidate) => candidate.model_id === "cohere.command-r-v1:0",
    );
    expect(model).toMatchObject({ status: "retired", retired_at: "2026-06-20" });
  });

  it("rejects invalid Bedrock lifecycle dates instead of normalizing them", async () => {
    const value = manifest("amazon-bedrock");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Bedrock source");
    const body = (await fixture("document/bedrock.json")).replace(
      "**Model launch date:** Oct 15, 2025",
      "**Model launch date:** Feb 30, 2025",
    );
    expect(() => parseSource({ provider: provider(value), source, body, observedAt })).toThrow(
      "launch date was not a valid date",
    );
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
    const bundle = linkedBundle(await fixture("document/bedrock.json"));
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

  it("normalizes live inventory enums and signals unknown additions without dropping rows", async () => {
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
        '"inputModalities": ["TEXT", "IMAGE", "EMBEDDING", "AUDIO", "VIDEO"]',
      )
      .replace(
        '"outputModalities": ["TEXT"]',
        '"outputModalities": ["TEXT", "EMBEDDING", "SPEECH"]',
      )
      .replace(
        '"customizationsSupported": ["FINE_TUNING"]',
        '"customizationsSupported": ["PREFERENCE_FINE_TUNING", "CONTINUED_PRE_TRAINING", "DISTILLATION"]',
      )
      .replace(
        '"inferenceTypesSupported": ["ON_DEMAND"]',
        '"inferenceTypesSupported": ["ON_DEMAND", "PROVISIONED", "INFERENCE_PROFILE"]',
      )
      .replace(
        '"status": "ACTIVE",',
        '"status": "ACTIVE",\n        "publicExtendedAccessTime": "2027-01-01T00:00:00.000Z",',
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
        input: ["text", "image", "embedding", "audio", "video"],
        output: ["text", "embedding", "audio"],
      },
      fineTuning: true,
    });
    expect(
      parseSource({
        provider: provider(value),
        source,
        body: body.replace(
          '"customizationsSupported": ["FINE_TUNING"]',
          '"customizationsSupported": ["CONTINUED_PRE_TRAINING", "DISTILLATION"]',
        ),
        observedAt,
      })[0]?.capabilities.fine_tuning,
    ).toBe(false);
    const findings: SourceContractEvidence[] = [];
    const unknown = parseSource({
      provider: provider(value),
      source,
      body: body
        .replace(
          '"inputModalities": ["TEXT", "IMAGE"]',
          '"inputModalities": ["TEXT", "IMAGE", "MUSIC"]',
        )
        .replace(
          '"customizationsSupported": ["FINE_TUNING"]',
          '"customizationsSupported": ["ADAPTER_TUNING"]',
        )
        .replace(
          '"inferenceTypesSupported": ["ON_DEMAND"]',
          '"inferenceTypesSupported": ["SERVERLESS"]',
        )
        .replace('"status": "ACTIVE"', '"status": "AVAILABLE"'),
      observedAt,
      onContractFinding: (finding) => findings.push(finding),
    })[0];
    expect(unknown).toMatchObject({
      modalities: { input: ["text", "image"], output: ["text"] },
      capabilities: { streaming: true, fine_tuning: "unknown" },
      release_date: "2025-10-15",
      status: "unknown",
    });
    expect(findings).toMatchObject([
      {
        disposition: "accept_with_signal",
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ kind: "unknown_value", observed_value: "MUSIC" }),
          expect.objectContaining({ kind: "unknown_value", observed_value: "ADAPTER_TUNING" }),
          expect.objectContaining({ kind: "unknown_value", observed_value: "SERVERLESS" }),
          expect.objectContaining({ kind: "unknown_value", observed_value: "AVAILABLE" }),
        ]),
      },
    ]);
    for (const changed of [
      body.replace("foundation-model/anthropic", "foundation-model/cohere"),
      body.replace(/^\s*"modelArn":.*\n/m, ""),
    ])
      expect(() =>
        parseSource({ provider: provider(value), source, body: changed, observedAt }),
      ).toThrow();
  });
});

describe("Vercel adapter", () => {
  it("keeps valid commercial siblings when one first-party claim drifts", () => {
    const documents = new Map(
      vercelDocumentation().map(({ url, body }) => [new URL(url).pathname, body]),
    );
    documents.set(
      "/docs/ai-gateway/models-and-providers/web-search.md",
      "The search products still exist, but their pricing presentation changed.",
    );
    documents.set(
      "/crawled-sitemap.xml",
      "<urlset><url><loc>https://vercel.com/docs/ai-gateway/observability-and-spend/new-metered-service</loc></url></urlset>",
    );
    const reconciliations: PricingReconciliationItem[] = [];
    const facts = vercelCommercialFacts({
      documents,
      sourceId: "vercel-models",
      modelRefs: ["vercel/acme/text-1"],
      modelRefById: new Map([["acme/text-1", "vercel/acme/text-1"]]),
      onPricingReconciliation: (item) => reconciliations.push(item),
    });
    expect(facts.map(({ resource_key: key }) => key)).not.toContain("perplexity-search");
    expect(facts.map(({ resource_key: key }) => key)).toEqual(
      expect.arrayContaining([
        "custom-reporting",
        "team-restrictions",
        "team-wide-zdr",
        "trace-drains",
        "byok",
        "free-tier",
      ]),
    );
    expect(reconciliations).toEqual(
      expect.arrayContaining([
        {
          disposition: "unsupported",
          reason_code: "generic_search_services_not_observed",
          sample: "/docs/ai-gateway/models-and-providers/web-search.md",
        },
        {
          disposition: "unsupported",
          reason_code: "unreviewed_commercial_page",
          sample: "/docs/ai-gateway/observability-and-spend/new-metered-service",
        },
      ]),
    );
  });

  it("classifies malformed JSON as a structured contract failure", async () => {
    await expect(vercelCatalog("vercel/normal.json", () => "{")).rejects.toThrow("invalid_json");
  });

  it("normalizes volatile route telemetry and the stable model-page pricing row", () => {
    expect(
      JSON.parse(
        normalizeVercelEndpointResponse(
          JSON.stringify({
            data: {
              id: "acme/text-1",
              endpoints: [
                {
                  name: "zeta | acme/text-1",
                  provider_name: "zeta",
                  pricing: { prompt: "0.000002" },
                  uptime_last_15m: 99.1,
                  latency_last_1h: { p50: 100 },
                },
                {
                  name: "alpha | acme/text-1",
                  provider_name: "alpha",
                  pricing: { prompt: "0.000001" },
                  uptime_last_1h: 100,
                  throughput_last_1h: { p50: 50 },
                },
              ],
            },
          }),
        ),
      ),
    ).toEqual({
      data: {
        id: "acme/text-1",
        endpoints: [
          {
            name: "alpha | acme/text-1",
            provider_name: "alpha",
            pricing: { prompt: "0.000001" },
          },
          {
            name: "zeta | acme/text-1",
            provider_name: "zeta",
            pricing: { prompt: "0.000002" },
          },
        ],
      },
    });
    expect(
      JSON.parse(
        normalizeVercelModelPage(`
          <h1>Rerank One</h1>
          <table><tr><th>Provider</th></tr></table>
          <table><tr><th>Input</th><th></th></tr></table>
          <table><tr>
            <td><a href="/ai-gateway/models/providers/acme">Acme</a></td>
            <td><span title="Per 1,000 queries">$2/K</span></td>
            <td></td>
          </tr></table>
        `),
      ),
    ).toEqual({
      title: "Rerank One",
      provider: "acme",
      headers: ["Provider", "Input"],
      values: ["Acme", "$2/K"],
      titles: [[], ["Per 1,000 queries"]],
    });
  });

  it("joins route-specific endpoint prices and model-page fallbacks from one official bundle", async () => {
    const value = manifest("vercel");
    const configured = value.sources[0];
    if (configured === undefined || configured.extractor.kind !== "vercel-catalog")
      throw new Error("Missing Vercel source");
    const source: SourceManifest = {
      ...configured,
      extractor: { kind: "vercel-catalog", minModels: 1, maxModels: 20 },
    };
    const endpoint = {
      data: {
        id: "acme/text-1",
        name: "Text One",
        created: 1_755_815_280,
        released: 1_748_476_800,
        description: "A text model.",
        architecture: null,
        endpoints: [
          {
            name: "acme | acme/text-1",
            model_name: "Text One",
            pricing: {
              prompt: "0",
              completion: "0",
              request: "0",
              image: "0",
              image_output: "0",
              web_search: "0",
              internal_reasoning: "0",
              discount: 0,
            },
            provider_name: "acme",
            quantization: null,
            status: 0,
            supports_implicit_caching: false,
          },
        ],
      },
    };
    const page = {
      title: "Text One",
      provider: "acme",
      headers: ["Provider", "Context", "Input", "Output", "Web Search", "Release Date"],
      values: ["Acme", "32K", "$1/M", "$2/M", "$5/K*+2 more", "05/29/2025"],
      titles: [[], [], [], [], [], []],
    };
    const body = JSON.stringify({
      index: { url: source.url, body: await fixture("vercel/normal.json") },
      documents: [
        {
          url: "https://ai-gateway.vercel.sh/v1/models/acme/text-1/endpoints",
          body: JSON.stringify(endpoint),
        },
        {
          url: "https://vercel.com/ai-gateway/models/text-1",
          body: JSON.stringify(page),
        },
        ...vercelDocumentation(),
      ],
    });
    const reconciliations: PricingReconciliationItem[] = [];
    const models = parseSource({
      provider: provider(value),
      source,
      body,
      observedAt,
      onPricingReconciliation: (item) => reconciliations.push(item),
    });
    const model = models[0];
    expect({
      routes: model?.routes,
      rates: model?.price_facts.map(({ meter, price, unit, conditions }) => ({
        meter,
        price,
        unit,
        conditions,
      })),
      raw: model?.raw_price_facts,
      pricingState: model?.pricing_state,
    }).toEqual({
      routes: [
        {
          source_ref: "vercel-models",
          provider: "acme",
          provider_model_id: "acme/text-1",
          task: "language",
          status: "live",
        },
      ],
      rates: [
        {
          meter: "input_text",
          price: "1",
          unit: "million_tokens",
          conditions: { route_provider: "acme" },
        },
        {
          meter: "output_text",
          price: "2",
          unit: "million_tokens",
          conditions: { route_provider: "acme" },
        },
      ],
      raw: [
        {
          term_key: "model_page_web_search",
          impact: "base_price",
          reason: "unknown_applicability",
          conditions: { route_provider: "acme" },
          source_ref: "vercel-models",
          raw: {
            label: "Web Search",
            denomination: "USD",
            fragment: "$5/K*+2 more",
          },
        },
      ],
      pricingState: "numeric",
    });
    expect(
      dispositionCounts(reconciliations, ["normalized", "raw", "explicit_non_numeric", "excluded"]),
    ).toEqual({ normalized: 10, raw: 1, explicit_non_numeric: 1, excluded: 23 });
    expect(model?.commercial_facts?.map(({ resource_key: key }) => key)).toEqual([
      "perplexity-search",
      "exa-search",
      "parallel-search",
      "custom-reporting",
      "custom-reporting",
      "model-allowlist",
      "provider-allowlist",
      "team-restrictions",
      "team-wide-zdr",
      "trace-drains",
      "byok",
      "free-tier",
    ]);
    const pricing = assembleParsedProviderPricing(
      "vercel",
      observedAt,
      [{ source, models }],
      models,
      value.pricingCategoricalLabels,
    );
    expect(pricing?.books.map(({ book_key: key }) => key)).toEqual(
      expect.arrayContaining([
        "model:vercel/acme/text-1",
        "service:native-web-search",
        "service:perplexity-search",
        "service:exa-search",
        "service:parallel-search",
        "service:custom-reporting",
        "account:model-allowlist",
        "account:provider-allowlist",
        "service:team-restrictions",
        "service:team-wide-zdr",
        "service:trace-drains",
        "plan:free-tier",
      ]),
    );
    const modelBook = pricing?.books.find(
      ({ book_key: key }) => key === "model:vercel/acme/text-1",
    );
    expect(modelBook?.offers.map(({ offer_key: key }) => key)).toEqual([
      "byok",
      "system-credentials",
    ]);
    const freeTier = pricing?.books.find(({ book_key: key }) => key === "plan:free-tier");
    expect(freeTier?.offers[0]?.terms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "allowance", term_key: "free-credit-allowance" }),
        expect.objectContaining({ kind: "raw", term_key: "free-tier-eligibility-conflict" }),
      ]),
    );
    const trace = pricing?.books.find(({ book_key: key }) => key === "service:trace-drains");
    expect(trace?.offers[0]?.terms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "rate", term_key: "trace-delivery", variants: [] }),
        expect.objectContaining({ kind: "rate", term_key: "data_transfer" }),
      ]),
    );
  });

  it("declares endpoint, missing-price page, and commercial-policy collection", () => {
    const source = manifest("vercel").sources[0];
    expect(source).toMatchObject({
      transport: {
        kind: "vercel-models",
        minModelPages: 0,
        maxModelPages: 50,
        concurrency: 12,
      },
      fields: expect.arrayContaining(["pricing", "routes"]),
      linkedDocuments: {
        minDocuments: 0,
        maxDocuments: 0,
        documents: expect.arrayContaining([
          expect.objectContaining({ id: "models-and-providers" }),
          expect.objectContaining({ id: "pricing-policy" }),
          expect.objectContaining({ id: "model-directory" }),
          expect.objectContaining({ id: "sitemap" }),
          expect.objectContaining({ id: "provider-options" }),
          expect.objectContaining({ id: "provider-filtering-and-ordering" }),
          expect.objectContaining({ id: "fast-mode" }),
          expect.objectContaining({ id: "service-tiers" }),
          expect.objectContaining({ id: "web-search" }),
          expect.objectContaining({ id: "regional-inference" }),
          expect.objectContaining({ id: "byok" }),
          expect.objectContaining({ id: "rest-api" }),
          expect.objectContaining({ id: "custom-reporting" }),
          expect.objectContaining({ id: "model-allowlist" }),
          expect.objectContaining({ id: "provider-allowlist" }),
          expect.objectContaining({ id: "zdr" }),
          expect.objectContaining({ id: "trace-drains" }),
          expect.objectContaining({ id: "logs" }),
          expect.objectContaining({ id: "usage" }),
        ]),
      },
    });
  });

  it("treats an omitted video audio-generation disclosure as unknown", async () => {
    expect((await vercelCatalog("vercel/pricing.json")).map(({ model_id }) => model_id)).toContain(
      "acme/video-1",
    );
    await expect(
      vercelCatalog("vercel/pricing.json", (body) =>
        body.replace('"supported_fps": [24]', '"generate_audio": "yes", "supported_fps": [24]'),
      ),
    ).rejects.toThrow("contract mismatch");
  });

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
    const models = await vercelCatalog("vercel/pricing.json");
    const model = models[0];
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
        .filter((rate) => rate.meter === "web_search" || rate.meter === "maps_search")
        .map((rate) => ({
          meter: rate.meter,
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
        {
          meter: "web_search",
          operation: "web_search",
          price: "10",
          unit: "thousand_requests",
        },
        {
          meter: "maps_search",
          operation: "maps_search",
          price: "14",
          unit: "thousand_requests",
        },
      ],
    });
    const value = manifest("vercel");
    const source = value.sources[0];
    if (source === undefined) throw new Error("Missing Vercel pricing source");
    const pricing = assembleParsedProviderPricing(
      "vercel",
      observedAt,
      [{ source, models }],
      models,
      value.pricingCategoricalLabels,
    );
    const web = pricing?.books.find(({ book_key: key }) => key === "service:native-web-search");
    const maps = pricing?.books.find(({ book_key: key }) => key === "service:native-maps-search");
    expect(web?.offers[0]?.terms[0]).toMatchObject({
      kind: "rate",
      meter: { namespace: "kmodels", value: "web_search" },
      variants: [expect.objectContaining({ charge_binding: expect.any(Object) })],
    });
    expect(maps?.offers[0]?.terms[0]).toMatchObject({
      kind: "rate",
      meter: { namespace: "kmodels", value: "maps_search" },
      variants: [expect.not.objectContaining({ charge_binding: expect.anything() })],
    });
    const system = pricing?.books
      .find(({ book_key: key }) => key === "model:vercel/acme/text-1")
      ?.offers.find(({ offer_key: key }) => key === "system-credentials");
    const input = system?.terms.find(
      (term) =>
        term.kind === "rate" &&
        term.meter.namespace === "kmodels" &&
        term.meter.value === "input_text",
    );
    expect(input).toMatchObject({
      kind: "rate",
      variants: expect.arrayContaining([
        expect.not.objectContaining({ charge_binding: expect.anything() }),
      ]),
    });
  });

  it("repairs the reviewed one-token overlap in half-open route tiers", async () => {
    const model = (
      await vercelCatalog("vercel/pricing.json", (body) =>
        body.replace('"min": 0, "max": 32000', '"min": 0, "max": 32001'),
      )
    )[0];
    expect(
      model?.price_facts
        .filter(({ meter }) => meter === "cache_read_text")
        .map(({ conditions }) => ({
          min: conditions.context_min_tokens,
          max: conditions.context_max_tokens,
        })),
    ).toEqual([
      { min: 0, max: 32000 },
      { min: 32001, max: undefined },
    ]);
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

  it("keeps resolution-specific video-token tiers distinct", async () => {
    const model = (
      await vercelCatalog("vercel/pricing.json", (body) =>
        body.replace(
          `"no_video_input": { "cost_per_million_tokens": "7" },
          "with_video_input": { "cost_per_million_tokens": "4.3" },`,
          `"tiers": [
            {
              "resolution": "480p",
              "no_video_input": { "cost_per_million_tokens": "7" },
              "with_video_input": { "cost_per_million_tokens": "4.3" }
            },
            {
              "resolution": "1080p",
              "no_video_input": { "cost_per_million_tokens": "7.7" },
              "with_video_input": { "cost_per_million_tokens": "4.7" }
            }
          ],`,
        ),
      )
    ).find(({ model_id }) => model_id === "acme/video-token-1");
    expect(model?.price_facts.map(({ price, conditions }) => ({ price, conditions }))).toEqual([
      { price: "7", conditions: { resolution: "480p", video_input: false } },
      { price: "4.3", conditions: { resolution: "480p", video_input: true } },
      { price: "7.7", conditions: { resolution: "1080p", video_input: false } },
      { price: "4.7", conditions: { resolution: "1080p", video_input: true } },
    ]);
  });

  it("publishes the official free tag as an exact free disposition", async () => {
    const model = (
      await vercelCatalog("vercel/normal.json", (body) =>
        body.replace('"tags": ["vision"]', '"tags": ["free"]'),
      )
    )[0];
    expect(model).toMatchObject({ pricing_state: "free", price_facts: [] });
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

  it("rejects changes to owned semantics and observes unrelated extensions", async () => {
    await expect(vercelCatalog("vercel/broken.json")).rejects.toThrow("contract mismatch");
    let finding: SourceContractEvidence | undefined;
    const models = await vercelCatalog(
      "vercel/normal.json",
      (body) => body.replace('"object": "model"', '"object": "model", "new_field": true'),
      (value) => {
        finding = value;
      },
    );
    expect(models).toHaveLength(1);
    expect(finding).toMatchObject({
      disposition: "accept_with_signal",
      observed_items: 1,
      diagnostic_count: 1,
      diagnostics: [
        {
          kind: "unknown_field",
          path: "/new_field",
          observed: "boolean",
          observed_value: "true",
          affected_items: 1,
          sample_model_ids: ["acme/text-1"],
        },
      ],
    });
    for (const edit of [
      (body: string) => body.replace('"vision"', '"new-tag"'),
      (body: string) => body.replace('"max_tokens", "stop"', '"new_parameter", "stop"'),
      (body: string) => body.replace('"v2", "v3", "v4"', '"v2", "v3", "v5"'),
    ])
      await expect(vercelCatalog("vercel/normal.json", edit)).rejects.toThrow("contract mismatch");
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

  async function publicBody(
    index: string,
    overrides: Readonly<Partial<Record<"openrouter" | "huggingface" | "contract", string>>> = {},
  ): Promise<string> {
    return JSON.stringify({
      index: { url: source("cerebras-models").url, body: index },
      documents: [
        {
          url: "https://api.cerebras.ai/public/v1/models?format=openrouter",
          body: overrides.openrouter ?? (await fixture("cerebras/public-openrouter.json")),
        },
        {
          url: "https://api.cerebras.ai/public/v1/models?format=huggingface",
          body: overrides.huggingface ?? (await fixture("cerebras/public-huggingface.json")),
        },
        {
          url: "https://inference-docs.cerebras.ai/api-reference/models/public-models.md",
          body: overrides.contract ?? (await fixture("cerebras/public-models.md")),
        },
      ],
    });
  }

  async function parse(
    id: string,
    path: string,
    onPricingReconciliation?: (item: PricingReconciliationItem) => void,
    onContractFinding?: (finding: SourceContractEvidence) => void,
  ): Promise<ProviderModel[]> {
    const value = manifest("cerebras");
    const fixtureBody = await fixture(path);
    const body = id === "cerebras-models" ? await publicBody(fixtureBody) : fixtureBody;
    return parseSource({
      provider: provider(value),
      source: source(id),
      body,
      observedAt,
      ...(onPricingReconciliation === undefined ? {} : { onPricingReconciliation }),
      ...(onContractFinding === undefined ? {} : { onContractFinding }),
    });
  }

  interface CerebrasCatalogOptions {
    omit?: readonly string[];
    onPricingReconciliation?: (item: PricingReconciliationItem) => void;
    overrides?: Readonly<Record<string, string>>;
  }

  async function catalog(options: CerebrasCatalogOptions = {}): Promise<ProviderModel[]> {
    const value = manifest("cerebras");
    const configured = source("cerebras-catalog");
    const companions = [
      ["/models/openai-oss.md", "gpt", "md"],
      ["/models/gemma-4-31b.md", "gemma", "md"],
      ["/models/zai-glm-47.md", "glm", "md"],
      ["/models/choose-a-model.md", "choose", "md"],
      ["/capabilities/prompt-caching.md", "cache", "md"],
      ["/api-reference/chat-completions.md", "chat-completions", "md"],
      ["/api-reference/completions.md", "completions", "md"],
      ["/capabilities/service-tiers.md", "service-tiers", "md"],
      ["/llms.txt", "llms", "txt"],
      ["/api-reference/models/public-models.md", "public-models", "md"],
      ["/capabilities/image-inputs.md", "image-inputs", "md"],
      ["/capabilities/reasoning.md", "reasoning", "md"],
      ["/dedicated/predicted-outputs.md", "predicted-outputs", "md"],
      ["/capabilities/tool-use.md", "tool-use", "md"],
      ["/capabilities/batch.md", "batch", "md"],
      ["/api-reference/file/upload-file.md", "batch-file", "md"],
      ["/console/account-billing.md", "account-billing", "md"],
      ["/console/overview.md", "console-overview", "md"],
      ["/console/usage-monitoring.md", "usage-monitoring", "md"],
      ["/console/projects.md", "projects", "md"],
      ["/support/rate-limits.md", "rate-limits", "md"],
      ["/capabilities/metrics.md", "metrics", "md"],
      ["/api-reference/metrics/retrieve-metrics.md", "metrics-api", "md"],
      ["/dedicated/overview.md", "dedicated", "md"],
      ["/integrations/aws-marketplace.md", "aws-marketplace", "md"],
      ["/api-reference/versions.md", "api-versions", "md"],
      ["/api-reference/openapi.yaml", "openapi", "yaml"],
      ["/support/pricing.md", "pricing", "html"],
    ] as const;
    const body = JSON.stringify({
      index: { url: configured.url, body: await fixture("cerebras/catalog.md") },
      documents: await Promise.all(
        companions
          .filter(([, name]) => !options.omit?.includes(name))
          .map(async ([path, name, extension]) => ({
            url: `https://inference-docs.cerebras.ai${path}`,
            body: options.overrides?.[name] ?? (await fixture(`cerebras/${name}.${extension}`)),
          })),
      ),
    });
    return parseSource({
      provider: provider(value),
      source: configured,
      body,
      observedAt,
      ...(options.onPricingReconciliation === undefined
        ? {}
        : { onPricingReconciliation: options.onPricingReconciliation }),
    });
  }

  async function lifecycle(
    body?: string,
    onPricingReconciliation?: (item: PricingReconciliationItem) => void,
  ): Promise<ProviderModel[]> {
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
      ...(onPricingReconciliation === undefined ? {} : { onPricingReconciliation }),
    });
  }

  it("retains structured capabilities without treating created=0 as a release", async () => {
    const model = (await parse("cerebras-models", "cerebras/public.json")).find(
      ({ model_id }) => model_id === "gemma-4-31b",
    );
    expect(model?.capabilities.reasoning).toBe(true);
    expect(model?.tasks).toEqual(["text_generation"]);
    expect(model?.capabilities.structured_output).toBe(true);
    expect(model?.status).toBe("active");
    expect(model?.release_stage).toBe("stable");
    expect(model?.release_date).toBeUndefined();
  });

  it("normalizes native rates and reconciles both official compatibility formats", async () => {
    const reconciliation: PricingReconciliationItem[] = [];
    const models = await parse("cerebras-models", "cerebras/public.json", (item) =>
      reconciliation.push(item),
    );
    const model = models.find(({ model_id }) => model_id === "gemma-4-31b");
    expect(model?.release_date).toBeUndefined();
    expect({
      id: model?.model_id,
      input: model?.price_facts.find((rate) => rate.meter === "input_text")?.price,
      output: model?.price_facts.find((rate) => rate.meter === "output_text")?.price,
      pricing_state: model?.pricing_state,
    }).toEqual({
      id: "gemma-4-31b",
      input: "0.99",
      output: "1.49",
      pricing_state: "numeric",
    });
    expect(sourcePricingReconciliation(models, reconciliation, true)).toMatchObject({
      disposition_counts: { normalized: 12, excluded: 1 },
    });
    expect(reconciliation).toEqual(
      expect.arrayContaining([
        {
          disposition: "normalized",
          reason_code: "openrouter_format_rate_corroborated",
          sample: "gemma-4-31b:input_text",
        },
        {
          disposition: "normalized",
          reason_code: "huggingface_format_rate_corroborated",
          sample: "gemma-4-31b:output_text",
        },
      ]),
    );
  });

  it("signals additive native fields and isolates compatibility-format disagreement", async () => {
    const native = (await fixture("cerebras/public.json")).replace(
      '"deprecated": false,',
      '"future_optional": true, "deprecated": false,',
    );
    let finding: SourceContractEvidence | undefined;
    const value = manifest("cerebras");
    const models = parseSource({
      provider: provider(value),
      source: source("cerebras-models"),
      body: await publicBody(native),
      observedAt,
      onContractFinding: (item) => {
        finding = item;
      },
    });
    expect(models).toHaveLength(2);
    expect(finding).toMatchObject({
      disposition: "accept_with_signal",
      observed_items: 2,
      diagnostics: [
        {
          kind: "unknown_field",
          path: "/future_optional",
          observed_value: "true",
          affected_items: 1,
          sample_model_ids: ["gpt-oss-120b"],
        },
      ],
    });
    const openrouter = (await fixture("cerebras/public-openrouter.json")).replace(
      '"prompt": "0.00000035"',
      '"prompt": "0.00000036"',
    );
    const divergentBody = await publicBody(await fixture("cerebras/public.json"), { openrouter });
    const reconciliation: PricingReconciliationItem[] = [];
    const retained = parseSource({
      provider: provider(value),
      source: source("cerebras-models"),
      body: divergentBody,
      observedAt,
      onPricingReconciliation: (item) => reconciliation.push(item),
    });
    expect(retained).toHaveLength(2);
    expect(
      retained
        .find(({ model_id }) => model_id === "gpt-oss-120b")
        ?.price_facts.find(({ meter }) => meter === "input_text")?.price,
    ).toBe("0.35");
    expect(reconciliation).toContainEqual({
      disposition: "unbound",
      reason_code: "openrouter_format_rate_conflict",
      sample: "gpt-oss-120b:input_text",
    });
  });

  it("retains native rows and usable price claims when optional compatibility data drifts", async () => {
    const value = manifest("cerebras");
    const native = (await fixture("cerebras/public.json"))
      .replace('"data": [', '"data": [{"id":"broken","object":"future"},')
      .replace('"prompt": "0.00000035"', '"prompt": "invalid"');
    const reconciliation: PricingReconciliationItem[] = [];
    const models = parseSource({
      provider: provider(value),
      source: source("cerebras-models"),
      body: JSON.stringify({
        index: { url: source("cerebras-models").url, body: native },
        documents: [],
      }),
      observedAt,
      onPricingReconciliation: (item) => reconciliation.push(item),
    });
    expect(models.map(({ model_id }) => model_id)).toEqual(["gemma-4-31b", "gpt-oss-120b"]);
    expect(
      models
        .find(({ model_id }) => model_id === "gpt-oss-120b")
        ?.price_facts.map(({ meter, price }) => [meter, price]),
    ).toEqual([["output_text", "0.75"]]);
    expect(reconciliation.map(({ reason_code }) => reason_code)).toEqual(
      expect.arrayContaining([
        "public_price_claim_drift",
        "public_model_identity_drift",
        "openrouter_format_model_missing",
        "huggingface_format_model_missing",
      ]),
    );
  });

  it("parses model cards, scheduled lifecycle, and cached-input pricing", async () => {
    const reconciliation: PricingReconciliationItem[] = [];
    const models = await catalog({
      onPricingReconciliation: (item) => reconciliation.push(item),
    });
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
    expect(sourcePricingReconciliation(models, reconciliation, true).basis).toBe("source_item");
    expect(reconciliation).toEqual(
      expect.arrayContaining([
        {
          disposition: "normalized",
          reason_code: "cache_rate_normalized",
          sample: "gpt-oss-120b:cache_read_text",
        },
        {
          disposition: "explicit_non_numeric",
          reason_code: "monthly_subscription_rates_account_scoped",
        },
        {
          disposition: "raw",
          reason_code: "console_cost_reporting_preserved",
        },
        {
          disposition: "unbound",
          reason_code: "usage_cost_api_not_documented",
        },
        {
          disposition: "explicit_non_numeric",
          reason_code: "batch_rate_not_published",
        },
        {
          disposition: "unbound",
          reason_code: "model_card_prose_rate_conflict",
          sample: "gemma-4-31b:input_text",
        },
        {
          disposition: "normalized",
          reason_code: "pricing_page_rate_corroborated",
          sample: "gemma-4-31b:output_text",
        },
        {
          disposition: "normalized",
          reason_code: "cerebras_code_plans_normalized",
        },
      ]),
    );
  });

  it("keeps catalog rows when model cards or commercial companions are unavailable", async () => {
    const missingCard = await catalog({ omit: ["gemma"] });
    expect(missingCard).toHaveLength(3);
    expect(missingCard.find(({ model_id }) => model_id === "gemma-4-31b")).toMatchObject({
      name: "Gemma 4 31B",
      release_stage: "preview",
      pricing_state: "unknown",
      price_facts: [],
    });
    const onlyCards = await catalog({
      omit: [
        "choose",
        "cache",
        "chat-completions",
        "completions",
        "service-tiers",
        "llms",
        "public-models",
        "image-inputs",
        "reasoning",
        "predicted-outputs",
        "tool-use",
        "batch",
        "batch-file",
        "account-billing",
        "console-overview",
        "usage-monitoring",
        "projects",
        "rate-limits",
        "metrics",
        "metrics-api",
        "dedicated",
        "aws-marketplace",
        "api-versions",
        "openapi",
        "pricing",
      ],
    });
    expect(onlyCards).toHaveLength(3);
    expect(
      onlyCards.every(({ price_facts }) =>
        ["input_text", "output_text"].every((meter) =>
          price_facts.some((rate) => rate.meter === meter),
        ),
      ),
    ).toBe(true);
    expect(
      onlyCards.every(({ raw_price_facts }) =>
        raw_price_facts.some(
          ({ term_key }) => term_key === "accounting_binding_unavailable:settlement",
        ),
      ),
    ).toBe(true);
  });

  it("isolates endpoint, pricing, API, companion, and discovery drift", async () => {
    async function expectDrift(
      overrides: Readonly<Record<string, string>>,
      reasonCode: string,
    ): Promise<PricingReconciliationItem[]> {
      const reconciliation: PricingReconciliationItem[] = [];
      expect(
        await catalog({
          overrides,
          onPricingReconciliation: (item) => reconciliation.push(item),
        }),
      ).toHaveLength(3);
      expect(reconciliation.map(({ reason_code }) => reason_code)).toContain(reasonCode);
      return reconciliation;
    }

    const chat = (await fixture("cerebras/chat-completions.md")).replace(
      "operationId: createChatCompletion",
      "operationId: renamedChatCompletion",
    );
    await expectDrift({ "chat-completions": chat }, "chat_operation_contract_drift");
    const completions = (await fixture("cerebras/completions.md")).replace(
      "v1/completions",
      "v1/renamed",
    );
    await expectDrift({ completions }, "completions_operation_contract_drift");
    const get = (await fixture("cerebras/completions.md")).replace("curl -X POST", "curl -X GET");
    await expectDrift({ completions: get }, "completions_operation_contract_drift");
    const gpt = (await fixture("cerebras/gpt.md")).replace('"Chat Completions"', '"Responses"');
    const endpointReconciliation: PricingReconciliationItem[] = [];
    const endpointModels = await catalog({
      overrides: { gpt },
      onPricingReconciliation: (item) => endpointReconciliation.push(item),
    });
    expect(endpointModels.find(({ model_id }) => model_id === "gpt-oss-120b")?.api_endpoints).toBe(
      undefined,
    );
    expect(endpointReconciliation.map(({ reason_code }) => reason_code)).toContain(
      "model_endpoint_unrecognized",
    );
    const wrongUnit = (await fixture("cerebras/gpt.md")).replace("/ M tokens", "/ requests");
    const unitReconciliation: PricingReconciliationItem[] = [];
    const unitModels = await catalog({
      overrides: { gpt: wrongUnit },
      onPricingReconciliation: (item) => unitReconciliation.push(item),
    });
    expect(
      unitModels
        .find(({ model_id }) => model_id === "gpt-oss-120b")
        ?.price_facts.map(({ meter }) => meter),
    ).toEqual(["output_text"]);
    expect(unitReconciliation.map(({ reason_code }) => reason_code)).toContain(
      "model_card_input_price_drift",
    );
    const missingUnit = (await fixture("cerebras/gemma.md")).replace(
      "per million tokens",
      "per request",
    );
    await expectDrift({ gemma: missingUnit }, "model_card_input_price_drift");
    const serviceTiers = (await fixture("cerebras/service-tiers.md")).replace(
      "all service tiers are billed equally",
      "service tiers may be billed differently",
    );
    await expectDrift({ "service-tiers": serviceTiers }, "service_tier_pricing_contract_drift");
    const openapi = (await fixture("cerebras/openapi.yaml")).replace(
      "/v1/chat/completions",
      "/v2/chat/completions",
    );
    await expectDrift({ openapi }, "openapi_contract_drift");
    const apiVersions = (await fixture("cerebras/api-versions.md")).replace(
      "Version 2 is now the default",
      "Version 3 is now the default",
    );
    await expectDrift({ "api-versions": apiVersions }, "api_version_contract_drift");
    const usage = (await fixture("cerebras/usage-monitoring.md")).replace(
      "delayed by up to 10 minutes",
      "updated later",
    );
    await expectDrift({ "usage-monitoring": usage }, "cost_reporting_contract_drift");
    const pricing = (await fixture("cerebras/pricing.html")).replace(
      "$$0.35/M tokens",
      () => "$$0.36/M tokens",
    );
    expect(await expectDrift({ pricing }, "pricing_page_rate_conflict")).toContainEqual({
      disposition: "unbound",
      reason_code: "pricing_page_rate_conflict",
      sample: "gpt-oss-120b:input_text",
    });
    const llms = await fixture("cerebras/llms.txt");
    await expectDrift(
      { llms: `${llms}\n- [Costs](https://inference-docs.cerebras.ai/api-reference/costs.md)` },
      "commercial_page_pending_review",
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
    const reconciliation: PricingReconciliationItem[] = [];
    const unresolved = await lifecycle(
      (await fixture("cerebras/lifecycle.md")).replace(
        "[Qwen 3 32B](/models/qwen-3-32b)",
        "[Unknown replacement](/models/qwen-3-32b)",
      ),
      (item) => reconciliation.push(item),
    );
    expect(
      unresolved.find(({ model_id }) => model_id === "deepseek-r1-distill-llama-70b")
        ?.replacement_model_ids,
    ).toEqual([]);
    expect(reconciliation).toContainEqual({
      disposition: "unbound",
      reason_code: "replacement_model_unresolved",
      sample: "/models/qwen-3-32b",
    });
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
      {
        source: source("cerebras-catalog"),
        models: await catalog({ overrides: { gemma } }),
      },
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

  it("publishes the official commercial topology without inventing account-only amounts", async () => {
    const value = manifest("cerebras");
    const models = await catalog();
    const pricing = assembleParsedProviderPricing(
      "cerebras",
      observedAt,
      [{ source: source("cerebras-catalog"), models }],
      models,
      value.pricingCategoricalLabels,
    );
    if (pricing === undefined) throw new Error("Missing Cerebras pricing");
    const resource = (key: string) =>
      pricing.books.find(
        ({ scope }) => scope.kind === "provider_resource" && scope.resource_key === key,
      );
    const gpt = models.find(({ model_id }) => model_id === "gpt-oss-120b");
    if (gpt === undefined) throw new Error("Missing Cerebras GPT OSS model");
    const payg = pricing.books
      .find(({ scope }) => scope.kind === "models" && scope.model_refs.includes(gpt.uid))
      ?.offers.find(({ offer_key }) => offer_key === "payg");
    expect(payg?.settlement).toEqual([
      expect.objectContaining({
        channel: "direct",
        biller: "Cerebras",
        payment_sources: ["prepaid_balance", "provider_credit"],
      }),
    ]);
    expect(
      payg?.terms.flatMap((term) =>
        term.kind === "rate"
          ? term.variants.flatMap(({ charge_binding }) =>
              charge_binding === undefined ? [] : [[term.meter.value, charge_binding.signal.value]],
            )
          : [],
      ),
    ).toEqual(
      expect.arrayContaining([
        ["input_text", "uncached_input_tokens"],
        ["cache_read_text", "cached_input_tokens"],
        ["output_text", "output_tokens"],
      ]),
    );

    const trial = resource("free-trial")?.offers[0];
    expect(trial?.enrollment).toEqual([expect.objectContaining({ state: "open" })]);
    expect(trial?.terms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "allowance",
          term_key: "free-trial-credit",
          variants: [
            expect.objectContaining({
              benefit: expect.objectContaining({
                kind: "credit",
                denomination: { kind: "fiat", currency: "USD" },
              }),
              target: expect.objectContaining({ kind: "offers" }),
            }),
          ],
        }),
      ]),
    );

    const subscription = resource("inference-subscription");
    expect(subscription?.offers).toHaveLength(3);
    expect(
      subscription?.offers.every(({ relations }) => relations[0]?.kind === "exclusive_with"),
    ).toBe(true);
    expect(
      subscription?.offers.every(({ terms }) =>
        terms.some((term) => term.kind === "raw" && term.term_key === "subscription-amount"),
      ),
    ).toBe(true);

    const batch = resource("batch");
    expect(batch?.offers).toHaveLength(3);
    expect(batch?.offers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          enrollment: [expect.objectContaining({ state: "private_preview" })],
          relations: expect.arrayContaining([
            expect.objectContaining({ kind: "exclusive_with" }),
            expect.objectContaining({ kind: "requires" }),
          ]),
        }),
      ]),
    );
    expect(resource("batch-file")?.offers[0]?.enrollment).toEqual([
      expect.objectContaining({ state: "private_preview" }),
    ]);

    expect(resource("cerebras-code")?.offers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          offer_key: "pro",
          enrollment: [expect.objectContaining({ state: "closed_to_new" })],
        }),
        expect.objectContaining({
          offer_key: "max",
          enrollment: [expect.objectContaining({ state: "closed_to_new" })],
        }),
      ]),
    );
    expect(resource("dedicated-endpoint")?.offers[0]).toMatchObject({
      enrollment: [expect.objectContaining({ state: "account_scoped" })],
      settlement: [expect.objectContaining({ channel: "direct", biller: "Cerebras" })],
    });
    expect(resource("model-development")?.offers[0]?.states[0]?.state).toBe("custom_quote");
    expect(resource("aws-marketplace")?.offers[0]).toMatchObject({
      enrollment: [expect.objectContaining({ state: "account_scoped" })],
      settlement: [expect.objectContaining({ channel: "marketplace", biller: "AWS Marketplace" })],
      relations: [expect.objectContaining({ kind: "compatible_with" })],
    });
    expect(
      pricing.vocabulary.atoms.some(
        (atom) => atom.kind === "allowance_reset" && atom.key === "30_days_after_grant",
      ),
    ).toBe(true);
  });

  it("signals additive authenticated inventory fields", async () => {
    const value = manifest("cerebras");
    const body = (await fixture("cerebras/api.json")).replace(
      '"owned_by": "Cerebras"',
      '"owned_by": "Cerebras", "account_hint": true',
    );
    let finding: SourceContractEvidence | undefined;
    const models = parseSource({
      provider: provider(value),
      source: source("cerebras-api"),
      body,
      observedAt,
      onContractFinding: (item) => {
        finding = item;
      },
    });
    expect(models).toHaveLength(1);
    expect(finding).toMatchObject({
      disposition: "accept_with_signal",
      diagnostics: [
        {
          kind: "unknown_field",
          path: "/account_hint",
          affected_items: 1,
          sample_model_ids: ["gpt-oss-120b"],
        },
      ],
    });
  });

  it("skips only malformed authenticated inventory rows", async () => {
    const value = manifest("cerebras");
    const body = (await fixture("cerebras/api.json")).replace(
      '"data": [',
      '"data": [{"id":"broken","object":"future"},',
    );
    expect(
      parseSource({
        provider: provider(value),
        source: source("cerebras-api"),
        body,
        observedAt,
      }).map(({ model_id }) => model_id),
    ).toEqual(["gpt-oss-120b"]);
  });

  it("rejects an empty catalog", async () => {
    await expect(parse("cerebras-models", "cerebras/broken.json")).rejects.toThrow(
      "contract mismatch",
    );
  });
});

describe("Hugging Face adapter", () => {
  it("uses HF-operated presence sources and exact provider-native overlays", () => {
    const sources = manifest("huggingface").sources;
    const expectedPartners = [
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
    ];
    expect(sources.map(({ id, role }) => ({ id, role }))).toEqual([
      { id: "huggingface-hf-inference", role: "catalog" },
      { id: "huggingface-router", role: "catalog" },
      { id: "huggingface-featherless", role: "overlay" },
      { id: "huggingface-hub", role: "overlay" },
    ]);
    const mappings = sources[0];
    expect(mappings?.extractorVersion).toBe("huggingface-mapping-v8");
    expect(mappings?.extractor).toEqual({
      kind: "huggingface-mapping",
      providers: expectedPartners,
      minModels: 1,
      maxModels: 100_000,
      minRoutes: 1,
      maxRoutes: 200_000,
    });
    expect(mappings?.transport).toMatchObject({
      kind: "huggingface-partner-models",
      providers: expectedPartners,
    });
    expect(mappings?.linkedDocuments).toMatchObject({
      indexFormat: "mixed",
      minDocuments: 10,
      maxDocuments: 128,
      requestSuffix: ".md",
      documents: [
        {
          id: "task-index",
          url: "https://huggingface.co/docs/inference-providers/en/tasks/index.md",
        },
      ],
    });
    expect(sources[1]?.extractorVersion).toBe("huggingface-router-v9");
    expect(sources[2]).toMatchObject({
      extractorVersion: "huggingface-featherless-v1",
      optional: true,
      pricingRequired: true,
      transport: { kind: "featherless-models", pageSize: 1000 },
    });
    expect(sources[3]?.extractorVersion).toBe("huggingface-hub-v2");
  });

  it("discovers current task documents without a task URL allowlist", () => {
    const source = manifest("huggingface").sources[0];
    if (source?.linkedDocuments === undefined)
      throw new Error("Missing Hugging Face task discovery policy");
    const urls = linkedDocumentUrls(
      [
        '<a href="./chat-completion">Chat Completion</a>',
        "[Feature Extraction](./feature-extraction)",
      ].join("\n"),
      {
        ...source,
        url: "https://huggingface.co/docs/inference-providers/en/tasks/index.md",
        linkedDocuments: {
          ...source.linkedDocuments,
          minDocuments: 2,
          maxDocuments: 2,
        },
      },
    );
    expect(urls.map(({ href }) => href)).toEqual([
      "https://huggingface.co/docs/inference-providers/en/tasks/chat-completion.md",
      "https://huggingface.co/docs/inference-providers/en/tasks/feature-extraction.md",
    ]);
  });

  it("overlays only exact Featherless HF routes with native first-party prices", async () => {
    const value = manifest("huggingface");
    const baseSource = huggingFaceMappingSource(value);
    if (baseSource.extractor.kind !== "huggingface-mapping")
      throw new Error("Missing Hugging Face mapping source");
    const mappingSource: SourceManifest = {
      ...baseSource,
      extractor: { ...baseSource.extractor, providers: ["featherless-ai"] },
    };
    const mappings = parseSource({
      provider: provider(value),
      source: mappingSource,
      body: huggingFaceMappingBody(await fixture("huggingface/normal.json"), "featherless-ai"),
      observedAt,
    });
    const reconciliation: PricingReconciliationItem[] = [];
    const native = await huggingFaceFeatherless(
      (body) => body,
      mappings,
      (item) => reconciliation.push(item),
    );
    expect(native.map(({ model_id }) => model_id)).toEqual(["org/model-1"]);
    expect(native[0]).toMatchObject({
      limits: { context_tokens: 65536, max_output_tokens: 8192 },
      pricing_state: "numeric",
      price_facts: [
        {
          meter: "input_text",
          price: "0.25",
          unit: "million_tokens",
          conditions: { route_provider: "featherless-ai" },
          resolution_policy: "featherless_native_price_over_huggingface_route_snapshot",
        },
        {
          meter: "output_text",
          price: "1.5",
          unit: "million_tokens",
          conditions: { route_provider: "featherless-ai" },
          resolution_policy: "featherless_native_price_over_huggingface_route_snapshot",
        },
      ],
    });
    expect(reconciliation).toEqual(
      expect.arrayContaining([
        {
          disposition: "excluded",
          reason_code: "featherless_model_not_hf_route",
          sample: "outside/native-only",
        },
        {
          disposition: "unresolved",
          reason_code: "hf_live_route_absent_from_featherless_active_catalog",
          sample: "org/embed-model",
        },
      ]),
    );

    const combined = applyGroups(
      mappings,
      [{ source: huggingFaceFeatherlessSource(value), models: native }],
      false,
    );
    expect(combined.map(({ model_id }) => model_id)).toEqual(
      mappings.map(({ model_id }) => model_id),
    );
    expect(combined.find(({ model_id }) => model_id === "org/model-1")?.price_facts).toHaveLength(
      2,
    );
    expect(combined.find(({ model_id }) => model_id === "org/embed-model")?.pricing_state).toBe(
      "unknown",
    );
  });

  it("keeps usable Featherless meters and resolves native/listing price conflicts", async () => {
    const reconciliations: PricingReconciliationItem[] = [];
    const models = await huggingFaceFeatherless(
      (body) =>
        body
          .replace('"completion": "0.0000015"', '"completion": "invalid"')
          .replace('"input": 0.25', '"input": 0.75'),
      undefined,
      (item) => reconciliations.push(item),
    );
    const model = models.find(({ model_id }) => model_id === "org/model-1");
    if (model === undefined) throw new Error("Missing Featherless fixture model");
    expect(
      model.price_facts.map(({ meter, price, resolution_policy }) => [
        meter,
        price,
        resolution_policy,
      ]),
    ).toEqual([
      ["input_text", "0.25", "featherless_native_price_over_huggingface_route_snapshot"],
      ["input_text", "0.75", undefined],
      ["output_text", "1.5", "featherless_native_price_over_huggingface_route_snapshot"],
    ]);
    expect(reconciliations).toContainEqual({
      disposition: "ambiguous",
      reason_code: "featherless_price_unit_conflict",
      sample: "org/model-1",
    });

    const source = huggingFaceFeatherlessSource(manifest("huggingface"));
    const routerSource = huggingFaceRouterSource(manifest("huggingface"));
    const router = await huggingFaceRouter("huggingface/pricing.json", (body) =>
      body.replace(
        '"context_length": 32768',
        '"context_length": 32768, "pricing": { "input": 9, "output": 9 }',
      ),
    );
    const published = applyGroups(router, [{ source, models: [model] }], false);
    const partition = assembleParsedProviderPricing(
      "huggingface",
      observedAt,
      [
        { source: routerSource, models: router },
        { source, models: [model] },
      ],
      published,
      manifest("huggingface").pricingCategoricalLabels,
    );
    const term = partition?.books
      .find(({ book_key }) => book_key === "model:huggingface/org/model-1")
      ?.offers.find(({ offer_key }) => offer_key === "hf-routed")
      ?.terms.find(
        (candidate) => candidate.kind === "rate" && candidate.meter.value === "input_text",
      );
    if (term?.kind !== "rate") throw new Error("Missing Featherless input rate");
    const nativeVariant = term.variants.find(({ observations }) =>
      observations.some(({ source_ref }) => source_ref === "huggingface-featherless"),
    );
    expect(nativeVariant?.price.value).toEqual({ numerator: "1", denominator: "4000000" });
    expect(term.raw_variants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          impact: "informational",
          reason: "superseded_value",
          resolution_policy: "featherless_native_price_over_huggingface_route_snapshot",
        }),
      ]),
    );
    expect(
      term.raw_variants.flatMap(({ observations }) =>
        observations.map(({ source_ref }) => source_ref),
      ),
    ).toEqual(expect.arrayContaining(["huggingface-router", "huggingface-featherless"]));
  });

  it("publishes documented concrete mappings and preserves unknown task routes", async () => {
    const reconciliation: PricingReconciliationItem[] = [];
    const models = await huggingFaceMapping("huggingface/normal.json", (item) =>
      reconciliation.push(item),
    );
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
    expect(dispositionCounts(reconciliation, ["excluded", "unbound"])).toEqual({
      excluded: 1,
      unbound: 5,
    });
    expect(reconciliation).toContainEqual({
      disposition: "unbound",
      reason_code: "hf_inference_compute_price_unbound",
      sample: "org/model-1:hf-inference:conversational",
    });
    expect(reconciliation).toContainEqual({
      disposition: "excluded",
      reason_code: "dynamic_lora_tag_filter_not_model_identity",
      sample: "hf-inference:text-to-image:tag-filter=base_model:adapter:org/base,lora",
    });
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

  it("preserves partner-specific routes and newly observed official tasks", async () => {
    const value = manifest("huggingface");
    const base = huggingFaceMappingSource(value);
    const source: SourceManifest = {
      ...base,
      extractor: {
        kind: "huggingface-mapping",
        providers: ["hf-inference", "deepinfra"],
        minModels: 1,
        maxModels: 10,
        minRoutes: 2,
        maxRoutes: 10,
      },
    };
    const reconciliation: PricingReconciliationItem[] = [];
    const models = parseSource({
      provider: provider(value),
      source,
      body: huggingFaceMappingBundle(
        [
          {
            provider: "hf-inference",
            models: {
              conversational: {
                "org/model-1": {
                  _id: "hf-route",
                  providerId: "upstream/chat",
                  status: "live",
                },
              },
            },
          },
          {
            provider: "deepinfra",
            models: {
              "image-text-to-video": {
                "org/model-1": {
                  _id: "deepinfra-route",
                  providerId: "upstream/video",
                  status: "live",
                },
              },
            },
          },
        ],
        ["org/documented-sentinel"],
      ),
      observedAt,
      onPricingReconciliation: (item) => reconciliation.push(item),
    });
    expect(models[0]).toMatchObject({
      model_id: "org/model-1",
      tasks: ["text_generation", "video_generation"],
      modalities: { input: ["text", "image"], output: ["text", "video"] },
      routes: [
        {
          provider: "deepinfra",
          provider_model_id: "upstream/video",
          task: "image-text-to-video",
        },
        {
          provider: "hf-inference",
          provider_model_id: "upstream/chat",
          task: "conversational",
        },
      ],
    });
    expect(reconciliation).toContainEqual({
      disposition: "unbound",
      reason_code: "partner_route_price_not_published",
      sample: "org/model-1:deepinfra:image-text-to-video",
    });
  });

  it("admits HF-operated routes and bounded partner evidence", () => {
    const value = manifest("huggingface");
    const base = huggingFaceMappingSource(value);
    const source: SourceManifest = {
      ...base,
      extractor: {
        kind: "huggingface-mapping",
        providers: ["hf-inference", "deepinfra"],
        minModels: 1,
        maxModels: 10,
        minRoutes: 1,
        maxRoutes: 20,
      },
    };
    const reconciliation: PricingReconciliationItem[] = [];
    const route = (id: string) => ({ _id: id, providerId: id, status: "live" });
    const body = JSON.stringify({
      partners: [
        {
          provider: "hf-inference",
          models: {
            conversational: {
              "org/multi-provider": route("hf-multi"),
              "org/hf-inference": route("hf-owned"),
            },
          },
        },
        {
          provider: "deepinfra",
          models: {
            conversational: {
              "org/featured": route("deepinfra-featured"),
              "org/inventory-only": route("deepinfra-inventory"),
              "org/multi-provider": route("deepinfra-multi"),
              "org/recommended": route("deepinfra-recommended"),
            },
          },
        },
      ],
      documents: [
        {
          url: "https://huggingface.co/docs/inference-providers/en/tasks/chat-completion.md",
          body: [
            "### Recommended models",
            "",
            "- [org/recommended](https://huggingface.co/org/recommended): Recommended.",
            "",
            "### Using the API",
            "",
            '<InferenceSnippet providersMapping={ {"deepinfra":{"modelId":"org/featured","providerModelId":"featured"}} } />',
          ].join("\n"),
        },
      ],
    });
    const models = parseSource({
      provider: provider(value),
      source,
      body,
      observedAt,
      onPricingReconciliation: (item) => reconciliation.push(item),
    });
    expect(models.map(({ model_id }) => model_id)).toEqual([
      "org/featured",
      "org/hf-inference",
      "org/multi-provider",
      "org/recommended",
    ]);
    expect(reconciliation).toContainEqual({
      disposition: "excluded",
      reason_code: "single_partner_inventory_without_product_evidence",
    });
    expect(JSON.stringify(reconciliation)).not.toContain("org/inventory-only");
  });

  it("keeps concrete traditional, extractive, mixed, and unknown task mappings", () => {
    const value = manifest("huggingface");
    const base = huggingFaceMappingSource(value);
    const source: SourceManifest = {
      ...base,
      extractor: {
        kind: "huggingface-mapping",
        providers: ["hf-inference"],
        minModels: 1,
        maxModels: 10,
        minRoutes: 2,
        maxRoutes: 10,
      },
    };
    const reconciliation: PricingReconciliationItem[] = [];
    const models = parseSource({
      provider: provider(value),
      source,
      body: huggingFaceMappingBundle(
        [
          {
            provider: "hf-inference",
            models: {
              conversational: {
                "org/mixed-model": {
                  _id: "chat-route",
                  providerId: "upstream/chat",
                  status: "live",
                },
              },
              "sentence-similarity": {
                "org/similarity-model": {
                  _id: "similarity-route",
                  providerId: "upstream/similarity",
                  status: "live",
                },
              },
              "text-classification": {
                "org/mixed-model": {
                  _id: "mixed-classifier-route",
                  providerId: "upstream/mixed-classifier",
                  status: "live",
                },
                "org/classifier-only": {
                  _id: "classifier-route",
                  providerId: "upstream/classifier",
                  status: "live",
                },
              },
              "question-answering": {
                "org/extractive-qa": {
                  _id: "qa-route",
                  providerId: "upstream/qa",
                  status: "live",
                },
              },
              "future-task": {
                "org/unknown-only": {
                  _id: "unknown-route",
                  providerId: "upstream/unknown",
                  status: "live",
                },
              },
            },
          },
        ],
        [
          "org/classifier-only",
          "org/extractive-qa",
          "org/mixed-model",
          "org/similarity-model",
          "org/unknown-only",
        ],
      ),
      observedAt,
      onPricingReconciliation: (item) => reconciliation.push(item),
    });
    expect(models.map(({ model_id }) => model_id)).toEqual([
      "org/classifier-only",
      "org/extractive-qa",
      "org/mixed-model",
      "org/similarity-model",
      "org/unknown-only",
    ]);
    expect(models.find(({ model_id }) => model_id === "org/mixed-model")).toMatchObject({
      tasks: ["text_generation", "classification"],
      routes: [{ task: "conversational" }, { task: "text-classification" }],
    });
    expect(models.find(({ model_id }) => model_id === "org/similarity-model")).toMatchObject({
      tasks: ["reranking"],
      modalities: { input: ["text"], output: [] },
    });
    expect(models.find(({ model_id }) => model_id === "org/classifier-only")).toMatchObject({
      tasks: ["classification"],
      modalities: { input: ["text"], output: ["text"] },
      routes: [{ task: "text-classification" }],
    });
    expect(models.find(({ model_id }) => model_id === "org/extractive-qa")).toMatchObject({
      tasks: [],
      modalities: { input: ["text"], output: ["text"] },
      routes: [{ task: "question-answering" }],
    });
    expect(models.find(({ model_id }) => model_id === "org/unknown-only")).toMatchObject({
      tasks: [],
      modalities: { input: [], output: [] },
      routes: [{ task: "future-task" }],
    });
    expect(reconciliation).toHaveLength(6);
    expect(reconciliation.every(({ disposition }) => disposition === "unbound")).toBe(true);
  });

  it("skips invalid dynamic LoRA filters without rejecting the source", async () => {
    const value = manifest("huggingface");
    const source = huggingFaceMappingSource(value);
    const body = await fixture("huggingface/normal.json");
    for (const invalid of [
      body.replace('"adapterType": "lora"', '"adapterType": "future"'),
      body.replace(
        '"tags": ["base_model:adapter:org/base", "lora"]',
        '"tags": ["base_model:adapter:org/other", "lora"]',
      ),
    ]) {
      const reconciliation: PricingReconciliationItem[] = [];
      expect(
        parseSource({
          provider: provider(value),
          source,
          body: huggingFaceMappingBody(invalid),
          observedAt,
          onPricingReconciliation: (item) => reconciliation.push(item),
        }),
      ).toHaveLength(3);
      expect(reconciliation).toContainEqual({
        disposition: "excluded",
        reason_code: "invalid_dynamic_lora_filter",
        sample: "hf-inference:text-to-image:tag-filter=base_model:adapter:org/base,lora",
      });
    }
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
      const reconciliation: PricingReconciliationItem[] = [];
      const models = parseSource({
        provider: provider(value),
        source,
        body: huggingFaceMappingBody(body),
        observedAt,
        onPricingReconciliation: (item) => reconciliation.push(item),
      });
      expect(
        models.some(
          (model) => model.model_id === "org/model-1" || model.model_id === credentialLikeId,
        ),
      ).toBe(false);
      const audit = sourcePricingReconciliation(models, reconciliation, true);
      expect(audit.reason_counts?.credential_like_identifier).toBe(1);
      expect(JSON.stringify(audit)).not.toContain(credentialLikeId);
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
      { name: "Responses", path: "/v1/responses" },
    ]);
    expect(model?.release_date).toBeUndefined();
    expect(model?.price_facts.some((rate) => rate.conditions.route_provider === "groq")).toBe(
      false,
    );
    expect(models.some((item) => item.model_id === "org/unavailable-model")).toBe(false);
    expect(
      free?.price_facts.map((rate) => [rate.meter, rate.price, rate.conditions.promotion]),
    ).toEqual([
      ["input_text", "0", false],
      ["output_text", "0.0", false],
    ]);
    expect(free?.raw_price_facts).toContainEqual(
      expect.objectContaining({
        term_key: "route_promotional_free",
        conditions: { route_provider: "publicai", promotion: true },
      }),
    );
  });

  it("reconciles route prices and provider-wide account billing semantics", async () => {
    const items: PricingReconciliationItem[] = [];
    await huggingFaceRouter(
      "huggingface/pricing.json",
      (body) => body,
      (_path, body) => body,
      (item) => items.push(item),
    );
    expect(
      dispositionCounts(items, [
        "normalized",
        "raw",
        "explicit_non_numeric",
        "excluded",
        "unbound",
        "ambiguous",
        "unsupported",
        "unresolved",
      ]),
    ).toEqual({
      normalized: 3,
      raw: 0,
      explicit_non_numeric: 1,
      excluded: 9,
      unbound: 1,
      ambiguous: 3,
      unsupported: 0,
      unresolved: 0,
    });
    expect(items).toContainEqual({
      disposition: "unbound",
      reason_code: "route_price_not_published",
      sample: "org/model-1:featherless-ai",
    });
    expect(items).toContainEqual({
      disposition: "ambiguous",
      reason_code: "auto_routing_policy_conflict",
    });
  });

  it("keeps official commercial products claim-local and assembles their topology", async () => {
    const items: PricingReconciliationItem[] = [];
    const models = await huggingFaceRouter(
      "huggingface/pricing.json",
      (body) => body,
      (_path, body) => body,
      (item) => items.push(item),
    );
    const facts = models.flatMap(({ commercial_facts }) => commercial_facts ?? []);
    expect(new Set(facts.map(({ book_key }) => book_key))).toEqual(
      new Set([
        "account:custom-provider-key",
        "capacity:inference-endpoints",
        "capacity:jobs-hardware",
        "capacity:spaces-hardware",
        "capacity:zerogpu",
        "plan:hub",
        "service:hf-inference",
        "service:jobs-exposed-ports",
        "service:private-storage",
        "service:public-storage-addon",
      ]),
    );
    expect(
      facts
        .filter(({ book_key }) => book_key === "capacity:inference-endpoints")
        .map(({ offer_key, price_facts }) => [offer_key, price_facts[0]?.price]),
    ).toEqual([
      ["aws:intel-spr:x1", "0.033"],
      ["aws:intel-spr:x2", "0.067"],
      ["aws:nvidia-t4:x1", "0.5"],
    ]);
    expect(
      facts.find(
        ({ book_key, offer_key }) =>
          book_key === "capacity:inference-endpoints" && offer_key === "aws:intel-spr:x2",
      )?.raw_price_facts,
    ).toContainEqual(
      expect.objectContaining({
        term_key: "endpoint_monthly_example",
        reason: "superseded_value",
        resolution_policy: "exact_capacity_table_over_monthly_example",
      }),
    );
    expect(items).toContainEqual({
      disposition: "excluded",
      reason_code: "deprecated_endpoint_capacity_excluded",
      sample: "aws:intel-icl:x1",
    });
    expect(
      facts.find(
        ({ book_key, offer_key }) =>
          book_key === "capacity:jobs-hardware" && offer_key === "cpu-basic",
      )?.price_facts[0],
    ).toMatchObject({ price: "0.000167", unit: "minute", derived: false });
    expect(
      facts.find(
        ({ book_key, offer_key }) => book_key === "capacity:zerogpu" && offer_key === "pro",
      ),
    ).toMatchObject({
      pricing_state: "numeric",
      price_facts: [{ price: "0.1", unit: "minute", derived: true }],
      raw_price_facts: expect.arrayContaining([
        expect.objectContaining({ term_key: "daily_gpu_minutes" }),
        expect.objectContaining({ term_key: "xlarge_quota_multiplier" }),
      ]),
    });
    expect(
      facts.find(
        ({ book_key, offer_key }) => book_key === "plan:hub" && offer_key === "enterprise",
      ),
    ).toMatchObject({
      pricing_state: "custom_quote",
      raw_price_facts: [
        expect.objectContaining({
          term_key: "enterprise_public_card",
          reason: "unknown_applicability",
        }),
      ],
    });

    const partition = assembleParsedProviderPricing(
      "huggingface",
      observedAt,
      [{ source: huggingFaceRouterSource(manifest("huggingface")), models }],
      models,
      manifest("huggingface").pricingCategoricalLabels,
    );
    const free = partition?.books.find(
      ({ book_key }) => book_key === "model:huggingface/org/free-model",
    );
    const routed = free?.offers.find(({ offer_key }) => offer_key === "hf-routed");
    const byok = free?.offers.find(({ offer_key }) => offer_key === "custom-provider-key");
    expect(free?.offers.map(({ offer_key }) => offer_key)).toEqual([
      "hf-routed",
      "custom-provider-key",
    ]);
    expect(routed?.states.some(({ state }) => state === "free")).toBe(true);
    expect(
      routed?.terms.some(
        (term) =>
          term.kind === "rate" &&
          term.meter.value === "input_text" &&
          term.variants.every(({ charge_binding }) => charge_binding !== undefined),
      ),
    ).toBe(true);
    expect(byok).toMatchObject({
      states: [expect.objectContaining({ state: "externally_billed" })],
      settlement: [
        expect.objectContaining({ channel: "byok", payment_sources: ["external_bill"] }),
      ],
      relations: [expect.objectContaining({ kind: "exclusive_with" })],
    });
    const zeroGpu = partition?.books.find(({ book_key }) => book_key === "capacity:zerogpu");
    expect(
      zeroGpu?.offers
        .find(({ offer_key }) => offer_key === "pro")
        ?.terms.find(({ term_key }) => term_key === "daily_gpu_minutes"),
    ).toMatchObject({
      kind: "allowance",
      variants: [
        expect.objectContaining({
          benefit: {
            kind: "quantity",
            quantity: {
              value: { numerator: "2400", denominator: "1" },
              unit: { factors: [{ unit: { namespace: "kmodels", value: "second" }, power: 1 }] },
            },
          },
          reset: {
            namespace: "provider",
            provider_id: "huggingface",
            value: "24_hours_after_first_use",
          },
        }),
      ],
    });
    expect(
      partition?.books.find(({ book_key }) => book_key === "service:jobs-exposed-ports")
        ?.resource_edges,
    ).toEqual([expect.objectContaining({ kind: "requires_resource" })]);
  });

  it("keeps valid commercial siblings when prose or individual rows drift", async () => {
    const items: PricingReconciliationItem[] = [];
    const models = await huggingFaceRouter(
      "huggingface/pricing.json",
      (body) => body,
      (path, body) => {
        if (path === "endpoint-pricing.md")
          return body.replace("billed per minute", "billed continuously");
        if (path === "jobs-hardware.json")
          return body.replace('"unitLabel": "minute"', '"unitLabel": "hour"');
        if (path === "pricing-page.html") return body.replace("<h3>Team</h3>", "<h3>Teams</h3>");
        return body;
      },
      (item) => items.push(item),
    );
    const facts = models.flatMap(({ commercial_facts }) => commercial_facts ?? []);
    expect(
      facts.filter(({ book_key }) => book_key === "capacity:inference-endpoints"),
    ).toHaveLength(3);
    expect(
      facts
        .filter(({ book_key }) => book_key === "capacity:jobs-hardware")
        .map(({ offer_key }) => offer_key),
    ).toEqual(["t4-small"]);
    expect(
      facts.filter(({ book_key }) => book_key === "plan:hub").map(({ offer_key }) => offer_key),
    ).toEqual(["pro", "enterprise"]);
    expect(items).toEqual(
      expect.arrayContaining([
        {
          disposition: "unbound",
          reason_code: "endpoint_pricing_drift",
          sample: "/docs/inference-endpoints/en/support/pricing.md",
        },
        {
          disposition: "excluded",
          reason_code: "invalid_jobs_hardware_row",
          sample: "item:0",
        },
        {
          disposition: "unbound",
          reason_code: "hub_plan_amount_missing",
          sample: "team",
        },
      ]),
    );
  });

  it("validates billing drift and surfaces resolved routing or client cost contracts", async () => {
    const drift: PricingReconciliationItem[] = [];
    await expect(
      huggingFaceRouter(
        "huggingface/pricing.json",
        (body) => body,
        (path, body) =>
          path === "provider-registration.md"
            ? body.replace("background job runs every minute", "background billing job runs")
            : body,
        (item) => drift.push(item),
      ),
    ).resolves.toHaveLength(2);
    expect(drift).toContainEqual({
      disposition: "unbound",
      reason_code: "provider_cost_reconciliation_contract_drift",
      sample: "/docs/inference-providers/en/register-as-a-provider.md",
    });

    const resolved: PricingReconciliationItem[] = [];
    await huggingFaceRouter(
      "huggingface/pricing.json",
      (body) => body,
      (path, body) =>
        path === "sdk-inference.md"
          ? body.replace(
              'default value is "auto" which will select the first of the providers available for the model,\nsorted by the user\'s order',
              'default value is "auto" which selects the fastest available provider',
            )
          : body,
      (item) => resolved.push(item),
    );
    expect(resolved).toContainEqual({
      disposition: "excluded",
      reason_code: "auto_routing_policy_not_price_fact",
    });
    expect(resolved.some(({ reason_code }) => reason_code === "auto_routing_policy_conflict")).toBe(
      false,
    );

    const clientCost: PricingReconciliationItem[] = [];
    await huggingFaceRouter(
      "huggingface/pricing.json",
      (body) => body,
      (path, body) => (path === "chat-completion.md" ? `${body}\n\`costNanoUsd\`` : body),
      (item) => clientCost.push(item),
    );
    expect(clientCost).toContainEqual({
      disposition: "unsupported",
      reason_code: "response_exact_cost_unmodeled",
    });
  });

  it("isolates missing and additive partner companion claims", async () => {
    const missing: PricingReconciliationItem[] = [];
    await expect(
      huggingFaceRouter(
        "huggingface/pricing.json",
        (body) => body,
        (path, body) =>
          path === "overview.md"
            ? body.replace("./providers/baseten", "./providers/future-provider")
            : body,
        (item) => missing.push(item),
      ),
    ).resolves.toHaveLength(2);
    await expect(
      huggingFaceRouter(
        "huggingface/pricing.json",
        (body) => body,
        (path, body) =>
          path === "sdk-providers.py" ? body.replace('"baseten"', '"future-provider"') : body,
        (item) => missing.push(item),
      ),
    ).resolves.toHaveLength(2);
    expect(missing).toEqual(
      expect.arrayContaining([
        {
          disposition: "unbound",
          reason_code: "documented_partner_missing",
          sample: "baseten",
        },
        {
          disposition: "unbound",
          reason_code: "sdk_provider_missing",
          sample: "baseten",
        },
      ]),
    );

    const additions: PricingReconciliationItem[] = [];
    await expect(
      huggingFaceRouter(
        "huggingface/pricing.json",
        (body) => body,
        (path, body) => {
          if (path === "overview.md")
            return body.replace(
              "[Baseten](./providers/baseten)",
              "[Baseten](./providers/baseten) [Future](./providers/future-provider)",
            );
          if (path === "sdk-providers.py")
            return body.replace('    "baseten",', '    "baseten",\n    "future-provider",');
          return body;
        },
        (item) => additions.push(item),
      ),
    ).resolves.toHaveLength(2);
    expect(additions).toEqual(
      expect.arrayContaining([
        {
          disposition: "unsupported",
          reason_code: "documented_partner_not_collected",
          sample: "future-provider",
        },
        {
          disposition: "unsupported",
          reason_code: "sdk_provider_not_collected",
          sample: "future-provider",
        },
      ]),
    );
  });

  it("keeps valid records when official response rows gain fields or duplicate", async () => {
    const value = manifest("huggingface");
    const mappingSource = huggingFaceMappingSource(value);
    const mapping = (await fixture("huggingface/normal.json")).replace(
      '"status": "live"',
      '"status": "live", "futureField": true',
    );
    expect(
      parseSource({
        provider: provider(value),
        source: mappingSource,
        body: huggingFaceMappingBody(mapping),
        observedAt,
      }),
    ).toHaveLength(3);
    const duplicateMappingId = (await fixture("huggingface/normal.json")).replace(
      '"_id": "mapping-2"',
      '"_id": "mapping-1"',
    );
    const duplicateReconciliation: PricingReconciliationItem[] = [];
    expect(
      parseSource({
        provider: provider(value),
        source: mappingSource,
        body: huggingFaceMappingBody(duplicateMappingId),
        observedAt,
        onPricingReconciliation: (item) => duplicateReconciliation.push(item),
      }),
    ).toHaveLength(3);
    expect(duplicateReconciliation).toContainEqual({
      disposition: "excluded",
      reason_code: "duplicate_mapping_record",
      sample: "hf-inference:mapping-1",
    });
    await expect(
      huggingFaceRouter("huggingface/pricing.json", (body) =>
        body.replace('"provider": "deepinfra"', '"provider": "deepinfra", "futureField": true'),
      ),
    ).resolves.toHaveLength(2);
    await expect(
      huggingFaceHub((body) => body.replace('"_id":', '"futureField": true, "_id":')),
    ).resolves.toHaveLength(2);
  });

  it("keeps usable route metadata and prices when optional fields are malformed", async () => {
    const priceReconciliation: PricingReconciliationItem[] = [];
    const models = await huggingFaceRouter(
      "huggingface/pricing.json",
      (body) => body.replace('"input": 0.25', '"input": "not-a-price"'),
      (_path, body) => body,
      (item) => priceReconciliation.push(item),
    );
    expect(
      models
        .find(({ model_id }) => model_id === "org/model-1")
        ?.price_facts.filter(({ conditions }) => conditions.route_provider === "deepinfra")
        .map(({ meter, price }) => [meter, price]),
    ).toEqual([["output_text", "1.5"]]);
    expect(priceReconciliation).toContainEqual({
      disposition: "ambiguous",
      reason_code: "route_price_field_invalid",
      sample: "org/model-1:deepinfra",
    });

    await expect(
      huggingFaceRouter("huggingface/pricing.json", (body) =>
        body.replace(
          '"architecture": { "input_modalities": ["text", "image"], "output_modalities": ["text"] }',
          '"architecture": "temporarily-unavailable"',
        ),
      ),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          model_id: "org/model-1",
          modalities: { input: [], output: [] },
        }),
      ]),
    );
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
      body: huggingFaceMappingBody(body),
      observedAt,
    });
    const routed = parseSource({
      provider: provider(value),
      source: router,
      body: await huggingFaceRouterBody(routeBody),
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
    ).resolves.toMatchObject([{ model_id: "org/embed-model", updated_date: "2026-07-20" }]);
    await expect(
      huggingFaceHub((body) => body.replace("2026-07-20T12:34:56.000Z", "not-a-date")),
    ).resolves.toMatchObject([{ model_id: "org/embed-model", updated_date: "2026-06-03" }]);
  });

  it("uses volume guards and preserves list prices beside temporary promotions", async () => {
    await expect(huggingFaceMapping("huggingface/broken.json")).rejects.toThrow(
      "Hugging Face concrete mapping routes contract mismatch",
    );
    await expect(huggingFaceRouter("huggingface/broken-router.json")).rejects.toThrow();
    const value = manifest("huggingface");
    const source = huggingFaceRouterSource(value);
    const body = (await fixture("huggingface/pricing.json")).replace(
      '"pricing": { "input": 0, "output": "0.0" }',
      '"pricing": { "input": 1, "output": "0.0" }',
    );
    const bundled = await huggingFaceRouterBody(body);
    const reconciliation: PricingReconciliationItem[] = [];
    const models = parseSource({
      provider: provider(value),
      source,
      body: bundled,
      observedAt,
      onPricingReconciliation: (item) => reconciliation.push(item),
    });
    expect(
      models
        .find(({ model_id }) => model_id === "org/free-model")
        ?.price_facts.map(({ meter, price }) => [meter, price]),
    ).toEqual([
      ["input_text", "1"],
      ["output_text", "0.0"],
    ]);
    expect(reconciliation).toContainEqual({
      disposition: "explicit_non_numeric",
      reason_code: "route_promotional_free",
      sample: "org/free-model:publicai",
    });
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
    const catalogSource = source("deepseek-catalog");
    expect(catalogSource).toMatchObject({
      fields: expect.arrayContaining(["api_endpoints"]),
      linkedDocuments: {
        minDocuments: 0,
        maxDocuments: 0,
      },
    });
    expect(catalogSource.linkedDocuments?.documents?.map(({ id, url }) => ({ id, url }))).toEqual([
      {
        id: "chat-completions",
        url: "https://api-docs.deepseek.com/api/create-chat-completion",
      },
      { id: "responses", url: "https://api-docs.deepseek.com/api/create-response" },
      { id: "fim-completion", url: "https://api-docs.deepseek.com/api/create-completion" },
      {
        id: "model-inventory",
        url: "https://api-docs.deepseek.com/api/list-models",
      },
      {
        id: "token-usage",
        url: "https://api-docs.deepseek.com/quick_start/token_usage/",
      },
      { id: "context-cache", url: "https://api-docs.deepseek.com/guides/kv_cache/" },
      { id: "balance", url: "https://api-docs.deepseek.com/api/get-user-balance" },
      { id: "rate-limit", url: "https://api-docs.deepseek.com/quick_start/rate_limit/" },
      { id: "error-codes", url: "https://api-docs.deepseek.com/quick_start/error_codes/" },
      { id: "responses-guide", url: "https://api-docs.deepseek.com/guides/responses_api/" },
      { id: "anthropic-guide", url: "https://api-docs.deepseek.com/guides/anthropic_api/" },
      {
        id: "cny-pricing",
        url: "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/",
      },
      {
        id: "claude-code",
        url: "https://api-docs.deepseek.com/quick_start/agent_integrations/claude_code/",
      },
      { id: "faq", url: "https://api-docs.deepseek.com/faq" },
    ]);
    expect(catalogSource.linkedDocuments?.documents?.every(({ optional }) => optional)).toBe(true);
    const models = await deepseekCatalog();
    expect(models.map(({ model_id }) => model_id)).toEqual([
      "deepseek-v4-flash",
      "deepseek-v4-pro",
    ]);
    expect(models.find(({ model_id }) => model_id === "deepseek-v4-pro")).toMatchObject({
      name: "DeepSeek-V4-Pro",
      tasks: ["text_generation"],
      api_endpoints: [
        { name: "Chat Completions", path: "/chat/completions" },
        { name: "FIM Completion (Beta)", path: "/beta/completions" },
      ],
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
      price_facts: expect.arrayContaining([
        expect.objectContaining({ meter: "cache_read_text", price: "0.003625", currency: "USD" }),
        expect.objectContaining({ meter: "input_text", price: "0.435", currency: "USD" }),
        expect.objectContaining({ meter: "output_text", price: "0.87", currency: "USD" }),
        expect.objectContaining({ meter: "cache_read_text", price: "0.025", currency: "CNY" }),
        expect.objectContaining({ meter: "input_text", price: "3", currency: "CNY" }),
        expect.objectContaining({ meter: "output_text", price: "6", currency: "CNY" }),
      ]),
    });
    expect(models.find(({ model_id }) => model_id === "deepseek-v4-flash")?.api_endpoints).toEqual([
      { name: "Chat Completions", path: "/chat/completions" },
      { name: "Responses", path: "/responses" },
    ]);
  });

  it("keeps price-table rows when interface claims drift", async () => {
    const chat = await fixture("deepseek/chat.html");
    const reconciliation: PricingReconciliationItem[] = [];
    const changedOperation = await deepseekCatalog({
      chat: chat.replace("/chat/completions", "/v2/chat/completions"),
      onPricingReconciliation: (item) => reconciliation.push(item),
    });
    expect(changedOperation).toHaveLength(2);
    expect(changedOperation.every(({ price_facts }) => price_facts.length === 6)).toBe(true);
    expect(
      changedOperation.every(
        ({ api_endpoints }) =>
          api_endpoints?.some(({ path }) => path === "/chat/completions") !== true,
      ),
    ).toBe(true);
    expect(reconciliation).toContainEqual(
      expect.objectContaining({ reason_code: "chat_operation_contract_drift" }),
    );

    const changedUsage = await deepseekCatalog({
      chat: chat.replace("prompt_cache_hit_tokens", "cached_tokens"),
    });
    expect(
      changedUsage.find(({ model_id }) => model_id === "deepseek-v4-pro")?.api_endpoints,
    ).toContainEqual({ name: "Chat Completions", path: "/chat/completions" });
    expect(changedUsage[0]?.raw_price_facts).toContainEqual(
      expect.objectContaining({ term_key: "accounting_binding_unavailable:chat" }),
    );

    const responses = await fixture("deepseek/responses.html");
    const responseItems: PricingReconciliationItem[] = [];
    await expect(
      deepseekCatalog({
        responses: responses.replace("deepseek-v4-flash", "deepseek-v4-pro"),
        onPricingReconciliation: (item) => responseItems.push(item),
      }),
    ).resolves.toHaveLength(2);
    expect(responseItems).toContainEqual(
      expect.objectContaining({ reason_code: "responses_inventory_disagreement" }),
    );
  });

  it("parses model columns and price records independently", async () => {
    const catalog = await fixture("deepseek/catalog.html");
    const reconciliation: PricingReconciliationItem[] = [];
    const models = await deepseekCatalog({
      catalog: catalog
        .replace("$0.435", "TBD")
        .replace("</table>", '<tr><td colspan="2">NEW FACT</td><td>x</td><td>y</td></tr></table>'),
      onPricingReconciliation: (item) => reconciliation.push(item),
    });
    expect(models).toHaveLength(2);
    expect(
      models
        .find(({ model_id }) => model_id === "deepseek-v4-pro")
        ?.price_facts.filter(({ currency }) => currency === "USD"),
    ).toHaveLength(2);
    expect(reconciliation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason_code: "usd_price_claim_drift" }),
        expect.objectContaining({ reason_code: "catalog_row_unhandled" }),
      ]),
    );

    const cny = await fixture("deepseek/catalog-cny.html");
    const cnyModels = await deepseekCatalog({
      overrides: { "zh-cn/quick_start/pricing/": cny.replace("3元", "待定") },
    });
    expect(
      cnyModels
        .find(({ model_id }) => model_id === "deepseek-v4-pro")
        ?.price_facts.filter(({ currency }) => currency === "CNY"),
    ).toHaveLength(2);

    const oneColumn = await deepseekCatalog({
      catalog: catalog.replace("deepseek-v4-pro</td>", "invalid model id</td>"),
    });
    expect(oneColumn.map(({ model_id }) => model_id)).toEqual(["deepseek-v4-flash"]);
  });

  it("uses public inventory as a non-destructive witness", async () => {
    const inventory = await fixture("deepseek/list-models.html");
    const reconciliation: PricingReconciliationItem[] = [];
    await expect(
      deepseekCatalog({
        inventory: inventory.replaceAll("deepseek-v4-pro", "deepseek-v4-unknown"),
        onPricingReconciliation: (item) => reconciliation.push(item),
      }),
    ).resolves.toHaveLength(2);
    expect(reconciliation).toContainEqual(
      expect.objectContaining({ reason_code: "model_inventory_disagreement" }),
    );

    const withoutCompanions = await deepseekCatalog({ withoutDocuments: true });
    expect(withoutCompanions.map(({ model_id }) => model_id)).toEqual([
      "deepseek-v4-flash",
      "deepseek-v4-pro",
    ]);
    expect(withoutCompanions.every(({ price_facts }) => price_facts.length === 3)).toBe(true);
  });

  it("partitions public prices from account and not-yet-effective billing rules", async () => {
    const reconciliation: PricingReconciliationItem[] = [];
    const models = await deepseekCatalog({
      onPricingReconciliation: (item) => reconciliation.push(item),
    });
    expect(sourcePricingReconciliation(models, reconciliation, true)).toMatchObject({
      basis: "source_item",
      observed_items: 20,
      disposition_counts: {
        normalized: 12,
        raw: 3,
        explicit_non_numeric: 0,
        excluded: 1,
        unbound: 4,
        ambiguous: 0,
        unsupported: 0,
        unresolved: 0,
      },
    });
    expect(reconciliation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          disposition: "unbound",
          reason_code: "future_price_increase_not_effective",
        }),
        expect.objectContaining({
          disposition: "unbound",
          reason_code: "web_search_fee_not_published",
        }),
        expect.objectContaining({
          disposition: "raw",
          reason_code: "anthropic_model_mapping_preserved",
        }),
        expect.objectContaining({ reason_code: "currency_book_applicability_unresolved" }),
        expect.objectContaining({ reason_code: "fim_inventory_disagreement" }),
      ]),
    );

    const catalog = await fixture("deepseek/catalog.html");
    const changed: PricingReconciliationItem[] = [];
    await expect(
      deepseekCatalog({
        catalog: catalog.replace("raise the overall pricing", "change the overall pricing"),
        onPricingReconciliation: (item) => changed.push(item),
      }),
    ).resolves.toHaveLength(2);
    expect(changed).toContainEqual(
      expect.objectContaining({ reason_code: "future_price_notice_drift" }),
    );
  });

  it("makes commercial companion drift claim-local", async () => {
    for (const [path, fixtureName, claim, message] of deepseekCommercialDocuments) {
      const body = await fixture(`deepseek/${fixtureName}`);
      const reconciliation: PricingReconciliationItem[] = [];
      await expect(
        deepseekCatalog({
          overrides: { [path]: body.replace(claim, "changed") },
          onPricingReconciliation: (item) => reconciliation.push(item),
        }),
      ).resolves.toHaveLength(2);
      expect(reconciliation).toContainEqual(expect.objectContaining({ reason_code: message }));
    }

    const cache = await fixture("deepseek/cache.html");
    const models = await deepseekCatalog({
      overrides: { "guides/kv_cache/": cache.replace("best-effort", "guaranteed") },
    });
    const catalogSource = source("deepseek-catalog");
    const pricing = assembleParsedProviderPricing(
      "deepseek",
      observedAt,
      [{ source: catalogSource, models }],
      models,
    );
    const offer = pricing?.books
      .find(({ book_key }) => book_key === "model:deepseek/deepseek-v4-flash")
      ?.offers.find(({ offer_key }) => offer_key === "payg");
    const cacheTerm = offer?.terms.find(
      (term) => term.kind === "rate" && term.meter.value === "cache_read_text",
    );
    expect(models[0]?.price_facts).toHaveLength(6);
    expect(
      cacheTerm?.kind === "rate"
        ? cacheTerm.variants.every(({ charge_binding }) => charge_binding === undefined)
        : false,
    ).toBe(true);
    expect(pricing?.books.some(({ book_key }) => book_key === "service:web-search")).toBe(true);
  });

  it("assembles PAYG cache accounting, direct settlement, and provider services", async () => {
    const models = await deepseekCatalog();
    const catalogSource = source("deepseek-catalog");
    const pricing = assembleParsedProviderPricing(
      "deepseek",
      observedAt,
      [{ source: catalogSource, models }],
      models,
    );
    const flashBook = pricing?.books.find(
      ({ book_key }) => book_key === "model:deepseek/deepseek-v4-flash",
    );
    const flash = flashBook?.offers.find(({ offer_key }) => offer_key === "payg");
    const pro = pricing?.books
      .find(({ book_key }) => book_key === "model:deepseek/deepseek-v4-pro")
      ?.offers.find(({ offer_key }) => offer_key === "payg");
    expect(flash?.settlement).toEqual([
      expect.objectContaining({
        biller: "DeepSeek",
        payment_sources: ["prepaid_balance", "provider_credit"],
      }),
    ]);
    expect(
      flash?.terms.find((term) => term.kind === "rate" && term.meter.value === "cache_read_text"),
    ).toMatchObject({
      kind: "rate",
      variants: expect.arrayContaining([
        expect.objectContaining({
          charge_binding: expect.objectContaining({
            signal: { namespace: "kmodels", value: "cached_input_tokens" },
            aggregation: "request",
          }),
        }),
      ]),
    });
    const input = flash?.terms.find(
      (term) => term.kind === "rate" && term.meter.value === "input_text",
    );
    expect(
      input?.kind === "rate"
        ? input.variants[0]?.charge_binding?.observations.map(({ locator }) => locator.value)
        : [],
    ).toEqual([
      "chat:usage.prompt_cache_miss_tokens",
      "responses:usage.input_tokens-input_tokens_details.cached_tokens",
    ]);
    expect(flash?.terms.some(({ term_key }) => term_key === "cache_write_text")).toBe(false);

    const search = pricing?.books.find(({ book_key }) => book_key === "service:web-search");
    const flashSearch = search?.offers.find(
      ({ offer_key }) => offer_key === "execution:deepseek/deepseek-v4-flash",
    );
    const proSearch = search?.offers.find(
      ({ offer_key }) => offer_key === "execution:deepseek/deepseek-v4-pro",
    );
    expect(flashSearch).toMatchObject({
      states: [expect.objectContaining({ state: "not_published" })],
      relations: [
        expect.objectContaining({
          kind: "requires",
          target: { kind: "offers", offer_refs: [flash?.id] },
        }),
      ],
    });
    expect(proSearch).toMatchObject({
      states: [expect.objectContaining({ state: "not_published" })],
      relations: [
        expect.objectContaining({
          kind: "requires",
          target: { kind: "offers", offer_refs: [pro?.id] },
        }),
      ],
    });
    expect(search?.offers.every(({ terms }) => terms.every((term) => term.kind !== "rate"))).toBe(
      true,
    );
    expect(
      pricing?.books
        .filter(({ scope }) => scope.kind === "provider_resource")
        .map(({ book_key }) => book_key),
    ).toEqual(
      expect.arrayContaining([
        "account:balance",
        "account:concurrency",
        "distribution:anthropic-routing",
        "service:web-search",
      ]),
    );
  });

  it("treats the documented inventory owner as opaque metadata", async () => {
    const value = manifest("deepseek");
    const configured = source("deepseek-api");
    const fixtureBody = await fixture("deepseek/api.json");
    const body = fixtureBody.replace('"owned_by": "deepseek"', '"owned_by": "deepseek-platform"');
    expect(
      parseSource({
        provider: provider(value),
        source: configured,
        body,
        observedAt,
      }),
    ).toHaveLength(2);
    expect(
      parseSource({
        provider: provider(value),
        source: configured,
        body: fixtureBody.replace('"object": "list",', '"object": "list", "extra": true,'),
        observedAt,
      }),
    ).toHaveLength(2);
    expect(
      parseSource({
        provider: provider(value),
        source: configured,
        body: fixtureBody.replace(
          '"owned_by": "deepseek"',
          '"owned_by": "deepseek", "extra": true',
        ),
        observedAt,
      }),
    ).toHaveLength(2);
    const reconciliation: PricingReconciliationItem[] = [];
    expect(
      parseSource({
        provider: provider(value),
        source: configured,
        body: fixtureBody.replace('"object": "model"', '"object": "deployment"'),
        observedAt,
        onPricingReconciliation: (item) => reconciliation.push(item),
      }),
    ).toHaveLength(1);
    expect(reconciliation).toContainEqual(
      expect.objectContaining({ reason_code: "api_model_record_invalid" }),
    );
  });

  it("uses exact change-log evidence for release and update dates", async () => {
    const models = await parsed("deepseek", "deepseek/updates.html", "deepseek-updates");
    const flash = models.find(({ model_id }) => model_id === "deepseek-v4-flash");
    expect(flash).toMatchObject({
      release_date: "2026-04-24",
      updated_date: "2026-07-31",
      release_stage: "preview",
    });
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
    const reconciliation: PricingReconciliationItem[] = [];
    expect(
      parseSource({
        provider: provider(manifest("deepseek")),
        source: source("deepseek-updates"),
        body: body.replace("2024-09-05", "2024-02-30"),
        observedAt,
        onPricingReconciliation: (item) => reconciliation.push(item),
      }),
    ).not.toHaveLength(0);
    expect(reconciliation).toContainEqual(
      expect.objectContaining({ reason_code: "update_date_invalid" }),
    );
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
    expect(models.find(({ model_id }) => model_id === "deepseek-v4-flash")).toMatchObject({
      release_date: "2026-04-24",
      updated_date: "2026-07-31",
      release_stage: "preview",
    });
    expect(models.some(({ model_id }) => model_id === "deepseek-chat")).toBe(false);
  });
});

describe("DashScope adapters", () => {
  const pricingDocuments = [
    ["context-cache", "context-cache", "cache.html"],
    ["batch-inference/", "batch-inference", "batch.html"],
    ["qwen-api-via-openai-chat-completions", "chat-completions", "chat.html"],
    ["compatibility-with-openai-responses-api", "responses-api", "responses.html"],
    ["web-search", "web-search", "web-search.html"],
    ["bill-query-and-cost-management", "billing", "billing.html"],
    ["model-usage-statistics", "model-usage", "usage.html"],
    ["savings-plan-and-resource-package", "savings-plans", "savings.html"],
    ["more-tools", "billing-plans", "billing-plans.html"],
    ["base-url", "base-url", "base-url.html"],
    [
      "../user-center/developer-reference/api-bssopenapi-2017-12-14-describeinstancebill",
      "billing-api",
      "billing-api.html",
    ],
  ] as const;

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

  function parse(
    sourceManifest: SourceManifest,
    body: string,
    onPricingReconciliation?: (item: PricingReconciliationItem) => void,
  ): ProviderModel[] {
    const value = manifest("dashscope");
    return parseSource({
      provider: provider(value),
      source: sourceManifest,
      body,
      observedAt,
      ...(onPricingReconciliation === undefined ? {} : { onPricingReconciliation }),
    });
  }

  async function pricingBundle(
    indexBody = fixture("dashscope/pricing.html"),
    overrides: Readonly<Record<string, string>> = {},
  ): Promise<string> {
    const pricingSource = source("dashscope-pricing");
    return JSON.stringify({
      index: { url: pricingSource.url, body: await indexBody },
      documents: await Promise.all(
        pricingDocuments.map(async ([path, id, fixtureName]) => ({
          url: new URL(path, "https://www.alibabacloud.com/help/en/model-studio/").href,
          body: overrides[id] ?? (await fixture(`dashscope/${fixtureName}`)),
        })),
      ),
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

  it("preserves Markdown heading context around raw official tables", async () => {
    const models = parse(source("dashscope-text"), await fixture("dashscope/catalog.md"));
    expect(models).toMatchObject([
      {
        model_id: "qwen3.8-max",
        tasks: ["text_generation"],
        limits: { context_tokens: 1_000_000 },
        capabilities: {
          reasoning: true,
          tool_call: true,
          structured_output: true,
        },
      },
    ]);
  });

  it("derives Omni transcription and raw provider type from its official task page", () => {
    const body = `<main><section><h2>All models</h2><table>
      <tr><td>Model ID</td><td>API</td></tr>
      <tr><td><code>qwen3.5-omni-flash</code></td><td>HTTP</td></tr>
      <tr><td><code>qwen3-omni-flash-realtime</code></td><td>WebSocket</td></tr>
    </table></section></main>`;
    const models = parse(source("dashscope-omni"), body);
    expect(models.find(({ model_id }) => model_id.endsWith("-realtime"))).toMatchObject({
      tasks: ["text_generation", "transcription", "speech_to_speech"],
      raw_type: "WebSocket",
      delivery_modes: ["realtime"],
      delivery_mode_evidence: [
        {
          mode: "realtime",
          source_ref: "dashscope-omni",
          namespace: "dashscope.api",
          raw_value: "WebSocket",
          kind: "provider_type",
        },
      ],
    });
    expect(models.find(({ model_id }) => model_id === "qwen3.5-omni-flash")).toMatchObject({
      tasks: ["text_generation", "transcription"],
      raw_type: "HTTP",
    });
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

  it("validates Markdown recommended-model cards against their published routes", async () => {
    const body = await fixture("dashscope/recommended.md");
    const models = parse(source("dashscope-recommended"), body);
    expect(models.find(({ model_id }) => model_id === "qwen3.8-max")).toMatchObject({
      api_endpoints: undefined,
      availability: [
        { region: "China (Beijing)", deployment_type: "model_api" },
        { region: "Singapore", deployment_type: "model_api" },
        { region: "US (Virginia)", deployment_type: "model_api" },
      ],
    });
    expect(models.find(({ model_id }) => model_id === "qwen-image-3.0-pro")).toMatchObject({
      api_endpoints: [
        {
          name: "Multimodal Generation",
          path: "/api/v1/services/aigc/multimodal-generation/generation",
        },
      ],
      availability: [{ region: "International", deployment_type: "model_api" }],
    });
    expect(
      models.find(({ model_id }) => model_id === "qwen-audio-3.0-asr-flash-streaming"),
    ).toMatchObject({
      api_endpoints: [{ name: "Realtime", path: "/api-ws/v1/realtime" }],
      availability: [{ region: "Singapore", deployment_type: "model_api" }],
    });
    expect(
      parse(
        source("dashscope-recommended"),
        body.replace("qwen3.8-max]", "qwen3.8-max Third-party]"),
      ).some(({ model_id }) => model_id === "qwen3.8-max"),
    ).toBe(true);
    expect(() =>
      parse(
        source("dashscope-recommended"),
        body.replace("Beijing Singapore US (Virginia)", "Beijing Singapore"),
      ),
    ).toThrow("route regions contradicted");
    expect(() =>
      parse(
        source("dashscope-recommended"),
        body.replace("dashscope-us.aliyuncs.com", "example.com"),
      ),
    ).toThrow("Unsupported DashScope recommended-model endpoint");
  });

  it("retains tier, promotion, batch, and explicit and implicit cache prices", async () => {
    const pricingSource = source("dashscope-pricing");
    const pricingBody = await fixture("dashscope/pricing.html");
    const parsePricing = (body: string) =>
      pricingBundle(Promise.resolve(body)).then((bundle) => parse(pricingSource, bundle));
    const models = await parsePricing(pricingBody);
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
    expect(
      model?.price_facts
        .filter(({ meter }) => meter === "cache_read_text" || meter === "cache_write_text")
        .every(({ conditions }) => conditions.service_tier === undefined),
    ).toBe(true);
    expect(model?.price_facts.some(({ conditions }) => conditions.operation === "web_search")).toBe(
      false,
    );
    expect(
      models
        .flatMap(({ commercial_facts }) => commercial_facts ?? [])
        .filter(
          ({ resource_key, model_refs }) =>
            resource_key === "web-search" && model_refs.includes("dashscope/qwen3.7-plus"),
        )
        .map(({ price_facts }) => price_facts[0])
        .filter((rate) => rate !== undefined)
        .map(({ meter, price, unit, conditions }) => ({
          meter,
          price,
          unit,
          scope: conditions.deployment_scope,
        })),
    ).toEqual([
      { meter: "web_search", price: "10", unit: "thousand_events", scope: "International" },
      { meter: "web_search", price: "0.573411", unit: "thousand_events", scope: "Global" },
      {
        meter: "web_search",
        price: "0.573411",
        unit: "thousand_events",
        scope: "Chinese mainland",
      },
    ]);
    expect(
      models
        .find(({ model_id }) => model_id === "deepseek-v4-pro")
        ?.price_facts.some(({ meter }) => meter.startsWith("cache_")),
    ).toBe(false);
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
    expect(models.find(({ model_id }) => model_id === "qwen3-tts-flash")?.price_facts).toEqual([
      expect.objectContaining({
        meter: "input_text",
        price: "11.4682",
        unit: "million_characters",
      }),
      expect.objectContaining({
        meter: "output_audio",
        price: "0",
        unit: "million_characters",
      }),
    ]);
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
    await expect(parsePricing(pricingBody.replace("Free trial", "Contact sales"))).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          model_id: "multimodal-embedding-v1",
          pricing_state: "custom_quote",
        }),
      ]),
    );
    await expect(parsePricing(pricingBody.replace("$1.6", "Contact sales"))).resolves.toEqual(
      expect.any(Array),
    );
  });

  it("reconstructs reviewed sparse and multi-row Markdown pricing tables", async () => {
    const models = parse(
      source("dashscope-pricing"),
      await pricingBundle(fixture("dashscope/pricing.md")),
    );
    const plus = models.find(({ model_id }) => model_id === "qwen3.7-plus");
    expect(
      plus?.price_facts
        .filter(({ conditions }) => conditions.context_min_tokens === 256_000)
        .map(({ meter, price, conditions }) => ({
          meter,
          price,
          operation: conditions.operation,
        })),
    ).toEqual(
      expect.arrayContaining([
        { meter: "input_text", price: "1.2", operation: undefined },
        { meter: "output_text", price: "4.8", operation: "non_thinking_mode" },
        {
          meter: "output_text",
          price: "4.8",
          operation: "thinking_mode_chain_of_thought_answer_",
        },
      ]),
    );
    const image = models.find(({ model_id }) => model_id === "qwen-image-3.0-pro");
    expect(image).toMatchObject({ release_stage: "preview" });
    expect(
      image?.price_facts
        .filter(({ conditions }) => conditions.resolution === "2k")
        .map(({ price }) => price),
    ).toEqual(["0.003", "0.075"]);
    expect(models.find(({ model_id }) => model_id === "qwen-tts-nested")?.availability).toEqual([
      { region: "Singapore", deployment_type: "model_api" },
    ]);
    expect(
      models
        .find(({ model_id }) => model_id === "qwen-omni-labels")
        ?.price_facts.map(({ conditions }) => conditions.modality),
    ).toEqual([
      "text text-only input",
      "text multimodal input",
      "text + audio audio only billed",
      "audio",
    ]);
  });

  it("does not synthesize published cache-rate exceptions", async () => {
    const reconciliation: PricingReconciliationItem[] = [];
    const models = parse(
      source("dashscope-pricing"),
      await pricingBundle(fixture("dashscope/pricing.md"), {
        "context-cache": await fixture("dashscope/cache-current.md"),
      }),
      (item) => reconciliation.push(item),
    );
    const model = models.find(({ model_id }) => model_id === "qwen3.8-max");
    expect(
      model?.price_facts.some(
        ({ meter, conditions }) =>
          meter === "cache_read_text" && conditions.operation === "explicit_cache",
      ),
    ).toBe(false);
    expect(
      model?.price_facts.some(
        ({ meter, conditions }) =>
          meter === "cache_read_text" && conditions.operation === "implicit_cache",
      ),
    ).toBe(true);
    expect(reconciliation).toContainEqual({
      disposition: "unbound",
      reason_code: "explicit_cache_price_not_public",
      sample: "qwen3.8-max:Singapore",
    });
  });

  it("partitions first-party pricing and suppresses only accounting claims that drift", async () => {
    const reconciliation: PricingReconciliationItem[] = [];
    const pricingSource = source("dashscope-pricing");
    const bundle = await pricingBundle();
    const models = parse(pricingSource, bundle, (item) => reconciliation.push(item));
    expect(sourcePricingReconciliation(models, reconciliation, true)).toMatchObject({
      basis: "source_item",
      observed_items: reconciliation.length,
      disposition_counts: {
        ambiguous: 0,
        raw: 0,
        unresolved: 0,
        unsupported: 0,
      },
    });
    expect(reconciliation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          disposition: "unbound",
          reason_code: "implicit_cache_price_not_public",
          sample: "deepseek-v4-pro:Singapore",
        }),
        expect.objectContaining({
          disposition: "excluded",
          reason_code: "response_exact_cost_not_returned",
        }),
      ]),
    );
    expect(
      reconciliation.filter(({ reason_code }) => reason_code === "web_search_rate_normalized"),
    ).toHaveLength(3);
    expect(
      reconciliation.filter(({ reason_code }) => reason_code === "cache_rate_normalized"),
    ).toHaveLength(3);

    const cache = await fixture("dashscope/cache.html");
    const cacheReconciliation: PricingReconciliationItem[] = [];
    const cacheModels = parse(
      pricingSource,
      await pricingBundle(undefined, {
        "context-cache": cache.replace("125%", "130%"),
      }),
      (item) => cacheReconciliation.push(item),
    );
    expect(
      cacheModels.find(({ model_id }) => model_id === "qwen3.7-plus")?.price_facts,
    ).not.toEqual(expect.arrayContaining([expect.objectContaining({ meter: "cache_write_text" })]));
    expect(cacheReconciliation).toContainEqual(
      expect.objectContaining({ reason_code: "context_cache_rate_drift" }),
    );
    const webSearch = await fixture("dashscope/web-search.html");
    const webReconciliation: PricingReconciliationItem[] = [];
    const webModels = parse(
      pricingSource,
      await pricingBundle(undefined, {
        "web-search": webSearch.replace("<h2>Global</h2>", "<h2>Other</h2>"),
      }),
      (item) => webReconciliation.push(item),
    );
    expect(
      webModels
        .flatMap(({ commercial_facts }) => commercial_facts ?? [])
        .filter(({ resource_key }) => resource_key === "web-search"),
    ).toHaveLength(2);
    expect(webReconciliation).toContainEqual(
      expect.objectContaining({ reason_code: "web_search_scope_unsupported", sample: "Other" }),
    );

    const missingCompanions = z
      .object({
        index: z.object({ url: z.string(), body: z.string() }),
        documents: z.array(z.object({ url: z.string(), body: z.string() })),
      })
      .parse(JSON.parse(await pricingBundle()));
    missingCompanions.documents = [];
    const missingReconciliation: PricingReconciliationItem[] = [];
    expect(
      parse(pricingSource, JSON.stringify(missingCompanions), (item) =>
        missingReconciliation.push(item),
      ),
    ).not.toHaveLength(0);
    expect(missingReconciliation).toContainEqual(
      expect.objectContaining({
        disposition: "unbound",
        reason_code: "commercial_companion_missing",
      }),
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
    const pricing = parse(pricingSource, await pricingBundle());
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

  it("accepts only a strict normalized deployment inventory", async () => {
    const body: unknown = JSON.parse(await fixture("dashscope/api.json"));
    const parsed = z
      .object({ output: z.object({ models: z.array(z.unknown()) }).passthrough() })
      .passthrough()
      .parse(body);
    expect(() =>
      parse(source("dashscope-deployable-api"), JSON.stringify({ ...parsed, unexpected: true })),
    ).toThrow();
    const model = z
      .object({ model_name: z.string(), plans: z.array(z.unknown()) })
      .parse(parsed.output.models[0]);
    expect(() =>
      parse(
        source("dashscope-deployable-api"),
        JSON.stringify({
          output: {
            page_no: 1,
            page_size: 1,
            total: 1,
            models: [{ ...model, unexpected: true }],
          },
        }),
      ),
    ).toThrow();
    const models = Array.from({ length: 101 }, (_value, index) => ({
      model_name: `model-${index}`,
      plans: [{ plan: "mu" }],
    }));
    expect(
      parse(
        source("dashscope-deployable-api", 1, 200),
        JSON.stringify({
          request_id: "request-1",
          output: { page_no: 1, page_size: 101, total: 101, models },
        }),
      ),
    ).toHaveLength(101);
  });

  it("uses current Markdown documents and bounded API pagination", () => {
    const value = manifest("dashscope");
    const publicSources = value.sources.filter(({ id }) => id !== "dashscope-deployable-api");
    expect(
      publicSources.every(({ format, url }) => format === "markdown" && url.endsWith(".md")),
    ).toBe(true);
    expect(source("dashscope-pricing")).toMatchObject({
      extractorVersion: "dashscope-pricing-v7",
      linkedDocuments: {
        documents: expect.arrayContaining([
          expect.objectContaining({ url: expect.stringMatching(/\.md$/), optional: true }),
        ]),
      },
    });
    expect(source("dashscope-deployable-api")).toMatchObject({
      extractorVersion: "dashscope-api-v2",
      transport: {
        kind: "dashscope-deployable-models",
        pageSize: 100,
        maxPages: 5,
        maxModels: 500,
      },
    });
  });
});

describe("Kimi adapters", () => {
  const value = manifest("kimi");
  const source = (id: string): SourceManifest => {
    const result = value.sources.find((candidate) => candidate.id === id);
    if (result === undefined) throw new Error(`Missing Kimi source ${id}`);
    return result;
  };
  const parse = (
    configured: SourceManifest,
    body: string,
    onPricingReconciliation?: (item: PricingReconciliationItem) => void,
    onContractFinding?: (evidence: SourceContractEvidence) => void,
  ): ProviderModel[] =>
    parseSource({
      provider: provider(value),
      source: configured,
      body,
      observedAt,
      ...(onPricingReconciliation === undefined ? {} : { onPricingReconciliation }),
      ...(onContractFinding === undefined ? {} : { onContractFinding }),
    });

  it("uses the documented international API origin", () => {
    expect(value.provider).toMatchObject({
      catalog_scope: "mixed",
      regions: ["China", "International"],
    });
    expect(source("kimi-api")).toMatchObject({
      url: "https://api.moonshot.ai/v1/models",
      allowedHosts: ["api.moonshot.ai"],
      extractorVersion: "kimi-api-v2",
    });
    expect(source("kimi-china-api")).toMatchObject({
      url: "https://api.moonshot.cn/v1/models",
      allowedHosts: ["api.moonshot.cn"],
      auth: { env: "MOONSHOT_CN_API_KEY" },
    });
    expect(source("kimi-openapi")).toMatchObject({
      url: "https://platform.kimi.ai/docs/openapi.json",
      allowedHosts: ["platform.kimi.ai"],
      extractorVersion: "kimi-openapi-v4",
    });
    expect(source("kimi-china-openapi")).toMatchObject({
      url: "https://platform.kimi.com/docs/openapi.json",
      allowedHosts: ["platform.kimi.com"],
      extractor: { baseUrl: "https://api.moonshot.cn" },
    });
    expect(source("kimi-international-catalog")).toMatchObject({
      url: "https://platform.kimi.ai/docs/models",
      extractorVersion: "kimi-catalog-v3",
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

  it("signals undocumented inventory extensions while rejecting root drift", async () => {
    const body = await fixture("kimi/api.json");
    const findings: SourceContractEvidence[] = [];
    const models = parse(
      source("kimi-api"),
      body.replace(
        '"supports_reasoning": true',
        '"supports_reasoning": true, "supports_dynamic_tools": true',
      ),
      undefined,
      (finding) => findings.push(finding),
    );
    expect(models).toHaveLength(2);
    expect(findings).toEqual([
      expect.objectContaining({
        disposition: "accept_with_signal",
        diagnostics: [
          expect.objectContaining({
            kind: "unknown_field",
            path: "/supports_dynamic_tools",
            affected_items: 1,
            sample_model_ids: ["kimi-k3"],
          }),
        ],
      }),
    ]);
    expect(() => parse(source("kimi-api"), body.replace("{", '{"unexpected":true,'))).toThrow();
  });

  interface KimiPricingOptions {
    batchApi?: string;
    indexBody?: string;
    onPricingReconciliation?: (item: PricingReconciliationItem) => void;
    overrides?: Readonly<Record<string, string>>;
    sourceId?: string;
  }

  async function pricing(options: KimiPricingOptions = {}): Promise<ProviderModel[]> {
    const {
      batchApi,
      indexBody,
      onPricingReconciliation,
      overrides = {},
      sourceId = "kimi-pricing",
    } = options;
    const configured = source(sourceId);
    const international = sourceId === "kimi-international-pricing";
    const fixtureName = (name: string, extension = "md"): string => {
      const pricingName = name.match(/^pricing-(.+)$/)?.[1];
      if (pricingName !== undefined)
        return `kimi/pricing-${international ? `global-${pricingName}` : pricingName}.${extension}`;
      return `kimi/${name}${international ? "-global" : ""}.${extension}`;
    };
    const origin = new URL(configured.url).origin;
    const documents = [
      ["/docs/pricing/chat-k27-code", "pricing-k27"],
      ["/docs/pricing/chat-k26", "pricing-k26"],
      ["/docs/pricing/chat-k25", "pricing-k25"],
      ["/docs/pricing/chat-v1", "pricing-v1"],
      ["/docs/pricing/batch", "pricing-batch"],
      ["/docs/pricing/chat", "pricing-overview"],
      ["/docs/pricing/tools", "tools"],
      ["/docs/pricing/limits", "limits"],
      ["/docs/api/batch-create", "batch-api"],
      ["/docs/api/chat", "chat-api"],
      ["/docs/api/estimate", "estimate"],
      ["/docs/api/balance", "balance"],
      ["/docs/api/files", "files"],
      ["/docs/api/files-upload", "files-upload"],
      ["/docs/api/files-list", "files-list"],
      ["/docs/api/files-retrieve", "files-retrieve"],
      ["/docs/api/files-delete", "files-delete"],
      ["/docs/api/files-content", "files-content"],
      ["/docs/guide/use-context-caching-feature-of-kimi-api", "cache"],
      ["/docs/guide/use-web-search", "web-search"],
      ["/docs/guide/use-official-tools", "official-tools"],
      ["/docs/guide/use-batch-api", "batch-guide"],
      ["/docs/guide/use-batch-inference", "batch-console"],
      ["/docs/guide/account-and-payments", "account"],
      ["/docs/guide/org-best-practice", "organization"],
      ["/docs/guide/product-plans", "product-plans"],
      ["/docs/introduction", "introduction"],
      ["/docs/agreement/modeluse", "terms"],
      ["/docs/llms.txt", "llms", "txt"],
    ] as const;
    return parse(
      configured,
      JSON.stringify({
        index: {
          url: configured.url,
          body: indexBody ?? (await fixture(fixtureName("pricing-k3"))),
        },
        documents: await Promise.all(
          documents.map(async ([path, name, extension]) => ({
            url: `${origin}${path}`,
            body:
              path === "/docs/api/batch-create" && batchApi !== undefined
                ? batchApi
                : (overrides[name] ?? (await fixture(fixtureName(name, extension)))),
          })),
        ),
      }),
      onPricingReconciliation,
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
      parse(source("kimi-openapi"), body.replace('"cached_tokens"', '"cache_tokens"')),
    ).toThrow("usage fields");
    expect(() =>
      parse(source("kimi-openapi"), body.replace("if the stream is interrupted", "eventually")),
    ).toThrow("streaming usage semantics");
    expect(() =>
      parse(source("kimi-openapi"), body.replace('"low", "high", "max"', '"high", "max"')),
    ).toThrow("reasoning effort");
    expect(() =>
      parse(
        source("kimi-openapi"),
        body.replace("for Kimi K3 it defaults", "for Kimi K4 it defaults"),
      ),
    ).toThrow("output limit identity");
    expect(() =>
      parse(
        source("kimi-openapi"),
        body.replace('"supports_video_in": { "type": "boolean" },', ""),
      ),
    ).toThrow("List Models item fields");
    const china = body
      .replace("https://api.moonshot.ai", "https://api.moonshot.cn")
      .replace(
        "Shows token usage statistics for the entire request; if the stream is interrupted, the final usage chunk may not arrive.",
        "显示整个请求的 Token 使用统计；如果流中断，可能无法收到最终用量。",
      )
      .replace(
        "The maximum number of tokens to generate for the chat completion. The default varies by model: for Kimi K3 it defaults to 131072 and can be set up to 1048576.",
        "聊天补全生成的最大 Token 数量。默认值因模型而异：Kimi K3 默认为 131072，最大可设置为 1048576。",
      );
    expect(parse(source("kimi-china-openapi"), china)).toHaveLength(12);
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
    expect(
      models.find(({ model_id }) => model_id === "kimi-k2.7-code-highspeed")?.limits.context_tokens,
    ).toBeUndefined();
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
    const international = parse(
      source("kimi-international-catalog"),
      await fixture("kimi/models-global.md"),
    );
    expect(international.map(({ model_id }) => model_id)).toEqual(
      models.map(({ model_id }) => model_id),
    );
    expect(international.find(({ model_id }) => model_id === "kimi-k2.5")?.status).toBe("legacy");
    expect(
      international.find(({ model_id }) => model_id === "kimi-k2.7-code-highspeed")?.limits
        .context_tokens,
    ).toBeUndefined();
  });

  it("keeps model rates separate from provider services", async () => {
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
    expect(k26?.price_facts.some(({ meter }) => meter === "tool_call")).toBe(false);
    const commercial = models.flatMap(({ commercial_facts }) => commercial_facts ?? []);
    expect({
      search: commercial.find(
        ({ resource_key, offer_key }) =>
          resource_key === "web-search" && offer_key === "built-in:kimi/kimi-k2.6",
      )?.price_facts[0],
      formulaSearch: commercial.find(
        ({ resource_key, offer_key }) => resource_key === "web-search" && offer_key === "formula",
      )?.price_facts[0],
      formulaConvert: commercial.find(
        ({ resource_key, offer_key }) =>
          resource_key === "formula" && offer_key === "fiber:convert",
      ),
      files: commercial.find(({ resource_key }) => resource_key === "files")?.pricing_state,
    }).toEqual({
      search: expect.objectContaining({
        meter: "web_search",
        price: "0.03",
        currency: "CNY",
        unit: "event",
        conditions: { region: "China" },
      }),
      formulaSearch: expect.objectContaining({
        meter: "web_search",
        price: "0.03",
        unit: "event",
        derived: true,
      }),
      formulaConvert: expect.objectContaining({
        pricing_state: "free",
        price_facts: [],
      }),
      files: "free",
    });
    expect(
      models.find(({ model_id }) => model_id === "kimi-k2.7-code-highspeed")?.api_endpoints,
    ).toBeUndefined();
    const international = await pricing({ sourceId: "kimi-international-pricing" });
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
    expect(
      international
        .flatMap(({ commercial_facts }) => commercial_facts ?? [])
        .find(
          ({ resource_key, offer_key }) =>
            resource_key === "web-search" && offer_key === "built-in:kimi/kimi-k3",
        )?.price_facts[0],
    ).toMatchObject({
      meter: "web_search",
      price: "0.005",
      currency: "USD",
      unit: "event",
      conditions: { region: "International" },
    });
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
    const reconciliation: PricingReconciliationItem[] = [];
    const partial = await pricing({
      indexBody: k3.replace("输入价格（缓存命中）", "输入价格（缓存读取）"),
      onPricingReconciliation: (item) => reconciliation.push(item),
    });
    expect(partial.some(({ model_id }) => model_id === "kimi-k3")).toBe(false);
    expect(partial.some(({ model_id }) => model_id === "kimi-k2.6")).toBe(true);
    expect(reconciliation).toContainEqual(
      expect.objectContaining({
        disposition: "unbound",
        reason_code: "pricing_document_rejected",
      }),
    );
  });

  it("keeps independent prices when Batch accounting evidence drifts", async () => {
    const body = await fixture("kimi/batch-api.md");
    const reconciliation: PricingReconciliationItem[] = [];
    const models = await pricing({
      batchApi: body.replace("POST /v1/batches", "POST /v1/jobs"),
      onPricingReconciliation: (item) => reconciliation.push(item),
    });
    expect(models.find(({ model_id }) => model_id === "kimi-k2.6")?.price_facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          meter: "input_text",
          price: "3.90",
          conditions: { region: "China", service_tier: "batch" },
        }),
      ]),
    );
    expect(reconciliation).toContainEqual(
      expect.objectContaining({ disposition: "unbound", reason_code: "batch_api_contract_drift" }),
    );
  });

  it("rejects only a malformed price row and retains its valid siblings", async () => {
    const v1 = await fixture("kimi/pricing-v1.md");
    const reconciliation: PricingReconciliationItem[] = [];
    const models = await pricing({
      overrides: {
        "pricing-v1": v1.replace(
          '["moonshot-v1-32k", "1M tokens", "¥5.00", "¥20.00", "32,768 tokens"]',
          '["moonshot-v1-32k", "1M tokens", "¥5.00", "32,768 tokens"]',
        ),
      },
      onPricingReconciliation: (item) => reconciliation.push(item),
    });
    expect(models.some(({ model_id }) => model_id === "moonshot-v1-32k")).toBe(false);
    expect(models.find(({ model_id }) => model_id === "moonshot-v1-128k")?.price_facts).toEqual(
      expect.arrayContaining([expect.objectContaining({ meter: "output_text", price: "30.00" })]),
    );
    expect(reconciliation).toContainEqual(
      expect.objectContaining({ disposition: "unsupported", reason_code: "pricing_row_rejected" }),
    );
  });

  it("partitions public prices from account controls and undocumented effective cost", async () => {
    const reconciliation: PricingReconciliationItem[] = [];
    const models = await pricing({
      onPricingReconciliation: (item) => reconciliation.push(item),
    });
    expect(sourcePricingReconciliation(models, reconciliation, true)).toMatchObject({
      basis: "source_item",
      observed_items: 64,
      disposition_counts: {
        normalized: 37,
        explicit_non_numeric: 12,
        excluded: 7,
        unbound: 8,
        ambiguous: 0,
        unsupported: 0,
        unresolved: 0,
      },
    });
    expect(reconciliation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          disposition: "normalized",
          reason_code: "web_search_service_normalized",
          sample: "China:web_search:event",
        }),
        expect.objectContaining({
          disposition: "excluded",
          reason_code: "balance_api_out_of_catalog",
        }),
        expect.objectContaining({
          disposition: "excluded",
          reason_code: "console_consumption_analysis_out_of_catalog",
        }),
        expect.objectContaining({
          disposition: "unbound",
          reason_code: "usage_cost_api_not_documented",
        }),
        expect.objectContaining({
          disposition: "unbound",
          reason_code: "stream_interruption_usage_unavailable",
        }),
        expect.objectContaining({
          disposition: "explicit_non_numeric",
          reason_code: "formula_tool_promotional_free",
          sample: "convert",
        }),
        expect.objectContaining({
          disposition: "explicit_non_numeric",
          reason_code: "file_service_promotional_free",
        }),
        expect.objectContaining({
          disposition: "unbound",
          reason_code: "batch_guide_scope_conflict",
          sample: "kimi-k2.7-code",
        }),
        expect.objectContaining({
          disposition: "unbound",
          reason_code: "formula_tool_promotion_end_not_published",
        }),
        expect.objectContaining({
          disposition: "unbound",
          reason_code: "web_search_documentation_outdated",
        }),
      ]),
    );
    const internationalReconciliation: PricingReconciliationItem[] = [];
    const international = await pricing({
      sourceId: "kimi-international-pricing",
      onPricingReconciliation: (item) => internationalReconciliation.push(item),
    });
    expect(
      sourcePricingReconciliation(international, internationalReconciliation, true),
    ).toMatchObject({
      basis: "source_item",
      observed_items: 65,
      disposition_counts: {
        normalized: 37,
        explicit_non_numeric: 12,
        excluded: 8,
        unbound: 8,
        ambiguous: 0,
        unsupported: 0,
        unresolved: 0,
      },
    });
    expect(internationalReconciliation).toContainEqual({
      disposition: "excluded",
      reason_code: "tax_at_checkout_out_of_catalog",
    });
  });

  it("publishes provider-native inference, search, Formula, and Files topology", async () => {
    const china = await pricing();
    const international = await pricing({ sourceId: "kimi-international-pricing" });
    const published = [
      ...new Map([...china, ...international].map((model) => [model.uid, model])).values(),
    ];
    const partition = assembleParsedProviderPricing(
      "kimi",
      observedAt,
      [
        { source: source("kimi-pricing"), models: china },
        { source: source("kimi-international-pricing"), models: international },
      ],
      published,
    );
    expect(partition).toBeDefined();
    const books = partition?.books ?? [];
    const k26 = books.find(
      ({ scope }) => scope.kind === "models" && scope.model_refs.includes("kimi/kimi-k2.6"),
    );
    expect(k26?.offers.map(({ offer_key }) => offer_key)).toEqual(["sync", "batch"]);
    const sync = k26?.offers.find(({ offer_key }) => offer_key === "sync");
    const batch = k26?.offers.find(({ offer_key }) => offer_key === "batch");
    expect(
      sync?.terms
        .filter((term) => term.kind === "rate")
        .map((term) => [
          term.meter.value,
          term.variants[0]?.charge_binding?.signal.value,
          term.variants[0]?.charge_binding?.aggregation,
        ]),
    ).toEqual(
      expect.arrayContaining([
        ["cache_read_text", "cached_input_tokens", "request"],
        ["input_text", "uncached_input_tokens", "request"],
        ["output_text", "output_tokens", "request"],
      ]),
    );
    expect(
      batch?.terms
        .filter((term) => term.kind === "rate")
        .map((term) => [term.meter.value, term.variants[0]?.charge_binding?.signal.value]),
    ).toEqual(
      expect.arrayContaining([
        ["cache_read_text", undefined],
        ["input_text", undefined],
        ["output_text", "output_tokens"],
      ]),
    );
    expect(sync?.relations).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "exclusive_with" })]),
    );
    expect(batch?.relations).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "exclusive_with" })]),
    );
    expect(sync?.settlement[0]).toMatchObject({ channel: "direct", biller: "Moonshot AI" });

    const resource = (key: string) =>
      books.find(({ scope }) => scope.kind === "provider_resource" && scope.resource_key === key);
    const search = resource("web-search");
    const builtIn = search?.offers.find(({ offer_key }) => offer_key === "built-in:kimi/kimi-k2.6");
    const searchRate = builtIn?.terms.find((term) => term.kind === "rate");
    expect(searchRate).toMatchObject({
      kind: "rate",
      meter: { namespace: "kmodels", value: "web_search" },
      variants: expect.arrayContaining([
        expect.objectContaining({
          charge_binding: expect.objectContaining({
            signal: {
              namespace: "provider",
              provider_id: "kimi",
              value: "emitted_builtin_web_search_calls",
            },
            aggregation: "request",
          }),
        }),
      ]),
    });
    expect(builtIn?.relations).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "requires" })]),
    );
    expect(
      search?.offers
        .find(({ offer_key }) => offer_key === "formula")
        ?.terms.find((term) => term.kind === "rate"),
    ).toMatchObject({
      meter: { namespace: "kmodels", value: "web_search" },
      variants: expect.arrayContaining([
        expect.objectContaining({
          charge_binding: expect.objectContaining({
            signal: expect.objectContaining({ value: "formula_web_search_fiber_executions" }),
            aggregation: "resource",
          }),
        }),
      ]),
    });
    expect(
      resource("formula")?.offers.find(({ offer_key }) => offer_key === "fiber:convert")?.states,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ state: "free" })]));
    expect(resource("files")?.offers[0]).toMatchObject({
      offer_key: "operations",
      states: [expect.objectContaining({ state: "free" })],
      relations: [expect.objectContaining({ kind: "compatible_with" })],
    });
  });

  it("isolates commercial companion drift from valid model-price rows", async () => {
    const tools = await fixture("kimi/tools.md");
    const cases: Array<{
      overrides?: Readonly<Record<string, string>>;
      indexBody?: string;
      reason: string;
    }> = [
      {
        overrides: { tools: tools.replace("finish_reason = stop", "finish_reason = done") },
        reason: "web_search_billing_contract_drift",
      },
    ];
    const organization = await fixture("kimi/organization.md");
    cases.push({
      overrides: { organization: organization.replace("10 分钟", "稍后") },
      reason: "project_consumption_contract_drift",
    });
    const officialTools = await fixture("kimi/official-tools.md");
    cases.push({
      overrides: {
        "official-tools": officialTools.replace("目前官方工具限时免费", "官方工具正常收费"),
      },
      reason: "formula_tools_contract_drift",
    });
    const files = await fixture("kimi/files-upload.md");
    cases.push({
      overrides: { "files-upload": files.replace("文件解析服务限时免费", "文件解析服务收费") },
      reason: "files_upload_contract_drift",
    });
    const terms = await fixture("kimi/terms.md");
    cases.push({
      overrides: { terms: terms.replace("网站价格页面公示", "稍后另行说明") },
      reason: "commercial_terms_drift",
    });
    const k3 = await fixture("kimi/pricing-k3.md");
    cases.push({
      indexBody: k3.replace("文档已经过时", "文档仍然有效"),
      reason: "web_search_warning_drift",
    });
    const llms = await fixture("kimi/llms.txt");
    cases.push({
      overrides: { llms: `${llms}\n- [Costs](https://platform.kimi.com/docs/api/costs.md)` },
      reason: "commercial_index_drift",
    });
    for (const candidate of cases) {
      const reconciliation: PricingReconciliationItem[] = [];
      const models = await pricing({
        ...(candidate.indexBody === undefined ? {} : { indexBody: candidate.indexBody }),
        ...(candidate.overrides === undefined ? {} : { overrides: candidate.overrides }),
        onPricingReconciliation: (item) => reconciliation.push(item),
      });
      expect(models.find(({ model_id }) => model_id === "kimi-k3")?.price_facts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ meter: "output_text", price: "100.00" }),
        ]),
      );
      expect(reconciliation).toContainEqual(
        expect.objectContaining({ disposition: "unbound", reason_code: candidate.reason }),
      );
    }
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
      source("kimi-china-openapi"),
      source("kimi-catalog"),
      source("kimi-international-catalog"),
      source("kimi-pricing"),
      source("kimi-international-pricing"),
    ];
    const openapi = await fixture("kimi/openapi.json");
    const chinaOpenapi = openapi
      .replace("https://api.moonshot.ai", "https://api.moonshot.cn")
      .replace(
        "Shows token usage statistics for the entire request; if the stream is interrupted, the final usage chunk may not arrive.",
        "显示整个请求的 Token 使用统计；如果流中断，可能无法收到最终用量。",
      )
      .replace(
        "The maximum number of tokens to generate for the chat completion. The default varies by model: for Kimi K3 it defaults to 131072 and can be set up to 1048576.",
        "聊天补全生成的最大 Token 数量。默认值因模型而异：Kimi K3 默认为 131072，最大可设置为 1048576。",
      );
    const catalogs = [
      parse(catalogSources[0] ?? source("kimi-openapi"), openapi),
      parse(catalogSources[1] ?? source("kimi-china-openapi"), chinaOpenapi),
      await parsed("kimi", "kimi/models.md", "kimi-catalog"),
      await parsed("kimi", "kimi/models-global.md", "kimi-international-catalog"),
      await pricing(),
      await pricing({ sourceId: "kimi-international-pricing" }),
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
        {
          source: source("kimi-china-api"),
          models: await parsed("kimi", "kimi/api.json", "kimi-china-api"),
        },
      ],
      false,
    );
    expect(models.find(({ model_id }) => model_id === "kimi-k3")?.source_refs).toEqual([
      "kimi-openapi",
      "kimi-china-openapi",
      "kimi-catalog",
      "kimi-international-catalog",
      "kimi-pricing",
      "kimi-international-pricing",
      "kimi-releases",
      "kimi-api",
      "kimi-china-api",
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
    const reconciliation: PricingReconciliationItem[] = [];
    const models = await ollamaLibrary((item) => reconciliation.push(item));
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
      pricing_state: "unknown",
    });
    expect(models.find(({ model_id }) => model_id === "nomic-embed-text")).toMatchObject({
      tasks: ["embeddings"],
      modalities: { input: ["text"], output: ["embedding"] },
      pricing_state: "unknown",
    });
    expect(models.find(({ model_id }) => model_id === "glm-ocr")?.tasks).toEqual([
      "text_generation",
      "ocr",
    ]);
    expect(models[0]?.commercial_facts).toHaveLength(1);
    expect(models[0]?.commercial_facts?.[0]).toMatchObject({
      book_key: "execution:local",
      pricing_state: "externally_billed",
    });
    expect(sourcePricingReconciliation(models, reconciliation, true)).toMatchObject({
      basis: "source_item",
      observed_items: 4,
      disposition_counts: {
        explicit_non_numeric: 4,
        normalized: 0,
        raw: 0,
      },
    });
  });

  it("combines Cloud details, usage levels, and exact extra-usage rates", async () => {
    const reconciliation: PricingReconciliationItem[] = [];
    const models = await ollamaCloud({}, (item) => reconciliation.push(item));
    expect(models).toHaveLength(5);
    expect(models.find(({ model_id }) => model_id === "gpt-oss")).toMatchObject({
      service_families: ["Ollama Cloud", "Ollama Library"],
      pricing_state: "not_published",
    });
    expect(models.find(({ model_id }) => model_id === "gpt-oss:120b")).toMatchObject({
      service_families: ["Ollama Cloud"],
      modalities: { input: ["text"], output: ["text"] },
      capabilities: { reasoning: true, tool_call: true, streaming: true },
      limits: { context_tokens: 131072 },
      updated_date: "2025-08-05",
      pricing_state: "not_published",
      raw_price_facts: [
        expect.objectContaining({
          term_key: "ollama_cloud_usage_level",
          impact: "allowance",
          reason: "requires_usage_aggregation",
          conditions: { account_eligibility: "included_plan_allowance" },
          raw: expect.objectContaining({ amount: "2", unit: "usage level" }),
        }),
      ],
      source_refs: ["ollama-cloud-models"],
    });
    expect(models.find(({ model_id }) => model_id === "kimi-k2.5")).toMatchObject({
      service_families: ["Ollama Cloud", "Ollama Library"],
      status: "active",
      modalities: { input: ["text", "image"], output: ["text"] },
      replacement_model_ids: [],
      raw_price_facts: expect.arrayContaining([
        expect.objectContaining({ term_key: "ollama_cloud_route_retirement" }),
      ]),
    });
    expect(models.find(({ model_id }) => model_id === "gemini-3-flash-preview")).toMatchObject({
      service_families: ["Ollama Cloud", "Ollama Library"],
      status: "active",
      description: "A fast multimodal model.",
    });
    expect(models.find(({ model_id }) => model_id === "kimi-k3")).toMatchObject({
      pricing_state: "numeric",
      limits: { context_tokens: 1048576 },
      price_facts: [
        expect.objectContaining({
          meter: "input_text",
          price: "3.00",
          unit: "million_tokens",
          conditions: { account_eligibility: "extra_usage_balance" },
        }),
        expect.objectContaining({ meter: "cache_read_text", price: "0.30" }),
        expect.objectContaining({ meter: "output_text", price: "15.00" }),
      ],
    });
    expect(models.find(({ model_id }) => model_id === "kimi-k2.5")?.retired_at).toBeUndefined();
    expect(
      models.find(({ model_id }) => model_id === "gemini-3-flash-preview")?.retired_at,
    ).toBeUndefined();
    expect(sourcePricingReconciliation(models, reconciliation, true)).toMatchObject({
      basis: "source_item",
      disposition_counts: {
        normalized: 1,
        raw: 3,
        explicit_non_numeric: 1,
        unbound: 1,
      },
    });
    expect(reconciliation).toEqual(
      expect.arrayContaining([
        {
          disposition: "normalized",
          reason_code: "model_token_rate_card",
          sample: "kimi-k3",
        },
        {
          disposition: "raw",
          reason_code: "cloud_usage_level_preserved",
          sample: "gpt-oss:120b",
        },
        { disposition: "unbound", reason_code: "cached_token_count_not_returned" },
      ]),
    );
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

  it("publishes local execution, plans, balances, web services, and partial Cloud accounting", async () => {
    const librarySource = ollamaSource("ollama-library");
    const cloudSource = ollamaSource("ollama-cloud");
    const libraryModels = await ollamaLibrary();
    const cloudModels = await ollamaCloud();
    const published = applyGroups(
      [],
      [
        { source: librarySource, models: libraryModels },
        { source: cloudSource, models: cloudModels },
      ],
      true,
    );
    const partition = assembleParsedProviderPricing(
      "ollama",
      observedAt,
      [
        { source: librarySource, models: libraryModels },
        { source: cloudSource, models: cloudModels },
      ],
      published,
    );
    expect(partition).toBeDefined();
    const books = partition?.books ?? [];
    const resource = (key: string) =>
      books.find(({ scope }) => scope.kind === "provider_resource" && scope.resource_key === key);
    const plans = resource("ollama-cloud");
    expect(plans?.offers.map(({ offer_key }) => offer_key).sort()).toEqual([
      "enterprise",
      "free",
      "max",
      "pro",
      "team",
    ]);
    expect(plans?.offers.find(({ offer_key }) => offer_key === "max")?.enrollment).toEqual([
      expect.objectContaining({ state: "closed_to_new" }),
    ]);
    expect(plans?.offers.find(({ offer_key }) => offer_key === "team")?.enrollment).toEqual([
      expect.objectContaining({ state: "waitlist" }),
    ]);
    const proUnits = plans?.offers
      .find(({ offer_key }) => offer_key === "pro")
      ?.terms.filter((term) => term.kind === "rate")
      .flatMap((term) => term.variants.map(({ price }) => price.per.factors[0]?.unit.value));
    expect(proUnits).toEqual(expect.arrayContaining(["billing_month", "billing_year"]));
    const teamRate = plans?.offers
      .find(({ offer_key }) => offer_key === "team")
      ?.terms.find((term) => term.kind === "rate");
    expect(teamRate).toMatchObject({
      meter: { namespace: "kmodels", value: "subscription" },
    });
    expect(teamRate?.kind === "rate" ? teamRate.variants[0]?.price.per.factors : undefined).toEqual(
      [
        { unit: { namespace: "kmodels", value: "billing_month" }, power: 1 },
        { unit: { namespace: "kmodels", value: "seat" }, power: 1 },
      ],
    );
    expect(resource("local-execution")).toMatchObject({
      scope: { model_refs: expect.arrayContaining(libraryModels.map(({ uid }) => uid)) },
      offers: [{ offer_key: "local" }],
    });
    expect(resource("local-execution")?.offers[0]?.settlement[0]).toMatchObject({
      channel: "operator",
      payment_sources: ["external_bill"],
    });
    expect(resource("ollama-web")?.offers.map(({ offer_key }) => offer_key)).toEqual([
      "web-fetch",
      "web-search",
    ]);
    const pricedCloud = books.find(
      ({ scope }) => scope.kind === "models" && scope.model_refs.includes("ollama/kimi-k3"),
    );
    const cloudOffer = pricedCloud?.offers.find(({ offer_key }) => offer_key === "cloud-inference");
    expect(cloudOffer?.relations.filter(({ kind }) => kind === "requires")).toHaveLength(2);
    expect(
      cloudOffer?.terms
        .filter((term) => term.kind === "rate")
        .map((term) => [term.meter.value, term.variants[0]?.charge_binding?.signal.value]),
    ).toEqual(
      expect.arrayContaining([
        ["input_text", undefined],
        ["cache_read_text", undefined],
        ["output_text", "output_tokens"],
      ]),
    );
  });

  it("publishes lifecycle only without current Library-family evidence", async () => {
    const value = manifest("ollama");
    const source = ollamaSource("ollama-cloud");
    const bundle = z
      .object({
        catalog: z.object({ body: z.string() }).passthrough(),
        pages: z.array(z.object({ model: z.string() }).passthrough()),
      })
      .passthrough()
      .parse(JSON.parse(await ollamaCloudBody()));
    bundle.catalog.body = bundle.catalog.body.replace(
      'href="/library/kimi-k2.5"',
      'href="/not-library/kimi-k2.5"',
    );
    bundle.pages = bundle.pages.filter(({ model }) => model !== "kimi-k2.5");
    const models = parseSource({
      provider: provider(value),
      source,
      body: JSON.stringify(bundle),
      observedAt,
    });
    expect(models.find(({ model_id }) => model_id === "kimi-k2.5")).toMatchObject({
      service_families: ["Ollama Cloud"],
      status: "deprecated",
      retired_at: "2026-07-31",
      replacement_model_ids: ["kimi-k2.6"],
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
    expect(normalizeOllamaList('{"unexpected":true}')).toBe('{"unexpected":true}');
    expect(
      normalizeOllamaResponse(
        410,
        '{"error":"model was retired at 2026-07-15 00:00:00 -0700 PDT"}',
      ),
    ).toEqual({ error: "model was retired at 2026-07-15 00:00:00 -0700 PDT" });
  });

  it("normalizes model-page usage and cost cards without page chrome", async () => {
    const gptOssPage = await fixture("ollama/gpt-oss-page.html");
    const kimiK3Page = await fixture("ollama/kimi-k3-page.html");
    expect(JSON.parse(normalizeOllamaModelPage("gpt-oss", gptOssPage))).toEqual({
      model: "gpt-oss",
      title: "gpt-oss",
      tags: [{ model: "gpt-oss:120b", label: "medium" }],
    });
    expect(JSON.parse(normalizeOllamaModelPage("kimi-k3", kimiK3Page))).toEqual({
      model: "kimi-k3",
      title: "kimi-k3",
      tags: [{ model: "kimi-k3" }],
      cost: {
        input: "3.00",
        cached: "0.30",
        output: "15.00",
        unit: "1M tokens",
        accountEligibility: "extra_usage_balance",
        plans: ["Pro", "Max"],
      },
    });
    expect(
      JSON.parse(
        normalizeOllamaModelPage("gpt-oss", gptOssPage.replace("Medium Usage", "Variable Usage")),
      ).tags,
    ).toEqual([expect.objectContaining({ model: "gpt-oss:120b", usageText: expect.any(String) })]);
    expect(
      JSON.parse(
        normalizeOllamaModelPage(
          "kimi-k3",
          kimiK3Page.replace("consumes extra usage credits", "uses the included allowance"),
        ),
      ).cost,
    ).toMatchObject({ input: "3.00", cached: "0.30", output: "15.00" });
    expect(
      JSON.parse(normalizeOllamaModelPage("kimi-k3", kimiK3Page.replace("$0.30", "market rate")))
        .cost,
    ).toEqual({
      input: "3.00",
      output: "15.00",
      unit: "1M tokens",
      accountEligibility: "extra_usage_balance",
      plans: ["Pro", "Max"],
    });
  });

  it("keeps models while reporting claim-local documentation drift", async () => {
    const usage = (await fixture("ollama/usage.md")).replace("final chunk", "later response");
    const usageReconciliation: PricingReconciliationItem[] = [];
    expect(
      await ollamaCloud({ documents: { "usage.md": usage } }, (item) =>
        usageReconciliation.push(item),
      ),
    ).toHaveLength(5);
    expect(usageReconciliation).toContainEqual({
      disposition: "unbound",
      reason_code: "native_usage_claim_unavailable",
      sample: "https://docs.ollama.com/api/usage.md",
    });
    const openapi = `${await fixture("ollama/openapi.yaml")}\n        cached_tokens:\n          type: integer`;
    const cacheReconciliation: PricingReconciliationItem[] = [];
    await ollamaCloud({ documents: { "openapi.yaml": openapi } }, (item) =>
      cacheReconciliation.push(item),
    );
    expect(cacheReconciliation).not.toContainEqual({
      disposition: "unbound",
      reason_code: "cached_token_count_not_returned",
    });
    const introduction = (await fixture("ollama/api-introduction.md")).replace(
      "backwards\ncompatible",
      "frequently incompatible",
    );
    const introductionReconciliation: PricingReconciliationItem[] = [];
    await ollamaCloud({ documents: { "api-introduction.md": introduction } }, (item) =>
      introductionReconciliation.push(item),
    );
    expect(introductionReconciliation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason_code: "api_introduction_claim_unavailable" }),
      ]),
    );
    const show = (await fixture("ollama/show-model-details.md")).replace(
      "operationId: show",
      "operationId: inspect",
    );
    const showReconciliation: PricingReconciliationItem[] = [];
    await ollamaCloud({ documents: { "show-model-details.md": show } }, (item) =>
      showReconciliation.push(item),
    );
    expect(showReconciliation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason_code: "show_contract_claim_unavailable" }),
      ]),
    );
    const index = `${await fixture("ollama/docs-llms.txt")}\n- [Costs](https://docs.ollama.com/api/costs.md)`;
    const indexReconciliation: PricingReconciliationItem[] = [];
    await ollamaCloud({ documents: { "docs-llms.txt": index } }, (item) =>
      indexReconciliation.push(item),
    );
    expect(indexReconciliation).toContainEqual({
      disposition: "unbound",
      reason_code: "commercial_page_pending_review",
      sample: "https://docs.ollama.com/api/costs",
    });
  });

  it("keeps independent inventory when list or detail enrichment drifts", async () => {
    const modified = await ollamaCloud({
      transform: (body) =>
        body.replace(
          '"modified_at":"2025-08-05T00:00:00Z"',
          '"modified_at":"2025-08-06T00:00:00Z"',
        ),
    });
    expect(modified.find(({ model_id }) => model_id === "gpt-oss:120b")?.updated_date).toBe(
      "2025-08-06",
    );
    const unknownCapability = await ollamaCloud({
      transform: (body) => body.replace('"completion"', '"unknown-capability"'),
    });
    expect(unknownCapability.find(({ model_id }) => model_id === "gpt-oss:120b")).toBeDefined();
    const missingDetail = await ollamaCloud({
      transform: (body) => body.replace('"status":200', '"status":404'),
    });
    expect(missingDetail.find(({ model_id }) => model_id === "gpt-oss:120b")).toMatchObject({
      status: "active",
      pricing_state: "not_published",
      raw_price_facts: [expect.objectContaining({ term_key: "ollama_cloud_usage_level" })],
    });
    const findings: SourceContractEvidence[] = [];
    const malformedListRow = await ollamaCloud(
      {
        transform: (body) => body.replace('"model":"gpt-oss:120b"', '"model":120'),
      },
      undefined,
      (finding) => findings.push(finding),
    );
    expect(malformedListRow.find(({ model_id }) => model_id === "gpt-oss:120b")).toBeDefined();
    expect(findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ disposition: "accept_with_signal" })]),
    );
    const missingListEnvelope = await ollamaCloud({
      transform: (body) => {
        const bundle = z.object({ list: z.unknown() }).passthrough().parse(JSON.parse(body));
        return JSON.stringify({ ...bundle, list: {} });
      },
    });
    expect(missingListEnvelope.map(({ model_id }) => model_id)).toEqual(
      expect.arrayContaining(["gpt-oss", "kimi-k2.5", "gemini-3-flash-preview", "kimi-k3"]),
    );
  });

  it("signals additive and nested fields without rejecting sibling claims", async () => {
    const findings: SourceContractEvidence[] = [];
    const models = await ollamaCloud(
      {
        transform: (body) =>
          body
            .replace('"name":"gpt-oss:120b"', '"name":"gpt-oss:120b","future_list_field":true')
            .replace(
              '"capabilities":["completion","tools","thinking"]',
              '"future_show_field":"signal","capabilities":["completion","tools","thinking"]',
            ),
      },
      undefined,
      (finding) => findings.push(finding),
    );
    expect(models).toHaveLength(5);
    expect(findings.flatMap(({ diagnostics }) => diagnostics.map(({ path }) => path))).toEqual(
      expect.arrayContaining(["/list/future_list_field", "/show/future_show_field"]),
    );
    const nestedFindings: SourceContractEvidence[] = [];
    expect(
      await ollamaCloud(
        {
          transform: (body) =>
            body.replace(
              '"parent_model":"gpt-oss:120b","format":""',
              '"parent_model":"gpt-oss:120b","future_detail_field":true,"format":""',
            ),
        },
        undefined,
        (finding) => nestedFindings.push(finding),
      ),
    ).toHaveLength(5);
    expect(nestedFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          diagnostics: [expect.objectContaining({ path: "/show/details/future_detail_field" })],
        }),
      ]),
    );
  });

  it("accepts the documented remote-model list fields", async () => {
    const models = await ollamaCloud({
      transform: (body) =>
        body.replace(
          '"model":"gpt-oss:120b","modified_at"',
          '"model":"gpt-oss:120b","remote_model":"gpt-oss:120b","remote_host":"https://ollama.com","modified_at"',
        ),
    });
    expect(models.find(({ model_id }) => model_id === "gpt-oss:120b")).toBeDefined();
  });
});

describe("provider drift validation", () => {
  it("lets a non-exhaustive supplement create only identities absent from exact IDs and aliases", () => {
    const source = manifest("openai").sources.find(({ id }) => id === "openai-deprecations");
    if (source === undefined) throw new Error("Missing OpenAI supplement source");
    const canonical = {
      ...baseModel({
        providerId: "openai",
        id: "gpt-4o",
        name: "GPT-4o",
        sourceId: "openai-models",
        observedAt,
      }),
      aliases: ["gpt-4o-2024-08-06"],
    } satisfies ProviderModel;
    const aliasObservation = {
      ...baseModel({
        providerId: "openai",
        id: "gpt-4o-2024-08-06",
        name: "gpt-4o-2024-08-06",
        sourceId: source.id,
        observedAt,
      }),
      status: "deprecated",
      retired_at: "2026-10-23",
    } satisfies ProviderModel;
    const missing = baseModel({
      providerId: "openai",
      id: "gpt-5-search-api",
      name: "gpt-5-search-api",
      sourceId: source.id,
      observedAt,
    });
    const merged = applySupplementGroups(
      [canonical],
      [{ source, models: [aliasObservation, missing] }],
    );
    expect(merged.map(({ model_id }) => model_id)).toEqual(["gpt-4o", "gpt-5-search-api"]);
    expect(merged[0]).toMatchObject({
      aliases: ["gpt-4o-2024-08-06"],
      status: "deprecated",
      retired_at: "2026-10-23",
      source_refs: ["openai-models", "openai-deprecations"],
    });
  });

  it("prefers an exact catalog identity over another model's alias", () => {
    const inventorySource = manifest("openai").sources.find(({ id }) => id === "openai-api");
    if (inventorySource === undefined) throw new Error("Missing OpenAI inventory source");
    const exact = baseModel({
      providerId: "openai",
      id: "o1",
      name: "Exact model",
      sourceId: "openai-models",
      observedAt,
    });
    const aliasOwner = {
      ...baseModel({
        providerId: "openai",
        id: "o1-preview",
        name: "Preview model",
        sourceId: "openai-models",
        observedAt,
      }),
      aliases: ["o1"],
    };
    const inventory = baseModel({
      providerId: "openai",
      id: "o1",
      name: "Inventory model",
      sourceId: inventorySource.id,
      observedAt,
    });

    const merged = applyGroups(
      [aliasOwner, exact],
      [{ source: inventorySource, models: [inventory] }],
      false,
    );
    expect(merged.find(({ uid }) => uid === exact.uid)).toMatchObject({
      name: "Exact model",
      source_refs: ["openai-models", "openai-api"],
    });
    expect(merged.find(({ uid }) => uid === aliasOwner.uid)).toMatchObject({
      name: "Preview model",
      source_refs: ["openai-models"],
    });
  });

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

  it("keeps evidence derived before sources are merged", () => {
    const configured = manifest("vercel").sources[0];
    if (configured === undefined) throw new Error("Missing Vercel source");
    const source: SourceManifest = { ...configured, fields: ["tasks", "api_endpoints"] };
    const current = baseModel({
      providerId: "vercel",
      id: "acme/model",
      name: "Model",
      sourceId: "catalog",
      observedAt,
    });
    const incoming = normalizeDeliveryModes(
      normalizeModelTasks({
        ...baseModel({
          providerId: "vercel",
          id: "acme/model",
          name: "Model",
          sourceId: source.id,
          observedAt,
        }),
        tasks: ["speech_to_speech"],
        raw_type: "realtime",
        api_endpoints: [{ name: "StartAsyncInvoke", path: "v1/start-async-invoke" }],
      }),
    );
    const merged = normalizeDeliveryModes(
      applyGroups([current], [{ source, models: [incoming] }], false)[0] ?? current,
    );
    expect(merged.task_evidence).toEqual([
      expect.objectContaining({
        task: "speech_to_speech",
        source_ref: source.id,
        kind: "provider_type",
      }),
    ]);
    expect(merged.delivery_mode_evidence).toEqual([
      expect.objectContaining({ mode: "realtime", source_ref: source.id, kind: "provider_type" }),
      expect.objectContaining({ mode: "async", source_ref: source.id, kind: "endpoint" }),
    ]);
    expect(merged.delivery_modes).toEqual(["realtime", "async"]);
  });

  it("retains known enrichment when an optional inventory cannot refresh", () => {
    const source = manifest("amazon-bedrock").sources.find(
      ({ id }) => id === "bedrock-api-us-east-1",
    );
    if (source === undefined) throw new Error("Missing Bedrock inventory source");
    const currentBase = baseModel({
      providerId: "amazon-bedrock",
      id: "example.model-v1:0",
      name: "example.model-v1:0",
      sourceId: "bedrock-models",
      observedAt,
    });
    const previousObservedAt = "2026-07-20T00:00:00.000Z";
    const previous = {
      ...currentBase,
      name: "Inventory name",
      source_refs: ["bedrock-models", source.id],
      observed_at: previousObservedAt,
      first_seen_at: previousObservedAt,
      last_seen_at: previousObservedAt,
      modalities: { input: ["text" as const], output: ["text" as const] },
      capabilities: {
        ...currentBase.capabilities,
        streaming: true,
        fine_tuning: false,
      },
      release_date: "2026-01-10",
      deprecated_at: "2026-05-26",
      retired_at: "2026-11-26",
    } satisfies ProviderModel;
    const current = {
      ...currentBase,
      capabilities: {
        ...currentBase.capabilities,
        batch: true,
      },
    } satisfies ProviderModel;

    expect(retainInventoryFacts([current], [previous], source)).toEqual({
      count: 1,
      models: [
        expect.objectContaining({
          name: "Inventory name",
          release_date: "2026-01-10",
          deprecated_at: "2026-05-26",
          retired_at: "2026-11-26",
          capabilities: expect.objectContaining({
            streaming: true,
            batch: true,
            fine_tuning: false,
          }),
          observed_at: observedAt,
          source_refs: ["bedrock-models", source.id],
        }),
      ],
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

    const dated = { ...previous, release_date: "2026-01-10" };
    expect(
      reconcileCatalog([current], [dated], {
        catalog: new Set(["official-api", "official-website"]),
        exhaustive: new Set(),
        recomputed: new Set(["official-api"]),
        releaseDate: new Set(["official-api"]),
      })[0],
    ).toMatchObject({
      release_date: "2026-01-10",
      source_refs: ["official-api", "official-website"],
    });
    expect(
      reconcileCatalog([{ ...current, release_date: "2026-01-11" }], [dated], {
        catalog: new Set(["official-api", "official-website"]),
        exhaustive: new Set(),
        recomputed: new Set(["official-api"]),
        releaseDate: new Set(["official-api"]),
      })[0]?.release_date,
    ).toBe("2026-01-11");
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
