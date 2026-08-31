import { describe, expect, it } from "vite-plus/test";
import { indexModels, searchModels } from "../src/catalog/search.ts";

const gpt41Mini = { model_id: "gpt-4.1-mini", name: "GPT-4.1 mini", aliases: [] };
const gpt4oMini = { model_id: "gpt-4o-mini", name: "GPT-4o mini", aliases: [] };
const claudeSonnet = {
  model_id: "claude-sonnet-4-5",
  name: "Claude 4.5 Sonnet",
  aliases: ["global.anthropic.claude-sonnet-4-5-20250929-v1:0"],
};
const geminiFlash = { model_id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", aliases: [] };
const models = [gpt41Mini, gpt4oMini, claudeSonnet, geminiFlash];
const index = indexModels(models);

describe("model search", () => {
  it("searches exact model IDs and display names", () => {
    expect(searchModels(index, "claude-sonnet-4-5")).toEqual([claudeSonnet]);
    expect(searchModels(index, "Claude 4.5 Sonnet")).toEqual([claudeSonnet]);
  });

  it("searches provider-published aliases", () => {
    expect(searchModels(index, "global.anthropic.claude-sonnet-4-5-20250929-v1:0")).toEqual([
      claudeSonnet,
    ]);
  });

  it("ignores case, spaces, and hyphens", () => {
    expect(searchModels(index, "GPT 4.1 MINI")).toEqual([gpt41Mini]);
    expect(searchModels(index, "claude sonnet 4 5")).toEqual([claudeSonnet]);
  });

  it("requires a contiguous normalized substring", () => {
    expect(searchModels(index, "sonnet45")).toEqual([claudeSonnet]);
    expect(searchModels(index, "claude 4.5 sonet")).toEqual([]);
    expect(searchModels(index, "zzzz")).toEqual([]);
  });

  it("preserves catalog order for matches", () => {
    expect(searchModels(index, "gpt")).toEqual([gpt41Mini, gpt4oMini]);
  });

  it("does not treat punctuation as an empty search", () => {
    expect(searchModels(index, "---")).toEqual([]);
  });

  it("preserves catalog order without a query", () => {
    expect(searchModels(index, "   ")).toEqual(models);
  });
});
