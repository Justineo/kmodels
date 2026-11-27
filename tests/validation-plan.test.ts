import { expect, it } from "vite-plus/test";
import { moduleDependencies } from "../scripts/module-dependencies.ts";
import {
  ciPrerequisites,
  ciValidationGroups,
  validationPlan,
  type ValidationInputs,
} from "../scripts/validate-changes.ts";

const inputs: ValidationInputs = {
  full: false,
  generated: new Map([
    [
      "tests/pricing-lookup-data.test.ts",
      new Set(["src/catalog/pricing-schema.ts", "tests/pricing-lookup-data.test.ts"]),
    ],
  ]),
  build: new Set(["src/catalog/pricing-schema.ts", "src/App.vue", "scripts/check-price-assets.ts"]),
  package: new Set(["src/catalog/pricing-schema.ts", "tests/fixtures/pricing/"]),
  performance: new Set(["src/catalog/pricing-schema.ts", "src/components/InferencePrices.vue"]),
};

it("partitions the complete CI gate and keeps package generation with its consumer", () => {
  const full = validationPlan([], { ...inputs, full: true });
  expect(Object.fromEntries(ciValidationGroups(full))).toEqual({
    source: [["check"]],
    "unit-1": [["test", "--run", "--project", "unit", "--shard=1/2"]],
    "unit-2": [["test", "--run", "--project", "unit", "--shard=2/2"]],
    "generated-1": [["test", "--run", "--project", "generated", "--shard=1/3"]],
    "generated-2": [["test", "--run", "--project", "generated", "--shard=2/3"]],
    "generated-3": [["test", "--run", "--project", "generated", "--shard=3/3"]],
    build: [
      ["run", "build"],
      ["run", "test:e2e"],
    ],
    package: [
      ["run", "package:build"],
      ["run", "package:check"],
    ],
    browser: [["run", "test:pricing-performance"]],
  });
  const related = validationPlan(["src/catalog/xai.ts"], inputs);
  expect(Object.fromEntries(ciValidationGroups(related))).toEqual({ source: related });
  expect([...ciValidationGroups([])]).toEqual([]);
});

it("prepares only the runtime inputs consumed by the selected CI checks", () => {
  const hydrate = ["node", "scripts/catalog-snapshot.ts", "hydrate"];
  const browser = ["exec", "playwright", "install", "--with-deps", "chromium", "--only-shell"];
  for (const path of ["README.md", "src/catalog/xai.ts", "tests/fixtures/pricing/case.json"])
    expect(ciPrerequisites(validationPlan([path], inputs))).toEqual([]);
  for (const commands of [
    [["test", "--run"]],
    [["test", "--run", "--project", "generated"]],
    [["run", "build"]],
  ])
    expect(ciPrerequisites(commands)).toEqual([hydrate]);
  for (const path of [
    "pnpm-lock.yaml",
    "data/catalog-snapshot.json",
    "tests/performance/index.html",
  ])
    expect(ciPrerequisites(validationPlan([path], inputs))).toEqual([hydrate, browser]);
});

it("limits documentation and collector changes to their affected checks", () => {
  expect(validationPlan([], inputs)).toEqual([]);
  expect(validationPlan(["docs/providers/xai.md"], inputs)).toEqual([
    ["fmt", "--check", "--no-error-on-unmatched-pattern", "docs/providers/xai.md"],
  ]);
  expect(validationPlan(["index.html"], inputs)).toEqual([
    ["fmt", "--check", "--no-error-on-unmatched-pattern", "index.html"],
    ["run", "build"],
    ["run", "test:e2e"],
  ]);
  expect(validationPlan(["scripts/check-website-e2e.ts"], inputs)).toEqual([
    ["check"],
    ["test", "related", "--run", "--project", "unit", "scripts/check-website-e2e.ts"],
    ["run", "build"],
    ["run", "test:e2e"],
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
      "tests/architecture-boundaries.test.ts",
    ],
  ]);
  expect(validationPlan(["src/tokens.css"], inputs)).toContainEqual([
    "test",
    "related",
    "--run",
    "--project",
    "unit",
    "tests/design-tokens.test.ts",
  ]);
});

