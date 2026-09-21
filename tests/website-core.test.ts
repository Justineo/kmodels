import { describe, expect, it } from "vite-plus/test";
import type { AssetSource } from "../src/catalog/asset-pack.ts";
import { WEBSITE_CORE_CHUNK_MAX_BYTES, websiteCoreAssets } from "../src/catalog/website-core.ts";
import { loadWebsiteCatalog, parseWebsiteCatalog } from "../src/catalog/website-runtime.ts";
import type {
  WebsiteCatalogIndex,
  WebsitePricingSummaries,
} from "../src/catalog/website-schema.ts";

function input(count: number) {
  const catalog: WebsiteCatalogIndex = {
    schema_version: 4,
    data_version: "1".repeat(64),
    generated_at: "2026-09-21T00:00:00Z",
    providers: [
      {
        id: "test",
        name: "Test",
        pricing_coverage: {
          representative_models: count,
          offer_models: count,
          unknown_models: 0,
          not_applicable_models: 0,
          standalone_resources: 0,
          detail_chunks: 1,
        },
      },
    ],
    models: Array.from({ length: count }, (_, index) => [
      0,
      `model-${index}`,
      null,
      "模型".repeat(50),
      [0],
      null,
      0,
      0,
      null,
      null,
      [],
    ]),
  };
  const pricing: WebsitePricingSummaries = {
    schema_version: 3,
    data_version: catalog.data_version,
    statuses: [["Unknown", "No representative rate"]],
    cells: [
      ["$1", "/ token", "$1 per token"],
      ["$2", "/ token", "$2 per token"],
    ],
    pricing: Array.from({ length: count }, (_, index) =>
      index % 3 === 0 ? [1, 0, null, null, null] : [2, null, index % 2, null, (index + 1) % 2],
    ),
  };
  return { catalog, pricing };
}

function reader(assets: AssetSource[]) {
  return async (path: string): Promise<unknown> => {
    const asset = assets.find(({ fileName }) => `/${fileName}` === path);
    if (asset === undefined) throw new Error(`Missing asset ${path}`);
    return JSON.parse(asset.source);
  };
}

describe("website core chunks", () => {
  it("splits growing UTF-8 data without losing order, prices or local dictionary references", async () => {
    const { catalog, pricing } = input(1_500);
    const assets = websiteCoreAssets(catalog, pricing);
    expect(assets.length).toBeGreaterThan(3);
    expect(assets.reduce((sum, { source }) => sum + Buffer.byteLength(source), 0)).toBeGreaterThan(
      320 * 1024,
    );
    for (const { source } of assets)
      expect(Buffer.byteLength(source)).toBeLessThanOrEqual(WEBSITE_CORE_CHUNK_MAX_BYTES);
    expect(websiteCoreAssets(catalog, pricing)).toEqual(assets);
    expect(await loadWebsiteCatalog(reader(assets))).toEqual(parseWebsiteCatalog(catalog, pricing));
  });

  it("accepts the exact byte ceiling and rejects an indivisible oversized row", () => {
    const { catalog, pricing } = input(1);
    const row = catalog.models[0];
    const asset = websiteCoreAssets(catalog, pricing)[1];
    if (row === undefined || asset === undefined) throw new Error("Missing sample row");
    row[3] = "x".repeat(
      WEBSITE_CORE_CHUNK_MAX_BYTES -
        Buffer.byteLength(asset.source) +
        Buffer.byteLength(row[3] ?? ""),
    );
    expect(Buffer.byteLength(websiteCoreAssets(catalog, pricing)[1]?.source ?? "")).toBe(
      WEBSITE_CORE_CHUNK_MAX_BYTES,
    );
    row[3] += "x";
    expect(() => websiteCoreAssets(catalog, pricing)).toThrow("row exceeds");
  });

  it("supports an empty catalog without requesting chunks", async () => {
    const { catalog, pricing } = input(0);
    const assets = websiteCoreAssets(catalog, pricing);
    expect(assets).toHaveLength(1);
    expect(await loadWebsiteCatalog(reader(assets))).toEqual(parseWebsiteCatalog(catalog, pricing));
  });

  it("bounds concurrency and preserves order when requests finish out of order", async () => {
    const { catalog, pricing } = input(2_500);
    const assets = websiteCoreAssets(catalog, pricing);
    const read = reader(assets);
    const pending = new Map<string, () => void>();
    let active = 0;
    let peak = 0;
    const loading = loadWebsiteCatalog(async (path) => {
      if (!path.includes("/chunks/")) return read(path);
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => pending.set(path, resolve));
      active -= 1;
      return read(path);
    });
    let complete = false;
    void loading.finally(() => {
      complete = true;
    });
    while (!complete) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      for (const [path, resolve] of [...pending].reverse()) {
        pending.delete(path);
        resolve();
      }
    }
    expect(peak).toBe(4);
    expect(await loading).toEqual(parseWebsiteCatalog(catalog, pricing));
  });

  it.each([
    { schema_version: 2 },
    { data_version: "2".repeat(64) },
    { chunk: 1 },
    { models: [] },
    { audit: true },
  ])("rejects a chunk inconsistent with its manifest: %j", async (change) => {
    const { catalog, pricing } = input(2);
    const assets = websiteCoreAssets(catalog, pricing);
    const read = reader(assets);
    await expect(
      loadWebsiteCatalog(async (path) => {
        const value = await read(path);
        if (!path.includes("/chunks/")) return value;
        if (value === null || typeof value !== "object") throw new Error("Invalid fixture");
        return { ...value, ...change };
      }),
    ).rejects.toThrow();
  });

  it("rejects missing chunks and pricing rows", async () => {
    const { catalog, pricing } = input(2);
    const assets = websiteCoreAssets(catalog, pricing);
    await expect(loadWebsiteCatalog(reader(assets.slice(0, 1)))).rejects.toThrow("Missing asset");
    pricing.pricing.pop();
    expect(() => websiteCoreAssets(catalog, pricing)).toThrow("do not match");
  });
});
