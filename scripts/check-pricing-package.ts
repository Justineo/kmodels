import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createContext, SourceTextModule } from "node:vm";
import { build } from "vite-plus";
import { z } from "zod";
import {
  conformanceSchema,
  type ConformanceCase,
  type ConformanceSuite,
} from "../tests/pricing-conformance.ts";
import { calculationEnvelopeSchema, createCalculator } from "../src/pricing/index.ts";
import {
  calculationEnvelopeSchema as calculationV2EnvelopeSchema,
  createCalculator as createV2Calculator,
} from "../src/pricing/v2/index.ts";
import { conformanceV2Schema, type ConformanceV2Suite } from "../tests/pricing-v2-conformance.ts";

type PortableSuite = ConformanceSuite | ConformanceV2Suite;

const expectedPackageFiles = [
  "package/CONTRACT.md",
  "package/README.md",
  "package/conformance.json",
  "package/dist/index.d.ts",
  "package/dist/index.js",
  "package/package.json",
  "package/request.schema.json",
  "package/schema.json",
  "package/v1/CONTRACT.md",
  "package/v1/conformance.json",
  "package/v1/dist/index.d.ts",
  "package/v1/dist/index.js",
  "package/v1/request.schema.json",
  "package/v1/schema.json",
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
    await checkLegacyContract(packageDirectory);
    await checkConsumerTypes(packageDirectory);
    for (const version of ["1.0", "2.0"] as const) {
      const directory = version === "1.0" ? join(packageDirectory, "v1") : packageDirectory;
      const suite = await readConformanceSuite(directory, version);
      const entryPath = join(directory, "dist/index.js");
      await checkNodeRuntime(entryPath, suite);
      await checkBrowserRuntime(entryPath, suite);
      console.log(
        `Schema ${version}: ${suite.cases.length} calculations and ${suite.errors.length} errors verified in Node and browser.`,
      );
    }
    console.log(
      `Packed package: ${expectedPackageFiles.length} expected files; consumer types verified; synthetic conformance data only; no transport or Node dependency in the runtime.`,
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function checkConsumerTypes(packageDirectory: string): Promise<void> {
  for (const fixture of ["consumer", "consumer-v2"]) {
    const consumer = join(packageDirectory, `${fixture}.mts`);
    await copyFile(
      new URL(`../tests/fixtures/calculator/${fixture}.ts.txt`, import.meta.url),
      consumer,
    );
    for (const module of ["nodenext", "preserve"]) {
      execFileSync(
        "vp",
        [
          "exec",
          "tsc",
          "--ignoreConfig",
          "--noEmit",
          "--strict",
          "--exactOptionalPropertyTypes",
          "--noUncheckedIndexedAccess",
          "--skipLibCheck",
          "--target",
          "es2023",
          "--module",
          module,
          consumer,
        ],
        { stdio: "inherit" },
      );
    }
  }
}

async function checkLegacyContract(packageDirectory: string): Promise<void> {
  const hash = z.string().regex(/^[a-f0-9]{64}$/);
  const frozen = z
    .strictObject({
      source_commit: z.string().regex(/^[a-f0-9]{40}$/),
      files: z.strictObject({
        "schema.json": hash,
        "request.schema.json": hash,
        "conformance.json": hash,
        "CONTRACT.md": hash,
      }),
    })
    .parse(
      JSON.parse(
        await readFile(
          new URL("../tests/fixtures/calculator/v1-contract-hashes.json", import.meta.url),
          "utf8",
        ),
      ),
    );
  for (const [name, expected] of Object.entries(frozen.files)) {
    const actual = createHash("sha256")
      .update(await readFile(join(packageDirectory, "v1", name)))
      .digest("hex");
    assert.equal(
      actual,
      expected,
      `Legacy ${name} differs from frozen contract ${frozen.source_commit}`,
    );
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

  for (const distributionDirectory of [
    join(packageDirectory, "dist"),
    join(packageDirectory, "v1/dist"),
  ]) {
    assert.deepEqual((await readdir(distributionDirectory)).sort(), ["index.d.ts", "index.js"]);

    const runtimeSource = await readFile(join(distributionDirectory, "index.js"), "utf8");
    const forbiddenRuntimeFeatures =
      /node:|https?:\/\/[a-zA-Z0-9]|fetch\(|XMLHttpRequest|localStorage|indexedDB/;
    assert(
      !forbiddenRuntimeFeatures.test(runtimeSource),
      "Runtime contains a transport, storage, Node dependency, or bundled catalog",
    );
  }
}

async function readConformanceSuite(
  packageDirectory: string,
  version: "1.0" | "2.0",
): Promise<PortableSuite> {
  const fixturePath = join(packageDirectory, "conformance.json");
  const suite = (version === "1.0" ? conformanceSchema : conformanceV2Schema).parse(
    JSON.parse(await readFile(fixturePath, "utf8")),
  );
  const envelopes = [
    ...Object.values(suite.datasets),
    ...suite.errors.flatMap((vector) => {
      const inline = (
        version === "1.0" ? calculationEnvelopeSchema : calculationV2EnvelopeSchema
      ).safeParse(vector.data);
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

async function checkNodeRuntime(entryPath: string, suite: PortableSuite): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = rejectNetworkAccess;
  try {
    const moduleExports: unknown = await import(pathToFileURL(entryPath).href);
    await checkRuntimeConformance(moduleExports, suite);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function checkBrowserRuntime(entryPath: string, suite: PortableSuite): Promise<void> {
  const browserSource = await bundleForBrowser(entryPath);
  const browserGlobals = createContext({
    TextEncoder,
    TextDecoder,
    URL,
    structuredClone,
    crypto: globalThis.crypto,
    fetch: rejectNetworkAccess,
  });
  const browserModule = new SourceTextModule(browserSource, { context: browserGlobals });
  await browserModule.link(() => {
    throw new Error("Browser bundle has external imports");
  });
  await browserModule.evaluate();
  await checkRuntimeConformance(browserModule.namespace, suite);
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

async function checkRuntimeConformance(
  moduleExports: unknown,
  suite: PortableSuite,
): Promise<void> {
  checkRuntimeInvocation(moduleExports, suite);
  for (const testCase of suite.cases) {
    const dataset = suite.datasets[testCase.dataset];
    if (dataset === undefined) throw new Error("Missing conformance dataset");
    const calculator = await loadRuntimeCalculator(moduleExports, dataset, suite.schemaVersion);
    const actual = calculator.calculate(testCase.request);
    assertExpectedResult(actual, testCase);
    const referenceCalculator =
      suite.schemaVersion === "1.0" ? createCalculator(dataset) : await createV2Calculator(dataset);
    const reference = referenceCalculator.calculate(testCase.request);
    assert.equal(JSON.stringify(actual), JSON.stringify(reference), testCase.name);
  }
  for (const testCase of suite.errors) {
    const dataset =
      testCase.dataset === undefined ? testCase.data : suite.datasets[testCase.dataset];
    if (dataset === undefined) throw new Error("Missing conformance error dataset");
    const actualCode = await capturedErrorCode(async () => {
      const calculator = await loadRuntimeCalculator(moduleExports, dataset, suite.schemaVersion);
      if (testCase.request !== undefined) calculator.calculate(testCase.request);
    });
    assert.equal(actualCode, testCase.expectedCode, testCase.name);
  }
}

function checkRuntimeInvocation(moduleExports: unknown, suite: PortableSuite): void {
  if (suite.schemaVersion !== "2.0") return;
  if (
    typeof moduleExports !== "object" ||
    moduleExports === null ||
    !("assessInvocations" in moduleExports) ||
    typeof moduleExports.assessInvocations !== "function"
  )
    throw new Error("Missing invocation assessment export");
  const provider = suite.datasets["invocation-fixed"]?.providers[0];
  const target = provider?.invocation.invocation_targets[0];
  if (provider === undefined || target === undefined)
    throw new Error("Missing invocation conformance fixture");
  const graph = structuredClone(provider.invocation);
  const query = {
    provider_id: "example",
    identifier: "regional-model",
    task: "text_generation",
    target_ref: target.id,
  };
  const resultSchema = z.array(
    z.looseObject({
      eligibility: z.string(),
      resolution: z.looseObject({ context_match: z.string() }),
      request: z
        .looseObject({
          url: z.string(),
          body_fields: z.array(z.strictObject({ pointer: z.string(), value: z.string() })),
          account_access: z.literal("unknown"),
          request_verification: z.literal("not_tested"),
        })
        .optional(),
    }),
  );
  const unknown = resultSchema.parse(moduleExports.assessInvocations(graph, query));
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0]?.resolution.context_match, "unknown");
  assert.equal(unknown[0]?.request, undefined);
  const entry = graph.invocation_targets[0]?.cases[0];
  if (entry === undefined) throw new Error("Missing invocation fixture case");
  entry.inference_geo = { kind: "not_applicable" };
  const matched = resultSchema.parse(moduleExports.assessInvocations(graph, query));
  assert.equal(matched[0]?.eligibility, "eligible");
  assert.equal(matched[0]?.request?.url, "https://example.invalid/inference");
  assert.deepEqual(matched[0]?.request?.body_fields, [
    { pointer: "/model", value: "regional-model" },
  ]);
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

async function loadRuntimeCalculator(
  moduleExports: unknown,
  priceData: unknown,
  version: "1.0" | "2.0",
): Promise<RuntimeCalculator> {
  if (
    typeof moduleExports !== "object" ||
    moduleExports === null ||
    !("createCalculator" in moduleExports) ||
    typeof moduleExports.createCalculator !== "function"
  ) {
    throw new Error("Missing calculator export");
  }

  const initialization: unknown = moduleExports.createCalculator(priceData);
  const asynchronous =
    typeof initialization === "object" &&
    initialization !== null &&
    "then" in initialization &&
    typeof initialization.then === "function";
  assert.equal(
    asynchronous,
    version === "2.0",
    `Unexpected schema ${version} initialization timing`,
  );
  const calculator: unknown = await initialization;
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

async function capturedErrorCode(action: () => Promise<void>): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error) return error.code;
    throw error;
  }
  return undefined;
}

function rejectNetworkAccess(): never {
  throw new Error("Calculator attempted network access");
}
