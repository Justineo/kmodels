import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export class ValidationTestTimeout extends Error {}

export async function validateTests(args: string[], timeoutReport?: string): Promise<void> {
  if (timeoutReport !== undefined) await rm(timeoutReport, { force: true });
  const directory = await mkdtemp(join(tmpdir(), "kmodels-test-verification-"));
  const marker = join(directory, "timeout.txt");
  const command = ["test", ...args, "--reporter=./scripts/test-timeout-reporter.ts"];
  try {
    for (const attempt of [1, 2]) {
      await rm(marker, { force: true });
      const result = spawnSync("vp", command, {
        stdio: "inherit",
        env: { ...process.env, KMODELS_TEST_VERIFICATION_PATH: marker },
      });
      if (result.error !== undefined) throw result.error;
      if (result.status === 0) return;
      const timeout =
        result.status === 1 &&
        (await readFile(marker, "utf8").then(
          (value) => value.trim() === "test_timeout",
          (error: unknown) => {
            if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
            throw error;
          },
        ));
      if (!timeout)
        throw new Error(`vp ${command.join(" ")} failed (${result.signal ?? result.status})`);
      if (attempt === 1) {
        console.log(
          "::warning::Test bodies timed out. Retrying once with the same validation inputs.",
        );
        continue;
      }
      if (timeoutReport !== undefined) await writeFile(timeoutReport, "test_timeout\n");
      throw new ValidationTestTimeout("Test bodies timed out on both validation attempts");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await validateTests(process.argv.slice(2), process.env.KMODELS_GENERATED_VERIFICATION_PATH);
