import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import { extractVertexPricingInputs } from "../src/catalog/vertex-accounting.ts";
import { manifests, type ProviderManifest } from "../src/catalog/manifests.ts";
import { baseModel } from "../src/catalog/model.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";
import { publishedRate } from "../src/catalog/pricing.ts";
import type {
  ParsedProviderModel,
  SourcePriceFact,
  SourceCommercialPricingFact,
} from "../src/catalog/pricing-source.ts";
import type { ModelTask, ProviderModel } from "../src/catalog/schema.ts";

const observedAt = "2026-10-20T00:00:00.000Z";
function configuration() {
  const manifest: ProviderManifest | undefined = manifests.find(
    ({ provider }) => provider.id === "vertex",
  );
  const source = manifest?.sources.find(({ id }) => id === "vertex-pricing");
  if (manifest === undefined || source === undefined) throw new Error("Missing Vertex source");
  return { manifest, source };
}
const { manifest, source } = configuration();
const provider = { ...manifest.provider, source_ids: manifest.sources.map(({ id }) => id) };
const generate = {
  name: "generateContent",
  path: "/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:generateContent",
};
const predict = {
  name: "predict",
  path: "/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:predict",
};
async function fixture(name: string) {
  return readFile(new URL(`./fixtures/vertex/${name}`, import.meta.url), "utf8");
}
function model(tasks: ModelTask[], endpoints: ProviderModel["api_endpoints"]): ParsedProviderModel {
  return {
    ...baseModel({
      providerId: "vertex",
      id: "protocol-test",
      name: "Protocol Test",
      sourceId: source.id,
      observedAt,
    }),
    tasks,
    api_endpoints: endpoints,
    service_families: ["publishers/google"],
  };
}
async function binding(
  tasks: ModelTask[],
  endpoints: ProviderModel["api_endpoints"],
  meter: SourcePriceFact["meter"],
  unit: SourcePriceFact["unit"],
) {
  const target = model(tasks, endpoints);
  target.price_facts = [publishedRate(meter, "3", unit, source.id, "Reviewed synthetic tariff")];
  const documents = [
    {
      url: "https://aiplatform.googleapis.com/$discovery/rest?version=v1beta1",
      body: await fixture("discovery.json"),
    },
    {
      url: "https://docs.cloud.google.com/vertex-ai/generative-ai/docs/image/generate-images",
      body: await fixture("accounting-image.html"),
    },
    {
      url: "https://docs.cloud.google.com/vertex-ai/generative-ai/docs/image/set-output-resolution",
      body: await fixture("accounting-image-resolution.html"),
    },
  ];
  const inputs = extractVertexPricingInputs(documents, source.id);
  const partition = assembleParsedProviderPricing(
    "vertex",
    observedAt,
    [{ source, models: [target], pricing_inputs: inputs }],
    [target],
  );
  const term = partition?.books[0]?.offers[0]?.terms.find((t) => t.kind === "rate");
  if (term?.kind !== "rate") throw new Error("Missing tariff");
  return term.variants[0]?.charge_binding;
}

