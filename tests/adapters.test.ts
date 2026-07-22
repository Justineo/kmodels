import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import {
  classifyModelTypes,
  multiplyDecimal,
  parseSource,
  scaleDecimal,
} from "../src/catalog/adapters.ts";
import { curlResponse, linkedDocumentUrls } from "../src/catalog/fetch.ts";
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

describe("decimal normalization", () => {
  it("scales source token prices without floating-point arithmetic", () => {
    expect(scaleDecimal("0.00000012", 6)).toBe("0.12");
    expect(scaleDecimal("0.000002", 6)).toBe("2");
    expect(scaleDecimal("1.25", 6)).toBe("1250000");
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

describe("document adapter", () => {
  it("uses a matching link target when its display label is not an API ID", async () => {
    const models = await parsed("xai", "document/xai.md");
    expect(models.map(({ model_id, types }) => ({ model_id, types }))).toEqual([
      { model_id: "grok-4.5", types: ["generate"] },
    ]);
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
  it("keeps model-level fields only when route facts agree", async () => {
    const model = (await parsed("huggingface", "huggingface/normal.json"))[0];
    expect(model?.limits.context_tokens).toBe(65536);
    expect(model?.capabilities.tool_call).toBe(true);
    expect(model?.types).toEqual(["generate"]);
    expect(model?.modalities.input).toEqual(["text", "image"]);
  });

  it("keeps every route price separate", async () => {
    const model = (await parsed("huggingface", "huggingface/pricing.json"))[0];
    expect({
      id: model?.model_id,
      input_rates: model?.pricing.filter((rate) => rate.meter === "input_text").length,
      output_rates: model?.pricing.filter((rate) => rate.meter === "output_text").length,
      routes: [
        ...new Set(model?.pricing.flatMap((rate) => rate.conditions.route_provider ?? []) ?? []),
      ].sort(),
      pricing_status: model?.pricing_status,
    }).toEqual(await expected("huggingface/expected.json"));
  });

  it("rejects models without a live route record", async () => {
    await expect(parsed("huggingface", "huggingface/broken.json")).rejects.toThrow("schema drift");
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
