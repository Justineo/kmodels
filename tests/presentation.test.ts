import { describe, expect, it } from "vite-plus/test";
import {
  formatRateUnit,
  formatTableRateLabel,
  formatTableRateUnit,
  perMillionTokenRate,
  representativeTableRate,
} from "../src/catalog/presentation.ts";
import {
  type ModelOperation,
  type PriceRate,
  type ProviderModel,
  unknownCapabilities,
} from "../src/catalog/schema.ts";
import { darkProviderSymbolId, providerSymbolId, spriteSymbols } from "../src/icons/sprite.ts";
import { svgSymbol } from "../src/icons/svg.ts";

function rate(
  price: string,
  unit: PriceRate["unit"],
  meter: PriceRate["meter"] = "input_text",
  conditions: PriceRate["conditions"] = {},
): PriceRate {
  return {
    meter,
    price,
    currency: "USD",
    unit,
    conditions,
    source_ref: "test",
    derived: false,
  };
}

function model(operations: ModelOperation[], pricing: PriceRate[]): ProviderModel {
  return {
    provider_id: "test",
    model_id: "model",
    uid: "test/model",
    id_kind: "api_id",
    name: "Model",
    aliases: [],
    operations,
    modalities: { input: [], output: [] },
    capabilities: unknownCapabilities(),
    limits: {},
    status: "active",
    release_stage: "stable",
    replacement_model_ids: [],
    pricing_status: pricing.length === 0 ? "unknown" : "published",
    pricing,
    scope: "global_catalog",
    account_availability: "unknown",
    first_seen_at: "2026-07-24T00:00:00.000Z",
    last_seen_at: "2026-07-24T00:00:00.000Z",
    observed_at: "2026-07-24T00:00:00.000Z",
    source_refs: ["test"],
  };
}

describe("rate presentation", () => {
  it("normalizes comparable token prices to one million tokens", () => {
    expect(perMillionTokenRate(rate("0.000002", "token"))).toMatchObject({
      price: "2",
      unit: "million_tokens",
    });
    expect(perMillionTokenRate(rate("0.003", "thousand_tokens"))).toMatchObject({
      price: "3",
      unit: "million_tokens",
    });
  });

  it("preserves rates that do not use a directly comparable token unit", () => {
    const value = rate("4", "million_characters");
    expect(perMillionTokenRate(value)).toBe(value);
  });

  it("uses compact, explicit unit labels", () => {
    expect(formatRateUnit(rate("2", "million_tokens"))).toBe("/1M tokens");
    expect(formatRateUnit(rate("4", "million_characters"))).toBe("/1M characters");
  });

  it("omits the table default while preserving exceptional units", () => {
    expect(formatTableRateUnit(rate("2", "million_tokens"))).toBe("");
    expect(formatTableRateUnit(rate("4", "million_characters"))).toBe("/1M chars");
    expect(formatTableRateUnit(rate("0.04", "image"))).toBe("/img");
    expect(formatTableRateUnit(rate("0.1", "second"))).toBe("/sec");
    expect(formatTableRateUnit(rate("2", "unit_hour"))).toBe("/unit·hr");
    expect(formatTableRateUnit(rate("4", "gpu_hour"))).toBe("/GPU·hr");
  });

  it("selects operation-aware representative request rates", () => {
    const image = model(
      ["text_generation", "image_generation"],
      [
        rate("5", "million_tokens", "input_text"),
        rate("40", "million_tokens", "output_image"),
        rate("0.04", "image", "image_generation", { resolution: "1024x1024" }),
      ],
    );
    expect(representativeTableRate(image, "input")?.meter).toBe("input_text");
    expect(representativeTableRate(image, "output")).toMatchObject({
      meter: "image_generation",
      unit: "image",
    });

    const embedding = model(
      ["embeddings"],
      [
        rate("0.13", "million_tokens", "embedding"),
        rate("2", "unit_hour", "provisioned_throughput"),
      ],
    );
    expect(representativeTableRate(embedding, "output")?.meter).toBe("embedding");

    const audio = model(["transcription"], [rate("0.6", "million_tokens", "input_audio")]);
    expect(representativeTableRate(audio, "input")?.meter).toBe("input_audio");
  });

  it("keeps full rate semantics accessible while compacting the cell", () => {
    expect(formatTableRateLabel(rate("0.04", "image", "image_generation"))).toBe(
      "image generation · $0.04 /image",
    );
  });

  it("falls back to published non-request rates before leaving a slot empty", () => {
    const capacity = model([], [rate("2", "unit_hour", "provisioned_throughput")]);
    expect(representativeTableRate(capacity, "output")).toMatchObject({
      meter: "provisioned_throughput",
      unit: "unit_hour",
      price: "2",
    });

    const cacheWrite = model([], [rate("1.25", "million_tokens", "cache_write_text")]);
    expect(representativeTableRate(cacheWrite, "cached")?.meter).toBe("cache_write_text");
    expect(representativeTableRate(model([], []), "output")).toBeUndefined();
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
