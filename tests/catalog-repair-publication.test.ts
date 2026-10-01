import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import {
  assertRepairChanges,
  parseRepairOutcome,
  repairPatchHash,
  runRepairPublication,
} from "../scripts/catalog-repair-publication.ts";

const { files, git } = vi.hoisted(() => ({ files: new Map<string, string>(), git: vi.fn() }));
vi.mock("node:child_process", () => ({ spawnSync: git }));
vi.mock("node:fs/promises", () => ({
  readFile: async (path: string) => {
    const value = files.get(path);
    if (value === undefined) throw new Error(`Missing test file ${path}`);
    return value;
  },
  writeFile: async (path: string, value: string) => {
    files.set(path, value);
  },
  appendFile: async (path: string, value: string) => {
    files.set(path, (files.get(path) ?? "") + value);
  },
  mkdir: async () => {},
}));

beforeEach(() => {
  files.clear();
  git.mockReset();
  vi.stubEnv("REPAIR_BASE_SHA", "1".repeat(40));
  vi.stubEnv("REPAIR_ARTIFACT_DIR", "/tmp/repair-test");
  vi.stubEnv("REPAIR_TREE_SHA", "2".repeat(40));
  vi.stubEnv("GH_AW_SAFE_OUTPUTS", "/tmp/repair-output.jsonl");
  vi.stubEnv("GITHUB_OUTPUT", "/tmp/repair-test-output");
  vi.stubEnv("GITHUB_SERVER_URL", "https://github.com");
  vi.stubEnv("GH_TOKEN", "test-token");
});
afterEach(() => vi.unstubAllEnvs());

const repair = {
  type: "commit_repair",
  title: "fix: repair billing fields",
  body: "Reviewed source and regression evidence",
};
const diff = (path: string, oldMode = "100644", newMode = "100644", status = "M") =>
  `:${oldMode} ${newMode} ${"1".repeat(40)} ${"2".repeat(40)} ${status}\0${path}\0`;

it("reads raw journals and collected framework outputs without admitting other mutations", () => {
  for (const output of [JSON.stringify(repair), JSON.stringify({ items: [repair] }, null, 2)])
    expect(parseRepairOutcome(output)).toEqual(repair);
  for (const items of [[], [repair, repair], [repair, { type: "noop", message: "No repair" }]])
    expect(() => parseRepairOutcome(JSON.stringify({ items }))).toThrow("exactly one");
  for (const title of ["", "   ", "repair\nsecond command", "repair\0", "x".repeat(257)])
    expect(() => parseRepairOutcome(JSON.stringify({ ...repair, title }))).toThrow();
  expect(() =>
    parseRepairOutcome(JSON.stringify({ items: [repair, { type: "report_incomplete" }] })),
  ).toThrow("incomplete");
});

it("admits parser repairs and reviewed fixtures while rejecting publication and infrastructure changes", () => {
  for (const path of [
    "src/catalog/cohere-accounting.ts",
    "tests/source-drift.test.ts",
    "tests/fixtures/cohere/embed.md",
    "docs/providers/cohere.md",
    "docs/semantic-audit-decisions.json",
  ])
    expect(() => assertRepairChanges(diff(path), "patch")).not.toThrow();
  for (const path of [
    "data/catalog.json",
    ".github/workflows/catalog.yml",
    "scripts/catalog-repair-publication.ts",
    "package.json",
    "pnpm-lock.yaml",
    "src/catalog/catalog-repair.ts",
    "tests/catalog-repair-workflow.test.ts",
    "tests/setup.ts",
    "tests/fixtures/../setup.ts",
    "tests/fixtures/.hidden",
    "tests/fixtures/a\npath.md",
    "src/App.vue",
    "AGENTS.md",
  ])
    expect(() => assertRepairChanges(diff(path), "patch")).toThrow("cannot modify");
  expect(() =>
    assertRepairChanges(diff("tests/fixtures/cohere/embed.md", "000000", "100644", "A"), "patch"),
  ).not.toThrow();
  expect(() =>
    assertRepairChanges(diff("tests/fixtures/cohere/embed.md", "100644", "000000", "D"), "patch"),
  ).not.toThrow();
});

