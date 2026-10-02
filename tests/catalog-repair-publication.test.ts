import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import {
  assertRepairChanges,
  parseRepairOutcome,
  repairPatchHash,
  runRepairPublication,
  validateRepair,
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
  rm: async (path: string) => {
    files.delete(path);
  },
}));

beforeEach(() => {
  files.clear();
  git.mockReset();
  // AWF caches native token reads, including absence. Use an in-memory environment:
  // vi.stubEnv cannot replace a GH_TOKEN value already cached by the sandbox.
  vi.stubGlobal("process", {
    ...process,
    env: {
      REPAIR_BASE_SHA: "1".repeat(40),
      REPAIR_ARTIFACT_DIR: "/tmp/repair-test",
      REPAIR_TREE_SHA: "2".repeat(40),
      GH_AW_SAFE_OUTPUTS: "/tmp/repair-output.jsonl",
      GITHUB_OUTPUT: "/tmp/repair-test-output",
      GITHUB_SERVER_URL: "https://github.com",
      GH_TOKEN: "test-token",
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

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
  process.env.REPAIR_BASE_SHA = "3".repeat(40);
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
  process.env.REPAIR_PATCH_SHA256 = repairPatchHash("old patch");
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

it("fails closed without a publication credential, independently of the host environment", async () => {
  delete process.env.GH_TOKEN;
  await expect(runRepairPublication("push")).rejects.toThrow("Missing GH_TOKEN");
  expect(git).not.toHaveBeenCalled();
});

it("requests one fully revalidated retry only for a concurrent main push rejection", async () => {
  process.env.REPAIR_RETRY_ON_RACE = "true";
  for (const reason of ["fetch first", "non-fast-forward"]) {
    files.clear();
    git.mockReturnValueOnce({
      status: 1,
      stdout: "",
      stderr: ` ! [rejected] HEAD -> main (${reason})`,
    });
    await runRepairPublication("push");
    expect(files.get("/tmp/repair-test-output")).toBe("retry=true\n");
  }
  files.clear();
  git.mockReturnValueOnce({ status: 1, stdout: "", stderr: "permission denied" });
  await expect(runRepairPublication("push")).rejects.toThrow("permission denied");
  expect(files.size).toBe(0);
  delete process.env.REPAIR_RETRY_ON_RACE;
  git.mockReturnValueOnce({
    status: 1,
    stdout: "",
    stderr: " ! [rejected] HEAD -> main (fetch first)",
  });
  await expect(runRepairPublication("push")).rejects.toThrow("fetch first");
  expect(files.size).toBe(0);
});

it("reapplies the admitted patch to current main and returns a new tree for validation", async () => {
  artifact();
  git.mockImplementation((_command: string, args: string[]) => {
    if (args.includes("--raw")) return success(diff("src/catalog/cohere.ts"));
    if (args.includes("--binary")) return success("patch");
    if (args[0] === "write-tree") return success("3".repeat(40));
    return success("");
  });
  await runRepairPublication("retry-apply");
  expect(git.mock.calls.slice(0, 6).map(([, args]) => args)).toEqual([
    ["status", "--porcelain"],
    ["fetch", "--no-tags", "origin", "main"],
    ["merge-base", "--is-ancestor", "1".repeat(40), "FETCH_HEAD"],
    ["reset", "--hard", "FETCH_HEAD"],
    ["merge-base", "--is-ancestor", "1".repeat(40), "HEAD"],
    ["apply", "--3way", "--index", "/tmp/repair-test/repair.patch"],
  ]);
  expect(files.get("/tmp/repair-test-output")).toBe(`tree_sha=${"3".repeat(40)}\n`);
  expect(git.mock.calls.some(([, args]) => args.includes("push"))).toBe(false);
});

it("does not discard a dirty checkout or continue a conflicted retry", async () => {
  artifact();
  git.mockReturnValueOnce(success(" M src/catalog/cohere.ts"));
  await expect(runRepairPublication("retry-apply")).rejects.toThrow("clean publication checkout");
  expect(git).toHaveBeenCalledTimes(1);
  git.mockReset();
  git.mockImplementation((_command: string, args: string[]) =>
    args[0] === "apply" ? { status: 1, stdout: "", stderr: "patch conflict" } : success(""),
  );
  await expect(runRepairPublication("retry-apply")).rejects.toThrow("patch conflict");
  expect(files.has("/tmp/repair-test-output")).toBe(false);
});

it("returns failed validation to the agent and stages only a successful unchanged retry", async () => {
  const patch = "reviewed patch";
  files.set("/tmp/gh-aw/aw-catalog-repair.patch", "stale patch");
  let failTests = true;
  let changeDuringValidation = false;
  let validated = false;
  git.mockImplementation((command: string, args: string[]) => {
    if (command === "vp") {
      if (args[0] === "test" && failTests) return { status: 1 };
      if (args[1] === "package:check") validated = true;
      return success("");
    }
    if (args.includes("--raw")) return success(diff("src/catalog/cohere.ts"));
    if (args.includes("--binary"))
      return success(changeDuringValidation && validated ? "changed patch" : patch);
    return success("");
  });
  await expect(runRepairPublication("stage")).rejects.toThrow("vp test --run failed");
  expect(files.has("/tmp/gh-aw/aw-catalog-repair.patch")).toBe(false);
  expect(git.mock.calls.some(([command, args]) => command === "vp" && args[1] === "build")).toBe(
    false,
  );

  failTests = false;
  await runRepairPublication("stage");
  expect(files.get("/tmp/gh-aw/aw-catalog-repair.patch")).toBe(patch);
  expect(
    git.mock.calls
      .filter(([command]) => command === "vp")
      .slice(-6)
      .map(([, args]) => args),
  ).toEqual([
    ["check"],
    ["test", "--run"],
    ["run", "collect:fixtures"],
    ["run", "build"],
    ["run", "package:build"],
    ["run", "package:check"],
  ]);

  changeDuringValidation = true;
  validated = false;
  await expect(runRepairPublication("stage")).rejects.toThrow("changed during validation");
  expect(files.has("/tmp/gh-aw/aw-catalog-repair.patch")).toBe(false);
});

it("does not accept a killed or unavailable validation process", () => {
  git.mockReturnValueOnce({ status: null, signal: "SIGTERM" });
  expect(validateRepair).toThrow("vp check failed (SIGTERM)");
  git.mockReturnValueOnce({ error: new Error("vp unavailable") });
  expect(validateRepair).toThrow("vp unavailable");
});
