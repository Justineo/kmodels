import { readFile } from "node:fs/promises";
import { expect, it } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import { manifests } from "../src/catalog/manifests.ts";
import { baseModel } from "../src/catalog/model.ts";
import { mistralRegionalPolicy } from "../src/catalog/mistral-regional-policy.ts";
import { regionalMistralPrices } from "../src/catalog/mistral-regional-pricing.ts";
import { publishedRate } from "../src/catalog/pricing.ts";
import type { SourceParseInput } from "../src/catalog/source-parse.ts";
import { mistralInferenceBundles } from "./mistral-inference-fixture.ts";

const fixture = (name: string) =>
  readFile(new URL(`./fixtures/mistral/${name}`, import.meta.url), "utf8");
it("keeps explicit realtime-only models separate from the offline transcription response", async () => {
  const manifest = manifests.find(({ provider }) => provider.id === "mistral");
  const source = manifest?.sources.find(({ id }) => id === "mistral-models");
  if (!manifest || !source) throw new Error("Missing public inventory");
  const evidence = await mistralInferenceBundles();
  const parse = () =>
    parseSource({
      provider: { ...manifest.provider, source_ids: [source.id] },
      source,
      body: JSON.stringify(evidence.catalog),
      observedAt: "2026-11-15T00:00:00Z",
    }).models.find(({ model_id }) => model_id === "voxtral-mini-transcribe-realtime-3-0");
  expect(parse()?.api_endpoints).toEqual([
    { name: "Realtime Audio Transcriptions", path: "/v1/audio/transcriptions/realtime" },
  ]);
  evidence.catalog.documents = evidence.catalog.documents.filter(
    ({ url }) => !url.endsWith("transcribe-in-realtime.md"),
  );
  expect(parse()?.api_endpoints).toBeUndefined();
});
async function bundle() {
  return {
    index: { url: "https://docs.mistral.ai/inference/pricing", body: "" },
    documents: [
      {
        url: "https://docs.mistral.ai/inference/regional-inference.md",
        body: await fixture("regional-inference.md"),
      },
      {
        url: "https://docs.mistral.ai/_next/static/chunks/regional.js",
        body: await fixture("regional-runtime.txt"),
      },
    ],
  };
}

it("reads the current native regional formula and isolates duplicate or changed arithmetic", async () => {
  const original = await bundle();
  expect(mistralRegionalPolicy(original, "1.75")).toEqual({
    standard: "1.1",
    priority: "1.85",
    allUnits: true,
  });
  for (const mutate of [
    (body: string) => body.replace("1.75+(i-1)", "1.75*i"),
    (body: string) => body.replace("1.1", "1.2"),
    (body: string) => `${body}\n${body}`,
  ]) {
    const changed = {
      ...original,
      documents: original.documents.map((document) =>
        document.url.endsWith(".js") ? { ...document, body: mutate(document.body) } : document,
      ),
    };
    expect(mistralRegionalPolicy(changed, "1.75")).toEqual({ standard: "1.1", allUnits: false });
  }
  expect(
    mistralRegionalPolicy(
      { ...original, documents: [...original.documents, ...original.documents] },
      "1.75",
    ),
  ).toBeUndefined();
  expect(mistralRegionalPolicy(original, undefined)).toEqual({ standard: "1.1", allUnits: true });
});

it("requires public primary identities and rejects a billing identity belonging to another public model", () => {
  const manifest = manifests.find(({ provider }) => provider.id === "mistral");
  const source = manifest?.sources.find(({ id }) => id === "mistral-api-us");
  if (!manifest || !source) throw new Error("Missing native regional inventory");
  const model = baseModel({
    providerId: "mistral",
    id: "public-model",
    name: "Public",
    sourceId: "mistral-models",
    observedAt: "2026-11-15T00:00:00Z",
  });
  model.aliases = ["public-latest"];
  const other = { ...model, model_id: "other-model", aliases: [] };
  const parse = (data: unknown[]) =>
    parseSource({
      provider: { ...manifest.provider, source_ids: [source.id] },
      source,
      body: JSON.stringify({ data }),
      observedAt: model.observed_at,
      catalogModels: [model, other],
    }).models;
  const primary = {
    id: model.model_id,
    capabilities: { completion_chat: true },
    billing_model_name: "internal-billing-version",
  };
  expect(parse([primary])).toEqual([
    expect.objectContaining({
      model_id: model.model_id,
      aliases: [],
      availability: [{ region: "us", deployment_type: "managed_api" }],
      api_endpoints: [{ name: "Chat Completions", path: "/v1/chat/completions" }],
    }),
  ]);
  for (const data of [
    [{ ...primary, id: "public-latest" }],
    [{ ...primary, id: "ft:private-model" }],
    [{ ...primary, billing_model_name: other.model_id }],
    [{ ...primary, billing_model_name: { unexpected: true } }],
    [primary, primary],
  ])
    expect(parse(data)).toEqual([]);
});

it("preserves non-token units and conflicting quotes without extending Priority or Batch", () => {
  const manifest = manifests.find(({ provider }) => provider.id === "mistral");
  const source = manifest?.sources.find(({ id }) => id === "mistral-pricing");
  if (!manifest || !source) throw new Error("Missing pricing source");
  const model = baseModel({
    providerId: "mistral",
    id: "ocr-example",
    name: "OCR",
    sourceId: "mistral-models",
    observedAt: "2026-11-15T00:00:00Z",
  });
  model.price_facts = [
    publishedRate("input_image", "4", "thousand_pages", source.id, "/ 1000 pages", {
      billing_currency: "USD",
    }),
    publishedRate("input_image", "5", "thousand_pages", source.id, "/ 1000 pages", {
      billing_currency: "USD",
    }),
    publishedRate("input_image", "2", "thousand_pages", source.id, "/ 1000 pages", {
      billing_currency: "USD",
      service_tier: "batch",
    }),
  ];
  const input: SourceParseInput = {
    provider: { ...manifest.provider, source_ids: [source.id] },
    source,
    body: "",
    observedAt: model.observed_at,
    inventoryModels: [
      {
        ...model,
        availability: [{ region: "eu", deployment_type: "managed_api" }],
        source_refs: ["mistral-api-eu"],
        api_endpoints: [{ name: "OCR", path: "/v1/ocr" }],
      },
    ],
  };
  // OCR ownership is normally carried by the source's explicit operation.
  model.price_facts = model.price_facts.map((rate) => ({
    ...rate,
    conditions: { ...rate.conditions, operation: "ocr" },
  }));
  const result = regionalMistralPrices(input, model, {
    inputs: [],
    regional: { standard: "1.1", priority: "1.85", allUnits: true },
  });
  expect(result.rates.map(({ price, conditions }) => ({ price, conditions }))).toEqual(
    ["4.4", "5.5"].map((price) => ({
      price,
      conditions: {
        billing_currency: "USD",
        operation: "ocr",
        region: "eu",
        endpoint: "/v1/ocr",
        service_tier: "standard",
      },
    })),
  );
  expect(
    regionalMistralPrices(
      input,
      { ...model, status: "retired" },
      { inputs: [], regional: { standard: "1.1", allUnits: true } },
    ).rates,
  ).toEqual([]);
  expect(regionalMistralPrices(input, model, undefined)).toMatchObject({
    rates: [],
    raw: [expect.anything()],
  });
});
