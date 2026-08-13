import { describe, expect, it } from "vite-plus/test";
import {
  formatModelTask,
  formatTableTask,
  versionBadgeModelUids,
} from "../src/catalog/presentation.ts";
import { type ModelTask, type ProviderModel, unknownCapabilities } from "../src/catalog/schema.ts";
import { darkProviderSymbolId, providerSymbolId } from "../src/icons/manifest.ts";
import { spriteSymbols } from "../src/icons/sprite.ts";
import { svgSymbol } from "../src/icons/svg.ts";

function model(tasks: ModelTask[]): ProviderModel {
  return {
    provider_id: "test",
    model_id: "model",
    uid: "test/model",
    id_kind: "api_id",
    name: "Model",
    aliases: [],
    tasks,
    modalities: { input: [], output: [] },
    capabilities: unknownCapabilities(),
    limits: {},
    status: "active",
    release_stage: "stable",
    replacement_model_ids: [],
    scope: "global_catalog",
    account_availability: "unknown",
    first_seen_at: "2026-07-24T00:00:00.000Z",
    last_seen_at: "2026-07-24T00:00:00.000Z",
    observed_at: "2026-07-24T00:00:00.000Z",
    source_refs: ["test"],
  };
}

describe("task presentation", () => {
  it.each([
    ["text_generation", "Text generation", "Text"],
    ["image_generation", "Image generation", "Image"],
    ["video_generation", "Video generation", "Video"],
    ["audio_generation", "Audio generation", "Audio"],
    ["speech_synthesis", "Text to speech", "TTS"],
    ["transcription", "Transcription", "STT"],
    ["speech_to_speech", "Speech to speech", "S2S"],
    ["embeddings", "Embeddings", "Embed"],
    ["reranking", "Reranking", "Rerank"],
    ["moderation", "Moderation", "Moderate"],
    ["classification", "Classification", "Classify"],
    ["translation", "Translation", "Translate"],
    ["ocr", "OCR", "OCR"],
    ["object_detection", "Object detection", "Detect"],
    ["segmentation", "Segmentation", "Segment"],
  ] satisfies [ModelTask, string, string][])(
    "keeps %s exact outside the compact table",
    (task, full, compact) => {
      expect(formatModelTask(task)).toBe(full);
      expect(formatTableTask(task)).toBe(compact);
    },
  );
});

describe("version presentation", () => {
  it("shows version badges only when a provider model ID needs disambiguation", () => {
    const base = model([]);
    const values: ProviderModel[] = [
      { ...base, uid: "azure/model@1", provider_id: "azure", version: "1" },
      { ...base, uid: "azure/model@2", provider_id: "azure", version: "2" },
      { ...base, uid: "azure/model", provider_id: "azure" },
      { ...base, uid: "openai/model", provider_id: "openai", version: "2026-01-01" },
      {
        ...base,
        uid: "azure/other@1",
        provider_id: "azure",
        model_id: "other",
        version: "1",
      },
    ];

    expect([...versionBadgeModelUids(values)].sort()).toEqual([
      "azure/model",
      "azure/model@1",
      "azure/model@2",
    ]);
  });
});

describe("SVG sprite", () => {
  it("preserves presentation attributes and scopes definition references", () => {
    const symbol = svgSymbol(
      "provider-test",
      '<svg viewBox="0 0 24 24" fill="currentColor"><defs><linearGradient id="paint"></linearGradient></defs><path fill="url(#paint)"></path></svg>',
    );

    expect(symbol).toContain('<symbol id="provider-test" viewBox="0 0 24 24" fill="currentColor">');
    expect(symbol).toContain('id="provider-test-paint"');
    expect(symbol).toContain('fill="url(#provider-test-paint)"');
  });

  it("registers the direct LobeHub Kimi assets for light and dark themes", () => {
    expect(providerSymbolId("kimi")).toBe("provider-kimi");
    expect(darkProviderSymbolId("kimi")).toBe("provider-kimi-dark");
    expect(spriteSymbols).toContain('<symbol id="provider-kimi"');
    expect(spriteSymbols).toContain('<symbol id="provider-kimi-dark"');
    expect(spriteSymbols).toContain('fill="#1783FF"');
  });
});
