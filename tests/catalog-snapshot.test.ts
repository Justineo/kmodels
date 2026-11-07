import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import {
  expiredAssets,
  packSnapshot,
  restoreSnapshot,
  snapshotFiles,
} from "../scripts/catalog-snapshot.ts";

it("restores the exact archive and removes a stale optional mirror", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kmodels-archive-"));
  try {
    const optional = "inference-pricing.json";
    for (const name of snapshotFiles) {
      if (name !== optional) await writeFile(join(directory, name), name);
    }
    const { pointer, archive } = await packSnapshot(directory, 1_794_010_000);
    await writeFile(join(directory, optional), "stale");
    await writeFile(join(directory, "catalog.json"), "local");
    await expect(
      restoreSnapshot(directory, { ...pointer, sha256: "0".repeat(64) }, archive),
    ).rejects.toThrow("checked-out pointer");
    expect(await readFile(join(directory, "catalog.json"), "utf8")).toBe("local");
    await restoreSnapshot(directory, pointer, archive);
    for (const name of snapshotFiles) {
      if (name !== optional) expect(await readFile(join(directory, name), "utf8")).toBe(name);
    }
    await expect(readFile(join(directory, optional))).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("prunes only old snapshot assets and preserves an expired current snapshot", () => {
  const now = 1_794_010_000;
  const cutoff = now - 7 * 24 * 60 * 60;
  const name = (time: number, digit = "a") => `catalog-${time}-${digit.repeat(64)}.pack.gz`;
  const current = name(cutoff - 10);
  expect(
    expiredAssets(
      [
        { id: 1, name: current },
        { id: 2, name: name(cutoff - 10, "b") },
        { id: 3, name: name(cutoff) },
        { id: 4, name: name(now) },
        { id: 5, name: "other-release-asset.tar.gz" },
      ],
      current,
      now,
    ),
  ).toEqual([2]);
});
