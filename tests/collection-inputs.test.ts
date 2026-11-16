import { access, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { afterAll, afterEach, expect, it, vi } from "vite-plus/test";
import { collect } from "../src/catalog/collector.ts";
import { recoverCatalogPair } from "../src/catalog/pricing-publication.ts";
import { fetchSource } from "../src/catalog/fetch.ts";

const { directory } = await vi.hoisted(async () => {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  return { directory: await mkdtemp(join(tmpdir(), "kmodels-collection-inputs-")) };
});

vi.mock("../src/catalog/io.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/catalog/io.ts")>()),
  rootDirectory: directory,
}));
vi.mock("../src/catalog/pricing-publication.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/catalog/pricing-publication.ts")>();
  return { ...original, recoverCatalogPair: vi.fn(original.recoverCatalogPair) };
});
vi.mock("../src/catalog/fetch.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/catalog/fetch.ts")>()),
  fetchSource: vi.fn(() => {
    throw new Error("Collection input tests must not fetch live sources");
  }),
}));

afterEach(async () => {
  vi.clearAllMocks();
  await rm(join(directory, "data"), { recursive: true, force: true });
});
afterAll(() => rm(directory, { recursive: true, force: true }));

const emptyBatch = () => ({
  results: [],
  durations: [],
  sourceDurations: [],
  state: { sources: {} },
});

it("waits for accepted-state recovery before loading fresh collected inputs", async () => {
  let release: (() => void) | undefined;
  const recovered = new Promise<undefined>((resolve) => {
    release = () => resolve(undefined);
  });
  vi.mocked(recoverCatalogPair).mockReturnValueOnce(recovered);
  const loadCollected = vi.fn(async () => emptyBatch());
  const pending = collect({ now: new Date("2026-11-16T00:00:00.000Z"), loadCollected });
  await setImmediate();
  expect(recoverCatalogPair).toHaveBeenCalledOnce();
  expect(loadCollected).not.toHaveBeenCalled();
  if (release === undefined) throw new Error("Missing recovery resolver");
  release();
  const catalog = await pending;
  expect(loadCollected).toHaveBeenCalledOnce();
  expect(fetchSource).not.toHaveBeenCalled();
  expect(catalog.models).toEqual([]);
  expect(await readFile(join(directory, "data/catalog.json"), "utf8")).toContain(
    catalog.catalog_version,
  );
});

it("aborts a failed shard load before writing collection state or committing a pair", async () => {
  vi.mocked(recoverCatalogPair).mockResolvedValueOnce(undefined);
  const loadCollected = vi.fn(async () => {
    throw new Error("Invalid shard fixture");
  });
  await expect(collect({ loadCollected })).rejects.toThrow("Invalid shard fixture");
  expect(loadCollected).toHaveBeenCalledOnce();
  expect(fetchSource).not.toHaveBeenCalled();
  await expect(access(join(directory, "data/fetch-state.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  await expect(access(join(directory, "data/.catalog-state/current.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("rejects rebuild combinations before recovering or loading shards", async () => {
  const loadCollected = vi.fn(async () => emptyBatch());
  await expect(collect({ loadCollected, rebuild: true })).rejects.toThrow("cannot be combined");
  await expect(collect({ loadCollected, rebuildProvider: "typesafe" })).rejects.toThrow(
    "cannot be combined",
  );
  expect(recoverCatalogPair).not.toHaveBeenCalled();
  expect(loadCollected).not.toHaveBeenCalled();
});
