import { expect, it } from "vite-plus/test";
import { moduleDependencies } from "../scripts/module-dependencies.ts";
import { validationPlan, type ValidationInputs } from "../scripts/validate-changes.ts";

const inputs: ValidationInputs = {
  full: false,
  generated: new Set(["src/catalog/pricing-schema.ts"]),
  build: new Set(["src/catalog/pricing-schema.ts", "src/App.vue"]),
  package: new Set(["src/catalog/pricing-schema.ts", "tests/fixtures/calculator/"]),
};

it("limits documentation and collector changes to their affected checks", () => {
  expect(validationPlan([], inputs)).toEqual([]);
  expect(validationPlan(["docs/providers/xai.md"], inputs)).toEqual([
    ["fmt", "--check", "--no-error-on-unmatched-pattern", "docs/providers/xai.md"],
  ]);
  expect(validationPlan(["src/catalog/xai.ts", "tests/xai-accounting.test.ts"], inputs)).toEqual([
    ["check"],
    [
      "test",
      "related",
      "--run",
      "--project",
      "unit",
      "src/catalog/xai.ts",
      "tests/xai-accounting.test.ts",
      "tests/test-architecture.test.ts",
    ],
  ]);
});

it("checks generated data and materialized consumers without rerunning code-only tests or packages", () => {
  expect(validationPlan(["data/catalog.json", "data/export-assets.pack"], inputs)).toEqual([
    ["test", "--run", "--project", "generated"],
    ["run", "build"],
  ]);
});

it("checks every affected pricing consumer once without a duplicate fixture suite", () => {
  const commands = validationPlan(["src/catalog/pricing-schema.ts"], inputs);
  expect(commands).toEqual([
    ["check"],
    [
      "test",
      "related",
      "--run",
      "--project",
      "unit",
      "src/catalog/pricing-schema.ts",
      "tests/test-architecture.test.ts",
    ],
    ["test", "--run", "--project", "generated"],
    ["run", "build"],
    ["run", "package:build"],
    ["run", "package:check"],
  ]);
  expect(commands.some((command) => command.includes("collect:fixtures"))).toBe(false);
});

it("uses the unit fallback for filesystem-loaded fixtures without also running related tests", () => {
  const commands = validationPlan(
    ["tests/fixtures/calculator/case.json", "tests/pricing.test.ts"],
    inputs,
  );
  expect(commands.filter(([command]) => command === "test")).toEqual([
    ["test", "--run", "--project", "unit"],
  ]);
  expect(commands.slice(-2)).toEqual([
    ["run", "package:build"],
    ["run", "package:check"],
  ]);
});

it("selects harness tests for workflow edits without unrelated production builds", () => {
  const commands = validationPlan([".github/workflows/catalog-repair.md"], inputs);
  expect(commands).toContainEqual([
    "test",
    "related",
    "--run",
    "--project",
    "unit",
    "tests/test-architecture.test.ts",
    "tests/catalog-repair-workflow.test.ts",
  ]);
  expect(commands.some(([command]) => command === "run")).toBe(false);
});

it.each(["pnpm-lock.yaml", "vite.config.ts", "tests/setup.ts"])(
  "uses one full test run when %s changes the shared execution contract",
  (path) => {
    const commands = validationPlan([path], inputs);
    expect(commands.filter(([command]) => command === "test")).toEqual([["test", "--run"]]);
    expect(commands.slice(-3)).toEqual([
      ["run", "build"],
      ["run", "package:build"],
      ["run", "package:check"],
    ]);
  },
);

it("follows relative imports, re-exports, workers and dynamic resource prefixes through Vue scripts", () => {
  expect(
    moduleDependencies(
      "src/Example.vue",
      [
        '<template><div>from "./not-a-module.ts"</div></template>',
        '<script setup lang="ts">',
        'import "./style.css";',
        'export { value } from "./helper.ts";',
        'const module = import("./lazy.ts");',
        'const worker = new URL("./worker.ts", import.meta.url);',
        "const data = new URL(`../data/${name}.json`, import.meta.url);",
        "</script>",
      ].join("\n"),
    ),
  ).toEqual(["src/style.css", "src/helper.ts", "src/lazy.ts", "src/worker.ts", "data/"]);
});
