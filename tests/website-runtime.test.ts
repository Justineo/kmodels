import { describe, expect, it } from "vite-plus/test";
import { parseWebsiteCatalog } from "../src/catalog/website-runtime.ts";

const catalog = {
  schema_version: 1,
  data_version: "1".repeat(64),
  generated_at: "2026-07-29T00:00:00.000Z",
  providers: [{ id: "test", name: "Test" }],
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

describe("website runtime catalog parser", () => {
  it("validates the minimal payload and derives browser-only fields", () => {
    expect(parseWebsiteCatalog(catalog).models[0]).toMatchObject({
      uid: "test/model@v1",
      detail_chunk: 2,
      pricing: {
        outcome: "unknown",
        status: { label: "Loading" },
      },
    });
  });

  it("rejects unknown fields and unresolved provider references", () => {
    expect(() => parseWebsiteCatalog({ ...catalog, audit: true })).toThrow(
      "unexpected field audit",
    );
    expect(() =>
      parseWebsiteCatalog({
        ...catalog,
        models: [{ ...catalog.models[0], provider_id: "missing" }],
      }),
    ).toThrow("unknown provider");
  });
});
