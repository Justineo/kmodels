import { execFileSync } from "node:child_process";
import { appendFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const runSchema = z.object({
  databaseId: z.number().int().positive(),
  attempt: z.number().int().positive(),
  headSha: z.string().regex(/^[0-9a-f]{40}$/),
  url: z.string().url(),
  conclusion: z.string(),
  createdAt: z.string().datetime(),
});
const jobsSchema = z.object({
  jobs: z.array(
    z.object({
      steps: z.array(z.object({ name: z.string(), conclusion: z.string() })),
    }),
  ),
});
export const artifactsSchema = z.object({
  artifacts: z.array(z.object({ name: z.string(), expired: z.boolean() })),
});
export const refreshExecutionSchema = z.object({
  run: runSchema,
  failed_steps: z.array(z.string()),
  repair_required: z.boolean(),
  evidence_incomplete: z.boolean(),
  verification_failure: z.literal("test_timeout").optional(),
  report_path: z.string().optional(),
  log_path: z.string().optional(),
  reproduction_directory: z.string().optional(),
});

export type GitHubCommand = (args: string[], timeout?: number) => Promise<string>;
const ghCommand: GitHubCommand = async (args, timeout = 60_000) =>
  execFileSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 24 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    timeout,
  });

export function retryArtifactDownloads(
  gh: GitHubCommand,
  wait: (ms: number) => Promise<void> = delay,
): GitHubCommand {
  return async (args, timeout) => {
    if (args[0] !== "run" || args[1] !== "download") return gh(args, timeout);
    const index = args.indexOf("--dir");
    const destination = args[index + 1];
    if (index < 0 || !destination) throw new Error("Missing artifact destination");
    const parent = dirname(destination);
    await mkdir(parent, { recursive: true });
    for (let attempt = 1; ; attempt++) {
      const stage = await mkdtemp(join(parent, ".gh-download-"));
      try {
        const command = args.with(index + 1, stage);
        let output: string;
        try {
          output = await gh(command, timeout);
        } catch (error) {
          // gh errors can contain a signed blob URL. Keep its query out of Actions logs.
          const message = String(error).replace(/https?:\/\/[^\s)]+/g, "[download URL]");
          if (attempt >= 3 || !/\bHTTP (?:429|500|502|503|504)\b/i.test(message))
            throw new Error(message);
          await wait(5_000 * attempt);
          continue;
        }
        await cp(stage, destination, { recursive: true });
        return output;
      } finally {
        await rm(stage, { recursive: true, force: true });
      }
    }
  };
}

export const github = retryArtifactDownloads(ghCommand);

