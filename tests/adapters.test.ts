import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import {
  classifyModelTask,
  multiplyDecimal,
  parseSource,
  scaleDecimal,
} from "../src/catalog/adapters.ts";
import { curlResponse, linkedDocumentUrls } from "../src/catalog/fetch.ts";
import { manifests, type ProviderManifest, type SourceManifest } from "../src/catalog/manifests.ts";
import type { Provider, ProviderModel } from "../src/catalog/schema.ts";
import { validateProvider } from "../src/catalog/validation.ts";

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

describe("decimal normalization", () => {
  it("scales source token prices without floating-point arithmetic", () => {
    expect(scaleDecimal("0.00000012", 6)).toBe("0.12");
    expect(scaleDecimal("0.000002", 6)).toBe("2");
    expect(scaleDecimal("1.25", 6)).toBe("1250000");
    expect(multiplyDecimal("2.50", "1.25")).toBe("3.125");
  });
});

describe("model task taxonomy", () => {
  it("normalizes explicit task markers into one task dimension", () => {
    const task = (modelId: string): ReturnType<typeof classifyModelTask> =>
      classifyModelTask({
        modelId,
        name: modelId,
        rawType: undefined,
        modalities: { input: [], output: [] },
        fallback: "text_generation",
      });
    expect([
      task("text-embedding-3-large"),
      task("cohere/rerank-v4-fast"),
      task("gpt-4o-transcribe"),
      task("gpt-image-2"),
      task("gpt-realtime-2"),
      task("computer-use-preview"),
      task("voxtral-tts-26-03"),
      task("claude-sonnet-5"),
    ]).toEqual([
      "embedding",
      "rerank",
      "speech_to_text",
      "image_generation",
      "speech_to_speech",
      "computer_use",
      "text_to_speech",
      "text_generation",
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
});

describe("OpenAI adapters", () => {
  it("combines the complete model index with rich model pages", async () => {
    const models = await parsed("openai", "openai/catalog.json");
    const model = models.find((candidate) => candidate.model_id === "gpt-5.4");
    const embedding = models.find((candidate) => candidate.model_id === "text-embedding-3-large");
    expect({
      name: model?.name,
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
      },
      status: "active",
      embedding_type: ["embedding"],
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

describe("document adapter", () => {
  it("uses a matching link target when its display label is not an API ID", async () => {
    const models = await parsed("xai", "document/xai.md");
    expect(models.map(({ model_id, types }) => ({ model_id, types }))).toEqual([
      { model_id: "grok-4.5", types: ["text_generation"] },
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
    expect(models[0]?.types).toEqual(["text_generation"]);
    expect(models[0]?.modalities.input).toEqual(["text", "image"]);
  });
});

describe("Vercel adapter", () => {
  it("parses the normal catalog shape", async () => {
    const model = (await parsed("vercel", "vercel/normal.json"))[0];
    expect(model?.limits).toEqual({ context_tokens: 32768, max_output_tokens: 4096 });
  });

  it("preserves pricing tiers and normalizes token units", async () => {
    const model = (await parsed("vercel", "vercel/pricing.json"))[0];
    expect({
      id: model?.model_id,
      input: model?.pricing.find((rate) => rate.meter === "input_text")?.price,
      output: model?.pricing.find((rate) => rate.meter === "output_text")?.price,
      cache_rates: model?.pricing.filter((rate) => rate.meter === "cache_read_text").length,
      pricing_status: model?.pricing_status,
    }).toEqual(await expected("vercel/expected.json"));
  });

  it("detects item schema drift", async () => {
    await expect(parsed("vercel", "vercel/broken.json")).rejects.toThrow("schema drift");
  });
});

describe("Cerebras adapter", () => {
  it("retains explicit capabilities and preview status", async () => {
    const model = (await parsed("cerebras", "cerebras/normal.json"))[0];
    expect(model?.capabilities.reasoning).toBe(true);
    expect(model?.types).toEqual(["text_generation"]);
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
    expect(model?.types).toEqual(["text_generation"]);
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
      type: "runtime_api",
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
  it("quarantines large deletions and price jumps", async () => {
    const model = (await parsed("vercel", "vercel/pricing.json"))[0];
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