it("checks generated data and materialized consumers without rerunning code-only tests or packages", () => {
  expect(validationPlan(["data/catalog-snapshot.json"], inputs)).toEqual([
    ["test", "--run", "--project", "generated"],
    ["run", "build"],
    ["run", "test:e2e"],
    ["run", "test:pricing-performance"],
  ]);
  expect(validationPlan(["data/catalog.json", "data/export-assets.pack"], inputs)).toEqual([
    ["test", "--run", "--project", "generated"],
    ["run", "build"],
    ["run", "test:e2e"],
  ]);
  expect(validationPlan(["data/refresh-summary.json"], inputs)).toEqual([
    ["test", "--run", "--project", "generated"],
  ]);
  expect(validationPlan(["scripts/check-price-assets.ts"], inputs)).toContainEqual([
    "run",
    "build",
  ]);
  expect(
    ciValidationGroups(validationPlan(["tests/pricing-lookup-data.test.ts"], inputs)).get(
      "generated",
    ),
  ).toEqual([["test", "--run", "--project", "generated", "tests/pricing-lookup-data.test.ts"]]);
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
      "tests/architecture-boundaries.test.ts",
    ],
    ["test", "--run", "--project", "generated", "tests/pricing-lookup-data.test.ts"],
    ["run", "build"],
    ["run", "test:e2e"],
    ["run", "package:build"],
    ["run", "package:check"],
    ["run", "test:pricing-performance"],
  ]);
  expect(commands.some((command) => command.includes("collect:fixtures"))).toBe(false);
});

it("uses the unit fallback for filesystem-loaded fixtures without also running related tests", () => {
  const commands = validationPlan(
    ["tests/fixtures/pricing/case.json", "tests/pricing.test.ts"],
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
  const commands = validationPlan([".github/workflows/self-heal.yml"], inputs);
  expect(commands).toContainEqual([
    "test",
    "related",
    "--run",
    "--project",
    "unit",
    "tests/self-heal.test.ts",
  ]);
  expect(commands.some(([command]) => command === "run")).toBe(false);
});

it.each(["src/components/InferencePrices.vue", "tests/performance/index.html"])(
  "selects browser performance checks for %s",
  (path) =>
    expect(validationPlan([path], inputs)).toContainEqual(["run", "test:pricing-performance"]),
);

it.each(["pnpm-lock.yaml", "pnpm-workspace.yaml", "vite.config.ts", "tests/setup.ts"])(
  "uses one full test run when %s changes the shared execution contract",
  (path) => {
    const commands = validationPlan([path], inputs);
    expect(commands.filter(([command]) => command === "test")).toEqual([["test", "--run"]]);
    expect(commands.slice(-5)).toEqual([
      ["run", "build"],
      ["run", "test:e2e"],
      ["run", "package:build"],
      ["run", "package:check"],
      ["run", "test:pricing-performance"],
    ]);
  },
);

it("follows relative imports, re-exports, workers and dynamic resource prefixes through Vue scripts", () => {
  const source = [
    '<template><div>from "./not-a-module.ts"</div></template>',
    '<script setup lang="ts">',
    '// import "./comment.ts";',
    'import "node:fs";',
    'import type { Value } from "./types.ts";',
    'export type { Other } from "./other-types.ts";',
    'import "./style.css";',
    'export { value } from "./helper.ts";',
    'const module = import("./lazy.ts");',
    'const worker = new URL("./worker.ts", import.meta.url);',
    "const data = new URL(`../data/${name}.json`, import.meta.url);",
    "</script>",
  ].join("\n");
  expect(moduleDependencies("src/Example.vue", source)).toEqual([
    "src/types.ts",
    "src/other-types.ts",
    "src/style.css",
    "src/helper.ts",
    "src/lazy.ts",
    "src/worker.ts",
    "data/",
  ]);
  expect(moduleDependencies("src/Example.vue", source, "runtime")).toEqual([
    "node:fs",
    "src/style.css",
    "src/helper.ts",
    "src/lazy.ts",
  ]);
});
