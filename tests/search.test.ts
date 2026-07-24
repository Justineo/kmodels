import { describe, expect, it } from "vite-plus/test";
import { indexModels, searchModels } from "../src/catalog/search.ts";

const gpt41Mini = { model_id: "gpt-4.1-mini", name: "GPT-4.1 mini" };
const gpt4oMini = { model_id: "gpt-4o-mini", name: "GPT-4o mini" };
const claudeSonnet = { model_id: "claude-sonnet-4-5", name: "Claude 4.5 Sonnet" };
const geminiFlash = { model_id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" };
const models = [gpt41Mini, gpt4oMini, claudeSonnet, geminiFlash];
const index = indexModels(models);

describe("model search", () => {
  it("searches exact model IDs and display names", () => {
    expect(searchModels(index, "claude-sonnet-4-5")).toEqual([claudeSonnet]);
    expect(searchModels(index, "Claude 4.5 Sonnet")).toEqual([claudeSonnet]);
  });

  it("ignores separators when matching identifiers", () => {
    expect(searchModels(index, "gpt41mini")[0]).toBe(gpt41Mini);
  });

  it("uses bounded LCS matching for typo tolerance", () => {
    expect(searchModels(index, "claude 4.5 sonet")).toEqual([claudeSonnet]);
    expect(searchModels(index, "zzzz")).toEqual([]);
  });

  it("ranks exact matches above fuzzy alternatives", () => {
    expect(searchModels(index, "gpt41mini")[0]).toBe(gpt41Mini);
    expect(searchModels(index, "gpt41mini")).toContain(gpt4oMini);
  });

  it("does not treat punctuation as an empty search", () => {
    expect(searchModels(index, "---")).toEqual([]);
  });

  it("preserves catalog order without a query", () => {
    expect(searchModels(index, "   ")).toEqual(models);
  });
});
