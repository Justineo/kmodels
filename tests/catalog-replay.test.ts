import { readFile } from "node:fs/promises";
import { expect, it } from "vite-plus/test";
import { replayCatalogEvidence } from "../scripts/replay-catalog-evidence.ts";
import { sha256 } from "../src/catalog/io.ts";
import { baseModel } from "../src/catalog/model.ts";
import { providerModelSchema } from "../src/catalog/schema.ts";

async function evidence() {
  const body = await readFile(
    new URL("./fixtures/deepseek/updates-zh.html", import.meta.url),
    "utf8",
  );
  return {
    source_id: "deepseek-updates",
    scope: "source",
    source_url: "https://api-docs.deepseek.com/zh-cn/updates",
    observed_at: "2026-10-20T05:36:32.249Z",
    source_hash: sha256(body),
    body,
  };
}

it("replays the complete saved body with its actual observation clock and current extractor", async () => {
  const input = await evidence();
  const summary = replayCatalogEvidence("deepseek-updates", input);
  expect(summary).toMatchObject({
    stage: "parse",
    observed_at: input.observed_at,
    source_hash: input.source_hash,
    context: null,
    extractor_version: "deepseek-updates-v5",
  });
  expect(summary.models).toContainEqual(
    expect.objectContaining({
      uid: "deepseek/deepseek-v4-pro",
      release_date: "2026-04-24",
    }),
  );
});

it("rejects mutated bodies, wrong source identities, isolated companions and parse errors", async () => {
  const input = await evidence();
  expect(() => replayCatalogEvidence("deepseek-updates", { ...input, body: "changed" })).toThrow(
    "hash",
  );
  expect(() => replayCatalogEvidence("xai-models", input)).toThrow("identity");
  expect(() =>
    replayCatalogEvidence("deepseek-updates", { ...input, source_url: "https://example.com/" }),
  ).toThrow("URL");
  expect(() =>
    replayCatalogEvidence("deepseek-updates", { ...input, scope: "companion" }),
  ).toThrow();
  expect(() =>
    replayCatalogEvidence("deepseek-updates", {
      ...input,
      body: "",
      source_hash: sha256(""),
    }),
  ).toThrow();
});

it("uses explicit metadata context without inventing previous prices and avoids pricing health claims for metadata sources", async () => {
  const context = [
    providerModelSchema.parse(
      baseModel({
        providerId: "openai",
        id: "gpt-test",
        name: "Test",
        sourceId: "openai-models",
        observedAt: "2026-10-20T05:36:32.249Z",
      }),
    ),
  ];
  const body =
    "Flagship models\nStandard\n| Model | Short context input | Short context output |\n| --- | --- | --- |\n| gpt-test | $2 | $3 |";
  const input = {
    ...(await evidence()),
    source_id: "openai-pricing",
    source_url: "https://developers.openai.com/api/docs/pricing.md",
    body,
    source_hash: sha256(body),
  };
  const summary = replayCatalogEvidence("openai-pricing", input, context);
  expect(summary.models).toContainEqual(
    expect.objectContaining({ uid: "openai/gpt-test", prices: 2 }),
  );
  expect(summary.context?.model_count).toBe(1);
  expect(replayCatalogEvidence("deepseek-updates", await evidence()).reconciliation).toBeNull();
  expect(() =>
    replayCatalogEvidence(
      "openai-pricing",
      input,
      context.map((model) => ({ ...model, provider_id: "unrelated" })),
    ),
  ).toThrow("another provider");
});

it("forwards structured previous_catalog_models and previous_retail_meters for Azure Retail replay", async () => {
  const retailFixture = JSON.parse(
    await readFile(
      new URL("./fixtures/azure/retail-catalog-matching.json", import.meta.url),
      "utf8",
    ),
  ) as { prices: Array<{ skuName: string; meterId: string; [key: string]: unknown }> };
  const soraRow = retailFixture.prices.find(({ skuName }) => skuName === "Sora 2 glbl");
  expect(soraRow).toBeDefined();
  const observedAt = "2026-10-20T05:36:32.249Z";
  const makeAzureModel = (
    id: string,
    version?: string,
    tasks: ("text_generation" | "video_generation")[] = ["text_generation"],
  ) =>
    providerModelSchema.parse({
      ...baseModel({
        providerId: "azure",
        id,
        ...(version === undefined ? {} : { version }),
        name: id,
        sourceId: "azure-models",
        observedAt,
      }),
      service_families: ["Azure OpenAI"],
      tasks,
    });
  // Build 20 matching Azure OpenAI versions + retail rows so minModels=20 passes, plus the historical Sora 2 glbl row.
  const baseRow = retailFixture.prices[0];
  expect(baseRow).toBeDefined();
  const currentCatalog = Array.from({ length: 20 }, (_, i) => {
    const day = String(i + 1).padStart(2, "0");
    return makeAzureModel("gpt-4.1", `2025-04-${day}`);
  });
  const fillerRows = currentCatalog.map((_, i) => {
    const day = String(i + 1).padStart(2, "0");
    return {
      ...baseRow,
      skuName: `gpt-4.1 04${day} Inp glbl`,
      meterName: `gpt-4.1 04${day} Inp glbl 1M Tokens`,
      meterId: `replay-meter-${i}`,
      retailPrice: 1.5,
    };
  });
  const body = JSON.stringify({ prices: [...fillerRows, soraRow] });
  const oldSora = makeAzureModel("sora-2", "2025-10-06", ["video_generation"]);
  const evidenceInput = {
    source_id: "azure-retail-prices",
    scope: "source" as const,
    source_url: "https://prices.azure.com/api/retail/prices",
    observed_at: observedAt,
    source_hash: sha256(body),
    body,
  };

  // Without previous_catalog_models, Sora 2 glbl does not bind.
  const plainArray = replayCatalogEvidence("azure-retail-prices", evidenceInput, currentCatalog);
  expect(plainArray.models.some(({ uid }) => uid === oldSora.uid)).toBe(false);

  // With structured previous_catalog_models, Sora 2 glbl binds identically to live collection.
  const withPrevNoMeters = replayCatalogEvidence("azure-retail-prices", evidenceInput, {
    catalog_models: currentCatalog,
    previous_catalog_models: [oldSora],
  });
  expect(withPrevNoMeters.models.some(({ uid }) => uid === oldSora.uid)).toBe(true);

  const withPrevAndMeters = replayCatalogEvidence("azure-retail-prices", evidenceInput, {
    catalog_models: currentCatalog,
    previous_catalog_models: [oldSora],
    previous_retail_meters: ["azure/sora-2|10000000-0000-0000-0000-000000000007|"],
  });
  expect(withPrevAndMeters.models.some(({ uid }) => uid === oldSora.uid)).toBe(true);

  // context.sha256 MUST distinguish all three context shapes (plain array, without meters, with meters).
  const hashes = new Set([
    plainArray.context?.sha256,
    withPrevNoMeters.context?.sha256,
    withPrevAndMeters.context?.sha256,
  ]);
  expect(hashes.size).toBe(3);
  expect(withPrevAndMeters.context).toMatchObject({
    model_count: 20,
    previous_model_count: 1,
    previous_retail_meter_count: 1,
  });
});
