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
    if (value === undefined)
      throw Object.assign(new Error(`Missing test file ${path}`), { code: "ENOENT" });
    return value;
  },
  writeFile: async (path: string, value: string) => {
    files.set(path, value);
  },
  appendFile: async (path: string, value: string) => {
    files.set(path, (files.get(path) ?? "") + value);
  },
  mkdir: async () => {},
  mkdtemp: async () => "/tmp/repair-check",
  readdir: async (directory: string) =>
    [...files.keys()].flatMap((path) => {
      const name = path.slice(directory.length + 1);
      return path.startsWith(`${directory}/`) && !name.includes("/") ? [name] : [];
    }),
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
      REPAIR_REQUIRED: "true",
      RUNNER_TEMP: "/tmp/repair-runner",
      REPAIR_ARTIFACT_DIR: "/tmp/repair-test",
      REPAIR_TREE_SHA: "2".repeat(40),
      REPAIR_SNAPSHOT_SHA: "4".repeat(64),
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

it("rejects an admitted no-op without trusted no-defect evidence, before staging any files", async () => {
  files.set(
    "/tmp/repair-output.jsonl",
    JSON.stringify({ type: "noop", message: "Existing fallback tests pass" }),
  );
  git.mockReturnValue({ ...success(""), status: 1 });
  await expect(runRepairPublication("capture")).rejects.toThrow("no-op cannot complete");
  expect(git).toHaveBeenCalledExactlyOnceWith(
    "vp",
    ["node", "/tmp/repair-runner/catalog-repair-review.ts", "check-no-defect"],
    { stdio: "inherit" },
  );
  git.mockReset();
  delete process.env.REPAIR_REQUIRED;
  await expect(runRepairPublication("capture")).rejects.toThrow("Missing REPAIR_REQUIRED");
  process.env.REPAIR_REQUIRED = "false";
  git.mockReturnValue(success(""));
  await runRepairPublication("capture");
  expect(files.get("/tmp/repair-test-output")).toBe("outcome=noop\n");
});

it("accepts an empty no-op only after the runner-owned script verifies all no-defect conclusions", async () => {
  files.set("/tmp/gh-aw/aw-catalog-repair.patch", "Abandoned investigation patch");
  files.set(
    "/tmp/repair-output.jsonl",
    JSON.stringify({
      type: "noop",
      message: "All candidates verified against current source and parser",
    }),
  );
  git.mockReturnValue(success(""));
  await runRepairPublication("capture");
  expect(git.mock.calls[0]).toEqual([
    "vp",
    ["node", "/tmp/repair-runner/catalog-repair-review.ts", "check-no-defect"],
    { stdio: "inherit" },
  ]);
  expect(files.get("/tmp/repair-test-output")).toBe("outcome=noop\n");
  expect(files.has("/tmp/gh-aw/aw-catalog-repair.patch")).toBe(false);
});
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

it("preserves a bounded, escaped blocker reason in the failed publication step", () => {
  const reason = "Azure identity is ambiguous\nMistral service rates remain unverified";
  expect(() => parseRepairOutcome(JSON.stringify({ type: "report_incomplete", reason }))).toThrow(
    `Catalog repair incomplete (report_incomplete): ${JSON.stringify(reason)}`,
  );
  expect(() =>
    parseRepairOutcome(JSON.stringify({ type: "missing_data", reason: "x".repeat(2000) })),
  ).toThrow(`Catalog repair incomplete (missing_data): ${JSON.stringify("x".repeat(1000))}`);
  expect(() =>
    parseRepairOutcome(JSON.stringify({ type: "report_incomplete", reason: {} })),
  ).toThrow("Catalog repair incomplete (report_incomplete)");
});

