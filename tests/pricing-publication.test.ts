import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { decodeAssetPackManifest, validateAssetPack } from "../src/catalog/asset-pack.ts";
import {
  commitCatalogPair,
  prepareCatalogPair,
  prepareCatalogPairInParallel,
  readCatalogPairMirrors,
  recoverCatalogPair,
  type CatalogPairPaths,
} from "../src/catalog/pricing-publication.ts";
import type { PricingCatalog } from "../src/catalog/pricing-schema.ts";
import type { ProjectionPaths } from "../src/catalog/projection-paths.ts";
import { catalogSchema, type Catalog } from "../src/catalog/schema.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

function catalog(warnings: Catalog["warnings"] = []): Catalog {
  return {
    catalog_version: "1".repeat(64),
    generated_at: "2026-07-28T00:00:00.000Z",
    providers: [],
    models: [],
    sources: [],
    coverage: [],
    warnings,
  };
}

const pricing: PricingCatalog = {
  provider_vocabularies: [],
  provider_snapshots: [],
  model_dispositions: [],
  books: [],
};

async function paths(): Promise<CatalogPairPaths> {
  const directory = await mkdtemp(join(tmpdir(), "kmodels-pair-"));
  directories.push(directory);
  return {
    stateDirectory: join(directory, "state"),
    catalogMirror: join(directory, "catalog.json"),
    pricingMirrorGzip: join(directory, "pricing.json.gz"),
    projections: {
      uiManifest: join(directory, "website-assets.json"),
      uiPack: join(directory, "website-assets.pack"),
      exportManifest: join(directory, "export-assets.json"),
      exportPack: join(directory, "export-assets.pack"),
    },
  };
}

async function pricingMirrorSource(path: string): Promise<string> {
  return gunzipSync(await readFile(path)).toString("utf8");
}

async function expectProjectionPair(paths: ProjectionPaths, pairId: string): Promise<void> {
  for (const [profile, manifestPath, packPath] of [
    ["ui", paths.uiManifest, paths.uiPack],
    ["exports", paths.exportManifest, paths.exportPack],
  ] as const) {
    const manifest = decodeAssetPackManifest(await readFile(manifestPath));
    const pack = await readFile(packPath);
    expect(manifest.profile).toBe(profile);
    expect(manifest.pair_id).toBe(pairId);
    expect(() => validateAssetPack(manifest, pack)).not.toThrow();
  }
}

