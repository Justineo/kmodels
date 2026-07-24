import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { manifests } from "../src/catalog/manifests.ts";
import { modelUid } from "../src/catalog/model.ts";
import { catalogEnvelopeSchema, catalogSchema } from "../src/catalog/schema.ts";

async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));
}

describe("generated static catalog", () => {
  it("publishes every provider with coverage and resolvable provenance", async () => {
    const catalog = catalogSchema.parse(await json("data/catalog.json"));
    expect(catalog.providers).toHaveLength(19);
    expect(catalog.coverage).toHaveLength(19);
    expect(catalog.models.length).toBeGreaterThan(0);

    const sourceIds = new Set(catalog.sources.map((source) => source.id));
    const referencedSourceIds = new Set(catalog.models.flatMap((model) => model.source_refs));
    const modelIds = new Set<string>();
    const manifestsByProvider = new Map(
      manifests.map((manifest) => [manifest.provider.id, manifest.provider]),
    );
    for (const provider of catalog.providers) {
      expect(provider.name).toBe(manifestsByProvider.get(provider.id)?.name);
    }
    for (const model of catalog.models) {
      expect(modelIds.has(model.uid)).toBe(false);
      modelIds.add(model.uid);
      expect(model.uid).toBe(modelUid(model.provider_id, model.model_id, model.version));
      expect(model.source_refs.every((source) => sourceIds.has(source))).toBe(true);
      expect(model.pricing.every((rate) => sourceIds.has(rate.source_ref))).toBe(true);
      expect(
        model.routes?.every(
          (route) =>
            sourceIds.has(route.source_ref) && model.source_refs.includes(route.source_ref),
        ) ?? true,
      ).toBe(true);
      expect(model.account_availability).toBe("unknown");
    }

    const manifestsBySource = new Map(
      manifests.flatMap((manifest) => manifest.sources.map((source) => [source.id, source])),
    );
    for (const source of catalog.sources) {
      expect(referencedSourceIds.has(source.id)).toBe(true);
      const configured = manifestsBySource.get(source.id);
      expect(configured?.allowedHosts).toContain(new URL(source.url).hostname);
      expect(source.source.length).toBeGreaterThan(0);
      expect(source).not.toHaveProperty("source_type");
      expect(source).not.toHaveProperty("access");
      expect(source).not.toHaveProperty("format");
    }
  });

  it("keeps the public envelope aligned with durable state", async () => {
    const catalog = catalogSchema.parse(await json("data/catalog.json"));
    const envelope = catalogEnvelopeSchema.parse(await json("public/v1/catalog/index.json"));
    expect(envelope.catalog_version).toBe(catalog.catalog_version);
    expect(envelope.data.models).toHaveLength(catalog.models.length);
    expect(envelope.data.providers).toEqual(catalog.providers);
  });

  it("publishes vLLM as an explicitly empty runtime scope", async () => {
    const catalog = catalogSchema.parse(await json("data/catalog.json"));
    const provider = catalog.providers.find(({ id }) => id === "vllm");
    const coverage = catalog.coverage.find(({ provider_id }) => provider_id === "vllm");
    expect({
      source_ids: provider?.source_ids,
      catalog_version: provider?.catalog_version,
      coverage,
      models: catalog.models.filter(({ provider_id }) => provider_id === "vllm"),
      sources: catalog.sources.filter(({ provider_id }) => provider_id === "vllm"),
    }).toEqual({
      source_ids: [],
      catalog_version: undefined,
      coverage: {
        provider_id: "vllm",
        status: "not_configured",
        model_count: 0,
        price_rate_count: 0,
        checked_at: catalog.generated_at,
        reason: "No explicitly allowlisted runtime endpoint is configured.",
      },
      models: [],
      sources: [],
    });
  });

  it("keeps Hugging Face within its operated-service boundary", async () => {
    const catalog = catalogSchema.parse(await json("data/catalog.json"));
    const models = catalog.models.filter(({ provider_id }) => provider_id === "huggingface");
    const sources = new Set(models.flatMap(({ source_refs }) => source_refs));
    expect(models.length).toBeGreaterThan(500);
    expect(models.length).toBeLessThan(3_000);
    expect([...sources].sort()).toEqual(["huggingface-hf-inference", "huggingface-router"]);
  });

  it("publishes Bedrock route evidence without duplicating shared endpoint facts", async () => {
    const catalog = catalogSchema.parse(await json("data/catalog.json"));
    const models = catalog.models.filter(({ provider_id }) => provider_id === "amazon-bedrock");
    const coverage = catalog.coverage.find(({ provider_id }) => provider_id === "amazon-bedrock");
    const deepseek = models.find(({ model_id }) => model_id === "deepseek.v3.2");
    expect(coverage?.status).toBe("fresh");
    expect(models.flatMap(({ api_endpoints }) => api_endpoints ?? []).length).toBeGreaterThan(200);
    expect(models.flatMap(({ availability }) => availability).length).toBeGreaterThan(1_500);
    expect(deepseek?.api_endpoints?.filter(({ name }) => name === "Chat Completions")).toEqual([
      { name: "Chat Completions", path: "v1/chat/completions" },
    ]);
  });

  it("keeps Azure OpenAI as a service family inside Microsoft Foundry", async () => {
    const catalog = catalogSchema.parse(await json("data/catalog.json"));
    const models = catalog.models.filter(({ provider_id }) => provider_id === "azure");
    const families = new Set(models.flatMap(({ service_families }) => service_families ?? []));
    expect(families).toEqual(
      new Set([
        "Azure OpenAI",
        "Foundry Models from partners and community",
        "Foundry Models sold by Azure",
      ]),
    );
  });

  it("publishes the repaired authenticated inventories without transport or schema failures", async () => {
    const catalog = catalogSchema.parse(await json("data/catalog.json"));
    const repairedSources = new Set([
      "cohere-api",
      "dashscope-deployable-api",
      "gemini-api",
      "kimi-api",
      "vertex-model-garden-api",
    ]);
    expect(
      catalog.warnings.filter(
        (warning) =>
          "source_id" in warning &&
          warning.source_id !== undefined &&
          repairedSources.has(warning.source_id) &&
          ["source_fetch_failed", "source_parse_failed"].includes(warning.code),
      ),
    ).toEqual([]);
  });

  it("does not publish credential identities in collection diagnostics", async () => {
    const catalog = catalogSchema.parse(await json("data/catalog.json"));
    const diagnostics = JSON.stringify({
      coverage: catalog.coverage,
      warnings: catalog.warnings,
      quarantine: await json("data/quarantine.json"),
    });
    expect(diagnostics).not.toMatch(
      /\barn:aws(?:-[a-z0-9-]+)?:|\b\d{12}\b|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i,
    );
  });

  it("does not collapse an exact catalog ID through another model's alias", async () => {
    const catalog = catalogSchema.parse(await json("data/catalog.json"));
    const o1 = catalog.models.find((model) => model.uid === "openai/o1");
    const preview = catalog.models.find((model) => model.uid === "openai/o1-preview");
    expect({
      name: o1?.name,
      description: o1?.description,
      context: o1?.limits.context_tokens,
    }).toEqual({
      name: "o1",
      description: "Previous full o-series reasoning model",
      context: 200_000,
    });
    expect(preview?.name).toBe("o1 Preview");
    expect(o1?.aliases).not.toContain("o1-preview-2024-09-12");
  });

  it("publishes the complete structured Vercel catalog without hiding missing prices", async () => {
    const catalog = catalogSchema.parse(await json("data/catalog.json"));
    const models = catalog.models.filter((model) => model.provider_id === "vercel");
    const rates = models.flatMap((model) => model.pricing);
    const missingPrices = models.filter(
      (model) => model.pricing_status === "unknown" || model.pricing_status === "not_published",
    );
    const embedding = models.find((model) => model.model_id === "alibaba/qwen3-embedding-0.6b");
    const realtime = models.find((model) => model.model_id === "openai/gpt-5.6-luna");
    expect(models.length).toBeGreaterThan(250);
    expect(rates.length).toBeGreaterThan(1_000);
    expect(models.every((model) => model.release_date !== undefined)).toBe(true);
    expect(embedding?.modalities.output).toEqual(["embedding"]);
    expect(realtime?.types).toEqual(["generate", "realtime"]);
    const hasMissingPricingWarning = catalog.warnings.some(
      (warning) =>
        warning.code === "missing_field" &&
        "provider_id" in warning &&
        warning.provider_id === "vercel" &&
        warning.field === "pricing",
    );
    expect(hasMissingPricingWarning).toBe(missingPrices.length > 0);
  });
});
