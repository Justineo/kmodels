import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frameworkDirectory = "/tmp/gh-aw";
const maximumPatchBytes = 4 * 1024 * 1024;

export type RepairOutcome =
  | { type: "noop"; message: string }
  | { type: "commit_repair"; title: string; body: string };

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Accept both the raw safe-output journal and the framework's collected output. */
export function parseRepairOutcome(output: string): RepairOutcome {
  let lines: unknown[];
  try {
    const value: unknown = JSON.parse(output);
    lines = [value];
  } catch {
    lines = output
      .split(/\r?\n/)
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line));
  }
  const first = lines[0];
  const items =
    lines.length === 1 && object(first) && Array.isArray(first.items) ? first.items : lines;
  for (const item of items) {
    if (!object(item) || typeof item.type !== "string")
      throw new Error("Invalid catalog repair outcome");
    if (["missing_data", "missing_tool", "report_incomplete"].includes(item.type)) {
      const reason = typeof item.reason === "string" ? item.reason.trim().slice(0, 1000) : "";
      throw new Error(
        `Catalog repair incomplete (${item.type})${reason === "" ? "" : `: ${JSON.stringify(reason)}`}`,
      );
    }
    if (!["noop", "commit_repair"].includes(item.type))
      throw new Error(`Catalog repair cannot emit ${item.type}`);
  }
  if (items.length !== 1)
    throw new Error("Catalog repair must report exactly one completed outcome");
  const item: unknown = items[0];
  if (!object(item)) throw new Error("Invalid catalog repair outcome");
  if (item.type === "noop" && typeof item.message === "string" && item.message.trim())
    return { type: "noop", message: item.message };
  if (
    item.type === "commit_repair" &&
    typeof item.title === "string" &&
    item.title.trim() &&
    item.title.length <= 256 &&
    !/[\r\n]/.test(item.title) &&
    !item.title.includes("\0") &&
    typeof item.body === "string" &&
    item.body.trim() &&
    item.body.length <= 30_000 &&
    !item.body.includes("\0")
  )
    return { type: "commit_repair", title: item.title.trim(), body: item.body };
  throw new Error("Catalog repair outcome is missing its explanation");
}

/** Inspect Git's NUL-delimited raw diff, including both sides of deletions and mode changes. */
export function assertRepairChanges(raw: string, patch: string): void {
  if (patch === "" || Buffer.byteLength(patch) > maximumPatchBytes)
    throw new Error("Catalog repair patch is empty or exceeds 4 MiB");
  const entries = raw.split("\0");
  if (entries.pop() !== "" || entries.length === 0 || entries.length % 2 !== 0)
    throw new Error("Invalid catalog repair diff");
  if (entries.length / 2 > 100) throw new Error("Catalog repair exceeds 100 changed files");
  for (let index = 0; index < entries.length; index += 2) {
    const header = entries[index];
    const path = entries[index + 1];
    if (
      header === undefined ||
      !/^:(?:100644|000000) (?:100644|000000) [a-f0-9]{40} [a-f0-9]{40} [AMD]$/.test(header)
    )
      throw new Error("Catalog repair cannot change executable, symlink, or submodule modes");
    if (
      path === undefined ||
      path.split("").some((character) => character.charCodeAt(0) < 32 || character === "\\") ||
      path.split("/").some((part) => part === "" || part === ".." || part.startsWith(".")) ||
      !/^(?:src\/catalog\/[^/]+\.ts|tests\/[^/]+(?:\.test|-fixtures?)\.ts|tests\/fixtures\/.+|docs\/providers\/[^/]+\.md|docs\/semantic-audit-decisions\.json)$/.test(
        path,
      ) ||
      /^(?:src\/catalog|tests)\/(?:catalog-repair|public-evidence)(?:[.-]|$)/.test(path)
    )
      throw new Error(`Catalog repair cannot modify ${path ?? "an invalid path"}`);
  }
  // Numeric manifest limits are operator-reviewed policy, not an automatic repair knob.
  // Compare changed limit declarations conservatively, including deletion and expressions.
  const manifestPatch = patch
    .split(/^diff --git /m)
    .find((part) => part.startsWith("a/src/catalog/manifests.ts b/src/catalog/manifests.ts\n"));
  if (manifestPatch !== undefined) {
    const limits = (prefix: string) =>
      manifestPatch
        .split("\n")
        .filter((line) => line.startsWith(prefix) && !line.startsWith(prefix.repeat(3)))
        .flatMap((line) =>
          [...line.matchAll(/\b(?:min|max)[A-Z]\w*\s*:\s*[^,}\n]+/g)].map(([value]) =>
            value.trim(),
          ),
        )
        .sort();
    if (JSON.stringify(limits("-")) !== JSON.stringify(limits("+")))
      throw new Error(
        "Catalog repair cannot change manifest limits; repair extraction with the existing guards or report the required operator-reviewed contract change.",
      );
  }
}

