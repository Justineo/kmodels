import { describe, expect, it } from "vite-plus/test";
import { baseModel } from "../src/catalog/model.ts";
import { websiteModelDetail } from "../src/catalog/website-data.ts";

describe("website data projection", () => {
  it("projects a retained provider failure without audit details", () => {
    const verifiedAt = "2026-07-27T00:00:00.000Z";
    const attemptedAt = "2026-07-28T00:00:00.000Z";
    const detail = websiteModelDetail(
      {
        provider_vocabularies: [],
        provider_snapshots: [
          {
            provider_id: "test",
            observed_at: verifiedAt,
            publication: "retained",
            refresh_failure: {
              attempted_at: attemptedAt,
              code: "source_schema_changed",
            },
          },
        ],
        model_dispositions: [],
        books: [],
      },
      baseModel({
        providerId: "test",
        id: "model",
        name: "Model",
        sourceId: "test-catalog",
        observedAt: attemptedAt,
      }),
    );

    expect(detail.pricing).toMatchObject({
      snapshot: {
        observed_at: verifiedAt,
        publication: "retained",
        refresh_failure: {
          attempted_at: attemptedAt,
          message: "A required public pricing source no longer matched its reviewed format.",
        },
      },
      offers: [],
    });
  });
});
