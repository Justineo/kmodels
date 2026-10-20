import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { loadRefreshExecution } from "../scripts/catalog-repair-evidence.ts";

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })));
});

async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "repair-evidence-"));
  directories.push(path);
  return path;
}

function mockGitHub(step: string | undefined, report = true) {
  return vi.fn(async (args: string[]): Promise<string> => {
    if (args[1] === "list")
      return JSON.stringify([
        {
          databaseId: 123,
          headSha: "a".repeat(40),
          url: "https://github.com/example/catalog/actions/runs/123",
          conclusion: step === undefined ? "success" : "failure",
          createdAt: "2026-10-07T00:00:00Z",
        },
      ]);
    if (args.includes("jobs"))
      return JSON.stringify({
        jobs: [{ steps: step === undefined ? [] : [{ name: step, conclusion: "failure" }] }],
      });
    if (args[0] === "api")
      return JSON.stringify({
        artifacts: report ? [{ name: "catalog-refresh-123", expired: false }] : [],
      });
    if (args[1] === "download") return "";
    if (args.includes("--log-failed")) return "Error: Pricing replay for ollama produced nothing";
    throw new Error(`Unexpected command: ${args.join(" ")}`);
  });
}

describe("repair execution evidence", () => {
  it("uses the latest completed main refresh report and includes post-collection failures", async () => {
    const path = await directory();
    const gh = mockGitHub("Verify generated catalog");
    const evidence = await loadRefreshExecution("example/catalog", path, gh);
    expect(gh.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining([
        "catalog.yml",
        "--branch",
        "main",
        "--status",
        "completed",
        "--limit",
        "1",
      ]),
    );
    expect(evidence).toMatchObject({
      repair_required: true,
      evidence_incomplete: false,
      failed_steps: ["Verify generated catalog"],
      report_path: join(path, "123/refresh-report.json"),
    });
    expect(await readFile(join(path, "refresh-failure.log"), "utf8")).toContain(
      "Pricing replay for ollama produced nothing",
    );
  });

  it("keeps setup failures incomplete without treating them as parser repairs", async () => {
    const evidence = await loadRefreshExecution(
      "example/catalog",
      await directory(),
      mockGitHub("Install dependencies", false),
    );
    expect(evidence).toMatchObject({ repair_required: false, evidence_incomplete: true });
    expect(evidence?.report_path).toBeUndefined();
  });

  it("still investigates collection failures before a report exists", async () => {
    const evidence = await loadRefreshExecution(
      "example/catalog",
      await directory(),
      mockGitHub("Collect official sources", false),
    );
    expect(evidence).toMatchObject({ repair_required: true, evidence_incomplete: true });
  });

  it("does not let failed-log access errors silently fall back to a healthy committed report", async () => {
    const responses = mockGitHub("Build generated catalog");
    const gh = async (args: string[]) => {
      if (args.includes("--log-failed")) throw new Error("GitHub unavailable");
      return responses(args);
    };
    await expect(loadRefreshExecution("example/catalog", await directory(), gh)).rejects.toThrow(
      "GitHub unavailable",
    );
  });

  it("does not request failure logs after a successful refresh", async () => {
    const gh = mockGitHub(undefined);
    const evidence = await loadRefreshExecution("example/catalog", await directory(), gh);
    expect(evidence).toMatchObject({ repair_required: false, evidence_incomplete: false });
    expect(gh.mock.calls.some(([args]) => args.includes("--log-failed"))).toBe(false);
  });

  it("starts repair for a failed replay even when the provider report is healthy", async () => {
    const path = await directory();
    const reportPath = join(path, "report.json");
    const executionPath = join(path, "execution.json");
    const outputPath = join(path, "outputs.jsonl");
    const contextPath = join(path, "context.md");
    const execution = await loadRefreshExecution(
      "example/catalog",
      path,
      mockGitHub("Verify generated catalog"),
    );
    await writeFile(
      reportPath,
      JSON.stringify({
        schema_version: 2,
        generated_at: "2026-10-07T00:00:00Z",
        providers: [],
      }),
    );
    await writeFile(executionPath, JSON.stringify(execution));
    await writeFile(outputPath, "");
    vi.stubEnv("KMODELS_REFRESH_REPORT_PATH", reportPath);
    vi.stubEnv("KMODELS_REFRESH_EXECUTION_PATH", executionPath);
    vi.stubEnv("KMODELS_REPAIR_ADMISSION", undefined);
    vi.stubEnv("KMODELS_CATALOG_REPAIR_CONTEXT", contextPath);
    vi.stubEnv("KMODELS_SEMANTIC_AUDIT_DIR", undefined);
    vi.stubEnv("GITHUB_STEP_SUMMARY", undefined);
    vi.stubEnv("GH_AW_SAFE_OUTPUTS", outputPath);
    vi.resetModules();
    await import("../scripts/catalog-repair.ts");
    expect(await readFile(outputPath, "utf8")).toBe("");
    expect(await readFile(contextPath, "utf8")).toContain("Verify generated catalog");
  });
});
