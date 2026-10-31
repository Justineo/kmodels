import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vite-plus/test";
import { packageSourceHash } from "../scripts/validate-changes.ts";

vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));

it("checks generation changes against the prepared package tree, not Git's base version", async () => {
  const root = await mkdtemp(join(tmpdir(), "kmodels-package-source-"));
  const packageRoot = join(root, "packages/pricing");
  const paths = ["packages/pricing/schema.json"];
  vi.mocked(spawnSync).mockImplementation(() => ({
    status: 0,
    signal: null,
    pid: 0,
    output: [],
    stdout: paths.join("\0"),
    stderr: "",
  }));
  try {
    await mkdir(join(packageRoot, "dist"), { recursive: true });
    const source = join(packageRoot, "schema.json");
    await writeFile(source, "original");
    await writeFile(source, "prepared ".repeat(200_000));
    const prepared = await packageSourceHash(root);
    expect(await packageSourceHash(root)).toBe(prepared);
    await writeFile(join(packageRoot, "dist/index.js"), "generated runtime");
    expect(await packageSourceHash(root)).toBe(prepared);
    await writeFile(source, "unexpected generated change");
    expect(await packageSourceHash(root)).not.toBe(prepared);
    await writeFile(source, "prepared ".repeat(200_000));
    expect(await packageSourceHash(root)).toBe(prepared);
    const added = join(packageRoot, "new-schema.json");
    await writeFile(added, "new artifact");
    paths.push("packages/pricing/new-schema.json");
    expect(await packageSourceHash(root)).not.toBe(prepared);
    await rm(added);
    paths.pop();
    await rm(source);
    const removed = await packageSourceHash(root);
    expect(removed).not.toBe(prepared);
    expect(await packageSourceHash(root)).toBe(removed);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
