import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { prepareCatalogPair } from "../src/catalog/pricing-publication.ts";
import type { PricingCatalog } from "../src/catalog/pricing-schema.ts";
import type { ProjectionPaths } from "../src/catalog/projection-paths.ts";
import { projectCatalogPair } from "../src/catalog/projections.ts";
import {
  materializePublishedAssets,
  readCompressedProfileAsset,
  readPublishedAssetProfile,
  readPublishedAssets,
} from "../src/catalog/published-assets.ts";
import type { Catalog } from "../src/catalog/schema.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

const catalog: Catalog = {
  catalog_version: "1".repeat(64),
  generated_at: "2026-07-30T00:00:00.000Z",
  providers: [],
  models: [],
  sources: [],
  coverage: [],
  warnings: [],
};
const pricing: PricingCatalog = {
  provider_vocabularies: [],
  provider_snapshots: [],
  model_dispositions: [],
  books: [],
};

async function projectionPaths(): Promise<ProjectionPaths> {
  const directory = await mkdtemp(join(tmpdir(), "kmodels-projections-"));
  directories.push(directory);
  return {
    uiManifest: join(directory, "website-assets.json"),
    uiPack: join(directory, "website-assets.pack"),
    exportManifest: join(directory, "export-assets.json"),
    exportPack: join(directory, "export-assets.pack"),
  };
}

describe("published projection assets", () => {
  it("loads the UI profile without touching unavailable export assets", async () => {
    const paths = await projectionPaths();
    const candidate = prepareCatalogPair(catalog, pricing);
    const projections = projectCatalogPair(candidate);
    const repeated = projectCatalogPair(candidate);
    expect(repeated.ui.manifestSource).toBe(projections.ui.manifestSource);
    expect(repeated.ui.pack).toEqual(projections.ui.pack);
    expect(repeated.exports.manifestSource).toBe(projections.exports.manifestSource);
    expect(repeated.exports.pack).toEqual(projections.exports.pack);
    await Promise.all([
      writeFile(paths.uiManifest, projections.ui.manifestSource),
      writeFile(paths.uiPack, projections.ui.pack),
    ]);

    const ui = await readPublishedAssetProfile("ui", paths);
    expect(ui.manifest.profile).toBe("ui");
    expect(readCompressedProfileAsset(ui, "/ui/catalog/index.json")?.byteLength).toBeGreaterThan(0);
  });

  it("validates and stream-materializes both profiles without canonical inputs", async () => {
    const paths = await projectionPaths();
    const candidate = prepareCatalogPair(catalog, pricing);
    const projections = projectCatalogPair(candidate);
    await Promise.all([
      writeFile(paths.uiManifest, projections.ui.manifestSource),
      writeFile(paths.uiPack, projections.ui.pack),
      writeFile(paths.exportManifest, projections.exports.manifestSource),
      writeFile(paths.exportPack, projections.exports.pack),
    ]);

    const published = await readPublishedAssets(paths);
    const output = join(dirname(paths.uiManifest), "dist");
    await materializePublishedAssets(published, output);

    expect(published.exports.manifest.pair_id).toBe(candidate.pairId);
    expect(await readFile(join(output, "catalog/index.json"), "utf8")).toBe(
      candidate.catalogAssetSource,
    );
    expect(await readFile(join(output, "pricing/index.json"), "utf8")).toBe(
      candidate.pricingAssetSource,
    );
    expect(JSON.parse(await readFile(join(output, "ui/catalog/index.json"), "utf8"))).toMatchObject(
      {
        data_version: projections.ui.manifest.data_version,
      },
    );
  });

  it("rejects a corrupted compressed profile before serving it", async () => {
    const paths = await projectionPaths();
    const projections = projectCatalogPair(prepareCatalogPair(catalog, pricing));
    const corrupted = projections.ui.pack.slice();
    corrupted[0] = (corrupted[0] ?? 0) ^ 0xff;
    await Promise.all([
      writeFile(paths.uiManifest, projections.ui.manifestSource),
      writeFile(paths.uiPack, corrupted),
    ]);

    await expect(readPublishedAssetProfile("ui", paths)).rejects.toThrow(
      "does not match its encoded hash",
    );
  });

  it("rejects a decoded source that does not match its manifest", async () => {
    const paths = await projectionPaths();
    const projections = projectCatalogPair(prepareCatalogPair(catalog, pricing));
    const uiManifest = {
      ...projections.ui.manifest,
      assets: projections.ui.manifest.assets.map((entry, index) =>
        index === 0 ? { ...entry, source_sha256: "0".repeat(64) } : entry,
      ),
    };
    await Promise.all([
      writeFile(paths.uiManifest, JSON.stringify(uiManifest)),
      writeFile(paths.uiPack, projections.ui.pack),
      writeFile(paths.exportManifest, projections.exports.manifestSource),
      writeFile(paths.exportPack, projections.exports.pack),
    ]);
    const published = await readPublishedAssets(paths);

    await expect(
      materializePublishedAssets(published, join(dirname(paths.uiManifest), "dist")),
    ).rejects.toThrow("does not match its decoded hash");
  });
});
