import { readFile } from "node:fs/promises";
import { expect, it } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import { normalizeOllamaModelPage } from "../src/catalog/fetch.ts";
import { manifests } from "../src/catalog/manifests.ts";
import { assembleParsedProviderPricing } from "../src/catalog/pricing-adapter.ts";

const manifest = manifests.find(({ provider }) => provider.id === "ollama");
if (!manifest) throw Error("Missing Ollama");
const provider = { ...manifest.provider, source_ids: manifest.sources.map(({ id }) => id) };
const observedAt = "2026-11-15T00:00:00.000Z";
const fixture = (file: string) =>
  readFile(new URL(`./fixtures/ollama/${file}`, import.meta.url), "utf8");
function source(kind: "ollama-library" | "ollama-cloud") {
  const configured = manifest?.sources.find(({ extractor }) => extractor.kind === kind);
  if (!configured) throw Error("Missing source");
  return { ...configured, extractor: { kind, minModels: 1, maxModels: 30 } };
}

it("reads the current first-party speech assertion without treating any audio mention as speech output", async () => {
  const card = await fixture("phonon-current.txt");
  for (const owned of [true, false]) {
    const [model] = parseSource({
      provider,
      source: source("ollama-library"),
      observedAt,
      body: owned ? card : card.replace("Phonon is Gradium’s", "Use Phonon with Gradium’s"),
    }).models;
    expect(model?.tasks).toEqual([owned ? "speech_synthesis" : "text_generation"]);
    expect(model?.modalities).toEqual({ input: ["text"], output: [owned ? "audio" : "text"] });
    expect(model?.price_facts).toEqual([]);
  }
});

it.each(["owned", "foreign", "outside-section"])(
  "scopes the relocated Cloud lifecycle table (%s)",
  async (witness) => {
    const body = await fixture("lifecycle-current.txt");
    const result = parseSource({
      provider,
      source: source("ollama-cloud"),
      observedAt,
      body: JSON.stringify({
        list: { models: [{ model: "qwen3.5:397b" }, { model: "glm-5.3" }] },
        documents: [
          {
            url:
              witness === "foreign"
                ? "https://example.test/cloud/model-lifecycle.md"
                : "https://docs.ollama.com/cloud/model-lifecycle.md",
            body:
              witness === "outside-section"
                ? body.replace("## Past retirements", "## Examples")
                : body,
          },
        ],
      }),
    });
    const retired = witness === "owned";
    expect(result.models.find(({ model_id }) => model_id === "qwen3.5:397b")).toMatchObject({
      status: retired ? "retired" : "active",
      ...(retired ? { retired_at: "2026-09-25", replacement_model_ids: ["glm-5.3"] } : {}),
    });
    expect(result.inference_prices?.some(({ model_id }) => model_id === "qwen3.5:397b")).toBe(
      !retired,
    );
    expect(result.inference_prices?.some(({ model_id }) => model_id === "glm-5.3")).toBe(true);
  },
);

it.each(["owned", "local-only", "wrong-type", "duplicate-field"])(
  "binds input-only Decision billing to its owned System One response (%s)",
  async (witness) => {
    const schema = await fixture("systemone-current.txt");
    const body =
      witness === "local-only"
        ? schema.replace("https://ollama.com", "https://example.test")
        : witness === "wrong-type"
          ? schema.replace(
              "input_tokens:\n              type: integer",
              "input_tokens:\n              type: string",
            )
          : witness === "duplicate-field"
            ? schema.replace(
                "            input_tokens:\n",
                "            input_tokens:\n              type: integer\n            input_tokens:\n",
              )
            : schema;
    const cloud = source("ollama-cloud");
    const parsed = parseSource({
      provider,
      source: cloud,
      observedAt,
      body: JSON.stringify({
        list: { models: [{ model: "clef" }] },
        details: [{ model: "clef", status: 200, body: { capabilities: ["decision"] } }],
        pages: [
          {
            model: "clef",
            url: "https://ollama.com/library/clef",
            body: JSON.parse(normalizeOllamaModelPage("clef", await fixture("clef-billing.html"))),
          },
        ],
        documents: [
          { url: "https://docs.ollama.com/openapi.yaml", body },
          { url: "https://ollama.com/pricing", body: await fixture("pricing.html") },
        ],
      }),
    });
    expect(parsed.pricing_inputs?.some(({ key }) => key === "systemone.input_tokens")).toBe(
      witness === "owned",
    );
    const partition = assembleParsedProviderPricing(
      "ollama",
      observedAt,
      [{ source: cloud, ...parsed }],
      parsed.models,
    );
    const term = partition?.books
      .flatMap(({ offers }) => offers.flatMap(({ terms }) => terms))
      .find((term) => term.kind === "rate" && term.meter.value === "input_text");
    if (term?.kind !== "rate") throw Error("Missing independent input price");
    const bindings = term.variants.map(({ charge_binding }) => charge_binding);
    expect(bindings.map((binding) => binding?.signal.value)).toEqual(["input_tokens"]);
    expect(
      bindings.flatMap(
        (binding) =>
          binding?.quantity_methods?.flatMap(
            ({ input_sources }) => input_sources?.map(({ locator }) => locator.value) ?? [],
          ) ?? [],
      ),
    ).toEqual(witness === "owned" ? ["/usage/input_tokens"] : []);
  },
);