// Download evidence outside the checkout; never install a failed candidate as accepted data.
export async function loadRefreshExecution(
  repository: string,
  directory: string,
  gh: GitHubCommand = github,
): Promise<z.infer<typeof refreshExecutionSchema> | undefined> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error("Invalid repository");
  await mkdir(directory, { recursive: true });
  const [run] = z
    .array(runSchema)
    .parse(
      JSON.parse(
        await gh([
          "run",
          "list",
          "--repo",
          repository,
          "--workflow",
          "catalog.yml",
          "--branch",
          "main",
          "--status",
          "completed",
          "--limit",
          "1",
          "--json",
          "databaseId,attempt,headSha,url,conclusion,createdAt",
        ]),
      ),
    );
  if (run === undefined) return undefined;
  const runId = String(run.databaseId);
  const view = ["run", "view", runId, "--repo", repository, "--attempt", String(run.attempt)];
  const { jobs } = jobsSchema.parse(JSON.parse(await gh([...view, "--json", "jobs"])));
  const failedSteps = jobs.flatMap(({ steps }) =>
    steps
      .filter(({ conclusion }) => ["failure", "timed_out", "cancelled"].includes(conclusion))
      .map(({ name }) => name),
  );
  const { artifacts } = artifactsSchema.parse(
    JSON.parse(
      await gh(["api", `repos/${repository}/actions/runs/${runId}/artifacts?per_page=100`]),
    ),
  );
  const reportArtifact = `catalog-refresh-${runId}-attempt-${run.attempt}`;
  const available = new Set(artifacts.filter(({ expired }) => !expired).map(({ name }) => name));
  const verificationArtifact = `catalog-verification-${runId}-attempt-${run.attempt}`;
  let verificationFailure: "test_timeout" | undefined;
  let reportPath: string | undefined;
  if (available.has(reportArtifact)) {
    const reportDirectory = join(directory, reportArtifact);
    await gh([
      "run",
      "download",
      runId,
      "--repo",
      repository,
      "--name",
      reportArtifact,
      "--dir",
      reportDirectory,
    ]);
    reportPath = join(reportDirectory, "refresh-report.json");
    if (run.conclusion === "failure" && failedSteps.includes("Verify generated catalog")) {
      if (available.has(verificationArtifact))
        await gh([
          "run",
          "download",
          runId,
          "--repo",
          repository,
          "--name",
          verificationArtifact,
          "--dir",
          reportDirectory,
        ]);
      const result = await readFile(
        join(reportDirectory, "generated-verification.txt"),
        "utf8",
      ).catch((error: unknown) => {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return "";
        throw error;
      });
      if (result === "test_timeout\n") verificationFailure = "test_timeout";
    }
  }
  const repairRequired = failedSteps.some(
    (name) =>
      name === "Collect official sources" ||
      name === "Assemble collected providers" ||
      name === "Build generated catalog" ||
      (name === "Verify generated catalog" && verificationFailure === undefined),
  );
  let logPath: string | undefined;
  if (run.conclusion === "failure") {
    const log = await gh([...view, "--log-failed"]);
    if (log.trim() === "") throw new Error("Failed refresh has no readable failure log");
    logPath = join(directory, "refresh-failure.log");
    await writeFile(logPath, boundedFailureLog(log));
  }
  const reproductionDirectory = join(directory, "reproduction");
  // Exact attempt binding is mandatory; raw authenticated response bodies are never uploaded.
  const evidenceNames = [...available].filter((name) =>
    name.startsWith(`catalog-public-evidence-${runId}-attempt-${run.attempt}-`),
  );
  const planName = `catalog-plan-${runId}-attempt-${run.attempt}`;
  if (failedSteps.includes("Assemble collected providers") && available.has(planName)) {
    await gh([
      "run",
      "download",
      runId,
      "--repo",
      repository,
      "--name",
      planName,
      "--dir",
      join(reproductionDirectory, "plan"),
    ]);
    const planText = await readFile(join(reproductionDirectory, "plan", "plan.json"), "utf8");
    const { parseCollectionPlan, collectionPlanId } =
      await import("../src/catalog/collection-shards.ts");
    const plan = parseCollectionPlan(JSON.parse(planText));
    if (plan.revision !== run.headSha)
      throw new Error("Refresh reproduction plan has another revision");
    for (const name of [...available].filter((name) =>
      name.startsWith(`catalog-shard-${runId}-${collectionPlanId(plan)}-`),
    ))
      await gh(
        [
          "run",
          "download",
          runId,
          "--repo",
          repository,
          "--name",
          name,
          "--dir",
          join(reproductionDirectory, "shards"),
        ],
        180_000,
      );
  }
  for (const name of evidenceNames)
    await gh(
      [
        "run",
        "download",
        runId,
        "--repo",
        repository,
        "--name",
        name,
        "--dir",
        join(reproductionDirectory, "public", name),
      ],
      180_000,
    );
  return {
    run,
    failed_steps: failedSteps,
    repair_required: repairRequired,
    evidence_incomplete:
      reportPath === undefined ||
      verificationFailure !== undefined ||
      !["success", "failure"].includes(run.conclusion) ||
      (run.conclusion === "failure" && !repairRequired),
    ...(verificationFailure === undefined ? {} : { verification_failure: verificationFailure }),
    ...(reportPath === undefined ? {} : { report_path: reportPath }),
    ...(logPath === undefined ? {} : { log_path: logPath }),
    ...(evidenceNames.length === 0 && !available.has(planName)
      ? {}
      : { reproduction_directory: reproductionDirectory }),
  };
}

export function boundedFailureLog(log: string): string {
  if (log.length <= 65_536) return log;
  const error = log.search(/(?:##\[error\]|FATAL ERROR|Error:|AssertionError)/);
  const start = Math.max(0, error - 4096);
  return `${log.slice(start, start + 24_000)}\n[Log middle omitted; first error context and tail retained]\n${log.slice(-40_000)}`;
}

async function main(): Promise<void> {
  const repository = process.env.GITHUB_REPOSITORY;
  const environmentPath = process.env.GITHUB_ENV;
  if (repository === undefined || environmentPath === undefined)
    throw new Error("Repair evidence requires a GitHub Actions repository and environment file");
  const directory = "/tmp/gh-aw/agent/refresh-evidence";
  const execution = await loadRefreshExecution(repository, directory);
  if (execution === undefined) return;
  const path = join(directory, "execution.json");
  await writeFile(path, JSON.stringify(execution));
  await appendFile(environmentPath, `KMODELS_REFRESH_EXECUTION_PATH=${path}\n`);
  if (execution.report_path !== undefined)
    await appendFile(environmentPath, `KMODELS_REFRESH_REPORT_PATH=${execution.report_path}\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main();
