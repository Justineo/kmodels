import { readFile } from "node:fs/promises";
import { expect, it } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import { manifests } from "../src/catalog/manifests.ts";
import { reconcileCatalog } from "../src/catalog/validation.ts";

const manifest = manifests.find(({ provider }) => provider.id === "huggingface");
const source = manifest?.sources[0];
if (manifest === undefined || source === undefined) throw new Error("Missing HF Inference source");
const input = {
  provider: { ...manifest.provider, source_ids: [source.id] },
  source,
  observedAt: "2026-11-03T00:00:00.000Z",
};

it("publishes only live HF Inference mappings from the exhaustive Hub source", async () => {
  expect(manifest.sources).toEqual([
    expect.objectContaining({ role: "catalog", exhaustive: true }),
  ]);
  const body = await readFile(
    new URL("./fixtures/huggingface/hf-inference.json", import.meta.url),
    "utf8",
  );
  const result = parseSource({ ...input, body });
  expect(result.models.map(({ model_id }) => model_id)).toEqual([
    "org/model-1",
    "org/model-2",
    "org/model-3",
  ]);
  expect(result.models[0]).toMatchObject({
    status: "active",
    pricing_state: "unknown",
    updated_date: "2026-07-20",
    modalities: { input: ["text"], output: ["embedding"] },
    routes: ["feature-extraction", "future-task"].map((task) => ({
      source_ref: source.id,
      provider: "hf-inference",
      provider_model_id: "org/native-model",
      status: "live",
      task,
    })),
  });
  expect(result.models[1]?.updated_date).toBeUndefined();
  expect(result.models[1]?.routes).toHaveLength(1);
  // An unfamiliar task keeps its raw route without contributing a canonical task.
  expect(result.models[0]?.tasks).toEqual(["embeddings"]);
  expect(result.models[2]).toMatchObject({
    status: "active",
    updated_date: "2026-09-12",
    tasks: ["text_generation"],
    modalities: { input: ["text"], output: ["text"] },
  });
  expect(result.models[2]?.routes?.map(({ task }) => task)).toEqual([
    "fill-mask",
    "future-task",
    "question-answering",
    "table-question-answering",
  ]);
  const [first, omitted] = result.models;
  if (first === undefined || omitted === undefined) throw new Error("Missing fixture models");
  const reconciled = reconcileCatalog([first], [first, omitted], {
    catalog: new Set([source.id]),
    exhaustive: new Set([source.id]),
    recomputed: new Set([source.id]),
  });
  expect(reconciled.map(({ model_id }) => model_id)).toEqual(["org/model-1"]);
});

it("fails a snapshot without positive mapping evidence", () => {
  const body = JSON.stringify({ models: [{ id: "org/hub-only", inferenceProviderMapping: [] }] });
  expect(() => parseSource({ ...input, body })).toThrow("Hugging Face live HF Inference models");
});
