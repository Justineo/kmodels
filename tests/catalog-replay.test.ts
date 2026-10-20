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