describe("crash-consistent catalog pair publication", () => {
  it("prepares the same immutable pair with parallel validation", async () => {
    const serial = prepareCatalogPair(catalog(), pricing);
    const parallel = await prepareCatalogPairInParallel(catalog(), pricing);
    expect(parallel).toEqual(serial);
    expect(Object.isFrozen(parallel)).toBe(true);
    expect(Object.isFrozen(parallel.pricing.data)).toBe(true);
  });

  it("commits only the exact immutable object returned by preparation", async () => {
    const output = await paths();
    const candidate = prepareCatalogPair(catalog(), pricing);
    await expect(commitCatalogPair({ ...candidate }, output)).rejects.toThrow("was not prepared");
  });

  it("commits and recovers one exact accepted asset pair", async () => {
    const output = await paths();
    const candidate = prepareCatalogPair(catalog(), pricing);
    await commitCatalogPair(candidate, output);

    const recovered = await recoverCatalogPair(output);
    expect(recovered?.pairId).toBe(candidate.pairId);
    expect(recovered?.identity).toEqual(candidate.identity);
    expect(await pricingMirrorSource(output.pricingMirrorGzip)).toBe(candidate.pricingAssetSource);
    await expectProjectionPair(output.projections, candidate.pairId);
  });

  it("repairs all mirrors from the atomic accepted-pair pointer", async () => {
    const output = await paths();
    const candidate = prepareCatalogPair(catalog(), pricing);
    await commitCatalogPair(candidate, output);
    await Promise.all([
      writeFile(output.catalogMirror, "{}"),
      writeFile(output.pricingMirrorGzip, "{}"),
      writeFile(output.projections.uiManifest, "{}"),
      writeFile(output.projections.uiPack, "{}"),
      writeFile(output.projections.exportManifest, "{}"),
      writeFile(output.projections.exportPack, "{}"),
    ]);

    const recovered = await recoverCatalogPair(output);
    expect(await readFile(output.catalogMirror, "utf8")).toBe(recovered?.catalogStorageSource);
    expect(await pricingMirrorSource(output.pricingMirrorGzip)).toBe(recovered?.pricingAssetSource);
    await expectProjectionPair(output.projections, candidate.pairId);
  });

  it("loads a checked-in compressed mirror without local pair state", async () => {
    const output = await paths();
    const candidate = prepareCatalogPair(catalog(), pricing);
    await commitCatalogPair(candidate, output);
    await rm(output.stateDirectory, { recursive: true });

    const recovered = await recoverCatalogPair(output);
    expect(recovered?.pairId).toBe(candidate.pairId);
    expect(recovered?.pricingAssetSource).toBe(candidate.pricingAssetSource);
  });

  it("reads checked-in mirrors independently of stale local pair state", async () => {
    const output = await paths();
    const initial = prepareCatalogPair(catalog(), pricing);
    await commitCatalogPair(initial, output);
    const checkedOut = prepareCatalogPair(
      catalog([{ code: "test", message: "checked-out pair" }]),
      initial.pricing,
    );
    await commitCatalogPair(checkedOut, {
      ...output,
      stateDirectory: join(output.stateDirectory, "checked-out"),
    });

    const mirrors = await readCatalogPairMirrors(output);
    expect(mirrors?.pairId).toBe(checkedOut.pairId);
    expect(
      JSON.parse(await readFile(join(output.stateDirectory, "current.json"), "utf8")),
    ).toMatchObject({ pair_id: initial.pairId });
  });

  it("repairs an interrupted snapshot before advancing the pointer", async () => {
    const output = await paths();
    const candidate = prepareCatalogPair(catalog(), pricing);
    const snapshot = join(output.stateDirectory, "snapshots", candidate.pairId);
    await mkdir(snapshot, { recursive: true });
    await writeFile(join(snapshot, "catalog.json"), "partial");

    await commitCatalogPair(candidate, output);

    const recovered = await recoverCatalogPair(output);
    expect(recovered?.pairId).toBe(candidate.pairId);
    expect(await readFile(join(snapshot, "catalog.json"), "utf8")).toBe(
      candidate.catalogStorageSource,
    );
  });

  it("regenerates corrupt derived snapshot assets from the accepted pair", async () => {
    const output = await paths();
    const candidate = prepareCatalogPair(catalog(), pricing);
    await commitCatalogPair(candidate, output);
    const snapshot = join(output.stateDirectory, "snapshots", candidate.pairId);
    await Promise.all([
      writeFile(join(snapshot, "website-assets.pack"), "corrupt"),
      writeFile(join(snapshot, "export-assets.json"), "{}"),
    ]);

    await recoverCatalogPair(output);

    await expectProjectionPair(
      {
        uiManifest: join(snapshot, "website-assets.json"),
        uiPack: join(snapshot, "website-assets.pack"),
        exportManifest: join(snapshot, "export-assets.json"),
        exportPack: join(snapshot, "export-assets.pack"),
      },
      candidate.pairId,
    );
  });

  it("includes catalog diagnostics in pair identity but not the pricing core binding", () => {
    const initial = prepareCatalogPair(catalog(), pricing);
    const changed = prepareCatalogPair(
      catalog([{ code: "test", message: "diagnostic only" }]),
      initial.pricing,
    );
    expect(changed.pricing.core_data_sha256).toBe(initial.pricing.core_data_sha256);
    expect(changed.identity.catalog_asset_sha256).not.toBe(initial.identity.catalog_asset_sha256);
    expect(changed.pairId).not.toBe(initial.pairId);
  });

  it("materializes optional undefined fields as JSON before pair validation", () => {
    const input = catalogSchema.parse({
      ...catalog(),
      providers: [
        {
          id: "test",
          name: "Test",
          kind: "hosted",
          homepage: "https://example.com",
          catalog_scope: "global",
          source_ids: [],
          last_successful_sync_at: undefined,
        },
      ],
    });
    const candidate = prepareCatalogPair(input, pricing);
    expect(candidate.catalog.providers[0]).not.toHaveProperty("last_successful_sync_at");
  });
});
