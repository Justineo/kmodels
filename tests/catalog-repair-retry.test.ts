import { expect, it } from "vite-plus/test";
import { loadRepairRetry, repairValidationFeedback } from "../scripts/catalog-repair-retry.ts";

const validation = "Validate against latest main";
const jobLog = [
  "commit_repair\tInstall the pinned toolchain\t2026-11-06T06:38:00Z setup detail",
  `commit_repair\t${validation}\t2026-11-06T06:39:20Z Validation: vp test related`,
  `commit_repair\t${validation}\t2026-11-06T06:42:45Z \u001b[31mAssertionError: expected 'bedrock-catalog-v48' to be 'bedrock-catalog-v47'\u001b[0m`,
].join("\n");

it("returns the failed check and assertion without including unrelated steps", () => {
  expect(repairValidationFeedback(jobLog, validation)).toBe(
    "Validation: vp test related\nAssertionError: expected 'bedrock-catalog-v48' to be 'bedrock-catalog-v47'",
  );
  expect(() => repairValidationFeedback(jobLog, "Install the pinned toolchain")).toThrow(
    "did not report an affected check",
  );
});

it("loads both artifacts only for a main repair that passed admission and failed validation", async () => {
  const calls: string[][] = [];
  const run = {
    path: ".github/workflows/catalog-repair.lock.yml",
    head_branch: "main",
    head_sha: "1".repeat(40),
    html_url: "https://github.com/Justineo/kmodels/actions/runs/42174074359",
    status: "completed",
    conclusion: "failure",
    run_attempt: 1,
  };
  const jobs = ["agent", "detection", "safe_outputs", "commit_repair"].map((name, i) => ({
    databaseId: i + 1,
    name,
    conclusion: name === "commit_repair" ? "failure" : "success",
    steps: name === "commit_repair" ? [{ name: validation, conclusion: "failure" }] : [],
  }));
  const detection = jobs.find(({ name }) => name === "detection");
  const publication = jobs.find(({ name }) => name === "commit_repair");
  if (detection === undefined || publication === undefined) throw new Error("Missing fixture job");
  const gh = async (args: string[]) => {
    calls.push(args);
    if (args[0] === "api")
      return JSON.stringify(args[1]?.includes("/artifacts?") ? { artifacts: [] } : run);
    if (args.includes("--json")) return JSON.stringify({ jobs });
    if (args.includes("--log-failed")) return jobLog;
    return "";
  };
  const load = () => loadRepairRetry("Justineo/kmodels", "42174074359", "/retry", gh);
  expect(await load()).toMatchObject({
    run,
    step: validation,
    feedback: expect.stringContaining("v48"),
  });
  expect(calls.filter((args) => args[1] === "download").map((args) => args.at(-1))).toEqual([
    "/retry/admitted-catalog-repair",
    "/retry/catalog-repair-investigation",
  ]);

  calls.length = 0;
  detection.conclusion = "failure";
  await expect(load()).rejects.toThrow("rejected by publication validation");
  expect(calls.some((args) => args[1] === "download")).toBe(false);
  detection.conclusion = "success";
  publication.steps = [{ name: "Deploy the repaired site", conclusion: "failure" }];
  await expect(load()).rejects.toThrow("rejected by publication validation");
  run.head_branch = "untrusted";
  await expect(load()).rejects.toThrow();
});