it("admits parser repairs and reviewed fixtures while rejecting publication and infrastructure changes", () => {
  for (const path of [
    "src/catalog/cohere-accounting.ts",
    "tests/source-drift.test.ts",
    "tests/deepseek-fixture.ts",
    "tests/bedrock-sonic-fixtures.ts",
    "tests/fixtures/cohere/embed.md",
    "docs/providers/cohere.md",
    "docs/semantic-audit-decisions.json",
  ])
    expect(() => assertRepairChanges(diff(path), "patch")).not.toThrow();
  for (const path of [
    "data/catalog.json",
    ".github/workflows/catalog.yml",
    "scripts/catalog-repair-publication.ts",
    "src/catalog/public-evidence.ts",
    "tests/public-evidence.test.ts",
    "package.json",
    "pnpm-lock.yaml",
    "src/catalog/catalog-repair.ts",
    "tests/catalog-repair-workflow.test.ts",
    "tests/catalog-snapshot.test.ts",
    "tests/test-architecture.test.ts",
    "tests/validate-tests.test.ts",
    "tests/validation-plan.test.ts",
    "tests/setup.ts",
    "tests/catalog-repair-fixture.ts",
    "tests/public-evidence-fixtures.ts",
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

it("checks the same patch policy before submission using only temporary Git state", async () => {
  let path = "tests/deepseek-fixture.ts";
  git.mockImplementation((_command: string, args: string[]) => {
    if (args[0] === "rev-parse") return success("/checkout/.git/objects\n");
    if (args.includes("--raw")) return success(diff(path));
    return success(args[0] === "diff" ? "patch" : "");
  });
  await expect(runRepairPublication("check-patch")).resolves.toBeUndefined();
  expect(git.mock.calls.slice(1).map(([, args]) => args[0])).toEqual([
    "read-tree",
    "add",
    "diff",
    "diff",
  ]);
  for (const [, , options] of git.mock.calls.slice(1))
    expect(options.env).toMatchObject({
      GIT_INDEX_FILE: "/tmp/repair-check/index",
      GIT_OBJECT_DIRECTORY: "/tmp/repair-check/objects",
      GIT_ALTERNATE_OBJECT_DIRECTORIES: "/checkout/.git/objects",
    });

  path = "tests/setup.ts";
  await expect(runRepairPublication("check-patch")).rejects.toThrow(
    "Catalog repair cannot modify tests/setup.ts",
  );
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

it("rejects manifest limit edits even when accompanied by fixtures and passing tests", () => {
  const patch = (before: string, after: string) =>
    `diff --git a/src/catalog/manifests.ts b/src/catalog/manifests.ts\n--- a/src/catalog/manifests.ts\n+++ b/src/catalog/manifests.ts\n@@ -1 +1 @@\n-${before}\n+${after}\n`;
  const before = 'extractor: { kind: "dashscope-pricing", minModels: 240, maxModels: 500 },';
  for (const after of [
    before.replace("240", "200"),
    before.replace("500", "1000"),
    before.replace("minModels: 240, ", ""),
    before.replace("240", "configuredFloor"),
  ])
    expect(() =>
      assertRepairChanges(diff("src/catalog/manifests.ts"), patch(before, after)),
    ).toThrow("cannot change manifest limits");
  expect(() =>
    assertRepairChanges(
      diff("src/catalog/manifests.ts"),
      patch(
        'url: "https://docs.example/old", extractorVersion: "v1",',
        'url: "https://docs.example/current", extractorVersion: "v2",',
      ),
    ),
  ).not.toThrow();
});
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

it("captures the same exact patch for detection and publication without agent staging", async () => {
  files.set("/tmp/repair-output.jsonl", JSON.stringify(repair));
  files.set("/tmp/gh-aw/aw-catalog-repair.patch", "old patch");
  files.set("/tmp/gh-aw/aw-other.bundle", "untrusted bundle");
  git
    .mockReturnValueOnce(success(""))
    .mockReturnValueOnce(success("patch"))
    .mockReturnValueOnce(success(diff("src/catalog/cohere.ts")));
  await runRepairPublication("capture");
  expect(files.has("/tmp/gh-aw/aw-catalog-repair.patch")).toBe(false);
  expect(files.has("/tmp/gh-aw/aw-other.bundle")).toBe(false);
  expect(files.get("/tmp/repair-test/repair.patch")).toBe("patch");
  expect(git.mock.calls.every(([command]) => command === "git")).toBe(true);
  process.env.REPAIR_PATCH_SHA256 = repairPatchHash("patch");
  git
    .mockReturnValueOnce(success(""))
    .mockReturnValueOnce(success("changed patch"))
    .mockReturnValueOnce(success(diff("src/catalog/cohere.ts")));
  await expect(runRepairPublication("verify")).rejects.toThrow("changed after capture");
});

it("refuses to commit a tree changed by validation", async () => {
  artifact();
  git
    .mockReturnValueOnce(success("4".repeat(64)))
    .mockReturnValueOnce(success(""))
    .mockReturnValueOnce(success("3".repeat(40)));
  await expect(runRepairPublication("commit")).rejects.toThrow("tree changed");
  expect(git.mock.calls.some(([, args]) => Array.isArray(args) && args.includes("commit"))).toBe(
    false,
  );
});

it("binds validation and commit to the exact hydrated catalog inputs", async () => {
  const snapshot = "4".repeat(64);
  const changed = "5".repeat(64);
  git
    .mockReturnValueOnce(success(snapshot))
    .mockReturnValueOnce(success(""))
    .mockReturnValueOnce(success(snapshot));
  await runRepairPublication("validate");
  expect(files.get("/tmp/repair-test-output")).toBe(`snapshot_sha=${snapshot}\n`);
  files.clear();
  git
    .mockReturnValueOnce(success(snapshot))
    .mockReturnValueOnce(success(""))
    .mockReturnValueOnce(success(changed));
  await expect(runRepairPublication("validate")).rejects.toThrow("catalog changed during");
  expect(files.has("/tmp/repair-test-output")).toBe(false);
  artifact();
  git.mockReturnValueOnce(success(changed));
  await expect(runRepairPublication("commit")).rejects.toThrow("catalog changed after");
});

it("returns candidate failures to the agent and keeps exhausted timeouts operational", async () => {
  git.mockReturnValueOnce(success("4".repeat(64))).mockReturnValueOnce({ status: 75 });
  await expect(runRepairPublication("validate")).rejects.toThrow("(75)");
  expect(files.has("/tmp/repair-test-output")).toBe(false);
  git.mockReturnValueOnce(success("4".repeat(64))).mockReturnValueOnce({ status: 1 });
  await expect(runRepairPublication("validate")).rejects.toThrow("(1)");
  expect(files.get("/tmp/repair-test-output")).toBe("retry_with_agent=true\n");
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

it("runs the protected planner without allowing validation to set publication outputs", () => {
  git.mockReturnValueOnce(success(""));
  validateRepair();
  const [command, args, options] = git.mock.calls[0] ?? [];
  expect([command, args]).toEqual(["vp", ["node", "scripts/validate-changes.ts", "1".repeat(40)]]);
  expect(options.env).toMatchObject({
    REPAIR_BASE_SHA: "1".repeat(40),
    VITEST_MAX_WORKERS: "2",
  });
  expect(options.env).not.toHaveProperty("GITHUB_OUTPUT");
});

it("rejects a repair intent when the runner admitted no investigation", async () => {
  files.set("/tmp/repair-output.jsonl", JSON.stringify(repair));
  process.env.REPAIR_REQUIRED = "false";
  await expect(runRepairPublication("capture")).rejects.toThrow("runner-owned admission");
  expect(git).not.toHaveBeenCalled();
});

it("does not accept a killed or unavailable validation process", () => {
  process.env.VITEST_MAX_WORKERS = "12";
  git.mockReturnValueOnce({ status: null, signal: "SIGTERM" });
  expect(validateRepair).toThrow("Affected repair checks failed (SIGTERM)");
  expect(git.mock.calls[0]?.[2].env).toMatchObject({ VITEST_MAX_WORKERS: "2" });
  git.mockReturnValueOnce({ error: new Error("vp unavailable") });
  expect(validateRepair).toThrow("vp unavailable");
});