it("rejects executable, symlink, submodule, malformed, and oversized patches", () => {
  for (const mode of ["100755", "120000", "160000"])
    for (const [oldMode, newMode] of [
      [mode, "100644"],
      ["100644", mode],
    ])
      expect(() =>
        assertRepairChanges(diff("tests/fixtures/cohere/embed.md", oldMode, newMode), "patch"),
      ).toThrow("modes");
  expect(() => assertRepairChanges("", "patch")).toThrow("Invalid");
  expect(() => assertRepairChanges(diff("src/catalog/cohere.ts").slice(0, -1), "patch")).toThrow(
    "Invalid",
  );
  expect(() => assertRepairChanges(diff("src/catalog/cohere.ts"), "")).toThrow("empty");
  expect(() =>
    assertRepairChanges(diff("src/catalog/cohere.ts"), "é".repeat(2 * 1024 * 1024 + 1)),
  ).toThrow("4 MiB");
  expect(() => assertRepairChanges(diff("src/catalog/cohere.ts").repeat(101), "patch")).toThrow(
    "100 changed files",
  );
  expect(repairPatchHash("patch\n")).not.toBe(repairPatchHash("patch\r\n"));
});

const success = (stdout: string) => ({ status: 0, stdout, stderr: "" });
function artifact(patch = "patch"): void {
  files.set("/tmp/repair-test/repair.patch", patch);
  files.set(
    "/tmp/repair-test/repair.json",
    JSON.stringify({ ...repair, base_sha: "1".repeat(40), patch_sha256: repairPatchHash(patch) }),
  );
}

it("rejects changed artifacts and wrong base commits before running Git", async () => {
  artifact();
  files.set("/tmp/repair-test/repair.patch", "modified patch");
  await expect(runRepairPublication("apply")).rejects.toThrow("does not match");
  expect(git).not.toHaveBeenCalled();
  artifact();
  vi.stubEnv("REPAIR_BASE_SHA", "3".repeat(40));
  await expect(runRepairPublication("apply")).rejects.toThrow("invalid validation record");
  expect(git).not.toHaveBeenCalled();
});

it("requires the prepared detection patch and rejects changes introduced by validation", async () => {
  files.set("/tmp/repair-output.jsonl", JSON.stringify(repair));
  files.set("/tmp/gh-aw/aw-catalog-repair.patch", "old patch");
  git
    .mockReturnValueOnce(success(""))
    .mockReturnValueOnce(success("patch"))
    .mockReturnValueOnce(success(diff("src/catalog/cohere.ts")));
  await expect(runRepairPublication("capture")).rejects.toThrow("after staging");
  expect(files.has("/tmp/repair-test/repair.json")).toBe(false);
  vi.stubEnv("REPAIR_PATCH_SHA256", repairPatchHash("old patch"));
  git
    .mockReturnValueOnce(success(""))
    .mockReturnValueOnce(success("patch"))
    .mockReturnValueOnce(success(diff("src/catalog/cohere.ts")));
  await expect(runRepairPublication("verify")).rejects.toThrow("changed during validation");
  artifact();
  git.mockReturnValueOnce(success("")).mockReturnValueOnce(success("3".repeat(40)));
  await expect(runRepairPublication("commit")).rejects.toThrow("tree changed");
  expect(git.mock.calls.some(([, args]) => Array.isArray(args) && args.includes("commit"))).toBe(
    false,
  );
});

it("applies through three-way conflict checks and never overwrites concurrent main updates", async () => {
  artifact();
  git
    .mockReturnValueOnce(success(""))
    .mockReturnValueOnce({ status: 1, stdout: "", stderr: "patch conflict" });
  await expect(runRepairPublication("apply")).rejects.toThrow("patch conflict");
  expect(git.mock.calls[1]?.[1]).toEqual([
    "apply",
    "--3way",
    "--index",
    "/tmp/repair-test/repair.patch",
  ]);
  git.mockReset();
  git.mockReturnValueOnce({ status: 1, stdout: "", stderr: "non-fast-forward" });
  await expect(runRepairPublication("push")).rejects.toThrow("non-fast-forward");
  expect(git.mock.calls).toHaveLength(1);
  const args: unknown = git.mock.calls[0]?.[1];
  expect(args).toEqual(expect.arrayContaining(["push", "origin", "HEAD:refs/heads/main"]));
  expect(args).not.toEqual(expect.arrayContaining(["--force", "--force-with-lease"]));
});
