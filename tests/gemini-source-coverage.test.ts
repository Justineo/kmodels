import { readFile } from "node:fs/promises";
import { expect, it } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import { manifests, type ProviderManifest, type SourceManifest } from "../src/catalog/manifests.ts";
import { baseModel } from "../src/catalog/model.ts";
import { geminiInferenceFixtures } from "./gemini-inference-fixture.ts";
import { geminiGroundingOperation } from "../src/catalog/gemini-grounding-allowances.ts";

function configuration() {
  const manifest: ProviderManifest | undefined = manifests.find((m) => m.provider.id === "gemini");
  const catalog: SourceManifest | undefined = manifest?.sources.find(
    (s) => s.id === "gemini-models",
  );
  const pricing: SourceManifest | undefined = manifest?.sources.find(
    (s) => s.id === "gemini-pricing",
  );
  const api: SourceManifest | undefined = manifest?.sources.find((s) => s.id === "gemini-api");
  if (!manifest || !catalog || !pricing || !api) throw new Error("Missing Gemini sources");
  return { manifest, catalog, pricing, api };
}
const { manifest, catalog, pricing, api } = configuration();
const provider = { ...manifest.provider, source_ids: manifest.sources.map((s) => s.id) };
const at = "2026-11-15T00:00:00.000Z";
const fixture = (name: string, extension = "md") =>
  readFile(new URL(`./fixtures/gemini/${name}.${extension}`, import.meta.url), "utf8");

it("uses method observations positively without inventing absent streaming or Batch negatives", () => {
  const parse = (methods: string[]) =>
    parseSource({
      provider,
      source: api,
      observedAt: at,
      body: JSON.stringify({
        models: [
          { name: "models/gemini-4-hydrogen", version: "001", supportedGenerationMethods: methods },
        ],
      }),
    }).models[0];
  expect(parse(["generateContent", "countTokens"])?.capabilities).toMatchObject({
    streaming: "unknown",
    batch: "unknown",
  });
  expect(parse(["streamGenerateContent", "futureMethod"])?.capabilities).toMatchObject({
    streaming: true,
    batch: "unknown",
  });
  expect(parse(["bidiGenerateContent"])?.capabilities).toMatchObject({
    streaming: true,
    batch: "unknown",
  });
  expect(parse(["batchGenerateContent"])?.capabilities).toMatchObject({
    streaming: "unknown",
    batch: true,
  });
});

it("takes Interactions streaming only from agreeing typed request declarations", async () => {
  const fixtures = await geminiInferenceFixtures();
  const body = await fixture("interactions-streaming");
  const parse = (body: string) =>
    parseSource({
      provider,
      source: catalog,
      observedAt: at,
      body: JSON.stringify({
        ...fixtures.catalog,
        documents: [
          ...fixtures.catalog.documents.filter((d) => !d.url.includes("create-interaction")),
          {
            url: "https://aistudio.google.com/api-reference/interactions-api/create-interaction",
            body,
          },
        ],
      }),
    }).models;
  const positive = parse(body);
  expect(positive.find((m) => m.model_id === "gemini-4-argon")?.capabilities.streaming).toBe(true);
  const baseline = parse(
    body.replaceAll(
      "Input only. Whether the interaction will be streamed.",
      "Output only. Whether the interaction was streamed.",
    ),
  );
  expect(
    positive
      .filter((m) => !m.api_endpoints?.some((e) => e.path === "/v1beta/interactions"))
      .map((m) => [m.model_id, m.capabilities.streaming]),
  ).toEqual(
    baseline
      .filter((m) => !m.api_endpoints?.some((e) => e.path === "/v1beta/interactions"))
      .map((m) => [m.model_id, m.capabilities.streaming]),
  );
  for (const changed of [
    body.replace("**stream**: `boolean`", "**stream**: `integer`"),
    body.replaceAll(
      "Input only. Whether the interaction will be streamed.",
      "Output only. Whether the interaction was streamed.",
    ),
    body.replace("## Request Body", "## Response Body"),
  ])
    expect(
      parse(changed).find((m) => m.model_id === "gemini-4-argon")?.capabilities.streaming,
    ).toBe("unknown");
});

it("normalizes native Contributor line wraps and footnoted grounding prices with their owned programs", async () => {
  const body = await fixture("pricing-current-programs", "txt");
  const catalogModels = ["gemini-4-argon", "gemini-4-hydrogen", "gemini-3-flash-preview"].map(
    (id) => ({
      ...baseModel({ providerId: "gemini", id, name: id, sourceId: catalog.id, observedAt: at }),
      tasks: ["text_generation" as const],
    }),
  );
  const parse = (body: string) =>
    parseSource({
      provider,
      source: pricing,
      observedAt: at,
      catalogModels,
      body: JSON.stringify({ index: { url: pricing.url, body }, documents: [] }),
    });
  const result = parse(body);
  for (const [id, price] of [
    ["gemini-4-argon", "1.00"],
    ["gemini-4-hydrogen", "0.75"],
  ])
    expect(result.models.find((m) => m.model_id === id)?.price_facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          meter: "input_text",
          price,
          conditions: expect.objectContaining({ account_eligibility: "paid_tier_contributor" }),
        }),
      ]),
    );
  expect(
    result.models
      .flatMap((m) => m.raw_price_facts)
      .filter((r) => r.reason === "unsupported_structure"),
  ).toEqual([]);
  expect(
    result.commercial_facts
      ?.filter((f) => f.resource_key === "google-search")
      .flatMap((f) => f.price_facts),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ price: "14", unit: "thousand_search_units" }),
    ]),
  );
  const changed = parse(body.replaceAll(/invite-only\s+basis/g, "unreviewed access basis"));
  expect(
    changed.models
      .find((m) => m.model_id === "gemini-4-hydrogen")
      ?.raw_price_facts.some((r) => r.conditions.account_eligibility === "paid_tier_contributor"),
  ).toBe(true);
  expect(
    changed.models
      .find((m) => m.model_id === "gemini-4-hydrogen")
      ?.price_facts.some((r) => r.conditions.account_eligibility === "paid_tier_contributor"),
  ).toBe(false);
});

it("accepts only an explicit grounding footnote suffix", () => {
  expect(geminiGroundingOperation("Grounding with Google Search ***")).toBe("google_search");
  expect(geminiGroundingOperation("Grounding with Google Web and Image Search **")).toBe(
    "google_search",
  );
  expect(geminiGroundingOperation("Grounding with Google Maps *")).toBe("google_maps");
  for (const label of [
    "Grounding with Google Search experimental",
    "Example: Grounding with Google Search *",
    "Grounding with Google Search * additional fee",
  ])
    expect(geminiGroundingOperation(label)).toBeUndefined();
});
