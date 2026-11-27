import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, readFile, lstat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { moduleDependencies } from "./module-dependencies.ts";
import { generatedDataTests } from "../tests/generated-data-tests.ts";

export interface ValidationInputs {
  full: boolean;
  generated: ReadonlyMap<string, ReadonlySet<string>>;
  build: ReadonlySet<string>;
  package: ReadonlySet<string>;
  performance: ReadonlySet<string>;
}

const fullGateInputs =
  /^(?:package\.json|pnpm-(?:lock\.yaml|workspace\.yaml)|\.npmrc|\.node-version|vite\.config\.ts|tsconfig[^/]*\.json|tests\/(?:setup[^/]*|generated-data-tests)\.ts)$/;
const modulePath = /\.(?:[cm]?[jt]sx?|vue)$/;
const siteData =
  /^data\/(?:catalog(?:-snapshot)?\.json|pricing\.json\.gz|(?:website|export)-assets\.)/;
const browserData = /^data\/(?:catalog-snapshot\.json|website-assets\.)/;

export function validationPlan(paths: readonly string[], inputs: ValidationInputs): string[][] {
  if (paths.length === 0 && !inputs.full) return [];
  const changed = (pattern: RegExp) => paths.some((path) => pattern.test(path));
  const affects = (dependencies: ReadonlySet<string>) =>
    paths.some((path) => {
      if (dependencies.has(path)) return true;
      for (let directory = dirname(path); directory !== "."; directory = dirname(directory)) {
        if (dependencies.has(`${directory}/`)) return true;
      }
      return false;
    });
  const full = inputs.full || changed(fullGateInputs);
  const allGenerated = full || changed(/^data\//);
  const generated = allGenerated
    ? []
    : [...inputs.generated]
        .filter(([, dependencies]) => affects(dependencies))
        .map(([file]) => file);
  const build =
    full ||
    changed(siteData) ||
    changed(/^(?:index\.html$|scripts\/check-website-e2e\.ts$|public\/|src\/.*\.css$)/) ||
    affects(inputs.build);
  const portable = full || changed(/^packages\/pricing\//) || affects(inputs.package);
  const performance =
    full || changed(browserData) || changed(/^tests\/performance\//) || affects(inputs.performance);
  const e2e =
    build &&
    (full ||
      changed(siteData) ||
      changed(/^(?:index\.html$|src\/|scripts\/check-website-e2e\.ts$)/));
  const code = paths.filter((path) => modulePath.test(path));
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
    else {
      const related = new Set(code);
      if (changed(/^(?:tests\/|scripts\/module-dependencies\.ts$)/))
        related.add("tests/test-architecture.test.ts");
      if (code.some((path) => path.startsWith("src/")))
        related.add("tests/architecture-boundaries.test.ts");
      if (changed(/^src\/.*\.(?:css|vue)$/)) related.add("tests/design-tokens.test.ts");
      if (paths.includes(".github/workflows/self-heal.yml")) related.add("tests/self-heal.test.ts");
      if (related.size > 0)
        commands.push(["test", "related", "--run", "--project", "unit", ...related]);
    }
    if (allGenerated || generated.length > 0) {
      commands.push([
        "test",
        "--run",
        "--project",
        "generated",
        ...(generated.length === generatedDataTests.length ? [] : generated),
      ]);
    }
  }
  if (build) commands.push(["run", "build"]);
  if (e2e) commands.push(["run", "test:e2e"]);
  if (portable) commands.push(["run", "package:build"], ["run", "package:check"]);
  if (performance) commands.push(["run", "test:pricing-performance"]);
  return commands;
}

async function dependencyClosure(
  entries: string[],
  dependencies: Map<string, string[]>,
): Promise<Set<string>> {
  const seen = new Set<string>();
  async function visit(file: string): Promise<void> {
    if (seen.has(file)) return;
    seen.add(file);
    if (!modulePath.test(file)) return;
    let direct = dependencies.get(file);
    if (direct === undefined) {
      direct = moduleDependencies(file, await readFile(file, "utf8"));
      dependencies.set(file, direct);
    }
    for (const dependency of direct) await visit(dependency);
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

export function ciValidationGroups(commands: readonly string[][]): Map<string, string[][]> {
  const groups = new Map<string, string[][]>();
  function add(group: string, command: string[]) {
    const existing = groups.get(group);
    if (existing) existing.push(command);
    else groups.set(group, [command]);
  }
  for (const args of commands) {
    if (args[0] === "test" && args[1] === "--run") {
      if (args[3] === "generated" && args.length > 4) {
        add("generated", args);
        continue;
      }
      const scoped = args.includes("--project");
      for (const [project, count] of [
        ["unit", 2],
        ["generated", 3],
      ] as const) {
        if (scoped && !args.includes(project)) continue;
        const projectArgs = scoped ? args : [...args, "--project", project];
        for (let shard = 1; shard <= count; shard++)
          add(`${project}-${shard}`, [...projectArgs, `--shard=${shard}/${count}`]);
      }
    } else if (args[0] === "run") {
      if (args[1] === "test:pricing-performance") add("browser", args);
      else if (args[1]?.startsWith("package:")) add("package", args);
      else add("build", args);
    } else add("source", args);
  }
  return groups;
}

export function ciPrerequisites(commands: readonly string[][]): string[][] {
  const browser = commands.some(
    ([task, script]) =>
      task === "run" && (script === "test:pricing-performance" || script === "test:e2e"),
  );
  const snapshot =
    browser ||
    commands.some(
      (args) =>
        (args[0] === "run" && args[1] === "build") ||
        (args[0] === "test" && (!args.includes("--project") || args.includes("generated"))),
    );
  const prerequisites: string[][] = [];
  if (snapshot) prerequisites.push(["node", "scripts/catalog-snapshot.ts", "hydrate"]);
  if (browser)
    prerequisites.push([
      "exec",
      "playwright",
      "install",
      "--with-deps",
      "chromium",
      "--only-shell",
    ]);
  return prerequisites;
}

export async function validateChanges(
  base: string | undefined,
  planOnly = false,
  ciGroup?: string,
): Promise<void> {
  if (base === "") base = undefined;
  if (base !== undefined && base !== "HEAD" && !/^[a-f0-9]{40}$/.test(base))
    throw new Error("Validation base must be HEAD or a complete commit SHA");
  const full = base === undefined || /^0{40}$/.test(base);
  const paths = [
    ...new Set(
      base === undefined || full
        ? []
        : [
            ...git(["diff", "--name-only", "-z", base, "--"]).split("\0"),
            ...git(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0"),
          ].filter(Boolean),
    ),
  ];
  const inActions = process.env.GITHUB_ACTIONS === "true";
  const selected = validationPlan(paths, await validationInputs(paths, full));
  let checks = selected;
  if (ciGroup !== undefined) {
    const groups = ciValidationGroups(selected);
    if (ciGroup === "plan") {
      const parallel = groups.size === 1 && groups.has("source") ? [] : [...groups.keys()];
      if (parallel.length && !planOnly) console.log(`Validation groups: ${parallel.join(", ")}`);
      if (process.env.GITHUB_OUTPUT !== undefined && !planOnly)
        await appendFile(process.env.GITHUB_OUTPUT, `groups=${JSON.stringify(parallel)}\n`);
      checks = parallel.length ? [] : selected;
    } else {
      const group = groups.get(ciGroup);
      if (!group) throw new Error(`No selected CI checks in group ${ciGroup}`);
      checks = group;
    }
  }
  const commands = checks.map((args) =>
    args[0] === "test"
      ? [
          ...args,
          "--reporter=minimal",
          ...(inActions ? ["--reporter=github-actions"] : []),
          "--silent=passed-only",
        ]
      : args,
  );
  if (ciGroup !== undefined) commands.unshift(...ciPrerequisites(checks));
  if (planOnly) {
    console.log(JSON.stringify({ base: base ?? null, paths, commands }, null, 2));
    return;
  }
  for (const args of commands) {
    const command = `vp ${args.join(" ")}`;
    console.log(`Validation: ${args[1] === "related" ? "vp test related (unit)" : command}`);
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

async function validationInputs(paths: string[], initial: boolean): Promise<ValidationInputs> {
  const full = initial || paths.some((path) => fullGateInputs.test(path));
  const dependencies = new Map<string, string[]>();
  const closure = (entries: string[]) => dependencyClosure(entries, dependencies);
  if (full || paths.length === 0) {
    const empty = new Set<string>();
    return { full, generated: new Map(), build: empty, package: empty, performance: empty };
  }
  const generated = new Map<string, ReadonlySet<string>>();
  for (const file of generatedDataTests) generated.set(file, await closure([file]));
  return {
    full,
    generated,
    build: await closure(["vite.config.ts", "src/main.ts", "scripts/check-price-assets.ts"]),
    package: await closure([
      "src/pricing/index.ts",
      "scripts/pricing-package-schema.ts",
      "scripts/check-pricing-package.ts",
    ]),
    performance: await closure(["scripts/check-pricing-performance.ts"]),
  };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const bases = args.filter((arg) => arg !== "--plan" && !arg.startsWith("--ci="));
  if (bases.length > 1) throw new Error("Expected [BASE_SHA | HEAD] [--plan] [--ci=GROUP]");
  const base = bases[0];
  await validateChanges(
    base,
    args.includes("--plan"),
    args.find((arg) => arg.startsWith("--ci="))?.slice(5),
  );
}
