import { describe, expect, it } from "vite-plus/test";
import { parseWebsiteCatalog } from "../src/catalog/website-runtime.ts";

const catalog = {
  schema_version: 2,
  data_version: "1".repeat(64),
  generated_at: "2026-07-29T00:00:00.000Z",
  providers: [
    {
      id: "test",
      name: "Test",
      pricing_coverage: {
        models: 1,
        representative_models: 1,
        offer_models: 1,
        unknown_models: 0,
        not_applicable_models: 0,
        standalone_resources: 0,
        detail_chunks: 0,
      },
    },
  ],
  models: [
    {
      provider_id: "test",
      model_id: "model",
      version: "v1",
      name: "Model",
      tasks: ["text_generation"],
      release_date: "2026-07",
      status: "active",
      release_stage: "stable",
      context_tokens: 128_000,
      detail_chunk: 2,
    },
  ],
};
const pricing = {
  schema_version: 1,
  data_version: catalog.data_version,
  pricing: [
    {
      outcome: "offers",
      input: {
        meter: "input",
        amount: "$1",
        displayUnit: "/ 1M tokens",
        accessibleText: "$1 per 1 million input tokens",
        showTooltip: false,
      },
    },
  ],
};

describe("website runtime catalog parser", () => {
  it("validates both core chunks and derives browser-only fields", () => {
    expect(parseWebsiteCatalog(catalog, pricing).models[0]).toMatchObject({
      uid: "test/model@v1",
      detail_chunk: 2,
      pricing: {
        outcome: "offers",
        input: {
          amount: "$1",
        },
      },
    });
  });

  it("rejects unknown fields and unresolved provider references", () => {
    expect(() => parseWebsiteCatalog({ ...catalog, audit: true }, pricing)).toThrow(
      "unexpected field audit",
    );
    expect(() =>
      parseWebsiteCatalog(
        {
          ...catalog,
          models: [{ ...catalog.models[0], provider_id: "missing" }],
        },
        pricing,
      ),
    ).toThrow("unknown provider");
  });

  it("rejects pricing that does not match the catalog", () => {
    expect(() =>
      parseWebsiteCatalog(catalog, {
        ...pricing,
        data_version: "2".repeat(64),
      }),
    ).toThrow("does not match");
  });
});
