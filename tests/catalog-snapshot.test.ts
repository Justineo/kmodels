import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vite-plus/test";
import {
  expiredAssets,
  packSnapshot,
  restoreSnapshot,
  snapshotFingerprint,
  snapshotFiles,
  stageSnapshot,
  restoreStagedSnapshot,
  publishStagedSnapshot,
} from "../scripts/catalog-snapshot.ts";

const github = vi.hoisted(() => ({ exec: vi.fn() }));
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  execFileSync: github.exec,
}));

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
    await writeFile(join(directory, "catalog-snapshot.json"), JSON.stringify(pointer));
    const fingerprint = await snapshotFingerprint(directory);
    await writeFile(join(directory, optional), "changed");
    expect(await snapshotFingerprint(directory)).not.toBe(fingerprint);
    await writeFile(
      join(directory, "catalog-snapshot.json"),
      JSON.stringify({ ...pointer, sha256: "0".repeat(64) }),
    );
    await expect(snapshotFingerprint(directory)).rejects.toThrow("checked-out pointer");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("stages a candidate for independent checks without advancing the source pointer", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kmodels-staged-"));
  const staged = join(directory, "staged");
  const restored = join(directory, "restored");
  try {
    for (const name of snapshotFiles) await writeFile(join(directory, name), `candidate:${name}`);
    await writeFile(join(directory, "catalog-snapshot.json"), "accepted pointer");
    await stageSnapshot(directory, staged, 1_794_010_000);
    expect(await readFile(join(directory, "catalog-snapshot.json"), "utf8")).toBe(
      "accepted pointer",
    );
    await restoreStagedSnapshot(staged, restored);
    for (const name of snapshotFiles)
      expect(await readFile(join(restored, name), "utf8")).toBe(`candidate:${name}`);
    expect(await snapshotFingerprint(restored)).toMatch(/^[a-f0-9]{64}$/);
    await writeFile(join(staged, "snapshot.pack.gz"), "corrupt");
    await expect(restoreStagedSnapshot(staged, restored)).rejects.toThrow(
      "does not match its pointer",
    );
    expect(await readFile(join(restored, "catalog.json"), "utf8")).toBe("candidate:catalog.json");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("publishes the exact checked archive without repacking its members or capture time", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kmodels-publish-staged-"));
  try {
    const staged = join(directory, "staged");
    const output = join(directory, "output");
    for (const name of snapshotFiles) await writeFile(join(directory, name), name);
    await stageSnapshot(directory, staged, 1_794_010_000);
    const expected = await readFile(join(staged, "snapshot.pack.gz"));
    const pointer = await readFile(join(staged, "catalog-snapshot.json"), "utf8");
    const { pointer: identity } = await packSnapshot(directory, 1_794_010_000);
    const name = `catalog-${identity.captured_at}-${identity.sha256}.pack.gz`;
    let uploaded = false;
    github.exec.mockReset();
    github.exec.mockImplementation((_command: string, args: string[]) => {
      if (args.includes("upload")) {
        uploaded = true;
        return "";
      }
      if (args.includes("--slurp"))
        return JSON.stringify([
          uploaded
            ? [
                {
                  id: 1,
                  name,
                  digest: `sha256:${identity.sha256}`,
                  size: expected.length,
                  state: "uploaded",
                },
              ]
            : [],
        ]);
      return JSON.stringify({ id: 1 });
    });
    await writeFile(join(directory, "catalog.json"), "changed after staging");
    await publishStagedSnapshot(staged, output);
    expect(uploaded).toBe(true);
    expect(await readFile(join(output, name))).toEqual(expected);
    expect(await readFile(join(output, "catalog-snapshot.json"), "utf8")).toBe(pointer);
    const callCount = github.exec.mock.calls.length;
    await writeFile(join(staged, "snapshot.pack.gz"), "corrupt");
    await expect(publishStagedSnapshot(staged, output)).rejects.toThrow(
      "does not match its pointer",
    );
    expect(github.exec).toHaveBeenCalledTimes(callCount);
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
