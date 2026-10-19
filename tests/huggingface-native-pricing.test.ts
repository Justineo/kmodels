import { readFile } from "node:fs/promises";
import { expect, it } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import { manifests } from "../src/catalog/manifests.ts";
import { baseModel } from "../src/catalog/model.ts";

const observedAt = "2026-10-19T00:00:00.000Z";
const manifest = manifests.find(({ provider }) => provider.id === "huggingface");
const configured = manifest?.sources.find(({ id }) => id === "huggingface-native-pricing");
if (manifest === undefined || configured?.extractor.kind !== "huggingface-native-pricing")
  throw new Error("Missing Hugging Face native pricing configuration");
const provider = { ...manifest.provider, source_ids: manifest.sources.map(({ id }) => id) };
const source = { ...configured, extractor: { ...configured.extractor, minModels: 0 } };
const fixture = (path: string) => readFile(new URL(`./fixtures/${path}`, import.meta.url), "utf8");

async function parse(
  routeProvider: string,
  providerModelId: string,
  edit: (url: string, body: string) => string = (_url, body) => body,
) {
  const model = {
    ...baseModel({
      providerId: provider.id,
      id: "deepseek-ai/DeepSeek-V4-Pro-0813",
      name: "DeepSeek V4 Pro",
      sourceId: "huggingface-hf-inference",
      observedAt,
    }),
    routes: [
      {
        provider: routeProvider,
        provider_model_id: providerModelId,
        source_ref: "huggingface-hf-inference",
        task: "conversational",
        status: "live" as const,
      },
    ],
  };
  const files = [
    ["https://fireworks.ai/models?show=Image", "huggingface/native-fireworks.html"],
    ["https://docs.z.ai/guides/overview/pricing", "huggingface/native-zai.html"],
    [
      "https://console.groq.com/docs/model/openai/gpt-oss-safeguard-20b",
      "huggingface/native-groq.html",
    ],
    ["https://cohere.com/pricing", "cohere/pricing.html"],
    ["https://docs.cohere.com/docs/command-a", "huggingface/native-cohere-command-a.html"],
  ] as const;
  return parseSource({
    provider,
    source,
    observedAt,
    catalogModels: [model],
    body: JSON.stringify({
      index: { url: source.url, body: await fixture("huggingface/pricing.md") },
      documents: await Promise.all(
        files.map(async ([url, file]) => ({
          url,
          body: edit(url, await fixture(file)),
        })),
      ),
    }),
  }).models;
}

it("joins Fireworks prices by the native slug and never by a display-name lookalike", async () => {
  const exact = await parse("fireworks-ai", "accounts/fireworks/models/deepseek-v4-pro-0813");
  expect(exact[0]?.price_facts.map(({ price }) => price)).toEqual(["1.32", "3.96"]);
  expect(await parse("fireworks-ai", "accounts/fireworks/models/another-model")).toEqual([]);
});

it("uses Cohere's central quote before a conflicting model-card fallback", async () => {
  const central = `<script>self.__next_f.push(${JSON.stringify([
    1,
    "0:" +
      JSON.stringify([
        {
          modelName: "Command A",
          per: "1M tokens",
          pricings: [
            { inputLabel: "Input", inputPrice: 3, outputLabel: "Output", outputPrice: 12 },
          ],
        },
      ]),
  ])})</script>`;
  const rows = await parse("cohere", "command-a-03-2025", (url, body) =>
    url === "https://cohere.com/pricing" ? central : body,
  );
  expect(rows[0]?.price_facts.map(({ price }) => price)).toEqual(["3", "12"]);
});

it("does not scan unrecognized Cohere script text for a nearby product's prices", async () => {
  const rows = await parse("cohere", "command-r7b-12-2024", (url, body) =>
    url === "https://cohere.com/pricing"
      ? body.replace("self.__next_f.push", "self.__next_f.invalid")
      : body,
  );
  expect(rows).toEqual([]);
});

it("requires an explicit Groq token denominator instead of deriving it from a rounded ratio", async () => {
  expect((await parse("groq", "openai/gpt-oss-safeguard-20b"))[0]?.price_facts).toHaveLength(2);
  const rows = await parse("groq", "openai/gpt-oss-safeguard-20b", (url, body) =>
    url.includes("console.groq.com") ? body.replace("Prices per 1M tokens", "") : body,
  );
  expect(rows).toEqual([]);
});