describe("Vertex protocol ownership", () => {
  it.each([
    {
      name: "Live",
      tasks: ["speech_to_speech"] satisfies ModelTask[],
      endpoints: [],
      expected: false,
    },
    {
      name: "GenerateContent",
      tasks: ["text_generation"] satisfies ModelTask[],
      endpoints: [generate],
      expected: true,
    },
    {
      name: "predict",
      tasks: ["image_generation"] satisfies ModelTask[],
      endpoints: [predict],
      expected: false,
    },
  ])(
    "scopes grounding context selectors to the $name model's protocol",
    async ({ tasks, endpoints, expected }) => {
      const target = model(tasks, endpoints);
      const inputs = extractVertexPricingInputs(
        [
          {
            url: "https://aiplatform.googleapis.com/$discovery/rest?version=v1beta1",
            body: await fixture("discovery.json"),
          },
        ],
        source.id,
      );
      const fact: SourceCommercialPricingFact = {
        source_ref: source.id,
        book_key: "service:google-maps",
        book_name: "Maps",
        resource_kind: "service",
        resource_key: "google-maps",
        model_refs: [target.uid],
        offer_key: `request:${target.uid}`,
        offer_name: "Maps",
        billing_mode: "usage",
        pricing_state: "numeric",
        price_facts: [
          publishedRate("maps_search", "25", "thousand_requests", source.id, "Reviewed tariff", {
            context_max_tokens: 200000,
          }),
        ],
        raw_price_facts: [],
      };
      const partition = assembleParsedProviderPricing(
        "vertex",
        observedAt,
        [{ source, models: [target], pricing_inputs: inputs, commercial_facts: [fact] }],
        [target],
      );
      const term = partition?.books[0]?.offers[0]?.terms.find((t) => t.kind === "rate");
      if (term?.kind !== "rate") throw new Error("Missing Maps rate");
      const selectors = term.variants[0]?.selector_sources ?? [];
      expect(selectors.length > 0).toBe(expected);
      if (expected)
        expect(selectors).toContainEqual(
          expect.objectContaining({
            dimension: { namespace: "kmodels", value: "context_tokens" },
            locator: { kind: "json_pointer", value: "/usageMetadata/promptTokenCount" },
          }),
        );
    },
  );
  it("does not borrow GenerateContent token usage for a predict-only model", async () => {
    const result = await binding(["text_generation"], [predict], "input_text", "million_tokens");
    expect(result).toBeDefined();
    expect(result?.quantity_methods?.flatMap((m) => m.input_sources ?? []) ?? []).toEqual([]);
  });
  it("keeps Live quantities caller-owned instead of borrowing GenerateContent usage", async () => {
    const result = await binding(["speech_to_speech"], undefined, "input_audio", "million_tokens");
    expect(result).toBeDefined();
    expect(result?.quantity_methods?.flatMap((m) => m.input_sources ?? []) ?? []).toEqual([]);
  });
  it("keeps a separately documented GenerateContent route for a Live-capable model", async () => {
    const result = await binding(
      ["speech_to_speech", "text_generation"],
      [generate],
      "input_audio",
      "million_tokens",
    );
    expect(
      result?.quantity_methods
        ?.flatMap((m) => m.input_sources ?? [])
        .some((s) => s.locator.value.startsWith("GenerateContentResponse")),
    ).toBe(true);
  });
  it.each([
    { name: "GenerateContent", endpoints: [generate], expected: ["GenerateContentResponse"] },
    { name: "Imagen", endpoints: [predict], expected: ["/predictions"] },
    {
      name: "both",
      endpoints: [generate, predict],
      expected: ["GenerateContentResponse", "/predictions"],
    },
    { name: "unproved", endpoints: [], expected: [] },
  ])("restricts image counters to the documented $name route", async ({ endpoints, expected }) => {
    const result = await binding(["image_generation"], endpoints, "image_generation", "image");
    expect(result).toBeDefined();
    const paths = [
      ...new Set(
        result?.quantity_methods
          ?.flatMap((m) => m.input_sources ?? [])
          .map((s) => s.locator.value) ?? [],
      ),
    ];
    expect(paths).toHaveLength(expected.length);
    for (const path of expected) expect(paths.some((value) => value.startsWith(path))).toBe(true);
  });
  it("publishes a caller-owned music item quantity for an item tariff", async () => {
    const result = await binding(["audio_generation"], [predict], "output_audio", "thousand_items");
    expect(result).toMatchObject({
      signal: { namespace: "provider", provider_id: "vertex", value: "generated_music_items" },
      aggregation: "request",
    });
    expect(result?.quantity_methods).toBeUndefined();
  });
});

describe("Vertex media price units", () => {
  function parse(price: string, header = "Price") {
    const target = {
      ...model(["video_generation"], [predict]),
      model_id: "veo-3.1-generate-001",
      uid: "vertex/veo-3.1-generate-001",
      name: "Veo 3.1",
    };
    const findings: unknown[] = [];
    const result = parseSource({
      provider,
      source,
      observedAt,
      catalogModels: [target],
      body: JSON.stringify({
        index: {
          url: source.url,
          body: `<div class="devsite-article-body"><h2>Veo</h2><table><thead><tr><th>Model</th><th>Feature</th><th>Description</th><th>Input</th><th>Output</th><th>Output Resolution</th><th>${header}</th></tr></thead><tbody><tr><td>Veo 3.1</td><td>Video + Audio generation</td><td>Generate videos from a text prompt or reference image</td><td>Text/Image prompt</td><td>Video + Audio</td><td>720p</td><td>${price}</td></tr></tbody></table></div>`,
        },
        documents: [],
      }),
      onPricingReconciliation: (r) => findings.push(r),
    });
    return { target: result.models[0], findings };
  }
  it("does not turn an input Text/Image label into a per-image denominator", () => {
    const { target, findings } = parse("$0.40 / 1 count");
    expect(target?.price_facts).toEqual([]);
    expect(target?.raw_price_facts).toContainEqual(
      expect.objectContaining({
        reason: "unknown_unit",
        raw: expect.objectContaining({
          amount: "0.40",
          meter: "video_generation",
          unit: "$0.40 / 1 count",
        }),
      }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ disposition: "raw", reason_code: "pricing_unknown_unit" }),
    );
  });
  it("uses the price header's explicit second denominator", () => {
    const { target } = parse("$0.40", "Price per second");
    expect(target?.price_facts).toContainEqual(
      expect.objectContaining({ meter: "video_generation", price: "0.40", unit: "second" }),
    );
  });
  it("keeps an explicit cell denominator ahead of its column header", () => {
    const { target } = parse("$0.40 / second", "Price per image");
    expect(target?.price_facts).toContainEqual(
      expect.objectContaining({ meter: "video_generation", unit: "second" }),
    );
  });
  it("does not replace an unexplained count denominator with the column's unit", () => {
    const { target } = parse("$0.40 / 1 count", "Price per second");
    expect(target?.price_facts).toEqual([]);
    expect(target?.raw_price_facts).toContainEqual(
      expect.objectContaining({ reason: "unknown_unit" }),
    );
  });
});
