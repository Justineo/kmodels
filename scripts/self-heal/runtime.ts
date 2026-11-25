import { spawnSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

/** 128 MiB cap so >1 MiB fixture/patch diffs never hit Node's default 1 MiB spawnSync buffer. */
export const SELF_HEAL_MAX_BUFFER = 128 * 1024 * 1024;

const SENSITIVE_ENV_NAME_RE =
  /(?:^|_)(?:API_KEY|SECRET|TOKEN|PASSWORD|CREDENTIALS|PRIVATE_KEY)(?:_|$)|^(?:AWS_ACCESS_KEY_ID|GOOGLE_SERVICE_ACCOUNT_JSON|DATABRICKS_HOST)$/i;

function isInsidePath(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"));
}

/**
 * Return a clean copy of `baseEnv` with all API keys, tokens, and cloud secrets removed.
 * Every subprocess that executes untrusted candidate code or agent tools MUST use this env.
 */
export function sanitizedUntrustedEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value === undefined || SENSITIVE_ENV_NAME_RE.test(key)) continue;
    clean[key] = value;
  }
  return clean;
}

/**
 * Return a private directory strictly outside `/tmp`, `$TMPDIR`, and the repository checkout.
 * Codex CLI `--sandbox workspace-write` grants write access to `[workdir, /tmp, $TMPDIR]`,
 * so trusted parent state (usage receipts, prompts, model catalogs, cached `bin/codex`) MUST
 * live outside those writable roots and outside the child's private `TMPDIR`.
 */
export function selfHealPrivateBaseDir(subdir: string, cwd?: string): string {
  const blockedRoots = ["/tmp", "/private/tmp", tmpdir()];
  if (cwd !== undefined) blockedRoots.push(cwd);
  const runnerTemp = process.env.RUNNER_TEMP?.trim();
  const baseDir =
    runnerTemp && !blockedRoots.some((root) => isInsidePath(root, runnerTemp))
      ? join(resolve(runnerTemp), "kmodels-self-heal-private")
      : join(homedir(), ".cache", "kmodels-self-heal");
  return join(baseDir, subdir);
}

export function assertOutsideRepo(cwd: string, targetPath: string, label: string): void {
  if (isInsidePath(cwd, targetPath)) {
    throw new Error(`${label} must live outside the git repository checkout: ${targetPath}`);
  }
}

export function runGit(args: readonly string[], cwd: string): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: SELF_HEAL_MAX_BUFFER,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
  return result.stdout;
}

export function parseCliFlag(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

export function parsePositiveInt(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
