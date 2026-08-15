import { describe, expect, it } from "vite-plus/test";
import { parseWebsiteCatalog } from "../src/catalog/website-runtime.ts";

const catalog = {
  schema_version: 3,
  data_version: "1".repeat(64),
  generated_at: "2026-07-29T00:00:00.000Z",
  providers: [
    {
      id: "test",
      name: "Test",
      pricing_coverage: {
        representative_models: 1,
        offer_models: 1,
        unknown_models: 0,
        not_applicable_models: 0,
        standalone_resources: 0,
        detail_chunks: 0,
      },
    },
  ],
  models: [[0, "model", "v1", "Model", [0], "2026-07", 0, 0, 128_000, 2]],
};
const pricing = {
  schema_version: 3,
  data_version: catalog.data_version,
  statuses: [],
  cells: [["$1", "/ 1M tokens", "$1 per 1 million input tokens"]],
  pricing: [[2, null, 0, null, null]],
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
    expect(
      parseWebsiteCatalog(
        { ...catalog, models: [[0, "model", "v1", null, [0], "2026-07", 0, 0, 128_000, 2]] },
        pricing,
      ).models[0]?.name,
    ).toBe("model");
  });

  it("rejects unknown fields and unresolved provider references", () => {
    expect(() => parseWebsiteCatalog({ ...catalog, audit: true }, pricing)).toThrow(
      "unexpected field audit",
    );
    expect(() =>
      parseWebsiteCatalog(
        {
          ...catalog,
          models: [[1, "model", "v1", "Model", [0], "2026-07", 0, 0, 128_000, 2]],
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

  it("rejects malformed compact rows and missing dictionary entries", () => {
    expect(() => parseWebsiteCatalog({ ...catalog, models: [[0, "model"]] }, pricing)).toThrow(
      "10-item array",
    );
    expect(() =>
      parseWebsiteCatalog(catalog, {
        ...pricing,
        pricing: [[2, null, 1, null, null]],
      }),
    ).toThrow("does not exist");
    expect(() =>
      parseWebsiteCatalog(catalog, {
        ...pricing,
        cells: [["$1", "/ 1M tokens", "$1 per 1 million input tokens", 0]],
      }),
    ).toThrow("3-item array");
  });
});
