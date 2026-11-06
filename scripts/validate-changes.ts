import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, readFile, lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { moduleDependencies } from "./module-dependencies.ts";
import { generatedDataTests } from "../tests/generated-data-tests.ts";

export interface ValidationInputs {
  full: boolean;
  generated: ReadonlySet<string>;
  build: ReadonlySet<string>;
  package: ReadonlySet<string>;
}

export function validationPlan(paths: readonly string[], inputs: ValidationInputs): string[][] {
  if (paths.length === 0 && !inputs.full) return [];
  const changed = (pattern: RegExp) => paths.some((path) => pattern.test(path));
  const affects = (dependencies: ReadonlySet<string>) =>
    paths.some((path) =>
      [...dependencies].some((dependency) => {
        const prefix = dependency.replace(/\/$/, "");
        return path === prefix || path.startsWith(`${prefix}/`);
      }),
    );
  const full =
    inputs.full ||
    changed(
      /^(?:package\.json|pnpm-lock\.yaml|\.node-version|vite\.config\.ts|tsconfig[^/]*\.json)$/,
    ) ||
    changed(/^tests\/(?:setup[^/]*|generated-data-tests)\.ts$/);
  const generated = full || changed(/^data\//) || affects(inputs.generated);
  const build =
    full ||
    changed(
      /^(?:data\/(?:catalog\.json|pricing\.json\.gz|(?:website|export)-assets\.)|public\/|src\/.*\.css$)/,
    ) ||
    affects(inputs.build);
  const portable = full || changed(/^packages\/pricing\//) || affects(inputs.package);
  const code = paths.filter((path) => /\.(?:[cm]?[jt]sx?|vue)$/.test(path));
  const workflow = changed(/^\.github\//);
  const unit = full || changed(/^tests\/fixtures\//);
  const commands: string[][] = [];
  if (code.length > 0 || full) commands.push(["check"]);
  else {
    const formatted = paths.filter(
      (path) => !path.startsWith("data/") && /\.(?:md|json|ya?ml|css|html)$/.test(path),
    );
    if (formatted.length > 0)
      commands.push(["fmt", "--check", "--no-error-on-unmatched-pattern", ...formatted]);
  }
  if (full) commands.push(["test", "--run"]);
  else {
    if (unit) commands.push(["test", "--run", "--project", "unit"]);
    else if (code.length > 0 || workflow)
      commands.push([
        "test",
        "related",
        "--run",
        "--project",
        "unit",
        ...new Set([
          ...code,
          "tests/test-architecture.test.ts",
          ...(workflow ? ["tests/catalog-repair-workflow.test.ts"] : []),
        ]),
      ]);
    if (generated) commands.push(["test", "--run", "--project", "generated"]);
  }
  if (build) commands.push(["run", "build"]);
  if (portable) commands.push(["run", "package:build"], ["run", "package:check"]);
  return commands;
}

async function dependencyClosure(entries: string[]): Promise<Set<string>> {
  const seen = new Set<string>();
  async function visit(file: string): Promise<void> {
    if (seen.has(file)) return;
    seen.add(file);
    if (!/\.(?:[cm]?[jt]sx?|vue)$/.test(file)) return;
    const source = await readFile(file, "utf8");
    for (const dependency of moduleDependencies(file, source)) await visit(dependency);
  }
  for (const entry of entries) await visit(entry);
  return seen;
}

function git(args: string[], cwd?: string): string {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    ...(cwd === undefined ? {} : { cwd }),
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || "Validation diff failed");
  return result.stdout;
}

/** Compare the prepared package tree, including intentional edits, across generation. */
export async function packageSourceHash(root = resolve(".")): Promise<string> {
  const paths = [
    ...new Set(
      git(
        ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "packages/pricing"],
        root,
      )
        .split("\0")
        .filter(Boolean),
    ),
  ].sort();
  const entries = await Promise.all(
    paths.map(async (path) => {
      try {
        const file = resolve(root, path);
        const [bytes, stat] = await Promise.all([readFile(file), lstat(file)]);
        return [path, stat.mode, createHash("sha256").update(bytes).digest("hex")];
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT")
          return [path, null];
        throw error;
      }
    }),
  );
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

export async function validateChanges(base: string | undefined, planOnly = false): Promise<void> {
  if (base === "") base = undefined;
  if (base !== undefined && base !== "HEAD" && !/^[a-f0-9]{40}$/.test(base))
    throw new Error("Validation base must be HEAD or a complete commit SHA");
  const full = base === undefined || /^0{40}$/.test(base);
  const paths =
    base === undefined || full
      ? []
      : [
          ...git(["diff", "--name-only", "-z", base, "--"]).split("\0"),
          ...git(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0"),
        ].filter(Boolean);
  const inActions = process.env.GITHUB_ACTIONS === "true";
  const selected = validationPlan([...new Set(paths)], {
    full,
    generated: await dependencyClosure(generatedDataTests),
    build: await dependencyClosure(["vite.config.ts", "src/main.ts"]),
    package: await dependencyClosure([
      "src/pricing/index.ts",
      "scripts/pricing-package-schema.ts",
      "scripts/check-pricing-package.ts",
    ]),
  });
  const commands = selected.map((args) =>
    inActions && args[0] === "test"
      ? [...args, "--reporter=minimal", "--reporter=github-actions", "--silent=passed-only"]
      : args,
  );
  if (planOnly || !inActions)
    console.log(JSON.stringify({ base: base ?? null, paths, commands }, null, 2));
  else
    console.log(
      `Selected ${commands.length} checks for ${full ? "the complete validation gate" : `${paths.length} changed paths`}.`,
    );
  if (process.env.GITHUB_OUTPUT !== undefined)
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `repair_toolchain=${full || paths.some((path) => /^(?:\.github\/|scripts\/(?:catalog-repair|validate-changes|module-dependencies)|package\.json$|pnpm-lock\.yaml$|\.node-version$)/.test(path))}\n`,
    );
  if (planOnly) return;
  for (const args of commands) {
    const command = `vp ${args.join(" ")}`;
    console.log(`Validation: ${command}`);
    const packageBefore = args[1] === "package:build" ? await packageSourceHash() : undefined;
    const result = spawnSync("vp", args, { stdio: "inherit" });
    if (result.error !== undefined || result.status !== 0) {
      const message = `${command} failed (${result.error?.message ?? result.signal ?? result.status})`;
      throw result.error ?? new Error(message);
    }
    if (packageBefore !== undefined && packageBefore !== (await packageSourceHash()))
      throw new Error("Package generation changed the prepared source artifacts");
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const bases = args.filter((arg) => arg !== "--plan");
  if (bases.length > 1) throw new Error("Expected [BASE_SHA | HEAD] [--plan]");
  const base = bases[0];
  await validateChanges(base, args.includes("--plan"));
}