export function repairPatchHash(patch: string): string {
  return createHash("sha256").update(patch).digest("hex");
}

export function validateRepair(): void {
  // The validation child must not write publication step outputs.
  const { GITHUB_OUTPUT: _output, ...env } = process.env;
  const result = spawnSync("vp", ["node", "scripts/validate-changes.ts", baseSha()], {
    stdio: "inherit",
    env: {
      ...env,
      VITEST_MAX_WORKERS: "2",
    },
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0)
    throw new Error(`Affected repair checks failed (${result.signal ?? result.status})`);
}

function environment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function git(arguments_: string[], overrides?: NodeJS.ProcessEnv): string {
  const result = spawnSync("git", arguments_, {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, ...overrides, GIT_TERMINAL_PROMPT: "0" },
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0)
    throw new Error(result.stderr.trim() || "Catalog repair Git operation failed");
  return result.stdout;
}

function baseSha(): string {
  const sha = process.env.REPAIR_BASE_SHA ?? environment("GITHUB_SHA");
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Invalid catalog repair base SHA");
  return sha;
}

function stagedPatch(base: string, overrides?: NodeJS.ProcessEnv): string {
  return git(
    [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--binary",
      "--full-index",
      "--no-renames",
      "--cached",
      base,
    ],
    overrides,
  );
}

function admitStagedPatch(base: string, patch: string, overrides?: NodeJS.ProcessEnv): void {
  assertRepairChanges(
    git(["diff", "--raw", "--no-abbrev", "--no-renames", "-z", "--cached", base], overrides),
    patch,
  );
}

export async function workingTreePatchHash(): Promise<string> {
  const base = process.env.REPAIR_BASE_SHA === undefined ? "HEAD" : baseSha();
  const directory = await mkdtemp(join(tmpdir(), "kmodels-repair-check-"));
  try {
    const objects = join(directory, "objects");
    await mkdir(objects);
    const overrides = {
      GIT_INDEX_FILE: join(directory, "index"),
      GIT_OBJECT_DIRECTORY: objects,
      GIT_ALTERNATE_OBJECT_DIRECTORIES: git([
        "rev-parse",
        "--path-format=absolute",
        "--git-path",
        "objects",
      ]).trim(),
    };
    git(["read-tree", base], overrides);
    git(["add", "--all"], overrides);
    const patch = stagedPatch(base, overrides);
    admitStagedPatch(base, patch, overrides);
    return repairPatchHash(patch);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function output(name: string, value: string): Promise<void> {
  const path = process.env.GITHUB_OUTPUT;
  if (path !== undefined) await appendFile(path, `${name}=${value}\n`);
}

async function publication() {
  const directory = environment("REPAIR_ARTIFACT_DIR");
  const metadata = await readFile(join(directory, "repair.json"), "utf8");
  const record: unknown = JSON.parse(metadata);
  const base = baseSha();
  if (!object(record) || record.base_sha !== base || typeof record.patch_sha256 !== "string")
    throw new Error("Catalog repair artifact has an invalid validation record");
  const outcome = parseRepairOutcome(metadata);
  if (outcome.type !== "commit_repair")
    throw new Error("Catalog repair publication requires a repair intent");
  const patch = await readFile(join(directory, "repair.patch"), "utf8");
  if (repairPatchHash(patch) !== record.patch_sha256)
    throw new Error("Catalog repair artifact does not match the validated patch");
  return { outcome, patch, base };
}

export async function runRepairPublication(operation: string | undefined): Promise<void> {
  switch (operation) {
    case "check-patch": {
      await workingTreePatchHash();
      break;
    }
    case "validate": {
      validateRepair();
      break;
    }
    case "capture": {
      const outcome = parseRepairOutcome(await readFile(environment("GH_AW_SAFE_OUTPUTS"), "utf8"));
      const required = environment("REPAIR_REQUIRED");
      if (!["true", "false"].includes(required))
        throw new Error("Invalid repair admission decision");
      if (outcome.type === "commit_repair" && required !== "true")
        throw new Error("Catalog repair publication requires runner-owned admission");
      if (outcome.type === "noop" && required === "true") {
        const review = spawnSync(
          "vp",
          ["node", join(environment("RUNNER_TEMP"), "catalog-repair-review.ts"), "check-no-defect"],
          { stdio: "inherit" },
        );
        if (review.error !== undefined) throw review.error;
        if (review.status !== 0)
          throw new Error(
            "A no-op cannot complete admitted work without independently checked no-defect evidence for every candidate",
          );
      }
      git(["add", "--all"]);
      const base = baseSha();
      const patch = stagedPatch(base);
      for (const name of await readdir(frameworkDirectory)) {
        if (/^aw-.*\.(?:patch|bundle)$/.test(name))
          await rm(join(frameworkDirectory, name), { force: true });
      }
      if (outcome.type === "noop") {
        if (patch !== "") throw new Error("Catalog repair no-op contains code changes");
      } else {
        admitStagedPatch(base, patch);
        const patchHash = repairPatchHash(patch);
        const directory = environment("REPAIR_ARTIFACT_DIR");
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, "repair.patch"), patch);
        await writeFile(
          join(directory, "repair.json"),
          JSON.stringify({
            ...outcome,
            base_sha: base,
            patch_sha256: patchHash,
          }),
        );
        await output("patch_sha256", patchHash);
      }
      await output("outcome", outcome.type);
      break;
    }
    case "verify": {
      const { patch: admitted, base } = await publication();
      git(["add", "--all"]);
      const patch = stagedPatch(base);
      admitStagedPatch(base, patch);
      if (repairPatchHash(patch) !== environment("REPAIR_PATCH_SHA256") || admitted !== patch)
        throw new Error("Catalog repair changed after capture");
      break;
    }
    case "apply":
    case "retry-apply": {
      const { base } = await publication();
      if (operation === "retry-apply") {
        if (git(["status", "--porcelain"]).trim() !== "")
          throw new Error("Catalog repair retry requires a clean publication checkout");
        git(["fetch", "--no-tags", "origin", "main"]);
        git(["merge-base", "--is-ancestor", base, "FETCH_HEAD"]);
        git(["reset", "--hard", "FETCH_HEAD"]);
      }
      git(["merge-base", "--is-ancestor", base, "HEAD"]);
      git(["apply", "--3way", "--index", join(environment("REPAIR_ARTIFACT_DIR"), "repair.patch")]);
      admitStagedPatch("HEAD", stagedPatch("HEAD"));
      await output("tree_sha", git(["write-tree"]).trim());
      break;
    }
    case "commit": {
      const { outcome } = await publication();
      git(["add", "--all"]);
      if (git(["write-tree"]).trim() !== environment("REPAIR_TREE_SHA"))
        throw new Error("Catalog repair publication tree changed during validation");
      admitStagedPatch("HEAD", stagedPatch("HEAD"));
      const runUrl = `${environment("GITHUB_SERVER_URL")}/${environment("GITHUB_REPOSITORY")}/actions/runs/${environment("GITHUB_RUN_ID")}`;
      git([
        "-c",
        "user.name=github-actions[bot]",
        "-c",
        "user.email=41898282+github-actions[bot]@users.noreply.github.com",
        "commit",
        "-m",
        outcome.title,
        "-m",
        outcome.body,
        "-m",
        `Kmodels-Repair-Run: ${runUrl}`,
      ]);
      break;
    }
    case "push": {
      if (process.env.GH_AW_SAFE_OUTPUTS_STAGED === "true")
        throw new Error("Catalog repair publication is disabled in staged mode");
      const server = environment("GITHUB_SERVER_URL");
      const authorization = Buffer.from(`x-access-token:${environment("GH_TOKEN")}`).toString(
        "base64",
      );
      try {
        git([
          "-c",
          `http.${server}/.extraheader=AUTHORIZATION: basic ${authorization}`,
          "push",
          "origin",
          "HEAD:refs/heads/main",
        ]);
      } catch (error) {
        if (
          process.env.REPAIR_RETRY_ON_RACE === "true" &&
          error instanceof Error &&
          /!\s+\[rejected\].*\((?:fetch first|non-fast-forward)\)/.test(error.message)
        ) {
          await output("retry", "true");
          console.log(
            "Main advanced during validation; reapply and fully validate once before retrying.",
          );
          break;
        }
        throw error;
      }
      const sha = git(["rev-parse", "HEAD"]).trim();
      if (process.env.GITHUB_STEP_SUMMARY !== undefined)
        await appendFile(
          process.env.GITHUB_STEP_SUMMARY,
          `Repair committed: [${sha.slice(0, 8)}](${server}/${environment("GITHUB_REPOSITORY")}/commit/${sha})\n`,
        );
      break;
    }
    default:
      throw new Error(
        "Expected check-patch, validate, capture, verify, apply, retry-apply, commit, or push",
      );
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await runRepairPublication(process.argv[2]);
