import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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
    await writeFile(source, "prepared schema", { mode: 0o644 });
    const prepared = await packageSourceHash(root);
    await writeFile(join(packageRoot, "dist/index.js"), "generated runtime");
    expect(await packageSourceHash(root)).toBe(prepared);
    await chmod(source, 0o755);
    expect(await packageSourceHash(root)).not.toBe(prepared);
    await chmod(source, 0o644);
    await writeFile(source, "unexpected generated change");
    expect(await packageSourceHash(root)).not.toBe(prepared);
    await writeFile(source, "prepared schema");
    expect(await packageSourceHash(root)).toBe(prepared);
    const added = join(packageRoot, "new-schema.json");
    await writeFile(added, "new artifact");
    paths.push("packages/pricing/new-schema.json");
    expect(await packageSourceHash(root)).not.toBe(prepared);
    await rm(added);
    paths.pop();
    await rm(source);
    expect(await packageSourceHash(root)).not.toBe(prepared);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
