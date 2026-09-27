import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createContext, SourceTextModule } from "node:vm";
import { build } from "vite-plus";
import { z } from "zod";
import {
  conformanceDataset,
  conformanceErrorData,
  conformanceSchema,
  type ConformanceCase,
  type ConformanceSuite,
} from "../tests/pricing-conformance.ts";
import { calculationEnvelopeSchema, createCalculator } from "../src/pricing/index.ts";

const expectedPackageFiles = [
  "package/CONTRACT.md",
  "package/README.md",
  "package/conformance.json",
  "package/dist/index.d.ts",
  "package/dist/index.js",
  "package/package.json",
  "package/request.schema.json",
  "package/schema.json",
];

const packageManifestSchema = z.object({
  name: z.literal("@kmodels/pricing"),
  type: z.literal("module"),
  dependencies: z.record(z.string(), z.string()),
});

interface RuntimeCalculator {
  calculate(input: unknown): unknown;
}

const runtimeResultSchema = z.looseObject({
  status: z.string(),
  subtotals: z.unknown(),
  totals: z.unknown().optional(),
  unresolved: z.array(z.looseObject({ code: z.string() })),
});

await checkPricingPackage();

async function checkPricingPackage(): Promise<void> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "kmodels-pricing-package-"));
  try {
    const packageDirectory = await packAndExtractPackage(temporaryDirectory);
    await checkPackageContents(packageDirectory);
    const suite = await readConformanceSuite(packageDirectory);
    const entryPath = join(packageDirectory, "dist/index.js");

    await checkNodeRuntime(entryPath, suite);
    await checkBrowserRuntime(entryPath, suite);

    console.log(
      `Packed package: ${expectedPackageFiles.length} expected files; ` +
        `${suite.cases.length} calculations and ${suite.errors.length} errors verified in Node and browser; ` +
        "synthetic conformance data only; no transport or Node dependency in the runtime.",
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function packAndExtractPackage(temporaryDirectory: string): Promise<string> {
  const archivePath = join(temporaryDirectory, "pricing.tgz");
  execFileSync("vp", ["pm", "pack", "--out", archivePath], {
    cwd: resolve("packages/pricing"),
    stdio: "pipe",
  });

  const archiveListing = execFileSync("tar", ["-tzf", archivePath], { encoding: "utf8" });
  const packagedFiles = archiveListing.trim().split("\n").sort();
  assert.deepEqual(packagedFiles, expectedPackageFiles, "Unexpected or missing npm package files");

  execFileSync("tar", ["-xzf", archivePath, "-C", temporaryDirectory]);
  await symlink(resolve("node_modules"), join(temporaryDirectory, "node_modules"), "dir");
  return join(temporaryDirectory, "package");
}

async function checkPackageContents(packageDirectory: string): Promise<void> {
  const manifestPath = join(packageDirectory, "package.json");
  const manifest = packageManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  assert.deepEqual(Object.keys(manifest.dependencies), ["zod"]);

  const distributionDirectory = join(packageDirectory, "dist");
  assert.deepEqual((await readdir(distributionDirectory)).sort(), ["index.d.ts", "index.js"]);

  const runtimeSource = await readFile(join(distributionDirectory, "index.js"), "utf8");
  const forbiddenRuntimeFeatures =
    /node:|https?:\/\/|fetch\(|XMLHttpRequest|localStorage|indexedDB/;
  assert(
    !forbiddenRuntimeFeatures.test(runtimeSource),
    "Runtime contains a transport, storage, Node dependency, or bundled catalog",
  );
}

async function readConformanceSuite(packageDirectory: string): Promise<ConformanceSuite> {
  const fixturePath = join(packageDirectory, "conformance.json");
  const suite = conformanceSchema.parse(JSON.parse(await readFile(fixturePath, "utf8")));
  const envelopes = [
    ...Object.values(suite.datasets),
    ...suite.errors.flatMap((vector) => {
      const inline = calculationEnvelopeSchema.safeParse(vector.data);
      return inline.success ? [inline.data] : [];
    }),
  ];
  for (const envelope of envelopes) {
    for (const provider of envelope.providers) {
      assert.equal(
        provider.snapshot.provider_id,
        "example",
        "Conformance contains real provider prices",
      );
    }
  }
  return suite;
}

async function checkNodeRuntime(entryPath: string, suite: ConformanceSuite): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = rejectNetworkAccess;
  try {
    const moduleExports: unknown = await import(pathToFileURL(entryPath).href);
    checkRuntimeConformance(moduleExports, suite);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function checkBrowserRuntime(entryPath: string, suite: ConformanceSuite): Promise<void> {
  const browserSource = await bundleForBrowser(entryPath);
  const browserGlobals = createContext({
    TextEncoder,
    TextDecoder,
    URL,
    structuredClone,
    fetch: rejectNetworkAccess,
  });
  const browserModule = new SourceTextModule(browserSource, { context: browserGlobals });
  await browserModule.link(() => {
    throw new Error("Browser bundle has external imports");
  });
  await browserModule.evaluate();
  checkRuntimeConformance(browserModule.namespace, suite);
}

async function bundleForBrowser(entryPath: string): Promise<string> {
  const buildResult = await build({
    configFile: false,
    logLevel: "error",
    build: {
      write: false,
      minify: false,
      target: "es2023",
      lib: { entry: entryPath, formats: ["es"] },
    },
  });
  const bundle = Array.isArray(buildResult) ? buildResult[0] : buildResult;
  if (bundle === undefined || !("output" in bundle)) {
    throw new Error("Unexpected browser bundle output");
  }
  const entryChunk = bundle.output.find((output) => output.type === "chunk");
  if (entryChunk?.type !== "chunk") throw new Error("Missing browser bundle");
  return entryChunk.code;
}

function checkRuntimeConformance(moduleExports: unknown, suite: ConformanceSuite): void {
  for (const testCase of suite.cases) {
    const dataset = conformanceDataset(suite, testCase.dataset);
    const calculator = loadRuntimeCalculator(moduleExports, dataset);
    const actual = calculator.calculate(testCase.request);
    assertExpectedResult(actual, testCase);
    const reference = createCalculator(dataset).calculate(testCase.request);
    assert.equal(JSON.stringify(actual), JSON.stringify(reference), testCase.name);
  }
  for (const testCase of suite.errors) {
    const dataset = conformanceErrorData(suite, testCase);
    const actualCode = capturedErrorCode(() => {
      const calculator = loadRuntimeCalculator(moduleExports, dataset);
      if (testCase.request !== undefined) calculator.calculate(testCase.request);
    });
    assert.equal(actualCode, testCase.expectedCode, testCase.name);
  }
}

function assertExpectedResult(actual: unknown, testCase: ConformanceCase): void {
  const result = runtimeResultSchema.parse(actual);
  assert.equal(result.status, testCase.expected.status, testCase.name);
  assert.deepEqual(result.subtotals, testCase.expected.subtotals, testCase.name);
  assert.deepEqual(
    [...new Set(result.unresolved.map((gap) => gap.code))].sort(),
    [...testCase.expected.unresolvedCodes].sort(),
    testCase.name,
  );
  assert.equal(
    result.totals !== undefined,
    result.status === "calculated" || result.status === "estimated",
    testCase.name,
  );
}

function loadRuntimeCalculator(moduleExports: unknown, priceData: unknown): RuntimeCalculator {
  if (
    typeof moduleExports !== "object" ||
    moduleExports === null ||
    !("createCalculator" in moduleExports) ||
    typeof moduleExports.createCalculator !== "function"
  ) {
    throw new Error("Missing calculator export");
  }

  const calculator: unknown = moduleExports.createCalculator(priceData);
  if (
    typeof calculator !== "object" ||
    calculator === null ||
    !("calculate" in calculator) ||
    typeof calculator.calculate !== "function"
  ) {
    throw new Error("Missing calculate method");
  }

  const calculate = calculator.calculate;
  return {
    calculate(input: unknown): unknown {
      return calculate.call(calculator, input);
    },
  };
}

function capturedErrorCode(action: () => void): unknown {
  try {
    action();
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error) return error.code;
    throw error;
  }
  return undefined;
}

function rejectNetworkAccess(): never {
  throw new Error("Calculator attempted network access");
}
