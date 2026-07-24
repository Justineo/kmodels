import { describe, expect, it } from "vite-plus/test";
import { normalizeDeliveryModes } from "../src/catalog/delivery.ts";
import { baseModel } from "../src/catalog/model.ts";
import { migrateCatalogStorage, unknownCapabilities } from "../src/catalog/schema.ts";
import { normalizeModelTasks } from "../src/catalog/task.ts";

function model() {
  return baseModel({
    providerId: "test",
    id: "model",
    name: "Model",
    sourceId: "test-source",
    observedAt: "2026-07-24T00:00:00.000Z",
  });
}

describe("task taxonomy", () => {
  it("retains a provider type beside every canonical task it establishes", () => {
    const normalized = normalizeModelTasks({
      ...model(),
      tasks: ["reranking", "classification"],
      raw_type: "text classification (rerank)",
    });

    expect(normalized.task_evidence).toEqual([
      {
        task: "reranking",
        source_ref: "test-source",
        namespace: "test.type",
        raw_value: "text classification (rerank)",
        kind: "provider_type",
      },
      {
        task: "classification",
        source_ref: "test-source",
        namespace: "test.type",
        raw_value: "text classification (rerank)",
        kind: "provider_type",
      },
    ]);
  });

  it("retains a recognized raw provider task from route evidence", () => {
    const normalized = normalizeModelTasks({
      ...model(),
      tasks: ["transcription"],
      routes: [
        {
          source_ref: "test-source",
          provider: "hf-inference",
          provider_model_id: "model",
          task: "automatic-speech-recognition",
          status: "live",
        },
      ],
    });

    expect(normalized.task_evidence).toEqual([
      {
        task: "transcription",
        source_ref: "test-source",
        namespace: "test.task",
        raw_value: "automatic-speech-recognition",
        kind: "provider_task",
      },
    ]);
  });

  it("migrates the former operations field at the storage boundary", () => {
    expect(
      migrateCatalogStorage({
        sources: [{ id: "source", field_paths: ["model_id", "operations"] }],
        models: [{ model_id: "model", operations: ["text_generation"] }],
      }),
    ).toEqual({
      sources: [{ id: "source", field_paths: ["model_id", "tasks"] }],
      models: [{ model_id: "model", tasks: ["text_generation"] }],
    });
  });
});

describe("delivery taxonomy", () => {
  it("projects capabilities and exact endpoint evidence into delivery modes", () => {
    const normalized = normalizeDeliveryModes({
      ...model(),
      tasks: ["speech_to_speech"],
      capabilities: {
        ...unknownCapabilities(),
        streaming: true,
        batch: true,
      },
      api_endpoints: [
        { name: "Realtime", path: "v1/realtime" },
        { name: "predictLongRunning", path: "models/predictLongRunning" },
      ],
    });

    expect(normalized.delivery_modes).toEqual(["streaming", "realtime", "batch", "async"]);
    expect(normalized.delivery_mode_evidence).toEqual([
      {
        mode: "realtime",
        source_ref: "test-source",
        namespace: "test.endpoint",
        raw_value: "Realtime",
        kind: "endpoint",
      },
      {
        mode: "async",
        source_ref: "test-source",
        namespace: "test.endpoint",
        raw_value: "predictLongRunning",
        kind: "endpoint",
      },
    ]);
  });
});
