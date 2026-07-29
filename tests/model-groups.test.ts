import { describe, expect, it } from "vite-plus/test";
import { groupModels, modelGroupKey, modelTableRows } from "../src/catalog/model-groups.ts";

const models = [
  { provider_id: "azure", model_id: "gpt-4o", uid: "azure/gpt-4o@1" },
  { provider_id: "openai", model_id: "gpt-4o", uid: "openai/gpt-4o" },
  { provider_id: "azure", model_id: "gpt-4o", uid: "azure/gpt-4o@2" },
  { provider_id: "azure", model_id: "phi-4", uid: "azure/phi-4" },
];

describe("model groups", () => {
  it("groups exact provider and model IDs while preserving input order", () => {
    const groups = groupModels(models);
    expect(groups.map(({ provider_id, model_id }) => [provider_id, model_id])).toEqual([
      ["azure", "gpt-4o"],
      ["openai", "gpt-4o"],
      ["azure", "phi-4"],
    ]);
    expect(groups[0]?.models.map(({ uid }) => uid)).toEqual(["azure/gpt-4o@1", "azure/gpt-4o@2"]);
  });

  it("keeps a collapsed group to one row and inserts fixed child rows when expanded", () => {
    const groups = groupModels(models);
    expect(modelTableRows(groups, new Set()).map(({ kind }) => kind)).toEqual([
      "group",
      "model",
      "model",
    ]);

    const rows = modelTableRows(groups, new Set([modelGroupKey("azure", "gpt-4o")]));
    expect(rows.map(({ kind }) => kind)).toEqual(["group", "model", "model", "model", "model"]);
    expect(
      rows.filter((row) => row.kind === "model").map(({ model, nested }) => [model.uid, nested]),
    ).toEqual([
      ["azure/gpt-4o@1", true],
      ["azure/gpt-4o@2", true],
      ["openai/gpt-4o", false],
      ["azure/phi-4", false],
    ]);
  });
});
