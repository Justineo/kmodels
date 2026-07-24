import { describe, expect, it } from "vite-plus/test";
import { baseModel } from "../src/catalog/model.ts";
import { catalogSchema, type Catalog, type ProviderModel } from "../src/catalog/schema.ts";
import { summarizeRefresh } from "../src/catalog/summary.ts";

const previousAt = "2026-07-23T00:00:00.000Z";
const currentAt = "2026-07-24T00:00:00.000Z";

function catalog(
  version: string,
  generatedAt: string,
  models: ProviderModel[],
  sourceHash: string,
): Catalog {
  return catalogSchema.parse({
    catalog_version: version.repeat(64),
    generated_at: generatedAt,
    providers: [
      {
        id: "test",
        name: "Test",
        kind: "hosted",
        homepage: "https://example.com",
        catalog_scope: "global",
        source_ids: ["test-catalog"],
        last_successful_sync_at: generatedAt,
        catalog_version: version.repeat(64),
      },
    ],
    models,
    sources: [
      {
        id: "test-catalog",
        provider_id: "test",
        url: "https://example.com/models",
        source: ["api"],
        stability: "documented",
        scope: "global",
        exhaustive: true,
        role: "catalog",
        field_paths: ["model_id", "name"],
        observed_at: generatedAt,
        content_hash: sourceHash.repeat(64),
        extractor_version: "test-v1",
      },
    ],
    coverage: [
      {
        provider_id: "test",
        status: "fresh",
        model_count: models.length,
        price_rate_count: 0,
        checked_at: generatedAt,
        last_successful_sync_at: generatedAt,
      },
    ],
    warnings: [],
  });
}

describe("collection state", () => {
  it("summarizes semantic changes without counting observation timestamps", () => {
    const previousModel = baseModel({
      providerId: "test",
      id: "model",
      name: "Model",
      sourceId: "test-catalog",
      observedAt: previousAt,
    });
    const unchangedModel = {
      ...previousModel,
      last_seen_at: currentAt,
      observed_at: currentAt,
    };
    const previous = catalog("a", previousAt, [previousModel], "b");
    const unchanged = summarizeRefresh(previous, catalog("c", currentAt, [unchangedModel], "b"));
    expect(unchanged.providers[0]?.models).toMatchObject({
      added: 0,
      removed: 0,
      changed: 0,
      unchanged: 1,
      changed_fields: {},
    });

    const changedModel = { ...unchangedModel, name: "Renamed model" };
    const addedModel = baseModel({
      providerId: "test",
      id: "new-model",
      name: "New model",
      sourceId: "test-catalog",
      observedAt: currentAt,
    });
    const changed = summarizeRefresh(
      previous,
      catalog("d", currentAt, [changedModel, addedModel], "e"),
    );
    expect(changed.providers[0]).toMatchObject({
      models: {
        previous: 1,
        current: 2,
        added: 1,
        removed: 0,
        changed: 1,
        unchanged: 0,
        changed_fields: { name: 1 },
      },
      sources: {
        previous: 1,
        current: 1,
        added: 0,
        removed: 0,
        changed: 1,
        unchanged: 0,
      },
    });
  });
});
