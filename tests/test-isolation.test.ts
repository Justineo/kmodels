import { execFileSync } from "node:child_process";
import { request } from "node:https";
import { describe, expect, it } from "vite-plus/test";
import { readPublishedAssetProfile } from "../src/catalog/published-assets.ts";

describe("test input isolation", () => {
  it("rejects an unmocked transport before it can contact a provider", () => {
    expect(() => fetch("https://example.invalid")).toThrow("Tests must mock network");
    expect(() => request("https://example.invalid")).toThrow("Tests must mock network");
    expect(() => execFileSync("kmodels-unmocked-transport")).toThrow("Tests must mock network");
  });

  it("rejects indirect reads of the default generated projection in unit tests", async () => {
    await expect(readPublishedAssetProfile("ui")).rejects.toThrow("Unit tests must use fixtures");
  });
});
