import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sha256 } from "../src/catalog/io.ts";

const directory = process.env.DEPLOYMENT_RECEIPT_DIR;
if (!directory) throw new Error("Missing deployment receipt directory");
const runAttempt = Number(process.env.GITHUB_RUN_ATTEMPT ?? "1");
await mkdir(directory, { recursive: true });
await writeFile(
  join(directory, "deployment.json"),
  `${JSON.stringify(
    {
      run_id: process.env.GITHUB_RUN_ID ?? null,
      run_attempt: Number.isFinite(runAttempt) ? runAttempt : 1,
      revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      snapshot_sha256: sha256(await readFile("data/catalog-snapshot.json", "utf8")),
      deployed_at: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
);
