import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  loadRefreshExecution,
  retryArtifactDownloads,
} from "../scripts/catalog-repair-evidence.ts";

import { digest, emptyState } from "../scripts/repair/state.ts";

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

function mockGitHub(
  step: string | undefined,
  report = true,
  verification?: string,
  artifact = "catalog-refresh-123-attempt-2",
) {
  return vi.fn(async (args: string[]): Promise<string> => {
    if (args[1] === "list")
      return JSON.stringify([
        {
          databaseId: 123,
          attempt: 2,
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
        artifacts: report ? [{ name: artifact, expired: false }] : [],
      });
    if (args[1] === "download") {
      const target = args[args.indexOf("--dir") + 1];
      if (verification !== undefined && target !== undefined) {
        await mkdir(target, { recursive: true });
        await writeFile(join(target, "generated-verification.txt"), verification);
      }
      return "";
    }
    if (args.includes("--log-failed")) return "Error: Pricing replay for ollama produced nothing";
    throw new Error(`Unexpected command: ${args.join(" ")}`);
  });
}

describe("repair execution evidence", () => {
  it("retries a throttled download in isolation and merges only a completed artifact", async () => {
    const dest = await directory();
    await writeFile(join(dest, "existing"), "earlier artifact");
    const wait = vi.fn(async () => {});
    const gh = vi.fn(async (args: string[]) => {
      expect(args.slice(0, -1)).toEqual(["run", "download", "123", "--name", "attempt-2", "--dir"]);
      const stage = args.at(-1);
      if (!stage) throw new Error("Missing stage");
      if (wait.mock.calls.length === 0) {
        await writeFile(join(stage, "partial"), "incomplete");
        throw new Error("HTTP 503: Egress is over the account limit");
      }
      await writeFile(join(stage, "report"), "complete");
      return "";
    });
    await retryArtifactDownloads(
      gh,
      wait,
    )(["run", "download", "123", "--name", "attempt-2", "--dir", dest]);
    expect(wait).toHaveBeenCalledOnce();
    expect(await readFile(join(dest, "report"), "utf8")).toBe("complete");
    expect(await readFile(join(dest, "existing"), "utf8")).toBe("earlier artifact");
    await expect(readFile(join(dest, "partial"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it.each([
    [403, 1],
    [404, 1],
    [503, 3],
  ])("fails closed on HTTP %i after %i attempts", async (status, attempts) => {
    const dest = await directory();
    const gh = vi.fn(async () => {
      throw new Error(`HTTP ${status} (https://blob.example/archive?sig=secret)`);
    });
    await expect(
      retryArtifactDownloads(gh, async () => {})(["run", "download", "--dir", dest]),
    ).rejects.toThrow(`HTTP ${status} ([download URL])`);
    expect(gh).toHaveBeenCalledTimes(attempts);
  });
  it("investigates shard assembly failures before a combined report exists", async () => {
    const evidence = await loadRefreshExecution(
      "example/catalog",
      await directory(),
      mockGitHub("Assemble collected providers", false),
    );
    expect(evidence).toMatchObject({ repair_required: true, evidence_incomplete: true });
  });
  it.each([true, false])(
    "requires timeout evidence from every failed generated shard (second marker available: %s)",
    async (both) => {
      const base = mockGitHub("Verify generated catalog shard 1", true, "test_timeout\n");
      const evidence = await loadRefreshExecution(
        "example/catalog",
        await directory(),
        async (args) => {
          if (args.includes("jobs"))
            return JSON.stringify({
              jobs: [1, 2].map((shard) => ({
                steps: [{ name: `Verify generated catalog shard ${shard}`, conclusion: "failure" }],
              })),
            });
          if (args[0] === "api")
            return JSON.stringify({
              artifacts: [
                "catalog-refresh-123-attempt-2",
                "catalog-verification-123-attempt-2-shard-1",
                both
                  ? "catalog-verification-123-attempt-2-shard-2"
                  : "catalog-verification-123-attempt-1-shard-2",
              ].map((name) => ({ name, expired: false })),
            });
          return base(args);
        },
      );
      expect(evidence?.verification_failure).toBe(both ? "test_timeout" : undefined);
      expect(evidence?.repair_required).toBe(!both);
    },
  );
  it.each([1, 2])(
    "uses separate verification evidence only from the selected attempt: %s",
    async (attempt) => {
      const existing = mockGitHub("Verify generated catalog");
      const gh = vi.fn(async (args: string[]) => {
        if (args[0] === "api")
          return JSON.stringify({
            artifacts: [
              { name: "catalog-refresh-123-attempt-2", expired: false },
              { name: `catalog-verification-123-attempt-${attempt}`, expired: false },
            ],
          });
        if (
          args[1] === "download" &&
          args.includes(`catalog-verification-123-attempt-${attempt}`)
        ) {
          const target = args[args.indexOf("--dir") + 1];
          if (target === undefined) throw new Error("Missing evidence directory");
          await mkdir(target, { recursive: true });
          await writeFile(join(target, "generated-verification.txt"), "test_timeout\n");
          return "";
        }
        return existing(args);
      });
      const evidence = await loadRefreshExecution("example/catalog", await directory(), gh);
      expect(evidence?.verification_failure).toBe(attempt === 2 ? "test_timeout" : undefined);
      expect(evidence?.repair_required).toBe(attempt !== 2);
    },
  );
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
      report_path: join(path, "catalog-refresh-123-attempt-2/refresh-report.json"),
    });
    expect(gh.mock.calls[1]?.[0]).toEqual(expect.arrayContaining(["--attempt", "2"]));
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

  it("does not let failed-log access errors silently fall back to a healthy accepted report", async () => {
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

  it("ignores a timeout artifact from another workflow attempt", async () => {
    const gh = mockGitHub(
      "Verify generated catalog",
      true,
      "test_timeout\n",
      "catalog-refresh-123-attempt-1",
    );
    const evidence = await loadRefreshExecution("example/catalog", await directory(), gh);
    expect(evidence).toMatchObject({ repair_required: true, evidence_incomplete: true });
    expect(evidence?.verification_failure).toBeUndefined();
    expect(gh.mock.calls.some(([args]) => args.includes("download"))).toBe(false);
  });

  it("does not substitute an unscoped report for the selected workflow attempt", async () => {
    const gh = mockGitHub("Verify generated catalog", true, undefined, "catalog-refresh-123");
    const path = await directory();
    const evidence = await loadRefreshExecution("example/catalog", path, gh);
    expect(evidence).toMatchObject({
      repair_required: true,
      evidence_incomplete: true,
    });
    expect(evidence?.report_path).toBeUndefined();
    expect(gh.mock.calls.some(([args]) => args.includes("download"))).toBe(false);
  });

  it("leaves an evidenced removal on cooldown and surfaces any newly unavailable evidence", async () => {
    const path = await directory();
    const reportPath = join(path, "report.json");
    const ledger = join(path, "state.json");
    const output = join(path, "outputs.jsonl");
    const state = emptyState();
    const now = new Date().toISOString();
    state.tasks.push({
      id: "openai/openai-pricing",
      provider: "openai",
      trigger: "source_location_change",
      fingerprint: digest("snapshot"),
      status: "blocked",
      reason: "Await restored source",
      next_action: "Recheck the owned URL",
      attempts: 1,
      first_seen: now,
      last_seen: now,
      retry_at: new Date(Date.now() + 86_400_000).toISOString(),
      source_wait_reason_hash: digest("HTTP 404"),
      coverage: [],
      source_versions: {},
    });
    await writeFile(ledger, JSON.stringify(state));
    vi.stubEnv("KMODELS_REFRESH_REPORT_PATH", reportPath);
    vi.stubEnv("KMODELS_MAINTENANCE_STATE", ledger);
    vi.stubEnv("KMODELS_REPAIR_ADMISSION", undefined);
    vi.stubEnv("KMODELS_SEMANTIC_AUDIT_DIR", undefined);
    vi.stubEnv("KMODELS_REFRESH_EXECUTION_PATH", undefined);
    vi.stubEnv("GH_AW_SAFE_OUTPUTS", output);
    const run = async (message: string, sibling = false) => {
      const sources = [
        { source_id: "openai-pricing", outcome: "fetch_failed", message, consecutive_failures: 3 },
      ];
      if (sibling)
        sources.push({
          source_id: "openai-api",
          outcome: "fetch_failed",
          message: "HTTP 503",
          consecutive_failures: 1,
        });
      await writeFile(
        reportPath,
        JSON.stringify({
          schema_version: 2,
          generated_at: now,
          providers: [
            { provider_id: "openai", signals: [], attempt: { outcome: "accepted", sources } },
          ],
        }),
      );
      await writeFile(output, "");
      vi.resetModules();
      await import("../scripts/catalog-repair.ts");
      return JSON.parse(await readFile(output, "utf8"));
    };
    expect(await run("HTTP 404")).toMatchObject({
      type: "noop",
      message: expect.stringContaining("1 deferred"),
    });
    expect(await run("HTTP 410")).toMatchObject({ type: "report_incomplete" });
    expect(await run("HTTP 404", true)).toMatchObject({ type: "report_incomplete" });
  });

  it("requires the workflow attempt instead of guessing the first attempt", async () => {
    const gh = mockGitHub(undefined);
    gh.mockImplementationOnce(async () =>
      JSON.stringify([
        {
          databaseId: 123,
          headSha: "a".repeat(40),
          url: "https://github.com/example/catalog/actions/runs/123",
          conclusion: "success",
          createdAt: "2026-10-07T00:00:00Z",
        },
      ]),
    );
    await expect(loadRefreshExecution("example/catalog", await directory(), gh)).rejects.toThrow(
      /attempt/,
    );
  });

  it.each([
    { verification: undefined, repair: true },
    { verification: "invalid\n", repair: true },
    { verification: "test_timeout\n", repair: false },
  ])(
    "starts repair for a failed replay unless verification only timed out ($verification)",
    async ({ verification, repair }) => {
      const path = await directory();
      const reportPath = join(path, "report.json");
      const executionPath = join(path, "execution.json");
      const outputPath = join(path, "outputs.jsonl");
      const contextPath = join(path, "context.md");
      const execution = await loadRefreshExecution(
        "example/catalog",
        path,
        mockGitHub("Verify generated catalog", true, verification),
      );
      expect(execution).toMatchObject({ repair_required: repair, evidence_incomplete: !repair });
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
      const outcome = await readFile(outputPath, "utf8");
      const context = await readFile(contextPath, "utf8");
      expect(context).toContain("Verify generated catalog");
      if (repair) expect(outcome).toBe("");
      else {
        expect(context).toContain("timed out on both attempts");
        expect(JSON.parse(outcome)).toMatchObject({
          type: "report_incomplete",
          reason: expect.stringContaining("timed out on both attempts"),
        });
      }
    },
  );
});
